// Share my room: a crisp PNG card of the room + a visit link friends can open.
import { dailyTotals, streakInfo, totalStudiedMs } from '../core/economy';
import { snapshotOf, visitUrl } from '../core/share';
import { simTime } from '../core/sim';
import { HOUR } from '../core/time';
import { h } from './dom';
import { openModal, toast } from './overlay';
import { renderOffscreen, sceneFor } from './roompreview';
import { prettyUrl, shareCardLines, shareText, ROOM_H, ROOM_W, type ShareInfo } from './worldlogic';
import type { Ctx } from './context';

const SCALE = 4;
const PAD = 32;
const FOOT = 168;
const FONT = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif';

/** Base URL of the app (no hash / query). */
export function appBase(): string {
  return location.origin + location.pathname;
}

export function myVisitUrl(ctx: Ctx): string {
  const s = ctx.store.get();
  const now = ctx.now();
  return visitUrl(appBase(), snapshotOf(s, totalStudiedMs(s, now), streakInfo(dailyTotals(s, now), now).current));
}

export function shareInfo(ctx: Ctx): ShareInfo {
  const s = ctx.store.get();
  const now = ctx.now();
  const total = totalStudiedMs(s, now);
  const sim = simTime(total);
  return { name: s.profile.appearance.name, hours: total / HOUR, streak: streakInfo(dailyTotals(s, now), now).current, day: sim.day, season: sim.seasonName };
}

// tiny pixel icons for the card (no emoji fonts needed)
const ICONS: Record<string, { pal: Record<string, string>; rows: string[] }> = {
  clock: {
    pal: { o: '#3a3340', w: '#f7f1e3', r: '#c0392b' },
    rows: ['..ooooo..', '.owwwwwo.', 'owwwowwwo', 'owwwowwwo', 'owwwoooro', 'owwwwwwwo', 'owwwwwwwo', '.owwwwwo.', '..ooooo..'],
  },
  flame: {
    pal: { r: '#e0564a', o: '#f2a134', y: '#fbe08a' },
    rows: ['....r....', '...rr....', '...rrr.r.', '..rrrrrr.', '.rrorrrrr', '.rrooorrr', 'rrooyoorr', 'rroyyyorr', '.rroyyor.', '..rrrrr..'],
  },
  sun: {
    pal: { y: '#f2b134', l: '#fbe08a' },
    rows: ['....y....', '.y..y..y.', '..yyyyy..', '..yllly..', 'yyyllllyyy', '..yllly..', '..yyyyy..', '.y..y..y.', '....y....'],
  },
  book: {
    pal: { b: '#4a7fc1', d: '#3d6aa3', p: '#f7f1e3' },
    rows: ['bbbbbbbbb', 'bpppppppb', 'bpddddppb', 'bpppppppb', 'bpddpppbb', 'bpppppppb', 'bbbbbbbbb'],
  },
};

function drawIcon(g: CanvasRenderingContext2D, name: string, x: number, y: number, s: number) {
  const ic = ICONS[name];
  ic.rows.forEach((row, j) =>
    [...row].forEach((c, i) => {
      const col = ic.pal[c];
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x + i * s, y + j * s, s, s);
    }),
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hh, r);
  g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draw the share card (room at 4× + footer) into a new canvas. */
export function buildShareCard(ctx: Ctx): HTMLCanvasElement {
  const info = shareInfo(ctx);
  const lines = shareCardLines(info);
  const s = ctx.store.get();
  const now = ctx.now();
  const mode = s.active ? 'studying' : 'idle';
  const src = renderOffscreen(sceneFor(s, now, { mode }));
  const RW = ROOM_W * SCALE;
  const RH = ROOM_H * SCALE;
  const W = RW + PAD * 2;
  const Hh = RH + PAD * 2 + FOOT;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d')!;
  // background: deep cozy purple with a warm glow
  const bg = g.createLinearGradient(0, 0, 0, Hh);
  bg.addColorStop(0, '#2a2638');
  bg.addColorStop(1, '#17151f');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, Hh);
  const glow = g.createRadialGradient(W / 2, PAD + RH, 40, W / 2, PAD + RH, W * 0.7);
  glow.addColorStop(0, 'rgba(242,177,52,.16)');
  glow.addColorStop(1, 'rgba(242,177,52,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, Hh);
  // room, crisp, in a rounded frame
  g.save();
  roundRect(g, PAD - 6, PAD - 6, RW + 12, RH + 12, 22);
  g.fillStyle = '#463f55';
  g.fill();
  roundRect(g, PAD, PAD, RW, RH, 16);
  g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, ROOM_W, ROOM_H, PAD, PAD, RW, RH);
  g.restore();

  // footer
  const fy = PAD * 2 + RH;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#f3ead8';
  g.font = `800 46px ${FONT}`;
  let title = lines.title;
  while (g.measureText(title).width > W * 0.58 && title.length > 4) title = title.slice(0, -2) + '…';
  g.fillText(title, PAD, fy + 52);
  // stats with pixel icons
  g.font = `700 28px ${FONT}`;
  let x = PAD;
  const sy = fy + 104;
  const stat = (icon: string, text: string, color: string) => {
    drawIcon(g, icon, x, sy - 30, 4);
    x += 46;
    g.fillStyle = color;
    g.fillText(text, x, sy);
    x += g.measureText(text).width + 30;
  };
  stat('clock', lines.stats[0], '#f3ead8');
  stat('flame', lines.stats[1], '#f2a134');
  stat('sun', lines.sim, '#a79fb5');
  // wordmark
  g.textAlign = 'right';
  g.fillStyle = '#f2b134';
  g.font = `800 32px ${FONT}`;
  g.fillText('Study Buddy', W - PAD, fy + 48);
  const wmW = g.measureText('Study Buddy').width;
  drawIcon(g, 'book', W - PAD - wmW - 50, fy + 22, 4);
  g.fillStyle = '#a79fb5';
  g.font = `600 20px ${FONT}`;
  g.fillText(prettyUrl(appBase()), W - PAD, fy + 78);
  g.textAlign = 'left';
  return c;
}

function dataUrlToFile(url: string, name: string): File {
  const [head, b64] = url.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function showLink(url: string) {
  const input = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Visit link', class: 'share-link' });
  openModal({
    title: 'Your visit link',
    icon: '🔗',
    body: [h('p', null, 'Anyone with this link can peek into your room (read-only).'), input],
    actions: [{ label: 'Done', kind: 'primary', autofocus: true }],
  });
  requestAnimationFrame(() => input.select());
}

export async function copyVisitLink(ctx: Ctx) {
  const url = myVisitUrl(ctx);
  if (await copy(url)) toast('Visit link copied — send it to a friend!', '🔗');
  else showLink(url);
}

/** Share a picture of my room + a visit link (Web Share sheet, or download + copy link). */
export async function shareRoom(ctx: Ctx) {
  const info = shareInfo(ctx);
  const url = myVisitUrl(ctx);
  const text = shareText(info);
  let file: File | null = null;
  try {
    file = dataUrlToFile(buildShareCard(ctx).toDataURL('image/png'), `${info.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'my'}-study-room.png`);
  } catch (e) {
    console.warn('[share] card failed', e);
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (file && nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: 'My study room', text: `${text}\n${url}` });
      return;
    }
    if (!file && nav.share) {
      await nav.share({ title: 'My study room', text, url });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // user closed the sheet
  }
  // fallback: download the picture and copy the link
  if (file) {
    const a = h('a', { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  if (await copy(url)) toast(file ? 'Saved your room picture & copied the visit link' : 'Visit link copied', '📤', 5000);
  else showLink(url);
}
