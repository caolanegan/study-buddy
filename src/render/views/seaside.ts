// 'seaside': a sea horizon with rolling highlights and a sun / moon glitter path, a headland lighthouse
// (beam sweeps at night), sailboats, gulls, a beach with dune grass and a boardwalk jogger. Rare: dolphins
// leaping, a whale spouting. Winter: grey sea and snow on the sand; storms: whitecaps and big breakers.
import { Painter, Sprite, drawSprite, glowSprite } from '../pixel';
import type { WorldEventKind } from '../scene';
import { WW, WH, Layers, h01, SNOW, SNOW_SHADE, GRASS, fillProfile, type Depth, type View, type ViewCtx } from './common';

const HZ = 24; // sea horizon
const SHORE = 38; // where the sand starts
const LH_X = 59; // lighthouse centre
const LH_TOP = 4; // lantern y

const SEA: Record<number, [string, string, string]> = {
  0: ['#3a7ab0', '#4a90c0', '#6ab4c8'],
  1: ['#2f7fb8', '#3f97c8', '#5cc0d0'],
  2: ['#3a6a90', '#4a7ea0', '#6a9cb0'],
  3: ['#4a5e70', '#5a7080', '#7a8e98'],
};
const SEA_STORM: [string, string, string] = ['#2e4050', '#3a5060', '#50687a'];
const SAND = ['#e2cc9c', '#e8d2a0', '#d6c094', '#d8d4c8'];
const SAND_DARK = ['#cdb684', '#d4bc88', '#c2ac80', '#c4c0b4'];
const DUNE_GRASS = ['#8ab060', '#7aa850', '#c8b070', '#a8a080'];

/** x of the headland's left edge at row y (sea / beach left of it). */
const cliffTop = (x: number) => (x < 46 ? 99 : x < 53 ? 33 - (x - 46) * 2.1 : x < 56 ? 18.5 - (x - 53) * 0.2 : 17.5);

const NONE = [] as const;

export class SeasideView implements View {
  readonly horizon = HZ;
  readonly ground = SHORE - 2;
  private layers = new Layers(2);
  private dolphin = -1;
  private dolphinX = 20;
  private dolphinDir: 1 | -1 = 1;
  private whale = -1;
  private whaleX = 20;
  private boatSeen = 0;

  leafSources() {
    return NONE;
  }

  startEvent(kind: WorldEventKind, _c: ViewCtx, t0: number) {
    if (kind === 'dolphin') {
      this.dolphin = t0;
      this.dolphinDir = Math.random() < 0.5 ? 1 : -1;
      this.dolphinX = this.dolphinDir > 0 ? 4 + Math.random() * 10 : 26 + Math.random() * 10;
      return true;
    }
    if (kind === 'whale') {
      this.whale = t0;
      this.whaleX = 8 + Math.random() * 28;
      return true;
    }
    if (kind === 'boat') return true;
    return false;
  }

  drawSky(c: ViewCtx, p: Painter) {
    // gulls wheeling over the water
    if (c.night > 0.5 || c.wet || c.weather === 'snow') return;
    for (let i = 0; i < 3; i++) {
      const x = Math.round(30 + Math.sin(c.time * 0.13 + i * 2.1) * 26 + Math.sin(c.time * 0.31 + i) * 6);
      const y = Math.round(9 + i * 4 + Math.sin(c.time * 0.4 + i * 1.7) * 3);
      const up = Math.floor(c.time * (i === 1 ? 2 : 3) + i) % 4 === 0;
      const body = c.night > 0.3 ? '#9aa0b0' : '#f4f4f0';
      p.px(x, y, body);
      p.px(x + 1, y, body);
      p.px(x - 1, y - (up ? 1 : 0), body);
      p.px(x + 2, y - (up ? 1 : 0), body);
      p.px(x - 2, y - (up ? 2 : 0), '#5a5a66');
      p.px(x + 3, y - (up ? 2 : 0), '#5a5a66');
    }
  }

  draw(c: ViewCtx, d: Depth) {
    const storm = c.weather === 'storm';
    this.layers.ensure(`${c.season}|${c.snowy}|${storm}|${c.wet}`, (p, i) => (i === 0 ? this.paintSea(p, c, storm) : this.paintLand(p, c)));
    const p = d.p;
    const m = d.main;
    const sea = storm ? SEA_STORM : SEA[c.season];

    // 1. sea surface
    d.blit(this.layers.cs[0]);
    this.waves(p, c, storm, sea);
    d.flush(0.12);
    this.glitter(m, c);

    // 2. boats & sea life
    let lightsN = 0;
    const boatX: number[] = BOAT_X;
    if (!storm) {
      for (let i = 0; i < 2; i++) {
        const v = i ? 0.9 : 0.6;
        const span = 120;
        const raw = (c.time * v + i * 57) % span;
        const x = i ? WW + 10 - raw : raw - 12;
        const y = HZ + 3 + i * 4 + Math.round(Math.sin(c.time * 1.4 + i * 2) * 0.5);
        if (x > -10 && x < WW + 10) {
          sailboat(p, x, y, i, c);
          boatX[lightsN * 2] = x;
          boatX[lightsN * 2 + 1] = y;
          lightsN++;
        }
        if (i === 0 && x > 8 && x < 10 && c.time - this.boatSeen > 30) {
          this.boatSeen = c.time;
          c.report('boat');
        }
      }
    }
    if (this.whale >= 0) this.drawWhale(p, c);
    if (this.dolphin >= 0) this.drawDolphins(p, c);
    d.flush(0.06);
    if (c.night > 0.3)
      for (let i = 0; i < lightsN; i++) {
        m.px(boatX[i * 2] + 2, boatX[i * 2 + 1] - 7, `rgba(255,240,200,${c.night})`);
        m.px(boatX[i * 2] + 4, boatX[i * 2 + 1], `rgba(255,90,80,${c.night * 0.8})`);
      }

    // 3. headland, beach, boardwalk
    d.blit(this.layers.cs[1]);
    this.shore(p, c, storm);
    this.duneGrass(p, c);
    this.jogger(p, c);
    d.flush(0);

    // lighthouse + cottage lights
    this.lighthouse(m, c);
    if (c.night > 0.25) {
      m.px(64, 15, `rgba(255,214,120,${c.night})`);
      m.px(65, 15, `rgba(255,214,120,${c.night})`);
    }
  }

  private paintSea(p: Painter, c: ViewCtx, storm: boolean) {
    const sea = storm ? SEA_STORM : SEA[c.season];
    p.rect(0, HZ, WW, 4, sea[0]);
    p.rect(0, HZ + 4, WW, 5, sea[1]);
    p.rect(0, HZ + 9, WW, SHORE - HZ - 9, sea[2]);
    // dithered transitions between bands
    for (let x = 0; x < WW; x++) {
      if (h01(x * 5) < 0.4) p.px(x, HZ + 4, sea[0]);
      if (h01(x * 9 + 1) < 0.4) p.px(x, HZ + 9, sea[1]);
    }
    // a far coast, hazy
    fillProfile(p, 0, 22, (x) => HZ - 2.5 + Math.sin(x * 0.25) * 1.2 + x * 0.06, HZ, () => (c.snowy ? '#a8b4c4' : '#6f8aa0'));
  }

  private paintLand(p: Painter, c: ViewCtx) {
    const s = c.season;
    const snowy = c.snowy;
    // headland rock
    const rock = '#857868';
    const rockDark = '#6a5e52';
    fillProfile(p, 44, WW - 1, cliffTop, SHORE + 1, (x, y) => {
      const edge = y - cliffTop(x);
      if (edge < 1.2) return snowy ? SNOW : GRASS[s];
      if (edge < 2.2) return snowy ? SNOW_SHADE : s === 2 ? '#8a8a46' : '#4f9e48';
      return (x * 3 + y * 5) % 11 === 0 || (x + y * 2) % 7 === 0 ? rockDark : rock;
    });
    // rock face shading strata
    for (let y = 22; y < SHORE; y += 4)
      for (let x = 44; x < 58; x++) if (y > cliffTop(x) + 3 && (x + y) % 3 !== 0) p.px(x, y + (x > 52 ? 1 : 0), rockDark);
    // foam at the foot of the rocks
    for (let x = 44; x < WW; x += 3) p.px(x + (x % 2), SHORE - 1, '#e8f0f4');

    // lighthouse: tapered white tower with red bands, gallery, lantern, dome
    const base = 18;
    for (let y = LH_TOP + 3; y < base; y++) {
      const hw = y > 13 ? 2 : 1;
      const band = (y >= 8 && y <= 9) || (y >= 13 && y <= 14);
      p.rect(LH_X - hw, y, hw * 2 + 1, 1, band ? '#c8443a' : '#f2efe6');
      p.px(LH_X + hw, y, band ? '#9a3028' : '#cfcac0');
    }
    p.rect(LH_X - 2, LH_TOP + 2, 5, 1, '#3a3a44'); // gallery
    p.rect(LH_X - 1, LH_TOP, 3, 2, '#e8e0a0'); // lantern glass
    p.rect(LH_X - 1, LH_TOP - 1, 3, 1, '#c8443a'); // dome
    p.px(LH_X, LH_TOP - 2, '#3a3a44');
    p.px(LH_X, base - 2, '#3a3a44'); // door
    p.px(LH_X, base - 3, '#3a3a44');
    // keeper's cottage
    p.rect(62, 14, 6, 4, '#ece6da');
    p.rect(61, 12, 8, 2, '#a8443a');
    p.rect(62, 11, 6, 1, '#a8443a');
    if (snowy) p.rect(61, 11, 8, 1, SNOW);
    p.rect(64, 15, 2, 1, '#7fa8c6');

    // beach
    const sand = SAND[s];
    p.rect(0, SHORE, WW, WH - SHORE, sand);
    for (let i = 0; i < 40; i++) p.px(h01(i * 7) * WW, SHORE + 3 + h01(i * 13) * (WH - SHORE - 3), SAND_DARK[s]);
    // dune at bottom-left
    fillProfile(p, 0, 40, (x) => 47 + (x / 40) ** 2 * 6 - Math.sin(x * 0.15) * 1.5, WH, (x, y) => ((x + y) % 5 === 0 ? SAND_DARK[s] : sand));
    if (snowy) {
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(h01(i * 3 + 1) * WW);
        const y = Math.floor(SHORE + 4 + h01(i * 5 + 2) * (WH - SHORE - 4));
        p.rect(x, y, 3 + (i % 3), 1, SNOW);
      }
      fillProfile(p, 0, 40, (x) => 47 + (x / 40) ** 2 * 6 - Math.sin(x * 0.15) * 1.5, 50, () => SNOW);
    }
    // boardwalk
    p.rect(0, 52, WW, 2, '#a07a52');
    p.rect(0, 54, WW, 1, '#7a5a3a');
    for (let x = 2; x < WW; x += 4) p.px(x, 52, '#8a6644');
    for (let x = 4; x < WW; x += 12) p.rect(x, 55, 1, 3, '#6a4a30');
    if (snowy) for (let x = 0; x < WW; x += 3) p.rect(x, 51, 2, 1, SNOW);
    // summer: a striped beach umbrella, towel and sandcastle
    if (s === 1 && !c.wet) {
      p.rect(16, 41, 1, 8, '#8a6a4a');
      const cols = ['#e05a4f', '#f4f1e8'];
      for (let i = -4; i <= 4; i++) p.px(16 + i, 41 - (Math.abs(i) < 3 ? 1 : 0), cols[(i + 4) % 2]);
      for (let i = -3; i <= 3; i++) p.px(16 + i, 39, cols[(i + 3) % 2]);
      p.rect(19, 47, 6, 2, '#5aa9e6');
      p.rect(19, 47, 6, 1, '#8cc8f2');
      p.rect(29, 44, 3, 2, '#c8a870');
      p.px(30, 43, '#c8a870');
      p.px(30, 42, '#e05a4f');
    }
    if (s === 2) for (let i = 0; i < 6; i++) p.px(6 + i * 9, 43 + (i % 3), '#f4ece0'); // shells after the season
  }

  /** Moving highlights; whitecaps in storms. */
  private waves(p: Painter, c: ViewCtx, storm: boolean, sea: [string, string, string]) {
    const g = p.g;
    const n = storm ? 44 : 30;
    const night = c.night;
    for (let i = 0; i < n; i++) {
      const row = HZ + 1 + Math.floor(h01(i * 3 + 1) * (SHORE - HZ - 2));
      const depth = (row - HZ) / (SHORE - HZ);
      const sp = (0.6 + depth * 2.2) * (storm ? 2.5 : 1) * (i % 2 ? 1 : -0.6);
      const len = 1 + Math.round(depth * 3);
      const x = ((h01(i * 7) * 90 + c.time * sp) % 90 + 90) % 90 - 10;
      const life = Math.sin(c.time * (0.8 + h01(i) * 0.8) + i * 2.3);
      if (life < 0.1) continue;
      g.fillStyle = storm ? (life > 0.6 ? '#e8f0f4' : sea[2]) : night > 0.5 ? 'rgba(170,190,230,0.35)' : `rgba(220,240,255,${0.35 + 0.35 * life})`;
      g.fillRect(Math.round(x), row, len, 1);
    }
    if (storm) {
      // rolling breakers
      for (let k = 0; k < 3; k++) {
        const y = HZ + 4 + k * 4 + Math.round(Math.sin(c.time * 1.2 + k) * 0.7);
        for (let x = 0; x < WW; x++) if (Math.sin(x * 0.35 + c.time * (2 + k) + k * 3) > 0.55) g.fillRect(x, y, 1, 1);
      }
    }
  }

  /** Glitter path under the sun / moon: twinkling horizontal dashes widening toward the shore. */
  private glitter(m: Painter, c: ViewCtx) {
    if (c.orbA <= 0.05 || c.orbY > HZ + 1) return;
    const night = c.t >= 0.5;
    const low = Math.max(0, 1 - (HZ - c.orbY) / 20);
    const a = c.orbA * (night ? 0.3 + 0.5 * c.s.moon : 0.45 + 0.35 * low);
    const col = night ? '232,236,255' : low > 0.5 ? '255,190,120' : '255,248,215';
    const g = m.g;
    const slot = Math.floor(c.time * 3);
    for (let y = HZ + 1; y < SHORE; y++) {
      const depth = (y - HZ) / (SHORE - HZ);
      const spread = 2 + depth * 9;
      const n = 1 + Math.floor(depth * 2);
      for (let k = 0; k < n; k++) {
        const hsh = h01(y * 97 + (slot + k) * 13 + k * 7);
        if (hsh < 0.3) continue;
        const len = 1 + Math.floor(depth * 3 * h01(y + k * 5 + slot));
        const x = Math.round(c.orbX + (h01(y * 31 + k * 11 + slot) - 0.5) * spread);
        if (x + len > 45) continue;
        g.fillStyle = `rgba(${col},${a * (0.45 + hsh * 0.55)})`;
        g.fillRect(x, y, len, 1);
      }
    }
  }

  private shore(p: Painter, c: ViewCtx, storm: boolean) {
    const g = p.g;
    const amp = storm ? 2.5 : 1.2;
    const ph = c.time * (storm ? 1.1 : 0.6);
    const wash = SHORE - 0.5 + Math.sin(ph) * amp;
    const retreating = Math.cos(ph) < 0;
    g.fillStyle = SAND_DARK[c.season];
    g.fillRect(0, SHORE, 44, 2);
    for (let x = 0; x < 46; x++) {
      const y = Math.round(wash + Math.sin(x * 0.45 + ph * 2) * 0.6);
      if (y < SHORE - 1) continue;
      g.fillStyle = SEA[c.season][2];
      if (y > SHORE) g.fillRect(x, SHORE, 1, y - SHORE);
      g.fillStyle = retreating && (x + Math.floor(c.time * 3)) % 3 === 0 ? 'rgba(240,248,252,0.5)' : '#eef6f8';
      g.fillRect(x, y, 1, 1);
    }
    if (storm) {
      // spray bursting on the rocks
      for (let i = 0; i < 10; i++) {
        const k = (c.time * 0.7 + i / 10) % 1;
        const x = 45 + (i % 5) * 1.5 + k * 3;
        const y = SHORE - 2 - Math.sin(k * Math.PI) * (5 + (i % 3) * 2);
        g.fillStyle = `rgba(240,246,250,${1 - k})`;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
  }

  private duneGrass(p: Painter, c: ViewCtx) {
    const col = DUNE_GRASS[c.season];
    const wind = c.weather === 'storm' ? 2 : 1;
    for (let i = 0; i < 9; i++) {
      const x = 2 + i * 4 + (i % 2);
      const base = 49 + Math.floor((x / 40) ** 2 * 5) - (i % 3 === 0 ? 1 : 0);
      const sw = Math.round(Math.sin(c.time * 1.4 + i * 0.9) * 0.6 * wind + 0.3 * wind);
      p.px(x, base - 1, col);
      p.px(x + sw, base - 2, col);
      p.px(x - 1, base - 1, col);
      p.px(x - 1 + sw, base - 3, col);
      p.px(x + 1, base - 1, col);
      p.px(x + 1 + sw, base - 2, c.season === 3 && c.snowy ? SNOW : col);
    }
  }

  private jogger(p: Painter, c: ViewCtx) {
    if (c.night > 0.6 || c.weather === 'storm') return;
    const period = 53;
    const slot = Math.floor(c.time / period);
    const k = (c.time % period) / 12;
    if (k > 1) return;
    const dir = h01(slot) < 0.5 ? 1 : -1;
    const walk = c.wet || c.weather === 'snow';
    const kk = walk ? k * 0.6 : k;
    const x = Math.round(dir > 0 ? -4 + kk * (WW + 8) : WW + 4 - kk * (WW + 8));
    const step = Math.floor(c.time * (walk ? 4 : 9)) % 2;
    const fy = 52 - (!walk && step ? 1 : 0);
    const shirt = ['#e05a4f', '#5aa9e6', '#f2b134', '#8e5bb5'][slot % 4];
    p.px(x + step, fy - 1, '#2d2d35');
    p.px(x + 1 - step, fy - 1, '#2d2d35');
    p.rect(x, fy - 2, 2, 1, walk ? '#3d4a6b' : '#2d2d35');
    p.rect(x, fy - 5, 2, 3, shirt);
    p.rect(x, fy - 7, 2, 2, '#e8b48a');
    p.rect(x, fy - 7, 2, 1, c.season === 3 ? '#4a6ab0' : '#3b2a20');
    if (c.wet) {
      p.rect(x - 2, fy - 10, 6, 1, '#f2b134');
      p.rect(x - 1, fy - 11, 4, 1, '#f2b134');
      p.rect(x + 1, fy - 9, 1, 3, '#2d2d35');
    }
  }

  private lighthouse(m: Painter, c: ViewCtx) {
    const vis = Math.max(c.night, c.weather === 'fog' || c.weather === 'storm' ? 0.6 : 0);
    if (vis < 0.25) return;
    const g = m.g;
    const th = c.time * 0.9;
    const cx = LH_X;
    const cy = LH_TOP + 1;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const facing = sin > 0 ? sin : 0;
    g.globalCompositeOperation = 'lighter';
    const reach = 80 * Math.abs(cos) + 4;
    const sx = Math.sign(cos) || 1;
    const hw = 1 + 3.5 * Math.abs(sin);
    const base = (0.13 + 0.1 * facing) * vis * (sin < 0 ? 0.55 : 1);
    // four tapering segments, fading with distance
    for (let i = 0; i < 4; i++) {
      const u0 = i / 4;
      const u1 = (i + 1) / 4;
      g.fillStyle = `rgba(255,240,180,${base * (1 - u0 * 0.8)})`;
      g.beginPath();
      g.moveTo(cx + sx * reach * u0, cy - 0.5 - hw * u0);
      g.lineTo(cx + sx * reach * u1, cy - 0.5 - hw * u1);
      g.lineTo(cx + sx * reach * u1, cy + 0.5 + hw * u1);
      g.lineTo(cx + sx * reach * u0, cy + 0.5 + hw * u0);
      g.fill();
    }
    glowSprite(m, cx, cy, 4 + facing ** 4 * 10, [255, 236, 170], vis * (0.5 + facing ** 4 * 0.5));
    g.globalCompositeOperation = 'source-over';
    m.rect(cx - 1, LH_TOP, 3, 2, `rgba(255,240,180,${vis})`);
  }

  private drawDolphins(p: Painter, c: ViewCtx) {
    const age = c.time - this.dolphin;
    if (age > 7 || age < 0) {
      if (age > 7) this.dolphin = -1;
      return;
    }
    const g = p.g;
    const d = this.dolphinDir;
    for (let n = 0; n < 2; n++) {
      const wy = HZ + 9 + n * 3;
      for (let j = 0; j < 3; j++) {
        const st = j * 1.9 + n * 0.8;
        const k = (age - st) / 1.2;
        const x0 = this.dolphinX + d * (j * 11 + n * 7);
        if (k < -0.1 || k > 1.4) continue;
        if (k >= 0 && k <= 1) {
          const x = x0 + d * k * 10;
          const y = wy - Math.sin(k * Math.PI) * 6;
          const spr = k < 0.38 ? DOLPHIN.up : k < 0.62 ? DOLPHIN.top : DOLPHIN.down;
          g.save();
          g.beginPath();
          g.rect(0, 0, WW, wy);
          g.clip();
          drawSprite(p, spr, x - spr.w / 2, y - spr.h / 2, d < 0);
          g.restore();
        }
        // splashes going in / out
        const sk = k < 0.18 ? k / 0.18 : k > 0.85 ? (k - 0.85) / 0.5 : -1;
        if (sk >= 0 && sk <= 1) {
          const sx = k < 0.5 ? x0 : x0 + d * 10;
          g.fillStyle = `rgba(245,250,252,${1 - sk})`;
          g.fillRect(Math.round(sx - 1 - sk * 2), wy - Math.round(sk * 3), 1, 1);
          g.fillRect(Math.round(sx + 1 + sk * 2), wy - Math.round(sk * 3), 1, 1);
          g.fillRect(Math.round(sx), wy - Math.round(1 + sk * 3), 1, 1);
          g.fillRect(Math.round(sx - 2), wy, 5, 1);
        }
      }
    }
  }

  private drawWhale(p: Painter, c: ViewCtx) {
    const age = c.time - this.whale;
    if (age > 12 || age < 0) {
      if (age > 12) this.whale = -1;
      return;
    }
    const x = Math.round(this.whaleX + age * 0.4);
    const y = HZ + 3;
    const back = age > 0.5 && age < 8 ? 1 : 0;
    if (back) {
      p.rect(x - 3, y, 7, 1, '#3a4a5a');
      p.rect(x - 1, y - 1, 3, 1, '#3a4a5a');
    }
    for (const st of [1, 4.5]) {
      const k = (age - st) / 2.2;
      if (k < 0 || k > 1) continue;
      const h = Math.sin(Math.min(1, k * 2) * Math.PI * 0.5) * 5;
      const a = 1 - Math.max(0, k - 0.4) / 0.6;
      p.g.fillStyle = `rgba(235,244,250,${a})`;
      for (let i = 0; i < h; i++) p.g.fillRect(x, y - 1 - i, 1, 1);
      const top = y - 1 - h;
      const fan = 1 + k * 2;
      p.g.fillRect(Math.round(x - fan), Math.round(top + k * 2), 1, 1);
      p.g.fillRect(Math.round(x + fan), Math.round(top + k * 2), 1, 1);
      p.g.fillRect(Math.round(x - fan * 0.5), Math.round(top), 1, 1);
      p.g.fillRect(Math.round(x + fan * 0.5), Math.round(top), 1, 1);
    }
    // tail fluke as it dives
    if (age > 8.5 && age < 11) {
      const k = (age - 8.5) / 2.5;
      const up = Math.round(Math.sin(k * Math.PI) * 3);
      const fx = x + 3;
      p.px(fx, y - up + 1, '#3a4a5a');
      p.px(fx, y - up, '#3a4a5a');
      p.px(fx - 1, y - up - 1, '#3a4a5a');
      p.px(fx + 1, y - up - 1, '#3a4a5a');
      p.px(fx - 2, y - up - 2, '#3a4a5a');
      p.px(fx + 2, y - up - 2, '#3a4a5a');
    }
  }
}

const BOAT_X: number[] = [0, 0, 0, 0];

// leaping dolphin (faces right): rising, level, diving
const DPAL = { B: '#5a7090', D: '#46597a', W: '#c8d6e2' };
const DOLPHIN = {
  up: new Sprite(['.....BB', '....BBW', '...BBW.', '.DBBW..', 'DD.....'], DPAL),
  top: new Sprite(['...B....', 'DBBBBBB.', 'D.WWWWBB'], DPAL),
  down: new Sprite(['DD.....', '.DBBB..', '...BBB.', '...WWBB', '.....BB'], DPAL),
};

function sailboat(p: Painter, x: number, y: number, i: number, c: ViewCtx) {
  x = Math.round(x);
  const hull = i ? '#a8443a' : '#3a4a6a';
  p.rect(x, y, 6, 1, hull);
  p.rect(x + 1, y + 1, 4, 1, hull);
  p.rect(x + 2, y - 7, 1, 7, '#5a4a3a');
  const sail = c.season === 3 ? '#e8e8ec' : '#f8f6ee';
  for (let r = 0; r < 6; r++) p.rect(x + 3, y - 6 + r, Math.ceil((r + 1) * 0.5), 1, sail);
  for (let r = 0; r < 4; r++) p.rect(x + 2 - Math.ceil((r + 1) * 0.4), y - 4 + r, Math.ceil((r + 1) * 0.4), 1, i ? '#f2d16b' : sail);
  // wake
  if (Math.floor(c.time * 2 + i) % 2) p.px(i ? x + 7 : x - 1, y + 1, 'rgba(230,240,250,0.7)');
}
