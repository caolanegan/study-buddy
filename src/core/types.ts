import type { Profile } from './profile';

// Persisted app state. Everything that affects money is an append-only log
// (sessions, purchases, achievement unlocks) so states from two devices can be
// merged by union without double-counting; balances are always derived.

export interface Segment {
  start: number; // epoch ms
  end: number | null; // null while running
}

export interface Session {
  id: string;
  start: number;
  end: number;
  activeMs: number;
  /** Streak multiplier in force when the session ended. */
  multiplier: number;
  coins: number;
  /** Completed pomodoro work blocks (0 for free sessions). */
  pomodoros: number;
  manual?: boolean;
  /** What was studied (free text, e.g. "Maths"). */
  subject?: string;
  /** Optional reflection written at the end. */
  note?: string;
  /** When subject/note were last edited (newest wins in sync). */
  annotatedAt?: number;
  /** Per-local-day active ms, used for streaks / daily totals. */
  byDay: Record<string, number>;
}

export type PomodoroPhase = 'work' | 'break';

export interface ActiveSession {
  id: string;
  startedAt: number;
  segments: Segment[];
  /** Active-time (ms) at which the user last confirmed they're still studying. */
  confirmedAtActiveMs: number;
  /** Set when the "still studying?" check fired; value = wall clock of check. */
  checkPendingSince: number | null;
  /** True when paused automatically because the check went unanswered. */
  autoPaused: boolean;
  pomodoro: null | {
    phase: PomodoroPhase;
    phaseEndsAt: number;
    completed: number; // finished work blocks this session
    /** Remaining ms of the current work block while paused; null while running. */
    pausedRemaining: number | null;
  };
  updatedAt: number;
}

export interface Purchase {
  id: string; // unique purchase id
  itemId: string;
  price: number;
  at: number;
}

/** One-off coin rewards (quests, daily letters, caught shooting stars…). Ids are deterministic so two devices can't double-claim. */
export interface Bonus {
  id: string;
  kind: 'quest' | 'letter' | 'catch' | 'gift';
  reward: number;
  at: number;
  label?: string;
}

export interface Friend {
  code: string;
  name: string;
  addedAt: number;
}

export interface Settings {
  /** UI sound effects (coins, chimes, clicks). */
  sound: boolean;
  music: boolean;
  /** Keyboard clicks while studying. */
  typing: boolean;
  /** Weather, outdoor and pet sounds. */
  ambience: boolean;
  volume: number; // 0..1
  pomodoroWorkMin: number;
  pomodoroBreakMin: number;
  pomodoroLongBreakMin: number;
  dailyGoalMin: number;
  /** Show the buddy's speech bubbles. */
  bubbles: boolean;
  /** Share weekly hours with friends on the leaderboard (needs cloud sync). */
  leaderboard: boolean;
  /** Also appear on the public "Everyone" board. */
  leaderboardPublic: boolean;
}

export interface AppState {
  version: 1;
  sessions: Session[];
  purchases: Purchase[];
  /** achievement id -> unlock time */
  achievements: Record<string, number>;
  active: ActiveSession | null;
  /** slot -> item id (or absent = default) */
  equipped: Record<string, string>;
  equippedUpdatedAt: number;
  settings: Settings;
  settingsUpdatedAt: number;
  /** ids of sessions the user deleted (tombstones for sync) */
  deletedSessions: string[];
  profile: Profile;
  profileUpdatedAt: number;
  bonuses: Bonus[];
  friends: Friend[];
  /** Tombstones so a friend removed on one device stays removed after sync. */
  removedFriends: { code: string; at: number }[];
  friendsUpdatedAt: number;
}
