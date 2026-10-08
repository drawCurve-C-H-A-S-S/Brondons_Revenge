import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyThirdPersonCamera, applyTraversalCamera, isCameraForcedFirstPerson, resetThirdPersonCamera } from './core/camera.js';
import { disposeComicEffects, updateComicEffects } from './helpers/scene/comicEffects.js';
import { createSceneMinimap } from './core/renderer.js';
import { createShipMap, createShipMapProgress, SHIP_MAP_LAYOUT, type ShipMapLayout } from './core/shipMap.js';
import { createQuartersProgress } from './scenes/living quarters/layout.js';
import { createStageTwoProgress, isSurveillancePoint, type CameraRoomId } from './scenes/level 1 stage 2/stageTwoLayout.js';
import { createScene as createScene1 } from './scenes/scene1.js';
import { createHoldToSkip } from './helpers/animation/holdToSkip.js';
import { createCinematicLoadingScreen } from './helpers/scene/cinematicLoading.js';
import type { LaunchState } from './scenes/level 1/scene14.js';
import type { FlightExitState } from './scenes/level 2/scene15.js';
import type { RescueArrival } from './helpers/scene/rescueSite.js';
import type { FinaleCheckpoint } from './scripts/finaleDirector.js';
import type { loadCharacter } from './scripts/characterManager.js';
import { TELEPORT_TRANSFER_DURATION, hologramTransitionAt } from './scripts/characterManager.js';
import type { Player, PlayerTransitionState } from './scripts/player.js';
import { PLAYER_MAX_HEALTH } from './scripts/player.js';
import { PistolController } from './scripts/pistol.js';
import { CrowbarController } from './scripts/crowbar.js';
import { GogglesController } from './scripts/goggles.js';
import { GogglesPostProcess } from './scripts/gogglesPostProcess.js';
import { LightsaberController } from './scripts/lightsaber.js';
import { AdaptiveHintManager } from './scripts/adaptiveHints.js';
import { createCctvSystem, type CctvFeedSource } from './scripts/cctv.js';
import { TeleportationDeviceController, teleportPlayer } from './scripts/teleportationDevice.js';
import { createWeaponWheel, type WeaponId, type WeaponWheelEntry } from './scripts/weaponWheel.js';
import type { createFirstPersonHands } from './scripts/firstPersonHands.js';
import { initTouchControls, setTouchFlightMode, resetTouchInput, registerWeaponEquip } from './scripts/touchControls.js';
import { PixelArtPass } from './core/PixelArtPass.js';
import { RetroConsolePass } from './core/RetroConsolePass.js';
import { getAudioSettings, setAudioVolume, setAudioMenuPaused } from './helpers/audio/AudioManager.js';
import { preloadMusic } from './helpers/audio/bufferedMusic.js';
import { createGameMusic, MUSIC_URLS } from './helpers/audio/gameMusic.js';
import { preloadToolModel, yieldToMainThread } from './core/loader.js';
import shipMusicUrl from './assets/bgm/DonRevBGM1.m4a';
import flightMusicUrl from './assets/bgm/DonRevLevel2.m4a';
import jungleMusicUrl from './assets/bgm/DonRevJungleLoop.m4a';

const sceneImports = {
  0: () => import('./scenes/prologue/prologue_scene_1.js'),
  0.5: () => import('./scenes/living quarters/scene.js'),
  1.1: () => import('./scenes/level 1 stage 1/storageRoom.js'),
  1.2: () => import('./scenes/level 1 stage 2/scene.js'),
  1.3: () => import('./scenes/level 1 stage 2/equipmentRoom.js'),
  5: () => import('./scenes/level 1/scene5.js'),
  6: () => import('./scenes/level 1/scene6.js'),
  13: () => import('./scenes/level 1/scene13.js'),
  14: () => import('./scenes/level 1/scene14.js'),
  15: () => import('./scenes/level 2/scene15.js'),
  16: () => import('./scenes/level 2/scene16.js'),
  17: () => import('./scenes/level 3/scene17.js'),
  18: () => import('./scenes/level 3/scene18.js'),
  19: () => import('./scenes/level 3/scene19.js'),
  20: () => import('./scenes/level 3/scene20.js'),
  21: () => import('./scenes/level 3/scene21.js'),
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
    if (id === 0.5) await (await sceneModule(0.5)).preloadAssets();
    else if (id === 1.1) await (await sceneModule(1.1)).preloadAssets();
    else if (id === 1.2) await (await sceneModule(1.2)).preloadAssets();
    else if (id === 13) await (await sceneModule(13)).preloadAssets();
    else await sceneModule(id);
  });
}

const upcomingScenes: Partial<Record<SceneModuleId, readonly SceneModuleId[]>> = {
  0: [0.5], 0.5: [1.1], 1.1: [1.2], 1.2: [13], 13: [14],
  14: [15], 15: [16], 16: [17], 17: [18], 18: [19], 19: [21],
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
const cctv = createCctvSystem(renderer, [
  { id: 'scene5', label: '05 / CARGO HOLD', load: () => cameraFeed('scene5') },
  { id: 'scene6', label: '06 / TARGET RANGE', load: () => cameraFeed('scene6') },
  { id: 'stage2-armory', label: 'ARCHIVE / CHEST', load: () => cameraFeed('stage2-armory') },
]);
const gogglesPostProcess = new GogglesPostProcess(renderer);
const pixelArtPass = new PixelArtPass();
const retroConsolePass = new RetroConsolePass();
const minimap = createSceneMinimap(renderer, document.getElementById('minimap')!);

// --- Audio ---
const audioManager = null;
const music = createGameMusic();
const cinematicLoading = createCinematicLoadingScreen();

// --- Scene Management ---
let currentSceneData: any = null;
let scene1Data: any = null;
let activeScene: THREE.Scene | null = null;
let activeCamera: THREE.PerspectiveCamera | null = null;
let updatePhysics: ((dt: number, thirdPerson?: boolean) => void) | null = null;
let cutsceneManager: any = null;
let lastSplinePoint: THREE.Vector3 | null = null;
let activeSceneId = 'scene1';
let quickMenuOpen = false;
let weaponWheelOpen = false;
let teleportLoading = false;
let teleportArrivalTime = -1;
let stealthHintsEnabled = true;
let stage1LoadingShown = false;
let checkpointNoticeTime = 0;
let nextSceneActionId = 0;
const pendingSceneActions = new Map<number, { remaining: number; run: () => void }>();

function beginCinematicLoading(destination: 'stage1' | 'boss' | 'finale') {
  weaponWheel.close();
  if (quickMenuOpen) setPauseMenu(null, false);
  clearSceneInput();
  if (document.pointerLockElement) document.exitPointerLock();
  return cinematicLoading.begin(destination);
}

// The main loop neither updates nor renders behind the loading screen, so run the first frames of
// the new scene here; texture uploads, shadow programs and setup states stay hidden.
async function warmBehindLoading(request: number, frames = 3) {
  for (let frame = 0; frame < frames; frame++) {
    if (request !== sceneRequestVersion || !activeScene || !activeCamera) return false;
    updatePhysics?.(1 / 60, isThirdPerson);
    updatePlayerView(1 / 60);
    const scene = currentSceneData?.getRenderScene?.() ?? activeScene;
    updateComicEffects(scene, activeCamera, 1 / 60, renderer);
    renderGameplayFrame(scene, activeCamera);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  return request === sceneRequestVersion;
}

function renderGameScene(scene: THREE.Scene, camera: THREE.Camera) {
  if (currentSceneData?.renderSceneWithEffects) {
    currentSceneData.renderSceneWithEffects(renderer, scene, camera);
    currentSceneData.renderCinematicOverlay?.(renderer);
    return;
  }
  goggles.update();
  gogglesPostProcess.render(scene, camera, () => {
    renderSceneEffects(scene, camera);
    if (!deathPresentation && !currentSceneData?.isCinematic?.() && !currentSceneData?.ownsWeaponInput) {
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
let quartersProgress = createQuartersProgress();
let stageTwoProgress = createStageTwoProgress();
const shipMapProgress = createShipMapProgress();
let mappedSceneData: unknown = null;
let bayBossDefeated = false;

// --- Global Character (persists across scenes) ---
let globalCharacter: Awaited<ReturnType<typeof loadCharacter>> = null;
let currentPlayer: Player | null = null;

// --- Session inventory ---
let hasCrowbar = false;
let hasPistol = false;
let healthPackCollectedScene13 = false;
let hintManager: AdaptiveHintManager | null = null;
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
  player: currentSceneData?.ownsWeaponInput || currentSceneData?.isCinematic?.() || deathPresentation ? null : currentPlayer, character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(), targets: currentSceneData?.getDamageTargets?.() ?? [],
  hasPistol,
  weaponAnimation: currentSceneData?.ownsWeaponInput ? undefined : globalCharacter?.weapon,
  holsterOther: () => { crowbarController?.holster(); lightsaberController?.holster(); },
  onShot: (point, origin) => currentSceneData?.onPistolShot?.(point, origin),
}));

const crowbar = new CrowbarController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player: currentSceneData?.ownsWeaponInput || currentSceneData?.isCinematic?.() || deathPresentation ? null : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  hasCrowbar,
  targets: currentSceneData?.getDamageTargets?.() ?? [],
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
  player: currentSceneData?.ownsWeaponInput || currentSceneData?.isCinematic?.() || deathPresentation ? null : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  hasLightsaber,
  attackClips: globalCharacter?.lightsaberAttacks,
  targets: currentSceneData?.getDamageTargets?.() ?? [],
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

// --- Teleportation Device ---
let teleportDeviceMessageTimeout: number | null = null;
function showTeleportDeviceMessage(message: string) {
  if (currentSceneData?.showTeleportMessage) { currentSceneData.showTeleportMessage(message); return; }
  const prompt = document.getElementById('interact-prompt');
  if (!prompt) return;
  prompt.textContent = message;
  prompt.classList.remove('hidden');
  if (teleportDeviceMessageTimeout) pendingSceneActions.delete(teleportDeviceMessageTimeout);
  teleportDeviceMessageTimeout = scheduleSceneAction(() => {
    prompt.classList.add('hidden');
    teleportDeviceMessageTimeout = null;
  }, 3000);
}

function surveillanceMarkerPlaced() {
  const marker = teleportDevice.getState();
  return stageTwoProgress.guardDown && marker.placed && marker.placementScene === 'stage2-infiltration'
    && !!marker.placementPosition && isSurveillancePoint(marker.placementPosition);
}

function isCameraVisit(id: string) { return id === 'scene5' || id === 'scene6' || id === 'stage2-armory'; }

function equipmentInputBlocked() {
  return document.hidden || quickMenuOpen || weaponWheelOpen || teleportLoading
    || !!deathPresentation || !currentPlayer?.isEnabled() || currentPlayer.getHealth() <= 0
    || !!document.getElementById('fade-overlay')?.classList.contains('active')
    || (currentSceneData?.ownsWeaponInput ? !currentSceneData?.canSelectWeapon?.() : !!currentSceneData?.isCinematic?.());
}

const teleportDevice = new TeleportationDeviceController(() => ({
  currentSceneId: activeSceneId,
  isBossFight: () => activeSceneId === 'scene13',
  isInputBlocked: () => equipmentInputBlocked() || !!currentSceneData?.ownsWeaponInput
    || !!currentPlayer?.getState().climbing || !!currentPlayer?.getState().boxHandling,
  getActiveScene: () => activeScene,
  getPlayerRadius: () => currentPlayer?.radius ?? 0.3,
  getPlayerPosition: () => currentPlayer ? { ...currentPlayer.body.position } : { x: 0, y: 0, z: 0 },
  getPlayerRotation: () => currentPlayer?.getState().yaw ?? 0,
  onTeleport: (sceneId, position, rotation) => { void teleportToAnchor(sceneId, position, rotation); },
  showMessage: showTeleportDeviceMessage,
  placementMessage: (sceneId, position) => sceneId === 'stage2-infiltration' && isSurveillancePoint(position)
    ? 'Prime: Marker set. E on a screen to travel, T to return.'
    : isCameraVisit(sceneId) || sceneId === 'stage2-infiltration'
      ? 'Prime: Set the marker inside the camera room.'
      : 'Purple marker placed. Press T to return; hold Tab to choose weapons.',
  returnError: state => (isCameraVisit(activeSceneId) || activeSceneId === 'stage2-infiltration')
    && !(state.placementScene === 'stage2-infiltration' && state.placementPosition && isSurveillancePoint(state.placementPosition))
    ? 'Prime: Your marker must be in the camera room. R restarts.'
    : null,
}));

async function teleportToAnchor(sceneId: string, position: { x: number; y: number; z: number }, rotation: number) {
  if (!currentPlayer || teleportLoading) return;
  const state = currentPlayer.captureTransition({ x: 0, y: 0, z: 0 });
  if (sceneId !== activeSceneId) {
    if (sceneId !== 'stage2-infiltration' || !surveillanceMarkerPlaced()) {
      showTeleportDeviceMessage('That marker has no return link. Place your home marker in surveillance.');
      return;
    }
    teleportLoading = true;
    clearSceneInput();
    const request = sceneRequestVersion + 1;
    try {
      const loaded = await loadStageTwo(state);
      if (request !== sceneRequestVersion) return;
      if (!loaded || activeSceneId !== sceneId) throw new Error('The surveillance return link did not activate');
    } catch (error) {
      console.error('Teleport failed:', error);
      showTeleportDeviceMessage('Teleport failed. Your anchor is saved; try again.');
      return;
    } finally {
      teleportLoading = false;
    }
  }
  if (!currentPlayer) return;
  teleportPlayer(currentPlayer, position, rotation, state);
  currentPlayer.enable();
  if (activeCamera) resetThirdPersonCamera(activeCamera);
  globalCharacter?.setFacing(rotation);
  teleportArrivalTime = 0;
  updatePlayerView(0);
  globalCharacter?.setHologramTransition(hologramTransitionAt(0, true, TELEPORT_TRANSFER_DURATION));
  teleportDevice.update(0);
}

function weaponEntries(): WeaponWheelEntry[] {
  const entries: WeaponWheelEntry[] = [{ id: 'unarmed', label: 'Unarmed' }];
  if (hasPistol) entries.push({ id: 'pistol', label: 'Pistol' });
  if (hasCrowbar) entries.push({ id: 'crowbar', label: 'Crowbar' });
  if (hasLightsaber) entries.push({ id: 'lightsaber', label: 'Lightsaber' });
  return entries;
}
function equippedWeapon(): WeaponId {
  if (currentSceneData?.ownsWeaponInput) return currentSceneData.getEquippedWeapon?.() ?? 'unarmed';
  return lightsaber.isEquipped() ? 'lightsaber' : crowbar.isEquipped() ? 'crowbar' : pistol.isEquipped() ? 'pistol' : 'unarmed';
}
function selectWeapon(id: WeaponId) {
  if (equipmentInputBlocked() || !weaponEntries().some(entry => entry.id === id)) return;
  if (currentSceneData?.ownsWeaponInput) currentSceneData.selectWeapon(id);
  else {
    pistol.holster(); crowbar.holster(); lightsaber.holster();
    if (id === 'pistol') pistol.equip();
    else if (id === 'crowbar') crowbar.equip();
    else if (id === 'lightsaber') lightsaber.equip();
  }
  const status = document.getElementById('weapon-status');
  if (status) status.textContent = `${weaponEntries().find(entry => entry.id === id)!.label} | Hold Tab: weapons`;
  updatePlayerView(0);
}
const weaponWheel = createWeaponWheel({
  getEntries: weaponEntries, getCurrentId: equippedWeapon, isBlocked: equipmentInputBlocked, onSelect: selectWeapon,
  setPaused(paused) {
    weaponWheelOpen = paused;
    clearSceneInput();
    const blocked = paused || quickMenuOpen;
    document.body.classList.toggle('quick-menu-open', blocked);
    if (blocked) setAudioMenuPaused(true);
    currentSceneData?.setMenuPaused?.(blocked);
    if (!blocked) setAudioMenuPaused(false);
  },
});
for (const id of ['pistol', 'crowbar', 'lightsaber'] as const) {
  registerWeaponEquip(id, () => selectWeapon(equippedWeapon() === id ? 'unarmed' : id));
}

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
  await loadScene1();
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
  const preview = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV && preview.has('living-quarters')) await loadLivingQuarters();
  else if (import.meta.env.DEV && (preview.has('stage1-stealth') || preview.has('stage2-infiltration'))) {
    hasPistol = true; quartersProgress.pistolCollected = true;
    goggles.collect(false); teleportDevice.collect(false);
    if (preview.has('stage2-infiltration')) await loadStageTwo();
    else await loadStage1Storage();
  }
  warmScene(0);
  warmScene(0.5);
  void background(() => preloadMusic(shipMusicUrl));
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
  quarters: { title: 'Living quarters', lines: ['WASD - walk / Shift - sprint / Mouse - look', 'C while moving forward - slide tackle; otherwise crouch', 'Look at a nameplate to see the room name', 'E - use doors, chests and devices', 'Unlocked doors play a short walk-through cinematic', 'V - first / third person / M - pause, then Map', 'Recover your gear and search Branden and Brendan\'s rooms'], touch: ['Left stick - walk / Right drag - look', 'CROUCH while moving forward - slide tackle', 'Look at nameplates to see room names automatically', 'USE - open doors and chests, recover gear', 'VIEW - first / third person / MENU - pause and map', 'Recover your gear and check the other lecturers\' rooms'] },
  basics: { title: 'You’re awake', lines: ['WASD — walk · Shift — sprint', 'C while moving forward — slide tackle; otherwise crouch', 'Mouse — look · Click the world to capture the mouse', 'Space — jump · E — interact', 'Hold Tab — weapons · Aim and release to equip · Left click — shoot', 'V or the view button — switch first / third person · M — pause'], touch: ['Drag on the left to walk; drag on the right to look.', 'RUN, JUMP, CROUCH and USE are your movement controls.', 'CROUCH while moving forward performs a slide tackle.', 'PISTOL equips your gun; SHOOT fires it.', 'Tap VIEW to switch first / third person · MENU to pause.'] },
  pistol: { title: 'Pistol', lines: ['Hold Tab — select pistol; select Unarmed to holster', 'Left click — shoot at your crosshair'], touch: ['PISTOL — equip / holster', 'SHOOT — fire at your crosshair'] },
  crowbar: { title: 'Crowbar acquired', lines: ['Hold Tab — select crowbar; select Unarmed to holster', 'Left click — swing'], touch: ['CROW — equip / holster', 'SWING — attack'] },
  lightsaber: { title: 'Lightsaber acquired', lines: ['Hold Tab — select lightsaber; select Unarmed to holster', 'Left click — slash'], touch: ['SABER — equip / holster', 'SLASH — attack'] },
  teleport: { title: 'Teleportation device', lines: ['Q — place purple anchor', 'T — teleport instantly to your anchor'], touch: ['Keyboard Q — place anchor; T — teleport'] },
  goggles: { title: 'Scanner goggles acquired', lines: ['N — wear / remove goggles'], touch: ['GOGGLES — wear / remove'] },
  vent: { title: 'Vent maze', lines: ['WASD / arrows — move on the fullscreen map', 'Go right across the top, then down the right edge', 'Wait for green sensors · Blue pads save your position', 'E — climb the storeroom ladder · Hold Space — climb quickly'], touch: ['Left stick — move on the fullscreen map', 'Follow the dotted route to CAMERA ROOM', 'Green sensors are safe · Blue pads are checkpoints', 'USE — mount ladder · Hold JUMP — climb quickly'] },
  cargo: { title: 'Handling cargo', lines: ['E — grab / release a nearby box', 'WASD — move while holding it'], touch: ['USE — grab / release a nearby box', 'Left stick — move the box'] },
  flight: { title: 'Flight controls', lines: ['WASD — dodge · Mouse — aim', 'Hold left click — fire · Space — evade', 'V or the view button — cockpit / chase camera · M — pause'], touch: ['Left stick — dodge · Right drag — aim', 'Hold FIRE — shoot · EVADE — dodge', 'VIEW — cockpit / chase camera · MENU — pause']},
  flightSide: { title: 'Sidescroll flight', lines: ['WASD / arrows — move · Hold left click — fire straight', 'W / S + Space — dodge up / down'], touch: ['Left stick — move · Hold FIRE — fire straight', 'Stick up / down + EVADE — vertical dodge'] },
  flightTop: { title: 'Top-down flight', lines: ['WASD / arrows — move · Hold left click — fire upward', 'A / D + Space — evade left / right'], touch: ['Left stick — move · Hold FIRE — fire upward', 'Stick left / right + EVADE — lateral dodge'] },
  jungle: { title: 'Back on the ground', lines: ['WASD — walk · Shift — sprint · Space — jump', 'C while moving forward — slide tackle; otherwise crouch', 'Hold Tab — select weapon · Left click — attack', 'V or the view button — change view'], touch: ['Left stick — walk · Right drag — look', 'RUN / JUMP — sprint and jump', 'CROUCH while moving forward — slide tackle', 'PISTOL / CROW — select weapon · SHOOT / SWING — attack', 'VIEW — change view'] },
  platformer: { title: 'Platforming controls', lines: ['A / D or arrows — move · Space — jump', 'Shift — sprint · C — crouch', 'Mouse — aim · Hold Tab — select weapon', 'Hold left click — attack'], touch: ['Left stick — move · JUMP — jump', 'RUN — sprint · CROUCH — crouch', 'Right drag — aim · PISTOL / CROW — select weapon', 'Hold FIRE — attack'] },
  finale: { title: 'Final boss controls', lines: ['A / D — move · J — down / side / heavy sword chain · F — two-handed rifle salvo', 'Hold R — shield / parry · Space — dodge boost · E — Last Light blade wave (18-second recharge)', 'After a special close-up, the camera returns before release: dodge or guard', 'W / S — rise or dive in space · Hold Enter — skip to the VS intro', 'Final QTE: time taps, mash D, hold E; 1–3 stars per prompt, three misses cause death'], touch: ['LEFT / RIGHT — move · UP / DOWN — fly in space', 'SWORD — chain cuts · SHIELD — hold to block / parry · BOOST — dodge', 'RIFLE — sheath, draw and fire · ULTIMATE — Last Light (18-second recharge)', 'QTE: tap, mash or hold the displayed letter; three misses break the link'] },
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
  hintManager?.setEnabled(id !== 'scene21');
  if (id === 'scene21') hintManager?.recordActivity();
  checkpointNoticeTime = ['scene13', 'scene14', 'scene15', 'scene16'].includes(id) ? 2.5 : 0;
  document.getElementById('scene-checkpoint')!.classList.toggle('hidden', checkpointNoticeTime === 0);
  dismissControls();
  document.getElementById('look-reticle')?.classList.add('hidden');
  controlQueue = controlQueue.filter(card => !card.scene);
  minimap.reset();
  const key = id === 'living-quarters' ? 'quarters' : id === 'stage2-infiltration' ? 'basics' : id === 'scene15' ? 'flight'
    : null;
  if (key) introduceControls(key, id);
}
function updateControlCard(dt: number) {
  const ready = activeSceneId !== 'scene1' && activeSceneId !== 'scene21' && !quickMenuOpen && !deathPresentation
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
  if (activeSceneId === 'scene1' || activeSceneId === 'scene15' || activeSceneId === 'scene16' || activeSceneId === 'scene21'
    || currentSceneData?.hideMinimap?.() || !activeScene || !currentPlayer) { minimap.hide(); return; }
  const state = currentSceneData?.getMinimapState?.();
  minimap.render(currentSceneData?.getRenderScene?.() ?? activeScene,
    state?.position ?? currentPlayer.body.position, state?.yaw ?? currentPlayer.getState().yaw,
    state?.object ?? globalCharacter?.model ?? null, { ...currentSceneData?.minimap, ...state });
}

function renderGameplayFrame(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  if (currentSceneData?.isMazeActive?.()) {
    renderMinimap();
    minimap.renderGameInset(scene, camera);
  } else {
    renderGameScene(scene, camera);
    renderMinimap();
  }
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
  const weaponsVisible = currentSceneData?.ownsWeaponInput ? !!currentSceneData?.canSelectWeapon?.() : !currentSceneData?.isCinematic?.();
  document.getElementById('touch-pistol')?.classList.toggle('hidden', !hasPistol || !weaponsVisible);
  document.getElementById('touch-crowbar')?.classList.toggle('hidden', !hasCrowbar || !weaponsVisible);
  document.getElementById('touch-lightsaber')?.classList.toggle('hidden', !hasLightsaber || !weaponsVisible);
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
  stage1LoadingShown = false;
  hideScene1Skip();
  retireTraversalRoom();
  currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) scene1Data = null;
  quartersProgress = createQuartersProgress(); stageTwoProgress = createStageTwoProgress();
  hasPistol = hasCrowbar = hasLightsaber = bayBossDefeated = healthPackCollectedScene13 = false;
  pistol.holster(); crowbar.holster(); lightsaber.holster(); goggles.reset(); teleportDevice.reset();
  cctv.clearSources();
  shipMapProgress.reset(); shipMap?.dispose(); shipMap = null; shipMapLayout = undefined; mappedSceneData = null;
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
      if (activeSceneId !== 'prologue1') return true;
      isThirdPerson = true;
      return loadLivingQuarters();
    },
  });
  music.enterScene('prologue1', currentSceneData);
  activeScene = currentSceneData.scene;
  activeCamera = currentSceneData.camera;
  currentPlayer = currentSceneData.player;
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = null;
  if (orbitControls) { orbitControls.object = activeCamera!; orbitControls.enabled = false; }
}

interface PreparedOpeningScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: Player;
  ready: Promise<unknown>;
  dispose(): void;
}

async function prepareOpeningScene(data: PreparedOpeningScene, source: unknown, request: number, presentation?: Promise<void>) {
  data.player.disable();
  try {
    await Promise.all([data.ready, presentation]);
    await renderer.compileAsync(data.scene, data.camera);
  } catch (error) {
    data.dispose();
    throw error;
  }
  if (request !== sceneRequestVersion || source !== currentSceneData) { data.dispose(); return false; }
  return true;
}

async function loadLivingQuarters(fromPassage = false, entryState?: PlayerTransitionState) {
  const module = await prepareScene(0.5);
  if (!module) return false;
  hideScene1Skip(); pistol.holster(); crowbar.holster(); lightsaber.holster();
  pistol.update(0); crowbar.update(0); lightsaber.update(0);
  const source = currentSceneData, request = sceneRequestVersion;
  const sceneData = module.createScene({
    progress: quartersProgress, fromPassage, entryState, deferActivation: true,
    warmRoom: async (scene, camera) => { await renderer.compileAsync(scene, camera); },
    onPistolCollected: () => { hasPistol = true; introduceControls('pistol'); },
    onCrystalCollected: () => { teleportDevice.collect(); introduceControls('teleport'); },
    onGogglesCollected: () => { goggles.collect(); introduceControls('goggles'); },
    preparePassage: async () => { await (await sceneModule(1.1)).preloadAssets(); },
    onExitToPassage: state => loadStage1Storage(true, state),
  });
  if (!await prepareOpeningScene(sceneData, source, request)) return false;
  retireTraversalRoom(); currentSceneData?.dispose?.();
  hasPistol = quartersProgress.pistolCollected;
  if (quartersProgress.crystalCollected) teleportDevice.collect(false);
  if (quartersProgress.gogglesCollected) goggles.collect(false);
  enterManagedScene('living-quarters', sceneData);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  currentPlayer = sceneData.player; updatePhysics = sceneData.updatePhysics; cutsceneManager = null; isThirdPerson = true;
  sceneData.activate();
  shipMapProgress.reveal(sceneData.getMapLayout());
  if (globalCharacter) {
    activeScene.add(globalCharacter.model); globalCharacter.setFacing(currentPlayer.getState().yaw);
    globalCharacter.setHologramTransition(sceneData.getHologramTransition());
  }
  if (orbitControls) { orbitControls.object = activeCamera; orbitControls.enabled = false; }
  updatePlayerView(0);
  return true;
}

async function loadStage1Storage(fromQuarters = false, entryState?: PlayerTransitionState) {
  const loading = stage1LoadingShown ? null : beginCinematicLoading('stage1');
  const expectedRequest = sceneRequestVersion + 1;
  const module = await prepareScene(1.1);
  if (!module) {
    if (expectedRequest !== sceneRequestVersion) loading?.finish();
    else loading?.fail('Stage One could not be loaded. Please try again.', () => { void loadStage1Storage(fromQuarters, entryState); });
    return false;
  }
  try {
    hideScene1Skip();
    const source = currentSceneData, request = sceneRequestVersion;
    const sceneData = module.createScene({ hintsEnabled: stealthHintsEnabled, openingEntry: !fromQuarters, fromQuarters, entryState,
      deferActivation: true,
      onReturnToQuarters: state => loadLivingQuarters(true, state), onComplete: async presentation => {
        if (activeSceneId !== 'stage1-storage') return false;
        return loadStageTwo(currentPlayer?.captureTransition({ x: 0, y: 0, z: 0 }), presentation);
      } });
    if (!await prepareOpeningScene(sceneData, source, request, loading?.presented)) {
      loading?.finish();
      return false;
    }
    retireTraversalRoom();
    currentSceneData?.dispose?.();
    enterManagedScene('stage1-storage', sceneData);
    currentSceneData = sceneData;
    activeScene = sceneData.scene;
    activeCamera = sceneData.camera;
    currentPlayer = sceneData.player;
    updatePhysics = sceneData.updatePhysics;
    cutsceneManager = null;
    isThirdPerson = true;
    sceneData.activate();
    shipMapProgress.reveal(sceneData.getMapLayout());
    if (globalCharacter) {
      activeScene.add(globalCharacter.model);
      globalCharacter.setHologramTransition(sceneData.getHologramTransition());
      globalCharacter.setFacing(currentPlayer.getState().yaw);
    }
    if (orbitControls) { orbitControls.object = activeCamera; orbitControls.enabled = false; }
    updatePlayerView(0);
    stage1LoadingShown = true;
    loading?.finish();
    warmScene(1.2);
    return true;
  } catch (error) {
    console.error('Stage One preparation failed:', error);
    if (loading) loading.fail('Stage One could not be prepared. Please try again.', () => { void loadStage1Storage(fromQuarters, entryState); });
    else document.getElementById('scene-menu-error')!.textContent = 'Stage One could not be prepared. Please try again.';
    return false;
  }
}

// --- Load Scene 1 ---
async function loadScene1() {
  sceneRequestVersion++;
  activeSceneId = 'scene1'; currentPlayer = null;
  enterHudScene('scene1');
  document.getElementById('quit-btn')!.textContent = "DON’T PLAY";
  const quitButton = document.getElementById('quit-btn') as HTMLButtonElement;
  quitButton.classList.remove('no-choice', 'hidden'); quitButton.disabled = false;
  currentSceneData = createScene1({ audioManager });
  music.enterScene('scene1', currentSceneData);
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

  await introScene.ready;
  if (currentSceneData !== introScene) return;

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
        showMenuButtons();
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
      const creditsOverlay = document.getElementById('credits-overlay')!;
      creditsOverlay.classList.add('hidden');
      showMenuButtons();
      },
    });
  }
}

// --- Opening menu ---
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

function hideScene1Skip() {
  scene1SkipVisible = false;
  scene1SkipHold?.dispose(); scene1SkipHold = null;
  document.getElementById('skip-btn')?.classList.add('hidden');
  document.querySelectorAll('.wake-skip-btn').forEach(button => button.remove());
  document.getElementById('interact-prompt')?.classList.add('hidden');
}

function enterManagedScene(id: string, sceneData: any) {
  weaponWheel.close();
  cctv.detach();
  teleportDevice.detachMarker();
  teleportArrivalTime = -1;
  if (activeScene) disposeComicEffects(activeScene);
  // Legacy combat scenes started with the pistol; only the new opening requires recovery.
  if (id === 'stage1-storage' && !sceneData.requiresRecoveredPistol || (id.startsWith('scene') && Number(id.slice(5)) >= 2)) hasPistol = true;
  lightsaber.detach();
  globalCharacter?.model.removeFromParent();
  activeSceneId = id;
  music.enterScene(id, sceneData);
  enterHudScene(id);
  const damage = document.getElementById('player-damage');
  if (damage) damage.style.opacity = '0';
  const sceneId = (id === 'living-quarters' ? 0.5 : id === 'stage1-storage' ? 1.1
    : id === 'stage2-infiltration' ? 1.2 : id === 'stage2-armory' ? 1.3 : Number(id.slice(5))) as SceneModuleId;
  for (const next of upcomingScenes[sceneId] ?? []) warmScene(next);
  if (sceneId === 14) void background(() => preloadMusic(flightMusicUrl));
  if (sceneId === 15) {
    void background(() => preloadMusic(jungleMusicUrl));
  }
}

function retireTraversalRoom() {
  weaponWheel.close();
  cctv.detach();
  teleportDevice.detachMarker();
  if (activeScene) disposeComicEffects(activeScene);
  // The persistent character is not scene-owned geometry.
  pistol.holster(); crowbar.holster(); lightsaber.holster();
  pistol.update(0); crowbar.update(0); lightsaber.update(0);
  lightsaber.detach();
  globalCharacter?.model.removeFromParent();
  currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) scene1Data = null;
}

function activateExtension(sceneData: any, id: string) {
  enterManagedScene(id, sceneData);
  currentSceneData = sceneData; activeScene = sceneData.scene; activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics; cutsceneManager = null; currentPlayer = sceneData.player;
  if (globalCharacter) activeScene!.add(globalCharacter.model);
  if (orbitControls) { orbitControls.object = activeCamera!; orbitControls.enabled = false; }
  globalCharacter?.setFacing(currentPlayer!.getState().yaw); updatePlayerView(0);
}

async function loadStageTwo(entryState?: PlayerTransitionState, presentation?: Promise<void>) {
  const module = await prepareScene(1.2);
  if (!module) return false;
  const source = currentSceneData, request = sceneRequestVersion;
  const sceneData = module.createScene({
    progress: stageTwoProgress, entryState, deferActivation: true,
    getCameraTarget: () => activeCamera ? cctv.getTarget(activeCamera) : null,
    hasReturnMarker: surveillanceMarkerPlaced,
    getEquippedWeapon: equippedWeapon,
    holsterWeapons: () => { pistol.holster(); crowbar.holster(); lightsaber.holster(); },
    onCrowbarCollected: () => { hasCrowbar = true; introduceControls('crowbar'); },
    onRetryFeed: id => cctv.retryFeed(id),
    onCameraTeleport: (id, state) => loadCameraVisit(id, state),
    prepareBay13: async () => { await (await sceneModule(13)).preloadAssets(); },
    onExitToBay13: state => loadBay13(state, true),
  });
  if (!await prepareOpeningScene(sceneData, source, request, presentation)) return false;
  hideScene1Skip(); retireTraversalRoom(); isThirdPerson = true;
  activateExtension(sceneData, 'stage2-infiltration');
  sceneData.activate();
  if (stageTwoProgress.crowbarCollected) hasCrowbar = true;
  if (stageTwoProgress.lightsaberCollected) hasLightsaber = true;
  shipMapProgress.reveal(sceneData.getMapLayout());
  updatePlayerView(0);
  return true;
}

async function cameraFeed(id: CameraRoomId): Promise<CctvFeedSource> {
  const sceneData = id === 'scene5'
    ? (await sceneModule(5)).createScene({ remoteVisit: true, preview: true, loot: stageTwoProgress.remoteRooms.scene5 })
    : id === 'scene6'
      ? (await sceneModule(6)).createScene({ remoteVisit: true, preview: true, loot: stageTwoProgress.remoteRooms.scene6 })
      : (await sceneModule(1.3)).createScene({ progress: stageTwoProgress, preview: true });
  try {
    await sceneData.ready;
    await renderer.compileAsync(sceneData.scene, sceneData.camera);
  } catch (error) { sceneData.dispose(); throw error; }
  return { scene: sceneData.scene, update: dt => {
    if ('syncProgress' in sceneData) sceneData.syncProgress();
    sceneData.updatePhysics(dt);
  },
    dispose: () => sceneData.dispose() };
}

async function restartSurveillance() {
  const state = currentPlayer?.captureTransition({ x: 0, y: 0, z: 0 });
  stageTwoProgress.checkpoint = 'surveillance';
  if (state && (state.health ?? PLAYER_MAX_HEALTH) <= 0) state.health = PLAYER_MAX_HEALTH;
  const loaded = await loadStageTwo(state);
  if (loaded) showTeleportDeviceMessage('Prime: Checkpoint restored. Q to set a marker.');
  return loaded;
}

async function loadCameraVisit(id: CameraRoomId, entryState?: PlayerTransitionState, developerVisit = false) {
  if (!developerVisit && !surveillanceMarkerPlaced()) {
    showTeleportDeviceMessage('Prime: Set a marker with Q first.');
    return false;
  }
  const source = currentSceneData;
  let sceneData;
  if (id === 'scene5') {
    const module = await prepareScene(5);
    if (!module || source !== currentSceneData) return false;
    sceneData = module.createScene({ remoteVisit: true, deferActivation: true, entryState,
      loot: stageTwoProgress.remoteRooms.scene5, hasReturnMarker: surveillanceMarkerPlaced, onRestart: restartSurveillance });
  } else if (id === 'scene6') {
    const module = await prepareScene(6);
    if (!module || source !== currentSceneData) return false;
    sceneData = module.createScene({ remoteVisit: true, deferActivation: true, entryState,
      loot: stageTwoProgress.remoteRooms.scene6, hasReturnMarker: surveillanceMarkerPlaced, onRestart: restartSurveillance });
  } else {
    const module = await prepareScene(1.3);
    if (!module || source !== currentSceneData) return false;
    sceneData = module.createScene({ progress: stageTwoProgress, deferActivation: true, entryState,
      hasReturnMarker: surveillanceMarkerPlaced, onRestart: restartSurveillance,
      onLightsaberCollected: () => { hasLightsaber = true; introduceControls('lightsaber'); } });
  }
  const request = sceneRequestVersion;
  if (!await prepareOpeningScene(sceneData, source, request)) return false;
  retireTraversalRoom();
  activateExtension(sceneData, id);
  sceneData.activate();
  shipMapProgress.reveal(sceneData.getMapLayout());
  teleportArrivalTime = 0;
  globalCharacter?.setHologramTransition(hologramTransitionAt(0, true, TELEPORT_TRANSFER_DURATION));
  updatePlayerView(0);
  return true;
}

async function loadBay13(entryState?: PlayerTransitionState, fromServiceLift = false, checkpoint = false) {
  // The service-lift ride ends on black; the boss stage loads behind its own chapter screen.
  const loading = fromServiceLift ? beginCinematicLoading('boss') : null;
  try {
    const module = await prepareScene(13);
    if (!module) { loading?.finish(); return false; }
    const source = currentSceneData, request = sceneRequestVersion;
    const sceneData = module.createScene({ entryState, fromServiceLift, checkpoint, defeated: bayBossDefeated, renderer,
      healthPackCollected: healthPackCollectedScene13,
      onHealthPackCollected: () => { healthPackCollectedScene13 = true; },
      onDefeated: () => { bayBossDefeated = true; },
      onRespawn: () => { void loadBay13(undefined, false, true).catch(error => console.error('Bay 13 checkpoint restart failed:', error)); },
      onDescend: state => { void loadHangar14(state); } });
    const enabled = sceneData.player.isEnabled();
    if (!await prepareOpeningScene(sceneData, source, request, loading?.presented)) { loading?.finish(); return false; }
    hideScene1Skip(); retireTraversalRoom();
    activateExtension(sceneData, 'scene13');
    if (enabled) sceneData.player.enable();
    if (loading) await warmBehindLoading(request);
    loading?.finish();
    return true;
  } catch (error) {
    loading?.finish();
    throw error;
  }
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
      void loadBay13(undefined, false, true).catch(error => console.error('Hangar checkpoint restart failed:', error));
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
    onFinished: arrival => { void loadGround17(arrival); },
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
  activateExtension(module.createScene({
    entryState,
    onRespawn: () => loadGround19(checkpointArrival(entryState)),
    onFinished: next => { void loadFacility20(next); },
  }), 'scene19');
}

async function loadFacility20(entryState?: RescueArrival) {
  const module = await prepareScene(20);
  if (!module) return;
  hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
  activateExtension(module.createScene({
    entryState,
    onRespawn: () => loadFacility20(checkpointArrival(entryState)),
    onFinished: next => { void loadScene21(next); },
  }), 'scene20');
}

async function loadScene21(entryState?: RescueArrival, checkpoint?: FinaleCheckpoint) {
  const loading = checkpoint ? null : beginCinematicLoading('finale');
  // Decode the finale tracks behind the loading screen so the reveal starts on its music, not seconds later.
  const musicReady = loading ? Promise.race([
    Promise.all([preloadMusic(MUSIC_URLS.loading), preloadMusic(MUSIC_URLS.ship)]).then(() => undefined),
    new Promise<void>(resolve => { window.setTimeout(resolve, 8000); }),
  ]).catch(error => console.warn('[Audio] Finale music preparation failed:', error)) : undefined;
  const expectedRequest = sceneRequestVersion + 1;
  const module = await prepareScene(21);
  if (!module) {
    if (expectedRequest !== sceneRequestVersion) loading?.finish();
    else loading?.fail('The final chapter could not be loaded. Please try again.', () => { void loadScene21(entryState, checkpoint); });
    return;
  }
  const request = sceneRequestVersion;
  let sceneData: ReturnType<typeof module.createScene> | undefined;
  try {
    sceneData = module.createScene({
      entryState, checkpoint, renderer,
      onFinished: () => { showMenuButtons(); },
      onRetry: next => { void loadScene21(entryState, next); },
    });
    if (loading) {
      sceneData.setMenuPaused(true);
      await Promise.all([sceneData.ready, loading.presented, musicReady]);
      await renderer.compileAsync(sceneData.scene, sceneData.camera);
      if (request !== sceneRequestVersion) { sceneData.dispose(); loading.finish(); return; }
    }
    hideScene1Skip(); retireTraversalRoom(); setTouchFlightMode(false);
    activateExtension(sceneData, 'scene21');
    if (loading) {
      // Lift the loading screen on Brondon's walk to the five, after the setup frames have rendered.
      sceneData.setMenuPaused(false);
      if (!await warmBehindLoading(request, 4)) { loading.finish(); return; }
    }
    sceneData.setMenuPaused(quickMenuOpen);
    loading?.finish();
  } catch (error) {
    sceneData?.dispose();
    console.error('Final chapter preparation failed:', error);
    if (loading) loading.fail('The final chapter could not be prepared. Please try again.', () => { void loadScene21(entryState, checkpoint); });
    else document.getElementById('scene-menu-error')!.textContent = 'The final chapter could not be prepared. Please try again.';
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
  [0.5, 'Living quarters - crew cabins'],
  [1.1, 'Level 1 stage 1 - Deck One Hangar'],
  [1.2, 'Level 1 stage 2 - Surveillance route'],
  [1.3, 'Stage 2 - Sealed equipment archive'],
  [1, 'Space prologue'], [5, 'Stage 2 camera - Cargo hold'], [6, 'Stage 2 camera - Target range'],
  [13, 'Bay 13 - Bay Warden boss'], [14, 'Hangar escape'],
  [15, 'Space combat'], [15.5, 'Sidescroll Scrambler'], [15.75, 'Top-down Red Scrambler'], [16, 'Crash landing'],
  [17, 'Jungle approach'], [18, 'Facility defenses'], [19, 'Facility summit'], [20, 'AI research facility'], [21, 'Final boss / Sudoers 5'],
] as const;
const quickMenu = document.getElementById('scene-quick-menu') as HTMLDialogElement;
const pauseMenu = document.getElementById('pause-menu') as HTMLDialogElement;
type MenuScreen = 'home' | 'map' | 'sound' | 'controls' | 'developer' | 'scenes';
let menuScreen: MenuScreen | null = null;
let shipMap: ReturnType<typeof createShipMap> | null = null;
let shipMapLayout: ShipMapLayout | undefined;
let controlsReturnScreen: 'home' | 'scenes' = 'home';
// Memory only: survives menus and scene changes, but resets on browser refresh.
let developerUnlocked = false;
let resumePointerTarget: HTMLElement | null = null;

function chartCurrentMapSection() {
  const layout: ShipMapLayout | undefined = currentSceneData?.getMapLayout?.();
  try {
    if (layout) shipMapProgress.reveal(layout);
    else {
      const id = Number((currentSceneData?.getSceneId?.() ?? activeSceneId).replace('scene', ''));
      if (SHIP_MAP_LAYOUT.rooms.some(room => room.id === id)) shipMapProgress.reveal(SHIP_MAP_LAYOUT);
    }
  } catch (error) {
    // A room charted by an earlier blueprint section is already on the map.
    if (!(error instanceof Error && error.message.startsWith('Duplicate charted room'))) throw error;
  }
}

function clearSceneInput() {
  resetTouchInput();
  currentPlayer?.clearInput();
  currentSceneData?.clearInput?.();
}
function renderControlsReference() {
  const owned = new Set<string>();
  if (hasPistol) owned.add('pistol');
  if (hasCrowbar) owned.add('crowbar');
  if (hasLightsaber) owned.add('lightsaber');
  if (goggles.isCollected()) owned.add('goggles');
  if (teleportDevice.isCollected()) owned.add('teleport');
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
  weaponWheel.close();
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
  if (!wasOpen && quickMenuOpen) {
    resumePointerTarget = document.pointerLockElement as HTMLElement | null;
    if (resumePointerTarget) document.exitPointerLock();
    document.getElementById('scene-menu-error')!.textContent = '';
  }
  clearSceneInput();
  document.body.classList.toggle('quick-menu-open', quickMenuOpen);
  if (quickMenuOpen) setAudioMenuPaused(true);
  music.setMenuOpen(quickMenuOpen);
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
      : screen === 'map' ? 'Ship Map'
      : screen === 'sound' ? 'Sound' : screen === 'developer' || prologue ? 'Developer Mode' : 'Pause';
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
    chartCurrentMapSection();
    const layout = shipMapProgress.getLayout();
    if (shipMap && layout !== shipMapLayout) { shipMap.dispose(); shipMap = null; }
    shipMapLayout = layout;
    shipMap ??= createShipMap(renderer, document.getElementById('ship-map-view')!, layout);
    shipMap.open(currentSceneData?.getMapSceneId?.() ?? currentSceneData?.getSceneId?.() ?? activeSceneId, currentPlayer?.body.position, currentPlayer?.getState().yaw);
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
      : screen === 'developer' ? 'developer-unlock' : prologue ? 'pause-developer' : 'pause-resume';
    document.getElementById(focusId)?.focus();
  }
}
function backFromMenu() {
  setPauseMenu(menuScreen === 'home' ? null : menuScreen === 'controls' ? controlsReturnScreen : 'home');
}
async function jumpToScene(id: number) {
  if (menuScreen !== 'scenes' || !developerUnlocked || !SCENE_CHOICES.some(([scene]) => scene === id)) return;
  weaponWheel.close();
  teleportDevice.detachMarker();
  teleportArrivalTime = -1;
  globalCharacter?.setHologramTransition(null);
  pendingSceneActions.clear();
  setTouchFlightMode(false);
  clearSceneInput();
  // Detach persistent gear before the outgoing scene disposes its meshes.
  pistol.holster(); crowbar.holster(); lightsaber.holster(); pistol.update(0); crowbar.update(0); lightsaber.update(0);
  globalCharacter?.model.removeFromParent();
  if (activeSceneId === 'prologue1') currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) { currentSceneData?.dispose?.(); scene1Data = null; }
  retireTraversalRoom();
  currentSceneData = null; currentPlayer = null; activeScene = null; activeCamera = null;
  music.enterScene(null);
  updatePhysics = null; cutsceneManager = null; lastSplinePoint = null;
  hideScene1Skip();
  for (const overlay of ['credits-overlay', 'menu-buttons', 'crowbar-overlay', 'boss-hud', 'boss-subtitles', 'escape-qte', 'loading-bay-status', 'space-cinematic-caption']) document.getElementById(overlay)?.classList.add('hidden');
  const fade = document.getElementById('fade-overlay'); fade?.classList.remove('active', 'black'); fade?.classList.add('hidden');
  // Developer spawn grants the tools but equips nothing; the player selects them per scene.
  hasPistol = true; hasCrowbar = true; hasLightsaber = true; goggles.collect(false);
  teleportDevice.collect(false);
  quartersProgress.pistolCollected = true;
  if (id === 1.2) {
    stageTwoProgress = createStageTwoProgress(); cctv.clearSources();
    hasCrowbar = hasLightsaber = false; bayBossDefeated = false; healthPackCollectedScene13 = false;
  } else if (id === 1.3 || id === 5 || id === 6) {
    stageTwoProgress.checkpoint = 'surveillance'; stageTwoProgress.guardDown = true;
  }
  if (id === 13) bayBossDefeated = false;
  const request = sceneRequestVersion + 1;
  try {
    switch (id) {
      case 0: await loadPrologue1(); break;
      case 0.5: await loadLivingQuarters(); break;
      case 1.1: await loadStage1Storage(); break;
      case 1.2: if (!await loadStageTwo()) throw new Error('Stage Two did not activate'); break;
      case 1.3: if (!await loadCameraVisit('stage2-armory', undefined, true)) throw new Error('The archive did not activate'); break;
      case 1: await loadScene1(); break;
      case 5: if (!await loadCameraVisit('scene5', undefined, true)) throw new Error('The cargo camera room did not activate'); break;
      case 6: if (!await loadCameraVisit('scene6', undefined, true)) throw new Error('The range camera room did not activate'); break;
      case 13: if (!await loadBay13()) throw new Error('Bay 13 did not activate'); break;
      case 14: await loadHangar14(); break;
      case 15: await loadFlight15(); break;
      case 15.5: await loadFlight15(undefined, 'scrambler'); break;
      case 15.75: await loadFlight15(undefined, 'topdownScrambler'); break;
      case 16: await loadCrash16(); break;
      case 17: await loadGround17(); break;
      case 18: await loadPlatformer18(); break;
      case 19: await loadGround19(); break;
      case 20: await loadFacility20(); break;
      case 21: await loadScene21(); break;
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
    developerUnlocked = true;
    setPauseMenu('scenes');
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
initializeApp().catch(error => console.error('Failed to initialize game:', error));

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

async function respawnAtCheckpoint() {
  try {
    const loaded = isCameraVisit(activeSceneId) || activeSceneId === 'stage2-infiltration'
      ? await restartSurveillance() : await loadLivingQuarters(true);
    if (!loaded) throw new Error('The player checkpoint could not be restored');
  } catch (error) {
    console.error('Player checkpoint restart failed:', error);
    showTeleportDeviceMessage('The checkpoint could not be loaded. Use the developer scene menu to retry.');
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  cinematicLoading.update(delta);
  music.setPaused(quickMenuOpen || weaponWheelOpen || teleportLoading || document.hidden
    || !!currentSceneData?.isMusicPaused?.());
  if (mappedSceneData !== currentSceneData) { mappedSceneData = currentSceneData; chartCurrentMapSection(); }
  if (cinematicLoading.active) {
    controlCard.classList.add('hidden');
    music.update(Math.min(delta, 0.1));
    return;
  }
  scene1SkipHold?.update(delta);
  if (quickMenuOpen || weaponWheelOpen || teleportLoading || document.hidden) {
    controlCard.classList.add('hidden');
    if (shipMap?.visible) { shipMap.render(); return; }
    if (activeScene && activeCamera) renderGameplayFrame(currentSceneData?.getRenderScene?.() ?? activeScene, activeCamera);
    return;
  }
  advanceSceneActions(Math.min(delta, 0.1));
  if (checkpointNoticeTime > 0) {
    checkpointNoticeTime = Math.max(0, checkpointNoticeTime - Math.min(delta, 0.1));
    if (checkpointNoticeTime === 0) document.getElementById('scene-checkpoint')!.classList.add('hidden');
  }
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
    if (currentPlayer.isEnabled() && health <= 0 && !deathPresentation && !currentSceneData?.handlesPlayerDeath) {
      const managed = !!currentSceneData?.onPlayerDeath?.();
      deathPresentation = { player: currentPlayer, elapsed: 0, managed, position: activeCamera!.position.clone(),
        rotation: activeCamera!.quaternion.clone(), fov: activeCamera!.fov };
      if (!managed) currentPlayer.disable();
    }
    if (deathPresentation) {
      deathPresentation.elapsed += Math.min(delta, 0.1);
      if (!deathPresentation.managed && deathPresentation.elapsed >= 2.5) { deathPresentation = null; void respawnAtCheckpoint(); }
    }
  }
  if (healthBarEl) healthBarEl.style.display = activeSceneId === 'scene1' || activeSceneId === 'prologue1' || activeSceneId === 'scene21' ? 'none' : '';
  if (shieldBarEl) shieldBarEl.style.display = activeSceneId === 'scene1' || activeSceneId === 'prologue1' || activeSceneId === 'scene21' ? 'none' : '';

  // Physics
  if (updatePhysics) updatePhysics(delta, isThirdPerson);
  music.update(Math.min(delta, 0.1));
  if (playerDamageEl) playerDamageEl.style.opacity = String(currentSceneData?.getDamageFlash?.() ?? currentPlayer?.getDamageFlash() ?? 0);

  // Cutscenes
  if (cutsceneManager) cutsceneManager.update(delta);
  const inScene1 = currentSceneData === scene1Data && !currentPlayer?.isEnabled();
  const inCutscene = !!cutsceneManager || !!deathPresentation || !!currentSceneData?.isCinematic?.();
  const aiming = pistol.isAiming();
  const crosshair = document.getElementById('crosshair');
  if (crosshair) {
    crosshair.style.display = (inScene1 || inCutscene || !aiming) ? 'none' : '';
  }
  const onFoot = !!currentPlayer && !!activeScene && activeSceneId !== 'scene1'
    && activeSceneId !== 'scene15' && activeSceneId !== 'scene16'
    && (currentPlayer.isEnabled() || !!currentSceneData?.controlsReady?.());
  const aimingReticle = aiming || !!currentSceneData?.hasAimReticle?.();
  document.getElementById('look-reticle')?.classList.toggle('hidden',
    !onFoot || inCutscene || aimingReticle);

  const sceneOwnsControls = !!deathPresentation || !!currentSceneData?.isCinematic?.();
  updateViewButton();
  updateControlCard(delta);

  if (hintManager && currentPlayer) {
    hintManager.update(delta, {
      currentScene: activeSceneId,
      hasCrowbar,
      hasLightsaber,
      hasPistol,
      hasGoggles: goggles.isCollected(),
      shieldCollected: stageTwoProgress.remoteRooms.scene6.rewardCollected,
      healthPackCollected: healthPackCollectedScene13,
      bossDefeated: bayBossDefeated,
      ladderCratesCleared: stageTwoProgress.crateBroken,
      cargoDoorUnlocked: stageTwoProgress.elevatorUnlocked,
      playerPosition: { x: currentPlayer.body.position.x, y: currentPlayer.body.position.y, z: currentPlayer.body.position.z },
    });
  }

  // Character animations + view
  goggles.update();
  teleportDevice.update(delta);
  updatePlayerView(delta);
  currentSceneData?.updateInteractionFocus?.();
  if (teleportArrivalTime >= 0) {
    teleportArrivalTime += Math.min(delta, 0.1);
    if (teleportArrivalTime >= TELEPORT_TRANSFER_DURATION) teleportArrivalTime = -1;
  }
  globalCharacter?.setHologramTransition(teleportArrivalTime >= 0
    ? hologramTransitionAt(teleportArrivalTime, true, TELEPORT_TRANSFER_DURATION)
    : currentSceneData?.getHologramTransition?.() ?? null);

  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput) { pistol.update(delta); crowbar.update(delta); }
  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput) lightsaber.update(delta);
  else lightsaber.detach();
  cctv.update(delta, activeScene, currentSceneData?.getCctvEnabled?.() ?? false);

  // Controls
  if (orbitControls && orbitControls.enabled) orbitControls.update();

  // Render
  if (activeScene && activeCamera) {
    const scene = currentSceneData?.getRenderScene?.() ?? activeScene;
    updateComicEffects(scene, activeCamera, delta, renderer);
    renderGameplayFrame(scene, activeCamera);
  }
}

animate();
