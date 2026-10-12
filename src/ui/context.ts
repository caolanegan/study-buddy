import type { Store } from '../state/store';
import type { AudioEngine } from '../audio/engine';
import type { CloudSync } from '../sync/cloud';
import type { Prefs, Tab } from './prefs';
import type { RoomSnapshot } from '../core/share';

/** Shared services handed to every view. */
export interface Ctx {
  store: Store;
  audio: AudioEngine;
  cloud: CloudSync;
  prefs: Prefs;
  savePrefs(): void;
  showTab(t: Tab): void;
  /** Don't toast these achievement ids (they're shown elsewhere, e.g. the session summary). */
  quietAchievements(ids: string[]): void;
  now(): number;
  // ── set up by the world layer (src/ui/world.ts); optional so views work without it ──
  /** Open the Customise sheet (buddy look / room). */
  openCustomize?(tab?: 'character' | 'room'): void;
  /** Share a picture of my room + a visit link. */
  shareRoom?(): Promise<void>;
  /** Copy my room's visit link. */
  copyVisitLink?(): Promise<void>;
  /** Show someone's room read-only (friends / leaderboard). */
  openVisit?(snapshot: RoomSnapshot): void;
}
