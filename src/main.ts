// Study Buddy app entry: builds the shell, runs the main loop and wires audio, sync and the views.
import './ui/styles.css';
import './ui/world.css';
import './ui/goals.css';
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
import { createGoalsView } from './ui/goals';
import { createFriendsView } from './ui/friends';
import { startSocial } from './ui/social';
import { hoursMilestone, simMilestone } from './ui/goalsvm';
import { claimableCount } from './core/quests';
import { letterWaiting } from './core/letters';
import { createSettingsView } from './ui/settings';
import { createWorld } from './ui/world';
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
  goals: createGoalsView(ctx),
  friends: createFriendsView(ctx),
  settings: createSettingsView(ctx),
} satisfies Partial<Record<Tab, { el: HTMLElement; render(force?: boolean): void }>>;
type PanelTab = keyof typeof views;

const tabButtons = new Map<Tab, HTMLButtonElement>();
// dot on Goals when a quest reward is waiting or today's letter hasn't been opened
const goalsBadge = h('span', { class: 'tab-badge', hidden: true, 'aria-hidden': 'true' });
let badgeAt = 0;
let badgeFor: AppState | null = null;
function updateBadge(s: AppState, now: number) {
  if (s === badgeFor && now - badgeAt < 5000) return;
  badgeFor = s;
  badgeAt = now;
  const n = claimableCount(s, now);
  const show = n > 0 || letterWaiting(s, now);
  goalsBadge.hidden = !show;
  goalsBadge.textContent = n > 0 ? String(n) : '';
  goalsBadge.classList.toggle('dot-only', n === 0);
  const btn = tabButtons.get('goals');
  btn?.setAttribute('aria-label', n > 0 ? `Goals — ${n} reward${n === 1 ? '' : 's'} to claim` : show ? 'Goals — a letter is waiting' : 'Goals');
}
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
    if (t.id === 'goals') b.append(goalsBadge);
    tabButtons.set(t.id, b);
    return b;
  }),
);
// Desktop: the side panel can be collapsed so the room takes over the screen.
const collapseBtn = h(
  'button',
  { type: 'button', class: 'panel-toggle', title: 'Hide panel ( \\ )', 'aria-label': 'Hide side panel', onclick: () => setCollapsed(true) },
  '⟩',
);
const expandBtn = h(
  'button',
  { type: 'button', class: 'panel-expand', title: 'Show panel ( \\ )', 'aria-label': 'Show side panel', onclick: () => setCollapsed(false) },
  h('span', { 'aria-hidden': 'true' }, '⟨'),
  h('span', null, 'Shop · Goals · Friends'),
);
function setCollapsed(c: boolean) {
  prefs.panelCollapsed = c;
  savePrefs(prefs);
  app.classList.toggle('panel-collapsed', c);
}
const app = h(
  'div',
  { class: 'app' },
  header.el,
  h(
    'main',
    { class: 'layout' },
    h('div', { class: 'col-left' }, room.stage, room.panel),
    h('div', { class: 'col-right' }, h('div', { class: 'nav-row' }, nav, collapseBtn), Object.values(views).map((v) => v.el)),
  ),
  expandBtn,
);
document.body.append(app, modalRoot, toastRoot);
app.classList.toggle('panel-collapsed', prefs.panelCollapsed);

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
  audio.setEnabled({ sfx: s.settings.sound, music: s.settings.music, typing: s.settings.typing, ambience: s.settings.ambience });
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
  // not every car: a passing car every few minutes is atmosphere, every few seconds is traffic
  onCar: (dir) => Math.random() < 0.3 && audio.play('car', { dir }),
  onThunder: () => audio.play('thunder'),
  onPet: (p) => audio.play(p === 'cat' ? 'meow' : 'bark'),
  onWorldEvent: (k) => world.onWorldEvent(k),
  onCatch: (k) => world.onCatch(k),
});
// bubbles, tap interactions, letter, customise / share, visit + zen modes, onboarding
const world = createWorld(ctx, { room, renderer, sc });

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
  if (s.sessions !== prev.sessions || s.purchases !== prev.purchases || s.bonuses !== prev.bonuses || s.friends !== prev.friends) {
    const ev = actions.evaluateAchievements(s, Date.now());
    if (ev.unlocked.length) {
      // re-evaluate against the latest state at write time (don't clobber anything set in between)
      queueMicrotask(() => store.set((cur) => actions.evaluateAchievements(cur, Date.now()).state));
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
  // deferred: the store reaction calls updateDom(), whose state is declared further down this module
  if (ev.unlocked.length) queueMicrotask(() => store.set((cur) => actions.evaluateAchievements(cur, Date.now()).state));
}
void cloud.configure(loadSyncConfig());
startSocial(ctx);

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
// ───────────── milestones (new sim day / season / year, every 10 hours) ─────────────
let milestoneTotal = -1;
let milestoneBest = -1;
function checkMilestones(total: number, studying: boolean) {
  const prevTotal = milestoneTotal;
  milestoneTotal = total;
  if (prevTotal < 0 || total <= prevTotal) return;
  // never celebrate the same ground twice (e.g. delete a session, then study past the boundary again)
  const best = milestoneBest;
  milestoneBest = Math.max(milestoneBest, total);
  if (total <= best) return;
  // live transitions only creep forward; a big jump while studying is a sync merge, not a sunrise
  if (studying && total - prevTotal > 10_000) return;
  const m = studying ? simMilestone(Math.max(prevTotal, best), total) : hoursMilestone(Math.max(prevTotal, best), total);
  if (!m) return;
  const t = toast(m.text, m.icon, m.big ? 6000 : 3500, 'milestone');
  if (m.big) {
    t.classList.add('toast-big');
    audio.play('level' as never);
  }
}
let lastAudio = 0;
function updateDom(now: number) {
  lastDom = now;
  const s = store.get();
  const total = totalStudiedMs(s, now);
  header.update(s, now);
  const simTotal = world.simTotal(total); // a visited friend's clock while visiting
  room.update(s, now, simTime(simTotal), weatherAt(simTotal));
  updateBadge(s, now);
  checkMilestones(total, sceneMode(s.active) === 'studying');
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
  const total = world.simTotal(totalStudiedMs(s, now));
  const sim = simTime(total);
  const weather = weatherAt(total);
  const mode = sceneMode(s.active);
  const its = items(s);
  // world.scene swaps in a friend's room while visiting
  const scene = world.scene({
    time: performance.now() / 1000,
    sim,
    weather,
    moon: moonPhase(total),
    mode,
    items: its,
    look: s.profile.appearance,
    room: s.profile.room,
    studiedHours: total / 3_600_000,
    realNow: now,
  });
  // The customise / onboarding sheet has its own live preview and covers the room: don't draw both.
  if (!modalRoot.querySelector('.modal.customize')) renderer.render(scene);
  world.frame(now, scene);
  if (now - lastDom >= 250) updateDom(now);
  if (now - lastAudio >= 1000) {
    lastAudio = now;
    audio.update({
      studying: mode === 'studying' && !world.visiting,
      onBreak: mode === 'break' || mode === 'paused',
      isNight: sim.isNight,
      season: sim.season,
      weather,
      pets: PET_IDS.filter((p) => scene.items.has(p)),
      view: scene.room.view,
      timeOfDay: sim.t,
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

document.addEventListener('keydown', (e) => {
  if (e.key !== '\\' || e.metaKey || e.ctrlKey || e.altKey || modalOpen() || isTypingTarget(e.target as HTMLElement | null)) return;
  if (wideMq.matches) setCollapsed(!prefs.panelCollapsed);
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
