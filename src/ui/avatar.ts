// Tiny front-facing pixel head for leaderboard rows, drawn from a friend's look.
import type { Appearance, HairStyle } from '../core/profile';
import { hairColorOf, skinOf, topColorOf } from '../core/profile';

const S = 16;

type Px = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Px[] => {
  const out: Px[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
};

/** Hair pixels per style (face spans x 4..11, y 4..11). */
function hairPixels(style: HairStyle): { back: Px[]; front: Px[] } {
  const cap = rect(4, 3, 11, 4).concat([[3, 4], [12, 4], [3, 5], [12, 5]]);
  const fringe: Px[] = [[4, 5], [5, 5], [10, 5], [11, 5]];
  switch (style) {
    case 'buzz':
      return { back: [], front: rect(4, 3, 11, 3).concat([[4, 4], [11, 4]]) };
    case 'curly':
      return {
        back: [],
        front: rect(3, 2, 12, 4).concat([[4, 1], [6, 1], [8, 1], [10, 1], [2, 4], [13, 4], [3, 5], [12, 5], [2, 6], [13, 6], [4, 5], [6, 5], [9, 5], [11, 5]]),
      };
    case 'long':
      return { back: rect(3, 5, 3, 13).concat(rect(12, 5, 12, 13), rect(2, 8, 2, 13), rect(13, 8, 13, 13)), front: cap.concat(fringe) };
    case 'bob':
      return { back: rect(3, 5, 3, 10).concat(rect(12, 5, 12, 10), [[2, 9], [13, 9], [2, 10], [13, 10]]), front: cap.concat(rect(4, 5, 7, 5), [[11, 5]]) };
    case 'bun':
      return { back: [], front: cap.concat(fringe, rect(6, 0, 9, 2), [[5, 1], [10, 1]]) };
    case 'ponytail':
      return { back: rect(12, 5, 13, 6).concat(rect(13, 7, 14, 11), [[13, 12]]), front: cap.concat(fringe) };
    case 'braids':
      return { back: rect(3, 5, 3, 14).concat(rect(12, 5, 12, 14), [[2, 15], [13, 15]]), front: cap.concat(fringe) };
    case 'afro':
      return {
        back: rect(1, 4, 1, 9).concat(rect(2, 2, 2, 10), rect(13, 2, 13, 10), rect(14, 4, 14, 9)),
        front: rect(4, 0, 11, 0).concat(rect(3, 1, 12, 4), rect(3, 5, 3, 8), rect(12, 5, 12, 8), [[4, 5], [11, 5]]),
      };
    case 'spiky':
      return { back: [], front: rect(4, 3, 11, 4).concat([[4, 1], [4, 2], [6, 2], [7, 1], [7, 2], [9, 2], [10, 1], [10, 2], [12, 3], [3, 4], [12, 4], [3, 5], [12, 5], [4, 5], [11, 5]]) };
    default:
      return { back: [], front: cap.concat(fringe, [[6, 5]]) };
  }
}

export function drawAvatar(c: CanvasRenderingContext2D, look: Appearance) {
  const skin = skinOf(look.skin).colors;
  const hair = hairColorOf(look.hairColor).colors;
  const top = topColorOf(look.top).colors;
  const put = (pts: Px[], col: string) => {
    c.fillStyle = col;
    for (const [x, y] of pts) c.fillRect(x, y, 1, 1);
  };
  c.clearRect(0, 0, S, S);
  const hp = hairPixels(look.hair);
  put(hp.back, hair[1]);
  // shoulders + neck
  put(rect(2, 14, 13, 15), top[0]);
  put(rect(3, 13, 12, 13), top[0]);
  put([[2, 14], [13, 14]], top[1]);
  put(rect(6, 12, 9, 13), skin[1]);
  // face
  put(rect(4, 4, 11, 11), skin[0]);
  put(rect(5, 12, 10, 12), skin[0]);
  put([[3, 7], [3, 8], [12, 7], [12, 8]], skin[1]); // ears
  put(rect(5, 11, 10, 11), skin[0]);
  // eyes, cheeks, smile
  put([[6, 8], [9, 8], [6, 7], [9, 7]], '#2a2230');
  put([[5, 9], [10, 9]], 'rgba(224,116,92,.45)');
  put([[7, 10], [8, 10]], skin[1]);
  put(hp.front, hair[0]);
  put(hp.front.filter(([x, y]) => (x + y) % 5 === 0), hair[2]);
}

export function avatarCanvas(look: Appearance | null | undefined, label = ''): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  cv.className = 'avatar';
  cv.setAttribute('aria-hidden', 'true');
  if (label) cv.title = label;
  const c = cv.getContext('2d');
  if (c && look) drawAvatar(c, look);
  return cv;
}
