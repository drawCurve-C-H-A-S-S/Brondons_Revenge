import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createScene as createScene1 } from './scenes/scene1.js';
import { createScene as createScene2 } from './scenes/scene2.js';
import { createScene as createScene3 } from './scenes/scene3.js';
import { createScene as createScene4 } from './scenes/scene4.js';
import { createScene as createScene5 } from './scenes/scene5.js';
import { createScene as createScene6 } from './scenes/scene6.js';
import { loadCharacter } from './scripts/characterManager.js';
import type { Player, PlayerTransitionState } from './scripts/player.js';
import { PLAYER_MAX_HEALTH } from './scripts/player.js';
import { NPCEnemyManager } from './scripts/npc-enemy-robots.js';
import { PistolController } from './scripts/pistol.js';

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
let scene1Data: any = null;
let activeScene: THREE.Scene | null = null;
let activeCamera: THREE.PerspectiveCamera | null = null;
let updatePhysics: ((dt: number, thirdPerson?: boolean) => void) | null = null;
let cutsceneManager: any = null;
let lastSplinePoint: THREE.Vector3 | null = null;
let transitionTimer: ReturnType<typeof setTimeout> | null = null;
let creditsTimer: ReturnType<typeof setTimeout> | null = null;

// --- Global Character (persists across scenes) ---
let globalCharacter: Awaited<ReturnType<typeof loadCharacter>> = null;
let currentPlayer: Player | null = null;

// --- NPC Enemy Manager (persists across scenes) ---
const npcManager = new NPCEnemyManager();

// --- Crowbar pickup (scene4 chest, persists once collected) ---
let hasCrowbar = false;

// --- View toggle (first-person / third-person) ---
let isThirdPerson = true;
const THIRD_PERSON_DIST = 1.5;
const THIRD_PERSON_HEIGHT = 0.3;
const THIRD_PERSON_RIGHT = 0.7;

const pistol = new PistolController(() => ({
  scene: activeScene, camera: activeCamera, world: currentSceneData?.physicsWorld ?? null,
  player: currentPlayer, character: globalCharacter?.model ?? null,
  thirdPerson: isThirdPerson, targets: npcManager.getDamageTargets(),
  weaponAnimation: globalCharacter?.weapon,
}));

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
  scene1Data = currentSceneData;
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
  currentSceneData?.dispose?.();
  npcManager.enterScene('scene2', sceneData);
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

  if (currentSceneData.setDoorTrigger) {
    currentSceneData.setDoorTrigger((state: PlayerTransitionState) => { transitionToScene3(state); });
  }
  renderer.render(activeScene!, activeCamera!);
}

function loadScene3(entryState: PlayerTransitionState) {
  console.log('Loading scene 3...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene3({ audioManager, entryState });
  npcManager.enterScene('scene3', sceneData);
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
  globalCharacter?.setFacing(currentPlayer!.getState().yaw);
  updatePlayerView(0);

  if (currentSceneData.setBackTrigger) {
    currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene2(state); });
  }
  if (currentSceneData.setForwardTrigger) {
    currentSceneData.setForwardTrigger(() => { transitionToScene4(); });
  }
  if (currentSceneData.setLeftTrigger) {
    currentSceneData.setLeftTrigger((state: PlayerTransitionState) => { transitionToScene5(state); });
  }
  if (currentSceneData.setRightTrigger) {
    currentSceneData.setRightTrigger((state: PlayerTransitionState) => { transitionToScene6(state); });
  }
  renderer.render(activeScene!, activeCamera!);
  console.log('Scene 3 loaded - passageway');
}

function transitionToScene3(entryState: PlayerTransitionState) {
  console.log('Transitioning to scene 3');
  try { loadScene3(entryState); } catch (e) { console.error('Error loading scene 3:', e); }
}

function transitionBackToScene2(entryState: PlayerTransitionState) {
  console.log('Returning to scene 2 (skip wake)');
  try {
    const sceneData = createScene2({ audioManager, skipWake: true, entryState });
    npcManager.enterScene('scene2', sceneData);
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
    globalCharacter?.setFacing(currentPlayer!.getState().yaw);
    updatePlayerView(0);

    if (currentSceneData.setDoorTrigger) {
      currentSceneData.setDoorTrigger((state: PlayerTransitionState) => { transitionToScene3(state); });
    }
    renderer.render(activeScene!, activeCamera!);
    console.log('Scene 2 loaded - player at door');
  } catch (e) {
    console.error('Error in transitionBackToScene2:', e);
  }
}

function loadScene4(entryState: PlayerTransitionState) {
  console.log('Loading scene 4...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene4({
    audioManager, entryState, chestOpened: hasCrowbar,
    onChestCollected: () => { hasCrowbar = true; },
  });
  npcManager.enterScene('scene4', sceneData);
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
  globalCharacter?.setFacing(currentPlayer!.getState().yaw);
  updatePlayerView(0);

  if (currentSceneData.setBackTrigger) {
    currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene3(state); });
  }
  renderer.render(activeScene!, activeCamera!);
  console.log('Scene 4 loaded - computer room');
}

function transitionToScene4() {
  console.log('Transitioning to scene 4');
  // Capture player state for transition - scene3's forward door is at -Z (z = -10)
  // Use yaw: 0 so the player's position is preserved correctly through the transition
  if (currentPlayer) {
    const state = currentPlayer.captureTransition({ x: 0, y: 0, z: -10, yaw: 0 });
    try { loadScene4(state); } catch (e) { console.error('Error loading scene 4:', e); }
  }
}

function transitionBackToScene3(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 4');
  try {
    const sceneData = createScene3({ audioManager, entryState, entryDoor: 'back' });
    npcManager.enterScene('scene3', sceneData);
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
    globalCharacter?.setFacing(currentPlayer!.getState().yaw);
    updatePlayerView(0);

    if (currentSceneData.setBackTrigger) {
      currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene2(state); });
    }
    if (currentSceneData.setForwardTrigger) {
      currentSceneData.setForwardTrigger(() => { transitionToScene4(); });
    }
    if (currentSceneData.setLeftTrigger) {
      currentSceneData.setLeftTrigger((state: PlayerTransitionState) => { transitionToScene5(state); });
    }
    if (currentSceneData.setRightTrigger) {
      currentSceneData.setRightTrigger((state: PlayerTransitionState) => { transitionToScene6(state); });
    }
    renderer.render(activeScene!, activeCamera!);
    console.log('Scene 3 loaded - return from scene 4');
  } catch (e) {
    console.error('Error in transitionBackToScene3:', e);
  }
}

function loadScene5(entryState: PlayerTransitionState) {
  console.log('Loading scene 5...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene5({ audioManager, entryState });
  npcManager.enterScene('scene5', sceneData);
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
  globalCharacter?.setFacing(currentPlayer!.getState().yaw);
  updatePlayerView(0);

  if (currentSceneData.setBackTrigger) {
    currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene3FromLeft(state); });
  }
  renderer.render(activeScene!, activeCamera!);
  console.log('Scene 5 loaded - cargo hold');
}

function transitionToScene5(entryState: PlayerTransitionState) {
  console.log('Transitioning to scene 5');
  try { loadScene5(entryState); } catch (e) { console.error('Error loading scene 5:', e); }
}

function transitionBackToScene3FromLeft(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 5');
  try {
    const sceneData = createScene3({ audioManager, entryState, entryDoor: 'left' });
    npcManager.enterScene('scene3', sceneData);
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
    globalCharacter?.setFacing(currentPlayer!.getState().yaw);
    updatePlayerView(0);

    if (currentSceneData.setBackTrigger) {
      currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene2(state); });
    }
    if (currentSceneData.setForwardTrigger) {
      currentSceneData.setForwardTrigger(() => { transitionToScene4(); });
    }
    if (currentSceneData.setLeftTrigger) {
      currentSceneData.setLeftTrigger((state: PlayerTransitionState) => { transitionToScene5(state); });
    }
    if (currentSceneData.setRightTrigger) {
      currentSceneData.setRightTrigger((state: PlayerTransitionState) => { transitionToScene6(state); });
    }
    renderer.render(activeScene!, activeCamera!);
    console.log('Scene 3 loaded - return from scene 5');
  } catch (e) {
    console.error('Error in transitionBackToScene3FromLeft:', e);
  }
}

function loadScene6(entryState: PlayerTransitionState) {
  console.log('Loading scene 6...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene6({ audioManager, entryState });
  npcManager.enterScene('scene6', sceneData);
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
  globalCharacter?.setFacing(currentPlayer!.getState().yaw);
  updatePlayerView(0);

  if (currentSceneData.setBackTrigger) {
    currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene3FromRight(state); });
  }
  renderer.render(activeScene!, activeCamera!);
  console.log('Scene 6 loaded - engine room');
}

function transitionToScene6(entryState: PlayerTransitionState) {
  console.log('Transitioning to scene 6');
  try { loadScene6(entryState); } catch (e) { console.error('Error loading scene 6:', e); }
}

function transitionBackToScene3FromRight(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 6');
  try {
    const sceneData = createScene3({ audioManager, entryState, entryDoor: 'right' });
    npcManager.enterScene('scene3', sceneData);
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
    globalCharacter?.setFacing(currentPlayer!.getState().yaw);
    updatePlayerView(0);

    if (currentSceneData.setBackTrigger) {
      currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene2(state); });
    }
    if (currentSceneData.setForwardTrigger) {
      currentSceneData.setForwardTrigger(() => { transitionToScene4(); });
    }
    if (currentSceneData.setLeftTrigger) {
      currentSceneData.setLeftTrigger((state: PlayerTransitionState) => { transitionToScene5(state); });
    }
    if (currentSceneData.setRightTrigger) {
      currentSceneData.setRightTrigger((state: PlayerTransitionState) => { transitionToScene6(state); });
    }
    renderer.render(activeScene!, activeCamera!);
    console.log('Scene 3 loaded - return from scene 6');
  } catch (e) {
    console.error('Error in transitionBackToScene3FromRight:', e);
  }
}

function updatePlayerView(dt: number) {
  if (!currentPlayer?.isEnabled() || !activeCamera) return;
  // Always start from the base camera, including the first render after a scene swap.
  currentPlayer.updateCamera(0, isThirdPerson);
  const state = currentPlayer.getState();
  globalCharacter?.update(dt, currentPlayer.body.position, state, isThirdPerson, currentPlayer.radius);
  if (isThirdPerson) {
    // Forward is the direction the player faces (matches getMoveDirection's W vector).
    const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    // Pull the camera back behind the player (opposite of forward) and over one shoulder.
    activeCamera.position.addScaledVector(forward, -THIRD_PERSON_DIST);
    activeCamera.position.addScaledVector(right, THIRD_PERSON_RIGHT);
    activeCamera.position.y += THIRD_PERSON_HEIGHT;
    // Keep the same look rotation as first-person (yaw/pitch from updateCamera) so the
    // crosshair stays centered on the aim direction instead of pointing back at the player.
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
const healthFillEl = document.getElementById('health-bar-fill');
const healthLabelEl = document.getElementById('health-bar-label');
const healthBarEl = document.getElementById('health-bar');
let frameCount = 0;
let fpsTime = 0;

/** Reloads scene 2, whose wake-up sequence always spawns the player at the capsule. */
function respawnAtCapsule() {
  console.log('Player died - respawning at capsule');
  try { loadScene2(); } catch (e) { console.error('Error respawning player:', e); }
}

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

  // Health bar + death/respawn
  if (currentPlayer) {
    const health = currentPlayer.getHealth();
    const pct = Math.max(0, health / PLAYER_MAX_HEALTH);
    if (healthFillEl) {
      healthFillEl.style.width = `${pct * 100}%`;
      healthFillEl.classList.toggle('low', pct <= 0.3);
      healthFillEl.classList.toggle('mid', pct > 0.3 && pct <= 0.6);
    }
    if (healthLabelEl) healthLabelEl.textContent = `${Math.max(0, Math.ceil(health))} / ${PLAYER_MAX_HEALTH}`;
    if (currentPlayer.isEnabled() && health <= 0) respawnAtCapsule();
  }
  if (healthBarEl) {
    const inScene1 = currentSceneData === scene1Data && !currentPlayer?.isEnabled();
    const inCutscene = !!cutsceneManager;
    healthBarEl.style.display = (inScene1 || inCutscene) ? 'none' : '';
  }

  // Record pursuit before stepping the active world; retired worlds step separately.
  npcManager.update(delta);

  // Let scene4's chest know once the enemy is defeated, so it can be interacted with.
  currentSceneData?.setEnemyDefeated?.(npcManager.getStatus().state === 'DISAPPEARED');

  // Physics
  if (updatePhysics) updatePhysics(delta, isThirdPerson);

  // Cutscenes
  if (cutsceneManager) cutsceneManager.update(delta);
  const crosshair = document.getElementById('crosshair');
  if (crosshair) {
    const inScene1 = currentSceneData === scene1Data && !currentPlayer?.isEnabled();
    const inCutscene = !!cutsceneManager;
    crosshair.style.display = (inScene1 || inCutscene) ? 'none' : '';
  }

  // Character animations + view
  updatePlayerView(delta);

  pistol.update(delta);

  // Controls
  if (orbitControls && orbitControls.enabled) orbitControls.update();

  // Render
  if (activeScene && activeCamera) {
    renderer.render(activeScene, activeCamera);
  }
}

animate();
