// Visiting someone's room (share links, friends on the leaderboard): read-only, nothing local changes.
import { encodeSnapshot, snapshotFromHash, type RoomSnapshot } from '../core/share';
import { HOUR } from '../core/time';
import type { RenderScene } from '../render/scene';
import { h, setText } from './dom';

export interface VisitMode {
  banner: HTMLElement;
  readonly snapshot: RoomSnapshot | null;
  /** Total "studied" ms that drives the sim clock (theirs while visiting). */
  simTotal(myTotal: number): number;
  /** Swap in their look / room / items while visiting. */
  scene(base: RenderScene): RenderScene;
  open(s: RoomSnapshot): void;
  leave(): void;
  /** Note under the banner (e.g. your own timer is still running). */
  setNote(text: string): void;
}

let openHandler: ((s: RoomSnapshot) => void) | null = null;

/** Open a friend's room read-only (used by the Friends tab / leaderboard). */
export function openVisit(s: RoomSnapshot): void {
  if (openHandler) openHandler(s);
  else location.hash = 'visit=' + encodeSnapshot(s);
}

export function visitBannerText(s: RoomSnapshot): { title: string; meta: string } {
  const hours = s.hours >= 100 ? String(Math.round(s.hours)) : s.hours.toFixed(1).replace(/\.0$/, '');
  return { title: `Visiting ${s.look.name}’s room`, meta: `${hours}h studied${s.streak > 0 ? ` · 🔥 ${s.streak}` : ''}` };
}

export function createVisitMode(opts: { onChange(s: RoomSnapshot | null): void; isNewUser(): boolean; onMakeOwn(): void }): VisitMode {
  let snap: RoomSnapshot | null = null;
  let items = new Set<string>();
  const title = h('b', { class: 'visit-title ellipsis' });
  const meta = h('span', { class: 'visit-meta muted' });
  const note = h('span', { class: 'visit-note' });
  const makeOwn = h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => opts.onMakeOwn() }, '✨ Make my own');
  const back = h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => leave() }, '← Back to my room');
  const banner = h(
    'div',
    { class: 'visit-banner', role: 'region', 'aria-label': 'Visiting', hidden: true },
    h('span', { class: 'visit-icon', 'aria-hidden': 'true' }, '🏡'),
    h('div', { class: 'visit-text' }, title, h('span', { class: 'visit-sub' }, meta, note)),
    h('div', { class: 'visit-actions' }, back, makeOwn),
  );

  function set(s: RoomSnapshot | null) {
    const changed = JSON.stringify(s) !== JSON.stringify(snap);
    snap = s;
    items = new Set(s?.items ?? []);
    banner.hidden = !s;
    if (s) {
      const t = visitBannerText(s);
      setText(title, t.title);
      setText(meta, t.meta);
      makeOwn.hidden = !opts.isNewUser();
    }
    if (changed) opts.onChange(s);
  }

  function leave() {
    if (/visit=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    set(null);
  }

  const fromHash = () => set(snapshotFromHash(location.hash));
  window.addEventListener('hashchange', fromHash);
  fromHash();

  const mode: VisitMode = {
    banner,
    get snapshot() {
      return snap;
    },
    simTotal: (t) => (snap ? snap.hours * HOUR : t),
    scene(base) {
      if (!snap) return base;
      return { ...base, look: snap.look, room: snap.room, items, mode: 'studying', studiedHours: snap.hours };
    },
    open(s) {
      const hash = '#visit=' + encodeSnapshot(s);
      if (location.hash !== hash) history.pushState(null, '', hash);
      set(s);
    },
    leave,
    setNote(t) {
      setText(note, t);
    },
  };
  openHandler = mode.open;
  return mode;
}
