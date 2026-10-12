import type { AppState } from '../core/types';
import { normalize } from '../core/actions';
import { mergeStates, sameState } from '../core/merge';

export const STORAGE_KEY = 'study-buddy:v1';

type Listener = (s: AppState, prev: AppState) => void;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Local-first state container persisted to localStorage. */
export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private storage: Storage | null;

  constructor(storage: Storage | null = safeStorage()) {
    this.storage = storage;
    this.state = this.load();
    if (typeof window !== 'undefined') {
      // another tab changed the state
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) this.mergeIn(this.load());
      });
    }
  }

  private load(): AppState {
    let raw: string | null | undefined = null;
    try {
      raw = this.storage?.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch {
      // Unreadable save: keep a copy before the next write replaces it, so it can still be recovered.
      try {
        if (raw) this.storage?.setItem(`${STORAGE_KEY}:unreadable`, raw);
      } catch {
        /* storage full */
      }
      return normalize(null);
    }
  }

  get(): AppState {
    return this.state;
  }

  set(next: AppState | ((s: AppState) => AppState)): void {
    const prev = this.state;
    const value = typeof next === 'function' ? next(prev) : next;
    if (value === prev) return;
    this.state = value;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* storage full / private mode: keep in memory */
    }
    for (const l of this.listeners) l(value, prev);
  }

  /** Merge another copy of the state (cloud, other tab, import). */
  mergeIn(other: AppState): void {
    const merged = mergeStates(this.state, normalize(other));
    if (!sameState(merged, this.state)) this.set(merged);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
