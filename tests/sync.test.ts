import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { syncOnce, type Remote } from '../src/sync/cloud';
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
