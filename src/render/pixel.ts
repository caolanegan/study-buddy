// Tiny pixel-art drawing helpers over a low-res 2D canvas context.

export type RGB = [number, number, number];

export const W = 240;
export const H = 150;

export class Painter {
  constructor(public g: CanvasRenderingContext2D) {}

  rect(x: number, y: number, w: number, h: number, c: string) {
    this.g.fillStyle = c;
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  px(x: number, y: number, c: string) {
    this.rect(x, y, 1, 1, c);
  }

  disc(cx: number, cy: number, r: number, c: string) {
    const g = this.g;
    g.fillStyle = c;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
      g.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    const g = this.g;
    g.fillStyle = c;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
      g.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0 || 1;
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }

  glow(x: number, y: number, r: number, rgb: RGB, alpha: number) {
    if (alpha <= 0) return;
    const g = this.g;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, css(rgb, alpha));
    grd.addColorStop(1, css(rgb, 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

export const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
export const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
export const css = (a: RGB, al = 1) => `rgba(${a[0]},${a[1]},${a[2]},${al})`;

/** Deterministic PRNG. */
export function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * A small pixel sprite authored as strings ('.' = transparent, other chars looked up in the palette).
 * Rasterised lazily into an offscreen canvas the first time it's drawn.
 */
export class Sprite {
  private c: HTMLCanvasElement | null = null;
  readonly w: number;
  readonly h: number;
  constructor(
    private rows: string[],
    private pal: Record<string, string>,
  ) {
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
  }
  get canvas(): HTMLCanvasElement {
    if (!this.c) {
      const c = document.createElement('canvas');
      c.width = this.w;
      c.height = this.h;
      const g = c.getContext('2d')!;
      this.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = this.pal[row[x]];
          if (row[x] === '.' || !col) continue;
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      });
      this.c = c;
    }
    return this.c;
  }
  /** Same pixels with a different palette. */
  recolor(pal: Record<string, string>) {
    return new Sprite(this.rows, { ...this.pal, ...pal });
  }
}

/** Draws a sprite with its top-left at (x,y); flip mirrors it horizontally. */
export function drawSprite(p: Painter, s: Sprite, x: number, y: number, flip = false) {
  const g = p.g;
  x = Math.round(x);
  y = Math.round(y);
  if (!flip) g.drawImage(s.canvas, x, y);
  else {
    g.save();
    g.translate(x + s.w, y);
    g.scale(-1, 1);
    g.drawImage(s.canvas, 0, 0);
    g.restore();
  }
}

const glowCache = new Map<string, HTMLCanvasElement>();
/**
 * Cheap additive glow: a cached radial-gradient sprite stretched to radius r.
 * Call with globalCompositeOperation already set to 'lighter'.
 */
export function glowSprite(p: Painter, x: number, y: number, r: number, rgb: RGB, alpha: number) {
  if (alpha <= 0.002) return;
  const key = rgb.join(',');
  let c = glowCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, css(rgb, 1));
    grd.addColorStop(0.4, css(rgb, 0.45));
    grd.addColorStop(1, css(rgb, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(key, c);
  }
  const g = p.g;
  const a = g.globalAlpha;
  g.globalAlpha = Math.min(1, alpha);
  g.drawImage(c, x - r, y - r, r * 2, r * 2);
  g.globalAlpha = a;
}

/** Hue (0..360) → rgb, full saturation, for RGB gear. */
export function hue(h: number, l = 0.6): string {
  return `hsl(${((h % 360) + 360) % 360},90%,${Math.round(l * 100)}%)`;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Mixes two '#rrggbb' colours → '#rrggbb' (for deriving palettes; not for per-frame use). */
export function mixHex(a: string, b: string, t: number): string {
  const m = mix(hex(a), hex(b), t);
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Small deterministic hash → 0..1 (for stable per-pixel / per-tile variation without allocation). */
export function hash01(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
