// Room snapshots: a compact, URL-safe description of someone's buddy + room so it can be
// visited read-only (share links, friends on the leaderboard). No personal data beyond what's shown.
import type { AppState } from './types';
import { normalizeProfile, type Appearance, type RoomStyle } from './profile';
import { ITEMS } from './catalog';
import { equippedItems } from './actions';
import { HOUR } from './time';

export interface RoomSnapshot {
  v: 1;
  look: Appearance;
  room: RoomStyle;
  items: string[];
  /** total hours studied (1 decimal) */
  hours: number;
  streak: number;
}

export function snapshotOf(state: AppState, totalMs: number, streak: number): RoomSnapshot {
  return {
    v: 1,
    look: state.profile.appearance,
    room: state.profile.room,
    items: [...equippedItems(state)].sort(),
    hours: Math.round((totalMs / HOUR) * 10) / 10,
    streak,
  };
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSnapshot(s: RoomSnapshot): string {
  // short keys keep links small
  return toBase64Url(JSON.stringify({ v: 1, l: s.look, r: s.room, i: s.items, h: s.hours, s: s.streak }));
}

/** Parse and sanitise a snapshot from an untrusted link. Returns null if it's not one. */
export function decodeSnapshot(code: string): RoomSnapshot | null {
  try {
    const raw = JSON.parse(fromBase64Url(code.trim()));
    if (!raw || raw.v !== 1) return null;
    const prof = normalizeProfile({ appearance: raw.l, room: raw.r });
    const known = new Set(ITEMS.map((i) => i.id));
    const items = Array.isArray(raw.i) ? raw.i.filter((x: unknown): x is string => typeof x === 'string' && known.has(x)).slice(0, 80) : [];
    const num = (x: unknown, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : 0);
    return { v: 1, look: prof.appearance, room: prof.room, items, hours: num(raw.h, 1e6), streak: Math.floor(num(raw.s, 1e5)) };
  } catch {
    return null;
  }
}

/** Link that opens the app in "visiting" mode. */
export function visitUrl(base: string, s: RoomSnapshot): string {
  const u = new URL(base);
  u.hash = 'visit=' + encodeSnapshot(s);
  return u.toString();
}

export function snapshotFromHash(hash: string): RoomSnapshot | null {
  const m = /(?:^#|&)visit=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? decodeSnapshot(m[1]) : null;
}
