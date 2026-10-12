import type { AppState } from './types';
import { HOUR } from './time';

export interface Stats {
  totalMs: number;
  sessions: number;
  longestMs: number;
  bestStreak: number;
  purchases: number;
  pomodoros: number;
  nightOwl: boolean; // studied between 00:00 and 04:00
  earlyBird: boolean; // started between 04:00 and 07:00
  dailyMaxMs: number;
}

export interface Achievement {
  id: string;
  name: string;
  icon: string;
  desc: string;
  reward: number;
  test: (s: Stats) => boolean;
}

const hrs = (n: number) => n * HOUR;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-session', name: 'First Steps', icon: '🌱', desc: 'Finish your first study session', reward: 25, test: (s) => s.sessions >= 1 },
  { id: 'hours-1', name: 'Day One', icon: '☀️', desc: 'Study for 1 hour in total (one sim day)', reward: 25, test: (s) => s.totalMs >= hrs(1) },
  { id: 'hours-10', name: 'Season Change', icon: '🍂', desc: 'Study for 10 hours (a full season)', reward: 100, test: (s) => s.totalMs >= hrs(10) },
  { id: 'hours-40', name: 'Year One', icon: '🎉', desc: 'Study for 40 hours (a full sim year)', reward: 300, test: (s) => s.totalMs >= hrs(40) },
  { id: 'hours-100', name: 'Centurion', icon: '👑', desc: 'Study for 100 hours — unlocks the Golden Crown', reward: 500, test: (s) => s.totalMs >= hrs(100) },
  { id: 'hours-250', name: 'Scholar', icon: '🎓', desc: 'Study for 250 hours', reward: 1000, test: (s) => s.totalMs >= hrs(250) },
  { id: 'hours-500', name: 'Sage', icon: '🦉', desc: 'Study for 500 hours', reward: 2000, test: (s) => s.totalMs >= hrs(500) },
  { id: 'hours-1000', name: 'Grandmaster', icon: '🏆', desc: 'Study for 1,000 hours', reward: 5000, test: (s) => s.totalMs >= hrs(1000) },
  { id: 'streak-3', name: 'On a Roll', icon: '🔥', desc: '3-day study streak', reward: 50, test: (s) => s.bestStreak >= 3 },
  { id: 'streak-7', name: 'Week Warrior', icon: '📅', desc: '7-day study streak', reward: 150, test: (s) => s.bestStreak >= 7 },
  { id: 'streak-14', name: 'Fortnight Focus', icon: '💪', desc: '14-day study streak', reward: 300, test: (s) => s.bestStreak >= 14 },
  { id: 'streak-30', name: 'Unstoppable', icon: '🚀', desc: '30-day study streak', reward: 1000, test: (s) => s.bestStreak >= 30 },
  { id: 'marathon', name: 'Marathon', icon: '🏃', desc: 'Study 3 hours in a single session', reward: 150, test: (s) => s.longestMs >= hrs(3) },
  { id: 'big-day', name: 'Big Day', icon: '📚', desc: 'Study 6 hours in one calendar day', reward: 200, test: (s) => s.dailyMaxMs >= hrs(6) },
  { id: 'pomodoro-4', name: 'Tomato Farmer', icon: '🍅', desc: 'Complete 4 pomodoros', reward: 75, test: (s) => s.pomodoros >= 4 },
  { id: 'pomodoro-50', name: 'Tomato Tycoon', icon: '🥫', desc: 'Complete 50 pomodoros', reward: 400, test: (s) => s.pomodoros >= 50 },
  { id: 'night-owl', name: 'Night Owl', icon: '🌙', desc: 'Study between midnight and 4am', reward: 50, test: (s) => s.nightOwl },
  { id: 'early-bird', name: 'Early Bird', icon: '🐦', desc: 'Start a session between 4am and 7am', reward: 50, test: (s) => s.earlyBird },
  { id: 'first-purchase', name: 'Interior Designer', icon: '🛍️', desc: 'Buy your first upgrade', reward: 25, test: (s) => s.purchases >= 1 },
  { id: 'collector', name: 'Collector', icon: '🧺', desc: 'Own 10 upgrades', reward: 300, test: (s) => s.purchases >= 10 },
];

export function computeStats(state: AppState, bestStreak: number): Stats {
  const daily: Record<string, number> = {};
  let nightOwl = false;
  let earlyBird = false;
  for (const s of state.sessions) {
    for (const [k, v] of Object.entries(s.byDay)) daily[k] = (daily[k] ?? 0) + v;
    if (s.manual) continue;
    const startH = new Date(s.start).getHours();
    if (startH >= 4 && startH < 7) earlyBird = true;
    // approximate: session wall-clock span touches 00:00–04:00
    for (let t = s.start; t <= s.end; t += 15 * 60_000) {
      if (new Date(t).getHours() < 4) { nightOwl = true; break; }
    }
  }
  return {
    totalMs: state.sessions.reduce((a, s) => a + s.activeMs, 0),
    sessions: state.sessions.length,
    longestMs: state.sessions.reduce((a, s) => Math.max(a, s.activeMs), 0),
    bestStreak,
    purchases: state.purchases.length,
    pomodoros: state.sessions.reduce((a, s) => a + s.pomodoros, 0),
    nightOwl,
    earlyBird,
    dailyMaxMs: Object.values(daily).reduce((a, v) => Math.max(a, v), 0),
  };
}
