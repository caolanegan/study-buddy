import { Painter, mixHex, hash01 } from './pixel';
import type { RenderScene } from './scene';
import { SOFA, BEANBAG, TV, STAND_LIFT } from './scene';
import { skinOf, hairColorOf, topColorOf, type HairStyle } from '../core/profile';
import { LIMITED_HATS, drawLimitedHat, drawLimitedFace } from './items';

export type Pose =
  | 'typing'
  | 'resting'
  | 'sipping'
  | 'reading'
  | 'sleeping'
  | 'stretching'
  | 'window'
  | 'doodling'
  | 'phone'
  | 'yawning'
  | 'rubbing';

/**
 * Where the buddy is: at the desk (sitting), standing at a raised standing desk, gaming in front of the TV,
 * or lounging (beanbag / sofa). Only breaks take them away from the chair.
 */
export type Activity = 'desk' | 'stand' | 'game' | 'lounge';

/** Tap reactions (see RoomRenderer.interact). */
export type ReactionKind = 'wave' | 'thumbs' | 'jump' | 'laugh' | 'sip' | 'look';
export const REACTION_LEN: Record<ReactionKind, number> = { wave: 2.4, thumbs: 2.1, jump: 1.4, laugh: 2.2, sip: 2.8, look: 3.6 };
/** The order repeated taps on the buddy cycle through. */
export const TAP_REACTIONS: ReactionKind[] = ['wave', 'thumbs', 'jump', 'laugh'];
/** A running reaction: which one and how far into it (s). */
export interface CharReact {
  kind: ReactionKind;
  k: number;
}

const PANTS = '#3a4766';
const PANTS_SH = '#2e3953';
const SHOES = '#2d2d35';

const SHOP_TOPS: Record<string, [string, string, string]> = {
  'hoodie-green': ['#4f9e60', '#3e7f4c', '#63b574'],
  'hoodie-black': ['#34343c', '#26262c', '#45454f'],
  sweater: ['#b5484a', '#963a3c', '#c75a5c'],
};
const SHOP_TOP_IDS = ['hoodie-green', 'hoodie-black', 'sweater'];

/** Length of one break-activity slot (s): with several break toys the buddy rotates between them. */
const BREAK_SLOT = 36;

/** What the buddy is doing right now (only breaks move them away from the desk). */
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

const IDLE_DAY: Pose[] = ['sipping', 'reading', 'window', 'doodling', 'stretching', 'phone', 'resting', 'window', 'reading', 'doodling'];
const IDLE_NIGHT: Pose[] = ['reading', 'yawning', 'phone', 'sipping', 'rubbing', 'window', 'reading', 'yawning'];
const IDLE_LATE: Pose[] = ['yawning', 'sleeping', 'sleeping', 'rubbing', 'sleeping', 'sleeping', 'reading', 'sleeping'];

/**
 * Which pose to show for the current mode; idle cycles through little activities.
 * `coffee` (0..1) is how full the mug is: they only sip while there's coffee left.
 */
export function poseFor(s: RenderScene, coffee = 1): Pose {
  const act = activityFor(s);
  if (act === 'stand') return 'typing';
  if (act !== 'desk') return 'resting';
  const t = s.time;
  const night = s.sim.isNight;
  if (s.mode === 'studying') {
    // a sip every ~50s while there's coffee; rubs their eyes / yawns now and then late at night
    if (coffee > 0 && t % 53 < 3) return 'sipping';
    if (night && t % 97 > 94) return s.sim.t > 0.8 ? 'yawning' : 'rubbing';
    return 'typing';
  }
  if (s.mode === 'paused') return t % 40 < 8 ? 'phone' : 'resting';
  if (s.mode === 'break') {
    const c: Pose[] = coffee > 0 ? ['stretching', 'sipping', 'phone', 'window'] : ['stretching', 'phone', 'window', 'yawning'];
    return c[Math.floor(t / 8) % c.length];
  }
  // idle: cycle every ~12s; sleepy at night, dozing off late at night
  const cycle = night ? (s.sim.t > 0.82 || s.sim.t < 0.02 ? IDLE_LATE : IDLE_NIGHT) : IDLE_DAY;
  const p = cycle[Math.floor(t / 12) % cycle.length];
  return p === 'sipping' && coffee <= 0 ? 'reading' : p;
}

/** The pose a running reaction forces (they wake up for any tap). */
export function reactPose(r: CharReact | null | undefined, base: Pose): Pose {
  if (!r) return base;
  if (r.kind === 'sip') return 'sipping';
  if (r.kind === 'look') return 'window';
  return 'resting';
}

/** Mug position on the desk (moves to their hand while sipping). */
export const MUG = { x: 171, y: 76 };

/** Head centre when sitting on the sofa / beanbag / floor. */
export const SOFA_HEAD = { x: SOFA.x + 31, y: 110 };
export const FLOOR_HEAD = { x: TV.x + 17, y: 108 };
export const BEAN_HEAD = { x: BEANBAG.cx + 1, y: 117 };

// ───────────────────────── palette ─────────────────────────

interface Pal {
  key: string;
  K: string;
  KS: string;
  KH: string;
  H: string;
  S: string;
  L: string;
  top: [string, string, string];
  /** hair tie / scrunchie */
  tie: string;
  tieHi: string;
  /** buzz-cut fuzz (hair over scalp) */
  fuzz: string;
  part: string;
  blush: string;
  mouth: string;
}

const palCache = new Map<string, Pal>();
function palOf(s: RenderScene): Pal {
  const look = s.look;
  const shop = SHOP_TOP_IDS.find((id) => s.items.has(id)) ?? '';
  const skin = look?.skin ?? 'peach';
  const hc = look?.hairColor ?? 'espresso';
  const top = look?.top ?? 'blue';
  const key = `${skin}|${hc}|${shop || top}`;
  let P = palCache.get(key);
  if (!P) {
    const [K, KS, KH] = skinOf(skin).colors;
    const [H, S, L] = hairColorOf(hc).colors;
    P = {
      key,
      K,
      KS,
      KH,
      H,
      S,
      L,
      top: shop ? SHOP_TOPS[shop] : topColorOf(top).colors,
      tie: ['pink', 'ginger', 'chestnut'].includes(hc) ? '#5b90d2' : '#d9534f',
      tieHi: ['pink', 'ginger', 'chestnut'].includes(hc) ? '#9dbbe4' : '#e89593',
      fuzz: mixHex(H, K, 0.42),
      part: mixHex(H, K, 0.55),
      blush: mixHex(K, '#ff5f7a', 0.45),
      mouth: mixHex(K, '#5a1f24', 0.6),
    };
    palCache.set(key, P);
  }
  return P;
}

// ───────────────────────── body ─────────────────────────

/** Where their head is drawn (canvas px) — shared by the drawing, hit tests and speech-bubble anchors. */
export function headAt(s: RenderScene, pose: Pose, act: Activity, react?: CharReact | null): { x: number; y: number } {
  const t = s.time;
  if (act === 'game') {
    const h = s.items.has('sofa') ? SOFA_HEAD : FLOOR_HEAD;
    return { x: h.x + gameLean(t), y: h.y + jumpDy(react) };
  }
  if (act === 'lounge') {
    const bean = s.items.has('beanbag');
    const h = bean ? BEAN_HEAD : SOFA_HEAD;
    return { x: h.x - (bean ? 1 : 0), y: h.y + Math.round(Math.sin(t * 0.8) * 0.5) + jumpDy(react) };
  }
  const st = sitterState(s, pose, act === 'stand', react);
  return { x: 150 + st.headX, y: 66 + st.bob + st.dy + (act === 'stand' ? -STAND_LIFT : 0) };
}

const gameLean = (t: number) => Math.round(Math.sin(t * 0.9) * 1.4 * (Math.sin(t * 0.37) > 0.3 ? 1 : 0));
const jumpDy = (r?: CharReact | null) => (r && r.kind === 'jump' ? -Math.round(Math.sin(Math.min(1, r.k / 0.7) * Math.PI) * 5) : 0);
/** Shoulders rise a pixel as they breathe in. */
const breathOf = (t: number, slow: boolean) => (Math.sin(t * (slow ? 0.9 : 1.35)) > 0.35 ? 1 : 0);

const sit = { bob: 0, headX: 0, dy: 0, tilt: 0 };
function sitterState(s: RenderScene, pose: Pose, standing: boolean, react?: CharReact | null) {
  const t = s.time;
  const typing = pose === 'typing';
  let bob = typing ? Math.round(Math.sin(t * (standing ? 4 : 9)) * 0.5) : 0;
  let headX = 0;
  let tilt = 0;
  if (pose === 'sleeping') bob = 6;
  else if (pose === 'reading') bob = 1;
  else if (pose === 'doodling' || pose === 'phone') bob = 2;
  else if (pose === 'rubbing') bob = 1;
  else if (pose === 'yawning') bob = -2;
  else if (pose === 'resting') bob = Math.round(Math.sin(t * 1.2) * 0.5) - 1;
  if (pose === 'window') headX = react?.kind === 'look' ? -3 : -2;
  // a thoughtful head tilt now and then while typing
  if (typing && !standing && t % 17 > 14.6) {
    tilt = 1;
    headX = 1;
  }
  if (react?.kind === 'laugh') headX += Math.round(Math.sin(react.k * 40)) * (react.k < REACTION_LEN.laugh - 0.3 ? 1 : 0);
  sit.bob = bob;
  sit.headX = headX;
  sit.dy = jumpDy(react);
  sit.tilt = tilt;
  return sit;
}

export function drawCharacter(p: Painter, s: RenderScene, pose: Pose, act: Activity = 'desk', react: CharReact | null = null) {
  const g = p.g;
  const P = palOf(s);
  if (act === 'stand') {
    drawLegs(p, 150, 77 + 28 - STAND_LIFT, 121);
    drawSitter(p, s, P, react ? reactPose(react, 'typing') : 'typing', 0, -STAND_LIFT, true, react);
    return;
  }
  if (act !== 'game' && act !== 'lounge') return drawSitter(p, s, P, pose, 0, 0, false, react);
  const t = s.time;
  const jump = jumpDy(react);
  const breath = breathOf(t, act === 'lounge');
  if (act === 'game') {
    const onSofa = s.items.has('sofa');
    const h = onSofa ? SOFA_HEAD : FLOOR_HEAD;
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
    g.translate(0, jump);
    drawTorso(p, s, P, 77, 0, true, breath);
    // elbows out holding the controller (one goes up to wave)
    p.rect(133, 82, 4, 8, P.top[1]);
    if (!gestureArm(react)) p.rect(163, 82, 4, 8, P.top[1]);
    drawHead(p, s, 150 + gameLean(t), 66, 0, 0, react, P);
    drawGesture(p, P, react, 150 + gameLean(t), 66);
    g.restore();
    return;
  }
  // lounge
  const bean = s.items.has('beanbag');
  const h = bean ? BEAN_HEAD : SOFA_HEAD;
  g.save();
  g.translate(h.x - 150, h.y - 66 + jump);
  drawTorso(p, s, P, 77, 0, true, breath);
  const nod = Math.round(Math.sin(t * 0.8) * 0.5);
  const hx = 150 - (bean ? 1 : 0);
  drawHead(p, s, hx, 66 + nod, 0, 0, react, P);
  if (bean && !react) {
    // reading a book held up on the right
    p.rect(158, 66, 11, 9, '#2e86ab');
    p.rect(159, 67, 9, 7, '#f3ead8');
    p.rect(163, 66, 1, 9, '#1f5f7a');
    p.rect(160, 75, 4, 3, P.K);
  }
  drawGesture(p, P, react, hx, 66 + nod);
  g.restore();
}

const gestureArm = (r: CharReact | null) => !!r && (r.kind === 'wave' || r.kind === 'thumbs');

function drawSitter(p: Painter, s: RenderScene, P: Pal, pose: Pose, dx: number, dy: number, standing: boolean, react: CharReact | null) {
  const t = s.time;
  const g = p.g;
  const st = sitterState(s, pose, standing, react);
  const { bob, headX, tilt } = st;
  g.save();
  g.translate(dx, dy + st.dy);
  const shade = P.top[1];
  const typing = pose === 'typing';
  const leanBack = pose === 'resting' ? -1 : 0;
  const breath = typing ? 0 : breathOf(t, pose === 'sleeping');
  const raised = gestureArm(react);
  const hx = 150 + headX;
  const hy = 66 + bob;

  // notebook for doodling (on the desk left of the keyboard)
  if (pose === 'doodling') {
    p.rect(117, 82, 13, 3, '#f3ead8');
    p.rect(117, 84, 13, 1, '#d8ccb6');
    for (let i = 0; i < 4; i++) p.px(119 + i * 3, 83 - ((i + Math.floor(t * 2)) % 2), '#5b6fa8');
  }

  // arms
  if (pose === 'stretching' || react?.kind === 'jump') {
    const up = react?.kind === 'jump' ? 5 : Math.round((Math.sin(t * 1.5) + 1) * 2);
    p.rect(132, 66 - up, 5, 16 + up, shade);
    p.rect(163, 66 - up, 5, 16 + up, shade);
    p.rect(132, 63 - up, 5, 3, P.K);
    p.rect(163, 63 - up, 5, 3, P.K);
  } else if (pose === 'yawning') {
    // arms up and out in a big V-shaped yawn-stretch
    const k = Math.round((Math.sin(t * 0.9) + 1) * 1.5);
    for (const d of [-1, 1]) {
      const x0 = 150 + d * 15;
      const x1 = 150 + d * (23 + k);
      const y1 = 64 - k;
      for (let i = 0; i <= 8; i++) p.rect(Math.round(x0 + ((x1 - x0) * i) / 8) - 2, Math.round(80 + ((y1 - 80) * i) / 8) - 2, 5, 4, shade);
      p.rect(x1 - 2, y1 - 4, 4, 3, P.K);
    }
  } else if (pose === 'sleeping') {
    p.rect(132, 80, 36, 6, shade); // folded arms on desk
  } else if (pose === 'rubbing') {
    // elbows out, fists up at their eyes
    p.rect(131, 72, 5, 12, shade);
    p.rect(164, 72, 5, 12, shade);
  } else {
    const sp = standing ? 7 : 14;
    const armL = typing ? Math.round(Math.max(0, Math.sin(t * sp))) : 0;
    const armR = typing ? Math.round(Math.max(0, Math.sin(t * sp + Math.PI))) : 0;
    if (pose === 'doodling') {
      // left hand scribbling in the notebook
      const w = Math.round(Math.sin(t * 9));
      p.rect(128, 80, 8, 5, shade);
      p.rect(126 + w, 81, 3, 3, P.K);
      p.px(125 + w, 81, '#f2b134');
    } else p.rect(132, 80 + armL - leanBack, 6, 10, shade);
    if (pose === 'phone') {
      p.rect(162, 73, 5, 10, shade);
      p.rect(162, 71, 4, 3, P.K);
      p.rect(161, 65, 5, 7, '#26262c');
      p.px(162, 66, '#55556a');
    } else if (!raised) p.rect(162, 80 + armR - leanBack, 6, 10, shade);
  }

  const ty = 77 - leanBack + (pose === 'sleeping' ? 3 : 0);
  drawTorso(p, s, P, ty, bob, false, breath);

  drawHead(p, s, hx, hy, pose === 'window' && !react ? -1 : 0, tilt, react, P);

  if (pose === 'rubbing') {
    const r = Math.floor(t * 6) % 2;
    p.rect(hx - 9, hy + 2 + r, 3, 3, P.K);
    p.rect(hx + 7, hy + 3 - r, 3, 3, P.K);
  }

  // props
  if (pose === 'reading') {
    p.rect(156, 70, 10, 8, '#2e86ab');
    p.rect(157, 71, 8, 6, '#f3ead8');
    p.rect(161, 70, 1, 8, '#1f5f7a');
  }
  if (pose === 'sipping') {
    const lift = react?.kind === 'sip' ? Math.round(Math.sin(Math.min(1, react.k / REACTION_LEN.sip) * Math.PI) * 4) : Math.round((Math.sin(t * 1.3) + 1) * 1.5);
    p.rect(163, 71 - lift, 6, 6, '#e9e4da');
    p.rect(164, 73 - lift, 4, 2, '#c0392b');
    p.rect(162, 77 - lift, 6, 4, P.K);
  }
  if (pose === 'sleeping') {
    const k = (t * 0.5) % 1;
    const zs = [
      [0, 0],
      [3, -4],
      [7, -9],
    ];
    zs.forEach(([zx, zy], i) => {
      const a = Math.max(0, Math.min(1, k * 3 - i));
      if (a > 0) drawZ(p, hx + 8 + zx, hy - 6 + zy, `rgba(240,240,255,${(a * (1 - k)).toFixed(2)})`);
    });
  }
  drawGesture(p, P, react, hx, hy);
  g.restore();
}

/** Raised-hand gestures + little marks for tap reactions (body-local coords, head at hx,hy). */
function drawGesture(p: Painter, P: Pal, r: CharReact | null, hx: number, hy: number) {
  if (!r) return;
  const sleeve = P.top[1];
  if (r.kind === 'wave') {
    const w = Math.round(Math.sin(r.k * 14));
    p.rect(165, 68, 4, 12, sleeve);
    p.rect(165, 67, 4, 1, P.top[2]);
    // open hand with fingers, wagging side to side
    p.rect(165 + w, 62, 4, 5, P.K);
    p.px(165 + w, 61, P.K);
    p.px(167 + w, 61, P.K);
    p.px(168 + w + (w > 0 ? 1 : 0), 64, P.K); // thumb
    p.rect(165 + w, 66, 4, 1, P.KS);
    if (w !== 0) p.px(171 + w, 60, '#ffffff');
  } else if (r.kind === 'thumbs') {
    p.rect(165, 72, 4, 8, sleeve);
    p.rect(165, 71, 4, 1, P.top[2]);
    p.rect(165, 67, 4, 4, P.K);
    p.rect(166, 64, 2, 3, P.K); // thumb up
    p.px(165, 70, P.KS);
    if (r.k > 0.3 && Math.floor(r.k * 6) % 2) {
      // sparkle
      p.px(171, 62, '#fff6c8');
      p.px(170, 63, '#f2b134');
      p.px(172, 63, '#f2b134');
      p.px(171, 64, '#f2b134');
      p.px(171, 63, '#ffffff');
    }
  } else if (r.kind === 'jump') {
    // a little "!" pops above their head
    const y = hy - 17;
    p.rect(hx + 9, y, 2, 4, '#f2b134');
    p.rect(hx + 9, y + 5, 2, 1, '#f2b134');
  } else if (r.kind === 'laugh') {
    // shaking-with-laughter marks
    if (Math.floor(r.k * 8) % 2) {
      p.px(hx - 10, hy - 6, '#fff6c8');
      p.px(hx - 11, hy - 7, '#fff6c8');
      p.px(hx + 11, hy - 6, '#fff6c8');
      p.px(hx + 12, hy - 7, '#fff6c8');
      p.px(hx - 11, hy - 3, '#fff6c8');
      p.px(hx + 12, hy - 3, '#fff6c8');
    }
  }
}

/** Torso from behind (hoodie with hood, or knitted sweater). `rise` lifts the shoulders (breathing). */
function drawTorso(p: Painter, s: RenderScene, P: Pal, ty0: number, bob: number, short: boolean, rise = 0) {
  const [body, shade, hi] = P.top;
  const ty = ty0 - rise;
  const h = (short ? 22 : 28) + rise;
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

// ───────────────────────── head + hair ─────────────────────────

/** How each hairstyle sits under hats: crown/wizard-hat lift, headphone band lift and extra width. */
const FIT: Record<HairStyle, { crown: number; band: number; wide: number; earsHidden: boolean }> = {
  short: { crown: 0, band: 0, wide: 0, earsHidden: false },
  buzz: { crown: -1, band: -1, wide: 0, earsHidden: false },
  curly: { crown: 1, band: 1, wide: 1, earsHidden: false },
  long: { crown: 0, band: 0, wide: 0, earsHidden: true },
  bob: { crown: 0, band: 0, wide: 1, earsHidden: true },
  bun: { crown: 0, band: 2, wide: 0, earsHidden: false },
  ponytail: { crown: 0, band: 0, wide: 0, earsHidden: false },
  braids: { crown: 0, band: 0, wide: 0, earsHidden: false },
  afro: { crown: 4, band: 4, wide: 3, earsHidden: true },
  spiky: { crown: 2, band: 3, wide: 1, earsHidden: false },
};
const HAIR_STYLE_IDS = Object.keys(FIT) as HairStyle[];

/** How far above the head centre the top of their hair / hat reaches (px), for speech-bubble anchors. */
export function headTop(s: RenderScene): number {
  const style: HairStyle = HAIR_STYLE_IDS.includes(s.look?.hair as HairStyle) ? (s.look.hair as HairStyle) : 'short';
  const hairTop = { afro: 15, spiky: 13, bun: 12, curly: 10, buzz: 6 }[style as string] ?? 8;
  const it = s.items;
  const lift = FIT[style].crown;
  let hatTop = 0;
  if (it.has('wizard-hat') || it.has('witch-hat')) hatTop = 18 + (style === 'afro' ? lift : 0);
  else if (it.has('bunny-ears')) hatTop = 19 + lift;
  else if (it.has('beanie') || it.has('santa-hat')) hatTop = 14;
  else if (it.has('crown')) hatTop = 11 + lift;
  else if (it.has('cap')) hatTop = 11;
  const pressed = it.has('beanie') || it.has('cap') || it.has('santa-hat') || ((it.has('wizard-hat') || it.has('witch-hat')) && style !== 'afro');
  if (it.has('headphones')) hatTop = Math.max(hatTop, 11 + (it.has('beanie') || it.has('santa-hat') ? 4 : FIT[style].band));
  return Math.max(hatTop, pressed ? 0 : hairTop);
}

/** 'hat' = beanie/cap/wizard hat pressing the hair down; 'crown' = something sitting on top of the hair. */
type Cover = 'none' | 'hat' | 'crown';

const HC = { w: 32, h: 44, ox: 16, oy: 17 };
const hairCache = new Map<string, HTMLCanvasElement>();
function hairSprite(style: HairStyle, P: Pal, cover: Cover): HTMLCanvasElement {
  const key = `${style}|${cover}|${P.key}`;
  let c = hairCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = HC.w;
    c.height = HC.h;
    paintHair(new Painter(c.getContext('2d')!), style, P, cover, HC.ox, HC.oy);
    hairCache.set(key, c);
  }
  return c;
}

/** Tapered spike from base (bx,by) to tip (tx,ty). */
function spike(p: Painter, bx: number, by: number, tx: number, ty: number, c: string, hi: string) {
  const n = Math.max(Math.abs(tx - bx), Math.abs(ty - by)) * 2;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = Math.round(bx + (tx - bx) * k);
    const y = Math.round(by + (ty - by) * k);
    const r = k < 0.35 ? 1 : 0;
    p.rect(x - r, y - r, r * 2 + 1, r * 2 + 1, c);
  }
  p.line(bx, by, Math.round(bx + (tx - bx) * 0.6), Math.round(by + (ty - by) * 0.6), hi);
}

/** Paints neck, ears and a hairstyle (static parts) with the head centre at (x, y). */
function paintHair(p: Painter, st: HairStyle, P: Pal, cover: Cover, x: number, y: number) {
  const { H, S, L, K, KS } = P;
  const hat = cover === 'hat';
  // neck
  p.rect(x - 3, y + 6, 6, 4, K);
  p.rect(x - 3, y + 6, 6, 1, KS);
  const ears = () => {
    p.rect(x - 8, y + 1, 2, 3, K);
    p.rect(x + 7, y + 1, 2, 3, K);
    p.px(x - 8, y + 3, KS);
    p.px(x + 8, y + 3, KS);
    p.px(x - 7, y + 2, KS);
    p.px(x + 7, y + 2, KS);
  };
  switch (st) {
    case 'buzz': {
      p.disc(x, y, 6, P.fuzz);
      for (let dy = -6; dy <= 3; dy++) {
        const w = Math.floor(Math.sqrt(36 - dy * dy) + 0.5);
        for (let dx = -w; dx <= w; dx++) {
          const v = hash01(dx + 9, dy + 9, 7);
          if (v < 0.45) p.px(x + dx, y + dy, H);
          else if (v > 0.9 && dy < 0) p.px(x + dx, y + dy, L);
        }
      }
      p.rect(x - 2, y - 6, 4, 1, L);
      p.rect(x - 3, y + 5, 7, 2, K); // clean skin nape
      p.rect(x - 4, y + 4, 9, 1, P.fuzz);
      p.px(x - 4, y + 5, P.fuzz);
      p.px(x + 4, y + 5, P.fuzz);
      ears();
      break;
    }
    case 'curly': {
      p.disc(x, y, 7, H);
      for (const [bx, by] of [[-7, -3], [-6, -6], [-3, -8], [1, -8], [4, -7], [6, -5], [7, -2], [-8, 0], [8, 0], [-5, 5], [5, 5], [0, 6]]) p.disc(x + bx, y + by, 2, H);
      for (const [bx, by] of [[-5, -5], [-1, -6], [3, -5], [5, -2], [-6, -1], [-3, -2], [1, -2], [-2, 2], [3, 2], [-5, 3], [6, 3], [0, 5]]) {
        p.px(x + bx, y + by, L);
        p.px(x + bx + 1, y + by, L);
        p.px(x + bx + 1, y + by + 1, S);
        p.px(x + bx, y + by + 1, S);
      }
      if (hat) for (const bx of [-9, 9]) p.disc(x + bx, y + 2, 1, H);
      ears();
      break;
    }
    case 'long': {
      p.rect(x - 8, y - 2, 17, 18, H);
      const ends = [1, 2, 1, 0, 2, 1, 3, 1, 2, 1, 3, 1, 2, 0, 1, 2, 1];
      for (let dx = -8; dx <= 8; dx++) p.rect(x + dx, y + 16, 1, ends[dx + 8], dx % 3 === 0 ? S : H);
      p.disc(x, y, 7, H);
      p.rect(x - 8, y + 1, 1, 15, S);
      p.rect(x + 8, y + 1, 1, 15, S);
      for (const [sx, a, b] of [[-5, 3, 15], [-2, 5, 17], [2, 2, 14], [5, 4, 16]]) p.rect(x + sx, y + a, 1, b - a, S);
      for (const [sx, a, b] of [[-3, -5, 6], [3, -6, 3]]) p.rect(x + sx, y + a, 1, b - a, L);
      p.px(x - 1, y - 7, L);
      p.px(x + 1, y - 7, L);
      break;
    }
    case 'bob': {
      p.disc(x, y, 7, H);
      p.disc(x, y + 1, 8, H);
      p.rect(x - 9, y + 2, 19, 4, H);
      p.rect(x - 9, y + 6, 19, 1, S); // blunt cut, curling under
      p.px(x - 9, y + 6, H);
      p.px(x + 9, y + 6, H);
      p.rect(x - 9, y + 2, 1, 4, S);
      p.rect(x + 9, y + 2, 1, 4, S);
      // soft parting of the strands at the back
      p.line(x - 1, y - 4, x - 3, y + 5, S);
      p.line(x + 2, y - 3, x + 4, y + 5, S);
      // glossy sheen arc
      p.rect(x - 4, y - 5, 3, 1, L);
      p.rect(x - 6, y - 4, 2, 1, L);
      p.px(x - 7, y - 2, L);
      p.rect(x + 1, y - 6, 3, 1, L);
      break;
    }
    case 'bun': {
      p.disc(x, y, 7, H);
      ears();
      // strands swept up to the crown
      p.line(x - 5, y + 3, x - 2, y - 4, S);
      p.line(x + 5, y + 3, x + 2, y - 4, S);
      p.line(x, y + 4, x, y - 2, S);
      p.px(x - 3, y - 5, L);
      p.px(x + 3, y - 4, L);
      p.rect(x - 2, y + 6, 5, 1, K); // nape skin (hair pulled up)
      p.px(x, y + 7, K);
      if (!hat) {
        p.disc(x, y - 9, 3, H);
        p.px(x - 1, y - 11, L);
        p.px(x - 2, y - 10, L);
        p.px(x + 2, y - 8, S);
        p.px(x + 1, y - 7, S);
        p.rect(x - 2, y - 6, 5, 1, P.tie);
      } else {
        // low bun peeking out under the hat
        p.disc(x, y + 5, 3, H);
        p.px(x - 1, y + 4, L);
        p.px(x + 2, y + 6, S);
        p.rect(x - 2, y + 2, 5, 1, P.tie);
      }
      break;
    }
    case 'ponytail': {
      p.disc(x, y, 7, H);
      ears();
      p.line(x - 5, y + 3, x - 2, y - 2, S);
      p.line(x + 5, y + 3, x + 2, y - 2, S);
      p.line(x - 4, y - 6, x - 1, y - 4, S);
      p.line(x + 4, y - 6, x + 1, y - 4, S);
      p.px(x - 3, y - 6, L);
      p.px(x + 2, y - 6, L);
      p.px(x - 5, y - 2, L);
      p.rect(x - 3, y + 6, 6, 1, K);
      break;
    }
    case 'braids': {
      p.disc(x, y, 7, H);
      ears();
      p.rect(x, y - 6, 1, 11, P.part);
      p.line(x - 1, y - 4, x - 5, y + 3, S);
      p.line(x + 1, y - 4, x + 5, y + 3, S);
      p.px(x - 3, y - 5, L);
      p.px(x + 3, y - 5, L);
      p.px(x - 5, y - 2, L);
      p.px(x + 5, y - 2, L);
      for (const side of [-1, 1]) {
        const bx = x + side * 5 - 1;
        for (let r = 0; r < 12; r++) {
          const yy = y + 4 + r;
          if (r % 2 === 0) {
            p.rect(bx, yy, 2, 1, H);
            p.px(bx + 2, yy, S);
            if (r % 4 === 0) p.px(bx, yy, L);
          } else {
            p.px(bx, yy, S);
            p.rect(bx + 1, yy, 2, 1, H);
          }
        }
        p.rect(bx, y + 16, 3, 1, P.tie);
        p.rect(bx, y + 17, 3, 1, H);
        p.px(bx + 1, y + 18, S);
      }
      break;
    }
    case 'afro': {
      if (hat) {
        p.ellipse(x, y, 11, 8, H);
        for (const [bx, by] of [[-10, -3], [10, -3], [-11, 1], [11, 1], [-9, 5], [9, 5]]) p.disc(x + bx, y + by, 2, H);
      } else {
        p.disc(x, y - 3, 10, H);
        for (const [bx, by] of [[-10, -6], [-7, -11], [-2, -13], [3, -13], [8, -10], [10, -5], [-11, -1], [11, 0], [-9, 4], [9, 4]]) p.disc(x + bx, y + by, 2, H);
      }
      // springy texture: highlights up top, shade toward the bottom
      for (let dy = -13; dy <= 7; dy++)
        for (let dx = -11; dx <= 11; dx++) {
          if (dx * dx + (dy + 3) * (dy + 3) > 92 || (hat && dy < -3)) continue;
          const v = hash01(dx + 20, dy + 20, 3);
          // coily texture: little shade clusters, light catching the upper left
          if (v < 0.13) p.px(x + dx, y + dy, S);
          else if (v > 0.9 && dx - dy < 6) p.px(x + dx, y + dy, L);
        }
      for (const [sx, sy] of [[-5, -9], [-1, -11], [-7, -5], [2, -8]]) if (!hat) p.rect(x + sx, y + sy, 2, 1, L);
      p.rect(x - 3, y + 7, 6, 1, S);
      break;
    }
    case 'spiky': {
      p.disc(x, y, 7, H);
      if (!hat) {
        for (const [bx, by, tx, ty] of [[-5, -3, -10, -7], [-4, -5, -7, -11], [-1, -6, -2, -13], [2, -6, 4, -12], [4, -4, 9, -9], [5, -2, 10, -3]]) spike(p, x + bx, y + by, x + tx, y + ty, H, L);
      } else {
        spike(p, x - 7, y, x - 10, y + 2, H, L);
        spike(p, x + 7, y, x + 10, y + 2, H, L);
      }
      ears();
      p.px(x - 4, y + 6, S);
      p.px(x + 4, y + 6, S);
      p.px(x - 3, y + 7, S);
      p.px(x + 3, y + 7, S);
      break;
    }
    case 'short':
    default: {
      p.disc(x, y, 7, H);
      ears();
      for (let i = 0; i < 4; i++) p.px(x - 4 + i * 3, y - 7, L);
      p.px(x - 5, y - 4, L);
      p.px(x + 4, y - 5, L);
      p.px(x - 6, y + 3, S);
      p.px(x + 6, y + 3, S);
      p.px(x - 4, y + 6, S);
      p.px(x + 4, y + 6, S);
      p.rect(x - 2, y + 6, 4, 1, H); // nape
    }
  }
}

/** Swinging ponytail (drawn live so it sways). */
const TAIL_W = [3, 5, 5, 6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 2, 2, 1];
function drawPonytail(p: Painter, P: Pal, x: number, y: number, t: number, hat: boolean) {
  const y0 = hat ? y + 2 : y - 2;
  for (let r = 0; r < TAIL_W.length; r++) {
    const w = TAIL_W[r];
    const off = Math.round(Math.sin(t * 1.7 - r * 0.2) * (r / 8));
    const xx = x - (w >> 1) + off;
    const yy = y0 + 1 + r;
    if (hat && yy < y + 2) continue;
    p.rect(xx, yy, w, 1, P.H);
    if (w > 2) {
      p.px(xx, yy, P.S);
      p.px(xx + w - 1, yy, P.S);
      if (r % 3 === 1) p.px(xx + 1, yy, P.L);
    }
  }
  if (!hat) {
    p.rect(x - 2, y0 - 1, 4, 2, P.tie);
    p.px(x - 2, y0 - 1, P.tieHi);
  }
}

type Expr = 'smile' | 'happy' | 'wow' | 'calm';
const FACE_ROWS: [number, number, number][] = [
  [0, 3, 7],
  [1, 2, 7],
  [2, 2, 8],
  [3, 2, 7],
  [4, 3, 7],
  [5, 3, 6],
  [6, 4, 5],
];
/** A 3/4 peek at their face as they turn back toward us (side 1 = over their right shoulder). */
function drawFace(p: Painter, P: Pal, x: number, y: number, side: 1 | -1, expr: Expr, earsHidden: boolean) {
  const X = (dx: number) => (side > 0 ? x + dx : x - dx);
  const span = (dy: number, a: number, b: number, c: string) => p.rect(side > 0 ? x + a : x - b, y + dy, b - a + 1, 1, c);
  for (const [dy, a, b] of FACE_ROWS) span(dy, a, b, P.K);
  span(6, 4, 5, P.KS);
  p.px(X(3), y + 5, P.KS);
  p.px(X(7), y + 5, P.KS);
  p.px(X(8), y + 3, P.KS); // under the nose
  if (!earsHidden) {
    // the near ear, now toward the middle of their head
    p.rect(side > 0 ? x - 1 : x, y + 1, 2, 3, P.K);
    p.px(X(0), y + 2, P.KS);
  }
  const eye = '#160d0a';
  if (expr === 'happy') {
    p.px(X(4), y + 1, eye);
    p.px(X(5), y, eye);
    p.px(X(6), y + 1, eye);
    span(4, 5, 6, P.mouth);
  } else if (expr === 'wow') {
    p.rect(side > 0 ? x + 5 : x - 5, y, 1, 2, eye);
    p.px(X(6), y + 4, P.mouth);
    p.px(X(6), y + 5, P.mouth);
  } else {
    const ex = expr === 'calm' ? 6 : 5;
    p.px(X(ex), y + 1, eye);
    p.px(X(ex), y, eye);
    p.px(X(ex + 1), y, '#fffaf0'); // catch-light so the eye reads on every skin tone
    if (expr === 'smile') p.px(X(6), y + 4, P.mouth);
  }
  span(3, 5, 6, P.blush);
}

/**
 * Back of the head with hair, ears and every head accessory.
 * Order matters so hats and headphones combine: bands go over beanies/caps, under crowns/wizard hats.
 * look -1: cheek peeking as they look left; tilt: one ear dips (thoughtful head tilt).
 */
export function drawHead(p: Painter, s: RenderScene, hx: number, hy: number, look: number, tilt = 0, react: CharReact | null = null, pal?: Pal) {
  const P = pal ?? palOf(s);
  const it = s.items;
  const style: HairStyle = HAIR_STYLE_IDS.includes(s.look?.hair as HairStyle) ? (s.look.hair as HairStyle) : 'short';
  const fit = FIT[style];
  const hat = HATS.find((h) => it.has(h));
  const pointy = hat === 'wizard-hat' || hat === 'witch-hat';
  const cover: Cover = !hat ? 'none' : hat === 'crown' || hat === 'bunny-ears' || (pointy && style === 'afro') ? 'crown' : 'hat';
  const lift = cover === 'crown' ? fit.crown : 0;
  const phones = it.has('headphones');

  p.g.drawImage(hairSprite(style, P, cover), hx - HC.ox, hy - HC.oy);
  if (tilt && !fit.earsHidden) {
    // head tilt: one ear dips a pixel
    p.rect(hx + 7, hy + 1, 2, 1, P.H);
    p.rect(hx + 7, hy + 4, 2, 1, P.K);
  }
  if (style === 'ponytail') drawPonytail(p, P, hx, hy, s.time, cover === 'hat');
  if (look < 0 && !fit.earsHidden) p.rect(hx - 7, hy + 1, 2, 4, P.K); // cheek peeking as they look left
  if (look < 0 && fit.earsHidden) p.rect(hx - 9 - (style === 'afro' ? 2 : 0), hy + 2, 1, 3, P.K);

  // turning round to look at us (tap reactions)
  if (react && react.kind !== 'sip') {
    const len = REACTION_LEN[react.kind];
    const half = react.k < 0.12 || react.k > len - 0.18;
    const side: 1 | -1 = react.kind === 'look' ? -1 : 1;
    const expr: Expr = react.kind === 'look' ? 'calm' : react.kind === 'jump' ? 'wow' : react.kind === 'wave' ? 'smile' : 'happy';
    if (half) p.rect(side > 0 ? hx + 6 : hx - 7, hy + 1, 2, 4, P.K);
    else drawFace(p, P, hx, hy, side, expr, fit.earsHidden);
  }

  const wide = fit.wide;
  if (it.has('glasses')) {
    // temple arms running over the ears, a glint of lens at the sides
    const c = '#2d2d35';
    p.rect(hx - 9 - wide, hy, 3, 1, c);
    p.rect(hx + 7 + wide, hy, 3, 1, c);
    if (!wide) {
      p.px(hx - 6, hy + 1, c);
      p.px(hx + 6, hy + 1, c);
    }
    p.px(hx - 10 - wide, hy, '#9fc3d6');
    p.px(hx + 10 + wide, hy, '#9fc3d6');
  }
  if (it.has('sunglasses')) drawLimitedFace(p, 'sunglasses', hx, hy, wide);
  // headphone band under crowns / bunny ears / pointy hats sitting on an afro; over beanies, santa hats and caps
  if (phones && (!hat || cover === 'crown')) drawBand(p, hx, hy, fit.band, wide);
  if (hat) {
    const hair = cover === 'hat' && style === 'buzz' ? P.fuzz : P.H;
    const hy2 = hy - (cover === 'crown' ? lift : 0);
    if ((LIMITED_HATS as readonly string[]).includes(hat)) drawLimitedHat(p, hat, hx, hy2, s.time, hair);
    else drawHat(p, hat, hx, hy2, hair);
  }
  if (phones) {
    if (hat === 'beanie' || hat === 'santa-hat') drawBand(p, hx, hy, 4, cover === 'hat' && style === 'afro' ? 2 : 0);
    if (hat === 'cap') drawBand(p, hx, hy, 2, cover === 'hat' && style === 'afro' ? 2 : 0);
    // ear cups
    const cw = cover === 'hat' && style === 'afro' ? 2 : wide;
    for (const sx of [-1, 1]) {
      const x = sx < 0 ? hx - 10 - cw : hx + 8 + cw;
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

const HATS: string[] = ['beanie', 'cap', 'wizard-hat', 'crown', ...LIMITED_HATS];

/** Headphone band arching over the head; `extra` lifts it over a hat / big hair, `wide` widens it. */
function drawBand(p: Painter, hx: number, hy: number, extra: number, wide = 0) {
  const R = 9 + wide;
  const top = 9 + extra;
  for (let dx = -R; dx <= R; dx++) {
    const y = Math.round(hy - 1 - top * Math.sqrt(1 - (dx / (R + 0.5)) ** 2));
    p.rect(hx + dx, y, 1, 2, '#3a3a46');
    p.px(hx + dx, y, '#6a6a7c');
  }
  p.rect(hx - 3, hy - 1 - top, 6, 1, '#c0392b'); // padded top
}

function drawHat(p: Painter, hat: string, hx: number, hy: number, hair: string) {
  if (hat === 'beanie') {
    p.disc(hx, hy - 4, 7, '#c0392b');
    for (let i = -5; i <= 5; i += 2) p.line(hx + i, hy - 9 + Math.abs(i) / 3, hx + i, hy - 4, '#ad3226'); // knit
    p.rect(hx - 8, hy - 3, 17, 4, '#a02f24');
    for (let x = hx - 7; x <= hx + 7; x += 2) p.rect(x, hy - 3, 1, 4, '#8f281f'); // ribbed cuff
    p.rect(hx - 8, hy - 3, 17, 1, '#b83a2e');
    p.rect(hx - 7, hy + 1, 15, 1, hair);
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
