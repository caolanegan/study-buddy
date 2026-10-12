import { describe, expect, it } from 'vitest';
import * as A from '../src/core/actions';
import { ACHIEVEMENTS, computeStats } from '../src/core/achievements';
import { itemById } from '../src/core/catalog';
import { claimQuest, dailyQuests, weeklyQuests, type QuestView } from '../src/core/quests';
import { HOUR, MIN } from '../src/core/time';
import type { AppState, Session } from '../src/core/types';
import type { BoardEntry, EntryRow } from '../src/sync/leaderboard';
import {
  achievementProgress,
  comingUp,
  eventIcon,
  formatResetIn,
  hoursMilestone,
  limitedBadge,
  liveEvents,
  msUntilWeekReset,
  nextQuestLine,
  questCard,
  questProgressText,
  recentSubjects,
  returnsLabel,
  simMilestone,
  subjectTotals,
  visibleInCategory,
} from '../src/ui/goalsvm';
import {
  PUBLISH_EVERY_MS,
  boardRows,
  emptyBoardText,
  formatBoardHours,
  medal,
  quietFriends,
  rowSignature,
  shouldPublish,
  withMe,
} from '../src/ui/socialvm';
import { shopButton } from '../src/ui/viewmodel';

const T0 = new Date(2026, 9, 12, 15, 0, 0).getTime(); // Mon 12 Oct 2026, 15:00 local
const at = (y: number, m: number, d: number, hh = 12) => new Date(y, m - 1, d, hh).getTime();

function manual(state: AppState, start: number, ms: number, now = T0): AppState {
  return A.addManualSession(state, start, ms, now).state;
}

function quest(defId: string, scope: 'daily' | 'weekly', state: AppState, now = T0): QuestView | undefined {
  return (scope === 'daily' ? dailyQuests(state, now) : weeklyQuests(state, now)).find((q) => q.def.id === defId);
}

function fakeQuest(partial: Partial<QuestView['def']>, progress: number, extra: Partial<QuestView> = {}): QuestView {
  const def = { id: 'study-45', title: 'Study for 45 minutes', icon: '📖', reward: 40, target: 45, unit: 'min' as const, progress: () => 0, ...partial };
  return { claimId: `quest:x:${def.id}`, def, scope: 'daily', progress: Math.min(progress, def.target), done: progress >= def.target, claimed: false, ...extra };
}

describe('quest cards', () => {
  it('formats progress for each unit', () => {
    expect(questProgressText(fakeQuest({}, 32.7))).toBe('32/45 min');
    expect(questProgressText(fakeQuest({ id: 'pomo-2', target: 2, unit: 'count' }, 1))).toBe('1/2 pomodoros');
    expect(questProgressText(fakeQuest({ id: 'twice', target: 2, unit: 'count' }, 2))).toBe('2/2 sessions');
    expect(questProgressText(fakeQuest({ id: 'goal', target: 1, unit: 'count' }, 0.684))).toBe('68%');
    expect(questProgressText(fakeQuest({ id: 'goal', target: 1, unit: 'count' }, 1))).toBe('Done');
    expect(questProgressText(fakeQuest({ id: 'week-hours', target: 8, unit: 'h' }, 3.26))).toBe('3.2/8 h');
    expect(questProgressText(fakeQuest({ id: 'week-hours', target: 8, unit: 'h' }, 4))).toBe('4/8 h');
    expect(questProgressText(fakeQuest({ id: 'week-days', target: 5, unit: 'days' }, 3))).toBe('3/5 days');
  });

  it('derives card state, pct and reward', () => {
    const c = questCard(fakeQuest({}, 30));
    expect(c).toMatchObject({ title: 'Study for 45 minutes', reward: '+40 🪙', state: 'progress', progressText: '30/45 min' });
    expect(c.pct).toBeCloseTo(30 / 45);
    expect(questCard(fakeQuest({}, 50)).state).toBe('ready');
    expect(questCard(fakeQuest({}, 50, { claimed: true })).state).toBe('claimed');
    expect(questCard(fakeQuest({}, 50)).pct).toBe(1);
  });

  it('works with real quests: progress → claim → claimed', () => {
    let s = A.defaultState();
    s = manual(s, T0 - 3 * HOUR, 95 * MIN);
    const daily = dailyQuests(s, T0);
    const study = daily.find((q) => q.def.id.startsWith('study-'))!;
    expect(questCard(study).state).toBe('ready');
    const r = claimQuest(s, study, T0);
    expect(r.claimed).toBe(true);
    const after = dailyQuests(r.state, T0).find((q) => q.claimId === study.claimId)!;
    expect(questCard(after).state).toBe('claimed');
    // a weekly quest in progress
    const wk = quest('week-hours', 'weekly', r.state)!;
    expect(questCard(wk).progressText).toBe('1.5/8 h');
  });
});

describe('countdowns', () => {
  it('formats reset times', () => {
    expect(formatResetIn(5 * HOUR + 12 * MIN + 30_000)).toBe('5h 12m');
    expect(formatResetIn(12 * MIN)).toBe('12m');
    expect(formatResetIn(20_000)).toBe('under a minute');
    expect(formatResetIn(3 * 24 * HOUR + 4 * HOUR + 5 * MIN)).toBe('3d 4h');
    expect(formatResetIn(2 * 24 * HOUR)).toBe('2d');
  });

  it('weekly reset is next Monday midnight', () => {
    // Mon 15:00 → 6 days 9 hours
    expect(msUntilWeekReset(T0)).toBe(6 * 24 * HOUR + 9 * HOUR);
    // Sun 23:00 → 1 hour
    expect(msUntilWeekReset(at(2026, 10, 18, 23))).toBe(HOUR);
  });
});

describe('next quest nudge', () => {
  it('prefers a claimable reward, then the closest quest, then all-done', () => {
    const a = fakeQuest({ id: 'study-45' }, 32);
    const b = fakeQuest({ id: 'pomo-2', title: 'Finish 2 pomodoros', icon: '🍅', target: 2, unit: 'count', reward: 40 }, 0);
    expect(nextQuestLine([a, b])).toEqual({ text: '📖 Next: Study for 45 minutes · 32/45 min', ready: false });
    const done = fakeQuest({ id: 'twice', title: 'Study in 2 separate sessions', target: 2, unit: 'count', reward: 35 }, 2);
    expect(nextQuestLine([a, b, done])).toEqual({ text: '🎁 Quest complete — claim +35 🪙', ready: true });
    const claimed = [fakeQuest({}, 45, { claimed: true })];
    expect(nextQuestLine(claimed)?.text).toMatch(/All of today/);
    expect(nextQuestLine([])).toBeNull();
  });
});

describe('achievement progress hints', () => {
  it('shows countable progress', () => {
    let s = A.defaultState();
    s = manual(s, T0 - 5 * HOUR, 4 * HOUR + 15 * MIN);
    const stats = computeStats(s, 1);
    const get = (id: string) => achievementProgress(ACHIEVEMENTS.find((a) => a.id === id)!, stats);
    expect(get('hours-10')?.text).toBe('4.2/10 h');
    expect(get('hours-10')?.pct).toBeCloseTo(0.425);
    expect(get('streak-7')?.text).toBe('1/7 days');
    expect(get('marathon')?.text).toBe('3/3 h');
    expect(get('night-owl')).toBeNull();
    expect(get('polymath')?.text).toBe('0/3 subjects');
  });
});

describe('limited-time shop', () => {
  const lantern = itemById('pumpkin-lantern')!;
  const tree = itemById('festive-tree')!;
  it('badges days left and last day', () => {
    expect(limitedBadge(lantern, at(2026, 10, 12))).toBe('19 days left');
    expect(limitedBadge(lantern, at(2026, 10, 30))).toBe('1 day left');
    expect(limitedBadge(lantern, at(2026, 10, 31))).toBe('Last day!');
    expect(limitedBadge(lantern, at(2026, 11, 1))).toBeNull();
    expect(limitedBadge(itemById('cat')!, T0)).toBeNull();
  });

  it('labels when an item returns', () => {
    expect(returnsLabel(tree, at(2026, 10, 12))).toBe('Returns in December');
    expect(returnsLabel(lantern, at(2026, 11, 2))).toBe('Returns in October');
    expect(returnsLabel(lantern, at(2026, 10, 12))).toBeNull();
    // canBuy 'expired' → disabled button with the return month
    const b = shopButton(A.defaultState(), tree, 1, at(2026, 10, 12));
    expect(b).toMatchObject({ label: 'Returns in December', disabled: true, action: 'none' });
  });

  it('groups live events and finds the next one', () => {
    const oct = liveEvents(at(2026, 10, 12));
    expect(oct.map((e) => e.event)).toEqual(['Halloween']);
    expect(oct[0].items.length).toBe(4);
    expect(oct[0].daysLeft).toBe(19);
    const next = comingUp(at(2026, 10, 12))!;
    expect(next.event).toBe('Harvest');
    expect(new Date(next.from!).getMonth()).toBe(10);
    // Dec 20: winter festival (wraps the new year) is live, Lunar New Year is next
    const dec = liveEvents(at(2026, 12, 20));
    expect(dec.map((e) => e.event)).toEqual(['Winter festival']);
    expect(dec[0].daysLeft).toBe(17);
    expect(comingUp(at(2026, 12, 20))!.event).toBe('Lunar New Year');
    expect(eventIcon('Halloween')).toBe('🎃');
    expect(eventIcon('Mystery')).toBe('✨');
  });

  it('hides out-of-window items unless owned', () => {
    expect(visibleInCategory(tree, false, at(2026, 10, 12))).toBe(false);
    expect(visibleInCategory(tree, true, at(2026, 10, 12))).toBe(true);
    expect(visibleInCategory(lantern, false, at(2026, 10, 12))).toBe(true);
    expect(visibleInCategory(itemById('cat')!, false, at(2026, 10, 12))).toBe(true);
  });
});

describe('subjects', () => {
  const sess = (id: string, end: number, ms: number, subject?: string): Session => ({
    id,
    start: end - ms,
    end,
    activeMs: ms,
    multiplier: 1,
    coins: 0,
    pomodoros: 0,
    byDay: {},
    subject,
  });
  const list = [
    sess('a', T0 - 40 * 24 * HOUR, 2 * HOUR, 'History'),
    sess('b', T0 - 3 * HOUR, HOUR, 'maths'),
    sess('c', T0 - 2 * HOUR, 30 * MIN, 'Maths'),
    sess('d', T0 - HOUR, 20 * MIN, 'Spanish'),
    sess('e', T0 - 30 * MIN, 10 * MIN),
  ];
  it('lists recent subjects newest first, case-insensitively unique', () => {
    expect(recentSubjects(list)).toEqual(['Spanish', 'Maths', 'History']);
    expect(recentSubjects(list, 1)).toEqual(['Spanish']);
  });
  it('totals per subject with a time window', () => {
    const all = subjectTotals(list, null);
    expect(all.subjects.map((x) => [x.name, x.ms / MIN])).toEqual([
      ['History', 120],
      ['Maths', 90],
      ['Spanish', 20],
    ]);
    expect(all.untaggedMs).toBe(10 * MIN);
    const recent = subjectTotals(list, T0 - 30 * 24 * HOUR);
    expect(recent.subjects.map((x) => x.name)).toEqual(['Maths', 'Spanish']);
    expect(recent.subjects[0].sessions).toBe(2);
  });
  it('annotateSession feeds the polymath achievement', () => {
    let s = A.defaultState();
    for (const [i, sub] of ['Maths', 'Biology', 'Art'].entries()) {
      const r = A.addManualSession(s, T0 - (i + 2) * HOUR, 30 * MIN, T0);
      s = A.annotateSession(r.state, r.session!.id, { subject: sub, note: 'good' });
    }
    expect(A.evaluateAchievements(s, T0).unlocked).toContain('polymath');
  });
});

describe('milestones', () => {
  it('celebrates a new sim day, season and year', () => {
    expect(simMilestone(42 * HOUR + 59 * MIN, 43 * HOUR)).toMatchObject({ kind: 'day', text: 'Day 44 begins', big: false });
    expect(simMilestone(20 * HOUR - 1000, 20 * HOUR)).toMatchObject({ kind: 'season', icon: '🍂', text: 'Autumn has arrived! · 20 hours studied', big: true });
    expect(simMilestone(40 * HOUR - 1000, 40 * HOUR)).toMatchObject({ kind: 'year', icon: '🎆', big: true });
    expect(simMilestone(40 * HOUR - 1000, 40 * HOUR)!.text).toMatch(/^Year 2!/);
    expect(simMilestone(5 * HOUR + 10, 5 * HOUR + 20)).toBeNull();
    // jumps (sync / import) aren't live transitions
    expect(simMilestone(5 * HOUR, 8 * HOUR)).toBeNull();
  });
  it('hours milestones every 10h', () => {
    expect(hoursMilestone(29.5 * HOUR, 30.2 * HOUR)).toMatchObject({ text: '30 hours studied in total!' });
    expect(hoursMilestone(21 * HOUR, 22 * HOUR)).toBeNull();
    expect(hoursMilestone(5 * HOUR, 25 * HOUR)).toBeNull();
  });
});

describe('leaderboard rows', () => {
  const entry = (name: string, weekH: number, totalH: number, streak = 0, isMe = false): BoardEntry => ({
    code: name.toUpperCase().padEnd(4, 'X') + '-0000',
    name,
    weekMs: weekH * HOUR,
    totalMs: totalH * HOUR,
    streak,
    snapshot: null,
    isMe,
    updatedAt: '',
  });
  it('formats hours and medals', () => {
    expect(formatBoardHours(0)).toBe('0m');
    expect(formatBoardHours(45 * MIN)).toBe('45m');
    expect(formatBoardHours(4.56 * HOUR)).toBe('4.5h');
    expect(formatBoardHours(3 * HOUR)).toBe('3h');
    expect(formatBoardHours(123.4 * HOUR)).toBe('123h');
    expect([1, 2, 3, 4].map(medal)).toEqual(['🥇', '🥈', '🥉', '4']);
  });
  it('ranks by week or all time, ties by streak', () => {
    const es = [entry('Ana', 2, 50, 1), entry('Ben', 5, 10, 0), entry('Cy', 2, 80, 4), entry('Me', 3, 20, 2, true)];
    const week = boardRows(es, 'friends-week');
    expect(week.map((r) => [r.medal, r.name, r.hours, r.streak])).toEqual([
      ['🥇', 'Ben', '5h', ''],
      ['🥈', 'Me', '3h', '🔥 2'],
      ['🥉', 'Cy', '2h', '🔥 4'],
      ['4', 'Ana', '2h', '🔥 1'],
    ]);
    expect(week[1].isMe).toBe(true);
    expect(boardRows(es, 'friends-all').map((r) => r.name)).toEqual(['Cy', 'Ana', 'Me', 'Ben']);
  });
  it('replaces the server copy of me with live numbers', () => {
    const server = [entry('Ana', 2, 5), { ...entry('Me', 1, 1, 0, true), code: 'ME00-0000' }];
    const me = { ...entry('Me', 3, 9, 2, true), code: 'ME00-0000' };
    const merged = withMe(server, me);
    expect(merged.filter((e) => e.isMe)).toEqual([me]);
    expect(withMe(server, null).some((e) => e.isMe)).toBe(false);
  });
  it('finds friends who are not sharing', () => {
    const friends = [
      { code: 'ANAX-0000', name: 'Ana', addedAt: 0 },
      { code: 'ZED0-0000', name: 'Zed', addedAt: 0 },
    ];
    expect(quietFriends(friends, [entry('Ana', 1, 1)]).map((f) => f.name)).toEqual(['Zed']);
    expect(emptyBoardText('friends-week', 0)).toMatch(/Add a friend/);
    expect(emptyBoardText('global-week', 3)).toMatch(/public board/);
  });
});

describe('publish throttling', () => {
  const row = (weekMs: number, extra: Partial<EntryRow> = {}): EntryRow => ({
    user_id: 'u',
    code: 'ABCD-1234',
    name: 'Sam',
    week_key: 'w2026-10-12',
    week_ms: weekMs,
    total_ms: weekMs,
    streak: 1,
    is_public: false,
    snapshot: { v: 1, look: A.defaultState().profile.appearance, room: A.defaultState().profile.room, items: [], hours: 1, streak: 1 },
    ...extra,
  });
  it('ignores sub-minute timer changes', () => {
    expect(rowSignature(row(10 * MIN + 5_000))).toBe(rowSignature(row(10 * MIN + 50_000)));
    expect(rowSignature(row(10 * MIN))).not.toBe(rowSignature(row(11 * MIN)));
    expect(rowSignature(row(0, { name: 'Max' }))).not.toBe(rowSignature(row(0)));
  });
  it('publishes first time, skips unchanged, throttles to 5 minutes unless forced', () => {
    const a = rowSignature(row(10 * MIN));
    const b = rowSignature(row(12 * MIN));
    expect(shouldPublish({ lastSig: null, lastAt: 0 }, a, T0)).toBe(true);
    const st = { lastSig: a, lastAt: T0 };
    expect(shouldPublish(st, a, T0 + 10 * PUBLISH_EVERY_MS, true)).toBe(false); // unchanged, even when forced
    expect(shouldPublish(st, b, T0 + MIN)).toBe(false); // too soon
    expect(shouldPublish(st, b, T0 + MIN, true)).toBe(true); // session end / toggle / profile change
    expect(shouldPublish(st, b, T0 + PUBLISH_EVERY_MS)).toBe(true);
  });
});
