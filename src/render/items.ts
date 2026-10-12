import { Sprite, drawSprite, glowSprite, hue, type Painter, type RGB } from './pixel';
import type { Sky } from './outside';
import type { Activity, Pose } from './character';
import { CONSOLE, TV, SOFA, BEANBAG, DOG_BED, DESK, mainMonitor as mainMonitorRect, type Mode, type RenderScene } from './scene';

/**
 * Draw order:
 *  wall → floor → (desk) → desk → [night tint] → (window) → screen
 *  → behind-char → (character, chair) → front → glow → top
 * 'screen' and 'glow' are drawn after the night tint, so they stay bright.
 * 'behind-char' and 'front' are tinted with the character.
 * Within a layer, items draw in ITEM_ART key order (furniture before pets).
 */
export type Layer = 'wall' | 'floor' | 'desk' | 'screen' | 'behind-char' | 'front' | 'glow' | 'top';

export interface ArtCtx {
  /** 0 = day, 1 = night */
  night: number;
  sky: Sky;
  pose: Pose;
  mode: Mode;
  /** Where the character is (desk, standing, gaming, lounging). */
  act: Activity;
  /** How far the (standing) desk top is raised, px. Desk-top items subtract it from y. */
  lift: number;
  /** Animation time of the previous frame, for one-shot events (== s.time on the first frame). */
  prevTime: number;
  /** Fire a pet sound. */
  emit: (pet: 'cat' | 'dog') => void;
}

export interface ItemArt {
  layer: Layer;
  draw(p: Painter, s: RenderScene, ctx: ArtCtx): void;
}

// ───────────────────────── helpers ─────────────────────────

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => k * k * (3 - 2 * k);
/** Did the cycle time `at` (mod period) pass between the previous frame and now? */
const crossed = (ctx: ArtCtx, now: number, period: number, at: number) =>
  now > ctx.prevTime && Math.floor((now - at) / period) > Math.floor((ctx.prevTime - at) / period);

/** Quantised hue → rgb (for cached glow sprites). */
const HUE_RGB: RGB[] = Array.from({ length: 12 }, (_, i) => {
  const h = i / 12;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (0.6 - 0.36 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)] as RGB;
});
const hueRGB = (deg: number): RGB => HUE_RGB[((Math.round(deg / 30) % 12) + 12) % 12];

const additive = (p: Painter, f: () => void) => {
  p.g.globalCompositeOperation = 'lighter';
  f();
  p.g.globalCompositeOperation = 'source-over';
};

function drawZz(p: Painter, x: number, y: number, t: number) {
  const k = (t * 0.45) % 1;
  for (let i = 0; i < 2; i++) {
    const kk = (k + i * 0.5) % 1;
    const a = Math.sin(kk * Math.PI);
    const c = `rgba(240,240,255,${(0.85 * a).toFixed(2)})`;
    const zx = Math.round(x + kk * 5);
    const zy = Math.round(y - kk * 8);
    p.rect(zx, zy, 3, 1, c);
    p.px(zx + 1, zy + 1, c);
    p.rect(zx, zy + 2, 3, 1, c);
  }
}

// ───────────────────────── computer ─────────────────────────

/** A side monitor (bezel on 'desk', content on 'screen'). */
function sideBezel(p: Painter, x: number, y: number, w: number, h: number, lift: number) {
  y -= lift;
  p.rect(x, y, w, h, '#24232d');
  p.rect(x, y, w, 1, '#34333f');
  p.rect(x + w / 2 - 2, y + h, 4, DESK.top - lift - (y + h), '#24232d');
  p.rect(x + w / 2 - 6, DESK.top - lift - 1, 12, 1, '#1a1a22');
}

/** Right-hand screen: notes while studying, study stats otherwise. */
function notesScreen(p: Painter, s: RenderScene, x: number, y: number, w: number, h: number) {
  if (s.mode === 'studying' || s.mode === 'paused') {
    p.rect(x, y, w, h, '#1f2633');
    p.rect(x, y, w, 3, '#2b3547');
    p.rect(x + 2, y + 1, 9, 1, '#f2b134');
    const step = Math.floor(s.time / 3);
    for (let i = 0; i < 5; i++) {
      const n = step + i;
      const len = 6 + ((n * 7) % 15);
      const ly = y + 5 + i * 3;
      if (ly > y + h - 2) break;
      if (n % 4 === 0) p.rect(x + 2, ly, 1, 1, '#82aaff');
      p.rect(x + 4, ly, Math.min(len, w - 6), 1, n % 5 === 2 ? '#f2b134' : '#9aa5b8');
    }
    if (s.mode === 'studying' && ((s.time * 2) | 0) % 2) p.rect(x + 4, y + h - 3, 1, 2, '#e9e4da');
    return;
  }
  p.rect(x, y, w, h, '#1e3a32');
  p.rect(x + 2, y + h - 2, w - 4, 1, '#2f5a4c');
  const bars = Math.floor((w - 4) / 4);
  for (let i = 0; i < bars; i++) {
    const bh = Math.round(4 + ((i * 7 + 3) % 11) + Math.sin(s.time * 0.8 + i) * 1.2);
    p.rect(x + 3 + i * 4, y + h - 2 - bh, 3, bh, i === bars - 1 ? '#f2b134' : '#5fbf77');
  }
}

/** Left-hand screen (triple setup): a lecture video with a progress bar. */
function lectureScreen(p: Painter, s: RenderScene, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, '#e9e4da');
  p.rect(x, y, w, 3, '#2e86ab');
  p.rect(x + 2, y + 1, 10, 1, '#f3ead8');
  // slide: a little plot that redraws every few seconds
  const slide = Math.floor(s.time / 7) % 3;
  p.rect(x + 2, y + 5, 1, 10, '#6b6575');
  p.rect(x + 2, y + 15, 14, 1, '#6b6575');
  for (let i = 0; i < 12; i++) {
    const v = slide === 0 ? i * 0.7 : slide === 1 ? 4 + Math.sin(i * 0.8) * 4 : (i - 6) ** 2 / 5;
    p.px(x + 4 + i, y + 14 - Math.round(Math.min(8, v)), '#c0392b');
  }
  p.rect(x + 18, y + 6, 6, 1, '#6b6575');
  p.rect(x + 18, y + 8, 5, 1, '#9a94a3');
  p.rect(x + 18, y + 10, 6, 1, '#9a94a3');
  // presenter bubble
  p.disc(x + w - 5, y + h - 7, 2, '#3b2a20');
  p.rect(x + w - 7, y + h - 5, 5, 2, '#5b90d2');
  // progress bar
  const prog = ((s.time / 240) % 1) * (w - 4);
  p.rect(x + 2, y + h - 2, w - 4, 1, '#9a94a3');
  p.rect(x + 2, y + h - 2, Math.round(prog), 1, '#d9534f');
}

const RIGHT_MON = { x: 174, y: 52, w: 32, h: 26 };
const LEFT_MON = { x: 96, y: 52, w: 28, h: 26 };

function sideMonitorArt(mon: typeof RIGHT_MON, content: typeof notesScreen): ItemArt[] {
  return [
    { layer: 'desk', draw: (p, _s, { lift }) => sideBezel(p, mon.x, mon.y, mon.w, mon.h, lift) },
    { layer: 'screen', draw: (p, s, { lift }) => content(p, s, mon.x + 2, mon.y + 2 - lift, mon.w - 4, mon.h - 4) },
  ];
}

const rgbKeyboard: ItemArt[] = [
  {
    layer: 'desk',
    draw(p, _s, { lift }) {
      const y = 83 - lift;
      p.rect(131, y, 36, 4, '#1d1d24');
      p.rect(131, y, 36, 1, '#34343f');
      p.rect(131, y + 3, 36, 1, '#121218');
    },
  },
  {
    layer: 'screen',
    draw(p, s, { lift, mode }) {
      const y = 84 - lift;
      const t = s.time;
      const typing = mode === 'studying';
      // rainbow wave across the keys; a ripple flashes where he's typing
      for (let r = 0; r < 2; r++)
        for (let x = 133; x < 165; x += 2) {
          const ripple = typing && ((x * 13 + r * 7 + Math.floor(t * 10)) % 23 === 0);
          p.px(x, y + r, ripple ? '#ffffff' : hue(x * 9 - t * 140 + r * 40, 0.62));
        }
      p.rect(141, y + 1, 14, 1, hue(150 - t * 140, 0.55)); // space bar
    },
  },
  {
    // on the 'screen' layer so his body occludes the underglow
    layer: 'screen',
    draw(p, s, { night, lift }) {
      const t = s.time;
      additive(p, () => {
        for (let i = 0; i < 3; i++) glowSprite(p, 138 + i * 11, 86 - lift, 9, hueRGB(138 * 9 + i * 99 - t * 140), 0.04 + 0.3 * night);
      });
    },
  },
];

const monitorLight: ItemArt[] = [
  {
    layer: 'desk',
    draw(p, s, { lift }) {
      const m = mainMonitorRect(s);
      const w = Math.min(30, m.w - 12);
      const x = Math.round(m.x + m.w / 2 - w / 2);
      const y = m.y - lift - 3;
      p.rect(x, y, w, 2, '#2a2a33');
      p.rect(x, y, w, 1, '#4a4a55');
      p.rect(x + w / 2 - 2, y + 2, 4, 2, '#2a2a33'); // clamp over the bezel
    },
  },
  {
    layer: 'screen',
    draw(p, s, { lift }) {
      const m = mainMonitorRect(s);
      const w = Math.min(30, m.w - 12);
      const x = Math.round(m.x + m.w / 2 - w / 2);
      p.rect(x + 1, m.y - lift - 1, w - 2, 1, '#fff3d6');
    },
  },
  {
    // lights the screen/desk behind him ('screen' layer, so he occludes it)
    layer: 'screen',
    draw(p, s, { night, lift }) {
      const m = mainMonitorRect(s);
      const cx = m.x + m.w / 2;
      const y = m.y - lift;
      const a = 0.08 + 0.2 * night;
      const g = p.g;
      g.globalCompositeOperation = 'lighter';
      const grd = g.createLinearGradient(0, y, 0, y + 16);
      grd.addColorStop(0, `rgba(255,236,200,${a})`);
      grd.addColorStop(1, 'rgba(255,236,200,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx - 15, y);
      g.lineTo(cx + 15, y);
      g.lineTo(cx + 22, y + 16);
      g.lineTo(cx - 22, y + 16);
      g.closePath();
      g.fill();
      glowSprite(p, cx, y - 1, 14, [255, 236, 200], a);
      g.globalCompositeOperation = 'source-over';
    },
  },
];

const TOWER = { x: 102, y: 95, w: 16, h: 25 };
const FANS = [
  [TOWER.x + 8, TOWER.y + 8],
  [TOWER.x + 8, TOWER.y + 17],
];
const pcTower: ItemArt[] = [
  {
    layer: 'floor',
    draw(p) {
      const { x, y, w, h } = TOWER;
      p.rect(x, y, w, h, '#1c1c24');
      p.rect(x, y, w, 1, '#3a3a46');
      p.rect(x, y, 1, h, '#34343f');
      p.rect(x + w - 1, y, 1, h, '#121218');
      for (let i = 0; i < 5; i++) p.px(x + 4 + i * 2, y + 2, '#3a3a46'); // top vents
      p.rect(x + 2, y + 3, w - 4, h - 5, '#101016'); // glass front
      p.rect(x + 1, y + h - 1, 2, 1, '#0b0b0f');
      p.rect(x + w - 3, y + h - 1, 2, 1, '#0b0b0f');
    },
  },
  {
    layer: 'screen',
    draw(p, s) {
      const t = s.time;
      FANS.forEach(([cx, cy], i) => {
        const ring = hue(t * 70 + i * 120, 0.58);
        p.disc(cx, cy, 4, ring);
        p.disc(cx, cy, 3, '#16161d');
        for (let b = 0; b < 3; b++) {
          const a = t * 9 + b * 2.094 + i;
          p.px(cx + Math.round(Math.cos(a) * 1.4), cy + Math.round(Math.sin(a) * 1.4), '#4a4a5a');
          p.px(cx + Math.round(Math.cos(a + 0.35) * 2.6), cy + Math.round(Math.sin(a + 0.35) * 2.6), '#3a3a48');
        }
        p.px(cx, cy, '#6a6a7a');
      });
      p.px(TOWER.x + 13, TOWER.y + 22, ((t * 0.7) | 0) % 2 ? '#5fbf77' : '#3f8f57'); // power LED
      p.rect(TOWER.x + 2, TOWER.y + 3, 1, TOWER.h - 5, hue(t * 70 + 60, 0.5)); // edge strip
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night }) {
      additive(p, () => FANS.forEach(([cx, cy], i) => glowSprite(p, cx, cy, 12, hueRGB(s.time * 70 + i * 120), 0.05 + 0.3 * night)));
    },
  },
];

// ───────────────────────── furniture ─────────────────────────

/** Desk lamp: low on the left of the desk; with the triple setup it becomes a tall lamp peeking over the left monitor. */
const tallLamp = (s: RenderScene) => s.items.has('triple-monitor');
const LAMP_HEAD = { low: { x: 103, y: 62 }, tall: { x: 95, y: 47 } };
const deskLamp: ItemArt[] = [
  {
    layer: 'desk',
    draw(p, s, { lift }) {
      const L = lift;
      const c = '#2d2d35';
      if (tallLamp(s)) {
        p.rect(88, 80 - L, 8, 2, c);
        p.rect(88, 80 - L, 8, 1, '#45454f');
        p.rect(91, 51 - L, 1, 29, c);
        p.line(91, 51 - L, 96, 47 - L, c);
        p.px(91, 51 - L, '#45454f');
        p.rect(94, 43 - L, 9, 4, '#3f6f8f');
        p.rect(95, 42 - L, 7, 1, '#4f86a8');
        return;
      }
      p.rect(96, 80 - L, 10, 2, c);
      p.rect(96, 80 - L, 10, 1, '#45454f');
      p.line(100, 80 - L, 96, 66 - L, c);
      p.line(96, 66 - L, 104, 60 - L, c);
      p.px(96, 66 - L, '#45454f');
      p.rect(102, 58 - L, 8, 4, '#3f6f8f');
      p.rect(103, 57 - L, 6, 1, '#4f86a8');
    },
  },
  {
    layer: 'screen',
    draw(p, s, { lift }) {
      const h = tallLamp(s) ? LAMP_HEAD.tall : LAMP_HEAD.low;
      p.rect(h.x, h.y - lift, 7 - (tallLamp(s) ? 0 : 1), 1, '#ffe9a8');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night, lift }) {
      const h = tallLamp(s) ? LAMP_HEAD.tall : LAMP_HEAD.low;
      p.g.globalCompositeOperation = 'lighter';
      p.glow(h.x + 3, h.y + 12 - lift, 46, [255, 190, 110], 0.08 + 0.3 * night);
      p.g.globalCompositeOperation = 'source-over';
    },
  },
];

/** Fairy lights strung in swags along the top of the wall. */
const SWAG = 40;
const WIRE_Y = Array.from({ length: 240 }, (_, x) => 3 + Math.round(5 * Math.sin(Math.PI * ((x % SWAG) / SWAG))));
const BULB_COLS = ['#ff6b6b', '#ffd166', '#6ee7a8', '#6ec3ff', '#f79ad3'];
const BULB_RGB: RGB[] = [
  [255, 107, 107],
  [255, 209, 102],
  [110, 231, 168],
  [110, 195, 255],
  [247, 154, 211],
];
const BULBS = Array.from({ length: 30 }, (_, k) => 4 + k * 8);
const twinkle = (t: number, k: number) => 0.5 + 0.5 * Math.sin(t * (1.3 + (k % 3) * 0.4) + k * 1.7);
const fairyLights: ItemArt[] = [
  {
    layer: 'wall',
    draw(p) {
      for (let x = 0; x < 240; x++) p.px(x, WIRE_Y[x], '#4a5a3a');
      for (const x of BULBS) p.px(x, WIRE_Y[x] + 1, '#3a4a2a');
    },
  },
  {
    layer: 'screen',
    draw(p, s, { night }) {
      BULBS.forEach((x, k) => {
        const y = WIRE_Y[x] + 2;
        const lvl = twinkle(s.time, k);
        const c = BULB_COLS[k % 5];
        p.rect(x, y, 2, 2, c);
        if (lvl < 0.3 && night > 0.3) p.rect(x, y, 2, 2, 'rgba(20,20,40,0.45)');
        else p.px(x, y, 'rgba(255,255,255,0.7)');
      });
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night }) {
      if (night < 0.05) return;
      additive(p, () =>
        BULBS.forEach((x, k) => glowSprite(p, x + 1, WIRE_Y[x] + 3, 7, BULB_RGB[k % 5], night * (0.15 + 0.4 * twinkle(s.time, k)))),
      );
    },
  },
];

/** Floor lamp standing in the back-left corner. */
const floorLamp: ItemArt[] = [
  {
    layer: 'floor',
    draw(p) {
      p.ellipse(7, 112, 5, 1, '#2d2d35');
      p.rect(6, 62, 2, 50, '#3a3a44');
      p.rect(6, 62, 1, 50, '#55556a');
      p.rect(5, 86, 4, 1, '#2d2d35');
    },
  },
  {
    layer: 'screen',
    draw(p, _s, { night }) {
      // drum shade: cream by day, glowing warm at night
      const lit = night > 0.25;
      for (let i = 0; i < 10; i++) {
        const w = 8 + Math.round(i * 0.7);
        p.rect(7 - w / 2, 52 + i, w, 1, lit ? (i < 2 ? '#ffe7b8' : '#ffd99a') : i < 2 ? '#f3ead8' : '#e8d8bc');
      }
      p.rect(1, 61, 13, 1, lit ? '#fff1cf' : '#cdb894');
      p.rect(3, 52, 8, 1, lit ? '#fff4dc' : '#f8f1e3');
    },
  },
  {
    layer: 'glow',
    draw(p, _s, { night }) {
      p.g.globalCompositeOperation = 'lighter';
      p.glow(7, 64, 64, [255, 196, 120], 0.05 + 0.34 * night);
      p.g.globalCompositeOperation = 'source-over';
    },
  },
];

/** Areca palm in a ceramic pot, front-left: arching fronds with leaflets. */
const FRONDS: [number, number, number, number][] = [
  // angle (rad, 0 = straight up, negative = left), length, droop, shade
  [-1.25, 20, 0.9, 0],
  [1.2, 21, 0.9, 0],
  [-0.75, 26, 0.7, 1],
  [0.7, 26, 0.7, 1],
  [-0.3, 30, 0.5, 2],
  [0.25, 31, 0.55, 2],
  [-1.0, 16, 0.8, 2],
  [0.95, 17, 0.8, 1],
  [0.02, 24, 0.3, 1],
];
const FROND_COLS = ['#2f7a3a', '#3e9148', '#56ad5a'];
const PLANT_BASE = { x: 13, y: 131 };
const bigPlant: ItemArt[] = [
  {
    layer: 'floor',
    draw(p, s) {
      const t = s.time;
      const { x: bx, y: by } = PLANT_BASE;
      FRONDS.forEach(([ang, len, droop, sh], fi) => {
        const col = FROND_COLS[sh];
        const sway = Math.sin(t * 0.7 + fi) * 0.04;
        let x = bx;
        let y = by;
        let a = ang + sway;
        const n = Math.round(len);
        for (let i = 0; i < n; i++) {
          a += (droop * Math.sign(ang || 1) * 2.2) / n; // arch outward and down
          x += Math.sin(a);
          y -= Math.cos(a);
          p.px(x, y, '#3a6b30');
          if (i > 3 && i % 2 === 0) {
            // leaflets hanging off both sides of the rib
            const l = Math.max(1, Math.round(4 * Math.sin((i / n) * Math.PI)));
            for (let k = 1; k <= l; k++) {
              p.px(x - Math.cos(a) * k * 0.6 - 0.2 * k, y - Math.sin(a) * k * 0.6 + k * 0.6, col);
              p.px(x + Math.cos(a) * k * 0.6 + 0.2 * k, y + Math.sin(a) * k * 0.6 + k * 0.6, col);
            }
          }
        }
      });
      // ceramic pot
      p.rect(4, 130, 18, 3, '#e9e4da');
      p.rect(5, 133, 16, 14, '#dcd5c8');
      p.rect(5, 133, 16, 1, '#c4bcae');
      p.rect(6, 138, 14, 2, '#3f6f8f');
      p.rect(6, 147, 14, 1, '#b8ad9c');
      p.rect(4, 130, 18, 1, '#f6f2ea');
      p.rect(19, 134, 1, 12, '#c9c1b2');
    },
  },
];

/** Tall bookshelf standing in the corner behind the right end of the desk. */
const SHELF = { x: 208, y: 12, w: 30, bottom: 108 };
const BOOK_COLS = ['#c0392b', '#2e86ab', '#f2b134', '#5fbf77', '#8e5ea2', '#e07b39', '#e9e4da', '#3a6b55', '#d9534f', '#4a7fc1'];
const BOOKS = (() => {
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows: { x: number; w: number; h: number; c: string; lean: boolean }[][] = [];
  for (let row = 0; row < 6; row++) {
    const books = [];
    let x = 1;
    const gap = row === 1 ? 16 : row === 3 ? 4 : -1; // leave room for ornaments
    while (x < SHELF.w - 4) {
      if (gap > 0 && x >= gap && x < gap + 9) {
        x = gap + 9;
        continue;
      }
      const w = 2 + ((r() * 2) | 0);
      books.push({ x, w, h: 8 + ((r() * 5) | 0), c: BOOK_COLS[(r() * BOOK_COLS.length) | 0], lean: r() < 0.08 });
      x += w + (r() < 0.15 ? 1 : 0);
    }
    rows.push(books);
  }
  return rows;
})();
const bookshelf: ItemArt[] = [
  {
    layer: 'wall',
    draw(p) {
      const { x, y, w, bottom } = SHELF;
      p.rect(x - 1, y - 2, w + 2, 2, '#6a4226');
      p.rect(x, y, w, bottom - y, '#7a4e2c');
      p.rect(x + 2, y, w - 4, bottom - y, '#5a3a20'); // back panel
      for (let i = 0; i < 6; i++) {
        const sy = y + 1 + i * 15;
        for (const b of BOOKS[i]) {
          const by = sy + 14 - b.h;
          if (b.lean) p.line(x + 2 + b.x, sy + 14, x + 2 + b.x + 3, by + 1, b.c);
          else {
            p.rect(x + 2 + b.x, by, b.w, b.h, b.c);
            p.rect(x + 2 + b.x, by + 2, b.w, 1, 'rgba(255,255,255,0.25)');
          }
        }
        p.rect(x, sy + 14, w, 2, '#9a6a40'); // shelf board
        p.rect(x, sy + 16, w, 1, '#4a2f1a');
      }
      // ornaments: a small succulent + a trophy
      const o1 = y + 1 + 15;
      p.rect(x + 19, o1 + 10, 6, 4, '#c26a3d');
      p.rect(x + 20, o1 + 7, 4, 3, '#5aa64f');
      p.px(x + 19, o1 + 8, '#6cbf5e');
      p.px(x + 24, o1 + 8, '#6cbf5e');
      const o2 = y + 1 + 45;
      p.rect(x + 7, o2 + 12, 6, 2, '#c98f1f');
      p.rect(x + 9, o2 + 9, 2, 3, '#f2b134');
      p.rect(x + 7, o2 + 5, 6, 4, '#f2b134');
      p.px(x + 8, o2 + 6, '#fff1c4');
      p.rect(x, y, 1, bottom - y, '#8f5f36');
      p.rect(x + w - 1, y, 1, bottom - y, '#5a3a20');
    },
  },
];

const poster: ItemArt[] = [
  {
    layer: 'wall',
    draw(p) {
      const x = 178;
      const y = 11;
      p.rect(x + 1, y + 1, 22, 28, '#c9ad88'); // shadow
      p.rect(x, y, 22, 28, '#26314a');
      p.rect(x + 1, y + 1, 20, 26, '#2f3e60');
      p.px(x + 4, y + 4, '#e8d7b8');
      p.px(x + 16, y + 3, '#e8d7b8');
      p.px(x + 7, y + 8, '#e8d7b8');
      p.disc(x + 11, y + 10, 4, '#f2b134');
      p.rect(x + 3, y + 17, 16, 5, '#3a6b55');
      p.rect(x + 6, y + 15, 10, 2, '#4f8a6e');
      p.rect(x + 3, y + 23, 16, 2, '#e8d7b8');
      p.px(x + 11, y, '#c0392b'); // pin
    },
  },
];

const rug: ItemArt[] = [
  {
    layer: 'floor',
    draw(p) {
      p.ellipse(152, 132, 52, 10, '#3f6f8f');
      p.ellipse(152, 132, 46, 8, '#e8c76a');
      p.ellipse(152, 132, 40, 6.5, '#3f6f8f');
      p.ellipse(152, 132, 30, 4, '#5b8fb0');
    },
  },
];

/** Media console under the window, shared by the TV, fish tank and PS5. */
function drawConsole(p: Painter) {
  const { x, w, top, bottom } = CONSOLE;
  p.rect(x, top, w, 2, '#a8754a');
  p.rect(x, top, w, 1, '#bf8a5a');
  p.rect(x + 1, top + 2, w - 2, bottom - top - 3, '#7a4e2c');
  const doors = 3;
  const dw = Math.floor((w - 2) / doors);
  for (let i = 0; i < doors; i++) {
    const dx = x + 1 + i * dw;
    p.rect(dx, top + 2, 1, bottom - top - 3, '#5a3a20');
    p.rect(dx + dw / 2 - 1, top + 5, 3, 1, '#d9c3a5');
  }
  p.rect(x + 1, bottom - 1, w - 2, 1, '#5a3a20');
  p.rect(x + 2, bottom, 2, 1, '#3a2614');
  p.rect(x + w - 4, bottom, 2, 1, '#3a2614');
}

const tvArt: ItemArt[] = [
  {
    layer: 'floor',
    draw(p) {
      drawConsole(p);
      const { x, y, w, h } = TV;
      p.rect(x + w / 2 - 3, y + h, 6, 1, '#1d1d24');
      p.rect(x + w / 2 - 7, y + h + 1, 14, 1, '#2d2d35');
      p.rect(x, y, w, h, '#1d1d24');
      p.rect(x, y, w, 1, '#34343f');
      // switched-off glass
      p.rect(x + 2, y + 2, w - 4, h - 5, '#23262f');
      p.line(x + 4, y + h - 5, x + 12, y + 3, '#2f333f');
      p.line(x + 7, y + h - 5, x + 15, y + 3, '#2a2d38');
      p.px(x + w - 4, y + h - 2, '#d9534f'); // standby light
    },
  },
  {
    layer: 'screen',
    draw(p, s, { act }) {
      const { x, y, w, h } = TV;
      const sx = x + 2;
      const sy = y + 2;
      const sw = w - 4;
      const sh = h - 5;
      if (act === 'game' && s.items.has('ps5')) drawGame(p, s.time, sx, sy, sw, sh);
      else if (act === 'lounge') drawShow(p, s.time, sx, sy, sw, sh);
      else return;
      p.px(x + w - 4, y + h - 2, '#5fbf77');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { act, night }) {
      if (!(act === 'game' && s.items.has('ps5')) && act !== 'lounge') return;
      const flick = 0.85 + 0.15 * Math.sin(s.time * 7);
      additive(p, () => glowSprite(p, TV.x + TV.w / 2, TV.y + 8, 34, act === 'game' ? [120, 160, 255] : [255, 200, 150], (0.06 + 0.3 * night) * flick));
    },
  },
];

/** A tiny side-scrolling platformer. */
function drawGame(p: Painter, t: number, x: number, y: number, w: number, h: number) {
  p.g.save();
  p.g.beginPath();
  p.g.rect(x, y, w, h);
  p.g.clip();
  p.rect(x, y, w, h, '#5c94fc');
  const scroll = Math.floor(t * 10);
  // clouds + hills
  for (let i = 0; i < 3; i++) {
    const cx = x + ((((i * 17 - scroll / 3) % 45) + 45) % 45) - 6;
    p.rect(cx, y + 2 + i, 5, 2, '#ffffff');
    const hx = x + ((((i * 23 - scroll / 2) % 50) + 50) % 50) - 8;
    p.rect(hx, y + h - 6, 8, 3, '#3fae5a');
    p.rect(hx + 2, y + h - 7, 4, 1, '#3fae5a');
  }
  // brick ground
  p.rect(x, y + h - 3, w, 3, '#c84c0c');
  for (let i = -1; i < w / 4 + 1; i++) p.px(x + i * 4 + (((-scroll) % 4) + 4) % 4, y + h - 2, '#fcbc8c');
  // ? blocks and a goomba walking at the hero
  const bx = x + ((((20 - scroll) % 40) + 40) % 40);
  p.rect(bx, y + 3, 3, 3, '#fc9838');
  p.px(bx + 1, y + 4, '#7a3a00');
  const ex = x + ((((34 - scroll * 1.3) % 44) + 44) % 44);
  p.rect(ex, y + h - 5, 3, 2, '#8a4a1a');
  // hero hops when the goomba gets close
  const near = ex - (x + 8);
  const jump = near > -3 && near < 9 ? Math.round(Math.sin(((9 - near) / 12) * Math.PI) * 5) : 0;
  const hy = y + h - 7 - jump;
  p.rect(x + 8, hy, 3, 1, '#e0301e');
  p.rect(x + 8, hy + 1, 3, 2, '#2038ec');
  p.px(x + 9, hy + 1, '#fcbc8c');
  // score blink
  p.rect(x + w - 9, y + 1, 7, 1, ((t * 2) | 0) % 2 ? '#ffffff' : '#fcbc8c');
  p.g.restore();
}

/** Nature documentary: a few looping scenes. */
function drawShow(p: Painter, t: number, x: number, y: number, w: number, h: number) {
  const scene = Math.floor(t / 6) % 3;
  if (scene === 0) {
    p.rect(x, y, w, 5, '#f2a65a');
    p.rect(x, y + 5, w, 3, '#e07b39');
    p.rect(x, y + 8, w, h - 8, '#c9a35a');
    p.disc(x + 20, y + 7, 3, '#ffe08a');
    p.rect(x + 6, y + 4, 1, 6, '#3a2a20');
    p.rect(x + 2, y + 3, 9, 2, '#3a2a20');
    const gx = x + ((t * 3) % (w + 8)) - 6;
    p.rect(gx, y + 9, 4, 2, '#5a3a20');
    p.px(gx + 4, y + 8, '#5a3a20');
  } else if (scene === 1) {
    p.rect(x, y, w, 4, '#8fd3ff');
    p.rect(x, y + 4, w, h - 4, '#2e86ab');
    p.rect(x, y + 4, w, 1, '#bfe9ff');
    const wx = x + 10 + Math.round(Math.sin(t) * 2);
    const up = Math.round(Math.max(0, Math.sin(t * 1.2)) * 3);
    p.rect(wx, y + 6 - up, 2, 3 + up, '#2a3a4a');
    p.rect(wx - 2, y + 5 - up, 6, 1, '#2a3a4a');
  } else {
    p.rect(x, y, w, h, '#a8d8a0');
    for (let i = 0; i < 6; i++) {
      const tx = x + 1 + i * 5;
      p.rect(tx + 1, y + 5 + (i % 2), 1, h - 5, '#5a3a20');
      p.disc(tx + 1, y + 4 + (i % 2), 2, i % 2 ? '#2f7a3a' : '#3e9148');
    }
    const bx = x + ((t * 6) % w);
    p.px(bx, y + 2 + Math.round(Math.sin(t * 8)), '#3a2a20');
  }
}

const ps5: ItemArt[] = [
  {
    layer: 'floor',
    draw(p, _s, { act }) {
      const x = 75;
      const y = 85;
      p.rect(x, y, 6, 17, '#f1f1f4');
      p.rect(x + 2, y + 1, 2, 16, '#1d1d24');
      p.rect(x, y, 6, 1, '#ffffff');
      p.rect(x + 5, y + 1, 1, 16, '#c9c9d2');
      p.rect(x - 1, y + 16, 8, 1, '#1d1d24');
      if (act !== 'game') {
        // controller resting on the console
        p.rect(64, 100, 7, 2, '#f1f1f4');
        p.rect(66, 100, 3, 1, '#1d1d24');
        p.px(64, 101, '#c9c9d2');
        p.px(70, 101, '#c9c9d2');
      }
    },
  },
  {
    layer: 'screen',
    draw(p, s, { act }) {
      p.rect(77, 86, 1, 15, act === 'game' ? (((s.time * 2) | 0) % 2 ? '#7ec8ff' : '#4aa3ff') : '#3a6fa8');
    },
  },
];

/** Sofa seen from behind, facing the TV. Drawn over the character when he sits on it. */
const SOFA_COL = { base: '#3f7f74', shade: '#336a61', hi: '#5a9c90', dark: '#29544d' };
const sofa: ItemArt[] = [
  {
    layer: 'front',
    draw(p, s, { act }) {
      const { x, w, top } = SOFA;
      const c = SOFA_COL;
      const lounging = act === 'lounge' && !s.items.has('beanbag');
      // throw pillow peeking over the back (hidden while he sits there)
      if (!lounging && act !== 'game') {
        p.rect(x + 6, top - 4, 11, 5, '#e8c76a');
        p.rect(x + 7, top - 5, 9, 1, '#e8c76a');
        p.rect(x + 6, top - 4, 11, 1, '#f3da8c');
        p.px(x + 11, top - 2, '#c9a54a');
      }
      // rounded armrests sticking out at both ends
      for (const ax of [x - 4, x + w - 4]) {
        p.rect(ax + 1, top + 4, 6, 1, c.hi);
        p.rect(ax, top + 5, 8, 20, c.shade);
        p.rect(ax, top + 5, 8, 1, c.hi);
        p.rect(ax, top + 24, 8, 1, c.dark);
      }
      // backrest: rounded top corners, soft vertical shading
      p.rect(x + 2, top, w - 4, 1, c.hi);
      p.rect(x + 1, top + 1, w - 2, 1, c.hi);
      p.rect(x, top + 2, w, 23, c.base);
      p.rect(x, top + 2, 2, 23, c.shade);
      p.rect(x + w - 2, top + 2, 2, 23, c.shade);
      p.rect(x + 2, top + 3, w - 4, 1, c.hi);
      p.rect(x, top + 22, w, 3, c.shade);
      // knitted blanket draped over the back
      const bx = x + w - 20;
      p.rect(bx, top - 1, 12, 3, '#efe6d6');
      p.rect(bx + 1, top + 2, 10, 11, '#efe6d6');
      for (let y = top + 1; y < top + 13; y += 3) p.rect(bx + 1, y, 10, 1, '#d9534f');
      for (let i = 0; i < 5; i++) p.px(bx + 2 + i * 2, top + 13, '#d9cfc0'); // fringe
      // feet
      for (const fx of [x - 2, x + w - 1]) p.rect(fx, top + 25, 2, 1, '#2d2d35');
      if (lounging) {
        // arm draped along the backrest
        p.rect(x + 36, top - 1, 14, 3, armColour(s));
        p.rect(x + 36, top - 1, 14, 1, 'rgba(255,255,255,0.15)');
        p.rect(x + 50, top - 1, 3, 3, '#e8b48a');
      }
    },
  },
];
const armColour = (s: RenderScene) =>
  s.items.has('hoodie-green') ? '#3e7f4c' : s.items.has('hoodie-black') ? '#26262c' : s.items.has('sweater') ? '#963a3c' : '#3d6aa3';

const beanbag: ItemArt[] = [
  {
    layer: 'front',
    draw(p, _s, { act }) {
      const { cx, cy } = BEANBAG;
      const inUse = act === 'lounge';
      p.ellipse(cx, cy + 3, 18, 8, '#b9862f');
      p.ellipse(cx, cy, 17, 9, '#d9a441');
      p.ellipse(cx - 1, cy - 7 + (inUse ? 2 : 0), 12, 5, '#d9a441');
      p.ellipse(cx - 4, cy - 8 + (inUse ? 2 : 0), 6, 2, '#efc265');
      p.line(cx - 12, cy - 2, cx - 4, cy + 6, '#c79534');
      p.line(cx + 8, cy - 4, cx + 13, cy + 5, '#c79534');
      p.rect(cx - 16, cy + 9, 32, 1, '#9a6f26');
    },
  },
];

// ───────────────────────── pets ─────────────────────────

const CAT_PAL = { o: '#e08a3c', d: '#c26f2a', k: '#3a2a20', p: '#e89a9a', w: '#f3ead8' };
const catHead = ['...............o...o.', '..............ooo.ooo', '..............ooooooo', '..............okoooko'];
const CAT_WALK = [
  new Sprite(
    [...catHead, '...ooodoodoodoooopooo', '..oooodoodoodooowwwo.', '..ooooooooooooooww...', '..ooooooooooooooww...', '...ooooooooooooo.....', '...oo........oo......', '...ww........ww......'],
    CAT_PAL,
  ),
  new Sprite(
    [...catHead, '...ooodoodoodoooopooo', '..oooodoodoodooowwwo.', '..ooooooooooooooww...', '..ooooooooooooooww...', '...ooooooooooooo.....', '.....oo....oo........', '.....ww....ww........'],
    CAT_PAL,
  ),
];
const CAT_SIT = new Sprite(
  [
    '.....o...o...',
    '....ooo.ooo..',
    '....ooooooo..',
    '....okoooko..',
    '....ooopooo..',
    '.....owwwo...',
    '...oooooww...',
    '..ooodooww...',
    '.oooodooww...',
    '.ooodoooww...',
    '.oooooooww...',
    '.ooooooowww..',
    '..ooooo.ww...',
  ],
  CAT_PAL,
);
const CAT_SIT_BLINK = CAT_SIT.recolor({ k: '#c26f2a' });

/** Cat behaviour cycle (s): sleep → wake → walk → groom → hop on desk → sit by monitor → hop down → walk back → sleep. */
const CAT_T = 72;
type Pt = { x: number; y: number };
function catSpots(s: RenderScene, lift: number) {
  const uw = s.items.has('ultrawide');
  return {
    S: { x: 124, y: 141 },
    G: uw ? { x: 192, y: 123 } : { x: 101, y: 123 },
    D: uw ? { x: 199, y: DESK.top - lift } : { x: 113, y: DESK.top - lift },
  };
}

function drawCat(p: Painter, s: RenderScene, ctx: ArtCtx) {
  const t = s.time;
  const c = t % CAT_T;
  const { S, G, D } = catSpots(s, ctx.lift);
  if (crossed(ctx, t, CAT_T, 18)) ctx.emit('cat');
  if (crossed(ctx, t, CAT_T, 44)) ctx.emit('cat');
  const walk = (a: Pt, b: Pt, k: number) => catWalk(p, t, lerp(a.x, b.x, k), lerp(a.y, b.y, k), b.x < a.x);
  const hop = (a: Pt, b: Pt, k: number) => catWalk(p, 0, lerp(a.x, b.x, k), lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * 14, b.x < a.x);
  if (c < 16 && s.items.has('robot-vacuum')) return; // riding the robot vacuum (drawn by it)
  if (c < 17) return catCurl(p, t, S.x, S.y, true);
  if (c < 19) return catSit(p, t, S.x, S.y, true, 'yawn');
  if (c < 26) return walk(S, G, ease((c - 19) / 7));
  if (c < 36) return catSit(p, t, G.x, G.y, true, 'groom');
  if (c < 37) return hop(G, D, (c - 36) / 1);
  if (c < 54) return catSit(p, t, D.x, D.y, Math.floor((c - 37) / 5) % 2 === 0, 'look');
  if (c < 55) return hop(D, G, (c - 54) / 1);
  if (c < 63) return walk(G, S, ease((c - 55) / 8));
  if (c < 65) return catSit(p, t, S.x, S.y, false, 'look');
  return catCurl(p, t, S.x, S.y, true);
}

function catTailUp(p: Painter, t: number, x: number, y: number, dir: number, col: string) {
  const sw = Math.round(Math.sin(t * 2.6));
  const pts = [
    [-9, -7],
    [-10, -8],
    [-11, -9],
    [-11 + sw, -10],
    [-11 + sw, -11],
    [-10 + sw * 2, -12],
  ];
  for (const [lx, ly] of pts) p.px(x + dir * lx, y + ly, col);
}

function catWalk(p: Painter, t: number, x: number, y: number, left: boolean) {
  x = Math.round(x);
  y = Math.round(y);
  const spr = CAT_WALK[Math.floor(t * 7) % 2];
  drawSprite(p, spr, x - 10, y - 11, left);
  catTailUp(p, t, x, y, left ? -1 : 1, CAT_PAL.o);
}

function catSit(p: Painter, t: number, x: number, y: number, faceRight: boolean, act: 'groom' | 'look' | 'yawn') {
  x = Math.round(x);
  y = Math.round(y);
  const dir = faceRight ? 1 : -1;
  // tail sweeping on the ground behind
  const sw = Math.sin(t * 2.2);
  p.rect(x - (faceRight ? 8 : -4), y - 1, 5, 1, CAT_PAL.o);
  p.px(x + dir * (-8 - (sw > 0.3 ? 1 : 0)), y - 2 - (sw > 0.3 ? 1 : 0), CAT_PAL.o);
  p.px(x + dir * -9, y - 2 - Math.round((sw + 1) * 1.5), CAT_PAL.d);
  const blink = act === 'look' && t % 4 < 0.15;
  const bob = act === 'groom' && Math.floor(t * 3) % 2 === 0 ? 1 : 0;
  if (bob) drawSprite(p, CAT_SIT, x - 6, y - 12, !faceRight); // head dips while licking a raised paw
  else drawSprite(p, blink ? CAT_SIT_BLINK : CAT_SIT, x - 6, y - 13, !faceRight);
  if (act === 'groom') {
    const px = x + dir * 3;
    p.rect(px, y - 8 + bob, 1, 3, CAT_PAL.w);
    p.px(px + dir, y - 8 + bob, '#e89a9a');
  }
  if (act === 'yawn') p.rect(x + dir * 1 - (faceRight ? 0 : 1), y - 8, 2, 1, '#b5484a');
}

function catCurl(p: Painter, t: number, x: number, y: number, zz: boolean) {
  const c = CAT_PAL.o;
  const breath = Math.sin(t * 1.6) > 0 ? 1 : 0;
  const cy = y - 4;
  p.ellipse(x, cy, 10, 4, c);
  if (breath) p.rect(x - 6, cy - 5, 12, 1, c);
  for (let i = -5; i <= 5; i += 3) p.rect(x + i, cy - 4 + (breath ? -1 : 0) + 1, 1, 2, CAT_PAL.d);
  // head tucked at the left, tail wrapped around the front
  p.disc(x - 8, cy, 4, c);
  p.rect(x - 12, cy - 5, 2, 2, c);
  p.rect(x - 7, cy - 5, 2, 2, c);
  p.px(x - 11, cy - 4, CAT_PAL.p);
  p.px(x - 6, cy - 4, CAT_PAL.p);
  p.rect(x - 10, cy, 2, 1, CAT_PAL.k);
  p.rect(x - 7, cy, 2, 1, CAT_PAL.k);
  p.rect(x - 9, cy + 3, 18, 1, CAT_PAL.d);
  p.rect(x + 8, cy + 1, 2, 2, c);
  p.px(x - 10, cy + 3, CAT_PAL.w);
  if (zz) drawZz(p, x - 6, cy - 8, t);
}

const DOG_PAL = { o: '#c8874a', c: '#f0dcc0', k: '#3a2a20', r: '#c0392b', e: '#3a2a20', n: '#2a1d16' };
const dogHead = ['.................o..o....', '.................oo.oo...', '................ooooooo..', '................oooeooo..', '................ooooocccn'];
const DOG_WALK = [
  new Sprite(
    [...dogHead, '...oooooooooooooocccccc..', '..ooooooooooooooorccc....', '..ooooooooooooooocc......', '..oooooooooooooocc.......', '...cccccccccccccc........', '....oo.........oo........', '....oo.........oo........', '....cc.........cc........'],
    DOG_PAL,
  ),
  new Sprite(
    [...dogHead, '...oooooooooooooocccccc..', '..ooooooooooooooorccc....', '..ooooooooooooooocc......', '..oooooooooooooocc.......', '...cccccccccccccc........', '......oo....oo...........', '......oo....oo...........', '......cc....cc...........'],
    DOG_PAL,
  ),
];
const DOG_SIT = new Sprite(
  [
    '........o..o.....',
    '........oo.oo....',
    '.......ooooooo...',
    '.......oooeooo...',
    '.......ooooocc...',
    '........occcccn..',
    '......oorccc.....',
    '.....oooccc......',
    '....ooooccc......',
    '....oooocccc.....',
    '...ooooocccc.....',
    '...oooooocc......',
    '..oooooooocc.....',
    '..ooooooo.cc.....',
    '..ccooooo.cc.....',
  ],
  DOG_PAL,
);
const DOG_LIE_ROWS = [
  '.................o..o....',
  '.................oo.oo...',
  '................ooooooo..',
  '...ooooooooooo..oooeooo..',
  '..ooooooooooooooooooocccn',
  '..oooooooooooooorccccc...',
  '..ooooooooooooooccccccc..',
  '...ccccccccccc..cccccccc.',
];
const DOG_LIE = new Sprite(DOG_LIE_ROWS, DOG_PAL);
const DOG_SLEEP = new Sprite(DOG_LIE_ROWS, { ...DOG_PAL, e: '#9a6436' });

/** Dog behaviour cycle (s): sleep → wake & wag → scratch → trot to the chair → sit looking up → back to bed. */
const DOG_T = 80;
function drawDog(p: Painter, s: RenderScene, ctx: ArtCtx) {
  const t = s.time;
  const c = (t + 31) % DOG_T; // offset so cat and dog aren't in sync
  const B = { x: DOG_BED.cx, y: DOG_BED.cy + 1 };
  const C = ctx.act === 'stand' ? { x: 128, y: 129 } : { x: 177, y: 129 };
  if (crossed(ctx, t, DOG_T, 41 - 31)) ctx.emit('dog'); // woof as he sits down by the chair
  if (crossed(ctx, t, DOG_T, 23 - 31 + DOG_T)) ctx.emit('dog'); // waking up
  if (c < 22) return dogLie(p, t, B.x, B.y, true, false);
  if (c < 30) return dogLie(p, t, B.x, B.y, false, true);
  if (c < 35) return dogSit(p, t, B.x - 2, B.y, false, 'scratch');
  if (c < 40) return dogWalk(p, t, lerp(B.x, C.x, ease((c - 35) / 5)), lerp(B.y, C.y, ease((c - 35) / 5)), C.x < B.x);
  if (c < 56) return dogSit(p, t, C.x, C.y, C.x < 150 ? true : false, 'beg');
  if (c < 62) return dogWalk(p, t, lerp(C.x, B.x, ease((c - 56) / 6)), lerp(C.y, B.y, ease((c - 56) / 6)), B.x < C.x);
  return dogLie(p, t, B.x, B.y, c > 70, c <= 70);
}

function dogTail(p: Painter, x: number, y: number, dir: number, pts: number[][]) {
  pts.forEach(([lx, ly], i) => p.px(x + dir * lx, y + ly, i === pts.length - 1 ? DOG_PAL.c : DOG_PAL.o));
}

function dogWalk(p: Painter, t: number, x: number, y: number, left: boolean) {
  x = Math.round(x);
  y = Math.round(y);
  drawSprite(p, DOG_WALK[Math.floor(t * 8) % 2], x - 12, y - 13, left);
  const w = Math.round(Math.sin(t * 16));
  dogTail(p, x, y, left ? -1 : 1, [
    [-11, -8],
    [-12, -9],
    [-13, -10],
    [-13 + w, -11],
    [-12 + w, -12],
  ]);
}

function dogSit(p: Painter, t: number, x: number, y: number, faceRight: boolean, act: 'scratch' | 'beg') {
  x = Math.round(x);
  y = Math.round(y);
  const dir = faceRight ? 1 : -1;
  const wag = act === 'beg' ? Math.round(Math.sin(t * 14) * 1.5) : 0;
  dogTail(p, x, y, dir, [
    [-7, -1],
    [-8, -1],
    [-9, -2 + wag],
    [-10, -2 + wag],
  ]);
  const tilt = act === 'beg' && t % 5 < 1.6 ? 1 : 0;
  drawSprite(p, DOG_SIT, x - 8, y - 15 + tilt, !faceRight);
  if (tilt) p.rect(x - 6, y - 1, 13, 1, DOG_PAL.c); // keep feet on the ground
  if (act === 'scratch') {
    // hind leg kicking at the ear
    const k = Math.floor(t * 12) % 2;
    p.line(x + dir * -4, y - 2, x + dir * (-4 + k), y - 9 - k, DOG_PAL.o);
    p.px(x + dir * (-4 + k), y - 10 - k, DOG_PAL.c);
  }
}

function dogLie(p: Painter, t: number, x: number, y: number, sleeping: boolean, wagging: boolean) {
  x = Math.round(x);
  y = Math.round(y);
  const breath = sleeping && Math.sin(t * 1.4) > 0 ? 1 : 0;
  drawSprite(p, sleeping ? DOG_SLEEP : DOG_LIE, x - 12, y - 8, false);
  if (breath) p.rect(x - 8, y - 6, 9, 1, DOG_PAL.o);
  const w = wagging ? Math.round(Math.sin(t * 12) * 1.5) : 0;
  dogTail(p, x, y, 1, [
    [-11, -3],
    [-12, -3],
    [-13, -3 + Math.min(0, w)],
    [-14, -3 + w],
  ]);
  if (sleeping) drawZz(p, x + 6, y - 11, t + 1.3);
}

const dogBed: ItemArt = {
  layer: 'floor',
  draw(p) {
    const { cx, cy } = DOG_BED;
    p.ellipse(cx, cy, 16, 5, '#6b4f8f');
    p.ellipse(cx, cy, 13, 3, '#8e74b0');
    p.rect(cx - 15, cy, 30, 1, '#5a4078');
  },
};

/** Fish tank on the media console. */
const TANK = { x: 18, y: 87, w: 18, h: 15 };
const FISH = [
  { y: 92, sp: 0.55, ph: 0, c: '#f28c28', fin: '#ffb35c' },
  { y: 95, sp: 0.38, ph: 2.1, c: '#f2d034', fin: '#fff08a' },
  { y: 90, sp: 0.71, ph: 4.2, c: '#e04a6a', fin: '#5fd0ff' },
];
const fishTank: ItemArt[] = [
  {
    layer: 'floor',
    draw(p, s) {
      if (!s.items.has('tv')) drawConsole(p);
      const { x, y, w, h } = TANK;
      p.rect(x, y, w, 2, '#2d2d35');
      p.rect(x, y, w, 1, '#45454f');
      p.rect(x, y + 2, 1, h - 3, '#2d2d35');
      p.rect(x + w - 1, y + 2, 1, h - 3, '#2d2d35');
      p.rect(x, y + h - 2, w, 2, '#2d2d35');
    },
  },
  {
    layer: 'screen',
    draw(p, s, { night }) {
      const t = s.time;
      const x = TANK.x + 1;
      const y = TANK.y + 2;
      const w = TANK.w - 2;
      const h = TANK.h - 4;
      p.rect(x, y, w, h, night > 0.5 ? '#2f86ad' : '#4aa3c7');
      p.rect(x, y, w, 1, '#8fd3ea');
      p.rect(x, y + h - 2, w, 2, '#c9b28a');
      for (let i = 0; i < w; i += 3) p.px(x + i, y + h - 1, '#a88f63');
      // swaying weed + a little castle
      for (let i = 0; i < 6; i++) {
        const sw = Math.round(Math.sin(t * 1.5 + i * 0.6) * (i / 4));
        p.px(x + 2 + sw, y + h - 3 - i, i % 2 ? '#3e9148' : '#56ad5a');
        if (i < 4) p.px(x + 13 + sw, y + h - 3 - i, '#3e9148');
      }
      p.rect(x + 7, y + h - 5, 3, 3, '#9a94a3');
      p.px(x + 7, y + h - 6, '#9a94a3');
      p.px(x + 9, y + h - 6, '#9a94a3');
      p.px(x + 8, y + h - 4, '#3a3a44');
      // fish swimming back and forth
      for (const f of FISH) {
        const ph = t * f.sp + f.ph;
        const fx = Math.round(x + 1.5 + (w - 6) * (0.5 + 0.5 * Math.sin(ph)));
        const right = Math.cos(ph) > 0;
        const fy = f.y + Math.round(Math.sin(t * 1.3 + f.ph) * 0.6);
        p.rect(fx, fy, 3, 2, f.c);
        p.px(right ? fx - 1 : fx + 3, fy + ((t * 4) | 0) % 2, f.fin);
        p.px(right ? fx + 2 : fx, fy, '#1d1d24');
      }
      // bubbles
      for (let k = 0; k < 3; k++) {
        const b = (t * 5 + k * 3.3) % (h - 1);
        p.px(x + w - 3 + Math.round(Math.sin(t * 3 + k) * 0.6), y + h - 2 - b, 'rgba(230,248,255,0.85)');
      }
      p.rect(x, y - 1, w, 1, '#fff3d6'); // hood light
    },
  },
  {
    layer: 'glow',
    draw(p, _s, { night }) {
      additive(p, () => glowSprite(p, TANK.x + TANK.w / 2, TANK.y + 8, 20, [90, 200, 240], 0.04 + 0.26 * night));
    },
  },
];

/** Lizard terrarium under the desk with a glowing heat lamp. */
const TERR = { x: 163, y: 103, w: 26, h: 17 };
const LAMP_X = TERR.x + 17;
const LIZ_T = 44;
const lizard: ItemArt[] = [
  {
    layer: 'floor',
    draw(p) {
      const { x, y, w, h } = TERR;
      p.rect(x, y, w, h, '#2d2d35');
      p.rect(x, y, w, 1, '#55556a');
      for (let i = x + 1; i < x + w - 1; i += 2) p.px(i, y, '#3a3a44'); // mesh lid
      // heat lamp clamped on the lid
      p.rect(LAMP_X - 1, y - 2, 2, 2, '#3a3a44');
      p.rect(LAMP_X - 4, y - 6, 8, 4, '#5a5d6b');
      p.rect(LAMP_X - 3, y - 7, 6, 1, '#6e7180');
    },
  },
  {
    layer: 'screen',
    draw(p, s, { night }) {
      const t = s.time;
      const x = TERR.x + 1;
      const y = TERR.y + 1;
      const w = TERR.w - 2;
      const h = TERR.h - 2;
      p.rect(x, y, w, h, night > 0.5 ? '#b8875a' : '#d9b77e');
      p.rect(x, y, w, 4, night > 0.5 ? '#a8784e' : '#cfa96e');
      p.rect(x, y + h - 3, w, 3, '#e2c48c');
      for (let i = 1; i < w; i += 4) p.px(x + i, y + h - 2, '#c9a56a');
      // hide rock, cactus, basking slate under the lamp
      p.ellipse(x + 5, y + h - 4, 5, 3, '#8d8a86');
      p.rect(x + 2, y + h - 7, 5, 1, '#a8a49e');
      p.rect(x + 11, y + h - 9, 2, 6, '#5aa64f');
      p.px(x + 10, y + h - 7, '#5aa64f');
      p.px(x + 13, y + h - 8, '#5aa64f');
      p.rect(x + 14, y + h - 5, 9, 2, '#9a958c');
      p.rect(x + 14, y + h - 5, 9, 1, '#b8b2a8');
      // the lizard
      const c = t % LIZ_T;
      const rock = { x: x + 4, y: y + h - 8 };
      const bask = { x: x + 18, y: y + h - 6 };
      let lx: number;
      let ly: number;
      let right = true;
      let moving = false;
      if (c < 16) [lx, ly] = [rock.x, rock.y];
      else if (c < 20) {
        const k = ease((c - 16) / 4);
        [lx, ly] = [lerp(rock.x, bask.x, k), lerp(rock.y, bask.y, k) + Math.sin(k * Math.PI) * 2];
        moving = true;
      } else if (c < 38) [lx, ly] = [bask.x, bask.y];
      else if (c < 42) {
        const k = ease((c - 38) / 4);
        [lx, ly] = [lerp(bask.x, rock.x, k), lerp(bask.y, rock.y, k) + Math.sin(k * Math.PI) * 2];
        right = false;
        moving = true;
      } else {
        [lx, ly] = [rock.x, rock.y];
        right = false;
      }
      drawLizard(p, t, Math.round(lx), Math.round(ly), right, moving, c >= 20 && c < 38);
      // warm wash at night
      if (night > 0) p.rect(x, y, w, h, `rgba(255,140,60,${(0.12 * night).toFixed(2)})`);
      p.rect(LAMP_X - 3, TERR.y - 2, 6, 1, '#ffb347'); // bulb
    },
  },
  {
    layer: 'glow',
    draw(p, _s, { night }) {
      additive(p, () => glowSprite(p, LAMP_X, TERR.y + 2, 20, [255, 140, 60], 0.1 + 0.36 * night));
    },
  },
];

function drawLizard(p: Painter, t: number, x: number, y: number, right: boolean, moving: boolean, basking: boolean) {
  const d = right ? 1 : -1;
  const g = '#7fbf4f';
  const dk = '#5a9a3a';
  // tail
  p.px(x - d * 4, y + 1, dk);
  p.px(x - d * 3, y + 1, g);
  p.px(x - d * 5, y + 2, dk);
  // body
  for (let i = -2; i <= 2; i++) p.px(x + d * i, y, g);
  for (let i = -2; i <= 2; i++) p.px(x + d * i, y + 1, i % 2 ? dk : g);
  // head (raised when basking)
  const hy = basking ? y - 1 : y;
  p.rect(right ? x + 3 : x - 4, hy, 2, 2, g);
  p.px(x + d * 4, hy, '#1d1d24');
  // legs scuttle
  const k = moving ? Math.floor(t * 10) % 2 : 0;
  p.px(x + d * (-2 + k), y + 2, dk);
  p.px(x + d * (2 - k), y + 2, dk);
  // tongue flick
  if (t % 2.7 < 0.18) p.px(x + d * 5 + (right ? 0 : 0), hy + 1, '#e04a6a');
}

// ───────────────────────── more furniture (shop wave 2) ─────────────────────────
//
// Spots (logical px), chosen so everything fits at once:
//  wall   neon sign 137..163 × 17..27 (above the main monitor) · red lanterns hang at x 128 / 172 either side of it
//         guitar on a hook 93..101 × 13..41 (between curtain and clock) · harvest wreath under the clock (112, 44)
//         heart lamp under the poster (192, 46)
//  window bat garland swagged from the curtain rod · parrot perch on the left of the sill · tulips mid-sill
//         · tabletop telescope on the right of the sill
//  desk   snow globe at the left end · desk fan 117..129 · study globe 184..194 (right of the mug)
//         · hamster cage 200..219 + coffee machine 220..230 at the right end (over the drawer cabinet)
//  floor  record player on a vinyl crate 86..101 (left of the PC tower) · pumpkin between terrarium and cabinet
//         · festive tree in the right corner in front of the bookshelf · robot-vacuum dock under the desk (126, 104)

/** Draws strings of '#' rows as pixels. */
function glyph(p: Painter, rows: string[], x: number, y: number, c: string) {
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r[i] === '#') p.px(x + i, y + j, c);
  });
}

/** A little eighth note (3x4). */
const NOTE = ['.##', '.#.', '##.', '##.'];
/** Notes drifting up from (x, y): `n` staggered notes, `period` seconds each. */
function floatNotes(p: Painter, t: number, x: number, y: number, n: number, period: number, rise: number, cols: string[]) {
  for (let i = 0; i < n; i++) {
    const k = ((t / period + i / n) % 1 + 1) % 1;
    const a = Math.sin(k * Math.PI);
    const nx = Math.round(x + Math.sin(k * 5 + i * 2) * 3 + (i % 2 ? 2 : -2) * k);
    const ny = Math.round(y - k * rise);
    p.g.globalAlpha = Math.min(1, a * 1.4);
    glyph(p, NOTE, nx, ny, cols[i % cols.length]);
    p.g.globalAlpha = 1;
  }
}

// ── neon sign ──
const NEON = { x: 137, y: 17, w: 27, h: 11 };
const NEON_FONT: Record<string, string[]> = {
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
};
/** 0..1 brightness of a neon letter: the U buzzes out now and then. */
function neonLevel(t: number, i: number) {
  if (i !== 2) return 1;
  const c = t % 11;
  return (c > 5 && c < 5.12) || (c > 5.22 && c < 5.36) || (c > 5.45 && c < 5.5) || (c > 8.6 && c < 8.68) ? 0 : 1;
}
const neonSign: ItemArt[] = [
  {
    layer: 'wall',
    draw(p) {
      const { x, y, w, h } = NEON;
      // power cord dropping behind the monitor
      p.rect(x + w - 4, y + h, 1, 20, '#3a3340');
      p.rect(x + 1, y + 1, w, h, 'rgba(60,40,40,0.18)'); // shadow
      p.rect(x + 1, y, w - 2, h, '#2b2733');
      p.rect(x, y + 1, w, h - 2, '#2b2733');
      p.rect(x + 1, y, w - 2, 1, '#3d3846');
      for (const [sx, sy] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]]) p.px(sx, sy, '#55505f');
    },
  },
  {
    layer: 'screen',
    draw(p, s) {
      const t = s.time;
      const tx = NEON.x + 4;
      const ty = NEON.y + 2;
      [...'STUDY'].forEach((ch, i) => glyph(p, NEON_FONT[ch], tx + i * 4, ty, neonLevel(t, i) ? '#ff7ccb' : '#6b3d5a'));
      // underline swoosh with a little spark at the end
      p.rect(tx, ty + 7, 17, 1, '#5fe3ff');
      p.px(tx + 18, ty + 6, '#5fe3ff');
      p.px(tx + 18, ty + 8, '#5fe3ff');
      p.px(tx + 19, ty + 7, '#5fe3ff');
      p.px(tx + 17, ty + 7, '#d8fbff');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night }) {
      const t = s.time;
      const on = neonLevel(t, 2);
      const buzz = (0.92 + 0.08 * Math.sin(t * 50)) * (on ? 1 : 0.8);
      additive(p, () => {
        glowSprite(p, NEON.x + 12, NEON.y + 5, 22, [255, 110, 200], (0.05 + 0.32 * night) * buzz);
        glowSprite(p, NEON.x + 13, NEON.y + 9, 12, [80, 220, 255], 0.03 + 0.2 * night);
      });
    },
  },
];

// ── red lanterns ──
const LANTERNS = [
  { x: 128, top: 16, ph: 0 },
  { x: 172, top: 16, ph: 1.9 },
];
const lanternSway = (t: number, ph: number) => Math.sin(t * 0.9 + ph) * 1.2;
const redLanterns: ItemArt[] = [
  {
    layer: 'wall',
    draw(p, s) {
      for (const L of LANTERNS) {
        const sw = lanternSway(s.time, L.ph);
        for (let y = 0; y < L.top; y++) p.px(L.x + Math.round((sw * y) / L.top), y, '#7a2a22');
      }
    },
  },
  {
    layer: 'screen',
    draw(p, s, { night }) {
      const lit = night > 0.25;
      const body = lit ? '#ff6a3a' : '#d23a2a';
      const rib = lit ? '#e04a2a' : '#a82a22';
      const hi = lit ? '#ffb070' : '#e85a44';
      const gold = lit ? '#ffd166' : '#d9a441';
      for (const L of LANTERNS) {
        const x = L.x + Math.round(lanternSway(s.time, L.ph));
        const y = L.top;
        p.rect(x - 2, y, 5, 1, gold);
        p.rect(x - 2, y + 1, 5, 1, body);
        p.rect(x - 3, y + 2, 7, 5, body);
        p.rect(x - 2, y + 7, 5, 1, body);
        p.rect(x - 2, y + 8, 5, 1, gold);
        p.rect(x - 1, y + 2, 1, 5, rib);
        p.rect(x + 1, y + 2, 1, 5, rib);
        p.rect(x - 3, y + 2, 1, 5, rib);
        p.rect(x - 2, y + 2, 1, 4, hi);
        // tassel
        const tw = Math.round(lanternSway(s.time - 0.4, L.ph) - lanternSway(s.time, L.ph));
        p.px(x, y + 9, gold);
        p.rect(x + tw, y + 10, 1, 3, '#d23a2a');
      }
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night }) {
      additive(p, () => {
        for (const L of LANTERNS) glowSprite(p, L.x + lanternSway(s.time, L.ph), L.top + 4, 15, [255, 90, 50], 0.04 + 0.3 * night);
      });
    },
  },
];

// ── harvest wreath ──
const WREATH = { x: 112, y: 44 };
const LEAF_COLS = ['#e07b39', '#c0392b', '#f2b134', '#b5651d', '#d9534f', '#e8a23a'];
const WREATH_LEAVES = Array.from({ length: 11 }, (_, i) => {
  const a = (i / 11) * Math.PI * 2 - 1.2;
  const r = 4.4 + (i % 2) * 0.6;
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r), tx: Math.round(Math.cos(a) * (r + 1.9)), ty: Math.round(Math.sin(a) * (r + 1.9)), c: LEAF_COLS[(i * 5) % LEAF_COLS.length] };
});
const harvestWreath: ItemArt[] = [
  {
    layer: 'wall',
    draw(p) {
      const { x, y } = WREATH;
      p.px(x, y - 7, '#5a3a26'); // nail
      p.line(x, y - 7, x - 2, y - 5, '#c9a46a');
      p.line(x, y - 7, x + 2, y - 5, '#c9a46a');
      p.disc(x + 1, y + 1, 6, 'rgba(60,40,30,0.12)');
      // twig ring
      for (let a = 0; a < Math.PI * 2; a += 0.12) {
        p.px(x + Math.round(Math.cos(a) * 4.5), y + Math.round(Math.sin(a) * 4.5), '#7a4e2c');
        p.px(x + Math.round(Math.cos(a) * 3.6), y + Math.round(Math.sin(a) * 3.6), '#8f6238');
      }
      // leaves: little plus shapes with a pointed tip
      for (const L of WREATH_LEAVES) {
        p.px(x + L.tx, y + L.ty, L.c);
        p.px(x + L.x, y + L.y, L.c);
        p.px(x + L.x + 1, y + L.y, L.c);
        p.px(x + L.x - 1, y + L.y, L.c);
        p.px(x + L.x, y + L.y + 1, L.c);
        p.px(x + L.x, y + L.y - 1, L.c);
      }
      // berries + tiny pine cones
      for (const [bx, by] of [[-4, -2], [3, -4], [4, 2], [-3, 3]]) {
        p.px(x + bx, y + by, '#7a1f2a');
        p.px(x + bx + 1, y + by, '#a83244');
      }
      p.rect(x + 4, y - 1, 1, 2, '#6a4226');
      p.rect(x - 5, y, 1, 2, '#6a4226');
      // burlap bow at the bottom
      p.rect(x - 3, y + 4, 2, 2, '#d8b98a');
      p.rect(x + 2, y + 4, 2, 2, '#d8b98a');
      p.rect(x - 1, y + 5, 3, 1, '#c9a46a');
      p.px(x - 2, y + 7, '#c9a46a');
      p.px(x + 2, y + 7, '#c9a46a');
      p.px(x - 3, y + 4, '#ecd4a8');
    },
  },
  {
    // a leaf lets go now and then and drifts down
    layer: 'behind-char',
    draw(p, s) {
      const T = 23;
      const k = (s.time % T) / 4.5;
      if (k >= 1) return;
      const x = WREATH.x + 3 + Math.round(Math.sin(k * 9) * 3 + k * 6);
      const y = WREATH.y + 6 + Math.round(k * 34);
      p.g.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      p.px(x, y, '#e07b39');
      p.px(x + (Math.sin(k * 9) > 0 ? 1 : -1), y, '#c0622a');
      p.g.globalAlpha = 1;
    },
  },
];

// ── heart lamp ──
const HEART = ['.###.###.', '#########', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'];
const HEART_AT = { x: 188, y: 42 };
const heartBeat = (t: number) => {
  const c = t % 2.2;
  return Math.max(0, 1 - Math.abs(c - 0.15) * 7) + 0.6 * Math.max(0, 1 - Math.abs(c - 0.45) * 7);
};
const heartLamp: ItemArt[] = [
  {
    layer: 'wall',
    draw(p) {
      const { x, y } = HEART_AT;
      glyph(p, HEART, x + 1, y + 1, 'rgba(90,40,60,0.18)');
    },
  },
  {
    layer: 'screen',
    draw(p, _s, { night }) {
      const { x, y } = HEART_AT;
      const lit = night > 0.25;
      glyph(p, HEART, x, y, lit ? '#ff8cc0' : '#f48fb1');
      glyph(p, ['', '', '.......#', '.......#', '......#', '.....#'], x, y, lit ? '#ff6aa8' : '#d9668f');
      p.rect(x + 1, y + 1, 2, 1, lit ? '#fff0f6' : '#ffd1e3');
      p.px(x + 1, y + 2, lit ? '#fff0f6' : '#ffd1e3');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night }) {
      additive(p, () => glowSprite(p, HEART_AT.x + 4, HEART_AT.y + 4, 16, [255, 120, 180], (0.04 + 0.3 * night) * (0.8 + 0.25 * heartBeat(s.time))));
    },
  },
];

// ── guitar on a wall hook ──
const GTR = { x: 97, y: 11 };
const GTR_BODY: [number, number][] = [
  // [dy from hook, half-width]
  [15, 2],
  [16, 3],
  [17, 3],
  [18, 3],
  [19, 3],
  [20, 2],
  [21, 3],
  [22, 4],
  [23, 4],
  [24, 4],
  [25, 4],
  [26, 4],
  [27, 3],
  [28, 2],
];
const guitar: ItemArt[] = [
  {
    layer: 'wall',
    draw(p, s, { mode }) {
      const { x, y } = GTR;
      p.px(x, y, '#3a3a44'); // hook
      // shadow on the wall
      for (const [dy, hw] of GTR_BODY) p.rect(x - hw + 1, y + dy + 1, hw * 2 + 1, 1, 'rgba(60,40,30,0.15)');
      // headstock + tuning pegs
      p.rect(x - 1, y + 1, 3, 4, '#3a2414');
      for (const py of [y + 2, y + 4]) {
        p.px(x - 2, py, '#c9c6cf');
        p.px(x + 2, py, '#c9c6cf');
      }
      // neck + frets
      p.rect(x - 1, y + 5, 3, 10, '#5a3a20');
      for (let fy = y + 6; fy < y + 15; fy += 2) p.rect(x - 1, fy, 3, 1, '#7a5a3a');
      // body: honey top, cream binding, darker right side
      for (const [dy, hw] of GTR_BODY) {
        p.rect(x - hw, y + dy, hw * 2 + 1, 1, '#e0a35a');
        p.px(x - hw, y + dy, '#f3ead8');
        p.px(x + hw, y + dy, '#b5763a');
      }
      p.rect(x - 1, y + 15, 3, 1, '#f3ead8');
      p.rect(x - 1, y + 28, 3, 1, '#b5763a');
      p.disc(x, y + 20, 1, '#2a1a10'); // sound hole
      p.px(x - 2, y + 20, '#a8754a');
      p.px(x + 2, y + 20, '#a8754a');
      p.rect(x - 2, y + 25, 5, 1, '#3a2414'); // bridge
      // strings: shimmer on breaks
      const brk = mode === 'break';
      for (const sx of [x - 1, x + 1])
        for (let sy = y + 2; sy < y + 25; sy++) {
          const wob = brk && sy > y + 15 ? Math.round(Math.sin(s.time * 40 + sy + sx) * 0.6) : 0;
          const glint = brk && ((sy * 3 + sx - Math.floor(s.time * 20)) % 9 + 9) % 9 === 0;
          p.px(sx + wob, sy, glint ? '#ffffff' : '#d8d4cc');
        }
    },
  },
  {
    layer: 'top',
    draw(p, s, { mode }) {
      if (mode !== 'break') return;
      // a couple of little sparkles while the strings ring
      for (let i = 0; i < 2; i++) {
        const k = (s.time * 0.8 + i * 0.5) % 1;
        p.g.globalAlpha = Math.sin(k * Math.PI) * 0.9;
        const sx = GTR.x + (i ? 5 : -5) + Math.round(Math.sin(k * 6 + i) * 1.5);
        const sy = GTR.y + 26 - Math.round(k * 10);
        p.px(sx, sy, '#fff3b0');
        if (k > 0.3 && k < 0.7) {
          p.px(sx - 1, sy, '#fff3b0');
          p.px(sx + 1, sy, '#fff3b0');
          p.px(sx, sy - 1, '#fff3b0');
          p.px(sx, sy + 1, '#fff3b0');
        }
        p.g.globalAlpha = 1;
      }
    },
  },
];

// ── bat garland (strung from the curtain rod across the top of the window) ──
const GARL = { x0: 5, x1: 91, sag: 7 };
const garlY = (x: number) => {
  const half = (GARL.x1 - GARL.x0) / 2;
  const k = ((x - GARL.x0) % half) / half;
  return 8 + Math.round(GARL.sag * Math.sin(Math.PI * k));
};
const BAT_ROWS = ['#.......#', '##.#.#.##', '#########', '.#.###.#.'];
const BATS = [
  new Sprite(BAT_ROWS.map((r, i) => (i === 2 ? '###e#e###' : r)), { '#': '#2b2235', e: '#f2b134' }),
  new Sprite(BAT_ROWS.map((r, i) => (i === 2 ? '###e#e###' : r)), { '#': '#6a3d8f', e: '#f2b134' }),
];
/** Wings tucked up a little (alternate frame for the sway). */
const BATS_UP = [
  new Sprite(['.........', '##.#.#.##', '###e#e###', '#.#####.#'], { '#': '#2b2235', e: '#f2b134' }),
  new Sprite(['.........', '##.#.#.##', '###e#e###', '#.#####.#'], { '#': '#6a3d8f', e: '#f2b134' }),
];
const BAT_X = [15, 27, 39, 57, 70, 82];
const batGarland: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s) {
      const t = s.time;
      for (let x = GARL.x0; x <= GARL.x1; x++) p.px(x, garlY(x), '#5a4a3a');
      BAT_X.forEach((bx, i) => {
        const sway = Math.round(Math.sin(t * 1.3 + i * 1.1) * 0.8);
        const flutter = Math.sin(t * 0.7 + i * 2.3) > 0.85;
        const y = garlY(bx) + 1;
        p.px(bx, y, '#5a4a3a');
        drawSprite(p, (flutter ? BATS_UP : BATS)[i % 2], bx - 4 + sway, y + 1);
      });
    },
  },
];

// ── tabletop telescope on the sill ──
const SCOPE = { x: 74, y: 66 };
const scopeAngle = (night: number) => 0.35 + 0.42 * (Math.round(night * 3) / 3);
const telescope: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, _s, { night }) {
      const { x, y } = SCOPE;
      const leg = '#5a3a20';
      p.line(x, y + 1, x - 5, y + 8, leg);
      p.line(x, y + 1, x + 5, y + 8, leg);
      p.line(x, y + 1, x + 1, y + 8, '#7a4e2c');
      p.rect(x - 1, y, 3, 2, '#3a3a44'); // mount
      const a = scopeAngle(night);
      const dx = -Math.cos(a);
      const dy = -Math.sin(a);
      // shadow side, then the tube; dew shield at the front, eyepiece at the back
      for (let i = -5; i <= 9; i += 0.5) p.rect(Math.round(x + dx * i) - 1, Math.round(y + dy * i), 3, 2, '#b8b2a8');
      for (let i = -5; i <= 9; i += 0.5) p.rect(Math.round(x + dx * i) - 1, Math.round(y + dy * i) - 1, 3, 2, '#e9e4da');
      for (let i = 8; i <= 10; i += 0.5) p.rect(Math.round(x + dx * i) - 1, Math.round(y + dy * i) - 1, 3, 3, '#d9a441');
      p.rect(Math.round(x + dx * 10.5) - 1, Math.round(y + dy * 10.5) - 1, 2, 2, '#9fc3d6'); // lens
      for (let i = 1; i <= 2; i++) p.rect(Math.round(x + dx * i) - 1, Math.round(y + dy * i) - 1, 3, 2, '#c0392b'); // band
      const ex = Math.round(x - dx * 6);
      const ey = Math.round(y - dy * 6);
      p.rect(ex, ey, 2, 2, '#2d2d35');
      p.line(Math.round(x + dx * 4), Math.round(y + dy * 4) - 2, Math.round(x + dx * 7), Math.round(y + dy * 7) - 2, '#c9c6cf'); // finder
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night, mode }) {
      if (mode !== 'break' || night < 0.5) return;
      const a = scopeAngle(night);
      const ex = Math.round(SCOPE.x + Math.cos(a) * 6) + 1;
      const ey = Math.round(SCOPE.y + Math.sin(a) * 6);
      const tw = 0.5 + 0.5 * Math.sin(s.time * 5);
      const c = `rgba(255,248,210,${(0.5 + 0.5 * tw).toFixed(2)})`;
      p.px(ex, ey - 1, c);
      if (tw > 0.4) {
        p.px(ex - 1, ey - 1, c);
        p.px(ex + 1, ey - 1, c);
        p.px(ex, ey - 2, c);
        p.px(ex, ey, c);
      }
      additive(p, () => glowSprite(p, ex, ey - 1, 5, [255, 240, 190], 0.25 * tw));
    },
  },
];

// ── tulips in a vase (on the sill) ──
const VASE = { x: 46, y: 74 };
const TULIPS = [
  { dx: -3, h: 9, c: '#d9534f', d: '#b5403c' },
  { dx: 0, h: 12, c: '#f48fb1', d: '#d9668f' },
  { dx: 3, h: 8, c: '#f2c12e', d: '#d9a420' },
];
const flowerVase: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s) {
      const { x, y } = VASE;
      TULIPS.forEach((f, i) => {
        const sw = Math.round(Math.sin(s.time * 0.8 + i * 1.7) * 0.6);
        const hx = x + f.dx + sw;
        const hy = y - 5 - f.h;
        p.line(x + Math.sign(f.dx), y - 5, hx, hy + 3, '#4f9e48');
        p.rect(hx - 1, hy + 1, 3, 2, f.c);
        p.px(hx - 1, hy, f.c);
        p.px(hx + 1, hy, f.c);
        p.px(hx, hy + 1, f.d);
        p.px(hx + 1, hy + 2, f.d);
      });
      // leaves
      p.line(x - 1, y - 5, x - 4, y - 9, '#3e9148');
      p.line(x + 1, y - 5, x + 3, y - 10, '#56ad5a');
      // glass vase with water
      p.rect(x - 2, y - 6, 5, 1, '#d6eef7');
      p.rect(x - 3, y - 5, 7, 5, '#a9d8ec');
      p.rect(x - 3, y - 3, 7, 3, '#7fbcd8');
      p.px(x - 2, y - 4, '#ffffff');
      p.rect(x - 2, y, 5, 1, '#5f9fbd');
    },
  },
];

// ── parrot on a perch at the left of the sill ──
const PERCH = { x0: 15, x1: 35, y: 63, post: 25 };
const PAR_PAL = { r: '#d63a2f', d: '#a82a22', y: '#f2c12e', b: '#2e6fbf', w: '#f3ead8', k: '#1d1d24', B: '#efe6d6', n: '#2d2d35', g: '#8a8a96' };
const PAR_HEAD = new Sprite(['...rrr..', '..rrrrr.', '..rrwkB.', '..rrwwBB', '..rrrrnB'], PAR_PAL);
const PAR_HEAD_SHUT = PAR_HEAD.recolor({ k: '#e9dccb' });
const PAR_BODY = new Sprite(['..rrrrr.', '.yrrrrr.', '.yyyrrr.', '.bbbrr..', '..bbbr..', '...gg...', '..rb....', '..rb....', '.rb.....', '.b......'], PAR_PAL);
const PAR_BODY_FLAP = new Sprite(['..rrrrr.', '..rrrrr.', '..rrrrr.', '..rrrr..', '..rrrr..', '...gg...', '..rb....', '..rb....', '.rb.....', '.b......'], PAR_PAL);
const PAR_T = 34;
const WING_UP: [number, number, 'b' | 'y'][] = [[0, -2, 'b'], [-1, -3, 'b'], [-2, -4, 'b'], [0, -1, 'y'], [-1, -2, 'y'], [-2, -3, 'y'], [1, -1, 'y']];
const WING_DOWN: [number, number, 'b' | 'y'][] = [[0, 3, 'b'], [-1, 4, 'b'], [-2, 5, 'b'], [0, 2, 'y'], [-1, 3, 'y'], [1, 2, 'y']];
/** Parrot x on the perch (feet centre). */
const PAR_X = [19, 31];
function parrotState(s: RenderScene, night: number) {
  const t = s.time;
  const c = t % PAR_T;
  const asleep = night > 0.6 && s.mode === 'idle';
  if (asleep) return { x: PAR_X[0], lift: 0, right: true, act: 'sleep' as const };
  const hop = (a: number, b: number, k: number) => ({ x: lerp(a, b, k), lift: Math.abs(Math.sin(k * Math.PI * 3)) * 2 });
  if (c < 8) return { x: PAR_X[0], lift: 0, right: true, act: 'bob' as const };
  if (c < 9.2) return { ...hop(PAR_X[0], PAR_X[1], (c - 8) / 1.2), right: true, act: 'hop' as const };
  if (c < 15) return { x: PAR_X[1], lift: 0, right: false, act: 'sing' as const };
  if (c < 16.6) return { x: PAR_X[1], lift: Math.floor(t * 8) % 2, right: false, act: 'flap' as const };
  if (c < 24) return { x: PAR_X[1], lift: 0, right: false, act: 'bob' as const };
  if (c < 25.2) return { ...hop(PAR_X[1], PAR_X[0], (c - 24) / 1.2), right: false, act: 'hop' as const };
  if (c < 30) return { x: PAR_X[0], lift: 0, right: true, act: 'bob' as const };
  if (c < 31.2) return { x: PAR_X[0], lift: Math.floor(t * 8) % 2, right: true, act: 'flap' as const };
  return { x: PAR_X[0], lift: 0, right: true, act: 'sing' as const };
}
const parrot: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { night, mode }) {
      const t = s.time;
      const { x0, x1, y, post } = PERCH;
      // T-perch standing on the sill
      p.rect(post - 3, 74, 7, 1, '#5a3a20');
      p.rect(post, y + 2, 1, 72 - y, '#8a5a35');
      const st = parrotState(s, night);
      const px = Math.round(st.x);
      const fy = y - 1 - Math.round(st.lift); // feet row
      const left = px - 3;
      const top = fy - 10;
      const flip = !st.right;
      const music = mode === 'studying' || mode === 'break' || s.items.has('record-player');
      let bob = 0;
      if (st.act === 'bob') bob = music ? Math.floor(t * 4) % 2 : t % 1.6 < 0.25 ? 1 : 0;
      if (st.act === 'sleep') bob = 1;
      const flapUp = st.act === 'flap' && Math.floor(t * 12) % 2 === 0;
      drawSprite(p, st.act === 'flap' ? PAR_BODY_FLAP : PAR_BODY, left, top + 5, flip);
      if (st.act === 'flap') {
        // wing beating above / below the back
        const d = flip ? -1 : 1;
        const bx = px - d * 2;
        for (const [ox, oy, k] of flapUp ? WING_UP : WING_DOWN) p.px(bx + d * ox, top + 6 + oy, PAR_PAL[k]);
      }
      drawSprite(p, st.act === 'sleep' || t % 3.7 < 0.12 ? PAR_HEAD_SHUT : PAR_HEAD, left, top + bob, flip);
      if (st.act === 'sing' && Math.floor(t * 5) % 2 === 0) p.px(flip ? left + 1 : left + 6, top + bob + 5, PAR_PAL.n); // beak open
      // perch bar on top of the feet
      p.rect(x0, y, x1 - x0, 2, '#a0703f');
      p.rect(x0 + 1, y, x1 - x0 - 2, 1, '#c09060');
      p.px(x0, y + 1, '#7a4e2c');
      p.px(x1 - 1, y + 1, '#7a4e2c');
      // seed cup clipped to the post
      p.rect(post + 1, y + 4, 4, 3, '#3f86c7');
      p.rect(post + 1, y + 4, 4, 1, '#f2b134');
      p.rect(px - 1, fy + 1, 2, 1, PAR_PAL.g); // toes wrapped over the bar
      if (st.act === 'sleep') drawZz(p, px + 3, top - 1, t);
    },
  },
  {
    layer: 'top',
    draw(p, s, { night }) {
      const st = parrotState(s, night);
      if (st.act !== 'sing') return;
      const c = s.time % PAR_T;
      const t0 = c < 15 ? c - 9.2 : c - 31.2;
      const x = Math.round(st.x) + (st.right ? 4 : -6);
      floatNotes(p, t0, x, PERCH.y - 12, 2, 1.6, 10, ['#5fbf77', '#f2b134']);
    },
  },
];

// ── record player on a vinyl crate ──
const REC = { x: 86, y: 103, w: 16 };
const RECORD_COLS = ['#c0392b', '#2e86ab', '#f2b134', '#1d1d24', '#5fbf77', '#8e5ea2', '#e9e4da', '#d9534f'];
const playing = (m: Mode) => m === 'studying' || m === 'break';
const recordPlayer: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { mode }) {
      const { x, y, w } = REC;
      const t = s.time;
      const on = playing(mode);
      // wooden crate with record spines showing
      const cy0 = y + 7;
      p.rect(x, cy0, w, 12, '#b07a48');
      p.rect(x + 2, cy0 + 2, w - 4, 8, '#3a2614');
      for (let i = 0; i < w - 4; i++) if (i % 3 !== 2) p.rect(x + 2 + i, cy0 + 2 + (i % 4 === 0 ? 1 : 0), 1, 8 - (i % 4 === 0 ? 1 : 0), RECORD_COLS[(i * 5) % RECORD_COLS.length]);
      p.rect(x, cy0, 1, 12, '#8a5a35');
      p.rect(x + w - 1, cy0, 1, 12, '#8a5a35');
      p.rect(x + 1, cy0 + 10, w - 2, 1, '#c99560');
      p.rect(x, cy0 + 11, w, 1, '#6a4226');
      // teal suitcase turntable: cream deck on top, teal case front
      p.rect(x, y + 3, w, 4, '#3f8f8a');
      p.rect(x, y + 3, w, 1, '#5fb0a8');
      p.rect(x, y + 6, w, 1, '#2f6f6b');
      p.px(x + 2, y + 4, '#efe6d6');
      p.px(x + 4, y + 4, '#efe6d6');
      for (let i = 0; i < 3; i++) p.px(x + 9 + i * 2, y + 5, '#2f6f6b'); // speaker grille
      p.px(x + w - 2, y + 4, on ? '#7dffb0' : '#a84a3a');
      p.rect(x, y, w, 3, '#efe6d6');
      p.rect(x, y, w, 1, '#fff8ea');
      // vinyl on the platter
      const cx = x + 6;
      p.rect(cx - 4, y, 9, 3, '#1d1d24');
      p.rect(cx - 3, y - 1, 7, 1, '#1d1d24');
      p.rect(cx - 1, y + 1, 2, 1, '#d9534f');
      if (on) {
        const a = t * 3.5;
        p.px(cx + Math.round(Math.cos(a) * 3.4), y + 1 + Math.round(Math.sin(a) * 1.2), '#6a6a7a');
        p.px(cx + Math.round(Math.cos(a + Math.PI) * 2.6), y + 1 + Math.round(Math.sin(a + Math.PI) * 1), '#44444f');
      } else p.px(cx - 3, y, '#44444f');
      // tonearm: on the record while playing, parked otherwise
      const px = x + w - 3;
      p.rect(px, y - 1, 2, 2, '#c9c6cf');
      if (on) {
        p.line(px, y - 1, cx + 3, y, '#c9c6cf');
        p.px(cx + 2, y + 1, '#55556a');
      } else {
        p.line(px, y - 1, px, y + 2, '#c9c6cf');
        p.px(px, y + 2, '#55556a');
      }
    },
  },
  {
    layer: 'top',
    draw(p, s, { mode }) {
      if (!playing(mode)) return;
      floatNotes(p, s.time, REC.x + 6, REC.y - 4, 3, 3.2, 20, ['#f2b134', '#c792ea', '#6ec3ff']);
    },
  },
];

// ── coffee machine at the right end of the desk ──
const COFFEE = { x: 220, w: 11, h: 18 };
/** Breaks: a gurgle burst every few seconds. */
const gurgling = (s: RenderScene) => s.mode === 'break' && s.time % 4 < 1.3;
const coffeeMachine: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { lift }) {
      const shake = gurgling(s) && Math.floor(s.time * 14) % 2 ? 1 : 0;
      const x = COFFEE.x + shake;
      const y = DESK.top - lift - COFFEE.h;
      const t = s.time;
      // water tank on top
      p.rect(x + 1, y, 9, 4, '#cfe3ea');
      p.rect(x + 2, y + 1, 7, 3, '#7fb8d6');
      p.rect(x + 1, y, 9, 1, '#26262c');
      if (gurgling(s)) p.px(x + 3 + (Math.floor(t * 6) % 5), y + 2, '#e6f6fc'); // bubble
      // body
      p.rect(x, y + 4, COFFEE.w, 13, '#3a3a46');
      p.rect(x, y + 4, 1, 13, '#4d4d5a');
      p.rect(x + COFFEE.w - 1, y + 4, 1, 13, '#2a2a33');
      p.rect(x, y + 4, COFFEE.w, 1, '#55556a');
      p.px(x + 2, y + 6, '#9a94a3');
      p.px(x + 4, y + 6, '#9a94a3');
      // brew recess, spout, cup on the drip tray
      p.rect(x + 2, y + 8, 7, 7, '#1d1d24');
      p.rect(x + 4, y + 8, 3, 2, '#9a94a3');
      p.rect(x + 3, y + 12, 5, 3, '#e9e4da');
      p.rect(x + 3, y + 12, 5, 1, '#5a3420');
      p.px(x + 8, y + 13, '#e9e4da');
      p.rect(x + 1, y + 15, 9, 1, '#6a6a7a');
      p.rect(x, y + 17, COFFEE.w, 1, '#26262c');
      // drip
      const brewing = s.mode === 'break';
      if (brewing ? Math.floor(t * 6) % 3 !== 0 : t % 3 < 0.3) p.px(x + 5, y + 10 + (Math.floor(t * 8) % 2), '#5a3420');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { lift }) {
      const y = DESK.top - lift - COFFEE.h;
      const shake = gurgling(s) && Math.floor(s.time * 14) % 2 ? 1 : 0;
      p.px(COFFEE.x + 8 + shake, y + 6, s.mode === 'break' ? (Math.floor(s.time * 2) % 2 ? '#5fbf77' : '#3f8f57') : '#d9534f');
    },
  },
  {
    layer: 'top',
    draw(p, s, { lift }) {
      const t = s.time;
      const y = DESK.top - lift - COFFEE.h;
      // wisps over the cup
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.5 + i / 2) % 1;
        p.px(COFFEE.x + 5 + Math.round(Math.sin(t * 2 + i * 3) * 1.2), y + 11 - k * 6, `rgba(255,255,255,${(0.4 * (1 - k)).toFixed(2)})`);
      }
      if (s.mode !== 'break') return;
      // gurgle: puffs from the top vent
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.7 + i / 3) % 1;
        const a = (0.55 * (1 - k)).toFixed(2);
        const px = COFFEE.x + 7 + Math.round(k * 4 + Math.sin(t * 1.5 + i) * 1.5);
        const py = Math.round(y - 1 - k * 12);
        const r = k < 0.3 ? 1 : 2;
        p.rect(px, py, r + 1, r, `rgba(255,255,255,${a})`);
        p.px(px + 1, py - 1, `rgba(255,255,255,${a})`);
      }
    },
  },
];

// ── snow globe at the left end of the desk ──
const snowGlobeX = (s: RenderScene) => (s.items.has('triple-monitor') ? 100 : 92);
const snowGlobe: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { lift }) {
      const t = s.time;
      const cx = snowGlobeX(s);
      const cy = DESK.top - lift - 8;
      // wooden base
      p.rect(cx - 3, cy + 5, 7, 3, '#7a4e2c');
      p.rect(cx - 3, cy + 5, 7, 1, '#a0703f');
      p.px(cx, cy + 6, '#f2b134');
      // glass ball with a tiny snowy tree
      p.disc(cx, cy, 4, '#7fa8bf');
      p.disc(cx, cy, 3, '#cfe8f5');
      p.rect(cx - 2, cy + 2, 5, 1, '#ffffff');
      p.rect(cx - 1, cy + 1, 3, 1, '#f3f7fa');
      p.px(cx, cy - 1, '#3e9148');
      p.rect(cx - 1, cy, 3, 1, '#2f7a3a');
      p.px(cx - 2, cy - 2, '#ffffff');
      // flakes: settle slowly, swirl up every so often
      const c = t % 16;
      const swirl = c < 4;
      for (let i = 0; i < 4; i++) {
        let fx: number;
        let fy: number;
        if (swirl) {
          const a = t * 4 + i * 1.6;
          const r = 1 + (i % 2);
          fx = cx + Math.round(Math.cos(a) * r);
          fy = cy - 1 + Math.round(Math.sin(a) * r);
        } else {
          const k = Math.min(1, (c - 4) / (6 + i * 1.5));
          fx = cx - 2 + ((i * 3) % 5);
          fy = cy - 2 + Math.round(k * (3 - (i % 2)));
        }
        p.px(fx, fy, '#ffffff');
      }
      p.px(cx + 2, cy + 1, '#a9cfe2'); // glass shading
    },
  },
];

// ── desk fan (oscillates, blows at him) ──
const FAN = { x: 125, y: 71 };
const deskFan: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { lift }) {
      const t = s.time;
      const x = FAN.x;
      const y = FAN.y - lift;
      const base = DESK.top - lift;
      const body = '#7fc9b5';
      const shade = '#5fa89a';
      // base + neck
      p.rect(x - 4, base - 2, 9, 2, shade);
      p.rect(x - 4, base - 2, 9, 1, body);
      p.rect(x, y + 5, 2, base - 2 - (y + 5), shade);
      p.px(x, y + 5, body);
      // head turns between facing us (k=0) and facing him (k=1)
      const k = (Math.sin(t * 0.6) + 1) / 2;
      const rx = Math.max(2, Math.round(5 - 3 * k));
      if (k > 0.35) p.rect(x - rx - 2, y - 1, 3, 3, shade); // motor housing behind
      for (let dy = -5; dy <= 5; dy++) {
        const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / 5.4) ** 2)));
        p.rect(x - w, y + dy, w * 2 + 1, 1, '#dcefeb');
      }
      // spinning blades
      for (let b = 0; b < 3; b++) {
        const a = t * 22 + b * 2.094;
        for (let r = 1; r <= 4; r++) p.px(x + Math.round(Math.cos(a) * r * (rx / 5)), y + Math.round(Math.sin(a) * r), r < 4 ? '#5fa89a' : '#9fd6c8');
      }
      // grille rim + hub
      for (let a = 0; a < Math.PI * 2; a += 0.15) p.px(x + Math.round(Math.cos(a) * rx), y + Math.round(Math.sin(a) * 5), '#6f8a90');
      p.px(x, y, '#f3ead8');
      p.px(x - rx + 1, y - 3, '#ffffff');
    },
  },
  {
    layer: 'top',
    draw(p, s, { lift }) {
      const t = s.time;
      const k = (Math.sin(t * 0.6) + 1) / 2;
      if (k < 0.4) return;
      // breeze streaks drifting toward him
      for (let i = 0; i < 3; i++) {
        const q = (t * 0.9 + i / 3) % 1;
        const x = FAN.x + 5 + Math.round(q * 14);
        const y = FAN.y - lift - 4 + i * 3 + Math.round(Math.sin(q * 6 + i) * 1);
        p.rect(x, y, 3, 1, `rgba(255,255,255,${((0.5 * Math.sin(q * Math.PI) * (k - 0.4)) / 0.6).toFixed(2)})`);
      }
    },
  },
];

// ── desk globe (right of the mug) ──
const GLOBE = { x: 189, y: 73 };
const GLOBE_MAP = [
  '........................',
  '..##.......###....#.....',
  '.####.....#####..###....',
  '..###......###....##..#.',
  '...##.......##.......##.',
  '....#.......#.#......#..',
  '.....#.......#..........',
  '....##.................#',
  '........................',
];
const studyGlobe: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { lift, mode }) {
      const { x } = GLOBE;
      const y = GLOBE.y - lift;
      const gold = '#c98f1f';
      // stand
      p.rect(x - 4, DESK.top - lift - 2, 9, 2, '#7a4e2c');
      p.rect(x - 4, DESK.top - lift - 2, 9, 1, '#9a6a40');
      p.rect(x, y + 5, 1, DESK.top - lift - 2 - (y + 5), gold);
      // spinning globe: scroll a little world map across a squashed sphere
      const spin = s.time * (mode === 'studying' ? 1.6 : 0.7);
      for (let dy = -4; dy <= 4; dy++) {
        const hw = Math.floor(Math.sqrt(16.5 - dy * dy));
        for (let dx = -hw; dx <= hw; dx++) {
          const u = Math.floor(Math.asin(dx / (hw + 0.5)) * 3.8 + spin) % 24;
          const land = GLOBE_MAP[dy + 4][(u + 24) % 24] === '#';
          const edge = dx === hw || (dx === hw - 1 && Math.abs(dy) < 3);
          let c = land ? (edge ? '#3f8a48' : '#5fbf77') : edge ? '#2e6aa0' : '#3f86c7';
          if (Math.abs(dy) === 4) c = '#e9f3f6';
          p.px(x + dx, y + dy, c);
        }
      }
      p.px(x - 2, y - 2, '#8fd3ff');
      // meridian ring
      for (let a = -2.3; a <= 0.8; a += 0.18) p.px(x + Math.round(Math.cos(a) * 5.5), y + Math.round(Math.sin(a) * 5.5), gold);
      p.px(x, y - 6, gold);
    },
  },
];

// ── jack-o'-lantern (floor, between the terrarium and the cabinet) ──
const PUMPKIN = { x: 194, y: 117 };
const PUMPKIN_FACE: [number, number][] = [
  [-3, -1], [-4, 0], [-3, 0], [-2, 0],
  [2, -1], [1, 0], [2, 0], [3, 0],
  [0, 1],
  [-3, 2], [-2, 2], [0, 2], [2, 2], [3, 2],
  [-2, 3], [-1, 3], [1, 3], [2, 3],
];
const pumpkinFlicker = (t: number) => 0.75 + 0.13 * Math.sin(t * 9) + 0.12 * Math.sin(t * 23 + 1);
const pumpkinLantern: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p) {
      const { x, y } = PUMPKIN;
      p.ellipse(x, y + 5, 7, 1, 'rgba(40,20,10,0.25)');
      p.ellipse(x, y, 6, 5, '#e07b39');
      p.rect(x - 6, y - 1, 12, 3, '#e07b39');
      for (const rx of [-4, 0, 3]) p.line(x + rx, y - 3, x + rx + (rx < 0 ? -1 : rx > 0 ? 1 : 0), y + 3, '#c9652a');
      p.rect(x - 5, y - 3, 2, 2, '#f2a65a');
      p.rect(x - 1, y - 7, 2, 3, '#5a7a2a');
      p.px(x + 1, y - 7, '#6a8a3a');
      for (const [dx, dy] of PUMPKIN_FACE) p.px(x + dx, y + dy, '#4a2510');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night }) {
      if (night < 0.15) return;
      const f = pumpkinFlicker(s.time);
      const { x, y } = PUMPKIN;
      const a = Math.min(1, night * 1.4) * f;
      for (const [dx, dy] of PUMPKIN_FACE) p.px(x + dx, y + dy, `rgba(255,${190 + Math.round(40 * f)},70,${a.toFixed(2)})`);
      additive(p, () => glowSprite(p, x, y, 18, [255, 150, 50], 0.36 * night * f));
    },
  },
];

// ── festive tree (right corner, in front of the bookshelf) ──
const TREE = { x: 231, top: 88, base: 114 };
const TREE_TIERS = [
  [88, 96, 1, 5],
  [94, 105, 2, 7],
  [103, 114, 3, 8],
];
const treeHalf = (y: number) => {
  let w = -1;
  for (const [ya, yb, wa, wb] of TREE_TIERS) if (y >= ya && y <= yb) w = Math.max(w, Math.round(lerp(wa, wb, (y - ya) / (yb - ya))));
  return w;
};
const TREE_LIGHTS = (() => {
  const out: { x: number; y: number; c: number }[] = [];
  let k = 0;
  for (let y = TREE.top + 3; y < TREE.base - 1; y += 3) {
    const hw = treeHalf(y);
    for (let dx = -hw + 1 + (y % 2); dx < hw; dx += 4) out.push({ x: TREE.x + dx, y, c: k++ % 5 });
  }
  return out;
})();
const festiveTree: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p) {
      const { x, top, base } = TREE;
      // trunk + red bucket
      p.rect(x - 1, base, 3, 3, '#6a4226');
      p.rect(x - 4, base + 2, 9, 5, '#c0392b');
      p.rect(x - 4, base + 2, 9, 1, '#d9534f');
      p.rect(x - 4, base + 4, 9, 1, '#f2b134');
      for (let y = top; y <= base; y++) {
        const hw = treeHalf(y);
        if (hw < 0) continue;
        p.rect(x - hw, y, hw * 2 + 1, 1, '#2f7a3a');
        p.px(x - hw, y, '#3e9148');
        if (treeHalf(y + 1) < hw - 1 || y === base) p.rect(x - hw, y, hw * 2 + 1, 1, '#255f2e'); // tier hem
      }
      for (let y = top + 2; y < base; y += 2) p.px(x - Math.floor(treeHalf(y) / 2), y, '#4f9e48');
      // tinsel swags
      for (let i = 0; i < 3; i++) {
        const y0 = 93 + i * 8;
        for (let dx = -treeHalf(y0 + 2); dx <= treeHalf(y0 + 2); dx++) p.px(x + dx, y0 + Math.round(dx * 0.35) + 2, '#f2c95a');
      }
      // gifts
      p.rect(218, 115, 7, 7, '#d9534f');
      p.rect(221, 115, 1, 7, '#f2b134');
      p.rect(218, 118, 7, 1, '#f2b134');
      p.px(220, 114, '#f2b134');
      p.px(222, 114, '#f2b134');
      p.rect(234, 117, 6, 5, '#3f86c7');
      p.rect(236, 117, 1, 5, '#f3ead8');
      p.rect(234, 119, 6, 1, '#f3ead8');
    },
  },
  {
    layer: 'glow',
    draw(p, s, { night, act }) {
      const t = s.time;
      const onBean = act === 'lounge' && s.items.has('beanbag');
      const lights = TREE_LIGHTS.filter((L) => !(onBean && L.x < 228 && L.y >= 98));
      for (const [i, L] of lights.entries()) {
        const lvl = twinkle(t, i + 3);
        p.px(L.x, L.y, lvl < 0.25 && night > 0.3 ? '#3a3a50' : BULB_COLS[L.c]);
      }
      // star
      const { x, top } = TREE;
      p.rect(x - 1, top - 3, 3, 3, '#f7d46b');
      p.px(x, top - 4, '#f7d46b');
      p.px(x - 2, top - 2, '#f7d46b');
      p.px(x + 2, top - 2, '#f7d46b');
      p.px(x, top - 2, '#fff6cf');
      if (night < 0.05) return;
      additive(p, () => {
        glowSprite(p, x, top - 2, 9, [255, 220, 120], night * (0.35 + 0.15 * Math.sin(t * 2)));
        lights.forEach((L, i) => {
          if (i % 2 === 0) glowSprite(p, L.x, L.y, 5, BULB_RGB[L.c], night * 0.45 * twinkle(t, i + 3));
        });
      });
    },
  },
];

// ── friendly ghost: drifts around the room, sometimes peeks over the sofa ──
const GHOST_ROWS = ['..#####..', '.#######.', '#######s#', '##k##k#s#', '##k##k#s#', '#p#####p#', '#######s#', '#######s#', '#######s#'];
const GHOST_PAL = { '#': '#f4f4ff', s: '#d9dcf0', k: '#2d2d35', p: '#f7a6cf' };
const GHOST = new Sprite(GHOST_ROWS, GHOST_PAL);
const GHOST_LOOK_L = new Sprite(GHOST_ROWS.map((r) => (r.includes('k') ? '#k##k##s#' : r)), GHOST_PAL);
const GHOST_BOO = new Sprite(GHOST_ROWS.map((r, i) => (i === 6 ? '###kk##s#' : i === 7 ? '###kk##s#' : r)), GHOST_PAL);
const GHOST_HEM = [
  ['#.##.##.#', '.#..#..#.'],
  ['.##.##.##', '#..#..#..'],
];
const BOO_FONT: Record<string, string[]> = { b: ['#..', '#..', '###', '#.#', '###'], o: ['...', '...', '###', '#.#', '###'] };
const GHOST_T = 64;
const ghostPath = (t: number) => {
  const u = t * 0.16;
  return { x: 112 + 78 * Math.sin(u), y: 50 + 14 * Math.sin(2 * u + 0.6) };
};
/** Ghost position + whether it's hiding behind the sofa. */
function ghostState(s: RenderScene) {
  const t = s.time;
  const c = t % GHOST_T;
  const P = ghostPath(t);
  const free = { ...P, hide: false, look: Math.cos(t * 0.16) < 0, boo: false };
  if (!s.items.has('sofa') || c < 40) return free;
  const S = { x: SOFA.x + 14, y: SOFA.top + 13 };
  if (c < 43) {
    const k = ease((c - 40) / 3);
    const A = ghostPath(t - (c - 40));
    return { x: lerp(A.x, S.x, k), y: lerp(A.y, S.y, k), hide: k > 0.75, look: S.x < A.x, boo: false };
  }
  if (c < 52) {
    const k = c - 43; // rise, look around, boo, sink
    const up = k < 1.5 ? k / 1.5 : k < 7.5 ? 1 : Math.max(0, 1 - (k - 7.5) / 1.5);
    return { x: S.x, y: S.y - Math.round(up * 8), hide: true, look: k > 2.5 && k < 4.5, boo: k > 5 && k < 7 };
  }
  if (c < 56) return { x: S.x, y: S.y + 10, hide: true, look: false, boo: false }; // gone
  const k = ease((c - 56) / 8);
  return { x: lerp(S.x, P.x, k), y: lerp(S.y, P.y, k), hide: k < 0.15, look: P.x < S.x, boo: false };
}
function drawGhost(p: Painter, s: RenderScene, x: number, y: number, look: boolean, boo: boolean, alpha: number) {
  const t = s.time;
  x = Math.round(x);
  y = Math.round(y + Math.sin(t * 2.2) * 1.5);
  p.g.globalAlpha = alpha;
  drawSprite(p, boo ? GHOST_BOO : look ? GHOST_LOOK_L : GHOST, x - 4, y - 11);
  const hem = GHOST_HEM[Math.floor(t * 3) % 2];
  hem.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r[i] === '#') p.px(x - 4 + i, y - 2 + j, i === 7 ? GHOST_PAL.s : GHOST_PAL['#']);
  });
  p.g.globalAlpha = 1;
}
const ghostPlush: ItemArt[] = [
  {
    // peeking over the back of the sofa (the sofa, drawn later, hides its lower half)
    layer: 'behind-char',
    draw(p, s) {
      const g = ghostState(s);
      if (g.hide) drawGhost(p, s, g.x, g.y, g.look, g.boo, 0.85);
    },
  },
  {
    layer: 'top',
    draw(p, s, { night }) {
      const g = ghostState(s);
      if (!g.hide) {
        if (night > 0.05) additive(p, () => glowSprite(p, g.x, g.y - 5, 12, [190, 200, 255], 0.22 * night));
        drawGhost(p, s, g.x, g.y, g.look, false, 0.72);
      }
      if (g.boo) {
        // "boo" floating above
        const bx = Math.round(g.x) - 5;
        const by = Math.round(g.y) - 20;
        p.g.globalAlpha = 0.9;
        glyph(p, BOO_FONT.b, bx, by, '#c9b8ff');
        glyph(p, BOO_FONT.o, bx + 4, by, '#c9b8ff');
        glyph(p, BOO_FONT.o, bx + 8, by, '#c9b8ff');
        p.g.globalAlpha = 1;
      }
    },
  },
];

// ───────────────────────── more pets ─────────────────────────

// ── hamster in a cage at the right end of the desk ──
const CAGE = { x: 200, w: 20, h: 14 };
const HAM_PAL = { o: '#d08a3a', w: '#f6ecd9', k: '#1d1d24', p: '#f0a0a0' };
const HAM = [new Sprite(['.oop.', 'oookp', 'w.w.w'], HAM_PAL), new Sprite(['.oop.', 'oookp', '.w.w.'], HAM_PAL)];
const HAM_EAT = new Sprite(['.oop.', 'ooooo', 'wwokp'], HAM_PAL);
const HAM_T = 40;
const hamster: ItemArt[] = [
  {
    layer: 'behind-char',
    draw(p, s, { lift }) {
      const t = s.time;
      const { x, w, h } = CAGE;
      const y = DESK.top - lift - h;
      const c = t % HAM_T;
      // back panel + roof
      p.rect(x + 1, y + 1, w - 2, 9, '#e3edf0');
      p.rect(x + 2, y, w - 4, 1, '#9a97a6');
      // bedding pile, food bowl, water bottle
      p.rect(x + 2, y + 8, 7, 2, '#f3e2b0');
      p.rect(x + 3, y + 7, 5, 1, '#f3e2b0');
      for (let i = 0; i < 4; i++) p.px(x + 3 + i * 2, y + 8 + (i % 2), '#d9c38a');
      p.rect(x + 9, y + 9, 3, 1, '#3f86c7');
      p.px(x + 10, y + 8, '#8a5a35');
      p.rect(x + 2, y + 2, 2, 4, '#9fd3ef');
      p.px(x + 2, y + 2, '#e9f6fc');
      p.px(x + 3, y + 6, '#9a94a3');
      // wheel: spins while running, coasts otherwise
      const wx = x + 14;
      const wy = y + 5;
      const running = c < 12;
      const ang = running ? t * 9 : 12 * 9 + Math.min(c - 12, 2) * 2;
      p.line(wx, wy, wx - 2, y + 9, '#9a94a3');
      p.line(wx, wy, wx + 2, y + 9, '#9a94a3');
      for (let b = 0; b < 4; b++) {
        const a = ang + b * 1.571;
        p.line(wx, wy, wx + Math.round(Math.cos(a) * 3), wy + Math.round(Math.sin(a) * 3), '#f0b8b4');
      }
      for (let a = 0; a < Math.PI * 2; a += 0.25) p.px(wx + Math.round(Math.cos(a) * 3.6), wy + Math.round(Math.sin(a) * 3.6), '#d9534f');
      p.px(wx, wy, '#9a94a3');
      // hamster: wheel → bowl → bed → wheel
      const W = { x: wx - 2, y: wy + 1 };
      const B = { x: x + 9, y: y + 7 };
      const N = { x: x + 3, y: y + 6 };
      const walk = (a: Pt, b: Pt, k: number, left: boolean) => drawSprite(p, HAM[Math.floor(t * 10) % 2], Math.round(lerp(a.x, b.x, k)), Math.round(lerp(a.y, b.y, k)), left);
      if (running) drawSprite(p, HAM[Math.floor(t * 14) % 2], W.x, W.y);
      else if (c < 14) walk(W, B, (c - 12) / 2, true);
      else if (c < 20) {
        drawSprite(p, HAM_EAT, B.x, B.y, true);
        if (Math.floor(t * 6) % 2) p.px(B.x + 4, B.y + 1, HAM_PAL.o); // munching, cheek puffs
      } else if (c < 22) walk(B, N, (c - 20) / 2, true);
      else if (c < 36) {
        // curled up asleep in the bedding
        const br = Math.sin(t * 2) > 0 ? 1 : 0;
        p.rect(N.x, N.y + 1, 4, 2, HAM_PAL.o);
        p.rect(N.x + 1, N.y + 1 - br, 2, 1, HAM_PAL.o);
        p.px(N.x + 3, N.y + 1, HAM_PAL.p);
        p.px(N.x + 1, N.y + 2, HAM_PAL.w);
        if (Math.floor(t / 1.5) % 2 === 0) p.px(N.x + 5, N.y - 2 - (Math.floor(t * 2) % 2), '#8a8aa0');
      } else walk(N, W, (c - 36) / 4, false);
      // bars, blue tray underneath
      for (let bx = x + 5; bx < x + w - 2; bx += 4) p.rect(bx, y + 1, 1, 9, 'rgba(130,130,148,0.55)');
      p.rect(x + 1, y + 1, 1, 9, '#9a97a6');
      p.rect(x + w - 2, y + 1, 1, 9, '#9a97a6');
      p.rect(x, y + 10, w, 4, '#3f86c7');
      p.rect(x, y + 10, w, 1, '#5ea2de');
      p.rect(x, y + 13, w, 1, '#2f6aa0');
    },
  },
];

// ── parrot: see above (sill) ──

// ── robot vacuum: roams the rug, docks under the desk; the cat hitches rides ──
const VAC_DOCK = { x: 126, y: 107 };
const VAC_PARK = { x: 146, y: 140 };
type VacSeg = [number, number, Pt, Pt, boolean];
/** Timeline on the cat's clock (CAT_T): [from, to, a, b, bumpAtEnd]. */
const VAC_SEGS: VacSeg[] = (() => {
  const P = VAC_PARK;
  const D = VAC_DOCK;
  const A1 = { x: 178, y: 134 };
  const A2 = { x: 160, y: 128 };
  const A3 = { x: 120, y: 132 };
  const U = { x: 126, y: 124 };
  const R1 = { x: 104, y: 134 };
  const R2 = { x: 170, y: 128 };
  const R3 = { x: 134, y: 138 };
  const R4 = { x: 192, y: 137 };
  return [
    [1, 5, P, A1, false],
    [5, 8, A1, A2, false],
    [8, 12, A2, A3, false],
    [12, 15, A3, P, false],
    [16, 18.5, P, U, false],
    [18.5, 21, U, D, false],
    [40, 42.5, D, U, false],
    [42.5, 45.5, U, R1, true],
    [46, 50, R1, R2, true],
    [50.5, 53, R2, R3, false],
    [53, 56.5, R3, R4, true],
    [57, 61, R4, P, false],
  ];
})();
function vacState(c: number) {
  for (let i = 0; i < VAC_SEGS.length; i++) {
    const [t0, t1, a, b, bump] = VAC_SEGS[i];
    const dir = b.x >= a.x ? 1 : -1;
    if (c >= t0 && c < t1) {
      const k = (c - t0) / (t1 - t0);
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), dir, moving: true, bump: 0 };
    }
    const next = VAC_SEGS[i + 1];
    if (c >= t1 && (!next || c < next[0])) {
      // waiting at b (just bumped into something?)
      const since = c - t1;
      const bp = bump && since < 0.5 ? 1 - since / 0.5 : 0;
      return { x: b.x - dir * Math.round(bp * 2), y: b.y, dir: bp > 0 ? dir : next ? (next[3].x >= next[2].x ? 1 : -1) : dir, moving: false, bump: bp };
    }
  }
  // before the first segment of the cycle: parked
  return { x: VAC_PARK.x, y: VAC_PARK.y, dir: 1, moving: false, bump: 0 };
}
const vacDocked = (c: number) => c >= 21 && c < 40;
function drawVacuum(p: Painter, x: number, y: number, dir: number, t: number, moving: boolean, led: string) {
  x = Math.round(x);
  y = Math.round(y);
  p.rect(x - 5, y + 1, 11, 1, 'rgba(0,0,0,0.18)');
  p.ellipse(x, y - 1, 6, 2, '#26262c');
  p.ellipse(x, y - 3, 6, 2, '#44444f');
  p.rect(x - 3, y - 4, 6, 1, '#5a5a68');
  p.rect(dir > 0 ? x + 4 : x - 6, y - 2, 2, 2, '#1d1d24'); // bumper
  p.rect(x - 1, y - 4, 2, 1, '#2a2a33');
  p.px(x + dir * 2 - (dir > 0 ? 0 : 1), y - 3, led);
  if (moving) p.px(x + dir * 5 + (Math.floor(t * 12) % 2 ? 0 : dir), y, '#9a94a3'); // side brush
}
const robotVacuum: ItemArt[] = [
  {
    layer: 'floor',
    draw(p) {
      // charging dock against the skirting under the desk
      const { x } = VAC_DOCK;
      p.rect(x - 5, 98, 10, 7, '#2d2d35');
      p.rect(x - 5, 98, 10, 1, '#45454f');
      p.rect(x - 3, 104, 6, 1, '#1d1d24');
    },
  },
  {
    layer: 'screen',
    draw(p, s) {
      const c = s.time % CAT_T;
      p.px(VAC_DOCK.x, 100, vacDocked(c) ? (Math.floor(s.time * 1.5) % 2 ? '#5fbf77' : '#2f6f47') : '#4aa3ff');
    },
  },
  {
    layer: 'front',
    draw(p, s, ctx) {
      const t = s.time;
      const c = t % CAT_T;
      const v = vacState(c);
      const led = vacDocked(c) ? '#5fbf77' : v.moving ? '#5fd0ff' : '#9fc3d6';
      drawVacuum(p, v.x, v.y, v.dir, t, v.moving, led);
      if (v.bump > 0) {
        // little bonk lines
        const bx = Math.round(v.x) + v.dir * 8;
        const by = Math.round(v.y) - 5;
        p.px(bx, by, '#f2b134');
        p.px(bx + v.dir, by - 2, '#f2b134');
        p.px(bx + v.dir, by + 2, '#f2b134');
      }
      if (!s.items.has('cat')) return;
      // the cat hops on for a ride while it would otherwise be napping
      const S = catSpots(s, ctx.lift).S;
      if (c < 1) {
        const k = c;
        catWalk(p, 0, lerp(S.x, VAC_PARK.x, k), lerp(S.y, VAC_PARK.y - 4, k) - Math.sin(k * Math.PI) * 8, false);
      } else if (c < 15) catSit(p, t, v.x, v.y - 4, v.dir > 0, 'look');
      else if (c < 16) {
        const k = c - 15;
        catWalk(p, 0, lerp(VAC_PARK.x, S.x, k), lerp(VAC_PARK.y - 4, S.y, k) - Math.sin(k * Math.PI) * 8, true);
      }
    },
  },
];

// ───────────────────────── limited-time attire (drawn by character.ts) ─────────────────────────

/** Hat ids drawn by drawLimitedHat. */
export const LIMITED_HATS = ['witch-hat', 'santa-hat', 'bunny-ears'] as const;

/**
 * Seasonal hats, seen from behind, around head centre (hx, hy) — same frame as character.ts drawHat.
 * `t` (optional, s.time) makes the bunny ears twitch.
 */
export function drawLimitedHat(p: Painter, id: string, hx: number, hy: number, t = 0) {
  if (id === 'witch-hat') {
    const c = '#3a3245';
    const dk = '#2a2433';
    p.ellipse(hx, hy - 2, 13, 2, dk);
    p.rect(hx - 12, hy - 2, 25, 1, c);
    for (let i = 0; i < 15; i++) {
      const w = Math.max(1, Math.round(13 - i * 0.9));
      const bend = i > 9 ? -(i - 9) : 0; // crumpled tip flopping left
      p.rect(hx - Math.floor(w / 2) + bend, hy - 3 - i, w, 1, c);
      p.px(hx - Math.floor(w / 2) + bend, hy - 3 - i, dk);
    }
    p.px(hx - 7, hy - 17, c);
    p.rect(hx - 6, hy - 6, 13, 2, '#8e5ea2'); // purple band
    p.rect(hx - 6, hy - 6, 13, 1, '#b07cc6');
    // stitched patch
    p.rect(hx + 1, hy - 11, 3, 3, '#5a4a6a');
    p.px(hx + 1, hy - 11, '#a89ab8');
    p.px(hx + 3, hy - 9, '#a89ab8');
    return;
  }
  if (id === 'santa-hat') {
    const red = '#d23a2a';
    const sh = '#a82a22';
    p.disc(hx, hy - 4, 7, red);
    // floppy tip falling to his right
    const tip: [number, number, number][] = [
      [hx + 2, hy - 11, 4],
      [hx + 5, hy - 12, 3],
      [hx + 8, hy - 11, 3],
      [hx + 10, hy - 9, 2],
      [hx + 11, hy - 7, 2],
    ];
    for (const [x, y, w] of tip) p.rect(x, y, w, w, red);
    p.line(hx - 4, hy - 9, hx + 4, hy - 4, sh);
    p.px(hx + 9, hy - 9, sh);
    p.px(hx - 3, hy - 9, '#e85a44');
    // fluffy cuff
    p.rect(hx - 8, hy - 3, 17, 4, '#f3ead8');
    for (let x = hx - 8; x <= hx + 8; x += 2) p.px(x, hy - 4, '#f3ead8');
    for (let x = hx - 7; x <= hx + 7; x += 3) p.px(x, hy, '#d9cfc0');
    p.px(hx - 8, hy - 3, '#ffffff');
    // pompom
    p.disc(hx + 12, hy - 5, 2, '#ffffff');
    p.px(hx + 13, hy - 4, '#d9cfc0');
    return;
  }
  if (id === 'bunny-ears') {
    const fur = '#f6f2ea';
    const fsh = '#d9cfc0';
    // headband arcing over the hair
    for (let dx = -7; dx <= 7; dx++) p.px(hx + dx, Math.round(hy - 1 - 7 * Math.sqrt(Math.max(0, 1 - (dx / 7.6) ** 2))), '#f48fb1');
    // upright ear (twitches now and then)
    const tw = t % 4.3 < 0.18 ? 1 : 0;
    p.rect(hx - 5 - tw, hy - 18, 3, 10, fur);
    p.px(hx - 4 - tw, hy - 19, fur);
    p.rect(hx - 3 - tw, hy - 17, 1, 9, fsh);
    // floppy ear folding over to the right, showing its pink inside
    p.rect(hx + 2, hy - 15, 3, 7, fur);
    p.rect(hx + 3, hy - 17, 3, 2, fur);
    p.rect(hx + 5, hy - 16, 3, 2, fur);
    p.rect(hx + 7, hy - 14, 2, 3, fur);
    p.rect(hx + 6, hy - 15, 2, 1, '#f7b8cf');
    p.px(hx + 4, hy - 9, fsh);
    p.px(hx + 8, hy - 12, fsh);
  }
}

/** Seasonal face items seen from behind (sunglasses): thick temple arms + dark lens corners at the sides. */
export function drawLimitedFace(p: Painter, id: string, hx: number, hy: number) {
  if (id !== 'sunglasses') return;
  const c = '#1d1d24';
  p.rect(hx - 10, hy - 1, 4, 2, c);
  p.rect(hx + 7, hy - 1, 4, 2, c);
  p.px(hx - 6, hy + 1, c);
  p.px(hx + 6, hy + 1, c);
  p.rect(hx - 12, hy - 2, 2, 3, '#26262c');
  p.rect(hx + 11, hy - 2, 2, 3, '#26262c');
  p.px(hx - 12, hy - 2, '#ff9ecb');
  p.px(hx + 12, hy - 2, '#6ec3ff');
}

// ───────────────────────── registry ─────────────────────────

export const ITEM_ART: Record<string, ItemArt[]> = {
  // wall
  'fairy-lights': fairyLights,
  bookshelf,
  poster,
  'neon-sign': neonSign,
  'red-lanterns': redLanterns,
  'harvest-wreath': harvestWreath,
  'heart-lamp': heartLamp,
  guitar,
  // floor (back to front)
  rug,
  'floor-lamp': floorLamp,
  tv: tvArt,
  'fish-tank': fishTank,
  ps5,
  'pc-tower': pcTower,
  lizard,
  'big-plant': bigPlant,
  // desk top
  'dual-monitor': sideMonitorArt(RIGHT_MON, notesScreen),
  'triple-monitor': [...sideMonitorArt(RIGHT_MON, notesScreen), ...sideMonitorArt(LEFT_MON, lectureScreen)],
  'monitor-light': monitorLight,
  'rgb-keyboard': rgbKeyboard,
  'desk-lamp': deskLamp,
  'snow-globe': snowGlobe,
  'desk-fan': deskFan,
  'study-globe': studyGlobe,
  'coffee-machine': coffeeMachine,
  // on the window sill / over the view
  'bat-garland': batGarland,
  telescope,
  'flower-vase': flowerVase,
  // floor decor in front of the desk
  'record-player': recordPlayer,
  'pumpkin-lantern': pumpkinLantern,
  'festive-tree': festiveTree,
  // foreground furniture (in front of the character when he sits in it)
  sofa,
  beanbag,
  'ghost-plush': ghostPlush,
  // pets last so they walk in front of furniture
  hamster,
  parrot,
  'robot-vacuum': robotVacuum,
  dog: [dogBed, { layer: 'front', draw: drawDog }],
  cat: [{ layer: 'front', draw: drawCat }],
};

/** Registry in draw order. */
export const ITEM_LIST: [string, ItemArt[]][] = Object.entries(ITEM_ART);
