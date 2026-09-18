import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  assetsInclude: ['**/*.glb', '**/*.obj', '**/*.fbx'],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
