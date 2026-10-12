// Dev-only page for previewing the room in any state:
// /lab.html?h=12.3&w=rain&m=studying&items=cat,rug&speed=1
import { RoomRenderer } from './render/room';
import { simTime } from './core/sim';
import { HOUR } from './core/time';
import type { Weather } from './core/weather';
import type { Mode } from './render/scene';
import { ITEMS } from './core/catalog';

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

const r = new RoomRenderer(document.getElementById('room') as HTMLCanvasElement, {
  onPet: (pet) => console.info('[lab] onPet', pet),
});
let last = performance.now();
function frame(now: number) {
  hours += (speed * (now - last)) / 1000;
  last = now;
  r.render({ time: freeze ? t0 : t0 + now / 1000, sim: simTime(hours * HOUR), weather, moon: Number(q.get('moon') ?? 0.5), mode, items });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { labReady: boolean }).labReady = true;
