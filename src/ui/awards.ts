// Achievements grid.
import { ACHIEVEMENTS } from '../core/achievements';
import { h, mount } from './dom';
import { formatCoins, formatDate } from './format';
import type { Ctx } from './context';

export function createAwardsView(ctx: Ctx) {
  const el = h('section', { class: 'view view-awards', 'aria-label': 'Achievements' });
  function render() {
    const got = ctx.store.get().achievements;
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
    const earned = ACHIEVEMENTS.filter((a) => got[a.id]).reduce((t, a) => t + a.reward, 0);
    const sorted = [...ACHIEVEMENTS].sort((a, b) => Number(!!got[b.id]) - Number(!!got[a.id]));
    mount(
      el,
      h('div', { class: 'view-head' }, h('h2', null, 'Achievements'), h('span', { class: 'chip' }, h('b', null, `${n}`), ` / ${ACHIEVEMENTS.length}`)),
      h('p', { class: 'muted small view-intro' }, n ? `You’ve earned ${formatCoins(earned)} coins from achievements.` : 'Study to unlock achievements — each one pays out coins.'),
      h(
        'ul',
        { class: 'ach-grid' },
        sorted.map((a) => {
          const at = got[a.id];
          return h(
            'li',
            { class: `ach ${at ? 'unlocked' : 'locked'}` },
            h('div', { class: 'ach-badge', 'aria-hidden': 'true' }, at ? a.icon : '🔒'),
            h('div', { class: 'ach-text' }, h('h3', null, a.name), h('p', null, a.desc)),
            h(
              'div',
              { class: 'ach-meta' },
              h('span', { class: 'coin' }, `+${formatCoins(a.reward)} 🪙`),
              h('span', { class: 'muted small' }, at ? `Unlocked ${formatDate(at)}` : 'Locked'),
            ),
          );
        }),
      ),
    );
  }
  return { el, render };
}
