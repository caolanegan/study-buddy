import { HOUR } from './time';
import { SEASON_DAYS } from './sim';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

const TABLE: Record<number, [Weather, number][]> = {
  0: [['clear', 0.45], ['cloudy', 0.25], ['rain', 0.25], ['storm', 0.05]],
  1: [['clear', 0.6], ['cloudy', 0.15], ['rain', 0.1], ['storm', 0.15]],
  2: [['clear', 0.35], ['cloudy', 0.3], ['rain', 0.25], ['fog', 0.1]],
  3: [['clear', 0.25], ['cloudy', 0.2], ['snow', 0.45], ['fog', 0.1]],
};

/** Deterministic 0..1 hash so every device shows the same weather for the same sim time. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Weather changes every half sim-day (i.e. every 30 study minutes). */
export function weatherAt(totalStudiedMs: number): Weather {
  if (!Number.isFinite(totalStudiedMs)) return 'clear';
  const halfDay = Math.floor((Math.max(0, totalStudiedMs) / HOUR) * 2);
  const season = Math.floor(halfDay / 2 / SEASON_DAYS) % 4;
  let r = hash01(halfDay);
  for (const [w, p] of TABLE[season]) {
    if (r < p) return w;
    r -= p;
  }
  return 'clear';
}

/** 0 = new moon, 0.5 = full moon; an 8-day lunar cycle. */
export function moonPhase(totalStudiedMs: number): number {
  if (!Number.isFinite(totalStudiedMs)) return 0.5;
  return ((Math.floor(totalStudiedMs / HOUR) % 8) / 8);
}
