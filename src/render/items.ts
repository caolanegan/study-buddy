import type { Painter } from './pixel';
import type { Sky } from './outside';
import type { Pose } from './character';
import type { Mode, RenderScene } from './scene';

/**
 * Draw order:
 *  wall → floor → (desk) → desk → [night tint] → (window) → screen
 *  → behind-char → (character, chair) → front → glow → top
 * 'screen' and 'glow' are drawn after the night tint, so they stay bright.
 * 'behind-char' and 'front' are tinted with the character.
 */
export type Layer = 'wall' | 'floor' | 'desk' | 'screen' | 'behind-char' | 'front' | 'glow' | 'top';

export interface ArtCtx {
  /** 0 = day, 1 = night */
  night: number;
  sky: Sky;
  pose: Pose;
  mode: Mode;
}

export interface ItemArt {
  layer: Layer;
  draw(p: Painter, s: RenderScene, ctx: ArtCtx): void;
}

export const ITEM_ART: Record<string, ItemArt[]> = {
  poster: [
    {
      layer: 'wall',
      draw(p) {
        p.rect(176, 12, 24, 32, '#26314a');
        p.rect(177, 13, 22, 30, '#2f3e60');
        p.disc(188, 24, 5, '#f2b134');
        p.rect(180, 32, 16, 6, '#3a6b55');
        p.rect(183, 29, 10, 3, '#4f8a6e');
        p.rect(180, 39, 16, 2, '#e8d7b8');
      },
    },
  ],
  rug: [
    {
      layer: 'floor',
      draw(p) {
        p.ellipse(152, 132, 52, 10, '#3f6f8f');
        p.ellipse(152, 132, 46, 8, '#e8c76a');
        p.ellipse(152, 132, 40, 6.5, '#3f6f8f');
        p.ellipse(152, 132, 30, 4, '#5b8fb0');
      },
    },
  ],
  'dual-monitor': [
    {
      layer: 'desk',
      draw(p) {
        p.rect(174, 52, 32, 26, '#24232d');
        p.rect(188, 78, 4, 4, '#24232d');
        p.rect(184, 81, 12, 1, '#1a1a22');
      },
    },
    {
      layer: 'screen',
      draw(p) {
        p.rect(176, 54, 28, 22, '#1e3a32');
        for (let i = 0; i < 6; i++) {
          const h = 4 + ((i * 7 + 3) % 11);
          p.rect(179 + i * 4, 73 - h, 3, h, i === 5 ? '#f2b134' : '#5fbf77');
        }
      },
    },
  ],
  'desk-lamp': [
    {
      layer: 'desk',
      draw(p) {
        p.rect(96, 80, 10, 2, '#2d2d35');
        p.line(100, 80, 96, 66, '#2d2d35');
        p.line(96, 66, 104, 60, '#2d2d35');
        p.rect(102, 58, 8, 4, '#3f6f8f');
        p.rect(103, 62, 6, 1, '#ffe9a8');
      },
    },
    {
      layer: 'glow',
      draw(p, _s, { night }) {
        p.g.globalCompositeOperation = 'lighter';
        p.glow(106, 74, 46, [255, 190, 110], 0.08 + 0.32 * night);
        p.g.globalCompositeOperation = 'source-over';
      },
    },
  ],
  cat: [
    {
      layer: 'front',
      draw(p, s) {
        const cx = 196;
        const cy = 132;
        const c = '#e08a3c';
        p.ellipse(cx, cy, 10, 4, c);
        p.disc(cx - 9, cy - 3, 4, c);
        p.rect(cx - 13, cy - 8, 2, 2, c);
        p.rect(cx - 7, cy - 8, 2, 2, c);
        p.rect(cx - 11, cy - 3, 2, 1, '#3a2a20');
        p.rect(cx - 7, cy - 3, 2, 1, '#3a2a20');
        for (let i = -6; i <= 6; i += 4) p.rect(cx + i, cy - 3, 2, 1, '#c26f2a');
        const tail = Math.round(Math.sin(s.time * 2) * 2);
        p.rect(cx + 9, cy + 1, 3, 2, c);
        p.rect(cx + 12, cy - 1 + tail, 2, 3, c);
      },
    },
  ],
};
