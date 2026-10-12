import type { Painter } from './pixel';
import type { RenderScene } from './scene';

export type Pose = 'typing' | 'resting' | 'sipping' | 'reading' | 'sleeping' | 'stretching' | 'window';

const SKIN = '#e8b48a';
const HAIR = '#3b2a20';
const HAIR_HI = '#4e392c';

const TOPS: Record<string, [string, string, string]> = {
  default: ['#4a7fc1', '#3d6aa3', '#5b90d2'],
  'hoodie-green': ['#4f9e60', '#3e7f4c', '#63b574'],
  'hoodie-black': ['#34343c', '#26262c', '#45454f'],
  sweater: ['#b5484a', '#963a3c', '#c75a5c'],
};

/** Which pose to show for the current mode; idle cycles through little activities. */
export function poseFor(s: RenderScene): Pose {
  if (s.mode === 'studying') return 'typing';
  if (s.mode === 'paused') return 'resting';
  if (s.mode === 'break') return Math.floor(s.time / 8) % 2 ? 'stretching' : 'sipping';
  // idle: cycle every ~12s; sleepy at night
  const cycle: Pose[] = s.sim.isNight ? ['reading', 'sleeping', 'sleeping', 'sipping', 'window'] : ['sipping', 'reading', 'window', 'resting', 'stretching'];
  return cycle[Math.floor(s.time / 12) % cycle.length];
}

/** Mug position on the desk (moves to his hand while sipping). */
export const MUG = { x: 214, y: 76 };

export function drawCharacter(p: Painter, s: RenderScene, pose: Pose) {
  const t = s.time;
  const top = TOPS[['hoodie-green', 'hoodie-black', 'sweater'].find((id) => s.items.has(id)) ?? 'default'];
  const [body, shade, hi] = top;
  const typing = pose === 'typing';
  let bob = typing ? Math.round(Math.sin(t * 9) * 0.5) : 0;
  let headX = 0;
  if (pose === 'sleeping') bob = 6;
  if (pose === 'reading') bob = 1;
  if (pose === 'resting') bob = Math.round(Math.sin(t * 1.2) * 0.5) - 1;
  if (pose === 'window') headX = -2;
  const leanBack = pose === 'resting' ? -1 : 0;

  // arms
  if (pose === 'stretching') {
    const up = Math.round((Math.sin(t * 1.5) + 1) * 2);
    p.rect(132, 66 - up, 5, 16 + up, shade);
    p.rect(163, 66 - up, 5, 16 + up, shade);
    p.rect(132, 63 - up, 5, 3, SKIN);
    p.rect(163, 63 - up, 5, 3, SKIN);
  } else if (pose === 'sleeping') {
    p.rect(132, 80, 36, 6, shade); // folded arms on desk
  } else {
    const armL = typing ? Math.round(Math.max(0, Math.sin(t * 14))) : 0;
    const armR = typing ? Math.round(Math.max(0, Math.sin(t * 14 + Math.PI))) : 0;
    p.rect(132, 80 + armL - leanBack, 6, 10, shade);
    p.rect(162, 80 + armR - leanBack, 6, 10, shade);
  }

  // torso
  const ty = 77 - leanBack + (pose === 'sleeping' ? 3 : 0);
  p.rect(136, ty, 28, 28, body);
  p.rect(135, ty + 2, 1, 24, body);
  p.rect(164, ty + 2, 1, 24, body);
  p.rect(136, ty, 28, 1, hi);
  if (s.items.has('sweater')) for (let y = ty + 4; y < ty + 26; y += 4) p.rect(137, y, 26, 1, shade);
  else {
    p.rect(142, ty - 2 + bob * 0.3, 16, 6, shade); // hood
    p.rect(144, ty + 3, 12, 3, shade);
    p.rect(149, ty + 6, 2, 14, shade);
  }

  // head
  const hx = 150 + headX;
  const hy = 66 + bob;
  p.rect(hx - 3, hy + 6, 6, 4, SKIN);
  p.disc(hx, hy, 7, HAIR);
  p.rect(hx - 8, hy + 1, 2, 3, SKIN);
  p.rect(hx + 7, hy + 1, 2, 3, SKIN);
  for (let i = 0; i < 4; i++) p.px(hx - 4 + i * 3, hy - 7, HAIR_HI);
  if (pose === 'window') p.rect(hx - 7, hy + 1, 2, 4, SKIN); // cheek peeking as he looks left

  // accessories (back view)
  if (s.items.has('glasses')) {
    p.rect(hx - 8, hy, 2, 1, '#2d2d35');
    p.rect(hx + 7, hy, 2, 1, '#2d2d35');
  }
  if (s.items.has('headphones')) {
    p.rect(hx - 1, hy - 8, 2, 2, '#2d2d35');
    p.line(hx - 7, hy - 3, hx - 1, hy - 8, '#2d2d35');
    p.line(hx + 7, hy - 3, hx + 1, hy - 8, '#2d2d35');
    p.rect(hx - 9, hy - 1, 3, 5, '#c0392b');
    p.rect(hx + 7, hy - 1, 3, 5, '#c0392b');
  }
  drawHat(p, s, hx, hy);

  // props
  if (pose === 'reading') {
    p.rect(156, 70, 10, 8, '#2e86ab');
    p.rect(157, 71, 8, 6, '#f3ead8');
    p.rect(161, 70, 1, 8, '#1f5f7a');
  }
  if (pose === 'sipping') {
    const lift = Math.round((Math.sin(t * 1.3) + 1) * 1.5);
    p.rect(163, 71 - lift, 6, 6, '#e9e4da');
    p.rect(164, 73 - lift, 4, 2, '#c0392b');
    p.rect(162, 77 - lift, 6, 4, SKIN);
  }
  if (pose === 'sleeping') {
    const k = (t * 0.5) % 1;
    const zs = [[0, 0], [3, -4], [7, -9]];
    zs.forEach(([dx, dy], i) => {
      const a = Math.max(0, Math.min(1, k * 3 - i));
      if (a > 0) drawZ(p, hx + 8 + dx, hy - 6 + dy, `rgba(240,240,255,${a * (1 - k)})`);
    });
  }
}

function drawZ(p: Painter, x: number, y: number, c: string) {
  p.rect(x, y, 3, 1, c);
  p.px(x + 1, y + 1, c);
  p.rect(x, y + 2, 3, 1, c);
}

function drawHat(p: Painter, s: RenderScene, hx: number, hy: number) {
  if (s.items.has('beanie')) {
    p.disc(hx, hy - 4, 7, '#c0392b');
    p.rect(hx - 8, hy - 3, 17, 3, '#a02f24');
    p.rect(hx - 7, hy, 15, 1, HAIR);
    p.disc(hx, hy - 12, 2, '#f3ead8');
  } else if (s.items.has('cap')) {
    p.disc(hx, hy - 3, 7, '#2e86ab');
    p.rect(hx - 7, hy - 1, 15, 2, '#1f5f7a');
    p.rect(hx - 3, hy + 1, 6, 2, '#2e86ab'); // backwards brim
    p.rect(hx - 1, hy - 1, 2, 1, '#f3ead8');
  } else if (s.items.has('wizard-hat')) {
    p.rect(hx - 9, hy - 3, 19, 2, '#4b3a8f');
    for (let i = 0; i < 12; i++) p.rect(hx - 6 + i / 2, hy - 4 - i, 12 - i, 1, '#5b48a8');
    p.px(hx - 2, hy - 8, '#f2b134');
    p.px(hx + 2, hy - 12, '#f2b134');
  } else if (s.items.has('crown')) {
    p.rect(hx - 6, hy - 8, 13, 4, '#f2b134');
    for (let i = 0; i < 4; i++) p.rect(hx - 6 + i * 4, hy - 11, 1, 3, '#f2b134');
    p.px(hx, hy - 6, '#d9534f');
    p.px(hx - 4, hy - 6, '#2e86ab');
    p.px(hx + 4, hy - 6, '#5fbf77');
  }
}
