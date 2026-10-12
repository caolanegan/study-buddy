import type { Store } from '../state/store';
import type { AudioEngine } from '../audio/engine';
import type { CloudSync } from '../sync/cloud';
import type { Prefs, Tab } from './prefs';

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
}
