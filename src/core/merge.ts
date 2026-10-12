import type { AppState, Bonus, Friend, Purchase, Session } from './types';
import { canonicalJson, pickStable } from './canonical';

/**
 * Union two logs by id. When both sides hold a different record with the same id
 * (e.g. a quest claimed on two offline devices), `choose` picks one deterministically,
 * so merge(a, b) and merge(b, a) always agree.
 */
function unionById<T extends { id: string }>(a: T[], b: T[], drop: Set<string>, choose: (x: T, y: T) => T): T[] {
  const map = new Map<string, T>();
  for (const x of [...a, ...b]) {
    if (drop.has(x.id)) continue;
    const prev = map.get(x.id);
    map.set(x.id, prev ? choose(prev, x) : x);
  }
  return [...map.values()];
}

const ANNOTATION = ['subject', 'note', 'annotatedAt'] as const;

/** Same session ended on two devices: keep the longer/later record; the newest subject/note wins. */
function chooseSession(x: Session, y: Session): Session {
  const base = x.end !== y.end ? (x.end > y.end ? x : y) : x.activeMs !== y.activeMs ? (x.activeMs > y.activeMs ? x : y) : pickStable(x, y);
  const ax = x.annotatedAt ?? (x.subject || x.note ? 0 : -1);
  const ay = y.annotatedAt ?? (y.subject || y.note ? 0 : -1);
  const ann = ax !== ay ? (ax > ay ? x : y) : pickStable(x, y);
  const out: Session = { ...base };
  for (const k of ANNOTATION) delete out[k];
  for (const k of ANNOTATION) if (ann[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = ann[k];
  return out;
}

/** The first claim wins (earliest time, then a stable tie-break). */
const earliest = <T extends { at: number }>(x: T, y: T): T => (x.at !== y.at ? (x.at < y.at ? x : y) : pickStable(x, y));

/** Last-writer-wins with a deterministic tie-break when timestamps are equal. */
function lww<T>(av: T, at: number, bv: T, bt: number): T {
  return at !== bt ? (at > bt ? av : bv) : pickStable(av, bv);
}

function mergeFriends(a: AppState, b: AppState): { friends: Friend[]; removedFriends: { code: string; at: number }[] } {
  const removed = new Map<string, number>();
  for (const r of [...(a.removedFriends ?? []), ...(b.removedFriends ?? [])]) removed.set(r.code, Math.max(removed.get(r.code) ?? 0, r.at));
  const byCode = new Map<string, Friend>();
  for (const f of [...(a.friends ?? []), ...(b.friends ?? [])]) {
    const prev = byCode.get(f.code);
    byCode.set(f.code, !prev ? f : prev.addedAt !== f.addedAt ? (prev.addedAt > f.addedAt ? prev : f) : pickStable(prev, f));
  }
  const friends = [...byCode.values()]
    .filter((f) => f.addedAt > (removed.get(f.code) ?? -1))
    .sort((x, y) => x.addedAt - y.addedAt || x.code.localeCompare(y.code));
  const removedFriends = [...removed.entries()].map(([code, at]) => ({ code, at })).sort((x, y) => x.code.localeCompare(y.code));
  return { friends, removedFriends };
}

/**
 * Conflict-free merge of two copies of the state (e.g. local + cloud).
 * Logs are unioned by id; single-valued fields are last-writer-wins. Commutative and idempotent
 * (up to key order), so two devices always converge. Unknown fields (from newer app versions) are kept.
 */
export function mergeStates(a: AppState, b: AppState): AppState {
  const deleted = new Set([...a.deletedSessions, ...b.deletedSessions]);
  const sessions = unionById(a.sessions, b.sessions, deleted, chooseSession).sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
  const sessionIds = new Set(sessions.map((s) => s.id));

  // Prevent buying the same item twice on two offline devices: keep the earliest purchase.
  const purchases = unionById<Purchase>(a.purchases, b.purchases, new Set(), earliest).sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
  const seenItems = new Set<string>();
  const dedupedPurchases = purchases.filter((p) => (seenItems.has(p.itemId) ? false : (seenItems.add(p.itemId), true)));

  const achievements: Record<string, number> = {};
  for (const id of [...new Set([...Object.keys(a.achievements), ...Object.keys(b.achievements)])].sort())
    achievements[id] = Math.min(a.achievements[id] ?? Infinity, b.achievements[id] ?? Infinity);

  // Active session: newest wins, unless it has already been saved as a finished session somewhere.
  const candidates = [a.active, b.active].filter((x): x is NonNullable<typeof x> => !!x && !sessionIds.has(x.id) && !deleted.has(x.id));
  const active = candidates.length < 2 ? (candidates[0] ?? null) : lww(candidates[0], candidates[0].updatedAt, candidates[1], candidates[1].updatedAt);

  const bonuses = unionById<Bonus>(a.bonuses ?? [], b.bonuses ?? [], new Set(), earliest).sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
  const { friends, removedFriends } = mergeFriends(a, b);

  // keep fields this version doesn't know about (written by a newer client)
  const unknown = { ...b, ...a } as Record<string, unknown>;
  return {
    ...unknown,
    version: 1,
    sessions,
    purchases: dedupedPurchases,
    achievements,
    active,
    equipped: lww(a.equipped, a.equippedUpdatedAt, b.equipped, b.equippedUpdatedAt),
    equippedUpdatedAt: Math.max(a.equippedUpdatedAt, b.equippedUpdatedAt),
    settings: lww(a.settings, a.settingsUpdatedAt, b.settings, b.settingsUpdatedAt),
    settingsUpdatedAt: Math.max(a.settingsUpdatedAt, b.settingsUpdatedAt),
    deletedSessions: [...deleted].sort(),
    profile: lww(a.profile, a.profileUpdatedAt ?? 0, b.profile, b.profileUpdatedAt ?? 0),
    profileUpdatedAt: Math.max(a.profileUpdatedAt ?? 0, b.profileUpdatedAt ?? 0),
    bonuses,
    friends,
    removedFriends,
    friendsUpdatedAt: Math.max(a.friendsUpdatedAt ?? 0, b.friendsUpdatedAt ?? 0),
  } as AppState;
}

/** Order-insensitive equality for states (Postgres jsonb reorders keys). */
export function sameState(a: AppState, b: AppState): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
