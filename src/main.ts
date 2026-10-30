import * as THREE from "three";
import {
  prepareEnvironmentComicShading,
  getComicLookEnabled,
  setComicLookEnabled,
  getOutlinesEnabled,
  setOutlinesEnabled,
  setComicFrameEnabled,
} from "./core/comicShading.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createScreenBloom } from "./scripts/global/screenBloom.js";
import {
  applyThirdPersonCamera,
  applyTraversalCamera,
  isCameraForcedFirstPerson,
  resetThirdPersonCamera,
} from "./core/camera.js";
import { FreeCameraController } from "./core/freeCamera.js";
import {
  disposeComicEffects,
  updateComicEffects,
} from "./scripts/global/comicEffects.js";
import { createSceneMinimap, prepareSceneRendering } from "./core/renderer.js";
import { configureAssetCache, type PreloadTask } from "./core/assetCache.js";
import { GAME_ASSET_URLS, preloadGameAssets } from "./core/gamePreload.js";
import { CAMERA_LOADING_CHAPTERS, SCENE_CHOICES } from "./core/chapters.js";
import { MUSEUM_EXHIBITS } from "./scenes/museum/museumCatalog.js";
import {
  arcadeChallenge,
  downloadArcadeRecord,
  formatArcadeTime,
  type ArcadeDifficulty,
} from "./scripts/global/arcadeChallenges.js";
import {
  createShipMap,
  createShipMapProgress,
  SHIP_MAP_LAYOUT,
  type ShipMapLayout,
} from "./core/shipMap.js";
import { createQuartersProgress } from "./scenes/living quarters/layout.js";
import {
  createStageTwoProgress,
  collectStageTwoKeycard,
  cameraVisitMap,
  STAGE_TWO_MINIGAMES,
  STAGE_TWO_CAMERA_ORDER,
  isSurveillancePoint,
  type CameraRoomId,
  type CameraFeedId,
} from "./scenes/level 1 stage 2/stageTwoLayout.js";
import { createScene as createScene1 } from "./scenes/scene1.js";
import { createHoldToSkip } from "./scripts/global/holdToSkip.js";
import {
  createCinematicLoadingScreen,
  type LoadingDestination,
} from "./scripts/global/cinematicLoading.js";
import type { LaunchState } from "./scenes/level 1 boss stage/scene14.js";
import type {
  FlightExitState,
  FlightStartPhase,
} from "./scenes/level 2/scene15.js";
import type { RescueArrival } from "./scripts/global/rescueSite.js";
import type { FinaleCheckpoint } from "./scripts/global/finaleDirector.js";
import type { FinaleLocalMatch } from "./scenes/level 3/finaleArcade.js";
import {
  loadCharacter,
  TELEPORT_TRANSFER_DURATION,
  hologramTransitionAt,
} from "./scripts/player/characterManager.js";
import {
  startCharacterPreview,
  stopCharacterPreview,
  setCharacterPreviewPostRender,
  getCharacterPreviewRenderer,
} from "./scripts/global/characterPreview.js";
import { renderArcadePortraits } from "./scripts/global/arcadePortraits.js";
import type { Player, PlayerTransitionState } from "./scripts/player/player.js";
import { PLAYER_MAX_HEALTH } from "./scripts/player/player.js";
import { PistolController } from "./scripts/weapons/pistol.js";
import { CrowbarController } from "./scripts/weapons/crowbar.js";
import { GogglesController } from "./scripts/player/goggles.js";
import { GogglesPostProcess } from "./scripts/player/gogglesPostProcess.js";
import { GpuTimer } from "./scripts/global/gpuTimer.js";
import { BloomstickController } from "./scripts/weapons/bloomstick.js";
import { UnarmedCombatController } from "./scripts/weapons/unarmedCombat.js";
import { AdaptiveHintManager } from "./scripts/player/adaptiveHints.js";
import {
  getPrimeHintsEnabled,
  initializePrimeHints,
  setPrimeHintsEnabled,
} from "./scripts/player/primeHints.js";
import {
  createCctvSystem,
  type CctvFeedDefinition,
} from "./scripts/npc/cctv.js";
import {
  TeleportationDeviceController,
  teleportPlayer,
} from "./scripts/global/teleportationDevice.js";
import {
  createWeaponWheel,
  type WeaponId,
  type WeaponWheelEntry,
} from "./scripts/weapons/weaponWheel.js";
import type { createFirstPersonHands } from "./scripts/player/firstPersonHands.js";
import {
  initTouchControls,
  setTouchFlightMode,
  resetTouchInput,
  registerWeaponEquip,
} from "./scripts/player/touchControls.js";
import {
  createGamepadInput,
  isControllerActive,
  isControllerEvent,
  isControllerType,
  controllerTypeName,
  controllerText,
  controllerMenuLabel,
  inputHint,
  CONTROLLER_LESSONS,
  type InputMode,
  type ControllerContext,
  type ControllerMenuAction,
  type ControllerStatus,
} from "./scripts/player/gamepadInput.js";
import { getControlsReference } from "./scripts/player/controlsReference.js";
import {
  renderControllerBinding,
  renderControllerPrompt,
} from "./scripts/player/controllerIcons.js";
import {
  createInputPromptObserver,
  formatDialogue,
  setInputHint,
} from "./scripts/global/inputPrompts.js";
import { popupDuration } from "./scripts/global/popupTiming.js";
import { PixelArtPass } from "./core/PixelArtPass.js";
import { RetroConsolePass } from "./core/RetroConsolePass.js";
import {
  getAudioSettings,
  setAudioVolume,
  setAudioMenuPaused,
  setVoiceActingEnabled,
  setVoiceActingDeveloperMode,
  subscribeAudioSettings,
} from "./helpers/audio/AudioManager.js";
import { preloadMusic } from "./helpers/audio/bufferedMusic.js";
import { createGameMusic, MUSIC_URLS } from "./helpers/audio/gameMusic.js";
import { createGameSoundscape } from "./helpers/audio/gameSoundscape.js";
import { updateSpatialAudio } from "./helpers/audio/spatialAudio.js";
import { updateDialogueVoice } from "./helpers/audio/dialogueVoice.js";
import {
  loadToolModel,
  PLAYABLE_CHARACTER_NAMES,
  isPlayableCharacter,
  yieldToMainThread,
  type PlayableCharacter,
} from "./core/loader.js";

configureAssetCache(GAME_ASSET_URLS);
const openingMusicReady = preloadMusic(MUSIC_URLS.loading);
void openingMusicReady.catch((error) =>
  console.error("[Opening] Soundtrack preparation failed:", error),
);
window.addEventListener("music-unavailable", (event) => {
  const warning = document.getElementById("music-warning")!;
  warning.textContent = (
    event as CustomEvent<{ message: string }>
  ).detail.message;
  warning.classList.remove("hidden");
});

const sceneImports = {
  0: () => import("./scenes/prologue/prologue_scene_1.js"),
  0.5: () => import("./scenes/living quarters/scene.js"),
  1.1: () => import("./scenes/level 1 stage 1/storageRoom.js"),
  1.2: () => import("./scenes/level 1 stage 2/scene.js"),
  1.3: () => import("./scenes/level 1 stage 2/equipmentRoom.js"),
  1.4: () => import("./scenes/level 1 stage 2/rustChamber.js"),
  1.45: () => import("./scenes/level 1 stage 2/rustChamber2.js"),
  1.5: () => import("./scenes/level 1 stage 2/reactorSequencer.js"),
  5: () => import("./scenes/level 1 stage 2/cargoHold.js"),
  6: () => import("./scenes/level 1 stage 2/targetRange.js"),
  13: () => import("./scenes/level 1 boss stage/scene13.js"),
  14: () => import("./scenes/level 1 boss stage/scene14.js"),
  15: () => import("./scenes/level 2/scene15.js"),
  16: () => import("./scenes/level 2/scene16.js"),
  17: () => import("./scenes/level 3/scene17.js"),
  20: () => import("./scenes/level 3/scene20.js"),
  21: () => import("./scenes/level 3/scene21.js"),
  99: () => import("./scenes/museum/museum.js"),
  100: () => import("./scenes/trailer/scene.js"),
  101: () => import("./scenes/level 3/finaleArcade.js"),
};
type SceneModuleId = keyof typeof sceneImports;
const sceneModules = new Map<SceneModuleId, Promise<unknown>>();
let sceneRequestVersion = 0;

function sceneModule<Id extends SceneModuleId>(
  id: Id,
): ReturnType<(typeof sceneImports)[Id]> {
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
    document.getElementById("scene-menu-error")!.textContent =
      "Unable to load that scene. Please try again.";
    return null;
  }
}

let stageTwoProgress = createStageTwoProgress();

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(
  Math.min(
    window.devicePixelRatio,
    window.matchMedia("(pointer: coarse)").matches ? 1 : 1.5,
  ),
);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.position = "relative";
renderer.domElement.style.zIndex = "1";

const cctv = createCctvSystem(
  (
    [
      ...STAGE_TWO_MINIGAMES.map((room) => ({
        ...room,
        cleared: () => stageTwoProgress.remoteRooms[room.id].rewardCollected,
      })),
      {
        id: "stage2-vents",
        label: "Vent maze",
        cleared: () => stageTwoProgress.ventCleared,
      },
      {
        id: "stage2-prison",
        label: "Prison",
        cleared: () => true,
      },
    ] satisfies CctvFeedDefinition[]
  ).sort(
    (a, b) =>
      STAGE_TWO_CAMERA_ORDER.findIndex((id) => id === a.id) -
      STAGE_TWO_CAMERA_ORDER.findIndex((id) => id === b.id),
  ),
);
const gogglesPostProcess = new GogglesPostProcess(renderer);
const screenBloom = createScreenBloom(
  renderer,
  window.matchMedia("(pointer: coarse)").matches,
);
const pixelArtPass = new PixelArtPass();
const retroConsolePass = new RetroConsolePass();
const gpuTimer = new GpuTimer(renderer.getContext());
let perfTimersEnabled = true;
let latestCpuFrameMs = 0;
const minimap = createSceneMinimap(
  renderer,
  document.getElementById("minimap")!,
);

// --- Audio ---
const audioManager = null;
const music = createGameMusic();
const soundscape = createGameSoundscape();
const cinematicLoading = createCinematicLoadingScreen();
type MenuFont = "normal" | "sefa" | "comic-sans";
let menuFont: MenuFont = "normal";
function applyMenuFont(font: MenuFont) {
  menuFont = font;
  document.documentElement.dataset.menuFont = font;
}
applyMenuFont(menuFont);
let openingReady = false,
  fullGamePreparation: Promise<void> | null = null;
let playLoading = false,
  preparationSteps = 0;

// --- Scene Management ---
let currentSceneData: any = null;
let scene1Data: any = null;
let activeScene: THREE.Scene | null = null;
let activeCamera: THREE.PerspectiveCamera | null = null;
let updatePhysics: ((dt: number, thirdPerson?: boolean) => void) | null = null;
let cutsceneManager: any = null;
let lastSplinePoint: THREE.Vector3 | null = null;
let activeSceneId = "scene1";
let quickMenuOpen = false;
let freeCameraOpen = false;
let freeCamera: FreeCameraController | null = null;
let freeCameraAnalogInput = { movement: { x: 0, y: 0 }, look: { x: 0, y: 0 }, speed: 0 };
let weaponWheelOpen = false;
let controllerInput: ReturnType<typeof createGamepadInput> | null = null;
let controllerNoticeTime = 0;
let teleportLoading = false;
let teleportArrivalTime = -1;
let teleportArrivalColor: THREE.ColorRepresentation = 0x2d8fff;
let teleportDepartureTime = -1;
let returnTeleportPending = false;
const RETURN_TELEPORT_SECONDS = 0.45;
let stage1LoadingShown = false;
let checkpointNoticeTime = 0;
let nextSceneActionId = 0;
const pendingSceneActions = new Map<
  number,
  { remaining: number; run: () => void }
>();

function beginCinematicLoading(
  destination: LoadingDestination,
  minimum?: number,
) {
  weaponWheel.close();
  if (quickMenuOpen) setPauseMenu(null, false);
  clearSceneInput();
  if (document.pointerLockElement) document.exitPointerLock();
  return cinematicLoading.begin(destination, minimum);
}

// The main loop neither updates nor renders behind the loading screen, so run the first frames of
// the new scene here; texture uploads, shadow programs and setup states stay hidden.
async function warmBehindLoading(
  request: number,
  frames = 3,
  {
    renderingReady = false,
    freezeStory = false,
  }: { renderingReady?: boolean; freezeStory?: boolean } = {},
) {
  if (request !== sceneRequestVersion || !activeScene || !activeCamera)
    return false;
  updatePlayerView(0);
  if (!renderingReady)
    await prepareSceneRendering(
      renderer,
      currentSceneData?.getRenderScene?.() ?? activeScene,
      activeCamera,
    );
  for (let frame = 0; frame < frames; frame++) {
    if (request !== sceneRequestVersion || !activeScene || !activeCamera)
      return false;
    const delta = freezeStory ? 0 : 1 / 60;
    updatePhysics?.(delta, isThirdPerson);
    updatePlayerView(delta);
    const scene = currentSceneData?.getRenderScene?.() ?? activeScene;
    updateComicEffects(scene, activeCamera, delta, renderer);
    renderGameplayFrame(scene, activeCamera);
    renderMinimap(true);
    if (currentSceneData?.hideMinimap?.()) minimap.hide();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return request === sceneRequestVersion;
}

function renderGameScene(scene: THREE.Scene, camera: THREE.Camera) {
  prepareEnvironmentComicShading(scene);
  if (currentSceneData?.renderSceneWithEffects) {
    currentSceneData.renderSceneWithEffects(renderer, scene, camera);
    currentSceneData.renderCinematicOverlay?.(renderer);
    return;
  }
  goggles.update();
  gogglesPostProcess.render(scene, camera, () => {
    renderSceneEffects(scene, camera);
    if (
      !deathPresentation &&
      !currentSceneData?.isCinematic?.() &&
      !currentSceneData?.ownsWeaponInput
    ) {
      crowbar.renderFirstPerson(renderer);
      pistol.renderFirstPerson(renderer);
      bloomstick.renderFirstPerson(renderer);
      unarmedCombat.renderFirstPerson(renderer);
    }
  });
  currentSceneData?.renderCinematicOverlay?.(renderer);
}
function renderSceneEffects(scene: THREE.Scene, camera: THREE.Camera) {
  const shouldInvert = currentSceneData?.shouldInvertColors?.() ?? false;
  if (shouldInvert) {
    currentSceneData?.consumeInvertFrame?.();
  }

  const retroStrength = currentSceneData?.getRetroConsoleStrength?.() ?? 0;
  if (retroStrength > 0) {
    retroConsolePass.render(
      renderer,
      renderer.render.bind(renderer),
      scene,
      camera,
      retroStrength,
    );
    return;
  }
  const strength = currentSceneData?.getPixelArtStrength?.() ?? 0;
  if (strength > 0)
    pixelArtPass.render(
      renderer,
      renderer.render.bind(renderer),
      scene,
      camera,
      strength,
    );
  else {
    renderer.render(scene, camera);
  }
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
    if (action.remaining <= 0) {
      pendingSceneActions.delete(id);
      action.run();
    }
  }
}
let scene1SkipVisible = false;
let scene1SkipHold: ReturnType<typeof createHoldToSkip> | null = null;
let quartersProgress = createQuartersProgress();
const COMPLETION_KEY = "brondons-revenge-completed";
let campaignCompleted = false,
  developerRun = false;
try {
  campaignCompleted = window.localStorage.getItem(COMPLETION_KEY) === "1";
} catch (error) {
  console.warn("[Progress] Unable to read campaign completion:", error);
}
const shipMapProgress = createShipMapProgress();
let mappedSceneData: unknown = null;
let bayBossDefeated = false;

// --- Global Character (persists across scenes) ---
let globalCharacter: Awaited<ReturnType<typeof loadCharacter>> = null;
let playerSilhouetteEnabled = false;
let globalCharacterId: PlayableCharacter | null = null;
const characterPreparations = new Map<
  PlayableCharacter,
  Promise<NonNullable<Awaited<ReturnType<typeof loadCharacter>>>>
>();
let currentPlayer: Player | null = null;

// --- Session inventory ---
let hasCrowbar = false;
let hasPistol = false;
let healthPackCollectedScene13 = false;
let hintManager: AdaptiveHintManager | null = null;
let crowbarController: CrowbarController | null = null;
let hasBloomstick = false;
let bloomstickController: BloomstickController | null = null;
let firstPersonHands: Awaited<
  ReturnType<typeof createFirstPersonHands>
> | null = null;
let firstPersonHandsLoading: Promise<void> | null = null;
let firstPersonHandsFailed = false;

function prepareFirstPersonHands() {
  firstPersonHandsLoading ??= import("./scripts/player/firstPersonHands.js")
    .then(async ({ createFirstPersonHands }) => {
      firstPersonHands = await createFirstPersonHands();
    })
    .catch((error) => {
      firstPersonHandsLoading = null;
      console.error("Failed to load crowbar hands:", error);
      throw error;
    });
  return firstPersonHandsLoading;
}

function getFirstPersonHands() {
  if (
    !firstPersonHands &&
    !firstPersonHandsLoading &&
    !firstPersonHandsFailed &&
    !isGameplayThirdPerson()
  ) {
    void prepareFirstPersonHands().catch(() => {
      firstPersonHandsFailed = true;
      showTeleportDeviceMessage(
        "First-person hands could not be loaded. Reload the game to try again.",
      );
    });
  }
  return firstPersonHands;
}

// --- View toggle (first-person / third-person) ---
let isThirdPerson = true;
const THIRD_PERSON_DIST = 1.5;
const THIRD_PERSON_HEIGHT = 0.3;
const THIRD_PERSON_RIGHT = 0.7;

function isGameplayThirdPerson() {
  return (
    (isThirdPerson || !!currentSceneData?.forceThirdPerson) &&
    !isCameraForcedFirstPerson(activeCamera)
  );
}

const pistol = new PistolController(
  () => ({
    scene: activeScene,
    camera: activeCamera,
    world: currentSceneData?.physicsWorld ?? null,
    player:
      (freeCameraOpen && !freeCamera?.isParked()) ||
      returnTeleportPending ||
      currentSceneData?.ownsWeaponInput ||
      currentSceneData?.isCinematic?.() ||
      deathPresentation
        ? null
        : currentPlayer,
    character: globalCharacter?.model ?? null,
    thirdPerson: isGameplayThirdPerson(),
    targets: currentSceneData?.getDamageTargets?.() ?? [],
    hasPistol,
    weaponAnimation: currentSceneData?.ownsWeaponInput
      ? undefined
      : globalCharacter?.weapon,
    holsterOther: () => {
      crowbarController?.holster();
      bloomstickController?.holster();
    },
    onShot: (point, origin) => currentSceneData?.onPistolShot?.(point, origin),
    firstPersonHands: getFirstPersonHands,
  }),
  async () => {
    await openingMusicReady;
    return loadToolModel("Gun_Revolver");
  },
);

const crowbar = new CrowbarController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player:
    (freeCameraOpen && !freeCamera?.isParked()) ||
    returnTeleportPending ||
    currentSceneData?.ownsWeaponInput ||
    currentSceneData?.isCinematic?.() ||
    deathPresentation
      ? null
      : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  hasCrowbar,
  targets: currentSceneData?.getDamageTargets?.() ?? [],
  setCharacterEquipped: (equipped: boolean) =>
    globalCharacter?.setCrowbarEquipped(equipped),
  doorTarget: currentSceneData?.forwardDoorTarget ?? null,
  openDoor: () => {
    currentSceneData?.hitForwardDoor?.();
    currentSceneData?.hitCargoDoor?.();
  },
  holsterOther: () => {
    pistol.holster();
    bloomstickController?.holster();
  },
  firstPersonHands: getFirstPersonHands,
}));
crowbarController = crowbar;
const bloomstick = new BloomstickController(() => ({
  scene: activeScene,
  camera: activeCamera,
  world: currentSceneData?.physicsWorld ?? null,
  player:
    (freeCameraOpen && !freeCamera?.isParked()) ||
    returnTeleportPending ||
    currentSceneData?.ownsWeaponInput ||
    currentSceneData?.isCinematic?.() ||
    deathPresentation
      ? null
      : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  hasBloomstick,
  bladeColor: arcade.active ? globalCharacter?.arcadeBladeColor : undefined,
  attackClips: globalCharacter?.bloomstickAttackClips,
  targets: currentSceneData?.getDamageTargets?.() ?? [],
  setCharacterEquipped: (equipped) =>
    globalCharacter?.setBloomstickEquipped(equipped),
  openDoor: () => {
    currentSceneData?.hitForwardDoor?.();
    currentSceneData?.hitCargoDoor?.();
  },
  holsterOther: () => {
    crowbar.holster();
    pistol.holster();
  },
  getParryableBolts: () => currentSceneData?.getParryableBolts?.() ?? [],
  firstPersonHands: getFirstPersonHands,
}));
bloomstickController = bloomstick;
const unarmedCombat = new UnarmedCombatController(() => ({
  scene: activeScene,
  world: currentSceneData?.physicsWorld ?? null,
  player:
    (freeCameraOpen && !freeCamera?.isParked()) ||
    returnTeleportPending ||
    currentSceneData?.ownsWeaponInput ||
    currentSceneData?.isCinematic?.() ||
    deathPresentation
      ? null
      : currentPlayer,
  character: globalCharacter?.model ?? null,
  thirdPerson: isGameplayThirdPerson(),
  unarmed: equippedWeapon() === "unarmed",
  attackClips: globalCharacter?.unarmedAttackClips ?? [],
  targets: currentSceneData?.getDamageTargets?.() ?? [],
  firstPersonHands: getFirstPersonHands,
}));
const goggles = new GogglesController(() => ({
  player:
    (freeCameraOpen && !freeCamera?.isParked()) ||
    returnTeleportPending ||
    currentSceneData?.ownsWeaponInput ||
    currentSceneData?.isCinematic?.() ||
    deathPresentation
      ? null
      : currentPlayer,
  setCharacterEquipped: (active) => {
    globalCharacter?.setGogglesEquipped(active);
    globalCharacter?.setCellShadingEnabled(!active);
    if (activeSceneId === "scene6")
      currentSceneData?.setGogglesActive?.(active);
  },
  onToggle: (active) => gogglesPostProcess.setActive(active),
}));

// --- Teleport crystal shard ---
let teleportDeviceMessageTimeout: number | null = null;
function showTeleportDeviceMessage(message: string) {
  if (currentSceneData?.showTeleportMessage) {
    currentSceneData.showTeleportMessage(message);
    return;
  }
  const prompt = document.getElementById("interact-prompt");
  if (!prompt) return;
  setInputHint(prompt, message, "foot", true);
  prompt.classList.remove("hidden");
  if (teleportDeviceMessageTimeout)
    pendingSceneActions.delete(teleportDeviceMessageTimeout);
  teleportDeviceMessageTimeout = scheduleSceneAction(
    () => {
      prompt.classList.add("hidden");
      teleportDeviceMessageTimeout = null;
    },
    popupDuration(3) * 1000,
  );
}

// Prime speaks from the top-left corner of the screen during gameplay, styled like the prologue's Prime panel.
function installPrimeDialoguePlacement() {
  const mark = (node: Node) => {
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element || element.closest("#prologue-dialogue, .finale-dialogue"))
      return;
    const text = (element.textContent ?? "").trim();
    if (
      element.matches(
        "#quarters-speaker, .quarters-speaker, .facility-dialogue strong, .finale-dialogue strong",
      )
    ) {
      const panel = element.parentElement;
      if (panel) {
        panel.dataset.dialogueSpeaker = text.toUpperCase();
        panel.classList.add("dialogue-panel");
        panel.classList.toggle(
          "prime-top-left",
          text.toLowerCase() === "prime",
        );
      }
      return;
    }
    if (element.children.length || text.length > 400) return;
    const rendered = formatDialogue(
      element,
      text,
      element.dataset.inputHint ?? text,
    );
    if (rendered !== text) element.textContent = rendered;
  };
  new MutationObserver((records) => {
    for (const record of records) {
      mark(record.target);
      record.addedNodes.forEach((added) => {
        if (added instanceof HTMLElement && !added.children.length) mark(added);
      });
    }
  }).observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  // Room names share the top-left corner and step aside whenever Prime is talking.
  window.setInterval(() => {
    const speaking = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".prime-top-left, #prime-stealth-hint",
      ),
    ).some((element) => {
      if (!element.textContent?.trim() || !element.getClientRects().length)
        return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && Number(style.opacity) > 0.05;
    });
    document.body.classList.toggle("prime-speaking", speaking);
  }, 150);
}
installPrimeDialoguePlacement();

function surveillanceMarkerPlaced() {
  return stageTwoProgress.checkpoint === "surveillance";
}

function isCameraVisit(id: string) {
  return STAGE_TWO_MINIGAMES.some((room) => room.id === id);
}

function grantDeveloperEquipment() {
  hasPistol = hasCrowbar = hasBloomstick = true;
  stageTwoProgress.crowbarCollected = true;
  stageTwoProgress.bloomstickCollected = true;
  quartersProgress.pistolCollected = true;
  quartersProgress.crystalCollected = true;
  quartersProgress.gogglesCollected = true;
  if (!goggles.isCollected()) goggles.collect(false);
  teleportDevice.collect(false);
}

function equipmentInputBlocked() {
  return (
    document.hidden ||
    quickMenuOpen ||
    weaponWheelOpen ||
    teleportLoading ||
    !!deathPresentation ||
    !currentPlayer?.isEnabled() ||
    currentPlayer.getHealth() <= 0 ||
    !!document.getElementById("fade-overlay")?.classList.contains("active") ||
    (currentSceneData?.ownsWeaponInput
      ? !currentSceneData?.canSelectWeapon?.()
      : !!currentSceneData?.isCinematic?.())
  );
}

const teleportDevice = new TeleportationDeviceController(() => ({
  currentSceneId: activeSceneId,
  isBossFight: () =>
    activeSceneId === "scene13" || !!currentSceneData?.isArenaLocked?.(),
  isInputBlocked: () =>
    equipmentInputBlocked() ||
    !!currentSceneData?.ownsWeaponInput ||
    !!currentPlayer?.getState().climbing ||
    !!currentPlayer?.getState().boxHandling,
  getActiveScene: () => activeScene,
  getPlayerRadius: () => currentPlayer?.radius ?? 0.3,
  getPlayerPosition: () =>
    currentPlayer ? { ...currentPlayer.body.position } : { x: 0, y: 0, z: 0 },
  getPlayerRotation: () => currentPlayer?.getState().yaw ?? 0,
  getAimDirection: () => {
    const direction = new THREE.Vector3(0, 0, -1);
    activeCamera?.getWorldDirection(direction);
    return direction;
  },
  onTeleport: (sceneId, position, rotation) => {
    void teleportToAnchor(sceneId, position, rotation);
  },
  showMessage: showTeleportDeviceMessage,
  canPlace: (_sceneId, position) =>
    currentSceneData?.canPlaceMarker?.(position) ?? null,
  getBounceImpulse: (point, normal, velocity) =>
    currentSceneData?.getThrowBounce?.(point, normal, velocity) ?? null,
  placementMessage: () =>
    isCameraVisit(activeSceneId)
      ? "Crystal ready. Press T."
      : "Purple marker placed. Press T to teleport to it; hold Tab to choose weapons.",
  returnError: (state) =>
    isCameraVisit(activeSceneId) && state.placementScene !== activeSceneId
      ? "Press Q to place a marker in this minigame. Press R to return to the camera room."
      : null,
}));

async function teleportToAnchor(
  sceneId: string,
  position: { x: number; y: number; z: number },
  rotation: number,
) {
  if (!currentPlayer || teleportLoading) return;
  const state = currentPlayer.captureTransition({ x: 0, y: 0, z: 0 });
  if (sceneId !== activeSceneId) {
    if (sceneId !== "stage2-infiltration" || !surveillanceMarkerPlaced()) {
      showTeleportDeviceMessage(
        "That marker has no return link. Place your home marker in surveillance.",
      );
      return;
    }
    teleportLoading = true;
    clearSceneInput();
    const request = sceneRequestVersion + 1;
    try {
      const loaded = await loadStageTwo(state);
      if (request !== sceneRequestVersion) return;
      if (!loaded || activeSceneId !== sceneId)
        throw new Error("The surveillance return link did not activate");
    } catch (error) {
      console.error("Teleport failed:", error);
      showTeleportDeviceMessage(
        "Teleport failed. Your anchor is saved; try again.",
      );
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
  teleportArrivalTime = arcade.run?.id === 1.25 ? -1 : 0;
  teleportArrivalColor = 0xbd77ff;
  updatePlayerView(0);
  globalCharacter?.setHologramTransition(
    arcade.run?.id === 1.25
      ? null
      : hologramTransitionAt(
          0,
          true,
          TELEPORT_TRANSFER_DURATION,
          teleportArrivalColor,
        ),
  );
  teleportDevice.update(0);
}

function weaponEntries(): WeaponWheelEntry[] {
  const entries: WeaponWheelEntry[] = [{ id: "unarmed", label: "Unarmed" }];
  if (hasPistol) entries.push({ id: "pistol", label: "Pistol" });
  if (hasCrowbar) entries.push({ id: "crowbar", label: "Crowbar" });
  if (hasBloomstick)
    entries.push({
      id: "bloomstick",
      label: "Bloomstick",
    });
  return entries;
}
function equippedWeapon(): WeaponId {
  if (currentSceneData?.ownsWeaponInput)
    return currentSceneData.getEquippedWeapon?.() ?? "unarmed";
  return bloomstick.isEquipped()
    ? "bloomstick"
    : crowbar.isEquipped()
      ? "crowbar"
      : pistol.isEquipped()
        ? "pistol"
        : "unarmed";
}
function selectWeapon(id: WeaponId) {
  if (
    equipmentInputBlocked() ||
    !weaponEntries().some((entry) => entry.id === id)
  )
    return;
  if (currentSceneData?.ownsWeaponInput) currentSceneData.selectWeapon(id);
  else {
    unarmedCombat.reset();
    pistol.holster();
    crowbar.holster();
    bloomstick.holster();
    if (id === "pistol") pistol.equip();
    else if (id === "crowbar") crowbar.equip();
    else if (id === "bloomstick") bloomstick.equip();
  }
  const status = document.getElementById("weapon-status");
  if (status)
    status.textContent = inputHint(
      `${weaponEntries().find((entry) => entry.id === id)!.label} | Hold Tab: weapons | Left click: attack`,
    );
  updatePlayerView(0);
}
const weaponWheel = createWeaponWheel({
  getEntries: weaponEntries,
  getCurrentId: equippedWeapon,
  isBlocked: equipmentInputBlocked,
  onSelect: selectWeapon,
  setPaused(paused) {
    weaponWheelOpen = paused;
    music.setWeaponWheelOpen(paused);
    clearSceneInput();
    const blocked = paused || quickMenuOpen;
    document.body.classList.toggle("quick-menu-open", blocked);
    if (blocked) setAudioMenuPaused(true);
    currentSceneData?.setMenuPaused?.(blocked);
    if (!blocked) setAudioMenuPaused(false);
  },
});
for (const id of ["pistol", "crowbar", "bloomstick"] as const) {
  registerWeaponEquip(id, () =>
    selectWeapon(equippedWeapon() === id ? "unarmed" : id),
  );
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

function setFreeCamera(open: boolean) {
  if (!import.meta.env.DEV || open === freeCameraOpen) return;
  if (open) {
    if (!activeCamera || !activeScene || quickMenuOpen || teleportLoading)
      return;
    clearSceneInput();
    freeCamera = new FreeCameraController(activeCamera, renderer.domElement);
    freeCamera.setAnalogInputProvider(() => 
      isControllerActive() ? freeCameraAnalogInput : null
    );
    freeCamera.setParkCallbacks(
      () => {
        document.body.classList.add("free-camera-parked");
        currentSceneData?.setMenuPaused?.(false);
      },
      () => {
        document.body.classList.remove("free-camera-parked");
        currentSceneData?.setMenuPaused?.(true);
      },
    );
    freeCamera.enter();
    freeCameraOpen = true;
    document.body.classList.add("free-camera-open");
    currentSceneData?.setMenuPaused?.(true);
    return;
  }
  freeCamera?.dispose();
  freeCamera = null;
  freeCameraOpen = false;
  freeCameraAnalogInput = { movement: { x: 0, y: 0 }, look: { x: 0, y: 0 }, speed: 0 };
  document.body.classList.remove("free-camera-open", "free-camera-parked");
  currentSceneData?.setMenuPaused?.(false);
}

/** Camera the scene is drawn with; a parked free camera overrides gameplay. */
function viewCamera(fallback: THREE.PerspectiveCamera) {
  return freeCamera?.isParked()
    ? freeCamera.getRenderCamera(fallback)
    : fallback;
}

// --- Initialize App ---
async function initializeApp() {
  initializePrimeHints();
  createInputPromptObserver();
  await loadScene1();
  initializeControls();
  setupViewToggle();
  setupSceneQuickMenu();
  setupArcadeResults();
  initTouchControls();
  setupControllerInput();

  hintManager = new AdaptiveHintManager();

  const preview = new URLSearchParams(window.location.search);
  const developerPreview =
    import.meta.env.DEV &&
    [
      "living-quarters",
      "stage1-stealth",
      "stage2-infiltration",
      "stage2-hub",
    ].some((key) => preview.has(key));
  if (developerPreview) {
    developerRun = true;
    grantDeveloperEquipment();
    await prepareGlobalCharacter();
  }
  if (import.meta.env.DEV && preview.has("living-quarters")) {
    developerRun = true;
    await loadLivingQuarters();
  } else if (
    import.meta.env.DEV &&
    (preview.has("stage1-stealth") ||
      preview.has("stage2-infiltration") ||
      preview.has("stage2-hub"))
  ) {
    if (preview.has("stage2-hub")) {
      stageTwoProgress.checkpoint = "surveillance";
      stageTwoProgress.ventCleared = true;
      collectStageTwoKeycard(stageTwoProgress, "stage2-vents");
      await loadStageTwo();
    } else if (preview.has("stage2-infiltration")) await loadStageTwo();
    else await loadStage1Storage();
  }
}

async function prepareGlobalCharacter() {
  const selected = arcade.active ? arcade.character : "brondon";
  if (globalCharacter && globalCharacterId === selected) return;
  let preparation = characterPreparations.get(selected);
  if (!preparation) {
    preparation = loadCharacter(undefined, selected)
      .then((character) => {
        if (!character)
          throw new Error("The player character could not be prepared");
        character.setSilhouetteEnabled(playerSilhouetteEnabled);
        return character;
      })
      .catch((error) => {
        characterPreparations.delete(selected);
        console.error("[Character] Preparation failed:", error);
        throw error;
      });
    characterPreparations.set(selected, preparation);
  }
  const character = await preparation;
  globalCharacter?.model.removeFromParent();
  globalCharacter = character;
  globalCharacterId = selected;
  character.setSilhouetteEnabled(playerSilhouetteEnabled);
}

function prepareEntireGame(loading: ReturnType<typeof beginCinematicLoading>) {
  if (!fullGamePreparation) {
    const modules: PreloadTask[] = (
      Object.keys(sceneImports).map(Number) as SceneModuleId[]
    ).map((id) => ({
      label: "Preparing chapter and cutscene code",
      run: () => sceneModule(id),
    }));
    const setup: PreloadTask[] = [
      { label: "Preparing weapon readiness", run: () => pistol.ready },
      {
        label: "Preparing player animation and equipment",
        run: prepareGlobalCharacter,
      },
      { label: "Preparing first-person hands", run: prepareFirstPersonHands },
      {
        label: "Preparing the opening chapter music",
        run: () => preloadMusic(MUSIC_URLS.prologue),
      },
      {
        label: "Preparing the chain-break music cue",
        run: () => preloadMusic(MUSIC_URLS["broken-chains"]),
      },
    ];
    fullGamePreparation = preloadGameAssets(
      modules,
      setup,
      (progress, note) => {
        preparationSteps = progress.total + 1;
        loading.setProgress(
          progress.completed,
          preparationSteps,
          progress.label,
        );
        loading.setNote(note);
      },
    ).catch((error) => {
      fullGamePreparation = null;
      throw error;
    });
  }
  return fullGamePreparation;
}

// Control cards are introduced once per play session, including across respawns.
type ControlCard = {
  key: string;
  title: string;
  lines: string[];
  touch: string[];
  scene?: string;
};
const seenControls = new Set<string>();
let controlQueue: ControlCard[] = [];
let shownControl: ControlCard | null = null;
let controlTime = 0;
const controlCard = document.getElementById("control-card")!;
const lessons: Record<string, Omit<ControlCard, "key" | "scene">> = {
  quarters: {
    title: "Living quarters",
    lines: [
      "WASD move · Shift sprint · Mouse look",
      "C crouch · forward + C slide tackle",
      "Look at nameplate · E interact · V view · M pause & map",
    ],
    touch: [
      "Left stick move · right drag look",
      "CROUCH · forward + CROUCH slide tackle",
      "USE interact · VIEW camera · MENU pause & map",
    ],
  },
  basics: {
    title: "You're awake",
    lines: [
      "WASD move · Shift sprint · Space jump",
      "Mouse look · click the world to capture it",
      "C crouch · forward + C slide tackle",
      "E interact · Hold Tab weapons · V view · M pause",
    ],
    touch: [
      "Left stick move · right drag look",
      "RUN · JUMP · CROUCH (forward = slide tackle)",
      "USE interact · hold a weapon to equip · VIEW · MENU",
    ],
  },
  stealth: {
    title: "Stealth movement",
    lines: [
      "Stay crouched in the hangar · C keeps you low",
      "Hold Shift for up to 5 seconds of normal RUN",
      "Release Shift to recharge RUN beside the UNSEEN meter",
    ],
    touch: [
      "Stay crouched in the hangar",
      "Hold SPRINT for up to 5 seconds of normal RUN",
      "Release SPRINT to recharge the RUN meter",
    ],
  },
  pistol: {
    title: "Pistol",
    lines: ["Hold Tab → pistol · Left click fire"],
    touch: ["PISTOL equip · SHOOT fire"],
  },
  crowbar: {
    title: "Crowbar acquired",
    lines: ["Hold Tab → crowbar · Left click swing"],
    touch: ["CROW equip · SWING attack"],
  },
  bloomstick: {
    title: "Bloomstick",
    lines: [
      "Hold Tab → bloomstick · Left click swing",
      "Five rapid clicks → heavy combo · Time swings to parry",
    ],
    touch: [
      "BLOOMSTICK equip · SLASH attack",
      "Time swings to deflect incoming shots",
    ],
  },
  teleport: {
    title: "Teleporting crystal shard",
    lines: ["Q place anchor · T teleport to it"],
    touch: ["Q place anchor · T teleport"],
  },
  goggles: {
    title: "Scanner goggles acquired",
    lines: ["N wear / remove goggles"],
    touch: ["GOGGLES wear / remove"],
  },
  vent: {
    title: "Vent maze",
    lines: [
      "WASD / arrows move · Hold Shift crouch sprint",
      "Green sensors safe · blue pads checkpoint",
      "E climb ladder · Hold Space climb fast",
    ],
    touch: [
      "Left stick move · SPRINT faster crawl",
      "Green sensors safe · blue pads checkpoint",
      "USE mount ladder · hold JUMP climb fast",
    ],
  },
  cargo: {
    title: "Handling cargo",
    lines: ["E grab / release a box · WASD carry"],
    touch: ["USE grab / release · left stick carry"],
  },
  flight: {
    title: "Flight controls",
    lines: [
      "WASD dodge · Mouse aim",
      "Hold left click fire · Space evade",
      "V cockpit / chase · M pause",
    ],
    touch: [
      "Left stick dodge · right drag aim",
      "Hold FIRE · EVADE dodge",
      "VIEW camera · MENU pause",
    ],
  },
  flightSide: {
    title: "Sidescroll flight",
    lines: [
      "WASD move · hold left click fire forward",
      "W / S + Space dodge up / down",
    ],
    touch: [
      "Left stick move · hold FIRE forward",
      "Up / down + EVADE vertical dodge",
    ],
  },
  flightTop: {
    title: "Top-down flight",
    lines: [
      "WASD move · hold left click fire upward",
      "A / D + Space dodge left / right",
    ],
    touch: [
      "Left stick move · hold FIRE upward",
      "Left / right + EVADE lateral dodge",
    ],
  },
  jungle: {
    title: "Back on the ground",
    lines: [
      "WASD move · Shift sprint · Space jump",
      "C crouch · forward + C slide tackle",
      "Hold Tab weapon · left click attack · V view",
    ],
    touch: [
      "Left stick move · right drag look · RUN · JUMP",
      "CROUCH (forward = slide tackle)",
      "Weapon to select · attack · VIEW camera",
    ],
  },
  platformer: {
    title: "Platforming controls",
    lines: [
      "A / D move · Space jump · Shift sprint · C crouch",
      "Mouse aim · Hold Tab weapon · hold left click attack",
    ],
    touch: [
      "Left stick move · JUMP · RUN · CROUCH",
      "Right drag aim · weapon select · hold FIRE",
    ],
  },
  finale: {
    title: "Final boss controls",
    lines: [
      "A / D move · J sword chain · F Branden's Tears",
      "Hold R shield / parry · Space dodge",
      "E Brendan's Will (18s recharge) · W / S rise or dive",
      "Enter skip intro · The final execution plays automatically",
    ],
    touch: [
      "LEFT / RIGHT move · UP / DOWN fly",
      "SWORD chain · SHIELD block · BOOST dodge",
      "TEARS rifle salvo · WILL ultimate",
      "The final execution plays automatically",
    ],
  },
};
function introduceControls(key: string, scene?: string) {
  if (
    seenControls.has(key) ||
    controlQueue.some((card) => card.key === key) ||
    shownControl?.key === key
  )
    return;
  dismissControls();
  controlQueue = [{ ...lessons[key], key, scene }];
}
function dismissControls() {
  shownControl = null;
  controlTime = 0;
  controlCard.classList.add("hidden");
}
function enterHudScene(id: string) {
  document.body.dataset.scene = id;
  document.body.classList.toggle("finale-active", id === "scene21" || id === "finaleArcade");
  document.body.classList.toggle("finale-local-active", id === "finaleArcade");
  hintManager?.recordActivity();
  if (id === "scene1") {
    controllerNoticeTime = 0;
    document.getElementById("controller-notice")!.classList.add("hidden");
  }
  checkpointNoticeTime = ["scene13", "scene14", "scene15", "scene16"].includes(
    id,
  )
    ? popupDuration(2.5)
    : 0;
  document
    .getElementById("scene-checkpoint")!
    .classList.toggle("hidden", checkpointNoticeTime === 0);
  dismissControls();
  document.getElementById("look-reticle")?.classList.add("hidden");
  controlQueue = controlQueue.filter((card) => !card.scene);
  minimap.reset();
  const key =
    id === "living-quarters"
      ? "quarters"
      : id === "stage1-storage"
        ? "stealth"
        : id === "scene15"
          ? "flight"
          : null;
  if (key) introduceControls(key, id);
}
function updateControlCard(dt: number) {
  const ready =
    activeSceneId !== "scene1" &&
    activeSceneId !== "scene21" &&
    !quickMenuOpen &&
    !deathPresentation &&
    (currentSceneData?.controlsReady?.() ??
      (!!currentPlayer?.isEnabled() && !currentSceneData?.isCinematic?.())) &&
    document.getElementById("fade-overlay")?.classList.contains("hidden");
  const flightScene = currentSceneData?.getSceneId?.();
  if (activeSceneId === "scene15" && flightScene && flightScene !== "scene15") {
    controlQueue = controlQueue.filter((card) => card.scene !== "scene15");
    if (shownControl?.scene === "scene15") dismissControls();
  }
  if (!ready) {
    controlCard.classList.add("hidden");
    return;
  }
  if (!shownControl && controlQueue.length) {
    shownControl = controlQueue.shift()!;
    seenControls.add(shownControl.key);
    controlTime = 12;
    document.getElementById("control-card-title")!.textContent =
      shownControl.title;
    renderShownControl();
  }
  if (shownControl) {
    controlCard.classList.remove("hidden");
    controlTime -= Math.max(0, dt);
    if (controlTime <= 0) dismissControls();
  }
}
function renderShownControl() {
  if (!shownControl) return;
  const lines = isControllerActive()
    ? CONTROLLER_LESSONS[shownControl.key]
    : document.body.classList.contains("touch-device")
      ? shownControl.touch
      : shownControl.lines;
  document.getElementById("control-card-content")!.replaceChildren(
    ...lines.map((text) => {
      const line = document.createElement("p");
      if (isControllerActive()) renderControllerBinding(line, text);
      else line.textContent = text;
      return line;
    }),
  );
  controlCard.querySelector("footer")!.textContent = isControllerActive()
    ? "Closes automatically"
    : "H to dismiss · closes automatically";
}
function renderMinimap(preparing = false) {
  // Level 2 (flight scene15 and crash scene16) scenes never show the map overlay.
  if (
    activeSceneId === "scene1" ||
    document.body.classList.contains("hangar-versus-active") ||
    document.body.classList.contains("flight-versus-active") ||
    activeSceneId === "scene15" ||
    activeSceneId === "scene16" ||
    activeSceneId === "scene21" ||
    !!cutsceneManager ||
    !!deathPresentation ||
    currentSceneData?.isCinematic?.() ||
    (!preparing && currentSceneData?.hideMinimap?.()) ||
    !activeScene ||
    !currentPlayer
  ) {
    minimap.hide();
    return;
  }
  const state = currentSceneData?.getMinimapState?.();
  minimap.render(
    currentSceneData?.getRenderScene?.() ?? activeScene,
    state?.position ?? currentPlayer.body.position,
    state?.yaw ?? currentPlayer.getState().yaw,
    state?.object ?? globalCharacter?.model ?? null,
    { ...currentSceneData?.minimap, ...state },
  );
}

function renderGameplayFrame(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
) {
  const minigame =
    isCameraVisit(activeSceneId) ||
    activeSceneId.startsWith("stage2-") ||
    activeSceneId === "scene1.2" ||
    !!currentSceneData?.isMazeActive?.();
  const comic = getComicLookEnabled() && !minigame;
  const forceOutlines = currentSceneData?.shouldForceOutlines?.() ?? false;
  setComicFrameEnabled(!minigame, forceOutlines);
  renderer.domElement.style.filter = [
    comic ? "contrast(1.07) saturate(1.12)" : "",
    currentSceneData?.shouldInvertColors?.() ? "invert(1)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  document.body.classList.toggle(
    "nonplayable-cinematic",
    !!cutsceneManager ||
      !!currentSceneData?.isCinematic?.() ||
      !!deathPresentation ||
      returnTeleportPending,
  );
  const timed = perfTimersEnabled;
  let cpuStart = 0;
  if (timed) {
    gpuTimer.begin();
    cpuStart = performance.now();
  }
  try {
    if (currentSceneData?.isMazeActive?.()) {
      renderMinimap();
      minimap.renderGameInset(scene, camera);
    } else {
      renderGameScene(scene, camera);
      screenBloom.apply(
        scene,
        camera,
        currentSceneData?.getBloomPulse?.() ?? 0,
        currentSceneData?.getBloomTargets?.() ?? [],
      );
      currentSceneData?.renderPostBloom?.(renderer);
      renderMinimap();
    }
  } finally {
    if (forceOutlines) setComicFrameEnabled(!minigame);
    if (timed) {
      latestCpuFrameMs = performance.now() - cpuStart;
      gpuTimer.end();
    }
  }
}

window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.code === "Equal" && !event.repeat && import.meta.env.DEV) {
    const target = event.target as HTMLElement | null;
    if (!target?.matches("input, textarea, select, [contenteditable]")) {
      event.preventDefault();
      setFreeCamera(!freeCameraOpen);
    }
    return;
  }
  if (event.code !== "Backslash" || event.repeat) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, select, [contenteditable]")) return;
  screenBloom.cycle();
});

// --- View toggle ---
function setupViewToggle() {
  const toggleBtn = document.getElementById("view-toggle-btn")!;
  toggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleView();
    toggleBtn.blur();
  });
  document
    .getElementById("control-card-close")!
    .addEventListener("click", (event) => {
      event.stopPropagation();
      dismissControls();
    });
  for (const node of [toggleBtn, controlCard]) {
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup"])
      node.addEventListener(type, (event) => event.stopPropagation());
  }
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (
      event.repeat ||
      quickMenuOpen ||
      (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable="true"]'))
    )
      return;
    if (
      (event.code === "Digit1" || event.code === "Numpad1") &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      playerSilhouetteEnabled = !playerSilhouetteEnabled;
      globalCharacter?.setSilhouetteEnabled(playerSilhouetteEnabled);
      return;
    }
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      document.body.classList.toggle("hud-hidden");
      return;
    }
    if (event.code === "KeyH" && shownControl) {
      event.preventDefault();
      dismissControls();
    }
    // Scenes with their own camera input consume V themselves.
    if (event.code === "KeyV" && !currentSceneData?.toggleView) toggleView();
  });
}
function canToggleView() {
  if (activeSceneId === "scene1" || quickMenuOpen || deathPresentation)
    return false;
  return (
    currentSceneData?.canToggleView?.() ??
    (!!currentPlayer?.isEnabled() &&
      !currentSceneData?.isCinematic?.() &&
      !currentSceneData?.forceThirdPerson &&
      !currentSceneData?.ownsWeaponInput)
  );
}
function updateViewButton() {
  const weaponsVisible = currentSceneData?.ownsWeaponInput
    ? !!currentSceneData?.canSelectWeapon?.()
    : !currentSceneData?.isCinematic?.();
  document
    .getElementById("touch-pistol")
    ?.classList.toggle("hidden", !hasPistol || !weaponsVisible);
  document
    .getElementById("touch-crowbar")
    ?.classList.toggle("hidden", !hasCrowbar || !weaponsVisible);
  document
    .getElementById("touch-bloomstick")
    ?.classList.toggle("hidden", !hasBloomstick || !weaponsVisible);
  const btn = document.getElementById("view-toggle-btn") as HTMLButtonElement;
  const state = currentPlayer?.getState();
  const third =
    currentSceneData?.isThirdPersonView?.() ??
    ((isThirdPerson ||
      !!currentSceneData?.forceThirdPerson ||
      !!currentSceneData?.isCinematic?.() ||
      !!state?.climbing ||
      !!state?.boxHandling) &&
      !isCameraForcedFirstPerson(activeCamera));
  btn.dataset.view = third ? "3" : "1";
  btn.classList.toggle(
    "hidden",
    !!cutsceneManager ||
      !!currentSceneData?.isCinematic?.() ||
      (!!currentSceneData && !currentPlayer?.isEnabled()),
  );
  btn.disabled = !canToggleView();
  btn.title = btn.disabled
    ? "Camera controlled by this scene"
    : inputHint(`Switch to ${third ? "first" : "third"} person (V)`);
  btn.setAttribute(
    "aria-label",
    `${third ? "Third" : "First"}-person camera. ${btn.title}`,
  );
}
function toggleView() {
  if (!canToggleView()) return;
  if (currentSceneData?.toggleView) currentSceneData.toggleView();
  else isThirdPerson = !isThirdPerson;
  updateViewButton();
}

// --- Load Prologue Scene 1 (developer menu entry) ---
async function loadPrologue1(alreadyCovered = false) {
  const loading = alreadyCovered ? null : beginCinematicLoading("prologue");
  const request = sceneRequestVersion + 1;
  const module = await prepareScene(0);
  if (!module) throw new Error("The prison prologue could not be loaded");
  if (request !== sceneRequestVersion) {
    loading?.finish();
    return;
  }
  let data: ReturnType<typeof module.createScene> | undefined;
  try {
    await prepareGlobalCharacter();
    await Promise.all([
      preloadMusic(MUSIC_URLS.prologue),
      preloadMusic(MUSIC_URLS["broken-chains"]),
    ]);
    data = module.createScene({
      thirdPersonCamera: {
        distance: THIRD_PERSON_DIST,
        height: THIRD_PERSON_HEIGHT,
        right: THIRD_PERSON_RIGHT,
      },
      onPlayable: () => {
        if (activeSceneId !== "prologue1") return;
        isThirdPerson = true;
        if (globalCharacter && activeScene)
          activeScene.add(globalCharacter.model);
        globalCharacter?.setFacing(currentPlayer!.getState().yaw);
        updatePlayerView(0);
      },
      onFinished: async () => {
        if (activeSceneId !== "prologue1") return true;
        isThirdPerson = true;
        return loadLivingQuarters();
      },
    });
    await data.prepareRendering(renderer);
    await loading?.presented;
    if (request !== sceneRequestVersion) {
      data.dispose();
      loading?.finish();
      return;
    }
    stage1LoadingShown = false;
    hideScene1Skip();
    retireTraversalRoom();
    resetStoryProgress();
    activeSceneId = "prologue1";
    enterHudScene("prologue1");
    currentSceneData = data;
    music.enterScene("prologue1", data);
    activeScene = data.scene;
    activeCamera = data.camera;
    currentPlayer = data.player;
    updatePhysics = data.updatePhysics;
    cutsceneManager = null;
    if (orbitControls) {
      orbitControls.object = activeCamera;
      orbitControls.enabled = false;
    }
    if (!(await warmBehindLoading(request))) {
      loading?.finish();
      return;
    }
    loading?.finish();
  } catch (error) {
    data?.dispose();
    if (!loading) throw error;
    console.error("[Prologue] Preparation failed:", error);
    loading.fail(
      "The prologue could not be prepared. Please try again.",
      () => {
        void loadPrologue1();
      },
    );
  }
}

interface PreparedOpeningScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: Player;
  ready: Promise<unknown>;
  dispose(): void;
}

async function prepareOpeningScene(
  data: PreparedOpeningScene,
  source: unknown,
  request: number,
  presentation?: Promise<void>,
) {
  data.player.disable();
  try {
    await Promise.all([data.ready, presentation, prepareGlobalCharacter()]);
    await prepareSceneRendering(renderer, data.scene, data.camera);
  } catch (error) {
    data.dispose();
    throw error;
  }
  if (request !== sceneRequestVersion || source !== currentSceneData) {
    data.dispose();
    return false;
  }
  return true;
}

async function loadLivingQuarters(
  fromPassage = false,
  entryState?: PlayerTransitionState,
) {
  const loading = beginCinematicLoading("quarters", 1);
  try {
    const module = await prepareScene(0.5);
    if (!module) throw new Error("The living quarters module could not load");
    hideScene1Skip();
    pistol.holster();
    crowbar.holster();
    bloomstick.holster();
    pistol.update(0);
    crowbar.update(0);
    bloomstick.update(0);
    const source = currentSceneData,
      request = sceneRequestVersion;
    const sceneData = module.createScene({
      progress: quartersProgress,
      fromPassage,
      entryState,
      deferActivation: true,
      developerAccess: developerRun,
      warmRoom: async (scene, camera) => {
        await prepareSceneRendering(renderer, scene, camera);
      },
      onPistolCollected: () => {
        hasPistol = true;
        introduceControls("pistol");
      },
      onCrystalCollected: () => {
        teleportDevice.collect(false);
        introduceControls("teleport");
      },
      onGogglesCollected: () => {
        goggles.collect();
        introduceControls("goggles");
      },
      preparePassage: async () => {
        await (await sceneModule(1.1)).preloadAssets();
      },
      onExitToPassage: (state) => loadStage1Storage(true, state),
    });
    if (
      !(await prepareOpeningScene(
        sceneData,
        source,
        request,
        loading.presented,
      ))
    ) {
      loading.finish();
      return false;
    }
    retireTraversalRoom();
    currentSceneData?.dispose?.();
    hasPistol = quartersProgress.pistolCollected;
    if (quartersProgress.crystalCollected) teleportDevice.collect(false);
    if (quartersProgress.gogglesCollected) goggles.collect(false);
    enterManagedScene("living-quarters", sceneData);
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
      globalCharacter.setFacing(currentPlayer.getState().yaw);
      globalCharacter.setHologramTransition(sceneData.getHologramTransition());
    }
    if (orbitControls) {
      orbitControls.object = activeCamera;
      orbitControls.enabled = false;
    }
    updatePlayerView(0);
    if (!(await warmBehindLoading(request))) {
      loading.finish();
      return false;
    }
    loading.finish();
    return true;
  } catch (error) {
    console.error("[Living quarters] Preparation failed:", error);
    loading.fail(
      "The crew cabins could not be prepared. Please try again.",
      () => {
        void loadLivingQuarters(fromPassage, entryState);
      },
    );
    return false;
  }
}

async function loadStage1Storage(
  fromQuarters = false,
  entryState?: PlayerTransitionState,
  fromCameraRoom = false,
) {
  const loading = beginCinematicLoading("stage1", stage1LoadingShown ? 1 : 3);
  const expectedRequest = sceneRequestVersion + 1;
  const module = await prepareScene(1.1);
  if (!module) {
    if (expectedRequest !== sceneRequestVersion) loading?.finish();
    else
      loading?.fail("Stage One could not be loaded. Please try again.", () => {
        void loadStage1Storage(fromQuarters, entryState);
      });
    return false;
  }
  try {
    hideScene1Skip();
    const source = currentSceneData,
      request = sceneRequestVersion;
    await preloadMusic(MUSIC_URLS["stealth-alert"]);
    if (request !== sceneRequestVersion) {
      loading?.finish();
      return false;
    }
    const sceneData = module.createScene({
      hintsEnabled: getPrimeHintsEnabled(),
      arcadeDifficulty:
        arcade.run?.id === 1.1 ? arcade.run.difficulty : undefined,
      onArcadeComplete: () => completeArcadeStage(),
      onArcadeRetry: () => {
        const run = arcade.run;
        if (!run || run.id !== 1.1 || !run.started) return;
        sampleArcadeHealth(run);
        if (run.lastHealth !== null && run.lastHealth > 0) run.deaths++;
      },
      openingEntry: !fromQuarters && !fromCameraRoom,
      fromQuarters,
      entryState,
      restoreCheckpoint: fromCameraRoom,
      fromCameraRoom,
      deferActivation: true,
      onReturnToQuarters: (state) => loadLivingQuarters(true, state),
      onComplete: async (presentation) => {
        if (activeSceneId !== "stage1-storage") return false;
        stageTwoProgress.checkpoint = "vent";
        return loadStageTwo(
          currentPlayer?.captureTransition({ x: 0, y: 0, z: 0 }),
          presentation,
        );
      },
    });
    if (
      !(await prepareOpeningScene(
        sceneData,
        source,
        request,
        loading?.presented,
      ))
    ) {
      loading?.finish();
      return false;
    }
    retireTraversalRoom();
    currentSceneData?.dispose?.();
    enterManagedScene("stage1-storage", sceneData);
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
    if (orbitControls) {
      orbitControls.object = activeCamera;
      orbitControls.enabled = false;
    }
    updatePlayerView(0);
    if (!(await warmBehindLoading(request))) {
      loading.finish();
      return false;
    }
    stage1LoadingShown = true;
    loading?.finish();
    return true;
  } catch (error) {
    console.error("Stage One preparation failed:", error);
    if (loading)
      loading.fail("Stage One could not be prepared. Please try again.", () => {
        void loadStage1Storage(fromQuarters, entryState);
      });
    else
      document.getElementById("scene-menu-error")!.textContent =
        "Stage One could not be prepared. Please try again.";
    return false;
  }
}

function resetStoryProgress() {
  quartersProgress = createQuartersProgress();
  stageTwoProgress = createStageTwoProgress();
  hasPistol =
    hasCrowbar =
    hasBloomstick =
    bayBossDefeated =
    healthPackCollectedScene13 =
      false;
  pistol.holster();
  crowbar.holster();
  bloomstick.holster();
  goggles.reset();
  teleportDevice.reset();
  cctv.clearSources();
  shipMapProgress.reset();
  shipMap?.dispose();
  shipMap = null;
  shipMapLayout = undefined;
  mappedSceneData = null;
}

// --- Main Menu (Scene 1) ---
async function loadScene1(skipOpening = false) {
  openingReady = false;
  const startup = document.getElementById("startup-loading")!;
  startup.classList.remove("hidden");
  await openingMusicReady;
  startup.querySelector("p")!.textContent =
    "Preparing the mothership and opening camera...";
  sceneRequestVersion++;
  activeSceneId = "scene1";
  currentPlayer = null;
  enterHudScene("scene1");
  document.getElementById("quit-btn")!.textContent = "DON'T PLAY";
  const quitButton = document.getElementById("quit-btn") as HTMLButtonElement;
  quitButton.classList.remove("no-choice", "hidden");
  quitButton.disabled = false;
  const introScene = createScene1({ audioManager, renderer });
  currentSceneData = introScene;
  music.enterScene("scene1", currentSceneData);
  scene1Data = currentSceneData;
  activeScene = currentSceneData.scene;
  activeCamera =
    currentSceneData.camera ||
    new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
  updatePhysics = currentSceneData.updatePhysics;
  cutsceneManager = currentSceneData.cutsceneManager;
  lastSplinePoint = currentSceneData.lastSplinePoint;
  if (orbitControls) {
    orbitControls.object = activeCamera!;
    orbitControls.enabled = false;
  }

  if (!currentSceneData.camera) {
    activeCamera!.position.set(5, 5, 5);
    activeCamera!.lookAt(0, 0, 0);
  }

  await introScene.ready;
  if (currentSceneData !== introScene) return;
  await prepareSceneRendering(renderer, introScene.scene, introScene.camera);
  if (currentSceneData !== introScene) return;
  openingReady = true;
  startup.classList.add("hidden");

  if (skipOpening) {
    activeCamera!.position.copy(introScene.lastSplinePoint);
    activeCamera!.lookAt(0, 15, 0);
    if (orbitControls) {
      orbitControls.target.set(0, 15, 0);
      orbitControls.enabled = true;
    }
    hideScene1Skip();
    showMenuButtons();
    return;
  }

  if (cutsceneManager) {
    cutsceneManager.play("cutscene_1788121916257");
    const skipBtn = document.getElementById("skip-btn")!;
    scene1SkipVisible = true;
    skipBtn.classList.remove("hidden");

    cutsceneManager.onStateChange = (state: string) => {
      if (
        currentSceneData === introScene &&
        state === "stopped" &&
        lastSplinePoint
      ) {
        activeCamera!.position.copy(lastSplinePoint);
        orbitControls!.target.set(0, 15, 0);
        orbitControls!.enabled = true;
        scene1SkipVisible = false;
        scene1SkipHold?.dispose();
        scene1SkipHold = null;
        skipBtn.classList.add("hidden");
        showMenuButtons();
      }
    };

    scene1SkipHold?.dispose();
    scene1SkipHold = createHoldToSkip({
      button: skipBtn as HTMLButtonElement,
      isAvailable: () => scene1SkipVisible && currentSceneData === introScene,
      isPaused: () => quickMenuOpen,
      onSkip: () => {
        if (currentSceneData !== introScene) return;
        scene1SkipVisible = false;
        skipBtn.classList.add("hidden");
        if (cutsceneManager) cutsceneManager.stop();
        if (lastSplinePoint) {
          activeCamera!.position.copy(lastSplinePoint);
          orbitControls!.target.set(0, 15, 0);
          orbitControls!.enabled = true;
        }
        const creditsOverlay = document.getElementById("credits-overlay")!;
        creditsOverlay.classList.add("hidden");
        showMenuButtons();
      },
    });
  }
}

// --- Opening menu ---
let menuButtonsShown = false;

function showMenuButtons() {
  const menuButtons = document.getElementById("menu-buttons")!;
  menuButtons.classList.remove("hidden");
  showTitlePanel("title", false);
  if (isControllerActive() && !quickMenuOpen)
    focusControllerMenuItem(document.getElementById("play-btn")!);
  if (menuButtonsShown) return;
  menuButtonsShown = true;

  document.getElementById("play-btn")!.addEventListener("click", () => {
    showTitlePanel("mode");
  });
  document.getElementById("story-mode-btn")!.addEventListener("click", () => {
    arcade.active = false;
    arcade.run = null;
    storySetupPending = true;
    setPauseMenu("story-setup");
  });
  document
    .getElementById("story-setup-start")!
    .addEventListener("click", () => {
      storySetupPending = false;
      setPauseMenu(null, false);
      menuButtons.classList.add("hidden");
      void transitionToScene2();
    });
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-story-settings]",
  ))
    button.addEventListener("click", () => {
      if (button.dataset.storySettings === "controls") setPauseMenu("controls");
      else if (button.dataset.storySettings === "display")
        setPauseMenu("display");
      else if (button.dataset.storySettings === "sound") setPauseMenu("sound");
    });
  document.getElementById("arcade-mode-btn")!.addEventListener("click", () => {
    showTitlePanel("character");
  });
  document
    .getElementById("mode-back-btn")!
    .addEventListener("click", () => showTitlePanel("title"));
  document
    .getElementById("character-back-btn")!
    .addEventListener("click", () => showTitlePanel("mode"));
  document.querySelectorAll<HTMLElement>(".character-card").forEach((card) =>
    card.addEventListener("click", () => {
      const selected = card.dataset.character;
      if (!isPlayableCharacter(selected))
        throw new Error(`Unknown arcade character: ${selected}`);
      arcade.character = selected;
      arcade.active = true;
      menuButtons.classList.add("hidden");
      void startArcade();
    }),
  );
  const disclaimerButton = document.getElementById("disclaimer-btn")!;
  disclaimerButton.addEventListener("click", () => {
    const note = document.getElementById("disclaimer-text")!;
    const show = note.classList.contains("hidden");
    note.classList.toggle("hidden", !show);
    disclaimerButton.setAttribute("aria-expanded", String(show));
  });
  document.getElementById("quit-btn")!.addEventListener("click", () => {
    const quitButton = document.getElementById("quit-btn") as HTMLButtonElement;
    quitButton.textContent = "YOU DON'T HAVE A CHOICE.";
    quitButton.disabled = true;
    quitButton.classList.add("no-choice");
    if (isControllerActive())
      focusControllerMenuItem(document.getElementById("play-btn")!);
    quitButton.addEventListener(
      "animationend",
      () => {
        quitButton.classList.add("hidden");
      },
      { once: true },
    );
  });
  document
    .getElementById("options-btn")!
    .addEventListener("click", () => setPauseMenu("home"));
}

// --- Arcade mode / Brondon's Museum ---
const MUSEUM_ID = 99;
const MUSEUM_STAGE_TITLES = new Map(
  MUSEUM_EXHIBITS.map((exhibit) => [exhibit.id, exhibit.title] as const),
);
type ArcadeCharacter = PlayableCharacter;
interface ArcadeRun {
  id: number;
  difficulty: ArcadeDifficulty;
  started: boolean;
  sceneKey: string | null;
  elapsed: number;
  damage: number;
  lastHealth: number | null;
  lowestHealth: number;
  deaths: number;
  finished: boolean;
}
const arcade = {
  active: false,
  character: "brondon" as ArcadeCharacter,
  run: null as ArcadeRun | null,
  resultsOpen: false,
  briefingOpen: false,
};
let arcadeReturnTo: number | undefined;
let arcadePortraitPreparation: Promise<void> | null = null;

function prepareArcadePortraits() {
  if (arcadePortraitPreparation) return;
  const status = document.getElementById("character-select-status")!;
  status.textContent = "Loading character portraits...";
  arcadePortraitPreparation = renderArcadePortraits()
    .then((portraits) => {
      document
        .querySelectorAll<HTMLImageElement>("[data-character-portrait]")
        .forEach((image) => {
          const character = image.dataset.characterPortrait;
          if (!isPlayableCharacter(character))
            throw new Error(`Unknown portrait character: ${character}`);
          const portrait = portraits.get(character);
          if (!portrait) throw new Error(`Missing ${character} portrait`);
          image.src = portrait;
        });
      status.textContent = "";
    })
    .catch((error) => {
      arcadePortraitPreparation = null;
      console.error("[Arcade] Character portraits failed:", error);
      status.textContent =
        "Portraits could not load. Reopen character selection to retry.";
    });
}

function showTitlePanel(panel: "title" | "mode" | "character", focus = true) {
  const ids = {
    title: "title-actions",
    mode: "mode-select",
    character: "character-select",
  } as const;
  for (const [key, id] of Object.entries(ids))
    document.getElementById(id)!.classList.toggle("hidden", key !== panel);
  if (panel === "character") prepareArcadePortraits();
  if (focus && isControllerActive()) updateControllerMenuFocus();
  else if (focus)
    document
      .querySelector<HTMLElement>(
        panel === "title"
          ? "#play-btn"
          : panel === "mode"
            ? "#story-mode-btn"
            : ".character-card",
      )
      ?.focus();
}

async function startArcade() {
  if (playLoading) return;
  playLoading = true;
  const loading = beginCinematicLoading("game");
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await loading.presented;
    loading.setStatus("Lighting the braziers of Brondon's Museum...");
    await Promise.all([
      prepareGlobalCharacter(),
      prepareFirstPersonHands(),
      pistol.ready,
    ]);
    arcadeReturnTo = undefined;
    await enterSceneById(MUSEUM_ID);
    if (activeSceneId !== "museum")
      throw new Error("The museum could not be opened");
    loading.finish();
  } catch (error) {
    console.error("[Arcade] Preparation failed:", error);
    loading.fail(
      `The museum could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
      () => {
        void startArcade();
      },
    );
  } finally {
    playLoading = false;
  }
}

async function loadMuseum(returnTo?: number) {
  await prepareChapter(
    "game",
    async () => {
      const module = await prepareScene(99);
      if (!module) throw new Error("Brondon's Museum could not load");
      await preloadMusic(MUSIC_URLS["broken-chains"]);
      return {
        id: "museum",
        data: module.createScene({
          renderer,
          character: arcade.character,
          returnTo,
          onEnterStage: startArcadeStage,
          onReturnToMainMenu: () => {
            document.getElementById("main-menu-error")!.textContent = "";
            setPauseMenu("main-menu");
          },
        }),
      };
    },
    () => {
      void loadMuseum(returnTo);
    },
    false,
  );
}

async function loadFinaleArcade(match?: FinaleLocalMatch) {
  arcade.active = true;
  arcade.run = null;
  arcadeReturnTo = 21;
  await prepareChapter("finale", async () => {
    const module = await prepareScene(101);
    if (!module) throw new Error("Final boss Arcade could not load");
    return {
      id: "finaleArcade",
      data: module.createScene({
        renderer,
        match,
        onStory: () => { void startArcadeStage(21, true); },
        onMatch: (next) => { void loadFinaleArcade(next); },
        onSetup: () => { void loadFinaleArcade(); },
        onExit: () => { void returnToMuseum(); },
        onPause: () => setPauseMenu("home"),
      }),
    };
  }, () => { void loadFinaleArcade(match); });
}

async function startArcadeStage(id: number, finaleStory = false) {
  if (id === 21 && !finaleStory) {
    await loadFinaleArcade();
    return;
  }
  const difficulty = arcade.run?.id === id ? arcade.run.difficulty : "easy";
  arcade.active = true;
  stageTwoProgress = createStageTwoProgress();
  cctv.clearSources();
  arcade.run = {
    id,
    difficulty,
    started: false,
    sceneKey: null,
    elapsed: 0,
    damage: 0,
    lastHealth: null,
    lowestHealth: PLAYER_MAX_HEALTH,
    deaths: 0,
    finished: false,
  };
  await enterSceneById(id);
  // A stage that failed to load leaves nothing running, so go back to the hall.
  if (arcade.run?.id === id && arcade.run.sceneKey === null) {
    arcade.run = null;
    arcadeReturnTo = id;
    await enterSceneById(MUSEUM_ID);
    return;
  }
  showArcadeBriefing();
}

async function returnToMuseum() {
  closeArcadeBriefing();
  document.body.classList.remove("arcade-run-active");
  document.getElementById("arcade-run-clock")!.classList.add("hidden");
  const returnTo = arcade.run?.id ?? arcadeReturnTo;
  arcade.run = null;
  arcadeReturnTo = returnTo;
  await enterSceneById(MUSEUM_ID);
}

function arcadeSceneEntered(id: string) {
  document.body.classList.toggle(
    "arcade-run-active",
    arcade.active && id !== "museum" && !!arcade.run,
  );
  const run = arcade.run;
  if (!arcade.active || !run) return;
  if (run.started) sampleArcadeHealth(run);
  if (id === "museum") {
    arcade.run = null;
    return;
  }
  if (run.sceneKey === null) {
    run.sceneKey = id;
  } else if (id === run.sceneKey) {
    if (
      run.id !== 1.25 &&
      run.started &&
      (run.lastHealth === null || run.lastHealth > 0)
    )
      run.deaths++;
    run.lastHealth = null;
  } else if (
    MUSEUM_EXHIBITS.find(
      (exhibit) => exhibit.id === run.id,
    )?.sceneKeys.includes(id)
  ) {
    // A later part of the same multi-scene stage.
  } else if (!run.finished) {
    console.error(`[Arcade] Unexpected scene ${id} during challenge ${run.id}`);
    showTeleportDeviceMessage(
      "This scene is outside the Arcade challenge. Return to the Museum to restart.",
    );
  }
}

function completeArcadeStage() {
  const run = arcade.run;
  if (
    !arcade.active ||
    !run ||
    !run.started ||
    run.sceneKey === null ||
    run.finished
  )
    return;
  sampleArcadeHealth(run);
  run.finished = true;
  document.body.classList.remove("arcade-run-active");
  document.getElementById("arcade-run-clock")!.classList.add("hidden");
  showArcadeResults();
}

function sampleArcadeHealth(run: ArcadeRun) {
  if (!currentPlayer) return;
  const health = currentPlayer.getHealth();
  if (health <= 0 && (run.lastHealth === null || run.lastHealth > 0))
    run.deaths++;
  if (run.lastHealth !== null && health < run.lastHealth)
    run.damage += run.lastHealth - health;
  run.lastHealth = health;
  run.lowestHealth = Math.min(run.lowestHealth, health);
}

function trackArcadeRun(delta: number) {
  const run = arcade.run;
  if (!run || !run.started || run.sceneKey === null || run.finished) return;
  run.elapsed += delta;
  sampleArcadeHealth(run);
  const clockElement = document.getElementById("arcade-run-clock")!;
  clockElement.classList.toggle("hidden", run.id === 14);
  const objective: string | undefined =
    currentSceneData?.getArcadeObjective?.();
  clockElement.textContent = [formatArcadeTime(run.elapsed), objective]
    .filter(Boolean)
    .join("  /  ");
}

function arcadeGrade(run: ArcadeRun) {
  const challenge = arcadeChallenge(run.id);
  if (challenge.scoring === "none") return null;
  if (challenge.scoring === "time")
    return ["S", "A", "B", "C", "D"][
      Math.min(
        4,
        Math.max(0, Math.ceil(run.elapsed / challenge.targetSeconds) - 1) +
          run.deaths,
      )
    ];
  if (challenge.scoring === "time-health") {
    const health = THREE.MathUtils.clamp(
      (run.lastHealth ?? PLAYER_MAX_HEALTH) / PLAYER_MAX_HEALTH,
      0,
      1,
    );
    const speed = Math.min(
      1,
      challenge.targetSeconds / Math.max(1, run.elapsed),
    );
    const score = health * 0.6 + speed * 0.4 - run.deaths * 0.1;
    return score >= 0.95
      ? "S"
      : score >= 0.8
        ? "A"
        : score >= 0.65
          ? "B"
          : score >= 0.45
            ? "C"
            : "D";
  }
  const ratio = run.damage / PLAYER_MAX_HEALTH;
  const tier =
    ratio <= 0.05
      ? 0
      : ratio <= 0.25
        ? 1
        : ratio <= 0.5
          ? 2
          : ratio <= 0.9
            ? 3
            : 4;
  return ["S", "A", "B", "C", "D"][Math.min(4, tier + run.deaths)];
}

function showArcadeResults() {
  const run = arcade.run;
  if (!run || !run.finished || arcade.resultsOpen) return;
  arcade.resultsOpen = true;
  weaponWheel.close();
  clearSceneInput();
  if (document.pointerLockElement) document.exitPointerLock();
  quickMenuOpen = true;
  document.body.classList.add("quick-menu-open");
  setAudioMenuPaused(true);
  music.setMenuOpen(true);
  currentSceneData?.setMenuPaused?.(true);
  const stage = MUSEUM_STAGE_TITLES.get(run.id) ?? "Stage";
  const grade = arcadeGrade(run);
  const finalHealth = run.lastHealth ?? PLAYER_MAX_HEALTH;
  document.getElementById("arcade-results-title")!.textContent = stage;
  const gradeElement = document.getElementById("arcade-grade")!;
  gradeElement.classList.toggle("hidden", grade === null);
  gradeElement.textContent = grade ?? "";
  gradeElement.dataset.grade = grade ?? "";
  document
    .getElementById("arcade-download-record")!
    .classList.toggle("hidden", run.id !== 1.25);
  const rows: Array<[string, string]> =
    run.id === 14
      ? [["Result", "Escaped / ungraded"]]
      : [
          ["Time", formatArcadeTime(run.elapsed)],
          ["Damage taken", String(Math.round(run.damage))],
          [
            "Health remaining",
            `${Math.round(finalHealth)} / ${PLAYER_MAX_HEALTH}`,
          ],
          ["Lowest health", `${Math.round(run.lowestHealth)}`],
          ["Retries", String(run.deaths)],
        ];
  if (run.id === 1.1)
    rows.unshift(["Difficulty", run.difficulty.toUpperCase()]);
  if (run.id === 1.25) rows.splice(1, 0, ["Built-in cutscenes", "Skipped"]);
  document.getElementById("arcade-stats")!.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  document.getElementById("arcade-results")!.classList.remove("hidden");
  document.getElementById("arcade-play-again")!.focus();
}

function closeArcadeResults() {
  arcade.resultsOpen = false;
  document.getElementById("arcade-results")!.classList.add("hidden");
  quickMenuOpen = false;
  document.body.classList.remove("quick-menu-open");
  setAudioMenuPaused(false);
  music.setMenuOpen(false);
}

function setupArcadeResults() {
  document.getElementById("arcade-start")!.addEventListener("click", () => {
    const run = arcade.run;
    if (!run || !arcade.briefingOpen) return;
    currentSceneData?.setArcadeDifficulty?.(run.difficulty);
    run.started = true;
    sampleArcadeHealth(run);
    closeArcadeBriefing();
  });
  document
    .getElementById("arcade-briefing-return")!
    .addEventListener("click", () => {
      void returnToMuseum();
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-arcade-difficulty]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const difficulty = button.dataset.arcadeDifficulty;
        if (!arcade.run) return;
        if (
          difficulty !== "easy" &&
          difficulty !== "medium" &&
          difficulty !== "hard"
        )
          throw new Error(`Invalid Arcade difficulty: ${difficulty}`);
        arcade.run.difficulty = difficulty;
        updateArcadeDifficultyButtons();
      });
    });
  const downloadButton = document.getElementById(
    "arcade-download-record",
  ) as HTMLButtonElement;
  downloadButton.addEventListener("click", async () => {
    const run = arcade.run;
    if (!run || !run.finished || run.id !== 1.25) return;
    try {
      downloadButton.disabled = true;
      await downloadArcadeRecord({
        stage: MUSEUM_STAGE_TITLES.get(run.id)!,
        character: PLAYABLE_CHARACTER_NAMES[arcade.character],
        time: run.elapsed,
        retries: run.deaths,
      });
    } catch (error) {
      console.error("[Arcade] Record download failed:", error);
      showTeleportDeviceMessage(
        "The record image could not be downloaded. Please try again.",
      );
    } finally {
      downloadButton.disabled = false;
    }
  });
  document
    .getElementById("arcade-play-again")!
    .addEventListener("click", () => {
      const id = arcade.run?.id;
      closeArcadeResults();
      if (id !== undefined) void startArcadeStage(id);
    });
  document.getElementById("arcade-return")!.addEventListener("click", () => {
    closeArcadeResults();
    void returnToMuseum();
  });
  document
    .getElementById("pause-return-museum")!
    .addEventListener("click", () => {
      setPauseMenu(null, false);
      void returnToMuseum();
    });
}

function updateArcadeDifficultyButtons() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-arcade-difficulty]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.arcadeDifficulty === arcade.run?.difficulty),
      );
    });
}

function showArcadeBriefing() {
  const run = arcade.run;
  if (!run) return;
  const challenge = arcadeChallenge(run.id);
  document.getElementById("arcade-briefing-title")!.textContent =
    MUSEUM_STAGE_TITLES.get(run.id)!;
  document.getElementById("arcade-instructions")!.replaceChildren(
    ...challenge.instructions.map((instruction) => {
      const item = document.createElement("li");
      item.textContent = instruction;
      return item;
    }),
  );
  document
    .getElementById("arcade-difficulties")!
    .classList.toggle("hidden", run.id !== 1.1);
  document.getElementById("arcade-scoring-note")!.textContent =
    challenge.targetSeconds > 0
      ? `Speed target: ${formatArcadeTime(challenge.targetSeconds)}. Faster times score better.`
      : "";
  updateArcadeDifficultyButtons();
  arcade.briefingOpen = true;
  weaponWheel.close();
  clearSceneInput();
  if (document.pointerLockElement) document.exitPointerLock();
  quickMenuOpen = true;
  document.body.classList.add("quick-menu-open");
  setAudioMenuPaused(true);
  music.setMenuOpen(true);
  currentSceneData?.setMenuPaused?.(true);
  document.getElementById("arcade-briefing")!.classList.remove("hidden");
  document.getElementById("arcade-start")!.focus();
}

function closeArcadeBriefing() {
  if (!arcade.briefingOpen) return;
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    document.getElementById("arcade-briefing")!.contains(focused)
  )
    focused.blur();
  arcade.briefingOpen = false;
  document.getElementById("arcade-briefing")!.classList.add("hidden");
  quickMenuOpen = false;
  document.body.classList.remove("quick-menu-open");
  setAudioMenuPaused(false);
  music.setMenuOpen(false);
  currentSceneData?.setMenuPaused?.(false);
  clearSceneInput();
}

async function transitionToScene2() {
  if (playLoading) return;
  playLoading = true;
  developerRun = false;
  const loading = beginCinematicLoading("prologue");
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await prepareEntireGame(loading);
    await loading.presented;
    loading.setStatus(
      "Preparing the prison cutscene and its first-render shaders...",
    );
    await loadPrologue1(true);
    if (preparationSteps)
      loading.setProgress(preparationSteps, preparationSteps, "Ready to play");
    loading.finish();
  } catch (error) {
    console.error("[Game preload] Preparation failed:", error);
    loading.fail(
      `The game could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
      () => {
        void transitionToScene2();
      },
    );
  } finally {
    playLoading = false;
  }
}

function hideScene1Skip() {
  scene1SkipVisible = false;
  scene1SkipHold?.dispose();
  scene1SkipHold = null;
  document.getElementById("skip-btn")?.classList.add("hidden");
  document
    .querySelectorAll(".wake-skip-btn")
    .forEach((button) => button.remove());
  document.getElementById("interact-prompt")?.classList.add("hidden");
}

function enterManagedScene(id: string, sceneData: any) {
  if (developerRun) grantDeveloperEquipment();
  sceneData.setHintsEnabled?.(getPrimeHintsEnabled());
  setFreeCamera(false);
  weaponWheel.close();
  cctv.detach();
  teleportDevice.detachMarker();
  teleportArrivalTime = -1;
  if (activeScene) disposeComicEffects(activeScene);
  // The Museum and legacy combat scenes start armed; Story's opening requires recovery.
  if (
    id === "museum" ||
    (id === "stage1-storage" && !sceneData.requiresRecoveredPistol) ||
    (id.startsWith("scene") && Number(id.slice(5)) >= 2)
  )
    hasPistol = true;
  bloomstick.detach();
  globalCharacter?.model.removeFromParent();
  activeSceneId = id;
  arcadeSceneEntered(id);
  music.enterScene(id, sceneData);
  enterHudScene(id);
  const damage = document.getElementById("player-damage");
  if (damage) damage.style.opacity = "0";
}

function retireTraversalRoom() {
  soundscape.stop();
  weaponWheel.close();
  cctv.detach();
  teleportDevice.detachMarker();
  if (activeScene) disposeComicEffects(activeScene);
  // The persistent character is not scene-owned geometry.
  pistol.holster();
  crowbar.holster();
  bloomstick.holster();
  pistol.update(0);
  crowbar.update(0);
  bloomstick.update(0);
  bloomstick.detach();
  globalCharacter?.model.removeFromParent();
  currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) scene1Data = null;
}

function activateExtension(sceneData: any, id: string) {
  enterManagedScene(id, sceneData);
  currentSceneData = sceneData;
  activeScene = sceneData.scene;
  activeCamera = sceneData.camera;
  updatePhysics = sceneData.updatePhysics;
  cutsceneManager = null;
  currentPlayer = sceneData.player;
  if (globalCharacter) activeScene!.add(globalCharacter.model);
  if (orbitControls) {
    orbitControls.object = activeCamera!;
    orbitControls.enabled = false;
  }
  globalCharacter?.setFacing(currentPlayer!.getState().yaw);
  updatePlayerView(0);
}

async function loadStageTwo(
  entryState?: PlayerTransitionState,
  presentation?: Promise<void>,
  fromAirlock = false,
) {
  const loading = beginCinematicLoading(
    stageTwoProgress.checkpoint === "vent" ? "vents" : "stage2",
    0,
  );
  try {
    const expectedRequest = sceneRequestVersion + 1;
    const [module] = await Promise.all([
      prepareScene(1.2),
      preloadMusic(MUSIC_URLS["stealth-alert"]),
      preloadMusic(MUSIC_URLS.tension),
    ]);
    if (!module || expectedRequest !== sceneRequestVersion) return false;
    const source = currentSceneData,
      request = sceneRequestVersion;
    const sceneData = module.createScene({
      progress: stageTwoProgress,
      developerAccess: developerRun && arcade.run?.id !== 1.25,
      skipCinematics: arcade.run?.id === 1.25,
      onArcadeComplete:
        arcade.run?.id === 1.25 ? completeArcadeStage : undefined,
      entryState,
      deferActivation: true,
      fromAirlock,
      getCameraTarget: () =>
        activeCamera ? cctv.getTarget(activeCamera) : null,
      holsterWeapons: () => {
        pistol.holster();
        crowbar.holster();
        bloomstick.holster();
      },
      onCrowbarCollected: () => {
        hasCrowbar = true;
        introduceControls("crowbar");
      },
      onRetryFeed: (id) => cctv.retryFeed(id),
      onCameraTeleport: (id, state) => loadCameraVisit(id, state),
      onVentDrop: prepareSurveillanceHub,
      prepareBay13: async () => {
        await (await sceneModule(13)).preloadAssets();
      },
      onExitToBay13: (state) => loadBay13(state, true),
      onAirlockReturn: (state) => loadStage1Storage(false, state, true),
    });
    if (
      !(await prepareOpeningScene(
        sceneData,
        source,
        request,
        Promise.all([loading.presented, presentation]).then(() => {}),
      ))
    )
      return false;
    hideScene1Skip();
    retireTraversalRoom();
    isThirdPerson = true;
    activateExtension(sceneData, "stage2-infiltration");
    sceneData.activate();
    if (stageTwoProgress.crowbarCollected) hasCrowbar = true;
    shipMapProgress.reveal(sceneData.getMapLayout());
    if (stageTwoProgress.checkpoint === "surveillance") revealCameraRooms();
    updatePlayerView(0);
    return true;
  } finally {
    loading.finish();
  }
}

function revealCameraRooms() {
  for (const id of [5, 6, 37, 38, 39, 40] as const)
    shipMapProgress.reveal(cameraVisitMap(id));
}

async function prepareSurveillanceHub() {
  const source = currentSceneData,
    request = sceneRequestVersion;
  const loading = beginCinematicLoading("stage2");
  try {
    await Promise.all([loading.presented, cctv.prepareFeeds()]);
    if (
      source !== currentSceneData ||
      request !== sceneRequestVersion ||
      !activeScene ||
      !activeCamera
    )
      throw new Error("Camera room preparation was interrupted");
    revealCameraRooms();
    cctv.update(1 / 8, activeScene, true);
    await renderer.compileAsync(activeScene, activeCamera);
    if (!(await warmBehindLoading(request, 2)))
      throw new Error("Camera room activation was interrupted");
  } finally {
    loading.finish();
  }
}

async function restartSurveillance() {
  if (returnTeleportPending) return false;
  returnTeleportPending = true;
  const state = currentPlayer?.captureTransition({ x: 0, y: 0, z: 0 });
  stageTwoProgress.checkpoint = "surveillance";
  if (state && (state.health ?? PLAYER_MAX_HEALTH) <= 0)
    state.health = PLAYER_MAX_HEALTH;
  const source = currentSceneData;
  try {
    if (
      currentPlayer &&
      currentPlayer.getHealth() > 0 &&
      arcade.run?.id !== 1.25
    ) {
      teleportDepartureTime = 0;
      teleportArrivalColor = 0x58ff9a;
      currentPlayer.setInputLocked(true);
      await new Promise<void>((resolve) =>
        scheduleSceneAction(resolve, RETURN_TELEPORT_SECONDS * 1000),
      );
      if (source !== currentSceneData) return false;
    }
    const loaded = await loadStageTwo(state);
    if (loaded) {
      currentSceneData?.returnToAnchor?.();
      teleportArrivalTime = arcade.run?.id === 1.25 ? -1 : 0;
      teleportArrivalColor = 0x58ff9a;
    }
    return loaded;
  } finally {
    teleportDepartureTime = -1;
    returnTeleportPending = false;
  }
}

function returnToSurveillanceAnchor() {
  if (
    activeSceneId !== "stage2-infiltration" ||
    teleportLoading ||
    returnTeleportPending ||
    !currentPlayer ||
    currentPlayer.getHealth() <= 0 ||
    currentSceneData?.isCinematic?.() ||
    currentSceneData?.getStageState?.().phase !== "surveillance"
  )
    return false;
  const source = currentSceneData;
  if (arcade.run?.id === 1.25) {
    if (!source.returnToAnchor()) {
      console.warn("[Teleport] Surveillance return anchor is unavailable");
      showTeleportDeviceMessage(
        "The surveillance anchor is unavailable right now.",
      );
      return false;
    }
    return true;
  }
  returnTeleportPending = true;
  teleportDepartureTime = 0;
  teleportArrivalColor = 0x58ff9a;
  currentPlayer.setInputLocked(true);
  scheduleSceneAction(() => {
    teleportDepartureTime = -1;
    returnTeleportPending = false;
    if (currentSceneData !== source) return;
    currentPlayer?.setInputLocked(false);
    if (!source.returnToAnchor()) {
      console.warn("[Teleport] Surveillance return anchor is unavailable");
      showTeleportDeviceMessage(
        "The surveillance anchor is unavailable right now.",
      );
      return;
    }
    teleportArrivalTime = 0;
    teleportArrivalColor = 0x58ff9a;
  }, RETURN_TELEPORT_SECONDS * 1000);
  return true;
}

async function loadCameraVisit(
  id: CameraRoomId,
  entryState?: PlayerTransitionState,
  developerVisit = false,
) {
  const loading = beginCinematicLoading(CAMERA_LOADING_CHAPTERS[id], 0);
  try {
    void preloadMusic(MUSIC_URLS["stealth-2"]).catch((error) =>
      console.warn("[Audio] Minigame music preparation failed:", error),
    );
    const source = currentSceneData;
    let sceneData;
    if (id === "scene5") {
      const module = await prepareScene(5);
      if (!module || source !== currentSceneData) return false;
      sceneData = module.createScene({
        remoteVisit: true,
        deferActivation: true,
        entryState,
        loot: stageTwoProgress.remoteRooms.scene5,
        hasReturnMarker: surveillanceMarkerPlaced,
        onRestart: restartSurveillance,
        onKeycardCollected: () => {
          collectStageTwoKeycard(stageTwoProgress, "scene5");
        },
      });
    } else if (id === "scene6") {
      const module = await prepareScene(6);
      if (!module || source !== currentSceneData) return false;
      sceneData = module.createScene({
        remoteVisit: true,
        skipCinematics: arcade.run?.id === 1.25,
        deferActivation: true,
        entryState,
        loot: stageTwoProgress.remoteRooms.scene6,
        hasReturnMarker: surveillanceMarkerPlaced,
        onRestart: restartSurveillance,
        onKeycardCollected: () => {
          collectStageTwoKeycard(stageTwoProgress, "scene6");
        },
      });
    } else if (id === "stage2-rust") {
      const module = await prepareScene(1.4);
      if (!module || source !== currentSceneData) return false;
      sceneData = module.createScene({
        deferActivation: true,
        skipCinematics: arcade.run?.id === 1.25,
        entryState,
        loot: stageTwoProgress.remoteRooms["stage2-rust"],
        hasReturnMarker: surveillanceMarkerPlaced,
        onRestart: restartSurveillance,
        onKeycardCollected: () => {
          collectStageTwoKeycard(stageTwoProgress, "stage2-rust");
        },
      });
    } else if (id === "stage2-reactor") {
      const module = await prepareScene(1.5);
      if (!module || source !== currentSceneData) return false;
      sceneData = module.createScene({
        deferActivation: true,
        entryState,
        loot: stageTwoProgress.remoteRooms["stage2-reactor"],
        hasReturnMarker: surveillanceMarkerPlaced,
        onRestart: restartSurveillance,
        onKeycardCollected: () => {
          collectStageTwoKeycard(stageTwoProgress, "stage2-reactor");
        },
      });
    } else if (id === "stage2-rust2") {
      const module = await prepareScene(1.45);
      if (!module || source !== currentSceneData) return false;
      sceneData = module.createScene({
        deferActivation: true,
        skipCinematics: arcade.run?.id === 1.25,
        entryState,
        loot: stageTwoProgress.remoteRooms["stage2-rust2"],
        hasReturnMarker: surveillanceMarkerPlaced,
        onRestart: restartSurveillance,
        onKeycardCollected: () => {
          collectStageTwoKeycard(stageTwoProgress, "stage2-rust2");
        },
      });
    } else {
      const module = await prepareScene(1.3);
      if (!module || source !== currentSceneData) return false;
      sceneData = module.createScene({
        progress: stageTwoProgress,
        deferActivation: true,
        entryState,
        hasReturnMarker: surveillanceMarkerPlaced,
        onRestart: restartSurveillance,
        onBloomstickCollected: () => {
          hasBloomstick = true;
          introduceControls("bloomstick");
        },
        onKeycardCollected: () => {
          collectStageTwoKeycard(stageTwoProgress, "stage2-armory");
        },
      });
    }
    const request = sceneRequestVersion;
    if (
      !(await prepareOpeningScene(
        sceneData,
        source,
        request,
        loading.presented,
      ))
    )
      return false;
    retireTraversalRoom();
    activateExtension(sceneData, id);
    sceneData.activate();
    if (developerVisit) {
      stageTwoProgress.checkpoint = "surveillance";
      stageTwoProgress.guardDown = true;
    }
    shipMapProgress.reveal(sceneData.getMapLayout());
    teleportArrivalTime = arcade.run?.id === 1.25 ? -1 : 0;
    teleportArrivalColor = 0x58ff9a;
    globalCharacter?.setHologramTransition(
      arcade.run?.id === 1.25
        ? null
        : hologramTransitionAt(
            0,
            true,
            TELEPORT_TRANSFER_DURATION,
            teleportArrivalColor,
          ),
    );
    updatePlayerView(0);
    return true;
  } finally {
    loading.finish();
  }
}

async function loadBay13(
  entryState?: PlayerTransitionState,
  fromServiceLift = false,
  checkpoint = false,
  startAtPhaseFour = false,
) {
  // The service-lift ride ends on black; the boss stage loads behind its own chapter screen.
  const loading = beginCinematicLoading("boss", checkpoint ? 0.5 : 1);
  try {
    const module = await prepareScene(13);
    if (!module) {
      loading?.finish();
      return false;
    }
    const source = currentSceneData,
      request = sceneRequestVersion;
    const sceneData = module.createScene({
      entryState,
      fromServiceLift,
      checkpoint,
      startAtPhaseFour,
      defeated: bayBossDefeated,
      renderer,
      healthPackCollected: healthPackCollectedScene13,
      onHealthPackCollected: () => {
        healthPackCollectedScene13 = true;
      },
      onDefeated: () => {
        bayBossDefeated = true;
      },
      onFinisherComplete:
        arcade.run?.id === 13 ? completeArcadeStage : undefined,
      onRespawn: (phaseFour = false) => {
        void loadBay13(undefined, false, true, phaseFour).catch((error) =>
          console.error("Bay 13 checkpoint restart failed:", error),
        );
      },
      onDescend: (state) => {
        void loadHangar14(state);
      },
    });
    const enabled = sceneData.player.isEnabled();
    if (
      !(await prepareOpeningScene(
        sceneData,
        source,
        request,
        loading?.presented,
      ))
    ) {
      loading?.finish();
      return false;
    }
    hideScene1Skip();
    retireTraversalRoom();
    activateExtension(sceneData, "scene13");
    if (enabled) sceneData.player.enable();
    if (loading) await warmBehindLoading(request);
    loading?.finish();
    return true;
  } catch (error) {
    loading?.finish();
    throw error;
  }
}

async function loadHangar14(
  entryState?: PlayerTransitionState,
  checkpoint = false,
) {
  await prepareChapter(
    "escape",
    async () => {
      const module = await prepareScene(14);
      if (!module) throw new Error("The hangar escape module could not load");
      bayBossDefeated = true;
      return {
        id: "scene14",
        data: module.createScene({
          entryState,
          checkpoint,
          onFailure: () => {
            const restored = entryState
              ? {
                  ...entryState,
                  health: PLAYER_MAX_HEALTH,
                  heldKeys: [],
                  blockedKeys: [],
                }
              : undefined;
            void loadHangar14(restored, true).catch((error) =>
              console.error("Hangar checkpoint restart failed:", error),
            );
          },
          onLaunch: (state) => {
            if (arcade.run?.id === 14) {
              completeArcadeStage();
              return;
            }
            void loadFlight15(state).catch((error) => {
              console.error("Flight launch transition failed:", error);
              showTeleportDeviceMessage(
                "The flight chapter could not be loaded. Use the developer scene menu to retry.",
              );
            });
          },
        }),
      };
    },
    () => {
      void loadHangar14(entryState, checkpoint);
    },
  );
}

interface ChapterScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ready?: Promise<unknown>;
  gunReady?: Promise<unknown>;
  prepareRendering?(renderer: THREE.WebGLRenderer): Promise<void>;
  dispose(): void;
}
async function prepareChapter(
  destination: LoadingDestination,
  create: () => Promise<{ id: string; data: ChapterScene }>,
  retry: () => void,
  showLoading = true,
) {
  const loading = showLoading ? beginCinematicLoading(destination, 1) : null;
  let chapter: { id: string; data: ChapterScene } | undefined;
  try {
    await loading?.presented;
    chapter = await create();
    const request = sceneRequestVersion;
    await Promise.all([
      chapter.data.ready,
      chapter.data.gunReady,
      prepareGlobalCharacter(),
    ]);
    await chapter.data.prepareRendering?.(renderer);
    await prepareSceneRendering(
      renderer,
      chapter.data.scene,
      chapter.data.camera,
    );
    if (request !== sceneRequestVersion) {
      chapter.data.dispose();
      loading?.finish();
      return;
    }
    hideScene1Skip();
    retireTraversalRoom();
    setTouchFlightMode(chapter.id === "scene15");
    activateExtension(chapter.data, chapter.id);
    if (loading && !(await warmBehindLoading(request))) {
      loading.finish();
      return;
    }
    loading?.finish();
  } catch (error) {
    chapter?.data.dispose();
    if (!loading) throw error;
    console.error("[Chapter] Preparation failed:", destination, error);
    loading.fail(
      "This chapter could not be prepared. Please try again.",
      retry,
    );
  }
}

async function loadFlight15(
  entryState?: LaunchState,
  startAt?: FlightStartPhase,
  developerVisit = false,
) {
  const destination =
    startAt === "scrambler"
      ? "scrambler"
      : startAt === "bossArmor"
        ? "armor"
        : startAt === "topdownScrambler"
          ? "red-scrambler"
          : startAt === "bossCore"
            ? "reactor"
            : "flight";
  await prepareChapter(
    destination,
    async () => {
      const module = await prepareScene(15);
      if (!module) throw new Error("The flight chapter module could not load");
      await preloadMusic(
        startAt === "bossCore"
          ? MUSIC_URLS["level-2-boss"]
          : MUSIC_URLS["level-2"],
      );
      return {
        id: "scene15",
        data: module.createScene({
          entryState,
          startAt,
          renderer,
          onTransition: (state) => {
            if (arcade.run?.id === 15) completeArcadeStage();
            else void loadCrash16(state);
          },
        }),
      };
    },
    () => {
      void loadFlight15(entryState, startAt, developerVisit);
    },
    developerVisit,
  );
}

async function loadCrash16(entryState?: FlightExitState) {
  await prepareChapter(
    "crash",
    async () => {
      const module = await prepareScene(16);
      if (!module) throw new Error("The crash landing module could not load");
      return {
        id: "scene16",
        data: module.createScene({
          entryState,
          renderer,
          onFinished: (arrival) => {
            void loadGround17(arrival);
          },
        }),
      };
    },
    () => {
      void loadCrash16(entryState);
    },
  );
}

async function loadGround17(entryState?: RescueArrival, fromFacility = false) {
  await prepareChapter(
    "jungle",
    async () => {
      const module = await prepareScene(17);
      if (!module) throw new Error("The jungle module could not load");
      await preloadMusic(MUSIC_URLS.planet);
      return {
        id: "scene17",
        data: module.createScene({
          entryState,
          fromFacility,
          arcadeMode: arcade.run?.id === 17,
          onArcadeComplete:
            arcade.run?.id === 17 ? completeArcadeStage : undefined,
          onFinished: loadFacility20,
          onRespawn: (state) => loadGround17(checkpointArrival(state)),
        }),
      };
    },
    () => {
      void loadGround17(entryState, fromFacility);
    },
  );
}

function checkpointArrival(entryState?: RescueArrival): RescueArrival {
  return {
    ...entryState,
    cameraPosition: undefined,
    cameraQuaternion: undefined,
    cameraFov: undefined,
    pilotState: entryState?.pilotState
      ? { ...entryState.pilotState, health: PLAYER_MAX_HEALTH }
      : undefined,
  };
}

async function loadFacility20(entryState?: RescueArrival) {
  const fromExterior = activeSceneId === "scene17" && !!entryState?.pilotState;
  await prepareChapter(
    "facility",
    async () => {
      const module = await prepareScene(20);
      if (!module) throw new Error("The facility module could not load");
      await preloadMusic(MUSIC_URLS["stealth-2"]);
      return {
        id: "scene20",
        data: module.createScene({
          entryState,
          fromExterior,
          onReturn: (next) => {
            void loadGround17(next, true);
          },
          onRespawn: () => loadFacility20(checkpointArrival(entryState)),
          onFinished: (next) => {
            void loadScene21(next);
          },
        }),
      };
    },
    () => {
      void loadFacility20(entryState);
    },
  );
}

async function loadScene21(
  entryState?: RescueArrival,
  checkpoint?: FinaleCheckpoint,
) {
  const loading = beginCinematicLoading("finale", 0);
  let completed = 0;
  const prepared = (label: string) =>
    loading.setProgress(++completed, 8, label);
  loading.setProgress(0, 8, "Preparing the final chapter");
  loading.setNote(
    "Preparing the rooftop and cinematic. Reusing cached assets where available.",
  );
  const expectedRequest = sceneRequestVersion + 1;
  const module = await prepareScene(21);
  if (!module) {
    if (expectedRequest !== sceneRequestVersion) loading?.finish();
    else
      loading?.fail(
        "The final chapter could not be loaded. Please try again.",
        () => {
          void loadScene21(entryState, checkpoint);
        },
      );
    return;
  }
  const request = sceneRequestVersion;
  let sceneData: ReturnType<typeof module.createScene> | undefined;
  try {
    prepared("Chapter code ready");
    sceneData = module.createScene({
      entryState,
      checkpoint,
      renderer,
      onFinished: () => {
        // Arcade Story Replay includes the complete credits and ending before results.
        if (arcade.active && arcade.run?.id === 21) {
          queueMicrotask(() => {
            if (currentSceneData === sceneData) completeArcadeStage();
          });
          return;
        }
        if (!developerRun) {
          campaignCompleted = true;
          try {
            window.localStorage.setItem(COMPLETION_KEY, "1");
          } catch (error) {
            console.warn(
              "[Progress] Completion unlocked for this session, but could not be saved:",
              error,
            );
          }
        }
        queueMicrotask(() => {
          if (currentSceneData !== sceneData) return;
          void enterSceneById(1).catch((error) => {
            console.error(
              "[Credits] Unable to return to the Main Menu:",
              error,
            );
            document.getElementById("main-menu-error")!.textContent =
              "Unable to load the Main Menu. Please try again.";
            setPauseMenu("main-menu", false);
          });
        });
      },
      onRetry: (next) => {
        void loadScene21(entryState, next);
      },
    });
    prepared("Rooftop constructed");
    if (loading) {
      sceneData.setMenuPaused(true);
      await Promise.all([
        sceneData.ready.then(() => prepared("Characters and combat ready")),
        loading.presented.then(() => prepared("Loading artwork ready")),
        // Later cues are requested first so the opening cue survives a tight decoded-music budget.
        Promise.all([
          preloadMusic(MUSIC_URLS["final-battle"]),
          preloadMusic(MUSIC_URLS.ship),
          preloadMusic(MUSIC_URLS.loading),
        ]).then(() => prepared("Soundtrack ready")),
        prepareGlobalCharacter().then(() => prepared("Player ready")),
      ]);
      if (request !== sceneRequestVersion) {
        sceneData.dispose();
        loading.finish();
        return;
      }
    }
    hideScene1Skip();
    retireTraversalRoom();
    setTouchFlightMode(false);
    activateExtension(sceneData, "scene21");
    if (loading) {
      sceneData.setMenuPaused(false);
      sceneData.updatePhysics(0);
      await sceneData.prepareRendering(renderer);
      prepared("Rendering ready");
      if (
        !(await warmBehindLoading(request, 1, {
          renderingReady: true,
          freezeStory: true,
        }))
      ) {
        loading.finish();
        return;
      }
      prepared("Ready");
    }
    sceneData.setMenuPaused(quickMenuOpen);
    loading?.finish();
  } catch (error) {
    sceneData?.dispose();
    console.error("Final chapter preparation failed:", error);
    if (loading)
      loading.fail(
        "The final chapter could not be prepared. Please try again.",
        () => {
          void loadScene21(entryState, checkpoint);
        },
      );
    else
      document.getElementById("scene-menu-error")!.textContent =
        "The final chapter could not be prepared. Please try again.";
  }
}

async function loadChairTrailer() {
  const loading = beginCinematicLoading("trailer", 0);
  loading.setProgress(0, 4, "Preparing the trailer");
  const module = await prepareScene(100);
  if (!module) {
    loading.fail("The trailer could not be loaded.", () => {
      void loadChairTrailer();
    });
    return;
  }
  const request = sceneRequestVersion;
  let data: ReturnType<typeof module.createScene> | undefined;
  try {
    data = module.createScene({
      onFinished: () => {
        setPauseMenu("home", false);
        setPauseMenu("scenes", false);
      },
    });
    loading.setProgress(1, 4, "Trailer code ready");
    data.setMenuPaused(true);
    await Promise.all([
      data.ready,
      loading.presented,
      preloadMusic(MUSIC_URLS.loading),
    ]);
    loading.setProgress(2, 4, "Five chairs ready");
    if (request !== sceneRequestVersion) {
      data.dispose();
      loading.finish();
      return;
    }
    hideScene1Skip();
    retireTraversalRoom();
    setTouchFlightMode(false);
    activateExtension(data, "trailer");
    globalCharacter?.model.removeFromParent();
    data.setMenuPaused(false);
    data.updatePhysics(0);
    await prepareSceneRendering(renderer, data.scene, data.camera, {
      fogVariants: false,
    });
    loading.setProgress(3, 4, "Rendering ready");
    if (
      !(await warmBehindLoading(request, 1, {
        renderingReady: true,
        freezeStory: true,
      }))
    ) {
      loading.finish();
      return;
    }
    loading.setProgress(4, 4, "Ready");
    loading.finish();
  } catch (error) {
    data?.dispose();
    console.error("[Trailer] Preparation failed:", error);
    loading.fail("The trailer could not be prepared. Please try again.", () => {
      void loadChairTrailer();
    });
  }
}

function updatePlayerView(dt: number) {
  if (!currentPlayer || !activeCamera) return;
  if (deathPresentation?.player === currentPlayer) {
    resetThirdPersonCamera(activeCamera);
    const { elapsed, position, rotation, fov } = deathPresentation;
    pistol.update(dt);
    crowbar.update(dt);
    globalCharacter?.weapon.setEquipped(false);
    globalCharacter?.setCrowbarEquipped(false);
    globalCharacter?.setBloomstickEquipped(false);
    globalCharacter?.update(
      dt,
      currentPlayer.body.position,
      currentPlayer.getState(),
      true,
      currentPlayer.radius,
      { clip: "Death01", time: elapsed },
    );
    const yaw = currentPlayer.getState().yaw,
      focus = new THREE.Vector3().copy(currentPlayer.body.position);
    focus.y += 0.55;
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const target = focus
      .clone()
      .addScaledVector(back, 6.5)
      .add(new THREE.Vector3(1.2, 2.8, 0));
    const reveal = THREE.MathUtils.smootherstep(elapsed, 0, 1.5);
    activeCamera.position.lerpVectors(position, target, reveal);
    const view = activeCamera.clone();
    view.position.copy(target);
    view.lookAt(focus);
    activeCamera.quaternion.slerpQuaternions(rotation, view.quaternion, reveal);
    activeCamera.fov = THREE.MathUtils.lerp(fov, 78, reveal);
    activeCamera.updateProjectionMatrix();
    return;
  }
  const cinematicState = currentSceneData?.getCinematicState?.();
  if (cinematicState) {
    resetThirdPersonCamera(activeCamera);
    // Remove ordinary weapon presentation before the scene applies its scripted props.
    pistol.update(dt);
    crowbar.update(dt);
    globalCharacter?.weapon.setEquipped(
      !!currentSceneData.ownsWeaponInput &&
        currentSceneData.getCinematicWeapon?.() === "pistol",
    );
    globalCharacter?.setCrowbarEquipped(
      currentSceneData.getCinematicWeapon?.() === "crowbar",
    );
    globalCharacter?.setBloomstickEquipped(
      currentSceneData.getCinematicWeapon?.() === "bloomstick",
    );
    if (globalCharacter) {
      if (currentSceneData.hideCharacter?.())
        globalCharacter.model.visible = false;
      else
        globalCharacter.update(
          currentSceneData.getCinematicDelta?.() ?? dt,
          currentPlayer.body.position,
          cinematicState,
          true,
          currentPlayer.radius,
          currentSceneData.getCinematicPose?.(),
        );
    }
    currentSceneData.updateCinematicCharacter?.(globalCharacter);
    currentSceneData.applyCinematicCamera?.();
    return;
  }
  if (!currentPlayer.isEnabled()) {
    resetThirdPersonCamera(activeCamera);
    return;
  }
  // Always start from the base camera, including the first render after a scene swap.
  const state = currentPlayer.getState();
  const traversalView =
    isThirdPerson ||
    !!currentSceneData?.forceThirdPerson ||
    state.climbing ||
    state.boxHandling;
  const sceneWeapon = !!currentSceneData?.ownsWeaponInput;
  if (sceneWeapon) {
    pistol.update(0);
    crowbar.update(0);
    globalCharacter?.weapon.setEquipped(
      currentSceneData.getCinematicWeapon?.() === "pistol",
    );
    globalCharacter?.setCrowbarEquipped(
      currentSceneData.getCinematicWeapon?.() === "crowbar",
    );
    globalCharacter?.setBloomstickEquipped(
      currentSceneData.getCinematicWeapon?.() === "bloomstick",
    );
  }
  currentPlayer.updateCamera(0, traversalView);
  const followView = traversalView && !state.ventMode && !state.climbing;
  const thirdPersonView = followView
    ? applyThirdPersonCamera(activeCamera, currentPlayer, dt, {
        distance: THIRD_PERSON_DIST,
        height: THIRD_PERSON_HEIGHT,
        right: THIRD_PERSON_RIGHT,
      })
    : traversalView;
  if (!followView) resetThirdPersonCamera(activeCamera);
  globalCharacter?.update(
    sceneWeapon ? (currentSceneData.getCinematicDelta?.() ?? dt) : dt,
    currentPlayer.body.position,
    state,
    thirdPersonView,
    currentPlayer.radius,
  );
  if (sceneWeapon) currentSceneData.updateCinematicCharacter?.(globalCharacter);
  currentSceneData?.updateCharacterAppearance?.(globalCharacter);
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
  // Phase 4 near-miss punch: runs right after the entry/return camera blend.
  currentSceneData?.applyNearMissCamera?.();
  currentSceneData?.applyCameraEffects?.();
}

// --- Direct scene selection ---
const quickMenu = document.getElementById(
  "scene-quick-menu",
) as HTMLDialogElement;
const pauseMenu = document.getElementById("pause-menu") as HTMLDialogElement;
const creditsDialog = document.getElementById(
  "credits-dialog",
) as HTMLDialogElement;
type MenuScreen =
  | "home"
  | "story-setup"
  | "main-menu"
  | "map"
  | "sound"
  | "display"
  | "controls"
  | "developer"
  | "scenes"
  | "credits";
let menuScreen: MenuScreen | null = null;
let creditsReturnScreen: Exclude<MenuScreen, "credits"> | null = null;
let creditsReturnFocus: HTMLElement | null = null;
let shipMap: ReturnType<typeof createShipMap> | null = null;
let shipMapLayout: ShipMapLayout | undefined;
let controlsReturnScreen: "home" | "scenes" | "story-setup" = "home";
let storySetupPending = false;
let controlsTab: InputMode = "keyboard";
let lastControllerStatus: ControllerStatus | null = null;
// Memory only: survives menus and scene changes, but resets on browser refresh.
let developerUnlocked = false;
let resumePointerTarget: HTMLElement | null = null;
let controllerFocusedItem: HTMLElement | null = null;

function controllerMenuRoot(): HTMLElement | null {
  if (creditsDialog.open) return creditsDialog;
  if (arcade.briefingOpen) return document.getElementById("arcade-briefing");
  if (arcade.resultsOpen) return document.getElementById("arcade-results");
  if (cinematicLoading.active) return cinematicLoading.menuRoot;
  if (quickMenuOpen) return menuScreen === "scenes" ? quickMenu : pauseMenu;
  const sceneMenu = currentSceneData?.getSceneMenuRoot?.();
  if (sceneMenu instanceof HTMLElement) return sceneMenu;
  const title = document.getElementById("menu-buttons")!;
  return !title.classList.contains("hidden") ? title : null;
}
function focusControllerMenuItem(element: HTMLElement) {
  controllerFocusedItem?.classList.remove("controller-focused");
  controllerFocusedItem = element;
  element.classList.add("controller-focused");
  element.focus({ preventScroll: true });
  const rect = element.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight)
    element.scrollIntoView({ block: "nearest", behavior: "instant" });
}
function updateControllerMenuFocus() {
  const root = isControllerActive() ? controllerMenuRoot() : null;
  if (!root) {
    controllerFocusedItem?.classList.remove("controller-focused");
    controllerFocusedItem = null;
    return;
  }
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    root.contains(focused) &&
    focused.getClientRects().length &&
    !focused.matches(":disabled") &&
    focused.matches("button, input, select, [tabindex]")
  ) {
    if (focused !== controllerFocusedItem) focusControllerMenuItem(focused);
    return;
  }
  const first = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ),
  ).find(
    (element) => element.getClientRects().length > 0 && element.tabIndex >= 0,
  );
  if (first) focusControllerMenuItem(first);
}

function canViewShipMap() {
  if (
    !currentSceneData ||
    activeSceneId === "scene1" ||
    activeSceneId === "prologue1"
  )
    return false;
  const id =
    currentSceneData.getMapSceneId?.() ??
    currentSceneData.getSceneId?.() ??
    activeSceneId;
  return (
    !!currentSceneData.getMapLayout?.() ||
    SHIP_MAP_LAYOUT.rooms.some((room) => id === `scene${room.id}`)
  );
}

function chartCurrentMapSection() {
  const layout: ShipMapLayout | undefined = currentSceneData?.getMapLayout?.();
  try {
    if (layout) shipMapProgress.reveal(layout);
    else {
      const id = Number(
        (currentSceneData?.getSceneId?.() ?? activeSceneId).replace(
          "scene",
          "",
        ),
      );
      if (SHIP_MAP_LAYOUT.rooms.some((room) => room.id === id))
        shipMapProgress.reveal(SHIP_MAP_LAYOUT);
    }
  } catch (error) {
    // A room charted by an earlier blueprint section is already on the map.
    if (!(
      error instanceof Error &&
      error.message.startsWith("Duplicate charted room")
    ))
      throw error;
  }
}

function clearSceneInput() {
  unarmedCombat.reset();
  controllerInput?.reset(weaponWheelOpen);
  resetTouchInput();
  currentPlayer?.clearInput();
  currentSceneData?.clearInput?.();
}
function syncControlsScrollHint() {
  if (menuScreen !== "controls") return;
  const list = document.getElementById("pause-controls-list");
  const hint = document.getElementById("controls-scroll-hint");
  if (!list || !hint || !list.clientHeight) return;
  const scrollable = list.scrollHeight > list.clientHeight + 1;
  hint.classList.toggle("hidden", !scrollable);
  const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
  hint.dataset.atEnd = String(atEnd);
  const text = hint.querySelector("span");
  if (text)
    text.textContent = atEnd
      ? "Earlier controls"
      : "More controls";
}
function renderControlsReference() {
  const devices = lastControllerStatus?.controllers ?? [];
  const entries = getControlsReference(devices)
    .filter(
      (device) => (device.id === "keyboard") === (controlsTab === "keyboard"),
    )
    .map((device) => {
      const section = document.createElement("section");
      section.className = "pause-control-device";
      section.dataset.deviceId = device.id;
      const heading = document.createElement("h2");
      heading.id = `pause-control-${device.id}`;
      heading.textContent = device.title;
      section.setAttribute("aria-labelledby", heading.id);
      section.appendChild(heading);
      const connection = document.createElement("p");
      connection.className = "control-device-connection";
      connection.textContent = `${device.name}${device.active ? " · Active input" : ""}${device.ready ? "" : " · Calibrate before playing"}`;
      section.appendChild(connection);
      for (const group of device.groups) {
        const entry = document.createElement("section");
        entry.className = "pause-control-entry";
        const title = document.createElement("h3");
        title.textContent = group.title;
        const rows = document.createElement("dl");
        rows.className = "control-bindings";
        for (const row of group.rows) {
          const action = document.createElement("dt");
          action.textContent = row.action;
          const binding = document.createElement("dd");
          if (device.controllerType && row.controllerBinding !== null)
            renderControllerBinding(
              binding,
              row.controllerBinding,
              device.controllerType,
              device.swapAB,
            );
          else binding.textContent = row.binding;
          rows.append(action, binding);
        }
        entry.append(title, rows);
        section.appendChild(entry);
      }
      return section;
    });
  const list = document.getElementById("pause-controls-list")!;
  const scrollTop = list.scrollTop;
  list.replaceChildren(...entries);
  list.scrollTop = scrollTop;
  requestAnimationFrame(syncControlsScrollHint);
}
function renderControllerStatus(status: ControllerStatus) {
  lastControllerStatus = status;
  document.body.classList.toggle(
    "controller-mode",
    status.mode === "controller",
  );
  document.body.dataset.inputMode = status.mode;
  document.body.dataset.controllerType = status.type ?? "";
  const keyboard = document.getElementById(
    "input-keyboard",
  ) as HTMLButtonElement;
  const controller = document.getElementById(
    "input-controller",
  ) as HTMLButtonElement;
  controller.textContent = `Controllers (${status.controllers.length})`;
  keyboard.setAttribute("aria-selected", String(controlsTab === "keyboard"));
  controller.setAttribute(
    "aria-selected",
    String(controlsTab === "controller"),
  );
  keyboard.tabIndex = controlsTab === "keyboard" ? 0 : -1;
  controller.tabIndex = controlsTab === "controller" ? 0 : -1;
  document
    .getElementById("controller-controls-settings")!
    .classList.toggle("hidden", controlsTab !== "controller");
  document
    .getElementById("pause-controls-list")!
    .setAttribute(
      "aria-labelledby",
      controlsTab === "controller" ? "input-controller" : "input-keyboard",
    );
  const deviceSelect = document.getElementById(
    "controller-device",
  ) as HTMLSelectElement;
  const deviceSignature = status.controllers
    .map((device) => `${device.index}:${device.id}:${device.type}`)
    .join("|");
  if (deviceSelect.dataset.devices !== deviceSignature) {
    deviceSelect.dataset.devices = deviceSignature;
    deviceSelect.replaceChildren(
      ...status.controllers.map((device) => {
        const option = document.createElement("option");
        option.value = String(device.index);
        option.textContent = `${controllerTypeName(device.type)} · ${device.index + 1}: ${device.id}`;
        return option;
      }),
    );
  }
  deviceSelect.value = status.index === null ? "" : String(status.index);
  deviceSelect.disabled = !!status.setupStep || !status.controllers.length;
  const typeSelect = document.getElementById(
    "controller-type-select",
  ) as HTMLSelectElement;
  typeSelect.value = status.type ?? "generic";
  typeSelect.disabled = !!status.setupStep || !status.controllers.length;
  const connection = document.getElementById("controller-status")!;
  connection.textContent = status.message;
  connection.dataset.ready = String(status.ready);
  document
    .getElementById("controller-layout-options")!
    .classList.toggle("hidden", !status.ready);
  (document.getElementById("controller-swap-ab") as HTMLInputElement).checked =
    status.swapAB;
  document.getElementById("controller-swap-label")!.textContent =
    status.type === "playstation"
      ? "Swap Cross/Circle for this controller"
      : status.type === "generic"
        ? "Swap face buttons 1/2 for this controller"
        : "Swap A/B for this controller";
  document
    .getElementById("controller-setup")!
    .classList.toggle("hidden", !status.canSetup);
  document.getElementById("controller-setup-start")!.textContent =
    "Calibrate game controls";
  document.getElementById("controller-setup-step")!.textContent =
    status.setupStep ?? "";
  document
    .getElementById("controller-setup-start")!
    .classList.toggle("hidden", !!status.setupStep);
  document
    .getElementById("controller-setup-cancel")!
    .classList.toggle("hidden", !status.setupStep);
  const menuHint = "Left stick / D-pad: choose / {confirm}: select";
  for (const hint of document.querySelectorAll<HTMLElement>(
    ".controller-menu-hint",
  )) {
    renderControllerPrompt(
      hint,
      hint.closest("#menu-buttons")
        ? `${menuHint} / {plus}: menu`
        : `${menuHint} / {cancel}: back / {plus}: resume`,
    );
  }
  renderShownControl();
  if (menuScreen === "controls") renderControlsReference();
}
function selectControlsTab(tab: InputMode) {
  controlsTab = tab;
  if (tab === "keyboard") controllerInput?.cancelSetup();
  document.getElementById("pause-controls-list")!.scrollTop = 0;
  if (controllerInput) renderControllerStatus(controllerInput.getStatus());
}
function controllerMenuAction(action: ControllerMenuAction) {
  if (action === "back" && !quickMenuOpen && currentSceneData?.closeSceneMenu?.()) return;
  if (
    (arcade.briefingOpen || arcade.resultsOpen) &&
    (action === "pause" || action === "back")
  ) {
    if (action === "back") {
      const returnButton = document.getElementById(
        arcade.briefingOpen ? "arcade-briefing-return" : "arcade-return",
      ) as HTMLButtonElement;
      returnButton.click();
    }
    return;
  }
  if (menuScreen === "credits" && (action === "pause" || action === "back")) {
    backFromMenu();
    return;
  }
  if (action === "pause") {
    if (storySetupPending) {
      backFromMenu();
      return;
    }
    setPauseMenu(quickMenuOpen ? null : "home");
    return;
  }
  if (action === "back") {
    if (quickMenuOpen) backFromMenu();
    else if (
      !document.getElementById("character-select")!.classList.contains("hidden")
    )
      showTitlePanel("mode");
    else if (
      !document.getElementById("mode-select")!.classList.contains("hidden")
    )
      showTitlePanel("title");
    return;
  }
  const root = controllerMenuRoot();
  if (!root) return;
  updateControllerMenuFocus();
  const focused = document.activeElement;
  if (action === "confirm") {
    if (
      focused instanceof HTMLButtonElement &&
      root.contains(focused) &&
      !focused.disabled
    )
      focused.click();
    else if (
      focused instanceof HTMLInputElement &&
      focused.type === "checkbox" &&
      root.contains(focused)
    )
      focused.click();
    return;
  }
  const step = action === "up" || action === "left" ? -1 : 1;
  if (
    focused instanceof HTMLInputElement &&
    focused.type === "range" &&
    (action === "left" || action === "right")
  ) {
    focused.value = String(
      Math.max(
        Number(focused.min),
        Math.min(Number(focused.max), focused.valueAsNumber + step * 5),
      ),
    );
    focused.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (
    focused instanceof HTMLSelectElement &&
    (action === "left" || action === "right") &&
    focused.options.length > 0
  ) {
    focused.selectedIndex =
      (focused.selectedIndex + step + focused.options.length) %
      focused.options.length;
    focused.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (
    menuScreen === "controls" &&
    focused instanceof HTMLElement &&
    focused.getAttribute("role") === "tab" &&
    (action === "left" || action === "right")
  ) {
    const id = step < 0 ? "input-keyboard" : "input-controller";
    const tab = document.getElementById(id) as HTMLButtonElement;
    if (!tab.disabled) {
      tab.click();
      focusControllerMenuItem(tab);
    }
    return;
  }
  const list = document.getElementById(
    menuScreen === "credits" ? "credits-dialog-content" : "pause-controls-list",
  )!;
  if (focused === list && (action === "up" || action === "down")) {
    const canScroll =
      step < 0
        ? list.scrollTop > 0
        : list.scrollTop + list.clientHeight < list.scrollHeight - 1;
    if (canScroll) {
      list.scrollBy({ top: step * 110 });
      return;
    }
  }
  const items = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ),
  ).filter(
    (element) => element.getClientRects().length > 0 && element.tabIndex >= 0,
  );
  if (!items.length) return;
  const index = items.findIndex((element) => element === focused);
  const origin =
    focused instanceof HTMLElement ? focused.getBoundingClientRect() : null;
  const horizontal = action === "left" || action === "right";
  const candidates = origin
    ? items
        .filter((item) => item !== focused)
        .map((item) => {
          const rect = item.getBoundingClientRect();
          const dx = (rect.left + rect.right - origin.left - origin.right) / 2;
          const dy = (rect.top + rect.bottom - origin.top - origin.bottom) / 2;
          const forward = (horizontal ? dx : dy) * step;
          return {
            item,
            forward,
            score: forward + Math.abs(horizontal ? dy : dx) * 3,
          };
        })
        .filter((candidate) => candidate.forward > 8)
        .sort((a, b) => a.score - b.score)
    : [];
  const next =
    candidates[0]?.item ??
    items[(index < 0 ? 0 : index + step + items.length) % items.length];
  focusControllerMenuItem(next);
}
function setupControllerInput() {
  controllerInput = createGamepadInput({
    getContext() {
      const scene = currentSceneData?.getSceneId?.() ?? activeSceneId;
      const phase = currentSceneData?.getControllerPhase?.() ?? "";
      let kind: ControllerContext =
        freeCameraOpen && freeCamera?.isParked()
          ? "free-camera-parked"
          : freeCameraOpen
            ? "free-camera"
            : scene === "scene21"
              ? ["ground", "space"].includes(phase)
                ? "finale"
                : "cinematic"
              : scene === "scene14" || (scene === "scene13" && phase === "finisher")
                ? "escape"
                : activeSceneId === "scene15"
                  ? "flight"
                  : document.body.classList.contains("quarters-interface")
                    ? "inspection"
                    : currentSceneData?.isCinematic?.() ||
                        !currentPlayer?.isEnabled()
                      ? "cinematic"
                      : "foot";
      if (cinematicLoading.active || teleportLoading || deathPresentation)
        kind = "cinematic";
      return {
        id: `${scene}:${phase}`,
        kind,
        menuOpen: quickMenuOpen || controllerMenuRoot() !== null,
        wheelOpen: weaponWheelOpen,
        mapOpen: menuScreen === "map" && !!shipMap?.visible,
        exclusive: !!currentSceneData?.ownsControllerInput && !quickMenuOpen && !cinematicLoading.active,
      };
    },
    onModeChange(next) {
      if (menuScreen !== "controls") controlsTab = next;
      if (isControllerActive() && document.pointerLockElement)
        document.exitPointerLock();
      clearSceneInput();
      renderShownControl();
      const status = document.getElementById("weapon-status");
      if (status && equippedWeapon() !== "unarmed")
        status.textContent = inputHint(
          `${weaponEntries().find((entry) => entry.id === equippedWeapon())?.label ?? "Weapon"} | Hold Tab: weapons | Left click: attack`,
        );
    },
    onStatus: renderControllerStatus,
    onNotice(message) {
      if (activeSceneId === "scene1") return;
      const notice = document.getElementById("controller-notice")!;
      notice.textContent = message;
      notice.classList.remove("hidden");
      controllerNoticeTime = popupDuration(5);
    },
    onMenuAction: controllerMenuAction,
    onTeleportAction(action, heldSeconds) {
      if (currentSceneData?.controllerTeleport)
        currentSceneData.controllerTeleport(action, heldSeconds);
      else teleportDevice.controllerAction(action, heldSeconds);
    },
    onMapNavigate: (input, delta) =>
      shipMap?.navigateWithController(input, delta),
    onFreeCameraAnalog(input) {
      freeCameraAnalogInput = input;
    },
    onTitleOrbit(x, y, delta) {
      if (
        activeSceneId !== "scene1" ||
        quickMenuOpen ||
        !orbitControls?.enabled ||
        !activeCamera
      )
        return;
      const offset = activeCamera.position.clone().sub(orbitControls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= x * delta * 1.8;
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi - y * delta * 1.8,
        0.05,
        Math.PI - 0.05,
      );
      activeCamera.position
        .copy(orbitControls.target)
        .add(offset.setFromSpherical(spherical));
      orbitControls.update();
    },
    aimWheel: (x, y) => weaponWheel.aimFromStick(x, y),
    cancelWheel: () => weaponWheel.close(),
  });
  document
    .getElementById("input-keyboard")!
    .addEventListener("click", () => selectControlsTab("keyboard"));
  document
    .getElementById("input-controller")!
    .addEventListener("click", () => selectControlsTab("controller"));
  document
    .getElementById("controller-device")!
    .addEventListener("change", (event) => {
      controllerInput!.selectController(
        Number((event.currentTarget as HTMLSelectElement).value),
      );
    });
  document
    .getElementById("controller-type-select")!
    .addEventListener("change", (event) => {
      const type = (event.currentTarget as HTMLSelectElement).value;
      if (!isControllerType(type))
        throw new Error("Invalid controller type selection");
      controllerInput!.setControllerType(type);
    });
  document
    .getElementById("controller-setup-start")!
    .addEventListener("click", () => {
      controllerInput!.beginSetup();
      if (controllerInput!.getStatus().setupStep)
        document.getElementById("controller-setup-cancel")!.focus();
    });
  document
    .getElementById("controller-setup-cancel")!
    .addEventListener("click", () => controllerInput!.cancelSetup());
  document
    .getElementById("controller-swap-ab")!
    .addEventListener("change", (event) => {
      controllerInput!.setSwapAB(
        (event.currentTarget as HTMLInputElement).checked,
      );
    });
  document
    .getElementById("input-mode-tabs")!
    .addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code))
        return;
      event.preventDefault();
      const tab = document.getElementById(
        event.code === "ArrowLeft" || event.code === "Home"
          ? "input-keyboard"
          : "input-controller",
      ) as HTMLButtonElement;
      if (!tab.disabled) {
        tab.click();
        tab.focus();
      }
    });
}
function setPauseMenu(screen: MenuScreen | null, restorePointer = true) {
  if (cinematicLoading.active && screen !== null) return;
  if (screen !== "controls") controllerInput?.cancelSetup();
  weaponWheel.close();
  if (screen === "developer" && developerUnlocked) screen = "scenes";
  if (screen === menuScreen) return;
  const prologue = activeSceneId === "scene1";
  if (screen === "map" && !canViewShipMap()) return;
  if (screen === "scenes" && (!quickMenuOpen || !developerUnlocked)) return;
  if (screen === "controls")
    controlsReturnScreen = storySetupPending
      ? "story-setup"
      : menuScreen === "scenes"
        ? "scenes"
        : "home";
  if (screen === "credits" && menuScreen !== "credits") {
    creditsReturnScreen = menuScreen;
    creditsReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.getElementById("credits-dialog-content")!.scrollTop = 0;
  }
  const wasOpen = quickMenuOpen;
  menuScreen = screen;
  document.body.classList.toggle("ship-map-open", screen === "map");
  if (screen !== "map") {
    shipMap?.hide();
    setCharacterPreviewPostRender(null);
  }
  quickMenuOpen = screen !== null;
  pauseMenu.dataset.screen = screen ?? "";
  document.body.classList.toggle(
    "menu-form-open",
    screen === "story-setup" || screen === "display" ||
      screen === "controls" || screen === "sound",
  );
  pauseMenu.scrollTop = 0;
  for (const content of pauseMenu.querySelectorAll<HTMLElement>(".menu-panel-content"))
    content.scrollTop = 0;
  if (!wasOpen && quickMenuOpen) {
    resumePointerTarget = document.pointerLockElement as HTMLElement | null;
    if (resumePointerTarget) document.exitPointerLock();
    document.getElementById("scene-menu-error")!.textContent = "";
  }
  clearSceneInput();
  document.body.classList.toggle("quick-menu-open", quickMenuOpen);
  if (quickMenuOpen) setAudioMenuPaused(true);
  music.setMenuOpen(quickMenuOpen && !storySetupPending);
  currentSceneData?.setMenuPaused?.(quickMenuOpen);
  if (!quickMenuOpen) setAudioMenuPaused(false);

  const dialog =
    screen === "credits"
      ? creditsDialog
      : screen === "scenes"
        ? quickMenu
        : screen
          ? pauseMenu
          : null;
  for (const other of [pauseMenu, quickMenu, creditsDialog]) {
    if (other !== dialog && other.open) other.close();
  }
  if (!dialog) {
    stopCharacterPreview();
    document.getElementById("pause-overlay")?.classList.remove("active");
    document.getElementById("pause-orange")?.classList.remove("active");
    document.getElementById("pause-side-bar")?.classList.remove("active");
    document.getElementById("map-side-bar")?.classList.remove("active");
    document.getElementById("scene-side-bar")?.classList.remove("active");
    if (isControllerActive() && controllerMenuRoot())
      updateControllerMenuFocus();
    else renderer.domElement.focus();
    const target = resumePointerTarget;
    resumePointerTarget = null;
    if (
      restorePointer &&
      target?.isConnected &&
      currentPlayer?.isEnabled() &&
      !currentSceneData?.isCinematic?.() &&
      !document.body.classList.contains("touch-device") &&
      !isControllerActive()
    ) {
      try {
        void Promise.resolve(target.requestPointerLock()).catch(() => {});
      } catch {
        /* Click the world to recapture if denied. */
      }
    }
    return;
  }
  if (screen !== "scenes" && screen !== "credits") {
    document.getElementById("pause-menu-title")!.textContent =
      screen === "story-setup"
        ? "Lobby"
        : screen === "controls"
          ? developerUnlocked
            ? "All Controls"
            : "Controls"
          : screen === "map"
            ? "Ship Map"
            : screen === "sound"
              ? "Sound"
              : screen === "display"
                ? "Display"
                : screen === "developer"
                  ? "Developer Mode"
                  : "Pause";
    document
      .getElementById("story-setup-panel")!
      .classList.toggle("hidden", screen !== "story-setup");
    document
      .getElementById("pause-main-menu-panel")!
      .classList.toggle("hidden", screen !== "main-menu");
    document
      .getElementById("pause-main-menu")!
      .classList.toggle("hidden", prologue);
    document
      .getElementById("pause-home")!
      .classList.toggle("hidden", screen !== "home");
    document
      .getElementById("pause-prime-settings")!
      .classList.toggle("hidden", screen !== "display");
    (
      document.getElementById("prime-hints-toggle") as HTMLInputElement
    ).checked = getPrimeHintsEnabled();
    document
      .getElementById("pause-map-panel")!
      .classList.toggle("hidden", screen !== "map");
    document
      .getElementById("pause-sound-panel")!
      .classList.toggle("hidden", screen !== "sound");
    document
      .getElementById("pause-display-panel")!
      .classList.toggle("hidden", screen !== "display");
    if (screen === "display") {
      (document.getElementById("menu-font-select") as HTMLSelectElement).value =
        menuFont;
      (
        document.getElementById("comic-look-toggle") as HTMLInputElement
      ).checked = getComicLookEnabled();
      (document.getElementById("outlines-toggle") as HTMLInputElement).checked =
        getOutlinesEnabled();
      syncBloomSlider();
      const fpsToggle = document.getElementById(
        "fps-counter-toggle",
      ) as HTMLInputElement;
      const fpsCounterEl = document.getElementById("fps-counter");
      if (fpsToggle && fpsCounterEl)
        fpsToggle.checked = !fpsCounterEl.classList.contains("hidden");
      const perfToggle = document.getElementById(
        "perf-timers-toggle",
      ) as HTMLInputElement | null;
      if (perfToggle) perfToggle.checked = perfTimersEnabled;
    }
    document
      .getElementById("pause-controls-panel")!
      .classList.toggle("hidden", screen !== "controls");
    document
      .getElementById("pause-developer-form")!
      .classList.toggle("hidden", screen !== "developer");
    const sideBarSpan = document.querySelector("#pause-side-bar span");
    if (sideBarSpan)
      sideBarSpan.textContent =
        screen === "story-setup"
          ? "LOBBY"
          : screen === "developer"
          ? "UNLOCK"
          : screen === "sound"
            ? "SOUND"
            : screen === "display"
              ? "DISPLAY"
              : screen === "controls"
                ? "CONTROLS"
                : "PAUSE";
    const onMainMenu = !document
      .getElementById("menu-buttons")
      ?.classList.contains("hidden");
    document
      .getElementById("pause-resume")!
      .classList.toggle("hidden", prologue && !onMainMenu);
    document
      .getElementById("pause-restart-checkpoint")!
      .classList.toggle("hidden", prologue || activeSceneId === "prologue1");
    document.getElementById("pause-sound")!.classList.remove("hidden");
    document
      .getElementById("pause-return-museum")!
      .classList.toggle(
        "hidden",
        !arcade.active || activeSceneId === "museum" || screen !== "home",
      );
    document.getElementById("pause-display")!.classList.remove("hidden");
    document
      .getElementById("pause-ship-map")!
      .classList.toggle("hidden", !canViewShipMap());
    if (screen === "controls") {
      if (controllerInput) renderControllerStatus(controllerInput.getStatus());
      else renderControlsReference();
    }
    if (screen === "sound") {
      const settings = getAudioSettings();
      for (const channel of ["bgm", "sfx"] as const) {
        const value = String(Math.round(settings[channel] * 100));
        (
          document.getElementById(`${channel}-volume`) as HTMLInputElement
        ).value = value;
        document.getElementById(`${channel}-volume-value`)!.textContent =
          `${value}%`;
      }
    }
    if (screen === "controls") {
      requestAnimationFrame(syncControlsScrollHint);
    }
    if (screen === "developer") {
      setTimeout(() => {
        const developerElements = Array.from(
          document.querySelectorAll<HTMLElement>(
            "#pause-developer-form > h1, #pause-developer-form > button",
          ),
        );
        const count = developerElements.length;
        if (count >= 2) {
          developerElements.forEach((element) => {
            const rect = element.getBoundingClientRect();
            const offset =
              (rect.top + rect.height / 2 - window.innerHeight / 2) /
              (window.innerHeight / 2);
            const rotation = Math.max(-12, Math.min(12, -offset * 15));
            const arc =
              Math.min(1, Math.abs(offset)) ** 2 * window.innerWidth * 0.15;
            element.style.setProperty("--menu-arc", `${arc}px`);
            element.style.setProperty("--menu-rotation", `${rotation}deg`);
          });
        }
      }, 0);
    }
  }
  if (screen !== "scenes" && screen !== "credits") {
    const previewContainer = document.getElementById("pause-character-preview");
    if (previewContainer && !previewContainer.querySelector("canvas"))
      startCharacterPreview(
        previewContainer,
        arcade.active ? arcade.character : undefined,
        arcade.active ? currentSceneData?.getPausePreviewModel?.() ?? globalCharacter?.model : undefined,
      );
    document.getElementById("pause-overlay")?.classList.add("active");
    document.getElementById("pause-orange")?.classList.add("active");
    document
      .getElementById("pause-side-bar")
      ?.classList.toggle("active", screen !== "map");
    document
      .getElementById("map-side-bar")
      ?.classList.toggle("active", screen === "map");
    document.getElementById("scene-side-bar")?.classList.remove("active");
    if (screen === "home") {
      setTimeout(() => {
        document
          .getElementById("pause-menu")
          ?.dispatchEvent(new Event("scroll"));
      }, 0);
    }
  } else if (screen === "scenes") {
    document.getElementById("pause-overlay")?.classList.add("active");
    document.getElementById("pause-orange")?.classList.add("active");
    document.getElementById("pause-side-bar")?.classList.remove("active");
    document.getElementById("map-side-bar")?.classList.remove("active");
    const scenePreviewContainer = document.getElementById(
      "scene-character-preview",
    );
    if (scenePreviewContainer && !scenePreviewContainer.querySelector("canvas"))
      startCharacterPreview(
        scenePreviewContainer,
        arcade.active ? arcade.character : undefined,
        arcade.active ? currentSceneData?.getPausePreviewModel?.() ?? globalCharacter?.model : undefined,
      );
    document.getElementById("scene-side-bar")?.classList.add("active");
    setTimeout(() => {
      document
        .getElementById("scene-quick-list")
        ?.dispatchEvent(new Event("scroll"));
    }, 0);
  } else {
    stopCharacterPreview();
    document.getElementById("pause-overlay")?.classList.remove("active");
    document.getElementById("pause-orange")?.classList.remove("active");
    document.getElementById("pause-side-bar")?.classList.remove("active");
    document.getElementById("map-side-bar")?.classList.remove("active");
    document.getElementById("scene-side-bar")?.classList.remove("active");
  }
  if (!dialog.open) dialog.showModal();
  if (screen === "map") {
    chartCurrentMapSection();
    const layout = shipMapProgress.getLayout();
    if (shipMap && layout !== shipMapLayout) {
      shipMap.dispose();
      shipMap = null;
    }
    shipMapLayout = layout;
    shipMap ??= createShipMap(
      getCharacterPreviewRenderer()!,
      document.getElementById("ship-map-view")!,
      layout,
    );
    shipMap.open(
      currentSceneData?.getMapSceneId?.() ??
        currentSceneData?.getSceneId?.() ??
        activeSceneId,
      currentPlayer?.body.position,
    );
    setCharacterPreviewPostRender(() => shipMap?.render());
    const focus = isControllerActive()
      ? document.querySelector<HTMLElement>(
          '[data-map-tool="current"]:not(:disabled), [data-map-tool="fit"]',
        )
      : document.querySelector<HTMLElement>(".ship-map-canvas");
    if (focus) {
      if (isControllerActive()) focusControllerMenuItem(focus);
      else focus.focus();
    }
    return;
  }
  if (screen === "scenes") {
    const buttons =
      quickMenu.querySelectorAll<HTMLButtonElement>("[data-scene]");
    const currentId =
      currentSceneData?.getDeveloperSceneId?.() ??
      currentSceneData?.getSceneId?.() ??
      activeSceneId;
    const chapterIds: Record<string, number> = {
      scene1: 1,
      prologue1: 0,
      "living-quarters": 0.5,
      "stage1-storage": 1.1,
      "stage2-infiltration": 1.2,
      "stage2-armory": 1.3,
      "stage2-rust": 1.4,
      "stage2-rust2": 1.45,
      "stage2-reactor": 1.5,
      museum: 99,
    };
    const selectedId =
      chapterIds[currentId] ?? Number(currentId.replace("scene", ""));
    buttons.forEach((button) =>
      button.setAttribute(
        "aria-current",
        String(Number(button.dataset.scene) === selectedId),
      ),
    );
    const current =
      quickMenu.querySelector<HTMLButtonElement>('[aria-current="true"]') ??
      buttons[0];
    if (current) {
      if (isControllerActive()) focusControllerMenuItem(current);
      else {
        current.focus();
        current.scrollIntoView({ block: "nearest" });
      }
    }
  } else {
    const focusId =
      screen === "story-setup"
        ? "story-setup-start"
        : screen === "credits"
          ? "credits-dialog-close"
        : screen === "controls"
          ? controlsTab === "controller"
            ? "input-controller"
            : "input-keyboard"
          : screen === "sound"
            ? "bgm-volume"
            : screen === "display"
              ? "menu-font-select"
              : screen === "developer"
                ? "developer-unlock"
                : screen === "main-menu"
                  ? "pause-main-menu-cancel"
                  : prologue
                    ? "pause-controls"
                    : "pause-resume";
    const focus = document.getElementById(focusId);
    if (focus) {
      if (isControllerActive()) focusControllerMenuItem(focus);
      else focus.focus();
    }
  }
}

function syncBloomSlider() {
  const percent = String(Math.round(screenBloom.level * 100));
  (document.getElementById("bloom-level") as HTMLInputElement).value = percent;
  document.getElementById("bloom-level-value")!.textContent = `${percent}%`;
}

function backFromMenu() {
  if (storySetupPending) {
    if (menuScreen === "story-setup") {
      storySetupPending = false;
      setPauseMenu(null, false);
      showTitlePanel("mode");
    } else setPauseMenu("story-setup");
    return;
  }
  if (menuScreen === "credits") {
    const focus = creditsReturnFocus;
    creditsReturnFocus = null;
    setPauseMenu(creditsReturnScreen);
    if (focus?.isConnected && focus.getClientRects().length) {
      if (isControllerActive()) focusControllerMenuItem(focus);
      else focus.focus();
    }
    return;
  }
  setPauseMenu(
    menuScreen === "home"
      ? null
      : menuScreen === "controls"
        ? controlsReturnScreen
        : "home",
  );
}
async function jumpToScene(id: number) {
  if (
    menuScreen !== "scenes" ||
    !developerUnlocked ||
    !SCENE_CHOICES.some(([scene]) => scene === id)
  )
    return;
  if (id === 1) {
    closeArcadeBriefing();
    document.getElementById("arcade-run-clock")!.classList.add("hidden");
    setPauseMenu("main-menu");
    return;
  }
  if (id !== 1 && id !== 100) {
    document.getElementById("scene-menu-error")!.textContent =
      "Preparing character...";
    try {
      await prepareGlobalCharacter();
    } catch (error) {
      document.getElementById("scene-menu-error")!.textContent =
        `Character could not load: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (menuScreen !== "scenes") return;
  }
  arcade.run = null;
  arcadeReturnTo = undefined;
  arcade.active = id === MUSEUM_ID;
  stageTwoProgress = createStageTwoProgress();
  cctv.clearSources();
  await enterSceneById(id);
}
async function enterSceneById(id: number) {
  if (id !== 1 && id !== 100) await prepareGlobalCharacter();
  weaponWheel.close();
  teleportDevice.detachMarker();
  teleportArrivalTime = -1;
  globalCharacter?.setHologramTransition(null);
  pendingSceneActions.clear();
  setTouchFlightMode(false);
  clearSceneInput();
  // Detach persistent gear before the outgoing scene disposes its meshes.
  pistol.holster();
  crowbar.holster();
  bloomstick.holster();
  pistol.update(0);
  crowbar.update(0);
  bloomstick.update(0);
  globalCharacter?.model.removeFromParent();
  if (activeSceneId === "prologue1") currentSceneData?.dispose?.();
  if (currentSceneData === scene1Data) {
    currentSceneData?.dispose?.();
    scene1Data = null;
  }
  retireTraversalRoom();
  currentSceneData = null;
  currentPlayer = null;
  activeScene = null;
  activeCamera = null;
  music.enterScene(null);
  updatePhysics = null;
  cutsceneManager = null;
  lastSplinePoint = null;
  hideScene1Skip();
  for (const overlay of [
    "credits-overlay",
    "menu-buttons",
    "crowbar-overlay",
    "boss-hud",
    "boss-subtitles",
    "escape-qte",
    "loading-bay-status",
    "space-cinematic-caption",
  ])
    document.getElementById(overlay)?.classList.add("hidden");
  const fade = document.getElementById("fade-overlay");
  fade?.classList.remove("active", "black");
  fade?.classList.add("hidden");
  if (id === 1) {
    setPauseMenu(null, false);
    closeArcadeBriefing();
    document.getElementById("arcade-run-clock")!.classList.add("hidden");
    closeArcadeResults();
    arcade.active = false;
    arcade.run = null;
    arcadeReturnTo = undefined;
    developerRun = false;
    resetStoryProgress();
    try {
      await loadScene1(true);
    } catch (error) {
      console.error("[Main Menu] Unable to return:", error);
      document.getElementById("startup-loading")!.classList.add("hidden");
      document.getElementById("main-menu-error")!.textContent =
        "Unable to load the Main Menu. Please try again.";
      setPauseMenu("main-menu");
    }
    return;
  }
  if (id === 1.2) {
    stageTwoProgress = createStageTwoProgress();
    cctv.clearSources();
    bayBossDefeated = false;
    healthPackCollectedScene13 = false;
  } else if (id === 1.25) {
    stageTwoProgress = createStageTwoProgress();
    stageTwoProgress.checkpoint = "surveillance";
    stageTwoProgress.guardDown = true;
    stageTwoProgress.ventCleared = true;
    if (arcade.run?.id === 1.25)
      collectStageTwoKeycard(stageTwoProgress, "stage2-vents");
    cctv.clearSources();
    bayBossDefeated = false;
    healthPackCollectedScene13 = false;
  } else if (
    id === 1.3 ||
    id === 1.4 ||
    id === 1.45 ||
    id === 1.5 ||
    id === 5 ||
    id === 6
  ) {
    stageTwoProgress.checkpoint = "surveillance";
    stageTwoProgress.guardDown = true;
  }
  if (id === 13 || id === 13.5) bayBossDefeated = false;
  developerRun = true;
  grantDeveloperEquipment();
  const request = sceneRequestVersion + 1;
  try {
    switch (id) {
      case 0:
        await loadPrologue1();
        break;
      case 0.5:
        await loadLivingQuarters();
        break;
      case 1.1:
        await loadStage1Storage();
        break;
      case 1.25:
        if (!(await loadStageTwo()))
          throw new Error("The camera room did not activate");
        break;
      case 1.2:
        if (!(await loadStageTwo()))
          throw new Error("Stage Two did not activate");
        break;
      case 1.3:
        if (!(await loadCameraVisit("stage2-armory", undefined, true)))
          throw new Error("Bloomstick Tennis did not activate");
        break;
      case 1.4:
        if (!(await loadCameraVisit("stage2-rust", undefined, true)))
          throw new Error("The rust chamber did not activate");
        break;
      case 1.45:
        if (!(await loadCameraVisit("stage2-rust2", undefined, true)))
          throw new Error("Rust chamber 2 did not activate");
        break;
      case 1.5:
        if (!(await loadCameraVisit("stage2-reactor", undefined, true)))
          throw new Error("The Reactor Sequencer did not activate");
        break;
      case 5:
        if (!(await loadCameraVisit("scene5", undefined, true)))
          throw new Error("The cargo camera room did not activate");
        break;
      case 6:
        if (!(await loadCameraVisit("scene6", undefined, true)))
          throw new Error("The range camera room did not activate");
        break;
      case 13:
        if (!(await loadBay13())) throw new Error("Bay 13 did not activate");
        break;
      case 13.5:
        if (!(await loadBay13(undefined, false, false, true)))
          throw new Error("Bay 13 did not activate");
        break;
      case 14:
        await loadHangar14();
        break;
      case 15:
        await loadFlight15(undefined, undefined, true);
        break;
      case 15.5:
        await loadFlight15(undefined, "scrambler", true);
        break;
      case 15.6:
        await loadFlight15(undefined, "bossArmor", true);
        break;
      case 15.75:
        await loadFlight15(undefined, "topdownScrambler", true);
        break;
      case 15.9:
        await loadFlight15(undefined, "bossCore", true);
        break;
      case 16:
        await loadCrash16();
        break;
      case 17:
        await loadGround17();
        break;
      case 20:
        await loadFacility20();
        break;
      case 21:
        await loadScene21();
        break;
      case 21.5:
        await loadScene21(undefined, { stage: "rupture" });
        break;
      case 21.9:
        await loadScene21(undefined, { stage: "finisher" });
        break;
      case 22:
        await loadScene21(undefined, { stage: "credits" });
        break;
      case MUSEUM_ID:
        await loadMuseum(arcadeReturnTo);
        break;
      case 100:
        await loadChairTrailer();
        break;
    }
    if (request !== sceneRequestVersion) return;
    const spawnedPlayer = currentSceneData?.player as Player | undefined;
    if (spawnedPlayer && id !== MUSEUM_ID && id !== 100) {
      const spawn = spawnedPlayer.captureTransition({ x: 0, y: 0, z: 0 });
      spawnedPlayer.restoreTransition(
        {
          ...spawn,
          health: PLAYER_MAX_HEALTH,
          shield: spawnedPlayer.getMaxShield(),
        },
        { x: 0, y: 0, z: 0, yaw: -Math.PI },
      );
    }
    goggles.update();
    updatePlayerView(0);
    document.getElementById("scene-menu-error")!.textContent = "";
    setPauseMenu(null, false);
  } catch (error) {
    console.error("Scene jump failed:", error);
    document.getElementById("scene-menu-error")!.textContent =
      "Unable to load that scene. Choose another scene to continue.";
  }
}
function setupSceneQuickMenu() {
  renderer.domElement.tabIndex = -1;
  document
    .getElementById("pause-controls-list")!
    .addEventListener("scroll", syncControlsScrollHint, { passive: true });
  window.addEventListener("resize", syncControlsScrollHint, { passive: true });
  document.fonts.addEventListener("loadingdone", syncControlsScrollHint);
  const creditsCopy = document
    .getElementById("credits-content")!
    .cloneNode(true) as HTMLElement;
  creditsCopy.removeAttribute("id");
  creditsCopy.classList.add("credits-dialog-copy");
  document
    .getElementById("credits-dialog-content")!
    .replaceChildren(creditsCopy);
  document
    .getElementById("view-credits-btn")!
    .addEventListener("click", () => setPauseMenu("credits"));
  document
    .getElementById("credits-dialog-close")!
    .addEventListener("click", () => backFromMenu());
  creditsDialog.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === creditsDialog) backFromMenu();
  });
  const list = document.getElementById("scene-quick-list")!;
  for (const [id, label] of SCENE_CHOICES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scene = String(id);
    button.textContent = label;
    button.className = "menu-button menu-tilt";
    list.appendChild(button);
  }
  let rotationRafId = 0;
  const updateSceneButtonRotations = () => {
    if (rotationRafId) cancelAnimationFrame(rotationRafId);
    rotationRafId = requestAnimationFrame(() => {
      const viewportCenter = window.innerHeight / 2;
      const buttons =
        list.querySelectorAll<HTMLButtonElement>("button[data-scene]");
      buttons.forEach((button) => {
        const rect = button.getBoundingClientRect();
        const buttonCenter = rect.top + rect.height / 2;
        const offset = (buttonCenter - viewportCenter) / viewportCenter;
        const rotation = Math.max(-12, Math.min(12, -offset * 15));
        const arc =
          Math.min(1, Math.abs(offset)) ** 2 * window.innerWidth * 0.15;
        const selected =
          button.getAttribute("aria-current") === "true" ||
          button.classList.contains("controller-focused");
        button.style.setProperty(
          "--menu-arc",
          `${arc - (selected ? window.innerWidth * 0.025 : 0)}px`,
        );
        button.style.setProperty("--menu-rotation", `${rotation}deg`);
      });
      rotationRafId = 0;
    });
  };
  list.addEventListener("scroll", updateSceneButtonRotations, {
    passive: true,
  });
  window.addEventListener("scroll", updateSceneButtonRotations, {
    passive: true,
  });
  updateSceneButtonRotations();

  const pauseButtonIds = [
    "pause-main-menu",
    "pause-restart-checkpoint",
    "pause-ship-map",
    "pause-sound",
    "pause-display",
    "pause-controls",
    "pause-credits",
    "pause-return-museum",
    "pause-developer",
  ];
  let pauseRotationRafId = 0;
  const updatePauseButtonRotations = () => {
    if (pauseRotationRafId) cancelAnimationFrame(pauseRotationRafId);
    pauseRotationRafId = requestAnimationFrame(() => {
      const buttons = pauseButtonIds
        .map((id) => document.getElementById(id))
        .filter(
          (button): button is HTMLElement =>
            !!button && !button.classList.contains("hidden"),
        );
      const count = buttons.length;
      if (count < 2) {
        buttons.forEach((button) => {
          button.style.removeProperty("--menu-arc");
          button.style.removeProperty("--menu-rotation");
        });
        pauseRotationRafId = 0;
        return;
      }
      const home = document.getElementById("pause-home");
      if (home) {
        const homeStyle = getComputedStyle(home);
        const available =
          home.clientHeight -
          Number.parseFloat(homeStyle.paddingTop) -
          Number.parseFloat(homeStyle.paddingBottom);
        const totalHeight = buttons.reduce(
          (sum, button) => sum + button.offsetHeight,
          0,
        );
        const gap = Math.max(
          Math.min(
            window.innerHeight * 0.065,
            window.innerHeight * 0.015 +
              Math.max(0, count - 3) * window.innerHeight * 0.012,
          ),
          Math.min(
            window.innerHeight * 0.065,
            (available - totalHeight) / (count - 1),
          ),
        );
        home.style.gap = `${gap}px`;
      }
      const viewportCenter = window.innerHeight / 2;
      buttons.forEach((button) => {
        const rect = button.getBoundingClientRect();
        const offset =
          (rect.top + rect.height / 2 - viewportCenter) / viewportCenter;
        const rotation = Math.max(-12, Math.min(12, -offset * 15));
        const arc =
          Math.min(1, Math.abs(offset)) ** 2 * window.innerWidth * 0.15;
        const selected =
          button.getAttribute("aria-current") === "true" ||
          button.classList.contains("controller-focused");
        button.style.setProperty(
          "--menu-arc",
          `${arc - (selected ? window.innerWidth * 0.025 : 0)}px`,
        );
        button.style.setProperty("--menu-rotation", `${rotation}deg`);
      });
      pauseRotationRafId = 0;
    });
  };
  pauseMenu.addEventListener("scroll", updatePauseButtonRotations, {
    passive: true,
  });
  document
    .getElementById("pause-home")!
    .addEventListener("scroll", updatePauseButtonRotations, { passive: true });
  window.addEventListener("scroll", updatePauseButtonRotations, {
    passive: true,
  });
  window.addEventListener("resize", updatePauseButtonRotations, {
    passive: true,
  });
  updatePauseButtonRotations();
  // Button visibility (museum, map, restart) and the open panel change after setup, so refit the fan then.
  new MutationObserver(updatePauseButtonRotations).observe(pauseMenu, {
    attributes: true,
    subtree: true,
    attributeFilter: ["class", "data-screen", "open"],
  });

  pauseMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (button?.id === "pause-resume") setPauseMenu(null);
    else if (button?.id === "pause-main-menu") {
      document.getElementById("main-menu-error")!.textContent = "";
      setPauseMenu("main-menu");
    } else if (button?.id === "pause-main-menu-confirm") void enterSceneById(1);
    else if (button?.id === "pause-restart-checkpoint") {
      setPauseMenu(null, false);
      void restartAtLastCheckpoint();
    } else if (button?.id === "pause-ship-map") setPauseMenu("map");
    else if (button?.id === "pause-sound") setPauseMenu("sound");
    else if (button?.id === "pause-display") setPauseMenu("display");
    else if (button?.id === "pause-controls") setPauseMenu("controls");
    else if (button?.id === "pause-credits") setPauseMenu("credits");
    else if (button?.id === "pause-developer") setPauseMenu("developer");
    else if (button?.hasAttribute("data-pause-back")) backFromMenu();
  });
  for (const channel of ["bgm", "sfx"] as const) {
    const slider = document.getElementById(
      `${channel}-volume`,
    ) as HTMLInputElement;
    slider.addEventListener("input", () => {
      setAudioVolume(channel, slider.valueAsNumber / 100);
      document.getElementById(`${channel}-volume-value`)!.textContent =
        `${slider.value}%`;
    });
  }
  const voiceActingToggle = document.getElementById(
    "voice-acting-toggle",
  ) as HTMLInputElement;
  subscribeAudioSettings((settings) => {
    voiceActingToggle.checked = settings.voiceActing;
    voiceActingToggle.disabled = !settings.voiceActingAvailable;
  });
  voiceActingToggle.addEventListener("change", () =>
    setVoiceActingEnabled(voiceActingToggle.checked),
  );
  const bloomSlider = document.getElementById(
    "bloom-level",
  ) as HTMLInputElement;
  bloomSlider.addEventListener("input", () =>
    screenBloom.setLevel(bloomSlider.valueAsNumber / 100),
  );
  screenBloom.onChange(syncBloomSlider);
  const menuFontSelect = document.getElementById(
    "menu-font-select",
  ) as HTMLSelectElement;
  menuFontSelect.value = menuFont;
  menuFontSelect.addEventListener("change", () => {
    const selected = menuFontSelect.value;
    if (
      selected !== "normal" &&
      selected !== "sefa" &&
      selected !== "comic-sans"
    ) {
      console.error("[Display] Unsupported menu font:", selected);
      menuFontSelect.value = menuFont;
      return;
    }
    applyMenuFont(selected);
    requestAnimationFrame(syncControlsScrollHint);
  });
  const comicToggle = document.getElementById(
    "comic-look-toggle",
  ) as HTMLInputElement;
  setComicLookEnabled(false);
  comicToggle.checked = getComicLookEnabled();
  comicToggle.addEventListener("change", () => {
    setComicLookEnabled(comicToggle.checked);
  });
  const outlinesToggle = document.getElementById(
    "outlines-toggle",
  ) as HTMLInputElement;
  setOutlinesEnabled(false);
  outlinesToggle.checked = getOutlinesEnabled();
  outlinesToggle.addEventListener("change", () => {
    setOutlinesEnabled(outlinesToggle.checked);
  });
  const hideHudToggle = document.getElementById(
    "interface-visibility-toggle",
  ) as HTMLInputElement;
  const syncHudToggle = () => {
    hideHudToggle.checked = document.body.classList.contains("hud-hidden");
  };
  hideHudToggle.addEventListener("change", () =>
    document.body.classList.toggle("hud-hidden", hideHudToggle.checked),
  );
  new MutationObserver(syncHudToggle).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  syncHudToggle();
  const fpsToggle = document.getElementById(
    "fps-counter-toggle",
  ) as HTMLInputElement;
  const fpsCounter = document.getElementById("fps-counter")!;
  const syncFpsToggle = () => {
    fpsToggle.checked = !fpsCounter.classList.contains("hidden");
  };
  fpsToggle.addEventListener("change", () => {
    fpsCounter.classList.toggle("hidden", !fpsToggle.checked);
  });
  fpsCounter.classList.add("hidden");
  syncFpsToggle();
  const perfToggle = document.getElementById(
    "perf-timers-toggle",
  ) as HTMLInputElement | null;
  if (perfToggle) {
    perfTimersEnabled = true;
    perfToggle.checked = perfTimersEnabled;
    perfToggle.addEventListener("change", () => {
      perfTimersEnabled = perfToggle.checked;
    });
  }
  const hintToggle = document.getElementById(
    "prime-hints-toggle",
  ) as HTMLInputElement;
  hintToggle.addEventListener("change", () => {
    setPrimeHintsEnabled(hintToggle.checked);
    currentSceneData?.setHintsEnabled?.(hintToggle.checked);
    hintManager?.recordActivity();
  });
  document
    .getElementById("developer-unlock")!
    .addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menuScreen !== "developer" || !pauseMenu.open) return;
      developerUnlocked = true;
      setVoiceActingDeveloperMode(true);
      setPauseMenu("scenes");
    });
  quickMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (button?.dataset.scene) jumpToScene(Number(button.dataset.scene));
    else if (button?.id === "scene-quick-close") setPauseMenu("home");
  });
  for (const dialog of [pauseMenu, quickMenu, creditsDialog]) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      backFromMenu();
    });
    for (const type of [
      "keydown",
      "keyup",
      "mousedown",
      "mouseup",
      "mousemove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "touchstart",
      "touchmove",
      "touchend",
      "wheel",
    ]) {
      dialog.addEventListener(type, (event) => event.stopPropagation());
    }
  }
  pauseMenu.addEventListener("close", () => {
    if (
      !pauseMenu.open &&
      menuScreen !== null &&
      menuScreen !== "scenes" &&
      menuScreen !== "credits"
    )
      setPauseMenu(null, false);
  });
  quickMenu.addEventListener("close", () => {
    if (!quickMenu.open && menuScreen === "scenes") setPauseMenu("home");
  });
  creditsDialog.addEventListener("close", () => {
    if (!creditsDialog.open && menuScreen === "credits") backFromMenu();
  });
  const insideMenu = (event: Event) =>
    event.target instanceof Node &&
    (pauseMenu.contains(event.target) ||
      quickMenu.contains(event.target) ||
      creditsDialog.contains(event.target) ||
      (arcade.resultsOpen &&
        !!document.getElementById("arcade-results")?.contains(event.target)) ||
      (arcade.briefingOpen &&
        !!document.getElementById("arcade-briefing")?.contains(event.target)));
  window.addEventListener(
    "keydown",
    (event) => {
      // This capture handler precedes the input observer and owns menu shortcuts.
      if (!isControllerEvent(event)) controllerInput?.setMode("keyboard");
      if (arcade.resultsOpen || arcade.briefingOpen) {
        // Results own the keyboard; Tab and Enter still reach the buttons natively.
        event.stopImmediatePropagation();
        return;
      }
      if (document.body.classList.contains("facility-browser-open")) return;
      const editing =
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input:not([type="range"]), textarea, select, [contenteditable="true"]',
        );
      if (
        event.code === "KeyR" &&
        !event.repeat &&
        activeSceneId === "stage2-infiltration" &&
        !editing &&
        !quickMenuOpen &&
        returnToSurveillanceAnchor()
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        event.code === "KeyM" &&
        !editing &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          if (menuScreen === "credits") backFromMenu();
          else setPauseMenu(quickMenuOpen ? null : "home");
        }
        return;
      }
      if (!quickMenuOpen) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          if (controllerInput?.getStatus().setupStep)
            controllerInput.cancelSetup();
          else backFromMenu();
        }
        return;
      }
      if (
        menuScreen === "scenes" &&
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.code)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const buttons = Array.from(
          quickMenu.querySelectorAll<HTMLButtonElement>("[data-scene]"),
        );
        const focused = document.activeElement as HTMLButtonElement | null;
        const index = Math.max(0, buttons.indexOf(focused!));
        const next =
          event.code === "Home"
            ? 0
            : event.code === "End"
              ? buttons.length - 1
              : (index +
                  (event.code === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next].focus();
        buttons[next].scrollIntoView({ block: "nearest" });
        return;
      }
      if (!insideMenu(event)) event.stopImmediatePropagation();
    },
    true,
  );
  // Capture before scene input handlers; native dialog scrolling/focus still works.
  for (const type of [
    "keyup",
    "click",
    "mousedown",
    "mouseup",
    "mousemove",
    "pointerdown",
    "pointerup",
    "pointermove",
    "touchstart",
    "touchmove",
    "touchend",
    "wheel",
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (quickMenuOpen && !insideMenu(event))
          event.stopImmediatePropagation();
      },
      true,
    );
  }
}

// --- Start ---
initializeApp().catch((error) => {
  console.error("Failed to initialize game:", error);
  const startup = document.getElementById("startup-loading")!;
  startup.classList.remove("hidden");
  startup.querySelector("p")!.textContent =
    `The opening could not be prepared: ${error instanceof Error ? error.message : String(error)}`;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "RELOAD TO TRY AGAIN";
  retry.onclick = () => window.location.reload();
  startup.append(retry);
});

// --- Resize ---
window.addEventListener("resize", () => {
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
const healthFillEl = document.getElementById("health-bar-fill");
const healthLabelEl = document.getElementById("health-bar-label");
const healthBarEl = document.getElementById("health-bar");
const shieldFillEl = document.getElementById("shield-bar-fill");
const shieldLabelEl = document.getElementById("shield-bar-label");
const shieldBarEl = document.getElementById("shield-bar");
const playerDamageEl = document.getElementById("player-damage");
let deathPresentation: {
  player: Player;
  elapsed: number;
  managed: boolean;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  fov: number;
} | null = null;

async function respawnAtCheckpoint() {
  try {
    // Each minigame is its own checkpoint; the camera room only catches the rest of stage two.
    const loaded = isCameraVisit(activeSceneId)
      ? await loadCameraVisit(
          activeSceneId as CameraRoomId,
          undefined,
          developerRun || !surveillanceMarkerPlaced(),
        )
      : activeSceneId === "stage2-infiltration"
        ? await restartSurveillance()
        : await loadLivingQuarters(true);
    if (!loaded) throw new Error("The player checkpoint could not be restored");
  } catch (error) {
    console.error("Player checkpoint restart failed:", error);
    showTeleportDeviceMessage(
      "The checkpoint could not be loaded. Use the developer scene menu to retry.",
    );
  }
}

async function restartAtLastCheckpoint() {
  const handled = currentSceneData?.restartAtCheckpoint?.();
  if (handled === true) return;
  await respawnAtCheckpoint();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // FPS counter with rolling average
  const fpsCounterEl = document.getElementById("fps-counter");
  if (fpsCounterEl && !fpsCounterEl.classList.contains("hidden")) {
    if (!(animate as any).fpsHistory) (animate as any).fpsHistory = [];
    const history = (animate as any).fpsHistory as number[];
    history.push(1 / delta);
    if (history.length > 10) history.shift();
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const gpuMs = gpuTimer.sample();
    if (perfTimersEnabled) {
      if (!(animate as any).cpuHistory) (animate as any).cpuHistory = [];
      const cpuHistory = (animate as any).cpuHistory as number[];
      cpuHistory.push(latestCpuFrameMs);
      if (cpuHistory.length > 10) cpuHistory.shift();
      const cpuAvg = cpuHistory.reduce((a, b) => a + b, 0) / cpuHistory.length;
      fpsCounterEl.textContent =
        `${Math.round(avg)} FPS · ${cpuAvg.toFixed(1)} CPU` +
        (gpuMs !== null ? ` · ${gpuMs.toFixed(1)} GPU` : "");
    } else {
      fpsCounterEl.textContent = `${Math.round(avg)} FPS`;
    }
  }

  controllerInput?.update(delta);
  updateControllerMenuFocus();
  if (!openingReady) return;
  if (controllerNoticeTime > 0) {
    controllerNoticeTime = Math.max(
      0,
      controllerNoticeTime - Math.min(delta, 0.1),
    );
    document
      .getElementById("controller-notice")!
      .classList.toggle("hidden", controllerNoticeTime === 0);
  }
  cinematicLoading.update(delta);
  const soundScene = currentSceneData?.getRenderScene?.() ?? activeScene;
  updateDialogueVoice(
    activeScene,
    cinematicLoading.active ||
      quickMenuOpen ||
      weaponWheelOpen ||
      freeCameraOpen ||
      teleportLoading ||
      document.hidden ||
      !!currentSceneData?.isMusicPaused?.(),
  );
  updateSpatialAudio(
    soundScene, activeCamera,
    cinematicLoading.active || quickMenuOpen || weaponWheelOpen || freeCameraOpen || teleportLoading || document.hidden || !!currentSceneData?.isMusicPaused?.(),
  );
  soundscape.update(activeSceneId, soundScene);
  music.setPaused(
    (quickMenuOpen && !storySetupPending) ||
      (freeCameraOpen && !freeCamera?.isParked()) ||
      teleportLoading ||
      document.hidden ||
      (!weaponWheelOpen && !!currentSceneData?.isMusicPaused?.()),
  );
  if (mappedSceneData !== currentSceneData) {
    mappedSceneData = currentSceneData;
    chartCurrentMapSection();
  }
  if (cinematicLoading.active) {
    controlCard.classList.add("hidden");
    music.update(Math.min(delta, 0.1));
    return;
  }
  if (freeCameraOpen) {
    if (!freeCamera?.isActive()) {
      setFreeCamera(false);
      return;
    }
    controlCard.classList.add("hidden");
    if (!freeCamera.isParked()) {
      freeCamera.update(delta);
      if (activeScene && activeCamera) {
        const scene = currentSceneData?.getRenderScene?.() ?? activeScene;
        updateComicEffects(scene, activeCamera, delta, renderer);
        renderGameplayFrame(scene, activeCamera);
      }
      return;
    }
    // Parked: keep the game running with normal player controls. The frame is
    // drawn later with the locked camera instead of the player's view.
  }
  scene1SkipHold?.update(delta);
  if (quickMenuOpen || weaponWheelOpen || teleportLoading || document.hidden) {
    controlCard.classList.add("hidden");
    if (shipMap?.visible) return;
    if (activeScene && activeCamera)
      renderGameplayFrame(
        currentSceneData?.getRenderScene?.() ?? activeScene,
        viewCamera(activeCamera),
      );
    return;
  }
  advanceSceneActions(Math.min(delta, 0.1));
  trackArcadeRun(delta);
  if (checkpointNoticeTime > 0) {
    checkpointNoticeTime = Math.max(
      0,
      checkpointNoticeTime - Math.min(delta, 0.1),
    );
    if (checkpointNoticeTime === 0)
      document.getElementById("scene-checkpoint")!.classList.add("hidden");
  }
  if (!scene1SkipVisible)
    document.getElementById("skip-btn")?.classList.add("hidden");

  // Health bar + death/respawn
  if (currentPlayer) {
    if (deathPresentation && deathPresentation.player !== currentPlayer)
      deathPresentation = null;
    const health = currentPlayer.getHealth();
    const pct = Math.max(0, health / PLAYER_MAX_HEALTH);
    if (healthFillEl) {
      healthFillEl.style.width = `${pct * 100}%`;
      healthFillEl.classList.toggle("low", pct <= 0.3);
      healthFillEl.classList.toggle("mid", pct > 0.3 && pct <= 0.6);
    }
    if (healthLabelEl)
      healthLabelEl.textContent = `${Math.max(0, Math.ceil(health))} / ${PLAYER_MAX_HEALTH}`;
    healthBarEl?.setAttribute(
      "aria-valuenow",
      String(Math.max(0, Math.ceil(health))),
    );
    const shield = currentPlayer.getShield();
    const maxShield = currentPlayer.getMaxShield();
    const shieldPct = maxShield > 0 ? Math.max(0, shield / maxShield) : 0;
    if (shieldFillEl) shieldFillEl.style.width = `${shieldPct * 100}%`;
    if (shieldLabelEl)
      shieldLabelEl.textContent = `${Math.max(0, Math.ceil(shield))} / ${maxShield}`;
    shieldBarEl?.setAttribute(
      "aria-valuenow",
      String(Math.max(0, Math.ceil(shield))),
    );
    if (
      currentPlayer.isEnabled() &&
      health <= 0 &&
      !deathPresentation &&
      !currentSceneData?.handlesPlayerDeath
    ) {
      const managed = !!currentSceneData?.onPlayerDeath?.();
      deathPresentation = {
        player: currentPlayer,
        elapsed: 0,
        managed,
        position: activeCamera!.position.clone(),
        rotation: activeCamera!.quaternion.clone(),
        fov: activeCamera!.fov,
      };
      if (!managed) currentPlayer.disable();
    }
    if (deathPresentation) {
      deathPresentation.elapsed += Math.min(delta, 0.1);
      if (!deathPresentation.managed && deathPresentation.elapsed >= 2.5) {
        deathPresentation = null;
        void respawnAtCheckpoint();
      }
    }
  }
  // Physics
  if (updatePhysics) updatePhysics(delta, isThirdPerson);
  updateSpatialAudio(currentSceneData?.getRenderScene?.() ?? activeScene, activeCamera, !!currentSceneData?.isMusicPaused?.());
  music.update(Math.min(delta, 0.1));
  if (playerDamageEl) {
    playerDamageEl.dataset.damage =
      currentPlayer?.getDamageFlashColor() ?? "health";
    playerDamageEl.style.opacity = String(
      currentSceneData?.getDamageFlash?.() ??
        currentPlayer?.getDamageFlash() ??
        0,
    );
  }

  // Cutscenes
  if (cutsceneManager) cutsceneManager.update(delta);
  const inScene1 =
    currentSceneData === scene1Data && !currentPlayer?.isEnabled();
  const inCutscene =
    !!cutsceneManager ||
    !!deathPresentation ||
    !!currentSceneData?.isCinematic?.();
  const hideVitals =
    inCutscene ||
    !currentPlayer ||
    activeSceneId === "scene1" ||
    activeSceneId === "prologue1" ||
    activeSceneId === "scene21";
  if (healthBarEl) healthBarEl.style.display = hideVitals ? "none" : "";
  if (shieldBarEl)
    shieldBarEl.style.display =
      hideVitals || (currentPlayer?.getShield() ?? 0) <= 0 ? "none" : "";
  const aiming = pistol.isAiming();
  const crosshair = document.getElementById("crosshair");
  if (crosshair) {
    crosshair.style.display = inScene1 || inCutscene || !aiming ? "none" : "";
  }
  const onFoot =
    !!currentPlayer &&
    !!activeScene &&
    activeSceneId !== "scene1" &&
    activeSceneId !== "scene15" &&
    activeSceneId !== "scene16" &&
    (currentPlayer.isEnabled() || !!currentSceneData?.controlsReady?.());
  const aimingReticle = aiming || !!currentSceneData?.hasAimReticle?.();
  document
    .getElementById("look-reticle")
    ?.classList.toggle("hidden", !onFoot || inCutscene || aimingReticle);

  const sceneOwnsControls =
    !!deathPresentation || !!currentSceneData?.isCinematic?.();
  updateViewButton();
  updateControlCard(delta);

  const hintsReady =
    getPrimeHintsEnabled() &&
    !freeCameraOpen &&
    !returnTeleportPending &&
    !deathPresentation &&
    !cutsceneManager &&
    !shownControl &&
    !["scene1", "trailer", "stage1-storage"].includes(activeSceneId) &&
    (activeSceneId === "scene15"
      ? currentSceneData?.controlsReady?.()
      : !currentSceneData?.isCinematic?.() &&
        (!!currentPlayer?.isEnabled() || currentSceneData?.ownsWeaponInput));
  hintManager?.setEnabled(!!hintsReady);
  if (hintManager && currentPlayer && hintsReady) {
    hintManager.update(delta, {
      currentScene: ["living-quarters", "stage1-storage", "museum"].includes(
        activeSceneId,
      )
        ? activeSceneId
        : (currentSceneData?.getMapSceneId?.() ??
          currentSceneData?.getSceneId?.() ??
          activeSceneId),
      phase: currentSceneData?.getControllerPhase?.()?.split(":")[0],
      hasCrowbar,
      hasBloomstick,
      hasPistol,
      hasGoggles: goggles.isCollected(),
      shieldCollected: stageTwoProgress.remoteRooms.scene6.rewardCollected,
      healthPackCollected: healthPackCollectedScene13,
      bossDefeated: bayBossDefeated,
      ladderCratesCleared: stageTwoProgress.ventCleared,
      cargoDoorUnlocked: stageTwoProgress.elevatorUnlocked,
      playerPosition: {
        x: currentPlayer.body.position.x,
        y: currentPlayer.body.position.y,
        z: currentPlayer.body.position.z,
      },
    });
  }

  // Character animations + view
  goggles.update();
  teleportDevice.update(delta);
  updatePlayerView(delta);
  currentSceneData?.updateInteractionFocus?.();
  if (teleportArrivalTime >= 0) {
    teleportArrivalTime += Math.min(delta, 0.1);
    if (teleportArrivalTime >= TELEPORT_TRANSFER_DURATION)
      teleportArrivalTime = -1;
  }
  if (teleportDepartureTime >= 0) teleportDepartureTime += Math.min(delta, 0.1);
  globalCharacter?.setHologramTransition(
    teleportDepartureTime >= 0
      ? hologramTransitionAt(
          teleportDepartureTime,
          false,
          RETURN_TELEPORT_SECONDS,
          0x58ff9a,
        )
      : teleportArrivalTime >= 0
        ? hologramTransitionAt(
            teleportArrivalTime,
            true,
            TELEPORT_TRANSFER_DURATION,
            teleportArrivalColor,
          )
        : (currentSceneData?.getHologramTransition?.() ?? null),
  );

  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput) {
    pistol.update(delta);
    crowbar.update(delta);
  }
  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput)
    bloomstick.update(delta);
  else bloomstick.detach();
  if (!sceneOwnsControls && !currentSceneData?.ownsWeaponInput)
    unarmedCombat.update(delta);
  else unarmedCombat.reset();
  cctv.update(
    delta,
    activeScene,
    currentSceneData?.getCctvEnabled?.() ?? false,
    currentSceneData?.getCctvPaused?.() ?? false,
  );

  // Controls
  if (orbitControls && orbitControls.enabled) orbitControls.update();

  // Render
  if (activeScene && activeCamera) {
    const scene = currentSceneData?.getRenderScene?.() ?? activeScene;
    const camera = viewCamera(activeCamera);
    updateComicEffects(scene, camera, delta, renderer);
    renderGameplayFrame(scene, camera);
  }
}

animate();
