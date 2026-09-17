import * as THREE from 'three';
import { createRenderer } from './core/renderer';
import { createCamera } from './core/camera';
import { createControls } from './core/controls';
import * as exampleScene from './scenes/exampleScene';
import { Player } from './scripts/player';

// --- Bootstrap ---
const app = document.getElementById('app')!;

// Create a canvas element
const canvas = document.createElement('canvas');
app.appendChild(canvas);

// Core setup
const renderer = createRenderer(canvas);
const camera = createCamera();
const controls = createControls(camera, renderer.domElement);

// Build the example scene
const scene = exampleScene.build();

// Example player (not added to scene in this demo, just shows the pattern)
const player = new Player();
// scene.add(player.mesh);  // Uncomment to add the player capsule to the scene

// --- Resize handling ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

// --- Animation loop ---
const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();

  // Update controls
  controls.update();

  // Update scene animations
  exampleScene.update(dt);

  // Update player (if active)
  // player.update(dt);

  // Render
  renderer.render(scene, camera);
}

animate();

console.log("Brondon's Revenge -- running");
