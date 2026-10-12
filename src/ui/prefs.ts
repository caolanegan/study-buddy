// Per-device UI preferences (not synced, not part of AppState).
import type { Category } from '../core/catalog';

export type Tab = 'room' | 'shop' | 'goals' | 'friends' | 'stats' | 'settings';
export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'room', label: 'Room', icon: '🏠' },
  { id: 'shop', label: 'Shop', icon: '🛍️' },
  { id: 'goals', label: 'Goals', icon: '🎯' },
  { id: 'friends', label: 'Friends', icon: '🤝' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

/** Shop tabs: the regular categories plus the limited-time event tab. */
export type ShopTab = Category | 'limited';

export interface Prefs {
  tab: Tab;
  pomodoro: boolean;
  shopCategory: ShopTab;
  /** Friends tab leaderboard: 'friends-week' | 'friends-all' | 'global-week'. */
  boardMode?: string;
  /** Desktop: hide the side panel so the room fills the screen. */
  panelCollapsed: boolean;
}

const KEY = 'study-buddy:ui';
const DEFAULTS: Prefs = { tab: 'room', pomodoro: false, shopCategory: 'computer', panelCollapsed: false };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const p = { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
    if ((p.tab as string) === 'awards') p.tab = 'goals'; // Awards moved into Goals
    if (!TABS.some((t) => t.id === p.tab)) p.tab = 'room';
    return p;
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
