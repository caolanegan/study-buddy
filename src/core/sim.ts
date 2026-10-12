import { HOUR } from './time';

// 1 study hour = 1 sim day (30 min day + 30 min night). 10 days per season.
export const SEASON_DAYS = 10;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type SeasonName = (typeof SEASONS)[number];

export interface SimTime {
  /** 1-based sim day number. */
  day: number;
  /** 0..1 progress through the day; 0 = sunrise, 0.5 = sunset. */
  t: number;
  season: 0 | 1 | 2 | 3;
  seasonName: SeasonName;
  /** 1..10 */
  dayOfSeason: number;
  /** 1-based sim year (4 seasons). */
  year: number;
  /** "HH:MM", sunrise at 06:00 */
  clock: string;
  isNight: boolean;
}

export function simTime(totalStudiedMs: number): SimTime {
  const hours = Math.max(0, totalStudiedMs) / HOUR;
  const dayIndex = Math.floor(hours);
  const t = hours - dayIndex;
  const season = (Math.floor(dayIndex / SEASON_DAYS) % 4) as 0 | 1 | 2 | 3;
  const mins = Math.floor((((t * 24 + 6) % 24) * 60));
  return {
    day: dayIndex + 1,
    t,
    season,
    seasonName: SEASONS[season],
    dayOfSeason: (dayIndex % SEASON_DAYS) + 1,
    year: Math.floor(dayIndex / (SEASON_DAYS * 4)) + 1,
    clock: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
    isNight: t >= 0.5,
  };
}
