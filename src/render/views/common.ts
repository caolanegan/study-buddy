// Shared plumbing for the window views: the per-frame context, depth layering with night tint / haze,
// cached static layers, lit-window helpers and small pixel-art building blocks (pines, round trees).
// Everything here draws in WINDOW-LOCAL coordinates (0..WW-1, 0..WH-1); Outside translates the canvas.
import { Painter, css, mix, type RGB } from '../pixel';
import { WIN, type RenderEvents, type RenderScene, type WorldEventKind } from '../scene';
import type { Weather } from '../../core/weather';

export const WW = WIN.w;
export const WH = WIN.h;

export interface Sky {
  top: RGB;
  bot: RGB;
  /** 1 = full day, 0 = night */
  day: number;
}

export type Season = 0 | 1 | 2 | 3;

/** Everything a view needs for one frame. One instance is reused across frames (no per-frame allocation). */
export interface ViewCtx {
  s: RenderScene;
  sky: Sky;
  time: number;
  dt: number;
  /** 0 day .. 1 night */
  night: number;
  season: Season;
  weather: Weather;
  /** Snow lying on the ground / roofs. */
  snowy: boolean;
  /** Rain or storm. */
  wet: boolean;
  /** Clear or cloudy (stars, sun, moon visible). */
  open: boolean;
  /** Real-world month 0..11 (for calendar decorations). */
  month: number;
  /** Sun (day) or moon (night) position in window coords and how visible it is (0..1). */
  orbX: number;
  orbY: number;
  orbA: number;
  /** Fraction of a sim day elapsed (0 sunrise .. 0.5 sunset .. 1). */
  t: number;
  ev: RenderEvents;
  report: (kind: WorldEventKind) => void;
}

export interface View {
  /** Window-local y where the scenery meets the sky (the sun and moon set behind it). */
  readonly horizon: number;
  /** Where rain splashes / snow can land (window-local y of the top of the ground). */
  readonly ground: number;
  /** Rects [x, y, w, h] that drop autumn leaves / spring petals (trees), or empty. */
  leafSources(c: ViewCtx): readonly (readonly [number, number, number, number])[];
  /** Draw the scenery: blit cached layers / animate into d.p, d.flush() each depth, then lights onto d.main. */
  draw(c: ViewCtx, d: Depth): void;
  /** Optional sky-level things drawn before the scenery (planes, helicopters...). */
  drawSky?(c: ViewCtx, p: Painter): void;
  /** Start a view-specific event (dolphin, deer, tractor, train...). Returns false if not possible here. */
  startEvent?(kind: WorldEventKind, c: ViewCtx, t0: number): boolean;
}

/**
 * Depth compositor: scenery for one depth is drawn into a scratch canvas, then flush() hazes it toward the
 * horizon colour (aerial perspective / fog) and darkens it for night, and copies it to the window. Lights for
 * that depth are then drawn straight onto `main`, so nearer depths still occlude them.
 */
export class Depth {
  readonly p: Painter;
  private c: HTMLCanvasElement;
  hazeCss = '#fff';
  hazeK = 0.18;
  tintCss = '';
  dimCss = '';
  constructor(public main: Painter) {
    this.c = makeCanvas(WW, WH);
    this.p = new Painter(this.c.getContext('2d')!);
  }
  blit(c: HTMLCanvasElement) {
    this.p.g.drawImage(c, 0, 0);
  }
  flush(haze = 0) {
    const g = this.p.g;
    g.globalCompositeOperation = 'source-atop';
    const a = Math.min(0.92, haze * this.hazeK);
    if (a > 0.003) {
      g.globalAlpha = a;
      g.fillStyle = this.hazeCss;
      g.fillRect(0, 0, WW, WH);
      g.globalAlpha = 1;
    }
    if (this.dimCss) {
      g.fillStyle = this.dimCss;
      g.fillRect(0, 0, WW, WH);
    }
    if (this.tintCss) {
      g.fillStyle = this.tintCss;
      g.fillRect(0, 0, WW, WH);
    }
    g.globalCompositeOperation = 'source-over';
    this.main.g.drawImage(this.c, 0, 0);
    g.clearRect(0, 0, WW, WH);
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** A set of static scenery layers, repainted only when `key` changes (season, snow, wet...). */
export class Layers {
  private key = '';
  readonly cs: HTMLCanvasElement[] = [];
  private ps: Painter[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const c = makeCanvas(WW, WH);
      this.cs.push(c);
      this.ps.push(new Painter(c.getContext('2d')!));
    }
  }
  ensure(key: string, paint: (p: Painter, i: number) => void) {
    if (key === this.key) return;
    this.key = key;
    this.ps.forEach((p, i) => {
      p.g.clearRect(0, 0, WW, WH);
      paint(p, i);
    });
  }
}

/** Integer hash → 0..1 (stable across frames / devices). */
export function h01(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export const smooth = (a: number, b: number, v: number) => {
  const k = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return k * k * (3 - 2 * k);
};

/** Probability that a given home/office window is lit (evening busy, late night quiet, early risers). */
export function litChance(c: ViewCtx, base = 0.6): number {
  if (c.night < 0.15) return c.wet ? 0.08 : 0;
  const t = c.t;
  const late = smooth(0.74, 0.9, t) - smooth(0.93, 0.99, t) * 0.6;
  return c.night * base * (1 - 0.55 * late);
}

const LIT = ['#ffd678', '#ffc76a', '#ffe6a8', '#d8ecff', '#ffb36b'];
/**
 * Windows packed as [x, y, w, h, ...]. Each one flips on/off on its own slow schedule.
 * Returns how many were lit (for things like rain reflections).
 */
export function drawLitWindows(p: Painter, wins: Int16Array, c: ViewCtx, seed: number, chance: number, alpha = 1) {
  if (chance <= 0) return 0;
  const g = p.g;
  let n = 0;
  g.globalAlpha = alpha;
  for (let i = 0, k = 0; i < wins.length; i += 4, k++) {
    const id = seed * 1000 + k;
    const period = 25 + h01(id) * 70;
    const slot = Math.floor((c.time + h01(id + 7) * period) / period);
    if (h01(id * 31 + slot * 977) >= chance) continue;
    n++;
    const col = LIT[(h01(id + 3) * (h01(id + 5) < 0.85 ? 3 : 5)) | 0];
    // a few windows flicker blue with a TV
    if (h01(id + 11) < 0.06 && c.night > 0.5) {
      g.fillStyle = (Math.floor(c.time * 3 + k) % 3) === 0 ? '#9ab8ff' : '#6f8fe0';
    } else g.fillStyle = col;
    g.fillRect(wins[i], wins[i + 1], wins[i + 2], wins[i + 3]);
  }
  g.globalAlpha = 1;
  return n;
}

/** Seasonal palettes shared by views. */
export const GRASS = ['#7cc96b', '#5aa64f', '#a3a04e', '#eef3f8'] as const;
export const GRASS_DARK = ['#5fae58', '#46903f', '#8a8640', '#d6e0ea'] as const;
export const FOLIAGE: readonly (readonly [string, string, string])[] = [
  ['#6cbf5e', '#4f9e48', '#8fd47e'],
  ['#3f9e4d', '#2f7d3c', '#58b864'],
  ['#e07b39', '#c94f2c', '#f2b134'],
  ['#8a7a6a', '#6a5a4a', '#a0907e'],
];
export const SNOW = '#f4f7fb';
export const SNOW_SHADE = '#d6e0ea';
export const TRUNK = '#5b3b26';

/**
 * A pixel pine: tiered triangle with a lit left side and shaded right side.
 * (x = centre column, base = y of the ground, h = height incl. a 2px trunk)
 */
export function pine(p: Painter, x: number, base: number, h: number, lit: string, shade: string, snow: boolean, trunk = TRUNK) {
  x = Math.round(x);
  base = Math.round(base);
  p.rect(x, base - 2, 1, 2, trunk);
  const top = base - h;
  const body = h - 2;
  for (let r = 0; r < body; r++) {
    const tier = r % 4;
    const hw = Math.floor(r * 0.28 + tier * 0.55 - (r < 3 ? 0.5 : 0));
    const y = top + r;
    if (hw <= 0) {
      p.px(x, y, lit);
      continue;
    }
    p.rect(x - hw, y, hw + 1, 1, lit);
    p.rect(x + 1, y, hw, 1, shade);
    if (snow && tier === 0 && r > 0) {
      p.rect(x - hw, y, Math.max(1, hw - 1), 1, SNOW);
      p.px(x + hw, y, SNOW_SHADE);
    }
  }
  if (snow) p.px(x, top, SNOW);
}

/** A rounded deciduous tree for the given season (bare with snow in winter). Static: draw into cached layers. */
export function roundTree(p: Painter, x: number, base: number, r: number, season: Season, seed: number, snow: boolean) {
  const trunkH = Math.max(2, Math.round(r * 0.9));
  p.rect(x, base - trunkH, 1 + (r > 4 ? 1 : 0), trunkH, TRUNK);
  const cy = base - trunkH - r + 1;
  if (season === 3) {
    // bare branches
    const tw = r > 4 ? 1 : 0;
    p.line(x, base - trunkH, x - r + 1, cy - 1, TRUNK);
    p.line(x + tw, base - trunkH, x + r - 1, cy - 1, TRUNK);
    p.line(x, base - trunkH, x, cy - r + 1, TRUNK);
    if (snow) {
      p.px(x - r + 1, cy - 2, SNOW);
      p.px(x + r - 1, cy - 2, SNOW);
      p.px(x, cy - r, SNOW);
    }
    return;
  }
  const pal = FOLIAGE[season];
  p.disc(x, cy, r, pal[1]);
  p.disc(x - 1, cy - 1, Math.max(1, r - 1), pal[0]);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < r * 2; i++) p.px(x - r + 1 + rnd() * (2 * r - 1), cy - r + 1 + rnd() * (2 * r - 1), pal[2]);
  if (season === 0 && r >= 3) for (let i = 0; i < r; i++) p.px(x - r + 1 + rnd() * (2 * r - 1), cy - r + 1 + rnd() * (2 * r - 1), i % 2 ? '#f7b5cf' : '#fde2ec');
}

/** Fill columns x0..x1 from top(x) down to `bottom` with colour col(x, y) (cached-layer use only). */
export function fillProfile(p: Painter, x0: number, x1: number, top: (x: number) => number, bottom: number, col: (x: number, y: number) => string) {
  const g = p.g;
  for (let x = x0; x <= x1; x++) {
    const ty = Math.round(top(x));
    let runStart = ty;
    let runCol = col(x, ty);
    for (let y = ty + 1; y <= bottom; y++) {
      const cc = y < bottom ? col(x, y) : '';
      if (cc !== runCol) {
        g.fillStyle = runCol;
        g.fillRect(x, runStart, 1, y - runStart);
        runStart = y;
        runCol = cc;
      }
    }
  }
}

export const rgbCss = (a: RGB, b: RGB, k: number) => css(mix(a, b, k));
