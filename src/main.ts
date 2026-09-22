import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyTraversalCamera } from './core/camera.js';
import { createScene as createScene1 } from './scenes/scene1.js';
import { createScene as createScene2 } from './scenes/scene2.js';
import { createScene as createScene3 } from './scenes/scene3.js';
import { createScene as createScene4 } from './scenes/scene4.js';
import { createScene as createScene5 } from './scenes/scene5.js';
import { createScene as createScene6 } from './scenes/scene6.js';
import { createScene as createScene7 } from './scenes/scene7.js';
import { createScene as createScene8 } from './scenes/scene8.js';
import { createScene as createScene9 } from './scenes/scene9.js';
import { createScene as createScene10, type PuzzleState } from './scenes/scene10.js';
import { createScene as createScene11 } from './scenes/scene11.js';
import { createScene as createScene12, type PassageDestination } from './scenes/scene12.js';
import { createScene as createScene13 } from './scenes/scene13.js';
import { createScene as createScene14 } from './scenes/scene14.js';
import { createScene as createScene15 } from './scenes/scene15.js';
import { loadCharacter } from './scripts/characterManager.js';
import type { Player, PlayerTransitionState } from './scripts/player.js';
import { PLAYER_MAX_HEALTH } from './scripts/player.js';
import { NPCEnemyManager } from './scripts/npc-enemy-robots.js';
import { PistolController } from './scripts/pistol.js';
import { CrowbarController } from './scripts/crowbar.js';
import { GogglesController } from './scripts/goggles.js';
import { createCctvSystem } from './scripts/cctv.js';
import { createFirstPersonHands } from './scripts/firstPersonHands.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const cctv = createCctvSystem(renderer);

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
let scene1SkipVisible = false;
let bayGravityRestored = false;
let puzzleState: PuzzleState | undefined;
let bayBossDefeated = false;
let traversalState: PlayerTransitionState | undefined;

// --- Global Character (persists across scenes) ---
let globalCharacter: Awaited<ReturnType<typeof loadCharacter>> = null;
let currentPlayer: Player | null = null;

// --- NPC Enemy Manager (persists across scenes) ---
const npcManager = new NPCEnemyManager();

// --- Crowbar pickup (scene4 chest, persists once collected) ---
let hasCrowbar = false;
let cargoDoorUnlocked = false;
const clearedLadderCrates = new Set<string>();
const cargoAccess = () => ({ hasCrowbar, cargoDoorUnlocked, onCargoDoorOpened: () => { cargoDoorUnlocked = true; } });
const ladderAccess = () => ({ clearedCrates: clearedLadderCrates, onCrateBroken: (id: string) => { clearedLadderCrates.add(id); } });
let crowbarController: CrowbarController | null = null;
let firstPersonHands: Awaited<ReturnType<typeof createFirstPersonHands>> | null = null;

// --- View toggle (first-person / third-person) ---
let isThirdPerson = true;
const THIRD_PERSON_DIST = 1.5;
const THIRD_PERSON_HEIGHT = 0.3;
const THIRD_PERSON_RIGHT = 0.7;

const pistol = new PistolController(() => ({
  scene: activeScene, camera: activeCamera, world: currentSceneData?.physicsWorld ?? null,
  player: currentPlayer, character: globalCharacter?.model ?? null,
  thirdPerson: isThirdPerson, targets: [...npcManager.getDamageTargets(), ...(currentSceneData?.getDamageTargets?.() ?? [])],
  weaponAnimation: globalCharacter?.weapon,
  holsterOther: () => crowbarController?.holster(),
}));

const crowbar = new CrowbarController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player: currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isThirdPerson,
  hasCrowbar,
  targets: [...npcManager.getDamageTargets(), ...(currentSceneData?.getDamageTargets?.() ?? [])],
  setCharacterEquipped: (equipped: boolean) => globalCharacter?.setCrowbarEquipped(equipped),
  doorTarget: currentSceneData?.forwardDoorTarget ?? null,
  openDoor: () => { currentSceneData?.hitForwardDoor?.(); currentSceneData?.hitCargoDoor?.(); },
  holsterOther: () => pistol.holster(),
  firstPersonHands: () => firstPersonHands,
}));
crowbarController = crowbar;
const goggles = new GogglesController(() => ({
  player: currentPlayer, scene: currentSceneData,
  setCharacterEquipped: active => globalCharacter?.setGogglesEquipped(active),
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
  try {
    firstPersonHands = await createFirstPersonHands();
  } catch (error) {
    console.error('Failed to load first-person hands:', error);
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
    scene1SkipVisible = true;
    skipBtn.classList.remove('hidden');

    cutsceneManager.onStateChange = (state: string) => {
      if (state === 'stopped' && lastSplinePoint) {
        activeCamera!.position.copy(lastSplinePoint);
        orbitControls!.target.set(0, 15, 0);
        orbitControls!.enabled = true;
        scene1SkipVisible = false;
        skipBtn.classList.add('hidden');
        showCredits();
      }
    };

    skipBtn.addEventListener('click', () => {
      scene1SkipVisible = false;
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

  globalCharacter?.model.removeFromParent();
  if (currentSceneData === scene1Data) currentSceneData?.dispose?.();
  retireTraversalRoom();
  const sceneData = createScene2({ audioManager });
  enterManagedScene('scene2', sceneData);
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

  const sceneData = createScene3({ audioManager, entryState, ...cargoAccess() });
  enterManagedScene('scene3', sceneData);
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
    enterManagedScene('scene2', sceneData);
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

function loadScene4(entryState: PlayerTransitionState, entryDoor: 'back' | 'front' = 'back') {
  console.log('Loading scene 4...');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  const sceneData = createScene4({
    audioManager, entryState, entryDoor, cafeteriaUnlocked: hasCrowbar, chestOpened: hasCrowbar,
    onChestCollected: () => {
      hasCrowbar = true;
      crowbar.equip();
      const overlay = document.getElementById('crowbar-overlay');
      overlay?.classList.remove('hidden');
      window.setTimeout(() => overlay?.classList.add('hidden'), 4500);
    },
  });
  enterManagedScene('scene4', sceneData);
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
  if (currentSceneData.setForwardTrigger) {
    currentSceneData.setForwardTrigger((state: PlayerTransitionState) => { transitionToScene7(state); });
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

function loadScene7(entryState: PlayerTransitionState) {
  console.log('Loading scene 7 - cafeteria...');
  document.getElementById('skip-btn')?.classList.add('hidden');
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }
  const sceneData = createScene7({ entryState, ...ladderAccess() });
  enterManagedScene('scene7', sceneData);
  currentSceneData = sceneData;
  activeScene = sceneData.scene;
  activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics;
  cutsceneManager = sceneData.cutsceneManager;
  currentPlayer = sceneData.player;
  if (globalCharacter && activeScene) {
    if (globalCharacter.model.parent !== activeScene) {
      globalCharacter.model.parent?.remove(globalCharacter.model);
      activeScene.add(globalCharacter.model);
    }
  }
  orbitControls!.object = activeCamera;
  orbitControls!.enabled = false;
  globalCharacter?.setFacing(currentPlayer.getState().yaw);
  updatePlayerView(0);
  if (currentSceneData.setBackTrigger) {
    currentSceneData.setBackTrigger((state: PlayerTransitionState) => { transitionBackToScene4(state); });
  }
  currentSceneData.setLadderTrigger?.(() => { fadeTraversal(loadScene8); });
  renderer.render(activeScene, activeCamera);
  console.log('Scene 7 loaded - cafeteria');
}

function transitionToScene7(entryState: PlayerTransitionState) {
  try { loadScene7(entryState); } catch (error) { console.error('Error loading scene 7:', error); }
}

function transitionBackToScene4(entryState: PlayerTransitionState) {
  try { loadScene4(entryState, 'front'); } catch (error) { console.error('Error returning to scene 4:', error); }
}

function hideScene1Skip() {
  scene1SkipVisible = false;
  document.getElementById('skip-btn')?.classList.add('hidden');
  document.querySelectorAll('.wake-skip-btn').forEach(button => button.remove());
  document.getElementById('interact-prompt')?.classList.add('hidden');
}

function enterManagedScene(id: string, sceneData: any) {
  globalCharacter?.model.removeFromParent();
  npcManager.enterScene(id, sceneData);
}

function retireTraversalRoom() {
  // The persistent character is not scene-owned geometry.
  globalCharacter?.model.removeFromParent();
  npcManager.leaveScene();
}

function fadeTraversal(complete: () => void) {
  traversalState = currentPlayer?.captureTransition({ x: 0, y: 0, z: 0 });
  hideScene1Skip();
  const fade = document.getElementById('fade-overlay');
  if (!fade) { retireTraversalRoom(); complete(); return; }
  fade.classList.remove('hidden');
  fade.classList.add('black');
  void fade.clientWidth;
  fade.classList.add('active');
  window.setTimeout(() => {
    retireTraversalRoom();
    complete();
    window.setTimeout(() => {
      fade.classList.remove('active');
      window.setTimeout(() => { fade.classList.remove('black'); fade.classList.add('hidden'); }, 300);
    }, 120);
  }, 300);
}

function loadScene8(entry: 'galley' | 'deck' = 'galley') {
  hideScene1Skip();
  const sceneData = createScene8({ entry, entryState: traversalState });
    enterManagedScene('scene8', sceneData);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics; cutsceneManager = null; currentPlayer = sceneData.player;
  if (globalCharacter && globalCharacter.model.parent !== activeScene) {
    globalCharacter.model.parent?.remove(globalCharacter.model); activeScene.add(globalCharacter.model);
  }
  orbitControls!.object = activeCamera; orbitControls!.enabled = false;
  globalCharacter?.setFacing(currentPlayer.getState().yaw); updatePlayerView(0);
  sceneData.setReturnToSeven(() => fadeTraversal(loadScene7FromVent));
  sceneData.setDescendToNine(() => fadeTraversal(() => loadScene9(traversalState)));
  sceneData.setDropToTen(state => fadeTraversal(() => loadExtensionRoom(10, state)));
  sceneData.setDropToEleven(state => fadeTraversal(() => loadExtensionRoom(11, state)));
  renderer.render(activeScene, activeCamera);
}

function loadScene7FromVent() {
  hideScene1Skip();
  const sceneData = createScene7(ladderAccess());
  enterManagedScene('scene7', sceneData);
  if (traversalState) sceneData.player.restoreTransition({ ...traversalState, position: { x: 4.6, y: 0.3, z: -2.95 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, heldKeys: [] }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  sceneData.player.setPosition(4.6, 0.3, -2.95);
  sceneData.player.setRotation(Math.PI, 0);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics; cutsceneManager = null; currentPlayer = sceneData.player;
  if (globalCharacter && globalCharacter.model.parent !== activeScene) {
    globalCharacter.model.parent?.remove(globalCharacter.model); activeScene.add(globalCharacter.model);
  }
  orbitControls!.object = activeCamera; orbitControls!.enabled = false;
  globalCharacter?.setFacing(currentPlayer.getState().yaw); updatePlayerView(0);
  sceneData.setBackTrigger((state: PlayerTransitionState) => transitionBackToScene4(state));
  sceneData.setLadderTrigger(() => fadeTraversal(loadScene8));
  renderer.render(activeScene, activeCamera);
}

function loadScene9(entryState?: PlayerTransitionState, fromPassage = false) {
  hideScene1Skip();
  const sceneData = createScene9({ entryState, fromPassage, gravityRestored: bayGravityRestored, onGravityChanged: active => { bayGravityRestored = active; } });
    enterManagedScene('scene9', sceneData);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics; cutsceneManager = null; currentPlayer = sceneData.player;
  if (globalCharacter && globalCharacter.model.parent !== activeScene) {
    globalCharacter.model.parent?.remove(globalCharacter.model); activeScene.add(globalCharacter.model);
  }
  orbitControls!.object = activeCamera; orbitControls!.enabled = false;
  globalCharacter?.setFacing(currentPlayer.getState().yaw); updatePlayerView(0);
  sceneData.setReturnToEight(() => fadeTraversal(() => loadScene8('deck')));
  sceneData.setPassageTrigger(state => loadPassage12(state, 9));
  renderer.render(activeScene, activeCamera);
}

function activateExtension(sceneData: any, id: string) {
  enterManagedScene(id, sceneData);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics; cutsceneManager = null; currentPlayer = sceneData.player;
  if (globalCharacter) activeScene!.add(globalCharacter.model);
  orbitControls!.object = activeCamera!; orbitControls!.enabled = false;
  globalCharacter?.setFacing(currentPlayer!.getState().yaw); updatePlayerView(0);
}

function loadExtensionRoom(id: 10 | 11 | 13, entryState?: PlayerTransitionState, fromPassage = false, checkpoint = false) {
  retireTraversalRoom();
  const options = { entryState, fromPassage };
  const sceneData = id === 10 ? createScene10({ ...options, puzzleState, onPuzzleChanged: state => { puzzleState = state; } })
    : id === 11 ? createScene11(options) : createScene13({ ...options, defeated: bayBossDefeated, checkpoint, onDefeated: () => { bayBossDefeated = true; }, onDescend: loadHangar14 });
  activateExtension(sceneData, `scene${id}`);
  sceneData.setBackTrigger(state => loadPassage12(state, id));
}

function loadHangar14(entryState: PlayerTransitionState) {
  bayBossDefeated = true;
  hideScene1Skip(); retireTraversalRoom();
  const sceneData = createScene14({
    entryState,
    onFailure: () => {
      // A fresh living player, with session inventory and the boss defeat preserved.
      loadExtensionRoom(13, undefined, false, true);
    },
    onLaunch: state => {
      retireTraversalRoom();
      activateExtension(createScene15({ entryState: state }), 'scene15');
    },
  });
  activateExtension(sceneData, 'scene14');
}

function loadPassage12(entryState: PlayerTransitionState, from: PassageDestination) {
  retireTraversalRoom();
  const sceneData = createScene12({ entryState, from });
  activateExtension(sceneData, 'scene12');
  for (const id of [9, 10, 11, 13] as const) sceneData.setDoorTrigger(id, state => {
    if (id === 9) { retireTraversalRoom(); loadScene9(state, true); }
    else loadExtensionRoom(id, state, true);
  });
}

function transitionBackToScene3(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 4');
  try {
    const sceneData = createScene3({ audioManager, entryState, entryDoor: 'back', ...cargoAccess() });
    enterManagedScene('scene3', sceneData);
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
  hideScene1Skip();

  const sceneData = createScene5({ audioManager, entryState });
  enterManagedScene('scene5', sceneData);
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
    const sceneData = createScene3({ audioManager, entryState, entryDoor: 'left', ...cargoAccess() });
    enterManagedScene('scene3', sceneData);
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

  const sceneData = createScene6({ audioManager, entryState, gogglesCollected: goggles.isCollected(), onGogglesCollected: () => goggles.collect() });
  enterManagedScene('scene6', sceneData);
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
    const sceneData = createScene3({ audioManager, entryState, entryDoor: 'right', ...cargoAccess() });
    enterManagedScene('scene3', sceneData);
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
  if (!currentPlayer || !activeCamera) return;
  const cinematicState = currentSceneData?.getCinematicState?.();
  if (cinematicState) {
    // Remove ordinary weapon presentation before the scene applies its scripted props.
    pistol.update(dt); crowbar.update(dt);
    globalCharacter?.weapon.setEquipped(false);
    globalCharacter?.setCrowbarEquipped(currentSceneData.getCinematicWeapon?.() === 'crowbar');
    if (globalCharacter) {
      if (currentSceneData.hideCharacter?.()) globalCharacter.model.visible = false;
      else globalCharacter.update(
        currentSceneData.getCinematicDelta?.() ?? dt, currentPlayer.body.position,
        cinematicState, true, currentPlayer.radius, currentSceneData.getCinematicPose?.(),
      );
    }
    currentSceneData.updateCinematicCharacter?.(globalCharacter);
    currentSceneData.applyCinematicCamera();
    return;
  }
  if (!currentPlayer.isEnabled()) return;
  // Always start from the base camera, including the first render after a scene swap.
  const state = currentPlayer.getState();
  const traversalView = isThirdPerson || state.climbing || state.boxHandling;
  currentPlayer.updateCamera(0, traversalView);
  globalCharacter?.update(dt, currentPlayer.body.position, state, traversalView, currentPlayer.radius);
  if (applyTraversalCamera(activeCamera, currentPlayer, traversalView)) return;
  if (traversalView) {
    // Forward is the direction the player faces (matches getMoveDirection's W vector).
    const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    // Pull the camera back behind the player (opposite of forward) and over one shoulder.
    const distance = THIRD_PERSON_DIST;
    const rightOffset = THIRD_PERSON_RIGHT;
    const height = THIRD_PERSON_HEIGHT;
    activeCamera.position.addScaledVector(forward, -distance);
    activeCamera.position.addScaledVector(right, rightOffset);
    activeCamera.position.y += height;
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
  if (!scene1SkipVisible) document.getElementById('skip-btn')?.classList.add('hidden');

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
    if (currentPlayer.isEnabled() && health <= 0 && !currentSceneData?.onPlayerDeath?.()) respawnAtCapsule();
  }
  if (healthBarEl) {
    const inScene1 = currentSceneData === scene1Data && !currentPlayer?.isEnabled();
    const inCutscene = !!cutsceneManager || !!currentSceneData?.isCinematic?.();
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
    const inCutscene = !!cutsceneManager || !!currentSceneData?.isCinematic?.();
    crosshair.style.display = (inScene1 || inCutscene) ? 'none' : '';
  }

  const sceneOwnsControls = !!currentSceneData?.isCinematic?.();
  document.getElementById('info')?.classList.toggle('hidden', sceneOwnsControls);
  document.getElementById('view-toggle-btn')?.classList.toggle('hidden', sceneOwnsControls);

  // Character animations + view
  goggles.update();
  updatePlayerView(delta);

  if (!sceneOwnsControls) { pistol.update(delta); crowbar.update(delta); }
  cctv.update(delta, currentSceneData?.roomId, activeScene, npcManager.getStatus().scene);

  // Controls
  if (orbitControls && orbitControls.enabled) orbitControls.update();

  // Render
  if (activeScene && activeCamera) {
    renderer.render(activeScene, activeCamera);
    crowbar.renderFirstPerson(renderer);
  }
}

animate();
