import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { HOUR, MIN } from '../src/core/time';
import { simTime } from '../src/core/sim';
import {
  BubbleLimiter,
  bubbleCtxFrom,
  bubbleDuration,
  catchCopy,
  CHAT_RANGE,
  Chatter,
  isNewUser,
  LIMITS,
  placeBubble,
  prettyUrl,
  shareCardLines,
  shareText,
  toCss,
  toLogical,
} from '../src/ui/worldlogic';
import { visitBannerText } from '../src/ui/visit';

const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime();

describe('pointer → room coordinates', () => {
  const box = { left: 10, top: 20, width: 480, height: 300 }; // 2× scale

  it('maps CSS px to logical 240×150 pixels', () => {
    expect(toLogical(10, 20, box)).toEqual({ x: 0, y: 0 });
    expect(toLogical(10 + 300, 20 + 132, box)).toEqual({ x: 150, y: 66 });
    expect(toLogical(10 + 479.9, 20 + 299.9, box)).toEqual({ x: 239, y: 149 });
  });

  it('returns null outside the canvas or for an empty box', () => {
    expect(toLogical(9, 30, box)).toBeNull();
    expect(toLogical(10 + 480, 30, box)).toBeNull();
    expect(toLogical(50, 20 + 300, box)).toBeNull();
    expect(toLogical(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it('round-trips through toCss', () => {
    const p = toCss({ x: 150, y: 52 }, 480, 300);
    expect(p).toEqual({ x: 300, y: 104 });
    expect(toLogical(box.left + p.x, box.top + p.y, box)).toEqual({ x: 150, y: 52 });
  });
});

describe('bubble placement', () => {
  it('sits centred above the anchor with the tail pointing at it', () => {
    const p = placeBubble(200, 100, 120, 40, 400, 250);
    expect(p.below).toBe(false);
    expect(p.left).toBe(140);
    expect(p.top).toBe(100 - 10 - 40);
    expect(p.tailX).toBe(60);
  });

  it('clamps to the box edges and keeps the tail over the anchor', () => {
    const right = placeBubble(395, 100, 120, 40, 400, 250);
    expect(right.left).toBe(400 - 6 - 120);
    expect(right.tailX).toBe(120 - 14); // tail pinned near the edge, not off the bubble
    const left = placeBubble(2, 100, 120, 40, 400, 250);
    expect(left.left).toBe(6);
    expect(left.tailX).toBe(14);
  });

  it('flips below when there is no room above', () => {
    const p = placeBubble(200, 20, 120, 40, 400, 250);
    expect(p.below).toBe(true);
    expect(p.top).toBe(30);
  });
});

describe('bubble timing & rate limits', () => {
  it('shows short lines ~3.5s and long ones longer (capped)', () => {
    expect(bubbleDuration('Hi! 👋')).toBe(3500);
    expect(bubbleDuration('x'.repeat(60))).toBeGreaterThan(5000);
    expect(bubbleDuration('x'.repeat(500))).toBe(6500);
  });

  it('rate-limits taps but lets important lines through', () => {
    const l = new BubbleLimiter();
    expect(l.allow('user', 0)).toBe(true);
    l.shown('user', 0);
    expect(l.allow('user', 500)).toBe(false);
    expect(l.allow('user', LIMITS.userGap)).toBe(true);
    expect(l.allow('important', 1)).toBe(true);
  });

  it('automatic chatter never interrupts a recent bubble', () => {
    const l = new BubbleLimiter();
    l.shown('important', 1000);
    expect(l.allow('chat', 1000 + LIMITS.quiet - 1)).toBe(false);
    expect(l.allow('chat', 1000 + LIMITS.quiet)).toBe(true);
  });

  it('reacts to world events at most once per 45s', () => {
    const l = new BubbleLimiter();
    expect(l.allow('event', 0)).toBe(true);
    l.shown('event', 0);
    expect(l.allow('event', 30_000)).toBe(false);
    expect(l.allow('event', LIMITS.eventGap)).toBe(true);
  });
});

describe('chatter schedule', () => {
  it('waits 2–4 min while idle and 5–9 min while studying', () => {
    for (const r of [0, 0.5, 0.999]) {
      const c = new Chatter(() => r);
      expect(c.tick(0, 'idle')).toBeNull(); // mode change schedules
      const [a, b] = CHAT_RANGE.idle;
      expect(c.nextAt).toBeGreaterThanOrEqual(a);
      expect(c.nextAt).toBeLessThanOrEqual(b);
      expect(c.tick(c.nextAt - 1, 'idle')).toBeNull();
      expect(c.tick(c.nextAt, 'idle')).toBe('idle-chat');
    }
    const c = new Chatter(() => 0);
    c.tick(0, 'studying');
    expect(c.nextAt).toBe(CHAT_RANGE.studying[0]);
    expect(c.tick(5 * MIN, 'studying')).toBe('study-chat');
  });

  it('reschedules on mode change, stays quiet when off, backs off after other lines', () => {
    const c = new Chatter(() => 0);
    c.tick(0, 'idle');
    expect(c.tick(10 * MIN, 'studying')).toBeNull(); // switching modes doesn't fire
    expect(c.nextAt).toBe(10 * MIN + 5 * MIN);
    c.bump(12 * MIN);
    expect(c.nextAt).toBe(17 * MIN);
    c.tick(13 * MIN, 'off');
    expect(c.tick(10_000 * MIN, 'off')).toBeNull();
  });
});

describe('bubble context', () => {
  it('reads name, streak, today and goal from state', () => {
    let s = A.defaultState();
    s = A.updateProfile(s, { appearance: { ...s.profile.appearance, name: 'Mei' }, room: { ...s.profile.room, view: 'forest' } }, T0);
    s = A.start(s, T0 - 40 * MIN);
    s = A.end(s, T0 - 5 * MIN).state;
    s = A.start(s, T0 - 3 * MIN);
    const c = bubbleCtxFrom(s, T0, simTime(HOUR / 4), 'rain', 'tap');
    expect(c).toMatchObject({ reason: 'tap', name: 'Mei', view: 'forest', weather: 'rain', hour: 9, streak: 1, todayMin: 38, sessionMin: 3, goalMin: 120, isNight: false });
  });

  it('knows a brand-new user', () => {
    const s = A.defaultState();
    expect(isNewUser(s)).toBe(true);
    expect(isNewUser(A.updateProfile(s, { onboarded: true }, T0))).toBe(false);
  });
});

describe('share card & visit text', () => {
  const info = { name: 'Sam', hours: 12.04, streak: 3, day: 13, season: 'Summer' };

  it('builds the card footer lines', () => {
    expect(shareCardLines(info)).toEqual({ title: 'Sam’s study room', stats: ['12h studied', '3-day streak'], sim: 'Day 13 · Summer' });
    expect(shareCardLines({ ...info, hours: 3.46, streak: 0 }).stats).toEqual(['3.5h studied', 'Fresh start']);
    expect(shareCardLines({ ...info, hours: 1234.5 }).stats[0]).toBe('1235h studied');
  });

  it('writes a friendly share message', () => {
    expect(shareText(info)).toContain('Sam and I have studied 12h together · 🔥 3-day streak');
    expect(shareText({ ...info, streak: 1 })).not.toContain('streak');
  });

  it('shortens the app URL for the wordmark', () => {
    expect(prettyUrl('https://www.example.com/study-buddy/')).toBe('example.com/study-buddy');
    expect(prettyUrl('not a url')).toBe('not a url');
  });

  it('has copy for catches', () => {
    expect(catchCopy('shooting-star').text).toMatch(/shooting star/);
    expect(catchCopy('mystery').icon).toBe('✨');
  });

  it('labels a visited room', () => {
    const snap = { v: 1 as const, look: { name: 'Kofi', skin: 'deep', hair: 'afro' as const, hairColor: 'black', top: 'mustard' }, room: { wall: 'brick' as const, floor: 'dark-wood' as const, curtains: 'navy' as const, view: 'city' as const }, items: [], hours: 47.3, streak: 5 };
    expect(visitBannerText(snap)).toEqual({ title: 'Visiting Kofi’s room', meta: '47.3h studied · 🔥 5' });
    expect(visitBannerText({ ...snap, hours: 2, streak: 0 }).meta).toBe('2h studied');
  });
});
