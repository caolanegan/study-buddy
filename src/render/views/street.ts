// 'street': the original quiet street — houses, lamp post, a big tree, cars, pedestrians (umbrellas, dog
// walkers), chimney smoke, plus real-calendar touches (October pumpkins, December string lights).
import { Painter, glowSprite } from '../pixel';
import type { WorldEventKind } from '../scene';
import {
  WW, WH, Layers, drawLitWindows, litChance, FOLIAGE, GRASS, SNOW, SNOW_SHADE, TRUNK,
  type Depth, type View, type ViewCtx,
} from './common';

const GY = WH - 11; // ground line

interface Car { x: number; dir: 1 | -1; v: number; c: string; van: boolean }
interface Person { x: number; dir: 1 | -1; v: number; shirt: string; hair: string; dog: boolean; ph: number; umbrella: string | null; jog: boolean }

const CAR_COLORS = ['#d9534f', '#3f6f8f', '#f2b134', '#5fbf77', '#e9e4da', '#8e5bb5', '#2d2d35'];
const SHIRTS = ['#c0392b', '#2e86ab', '#f2b134', '#5fbf77', '#8e5bb5', '#e08a3c', '#e9e4da'];
const HAIR = ['#3b2a20', '#e0b050', '#1a1a1a', '#a0522d', '#c0c0c0'];
const UMBRELLAS = ['#d9534f', '#2e86ab', '#f2b134', '#2d2d35'];
const XMAS = ['#ff5a5a', '#5aff8a', '#ffd25a', '#5ab8ff'];

// x, w, h, wall, roof
const HOUSES: [number, number, number, string, string][] = [
  [-2, 14, 13, '#8c5a4a', '#5e3b33'],
  [13, 12, 17, '#6f7d8c', '#4b5563'],
  [27, 16, 11, '#a7865c', '#6e573b'],
  [44, 14, 15, '#7a6a8f', '#4f4560'],
  [58, 12, 18, '#8c7a5a', '#5e4f3a'],
];
const DOORS: [number, number][] = [[4, 0], [33, 2], [62, 4]]; // x, house
const CHIMNEYS: [number, number][] = [[16, 1], [65, 4]];
const LAMP_X = 9;
const TREE_X = 47;
const LEAVES = [[TREE_X - 11, GY - 36, 22, 16]] as const;
const NONE = [] as const;

const windows = (() => {
  const out: number[] = [];
  for (const [x, w, h] of HOUSES)
    for (let wy = GY - h + 3; wy < GY - 3; wy += 5)
      for (let wx = x + 2; wx < x + w - 2; wx += 4) {
        if (DOORS.some(([dx]) => dx >= wx - 2 && dx <= wx + 2) && wy > GY - 7) continue;
        out.push(wx, wy, 2, 2);
      }
  return Int16Array.from(out);
})();

export class StreetView implements View {
  readonly horizon = GY - 16;
  readonly ground = GY;
  private layers = new Layers(2);
  private cars: Car[] = [];
  private people: Person[] = [];
  private nextCar = 1;
  private nextPerson = 0.5;
  private fox = -1;
  private foxDir: 1 | -1 = 1;
  private lights: number[] = [];

  leafSources(c: ViewCtx) {
    return c.season === 3 ? NONE : LEAVES;
  }

  startEvent(kind: WorldEventKind, _c: ViewCtx, t0: number) {
    if (kind !== 'fox') return false;
    this.fox = t0;
    this.foxDir = Math.random() < 0.5 ? 1 : -1;
    return true;
  }

  draw(c: ViewCtx, d: Depth) {
    const halloween = c.month === 9;
    const xmas = c.month === 11;
    const storm = c.weather === 'storm';
    this.layers.ensure(`${c.season}|${c.snowy}|${c.wet}|${halloween}|${xmas}`, (p, i) => (i === 0 ? this.paintBack(p, c, halloween, xmas) : this.paintTree(p, c, 0)));
    const p = d.p;
    d.blit(this.layers.cs[0]);
    // chimney smoke on cold days
    if (c.season >= 2 || c.night > 0.5) for (const [cx, hi] of CHIMNEYS) smoke(p, cx, GY - HOUSES[hi][2] - 7, c, hi);
    d.flush(0.25);

    // lit windows + decorations on the houses
    const m = d.main;
    drawLitWindows(m, windows, c, 1, litChance(c, 0.62));
    if (xmas) this.xmasLights(m, c);
    if (halloween && c.night > 0.3) {
      m.g.globalCompositeOperation = 'lighter';
      for (const [dx] of DOORS) glowSprite(m, dx + 3, GY - 1, 4, [255, 150, 40], 0.5 * c.night);
      m.g.globalCompositeOperation = 'source-over';
      for (const [dx] of DOORS) {
        m.px(dx + 3, GY - 2, '#ffd25a');
        m.px(dx + 4, GY - 2, '#ffd25a');
      }
    }

    this.updateTraffic(c);
    this.drawPeople(p, c);
    if (this.fox >= 0) this.drawFox(p, c);
    if (storm) this.paintTree(p, c, Math.round(Math.sin(c.time * 3)));
    else d.blit(this.layers.cs[1]);
    this.drawCars(p);
    d.flush(0);

    // street lamp + headlights
    if (c.night > 0.2) {
      const g = m.g;
      g.globalCompositeOperation = 'lighter';
      glowSprite(m, LAMP_X + 1, GY - 21, 14, [255, 220, 140], 0.55 * c.night);
      glowSprite(m, LAMP_X + 1, GY + 3, 9, [255, 210, 130], 0.3 * c.night);
      for (let i = 0; i < this.lights.length; i += 3) {
        const x = this.lights[i];
        const y = this.lights[i + 1];
        const dir = this.lights[i + 2];
        glowSprite(m, x + dir * 5, y, 6, [255, 240, 180], 0.6 * c.night);
        g.fillStyle = `rgba(255,240,180,${0.25 * c.night})`;
        g.beginPath();
        g.moveTo(x, y - 1);
        g.lineTo(x + dir * 12, y - 2);
        g.lineTo(x + dir * 12, y + 3);
        g.lineTo(x, y + 1);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < this.lights.length; i += 3) m.px(this.lights[i], this.lights[i + 1], '#fffad2');
      m.rect(LAMP_X, GY - 22, 2, 1, `rgba(255,236,170,${c.night})`);
    }
    if (c.wet) {
      // puddle shimmer, and the lamp reflected in the wet road at night
      for (let i = 0; i < 4; i++) m.rect(6 + i * 17, GY + 9, 5, 1, `rgba(180,200,230,${0.25 + 0.15 * Math.sin(c.time * 3 + i)})`);
      if (c.night > 0.2) for (let y = GY + 6; y < GY + 11; y++) if ((y + Math.floor(c.time * 4)) % 2) m.rect(LAMP_X - 1 + ((y * 3) % 3), y, 2, 1, `rgba(255,214,120,${0.45 * c.night})`);
    }
  }

  private paintBack(p: Painter, c: ViewCtx, halloween: boolean, xmas: boolean) {
    const snowy = c.snowy;
    for (const [x, w, h, wall, roof] of HOUSES) {
      p.rect(x, GY - h, w, h, wall);
      p.rect(x + w - 1, GY - h, 1, h, roof); // shaded edge
      p.rect(x - 1, GY - h - 3, w + 2, 3, roof);
      p.rect(x - 1, GY - h - 3, w + 2, 1, '#00000022');
      p.rect(x, GY - h, w, 1, '#00000026'); // eave shadow
      if (snowy) {
        p.rect(x - 1, GY - h - 4, w + 2, 2, SNOW);
        p.rect(x - 1, GY - h - 2, w + 2, 1, SNOW_SHADE);
      }
    }
    for (const [cx, hi] of CHIMNEYS) {
      const top = GY - HOUSES[hi][2] - 6;
      p.rect(cx, top, 2, 3, '#6a4a3e');
      p.rect(cx - 1, top - 1, 4, 1, '#4e362c');
      if (snowy) p.rect(cx - 1, top - 2, 4, 1, SNOW);
    }
    // daytime window glass (dark at night once tinted; lit ones are drawn on top)
    for (let i = 0; i < windows.length; i += 4) {
      p.rect(windows[i], windows[i + 1], 2, 2, '#7fa8c6');
      p.px(windows[i], windows[i + 1], '#cfe6f4');
      p.rect(windows[i], windows[i + 1] + 2, 2, 1, '#00000022');
    }
    for (const [dx, hi] of DOORS) {
      const col = ['#4e3428', '#3c4654', '#5e4630', '#3f3550', '#4e4030'][hi];
      p.rect(dx + 2, GY - 6, 3, 6, col);
      p.px(dx + 4, GY - 3, '#e0c070');
      p.rect(dx + 1, GY - 7, 5, 1, '#00000030');
      if (halloween) {
        p.rect(dx + 2, GY - 2, 3, 2, '#e8802a');
        p.px(dx + 3, GY - 3, '#4f8a3a');
        p.px(dx + 2, GY - 2, '#c86418');
      }
    }
    if (xmas)
      for (const hi of [1, 3, 4]) {
        const [x, w, h] = HOUSES[hi];
        for (let i = 0; i < w; i += 2) p.px(x + i, GY - h, XMAS[(i / 2) % 4]);
      }
    // ground
    const grass = snowy ? SNOW : GRASS[c.season];
    p.rect(0, GY, WW, 2, grass);
    p.rect(0, GY + 2, WW, 3, snowy ? '#dfe6ee' : '#b8b2a8');
    for (let x = 3; x < WW; x += 7) p.px(x, GY + 3, snowy ? '#cfd8e2' : '#a8a298');
    p.rect(0, GY + 4, WW, 1, snowy ? '#c8d0da' : '#9a948a');
    p.rect(0, GY + 5, WW, 6, c.wet ? '#3c3c44' : '#4a4a52');
    if (snowy) for (let x = 0; x < WW; x += 5) p.rect(x, GY + 5, 3, 1, '#e8eef4');
    for (let x = 0; x < WW; x += 8) p.rect(x, GY + 8, 4, 1, '#d8c76a');
    // seasonal bits on the grass
    if (c.season === 0 && !snowy) for (let x = 2; x < WW; x += 5) p.px(x + ((x * 7) % 3), GY, ['#f7b5cf', '#f2e05a', '#ffffff'][x % 3]);
    if (c.season === 2) for (let x = 1; x < WW; x += 4) p.px(x, GY + ((x * 5) % 2), ['#e07b39', '#c94f2c', '#f2b134'][x % 3]);
    if (c.season === 3) {
      // a snowman on the lawn
      const sx = 25;
      p.rect(sx, GY - 3, 3, 3, SNOW);
      p.rect(sx + 2, GY - 3, 1, 3, SNOW_SHADE);
      p.rect(sx, GY - 5, 2, 2, SNOW);
      p.px(sx + 2, GY - 4, '#e8802a');
      p.rect(sx - 1, GY - 6, 3, 1, '#2d2d35');
      p.px(sx, GY - 7, '#2d2d35');
    }
    // bushes
    for (const [bx, r] of [[22, 2], [40, 2], [56, 1]] as const) {
      const col = c.season === 3 ? '#4a6a50' : FOLIAGE[c.season === 2 ? 1 : c.season][1];
      p.disc(bx, GY - 1, r, col);
      p.px(bx - 1, GY - r - 1, c.season === 3 ? SNOW : FOLIAGE[c.season === 2 ? 1 : c.season][0]);
      if (snowy) p.rect(bx - r, GY - r - 1, r * 2, 1, SNOW);
    }
    // lamp post
    p.rect(LAMP_X, GY - 22, 1, 24, '#2d2d35');
    p.rect(LAMP_X - 1, GY - 24, 4, 2, '#2d2d35');
    p.rect(LAMP_X, GY - 22, 2, 1, '#9a9aa5');
    p.rect(LAMP_X - 1, GY + 1, 3, 1, '#2d2d35');
    if (snowy) p.rect(LAMP_X - 1, GY - 25, 4, 1, SNOW);
  }

  /** The big street tree (into the cached layer, or live with a sway in storms). */
  private paintTree(p: Painter, c: ViewCtx, sway: number) {
    const x = TREE_X;
    const trunk = TRUNK;
    p.rect(x - 1, GY - 18, 3, 18, trunk);
    p.rect(x + 1, GY - 18, 1, 18, '#4a2f1e');
    p.rect(x, GY - 22, 1, 4, trunk);
    p.rect(x - 5, GY - 16, 4, 1, trunk);
    p.rect(x + 2, GY - 13, 5, 1, trunk);
    p.rect(x - 2, GY - 1, 5, 1, '#4a2f1e');
    if (c.season === 3) {
      const br = [[0, -22, -9, -32], [0, -22, 8, -33], [0, -18, -11, -24], [1, -16, 11, -23], [0, -22, 1, -36], [-5, -28, -8, -35], [5, -29, 9, -36]];
      for (const [x0, y0, x1, y1] of br) {
        if (c.snowy) p.line(x + x0, GY + y0 - 1, x + x1, GY + y1 - 1, SNOW);
        p.line(x + x0, GY + y0, x + x1, GY + y1, trunk);
      }
      if (c.snowy) for (const [, , x1, y1] of br) p.rect(x + x1 - 1, GY + y1 - 1, 3, 1, SNOW);
      return;
    }
    const cx = x + sway;
    const cy = GY - 26;
    let s = 11;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const pal = FOLIAGE[c.season];
    p.disc(cx, cy, 11, pal[1]);
    p.disc(cx - 6, cy + 3, 7, pal[1]);
    p.disc(cx + 6, cy + 3, 7, pal[1]);
    p.disc(cx - 1, cy - 1, 9, pal[0]);
    p.disc(cx - 5, cy + 2, 5, pal[0]);
    p.disc(cx + 5, cy + 1, 5, pal[0]);
    // underside shadow
    for (let i = -8; i <= 8; i += 2) p.px(cx + i, cy + 8 + (Math.abs(i) > 5 ? 0 : 1), '#00000030');
    for (let i = 0; i < 26; i++) p.px(cx - 10 + r() * 20, cy - 9 + r() * 16, pal[2]);
    if (c.season === 0) for (let i = 0; i < 18; i++) p.px(cx - 10 + r() * 20, cy - 9 + r() * 16, i % 2 ? '#f7b5cf' : '#fde2ec');
    if (c.season === 1) for (let i = 0; i < 4; i++) p.px(cx - 6 + r() * 12, cy - 4 + r() * 10, '#e8463a'); // apples
  }

  private xmasLights(m: Painter, c: ViewCtx) {
    if (c.night < 0.2) return;
    const g = m.g;
    for (const hi of [1, 3, 4]) {
      const [x, w, h] = HOUSES[hi];
      for (let i = 0; i < w; i += 2) {
        const k = (i / 2) % 4;
        const on = Math.sin(c.time * 2.2 + i * 1.3 + hi) > -0.4;
        if (!on) continue;
        g.fillStyle = XMAS[k];
        g.globalAlpha = c.night;
        g.fillRect(x + i, GY - h, 1, 1);
      }
    }
    g.globalAlpha = 1;
  }

  private updateTraffic(c: ViewCtx) {
    const dt = c.dt;
    const peopleRate = (c.s.sim.isNight ? 0.4 : 1) * (c.weather === 'storm' ? 0.3 : 1);
    this.nextCar -= dt;
    this.nextPerson -= dt * peopleRate;
    if (this.nextCar <= 0) {
      const dir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      this.cars.push({ x: dir > 0 ? -14 : WW + 2, dir, v: 18 + Math.random() * 14, c: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], van: Math.random() < 0.25 });
      this.nextCar = 6 + Math.random() * 16;
      c.ev.onCar?.(dir);
    }
    if (this.nextPerson <= 0) {
      const dir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      const jog = !c.wet && c.weather !== 'snow' && !c.s.sim.isNight && Math.random() < 0.15;
      this.people.push({
        x: dir > 0 ? -3 : WW + 1,
        dir,
        v: jog ? 9 : 3 + Math.random() * 2,
        shirt: SHIRTS[(Math.random() * SHIRTS.length) | 0],
        hair: HAIR[(Math.random() * HAIR.length) | 0],
        dog: !jog && Math.random() < 0.22,
        ph: Math.random() * 6,
        umbrella: c.wet || (c.weather === 'snow' && Math.random() < 0.3) ? UMBRELLAS[(Math.random() * UMBRELLAS.length) | 0] : null,
        jog,
      });
      this.nextPerson = 8 + Math.random() * 14;
    }
    for (const q of this.people) q.x += q.dir * q.v * dt;
    for (const car of this.cars) car.x += car.dir * car.v * dt;
    for (let i = this.people.length - 1; i >= 0; i--) if (this.people[i].x < -8 || this.people[i].x > WW + 8) this.people.splice(i, 1);
    for (let i = this.cars.length - 1; i >= 0; i--) if (this.cars[i].x < -16 || this.cars[i].x > WW + 16) this.cars.splice(i, 1);
  }

  private drawPeople(p: Painter, c: ViewCtx) {
    for (const q of this.people) {
      const x = Math.round(q.x);
      const step = Math.floor(c.time * (q.jog ? 9 : 4) + q.ph) % 2;
      const fy = GY + 4 - (q.jog && step ? 1 : 0);
      p.px(x, fy - 1, '#2d2d35');
      p.rect(x + 1, fy - 1 + step, 1, 1 - step, '#2d2d35');
      p.rect(x, fy - 2, 2, 1, q.jog ? '#2d2d35' : '#3d4a6b');
      p.rect(x, fy - 5, 2, 3, q.shirt);
      p.rect(x, fy - 7, 2, 2, '#e8b48a');
      p.rect(x, fy - 7, 2, 1, c.season === 3 ? '#c0392b' : q.hair);
      if (c.season === 3) p.px(x + (q.dir > 0 ? 0 : 1), fy - 5, '#e9e4da'); // scarf
      if (q.umbrella) {
        p.rect(x - 2, fy - 10, 6, 1, q.umbrella);
        p.rect(x - 1, fy - 11, 4, 1, q.umbrella);
        p.rect(x + 1, fy - 9, 1, 3, '#2d2d35');
      }
      if (q.dog) {
        const dx = x + q.dir * 4;
        p.rect(dx, fy - 2, 3, 1, '#8a5a35');
        p.px(dx + (q.dir > 0 ? 2 : 0), fy - 3, '#8a5a35');
        p.px(dx + (q.dir > 0 ? 0 : 2), fy - 3 + (Math.floor(c.time * 6) % 2), '#8a5a35'); // wagging tail
        p.px(dx + step, fy - 1, '#8a5a35');
        p.px(dx + 2 - step, fy - 1, '#8a5a35');
        p.line(x + (q.dir > 0 ? 2 : -1), fy - 4, dx + (q.dir > 0 ? 2 : 0), fy - 3, '#2d2d35');
      }
    }
  }

  private drawFox(p: Painter, c: ViewCtx) {
    const age = c.time - this.fox;
    const x = this.foxDir > 0 ? -6 + age * 7 : WW + 6 - age * 7;
    if (x < -8 || x > WW + 8 || age < 0) {
      if (age > 1) this.fox = -1;
      return;
    }
    drawFoxSprite(p, x, GY + 4, this.foxDir, c.time);
  }

  private drawCars(p: Painter) {
    this.lights.length = 0;
    for (const car of this.cars) {
      const x = Math.round(car.x);
      const y = GY + 5;
      const len = car.van ? 13 : 11;
      p.rect(x, y + 1, len, 3, car.c);
      p.rect(x, y + 3, len, 1, '#00000030');
      if (car.van) {
        p.rect(x + 1, y - 2, len - 2, 3, car.c);
        p.rect(car.dir > 0 ? x + len - 4 : x + 2, y - 1, 2, 2, '#9fd3f0');
      } else {
        p.rect(x + 2, y - 1, len - 4, 2, car.c);
        p.rect(x + 3, y - 1, 2, 1, '#9fd3f0');
        p.rect(x + len - 5, y - 1, 2, 1, '#9fd3f0');
      }
      p.rect(x + 1, y + 4, 2, 1, '#1a1a22');
      p.rect(x + len - 3, y + 4, 2, 1, '#1a1a22');
      this.lights.push(car.dir > 0 ? x + len : x - 1, y + 2, car.dir);
      p.px(car.dir > 0 ? x : x + len - 1, y + 2, '#a02f24');
    }
  }
}

/** Chimney smoke: soft puffs rising and drifting (time-based). */
export function smoke(p: Painter, x: number, y: number, c: ViewCtx, seed: number, height = 14) {
  const wind = c.weather === 'storm' ? 3 : 1;
  const col = c.night > 0.5 ? '160,165,185' : '225,228,235';
  for (let i = 0; i < 6; i++) {
    const k = (c.time * 0.22 + i / 6 + seed * 0.37) % 1;
    const px = x + k * 6 * wind + Math.sin(c.time * 1.3 + i * 2 + seed) * 1.2;
    const py = y - k * height;
    p.g.fillStyle = `rgba(${col},${0.55 * (1 - k)})`;
    const s = k > 0.4 ? 2 : 1;
    p.g.fillRect(Math.round(px), Math.round(py), s, s);
  }
}

/** A little fox trotting along (x, feet y). */
export function drawFoxSprite(p: Painter, x: number, fy: number, dir: 1 | -1, time: number) {
  x = Math.round(x);
  const step = Math.floor(time * 8) % 2;
  const o = '#d8742a';
  const head = dir > 0 ? x + 4 : x - 1;
  p.rect(x, fy - 3, 5, 2, o);
  p.rect(head, fy - 4, 2, 2, o);
  p.px(dir > 0 ? head + 2 : head - 1, fy - 3, '#2d2d35'); // nose
  p.px(dir > 0 ? head : head + 1, fy - 5, o); // ear
  p.px(dir > 0 ? head + 1 : head, fy - 3, '#f4ead8');
  const tail = dir > 0 ? x - 3 : x + 5;
  p.rect(tail, fy - 3 - step, 3, 1, o);
  p.px(dir > 0 ? tail : tail + 2, fy - 3 - step, '#f4ead8');
  p.px(x + step, fy - 1, '#3a2a20');
  p.px(x + 3 - step, fy - 1, '#3a2a20');
  p.rect(x + 1, fy - 2, 3, 1, '#f4ead8');
}
