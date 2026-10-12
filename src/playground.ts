// Study Buddy — Playground: explore every room, window view, item, weather and world event without studying
// for 100 hours. Everything here is local to this page: it never reads or writes the app's saved data
// (localStorage 'study-buddy:v1'). The scene lives in the URL instead, so any scene can be shared as a link.
//
//   playground.html?h=12.3&w=rain&m=break&view=seaside&items=cat,rug&real=2026-10-31&ev=ufo
//   (same param names as the dev lab page; see `readUrl` for the full list)
import './ui/styles.css';
import './ui/world.css';
import './playground.css';
import { RoomRenderer, PLANT_STAGE_NAMES, plantStage } from './render/room';
import type { Outside } from './render/outside';
import type { HitTarget, Mode, RenderScene, WorldEventKind } from './render/scene';
import { CATCHABLE, SKY_KINDS } from './render/views/schedule';
import { SEASONS, SEASON_DAYS, SIM_START_OFFSET_H, simTime, type SimTime } from './core/sim';
import { HOUR } from './core/time';
import { moonPhase, weatherAt, type Weather } from './core/weather';
import { CATEGORIES, ITEMS, isAvailable, itemById, slotOf, type Item } from './core/catalog';
import {
  CHARACTER_PRESETS, CURTAINS, FLOORS, HAIR_COLORS, HAIR_STYLES, ROOM_PRESETS, SKIN_TONES, TOP_COLORS, VIEWS, WALLS,
  normalizeProfile, type Appearance, type RoomStyle, type Swatch, type ViewId,
} from './core/profile';
import { pickLine, type BubbleCtx, type BubbleReason } from './core/dialogue';
import { AudioEngine, type Sfx } from './audio/engine';
import { bubbleDuration, catchCopy, placeBubble, toCss, toLogical } from './ui/worldlogic';
import { avatarCanvas } from './ui/avatar';
import { h, setText, type Child } from './ui/dom';

// ───────────────────────────── data ─────────────────────────────

const MAX_H = 200;
const OFF = SIM_START_OFFSET_H;
const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];
const WEATHER_META: Record<Weather, { icon: string; name: string }> = {
  clear: { icon: '☀️', name: 'Clear' },
  cloudy: { icon: '☁️', name: 'Cloudy' },
  rain: { icon: '🌧️', name: 'Rain' },
  storm: { icon: '⛈️', name: 'Storm' },
  snow: { icon: '❄️', name: 'Snow' },
  fog: { icon: '🌫️', name: 'Fog' },
};
const MODES: { id: Mode; icon: string; name: string }[] = [
  { id: 'studying', icon: '📚', name: 'Studying' },
  { id: 'paused', icon: '⏸', name: 'Paused' },
  { id: 'break', icon: '☕', name: 'Break' },
  { id: 'idle', icon: '💤', name: 'Idle' },
];
const SEASON_ICONS = ['🌸', '☀️', '🍂', '❄️'];
const MOON_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
/** Time-lapse speeds in sim days (= study hours) per real second. */
const SPEEDS: { label: string; perSec: number }[] = [
  { label: '1 day / min', perSec: 1 / 60 },
  { label: '1 day / 20 s', perSec: 1 / 20 },
  { label: '1 day / 5 s', perSec: 1 / 5 },
];

const EVENT_META: Record<WorldEventKind, { icon: string; name: string; when?: 'day' | 'night' }> = {
  'shooting-star': { icon: '🌠', name: 'Shooting star', when: 'night' },
  balloon: { icon: '🎈', name: 'Hot-air balloon', when: 'day' },
  rainbow: { icon: '🌈', name: 'Rainbow', when: 'day' },
  aurora: { icon: '🌌', name: 'Aurora', when: 'night' },
  fireworks: { icon: '🎆', name: 'Fireworks', when: 'night' },
  kite: { icon: '🪁', name: 'Kite', when: 'day' },
  'bird-visit': { icon: '🐦', name: 'Bird on the sill', when: 'day' },
  birds: { icon: '🕊️', name: 'Flock of birds', when: 'day' },
  ufo: { icon: '🛸', name: 'UFO', when: 'night' },
  train: { icon: '🚆', name: 'Train' },
  boat: { icon: '⛵', name: 'Boat' },
  dolphin: { icon: '🐬', name: 'Dolphins', when: 'day' },
  whale: { icon: '🐋', name: 'Whale', when: 'day' },
  deer: { icon: '🦌', name: 'Deer' },
  fox: { icon: '🦊', name: 'Fox' },
  owl: { icon: '🦉', name: 'Owl', when: 'night' },
  sheep: { icon: '🐑', name: 'Sheep' },
  tractor: { icon: '🚜', name: 'Tractor', when: 'day' },
  plane: { icon: '✈️', name: 'Plane' },
  helicopter: { icon: '🚁', name: 'Helicopter' },
  fireflies: { icon: '✨', name: 'Fireflies', when: 'night' },
};
/** View-specific events that can be started on demand (see each view's startEvent). */
const VIEW_EVENTS: Record<ViewId, WorldEventKind[]> = {
  street: ['fox'],
  seaside: ['dolphin', 'whale', 'boat'],
  city: ['train', 'helicopter'],
  countryside: ['tractor', 'deer', 'fox'],
  forest: ['deer', 'fox'],
};
const VIEW_ONLY: WorldEventKind[] = ['dolphin', 'whale', 'boat', 'train', 'helicopter', 'tractor', 'deer', 'fox'];
/** Seconds already elapsed when an event is forced (so slow entrances are on screen right away). */
const FORCE_AGE: Partial<Record<WorldEventKind, number>> = { balloon: 8, kite: 2, birds: 1, ufo: 1, fireworks: 0.4, aurora: 6, rainbow: 4 };
/** Little extras each view does on its own (not forceable). */
const VIEW_EXTRAS: Record<ViewId, string> = {
  street: 'Cars and dog walkers pass by. Pumpkins in October, fairy lights in December — set the date below.',
  seaside: 'Gulls by day, the lighthouse sweeps at night, boats drift past.',
  city: 'Planes blink across the night sky; rooftop fairy lights in December.',
  countryside: 'Sheep graze, the windmill turns; fireflies on summer nights; UFOs love it here.',
  forest: 'Owls and fireflies at night — and the aurora glows by itself on clear winter nights.',
};
const EVENT_SOUND: Partial<Record<WorldEventKind, Sfx>> = {
  balloon: 'balloon',
  fireworks: 'fireworks',
  train: 'train',
  'bird-visit': 'chirp',
  ufo: 'whoosh',
  owl: 'owl',
  'shooting-star': 'sparkle',
  dolphin: 'gull',
  whale: 'gull',
  boat: 'horn',
};
const PET_IDS = ['cat', 'dog', 'fish-tank', 'lizard'];

interface Combo {
  id: string;
  icon: string;
  name: string;
  items: string[];
  /** also jump to this real date (MM-DD), season, time of day and weather */
  real?: string;
  season?: number;
  t?: number;
  w?: Weather;
  moon?: number;
}
const COMBOS: Combo[] = [
  { id: 'cozy', icon: '🛋️', name: 'Cozy starter', items: ['rug', 'desk-lamp', 'big-plant', 'poster', 'fairy-lights', 'cat', 'glasses', 'headphones'] },
  {
    id: 'gamer', icon: '🎮', name: 'Gamer den',
    items: ['rgb-keyboard', 'triple-monitor', 'pc-tower', 'monitor-light', 'headphones', 'cap', 'hoodie-black', 'tv', 'ps5', 'beanbag', 'neon-sign', 'robot-vacuum'],
  },
  { id: 'pets', icon: '🐾', name: 'Pet paradise', items: ['cat', 'dog', 'fish-tank', 'lizard', 'hamster', 'parrot', 'robot-vacuum', 'rug', 'big-plant', 'sofa'] },
  {
    id: 'halloween', icon: '🎃', name: 'Halloween',
    items: ['pumpkin-lantern', 'witch-hat', 'ghost-plush', 'bat-garland', 'fairy-lights', 'desk-lamp', 'cat', 'sweater', 'rug', 'big-plant'],
    real: '10-31', season: 2, t: 0.66, w: 'clear', moon: 0.5,
  },
  {
    id: 'winter', icon: '🎄', name: 'Winter festival',
    items: ['festive-tree', 'santa-hat', 'snow-globe', 'fairy-lights', 'sweater', 'rug', 'coffee-machine', 'record-player', 'dog', 'desk-lamp'],
    real: '12-24', season: 3, t: 0.6, w: 'snow',
  },
];
const DATES: { icon: string; name: string; mmdd: string }[] = [
  { icon: '🎃', name: 'Halloween', mmdd: '10-31' },
  { icon: '🍂', name: 'Harvest', mmdd: '11-15' },
  { icon: '🎄', name: 'Winter festival', mmdd: '12-24' },
  { icon: '🏮', name: 'Lunar New Year', mmdd: '02-01' },
  { icon: '💖', name: 'Valentine’s', mmdd: '02-14' },
  { icon: '🌷', name: 'Spring bloom', mmdd: '04-10' },
  { icon: '😎', name: 'Summer', mmdd: '07-15' },
  { icon: '🌍', name: 'Back to school', mmdd: '09-10' },
];
const BREAK_ACTS: { id: string; icon: string; name: string; needs: string[]; has: (it: Set<string>) => boolean }[] = [
  { id: 'game', icon: '🎮', name: 'Gaming', needs: ['tv', 'ps5'], has: (it) => it.has('tv') && it.has('ps5') },
  { id: 'stand', icon: '🧍', name: 'Standing desk', needs: ['standing-desk'], has: (it) => it.has('standing-desk') },
  { id: 'lounge', icon: '🫘', name: 'Lounging', needs: ['beanbag'], has: (it) => it.has('beanbag') || it.has('sofa') },
];
/** Must match character.ts BREAK_SLOT: with several break toys the buddy rotates every 36 s. */
const BREAK_SLOT = 36;

// ───────────────────────────── state ─────────────────────────────

interface State {
  /** total study hours (drives the sim clock) */
  h: number;
  w: Weather | 'auto';
  /** null = follow the 8-day lunar cycle */
  moon: number | null;
  m: Mode;
  room: RoomStyle;
  look: Appearance;
  items: Set<string>;
  /** real calendar date YYYY-MM-DD, or null for today */
  real: string | null;
  /** time-lapse: 0 = off, else 1-based index into SPEEDS */
  tl: number;
  /** last forced world event (included in share links so the recipient sees it too) */
  ev: WorldEventKind | null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pad2 = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaults(): State {
  return {
    h: 4.41, // day 5 of spring, golden hour, clear skies
    w: 'auto',
    moon: null,
    m: 'studying',
    room: { ...ROOM_PRESETS[0].room },
    look: { ...CHARACTER_PRESETS[0].appearance },
    items: new Set(COMBOS[0].items),
    real: null,
    tl: 0,
    ev: null,
  };
}

/** One item per slot (seasonal hats / shades for the chosen date), plus every other item. */
function everything(month: number): Set<string> {
  const prefer: Record<string, string> = {
    hat: month === 9 ? 'witch-hat' : month === 11 || month === 0 ? 'santa-hat' : month === 2 || month === 3 ? 'bunny-ears' : 'beanie',
    face: month >= 5 && month <= 7 ? 'sunglasses' : 'glasses',
    monitor: 'triple-monitor',
    top: 'sweater',
  };
  const out = new Set<string>(Object.values(prefer));
  const slots = new Set(Object.keys(prefer));
  for (const it of ITEMS) {
    const s = slotOf(it);
    if (slots.has(s)) continue;
    slots.add(s);
    out.add(it.id);
  }
  return out;
}

function readUrl(q: URLSearchParams): State {
  const s = defaults();
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  s.h = clamp(num('h') ?? s.h, 0, MAX_H);
  const w = q.get('w');
  if (w && (WEATHERS as string[]).includes(w)) s.w = w as Weather;
  const moon = num('moon');
  if (moon !== null) s.moon = clamp(moon, 0, 0.999);
  const m = q.get('m');
  if (m && MODES.some((x) => x.id === m)) s.m = m as Mode;
  const real = q.get('real');
  if (real && DATE_RE.test(real) && !Number.isNaN(new Date(real + 'T12:00:00').getTime())) s.real = real;
  const charPreset = CHARACTER_PRESETS.find((c) => c.id === q.get('char'))?.appearance ?? s.look;
  const roomPreset = ROOM_PRESETS.find((c) => c.id === q.get('preset'))?.room ?? s.room;
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => q.has(k)).map((k) => [k, q.get(k)]));
  const prof = normalizeProfile({
    appearance: { ...charPreset, ...pick(['name', 'skin', 'hair', 'hairColor', 'top']) },
    room: { ...roomPreset, ...pick(['view', 'wall', 'floor', 'curtains']) },
  });
  s.look = prof.appearance;
  s.room = prof.room;
  const items = q.get('items');
  if (items === 'all') s.items = everything(realDate(s).getMonth());
  else if (items === 'none' || items === '') s.items = new Set();
  else if (items) s.items = new Set(items.split(',').filter((id) => itemById(id)));
  s.tl = clamp(Math.round(num('tl') ?? 0), 0, SPEEDS.length);
  const ev = q.get('ev');
  if (ev && ev in EVENT_META) s.ev = ev as WorldEventKind;
  return s;
}

function writeUrl(s: State): string {
  const q = new URLSearchParams();
  q.set('h', String(Math.round(s.h * 1000) / 1000));
  if (s.w !== 'auto') q.set('w', s.w);
  if (s.moon !== null) q.set('moon', s.moon.toFixed(2));
  q.set('m', s.m);
  q.set('view', s.room.view);
  q.set('wall', s.room.wall);
  q.set('floor', s.room.floor);
  q.set('curtains', s.room.curtains);
  q.set('name', s.look.name);
  q.set('skin', s.look.skin);
  q.set('hair', s.look.hair);
  q.set('hairColor', s.look.hairColor);
  q.set('top', s.look.top);
  q.set('items', s.items.size ? [...s.items].join(',') : 'none');
  if (s.real) q.set('real', s.real);
  if (s.tl) q.set('tl', String(s.tl));
  if (s.ev) q.set('ev', s.ev);
  return `${location.pathname}?${q.toString().replace(/%2C/g, ',')}`;
}

function realDate(s: State): Date {
  return new Date((s.real ?? todayKey()) + 'T12:00:00');
}
/** The real clock the renderer sees: the chosen date at the current wall-clock time. */
function realNow(s: State): number {
  if (!s.real) return Date.now();
  const d = realDate(s);
  const n = new Date();
  d.setHours(n.getHours(), n.getMinutes(), n.getSeconds());
  return d.getTime();
}

let st = readUrl(new URLSearchParams(location.search));

// ───────────────────────────── renderer ─────────────────────────────

const audio = new AudioEngine();
let soundOn = false;
const sound = { music: true, ambience: true, volume: 0.7 };
const play = (name: Sfx, opts?: { dir?: 1 | -1; delay?: number }) => soundOn && audio.play(name, opts);
const lastEventSound = new Map<WorldEventKind, number>();

const canvas = h('canvas', {
  class: 'room-canvas pg-canvas',
  tabindex: '0',
  'aria-label': 'The study room — tap the buddy, pets and things in it; press Enter to say hi',
});
const renderer = new RoomRenderer(canvas, {
  onCar: (dir) => Math.random() < 0.3 && play('car', { dir }),
  onThunder: () => play('thunder'),
  onPet: (p) => play(p === 'cat' ? 'meow' : 'bark'),
  onWorldEvent: (k) => onWorldEvent(k),
  onCatch: (k) => onCatch(k),
});
const outside = (renderer as unknown as { outside: Outside }).outside;

/** Added to the animation clock (only ever moved forward) to pick a break activity. */
let timeOffset = 0;
const animTime = () => performance.now() / 1000 + timeOffset;

function sceneAt(time: number): RenderScene {
  const ms = st.h * HOUR;
  return {
    time,
    sim: simTime(ms),
    weather: currentWeather(),
    moon: st.moon ?? moonPhase(ms),
    mode: st.m,
    items: st.items,
    look: st.look,
    room: st.room,
    studiedHours: st.h,
    realNow: realNow(st),
  };
}
const currentWeather = (): Weather => (st.w === 'auto' ? weatherAt(st.h * HOUR) : st.w);

// ───────────────────────────── shell ─────────────────────────────

const toasts = h('div', { class: 'toasts pg-toasts', 'aria-live': 'polite' });
function toast(text: string, icon = '✨', ms = 2800) {
  // the same message twice in a row (e.g. two catchable events at once) shows once
  for (const t of toasts.children) if ((t as HTMLElement).dataset.text === text && !t.classList.contains('closing')) return;
  const el = h('div', { class: 'toast' }, h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon), h('span', null, text));
  el.dataset.text = text;
  toasts.append(el);
  while (toasts.children.length > 3) toasts.firstElementChild?.remove();
  window.setTimeout(() => {
    el.classList.add('closing');
    window.setTimeout(() => el.remove(), 220);
  }, ms);
}

const overlay = h('div', { class: 'stage-overlay' });
const bubbleText = h('span', { class: 'bubble-text' });
const bubble = h('div', { class: 'bubble', role: 'status', 'aria-live': 'polite', hidden: true }, bubbleText);
overlay.append(bubble);
const caption = h('div', { class: 'sim-chip pg-caption' });
const stage = h('div', { class: 'stage pg-stage' }, canvas, overlay, caption);

// ───── speech bubble (a light version of ui/buddy.ts) ─────
let bubbleAt: HitTarget | 'buddy' = 'buddy';
let bubbleUntil = 0;
let bubbleKey = '';
let bubbleSize: { W: number; H: number; bw: number; bh: number } | null = null;
let lastAuto = 0;

function say(text: string, at: HitTarget | 'buddy' = 'buddy') {
  bubbleAt = at;
  bubbleText.textContent = text;
  bubble.hidden = false;
  bubble.classList.remove('bubble-out', 'bubble-in');
  void bubble.offsetWidth;
  bubble.classList.add('bubble-in');
  bubbleSize = null;
  bubbleKey = '';
  bubbleUntil = performance.now() + bubbleDuration(text);
  positionBubble(performance.now());
}
function hideBubble() {
  if (bubble.hidden || bubble.classList.contains('bubble-out')) return;
  bubble.classList.add('bubble-out');
  window.setTimeout(() => {
    if (performance.now() >= bubbleUntil) bubble.hidden = true;
  }, 180);
}
function positionBubble(now: number) {
  if (bubble.hidden) return;
  if (now > bubbleUntil) return hideBubble();
  if (!bubbleSize) {
    const W = overlay.clientWidth;
    const H = overlay.clientHeight;
    if (!W || !H) return;
    bubbleSize = { W, H, bw: bubble.offsetWidth, bh: bubble.offsetHeight };
  }
  const { W, H, bw, bh } = bubbleSize;
  const a = renderer.anchor(bubbleAt) ?? renderer.anchor('buddy');
  if (!a) return;
  const p = toCss(a, W, H);
  const pl = placeBubble(p.x, p.y, bw, bh, W, H, 6, 10);
  const key = `${Math.round(pl.left)}|${Math.round(pl.top)}|${Math.round(pl.tailX)}|${pl.below}`;
  if (key === bubbleKey) return;
  bubbleKey = key;
  bubble.style.left = `${Math.round(pl.left)}px`;
  bubble.style.top = `${Math.round(pl.top)}px`;
  bubble.style.setProperty('--tail-x', `${Math.round(pl.tailX)}px`);
  bubble.classList.toggle('below', pl.below);
}
function floatFx(text: string, at: HitTarget | 'buddy') {
  const a = renderer.anchor(at);
  const W = overlay.clientWidth;
  const H = overlay.clientHeight;
  if (!a || !W) return;
  const p = toCss(a, W, H);
  const el = h('span', { class: 'float-fx', 'aria-hidden': 'true', style: `left:${p.x}px;top:${p.y}px` }, text);
  overlay.append(el);
  window.setTimeout(() => el.remove(), 1300);
}
window.addEventListener('resize', () => {
  bubbleSize = null;
  bubbleKey = '';
});

function ctxFor(reason: BubbleReason, extra?: Partial<BubbleCtx>): BubbleCtx {
  const sim = simTime(st.h * HOUR);
  return {
    reason,
    name: st.look.name,
    hour: new Date().getHours(),
    isNight: sim.isNight,
    season: sim.season,
    weather: currentWeather(),
    view: st.room.view,
    streak: 3,
    todayMin: 25,
    sessionMin: st.m === 'studying' ? 25 : 0,
    goalMin: 60,
    ...extra,
  };
}
const line = (reason: BubbleReason, extra?: Partial<BubbleCtx>) => pickLine(ctxFor(reason, extra));

// ───── tapping things in the room ─────
const TAP: Partial<Record<HitTarget, { sound?: Sfx; float?: string }>> = {
  cat: { sound: 'purr' },
  'fish-tank': { sound: 'pop', float: '🫧' },
  lizard: { sound: 'boop' },
  mug: { sound: 'sip' },
  plant: { sound: 'rustle', float: '🍃' },
  clock: { sound: 'tick', float: 'tick!' },
  lamp: { sound: 'click' },
  tv: { sound: 'click' },
  hamster: { sound: 'pop' },
  parrot: { sound: 'chirp' },
  'robot-vacuum': { sound: 'boop', float: 'beep!' },
  ghost: { sound: 'whoosh', float: '👻' },
};
const PETS: HitTarget[] = ['cat', 'dog', 'fish-tank', 'lizard', 'hamster', 'parrot', 'robot-vacuum', 'ghost'];

function captionFor(target: HitTarget): string {
  const sim = simTime(st.h * HOUR);
  switch (target) {
    case 'mug':
      return renderer.coffeeLevel > 0.95 ? 'Fresh refill ☕' : `Sip… ☕ (${Math.round(renderer.coffeeLevel * 100)}% left)`;
    case 'plant':
      return `🌱 ${PLANT_STAGE_NAMES[plantStage(st.h)]} — it grows as you study (${st.h.toFixed(1)} h)`;
    case 'clock':
      return `It’s ${sim.clock} in the room 🕰️`;
    case 'lamp':
      return renderer.lampOn ? 'Lamp on 💡' : 'Lamp off — cozy dark 🌙';
    case 'tv':
      return 'Channel surfing 📺';
    case 'window': {
      const v = VIEWS.find((x) => x.id === st.room.view)!;
      return `${v.icon} ${v.blurb}`;
    }
    default:
      return '';
  }
}

function tap(target: HitTarget, pt: { x: number; y: number } | null) {
  if (soundOn) void audio.unlock();
  try {
    renderer.interact(target, animTime(), pt?.x, pt?.y);
  } catch (e) {
    console.warn('[playground] interact failed', e);
  }
  if (target === 'world-event') return; // onCatch reports it
  if (target === 'character') {
    play(Math.random() < 0.5 ? 'boop' : 'hey');
    say(line('tap'));
    return;
  }
  const fx = TAP[target];
  if (fx?.sound) play(fx.sound);
  if (fx?.float) floatFx(fx.float, target);
  if (PETS.includes(target)) say(line('pet', { pet: target }));
  else {
    const text = captionFor(target);
    if (text) say(text, target === 'window' ? 'window' : target);
  }
}

let lastPt: { x: number; y: number } | null = null;
function hitAt(e: { clientX: number; clientY: number }): HitTarget | null {
  const pt = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
  lastPt = pt;
  if (!pt) return null;
  try {
    return renderer.hitTest(pt.x, pt.y);
  } catch {
    return null;
  }
}
canvas.addEventListener('click', (e) => {
  const t = hitAt(e);
  if (t) tap(t, lastPt);
});
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    tap('character', null);
  }
});
let hoverRaf = 0;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    canvas.style.cursor = hitAt(e) ? 'pointer' : '';
  });
});

function onWorldEvent(kind: WorldEventKind) {
  if (document.hidden) return;
  const now = performance.now();
  const snd = EVENT_SOUND[kind];
  if (snd && now - (lastEventSound.get(kind) ?? -1e9) > 8000) {
    lastEventSound.set(kind, now);
    play(snd);
  }
  // a short reaction, but not for every passing train / plane
  if (now - lastAuto > 6000 && !(kind === 'train' || kind === 'plane' || kind === 'boat')) {
    const text = line('event', { event: kind });
    if (text && text !== '…') {
      lastAuto = now;
      say(text);
    }
  }
}
function onCatch(kind: WorldEventKind) {
  play('sparkle');
  play('coin', { delay: 0.25 });
  const c = catchCopy(kind);
  toast(`${c.text} (no coins here — it’s the playground)`, c.icon);
  lastAuto = performance.now();
  say(line('caught', { event: kind }));
}

// ───────────────────────────── controls ─────────────────────────────

const syncers: (() => void)[] = [];
/** The subset that follows the running clock (re-run a few times a second during a time-lapse). */
const tickers: (() => void)[] = [];
const onSync = (f: () => void, tick = false) => {
  syncers.push(f);
  if (tick) tickers.push(f);
  return f;
};
let urlTimer = 0;
function changed(opts: { url?: boolean } = {}) {
  for (const f of syncers) f();
  if (opts.url !== false) {
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => history.replaceState(null, '', writeUrl(st)), 250);
  }
}

const btn = (label: Child, onclick: () => void, cls = 'btn btn-ghost btn-small', attrs: Record<string, unknown> = {}) =>
  h('button', { type: 'button', class: cls, onclick, ...attrs }, label);

/** A row of mutually exclusive choice chips. */
function choiceRow<T extends string>(
  label: string,
  opts: { id: T; label: Child; title?: string }[],
  get: () => T | null,
  set: (id: T) => void,
  cls = '',
  tick = false,
): HTMLElement {
  const buttons = opts.map((o) =>
    h(
      'button',
      { type: 'button', class: 'pg-chip', role: 'radio', title: o.title ?? null, 'aria-checked': 'false', onclick: () => set(o.id) },
      o.label,
    ),
  );
  onSync(() => buttons.forEach((b, i) => b.setAttribute('aria-checked', String(get() === opts[i].id))), tick);
  return h('div', { class: `pg-chips ${cls}`, role: 'radiogroup', 'aria-label': label }, buttons);
}

function swatchRow(label: string, list: Swatch[], get: () => string, set: (id: string) => void): HTMLElement {
  const buttons = list.map((sw) =>
    h(
      'button',
      { type: 'button', class: 'cz-swatch', role: 'radio', title: sw.name, 'aria-label': sw.name, 'aria-checked': 'false', onclick: () => set(sw.id) },
      h('span', { class: 'cz-dot', style: `--c0:${sw.colors[0]};--c1:${sw.colors[1]};--c2:${sw.colors[2]}` }),
    ),
  );
  onSync(() => buttons.forEach((b, i) => b.setAttribute('aria-checked', String(get() === list[i].id))));
  return h('div', { class: 'cz-swatches', role: 'radiogroup', 'aria-label': label }, buttons);
}

const field = (label: string, ...children: Child[]) => h('div', { class: 'pg-field' }, h('div', { class: 'pg-label' }, label), children);

const wide = matchMedia('(min-width: 960px)');
const sections: HTMLDetailsElement[] = [];
function section(id: string, icon: string, title: string, phoneOpen: boolean, ...content: Child[]): HTMLDetailsElement {
  const d = h(
    'details',
    { class: 'pg-sec card', id: `sec-${id}`, 'data-phone-open': phoneOpen ? '1' : '0' },
    h('summary', null, h('span', { class: 'pg-sec-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'pg-sec-title' }, title), h('span', { class: 'pg-sec-note' })),
    h('div', { class: 'pg-sec-body' }, content),
  );
  d.open = wide.matches || phoneOpen;
  sections.push(d);
  return d;
}
const note = (d: HTMLDetailsElement) => d.querySelector('.pg-sec-note') as HTMLElement;

// ───── time ─────
function dayIndex() {
  return Math.floor(st.h + OFF);
}
function setHours(v: number) {
  st.h = clamp(v, 0, MAX_H);
  changed();
}
function setTimeOfDay(t: number) {
  setHours(dayIndex() + t - OFF);
}
function setSeason(season: number, step = false) {
  const di = dayIndex();
  const t = st.h + OFF - di;
  let nd: number;
  if (step) nd = di + SEASON_DAYS;
  else {
    const year = Math.floor(di / (SEASON_DAYS * 4));
    nd = year * SEASON_DAYS * 4 + season * SEASON_DAYS + (di % SEASON_DAYS);
  }
  if (nd + t - OFF > MAX_H) nd = nd % (SEASON_DAYS * 4);
  setHours(nd + t - OFF);
}

const hoursRange = h('input', { type: 'range', min: '0', max: String(MAX_H), step: '0.01', class: 'pg-range', 'aria-label': 'Total study hours' });
const hoursNum = h('input', { type: 'number', min: '0', max: String(MAX_H), step: '0.1', class: 'pg-num', inputmode: 'decimal', 'aria-label': 'Total study hours (number)' });
const todRange = h('input', { type: 'range', min: '0', max: '0.999', step: '0.001', class: 'pg-range pg-range-sky', 'aria-label': 'Time of day' });
hoursRange.addEventListener('input', () => setHours(Number(hoursRange.value)));
hoursNum.addEventListener('change', () => setHours(Number(hoursNum.value) || 0));
todRange.addEventListener('input', () => setTimeOfDay(Number(todRange.value)));
const clockOut = h('b', { class: 'pg-clock' });
const dayOut = h('span', { class: 'muted' });
const plantOut = h('span', { class: 'muted small' });
function syncTime() {
  const sim = simTime(st.h * HOUR);
  if (document.activeElement !== hoursRange) hoursRange.value = String(st.h);
  if (document.activeElement !== hoursNum) hoursNum.value = st.h.toFixed(2);
  if (document.activeElement !== todRange) todRange.value = String(sim.t);
  setText(clockOut, `${sim.isNight ? '🌙' : '☀️'} ${sim.clock}`);
  setText(dayOut, `Day ${sim.day} · ${SEASON_ICONS[sim.season]} ${sim.seasonName} ${sim.dayOfSeason}/10 · Year ${sim.year}`);
  setText(plantOut, `🌱 Desk plant: ${PLANT_STAGE_NAMES[plantStage(st.h)]} — it grows with your hours`);
}
onSync(syncTime, true);
onSync(() => setText(note(secTime), simTime(st.h * HOUR).clock), true);

const tlBtn = btn('', () => {
  st.tl = st.tl ? 0 : lastSpeed;
  changed();
});
let lastSpeed = st.tl || 2;
onSync(() => {
  tlBtn.textContent = st.tl ? '⏸ Stop time-lapse' : '▶ Time-lapse';
  tlBtn.className = `btn btn-small ${st.tl ? 'btn-primary' : 'btn-go'}`;
  tlBtn.setAttribute('aria-pressed', String(!!st.tl));
});
const speedRow = choiceRow(
  'Time-lapse speed',
  SPEEDS.map((s, i) => ({ id: String(i + 1), label: s.label })),
  () => (st.tl ? String(st.tl) : null),
  (id) => {
    st.tl = lastSpeed = Number(id);
    changed();
  },
  'pg-chips-tight',
);

const secTime = section(
  'time',
  '⏳',
  'Time & seasons',
  true,
  h('div', { class: 'pg-readout' }, clockOut, dayOut),
  field('Study hours (1 h = 1 sim day · 10 days = a season)', h('div', { class: 'pg-inline' }, hoursRange, hoursNum)),
  field('Time of day', h('div', { class: 'pg-inline' }, h('span', { 'aria-hidden': 'true' }, '🌅'), todRange, h('span', { 'aria-hidden': 'true' }, '🌙'))),
  h(
    'div',
    { class: 'pg-btns' },
    btn('🌄 Dawn', () => setTimeOfDay(0.985)),
    btn('☀️ Morning', () => setTimeOfDay(0.12)),
    btn('🌞 Noon', () => setTimeOfDay(0.25)),
    btn('🌇 Sunset', () => setTimeOfDay(0.485)),
    btn('🌙 Night', () => setTimeOfDay(0.72)),
    btn('⏭ Next season', () => setSeason(0, true)),
  ),
  choiceRow(
    'Season',
    SEASONS.map((n, i) => ({ id: String(i), label: `${SEASON_ICONS[i]} ${n}` })),
    () => String(simTime(st.h * HOUR).season),
    (id) => setSeason(Number(id)),
    '',
    true,
  ),
  h('div', { class: 'pg-tl' }, tlBtn, speedRow),
  plantOut,
);

// ───── weather & sky ─────
const moonRange = h('input', { type: 'range', min: '0', max: '0.999', step: '0.001', class: 'pg-range', 'aria-label': 'Moon phase' });
moonRange.addEventListener('input', () => {
  st.moon = Number(moonRange.value);
  changed();
});
const moonOut = h('span', { class: 'pg-moon' });
const moonAuto = btn('Auto', () => {
  st.moon = st.moon === null ? moonPhase(st.h * HOUR) : null;
  changed();
}, 'pg-chip');
const moonName = (p: number) => ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'][Math.round(p * 8) % 8];
onSync(() => {
  const p = st.moon ?? moonPhase(st.h * HOUR);
  if (document.activeElement !== moonRange) moonRange.value = String(p);
  setText(moonOut, `${MOON_ICONS[Math.round(p * 8) % 8]} ${moonName(p)}`);
  moonAuto.setAttribute('aria-pressed', String(st.moon === null));
  moonAuto.title = 'Follow the 8-day lunar cycle';
}, true);
const weatherAutoLabel = h('span');
onSync(() => {
  const w = weatherAt(st.h * HOUR);
  setText(weatherAutoLabel, `✨ Auto · ${WEATHER_META[w].icon}`);
}, true);
const secWeather = section(
  'weather',
  '🌦️',
  'Weather & sky',
  false,
  choiceRow<Weather | 'auto'>(
    'Weather',
    [{ id: 'auto', label: weatherAutoLabel, title: 'Follow the sim’s weather (changes every 30 study minutes)' }, ...WEATHERS.map((w) => ({ id: w, label: `${WEATHER_META[w].icon} ${WEATHER_META[w].name}` }))],
    () => st.w,
    (id) => {
      st.w = id;
      changed();
    },
  ),
  field('Moon phase (shows at night)', h('div', { class: 'pg-inline' }, moonRange, moonAuto), moonOut),
);
onSync(() => setText(note(secWeather), `${WEATHER_META[currentWeather()].icon} ${WEATHER_META[currentWeather()].name}`), true);

// ───── mode ─────
const modeSeg = h(
  'div',
  { class: 'segmented pg-seg', role: 'radiogroup', 'aria-label': 'What the buddy is doing' },
  MODES.map((m) =>
    h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': 'false', 'data-id': m.id, onclick: () => setMode(m.id) }, `${m.icon} ${m.name}`),
  ),
);
function setMode(m: Mode) {
  st.m = m;
  changed();
}
onSync(() => modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === st.m))));
const breakBox = h('div', { class: 'pg-break' });
function showActivity(id: string) {
  const act = BREAK_ACTS.find((a) => a.id === id)!;
  if (!act.has(st.items)) {
    const next = new Set(st.items);
    for (const need of act.needs) addItem(next, need);
    st.items = next;
  }
  st.m = 'break';
  // the buddy rotates between the break toys every BREAK_SLOT seconds: skip ahead to this one
  const acts = BREAK_ACTS.filter((a) => a.has(st.items)).map((a) => a.id);
  const idx = acts.indexOf(id);
  for (let i = 0; i < acts.length && Math.floor(animTime() / BREAK_SLOT) % acts.length !== idx; i++) {
    timeOffset += BREAK_SLOT - (animTime() % BREAK_SLOT) + 0.05;
  }
  changed();
}
const breakBtns = BREAK_ACTS.map((a) => btn(`${a.icon} ${a.name}`, () => showActivity(a.id), 'pg-chip'));
breakBox.append(
  h('div', { class: 'pg-label' }, 'Break activities'),
  h('div', { class: 'pg-chips' }, breakBtns),
  h('p', { class: 'muted small' }, 'With several break toys they rotate between them every ~36 s. Tapping one equips what it needs.'),
);
onSync(() => {
  breakBox.hidden = st.m !== 'break';
  BREAK_ACTS.forEach((a, i) => breakBtns[i].setAttribute('aria-pressed', String(a.has(st.items))));
});
const secMode = section(
  'mode',
  '🧑‍💻',
  'What he’s doing',
  false,
  modeSeg,
  h('p', { class: 'muted small pg-hint' }, 'Studying: types and sips. Paused & idle: reads, doodles, yawns, naps late at night. Break: games, stands or lounges.'),
  breakBox,
);
onSync(() => {
  const m = MODES.find((x) => x.id === st.m)!;
  setText(note(secMode), `${m.icon} ${m.name}`);
});

// ───── world events ─────
let pendingFire = 0;
function fire(kind: WorldEventKind) {
  if (!VIEW_EVENTS[st.room.view].includes(kind) && !SKY_KINDS.includes(kind)) {
    const v = (Object.keys(VIEW_EVENTS) as ViewId[]).find((id) => VIEW_EVENTS[id].includes(kind))!;
    st.room = { ...st.room, view: v };
    const vm = VIEWS.find((x) => x.id === v)!;
    toast(`Switched the window to ${vm.name} for the ${EVENT_META[kind].name.toLowerCase()}`, vm.icon);
    changed();
    clearTimeout(pendingFire);
    pendingFire = window.setTimeout(() => fire(kind), 120);
    return;
  }
  if (soundOn) void audio.unlock();
  const ok = outside.forceEvent(kind, FORCE_AGE[kind] ?? 0);
  if (!ok) {
    toast(`The ${VIEWS.find((x) => x.id === st.room.view)!.name.toLowerCase()} can’t show that one`, '🤷');
    return;
  }
  st.ev = kind;
  changed();
  const meta = EVENT_META[kind];
  const night = simTime(st.h * HOUR).t >= 0.5;
  if (meta.when === 'night' && !night) toast(`${meta.name} looks best at night — try 🌙 Night`, meta.icon);
  else if (meta.when === 'day' && night) toast(`${meta.name} looks best by day — try ☀️ Morning`, meta.icon);
  if (CATCHABLE.includes(kind)) window.setTimeout(() => toast('Tap it in the window to catch it!', '🖐'), 900);
}
const skyEventBtns = SKY_KINDS.map((k) => btn(h('span', null, `${EVENT_META[k].icon} ${EVENT_META[k].name}`), () => fire(k), 'pg-chip pg-ev'));
const viewEventBtns = VIEW_ONLY.map((k) => {
  const badge = h('span', { class: 'pg-ev-view', 'aria-hidden': 'true' });
  const b = btn(h('span', null, `${EVENT_META[k].icon} ${EVENT_META[k].name}`, badge), () => fire(k), 'pg-chip pg-ev');
  onSync(() => {
    const here = VIEW_EVENTS[st.room.view].includes(k);
    b.classList.toggle('pg-ev-away', !here);
    const v = VIEWS.find((x) => VIEW_EVENTS[x.id].includes(k))!;
    badge.textContent = here ? '' : v.icon;
    b.title = here ? `Start the ${EVENT_META[k].name.toLowerCase()} now` : `Switches the window to ${v.name}`;
  });
  return b;
});
const extrasOut = h('p', { class: 'muted small pg-hint' });
const viewEventGrid = h('div', { class: 'pg-chips' });
let eventsFor = '';
onSync(() => {
  if (eventsFor === st.room.view) return;
  eventsFor = st.room.view;
  // this view's events first, then the ones that switch the window
  const here = (b: HTMLElement) => (b.classList.contains('pg-ev-away') ? 0 : 1);
  viewEventGrid.replaceChildren(...[...viewEventBtns].sort((a, b) => here(b) - here(a)));
  setText(extrasOut, `${VIEWS.find((x) => x.id === st.room.view)!.icon} ${VIEW_EXTRAS[st.room.view]}`);
});
const secEvents = section(
  'events',
  '🎆',
  'World events',
  true,
  field('In the sky (any view)', h('div', { class: 'pg-chips' }, skyEventBtns)),
  field('Out in the view', viewEventGrid),
  extrasOut,
  h('p', { class: 'muted small pg-hint' }, '🌈 Rainbows also appear by themselves when the rain stops in daylight — try time-lapse with Auto weather.'),
);

// ───── window & room ─────
function setRoom(patch: Partial<RoomStyle>) {
  const prevView = st.room.view;
  st.room = { ...st.room, ...patch };
  if (st.room.view !== prevView) st.ev = null;
  changed();
}
const viewCards = VIEWS.map((v) =>
  h(
    'button',
    { type: 'button', class: 'pg-card', role: 'radio', 'aria-checked': 'false', onclick: () => setRoom({ view: v.id }) },
    h('span', { class: 'pg-card-icon', 'aria-hidden': 'true' }, v.icon),
    h('span', { class: 'pg-card-text' }, h('b', null, v.name), h('span', { class: 'muted small' }, v.blurb)),
  ),
);
onSync(() => viewCards.forEach((c, i) => c.setAttribute('aria-checked', String(st.room.view === VIEWS[i].id))));
const presetMatch = () => ROOM_PRESETS.find((p) => (Object.keys(p.room) as (keyof RoomStyle)[]).every((k) => p.room[k] === st.room[k]))?.id ?? null;
const secRoom = section(
  'room',
  '🪟',
  'Window & room',
  false,
  field('Window view', h('div', { class: 'pg-cards', role: 'radiogroup', 'aria-label': 'Window view' }, viewCards)),
  field(
    'Room presets',
    choiceRow(
      'Room preset',
      ROOM_PRESETS.map((p) => ({ id: p.id, label: `${p.icon} ${p.name}` })),
      presetMatch,
      (id) => setRoom({ ...ROOM_PRESETS.find((p) => p.id === id)!.room }),
    ),
  ),
  field('Wallpaper', swatchRow('Wallpaper', WALLS, () => st.room.wall, (id) => setRoom({ wall: id as RoomStyle['wall'] }))),
  field('Floor', swatchRow('Floor', FLOORS, () => st.room.floor, (id) => setRoom({ floor: id as RoomStyle['floor'] }))),
  field('Curtains', swatchRow('Curtains', CURTAINS, () => st.room.curtains, (id) => setRoom({ curtains: id as RoomStyle['curtains'] }))),
);
onSync(() => {
  const v = VIEWS.find((x) => x.id === st.room.view)!;
  setText(note(secRoom), `${v.icon} ${v.name}`);
});

// ───── character ─────
function setLook(patch: Partial<Appearance>) {
  st.look = normalizeProfile({ appearance: { ...st.look, ...patch } }).appearance;
  changed();
}
const lookMatch = () => CHARACTER_PRESETS.find((p) => (['skin', 'hair', 'hairColor', 'top'] as const).every((k) => p.appearance[k] === st.look[k]))?.id ?? null;
const presetRow = choiceRow(
  'Character preset',
  CHARACTER_PRESETS.map((p) => ({ id: p.id, label: h('span', { class: 'pg-person' }, avatarCanvas(p.appearance), p.appearance.name) })),
  lookMatch,
  (id) => setLook({ ...CHARACTER_PRESETS.find((p) => p.id === id)!.appearance }),
  'pg-people',
);
const nameInput = h('input', { type: 'text', class: 'pg-text', maxlength: '20', 'aria-label': 'Buddy name', autocomplete: 'off', spellcheck: 'false' });
nameInput.addEventListener('change', () => setLook({ name: nameInput.value }));
onSync(() => {
  if (document.activeElement !== nameInput) nameInput.value = st.look.name;
});
const topNote = h('p', { class: 'muted small pg-hint' });
onSync(() => {
  const shopTop = ['hoodie-green', 'hoodie-black', 'sweater'].find((id) => st.items.has(id));
  topNote.hidden = !shopTop;
  if (shopTop) setText(topNote, `The ${itemById(shopTop)!.name.toLowerCase()} from Items is covering this colour.`);
});
const secLook = section(
  'look',
  '🧑',
  'Character',
  false,
  field('Presets', presetRow),
  field('Name (used in their speech bubbles)', nameInput),
  field('Skin', swatchRow('Skin', SKIN_TONES, () => st.look.skin, (id) => setLook({ skin: id }))),
  field(
    'Hair style',
    choiceRow('Hair style', HAIR_STYLES.map((s) => ({ id: s.id, label: s.name })), () => st.look.hair, (id) => setLook({ hair: id })),
  ),
  field('Hair colour', swatchRow('Hair colour', HAIR_COLORS, () => st.look.hairColor, (id) => setLook({ hairColor: id }))),
  field('Hoodie', swatchRow('Hoodie colour', TOP_COLORS, () => st.look.top, (id) => setLook({ top: id })), topNote),
);
onSync(() => setText(note(secLook), st.look.name));

// ───── items ─────
/** Equip `id` into `set`: clears its slot and pulls in what it needs (PS5 → TV). */
function addItem(set: Set<string>, id: string) {
  const it = itemById(id);
  if (!it) return;
  for (const other of [...set]) {
    const o = itemById(other);
    if (other !== id && o && slotOf(o) === slotOf(it)) set.delete(other);
  }
  set.add(id);
  if (it.requires) {
    const req = itemById(it.requires);
    if (req && slotOf(req) !== slotOf(it)) addItem(set, req.id);
  }
}
function removeItem(set: Set<string>, id: string) {
  set.delete(id);
  for (const it of ITEMS) if (it.requires === id && set.has(it.id) && slotOf(it) !== slotOf(itemById(id)!)) set.delete(it.id);
}
function setItems(next: Set<string>) {
  st.items = next;
  changed();
}
function toggleItem(id: string) {
  const next = new Set(st.items);
  if (next.has(id)) removeItem(next, id);
  else addItem(next, id);
  setItems(next);
}
function itemChip(it: Item) {
  const tag = it.limited
    ? h('span', { class: 'pg-tag pg-tag-limited' }, it.limited.event)
    : it.achievement
      ? h('span', { class: 'pg-tag' }, '🏆 100 h')
      : null;
  const b = h(
    'button',
    {
      type: 'button',
      class: 'pg-item',
      'aria-pressed': 'false',
      title: `${it.name} — ${it.blurb}${it.limited ? ` (limited: ${it.limited.event}, ${it.limited.from} → ${it.limited.to})` : ''}${it.slot ? ` · one ${it.slot} at a time` : ''}`,
      onclick: () => toggleItem(it.id),
    },
    h('span', { class: 'pg-item-icon', 'aria-hidden': 'true' }, it.icon),
    h('span', { class: 'pg-item-text' }, h('span', { class: 'pg-item-name' }, it.name), tag),
  );
  onSync(() => b.setAttribute('aria-pressed', String(st.items.has(it.id))));
  return b;
}
function applyCombo(c: Combo) {
  const next = new Set<string>();
  for (const id of c.items) addItem(next, id);
  st.items = next;
  if (c.real) st.real = `${new Date().getFullYear()}-${c.real}`;
  if (c.w) st.w = c.w;
  if (c.moon !== undefined) st.moon = c.moon;
  if (c.season !== undefined) {
    const di = dayIndex();
    const year = Math.floor(di / (SEASON_DAYS * 4));
    const nd = year * SEASON_DAYS * 4 + c.season * SEASON_DAYS + 4;
    st.h = clamp(nd + (c.t ?? 0.3) - OFF, 0, MAX_H);
  }
  changed();
  if (c.real) toast(`${c.name}: ${realDate(st).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, ${SEASONS[c.season ?? 0].toLowerCase()} ${c.t && c.t > 0.5 ? 'night' : 'day'}`, c.icon);
}
const catBlocks = CATEGORIES.map((cat) => {
  const list = ITEMS.filter((i) => i.category === cat.id);
  const count = h('span', { class: 'muted small' });
  onSync(() => setText(count, `${list.filter((i) => st.items.has(i.id)).length}/${list.length}`));
  return h(
    'div',
    { class: 'pg-cat' },
    h('div', { class: 'pg-cat-head' }, h('b', null, `${cat.icon} ${cat.name}`), count),
    h('div', { class: 'pg-items' }, list.map(itemChip)),
  );
});
const secItems = section(
  'items',
  '🛍️',
  'Items',
  false,
  h(
    'div',
    { class: 'pg-btns' },
    btn('✨ Everything', () => setItems(everything(realDate(st).getMonth())), 'btn btn-primary btn-small'),
    btn('🧹 Nothing', () => setItems(new Set())),
  ),
  h('div', { class: 'pg-label' }, 'Curated rooms'),
  h('div', { class: 'pg-chips' }, COMBOS.map((c) => btn(`${c.icon} ${c.name}`, () => applyCombo(c), 'pg-chip'))),
  h('p', { class: 'muted small pg-hint' }, 'Items in the same slot (hats, glasses, tops, monitors) swap each other out, like in the shop. Limited items are tagged with their event.'),
  catBlocks,
);
onSync(() => setText(note(secItems), `${st.items.size} on`));

// ───── calendar ─────
const dateInput = h('input', { type: 'date', class: 'pg-text pg-date', 'aria-label': 'Real calendar date' });
dateInput.addEventListener('change', () => {
  st.real = DATE_RE.test(dateInput.value) ? (dateInput.value === todayKey() ? null : dateInput.value) : null;
  changed();
});
const seasonalOut = h('div', { class: 'pg-seasonal' });
let seasonalFor = '';
function setDate(mmdd: string | null) {
  st.real = mmdd ? `${new Date().getFullYear()}-${mmdd}` : null;
  changed();
}
const dateChips = choiceRow(
  'Calendar date',
  [{ id: 'today', label: '📅 Today' }, ...DATES.map((d) => ({ id: d.mmdd, label: `${d.icon} ${d.name}` }))],
  () => (st.real ? st.real.slice(5) : 'today'),
  (id) => setDate(id === 'today' ? null : id),
);
onSync(() => {
  if (document.activeElement !== dateInput) dateInput.value = st.real ?? todayKey();
  setText(note(secCal), realDate(st).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  if (seasonalFor === (st.real ?? todayKey())) return;
  seasonalFor = st.real ?? todayKey();
  const at = realDate(st).getTime();
  const inSeason = ITEMS.filter((i) => i.limited && isAvailable(i, at));
  seasonalOut.replaceChildren(
    inSeason.length
      ? h(
          'div',
          { class: 'pg-inline pg-wrap' },
          h('span', { class: 'small' }, `In the shop on this date: ${inSeason.map((i) => i.icon).join(' ')} (${inSeason[0].limited!.event})`),
          btn('Equip them', () => {
            const next = new Set(st.items);
            for (const i of inSeason) addItem(next, i.id);
            setItems(next);
          }, 'pg-chip'),
        )
      : h('span', { class: 'muted small' }, 'No limited-time items in the shop on this date.'),
  );
});
const secCal = section(
  'calendar',
  '📅',
  'Real calendar',
  false,
  h('p', { class: 'muted small pg-hint' }, 'The street hangs pumpkins in October; street and city put up fairy lights in December. The limited shop items follow the real date too.'),
  field('Date', dateInput),
  dateChips,
  seasonalOut,
);

// ───── sound ─────
function applySound() {
  audio.setEnabled({ sfx: soundOn, music: soundOn && sound.music, typing: soundOn, ambience: soundOn && sound.ambience });
  audio.setVolume(soundOn && !document.hidden ? sound.volume : 0);
}
function audioScene() {
  const sim = simTime(st.h * HOUR);
  return {
    studying: st.m === 'studying',
    onBreak: st.m === 'break' || st.m === 'paused',
    isNight: sim.isNight,
    season: sim.season,
    weather: currentWeather(),
    pets: PET_IDS.filter((p) => st.items.has(p)),
    view: st.room.view,
    timeOfDay: sim.t,
  };
}
function toggleSound() {
  soundOn = !soundOn;
  // unlock synchronously inside the tap (iOS)
  if (soundOn) void audio.unlock();
  applySound();
  audio.update(audioScene());
  changed({ url: false });
  if (soundOn) toast('Sound on — lo-fi, rain, waves, birds… tap things for little sounds', '🔊');
}
document.addEventListener('pointerdown', () => soundOn && void audio.unlock(), { capture: true });
document.addEventListener('visibilitychange', applySound);
const soundBtn = btn('', toggleSound);
onSync(() => {
  soundBtn.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off';
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.className = `btn btn-small ${soundOn ? 'btn-primary' : 'btn-ghost'}`;
});
const soundBtn2 = btn('', toggleSound);
onSync(() => {
  soundBtn2.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off';
  soundBtn2.setAttribute('aria-pressed', String(soundOn));
  soundBtn2.className = `pg-chip`;
});
const musicBtn = btn('🎵 Lo-fi music', () => {
  sound.music = !sound.music;
  applySound();
  changed({ url: false });
}, 'pg-chip');
const ambBtn = btn('🌧️ Ambience & world sounds', () => {
  sound.ambience = !sound.ambience;
  applySound();
  changed({ url: false });
}, 'pg-chip');
const volRange = h('input', { type: 'range', min: '0', max: '1', step: '0.05', class: 'pg-range', 'aria-label': 'Volume', value: String(sound.volume) });
volRange.addEventListener('input', () => {
  sound.volume = Number(volRange.value);
  applySound();
});
onSync(() => {
  musicBtn.setAttribute('aria-pressed', String(sound.music));
  ambBtn.setAttribute('aria-pressed', String(sound.ambience));
});
const secSound = section(
  'sound',
  '🎧',
  'Sound',
  false,
  h('p', { class: 'muted small pg-hint' }, 'The procedural soundscape follows the scene: the view, weather, time of day, season, pets and what he’s doing.'),
  h('div', { class: 'pg-chips' }, soundBtn2, musicBtn, ambBtn),
  field('Volume', h('div', { class: 'pg-inline' }, h('span', { 'aria-hidden': 'true' }, '🔈'), volRange, h('span', { 'aria-hidden': 'true' }, '🔊'))),
);
onSync(() => setText(note(secSound), soundOn ? 'On' : 'Off'));

// ───── share / surprise / reset ─────
const shareOut = h('div', { class: 'pg-share-out', hidden: true });
async function share() {
  const url = new URL(writeUrl(st), location.href).href;
  history.replaceState(null, '', writeUrl(st));
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Study Buddy playground', text: 'Look at this Study Buddy room 👀', url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — anyone who opens it sees this exact scene', '🔗');
    shareOut.hidden = true;
  } catch {
    const input = h('input', { type: 'text', class: 'pg-text', readonly: true, value: url, 'aria-label': 'Share link' });
    shareOut.replaceChildren(h('span', { class: 'small muted' }, 'Copy this link:'), input);
    shareOut.hidden = false;
    input.focus();
    input.select();
  }
}
const pickOne = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
function surprise() {
  const view = pickOne(VIEWS).id;
  const preset = ROOM_PRESETS.find((p) => p.room.view === view) ?? pickOne(ROOM_PRESETS);
  st.room = Math.random() < 0.5 ? { ...preset.room } : { view, wall: pickOne(WALLS).id, floor: pickOne(FLOORS).id, curtains: pickOne(CURTAINS).id };
  const look = pickOne(CHARACTER_PRESETS).appearance;
  st.look = Math.random() < 0.5 ? { ...look } : { ...look, hair: pickOne(HAIR_STYLES).id, hairColor: pickOne(HAIR_COLORS).id, top: pickOne(TOP_COLORS).id };
  st.h = Math.round(Math.random() * 160 * 100) / 100;
  st.w = Math.random() < 0.4 ? 'auto' : pickOne(WEATHERS);
  st.m = pickOne(['studying', 'studying', 'break', 'idle'] as Mode[]);
  const next = new Set<string>();
  for (const it of [...ITEMS].sort(() => Math.random() - 0.5)) if (Math.random() < 0.45) addItem(next, it.id);
  st.items = next;
  st.ev = null;
  changed();
  const night = simTime(st.h * HOUR).t >= 0.5;
  const options = [...SKY_KINDS, ...VIEW_EVENTS[view]].filter((k) => !EVENT_META[k].when || (EVENT_META[k].when === 'night') === night);
  window.setTimeout(() => fire(pickOne(options)), 250);
}
function reset() {
  st = defaults();
  timeOffset = 0;
  changed();
  history.replaceState(null, '', location.pathname);
  toast('Back to the default scene', '↺');
}

const toolbar = h(
  'div',
  { class: 'pg-toolbar' },
  soundBtn,
  btn('🎲 Surprise me', surprise),
  btn('🔗 Share this scene', () => void share(), 'btn btn-go btn-small'),
  btn('↺ Reset', reset, 'btn btn-ghost btn-small pg-reset'),
);

// ───── caption under the room ─────
function captionText(sim: SimTime, w: Weather) {
  const moon = st.moon ?? moonPhase(st.h * HOUR);
  const sky = sim.isNight ? (w === 'clear' ? MOON_ICONS[Math.round(moon * 8) % 8] : WEATHER_META[w].icon) : WEATHER_META[w].icon;
  return `${sky} ${sim.clock} · Day ${sim.day} · ${SEASON_ICONS[sim.season]} ${sim.seasonName} · Year ${sim.year} · ${WEATHER_META[w].name}${st.tl ? ' · ⏩' : ''}`;
}

// ───── layout ─────
const header = h(
  'header',
  { class: 'pg-header' },
  h(
    'div',
    { class: 'pg-head-row' },
    h('h1', { class: 'brand' }, h('span', { 'aria-hidden': 'true' }, '📚'), ' Study Buddy ', h('span', { class: 'pg-badge' }, 'Playground')),
    h(
      'a',
      { class: 'btn btn-primary btn-small pg-back', href: './', 'aria-label': 'Open the app' },
      h('span', { class: 'pg-back-long' }, 'Open the app'),
      h('span', { class: 'pg-back-short', 'aria-hidden': 'true' }, 'App'),
      h('span', { 'aria-hidden': 'true' }, ' →'),
    ),
  ),
  h('p', { class: 'muted pg-tagline' }, 'Explore every room, view, item and event — nothing here touches your real progress.'),
);
const controls = h('div', { class: 'pg-controls' }, secTime, secEvents, secWeather, secMode, secRoom, secLook, secItems, secCal, secSound);
const app = h(
  'div',
  { class: 'pg-app' },
  header,
  h(
    'main',
    { class: 'pg-layout' },
    h(
      'div',
      { class: 'pg-left' },
      stage,
      toolbar,
      shareOut,
      h(
        'p',
        { class: 'muted small pg-taps' },
        '🖐 Tap the buddy, the pets, their mug, the lamp, clock, plant or window. Shooting stars, balloons, UFOs and birds on the sill can be caught.',
      ),
    ),
    controls,
  ),
  h('footer', { class: 'pg-foot muted small' }, 'A sandbox for Study Buddy: scenes live only in this page and its link. ', h('a', { href: './' }, 'Back to studying'), '.'),
);
document.body.append(app, toasts);

wide.addEventListener('change', () => {
  for (const d of sections) d.open = wide.matches || d.dataset.phoneOpen === '1';
});

// ───────────────────────────── main loop ─────────────────────────────

let lastFrame = performance.now();
let lastUi = 0;
let lastAudio = 0;
let lastTlUrl = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (st.tl) {
    st.h += SPEEDS[st.tl - 1].perSec * dt;
    if (st.h > MAX_H) st.h -= MAX_H;
  }
  const scene = sceneAt(now / 1000 + timeOffset);
  try {
    renderer.render(scene);
  } catch (e) {
    console.error('[playground] render failed', e);
  }
  positionBubble(now);
  if (now - lastUi > 200) {
    lastUi = now;
    setText(caption, captionText(scene.sim, scene.weather));
    if (st.tl) {
      for (const f of tickers) f();
      // keep the link roughly current while the clock runs (cheap: a few times a minute)
      if (now - lastTlUrl > 5000) {
        lastTlUrl = now;
        history.replaceState(null, '', writeUrl(st));
      }
    }
  }
  if (soundOn && now - lastAudio > 1000) {
    lastAudio = now;
    audio.update(audioScene());
  }
}

changed({ url: false });
requestAnimationFrame(frame);

// a shared link can carry a world event: replay it once the window has drawn
if (st.ev) {
  const kind = st.ev;
  window.setTimeout(() => outside.forceEvent(kind, FORCE_AGE[kind] ?? 0), 400);
}

// for scripted checks / screenshots
(window as unknown as Record<string, unknown>).playground = {
  renderer,
  outside,
  get state() {
    return st;
  },
  fire,
  set(patch: Partial<State>) {
    st = { ...st, ...patch };
    changed();
  },
};
