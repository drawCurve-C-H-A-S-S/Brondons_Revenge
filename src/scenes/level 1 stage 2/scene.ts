import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel, preloadToolModel } from '../../core/loader.js';
import type { MinimapSettings } from '../../core/renderer.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { createSlidingPortal, disposeRoom, roomBox } from '../../helpers/scene/shipRoom.js';
import { createShipInteriorMaterials, createShipStorageShelf, createShipServerRack, createShipStatusTexture,
  createShipTerminal, SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import { getAudioSettings, subscribeAudioSettings } from '../../helpers/audio/AudioManager.js';
import { createPlayer, PLAYER_MAX_HEALTH, type PlayerState, type PlayerTransitionState } from '../../scripts/player.js';
import { createBreakables, type Breakable } from '../../scripts/breakables.js';
import { createRewardChest } from '../../scripts/rewardChest.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { hologramTransitionAt, HOLOGRAM_TRANSFER_DURATION, type CinematicPose } from '../../scripts/characterManager.js';
import type { DamageTarget } from '../../scripts/pistol.js';
import type { CctvTarget } from '../../scripts/cctv.js';
import type { WeaponId } from '../../scripts/weaponWheel.js';
import { createKeypad } from '../living quarters/surfaces.js';
import { createInspectionView } from '../living quarters/inspectionView.js';
import { fitCabinProp } from '../living quarters/furnishings.js';
import { STAGE_TWO, STAGE_TWO_MAP, SURVEILLANCE_CODE, VENT_MAZE, VENT_SENSORS, VENT_SAFE_CELLS,
  VENT_ROUTE, ventPoint, ventSensorState, type CameraRoomId, type StageTwoProgress } from './stageTwoLayout.js';

type Phase = 'intro' | 'approach' | 'alarm' | 'chase' | 'climb' | 'maze' | 'drop' | 'guard'
  | 'takedown' | 'brief' | 'surveillance' | 'teleport' | 'lift' | 'handoff' | 'load-error' | 'failed';
interface StageTwoOptions {
  progress: StageTwoProgress;
  entryState?: PlayerTransitionState;
  deferActivation?: boolean;
  getCameraTarget: () => CctvTarget | null;
  hasReturnMarker: () => boolean;
  getEquippedWeapon: () => WeaponId;
  holsterWeapons: () => void;
  onCrowbarCollected: () => void;
  onRetryFeed: (id: CameraRoomId) => void;
  onCameraTeleport: (id: CameraRoomId, state: PlayerTransitionState) => Promise<boolean>;
  prepareBay13: () => Promise<void>;
  onExitToBay13: (state: PlayerTransitionState) => Promise<boolean>;
}

export async function preloadAssets() {
  await Promise.all([preloadToolModel('Enemy_Trilobite'), preloadToolModel('Enemy_QuadShell'), preloadToolModel('Prop_Chair')]);
}

export function createScene(options: StageTwoOptions) {
  const { progress } = options;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  scene.fog = new THREE.Fog(0x0a121d, 24, 60);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 90);
  const materials = createShipInteriorMaterials(9, 7);
  materials.deck.color.setHex(0x3b4c5d);
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.15 });
  const warning = new THREE.MeshStandardMaterial({ color: 0xdab943, roughness: 0.65, metalness: 0.25 });
  const passage = new THREE.Group(), storage = new THREE.Group(), maze = new THREE.Group();
  const surveillance = new THREE.Group(), lift = new THREE.Group();
  scene.add(passage, storage, maze, surveillance, lift);
  const groups = [passage, storage, maze, surveillance, lift];
  const box = (group: THREE.Group, size: [number, number, number], at: [number, number, number],
    material: THREE.Material = materials.steel, solid = true) => {
    const mesh = roomBox(scene, physics, size, at, material, solid); group.add(mesh); return mesh;
  };
  function hatchSurface(group: THREE.Group, bounds: [number, number, number, number], y: number,
    opening: [number, number, number, number], material: THREE.Material) {
    const [left, right, north, south] = bounds, [x, z, width, depth] = opening;
    const a = x - width / 2, b = x + width / 2, c = z - depth / 2, d = z + depth / 2;
    if (!(a > left && b < right && c > north && d < south)) throw new Error('A vent hatch must fit inside its supporting surface');
    const panels = [[left, a, north, south], [b, right, north, south], [a, b, north, c], [a, b, d, south]];
    return panels.map(([minX, maxX, minZ, maxZ]) =>
      box(group, [maxX - minX, 0.16, maxZ - minZ], [(minX + maxX) / 2, y, (minZ + maxZ) / 2], material));
  }
  box(passage, [5, 0.2, 34], [0, -0.1, -11], materials.deck);
  box(passage, [0.18, 3.2, 34], [-2.5, 1.6, -11]);
  box(passage, [0.18, 3.2, 18.4], [2.5, 1.6, -18.8]);
  box(passage, [0.18, 3.2, 12.4], [2.5, 1.6, -0.2]);
  for (const z of [-28, 6]) box(passage, [5, 3.2, 0.18], [0, 1.6, z], materials.dark);
  box(passage, [5, 0.16, 34], [0, 3.2, -11], materials.dark).userData.minimap = false;
  for (const z of [2, -4, -12, -18, -24]) {
    for (const side of [-1, 1]) box(passage, [0.025, 0.05, 2.5], [side * 2.39, 2.35, z], materials.cyan, false);
    const lamp = new THREE.PointLight(0xb6dfec, 9, 8); lamp.position.set(0, 2.8, z); passage.add(lamp);
    box(passage, [1.1, 0.04, 0.13], [0, 3.06, z], materials.cyan, false);
  }
  // Sealed airlock leaf behind the arrival point, matching the Deck One bulkhead Brondon just walked through.
  box(passage, [3.3, 3.0, 0.08], [0, 1.5, 5.87], materials.trim, false);
  for (const side of [-1, 1]) box(passage, [1.42, 2.72, 0.06], [side * 0.73, 1.36, 5.81], materials.dark, false);
  box(passage, [0.035, 2.6, 0.03], [0, 1.34, 5.77], materials.cyan, false);
  for (const z of [-2, -14, -22]) {
    box(passage, [4.8, 0.14, 0.16], [0, 3.01, z], materials.trim, false);
    for (const side of [-1, 1]) {
      box(passage, [0.06, 2.8, 0.12], [side * 2.37, 1.5, z], materials.trim, false);
      box(passage, [0.04, 0.06, 5], [side * 2.35, 0.19, z + 2.5], materials.dark, false);
    }
  }

  box(storage, [7, 0.2, 6], [6, -0.1, -8], materials.deck);
  box(storage, [7, 3.2, 0.18], [6, 1.6, -11]);
  box(storage, [7, 3.2, 0.18], [6, 1.6, -5]);
  box(storage, [0.18, 3.2, 6], [9.5, 1.6, -8]);
  for (const mesh of hatchSurface(storage, [2.5, 9.5, -11, -5], 3.2, [8, -9.55, 1, 1.3], materials.dark)) mesh.userData.minimap = false;
  for (const x of [7.5, 8.5]) box(storage, [0.08, 0.8, 1.3], [x, 3.6, -9.55], materials.dark);
  for (const z of [-10.2, -8.9]) box(storage, [1, 0.8, 0.08], [8, 3.6, z], materials.dark);
  for (const x of [7.52, 8.48]) box(storage, [0.065, 4.4, 0.065], [x, 2.2, -10.18], materials.trim, false);
  for (let y = 0.25; y < 4.4; y += 0.3) box(storage, [0.96, 0.055, 0.065], [8, y, -10.18], materials.trim, false);
  const storeDoor = createSlidingPortal(scene, physics, { x: 2.5, y: 0, z: -8, yaw: -Math.PI / 2 },
    6, 3.2, 'MAINTENANCE / STOREROOM', { doorHeight: 2.5, sign: false });
  storage.add(storeDoor.group);
  for (const [index, x] of [3.85, 6.1, 8.35].entries()) {
    const shelf = createShipStorageShelf(materials);
    shelf.name = `StoreroomShelf-${index + 1}`; shelf.position.set(x, 0, -5.55); shelf.rotation.y = Math.PI; storage.add(shelf);
    physics.addBox({ x: 2.08, y: 2.55, z: 0.8 }, { x, y: 1.275, z: -5.55 });
  }
  const toolShelf = createShipStorageShelf(materials);
  toolShelf.name = 'StoreroomToolShelf'; toolShelf.position.set(6.15, 0, -10.43); toolShelf.scale.x = 0.9; storage.add(toolShelf);
  physics.addBox({ x: 2.08 * 0.9, y: 2.55, z: 0.8 }, { x: 6.15, y: 1.275, z: -10.43 });
  for (const x of [3.1, 6.7, 9.35]) {
    box(storage, [0.085, 2.85, 0.06], [x, 1.5, -10.86], materials.trim, false);
  }
  box(storage, [6.65, 0.14, 0.15], [6, 2.93, -8], materials.trim, false);
  for (const y of [0.15, 2.75]) {
    box(storage, [0.055, 0.07, 5.6], [9.36, y, -8], materials.trim, false);
  }
  for (const x of [6.85, 9.1]) box(storage, [0.07, 0.014, 2.1], [x, 0.015, -9.45], warning, false);
  for (const z of [-8.45, -10.5]) box(storage, [2.3, 0.014, 0.07], [8, 0.015, z], warning, false);
  for (let x = 7.05; x < 9; x += 0.32) {
    box(storage, [0.12, 0.016, 0.32], [x, 0.025, -8.45], materials.dark, false).rotation.y = -Math.PI / 4;
  }
  const storeLight = new THREE.PointLight(0xb6dfec, 20, 10); storeLight.position.set(6, 2.8, -8); storage.add(storeLight);
  box(storage, [1.6, 0.04, 0.14], [6, 3.06, -8], materials.cyan, false);
  const alarmMaterial = new THREE.MeshStandardMaterial({ color: 0x42352b, emissive: 0x000000 });
  box(storage, [0.2, 0.18, 0.12], [2.7, 2.65, -6.35], alarmMaterial, false);

  for (const [row, line] of VENT_MAZE.entries()) for (const [column, cell] of [...line].entries()) {
    const point = ventPoint(column, row);
    if (cell === '#') box(maze, [2, 1.35, 2], [point.x, 4.675, point.z]);
    else if (cell === 'S') hatchSurface(maze, [point.x - 1, point.x + 1, point.z - 1, point.z + 1],
      3.92, [8, -9.55, 1, 1.3], materials.deck);
    else if (cell === 'E') hatchSurface(maze, [point.x - 1, point.x + 1, point.z - 1, point.z + 1],
      3.92, [20, -1.5, 1.25, 1.25], materials.deck);
    else box(maze, [2, 0.16, 2], [point.x, 3.92, point.z], materials.deck);
  }
  box(maze, [18, 0.12, 14], [14, 5.48, -5.5], materials.dark).userData.minimap = false;
  const hatch = box(maze, [1, 0.16, 1.3], [8, 3.92, -9.55], materials.trim, false); hatch.visible = false;
  let hatchBody: CANNON.Body | null = null;
  function closeHatch() {
    hatch.visible = true;
    if (!hatchBody) hatchBody = physics.addBox({ x: 1, y: 0.16, z: 1.3 }, hatch.position);
  }
  for (const cell of VENT_SAFE_CELLS) {
    const point = ventPoint(cell.column, cell.row);
    box(maze, [0.55, 0.014, 0.55], [point.x, 4.015, point.z], materials.cyan, false);
  }
  const sensorMaterial = new THREE.MeshStandardMaterial({ color: 0xff795e, emissive: 0xff2d17, emissiveIntensity: 1.8 });
  const sensors = VENT_SENSORS.map((sensor, index) => {
    const root = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), sensorMaterial.clone());
    root.name = sensor.id; root.position.copy(ventSensorState(index, 0).position);
    root.userData.minimap = false; maze.add(root); return root;
  });
  const sensorRings = sensors.map(sensor => {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.48, 32),
      new THREE.MeshBasicMaterial({ color: 0xff795e, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
    ring.name = 'SensorDetectionFootprint'; ring.rotation.x = -Math.PI / 2; ring.position.y = -0.475; sensor.add(ring);
    return ring;
  });
  for (const column of [2, 4, 6]) {
    const point = ventPoint(column, 1);
    box(maze, [0.07, 0.08, 1.92], [point.x, 5.26, point.z], materials.trim, false).userData.minimap = false;
    for (const side of [-1, 1]) box(maze, [0.07, 1.16, 0.055], [point.x, 4.65, point.z + side * 0.96], materials.trim, false);
  }
  for (const row of [2, 4]) {
    const point = ventPoint(7, row);
    box(maze, [1.92, 0.08, 0.07], [point.x, 5.26, point.z], materials.trim, false).userData.minimap = false;
    for (const side of [-1, 1]) box(maze, [0.055, 1.16, 0.07], [point.x + side * 0.96, 4.65, point.z], materials.trim, false);
  }
  for (const column of [1, 3, 5, 7]) {
    const point = ventPoint(column, 1); const lamp = new THREE.PointLight(0x78b9cd, 4, 5);
    lamp.position.set(point.x, 5.2, point.z); maze.add(lamp);
  }
  const exitLight = new THREE.PointLight(0x72eeaa, 6, 5); exitLight.position.set(20, 5.2, -1.5); maze.add(exitLight);

  box(surveillance, [10, 0.2, 10], [20, -0.1, -4.8], materials.deck);
  for (const x of [15, 25]) box(surveillance, [0.18, 3.2, 10], [x, 1.6, -4.8]);
  box(surveillance, [10, 3.2, 0.18], [20, 1.6, 0.2]);
  box(surveillance, [6, 3.2, 0.18], [18, 1.6, -9.8]);
  for (const mesh of hatchSurface(surveillance, [15, 25, -9.8, 0.2], 3.2, [20, -1.5, 1.25, 1.25], materials.dark)) mesh.userData.minimap = false;
  for (const x of [19.375, 20.625]) box(surveillance, [0.08, 0.8, 1.25], [x, 3.6, -1.5], materials.dark);
  for (const z of [-2.125, -0.875]) box(surveillance, [1.25, 0.8, 0.08], [20, 3.6, z], materials.dark);
  for (const x of [16.4, 23.8]) {
    const lamp = new THREE.PointLight(0xb6dfec, 14, 10); lamp.position.set(x, 2.7, -4.5); surveillance.add(lamp);
    box(surveillance, [0.035, 0.06, 3.2], [x < 20 ? 15.12 : 24.88, 2.25, -4.8], materials.cyan, false);
  }
  box(surveillance, [5.5, 0.1, 1.1], [17.8, 0.9, -8.85], pale);
  for (const x of [15.5, 20.1]) {
    box(surveillance, [0.58, 0.85, 0.86], [x, 0.425, -8.85], materials.dark);
    for (const y of [0.25, 0.52]) box(surveillance, [0.4, 0.025, 0.025], [x, y, -8.4], materials.trim, false);
  }
  for (const x of [16.2, 17.8, 19.4]) {
    box(surveillance, [0.62, 0.025, 0.23], [x, 0.97, -8.55], materials.dark, false);
    for (let key = 0; key < 7; key++) box(surveillance, [0.045, 0.016, 0.08],
      [x - 0.22 + key * 0.07, 0.992, -8.55], materials.trim, false);
  }
  for (const [index, z] of [-3.8, -5.5].entries()) {
    const rack = createShipServerRack(materials);
    rack.name = `SurveillanceServerRack-${index + 1}`; rack.position.set(15.55, 0, z); rack.rotation.y = Math.PI / 2;
    surveillance.add(rack); physics.addBox({ x: 0.8, y: 2.65, z: 0.86 }, { x: 15.55, y: 1.325, z });
  }
  const telemetry = createShipStatusTexture('SURVEILLANCE / DECK 01', [
    '03 REMOTE CAMERA LINKS / ONLINE', 'VENT SENSOR ARRAY / STANDBY', 'SERVICE LIFT / RESTRICTED', 'BAY 14 CIRCUIT / OFFLINE',
  ]);
  box(surveillance, [0.95, 0.85, 3.3], [24.22, 0.425, -4.85], materials.dark);
  box(surveillance, [1.05, 0.08, 3.4], [24.2, 0.9, -4.85], pale);
  for (const z of [-4, -5.7]) {
    const terminal = createShipTerminal(telemetry);
    terminal.root.position.set(24.32, 0.95, z); terminal.root.rotation.y = Math.PI / 2; surveillance.add(terminal.root);
  }
  const chairsReady = Promise.all([16.25, 20].map(async x => {
    const gltf = await loadToolModel('Prop_Chair');
    if (disposed) { disposeRoom(gltf.scene); return; }
    const size = fitCabinProp(gltf.scene, 1.05, 0.68, 0.8);
    gltf.scene.name = 'SurveillanceConsoleChair'; gltf.scene.position.add(new THREE.Vector3(x, 0, -7.45)); surveillance.add(gltf.scene);
    physics.addBox(size, { x, y: size.y / 2, z: -7.45 });
  }));
  for (const x of [16.5, 23.5]) {
    box(surveillance, [0.16, 0.12, 9.6], [x, 3.03, -4.8], materials.trim, false).userData.minimap = false;
  }
  for (const x of [15.16, 24.84]) {
    box(surveillance, [0.045, 0.07, 9.6], [x, 0.16, -4.8], materials.trim, false);
    box(surveillance, [0.025, 0.02, 8.8], [x, 0.02, -4.8], materials.cyan, false);
  }
  const frontDoor = createSlidingPortal(scene, physics, { x: 23, y: 0, z: -9.8, yaw: 0 }, 4, 3.2,
    'SERVICE ELEVATOR', { doorHeight: 2.5, sign: false });
  surveillance.add(frontDoor.group);
  box(lift, [4, 0.2, 6.8], [23, -0.1, -13.2], materials.deck);
  for (const x of [21, 25]) box(lift, [0.18, 3.2, 6.8], [x, 1.6, -13.2]);
  box(lift, [4, 0.16, 4.8], [23, 3.2, -12.2], materials.dark).userData.minimap = false;
  const rearDoor = createSlidingPortal(scene, physics, { x: 23, y: 0, z: -14.6, yaw: 0 }, 4, 3.2,
    'BAY 13 / CARGO ARENA', { doorHeight: 2.5, sign: false }); lift.add(rearDoor.group);
  const liftLamp = new THREE.PointLight(0xb6dfec, 13, 7); liftLamp.position.set(23, 2.7, -12.2); lift.add(liftLamp);
  const liftStripMaterial = new THREE.MeshBasicMaterial({ color: 0x6ad9e8, toneMapped: false });
  box(lift, [1.5, 0.04, 0.16], [23, 3.06, -12.2], liftStripMaterial, false);
  box(lift, [0.08, 0.5, 1.05], [21.13, 1.15, -12.3], materials.dark, false);
  const workingButtonMaterial = new THREE.MeshBasicMaterial({ color: 0x72eeaa, toneMapped: false });
  const workingButton = new THREE.Mesh(new THREE.CircleGeometry(0.105, 16), workingButtonMaterial);
  workingButton.rotation.y = Math.PI / 2; workingButton.position.set(21.18, 1.15, -12.05); lift.add(workingButton);
  box(lift, [0.035, 0.14, 0.17], [21.2, 1.1, -12.58], materials.trim, false).rotation.x = -0.7;
  for (const z of [-12.56, -12.63]) box(lift, [0.055, 0.23, 0.025], [21.22, 1.15, z], alarmMaterial, false).rotation.x = 0.35;
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.05),
    new THREE.HemisphereLight(0xb9d5e9, 0x1b2a36, 1.35));

  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 4 } });
  teleportPlayer(player, { x: 0, y: player.radius, z: 4 }, 0, options.entryState);
  const playable = new Set<Phase>(['approach', 'chase', 'maze', 'guard', 'surveillance']);
  let phase: Phase = 'intro', phaseTime = 0, elapsed = 0, active = false, disposed = false, menuPaused = false;
  let lastDelta = 0, captionTime = 0, fastClimb = false, scanning = false, guardGrace = 3;
  let checkpointState = player.captureTransition({ x: 0, y: 0, z: 0 });
  let ventSafe = ventPoint(1, 1, 4 + player.radius), sensorGrace = 0;
  let transferTarget: CameraRoomId | null = null, transferPending = false, liftStomp = 0, lastStomp = -10;
  let nextChatter = 0, chattingBot = 0, guardAlert = -1, guardAlertReason = '', objectiveShown = '', objectiveTime = 0;
  let introLine = false;
  const liftStart = new THREE.Vector3(), liftCues = { press: false, depart: false, line: false, arrive: false };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ui = document.createElement('section'); ui.className = 'stage-two-ui hidden';
  const objective = document.createElement('div'); objective.className = 'stage-two-objective faded';
  const objectiveText = document.createElement('span'); objective.append(objectiveText);
  const caption = document.createElement('div'); caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  const failure = document.createElement('div'); failure.className = 'stage-two-failure hidden';
  const failureTitle = document.createElement('strong'), failureText = document.createElement('p');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'R / Retry checkpoint';
  failure.append(failureTitle, failureText, retry);
  const fade = document.createElement('div'); fade.className = 'stage-two-transition'; fade.setAttribute('aria-hidden', 'true');
  ui.append(objective, caption, failure, fade); document.body.append(ui);
  const prompt = document.getElementById('interact-prompt');
  function tell(text: string, seconds = 4) { caption.textContent = text; captionTime = seconds; caption.classList.remove('hidden'); }
  function syncBodyClass() {
    if (!active) return;
    document.body.classList.toggle('stage-two-maze', phase === 'maze');
    document.body.classList.toggle('quarters-cinematic', !playable.has(phase) || !!inspection.active);
  }
  function setPhase(next: Phase) {
    phase = next; phaseTime = 0; fastClimb = false; player.clearInput(); prompt?.classList.add('hidden');
    if (playable.has(next)) { player.setClimbing(false); player.setInputLocked(false); player.enable(); }
    else { options.holsterWeapons(); player.disable(); player.setClimbing(true); }
    failure.classList.toggle('hidden', next !== 'failed' && next !== 'load-error');
    syncBodyClass();
  }
  const inspection = createInspectionView(scene, camera, ui, () => {
    if (!disposed) { player.setClimbing(false); player.enable(); player.clearInput(); syncBodyClass(); }
  });
  const keypad = createKeypad({ code: SURVEILLANCE_CODE, title: 'SERVICE LIFT', isUnlocked: () => progress.elevatorUnlocked,
    validate: () => !progress.lightsaberCollected ? 'RETRIEVE LIGHTSABER' : !progress.codeRead ? 'READ ARCHIVE FILE' : null,
    onUnlock: () => {
      progress.elevatorUnlocked = true; playSound('clang');
      tell('Prime: The lift is open.', 3);
    } });
  const hiddenPanel = new THREE.Group(); hiddenPanel.name = 'GogglesOnlyServiceKeypad'; surveillance.add(hiddenPanel);
  const panelBacking = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.92, 0.08), materials.dark);
  panelBacking.position.set(21.08, 1.42, -9.44); hiddenPanel.add(panelBacking);
  const keypadScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.49, 0.76),
    new THREE.MeshBasicMaterial({ map: keypad.texture, toneMapped: false }));
  keypadScreen.position.set(21.08, 1.42, -9.39); hiddenPanel.add(keypadScreen); hiddenPanel.visible = false;
  const panelPoint = keypadScreen.position.clone(), projected = new THREE.Vector3();
  function panelFocused() {
    if (!hiddenPanel.visible || Math.hypot(player.body.position.x - panelPoint.x, player.body.position.z - panelPoint.z) > 2.4) return false;
    projected.copy(panelPoint).project(camera);
    return projected.z > -1 && projected.z < 1 && Math.hypot(projected.x, projected.y) < 0.27;
  }

  let audioContext: AudioContext | null = null, audioMaster: GainNode | null = null, audioUnavailable = false;
  let rumble: OscillatorNode | null = null, rumbleGain: GainNode | null = null;
  function syncAudio() {
    if (!audioContext || audioContext.state === 'closed') return;
    const settings = getAudioSettings(); audioMaster!.gain.setTargetAtTime(settings.sfx, audioContext.currentTime, 0.03);
    const paused = settings.paused || menuPaused || document.hidden;
    if (paused && audioContext.state === 'running') void audioContext.suspend().catch(error => console.warn('[StageTwo] Sound could not be paused:', error));
    else if (!paused && audioContext.state === 'suspended') void audioContext.resume().catch(error => {
      console.warn('[StageTwo] Sound could not be resumed:', error); tell('Sound effects could not start. Click the game again to enable ship audio.');
    });
  }
  const unsubscribeAudio = subscribeAudioSettings(syncAudio);
  function ensureAudio() {
    if (!audioContext && !audioUnavailable) {
      try {
        if (typeof window.AudioContext !== 'function') throw new Error('Web Audio is unavailable');
        audioContext = new AudioContext(); audioMaster = audioContext.createGain(); audioMaster.connect(audioContext.destination);
      } catch (error) {
        audioUnavailable = true; console.warn('[StageTwo] Ship audio is unavailable:', error);
        tell('Ship sound effects are unavailable in this browser. Visual alarms and stomp captions remain active.');
      }
    }
    syncAudio();
  }
  function playSound(kind: 'alarm' | 'clang' | 'sensor' | 'stomp') {
    if (!audioContext || !audioMaster || menuPaused || document.hidden) return;
    const context = audioContext, start = context.currentTime, duration = kind === 'stomp' ? 0.7 : 0.32;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = kind === 'alarm' ? 'square' : kind === 'stomp' ? 'sine' : 'triangle';
    const frequency = kind === 'stomp' ? 62 : kind === 'alarm' ? 420 : kind === 'sensor' ? 760 : 230;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'stomp' ? 25 : frequency * 0.45, start + duration);
    gain.gain.setValueAtTime(kind === 'stomp' ? 0.65 : 0.075, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain); gain.connect(audioMaster); oscillator.start(); oscillator.stop(start + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    if (kind === 'stomp') {
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.45), context.sampleRate), samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / context.sampleRate * 10);
      const noise = context.createBufferSource(), filter = context.createBiquadFilter(), noiseGain = context.createGain();
      noise.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 420; noiseGain.gain.value = 0.32;
      noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(audioMaster); noise.start();
      noise.onended = () => { noise.disconnect(); filter.disconnect(); noiseGain.disconnect(); };
    }
  }
  function playRobotChatter(index: number) {
    if (!audioContext || !audioMaster || audioContext.state !== 'running') return;
    const context = audioContext, bot = patrol[index], position = bot.root.position;
    const dx = position.x - camera.position.x, dz = position.z - camera.position.z;
    const distance = Math.hypot(dx, dz), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const pan = context.createStereoPanner();
    pan.pan.value = THREE.MathUtils.clamp((dx * right.x + dz * right.z) / Math.max(1, distance), -0.85, 0.85);
    pan.connect(audioMaster);
    const notes = index === 0 ? [830, 510, 970] : [610, 1060, 690, 460];
    notes.forEach((frequency, note) => {
      const start = context.currentTime + note * 0.14, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = note % 2 ? 'triangle' : 'square'; oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.78, start + 0.09);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.045 / (1 + distance * 0.12), start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      oscillator.connect(gain); gain.connect(pan); oscillator.start(start); oscillator.stop(start + 0.11);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (note === notes.length - 1) pan.disconnect(); };
    });
  }
  function stopRumble() { rumble?.stop(); rumble?.disconnect(); rumbleGain?.disconnect(); rumble = null; rumbleGain = null; }
  function startRumble() {
    if (!audioContext || !audioMaster) return;
    stopRumble(); rumble = audioContext.createOscillator(); rumbleGain = audioContext.createGain();
    rumble.type = 'triangle'; rumble.frequency.value = 33; rumbleGain.gain.value = 0.045;
    rumble.connect(rumbleGain); rumbleGain.connect(audioMaster); rumble.start();
  }

  function makeBot(name: 'Enemy_Trilobite' | 'Enemy_QuadShell', x: number, z: number, yaw: number, parent: THREE.Group) {
    const root = new THREE.Group(); root.position.set(x, 0, z); root.rotation.y = yaw; parent.add(root);
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.48) });
    body.position.set(x, 0.64, z); physics.world.addBody(body);
    const actions = new Map<string, THREE.AnimationAction>();
    let mixer: THREE.AnimationMixer | null = null, current = '', dead = false, deadTime = 0, vanishTime = -1;
    const ready = loadToolModel(name).then(gltf => {
      if (disposed) { disposeRoom(gltf.scene); return; }
      const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3());
      const scale = 1.7 / Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(scale) || scale <= 0) { disposeRoom(gltf.scene); throw new Error(`Invalid ${name} model bounds`); }
      const center = bounds.getCenter(new THREE.Vector3()); gltf.scene.scale.multiplyScalar(scale);
      gltf.scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      gltf.scene.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
      root.add(gltf.scene); mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      if (!actions.size) console.warn(`[StageTwo] ${name} has no clips; using scripted robot motion`);
      animate(dead ? 'dead' : 'idle');
    });
    function animate(kind: 'idle' | 'run' | 'dead') {
      const pattern = kind === 'run' ? /run|walk/i : kind === 'dead' ? /death|destroy|dead|die/i : /idle/i;
      const clip = [...actions.keys()].find(key => pattern.test(key));
      if (!clip || current === clip) return;
      actions.get(current)?.fadeOut(0.18); const action = actions.get(clip)!; action.reset().fadeIn(0.18).play(); current = clip;
      if (kind === 'dead') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    }
    return {
      root, body, ready,
      reset(atX: number, atZ: number, facing: number) {
        dead = false; deadTime = 0; vanishTime = -1; root.visible = true; root.scale.setScalar(1);
        root.position.set(atX, 0, atZ); root.rotation.set(0, facing, 0);
        body.position.set(atX, 0.64, atZ); body.aabbNeedsUpdate = true; current = ''; mixer?.stopAllAction();
        if (body.world !== physics.world) physics.world.addBody(body); animate('idle');
      },
      down() { dead = true; deadTime = 0; animate('dead'); if (body.world === physics.world) physics.world.removeBody(body); },
      /** Shrinks the downed body out of the room; `immediate` is used when restoring a cleared room. */
      vanish(immediate = false) {
        if (immediate) { vanishTime = 1; root.visible = false; } else if (vanishTime < 0) vanishTime = 0;
      },
      update(dt: number, running: boolean) {
        if (dead) {
          deadTime += dt;
          if (![...actions.keys()].some(key => /death|destroy|dead|die/i.test(key))) {
            root.rotation.z = Math.min(1.3, deadTime * 1.8); root.position.y = 0.32;
          }
          if (vanishTime >= 0 && root.visible) {
            vanishTime += dt;
            root.scale.setScalar(Math.max(0.001, 1 - THREE.MathUtils.smoothstep(vanishTime, 0, 0.45)));
            if (vanishTime >= 0.45) root.visible = false;
          }
        } else animate(running ? 'run' : 'idle');
        if (root.visible) mixer?.update(dt);
        body.position.set(root.position.x, 0.64, root.position.z); body.aabbNeedsUpdate = true;
      },
      dispose() { mixer?.stopAllAction(); if (body.world === physics.world) physics.world.removeBody(body); },
    };
  }
  // Both robot models face +Z: the patrol pair face each other and the guard faces the monitor wall.
  const patrol = [makeBot('Enemy_Trilobite', -0.8, -24.5, Math.PI / 2, passage),
    makeBot('Enemy_QuadShell', 0.8, -25.3, -Math.PI / 2, passage)];
  const guard = makeBot('Enemy_Trilobite', 18, -6.2, Math.PI, surveillance);
  // The eye light and shot stay in the scene graph so an alert never changes the compiled light set mid-shot.
  const guardEye = new THREE.PointLight(0xff3a24, 0, 6); surveillance.add(guardEye);
  const guardBeamMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a3a, toneMapped: false, transparent: true, opacity: 0, depthWrite: false });
  const guardBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6), guardBeamMaterial);
  guardBeam.name = 'GuardShot'; guardBeam.userData.minimap = false; surveillance.add(guardBeam);
  function hideGuardShot() {
    guardBeamMaterial.opacity = 0; guardBeam.position.set(18, -4, -6.2); guardBeam.scale.setScalar(1);
    guardEye.intensity = 0; guardEye.position.set(18, 1.05, -6.75);
  }
  hideGuardShot();
  let breakables = createBreakables(scene, physics.world);
  function addEscapeCrate(): Breakable {
    const item = breakables.add('StoreroomLadderCrate', 'crowbar', new THREE.Vector3(8, 0.65, -9.5), new THREE.Vector3(1.65, 1.3, 1.4),
      () => {
        progress.crateBroken = true;
        if (phase === 'approach') beginAlarm();
        else { playSound('clang'); tell('Brondon: Ladder is clear.', 3); }
      });
    storage.add(item.root);
    if (progress.crateBroken) breakables.restoreBroken(new Set([item.id]));
    return item;
  }
  let crate = addEscapeCrate();
  const chest = createRewardChest({ scene, world: physics.world, player, position: new THREE.Vector3(4.45, 0, -10.25), yaw: Math.PI,
    reward: 'crowbar', style: 'crew', initialCollected: progress.crowbarCollected, unlocked: () => true,
    canInteract: () => active && !menuPaused && (phase === 'approach' || phase === 'chase'),
    onCollect: () => {
      progress.crowbarCollected = true; options.onCrowbarCollected();
      tell('Brondon: Crowbar. That crate is hiding the ladder.'); return true;
    } }); storage.add(chest.root);
  const ready = Promise.all([chest.ready, chairsReady, guard.ready, ...patrol.map(bot => bot.ready)]).then(() => undefined);

  function checkpoint() { checkpointState = player.captureTransition({ x: 0, y: 0, z: 0 }); }
  function fail(reason: string) {
    if (phase === 'failed' || disposed) return;
    player.takeDamage(player.getHealth() + player.getShield() + 1, true);
    setPhase('failed'); failureTitle.textContent = 'CAUGHT'; failureText.textContent = reason;
    retry.textContent = `R / Retry ${progress.checkpoint === 'surveillance' ? 'silent takedown' : 'storeroom escape'}`;
    caption.classList.add('hidden'); stopRumble(); guardBeamMaterial.opacity = 0;
  }
  /** The guard turns, locks on and fires before the failure screen; any detection in the camera room ends here. */
  function alertGuard(reason: string) {
    if (phase !== 'guard' || guardAlert >= 0 || disposed) return;
    guardAlert = 0; guardAlertReason = reason; player.clearInput(); player.setInputLocked(true);
    prompt?.classList.add('hidden'); ensureAudio(); playSound('alarm');
  }
  const shotFrom = new THREE.Vector3(), shotTo = new THREE.Vector3(), shotAxis = new THREE.Vector3(0, 1, 0);
  function updateGuardAlert(dt: number) {
    guardAlert += dt;
    const root = guard.root, dx = player.body.position.x - root.position.x, dz = player.body.position.z - root.position.z;
    let turn = Math.atan2(dx, dz) - root.rotation.y; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    root.rotation.y += turn * (1 - Math.exp(-dt * 12));
    guardEye.position.set(root.position.x + Math.sin(root.rotation.y) * 0.55, 1.05, root.position.z + Math.cos(root.rotation.y) * 0.55);
    guardEye.intensity = THREE.MathUtils.smoothstep(guardAlert, 0, 0.45) * 9 * (0.75 + Math.sin(guardAlert * 40) * 0.25);
    if (guardAlert >= 0.75 && guardAlert < 0.95) {
      shotFrom.copy(guardEye.position);
      shotTo.set(player.body.position.x, player.body.position.y + 0.35, player.body.position.z).sub(shotFrom);
      const length = Math.max(0.01, shotTo.length());
      guardBeam.position.copy(shotFrom).addScaledVector(shotTo, 0.5); guardBeam.scale.set(1, length, 1);
      guardBeam.quaternion.setFromUnitVectors(shotAxis, shotTo.normalize());
      if (guardBeamMaterial.opacity === 0) playSound('clang');
      guardBeamMaterial.opacity = 0.9;
    }
    if (guardAlert >= 0.95) fail(guardAlertReason);
  }
  function beginAlarm() {
    setPhase('alarm'); playSound('clang'); playSound('alarm');
    tell('Brondon: They heard that! Up the ladder - hold Space!', 4);
  }
  function climb() {
    if (!progress.crateBroken) { tell('Brondon: The crate is blocking the ladder.', 3); return; }
    setPhase('climb'); player.setPosition(8, player.radius, -9.5); player.setRotation(0, 0);
  }
  function enterMaze() {
    closeHatch(); player.setPosition(8, 4 + player.radius, -9.5); player.setRotation(-Math.PI / 2, 0);
    progress.checkpoint = 'vent'; setPhase('maze'); player.setVentMode(true); player.setOverheadMovement(true);
    ventSafe = ventPoint(1, 1, 4 + player.radius); sensorGrace = 2; checkpoint();
    tell('Brondon: Only cross the green sensors.', 4);
  }
  function enterGuardRoom() {
    player.setVentMode(false); player.setForcedCrouch(false); player.setPosition(20, player.radius, -1.5); player.setRotation(0, 0);
    progress.checkpoint = 'surveillance'; guardGrace = 3; guardAlert = -1; hideGuardShot();
    setPhase(progress.guardDown ? 'surveillance' : 'guard'); checkpoint();
    if (!progress.guardDown) {
      player.setForcedCrouch(true);
      tell('Brondon: One guard. Stay low and take him from behind.', 4);
    }
  }
  function restoreCheckpoint() {
    failure.classList.add('hidden'); fade.style.opacity = '0'; captionTime = 0; sensorGrace = 2;
    player.setVentMode(false); player.setForcedCrouch(false); player.setClimbing(false);
    const state = { ...checkpointState, health: checkpointState.health ?? PLAYER_MAX_HEALTH };
    if (progress.checkpoint === 'surveillance') {
      teleportPlayer(player, { x: 20, y: player.radius, z: -1.5 }, 0, state);
      guard.reset(18, -6.2, Math.PI); if (progress.guardDown) { guard.down(); guard.vanish(true); }
      enterGuardRoom();
    } else if (progress.checkpoint === 'vent') {
      teleportPlayer(player, { x: 8, y: 4 + player.radius, z: -9.5 }, -Math.PI / 2, state); enterMaze();
    } else {
      progress.crateBroken = false; progress.checkpoint = 'storeroom';
      breakables.dispose(); breakables = createBreakables(scene, physics.world); crate = addEscapeCrate(); breakables.setHighlighted(scanning);
      patrol[0].reset(-0.8, -24.5, Math.PI / 2); patrol[1].reset(0.8, -25.3, -Math.PI / 2);
      teleportPlayer(player, { x: 5.65, y: player.radius, z: -7.9 }, 0, state);
      setPhase('approach'); tell('Checkpoint: storeroom.', 3);
    }
  }
  function startLift() {
    if (phase !== 'surveillance' || menuPaused || disposed) return;
    ensureAudio(); liftStomp = 0; lastStomp = -10; liftStart.set(player.body.position.x, 0, player.body.position.z);
    Object.assign(liftCues, { press: false, depart: false, line: false, arrive: false });
    setPhase('lift'); caption.classList.add('hidden'); captionTime = 0;
    void options.prepareBay13().catch(error => {
      console.error('[StageTwo] Bay 13 preparation failed:', error);
      if (!disposed) tell('Bay 13 loading was interrupted. The elevator will offer a retry if the connection fails.');
    });
  }
  function turnPlayerTowards(yaw: number, frame: number) {
    const current = player.getState().yaw, delta = Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current));
    player.setRotation(current + delta * (1 - Math.exp(-frame * 9)), 0);
  }
  const LIFT_PANEL = { x: 21.75, z: -12.25 }, LIFT_CENTRE = { x: 23, z: -12.6 };
  /** Scripted ride: press the Bay 13 button, ride down while the warden stomps, then walk out into the dark. */
  function updateLift(frame: number) {
    const r = player.radius;
    if (phaseTime < 1.6) {
      const u = THREE.MathUtils.smoothstep(phaseTime, 0, 1.6);
      player.setPosition(THREE.MathUtils.lerp(liftStart.x, LIFT_PANEL.x, u), r, THREE.MathUtils.lerp(liftStart.z, LIFT_PANEL.z, u));
      turnPlayerTowards(phaseTime < 1.1 ? Math.atan2(liftStart.x - LIFT_PANEL.x, liftStart.z - LIFT_PANEL.z) : Math.PI / 2, frame);
    } else if (phaseTime < 2.6) {
      player.setPosition(LIFT_PANEL.x, r, LIFT_PANEL.z); turnPlayerTowards(Math.PI / 2, frame);
    } else if (phaseTime < 3.6) {
      const u = THREE.MathUtils.smoothstep(phaseTime, 2.6, 3.6);
      player.setPosition(THREE.MathUtils.lerp(LIFT_PANEL.x, LIFT_CENTRE.x, u), r, THREE.MathUtils.lerp(LIFT_PANEL.z, LIFT_CENTRE.z, u));
      turnPlayerTowards(phaseTime < 3.2 ? Math.atan2(LIFT_PANEL.x - LIFT_CENTRE.x, LIFT_PANEL.z - LIFT_CENTRE.z) : 0, frame);
    } else if (phaseTime < 10.4) {
      player.setPosition(LIFT_CENTRE.x, r, LIFT_CENTRE.z); turnPlayerTowards(0, frame);
    } else {
      player.setPosition(LIFT_CENTRE.x, r, THREE.MathUtils.lerp(LIFT_CENTRE.z, -15.3, Math.min(1, (phaseTime - 10.4) / 1.5)));
      turnPlayerTowards(0, frame);
    }
    if (!liftCues.press && phaseTime >= 2) { liftCues.press = true; playSound('clang'); }
    workingButtonMaterial.color.setHex(phaseTime >= 2 && phaseTime < 2.4 ? 0xffffff : 0x72eeaa);
    if (!liftCues.depart && phaseTime >= 2.4) { liftCues.depart = true; startRumble(); }
    if (!liftCues.line && phaseTime >= 3.4) { liftCues.line = true; tell('Prime: Bay 14 is offline. Bay 13 it is.', 3); }
    if (!liftCues.arrive && phaseTime >= 9) { liftCues.arrive = true; stopRumble(); playSound('clang'); }
    const stomps = [6.5, 7.7, 8.7, 9.4];
    if (liftStomp < stomps.length && phaseTime >= stomps[liftStomp]) { playSound('stomp'); lastStomp = phaseTime; liftStomp++; }
    const stompDip = Math.max(0, 1 - (phaseTime - lastStomp) / 0.35);
    const flicker = reducedMotion ? 1 : phaseTime > 3 && phaseTime < 9 && phaseTime % 2.3 < 0.18 ? 0.25 : 1;
    liftLamp.intensity = 13 * flicker * (1 - stompDip * 0.55);
    liftStripMaterial.color.setHex(flicker < 1 || stompDip > 0.5 ? 0x345366 : 0x6ad9e8);
    fade.style.opacity = String(THREE.MathUtils.smoothstep(phaseTime, 11.3, 11.9));
    if (phaseTime >= 11.9) void exitToBay13();
  }
  async function exitToBay13() {
    if (transferPending || disposed) return;
    transferPending = true; setPhase('handoff'); stopRumble(); fade.style.opacity = '1';
    try {
      if (!await options.onExitToBay13(player.captureTransition({ x: 0, y: 0, z: 0 }))) throw new Error('Bay 13 handoff was not completed');
    } catch (error) {
      if (disposed) return;
      console.error('[StageTwo] Service elevator handoff failed:', error);
      setPhase('load-error'); failureTitle.textContent = 'ELEVATOR LINK INTERRUPTED';
      failureText.textContent = 'Bay 13 could not be loaded. Your equipment and elevator checkpoint are safe.';
      retry.textContent = 'R / Retry Bay 13 connection'; fade.style.opacity = '0.65';
    } finally { transferPending = false; }
  }
  async function teleportToFeed() {
    if (transferPending || !transferTarget || disposed) return;
    transferPending = true;
    try {
      if (!await options.onCameraTeleport(transferTarget, player.captureTransition({ x: 0, y: 0, z: 0 }))) throw new Error('Camera transfer was not completed');
    } catch (error) {
      if (!disposed) {
        console.error('[StageTwo] Camera teleport failed:', error); setPhase('surveillance');
        tell('Prime: Link failed. Try that feed again.', 3);
      }
    } finally { transferPending = false; }
  }
  retry.addEventListener('click', () => { if (!menuPaused) { if (phase === 'load-error') void exitToBay13(); else restoreCheckpoint(); } });

  const chasePoint = new THREE.Vector3();
  function updatePatrol(dt: number) {
    const pursuing = phase === 'alarm' || phase === 'chase' || phase === 'climb';
    if ((phase === 'intro' || phase === 'approach') && elapsed >= nextChatter) {
      playRobotChatter(chattingBot); chattingBot = 1 - chattingBot; nextChatter = elapsed + 1.8;
    }
    for (const [index, bot] of patrol.entries()) {
      if (pursuing) {
        const point = bot.root.position;
        if (point.z < -8.5) chasePoint.set(index === 0 ? -0.55 : 0.55, 0, -8);
        else if (point.x < 3.4) chasePoint.set(3.8, 0, -8);
        else chasePoint.set(player.body.position.x, 0, player.body.position.z);
        const dx = chasePoint.x - point.x, dz = chasePoint.z - point.z, distance = Math.hypot(dx, dz);
        if (distance > 0.03) {
          const step = Math.min(distance, dt * STAGE_TWO.chaseSpeed);
          point.x += dx / distance * step; point.z += dz / distance * step; bot.root.rotation.y = Math.atan2(dx, dz);
        }
        if (phase !== 'alarm' && player.body.position.y < 1.8
          && Math.hypot(point.x - player.body.position.x, point.z - player.body.position.z) < 1.08) fail('The patrol caught you. Hold Space to climb faster.');
      }
      bot.update(dt, pursuing);
    }
  }
  function updateMaze(dt: number) {
    sensorGrace = Math.max(0, sensorGrace - dt);
    for (const cell of VENT_SAFE_CELLS) {
      const point = ventPoint(cell.column, cell.row, 4 + player.radius);
      if (Math.hypot(player.body.position.x - point.x, player.body.position.z - point.z) < 0.55) ventSafe.copy(point);
    }
    for (const [index, sensor] of sensors.entries()) {
      const state = ventSensorState(index, elapsed); sensor.position.copy(state.position);
      sensor.material.color.setHex(state.active ? 0xff795e : 0x72eeaa);
      sensor.material.emissive.setHex(state.active ? 0xc32d18 : 0x248549);
      sensorRings[index].material.color.copy(sensor.material.color);
      sensorRings[index].material.opacity = state.active ? 0.24 + Math.sin(elapsed * 4) * 0.07 : 0.14;
      if (state.active && !sensorGrace && Math.hypot(player.body.position.x - sensor.position.x, player.body.position.z - sensor.position.z) < 0.48) {
        teleportPlayer(player, ventSafe, -Math.PI / 2); player.setVentMode(true); player.setOverheadMovement(true);
        sensorGrace = 2.5; playSound('sensor'); tell('Brondon: Spotted. Back to the last pad.', 3);
      }
    }
    if (Math.hypot(player.body.position.x - 20, player.body.position.z + 1.5) < 0.83) {
      setPhase('drop'); player.setVentMode(false); player.setPosition(20, 4 + player.radius, -1.5); player.setRotation(0, 0);
      tell('Brondon: Quietly...', 2.5);
    }
    if (player.body.position.y < 3.2) {
      teleportPlayer(player, ventSafe, -Math.PI / 2); player.setVentMode(true); player.setOverheadMovement(true); sensorGrace = 2.5;
    }
  }
  function updateGuard(dt: number) {
    if (guardAlert >= 0) { updateGuardAlert(dt); return; }
    guardGrace = Math.max(0, guardGrace - dt);
    const dx = player.body.position.x - 18, dz = player.body.position.z + 6.2, distance = Math.hypot(dx, dz);
    if (guardGrace > 0) return;
    if (distance < 5.6 && dz < -0.4 && Math.abs(dx) < -dz * 0.85) alertGuard('The guard saw you. Approach from behind, crouched.');
    else if (distance < 2.7 && player.getState().isMoving && !player.getState().crouching)
      alertGuard('The guard heard you. Crouch before closing in.');
    else if (phaseTime > 45) alertGuard('The guard turned around. Take him down before he looks back.');
  }
  function tryTakedown() {
    if (guardAlert >= 0) return;
    if (!player.getState().crouching || player.body.position.z < -5.75 || Math.abs(player.body.position.x - 18) > 1.5) {
      alertGuard('The guard saw you. Approach from behind, crouched.'); return;
    }
    setPhase('takedown'); player.setPosition(18, player.radius, -5.15); player.setRotation(0, 0);
  }
  function onKey(event: KeyboardEvent) {
    if (!active || disposed || menuPaused || document.hidden || event.repeat || event.defaultPrevented
      || event.ctrlKey || event.altKey || event.metaKey || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    ensureAudio();
    if (inspection.active) return;
    if (event.code === 'KeyR' && (phase === 'failed' || phase === 'load-error')) {
      event.preventDefault(); if (phase === 'load-error') void exitToBay13(); else restoreCheckpoint(); return;
    }
    if (phase === 'climb' && event.code === 'Space') { event.preventDefault(); fastClimb = true; return; }
    if (event.code !== 'KeyE') return;
    if (phase === 'brief') { event.preventDefault(); phaseTime = Math.max(phaseTime, 3.6); return; }
    if ((phase === 'approach' || phase === 'chase') && Math.hypot(player.body.position.x - 8, player.body.position.z + 9.5) < 1.8) {
      event.preventDefault(); event.stopImmediatePropagation(); climb(); return;
    }
    if (phase === 'guard' && Math.hypot(player.body.position.x - 18, player.body.position.z + 6.2) < 2.1) {
      event.preventDefault(); event.stopImmediatePropagation(); tryTakedown(); return;
    }
    if (phase !== 'surveillance') return;
    if (panelFocused()) {
      event.preventDefault(); player.disable(); options.holsterWeapons();
      inspection.open({ screen: keypadScreen, display: keypad, width: 0.49, height: 0.76,
        title: 'Hidden service elevator keypad', pointer: 'hand', onAction: () => {} });
      syncBodyClass(); return;
    }
    const target = options.getCameraTarget();
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.status === 'error') { options.onRetryFeed(target.id); tell(`Prime: Reconnecting ${target.label}.`, 2.5); return; }
    if (target.status !== 'ready') { tell('Prime: Camera still connecting.', 2.5); return; }
    if (!options.hasReturnMarker()) { tell('Prime: Press Q to set a return marker first.', 3); return; }
    transferTarget = target.id; setPhase('teleport'); tell(`Prime: Linking ${target.label}.`, 2);
  }
  function onKeyUp(event: KeyboardEvent) { if (event.code === 'Space') fastClimb = false; }
  function onPointer(event: MouseEvent) {
    if (!active || disposed || menuPaused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, .stage-two-ui, #touch-controls')) return;
    ensureAudio();
    if (event.button === 0 && phase === 'guard' && player.isEnabled() && options.getEquippedWeapon() !== 'unarmed') {
      event.preventDefault(); alertGuard('That was not silent. Holster your weapon and use E from behind.');
    }
  }
  function onVisibility() { fastClimb = false; player.clearInput(); syncAudio(); }
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onPointer, true); window.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onVisibility);

  function initializeCheckpoint() {
    if (progress.checkpoint === 'surveillance') {
      closeHatch(); if (progress.guardDown) { guard.down(); guard.vanish(true); } enterGuardRoom();
    } else if (progress.checkpoint === 'vent') enterMaze();
    else if (progress.checkpoint === 'storeroom') {
      player.setPosition(5.65, player.radius, -7.9); setPhase('approach'); checkpoint();
    } else { player.setPosition(0, player.radius, 4); player.setRotation(0, 0); setPhase('intro'); fade.style.opacity = '1'; }
    if (!active) player.disable();
  }
  function objectiveFor(): string {
    if (phase === 'maze') return 'Reach the camera room. Green sensors are safe.';
    if (phase === 'alarm' || phase === 'chase' || phase === 'climb') return 'Climb the ladder! Hold Space.';
    if (phase === 'guard') return 'Sneak up behind the guard. E: silent takedown.';
    if (phase === 'surveillance') {
      if (progress.elevatorUnlocked) return 'Take the service lift.';
      if (!options.hasReturnMarker()) return 'Q: set a return marker here.';
      if (!progress.lightsaberCollected) return 'Use the camera feeds to teleport. Find a way out.';
      if (!progress.codeRead) return 'Read the archive computer for the lift code.';
      return `Goggles (N) reveal the lift keypad. Code ${SURVEILLANCE_CODE}`;
    }
    if (phase !== 'approach') return '';
    return progress.crowbarCollected ? 'Break the crate. The ladder is behind it.'
      : progress.checkpoint === 'storeroom' ? 'Open the tool chest (E).' : 'Slip into the storeroom on the right.';
  }
  /** Objectives appear briefly when they change and then fade, except urgent or code-bearing ones. */
  function updateObjective(frame = 0) {
    const text = objectiveFor();
    if (text !== objectiveShown) { objectiveShown = text; objectiveTime = 0; objectiveText.textContent = text; }
    else objectiveTime += frame;
    const urgent = phase === 'alarm' || phase === 'chase' || phase === 'climb' || text.includes(SURVEILLANCE_CODE);
    const visible = !!text && !inspection.active && (playable.has(phase) || phase === 'climb' || phase === 'alarm');
    objective.classList.toggle('faded', !visible || (!urgent && objectiveTime > 7));
  }
  function liftWalking() {
    return phase === 'lift' && (phaseTime < 1.6 || phaseTime >= 2.6 && phaseTime < 3.6 || phaseTime >= 10.4);
  }
  function cinematicState(): PlayerState | null {
    if (!inspection.active && playable.has(phase)) return null;
    return { ...player.getState(), isMoving: phase === 'intro' && phaseTime > 0.2 && phaseTime < 2.6 || liftWalking(),
      isOnGround: phase !== 'climb' && phase !== 'drop', climbing: phase === 'climb', jumping: false,
      crouching: phase === 'takedown', sprinting: false,
      actionRequest: null, boxHandling: false, sliding: false };
  }
  function cinematicPose(): CinematicPose | null {
    if (inspection.active) return { clip: 'Idle_Loop', time: elapsed, loop: true };
    if (phase === 'failed') return { clip: 'Death01', time: phaseTime };
    if (phase === 'climb') return { clip: 'Ladder_Climb_Loop', time: (player.body.position.y - player.radius) * 1.1, loop: true };
    if (phase === 'drop') return { clip: phaseTime < 1.4 ? 'Jump_Loop' : 'Jump_Land', time: phaseTime < 1.4 ? phaseTime : phaseTime - 1.4 };
    if (phase === 'takedown') return { clip: 'Interact', time: phaseTime };
    if (phase === 'intro' && phaseTime > 0.2) return { clip: 'Walk_Loop', time: phaseTime - 0.2, loop: true };
    if (phase === 'lift' && phaseTime >= 1.6 && phaseTime < 2.6) return { clip: 'Interact', time: phaseTime - 1.6 };
    if (liftWalking()) return { clip: 'Walk_Loop', time: phaseTime, loop: true };
    return !playable.has(phase) ? { clip: 'Idle_Loop', time: elapsed, loop: true } : null;
  }
  function applyCinematicCamera() {
    if (inspection.active) { inspection.applyCamera(); return; }
    camera.fov = 64;
    const p = player.body.position;
    if (phase === 'intro') {
      // Settles onto the gameplay shoulder framing so control hands over without a cut.
      const settle = THREE.MathUtils.smootherstep(phaseTime, 0.3, 2.6);
      camera.position.set(p.x + THREE.MathUtils.lerp(0.2, 0.7, settle), THREE.MathUtils.lerp(2.35, 1.7, settle), Math.min(p.z + 1.5, 5.5));
      camera.lookAt(p.x + THREE.MathUtils.lerp(0, 0.7, settle), THREE.MathUtils.lerp(0.95, 1.7, settle), p.z - 8);
    }
    else if (phase === 'alarm') { camera.position.set(2.1, 2, -11.3); camera.lookAt(patrol[0].root.position.clone().add(new THREE.Vector3(0, 0.75, 0))); }
    else if (phase === 'climb') {
      const close = THREE.MathUtils.smootherstep(player.body.position.y, 0.5, 1.5);
      camera.position.set(THREE.MathUtils.lerp(6.2, 8.3, close), Math.min(5.12, player.body.position.y + 0.8),
        THREE.MathUtils.lerp(-7.6, -9, close)); camera.lookAt(8, player.body.position.y + 0.6, -10.18);
    }
    else if (phase === 'drop') { camera.position.set(22.1, Math.min(2.5, player.body.position.y + 1), -0.9); camera.lookAt(20, player.body.position.y + 0.5, -1.5); }
    else if (phase === 'takedown') { camera.position.set(20.2, 1.7, -4.25); camera.lookAt(18, 0.9, -5.8); }
    else if (phase === 'brief' || phase === 'teleport') { camera.position.set(20.3, 1.7, -3.4); camera.lookAt(18.7, 1.55, -9.5); }
    else if (phase === 'failed') { camera.position.set(p.x + 2.7, p.y + 2.1, p.z + 2.7); camera.lookAt(p.x, p.y + 0.5, p.z); }
    else {
      const t = phase === 'lift' ? phaseTime : 99;
      const stomp = reducedMotion ? 0 : Math.max(0, 1 - (phaseTime - lastStomp) / 0.6) * 0.09;
      const ride = reducedMotion || t < 2.4 || t > 9 ? 0 : 0.01;
      const sx = Math.sin(elapsed * 43) * (stomp + ride), sy = Math.sin(elapsed * 57 + 1.3) * (stomp + ride);
      if (t < 2.4) { camera.position.set(24.35 + sx, 1.95 + sy, -14.1); camera.lookAt(21.9, 1.15, -11); }
      else if (t < 6.2) { camera.position.set(22.1 + sx, 1.55 + sy, -14.15); camera.lookAt(23.1, 1.45, -12.4); }
      else if (t < 9.7) { camera.position.set(23.05 + sx, 1.58 + sy, -13.75); camera.lookAt(23, 1.5, -12.5); }
      else { camera.position.set(23.65 + sx, 1.85 + sy, -10.5); camera.lookAt(23, 1.1, -15.2); }
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  const ventRay = new THREE.Raycaster(), ventFocus = new THREE.Vector3(), ventBack = new THREE.Vector3();
  const mazeOccluders = maze.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child !== hatch);
  function applyVentCamera() {
    const yaw = player.getState().yaw;
    ventFocus.set(player.body.position.x, 4.65, player.body.position.z);
    ventBack.set(Math.sin(yaw) * 1.5, 0.45, Math.cos(yaw) * 1.5);
    maze.updateWorldMatrix(true, true); ventRay.set(ventFocus, ventBack.clone().normalize()); ventRay.far = ventBack.length();
    const hit = ventRay.intersectObjects(mazeOccluders, false)[0];
    if (hit) ventBack.setLength(Math.max(0.22, hit.distance - 0.15));
    camera.position.copy(ventFocus).add(ventBack); camera.lookAt(ventFocus); camera.fov = 75; camera.updateProjectionMatrix();
  }
  function mapVisibility(visible: THREE.Group[]) {
    const previous = groups.map(group => group.visible); groups.forEach(group => { group.visible = visible.includes(group); });
    return () => groups.forEach((group, index) => { group.visible = previous[index]; });
  }
  function getMinimapState(): MinimapSettings & { position: CANNON.Vec3; yaw: number } {
    if (phase === 'maze') return {
      position: player.body.position, yaw: player.getState().yaw, floor: 4, expanded: true,
      bounds: { minX: 5, maxX: 23, minZ: -12.5, maxZ: 1.5 }, deckLabel: '',
      route: VENT_ROUTE.map(cell => ventPoint(cell.column, cell.row)), goal: { x: 20, z: -1.5, label: '' },
      safePads: VENT_SAFE_CELLS.map(cell => ventPoint(cell.column, cell.row)),
      enemies: sensors.map((sensor, index) => ({ id: VENT_SENSORS[index].id, position: sensor.position,
        kind: 'sensor', alerted: ventSensorState(index, elapsed).active })),
      prepare: () => mapVisibility([maze]),
    };
    const cameraRoom = progress.checkpoint === 'surveillance';
    return { position: player.body.position, yaw: player.getState().yaw, floor: 0,
      bounds: cameraRoom ? { minX: 14.5, maxX: 25.5, minZ: -15, maxZ: 0.5 } : { minX: -2.6, maxX: 9.6, minZ: -28.1, maxZ: 6.1 },
      stairs: cameraRoom ? [] : [{ x: 8, z: -9.5 }],
      enemies: cameraRoom ? progress.guardDown ? [] : [{ id: 'surveillance-guard', position: guard.root.position, yaw: guard.root.rotation.y + Math.PI, range: 5.6 }]
        : patrol.map((bot, index) => ({ id: `passage-patrol-${index}`, position: bot.root.position, yaw: bot.root.rotation.y + Math.PI, alerted: progress.crateBroken })),
      prepare: () => mapVisibility(cameraRoom ? [surveillance, lift] : [passage, storage]),
    };
  }
  initializeCheckpoint(); updateObjective();
  return {
    roomId: 'stage-two', scene, camera, player, physicsWorld: physics.world, ready, cutsceneManager: null,
    requiresRecoveredPistol: true, handlesPlayerDeath: true,
    activate() {
      active = true; ui.classList.remove('hidden'); syncBodyClass();
      if (playable.has(phase)) player.enable();
    },
    getSceneId: () => 'scene1.2',
    getMapSceneId: () => `scene${phase === 'maze' ? 34 : progress.checkpoint === 'surveillance'
      ? player.body.position.z < -9.8 ? 36 : 35 : player.body.position.x > 2.5 ? 33 : 32}`,
    getMapLayout: () => STAGE_TWO_MAP, getMinimapState,
    getMusicTrack: () => phase === 'alarm' || phase === 'chase' || phase === 'climb' ? 'stealth-alert' as const
      : phase === 'lift' || phase === 'handoff' ? 'ship' as const : 'stealth-2' as const,
    getCctvEnabled: () => progress.guardDown && (phase === 'brief' || phase === 'surveillance' || phase === 'teleport'),
    isMazeActive: () => phase === 'maze',
    controlsReady: () => active && !menuPaused && playable.has(phase) && !inspection.active,
    isCinematic: () => !playable.has(phase) || !!inspection.active,
    get ownsWeaponInput() { return !active || !playable.has(phase) || phase === 'maze' || !!inspection.active; },
    getCinematicState: cinematicState, getCinematicPose: cinematicPose, getCinematicDelta: () => lastDelta,
    getCinematicWeapon: () => 'unarmed' as const,
    hideCharacter: () => !!inspection.active,
    hideMinimap: () => !playable.has(phase) || !!inspection.active,
    applyCinematicCamera, applyVentCamera,
    getHologramTransition: () => phase === 'teleport' ? hologramTransitionAt(Math.min(phaseTime, HOLOGRAM_TRANSFER_DURATION)) : null,
    showTeleportMessage: tell,
    setGogglesActive(value: boolean) {
      scanning = value; breakables.setHighlighted(value);
      hiddenPanel.visible = progress.guardDown && (value || !!inspection.active);
    },
    setMenuPaused(value: boolean) { menuPaused = value; fastClimb = false; player.clearInput(); syncAudio(); },
    getDamageTargets(): DamageTarget[] {
      if (phase === 'guard') return [{ root: guard.root, body: guard.body, damage: () => {
        alertGuard('That was not silent. Holster your weapon and use E from behind.'); return false;
      } }];
      if (phase !== 'approach' && phase !== 'chase') return [];
      return crate.broken ? [] : [{ root: crate.root, body: crate.body, damage: (amount, weapon) => {
        if (weapon !== 'crowbar') { tell('Brondon: I need the crowbar for this.', 2.5); return false; }
        return crate.damage(amount, weapon);
      } }];
    },
    onPistolShot() {
      if (phase === 'guard') alertGuard('That was not silent. Holster your weapon and use E from behind.');
      else if (phase === 'approach') beginAlarm();
    },
    updateInteractionFocus() {
      if (!active || menuPaused || inspection.active || !player.isEnabled() || chest.isPromptVisible() || !prompt) return;
      let text = '';
      if ((phase === 'approach' || phase === 'chase') && Math.hypot(player.body.position.x - 8, player.body.position.z + 9.5) < 1.8)
        text = progress.crateBroken ? 'E / Climb - hold Space' : 'The crate is blocking the ladder';
      else if (phase === 'guard' && guardAlert < 0 && Math.hypot(player.body.position.x - 18, player.body.position.z + 6.2) < 2.1)
        text = player.getState().crouching ? 'E / Silent takedown' : 'C / Crouch';
      else if (phase === 'surveillance') {
        if (panelFocused()) text = 'E / Keypad';
        else {
          const target = options.getCameraTarget();
          if (target) text = target.status === 'error' ? `E / Retry ${target.label}`
            : target.status !== 'ready' ? `${target.label} / connecting`
              : options.hasReturnMarker() ? `E / Teleport to ${target.label}` : 'Q / Set a return marker first';
        }
      }
      prompt.textContent = text; prompt.classList.toggle('hidden', !text);
    },
    updatePhysics(dt: number, thirdPerson = true) {
      if (disposed || !active || menuPaused) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0;
      lastDelta = frame; elapsed += frame; phaseTime += frame;
      captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
      if (inspection.active) inspection.update(frame);
      else physics.step(frame, player, thirdPerson);
      breakables.update(frame); chest.update(frame); updatePatrol(frame); guard.update(frame, false); keypad.update(frame);
      hiddenPanel.visible = progress.guardDown && (scanning || !!inspection.active);
      alarmMaterial.emissive.setHex(phase === 'alarm' || phase === 'chase' || phase === 'climb' ? 0xff3920 : 0x000000);
      storeDoor.update(frame, player, phase === 'approach' && storeDoor.near(player)
        || phase === 'alarm' || phase === 'chase' || phase === 'climb');
      frontDoor.update(frame, player, progress.elevatorUnlocked && phase !== 'handoff' && (phase !== 'lift' || phaseTime < 2.1));
      rearDoor.update(frame, player, phase === 'lift' && phaseTime > 9.8 || phase === 'handoff' || phase === 'load-error');
      if (inspection.active) { updateObjective(frame); return; }
      switch (phase) {
        case 'intro':
          fade.style.opacity = String(1 - THREE.MathUtils.smoothstep(phaseTime, 0.1, 1.0));
          player.setRotation(0, 0);
          player.setPosition(0, player.radius, THREE.MathUtils.lerp(4, 1, THREE.MathUtils.clamp((phaseTime - 0.2) / 2.4, 0, 1)));
          if (!introLine && phaseTime >= 1.1) { introLine = true; tell('Brondon: Patrol ahead. Slip into the storeroom on the right.', 4.5); }
          if (phaseTime >= 2.6) { fade.style.opacity = '0'; setPhase('approach'); }
          break;
        case 'approach':
          if (player.body.position.x > 2.8 && progress.checkpoint === 'passage') { progress.checkpoint = 'storeroom'; checkpoint(); }
          if (player.body.position.z < -20.8 && player.body.position.x < 2.5) fail('The patrol spotted you. Slip into the storeroom on the right.');
          break;
        case 'alarm': if (phaseTime >= 1.65) setPhase('chase'); break;
        case 'climb':
          player.setPosition(8, Math.min(4 + player.radius, player.body.position.y + frame * (fastClimb ? STAGE_TWO.fastClimbSpeed : STAGE_TWO.climbSpeed)), -9.5);
          if (player.body.position.y >= 4 + player.radius - 0.001) enterMaze();
          break;
        case 'maze': updateMaze(frame); break;
        case 'drop':
          player.setPosition(20, THREE.MathUtils.lerp(4 + player.radius, player.radius, THREE.MathUtils.smootherstep(phaseTime, 0, 1.4)), -1.5);
          if (phaseTime >= 1.8) enterGuardRoom();
          break;
        case 'guard': updateGuard(frame); break;
        case 'takedown':
          if (phaseTime >= 0.9 && !progress.guardDown) { progress.guardDown = true; guard.down(); }
          if (phaseTime >= 1.5) guard.vanish();
          if (phaseTime >= 2.1) {
            player.setForcedCrouch(false); checkpoint(); setPhase('brief');
            tell('Prime: Use your teleporter. Find a way out of this room.', 4);
          }
          break;
        case 'brief': if (phaseTime >= 3.2) setPhase('surveillance'); break;
        case 'surveillance':
          if (progress.elevatorUnlocked && player.body.position.x > 21.4 && player.body.position.z < -10.1) startLift();
          break;
        case 'teleport': if (phaseTime >= HOLOGRAM_TRANSFER_DURATION) void teleportToFeed(); break;
        case 'lift': updateLift(frame); break;
      }
      if (playable.has(phase) && phase !== 'maze' && player.body.position.y < -3) fail('You fell out of the service deck. Your last local checkpoint is saved.');
      updateObjective(frame);
    },
    dispose() {
      if (disposed) return; disposed = true; active = false;
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onPointer, true); window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onVisibility);
      unsubscribeAudio(); stopRumble();
      if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(error => console.warn('[StageTwo] Audio cleanup failed:', error));
      inspection.dispose(); chest.dispose(); breakables.dispose(); patrol.forEach(bot => bot.dispose()); guard.dispose();
      ui.remove(); prompt?.classList.add('hidden');
      document.body.classList.remove('stage-two-maze', 'quarters-cinematic');
      player.dispose(); physics.dispose(); disposeRoom(scene); sensorMaterial.dispose();
    },
  };
}
