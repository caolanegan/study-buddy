// "What did you study?" picker for the session summary (subject chips + note), saved via annotateSession.
import * as actions from '../core/actions';
import { h } from './dom';
import { recentSubjects, subjectColor } from './goalsvm';
import type { Ctx } from './context';

export interface SubjectPicker {
  el: HTMLElement;
  /** Write the subject / note onto the session (no-op when both are empty). */
  save(): void;
}

export function createSubjectPicker(ctx: Ctx, sessionId: string): SubjectPicker {
  const state = ctx.store.get();
  const recent = recentSubjects(state.sessions.filter((s) => s.id !== sessionId), 6);
  const subject = h('input', {
    type: 'text',
    class: 'subject-input',
    placeholder: recent.length ? 'Or type a subject…' : 'e.g. Maths, Biology, Spanish…',
    maxlength: 40,
    autocomplete: 'off',
    enterkeyhint: 'done',
    'aria-label': 'Subject',
  });
  const note = h('input', {
    type: 'text',
    class: 'note-input',
    placeholder: 'One line about how it went (optional)',
    maxlength: 140,
    autocomplete: 'off',
    enterkeyhint: 'done',
    'aria-label': 'Session note',
  });
  const chips = recent.map((name) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'subject-chip',
        style: `--c:${subjectColor(name)}`,
        'aria-pressed': 'false',
        onclick: () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          subject.value = on ? name : '';
          sync();
          ctx.audio.play('click');
        },
      },
      name,
    );
    return b;
  });
  const sync = () => {
    const v = subject.value.trim().toLowerCase();
    for (const c of chips) c.setAttribute('aria-pressed', String(c.textContent?.toLowerCase() === v));
  };
  subject.addEventListener('input', sync);
  // Enter shouldn't submit/close the sheet
  for (const i of [subject, note]) i.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), i.blur()));

  const el = h(
    'div',
    { class: 'subject-picker' },
    h('h3', null, 'What did you study?'),
    chips.length ? h('div', { class: 'subject-chips' }, chips) : null,
    subject,
    note,
  );
  let saved = false;
  return {
    el,
    save() {
      if (saved) return;
      saved = true;
      const s = subject.value.trim();
      const n = note.value.trim();
      if (!s && !n) return;
      ctx.store.set(actions.annotateSession(ctx.store.get(), sessionId, { subject: s, note: n }));
    },
  };
}
