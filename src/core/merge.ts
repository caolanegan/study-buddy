import type { AppState } from './types';

function unionById<T extends { id: string }>(a: T[], b: T[], drop: Set<string>): T[] {
  const map = new Map<string, T>();
  for (const x of [...a, ...b]) if (!drop.has(x.id) && !map.has(x.id)) map.set(x.id, x);
  return [...map.values()];
}

/**
 * Conflict-free merge of two copies of the state (e.g. local + cloud).
 * Logs are unioned by id; single-valued fields are last-writer-wins.
 */
export function mergeStates(a: AppState, b: AppState): AppState {
  const deleted = new Set([...a.deletedSessions, ...b.deletedSessions]);
  const sessions = unionById(a.sessions, b.sessions, deleted).sort((x, y) => x.start - y.start);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const purchases = unionById(a.purchases, b.purchases, new Set()).sort((x, y) => x.at - y.at);

  // Prevent buying the same item twice on two offline devices: keep the earliest purchase.
  const seenItems = new Set<string>();
  const dedupedPurchases = purchases.filter((p) => (seenItems.has(p.itemId) ? false : (seenItems.add(p.itemId), true)));

  const achievements: Record<string, number> = { ...b.achievements };
  for (const [id, at] of Object.entries(a.achievements)) achievements[id] = Math.min(at, achievements[id] ?? Infinity);

  // Active session: newest wins, unless it has already been saved as a finished session somewhere.
  const candidates = [a.active, b.active].filter((x): x is NonNullable<typeof x> => !!x && !sessionIds.has(x.id) && !deleted.has(x.id));
  const active = candidates.sort((x, y) => y.updatedAt - x.updatedAt)[0] ?? null;

  const eqA = a.equippedUpdatedAt >= b.equippedUpdatedAt;
  const stA = a.settingsUpdatedAt >= b.settingsUpdatedAt;
  return {
    version: 1,
    sessions,
    purchases: dedupedPurchases,
    achievements,
    active,
    equipped: eqA ? a.equipped : b.equipped,
    equippedUpdatedAt: Math.max(a.equippedUpdatedAt, b.equippedUpdatedAt),
    settings: stA ? a.settings : b.settings,
    settingsUpdatedAt: Math.max(a.settingsUpdatedAt, b.settingsUpdatedAt),
    deletedSessions: [...deleted],
  };
}
