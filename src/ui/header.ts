// Top bar: total hours, coins, streak + multiplier, sync status.
import type { AppState } from '../core/types';
import type { SyncStatus } from '../sync/cloud';
import { balance, dailyTotals, multiplierFor, streakInfo, totalStudiedMs } from '../core/economy';
import { formatHours } from '../core/time';
import { h, setText } from './dom';
import { formatCoins, formatMult } from './format';
import type { Ctx } from './context';

export const SYNC_LABEL: Record<SyncStatus, string> = {
  disabled: 'Cloud sync off',
  'signed-out': 'Not signed in to sync',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline — will sync later',
  error: 'Sync error',
};

export interface Header {
  el: HTMLElement;
  update(state: AppState, now: number): void;
  setSync(s: SyncStatus): void;
}

export function createHeader(ctx: Ctx): Header {
  const hours = h('b');
  const coins = h('b');
  const streak = h('b');
  const mult = h('span', { class: 'mult' });
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const syncBtn = h('button', { type: 'button', class: 'sync-btn', onclick: () => ctx.showTab('settings') }, dot);
  const el = h(
    'header',
    { class: 'topbar' },
    h('h1', { class: 'brand' }, h('span', { 'aria-hidden': 'true' }, '📚'), h('span', { class: 'brand-text' }, ' Study Buddy')),
    h(
      'div',
      { class: 'chips' },
      h('span', { class: 'chip', title: 'Total hours studied' }, h('span', { 'aria-hidden': 'true' }, '⏱ '), hours),
      h('span', { class: 'chip', title: 'Coins' }, h('span', { 'aria-hidden': 'true' }, '🪙 '), coins),
      h('span', { class: 'chip', title: 'Study streak (days) and coin multiplier' }, h('span', { 'aria-hidden': 'true' }, '🔥 '), streak, mult),
      syncBtn,
    ),
  );
  return {
    el,
    update(state, now) {
      setText(hours, `${formatHours(totalStudiedMs(state, now))}h`);
      setText(coins, formatCoins(balance(state)));
      const s = streakInfo(dailyTotals(state, now), now);
      setText(streak, String(s.current));
      setText(mult, ` ${formatMult(multiplierFor(s.current))}`);
      mult.classList.toggle('hot', s.current > 0);
    },
    setSync(s) {
      dot.dataset.s = s;
      syncBtn.title = SYNC_LABEL[s];
      syncBtn.setAttribute('aria-label', `${SYNC_LABEL[s]} — open settings`);
    },
  };
}
