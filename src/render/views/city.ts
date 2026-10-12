// 'city': a skyline at three depths with hundreds of windows that switch on and off through the evening,
// a rooftop water tower, blinking antenna lights, a neon sign, an elevated train every so often (lit
// carriages at night), a glimpse of the street with a traffic light, planes at night and the odd helicopter.
// Rain makes the street and rooftops reflective.
import { Painter, glowSprite } from '../pixel';
import type { WorldEventKind } from '../scene';
import { WW, WH, Layers, drawLitWindows, h01, litChance, roundTree, SNOW, SNOW_SHADE, type Depth, type View, type ViewCtx } from './common';

// far towers: x, w, top
const FAR: [number, number, number][] = [
  [0, 6, 20], [5, 5, 15], [9, 7, 22], [16, 4, 11], [19, 8, 18], [26, 6, 25], [31, 5, 13], [35, 9, 21],
  [43, 6, 17], [48, 7, 23], [54, 5, 8], [58, 8, 19], [65, 5, 14],
];
const FAR_BOTTOM = 44;
// mid buildings: x, w, top, colour
const MID: [number, number, number, string][] = [
  [-1, 11, 25, '#5a6478'], [10, 9, 31, '#6a5a58'], [20, 12, 22, '#4f5d6c'], [33, 9, 29, '#6a6a7a'],
  [43, 11, 23, '#5c5052'], [55, 14, 27, '#485868'],
];
const MID_BOTTOM = 52;
const TRACK_Y = 45;
const NEAR_L = { x: 0, w: 26, top: 50 };
const NEAR_R = { x: 45, w: 23, top: 47 };
const GAP_Y = 54; // street level seen in the gap

const grid = (bs: [number, number, number, ...unknown[]][], bottom: number, sx: number, sy: number, ww: number, wh: number, skip = 0) => {
  const out: number[] = [];
  bs.forEach(([x, w, top], bi) => {
    for (let y = top + 2; y < bottom - 1; y += sy)
      for (let wx = x + 1 + ((bi + skip) % 2); wx + ww <= x + w - 1; wx += sx) out.push(wx, y, ww, wh);
  });
  return Int16Array.from(out);
};
const FAR_WIN = grid(FAR, FAR_BOTTOM, 2, 2, 1, 1);
const MID_WIN = grid(MID, TRACK_Y - 1, 3, 3, 2, 2);
const NEAR_WIN = Int16Array.from([47, 49, 2, 2, 51, 49, 2, 2, 55, 49, 2, 2, 59, 49, 2, 2, 63, 49, 2, 2, 47, 53, 2, 2, 55, 53, 2, 2, 63, 53, 2, 2]);
const ANTENNAS: [number, number][] = [[56, 2], [14, 26], [64, 40]];
const NONE = [] as const;
const LEAVES = [[26, 48, 18, 6]] as const;

export class CityView implements View {
  readonly horizon = 22;
  readonly ground = 47;
  private layers = new Layers(3);
  private heli = -1;
  private heliDir: 1 | -1 = 1;
  private trainForce = -1;
  private lastTrainSlot = -1;
  private lastPlaneSlot = -1;

  leafSources(c: ViewCtx) {
    return c.season === 3 ? NONE : LEAVES;
  }

  startEvent(kind: WorldEventKind, _c: ViewCtx, t0: number) {
    if (kind === 'helicopter') {
      this.heli = t0;
      this.heliDir = Math.random() < 0.5 ? 1 : -1;
      return true;
    }
    if (kind === 'train') {
      this.trainForce = t0;
      return true;
    }
    return false;
  }

  drawSky(c: ViewCtx, p: Painter) {
    this.plane(c, p);
  }

  draw(c: ViewCtx, d: Depth) {
    this.layers.ensure(`${c.season}|${c.snowy}|${c.wet}|${c.month === 11}`, (p, i) => (i === 0 ? this.paintFar(p, c) : i === 1 ? this.paintMid(p, c) : this.paintNear(p, c)));
    const p = d.p;
    const m = d.main;
    const chance = litChance(c, 0.7);

    d.blit(this.layers.cs[0]);
    d.flush(0.75);
    drawLitWindows(m, FAR_WIN, c, 11, chance * 0.9, 0.75);
    this.antenna(m, c, 0);
    // the helicopter weaves between the far towers and the nearer blocks
    if (this.heli >= 0) this.helicopter(c, m);

    d.blit(this.layers.cs[1]);
    d.flush(0.3);
    drawLitWindows(m, MID_WIN, c, 12, chance);
    this.antenna(m, c, 1);
    this.neon(m, c);

    // the elevated train (drawn over the mid layer, under the near rooftops)
    const train = this.trainAt(c);
    if (train) this.drawTrain(p, this.tx, this.tdir, c);
    d.flush(0.1);
    if (train && c.night > 0.2) this.trainLights(m, this.tx, this.tdir, c);

    d.blit(this.layers.cs[2]);
    this.street(p, c);
    d.flush(0);
    drawLitWindows(m, NEAR_WIN, c, 13, chance * 0.8);
    this.antenna(m, c, 2);
    this.streetLights(m, c);
  }

  private paintFar(p: Painter, c: ViewCtx) {
    const col = '#7584a0';
    const dark = '#66748e';
    for (const [x, w, top] of FAR) {
      p.rect(x, top, w, FAR_BOTTOM - top + 2, col);
      p.rect(x + w - 1, top, 1, FAR_BOTTOM - top + 2, dark);
      if (c.snowy) p.rect(x, top, w, 1, '#dde4ee');
    }
    // the spire tower and the tall one with an antenna mast
    p.rect(17, 6, 2, 5, col);
    p.px(17, 3, col);
    p.px(17, 4, col);
    p.px(17, 5, col);
    p.rect(54, 7, 5, 1, dark);
    p.rect(56, 2, 1, 6, dark);
    // daytime glass glints
    for (let i = 0; i < FAR_WIN.length; i += 4) if (h01(i) < 0.3) p.px(FAR_WIN[i], FAR_WIN[i + 1], '#8a9ab8');
  }

  private paintMid(p: Painter, c: ViewCtx) {
    MID.forEach(([x, w, top, col], i) => {
      p.rect(x, top, w, MID_BOTTOM - top, col);
      p.rect(x, top, w, 1, '#ffffff22');
      p.rect(x + w - 1, top, 1, MID_BOTTOM - top, '#00000030');
      // parapet + rooftop box
      p.rect(x, top - 1, w, 1, '#00000040');
      if (i % 2 === 0) p.rect(x + 2, top - 3, 3, 2, col);
      if (c.snowy) {
        p.rect(x, top - 1, w, 1, SNOW);
        if (i % 2 === 0) p.rect(x + 2, top - 4, 3, 1, SNOW);
      }
    });
    for (let i = 0; i < MID_WIN.length; i += 4) {
      const reflect = h01(i * 3) < 0.25;
      p.rect(MID_WIN[i], MID_WIN[i + 1], 2, 2, reflect ? '#a8c4dc' : '#33405a');
      if (!reflect) p.px(MID_WIN[i], MID_WIN[i + 1], '#46567a');
    }
    // water tower on the wide roof
    const wx = 24;
    const wy = 14;
    p.rect(wx, wy + 5, 1, 3, '#3a2a20');
    p.rect(wx + 4, wy + 5, 1, 3, '#3a2a20');
    p.rect(wx + 2, wy + 5, 1, 3, '#3a2a20');
    p.rect(wx, wy, 5, 5, '#8a5a3a');
    p.rect(wx, wy + 1, 5, 1, '#6a4028');
    p.rect(wx, wy + 3, 5, 1, '#6a4028');
    p.rect(wx + 4, wy, 1, 5, '#6a4028');
    p.rect(wx + 1, wy - 1, 3, 1, '#5a4a40');
    p.px(wx + 2, wy - 2, '#5a4a40');
    if (c.snowy) {
      p.rect(wx + 1, wy - 2, 3, 1, SNOW);
      p.px(wx + 2, wy - 3, SNOW);
    }
    // antenna mast on the narrow tower
    p.rect(14, 26, 1, 5, '#3a3a44');
    p.rect(13, 28, 3, 1, '#3a3a44');
    // neon sign bracket
    p.rect(41, 33, 1, 8, '#2a2a34');
    // the elevated track
    p.rect(0, TRACK_Y, WW, 2, '#7a7a84');
    p.rect(0, TRACK_Y + 2, WW, 1, '#55555e');
    for (let x = 4; x < WW; x += 16) p.rect(x, TRACK_Y + 3, 2, MID_BOTTOM - TRACK_Y, '#6a6a74');
    for (let x = 0; x < WW; x += 3) p.px(x, TRACK_Y - 1, '#4a4a54'); // rail
    if (c.snowy) p.rect(0, TRACK_Y, WW, 1, SNOW_SHADE);
    // a street level strip under it
    p.rect(0, MID_BOTTOM, WW, WH - MID_BOTTOM, '#4a4a52');
  }

  private paintNear(p: Painter, c: ViewCtx) {
    const L = NEAR_L;
    const R = NEAR_R;
    // left: a flat roof with a parapet, a rooftop door hut and a water tower
    p.rect(L.x, L.top, L.w, WH - L.top, c.wet ? '#55555f' : '#6a6a72');
    p.rect(L.x, L.top, L.w, 1, '#8a8a94');
    p.rect(L.x + L.w - 1, L.top, 1, WH - L.top, '#4a4a54');
    for (let x = 2; x < L.w - 1; x += 5) p.px(x, L.top + 4, '#5a5a64');
    p.rect(14, L.top - 5, 7, 5, '#8a4a3a');
    p.rect(13, L.top - 6, 9, 1, '#5a3a30');
    p.rect(16, L.top - 3, 2, 3, '#3a2a28');
    // water tower
    const wx = 4;
    const wy = 37;
    for (const lx of [wx, wx + 2, wx + 5]) p.rect(lx, wy + 6, 1, L.top - wy - 6, '#3a2a20');
    p.line(wx, wy + 7, wx + 5, L.top - 1, '#3a2a20');
    p.rect(wx - 1, wy, 7, 6, '#9a6a44');
    p.rect(wx - 1, wy + 1, 7, 1, '#6a4028');
    p.rect(wx - 1, wy + 4, 7, 1, '#6a4028');
    p.rect(wx + 5, wy, 1, 6, '#7a4c30');
    p.rect(wx, wy - 1, 5, 1, '#5a4a40');
    p.rect(wx + 1, wy - 2, 3, 1, '#5a4a40');
    p.px(wx + 2, wy - 3, '#5a4a40');
    // right: a brick building top with AC units and an antenna
    p.rect(R.x, R.top, R.w, WH - R.top, '#8a4a3a');
    for (let y = R.top + 2; y < WH; y += 2) for (let x = R.x + ((y / 2) % 2) * 2; x < WW; x += 4) p.px(x, y, '#7a3e30');
    p.rect(R.x, R.top - 1, R.w, 1, '#a85a48');
    for (let i = 0; i < NEAR_WIN.length; i += 4) p.rect(NEAR_WIN[i], NEAR_WIN[i + 1], 2, 2, '#2e3448');
    p.rect(48, R.top - 3, 4, 2, '#9a9aa4');
    p.rect(48, R.top - 3, 4, 1, '#b8b8c0');
    p.rect(55, R.top - 2, 3, 1, '#9a9aa4');
    p.rect(64, 40, 1, 6, '#3a3a44');
    p.rect(62, 43, 5, 1, '#3a3a44');
    if (c.snowy) {
      p.rect(L.x, L.top - 1, L.w, 1, SNOW);
      p.rect(13, L.top - 7, 9, 1, SNOW);
      p.rect(wx - 1, wy - 1, 7, 1, SNOW);
      p.rect(R.x, R.top - 2, R.w, 1, SNOW);
      p.rect(48, R.top - 4, 4, 1, SNOW);
    }
    if (c.month === 11) for (let x = R.x; x < WW; x += 2) p.px(x, R.top + 1, ['#ff5a5a', '#5aff8a', '#ffd25a', '#5ab8ff'][(x >> 1) % 4]);
    // the street far below in the gap, with two street trees
    p.rect(L.w, GAP_Y - 2, R.x - L.w, 1, '#8a8a90');
    p.rect(L.w, GAP_Y - 1, R.x - L.w, WH - GAP_Y + 1, c.wet ? '#34343c' : '#3e3e46');
    for (let x = L.w + 1; x < R.x; x += 4) p.rect(x, GAP_Y + 1, 2, 1, '#c8b860');
    roundTree(p, 30, GAP_Y - 1, 3, c.season, 5, c.snowy);
    roundTree(p, 40, GAP_Y - 1, 3, c.season, 9, c.snowy);
    p.rect(35, GAP_Y - 8, 1, 7, '#2d2d35'); // traffic light pole
    p.rect(34, GAP_Y - 10, 3, 3, '#2d2d35');
  }

  private tx = 0;
  private tdir: 1 | -1 = 1;
  /** Train pass: every ~47s (or when forced). Sets this.tx / this.tdir; false when no train. */
  private trainAt(c: ViewCtx): boolean {
    const len = 42;
    const speed = 30;
    const passT = (WW + len + 10) / speed;
    let age: number;
    let dir: 1 | -1;
    if (this.trainForce >= 0 && c.time - this.trainForce < passT) {
      age = c.time - this.trainForce;
      dir = 1;
    } else {
      const period = 47;
      const slot = Math.floor(c.time / period);
      age = c.time - slot * period;
      dir = slot % 2 ? 1 : -1;
      if (age > passT) return false;
      if (slot !== this.lastTrainSlot) {
        this.lastTrainSlot = slot;
        c.report('train');
      }
    }
    this.tx = dir > 0 ? -len - 4 + age * speed : WW + 4 - age * speed;
    this.tdir = dir;
    return true;
  }

  private drawTrain(p: Painter, x: number, dir: 1 | -1, c: ViewCtx) {
    const y = TRACK_Y - 7;
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(x + k * 14);
      p.rect(cx, y, 13, 6, '#c8ccd4');
      p.rect(cx, y, 13, 1, '#e4e8ee');
      p.rect(cx, y + 4, 13, 1, k === 1 ? '#3a8a5a' : '#c84a3a');
      for (let w = 1; w < 12; w += 3) p.rect(cx + w, y + 1, 2, 2, '#4a5468');
      p.rect(cx, y + 5, 13, 1, '#5a5a64');
      if (c.snowy) p.rect(cx, y - 1, 13, 1, SNOW);
    }
    // nose
    const head = dir > 0 ? Math.round(x + 41) : Math.round(x - 1);
    p.rect(head, y + 1, 1, 4, '#c8ccd4');
  }

  private trainLights(m: Painter, x: number, dir: 1 | -1, c: ViewCtx) {
    const y = TRACK_Y - 7;
    const g = m.g;
    g.fillStyle = `rgba(255,230,160,${c.night})`;
    for (let k = 0; k < 3; k++) {
      const cx = Math.round(x + k * 14);
      for (let w = 1; w < 12; w += 3) g.fillRect(cx + w, y + 1, 2, 2);
    }
    g.globalCompositeOperation = 'lighter';
    const head = dir > 0 ? x + 42 : x - 2;
    glowSprite(m, head, y + 3, 7, [255, 240, 190], 0.6 * c.night);
    glowSprite(m, x + 21, y + 3, 22, [255, 220, 150], 0.15 * c.night);
    g.globalCompositeOperation = 'source-over';
  }

  private antenna(m: Painter, c: ViewCtx, i: number) {
    const [x, y] = ANTENNAS[i];
    const on = (c.time + i * 0.7) % 1.6 < 0.5;
    if (!on) return;
    const a = 0.5 + 0.5 * c.night;
    m.px(x, y, `rgba(255,60,50,${a})`);
    if (c.night > 0.3) {
      m.g.globalCompositeOperation = 'lighter';
      glowSprite(m, x + 0.5, y + 0.5, 3, [255, 60, 50], 0.6 * c.night);
      m.g.globalCompositeOperation = 'source-over';
    }
  }

  private neon(m: Painter, c: ViewCtx) {
    if (c.night < 0.25) return;
    // flickers now and then
    const f = h01(Math.floor(c.time * 8));
    if (f < 0.04) return;
    const a = c.night;
    const g = m.g;
    g.fillStyle = `rgba(255,110,190,${a})`;
    g.fillRect(39, 34, 2, 1);
    g.fillRect(39, 36, 2, 1);
    g.fillRect(39, 38, 2, 1);
    g.fillStyle = `rgba(110,230,255,${a})`;
    g.fillRect(39, 35, 1, 1);
    g.fillRect(40, 37, 1, 1);
    g.globalCompositeOperation = 'lighter';
    glowSprite(m, 40, 36, 5, [255, 110, 190], 0.45 * a);
    g.globalCompositeOperation = 'source-over';
  }

  /** Cars in the gap, far below. */
  private street(p: Painter, c: ViewCtx) {
    const x0 = NEAR_L.w;
    const span = NEAR_R.x - x0;
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 ? 1 : -1;
      const v = 4 + i * 1.5;
      const raw = (c.time * v + i * 13) % (span + 6);
      const x = dir > 0 ? x0 - 3 + raw : NEAR_R.x + 3 - raw;
      p.rect(Math.round(x), GAP_Y + (dir > 0 ? 2 : 0), 3, 1, ['#d9534f', '#f2b134', '#3f6f8f'][i]);
    }
  }

  private streetLights(m: Painter, c: ViewCtx) {
    const g = m.g;
    // traffic light: green 6s, amber 1.5s, red 5s
    const cyc = c.time % 12.5;
    const col = cyc < 6 ? [90, 255, 140] : cyc < 7.5 ? [255, 190, 60] : [255, 70, 60];
    const ly = cyc < 6 ? GAP_Y - 8 : cyc < 7.5 ? GAP_Y - 9 : GAP_Y - 10;
    g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    g.fillRect(35, ly, 1, 1);
    if (c.night > 0.2) {
      g.globalCompositeOperation = 'lighter';
      glowSprite(m, 35.5, ly + 0.5, 4, col as [number, number, number], 0.5 * c.night);
      g.globalCompositeOperation = 'source-over';
      const x0 = NEAR_L.w;
      const span = NEAR_R.x - x0;
      for (let i = 0; i < 3; i++) {
        const dir = i % 2 ? 1 : -1;
        const v = 4 + i * 1.5;
        const raw = (c.time * v + i * 13) % (span + 6);
        const x = Math.round(dir > 0 ? x0 - 3 + raw : NEAR_R.x + 3 - raw);
        const y = GAP_Y + (dir > 0 ? 2 : 0);
        if (x < x0 || x > NEAR_R.x - 1) continue;
        g.fillStyle = `rgba(255,245,200,${c.night})`;
        g.fillRect(dir > 0 ? x + 2 : x, y, 1, 1);
        g.fillStyle = `rgba(255,60,50,${c.night})`;
        g.fillRect(dir > 0 ? x : x + 2, y, 1, 1);
      }
    }
    if (c.wet) {
      // wet street + rooftop puddles reflect the lights
      for (let y = GAP_Y; y < WH; y += 1) {
        if ((y + Math.floor(c.time * 5)) % 2) continue;
        g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.25 + 0.3 * c.night})`;
        g.fillRect(35 + ((y * 7) % 2), y, 1, 1);
      }
      const warm = c.night > 0.3;
      for (let i = 0; i < 6; i++) {
        const x = 2 + i * 4;
        const y = NEAR_L.top + 2 + (i % 3) * 2;
        g.fillStyle = warm ? `rgba(255,214,120,${0.18 + 0.12 * Math.sin(c.time * 2 + i)})` : `rgba(200,220,240,${0.25 + 0.1 * Math.sin(c.time * 2 + i)})`;
        g.fillRect(x, y, 3, 1);
      }
    }
  }

  private plane(c: ViewCtx, p: Painter) {
    const period = 75;
    const slot = Math.floor(c.time / period);
    const age = c.time - slot * period;
    const dur = 26;
    if (age > dur || c.weather === 'storm') return;
    if (slot !== this.lastPlaneSlot) {
      this.lastPlaneSlot = slot;
      if (c.night > 0.5) c.report('plane');
    }
    const dir = h01(slot + 3) < 0.5 ? 1 : -1;
    const x = Math.round(dir > 0 ? -6 + (age / dur) * (WW + 12) : WW + 6 - (age / dur) * (WW + 12));
    const y = Math.round(5 + h01(slot) * 6 - age * 0.08);
    if (c.night > 0.4) {
      const blink = (c.time % 1.2) < 0.15;
      p.px(x, y, 'rgba(255,80,70,0.9)');
      p.px(x + 2 * dir, y, 'rgba(120,255,140,0.9)');
      if (blink) {
        p.g.globalCompositeOperation = 'lighter';
        glowSprite(p, x + dir, y, 3, [255, 255, 255], 0.9);
        p.g.globalCompositeOperation = 'source-over';
        p.px(x + dir, y, '#ffffff');
      }
    } else {
      const col = '#8a90a0';
      p.rect(x - 2, y, 5, 1, col);
      p.px(x - 2 * dir, y - 1, col);
      p.px(x, y + 1, col);
      // contrail
      p.g.fillStyle = 'rgba(255,255,255,0.45)';
      p.g.fillRect(dir > 0 ? x - 14 : x + 3, y, 11, 1);
    }
  }

  private helicopter(c: ViewCtx, p: Painter) {
    const age = c.time - this.heli;
    const dur = 20;
    if (age < 0 || age > dur) {
      if (age > dur) this.heli = -1;
      return;
    }
    const dir = this.heliDir;
    const x = Math.round(dir > 0 ? -8 + (age / dur) * (WW + 16) : WW + 8 - (age / dur) * (WW + 16));
    const y = Math.round(11 + Math.sin(age * 0.8) * 2);
    const body = c.night > 0.5 ? '#2a2e3a' : '#c84a3a';
    p.rect(x - 2, y, 5, 3, body);
    p.rect(x + (dir > 0 ? 2 : -2), y + 1, 1, 1, '#9fd3f0');
    p.rect(dir > 0 ? x - 6 : x + 3, y + 1, 4, 1, body);
    p.px(dir > 0 ? x - 6 : x + 6, y, body);
    p.rect(x - 2, y + 3, 5, 1, '#3a3a44');
    const blade = Math.floor(c.time * 20) % 2;
    p.rect(blade ? x - 4 : x - 2, y - 1, blade ? 9 : 5, 1, '#3a3a44');
    if (c.night > 0.4) {
      if (c.time % 1 < 0.2) p.px(x, y - 1, '#ff5a50');
      const g = p.g;
      const sweep = Math.sin(age * 0.9) * 10;
      g.fillStyle = `rgba(255,250,220,${0.12 * c.night})`;
      g.beginPath();
      g.moveTo(x, y + 3);
      g.lineTo(x + sweep - 6, WH);
      g.lineTo(x + sweep + 6, WH);
      g.fill();
    }
  }
}
