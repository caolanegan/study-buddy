import { describe, expect, it } from 'vitest';
import { plantStage, PLANT_STAGES, PLANT_STAGE_NAMES } from '../src/render/room';
import { poseFor, reactPose, headTop, activityFor, TAP_REACTIONS, REACTION_LEN } from '../src/render/character';
import { hash01, mixHex } from '../src/render/pixel';
import { simTime } from '../src/core/sim';
import { HOUR } from '../src/core/time';
import { CHARACTER_PRESETS, ROOM_PRESETS, type Appearance } from '../src/core/profile';
import type { RenderScene, Mode } from '../src/render/scene';

function scene(o: { time?: number; hours?: number; mode?: Mode; items?: string[]; look?: Partial<Appearance> } = {}): RenderScene {
  return {
    time: o.time ?? 0,
    sim: simTime((o.hours ?? 0.2) * HOUR),
    weather: 'clear',
    moon: 0.5,
    mode: o.mode ?? 'studying',
    items: new Set(o.items ?? []),
    look: { ...CHARACTER_PRESETS[0].appearance, ...o.look },
    room: ROOM_PRESETS[0].room,
    studiedHours: o.hours ?? 0.2,
    realNow: 0,
  };
}

describe('starter plant growth', () => {
  it('grows through six stages with studied hours', () => {
    expect(plantStage(0)).toBe(0);
    expect(plantStage(2.9)).toBe(0);
    expect(plantStage(3)).toBe(1);
    expect(plantStage(10)).toBe(2);
    expect(plantStage(24.9)).toBe(2);
    expect(plantStage(25)).toBe(3);
    expect(plantStage(60)).toBe(4);
    expect(plantStage(150)).toBe(5);
    expect(plantStage(10_000)).toBe(5);
    expect(PLANT_STAGE_NAMES).toHaveLength(PLANT_STAGES.length);
  });
  it('never goes backwards', () => {
    let prev = 0;
    for (let h = 0; h < 200; h += 0.5) {
      const st = plantStage(h);
      expect(st).toBeGreaterThanOrEqual(prev);
      prev = st;
    }
  });
});

describe('buddy poses', () => {
  it('mostly types while studying, with an occasional sip while there is coffee', () => {
    const poses = Array.from({ length: 530 }, (_, i) => poseFor(scene({ time: i / 10 })));
    const typing = poses.filter((p) => p === 'typing').length;
    expect(typing / poses.length).toBeGreaterThan(0.9);
    expect(poses).toContain('sipping');
    const dry = Array.from({ length: 530 }, (_, i) => poseFor(scene({ time: i / 10 }), 0));
    expect(dry).not.toContain('sipping');
  });
  it('cycles through varied idle activities by day and dozes off late at night', () => {
    const day = new Set(Array.from({ length: 12 }, (_, i) => poseFor(scene({ mode: 'idle', time: i * 12 + 1 }))));
    expect(day.size).toBeGreaterThanOrEqual(6);
    expect(day).not.toContain('sleeping');
    const late = Array.from({ length: 8 }, (_, i) => poseFor(scene({ mode: 'idle', hours: 0.9, time: i * 12 + 1 })));
    expect(late.filter((p) => p === 'sleeping').length).toBeGreaterThanOrEqual(4);
  });
  it('reactions wake the buddy and pick a matching pose', () => {
    expect(reactPose(null, 'sleeping')).toBe('sleeping');
    expect(reactPose({ kind: 'wave', k: 0.5 }, 'sleeping')).toBe('resting');
    expect(reactPose({ kind: 'sip', k: 0.5 }, 'typing')).toBe('sipping');
    expect(reactPose({ kind: 'look', k: 0.5 }, 'typing')).toBe('window');
    for (const k of TAP_REACTIONS) expect(REACTION_LEN[k]).toBeGreaterThan(1);
  });
  it('only leaves the desk on breaks', () => {
    expect(activityFor(scene({ mode: 'studying', items: ['sofa'] }))).toBe('desk');
    expect(activityFor(scene({ mode: 'break', items: ['sofa'] }))).toBe('lounge');
  });
});

describe('speech-bubble head height', () => {
  it('clears big hair and tall hats', () => {
    const short = headTop(scene({ look: { hair: 'short' } }));
    expect(headTop(scene({ look: { hair: 'afro' } }))).toBeGreaterThan(short);
    expect(headTop(scene({ look: { hair: 'short' }, items: ['wizard-hat'] }))).toBeGreaterThan(headTop(scene({ look: { hair: 'short' }, items: ['beanie'] })));
    expect(headTop(scene({ look: { hair: 'afro' }, items: ['wizard-hat'] }))).toBeGreaterThan(headTop(scene({ look: { hair: 'short' }, items: ['wizard-hat'] })));
  });
});

describe('pixel helpers', () => {
  it('mixes hex colours', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#204060', 0.5)).toBe('#102030');
  });
  it('hashes deterministically into [0, 1)', () => {
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const v = hash01(i, i * 7, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 1000).toBeGreaterThan(0.4);
    expect(sum / 1000).toBeLessThan(0.6);
  });
});
