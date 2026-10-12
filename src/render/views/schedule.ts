// Pure (DOM-free) rules for which random world events may happen right now, how rare they are and how often
// each may be announced. Kept separate so it can be unit-tested.
import type { ViewId } from '../../core/profile';
import type { Weather } from '../../core/weather';
import type { WorldEventKind } from '../scene';

export interface Conditions {
  view: ViewId;
  season: 0 | 1 | 2 | 3;
  /** 0 = day .. 1 = night */
  night: number;
  weather: Weather;
}

/** Events the director schedules on its "something notable every 1-3 minutes" timer. */
export const SCHEDULED: readonly WorldEventKind[] = [
  'balloon', 'kite', 'birds', 'bird-visit', 'ufo', 'fireworks', 'aurora',
  'dolphin', 'whale', 'deer', 'fox', 'tractor', 'helicopter',
];

/** Events drawn by the shared sky layer (the rest belong to a specific view). */
export const SKY_KINDS: readonly WorldEventKind[] = [
  'balloon', 'kite', 'birds', 'bird-visit', 'ufo', 'fireworks', 'aurora', 'rainbow', 'shooting-star',
];

/** Things you can tap to "catch". */
export const CATCHABLE: readonly WorldEventKind[] = ['shooting-star', 'bird-visit', 'balloon', 'ufo'];

/** Minimum seconds between two events of the same kind (on-screen time). */
export const COOLDOWN: Partial<Record<WorldEventKind, number>> = {
  balloon: 300,
  kite: 240,
  birds: 150,
  'bird-visit': 200,
  ufo: 1500,
  fireworks: 900,
  aurora: 600,
  dolphin: 240,
  whale: 600,
  deer: 240,
  fox: 300,
  tractor: 240,
  helicopter: 300,
  rainbow: 600,
};

/** Minimum seconds between two onWorldEvent reports of the same kind (ambient things are reported rarely). */
export const REPORT_GAP: Partial<Record<WorldEventKind, number>> = {
  'shooting-star': 90,
  train: 420,
  boat: 600,
  plane: 420,
  owl: 900,
  fireflies: 900,
  sheep: 900,
  aurora: 300,
  fireworks: 240,
};

const DAY = (c: Conditions) => c.night < 0.25;
const DARK = (c: Conditions) => c.night > 0.8;
const OPEN = (c: Conditions) => c.weather === 'clear' || c.weather === 'cloudy';
const DRY = (c: Conditions) => c.weather !== 'rain' && c.weather !== 'storm';

/** Weighted list of the scheduled events that fit the current view / season / time / weather. */
export function eligibleEvents(c: Conditions): [WorldEventKind, number][] {
  const out: [WorldEventKind, number][] = [];
  const add = (k: WorldEventKind, w: number, ok: boolean) => ok && w > 0 && out.push([k, w]);
  const v = c.view;
  add('balloon', 1, DAY(c) && OPEN(c));
  add('kite', 1.2, DAY(c) && OPEN(c) && (c.season === 0 || c.season === 1) && (v === 'street' || v === 'seaside' || v === 'countryside'));
  add('birds', 1.4, c.night < 0.45 && DRY(c) && c.weather !== 'snow');
  add('bird-visit', 1.3, c.night < 0.3 && DRY(c));
  add('ufo', v === 'countryside' ? 0.2 : 0.1, DARK(c) && OPEN(c));
  add('fireworks', v === 'city' ? 0.45 : 0.25, DARK(c) && OPEN(c));
  add('aurora', 1.2, DARK(c) && c.weather === 'clear' && c.season === 3 && v !== 'forest' && v !== 'city');
  add('dolphin', 1.4, v === 'seaside' && c.night < 0.4 && c.season !== 3 && c.weather !== 'storm');
  add('whale', 0.5, v === 'seaside' && c.night < 0.5 && c.weather !== 'storm');
  add('deer', 1.3, (v === 'forest' || v === 'countryside') && c.night < 0.85 && c.weather !== 'storm');
  add('fox', v === 'forest' ? 1 : 0.6, (v === 'forest' || v === 'countryside' || (v === 'street' && c.night > 0.6)) && c.weather !== 'storm');
  add('tractor', 1.3, v === 'countryside' && DAY(c) && DRY(c) && c.season !== 3);
  add('helicopter', 1, v === 'city' && c.weather !== 'storm');
  return out;
}

/** Weighted pick; `r` in [0,1). */
export function pickWeighted<T>(list: readonly (readonly [T, number])[], r: number): T | null {
  let total = 0;
  for (const [, w] of list) total += w;
  if (total <= 0) return null;
  let x = r * total;
  for (const [k, w] of list) {
    if (x < w) return k;
    x -= w;
  }
  return list[list.length - 1][0];
}

/** Seconds until the next scheduled notable event: 60..150s, so something happens every ~1-3 minutes. */
export const nextGap = (r: number) => 60 + r * 90;

/** The first night of every sim year (40 sim days) always gets fireworks. */
export const isNewYearNight = (day: number, t: number) => day % 40 === 1 && t >= 0.52;

/** A rainbow appears when the rain stops in daylight. */
export const rainStopped = (prev: Weather, now: Weather) =>
  (prev === 'rain' || prev === 'storm') && (now === 'clear' || now === 'cloudy');

/** Seconds until the next shooting star on a clear night (darker skies get more). */
export function shootingStarGap(view: ViewId, weather: Weather, r: number): number {
  const dark = view === 'forest' || view === 'countryside' || view === 'seaside';
  const base = dark ? 45 : 70;
  return (base + r * base * 1.4) * (weather === 'cloudy' ? 2 : 1);
}
