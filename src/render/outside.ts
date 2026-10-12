// Everything seen through the window: one of five views (street, seaside, city, countryside, forest), each
// seasonal / day-night / all-weather, plus a shared sky, weather, glass effects and random world events.
//
// Layering per frame (all window-local, clipped to the glass):
//   sky gradient → stars / milky way / sun & moon → clouds → view sky things → sky events (balloon, kites,
//   fireworks, UFO, shooting stars…) → scenery depths (each hazed + night-tinted, lights drawn on top)
//   → fog → rain / snow / leaves → lightning → bird on the sill → drops / condensation / frost on the glass.
//
// Catchable events — public API for RoomRenderer (coordinates are logical 240x150 canvas px):
//   outside.hitTest(x, y): WorldEventKind | null
//       What catchable thing (shooting star, balloon, bird on the sill, UFO) is at (x, y) as last drawn,
//       with a generous ~6px margin. Null if nothing / outside the window. Use it to return 'world-event'.
//   outside.catchAt(x, y, time): WorldEventKind | null
//       Catches it: the star bursts into sparkles, the bird flutters off (leaving a feather), the balloon's
//       passenger waves, the UFO zips away. Fires ev.onCatch(kind) once; a caught thing can't be caught again.
//   outside.anchor(kind?): {x, y} | null — where a visible catchable is (for a speech bubble).
//   outside.forceEvent(kind, age = 0): boolean — debug: start an event now (age = seconds already elapsed).
import { Painter } from './pixel';
import { WIN, type RenderEvents, type RenderScene, type WorldEventKind } from './scene';
import type { ViewId } from '../core/profile';
import { Depth, type View, type ViewCtx } from './views/common';
import { SkyPainter, skyAt, type Sky } from './views/sky';
import { WeatherFx } from './views/weather';
import { EventDirector } from './views/events';
import { QUIET_AT_START, REPORT_GAP, START_GRACE } from './views/schedule';
import { StreetView } from './views/street';
import { SeasideView } from './views/seaside';
import { CityView } from './views/city';
import { CountrysideView } from './views/countryside';
import { ForestView } from './views/forest';

export { skyAt, type Sky };

const { x: WX, y: WY, w: WW, h: WH } = WIN;

const STARS: Record<ViewId, number> = { street: 30, seaside: 56, city: 14, countryside: 64, forest: 64 };
const MILKY: Record<ViewId, boolean> = { street: false, seaside: true, city: false, countryside: true, forest: true };

export class Outside {
  private skyP = new SkyPainter();
  private fx = new WeatherFx();
  private director = new EventDirector();
  private views = new Map<ViewId, View>();
  private depth: Depth | null = null;
  private last = -1;
  private ev: RenderEvents = {};
  private reported = new Map<WorldEventKind, number>();
  private monthAt = -1e15;
  private month = 0;
  private viewId: ViewId = 'street';
  private ready = false;
  private start = 0;
  private c: ViewCtx = {
    s: null as unknown as RenderScene,
    sky: null as unknown as Sky,
    time: 0,
    dt: 0,
    night: 0,
    season: 0,
    weather: 'clear',
    snowy: false,
    wet: false,
    open: true,
    month: 0,
    orbX: 0,
    orbY: 0,
    orbA: 0,
    t: 0,
    ev: {},
    report: (kind) => this.report(kind),
  };

  private view(id: ViewId): View {
    let v = this.views.get(id);
    if (!v) {
      v =
        id === 'seaside' ? new SeasideView()
        : id === 'city' ? new CityView()
        : id === 'countryside' ? new CountrysideView()
        : id === 'forest' ? new ForestView()
        : new StreetView();
      this.views.set(id, v);
    }
    return v;
  }

  private report(kind: WorldEventKind) {
    if (QUIET_AT_START.includes(kind) && this.c.time - this.start < START_GRACE) return;
    const last = this.reported.get(kind);
    const gap = REPORT_GAP[kind] ?? 45;
    if (last !== undefined && this.c.time - last < gap && this.c.time >= last) return;
    this.reported.set(kind, this.c.time);
    this.ev.onWorldEvent?.(kind);
  }

  draw(p: Painter, s: RenderScene, sky: Sky, ev: RenderEvents) {
    if (this.last < 0 || s.time < this.last - 1) this.start = s.time;
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, s.time - this.last));
    this.last = s.time;
    this.ev = ev;
    const viewId: ViewId = s.room?.view ?? 'street';
    this.viewId = viewId;
    const view = this.view(viewId);
    if (Math.abs(s.realNow - this.monthAt) > 60_000) {
      this.monthAt = s.realNow;
      this.month = new Date(s.realNow).getMonth();
    }
    const c = this.c;
    const w = s.weather;
    c.s = s;
    c.sky = sky;
    c.time = s.time;
    c.dt = dt;
    c.night = 1 - sky.day;
    c.season = s.sim.season;
    c.weather = w;
    c.snowy = s.sim.season === 3 || w === 'snow';
    c.wet = w === 'rain' || w === 'storm';
    c.open = w === 'clear' || w === 'cloudy';
    c.month = this.month;
    c.t = s.sim.t;
    c.ev = ev;
    this.ready = true;

    const g = p.g;
    g.save();
    g.beginPath();
    g.rect(WX, WY, WW, WH);
    g.clip();
    g.translate(WX, WY);

    this.skyP.drawBack(p, c, view.horizon, STARS[viewId], MILKY[viewId]);
    this.skyP.drawClouds(p, c);
    view.drawSky?.(c, p);
    this.director.update(c, view, viewId);
    this.director.drawSky(p, c, this.skyP, view.horizon);

    const d = (this.depth ??= new Depth(p));
    d.main = p;
    d.hazeCss = `rgb(${sky.bot[0]},${sky.bot[1]},${sky.bot[2]})`;
    d.hazeK = w === 'fog' ? 0.8 : c.wet ? 0.4 : w === 'snow' ? 0.35 : 0.2;
    d.tintCss = c.night > 0.01 ? `rgba(10,14,40,${(c.night * 0.55).toFixed(3)})` : '';
    const dim = (({ clear: 0, cloudy: 0.05, rain: 0.14, storm: 0.22, snow: 0.06, fog: 0.04 })[w]) * (1 - c.night);
    d.dimCss = dim > 0.005 ? `rgba(40,46,62,${dim.toFixed(3)})` : '';
    view.draw(c, d);

    this.fx.fog(p, c, FOG_BANDS[viewId], w === 'fog' ? 0.8 : 0);
    this.director.drawFront(p, c, view.horizon);
    this.fx.particles(p, c, view);
    this.fx.lightningFx(p, c, view.horizon, ev);
    this.fx.glass(p, c);
    g.restore();
  }

  /** Lightning flash level for lighting up the room (0..1). */
  get lightning(): number {
    return this.fx.lightning;
  }

  /** Catchable world event at logical canvas px (x, y), as last drawn (see the header comment). */
  hitTest(x: number, y: number): WorldEventKind | null {
    if (x < WX - 2 || x > WX + WW + 2 || y < WY - 2 || y > WY + WH + 2) return null;
    return this.director.kindAt(x - WX, y - WY);
  }

  /** Catch the thing at (x, y): it reacts and ev.onCatch(kind) fires. Returns its kind, or null. */
  catchAt(x: number, y: number, time: number): WorldEventKind | null {
    if (x < WX - 2 || x > WX + WW + 2 || y < WY - 2 || y > WY + WH + 2) return null;
    const e = this.director.catch(x - WX, y - WY, time);
    if (!e) return null;
    this.ev.onCatch?.(e.kind);
    return e.kind;
  }

  /** Where a visible catchable thing is (canvas px), e.g. to anchor a speech bubble. */
  anchor(kind?: WorldEventKind): { x: number; y: number } | null {
    const a = this.director.anchor(kind);
    return a ? { x: a.x + WX, y: a.y + WY } : null;
  }

  /** Debug / lab: start an event right away (age = seconds already elapsed). False if this view can't show it. */
  forceEvent(kind: WorldEventKind, age = 0): boolean {
    if (!this.ready) return false;
    return this.director.start(kind, this.c, this.view(this.viewId), this.last - age);
  }
}

const FOG_BANDS: Record<ViewId, readonly number[]> = {
  street: [22, 34],
  seaside: [18, 30],
  city: [20, 34],
  countryside: [22, 36],
  forest: [24, 38],
};
