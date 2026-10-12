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

// ───────────────────────── registry ─────────────────────────

export const ITEM_ART: Record<string, ItemArt[]> = {
  // wall
  'fairy-lights': fairyLights,
  bookshelf,
  poster,
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
  // foreground furniture (in front of the character when he sits in it)
  sofa,
  beanbag,
  // pets last so they walk in front of furniture
  dog: [dogBed, { layer: 'front', draw: drawDog }],
  cat: [{ layer: 'front', draw: drawCat }],
};

/** Registry in draw order. */
export const ITEM_LIST: [string, ItemArt[]][] = Object.entries(ITEM_ART);
