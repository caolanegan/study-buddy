import { Painter, W, H, hash01, mixHex } from './pixel';
import { Outside, skyAt, type Sky } from './outside';
import {
  drawCharacter,
  poseFor,
  activityFor,
  reactPose,
  headAt,
  headTop,
  MUG,
  REACTION_LEN,
  TAP_REACTIONS,
  type Pose,
  type Activity,
  type CharReact,
  type ReactionKind,
} from './character';
import { ITEM_ART, ITEM_LIST, movingItemSpot, type ArtCtx, type Layer } from './items';
import type { HitTarget, WorldEventKind } from './scene';
import { WIN, FLOOR_Y, DESK, CABINET, STAND_LIFT, TV, mainMonitor, type RenderEvents, type RenderScene } from './scene';
import { wallOf, floorOf, curtainOf, type WallId, type FloorId, type CurtainId } from '../core/profile';

const { x: WX, y: WY, w: WW, h: WH } = WIN;
const NIGHT_TINT = (a: number) => `rgba(14,18,52,${a})`;

export { mainMonitor };

// ───────────────────────── pure helpers (unit-tested) ─────────────────────────

/** Studied hours at which the starter plant reaches each growth stage. */
export const PLANT_STAGES = [0, 3, 10, 25, 60, 150] as const;
export const PLANT_STAGE_NAMES = ['Sprout', 'Seedling', 'Leafy', 'Bushy', 'Budding', 'In bloom'] as const;
/** Growth stage 0 (sprout) .. 5 (blooming) for total studied hours. */
export function plantStage(hours: number): number {
  let st = 0;
  for (let i = 1; i < PLANT_STAGES.length; i++) if (hours >= PLANT_STAGES[i]) st = i;
  return st;
}

/** Seconds of studying it takes the buddy to finish a full mug. */
export const COFFEE_SECONDS = 45 * 60;

/** Pixel-art heart (5x4) rows. */
const HEART = ['.X.X.', 'XXXXX', '.XXX.', '..X..'];

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

// Hit areas that aren't worth a pixel test (kept in sync with items.ts art).
const TANK_BOX = { x: 17, y: 85, w: 20, h: 18 };
const TERR_BOX = { x: 162, y: 95, w: 28, h: 26 };
const CLOCK = { x: 112, y: 26 };
const PLANT = { x: 76, y: 111 };
/** Pets whose current position is found by redrawing them off-screen (works for any pet art). */
const MOVING_PETS = ['cat', 'dog', 'parrot', 'hamster', 'robot-vacuum'] as const;
/** Layers that make up a thing's body for hit testing (glows and overlays excluded). */
const SOLID_LAYERS: Layer[] = ['wall', 'floor', 'desk', 'screen', 'behind-char', 'front'];
/** How far the blinds hang down into the window (px). */
const BLINDS_H = 10;

type Pt = { x: number; y: number };

export class RoomRenderer {
  private p: Painter;
  private front: Painter;
  private outside = new Outside();
  private frontCanvas: HTMLCanvasElement;
  /** Current standing-desk height (px), eased toward its target. */
  private lift = 0;
  private lastTime = -1;

  // static wall / floor / curtains layer, cached per room style
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';
  // off-screen canvas for pixel-exact hit tests / pet positions
  private scratch: Painter | null = null;

  // the last rendered frame (for hit tests and anchors)
  private last: RenderScene | null = null;
  private lastAct: Activity = 'desk';
  private lastPose: Pose = 'typing';
  private lastCtx: ArtCtx | null = null;
  private lastTap: Pt = { x: 0, y: 0 };
  /** The catchable world event last hit (for its speech-bubble anchor). */
  private worldKind: WorldEventKind | null = null;
  private anchorCache = new Map<string, Pt | null>();
  private anchorTime = NaN;

  // reactions (all keyed on the scene animation clock)
  private charReact: { kind: ReactionKind; start: number } | null = null;
  private react: CharReact = { kind: 'wave', k: 0 };
  private taps = 0;
  /** Animation time each pet (or thing) was last tapped. */
  private petTap: Record<string, number> = {};
  private hearts: { x: number; y: number; start: number; n: number }[] = [];
  private beep = { x: 0, y: 0, start: -1e9 };
  private lastNight = 0;
  private plantTap = -1e9;
  private clockTap = -1e9;
  private tvTap = -1e9;
  private mugTap = -1e9;
  private lampOff = false;

  // coffee: full at the start of a session, drains while studying
  private coffee = 1;
  private prevMode: RenderScene['mode'] | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private events: RenderEvents = {},
  ) {
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

  /** How full their mug is (0..1). */
  get coffeeLevel() {
    return this.coffee;
  }

  /** Whether the desk lamp is switched on (tap the lamp to toggle). */
  get lampOn() {
    return !this.lampOff;
  }

  // ───────────────────────── interaction ─────────────────────────

  /**
   * What's at logical pixel (x, y) of the 240x150 canvas, using the last rendered scene
   * (so moving pets / world events are hit where they currently are). Front-most first.
   */
  hitTest(x: number, y: number): HitTarget | null {
    const s = this.last;
    if (!s) return null;
    this.lastTap = { x, y };
    try {
      const kind = this.outside.hitTest(x, y);
      if (kind) {
        this.worldKind = kind;
        return 'world-event';
      }
    } catch {
      /* outside not ready */
    }
    const it = s.items;
    if (it.has('ghost-plush')) {
      const g = movingItemSpot('ghost-plush', s, this.lastNight);
      if (g && x >= g.x - 6 && x <= g.x + 6 && y >= g.y - 15 && y <= g.y + 2) return 'ghost';
    }
    for (const id of MOVING_PETS) if (it.has(id) && this.itemHit(id, x, y, 3)) return id as HitTarget;
    const lift = Math.round(this.lift);
    const inBox = (b: { x: number; y: number; w: number; h: number }, pad = 0) => x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad;
    if (this.lastAct === 'desk' && this.lastPose !== 'sipping' && inBox({ x: MUG.x, y: MUG.y - lift - 2, w: 10, h: 10 }, 2)) return 'mug';
    if (this.characterHit(x, y)) return 'character';
    if (it.has('desk-lamp') && this.lampBoxes(s, lift).some((b) => inBox(b, 1))) return 'lamp';
    if (it.has('lizard') && inBox(TERR_BOX)) return 'lizard';
    if (it.has('fish-tank') && inBox(TANK_BOX, 1)) return 'fish-tank';
    if (it.has('tv') && inBox(TV, 1)) return 'tv';
    if (inBox(this.plantBox(s), 2)) return 'plant';
    if ((x - CLOCK.x) ** 2 + (y - CLOCK.y) ** 2 <= 11 * 11) return 'clock';
    if (inBox(WIN, 2)) return 'window';
    return null;
  }

  /**
   * React to a tap on `target` (wave, purr, sip…) starting at animation time `time`.
   * (x, y) is the tap point (only needed for 'world-event'; defaults to the last hitTest point).
   */
  interact(target: HitTarget, time: number, x?: number, y?: number): void {
    const s = this.last;
    switch (target) {
      case 'character': {
        const kind = TAP_REACTIONS[this.taps++ % TAP_REACTIONS.length];
        this.charReact = { kind, start: time };
        break;
      }
      case 'mug':
        this.mugTap = time;
        if (this.lastAct !== 'desk') break;
        if (this.coffee <= 0.02) this.coffee = 1; // empty: they top it up
        else this.coffee = Math.max(0, this.coffee - 0.08);
        this.charReact = { kind: 'sip', start: time };
        break;
      case 'window':
        this.charReact = { kind: 'look', start: time };
        break;
      case 'lamp':
        this.lampOff = !this.lampOff;
        break;
      case 'plant':
        this.plantTap = time;
        break;
      case 'clock':
        this.clockTap = time;
        break;
      case 'tv':
        this.tvTap = time;
        break;
      case 'world-event': {
        try {
          this.outside.catchAt(x ?? this.lastTap.x, y ?? this.lastTap.y, time);
        } catch {
          /* ignore */
        }
        break;
      }
      default: {
        // pets (keyed by item id for the art's tap hooks)
        this.petTap[target === 'ghost' ? 'ghost-plush' : target] = time;
        if (target === 'cat' || target === 'dog') this.events.onPet?.(target);
        const hearts = target === 'lizard' ? 1 : target === 'hamster' ? 2 : target === 'cat' || target === 'dog' ? 3 : 0;
        const a = s && (hearts || target === 'robot-vacuum') ? this.anchor(target) : null;
        if (a && hearts) {
          if (this.hearts.length > 6) this.hearts.shift();
          this.hearts.push({ x: a.x, y: a.y, start: time, n: hearts });
        }
        if (a && target === 'robot-vacuum') this.beep = { x: a.x, y: a.y, start: time };
      }
    }
  }

  /** Where to anchor a speech bubble for `target` (logical px, top-centre of the thing), or null if not visible. */
  anchor(target: HitTarget | 'buddy'): { x: number; y: number } | null {
    const s = this.last;
    if (!s) return null;
    if (this.anchorTime !== s.time) {
      this.anchorCache.clear();
      this.anchorTime = s.time;
    }
    const hit = this.anchorCache.get(target);
    if (hit !== undefined) return hit;
    const a = this.computeAnchor(s, target);
    this.anchorCache.set(target, a);
    return a;
  }

  private computeAnchor(s: RenderScene, target: HitTarget | 'buddy'): Pt | null {
    const lift = Math.round(this.lift);
    const it = s.items;
    switch (target) {
      case 'buddy':
      case 'character': {
        const h = headAt(s, this.lastPose, this.lastAct, this.activeReact(s.time));
        return { x: h.x, y: h.y - headTop(s) - 2 };
      }
      case 'mug':
        return { x: MUG.x + 4, y: MUG.y - lift - 2 };
      case 'fish-tank':
        return it.has('fish-tank') ? { x: TANK_BOX.x + TANK_BOX.w / 2, y: TANK_BOX.y } : null;
      case 'lizard':
        return it.has('lizard') ? { x: TERR_BOX.x + TERR_BOX.w / 2, y: TERR_BOX.y + 2 } : null;
      case 'tv':
        return it.has('tv') ? { x: TV.x + TV.w / 2, y: TV.y } : null;
      case 'lamp': {
        if (!it.has('desk-lamp')) return null;
        const b = this.lampBoxes(s, lift)[0];
        return { x: b.x + b.w / 2, y: b.y };
      }
      case 'plant': {
        const b = this.plantBox(s);
        return { x: b.x + b.w / 2, y: b.y };
      }
      case 'clock':
        return { x: CLOCK.x, y: CLOCK.y - 10 };
      case 'window':
        return { x: WX + WW / 2, y: WY + (curtainOf(s.room?.curtains ?? 'red').id === 'blinds' ? BLINDS_H + 2 : 4) };
      case 'world-event': {
        try {
          const a = this.outside.anchor(this.worldKind ?? undefined);
          if (a) return a;
        } catch {
          /* ignore */
        }
        return { ...this.lastTap };
      }
      case 'robot-vacuum':
      case 'parrot': {
        const v = it.has(target) ? movingItemSpot(target, s, this.lastNight) : null;
        return v ? { x: v.x, y: v.y - (target === 'parrot' ? 13 : 6) } : null;
      }
      case 'ghost': {
        const g = it.has('ghost-plush') ? movingItemSpot('ghost-plush', s, this.lastNight) : null;
        return g ? { x: g.x, y: g.y - 15 } : null;
      }
      default: {
        if (!it.has(target)) return null;
        const b = this.itemBounds(target);
        return b ? { x: Math.round((b.x0 + b.x1) / 2), y: b.y0 } : null;
      }
    }
  }

  /** The running character reaction at `time` (reused object), or null. */
  private activeReact(time: number): CharReact | null {
    const r = this.charReact;
    if (!r) return null;
    const k = time - r.start;
    if (k < 0 || k >= REACTION_LEN[r.kind]) return null;
    this.react.kind = r.kind;
    this.react.k = k;
    return this.react;
  }

  private scratchPainter(): Painter {
    if (!this.scratch) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      this.scratch = new Painter(c.getContext('2d', { willReadFrequently: true })!);
    }
    const g = this.scratch.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    return this.scratch;
  }

  /** Redraws one item's solid layers off-screen as it was last frame. */
  private drawItemAlone(id: string): Painter | null {
    const s = this.last;
    const arts = ITEM_ART[id];
    if (!s || !arts || !this.lastCtx) return null;
    const sp = this.scratchPainter();
    const ctx: ArtCtx = { ...this.lastCtx, prevTime: s.time, emit: () => {} };
    for (const art of arts) if (SOLID_LAYERS.includes(art.layer)) art.draw(sp, s, ctx);
    return sp;
  }

  private opaqueNear(sp: Painter, x: number, y: number, r: number) {
    const x0 = Math.max(0, Math.round(x) - r);
    const y0 = Math.max(0, Math.round(y) - r);
    const w = Math.min(W, Math.round(x) + r + 1) - x0;
    const h = Math.min(H, Math.round(y) + r + 1) - y0;
    if (w <= 0 || h <= 0) return false;
    const d = sp.g.getImageData(x0, y0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 100) return true;
    return false;
  }

  private itemHit(id: string, x: number, y: number, r: number) {
    const sp = this.drawItemAlone(id);
    return !!sp && this.opaqueNear(sp, x, y, r);
  }

  private itemBounds(id: string) {
    const sp = this.drawItemAlone(id);
    if (!sp) return null;
    const d = sp.g.getImageData(0, 0, W, H).data;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (d[(y * W + x) * 4 + 3] > 100) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  private characterHit(x: number, y: number) {
    const s = this.last;
    if (!s) return false;
    const act = this.lastAct;
    // the chair back counts as the buddy (it hides their lower back)
    if (act === 'desk' && x >= 136 && x < 164 && y >= 93 && y < 114) return true;
    const sp = this.scratchPainter();
    drawCharacter(sp, s, this.lastPose, act, this.activeReact(s.time));
    return this.opaqueNear(sp, x, y, 2);
  }

  private lampBoxes(s: RenderScene, lift: number) {
    return s.items.has('triple-monitor')
      ? [{ x: 93, y: 41 - lift, w: 11, h: 7 }, { x: 87, y: 47 - lift, w: 10, h: 36 }]
      : [{ x: 101, y: 56 - lift, w: 10, h: 7 }, { x: 94, y: 60 - lift, w: 14, h: 23 }];
  }

  private plantBox(s: RenderScene) {
    const top = [104, 98, 96, 92, 81, 80][plantStage(s.studiedHours ?? 0)];
    return { x: 66, y: top, w: 20, h: 125 - top };
  }

  // ───────────────────────── render ─────────────────────────

  render(s: RenderScene) {
    const p = this.p;
    const sky = skyAt(s.sim.t, s.weather);
    const night = 1 - sky.day;
    const act = activityFor(s);
    const dt = this.lastTime < 0 ? 0 : Math.min(0.5, Math.max(0, s.time - this.lastTime));
    // coffee: fresh mug when a session starts, drains while they study
    if (s.mode === 'studying' && this.prevMode !== null && this.prevMode !== 'studying' && this.prevMode !== 'paused' && this.prevMode !== 'break') this.coffee = 1;
    if (s.mode === 'studying') this.coffee = Math.max(0, this.coffee - dt / COFFEE_SECONDS);
    this.prevMode = s.mode;
    const react = this.activeReact(s.time);
    let pose = reactPose(react, poseFor(s, this.coffee));
    if (act !== 'desk' && pose === 'sipping') pose = poseFor(s, this.coffee);
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
      petTap: this.petTap,
    };
    this.last = s;
    this.lastNight = night;
    this.lastAct = act;
    this.lastPose = pose;
    this.lastCtx = ctx;
    const lampOff = this.lampOff;
    const layer = (l: Layer, painter: Painter = p) => {
      for (const [id, arts] of ITEM_LIST)
        if (s.items.has(id))
          for (const art of arts) {
            if (art.layer !== l) continue;
            if (lampOff && id === 'desk-lamp' && (l === 'screen' || l === 'glow')) continue;
            art.draw(painter, s, ctx);
          }
    };
    p.g.clearRect(0, 0, W, H);

    p.g.drawImage(this.background(s), 0, 0);
    drawClock(p, CLOCK.x, CLOCK.y, s.sim.t, this.spin(s.time));
    layer('wall');
    layer('floor');
    drawStarterPlant(p, plantStage(s.studiedHours ?? 0), s.time, s.time - this.plantTap);
    this.drawDesk(p, s, lift);
    this.drawMonitorBezel(p, s, lift);
    layer('desk');
    this.drawDeskTop(p, s, pose, lift);

    if (night > 0) {
      p.g.fillStyle = NIGHT_TINT(night * 0.55);
      p.g.fillRect(0, 0, W, H);
    }
    this.outside.draw(p, s, sky, this.events);
    this.drawScreen(p, s, lift, pose);
    layer('screen');
    this.drawTvFlip(p, s, act);

    // foreground (blinds, sill decor, character, chair, pets) darkened only where drawn
    const f = this.front;
    f.g.clearRect(0, 0, W, H);
    if (curtainOf(s.room?.curtains ?? 'red').id === 'blinds') drawBlinds(f, s.room.curtains);
    drawSillDecor(f, s.sim.season);
    layer('behind-char', f);
    drawCharacter(f, s, pose, act, react);
    this.drawChair(f, act === 'stand' ? 36 : 0);
    layer('front', f);
    if (night > 0) {
      f.g.globalCompositeOperation = 'source-atop';
      f.g.fillStyle = NIGHT_TINT(night * 0.55);
      f.g.fillRect(0, 0, W, H);
      f.g.globalCompositeOperation = 'source-over';
    }
    p.g.drawImage(this.frontCanvas, 0, 0);

    this.drawGlows(p, s, sky, act, lift, pose);
    layer('glow');
    this.drawSteam(p, s, pose, lift);
    layer('top');
    this.drawReactions(p, s);
  }

  /** Wall, floor, baseboard, window frame and curtains — cached per room style. */
  private background(s: RenderScene): HTMLCanvasElement {
    const room = s.room ?? { wall: 'cream-stripe', floor: 'honey-wood', curtains: 'red', view: 'street' };
    const key = `${room.wall}|${room.floor}|${room.curtains}`;
    if (!this.bg || key !== this.bgKey) {
      if (!this.bg) {
        this.bg = document.createElement('canvas');
        this.bg.width = W;
        this.bg.height = H;
      }
      const bp = new Painter(this.bg.getContext('2d')!);
      bp.g.clearRect(0, 0, W, H);
      paintRoom(bp, room.wall, room.floor, room.curtains);
      this.bgKey = key;
    }
    return this.bg;
  }

  /** Clock-hand spin after a tap (whole turns, so it lands back on the right time). */
  private spin(time: number) {
    const k = (time - this.clockTap) / 1.4;
    if (k < 0 || k >= 1) return 0;
    const e = k * k * (3 - 2 * k);
    return e * Math.PI * 4;
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
      p.rect(x + 8, y + 2, 2, 1, '#e9e4da');
      p.rect(x + 9, y + 2, 1, 4, '#e9e4da');
      p.rect(x + 8, y + 5, 2, 1, '#e9e4da');
      p.rect(x + 2, y + 3, 4, 3, '#c0392b');
      p.rect(x + 7, y + 1, 1, 7, '#d3ccbf');
      // looking into the mug: a full mug shows coffee right at the rim, then less and less
      const c = this.coffee;
      p.rect(x + 1, y, 6, 1, c > 0.6 ? '#5a3420' : '#b8ac99');
      if (c > 0.6) p.px(x + 2, y, '#7a4a2c');
      else if (c > 0.25) p.rect(x + 2, y, 4, 1, '#5a3420');
      else if (c > 0) p.rect(x + 3, y, 2, 1, '#5a3420');
    }
  }

  private drawScreen(p: Painter, s: RenderScene, lift: number, pose: Pose) {
    const m = mainMonitor(s);
    const typing = s.mode === 'studying';
    const x = m.x + 2;
    const y = m.y + 2 - lift;
    const w = m.w - 4;
    const h = m.h - 4;
    if (s.mode === 'idle' && s.sim.isNight && pose === 'sleeping') {
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

  /** Tapping the TV flicks it on for a moment (static, then colour bars). */
  private drawTvFlip(p: Painter, s: RenderScene, act: Activity) {
    const k = s.time - this.tvTap;
    if (!s.items.has('tv') || k < 0 || k > 2.6 || act === 'lounge' || act === 'game') return;
    const x = TV.x + 2;
    const y = TV.y + 2;
    const w = TV.w - 4;
    const h = TV.h - 5;
    if (k < 0.35 || k > 2.4) {
      const f = Math.floor(s.time * 30);
      p.rect(x, y, w, h, '#3a3a44');
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx += 2) if (hash01(xx, yy, f) > 0.55) p.rect(x + xx, y + yy, 2, 1, hash01(yy, xx, f) > 0.5 ? '#d8d8e0' : '#8a8a96');
    } else {
      const bars = ['#e9e4da', '#f2d034', '#55c1c9', '#5fbf77', '#d65fa5', '#d9534f', '#3f5fbf'];
      const bw = w / bars.length;
      bars.forEach((c, i) => p.rect(x + Math.round(i * bw), y, Math.ceil(bw), h - 3, c));
      p.rect(x, y + h - 3, w, 3, '#1d1d24');
      p.rect(x + 3, y + h - 2, 6, 1, '#e9e4da');
    }
    p.px(TV.x + TV.w - 4, TV.y + TV.h - 2, '#5fbf77');
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

  private drawGlows(p: Painter, s: RenderScene, sky: Sky, act: Activity, lift: number, pose: Pose) {
    const night = 1 - sky.day;
    const g = p.g;
    const m = mainMonitor(s);
    g.globalCompositeOperation = 'lighter';
    const screenOn = !(s.mode === 'idle' && s.sim.isNight && pose === 'sleeping');
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
    // winter candle on the sill
    if (s.sim.season === 3) {
      const fl = Math.sin(s.time * 13) * 0.5 + Math.sin(s.time * 7.3) * 0.5;
      p.glow(SILL.x + 2, SILL.y - 9, 12, [255, 180, 90], (0.05 + 0.25 * night) * (0.85 + 0.15 * fl));
    }
    if (this.tvFlipOn(s, act)) p.glow(TV.x + TV.w / 2, TV.y + 8, 26, [180, 200, 255], 0.05 + 0.2 * night);
    const flash = this.outside.lightning;
    if (flash > 0) {
      g.fillStyle = `rgba(200,210,255,${flash * 0.25})`;
      g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over';
    if (s.sim.season === 3) {
      // candle flame (stays bright at night)
      const fy = SILL.y - 10 + (Math.sin(s.time * 11) > 0.6 ? -1 : 0);
      p.px(SILL.x + 2, fy, '#ffd166');
      p.px(SILL.x + 2, fy + 1, '#fff1c4');
      if (Math.sin(s.time * 9) > 0) p.px(SILL.x + 2, fy - 1, 'rgba(255,209,102,0.6)');
    }
  }

  private tvFlipOn(s: RenderScene, act: Activity) {
    const k = s.time - this.tvTap;
    return s.items.has('tv') && k >= 0 && k <= 2.6 && act !== 'lounge' && act !== 'game';
  }

  private drawSteam(p: Painter, s: RenderScene, pose: Pose, lift: number) {
    if (pose === 'sipping' || this.coffee <= 0) return;
    const a = 0.25 + 0.25 * Math.min(1, this.coffee * 2);
    // a tap on the mug sends up a little extra puff
    const puff = s.time - this.mugTap < 1.2 && s.time >= this.mugTap ? 1 : 0;
    for (let i = 0; i < 3 + puff * 2; i++) {
      const k = (s.time * (0.6 + puff * 0.6) + i / 3) % 1;
      p.px(MUG.x + 3 + Math.round(Math.sin(s.time * 2 + i * 2) * 1.5), MUG.y - lift - 2 - k * 10, `rgba(255,255,255,${(a * 2 * (1 - k)).toFixed(2)})`);
    }
  }

  /** Floating hearts over petted pets, plant sparkles, fish-tank bubbles. */
  private drawReactions(p: Painter, s: RenderScene) {
    const t = s.time;
    for (const h of this.hearts) {
      const k = t - h.start;
      if (k < 0 || k > 2.2) continue;
      for (let i = 0; i < h.n; i++) {
        const kk = k - i * 0.35;
        if (kk < 0 || kk > 1.4) continue;
        const a = kk < 0.2 ? kk / 0.2 : 1 - Math.max(0, (kk - 0.9) / 0.5);
        const x = Math.round(h.x - 2 + (i - (h.n - 1) / 2) * 5 + Math.sin(kk * 6 + i) * 1.2);
        const y = Math.round(h.y - 6 - kk * 10);
        drawHeart(p, x, y, a);
      }
    }
    // robot vacuum: happy beeps
    const bk = t - this.beep.start;
    if (bk >= 0 && bk < 1.6 && Math.floor(bk * 5) % 2 === 0) {
      const { x, y } = this.beep;
      for (const [dx, dy] of [[-4, -1], [-3, -3], [0, -4], [3, -3], [4, -1]]) p.px(x + dx, y + dy - Math.floor(bk * 3), '#5fd0ff');
    }
    // fish tank: a burst of bubbles
    const fk = t - (this.petTap['fish-tank'] ?? -1e9);
    if (s.items.has('fish-tank') && fk >= 0 && fk < 2) {
      for (let i = 0; i < 7; i++) {
        const kk = fk * 1.4 - i * 0.12;
        if (kk < 0 || kk > 1) continue;
        const bx = TANK_BOX.x + 4 + ((i * 5) % 12) + Math.round(Math.sin(t * 6 + i) * 0.7);
        const by = TANK_BOX.y + 14 - kk * 11;
        p.px(bx, by, `rgba(235,250,255,${(0.95 * (1 - kk * 0.6)).toFixed(2)})`);
        if (i % 3 === 0) p.px(bx + 1, by - 1, 'rgba(235,250,255,0.5)');
      }
    }
    // plant: sparkles twinkle around the leaves
    const pk = t - this.plantTap;
    if (pk >= 0 && pk < 1.6) {
      const b = this.plantBox(s);
      for (let i = 0; i < 3; i++) {
        const kk = pk - i * 0.25;
        if (kk < 0 || kk > 0.9) continue;
        const r = kk < 0.45 ? 1 : 0;
        const x = b.x + 3 + ((i * 7 + 2) % (b.w - 4));
        const y = b.y + 2 + ((i * 5) % 8);
        drawSparkle(p, x, y, r);
      }
    }
  }
}

function drawHeart(p: Painter, x: number, y: number, a: number) {
  if (a <= 0) return;
  const g = p.g;
  const prev = g.globalAlpha;
  g.globalAlpha = Math.min(1, a);
  for (let r = 0; r < HEART.length; r++)
    for (let c = 0; c < 5; c++) if (HEART[r][c] === 'X') p.px(x + c, y + r, r === 0 || (r === 1 && c === 1) ? '#ff9fb4' : '#ff5c7f');
  p.px(x + 1, y + 1, '#ffe0e8');
  g.globalAlpha = prev;
}

function drawSparkle(p: Painter, x: number, y: number, r: number) {
  p.px(x, y, '#ffffff');
  const c = '#fff1a8';
  for (let i = 1; i <= r + 1; i++) {
    p.px(x - i, y, c);
    p.px(x + i, y, c);
    p.px(x, y - i, c);
    p.px(x, y + i, c);
  }
}

// ───────────────────────── static room (walls / floors / window) ─────────────────────────

interface Trim {
  board: string;
  boardHi: string;
  line: string;
  frame: string;
  frameShade: string;
  sill: string;
  sillShade: string;
}
const WHITE_FRAME = { frame: '#f4ede0', frameShade: '#b9ad98', sill: '#e8dcc6', sillShade: '#a99c86' };
const TRIMS: Record<WallId, Trim> = {
  'cream-stripe': { board: '#efe3cf', boardHi: '#f7efe1', line: '#c9b89c', ...WHITE_FRAME },
  sage: { board: '#eef0e2', boardHi: '#f7f8ef', line: '#b6bfa6', ...WHITE_FRAME },
  'dusk-blue': { board: '#e8ebf3', boardHi: '#f5f7fb', line: '#a7b0c6', ...WHITE_FRAME },
  blush: { board: '#f7ebe6', boardHi: '#fcf5f2', line: '#d2b3ab', ...WHITE_FRAME },
  brick: { board: '#5a3b2b', boardHi: '#73503b', line: '#3a261b', frame: '#2f3138', frameShade: '#1d1e24', sill: '#3f4149', sillShade: '#24252b' },
  'wood-panel': { board: '#6b4a33', boardHi: '#835c40', line: '#45301f', frame: '#7a5236', frameShade: '#4f3524', sill: '#8a5f3c', sillShade: '#5a3e28' },
  'night-stars': { board: '#2b3256', boardHi: '#c9b46a', line: '#1c2140', ...WHITE_FRAME },
  'mint-check': { board: '#f4f1e6', boardHi: '#fbf9f2', line: '#bfd0c4', ...WHITE_FRAME },
};

function paintRoom(p: Painter, wallId: WallId, floorId: FloorId, curtainId: CurtainId) {
  paintWall(p, wallId);
  paintFloor(p, floorId);
  const T = TRIMS[wallOf(wallId).id];
  // baseboard
  p.rect(0, FLOOR_Y - 3, W, 4, T.board);
  p.rect(0, FLOOR_Y - 3, W, 1, T.boardHi);
  p.rect(0, FLOOR_Y, W, 1, T.line);
  // window frame + sill
  p.rect(WX - 4, WY - 4, WW + 8, WH + 8, T.frame);
  p.rect(WX - 4, WY + WH + 4, WW + 8, 1, T.frameShade);
  p.rect(WX - 6, WY + WH + 2, WW + 12, 4, T.sill);
  p.rect(WX - 6, WY + WH + 2, WW + 12, 1, mixHex(T.sill, '#ffffff', 0.25));
  p.rect(WX - 6, WY + WH + 6, WW + 12, 1, T.sillShade);
  if (wallId === 'wood-panel') {
    // cabin frame: wood grain + corner pegs
    for (let x = WX - 3; x < WX + WW + 3; x += 9) p.rect(x, WY - 3, 4, 1, T.frameShade);
    for (let y = WY; y < WY + WH; y += 11) p.rect(WX - 3, y, 1, 4, T.frameShade);
  }
  const cur = curtainOf(curtainId);
  if (cur.id === 'blinds') return; // blinds are drawn over the view (front layer)
  const [c0, c1, c2] = cur.colors;
  // curtains + rod
  for (const [cx, dir] of [
    [WX - 9, 1],
    [WX + WW + 3, -1],
  ] as const) {
    p.rect(cx, WY - 7, 7, WH + 14, c0);
    for (let y = WY - 7; y < WY + WH + 7; y++) if (y % 6 < 2) p.px(cx + (dir > 0 ? 5 : 1), y, c1);
    p.rect(dir > 0 ? cx + 1 : cx + 5, WY - 6, 1, WH + 12, c2);
    p.rect(cx, WY + WH + 6, 7, 1, c1); // hem
  }
  p.rect(WX - 11, WY - 9, WW + 21, 2, '#6b4a33');
  p.px(WX - 12, WY - 9, '#4a3324');
  p.px(WX + WW + 10, WY - 9, '#4a3324');
}

/** Wooden blinds: headrail + slats over the top of the window, with a pull cord. */
function drawBlinds(p: Painter, id: CurtainId) {
  const [c0, c1, c2] = curtainOf(id).colors;
  const x = WX - 1;
  const w = WW + 2;
  p.rect(x - 1, WY - 3, w + 2, 3, c1);
  p.rect(x - 1, WY - 3, w + 2, 1, c2);
  for (let y = WY; y < WY + BLINDS_H - 2; y += 3) {
    p.rect(x, y, w, 2, c0);
    p.rect(x, y, w, 1, c2);
    p.rect(x, y + 2, w, 1, mixHex(c1, '#2a1d16', 0.35));
  }
  p.rect(x, WY + BLINDS_H - 2, w, 2, c1); // bottom rail
  p.rect(x, WY + BLINDS_H - 2, w, 1, c0);
  // ladder strings + pull cord with a little wooden handle
  for (const lx of [x + 12, x + w - 13]) for (let y = WY; y < WY + BLINDS_H - 2; y += 3) p.px(lx, y + 2, '#e9e1cf');
  p.rect(x + w - 5, WY + BLINDS_H, 1, 14, '#e9e1cf');
  p.rect(x + w - 6, WY + BLINDS_H + 14, 3, 3, c1);
  p.px(x + w - 6, WY + BLINDS_H + 14, c2);
}

function paintWall(p: Painter, id: WallId) {
  const wall = wallOf(id);
  const [c0, c1, c2] = wall.colors;
  const B = FLOOR_Y; // wall bottom
  p.rect(0, 0, W, B, c0);
  switch (wall.pattern) {
    case 'stripes':
      if (wall.id === 'blush') {
        for (let x = 3; x < W; x += 12) {
          p.rect(x, 0, 3, B, c1);
          p.rect(x + 1, 0, 1, B, c2);
        }
        for (let x = 9; x < W; x += 12) for (let y = 6; y < B; y += 8) p.px(x, y, mixHex(c0, '#ffffff', 0.35));
      } else for (let x = 4; x < W; x += 10) p.rect(x, 0, 1, B, c1);
      p.rect(0, 0, W, 3, c2);
      break;
    case 'plain': {
      // soft plaster mottling + a wainscot panel below a chair rail
      for (let y = 3; y < 82; y += 2) for (let x = (y >> 1) & 1; x < W; x += 2) if (hash01(x, y, 3) < 0.07) p.px(x, y, c1);
      p.rect(0, 84, W, B - 84, c1);
      for (let x = 6; x < W; x += 30) {
        p.rect(x, 87, 24, 1, c2);
        p.rect(x, 87, 1, 12, c2);
        p.rect(x + 1, 98, 23, 1, mixHex(c1, '#ffffff', 0.18));
        p.rect(x + 24, 88, 1, 11, mixHex(c1, '#ffffff', 0.18));
      }
      p.rect(0, 82, W, 2, '#e3e8d6');
      p.rect(0, 84, W, 1, c2);
      p.rect(0, 0, W, 3, c2);
      p.rect(0, 3, W, 1, '#c3cdb4');
      break;
    }
    case 'dots': {
      const dot = mixHex(c0, '#eef1ff', 0.35);
      const tiny = mixHex(c0, '#2a3150', 0.2);
      for (let y = 6, r = 0; y < B - 4; y += 8, r++)
        for (let x = (r % 2) * 6 + 2; x < W; x += 12) {
          p.rect(x, y, 2, 2, dot);
          p.px(x + 1, y + 1, c0 === dot ? c1 : mixHex(dot, c0, 0.4));
          p.px(x + 6, y + 4, tiny);
        }
      p.rect(0, 0, W, 3, c2);
      break;
    }
    case 'brick': {
      const mortar = c2;
      p.rect(0, 0, W, B, mortar);
      const tones = [c0, c1, mixHex(c0, '#c27a5f', 0.55), mixHex(c0, '#6e3a2c', 0.35), c0];
      for (let row = 0, y = 3; y < B; row++, y += 5) {
        const off = row % 2 ? -6 : 0;
        for (let bx = off, i = 0; bx < W; bx += 12, i++) {
          const v = hash01(i, row, 11);
          const c = tones[Math.floor(v * tones.length)];
          p.rect(bx, y, 11, 4, c);
          p.rect(bx, y, 11, 1, mixHex(c, '#ffffff', 0.12));
          p.px(bx + 10, y + 3, mixHex(c, '#2a1d16', 0.3));
          if (hash01(i, row, 5) < 0.5) p.px(bx + 2 + Math.floor(hash01(i, row, 6) * 7), y + 2, mixHex(c, '#2a1d16', 0.25));
        }
        p.rect(0, y + 4, W, 1, mixHex(mortar, c1, 0.2));
      }
      p.rect(0, 0, W, 3, '#4a3426');
      p.rect(0, 3, W, 1, '#2f2119');
      break;
    }
    case 'planks': {
      const seam = mixHex(c1, '#2a1d16', 0.4);
      for (let row = 0, y = 3; y < B; row++, y += 7) {
        const v = hash01(row, 1, 21);
        const c = v < 0.33 ? c0 : v < 0.66 ? mixHex(c0, c2, 0.45) : mixHex(c0, c1, 0.5);
        p.rect(0, y, W, 6, c);
        p.rect(0, y, W, 1, mixHex(c, '#ffffff', 0.1));
        p.rect(0, y + 6, W, 1, seam);
        // butt joints between boards
        let x = Math.floor(hash01(row, 2, 21) * 50);
        while (x < W) {
          p.rect(x, y, 1, 6, seam);
          x += 55 + Math.floor(hash01(row, x, 22) * 40);
        }
        // grain streaks
        for (let i = 0; i < 9; i++) {
          const gx = Math.floor(hash01(row, i, 23) * W);
          const gy = y + 2 + Math.floor(hash01(i, row, 24) * 3);
          p.rect(gx, gy, 4 + Math.floor(hash01(gx, gy, 25) * 9), 1, c1);
        }
        // a knot or two
        if (hash01(row, 3, 26) < 0.7) {
          const kx = 10 + Math.floor(hash01(row, 4, 26) * (W - 20));
          const ky = y + 2;
          p.rect(kx - 2, ky, 5, 2, c1);
          p.rect(kx - 1, ky, 3, 2, mixHex(c1, '#2a1d16', 0.45));
          p.px(kx, ky, '#3a2618');
          p.px(kx - 3, ky + 1, c1);
          p.px(kx + 3, ky, c1);
        }
      }
      p.rect(0, 0, W, 3, '#5a3e28');
      p.rect(0, 3, W, 1, '#45301f');
      break;
    }
    case 'stars': {
      const gold = c2;
      const dim = mixHex(c2, c0, 0.45);
      const faint = mixHex(c2, c0, 0.7);
      // a subtle wallpaper texture of vertical bands
      for (let x = 0; x < W; x += 16) p.rect(x, 0, 8, B, mixHex(c0, c1, 0.5));
      for (let ty = 0, r = 0; ty < B; ty += 18, r++)
        for (let tx = (r % 2) * 12 - 12; tx < W; tx += 24) {
          // 4-point star
          const sx = tx + 5;
          const sy = ty + 6;
          p.px(sx, sy, gold);
          p.px(sx - 1, sy, dim);
          p.px(sx + 1, sy, dim);
          p.px(sx, sy - 1, dim);
          p.px(sx, sy + 1, dim);
          p.px(tx + 16, ty + 12, gold);
          p.px(tx + 11, ty + 2, faint);
          p.px(tx + 20, ty + 4, faint);
          p.px(tx + 2, ty + 14, faint);
          if ((tx / 24 + r) % 3 === 0) {
            // tiny crescent moon
            p.rect(tx + 17, ty + 3, 2, 3, dim);
            p.px(tx + 16, ty + 4, dim);
            p.px(tx + 18, ty + 3, c0);
          }
        }
      p.rect(0, 0, W, 3, c1);
      p.rect(0, 3, W, 1, faint);
      break;
    }
    case 'check': {
      for (let x = 0; x < W; x += 8) p.rect(x, 0, 3, B, c1);
      for (let y = 4; y < B; y += 8) {
        p.rect(0, y, W, 3, c1);
        for (let x = 0; x < W; x += 8) p.rect(x, y, 3, 3, c2);
      }
      p.rect(0, 0, W, 3, '#f4f1e6');
      p.rect(0, 3, W, 1, c2);
      break;
    }
  }
}

function paintFloor(p: Painter, id: FloorId) {
  const fl = floorOf(id);
  const [c0, c1, c2] = fl.colors;
  const Y = FLOOR_Y;
  p.rect(0, Y, W, H - Y, c0);
  switch (fl.id) {
    case 'blue-carpet': {
      for (let y = Y + 1; y < H; y++)
        for (let x = 0; x < W; x++) {
          const v = hash01(x, y, 31);
          if (v < 0.16) p.px(x, y, c1);
          else if (v > 0.9) p.px(x, y, c2);
        }
      p.rect(0, Y + 1, W, 2, mixHex(c0, '#1d2540', 0.25)); // soft shadow under the baseboard
      break;
    }
    case 'checker': {
      const tw = 12;
      const th = 8;
      for (let r = 0, y = Y + 1; y < H; r++, y += th)
        for (let c = 0, x = 0; x < W; c++, x += tw) {
          const dark = (r + c) % 2 === 1;
          p.rect(x, y, tw, th, dark ? c1 : c0);
          p.rect(x, y, tw, 1, dark ? mixHex(c1, '#ffffff', 0.1) : mixHex(c0, '#ffffff', 0.35));
          if (!dark) p.rect(x, y + th - 1, tw, 1, c2);
        }
      break;
    }
    case 'tatami': {
      const heri = '#3f4a3a';
      const heriHi = '#56634f';
      const mh = 15;
      for (let r = 0, y = Y + 1; y < H; r++, y += mh) {
        const off = r % 2 ? -18 : 0;
        for (let i = 0, x = off; x < W; i++, x += 36) {
          const tone = hash01(i, r, 41) < 0.5 ? c0 : mixHex(c0, c2, 0.45);
          p.rect(x, y, 36, mh, tone);
          for (let yy = y + 3; yy < y + mh - 2; yy += 2) p.rect(x + 1, yy, 34, 1, mixHex(tone, c1, 0.35));
          p.rect(x + 35, y, 1, mh, c1); // short-side seam
          for (let k = 0; k < 6; k++) p.px(x + 2 + Math.floor(hash01(i, k, r) * 32), y + 3 + Math.floor(hash01(k, i, r) * (mh - 5)), c2);
        }
        // cloth borders along the long sides
        p.rect(0, y, W, 2, heri);
        p.rect(0, y, W, 1, heriHi);
      }
      break;
    }
    case 'terracotta': {
      const grout = mixHex(c2, '#ead8c4', 0.55);
      p.rect(0, Y, W, H - Y, grout);
      const tones = [c0, c1, c2, mixHex(c0, c1, 0.5), c0];
      for (let r = 0, y = Y + 1; y < H; r++, y += 9)
        for (let c = 0, x = 0; x < W; c++, x += 13) {
          const t = tones[Math.floor(hash01(c, r, 51) * tones.length)];
          p.rect(x, y, 12, 8, t);
          p.rect(x, y, 12, 1, mixHex(t, '#ffffff', 0.15));
          p.px(x + 1 + Math.floor(hash01(r, c, 52) * 10), y + 3 + Math.floor(hash01(c, r, 53) * 4), mixHex(t, '#5a2a1a', 0.3));
          p.rect(x + 11, y + 1, 1, 7, mixHex(t, '#5a2a1a', 0.15));
        }
      break;
    }
    default: {
      // wood planks (honey / dark)
      for (let y = Y + 4, i = 0; y < H; y += 6, i++) {
        for (let x = (i % 2) * 20 - 40, j = 0; x < W; x += 40, j++) {
          if (hash01(i, j, 61) < 0.3) p.rect(x + 1, y - 5, 39, 5, mixHex(c0, c2, 0.4));
          for (let k = 0; k < 2; k++) {
            const gx = x + 3 + Math.floor(hash01(j, k, i + 62) * 30);
            p.rect(gx, y - 3 + k * 2, 3 + Math.floor(hash01(k, j, i + 63) * 6), 1, k ? c2 : c1);
          }
        }
        p.rect(0, y, W, 1, c1);
        for (let x = (i % 2) * 20; x < W; x += 40) p.rect(x, y - 5, 1, 5, c1);
      }
    }
  }
}

// ───────────────────────── clock, plant, sill ─────────────────────────

/** Wall clock: wooden rim, cream face, ticks, hands snapped to clean angles (sim time, 06:00 at sunrise). */
function drawClock(p: Painter, cx: number, cy: number, t: number, spin = 0) {
  p.disc(cx + 1, cy + 1, 9, 'rgba(60,40,30,0.22)'); // soft shadow on the wall
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
  const ah = (Math.round((hrs / 12) * 24) / 24) * Math.PI * 2 + spin * 0.5;
  const am = (Math.round((mins / 60) * 12) / 12) * Math.PI * 2 + spin;
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

const LEAF = ['#3f8a3f', '#4f9e48', '#5aa64f', '#6cbf5e'];
const LEAF_DARK = '#2f6b33';
const STEM = '#3f7a34';
type Leaf = [number, number, number]; // tip dx, tip dy, colour index
const SMALL_LEAVES: Leaf[][] = [
  [[0, -3, 2]],
  [[-3, -5, 1], [3, -6, 2], [0, -8, 3]],
  // the original starter plant
  [[-4, -8, 1], [3, -11, 2], [8, -7, 1], [1, -5, 3], [-2, -12, 3]],
];
// bushy: leaf tufts around a leafy mass
const BUSH_TUFTS: Leaf[] = [[-9, -4, 1], [9, -5, 1], [-8, -10, 2], [8, -11, 2], [-4, -15, 2], [3, -16, 3], [0, -13, 3], [-5, -8, 3], [5, -8, 3]];
// tall: leaves along the stem: height, side, colour
const STEM_LEAVES: [number, number, number][] = [[-4, -1, 0], [-7, 1, 1], [-11, -1, 1], [-14, 1, 2], [-18, -1, 2], [-21, 1, 3]];
const FLOWERS: [number, number, string][][] = [[], [], [], [], [[0, -27, '#f19cbf']], [[0, -28, '#f19cbf'], [-7, -21, '#f2d034'], [7, -24, '#ece6f7'], [-8, -13, '#f19cbf'], [6, -15, '#f2d034']]];

/** A plump pixel leaf at (x, y) pointing left (-1) or right (1). */
function leafAt(p: Painter, x: number, y: number, dir: number, c: string) {
  p.rect(dir > 0 ? x : x - 3, y, 4, 2, c);
  p.px(x + dir * 4, y, c);
  p.px(x + dir * (dir > 0 ? 0 : 0), y + 1, LEAF_DARK);
  p.px(x + dir * 2, y, LEAF[3]);
}

function flowerAt(p: Painter, x: number, y: number, c: string) {
  p.rect(x - 1, y - 2, 3, 1, c);
  p.rect(x - 2, y - 1, 5, 3, c);
  p.rect(x - 1, y + 2, 3, 1, c);
  p.px(x, y, '#f2b134');
  p.px(x - 1, y - 1, '#ffffff');
}

/** The starter plant (always there): grows with total hours studied; rustles when tapped. */
function drawStarterPlant(p: Painter, stage: number, t: number, tapK: number) {
  const { x: X, y: Y } = PLANT;
  const big = stage >= 3 ? 1 : 0;
  // pot (a bigger one once it's grown)
  p.rect(X - 6 - big, Y + 1, 12 + big * 2, 12, '#c26a3d');
  p.rect(X - 7 - big, Y, 14 + big * 2, 2, '#a85a32');
  p.rect(X - 5 - big, Y + 2, 1, 10, '#d17c4c');
  p.rect(X + 4 + big, Y + 2, 1, 10, '#ad5c33');
  p.rect(X - 6 - big, Y + 1, 12 + big * 2, 1, '#4a3020'); // soil
  const rustle = tapK >= 0 && tapK < 1.2 ? Math.sin(tapK * 30) * 2 * (1 - tapK / 1.2) : 0;
  const breeze = Math.sin(t * 0.7) > 0.85 ? 1 : 0;
  const sway = (dy: number) => Math.round((rustle + breeze) * Math.min(1, -dy / 10));
  if (stage <= 2) {
    for (const [tx, ty, ci] of SMALL_LEAVES[stage]) {
      const c = LEAF[ci];
      const ex = X + tx + sway(ty);
      p.line(X, Y, ex, Y + ty, c);
      if (stage === 0) {
        p.rect(ex - 2, Y + ty, 2, 1, LEAF[3]);
        p.rect(ex + 1, Y + ty - 1, 2, 1, LEAF[2]);
      } else p.rect(ex - 1, Y + ty - 1, 3, 2, c);
    }
    return;
  }
  if (stage === 3) {
    const s1 = sway(-8);
    const s2 = sway(-14);
    p.ellipse(X, Y - 6, 9, 6, LEAF[0]);
    p.ellipse(X - 1 + s1, Y - 8, 7, 5, LEAF[1]);
    p.ellipse(X + 1 + s2, Y - 11, 5, 3, LEAF[2]);
    for (const [tx, ty, ci] of BUSH_TUFTS) {
      const x = X + tx + sway(ty);
      p.rect(x - 1, Y + ty - 1, 3, 2, LEAF[ci]);
      p.px(x, Y + ty - 1, LEAF[Math.min(3, ci + 1)]);
    }
    for (const [dx, dy] of [[-4, -4], [3, -6], [-1, -9], [5, -3], [-6, -7]]) p.px(X + dx + sway(dy), Y + dy, LEAF_DARK);
    return;
  }
  // tall (4) / blooming (5): a sturdy stem with leaves, a leafy base and flowers
  const top = stage === 4 ? -26 : -27;
  p.ellipse(X, Y - 2, 7, 3, LEAF[0]);
  for (let i = 0; i > top; i--) {
    const x = X + sway(i);
    p.rect(x, Y + i, 2, 1, STEM);
  }
  for (const [h, side, ci] of STEM_LEAVES) leafAt(p, X + sway(h) + (side > 0 ? 2 : -1), Y + h, side, LEAF[ci]);
  if (stage === 5) {
    // side branches carrying more blooms
    p.line(X + sway(-12), Y - 10, X - 7 + sway(-21), Y - 20, STEM);
    p.line(X + 1 + sway(-14), Y - 13, X + 7 + sway(-24), Y - 23, STEM);
    leafAt(p, X - 5 + sway(-17), Y - 17, -1, LEAF[2]);
    leafAt(p, X + 6 + sway(-19), Y - 19, 1, LEAF[3]);
  }
  for (const [fx, fy, fc] of FLOWERS[stage]) flowerAt(p, X + fx + sway(fy) + (fx === 0 ? 1 : 0), Y + fy, fc);
}

/** Seasonal knick-knack on the right end of the windowsill (sim season). */
const SILL = { x: 55, y: WY + WH + 4 };
function drawSillDecor(p: Painter, season: number) {
  const { x, y } = SILL;
  if (season === 0) {
    // spring: a flower in a cup
    p.rect(x, y - 4, 5, 4, '#f3ead8');
    p.rect(x, y - 4, 5, 1, '#d8ccb6');
    p.px(x + 5, y - 3, '#f3ead8');
    p.px(x + 5, y - 2, '#f3ead8');
    p.rect(x + 2, y - 8, 1, 4, '#4f9e48');
    p.px(x + 3, y - 6, '#5aa64f');
    p.px(x + 1, y - 9, '#f19cbf');
    p.px(x + 3, y - 9, '#f19cbf');
    p.px(x + 2, y - 10, '#f19cbf');
    p.px(x + 2, y - 8, '#f19cbf');
    p.px(x + 2, y - 9, '#f2d034');
  } else if (season === 1) {
    // summer: a seashell and a pebble
    p.rect(x + 1, y - 1, 3, 1, '#e8b49a');
    p.rect(x, y - 3, 6, 2, '#f2c4a8');
    p.rect(x + 1, y - 4, 4, 1, '#f2c4a8');
    for (const dx of [1, 3]) p.rect(x + dx, y - 4, 1, 3, '#d99a80');
    p.px(x + 5, y - 2, '#d99a80');
    p.rect(x + 7, y - 2, 3, 2, '#9aa7b0');
    p.px(x + 7, y - 2, '#c3cdd4');
  } else if (season === 2) {
    // autumn: a little pumpkin and an acorn
    p.ellipse(x + 3, y - 2, 4, 2, '#e07b39');
    p.px(x + 1, y - 3, '#c25f2a');
    p.rect(x + 3, y - 4, 1, 3, '#c25f2a');
    p.px(x + 5, y - 3, '#c25f2a');
    p.px(x + 2, y - 4, '#f29a5a');
    p.rect(x + 3, y - 6, 1, 2, '#5a6b2a');
    p.px(x + 4, y - 6, '#7a8b3a');
    p.rect(x + 8, y - 4, 3, 1, '#6b4a33');
    p.rect(x + 8, y - 3, 3, 2, '#b07a40');
    p.px(x + 9, y - 5, '#6b4a33');
  } else {
    // winter: a candle (flame drawn bright later) and a mini pine
    p.rect(x, y - 1, 5, 1, '#b9ad98');
    p.rect(x + 1, y - 7, 3, 6, '#f3ead8');
    p.rect(x + 3, y - 7, 1, 6, '#ded3c0');
    p.px(x + 2, y - 8, '#3a2a20');
    const g = '#2f6b3f';
    p.px(x + 9, y - 9, g);
    p.rect(x + 8, y - 8, 3, 2, g);
    p.rect(x + 7, y - 6, 5, 2, g);
    p.rect(x + 6, y - 4, 7, 2, '#2a5e37');
    p.px(x + 8, y - 7, '#5aa64f');
    p.px(x + 10, y - 5, '#d9534f');
    p.px(x + 8, y - 3, '#f2d034');
    p.rect(x + 9, y - 2, 1, 2, '#6b4a33');
    p.px(x + 9, y - 10, '#f2d034');
  }
}
