import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import { createScene as createScene1 } from './scenes/scene1.js';
import { createScene as createScene2 } from './scenes/scene2.js';
import { createScene as createScene3 } from './scenes/scene3.js';
import { loadCharacter } from './scripts/characterManager.js';
import type { Player } from './scripts/player.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- Audio Manager stub ---
const audioManager = null;

// --- Scene Management ---
let currentSceneData: any = null;
let activeScene: THREE.Scene | null = null;
let activeCamera: THREE.PerspectiveCamera | null = null;
let updatePhysics: ((dt: number) => void) | null = null;
let cutsceneManager: any = null;
let lastSplinePoint: THREE.Vector3 | null = null;
let transitionTimer: ReturnType<typeof setTimeout> | null = null;
let creditsTimer: ReturnType<typeof setTimeout> | null = null;

// --- Global Character (persists across scenes) ---
let globalCharacter: Awaited<ReturnType<typeof loadCharacter>> = null;
let currentPlayer: Player | null = null;

// --- View toggle (first-person / third-person) ---
let isThirdPerson = true;
const THIRD_PERSON_DIST = 3.0;
const THIRD_PERSON_HEIGHT = 0.5;

// --- Controls ---
let orbitControls: OrbitControls | null = null;

function initializeControls() {
  orbitControls = new OrbitControls(activeCamera!, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.target.set(0, 1, 0);
  orbitControls.enabled = false;
}

// --- Initialize App ---
async function initializeApp() {
  console.log('Loading character model...');
  globalCharacter = await loadCharacter();
  if (globalCharacter) {
    console.log('Character loaded successfully');
  } else {
    console.warn('Failed to load character, continuing without character');
  }
  loadScene1();
  initializeControls();
  setupViewToggle();
}

// --- View toggle ---
function setupViewToggle() {
  const toggleBtn = document.getElementById('view-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleView);
  }
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'KeyV' && currentPlayer && currentPlayer.isEnabled()) {
      toggleView();
    }
  });
}

function toggleView() {
  isThirdPerson = !isThirdPerson;
  const btn = document.getElementById('view-toggle-btn');
  if (btn) btn.textContent = isThirdPerson ? '1st Person' : '3rd Person';
}

// --- Load Scene 1 ---
function loadScene1() {
  currentSceneData = createScene1({ audioManager });
  activeScene = currentSceneData.scene;
  activeCamera = currentSceneData.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = currentSceneData.cutsceneManager;
  lastSplinePoint = currentSceneData.lastSplinePoint;

  if (!currentSceneData.camera) {
    activeCamera!.position.set(5, 5, 5);
    activeCamera!.lookAt(0, 0, 0);
  }

  if (cutsceneManager) {
    cutsceneManager.play('cutscene_1788121916257');
    const skipBtn = document.getElementById('skip-btn')!;
    skipBtn.classList.remove('hidden');

    cutsceneManager.onStateChange = (state: string) => {
      if (state === 'stopped' && lastSplinePoint) {
        activeCamera!.position.copy(lastSplinePoint);
        orbitControls!.target.set(0, 15, 0);
        orbitControls!.enabled = true;
        skipBtn.classList.add('hidden');
        showCredits();
      }
    };

    skipBtn.addEventListener('click', () => {
      skipBtn.classList.add('hidden');
      if (cutsceneManager) cutsceneManager.stop();
      if (lastSplinePoint) {
        activeCamera!.position.copy(lastSplinePoint);
        orbitControls!.target.set(0, 15, 0);
        orbitControls!.enabled = true;
      }
      if (creditsTimer) { clearTimeout(creditsTimer); creditsTimer = null; }
      const creditsOverlay = document.getElementById('credits-overlay')!;
      creditsOverlay.classList.add('hidden');
      showMenuButtons();
    });
  }
}

// --- Credits and menu ---
function showCredits() {
  const creditsOverlay = document.getElementById('credits-overlay')!;
  creditsOverlay.classList.remove('hidden');
  creditsTimer = setTimeout(() => {
    creditsTimer = null;
    creditsOverlay.classList.add('hidden');
    showMenuButtons();
  }, 12000);
}

let menuButtonsShown = false;

function showMenuButtons() {
  const menuButtons = document.getElementById('menu-buttons')!;
  menuButtons.classList.remove('hidden');
  if (menuButtonsShown) return;
  menuButtonsShown = true;

  document.getElementById('play-btn')!.addEventListener('click', () => {
    menuButtons.classList.add('hidden');
    transitionToScene2();
  });
  document.getElementById('quit-btn')!.addEventListener('click', () => {
    menuButtons.classList.add('hidden');
    if (orbitControls) orbitControls.enabled = true;
  });
}

function transitionToScene2() {
  console.log('Starting transition to scene 2');
  const fadeOverlay = document.getElementById('fade-overlay')!;
  fadeOverlay.classList.remove('hidden');

  const zoomDuration = 1500;
  const startPos = activeCamera!.position.clone();
  const endPos = new THREE.Vector3(0, 15, 0);
  const startTime = performance.now();

  function zoomAnimation() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / zoomDuration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    activeCamera!.position.lerpVectors(startPos, endPos, eased);
    activeCamera!.lookAt(0, 15, 0);
    if (progress < 1) {
      requestAnimationFrame(zoomAnimation);
    } else {
      fadeOverlay.classList.add('active');
      setTimeout(() => {
        try { loadScene2(); } catch (e) { console.error('Error loading scene 2:', e); }
        fadeOverlay.classList.remove('active');
        setTimeout(() => { fadeOverlay.classList.add('hidden'); }, 1500);
      }, 1500);
    }
  }
  zoomAnimation();
}

function loadScene2() {
  console.log('Loading scene 2...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene2({ audioManager });
  currentSceneData = sceneData;
  activeScene = currentSceneData.scene;
  activeCamera = currentSceneData.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = currentSceneData.cutsceneManager;
  currentPlayer = currentSceneData.player;

  if (globalCharacter && activeScene) {
    if (globalCharacter.model.parent !== activeScene) {
      globalCharacter.model.parent?.remove(globalCharacter.model);
      activeScene.add(globalCharacter.model);
    }
  }

  orbitControls!.object = activeCamera!;
  orbitControls!.enabled = false;
  orbitControls!.update();

  if (currentSceneData.setDoorTrigger) {
    currentSceneData.setDoorTrigger(() => { transitionToScene3(); });
  }
  renderer.render(activeScene!, activeCamera!);
}

function loadScene3() {
  console.log('Loading scene 3...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene3({ audioManager });
  currentSceneData = sceneData;
  activeScene = currentSceneData.scene;
  activeCamera = currentSceneData.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = currentSceneData.cutsceneManager;
  currentPlayer = currentSceneData.player;

  if (globalCharacter && activeScene) {
    if (globalCharacter.model.parent !== activeScene) {
      globalCharacter.model.parent?.remove(globalCharacter.model);
      activeScene.add(globalCharacter.model);
    }
  }

  orbitControls!.object = activeCamera!;
  orbitControls!.enabled = false;
  orbitControls!.update();

  if (currentSceneData.setBackTrigger) {
    currentSceneData.setBackTrigger(() => { transitionBackToScene2(); });
  }
  if (currentSceneData.setForwardTrigger) {
    currentSceneData.setForwardTrigger(() => { console.log('Forward door triggered - future scene'); });
  }
  renderer.render(activeScene!, activeCamera!);
  console.log('Scene 3 loaded - passageway');
}

function transitionToScene3() {
  console.log('Transitioning to scene 3');
  try { loadScene3(); } catch (e) { console.error('Error loading scene 3:', e); }
}

function transitionBackToScene2() {
  console.log('Returning to scene 2 (skip wake)');
  try {
    const sceneData = createScene2({ audioManager, skipWake: true });
    currentSceneData = sceneData;
    activeScene = currentSceneData.scene;
    activeCamera = currentSceneData.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    updatePhysics = currentSceneData.updatePhysics;
    cutsceneManager = currentSceneData.cutsceneManager;
    currentPlayer = currentSceneData.player;

    if (globalCharacter && activeScene) {
      if (globalCharacter.model.parent !== activeScene) {
        globalCharacter.model.parent?.remove(globalCharacter.model);
        activeScene.add(globalCharacter.model);
      }
    }

    orbitControls!.object = activeCamera!;
    orbitControls!.enabled = false;
    orbitControls!.update();

    if (currentSceneData.setDoorTrigger) {
      currentSceneData.setDoorTrigger(() => { transitionToScene3(); });
    }
    renderer.render(activeScene!, activeCamera!);
    console.log('Scene 2 loaded - player at door');
  } catch (e) {
    console.error('Error in transitionBackToScene2:', e);
  }
}

// --- Start ---
initializeApp();

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  if (activeCamera) {
    activeCamera.aspect = w / h;
    activeCamera.updateProjectionMatrix();
  }
});

// --- Game loop ---
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps')!;
let frameCount = 0;
let fpsTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // FPS counter
  frameCount++;
  fpsTime += delta;
  if (fpsTime >= 0.5) {
    fpsEl.textContent = `FPS: ${Math.round(frameCount / fpsTime)}`;
    frameCount = 0;
    fpsTime = 0;
  }

  // Physics
  if (updatePhysics) updatePhysics(delta);

  // Cutscenes
  if (cutsceneManager) cutsceneManager.update(delta);

  // Character animations + view
  if (globalCharacter && currentPlayer && currentPlayer.isEnabled() && activeCamera) {
    const baseState = currentPlayer.getState();
    globalCharacter.update(delta, currentPlayer.body.position, baseState, isThirdPerson, currentPlayer.radius);

    // Third-person camera offset (pull camera back behind player)
    if (isThirdPerson) {
      const yaw = baseState.yaw;
      activeCamera.position.x += Math.sin(yaw) * THIRD_PERSON_DIST;
      activeCamera.position.z += Math.cos(yaw) * THIRD_PERSON_DIST;
      activeCamera.position.y += THIRD_PERSON_HEIGHT;
    }
  }

  // Controls
  if (orbitControls && orbitControls.enabled) orbitControls.update();

  // Render
  if (activeScene && activeCamera) {
    renderer.render(activeScene, activeCamera);
  }
}

animate();
