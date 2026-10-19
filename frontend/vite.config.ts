import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: { entry: 'src/tv-guide.ts', formats: ['es'], fileName: () => 'tv-guide.js' },
    outDir: '../custom_components/tv_guide/frontend',
    emptyOutDir: true,
    // Lit is BSD-3-Clause: its notice must ship with the bundle. The file lands next to
    // tv-guide.js, so the release zip carries it.
    license: { fileName: 'THIRD_PARTY_LICENSES.md' },
  },
  test: {
    environment: 'happy-dom',
  },
});
