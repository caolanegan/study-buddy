// Pure view-model for the Friends tab and leaderboard publishing (unit-tested in tests/ui-goals.test.ts).
import type { BoardEntry, EntryRow } from '../sync/leaderboard';
import type { Friend } from '../core/types';
import { HOUR, MIN } from '../core/time';

export type BoardMode = 'friends-week' | 'friends-all' | 'global-week';

export const BOARD_MODES: { id: BoardMode; label: string; short: string }[] = [
  { id: 'friends-week', label: 'Friends · This week', short: 'This week' },
  { id: 'friends-all', label: 'Friends · All time', short: 'All time' },
  { id: 'global-week', label: 'Everyone · This week', short: 'Everyone' },
];

export function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
}

/** Board hours: "0m", "45m", "4.5h", "120h". */
export function formatBoardHours(ms: number): string {
  if (ms < HOUR) return `${Math.floor(Math.max(0, ms) / MIN)}m`;
  const h = ms / HOUR;
  return h >= 100 ? `${Math.floor(h)}h` : `${(Math.floor(h * 10) / 10).toFixed(1).replace(/\.0$/, '')}h`;
}

export interface BoardRow {
  rank: number;
  medal: string;
  code: string;
  name: string;
  hours: string;
  /** e.g. "🔥 5" or "" for no streak */
  streak: string;
  isMe: boolean;
  entry: BoardEntry;
}

export function boardRows(entries: BoardEntry[], mode: BoardMode): BoardRow[] {
  const by = mode === 'friends-all' ? 'total' : 'week';
  const key = (e: BoardEntry) => (by === 'week' ? e.weekMs : e.totalMs);
  const sorted = [...entries].sort((a, b) => key(b) - key(a) || b.streak - a.streak || a.name.localeCompare(b.name));
  return sorted.map((e, i) => ({
    rank: i + 1,
    medal: medal(i + 1),
    code: e.code,
    name: e.name,
    hours: formatBoardHours(key(e)),
    streak: e.streak > 0 ? `🔥 ${e.streak}` : '',
    isMe: e.isMe,
    entry: e,
  }));
}

/** Replace (or add) my row with live local numbers so "You" never looks stale. */
export function withMe(entries: BoardEntry[], me: BoardEntry | null): BoardEntry[] {
  const rest = entries.filter((e) => !e.isMe && (!me || e.code !== me.code));
  return me ? [...rest, me] : rest;
}

/** Friends saved locally that have no board entry (sharing off / never published). */
export function quietFriends(friends: Friend[], entries: BoardEntry[]): Friend[] {
  const codes = new Set(entries.map((e) => e.code));
  return friends.filter((f) => !codes.has(f.code));
}

export function emptyBoardText(mode: BoardMode, friendCount: number): string {
  if (mode === 'global-week') return 'Nobody on the public board yet this week — be the first!';
  return friendCount ? 'Your friends haven’t shared any study time yet.' : 'Add a friend with their code to start a friendly race.';
}

// ───────── publishing ─────────

export const PUBLISH_EVERY_MS = 5 * MIN;

/** What matters for a board row, rounded so the running timer doesn't count as a change every second. */
export function rowSignature(row: EntryRow): string {
  return JSON.stringify([
    row.code,
    row.name,
    row.week_key,
    Math.floor(row.week_ms / MIN),
    Math.floor(row.total_ms / MIN),
    row.streak,
    row.is_public,
    row.snapshot,
  ]);
}

export interface PublishState {
  lastSig: string | null;
  lastAt: number;
}

/**
 * Throttle: skip unchanged rows; forced publishes (toggle on, session end, profile change) go
 * straight out; otherwise at most one every 5 minutes.
 */
export function shouldPublish(st: PublishState, sig: string, now: number, force = false): boolean {
  if (sig === st.lastSig) return false;
  if (force || st.lastSig === null) return true;
  return now - st.lastAt >= PUBLISH_EVERY_MS;
}

export function appUrl(href: string): string {
  const u = new URL(href);
  u.hash = '';
  u.search = '';
  return u.toString();
}

export function inviteText(code: string): string {
  return `Study with me on Study Buddy! 📚 Add my friend code ${code} in the Friends tab and let’s keep each other going.`;
}
