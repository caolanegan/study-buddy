// Settings: sound, timer, notifications, cloud sync, data.
import { unpublishNow } from './social';
import * as actions from '../core/actions';
import type { Settings } from '../core/types';
import { loadSyncConfig, saveSyncConfig } from '../sync/cloud';
import { h, mount } from './dom';
import { formatAgo } from './format';
import { confirmDialog, toast } from './overlay';
import { SYNC_LABEL } from './header';
import { clearPrefs } from './prefs';
import type { Ctx } from './context';

const ENV_SYNC = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export function createSettingsView(ctx: Ctx) {
  const el = h('section', { class: 'view view-settings', 'aria-label': 'Settings' });
  let syncMsg = '';
  let busy = false;

  const update = (patch: Partial<Settings>) => ctx.store.set(actions.updateSettings(ctx.store.get(), patch, ctx.now()));

  function toggle(label: string, desc: string, checked: boolean, onChange: (v: boolean) => void) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked, 'data-k': label, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
    return h('label', { class: 'row switch-row' }, h('span', { class: 'row-text' }, h('span', null, label), desc ? h('span', { class: 'muted small' }, desc) : null), input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
  }

  function num(label: string, value: number, min: number, max: number, step: number, unit: string, onCommit: (v: number) => void) {
    const input = h('input', { type: 'number', min, max, step, value: String(value), inputmode: 'numeric', 'aria-label': label, 'data-k': label });
    input.addEventListener('change', () => {
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = value;
      v = Math.min(max, Math.max(min, v));
      input.value = String(v);
      onCommit(v);
    });
    return h('label', { class: 'row' }, h('span', { class: 'row-text' }, label), h('span', { class: 'num-wrap' }, input, h('span', { class: 'muted small' }, unit)));
  }

  function notifications() {
    const supported = typeof Notification !== 'undefined';
    const perm = supported ? Notification.permission : 'unsupported';
    const text =
      perm === 'granted'
        ? 'On ✓'
        : perm === 'denied'
          ? 'Blocked — enable notifications for this site in your browser settings.'
          : perm === 'unsupported'
            ? 'Not supported here. On iPhone/iPad, add Study Buddy to your Home Screen first.'
            : 'Off';
    return section(
      'Notifications',
      h('p', { class: 'muted small' }, 'Used only for the hourly “still studying?” check and pomodoro break / focus changes while the app is in the background.'),
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'row-text' }, text),
        perm === 'default'
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small btn-primary',
                onclick: async () => {
                  try {
                    await Notification.requestPermission();
                  } catch {
                    /* old Safari */
                  }
                  render(true);
                },
              },
              'Enable',
            )
          : null,
      ),
    );
  }

  function cloudSection() {
    const { cloud } = ctx;
    const cfg = loadSyncConfig();
    const msg = syncMsg || (cloud.lastError && cloud.status === 'error' ? cloud.lastError : '');
    const msgEl = msg ? h('p', { class: 'form-error', role: 'alert' }, msg) : null;
    const intro = h('p', { class: 'muted small' }, 'Keep your progress in sync between iPhone, iPad and Mac with a free Supabase project.');

    if (!cfg) {
      const url = h('input', { type: 'url', placeholder: 'https://xyz.supabase.co', autocomplete: 'off', spellcheck: 'false' });
      const key = h('input', { type: 'text', placeholder: 'anon public key', autocomplete: 'off', spellcheck: 'false' });
      return section(
        'Cloud sync',
        intro,
        h('label', { class: 'field' }, 'Supabase URL', url),
        h('label', { class: 'field' }, 'Anon key', key),
        msgEl,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            onclick: async () => {
              const u = url.value.trim();
              const k = key.value.trim();
              if (!/^https:\/\/\S+$/.test(u) || k.length < 20) {
                syncMsg = 'Enter the project URL (https://…) and its anon key from Supabase → Project settings → API.';
                return render(true);
              }
              syncMsg = '';
              saveSyncConfig({ url: u, anonKey: k });
              await cloud.configure({ url: u, anonKey: k });
              render(true);
            },
          },
          'Save',
        ),
      );
    }

    const signedIn = !!cloud.email && cloud.status !== 'signed-out' && cloud.status !== 'disabled';
    const status = h('div', { class: 'row' }, h('span', { class: 'row-text' }, 'Status'), h('span', { class: 'sync-status' }, h('span', { class: 'dot', 'data-s': cloud.status, 'aria-hidden': 'true' }), ' ', SYNC_LABEL[cloud.status]));
    const forget = ENV_SYNC
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small btn-ghost',
            onclick: async () => {
              if (!(await confirmDialog('Disconnect sync server?', 'Your data stays on this device. You can reconnect any time.', 'Disconnect'))) return;
              await cloud.signOut().catch(() => {});
              saveSyncConfig(null);
              await cloud.configure(null);
              render(true);
            },
          },
          'Change server',
        );

    if (signedIn) {
      return section(
        'Cloud sync',
        h('div', { class: 'row' }, h('span', { class: 'row-text' }, 'Account'), h('b', { class: 'ellipsis' }, cloud.email)),
        status,
        h('div', { class: 'row' }, h('span', { class: 'row-text' }, 'Last synced'), h('span', null, cloud.lastSyncedAt ? formatAgo(cloud.lastSyncedAt, Date.now()) : 'never')),
        msgEl,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => void cloud.syncNow() }, 'Sync now'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small btn-ghost',
              onclick: async () => {
                await cloud.signOut();
                render(true);
              },
            },
            'Sign out',
          ),
          forget,
        ),
      );
    }

    const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'At least 6 characters', minlength: 6, required: true });
    const run = async (kind: 'in' | 'up') => {
      if (busy) return;
      if (!email.value.includes('@') || pw.value.length < 6) {
        syncMsg = 'Enter your email and a password of at least 6 characters.';
        return render(true);
      }
      busy = true;
      syncMsg = kind === 'in' ? 'Signing in…' : 'Creating account…';
      render(true);
      const err = kind === 'in' ? await cloud.signIn(email.value.trim(), pw.value) : await cloud.signUp(email.value.trim(), pw.value);
      busy = false;
      syncMsg = err ?? '';
      if (!err) toast(kind === 'in' ? 'Signed in — syncing' : 'Account created — syncing', '☁️');
      render(true);
    };
    const form = h(
      'form',
      {
        class: 'sync-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void run('in');
        },
      },
      h('label', { class: 'field' }, 'Email', email),
      h('label', { class: 'field' }, 'Password', pw),
      msgEl,
      h(
        'div',
        { class: 'btn-row' },
        h('button', { type: 'submit', class: 'btn btn-small btn-primary', disabled: busy }, 'Sign in'),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', disabled: busy, onclick: () => void run('up') }, 'Create account'),
        forget,
      ),
    );
    return section('Cloud sync', intro, status, form);
  }

  function dataSection() {
    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) throw new Error('not a Study Buddy export');
        ctx.store.mergeIn(data);
        toast('Imported and merged with your data', '📥');
      } catch (e) {
        toast(`Import failed: ${e instanceof Error ? e.message : 'invalid file'}`, '⚠️', 6000);
      }
    });
    return section(
      'Your data',
      h('p', { class: 'muted small' }, 'Everything is stored on this device. Export a backup any time; importing merges it with what’s here.'),
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small btn-ghost',
            onclick: () => {
              const blob = new Blob([JSON.stringify(ctx.store.get(), null, 2)], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: `study-buddy-${new Date().toISOString().slice(0, 10)}.json` });
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            },
          },
          '⬇ Export',
        ),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => file.click() }, '⬆ Import'),
        file,
      ),
      h(
        'div',
        { class: 'danger-zone' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small btn-danger',
            onclick: async () => {
              if (!(await confirmDialog('Reset all data?', 'This deletes every session, coin, purchase and achievement on this device.', 'Continue', true))) return;
              if (!(await confirmDialog('Are you absolutely sure?', 'There is no undo. Export a backup first if you might want it back.', 'Reset everything', true))) return;
              if (ctx.cloud.email) {
                // take me off the leaderboards first (needs to be signed in)
                await unpublishNow().catch(() => {});
                await ctx.cloud.signOut().catch(() => {});
              }
              ctx.store.set(actions.defaultState());
              clearPrefs();
              toast('All data reset', '🧹');
            },
          },
          'Reset all data',
        ),
        ctx.cloud.email ? h('p', { class: 'muted small' }, 'Resetting signs you out of sync on this device; your cloud copy is kept.') : null,
      ),
    );
  }

  /** Buddy & room: customise, share, speech bubbles (actions provided by the world layer). */
  function buddySection() {
    const s = ctx.store.get();
    const btn = (label: string, kind: string, fn?: () => unknown) =>
      fn ? h('button', { type: 'button', class: `btn btn-small ${kind}`, onclick: () => void fn() }, label) : null;
    return section(
      'Buddy & room',
      h('p', { class: 'muted small' }, `${s.profile.appearance.name}’s look, the room and the view from the window.`),
      h(
        'div',
        { class: 'btn-row' },
        btn('✏️ Customise', 'btn-primary', ctx.openCustomize && (() => ctx.openCustomize?.())),
        btn('📤 Share my room', 'btn-ghost', ctx.shareRoom),
        btn('🔗 Copy visit link', 'btn-ghost', ctx.copyVisitLink),
      ),
      toggle('Speech bubbles', 'Your buddy chats, reacts and cheers you on', s.settings.bubbles !== false, (v) => update({ bubbles: v })),
    );
  }

  function section(title: string, ...children: (Node | null)[]) {
    return h('div', { class: 'card settings-card' }, h('h3', null, title), children);
  }

  /** Re-render unless the user is typing in one of our fields (force = after our own actions). */
  function render(force = false) {
    const ae = document.activeElement;
    if (!force && ae && el.contains(ae) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName) && (ae as HTMLInputElement).type !== 'checkbox') return;
    const focusKey = ae instanceof HTMLElement && el.contains(ae) ? ae.dataset.k : undefined;
    const s = ctx.store.get().settings;
    const vol = h('input', { type: 'range', min: 0, max: 100, step: 1, value: String(Math.round(s.volume * 100)), 'aria-label': 'Volume', 'data-k': 'volume' });
    vol.addEventListener('input', () => ctx.audio.setVolume(Number(vol.value) / 100));
    vol.addEventListener('change', () => update({ volume: Number(vol.value) / 100 }));
    mount(
      el,
      h('div', { class: 'view-head' }, h('h2', null, 'Settings')),
      buddySection(),
      section(
        'Sound',
        toggle('Lo-fi music', 'Soft generated beats while you study', s.music, (v) => {
          void ctx.audio.unlock();
          update({ music: v });
        }),
        toggle('Keyboard typing', 'Soft key clicks while your buddy works', s.typing, (v) => {
          void ctx.audio.unlock();
          update({ typing: v });
        }),
        toggle('Ambience', 'Rain, birds, passing cars and pets', s.ambience, (v) => {
          void ctx.audio.unlock();
          update({ ambience: v });
        }),
        toggle('Sound effects', 'Coins, chimes and button sounds', s.sound, (v) => {
          void ctx.audio.unlock();
          update({ sound: v });
        }),
        h('label', { class: 'row' }, h('span', { class: 'row-text' }, 'Volume'), vol),
      ),
      section(
        'Timer',
        num('Pomodoro focus', s.pomodoroWorkMin, 1, 180, 1, 'min', (v) => update({ pomodoroWorkMin: v })),
        num('Short break', s.pomodoroBreakMin, 1, 60, 1, 'min', (v) => update({ pomodoroBreakMin: v })),
        num('Long break (every 4th)', s.pomodoroLongBreakMin, 1, 90, 1, 'min', (v) => update({ pomodoroLongBreakMin: v })),
        num('Daily goal', s.dailyGoalMin, 5, 1440, 5, 'min', (v) => update({ dailyGoalMin: v })),
      ),
      notifications(),
      cloudSection(),
      dataSection(),
      h(
        'p',
        { class: 'muted small about' },
        'Study Buddy · 1 study hour = 1 day in the room · 10 days per season. Tip: on iPhone, tap Share → “Add to Home Screen” to install.',
      ),
    );
    if (focusKey) el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  return { el, render };
}
