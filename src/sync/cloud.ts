import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from '../core/types';
import { normalize } from '../core/actions';
import { mergeStates } from '../core/merge';
import type { Store } from '../state/store';

export interface SyncConfig {
  url: string;
  anonKey: string;
}

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

const CONFIG_KEY = 'study-buddy:sync-config';
const POLL_MS = 60_000;
const PUSH_DEBOUNCE_MS = 2_000;

/** Build-time config (GitHub Actions variables) or one pasted into Settings. */
export function loadSyncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey) return { url, anonKey };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

export interface Remote {
  fetch(): Promise<AppState | null>;
  push(state: AppState): Promise<void>;
}

/**
 * One pull-merge-push round. Because merge is a union of append-only logs,
 * concurrent rounds from two devices converge on the next round.
 */
export async function syncOnce(local: AppState, remote: Remote): Promise<AppState> {
  const theirs = await remote.fetch();
  const merged = theirs ? mergeStates(local, normalize(theirs)) : local;
  if (!theirs || JSON.stringify(merged) !== JSON.stringify(normalize(theirs))) await remote.push(merged);
  return merged;
}

export class CloudSync {
  status: SyncStatus = 'disabled';
  email: string | null = null;
  lastSyncedAt: number | null = null;
  lastError: string | null = null;
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private channel: RealtimeChannel | null = null;
  private running = false;
  private again = false;
  private listeners = new Set<() => void>();
  private applyingRemote = false;

  constructor(private store: Store) {
    store.subscribe(() => {
      if (!this.applyingRemote) this.schedulePush();
    });
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void this.syncNow());
      window.addEventListener('online', () => void this.syncNow());
    }
  }

  /** Supabase client + signed-in user (for the leaderboard), or null when signed out. */
  get session(): { client: SupabaseClient; userId: string } | null {
    return this.client && this.userId ? { client: this.client, userId: this.userId } : null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private setStatus(s: SyncStatus, err: string | null = null) {
    this.status = s;
    this.lastError = err;
    this.emit();
  }

  async configure(cfg: SyncConfig | null): Promise<void> {
    this.stop();
    this.client = null;
    if (!cfg) return this.setStatus('disabled');
    try {
      // loaded lazily so the app starts fast without sync configured
      const { createClient } = await import('@supabase/supabase-js');
      this.client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    } catch (e) {
      return this.setStatus('error', String(e));
    }
    this.client.auth.onAuthStateChange((_ev, session) => {
      const uid = session?.user.id ?? null;
      this.email = session?.user.email ?? null;
      if (uid !== this.userId) {
        this.userId = uid;
        if (uid) this.startLoop();
        else {
          this.stop();
          this.setStatus('signed-out');
        }
      }
    });
    const { data } = await this.client.auth.getSession();
    this.userId = data.session?.user.id ?? null;
    this.email = data.session?.user.email ?? null;
    if (this.userId) this.startLoop();
    else this.setStatus('signed-out');
  }

  async signIn(email: string, password: string): Promise<string | null> {
    if (!this.client) return 'Sync is not configured';
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  }

  async signUp(email: string, password: string): Promise<string | null> {
    if (!this.client) return 'Sync is not configured';
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) return error.message;
    if (!data.session) return 'Check your email to confirm your account, then sign in.';
    return null;
  }

  async signOut(): Promise<void> {
    await this.client?.auth.signOut();
  }

  private remote(): Remote {
    const client = this.client!;
    const userId = this.userId!;
    return {
      fetch: async () => {
        const { data, error } = await client.from('study_state').select('data').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return (data?.data as AppState | undefined) ?? null;
      },
      push: async (state) => {
        const { error } = await client.from('study_state').upsert({ user_id: userId, data: state, updated_at: new Date().toISOString() });
        if (error) throw error;
      },
    };
  }

  private startLoop() {
    this.stop();
    void this.syncNow();
    this.timer = setInterval(() => void this.syncNow(), POLL_MS);
    if (this.client && this.userId) {
      this.channel = this.client
        .channel('study_state_' + this.userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'study_state', filter: `user_id=eq.${this.userId}` }, () => void this.syncNow())
        .subscribe();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = this.pushTimer = null;
    if (this.channel) void this.client?.removeChannel(this.channel);
    this.channel = null;
  }

  private schedulePush() {
    if (!this.userId) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.syncNow(), PUSH_DEBOUNCE_MS);
  }

  async syncNow(): Promise<void> {
    if (!this.client || !this.userId) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.setStatus('syncing');
    try {
      const merged = await syncOnce(this.store.get(), this.remote());
      this.applyingRemote = true;
      this.store.mergeIn(merged);
      this.applyingRemote = false;
      this.lastSyncedAt = Date.now();
      this.setStatus('synced');
    } catch (e) {
      this.applyingRemote = false;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.setStatus(offline ? 'offline' : 'error', e instanceof Error ? e.message : String(e));
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    }
  }
}
