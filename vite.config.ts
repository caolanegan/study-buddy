import { defineConfig } from 'vite';

// Relative base so the build works from the GitHub Pages sub-path (/study-buddy/).
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  test: { environment: 'node' },
} as never);
