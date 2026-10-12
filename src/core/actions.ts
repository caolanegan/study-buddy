import type { AppState, Bonus, Session, Settings } from './types';
import { ACHIEVEMENTS, computeStats } from './achievements';
import { balance, coinsFor, dailyTotals, multiplierFor, streakInfo } from './economy';
import { isAvailable, itemById, slotOf } from './catalog';
import { MIN, splitByDay, uid } from './time';
import { DEFAULT_PROFILE, normalizeProfile, type Profile } from './profile';
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
  typing: true,
  ambience: true,
  volume: 0.6,
  pomodoroWorkMin: 25,
  pomodoroBreakMin: 5,
  pomodoroLongBreakMin: 15,
  dailyGoalMin: 120,
  bubbles: true,
  leaderboard: false,
  leaderboardPublic: false,
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
    profile: structuredClone(DEFAULT_PROFILE),
    profileUpdatedAt: 0,
    bonuses: [],
    friends: [],
    friendsUpdatedAt: 0,
  };
}

/** Fill in missing fields from older saves. */
export function normalize(raw: Partial<AppState> | null | undefined): AppState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const merged = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) }, version: 1 as const };
  merged.profile = normalizeProfile(raw.profile);
  if (!Array.isArray(merged.bonuses)) merged.bonuses = [];
  if (!Array.isArray(merged.friends)) merged.friends = [];
  // people who studied before profiles existed already know the app — skip the intro
  if (!raw.profile && (raw.sessions?.length ?? 0) > 0) merged.profile.onboarded = true;
  return merged;
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

export type BuyError = 'unknown' | 'owned' | 'funds' | 'requires' | 'locked' | 'expired';

export function canBuy(state: AppState, itemId: string, now = Date.now()): BuyError | null {
  const item = itemById(itemId);
  if (!item) return 'unknown';
  if (owns(state, itemId)) return 'owned';
  if (item.achievement) return 'locked';
  if (!isAvailable(item, now)) return 'expired';
  if (item.requires && !owns(state, item.requires)) return 'requires';
  if (balance(state) < item.price) return 'funds';
  return null;
}

export function buy(state: AppState, itemId: string, now: number): { state: AppState; error: BuyError | null; unlocked: string[] } {
  const error = canBuy(state, itemId, now);
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

export function updateProfile(state: AppState, patch: Partial<Profile>, now: number): AppState {
  return { ...state, profile: normalizeProfile({ ...state.profile, ...patch }), profileUpdatedAt: now };
}

/** Grant a one-off reward. No-op if this id was already claimed (on any device). */
export function claimBonus(state: AppState, bonus: Omit<Bonus, 'at'>, now: number): { state: AppState; claimed: boolean } {
  if (state.bonuses.some((b) => b.id === bonus.id)) return { state, claimed: false };
  return { state: { ...state, bonuses: [...state.bonuses, { ...bonus, at: now }] }, claimed: true };
}

export function hasBonus(state: AppState, id: string): boolean {
  return state.bonuses.some((b) => b.id === id);
}

/** Attach a subject / note to a finished session (only right after it ends, before it syncs elsewhere). */
export function annotateSession(state: AppState, id: string, patch: { subject?: string; note?: string }): AppState {
  const clean = {
    subject: patch.subject?.trim().slice(0, 40) || undefined,
    note: patch.note?.trim().slice(0, 500) || undefined,
  };
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...clean } : s)) };
}

export function addFriend(state: AppState, code: string, name: string, now: number): AppState {
  const c = code.trim().toUpperCase();
  if (!c || state.friends.some((f) => f.code === c)) return state;
  return { ...state, friends: [...state.friends, { code: c, name: name.slice(0, 24), addedAt: now }], friendsUpdatedAt: now };
}

export function removeFriend(state: AppState, code: string, now: number): AppState {
  return { ...state, friends: state.friends.filter((f) => f.code !== code), friendsUpdatedAt: now };
}

// re-exported for convenience
export { balance };
