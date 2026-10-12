// Off-screen room renders for the customiser (live preview, preset / view thumbnails) and share cards.
import type { AppState } from '../core/types';
import type { Appearance, RoomStyle } from '../core/profile';
import { equippedItems } from '../core/actions';
import { totalStudiedMs } from '../core/economy';
import { simTime } from '../core/sim';
import { moonPhase, weatherAt } from '../core/weather';
import { HOUR } from '../core/time';
import { RoomRenderer } from '../render/room';
import type { Mode, RenderScene } from '../render/scene';
import { WIN } from '../render/scene';
import { h } from './dom';
import { ROOM_H, ROOM_W } from './worldlogic';

export interface SceneOpts {
  look?: Appearance;
  room?: RoomStyle;
  mode?: Mode;
  /** Show a bright daytime moment of the current sim day (nice for previews). */
  daytime?: boolean;
  time?: number;
}

/** A render scene for the user's own room, optionally with a different look / room style. */
export function sceneFor(state: AppState, now: number, o: SceneOpts = {}): RenderScene {
  const total = totalStudiedMs(state, now);
  const simMs = o.daytime ? Math.floor(total / HOUR) * HOUR + 0.22 * HOUR : total;
  const weather = weatherAt(total);
  return {
    time: o.time ?? performance.now() / 1000,
    sim: simTime(simMs),
    weather: o.daytime && (weather === 'storm' || weather === 'fog') ? 'cloudy' : weather,
    moon: moonPhase(total),
    mode: o.mode ?? 'idle',
    items: equippedItems(state),
    look: o.look ?? state.profile.appearance,
    room: o.room ?? state.profile.room,
    studiedHours: total / HOUR,
    realNow: now,
  };
}

let shared: { canvas: HTMLCanvasElement; r: RoomRenderer } | null = null;
/** One shared off-screen renderer for thumbnails / share cards. */
export function renderOffscreen(scene: RenderScene): HTMLCanvasElement {
  if (!shared) {
    const canvas = document.createElement('canvas');
    shared = { canvas, r: new RoomRenderer(canvas) };
  }
  try {
    shared.r.render(scene);
  } catch (e) {
    console.warn('[preview] render failed', e);
  }
  return shared.canvas;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const FULL: Crop = { x: 0, y: 0, w: ROOM_W, h: ROOM_H };
export const WINDOW_CROP: Crop = { x: WIN.x - 2, y: WIN.y - 2, w: WIN.w + 4, h: WIN.h + 4 };
/** Head-and-shoulders of the buddy sitting at the desk. */
export const PORTRAIT_CROP: Crop = { x: 130, y: 46, w: 40, h: 40 };

/** Render `scene` and copy the cropped region into a small crisp canvas. */
export function thumb(scene: RenderScene, crop: Crop = FULL, cls = 'thumb'): HTMLCanvasElement {
  const src = renderOffscreen(scene);
  const c = h('canvas', { class: cls, width: crop.w, height: crop.h, 'aria-hidden': 'true' });
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  }
  return c;
}

export interface LivePreview {
  el: HTMLCanvasElement;
  /** Re-render now (e.g. after the draft changed). */
  refresh(): void;
  stop(): void;
}

/** A live, animated room canvas that renders `getScene()` every frame while it's in the document. */
export function livePreview(getScene: (time: number) => RenderScene, label = 'Preview of your room'): LivePreview {
  const el = h('canvas', { class: 'cz-canvas', role: 'img', 'aria-label': label });
  const r = new RoomRenderer(el);
  let raf = 0;
  let stopped = false;
  const draw = () => {
    try {
      r.render(getScene(performance.now() / 1000));
    } catch (e) {
      console.warn('[preview] render failed', e);
    }
  };
  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (!el.isConnected) return;
    draw();
  };
  raf = requestAnimationFrame(loop);
  draw();
  return {
    el,
    refresh: draw,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
