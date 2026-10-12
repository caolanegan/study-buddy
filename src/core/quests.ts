// Daily & weekly quests: small, achievable goals that reward showing up.
// Progress is derived from sessions (plus the running one), so quests sync for free;
// claiming writes a Bonus with a deterministic id so it can't be claimed twice.
import type { AppState } from './types';
import { activeByDay, activeMs } from './session';
import { DAY_MS, HOUR, MIN, addDays, dayKey } from './time';
import { hash01 } from './weather';
import { claimBonus } from './actions';

export interface QuestDef {
  id: string;
  title: string;
  icon: string;
  reward: number;
  target: number;
  /** how progress is shown */
  unit: 'min' | 'count' | 'days' | 'h';
  progress(d: DayStats): number;
}

export interface QuestView {
  /** bonus id used for claiming (includes the date) */
  claimId: string;
  def: QuestDef;
  scope: 'daily' | 'weekly';
  progress: number;
  done: boolean;
  claimed: boolean;
}

/** Everything quests look at, for one day or one week. */
export interface DayStats {
  ms: number;
  sessions: number;
  pomodoros: number;
  longestMs: number;
  earlyMs: number; // studied in sessions that started before 09:00
  lateMs: number; // studied in sessions that started at/after 20:00
  goalMs: number;
  daysStudied: number; // weekly only: days with ≥ 15 min
}

const DAILY: QuestDef[] = [
  { id: 'study-30', title: 'Study for 30 minutes', icon: '📖', reward: 30, target: 30, unit: 'min', progress: (d) => d.ms / MIN },
  { id: 'study-45', title: 'Study for 45 minutes', icon: '📖', reward: 40, target: 45, unit: 'min', progress: (d) => d.ms / MIN },
  { id: 'study-60', title: 'Study for an hour', icon: '⏳', reward: 50, target: 60, unit: 'min', progress: (d) => d.ms / MIN },
  { id: 'study-90', title: 'Study for 90 minutes', icon: '🔥', reward: 75, target: 90, unit: 'min', progress: (d) => d.ms / MIN },
  { id: 'pomo-2', title: 'Finish 2 pomodoros', icon: '🍅', reward: 40, target: 2, unit: 'count', progress: (d) => d.pomodoros },
  { id: 'pomo-3', title: 'Finish 3 pomodoros', icon: '🍅', reward: 55, target: 3, unit: 'count', progress: (d) => d.pomodoros },
  { id: 'deep-45', title: 'One focused 45-minute session', icon: '🎯', reward: 45, target: 45, unit: 'min', progress: (d) => d.longestMs / MIN },
  { id: 'early', title: 'Study 15 min before 9am', icon: '🌅', reward: 40, target: 15, unit: 'min', progress: (d) => d.earlyMs / MIN },
  { id: 'evening', title: 'Study 20 min after 8pm', icon: '🌙', reward: 35, target: 20, unit: 'min', progress: (d) => d.lateMs / MIN },
  { id: 'twice', title: 'Study in 2 separate sessions', icon: '✌️', reward: 35, target: 2, unit: 'count', progress: (d) => d.sessions },
  { id: 'goal', title: 'Hit your daily goal', icon: '🏁', reward: 60, target: 1, unit: 'count', progress: (d) => (d.ms >= d.goalMs ? 1 : d.ms / d.goalMs) },
];

const WEEKLY: QuestDef[] = [
  { id: 'week-hours', title: 'Study 8 hours this week', icon: '🗓️', reward: 250, target: 8, unit: 'h', progress: (d) => d.ms / HOUR },
  { id: 'week-days', title: 'Study on 5 different days', icon: '📅', reward: 200, target: 5, unit: 'days', progress: (d) => d.daysStudied },
];

/** Monday 00:00 local of the week containing `now`. */
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/** e.g. "2026-W42" (week starting Monday, local time; label uses the Monday's date so it's stable). */
export function weekKey(now: number): string {
  return 'w' + dayKey(weekStart(now));
}

function statsFor(state: AppState, now: number, days: string[]): DayStats {
  const set = new Set(days);
  const perDay: Record<string, number> = {};
  const d: DayStats = { ms: 0, sessions: 0, pomodoros: 0, longestMs: 0, earlyMs: 0, lateMs: 0, goalMs: state.settings.dailyGoalMin * MIN, daysStudied: 0 };
  const consider = (start: number, byDay: Record<string, number>, ms: number, pomos: number) => {
    let inRange = 0;
    for (const [k, v] of Object.entries(byDay)) if (set.has(k)) {
      inRange += v;
      perDay[k] = (perDay[k] ?? 0) + v;
    }
    if (inRange <= 0) return;
    d.ms += inRange;
    d.sessions++;
    d.pomodoros += pomos;
    d.longestMs = Math.max(d.longestMs, Math.min(ms, inRange));
    const h = new Date(start).getHours();
    if (h < 9 && h >= 4) d.earlyMs += inRange;
    if (h >= 20) d.lateMs += inRange;
  };
  for (const s of state.sessions) consider(s.start, s.byDay, s.activeMs, s.pomodoros);
  if (state.active) consider(state.active.startedAt, activeByDay(state.active, now), activeMs(state.active, now), state.active.pomodoro?.completed ?? 0);
  d.daysStudied = Object.values(perDay).filter((v) => v >= 15 * MIN).length;
  return d;
}

/** Three quests per calendar day, chosen deterministically from the date (same on every device). */
export function dailyQuestDefs(now: number): QuestDef[] {
  const key = dayKey(now);
  const seed = [...key].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  // always one "study N minutes" quest, plus two different others
  const studyQs = DAILY.filter((q) => q.id.startsWith('study-'));
  const others = DAILY.filter((q) => !q.id.startsWith('study-'));
  const first = studyQs[Math.floor(hash01(seed) * studyQs.length)];
  const pool = [...others];
  const picked: QuestDef[] = [first];
  for (let i = 0; i < 2 && pool.length; i++) {
    const j = Math.floor(hash01(seed + 101 * (i + 1)) * pool.length);
    picked.push(pool.splice(j, 1)[0]);
  }
  return picked;
}

function view(state: AppState, def: QuestDef, scope: 'daily' | 'weekly', claimId: string, stats: DayStats): QuestView {
  const progress = Math.max(0, def.progress(stats));
  const claimed = state.bonuses.some((b) => b.id === claimId);
  return { claimId, def, scope, progress: Math.min(progress, def.target), done: progress >= def.target, claimed };
}

export function dailyQuests(state: AppState, now: number): QuestView[] {
  const key = dayKey(now);
  const stats = statsFor(state, now, [key]);
  return dailyQuestDefs(now).map((def) => view(state, def, 'daily', `quest:${key}:${def.id}`, stats));
}

export function weeklyQuests(state: AppState, now: number): QuestView[] {
  const start = weekStart(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(dayKey(start + 12 * HOUR), i));
  const stats = statsFor(state, now, days);
  const wk = weekKey(now);
  return WEEKLY.map((def) => view(state, def, 'weekly', `quest:${wk}:${def.id}`, stats));
}

export function allQuests(state: AppState, now: number): QuestView[] {
  return [...dailyQuests(state, now), ...weeklyQuests(state, now)];
}

/** Quests finished but not yet claimed (for a badge). */
export function claimableCount(state: AppState, now: number): number {
  return allQuests(state, now).filter((q) => q.done && !q.claimed).length;
}

export function claimQuest(state: AppState, q: QuestView, now: number): { state: AppState; claimed: boolean } {
  if (!q.done) return { state, claimed: false };
  return claimBonus(state, { id: q.claimId, kind: 'quest', reward: q.def.reward, label: q.def.title }, now);
}

/** Time until the daily quests refresh (next local midnight). */
export function msUntilReset(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return Math.max(0, d.getTime() - now);
}

export const _test = { statsFor, DAILY, WEEKLY, DAY_MS };
