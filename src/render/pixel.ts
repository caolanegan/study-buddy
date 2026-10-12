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
