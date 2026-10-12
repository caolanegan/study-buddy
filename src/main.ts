// Study Buddy app entry: builds the shell, runs the main loop and wires audio, sync and the views.
import './ui/styles.css';
import * as actions from './core/actions';
import type { AppState } from './core/types';
import type { SessionEvent } from './core/session';
import { ACHIEVEMENTS } from './core/achievements';
import { totalStudiedMs } from './core/economy';
import { simTime } from './core/sim';
import { moonPhase, weatherAt } from './core/weather';
import { Store } from './state/store';
import { CloudSync, loadSyncConfig } from './sync/cloud';
import { AudioEngine } from './audio/engine';
import { RoomRenderer } from './render/room';
import { h, isTypingTarget } from './ui/dom';
import { initOverlays, modalOpen, toast } from './ui/overlay';
import { loadPrefs, savePrefs, TABS, type Tab } from './ui/prefs';
import { createHeader } from './ui/header';
import { createRoomView } from './ui/roomview';
import { createSessionController } from './ui/session';
import { createShopView } from './ui/shop';
import { createStatsView } from './ui/stats';
import { createAwardsView } from './ui/awards';
import { createSettingsView } from './ui/settings';
import { deriveSession, PET_IDS, sceneMode } from './ui/viewmodel';
import type { Ctx } from './ui/context';

const store = new Store();
const audio = new AudioEngine();
const cloud = new CloudSync(store);
const prefs = loadPrefs();
const quiet = new Set<string>();
const wideMq = matchMedia('(min-width: 900px)');

const ctx: Ctx = {
  store,
  audio,
  cloud,
  prefs,
  savePrefs: () => savePrefs(prefs),
  showTab: (t) => showTab(t),
  quietAchievements: (ids) => ids.forEach((id) => quiet.add(id)),
  now: () => Date.now(),
};

// ───────────── shell ─────────────
const modalRoot = h('div', { class: 'modal-root' });
const toastRoot = h('div', { class: 'toasts', 'aria-live': 'polite' });
initOverlays(modalRoot, toastRoot);

const sc = createSessionController(ctx);
const header = createHeader(ctx);
const room = createRoomView(ctx, sc);
const views = {
  shop: createShopView(ctx),
  stats: createStatsView(ctx),
  awards: createAwardsView(ctx),
  settings: createSettingsView(ctx),
} satisfies Partial<Record<Tab, { el: HTMLElement; render(force?: boolean): void }>>;
type PanelTab = keyof typeof views;

const tabButtons = new Map<Tab, HTMLButtonElement>();
const nav = h(
  'nav',
  { class: 'tabbar', 'aria-label': 'Main' },
  TABS.map((t) => {
    const b = h(
      'button',
      { type: 'button', class: `tab tab-${t.id}`, onclick: () => showTab(t.id) },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon),
      h('span', { class: 'tab-label' }, t.label),
    );
    tabButtons.set(t.id, b);
    return b;
  }),
);
const app = h(
  'div',
  { class: 'app' },
  header.el,
  h(
    'main',
    { class: 'layout' },
    h('div', { class: 'col-left' }, room.stage, room.panel),
    h('div', { class: 'col-right' }, nav, Object.values(views).map((v) => v.el)),
  ),
);
document.body.append(app, modalRoot, toastRoot);

function effectiveTab(): Tab {
  return wideMq.matches && prefs.tab === 'room' ? 'shop' : prefs.tab;
}

function showTab(t: Tab) {
  const changed = prefs.tab !== t;
  prefs.tab = t;
  savePrefs(prefs);
  const eff = effectiveTab();
  app.dataset.tab = eff;
  for (const [id, b] of tabButtons) {
    if (id === eff) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const [id, v] of Object.entries(views)) {
    v.el.hidden = id !== eff;
    if (id === eff) v.render(true);
  }
  if (changed && !wideMq.matches) window.scrollTo({ top: 0 });
}
wideMq.addEventListener('change', () => showTab(prefs.tab));

function renderVisibleView() {
  const eff = effectiveTab();
  if (eff in views) views[eff as PanelTab].render();
}

// ───────────── audio ─────────────
function applyAudioSettings(s: AppState) {
  audio.setEnabled({ sfx: s.settings.sound, music: s.settings.music });
  audio.setVolume(document.hidden ? 0 : s.settings.volume);
}
applyAudioSettings(store.get());
try {
  const as = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (as) as.type = 'ambient'; // mix with the user's own music on iOS/Safari
} catch {
  /* ignore */
}
const unlockAudio = () => void audio.unlock();
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

const renderer = new RoomRenderer(room.canvas, {
  onCar: (dir) => audio.play('car', { dir }),
  onThunder: () => audio.play('thunder'),
  onPet: (p) => audio.play(p === 'cat' ? 'meow' : 'bark'),
});

// ───────────── notifications ─────────────
async function notify(title: string, body: string) {
  if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const opts: NotificationOptions = { body, tag: 'study-buddy', icon: './icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return void (await reg.showNotification(title, opts));
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, opts);
  } catch {
    /* iOS outside a home-screen app */
  }
}

// ───────────── session events ─────────────
function handleEvents(events: SessionEvent[], now: number) {
  const lastOf = (k: SessionEvent['kind']) => [...events].reverse().find((e) => e.kind === k);
  const fresh = (e: SessionEvent) => now - e.at < 90_000;
  const check = lastOf('check');
  if (check && store.get().active?.checkPendingSince !== null) {
    audio.play('checkin');
    void notify('Still studying? 📚', 'Tap to confirm — otherwise the session pauses in 5 minutes.');
  }
  if (lastOf('autopause')) {
    toast('Paused — we didn’t hear back, so time since the check-in wasn’t counted', '⏸', 7000);
    audio.play('pause');
  }
  // pomodoro phase: only the latest transition matters (the app may have been closed for a while)
  const phase = [...events].reverse().find((e) => e.kind === 'break' || e.kind === 'work');
  if (phase) {
    if (phase.kind === 'break') {
      toast(phase.long ? 'Long break! ☕ You’ve earned it' : 'Break time! ☕', '🍅');
      if (fresh(phase)) void notify(phase.long ? 'Long break! ☕' : 'Break time! ☕', 'Nice focus block — stretch, sip, rest your eyes.');
    } else {
      toast('Back to focus', '📚');
      if (fresh(phase)) void notify('Back to focus 📚', 'Break’s over — the timer is running again.');
    }
    if (fresh(phase)) audio.play('chime');
  }
}

function step(now: number) {
  const r = actions.tick(store.get(), now);
  if (r.events.length) {
    store.set(r.state);
    handleEvents(r.events, now);
  }
}

// ───────────── store reactions ─────────────
store.subscribe((s, prev) => {
  // Data merged in from sync/import may qualify for achievements nobody has evaluated yet.
  if (s.sessions !== prev.sessions || s.purchases !== prev.purchases) {
    const ev = actions.evaluateAchievements(s, Date.now());
    if (ev.unlocked.length) {
      queueMicrotask(() => store.set(ev.state));
      return;
    }
  }
  const fresh = Object.keys(s.achievements).filter((id) => !prev.achievements[id] && !quiet.has(id));
  quiet.clear();
  if (fresh.length) {
    audio.play('achievement');
    if (fresh.length > 3) toast(`${fresh.length} achievements unlocked!`, '🏆');
    else
      for (const id of fresh) {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) toast(`${a.name} unlocked · +${a.reward} coins`, a.icon);
      }
  }
  if (s.settings !== prev.settings) applyAudioSettings(s);
  sc.syncCheckModal();
  updateDom(Date.now());
  renderVisibleView();
});

cloud.onChange(() => {
  header.setSync(cloud.status);
  if (effectiveTab() === 'settings') views.settings.render();
});
header.setSync(cloud.status);
{
  const ev = actions.evaluateAchievements(store.get(), Date.now());
  if (ev.unlocked.length) store.set(ev.state);
}
void cloud.configure(loadSyncConfig());

// ───────────── main loop ─────────────
let itemsCache: Set<string> | null = null;
let itemsFor: AppState | null = null;
function items(s: AppState) {
  if (!itemsCache || itemsFor !== s) {
    itemsCache = actions.equippedItems(s);
    itemsFor = s;
  }
  return itemsCache;
}

let lastDom = 0;
let lastAudio = 0;
function updateDom(now: number) {
  lastDom = now;
  const s = store.get();
  const total = totalStudiedMs(s, now);
  header.update(s, now);
  room.update(s, now, simTime(total), weatherAt(total));
  const v = deriveSession(s, now);
  const title = v.status === 'idle' ? 'Study Buddy' : `${v.status === 'running' ? '▶' : '❚❚'} ${v.timer} · Study Buddy`;
  if (document.title !== title) document.title = title;
}

function frame() {
  // schedule first so one bad frame (e.g. a renderer exception) can't stop the loop
  requestAnimationFrame(frame);
  const now = Date.now();
  step(now);
  const s = store.get();
  const total = totalStudiedMs(s, now);
  const sim = simTime(total);
  const weather = weatherAt(total);
  const mode = sceneMode(s.active);
  const its = items(s);
  renderer.render({ time: performance.now() / 1000, sim, weather, moon: moonPhase(total), mode, items: its });
  if (now - lastDom >= 250) updateDom(now);
  if (now - lastAudio >= 1000) {
    lastAudio = now;
    audio.update({
      studying: mode === 'studying',
      onBreak: mode === 'break' || mode === 'paused',
      isNight: sim.isNight,
      season: sim.season,
      weather,
      pets: PET_IDS.filter((p) => its.has(p)),
    });
  }
}

// rAF stops in background tabs: keep ticking (for the check-in / pomodoro notifications) on a timer.
setInterval(() => {
  if (document.hidden) {
    const now = Date.now();
    step(now);
    updateDom(now);
  }
}, 1000);

document.addEventListener('visibilitychange', () => {
  audio.setVolume(document.hidden ? 0 : store.get().settings.volume);
  if (!document.hidden) {
    step(Date.now());
    updateDom(Date.now());
  }
});

// ───────────── keyboard ─────────────
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || modalOpen()) return;
  const t = e.target as HTMLElement | null;
  if (isTypingTarget(t) || (t && t.closest('button, a, [role="switch"], [role="tab"]'))) return;
  e.preventDefault();
  sc.primary();
});

// ───────────── start ─────────────
showTab(prefs.tab);
sc.syncCheckModal();
updateDom(Date.now());
requestAnimationFrame(frame);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
