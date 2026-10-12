// Weather in front of the scenery (rain with splashes, snow, leaves, petals — pooled, no per-frame allocation),
// lightning, fog / mist, and what happens on the glass itself (drops, frost, storm condensation).
import { Painter, rng } from '../pixel';
import type { RenderEvents } from '../scene';
import { WW, WH, h01, makeCanvas, smooth, type View, type ViewCtx } from './common';

const N = 320;
const RAIN = 1;
const SNOWF = 2;
const LEAF = 3;
const PETAL = 4;
const SPLASH = 5;
const LEAF_COLS = ['#e07b39', '#c94f2c', '#f2b134', '#b8582a'];

export class WeatherFx {
  private x = new Float32Array(N);
  private y = new Float32Array(N);
  private vx = new Float32Array(N);
  private vy = new Float32Array(N);
  private ph = new Float32Array(N);
  private land = new Float32Array(N);
  private kind = new Uint8Array(N);
  private col = new Uint8Array(N);
  private cursor = 0;

  private nextLightning = 5;
  private flash = 0;
  private bolt = new Float32Array(24);
  private boltN = 0;

  private drops = Array.from({ length: 9 }, (_, i) => ({ x: 3 + i * 7.5, y: Math.random() * WH, v: 2 + Math.random() * 3, pause: 0 }));
  private beads = (() => {
    const r = rng(5);
    return Array.from({ length: 34 }, () => [Math.floor(r() * WW), Math.floor(r() * WH), r()] as const);
  })();
  private frost: (HTMLCanvasElement | null)[] = [null, null, null, null, null, null];
  private steam: HTMLCanvasElement | null = null;
  private fogDay: HTMLCanvasElement | null = null;
  private fogNight: HTMLCanvasElement | null = null;
  private band: HTMLCanvasElement | null = null;

  get lightning() {
    return this.flash;
  }

  private spawn(k: number, x: number, y: number, vx: number, vy: number, land: number, col = 0) {
    for (let n = 0; n < N; n++) {
      const i = (this.cursor + n) % N;
      if (this.kind[i] === 0) {
        this.kind[i] = k;
        this.x[i] = x;
        this.y[i] = y;
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.land[i] = land;
        this.ph[i] = Math.random() * 6.28;
        this.col[i] = col;
        this.cursor = i + 1;
        return;
      }
    }
  }

  /** Spawn + move + draw falling things. */
  particles(p: Painter, c: ViewCtx, view: View) {
    const dt = c.dt;
    const w = c.weather;
    const rate = (n: number, f: () => void) => {
      let k = n * dt;
      while (k > 0) {
        if (Math.random() < Math.min(1, k)) f();
        k -= 1;
      }
    };
    const ground = view.ground;
    const landY = () => ground + Math.random() * (WH - ground);
    if (w === 'rain' || w === 'storm') {
      const storm = w === 'storm';
      rate(storm ? 75 : 42, () => this.spawn(RAIN, Math.random() * (WW + 16), -3, storm ? -16 : -5, 72 + Math.random() * 22, landY()));
    }
    if (w === 'snow' || (c.snowy && w === 'cloudy') || (c.snowy && w === 'fog'))
      rate(w === 'snow' ? 11 : 2.5, () => {
        const near = Math.random() < 0.18;
        this.spawn(SNOWF, Math.random() * (WW + 6), -2, -0.5 - Math.random() * 0.8, near ? 6 + Math.random() * 2 : 3 + Math.random() * 2, near ? WH + 2 : landY(), near ? 1 : 0);
      });
    const srcs = view.leafSources(c);
    if (srcs.length && (c.season === 2 || (c.season === 0 && !c.wet))) {
      const leaf = c.season === 2;
      rate(leaf ? (c.wet ? 1.5 : 3) : 1.5, () => {
        const s = srcs[(Math.random() * srcs.length) | 0];
        this.spawn(leaf ? LEAF : PETAL, s[0] + Math.random() * s[2], s[1] + Math.random() * s[3], -3 - (w === 'storm' ? 8 : 0), 4 + Math.random() * 3, landY(), (Math.random() * 4) | 0);
      });
    }
    // autumn gusts carry the odd leaf across any view
    if (c.season === 2 && !c.wet) rate(0.25, () => this.spawn(LEAF, WW + 2, 6 + Math.random() * 30, -12 - Math.random() * 6, 3, WH + 2, (Math.random() * 4) | 0));

    const g = p.g;
    const nightDim = 1 - c.night * 0.45;
    const rainCol = `rgba(190,210,240,${0.55 * nightDim + 0.1})`;
    const snowCol = c.night > 0.5 ? '#c9d2ea' : '#ffffff';
    for (let i = 0; i < N; i++) {
      const k = this.kind[i];
      if (!k) continue;
      if (k === SPLASH) {
        this.ph[i] -= dt;
        if (this.ph[i] <= 0) {
          this.kind[i] = 0;
          continue;
        }
        g.fillStyle = rainCol;
        g.fillRect(this.x[i] - 1, this.y[i] - (this.ph[i] > 0.06 ? 1 : 0), 1, 1);
        g.fillRect(this.x[i] + 1, this.y[i] - (this.ph[i] > 0.06 ? 1 : 0), 1, 1);
        continue;
      }
      const wob = k === RAIN ? 0 : k === SNOWF ? Math.sin(c.time * 1.6 + this.ph[i]) * 1.6 : Math.sin(c.time * 3 + this.ph[i]) * 3;
      this.x[i] += (this.vx[i] + wob) * dt;
      this.y[i] += this.vy[i] * dt;
      const x = this.x[i];
      const y = this.y[i];
      if (y >= this.land[i] || x < -4) {
        if (k === RAIN && this.land[i] < WH && x > 0) {
          this.kind[i] = SPLASH;
          this.ph[i] = 0.12;
          this.y[i] = this.land[i];
        } else this.kind[i] = 0;
        continue;
      }
      if (k === RAIN) {
        g.fillStyle = rainCol;
        if (c.weather === 'storm') {
          g.fillRect(x, y, 1, 1);
          g.fillRect(x + 1, y - 2, 1, 2);
        } else g.fillRect(x, y, 1, 3);
      } else if (k === SNOWF) {
        g.fillStyle = snowCol;
        if (this.col[i]) g.fillRect(x, y, 2, 2);
        else g.fillRect(x, y, 1, 1);
      } else if (k === LEAF) {
        g.fillStyle = LEAF_COLS[this.col[i]];
        const flip = Math.sin(c.time * 5 + this.ph[i]) > 0;
        g.fillRect(x, y, flip ? 2 : 1, 1);
      } else {
        g.fillStyle = this.col[i] % 2 ? '#f7b5cf' : '#fde2ec';
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  /** Lightning bolts in storms (+ flash level for lighting up the room). */
  lightningFx(p: Painter, c: ViewCtx, horizon: number, ev: RenderEvents) {
    if (c.weather !== 'storm') {
      this.flash = 0;
      return;
    }
    this.nextLightning -= c.dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 7 + Math.random() * 14;
      this.flash = 1;
      let x = 8 + Math.random() * (WW - 16);
      let n = 0;
      this.bolt[n++] = x;
      this.bolt[n++] = 0;
      for (let y = 0; y < horizon && n < 22; y += 3 + Math.random() * 3) {
        x += (Math.random() - 0.5) * 7;
        this.bolt[n++] = x;
        this.bolt[n++] = Math.min(horizon, y + 4);
      }
      this.boltN = n;
      ev.onThunder?.();
    }
    if (this.flash > 0) {
      p.rect(0, 0, WW, WH, `rgba(230,235,255,${this.flash * 0.45})`);
      if (this.flash > 0.55) {
        const b = this.bolt;
        for (let i = 0; i + 3 < this.boltN; i += 2) {
          p.line(b[i] + 1, b[i + 1], b[i + 2] + 1, b[i + 3], 'rgba(170,190,255,0.6)');
          p.line(b[i], b[i + 1], b[i + 2], b[i + 3], '#ffffff');
        }
        // a short fork
        if (this.boltN > 8) p.line(b[6], b[7], b[6] + 6, b[7] + 7, '#e8eeff');
      }
      this.flash = Math.max(0, this.flash - c.dt * 2.5);
    }
  }

  /** Fog: a cached haze plus two drifting mist bands. `bands` = y positions of mist bands for this view. */
  fog(p: Painter, c: ViewCtx, bandY: readonly number[], thick: number) {
    const g = p.g;
    if (!this.fogDay) {
      this.fogDay = this.fogCanvas([206, 210, 218]);
      this.fogNight = this.fogCanvas([60, 66, 92]);
      this.band = makeBand();
    }
    if (c.weather === 'fog') {
      g.globalAlpha = 1 - c.night;
      g.drawImage(this.fogDay!, 0, 0);
      g.globalAlpha = c.night;
      g.drawImage(this.fogNight!, 0, 0);
      g.globalAlpha = 1;
    }
    if (thick > 0) {
      const band = this.band!;
      for (let i = 0; i < bandY.length; i++) {
        const off = (c.time * (1.2 + i * 0.7) + i * 40) % band.width;
        g.globalAlpha = thick * (1 - c.night * 0.6);
        g.drawImage(band, -off, bandY[i]);
        g.drawImage(band, band.width - off, bandY[i]);
      }
      g.globalAlpha = 1;
    }
  }

  private fogCanvas(rgb: [number, number, number]) {
    const cv = makeCanvas(WW, WH);
    const g = cv.getContext('2d')!;
    for (let y = 0; y < WH; y++) {
      const k = y / WH;
      const a = 0.18 + 0.42 * smooth(0, 0.6, k) - 0.2 * smooth(0.75, 1, k);
      g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
      g.fillRect(0, y, WW, 1);
    }
    return cv;
  }

  /** Drops on the pane (rain), frost in the corners (cold winter nights), condensation (storms). */
  glass(p: Painter, c: ViewCtx) {
    const g = p.g;
    if (c.wet) {
      for (const [x, y, a] of this.beads) {
        g.fillStyle = `rgba(220,235,255,${0.15 + a * 0.25})`;
        g.fillRect(x, y, 1, 1);
      }
      for (const d of this.drops) {
        if (d.pause > 0) d.pause -= c.dt;
        else {
          d.y += d.v * c.dt * (Math.random() < 0.08 ? 7 : 1);
          if (Math.random() < c.dt * 0.4) d.pause = 0.5 + Math.random() * 1.5;
        }
        if (d.y > WH + 2) {
          d.y = -3;
          d.x = 2 + Math.random() * (WW - 4);
        }
        g.fillStyle = 'rgba(200,220,245,0.2)';
        g.fillRect(d.x, d.y - 6, 1, 5);
        g.fillStyle = 'rgba(225,240,255,0.65)';
        g.fillRect(d.x, d.y - 1, 1, 2);
        g.fillStyle = 'rgba(255,255,255,0.8)';
        g.fillRect(d.x, d.y - 1, 1, 1);
      }
    }
    if (c.weather === 'storm' || c.weather === 'rain') {
      const a = c.weather === 'storm' ? 0.6 : 0.2;
      if (!this.steam) this.steam = makeSteam();
      g.globalAlpha = a;
      g.drawImage(this.steam, 0, 0);
      g.globalAlpha = 1;
    }
    // frost creeps in over a cold winter night (clear nights are coldest)
    if (c.season === 3 && c.night > 0.4) {
      const since = c.t >= 0.5 ? c.t - 0.5 : c.t + 0.5; // 0 at sunset
      let lvl = smooth(0.04, 0.4, since) * (c.weather === 'clear' ? 1 : 0.7) * Math.min(1, (c.night - 0.4) / 0.4);
      if (c.t < 0.08) lvl *= 1 - smooth(0, 0.08, c.t); // melts away at sunrise
      const i = Math.min(5, Math.floor(lvl * 6));
      if (lvl > 0.04) {
        let cv = this.frost[i];
        if (!cv) cv = this.frost[i] = makeFrost((i + 1) / 6);
        g.drawImage(cv, 0, 0);
      }
    }
  }
}

export function makeBand() {
  const w = WW * 2;
  const cv = makeCanvas(w, 9);
  const g = cv.getContext('2d')!;
  for (let x = 0; x < w; x++) {
    const ph = (x / w) * Math.PI * 2;
    const th = 2.5 + 1.5 * Math.sin(ph * 3) + Math.sin(ph * 7 + 1);
    for (let y = 0; y < 9; y++) {
      const d = Math.abs(y - 4) / Math.max(0.6, th);
      if (d > 1) continue;
      const a = (1 - d) * 0.55;
      // ordered dither keeps it pixel-crisp
      if ((x + y * 2) % 4 === 0 && d > 0.6) continue;
      g.fillStyle = `rgba(225,230,238,${a})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

function makeSteam() {
  const cv = makeCanvas(WW, WH);
  const g = cv.getContext('2d')!;
  const clear = new Set<number>();
  const r = rng(77);
  for (let i = 0; i < 6; i++) clear.add(Math.floor(4 + r() * (WW - 8)));
  for (let y = 0; y < WH; y++)
    for (let x = 0; x < WW; x++) {
      const edge = Math.min(x, WW - 1 - x, WH - 1 - y) / 14;
      const bottom = y / WH;
      let a = 0.05 + 0.22 * smooth(0.35, 1, bottom) + 0.14 * (1 - Math.min(1, edge));
      if (clear.has(x) && y > 8 + h01(x) * 20) a *= 0.2;
      if (h01(x * 131 + y * 7) < 0.25) a *= 0.7;
      g.fillStyle = `rgba(214,222,236,${a})`;
      g.fillRect(x, y, 1, 1);
    }
  return cv;
}

/** Frost grows from the corners (more along the bottom) with feathery crystalline edges and fern strokes. */
function makeFrost(level: number) {
  const cv = makeCanvas(WW, WH);
  const g = cv.getContext('2d')!;
  const corners = [
    [0, 0, 1.25],
    [WW - 1, 0, 1.25],
    [0, WH - 1, 0.85],
    [WW - 1, WH - 1, 0.85],
  ];
  const reach = 4 + level * 13;
  for (let y = 0; y < WH; y++)
    for (let x = 0; x < WW; x++) {
      let d = 99;
      for (const [cx, cy, k] of corners) d = Math.min(d, Math.hypot(x - cx, y - cy) * k);
      d = Math.min(d, (WH - 1 - y) * 3 + 3);
      // low-frequency wobble so the edge is lacy rather than speckled
      d += Math.sin(x * 0.8 + y * 0.35) * 1.4 + Math.sin(x * 0.27 - y * 0.9) * 1.4;
      if (d > reach) continue;
      const k = d / reach;
      const edge = k > 0.84;
      const a = edge ? 0.42 : 0.08 + (1 - k) * 0.3;
      g.fillStyle = edge ? `rgba(240,248,255,${a})` : `rgba(206,226,246,${a})`;
      g.fillRect(x, y, 1, 1);
    }
  // fern-like strokes reaching in from the corners
  const r = rng(12);
  for (const [cx, cy] of corners) {
    for (let s = 0; s < 1; s++) {
      let x = cx;
      let y = cy;
      const ang = Math.atan2(WH / 2 - cy, WW / 2 - cx) + (r() - 0.5) * 1.3;
      const len = reach * (0.7 + r() * 0.5);
      for (let i = 0; i < len; i++) {
        x += Math.cos(ang);
        y += Math.sin(ang);
        g.fillStyle = 'rgba(248,252,255,0.6)';
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
        if (i % 3 === 1 && i > 2) {
          g.fillStyle = 'rgba(248,252,255,0.35)';
          g.fillRect(Math.round(x + Math.sin(ang) * 1.5), Math.round(y - Math.cos(ang) * 1.5), 1, 1);
          g.fillRect(Math.round(x - Math.sin(ang) * 1.5), Math.round(y + Math.cos(ang) * 1.5), 1, 1);
        }
      }
    }
  }
  return cv;
}
