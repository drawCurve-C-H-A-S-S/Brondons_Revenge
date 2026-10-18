import * as THREE from 'three';
import { createStarfield, type Starfield } from './starfield.js';

let starfieldRenderer: THREE.WebGLRenderer | null = null;
let starfieldScene: THREE.Scene | null = null;
let starfieldCamera: THREE.PerspectiveCamera | null = null;
let starfield: Starfield | null = null;
let starfieldRafId = 0;

export function startPauseStarfield(container: HTMLElement) {
  stopPauseStarfield();
  container.classList.add('active');

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;

  starfieldRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  starfieldRenderer.setSize(width, height);
  starfieldRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  starfieldRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  starfieldRenderer.toneMappingExposure = 1.0;
  container.appendChild(starfieldRenderer.domElement);

  starfieldScene = new THREE.Scene();
  starfieldCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  starfieldCamera.position.set(0, 0, 0);

  starfield = createStarfield({
    scene: starfieldScene,
    nebulaOpacity: 1.0,
    starCount: 650,
    glowOpacity: 0.15,
    scale: 1.0,
    sizeScale: 1.0,
    dither: false,
  });

  const startTime = performance.now() * 0.001;
  const render = () => {
    if (!starfieldRenderer || !starfieldScene || !starfieldCamera || !starfield) return;
    starfieldRafId = requestAnimationFrame(render);
    const time = performance.now() * 0.001 - startTime;
    starfield.update(time);
    starfieldRenderer.render(starfieldScene, starfieldCamera);
  };
  render();
}

export function stopPauseStarfield() {
  if (starfieldRafId) {
    cancelAnimationFrame(starfieldRafId);
    starfieldRafId = 0;
  }
  if (starfield) {
    starfield.dispose();
    starfield = null;
  }
  if (starfieldRenderer) {
    starfieldRenderer.dispose();
    starfieldRenderer.domElement.remove();
    starfieldRenderer = null;
  }
  starfieldScene = null;
  starfieldCamera = null;
  document.getElementById('pause-starfield')?.classList.remove('active');
  document.getElementById('scene-starfield')?.classList.remove('active');
}
