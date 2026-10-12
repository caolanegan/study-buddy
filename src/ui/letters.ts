// The daily letter: an envelope slips into the room once a day; open it for a kind word and coins.
import { dailyTotals, streakInfo } from '../core/economy';
import { letterWaiting, openLetter, todaysLetter } from '../core/letters';
import { h, svg } from './dom';
import { openModal, toast } from './overlay';
import type { Ctx } from './context';

const sfx = (ctx: Ctx, n: string) => ctx.audio.play(n as never);

/** A tiny pixel-art envelope with a heart seal. */
function envelopeArt() {
  const px = (x: number, y: number, w: number, hh: number, fill: string) => svg('rect', { x, y, width: w, height: hh, fill });
  return svg(
    'svg',
    { viewBox: '0 0 16 12', class: 'env-art', 'aria-hidden': 'true', 'shape-rendering': 'crispEdges' },
    px(0, 1, 16, 11, '#3a2a2a'),
    px(1, 2, 14, 9, '#fbf1dc'),
    px(1, 10, 14, 1, '#e4d3b0'),
    // flap
    px(1, 2, 2, 1, '#e8d6b2'), px(3, 3, 2, 1, '#e8d6b2'), px(5, 4, 2, 1, '#e8d6b2'), px(7, 5, 2, 1, '#e8d6b2'),
    px(9, 4, 2, 1, '#e8d6b2'), px(11, 3, 2, 1, '#e8d6b2'), px(13, 2, 2, 1, '#e8d6b2'),
    // heart seal
    px(6, 5, 1, 1, '#d9534f'), px(9, 5, 1, 1, '#d9534f'), px(6, 6, 4, 1, '#d9534f'), px(7, 7, 2, 1, '#d9534f'), px(7, 5, 2, 1, '#e8746f'),
  );
}

export interface LetterUI {
  el: HTMLElement;
  /** Check whether today's letter is waiting (call ~1/s). Returns true the moment one appears. */
  update(now: number, allowed: boolean): boolean;
  open(): void;
}

export function createLetterUI(ctx: Ctx, onCollected?: () => void): LetterUI {
  const el = h(
    'button',
    { type: 'button', class: 'envelope', hidden: true, 'aria-label': 'A letter arrived — open it', title: 'A letter arrived!', onclick: () => open() },
    envelopeArt(),
    h('span', { class: 'env-spark s1', 'aria-hidden': 'true' }, '✦'),
    h('span', { class: 'env-spark s2', 'aria-hidden': 'true' }, '✦'),
  );
  let shown = false;

  function open() {
    const now = ctx.now();
    const state = ctx.store.get();
    if (!letterWaiting(state, now)) return;
    const streak = streakInfo(dailyTotals(state, now), now).current;
    const letter = todaysLetter(state, now, streak);
    void ctx.audio.unlock();
    sfx(ctx, 'paper');
    const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    openModal({
      title: `A letter from ${letter.from}`,
      className: 'letter-modal',
      body: h(
        'div',
        { class: 'paper' },
        h('div', { class: 'paper-head' }, h('span', { class: 'paper-icon', 'aria-hidden': 'true' }, letter.icon), h('span', { class: 'paper-date' }, date)),
        h('p', { class: 'paper-greet' }, `Dear ${state.profile.appearance.name},`),
        h('p', { class: 'paper-body' }, letter.body),
        h('p', { class: 'paper-sign' }, `— ${letter.from}`),
        h('div', { class: 'paper-stamp', 'aria-hidden': 'true' }, letter.icon),
      ),
      actions: [
        {
          label: `Collect +${letter.reward} 🪙`,
          kind: 'primary',
          autofocus: true,
          onClick: () => {
            const r = openLetter(ctx.store.get(), letter, ctx.now());
            if (r.claimed) {
              ctx.store.set(r.state);
              sfx(ctx, 'coin');
              toast(`+${letter.reward} coins from ${letter.from}`, '💌');
              onCollected?.();
            }
          },
        },
      ],
    });
  }

  return {
    el,
    open,
    update(now, allowed) {
      const waiting = allowed && letterWaiting(ctx.store.get(), now);
      el.hidden = !waiting;
      const fresh = waiting && !shown;
      shown = waiting;
      return fresh;
    },
  };
}
