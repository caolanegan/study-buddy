// Dev-only page for previewing the room in any state:
// /lab.html?h=12.3&w=rain&m=studying&items=cat,rug&speed=1
// look: &char=<preset id>&skin=&hair=&hairColor=&top=   room: &preset=<room preset id>&view=&wall=&floor=&curtains=
// real date for limited-time decor: &real=2026-10-31
import { RoomRenderer } from './render/room';
import { simTime } from './core/sim';
import { HOUR } from './core/time';
import type { Weather } from './core/weather';
import type { Mode } from './render/scene';
import { ITEMS } from './core/catalog';
import { CHARACTER_PRESETS, ROOM_PRESETS, normalizeProfile } from './core/profile';

const q = new URLSearchParams(location.search);
let hours = Number(q.get('h') ?? 0.2);
const weather = (q.get('w') ?? 'clear') as Weather;
const mode = (q.get('m') ?? 'studying') as Mode;
const all = q.get('items') === 'all';
// 'all' = one item per slot (triple monitors, beanie, default top); add=/del= tweak the set
const items = new Set(
  all
    ? ITEMS.filter((i) => !['cap', 'wizard-hat', 'crown', 'hoodie-green', 'hoodie-black', 'ultrawide', 'dual-monitor'].includes(i.id)).map((i) => i.id)
    : (q.get('items') ?? '').split(',').filter(Boolean),
);
for (const id of (q.get('add') ?? '').split(',').filter(Boolean)) items.add(id);
for (const id of (q.get('del') ?? '').split(',').filter(Boolean)) items.delete(id);
const freeze = q.has('freeze'); // hold the animation clock at t0 (for screenshots)
const speed = Number(q.get('speed') ?? 0); // sim hours per real second
const t0 = Number(q.get('t0') ?? 0); // animation clock offset (seconds)

const charPreset = CHARACTER_PRESETS.find((c) => c.id === q.get('char'))?.appearance ?? CHARACTER_PRESETS[0].appearance;
const roomPreset = ROOM_PRESETS.find((c) => c.id === q.get('preset'))?.room ?? ROOM_PRESETS[0].room;
const pick = (k: string) => q.get(k) ?? undefined;
const profile = normalizeProfile({
  appearance: { ...charPreset, ...Object.fromEntries(['name', 'skin', 'hair', 'hairColor', 'top'].filter((k) => q.has(k)).map((k) => [k, pick(k)])) },
  room: { ...roomPreset, ...Object.fromEntries(['view', 'wall', 'floor', 'curtains'].filter((k) => q.has(k)).map((k) => [k, pick(k)])) },
});
const realNow = q.has('real') ? new Date(q.get('real') + 'T12:00:00').getTime() : Date.now();

const r = new RoomRenderer(document.getElementById('room') as HTMLCanvasElement, {
  onPet: (pet) => console.info('[lab] onPet', pet),
  onWorldEvent: (k) => console.info('[lab] world event', k),
  onCatch: (k) => console.info('[lab] caught', k),
});
let last = performance.now();
function frame(now: number) {
  hours += (speed * (now - last)) / 1000;
  last = now;
  r.render({ time: freeze ? t0 : t0 + now / 1000, sim: simTime(hours * HOUR), weather, moon: Number(q.get('moon') ?? 0.5), mode, items, look: profile.appearance, room: profile.room, studiedHours: hours, realNow });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { labReady: boolean; lab: unknown }).labReady = true;
// for scripted interaction tests: lab.r.hitTest(x,y) / lab.r.interact(target, time)
(window as unknown as { lab: unknown }).lab = { r };
