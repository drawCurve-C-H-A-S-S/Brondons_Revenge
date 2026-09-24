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
import { createScene as createScene10 } from './scenes/scene10.js';
import { createCargoPuzzleState } from './scripts/cargoPuzzle.js';
import { createHandle } from './helpers/scene/cargoVisuals.js';
import { createScene as createScene11 } from './scenes/scene11.js';
import { createScene as createScene12, type PassageDestination } from './scenes/scene12.js';
import { createScene as createScene13 } from './scenes/scene13.js';
import { createScene as createScene14, type LaunchState } from './scenes/scene14.js';
import { createScene as createScene15, type FlightExitState } from './scenes/scene15.js';
import { createScene as createScene16 } from './scenes/scene16.js';
import { createScene as createScene17 } from './scenes/scene17.js';
import { createScene as createScene18 } from './scenes/scene18.js';
import { createScene as createScene19 } from './scenes/scene19.js';
import type { RescueArrival } from './helpers/scene/rescueSite.js';
import { loadCharacter } from './scripts/characterManager.js';
import type { Player, PlayerTransitionState } from './scripts/player.js';
import { PLAYER_MAX_HEALTH } from './scripts/player.js';
import { NPCEnemyManager } from './scripts/npc-enemy-robots.js';
import { PistolController } from './scripts/pistol.js';
import { CrowbarController } from './scripts/crowbar.js';
import { GogglesController } from './scripts/goggles.js';
import { createCctvSystem } from './scripts/cctv.js';
import { createFirstPersonHands } from './scripts/firstPersonHands.js';
import { initTouchControls, setTouchFlightMode, resetTouchInput } from './scripts/touchControls.js';

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
let creditsTimer: number | null = null;
let activeSceneId = 'scene1';
let quickMenuOpen = false;
let nextSceneActionId = 0;
const pendingSceneActions = new Map<number, { remaining: number; run: () => void }>();

// Scene delays advance with the game loop, so the scene menu freezes them too.
function scheduleSceneAction(run: () => void, delayMs: number) {
  const id = ++nextSceneActionId;
  pendingSceneActions.set(id, { remaining: delayMs / 1000, run });
  return id;
}
function advanceSceneActions(dt: number) {
  for (const [id, action] of [...pendingSceneActions]) {
    if (!pendingSceneActions.has(id)) continue;
    action.remaining -= dt;
    if (action.remaining <= 0) { pendingSceneActions.delete(id); action.run(); }
  }
}
let scene1SkipVisible = false;
let cargoPuzzle = createCargoPuzzleState();
const heldSwitchHandle = createHandle();
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
  player: cargoPuzzle.handle === 'carried' ? null : currentPlayer, character: globalCharacter?.model ?? null,
  thirdPerson: isThirdPerson, targets: [...npcManager.getDamageTargets(), ...(currentSceneData?.getDamageTargets?.() ?? [])],
  weaponAnimation: globalCharacter?.weapon,
  holsterOther: () => crowbarController?.holster(),
}));

const crowbar = new CrowbarController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player: cargoPuzzle.handle === 'carried' ? null : currentPlayer,
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
  setupSceneQuickMenu();
  initTouchControls();
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
  activeSceneId = 'scene1'; currentPlayer = null;
  currentSceneData = createScene1({ audioManager });
  scene1Data = currentSceneData;
  activeScene = currentSceneData.scene;
  activeCamera = currentSceneData.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = currentSceneData.cutsceneManager;
  lastSplinePoint = currentSceneData.lastSplinePoint;
  const introScene = currentSceneData;
  if (orbitControls) { orbitControls.object = activeCamera!; orbitControls.enabled = false; }

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
      if (currentSceneData === introScene && state === 'stopped' && lastSplinePoint) {
        activeCamera!.position.copy(lastSplinePoint);
        orbitControls!.target.set(0, 15, 0);
        orbitControls!.enabled = true;
        scene1SkipVisible = false;
        skipBtn.classList.add('hidden');
        showCredits();
      }
    };

    skipBtn.onclick = () => {
      if (currentSceneData !== introScene) return;
      scene1SkipVisible = false;
      skipBtn.classList.add('hidden');
      if (cutsceneManager) cutsceneManager.stop();
      if (lastSplinePoint) {
        activeCamera!.position.copy(lastSplinePoint);
        orbitControls!.target.set(0, 15, 0);
        orbitControls!.enabled = true;
      }
      if (creditsTimer) { pendingSceneActions.delete(creditsTimer); creditsTimer = null; }
      const creditsOverlay = document.getElementById('credits-overlay')!;
      creditsOverlay.classList.add('hidden');
      showMenuButtons();
    };
  }
}

// --- Credits and menu ---
function showCredits() {
  const creditsOverlay = document.getElementById('credits-overlay')!;
  creditsOverlay.classList.remove('hidden');
  creditsTimer = scheduleSceneAction(() => {
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
  let elapsed = 0, zoomFinished = false;
  const previousUpdate = updatePhysics;

  updatePhysics = (dt: number) => {
    previousUpdate?.(dt);
    if (zoomFinished) return;
    elapsed += dt * 1000;
    const progress = Math.min(elapsed / zoomDuration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    activeCamera!.position.lerpVectors(startPos, endPos, eased);
    activeCamera!.lookAt(0, 15, 0);
    if (progress >= 1) {
      zoomFinished = true;
      fadeOverlay.classList.add('active');
      scheduleSceneAction(() => {
        try { loadScene2(); } catch (e) { console.error('Error loading scene 2:', e); }
        fadeOverlay.classList.remove('active');
        scheduleSceneAction(() => { fadeOverlay.classList.add('hidden'); }, 1500);
      }, 1500);
    }
  };
}

function loadScene2(skipWake = false) {
  console.log('Loading scene 2...');

  globalCharacter?.model.removeFromParent();
  if (currentSceneData === scene1Data) currentSceneData?.dispose?.();
  retireTraversalRoom();
  const sceneData = createScene2({ audioManager, skipWake });
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

function loadScene3(entryState?: PlayerTransitionState) {
  console.log('Loading scene 3...');

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

function loadScene4(entryState?: PlayerTransitionState, entryDoor: 'back' | 'front' = 'back') {
  console.log('Loading scene 4...');

  const sceneData = createScene4({
    audioManager, entryState, entryDoor, cafeteriaUnlocked: hasCrowbar, chestOpened: hasCrowbar,
    onChestCollected: () => {
      hasCrowbar = true;
      crowbar.equip();
      const overlay = document.getElementById('crowbar-overlay');
      overlay?.classList.remove('hidden');
      scheduleSceneAction(() => overlay?.classList.add('hidden'), 4500);
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
    const state = currentPlayer.captureDoorTransition({ x: 0, y: 0, z: -10, yaw: 0 });
    try { loadScene4(state); } catch (e) { console.error('Error loading scene 4:', e); }
  }
}

function loadScene7(entryState?: PlayerTransitionState) {
  console.log('Loading scene 7 - cafeteria...');
  document.getElementById('skip-btn')?.classList.add('hidden');
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
  heldSwitchHandle.removeFromParent();
  globalCharacter?.model.removeFromParent();
  npcManager.enterScene(id, sceneData);
  activeSceneId = id;
  const damage = document.getElementById('player-damage');
  if (damage) damage.style.opacity = '0';
}

function retireTraversalRoom() {
  // The persistent character is not scene-owned geometry.
  heldSwitchHandle.removeFromParent();
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
  scheduleSceneAction(() => {
    retireTraversalRoom();
    complete();
    scheduleSceneAction(() => {
      fade.classList.remove('active');
      scheduleSceneAction(() => { fade.classList.remove('black'); fade.classList.add('hidden'); }, 300);
    }, 120);
  }, 300);
}

function loadScene8(entry: 'galley' | 'deck' = 'galley') {
  hideScene1Skip();
  const sceneData = createScene8({ entry, entryState: traversalState, puzzle: cargoPuzzle });
    enterManagedScene('scene8', sceneData);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics; cutsceneManager = null; currentPlayer = sceneData.player;
  if (globalCharacter && globalCharacter.model.parent !== activeScene) {
    globalCharacter.model.parent?.remove(globalCharacter.model); activeScene.add(globalCharacter.model);
  }
  orbitControls!.object = activeCamera; orbitControls!.enabled = false;
  globalCharacter?.setFacing(currentPlayer.getState().yaw); updatePlayerView(0);
  sceneData.setReturnToSeven(drop => fadeTraversal(() => loadScene7FromVent(drop)));
  sceneData.setDescendToNine(drop => fadeTraversal(() => loadScene9(traversalState, false, drop)));
  sceneData.setDropToTen(state => fadeTraversal(() => loadExtensionRoom(10, state)));
  sceneData.setDropToEleven(state => fadeTraversal(() => loadExtensionRoom(11, state)));
  renderer.render(activeScene, activeCamera);
}

function loadScene7FromVent(drop = false) {
  hideScene1Skip();
  const sceneData = createScene7(ladderAccess());
  enterManagedScene('scene7', sceneData);
  const position = { x: 4.6, y: drop ? 4.15 : 0.3, z: drop ? -3.18 : -2.95 };
  if (traversalState) sceneData.player.restoreTransition({ ...traversalState, position, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, heldKeys: [], blockedKeys: [], crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  sceneData.player.setPosition(position.x, position.y, position.z);
  if (drop) sceneData.player.body.velocity.y = -5;
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

function loadScene9(entryState?: PlayerTransitionState, fromPassage = false, dropFromLadder = false) {
  hideScene1Skip();
  const sceneData = createScene9({ entryState, fromPassage, dropFromLadder, puzzle: cargoPuzzle });
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
  const options = { entryState, fromPassage, puzzle: cargoPuzzle };
  const sceneData = id === 10 ? createScene10(options)
    : id === 11 ? createScene11(options) : createScene13({
      ...options, defeated: bayBossDefeated, checkpoint,
      onDefeated: () => { bayBossDefeated = true; }, onDescend: loadHangar14,
      onRespawn: () => loadExtensionRoom(13, undefined, false, true),
    });
  activateExtension(sceneData, `scene${id}`);
  sceneData.setBackTrigger(state => loadPassage12(state, id));
}

function loadHangar14(entryState?: PlayerTransitionState) {
  bayBossDefeated = true;
  hideScene1Skip(); retireTraversalRoom();
  const sceneData = createScene14({
    entryState,
    onFailure: () => {
      // A fresh living player, with session inventory and the boss defeat preserved.
      loadExtensionRoom(13, undefined, false, true);
    },
    onLaunch: loadFlight15,
  });
  activateExtension(sceneData, 'scene14');
}

function loadFlight15(entryState?: LaunchState, startAt?: 'scrambler') {
  hideScene1Skip(); retireTraversalRoom();
  activateExtension(createScene15({ entryState, startAt, onTransition: loadCrash16 }), 'scene15');
  setTouchFlightMode(true);
}

function loadCrash16(entryState?: FlightExitState) {
  hideScene1Skip(); retireTraversalRoom();
  setTouchFlightMode(false);
  activateExtension(createScene16({
    entryState,
    onFinished: loadGround17,
  }), 'scene16');
}

function loadGround17(entryState?: RescueArrival) {
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
  activateExtension(createScene17({
    entryState, onRiver: loadRiver18,
    onRespawn: () => loadGround17(checkpointArrival(entryState)),
  }), 'scene17');
}

function checkpointArrival(entryState?: RescueArrival): RescueArrival {
  return { ...entryState, cameraPosition: undefined, cameraQuaternion: undefined, cameraFov: undefined,
    pilotState: entryState?.pilotState ? { ...entryState.pilotState, health: PLAYER_MAX_HEALTH } : undefined };
}

function loadRiver18(entryState?: RescueArrival) {
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(true);
  activateExtension(createScene18({ entryState, onFinished: loadGround19,
    onRespawn: () => loadRiver18(checkpointArrival(entryState)),
  }), 'scene18');
}

function loadGround19(entryState?: RescueArrival) {
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
  activateExtension(createScene19({ entryState,
    onRespawn: () => loadGround19(checkpointArrival(entryState)),
  }), 'scene19');
}

function loadPassage12(entryState?: PlayerTransitionState, from: PassageDestination = 10) {
  retireTraversalRoom();
  const sceneData = createScene12({ entryState, from, puzzle: cargoPuzzle });
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

function loadScene5(entryState?: PlayerTransitionState) {
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

function loadScene6(entryState?: PlayerTransitionState) {
  console.log('Loading scene 6...');

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
    currentSceneData.applyCinematicCamera?.();
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
  currentSceneData?.applyEntryCamera?.();
}

// --- Direct scene selection ---
const SCENE_CHOICES = [
  [1, 'Space prologue'], [2, 'Medical bay'], [3, 'Passageway'], [4, 'Computer room'],
  [5, 'Cargo hold'], [6, 'Target range'], [7, 'Cafeteria'], [8, 'Vent junction'],
  [9, 'Zero-gravity loading bay'], [10, 'Durable cargo puzzle'], [11, 'Mixed cargo puzzle'],
  [12, 'Transfer passage'], [13, 'Bay Warden boss'], [14, 'Hangar escape'],
  [15, 'Space combat'], [15.5, 'Sidescroll Scrambler'], [16, 'Jungle crash cutscene'],
  [17, 'Jungle bridge ambush'], [18, 'River escape'], [19, 'Facility approach'],
] as const;
const quickMenu = document.getElementById('scene-quick-menu') as HTMLDialogElement;

function clearSceneInput() {
  resetTouchInput();
  currentPlayer?.clearInput();
  currentSceneData?.clearInput?.();
}
function setQuickMenu(open: boolean) {
  if (open === quickMenuOpen) return;
  quickMenuOpen = open;
  clearSceneInput();
  document.body.classList.toggle('quick-menu-open', open);
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
    quickMenu.showModal();
    const buttons = quickMenu.querySelectorAll<HTMLButtonElement>('[data-scene]');
    const currentId = currentSceneData?.getSceneId?.() ?? activeSceneId;
    buttons.forEach(button => button.setAttribute('aria-current', String(`scene${button.dataset.scene}` === currentId)));
    const current = quickMenu.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? buttons[0];
    current?.focus(); current?.scrollIntoView({ block: 'nearest' });
  } else {
    quickMenu.close();
    renderer.domElement.focus();
  }
}
function jumpToScene(id: number) {
  if (!SCENE_CHOICES.some(([scene]) => scene === id)) return;
  pendingSceneActions.clear(); creditsTimer = null;
  setTouchFlightMode(false);
  clearSceneInput();
  // Detach persistent gear before the outgoing scene disposes its meshes.
  pistol.holster(); crowbar.holster(); pistol.update(0); crowbar.update(0);
  globalCharacter?.model.removeFromParent();
  if (currentSceneData === scene1Data) { currentSceneData?.dispose?.(); scene1Data = null; }
  retireTraversalRoom();
  currentSceneData = null; currentPlayer = null; activeScene = null; activeCamera = null;
  updatePhysics = null; cutsceneManager = null; traversalState = undefined; lastSplinePoint = null;
  hideScene1Skip();
  for (const overlay of ['credits-overlay', 'menu-buttons', 'crowbar-overlay', 'boss-hud', 'boss-subtitles', 'escape-qte', 'loading-bay-status', 'space-cinematic-caption']) document.getElementById(overlay)?.classList.add('hidden');
  const fade = document.getElementById('fade-overlay'); fade?.classList.remove('active', 'black'); fade?.classList.add('hidden');
  hasCrowbar = true; goggles.collect();
  if (id >= 8 && id <= 12) cargoPuzzle = createCargoPuzzleState(id);
  if (id === 13) bayBossDefeated = false;
  try {
    switch (id) {
      case 1: loadScene1(); break;
      case 2: loadScene2(true); break;
      case 3: loadScene3(); break;
      case 4: loadScene4(); break;
      case 5: loadScene5(); break;
      case 6: loadScene6(); break;
      case 7: loadScene7(); break;
      case 8: loadScene8(); break;
      case 9: loadScene9(); break;
      case 10: case 11: case 13: loadExtensionRoom(id); break;
      case 12: loadPassage12(); break;
      case 14: loadHangar14(); break;
      case 15: loadFlight15(); break;
      case 15.5: loadFlight15(undefined, 'scrambler'); break;
      case 16: loadCrash16(); break;
      case 17: loadGround17(); break;
      case 18: loadRiver18(); break;
      case 19: loadGround19(); break;
    }
    const spawnedPlayer = currentSceneData?.player as Player | undefined;
    spawnedPlayer?.heal(PLAYER_MAX_HEALTH);
    pistol.equip(); goggles.update(); updatePlayerView(0);
    document.getElementById('scene-menu-error')!.textContent = '';
    setQuickMenu(false);
  } catch (error) {
    console.error('Scene jump failed:', error);
    document.getElementById('scene-menu-error')!.textContent = 'Unable to load that scene. Choose another scene to continue.';
  }
}
function setupSceneQuickMenu() {
  renderer.domElement.tabIndex = -1;
  const list = document.getElementById('scene-quick-list')!;
  for (const [id, label] of SCENE_CHOICES) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.scene = String(id);
    button.textContent = `${String(id).padStart(2, '0')} / ${label}`; list.appendChild(button);
  }
  quickMenu.addEventListener('click', event => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset.scene) jumpToScene(Number(button.dataset.scene));
    else if (button?.id === 'scene-quick-close') setQuickMenu(false);
  });
  quickMenu.addEventListener('cancel', event => { event.preventDefault(); setQuickMenu(false); });
  quickMenu.addEventListener('close', () => { if (quickMenuOpen) setQuickMenu(false); });
  window.addEventListener('keydown', event => {
    const enter = event.code === 'Enter' || event.code === 'NumpadEnter';
    if (!quickMenuOpen) {
      if (!enter || event.repeat || (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))) return;
      event.preventDefault(); event.stopImmediatePropagation(); setQuickMenu(true); return;
    }
    event.stopImmediatePropagation();
    if (event.code === 'Tab') return;
    event.preventDefault();
    if (event.code === 'Escape') { setQuickMenu(false); return; }
    const buttons = Array.from(quickMenu.querySelectorAll<HTMLButtonElement>('[data-scene]'));
    const focused = document.activeElement as HTMLButtonElement | null;
    if (enter && !event.repeat) {
      if (focused?.dataset.scene) jumpToScene(Number(focused.dataset.scene)); else setQuickMenu(false);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.code)) {
      const index = Math.max(0, buttons.indexOf(focused!));
      const next = event.code === 'Home' ? 0 : event.code === 'End' ? buttons.length - 1 : (index + (event.code === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' });
    }
  }, true);
  // Capture before scene input handlers; native dialog scrolling/focus still works.
  for (const type of ['keyup', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup', 'wheel']) {
    window.addEventListener(type, event => { if (quickMenuOpen) event.stopImmediatePropagation(); }, true);
  }
  document.getElementById('scene-menu-hint')?.classList.remove('hidden');
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
const playerDamageEl = document.getElementById('player-damage');
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
  if (quickMenuOpen) {
    if (activeScene && activeCamera) renderer.render(currentSceneData?.getRenderScene?.() ?? activeScene, activeCamera);
    return;
  }
  advanceSceneActions(Math.min(delta, 0.1));
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
  if (playerDamageEl) playerDamageEl.style.opacity = String(currentSceneData?.getDamageFlash?.() ?? currentPlayer?.getDamageFlash() ?? 0);

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
  document.getElementById('weapon-status')?.classList.toggle('hidden', cargoPuzzle.handle === 'carried');
  heldSwitchHandle.visible = cargoPuzzle.handle === 'carried' && !sceneOwnsControls && !!currentPlayer?.isEnabled();
  if (heldSwitchHandle.visible && currentPlayer && activeScene && activeCamera) {
    activeScene.add(heldSwitchHandle);
    const yaw = currentPlayer.getState().yaw, p = currentPlayer.body.position;
    if (isThirdPerson) {
      heldSwitchHandle.position.set(p.x + Math.cos(yaw) * 0.35 - Math.sin(yaw) * 0.45, p.y + 0.7, p.z - Math.sin(yaw) * 0.35 - Math.cos(yaw) * 0.45);
      heldSwitchHandle.rotation.set(0.4, yaw, 0);
    } else {
      heldSwitchHandle.position.set(0.3, -0.45, -0.7).applyQuaternion(activeCamera.quaternion).add(activeCamera.position);
      heldSwitchHandle.quaternion.copy(activeCamera.quaternion);
    }
  } else heldSwitchHandle.removeFromParent();
  cctv.update(delta, currentSceneData?.roomId, activeScene, npcManager.getStatus().scene);

  // Controls
  if (orbitControls && orbitControls.enabled) orbitControls.update();

  // Render
  if (activeScene && activeCamera) {
    renderer.render(currentSceneData?.getRenderScene?.() ?? activeScene, activeCamera);
    if (!sceneOwnsControls && cargoPuzzle.handle !== 'carried') crowbar.renderFirstPerson(renderer);
  }
}

animate();
