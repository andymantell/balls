import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-directory (e.g. GitHub Pages).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1024,
  },
});
