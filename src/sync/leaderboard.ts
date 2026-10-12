// Friends & global leaderboards on top of the (optional) Supabase backend.
// Opt-in: nothing is published unless settings.leaderboard is on.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from '../core/types';
import { dailyTotals, streakInfo } from '../core/economy';
import { weekKey, weekStart } from '../core/quests';
import { addDays, dayKey, HOUR } from '../core/time';
import { snapshotOf, type RoomSnapshot } from '../core/share';
import { normalizeProfile } from '../core/profile';

export interface BoardEntry {
  code: string;
  name: string;
  weekMs: number;
  totalMs: number;
  streak: number;
  snapshot: RoomSnapshot | null;
  isMe: boolean;
  updatedAt: string;
}

/** Friend code derived from the account id: 8 chars shown as XXXX-XXXX. */
export function friendCode(userId: string): string {
  const hex = userId.replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 8).padEnd(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

export function normalizeCode(input: string): string | null {
  const hex = input.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 8 ? `${hex.slice(0, 4)}-${hex.slice(4)}` : null;
}

/** Study time in the current Monday-start week (incl. the running session). */
export function weekMs(state: AppState, now: number): number {
  const daily = dailyTotals(state, now);
  const start = dayKey(weekStart(now) + 12 * HOUR);
  let ms = 0;
  for (let i = 0; i < 7; i++) ms += daily[addDays(start, i)] ?? 0;
  return ms;
}

export interface EntryRow {
  user_id: string;
  code: string;
  name: string;
  week_key: string;
  week_ms: number;
  total_ms: number;
  streak: number;
  is_public: boolean;
  snapshot: RoomSnapshot;
  updated_at?: string;
}

export function buildRow(state: AppState, userId: string, totalMs: number, now: number): EntryRow {
  const streak = streakInfo(dailyTotals(state, now), now).current;
  return {
    user_id: userId,
    code: friendCode(userId),
    name: state.profile.appearance.name,
    week_key: weekKey(now),
    week_ms: Math.round(weekMs(state, now)),
    total_ms: Math.round(totalMs),
    streak,
    is_public: !!state.settings.leaderboardPublic,
    snapshot: snapshotOf(state, totalMs, streak),
  };
}

function toEntry(r: EntryRow, me: string | null, currentWeek: string): BoardEntry {
  let snapshot: RoomSnapshot | null = null;
  if (r.snapshot && typeof r.snapshot === 'object') {
    const prof = normalizeProfile({ appearance: r.snapshot.look, room: r.snapshot.room });
    snapshot = { ...r.snapshot, look: prof.appearance, room: prof.room, items: Array.isArray(r.snapshot.items) ? r.snapshot.items : [] };
  }
  return {
    code: r.code,
    name: String(r.name ?? 'Buddy').slice(0, 24),
    // last week's numbers don't count toward this week
    weekMs: r.week_key === currentWeek ? Number(r.week_ms) || 0 : 0,
    totalMs: Number(r.total_ms) || 0,
    streak: Number(r.streak) || 0,
    snapshot,
    isMe: r.user_id === me,
    updatedAt: r.updated_at ?? '',
  };
}

export function rankEntries(entries: BoardEntry[], by: 'week' | 'total' = 'week'): BoardEntry[] {
  const key = (e: BoardEntry) => (by === 'week' ? e.weekMs : e.totalMs);
  return [...entries].sort((a, b) => key(b) - key(a) || b.streak - a.streak || a.name.localeCompare(b.name));
}

const COLS = 'user_id, code, name, week_key, week_ms, total_ms, streak, is_public, snapshot, updated_at';

export async function publish(client: SupabaseClient, row: EntryRow): Promise<void> {
  const { error } = await client.from('leaderboard').upsert({ ...row, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function unpublish(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from('leaderboard').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function fetchFriends(client: SupabaseClient, me: string, codes: string[], now: number): Promise<BoardEntry[]> {
  const all = [...new Set([...codes, friendCode(me)])];
  const { data, error } = await client.from('leaderboard').select(COLS).in('code', all);
  if (error) throw error;
  return (data as EntryRow[]).map((r) => toEntry(r, me, weekKey(now)));
}

export async function fetchGlobal(client: SupabaseClient, me: string, now: number, limit = 50): Promise<BoardEntry[]> {
  const { data, error } = await client
    .from('leaderboard')
    .select(COLS)
    .eq('is_public', true)
    .eq('week_key', weekKey(now))
    .order('week_ms', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as EntryRow[]).map((r) => toEntry(r, me, weekKey(now)));
}

export async function lookupCode(client: SupabaseClient, code: string, now: number): Promise<BoardEntry | null> {
  const { data, error } = await client.from('leaderboard').select(COLS).eq('code', code).maybeSingle();
  if (error) throw error;
  return data ? toEntry(data as EntryRow, null, weekKey(now)) : null;
}

export const _test = { toEntry };
