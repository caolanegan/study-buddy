// "Customise" sheet: the buddy's look and the room (walls, floor, curtains, window view),
// with a live preview. The editors are reused by the first-run onboarding.
import * as actions from '../core/actions';
import {
  CHARACTER_PRESETS,
  CURTAINS,
  FLOORS,
  HAIR_COLORS,
  HAIR_STYLES,
  ROOM_PRESETS,
  SKIN_TONES,
  TOP_COLORS,
  VIEWS,
  WALLS,
  type Appearance,
  type Profile,
  type RoomStyle,
  type Swatch,
} from '../core/profile';
import { h, type Child } from './dom';
import { openModal, toast } from './overlay';
import { livePreview, PORTRAIT_CROP, sceneFor, thumb, WINDOW_CROP, type LivePreview } from './roompreview';
import type { Ctx } from './context';

export interface Draft {
  appearance: Appearance;
  room: RoomStyle;
}

const sfx = (ctx: Ctx, n: string) => ctx.audio.play(n as never);

export function draftOf(p: Profile): Draft {
  return { appearance: { ...p.appearance }, room: { ...p.room } };
}

// ───────────── generic radio group with roving focus ─────────────
interface Opt {
  id: string;
  label: string;
  content: Child;
  cls?: string;
  /** extra description for screen readers */
  desc?: string;
}

interface Group {
  el: HTMLElement;
  sync(): void;
}

function radioGroup(label: string, opts: Opt[], get: () => string | null, set: (id: string) => void, cls: string): Group {
  const btns = opts.map((o) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: `cz-opt ${o.cls ?? ''}`,
        'aria-label': o.desc ? `${o.label} — ${o.desc}` : o.label,
        title: o.label,
        'data-id': o.id,
        onclick: () => {
          set(o.id);
          sync();
        },
      },
      o.content,
    ),
  );
  const el = h('div', { class: `cz-group ${cls}`, role: 'radiogroup', 'aria-label': label }, btns);
  el.addEventListener('keydown', (e) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const n = btns[(i + keys[e.key] + btns.length) % btns.length];
    n.focus();
    n.click();
  });
  const sync = () => {
    const cur = get();
    let any = false;
    for (const b of btns) {
      const on = b.dataset.id === cur;
      any ||= on;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!any && btns[0]) btns[0].tabIndex = 0;
  };
  sync();
  return { el, sync };
}

const dot = (s: Swatch, style?: string) =>
  h('span', { class: 'cz-dot', style: style ?? `--c0:${s.colors[0]};--c1:${s.colors[1]};--c2:${s.colors[2]}`, 'aria-hidden': 'true' });

function wallStyle(w: (typeof WALLS)[number]): string {
  const [a, b, c] = w.colors;
  const bg: Record<string, string> = {
    stripes: `repeating-linear-gradient(90deg, ${a} 0 6px, ${b} 6px 8px)`,
    plain: `linear-gradient(160deg, ${a}, ${b})`,
    dots: `radial-gradient(${c} 1.5px, transparent 2px) 0 0/8px 8px, ${a}`,
    brick: `repeating-linear-gradient(0deg, ${c} 0 1.5px, transparent 1.5px 8px), ${a}`,
    planks: `repeating-linear-gradient(90deg, ${a} 0 9px, ${b} 9px 11px)`,
    stars: `radial-gradient(${c} 1px, transparent 1.6px) 3px 2px/11px 9px, ${a}`,
    check: `repeating-conic-gradient(${a} 0 25%, ${c} 0 50%) 0 0/10px 10px`,
  };
  return `background:${bg[w.pattern] ?? a}`;
}

function section(title: string, ...children: Child[]) {
  return h('section', { class: 'cz-section' }, h('h3', { class: 'cz-h' }, title), children);
}

// ───────────── character editor ─────────────
export function characterEditor(ctx: Ctx, draft: Draft, onChange: () => void): { el: HTMLElement; sync(): void } {
  const st = () => ctx.store.get();
  const now = () => ctx.now();
  const a = () => draft.appearance;
  const groups: Group[] = [];
  const change = () => {
    onChange();
    for (const g of groups) g.sync();
    refreshHair();
  };

  const name = h('input', {
    type: 'text',
    class: 'cz-name',
    maxlength: 20,
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': 'Buddy’s name',
    placeholder: 'Name your buddy',
    value: a().name,
  });
  name.addEventListener('input', () => {
    draft.appearance.name = name.value.slice(0, 20);
    onChange();
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur();
  });

  // presets: little portraits of each ready-made buddy
  const presetNames = new Set(CHARACTER_PRESETS.map((p) => p.appearance.name));
  const portrait = (look: Appearance) => thumb(sceneFor(st(), now(), { look, mode: 'studying', daytime: true, time: 0.4 }), PORTRAIT_CROP, 'cz-portrait');
  const presets = radioGroup(
    'Ready-made buddies',
    CHARACTER_PRESETS.map((p) => ({ id: p.id, label: p.appearance.name, content: [portrait(p.appearance), h('span', { class: 'cz-cap' }, p.appearance.name)], cls: 'cz-card cz-preset' })),
    () => CHARACTER_PRESETS.find((p) => sameLook(p.appearance, a()))?.id ?? null,
    (id) => {
      const p = CHARACTER_PRESETS.find((x) => x.id === id)!;
      const keepName = a().name.trim() && !presetNames.has(a().name.trim());
      draft.appearance = { ...p.appearance, name: keepName ? a().name : p.appearance.name };
      name.value = draft.appearance.name;
      change();
    },
    'cz-scroll',
  );

  const pick = <K extends keyof Appearance>(k: K, list: Swatch[], label: string) => {
    const g = radioGroup(
      label,
      list.map((s) => ({ id: s.id, label: s.name, content: dot(s), cls: 'cz-swatch' })),
      () => a()[k] as string,
      (id) => {
        (draft.appearance[k] as string) = id;
        change();
      },
      'cz-swatches',
    );
    groups.push(g);
    return g.el;
  };

  // hair styles drawn with the current colours
  const hairBtns = new Map<string, HTMLElement>();
  const hair = radioGroup(
    'Hair style',
    HAIR_STYLES.map((s) => {
      const slot = h('span', { class: 'cz-portrait-slot' });
      hairBtns.set(s.id, slot);
      return { id: s.id, label: s.name, content: [slot, h('span', { class: 'cz-cap' }, s.name)], cls: 'cz-card cz-hair' };
    }),
    () => a().hair,
    (id) => {
      draft.appearance.hair = id as Appearance['hair'];
      change();
    },
    'cz-scroll',
  );
  let hairKey = '';
  function refreshHair() {
    const k = `${a().skin}|${a().hairColor}|${a().top}`;
    if (k === hairKey) return;
    hairKey = k;
    for (const s of HAIR_STYLES) hairBtns.get(s.id)?.replaceChildren(portrait({ ...a(), hair: s.id }));
  }
  refreshHair();
  groups.push(presets, hair);

  const el = h(
    'div',
    { class: 'cz-editor' },
    section('Name', name),
    section('Pick a buddy', presets.el),
    section('Skin', pick('skin', SKIN_TONES, 'Skin tone')),
    section('Hair', hair.el, pick('hairColor', HAIR_COLORS, 'Hair colour')),
    section('Hoodie', pick('top', TOP_COLORS, 'Hoodie colour')),
  );
  return {
    el,
    sync() {
      name.value = a().name;
      for (const g of groups) g.sync();
      refreshHair();
    },
  };
}

function sameLook(x: Appearance, y: Appearance) {
  return x.skin === y.skin && x.hair === y.hair && x.hairColor === y.hairColor && x.top === y.top;
}

// ───────────── room editor ─────────────
export function roomEditor(ctx: Ctx, draft: Draft, onChange: () => void): { el: HTMLElement; sync(): void } {
  const st = () => ctx.store.get();
  const groups: Group[] = [];
  const r = () => draft.room;
  const change = () => {
    onChange();
    for (const g of groups) g.sync();
  };
  const room = (id: string) => ROOM_PRESETS.find((p) => p.id === id)!;

  const presets = radioGroup(
    'Room presets',
    ROOM_PRESETS.map((p) => ({
      id: p.id,
      label: p.name,
      content: [
        thumb(sceneFor(st(), ctx.now(), { room: p.room, daytime: true, mode: 'studying', time: 0.4 }), undefined, 'cz-room-thumb'),
        h('span', { class: 'cz-cap' }, h('span', { 'aria-hidden': 'true' }, p.icon), ' ', p.name),
      ],
      cls: 'cz-card cz-roomcard',
    })),
    () => ROOM_PRESETS.find((p) => JSON.stringify(p.room) === JSON.stringify(r()))?.id ?? null,
    (id) => {
      draft.room = { ...room(id).room };
      change();
    },
    'cz-scroll',
  );

  const pick = <K extends keyof RoomStyle>(k: K, list: Swatch[], label: string, style?: (s: Swatch) => string) => {
    const g = radioGroup(
      label,
      list.map((s) => ({ id: s.id, label: s.name, content: dot(s, style?.(s)), cls: 'cz-swatch' })),
      () => r()[k],
      (id) => {
        (draft.room[k] as string) = id;
        change();
      },
      'cz-swatches',
    );
    groups.push(g);
    return g.el;
  };

  const views = radioGroup(
    'Window view',
    VIEWS.map((v) => ({
      id: v.id,
      label: v.name,
      desc: v.blurb,
      content: [
        thumb(sceneFor(st(), ctx.now(), { room: { ...st().profile.room, view: v.id }, daytime: true }), WINDOW_CROP, 'cz-view-thumb'),
        h('span', { class: 'cz-view-text' }, h('b', null, h('span', { 'aria-hidden': 'true' }, v.icon), ' ', v.name), h('span', { class: 'muted small' }, v.blurb)),
      ],
      cls: 'cz-card cz-viewcard',
    })),
    () => r().view,
    (id) => {
      draft.room.view = id as RoomStyle['view'];
      change();
    },
    'cz-views',
  );
  groups.push(presets, views);

  const el = h(
    'div',
    { class: 'cz-editor' },
    section('Room presets', presets.el),
    section('Window view', views.el),
    section('Walls', pick('wall', WALLS, 'Wallpaper', (s) => wallStyle(s as (typeof WALLS)[number]))),
    section('Floor', pick('floor', FLOORS, 'Floor', (s) => `background:repeating-linear-gradient(0deg, ${s.colors[0]} 0 6px, ${s.colors[1]} 6px 7px)`)),
    section('Curtains', pick('curtains', CURTAINS, 'Curtains', (s) => (s.id === 'blinds' ? `background:repeating-linear-gradient(0deg, ${s.colors[0]} 0 3px, ${s.colors[1]} 3px 4px)` : `background:linear-gradient(90deg, ${s.colors[0]} 0 40%, ${s.colors[1]} 40% 50%, ${s.colors[0]} 50%)`))),
  );
  return {
    el,
    sync() {
      for (const g of groups) g.sync();
    },
  };
}

// ───────────── preview pane ─────────────
export function previewPane(ctx: Ctx, draft: Draft): { el: HTMLElement; preview: LivePreview; refresh(): void } {
  const preview = livePreview((time) => sceneFor(ctx.store.get(), ctx.now(), { look: draft.appearance, room: draft.room, mode: 'idle', daytime: true, time }), 'Live preview of your buddy and room');
  const tag = h('span', { class: 'cz-nametag' });
  const el = h('div', { class: 'cz-stage' }, h('div', { class: 'cz-frame' }, preview.el, tag));
  const refresh = () => {
    tag.textContent = draft.appearance.name.trim() || 'Your buddy';
  };
  refresh();
  return { el, preview, refresh };
}

// ───────────── the sheet ─────────────
export interface CustomizeOpts {
  tab?: 'character' | 'room';
  onShare?: () => void;
}

export function openCustomize(ctx: Ctx, opts: CustomizeOpts = {}) {
  const draft = draftOf(ctx.store.get().profile);
  const pane = previewPane(ctx, draft);
  const onChange = () => pane.refresh();
  const ch = characterEditor(ctx, draft, onChange);
  const rm = roomEditor(ctx, draft, onChange);

  let tab = opts.tab ?? 'character';
  const tabBtn = (id: 'character' | 'room', label: string) =>
    h('button', { type: 'button', role: 'tab', class: 'seg', id: `cz-tab-${id}`, 'aria-controls': `cz-panel-${id}`, onclick: () => setTab(id) }, label);
  const tCh = tabBtn('character', '🧑 Buddy');
  const tRm = tabBtn('room', '🏠 Room');
  const pCh = h('div', { role: 'tabpanel', id: 'cz-panel-character', 'aria-labelledby': 'cz-tab-character' }, ch.el);
  const pRm = h('div', { role: 'tabpanel', id: 'cz-panel-room', 'aria-labelledby': 'cz-tab-room' }, rm.el);
  const tabs = h('div', { class: 'segmented cz-tabs', role: 'tablist', 'aria-label': 'Customise' }, tCh, tRm);
  tabs.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setTab(tab === 'character' ? 'room' : 'character');
      (tab === 'character' ? tCh : tRm).focus();
    }
  });
  const controls = h('div', { class: 'cz-controls' }, tabs, pCh, pRm);
  function setTab(t: 'character' | 'room') {
    tab = t;
    tCh.setAttribute('aria-selected', String(t === 'character'));
    tRm.setAttribute('aria-selected', String(t === 'room'));
    tCh.tabIndex = t === 'character' ? 0 : -1;
    tRm.tabIndex = t === 'room' ? 0 : -1;
    pCh.hidden = t !== 'character';
    pRm.hidden = t !== 'room';
    controls.scrollTop = 0;
  }
  setTab(tab);

  const m = openModal({
    title: 'Customise',
    className: 'customize',
    body: h('div', { class: 'cz-layout' }, pane.el, controls),
    onClose: () => pane.preview.stop(),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save',
        kind: 'go',
        onClick: () => {
          if (!draft.appearance.name.trim()) draft.appearance.name = ctx.store.get().profile.appearance.name;
          ctx.store.set(actions.updateProfile(ctx.store.get(), { appearance: draft.appearance, room: draft.room, onboarded: true }, ctx.now()));
          sfx(ctx, 'sparkle');
          toast(`${draft.appearance.name.trim()}’s room is all set`, '✨');
        },
      },
    ],
  });
  if (opts.onShare) {
    const share = h('button', { type: 'button', class: 'btn btn-small btn-ghost cz-share', onclick: opts.onShare }, h('span', { 'aria-hidden': 'true' }, '📤'), ' Share');
    m.el.querySelector('.modal-title')?.after(share);
  }
  return m;
}
