import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel, preloadToolModel } from '../../core/loader.js';
import type { MinimapSettings } from '../../core/renderer.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { createSlidingPortal, disposeRoom, roomBox } from '../../helpers/scene/shipRoom.js';
import { createShipInteriorMaterials, createShipServerRack,
  createShipTerminal, SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import { getAudioSettings, subscribeAudioSettings } from '../../helpers/audio/AudioManager.js';
import { createPlayer, PLAYER_MAX_HEALTH, type PlayerState, type PlayerTransitionState } from '../../scripts/player.js';
import { createRewardChest } from '../../scripts/rewardChest.js';
import { createCorridorMonitor } from '../../helpers/scene/corridorMonitor.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { hologramTransitionAt, HOLOGRAM_TRANSFER_DURATION, type CinematicPose } from '../../scripts/characterManager.js';
import type { DamageTarget } from '../../scripts/pistol.js';
import type { CctvTarget } from '../../scripts/cctv.js';
import type { WeaponId } from '../../scripts/weaponWheel.js';
import { inputHint } from '../../scripts/gamepadInput.js';
import { fitCabinProp } from '../living quarters/furnishings.js';
import { STAGE_TWO, STAGE_TWO_MAP, STAGE_TWO_KEYCARD_ROOMS, VENT_MAZE, VENT_BOUNDS, VENT_START,
  VENT_EXIT, VENT_CENTER, VENT_SENSORS, VENT_SAFE_CELLS, ventPoint, ventSensorState, swipeStageTwoKeycard, collectStageTwoKeycard,
  type CameraRoomId, type StageTwoProgress } from './stageTwoLayout.js';

type Physics = ReturnType<typeof createScenePhysics>;
type Materials = ReturnType<typeof createShipInteriorMaterials>;
type Phase = 'maze' | 'drop' | 'hub-loading' | 'guard' | 'takedown' | 'surveillance'
  | 'swipe' | 'teleport' | 'lift-button' | 'lift' | 'handoff' | 'load-error' | 'failed';
interface StageTwoOptions {
  progress: StageTwoProgress;
  entryState?: PlayerTransitionState;
  deferActivation?: boolean;
  getCameraTarget: () => CctvTarget | null;
  hasReturnMarker: () => boolean;
  getEquippedWeapon: () => WeaponId;
  holsterWeapons: () => void;
  onCrowbarCollected: () => void;
  onRetryFeed: (id: CctvTarget['id']) => void;
  onCameraTeleport: (id: CameraRoomId, state: PlayerTransitionState) => Promise<boolean>;
  onVentDrop: () => Promise<void>;
  prepareBay13: () => Promise<void>;
  onExitToBay13: (state: PlayerTransitionState) => Promise<boolean>;
  onAirlockReturn: (state: PlayerTransitionState) => Promise<boolean>;
  fromAirlock?: boolean;
  modelLoader?: typeof loadToolModel;
  monitorFactory?: typeof createCorridorMonitor;
}

export async function preloadAssets() {
  await Promise.all((['Enemy_Trilobite', 'Prop_Desk_Small', 'Prop_Chair', 'Prop_KeyCard'] as const)
    .map(name => preloadToolModel(name)));
}

function hatchSurface(scene: THREE.Scene, group: THREE.Group, physics: Physics | undefined,
  bounds: [number, number, number, number], y: number, opening: [number, number, number, number], material: THREE.Material) {
  const [left, right, north, south] = bounds, [x, z, width, depth] = opening;
  const a = x - width / 2, b = x + width / 2, c = z - depth / 2, d = z + depth / 2;
  if (!(a > left && b < right && c > north && d < south)) throw new Error('A vent hatch must fit inside its supporting surface');
  for (const [minX, maxX, minZ, maxZ] of [[left, a, north, south], [b, right, north, south], [a, b, north, c], [a, b, d, south]]) {
    const size: [number, number, number] = [maxX - minX, 0.16, maxZ - minZ];
    const at: [number, number, number] = [(minX + maxX) / 2, y, (minZ + maxZ) / 2];
    const mesh = physics ? roomBox(scene, physics, size, at, material)
      : new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at); group.add(mesh); mesh.userData.minimap = false;
  }
}

function buildVentMaze(scene: THREE.Scene, materials: Materials, physics?: Physics) {
  const root = new THREE.Group(); root.name = 'SensorVentMaze'; scene.add(root);
  const walls: THREE.Matrix4[] = [], floors: THREE.Matrix4[] = [], trim: THREE.Matrix4[] = [], strips: THREE.Matrix4[] = [];
  const transform = new THREE.Object3D();
  function instance(list: THREE.Matrix4[], size: [number, number, number], position: [number, number, number], solid = true) {
    transform.position.set(...position); transform.scale.set(...size); transform.updateMatrix(); list.push(transform.matrix.clone());
    if (solid) physics?.addBox({ x: size[0], y: size[1], z: size[2] }, { x: position[0], y: position[1], z: position[2] });
  }
  for (const [row, line] of VENT_MAZE.entries()) for (const [column, cell] of [...line].entries()) {
    const point = ventPoint(column, row);
    if (cell === '#') instance(walls, [2, 1.35, 2], [point.x, 4.675, point.z]);
    else {
      if (cell === 'E') hatchSurface(scene, root, physics, [point.x - 1, point.x + 1, point.z - 1, point.z + 1],
        3.92, [point.x, point.z, 1.25, 1.25], materials.deck);
      else instance(floors, [2, 0.16, 2], [point.x, 3.92, point.z]);
      for (const side of [-1, 1]) {
        if (VENT_MAZE[row]?.[column + side] === '#') {
          instance(trim, [0.025, 0.055, 1.92], [point.x + side * 0.975, 4.16, point.z], false);
          if ((row + column) % 4 === 0) instance(strips, [0.025, 0.035, 0.55], [point.x + side * 0.972, 5.1, point.z], false);
        }
        if (VENT_MAZE[row + side]?.[column] === '#') {
          instance(trim, [1.92, 0.055, 0.025], [point.x, 4.16, point.z + side * 0.975], false);
          if ((row + column) % 4 === 0) instance(strips, [0.55, 0.035, 0.025], [point.x, 5.1, point.z + side * 0.972], false);
        }
      }
    }
  }
  for (const [name, matrices, material] of [
    ['VentWalls', walls, materials.steel], ['VentFloor', floors, materials.deck],
    ['VentWallTrim', trim, materials.trim], ['VentWallLights', strips, materials.cyan],
  ] as const) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, matrices.length);
    mesh.name = name; matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.computeBoundingSphere(); root.add(mesh);
    if (name === 'VentWallTrim' || name === 'VentWallLights') mesh.userData.minimap = false;
  }
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(34, 0.12, 50), materials.dark);
  ceiling.position.set(VENT_CENTER.x, 5.48, VENT_CENTER.z); ceiling.userData.minimap = false; root.add(ceiling);
  physics?.addBox({ x: 34, y: 0.12, z: 50 }, ceiling.position);
  for (const cell of VENT_SAFE_CELLS) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.014, 0.55), materials.cyan);
    pad.position.copy(ventPoint(cell.column, cell.row, 4.015)); root.add(pad);
  }
  const exit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 1.25), materials.cyan);
  exit.position.copy(ventPoint(VENT_EXIT.column, VENT_EXIT.row, 4.015)); exit.position.x -= 0.68; root.add(exit);
  const sensors = VENT_SENSORS.map((sensor, index) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xff795e, emissive: 0xc32d18, emissiveIntensity: 1.8 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), material);
    mesh.name = sensor.id; mesh.position.copy(ventSensorState(index, 0).position); mesh.userData.minimap = false; root.add(mesh);
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24),
      new THREE.MeshBasicMaterial({ color: 0xff795e, transparent: true, opacity: 0.24, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.475; mesh.add(ring);
    return { mesh, ring };
  });
  function update(time: number) {
    sensors.forEach(({ mesh, ring }, index) => {
      const state = ventSensorState(index, time); mesh.position.copy(state.position);
      mesh.material.color.setHex(state.active ? 0xff795e : 0x72eeaa);
      mesh.material.emissive.setHex(state.active ? 0xc32d18 : 0x248549);
      ring.material.color.copy(mesh.material.color); ring.material.opacity = state.active ? 0.24 : 0.12;
    });
  }
  return { root, ceiling, sensors, update };
}

export function createVentFeed() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a121d);
  const maze = buildVentMaze(scene, createShipInteriorMaterials(17, 25)); maze.ceiling.visible = false;
  scene.add(new THREE.HemisphereLight(0xb9d5e9, 0x273342, 2.3));
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
  camera.position.set(VENT_CENTER.x, 38, VENT_BOUNDS.maxZ + 14); camera.lookAt(VENT_CENTER.x, 4, VENT_CENTER.z);
  let elapsed = 0;
  return { scene, camera, update(dt: number) { elapsed += dt; maze.update(elapsed); }, dispose: () => disposeRoom(scene) };
}

export function createScene(options: StageTwoOptions) {
  const { progress, modelLoader = loadToolModel, monitorFactory = createCorridorMonitor } = options;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  scene.fog = new THREE.Fog(0x0a121d, 30, 85);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 120);
  const materials = createShipInteriorMaterials(17, 25); materials.deck.color.setHex(0x3b4c5d);
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.15 });
  const surveillance = new THREE.Group(), lift = new THREE.Group(); scene.add(surveillance, lift);
  surveillance.name = 'SurveillanceHub'; lift.name = 'ServiceElevator';
  const maze = buildVentMaze(scene, materials, physics), groups = [maze.root, surveillance, lift];
  const box = (group: THREE.Group, size: [number, number, number], at: [number, number, number],
    material: THREE.Material = materials.steel, solid = true) => {
    const mesh = roomBox(scene, physics, size, at, material, solid); group.add(mesh); return mesh;
  };
  const room = STAGE_TWO.camera, height = STAGE_TWO.height, { x: liftX, z: liftZ } = STAGE_TWO.elevator;
  box(surveillance, [18, 0.2, 22], [28, -0.1, -53], materials.deck).name = 'SurveillanceFloor';
  box(surveillance, [0.18, height, 22], [room.maxX, height / 2, -53]);
  box(surveillance, [0.18, height, 16], [room.minX, height / 2, -56]);
  box(surveillance, [0.18, height, 2], [room.minX, height / 2, -43]);
  const returnAirlock = createSlidingPortal(scene, physics, { x: room.minX, y: 0, z: -46, yaw: Math.PI / 2 },
    4, height, 'HANGAR AIRLOCK', { doorHeight: 2.65, sign: false });
  surveillance.add(returnAirlock.group);
  box(surveillance, [2, 0.2, 3], [18, -0.1, -46], materials.deck);
  box(surveillance, [18, height, 0.18], [28, height / 2, room.maxZ]);
  for (const x of [22.5, 33.5]) box(surveillance, [7, height, 0.18], [x, height / 2, room.minZ]);
  hatchSurface(scene, surveillance, physics, [room.minX, room.maxX, room.minZ, room.maxZ], height,
    [STAGE_TWO.drop.x, STAGE_TWO.drop.z, 1.25, 1.25], materials.dark);
  for (const x of [21, 35]) {
    const lamp = new THREE.PointLight(0xb6dfec, 24, 22); lamp.position.set(x, 3.25, -52); surveillance.add(lamp);
    box(surveillance, [0.03, 0.055, 18], [x < 28 ? 19.13 : 36.87, 2.65, -53], materials.cyan, false);
    box(surveillance, [0.07, 0.07, 21.5], [x < 28 ? 19.15 : 36.85, 0.17, -53], materials.trim, false);
  }
  for (const z of [-46, -52, -58, -62]) {
    box(surveillance, [17.7, 0.1, 0.18], [28, height - 0.2, z], materials.trim, false).userData.minimap = false;
    box(surveillance, [2.8, 0.04, 0.12], [28, height - 0.12, z], materials.cyan, false);
  }
  for (const [index, x] of [20, 36].entries()) for (const z of [-44.4, -61.5]) {
    const rack = createShipServerRack(materials); rack.name = `SurveillanceServerRack-${index}-${z}`;
    rack.position.set(x, 0, z); rack.rotation.y = x < 28 ? Math.PI / 2 : -Math.PI / 2; surveillance.add(rack);
    physics.addBox({ x: 0.8, y: 2.65, z: 0.86 }, { x, y: 1.325, z });
  }
  const frontDoor = createSlidingPortal(scene, physics, { x: liftX, y: 0, z: room.minZ, yaw: 0 }, 4, height,
    'SERVICE ELEVATOR', { doorHeight: 2.65, sign: false }); surveillance.add(frontDoor.group);
  box(lift, [4, 0.2, 6.8], [liftX, -0.1, liftZ - 1], materials.deck);
  for (const x of [liftX - 2, liftX + 2]) box(lift, [0.18, height, 6.8], [x, height / 2, liftZ - 1]);
  box(lift, [4, 0.16, 6.8], [liftX, height, liftZ - 1], materials.dark).userData.minimap = false;
  const rearZ = liftZ - 2.4;
  const rearDoor = createSlidingPortal(scene, physics, { x: liftX, y: 0, z: rearZ, yaw: 0 }, 4, height,
    'BAY 13', { doorHeight: 2.65, sign: false }); lift.add(rearDoor.group);
  const liftLamp = new THREE.PointLight(0xb6dfec, 16, 8); liftLamp.position.set(liftX, 3.1, liftZ); lift.add(liftLamp);
  const liftStrip = new THREE.MeshBasicMaterial({ color: 0x6ad9e8, toneMapped: false });
  box(lift, [1.8, 0.04, 0.16], [liftX, height - 0.12, liftZ], liftStrip, false);
  const liftButtonPoint = new THREE.Vector3(liftX - 1.82, 1.2, liftZ);
  box(lift, [0.08, 0.62, 1.0], [liftButtonPoint.x - 0.05, liftButtonPoint.y, liftButtonPoint.z], materials.dark, false);
  const liftButtonMaterial = new THREE.MeshBasicMaterial({ color: 0x72eeaa, toneMapped: false });
  const liftButton = new THREE.Mesh(new THREE.CircleGeometry(0.105, 20), liftButtonMaterial);
  liftButton.name = 'Bay13ElevatorButton'; liftButton.rotation.y = Math.PI / 2; liftButton.position.copy(liftButtonPoint); lift.add(liftButton);
  for (const z of [liftZ - 0.35, liftZ - 0.42])
    box(lift, [0.035, 0.19, 0.025], [liftButtonPoint.x + 0.02, 1.2, z], materials.trim, false).rotation.x = 0.35;
  const readerMaterial = new THREE.MeshStandardMaterial({ color: 0xff785e, emissive: 0x8d2019, emissiveIntensity: 1.4 });
  const readerPoint = new THREE.Vector3(STAGE_TWO.reader.x, STAGE_TWO.reader.y, STAGE_TWO.reader.z);
  const reader = box(surveillance, [0.34, 0.58, 0.12], [readerPoint.x, readerPoint.y, readerPoint.z], materials.dark, false);
  reader.name = 'ElevatorKeycardReader';
  box(surveillance, [0.23, 0.035, 0.018], [readerPoint.x, readerPoint.y + 0.14, readerPoint.z + 0.07], readerMaterial, false);
  box(surveillance, [0.27, 0.023, 0.03], [readerPoint.x, readerPoint.y - 0.08, readerPoint.z + 0.07], pale, false);
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.3), new THREE.HemisphereLight(0xb9d5e9, 0x1b2a36, 1.5));

  const start = ventPoint(VENT_START.column, VENT_START.row, STAGE_TWO.ventHeight + PHYSICS.playerRadius);
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: start });
  teleportPlayer(player, start, -Math.PI / 2, options.entryState);
  const playable = new Set<Phase>(['maze', 'guard', 'surveillance', 'lift-button']);
  let phase: Phase = 'maze', phaseTime = 0, elapsed = 0, active = !options.deferActivation, disposed = false, menuPaused = false;
  let lastDelta = 0, captionTime = 0, sensorGrace = 2, guardGrace = 2.5, guardAlert = -1, guardAlertReason = '';
  let transferTarget: CameraRoomId | null = null, transferPending = false, loadError: 'hub' | 'boss' = 'hub';
  let swipeDone = false, swipeResult: 'missing' | 'rejected' | 'accepted' = 'missing';
  let objectiveShown = '', objectiveTime = 0, liftStomp = 0, lastStomp = -10, liftPressed = false, liftArrived = false;
  let checkpointState = player.captureTransition({ x: 0, y: 0, z: 0 });
  const ventSafe = start.clone(), liftStart = new THREE.Vector3(), swipeStart = new THREE.Vector3(), projected = new THREE.Vector3();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ui = document.createElement('section'); ui.className = 'stage-two-ui'; ui.classList.toggle('hidden', !active);
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
  function tell(text: string, seconds = 3) { caption.textContent = text; captionTime = seconds; caption.classList.remove('hidden'); }
  function syncBodyClass() {
    if (!active) return;
    document.body.classList.toggle('stage-two-maze', phase === 'maze');
    document.body.classList.toggle('quarters-cinematic', !playable.has(phase));
  }
  function setPhase(next: Phase) {
    phase = next; phaseTime = 0; player.clearInput(); prompt?.classList.add('hidden');
    player.setClimbing(!playable.has(next)); player.setInputLocked(!playable.has(next));
    if (playable.has(next) && active) player.enable();
    else { options.holsterWeapons(); player.disable(); }
    failure.classList.toggle('hidden', next !== 'failed' && next !== 'load-error'); syncBodyClass();
  }

  const monitors: ReturnType<typeof createCorridorMonitor>[] = [];
  const desksReady = Promise.all([-48, -53, -58].flatMap((z, row) => [22, 25, 31, 34].map(async (x, index) => {
    const [desk, chair] = await Promise.all([modelLoader('Prop_Desk_Small'), modelLoader('Prop_Chair')]);
    if (disposed) { disposeRoom(desk.scene); disposeRoom(chair.scene); return; }
    const size = fitCabinProp(desk.scene, 0.86, 2.55, 1.25);
    desk.scene.name = `SurveillanceDesk-${x}-${z}`; desk.scene.position.add(new THREE.Vector3(x, 0, z)); surveillance.add(desk.scene);
    physics.addBox(size, { x, y: size.y / 2, z });
    const chairSize = fitCabinProp(chair.scene, 1.05, 0.68, 0.8, Math.PI);
    chair.scene.name = `SurveillanceChair-${x}-${z}`;
    chair.scene.position.add(new THREE.Vector3(x, 0, z - 1.3)); surveillance.add(chair.scene);
    physics.addBox(chairSize, { x, y: chairSize.y / 2, z: z - 1.3 });
    const monitor = monitorFactory(row * 4 + index); monitors.push(monitor); await monitor.ready;
    if (disposed) { monitor.dispose(); return; }
    const terminal = createShipTerminal(monitor.texture);
    terminal.root.name = `SurveillanceComputer-${x}-${z}`; terminal.root.position.set(x, 0.9, z); surveillance.add(terminal.root);
    box(surveillance, [0.55, 0.025, 0.21], [x, 0.92, z - 0.32], materials.dark, false);
    if (index === 0 || index === 3) box(surveillance, [0.28, 0.52, 0.5], [x + 0.8, 0.26, z], materials.dark);
  })));
  const heldCard = new THREE.Group(); heldCard.name = 'SwipedKeycard'; heldCard.visible = false; surveillance.add(heldCard);
  const cardReady = modelLoader('Prop_KeyCard').then(gltf => {
    if (disposed) { disposeRoom(gltf.scene); return; }
    fitCabinProp(gltf.scene, 0.3, 0.4, 0.12); heldCard.add(gltf.scene);
  });
  const guardRoot = new THREE.Group(); guardRoot.name = 'SurveillanceDoorGuard';
  guardRoot.position.set(STAGE_TWO.guard.x, 0, STAGE_TWO.guard.z); guardRoot.rotation.y = Math.PI; surveillance.add(guardRoot);
  const guardBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.48) });
  guardBody.position.set(STAGE_TWO.guard.x, 0.64, STAGE_TWO.guard.z); physics.world.addBody(guardBody);
  let guardMixer: THREE.AnimationMixer | null = null, guardDead = false, guardDeathTime = 0;
  let guardIdle: THREE.AnimationAction | null = null, guardDeath: THREE.AnimationAction | null = null;
  const guardReady = modelLoader('Enemy_Trilobite').then(gltf => {
    if (disposed) { disposeRoom(gltf.scene); return; }
    const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3());
    const scale = 1.7 / Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(scale) || scale <= 0) { disposeRoom(gltf.scene); throw new Error('Invalid surveillance guard bounds'); }
    const center = bounds.getCenter(new THREE.Vector3()); gltf.scene.scale.multiplyScalar(scale);
    gltf.scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale); guardRoot.add(gltf.scene);
    guardMixer = new THREE.AnimationMixer(gltf.scene);
    const idle = gltf.animations.find(clip => /idle/i.test(clip.name)), death = gltf.animations.find(clip => /death|destroy|dead|die/i.test(clip.name));
    if (idle) { guardIdle = guardMixer.clipAction(idle); guardIdle.play(); }
    if (death) { guardDeath = guardMixer.clipAction(death).setLoop(THREE.LoopOnce, 1); guardDeath.clampWhenFinished = true; }
    if (!gltf.animations.length) console.warn('[StageTwo] Guard model has no animation clips; using scripted shutdown motion');
  });
  const exitCover = box(maze.root, [1.25, 0.16, 1.25], [STAGE_TWO.drop.x, 3.92, STAGE_TWO.drop.z], materials.trim, false);
  exitCover.name = 'VentExitGrate'; exitCover.visible = !progress.remoteRooms['stage2-vents'].rewardCollected;
  let exitCoverBody = exitCover.visible ? physics.addBox({ x: 1.25, y: 0.16, z: 1.25 }, exitCover.position) : null;
  const ventChest = createRewardChest({ scene, world: physics.world, player,
    position: new THREE.Vector3(STAGE_TWO.ventChest.x, 4, STAGE_TWO.ventChest.z), yaw: Math.PI,
    reward: 'keycard', style: 'crew', initialCollected: progress.remoteRooms['stage2-vents'].rewardCollected,
    unlocked: () => true, canInteract: () => active && !menuPaused && phase === 'maze',
    onCollect: () => {
      collectStageTwoKeycard(progress, 'stage2-vents'); exitCover.visible = false;
      if (exitCoverBody) { physics.world.removeBody(exitCoverBody); exitCoverBody = null; }
      tell('Keycard recovered.'); return true;
    } }, modelLoader);
  maze.root.add(ventChest.root);
  const crowbarChest = createRewardChest({ scene, world: physics.world, player,
    position: new THREE.Vector3(STAGE_TWO.crowbarChest.x, 0, STAGE_TWO.crowbarChest.z), yaw: 0,
    reward: 'crowbar', style: 'crew', initialCollected: progress.crowbarCollected,
    unlocked: () => progress.guardDown, lockedPrompt: 'Take down the door guard first',
    canInteract: () => active && !menuPaused && phase === 'surveillance',
    onCollect: () => { progress.crowbarCollected = true; options.onCrowbarCollected(); tell('Crowbar recovered.'); return true; } }, modelLoader);
  surveillance.add(crowbarChest.root);
  const ready = Promise.all([desksReady, cardReady, guardReady, ventChest.ready, crowbarChest.ready]).then(() => undefined);
  const guardEye = new THREE.PointLight(0xff3a24, 0, 6); surveillance.add(guardEye);
  const guardBeamMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a3a, toneMapped: false, transparent: true, opacity: 0, depthWrite: false });
  const guardBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6), guardBeamMaterial);
  guardBeam.name = 'GuardShot'; guardBeam.userData.minimap = false; surveillance.add(guardBeam);
  function hideGuardShot() { guardBeamMaterial.opacity = 0; guardEye.intensity = 0; }
  function downGuard() {
    if (guardDead) return;
    guardDead = true; guardDeathTime = 0; guardMixer?.stopAllAction(); guardDeath?.reset().play();
    if (guardBody.world === physics.world) physics.world.removeBody(guardBody);
  }
  function resetGuard() {
    guardDead = false; guardDeathTime = 0; guardRoot.visible = true; guardRoot.scale.setScalar(1);
    guardRoot.position.set(STAGE_TWO.guard.x, 0, STAGE_TWO.guard.z); guardRoot.rotation.set(0, Math.PI, 0);
    if (guardBody.world !== physics.world) physics.world.addBody(guardBody);
    guardMixer?.stopAllAction();
    guardIdle?.reset().play();
    hideGuardShot();
  }

  let audioContext: AudioContext | null = null, audioMaster: GainNode | null = null, audioUnavailable = false;
  let rumble: OscillatorNode | null = null, rumbleGain: GainNode | null = null;
  function syncAudio() {
    if (!audioContext || !audioMaster || audioContext.state === 'closed') return;
    const settings = getAudioSettings(); audioMaster.gain.setTargetAtTime(settings.sfx, audioContext.currentTime, 0.03);
    const paused = settings.paused || menuPaused || document.hidden;
    if (paused && audioContext.state === 'running') void audioContext.suspend().catch(error => console.warn('[StageTwo] Sound could not be paused:', error));
    else if (!paused && audioContext.state === 'suspended') void audioContext.resume().catch(error => {
      console.warn('[StageTwo] Sound could not be resumed:', error); tell('Click the game to enable ship audio.');
    });
  }
  const unsubscribeAudio = subscribeAudioSettings(syncAudio);
  function ensureAudio() {
    if (!audioContext && !audioUnavailable) {
      try {
        if (typeof window.AudioContext !== 'function') throw new Error('Web Audio is unavailable');
        audioContext = new window.AudioContext(); audioMaster = audioContext.createGain(); audioMaster.connect(audioContext.destination);
      } catch (error) { audioUnavailable = true; console.warn('[StageTwo] Ship audio is unavailable:', error); tell('Ship audio unavailable; visual alerts remain active.'); }
    }
    syncAudio();
  }
  function playSound(kind: 'alarm' | 'clang' | 'sensor' | 'stomp' | 'accept' | 'reject') {
    if (!audioContext || !audioMaster || menuPaused || document.hidden) return;
    const context = audioContext, startTime = context.currentTime, duration = kind === 'stomp' ? 0.7 : 0.28;
    const oscillator = context.createOscillator(), gain = context.createGain();
    const frequency = kind === 'stomp' ? 62 : kind === 'alarm' ? 420 : kind === 'sensor' ? 760 : kind === 'accept' ? 880 : kind === 'reject' ? 150 : 230;
    oscillator.type = kind === 'alarm' || kind === 'reject' ? 'square' : kind === 'stomp' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(frequency, startTime); oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.45, startTime + duration);
    gain.gain.setValueAtTime(kind === 'stomp' ? 0.6 : 0.07, startTime); gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gain); gain.connect(audioMaster); oscillator.start(); oscillator.stop(startTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function stopRumble() { rumble?.stop(); rumble?.disconnect(); rumbleGain?.disconnect(); rumble = null; rumbleGain = null; }
  function startRumble() {
    if (!audioContext || !audioMaster) return;
    stopRumble(); rumble = audioContext.createOscillator(); rumbleGain = audioContext.createGain();
    rumble.type = 'triangle'; rumble.frequency.value = 33; rumbleGain.gain.value = 0.04;
    rumble.connect(rumbleGain); rumbleGain.connect(audioMaster); rumble.start();
  }
  function checkpoint() { checkpointState = player.captureTransition({ x: 0, y: 0, z: 0 }); }
  function enterMaze() {
    player.setPosition(start.x, start.y, start.z); player.setRotation(-Math.PI / 2, 0);
    progress.checkpoint = 'vent'; setPhase('maze'); player.setVentMode(true); player.setOverheadMovement(true);
    ventSafe.copy(start); sensorGrace = 2; checkpoint();
  }
  function enterGuardRoom() {
    player.setVentMode(false); player.setOverheadMovement(false);
    player.setPosition(options.fromAirlock ? room.minX + 1.15 : STAGE_TWO.drop.x, player.radius,
      options.fromAirlock ? -46 : STAGE_TWO.drop.z); player.setRotation(options.fromAirlock ? -Math.PI / 2 : 0, 0);
    progress.checkpoint = 'surveillance'; guardGrace = 2.5; guardAlert = -1; hideGuardShot();
    if (progress.guardDown) { downGuard(); guardRoot.visible = false; }
    player.setForcedCrouch(!progress.guardDown); setPhase(progress.guardDown ? 'surveillance' : 'guard'); checkpoint();
  }
  function fail(reason: string) {
    if (phase === 'failed' || disposed) return;
    player.takeDamage(player.getHealth() + player.getShield() + 1, true); setPhase('failed');
    failureTitle.textContent = 'CAUGHT'; failureText.textContent = reason; retry.textContent = 'R / Retry silent takedown';
    caption.classList.add('hidden'); stopRumble(); hideGuardShot();
  }
  function restoreCheckpoint() {
    failure.classList.add('hidden'); fade.style.opacity = '0'; captionTime = 0; heldCard.visible = false;
    player.setVentMode(false); player.setForcedCrouch(false); player.setClimbing(false);
    teleportPlayer(player, progress.checkpoint === 'surveillance' ? { ...STAGE_TWO.drop, y: player.radius } : start, 0,
      { ...checkpointState, health: checkpointState.health ?? PLAYER_MAX_HEALTH });
    if (progress.checkpoint === 'surveillance') { resetGuard(); enterGuardRoom(); }
    else enterMaze();
  }
  async function loadHub() {
    if (transferPending || disposed) return;
    transferPending = true; setPhase('hub-loading'); loadError = 'hub';
    try { await options.onVentDrop(); if (!disposed) enterGuardRoom(); }
    catch (error) {
      if (!disposed) {
        console.error('[StageTwo] Surveillance preparation failed:', error); setPhase('load-error');
        failureTitle.textContent = 'CAMERA ROOM LOAD INTERRUPTED';
        failureText.textContent = 'The vent maze is cleared. Retry loading the camera room.'; retry.textContent = 'R / Retry Phase Two';
      }
    } finally { transferPending = false; }
  }
  function alertGuard(reason: string) {
    if (phase !== 'guard' || guardAlert >= 0 || disposed) return;
    guardAlert = 0; guardAlertReason = reason; player.clearInput(); player.setInputLocked(true);
    prompt?.classList.add('hidden'); ensureAudio(); playSound('alarm');
  }
  const shotFrom = new THREE.Vector3(), shotTo = new THREE.Vector3(), shotAxis = new THREE.Vector3(0, 1, 0);
  function updateGuard(dt: number) {
    if (guardAlert >= 0) {
      guardAlert += dt;
      const dx = player.body.position.x - guardRoot.position.x, dz = player.body.position.z - guardRoot.position.z;
      const turn = Math.atan2(Math.sin(Math.atan2(dx, dz) - guardRoot.rotation.y), Math.cos(Math.atan2(dx, dz) - guardRoot.rotation.y));
      guardRoot.rotation.y += turn * (1 - Math.exp(-dt * 12));
      guardEye.position.set(guardRoot.position.x + Math.sin(guardRoot.rotation.y) * 0.55, 1.05,
        guardRoot.position.z + Math.cos(guardRoot.rotation.y) * 0.55);
      guardEye.intensity = 9 * THREE.MathUtils.smoothstep(guardAlert, 0, 0.45);
      if (guardAlert >= 0.75 && guardAlert < 0.95) {
        shotFrom.copy(guardEye.position); shotTo.set(player.body.position.x, player.body.position.y + 0.35, player.body.position.z).sub(shotFrom);
        guardBeam.position.copy(shotFrom).addScaledVector(shotTo, 0.5); guardBeam.scale.set(1, Math.max(0.01, shotTo.length()), 1);
        guardBeam.quaternion.setFromUnitVectors(shotAxis, shotTo.normalize()); guardBeamMaterial.opacity = 0.9;
      }
      if (guardAlert >= 0.95) fail(guardAlertReason);
      return;
    }
    guardGrace = Math.max(0, guardGrace - dt); if (guardGrace > 0) return;
    const dx = player.body.position.x - STAGE_TWO.guard.x, dz = player.body.position.z - STAGE_TWO.guard.z;
    const distance = Math.hypot(dx, dz), front = dx * Math.sin(guardRoot.rotation.y) + dz * Math.cos(guardRoot.rotation.y);
    if (distance < 7 && front > distance * 0.55) alertGuard('Approach the guard from behind, crouched.');
    else if (distance < 3 && player.getState().isMoving && !player.getState().crouching) alertGuard('The guard heard you. Stay crouched.');
  }
  function tryTakedown() {
    if (guardAlert >= 0) return;
    const dx = player.body.position.x - STAGE_TWO.guard.x, dz = player.body.position.z - STAGE_TWO.guard.z;
    if (!player.getState().crouching || dz < 0.35 || Math.abs(dx) > 1.5) { alertGuard('Use E from behind the guard while crouched.'); return; }
    setPhase('takedown'); player.setPosition(STAGE_TWO.guard.x, player.radius, STAGE_TWO.guard.z + 1.05); player.setRotation(0, 0);
  }
  function readerFocused() {
    if (Math.hypot(player.body.position.x - readerPoint.x, player.body.position.z - readerPoint.z) > 2.6) return false;
    projected.copy(readerPoint).project(camera);
    return projected.z > -1 && projected.z < 1 && Math.hypot(projected.x, projected.y) < 0.4;
  }
  function nearLiftDoor() { return frontDoor.near(player) && Math.abs(player.body.position.x - liftX) < 2.6; }
  function nearLiftButton() { return Math.hypot(player.body.position.x - liftButtonPoint.x, player.body.position.z - liftButtonPoint.z) < 2.1; }
  function startSwipe() {
    if (!progress.keycards.length) { tell('Find a keycard in a minigame chest.'); playSound('reject'); return; }
    swipeStart.copy(player.body.position); swipeDone = false; setPhase('swipe');
  }
  function updateSwipe() {
    const u = THREE.MathUtils.smoothstep(phaseTime, 0, 0.4);
    player.setPosition(THREE.MathUtils.lerp(swipeStart.x, readerPoint.x - 0.15, u), player.radius,
      THREE.MathUtils.lerp(swipeStart.z, readerPoint.z + 0.9, u)); player.setRotation(0, 0);
    heldCard.visible = phaseTime > 0.35 && phaseTime < 1.2;
    heldCard.position.set(readerPoint.x, readerPoint.y + THREE.MathUtils.lerp(0.25, -0.2, THREE.MathUtils.smoothstep(phaseTime, 0.45, 1.1)), readerPoint.z + 0.14);
    if (!swipeDone && phaseTime >= 0.85) {
      swipeDone = true; swipeResult = swipeStageTwoKeycard(progress);
      playSound(swipeResult === 'accepted' ? 'accept' : 'reject'); tell(swipeResult === 'accepted' ? 'Access granted.' : 'Keycard rejected. Try another room.');
    }
    if (phaseTime >= 1.45) { heldCard.visible = false; setPhase('surveillance'); }
  }
  function startLift() {
    ensureAudio(); liftStart.copy(player.body.position); liftStomp = 0; lastStomp = -10; liftPressed = liftArrived = false; setPhase('lift');
    void options.prepareBay13().catch(error => {
      console.error('[StageTwo] Bay 13 preparation failed:', error); if (!disposed) tell('Boss stage loading interrupted. Retry is available at the elevator.');
    });
  }
  async function exitToBay13() {
    if (transferPending || disposed) return;
    transferPending = true; loadError = 'boss'; setPhase('handoff'); stopRumble(); fade.style.opacity = '1';
    try { if (!await options.onExitToBay13(player.captureTransition({ x: 0, y: 0, z: 0 }))) throw new Error('Bay 13 handoff was not completed'); }
    catch (error) {
      if (!disposed) {
        console.error('[StageTwo] Elevator handoff failed:', error); setPhase('load-error');
        failureTitle.textContent = 'ELEVATOR LINK INTERRUPTED'; failureText.textContent = 'Your keycards and equipment are safe.';
        retry.textContent = 'R / Retry boss connection'; fade.style.opacity = '0.5';
      }
    } finally { transferPending = false; }
  }
  function updateLift() {
    const panelX = liftX - 1.25;
    if (phaseTime < 1.6) {
      const u = THREE.MathUtils.smoothstep(phaseTime, 0, 1.6);
      player.setPosition(THREE.MathUtils.lerp(liftStart.x, panelX, u), player.radius, THREE.MathUtils.lerp(liftStart.z, liftZ, u));
      player.setRotation(Math.PI / 2, 0);
    } else if (phaseTime < 2.6) { player.setPosition(panelX, player.radius, liftZ); player.setRotation(Math.PI / 2, 0); }
    else if (phaseTime < 3.6) {
      const u = THREE.MathUtils.smoothstep(phaseTime, 2.6, 3.6);
      player.setPosition(THREE.MathUtils.lerp(panelX, liftX, u), player.radius, liftZ); player.setRotation(0, 0);
    } else {
      player.setPosition(liftX, player.radius, phaseTime < 10.4 ? liftZ
        : THREE.MathUtils.lerp(liftZ, rearZ - 0.8, THREE.MathUtils.smoothstep(phaseTime, 10.4, 11.9)));
      player.setRotation(0, 0);
    }
    liftButtonMaterial.color.setHex(phaseTime >= 2 && phaseTime < 2.4 ? 0xffffff : 0x72eeaa);
    if (!liftPressed && phaseTime >= 2) { liftPressed = true; playSound('clang'); }
    if (phaseTime > 2.4 && phaseTime <= 9 && !rumble) startRumble();
    const stomps = [6.5, 7.7, 8.7, 9.4];
    if (liftStomp < stomps.length && phaseTime >= stomps[liftStomp]) { playSound('stomp'); lastStomp = phaseTime; liftStomp++; }
    if (!liftArrived && phaseTime > 9) { liftArrived = true; stopRumble(); playSound('clang'); }
    const flicker = !reducedMotion && phaseTime > 3 && phaseTime < 9 && phaseTime % 2.3 < 0.18 ? 0.25 : 1;
    liftLamp.intensity = 16 * flicker; liftStrip.color.setHex(flicker < 1 ? 0x345366 : 0x6ad9e8);
    fade.style.opacity = String(THREE.MathUtils.smoothstep(phaseTime, 11.3, 11.9));
    if (phaseTime >= 11.9) void exitToBay13();
  }
  async function teleportToFeed() {
    if (transferPending || !transferTarget || disposed) return;
    transferPending = true;
    try { if (!await options.onCameraTeleport(transferTarget, player.captureTransition({ x: 0, y: 0, z: 0 }))) throw new Error('Camera transfer was not completed'); }
    catch (error) {
      if (!disposed) { console.error('[StageTwo] Camera teleport failed:', error); setPhase('surveillance'); tell('Camera link interrupted. Try again.'); }
    } finally { transferPending = false; }
  }
  function retryCheckpoint() {
    if (menuPaused) return;
    if (phase === 'load-error') { if (loadError === 'hub') void loadHub(); else void exitToBay13(); }
    else restoreCheckpoint();
  }
  retry.addEventListener('click', retryCheckpoint);
  function onKey(event: KeyboardEvent) {
    if (!active || disposed || menuPaused || document.hidden || event.repeat || event.defaultPrevented
      || event.ctrlKey || event.altKey || event.metaKey || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    ensureAudio();
    if (event.code === 'KeyR' && (phase === 'failed' || phase === 'load-error')) { event.preventDefault(); retryCheckpoint(); return; }
    if (event.code !== 'KeyE') return;
    if (phase === 'lift-button') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (nearLiftButton()) startLift(); else tell('Move to the Bay 13 button.');
      return;
    }
    if (phase === 'guard' && Math.hypot(player.body.position.x - STAGE_TWO.guard.x, player.body.position.z - STAGE_TWO.guard.z) < 2.1) {
      event.preventDefault(); event.stopImmediatePropagation(); tryTakedown(); return;
    }
    if (phase !== 'surveillance') return;
    if (returnAirlock.near(player)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (transferPending) return;
      transferPending = true; setPhase('handoff');
      void options.onAirlockReturn(player.captureTransition({ x: 0, y: 0, z: 0 })).then(entered => {
        if (!entered) throw new Error('The hangar airlock transfer did not complete');
      }).catch(error => {
        if (!disposed) { console.error('[StageTwo] Hangar return failed:', error); setPhase('surveillance'); tell('Airlock connection interrupted. Try again.'); }
      }).finally(() => { transferPending = false; });
      return;
    }
    if (readerFocused() || nearLiftDoor()) {
      event.preventDefault(); event.stopImmediatePropagation(); if (!progress.elevatorUnlocked) startSwipe(); return;
    }
    const target = options.getCameraTarget(); if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.id === 'stage2-vents' || target.id === 'stage2-prison') { tell('Already cleared.'); return; }
    if (target.status === 'error') { options.onRetryFeed(target.id); tell('Reconnecting camera.'); return; }
    if (target.status !== 'ready') { tell('Camera connecting.'); return; }
    if (!options.hasReturnMarker()) { tell(inputHint('Q: set a return marker here first.')); return; }
    transferTarget = target.id; setPhase('teleport');
  }
  function onPointer(event: MouseEvent) {
    if (!active || disposed || menuPaused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, .stage-two-ui, #touch-controls')) return;
    ensureAudio();
    if (event.button === 0 && phase === 'guard' && player.isEnabled() && options.getEquippedWeapon() !== 'unarmed') {
      event.preventDefault(); alertGuard('That was not silent. Use E from behind the guard.');
    }
  }
  function onVisibility() { player.clearInput(); syncAudio(); }
  window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onPointer, true);
  window.addEventListener('visibilitychange', onVisibility); window.addEventListener('blur', onVisibility);
  function objectiveFor() {
    if (phase === 'maze') return progress.remoteRooms['stage2-vents'].rewardCollected
      ? 'Find the camera-room exit. Green sensors are safe.'
      : 'Find the first keycard chest. Green sensors are safe; blue pads save your progress.';
    if (phase === 'guard') return 'Stay low. E behind the door guard: silent takedown.';
    if (phase === 'lift-button') return 'E: press the Bay 13 button.';
    if (phase !== 'surveillance') return '';
    if (progress.elevatorUnlocked) return 'Elevator unlocked. Walk inside.';
    if (progress.acceptedKeycard) return 'Try the last keycard at the elevator.';
    if (!options.hasReturnMarker()) return 'Q: set a return marker. E on a camera: visit its room.';
    if (!progress.crowbarCollected) return 'Open the camera-room crowbar chest (E).';
    return `Chest keycards: ${progress.keycards.length}/${STAGE_TWO_KEYCARD_ROOMS.length}. T: return to the camera room.`;
  }
  function updateObjective(frame = 0) {
    const text = objectiveFor();
    if (text !== objectiveShown) { objectiveShown = text; objectiveTime = 0; objectiveText.textContent = text; } else objectiveTime += frame;
    objective.classList.toggle('faded', !text || objectiveTime > 8);
  }
  function liftWalking() { return phase === 'lift' && (phaseTime < 1.6 || phaseTime >= 2.6 && phaseTime < 3.6 || phaseTime >= 10.4); }
  function cinematicState(): PlayerState | null {
    if (playable.has(phase)) return null;
    return { ...player.getState(), isMoving: liftWalking(), isOnGround: phase !== 'drop', climbing: false, jumping: false,
      crouching: phase === 'takedown', sprinting: false, actionRequest: null, boxHandling: false, sliding: false };
  }
  function cinematicPose(): CinematicPose | null {
    if (phase === 'failed') return { clip: 'Death01', time: phaseTime };
    if (phase === 'drop') return { clip: phaseTime < 1.2 ? 'Jump_Loop' : 'Jump_Land', time: phaseTime < 1.2 ? phaseTime : phaseTime - 1.2 };
    if (phase === 'takedown') return { clip: 'Silent_Takedown', time: phaseTime };
    if (phase === 'lift' && phaseTime >= 1.6 && phaseTime < 2.6) return { clip: 'Interact', time: phaseTime - 1.6,
      handTargets: { left: new THREE.Vector3(liftX - 1, 0.95, liftZ), right: liftButtonPoint, weight: 0.9 } };
    if (phase === 'swipe') return { clip: 'Interact', time: Math.max(0, phaseTime - 0.3),
      handTargets: { left: new THREE.Vector3(player.body.position.x - 0.3, 0.9, player.body.position.z),
        right: readerPoint, weight: 0.9 } };
    if (liftWalking()) return { clip: 'Walk_Loop', time: phaseTime, loop: true };
    return !playable.has(phase) ? { clip: 'Idle_Loop', time: elapsed, loop: true } : null;
  }
  function applyCinematicCamera() {
    const p = player.body.position; camera.fov = 64;
    if (phase === 'drop') { camera.position.set(STAGE_TWO.drop.x + 2.1, Math.min(3.1, p.y + 1), STAGE_TWO.drop.z + 1); camera.lookAt(p.x, p.y + 0.5, p.z); }
    else if (phase === 'takedown') { camera.position.set(STAGE_TWO.guard.x + 2.2, 1.7, STAGE_TWO.guard.z + 2); camera.lookAt(STAGE_TWO.guard.x, 0.95, STAGE_TWO.guard.z + 0.5); }
    else if (phase === 'swipe') { camera.position.set(readerPoint.x + 1.25, 1.85, readerPoint.z + 2.2); camera.lookAt(readerPoint); }
    else if (phase === 'teleport' || phase === 'hub-loading') { camera.position.set(28, 1.8, -51); camera.lookAt(STAGE_TWO.cameraWall.x, 1.95, STAGE_TWO.cameraWall.z); }
    else if (phase === 'failed') { camera.position.set(p.x + 2.2, p.y + 1.7, p.z + 2.2); camera.lookAt(p.x, p.y + 0.5, p.z); }
    else if (phase === 'lift') {
      const shake = reducedMotion ? 0 : Math.max(0, 1 - (phaseTime - lastStomp) / 0.6) * 0.06;
      const sway = reducedMotion || phaseTime < 2.4 || phaseTime > 9 ? 0 : 0.01;
      const sx = Math.sin(elapsed * 43) * (shake + sway), sy = Math.sin(elapsed * 57) * (shake + sway);
      if (phaseTime < 2.6) { camera.position.set(liftX + 1.35 + sx, 1.95 + sy, liftZ - 1.5); camera.lookAt(liftButtonPoint); }
      else if (phaseTime < 9.7) { camera.position.set(liftX - 0.6 + sx, 1.65 + sy, liftZ - 1.3); camera.lookAt(liftX, 1.45, liftZ + 1.1); }
      else { camera.position.set(liftX + 0.65 + sx, 1.85 + sy, room.minZ - 0.5); camera.lookAt(liftX, 1.1, rearZ - 0.5); }
    } else {
      camera.position.set(p.x + 0.7, 1.75, p.z + 1.4); camera.lookAt(p.x, 1.4, p.z - 3);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  const ventRay = new THREE.Raycaster(), ventFocus = new THREE.Vector3(), ventBack = new THREE.Vector3();
  function applyVentCamera() {
    const yaw = player.getState().yaw; ventFocus.set(player.body.position.x, 4.65, player.body.position.z);
    ventBack.set(Math.sin(yaw) * 1.5, 0.4, Math.cos(yaw) * 1.5);
    maze.root.updateWorldMatrix(true, true); ventRay.set(ventFocus, ventBack.clone().normalize()); ventRay.far = ventBack.length();
    const hit = ventRay.intersectObjects(maze.root.children, false)[0];
    if (hit) ventBack.setLength(Math.max(0.22, hit.distance - 0.15));
    camera.position.copy(ventFocus).add(ventBack); camera.lookAt(ventFocus); camera.fov = 75; camera.updateProjectionMatrix();
  }
  function mapVisibility(visible: THREE.Group[]) {
    const previous = groups.map(group => group.visible); groups.forEach(group => { group.visible = visible.includes(group); });
    return () => groups.forEach((group, index) => { group.visible = previous[index]; });
  }
  function getMinimapState(): MinimapSettings & { position: CANNON.Vec3; yaw: number } {
    if (phase === 'maze' || progress.checkpoint === 'vent') return {
      position: player.body.position, yaw: player.getState().yaw, floor: 4, expanded: true, bounds: VENT_BOUNDS, deckLabel: '',
      goal: progress.remoteRooms['stage2-vents'].rewardCollected ? { ...STAGE_TWO.drop, label: 'EXIT' }
        : { ...STAGE_TWO.ventChest, label: 'CHEST' }, safePads: VENT_SAFE_CELLS.map(cell => ventPoint(cell.column, cell.row)),
      enemies: maze.sensors.map(({ mesh }, index) => ({ id: VENT_SENSORS[index].id, position: mesh.position,
        kind: 'sensor', alerted: ventSensorState(index, elapsed).active })), prepare: () => mapVisibility([maze.root]),
    };
    return { position: player.body.position, yaw: player.getState().yaw, floor: 0,
      bounds: { minX: 18.5, maxX: 37.5, minZ: -70, maxZ: -41.5 }, goal: { x: liftX, z: room.minZ, label: 'ELEVATOR' },
      enemies: progress.guardDown ? [] : [{ id: 'surveillance-guard', position: guardRoot.position, yaw: guardRoot.rotation.y + Math.PI, range: 7 }],
      prepare: () => mapVisibility([surveillance, lift]) };
  }
  if (progress.checkpoint === 'surveillance') enterGuardRoom(); else enterMaze();
  updateObjective();
  return {
    roomId: 'stage-two', scene, camera, player, physicsWorld: physics.world, ready, cutsceneManager: null,
    requiresRecoveredPistol: true, handlesPlayerDeath: true,
    activate() { active = true; ui.classList.remove('hidden'); syncBodyClass(); if (playable.has(phase)) player.enable(); },
    getSceneId: () => 'scene1.2',
    getMapSceneId: () => `scene${progress.checkpoint === 'vent' ? 34 : player.body.position.z < room.minZ ? 36 : 35}`,
    getMapLayout: () => STAGE_TWO_MAP, getMinimapState,
    getMusicTrack: () => guardAlert >= 0 ? 'stealth-alert' as const
      : phase === 'lift' || phase === 'handoff' ? 'ship' as const : 'stealth-2' as const,
    getCctvEnabled: () => progress.checkpoint === 'surveillance',
    getCctvPaused: () => phase === 'takedown',
    isMazeActive: () => phase === 'maze',
    controlsReady: () => active && !menuPaused && playable.has(phase),
    isCinematic: () => !playable.has(phase),
    get ownsWeaponInput() { return !active || !playable.has(phase) || phase === 'maze'; },
    getCinematicState: cinematicState, getCinematicPose: cinematicPose, getCinematicDelta: () => lastDelta,
    getCinematicWeapon: () => 'unarmed' as const,
    hideMinimap: () => !playable.has(phase), applyCinematicCamera, applyVentCamera,
    getHologramTransition: () => phase === 'teleport' ? hologramTransitionAt(Math.min(phaseTime, HOLOGRAM_TRANSFER_DURATION)) : null,
    showTeleportMessage: tell,
    setMenuPaused(value: boolean) { menuPaused = value; player.clearInput(); syncAudio(); },
    getStageState: () => ({ phase, elapsed, ventSafe: ventSafe.clone(), keycards: progress.keycards.length, swipeResult }),
    ventChest, crowbarChest,
    getMonitorFrames: () => monitors.map(monitor => monitor.getFrameIndex()),
    getDamageTargets(): DamageTarget[] {
      return phase === 'guard' ? [{ root: guardRoot, body: guardBody,
        damage: () => { alertGuard('That was not silent. Use E from behind the guard.'); return false; } }] : [];
    },
    onPistolShot() { if (phase === 'guard') alertGuard('That was not silent. Use E from behind the guard.'); },
    updateInteractionFocus() {
      if (!active || menuPaused || !player.isEnabled() || !prompt || ventChest.isPromptVisible() || crowbarChest.isPromptVisible()) return;
      let text = '';
      if (phase === 'guard' && guardAlert < 0 && Math.hypot(player.body.position.x - STAGE_TWO.guard.x, player.body.position.z - STAGE_TWO.guard.z) < 2.1)
        text = 'E / Silent takedown';
      else if (phase === 'lift-button') text = nearLiftButton() ? 'E / Press Bay 13 button' : 'Move to the Bay 13 button';
      else if (phase === 'surveillance') {
        if (returnAirlock.near(player)) text = 'E / Return through hangar airlock';
        else if (readerFocused() || nearLiftDoor()) text = progress.elevatorUnlocked ? 'Walk into the elevator' : 'E / Swipe keycard';
        else {
          const target = options.getCameraTarget();
          if (target) text = target.id === 'stage2-vents' || target.id === 'stage2-prison' ? `${target.label} / Cleared` : target.status === 'error' ? `E / Retry ${target.label}`
            : target.status !== 'ready' ? `${target.label} / connecting` : options.hasReturnMarker() ? `E / Visit ${target.label}` : 'Q / Set a return marker first';
        }
      }
      prompt.textContent = inputHint(text); prompt.classList.toggle('hidden', !text);
    },
    updatePhysics(dt: number, thirdPerson = true) {
      if (disposed || !active || menuPaused) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0;
      lastDelta = frame; elapsed += frame; phaseTime += frame; physics.step(frame, player, thirdPerson); maze.update(elapsed);
      ventChest.update(frame); crowbarChest.update(frame);
      if (phase !== 'takedown') monitors.forEach(monitor => monitor.update(frame));
      captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
      guardMixer?.update(frame);
      if (guardDead && guardRoot.visible) {
        guardDeathTime += frame;
        if (!guardDeath) { guardRoot.rotation.z = Math.min(1.3, guardDeathTime * 1.8); guardRoot.position.y = 0.32; }
        if (guardDeathTime > 0.75) guardRoot.scale.setScalar(Math.max(0.001, 1 - THREE.MathUtils.smoothstep(guardDeathTime, 0.75, 1.25)));
        if (guardDeathTime > 1.25) guardRoot.visible = false;
      }
      returnAirlock.update(frame, player, progress.guardDown && returnAirlock.near(player) && phase === 'surveillance');
      frontDoor.update(frame, player, progress.elevatorUnlocked && (phase !== 'lift' || phaseTime < 2.1) && phase !== 'handoff');
      rearDoor.update(frame, player, phase === 'lift' && phaseTime > 9.8 || phase === 'handoff' || phase === 'load-error' && loadError === 'boss');
      readerMaterial.color.setHex(progress.elevatorUnlocked ? 0x72eeaa : 0xff785e);
      readerMaterial.emissive.setHex(progress.elevatorUnlocked ? 0x248549 : 0x8d2019);
      switch (phase) {
        case 'maze':
          sensorGrace = Math.max(0, sensorGrace - frame);
          for (const cell of VENT_SAFE_CELLS) {
            const point = ventPoint(cell.column, cell.row, 4 + player.radius);
            if (Math.hypot(player.body.position.x - point.x, player.body.position.z - point.z) < 0.55) ventSafe.copy(point);
          }
          if (!sensorGrace && maze.sensors.some(({ mesh }, index) => ventSensorState(index, elapsed).active
            && Math.hypot(player.body.position.x - mesh.position.x, player.body.position.z - mesh.position.z) < 0.48)) {
            teleportPlayer(player, ventSafe, -Math.PI / 2); player.setVentMode(true); player.setOverheadMovement(true);
            sensorGrace = 2.5; playSound('sensor'); tell('Detected. Back to the last checkpoint.');
          }
          if (Math.hypot(player.body.position.x - STAGE_TWO.drop.x, player.body.position.z - STAGE_TWO.drop.z) < 0.55) {
            if (!progress.remoteRooms['stage2-vents'].rewardCollected) {
              teleportPlayer(player, { x: STAGE_TWO.drop.x, y: 4 + player.radius, z: STAGE_TWO.drop.z + 0.85 }, 0);
              player.setVentMode(true); player.setOverheadMovement(true); tell('Find the keycard chest before leaving the vents.'); break;
            }
            setPhase('drop'); player.setVentMode(false); player.setOverheadMovement(false);
            player.setPosition(STAGE_TWO.drop.x, 4 + player.radius, STAGE_TWO.drop.z); player.setRotation(0, 0);
          } else if (player.body.position.y < 3.2) {
            teleportPlayer(player, ventSafe, -Math.PI / 2); player.setVentMode(true); player.setOverheadMovement(true); sensorGrace = 2.5;
          }
          break;
        case 'drop':
          player.setPosition(STAGE_TWO.drop.x, THREE.MathUtils.lerp(4 + player.radius, player.radius,
            THREE.MathUtils.smootherstep(phaseTime, 0, 1.2)), STAGE_TWO.drop.z);
          if (phaseTime >= 1.5) { progress.ventCleared = true; progress.checkpoint = 'surveillance'; void loadHub(); }
          break;
        case 'guard': updateGuard(frame); break;
        case 'takedown':
          if (phaseTime >= 0.8 && !progress.guardDown) { progress.guardDown = true; downGuard(); }
          if (phaseTime >= 2) { player.setForcedCrouch(false); setPhase('surveillance'); checkpoint(); }
          break;
        case 'surveillance':
          if (progress.elevatorUnlocked && frontDoor.open > 0.9 && Math.abs(player.body.position.x - liftX) < 1.55
            && player.body.position.z < room.minZ - 0.35) setPhase('lift-button');
          break;
        case 'lift-button':
          if (player.body.position.z > room.minZ + 0.35) setPhase('surveillance');
          break;
        case 'swipe': updateSwipe(); break;
        case 'teleport': if (phaseTime >= HOLOGRAM_TRANSFER_DURATION) void teleportToFeed(); break;
        case 'lift': updateLift(); break;
      }
      if (playable.has(phase) && phase !== 'maze' && player.body.position.y < -3) fail('You fell off the deck. Retry your camera-room checkpoint.');
      updateObjective(frame);
    },
    dispose() {
      if (disposed) return; disposed = true; active = false;
      window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', onVisibility);
      unsubscribeAudio(); stopRumble(); guardMixer?.stopAllAction();
      ventChest.dispose(); crowbarChest.dispose(); monitors.forEach(monitor => monitor.dispose());
      if (guardBody.world === physics.world) physics.world.removeBody(guardBody);
      if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(error => console.warn('[StageTwo] Audio cleanup failed:', error));
      ui.remove(); prompt?.classList.add('hidden'); document.body.classList.remove('stage-two-maze', 'quarters-cinematic');
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
