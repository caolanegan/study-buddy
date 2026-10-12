// Friends tab: leaderboards (friends / everyone), friend codes, adding friends and sharing your room.
import * as actions from '../core/actions';
import type { Settings } from '../core/types';
import { dailyTotals, streakInfo, totalStudiedMs } from '../core/economy';
import { encodeSnapshot, snapshotOf, visitUrl, type RoomSnapshot } from '../core/share';
import { friendCode, normalizeCode, type BoardEntry } from '../sync/leaderboard';
import { avatarCanvas } from './avatar';
import { h, mount } from './dom';
import { formatCoins } from './format';
import { confirmDialog, openModal, toast } from './overlay';
import { myEntry, onPublishChange, publishError, socialBackend } from './social';
import {
  BOARD_MODES,
  appUrl,
  boardRows,
  emptyBoardText,
  formatBoardHours,
  inviteText,
  quietFriends,
  withMe,
  type BoardMode,
  type BoardRow,
} from './socialvm';
import type { Ctx } from './context';

export interface FriendsHooks {
  /** Open read-only visit mode for a snapshot (falls back to the #visit= link). */
  visit?: (snap: RoomSnapshot) => void;
  /** Share card for my room (falls back to sharing / copying the visit link). */
  shareRoom?: () => void;
}

interface BoardData {
  entries: BoardEntry[] | null;
  error: string | null;
  loading: boolean;
  at: number;
}

const REFRESH_MS = 60_000;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0', readonly: true });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/leaderboard/i.test(m) && /(exist|schema|relation)/i.test(m)) return 'The leaderboard table is missing — re-run supabase/schema.sql in your Supabase project.';
  if (/fetch|network/i.test(m)) return 'Couldn’t reach the server. Check your connection.';
  return m || 'Something went wrong';
}

export function createFriendsView(ctx: Ctx, hooks: FriendsHooks = {}) {
  const el = h('section', { class: 'view view-friends', 'aria-label': 'Friends' });
  const sfx = (n: string) => ctx.audio.play(n as never);
  const data: Record<'friends' | 'global', BoardData> = {
    friends: { entries: null, error: null, loading: false, at: 0 },
    global: { entries: null, error: null, loading: false, at: 0 },
  };
  let mode: BoardMode = 'friends-week';
  let codeDraft = '';
  let lookup: { state: 'idle' | 'busy' | 'found' | 'error'; entry?: BoardEntry | null; msg?: string } = { state: 'idle' };

  const be = () => socialBackend(ctx);
  const src = (m: BoardMode) => (m === 'global-week' ? 'global' : 'friends');
  const update = (patch: Partial<Settings>) =>
    ctx.store.set(actions.updateSettings(ctx.store.get(), patch, ctx.now()));

  async function load(which: 'friends' | 'global', force = false) {
    const d = data[which];
    if (d.loading || !be().userId()) return;
    if (!force && d.entries && ctx.now() - d.at < 15_000) return;
    d.loading = true;
    d.error = null;
    render(true);
    try {
      const now = ctx.now();
      d.entries =
        which === 'global' ? await be().fetchGlobal(now) : await be().fetchFriends(ctx.store.get().friends.map((f) => f.code), now);
      d.at = ctx.now();
    } catch (e) {
      d.error = errText(e);
    } finally {
      d.loading = false;
      render();
    }
  }

  function toggle(label: string, desc: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked, disabled, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
    return h(
      'label',
      { class: `row switch-row ${disabled ? 'is-disabled' : ''}` },
      h('span', { class: 'row-text' }, h('span', null, label), desc ? h('span', { class: 'muted small' }, desc) : null),
      input,
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
    );
  }

  function goToSync() {
    ctx.showTab('settings');
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>('.view-settings .settings-card')].find((c) => c.querySelector('h3')?.textContent === 'Cloud sync');
      if (!card) return;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1600);
    });
  }

  function mySnapshot(): RoomSnapshot {
    const s = ctx.store.get();
    const now = ctx.now();
    return snapshotOf(s, totalStudiedMs(s, now), streakInfo(dailyTotals(s, now), now).current);
  }

  function visit(snap: RoomSnapshot) {
    const open = hooks.visit ?? ctx.openVisit;
    if (open) open(snap);
    else location.hash = 'visit=' + encodeSnapshot(snap);
  }

  async function shareRoom() {
    if (hooks.shareRoom) return hooks.shareRoom();
    if (ctx.shareRoom) return ctx.shareRoom();
    const url = visitUrl(appUrl(location.href), mySnapshot());
    const name = ctx.store.get().profile.appearance.name;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Study Buddy', text: `Come see ${name}’s study room 📚`, url });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    if (await copyText(url)) toast('Visit link copied — paste it to a friend', '🔗');
  }

  // ───── sections ─────

  function syncCta(configured: boolean) {
    return h(
      'div',
      { class: 'card cta-card' },
      h('div', { class: 'cta-art', 'aria-hidden': 'true' }, h('span', null, '🏆'), h('span', null, '☁️'), h('span', null, '🤝')),
      h('h3', null, configured ? 'Sign in to join the leaderboards' : 'Leaderboards need cloud sync'),
      h(
        'p',
        { class: 'muted small' },
        configured
          ? 'You’ve set up cloud sync on this device — sign in and you can add friends, compare study hours and race for the weekly top spot.'
          : 'Race your friends for the most study hours this week. It’s free: connect a Supabase project in Settings (the same one that syncs your iPhone, iPad and Mac).',
      ),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: goToSync }, configured ? 'Sign in' : 'Set up cloud sync'),
    );
  }

  function profileCard(uid: string) {
    const s = ctx.store.get();
    const on = s.settings.leaderboard;
    const err = publishError();
    return h(
      'div',
      { class: 'card settings-card board-profile' },
      h('h3', null, 'Your board profile'),
      toggle('Show me on leaderboards', '', on, (v) => {
        update(v ? { leaderboard: true } : { leaderboard: false, leaderboardPublic: false });
        toast(v ? 'You’re on the board! Friends can see your week' : 'Hidden from leaderboards', v ? '🏆' : '🙈');
      }),
      h(
        'p',
        { class: 'share-explainer muted small' },
        'Shares only: ',
        h('b', null, s.profile.appearance.name),
        ' (your buddy’s name), their look & room, hours studied and your streak. Never your email, subjects or notes.',
      ),
      toggle('Also list me on the public board', 'Anyone signed in can see you under “Everyone”', on && s.settings.leaderboardPublic, (v) => update({ leaderboardPublic: v }), !on),
      err && on ? h('p', { class: 'form-error' }, `Couldn’t update your entry: ${errText(err)}`) : null,
      h(
        'div',
        { class: 'code-box' },
        h('div', { class: 'code-label muted small' }, 'Your friend code'),
        h('div', { class: 'code-row' }, h('code', { class: 'friend-code' }, friendCode(uid))),
        h(
          'div',
          { class: 'btn-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small btn-ghost',
              onclick: async () => {
                if (await copyText(friendCode(uid))) {
                  sfx('click');
                  toast('Friend code copied', '📋');
                }
              },
            },
            '📋 Copy',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small btn-primary',
              onclick: async () => {
                const text = inviteText(friendCode(uid));
                const url = appUrl(location.href);
                if (navigator.share) {
                  try {
                    await navigator.share({ title: 'Study Buddy', text, url });
                    return;
                  } catch (e) {
                    if ((e as Error)?.name === 'AbortError') return;
                  }
                }
                if (await copyText(`${text}\n${url}`)) toast('Invite copied — send it to a friend', '💌');
              },
            },
            '💌 Invite a friend',
          ),
        ),
        !on ? h('p', { class: 'muted small code-hint' }, 'Turn on “Show me on leaderboards” so friends can find you with this code.') : null,
      ),
    );
  }

  function addFriendCard(uid: string) {
    const input = h('input', {
      type: 'text',
      class: 'code-input',
      placeholder: 'ABCD-1234',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      maxlength: 12,
      'aria-label': 'Friend code',
      value: codeDraft,
      'data-k': 'code',
      oninput: (e: Event) => {
        codeDraft = (e.target as HTMLInputElement).value;
        if (lookup.state !== 'idle' && lookup.state !== 'busy') {
          lookup = { state: 'idle' };
          const r = el.querySelector('.lookup-result');
          r?.replaceChildren();
        }
      },
    });
    const find = async () => {
      const code = normalizeCode(codeDraft);
      if (!code) {
        lookup = { state: 'error', msg: 'Friend codes look like ABCD-1234 (8 letters/numbers).' };
        return render(true);
      }
      if (code === friendCode(uid)) {
        lookup = { state: 'error', msg: 'That’s your own code! Send it to a friend instead 😊' };
        return render(true);
      }
      if (ctx.store.get().friends.some((f) => f.code === code)) {
        lookup = { state: 'error', msg: 'Already on your friends list.' };
        return render(true);
      }
      lookup = { state: 'busy' };
      render(true);
      try {
        const entry = await be().lookupCode(code, ctx.now());
        lookup = entry ? { state: 'found', entry } : { state: 'error', msg: `No one with code ${code} is on the leaderboard yet. Ask them to turn on “Show me on leaderboards”.` };
      } catch (e) {
        lookup = { state: 'error', msg: errText(e) };
      }
      render(true);
    };
    const result =
      lookup.state === 'busy'
        ? h('div', { class: 'lookup-result muted small' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Looking…')
        : lookup.state === 'error'
          ? h('div', { class: 'lookup-result' }, h('p', { class: 'form-error', role: 'alert' }, lookup.msg ?? ''))
          : lookup.state === 'found' && lookup.entry
            ? h(
                'div',
                { class: 'lookup-result found' },
                avatarCanvas(lookup.entry.snapshot?.look),
                h(
                  'div',
                  { class: 'found-text' },
                  h('b', null, lookup.entry.name),
                  h('span', { class: 'muted small' }, `${formatBoardHours(lookup.entry.weekMs)} this week${lookup.entry.streak ? ` · 🔥 ${lookup.entry.streak}` : ''}`),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn-small btn-go',
                    onclick: () => {
                      const e = lookup.entry!;
                      ctx.store.set(actions.addFriend(ctx.store.get(), e.code, e.name, ctx.now()));
                      sfx('quest');
                      toast(`${e.name} added! Time for a friendly race`, '🤝');
                      codeDraft = '';
                      lookup = { state: 'idle' };
                      data.friends.at = 0;
                      void load('friends', true);
                    },
                  },
                  '＋ Add',
                ),
              )
            : h('div', { class: 'lookup-result' });
    return h(
      'div',
      { class: 'card add-friend' },
      h('h3', null, 'Add a friend'),
      h(
        'form',
        {
          class: 'add-row',
          onsubmit: (e: Event) => {
            e.preventDefault();
            void find();
          },
        },
        input,
        h('button', { type: 'submit', class: 'btn btn-small btn-primary', disabled: lookup.state === 'busy' }, 'Find'),
      ),
      result,
    );
  }

  function rowEl(r: BoardRow, sharing: boolean) {
    const top = r.rank <= 3;
    return h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: `board-row ${r.isMe ? 'me' : ''} ${top ? 'top' : ''}`,
          'aria-label': `${r.rank}. ${r.isMe ? 'You' : r.name}, ${r.hours}${r.streak ? `, ${r.entry.streak}-day streak` : ''}`,
          onclick: () => openEntry(r),
        },
        h('span', { class: `rank ${top ? 'medal' : ''}` }, r.medal),
        avatarCanvas(r.entry.snapshot?.look, r.name),
        h(
          'span',
          { class: 'who' },
          h('span', { class: 'who-name' }, r.name, r.isMe ? h('span', { class: 'you-tag' }, 'You') : null),
          r.isMe && !sharing ? h('span', { class: 'muted small' }, 'Only you can see this') : null,
        ),
        r.streak ? h('span', { class: 'streak' }, r.streak) : h('span', { class: 'streak' }),
        h('span', { class: 'hours' }, r.hours),
      ),
    );
  }

  function openEntry(r: BoardRow) {
    const e = r.entry;
    const isFriend = ctx.store.get().friends.some((f) => f.code === e.code);
    const snap = e.snapshot;
    const big = avatarCanvas(snap?.look);
    big.classList.add('avatar-big');
    const handle = openModal({
      title: r.isMe ? `${e.name} (you)` : e.name,
      className: 'friend-modal',
      body: [
        big,
        h(
          'div',
          { class: 'summary-stats' },
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, formatBoardHours(e.weekMs)), h('div', { class: 'stat-k' }, 'this week')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, formatBoardHours(e.totalMs)), h('div', { class: 'stat-k' }, 'all time')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, `🔥 ${e.streak}`), h('div', { class: 'stat-k' }, 'day streak')),
        ),
        h('p', { class: 'muted small friend-meta' }, r.isMe ? 'This is how friends see you' : `Friend code ${e.code}${snap ? ` · ${formatCoins(snap.items.length)} item${snap.items.length === 1 ? '' : 's'} in their room` : ''}`),
      ],
      actions: [
        ...(isFriend && !r.isMe
          ? [
              {
                label: 'Remove friend',
                kind: 'ghost' as const,
                onClick: async () => {
                  handle.close();
                  if (!(await confirmDialog(`Remove ${e.name}?`, 'They won’t be notified. You can add them again with their code.', 'Remove', true))) return false;
                  ctx.store.set(actions.removeFriend(ctx.store.get(), e.code, ctx.now()));
                  if (data.friends.entries) data.friends.entries = data.friends.entries.filter((x) => x.code !== e.code);
                  render(true);
                  return true;
                },
              },
            ]
          : []),
        ...(r.isMe
          ? [{ label: '📸 Share my room', kind: 'primary' as const, autofocus: true, onClick: () => void shareRoom() }]
          : snap
            ? [{ label: '🏠 Visit room', kind: 'primary' as const, autofocus: true, onClick: () => visit(snap) }]
            : [{ label: 'Close', kind: 'primary' as const }]),
      ],
    });
  }

  function boardCard(uid: string) {
    const s = ctx.store.get();
    const now = ctx.now();
    const d = data[src(mode)];
    const sharing = s.settings.leaderboard;
    const me = myEntry(s, uid, now);
    const includeMe = mode === 'global-week' ? sharing && s.settings.leaderboardPublic : true;
    const rows = d.entries ? boardRows(withMe(d.entries, includeMe ? me : null), mode) : [];
    const others = d.entries ? d.entries.filter((e) => !e.isMe && e.code !== me.code) : [];
    const quiet = mode !== 'global-week' && d.entries ? quietFriends(s.friends, d.entries) : [];
    const seg = h(
      'div',
      { class: 'segmented board-seg', role: 'tablist', 'aria-label': 'Leaderboard' },
      BOARD_MODES.map((m) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'seg',
            'aria-selected': String(m.id === mode),
            'aria-checked': String(m.id === mode),
            title: m.label,
            onclick: () => {
              mode = m.id;
              ctx.prefs.boardMode = m.id;
              ctx.savePrefs();
              render(true);
              void load(src(mode));
            },
          },
          m.short,
        ),
      ),
    );
    let body: Node;
    if (d.error && !d.entries) {
      body = h(
        'div',
        { class: 'board-state' },
        h('p', { class: 'form-error' }, d.error),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => void load(src(mode), true) }, 'Try again'),
      );
    } else if (!d.entries) {
      body = h(
        'ul',
        { class: 'board loading', 'aria-busy': 'true', 'aria-label': 'Loading leaderboard' },
        [0, 1, 2].map(() => h('li', null, h('div', { class: 'board-row skeleton' }, h('span', { class: 'sk sk-rank' }), h('span', { class: 'sk sk-av' }), h('span', { class: 'sk sk-name' }), h('span', { class: 'sk sk-h' })))),
      );
    } else {
      body = h(
        'div',
        null,
        h('ol', { class: 'board' }, rows.map((r) => rowEl(r, sharing))),
        !others.length ? h('p', { class: 'muted small board-empty' }, emptyBoardText(mode, s.friends.length)) : null,
        quiet.length
          ? h(
              'div',
              { class: 'quiet' },
              h('div', { class: 'muted small' }, 'Not sharing right now'),
              h(
                'ul',
                { class: 'quiet-list' },
                quiet.map((f) =>
                  h(
                    'li',
                    null,
                    h('span', null, f.name),
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'icon-btn',
                        title: `Remove ${f.name}`,
                        'aria-label': `Remove ${f.name}`,
                        onclick: async () => {
                          if (!(await confirmDialog(`Remove ${f.name}?`, 'You can add them again with their code.', 'Remove', true))) return;
                          ctx.store.set(actions.removeFriend(ctx.store.get(), f.code, ctx.now()));
                        },
                      },
                      '✕',
                    ),
                  ),
                ),
              ),
            )
          : null,
      );
    }
    const updated = d.loading && d.entries ? 'Refreshing…' : d.error && d.entries ? 'Offline — showing last results' : '';
    return h(
      'div',
      { class: 'card board-card' },
      h('div', { class: 'quests-head' }, h('h3', null, 'Leaderboard'), h('span', { class: 'reset-in' }, updated || (mode === 'friends-all' ? 'All-time hours' : 'Resets Monday'))),
      seg,
      body,
    );
  }

  function shareCard() {
    return h(
      'div',
      { class: 'card share-card' },
      h('h3', null, 'Share your room'),
      h('p', { class: 'muted small' }, 'Show off your buddy and room — anyone with the link can take a peek (no account needed).'),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => void shareRoom() }, '📸 Share my room'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small btn-ghost',
            onclick: async () => {
              if (ctx.copyVisitLink) return ctx.copyVisitLink();
              if (await copyText(visitUrl(appUrl(location.href), mySnapshot()))) {
                sfx('click');
                toast('Visit link copied', '🔗');
              }
            },
          },
          '🔗 Copy visit link',
        ),
      ),
    );
  }

  function render(force = false) {
    const ae = document.activeElement;
    if (!force && ae && el.contains(ae) && ae.tagName === 'INPUT' && (ae as HTMLInputElement).type === 'text') return;
    const refocus = ae instanceof HTMLInputElement && el.contains(ae) && ae.dataset.k === 'code';
    const s = ctx.store.get();
    const uid = be().userId();
    mount(
      el,
      h(
        'div',
        { class: 'view-head' },
        h('h2', null, 'Friends'),
        uid && s.friends.length ? h('span', { class: 'chip' }, h('b', null, String(s.friends.length)), s.friends.length === 1 ? ' friend' : ' friends') : null,
      ),
      h('p', { class: 'muted small view-intro' }, 'Study together, even when apart. Cheer each other on and race for the weekly top spot.'),
      uid ? [boardCard(uid), addFriendCard(uid), profileCard(uid)] : syncCta(be().configured()),
      shareCard(),
    );
    if (refocus) el.querySelector<HTMLInputElement>('[data-k="code"]')?.focus({ preventScroll: true });
  }

  function open() {
    render(true);
    if (be().userId()) void load(src(mode));
  }

  mode = (ctx.prefs.boardMode as BoardMode | undefined) ?? 'friends-week';
  ctx.cloud.onChange(() => {
    if (!el.hidden) render();
  });
  onPublishChange(() => {
    if (!el.hidden) render();
  });
  setInterval(() => {
    if (el.hidden || document.hidden || !el.isConnected || !be().userId()) return;
    void load(src(mode), true);
  }, REFRESH_MS);

  return {
    el,
    /** force = the tab was just opened → pull fresh data */
    render(force?: boolean) {
      if (force) open();
      else render();
    },
  };
}
