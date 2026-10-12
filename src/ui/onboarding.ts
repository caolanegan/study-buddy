// First run: meet your buddy → choose a room & view → how it works.
import * as actions from '../core/actions';
import { h } from './dom';
import { openModal } from './overlay';
import { characterEditor, draftOf, previewPane, roomEditor } from './customize';
import type { Ctx } from './context';

const STEPS = [
  { title: 'Meet your study buddy', sub: 'They’ll study with you, cheer you on and grow their room as you go.' },
  { title: 'Choose your room & view', sub: 'Pick a cozy corner and what you see out of the window. You can change it any time.' },
  { title: 'How it works', sub: '' },
];

const HOW: [string, string, string][] = [
  ['⏳', '1 hour = 1 day', 'Every hour you study, a day passes in the room — sunrises, seasons, snow.'],
  ['🪙', 'Coins & streaks', 'Earn coins as you study. Study 30 min a day to build a streak and a bonus multiplier.'],
  ['👆', 'Tap around', 'Tap your buddy, pets and things in the room. Catch shooting stars for coins!'],
  ['💌', 'A daily letter', 'A little letter arrives each day with a kind word and a few coins.'],
  ['🎯', 'Quests & shop', 'Finish quests, then decorate with desks, lamps, pets and more.'],
];

export function openOnboarding(ctx: Ctx, onDone?: () => void) {
  const draft = draftOf(ctx.store.get().profile);
  const pane = previewPane(ctx, draft);
  const onChange = () => pane.refresh();
  const ch = characterEditor(ctx, draft, onChange);
  const rm = roomEditor(ctx, draft, onChange);
  const how = h(
    'ul',
    { class: 'ob-how' },
    HOW.map(([icon, t, d]) => h('li', null, h('span', { class: 'ob-how-icon', 'aria-hidden': 'true' }, icon), h('span', null, h('b', null, t), h('span', { class: 'muted small' }, d)))),
  );
  const panels = [ch.el, rm.el, how];
  const sub = h('p', { class: 'ob-sub muted' });
  const dots = h(
    'div',
    { class: 'ob-dots', 'aria-hidden': 'true' },
    STEPS.map(() => h('span', { class: 'ob-dot' })),
  );
  const stepLabel = h('span', { class: 'visually-hidden' });
  const controls = h('div', { class: 'cz-controls' }, sub, ...panels);
  let step = 0;
  let done = false;

  const back = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go(step - 1) }, '← Back');
  const next = h('button', { type: 'button', class: 'btn btn-go', onclick: () => (step < STEPS.length - 1 ? go(step + 1) : finish(true)) }, 'Next →');
  const skip = h('button', { type: 'button', class: 'btn btn-small ob-skip', onclick: () => finish(false) }, 'Skip');

  const m = openModal({
    title: STEPS[0].title,
    className: 'customize onboarding',
    body: h('div', { class: 'cz-layout' }, pane.el, controls),
    onClose: () => {
      pane.preview.stop();
      if (!done) finish(false);
    },
  });
  const titleEl = m.el.querySelector('.modal-title')!;
  titleEl.after(skip);
  m.el.append(h('div', { class: 'modal-actions ob-actions' }, back, dots, stepLabel, next));

  function go(i: number) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    titleEl.textContent = STEPS[step].title;
    sub.textContent = STEPS[step].sub;
    sub.hidden = !STEPS[step].sub;
    panels.forEach((p, j) => (p.hidden = j !== step));
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j <= step));
    stepLabel.textContent = `Step ${step + 1} of ${STEPS.length}`;
    back.style.visibility = step === 0 ? 'hidden' : '';
    next.textContent = step === STEPS.length - 1 ? '▶ Start studying' : 'Next →';
    m.el.classList.toggle('ob-last', step === STEPS.length - 1);
    controls.scrollTop = 0;
    m.el.querySelector('.modal-body')?.scrollTo?.({ top: 0 });
    requestAnimationFrame(() => next.focus({ preventScroll: true }));
  }

  function finish(start: boolean) {
    if (done) return;
    done = true;
    const s = ctx.store.get();
    if (!draft.appearance.name.trim()) draft.appearance.name = s.profile.appearance.name;
    const next = actions.updateProfile(s, { appearance: draft.appearance, room: draft.room, onboarded: true }, ctx.now());
    // Nothing picked (skipped / clicked straight through): keep the old timestamp, so a buddy customised on
    // another device still wins when sync merges — a new device mustn't overwrite it with the defaults.
    const unchanged = JSON.stringify(next.profile.appearance) === JSON.stringify(s.profile.appearance) && JSON.stringify(next.profile.room) === JSON.stringify(s.profile.room);
    ctx.store.set(unchanged ? { ...next, profileUpdatedAt: s.profileUpdatedAt } : next);
    m.close();
    ctx.audio.play('chime');
    onDone?.();
    if (start) {
      setTimeout(() => {
        const btn = document.querySelector<HTMLButtonElement>('.session .btn-go:not([hidden])');
        btn?.focus({ preventScroll: false });
        btn?.classList.add('pulse-once');
        setTimeout(() => btn?.classList.remove('pulse-once'), 2400);
      }, 60);
    }
  }

  go(0);
  return m;
}
