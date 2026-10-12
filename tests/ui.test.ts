import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { coinsFor } from '../src/core/economy';
import { itemById } from '../src/core/catalog';
import { HOUR, MIN, addDays, dayKey } from '../src/core/time';
import type { AppState } from '../src/core/types';
import { formatCoins, formatCountdown, formatMult, formatShort, parseLocalDateTime, toDateInput, toTimeInput, weatherIcon } from '../src/ui/format';
import {
  deriveSession,
  goalProgress,
  heatLevel,
  heatmap,
  lastNDays,
  minutesToAfford,
  nextCoinMs,
  sceneMode,
  secondsPerCoin,
  sessionStatus,
  shopButton,
  streakMessage,
  validateManual,
} from '../src/ui/viewmodel';

const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime(); // Mon 12 Oct 2026, 09:00 local

function withStudy(state: AppState, start: number, ms: number): AppState {
  let s = A.start(state, start);
  s = A.tick(s, start + ms).state;
  return A.end(s, start + ms).state;
}

/** 3-day streak (yesterday and the two days before), 1h each. */
function streaky(): AppState {
  let s = A.defaultState();
  for (let d = 3; d >= 1; d--) s = withStudy(s, T0 - d * 24 * HOUR, HOUR);
  return s;
}

describe('format', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(18 * MIN + 32_000)).toBe('18:32');
    expect(formatCountdown(HOUR + 2 * MIN + 3000)).toBe('1:02:03');
    expect(formatCountdown(-5000)).toBe('0:00');
    expect(formatCountdown(1500)).toBe('0:02'); // rounds up so it never shows 0:00 early
  });
  it('formats short durations', () => {
    expect(formatShort(0)).toBe('0m');
    expect(formatShort(45 * MIN + 59_000)).toBe('45m');
    expect(formatShort(2 * HOUR)).toBe('2h');
    expect(formatShort(HOUR + 20 * MIN)).toBe('1h 20m');
  });
  it('formats coins and multipliers', () => {
    expect(formatCoins(0)).toBe('0');
    expect(formatCoins(1240)).toBe('1,240');
    expect(formatCoins(1234567)).toBe('1,234,567');
    expect(formatCoins(-50)).toBe('-50');
    expect(formatMult(1)).toBe('×1.0');
    expect(formatMult(1.3)).toBe('×1.3');
    expect(formatMult(1.25)).toBe('×1.25');
    expect(formatMult(2)).toBe('×2.0');
  });
  it('weather icons depend on night for clear skies', () => {
    expect(weatherIcon('clear', false)).toBe('☀️');
    expect(weatherIcon('clear', true)).toBe('🌙');
    expect(weatherIcon('snow', true)).toBe('❄️');
  });
  it('round-trips date/time inputs in local time', () => {
    const ts = new Date(2026, 9, 12, 7, 5).getTime();
    expect(toDateInput(ts)).toBe('2026-10-12');
    expect(toTimeInput(ts)).toBe('07:05');
    expect(parseLocalDateTime('2026-10-12', '07:05')).toBe(ts);
    expect(parseLocalDateTime('', '07:05')).toBeNaN();
    expect(parseLocalDateTime('2026-10-12', 'nope')).toBeNaN();
  });
});

describe('coin maths', () => {
  it('seconds per coin', () => {
    expect(secondsPerCoin(1)).toBe(36);
    expect(Math.round(secondsPerCoin(1.3))).toBe(28);
  });
  it('time to the next coin agrees with coinsFor', () => {
    for (const mult of [1, 1.3, 2]) {
      for (const ms of [0, 30_000, 59_999, 60_000, 61_000, 5 * MIN + 1234, 37 * MIN]) {
        const next = nextCoinMs(ms, mult);
        expect(next).toBeGreaterThan(0);
        expect(coinsFor(ms + next, mult)).toBeGreaterThan(coinsFor(ms, mult));
        expect(coinsFor(ms + next - 1, mult)).toBe(coinsFor(ms, mult));
      }
    }
  });
  it('minutes needed to afford', () => {
    expect(minutesToAfford(0, 1)).toBe(0);
    expect(minutesToAfford(100, 1)).toBe(60);
    expect(minutesToAfford(1, 1)).toBe(1);
    for (const mult of [1, 1.1, 1.3, 2]) {
      for (const coins of [1, 2, 5, 37, 250, 1999]) {
        const m = minutesToAfford(coins, mult);
        expect(coinsFor(m * MIN, mult)).toBeGreaterThanOrEqual(coins);
        expect(coinsFor((m - 1) * MIN, mult)).toBeLessThan(coins);
      }
    }
  });
});

describe('session view-model', () => {
  it('idle', () => {
    const v = deriveSession(A.defaultState(), T0);
    expect(v).toMatchObject({ status: 'idle', timer: '00:00:00', coinLine: '', sub: 'Ready when you are' });
    expect(sceneMode(null)).toBe('idle');
  });
  it('free timer with streak multiplier', () => {
    let s = streaky();
    s = A.start(s, T0);
    const v = deriveSession(s, T0 + 10 * MIN + 5000);
    expect(v.status).toBe('running');
    expect(v.multiplier).toBe(1.3);
    expect(v.timer).toBe('00:10:05');
    expect(v.sub).toBe('Studying · +1 coin every 28s · ×1.3');
    expect(v.coins).toBe(coinsFor(10 * MIN, 1.3));
    expect(v.coinLine).toMatch(/^🪙 \+21 this session · next in 0:\d\d$/);
    expect(sceneMode(s.active)).toBe('studying');
  });
  it('free timer without a streak hides the multiplier', () => {
    const s = A.start(A.defaultState(), T0);
    expect(deriveSession(s, T0 + MIN).sub).toBe('Studying · +1 coin every 36s');
  });
  it('pause / autopause', () => {
    let s = A.start(A.defaultState(), T0);
    s = A.pause(s, T0 + 5 * MIN);
    expect(deriveSession(s, T0 + 6 * MIN)).toMatchObject({ status: 'paused', sub: 'Paused', nextCoinMs: null });
    expect(sceneMode(s.active)).toBe('paused');
    s = A.resume(s, T0 + 6 * MIN);
    // no answer to the check → auto-pause
    const t = A.tick(s, T0 + 6 * MIN + HOUR);
    expect(sessionStatus(t.state.active)).toBe('check');
    expect(sceneMode(t.state.active)).toBe('studying');
    const t2 = A.tick(t.state, T0 + 6 * MIN + HOUR + 6 * MIN);
    expect(sessionStatus(t2.state.active)).toBe('autopaused');
    expect(deriveSession(t2.state, T0 + 3 * HOUR).sub).toMatch(/^Paused — we didn/);
  });
  it('pomodoro work, break and paused', () => {
    let s = A.start(A.defaultState(), T0, true);
    const v = deriveSession(s, T0 + 6 * MIN + 28_000);
    expect(v.sub).toBe('Focus 18:32 left · 🍅 0');
    expect(v.pomodoro).toBe(true);
    s = A.tick(s, T0 + 25 * MIN).state;
    expect(sessionStatus(s.active)).toBe('break');
    expect(sceneMode(s.active)).toBe('break');
    expect(deriveSession(s, T0 + 26 * MIN + 50_000).sub).toBe('Break 3:10 left · 🍅 1');
    s = A.resume(s, T0 + 27 * MIN); // skip break
    s = A.pause(s, T0 + 28 * MIN);
    expect(deriveSession(s, T0 + 29 * MIN).sub).toBe('Paused · focus 24:00 left · 🍅 1');
  });
  it('long break label every 4th pomodoro', () => {
    // short blocks so the hourly still-studying check doesn't interfere
    let s = A.updateSettings(A.defaultState(), { pomodoroWorkMin: 10, pomodoroBreakMin: 2 }, T0);
    s = A.start(s, T0, true);
    s = A.tick(s, T0 + 4 * 12 * MIN - 2 * MIN).state; // 4 × (10+2) minus the last short break
    expect(s.active!.pomodoro!.completed).toBe(4);
    expect(deriveSession(s, s.active!.pomodoro!.phaseEndsAt - 60_000).sub).toBe('Long break 1:00 left · 🍅 4');
  });
});

describe('goal & streak text', () => {
  it('goal progress clamps', () => {
    let s = A.updateSettings(A.defaultState(), { dailyGoalMin: 60 }, T0);
    expect(goalProgress(s, T0)).toBe(0);
    s = withStudy(s, T0, 30 * MIN);
    expect(goalProgress(s, T0 + HOUR)).toBe(0.5);
    s = withStudy(s, T0 + HOUR, 2 * HOUR);
    expect(goalProgress(s, T0 + 4 * HOUR)).toBe(1);
  });
  it('streak messages', () => {
    expect(streakMessage(A.defaultState(), T0)).toBe('Study 30m more today to start a streak 🔥');
    const s = streaky();
    expect(streakMessage(s, T0)).toBe('🔥 3-day streak — study 30m more today to keep it going');
    const s2 = withStudy(s, T0, 40 * MIN);
    expect(streakMessage(s2, T0 + HOUR)).toBe('🔥 4-day streak — today counts! (×1.4)');
  });
});

describe('shop buttons', () => {
  const rich = () => withStudy(A.defaultState(), T0 - 30 * HOUR, 20 * HOUR); // 2000 coins + achievements
  it('funds: shows minutes of study needed', () => {
    const b = shopButton(A.defaultState(), itemById('beanie')!, 1);
    expect(b).toMatchObject({ action: 'none', disabled: true, label: '🪙 150' });
    expect(b.hint).toBe('Need 150 more · ~1h 30m of study');
  });
  it('buy → equip/unequip', () => {
    let s = rich();
    expect(shopButton(s, itemById('beanie')!, 1)).toMatchObject({ action: 'buy', disabled: false, label: 'Buy · 🪙 150' });
    s = A.buy(s, 'beanie', T0).state;
    expect(shopButton(s, itemById('beanie')!, 1)).toMatchObject({ action: 'unequip', label: 'Unequip' });
    s = A.unequip(s, 'beanie', T0);
    expect(shopButton(s, itemById('beanie')!, 1)).toMatchObject({ action: 'equip', label: 'Equip' });
  });
  it('requires and locked', () => {
    const s = rich();
    expect(shopButton(s, itemById('ps5')!, 1)).toMatchObject({ label: 'Requires TV', disabled: true });
    expect(shopButton(s, itemById('crown')!, 1)).toMatchObject({ label: '🔒 Centurion', disabled: true });
  });
});

describe('manual sessions', () => {
  it('validates', () => {
    expect(validateManual(NaN, HOUR, T0)).toMatch(/valid date/);
    expect(validateManual(T0 - 2 * HOUR, 0, T0)).toMatch(/how long/);
    expect(validateManual(T0 - 2 * HOUR, 30_000, T0)).toMatch(/at least 1 minute/);
    expect(validateManual(T0 - 30 * MIN, HOUR, T0)).toMatch(/future/);
    expect(validateManual(T0 - 30 * HOUR, 25 * HOUR, T0)).toMatch(/24 hours/);
    const ok = validateManual(T0 - 2 * HOUR, HOUR, T0);
    expect(ok).toBeNull();
    // agrees with the core action
    expect(A.addManualSession(A.defaultState(), T0 - 2 * HOUR, HOUR, T0).session).not.toBeNull();
  });
});

describe('charts', () => {
  it('last 7 days ends today', () => {
    const daily = { [dayKey(T0)]: HOUR, [addDays(dayKey(T0), -6)]: 5 * MIN, [addDays(dayKey(T0), -7)]: HOUR };
    const days = lastNDays(daily, T0, 7);
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ key: '2026-10-12', ms: HOUR, label: 'Mon', isToday: true });
    expect(days[0]).toMatchObject({ key: '2026-10-06', ms: 5 * MIN, label: 'Tue' });
  });
  it('heatmap: 12 Monday-first weeks, future days flagged', () => {
    const cols = heatmap({ '2026-10-12': 2 * HOUR }, T0, 12);
    expect(cols).toHaveLength(12);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    const last = cols[11];
    expect(last[0]).toMatchObject({ key: '2026-10-12', level: 4, future: false });
    expect(last[1].future).toBe(true);
    expect(cols[0][0].key).toBe('2026-07-27');
    expect([0, 10, 45, 90, 200].map((m) => heatLevel(m * MIN))).toEqual([0, 1, 2, 3, 4]);
  });
});
