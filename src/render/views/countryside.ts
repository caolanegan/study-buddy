// 'countryside': rolling hills under a patchwork of fields that change with the seasons (fresh green and
// rapeseed in spring, gold wheat in summer, ploughed furrows and hay bales in autumn, white in winter),
// a windmill with turning sails, a farmhouse with chimney smoke, grazing sheep, a tractor now and then,
// fireflies on summer nights.
import { Painter, glowSprite } from '../pixel';
import type { WorldEventKind } from '../scene';
import { WW, WH, Layers, h01, roundTree, fillProfile, SNOW, SNOW_SHADE, type Depth, type View, type ViewCtx } from './common';
import { smoke, drawFoxSprite } from './street';
import { drawDeer } from './forest';

const farTop = (x: number) => 22 + 2 * Math.sin(x * 0.09 + 1) + 1.2 * Math.sin(x * 0.23);
const midTop = (x: number) => 28 + 2.5 * Math.sin(x * 0.07 + 0.4) + 1.3 * Math.sin(x * 0.19 + 2);
const nearTop = (x: number) => 41 + 1.8 * Math.sin(x * 0.08 + 1);
const laneY = (x: number) => 44.5 + Math.sin(x * 0.06) * 1.2;
const FENCE_Y = 51;
const MILL_X = 14;
const FARM_X = 44;

const FIELDS: string[][] = [
  ['#8fd47e', '#6cbf5e', '#a8dc8a', '#f2e05a', '#7cc96b'],
  ['#e3c25a', '#d4b04a', '#5aa64f', '#8fbf5a', '#e8cf70'],
  ['#8a6a4a', '#a07a52', '#c8b070', '#7a8a40', '#9a7a50'],
  ['#eef3f8', '#e2e9f0', '#eef3f8', '#dfe6ee', '#e8eef4'],
];
const HEDGE = ['#3f7a3a', '#2f6a34', '#6a5a3a', '#7a8088'];
const PASTURE = ['#7cc96b', '#5aa64f', '#9a9a4a', '#eef3f8'];
const PASTURE_DARK = ['#62b058', '#4a9044', '#848440', '#d6e0ea'];

// sheep: home x, home y
const SHEEP: [number, number][] = [[10, 46], [19, 48], [27, 45], [52, 47], [60, 49]];

const LEAVES = [[FARM_X - 6, 26, 8, 6]] as const;
const NONE = [] as const;

export class CountrysideView implements View {
  readonly horizon = 24;
  readonly ground = 40;
  private layers = new Layers(3);
  private tractor = -1;
  private tractorDir: 1 | -1 = 1;
  private deer = -1;
  private fox = -1;
  private critterDir: 1 | -1 = 1;
  private flies = false;

  leafSources(c: ViewCtx) {
    return c.season === 3 ? NONE : LEAVES;
  }

  startEvent(kind: WorldEventKind, _c: ViewCtx, t0: number) {
    const dir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
    if (kind === 'tractor') {
      this.tractor = t0;
      this.tractorDir = dir;
      return true;
    }
    if (kind === 'deer') {
      this.deer = t0;
      this.critterDir = dir;
      return true;
    }
    if (kind === 'fox') {
      this.fox = t0;
      this.critterDir = dir;
      return true;
    }
    return false;
  }

  draw(c: ViewCtx, d: Depth) {
    this.layers.ensure(`${c.season}|${c.snowy}`, (p, i) => (i === 0 ? this.paintFar(p, c) : i === 1 ? this.paintMid(p, c) : this.paintNear(p, c)));
    const p = d.p;
    const m = d.main;

    d.blit(this.layers.cs[0]);
    d.flush(0.8);

    d.blit(this.layers.cs[1]);
    this.sails(p, c);
    smoke(p, FARM_X + 4, 26, c, 2, c.season >= 2 ? 14 : 10);
    if (this.deer >= 0) this.drawCritter(p, c, 'deer');
    d.flush(0.25);
    if (c.night > 0.2) {
      const a = c.night;
      m.px(FARM_X + 2, 31, `rgba(255,214,120,${a})`);
      m.px(FARM_X + 5, 31, `rgba(255,214,120,${a})`);
      m.g.globalCompositeOperation = 'lighter';
      glowSprite(m, FARM_X + 13, 30, 5, [255, 210, 130], 0.5 * a);
      m.g.globalCompositeOperation = 'source-over';
      m.px(FARM_X + 13, 30, `rgba(255,236,170,${a})`);
    }

    d.blit(this.layers.cs[2]);
    if (this.tractor >= 0) this.drawTractor(p, c);
    if (this.fox >= 0) this.drawCritter(p, c, 'fox');
    this.sheep(p, c);
    this.fence(p, c);
    d.flush(0);
    this.fireflies(m, c);
  }

  private paintFar(p: Painter, c: ViewCtx) {
    const col = c.snowy ? '#c8d4e0' : '#6f94a8';
    fillProfile(p, 0, WW - 1, farTop, 34, () => col);
    // a row of tiny trees on the far ridge
    for (let x = 3; x < WW; x += 7) p.px(x, Math.round(farTop(x)) - 1, c.snowy ? '#a8b8c8' : '#5a7e94');
  }

  private paintMid(p: Painter, c: ViewCtx) {
    const s = c.season;
    const pal = FIELDS[s];
    const hedge = HEDGE[s];
    // patchwork: field id from slanted columns and two bands
    const field = (x: number, y: number) => {
      const band = y < 33 ? 0 : y < 37.5 + Math.sin(x * 0.1) ? 1 : 2;
      const col = Math.floor((x + (y - 28) * (band === 1 ? -0.9 : 0.7) + band * 5) / 13);
      return band * 10 + col;
    };
    fillProfile(p, 0, WW - 1, midTop, 44, (x, y) => {
      const f = field(x, y);
      if (field(x + 1, y) !== f || field(x, y + 1) !== f) return hedge;
      const kind = Math.floor(h01(f * 7 + 1) * pal.length);
      const base = pal[kind];
      if (s === 2 && kind < 2 && y % 2 === 0) return '#6e5238'; // furrows
      if (s === 1 && (kind === 0 || kind === 4) && (x + y) % 3 === 0) return '#f2da82'; // wheat
      if (s === 0 && kind === 3 && (x * 3 + y) % 5 === 0) return '#fff07a';
      if (s === 3 && (x * 7 + y * 3) % 9 === 0) return SNOW_SHADE;
      return base;
    });
    // hedgerow trees
    for (const [x, y] of [[6, 33], [24, 37], [35, 32], [58, 37], [64, 31]] as const) roundTree(p, x, y + 1, 2, s, x * 3 + 1, c.snowy);
    // autumn hay bales
    if (s === 2)
      for (const [x, y] of [[20, 40], [26, 39], [31, 41], [53, 40]] as const) {
        p.disc(x, y, 1, '#d8b860');
        p.px(x, y, '#b89840');
        p.px(x + 1, y + 1, '#a88a3a');
      }
    // windmill
    const base = Math.round(midTop(MILL_X)) + 1;
    for (let y = base - 11; y < base; y++) {
      const hw = 1 + Math.floor((y - (base - 11)) / 4);
      p.rect(MILL_X - hw, y, hw * 2 + 1, 1, '#ece4d2');
      p.px(MILL_X + hw, y, '#cfc6b2');
    }
    p.rect(MILL_X - 2, base - 13, 5, 2, '#5a4a40');
    p.px(MILL_X - 1, base - 14, '#5a4a40');
    p.px(MILL_X, base - 14, '#5a4a40');
    p.px(MILL_X, base - 3, '#4a3a30');
    p.px(MILL_X, base - 2, '#4a3a30');
    p.px(MILL_X, base - 7, '#7fa8c6');
    if (c.snowy) p.rect(MILL_X - 2, base - 14, 4, 1, SNOW);
    // farmhouse, barn, silo
    const fy = 33;
    p.rect(FARM_X, fy - 5, 8, 5, '#ece6da');
    p.rect(FARM_X + 7, fy - 5, 1, 5, '#cfc8ba');
    for (let i = 0; i < 4; i++) p.rect(FARM_X - 1 + i, fy - 6 - i, 10 - i * 2, 1, '#5a5560');
    p.rect(FARM_X + 4, fy - 10, 1, 3, '#7a4a3a');
    p.rect(FARM_X + 2, fy - 2, 1, 1, '#7fa8c6');
    p.rect(FARM_X + 5, fy - 2, 1, 1, '#7fa8c6');
    p.rect(FARM_X + 3, fy - 2, 1, 2, '#6a4a30');
    p.rect(FARM_X + 2, fy - 4, 1, 1, '#7fa8c6');
    p.rect(FARM_X + 5, fy - 4, 1, 1, '#7fa8c6');
    const bx = FARM_X + 10;
    p.rect(bx, fy - 6, 9, 6, '#a8443a');
    p.rect(bx + 8, fy - 6, 1, 6, '#8a3430');
    for (let i = 0; i < 3; i++) p.rect(bx + i, fy - 7 - i, 9 - i * 2, 1, '#6a3a34');
    p.rect(bx + 3, fy - 4, 3, 4, '#f2ece0');
    p.px(bx + 4, fy - 3, '#a8443a');
    p.px(bx + 3, fy - 2, '#a8443a');
    p.px(bx + 5, fy - 2, '#a8443a');
    p.rect(bx + 10, fy - 10, 3, 10, '#a8acb4');
    p.rect(bx + 12, fy - 10, 1, 10, '#8a8e96');
    p.rect(bx + 10, fy - 11, 3, 1, '#7a7e86');
    p.px(bx + 11, fy - 12, '#7a7e86');
    if (c.snowy) {
      p.rect(FARM_X - 1, fy - 7, 10, 1, SNOW);
      p.rect(FARM_X + 1, fy - 9, 6, 1, SNOW);
      p.rect(bx, fy - 8, 9, 1, SNOW);
      p.rect(bx + 2, fy - 9, 5, 1, SNOW);
      p.rect(bx + 10, fy - 12, 3, 1, SNOW);
    }
    roundTree(p, FARM_X - 3, fy, 3, s, 7, c.snowy);
  }

  private paintNear(p: Painter, c: ViewCtx) {
    const s = c.season;
    fillProfile(p, 0, WW - 1, nearTop, WH, (x, y) => ((x * 5 + y * 3) % 7 === 0 ? PASTURE_DARK[s] : PASTURE[s]));
    // dirt lane
    for (let x = 0; x < WW; x++) {
      const y = Math.round(laneY(x));
      p.rect(x, y, 1, 2, c.snowy ? '#e2e8ee' : s === 2 ? '#a88a62' : '#c8b088');
      if (c.snowy && x % 3 === 0) p.px(x, y + 1, '#c8d0da');
      else if (!c.snowy && x % 4 === 0) p.px(x, y + 1, '#b09870');
    }
    // flowers / tufts
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(h01(i * 3) * WW);
      const y = Math.floor(47 + h01(i * 7) * (WH - 47));
      const col = s === 0 ? ['#f7b5cf', '#ffffff', '#f2e05a'][i % 3] : s === 1 ? (i % 4 === 0 ? '#e8463a' : '#f2e05a') : s === 2 ? '#c8a050' : '#ffffff';
      if (s === 3 && i % 2) continue;
      p.px(x, y, col);
    }
  }

  private sails(p: Painter, c: ViewCtx) {
    const base = Math.round(midTop(MILL_X)) + 1;
    const hx = MILL_X;
    const hy = base - 10;
    const speed = c.weather === 'storm' ? 2.2 : c.weather === 'clear' ? 0.6 : 0.9;
    const a0 = c.time * speed;
    const col = '#6a5040';
    const cloth = c.snowy ? '#e8eef4' : '#f2ece0';
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k * Math.PI) / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let r = 1; r <= 7; r++) {
        const x = hx + ca * r;
        const y = hy + sa * r;
        p.px(x, y, col);
        if (r >= 3) p.px(x - sa * 1.2, y + ca * 1.2, cloth);
      }
    }
    p.px(hx, hy, '#3a2a20');
  }

  private sheep(p: Painter, c: ViewCtx) {
    const lying = c.night > 0.7;
    SHEEP.forEach(([hx, hy], i) => {
      const t = c.time * 0.05 + i * 1.7;
      const x = Math.round(hx + Math.sin(t) * 5 + Math.sin(t * 2.3) * 1.5);
      const y = Math.round(hy + Math.sin(t * 0.8 + i) * 1.2);
      const vx = Math.cos(t) + Math.cos(t * 2.3) * 0.7;
      const face = vx >= 0 ? 1 : -1;
      const graze = Math.sin(c.time * 0.5 + i * 2) > 0.2;
      const wool = c.snowy ? '#f8f6f0' : '#f2efe6';
      p.rect(x, y - 3, 4, 2, wool);
      p.rect(x, y - 1, 4, 1, '#d8d2c4');
      p.px(x + 1, y - 4, wool);
      const hx2 = face > 0 ? x + 4 : x - 1;
      p.px(hx2, y - (graze && !lying ? 1 : 3), '#3a3a40');
      if (!lying) {
        p.px(x, y, '#3a3a40');
        p.px(x + 3, y, '#3a3a40');
      }
    });
  }

  private fence(p: Painter, c: ViewCtx) {
    const wood = '#7a5a3a';
    for (let x = 1; x < WW; x += 6) {
      p.rect(x, FENCE_Y - 4, 1, 5, wood);
      if (c.snowy) p.px(x, FENCE_Y - 5, SNOW);
    }
    p.rect(0, FENCE_Y - 3, WW, 1, '#8a6a48');
    p.rect(0, FENCE_Y - 1, WW, 1, '#8a6a48');
  }

  private drawTractor(p: Painter, c: ViewCtx) {
    const age = c.time - this.tractor;
    const dur = 24;
    if (age < 0 || age > dur) {
      if (age > dur) this.tractor = -1;
      return;
    }
    const dir = this.tractorDir;
    const x = Math.round(dir > 0 ? -10 + (age / dur) * (WW + 20) : WW + 10 - (age / dur) * (WW + 20));
    const y = Math.round(laneY(x)) + 1;
    const body = '#c8443a';
    const back = dir > 0 ? x : x + 4;
    const front = dir > 0 ? x + 5 : x;
    p.rect(x, y - 4, 7, 2, body);
    p.rect(back, y - 7, 3, 3, body);
    p.rect(back, y - 7, 3, 1, '#3a3a44');
    p.px(back + 1, y - 6, '#9fd3f0');
    p.rect(dir > 0 ? x + 4 : x + 2, y - 6, 1, 2, '#3a3a44'); // exhaust
    const bounce = Math.floor(c.time * 6) % 2;
    p.disc(back + 1, y - 1, 2, '#2d2d35');
    p.px(back + 1, y - 1 - bounce, '#7a7a84');
    p.rect(front, y - 1, 2, 2, '#2d2d35');
    // exhaust puffs + dust
    for (let i = 0; i < 4; i++) {
      const k = (c.time * 0.9 + i / 4) % 1;
      p.g.fillStyle = `rgba(200,200,205,${0.6 * (1 - k)})`;
      p.g.fillRect(Math.round((dir > 0 ? x + 4 : x + 2) - dir * k * 4), Math.round(y - 7 - k * 6), 1, 1);
      if (!c.wet && !c.snowy) {
        p.g.fillStyle = `rgba(200,176,136,${0.5 * (1 - k)})`;
        p.g.fillRect(Math.round(back - dir * (2 + k * 6)), Math.round(y - k * 2), 2, 1);
      }
    }
  }

  private drawCritter(p: Painter, c: ViewCtx, kind: 'deer' | 'fox') {
    const t0 = kind === 'deer' ? this.deer : this.fox;
    const age = c.time - t0;
    const dur = kind === 'deer' ? 22 : 14;
    if (age < 0 || age > dur) {
      if (age > dur) kind === 'deer' ? (this.deer = -1) : (this.fox = -1);
      return;
    }
    const dir = this.critterDir;
    if (kind === 'deer') {
      // a deer wanders along the field edge, stops to look around
      const pause = age > 7 && age < 12;
      const prog = pause ? 7 : age < 7 ? age : age - 5;
      const x = dir > 0 ? -6 + prog * 4.2 : WW + 6 - prog * 4.2;
      drawDeer(p, x, 39, dir, c.time, pause);
    } else {
      const x = dir > 0 ? -6 + age * 6 : WW + 6 - age * 6;
      drawFoxSprite(p, x, Math.round(laneY(x)) + 1, dir, c.time);
    }
  }

  private fireflies(m: Painter, c: ViewCtx) {
    if (c.season !== 1 || c.night < 0.6 || c.wet) {
      this.flies = false;
      return;
    }
    if (!this.flies) {
      this.flies = true;
      c.report('fireflies');
    }
    fireflies(m, c, 14, 36, WH - 4);
  }
}

/** Fireflies drifting and blinking over (y0..y1). Shared with the forest. */
export function fireflies(m: Painter, c: ViewCtx, n: number, y0: number, y1: number) {
  const g = m.g;
  for (let i = 0; i < n; i++) {
    const blink = Math.sin(c.time * (1.1 + h01(i) * 1.4) + i * 4.1);
    if (blink < 0.2) continue;
    const a = (blink - 0.2) / 0.8;
    const x = (h01(i * 5) * WW + Math.sin(c.time * 0.31 + i) * 6 + Math.sin(c.time * 0.9 + i * 2) * 2 + WW) % WW;
    const y = y0 + h01(i * 9) * (y1 - y0) + Math.sin(c.time * 0.5 + i * 1.3) * 3;
    g.globalCompositeOperation = 'lighter';
    glowSprite(m, x, y, 3, [200, 255, 120], a * 0.5 * c.night);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(230,255,150,${a * c.night})`;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}
