import type { SimTime } from '../core/sim';
import type { Weather } from '../core/weather';
import type { Appearance, RoomStyle } from '../core/profile';

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
  /** The buddy's look (skin, hair, default top). */
  look: Appearance;
  /** Wall / floor / curtains / window view. */
  room: RoomStyle;
  /** Total hours studied (the starter plant grows with it, etc.). */
  studiedHours: number;
  /** Real-world clock (epoch ms) for real-calendar decorations like Halloween. */
  realNow: number;
}

/** Things you can tap in the room. */
export type HitTarget =
  | 'character'
  | 'mug'
  | 'cat'
  | 'dog'
  | 'fish-tank'
  | 'lizard'
  | 'plant'
  | 'clock'
  | 'window'
  | 'lamp'
  | 'tv'
  | 'hamster'
  | 'parrot'
  | 'robot-vacuum'
  /** the friendly ghost plush (item 'ghost-plush') */
  | 'ghost'
  /** a catchable thing outside (shooting star, balloon, bird on the sill…) */
  | 'world-event';

/** Random happenings outside / in the room, reported so the UI can show a bubble and play a sound. */
export type WorldEventKind =
  | 'shooting-star'
  | 'balloon'
  | 'rainbow'
  | 'aurora'
  | 'fireworks'
  | 'kite'
  | 'bird-visit'
  | 'ufo'
  | 'train'
  | 'boat'
  | 'dolphin'
  | 'deer'
  | 'fox'
  | 'owl'
  | 'sheep'
  | 'tractor'
  | 'plane'
  | 'helicopter'
  | 'fireflies'
  | 'whale'
  /** a flock of birds crossing the sky */
  | 'birds';

export interface RenderEvents {
  onCar?: (dir: 1 | -1) => void;
  onThunder?: () => void;
  onPet?: (pet: 'cat' | 'dog') => void;
  /** A notable world event started (for bubbles / sounds). */
  onWorldEvent?: (kind: WorldEventKind) => void;
  /** The user tapped a catchable world event (e.g. caught a shooting star). */
  onCatch?: (kind: WorldEventKind) => void;
}

// Shared layout constants (logical pixels in a 240x150 canvas)
export const WIN = { x: 14, y: 15, w: 68, h: 58 };
export const FLOOR_Y = 104;
export const DESK = { x: 88, top: 82, right: 232 };
/** Drawer cabinet under the right end of the desk (its right side lines up with the desk end). */
export const CABINET = { x: 200, y: 92, w: 32, h: 26 };
/** How far the standing desk rises (px) when he stands. */
export const STAND_LIFT = 12;

// Furniture spots shared by items.ts and character.ts
/** Low media console under the window (TV / fish tank / PS5 sit on it). */
export const CONSOLE = { x: 16, w: 72, top: 102, bottom: 112 };
export const TV = { x: 38, y: 82, w: 34, h: 18 };
/** Sofa seen from behind, in the left foreground facing the TV. */
export const SOFA = { x: 26, w: 62, top: 124 };
export const BEANBAG = { cx: 216, cy: 137 };
export const DOG_BED = { cx: 182, cy: 141 };

/** Main monitor geometry for the default / ultrawide setups (before any standing-desk lift). */
export function mainMonitor(s: RenderScene) {
  return s.items.has('ultrawide') ? { x: 116, y: 50, w: 70, h: 30 } : { x: 126, y: 48, w: 46, h: 32 };
}
