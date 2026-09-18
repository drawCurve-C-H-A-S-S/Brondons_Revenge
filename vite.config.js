import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  assetsInclude: ['**/*.glb', '**/*.obj', '**/*.fbx', '**/*.gltf', '**/*.bin'],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
