// Room canvas stage + session panel (timer, controls, daily goal).
import type { AppState } from '../core/types';
import type { SimTime } from '../core/sim';
import type { Weather } from '../core/weather';
import { h, setText, svg } from './dom';
import { formatShort, weatherIcon, weatherName } from './format';
import { deriveSession, goalProgress, todayMs, type SessionStatus } from './viewmodel';
import type { Ctx } from './context';
import type { SessionController } from './session';
import { MIN } from '../core/time';
import { dailyQuests } from '../core/quests';
import { nextQuestLine } from './goalsvm';

export interface RoomView {
  stage: HTMLElement;
  panel: HTMLElement;
  canvas: HTMLCanvasElement;
  update(state: AppState, now: number, sim: SimTime, weather: Weather): void;
}

const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

export function createRoomView(ctx: Ctx, sc: SessionController): RoomView {
  const canvas = h('canvas', { class: 'room-canvas', role: 'img', 'aria-label': 'Your study room' });
  const simChip = h('div', { class: 'sim-chip' });
  const stage = h('div', { class: 'stage' }, canvas, simChip);

  const timer = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Study time this session' }, '00:00:00');
  const sub = h('div', { class: 'sub' });
  const coinLine = h('div', { class: 'coinline' });

  const modeBtn = (pomo: boolean, label: string) =>
    h(
      'button',
      {
        type: 'button',
        class: 'seg',
        role: 'radio',
        onclick: () => {
          ctx.prefs.pomodoro = pomo;
          ctx.savePrefs();
          renderMode();
          last = '';
          startBtn.textContent = startLabel();
        },
      },
      label,
    );
  const freeBtn = modeBtn(false, '⏱ Free timer');
  const pomoBtn = modeBtn(true, '🍅 Pomodoro');
  const modeToggle = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Timer mode' }, freeBtn, pomoBtn);
  const renderMode = () => {
    freeBtn.setAttribute('aria-checked', String(!ctx.prefs.pomodoro));
    pomoBtn.setAttribute('aria-checked', String(ctx.prefs.pomodoro));
  };
  renderMode();

  const startLabel = () => (ctx.prefs.pomodoro ? `▶ Start focus · ${ctx.store.get().settings.pomodoroWorkMin} min` : '▶ Start studying');
  const startBtn = h('button', { type: 'button', class: 'btn btn-go btn-big', onclick: () => sc.start() }, '▶ Start studying');
  const pauseBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => sc.primary() }, '❚❚ Pause');
  const endBtn = h('button', { type: 'button', class: 'btn btn-danger btn-big', onclick: () => sc.end() }, '■ End');
  const btns = h('div', { class: 'btns' }, startBtn, pauseBtn, endBtn);

  const ringFg = svg('circle', { cx: 24, cy: 24, r: RING_R, class: 'ring-fg', 'stroke-dasharray': RING_C.toFixed(2), 'stroke-dashoffset': RING_C.toFixed(2) });
  const ring = svg('svg', { viewBox: '0 0 48 48', class: 'ring', 'aria-hidden': 'true' }, svg('circle', { cx: 24, cy: 24, r: RING_R, class: 'ring-bg' }), ringFg);
  const ringPct = h('span', { class: 'ring-pct' });
  const goalToday = h('div', { class: 'goal-today' });
  const goalOf = h('div', { class: 'goal-of muted' });
  const goal = h(
    'div',
    { class: 'goal', role: 'progressbar', 'aria-label': 'Daily goal', 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div', { class: 'ring-wrap' }, ring, ringPct),
    h('div', null, goalToday, goalOf),
  );

  // nudge towards the closest daily quest (tap → Goals)
  const nextQuest = h('button', { type: 'button', class: 'next-quest', hidden: true, onclick: () => ctx.showTab('goals') });
  let questAt = 0;
  let questFor: AppState | null = null;

  const panel = h('section', { class: 'panel session', 'aria-label': 'Study session' }, timer, sub, coinLine, modeToggle, btns, goal, nextQuest);

  let last = '';
  let lastStatus: SessionStatus | null = null;

  return {
    stage,
    panel,
    canvas,
    update(state, now, sim, weather) {
      const v = deriveSession(state, now);
      setText(timer, v.timer);
      setText(sub, v.sub);
      setText(coinLine, v.coinLine);
      coinLine.hidden = !v.coinLine;
      setText(simChip, `Day ${sim.day} · ${sim.seasonName} (day ${sim.dayOfSeason}/10) · ${sim.clock} ${weatherIcon(weather, sim.isNight)}`);
      simChip.title = weatherName(weather);
      panel.dataset.status = v.status;

      const key = `${v.status}|${ctx.prefs.pomodoro}|${state.settings.pomodoroWorkMin}`;
      if (key !== last) {
        last = key;
        const idle = v.status === 'idle';
        modeToggle.hidden = !idle;
        startBtn.hidden = !idle;
        pauseBtn.hidden = idle;
        endBtn.hidden = idle;
        startBtn.textContent = startLabel();
        pauseBtn.className = 'btn btn-big ' + (v.status === 'running' ? 'btn-primary' : 'btn-go');
        pauseBtn.textContent =
          v.status === 'running' ? '❚❚ Pause' : v.status === 'break' ? '⏭ Skip break' : v.status === 'check' ? '✓ Still here' : '▶ Resume';
        if (lastStatus !== null && lastStatus !== v.status && document.activeElement && btns.contains(document.activeElement)) {
          // keep keyboard focus on a visible button after the layout swaps
          (idle ? startBtn : pauseBtn).focus({ preventScroll: true });
        }
        lastStatus = v.status;
      }

      const today = todayMs(state, now);
      const p = goalProgress(state, now);
      ringFg.setAttribute('stroke-dashoffset', (RING_C * (1 - p)).toFixed(2));
      goal.classList.toggle('done', p >= 1);
      setText(ringPct, p >= 1 ? '✓' : `${Math.floor(p * 100)}%`);
      goal.setAttribute('aria-valuenow', String(Math.floor(p * 100)));
      setText(goalToday, `Today: ${formatShort(today)}`);
      goal.title = p >= 1 ? 'Daily goal reached' : `Daily goal: ${formatShort(state.settings.dailyGoalMin * MIN)}`;
      if (state !== questFor || now - questAt > 5000) {
        questFor = state;
        questAt = now;
        const nq = nextQuestLine(dailyQuests(state, now));
        nextQuest.hidden = !nq;
        if (nq) {
          setText(nextQuest, nq.text);
          nextQuest.classList.toggle('ready', nq.ready);
          nextQuest.title = 'Open Goals';
        }
      }
      setText(goalOf, p >= 1 ? `Goal of ${formatShort(state.settings.dailyGoalMin * MIN)} reached 🎉` : `of ${formatShort(state.settings.dailyGoalMin * MIN)} daily goal`);
    },
  };
}
