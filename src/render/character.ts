import type { Painter } from './pixel';
import type { RenderScene } from './scene';
import { SOFA, BEANBAG, TV, STAND_LIFT } from './scene';

export type Pose = 'typing' | 'resting' | 'sipping' | 'reading' | 'sleeping' | 'stretching' | 'window';

/**
 * Where he is: at the desk (sitting), standing at a raised standing desk, gaming in front of the TV,
 * or lounging (beanbag / sofa). Only breaks take him away from the chair.
 */
export type Activity = 'desk' | 'stand' | 'game' | 'lounge';

const SKIN = '#e8b48a';
const SKIN_SH = '#d39a70';
const HAIR = '#3b2a20';
const HAIR_HI = '#4e392c';
const PANTS = '#3a4766';
const PANTS_SH = '#2e3953';
const SHOES = '#2d2d35';

const TOPS: Record<string, [string, string, string]> = {
  default: ['#4a7fc1', '#3d6aa3', '#5b90d2'],
  'hoodie-green': ['#4f9e60', '#3e7f4c', '#63b574'],
  'hoodie-black': ['#34343c', '#26262c', '#45454f'],
  sweater: ['#b5484a', '#963a3c', '#c75a5c'],
};

/** Length of one break-activity slot (s): with several break toys he rotates between them. */
const BREAK_SLOT = 36;

/** What he's doing right now (only breaks move him away from the desk). */
export function activityFor(s: RenderScene): Activity {
  if (s.mode !== 'break') return 'desk';
  const it = s.items;
  const acts: Activity[] = [];
  if (it.has('ps5') && it.has('tv')) acts.push('game');
  if (it.has('standing-desk')) acts.push('stand');
  if (it.has('beanbag') || it.has('sofa')) acts.push('lounge');
  if (!acts.length) return 'desk';
  return acts[Math.floor(s.time / BREAK_SLOT) % acts.length];
}

/** Which pose to show for the current mode; idle cycles through little activities. */
export function poseFor(s: RenderScene): Pose {
  const act = activityFor(s);
  if (act === 'stand') return 'typing';
  if (act !== 'desk') return 'resting';
  if (s.mode === 'studying') return 'typing';
  if (s.mode === 'paused') return 'resting';
  if (s.mode === 'break') return Math.floor(s.time / 8) % 2 ? 'stretching' : 'sipping';
  // idle: cycle every ~12s; sleepy at night
  const cycle: Pose[] = s.sim.isNight ? ['reading', 'sleeping', 'sleeping', 'sipping', 'window'] : ['sipping', 'reading', 'window', 'resting', 'stretching'];
  return cycle[Math.floor(s.time / 12) % cycle.length];
}

/** Mug position on the desk (moves to his hand while sipping). */
export const MUG = { x: 214, y: 76 };

/** Head centre when sitting on the sofa / beanbag / floor. */
export const SOFA_HEAD = { x: SOFA.x + 31, y: 110 };
export const FLOOR_HEAD = { x: TV.x + 17, y: 108 };
export const BEAN_HEAD = { x: BEANBAG.cx + 1, y: 117 };

const topOf = (s: RenderScene) => TOPS[['hoodie-green', 'hoodie-black', 'sweater'].find((id) => s.items.has(id)) ?? 'default'];

export function drawCharacter(p: Painter, s: RenderScene, pose: Pose, act: Activity = 'desk') {
  const g = p.g;
  if (act === 'desk') return drawSitter(p, s, pose, 0, 0);
  if (act === 'stand') {
    drawLegs(p, 150, 77 + 28 - STAND_LIFT, 121);
    drawSitter(p, s, 'typing', 0, -STAND_LIFT, true);
    return;
  }
  const t = s.time;
  if (act === 'game') {
    const onSofa = s.items.has('sofa');
    const h = onSofa ? SOFA_HEAD : FLOOR_HEAD;
    // leans into the game now and then
    const lean = Math.round(Math.sin(t * 0.9) * 1.4 * (Math.sin(t * 0.37) > 0.3 ? 1 : 0));
    g.save();
    g.translate(h.x - 150, h.y - 66);
    if (!onSofa) {
      // floor cushion + crossed legs poking out at the sides
      p.rect(132, 101, 36, 4, '#d9534f');
      p.rect(131, 102, 38, 2, '#c0453f');
      p.rect(132, 96, 6, 5, PANTS);
      p.rect(162, 96, 6, 5, PANTS);
      p.rect(132, 100, 6, 1, PANTS_SH);
      p.rect(162, 100, 6, 1, PANTS_SH);
    }
    drawTorso(p, s, 77, 0, true);
    // elbows out holding the controller
    p.rect(133, 82, 4, 8, topOf(s)[1]);
    p.rect(163, 82, 4, 8, topOf(s)[1]);
    drawHead(p, s, 150 + lean, 66, 0);
    g.restore();
    return;
  }
  // lounge
  const bean = s.items.has('beanbag');
  const h = bean ? BEAN_HEAD : SOFA_HEAD;
  g.save();
  g.translate(h.x - 150, h.y - 66);
  drawTorso(p, s, 77, 0, true);
  const nod = Math.round(Math.sin(t * 0.8) * 0.5);
  drawHead(p, s, 150 - (bean ? 1 : 0), 66 + nod, 0);
  if (bean) {
    // reading a book held up on the right
    p.rect(158, 66, 11, 9, '#2e86ab');
    p.rect(159, 67, 9, 7, '#f3ead8');
    p.rect(163, 66, 1, 9, '#1f5f7a');
    p.rect(160, 75, 4, 3, SKIN);
  }
  g.restore();
}

function drawSitter(p: Painter, s: RenderScene, pose: Pose, dx: number, dy: number, standing = false) {
  const t = s.time;
  const g = p.g;
  g.save();
  g.translate(dx, dy);
  const [, shade] = topOf(s);
  const typing = pose === 'typing';
  let bob = typing ? Math.round(Math.sin(t * (standing ? 4 : 9)) * 0.5) : 0;
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
    const sp = standing ? 7 : 14;
    const armL = typing ? Math.round(Math.max(0, Math.sin(t * sp))) : 0;
    const armR = typing ? Math.round(Math.max(0, Math.sin(t * sp + Math.PI))) : 0;
    p.rect(132, 80 + armL - leanBack, 6, 10, shade);
    p.rect(162, 80 + armR - leanBack, 6, 10, shade);
  }

  const ty = 77 - leanBack + (pose === 'sleeping' ? 3 : 0);
  drawTorso(p, s, ty, bob, false);

  // head
  const hx = 150 + headX;
  const hy = 66 + bob;
  drawHead(p, s, hx, hy, pose === 'window' ? -1 : 0);

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
    zs.forEach(([zx, zy], i) => {
      const a = Math.max(0, Math.min(1, k * 3 - i));
      if (a > 0) drawZ(p, hx + 8 + zx, hy - 6 + zy, `rgba(240,240,255,${a * (1 - k)})`);
    });
  }
  g.restore();
}

/** Torso from behind (hoodie with hood, or knitted sweater). */
function drawTorso(p: Painter, s: RenderScene, ty: number, bob: number, short: boolean) {
  const [body, shade, hi] = topOf(s);
  const h = short ? 22 : 28;
  p.rect(136, ty, 28, h, body);
  p.rect(135, ty + 2, 1, h - 4, body);
  p.rect(164, ty + 2, 1, h - 4, body);
  p.rect(136, ty, 28, 1, hi);
  p.rect(134, ty + 1, 2, 3, body); // shoulders
  p.rect(164, ty + 1, 2, 3, body);
  if (s.items.has('sweater')) {
    // knit ribs + a cable down the middle + rolled collar
    for (let y = ty + 4; y < ty + h - 2; y += 3) {
      p.rect(137, y, 9, 1, shade);
      p.rect(154, y, 9, 1, shade);
    }
    for (let y = ty + 3; y < ty + h - 2; y++) {
      const o = (y >> 1) % 2;
      p.px(148 + o, y, shade);
      p.px(151 - o, y, shade);
    }
    p.rect(144, ty - 1, 12, 2, shade);
    p.rect(136, ty + h - 2, 28, 2, shade); // ribbed hem
    for (let x = 137; x < 164; x += 2) p.px(x, ty + h - 2, body);
  } else {
    p.rect(142, ty - 2 + Math.round(bob * 0.3), 16, 6, shade); // hood
    p.rect(143, ty - 2 + Math.round(bob * 0.3), 14, 1, hi);
    p.rect(144, ty + 3, 12, 3, shade);
    p.rect(146, ty + 6, 8, 1, shade);
    p.rect(149, ty + 7, 2, 12, shade);
    if (s.items.has('hoodie-black')) {
      // tiny </> back print
      const c = '#5fbf77';
      p.px(143, ty + 12, c);
      p.px(142, ty + 13, c);
      p.px(143, ty + 14, c);
      p.px(157, ty + 12, c);
      p.px(158, ty + 13, c);
      p.px(157, ty + 14, c);
    } else if (s.items.has('hoodie-green')) {
      // little leaf print
      p.rect(156, ty + 12, 3, 2, '#e9f2d8');
      p.px(155, ty + 14, '#e9f2d8');
    }
    if (!short) p.rect(136, ty + h - 2, 28, 2, shade); // waistband
  }
}

function drawLegs(p: Painter, cx: number, top: number, floor: number) {
  p.rect(cx - 11, top, 10, floor - top - 3, PANTS);
  p.rect(cx + 1, top, 10, floor - top - 3, PANTS);
  p.rect(cx - 2, top, 4, 6, PANTS);
  p.rect(cx - 2, top + 6, 1, floor - top - 9, PANTS_SH);
  p.rect(cx - 11, top + 14, 10, 1, PANTS_SH);
  p.rect(cx + 1, top + 14, 10, 1, PANTS_SH);
  p.rect(cx - 12, floor - 3, 11, 3, SHOES);
  p.rect(cx + 1, floor - 3, 11, 3, SHOES);
  p.rect(cx - 12, floor - 3, 11, 1, '#45454f');
  p.rect(cx + 1, floor - 3, 11, 1, '#45454f');
}

/**
 * Back of the head with hair, ears and every head accessory.
 * Order matters so hats and headphones combine: bands go over beanies/caps, under crowns/wizard hats.
 */
export function drawHead(p: Painter, s: RenderScene, hx: number, hy: number, look: number) {
  const it = s.items;
  p.rect(hx - 3, hy + 6, 6, 4, SKIN);
  p.rect(hx - 3, hy + 6, 6, 1, SKIN_SH);
  p.disc(hx, hy, 7, HAIR);
  p.rect(hx - 8, hy + 1, 2, 3, SKIN);
  p.rect(hx + 7, hy + 1, 2, 3, SKIN);
  p.px(hx - 8, hy + 3, SKIN_SH);
  p.px(hx + 8, hy + 3, SKIN_SH);
  for (let i = 0; i < 4; i++) p.px(hx - 4 + i * 3, hy - 7, HAIR_HI);
  p.px(hx - 5, hy - 4, HAIR_HI);
  p.px(hx + 4, hy - 5, HAIR_HI);
  p.rect(hx - 2, hy + 6, 4, 1, HAIR); // nape
  if (look < 0) p.rect(hx - 7, hy + 1, 2, 4, SKIN); // cheek peeking as he looks left

  const hat = ['beanie', 'cap', 'wizard-hat', 'crown'].find((h) => it.has(h));
  const phones = it.has('headphones');

  if (it.has('glasses')) {
    // temple arms running over the ears, a glint of lens at the sides
    const c = '#2d2d35';
    p.rect(hx - 9, hy, 3, 1, c);
    p.rect(hx + 7, hy, 3, 1, c);
    p.px(hx - 6, hy + 1, c);
    p.px(hx + 6, hy + 1, c);
    p.px(hx - 10, hy, '#9fc3d6');
    p.px(hx + 10, hy, '#9fc3d6');
  }
  if (phones && (hat === 'crown' || !hat)) drawBand(p, hx, hy, 0);
  if (hat) drawHat(p, hat, hx, hy);
  if (phones) {
    if (hat === 'beanie') drawBand(p, hx, hy, 4);
    if (hat === 'cap') drawBand(p, hx, hy, 2);
    // ear cups
    for (const sx of [-1, 1]) {
      const x = sx < 0 ? hx - 10 : hx + 8;
      p.rect(x, hy - 2, 3, 7, '#c0392b');
      p.rect(x + (sx < 0 ? 2 : 0), hy - 1, 1, 5, '#2d2d35');
      p.px(x + (sx < 0 ? 0 : 2), hy - 2, '#d9534f');
    }
  }
  if (hat === 'beanie') {
    // pompom stays on top of any headband
    p.disc(hx, hy - 12, 2, '#f3ead8');
    p.px(hx - 1, hy - 13, '#ffffff');
    p.px(hx + 1, hy - 11, '#d9cfc0');
  }
}

/** Headphone band arching over the head; `extra` lifts it over a hat. */
function drawBand(p: Painter, hx: number, hy: number, extra: number) {
  const R = 9;
  const top = 9 + extra;
  for (let dx = -R; dx <= R; dx++) {
    const y = Math.round(hy - 1 - top * Math.sqrt(1 - (dx / (R + 0.5)) ** 2));
    p.rect(hx + dx, y, 1, 2, '#3a3a46');
    p.px(hx + dx, y, '#6a6a7c');
  }
  p.rect(hx - 3, hy - 1 - top, 6, 1, '#c0392b'); // padded top
}

function drawHat(p: Painter, hat: string, hx: number, hy: number) {
  if (hat === 'beanie') {
    p.disc(hx, hy - 4, 7, '#c0392b');
    for (let i = -5; i <= 5; i += 2) p.line(hx + i, hy - 9 + Math.abs(i) / 3, hx + i, hy - 4, '#ad3226'); // knit
    p.rect(hx - 8, hy - 3, 17, 4, '#a02f24');
    for (let x = hx - 7; x <= hx + 7; x += 2) p.rect(x, hy - 3, 1, 4, '#8f281f'); // ribbed cuff
    p.rect(hx - 8, hy - 3, 17, 1, '#b83a2e');
    p.rect(hx - 7, hy + 1, 15, 1, HAIR);
  } else if (hat === 'cap') {
    p.disc(hx, hy - 3, 7, '#2e86ab');
    p.rect(hx - 7, hy - 3, 15, 4, '#2e86ab');
    p.line(hx, hy - 10, hx, hy, '#256f8f');
    p.line(hx - 4, hy - 9, hx - 6, hy - 1, '#256f8f');
    p.line(hx + 4, hy - 9, hx + 6, hy - 1, '#256f8f');
    p.rect(hx - 1, hy - 11, 2, 1, '#1f5f7a'); // button
    p.px(hx - 3, hy - 8, '#4fa3c7');
    p.rect(hx - 1, hy - 6, 3, 2, '#f3ead8'); // logo on the (backwards) front panel
    // brim pointing back at us
    p.rect(hx - 5, hy - 1, 11, 1, '#2a7899');
    p.rect(hx - 6, hy, 13, 2, '#1f5f7a');
    p.rect(hx - 5, hy + 2, 11, 1, '#174a60');
  } else if (hat === 'wizard-hat') {
    p.ellipse(hx, hy - 2, 12, 2, '#3e2f78');
    p.rect(hx - 11, hy - 2, 23, 1, '#4b3a8f');
    for (let i = 0; i < 13; i++) {
      const w = Math.round(14 - i * 1.05);
      const bend = i > 9 ? i - 9 : 0;
      p.rect(hx - w / 2 + bend, hy - 3 - i, w, 1, '#5b48a8');
      p.px(hx - w / 2 + bend, hy - 3 - i, '#4b3a8f');
    }
    p.px(hx + 5, hy - 16, '#5b48a8');
    p.px(hx + 6, hy - 17, '#5b48a8');
    p.rect(hx - 7, hy - 4, 14, 2, '#f2b134'); // band
    p.px(hx - 2, hy - 8, '#f2b134');
    p.px(hx + 2, hy - 11, '#f7d46b');
    p.px(hx - 1, hy - 13, '#f7d46b');
    p.px(hx + 3, hy - 7, '#f7d46b');
  } else if (hat === 'crown') {
    const gold = '#f2b134';
    const dark = '#c98f1f';
    p.rect(hx - 6, hy - 8, 13, 4, gold);
    p.rect(hx - 6, hy - 5, 13, 1, dark);
    for (let i = 0; i < 4; i++) {
      const x = hx - 6 + i * 4;
      p.rect(x, hy - 10, 1, 2, gold);
      p.px(x, hy - 11, '#f7d46b');
    }
    for (let i = 0; i < 3; i++) p.px(hx - 4 + i * 4, hy - 9, gold);
    p.px(hx, hy - 7, '#d9534f');
    p.px(hx - 4, hy - 7, '#2e86ab');
    p.px(hx + 4, hy - 7, '#5fbf77');
    p.px(hx - 5, hy - 8, '#fff1c4');
  }
}

function drawZ(p: Painter, x: number, y: number, c: string) {
  p.rect(x, y, 3, 1, c);
  p.px(x + 1, y + 1, c);
  p.rect(x, y + 2, 3, 1, c);
}
