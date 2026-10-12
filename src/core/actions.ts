import type { AppState, Session, Settings } from './types';
import { ACHIEVEMENTS, computeStats } from './achievements';
import { balance, coinsFor, dailyTotals, multiplierFor, streakInfo } from './economy';
import { itemById, slotOf } from './catalog';
import { MIN, splitByDay, uid } from './time';
import {
  activeByDay,
  activeMs,
  confirmStillStudying,
  pauseSession,
  resumeSession,
  startSession,
  tickSession,
  type SessionEvent,
} from './session';

/** Sessions shorter than this are discarded on end. */
export const MIN_SESSION_MS = MIN;

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  volume: 0.6,
  pomodoroWorkMin: 25,
  pomodoroBreakMin: 5,
  pomodoroLongBreakMin: 15,
  dailyGoalMin: 120,
};

export function defaultState(): AppState {
  return {
    version: 1,
    sessions: [],
    purchases: [],
    achievements: {},
    active: null,
    equipped: {},
    equippedUpdatedAt: 0,
    settings: { ...DEFAULT_SETTINGS },
    settingsUpdatedAt: 0,
    deletedSessions: [],
  };
}

/** Fill in missing fields from older saves. */
export function normalize(raw: Partial<AppState> | null | undefined): AppState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) }, version: 1 };
}

export function evaluateAchievements(state: AppState, now: number): { state: AppState; unlocked: string[] } {
  const best = streakInfo(dailyTotals(state), now).best;
  const stats = computeStats(state, best);
  const unlocked = ACHIEVEMENTS.filter((a) => !state.achievements[a.id] && a.test(stats)).map((a) => a.id);
  if (!unlocked.length) return { state, unlocked };
  const achievements = { ...state.achievements };
  for (const id of unlocked) achievements[id] = now;
  return { state: { ...state, achievements }, unlocked };
}

export function start(state: AppState, now: number, pomodoro = false): AppState {
  if (state.active) return state;
  return { ...state, active: startSession(now, state.settings, pomodoro) };
}

export function pause(state: AppState, now: number): AppState {
  return state.active ? { ...state, active: pauseSession(state.active, now) } : state;
}

export function resume(state: AppState, now: number): AppState {
  return state.active ? { ...state, active: resumeSession(state.active, now, state.settings) } : state;
}

export function confirm(state: AppState, now: number): AppState {
  return state.active ? { ...state, active: confirmStillStudying(state.active, now) } : state;
}

export function tick(state: AppState, now: number): { state: AppState; events: SessionEvent[] } {
  if (!state.active) return { state, events: [] };
  const { active, events } = tickSession(state.active, now, state.settings);
  return { state: events.length ? { ...state, active } : state, events };
}

export interface EndResult {
  state: AppState;
  session: Session | null;
  unlocked: string[];
}

export function end(state: AppState, now: number): EndResult {
  const a = state.active;
  if (!a) return { state, session: null, unlocked: [] };
  const ms = activeMs(a, now);
  const base: AppState = { ...state, active: null };
  // tombstone discarded sessions so another device's copy of `active` isn't resurrected by sync
  if (ms < MIN_SESSION_MS) return { state: { ...base, deletedSessions: [...base.deletedSessions, a.id] }, session: null, unlocked: [] };
  const byDay = activeByDay(a, now);
  // streak including this session
  const daily = dailyTotals(base);
  for (const [k, v] of Object.entries(byDay)) daily[k] = (daily[k] ?? 0) + v;
  const multiplier = multiplierFor(streakInfo(daily, now).current);
  const lastEnd = a.segments.reduce((m, s) => Math.max(m, s.end ?? now), a.startedAt);
  const session: Session = {
    id: a.id,
    start: a.startedAt,
    end: lastEnd,
    activeMs: ms,
    multiplier,
    coins: coinsFor(ms, multiplier),
    pomodoros: a.pomodoro?.completed ?? 0,
    byDay,
  };
  const withSession = { ...base, sessions: [...base.sessions, session] };
  const ev = evaluateAchievements(withSession, now);
  return { state: ev.state, session, unlocked: ev.unlocked };
}

/** Log a session after the fact (earns base coins, no streak multiplier). */
export function addManualSession(state: AppState, startTs: number, durationMs: number, now: number): EndResult {
  if (durationMs < MIN_SESSION_MS || startTs + durationMs > now) return { state, session: null, unlocked: [] };
  const session: Session = {
    id: uid(),
    start: startTs,
    end: startTs + durationMs,
    activeMs: durationMs,
    multiplier: 1,
    coins: coinsFor(durationMs, 1),
    pomodoros: 0,
    manual: true,
    byDay: splitByDay(startTs, startTs + durationMs),
  };
  const ev = evaluateAchievements({ ...state, sessions: [...state.sessions, session] }, now);
  return { state: ev.state, session, unlocked: ev.unlocked };
}

export function deleteSession(state: AppState, id: string): AppState {
  return {
    ...state,
    sessions: state.sessions.filter((s) => s.id !== id),
    deletedSessions: state.deletedSessions.includes(id) ? state.deletedSessions : [...state.deletedSessions, id],
  };
}

export function owns(state: AppState, itemId: string): boolean {
  const item = itemById(itemId);
  if (item?.achievement) return !!state.achievements[item.achievement];
  return state.purchases.some((p) => p.itemId === itemId);
}

export type BuyError = 'unknown' | 'owned' | 'funds' | 'requires' | 'locked';

export function canBuy(state: AppState, itemId: string): BuyError | null {
  const item = itemById(itemId);
  if (!item) return 'unknown';
  if (owns(state, itemId)) return 'owned';
  if (item.achievement) return 'locked';
  if (item.requires && !owns(state, item.requires)) return 'requires';
  if (balance(state) < item.price) return 'funds';
  return null;
}

export function buy(state: AppState, itemId: string, now: number): { state: AppState; error: BuyError | null; unlocked: string[] } {
  const error = canBuy(state, itemId);
  if (error) return { state, error, unlocked: [] };
  const item = itemById(itemId)!;
  const next = equip({ ...state, purchases: [...state.purchases, { id: uid(), itemId, price: item.price, at: now }] }, itemId, now);
  const ev = evaluateAchievements(next, now);
  return { state: ev.state, error: null, unlocked: ev.unlocked };
}

export function isEquipped(state: AppState, itemId: string): boolean {
  const item = itemById(itemId);
  return !!item && state.equipped[slotOf(item)] === itemId;
}

export function equip(state: AppState, itemId: string, now: number): AppState {
  const item = itemById(itemId);
  if (!item) return state;
  return { ...state, equipped: { ...state.equipped, [slotOf(item)]: itemId }, equippedUpdatedAt: now };
}

export function unequip(state: AppState, itemId: string, now: number): AppState {
  const item = itemById(itemId);
  if (!item || state.equipped[slotOf(item)] !== itemId) return state;
  const equipped = { ...state.equipped };
  delete equipped[slotOf(item)];
  return { ...state, equipped, equippedUpdatedAt: now };
}

/** Item ids currently shown in the room. */
export function equippedItems(state: AppState): Set<string> {
  return new Set(Object.values(state.equipped).filter((id) => owns(state, id)));
}

export function updateSettings(state: AppState, patch: Partial<Settings>, now: number): AppState {
  return { ...state, settings: { ...state.settings, ...patch }, settingsUpdatedAt: now };
}

// re-exported for convenience
export { balance };
