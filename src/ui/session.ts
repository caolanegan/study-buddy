// Session controller: start / pause / resume / end, the "still studying?" check and the summary.
import * as actions from '../core/actions';
import { ACHIEVEMENTS } from '../core/achievements';
import { coinsFor } from '../core/economy';
import { h } from './dom';
import { formatCoins, formatMult, formatShort } from './format';
import { openModal, toast, type ModalHandle } from './overlay';
import { sessionStatus, streakMessage } from './viewmodel';
import type { Ctx } from './context';
import { createSubjectPicker } from './subjects';

export interface SessionController {
  start(): void;
  pause(): void;
  resume(): void;
  confirm(): void;
  end(): void;
  /** Space-bar action: start / pause / resume. */
  primary(): void;
  /** Keep the check modal in sync with state (opens after reload too). */
  syncCheckModal(): void;
}

export function createSessionController(ctx: Ctx): SessionController {
  const { store, audio } = ctx;
  let checkModal: ModalHandle | null = null;

  const c: SessionController = {
    start() {
      void audio.unlock();
      const s = store.get();
      if (s.active) return;
      store.set(actions.start(s, ctx.now(), ctx.prefs.pomodoro));
      audio.play('start');
    },
    pause() {
      store.set(actions.pause(store.get(), ctx.now()));
      audio.play('pause');
    },
    resume() {
      void audio.unlock();
      store.set(actions.resume(store.get(), ctx.now()));
      audio.play('start');
    },
    confirm() {
      store.set(actions.confirm(store.get(), ctx.now()));
      audio.play('click');
    },
    end() {
      const now = ctx.now();
      const r = actions.end(store.get(), now);
      ctx.quietAchievements(r.unlocked);
      store.set(r.state);
      if (!r.session) {
        toast('Session was under a minute, so it wasn’t saved', '⏱');
        return;
      }
      audio.play('end');
      audio.play('coin', { delay: 0.35 });
      if (r.unlocked.length) audio.play('achievement', { delay: 0.9 });
      showSummary(ctx, r, now);
    },
    primary() {
      const st = sessionStatus(store.get().active);
      if (st === 'idle') c.start();
      else if (st === 'running') c.pause();
      else if (st === 'check') c.confirm();
      else c.resume();
    },
    syncCheckModal() {
      const pending = sessionStatus(store.get().active) === 'check';
      if (pending && !checkModal?.isOpen()) {
        checkModal = openModal({
          title: 'Still studying? 📚',
          body: h('p', null, 'It’s been an hour since you last checked in. If we don’t hear back within 5 minutes, the session pauses and time after this check won’t count.'),
          dismissable: false,
          className: 'check-modal',
          actions: [
            { label: 'End session', kind: 'danger', onClick: () => c.end() },
            { label: 'Yes, still going', kind: 'go', autofocus: true, onClick: () => c.confirm() },
          ],
        });
      } else if (!pending && checkModal?.isOpen()) {
        checkModal.close();
        checkModal = null;
      }
    },
  };
  return c;
}

function showSummary(ctx: Ctx, r: actions.EndResult, now: number) {
  const s = r.session!;
  const base = coinsFor(s.activeMs, 1);
  const unlocked = r.unlocked.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter((a) => !!a);
  const reward = unlocked.reduce((t, a) => t + a.reward, 0);
  const picker = createSubjectPicker(ctx, s.id);
  openModal({
    title: 'Session complete!',
    icon: '🎉',
    className: 'summary',
    body: [
      h(
        'div',
        { class: 'summary-stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, formatShort(s.activeMs)), h('div', { class: 'stat-k' }, 'studied')),
        h(
          'div',
          { class: 'stat' },
          h('div', { class: 'stat-v coin' }, `+${formatCoins(s.coins)} 🪙`),
          h('div', { class: 'stat-k' }, s.multiplier > 1 ? `${formatCoins(base)} × ${formatMult(s.multiplier).slice(1)} streak` : 'coins earned'),
        ),
        s.pomodoros ? h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `🍅 ${s.pomodoros}`), h('div', { class: 'stat-k' }, 'pomodoros')) : null,
      ),
      unlocked.length
        ? h(
            'div',
            { class: 'summary-ach' },
            h('h3', null, unlocked.length > 1 ? 'New achievements' : 'New achievement'),
            unlocked.map((a) =>
              h('div', { class: 'ach-row' }, h('span', { class: 'ach-icon', 'aria-hidden': 'true' }, a.icon), h('span', { class: 'ach-name' }, a.name), h('span', { class: 'coin' }, `+${a.reward} 🪙`)),
            ),
            unlocked.length > 1 ? h('div', { class: 'muted small' }, `+${formatCoins(reward)} coins in rewards`) : null,
          )
        : null,
      h('p', { class: 'summary-streak' }, streakMessage(r.state, now)),
      picker.el,
    ],
    onClose: () => picker.save(),
    actions: [
      { label: 'Visit the shop', kind: 'ghost', onClick: () => ctx.showTab('shop') },
      { label: 'Nice!', kind: 'primary', autofocus: true },
    ],
  });
}
