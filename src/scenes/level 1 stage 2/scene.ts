import * as THREE from "three";
import * as CANNON from "cannon-es";
import { loadToolModel, preloadToolModel } from "../../core/loader.js";
import type { MinimapSettings } from "../../core/renderer.js";
import {
  createScenePhysics,
  PHYSICS,
} from "../../helpers/physics/scenePhysics.js";
import {
  createSlidingPortal,
  disposeRoom,
  roomBox,
} from "../../scripts/global/shipRoom.js";
import {
  createShipInteriorMaterials,
  createShipServiceDetails,
  createShipServerRack,
  createShipTerminal,
  SHIP_INTERIOR_PALETTE,
} from "../../scripts/global/shipInterior.js";
import {
  getAudioSettings,
  subscribeAudioSettings,
  SFX_MAX_GAIN,
} from "../../helpers/audio/AudioManager.js";
import {
  createPlayer,
  PLAYER_MAX_HEALTH,
  type PlayerState,
  type PlayerTransitionState,
} from "../../scripts/player/player.js";
import { createRewardChest } from "../../scripts/global/rewardChest.js";
import { createCorridorMonitor } from "../../scripts/global/corridorMonitor.js";
import {
  createGreenReturnCrystal,
  teleportPlayer,
} from "../../scripts/global/teleportationDevice.js";
import {
  hologramTransitionAt,
  HOLOGRAM_TRANSFER_DURATION,
  type CinematicPose,
} from "../../scripts/player/characterManager.js";
import type { DamageTarget } from "../../scripts/weapons/pistol.js";
import type { CctvTarget } from "../../scripts/npc/cctv.js";
import {
  inputHint,
  isControllerActive,
} from "../../scripts/player/gamepadInput.js";
import { setInputHint } from "../../scripts/global/inputPrompts.js";
import { popupDuration } from "../../scripts/global/popupTiming.js";
import { fitCabinProp } from "../living quarters/furnishings.js";
import {
  createChairSeating,
  type ChairSeat,
} from "../../scripts/player/chairSeating.js";
import {
  STAGE_TWO,
  STAGE_TWO_MAP,
  VENT_MAZE,
  VENT_BOUNDS,
  VENT_START,
  VENT_EXIT,
  VENT_CENTER,
  VENT_SENSORS,
  VENT_SAFE_CELLS,
  ventPoint,
  ventSensorState,
  swipeStageTwoKeycard,
  collectStageTwoKeycard,
  type CameraRoomId,
  type StageTwoProgress,
} from "./stageTwoLayout.js";

type Physics = ReturnType<typeof createScenePhysics>;
type Materials = ReturnType<typeof createShipInteriorMaterials>;
type Phase =
  | "maze"
  | "drop"
  | "hub-loading"
  | "surveillance"
  | "swipe"
  | "teleport"
  | "lift"
  | "handoff"
  | "load-error"
  | "failed";
interface StageTwoOptions {
  progress: StageTwoProgress;
  entryState?: PlayerTransitionState;
  deferActivation?: boolean;
  developerAccess?: boolean;
  skipCinematics?: boolean;
  getCameraTarget: () => CctvTarget | null;
  holsterWeapons: () => void;
  onCrowbarCollected: () => void;
  onRetryFeed: (id: CctvTarget["id"]) => void;
  onCameraTeleport: (
    id: CameraRoomId,
    state: PlayerTransitionState,
  ) => Promise<boolean>;
  onVentDrop: () => Promise<void>;
  onVentKeycard?: () => void;
  onArcadeComplete?: () => void;
  prepareBay13: () => Promise<void>;
  onExitToBay13: (state: PlayerTransitionState) => Promise<boolean>;
  onAirlockReturn: (state: PlayerTransitionState) => Promise<boolean>;
  fromAirlock?: boolean;
  modelLoader?: typeof loadToolModel;
  monitorFactory?: typeof createCorridorMonitor;
}

export async function preloadAssets() {
  await Promise.all(
    (["Prop_Desk_Small", "Prop_Chair", "Prop_KeyCard"] as const).map((name) =>
      preloadToolModel(name),
    ),
  );
}

function hatchSurface(
  scene: THREE.Scene,
  group: THREE.Group,
  physics: Physics | undefined,
  bounds: [number, number, number, number],
  y: number,
  opening: [number, number, number, number],
  material: THREE.Material,
) {
  const [left, right, north, south] = bounds,
    [x, z, width, depth] = opening;
  const a = x - width / 2,
    b = x + width / 2,
    c = z - depth / 2,
    d = z + depth / 2;
  if (!(a > left && b < right && c > north && d < south))
    throw new Error("A vent hatch must fit inside its supporting surface");
  for (const [minX, maxX, minZ, maxZ] of [
    [left, a, north, south],
    [b, right, north, south],
    [a, b, north, c],
    [a, b, d, south],
  ]) {
    const size: [number, number, number] = [maxX - minX, 0.16, maxZ - minZ];
    const at: [number, number, number] = [
      (minX + maxX) / 2,
      y,
      (minZ + maxZ) / 2,
    ];
    const mesh = physics
      ? roomBox(scene, physics, size, at, material)
      : new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    group.add(mesh);
    mesh.userData.minimap = false;
  }
}

export function createSurveillanceHubSet(
  scene: THREE.Scene,
  physics: Physics,
  materials: Materials,
) {
  const root = new THREE.Group();
  root.name = "SurveillanceHub";
  scene.add(root);
  const room = STAGE_TWO.camera,
    height = STAGE_TWO.height;
  const box = (
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material = materials.steel,
    solid = true,
  ) => {
    const mesh = roomBox(scene, physics, size, at, material, solid);
    root.add(mesh);
    return mesh;
  };
  box([18, 0.2, 22], [28, -0.1, -53], materials.deck).name =
    "SurveillanceFloor";
  box([0.18, height, 22], [room.maxX, height / 2, -53]);
  box([0.18, height, 16], [room.minX, height / 2, -56]);
  box([0.18, height, 2], [room.minX, height / 2, -43]);
  const returnAirlock = createSlidingPortal(
    scene,
    physics,
    { x: room.minX, y: 0, z: -46, yaw: Math.PI / 2 },
    4,
    height,
    "HANGAR AIRLOCK",
    { doorHeight: 2.65, sign: false, landingFloor: false },
  );
  root.add(returnAirlock.group);
  returnAirlock.setLocked(true);
  box([2, 0.2, 3], [18, -0.1, -46], materials.deck);
  box([18, height, 0.18], [28, height / 2, room.maxZ]);
  for (const x of [22.5, 33.5])
    box([7, height, 0.18], [x, height / 2, room.minZ]);
  hatchSurface(
    scene,
    root,
    physics,
    [room.minX, room.maxX, room.minZ, room.maxZ],
    height,
    [STAGE_TWO.drop.x, STAGE_TWO.drop.z, 1.25, 1.25],
    materials.dark,
  );
  for (const x of [21, 35]) {
    const lamp = new THREE.PointLight(0xb6dfec, 24, 22);
    lamp.position.set(x, 3.25, -52);
    root.add(lamp);
    box(
      [0.03, 0.055, 18],
      [x < 28 ? 19.13 : 36.87, 2.65, -53],
      materials.cyan,
      false,
    );
    box(
      [0.07, 0.07, 21.5],
      [x < 28 ? 19.15 : 36.85, 0.17, -53],
      materials.trim,
      false,
    );
  }
  for (const z of [-46, -52, -58, -62]) {
    box(
      [17.7, 0.1, 0.18],
      [28, height - 0.2, z],
      materials.trim,
      false,
    ).userData.minimap = false;
    box([2.8, 0.04, 0.12], [28, height - 0.12, z], materials.cyan, false);
  }
  for (const [index, x] of [20, 36].entries())
    for (const z of [-42.9, -61.5]) {
      const rack = createShipServerRack(materials);
      rack.name = `SurveillanceServerRack-${index}-${z}`;
      rack.position.set(x, 0, z);
      rack.rotation.y = x < 28 ? Math.PI / 2 : -Math.PI / 2;
      root.add(rack);
      physics.addBox({ x: 0.8, y: 2.65, z: 0.86 }, { x, y: 1.325, z });
    }
  const frontDoor = createSlidingPortal(
    scene,
    physics,
    { x: STAGE_TWO.elevator.x, y: 0, z: room.minZ, yaw: 0 },
    4,
    height,
    "SERVICE ELEVATOR",
    { doorHeight: 2.65, sign: false, landingFloor: false },
  );
  root.add(frontDoor.group);
  root.add(createShipServiceDetails({
    width: 18, depth: 22, height, x: 28, z: -53,
    ribs: false, spacing: 5,
    label: "SURVEILLANCE / OPTICAL NETWORK", accent: 0x8ac4db,
  }));
  return { root, returnAirlock, frontDoor };
}

export const SURVEILLANCE_WORKSTATIONS = [
  ...[-49.5, -54.5, -59.5].flatMap((z) =>
    [25, 31].map((x) => ({ x, z, yaw: 0 })),
  ),
  ...[-51, -54.5, -58].map((z) => ({ x: 20.2, z, yaw: -Math.PI / 2 })),
  ...[-47.5, -51, -54.5, -58].map((z) => ({ x: 35.8, z, yaw: Math.PI / 2 })),
  ...[22.5, 33.5].map((x) => ({ x, z: -62.9, yaw: Math.PI })),
];

export function createSurveillanceWorkstation(
  scene: THREE.Scene,
  physics: Physics,
  materials: Materials,
  parent: THREE.Group,
  index: number,
  desk: THREE.Group,
  chair: THREE.Group,
  texture: THREE.Texture,
) {
  const { x, z, yaw } = SURVEILLANCE_WORKSTATIONS[index];
  const station = new THREE.Group();
  station.name = `SurveillanceWorkstation-${index}`;
  station.position.set(x, 0, z);
  station.rotation.y = yaw;
  parent.add(station);
  function collider(
    size: { x: number; y: number; z: number },
    point: THREE.Vector3,
  ) {
    const position = station.localToWorld(point),
      body = physics.addBox(size, position);
    body.quaternion.setFromEuler(0, yaw, 0);
  }
  function box(size: [number, number, number], at: [number, number, number]) {
    const mesh = roomBox(scene, physics, size, at, materials.dark, false);
    station.add(mesh);
  }
  const size = fitCabinProp(desk, 0.86, 2.55, 1.25, Math.PI);
  desk.name = `SurveillanceDesk-${x}-${z}`;
  station.add(desk);
  collider(size, new THREE.Vector3(0, size.y / 2, 0));
  const chairSize = fitCabinProp(chair, 1.05, 0.68, 0.8, Math.PI);
  chair.name = `SurveillanceChair-${x}-${z}`;
  chair.position.z -= 1.3;
  station.add(chair);
  collider(chairSize, new THREE.Vector3(0, chairSize.y / 2, -1.3));
  const terminal = createShipTerminal(texture);
  terminal.root.name = `SurveillanceComputer-${x}-${z}`;
  terminal.root.position.set(0, 0.9, 0);
  station.add(terminal.root);
  box([0.55, 0.025, 0.21], [0, 0.92, -0.32]);
  if (index % 3 === 0) {
    box([0.28, 0.52, 0.5], [0.8, 0.26, 0]);
    collider({ x: 0.28, y: 0.52, z: 0.5 }, new THREE.Vector3(0.8, 0.26, 0));
  }
  return { root: chair, yaw: yaw + Math.PI };
}

function buildVentMaze(
  scene: THREE.Scene,
  materials: Materials,
  physics?: Physics,
) {
  const root = new THREE.Group();
  root.name = "SensorVentMaze";
  scene.add(root);
  const walls: THREE.Matrix4[] = [],
    floors: THREE.Matrix4[] = [],
    trim: THREE.Matrix4[] = [],
    strips: THREE.Matrix4[] = [];
  const transform = new THREE.Object3D();
  function instance(
    list: THREE.Matrix4[],
    size: [number, number, number],
    position: [number, number, number],
    solid = true,
  ) {
    transform.position.set(...position);
    transform.scale.set(...size);
    transform.updateMatrix();
    list.push(transform.matrix.clone());
    if (solid)
      physics?.addBox(
        { x: size[0], y: size[1], z: size[2] },
        { x: position[0], y: position[1], z: position[2] },
      );
  }
  for (const [row, line] of VENT_MAZE.entries())
    for (const [column, cell] of [...line].entries()) {
      const point = ventPoint(column, row);
      if (cell === "#")
        instance(walls, [2, 1.35, 2], [point.x, 4.675, point.z]);
      else {
        if (cell === "E")
          hatchSurface(
            scene,
            root,
            physics,
            [point.x - 1, point.x + 1, point.z - 1, point.z + 1],
            3.92,
            [point.x, point.z, 1.25, 1.25],
            materials.deck,
          );
        else instance(floors, [2, 0.16, 2], [point.x, 3.92, point.z]);
        for (const side of [-1, 1]) {
          if (VENT_MAZE[row]?.[column + side] === "#") {
            instance(
              trim,
              [0.025, 0.055, 1.92],
              [point.x + side * 0.975, 4.16, point.z],
              false,
            );
            if ((row + column) % 4 === 0)
              instance(
                strips,
                [0.025, 0.035, 0.55],
                [point.x + side * 0.972, 5.1, point.z],
                false,
              );
          }
          if (VENT_MAZE[row + side]?.[column] === "#") {
            instance(
              trim,
              [1.92, 0.055, 0.025],
              [point.x, 4.16, point.z + side * 0.975],
              false,
            );
            if ((row + column) % 4 === 0)
              instance(
                strips,
                [0.55, 0.035, 0.025],
                [point.x, 5.1, point.z + side * 0.972],
                false,
              );
          }
        }
      }
    }
  for (const [name, matrices, material] of [
    ["VentWalls", walls, materials.steel],
    ["VentFloor", floors, materials.deck],
    ["VentWallTrim", trim, materials.trim],
    ["VentWallLights", strips, materials.cyan],
  ] as const) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material,
      matrices.length,
    );
    mesh.name = name;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.computeBoundingSphere();
    root.add(mesh);
    if (name === "VentWallTrim" || name === "VentWallLights")
      mesh.userData.minimap = false;
  }
  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(34, 0.12, 50),
    materials.dark,
  );
  ceiling.position.set(VENT_CENTER.x, 5.48, VENT_CENTER.z);
  ceiling.userData.minimap = false;
  root.add(ceiling);
  physics?.addBox({ x: 34, y: 0.12, z: 50 }, ceiling.position);
  for (const cell of VENT_SAFE_CELLS) {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.014, 0.55),
      materials.cyan,
    );
    pad.position.copy(ventPoint(cell.column, cell.row, 4.015));
    root.add(pad);
  }
  const exit = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.035, 1.25),
    materials.cyan,
  );
  exit.position.copy(ventPoint(VENT_EXIT.column, VENT_EXIT.row, 4.015));
  exit.position.x -= 0.68;
  root.add(exit);
  const sensors = VENT_SENSORS.map((sensor, index) => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xff795e,
      emissive: 0xc32d18,
      emissiveIntensity: 1.8,
    });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 12, 8),
      material,
    );
    mesh.name = sensor.id;
    mesh.position.copy(ventSensorState(index, 0).position);
    mesh.userData.minimap = false;
    root.add(mesh);
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(0.48, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff795e,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.475;
    mesh.add(ring);
    return { mesh, ring };
  });
  function update(time: number) {
    sensors.forEach(({ mesh, ring }, index) => {
      const state = ventSensorState(index, time);
      mesh.position.copy(state.position);
      mesh.material.color.setHex(state.active ? 0xff795e : 0x72eeaa);
      mesh.material.emissive.setHex(state.active ? 0xc32d18 : 0x248549);
      ring.material.color.copy(mesh.material.color);
      ring.material.opacity = state.active ? 0.24 : 0.12;
    });
  }
  return { root, ceiling, sensors, update };
}

export function createVentFeed() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a121d);
  const maze = buildVentMaze(scene, createShipInteriorMaterials(17, 25));
  maze.ceiling.visible = false;
  scene.add(new THREE.HemisphereLight(0xb9d5e9, 0x273342, 2.3));
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 120);
  camera.position.set(VENT_CENTER.x, 38, VENT_BOUNDS.maxZ + 14);
  camera.lookAt(VENT_CENTER.x, 4, VENT_CENTER.z);
  let elapsed = 0;
  return {
    scene,
    camera,
    update(dt: number) {
      elapsed += dt;
      maze.update(elapsed);
    },
    dispose: () => disposeRoom(scene),
  };
}

export function createScene(options: StageTwoOptions) {
  const {
    progress,
    modelLoader = loadToolModel,
    monitorFactory = createCorridorMonitor,
  } = options;
  const elevatorAvailable = () =>
    options.developerAccess === true || progress.elevatorUnlocked;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  scene.fog = new THREE.Fog(0x0a121d, 30, 85);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.05,
    120,
  );
  const materials = createShipInteriorMaterials(17, 25, "command");
  materials.deck.color.setHex(0x3b4c5d);
  const pale = new THREE.MeshStandardMaterial({
    color: 0xbfcad0,
    roughness: 0.8,
    metalness: 0.15,
  });
  const {
    root: surveillance,
    returnAirlock,
    frontDoor,
  } = createSurveillanceHubSet(scene, physics, materials);
  progress.airlockUnlocked = false;
  returnAirlock.setLocked(true);
  const lift = new THREE.Group();
  lift.name = "ServiceElevator";
  scene.add(lift);
  const maze = buildVentMaze(scene, materials, physics),
    groups = [maze.root, surveillance, lift];
  const box = (
    group: THREE.Group,
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material = materials.steel,
    solid = true,
  ) => {
    const mesh = roomBox(scene, physics, size, at, material, solid);
    group.add(mesh);
    return mesh;
  };
  const room = STAGE_TWO.camera,
    height = STAGE_TWO.height,
    { x: liftX, z: liftZ } = STAGE_TWO.elevator;
  box(lift, [4, 0.2, 6.8], [liftX, -0.1, liftZ - 1], materials.deck);
  for (const x of [liftX - 2, liftX + 2])
    box(lift, [0.18, height, 6.8], [x, height / 2, liftZ - 1]);
  box(
    lift,
    [4, 0.16, 6.8],
    [liftX, height, liftZ - 1],
    materials.dark,
  ).userData.minimap = false;
  const rearZ = liftZ - 2.4;
  const rearDoor = createSlidingPortal(
    scene,
    physics,
    { x: liftX, y: 0, z: rearZ, yaw: 0 },
    4,
    height,
    "BAY 13",
    { doorHeight: 2.65, sign: false, landingFloor: false },
  );
  lift.add(rearDoor.group);
  const liftLamp = new THREE.PointLight(0xb6dfec, 16, 8);
  liftLamp.position.set(liftX, 3.1, liftZ);
  lift.add(liftLamp);
  const liftStrip = new THREE.MeshBasicMaterial({
    color: 0x6ad9e8,
    toneMapped: false,
  });
  box(lift, [1.8, 0.04, 0.16], [liftX, height - 0.12, liftZ], liftStrip, false);
  const liftButtonPoint = new THREE.Vector3(liftX - 1.82, 1.2, liftZ);
  box(
    lift,
    [0.08, 0.62, 1.0],
    [liftButtonPoint.x - 0.05, liftButtonPoint.y, liftButtonPoint.z],
    materials.dark,
    false,
  );
  const liftButtonMaterial = new THREE.MeshBasicMaterial({
    color: 0x72eeaa,
    toneMapped: false,
  });
  const liftButton = new THREE.Mesh(
    new THREE.CircleGeometry(0.105, 20),
    liftButtonMaterial,
  );
  liftButton.name = "Bay13ElevatorButton";
  liftButton.rotation.y = Math.PI / 2;
  liftButton.position.copy(liftButtonPoint);
  lift.add(liftButton);
  for (const z of [liftZ - 0.35, liftZ - 0.42])
    box(
      lift,
      [0.035, 0.19, 0.025],
      [liftButtonPoint.x + 0.02, 1.2, z],
      materials.trim,
      false,
    ).rotation.x = 0.35;
  const readerMaterial = new THREE.MeshStandardMaterial({
    color: 0xff785e,
    emissive: 0x8d2019,
    emissiveIntensity: 1.4,
  });
  const readerPoint = new THREE.Vector3(
    STAGE_TWO.reader.x,
    STAGE_TWO.reader.y,
    STAGE_TWO.reader.z,
  );
  const reader = box(
    surveillance,
    [0.34, 0.58, 0.12],
    [readerPoint.x, readerPoint.y, readerPoint.z],
    materials.dark,
    false,
  );
  reader.name = "ElevatorKeycardReader";
  box(
    surveillance,
    [0.23, 0.035, 0.018],
    [readerPoint.x, readerPoint.y + 0.14, readerPoint.z + 0.07],
    readerMaterial,
    false,
  );
  box(
    surveillance,
    [0.27, 0.023, 0.03],
    [readerPoint.x, readerPoint.y - 0.08, readerPoint.z + 0.07],
    pale,
    false,
  );
  scene.add(
    new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.3),
    new THREE.HemisphereLight(0xb9d5e9, 0x1b2a36, 1.5),
  );
  // Teleport crystal dangling from the surveillance room ceiling.
  const hangingCrystal = createGreenReturnCrystal();
  hangingCrystal.scale.setScalar(1.6);
  hangingCrystal.position.set(28, height - 1.3, -56);
  const crystalCord = box(
    surveillance,
    [0.03, 1.2, 0.03],
    [28, height - 0.6, -56],
    materials.dark,
    false,
  );
  crystalCord.userData.minimap = false;
  const crystalGlow = new THREE.PointLight(0x58ff9a, 8, 7);
  crystalGlow.position.set(28, height - 1.3, -56);
  surveillance.add(hangingCrystal, crystalGlow);

  const start = ventPoint(
    VENT_START.column,
    VENT_START.row,
    STAGE_TWO.ventHeight + PHYSICS.playerRadius,
  );
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: start,
  });
  teleportPlayer(player, start, -Math.PI / 2, options.entryState);
  const playable = new Set<Phase>(["maze", "surveillance"]);
  let phase: Phase = "maze",
    phaseTime = 0,
    elapsed = 0,
    active = !options.deferActivation,
    disposed = false,
    menuPaused = false;
  let lastDelta = 0,
    captionTime = 0,
    sensorGrace = 2;
  let transferTarget: CameraRoomId | null = null,
    transferPending = false,
    loadError: "hub" | "boss" = "hub";
  let swipeDone = false,
    swipeResult: "missing" | "rejected" | "accepted" = "missing";
  let objectiveShown = "",
    objectiveTime = 0,
    liftStomp = 0,
    lastStomp = -10,
    liftPressed = false,
    liftArrived = false;
  let arrivalRemarkPending = false,
    crystalRemarked = false;
  let checkpointState = player.captureTransition({ x: 0, y: 0, z: 0 });
  const ventSafe = start.clone(),
    liftStart = new THREE.Vector3(),
    swipeStart = new THREE.Vector3(),
    liftCameraStart = new THREE.Vector3(),
    liftCameraTarget = new THREE.Vector3(),
    liftCameraStartRotation = new THREE.Quaternion(),
    liftCameraTargetRotation = new THREE.Quaternion(),
    projected = new THREE.Vector3();
  let swipeStartYaw = 0,
    liftStartYaw = 0,
    liftCameraStartFov = camera.fov;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const ui = document.createElement("section");
  ui.className = "stage-two-ui";
  ui.classList.toggle("hidden", !active);
  const objective = document.createElement("div");
  objective.className = "stage-two-objective faded";
  const objectiveText = document.createElement("span");
  objective.append(objectiveText);
  const caption = document.createElement("div");
  caption.className = "stage-two-dialogue hidden";
  caption.setAttribute("role", "status");
  const failure = document.createElement("div");
  failure.className = "stage-two-failure hidden";
  const failureTitle = document.createElement("strong"),
    failureText = document.createElement("p");
  const retry = document.createElement("button");
  retry.type = "button";
  setInputHint(retry, "R / Retry checkpoint");
  failure.append(failureTitle, failureText, retry);
  const fade = document.createElement("div");
  fade.className = "stage-two-transition";
  fade.setAttribute("aria-hidden", "true");
  ui.append(objective, caption, failure, fade);
  document.body.append(ui);
  const prompt = document.getElementById("interact-prompt");
  const chairs: ChairSeat[] = [];
  const seating = createChairSeating({
    scene,
    camera,
    player,
    prompt,
    chairs: () => chairs,
    canInteract: () =>
      active &&
      !disposed &&
      !menuPaused &&
      phase === "surveillance" &&
      !options.skipCinematics &&
      !transferPending,
  });
  function tell(text: string, seconds = 3, primeHint = /^Prime:/i.test(text)) {
    setInputHint(caption, text, "foot", true, primeHint);
    captionTime = popupDuration(seconds);
    caption.classList.remove("hidden");
  }
  function syncBodyClass() {
    if (!active) return;
    document.body.classList.toggle("stage-two-maze", phase === "maze");
    document.body.classList.toggle("quarters-cinematic", !playable.has(phase));
  }
  function setPhase(next: Phase) {
    phase = next;
    phaseTime = 0;
    objective.classList.toggle("hidden", next !== "maze");
    player.clearInput();
    prompt?.classList.add("hidden");
    player.setClimbing(!playable.has(next));
    player.setInputLocked(!playable.has(next));
    if (playable.has(next) && active) player.enable();
    else {
      options.holsterWeapons();
      player.disable();
    }
    failure.classList.toggle(
      "hidden",
      next !== "failed" && next !== "load-error",
    );
    syncBodyClass();
  }

  const monitors: ReturnType<typeof createCorridorMonitor>[] = [];
  const desksReady = Promise.all(
    SURVEILLANCE_WORKSTATIONS.map(async (_, index) => {
      const [desk, chair] = await Promise.all([
        modelLoader("Prop_Desk_Small"),
        modelLoader("Prop_Chair"),
      ]);
      if (disposed) {
        disposeRoom(desk.scene);
        disposeRoom(chair.scene);
        return;
      }
      const monitor = monitorFactory(index);
      monitors.push(monitor);
      chairs.push(
        createSurveillanceWorkstation(
          scene,
          physics,
          materials,
          surveillance,
          index,
          desk.scene,
          chair.scene,
          monitor.texture,
        ),
      );
      await monitor.ready;
      if (disposed) {
        monitor.dispose();
        return;
      }
    }),
  );
  const heldCard = new THREE.Group();
  heldCard.name = "SwipedKeycard";
  heldCard.visible = false;
  surveillance.add(heldCard);
  const cardReady = modelLoader("Prop_KeyCard").then((gltf) => {
    if (disposed) {
      disposeRoom(gltf.scene);
      return;
    }
    fitCabinProp(gltf.scene, 0.3, 0.4, 0.12);
    heldCard.add(gltf.scene);
  });
  const exitCover = box(
    maze.root,
    [1.25, 0.16, 1.25],
    [STAGE_TWO.drop.x, 3.92, STAGE_TWO.drop.z],
    materials.trim,
    false,
  );
  exitCover.name = "VentExitGrate";
  exitCover.visible = !progress.remoteRooms["stage2-vents"].rewardCollected;
  let exitCoverBody = exitCover.visible
    ? physics.addBox({ x: 1.25, y: 0.16, z: 1.25 }, exitCover.position)
    : null;
  const ventChest = createRewardChest(
    {
      scene,
      world: physics.world,
      player,
      position: new THREE.Vector3(
        STAGE_TWO.ventChest.x,
        4,
        STAGE_TWO.ventChest.z,
      ),
      yaw: 0,
      reward: "keycard",
      style: "crew",
      initialCollected: progress.remoteRooms["stage2-vents"].rewardCollected,
      unlocked: () => true,
      canInteract: () => active && !menuPaused && phase === "maze",
      onCollect: () => {
        collectStageTwoKeycard(progress, "stage2-vents");
        exitCover.visible = false;
        if (exitCoverBody) {
          physics.world.removeBody(exitCoverBody);
          exitCoverBody = null;
        }
        tell("Keycard recovered.");
        options.onVentKeycard?.();
        return true;
      },
    },
    modelLoader,
  );
  maze.root.add(ventChest.root);
  const crowbarChest = createRewardChest(
    {
      scene,
      world: physics.world,
      player,
      position: new THREE.Vector3(
        STAGE_TWO.crowbarChest.x,
        0,
        STAGE_TWO.crowbarChest.z,
      ),
      yaw: Math.PI,
      reward: "crowbar",
      style: "crew",
      initialCollected: progress.crowbarCollected,
      unlocked: () => true,
      canInteract: () => active && !menuPaused && phase === "surveillance",
      onCollect: () => {
        progress.crowbarCollected = true;
        options.onCrowbarCollected();
        tell("Crowbar recovered.");
        return true;
      },
    },
    modelLoader,
  );
  surveillance.add(crowbarChest.root);
  const ready = Promise.all([
    desksReady,
    cardReady,
    ventChest.ready,
    crowbarChest.ready,
  ]).then(() => undefined);

  let audioContext: AudioContext | null = null,
    audioMaster: GainNode | null = null,
    audioUnavailable = false;
  let rumble: OscillatorNode | null = null,
    rumbleGain: GainNode | null = null;
  function syncAudio() {
    if (!audioContext || !audioMaster || audioContext.state === "closed")
      return;
    const settings = getAudioSettings();
    audioMaster.gain.setTargetAtTime(
      settings.sfx * SFX_MAX_GAIN,
      audioContext.currentTime,
      0.03,
    );
    const paused = settings.paused || menuPaused || document.hidden;
    if (paused && audioContext.state === "running")
      void audioContext
        .suspend()
        .catch((error) =>
          console.warn("[StageTwo] Sound could not be paused:", error),
        );
    else if (!paused && audioContext.state === "suspended")
      void audioContext.resume().catch((error) => {
        console.warn("[StageTwo] Sound could not be resumed:", error);
        tell("Click the game to enable ship audio.");
      });
  }
  const unsubscribeAudio = subscribeAudioSettings(syncAudio);
  function ensureAudio() {
    if (!audioContext && !audioUnavailable) {
      try {
        if (typeof window.AudioContext !== "function")
          throw new Error("Web Audio is unavailable");
        audioContext = new window.AudioContext();
        audioMaster = audioContext.createGain();
        audioMaster.connect(audioContext.destination);
      } catch (error) {
        audioUnavailable = true;
        console.warn("[StageTwo] Ship audio is unavailable:", error);
        tell("Ship audio unavailable; visual alerts remain active.");
      }
    }
    syncAudio();
  }
  function playSound(
    kind: "alarm" | "clang" | "sensor" | "stomp" | "accept" | "reject",
  ) {
    if (!audioContext || !audioMaster || menuPaused || document.hidden) return;
    const context = audioContext,
      startTime = context.currentTime,
      duration = kind === "stomp" ? 0.7 : 0.28;
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    const frequency =
      kind === "stomp"
        ? 62
        : kind === "alarm"
          ? 420
          : kind === "sensor"
            ? 760
            : kind === "accept"
              ? 880
              : kind === "reject"
                ? 150
                : 230;
    oscillator.type =
      kind === "alarm" || kind === "reject"
        ? "square"
        : kind === "stomp"
          ? "sine"
          : "triangle";
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * 0.45,
      startTime + duration,
    );
    gain.gain.setValueAtTime(kind === "stomp" ? 0.2 : 0.05, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gain);
    gain.connect(audioMaster);
    oscillator.start();
    oscillator.stop(startTime + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  function stopRumble() {
    rumble?.stop();
    rumble?.disconnect();
    rumbleGain?.disconnect();
    rumble = null;
    rumbleGain = null;
  }
  function startRumble() {
    if (!audioContext || !audioMaster) return;
    stopRumble();
    rumble = audioContext.createOscillator();
    rumbleGain = audioContext.createGain();
    rumble.type = "triangle";
    rumble.frequency.value = 33;
    rumbleGain.gain.value = 0.04;
    rumble.connect(rumbleGain);
    rumbleGain.connect(audioMaster);
    rumble.start();
  }
  function checkpoint() {
    checkpointState = player.captureTransition({ x: 0, y: 0, z: 0 });
  }
  function enterMaze() {
    player.setPosition(start.x, start.y, start.z);
    player.setRotation(-Math.PI / 2, 0);
    progress.checkpoint = "vent";
    setPhase("maze");
    player.setVentMode(true);
    player.setOverheadMovement(true);
    ventSafe.copy(start);
    sensorGrace = 2;
    checkpoint();
  }
  function enterSurveillance() {
    player.setVentMode(false);
    player.setOverheadMovement(false);
    player.setPosition(
      options.fromAirlock ? room.minX + 1.15 : STAGE_TWO.drop.x,
      player.radius,
      options.fromAirlock ? -46 : STAGE_TWO.drop.z,
    );
    player.setRotation(options.fromAirlock ? -Math.PI / 2 : 0, 0);
    progress.checkpoint = "surveillance";
    progress.guardDown = true;
    player.setForcedCrouch(false);
    setPhase("surveillance");
    checkpoint();
    if (arrivalRemarkPending) {
      arrivalRemarkPending = false;
      tell(
        "Prime: Security seems kind of lacklustre. I wonder what's going on.",
        7,
      );
    }
  }
  function fail(reason: string) {
    if (phase === "failed" || disposed) return;
    player.takeDamage(player.getHealth() + player.getShield() + 1, true);
    setPhase("failed");
    failureTitle.textContent = "CAUGHT";
    failureText.textContent = reason;
    setInputHint(retry, "R / Retry checkpoint");
    caption.classList.add("hidden");
    stopRumble();
  }
  function restoreCheckpoint() {
    failure.classList.add("hidden");
    fade.style.opacity = "0";
    captionTime = 0;
    heldCard.visible = false;
    player.setVentMode(false);
    player.setForcedCrouch(false);
    player.setClimbing(false);
    teleportPlayer(
      player,
      progress.checkpoint === "surveillance"
        ? { ...STAGE_TWO.drop, y: player.radius }
        : start,
      0,
      {
        ...checkpointState,
        health: checkpointState.health ?? PLAYER_MAX_HEALTH,
      },
    );
    if (progress.checkpoint === "surveillance") enterSurveillance();
    else enterMaze();
  }
  async function loadHub() {
    if (transferPending || disposed) return;
    transferPending = true;
    setPhase("hub-loading");
    loadError = "hub";
    try {
      await options.onVentDrop();
      if (!disposed) enterSurveillance();
    } catch (error) {
      if (!disposed) {
        console.error("[StageTwo] Surveillance preparation failed:", error);
        setPhase("load-error");
        failureTitle.textContent = "CAMERA ROOM LOAD INTERRUPTED";
        failureText.textContent =
          "The vent maze is cleared. Retry loading the camera room.";
        setInputHint(retry, "R / Retry Phase Two");
      }
    } finally {
      transferPending = false;
    }
  }
  function readerFocused() {
    if (
      Math.hypot(
        player.body.position.x - readerPoint.x,
        player.body.position.z - readerPoint.z,
      ) > 2.6
    )
      return false;
    projected.copy(readerPoint).project(camera);
    return (
      projected.z > -1 &&
      projected.z < 1 &&
      Math.hypot(projected.x, projected.y) < 0.4
    );
  }
  function nearLiftDoor() {
    return (
      frontDoor.near(player) && Math.abs(player.body.position.x - liftX) < 2.6
    );
  }
  const SWIPE_APPROACH_SECONDS = 0.8;
  const SWIPE_ACTION_SECONDS = 1.05;
  function turnPlayer(from: number, to: number, amount: number) {
    const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    player.setRotation(from + difference * amount, 0);
  }
  function startSwipe() {
    if (!progress.keycards.length && !options.developerAccess) {
      tell("Find a keycard in a minigame chest.");
      playSound("reject");
      return;
    }
    swipeStart.copy(player.body.position);
    swipeStartYaw = player.getState().yaw;
    swipeDone = false;
    swipeResult = "missing";
    if (options.skipCinematics) {
      swipeResult = options.developerAccess ? "accepted" : swipeStageTwoKeycard(progress);
      playSound(swipeResult === "accepted" ? "accept" : "reject");
      if (swipeResult === "accepted") {
        if (options.onArcadeComplete) {
          setPhase("handoff");
          options.onArcadeComplete();
        } else startLift();
      } else tell("Keycard rejected. Try another room.");
      return;
    }
    setPhase("swipe");
  }
  function updateSwipe() {
    const u = THREE.MathUtils.smootherstep(
      phaseTime,
      0,
      SWIPE_APPROACH_SECONDS,
    );
    const standX = readerPoint.x - 0.15,
      standZ = readerPoint.z + 0.9;
    const approachYaw = Math.atan2(
      swipeStart.x - standX,
      swipeStart.z - standZ,
    );
    const actionTime = phaseTime - SWIPE_APPROACH_SECONDS;
    player.setPosition(
      THREE.MathUtils.lerp(swipeStart.x, standX, u),
      player.radius,
      THREE.MathUtils.lerp(swipeStart.z, standZ, u),
    );
    if (actionTime < 0) {
      turnPlayer(
        swipeStartYaw,
        approachYaw,
        THREE.MathUtils.smootherstep(phaseTime, 0, 0.25),
      );
    } else {
      turnPlayer(
        approachYaw,
        Math.atan2(standX - readerPoint.x, standZ - readerPoint.z),
        THREE.MathUtils.smootherstep(actionTime, 0, 0.2),
      );
    }
    heldCard.visible = actionTime > 0.15 && actionTime < 0.8;
    heldCard.position.set(
      readerPoint.x,
      readerPoint.y +
        THREE.MathUtils.lerp(
          0.25,
          -0.2,
          THREE.MathUtils.smoothstep(actionTime, 0.15, 0.8),
        ),
      readerPoint.z + 0.14,
    );
    if (!swipeDone && actionTime >= 0.6) {
      swipeDone = true;
      swipeResult = options.developerAccess
        ? "accepted"
        : swipeStageTwoKeycard(progress);
      playSound(swipeResult === "accepted" ? "accept" : "reject");
      tell(
        swipeResult === "accepted"
          ? "Access granted."
          : "Keycard rejected. Try another room.",
      );
    }
    if (actionTime >= SWIPE_ACTION_SECONDS) {
      heldCard.visible = false;
      if (swipeResult === "accepted") {
        if (options.onArcadeComplete) {
          setPhase("handoff");
          options.onArcadeComplete();
        } else startLift();
      } else setPhase("surveillance");
    }
  }
  function startLift() {
    ensureAudio();
    tell(
      "Prime: Hangar 14 is blocked. We need to go through Bay 13.",
      6,
      false,
    );
    liftStart.copy(player.body.position);
    liftStartYaw = player.getState().yaw;
    liftCameraStart.copy(camera.position);
    liftCameraStartRotation.copy(camera.quaternion);
    liftCameraStartFov = camera.fov;
    liftStomp = 0;
    lastStomp = -10;
    liftPressed = liftArrived = false;
    setPhase("lift");
    void options.prepareBay13().catch((error) => {
      console.error("[StageTwo] Bay 13 preparation failed:", error);
      if (!disposed)
        tell(
          "Boss stage loading interrupted. Retry is available at the elevator.",
        );
    });
  }
  async function exitToBay13() {
    if (transferPending || disposed) return;
    transferPending = true;
    loadError = "boss";
    setPhase("handoff");
    stopRumble();
    fade.style.opacity = "1";
    try {
      if (
        !(await options.onExitToBay13(
          player.captureTransition({ x: 0, y: 0, z: 0 }),
        ))
      )
        throw new Error("Bay 13 handoff was not completed");
    } catch (error) {
      if (!disposed) {
        console.error("[StageTwo] Elevator handoff failed:", error);
        setPhase("load-error");
        failureTitle.textContent = "ELEVATOR LINK INTERRUPTED";
        failureText.textContent = "Your keycards and equipment are safe.";
        setInputHint(retry, "R / Retry boss connection");
        fade.style.opacity = "0.5";
      }
    } finally {
      transferPending = false;
    }
  }
  function updateLift() {
    const panelX = liftX - 1.25;
    const entryYaw = Math.atan2(liftStart.x - panelX, liftStart.z - liftZ);
    if (phaseTime < 1.6) {
      const u = THREE.MathUtils.smoothstep(phaseTime, 0, 1.6);
      player.setPosition(
        THREE.MathUtils.lerp(liftStart.x, panelX, u),
        player.radius,
        THREE.MathUtils.lerp(liftStart.z, liftZ, u),
      );
      turnPlayer(
        liftStartYaw,
        entryYaw,
        THREE.MathUtils.smootherstep(phaseTime, 0, 0.28),
      );
    } else if (phaseTime < 2.6) {
      player.setPosition(panelX, player.radius, liftZ);
      turnPlayer(
        entryYaw,
        Math.PI / 2,
        THREE.MathUtils.smootherstep(phaseTime, 1.6, 1.85),
      );
    } else if (phaseTime < 2.9) {
      player.setPosition(panelX, player.radius, liftZ);
      turnPlayer(
        Math.PI / 2,
        -Math.PI / 2,
        THREE.MathUtils.smootherstep(phaseTime, 2.6, 2.9),
      );
    } else if (phaseTime < 3.6) {
      const u = THREE.MathUtils.smootherstep(phaseTime, 2.9, 3.6);
      player.setPosition(
        THREE.MathUtils.lerp(panelX, liftX, u),
        player.radius,
        liftZ,
      );
      player.setRotation(-Math.PI / 2, 0);
    } else {
      player.setPosition(
        liftX,
        player.radius,
        phaseTime < 10.4
          ? liftZ
          : THREE.MathUtils.lerp(
              liftZ,
              rearZ - 0.8,
              THREE.MathUtils.smoothstep(phaseTime, 10.4, 11.9),
            ),
      );
      turnPlayer(
        -Math.PI / 2,
        0,
        THREE.MathUtils.smootherstep(phaseTime, 3.6, 3.95),
      );
    }
    liftButtonMaterial.color.setHex(
      phaseTime >= 2 && phaseTime < 2.4 ? 0xffffff : 0x72eeaa,
    );
    if (!liftPressed && phaseTime >= 2) {
      liftPressed = true;
      playSound("clang");
    }
    if (phaseTime > 2.4 && phaseTime <= 9 && !rumble) startRumble();
    const stomps = [6.5, 7.7, 8.7, 9.4];
    if (liftStomp < stomps.length && phaseTime >= stomps[liftStomp]) {
      playSound("stomp");
      lastStomp = phaseTime;
      liftStomp++;
    }
    if (!liftArrived && phaseTime > 9) {
      liftArrived = true;
      stopRumble();
      playSound("clang");
    }
    const flicker =
      !reducedMotion && phaseTime > 3 && phaseTime < 9 && phaseTime % 2.3 < 0.18
        ? 0.25
        : 1;
    liftLamp.intensity = 16 * flicker;
    liftStrip.color.setHex(flicker < 1 ? 0x345366 : 0x6ad9e8);
    fade.style.opacity = String(
      THREE.MathUtils.smoothstep(phaseTime, 11.3, 11.9),
    );
    if (phaseTime >= 11.9) void exitToBay13();
  }
  async function teleportToFeed() {
    if (transferPending || !transferTarget || disposed) return;
    transferPending = true;
    try {
      if (
        !(await options.onCameraTeleport(
          transferTarget,
          player.captureTransition({ x: 0, y: 0, z: 0 }),
        ))
      )
        throw new Error("Camera transfer was not completed");
    } catch (error) {
      if (!disposed) {
        console.error("[StageTwo] Camera teleport failed:", error);
        setPhase("surveillance");
        tell("Camera link interrupted. Try again.");
      }
    } finally {
      transferPending = false;
    }
  }
  function retryCheckpoint() {
    if (menuPaused) return;
    if (phase === "load-error") {
      if (loadError === "hub") void loadHub();
      else void exitToBay13();
    } else restoreCheckpoint();
  }
  retry.addEventListener("click", retryCheckpoint);
  function onKey(event: KeyboardEvent) {
    if (
      !active ||
      disposed ||
      menuPaused ||
      document.hidden ||
      event.repeat ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(
        'button, dialog, input, textarea, select, [contenteditable="true"]',
      )
    )
      return;
    ensureAudio();
    if (
      event.code === "KeyR" &&
      (phase === "failed" || phase === "load-error")
    ) {
      event.preventDefault();
      retryCheckpoint();
      return;
    }
    if (event.code !== "KeyE") return;
    if (phase !== "surveillance") return;
    if (returnAirlock.near(player)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      tell("The airlock is permanently locked.");
      return;
    }
    if (readerFocused() || nearLiftDoor()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startSwipe();
      return;
    }
    const target = options.getCameraTarget();
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.id === "stage2-vents" || target.id === "stage2-prison") {
      tell("Already cleared.");
      return;
    }
    if (target.status === "error") {
      options.onRetryFeed(target.id);
      tell("Reconnecting camera.");
      return;
    }
    if (target.status !== "ready") {
      tell("Camera connecting.");
      return;
    }
    transferTarget = target.id;
    setPhase("teleport");
    if (options.skipCinematics) void teleportToFeed();
  }
  function onPointer(event: MouseEvent) {
    if (
      !active ||
      disposed ||
      menuPaused ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(
        "button, dialog, input, .stage-two-ui, #touch-controls",
      )
    )
      return;
    ensureAudio();
  }
  function onVisibility() {
    player.clearInput();
    syncAudio();
  }
  window.addEventListener("keydown", onKey);
  window.addEventListener("mousedown", onPointer, true);
  window.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onVisibility);
  function objectiveFor() {
    if (phase === "maze")
      return progress.remoteRooms["stage2-vents"].rewardCollected
        ? "Find the camera-room exit. Green sensors are safe."
        : "Find the first keycard chest. Green sensors are safe; blue pads save your progress.";
    return "";
  }
  function updateObjective(frame = 0) {
    const text = objectiveFor();
    objective.classList.toggle("hidden", phase !== "maze");
    if (text !== objectiveShown) {
      objectiveShown = text;
      objectiveTime = 0;
      setInputHint(objectiveText, text, "foot", true);
    } else objectiveTime += frame;
    objective.classList.toggle(
      "faded",
      !text || objectiveTime > popupDuration(8),
    );
  }
  function liftWalking() {
    return (
      phase === "lift" &&
      (phaseTime < 1.6 ||
        (phaseTime >= 2.9 && phaseTime < 3.6) ||
        phaseTime >= 10.4)
    );
  }
  function cinematicState(): PlayerState | null {
    if (seating.active) return seating.getState();
    if (playable.has(phase)) return null;
    return {
      ...player.getState(),
      isMoving:
        liftWalking() ||
        (phase === "swipe" && phaseTime < SWIPE_APPROACH_SECONDS),
      isOnGround: phase !== "drop",
      climbing: false,
      jumping: false,
      crouching: false,
      sprinting: false,
      actionRequest: null,
      boxHandling: false,
      sliding: false,
    };
  }
  function cinematicPose(): CinematicPose | null {
    if (seating.active) return seating.getPose();
    if (phase === "failed") return { clip: "Death01", time: phaseTime };
    if (phase === "drop")
      return {
        clip: phaseTime < 1.2 ? "Jump_Loop" : "Jump_Land",
        time: phaseTime < 1.2 ? phaseTime : phaseTime - 1.2,
      };
    if (phase === "lift" && phaseTime >= 1.6 && phaseTime < 2.6)
      return {
        clip: "Interact",
        time: phaseTime - 1.6,
      };
    if (phase === "swipe")
      return phaseTime < SWIPE_APPROACH_SECONDS
        ? { clip: "Walk_Loop", time: elapsed, loop: true }
        : {
            clip: "Interact",
            time: Math.max(0, phaseTime - SWIPE_APPROACH_SECONDS - 0.15),
          };
    if (liftWalking()) return { clip: "Walk_Loop", time: elapsed, loop: true };
    return !playable.has(phase)
      ? { clip: "Idle_Loop", time: elapsed, loop: true }
      : null;
  }
  function applyCinematicCamera() {
    if (seating.applyCamera()) return;
    const p = player.body.position;
    camera.fov = 64;
    if (phase === "drop") {
      camera.position.set(
        STAGE_TWO.drop.x + 2.1,
        Math.min(3.1, p.y + 1),
        STAGE_TWO.drop.z + 1,
      );
      camera.lookAt(p.x, p.y + 0.5, p.z);
    } else if (phase === "swipe") {
      camera.position.set(readerPoint.x + 1.25, 1.85, readerPoint.z + 2.2);
      camera.lookAt(readerPoint);
    } else if (phase === "teleport" || phase === "hub-loading") {
      camera.position.set(28, 1.8, -51);
      camera.lookAt(STAGE_TWO.cameraWall.x, 1.95, STAGE_TWO.cameraWall.z);
    } else if (phase === "failed") {
      camera.position.set(p.x + 2.2, p.y + 1.7, p.z + 2.2);
      camera.lookAt(p.x, p.y + 0.5, p.z);
    } else if (phase === "lift") {
      const shake = reducedMotion
        ? 0
        : Math.max(0, 1 - (phaseTime - lastStomp) / 0.6) * 0.06;
      const sway = reducedMotion || phaseTime < 2.4 || phaseTime > 9 ? 0 : 0.01;
      const sx = Math.sin(elapsed * 43) * (shake + sway),
        sy = Math.sin(elapsed * 57) * (shake + sway);
      if (phaseTime < 2.6) {
        camera.position.set(liftX + 1.35 + sx, 1.95 + sy, liftZ - 1.5);
        camera.lookAt(liftButtonPoint);
      } else if (phaseTime < 9.7) {
        camera.position.set(liftX - 0.6 + sx, 1.65 + sy, liftZ - 1.3);
        camera.lookAt(liftX, 1.45, liftZ + 1.1);
      } else {
        camera.position.set(liftX + 0.65 + sx, 1.85 + sy, room.minZ - 0.5);
        camera.lookAt(liftX, 1.1, rearZ - 0.5);
      }
      if (phaseTime < 0.65) {
        const blend = THREE.MathUtils.smootherstep(phaseTime, 0, 0.65);
        liftCameraTarget.copy(camera.position);
        liftCameraTargetRotation.copy(camera.quaternion);
        camera.position.lerpVectors(liftCameraStart, liftCameraTarget, blend);
        camera.quaternion.slerpQuaternions(
          liftCameraStartRotation,
          liftCameraTargetRotation,
          blend,
        );
        camera.fov = THREE.MathUtils.lerp(liftCameraStartFov, 64, blend);
      }
    } else {
      camera.position.set(p.x + 0.7, 1.75, p.z + 1.4);
      camera.lookAt(p.x, 1.4, p.z - 3);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  const ventRay = new THREE.Raycaster(),
    ventFocus = new THREE.Vector3(),
    ventBack = new THREE.Vector3();
  function applyVentCamera() {
    const yaw = player.getState().yaw;
    ventFocus.set(player.body.position.x, 4.65, player.body.position.z);
    ventBack.set(Math.sin(yaw) * 1.5, 0.4, Math.cos(yaw) * 1.5);
    maze.root.updateWorldMatrix(true, true);
    ventRay.set(ventFocus, ventBack.clone().normalize());
    ventRay.far = ventBack.length();
    const hit = ventRay.intersectObjects(maze.root.children, false)[0];
    if (hit) ventBack.setLength(Math.max(0.22, hit.distance - 0.15));
    camera.position.copy(ventFocus).add(ventBack);
    camera.lookAt(ventFocus);
    camera.fov = 75;
    camera.updateProjectionMatrix();
  }
  function mapVisibility(visible: THREE.Group[]) {
    const previous = groups.map((group) => group.visible);
    groups.forEach((group) => {
      group.visible = visible.includes(group);
    });
    return () =>
      groups.forEach((group, index) => {
        group.visible = previous[index];
      });
  }
  function getMinimapState(): MinimapSettings & {
    position: CANNON.Vec3;
    yaw: number;
  } {
    if (phase === "maze" || progress.checkpoint === "vent")
      return {
        position: player.body.position,
        yaw: player.getState().yaw,
        floor: 4,
        expanded: true,
        bounds: VENT_BOUNDS,
        deckLabel: "",
        goal: progress.remoteRooms["stage2-vents"].rewardCollected
          ? { ...STAGE_TWO.drop, label: "EXIT" }
          : { ...STAGE_TWO.ventChest, label: "CHEST" },
        safePads: VENT_SAFE_CELLS.map((cell) =>
          ventPoint(cell.column, cell.row),
        ),
        enemies: maze.sensors.map(({ mesh }, index) => ({
          id: VENT_SENSORS[index].id,
          position: mesh.position,
          kind: "sensor",
          alerted: ventSensorState(index, elapsed).active,
        })),
        prepare: () => mapVisibility([maze.root]),
      };
    return {
      position: player.body.position,
      yaw: player.getState().yaw,
      floor: 0,
      bounds: { minX: 18.5, maxX: 37.5, minZ: -70, maxZ: -41.5 },
      goal: { x: liftX, z: room.minZ, label: "ELEVATOR" },
      enemies: [],
      prepare: () => mapVisibility([surveillance, lift]),
    };
  }
  if (progress.checkpoint === "surveillance") enterSurveillance();
  else enterMaze();
  updateObjective();
  return {
    restartAtCheckpoint: () => {
      if (disposed) return false;
      restoreCheckpoint();
      return true;
    },
    roomId: "stage-two",
    scene,
    camera,
    player,
    physicsWorld: physics.world,
    ready,
    cutsceneManager: null,
    requiresRecoveredPistol: true,
    handlesPlayerDeath: true,
    activate() {
      active = true;
      ui.classList.remove("hidden");
      syncBodyClass();
      if (playable.has(phase)) player.enable();
    },
    getSceneId: () => "scene1.2",
    getMapSceneId: () =>
      `scene${progress.checkpoint === "vent" ? 34 : player.body.position.z < room.minZ ? 36 : 35}`,
    getMapLayout: () => STAGE_TWO_MAP,
    getMinimapState,
    getMusicTrack: () =>
      phase === "maze"
        ? ("tension" as const)
        : phase === "lift" || phase === "handoff"
          ? ("ship" as const)
          : ("stealth-2" as const),
    getCctvEnabled: () => progress.checkpoint === "surveillance",
    getCctvPaused: () => false,
    isMazeActive: () => phase === "maze",
    controlsReady: () =>
      active && !menuPaused && playable.has(phase) && !seating.active,
    isCinematic: () => !playable.has(phase) || seating.active,
    get ownsWeaponInput() {
      return (
        !active || !playable.has(phase) || phase === "maze" || seating.active
      );
    },
    getCinematicState: cinematicState,
    getCinematicPose: cinematicPose,
    getCinematicDelta: () => lastDelta,
    getCinematicWeapon: () => "unarmed" as const,
    hideMinimap: () => !playable.has(phase),
    applyCinematicCamera,
    applyVentCamera,
    getHologramTransition: () =>
      phase === "teleport"
        ? hologramTransitionAt(Math.min(phaseTime, HOLOGRAM_TRANSFER_DURATION))
        : null,
    showTeleportMessage: tell,
    returnToAnchor() {
      if (
        phase !== "surveillance" ||
        seating.active ||
        menuPaused ||
        transferPending
      )
        return false;
      teleportPlayer(player, { x: 28, y: player.radius, z: -56 }, Math.PI);
      return true;
    },
    setMenuPaused(value: boolean) {
      menuPaused = value;
      player.clearInput();
      syncAudio();
    },
    getStageState: () => ({
      phase,
      elapsed,
      ventSafe: ventSafe.clone(),
      keycards: progress.keycards.length,
      swipeResult,
    }),
    ventChest,
    crowbarChest,
    getMonitorFrames: () => monitors.map((monitor) => monitor.getFrameIndex()),
    getDamageTargets(): DamageTarget[] {
      return [];
    },
    updateInteractionFocus() {
      if (
        !active ||
        menuPaused ||
        !player.isEnabled() ||
        !prompt ||
        ventChest.isPromptVisible() ||
        crowbarChest.isPromptVisible()
      )
        return;
      if (seating.updateInteractionFocus()) return;
      let text = "";
      if (phase === "surveillance") {
        if (returnAirlock.near(player)) text = "E / Airlock locked";
        else if (readerFocused() || nearLiftDoor()) text = "E / Swipe keycard";
        else {
          const target = options.getCameraTarget();
          if (target)
            text =
              target.id === "stage2-vents" || target.id === "stage2-prison"
                ? `${target.label} / Cleared`
                : target.status === "error"
                  ? `E / Retry ${target.label}`
                  : target.status !== "ready"
                    ? `${target.label} / connecting`
                    : `E / Visit ${target.label}`;
        }
      }
      prompt.textContent = inputHint(text);
      prompt.classList.toggle("hidden", !text);
    },
    updatePhysics(dt: number, thirdPerson = true) {
      if (disposed || !active || menuPaused) return;
      const frame = Number.isFinite(dt)
        ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime)
        : 0;
      lastDelta = frame;
      elapsed += frame;
      phaseTime += frame;
      seating.update(frame);
      physics.step(frame, player, thirdPerson);
      maze.update(elapsed);
      ventChest.update(frame);
      crowbarChest.update(frame);
      hangingCrystal.rotation.y += frame * 1.2;
      hangingCrystal.position.y = height - 1.3 + Math.sin(elapsed * 2) * 0.05;
      monitors.forEach((monitor) => monitor.update(frame));
      captionTime = Math.max(0, captionTime - frame);
      if (!captionTime) {
        caption.classList.add("hidden");
        if (phase === "surveillance" && !crystalRemarked) {
          crystalRemarked = true;
          tell(
            "Prime: That green crystal keeps our return link. Press R to return to this room.",
            7,
          );
        }
      }
      returnAirlock.update(frame, player, false);
      frontDoor.update(
        frame,
        player,
        (phase === "swipe" && swipeDone && swipeResult === "accepted") ||
          (phase === "lift" && phaseTime < 2.1),
      );
      rearDoor.update(
        frame,
        player,
        (phase === "lift" && phaseTime > 9.8) ||
          phase === "handoff" ||
          (phase === "load-error" && loadError === "boss"),
      );
      readerMaterial.color.setHex(elevatorAvailable() ? 0x72eeaa : 0xff785e);
      readerMaterial.emissive.setHex(elevatorAvailable() ? 0x248549 : 0x8d2019);
      switch (phase) {
        case "failed":
          if (isControllerActive() && phaseTime >= 2.5) restoreCheckpoint();
          break;
        case "maze":
          sensorGrace = Math.max(0, sensorGrace - frame);
          for (const cell of VENT_SAFE_CELLS) {
            const point = ventPoint(cell.column, cell.row, 4 + player.radius);
            if (
              Math.hypot(
                player.body.position.x - point.x,
                player.body.position.z - point.z,
              ) < 0.55
            )
              ventSafe.copy(point);
          }
          if (
            !sensorGrace &&
            maze.sensors.some(
              ({ mesh }, index) =>
                ventSensorState(index, elapsed).active &&
                Math.hypot(
                  player.body.position.x - mesh.position.x,
                  player.body.position.z - mesh.position.z,
                ) < 0.48,
            )
          ) {
            teleportPlayer(player, ventSafe, -Math.PI / 2);
            player.setVentMode(true);
            player.setOverheadMovement(true);
            sensorGrace = 2.5;
            playSound("sensor");
            tell("Detected. Back to the last checkpoint.");
          }
          if (
            Math.hypot(
              player.body.position.x - STAGE_TWO.drop.x,
              player.body.position.z - STAGE_TWO.drop.z,
            ) < 0.55
          ) {
            if (!progress.remoteRooms["stage2-vents"].rewardCollected) {
              teleportPlayer(
                player,
                {
                  x: STAGE_TWO.drop.x,
                  y: 4 + player.radius,
                  z: STAGE_TWO.drop.z + 0.85,
                },
                0,
              );
              player.setVentMode(true);
              player.setOverheadMovement(true);
              tell("Find the keycard chest before leaving the vents.");
              break;
            }
            setPhase("drop");
            player.setVentMode(false);
            player.setOverheadMovement(false);
            player.setPosition(
              STAGE_TWO.drop.x,
              4 + player.radius,
              STAGE_TWO.drop.z,
            );
            player.setRotation(0, 0);
          } else if (player.body.position.y < 3.2) {
            teleportPlayer(player, ventSafe, -Math.PI / 2);
            player.setVentMode(true);
            player.setOverheadMovement(true);
            sensorGrace = 2.5;
          }
          break;
        case "drop":
          player.setPosition(
            STAGE_TWO.drop.x,
            THREE.MathUtils.lerp(
              4 + player.radius,
              player.radius,
              THREE.MathUtils.smootherstep(phaseTime, 0, 1.2),
            ),
            STAGE_TWO.drop.z,
          );
          if (phaseTime >= 1.5) {
            arrivalRemarkPending = true;
            progress.ventCleared = true;
            progress.checkpoint = "surveillance";
            void loadHub();
          }
          break;
        case "surveillance":
          break;
        case "swipe":
          updateSwipe();
          break;
        case "teleport":
          if (phaseTime >= HOLOGRAM_TRANSFER_DURATION) void teleportToFeed();
          break;
        case "lift":
          updateLift();
          break;
      }
      if (
        playable.has(phase) &&
        phase !== "maze" &&
        player.body.position.y < -3
      )
        fail("You fell off the deck. Retry your camera-room checkpoint.");
      updateObjective(frame);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onVisibility);
      unsubscribeAudio();
      stopRumble();
      seating.dispose();
      ventChest.dispose();
      crowbarChest.dispose();
      monitors.forEach((monitor) => monitor.dispose());
      if (audioContext && audioContext.state !== "closed")
        void audioContext
          .close()
          .catch((error) =>
            console.warn("[StageTwo] Audio cleanup failed:", error),
          );
      ui.remove();
      prompt?.classList.add("hidden");
      document.body.classList.remove("stage-two-maze", "quarters-cinematic");
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}
