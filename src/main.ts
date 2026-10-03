import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyThirdPersonCamera, applyTraversalCamera, isCameraForcedFirstPerson, resetThirdPersonCamera } from './core/camera.js';
import { createSceneMinimap } from './core/renderer.js';
import { createShipMap } from './core/shipMap.js';
import { createScene as createScene1 } from './scenes/scene1.js';
import { createHoldToSkip } from './helpers/animation/holdToSkip.js';
import { createCargoPuzzleState } from './scripts/cargoPuzzle.js';
import { createHandle } from './helpers/scene/cargoVisuals.js';
import type { PassageDestination } from './scenes/level 1/scene12.js';
import type { LaunchState } from './scenes/level 1/scene14.js';
import type { FlightExitState } from './scenes/level 2/scene15.js';
import type { RescueArrival } from './helpers/scene/rescueSite.js';
import type { loadCharacter } from './scripts/characterManager.js';
import type { Player, PlayerTransitionState } from './scripts/player.js';
import { PLAYER_MAX_HEALTH } from './scripts/player.js';
import { NPCEnemyManager } from './scripts/npc-enemy-robots.js';
import { PistolController } from './scripts/pistol.js';
import { CrowbarController } from './scripts/crowbar.js';
import { GogglesController } from './scripts/goggles.js';
import { GogglesPostProcess } from './scripts/gogglesPostProcess.js';
import { LightsaberController } from './scripts/lightsaber.js';
import { AdaptiveHintManager } from './scripts/adaptiveHints.js';
import { createCctvSystem } from './scripts/cctv.js';
import type { createFirstPersonHands } from './scripts/firstPersonHands.js';
import { initTouchControls, setTouchFlightMode, resetTouchInput } from './scripts/touchControls.js';
import { PixelArtPass } from './core/PixelArtPass.js';
import { RetroConsolePass } from './core/RetroConsolePass.js';
import { getAudioSettings, preloadAudio, setAudioVolume, setAudioMenuPaused } from './helpers/audio/AudioManager.js';
import { preloadJungleModels, preloadToolModel, yieldToMainThread } from './core/loader.js';
import shipMusicUrl from './assets/bgm/DonRevBGM1.m4a';
import flightMusicUrl from './assets/bgm/DonRevLevel2.m4a';
import jungleMusicUrl from './assets/bgm/DonRevJungleLoop.m4a';

const sceneImports = {
  0: () => import('./scenes/prologue/prologue_scene_1.js'),
  1.1: () => import('./scenes/level 1 stage 1/storageRoom.js'),
  2: () => import('./scenes/level 1/scene2.js'),
  3: () => import('./scenes/level 1/scene3.js'),
  4: () => import('./scenes/level 1/scene4.js'),
  5: () => import('./scenes/level 1/scene5.js'),
  6: () => import('./scenes/level 1/scene6.js'),
  7: () => import('./scenes/level 1/scene7.js'),
  8: () => import('./scenes/level 1/scene8.js'),
  9: () => import('./scenes/level 1/scene9.js'),
  10: () => import('./scenes/level 1/scene10.js'),
  11: () => import('./scenes/level 1/scene11.js'),
  12: () => import('./scenes/level 1/scene12.js'),
  13: () => import('./scenes/level 1/scene13.js'),
  14: () => import('./scenes/level 1/scene14.js'),
  15: () => import('./scenes/level 2/scene15.js'),
  16: () => import('./scenes/level 2/scene16.js'),
  17: () => import('./scenes/level 3/scene17.js'),
  18: () => import('./scenes/level 3/scene18.js'),
  19: () => import('./scenes/level 3/scene19.js'),
};
type SceneModuleId = keyof typeof sceneImports;
const sceneModules = new Map<SceneModuleId, Promise<unknown>>();
let sceneRequestVersion = 0;
let backgroundQueue = Promise.resolve();

function sceneModule<Id extends SceneModuleId>(id: Id): ReturnType<(typeof sceneImports)[Id]> {
  let pending = sceneModules.get(id);
  if (!pending) {
    pending = sceneImports[id]();
    sceneModules.set(id, pending);
    void pending.catch(() => sceneModules.delete(id));
  }
  return pending as ReturnType<(typeof sceneImports)[Id]>;
}

async function prepareScene<Id extends SceneModuleId>(id: Id) {
  const request = ++sceneRequestVersion;
  try {
    const module = await sceneModule(id);
    return request === sceneRequestVersion ? module : null;
  } catch (error) {
    console.error(`Unable to load scene ${id}:`, error);
    document.getElementById('scene-menu-error')!.textContent = 'Unable to load that scene. Please try again.';
    return null;
  }
}

function background(task: () => Promise<unknown> | void) {
  backgroundQueue = backgroundQueue.then(yieldToMainThread).then(task).then(() => undefined)
    .catch(error => console.warn('Background preparation failed:', error));
  return backgroundQueue;
}

function warmScene(id: SceneModuleId) {
  void background(async () => {
    if (id === 13) await (await sceneModule(13)).preloadAssets();
    else await sceneModule(id);
  });
}

const upcomingScenes: Partial<Record<SceneModuleId, readonly SceneModuleId[]>> = {
  0: [1.1], 2: [3], 3: [4, 5, 6], 4: [7], 7: [8], 8: [9, 10, 11],
  9: [12], 10: [12], 11: [12, 13], 12: [13], 13: [14],
  14: [15], 15: [16], 16: [17], 17: [18], 18: [19],
};

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia('(pointer: coarse)').matches ? 1 : 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const cctv = createCctvSystem(renderer);
const gogglesPostProcess = new GogglesPostProcess(renderer);
const pixelArtPass = new PixelArtPass();
const retroConsolePass = new RetroConsolePass();
const minimap = createSceneMinimap(renderer, document.getElementById('minimap')!);
const cctvRaycaster = new THREE.Raycaster();
const cctvClickMouse = new THREE.Vector2();

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
let stealthHintsEnabled = true;
let nextSceneActionId = 0;
const pendingSceneActions = new Map<number, { remaining: number; run: () => void }>();

function renderGameScene(scene: THREE.Scene, camera: THREE.Camera) {
  goggles.update();
  gogglesPostProcess.render(scene, camera, () => {
    renderSceneEffects(scene, camera);
    if (!deathPresentation && !currentSceneData?.isCinematic?.() && !currentSceneData?.ownsWeaponInput && cargoPuzzle.handle !== 'carried') {
      crowbar.renderFirstPerson(renderer);
    }
  });
  currentSceneData?.renderCinematicOverlay?.(renderer);
}
function renderSceneEffects(scene: THREE.Scene, camera: THREE.Camera) {
  const retroStrength = currentSceneData?.getRetroConsoleStrength?.() ?? 0;
  if (retroStrength > 0) {
    retroConsolePass.render(renderer, renderer.render.bind(renderer), scene, camera, retroStrength);
    return;
  }
  const strength = currentSceneData?.getPixelArtStrength?.() ?? 0;
  if (strength > 0) pixelArtPass.render(renderer, renderer.render.bind(renderer), scene, camera, strength);
  else renderer.render(scene, camera);
}

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
let scene1SkipHold: ReturnType<typeof createHoldToSkip> | null = null;
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
let shieldCollectedScene7 = false;
let healthPackCollectedScene13 = false;
let hintManager: AdaptiveHintManager | null = null;
const cargoAccess = () => ({ hasCrowbar, cargoDoorUnlocked, onCargoDoorOpened: () => { cargoDoorUnlocked = true; } });
const ladderAccess = () => ({ clearedCrates: clearedLadderCrates, onCrateBroken: (id: string) => { clearedLadderCrates.add(id); }, shieldCollected: shieldCollectedScene7, onShieldCollected: () => { shieldCollectedScene7 = true; } });
let crowbarController: CrowbarController | null = null;
let hasLightsaber = false;
let lightsaberController: LightsaberController | null = null;
let firstPersonHands: Awaited<ReturnType<typeof createFirstPersonHands>> | null = null;
let firstPersonHandsLoading: Promise<void> | null = null;

function prepareFirstPersonHands() {
  firstPersonHandsLoading ??= import('./scripts/firstPersonHands.js').then(async ({ createFirstPersonHands }) => {
    firstPersonHands = await createFirstPersonHands();
  }).catch(error => console.error('Failed to load crowbar hands:', error));
  return firstPersonHandsLoading;
}

// --- View toggle (first-person / third-person) ---
let isThirdPerson = true;
const THIRD_PERSON_DIST = 1.5;
const THIRD_PERSON_HEIGHT = 0.3;
const THIRD_PERSON_RIGHT = 0.7;

function isGameplayThirdPerson() {
  return (isThirdPerson || !!currentSceneData?.forceThirdPerson) && !isCameraForcedFirstPerson(activeCamera);
}

const pistol = new PistolController(() => ({
  scene: activeScene, camera: activeCamera, world: currentSceneData?.physicsWorld ?? null,
  player: cargoPuzzle.handle === 'carried' || currentSceneData?.ownsWeaponInput ? null : currentPlayer, character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(), targets: [...npcManager.getDamageTargets(), ...(currentSceneData?.getDamageTargets?.() ?? [])],
  weaponAnimation: currentSceneData?.ownsWeaponInput ? undefined : globalCharacter?.weapon,
  holsterOther: () => { crowbarController?.holster(); lightsaberController?.holster(); },
  onShot: (point, origin) => currentSceneData?.onPistolShot?.(point, origin),
}));

const crowbar = new CrowbarController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player: cargoPuzzle.handle === 'carried' || currentSceneData?.ownsWeaponInput ? null : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  hasCrowbar,
  targets: [...npcManager.getDamageTargets(), ...(currentSceneData?.getDamageTargets?.() ?? [])],
  setCharacterEquipped: (equipped: boolean) => globalCharacter?.setCrowbarEquipped(equipped),
  doorTarget: currentSceneData?.forwardDoorTarget ?? null,
  openDoor: () => { currentSceneData?.hitForwardDoor?.(); currentSceneData?.hitCargoDoor?.(); },
  holsterOther: () => { pistol.holster(); lightsaberController?.holster(); },
  firstPersonHands: () => {
    if (hasCrowbar && !isGameplayThirdPerson()) void prepareFirstPersonHands();
    return firstPersonHands;
  },
}));
crowbarController = crowbar;
const lightsaber = new LightsaberController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player: cargoPuzzle.handle === 'carried' || currentSceneData?.ownsWeaponInput || currentSceneData?.isCinematic?.() || deathPresentation ? null : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  hasLightsaber,
  attackClips: globalCharacter?.lightsaberAttacks,
  targets: [...npcManager.getDamageTargets(), ...(currentSceneData?.getDamageTargets?.() ?? [])],
  setCharacterEquipped: equipped => globalCharacter?.setLightsaberEquipped(equipped),
  openDoor: () => { currentSceneData?.hitForwardDoor?.(); currentSceneData?.hitCargoDoor?.(); },
  holsterOther: () => { crowbar.holster(); pistol.holster(); },
  getParryableBolts: () => currentSceneData?.getParryableBolts?.() ?? [],
}));
lightsaberController = lightsaber;
const goggles = new GogglesController(() => ({
  player: currentSceneData?.ownsWeaponInput || currentSceneData?.isCinematic?.() || deathPresentation ? null : currentPlayer, scene: currentSceneData,
  setCharacterEquipped: active => globalCharacter?.setGogglesEquipped(active),
  onToggle: active => gogglesPostProcess.setActive(active),
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
  loadScene1();
  initializeControls();
  setupViewToggle();
  setupSceneQuickMenu();
  initTouchControls();

  hintManager = new AdaptiveHintManager();
  const recordHintActivity = () => hintManager?.recordActivity();
  window.addEventListener('keydown', recordHintActivity);
  window.addEventListener('mousedown', recordHintActivity);
  window.addEventListener('mousemove', recordHintActivity);
  window.addEventListener('touchstart', recordHintActivity);

  // CCTV screen click-to-teleport
  window.addEventListener('click', event => {
    if (activeSceneId !== 'scene7' || !currentPlayer?.isEnabled() || !activeCamera) return;
    if (quickMenuOpen || !!currentSceneData?.isCinematic?.()) return;
    cctvClickMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    cctvClickMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    cctvRaycaster.setFromCamera(cctvClickMouse, activeCamera);
    const screenIndex = cctv.handleScreenClick(cctvRaycaster, activeCamera);
    if (screenIndex === null) return;
    const roomIds = cctv.roomIds;
    const roomId = roomIds[screenIndex];
    if (roomId === 'cafeteria') return; // Already in cafeteria
    const sceneMap: Record<string, () => void> = {
      'medical-bay': () => fadeTraversal(() => loadScene2()),
      'hallway': () => fadeTraversal(() => loadScene3()),
      'computer-room': () => fadeTraversal(() => loadScene4()),
    };
    const teleport = sceneMap[roomId];
    if (teleport) teleport();
  });

  await yieldToMainThread();
  const { loadCharacter } = await import('./scripts/characterManager.js');
  console.log('Loading character model...');
  globalCharacter = await loadCharacter();
  if (globalCharacter) {
    console.log('Character loaded successfully');
    if (currentPlayer && activeScene && (activeSceneId !== 'prologue1' || currentPlayer.isEnabled())) {
      activeScene.add(globalCharacter.model);
      globalCharacter.setFacing(currentPlayer.getState().yaw);
      updatePlayerView(0);
    }
  } else {
    console.warn('Failed to load character, continuing without character');
  }
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('stage1-stealth')) await loadStage1Storage();
  warmScene(0);
  warmScene(1.1);
  void background(() => preloadAudio(shipMusicUrl));
  void background(() => preloadToolModel('Enemy_EyeDrone'));
  void background(() => preloadToolModel('Enemy_Trilobite'));
}

// Control cards are introduced once per play session, including across respawns.
type ControlCard = { key: string; title: string; lines: string[]; touch: string[]; scene?: string };
const seenControls = new Set<string>();
let controlQueue: ControlCard[] = [];
let shownControl: ControlCard | null = null;
let controlTime = 0;
const controlCard = document.getElementById('control-card')!;
const lessons: Record<string, Omit<ControlCard, 'key' | 'scene'>> = {
  basics: { title: 'You’re awake', lines: ['WASD — walk · Shift — sprint', 'Mouse — look · Click the world to capture the mouse', 'Space — jump · C — crouch · E — interact', 'K — equip pistol · Left click — shoot', 'V or the view button — switch first / third person · M — pause'], touch: ['Drag on the left to walk; drag on the right to look.', 'RUN, JUMP, CROUCH and USE are your movement controls.', 'PISTOL equips your gun; SHOOT fires it.', 'Tap VIEW to switch first / third person · MENU to pause.'] },
  pistol: { title: 'Pistol', lines: ['K — equip / holster', 'Left click — shoot at your crosshair'], touch: ['PISTOL — equip / holster', 'SHOOT — fire at your crosshair'] },
  crowbar: { title: 'Crowbar acquired', lines: ['T — equip / holster', 'Left click — swing'], touch: ['CROW — equip / holster', 'SWING — attack'] },
  lightsaber: { title: 'Lightsaber acquired', lines: ['L — equip / holster', 'Left click — slash'], touch: ['SABER — equip / holster', 'SLASH — attack'] },
  goggles: { title: 'Scanner goggles acquired', lines: ['N — wear / remove goggles'], touch: ['GOGGLES — wear / remove'] },
  vent: { title: 'Vent traversal', lines: ['W / S — crawl forward / backward', 'A / D — turn at junctions', 'E — use a ladder · Space — drop while descending'], touch: ['Left stick — crawl and turn at junctions', 'USE — take a ladder · JUMP — drop while descending'] },
  cargo: { title: 'Handling cargo', lines: ['E — grab / release a nearby box', 'WASD — move while holding it'], touch: ['USE — grab / release a nearby box', 'Left stick — move the box'] },
  flight: { title: 'Flight controls', lines: ['WASD — dodge · Mouse — aim', 'Hold left click — fire · Space — evade', 'V or the view button — cockpit / chase camera · M — pause'], touch: ['Left stick — dodge · Right drag — aim', 'Hold FIRE — shoot · EVADE — dodge', 'VIEW — cockpit / chase camera · MENU — pause']},
  flightSide: { title: 'Sidescroll flight', lines: ['WASD / arrows — move · Hold left click — fire straight', 'W / S + Space — dodge up / down'], touch: ['Left stick — move · Hold FIRE — fire straight', 'Stick up / down + EVADE — vertical dodge'] },
  flightTop: { title: 'Top-down flight', lines: ['WASD / arrows — move · Hold left click — fire upward', 'A / D + Space — evade left / right'], touch: ['Left stick — move · Hold FIRE — fire upward', 'Stick left / right + EVADE — lateral dodge'] },
  jungle: { title: 'Back on the ground', lines: ['WASD — walk · Shift — sprint · Space — jump', 'K — pistol · T — crowbar · Left click — attack', 'V or the view button — change view'], touch: ['Left stick — walk · Right drag — look', 'RUN / JUMP — sprint and jump', 'PISTOL / CROW — select weapon · SHOOT / SWING — attack', 'VIEW — change view'] },
  platformer: { title: 'Platforming controls', lines: ['A / D or arrows — move · Space — jump', 'Shift — sprint · C — crouch', 'Mouse — aim · K — gun · T — crowbar', 'Hold left click — attack'], touch: ['Left stick — move · JUMP — jump', 'RUN — sprint · CROUCH — crouch', 'Right drag — aim · PISTOL / CROW — select weapon', 'Hold FIRE — attack'] },
};
function introduceControls(key: string, scene?: string) {
  if (seenControls.has(key) || controlQueue.some(card => card.key === key) || shownControl?.key === key) return;
  controlQueue.push({ ...lessons[key], key, scene });
}
function dismissControls() {
  shownControl = null; controlTime = 0; controlCard.classList.add('hidden');
}
function enterHudScene(id: string) {
  document.body.dataset.scene = id;
  dismissControls();
  controlQueue = controlQueue.filter(card => !card.scene);
  minimap.reset();
  const key = id === 'scene2' ? 'basics' : id === 'scene8' ? 'vent'
    : id === 'scene10' || id === 'scene11' ? 'cargo' : id === 'scene15' ? 'flight'
    : id === 'scene17' || id === 'scene19' ? 'jungle' : id === 'scene18' ? 'platformer' : null;
  if (key) introduceControls(key, id);
}
function updateControlCard(dt: number) {
  const ready = activeSceneId !== 'scene1' && !quickMenuOpen && !deathPresentation
    && (currentSceneData?.controlsReady?.() ?? (!!currentPlayer?.isEnabled() && !currentSceneData?.isCinematic?.()))
    && document.getElementById('fade-overlay')?.classList.contains('hidden');
  const flightScene = currentSceneData?.getSceneId?.();
  if (activeSceneId === 'scene15' && flightScene && flightScene !== 'scene15') {
    controlQueue = controlQueue.filter(card => card.scene !== 'scene15');
    if (shownControl?.scene === 'scene15') dismissControls();
  }
  if (!ready) { controlCard.classList.add('hidden'); return; }
  if (!shownControl && controlQueue.length) {
    shownControl = controlQueue.shift()!;
    seenControls.add(shownControl.key);
    controlTime = shownControl.key === 'flight' ? 4 : 18;
    document.getElementById('control-card-title')!.textContent = shownControl.title;
    const lines = document.body.classList.contains('touch-device') ? shownControl.touch : shownControl.lines;
    document.getElementById('control-card-content')!.replaceChildren(...lines.map(text => {
      const line = document.createElement('p'); line.textContent = text; return line;
    }));
  }
  if (shownControl) {
    controlCard.classList.remove('hidden');
    controlTime -= Math.min(dt, 0.1);
    if (controlTime <= 0) dismissControls();
  }
}
function renderMinimap() {
  // Level 2 (flight scene15 and crash scene16) scenes never show the map overlay.
  if (activeSceneId === 'scene1' || activeSceneId === 'scene15' || activeSceneId === 'scene16'
    || !activeScene || !currentPlayer) { minimap.hide(); return; }
  const state = currentSceneData?.getMinimapState?.();
  minimap.render(currentSceneData?.getRenderScene?.() ?? activeScene,
    state?.position ?? currentPlayer.body.position, state?.yaw ?? currentPlayer.getState().yaw,
    state?.object ?? globalCharacter?.model ?? null, { ...currentSceneData?.minimap, ...state });
}

// --- View toggle ---
function setupViewToggle() {
  const toggleBtn = document.getElementById('view-toggle-btn')!;
  toggleBtn.addEventListener('click', event => { event.stopPropagation(); toggleView(); toggleBtn.blur(); });
  document.getElementById('control-card-close')!.addEventListener('click', event => { event.stopPropagation(); dismissControls(); });
  for (const node of [toggleBtn, controlCard]) {
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) node.addEventListener(type, event => event.stopPropagation());
  }
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat || quickMenuOpen || (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))) return;
    if (event.code === 'KeyH' && shownControl) { event.preventDefault(); dismissControls(); }
    // Scenes with their own camera input consume V themselves.
    if (event.code === 'KeyV' && !currentSceneData?.toggleView) toggleView();
  });
}
function canToggleView() {
  if (activeSceneId === 'scene1' || quickMenuOpen || deathPresentation) return false;
  return currentSceneData?.canToggleView?.() ?? (!!currentPlayer?.isEnabled()
    && !currentSceneData?.isCinematic?.() && !currentSceneData?.forceThirdPerson && !currentSceneData?.ownsWeaponInput);
}
function updateViewButton() {
  document.getElementById('touch-lightsaber')?.classList.toggle('hidden', !hasLightsaber || !!currentSceneData?.ownsWeaponInput || !!currentSceneData?.isCinematic?.());
  const btn = document.getElementById('view-toggle-btn') as HTMLButtonElement;
  const state = currentPlayer?.getState();
  const third = currentSceneData?.isThirdPersonView?.() ?? ((isThirdPerson || !!currentSceneData?.forceThirdPerson
    || !!currentSceneData?.isCinematic?.() || !!state?.climbing || !!state?.boxHandling) && !isCameraForcedFirstPerson(activeCamera));
  btn.dataset.view = third ? '3' : '1';
  btn.disabled = !canToggleView();
  btn.title = btn.disabled ? 'Camera controlled by this scene' : `Switch to ${third ? 'first' : 'third'} person (V)`;
  btn.setAttribute('aria-label', `${third ? 'Third' : 'First'}-person camera. ${btn.title}`);
}
function toggleView() {
  if (!canToggleView()) return;
  if (currentSceneData?.toggleView) currentSceneData.toggleView();
  else isThirdPerson = !isThirdPerson;
  updateViewButton();
}

// --- Load Prologue Scene 1 (developer menu entry) ---
async function loadPrologue1() {
  const module = await prepareScene(0);
  if (!module) return;
  hideScene1Skip();
  retireTraversalRoom();
  currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) scene1Data = null;
  activeSceneId = 'prologue1'; currentPlayer = null;
  enterHudScene('prologue1');
  currentSceneData = module.createScene({
    thirdPersonCamera: { distance: THIRD_PERSON_DIST, height: THIRD_PERSON_HEIGHT, right: THIRD_PERSON_RIGHT },
    onPlayable: () => {
      if (activeSceneId !== 'prologue1') return;
      isThirdPerson = true;
      if (globalCharacter && activeScene) activeScene.add(globalCharacter.model);
      globalCharacter?.setFacing(currentPlayer!.getState().yaw);
      updatePlayerView(0);
    },
    onFinished: async () => {
      if (activeSceneId !== 'prologue1') return;
      isThirdPerson = true;
      await loadStage1Storage();
    },
  });
  activeScene = currentSceneData.scene;
  activeCamera = currentSceneData.camera;
  currentPlayer = currentSceneData.player;
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = null;
  if (orbitControls) { orbitControls.object = activeCamera!; orbitControls.enabled = false; }
}

async function loadStage1Storage() {
  const module = await prepareScene(1.1);
  if (!module) return;
  hideScene1Skip();
  retireTraversalRoom();
  currentSceneData?.dispose?.();
  const sceneData = module.createScene({ hintsEnabled: stealthHintsEnabled, openingEntry: true, onComplete: () => {
    if (activeSceneId === 'stage1-storage') void loadScene2(true, true);
  } });
  enterManagedScene('stage1-storage', sceneData);
  currentSceneData = sceneData;
  activeScene = sceneData.scene;
  activeCamera = sceneData.camera;
  currentPlayer = sceneData.player;
  updatePhysics = sceneData.updatePhysics;
  cutsceneManager = null;
  isThirdPerson = true;
  if (globalCharacter) {
    activeScene.add(globalCharacter.model);
    globalCharacter.setHologramTransition(sceneData.getHologramTransition());
    globalCharacter.setFacing(currentPlayer.getState().yaw);
  }
  if (orbitControls) { orbitControls.object = activeCamera; orbitControls.enabled = false; }
  updatePlayerView(0);
  warmScene(2);
}

// --- Load Scene 1 ---
function loadScene1() {
  sceneRequestVersion++;
  activeSceneId = 'scene1'; currentPlayer = null;
  enterHudScene('scene1');
  document.getElementById('quit-btn')!.textContent = "DON’T PLAY";
  const quitButton = document.getElementById('quit-btn') as HTMLButtonElement;
  quitButton.classList.remove('no-choice', 'hidden'); quitButton.disabled = false;
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
        scene1SkipHold?.dispose(); scene1SkipHold = null;
        skipBtn.classList.add('hidden');
        showCredits();
      }
    };

    scene1SkipHold?.dispose();
    scene1SkipHold = createHoldToSkip({ button: skipBtn as HTMLButtonElement,
      isAvailable: () => scene1SkipVisible && currentSceneData === introScene,
      isPaused: () => quickMenuOpen,
      onSkip: () => {
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
      },
    });
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
    const quitButton = document.getElementById('quit-btn') as HTMLButtonElement;
    quitButton.textContent = 'YOU DON’T HAVE A CHOICE.';
    quitButton.disabled = true; quitButton.classList.add('no-choice');
    quitButton.addEventListener('animationend', () => {
      quitButton.classList.add('hidden');
    }, { once: true });
  });
}

function transitionToScene2() {
  console.log('Starting transition to prologue scene 1');
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
      scheduleSceneAction(async () => {
        try { await loadPrologue1(); } catch (e) { console.error('Error loading the opening sequence:', e); }
        fadeOverlay.classList.remove('active');
        scheduleSceneAction(() => { fadeOverlay.classList.add('hidden'); }, 1500);
      }, 1500);
    }
  };
}

async function loadScene2(skipWake = false, openingEntry = false) {
  const module = await prepareScene(2);
  if (!module) return;
  console.log('Loading scene 2...');

  globalCharacter?.model.removeFromParent();
  if (currentSceneData === scene1Data || activeSceneId === 'prologue1') currentSceneData?.dispose?.();
  retireTraversalRoom();
  const sceneData = module.createScene({ audioManager, skipWake, openingEntry });
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
  globalCharacter?.setHologramTransition(currentSceneData.getHologramTransition?.() ?? null);

  if (currentSceneData.setDoorTrigger) {
    currentSceneData.setDoorTrigger((state: PlayerTransitionState) => { transitionToScene3(state); });
  }
  renderer.render(activeScene!, activeCamera!);
}

async function loadScene3(entryState?: PlayerTransitionState) {
  const module = await prepareScene(3);
  if (!module) return;
  console.log('Loading scene 3...');

  const sceneData = module.createScene({ audioManager, entryState, ...cargoAccess() });
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

async function transitionToScene3(entryState: PlayerTransitionState) {
  console.log('Transitioning to scene 3');
  try { await loadScene3(entryState); } catch (e) { console.error('Error loading scene 3:', e); }
}

async function transitionBackToScene2(entryState: PlayerTransitionState) {
  console.log('Returning to scene 2 (skip wake)');
  try {
    const module = await prepareScene(2);
    if (!module) return;
    const sceneData = module.createScene({ audioManager, skipWake: true, entryState });
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

async function loadScene4(entryState?: PlayerTransitionState, entryDoor: 'back' | 'front' = 'back') {
  const module = await prepareScene(4);
  if (!module) return;
  void prepareFirstPersonHands();
  console.log('Loading scene 4...');

  const sceneData = module.createScene({
    audioManager, entryState, entryDoor, cafeteriaUnlocked: hasCrowbar, chestOpened: hasCrowbar,
    onChestCollected: () => {
      hasCrowbar = true;
      crowbar.equip();
      introduceControls('crowbar');
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

async function transitionToScene4() {
  console.log('Transitioning to scene 4');
  // Capture player state for transition - scene3's forward door is at -Z (z = -10)
  // Use yaw: 0 so the player's position is preserved correctly through the transition
  if (currentPlayer) {
    const state = currentPlayer.captureDoorTransition({ x: 0, y: 0, z: -10, yaw: 0 });
    try { await loadScene4(state); } catch (e) { console.error('Error loading scene 4:', e); }
  }
}

async function loadScene7(entryState?: PlayerTransitionState) {
  const module = await prepareScene(7);
  if (!module) return;
  console.log('Loading scene 7 - cafeteria...');
  document.getElementById('skip-btn')?.classList.add('hidden');
  const sceneData = module.createScene({ entryState, ...ladderAccess() });
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

async function transitionToScene7(entryState: PlayerTransitionState) {
  try { await loadScene7(entryState); } catch (error) { console.error('Error loading scene 7:', error); }
}

async function transitionBackToScene4(entryState: PlayerTransitionState) {
  try { await loadScene4(entryState, 'front'); } catch (error) { console.error('Error returning to scene 4:', error); }
}

function hideScene1Skip() {
  scene1SkipVisible = false;
  scene1SkipHold?.dispose(); scene1SkipHold = null;
  document.getElementById('skip-btn')?.classList.add('hidden');
  document.querySelectorAll('.wake-skip-btn').forEach(button => button.remove());
  document.getElementById('interact-prompt')?.classList.add('hidden');
}

function enterManagedScene(id: string, sceneData: any) {
  lightsaber.detach();
  heldSwitchHandle.removeFromParent();
  globalCharacter?.model.removeFromParent();
  npcManager.enterScene(id, sceneData);
  activeSceneId = id;
  enterHudScene(id);
  const damage = document.getElementById('player-damage');
  if (damage) damage.style.opacity = '0';
  const sceneId = Number(id.slice(5)) as SceneModuleId;
  for (const next of upcomingScenes[sceneId] ?? []) warmScene(next);
  if (sceneId === 2) warmScene(13);
  if (sceneId === 3) void background(() => prepareFirstPersonHands());
  if (sceneId === 14) void background(() => preloadAudio(flightMusicUrl));
  if (sceneId === 15) {
    void background(() => preloadAudio(jungleMusicUrl));
    void background(preloadJungleModels);
  }
}

function retireTraversalRoom() {
  // The persistent character is not scene-owned geometry.
  lightsaber.detach();
  heldSwitchHandle.removeFromParent();
  globalCharacter?.model.removeFromParent();
  npcManager.leaveScene();
}

function fadeTraversal(complete: () => void | Promise<void>) {
  traversalState = currentPlayer?.captureTransition({ x: 0, y: 0, z: 0 });
  hideScene1Skip();
  const fade = document.getElementById('fade-overlay');
  if (!fade) { retireTraversalRoom(); complete(); return; }
  fade.classList.remove('hidden');
  fade.classList.add('black');
  void fade.clientWidth;
  fade.classList.add('active');
  scheduleSceneAction(async () => {
    retireTraversalRoom();
    await complete();
    scheduleSceneAction(() => {
      fade.classList.remove('active');
      scheduleSceneAction(() => { fade.classList.remove('black'); fade.classList.add('hidden'); }, 300);
    }, 120);
  }, 300);
}

async function loadScene8(entry: 'galley' | 'deck' = 'galley') {
  const module = await prepareScene(8);
  if (!module) return;
  hideScene1Skip();
  const sceneData = module.createScene({ entry, entryState: traversalState, puzzle: cargoPuzzle });
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

async function loadScene7FromVent(drop = false) {
  const module = await prepareScene(7);
  if (!module) return;
  hideScene1Skip();
  const sceneData = module.createScene(ladderAccess());
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

async function loadScene9(entryState?: PlayerTransitionState, fromPassage = false, dropFromLadder = false) {
  const module = await prepareScene(9);
  if (!module) return;
  hideScene1Skip();
  const sceneData = module.createScene({ entryState, fromPassage, dropFromLadder, puzzle: cargoPuzzle });
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

async function loadExtensionRoom(id: 10 | 11 | 13, entryState?: PlayerTransitionState, fromPassage = false, checkpoint = false) {
  const module = await prepareScene(id);
  if (!module) return;
  const request = sceneRequestVersion;
  const options = { entryState, fromPassage, puzzle: cargoPuzzle };
  const sceneData = module.createScene({
      ...options, defeated: bayBossDefeated, checkpoint, renderer,
      onDefeated: () => { bayBossDefeated = true; }, onDescend: loadHangar14,
      onRespawn: () => loadExtensionRoom(13, undefined, false, true),
      healthPackCollected: healthPackCollectedScene13,
      onHealthPackCollected: () => { healthPackCollectedScene13 = true; },
    });
  if ('ready' in sceneData) await sceneData.ready;
  if (request !== sceneRequestVersion) { sceneData.dispose(); return; }
  retireTraversalRoom();
  activateExtension(sceneData, `scene${id}`);
  sceneData.setBackTrigger(state => loadPassage12(state, id));
}

async function loadHangar14(entryState?: PlayerTransitionState) {
  const module = await prepareScene(14);
  if (!module) return;
  bayBossDefeated = true;
  hideScene1Skip(); retireTraversalRoom();
  const sceneData = module.createScene({
    entryState,
    onFailure: () => {
      // A fresh living player, with session inventory and the boss defeat preserved.
      loadExtensionRoom(13, undefined, false, true);
    },
    onLaunch: loadFlight15,
  });
  activateExtension(sceneData, 'scene14');
}

async function loadFlight15(entryState?: LaunchState, startAt?: 'scrambler' | 'topdownScrambler') {
  const module = await prepareScene(15);
  if (!module) return;
  hideScene1Skip(); retireTraversalRoom();
  activateExtension(module.createScene({ entryState, startAt, onTransition: loadCrash16 }), 'scene15');
  setTouchFlightMode(true);
}

async function loadCrash16(entryState?: FlightExitState) {
  const module = await prepareScene(16);
  if (!module) return;
  hideScene1Skip(); retireTraversalRoom();
  setTouchFlightMode(false);
  activateExtension(module.createScene({
    entryState,
    onFinished: loadGround17,
  }), 'scene16');
}

async function loadGround17(entryState?: RescueArrival) {
  const module = await prepareScene(17);
  if (!module) return;
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
  activateExtension(module.createScene({
    entryState, onPlatformer: loadPlatformer18,
    onRespawn: () => loadGround17(checkpointArrival(entryState)),
  }), 'scene17');
}

function checkpointArrival(entryState?: RescueArrival): RescueArrival {
  return { ...entryState, cameraPosition: undefined, cameraQuaternion: undefined, cameraFov: undefined,
    pilotState: entryState?.pilotState ? { ...entryState.pilotState, health: PLAYER_MAX_HEALTH } : undefined };
}

async function loadPlatformer18(entryState?: RescueArrival) {
  const module = await prepareScene(18);
  if (!module) return;
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
  activateExtension(module.createScene({ entryState, onFinished: loadGround19,
    onRespawn: state => loadPlatformer18(checkpointArrival(state)),
  }), 'scene18');
}

async function loadGround19(entryState?: RescueArrival) {
  const module = await prepareScene(19);
  if (!module) return;
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
  activateExtension(module.createScene({ entryState,
    onRespawn: () => loadGround19(checkpointArrival(entryState)),
  }), 'scene19');
}

async function loadPassage12(entryState?: PlayerTransitionState, from: PassageDestination = 10) {
  const module = await prepareScene(12);
  if (!module) return;
  retireTraversalRoom();
  const sceneData = module.createScene({ entryState, from, puzzle: cargoPuzzle, hasLightsaber,
    onLightsaberCollected: () => { hasLightsaber = true; lightsaber.equip(); introduceControls('lightsaber'); },
  });
  activateExtension(sceneData, 'scene12');
  for (const id of [9, 10, 11, 13] as const) sceneData.setDoorTrigger(id, state => {
    if (id === 9) { retireTraversalRoom(); loadScene9(state, true); }
    else loadExtensionRoom(id, state, true);
  });
}

async function transitionBackToScene3(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 4');
  try {
    const module = await prepareScene(3);
    if (!module) return;
    const sceneData = module.createScene({ audioManager, entryState, entryDoor: 'back', ...cargoAccess() });
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

async function loadScene5(entryState?: PlayerTransitionState) {
  const module = await prepareScene(5);
  if (!module) return;
  console.log('Loading scene 5...');
  hideScene1Skip();

  const sceneData = module.createScene({ audioManager, entryState });
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

async function transitionToScene5(entryState: PlayerTransitionState) {
  console.log('Transitioning to scene 5');
  try { await loadScene5(entryState); } catch (e) { console.error('Error loading scene 5:', e); }
}

async function transitionBackToScene3FromLeft(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 5');
  try {
    const module = await prepareScene(3);
    if (!module) return;
    const sceneData = module.createScene({ audioManager, entryState, entryDoor: 'left', ...cargoAccess() });
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

async function loadScene6(entryState?: PlayerTransitionState) {
  const module = await prepareScene(6);
  if (!module) return;
  console.log('Loading scene 6...');

  const sceneData = module.createScene({ audioManager, entryState, gogglesCollected: goggles.isCollected(),
    onGogglesCollected: () => { goggles.collect(); introduceControls('goggles'); } });
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

async function transitionToScene6(entryState: PlayerTransitionState) {
  console.log('Transitioning to scene 6');
  try { await loadScene6(entryState); } catch (e) { console.error('Error loading scene 6:', e); }
}

async function transitionBackToScene3FromRight(entryState: PlayerTransitionState) {
  console.log('Returning to scene 3 from scene 6');
  try {
    const module = await prepareScene(3);
    if (!module) return;
    const sceneData = module.createScene({ audioManager, entryState, entryDoor: 'right', ...cargoAccess() });
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
  if (deathPresentation?.player === currentPlayer) {
    resetThirdPersonCamera(activeCamera);
    const { elapsed, position, rotation, fov } = deathPresentation;
    pistol.update(dt); crowbar.update(dt);
    globalCharacter?.weapon.setEquipped(false); globalCharacter?.setCrowbarEquipped(false); globalCharacter?.setLightsaberEquipped(false);
    globalCharacter?.update(dt, currentPlayer.body.position, currentPlayer.getState(), true, currentPlayer.radius,
      { clip: 'Death01', time: elapsed });
    const yaw = currentPlayer.getState().yaw, focus = new THREE.Vector3().copy(currentPlayer.body.position);
    focus.y += 0.55;
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const target = focus.clone().addScaledVector(back, 6.5).add(new THREE.Vector3(1.2, 2.8, 0));
    const reveal = THREE.MathUtils.smootherstep(elapsed, 0, 1.5);
    activeCamera.position.lerpVectors(position, target, reveal);
    const view = activeCamera.clone(); view.position.copy(target); view.lookAt(focus);
    activeCamera.quaternion.slerpQuaternions(rotation, view.quaternion, reveal);
    activeCamera.fov = THREE.MathUtils.lerp(fov, 78, reveal); activeCamera.updateProjectionMatrix();
    return;
  }
  const cinematicState = currentSceneData?.getCinematicState?.();
  if (cinematicState) {
    resetThirdPersonCamera(activeCamera);
    // Remove ordinary weapon presentation before the scene applies its scripted props.
    pistol.update(dt); crowbar.update(dt);
    globalCharacter?.weapon.setEquipped(!!currentSceneData.ownsWeaponInput && currentSceneData.getCinematicWeapon?.() === 'pistol');
    globalCharacter?.setCrowbarEquipped(currentSceneData.getCinematicWeapon?.() === 'crowbar');
    globalCharacter?.setLightsaberEquipped(currentSceneData.getCinematicWeapon?.() === 'lightsaber');
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
  if (!currentPlayer.isEnabled()) { resetThirdPersonCamera(activeCamera); return; }
  // Always start from the base camera, including the first render after a scene swap.
  const state = currentPlayer.getState();
  const traversalView = isThirdPerson || !!currentSceneData?.forceThirdPerson || state.climbing || state.boxHandling;
  const sceneWeapon = !!currentSceneData?.ownsWeaponInput;
  if (sceneWeapon) {
    pistol.update(0); crowbar.update(0);
    globalCharacter?.weapon.setEquipped(currentSceneData.getCinematicWeapon?.() === 'pistol');
    globalCharacter?.setCrowbarEquipped(currentSceneData.getCinematicWeapon?.() === 'crowbar');
    globalCharacter?.setLightsaberEquipped(currentSceneData.getCinematicWeapon?.() === 'lightsaber');
  }
  currentPlayer.updateCamera(0, traversalView);
  const followView = traversalView && !state.ventMode && !state.climbing;
  const thirdPersonView = followView ? applyThirdPersonCamera(activeCamera, currentPlayer, dt,
    { distance: THIRD_PERSON_DIST, height: THIRD_PERSON_HEIGHT, right: THIRD_PERSON_RIGHT }) : traversalView;
  if (!followView) resetThirdPersonCamera(activeCamera);
  globalCharacter?.update(sceneWeapon ? currentSceneData.getCinematicDelta?.() ?? dt : dt,
    currentPlayer.body.position, state, thirdPersonView, currentPlayer.radius);
  if (sceneWeapon) currentSceneData.updateCinematicCharacter?.(globalCharacter);
  if (state.ventMode) {
    resetThirdPersonCamera(activeCamera);
    currentSceneData?.applyVentCamera?.(traversalView);
    return;
  }
  if (applyTraversalCamera(activeCamera, currentPlayer, traversalView)) {
    resetThirdPersonCamera(activeCamera);
    return;
  }
  currentSceneData?.applyEntryCamera?.();
}

// --- Direct scene selection ---
const SCENE_CHOICES = [
  [0, 'Prologue — awakening'],
  [1.1, 'Level 1 stage 1 - Deck One Hangar'],
  [1, 'Space prologue'], [2, 'Medical bay'], [3, 'Passageway'], [4, 'Computer room'],
  [5, 'Cargo hold'], [6, 'Target range'], [7, 'Cafeteria'], [8, 'Vent junction'],
  [9, 'Zero-gravity loading bay'], [10, 'Durable cargo puzzle'], [11, 'Mixed cargo puzzle'],
  [12, 'Transfer passage'], [13, 'Bay Warden boss'], [14, 'Hangar escape'],
  [15, 'Space combat'], [15.5, 'Sidescroll Scrambler'], [15.75, 'Top-down Red Scrambler'], [16, 'Jungle crash cutscene'],
  [17, 'Jungle bridge scrambler'], [18, 'Jungle platformer'], [19, 'Facility approach'],
] as const;
const quickMenu = document.getElementById('scene-quick-menu') as HTMLDialogElement;
const pauseMenu = document.getElementById('pause-menu') as HTMLDialogElement;
const developerPassword = document.getElementById('developer-password') as HTMLInputElement;
const developerError = document.getElementById('developer-password-error')!;
type MenuScreen = 'home' | 'map' | 'sound' | 'controls' | 'developer' | 'scenes';
let menuScreen: MenuScreen | null = null;
let shipMap: ReturnType<typeof createShipMap> | null = null;
let controlsReturnScreen: 'home' | 'scenes' = 'home';
// Memory only: survives menus and scene changes, but resets on browser refresh.
let developerUnlocked = false;
let resumePointerTarget: HTMLElement | null = null;

function clearSceneInput() {
  resetTouchInput();
  currentPlayer?.clearInput();
  currentSceneData?.clearInput?.();
}
function renderControlsReference() {
  const owned = new Set<string>(['pistol']);
  if (hasCrowbar) owned.add('crowbar');
  if (hasLightsaber) owned.add('lightsaber');
  if (goggles.isCollected()) owned.add('goggles');
  const touch = document.body.classList.contains('touch-device');
  document.getElementById('pause-controls-description')!.textContent = developerUnlocked
    ? 'Developer mode: all tool and tutorial controls are available.'
    : 'Controls for your tools and tutorials you have already seen.';
  const entries = Object.entries(lessons)
    .filter(([key]) => developerUnlocked || owned.has(key) || seenControls.has(key))
    .map(([key, lesson]) => {
      const section = document.createElement('section');
      section.className = 'pause-control-entry';
      const heading = document.createElement('h2');
      heading.id = `pause-control-${key}`;
      heading.textContent = lesson.title;
      section.setAttribute('aria-labelledby', heading.id);
      section.appendChild(heading);
      for (const text of touch ? lesson.touch : lesson.lines) {
        const line = document.createElement('p');
        line.textContent = text;
        section.appendChild(line);
      }
      return section;
    });
  const list = document.getElementById('pause-controls-list')!;
  list.replaceChildren(...entries);
  list.scrollTop = 0;
}
function setPauseMenu(screen: MenuScreen | null, restorePointer = true) {
  if (screen === 'developer' && developerUnlocked) screen = 'scenes';
  if (screen === menuScreen) return;
  const prologue = activeSceneId === 'scene1';
  if (prologue && (screen === 'sound' || (screen === 'controls' && !developerUnlocked))) return;
  if (screen === 'scenes' && (!quickMenuOpen || !developerUnlocked)) return;
  if (screen === 'controls') controlsReturnScreen = menuScreen === 'scenes' ? 'scenes' : 'home';
  const wasOpen = quickMenuOpen;
  menuScreen = screen;
  document.body.classList.toggle('ship-map-open', screen === 'map');
  if (screen !== 'map') shipMap?.hide();
  quickMenuOpen = screen !== null;
  pauseMenu.dataset.screen = screen ?? '';
  developerPassword.value = '';
  developerPassword.removeAttribute('aria-invalid');
  developerError.textContent = '';
  if (!wasOpen && quickMenuOpen) {
    resumePointerTarget = document.pointerLockElement as HTMLElement | null;
    if (resumePointerTarget) document.exitPointerLock();
    document.getElementById('scene-menu-error')!.textContent = '';
  }
  clearSceneInput();
  document.body.classList.toggle('quick-menu-open', quickMenuOpen);
  if (quickMenuOpen) setAudioMenuPaused(true);
  currentSceneData?.setMenuPaused?.(quickMenuOpen);
  if (!quickMenuOpen) setAudioMenuPaused(false);

  const dialog = screen === 'scenes' ? quickMenu : screen ? pauseMenu : null;
  for (const other of [pauseMenu, quickMenu]) {
    if (other !== dialog && other.open) other.close();
  }
  if (!dialog) {
    renderer.domElement.focus();
    const target = resumePointerTarget;
    resumePointerTarget = null;
    if (restorePointer && target?.isConnected && currentPlayer?.isEnabled()
      && !currentSceneData?.isCinematic?.() && !document.body.classList.contains('touch-device')) {
      try { void Promise.resolve(target.requestPointerLock()).catch(() => {}); } catch { /* Click the world to recapture if denied. */ }
    }
    return;
  }
  if (screen !== 'scenes') {
    document.getElementById('pause-menu-title')!.textContent = screen === 'controls' ? (developerUnlocked ? 'All Controls' : 'Controls')
      : screen === 'map' ? 'Ship Map' : screen === 'sound' ? 'Sound' : screen === 'developer' || prologue ? 'Developer Mode' : 'Pause';
    document.getElementById('pause-home')!.classList.toggle('hidden', screen !== 'home');
    document.getElementById('pause-stealth-settings')!.classList.toggle('hidden', screen !== 'home' || !currentSceneData?.setHintsEnabled);
    (document.getElementById('stealth-hints-toggle') as HTMLInputElement).checked = currentSceneData?.getHintsEnabled?.() ?? stealthHintsEnabled;
    document.getElementById('pause-map-panel')!.classList.toggle('hidden', screen !== 'map');
    document.getElementById('pause-sound-panel')!.classList.toggle('hidden', screen !== 'sound');
    document.getElementById('pause-controls-panel')!.classList.toggle('hidden', screen !== 'controls');
    document.getElementById('pause-developer-form')!.classList.toggle('hidden', screen !== 'developer');
    for (const id of ['pause-resume', 'pause-sound', 'pause-controls']) document.getElementById(id)!.classList.toggle('hidden', prologue);
    if (screen === 'controls') renderControlsReference();
    if (screen === 'sound') {
      const settings = getAudioSettings();
      for (const channel of ['bgm', 'sfx'] as const) {
        const value = String(Math.round(settings[channel] * 100));
        (document.getElementById(`${channel}-volume`) as HTMLInputElement).value = value;
        document.getElementById(`${channel}-volume-value`)!.textContent = `${value}%`;
      }
    }
  }
  if (!dialog.open) dialog.showModal();
  if (screen === 'map') {
    shipMap ??= createShipMap(renderer, document.getElementById('ship-map-view')!);
    shipMap.open(currentSceneData?.getSceneId?.() ?? activeSceneId, currentPlayer?.body.position, currentPlayer?.getState().yaw);
    document.querySelector<HTMLElement>('.ship-map-canvas')?.focus();
    return;
  }
  if (screen === 'scenes') {
    const buttons = quickMenu.querySelectorAll<HTMLButtonElement>('[data-scene]');
    const currentId = currentSceneData?.getSceneId?.() ?? activeSceneId;
    buttons.forEach(button => button.setAttribute('aria-current', String(`scene${button.dataset.scene}` === currentId)));
    const current = quickMenu.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? buttons[0];
    current?.focus(); current?.scrollIntoView({ block: 'nearest' });
  } else {
    const focusId = screen === 'controls' ? 'pause-controls-list' : screen === 'sound' ? 'bgm-volume'
      : screen === 'developer' ? 'developer-password' : prologue ? 'pause-developer' : 'pause-resume';
    document.getElementById(focusId)?.focus();
  }
}
function backFromMenu() {
  setPauseMenu(menuScreen === 'home' ? null : menuScreen === 'controls' ? controlsReturnScreen : 'home');
}
async function jumpToScene(id: number) {
  if (menuScreen !== 'scenes' || !developerUnlocked || !SCENE_CHOICES.some(([scene]) => scene === id)) return;
  pendingSceneActions.clear(); creditsTimer = null;
  setTouchFlightMode(false);
  clearSceneInput();
  // Detach persistent gear before the outgoing scene disposes its meshes.
  pistol.holster(); crowbar.holster(); lightsaber.holster(); pistol.update(0); crowbar.update(0); lightsaber.update(0);
  globalCharacter?.model.removeFromParent();
  if (activeSceneId === 'prologue1') currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) { currentSceneData?.dispose?.(); scene1Data = null; }
  retireTraversalRoom();
  currentSceneData = null; currentPlayer = null; activeScene = null; activeCamera = null;
  updatePhysics = null; cutsceneManager = null; traversalState = undefined; lastSplinePoint = null;
  hideScene1Skip();
  for (const overlay of ['credits-overlay', 'menu-buttons', 'crowbar-overlay', 'boss-hud', 'boss-subtitles', 'escape-qte', 'loading-bay-status', 'space-cinematic-caption']) document.getElementById(overlay)?.classList.add('hidden');
  const fade = document.getElementById('fade-overlay'); fade?.classList.remove('active', 'black'); fade?.classList.add('hidden');
  // Developer spawn grants the tools but equips nothing; the player selects them per scene.
  hasCrowbar = true; hasLightsaber = true; shieldCollectedScene7 = true; goggles.collect(false);
  if (id >= 8 && id <= 12) cargoPuzzle = createCargoPuzzleState(id);
  if (id === 13) bayBossDefeated = false;
  const request = sceneRequestVersion + 1;
  try {
    switch (id) {
      case 0: await loadPrologue1(); break;
      case 1.1: await loadStage1Storage(); break;
      case 1: loadScene1(); break;
      case 2: await loadScene2(true); break;
      case 3: await loadScene3(); break;
      case 4: await loadScene4(); break;
      case 5: await loadScene5(); break;
      case 6: await loadScene6(); break;
      case 7: await loadScene7(); break;
      case 8: await loadScene8(); break;
      case 9: await loadScene9(); break;
      case 10: case 11: case 13: await loadExtensionRoom(id); break;
      case 12: await loadPassage12(); break;
      case 14: await loadHangar14(); break;
      case 15: await loadFlight15(); break;
      case 15.5: await loadFlight15(undefined, 'scrambler'); break;
      case 15.75: await loadFlight15(undefined, 'topdownScrambler'); break;
      case 16: await loadCrash16(); break;
      case 17: await loadGround17(); break;
      case 18: await loadPlatformer18(); break;
      case 19: await loadGround19(); break;
    }
    if (request !== sceneRequestVersion) return;
    const spawnedPlayer = currentSceneData?.player as Player | undefined;
    if (spawnedPlayer) {
      const spawn = spawnedPlayer.captureTransition({ x: 0, y: 0, z: 0 });
      spawnedPlayer.restoreTransition({ ...spawn, health: PLAYER_MAX_HEALTH, shield: spawnedPlayer.getMaxShield() },
        { x: 0, y: 0, z: 0, yaw: -Math.PI });
    }
    goggles.update(); updatePlayerView(0);
    document.getElementById('scene-menu-error')!.textContent = '';
    setPauseMenu(null, false);
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
  pauseMenu.addEventListener('click', event => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.id === 'pause-resume' || button?.id === 'pause-close') setPauseMenu(null);
    else if (button?.id === 'pause-ship-map') setPauseMenu('map');
    else if (button?.id === 'pause-sound') setPauseMenu('sound');
    else if (button?.id === 'pause-controls') setPauseMenu('controls');
    else if (button?.id === 'pause-developer') setPauseMenu('developer');
    else if (button?.hasAttribute('data-pause-back')) backFromMenu();
  });
  for (const channel of ['bgm', 'sfx'] as const) {
    const slider = document.getElementById(`${channel}-volume`) as HTMLInputElement;
    slider.addEventListener('input', () => {
      setAudioVolume(channel, slider.valueAsNumber / 100);
      document.getElementById(`${channel}-volume-value`)!.textContent = `${slider.value}%`;
    });
  }
  const hintToggle = document.getElementById('stealth-hints-toggle') as HTMLInputElement;
  hintToggle.addEventListener('change', () => {
    stealthHintsEnabled = hintToggle.checked;
    currentSceneData?.setHintsEnabled?.(stealthHintsEnabled);
  });
  document.getElementById('pause-developer-form')!.addEventListener('submit', event => {
    event.preventDefault(); event.stopPropagation();
    if (menuScreen !== 'developer' || !pauseMenu.open) return;
    // This is a local testing convenience, not a security boundary.
    if (developerPassword.value !== 'brondon') {
      developerPassword.value = '';
      developerPassword.setAttribute('aria-invalid', 'true');
      developerError.textContent = 'Incorrect password. Try again.';
      developerPassword.focus();
      return;
    }
    developerUnlocked = true;
    setPauseMenu('scenes');
  });
  developerPassword.addEventListener('input', () => {
    developerPassword.removeAttribute('aria-invalid');
    developerError.textContent = '';
  });
  quickMenu.addEventListener('click', event => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset.scene) jumpToScene(Number(button.dataset.scene));
    else if (button?.id === 'scene-quick-controls') setPauseMenu('controls');
    else if (button?.id === 'scene-quick-close') setPauseMenu('home');
  });
  for (const dialog of [pauseMenu, quickMenu]) {
    dialog.addEventListener('cancel', event => { event.preventDefault(); backFromMenu(); });
    for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
      dialog.addEventListener(type, event => event.stopPropagation());
    }
  }
  pauseMenu.addEventListener('close', () => {
    if (!pauseMenu.open && menuScreen !== null && menuScreen !== 'scenes') setPauseMenu(null, false);
  });
  quickMenu.addEventListener('close', () => {
    if (!quickMenu.open && menuScreen === 'scenes') setPauseMenu('home');
  });
  const insideMenu = (event: Event) => event.target instanceof Node
    && (pauseMenu.contains(event.target) || quickMenu.contains(event.target));
  window.addEventListener('keydown', event => {
    const editing = event.target instanceof HTMLElement
      && event.target.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]');
    if (event.code === 'KeyM' && !editing && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) setPauseMenu(quickMenuOpen ? null : 'home');
      return;
    }
    if (!quickMenuOpen) return;
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) backFromMenu();
      return;
    }
    if (menuScreen === 'scenes' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const buttons = Array.from(quickMenu.querySelectorAll<HTMLButtonElement>('[data-scene]'));
      const focused = document.activeElement as HTMLButtonElement | null;
      const index = Math.max(0, buttons.indexOf(focused!));
      const next = event.code === 'Home' ? 0 : event.code === 'End' ? buttons.length - 1 : (index + (event.code === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!insideMenu(event)) event.stopImmediatePropagation();
  }, true);
  // Capture before scene input handlers; native dialog scrolling/focus still works.
  for (const type of ['keyup', 'click', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
    window.addEventListener(type, event => {
      if (quickMenuOpen && !insideMenu(event)) event.stopImmediatePropagation();
    }, true);
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
const healthFillEl = document.getElementById('health-bar-fill');
const healthLabelEl = document.getElementById('health-bar-label');
const healthBarEl = document.getElementById('health-bar');
const shieldFillEl = document.getElementById('shield-bar-fill');
const shieldLabelEl = document.getElementById('shield-bar-label');
const shieldBarEl = document.getElementById('shield-bar');
const playerDamageEl = document.getElementById('player-damage');
let deathPresentation: { player: Player; elapsed: number; managed: boolean;
  position: THREE.Vector3; rotation: THREE.Quaternion; fov: number } | null = null;

/** Reloads scene 2, whose wake-up sequence always spawns the player at the capsule. */
function respawnAtCapsule() {
  console.log('Player died - respawning at capsule');
  try { loadScene2(); } catch (e) { console.error('Error respawning player:', e); }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  scene1SkipHold?.update(delta);
  if (quickMenuOpen) {
    controlCard.classList.add('hidden');
    if (shipMap?.visible) { shipMap.render(); return; }
    if (activeScene && activeCamera) renderGameScene(currentSceneData?.getRenderScene?.() ?? activeScene, activeCamera);
    renderMinimap();
    return;
  }
  advanceSceneActions(Math.min(delta, 0.1));
  if (!scene1SkipVisible) document.getElementById('skip-btn')?.classList.add('hidden');

  // Health bar + death/respawn
  if (currentPlayer) {
    if (deathPresentation && deathPresentation.player !== currentPlayer) deathPresentation = null;
    const health = currentPlayer.getHealth();
    const pct = Math.max(0, health / PLAYER_MAX_HEALTH);
    if (healthFillEl) {
      healthFillEl.style.width = `${pct * 100}%`;
      healthFillEl.classList.toggle('low', pct <= 0.3);
      healthFillEl.classList.toggle('mid', pct > 0.3 && pct <= 0.6);
    }
    if (healthLabelEl) healthLabelEl.textContent = `${Math.max(0, Math.ceil(health))} / ${PLAYER_MAX_HEALTH}`;
    healthBarEl?.setAttribute('aria-valuenow', String(Math.max(0, Math.ceil(health))));
    const shield = currentPlayer.getShield();
    const maxShield = currentPlayer.getMaxShield();
    const shieldPct = maxShield > 0 ? Math.max(0, shield / maxShield) : 0;
    if (shieldFillEl) shieldFillEl.style.width = `${shieldPct * 100}%`;
    if (shieldLabelEl) shieldLabelEl.textContent = `${Math.max(0, Math.ceil(shield))} / ${maxShield}`;
    shieldBarEl?.setAttribute('aria-valuenow', String(Math.max(0, Math.ceil(shield))));
    if (currentPlayer.isEnabled() && health <= 0 && !deathPresentation) {
      const managed = !!currentSceneData?.onPlayerDeath?.();
      deathPresentation = { player: currentPlayer, elapsed: 0, managed, position: activeCamera!.position.clone(),
        rotation: activeCamera!.quaternion.clone(), fov: activeCamera!.fov };
      if (!managed) currentPlayer.disable();
    }
    if (deathPresentation) {
      deathPresentation.elapsed += Math.min(delta, 0.1);
      if (!deathPresentation.managed && deathPresentation.elapsed >= 2.5) { deathPresentation = null; respawnAtCapsule(); }
    }
  }
  if (healthBarEl) healthBarEl.style.display = activeSceneId === 'scene1' || activeSceneId === 'prologue1' ? 'none' : '';
  if (shieldBarEl) shieldBarEl.style.display = activeSceneId === 'scene1' || activeSceneId === 'prologue1' ? 'none' : '';

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
    const inCutscene = !!cutsceneManager || !!deathPresentation || !!currentSceneData?.isCinematic?.();
    crosshair.style.display = (inScene1 || inCutscene || !pistol.isAiming()) ? 'none' : '';
  }

  const sceneOwnsControls = !!deathPresentation || !!currentSceneData?.isCinematic?.();
  updateViewButton();
  updateControlCard(delta);

  if (hintManager && currentPlayer) {
    hintManager.update(delta, {
      currentScene: activeSceneId,
      hasCrowbar,
      hasLightsaber,
      hasPistol: true,
      hasGoggles: goggles.isCollected(),
      shieldCollected: shieldCollectedScene7,
      healthPackCollected: healthPackCollectedScene13,
      bossDefeated: bayBossDefeated,
      ladderCratesCleared: clearedLadderCrates.size > 0,
      cargoDoorUnlocked,
      playerPosition: { x: currentPlayer.body.position.x, y: currentPlayer.body.position.y, z: currentPlayer.body.position.z },
    });
  }

  // Character animations + view
  goggles.update();
  updatePlayerView(delta);
  globalCharacter?.setHologramTransition(currentSceneData?.getHologramTransition?.() ?? null);

  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput) { pistol.update(delta); crowbar.update(delta); }
  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput) lightsaber.update(delta);
  else lightsaber.detach();
  heldSwitchHandle.visible = cargoPuzzle.handle === 'carried' && !sceneOwnsControls && !!currentPlayer?.isEnabled();
  if (heldSwitchHandle.visible && currentPlayer && activeScene && activeCamera) {
    activeScene.add(heldSwitchHandle);
    const yaw = currentPlayer.getState().yaw, p = currentPlayer.body.position;
    if (isGameplayThirdPerson()) {
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
    renderGameScene(currentSceneData?.getRenderScene?.() ?? activeScene, activeCamera);
    renderMinimap();
  }
}

animate();
