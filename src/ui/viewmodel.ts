// Pure view-model derivation: everything the UI shows that can be computed
// from (state, now) lives here so it can be unit-tested without a DOM.
import type { AppState, ActiveSession } from '../core/types';
import type { Item } from '../core/catalog';
import { itemById } from '../core/catalog';
import { ACHIEVEMENTS } from '../core/achievements';
import { canBuy, isEquipped, owns, MIN_SESSION_MS } from '../core/actions';
import { COINS_PER_HOUR, STREAK_MIN_MS, balance, coinsFor, dailyTotals, multiplierFor, streakInfo } from '../core/economy';
import { activeMs, isOnBreak, isRunning, LONG_BREAK_EVERY } from '../core/session';
import { MIN, addDays, dayKey, formatDuration } from '../core/time';
import type { Mode } from '../render/scene';
import { formatCoins, formatCountdown, formatMult, formatShort } from './format';
import { returnsLabel } from './goalsvm';

/** Streak multiplier that would apply if the running session ended now. */
export function liveMultiplier(state: AppState, now: number): number {
  return multiplierFor(streakInfo(dailyTotals(state, now), now).current);
}

/** Seconds of study per coin at a multiplier (36s at ×1). */
export function secondsPerCoin(mult: number): number {
  return 3600 / (COINS_PER_HOUR * mult);
}

/** ms of further active time until coinsFor() next increases. */
export function nextCoinMs(ms: number, mult: number): number {
  const have = coinsFor(ms, mult);
  let m = Math.floor(ms / MIN) + 1;
  while (coinsFor(m * MIN, mult) <= have) m++;
  return m * MIN - ms;
}

/** Whole study minutes needed to earn `coins` more at `mult`. */
export function minutesToAfford(coins: number, mult: number): number {
  if (coins <= 0) return 0;
  let m = Math.max(0, Math.floor((coins * 60) / (COINS_PER_HOUR * mult)) - 1);
  while (coinsFor(m * MIN, mult) < coins) m++;
  return m;
}

export type SessionStatus = 'idle' | 'running' | 'paused' | 'autopaused' | 'break' | 'check';

export function sessionStatus(a: ActiveSession | null): SessionStatus {
  if (!a) return 'idle';
  if (a.checkPendingSince !== null) return 'check';
  if (isOnBreak(a)) return 'break';
  if (isRunning(a)) return 'running';
  return a.autoPaused ? 'autopaused' : 'paused';
}

export function sceneMode(a: ActiveSession | null): Mode {
  const s = sessionStatus(a);
  if (s === 'running' || s === 'check') return 'studying';
  if (s === 'break') return 'break';
  if (s === 'idle') return 'idle';
  return 'paused';
}

export interface SessionView {
  status: SessionStatus;
  pomodoro: boolean;
  timer: string;
  sub: string;
  /** Coin line, e.g. "🪙 +12 this session · next in 0:14" ('' when idle). */
  coinLine: string;
  coins: number;
  multiplier: number;
  nextCoinMs: number | null;
  activeMs: number;
}

export function deriveSession(state: AppState, now: number): SessionView {
  const a = state.active;
  const mult = liveMultiplier(state, now);
  const status = sessionStatus(a);
  if (!a) {
    return {
      status,
      pomodoro: false,
      timer: formatDuration(0),
      sub: mult > 1 ? `Ready when you are · streak bonus\u00a0${formatMult(mult)}` : 'Ready when you are',
      coinLine: '',
      coins: 0,
      multiplier: mult,
      nextCoinMs: null,
      activeMs: 0,
    };
  }
  const ms = activeMs(a, now);
  const coins = coinsFor(ms, mult);
  const p = a.pomodoro;
  const tomatoes = p ? ` · 🍅 ${p.completed}` : '';
  const multTxt = mult > 1 ? ` · ${formatMult(mult)}` : '';
  let sub: string;
  switch (status) {
    case 'check':
      sub = 'Still studying? Tap “Yes” to keep counting';
      break;
    case 'break': {
      const long = p!.completed > 0 && p!.completed % LONG_BREAK_EVERY === 0;
      sub = `${long ? 'Long break' : 'Break'} ${formatCountdown(p!.phaseEndsAt - now)} left${tomatoes}`;
      break;
    }
    case 'autopaused':
      sub = 'Paused — we didn’t hear back';
      break;
    case 'paused':
      sub = p && p.pausedRemaining !== null ? `Paused · focus ${formatCountdown(p.pausedRemaining)} left${tomatoes}` : 'Paused';
      break;
    default:
      sub = p
        ? `Focus ${formatCountdown(p.phaseEndsAt - now)} left${tomatoes}`
        : `Studying · +1 coin every ${Math.round(secondsPerCoin(mult))}s${multTxt}`;
  }
  const next = status === 'running' || status === 'check' ? nextCoinMs(ms, mult) : null;
  const tooShort = ms < MIN_SESSION_MS;
  const coinLine =
    `🪙 +${formatCoins(coins)} this session` +
    (next !== null ? ` · next in ${formatCountdown(next)}` : '') +
    (tooShort && status !== 'running' ? ' · under 1 min won’t be saved' : '');
  return { status, pomodoro: !!p, timer: formatDuration(ms), sub, coinLine, coins, multiplier: mult, nextCoinMs: next, activeMs: ms };
}

export function todayMs(state: AppState, now: number): number {
  return dailyTotals(state, now)[dayKey(now)] ?? 0;
}

/** Goal progress 0..1 */
export function goalProgress(state: AppState, now: number): number {
  const goal = Math.max(1, state.settings.dailyGoalMin) * MIN;
  return Math.min(1, todayMs(state, now) / goal);
}

export function streakMessage(state: AppState, now: number): string {
  const daily = dailyTotals(state, now);
  const info = streakInfo(daily, now);
  const today = daily[dayKey(now)] ?? 0;
  if (info.todayCounts) return `🔥 ${info.current}-day streak — today counts! (${formatMult(multiplierFor(info.current))})`;
  const left = formatShort(Math.max(MIN, STREAK_MIN_MS - today));
  if (info.current > 0) return `🔥 ${info.current}-day streak — study ${left} more today to keep it going`;
  return `Study ${left} more today to start a streak 🔥`;
}

export interface ShopButton {
  label: string;
  action: 'buy' | 'equip' | 'unequip' | 'none';
  disabled: boolean;
  /** Extra hint under the button (e.g. study minutes needed). */
  hint: string;
}

export function shopButton(state: AppState, item: Item, mult: number, now = Date.now()): ShopButton {
  if (owns(state, item.id)) {
    return isEquipped(state, item.id)
      ? { label: 'Unequip', action: 'unequip', disabled: false, hint: 'Equipped' }
      : { label: 'Equip', action: 'equip', disabled: false, hint: 'Owned' };
  }
  const err = canBuy(state, item.id, now);
  switch (err) {
    case null:
      return { label: `Buy · 🪙 ${formatCoins(item.price)}`, action: 'buy', disabled: false, hint: '' };
    case 'locked': {
      const a = ACHIEVEMENTS.find((x) => x.id === item.achievement);
      return { label: `🔒 ${a?.name ?? 'Locked'}`, action: 'none', disabled: true, hint: a ? `Unlock: ${a.desc}` : '' };
    }
    case 'requires':
      return { label: `Requires ${itemById(item.requires!)?.name ?? item.requires}`, action: 'none', disabled: true, hint: '' };
    case 'funds': {
      const need = item.price - balance(state);
      return {
        label: `🪙 ${formatCoins(item.price)}`,
        action: 'none',
        disabled: true,
        hint: `Need ${formatCoins(need)} more · ~${formatShort(minutesToAfford(need, mult) * MIN)} of study`,
      };
    }
    case 'expired':
      return { label: returnsLabel(item, now) ?? 'Unavailable', action: 'none', disabled: true, hint: item.limited ? `Limited — ${item.limited.event} only` : '' };
    default:
      return { label: 'Unavailable', action: 'none', disabled: true, hint: '' };
  }
}

/** Validation message for the manual-session form, or null if OK. */
export function validateManual(start: number, durationMs: number, now: number): string | null {
  if (!Number.isFinite(start)) return 'Pick a valid date and start time.';
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'Enter how long you studied.';
  if (durationMs < MIN_SESSION_MS) return 'Sessions must be at least 1 minute.';
  if (durationMs > 24 * 60 * MIN) return 'That’s more than 24 hours — split it into separate sessions.';
  if (start + durationMs > now) return 'The session can’t end in the future.';
  return null;
}

export interface DayBar {
  key: string;
  ms: number;
  /** Day label, e.g. "Mon" */
  label: string;
  isToday: boolean;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function keyToDate(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function lastNDays(daily: Record<string, number>, now: number, n = 7): DayBar[] {
  const today = dayKey(now);
  const out: DayBar[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    out.push({ key, ms: daily[key] ?? 0, label: WD[keyToDate(key).getDay()], isToday: i === 0 });
  }
  return out;
}

export interface HeatCell {
  key: string;
  ms: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

export function heatLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
  const m = ms / MIN;
  if (m < 1) return 0;
  if (m < 30) return 1;
  if (m < 60) return 2;
  if (m < 120) return 3;
  return 4;
}

/** `weeks` columns of 7 days (Mon..Sun), ending with the current week. */
export function heatmap(daily: Record<string, number>, now: number, weeks = 12): HeatCell[][] {
  const today = dayKey(now);
  const dow = (keyToDate(today).getDay() + 6) % 7; // 0 = Monday
  const firstMonday = addDays(today, -dow - (weeks - 1) * 7);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(firstMonday, w * 7 + d);
      const ms = daily[key] ?? 0;
      col.push({ key, ms, level: heatLevel(ms), future: key > today });
    }
    cols.push(col);
  }
  return cols;
}

/** Equipped pets for the audio engine. */
export const PET_IDS = ['cat', 'dog', 'fish-tank', 'lizard'];
