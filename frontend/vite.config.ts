import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: { entry: 'src/tv-guide.ts', formats: ['es'], fileName: () => 'tv-guide.js' },
    outDir: '../custom_components/tv_guide/frontend',
    emptyOutDir: true,
  },
  test: {
    environment: 'happy-dom',
  },
});
