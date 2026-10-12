import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Relative base so the build works from the GitHub Pages sub-path (/study-buddy/).
// Two pages: the app itself and the playground sandbox (playground.html).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        playground: resolve(import.meta.dirname, 'playground.html'),
      },
    },
  },
  test: { environment: 'node' },
} as never);
