// Zen mode: the room fills the screen with a minimal, auto-hiding timer overlay.
import type { AppState } from '../core/types';
import type { SimTime } from '../core/sim';
import type { Weather } from '../core/weather';
import { h, isTypingTarget, setText } from './dom';
import { modalOpen } from './overlay';
import { weatherIcon } from './format';
import { deriveSession } from './viewmodel';
import type { SessionController } from './session';

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

export function createZen(stage: HTMLElement, sc: SessionController): Zen {
  const root = h('div', { class: 'zen-root', role: 'region', 'aria-label': 'Zen mode' });
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
  root.append(slot, hud);

  let on = false;
  let placeholder: Comment | null = null;
  let hideTimer = 0;
  let lastKey = '';

  const wake = () => {
    root.classList.remove('hud-hidden');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      // keep controls up while they have keyboard focus
      if (!hud.contains(document.activeElement)) root.classList.add('hud-hidden');
    }, HIDE_AFTER);
  };
  root.addEventListener('pointermove', wake);
  root.addEventListener('pointerdown', wake);
  root.addEventListener('focusin', wake);

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
      if (canFullscreen()) document.documentElement.requestFullscreen().catch(() => {});
      requestAnimationFrame(() => close.focus({ preventScroll: true }));
    } else {
      clearTimeout(hideTimer);
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
