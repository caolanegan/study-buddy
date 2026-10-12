// Random world events: the director that schedules them (see schedule.ts for the rules), the shared sky events
// (balloon, kites, birds, rainbow, aurora, fireworks, UFO, shooting stars, a bird on the sill) and catching.
// Everything is a pure function of (time - start), so a frozen clock still renders an event mid-flight.
import { Painter, Sprite, drawSprite, glowSprite } from '../pixel';
import type { ViewId } from '../../core/profile';
import type { WorldEventKind } from '../scene';
import { WW, WH, h01, type View, type ViewCtx } from './common';
import { drawAurora, type SkyPainter } from './sky';
import {
  CATCHABLE, COOLDOWN, SKY_KINDS, eligibleEvents, isNewYearNight, nextGap, pickWeighted, rainStopped, shootingStarGap,
} from './schedule';
import type { Weather } from '../../core/weather';

interface Ev {
  kind: WorldEventKind;
  t0: number;
  dur: number;
  x: number;
  y: number;
  dir: 1 | -1;
  seed: number;
  /** animation time it was caught, or -1 */
  caught: number;
  /** where it was when caught */
  cx: number;
  cy: number;
  /** fireworks: [t, x, y, colour, radius] per burst */
  data: Float32Array | null;
}

const BALLOONS: [string, string, string][] = [
  ['#e05a4f', '#f2d16b', '#f58a7f'],
  ['#5aa9e6', '#f4f1e8', '#8cc8f2'],
  ['#8e5bb5', '#f2b134', '#b48cd6'],
  ['#5fbf77', '#f4f1e8', '#8fd8a0'],
  ['#e08a3c', '#3f6f8f', '#f2aa6a'],
];
const KITES: [string, string][] = [
  ['#e05a4f', '#f2d16b'],
  ['#5aa9e6', '#f4f1e8'],
  ['#8e5bb5', '#7dd3a8'],
  ['#f2b134', '#e05a4f'],
];
const FW = ['#ff6b6b', '#ffd166', '#6bd5ff', '#c49cff', '#7dff9a', '#ff9ad5'];
const FW_RGB: [number, number, number][] = [
  [255, 107, 107], [255, 209, 102], [107, 213, 255], [196, 156, 255], [125, 255, 154], [255, 154, 213],
];

// a little bird for the sill (faces right; flip for left)
const BIRD_ROWS = {
  sit: ['...HH.', '..HHEK', 'TBWRR.', '.BWRR.', '..L.L.'],
  peck: ['......', '...HH.', 'TBWRHE', '.BWRRK', '..L.L.'],
  flyA: ['.WW...', '..WWHH', 'TBBRRE', '...R.K'],
  flyB: ['....HH', 'TBBRRE', '.WWR.K', '.W....'],
};
const BIRD_PALS: Record<string, string>[] = [
  // robin
  { H: '#7a5a3e', E: '#1a1a22', K: '#e0a040', B: '#8a6a4a', W: '#6a4e36', R: '#e0663a', T: '#6a4e36', L: '#3a2a20' },
  // blue tit
  { H: '#3f72c8', E: '#1a1a22', K: '#3a3a3a', B: '#8ab060', W: '#4a7ac0', R: '#f2d35a', T: '#3f62a8', L: '#3a3a44' },
  // sparrow
  { H: '#6a5442', E: '#1a1a22', K: '#c89a50', B: '#9a7a58', W: '#6a5040', R: '#d8c8a8', T: '#6a5040', L: '#3a2a20' },
];
const birdSprites = BIRD_PALS.map((pal) => ({
  sit: new Sprite(BIRD_ROWS.sit, pal),
  peck: new Sprite(BIRD_ROWS.peck, pal),
  flyA: new Sprite(BIRD_ROWS.flyA, pal),
  flyB: new Sprite(BIRD_ROWS.flyB, pal),
}));

const HIT_MAX = 8;

export class EventDirector {
  private active: Ev[] = [];
  private nextAt = -1;
  private nextStar = -1;
  private lastStart = new Map<WorldEventKind, number>();
  private prevWeather: Weather | null = null;
  private newYearDay = -1;
  // catchables as last drawn (window-local)
  private hitN = 0;
  private hitX = new Float32Array(HIT_MAX);
  private hitY = new Float32Array(HIT_MAX);
  private hitR = new Float32Array(HIT_MAX);
  private hitEv: (Ev | null)[] = new Array(HIT_MAX).fill(null);

  /** Ambient aurora level for views that want it as scenery (forest on clear winter nights) is drawn by the view. */
  update(c: ViewCtx, view: View, viewId: ViewId) {
    const time = c.time;
    if (this.nextAt < 0) {
      this.nextAt = time + 25 + Math.random() * 35;
      this.nextStar = time + 6 + Math.random() * 20;
    }
    // drop finished events (rare: in-place)
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      const end = e.caught >= 0 ? Math.min(e.t0 + e.dur, e.caught + 3) : e.t0 + e.dur;
      if (time > end + 0.5 || time < e.t0 - 5) this.active.splice(i, 1);
    }
    if (this.prevWeather && rainStopped(this.prevWeather, c.weather) && c.night < 0.2) this.start('rainbow', c, view, time);
    this.prevWeather = c.weather;

    if (isNewYearNight(c.s.sim.day, c.t) && c.night > 0.7 && c.weather !== 'storm' && this.newYearDay !== c.s.sim.day) {
      this.newYearDay = c.s.sim.day;
      this.start('fireworks', c, view, time);
    }

    if (c.open && c.night > 0.85) {
      if (time >= this.nextStar) {
        this.start('shooting-star', c, view, time);
        this.nextStar = time + shootingStarGap(viewId, c.weather, Math.random());
      }
    } else if (this.nextStar < time + 4) this.nextStar = time + 4 + Math.random() * 10;

    if (time >= this.nextAt) {
      this.nextAt = time + nextGap(Math.random());
      const list = eligibleEvents({ view: viewId, season: c.season, night: c.night, weather: c.weather }).filter(
        ([k]) => time - (this.lastStart.get(k) ?? -1e9) > (COOLDOWN[k] ?? 120) && !this.active.some((e) => e.kind === k),
      );
      const k = pickWeighted(list, Math.random());
      if (k) this.start(k, c, view, time);
    }
  }

  /** Start an event (also used by forceEvent for testing). Returns false if this view can't show it. */
  start(kind: WorldEventKind, c: ViewCtx, view: View, t0: number): boolean {
    let ok = false;
    if (SKY_KINDS.includes(kind)) {
      this.active.push(this.make(kind, t0));
      ok = true;
    } else ok = view.startEvent?.(kind, c, t0) ?? false;
    if (ok) {
      this.lastStart.set(kind, t0);
      c.report(kind);
    }
    return ok;
  }

  clearAll() {
    this.active.length = 0;
  }

  private make(kind: WorldEventKind, t0: number): Ev {
    const r = Math.random;
    const dir = (r() < 0.5 ? 1 : -1) as 1 | -1;
    const e: Ev = { kind, t0, dur: 20, x: 0, y: 0, dir, seed: (r() * 1e6) | 0, caught: -1, cx: 0, cy: 0, data: null };
    switch (kind) {
      case 'balloon':
        e.dur = 55;
        e.y = 5 + r() * 9;
        break;
      case 'kite':
        e.dur = 45;
        e.x = 14 + r() * (WW - 28);
        e.y = 8 + r() * 8;
        break;
      case 'birds':
        e.dur = (WW + 50) / 9;
        e.y = 6 + r() * 14;
        break;
      case 'bird-visit':
        e.dur = 18 + r() * 10;
        e.x = 12 + r() * (WW - 30);
        break;
      case 'ufo':
        e.dur = 22;
        e.x = 18 + r() * (WW - 36);
        e.y = 9 + r() * 8;
        break;
      case 'shooting-star':
        e.dur = 2.2;
        e.x = dir > 0 ? 3 + r() * 30 : WW - 3 - r() * 30;
        e.y = 2 + r() * 12;
        break;
      case 'rainbow':
        e.dur = 80;
        break;
      case 'aurora':
        e.dur = 110;
        break;
      case 'fireworks': {
        e.dur = 30;
        const n = 30;
        const d = new Float32Array(n * 5);
        let tb = 0.6;
        for (let i = 0; i < n; i++) {
          d[i * 5] = tb;
          d[i * 5 + 1] = 8 + r() * (WW - 16);
          d[i * 5 + 2] = 6 + r() * 16;
          d[i * 5 + 3] = (r() * FW.length) | 0;
          d[i * 5 + 4] = 6 + r() * 5;
          tb += i % 5 === 4 ? 1.8 : 0.35 + r() * 0.8; // little volleys
        }
        e.data = d;
        break;
      }
    }
    return e;
  }

  /** Sky events, drawn behind the scenery. */
  drawSky(p: Painter, c: ViewCtx, sky: SkyPainter, horizon: number) {
    this.hitN = 0;
    for (const e of this.active) {
      const age = c.time - e.t0;
      if (age < 0) continue;
      switch (e.kind) {
        case 'rainbow':
          sky.drawRainbow(p, fade(age, e.dur, 6, 10) * (c.weather === 'clear' ? 1 : 0.7));
          break;
        case 'aurora':
          drawAurora(p, c.time, fade(age, e.dur, 10, 15) * 0.9, horizon);
          break;
        case 'fireworks':
          this.fireworks(p, e, age, horizon);
          break;
        case 'balloon':
          this.balloon(p, e, age, c);
          break;
        case 'kite':
          this.kite(p, e, age);
          break;
        case 'birds':
          this.flock(p, e, age, c);
          break;
        case 'ufo':
          this.ufo(p, e, age, c, horizon);
          break;
        case 'shooting-star':
          this.star(p, e, age);
          break;
      }
    }
  }

  /** Things right behind the glass (the bird on the sill). */
  drawFront(p: Painter, c: ViewCtx) {
    for (const e of this.active) if (e.kind === 'bird-visit' && c.time >= e.t0) this.sillBird(p, e, c.time - e.t0, c);
  }

  private addHit(e: Ev, x: number, y: number, r: number) {
    if (e.caught >= 0 || this.hitN >= HIT_MAX || !CATCHABLE.includes(e.kind)) return;
    if (x < -r || x > WW + r || y < -r || y > WH + r) return;
    const i = this.hitN++;
    this.hitX[i] = x;
    this.hitY[i] = y;
    this.hitR[i] = r;
    this.hitEv[i] = e;
  }

  /** Catchable thing at window-local (x, y), as last drawn. */
  hitAt(x: number, y: number): Ev | null {
    let best: Ev | null = null;
    let bd = 1e9;
    for (let i = 0; i < this.hitN; i++) {
      const d = (x - this.hitX[i]) ** 2 + (y - this.hitY[i]) ** 2;
      if (d <= this.hitR[i] ** 2 && d < bd) {
        bd = d;
        best = this.hitEv[i];
      }
    }
    return best;
  }

  kindAt(x: number, y: number): WorldEventKind | null {
    return this.hitAt(x, y)?.kind ?? null;
  }

  /** Window-local position of the first visible catchable (optionally of a kind), for speech-bubble anchors. */
  anchor(kind?: WorldEventKind): { x: number; y: number } | null {
    for (let i = 0; i < this.hitN; i++)
      if (!kind || this.hitEv[i]!.kind === kind) return { x: this.hitX[i], y: this.hitY[i] - this.hitR[i] * 0.5 };
    return null;
  }

  catch(x: number, y: number, time: number): Ev | null {
    const e = this.hitAt(x, y);
    if (!e || e.caught >= 0) return null;
    e.caught = time;
    for (let i = 0; i < this.hitN; i++)
      if (this.hitEv[i] === e) {
        e.cx = this.hitX[i];
        e.cy = this.hitY[i];
      }
    // pull it out of the hit list right away so a double-tap can't catch it twice
    this.hitN = 0;
    return e;
  }

  // ---------------------------------------------------------------- painters

  private balloon(p: Painter, e: Ev, age: number, c: ViewCtx) {
    const u = age / e.dur;
    const span = WW + 22;
    let x = e.dir > 0 ? -11 + u * span : WW + 11 - u * span;
    let y = e.y + Math.sin(age * 0.6) * 1.5 - u * 3;
    const caughtAge = e.caught >= 0 ? c.time - e.caught : -1;
    if (caughtAge >= 0) y -= Math.min(6, caughtAge * 2.5); // burner roars, it climbs a little
    x = Math.round(x);
    y = Math.round(y);
    const [a, b, hi] = BALLOONS[e.seed % BALLOONS.length];
    const widths = [3, 5, 7, 7, 7, 7, 5, 3, 1];
    for (let r = 0; r < widths.length; r++) {
      const w = widths[r];
      const x0 = x - (w >> 1);
      for (let i = 0; i < w; i++) p.px(x0 + i, y + r, (x0 + i - x + 3) % 2 === 0 ? a : b);
    }
    p.px(x - 2, y + 2, hi);
    p.px(x - 2, y + 3, hi);
    p.px(x - 1, y + 1, hi);
    const rope = '#6a5040';
    p.px(x - 2, y + 9, rope);
    p.px(x + 2, y + 9, rope);
    p.px(x - 1, y + 10, rope);
    p.px(x + 1, y + 10, rope);
    p.rect(x - 1, y + 11, 3, 2, '#8a5a35');
    p.rect(x - 1, y + 11, 3, 1, '#a8743f');
    if (caughtAge >= 0 && caughtAge < 4) {
      // a passenger pops up and waves; the burner flares
      p.px(x, y + 10, '#e8b48a');
      const up = Math.floor(caughtAge * 5) % 2 === 0;
      p.px(x + (e.dir > 0 ? 1 : -1), y + (up ? 9 : 10), '#e8b48a');
      if (caughtAge < 1.5) {
        p.px(x, y + 9, '#ffb040');
        p.g.globalCompositeOperation = 'lighter';
        glowSprite(p, x, y + 9, 4, [255, 170, 60], 0.8 * (1 - caughtAge / 1.5));
        p.g.globalCompositeOperation = 'source-over';
      }
      // little hearts float up
      for (let i = 0; i < 2; i++) {
        const k = (caughtAge * 0.8 + i * 0.5) % 1;
        if (caughtAge > 3 && k > 0.6) continue;
        p.px(x + 3 + i * 2, y + 6 - k * 8, `rgba(255,120,150,${1 - k})`);
      }
    }
    this.addHit(e, x, y + 6, 10);
  }

  private kite(p: Painter, e: Ev, age: number) {
    const n = e.seed % 3 === 0 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const ax = e.x + k * 18 - 9 * (n - 1);
      const rise = Math.min(1, age / 4);
      const fall = Math.min(1, Math.max(0, (e.dur - age) / 5));
      const lift = Math.min(rise, fall);
      const t = age + k * 2.3;
      const kx = Math.round(ax + Math.sin(t * 0.5) * 6 + Math.sin(t * 1.7) * 1.5);
      const ky = Math.round(WH + 4 - (WH + 4 - (e.y + k * 6)) * lift + Math.sin(t * 0.8) * 3);
      // string down to an unseen flyer
      p.g.globalAlpha = 0.55;
      p.line(kx, ky + 2, ax - 12, WH + 2, '#f0f0f0');
      p.g.globalAlpha = 1;
      const [a, b] = KITES[(e.seed + k) % KITES.length];
      p.px(kx, ky - 2, a);
      p.rect(kx - 1, ky - 1, 2, 1, a);
      p.px(kx + 1, ky - 1, b);
      p.rect(kx - 2, ky, 2, 1, a);
      p.rect(kx, ky, 3, 1, b);
      p.px(kx - 1, ky + 1, b);
      p.rect(kx, ky + 1, 2, 1, a);
      p.px(kx, ky + 2, a);
      for (let j = 1; j <= 6; j++) {
        const tx = kx + Math.sin(t * 4 - j * 0.9) * 1.3 - j * 0.4;
        p.px(tx, ky + 2 + j * 1.5, j % 2 ? a : b);
      }
    }
  }

  private flock(p: Painter, e: Ev, age: number, c: ViewCtx) {
    const n = 5 + (e.seed % 5);
    const lead = e.dir > 0 ? -12 + age * 9 : WW + 12 - age * 9;
    const col = c.night > 0.4 ? '#1a1c28' : '#3a3a48';
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2);
      const side = i % 2 ? 1 : -1;
      const x = Math.round(lead - e.dir * rank * 4 + Math.sin(age * 1.3 + i) * 0.6);
      const y = Math.round(e.y + rank * 2 * side * 0.6 + rank * 0.8 + Math.sin(age * 2 + i * 1.7) * 0.7);
      const up = Math.floor(age * 6 + i * 1.3) % 3 === 0;
      p.px(x, y, col);
      if (up) {
        p.px(x - 1, y - 1, col);
        p.px(x + 1, y - 1, col);
      } else {
        p.px(x - 1, y, col);
        p.px(x + 1, y, col);
      }
    }
  }

  private ufo(p: Painter, e: Ev, age: number, c: ViewCtx, horizon: number) {
    const enter = 1.6;
    const leave = e.dur - 1.3;
    let x: number;
    let y: number;
    const hx = e.x + Math.sin(age * 0.7) * 8;
    const hy = e.y + Math.sin(age * 1.9) * 1.5;
    if (e.caught >= 0) {
      const k = c.time - e.caught;
      if (k > 0.45) {
        this.sparkles(p, e.cx, e.cy, k, '#9affc8');
        return;
      }
      x = e.cx + e.dir * (k / 0.45) ** 2 * 90;
      y = e.cy - (k / 0.45) ** 2 * 40;
      p.g.globalAlpha = 0.5;
      p.line(e.cx, e.cy, x, y, '#b8ffd8');
      p.g.globalAlpha = 1;
      this.sparkles(p, e.cx, e.cy, k, '#9affc8');
    } else if (age < enter) {
      const k = 1 - (1 - age / enter) ** 3;
      x = hx - e.dir * (1 - k) * 50;
      y = -8 + (hy + 8) * k;
    } else if (age > leave) {
      const k = (age - leave) / 1.3;
      x = hx + e.dir * k * k * 40;
      y = hy - k * k * 40;
    } else {
      x = hx;
      y = hy;
      // tractor beam (gently scanning the ground)
      if (c.night > 0.5 && Math.sin(age * 0.9) > -0.2) {
        const g = p.g;
        g.fillStyle = `rgba(160,255,190,${0.12 + 0.05 * Math.sin(age * 9)})`;
        g.beginPath();
        g.moveTo(x - 2, y + 3);
        g.lineTo(x + 3, y + 3);
        g.lineTo(x + 7, horizon + 14);
        g.lineTo(x - 6, horizon + 14);
        g.closePath();
        g.fill();
      }
    }
    x = Math.round(x);
    y = Math.round(y);
    p.g.globalCompositeOperation = 'lighter';
    glowSprite(p, x, y + 1, 7, [120, 255, 180], 0.35);
    p.g.globalCompositeOperation = 'source-over';
    p.rect(x - 1, y - 2, 3, 1, '#9fe8ff');
    p.rect(x - 2, y - 1, 5, 1, '#6fc0e0');
    p.px(x - 1, y - 2, '#e0fbff');
    p.rect(x - 4, y, 9, 1, '#a8adbd');
    p.rect(x - 3, y + 1, 7, 1, '#7a8090');
    p.rect(x - 2, y + 2, 5, 1, '#5a6070');
    for (let i = 0; i < 4; i++) p.px(x - 3 + i * 2, y + 1, FW[(Math.floor(c.time * 6) + i) % FW.length]);
    this.addHit(e, x, y, 9);
  }

  private star(p: Painter, e: Ev, age: number) {
    const g = p.g;
    if (e.caught >= 0) {
      const k = e.t0 + age - e.caught;
      this.sparkles(p, e.cx, e.cy, k, '#fff2a8');
      return;
    }
    if (age > e.dur) return;
    const vx = e.dir * (15 + (e.seed % 7));
    const vy = 6 + (e.seed % 5);
    const x = e.x + vx * age;
    const y = e.y + vy * age;
    const a = Math.min(1, age / 0.25) * Math.min(1, (e.dur - age) / 0.6);
    const len = Math.hypot(vx, vy);
    const ux = vx / len;
    const uy = vy / len;
    for (let i = 9; i >= 1; i--) {
      g.fillStyle = `rgba(255,250,220,${a * (1 - i / 10) * 0.8})`;
      g.fillRect(Math.round(x - ux * i * 1.2), Math.round(y - uy * i * 1.2), 1, 1);
    }
    g.globalCompositeOperation = 'lighter';
    glowSprite(p, x, y, 4, [255, 240, 190], a * 0.7);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
    this.addHit(e, x - ux * 3, y - uy * 3, 8);
  }

  /** Burst of twinkling sparkles from a caught thing. k = seconds since caught. */
  private sparkles(p: Painter, x: number, y: number, k: number, col: string) {
    if (k > 1.6) return;
    const g = p.g;
    if (k < 0.3) {
      g.globalCompositeOperation = 'lighter';
      glowSprite(p, x, y, 6, [255, 240, 180], 0.9 * (1 - k / 0.3));
      g.globalCompositeOperation = 'source-over';
    }
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + 0.3;
      const sp = 9 + (i % 3) * 4;
      const r = sp * (1 - Math.exp(-3 * k));
      const sx = x + Math.cos(ang) * r;
      const sy = y + Math.sin(ang) * r + 4 * k * k;
      const tw = Math.sin(k * 30 + i * 2) > -0.3;
      if (!tw) continue;
      g.globalAlpha = Math.max(0, 1 - k / 1.6);
      g.fillStyle = i % 3 === 0 ? '#ffffff' : col;
      g.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      if (i % 4 === 0 && k < 0.8) {
        g.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1);
        g.fillRect(Math.round(sx), Math.round(sy) - 1, 1, 3);
      }
    }
    g.globalAlpha = 1;
  }

  private fireworks(p: Painter, e: Ev, age: number, horizon: number) {
    const d = e.data!;
    const g = p.g;
    for (let i = 0; i < d.length; i += 5) {
      const a = age - d[i];
      if (a < -0.7 || a > 1.9) continue;
      const bx = d[i + 1];
      const by = d[i + 2];
      const ci = d[i + 3];
      if (a < 0) {
        // rocket climbing from behind the horizon
        const k = (a + 0.7) / 0.7;
        const ry = horizon + 4 + (by - horizon - 4) * (1 - (1 - k) ** 2);
        g.fillStyle = '#fff3c0';
        g.fillRect(Math.round(bx), Math.round(ry), 1, 1);
        g.fillStyle = 'rgba(255,200,120,0.5)';
        g.fillRect(Math.round(bx), Math.round(ry) + 1, 1, 2);
        continue;
      }
      if (a < 0.35) {
        g.globalCompositeOperation = 'lighter';
        glowSprite(p, bx, by, 12, FW_RGB[ci], 0.55 * (1 - a / 0.35));
        g.globalCompositeOperation = 'source-over';
      }
      const R = d[i + 4];
      const r = R * (1 - Math.exp(-3.2 * a));
      const fadeA = Math.max(0, 1 - a / 1.9);
      g.fillStyle = FW[ci];
      for (let j = 0; j < 14; j++) {
        if (a > 1.1 && (j + Math.floor(a * 20)) % 3 === 0) continue; // crackle as it fades
        const ang = (j / 14) * Math.PI * 2 + i;
        const x = bx + Math.cos(ang) * r;
        const y = by + Math.sin(ang) * r * 0.9 + 3 * a * a;
        g.globalAlpha = fadeA;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
        if (a < 0.6) {
          g.globalAlpha = fadeA * 0.45;
          g.fillRect(Math.round(bx + Math.cos(ang) * r * 0.6), Math.round(by + Math.sin(ang) * r * 0.55 + 2 * a * a), 1, 1);
        }
      }
      g.globalAlpha = 1;
    }
  }

  private sillBird(p: Painter, e: Ev, age: number, c: ViewCtx) {
    const spr = birdSprites[c.season === 3 || c.season === 2 ? 0 : c.season === 0 ? 1 : 2];
    const feet = WH;
    const inT = 1.6;
    const caught = e.caught >= 0 ? c.time - e.caught : -1;
    const outLen = caught >= 0 ? 0.9 : 1.6;
    const outStart = caught >= 0 ? e.caught - e.t0 : e.dur - outLen;
    // where it is on the sill: a hop every now and then
    let sx = e.x;
    let face: 1 | -1 = (e.dir > 0 ? 1 : -1) as 1 | -1;
    let hopY = 0;
    let peck = false;
    const sitAge = Math.min(age, outStart) - inT;
    if (sitAge > 0) {
      const seg = Math.floor(sitAge / 1.4);
      for (let k = 0; k <= seg; k++) {
        const h = h01(e.seed + k * 17);
        const within = k === seg ? (sitAge % 1.4) / 1.4 : 1;
        if (h < 0.35) {
          const dx = h01(e.seed + k * 31) < 0.5 ? -3 : 3;
          const nx = Math.max(4, Math.min(WW - 10, sx + dx));
          face = dx > 0 ? 1 : -1;
          if (k === seg) {
            const prog = Math.min(1, within / 0.25);
            hopY = -Math.round(Math.sin(prog * Math.PI) * 2);
            sx += (nx - sx) * prog;
          } else sx = nx;
        } else if (h < 0.6) {
          if (k === seg) peck = within > 0.2 && Math.floor(within * 6) % 2 === 0;
        } else if (h < 0.75 && k === seg) face = (face * -1) as 1 | -1;
      }
    }
    let x: number;
    let y: number;
    let fly = false;
    if (age < inT) {
      const k = age / inT;
      const fromX = e.dir > 0 ? -8 : WW + 2;
      x = fromX + (sx - fromX) * k;
      y = feet - 5 - 18 * (1 - k) * (1 - k) - Math.sin(k * Math.PI) * 4;
      fly = true;
      face = e.dir;
    } else if (age >= outStart) {
      const k = Math.min(1, (age - outStart) / outLen);
      const away = caught >= 0 ? -face : face;
      x = sx + away * k * k * 70;
      y = feet - 5 - k * 30 - Math.sin(k * 6) * 1.5;
      fly = true;
      face = away as 1 | -1;
      if (k >= 1) {
        if (caught >= 0) this.feather(p, e, caught);
        return;
      }
    } else {
      x = sx;
      y = feet - 5 + hopY;
    }
    const s = fly ? (Math.floor(c.time * 14) % 2 ? spr.flyA : spr.flyB) : peck ? spr.peck : spr.sit;
    drawSprite(p, s, Math.round(x), Math.round(y), face < 0);
    if (caught >= 0) this.feather(p, e, caught);
    else if (!fly) this.addHit(e, x + 3, y + 2, 7);
  }

  private feather(p: Painter, e: Ev, k: number) {
    if (k > 4) return;
    const fx = e.cx + Math.sin(k * 3) * 3;
    const fy = e.cy - 2 + k * 2.2;
    if (fy > WH) return;
    p.g.globalAlpha = Math.min(1, (4 - k) / 1.5);
    p.px(fx, fy, '#efe6d8');
    p.px(fx + (Math.sin(k * 3) > 0 ? 1 : -1), fy - 1, '#d8ccb8');
    p.g.globalAlpha = 1;
  }
}

/** 0..1 envelope: fade in over `fin` seconds, out over the last `fout`. */
function fade(age: number, dur: number, fin: number, fout: number) {
  return Math.max(0, Math.min(1, age / fin, (dur - age) / fout));
}
