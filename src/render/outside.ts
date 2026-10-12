import { Painter, css, hex, mix, rng, type RGB } from './pixel';
import { WIN, type RenderEvents, type RenderScene } from './scene';

const { x: WX, y: WY, w: WW, h: WH } = WIN;

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

export interface Sky {
  top: RGB;
  bot: RGB;
  /** 1 = full day, 0 = night */
  day: number;
}

export function skyAt(t: number, weather: RenderScene['weather']): Sky {
  let sky: Sky = { top: hex('#0b1030'), bot: hex('#1e2a5a'), day: 0 };
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, at, ab, ad] = KEYS[i];
    const [b, bt, bb, bd] = KEYS[i + 1];
    if (t >= a && t <= b) {
      const k = (t - a) / (b - a);
      sky = { top: mix(hex(at), hex(bt), k), bot: mix(hex(ab), hex(bb), k), day: ad + (bd - ad) * k };
      break;
    }
  }
  const grey = { clear: 0, cloudy: 0.35, rain: 0.55, storm: 0.7, snow: 0.45, fog: 0.5 }[weather];
  if (grey) {
    const g = mix(hex('#8a93a3'), hex('#1a1e2a'), 1 - sky.day);
    sky = { ...sky, top: mix(sky.top, g, grey), bot: mix(sky.bot, g, grey * 0.8) };
  }
  return sky;
}

interface Particle { x: number; y: number; vx: number; vy: number; c: string; ph: number; kind: 'leaf' | 'snow' | 'rain' | 'petal' }
interface Car { x: number; dir: 1 | -1; v: number; c: string; van: boolean }
interface Person { x: number; dir: 1 | -1; v: number; shirt: string; hair: string; dog: boolean; ph: number; umbrella: string | null }

const CAR_COLORS = ['#d9534f', '#3f6f8f', '#f2b134', '#5fbf77', '#e9e4da', '#8e5bb5', '#2d2d35'];
const SHIRTS = ['#c0392b', '#2e86ab', '#f2b134', '#5fbf77', '#8e5bb5', '#e08a3c', '#e9e4da'];
const HAIR = ['#3b2a20', '#e0b050', '#1a1a1a', '#a0522d', '#c0c0c0'];
const UMBRELLAS = ['#d9534f', '#2e86ab', '#f2b134', '#2d2d35'];

const stars = (() => {
  const r = rng(7);
  return Array.from({ length: 26 }, () => [WX + r() * WW, WY + r() * (WH - 24), r()] as const);
})();

export class Outside {
  private particles: Particle[] = [];
  private cars: Car[] = [];
  private people: Person[] = [];
  private nextCar = 1;
  private nextPerson = 0.5;
  private nextLightning = 5;
  private flash = 0;
  private bolt: number[] | null = null;
  private shooting: { x: number; y: number; life: number } | null = null;
  private last = -1;
  private drops = Array.from({ length: 7 }, (_, i) => ({ x: WX + 4 + i * 9, y: WY + Math.random() * WH, v: 2 + Math.random() * 3 }));

  draw(p: Painter, s: RenderScene, sky: Sky, ev: RenderEvents) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, s.time - this.last));
    this.last = s.time;
    const night = 1 - sky.day;
    const season = s.sim.season;
    const snowy = season === 3 || s.weather === 'snow';
    const g = p.g;
    g.save();
    g.beginPath();
    g.rect(WX, WY, WW, WH);
    g.clip();

    for (let y = 0; y < WH; y++) p.rect(WX, WY + y, WW, 1, css(mix(sky.top, sky.bot, y / WH)));
    const clearSky = s.weather === 'clear' || s.weather === 'cloudy';
    if (clearSky) {
      for (const [x, y, ph] of stars) {
        const tw = 0.6 + 0.4 * Math.sin(s.time * 2 + ph * 20);
        if (night > 0.3) p.rect(x, y, 1, 1, `rgba(255,255,230,${(night - 0.3) * tw})`);
      }
      this.drawShootingStar(p, night, dt);
    }
    this.drawSunMoon(p, s, clearSky);
    this.drawClouds(p, s, sky);

    const gy = WY + WH - 11; // ground line
    const houses: [number, number, number, string, string][] = [
      [WX - 2, 14, 13, '#8c5a4a', '#5e3b33'],
      [WX + 13, 12, 17, '#6f7d8c', '#4b5563'],
      [WX + 27, 16, 11, '#a7865c', '#6e573b'],
      [WX + 44, 14, 15, '#7a6a8f', '#4f4560'],
      [WX + 58, 12, 18, '#8c7a5a', '#5e4f3a'],
    ];
    for (const [x, w, h, c, roof] of houses) {
      p.rect(x, gy - h, w, h, c);
      p.rect(x - 1, gy - h - 3, w + 2, 3, roof);
      if (snowy) p.rect(x - 1, gy - h - 4, w + 2, 2, '#f4f7fb');
    }
    const grass = snowy ? '#eef3f8' : ['#7cc96b', '#5aa64f', '#9a9a4a', '#eef3f8'][season];
    p.rect(WX, gy, WW, 2, grass);
    p.rect(WX, gy + 2, WW, 3, snowy ? '#dfe6ee' : '#b8b2a8');
    const wet = s.weather === 'rain' || s.weather === 'storm';
    p.rect(WX, gy + 5, WW, 6, wet ? '#3c3c44' : '#4a4a52');
    for (let x = 0; x < WW; x += 8) p.rect(WX + x, gy + 8, 4, 1, '#d8c76a');
    if (wet) for (let i = 0; i < 4; i++) p.rect(WX + 6 + i * 17, gy + 9, 5, 1, `rgba(180,200,230,${0.3 + 0.2 * Math.sin(s.time * 3 + i)})`);
    const lx = WX + 9;
    p.rect(lx, gy - 22, 1, 24, '#2d2d35');
    p.rect(lx - 1, gy - 23, 4, 2, '#2d2d35');

    this.updateTraffic(s, dt, ev);
    this.drawPeople(p, s, gy);
    this.drawTree(p, WX + 47, gy, s);
    const lights = this.drawCars(p, gy);

    // darkness over the scenery (sky already handles its own)
    if (night > 0) {
      g.fillStyle = `rgba(10,14,40,${night * 0.55})`;
      g.fillRect(WX, WY + 22, WW, WH);
    }
    if (s.weather === 'fog') {
      const fg = g.createLinearGradient(0, WY, 0, WY + WH);
      fg.addColorStop(0, 'rgba(200,205,215,0.15)');
      fg.addColorStop(0.6, `rgba(200,205,215,${0.55 - night * 0.25})`);
      fg.addColorStop(1, 'rgba(200,205,215,0.2)');
      g.fillStyle = fg;
      g.fillRect(WX, WY, WW, WH);
    }
    if (night > 0.2) {
      const lit = rng(3 + s.sim.day);
      for (const [x, w, h] of houses)
        for (let wy = gy - h + 3; wy < gy - 3; wy += 5)
          for (let wx = x + 2; wx < x + w - 2; wx += 4) if (lit() > 0.45) p.rect(wx, wy, 2, 2, `rgba(255,214,120,${night})`);
      p.glow(lx + 1, gy - 21, 14, [255, 220, 140], 0.55 * night);
      p.rect(lx, gy - 21, 2, 1, `rgba(255,236,170,${night})`);
      for (const [x, y, dir] of lights) {
        g.save();
        g.beginPath();
        g.rect(dir > 0 ? x : x - 10, y - 4, 10, 8);
        g.clip();
        p.glow(x, y, 9, [255, 240, 180], 0.7 * night);
        g.restore();
        p.px(x, y, 'rgba(255,250,210,1)');
      }
    } else p.rect(lx, gy - 21, 2, 1, '#9a9aa5');

    this.updateParticles(s, dt, snowy);
    for (const q of this.particles) {
      if (q.kind === 'rain') p.rect(q.x, q.y, 1, 2, 'rgba(190,210,240,0.7)');
      else p.rect(q.x, q.y, 1, 1, q.c);
    }
    this.drawLightning(p, s, dt, ev);
    if (wet) this.drawGlassDrops(p, dt);
    g.restore();
  }

  private drawSunMoon(p: Painter, s: RenderScene, clearSky: boolean) {
    const t = s.sim.t;
    const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const x = WX + 4 + k * (WW - 8);
    const y = WY + WH - 18 - Math.sin(Math.PI * k) * 30;
    const alpha = clearSky ? (s.weather === 'cloudy' ? 0.6 : 1) : 0.25;
    p.g.globalAlpha = alpha;
    if (t < 0.5) p.disc(x, y, 3, '#ffe27a');
    else {
      p.disc(x, y, 3, '#f1efdc');
      // moon phase: shadow disc offset; 0.5 = full
      const off = (s.moon - 0.5) * 14;
      if (Math.abs(off) > 0.6) {
        const sky = skyAt(t, s.weather);
        p.disc(x + off, y, 3, css(mix(sky.top, sky.bot, (y - WY) / WH)));
      } else {
        p.px(x + 1, y - 1, '#d4d1bb');
        p.px(x - 1, y + 1, '#d4d1bb');
      }
    }
    p.g.globalAlpha = 1;
  }

  private drawClouds(p: Painter, s: RenderScene, sky: Sky) {
    const n = { clear: 2, cloudy: 5, rain: 6, storm: 6, snow: 5, fog: 3 }[s.weather];
    const dark = s.weather === 'rain' || s.weather === 'storm';
    const base: RGB = dark ? [120, 125, 140] : [255, 255, 255];
    const ca = 0.25 + 0.65 * sky.day;
    for (let i = 0; i < n; i++) {
      const cx = WX + ((s.time * (1.5 + (i % 3)) + i * 23) % (WW + 30)) - 15;
      const cy = WY + 4 + ((i * 7) % 18);
      const col = css(dark ? mix(base, [40, 44, 60], 1 - sky.day) : base, dark ? 0.9 : ca);
      p.rect(cx, cy, 12 + (i % 2) * 4, 3, col);
      p.rect(cx + 3, cy - 2, 6, 2, col);
    }
  }

  private drawShootingStar(p: Painter, night: number, dt: number) {
    if (night < 0.9) return;
    if (!this.shooting && Math.random() < dt * 0.02) this.shooting = { x: WX + 10 + Math.random() * 40, y: WY + 3 + Math.random() * 8, life: 1 };
    const st = this.shooting;
    if (!st) return;
    st.x += dt * 40;
    st.y += dt * 14;
    st.life -= dt * 1.4;
    for (let i = 0; i < 5; i++) p.px(st.x - i * 2, st.y - i * 0.7, `rgba(255,255,230,${Math.max(0, st.life) * (1 - i / 5)})`);
    if (st.life <= 0) this.shooting = null;
  }

  private updateTraffic(s: RenderScene, dt: number, ev: RenderEvents) {
    const wet = s.weather === 'rain' || s.weather === 'storm';
    // fewer pedestrians at night and in storms
    const peopleRate = (s.sim.isNight ? 0.4 : 1) * (s.weather === 'storm' ? 0.3 : 1);
    this.nextCar -= dt;
    this.nextPerson -= dt * peopleRate;
    if (this.nextCar <= 0) {
      const dir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      this.cars.push({ x: dir > 0 ? WX - 14 : WX + WW + 2, dir, v: 18 + Math.random() * 14, c: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], van: Math.random() < 0.25 });
      this.nextCar = 6 + Math.random() * 16;
      ev.onCar?.(dir);
    }
    if (this.nextPerson <= 0) {
      const dir = (Math.random() < 0.5 ? 1 : -1) as 1 | -1;
      this.people.push({
        x: dir > 0 ? WX - 3 : WX + WW + 1,
        dir,
        v: 3 + Math.random() * 2,
        shirt: SHIRTS[(Math.random() * SHIRTS.length) | 0],
        hair: HAIR[(Math.random() * HAIR.length) | 0],
        dog: Math.random() < 0.2,
        ph: Math.random() * 6,
        umbrella: wet || (s.weather === 'snow' && Math.random() < 0.3) ? UMBRELLAS[(Math.random() * UMBRELLAS.length) | 0] : null,
      });
      this.nextPerson = 8 + Math.random() * 14;
    }
    for (const q of this.people) q.x += q.dir * q.v * dt;
    for (const c of this.cars) c.x += c.dir * c.v * dt;
    this.people = this.people.filter((q) => q.x > WX - 8 && q.x < WX + WW + 8);
    this.cars = this.cars.filter((c) => c.x > WX - 16 && c.x < WX + WW + 16);
  }

  private drawPeople(p: Painter, s: RenderScene, gy: number) {
    for (const q of this.people) {
      const x = Math.round(q.x);
      const step = Math.floor(s.time * 4 + q.ph) % 2;
      const fy = gy + 4;
      p.px(x, fy - 1, '#2d2d35');
      p.rect(x + 1, fy - 1 + step, 1, 1 - step, '#2d2d35');
      p.rect(x, fy - 2, 2, 1, '#3d4a6b');
      p.rect(x, fy - 5, 2, 3, q.shirt);
      p.rect(x, fy - 7, 2, 2, '#e8b48a');
      p.rect(x, fy - 7, 2, 1, s.sim.season === 3 ? '#c0392b' : q.hair);
      if (q.umbrella) {
        p.rect(x - 2, fy - 10, 6, 1, q.umbrella);
        p.rect(x - 1, fy - 11, 4, 1, q.umbrella);
        p.rect(x + 1, fy - 9, 1, 3, '#2d2d35');
      }
      if (q.dog) {
        const dx = x + q.dir * 4;
        p.rect(dx, fy - 2, 3, 1, '#8a5a35');
        p.px(dx + (q.dir > 0 ? 2 : 0), fy - 3, '#8a5a35');
        p.px(dx + step, fy - 1, '#8a5a35');
        p.px(dx + 2 - step, fy - 1, '#8a5a35');
      }
    }
  }

  private drawCars(p: Painter, gy: number): [number, number, number][] {
    const lights: [number, number, number][] = [];
    for (const c of this.cars) {
      const x = Math.round(c.x);
      const y = gy + 5;
      const len = c.van ? 13 : 11;
      p.rect(x, y + 1, len, 3, c.c);
      if (c.van) {
        p.rect(x + 1, y - 2, len - 2, 3, c.c);
        p.rect(c.dir > 0 ? x + len - 4 : x + 2, y - 1, 2, 2, '#9fd3f0');
      } else {
        p.rect(x + 2, y - 1, len - 4, 2, c.c);
        p.rect(x + 3, y - 1, 2, 1, '#9fd3f0');
        p.rect(x + len - 5, y - 1, 2, 1, '#9fd3f0');
      }
      p.rect(x + 1, y + 4, 2, 1, '#1a1a22');
      p.rect(x + len - 3, y + 4, 2, 1, '#1a1a22');
      lights.push([c.dir > 0 ? x + len : x - 1, y + 2, c.dir]);
      p.px(c.dir > 0 ? x : x + len - 1, y + 2, '#a02f24');
    }
    return lights;
  }

  private drawTree(p: Painter, x: number, gy: number, s: RenderScene) {
    const trunk = '#5b3b26';
    p.rect(x - 1, gy - 18, 3, 18, trunk);
    p.rect(x, gy - 22, 1, 4, trunk);
    p.rect(x - 5, gy - 16, 4, 1, trunk);
    p.rect(x + 2, gy - 13, 5, 1, trunk);
    const season = s.sim.season;
    if (season === 3) {
      const br = [[0, -22, -9, -32], [0, -22, 8, -33], [0, -18, -11, -24], [1, -16, 11, -23], [0, -22, 1, -36], [-5, -28, -8, -35], [5, -29, 9, -36]];
      for (const [x0, y0, x1, y1] of br) {
        p.line(x + x0, gy + y0 - 1, x + x1, gy + y1 - 1, '#f4f7fb');
        p.line(x + x0, gy + y0, x + x1, gy + y1, trunk);
      }
      for (const [, , x1, y1] of br) p.rect(x + x1 - 1, gy + y1 - 1, 3, 1, '#f4f7fb');
      return;
    }
    const sway = s.weather === 'storm' ? Math.round(Math.sin(s.time * 3)) : 0;
    const cx = x + sway;
    const cy = gy - 26;
    const r = rng(11);
    const pal = [
      ['#6cbf5e', '#4f9e48', '#8fd47e'],
      ['#3f9e4d', '#2f7d3c', '#58b864'],
      ['#e07b39', '#c94f2c', '#f2b134'],
    ][season];
    p.disc(cx, cy, 11, pal[1]);
    p.disc(cx - 6, cy + 3, 7, pal[1]);
    p.disc(cx + 6, cy + 3, 7, pal[1]);
    p.disc(cx - 1, cy - 1, 9, pal[0]);
    p.disc(cx - 5, cy + 2, 5, pal[0]);
    p.disc(cx + 5, cy + 1, 5, pal[0]);
    for (let i = 0; i < 26; i++) p.px(cx - 10 + r() * 20, cy - 9 + r() * 16, pal[2]);
    if (season === 0) for (let i = 0; i < 18; i++) p.px(cx - 10 + r() * 20, cy - 9 + r() * 16, i % 2 ? '#f7b5cf' : '#fde2ec');
  }

  private updateParticles(s: RenderScene, dt: number, snowy: boolean) {
    const season = s.sim.season;
    const w = s.weather;
    const spawn = (n: number, make: () => Particle) => {
      let k = n * dt;
      while (k > 0) {
        if (Math.random() < Math.min(1, k)) this.particles.push(make());
        k -= 1;
      }
    };
    const tx = WX + 47;
    if (w === 'rain' || w === 'storm')
      spawn(w === 'storm' ? 70 : 40, () => ({ x: WX + Math.random() * (WW + 10), y: WY - 2, vx: w === 'storm' ? -14 : -5, vy: 70 + Math.random() * 20, c: '', ph: 0, kind: 'rain' }));
    if (w === 'snow' || (snowy && w !== 'rain' && w !== 'storm' && w !== 'clear'))
      spawn(w === 'snow' ? 12 : 4, () => ({ x: WX + Math.random() * WW, y: WY - 2, vx: -1 - Math.random(), vy: 6 + Math.random() * 4, c: '#ffffff', ph: Math.random() * 6, kind: 'snow' }));
    if (season === 2) spawn(3, () => ({ x: tx - 10 + Math.random() * 22, y: WY + 16 + Math.random() * 10, vx: -3, vy: 5 + Math.random() * 3, c: ['#e07b39', '#c94f2c', '#f2b134'][(Math.random() * 3) | 0], ph: Math.random() * 6, kind: 'leaf' }));
    if (season === 0 && w !== 'rain' && w !== 'storm')
      spawn(1.5, () => ({ x: tx - 10 + Math.random() * 22, y: WY + 16 + Math.random() * 10, vx: -3, vy: 4 + Math.random() * 3, c: '#f7b5cf', ph: Math.random() * 6, kind: 'petal' }));
    for (const q of this.particles) {
      const wobble = q.kind === 'rain' ? 0 : Math.sin(s.time * 3 + q.ph) * 3;
      q.x += (q.vx + wobble) * dt;
      q.y += q.vy * dt;
    }
    this.particles = this.particles.filter((q) => q.y < WY + WH - 6 && q.x > WX - 4).slice(-400);
  }

  private drawLightning(p: Painter, s: RenderScene, dt: number, ev: RenderEvents) {
    if (s.weather !== 'storm') {
      this.flash = 0;
      return;
    }
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 7 + Math.random() * 14;
      this.flash = 1;
      const pts = [WX + 10 + Math.random() * (WW - 20), WY];
      let x = pts[0];
      for (let y = WY; y < WY + 32; y += 4) {
        x += (Math.random() - 0.5) * 6;
        pts.push(x, y + 4);
      }
      this.bolt = pts;
      ev.onThunder?.();
    }
    if (this.flash > 0) {
      p.rect(WX, WY, WW, WH, `rgba(230,235,255,${this.flash * 0.5})`);
      if (this.bolt && this.flash > 0.6) for (let i = 0; i + 3 < this.bolt.length; i += 2) p.line(this.bolt[i], this.bolt[i + 1] ?? WY, this.bolt[i + 2], this.bolt[i + 3], '#ffffff');
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }
  }

  /** Drops running down the window pane in the rain. */
  private drawGlassDrops(p: Painter, dt: number) {
    for (const d of this.drops) {
      d.y += d.v * dt * (Math.random() < 0.1 ? 6 : 1);
      if (d.y > WY + WH) {
        d.y = WY - 2;
        d.x = WX + 2 + Math.random() * (WW - 4);
      }
      p.rect(d.x, d.y, 1, 2, 'rgba(220,235,255,0.55)');
      p.px(d.x, d.y - 2, 'rgba(220,235,255,0.25)');
    }
  }

  /** Lightning flash level for lighting up the room (0..1). */
  get lightning(): number {
    return this.flash;
  }
}
