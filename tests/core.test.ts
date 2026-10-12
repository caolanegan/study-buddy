import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { balance, coinsFor, dailyTotals, multiplierFor, streakInfo, totalStudiedMs } from '../src/core/economy';
import { simTime } from '../src/core/sim';
import { CHECK_AFTER_MS, CHECK_GRACE_MS, activeMs, isRunning } from '../src/core/session';
import { mergeStates } from '../src/core/merge';
import { HOUR, MIN, addDays, dayKey, splitByDay } from '../src/core/time';
import type { AppState } from '../src/core/types';

const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime(); // 12 Oct 2026, 09:00 local

function studied(state: AppState, start: number, ms: number) {
  let s = A.start(state, start);
  s = A.tick(s, start + ms).state;
  return A.end(s, start + ms);
}

describe('sim time', () => {
  it('maps study hours to sim days and seasons', () => {
    expect(simTime(0)).toMatchObject({ day: 1, season: 0, clock: '07:55', isNight: false, dayOfSeason: 1, year: 1 });
    expect(simTime(30 * MIN)).toMatchObject({ day: 1, clock: '19:55', isNight: true });
    expect(simTime(1 * HOUR)).toMatchObject({ day: 2, dayOfSeason: 2 });
    expect(simTime(10 * HOUR)).toMatchObject({ season: 1, seasonName: 'Summer', dayOfSeason: 1 });
    expect(simTime(25 * HOUR)).toMatchObject({ seasonName: 'Autumn', dayOfSeason: 6 });
    expect(simTime(40 * HOUR)).toMatchObject({ seasonName: 'Spring', year: 2 });
  });
});

describe('time helpers', () => {
  it('splits across midnight', () => {
    const late = new Date(2026, 9, 12, 23, 30).getTime();
    const parts = splitByDay(late, late + HOUR);
    expect(parts).toEqual({ '2026-10-12': 30 * MIN, '2026-10-13': 30 * MIN });
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('economy', () => {
  it('pays 100 coins/hour per whole minute', () => {
    expect(coinsFor(HOUR, 1)).toBe(100);
    expect(coinsFor(30 * MIN + 59_000, 1)).toBe(50);
    expect(coinsFor(HOUR, 1.5)).toBe(150);
  });
  it('caps multiplier at x2', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(3)).toBe(1.3);
    expect(multiplierFor(50)).toBe(2);
  });
  it('computes streaks (today pending keeps yesterday alive)', () => {
    const now = T0;
    const today = dayKey(now);
    const daily = { [addDays(today, -1)]: 40 * MIN, [addDays(today, -2)]: 30 * MIN, [addDays(today, -3)]: 10 * MIN };
    expect(streakInfo(daily, now)).toEqual({ current: 2, best: 2, todayCounts: false });
    daily[today] = HOUR;
    expect(streakInfo(daily, now).current).toBe(3);
    const broken = { [addDays(today, -2)]: HOUR };
    expect(streakInfo(broken, now).current).toBe(0);
    expect(streakInfo(broken, now).best).toBe(1);
  });
});

describe('sessions', () => {
  it('start / pause / resume / end', () => {
    let s = A.defaultState();
    s = A.start(s, T0);
    s = A.pause(s, T0 + 20 * MIN);
    expect(isRunning(s.active!)).toBe(false);
    s = A.resume(s, T0 + 50 * MIN); // 30 min pause not counted
    const r = A.end(s, T0 + 90 * MIN);
    expect(r.session!.activeMs).toBe(60 * MIN);
    expect(r.state.active).toBeNull();
    // first day of studying, 1h today → streak 1 → x1.1
    expect(r.session!.multiplier).toBe(1.1);
    expect(r.session!.coins).toBe(110);
    expect(r.unlocked).toEqual(expect.arrayContaining(['first-session', 'hours-1']));
    expect(balance(r.state)).toBe(110 + 25 + 25);
  });

  it('discards sessions under a minute', () => {
    const r = studied(A.defaultState(), T0, 30_000);
    expect(r.session).toBeNull();
    expect(r.state.sessions).toHaveLength(0);
  });

  it('accumulates total time and streak multiplier over days', () => {
    let s = A.defaultState();
    for (let d = 0; d < 5; d++) s = studied(s, T0 + d * 24 * HOUR, HOUR - 1).state; // under an hour; check never fires
    expect(totalStudiedMs(s)).toBe(5 * (HOUR - 1));
    expect(s.sessions.map((x) => x.multiplier)).toEqual([1.1, 1.2, 1.3, 1.4, 1.5]);
    expect(s.achievements['streak-3']).toBeDefined();
  });

  it('asks "still studying?" after an hour and auto-pauses if ignored', () => {
    let s = A.start(A.defaultState(), T0);
    let r = A.tick(s, T0 + CHECK_AFTER_MS - 1);
    expect(r.events).toEqual([]);
    r = A.tick(r.state, T0 + CHECK_AFTER_MS + 1000);
    expect(r.events.map((e) => e.kind)).toEqual(['check']);
    // ignore the prompt; reopen app 3 hours later
    r = A.tick(r.state, T0 + 4 * HOUR);
    expect(r.events.map((e) => e.kind)).toEqual(['autopause']);
    expect(r.state.active!.autoPaused).toBe(true);
    expect(activeMs(r.state.active!, T0 + 4 * HOUR)).toBe(CHECK_AFTER_MS);
    s = r.state;
    expect(A.end(s, T0 + 4 * HOUR).session!.activeMs).toBe(HOUR);
  });

  it('confirming the check keeps the session running', () => {
    let s = A.start(A.defaultState(), T0);
    s = A.tick(s, T0 + HOUR + MIN).state;
    expect(s.active!.checkPendingSince).not.toBeNull();
    s = A.confirm(s, T0 + HOUR + 2 * MIN);
    const r = A.tick(s, T0 + HOUR + CHECK_GRACE_MS + 10 * MIN);
    expect(r.events).toEqual([]);
    expect(isRunning(r.state.active!)).toBe(true);
    // next check one active hour after confirming
    const r2 = A.tick(r.state, T0 + 2 * HOUR + 3 * MIN);
    expect(r2.events.map((e) => e.kind)).toEqual(['check']);
  });

  it('runs pomodoro work/break cycles, excluding breaks from study time', () => {
    let s = A.start(A.defaultState(), T0, true);
    const r = A.tick(s, T0 + 25 * MIN + 5 * MIN + 10 * MIN);
    expect(r.events.map((e) => e.kind)).toEqual(['break', 'work']);
    s = r.state;
    expect(activeMs(s.active!, T0 + 40 * MIN)).toBe(35 * MIN);
    const e = A.end(s, T0 + 40 * MIN);
    expect(e.session!.pomodoros).toBe(1);
    expect(e.session!.activeMs).toBe(35 * MIN);
  });

  it('gives a long break after four pomodoros', () => {
    let s = A.start(A.defaultState(), T0, true);
    // keep confirming so the hourly check doesn't interfere
    let kinds: string[] = [];
    for (let t = T0; t <= T0 + 125 * MIN; t += MIN) {
      const r = A.tick(s, t);
      kinds = kinds.concat(r.events.map((e) => (e.kind === 'break' ? (e.long ? 'long' : 'break') : e.kind)));
      s = A.confirm(r.state, t);
    }
    expect(kinds.filter((k) => k !== 'check')).toEqual(['break', 'work', 'break', 'work', 'break', 'work', 'long']);
  });

  it('pausing mid-pomodoro preserves the remaining work time', () => {
    let s = A.start(A.defaultState(), T0, true);
    s = A.pause(s, T0 + 10 * MIN);
    s = A.resume(s, T0 + 60 * MIN);
    expect(s.active!.pomodoro!.phaseEndsAt).toBe(T0 + 75 * MIN);
  });

  it('adds and deletes manual sessions', () => {
    let r = A.addManualSession(A.defaultState(), T0 - 3 * HOUR, 2 * HOUR, T0);
    expect(r.session!.coins).toBe(200);
    expect(dailyTotals(r.state)[dayKey(T0)]).toBe(2 * HOUR);
    const s = A.deleteSession(r.state, r.session!.id);
    expect(s.sessions).toHaveLength(0);
    // can't log the future
    r = A.addManualSession(A.defaultState(), T0, HOUR, T0);
    expect(r.session).toBeNull();
  });
});

describe('shop', () => {
  const rich = () => A.addManualSession(A.defaultState(), T0 - 30 * HOUR, 25 * HOUR, T0).state;

  it('buys, equips exclusive slots, and blocks double-buys', () => {
    let s = rich();
    const before = balance(s);
    let r = A.buy(s, 'beanie', T0);
    expect(r.error).toBeNull();
    s = r.state;
    expect(balance(s)).toBe(before - 150 + 25); // + first-purchase reward
    expect(A.isEquipped(s, 'beanie')).toBe(true);
    s = A.buy(s, 'cap', T0).state;
    expect(A.isEquipped(s, 'cap')).toBe(true);
    expect(A.isEquipped(s, 'beanie')).toBe(false);
    expect(A.buy(s, 'cap', T0).error).toBe('owned');
    s = A.unequip(s, 'cap', T0);
    expect([...A.equippedItems(s)]).toEqual([]);
  });

  it('enforces funds, prerequisites and achievement-only items', () => {
    expect(A.canBuy(A.defaultState(), 'beanie')).toBe('funds');
    expect(A.canBuy(rich(), 'ps5')).toBe('requires');
    expect(A.canBuy(rich(), 'crown')).toBe('locked');
  });
});

describe('sync merge', () => {
  it('unions logs without double counting and respects deletes', () => {
    const base = studied(A.defaultState(), T0, HOUR - 1).state;
    const phone = studied(base, T0 + 2 * HOUR, 30 * MIN).state;
    const mac = studied(base, T0 + 4 * HOUR, 20 * MIN).state;
    const m = mergeStates(phone, mac);
    expect(m.sessions).toHaveLength(3);
    expect(mergeStates(m, m)).toEqual(m);
    const deleted = A.deleteSession(m, base.sessions[0].id);
    expect(mergeStates(deleted, phone).sessions).toHaveLength(2);
  });

  it('drops an active session that another device already ended', () => {
    const running = A.start(A.defaultState(), T0);
    const ended = A.end(running, T0 + 30 * MIN).state;
    expect(mergeStates(running, ended).active).toBeNull();
    expect(mergeStates(running, ended).sessions).toHaveLength(1);
    const discarded = A.end(running, T0 + 10_000).state;
    expect(mergeStates(running, discarded).active).toBeNull();
  });

  it('keeps only one purchase per item across devices', () => {
    const rich = A.addManualSession(A.defaultState(), T0 - 10 * HOUR, 5 * HOUR, T0).state;
    const a = A.buy(rich, 'rug', T0).state;
    const b = A.buy(rich, 'rug', T0 + 1).state;
    expect(mergeStates(a, b).purchases).toHaveLength(1);
  });
});
