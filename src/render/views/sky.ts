// The sky behind every view: cached gradient, stars + milky way, sun and moon (true phases), puffy clouds,
// overcast decks, and the aurora / rainbow painters used by events.
import { Painter, css, glowSprite, hex, mix, rng, type RGB } from '../pixel';
import type { RenderScene } from '../scene';
import { WW, WH, makeCanvas, type Sky, type ViewCtx } from './common';

export type { Sky };

// t: 0 = sunrise, 0.5 = sunset
const KEYS: [number, string, string, number][] = [
  [0.0, '#3b4a7a', '#f2a477', 0.45],
  [0.06, '#5aa9e6', '#b4e1f7', 1],
  [0.44, '#5aa9e6', '#b4e1f7', 1],
  [0.5, '#4a3a78', '#f08a5d', 0.45],
  [0.56, '#0b1030', '#1e2a5a', 0],
  [0.94, '#0b1030', '#1e2a5a', 0],
  [1.0, '#3b4a7a', '#f2a477', 0.45],
];
const KEY_RGB = KEYS.map(([t, a, b, d]) => [t, hex(a), hex(b), d] as const);
const GREY_DAY = hex('#8a93a3');
const GREY_NIGHT = hex('#1a1e2a');

export function skyAt(t: number, weather: RenderScene['weather']): Sky {
  let sky: Sky = { top: KEY_RGB[4][1], bot: KEY_RGB[4][2], day: 0 };
  for (let i = 0; i < KEY_RGB.length - 1; i++) {
    const [a, at, ab, ad] = KEY_RGB[i];
    const [b, bt, bb, bd] = KEY_RGB[i + 1];
    if (t >= a && t <= b) {
      const k = (t - a) / (b - a);
      sky = { top: mix(at, bt, k), bot: mix(ab, bb, k), day: ad + (bd - ad) * k };
      break;
    }
  }
  const grey = { clear: 0, cloudy: 0.35, rain: 0.55, storm: 0.7, snow: 0.45, fog: 0.5 }[weather];
  if (grey) {
    const g = mix(GREY_DAY, GREY_NIGHT, 1 - sky.day);
    sky = { ...sky, top: mix(sky.top, g, grey), bot: mix(sky.bot, g, grey * 0.8) };
  }
  return sky;
}

const STAR_N = 64;
const stars = (() => {
  const r = rng(7);
  const a = new Float32Array(STAR_N * 4);
  for (let i = 0; i < STAR_N; i++) {
    a[i * 4] = Math.floor(r() * WW);
    a[i * 4 + 1] = Math.floor(r() * (WH - 14));
    a[i * 4 + 2] = r() * 20; // twinkle phase
    a[i * 4 + 3] = 0.35 + r() * 0.65; // brightness
  }
  return a;
})();

interface CloudShape {
  w: number;
  h: number;
  /** puffs: x, y, r */
  puffs: number[];
}
const CLOUDS: CloudShape[] = [
  { w: 16, h: 7, puffs: [5, 4, 3, 9, 3, 3, 12, 5, 2] },
  { w: 12, h: 6, puffs: [4, 3, 2, 7, 2, 3] },
  { w: 20, h: 8, puffs: [5, 5, 3, 10, 3, 4, 15, 5, 3] },
  { w: 10, h: 5, puffs: [4, 3, 2, 7, 3, 2] },
  { w: 24, h: 8, puffs: [5, 5, 3, 10, 4, 4, 16, 3, 3, 20, 5, 2] },
];

export class SkyPainter {
  private grad = makeCanvas(1, WH);
  private gradKey = '';
  private moons = new Map<number, HTMLCanvasElement>();
  private clouds = new Map<string, HTMLCanvasElement>();
  private milky: HTMLCanvasElement | null = null;
  private rainbowC: HTMLCanvasElement | null = null;
  private deck = new Map<string, HTMLCanvasElement>();

  /** Gradient, stars, sun/moon. Sets c.orbX/orbY/orbA. */
  drawBack(p: Painter, c: ViewCtx, horizon: number, starCount: number, milkyWay: boolean) {
    const g = p.g;
    const key = c.sky.top.join() + '|' + c.sky.bot.join();
    if (key !== this.gradKey) {
      this.gradKey = key;
      const gg = this.grad.getContext('2d')!;
      for (let y = 0; y < WH; y++) {
        gg.fillStyle = css(mix(c.sky.top, c.sky.bot, y / WH));
        gg.fillRect(0, y, 1, 1);
      }
    }
    g.drawImage(this.grad, 0, 0, 1, WH, 0, 0, WW, WH);

    const night = c.night;
    if (c.open && night > 0.3) {
      const vis = (night - 0.3) / 0.7;
      if (milkyWay && c.weather === 'clear') {
        g.globalAlpha = vis * 0.32;
        g.drawImage(this.milkyWay(), 0, 0);
        g.globalAlpha = 1;
      }
      const n = Math.min(STAR_N, starCount);
      for (let i = 0; i < n; i++) {
        const y = stars[i * 4 + 1];
        if (y > horizon - 2) continue;
        const tw = 0.55 + 0.45 * Math.sin(c.time * (1.3 + (i % 5) * 0.4) + stars[i * 4 + 2]);
        const a = vis * tw * stars[i * 4 + 3] * (c.weather === 'cloudy' ? 0.6 : 1);
        g.fillStyle = i % 9 === 0 ? `rgba(200,220,255,${a})` : i % 7 === 0 ? `rgba(255,225,190,${a})` : `rgba(255,255,230,${a})`;
        g.fillRect(stars[i * 4], y, 1, 1);
        if (i % 13 === 0 && tw > 0.8) {
          // a bright star glints into a little cross now and then
          g.fillStyle = `rgba(255,255,230,${a * 0.45})`;
          g.fillRect(stars[i * 4] - 1, y, 3, 1);
          g.fillRect(stars[i * 4], y - 1, 1, 3);
        }
      }
    }
    this.drawOrb(p, c, horizon);
  }

  private milkyWay() {
    if (this.milky) return this.milky;
    const cv = makeCanvas(WW, WH);
    const g = cv.getContext('2d')!;
    const r = rng(99);
    for (let i = 0; i < 520; i++) {
      const u = r();
      const x = u * WW;
      const y = 2 + u * 26 + (r() - 0.5) * (6 + 6 * Math.sin(u * 7));
      const a = 0.12 + r() * 0.3;
      g.fillStyle = i % 4 === 0 ? `rgba(220,200,255,${a})` : `rgba(200,215,255,${a})`;
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    for (let i = 0; i < 40; i++) {
      const u = r();
      g.fillStyle = 'rgba(255,255,240,0.7)';
      g.fillRect(Math.floor(u * WW), Math.floor(2 + u * 26 + (r() - 0.5) * 6), 1, 1);
    }
    this.milky = cv;
    return cv;
  }

  private drawOrb(p: Painter, c: ViewCtx, horizon: number) {
    const t = c.t;
    const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const x = 4 + k * (WW - 8);
    const y = horizon + 2 - Math.sin(Math.PI * k) * (horizon - 4);
    const w = c.weather;
    const alpha = w === 'clear' ? 1 : w === 'cloudy' ? 0.75 : w === 'fog' ? 0.35 : w === 'snow' ? 0.15 : 0;
    c.orbX = x;
    c.orbY = y;
    c.orbA = alpha;
    if (alpha <= 0) return;
    const g = p.g;
    if (t < 0.5) {
      const low = 1 - Math.min(1, Math.sin(Math.PI * k) * 2.2);
      g.globalCompositeOperation = 'lighter';
      glowSprite(p, x, y, 6 + low * 4, low > 0.3 ? [255, 160, 90] : [255, 230, 150], alpha * (0.22 + low * 0.2));
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = alpha;
      const col = css(mix(hex('#ffe27a'), hex('#ffa45c'), low));
      p.disc(x, y, 3, col);
      p.rect(x - 1, y - 2, 2, 1, low > 0.5 ? '#ffc890' : '#fff3b0');
      g.globalAlpha = 1;
    } else {
      g.globalCompositeOperation = 'lighter';
      glowSprite(p, x, y, 9, [170, 190, 255], alpha * 0.18 * (0.3 + c.s.moon));
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = alpha;
      g.drawImage(this.moon(c.s.moon), Math.round(x) - 4, Math.round(y) - 4);
      g.globalAlpha = 1;
    }
  }

  /** 9x9 moon with a real terminator for phase 0 new .. 0.5 full .. 1 (cached in 24 steps). */
  private moon(phase: number) {
    const key = Math.round((((phase % 1) + 1) % 1) * 24) % 24;
    let cv = this.moons.get(key);
    if (cv) return cv;
    cv = makeCanvas(9, 9);
    const g = cv.getContext('2d')!;
    const ph = key / 24;
    const R = 3.6;
    for (let py = 0; py < 9; py++)
      for (let px = 0; px < 9; px++) {
        const dx = px - 4;
        const dy = py - 4;
        if (dx * dx + dy * dy > R * R + 0.6) continue;
        const half = Math.sqrt(Math.max(0, R * R - dy * dy)) + 0.01;
        const xt = Math.cos(2 * Math.PI * ph) * half;
        const lit = ph <= 0.5 ? dx + 0.5 > xt : dx - 0.5 < -xt;
        if (lit) {
          const crater = (px === 3 && py === 3) || (px === 5 && py === 5) || (px === 5 && py === 2) || (px === 2 && py === 5);
          g.fillStyle = crater ? '#d4d1bb' : '#f1efdc';
        } else g.fillStyle = 'rgba(150,160,200,0.18)';
        g.fillRect(px, py, 1, 1);
      }
    this.moons.set(key, cv);
    return cv;
  }

  /** Clouds drifting across; rain/storm/snow add a dark overcast deck. */
  drawClouds(p: Painter, c: ViewCtx) {
    const w = c.weather;
    const n = { clear: 2, cloudy: 5, rain: 5, storm: 6, snow: 4, fog: 3 }[w];
    const dark = w === 'rain' || w === 'storm';
    const day = c.sky.day;
    const lvl = Math.round(day * 8);
    const sunset = c.t > 0.42 && c.t < 0.56 ? 1 : c.t > 0.95 || c.t < 0.05 ? 1 : 0;
    const key = `${dark ? 1 : 0}|${w === 'snow' ? 1 : 0}|${lvl}|${sunset}`;
    const speed = w === 'storm' ? 4 : 1;
    if (dark || w === 'snow') {
      const deck = this.overcast(key, dark, lvl / 8, w === 'snow');
      const off = (c.time * 0.8 * speed) % 34;
      p.g.drawImage(deck, -off, 0);
    }
    for (let i = 0; i < n; i++) {
      const shape = (i * 3 + (dark ? 1 : 0)) % CLOUDS.length;
      const cs = CLOUDS[shape];
      const v = (0.7 + (i % 3) * 0.45) * speed;
      const span = WW + cs.w + 10;
      const x = ((c.time * v + i * 37) % span) - cs.w - 5;
      const y = 2 + ((i * 7) % 15) + (dark ? -1 : 0);
      p.g.drawImage(this.cloud(shape, key, dark, lvl / 8, sunset === 1 && !dark, w === 'snow'), Math.round(x), y);
    }
  }

  private cloudCols(dark: boolean, day: number, sunset: boolean, snow = false): [string, string, string] {
    if (snow) {
      const b = mix([218, 222, 230], [56, 62, 84], 1 - day);
      return [css(mix(b, [255, 255, 255], 0.3)), css(b), css(mix(b, [120, 128, 150], 0.35))];
    }
    if (dark) {
      const b = mix([128, 133, 148], [40, 44, 60], 1 - day);
      return [css(mix(b, [255, 255, 255], 0.12)), css(b), css(mix(b, [20, 22, 34], 0.25))];
    }
    const base: RGB = sunset ? mix([255, 214, 190], [70, 70, 110], 1 - day) : mix([255, 255, 255], [60, 66, 100], 1 - day);
    const shade: RGB = sunset ? mix([226, 170, 170], [50, 50, 86], 1 - day) : mix([214, 226, 240], [44, 50, 80], 1 - day);
    return [css(mix(base, [255, 255, 255], 0.3)), css(base), css(shade)];
  }

  private cloud(shape: number, key: string, dark: boolean, day: number, sunset: boolean, snow: boolean) {
    const k = shape + '|' + key;
    let cv = this.clouds.get(k);
    if (cv) return cv;
    const cs = CLOUDS[shape];
    cv = makeCanvas(cs.w, cs.h + 1);
    const pp = new Painter(cv.getContext('2d')!);
    const [hi, mid, lo] = this.cloudCols(dark, day, sunset, snow);
    const alpha = dark || snow ? 0.95 : 0.35 + 0.6 * day;
    pp.g.globalAlpha = alpha;
    // draw opaque into a temp then copy with alpha so overlapping puffs don't stack
    const tmp = makeCanvas(cs.w, cs.h + 1);
    const tp = new Painter(tmp.getContext('2d')!);
    const tpaint = (col: string, dy: number) => {
      for (let i = 0; i < cs.puffs.length; i += 3) tp.disc(cs.puffs[i], cs.puffs[i + 1] + dy, cs.puffs[i + 2], col);
      tp.rect(2, cs.h - 3 + dy, cs.w - 4, 2, col);
    };
    tpaint(lo, 1);
    tpaint(mid, 0);
    // highlight on top-left of each puff
    for (let i = 0; i < cs.puffs.length; i += 3) tp.rect(cs.puffs[i] - 1, cs.puffs[i + 1] - cs.puffs[i + 2] + 1, 2, 1, hi);
    pp.g.drawImage(tmp, 0, 0);
    this.clouds.set(k, cv);
    return cv;
  }

  /** A bumpy dark cloud deck along the top of the window (drawn twice for wrap). */
  private overcast(key: string, dark: boolean, day: number, snow: boolean) {
    let cv = this.deck.get(key);
    if (cv) return cv;
    cv = makeCanvas(WW + 40, 14);
    const pp = new Painter(cv.getContext('2d')!);
    const [, mid, lo] = this.cloudCols(dark, day, false, snow);
    for (let x = 0; x < WW + 40; x++) {
      const ph = (x / 34) * Math.PI * 2;
      const hgt = 6 + Math.round(2.5 * Math.sin(ph) + 1.5 * Math.sin(ph * 2 + 1) + Math.sin(ph * 3 + 2));
      pp.rect(x, 0, 1, hgt + 1, lo);
      pp.rect(x, 0, 1, hgt, mid);
    }
    this.deck.set(key, cv);
    return cv;
  }

  /** Rainbow arc (cached) faded by alpha. */
  drawRainbow(p: Painter, alpha: number) {
    if (alpha <= 0) return;
    if (!this.rainbowC) {
      const cv = makeCanvas(WW, WH);
      const g = cv.getContext('2d')!;
      const cols = ['#e8584f', '#f29a4a', '#f2d65a', '#6cc46a', '#5aa0e6', '#8a6ad0'];
      const cx = WW * 0.62;
      const cy = WH * 0.95;
      for (let y = 0; y < WH; y++)
        for (let x = 0; x < WW; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          const band = Math.floor(44 - d);
          if (band < 0 || band >= cols.length) continue;
          g.fillStyle = cols[band];
          g.fillRect(x, y, 1, 1);
        }
      this.rainbowC = cv;
    }
    p.g.globalAlpha = alpha * 0.55;
    p.g.drawImage(this.rainbowC, 0, 0);
    p.g.globalAlpha = 1;
  }
}

const auroraCols = new Float32Array(WW * 4);
/** Aurora curtains (additive). Cheap: 3 passes of one rect per column, no per-column strings. */
export function drawAurora(p: Painter, time: number, alpha: number, horizon: number) {
  if (alpha <= 0.01) return;
  const g = p.g;
  const a4 = auroraCols;
  for (let x = 0; x < WW; x++) {
    const w1 = Math.sin(x * 0.11 + time * 0.35) + 0.6 * Math.sin(x * 0.27 - time * 0.6) + 0.3 * Math.sin(x * 0.7 + time * 1.3);
    const top = 3 + w1 * 3 + Math.sin(x * 0.05 + time * 0.1) * 3;
    const len = 9 + 5 * Math.sin(x * 0.17 + time * 0.45) + 3 * Math.sin(x * 0.5 - time);
    const bright = 0.5 + 0.5 * Math.sin(x * 0.21 - time * 0.8 + Math.sin(time * 0.3) * 2);
    const y0 = Math.round(top);
    a4[x * 4] = y0;
    a4[x * 4 + 1] = Math.max(1, Math.round(Math.min(horizon, top + len) - top));
    a4[x * 4 + 2] = alpha * (0.25 + 0.55 * bright);
  }
  g.globalCompositeOperation = 'lighter';
  const pass = (col: string, k: number, dy: (y0: number, h: number) => number, hh: (h: number) => number) => {
    g.fillStyle = col;
    for (let x = 0; x < WW; x++) {
      const y0 = a4[x * 4];
      const h = a4[x * 4 + 1];
      g.globalAlpha = Math.min(1, a4[x * 4 + 2] * k);
      g.fillRect(x, dy(y0, h), 1, hh(h));
    }
  };
  pass('rgb(150,90,220)', 0.5, (y0) => y0 - 3, () => 3);
  pass('rgb(60,230,150)', 0.55, (y0) => y0, (h) => h);
  pass('rgb(160,255,200)', 0.5, (y0, h) => y0 + h - 2, () => 2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
