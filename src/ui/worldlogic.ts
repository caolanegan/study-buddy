// Pure helpers for the "living room" UI: pointer → room coords, bubble pacing,
// bubble context and share-card text. No DOM here so it can be unit-tested.
import type { AppState } from '../core/types';
import type { BubbleCtx, BubbleReason } from '../core/dialogue';
import type { SimTime } from '../core/sim';
import type { Weather } from '../core/weather';
import { dailyTotals, streakInfo } from '../core/economy';
import { activeMs } from '../core/session';
import { MIN } from '../core/time';
import { todayMs } from './viewmodel';

/** Logical size of the room canvas. */
export const ROOM_W = 240;
export const ROOM_H = 150;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Client (CSS px) point → logical room pixel, or null when outside the canvas. */
export function toLogical(clientX: number, clientY: number, box: Box, w = ROOM_W, h = ROOM_H): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const fx = (clientX - box.left) / box.width;
  const fy = (clientY - box.top) / box.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return { x: Math.floor(fx * w), y: Math.floor(fy * h) };
}

/** Logical room point → CSS px inside a box of the given size. */
export function toCss(p: { x: number; y: number }, width: number, height: number, w = ROOM_W, h = ROOM_H): { x: number; y: number } {
  return { x: (p.x / w) * width, y: (p.y / h) * height };
}

export interface BubblePlacement {
  /** bubble's left / top inside the box (CSS px) */
  left: number;
  top: number;
  /** tail x relative to the bubble's left edge */
  tailX: number;
  /** true when the bubble sits below the anchor (tail on top) */
  below: boolean;
}

/**
 * Place a bubble of size bw×bh above an anchor point (ax, ay) inside a box of width W, height H,
 * clamped to the box with `pad` margin; flips below the anchor when there's no room above.
 */
export function placeBubble(ax: number, ay: number, bw: number, bh: number, W: number, H: number, pad = 6, gap = 10): BubblePlacement {
  const left = Math.max(pad, Math.min(W - pad - bw, ax - bw / 2));
  let top = ay - gap - bh;
  let below = false;
  if (top < pad) {
    below = true;
    top = Math.min(H - pad - bh, ay + gap);
  }
  const tailX = Math.max(14, Math.min(bw - 14, ax - left));
  return { left, top: Math.max(pad, top), tailX, below };
}

/** How long a bubble stays up: ~3.5s for a short line, up to ~6.5s for a long one. */
export function bubbleDuration(text: string): number {
  return Math.round(Math.min(6500, Math.max(3500, 2200 + text.length * 55)));
}

/** Who asked for the bubble: rate limits differ. */
export type BubbleKind = 'user' | 'important' | 'event' | 'chat';

export const LIMITS = {
  /** taps can't spam bubbles faster than this */
  userGap: 1200,
  /** an automatic bubble never interrupts one shown this recently */
  quiet: 8000,
  /** world-event reactions at most this often */
  eventGap: 45_000,
};

/** Rate limiting for speech bubbles (one at a time, no spam). */
export class BubbleLimiter {
  private lastAny = -Infinity;
  private lastUser = -Infinity;
  private lastEvent = -Infinity;

  allow(kind: BubbleKind, now: number): boolean {
    switch (kind) {
      case 'user':
        return now - this.lastUser >= LIMITS.userGap;
      case 'important':
        return true;
      case 'event':
        return now - this.lastEvent >= LIMITS.eventGap && now - this.lastAny >= LIMITS.quiet;
      case 'chat':
        return now - this.lastAny >= LIMITS.quiet;
    }
  }

  shown(kind: BubbleKind, now: number) {
    this.lastAny = now;
    if (kind === 'user') this.lastUser = now;
    if (kind === 'event') this.lastEvent = now;
  }
}

export type ChatMode = 'studying' | 'idle' | 'off';

/** Random thought every 5–9 min while studying, 2–4 min while idle. */
export const CHAT_RANGE: Record<Exclude<ChatMode, 'off'>, [number, number]> = {
  studying: [5 * MIN, 9 * MIN],
  idle: [2 * MIN, 4 * MIN],
};

/** Schedules the buddy's idle / study chatter. `tick` returns the reason when one is due. */
export class Chatter {
  private mode: ChatMode = 'off';
  private due = Infinity;

  constructor(private rnd: () => number = Math.random) {}

  private schedule(now: number) {
    if (this.mode === 'off') {
      this.due = Infinity;
      return;
    }
    const [a, b] = CHAT_RANGE[this.mode];
    this.due = now + a + this.rnd() * (b - a);
  }

  /** Something else was said: push the next thought back. */
  bump(now: number) {
    if (this.mode !== 'off') this.schedule(now);
  }

  tick(now: number, mode: ChatMode): 'study-chat' | 'idle-chat' | null {
    if (mode !== this.mode) {
      this.mode = mode;
      this.schedule(now);
      return null;
    }
    if (now < this.due) return null;
    this.schedule(now);
    return mode === 'studying' ? 'study-chat' : mode === 'idle' ? 'idle-chat' : null;
  }

  get nextAt() {
    return this.due;
  }
}

/** Build the dialogue context from app state. */
export function bubbleCtxFrom(
  state: AppState,
  now: number,
  sim: SimTime,
  weather: Weather,
  reason: BubbleReason,
  extra: Partial<BubbleCtx> = {},
): BubbleCtx {
  return {
    reason,
    name: state.profile.appearance.name,
    hour: new Date(now).getHours(),
    isNight: sim.isNight,
    season: sim.season,
    weather,
    view: state.profile.room.view,
    streak: streakInfo(dailyTotals(state, now), now).current,
    todayMin: Math.floor(todayMs(state, now) / MIN),
    sessionMin: state.active ? Math.floor(activeMs(state.active, now) / MIN) : 0,
    goalMin: state.settings.dailyGoalMin,
    ...extra,
  };
}

/** True for someone who has never studied nor set up their buddy. */
export function isNewUser(state: AppState): boolean {
  return !state.profile.onboarded && state.sessions.length === 0;
}

export interface ShareInfo {
  name: string;
  hours: number;
  streak: number;
  day: number;
  season: string;
}

/** Lines for the share card footer. */
export function shareCardLines(i: ShareInfo): { title: string; stats: string[]; sim: string } {
  const hours = i.hours >= 100 ? String(Math.round(i.hours)) : i.hours.toFixed(1).replace(/\.0$/, '');
  return {
    title: `${i.name}’s study room`,
    stats: [`${hours}h studied`, i.streak > 0 ? `${i.streak}-day streak` : 'Fresh start'],
    sim: `Day ${i.day} · ${i.season}`,
  };
}

/** Text that goes with a shared room. */
export function shareText(i: ShareInfo): string {
  const hours = i.hours.toFixed(1).replace(/\.0$/, '');
  const streak = i.streak > 1 ? ` · 🔥 ${i.streak}-day streak` : '';
  return `Come see my cozy study room! ${i.name} and I have studied ${hours}h together${streak} 📚✨`;
}

/** "study-buddy.app/…" style short form of a URL for the card. */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '').replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Catch toast copy. */
export const CATCH_COPY: Record<string, { icon: string; text: string }> = {
  'shooting-star': { icon: '🌠', text: 'Caught a shooting star!' },
  'bird-visit': { icon: '🐦', text: 'A little bird said hi!' },
  balloon: { icon: '🎈', text: 'Waved at the balloon!' },
  ufo: { icon: '🛸', text: 'Spotted a UFO!' },
};
export function catchCopy(kind: string): { icon: string; text: string } {
  return CATCH_COPY[kind] ?? { icon: '✨', text: 'Nice catch!' };
}
