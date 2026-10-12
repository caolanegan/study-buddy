// Goals tab: today's quests, this week's quests and the achievements grid.
import { ACHIEVEMENTS, computeStats } from '../core/achievements';
import { claimQuest, dailyQuests, msUntilReset, weeklyQuests, type QuestView } from '../core/quests';
import { dailyTotals, streakInfo } from '../core/economy';
import { letterWaiting } from '../core/letters';
import { dayKey } from '../core/time';
import { weekMs } from '../sync/leaderboard';
import { h, mount, setText } from './dom';
import { formatCoins, formatDate, formatShort } from './format';
import { toast } from './overlay';
import { achievementProgress, formatResetIn, msUntilWeekReset, questCard } from './goalsvm';
import type { Ctx } from './context';

export interface GoalsHooks {
  /** Open today's letter (provided by the room/letter UI when available). */
  openLetter?: () => void;
}

export function createGoalsView(ctx: Ctx, hooks: GoalsHooks = {}) {
  const el = h('section', { class: 'view view-goals', 'aria-label': 'Goals' });
  const sfx = (n: string) => ctx.audio.play(n as never);
  const dailyReset = h('span', { class: 'reset-in' });
  const weeklyReset = h('span', { class: 'reset-in' });
  let justClaimed: string | null = null;
  let renderedDay = '';

  function claim(q: QuestView, btn: HTMLElement) {
    const now = ctx.now();
    const r = claimQuest(ctx.store.get(), q, now);
    if (!r.claimed) return;
    justClaimed = q.claimId;
    const rect = btn.getBoundingClientRect();
    sfx('quest');
    ctx.audio.play('coin', { delay: 0.25 });
    ctx.store.set(r.state);
    toast(`Quest complete · +${formatCoins(q.def.reward)} coins`, '🪙', 3200, 'quest');
    coinBurst(rect);
  }

  function questItem(q: QuestView) {
    const c = questCard(q);
    const just = justClaimed === q.claimId;
    return h(
      'li',
      { class: `quest q-${c.state} ${just ? 'just-claimed' : ''}` },
      h('div', { class: 'quest-icon', 'aria-hidden': 'true' }, c.state === 'claimed' ? '✓' : c.icon),
      h(
        'div',
        { class: 'quest-main' },
        h('div', { class: 'quest-title' }, c.title),
        h(
          'div',
          { class: 'qbar', role: 'progressbar', 'aria-label': c.title, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(c.pct * 100) },
          h('div', { class: 'qbar-fill', style: `width:${(c.pct * 100).toFixed(1)}%` }),
        ),
        h('div', { class: 'quest-sub' }, h('span', { class: 'quest-prog' }, c.progressText), h('span', { class: 'reward-chip' }, c.reward)),
      ),
      h(
        'div',
        { class: 'quest-side' },
        c.state === 'ready'
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small btn-primary claim-btn',
                'aria-label': `Claim ${c.reward.replace('🪙', 'coins')} for ${c.title}`,
                onclick: (e: Event) => claim(q, e.currentTarget as HTMLElement),
              },
              'Claim',
            )
          : c.state === 'claimed'
            ? h('span', { class: 'claimed-tag' }, 'Claimed')
            : null,
      ),
    );
  }

  function letterCard() {
    const now = ctx.now();
    if (!letterWaiting(ctx.store.get(), now)) return null;
    return h(
      'button',
      {
        type: 'button',
        class: 'card letter-nudge',
        onclick: () => {
          if (hooks.openLetter) return hooks.openLetter();
          // the envelope lives in the room (src/ui/letters.ts): open it directly when it's there
          const env = document.querySelector<HTMLButtonElement>('.envelope');
          if (env) env.click();
          else ctx.showTab('room');
        },
      },
      h('span', { class: 'letter-env', 'aria-hidden': 'true' }, '💌'),
      h('span', { class: 'letter-text' }, h('b', null, 'A letter slipped under your door'), h('span', { class: 'muted small' }, 'Open it for a kind word and a few coins')),
      h('span', { class: 'letter-go', 'aria-hidden': 'true' }, '›'),
    );
  }

  function achievements() {
    const state = ctx.store.get();
    const got = state.achievements;
    const stats = computeStats(state, streakInfo(dailyTotals(state), ctx.now()).best);
    const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
    // unlocked first, then the locked ones closest to done
    const rows = ACHIEVEMENTS.map((a) => ({ a, at: got[a.id], p: got[a.id] ? null : achievementProgress(a, stats) }));
    rows.sort((x, y) => Number(!!y.at) - Number(!!x.at) || (y.p?.pct ?? 0) - (x.p?.pct ?? 0));
    return [
      h('div', { class: 'view-head goals-sub' }, h('h3', null, 'Achievements'), h('span', { class: 'chip' }, h('b', null, `${n}`), ` / ${ACHIEVEMENTS.length}`)),
      h(
        'ul',
        { class: 'ach-grid' },
        rows.map(({ a, at, p }) =>
          h(
            'li',
            { class: `ach ${at ? 'unlocked' : 'locked'}` },
            h('div', { class: 'ach-badge', 'aria-hidden': 'true' }, at ? a.icon : '🔒'),
            h('div', { class: 'ach-text' }, h('h3', null, a.name), h('p', null, a.desc)),
            !at && p && p.pct > 0
              ? h('div', { class: 'ach-prog' }, h('div', { class: 'qbar thin' }, h('div', { class: 'qbar-fill', style: `width:${(p.pct * 100).toFixed(1)}%` })), h('span', { class: 'muted small' }, p.text))
              : null,
            h(
              'div',
              { class: 'ach-meta' },
              h('span', { class: 'coin' }, `+${formatCoins(a.reward)} 🪙`),
              h('span', { class: 'muted small' }, at ? `Unlocked ${formatDate(at)}` : p && p.pct > 0 ? `${Math.floor(p.pct * 100)}%` : 'Locked'),
            ),
          ),
        ),
      ),
    ];
  }

  function updateCountdowns() {
    const now = ctx.now();
    setText(dailyReset, `New quests in ${formatResetIn(msUntilReset(now))}`);
    setText(weeklyReset, `Resets in ${formatResetIn(msUntilWeekReset(now))}`);
  }

  function render() {
    const state = ctx.store.get();
    const now = ctx.now();
    renderedDay = dayKey(now);
    const daily = dailyQuests(state, now);
    const weekly = weeklyQuests(state, now);
    const ready = [...daily, ...weekly].filter((q) => q.done && !q.claimed).length;
    const doneToday = daily.filter((q) => q.claimed).length;
    updateCountdowns();
    mount(
      el,
      h(
        'div',
        { class: 'view-head' },
        h('h2', null, 'Goals'),
        ready ? h('span', { class: 'chip chip-ready' }, `🎁 ${ready} to claim`) : h('span', { class: 'chip' }, h('b', null, String(doneToday)), ' / 3 today'),
      ),
      h('p', { class: 'muted small view-intro' }, 'Fresh quests every day — small wins that add up. Finish them to earn bonus coins.'),
      letterCard(),
      h(
        'div',
        { class: 'card quests-card' },
        h('div', { class: 'quests-head' }, h('h3', null, 'Today’s quests'), dailyReset),
        h('ul', { class: 'quest-list' }, daily.map(questItem)),
        doneToday === daily.length ? h('p', { class: 'quests-done' }, '🌟 All done for today — you’re on fire!') : null,
      ),
      h(
        'div',
        { class: 'card quests-card' },
        h('div', { class: 'quests-head' }, h('h3', null, 'This week'), weeklyReset),
        h('p', { class: 'muted small week-line' }, `${formatShort(weekMs(state, now))} studied since Monday`),
        h('ul', { class: 'quest-list' }, weekly.map(questItem)),
      ),
      achievements(),
    );
    justClaimed = null;
  }

  // keep the countdown fresh and roll over at midnight while the tab is open
  setInterval(() => {
    if (el.hidden || document.hidden || !el.isConnected) return;
    if (dayKey(ctx.now()) !== renderedDay) render();
    else updateCountdowns();
  }, 20_000);

  return { el, render };
}

/** A little shower of coins from the claim button. */
function coinBurst(from: DOMRect) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = h('div', { class: 'coin-burst', 'aria-hidden': 'true', style: `left:${from.left + from.width / 2}px;top:${from.top + from.height / 2}px` });
  for (let i = 0; i < 9; i++) {
    const a = (Math.PI * 2 * i) / 9 + Math.random() * 0.4;
    const d = 38 + Math.random() * 30;
    layer.append(h('span', { style: `--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d - 30).toFixed(0)}px;animation-delay:${i * 18}ms` }, '🪙'));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1100);
}
