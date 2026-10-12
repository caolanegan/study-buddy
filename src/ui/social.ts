// Leaderboard plumbing for the UI: a small backend facade over src/sync/leaderboard.ts
// (swappable for a fake in dev/tests) and the publisher that keeps my board row fresh.
import type { AppState } from '../core/types';
import { totalStudiedMs } from '../core/economy';
import * as lb from '../sync/leaderboard';
import type { BoardEntry, EntryRow } from '../sync/leaderboard';
import { rowSignature, shouldPublish, type PublishState } from './socialvm';
import type { Ctx } from './context';

export interface SocialBackend {
  /** Signed-in user id, or null. */
  userId(): string | null;
  /** Sync is configured at all (a Supabase project). */
  configured(): boolean;
  fetchFriends(codes: string[], now: number): Promise<BoardEntry[]>;
  fetchGlobal(now: number): Promise<BoardEntry[]>;
  lookupCode(code: string, now: number): Promise<BoardEntry | null>;
  publish(row: EntryRow): Promise<void>;
  unpublish(): Promise<void>;
}

declare global {
  interface Window {
    /** Dev-only: a fake backend for previews / browser tests (ignored in production builds). */
    __studyBuddySocialMock?: SocialBackend;
  }
}

export function socialBackend(ctx: Ctx): SocialBackend {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.__studyBuddySocialMock) return window.__studyBuddySocialMock;
  const need = () => {
    const s = ctx.cloud.session;
    if (!s) throw new Error('Not signed in');
    return s;
  };
  return {
    userId: () => ctx.cloud.session?.userId ?? null,
    configured: () => ctx.cloud.status !== 'disabled',
    fetchFriends: (codes, now) => {
      const s = need();
      return lb.fetchFriends(s.client, s.userId, codes, now);
    },
    fetchGlobal: (now) => {
      const s = need();
      return lb.fetchGlobal(s.client, s.userId, now);
    },
    lookupCode: (code, now) => lb.lookupCode(need().client, code, now),
    publish: (row) => lb.publish(need().client, row),
    unpublish: () => {
      const s = need();
      return lb.unpublish(s.client, s.userId);
    },
  };
}

/** My entry built from local state (live numbers). */
export function myEntry(state: AppState, userId: string, now: number): BoardEntry {
  const row = lb.buildRow(state, userId, totalStudiedMs(state, now), now);
  return { code: row.code, name: row.name, weekMs: row.week_ms, totalMs: row.total_ms, streak: row.streak, snapshot: row.snapshot, isMe: true, updatedAt: '' };
}

// ───────── publisher ─────────

const pub: PublishState & { error: string | null; busy: boolean; queued: boolean | null } = { lastSig: null, lastAt: 0, error: null, busy: false, queued: null };
let started: Ctx | null = null;
const listeners = new Set<() => void>();

export function publishError(): string | null {
  return pub.error;
}
export function onPublishChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((f) => f());

/** Publish my row now (force skips the 5-minute throttle but still skips unchanged rows). */
export async function publishNow(force = false): Promise<void> {
  const ctx = started;
  if (!ctx) return;
  const be = socialBackend(ctx);
  const state = ctx.store.get();
  const uid = be.userId();
  if (!uid || !state.settings.leaderboard) return;
  if (pub.busy) {
    pub.queued = (pub.queued ?? false) || force;
    return;
  }
  const now = ctx.now();
  const row = lb.buildRow(state, uid, totalStudiedMs(state, now), now);
  const sig = rowSignature(row);
  if (!shouldPublish(pub, sig, now, force)) return;
  pub.busy = true;
  try {
    await be.publish(row);
    markRow(true);
    pub.lastSig = sig;
    pub.lastAt = now;
    pub.error = null;
  } catch (e) {
    pub.error = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    pub.lastAt = now; // don't hammer a failing server
  } finally {
    pub.busy = false;
    emit();
    if (pub.queued !== null) {
      const f = pub.queued;
      pub.queued = null;
      void publishNow(f);
    }
  }
}

/** Remember whether a row of mine may exist on the server, so an opt-out that failed (offline) is retried later. */
const ROW_KEY = 'study-buddy:lb-row';
function markRow(exists: boolean) {
  try {
    if (exists) localStorage.setItem(ROW_KEY, '1');
    else localStorage.removeItem(ROW_KEY);
  } catch {
    /* ignore */
  }
}
function rowMayExist(): boolean {
  try {
    return localStorage.getItem(ROW_KEY) === '1';
  } catch {
    return false;
  }
}

/** If I've opted out but my row might still be up (a failed delete, reset…), delete it. Idempotent. */
export async function ensureUnpublished(): Promise<void> {
  const ctx = started;
  if (!ctx || ctx.store.get().settings.leaderboard || !rowMayExist()) return;
  await unpublishNow();
}

export async function unpublishNow(): Promise<void> {
  const ctx = started;
  if (!ctx) return;
  const be = socialBackend(ctx);
  if (!be.userId()) return;
  // don't let an in-flight publish land after the delete
  for (let i = 0; pub.busy && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  pub.queued = null;
  try {
    await be.unpublish();
    markRow(false);
    pub.lastSig = null;
    pub.error = null;
  } catch (e) {
    pub.error = e instanceof Error ? e.message : String(e);
  }
  emit();
}

/** Start keeping my leaderboard row up to date. Call once from main.ts. */
export function startSocial(ctx: Ctx): void {
  if (started) return;
  started = ctx;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void publishNow(true), 2000);
  };
  ctx.store.subscribe((s, prev) => {
    const on = s.settings.leaderboard;
    if (on !== prev.settings.leaderboard) {
      if (on) void publishNow(true);
      else void unpublishNow();
      return;
    }
    if (!on) return;
    if (s.settings.leaderboardPublic !== prev.settings.leaderboardPublic) return soon();
    // session ended / profile or room changed / friends changed my snapshot
    if (s.sessions.length !== prev.sessions.length || s.profile !== prev.profile || s.equipped !== prev.equipped) soon();
  });
  let wasSignedIn = !!socialBackend(ctx).userId();
  ctx.cloud.onChange(() => {
    const now = !!socialBackend(ctx).userId();
    if (now && !wasSignedIn) {
      if (ctx.store.get().settings.leaderboard) void publishNow(true);
      else void ensureUnpublished();
    }
    wasSignedIn = now;
  });
  // periodic refresh while the app is open (throttled to every 5 minutes inside publishNow)
  setInterval(() => {
    if (document.hidden) return;
    if (ctx.store.get().settings.leaderboard) void publishNow(false);
    else void ensureUnpublished();
  }, 60_000);
  void publishNow(true);
  void ensureUnpublished();
}
