import { Painter, W, H } from './pixel';
import { Outside, skyAt, type Sky } from './outside';
import { drawCharacter, poseFor, activityFor, MUG, type Pose, type Activity } from './character';
import { ITEM_LIST, type ArtCtx, type Layer } from './items';
import type { HitTarget } from './scene';
import { WIN, FLOOR_Y, DESK, CABINET, STAND_LIFT, mainMonitor, type RenderEvents, type RenderScene } from './scene';

const { x: WX, y: WY, w: WW, h: WH } = WIN;
const NIGHT_TINT = (a: number) => `rgba(14,18,52,${a})`;

export { mainMonitor };

const codeLines = (() => {
  let seed = 42;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cols = ['#7fd1b9', '#f2b134', '#c792ea', '#82aaff', '#e9e4da'];
  return Array.from({ length: 64 }, () => {
    const ind = ((r() * 3) | 0) * 3;
    const segs: [number, string][] = [];
    let n = 1 + ((r() * 3) | 0);
    while (n--) segs.push([2 + ((r() * 9) | 0), cols[(r() * 5) | 0]]);
    return { ind, segs };
  });
})();

/** Draws scrolling code into a screen rect. */
export function drawCode(p: Painter, x: number, y: number, w: number, h: number, time: number, typing: boolean, offset = 0) {
  const rows = Math.floor((h - 2) / 3);
  const scroll = typing ? Math.floor(time * 1.2) + offset : offset;
  const partial = typing ? (time * 1.2) % 1 : 1;
  p.g.save();
  p.g.beginPath();
  p.g.rect(x, y, w, h);
  p.g.clip();
  for (let i = 0; i < rows; i++) {
    const L = codeLines[(scroll + i) % codeLines.length];
    let cx = x + 2 + L.ind;
    const last = i === rows - 1;
    let budget = last ? Math.floor(partial * (w - 6)) : 999;
    for (const [sw, c] of L.segs) {
      const ww = Math.min(sw, budget);
      if (ww <= 0) break;
      p.rect(cx, y + 2 + i * 3, ww, 1, c);
      cx += sw + 2;
      budget -= sw + 2;
    }
    if (last && typing && ((time * 3) | 0) % 2) p.rect(cx, y + 1 + i * 3, 1, 3, '#e9e4da');
  }
  p.g.restore();
}

export class RoomRenderer {
  private p: Painter;
  private front: Painter;
  private outside = new Outside();
  private frontCanvas: HTMLCanvasElement;
  /** Current standing-desk height (px), eased toward its target. */
  private lift = 0;
  private lastTime = -1;

  constructor(canvas: HTMLCanvasElement, private events: RenderEvents = {}) {
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    this.p = new Painter(g);
    this.frontCanvas = document.createElement('canvas');
    this.frontCanvas.width = W;
    this.frontCanvas.height = H;
    this.front = new Painter(this.frontCanvas.getContext('2d')!);
  }

  setEvents(ev: RenderEvents) {
    this.events = ev;
  }

  /**
   * What's at logical pixel (x, y) of the 240x150 canvas, using the last rendered scene
   * (so moving pets / world events are hit where they currently are). TODO(room agent): implement.
   */
  hitTest(_x: number, _y: number): HitTarget | null {
    return null;
  }

  /** React to a tap on `target` (wave, purr, sip…) starting at animation time `time`. TODO(room agent). */
  interact(_target: HitTarget, _time: number): void {}

  /** Where to anchor a speech bubble for `target` (logical px, top-centre of the thing), or null if not visible. */
  anchor(_target: HitTarget | 'buddy'): { x: number; y: number } | null {
    return { x: 150, y: 52 };
  }

  render(s: RenderScene) {
    const p = this.p;
    const sky = skyAt(s.sim.t, s.weather);
    const night = 1 - sky.day;
    const act = activityFor(s);
    const pose = poseFor(s);
    const dt = this.lastTime < 0 ? 0 : Math.min(0.5, Math.max(0, s.time - this.lastTime));
    const target = act === 'stand' ? STAND_LIFT : 0;
    this.lift = this.lift < target ? Math.min(target, this.lift + dt * 9) : Math.max(target, this.lift - dt * 9);
    if (dt === 0 && this.lastTime < 0) this.lift = target;
    const lift = Math.round(this.lift);
    const prev = this.lastTime < 0 || s.time - this.lastTime > 1 || s.time < this.lastTime ? s.time : this.lastTime;
    this.lastTime = s.time;
    const ctx: ArtCtx = {
      night,
      sky,
      pose,
      mode: s.mode,
      act,
      lift,
      prevTime: prev,
      emit: (pet) => this.events.onPet?.(pet),
    };
    const layer = (l: Layer, painter: Painter = p) => {
      for (const [id, arts] of ITEM_LIST) if (s.items.has(id)) for (const art of arts) if (art.layer === l) art.draw(painter, s, ctx);
    };
    p.g.clearRect(0, 0, W, H);

    this.drawWallAndFloor(p, s);
    layer('wall');
    layer('floor');
    drawStarterPlant(p);
    this.drawDesk(p, s, lift);
    this.drawMonitorBezel(p, s, lift);
    layer('desk');
    this.drawDeskTop(p, s, pose, lift);

    if (night > 0) {
      p.g.fillStyle = NIGHT_TINT(night * 0.55);
      p.g.fillRect(0, 0, W, H);
    }
    this.outside.draw(p, s, sky, this.events);
    this.drawScreen(p, s, lift);
    layer('screen');

    // foreground (character, chair, pets) darkened only where drawn
    const f = this.front;
    f.g.clearRect(0, 0, W, H);
    layer('behind-char', f);
    drawCharacter(f, s, pose, act);
    this.drawChair(f, act === 'stand' ? 36 : 0);
    layer('front', f);
    if (night > 0) {
      f.g.globalCompositeOperation = 'source-atop';
      f.g.fillStyle = NIGHT_TINT(night * 0.55);
      f.g.fillRect(0, 0, W, H);
      f.g.globalCompositeOperation = 'source-over';
    }
    p.g.drawImage(this.frontCanvas, 0, 0);

    this.drawGlows(p, s, sky, act, lift);
    layer('glow');
    this.drawSteam(p, s, pose, lift);
    layer('top');
  }

  private drawWallAndFloor(p: Painter, s: RenderScene) {
    p.rect(0, 0, W, FLOOR_Y, '#d9c3a5');
    for (let x = 4; x < W; x += 10) p.rect(x, 0, 1, FLOOR_Y, '#d0b897');
    p.rect(0, 0, W, 3, '#c7ab86');
    p.rect(0, FLOOR_Y, W, H - FLOOR_Y, '#8b5a3c');
    for (let y = FLOOR_Y + 4, i = 0; y < H; y += 6, i++) {
      p.rect(0, y, W, 1, '#734a31');
      for (let x = (i % 2) * 20; x < W; x += 40) p.rect(x, y - 5, 1, 5, '#734a31');
    }
    p.rect(0, FLOOR_Y - 3, W, 4, '#efe3cf');
    p.rect(0, FLOOR_Y, W, 1, '#c9b89c');
    // window frame + sill
    p.rect(WX - 4, WY - 4, WW + 8, WH + 8, '#f4ede0');
    p.rect(WX - 4, WY + WH + 4, WW + 8, 1, '#b9ad98');
    p.rect(WX - 6, WY + WH + 2, WW + 12, 4, '#e8dcc6');
    p.rect(WX - 6, WY + WH + 6, WW + 12, 1, '#a99c86');
    // curtains + rod
    for (const [cx, dir] of [[WX - 9, 1], [WX + WW + 3, -1]] as const) {
      p.rect(cx, WY - 7, 7, WH + 14, '#b5484a');
      for (let y = WY - 7; y < WY + WH + 7; y++) if (y % 6 < 2) p.px(cx + (dir > 0 ? 5 : 1), y, '#9a3a3d');
    }
    p.rect(WX - 11, WY - 9, WW + 21, 2, '#6b4a33');
    drawClock(p, 112, 26, s.sim.t);
  }

  private drawDesk(p: Painter, s: RenderScene, lift: number) {
    const stand = s.items.has('standing-desk');
    const R = DESK.right;
    const top = DESK.top - lift;
    const { x: cx, y: cy, w: cw, h: ch } = CABINET;
    if (stand) {
      // sit-stand frame: telescoping steel columns on T-feet + a crossbar
      const steel = '#3b3d48';
      const steelHi = '#5a5d6b';
      for (const x of [92, 192]) {
        p.rect(x, top + 10, 3, 106 - top, steel);
        p.rect(x - 1, 104, 5, 13, steel);
        p.rect(x - 1, 104, 1, 13, steelHi);
        p.rect(x - 6, 117, 15, 3, '#2d2f38');
        p.rect(x - 6, 117, 15, 1, steelHi);
      }
      p.rect(95, top + 10, 97, 2, '#2d2f38');
    } else {
      p.rect(91, 92, 4, 28, '#6a4226');
      p.rect(91, 92, 1, 28, '#7a4e2c');
    }
    // drawer cabinet (a separate rolling unit when the desk is a standing one)
    p.rect(cx, cy, cw, ch, '#8a5a35');
    p.rect(cx, cy, cw, 1, stand ? '#a06b40' : '#6a4226');
    p.rect(cx, cy + 13, cw, 1, '#6a4226');
    p.rect(cx, cy, 1, ch, '#6a4226');
    p.rect(cx + cw - 1, cy, 1, ch, '#6a4226');
    p.rect(cx + 13, cy + 6, 6, 1, '#d9c3a5');
    p.rect(cx + 13, cy + 19, 6, 1, '#d9c3a5');
    if (stand) for (const x of [cx + 2, cx + cw - 4]) p.rect(x, cy + ch, 2, 2, '#2d2d35');
    else p.rect(cx, cy + ch, cw, 1, '#5a3a20');
    // desk top + front apron, with an end cap on the right
    p.rect(DESK.x, top, R - DESK.x, 6, '#b9834f');
    p.rect(DESK.x, top, R - DESK.x, 1, '#cf9963');
    p.rect(DESK.x, top + 6, R - DESK.x, 4, '#7a4e2c');
    p.rect(R - 2, top, 2, 10, '#8f5f36');
    p.rect(R - 1, top, 1, 10, '#6a4226');
    p.rect(DESK.x, top, 1, 10, '#a06b40');
    if (stand) {
      // little height controller on the front edge
      p.rect(100, top + 7, 7, 2, '#26272e');
      p.px(101, top + 7, '#5fbf77');
      p.px(105, top + 7, '#d9c3a5');
    }
  }

  private drawMonitorBezel(p: Painter, s: RenderScene, lift: number) {
    const m = mainMonitor(s);
    const y = m.y - lift;
    p.rect(m.x, y, m.w, m.h, '#24232d');
    p.rect(m.x, y, m.w, 1, '#34333f');
    p.rect(m.x + m.w / 2 - 3, y + m.h, 6, 3, '#24232d');
    p.rect(m.x + m.w / 2 - 9, DESK.top - lift, 18, 1, '#1a1a22');
  }

  private drawDeskTop(p: Painter, s: RenderScene, pose: Pose, lift: number) {
    if (!s.items.has('rgb-keyboard')) {
      p.rect(132, 83 - lift, 34, 3, '#c9c6cf');
      p.rect(132, 85 - lift, 34, 1, '#99969f');
    }
    if (pose !== 'sipping') {
      const x = MUG.x;
      const y = MUG.y - lift;
      p.rect(x, y, 8, 8, '#e9e4da');
      p.rect(x, y, 8, 1, '#5a3420');
      p.rect(x + 8, y + 2, 2, 1, '#e9e4da');
      p.rect(x + 9, y + 2, 1, 4, '#e9e4da');
      p.rect(x + 8, y + 5, 2, 1, '#e9e4da');
      p.rect(x + 2, y + 3, 4, 3, '#c0392b');
    }
  }

  private drawScreen(p: Painter, s: RenderScene, lift: number) {
    const m = mainMonitor(s);
    const typing = s.mode === 'studying';
    const x = m.x + 2;
    const y = m.y + 2 - lift;
    const w = m.w - 4;
    const h = m.h - 4;
    if (s.mode === 'idle' && s.sim.isNight && poseFor(s) === 'sleeping') {
      p.rect(x, y, w, h, '#0d1020'); // screen asleep
      return;
    }
    p.rect(x, y, w, h, typing ? '#1b2440' : '#22304f');
    if (s.mode === 'break') {
      // break screen: big friendly timer-ish bars
      p.rect(x + w / 2 - 8, y + h / 2 - 4, 16, 8, '#5fbf77');
      p.rect(x + w / 2 - 6, y + h / 2 - 2, 12, 4, '#1b2440');
      return;
    }
    drawCode(p, x, y, w, h, s.time, typing);
  }

  private drawChair(p: Painter, dx: number) {
    p.g.save();
    p.g.translate(dx, 0);
    p.rect(138, 93, 24, 20, '#33343d');
    p.rect(139, 94, 22, 1, '#4a4b57');
    p.rect(138, 112, 24, 2, '#26272e');
    p.rect(148, 114, 4, 10, '#26272e');
    p.rect(136, 123, 28, 2, '#26272e');
    p.rect(135, 125, 3, 2, '#111');
    p.rect(162, 125, 3, 2, '#111');
    p.rect(149, 125, 3, 2, '#111');
    p.g.restore();
  }

  private drawGlows(p: Painter, s: RenderScene, sky: Sky, act: Activity, lift: number) {
    const night = 1 - sky.day;
    const g = p.g;
    const m = mainMonitor(s);
    g.globalCompositeOperation = 'lighter';
    const screenOn = !(s.mode === 'idle' && s.sim.isNight && poseFor(s) === 'sleeping');
    if (screenOn) p.glow(m.x + m.w / 2, m.y + 16 - lift, 60, [90, 130, 220], (0.08 + 0.22 * night) * (act === 'desk' || act === 'stand' ? 1 : 0.7));
    if (sky.day > 0) {
      g.fillStyle = `rgba(255,240,200,${0.1 * sky.day * (s.weather === 'clear' ? 1 : 0.4)})`;
      g.beginPath();
      g.moveTo(WX, FLOOR_Y + 2);
      g.lineTo(WX + WW, FLOOR_Y + 2);
      g.lineTo(WX + WW + 30, H);
      g.lineTo(WX + 18, H);
      g.closePath();
      g.fill();
    }
    const flash = this.outside.lightning;
    if (flash > 0) {
      g.fillStyle = `rgba(200,210,255,${flash * 0.25})`;
      g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawSteam(p: Painter, s: RenderScene, pose: Pose, lift: number) {
    if (pose === 'sipping') return;
    for (let i = 0; i < 3; i++) {
      const k = (s.time * 0.6 + i / 3) % 1;
      p.px(MUG.x + 3 + Math.round(Math.sin(s.time * 2 + i * 2) * 1.5), MUG.y - lift - 2 - k * 10, `rgba(255,255,255,${0.5 * (1 - k)})`);
    }
  }
}

/** Wall clock: wooden rim, cream face, ticks, hands snapped to clean angles (sim time, 06:00 at sunrise). */
function drawClock(p: Painter, cx: number, cy: number, t: number) {
  p.disc(cx + 1, cy + 1, 9, '#c9ad88'); // soft shadow on the wall
  p.disc(cx, cy, 9, '#5a3a26');
  p.disc(cx, cy, 8, '#7a5236');
  p.disc(cx, cy, 7, '#f7f1e3');
  // rim highlight (top-left) + face shading (bottom-right)
  for (const [x, y] of [[-6, -6], [-5, -7], [-7, -5], [-4, -8], [-8, -4], [-3, -8], [-8, -3]]) p.px(cx + x, cy + y, '#9a6c48');
  for (const [x, y] of [[5, 4], [4, 5], [6, 3], [3, 6], [6, 2], [2, 6]]) p.px(cx + x, cy + y, '#e6dcc6');
  // ticks
  const tick = '#3a3340';
  p.rect(cx, cy - 6, 1, 2, tick);
  p.rect(cx, cy + 5, 1, 2, tick);
  p.rect(cx + 5, cy, 2, 1, tick);
  p.rect(cx - 6, cy, 2, 1, tick);
  for (let i = 1; i < 12; i++) {
    if (i % 3 === 0) continue;
    const a = (i / 12) * Math.PI * 2;
    p.px(cx + Math.round(Math.sin(a) * 6), cy - Math.round(Math.cos(a) * 6), '#b8ab96');
  }
  const day = (t * 24 + 6) % 24;
  const hrs = day % 12;
  const mins = (day % 1) * 60;
  // snap: hour hand to 1/24 turn, minute hand to 5-minute steps
  const ah = (Math.round((hrs / 12) * 24) / 24) * Math.PI * 2;
  const am = (Math.round((mins / 60) * 12) / 12) * Math.PI * 2;
  const hand = (a: number, len: number, c: string, thick: boolean) => {
    const ex = Math.round(Math.sin(a) * len);
    const ey = -Math.round(Math.cos(a) * len);
    p.line(cx, cy, cx + ex, cy + ey, c);
    if (thick) {
      if (Math.abs(ex) >= Math.abs(ey)) p.line(cx, cy + 1, cx + ex, cy + ey + 1, c);
      else p.line(cx + 1, cy, cx + ex + 1, cy + ey, c);
    }
  };
  hand(am, 5, '#3a3340', false);
  hand(ah, 3, '#3a3340', true);
  p.px(cx, cy, '#c0392b');
}

/** The starter plant (always there), drawn after floor items so it sits in front of the console. */
function drawStarterPlant(p: Painter) {
  p.rect(70, 112, 12, 12, '#c26a3d');
  p.rect(69, 111, 14, 2, '#a85a32');
  for (const [dx, dy, c] of [[-4, -8, '#4f9e48'], [3, -11, '#5aa64f'], [8, -7, '#4f9e48'], [1, -5, '#6cbf5e'], [-2, -12, '#6cbf5e']] as const) {
    p.line(76, 111, 76 + dx, 111 + dy, c);
    p.rect(76 + dx - 1, 111 + dy - 1, 3, 2, c);
  }
}
