import { describe, expect, it } from 'vitest';
import {
  CATCHABLE, COOLDOWN, SCHEDULED, eligibleEvents, isNewYearNight, nextGap, pickWeighted, rainStopped, shootingStarGap,
  type Conditions,
} from '../src/render/views/schedule';
import type { WorldEventKind } from '../src/render/scene';

const kinds = (c: Conditions) => eligibleEvents(c).map(([k]) => k);
const base: Conditions = { view: 'street', season: 1, night: 0, weather: 'clear' };

describe('world event eligibility', () => {
  it('daytime clear skies get balloons, birds and visitors, never night things', () => {
    const k = kinds(base);
    expect(k).toEqual(expect.arrayContaining(['balloon', 'kite', 'birds', 'bird-visit']));
    expect(k).not.toContain('ufo');
    expect(k).not.toContain('fireworks');
    expect(k).not.toContain('aurora');
  });

  it('nights get UFOs and fireworks but no balloons or kites', () => {
    const k = kinds({ ...base, night: 1 });
    expect(k).toEqual(expect.arrayContaining(['ufo', 'fireworks']));
    expect(k).not.toContain('balloon');
    expect(k).not.toContain('kite');
    expect(k).not.toContain('bird-visit');
  });

  it('rain grounds the balloons, kites and birds', () => {
    const k = kinds({ ...base, weather: 'rain' });
    for (const no of ['balloon', 'kite', 'birds', 'bird-visit'] as WorldEventKind[]) expect(k).not.toContain(no);
  });

  it('kites only fly in spring and summer, in open views', () => {
    expect(kinds({ ...base, season: 0 })).toContain('kite');
    expect(kinds({ ...base, season: 2 })).not.toContain('kite');
    expect(kinds({ ...base, view: 'forest' })).not.toContain('kite');
    expect(kinds({ ...base, view: 'city' })).not.toContain('kite');
  });

  it('aurora only on clear winter nights (the forest shows it as scenery instead)', () => {
    expect(kinds({ view: 'countryside', season: 3, night: 1, weather: 'clear' })).toContain('aurora');
    expect(kinds({ view: 'countryside', season: 3, night: 1, weather: 'cloudy' })).not.toContain('aurora');
    expect(kinds({ view: 'countryside', season: 1, night: 1, weather: 'clear' })).not.toContain('aurora');
    expect(kinds({ view: 'forest', season: 3, night: 1, weather: 'clear' })).not.toContain('aurora');
  });

  it('view-specific wildlife and machines stay in their views', () => {
    expect(kinds({ ...base, view: 'seaside' })).toContain('dolphin');
    expect(kinds({ ...base, view: 'seaside', season: 3 })).not.toContain('dolphin');
    expect(kinds({ ...base, view: 'countryside' })).toContain('tractor');
    expect(kinds({ ...base, view: 'city' })).toContain('helicopter');
    expect(kinds({ ...base, view: 'forest' })).toEqual(expect.arrayContaining(['deer', 'fox']));
    for (const v of ['street', 'seaside', 'city', 'forest'] as const) expect(kinds({ ...base, view: v })).not.toContain('tractor');
    expect(kinds(base)).not.toContain('fox'); // urban foxes come out at night
    expect(kinds({ ...base, night: 1 })).toContain('fox');
  });

  it('every view has something to look forward to in every season, day and night', () => {
    for (const view of ['street', 'seaside', 'city', 'countryside', 'forest'] as const)
      for (const season of [0, 1, 2, 3] as const)
        for (const night of [0, 1])
          expect(kinds({ view, season, night, weather: 'clear' }).length, `${view} ${season} ${night}`).toBeGreaterThan(0);
  });

  it('only known, scheduled kinds come out, all with cooldowns', () => {
    for (const view of ['street', 'seaside', 'city', 'countryside', 'forest'] as const)
      for (const [k, w] of eligibleEvents({ view, season: 1, night: 0, weather: 'clear' })) {
        expect(SCHEDULED).toContain(k);
        expect(w).toBeGreaterThan(0);
        expect(COOLDOWN[k]).toBeGreaterThanOrEqual(120);
      }
  });

  it('UFOs are rare', () => {
    const list = eligibleEvents({ view: 'street', season: 1, night: 1, weather: 'clear' });
    const total = list.reduce((s, [, w]) => s + w, 0);
    const ufo = list.find(([k]) => k === 'ufo')![1];
    expect(ufo / total).toBeLessThan(0.15);
  });
});

describe('scheduling helpers', () => {
  it('pickWeighted respects weights and bounds', () => {
    const list: [string, number][] = [['a', 1], ['b', 3]];
    expect(pickWeighted(list, 0)).toBe('a');
    expect(pickWeighted(list, 0.24)).toBe('a');
    expect(pickWeighted(list, 0.26)).toBe('b');
    expect(pickWeighted(list, 0.999)).toBe('b');
    expect(pickWeighted([], 0.5)).toBeNull();
  });

  it('something notable every 1-3 minutes', () => {
    expect(nextGap(0)).toBeGreaterThanOrEqual(60);
    expect(nextGap(0.9999)).toBeLessThanOrEqual(180);
  });

  it('the first night of each sim year always gets fireworks', () => {
    expect(isNewYearNight(1, 0.7)).toBe(true);
    expect(isNewYearNight(41, 0.6)).toBe(true);
    expect(isNewYearNight(81, 0.99)).toBe(true);
    expect(isNewYearNight(41, 0.3)).toBe(false); // daytime
    expect(isNewYearNight(42, 0.7)).toBe(false);
  });

  it('rainbows follow the rain', () => {
    expect(rainStopped('rain', 'clear')).toBe(true);
    expect(rainStopped('storm', 'cloudy')).toBe(true);
    expect(rainStopped('clear', 'clear')).toBe(false);
    expect(rainStopped('rain', 'fog')).toBe(false);
    expect(rainStopped('snow', 'clear')).toBe(false);
  });

  it('shooting stars: darker skies get more, clouds fewer', () => {
    expect(shootingStarGap('forest', 'clear', 0.5)).toBeLessThan(shootingStarGap('city', 'clear', 0.5));
    expect(shootingStarGap('forest', 'cloudy', 0.5)).toBeGreaterThan(shootingStarGap('forest', 'clear', 0.5));
  });

  it('the catchable set is the four tappable things', () => {
    expect([...CATCHABLE].sort()).toEqual(['balloon', 'bird-visit', 'shooting-star', 'ufo']);
  });
});
