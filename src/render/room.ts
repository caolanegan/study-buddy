import { Painter, W, H } from './pixel';
import { Outside, skyAt, type Sky } from './outside';
import { drawCharacter, poseFor, MUG, type Pose } from './character';
import { ITEM_ART, type ArtCtx, type Layer } from './items';
import { WIN, FLOOR_Y, DESK, type RenderEvents, type RenderScene } from './scene';

const { x: WX, y: WY, w: WW, h: WH } = WIN;
const NIGHT_TINT = (a: number) => `rgba(14,18,52,${a})`;

/** Monitor geometry for the default / ultrawide setups. */
export function mainMonitor(s: RenderScene) {
  return s.items.has('ultrawide') ? { x: 116, y: 50, w: 70, h: 30 } : { x: 126, y: 48, w: 46, h: 32 };
}

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

  render(s: RenderScene) {
    const p = this.p;
    const sky = skyAt(s.sim.t, s.weather);
    const night = 1 - sky.day;
    const pose = poseFor(s);
    const ctx: ArtCtx = { night, sky, pose, mode: s.mode };
    const layer = (l: Layer, painter: Painter = p) => {
      for (const id of s.items) for (const art of ITEM_ART[id] ?? []) if (art.layer === l) art.draw(painter, s, ctx);
    };
    p.g.clearRect(0, 0, W, H);

    this.drawWallAndFloor(p, s);
    layer('wall');
    layer('floor');
    this.drawDesk(p);
    this.drawMonitorBezel(p, s);
    layer('desk');
    this.drawDeskTop(p, s, pose);

    if (night > 0) {
      p.g.fillStyle = NIGHT_TINT(night * 0.55);
      p.g.fillRect(0, 0, W, H);
    }
    this.outside.draw(p, s, sky, this.events);
    this.drawScreen(p, s);
    layer('screen');

    // foreground (character, chair, pets) darkened only where drawn
    const f = this.front;
    f.g.clearRect(0, 0, W, H);
    layer('behind-char', f);
    drawCharacter(f, s, pose);
    this.drawChair(f);
    layer('front', f);
    if (night > 0) {
      f.g.globalCompositeOperation = 'source-atop';
      f.g.fillStyle = NIGHT_TINT(night * 0.55);
      f.g.fillRect(0, 0, W, H);
      f.g.globalCompositeOperation = 'source-over';
    }
    p.g.drawImage(this.frontCanvas, 0, 0);

    this.drawGlows(p, s, sky);
    layer('glow');
    this.drawSteam(p, s, pose);
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
    // wall clock (sim time)
    const ccx = 112;
    const ccy = 26;
    p.disc(ccx, ccy, 8, '#3a3340');
    p.disc(ccx, ccy, 7, '#f7f1e3');
    const hrs = (s.sim.t * 24 + 6) % 12;
    const mins = ((s.sim.t * 24 + 6) % 1) * 60;
    const a1 = (hrs / 12) * 2 * Math.PI;
    const a2 = (mins / 60) * 2 * Math.PI;
    p.line(ccx, ccy, ccx + Math.sin(a1) * 4, ccy - Math.cos(a1) * 4, '#3a3340');
    p.line(ccx, ccy, ccx + Math.sin(a2) * 6, ccy - Math.cos(a2) * 6, '#c0392b');
    // starter plant
    p.rect(70, 112, 12, 12, '#c26a3d');
    p.rect(69, 111, 14, 2, '#a85a32');
    for (const [dx, dy, c] of [[-4, -8, '#4f9e48'], [3, -11, '#5aa64f'], [8, -7, '#4f9e48'], [1, -5, '#6cbf5e'], [-2, -12, '#6cbf5e']] as const) {
      p.line(76, 111, 76 + dx, 111 + dy, c);
      p.rect(76 + dx - 1, 111 + dy - 1, 3, 2, c);
    }
  }

  private drawDesk(p: Painter) {
    p.rect(DESK.x, DESK.top, W - DESK.x, 6, '#b9834f');
    p.rect(DESK.x, DESK.top, W - DESK.x, 1, '#cf9963');
    p.rect(DESK.x, DESK.top + 6, W - DESK.x, 4, '#7a4e2c');
    p.rect(91, 92, 4, 28, '#6a4226');
    p.rect(206, 92, 34, 26, '#8a5a35');
    p.rect(206, 92, 34, 1, '#6a4226');
    p.rect(206, 105, 34, 1, '#6a4226');
    p.rect(206, 92, 1, 26, '#6a4226');
    p.rect(220, 98, 6, 1, '#d9c3a5');
    p.rect(220, 111, 6, 1, '#d9c3a5');
  }

  private drawMonitorBezel(p: Painter, s: RenderScene) {
    const m = mainMonitor(s);
    p.rect(m.x, m.y, m.w, m.h, '#24232d');
    p.rect(m.x + m.w / 2 - 3, m.y + m.h, 6, 3, '#24232d');
    p.rect(m.x + m.w / 2 - 9, DESK.top, 18, 1, '#1a1a22');
  }

  private drawDeskTop(p: Painter, s: RenderScene, pose: Pose) {
    if (!s.items.has('rgb-keyboard')) {
      p.rect(132, 83, 34, 3, '#c9c6cf');
      p.rect(132, 85, 34, 1, '#99969f');
    }
    if (pose !== 'sipping') {
      const { x, y } = MUG;
      p.rect(x, y, 8, 8, '#e9e4da');
      p.rect(x, y, 8, 1, '#5a3420');
      p.rect(x + 8, y + 2, 2, 1, '#e9e4da');
      p.rect(x + 9, y + 2, 1, 4, '#e9e4da');
      p.rect(x + 8, y + 5, 2, 1, '#e9e4da');
      p.rect(x + 2, y + 3, 4, 3, '#c0392b');
    }
  }

  private drawScreen(p: Painter, s: RenderScene) {
    const m = mainMonitor(s);
    const typing = s.mode === 'studying';
    const x = m.x + 2;
    const y = m.y + 2;
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

  private drawChair(p: Painter) {
    p.rect(138, 93, 24, 20, '#33343d');
    p.rect(139, 94, 22, 1, '#4a4b57');
    p.rect(138, 112, 24, 2, '#26272e');
    p.rect(148, 114, 4, 10, '#26272e');
    p.rect(136, 123, 28, 2, '#26272e');
    p.rect(135, 125, 3, 2, '#111');
    p.rect(162, 125, 3, 2, '#111');
    p.rect(149, 125, 3, 2, '#111');
  }

  private drawGlows(p: Painter, s: RenderScene, sky: Sky) {
    const night = 1 - sky.day;
    const g = p.g;
    const m = mainMonitor(s);
    g.globalCompositeOperation = 'lighter';
    const screenOn = !(s.mode === 'idle' && s.sim.isNight && poseFor(s) === 'sleeping');
    if (screenOn) p.glow(m.x + m.w / 2, m.y + 16, 60, [90, 130, 220], 0.08 + 0.22 * night);
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

  private drawSteam(p: Painter, s: RenderScene, pose: Pose) {
    if (pose === 'sipping') return;
    for (let i = 0; i < 3; i++) {
      const k = (s.time * 0.6 + i / 3) % 1;
      p.px(MUG.x + 3 + Math.round(Math.sin(s.time * 2 + i * 2) * 1.5), MUG.y - 2 - k * 10, `rgba(255,255,255,${0.5 * (1 - k)})`);
    }
  }
}
