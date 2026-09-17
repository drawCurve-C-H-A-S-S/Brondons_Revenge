import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  assetsInclude: ['**/*.glb'],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
