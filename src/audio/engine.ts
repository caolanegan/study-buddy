/**
 * Study Buddy procedural audio engine.
 *
 * Everything is synthesised with the Web Audio API — there are no audio assets.
 *
 * Lifecycle / platform notes
 *  - No AudioContext exists until `unlock()` is called (call it from a user gesture:
 *    iOS Safari only lets a context start inside one). `unlock()` is cheap and idempotent,
 *    so it is fine to call it on every tap/click; that is also how a context that iOS put
 *    into 'suspended' / 'interrupted' (phone call, Siri, backgrounding) gets resumed.
 *  - While the context is not 'running' nothing is scheduled, so no backlog of sounds
 *    bursts out when it resumes.
 *  - CPU: shared white/brown noise + crackle buffers are generated once (pink noise lazily,
 *    on first use); continuous beds (rain, wind, crickets, fish tank, vinyl crackle, room
 *    tone, and the per-view waves / city hum / grass breeze / pines / stream / frogs) only
 *    exist while audible and are torn down after fading out; one-shot voices disconnect
 *    themselves in `onended`, and a voice cap drops purely decorative events (rain drops,
 *    key clicks, trickles, scheduler-picked ambience) under load.
 *  - Levels: everything outdoors sits behind a closed-window low-pass and well under the
 *    music (beds ≥ 9 dB below the full groove; clear-weather beds ≥ 14 dB).
 *  - A single interval timer (100 ms) drives a lookahead scheduler that places events on
 *    `ctx.currentTime`.
 *
 * Signal flow
 *   music voices ─► musicIn ─► musicLP ─► musicBus ─┐
 *   indoor (typing, desk, pets) ─────────► ambBus ──┤
 *   outdoor (rain, view beds, birds…) ► windowLP ► outdoorGain ► ambBus
 *   UI sfx ───────────────────────────────► sfxBus ─┼─► mix ► toneLP ► compressor ► master ► out
 */

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

/** What is outside the window (same ids as the profile's window views). */
export type AudioView = 'street' | 'seaside' | 'city' | 'countryside' | 'forest';

export const AUDIO_VIEWS: readonly AudioView[] = ['street', 'seaside', 'city', 'countryside', 'forest'];

export interface AudioScene {
  studying: boolean; // session running (not paused, not on break)
  onBreak: boolean; // pomodoro break or paused
  isNight: boolean;
  season: 0 | 1 | 2 | 3; // spring, summer, autumn, winter
  weather: Weather;
  pets: string[]; // owned+equipped pet ids: 'cat' | 'dog' | 'fish-tank' | 'lizard'
  /** Window view; selects the outdoor ambience. Default 'street'. */
  view?: AudioView;
  /** Sim day progress 0..1 (0 = sunrise, 0.5 = sunset; `SimTime.t`). Enables dawn sounds (rooster). */
  timeOfDay?: number;
}

export type Sfx =
  | 'coin'
  | 'achievement'
  | 'purchase'
  | 'chime'
  | 'start'
  | 'pause'
  | 'end'
  | 'thunder'
  | 'car'
  | 'meow'
  | 'bark'
  | 'click'
  | 'checkin'
  // world events
  | 'sparkle'
  | 'balloon'
  | 'fireworks'
  | 'train'
  | 'gull'
  | 'owl'
  | 'chirp'
  | 'whoosh'
  | 'horn'
  // interactions
  | 'purr'
  | 'boop'
  | 'hey'
  | 'sip'
  | 'rustle'
  | 'tick'
  | 'pop'
  | 'paper'
  | 'quest'
  | 'level';

/** Sounds that belong to the world (gated by the ambience switch, not UI effects). */
const AMBIENT_SFX = new Set<Sfx>([
  'thunder', 'car', 'meow', 'bark',
  'balloon', 'fireworks', 'train', 'gull', 'owl', 'chirp', 'whoosh', 'horn',
]);

/** Which settings switch gates a `play()` sound: 'ambience' (world/pets) or 'sfx' (UI & interactions). */
export function sfxChannel(name: Sfx): 'ambience' | 'sfx' {
  return AMBIENT_SFX.has(name) ? 'ambience' : 'sfx';
}

export const SFX_NAMES: readonly Sfx[] = [
  'coin', 'achievement', 'purchase', 'chime', 'start', 'pause', 'end',
  'thunder', 'car', 'meow', 'bark', 'click', 'checkin',
  'sparkle', 'balloon', 'fireworks', 'train', 'gull', 'owl', 'chirp', 'whoosh', 'horn',
  'purr', 'boop', 'hey', 'sip', 'rustle', 'tick', 'pop', 'paper', 'quest', 'level',
];

export interface PlayOptions {
  /** Direction for 'car' / 'whoosh': 1 = left→right (default random), -1 = right→left. */
  dir?: 1 | -1;
  /** Seconds from now to start the sound (default: immediately). */
  delay?: number;
}

export interface EngineOptions {
  /** Context factory (tests / offline rendering). Default: `new AudioContext()`. */
  createContext?: () => BaseAudioContext;
  /**
   * Offline mode: for rendering into an OfflineAudioContext. No timers are started and the
   * context state is not checked; drive the scheduler manually with `advanceTo(t)`.
   */
  offline?: boolean;
  /** Random source (0..1); injectable for deterministic tests. */
  random?: () => number;
}

// ───────────────────────────── pure decision logic ─────────────────────────────

export type AmbienceId =
  | 'birds'
  | 'owl'
  | 'wind'
  | 'distant-dog'
  | 'car'
  | 'mug'
  | 'page'
  | 'clock'
  | 'meow'
  | 'purr'
  | 'bark'
  | 'pant'
  | 'rustle'
  // per-view outdoor sounds
  | 'gull'
  | 'foghorn'
  | 'rigging'
  | 'train'
  | 'siren'
  | 'pigeon'
  | 'sheep'
  | 'cow'
  | 'rooster'
  | 'tractor'
  | 'songbird'
  | 'woodpecker';

/**
 * Continuous beds. rain/wind/crickets follow the weather; waves (seaside), hum (city),
 * breeze (countryside), pines + stream + frogs (forest) follow the view; room = quiet room tone.
 */
export type LoopId =
  | 'rain'
  | 'crickets'
  | 'wind'
  | 'bubbles'
  | 'waves'
  | 'hum'
  | 'breeze'
  | 'pines'
  | 'stream'
  | 'frogs'
  | 'room';

export const LOOP_IDS: readonly LoopId[] = [
  'rain', 'crickets', 'wind', 'bubbles', 'waves', 'hum', 'breeze', 'pines', 'stream', 'frogs', 'room',
];

/** Relative weights used when picking the next intermittent ambience. */
export const AMBIENCE_WEIGHTS: Record<AmbienceId, number> = {
  birds: 3,
  owl: 1.5,
  wind: 2,
  'distant-dog': 0.8,
  car: 1.2,
  mug: 1,
  page: 1.5,
  clock: 0.8,
  meow: 1,
  purr: 1.4,
  bark: 0.6,
  pant: 0.8,
  rustle: 1,
  gull: 2.5,
  foghorn: 0.35,
  rigging: 1.4,
  train: 0.6,
  siren: 0.2,
  pigeon: 2,
  sheep: 1.6,
  cow: 0.7,
  rooster: 5,
  tractor: 0.5,
  songbird: 3,
  woodpecker: 1.2,
};

/** Sim-day progress below which it counts as dawn (rooster time). */
export const DAWN = 0.06;

const isWet = (w: Weather) => w === 'rain' || w === 'storm';

/** Which intermittent (one-shot) ambience sounds fit the scene (view, time, season, weather, pets). */
export function eligibleAmbience(s: AudioScene): AmbienceId[] {
  const out: AmbienceId[] = [];
  const view = s.view ?? 'street';
  const wet = isWet(s.weather);
  const snow = s.weather === 'snow';
  const storm = s.weather === 'storm';
  const day = !s.isNight;
  // Songbirds: daytime, mostly spring/summer; autumn only on clear days; never in rain/snow.
  const birdy = day && !wet && !snow && (s.season <= 1 || (s.season === 2 && s.weather === 'clear'));
  const owl = s.isNight && !wet;
  switch (view) {
    case 'street':
      if (birdy) out.push('birds');
      if (owl) out.push('owl');
      if (!wet && !snow) out.push('distant-dog');
      out.push('car');
      break;
    case 'seaside':
      if (day && !wet && !snow) out.push('gull');
      out.push('rigging');
      if (s.isNight || s.weather === 'fog' || s.weather === 'cloudy' || s.weather === 'rain') out.push('foghorn');
      break;
    case 'city':
      if (day && !storm && !snow) out.push('pigeon');
      out.push('train');
      if (!snow) out.push('siren');
      break;
    case 'countryside':
      if (birdy) out.push('birds');
      if (day && !storm && s.timeOfDay !== undefined && s.timeOfDay < DAWN) out.push('rooster');
      if (day && !storm) out.push('sheep');
      if (day && !storm && !snow) out.push('cow');
      if (day && !wet && !snow && s.season !== 3) out.push('tractor');
      if (!wet && !snow) out.push('distant-dog');
      if (owl) out.push('owl');
      break;
    case 'forest':
      if (birdy) out.push('songbird');
      if (day && !wet && !snow) out.push('woodpecker');
      if (owl) out.push('owl');
      break;
  }
  if (s.season >= 2 || snow || storm) out.push('wind');
  if (s.studying || s.onBreak) out.push('mug');
  if (s.studying) out.push('page');
  out.push('clock');
  if (s.pets.includes('cat')) out.push('meow', 'purr');
  if (s.pets.includes('dog')) out.push('bark', 'pant');
  if (s.pets.includes('lizard')) out.push('rustle');
  return out;
}

const CRICKETS_BY_VIEW: Record<AudioView, number> = { street: 1, seaside: 0.4, city: 0.25, countryside: 1, forest: 0.7 };

/** Target levels (0..1, sometimes a bit above for storms) for the continuous ambience beds. */
export function loopLevels(s: AudioScene): Record<LoopId, number> {
  const view = s.view ?? 'street';
  const wet = isWet(s.weather);
  const snow = s.weather === 'snow';
  const storm = s.weather === 'storm';
  const winter = s.season === 3;
  const night = s.isNight;
  const crickets = night && !wet && !snow && s.season <= 1 ? (s.season === 1 ? 1 : 0.6) : 0;
  return {
    rain: storm ? 0.55 : s.weather === 'rain' ? 0.45 : 0,
    crickets: crickets * CRICKETS_BY_VIEW[view],
    wind: snow ? 0.6 : storm ? 0.4 : winter ? 0.3 : 0,
    bubbles: s.pets.includes('fish-tank') ? 1 : 0,
    waves: view === 'seaside' ? (storm ? 0.95 : snow ? 0.7 : wet ? 0.85 : 1) * (night ? 0.85 : 1) * (winter ? 0.85 : 1) : 0,
    hum: view === 'city' ? (night ? 0.6 : 1) * (snow ? 0.5 : wet ? 0.8 : 1) : 0,
    breeze:
      view === 'countryside' && !storm && !snow
        ? (s.season === 2 ? 1.2 : winter ? 0.6 : 1) * (s.weather === 'rain' ? 0.5 : 1) * (night ? 0.8 : 1)
        : 0,
    pines: view === 'forest' ? (storm ? 0.6 : snow ? 0.7 : s.season >= 2 ? 1.2 : 1) : 0,
    stream: view === 'forest' ? (winter || snow ? 0.45 : 1) : 0,
    frogs: view === 'forest' && night && s.season <= 1 && !storm && !snow ? (s.season === 1 ? 1 : 0.7) : 0,
    room: 1,
  };
}

/** Music intensity: full groove while actively studying, sparse/quiet otherwise. */
export function musicMode(s: AudioScene | null): 'full' | 'soft' {
  return s && s.studying && !s.onBreak ? 'full' : 'soft';
}

/** Seconds until the next intermittent ambience event (~20–90 s; sparser in snow, winter and at night). */
export function nextAmbienceDelay(s: AudioScene, rnd: () => number = Math.random): number {
  let d = 20 + rnd() * 70;
  if (s.weather === 'snow') d *= 1.4;
  if (s.season === 3) d *= 1.25;
  if (s.isNight) d *= 1.1;
  return d;
}

/** Weighted random pick, avoiding an immediate repeat when possible. */
export function pickAmbience(
  eligible: readonly AmbienceId[],
  rnd: () => number = Math.random,
  last?: AmbienceId,
): AmbienceId | null {
  const pool = eligible.length > 1 && last ? eligible.filter((a) => a !== last) : eligible;
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, a) => sum + AMBIENCE_WEIGHTS[a], 0);
  let x = rnd() * total;
  for (const a of pool) {
    x -= AMBIENCE_WEIGHTS[a];
    if (x < 0) return a;
  }
  return pool[pool.length - 1];
}

// ───────────────────────────── music material ─────────────────────────────

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const Q = {
  maj9: [0, 4, 7, 11, 14],
  maj7: [0, 4, 7, 11],
  m9: [0, 3, 7, 10, 14],
  m7: [0, 3, 7, 10],
  m11: [0, 3, 10, 14, 17],
  dom9: [0, 4, 10, 14],
  dom13: [0, 4, 10, 14, 21],
  dom7b9: [0, 4, 10, 13],
} as const;

type Chord = readonly [degree: number, intervals: readonly number[]];

/** Progressions as [scale degree in semitones from the key root, chord intervals]. */
const PROGRESSIONS: readonly (readonly Chord[])[] = [
  [[2, Q.m9], [7, Q.dom13], [0, Q.maj9], [9, Q.m9]], // 0 ii V I vi
  [[5, Q.maj9], [4, Q.m7], [2, Q.m9], [0, Q.maj9]], // 1 IV iii ii I
  [[0, Q.maj9], [9, Q.dom7b9], [2, Q.m9], [7, Q.dom9]], // 2 I VI7 ii V
  [[9, Q.m9], [2, Q.m11], [7, Q.dom9], [0, Q.maj9]], // 3 vi ii V I
  [[2, Q.m9], [7, Q.dom9], [4, Q.m7], [9, Q.dom7b9]], // 4 ii V iii VI7
  [[5, Q.maj7], [5, Q.m7], [0, Q.maj9], [9, Q.m9]], // 5 IV iv I vi
];
const KEYS = [0, 2, 3, 5, 7, 8, 10];

export interface MusicFlavor {
  /** Candidate key roots (semitones above C). */
  keys: readonly number[];
  /** Candidate progression indices. */
  progressions: readonly number[];
  bpm: readonly [min: number, max: number];
  /** 0..1 multiplier on optional notes (melody, re-hits, ghost hats). */
  density: number;
  /** Music low-pass cutoff (Hz): brighter in spring/summer days, mellower autumn/winter/night. */
  tone: number;
}

/** Season/time-of-day colouring of the lo-fi: brighter spring/summer, mellower autumn/winter, sparser at night. */
export function musicFlavor(s: AudioScene | null): MusicFlavor {
  if (!s) return { keys: KEYS, progressions: [0, 1, 2, 3, 4, 5], bpm: [72, 80], density: 1, tone: 4800 };
  const f: MusicFlavor =
    s.season <= 1
      ? { keys: [0, 2, 4, 7, 9], progressions: [0, 1, 2, 3], bpm: [74, 82], density: 1, tone: 5200 }
      : s.season === 2
        ? { keys: [3, 5, 8, 10], progressions: [0, 3, 4, 5], bpm: [70, 77], density: 0.9, tone: 4400 }
        : { keys: [1, 3, 8, 10], progressions: [3, 4, 5], bpm: [68, 74], density: 0.8, tone: 4000 };
  if (!s.isNight) return f;
  return { ...f, bpm: [f.bpm[0] - 3, f.bpm[1] - 3], density: f.density * 0.55, tone: Math.round(f.tone * 0.8) };
}

// ───────────────────────────── engine ─────────────────────────────

const TICK_MS = 100;
const LOOKAHEAD = 0.5; // seconds
const MAX_VOICES = 110;
const MIN = 0.0001;

const MUSIC_LEVEL = { full: 0.55, soft: 0.32 };
const AMB_LEVEL = 0.8;
/** Closed-window low-pass on everything outdoors (Hz). */
const WINDOW_LP = 5000;
/** Skip purely decorative one-shots above this many live voices. */
const DECOR_VOICES = MAX_VOICES * 0.8;
const SFX_LEVEL = 0.7;
const MASTER_LEVEL = 0.85;

/** Bookkeeping for one short-lived voice: all nodes are disconnected when the last source ends. */
class Voice {
  nodes: AudioNode[] = [];
  last: AudioScheduledSourceNode | null = null;
  lastT = -Infinity;
  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  src<T extends AudioScheduledSourceNode>(n: T, start: number, stop: number, offset?: number): T {
    if (offset !== undefined) (n as unknown as AudioBufferSourceNode).start(start, offset);
    else n.start(start);
    n.stop(stop);
    if (stop > this.lastT) {
      this.lastT = stop;
      this.last = n;
    }
    return this.add(n);
  }
}

interface LoopInst {
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  level: number;
  /** extra per-loop handles (e.g. cricket gains) */
  params: AudioParam[];
}

type LoopKey = LoopId | 'crackle';

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private readonly opts: EngineOptions;
  private readonly rnd: () => number;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private volume = 0.8;
  private sfxOn = true;
  private musicOn = true;
  private typingOn = true;
  private ambienceOn = true;
  private scene: AudioScene | null = null;

  // graph
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicIn!: GainNode;
  private epBus!: GainNode;
  private drumBus!: GainNode;
  private echoIn!: GainNode;
  private ambBus!: GainNode;
  private indoor!: GainNode;
  private outdoor!: GainNode;
  private windowLP!: BiquadFilterNode;
  private outdoorGain!: GainNode;
  private sfxBus!: GainNode;
  private wowGain!: GainNode;
  private musicLP!: BiquadFilterNode;
  private persistent: AudioScheduledSourceNode[] = [];

  // buffers
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private crackleBuf!: AudioBuffer;
  private pinkBuf: AudioBuffer | null = null;

  private voices = 0;
  private loops = new Map<LoopKey, LoopInst>();

  // music scheduler state
  private musicRunning = false;
  private nextStepTime = 0;
  private step = 0;
  private bar = 0;
  private prog: readonly Chord[] = PROGRESSIONS[0];
  private musicKey = 0;
  private bpm = 76;
  private swing = 0.2;
  private barsPerProg = 16;
  private compRehit = false;

  // ambience state
  private typingNext = 0;
  private keysLeft = 0;
  private wordLeft = 4;
  private nextAmbienceAt = 0;
  private lastAmbience: AmbienceId | undefined;
  private nextRumbleAt = 0;
  private dropNext = 0;
  private bubbleNext = 0;
  private cricketNext = [0, 0];
  private frogNext = [0, 0];
  private waveNext = 0;
  private streamNext = 0;
  private simNow = 0;

  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
    this.rnd = opts.random ?? Math.random;
  }

  // ─────────── public API ───────────

  /** Create/resume the AudioContext. Must be called from a user gesture on iOS. */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      const ctx = this.makeContext();
      if (!ctx) return;
      this.ctx = ctx;
      this.build();
    }
    const ctx = this.ctx;
    let resumed: Promise<void> | undefined;
    const state = ctx.state as string;
    if (!this.opts.offline && state !== 'running' && state !== 'closed') {
      const r = (ctx as AudioContext).resume;
      // resume() must be invoked synchronously inside the gesture handler (iOS).
      if (typeof r === 'function') resumed = r.call(ctx);
    }
    this.ensureTimer();
    this.applyScene();
    if (resumed) {
      try {
        await resumed;
      } catch {
        /* resume can reject if not in a gesture; the next unlock() retries */
      }
    }
    this.tick();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    if (this.ctx) this.ramp(this.master.gain, this.volume * MASTER_LEVEL, 0.08);
  }

  /**
   * sfx = UI effects & interactions (coins, chimes, boop, quest…; see `sfxChannel`), music = lo-fi,
   * typing = keyboard clicks, ambience = weather/view beds, room tone, outdoor, world-event & pet
   * sounds. typing/ambience default to `sfx` when omitted.
   */
  setEnabled(opts: { sfx: boolean; music: boolean; typing?: boolean; ambience?: boolean }): void {
    const musicWas = this.musicOn;
    this.sfxOn = !!opts.sfx;
    this.musicOn = !!opts.music;
    this.typingOn = opts.typing ?? !!opts.sfx;
    this.ambienceOn = opts.ambience ?? !!opts.sfx;
    if (!this.ctx) return;
    if (this.musicOn && !musicWas) this.musicRunning = false; // restart cleanly
    this.applyScene();
  }

  update(scene: AudioScene): void {
    const prev = this.scene;
    this.scene = { ...scene, pets: [...scene.pets] };
    if (!this.ctx) return;
    if (prev && prev.studying && !scene.studying) this.typingNext = 0;
    this.applyScene();
  }

  play(name: Sfx, opts: PlayOptions = {}): void {
    if (!this.ctx || !this.isLive()) return;
    if (!(sfxChannel(name) === 'ambience' ? this.ambienceOn : this.sfxOn)) return;
    const t = this.now() + 0.01 + Math.max(0, opts.delay ?? 0);
    try {
      this.playAt(name, t, opts);
    } catch (e) {
      // never let audio break the app
      if (typeof console !== 'undefined') console.warn('[audio] play failed', name, e);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.loops.clear();
    this.persistent = [];
    if (ctx && 'close' in ctx && typeof (ctx as AudioContext).close === 'function' && (ctx.state as string) !== 'closed') {
      (ctx as AudioContext).close().catch(() => {});
    }
  }

  /** True once a context exists (diagnostics). */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /**
   * Offline/testing: run the scheduler up to context time `t` (seconds) in 100 ms steps.
   * Only meaningful with `offline: true`.
   */
  advanceTo(t: number): void {
    if (!this.ctx) return;
    while (this.simNow < t) {
      this.simNow = Math.min(t, this.simNow + TICK_MS / 1000);
      this.tick(this.simNow, this.simNow + LOOKAHEAD);
    }
  }

  // ─────────── context + graph ───────────

  private makeContext(): BaseAudioContext | null {
    if (this.opts.createContext) return this.opts.createContext();
    const g = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const C = g.AudioContext ?? g.webkitAudioContext;
    if (!C) return null;
    try {
      return new C({ latencyHint: 'playback' });
    } catch {
      try {
        return new C();
      } catch {
        return null;
      }
    }
  }

  private now(): number {
    if (!this.ctx) return 0;
    return this.opts.offline ? Math.max(this.simNow, this.ctx.currentTime) : this.ctx.currentTime;
  }

  private isLive(): boolean {
    if (!this.ctx) return false;
    return this.opts.offline ? true : (this.ctx.state as string) === 'running';
  }

  private ensureTimer() {
    if (this.opts.offline || this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private build() {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;

    // shared buffers
    this.white = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = this.rnd() * 2 - 1;

    this.brown = ctx.createBuffer(1, Math.floor(sr * 4), sr);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (this.rnd() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    // crossfade the loop seam
    const xf = Math.min(2000, Math.floor(b.length / 4));
    for (let i = 0; i < xf; i++) {
      const k = i / xf;
      b[i] = b[i] * k + b[b.length - xf + i] * (1 - k);
    }

    this.crackleBuf = ctx.createBuffer(1, Math.floor(sr * 5), sr);
    const c = this.crackleBuf.getChannelData(0);
    let pop = 0;
    let popDecay = 0.9;
    const popRate = 7 / sr;
    for (let i = 0; i < c.length; i++) {
      if (this.rnd() < popRate) {
        pop = (this.rnd() < 0.5 ? -1 : 1) * (0.08 + this.rnd() * (this.rnd() < 0.1 ? 0.5 : 0.22));
        popDecay = 0.55 + this.rnd() * 0.35;
      }
      c[i] = pop + (this.rnd() * 2 - 1) * 0.006;
      pop *= popDecay;
    }

    // master chain
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * MASTER_LEVEL;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.3;
    const toneLP = this.filter('lowpass', 10500, 0.5);
    const mix = ctx.createGain();
    mix.connect(toneLP);
    toneLP.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // music
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicIn = ctx.createGain();
    const musicLP = this.filter('lowpass', 4800, 0.6);
    this.musicLP = musicLP;
    this.musicIn.connect(musicLP);
    musicLP.connect(this.musicBus);
    this.musicBus.connect(mix);

    this.epBus = ctx.createGain();
    this.epBus.gain.value = 0.9;
    const epLP = this.filter('lowpass', 2600, 0.5);
    this.epBus.connect(epLP);
    epLP.connect(this.musicIn);

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.85;
    this.drumBus.connect(this.musicIn);

    // cheap tape echo (no convolver: lighter on mobile)
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 0.35;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const fbLP = this.filter('lowpass', 1800, 0.5);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.5;
    this.echoIn.connect(delay);
    delay.connect(fbLP);
    fbLP.connect(fb);
    fb.connect(delay);
    fbLP.connect(echoOut);
    echoOut.connect(this.musicIn);
    this.epBus.connect(this.echoIn);

    // tape wow LFO → detune of EP oscillators
    const wow = ctx.createOscillator();
    wow.frequency.value = 0.45;
    this.wowGain = ctx.createGain();
    this.wowGain.gain.value = 7; // cents
    wow.connect(this.wowGain);
    wow.start();
    this.persistent.push(wow);

    // ambience
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0;
    this.ambBus.connect(mix);
    this.indoor = ctx.createGain();
    this.indoor.connect(this.ambBus);
    this.outdoor = ctx.createGain();
    this.windowLP = this.filter('lowpass', WINDOW_LP, 0.5);
    this.outdoorGain = ctx.createGain();
    this.outdoor.connect(this.windowLP);
    this.windowLP.connect(this.outdoorGain);
    this.outdoorGain.connect(this.ambBus);

    // ui sfx
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0;
    this.sfxBus.connect(mix);

    // iOS: start a silent buffer inside the gesture to fully unlock output.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, sr);
    silent.connect(ctx.destination);
    silent.onended = () => silent.disconnect();
    silent.start(0);
  }

  private applyScene() {
    if (!this.ctx) return;
    const s = this.scene;
    const now = this.now();
    const mode = musicMode(s);

    this.ramp(this.musicBus.gain, this.musicOn ? MUSIC_LEVEL[mode] : 0, 1.0);
    this.ramp(this.drumBus.gain, mode === 'full' ? 0.85 : 0, 1.0);
    this.ramp(this.ambBus.gain, this.ambienceOn || this.typingOn ? AMB_LEVEL : 0, 0.5);
    this.ramp(this.sfxBus.gain, this.sfxOn ? SFX_LEVEL : 0, 0.05);

    const snow = s?.weather === 'snow';
    const fog = s?.weather === 'fog';
    this.ramp(this.windowLP.frequency, snow ? 1500 : fog ? 3000 : WINDOW_LP, 1.5);
    this.ramp(this.outdoorGain.gain, snow ? 0.6 : fog ? 0.8 : 1, 1.5);
    this.ramp(this.musicLP.frequency, musicFlavor(s).tone, 3);

    this.setLoop('crackle', this.musicOn ? 1 : 0);
    const levels = s && this.ambienceOn ? loopLevels(s) : null;
    for (const id of LOOP_IDS) this.setLoop(id, levels ? levels[id] : 0);

    if (!this.musicOn) this.musicRunning = false;
    if (s && this.nextAmbienceAt === 0) this.nextAmbienceAt = now + 6 + this.rnd() * 14;
    if (s?.weather === 'storm' && this.nextRumbleAt === 0) this.nextRumbleAt = now + 4 + this.rnd() * 10;
    if (s?.weather !== 'storm') this.nextRumbleAt = 0;
  }

  /** Smoothly move a param to a target (time constant `tc`). */
  private ramp(p: AudioParam, target: number, tc: number) {
    const now = this.now();
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(target, now, tc);
  }

  // ─────────── scheduler ───────────

  private tick(now?: number, horizon?: number) {
    if (!this.ctx || this.disposed || !this.isLive()) return;
    try {
      const n = now ?? this.ctx.currentTime;
      const h = horizon ?? n + LOOKAHEAD;
      if (this.musicOn) this.scheduleMusic(n, h);
      const s = this.scene;
      if (!s) return;
      if (this.typingOn) this.scheduleTyping(s, n, h);
      if (!this.ambienceOn) return;
      this.scheduleLoopEvents(n, h);
      this.scheduleAmbience(s, n);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[audio] scheduler error', e);
    }
  }

  private scheduleTyping(s: AudioScene, now: number, horizon: number) {
    if (!s.studying) {
      this.typingNext = 0;
      return;
    }
    if (this.typingNext === 0 || this.typingNext < now - 0.5) {
      // (re)start: first burst soon
      this.typingNext = now + 0.4 + this.rnd() * 1.6;
      this.keysLeft = 0;
    }
    let guard = 0;
    while (this.typingNext < horizon && guard++ < 64) {
      if (this.keysLeft <= 0) {
        // pause between bursts: usually short, sometimes a long "thinking" pause
        const r = this.rnd();
        const pause = r < 0.15 ? 9 + this.rnd() * 16 : r < 0.5 ? 3 + this.rnd() * 5 : 0.8 + this.rnd() * 2.2;
        this.typingNext += pause;
        this.keysLeft = 4 + Math.floor(this.rnd() * 32);
        this.wordLeft = 2 + Math.floor(this.rnd() * 7);
        continue;
      }
      const t = this.typingNext;
      this.wordLeft--;
      const space = this.wordLeft <= 0;
      if (space) this.wordLeft = 2 + Math.floor(this.rnd() * 8);
      if (t >= now) this.keyClick(t, space);
      this.keysLeft--;
      let gap = 0.06 + this.rnd() * 0.14;
      if (this.rnd() < 0.08) gap += 0.25 + this.rnd() * 0.4; // hesitation
      this.typingNext += gap;
    }
  }

  private scheduleLoopEvents(now: number, horizon: number) {
    const rain = this.loops.get('rain');
    if (rain && rain.level > 0) {
      const rate = 3 + rain.level * 8; // drops / s
      if (this.dropNext < now) this.dropNext = now + this.rnd() * 0.2;
      let guard = 0;
      while (this.dropNext < horizon && guard++ < 40) {
        this.drop(this.dropNext, rain.level);
        this.dropNext += -Math.log(1 - this.rnd() * 0.999) / rate;
      }
    }
    const bub = this.loops.get('bubbles');
    if (bub && bub.level > 0) {
      if (this.bubbleNext < now) this.bubbleNext = now + this.rnd() * 0.5;
      let guard = 0;
      while (this.bubbleNext < horizon && guard++ < 20) {
        this.bubble(this.bubbleNext);
        // clustered: mostly quick successions, sometimes a pause
        this.bubbleNext += this.rnd() < 0.85 ? 0.05 + this.rnd() * 0.25 : 0.8 + this.rnd() * 2.5;
      }
    }
    const cr = this.loops.get('crickets');
    if (cr && cr.level > 0) {
      cr.params.forEach((p, i) => {
        if (this.cricketNext[i] < now) this.cricketNext[i] = now + this.rnd() * 0.6;
        let guard = 0;
        while (this.cricketNext[i] < horizon && guard++ < 10) {
          const t = this.cricketNext[i];
          const pulses = 3 + (this.rnd() < 0.3 ? 1 : 0);
          for (let k = 0; k < pulses; k++) {
            const pt = t + k * 0.048;
            p.setValueAtTime(0, pt);
            p.linearRampToValueAtTime(1, pt + 0.008);
            p.linearRampToValueAtTime(0, pt + 0.032);
          }
          this.cricketNext[i] += this.rnd() < 0.06 ? 2 + this.rnd() * 3 : (i ? 0.62 : 0.74) + this.rnd() * 0.08;
        }
      });
    }
    const frogs = this.loops.get('frogs');
    if (frogs && frogs.level > 0) {
      frogs.params.forEach((p, i) => {
        if (this.frogNext[i] < now) this.frogNext[i] = now + 0.3 + this.rnd() * 1.5;
        let guard = 0;
        while (this.frogNext[i] < horizon && guard++ < 6) {
          const t = this.frogNext[i];
          // "rr-ibbit": a short burst of glottal pulses, sometimes a double croak
          const pulses = 3 + Math.floor(this.rnd() * 4);
          const double = this.rnd() < 0.4;
          for (let c = 0; c < (double ? 2 : 1); c++) {
            const ct = t + c * (pulses * 0.03 + 0.09);
            for (let k = 0; k < pulses; k++) {
              const pt = ct + k * 0.03;
              p.setValueAtTime(0, pt);
              p.linearRampToValueAtTime(1 - k * 0.08, pt + 0.005);
              p.linearRampToValueAtTime(0, pt + 0.024);
            }
          }
          this.frogNext[i] += this.rnd() < 0.15 ? 4 + this.rnd() * 6 : 0.9 + this.rnd() * 1.8;
        }
      });
    }
    const waves = this.loops.get('waves');
    if (waves && waves.level > 0) {
      if (this.waveNext < now) this.waveNext = now + 0.2;
      if (this.waveNext < horizon) {
        // one slow swell: the wash filter opens while it builds, then the foam drains away
        const [lpF, wash, body] = waves.params;
        const t = this.waveNext;
        const rise = 2.6 + this.rnd() * 1.6;
        const fall = 3.2 + this.rnd() * 2.2;
        const crest = 0.65 + this.rnd() * 0.35;
        lpF.setValueAtTime(420, t);
        lpF.exponentialRampToValueAtTime(1100 + 900 * crest, t + rise);
        lpF.exponentialRampToValueAtTime(420, t + rise + fall);
        wash.setValueAtTime(0.18, t);
        wash.linearRampToValueAtTime(crest, t + rise);
        wash.linearRampToValueAtTime(0.18, t + rise + fall);
        body.setValueAtTime(0.35, t);
        body.linearRampToValueAtTime(0.6 + 0.4 * crest, t + rise * 0.8);
        body.linearRampToValueAtTime(0.35, t + rise + fall * 0.8);
        this.waveNext = t + rise + fall + this.rnd() * 1.2;
      }
    }
    const stream = this.loops.get('stream');
    if (stream && stream.level > 0) {
      if (this.streamNext < now) this.streamNext = now + this.rnd() * 0.3;
      let guard = 0;
      while (this.streamNext < horizon && guard++ < 12) {
        this.trickle(this.streamNext, stream.out);
        this.streamNext += this.rnd() < 0.8 ? 0.08 + this.rnd() * 0.3 : 0.6 + this.rnd() * 1.4;
      }
    }
  }

  private scheduleAmbience(s: AudioScene, now: number) {
    if (this.nextAmbienceAt > 0 && now >= this.nextAmbienceAt) {
      const id = pickAmbience(eligibleAmbience(s), this.rnd, this.lastAmbience);
      if (id) {
        this.lastAmbience = id;
        this.playAmbience(id, now + 0.05);
      }
      this.nextAmbienceAt = now + nextAmbienceDelay(s, this.rnd);
    }
    if (s.weather === 'storm' && this.nextRumbleAt > 0 && now >= this.nextRumbleAt) {
      this.rumble(now + 0.05, 0.1 + this.rnd() * 0.08);
      this.nextRumbleAt = now + 15 + this.rnd() * 30;
    }
  }

  private playAmbience(id: AmbienceId, t: number) {
    if (this.voices > DECOR_VOICES) return; // purely decorative: drop under load
    switch (id) {
      case 'birds': return this.birds(t);
      case 'owl': return this.owl(t);
      case 'wind': return this.windGust(t);
      case 'distant-dog': return this.bark(t, true);
      case 'car': return this.car(t, this.rnd() < 0.5 ? 1 : -1, CAR_AMBIENT);
      case 'mug': return this.mug(t);
      case 'page': return this.page(t, this.indoor, 0.8);
      case 'clock': return this.clock(t);
      case 'meow': return this.meow(t, 0.6);
      case 'purr': return this.purr(t, this.indoor, undefined, undefined, 0.6);
      case 'bark': return this.bark(t, false, 0.5);
      case 'pant': return this.pant(t);
      case 'rustle': return this.rustle(t);
      case 'gull': return this.gull(t);
      case 'foghorn': return this.foghorn(t);
      case 'rigging': return this.rigging(t);
      case 'train': return this.train(t, 0.8);
      case 'siren': return this.siren(t);
      case 'pigeon': return this.pigeon(t);
      case 'sheep': return this.sheep(t);
      case 'cow': return this.cow(t);
      case 'rooster': return this.rooster(t);
      case 'tractor': return this.tractor(t);
      case 'songbird': return this.songbird(t);
      case 'woodpecker': return this.woodpecker(t);
    }
  }

  // ─────────── music ───────────

  private newProgression(first: boolean) {
    const fl = musicFlavor(this.scene);
    const prev = this.prog;
    const pick = (k: number) => PROGRESSIONS[fl.progressions[k % fl.progressions.length]];
    const k = Math.floor(this.rnd() * fl.progressions.length);
    let p = pick(k);
    if (!first && p === prev) p = pick(k + 1);
    this.prog = p;
    if (first || this.rnd() < 0.5 || !fl.keys.includes(this.musicKey)) {
      this.musicKey = fl.keys[Math.floor(this.rnd() * fl.keys.length)];
    }
    this.bpm = fl.bpm[0] + Math.floor(this.rnd() * (fl.bpm[1] - fl.bpm[0] + 1));
    this.swing = 0.14 + this.rnd() * 0.12;
    this.barsPerProg = p.length * (2 + Math.floor(this.rnd() * 3));
  }

  private scheduleMusic(now: number, horizon: number) {
    if (!this.musicRunning) {
      this.musicRunning = true;
      this.step = 0;
      this.bar = 0;
      this.nextStepTime = now + 0.15;
      this.newProgression(true);
    }
    if (this.nextStepTime < now - 0.2) {
      // fell behind (tab throttled / resumed): skip ahead instead of bursting notes
      this.nextStepTime = now + 0.05;
    }
    const mode = musicMode(this.scene);
    const density = musicFlavor(this.scene).density;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 64) {
      const stepDur = 60 / this.bpm / 4;
      const t = this.nextStepTime + (this.step % 2 === 1 ? this.swing * stepDur : 0);
      this.musicStep(this.step, t, stepDur, mode, density);
      this.nextStepTime += stepDur;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        if (this.bar % this.barsPerProg === 0) this.newProgression(false);
      }
    }
  }

  private chordNotes(idx: number): { root: number; notes: number[] } {
    const [deg, ints] = this.prog[idx % this.prog.length];
    let base = 45 + ((this.musicKey + deg) % 12); // 45..56
    if (base > 52) base -= 12;
    const notes = ints.filter((i) => i !== 0).map((i) => base + 12 + i - (i >= 14 ? 12 : 0));
    // keep a compact voicing around middle C
    const voiced = notes.map((n) => (n > 72 ? n - 12 : n < 52 ? n + 12 : n)).sort((a, b) => a - b);
    return { root: base, notes: Array.from(new Set(voiced)) };
  }

  private musicStep(step: number, t: number, sd: number, mode: 'full' | 'soft', density = 1) {
    const r = this.rnd;
    const idx = this.bar % this.prog.length;
    const { root, notes } = this.chordNotes(idx);
    const barDur = sd * 16;
    const soft = mode === 'soft';

    // chords (Rhodes-ish)
    if (step === 0) {
      this.compRehit = r() < 0.35 * density;
      const dur = this.compRehit ? sd * 10 : barDur - 0.05;
      notes.forEach((n, i) => this.ep(n, t + i * (0.008 + r() * 0.01), dur, (soft ? 0.05 : 0.065) + r() * 0.02));
    } else if (step === 11 && this.compRehit) {
      notes.forEach((n, i) => this.ep(n, t + i * 0.01, sd * 4.5, (soft ? 0.035 : 0.045) + r() * 0.015));
    }

    // bass
    const bassRoot = root - 12; // 33..40 → raise for small speakers
    const br = bassRoot < 36 ? bassRoot + 12 : bassRoot;
    if (step === 0) this.bass(br, t, sd * 6, soft ? 0.22 : 0.3);
    else if (!soft && step === 10 && r() < 0.8) this.bass(r() < 0.6 ? br : br + 7, t, sd * 3, 0.24);
    else if (!soft && step === 14 && r() < 0.35) {
      const next = this.chordNotes(idx + 1).root - 12;
      const nb = next < 36 ? next + 12 : next;
      this.bass(nb + (r() < 0.5 ? -1 : 1), t, sd * 1.6, 0.18);
    }

    // sparse melody
    if ((step === 3 || step === 6 || step === 8 || step === 14) && r() < (soft ? 0.05 : 0.12) * density) {
      const n = notes[Math.floor(r() * notes.length)] + 12;
      this.ep(n, t, sd * (2 + r() * 3), 0.045, true);
    }

    if (soft) return;
    // drums: boom-bap
    if (step === 0 || (step === 7 && r() < 0.35 * density) || step === 10 || (step === 15 && r() < 0.15 * density)) {
      this.kick(t, step === 0 ? 0.8 : 0.6);
    }
    if (step === 4 || step === 12) this.snare(t, 0.32 + r() * 0.06);
    else if ((step === 9 || step === 15) && r() < 0.12 * density) this.snare(t, 0.08); // ghost
    if (step % 2 === 0) {
      // sparser hats when the flavour is sparse (night): drop some off-quarter eighths
      const drop = step % 4 === 2 ? (1 - density) * 0.6 : 0;
      if (r() > 0.06 + drop) this.hat(t, 0.05 + r() * 0.035, step === 14 && r() < 0.25 * density);
    } else if (r() < 0.18 * density) this.hat(t, 0.025, false);
  }

  private ep(midi: number, t: number, dur: number, vel: number, lead = false) {
    if (this.voices > MAX_VOICES) return;
    const ctx = this.ctx!;
    const v = new Voice();
    const f = mtof(midi);
    const end = t + dur + 0.5;
    const out = v.add(ctx.createGain());
    out.gain.setValueAtTime(MIN, t);
    out.gain.linearRampToValueAtTime(vel, t + 0.012);
    out.gain.exponentialRampToValueAtTime(vel * 0.45, t + Math.min(0.5, dur));
    out.gain.setValueAtTime(vel * 0.45 * 0.9, t + dur);
    out.gain.exponentialRampToValueAtTime(MIN, end);
    out.connect(this.epBus);

    const o1 = v.add(ctx.createOscillator());
    o1.type = 'sine';
    o1.frequency.value = f;
    o1.detune.value = (this.rnd() - 0.5) * 8;
    o1.connect(out);
    const o2 = v.add(ctx.createOscillator());
    o2.type = 'triangle';
    o2.frequency.value = f;
    o2.detune.value = 5 + this.rnd() * 4;
    const g2 = v.add(ctx.createGain());
    g2.gain.value = lead ? 0.15 : 0.3;
    o2.connect(g2);
    g2.connect(out);
    // tine: short bell-ish overtone
    const o3 = v.add(ctx.createOscillator());
    o3.type = 'sine';
    o3.frequency.value = f * 4.0;
    const g3 = v.add(ctx.createGain());
    g3.gain.setValueAtTime(MIN, t);
    g3.gain.linearRampToValueAtTime(lead ? 0.12 : 0.2, t + 0.004);
    g3.gain.exponentialRampToValueAtTime(MIN, t + 0.35);
    o3.connect(g3);
    g3.connect(out);
    this.wowGain.connect(o1.detune);
    this.wowGain.connect(o2.detune);
    v.src(o1, t, end);
    v.src(o2, t, end);
    v.src(o3, t, t + 0.4);
    this.commit(v, () => {
      try {
        this.wowGain.disconnect(o1.detune);
        this.wowGain.disconnect(o2.detune);
      } catch {
        /* already gone */
      }
    });
  }

  private bass(midi: number, t: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const v = new Voice();
    const f = mtof(midi);
    const end = t + dur + 0.15;
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.015);
    g.gain.exponentialRampToValueAtTime(vel * 0.55, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(MIN, end);
    const lp = v.add(this.filter('lowpass', 420, 0.8));
    const o = v.add(ctx.createOscillator());
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = v.add(ctx.createOscillator());
    o2.type = 'triangle';
    o2.frequency.value = f;
    const g2 = v.add(ctx.createGain());
    g2.gain.value = 0.5;
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.musicIn);
    v.src(o, t, end);
    v.src(o2, t, end);
    this.commit(v);
  }

  private kick(t: number, vel: number) {
    const ctx = this.ctx!;
    const v = new Voice();
    const o = v.add(ctx.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(MIN, t + 0.38);
    o.connect(g);
    g.connect(this.drumBus);
    v.src(o, t, t + 0.4);
    this.commit(v);
  }

  private snare(t: number, vel: number) {
    const ctx = this.ctx!;
    const v = new Voice();
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(MIN, t + 0.2);
    const n = this.noiseSrc(v, t, 0.22);
    const bp = v.add(this.filter('bandpass', 1700, 0.7));
    n.connect(bp);
    bp.connect(g);
    const body = v.add(ctx.createOscillator());
    body.type = 'triangle';
    body.frequency.setValueAtTime(200, t);
    body.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const bg = v.add(ctx.createGain());
    bg.gain.setValueAtTime(MIN, t);
    bg.gain.linearRampToValueAtTime(vel * 0.45, t + 0.003);
    bg.gain.exponentialRampToValueAtTime(MIN, t + 0.1);
    body.connect(bg);
    bg.connect(this.drumBus);
    g.connect(this.drumBus);
    v.src(body, t, t + 0.12);
    this.commit(v);
  }

  private hat(t: number, vel: number, open: boolean) {
    if (this.voices > MAX_VOICES) return;
    const v = new Voice();
    const dur = open ? 0.22 : 0.045;
    const n = this.noiseSrc(v, t, dur + 0.01);
    const hp = v.add(this.filter('highpass', 7000, 0.7));
    const g = v.add(this.ctx!.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.drumBus);
    this.commit(v);
  }

  // ─────────── loops ───────────

  private setLoop(id: LoopKey, level: number) {
    const now = this.now();
    let l = this.loops.get(id);
    if (level <= 0) {
      if (!l) return;
      this.loops.delete(id);
      this.ramp(l.out.gain, 0, 0.8);
      const stopAt = now + 5;
      l.srcs.forEach((s) => s.stop(stopAt));
      const nodes = l.nodes;
      if (l.srcs[0]) l.srcs[0].onended = () => nodes.forEach((n) => n.disconnect());
      return;
    }
    if (!l) {
      l = this.buildLoop(id);
      this.loops.set(id, l);
    }
    if (l.level !== level) {
      l.level = level;
      this.ramp(l.out.gain, level * LOOP_BASE[id], 1.2);
    }
  }

  private buildLoop(id: LoopKey): LoopInst {
    const ctx = this.ctx!;
    const t = this.now();
    const out = ctx.createGain();
    out.gain.value = 0;
    const l: LoopInst = { out, srcs: [], nodes: [out], level: 0, params: [] };
    const add = <T extends AudioNode>(n: T) => (l.nodes.push(n), n);
    const loopSrc = (buf: AudioBuffer) => {
      const s = add(ctx.createBufferSource());
      s.buffer = buf;
      s.loop = true;
      s.start(t, this.rnd() * buf.duration * 0.9);
      l.srcs.push(s);
      return s;
    };
    const osc = (type: OscillatorType, f: number) => {
      const o = add(ctx.createOscillator());
      o.type = type;
      o.frequency.value = f;
      o.start(t);
      l.srcs.push(o);
      return o;
    };

    switch (id) {
      case 'crackle': {
        const s = loopSrc(this.crackleBuf);
        const hp = add(this.filter('highpass', 900, 0.7));
        s.connect(hp);
        hp.connect(out);
        out.connect(this.musicBus);
        break;
      }
      case 'rain': {
        const s = loopSrc(this.white);
        const hp = add(this.filter('highpass', 500, 0.5));
        const lp = add(this.filter('lowpass', 4200, 0.5));
        s.connect(hp);
        hp.connect(lp);
        lp.connect(out);
        const s2 = loopSrc(this.brown);
        const lp2 = add(this.filter('lowpass', 900, 0.5));
        const g2 = add(ctx.createGain());
        g2.gain.value = 0.6;
        s2.connect(lp2);
        lp2.connect(g2);
        g2.connect(out);
        out.connect(this.outdoor);
        break;
      }
      case 'wind': {
        const s = loopSrc(this.brown);
        const bp = add(this.filter('bandpass', 450, 0.8));
        const amp = add(ctx.createGain());
        amp.gain.value = 0.65;
        const lfo = osc('sine', 0.07);
        const lfoG = add(ctx.createGain());
        lfoG.gain.value = 220;
        lfo.connect(lfoG);
        lfoG.connect(bp.frequency);
        const lfo2 = osc('sine', 0.11);
        const lfo2G = add(ctx.createGain());
        lfo2G.gain.value = 0.3;
        lfo2.connect(lfo2G);
        lfo2G.connect(amp.gain);
        s.connect(bp);
        bp.connect(amp);
        amp.connect(out);
        out.connect(this.outdoor);
        break;
      }
      case 'crickets': {
        [4400, 4950].forEach((f) => {
          const o = osc('sine', f + (this.rnd() - 0.5) * 120);
          const g = add(ctx.createGain());
          g.gain.value = 0;
          o.connect(g);
          g.connect(out);
          l.params.push(g.gain);
        });
        this.cricketNext = [0, 0];
        out.connect(this.outdoor);
        break;
      }
      case 'bubbles': {
        // aquarium pump hum
        const s = loopSrc(this.brown);
        const lp = add(this.filter('lowpass', 260, 0.7));
        const hum = osc('sine', 100);
        const hg = add(ctx.createGain());
        hg.gain.value = 0.02;
        hum.connect(hg);
        hg.connect(out);
        s.connect(lp);
        lp.connect(out);
        out.connect(this.indoor);
        break;
      }
      case 'room': {
        // barely-there room tone so the gaps between sounds are not dead digital silence
        const s = loopSrc(this.brown);
        const lp = add(this.filter('lowpass', 220, 0.5));
        s.connect(lp);
        lp.connect(out);
        out.connect(this.indoor);
        break;
      }
      case 'waves': {
        // pink-noise wash through a filter that the scheduler opens/closes per swell, plus a low body
        const s = loopSrc(this.pink());
        const lp = add(this.filter('lowpass', 420, 0.4));
        const wash = add(ctx.createGain());
        wash.gain.value = 0.18;
        s.connect(lp);
        lp.connect(wash);
        wash.connect(out);
        const s2 = loopSrc(this.brown);
        const lp2 = add(this.filter('lowpass', 260, 0.5));
        const body = add(ctx.createGain());
        body.gain.value = 0.35;
        s2.connect(lp2);
        lp2.connect(body);
        body.connect(out);
        l.params.push(lp.frequency, wash.gain, body.gain);
        this.waveNext = 0;
        out.connect(this.outdoor);
        break;
      }
      case 'hum': {
        // far-off city: low traffic rumble + a faint wash, breathing very slowly
        const s = loopSrc(this.brown);
        const lp = add(this.filter('lowpass', 240, 0.5));
        const amp = add(ctx.createGain());
        amp.gain.value = 0.75;
        const lfo = osc('sine', 0.045);
        const lfoG = add(ctx.createGain());
        lfoG.gain.value = 0.2;
        lfo.connect(lfoG);
        lfoG.connect(amp.gain);
        s.connect(lp);
        lp.connect(amp);
        const s2 = loopSrc(this.pink());
        const bp = add(this.filter('bandpass', 900, 0.5));
        const g2 = add(ctx.createGain());
        g2.gain.value = 0.12;
        s2.connect(bp);
        bp.connect(g2);
        g2.connect(amp);
        amp.connect(out);
        out.connect(this.outdoor);
        break;
      }
      case 'breeze': {
        // wind combing through long grass: airy band that drifts in pitch and level
        const s = loopSrc(this.pink());
        const bp = add(this.filter('bandpass', 1700, 0.7));
        const lfo = osc('sine', 0.06);
        const lfoG = add(ctx.createGain());
        lfoG.gain.value = 600;
        lfo.connect(lfoG);
        lfoG.connect(bp.frequency);
        const amp = add(ctx.createGain());
        amp.gain.value = 0.5;
        const lfo2 = osc('sine', 0.085);
        const lfo2G = add(ctx.createGain());
        lfo2G.gain.value = 0.38;
        lfo2.connect(lfo2G);
        lfo2G.connect(amp.gain);
        s.connect(bp);
        bp.connect(amp);
        amp.connect(out);
        out.connect(this.outdoor);
        break;
      }
      case 'pines': {
        // soughing pines: low roar with a needle hiss riding the same gusts
        const s = loopSrc(this.brown);
        const bp = add(this.filter('bandpass', 520, 0.7));
        const lfo = osc('sine', 0.05);
        const lfoG = add(ctx.createGain());
        lfoG.gain.value = 200;
        lfo.connect(lfoG);
        lfoG.connect(bp.frequency);
        const amp = add(ctx.createGain());
        amp.gain.value = 0.55;
        const lfo2 = osc('sine', 0.07);
        const lfo2G = add(ctx.createGain());
        lfo2G.gain.value = 0.35;
        lfo2.connect(lfo2G);
        lfo2G.connect(amp.gain);
        s.connect(bp);
        bp.connect(amp);
        const s2 = loopSrc(this.pink());
        const hp = add(this.filter('highpass', 2800, 0.6));
        const g2 = add(ctx.createGain());
        g2.gain.value = 0.18;
        s2.connect(hp);
        hp.connect(g2);
        g2.connect(amp);
        amp.connect(out);
        out.connect(this.outdoor);
        break;
      }
      case 'stream': {
        // brook: two noise bands, the upper one burbling; plus scheduled trickle plinks
        const s = loopSrc(this.pink());
        const bp = add(this.filter('bandpass', 1300, 0.9));
        s.connect(bp);
        bp.connect(out);
        const s2 = loopSrc(this.white);
        const bp2 = add(this.filter('bandpass', 3200, 1.4));
        const amp = add(ctx.createGain());
        amp.gain.value = 0.08;
        const lfo = osc('sine', 0.33);
        const lfoG = add(ctx.createGain());
        lfoG.gain.value = 0.05;
        lfo.connect(lfoG);
        lfoG.connect(amp.gain);
        s2.connect(bp2);
        bp2.connect(amp);
        amp.connect(out);
        this.streamNext = 0;
        out.connect(this.outdoor);
        break;
      }
      case 'frogs': {
        // two frogs: buzzy pulse trains through a throat band-pass; croaks are scheduled on the gains
        [330, 470].forEach((f) => {
          const o = osc('sawtooth', f + (this.rnd() - 0.5) * 40);
          const bp = add(this.filter('bandpass', f * 2.2, 2.5));
          const g = add(ctx.createGain());
          g.gain.value = 0;
          o.connect(bp);
          bp.connect(g);
          g.connect(out);
          l.params.push(g.gain);
        });
        this.frogNext = [0, 0];
        out.connect(this.outdoor);
        break;
      }
    }
    return l;
  }

  /** Pink noise (for waves/breeze/city), generated on first use only. */
  private pink(): AudioBuffer {
    if (this.pinkBuf) return this.pinkBuf;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.floor(sr * 4), sr);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = this.rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    const xf = Math.min(2000, Math.floor(d.length / 4));
    for (let i = 0; i < xf; i++) {
      const k = i / xf;
      d[i] = d[i] * k + d[d.length - xf + i] * (1 - k);
    }
    this.pinkBuf = buf;
    return buf;
  }

  // ─────────── helpers ───────────

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private noiseSrc(v: Voice, t: number, dur: number, buf: AudioBuffer = this.white, rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    if (rate !== 1) s.playbackRate.value = rate;
    const need = dur * rate;
    if (need > buf.duration * 0.9) {
      // longer than the shared buffer: loop it rather than running out early
      s.loop = true;
      v.src(s, t, t + dur, this.rnd() * buf.duration * 0.5);
    } else {
      v.src(s, t, t + dur, this.rnd() * Math.max(0, buf.duration - need - 0.01));
    }
    return s;
  }

  /** Output chain for a distant outdoor sound: level → (extra distance low-pass) → pan → outdoor. */
  private farOut(v: Voice, pan: number, level: number, lp?: number): GainNode {
    const g = v.add(this.ctx!.createGain());
    g.gain.value = level;
    const p = this.panner(v, pan);
    if (lp) {
      const f = v.add(this.filter('lowpass', lp, 0.5));
      g.connect(f);
      f.connect(p);
    } else {
      g.connect(p);
    }
    p.connect(this.outdoor);
    return g;
  }

  /** Stereo panner if supported, else a pass-through gain. */
  private panner(v: Voice, pan: number): AudioNode & { pan?: AudioParam } {
    const ctx = this.ctx!;
    if (typeof (ctx as AudioContext).createStereoPanner === 'function') {
      const p = v.add((ctx as AudioContext).createStereoPanner());
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    }
    return v.add(ctx.createGain());
  }

  private env(p: AudioParam, t: number, attack: number, peak: number, decay: number) {
    p.setValueAtTime(MIN, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.exponentialRampToValueAtTime(MIN, t + attack + decay);
  }

  private commit(v: Voice, extra?: () => void) {
    if (!v.last) {
      v.nodes.forEach((n) => n.disconnect());
      return;
    }
    this.voices++;
    const nodes = v.nodes;
    v.last.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      extra?.();
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }

  private blip(t: number, freq: number, dur: number, peak: number, type: OscillatorType, dest: AudioNode, glideTo?: number) {
    const ctx = this.ctx!;
    const v = new Voice();
    const o = v.add(ctx.createOscillator());
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.6);
    const g = v.add(ctx.createGain());
    this.env(g.gain, t, 0.005, peak, dur);
    o.connect(g);
    g.connect(dest);
    v.src(o, t, t + dur + 0.02);
    this.commit(v);
  }

  private bell(t: number, freq: number, peak: number, decay: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const v = new Voice();
    const out = v.add(ctx.createGain());
    out.gain.value = peak;
    out.connect(dest);
    const partials: [number, number, number][] = [
      [1, 1, 1],
      [2.0, 0.45, 0.6],
      [2.76, 0.22, 0.4],
      [4.07, 0.1, 0.25],
    ];
    for (const [ratio, amp, dk] of partials) {
      const o = v.add(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      const g = v.add(ctx.createGain());
      this.env(g.gain, t, 0.004, amp, decay * dk);
      o.connect(g);
      g.connect(out);
      v.src(o, t, t + 0.004 + decay * dk + 0.02);
    }
    this.commit(v);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, dest: AudioNode) {
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur + 0.01);
    const f = v.add(this.filter(type, freq, q));
    const g = v.add(this.ctx!.createGain());
    this.env(g.gain, t, 0.002, peak, dur);
    n.connect(f);
    f.connect(g);
    g.connect(dest);
    this.commit(v);
  }

  // ─────────── sound design: UI ───────────

  private playAt(name: Sfx, t: number, opts: PlayOptions) {
    const sfx = this.sfxBus;
    const r = this.rnd;
    switch (name) {
      case 'coin':
        this.blip(t, 987.77, 0.09, 0.18, 'triangle', sfx);
        this.blip(t + 0.075, 1318.5, 0.3, 0.18, 'triangle', sfx);
        this.blip(t + 0.075, 2637, 0.18, 0.04, 'sine', sfx);
        break;
      case 'purchase':
        this.noiseHit(t, 0.05, 'bandpass', 2600, 1.2, 0.14, sfx);
        this.noiseHit(t + 0.05, 0.04, 'bandpass', 3400, 1.2, 0.08, sfx);
        this.bell(t + 0.08, 2093, 0.1, 0.9, sfx);
        this.bell(t + 0.12, 2637, 0.07, 0.9, sfx);
        [3136, 3951, 4186, 5274].forEach((f, i) => this.blip(t + 0.18 + i * 0.045, f, 0.12, 0.035, 'sine', sfx));
        break;
      case 'achievement': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
          const last = i === notes.length - 1;
          this.blip(t + i * 0.085, f, last ? 0.8 : 0.22, 0.15, 'triangle', sfx);
        });
        this.bell(t + 0.255, 1046.5, 0.08, 1.4, sfx);
        this.blip(t + 0.255, 1318.5, 0.7, 0.05, 'sine', sfx);
        break;
      }
      case 'chime':
        this.bell(t, 1046.5, 0.15, 2.4, sfx);
        this.bell(t + 0.3, 783.99, 0.13, 2.8, sfx);
        break;
      case 'start':
        this.noiseHit(t, 0.012, 'bandpass', 3500, 2, 0.06, sfx);
        this.blip(t, 659.25, 0.14, 0.12, 'sine', sfx);
        this.blip(t + 0.07, 987.77, 0.25, 0.12, 'sine', sfx);
        break;
      case 'pause':
        this.noiseHit(t, 0.012, 'bandpass', 3000, 2, 0.06, sfx);
        this.blip(t, 880, 0.14, 0.11, 'sine', sfx);
        this.blip(t + 0.08, 659.25, 0.25, 0.11, 'sine', sfx);
        break;
      case 'end':
        [783.99, 659.25, 523.25].forEach((f, i) => this.blip(t + i * 0.12, f, i === 2 ? 0.7 : 0.2, 0.12, 'triangle', sfx));
        this.bell(t + 0.24, 1046.5, 0.05, 1.2, sfx);
        break;
      case 'click':
        this.noiseHit(t, 0.012, 'bandpass', 4000, 2, 0.1, sfx);
        this.blip(t, 2200, 0.02, 0.035, 'sine', sfx);
        break;
      case 'checkin':
        this.bell(t, 1318.5, 0.11, 1.0, sfx);
        this.bell(t + 0.22, 1318.5, 0.09, 1.3, sfx);
        break;
      case 'thunder':
        this.thunder(t);
        break;
      case 'car':
        this.car(t, opts.dir ?? (r() < 0.5 ? 1 : -1), CAR_EVENT);
        break;
      case 'meow':
        this.meow(t, 0.75);
        break;
      case 'bark':
        this.bark(t, false, 0.6);
        break;
      // world events (ambience switch)
      case 'balloon':
        this.balloon(t);
        break;
      case 'fireworks':
        this.fireworks(t);
        break;
      case 'train':
        this.train(t, 1);
        break;
      case 'gull':
        this.gull(t, 1.3);
        break;
      case 'owl':
        this.owl(t);
        break;
      case 'chirp':
        this.chirp(t);
        break;
      case 'whoosh':
        this.whoosh(t, opts.dir ?? (r() < 0.5 ? 1 : -1));
        break;
      case 'horn':
        this.shipHorn(t);
        break;
      // interactions (sfx switch)
      case 'sparkle':
        this.sparkle(t);
        break;
      case 'purr':
        this.purr(t, sfx, 2, 0.95);
        break;
      case 'boop':
        this.boop(t);
        break;
      case 'hey':
        this.hey(t);
        break;
      case 'sip':
        this.sip(t);
        break;
      case 'rustle':
        this.rustle(t, sfx, 1.6);
        break;
      case 'tick':
        this.clockTick(t);
        break;
      case 'pop':
        this.blip(t, 480 + r() * 120, 0.06, 0.16, 'sine', sfx, 1500);
        this.noiseHit(t, 0.008, 'bandpass', 2500, 1.5, 0.05, sfx);
        break;
      case 'paper':
        this.paper(t);
        break;
      case 'quest':
        this.quest(t);
        break;
      case 'level':
        this.levelUp(t);
        break;
    }
  }

  // ─────────── sound design: ambience ───────────

  private keyClick(t: number, space: boolean) {
    if (this.voices > MAX_VOICES) return;
    const r = this.rnd;
    const v = new Voice();
    const release = 0.045 + r() * 0.05;
    const n = this.noiseSrc(v, t, release + 0.03);
    const bp = v.add(this.filter('bandpass', space ? 800 + r() * 200 : 2000 + r() * 1800, space ? 1.1 : 1.6 + r()));
    const g = v.add(this.ctx!.createGain());
    const peak = space ? 0.24 : 0.1 + r() * 0.1;
    // key down click …
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(MIN, t + (space ? 0.04 : 0.022));
    // … and quieter key-up click
    g.gain.setValueAtTime(MIN, t + release);
    g.gain.linearRampToValueAtTime(peak * 0.35, t + release + 0.002);
    g.gain.exponentialRampToValueAtTime(MIN, t + release + 0.018);
    const p = this.panner(v, 0.15 + (r() - 0.5) * 0.25);
    n.connect(bp);
    bp.connect(g);
    g.connect(p);
    p.connect(this.indoor);
    if (space) {
      const o = v.add(this.ctx!.createOscillator());
      o.type = 'sine';
      o.frequency.setValueAtTime(170, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.05);
      const og = v.add(this.ctx!.createGain());
      this.env(og.gain, t, 0.002, 0.12, 0.06);
      o.connect(og);
      og.connect(p);
      v.src(o, t, t + 0.08);
    }
    this.commit(v);
  }

  private drop(t: number, level: number) {
    if (this.voices > MAX_VOICES * 0.7) return;
    const r = this.rnd;
    const v = new Voice();
    const p = this.panner(v, r() * 2 - 1);
    const g = v.add(this.ctx!.createGain());
    g.connect(p);
    p.connect(this.outdoor);
    if (r() < 0.25) {
      // window drip "plink"
      const o = v.add(this.ctx!.createOscillator());
      const f = 1200 + r() * 1400;
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.03);
      this.env(g.gain, t, 0.002, 0.014 + 0.014 * level * r(), 0.04);
      o.connect(g);
      v.src(o, t, t + 0.06);
    } else {
      const n = this.noiseSrc(v, t, 0.025);
      const bp = v.add(this.filter('bandpass', 1800 + r() * 4000, 3 + r() * 3));
      this.env(g.gain, t, 0.001, 0.025 + 0.035 * level * r(), 0.02);
      n.connect(bp);
      bp.connect(g);
    }
    this.commit(v);
  }

  private bubble(t: number) {
    if (this.voices > MAX_VOICES * 0.8) return;
    const r = this.rnd;
    const f = 350 + r() * 450;
    const v = new Voice();
    const o = v.add(this.ctx!.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.8 + r() * 0.8), t + 0.05);
    const g = v.add(this.ctx!.createGain());
    this.env(g.gain, t, 0.004, 0.025 + r() * 0.025, 0.05);
    const p = this.panner(v, -0.45 + (r() - 0.5) * 0.1);
    o.connect(g);
    g.connect(p);
    p.connect(this.indoor);
    v.src(o, t, t + 0.07);
    this.commit(v);
  }

  private thunder(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const p = this.panner(v, (r() - 0.5) * 0.8);
    p.connect(this.outdoor);
    // crack
    const n = this.noiseSrc(v, t, 0.9);
    const lp = v.add(this.filter('lowpass', 7000, 0.5));
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.7);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.15);
    g.gain.linearRampToValueAtTime(0.14, t + 0.22); // second crackle
    g.gain.exponentialRampToValueAtTime(MIN, t + 0.85);
    n.connect(lp);
    lp.connect(g);
    g.connect(p);
    this.commit(v);
    this.rumble(t + 0.1, 0.3, 7);
  }

  private rumble(t: number, peak: number, dur = 4 + this.rnd() * 3) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur + 0.1, this.brown);
    const lp = v.add(this.filter('lowpass', 160, 0.7));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.4 + r() * 0.4);
    let tt = t + 0.9;
    while (tt < t + dur * 0.7) {
      g.gain.linearRampToValueAtTime(peak * (0.35 + r() * 0.65), tt);
      tt += 0.3 + r() * 0.6;
    }
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    const p = this.panner(v, (r() - 0.5) * 1.2);
    n.connect(lp);
    lp.connect(g);
    g.connect(p);
    p.connect(this.outdoor);
    this.commit(v);
  }

  private car(t: number, dir: 1 | -1, level: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 3.5 + r() * 2;
    const mid = t + dur / 2;
    const v = new Voice();
    const p = this.panner(v, -0.9 * dir);
    if (p.pan) {
      p.pan.setValueAtTime(-0.9 * dir, t);
      p.pan.linearRampToValueAtTime(0.9 * dir, t + dur);
    }
    const out = v.add(ctx.createGain());
    out.gain.setValueAtTime(MIN, t);
    out.gain.exponentialRampToValueAtTime(0.35 * level, mid);
    out.gain.exponentialRampToValueAtTime(MIN, t + dur);
    out.connect(p);
    p.connect(this.outdoor);
    // tyre roar
    const n = this.noiseSrc(v, t, dur + 0.05, this.brown);
    const bp = v.add(this.filter('bandpass', 300, 0.6));
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(850, mid);
    bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    n.connect(bp);
    bp.connect(out);
    // engine with doppler drop
    const o = v.add(ctx.createOscillator());
    o.type = 'sawtooth';
    const f = 50 + r() * 25;
    o.frequency.setValueAtTime(f * 1.08, t);
    o.frequency.linearRampToValueAtTime(f * 1.12, mid - 0.1);
    o.frequency.linearRampToValueAtTime(f * 0.9, mid + 0.4);
    o.frequency.linearRampToValueAtTime(f * 0.86, t + dur);
    const olp = v.add(this.filter('lowpass', 320, 0.8));
    const og = v.add(ctx.createGain());
    og.gain.value = 0.35;
    o.connect(olp);
    olp.connect(og);
    og.connect(out);
    v.src(o, t, t + dur + 0.05);
    this.commit(v);
  }

  private birds(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const p = this.panner(v, r() * 1.6 - 0.8);
    const out = v.add(ctx.createGain());
    out.gain.value = 0.095;
    out.connect(p);
    p.connect(this.outdoor);
    const species = Math.floor(r() * 3);
    const phrases = 2 + Math.floor(r() * 3);
    let tt = t;
    for (let ph = 0; ph < phrases; ph++) {
      const chirps = species === 2 ? 6 + Math.floor(r() * 6) : 2 + Math.floor(r() * 4);
      const base = 2600 + r() * 1600;
      for (let c = 0; c < chirps; c++) {
        const o = v.add(ctx.createOscillator());
        o.type = 'sine';
        const g = v.add(ctx.createGain());
        let len: number;
        if (species === 0) {
          // up-sweeping "tweet"
          len = 0.07 + r() * 0.05;
          o.frequency.setValueAtTime(base * 0.8, tt);
          o.frequency.exponentialRampToValueAtTime(base * 1.3, tt + len);
        } else if (species === 1) {
          // down "tsee-oo"
          len = 0.12 + r() * 0.08;
          o.frequency.setValueAtTime(base * 1.25, tt);
          o.frequency.exponentialRampToValueAtTime(base * 0.75, tt + len);
        } else {
          // fast trill
          len = 0.035;
          o.frequency.setValueAtTime(base * (c % 2 ? 1.1 : 0.95), tt);
          o.frequency.exponentialRampToValueAtTime(base * (c % 2 ? 0.95 : 1.1), tt + len);
        }
        this.env(g.gain, tt, 0.008, 0.5 + r() * 0.5, len);
        o.connect(g);
        g.connect(out);
        v.src(o, tt, tt + len + 0.03);
        tt += len + (species === 2 ? 0.02 : 0.05 + r() * 0.08);
      }
      tt += 0.4 + r() * 1.0;
    }
    this.commit(v);
  }

  private owl(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const f = 340 + r() * 60;
    const o = v.add(ctx.createOscillator());
    o.type = 'sine';
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    const pattern = r() < 0.5 ? [0, 0.9, 1.22] : [0, 0.55, 0.85, 1.45];
    o.frequency.setValueAtTime(f, t);
    pattern.forEach((dt, i) => {
      const ht = t + dt;
      const len = i === pattern.length - 1 ? 0.5 : 0.28;
      o.frequency.setValueAtTime(f * 1.04, ht);
      o.frequency.exponentialRampToValueAtTime(f * 0.95, ht + len);
      g.gain.setValueAtTime(MIN, ht);
      g.gain.linearRampToValueAtTime(0.11, ht + 0.07);
      g.gain.exponentialRampToValueAtTime(MIN, ht + len);
    });
    const lp = v.add(this.filter('lowpass', 900, 0.7));
    const p = this.panner(v, r() * 1.4 - 0.7);
    o.connect(lp);
    lp.connect(g);
    g.connect(p);
    p.connect(this.outdoor);
    v.src(o, t, t + pattern[pattern.length - 1] + 0.6);
    this.commit(v);
  }

  private windGust(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 4 + r() * 3;
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur + 0.1, this.brown);
    const bp = v.add(this.filter('bandpass', 250, 0.9));
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(700 + r() * 300, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    const start = r() * 1.2 - 0.6;
    const p = this.panner(v, start);
    if (p.pan) p.pan.linearRampToValueAtTime(-start, t + dur);
    n.connect(bp);
    bp.connect(g);
    g.connect(p);
    p.connect(this.outdoor);
    this.commit(v);
  }

  private bark(t: number, distant: boolean, level = 1) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const count = 1 + Math.floor(r() * 3);
    const f0 = (distant ? 230 : 260) + r() * 60;
    const out = v.add(ctx.createGain());
    out.gain.value = (distant ? 0.12 : 0.3) * level;
    const p = this.panner(v, distant ? r() * 1.6 - 0.8 : 0.35);
    out.connect(p);
    p.connect(distant ? this.outdoor : this.indoor);
    const lp = v.add(this.filter('lowpass', distant ? 650 : 1200, 1.5));
    lp.connect(out);
    for (let i = 0; i < count; i++) {
      const bt = t + i * (0.24 + r() * 0.12);
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.8, bt);
      o.frequency.linearRampToValueAtTime(f0, bt + 0.03);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.55, bt + 0.16);
      const g = v.add(ctx.createGain());
      this.env(g.gain, bt, 0.012, 0.8, 0.16);
      o.connect(g);
      g.connect(lp);
      v.src(o, bt, bt + 0.2);
      const n = this.noiseSrc(v, bt, 0.1);
      const bp = v.add(this.filter('bandpass', 700, 1));
      const ng = v.add(ctx.createGain());
      this.env(ng.gain, bt, 0.005, 0.25, 0.08);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(lp);
    }
    this.commit(v);
  }

  private pant(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const breaths = 8 + Math.floor(r() * 8);
    const period = 0.17 + r() * 0.04;
    const dur = breaths * period + 0.1;
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur);
    const bp = v.add(this.filter('bandpass', 1300, 1.6));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    for (let i = 0; i < breaths; i++) {
      const bt = t + i * period;
      bp.frequency.setValueAtTime(i % 2 ? 1100 : 1500, bt);
      g.gain.linearRampToValueAtTime(i % 2 ? 0.06 : 0.09, bt + period * 0.35);
      g.gain.linearRampToValueAtTime(0.005, bt + period * 0.95);
    }
    g.gain.linearRampToValueAtTime(MIN, t + dur);
    const p = this.panner(v, 0.35);
    n.connect(bp);
    bp.connect(g);
    g.connect(p);
    p.connect(this.indoor);
    this.commit(v);
  }

  private meow(t: number, level: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 0.5 + r() * 0.4;
    const f0 = 480 + r() * 160;
    const v = new Voice();
    const o = v.add(ctx.createOscillator());
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.8, t);
    o.frequency.linearRampToValueAtTime(f0 * 1.25, t + dur * 0.35);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    // formants: "m-ee-ow"
    const f1 = v.add(this.filter('bandpass', 600, 5));
    f1.frequency.setValueAtTime(500, t);
    f1.frequency.linearRampToValueAtTime(1300, t + dur * 0.35);
    f1.frequency.linearRampToValueAtTime(700, t + dur);
    const f2 = v.add(this.filter('bandpass', 2400, 7));
    f2.frequency.setValueAtTime(2000, t);
    f2.frequency.linearRampToValueAtTime(2800, t + dur * 0.35);
    f2.frequency.linearRampToValueAtTime(1600, t + dur);
    const g2 = v.add(ctx.createGain());
    g2.gain.value = 0.5;
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.5 * level, t + 0.07);
    g.gain.linearRampToValueAtTime(0.4 * level, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    o.connect(f1);
    o.connect(f2);
    f1.connect(g);
    f2.connect(g2);
    g2.connect(g);
    const p = this.panner(v, -0.3);
    g.connect(p);
    p.connect(this.indoor);
    v.src(o, t, t + dur + 0.02);
    this.commit(v);
  }

  private purr(t: number, dest: AudioNode = this.indoor, nBreaths?: number, breathPeriod?: number, level = 1) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const breaths = nBreaths ?? 4 + Math.floor(r() * 4);
    const period = breathPeriod ?? 1.3 + r() * 0.3;
    const dur = breaths * period + 0.2;
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur, this.brown);
    const lp = v.add(this.filter('lowpass', 380, 0.9));
    const am = v.add(ctx.createGain());
    am.gain.value = 0.5;
    const lfo = v.add(ctx.createOscillator());
    lfo.frequency.value = 23 + r() * 5;
    const depth = v.add(ctx.createGain());
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(am.gain);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    for (let i = 0; i < breaths; i++) {
      const bt = t + i * period;
      g.gain.linearRampToValueAtTime(0.32 * level, bt + period * 0.25); // in
      g.gain.linearRampToValueAtTime(0.12 * level, bt + period * 0.5);
      g.gain.linearRampToValueAtTime(0.42 * level, bt + period * 0.72); // out
      g.gain.linearRampToValueAtTime(0.06 * level, bt + period);
    }
    g.gain.linearRampToValueAtTime(MIN, t + dur);
    const p = this.panner(v, -0.3);
    n.connect(lp);
    lp.connect(am);
    am.connect(g);
    g.connect(p);
    p.connect(dest);
    v.src(lfo, t, t + dur);
    this.commit(v);
  }

  private rustle(t: number, dest: AudioNode = this.indoor, level = 1) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const n = this.noiseSrc(v, t, 0.8);
    const hp = v.add(this.filter('highpass', 3000, 0.7));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    const bursts = 3 + Math.floor(r() * 4);
    let tt = t + 0.01;
    for (let i = 0; i < bursts && tt < t + 0.75; i++) {
      g.gain.setValueAtTime(MIN, tt);
      g.gain.linearRampToValueAtTime((0.04 + r() * 0.04) * level, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(MIN, tt + 0.02 + r() * 0.03);
      tt += 0.06 + r() * 0.12;
    }
    const p = this.panner(v, 0.5);
    n.connect(hp);
    hp.connect(g);
    g.connect(p);
    p.connect(dest);
    this.commit(v);
  }

  private mug(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    // thud of the mug touching the desk
    const v = new Voice();
    const o = v.add(ctx.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(75, t + 0.08);
    const g = v.add(ctx.createGain());
    this.env(g.gain, t, 0.003, 0.14, 0.12);
    o.connect(g);
    g.connect(this.indoor);
    v.src(o, t, t + 0.15);
    this.commit(v);
    // ceramic clink (inharmonic partials)
    const k = 0.9 + r() * 0.2;
    const ct = t + 0.015;
    [
      [2100, 0.035, 0.35],
      [3350, 0.025, 0.25],
      [5150, 0.012, 0.15],
    ].forEach(([f, a, d]) => this.blip(ct, f * k, d, a, 'sine', this.indoor));
  }

  private page(t: number, dest: AudioNode = this.indoor, level = 1) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 0.6 + r() * 0.3;
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur);
    const bp = v.add(this.filter('bandpass', 1500, 0.7));
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(4500, t + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(2200, t + dur);
    const hp = v.add(this.filter('highpass', 700, 0.7));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.1 * level, t + 0.06);
    g.gain.linearRampToValueAtTime(0.04 * level, t + 0.14);
    g.gain.linearRampToValueAtTime(0.18 * level, t + dur * 0.45); // the flip
    g.gain.linearRampToValueAtTime(0.05 * level, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.08 * level, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    const p = this.panner(v, 0.1);
    n.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(p);
    p.connect(dest);
    this.commit(v);
  }

  private clock(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const ticks = 6 + Math.floor(r() * 6);
    const dur = ticks * 0.5 + 0.1;
    const v = new Voice();
    const n = this.noiseSrc(v, t, dur);
    const bp = v.add(this.filter('bandpass', 3000, 7));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    for (let i = 0; i < ticks; i++) {
      const tt = t + i * 0.5;
      bp.frequency.setValueAtTime(i % 2 ? 2300 : 3400, tt);
      g.gain.setValueAtTime(MIN, tt);
      g.gain.linearRampToValueAtTime(0.16, tt + 0.002);
      g.gain.exponentialRampToValueAtTime(MIN, tt + 0.03);
    }
    const p = this.panner(v, -0.6);
    n.connect(bp);
    bp.connect(g);
    g.connect(p);
    p.connect(this.indoor);
    this.commit(v);
  }
  // ─────────── sound design: per-view outdoor ambience ───────────

  /** Brook trickle: tiny bubbly plinks into the stream bed (scales with its level). */
  private trickle(t: number, dest: AudioNode) {
    if (this.voices > DECOR_VOICES) return;
    const r = this.rnd;
    const f = 700 + r() * 1100;
    const v = new Voice();
    const o = v.add(this.ctx!.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.4 + r() * 0.6), t + 0.04);
    const g = v.add(this.ctx!.createGain());
    this.env(g.gain, t, 0.003, 0.12 + r() * 0.18, 0.045);
    const p = this.panner(v, (r() - 0.5) * 1.2);
    o.connect(g);
    g.connect(p);
    p.connect(dest);
    v.src(o, t, t + 0.06);
    this.commit(v);
  }

  /** Herring-gull calls far over the water: a long "kyow" then shorter ones, falling. */
  private gull(t: number, level = 1) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.6 - 0.8, 0.09 * level, 2800);
    const bp = v.add(this.filter('bandpass', 1700, 1.6));
    bp.connect(out);
    const calls = 2 + Math.floor(r() * 4);
    const f0 = 1050 + r() * 300;
    let tt = t;
    for (let c = 0; c < calls; c++) {
      const len = c === 0 ? 0.3 + r() * 0.1 : 0.14 + r() * 0.08;
      const f = f0 * (1 - c * 0.03);
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.1, tt);
      o.frequency.linearRampToValueAtTime(f * 1.22, tt + len * 0.25);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, tt + len);
      const g = v.add(ctx.createGain());
      const pk = (c === 0 ? 1 : 0.75) * (0.7 + r() * 0.3);
      g.gain.setValueAtTime(MIN, tt);
      g.gain.linearRampToValueAtTime(pk, tt + 0.02);
      g.gain.linearRampToValueAtTime(pk * 0.6, tt + len * 0.7);
      g.gain.exponentialRampToValueAtTime(MIN, tt + len);
      o.connect(g);
      g.connect(bp);
      v.src(o, tt, tt + len + 0.02);
      tt += len + 0.07 + r() * 0.12;
    }
    this.commit(v);
  }

  /** Lighthouse diaphone far away: one long low note with the end "grunt", and a faint echo. */
  private foghorn(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const f = 78 + r() * 12;
    const pan = r() * 1.2 - 0.6;
    for (let k = 0; k < 2; k++) {
      const v = new Voice();
      const st = t + k * 1.15;
      const dur = 2.4 + r() * 0.6;
      const out = this.farOut(v, k ? -pan * 0.5 : pan, k ? 0.018 : 0.05, k ? 260 : 380);
      const g = v.add(ctx.createGain());
      g.gain.setValueAtTime(MIN, st);
      g.gain.linearRampToValueAtTime(1, st + 0.45);
      g.gain.setValueAtTime(1, st + dur - 0.4);
      g.gain.exponentialRampToValueAtTime(MIN, st + dur + 1.2);
      g.connect(out);
      for (const [type, m, a] of [['sawtooth', 1, 1], ['square', 1.004, 0.4]] as const) {
        const o = v.add(ctx.createOscillator());
        o.type = type;
        o.frequency.setValueAtTime(f * m, st);
        o.frequency.setValueAtTime(f * m, st + dur - 0.4);
        o.frequency.exponentialRampToValueAtTime(f * m * 0.84, st + dur);
        const og = v.add(ctx.createGain());
        og.gain.value = a;
        o.connect(og);
        og.connect(g);
        v.src(o, st, st + dur + 1.25);
      }
      this.commit(v);
    }
  }

  /** Distant ship: two soft blasts of a low open fifth. */
  private shipHorn(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const f = 96 + r() * 12;
    const out = this.farOut(v, r() * 1.2 - 0.6, 0.045, 650);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    const blasts: [number, number][] = [[0, 0.9], [1.5, 1.8]];
    for (const [s0, len] of blasts) {
      g.gain.setValueAtTime(MIN, t + s0);
      g.gain.linearRampToValueAtTime(1, t + s0 + 0.18);
      g.gain.setValueAtTime(1, t + s0 + len);
      g.gain.exponentialRampToValueAtTime(MIN, t + s0 + len + 0.5);
    }
    g.connect(out);
    const end = t + 1.5 + 1.8 + 0.55;
    for (const [m, a] of [[1, 1], [1.5, 0.55], [2.01, 0.25]] as const) {
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = f * m;
      const og = v.add(ctx.createGain());
      og.gain.value = a;
      o.connect(og);
      og.connect(g);
      v.src(o, t, end);
    }
    this.commit(v);
  }

  /** Halyards tapping masts in the marina: small inharmonic clinks. */
  private rigging(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.4 - 0.7, 0.05);
    const clinks = 2 + Math.floor(r() * 4);
    const base = 2100 + r() * 900;
    let tt = t;
    for (let i = 0; i < clinks; i++) {
      const k = 0.94 + r() * 0.12;
      const pk = 0.5 + r() * 0.5;
      for (const [m, a, d] of [[1, 1, 0.25], [2.32, 0.5, 0.15], [3.9, 0.25, 0.08]] as const) {
        const o = v.add(ctx.createOscillator());
        o.type = 'sine';
        o.frequency.value = base * k * m;
        const g = v.add(ctx.createGain());
        this.env(g.gain, tt, 0.002, a * pk, d);
        o.connect(g);
        g.connect(out);
        v.src(o, tt, tt + d + 0.02);
      }
      tt += r() < 0.3 ? 0.08 + r() * 0.06 : 0.3 + r() * 0.7; // sometimes a quick double clink
    }
    this.commit(v);
  }

  /** A train crossing the far side of town: rolling rumble with rail-joint "da-dum"s. */
  private train(t: number, level: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 9 + r() * 4;
    const dir = r() < 0.5 ? 1 : -1;
    const v = new Voice();
    const p = this.panner(v, -0.7 * dir);
    if (p.pan) {
      p.pan.setValueAtTime(-0.7 * dir, t);
      p.pan.linearRampToValueAtTime(0.7 * dir, t + dur);
    }
    const far = v.add(this.filter('lowpass', 1500, 0.5));
    far.connect(p);
    p.connect(this.outdoor);
    const out = v.add(ctx.createGain());
    out.gain.setValueAtTime(MIN, t);
    out.gain.exponentialRampToValueAtTime(0.1 * level, t + dur * 0.45);
    out.gain.setValueAtTime(0.1 * level, t + dur * 0.55);
    out.gain.exponentialRampToValueAtTime(MIN, t + dur);
    out.connect(far);
    const n = this.noiseSrc(v, t, dur + 0.05, this.brown);
    const lp = v.add(this.filter('lowpass', 380, 0.6));
    n.connect(lp);
    lp.connect(out);
    const n2 = this.noiseSrc(v, t, dur + 0.05);
    const bp = v.add(this.filter('bandpass', 1000 + r() * 300, 1.3));
    const cg = v.add(ctx.createGain());
    cg.gain.setValueAtTime(0, t);
    const period = 0.62 + r() * 0.2;
    for (let ct = t + 0.1; ct < t + dur - 0.3; ct += period) {
      for (const [dt, a] of [[0, 0.9], [0.12, 0.75]] as const) {
        const x = ct + dt;
        cg.gain.setValueAtTime(0, x);
        cg.gain.linearRampToValueAtTime(a, x + 0.004);
        cg.gain.linearRampToValueAtTime(0, x + 0.05);
      }
    }
    n2.connect(bp);
    bp.connect(cg);
    cg.connect(out);
    this.commit(v);
  }

  /** A siren many blocks away: slow wail, swelling in and fading, drifting flat as it passes. */
  private siren(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 7 + r() * 3;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.4 - 0.7, 0.028, 1600);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.exponentialRampToValueAtTime(1, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    g.connect(out);
    const o = v.add(ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.value = 760 + r() * 60;
    o.detune.setValueAtTime(40, t);
    o.detune.linearRampToValueAtTime(-60, t + dur);
    const lfo = v.add(ctx.createOscillator());
    lfo.frequency.value = 0.32 + r() * 0.08;
    const depth = v.add(ctx.createGain());
    depth.gain.value = 170;
    lfo.connect(depth);
    depth.connect(o.frequency);
    o.connect(g);
    v.src(o, t, t + dur + 0.02);
    v.src(lfo, t, t + dur + 0.02);
    this.commit(v);
  }

  /** Pigeon on a ledge: "croo – COO – oo" with a little burble. */
  private pigeon(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = this.farOut(v, 0.3 + r() * 0.5, 0.13, 900);
    const f = 300 + r() * 50;
    const o = v.add(ctx.createOscillator());
    o.type = 'triangle';
    const am = v.add(ctx.createGain());
    am.gain.value = 0.7;
    const lfo = v.add(ctx.createOscillator());
    lfo.frequency.value = 22 + r() * 6;
    const depth = v.add(ctx.createGain());
    depth.gain.setValueAtTime(0.3, t);
    depth.gain.linearRampToValueAtTime(0.05, t + 0.5);
    lfo.connect(depth);
    depth.connect(am.gain);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    const segs: [start: number, len: number, from: number, to: number, pk: number][] = [
      [0, 0.24, 0.88, 1.0, 0.7],
      [0.32, 0.5, 1.06, 0.94, 1],
      [0.92, 0.28, 0.9, 0.84, 0.6],
    ];
    for (const [s0, len, a, b, pk] of segs) {
      const st = t + s0;
      o.frequency.setValueAtTime(f * a, st);
      o.frequency.exponentialRampToValueAtTime(f * b, st + len);
      g.gain.setValueAtTime(MIN, st);
      g.gain.linearRampToValueAtTime(pk, st + 0.06);
      g.gain.exponentialRampToValueAtTime(MIN, st + len);
    }
    o.connect(am);
    am.connect(g);
    g.connect(out);
    v.src(o, t, t + 1.25);
    v.src(lfo, t, t + 1.25);
    this.commit(v);
  }

  /** Sheep across the fields: one or two quavering "baa"s (sometimes a lamb). */
  private sheep(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const lamb = r() < 0.3;
    const bleats = r() < 0.4 ? 2 : 1;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.6 - 0.8, 0.13, 2400);
    const f1 = v.add(this.filter('bandpass', 750, 3));
    const f2 = v.add(this.filter('bandpass', 1900, 5));
    const g2 = v.add(ctx.createGain());
    g2.gain.value = 0.5;
    f1.connect(out);
    f2.connect(g2);
    g2.connect(out);
    for (let b = 0; b < bleats; b++) {
      const st = t + b * (1.1 + r() * 0.5);
      const dur = 0.7 + r() * 0.35;
      const f = (lamb ? 420 : 270) + r() * 60;
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, st);
      o.frequency.linearRampToValueAtTime(f * 1.06, st + 0.15);
      o.frequency.linearRampToValueAtTime(f * 0.9, st + dur);
      const lfo = v.add(ctx.createOscillator());
      lfo.frequency.value = 13 + r() * 5;
      const vib = v.add(ctx.createGain());
      vib.gain.value = f * 0.035;
      lfo.connect(vib);
      vib.connect(o.frequency);
      const am = v.add(ctx.createGain());
      am.gain.value = 0.75;
      const trem = v.add(ctx.createGain());
      trem.gain.value = 0.25;
      lfo.connect(trem);
      trem.connect(am.gain);
      const g = v.add(ctx.createGain());
      g.gain.setValueAtTime(MIN, st);
      g.gain.linearRampToValueAtTime(1, st + 0.06);
      g.gain.linearRampToValueAtTime(0.7, st + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(MIN, st + dur);
      o.connect(am);
      am.connect(g);
      g.connect(f1);
      g.connect(f2);
      v.src(o, st, st + dur + 0.02);
      v.src(lfo, st, st + dur + 0.02);
    }
    this.commit(v);
  }

  /** A cow in a far field: "mmm-OOOO", the mouth opening as the pitch rises and falls. */
  private cow(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const dur = 1.5 + r() * 0.7;
    const f = 105 + r() * 30;
    const out = this.farOut(v, r() * 1.6 - 0.8, 0.13, 1300);
    const o = v.add(ctx.createOscillator());
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.88, t);
    o.frequency.linearRampToValueAtTime(f * 1.08, t + dur * 0.4);
    o.frequency.linearRampToValueAtTime(f * 0.82, t + dur);
    const bp = v.add(this.filter('bandpass', 260, 2.2));
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.linearRampToValueAtTime(620, t + dur * 0.45);
    bp.frequency.linearRampToValueAtTime(420, t + dur);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.25);
    g.gain.linearRampToValueAtTime(1, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    o.connect(bp);
    bp.connect(g);
    g.connect(out);
    v.src(o, t, t + dur + 0.02);
    this.commit(v);
  }

  /** Rooster at dawn, a farm or two away: cock-a-doodle-doooo. */
  private rooster(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.4 - 0.7, 0.085, 2600);
    const k = 0.9 + r() * 0.2;
    const f1 = v.add(this.filter('bandpass', 1400, 1.5));
    const f2 = v.add(this.filter('bandpass', 2900, 3));
    const g2 = v.add(ctx.createGain());
    g2.gain.value = 0.4;
    f1.connect(out);
    f2.connect(g2);
    g2.connect(out);
    const segs: [len: number, from: number, to: number][] = [
      [0.12, 600, 760],
      [0.11, 780, 740],
      [0.13, 800, 880],
      [0.8, 940, 640],
    ];
    const o = v.add(ctx.createOscillator());
    o.type = 'sawtooth';
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    let tt = t;
    for (const [len, a, b] of segs) {
      const long = len > 0.5;
      o.frequency.setValueAtTime(a * k, tt);
      o.frequency.exponentialRampToValueAtTime(b * k, tt + len * 0.9);
      g.gain.setValueAtTime(MIN, tt);
      g.gain.linearRampToValueAtTime(long ? 0.9 : 0.7, tt + 0.025);
      if (long) g.gain.linearRampToValueAtTime(0.7, tt + len * 0.75);
      g.gain.exponentialRampToValueAtTime(MIN, tt + len);
      tt += len + 0.035;
    }
    o.connect(g);
    g.connect(f1);
    g.connect(f2);
    v.src(o, t, tt + 0.02);
    this.commit(v);
  }

  /** A tractor working a far field: low diesel putt-putt drifting in and out. */
  private tractor(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 10 + r() * 5;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.2 - 0.6, 1, 340);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + dur * 0.35);
    g.gain.setValueAtTime(0.07, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    g.connect(out);
    const f = 36 + r() * 10;
    const o = v.add(ctx.createOscillator());
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (0.9 + r() * 0.2), t + dur);
    const am = v.add(ctx.createGain());
    am.gain.value = 0.6;
    const lfo = v.add(ctx.createOscillator());
    lfo.type = 'square';
    lfo.frequency.value = f / 4;
    const depth = v.add(ctx.createGain());
    depth.gain.value = 0.4;
    lfo.connect(depth);
    depth.connect(am.gain);
    o.connect(am);
    am.connect(g);
    v.src(o, t, t + dur + 0.02);
    v.src(lfo, t, t + dur + 0.02);
    this.commit(v);
  }

  /** Forest songbird: a song thrush's repeated motifs or a warbler's tumbling run. */
  private songbird(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.6 - 0.8, 0.1);
    const note = (st: number, len: number, f0: number, f1: number, pk: number) => {
      const o = v.add(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, st);
      o.frequency.exponentialRampToValueAtTime(f1, st + len);
      const g = v.add(ctx.createGain());
      this.env(g.gain, st, Math.min(0.012, len * 0.3), pk, len);
      o.connect(g);
      g.connect(out);
      v.src(o, st, st + len + 0.03);
    };
    let tt = t;
    if (r() < 0.55) {
      const motifs = 2 + Math.floor(r() * 2);
      for (let m = 0; m < motifs; m++) {
        const notes = 2 + Math.floor(r() * 3);
        const motif = Array.from({ length: notes }, () => {
          const f = 1800 + r() * 2400;
          return { len: 0.05 + r() * 0.09, f0: f, f1: f * (0.75 + r() * 0.6) };
        });
        const reps = 2 + (r() < 0.4 ? 1 : 0);
        for (let k = 0; k < reps; k++) {
          for (const n of motif) {
            note(tt, n.len, n.f0, n.f1, 0.6 + r() * 0.4);
            tt += n.len + 0.035;
          }
          tt += 0.09 + r() * 0.05;
        }
        tt += 0.35 + r() * 0.5;
      }
    } else {
      const n = 9 + Math.floor(r() * 8);
      let f = 4200 + r() * 1200;
      for (let i = 0; i < n; i++) {
        const len = 0.03 + r() * 0.03;
        note(tt, len, f * 1.08, f * 0.9, 0.5 + r() * 0.5);
        tt += len + 0.018;
        f *= 0.96 + r() * 0.05;
      }
    }
    this.commit(v);
  }

  /** Woodpecker drumming on a trunk somewhere in the trees. */
  private woodpecker(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const taps: [time: number, amp: number][] = [];
    let tt = t;
    const drums = r() < 0.5 ? 2 : 1;
    for (let d = 0; d < drums; d++) {
      const n = 14 + Math.floor(r() * 8);
      let gap = 0.045;
      for (let i = 0; i < n; i++) {
        taps.push([tt, 1 - (i / n) * 0.6]);
        tt += gap;
        gap *= 1.025;
      }
      tt += 1.4 + r() * 0.6;
    }
    const end = taps[taps.length - 1][0] + 0.05;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.6 - 0.8, 0.32, 3000);
    const n = this.noiseSrc(v, t, end - t);
    const bp = v.add(this.filter('bandpass', 900 + r() * 500, 4));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(0, t);
    for (const [x, a] of taps) {
      g.gain.setValueAtTime(0, x);
      g.gain.linearRampToValueAtTime(a, x + 0.002);
      g.gain.linearRampToValueAtTime(0, x + 0.022);
    }
    n.connect(bp);
    bp.connect(g);
    g.connect(out);
    this.commit(v);
  }

  // ─────────── sound design: world events ───────────

  /** A little bird landing on the sill: close, cute "chee-ip"s. */
  private chirp(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = this.farOut(v, 0.35 + r() * 0.3, 0.09);
    const n = 2 + Math.floor(r() * 3);
    const base = 3400 + r() * 700;
    let tt = t;
    for (let i = 0; i < n; i++) {
      const len = 0.05 + r() * 0.03;
      const o = v.add(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.setValueAtTime(base * 0.85, tt);
      o.frequency.exponentialRampToValueAtTime(base * 1.2, tt + len * 0.45);
      o.frequency.exponentialRampToValueAtTime(base * 0.95, tt + len);
      const g = v.add(ctx.createGain());
      this.env(g.gain, tt, 0.006, i === n - 1 ? 0.8 : 1, len);
      o.connect(g);
      g.connect(out);
      v.src(o, tt, tt + len + 0.03);
      tt += len + (i % 2 ? 0.16 + r() * 0.1 : 0.05 + r() * 0.03);
    }
    this.commit(v);
  }

  /** UFO zipping across the sky: a playful wobbling "wooo-eee-oo" with an air rush. */
  private whoosh(t: number, dir: 1 | -1) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 0.9 + r() * 0.3;
    const v = new Voice();
    const p = this.panner(v, -0.8 * dir);
    if (p.pan) {
      p.pan.setValueAtTime(-0.8 * dir, t);
      p.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
    }
    p.connect(this.outdoor);
    const out = v.add(ctx.createGain());
    out.gain.setValueAtTime(MIN, t);
    out.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.4);
    out.gain.exponentialRampToValueAtTime(MIN, t + dur);
    out.connect(p);
    const o = v.add(ctx.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(1500 + r() * 400, t + dur * 0.45);
    o.frequency.exponentialRampToValueAtTime(520, t + dur);
    const lfo = v.add(ctx.createOscillator());
    lfo.frequency.value = 11 + r() * 4;
    const wob = v.add(ctx.createGain());
    wob.gain.value = 45;
    lfo.connect(wob);
    wob.connect(o.frequency);
    const og = v.add(ctx.createGain());
    og.gain.value = 0.55;
    o.connect(og);
    og.connect(out);
    const n = this.noiseSrc(v, t, dur + 0.02);
    const bp = v.add(this.filter('bandpass', 900, 1.2));
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(1100, t + dur);
    n.connect(bp);
    bp.connect(out);
    v.src(o, t, t + dur + 0.02);
    v.src(lfo, t, t + dur + 0.02);
    this.commit(v);
  }

  /** Hot-air balloon burner firing, high and far: a flickering roar. */
  private balloon(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const dur = 1.4 + r() * 0.9;
    const v = new Voice();
    const out = this.farOut(v, r() * 1.2 - 0.6, 0.12, 2200);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(1, t + 0.12);
    g.gain.setValueAtTime(1, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    g.connect(out);
    const am = v.add(ctx.createGain());
    am.gain.value = 0.75;
    const lfo = v.add(ctx.createOscillator());
    lfo.frequency.value = 11 + r() * 5;
    const fl = v.add(ctx.createGain());
    fl.gain.value = 0.22;
    lfo.connect(fl);
    fl.connect(am.gain);
    am.connect(g);
    const n = this.noiseSrc(v, t, dur + 0.02);
    const bp = v.add(this.filter('bandpass', 950, 0.6));
    n.connect(bp);
    bp.connect(am);
    const n2 = this.noiseSrc(v, t, dur + 0.02, this.brown);
    const lp = v.add(this.filter('lowpass', 300, 0.6));
    n2.connect(lp);
    lp.connect(am);
    v.src(lfo, t, t + dur + 0.02);
    this.commit(v);
  }

  /** Fireworks over the far rooftops: soft booms, pops and glittery crackle. */
  private fireworks(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const bursts = 3 + Math.floor(r() * 4);
    let bt = t;
    for (let b = 0; b < bursts; b++) {
      const v = new Voice();
      const out = this.farOut(v, r() * 1.6 - 0.8, 0.13 * (0.6 + r() * 0.4), 3500);
      const n = this.noiseSrc(v, bt, 0.7, this.brown);
      const lp = v.add(this.filter('lowpass', 170, 0.8));
      const g = v.add(ctx.createGain());
      this.env(g.gain, bt, 0.004, 1.6, 0.6);
      n.connect(lp);
      lp.connect(g);
      g.connect(out);
      const n2 = this.noiseSrc(v, bt, 0.05);
      const bp = v.add(this.filter('bandpass', 1400, 1));
      const g2 = v.add(ctx.createGain());
      this.env(g2.gain, bt, 0.001, 0.5, 0.04);
      n2.connect(bp);
      bp.connect(g2);
      g2.connect(out);
      const ct = bt + 0.18 + r() * 0.1;
      const cd = 0.9 + r() * 0.6;
      const c = this.noiseSrc(v, ct, cd, this.crackleBuf, 3 + r() * 1.5);
      const hp = v.add(this.filter('highpass', 2200, 0.7));
      const g3 = v.add(ctx.createGain());
      g3.gain.setValueAtTime(MIN, ct);
      g3.gain.linearRampToValueAtTime(2.2, ct + 0.05);
      g3.gain.exponentialRampToValueAtTime(MIN, ct + cd);
      c.connect(hp);
      hp.connect(g3);
      g3.connect(out);
      this.commit(v);
      bt += 0.35 + r() * 0.9;
    }
  }

  // ─────────── sound design: interactions ───────────

  /** Caught a shooting star: a twinkly upward pentatonic run over an airy shimmer. */
  private sparkle(t: number) {
    const ctx = this.ctx!;
    const r = this.rnd;
    const v = new Voice();
    const out = v.add(ctx.createGain());
    out.connect(this.sfxBus);
    const pL = this.panner(v, -0.5);
    const pR = this.panner(v, 0.5);
    pL.connect(out);
    pR.connect(out);
    const scale = [1568, 1760, 2093, 2349, 2637, 3136, 3520, 4186, 4699];
    const n = 7 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const st = t + i * 0.045 + r() * 0.01;
      const o = v.add(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.value = scale[Math.min(scale.length - 1, i)];
      const g = v.add(ctx.createGain());
      this.env(g.gain, st, 0.003, 0.05 * (1 - i / (n * 1.6)), 0.5 + r() * 0.3);
      o.connect(g);
      g.connect(i % 2 ? pR : pL);
      v.src(o, st, st + 0.85);
    }
    const nz = this.noiseSrc(v, t, 1.0);
    const hp = v.add(this.filter('highpass', 6500, 0.7));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.3);
    g.gain.exponentialRampToValueAtTime(MIN, t + 1.0);
    nz.connect(hp);
    hp.connect(g);
    g.connect(out);
    this.commit(v);
  }

  /** Tapping the character: a tiny tap and a closed-mouth questioning "hm?". */
  private boop(t: number) {
    const ctx = this.ctx!;
    const sfx = this.sfxBus;
    const v = new Voice();
    const f = 340 + this.rnd() * 30;
    const o = v.add(ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.26);
    const lp = v.add(this.filter('lowpass', 1400, 0.7));
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03);
    g.gain.linearRampToValueAtTime(0.07, t + 0.18);
    g.gain.exponentialRampToValueAtTime(MIN, t + 0.32);
    o.connect(lp);
    lp.connect(g);
    g.connect(sfx);
    v.src(o, t, t + 0.34);
    this.commit(v);
    this.noiseHit(t, 0.01, 'bandpass', 2600, 2, 0.05, sfx);
  }

  /** Friendly greeting: two rising vowel-coloured notes, "he-ey!". */
  private hey(t: number) {
    const ctx = this.ctx!;
    const v = new Voice();
    const out = v.add(ctx.createGain());
    out.connect(this.sfxBus);
    const f1 = v.add(this.filter('bandpass', 620, 3));
    const f2 = v.add(this.filter('bandpass', 1900, 4));
    const g2 = v.add(ctx.createGain());
    g2.gain.value = 0.6;
    f1.connect(out);
    f2.connect(g2);
    g2.connect(out);
    const notes: [dt: number, f: number, len: number][] = [
      [0, 523.25, 0.12],
      [0.13, 783.99, 0.26],
    ];
    for (const [dt, f, len] of notes) {
      const st = t + dt;
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.94, st);
      o.frequency.exponentialRampToValueAtTime(f, st + 0.04);
      const g = v.add(ctx.createGain());
      this.env(g.gain, st, 0.012, 0.28, len);
      o.connect(g);
      g.connect(f1);
      g.connect(f2);
      const s = v.add(ctx.createOscillator());
      s.type = 'sine';
      s.frequency.value = f;
      const gs = v.add(ctx.createGain());
      this.env(gs.gain, st, 0.012, 0.07, len);
      s.connect(gs);
      gs.connect(out);
      v.src(o, st, st + len + 0.03);
      v.src(s, st, st + len + 0.03);
    }
    this.commit(v);
  }

  /** A tiny sip from the mug: a short slurp and a soft gulp. */
  private sip(t: number) {
    const ctx = this.ctx!;
    const sfx = this.sfxBus;
    const v = new Voice();
    const dur = 0.26;
    const n = this.noiseSrc(v, t, dur + 0.02);
    const bp = v.add(this.filter('bandpass', 700, 3));
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.05);
    g.gain.linearRampToValueAtTime(0.08, t + 0.1);
    g.gain.linearRampToValueAtTime(0.24, t + 0.17);
    g.gain.exponentialRampToValueAtTime(MIN, t + dur);
    n.connect(bp);
    bp.connect(g);
    g.connect(sfx);
    this.commit(v);
    this.blip(t + 0.34, 210, 0.07, 0.1, 'sine', sfx, 140);
  }

  /** One clock tick (clicking the clock). */
  private clockTick(t: number) {
    this.noiseHit(t, 0.025, 'bandpass', 3200, 6, 0.4, this.sfxBus);
    this.blip(t, 2400, 0.015, 0.03, 'sine', this.sfxBus);
  }

  /** Opening a letter: the flap peeling ("fwip") then the paper sliding out. */
  private paper(t: number) {
    const ctx = this.ctx!;
    const v = new Voice();
    const n = this.noiseSrc(v, t, 0.14);
    const bp = v.add(this.filter('bandpass', 1800, 1.5));
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(4800, t + 0.12);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.04);
    g.gain.exponentialRampToValueAtTime(MIN, t + 0.13);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    this.commit(v);
    this.page(t + 0.14, this.sfxBus, 0.9);
  }

  /** Quest complete: "ta-ta-DAA!" pickup and a bright brassy chord with a glint on top. */
  private quest(t: number) {
    const ctx = this.ctx!;
    const sfx = this.sfxBus;
    this.blip(t, 783.99, 0.08, 0.13, 'triangle', sfx);
    this.blip(t + 0.1, 783.99, 0.08, 0.13, 'triangle', sfx);
    const st = t + 0.2;
    const v = new Voice();
    const lp = v.add(this.filter('lowpass', 1200, 0.8));
    lp.frequency.setValueAtTime(1200, st);
    lp.frequency.exponentialRampToValueAtTime(3200, st + 0.05);
    lp.frequency.exponentialRampToValueAtTime(1400, st + 0.6);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, st);
    g.gain.linearRampToValueAtTime(0.05, st + 0.02);
    g.gain.setValueAtTime(0.05, st + 0.25);
    g.gain.exponentialRampToValueAtTime(MIN, st + 0.75);
    lp.connect(g);
    g.connect(sfx);
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      const o = v.add(ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (this.rnd() - 0.5) * 10;
      o.connect(lp);
      v.src(o, st, st + 0.78);
    }
    this.commit(v);
    this.blip(st, 1046.5, 0.6, 0.12, 'triangle', sfx);
    [2093, 2637, 3136].forEach((f, i) => this.blip(st + 0.12 + i * 0.06, f, 0.25, 0.03, 'sine', sfx));
  }

  /** Big milestone: a warm pad swelling open, crowned by a cascade of chimes. */
  private levelUp(t: number) {
    const ctx = this.ctx!;
    const sfx = this.sfxBus;
    const v = new Voice();
    const lp = v.add(this.filter('lowpass', 300, 0.7));
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
    lp.frequency.exponentialRampToValueAtTime(1100, t + 2.6);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(MIN, t);
    g.gain.linearRampToValueAtTime(0.022, t + 0.9);
    g.gain.setValueAtTime(0.022, t + 1.5);
    g.gain.exponentialRampToValueAtTime(MIN, t + 3.4);
    lp.connect(g);
    g.connect(sfx);
    const end = t + 3.45;
    for (const f of [261.63, 329.63, 392, 493.88, 587.33]) {
      for (const det of [-7, 7]) {
        const o = v.add(ctx.createOscillator());
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        v.src(o, t, end);
      }
    }
    const sub = v.add(ctx.createOscillator());
    sub.type = 'sine';
    sub.frequency.value = 130.81;
    const sg = v.add(ctx.createGain());
    sg.gain.value = 2;
    sub.connect(sg);
    sg.connect(lp);
    v.src(sub, t, end);
    this.commit(v);
    this.bell(t + 0.85, 1046.5, 0.08, 2.2, sfx);
    this.bell(t + 0.97, 1318.5, 0.065, 2.2, sfx);
    this.bell(t + 1.09, 1568, 0.055, 2.4, sfx);
    this.bell(t + 1.24, 2093, 0.045, 2.6, sfx);
  }
}

/** Loop output gain at level 1. */
const LOOP_BASE: Record<LoopKey, number> = {
  crackle: 0.9,
  rain: 0.085,
  wind: 0.3,
  crickets: 0.012,
  bubbles: 0.06,
  room: 0.022,
  waves: 0.1,
  hum: 0.11,
  breeze: 0.12,
  pines: 0.16,
  stream: 0.045,
  frogs: 0.012,
};

/** Level of an ambient (scheduler-picked) passing car vs. one the renderer asks for. */
const CAR_AMBIENT = 0.16;
const CAR_EVENT = 0.26;
