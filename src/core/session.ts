import type { ActiveSession, Settings } from './types';
import { MIN, splitByDay, uid } from './time';

/** "Still studying?" prompt after this much active time without interaction. */
export const CHECK_AFTER_MS = 60 * MIN;
/** If the prompt goes unanswered this long, the session auto-pauses at the prompt time. */
export const CHECK_GRACE_MS = 5 * MIN;
/** Every Nth completed pomodoro earns the long break. */
export const LONG_BREAK_EVERY = 4;

export type SessionEvent =
  | { kind: 'check'; at: number }
  | { kind: 'autopause'; at: number }
  | { kind: 'break'; at: number; long: boolean }
  | { kind: 'work'; at: number };

export function isRunning(a: ActiveSession): boolean {
  const last = a.segments[a.segments.length - 1];
  return !!last && last.end === null;
}

export function isOnBreak(a: ActiveSession): boolean {
  return !!a.pomodoro && a.pomodoro.phase === 'break';
}

export function activeMs(a: ActiveSession, now: number): number {
  return a.segments.reduce((sum, s) => sum + Math.max(0, (s.end ?? now) - s.start), 0);
}

export function activeByDay(a: ActiveSession, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of a.segments) splitByDay(s.start, s.end ?? now, out);
  return out;
}

/** Wall-clock time at which the session's active time reaches `target` (projecting the running segment forward). */
export function wallTimeAtActive(a: ActiveSession, target: number): number | null {
  let acc = 0;
  for (const s of a.segments) {
    const len = s.end === null ? Infinity : s.end - s.start;
    if (acc + len >= target) return s.start + (target - acc);
    acc += len;
  }
  return null;
}

function workMs(settings: Settings) {
  return settings.pomodoroWorkMin * MIN;
}

export function startSession(now: number, settings: Settings, pomodoro: boolean): ActiveSession {
  return {
    id: uid(),
    startedAt: now,
    segments: [{ start: now, end: null }],
    confirmedAtActiveMs: 0,
    checkPendingSince: null,
    autoPaused: false,
    pomodoro: pomodoro ? { phase: 'work', phaseEndsAt: now + workMs(settings), completed: 0, pausedRemaining: null } : null,
    updatedAt: now,
  };
}

export function pauseSession(a: ActiveSession, now: number): ActiveSession {
  if (!isRunning(a)) return a;
  const segments = a.segments.map((s, i) => (i === a.segments.length - 1 ? { ...s, end: now } : s));
  const pomodoro = a.pomodoro && a.pomodoro.phase === 'work' ? { ...a.pomodoro, pausedRemaining: Math.max(0, a.pomodoro.phaseEndsAt - now) } : a.pomodoro;
  return { ...a, segments, pomodoro, checkPendingSince: null, confirmedAtActiveMs: activeMs({ ...a, segments }, now), updatedAt: now };
}

/** Resume from a manual pause, an auto-pause, or skip the current pomodoro break. */
export function resumeSession(a: ActiveSession, now: number, settings: Settings): ActiveSession {
  if (isRunning(a)) return a;
  let pomodoro = a.pomodoro;
  if (pomodoro) {
    const remaining = pomodoro.phase === 'work' && pomodoro.pausedRemaining ? pomodoro.pausedRemaining : workMs(settings);
    pomodoro = { ...pomodoro, phase: 'work', phaseEndsAt: now + remaining, pausedRemaining: null };
  }
  return {
    ...a,
    segments: [...a.segments, { start: now, end: null }],
    pomodoro,
    checkPendingSince: null,
    autoPaused: false,
    confirmedAtActiveMs: activeMs(a, now),
    updatedAt: now,
  };
}

export function confirmStillStudying(a: ActiveSession, now: number): ActiveSession {
  return { ...a, checkPendingSince: null, confirmedAtActiveMs: activeMs(a, now), updatedAt: now };
}

/** Drop all active time after wall-clock `cut`. */
function truncateAt(a: ActiveSession, cut: number): ActiveSession {
  const segments = a.segments
    .filter((s) => s.start < cut)
    .map((s) => ({ start: s.start, end: Math.min(s.end ?? Infinity, cut) }))
    .filter((s) => s.end > s.start);
  return { ...a, segments };
}

/**
 * Advance time-driven transitions (pomodoro phases, still-studying check,
 * auto-pause) up to `now`, in chronological order. Safe to call with large
 * gaps (e.g. app reopened hours later).
 */
export function tickSession(a: ActiveSession, now: number, settings: Settings): { active: ActiveSession; events: SessionEvent[] } {
  const events: SessionEvent[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const cands: { at: number; kind: 'pomo' | 'check' | 'autopause' }[] = [];
    const running = isRunning(a);
    const p = a.pomodoro;
    if (p && p.pausedRemaining === null && (p.phase === 'break' || running)) cands.push({ at: p.phaseEndsAt, kind: 'pomo' });
    if (running) {
      if (a.checkPendingSince === null) {
        const at = wallTimeAtActive(a, a.confirmedAtActiveMs + CHECK_AFTER_MS);
        if (at !== null) cands.push({ at, kind: 'check' });
      }
    }
    if (a.checkPendingSince !== null) cands.push({ at: a.checkPendingSince + CHECK_GRACE_MS, kind: 'autopause' });
    const next = cands.filter((c) => c.at <= now).sort((x, y) => x.at - y.at)[0];
    if (!next) break;

    if (next.kind === 'check') {
      a = { ...a, checkPendingSince: next.at, updatedAt: next.at };
      events.push({ kind: 'check', at: next.at });
    } else if (next.kind === 'autopause') {
      const cut = a.checkPendingSince!;
      a = truncateAt(a, cut);
      a = {
        ...a,
        checkPendingSince: null,
        autoPaused: true,
        confirmedAtActiveMs: activeMs(a, cut),
        pomodoro: a.pomodoro ? { ...a.pomodoro, phase: 'work', phaseEndsAt: 0, pausedRemaining: workMs(settings) } : null,
        updatedAt: next.at,
      };
      events.push({ kind: 'autopause', at: cut });
    } else if (p!.phase === 'work') {
      const completed = p!.completed + 1;
      const long = completed % LONG_BREAK_EVERY === 0;
      const segments = a.segments.map((s, i) => (i === a.segments.length - 1 ? { ...s, end: next.at } : s));
      const brk = (long ? settings.pomodoroLongBreakMin : settings.pomodoroBreakMin) * MIN;
      a = { ...a, segments, pomodoro: { phase: 'break', phaseEndsAt: next.at + brk, completed, pausedRemaining: null }, updatedAt: next.at };
      events.push({ kind: 'break', at: next.at, long });
    } else {
      a = {
        ...a,
        segments: [...a.segments, { start: next.at, end: null }],
        pomodoro: { ...p!, phase: 'work', phaseEndsAt: next.at + workMs(settings), pausedRemaining: null },
        updatedAt: next.at,
      };
      events.push({ kind: 'work', at: next.at });
    }
  }
  return { active: a, events };
}
