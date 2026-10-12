import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { syncOnce, type Remote } from '../src/sync/cloud';
import { mergeStates, sameState } from '../src/core/merge';
import { weatherAt, moonPhase } from '../src/core/weather';
import { HOUR, MIN } from '../src/core/time';
import type { AppState } from '../src/core/types';

const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime();

function fakeRemote(initial: AppState | null) {
  let data: AppState | null = initial ? JSON.parse(JSON.stringify(initial)) : null;
  let pushes = 0;
  const r: Remote = {
    fetch: async () => (data ? JSON.parse(JSON.stringify(data)) : null),
    push: async (s) => {
      pushes++;
      data = JSON.parse(JSON.stringify(s));
    },
  };
  return { r, get: () => data, pushes: () => pushes };
}

const studied = (s: AppState, at: number, ms: number) => A.end(A.start(s, at), at + ms).state;

describe('syncOnce', () => {
  it('pushes local state when the cloud is empty', async () => {
    const local = studied(A.defaultState(), T0, 30 * MIN);
    const remote = fakeRemote(null);
    const merged = await syncOnce(local, remote.r);
    expect(remote.get()!.sessions).toHaveLength(1);
    expect(merged.sessions).toHaveLength(1);
  });

  it('two devices converge', async () => {
    const remote = fakeRemote(null);
    let phone = studied(A.defaultState(), T0, 30 * MIN);
    let mac = studied(A.defaultState(), T0 + 2 * HOUR, 45 * MIN);
    phone = await syncOnce(phone, remote.r);
    mac = await syncOnce(mac, remote.r);
    phone = await syncOnce(phone, remote.r);
    expect(phone.sessions).toHaveLength(2);
    expect(mac.sessions).toHaveLength(2);
    expect(phone).toEqual(mac);
  });

  it('does not push when nothing changed', async () => {
    const local = studied(A.defaultState(), T0, 30 * MIN);
    const remote = fakeRemote(local);
    await syncOnce(local, remote.r);
    expect(remote.pushes()).toBe(0);
  });
});

describe('weather', () => {
  it('is deterministic and seasonal', () => {
    expect(weatherAt(5 * HOUR)).toBe(weatherAt(5 * HOUR + 10 * MIN));
    const winter = Array.from({ length: 40 }, (_, i) => weatherAt((30 + i / 4) * HOUR));
    const summer = Array.from({ length: 40 }, (_, i) => weatherAt((10 + i / 4) * HOUR));
    expect(winter).toContain('snow');
    expect(summer).not.toContain('snow');
    expect(moonPhase(4 * HOUR)).toBe(0.5);
  });
});

describe('review regressions', () => {
  // a remote that behaves like Postgres jsonb: returns keys in a different order
  function jsonbRemote(initial: AppState | null) {
    const shuffle = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(shuffle) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, shuffle(x)])) : v;
    let data: unknown = initial ? shuffle(JSON.parse(JSON.stringify(initial))) : null;
    let pushes = 0;
    const r: Remote = {
      fetch: async () => (data ? (JSON.parse(JSON.stringify(data)) as AppState) : null),
      push: async (s) => {
        pushes++;
        data = shuffle(JSON.parse(JSON.stringify(s)));
      },
    };
    return { r, pushes: () => pushes };
  }

  it('stops pushing once converged even when the server reorders keys', async () => {
    let local = studied(A.defaultState(), T0, 30 * MIN);
    const remote = jsonbRemote(null);
    for (let i = 0; i < 5; i++) local = await syncOnce(local, remote.r);
    expect(remote.pushes()).toBe(1);
  });

  it('merge is commutative for conflicting copies of the same records', () => {
    const base = A.start(A.defaultState(), T0);
    const a = A.end(base, T0 + 30 * MIN).state;
    const b = A.end(base, T0 + 40 * MIN).state; // same session ended later on another device
    const qa = A.claimBonus(a, { id: 'quest:x', kind: 'quest', reward: 30 }, T0 + 50 * MIN).state;
    const qb = A.claimBonus(b, { id: 'quest:x', kind: 'quest', reward: 30 }, T0 + 60 * MIN).state;
    const sa = A.annotateSession(qa, qa.sessions[0].id, { subject: 'Maths' }, T0 + 1);
    const sb = A.annotateSession(qb, qb.sessions[0].id, { subject: 'Bio' }, T0 + 2);
    const ab = mergeStates(sa, sb);
    const ba = mergeStates(sb, sa);
    expect(sameState(ab, ba)).toBe(true);
    expect(ab.sessions[0].activeMs).toBe(40 * MIN);
    expect(ab.sessions[0].subject).toBe('Bio');
    expect(ab.bonuses).toHaveLength(1);
    expect(ab.bonuses[0].at).toBe(T0 + 50 * MIN);
    // equal timestamps still resolve deterministically
    const x = A.updateSettings(A.defaultState(), { volume: 0.1 }, T0);
    const y = A.updateSettings(A.defaultState(), { volume: 0.9 }, T0);
    expect(mergeStates(x, y).settings.volume).toBe(mergeStates(y, x).settings.volume);
  });

  it('a fresh device adopts the account profile instead of overwriting it', async () => {
    const account = A.updateProfile(studied(A.defaultState(), T0, 30 * MIN), { appearance: { name: 'Kofi', skin: 'deep', hair: 'afro', hairColor: 'black', top: 'mustard' }, onboarded: true }, T0);
    const remote = fakeRemote(account);
    const fresh = A.updateProfile(A.defaultState(), { onboarded: true }, T0 + HOUR); // skipped onboarding later
    const merged = await syncOnce(fresh, remote.r);
    expect(merged.profile.appearance.name).toBe('Kofi');
  });

  it('switching accounts does not leak the previous account into the new one', async () => {
    const remoteB = fakeRemote(A.updateProfile(A.defaultState(), { appearance: { name: 'Bee', skin: 'peach', hair: 'bob', hairColor: 'pink', top: 'blue' } }, T0));
    const localA = studied(A.defaultState(), T0, 30 * MIN);
    const merged = await syncOnce(localA, remoteB.r, { accountSwitched: true });
    expect(merged.sessions).toHaveLength(0);
    expect(remoteB.get()!.sessions).toHaveLength(0);
    expect(merged.profile.appearance.name).toBe('Bee');
  });

  it('carries unknown fields from newer clients through a merge', () => {
    const a = { ...A.defaultState(), futureThing: { x: 1 } } as AppState;
    expect((mergeStates(A.defaultState(), a) as unknown as { futureThing: unknown }).futureThing).toEqual({ x: 1 });
  });

  it('friends added and removed on different devices converge', () => {
    let a = A.addFriend(A.defaultState(), 'AAAA-1111', 'Ann', T0);
    const b = A.addFriend(A.defaultState(), 'BBBB-2222', 'Ben', T0 + 1);
    let m = mergeStates(a, b);
    expect(m.friends.map((f) => f.code).sort()).toEqual(['AAAA-1111', 'BBBB-2222']);
    a = A.removeFriend(m, 'AAAA-1111', T0 + 5);
    m = mergeStates(a, b);
    expect(m.friends.map((f) => f.code)).toEqual(['BBBB-2222']);
    m = A.addFriend(m, 'AAAA-1111', 'Ann', T0 + 3); // re-add after removal wins
    expect(mergeStates(m, a).friends.map((f) => f.code).sort()).toEqual(['AAAA-1111', 'BBBB-2222']);
  });

  it('caps paid catches per day', () => {
    let s = A.defaultState();
    let paid = 0;
    for (let i = 0; i < 20; i++) {
      const r = A.claimCatch(s, 'shooting-star', T0 + i * 1000);
      if (r.claimed) paid++;
      s = r.state;
    }
    expect(paid).toBe(A.CATCHES_PER_DAY);
    expect(A.claimCatch(s, 'shooting-star', T0 + 24 * HOUR).claimed).toBe(true);
  });

  it('rejects overlapping manual sessions', () => {
    const s = A.addManualSession(A.defaultState(), T0 - 3 * HOUR, HOUR, T0).state;
    expect(A.addManualSession(s, T0 - 2.5 * HOUR, HOUR, T0).session).toBeNull();
    expect(A.addManualSession(s, T0 - 1.5 * HOUR, HOUR, T0).session).not.toBeNull();
  });
});
