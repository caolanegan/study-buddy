// The "living world" layer over the room: speech bubbles & tap interactions, world-event
// reactions, the daily letter, customise / share buttons, visit mode, zen mode and onboarding.
import * as actions from '../core/actions';
import type { AppState } from '../core/types';
import type { BubbleCtx, BubbleReason } from '../core/dialogue';
import { totalStudiedMs } from '../core/economy';
import type { RoomSnapshot } from '../core/share';
import { simTime } from '../core/sim';
import { weatherAt } from '../core/weather';
import type { RoomRenderer } from '../render/room';
import type { RenderScene, WorldEventKind } from '../render/scene';
import { h } from './dom';
import { modalOpen, toast } from './overlay';
import { createBuddy } from './buddy';
import { openCustomize } from './customize';
import { createLetterUI } from './letters';
import { openOnboarding } from './onboarding';
import { buildShareCard, copyVisitLink, shareRoom } from './share';
import { createVisitMode } from './visit';
import { createZen } from './zen';
import { bubbleCtxFrom, catchCopy, Chatter, isNewUser, type ChatMode } from './worldlogic';
import { sessionStatus } from './viewmodel';
import type { RoomView } from './roomview';
import type { SessionController } from './session';
import type { Ctx } from './context';

export interface World {
  /** Total ms that drives the sim clock (a visited friend's hours while visiting). */
  simTotal(myTotal: number): number;
  /** The scene to draw this frame (a visited friend's room while visiting). */
  scene(base: RenderScene): RenderScene;
  /** Call once per animation frame after rendering. */
  frame(now: number, scene: RenderScene): void;
  onWorldEvent(kind: WorldEventKind): void;
  onCatch(kind: WorldEventKind): void;
  readonly visiting: boolean;
}

const sfx = (ctx: Ctx, n: string, delay?: number) => ctx.audio.play(n as never, delay ? { delay } : undefined);

/** Sounds for things happening outside. */
const EVENT_SOUND: Partial<Record<WorldEventKind, string>> = {
  balloon: 'balloon',
  fireworks: 'fireworks',
  train: 'train',
  'bird-visit': 'chirp',
  ufo: 'whoosh',
  owl: 'owl',
  'shooting-star': 'sparkle',
};

export function createWorld(ctx: Ctx, d: { room: RoomView; renderer: RoomRenderer; sc: SessionController }): World {
  const { room, renderer, sc, } = d;
  const { store } = ctx;
  const stage = room.stage;
  const canvas = room.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Your study room — tap things in it, or press Enter to say hi to your buddy');

  // overlay that exactly covers the canvas: bubbles, envelope, buttons
  const overlay = h('div', { class: 'stage-overlay' });
  canvas.after(overlay);
  const app = () => stage.closest('.app');
  let onboarding = false;

  // ───────────── bubbles ─────────────
  const clock = (state: AppState, now: number) => {
    const total = visit.simTotal(totalStudiedMs(state, now));
    return { sim: simTime(total), weather: weatherAt(total) };
  };
  const context = (reason: BubbleReason, extra?: Partial<BubbleCtx>): BubbleCtx => {
    const s = store.get();
    const now = ctx.now();
    const { sim, weather } = clock(s, now);
    const c = bubbleCtxFrom(s, now, sim, weather, reason, extra);
    const v = visit.snapshot;
    // visiting: it's their buddy talking
    return v ? { ...c, name: v.look.name, view: v.room.view, streak: v.streak, todayMin: 0, sessionMin: 30, goalMin: 60 } : c;
  };
  const chatty = () => store.get().settings.bubbles !== false && !document.hidden;
  const avoid = () => {
    const el = stageBtns;
    return el.offsetWidth ? { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } : null;
  };
  const buddy = createBuddy(ctx, { overlay, canvas, renderer, context, chatty, avoid });
  const chatter = new Chatter();
  buddy.onSaid = (now) => chatter.bump(now);

  // ───────────── visit mode ─────────────
  const visit = createVisitMode({
    isNewUser: () => isNewUser(store.get()),
    onMakeOwn: () => {
      visit.leave();
      startOnboarding();
    },
    onChange: (s) => {
      document.documentElement.classList.toggle('visiting', !!s);
      app()?.classList.toggle('visiting', !!s);
      buddy.hide();
      if (s) {
        if (!matchMedia('(min-width: 900px)').matches) ctx.showTab('room');
        window.scrollTo({ top: 0 });
        setTimeout(() => buddy.sayText(`Hi! Welcome to my room 👋`, 'important'), 900);
      } else if (!store.get().profile.onboarded && !modalOpen()) startOnboarding();
    },
  });
  stage.before(visit.banner);

  // ───────────── letter ─────────────
  const letter = createLetterUI(ctx, () => setTimeout(() => buddy.sayText('Aww, that was sweet 💌', 'important'), 600));
  overlay.append(letter.el);

  // ───────────── stage buttons ─────────────
  const share = () => void shareRoom(ctx);
  const customize = (tab?: 'character' | 'room') => openCustomize(ctx, { tab, onShare: share });
  const editBtn = h('button', { type: 'button', class: 'stage-btn', 'aria-label': 'Customise your buddy and room', title: 'Customise', onclick: () => customize() }, '✏️');
  const zenBtn = h('button', { type: 'button', class: 'stage-btn', 'aria-label': 'Zen mode (F)', title: 'Zen mode (F)', onclick: () => zen.toggle() }, h('span', { class: 'zen-ico', 'aria-hidden': 'true' }));
  const stageBtns = h('div', { class: 'stage-btns' }, editBtn, zenBtn);
  overlay.append(stageBtns);
  const zen = createZen(stage, sc);

  // services for the other views (Settings, Friends)
  ctx.openCustomize = (tab) => customize(tab);
  ctx.shareRoom = () => shareRoom(ctx);
  ctx.copyVisitLink = () => copyVisitLink(ctx);
  ctx.openVisit = (s: RoomSnapshot) => visit.open(s);

  // ───────────── onboarding ─────────────
  function startOnboarding() {
    if (onboarding || visit.snapshot) return;
    onboarding = true;
    openOnboarding(ctx, () => {
      onboarding = false;
      greeted = true; // the intro line below is the greeting
      setTimeout(() => buddy.sayText(`Hi, I’m ${store.get().profile.appearance.name}! Let’s study together 📚`, 'important'), 500);
    });
  }

  // ───────────── reactions to the session ─────────────
  store.subscribe((s, prev) => {
    if (visit.snapshot) return;
    if (!prev.active && s.active) {
      chatter.bump(Date.now());
      setTimeout(() => chatty() && buddy.say('start', undefined, 'important'), 700);
    } else if (prev.active && !s.active && s.sessions.length > prev.sessions.length) {
      const last = s.sessions[s.sessions.length - 1];
      buddy.queue('end', { sessionMin: Math.floor(last.activeMs / 60_000) });
    } else if (prev.active?.pomodoro && s.active?.pomodoro && prev.active.pomodoro.phase !== s.active.pomodoro.phase) {
      const reason = s.active.pomodoro.phase === 'break' ? 'break' : 'back';
      if (chatty()) buddy.say(reason, undefined, 'important');
    }
  });

  // block Space (start/pause) while visiting someone else's room
  document.addEventListener(
    'keydown',
    (e) => {
      if (visit.snapshot && e.code === 'Space' && !(e.target instanceof HTMLElement && e.target.closest('button, input, textarea, select, a, [role="switch"]'))) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );

  // first greeting
  const greetAt = Date.now() + 1800;
  let greeted = false;

  let lastSlow = 0;
  const lastEventSound = new Map<string, number>();

  const world: World = {
    get visiting() {
      return !!visit.snapshot;
    },
    simTotal: (t) => visit.simTotal(t),
    scene: (base) => visit.scene(base),
    frame(now) {
      buddy.frame(now);
      if (now - lastSlow < 500) return;
      lastSlow = now;
      const s = store.get();
      const visiting = !!visit.snapshot;
      const { sim, weather } = clock(s, now);
      zen.update(s, now, sim, weather, visiting);
      editBtn.hidden = visiting;
      if (visiting) visit.setNote(s.active ? ' · ⏱ your timer is still running' : '');

      // first run
      if (!s.profile.onboarded && !visiting && !onboarding && !modalOpen()) startOnboarding();

      // daily letter
      const fresh = letter.update(now, !visiting && s.profile.onboarded);
      if (fresh) buddy.queue('letter', undefined, 'chat', 90_000);

      if (visiting || !s.profile.onboarded || modalOpen()) return;
      if (!greeted && now >= greetAt) {
        greeted = true;
        if (chatty()) buddy.say('greet', undefined, 'important');
      }
      // ambient chatter
      const st = sessionStatus(s.active);
      const mode: ChatMode = !chatty() ? 'off' : st === 'running' ? 'studying' : st === 'idle' ? 'idle' : 'off';
      const due = chatter.tick(now, mode);
      if (due) buddy.say(due, undefined, 'chat');
    },
    onWorldEvent(kind) {
      if (document.hidden) return;
      const now = Date.now();
      const snd = EVENT_SOUND[kind] ?? (kind === 'boat' && Math.random() < 0.35 ? 'horn' : kind === 'dolphin' || kind === 'whale' ? 'gull' : null);
      if (snd && now - (lastEventSound.get(kind) ?? 0) > 20_000) {
        lastEventSound.set(kind, now);
        sfx(ctx, snd);
      }
      if (chatty() && !modalOpen()) buddy.say('event', { event: kind }, 'event');
    },
    onCatch(kind) {
      const now = ctx.now();
      sfx(ctx, 'sparkle');
      const copy = catchCopy(kind);
      if (!visit.snapshot) {
        const r = actions.claimCatch(store.get(), kind, now);
        if (r.claimed) {
          store.set(r.state);
          const reward = actions.CATCH_REWARDS[kind] ?? 5;
          toast(`${copy.text} +${reward}`, copy.icon);
          sfx(ctx, 'coin', 0.25);
        } else {
          // daily catch cap reached: still a lovely moment, just no coins
          toast(copy.text, copy.icon);
        }
      }
      buddy.say('caught', { event: kind }, 'important');
    },
  };

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__world = { ctx, renderer, buddy, zen, visit, letter, world, startOnboarding, shareCard: () => buildShareCard(ctx).toDataURL('image/png') };
  return world;
}
