// 'forest': snow-capped mountains (more snow in winter), a far pine ridge with a campfire's thin smoke,
// a lake catching the sky, mist drifting between the layers, a meadow framed by big pines. A deer or fox
// crosses now and then, an owl blinks on a branch at night, fireflies on summer nights, and the aurora
// dances on clear winter nights.
import { Painter, glowSprite } from '../pixel';
import type { WorldEventKind } from '../scene';
import { WW, WH, Layers, h01, pine, roundTree, fillProfile, SNOW, SNOW_SHADE, mixCss, type Depth, type View, type ViewCtx } from './common';
import { drawAurora } from './sky';
import { makeBand } from './weather';
import { drawFoxSprite } from './street';
import { fireflies } from './countryside';

const PEAKS: [number, number][] = [[12, 9], [35, 3], [58, 8], [70, 14]];
const mountain = (x: number) => {
  let y = 34;
  for (const [px, py] of PEAKS) y = Math.min(y, py + Math.abs(x - px) * (x < px ? 0.72 : 0.85));
  return y;
};
const ridge = (x: number) => 29 + 1.5 * Math.sin(x * 0.13) + Math.sin(x * 0.37 + 1);
const LAKE_Y = 36;
const MEADOW_Y = 44;
const CAMP_X = 22;
const OWL = { x: 57, y: 22 };
const SNOWLINE = [7, 3, 6, 14];
const MEADOW = ['#7cc96b', '#5aa64f', '#b09a4e', '#eef3f8'];
const MEADOW_DARK = ['#62b058', '#4a9044', '#967f40', '#d6e0ea'];
const LEAVES = [[18, 32, 10, 6], [44, 33, 10, 6]] as const;
const NONE = [] as const;

export class ForestView implements View {
  readonly horizon = 26;
  readonly ground = MEADOW_Y;
  private layers = new Layers(4);
  private deer = -1;
  private fox = -1;
  private dir: 1 | -1 = 1;
  private band: HTMLCanvasElement | null = null;
  private owlShown = false;
  private auroraShown = false;
  private flies = false;

  leafSources(c: ViewCtx) {
    return c.season === 3 ? NONE : LEAVES;
  }

  startEvent(kind: WorldEventKind, _c: ViewCtx, t0: number) {
    this.dir = Math.random() < 0.5 ? 1 : -1;
    if (kind === 'deer') this.deer = t0;
    else if (kind === 'fox') this.fox = t0;
    else return false;
    return true;
  }

  drawSky(c: ViewCtx, p: Painter) {
    const on = c.season === 3 && c.weather === 'clear' && c.night > 0.75;
    if (!on) {
      this.auroraShown = false;
      return;
    }
    if (!this.auroraShown) {
      this.auroraShown = true;
      c.report('aurora');
    }
    const breathe = 0.65 + 0.35 * Math.sin(c.time * 0.07);
    drawAurora(p, c.time, ((c.night - 0.75) / 0.25) * breathe, this.horizon + 4);
  }

  draw(c: ViewCtx, d: Depth) {
    this.layers.ensure(`${c.season}|${c.snowy}`, (p, i) => [this.paintMountains, this.paintRidge, this.paintMid, this.paintNear][i].call(this, p, c));
    const p = d.p;
    const m = d.main;
    const mist = c.weather === 'fog' ? 0.85 : c.wet ? 0.45 : c.t < 0.12 || c.t > 0.9 ? 0.5 : 0.22;

    d.blit(this.layers.cs[0]);
    d.flush(0.65);
    d.blit(this.layers.cs[1]);
    this.lake(p, c);
    d.flush(0.3);
    this.campfire(m, c);
    this.lakeGlints(m, c);
    this.mist(m, c, 27, mist);

    d.blit(this.layers.cs[2]);
    if (this.deer >= 0) this.critter(p, c, 'deer');
    if (this.fox >= 0) this.critter(p, c, 'fox');
    d.flush(0.08);
    this.mist(m, c, 38, mist * 0.7);

    d.blit(this.layers.cs[3]);
    const owl = c.night > 0.7 && !c.wet;
    if (owl) this.owl(p, c);
    d.flush(0);
    if (owl) {
      if (!this.owlShown) {
        this.owlShown = true;
        c.report('owl');
      }
      // eyes catch the light, blinking now and then
      const blink = c.time % 4.3 < 0.18;
      if (!blink) {
        const look = Math.sin(c.time * 0.25) > 0.6 ? 1 : 0;
        m.px(OWL.x + look, OWL.y + 1, '#ffd84a');
        m.px(OWL.x + 2 + look, OWL.y + 1, '#ffd84a');
      }
    } else this.owlShown = false;
    if (c.season === 1 && c.night > 0.6 && !c.wet) {
      if (!this.flies) {
        this.flies = true;
        c.report('fireflies');
      }
      fireflies(m, c, 16, 38, WH - 6);
    } else this.flies = false;
  }

  private paintMountains(p: Painter, c: ViewCtx) {
    const snowDepth = c.snowy ? SNOWLINE[3] : SNOWLINE[c.season];
    fillProfile(p, 0, WW - 1, mountain, 36, (x, y) => {
      // which peak owns this column, and are we on its shaded right flank?
      let best = PEAKS[0];
      for (const pk of PEAKS) if (pk[1] + Math.abs(x - pk[0]) * 0.8 < best[1] + Math.abs(x - best[0]) * 0.8) best = pk;
      const shade = x > best[0];
      const jag = (h01(x * 13) - 0.5) * 3 + Math.sin(x * 1.3) * 1.2;
      if (y < best[1] + snowDepth + jag) return shade ? '#c8d2e2' : '#f2f5fa';
      return shade ? '#56647e' : '#6a7a96';
    });
  }

  private paintRidge(p: Painter, c: ViewCtx) {
    const col = '#2f4a4e';
    fillProfile(p, 0, WW - 1, ridge, 44, () => col);
    for (let x = 1; x < WW; x += 3) {
      const h = 4 + Math.floor(h01(x * 7) * 4);
      pine(p, x, ridge(x) + 2, h, col, '#284044', c.snowy, col);
    }
  }

  private paintMid(p: Painter, c: ViewCtx) {
    const s = c.season;
    // meadow
    const shoreY = (x: number) => (x > 12 && x < 52 ? LAKE_Y + 6 + Math.sin(x * 0.3) * 0.8 : MEADOW_Y - 3 + Math.sin(x * 0.12) * 1.2);
    fillProfile(p, 0, WW - 1, shoreY, WH, (x, y) => ((x * 5 + y * 3) % 7 === 0 ? MEADOW_DARK[s] : MEADOW[s]));
    // reeds at the water's edge
    for (let x = 14; x < 50; x += 5) {
      const y = Math.round(shoreY(x));
      p.px(x, y - 1, s === 3 ? '#9a9a88' : s === 2 ? '#a88a4a' : '#4f8a44');
      p.px(x + 1, y - 2, s === 3 ? '#9a9a88' : s === 2 ? '#b89a5a' : '#5a9a4c');
    }
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(h01(i * 11) * WW);
      const y = Math.floor(MEADOW_Y + 2 + h01(i * 17) * (WH - MEADOW_Y - 2));
      const col = s === 0 ? ['#f7b5cf', '#ffffff', '#c8a0f0'][i % 3] : s === 1 ? '#f2e05a' : s === 2 ? ['#e07b39', '#c94f2c'][i % 2] : SNOW_SHADE;
      p.px(x, y, col);
    }
    // a row of pines and broadleaf trees along the lake shore
    const trees: [number, number, number, boolean][] = [
      [6, 43, 12, true], [11, 44, 15, true], [17, 43, 4, false], [22, 41, 8, true], [26, 41, 6, true],
      [44, 41, 7, true], [48, 42, 4, false], [54, 44, 13, true], [59, 43, 10, true],
    ];
    for (const [x, base, h, isPine] of trees) {
      if (isPine) pine(p, x, base, h, '#3a6a4a', '#2a5038', c.snowy);
      else roundTree(p, x, base, h, s, x * 7, c.snowy);
    }
  }

  private paintNear(p: Painter, c: ViewCtx) {
    const lit = '#356a42';
    const shade = '#244a30';
    pine(p, 2, WH + 3, 44, lit, shade, c.snowy, '#3a2a1e');
    pine(p, 65, WH + 3, 49, lit, shade, c.snowy, '#3a2a1e');
    // the owl's branch
    p.rect(OWL.x - 3, OWL.y + 5, 8, 1, '#3a2a1e');
    p.px(OWL.x - 4, OWL.y + 4, '#3a2a1e');
    if (c.snowy) p.rect(OWL.x - 3, OWL.y + 4, 5, 1, SNOW);
    // ferns / bushes in the foreground
    const fern = c.season === 2 ? '#a8742e' : c.season === 3 ? '#5a6a5a' : '#3f7a3a';
    for (const [x, r] of [[14, 3], [24, 2], [44, 3], [52, 2]] as const) {
      p.disc(x, WH, r, fern);
      if (c.snowy) p.rect(x - r + 1, WH - r, r * 2 - 1, 1, SNOW);
    }
  }

  private lake(p: Painter, c: ViewCtx) {
    const water = mixCss(c.sky.bot, [40, 70, 80], 0.45);
    const g = p.g;
    g.fillStyle = c.season === 3 && c.snowy ? mixCss(c.sky.bot, [200, 215, 230], 0.6) : water;
    for (let y = LAKE_Y; y < LAKE_Y + 7; y++) {
      const inset = Math.max(0, (y - LAKE_Y - 3)) * 2.5;
      g.fillRect(6 + inset, y, WW - 16 - inset * 2, 1);
    }
    // the far shore's reflection
    g.fillStyle = 'rgba(30,50,52,0.35)';
    g.fillRect(6, LAKE_Y, WW - 16, 1);
  }

  private lakeGlints(m: Painter, c: ViewCtx) {
    if (c.season === 3 && c.snowy) return; // frozen
    const g = m.g;
    const night = c.night > 0.5;
    for (let i = 0; i < 7; i++) {
      const k = Math.sin(c.time * (0.9 + i * 0.2) + i * 2.2);
      if (k < 0.4) continue;
      const y = LAKE_Y + 1 + (i % 5);
      const inset = Math.max(0, y - LAKE_Y - 3) * 2.5;
      const x = 8 + inset + ((h01(i * 3) * 40 + c.time * 0.8) % Math.max(4, WW - 20 - inset * 2));
      g.fillStyle = night ? `rgba(220,230,255,${(k - 0.4) * 0.6 * c.orbA})` : `rgba(255,255,255,${(k - 0.4) * 0.9})`;
      g.fillRect(Math.round(x), y, 2, 1);
    }
  }

  private campfire(m: Painter, c: ViewCtx) {
    const y = Math.round(ridge(CAMP_X)) + 1;
    const g = m.g;
    const col = c.night > 0.5 ? '120,124,140' : '210,212,220';
    for (let i = 0; i < 8; i++) {
      const k = (c.time * 0.12 + i / 8) % 1;
      const x = CAMP_X + Math.sin(c.time * 0.6 + i) * k * 2 + k * 3;
      g.fillStyle = `rgba(${col},${0.45 * (1 - k)})`;
      g.fillRect(Math.round(x), Math.round(y - 2 - k * 18), 1, 1);
    }
    if (c.night > 0.4 && !c.wet && c.weather !== 'snow') {
      const f = 0.6 + 0.4 * Math.sin(c.time * 13) * Math.sin(c.time * 7.3);
      g.globalCompositeOperation = 'lighter';
      glowSprite(m, CAMP_X + 0.5, y - 1, 4, [255, 150, 60], f * 0.7 * c.night);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(255,190,90,${c.night})`;
      g.fillRect(CAMP_X, y - 1, 1, 1);
    }
  }

  private mist(m: Painter, c: ViewCtx, y: number, a: number) {
    if (a <= 0.02) return;
    const band = (this.band ??= makeBand());
    const g = m.g;
    const off = (c.time * 1.1 + y * 3) % band.width;
    g.globalAlpha = a * (1 - c.night * 0.55);
    g.drawImage(band, -off, y - 4);
    g.drawImage(band, band.width - off, y - 4);
    g.globalAlpha = 1;
  }

  private owl(p: Painter, c: ViewCtx) {
    const { x, y } = OWL;
    const body = '#8a6a4a';
    p.rect(x, y, 4, 5, body);
    p.rect(x + 1, y + 2, 2, 3, '#c8a878');
    p.px(x, y - 1, body); // ear tufts
    p.px(x + 3, y - 1, body);
    p.rect(x, y + 1, 4, 1, '#6a4e36');
    p.px(x + 1, y + 1, '#2a2018');
    p.px(x + 3, y + 1, '#2a2018');
    p.px(x + 2, y + 2, '#e0a040'); // beak
    if (c.snowy) p.rect(x, y - 1, 4, 1, SNOW);
    p.px(x + 1, y + 5, '#e0a040');
    p.px(x + 2, y + 5, '#e0a040');
  }

  private critter(p: Painter, c: ViewCtx, kind: 'deer' | 'fox') {
    const t0 = kind === 'deer' ? this.deer : this.fox;
    const age = c.time - t0;
    const dur = kind === 'deer' ? 24 : 15;
    if (age < 0 || age > dur) {
      if (age > dur) kind === 'deer' ? (this.deer = -1) : (this.fox = -1);
      return;
    }
    const dir = this.dir;
    if (kind === 'deer') {
      const pause = age > 5 && age < 12;
      const prog = pause ? 5 : age < 5 ? age : age - 7;
      const x = dir > 0 ? 4 + prog * 4.2 : WW - 12 - prog * 4.2;
      drawDeer(p, x, 52, dir, c.time, pause);
    } else {
      const x = dir > 0 ? 4 + age * 5 : WW - 8 - age * 5;
      drawFoxSprite(p, x, 54, dir, c.time);
    }
  }
}

/** A deer (feet at fy), walking or pausing to graze / look up. */
export function drawDeer(p: Painter, x: number, fy: number, dir: 1 | -1, time: number, pause: boolean) {
  x = Math.round(x);
  const X = (rx: number) => (dir > 0 ? x + rx : x + 8 - rx);
  const body = '#a0703f';
  const step = pause ? 0 : Math.floor(time * 6) % 2;
  p.rect(Math.min(X(0), X(5)), fy - 6, 6, 3, body);
  p.rect(Math.min(X(1), X(4)), fy - 4, 4, 1, '#c89a68');
  p.px(X(-1), fy - 6, '#f4ead8');
  const graze = pause && Math.sin(time * 0.8) > 0;
  if (graze) {
    p.px(X(6), fy - 5, body);
    p.px(X(7), fy - 4, body);
    p.px(X(7), fy - 3, body);
    p.px(X(6), fy - 6, body); // ear
  } else {
    p.rect(X(5), fy - 8, 1, 2, body);
    p.px(X(6), fy - 8, body);
    p.px(X(5), fy - 9, body);
    p.px(X(6), fy - 9, body);
    p.px(X(7), fy - 8, '#3a2a20');
    p.px(X(5), fy - 10, body); // ear
  }
  const leg = '#7a5030';
  p.rect(X(0), fy - 3, 1, 3 - step, leg);
  p.rect(X(1), fy - 3, 1, 2 + step, leg);
  p.rect(X(4), fy - 3, 1, 2 + step, leg);
  p.rect(X(5), fy - 3, 1, 3 - step, leg);
}
