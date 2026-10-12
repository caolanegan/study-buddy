// Pure formatting helpers (unit-tested in tests/ui.test.ts).
import type { Weather } from '../core/weather';
import { HOUR, MIN } from '../core/time';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Countdown style: "4:05", "18:32", "1:02:03". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** Human duration: "0m", "45m", "2h", "1h 20m". */
export function formatShort(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MIN));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatCoins(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "×1.0", "×1.3", "×1.25", "×2.0" */
export function formatMult(m: number): string {
  const r = Math.round(m * 100) / 100;
  return '×' + (Number.isInteger(r * 10) ? r.toFixed(1) : String(r));
}

export function weatherIcon(w: Weather, isNight: boolean): string {
  switch (w) {
    case 'clear':
      return isNight ? '🌙' : '☀️';
    case 'cloudy':
      return '☁️';
    case 'rain':
      return '🌧️';
    case 'storm':
      return '⛈️';
    case 'snow':
      return '❄️';
    case 'fog':
      return '🌫️';
  }
}

export function weatherName(w: Weather): string {
  return { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', snow: 'Snow', fog: 'Fog' }[w];
}

/** Local "YYYY-MM-DD" and "HH:MM" for <input type=date/time>. */
export function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function toTimeInput(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** Parse local date + time inputs; NaN if invalid. */
export function parseLocalDateTime(date: string, time: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!dm || !tm) return NaN;
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
  return d.getTime();
}

export function formatDayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "just now", "5 min ago", "2 h ago", or a date. */
export function formatAgo(ts: number, now: number): string {
  const d = now - ts;
  if (d < 45_000) return 'just now';
  if (d < HOUR) return `${Math.round(d / MIN)} min ago`;
  if (d < 24 * HOUR) return `${Math.round(d / HOUR)} h ago`;
  return formatDate(ts);
}
