import { defineConfig } from 'vite';

// Pre-bundle every Three.js entry up front. A dependency discovered late (for
// example by a lazily imported scene) makes Vite re-optimize mid-session, and
// the page then holds two copies of Three.js: GLTF meshes stop passing
// `instanceof THREE.Mesh`, so custom shader materials are never applied.
const THREE_ADDONS = [
  'controls/OrbitControls',
  'controls/TransformControls',
  'environments/RoomEnvironment',
  'loaders/DRACOLoader',
  'loaders/GLTFLoader',
  'loaders/OBJLoader',
  'math/Capsule',
  'objects/Reflector',
  'postprocessing/EffectComposer',
  'postprocessing/OutputPass',
  'postprocessing/Pass',
  'postprocessing/RenderPass',
  'postprocessing/UnrealBloomPass',
  'utils/BufferGeometryUtils',
  'utils/SkeletonUtils',
].map(path => `three/addons/${path}.js`);

export default defineConfig({
  root: 'src',
  base: './',
  assetsInclude: ['**/*.glb', '**/*.obj', '**/*.fbx', '**/*.gltf', '**/*.bin'],
  resolve: {
    dedupe: ['three'],
  },
  optimizeDeps: {
    entries: ['index.html', 'finale-preview.html'],
    include: ['three', ...THREE_ADDONS, 'cannon-es', 'pathfinding', 'three-bvh-csg'],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
