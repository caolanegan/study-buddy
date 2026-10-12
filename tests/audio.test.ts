import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AMBIENCE_WEIGHTS,
  AudioEngine,
  SFX_NAMES,
  eligibleAmbience,
  loopLevels,
  musicMode,
  nextAmbienceDelay,
  pickAmbience,
  type AudioScene,
} from '../src/audio/engine';

// ───────── minimal fake Web Audio graph ─────────

class FakeParam {
  value: number;
  events: string[] = [];
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.events.push('set');
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.events.push('lin');
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    if (v <= 0) throw new RangeError('exponential ramp to non-positive value');
    this.events.push('exp');
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.events.push('target');
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  connections: unknown[] = [];
  disconnected = 0;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  constructor(public kind: string, public ctx: FakeContext) {
    ctx.created.push(this);
  }
  connect(dest: unknown) {
    this.connections.push(dest);
    this.ctx.connects++;
    return dest;
  }
  disconnect() {
    this.disconnected++;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext {
  static instances: FakeContext[] = [];
  created: FakeNode[] = [];
  connects = 0;
  state: string = 'suspended';
  sampleRate = 8000; // keep buffers small in tests
  destination = { kind: 'destination' };
  closed = false;
  constructor() {
    FakeContext.instances.push(this);
  }
  get currentTime() {
    return Date.now() / 1000; // follows vi fake timers
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
  createBuffer(ch: number, len: number, sr: number) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { duration: len / sr, length: len, sampleRate: sr, numberOfChannels: ch, getChannelData: (i: number) => data[i] };
  }
  private node(kind: string, params: Record<string, number>) {
    const n = new FakeNode(kind, this) as FakeNode & Record<string, unknown>;
    for (const [k, v] of Object.entries(params)) n[k] = new FakeParam(v);
    return n;
  }
  createGain() {
    return this.node('gain', { gain: 1 });
  }
  createBiquadFilter() {
    return this.node('biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
  }
  createOscillator() {
    return this.node('osc', { frequency: 440, detune: 0 });
  }
  createBufferSource() {
    return this.node('buffer', { playbackRate: 1, detune: 0 });
  }
  createStereoPanner() {
    return this.node('panner', { pan: 0 });
  }
  createDelay() {
    return this.node('delay', { delayTime: 0 });
  }
  createDynamicsCompressor() {
    return this.node('compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  count(kind: string) {
    return this.created.filter((n) => n.kind === kind).length;
  }
}

const scene = (over: Partial<AudioScene> = {}): AudioScene => ({
  studying: false,
  onBreak: false,
  isNight: false,
  season: 0,
  weather: 'clear',
  pets: [],
  ...over,
});

function makeEngine() {
  const factory = vi.fn(() => new FakeContext() as unknown as BaseAudioContext);
  const engine = new AudioEngine({ createContext: factory });
  return { engine, factory, ctx: () => FakeContext.instances[FakeContext.instances.length - 1] };
}

beforeEach(() => {
  FakeContext.instances = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AudioEngine lifecycle', () => {
  it('creates nothing before unlock', () => {
    const { engine, factory } = makeEngine();
    engine.setVolume(0.5);
    engine.setEnabled({ sfx: true, music: true });
    engine.update(scene({ studying: true, weather: 'storm', pets: ['cat', 'fish-tank'] }));
    for (const s of SFX_NAMES) engine.play(s);
    vi.advanceTimersByTime(5000);
    expect(factory).not.toHaveBeenCalled();
    expect(FakeContext.instances).toHaveLength(0);
    expect(engine.unlocked).toBe(false);
  });

  it('unlock creates and resumes the context once; resumes again when suspended/interrupted', async () => {
    const { engine, factory, ctx } = makeEngine();
    await engine.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx().state).toBe('running');
    ctx().state = 'interrupted';
    const resume = vi.spyOn(ctx(), 'resume');
    await engine.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctx().state).toBe('running');
  });

  it('schedules nothing while the context is suspended', async () => {
    const { engine, ctx } = makeEngine();
    engine.update(scene({ studying: true }));
    await engine.unlock();
    ctx().state = 'suspended';
    const before = ctx().created.length;
    vi.advanceTimersByTime(10_000);
    engine.play('coin');
    expect(ctx().created.length).toBe(before);
  });

  it('update() with studying starts typing scheduling', async () => {
    const { engine, ctx } = makeEngine();
    engine.setEnabled({ sfx: true, music: false });
    await engine.unlock();
    engine.update(scene({ studying: false }));
    vi.advanceTimersByTime(3000);
    const idleSources = ctx().count('buffer');

    engine.update(scene({ studying: true }));
    vi.advanceTimersByTime(30_000);
    const typed = ctx().count('buffer') - idleSources;
    expect(typed).toBeGreaterThan(10); // many key clicks

    // stops typing when no longer studying
    engine.update(scene({ studying: false }));
    vi.advanceTimersByTime(1000); // let already-scheduled lookahead drain
    const after = ctx().count('buffer');
    vi.advanceTimersByTime(4000);
    expect(ctx().count('buffer')).toBe(after);
  });

  it('music schedules notes and disabling music stops it', async () => {
    const { engine, ctx } = makeEngine();
    engine.setEnabled({ sfx: false, music: true });
    await engine.unlock();
    vi.advanceTimersByTime(4000);
    expect(ctx().count('osc')).toBeGreaterThan(5);

    engine.setEnabled({ sfx: false, music: false });
    vi.advanceTimersByTime(600);
    const n = ctx().created.length;
    vi.advanceTimersByTime(10_000);
    expect(ctx().created.length).toBe(n);
  });

  it('play() no-ops when sfx disabled, plays when enabled', async () => {
    const { engine, ctx } = makeEngine();
    engine.setEnabled({ sfx: false, music: false });
    await engine.unlock();
    const n = ctx().created.length;
    for (const s of SFX_NAMES) engine.play(s);
    expect(ctx().created.length).toBe(n);

    engine.setEnabled({ sfx: true, music: false });
    for (const s of SFX_NAMES) {
      const before = ctx().created.length;
      engine.play(s);
      expect(ctx().created.length, s).toBeGreaterThan(before);
    }
  });

  it('one-shot voices disconnect their nodes when they end', async () => {
    const { engine, ctx } = makeEngine();
    engine.setEnabled({ sfx: true, music: false });
    await engine.unlock();
    const n = ctx().created.length;
    engine.play('coin');
    const nodes = ctx().created.slice(n);
    const withEnd = nodes.filter((x) => x.onended);
    expect(withEnd.length).toBeGreaterThan(0);
    withEnd.forEach((x) => x.onended!());
    expect(nodes.every((x) => x.disconnected > 0)).toBe(true);
  });

  it('weather loops are created only when needed and torn down after', async () => {
    const { engine, ctx } = makeEngine();
    engine.setEnabled({ sfx: true, music: false });
    await engine.unlock();
    engine.update(scene({ weather: 'clear' }));
    const n = ctx().created.length;
    engine.update(scene({ weather: 'storm' }));
    const rainNodes = ctx().created.slice(n).filter((x) => x.kind === 'buffer');
    expect(rainNodes.length).toBeGreaterThan(0);
    engine.update(scene({ weather: 'clear' }));
    expect(rainNodes.every((x) => x.stopped)).toBe(true);
  });

  it('dispose() closes the context and stops timers', async () => {
    const { engine, ctx } = makeEngine();
    await engine.unlock();
    engine.update(scene({ studying: true }));
    const c = ctx();
    engine.dispose();
    expect(c.closed).toBe(true);
    const n = c.created.length;
    vi.advanceTimersByTime(10_000);
    engine.play('coin');
    await engine.unlock();
    expect(c.created.length).toBe(n);
    expect(FakeContext.instances).toHaveLength(1);
  });

  it('setVolume clamps and ramps the master gain', async () => {
    const { engine } = makeEngine();
    await engine.unlock();
    expect(() => engine.setVolume(2)).not.toThrow();
    expect(() => engine.setVolume(-1)).not.toThrow();
    expect(() => engine.setVolume(Number.NaN)).not.toThrow();
  });

  it('survives a long noisy run across many scenes', async () => {
    const { engine, ctx } = makeEngine();
    await engine.unlock();
    const weathers = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const;
    for (let i = 0; i < 24; i++) {
      engine.update(
        scene({
          studying: i % 3 !== 0,
          onBreak: i % 3 === 0,
          isNight: i % 2 === 0,
          season: (i % 4) as 0 | 1 | 2 | 3,
          weather: weathers[i % weathers.length],
          pets: ['cat', 'dog', 'fish-tank', 'lizard'],
        }),
      );
      vi.advanceTimersByTime(15_000);
    }
    expect(ctx().created.length).toBeGreaterThan(100);
  });
});

describe('pure ambience logic', () => {
  it('birds by day in spring/summer, owl at night, none in rain', () => {
    expect(eligibleAmbience(scene({ season: 0 }))).toContain('birds');
    expect(eligibleAmbience(scene({ season: 1 }))).toContain('birds');
    expect(eligibleAmbience(scene({ season: 3 }))).not.toContain('birds');
    expect(eligibleAmbience(scene({ season: 1, isNight: true }))).not.toContain('birds');
    expect(eligibleAmbience(scene({ season: 1, isNight: true }))).toContain('owl');
    expect(eligibleAmbience(scene({ season: 1, weather: 'rain' }))).not.toContain('birds');
    expect(eligibleAmbience(scene({ isNight: true, weather: 'storm' }))).not.toContain('owl');
  });

  it('wind in autumn/winter/snow, desk sounds by activity, pets by ownership', () => {
    expect(eligibleAmbience(scene({ season: 2 }))).toContain('wind');
    expect(eligibleAmbience(scene({ season: 0, weather: 'snow' }))).toContain('wind');
    expect(eligibleAmbience(scene({ season: 1 }))).not.toContain('wind');
    expect(eligibleAmbience(scene({ studying: true }))).toContain('page');
    expect(eligibleAmbience(scene({ studying: false }))).not.toContain('page');
    expect(eligibleAmbience(scene())).not.toContain('meow');
    const all = eligibleAmbience(scene({ pets: ['cat', 'dog', 'lizard', 'fish-tank'] }));
    expect(all).toEqual(expect.arrayContaining(['meow', 'purr', 'bark', 'pant', 'rustle']));
    for (const a of all) expect(AMBIENCE_WEIGHTS[a]).toBeGreaterThan(0);
  });

  it('loop levels follow weather, night and pets', () => {
    expect(loopLevels(scene({ weather: 'cloudy' })).rain).toBe(0);
    const rain = loopLevels(scene({ weather: 'rain' })).rain;
    const storm = loopLevels(scene({ weather: 'storm' })).rain;
    expect(rain).toBeGreaterThan(0);
    expect(storm).toBeGreaterThan(rain);
    expect(loopLevels(scene({ isNight: true, season: 1 })).crickets).toBeGreaterThan(0);
    expect(loopLevels(scene({ isNight: false, season: 1 })).crickets).toBe(0);
    expect(loopLevels(scene({ isNight: true, season: 3 })).crickets).toBe(0);
    expect(loopLevels(scene({ weather: 'snow' })).wind).toBeGreaterThan(0);
    expect(loopLevels(scene({ pets: ['fish-tank'] })).bubbles).toBe(1);
  });

  it('music mode, delays and weighted picks', () => {
    expect(musicMode(scene({ studying: true }))).toBe('full');
    expect(musicMode(scene({ studying: true, onBreak: true }))).toBe('soft');
    expect(musicMode(null)).toBe('soft');
    for (let i = 0; i < 50; i++) {
      const d = nextAmbienceDelay(scene());
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(90);
    }
    expect(pickAmbience([])).toBeNull();
    expect(pickAmbience(['owl'], () => 0.5, 'owl')).toBe('owl');
    expect(pickAmbience(['owl', 'car'], () => 0, 'owl')).toBe('car');
    expect(pickAmbience(['owl', 'car'], () => 0.999)).toBe('car');
  });
});
