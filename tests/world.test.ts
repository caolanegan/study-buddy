import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { balance } from '../src/core/economy';
import { allQuests, claimQuest, dailyQuestDefs, dailyQuests, weekKey, weeklyQuests } from '../src/core/quests';
import { letterWaiting, openLetter, todaysLetter } from '../src/core/letters';
import { pickLine, type BubbleCtx } from '../src/core/dialogue';
import { decodeSnapshot, encodeSnapshot, snapshotFromHash, snapshotOf, visitUrl } from '../src/core/share';
import { CHARACTER_PRESETS, DEFAULT_PROFILE, normalizeProfile } from '../src/core/profile';
import { ITEMS, daysLeft, isAvailable, itemById, nextAvailable } from '../src/core/catalog';
import { mergeStates } from '../src/core/merge';
import { buildRow, friendCode, normalizeCode, rankEntries, weekMs, _test as LB } from '../src/sync/leaderboard';
import { HOUR, MIN } from '../src/core/time';

const T0 = new Date(2026, 9, 12, 10, 0, 0).getTime(); // Mon 12 Oct 2026, 10:00
// (manual sessions: a live session longer than an hour would hit the still-studying check)
const studied = (s: ReturnType<typeof A.defaultState>, at: number, ms: number) => A.addManualSession(s, at, ms, at + ms).state;

describe('profile', () => {
  it('defaults and repairs bad data', () => {
    expect(A.defaultState().profile.onboarded).toBe(false);
    const p = normalizeProfile({ appearance: { name: '  ' + 'x'.repeat(40), hair: 'mohawk', skin: 'deep' }, room: { view: 'mars' } });
    expect(p.appearance.name).toHaveLength(20);
    expect(p.appearance.hair).toBe(DEFAULT_PROFILE.appearance.hair);
    expect(p.appearance.skin).toBe('deep');
    expect(p.room.view).toBe('street');
  });
  it('existing users skip onboarding', () => {
    const old = studied(A.defaultState(), T0, HOUR);
    const raw = JSON.parse(JSON.stringify(old));
    delete raw.profile;
    expect(A.normalize(raw).profile.onboarded).toBe(true);
    expect(A.normalize({}).profile.onboarded).toBe(false);
  });
  it('profile is last-writer-wins in merges', () => {
    const a = A.updateProfile(A.defaultState(), { appearance: CHARACTER_PRESETS[2].appearance }, T0);
    const b = A.updateProfile(A.defaultState(), { appearance: CHARACTER_PRESETS[3].appearance }, T0 + 5);
    expect(mergeStates(a, b).profile.appearance.name).toBe(CHARACTER_PRESETS[3].appearance.name);
    expect(mergeStates(b, a).profile.appearance.name).toBe(CHARACTER_PRESETS[3].appearance.name);
  });
});

describe('quests', () => {
  it('3 daily quests, deterministic, always one study-time quest', () => {
    const q1 = dailyQuestDefs(T0).map((q) => q.id);
    expect(q1).toHaveLength(3);
    expect(new Set(q1).size).toBe(3);
    expect(dailyQuestDefs(T0 + 3 * HOUR).map((q) => q.id)).toEqual(q1);
    expect(q1.filter((id) => id.startsWith('study-'))).toHaveLength(1);
  });
  it('tracks progress, claims once, adds coins', () => {
    let s = studied(A.defaultState(), T0, 95 * MIN);
    const studyQ = dailyQuests(s, T0 + 2 * HOUR).find((q) => q.def.id.startsWith('study-'))!;
    expect(studyQ.done).toBe(true);
    const before = balance(s);
    const r = claimQuest(s, studyQ, T0 + 2 * HOUR);
    expect(r.claimed).toBe(true);
    s = r.state;
    expect(balance(s)).toBe(before + studyQ.def.reward);
    const again = dailyQuests(s, T0 + 2 * HOUR).find((q) => q.def.id === studyQ.def.id)!;
    expect(again.claimed).toBe(true);
    expect(claimQuest(s, again, T0 + 3 * HOUR).claimed).toBe(false);
  });
  it('counts the running session', () => {
    const s = A.start(A.defaultState(), T0);
    const q = dailyQuests(s, T0 + 20 * MIN).find((x) => x.def.id.startsWith('study-'))!;
    expect(q.progress).toBeCloseTo(20, 0);
  });
  it('weekly quests sum Monday..Sunday', () => {
    let s = A.defaultState();
    for (let d = 0; d < 5; d++) s = studied(s, T0 + d * 24 * HOUR, 2 * HOUR - 1);
    const w = weeklyQuests(s, T0 + 4 * 24 * HOUR + 3 * HOUR);
    expect(w.find((q) => q.def.id === 'week-days')!.done).toBe(true);
    expect(w.find((q) => q.def.id === 'week-hours')!.done).toBe(true);
    expect(weekKey(T0)).toBe(weekKey(T0 + 6 * 24 * HOUR));
    expect(weekKey(T0)).not.toBe(weekKey(T0 + 7 * 24 * HOUR));
    expect(allQuests(s, T0)).toHaveLength(5);
  });
  it('claims merge across devices without double-counting', () => {
    const s = studied(A.defaultState(), T0, 95 * MIN);
    const q = dailyQuests(s, T0 + 2 * HOUR).find((x) => x.done)!;
    const a = claimQuest(s, q, T0 + 2 * HOUR).state;
    const b = claimQuest(s, q, T0 + 3 * HOUR).state;
    const m = mergeStates(a, b);
    expect(m.bonuses).toHaveLength(1);
  });
});

describe('letters', () => {
  it('one per day, reward scales with streak', () => {
    let s = A.defaultState();
    expect(letterWaiting(s, T0)).toBe(true);
    const l = todaysLetter(s, T0, 5);
    expect(l.reward).toBe(30);
    expect(l.body.length).toBeGreaterThan(10);
    s = openLetter(s, l, T0).state;
    expect(letterWaiting(s, T0 + HOUR)).toBe(false);
    expect(letterWaiting(s, T0 + 24 * HOUR)).toBe(true);
    expect(balance(s)).toBe(30);
  });
});

describe('dialogue', () => {
  const base: BubbleCtx = { reason: 'tap', name: 'Sam', hour: 10, isNight: false, season: 0, weather: 'clear', view: 'street', streak: 0, todayMin: 0, sessionMin: 0, goalMin: 120 };
  it('always returns a line for every reason', () => {
    for (const reason of ['greet', 'tap', 'start', 'idle-chat', 'study-chat', 'break', 'back', 'end', 'milestone', 'event', 'caught', 'pet', 'letter'] as const)
      for (let i = 0; i < 20; i++) expect(pickLine({ ...base, reason, event: 'rainbow', pet: 'cat' }, () => i / 20).length).toBeGreaterThan(0);
  });
  it('uses context', () => {
    expect(pickLine({ ...base, reason: 'event', event: 'rainbow' }, () => 0)).toMatch(/rainbow/i);
    expect(pickLine({ ...base, reason: 'milestone', milestone: 'Summer is here!' }, () => 0)).toBe('Summer is here!');
  });
});

describe('share links', () => {
  it('round-trips and sanitises', () => {
    let s = A.addManualSession(A.defaultState(), T0 - 20 * HOUR, 10 * HOUR, T0).state;
    s = A.buy(s, 'cat', T0).state;
    s = A.updateProfile(s, { appearance: { ...CHARACTER_PRESETS[4].appearance, name: 'Zoë 🌟' } }, T0);
    const snap = snapshotOf(s, 10 * HOUR, 3);
    const code = encodeSnapshot(snap);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSnapshot(code)).toEqual(snap);
    const url = visitUrl('https://example.com/study-buddy/', snap);
    expect(snapshotFromHash(new URL(url).hash)).toEqual(snap);
    expect(decodeSnapshot('not-a-snapshot')).toBeNull();
    const evil = encodeSnapshot({ ...snap, items: ['cat', '<script>', 'nope'] });
    expect(decodeSnapshot(evil)!.items).toEqual(['cat']);
  });
});

describe('limited items', () => {
  const at = (m: number, d: number, y = 2026) => new Date(y, m - 1, d, 12).getTime();
  it('availability windows incl. year wrap', () => {
    const pumpkin = itemById('pumpkin-lantern')!;
    const tree = itemById('festive-tree')!;
    expect(isAvailable(pumpkin, at(10, 12))).toBe(true);
    expect(isAvailable(pumpkin, at(11, 1))).toBe(false);
    expect(daysLeft(pumpkin, at(10, 12))).toBe(19);
    expect(daysLeft(pumpkin, at(10, 31))).toBe(0);
    expect(isAvailable(tree, at(12, 25))).toBe(true);
    expect(isAvailable(tree, at(1, 3, 2027))).toBe(true);
    expect(isAvailable(tree, at(1, 10, 2027))).toBe(false);
    expect(daysLeft(tree, at(12, 30))).toBe(7);
    expect(new Date(nextAvailable(tree, at(10, 12))!).getMonth()).toBe(11);
    expect(isAvailable(itemById('cat')!, at(3, 3))).toBe(true);
  });
  it('cannot buy out of season, keeps it after', () => {
    const rich = A.addManualSession(A.defaultState(), at(10, 1) - 30 * HOUR, 25 * HOUR, at(10, 1)).state;
    expect(A.canBuy(rich, 'festive-tree', at(10, 12))).toBe('expired');
    const s = A.buy(rich, 'pumpkin-lantern', at(10, 12)).state;
    expect(A.owns(s, 'pumpkin-lantern')).toBe(true);
    expect(A.equippedItems(s).has('pumpkin-lantern')).toBe(true);
  });
  it('every item id is unique', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
});

describe('catches & new achievements', () => {
  it('awards coins and unlocks Star Catcher', () => {
    let s = A.defaultState();
    for (let i = 0; i < 3; i++) s = A.claimCatch(s, 'shooting-star', T0 + i).state;
    expect(balance(s)).toBe(45);
    const ev = A.evaluateAchievements(s, T0);
    expect(ev.unlocked).toContain('star-catcher');
  });
  it('subjects are kept and merged', () => {
    const s = studied(A.defaultState(), T0, 30 * MIN);
    const id = s.sessions[0].id;
    const annotated = A.annotateSession(s, id, { subject: ' Maths ', note: 'chapter 3' });
    expect(annotated.sessions[0].subject).toBe('Maths');
    expect(mergeStates(s, annotated).sessions[0].subject).toBe('Maths');
    expect(mergeStates(annotated, s).sessions[0].subject).toBe('Maths');
  });
});

describe('leaderboard helpers', () => {
  it('friend codes', () => {
    expect(friendCode('a1b2c3d4-e5f6-7890-abcd-ef0123456789')).toBe('A1B2-C3D4');
    expect(normalizeCode(' a1b2 c3d4 ')).toBe('A1B2-C3D4');
    expect(normalizeCode('xyz')).toBeNull();
  });
  it('builds rows and ranks', () => {
    let s = studied(A.defaultState(), T0, 2 * HOUR - 1);
    s = studied(s, T0 - 3 * 24 * HOUR, HOUR); // previous week (Fri)
    expect(weekMs(s, T0 + 3 * HOUR)).toBe(2 * HOUR - 1);
    const row = buildRow(s, 'a1b2c3d4-0000', 3 * HOUR, T0 + 3 * HOUR);
    expect(row.code).toBe('A1B2-C3D4');
    expect(row.is_public).toBe(false);
    const e = LB.toEntry({ ...row, week_key: 'w-old' }, 'x', row.week_key);
    expect(e.weekMs).toBe(0);
    const ranked = rankEntries([
      { ...e, name: 'B', weekMs: 5 },
      { ...e, name: 'A', weekMs: 9 },
    ]);
    expect(ranked.map((x) => x.name)).toEqual(['A', 'B']);
  });
});
