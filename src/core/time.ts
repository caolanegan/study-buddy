export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY_MS = 24 * HOUR;

/** Local calendar day key, e.g. "2026-10-12". */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight following ts. */
export function nextMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** Day key shifted by n calendar days. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return dayKey(dt.getTime());
}

/** Split [start, end) into ms per local day. */
export function splitByDay(start: number, end: number, into: Record<string, number> = {}): Record<string, number> {
  let s = start;
  while (s < end) {
    const e = Math.min(end, nextMidnight(s));
    const k = dayKey(s);
    into[k] = (into[k] ?? 0) + (e - s);
    s = e;
  }
  return into;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatHours(ms: number): string {
  const h = ms / HOUR;
  return h < 1000 ? h.toFixed(1) : Math.floor(h).toLocaleString();
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
