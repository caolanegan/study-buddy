// Zen mode: the room fills the screen with a minimal, auto-hiding timer overlay.
import type { AppState } from '../core/types';
import type { SimTime } from '../core/sim';
import type { Weather } from '../core/weather';
import { h, isTypingTarget, setText } from './dom';
import { modalOpen } from './overlay';
import { weatherIcon } from './format';
import { deriveSession } from './viewmodel';
import type { SessionController } from './session';
import { WIN } from '../render/scene';

const HIDE_AFTER = 3000;

export interface Zen {
  readonly active: boolean;
  toggle(on?: boolean): void;
  update(state: AppState, now: number, sim: SimTime, weather: Weather, visiting: boolean): void;
}

/** iPhone can't go fullscreen; iPad / Mac can. (The whole page goes fullscreen so modals still show.) */
function canFullscreen(): boolean {
  const iPhone = /iPhone|iPod/.test(navigator.userAgent);
  return !iPhone && !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
}

/** `refresh` is asked to call update() right away when zen opens, so the HUD never shows unfilled for a beat. */
export function createZen(stage: HTMLElement, sc: SessionController, refresh?: () => void): Zen {
  const root = h('div', { class: 'zen-root', role: 'region', 'aria-label': 'Zen mode — press Esc to exit', tabindex: -1 });
  const timer = h('div', { class: 'zen-timer', role: 'timer', 'aria-label': 'Study time this session' });
  const sub = h('div', { class: 'zen-sub' });
  const chip = h('div', { class: 'zen-chip' });
  const start = h('button', { type: 'button', class: 'btn btn-go zen-btn', onclick: () => sc.start() }, '▶ Start');
  const primary = h('button', { type: 'button', class: 'btn btn-primary zen-btn', onclick: () => sc.primary() }, '❚❚ Pause');
  const end = h('button', { type: 'button', class: 'btn btn-danger zen-btn', onclick: () => sc.end() }, '■ End');
  const close = h('button', { type: 'button', class: 'zen-close', 'aria-label': 'Exit zen mode (Esc)', title: 'Exit zen (Esc)', onclick: () => toggle(false) }, '✕');
  const hud = h(
    'div',
    { class: 'zen-hud' },
    h('div', { class: 'zen-top' }, chip, close),
    h('div', { class: 'zen-bottom' }, h('div', { class: 'zen-clock' }, timer, sub), h('div', { class: 'zen-btns' }, start, primary, end)),
  );
  const slot = h('div', { class: 'zen-slot' });
  // Tall phone screens: a big live view out of the window above the room (a crop of the room canvas).
  const winCanvas = h('canvas', { class: 'zen-window', width: WIN.w, height: WIN.h, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const winWrap = h('div', { class: 'zen-window-wrap', 'aria-hidden': 'true' }, winCanvas);
  root.append(winWrap, slot, hud);
  const winCtx = winCanvas.getContext('2d');
  let winRaf = 0;
  const copyWindow = () => {
    winRaf = requestAnimationFrame(copyWindow);
    if (!winCtx || winWrap.offsetParent === null) return; // hidden on this screen shape
    const src = stage.querySelector('canvas');
    if (!src) return;
    winCtx.imageSmoothingEnabled = false;
    winCtx.drawImage(src, WIN.x, WIN.y, WIN.w, WIN.h, 0, 0, WIN.w, WIN.h);
  };

  let on = false;
  let placeholder: Comment | null = null;
  let hideTimer = 0;
  let lastKey = '';

  let keyboard = false;
  const wake = () => {
    root.classList.remove('hud-hidden');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      // keep controls up while a keyboard user is on them
      if (!(keyboard && hud.contains(document.activeElement))) root.classList.add('hud-hidden');
    }, HIDE_AFTER);
  };
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') keyboard = false;
    wake();
  });
  root.addEventListener('pointerdown', () => {
    keyboard = false;
    wake();
  });
  root.addEventListener('focusin', wake);
  root.addEventListener('keydown', () => (keyboard = true));

  function toggle(want = !on) {
    if (want === on) return;
    on = want;
    if (on) {
      placeholder = document.createComment('stage');
      stage.replaceWith(placeholder);
      slot.append(stage);
      document.body.append(root);
      document.documentElement.classList.add('zen-on');
      lastKey = '';
      wake();
      refresh?.();
      cancelAnimationFrame(winRaf);
      copyWindow();
      if (canFullscreen()) document.documentElement.requestFullscreen().catch(() => {});
      requestAnimationFrame(() => root.focus({ preventScroll: true }));
    } else {
      clearTimeout(hideTimer);
      cancelAnimationFrame(winRaf);
      wentFull = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      placeholder?.replaceWith(stage);
      placeholder = null;
      root.remove();
      document.documentElement.classList.remove('zen-on');
    }
    window.dispatchEvent(new Event('resize'));
  }

  let wentFull = false;
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) wentFull = true;
    if (on && !document.fullscreenElement && wentFull) {
      // Esc in browser fullscreen exits fullscreen first: leave zen too
      toggle(false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || modalOpen() || isTypingTarget(e.target as HTMLElement | null)) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggle();
    } else if (on && e.key === 'Escape') {
      e.preventDefault();
      toggle(false);
    } else if (on) wake();
  });

  return {
    get active() {
      return on;
    },
    toggle,
    update(state, now, sim, weather, visiting) {
      if (!on) return;
      const v = deriveSession(state, now);
      setText(timer, v.timer);
      setText(sub, visiting ? 'Visiting — your timer keeps going' : v.sub);
      setText(chip, `${weatherIcon(weather, sim.isNight)} Day ${sim.day} · ${sim.seasonName} · ${sim.clock}`);
      root.dataset.status = v.status;
      const key = `${v.status}|${visiting}`;
      if (key === lastKey) return;
      lastKey = key;
      const idle = v.status === 'idle';
      start.hidden = !idle || visiting;
      primary.hidden = idle;
      end.hidden = idle;
      timer.hidden = idle && visiting;
      primary.className = 'btn zen-btn ' + (v.status === 'running' ? 'btn-primary' : 'btn-go');
      primary.textContent = v.status === 'running' ? '❚❚ Pause' : v.status === 'break' ? '⏭ Skip break' : v.status === 'check' ? '✓ Still here' : '▶ Resume';
    },
  };
}
