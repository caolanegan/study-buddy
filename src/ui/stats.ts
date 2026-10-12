// Stats: totals, last-7-days bars, 12-week heatmap, session history + manual entry.
import * as actions from '../core/actions';
import type { Session } from '../core/types';
import { dailyTotals, lifetimeCoins, streakInfo, totalStudiedMs } from '../core/economy';
import { simTime } from '../core/sim';
import { DAY_MS, HOUR, MIN, formatHours } from '../core/time';
import { h, mount } from './dom';
import {
  formatClockTime,
  formatCoins,
  formatDayLabel,
  formatMult,
  formatShort,
  parseLocalDateTime,
  toDateInput,
  toTimeInput,
} from './format';
import { confirmDialog, openModal, toast } from './overlay';
import { heatmap, lastNDays, validateManual } from './viewmodel';
import { subjectColor, subjectTotals } from './goalsvm';
import type { Ctx } from './context';

const PAGE = 25;

export function createStatsView(ctx: Ctx) {
  const el = h('section', { class: 'view view-stats', 'aria-label': 'Stats' });
  let shown = PAGE;
  let subjectRange: '30d' | 'all' = '30d';

  const tile = (v: string, k: string) => h('div', { class: 'tile' }, h('div', { class: 'tile-v' }, v), h('div', { class: 'tile-k' }, k));

  function weekChart(daily: Record<string, number>, now: number, goalMin: number) {
    const days = lastNDays(daily, now, 7);
    const goal = goalMin * MIN;
    const max = Math.max(goal, ...days.map((d) => d.ms), HOUR);
    const total = days.reduce((t, d) => t + d.ms, 0);
    return h(
      'figure',
      { class: 'card chart' },
      h('figcaption', null, h('h3', null, 'Last 7 days'), h('span', { class: 'muted small' }, `${formatShort(total)} total`)),
      h(
        'div',
        { class: 'bars' },
        h(
          'div',
          { class: 'plot', role: 'list' },
          h('div', { class: 'goal-line', style: `bottom:${(goal / max) * 100}%`, title: `Daily goal: ${formatShort(goal)}` }, h('span', null, 'goal')),
          days.map((d) => {
            const pct = (d.ms / max) * 100;
            return h(
              'div',
              { class: `bar-col ${d.isToday ? 'today' : ''}`, role: 'listitem', title: `${d.label}: ${formatShort(d.ms)}`, 'aria-label': `${d.label}: ${formatShort(d.ms)}` },
              h('div', { class: `bar ${d.ms >= goal ? 'met' : ''}`, style: `height:${d.ms ? Math.max(1.5, pct) : 0}%` }),
              d.ms >= MIN ? h('div', { class: 'bar-v', style: `bottom:calc(${pct}% + 3px)` }, formatShort(d.ms)) : null,
            );
          }),
        ),
        h('div', { class: 'bar-labels', 'aria-hidden': 'true' }, days.map((d) => h('span', { class: d.isToday ? 'today' : '' }, d.isToday ? 'Today' : d.label))),
      ),
    );
  }

  function bySubject(all: Session[], now: number) {
    const since = subjectRange === '30d' ? now - 30 * DAY_MS : null;
    const { subjects, untaggedMs } = subjectTotals(all, since);
    const max = Math.max(1, ...subjects.map((x) => x.ms));
    const seg = h(
      'div',
      { class: 'segmented mini-seg', role: 'radiogroup', 'aria-label': 'Subject time range' },
      (['30d', 'all'] as const).map((r) =>
        h(
          'button',
          {
            type: 'button',
            class: 'seg',
            role: 'radio',
            'aria-checked': String(subjectRange === r),
            onclick: () => {
              subjectRange = r;
              render();
            },
          },
          r === '30d' ? '30 days' : 'All time',
        ),
      ),
    );
    return h(
      'figure',
      { class: 'card chart subjects-chart' },
      h('figcaption', null, h('h3', null, 'By subject'), seg),
      subjects.length
        ? h(
            'ul',
            { class: 'sbars' },
            subjects.slice(0, 8).map((x) =>
              h(
                'li',
                { class: 'sbar-row', title: `${x.name}: ${formatShort(x.ms)} · ${x.sessions} session${x.sessions === 1 ? '' : 's'}` },
                h('span', { class: 'sbar-name ellipsis' }, x.name),
                h('span', { class: 'sbar-track' }, h('span', { class: 'sbar-fill', style: `width:${Math.max(2, (x.ms / max) * 100).toFixed(1)}%;--c:${x.color}` })),
                h('span', { class: 'sbar-v' }, formatShort(x.ms)),
              ),
            ),
          )
        : h('p', { class: 'muted small empty' }, all.length ? 'Tag your next session with a subject when it ends to see where your time goes.' : 'Finish a session and tag what you studied to see it here.'),
      subjects.length && untaggedMs >= MIN ? h('p', { class: 'muted small sbar-foot' }, `+ ${formatShort(untaggedMs)} untagged`) : null,
    );
  }

  function heat(daily: Record<string, number>, now: number) {
    const cols = heatmap(daily, now, 12);
    return h(
      'figure',
      { class: 'card chart' },
      h('figcaption', null, h('h3', null, 'Last 12 weeks')),
      h(
        'div',
        { class: 'heat-wrap' },
        h('div', { class: 'heat-days muted', 'aria-hidden': 'true' }, ['M', '', 'W', '', 'F', '', 'S'].map((d) => h('span', null, d))),
        h(
          'div',
          { class: 'heat', role: 'grid', 'aria-label': 'Study time per day, last 12 weeks' },
          cols.map((col) =>
            h(
              'div',
              { class: 'heat-col', role: 'row' },
              col.map((c) =>
                h('span', {
                  class: `cell l${c.level} ${c.future ? 'future' : ''}`,
                  role: 'gridcell',
                  title: c.future ? '' : `${c.key}: ${formatShort(c.ms)}`,
                  'aria-label': c.future ? undefined : `${c.key}: ${formatShort(c.ms)}`,
                }),
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'heat-legend muted small', 'aria-hidden': 'true' },
        'Less ',
        [0, 1, 2, 3, 4].map((l) => h('span', { class: `cell l${l}` })),
        ' More',
      ),
    );
  }

  function row(s: Session) {
    return h(
      'li',
      { class: 'hist-row' },
      h(
        'div',
        { class: 'hist-main' },
        h('div', { class: 'hist-date' }, `${formatDayLabel(s.start)} · ${formatClockTime(s.start)}`),
        h(
          'div',
          { class: 'hist-meta' },
          h('b', null, formatShort(s.activeMs)),
          h('span', { class: 'coin' }, ` +${formatCoins(s.coins)} 🪙`),
          s.multiplier > 1 ? h('span', { class: 'muted' }, ` ${formatMult(s.multiplier)}`) : null,
          s.pomodoros ? h('span', null, ` · 🍅 ${s.pomodoros}`) : null,
          s.manual ? h('span', { class: 'tag' }, 'manual') : null,
          s.subject ? h('span', { class: 'subject-tag', style: `--c:${subjectColor(s.subject)}` }, s.subject) : null,
        ),
        s.note ? h('div', { class: 'hist-note' }, `“${s.note}”`) : null,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': `Delete session from ${formatDayLabel(s.start)}`,
          title: 'Delete session',
          onclick: async () => {
            const ok = await confirmDialog(
              'Delete this session?',
              `${formatShort(s.activeMs)} on ${formatDayLabel(s.start)} and its ${formatCoins(s.coins)} coins will be removed. This can’t be undone.`,
              'Delete',
              true,
            );
            if (ok) {
              ctx.store.set(actions.deleteSession(ctx.store.get(), s.id));
              toast('Session deleted', '🗑');
            }
          },
        },
        '🗑',
      ),
    );
  }

  function addManual() {
    const now = ctx.now();
    const def = now - HOUR;
    const date = h('input', { type: 'date', value: toDateInput(def), max: toDateInput(now), required: true });
    const time = h('input', { type: 'time', value: toTimeInput(def), required: true });
    const hrs = h('input', { type: 'number', min: 0, max: 24, step: 1, value: '1', inputmode: 'numeric' });
    const mins = h('input', { type: 'number', min: 0, max: 59, step: 1, value: '0', inputmode: 'numeric' });
    const err = h('p', { class: 'form-error', role: 'alert' });
    openModal({
      title: 'Add a session',
      icon: '✍️',
      body: [
        h('p', { class: 'muted small' }, 'Forgot to start the timer? Log it here. Manual sessions earn base coins (no streak bonus).'),
        h(
          'div',
          { class: 'form-grid' },
          h('label', null, 'Date', date),
          h('label', null, 'Start time', time),
          h('label', null, 'Hours', hrs),
          h('label', null, 'Minutes', mins),
        ),
        err,
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Add session',
          kind: 'primary',
          onClick: () => {
            const start = parseLocalDateTime(date.value, time.value);
            const dur = (Number(hrs.value || 0) * 60 + Number(mins.value || 0)) * MIN;
            const nowTs = ctx.now();
            const e = validateManual(start, dur, nowTs);
            if (e) {
              err.textContent = e;
              return false;
            }
            const r = actions.addManualSession(ctx.store.get(), start, dur, nowTs);
            if (!r.session) {
              err.textContent = 'That session couldn’t be added.';
              return false;
            }
            ctx.store.set(r.state);
            ctx.audio.play('coin');
            toast(`Added ${formatShort(dur)} · +${formatCoins(r.session.coins)} coins`, '✍️');
          },
        },
      ],
    });
  }

  function render() {
    const state = ctx.store.get();
    const now = ctx.now();
    const daily = dailyTotals(state, now);
    const streak = streakInfo(daily, now);
    const total = totalStudiedMs(state, now);
    const sim = simTime(total);
    const sessions = [...state.sessions].sort((a, b) => b.start - a.start);
    const pomos = state.sessions.reduce((t, s) => t + s.pomodoros, 0);
    mount(
      el,
      h('div', { class: 'view-head' }, h('h2', null, 'Stats')),
      h(
        'div',
        { class: 'tiles' },
        tile(`${formatHours(total)}h`, 'total studied'),
        tile(String(state.sessions.length), 'sessions'),
        tile(`${streak.current} 🔥`, 'current streak'),
        tile(String(streak.best), 'best streak'),
        tile(formatCoins(lifetimeCoins(state)), 'lifetime coins'),
        tile(String(pomos), 'pomodoros'),
        h(
          'div',
          { class: 'tile tile-wide' },
          h('div', { class: 'tile-v' }, `Day ${sim.day} · ${sim.seasonName}`),
          h('div', { class: 'tile-k' }, `Year ${sim.year} in the room · day ${sim.dayOfSeason}/10 of the season`),
        ),
      ),
      weekChart(daily, now, state.settings.dailyGoalMin),
      bySubject(state.sessions, now),
      heat(daily, now),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'view-head' },
          h('h3', null, 'Sessions'),
          h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: addManual }, '＋ Add manually'),
        ),
        sessions.length
          ? h('ul', { class: 'hist' }, sessions.slice(0, shown).map(row))
          : h('p', { class: 'muted empty' }, 'No sessions yet — press Start in the room, or add one manually.'),
        sessions.length > shown
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn-ghost btn-small more',
                onclick: () => {
                  shown += PAGE;
                  render();
                },
              },
              `Show more (${sessions.length - shown})`,
            )
          : null,
      ),
    );
  }
  return { el, render };
}
