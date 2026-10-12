import type { AppState } from './types';
import { MIN, addDays, dayKey } from './time';
import { activeMs, activeByDay } from './session';
import { ACHIEVEMENTS } from './achievements';

export const COINS_PER_HOUR = 100;
/** Minimum study on a calendar day for it to count towards the streak. */
export const STREAK_MIN_MS = 30 * MIN;
export const STREAK_STEP = 0.1;
export const MAX_MULTIPLIER = 2;

/** Active ms per local day across finished sessions (and the running one if `now` is given). */
export function dailyTotals(state: AppState, now?: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of state.sessions) for (const [k, v] of Object.entries(s.byDay)) out[k] = (out[k] ?? 0) + v;
  if (now !== undefined && state.active) {
    for (const [k, v] of Object.entries(activeByDay(state.active, now))) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export interface StreakInfo {
  current: number;
  best: number;
  todayCounts: boolean;
}

/**
 * Current streak = consecutive qualifying days ending today (if today already
 * qualifies) or yesterday (today still has time to keep it alive).
 */
export function streakInfo(daily: Record<string, number>, now: number): StreakInfo {
  const today = dayKey(now);
  const ok = (k: string) => (daily[k] ?? 0) >= STREAK_MIN_MS;
  const todayCounts = ok(today);
  let current = 0;
  let k = todayCounts ? today : addDays(today, -1);
  while (ok(k)) {
    current++;
    k = addDays(k, -1);
  }
  // best streak across history
  const days = Object.keys(daily).filter(ok).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current), todayCounts };
}

export function multiplierFor(streakDays: number): number {
  return Math.min(MAX_MULTIPLIER, Math.round((1 + STREAK_STEP * streakDays) * 100) / 100);
}

/** Coins for an amount of active study time at a given multiplier (credited per whole minute). */
export function coinsFor(ms: number, multiplier: number): number {
  const minutes = Math.floor(ms / MIN);
  return Math.floor((minutes * COINS_PER_HOUR * multiplier) / 60);
}

export function totalStudiedMs(state: AppState, now?: number): number {
  let t = state.sessions.reduce((a, s) => a + s.activeMs, 0);
  if (now !== undefined && state.active) t += activeMs(state.active, now);
  return t;
}

export function balance(state: AppState): number {
  const earned = state.sessions.reduce((a, s) => a + s.coins, 0);
  const rewards = Object.keys(state.achievements).reduce((a, id) => a + (ACHIEVEMENTS.find((x) => x.id === id)?.reward ?? 0), 0);
  const spent = state.purchases.reduce((a, p) => a + p.price, 0);
  return earned + rewards - spent;
}

export function lifetimeCoins(state: AppState): number {
  return balance(state) + state.purchases.reduce((a, p) => a + p.price, 0);
}
