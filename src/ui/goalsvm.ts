// Pure view-model for the Goals tab, shop limited-time badges, subjects/journal and
// sim milestones. No DOM here so it can be unit-tested (tests/ui-goals.test.ts).
import type { Session } from '../core/types';
import type { QuestView } from '../core/quests';
import type { Achievement, Stats } from '../core/achievements';
import { ITEMS, daysLeft, isAvailable, nextAvailable, type Item } from '../core/catalog';
import { simTime, type SeasonName } from '../core/sim';
import { DAY_MS, HOUR, MIN } from '../core/time';
import { formatShort } from './format';

// ───────── quests ─────────

export type QuestState = 'progress' | 'ready' | 'claimed';

export interface QuestCard {
  id: string;
  icon: string;
  title: string;
  /** e.g. "32/45 min", "1/2 pomodoros", "68%" */
  progressText: string;
  /** 0..1 */
  pct: number;
  reward: string;
  state: QuestState;
}

const COUNT_NOUN: Record<string, [string, string]> = {
  'pomo-2': ['pomodoro', 'pomodoros'],
  'pomo-3': ['pomodoro', 'pomodoros'],
  twice: ['session', 'sessions'],
};

export function questProgressText(q: QuestView): string {
  const { def } = q;
  const p = q.progress;
  switch (def.unit) {
    case 'min':
      return `${Math.floor(p)}/${def.target} min`;
    case 'h':
      return `${(Math.floor(p * 10) / 10).toFixed(1).replace(/\.0$/, '')}/${def.target} h`;
    case 'days':
      return `${Math.floor(p)}/${def.target} days`;
    default: {
      if (def.target === 1) return q.done ? 'Done' : `${Math.floor(p * 100)}%`;
      const noun = COUNT_NOUN[def.id];
      return `${Math.floor(p)}/${def.target}${noun ? ' ' + noun[1] : ''}`;
    }
  }
}

export function questCard(q: QuestView): QuestCard {
  return {
    id: q.claimId,
    icon: q.def.icon,
    title: q.def.title,
    progressText: questProgressText(q),
    pct: Math.max(0, Math.min(1, q.progress / q.def.target)),
    reward: `+${q.def.reward} 🪙`,
    state: q.claimed ? 'claimed' : q.done ? 'ready' : 'progress',
  };
}

/** "5h 12m", "12m", "under a minute"; adds days for weekly resets ("3d 4h"). */
export function formatResetIn(ms: number): string {
  if (ms < MIN) return 'under a minute';
  if (ms >= DAY_MS) {
    const d = Math.floor(ms / DAY_MS);
    const h = Math.floor((ms % DAY_MS) / HOUR);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  return formatShort(ms);
}

/** Time until next Monday 00:00 local. */
export function msUntilWeekReset(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() + (7 - dow));
  return Math.max(0, d.getTime() - now);
}

export interface NextQuestLine {
  text: string;
  ready: boolean;
}

/** One-line nudge for the room panel: claimable reward first, else the closest unfinished daily quest. */
export function nextQuestLine(daily: QuestView[]): NextQuestLine | null {
  if (!daily.length) return null;
  const ready = daily.filter((q) => q.done && !q.claimed);
  if (ready.length) {
    const coins = ready.reduce((t, q) => t + q.def.reward, 0);
    return { text: `🎁 ${ready.length > 1 ? `${ready.length} quests` : 'Quest'} complete — claim +${coins} 🪙`, ready: true };
  }
  const open = daily.filter((q) => !q.done);
  if (!open.length) return { text: '✓ All of today’s quests done — see you tomorrow!', ready: false };
  const best = [...open].sort((a, b) => b.progress / b.def.target - a.progress / a.def.target)[0];
  return { text: `${best.def.icon} Next: ${best.def.title} · ${questProgressText(best)}`, ready: false };
}

// ───────── achievements ─────────

export interface AchProgress {
  cur: number;
  target: number;
  pct: number;
  text: string;
}

/** Progress towards a locked achievement, when it's a countable goal. */
export function achievementProgress(a: Achievement, s: Stats): AchProgress | null {
  const mk = (cur: number, target: number, unit = '', dec = 0): AchProgress => {
    const c = Math.min(cur, target);
    const shown = dec ? (Math.floor(c * 10 ** dec) / 10 ** dec).toFixed(dec).replace(/\.0+$/, '') : String(Math.floor(c));
    return { cur: c, target, pct: Math.max(0, Math.min(1, cur / target)), text: `${shown}/${target}${unit ? ' ' + unit : ''}` };
  };
  const m = /^(hours|streak|pomodoro|quest)-(\d+)$/.exec(a.id);
  if (m) {
    const n = Number(m[2]);
    if (m[1] === 'hours') return mk(s.totalMs / HOUR, n, 'h', 1);
    if (m[1] === 'streak') return mk(s.bestStreak, n, 'days');
    if (m[1] === 'pomodoro') return mk(s.pomodoros, n);
    return mk(s.questsDone, n, 'quests');
  }
  switch (a.id) {
    case 'first-session':
      return mk(s.sessions, 1);
    case 'marathon':
      return mk(s.longestMs / HOUR, 3, 'h', 1);
    case 'big-day':
      return mk(s.dailyMaxMs / HOUR, 6, 'h', 1);
    case 'star-catcher':
      return mk(s.starsCaught, 3, 'caught');
    case 'pen-pal':
      return mk(s.lettersOpened, 7, 'letters');
    case 'study-pal':
      return mk(s.friends, 1, 'friend');
    case 'polymath':
      return mk(s.subjects, 3, 'subjects');
    case 'first-purchase':
      return mk(s.purchases, 1);
    case 'collector':
      return mk(s.purchases, 10, 'items');
    default:
      return null;
  }
}

// ───────── limited-time shop ─────────

/** "Last day!", "1 day left", "12 days left" — or null if not a limited item in its window. */
export function limitedBadge(item: Item, now: number): string | null {
  const d = daysLeft(item, now);
  if (d === null) return null;
  return d <= 0 ? 'Last day!' : d === 1 ? '1 day left' : `${d} days left`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Returns in December" for a limited item outside its window. */
export function returnsLabel(item: Item, now: number): string | null {
  if (!item.limited || isAvailable(item, now)) return null;
  const next = nextAvailable(item, now);
  return next === null ? null : `Returns in ${MONTHS[new Date(next).getMonth()]}`;
}

export interface LimitedEvent {
  event: string;
  items: Item[];
  /** days left (min over the event's items) while live */
  daysLeft: number | null;
  /** start (local midnight) for upcoming events */
  from: number | null;
}

/** Limited events live right now (items in their window). */
export function liveEvents(now: number, items: Item[] = ITEMS): LimitedEvent[] {
  const map = new Map<string, LimitedEvent>();
  for (const it of items) {
    if (!it.limited || !isAvailable(it, now)) continue;
    const ev = map.get(it.limited.event) ?? { event: it.limited.event, items: [], daysLeft: null, from: null };
    ev.items.push(it);
    const d = daysLeft(it, now);
    if (d !== null) ev.daysLeft = ev.daysLeft === null ? d : Math.min(ev.daysLeft, d);
    map.set(ev.event, ev);
  }
  return [...map.values()];
}

/** The next limited event that isn't live yet. */
export function comingUp(now: number, items: Item[] = ITEMS): LimitedEvent | null {
  let best: LimitedEvent | null = null;
  for (const it of items) {
    if (!it.limited || isAvailable(it, now)) continue;
    const from = nextAvailable(it, now)!;
    if (!best || from < best.from!) best = { event: it.limited.event, items: [it], daysLeft: null, from };
    else if (best.event === it.limited.event && from === best.from) best.items.push(it);
  }
  return best;
}

const EVENT_ICONS: Record<string, string> = {
  Halloween: '🎃',
  Harvest: '🍂',
  'Winter festival': '🎄',
  'Lunar New Year': '🏮',
  'Valentine’s': '💖',
  'Spring bloom': '🌷',
  Summer: '☀️',
  'Back to school': '🎒',
};
export function eventIcon(event: string): string {
  return EVENT_ICONS[event] ?? '✨';
}

export function formatEventDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** Shop list for a regular category: hides limited items outside their window unless already owned. */
export function visibleInCategory(item: Item, owned: boolean, now: number): boolean {
  return !item.limited || owned || isAvailable(item, now);
}

// ───────── subjects & journal ─────────

export interface SubjectTotal {
  name: string;
  ms: number;
  sessions: number;
  color: string;
}

const SUBJECT_COLORS = ['#f2b134', '#5fbf77', '#6fa8dc', '#e0745c', '#b096d6', '#57b5b3', '#e07aa5', '#d9b062'];

export function subjectColor(name: string): string {
  const k = name.trim().toLowerCase();
  let h = 7;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length];
}

/** Most recently used subjects (newest first, case-insensitive unique). */
export function recentSubjects(sessions: Session[], n = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...sessions].sort((a, b) => b.end - a.end)) {
    const name = s.subject?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= n) break;
  }
  return out;
}

/** Study time per subject (sessions ending at/after `since`, or all when null). */
export function subjectTotals(sessions: Session[], since: number | null): { subjects: SubjectTotal[]; untaggedMs: number } {
  const map = new Map<string, SubjectTotal & { last: number }>();
  let untaggedMs = 0;
  for (const s of sessions) {
    if (since !== null && s.end < since) continue;
    const name = s.subject?.trim();
    if (!name) {
      untaggedMs += s.activeMs;
      continue;
    }
    const k = name.toLowerCase();
    const cur = map.get(k) ?? { name, ms: 0, sessions: 0, color: subjectColor(name), last: 0 };
    cur.ms += s.activeMs;
    cur.sessions++;
    if (s.end > cur.last) {
      cur.last = s.end;
      cur.name = name; // newest spelling wins
    }
    map.set(k, cur);
  }
  const subjects = [...map.values()].sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name)).map(({ last: _l, ...rest }) => rest);
  return { subjects, untaggedMs };
}

// ───────── sim milestones ─────────

export interface Milestone {
  kind: 'day' | 'season' | 'year' | 'hours';
  icon: string;
  text: string;
  big: boolean;
}

const SEASON_ICON: Record<SeasonName, string> = { Spring: '🌸', Summer: '🌻', Autumn: '🍂', Winter: '❄️' };

/**
 * What to celebrate when total study time moves from `prevMs` to `ms` while studying.
 * Only single-step transitions count (a big jump from sync/import isn't "live").
 */
export function simMilestone(prevMs: number, ms: number): Milestone | null {
  if (ms <= prevMs) return null;
  const a = simTime(prevMs);
  const b = simTime(ms);
  if (b.day !== a.day + 1) return null;
  const hours = Math.floor(ms / HOUR);
  if (b.year !== a.year) return { kind: 'year', icon: '🎆', text: `Year ${b.year}! ${hours} hours studied — happy new year in the room`, big: true };
  if (b.season !== a.season) return { kind: 'season', icon: SEASON_ICON[b.seasonName], text: `${b.seasonName} has arrived! · ${hours} hours studied`, big: true };
  return { kind: 'day', icon: '☀️', text: `Day ${b.day} begins`, big: false };
}

/** Every-10-hours milestone crossed by a (non-live) change, e.g. a manual session. */
export function hoursMilestone(prevMs: number, ms: number, every = 10): Milestone | null {
  const a = Math.floor(prevMs / (every * HOUR));
  const b = Math.floor(ms / (every * HOUR));
  if (b !== a + 1) return null;
  return { kind: 'hours', icon: '🎉', text: `${b * every} hours studied in total!`, big: true };
}
