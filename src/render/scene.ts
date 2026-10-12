import type { SimTime } from '../core/sim';
import type { Weather } from '../core/weather';

export type Mode = 'studying' | 'paused' | 'break' | 'idle';

export interface RenderScene {
  /** Animation clock in seconds (monotonic). */
  time: number;
  sim: SimTime;
  weather: Weather;
  /** 0 new moon .. 0.5 full .. 1 */
  moon: number;
  mode: Mode;
  /** Equipped item ids. */
  items: Set<string>;
}

export interface RenderEvents {
  onCar?: (dir: 1 | -1) => void;
  onThunder?: () => void;
  onPet?: (pet: 'cat' | 'dog') => void;
}

// Shared layout constants (logical pixels in a 240x150 canvas)
export const WIN = { x: 14, y: 15, w: 68, h: 58 };
export const FLOOR_Y = 104;
export const DESK = { x: 88, top: 82 };
