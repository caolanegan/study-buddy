// The buddy talks: speech bubbles over the room, tap-to-interact with things in it,
// and little floating reactions (♥, ♪, 🫧…).
import { pickLine, type BubbleCtx, type BubbleReason } from '../core/dialogue';
import type { RoomRenderer } from '../render/room';
import type { HitTarget } from '../render/scene';
import { h } from './dom';
import { modalOpen } from './overlay';
import { BubbleLimiter, bubbleDuration, placeBubble, toCss, toLogical, type BubbleKind, type Box } from './worldlogic';
import type { Ctx } from './context';

export type Anchor = HitTarget | 'buddy';

export interface BuddyDeps {
  /** Box exactly covering the room canvas (bubbles live in here). */
  overlay: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: RoomRenderer;
  /** Dialogue context for a reason (from app state, or a visited room). */
  context(reason: BubbleReason, extra?: Partial<BubbleCtx>): BubbleCtx;
  /** Auto chatter allowed right now (settings.bubbles, not hidden…). */
  chatty(): boolean;
  /** Area of the overlay bubbles should keep clear of (the corner buttons), in overlay px. */
  avoid?(): Box | null;
}

export interface Buddy {
  /** Say a line for `reason`. Returns false when rate-limited / nothing to say. */
  say(reason: BubbleReason, extra?: Partial<BubbleCtx>, kind?: BubbleKind, anchor?: Anchor): boolean;
  sayText(text: string, kind?: BubbleKind, anchor?: Anchor): boolean;
  /** Say it once no modal is covering the room (within `ttl` ms). */
  queue(reason: BubbleReason, extra?: Partial<BubbleCtx>, kind?: BubbleKind, ttl?: number): void;
  float(text: string, anchor: Anchor): void;
  hide(): void;
  frame(now: number): void;
  readonly limiter: BubbleLimiter;
  /** Called after any line is said (so chatter can back off). */
  onSaid?: (now: number) => void;
}

const sfx = (ctx: Ctx, n: string) => ctx.audio.play(n as never);
const haptic = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not supported */
  }
};

/**
 * What a tap on each thing does on top of the renderer's own animation (hearts for pets, sips, the lamp
 * switching…): a sound, maybe a little floating reaction, and whether the buddy comments.
 * (The renderer reports cat / dog taps through onPet, which already meows / barks.)
 */
const TAP_FX: Partial<Record<HitTarget, { sound?: string; float?: string; pet?: boolean }>> = {
  cat: { sound: 'purr', pet: true },
  dog: { pet: true },
  'fish-tank': { sound: 'pop', float: '🫧', pet: true },
  lizard: { sound: 'boop', pet: true },
  mug: { sound: 'sip' },
  plant: { sound: 'rustle', float: '🍃' },
  clock: { sound: 'tick', float: 'tick!' },
  lamp: { sound: 'click' },
  tv: { sound: 'click' },
  hamster: { sound: 'pop', pet: true },
  parrot: { sound: 'chirp', pet: true },
  'robot-vacuum': { sound: 'boop', float: 'beep!', pet: true },
  ghost: { sound: 'whoosh', float: '👻' },
};

export function createBuddy(ctx: Ctx, d: BuddyDeps): Buddy {
  const { overlay, canvas, renderer } = d;
  const limiter = new BubbleLimiter();
  const text = h('span', { class: 'bubble-text' });
  const bubble = h('div', { class: 'bubble', role: 'status', 'aria-live': 'polite', hidden: true }, text);
  overlay.append(bubble);
  let anchor: Anchor = 'buddy';
  let hideAt = 0;
  let hideTimer = 0;
  let pending: { reason: BubbleReason; extra?: Partial<BubbleCtx>; kind: BubbleKind; until: number } | null = null;

  function show(line: string, kind: BubbleKind, at: Anchor) {
    const now = Date.now();
    limiter.shown(kind, now);
    anchor = at;
    text.textContent = line;
    bubble.hidden = false;
    bubble.classList.remove('bubble-out');
    // restart the pop-in animation
    bubble.classList.remove('bubble-in');
    void bubble.offsetWidth;
    bubble.classList.add('bubble-in');
    remeasure();
    position();
    const ms = bubbleDuration(line);
    hideAt = now + ms;
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, ms);
    b.onSaid?.(now);
  }

  function hide() {
    clearTimeout(hideTimer);
    if (bubble.hidden) return;
    bubble.classList.add('bubble-out');
    window.setTimeout(() => {
      if (Date.now() >= hideAt - 50) bubble.hidden = true;
    }, 180);
  }

  // Layout is measured only when something changed (a new line, a resize), and styles are written
  // only when the placement moves: positioning runs every frame and must not force a layout.
  let measured: { W: number; H: number; bw: number; bh: number; avoid: Box | null } | null = null;
  let placed = '';
  const remeasure = () => {
    measured = null;
  };
  function position() {
    if (bubble.hidden) return;
    if (!measured) {
      const W = overlay.clientWidth;
      const H = overlay.clientHeight;
      if (!W || !H) return;
      measured = { W, H, bw: bubble.offsetWidth, bh: bubble.offsetHeight, avoid: d.avoid?.() ?? null };
    }
    const { W, H, bw, bh, avoid } = measured;
    const a = renderer.anchor(anchor) ?? renderer.anchor('buddy');
    if (!a) return hide();
    const p = toCss(a, W, H);
    const pl = placeBubble(p.x, p.y, bw, bh, W, H, 6, 10, avoid);
    const key = `${Math.round(pl.left)}|${Math.round(pl.top)}|${Math.round(pl.tailX)}|${pl.below}`;
    if (key === placed) return;
    placed = key;
    bubble.style.left = `${Math.round(pl.left)}px`;
    bubble.style.top = `${Math.round(pl.top)}px`;
    bubble.style.setProperty('--tail-x', `${Math.round(pl.tailX)}px`);
    bubble.classList.toggle('below', pl.below);
  }

  const b: Buddy = {
    limiter,
    say(reason, extra, kind = 'chat', at = 'buddy') {
      if (!limiter.allow(kind, Date.now())) return false;
      const line = pickLine(d.context(reason, extra));
      if (!line || line === '…') return false;
      show(line, kind, at);
      return true;
    },
    sayText(line, kind = 'chat', at = 'buddy') {
      if (!limiter.allow(kind, Date.now())) return false;
      show(line, kind, at);
      return true;
    },
    queue(reason, extra, kind = 'important', ttl = 60_000) {
      pending = { reason, extra, kind, until: Date.now() + ttl };
    },
    float(t, at) {
      const a = renderer.anchor(at);
      const W = overlay.clientWidth;
      const H = overlay.clientHeight;
      if (!a || !W) return;
      const p = toCss(a, W, H);
      const el = h('span', { class: 'float-fx', 'aria-hidden': 'true', style: `left:${p.x}px;top:${p.y}px` }, t);
      overlay.append(el);
      window.setTimeout(() => el.remove(), 1300);
    },
    hide,
    frame(now) {
      if (pending && (now >= pending.until || (!modalOpen() && limiter.allow(pending.kind, now)))) {
        const p = pending;
        pending = null;
        if (now < p.until && d.chatty()) b.say(p.reason, p.extra, p.kind);
      }
      position();
    },
  };

  // ───────────── tapping things in the room ─────────────
  let lastPt: { x: number; y: number } | null = null;
  const hitAt = (e: { clientX: number; clientY: number }): HitTarget | null => {
    const pt = toLogical(e.clientX, e.clientY, canvas.getBoundingClientRect());
    lastPt = pt;
    if (!pt) return null;
    try {
      return renderer.hitTest(pt.x, pt.y);
    } catch {
      return null;
    }
  };

  function tap(target: HitTarget, pt?: { x: number; y: number } | null) {
    const t = performance.now() / 1000;
    try {
      renderer.interact(target, t, pt?.x, pt?.y);
    } catch (e) {
      console.warn('[buddy] interact failed', e);
    }
    void ctx.audio.unlock();
    haptic();
    if (target === 'world-event') return; // the renderer reports the catch
    if (target === 'character') {
      sfx(ctx, Math.random() < 0.5 ? 'boop' : 'hey');
      b.say('tap', undefined, 'user');
      return;
    }
    const fx = TAP_FX[target];
    if (!fx) return;
    if (fx.sound) sfx(ctx, fx.sound);
    if (fx.float) b.float(fx.float, target);
    if (fx.pet) b.say('pet', { pet: target }, 'user');
  }

  canvas.addEventListener('click', (e) => {
    const target = hitAt(e);
    if (target) tap(target, lastPt);
  });
  // keyboard: Enter on the room says hi to the buddy
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tap('character');
    }
  });

  // desktop: pointer cursor over things you can tap
  let hoverRaf = 0;
  let lastMove: PointerEvent | null = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    lastMove = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (lastMove) canvas.style.cursor = hitAt(lastMove) ? 'pointer' : '';
    });
  });
  canvas.addEventListener('pointerleave', () => (canvas.style.cursor = ''));

  window.addEventListener('resize', () => {
    remeasure();
    position();
  });
  // the overlay also changes size without a window resize (side panel collapsed, zen mode)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(remeasure).observe(overlay);
  return b;
}
