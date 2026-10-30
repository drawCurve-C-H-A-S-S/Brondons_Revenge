import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { loadToolModel } from "../../core/loader.js";
import { playSfx } from "../../helpers/audio/sfx.js";
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
  createShipTerminal,
} from "../../scripts/global/shipInterior.js";
import { createRecoveryPickup } from "../../scripts/global/recoveryPickup.js";
import { createCameraVisitUI } from "../../scripts/global/cameraVisit.js";
import {
  createPlayer,
  type PlayerTransitionState,
} from "../../scripts/player/player.js";
import { teleportPlayer } from "../../scripts/global/teleportationDevice.js";
import {
  createBreakables,
  type Breakable,
} from "../../scripts/global/breakables.js";
import { traceShot } from "../../scripts/weapons/pistol.js";
import { createRewardChest } from "../../scripts/global/rewardChest.js";
import { inputHint } from "../../scripts/player/gamepadInput.js";
import { setInputHint } from "../../scripts/global/inputPrompts.js";
import { popupDuration } from "../../scripts/global/popupTiming.js";
import { cameraVisitMap, type CameraRoomProgress } from "./stageTwoLayout.js";
import {
  createRustEdgeMaterial,
  createRustWallMaterial,
  createRustWater,
} from "./rustMaterials.js";

interface RustChamberOptions {
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  skipCinematics?: boolean;
  loot?: CameraRoomProgress;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onKeycardCollected?: () => void;
  modelLoader?: typeof loadToolModel;
}

const POEM = [
  "At the room's heart, silver turns the light;",
  "Through blue, to silver, blue takes flight.",
  "Two distant clasps must loose their hold;",
  "Then down shall fall the iron fold.",
  "Three teeth and chain yield to your steel;",
  "One hanging ember binds the wheel.",
  "Tread the thin thread above the stain;",
  "The hungry rust leaves none remain.",
  "Break orange close; let blue be shot;",
  "Beyond the door, claim what was wrought.",
] as const;
const BOLTS = ["rust:bolt-1", "rust:bolt-2", "rust:bolt-3"];
const CHAIN = "rust:winch-chain",
  BARS = "rust:winch-bars",
  CLAMP = "rust:blue-clamp";
const FAR_CLAMP = "rust:far-blue-clamp",
  HANGING = "rust:hanging-lock";
const RELEASES = [...BOLTS, BARS, CHAIN, CLAMP, FAR_CLAMP, HANGING];

function inscriptionTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 960;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to draw the rust chamber inscription");
  context.fillStyle = "#302b25";
  context.fillRect(0, 0, 1280, 960);
  context.strokeStyle = "#93816a";
  context.lineWidth = 4;
  context.strokeRect(32, 32, 1216, 896);
  context.strokeStyle = "#55483b";
  context.lineWidth = 2;
  context.strokeRect(46, 46, 1188, 868);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "italic 40px Georgia, serif";
  context.fillStyle = "#e1ccb0";
  POEM.forEach((line, index) => context.fillText(line, 640, 125 + index * 77));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Adapted from origin/rust's chamber1: the arrival gallery, pump hall, sump and L-gantry. */
export function createScene({
  entryState,
  preview = false,
  deferActivation = false,
  skipCinematics = false,
  loot = { cleared: new Set<string>(), rewardCollected: false },
  hasReturnMarker,
  onRestart,
  onKeycardCollected,
  modelLoader = loadToolModel,
}: RustChamberOptions = {}) {
  if (!preview && (!onRestart || !onKeycardCollected))
    throw new Error(
      "The rust chamber requires a surveillance return link and persistent keycard reward",
    );
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111820);
  scene.fog = new THREE.Fog(0x111820, 38, 78);
  const physics = createScenePhysics(),
    world = physics.world;
  const camera = new THREE.PerspectiveCamera(
    68,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.05,
    100,
  );
  const ship = createShipInteriorMaterials(9, 7);
  ship.deck.color.setHex(0x55504a);
  const rusted = createRustWallMaterial();
  const rustEdge = createRustEdgeMaterial(rusted);
  const steel = new THREE.MeshStandardMaterial({
    color: 0x4e5c66,
    metalness: 0.65,
    roughness: 0.58,
  });
  const worn = new THREE.MeshStandardMaterial({
    color: 0x70523c,
    metalness: 0.4,
    roughness: 0.86,
  });
  const box = (
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material = steel,
    solid = true,
  ) => roomBox(scene, physics, size, at, material, solid);
  let active = !preview && !deferActivation,
    paused = false,
    disposed = false,
    clock = 0,
    greeted = false;
  let captionTime = 0,
    lastDelta = 0,
    ownsPrompt = false;
  const player = createPlayer({
    camera,
    physicsWorld: world,
    spawnPosition: { x: 17, y: PHYSICS.playerRadius, z: 2.2 },
  });
  teleportPlayer(
    player,
    { x: 17, y: player.radius, z: 2.2 },
    Math.PI,
    entryState,
  );
  if (active) player.enable();
  if (preview) {
    camera.position.set(27, 11, 8);
    camera.lookAt(16, 4, 25);
  }
  const ui = document.createElement("section");
  ui.className = "stage-two-ui rust-chamber-ui";
  ui.classList.toggle("hidden", !active);
  const caption = document.createElement("div");
  caption.className = "stage-two-dialogue hidden";
  caption.setAttribute("role", "status");
  const reading = document.createElement("aside");
  reading.className = "rust-poem-reading hidden";
  reading.setAttribute("aria-label", "Inscription");
  const verses = document.createElement("p");
  verses.textContent = POEM.join("\n");
  const closeReading = document.createElement("span");
  reading.append(verses, closeReading);
  ui.append(caption, reading);
  if (!preview) document.body.append(ui);
  const prompt = document.getElementById("interact-prompt");

  // Original 34 x 22 m pump hall; only purposeful machinery occupies the floor.
  box([10, 0.4, 6], [17, -0.2, 3], ship.deck);
  box([10, 4.4, 0.4], [17, 2.2, -0.2], ship.steel);
  for (const x of [11.8, 22.2]) box([0.4, 4.4, 6], [x, 2.2, 3], ship.steel);
  box([10, 0.3, 6], [17, 4.55, 3], ship.dark);
  for (const x of [12.4, 21.6])
    box([0.08, 0.06, 5], [x, 4.15, 3], ship.cyan, false);
  box([34, 0.4, 4.8], [17, -0.2, 8.4], ship.deck);
  box([34, 0.4, 3.6], [17, -0.2, 26.2], ship.deck);
  box([5.8, 0.4, 13.6], [2.9, -0.2, 17.6], ship.deck);
  box([17.8, 0.4, 13.6], [25.1, -0.2, 17.6], ship.deck);
  for (const x of [-0.2, 34.2]) box([0.4, 14, 22], [x, 7, 17], rusted);
  for (const z of [6, 28]) {
    for (const x of [7, 27]) box([14, 14, 0.5], [x, 7, z], rusted);
    box([6, z === 6 ? 8.5 : 7, 0.5], [17, z === 6 ? 9.75 : 10.5, z], rusted);
  }
  box([34, 0.4, 22], [17, 14.2, 17], ship.dark);
  function roofBrace(from: THREE.Vector3, to: THREE.Vector3) {
    const direction = to.clone().sub(from);
    const brace = box(
      [direction.length(), 0.14, 0.22],
      [(from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2],
      steel,
      false,
    );
    brace.name = "RustChamberRoofBrace";
    brace.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      direction.normalize(),
    );
    brace.userData.minimap = false;
  }
  for (const z of [9, 13, 17, 21, 25]) {
    const upper = box([34, 0.3, 0.35], [17, 13.85, z], steel, false);
    const lower = box([34, 0.25, 0.3], [17, 12.65, z], steel, false);
    upper.name = "RustChamberRoofUpperChord";
    lower.name = "RustChamberRoofLowerChord";
    upper.userData.minimap = lower.userData.minimap = false;
    for (let bay = 0; bay < 8; bay++) {
      const x = 0.5 + bay * 4.125;
      roofBrace(
        new THREE.Vector3(x, bay % 2 ? 13.85 : 12.65, z),
        new THREE.Vector3(x + 4.125, bay % 2 ? 12.65 : 13.85, z),
      );
    }
    for (const x of [0.5, 33.5])
      roofBrace(new THREE.Vector3(x, 12.65, z), new THREE.Vector3(x, 13.85, z));
  }
  for (const x of [0.5, 8.75, 17, 25.25, 33.5]) {
    const beam = box([0.2, 0.25, 16.35], [x, 13.85, 17], steel, false);
    beam.name = "RustChamberRoofLongitudinal";
    beam.userData.minimap = false;
  }
  for (const x of [0.3, 33.7]) {
    box([0.18, 0.45, 21], [x, 0.24, 17], worn, false);
    box([0.16, 0.14, 21], [x, 3.6, 17], ship.trim, false);
  }
  const lockedDoors = [
    createSlidingPortal(
      scene,
      physics,
      { x: 12.14, y: 0, z: 2.8, yaw: Math.PI / 2 },
      5.6,
      4.4,
      "",
      { sign: false, landingFloor: false },
    ),
  ];
  lockedDoors.forEach((door) => door.setLocked(true));
  const stair = physics.addStaircase({
    width: 2.6,
    run: 14.5,
    rise: 8.6,
    position: { x: 3.6, y: 0, z: 9.9 },
    material: ship.deck,
  });
  scene.add(stair.group);
  box([27, 0.35, 3.6], [15.5, 8.425, 26.2], ship.deck);
  box([1.8, 0.35, 10.4], [1.3, 8.425, 20.6], ship.deck);
  for (const [x, z] of [
    [1.2, 16],
    [1.2, 22],
    [8, 27.6],
    [26, 27.6],
  ])
    box([0.3, 8.4, 0.3], [x, 4.2, z], steel);
  function railing(from: THREE.Vector3, to: THREE.Vector3) {
    const direction = to.clone().sub(from),
      length = direction.length();
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, length),
      ship.trim,
    );
    rail.name = "RustChamberRailing";
    rail.position.copy(from).add(to).multiplyScalar(0.5).y += 1;
    rail.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction.normalize(),
    );
    scene.add(rail);
    physics.addBoxFromMesh(rail);
    for (let distance = 0; distance <= length; distance += 1.5) {
      const point = from.clone().addScaledVector(direction, distance);
      box([0.08, 1, 0.08], [point.x, point.y + 0.5, point.z], steel);
    }
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.05, length),
      steel,
    );
    barrier.position.copy(from).add(to).multiplyScalar(0.5).y += 0.525;
    barrier.quaternion.copy(rail.quaternion);
    scene.add(barrier);
    physics.addBoxFromMesh(barrier);
    barrier.visible = false;
  }
  for (const [a, b] of [
    [5.2, 15.9],
    [18.8, 29],
  ])
    railing(new THREE.Vector3(a, 8.6, 24.42), new THREE.Vector3(b, 8.6, 24.42));
  railing(new THREE.Vector3(0.38, 8.6, 15.4), new THREE.Vector3(0.38, 8.6, 25));
  for (const [a, b] of [
    [15.4, 15.8],
    [17.4, 24.3],
  ])
    railing(new THREE.Vector3(2.21, 8.6, a), new THREE.Vector3(2.21, 8.6, b));
  for (const x of [2.21, 4.99]) {
    const rail = box(
      [0.08, 0.08, Math.hypot(14.5, 8.6)],
      [x, 5.3, 17.15],
      ship.trim,
      false,
    );
    rail.rotation.x = -Math.atan2(8.6, 14.5);
    physics.addBoxFromMesh(rail);
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1, Math.hypot(14.5, 8.6)),
      steel,
    );
    barrier.position.set(x, 4.8, 17.15);
    barrier.rotation.copy(rail.rotation);
    scene.add(barrier);
    physics.addBoxFromMesh(barrier);
    barrier.visible = false;
    for (let post = 0; post <= 6; post++)
      box(
        [0.07, 1, 0.07],
        [x, 0.5 + (post / 6) * 8.6, 9.9 + (post / 6) * 14.5],
        steel,
      );
  }

  box([3.4, 0.35, 1.6], [3.5, 8.425, 16.6], ship.deck);
  const ropeStart = new THREE.Vector3(5.1, 8.63, 16.6),
    ropeEnd = new THREE.Vector3(17.4, 8.63, 24.8);
  const ropeDirection = ropeEnd.clone().sub(ropeStart),
    ropeLength = ropeDirection.length();
  const ropeSide = new THREE.Vector3(
    -ropeDirection.z,
    0,
    ropeDirection.x,
  ).normalize();
  const ropeCurve = new THREE.CatmullRomCurve3([
    ropeStart,
    ropeStart
      .clone()
      .lerp(ropeEnd, 0.5)
      .add(new THREE.Vector3(0, -0.06, 0)),
    ropeEnd,
  ]);
  const ropeMaterial = new THREE.MeshStandardMaterial({
    color: 0xbaa077,
    roughness: 0.98,
    metalness: 0,
  });
  const rope = new THREE.Mesh(
    new THREE.TubeGeometry(ropeCurve, 96, 0.055, 8, false),
    ropeMaterial,
  );
  rope.name = "RustChamberTightrope";
  rope.castShadow = true;
  scene.add(rope);
  const braidMaterial = new THREE.MeshStandardMaterial({
    color: 0x765c3b,
    roughness: 1,
    metalness: 0,
  });
  for (let strand = 0; strand < 3; strand++) {
    const points = Array.from({ length: 241 }, (_, index) => {
      const t = index / 240,
        angle = t * Math.PI * 2 * 46 + (strand * Math.PI * 2) / 3;
      return ropeCurve
        .getPoint(t)
        .addScaledVector(ropeSide, Math.cos(angle) * 0.055)
        .add(new THREE.Vector3(0, Math.sin(angle) * 0.055, 0));
    });
    const braid = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        480,
        0.022,
        5,
        false,
      ),
      braidMaterial,
    );
    braid.name = `RustTightropeStrand-${strand}`;
    braid.castShadow = true;
    scene.add(braid);
  }
  const ropeSupport = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.12, ropeLength),
    steel,
  );
  ropeSupport.position.copy(ropeStart).lerp(ropeEnd, 0.5);
  ropeSupport.position.y -= 0.015;
  ropeSupport.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    ropeDirection.clone().normalize(),
  );
  scene.add(ropeSupport);
  physics.addBoxFromMesh(ropeSupport);
  ropeSupport.visible = false;
  for (const point of [ropeStart, ropeEnd]) {
    box([0.25, 0.3, 0.5], [point.x, 8.5, point.z], steel);
    for (let turn = 0; turn < 4; turn++) {
      const knot = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.035, 6, 12),
        ropeMaterial,
      );
      knot.name = "RustTightropeAnchorKnot";
      knot.position
        .copy(point)
        .addScaledVector(ropeDirection, ((turn - 1.5) * 0.055) / ropeLength);
      knot.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        ropeDirection.clone().normalize(),
      );
      scene.add(knot);
    }
  }
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const ropeOffset = new THREE.Vector3(),
    ropeNearest = new THREE.Vector3();
  let ropeBalance = 0,
    ropeProgress = 0,
    ropeRoll = 0,
    ropeSway = 0;
  function updateRopeBalance(dt: number) {
    const p = player.body.position,
      feet = p.y - player.radius;
    ropeOffset.set(p.x - ropeStart.x, 0, p.z - ropeStart.z);
    ropeProgress = THREE.MathUtils.clamp(
      ropeOffset.dot(ropeDirection) / ropeDirection.lengthSq(),
      0,
      1,
    );
    ropeNearest.copy(ropeStart).addScaledVector(ropeDirection, ropeProgress);
    const onRope =
      playable() &&
      player.isEnabled() &&
      feet > 8.4 &&
      feet < 8.95 &&
      Math.abs(player.body.velocity.y) < 1.8 &&
      Math.hypot(p.x - ropeNearest.x, p.z - ropeNearest.z) < 0.45 &&
      ropeProgress > 0.025 &&
      ropeProgress < 0.975;
    const weight = onRope ? Math.sin(ropeProgress * Math.PI) : 0;
    ropeBalance = THREE.MathUtils.damp(ropeBalance, weight, 9, dt);
    const speed = Math.min(
      Math.hypot(player.body.velocity.x, player.body.velocity.z) / 4,
      1.5,
    );
    const strength = reducedMotion?.matches
      ? 0
      : ropeBalance * (0.45 + speed * 0.55);
    const closeness = broken(HANGING)
      ? 0
      : Math.max(0, 1 - Math.abs(ropeProgress - 0.5) / 0.5);
    const intensity = 1 + closeness * closeness * 4.5;
    ropeRoll =
      (Math.sin(clock * 3.4) + Math.sin(clock * 7.1) * 0.22) *
      0.028 *
      strength *
      intensity;
    ropeSway = Math.sin(clock * 3.4 + 0.8) * 0.055 * strength * intensity;
  }

  // The liner sits inside the deck opening; no coplanar rim or overlapping escape steps.
  box([10.4, 0.3, 13.6], [11, -1.4, 17.6], worn);
  for (const z of [10.95, 24.25])
    box([10.1, 1.1, 0.2], [11, -0.7, z], rustEdge);
  for (const x of [5.95, 16.05])
    box([0.2, 1.1, 13.1], [x, -0.7, 17.6], rustEdge);
  for (const [width, depth, x, z] of [
    [0.6, 13.6, 5.5, 17.6],
    [0.6, 13.6, 16.5, 17.6],
    [10.4, 0.6, 11, 10.5],
    [10.4, 0.6, 11, 24.7],
  ]) {
    const edge = box([width, 0.006, depth], [x, 0.003, z], rustEdge, false);
    edge.name = "RustChamberCorrodedEdge";
    edge.userData.teleportIgnore = true;
    edge.userData.minimap = false;
  }
  const sumpWater = createRustWater(
    9.86,
    13.06,
    new THREE.Vector3(11, -0.48, 17.6),
  );
  const water = sumpWater.mesh;
  water.name = "RustChamberCorrosiveWater";
  scene.add(water);
  for (const [x, z] of [[30.5, 9]]) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 7.8, 24),
      steel,
    );
    tank.position.set(x, 3.9, z);
    tank.castShadow = true;
    scene.add(tank);
    physics.addBox({ x: 3.6, y: 7.8, z: 3.6 }, tank.position);
    for (const y of [0.5, 3.6, 7.2]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.84, 0.07, 8, 32),
        worn,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, y, z);
      scene.add(ring);
    }
  }
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.23, 17, 16),
    worn,
  );
  pipe.rotation.x = Math.PI / 2;
  pipe.name = "RustChamberWallPipe";
  pipe.position.set(33.65, 6.4, 17);
  scene.add(pipe);

  const rewardDoor = createSlidingPortal(
    scene,
    physics,
    { x: 17, y: 0, z: 28.6, yaw: Math.PI },
    6,
    7,
    "",
    { sign: false, landingFloor: false, opaqueOpening: false },
  );
  rewardDoor.setLocked(true);
  box([8, 0.3, 6], [17, -0.17, 31], ship.deck);
  for (const x of [13, 21]) box([0.3, 4.5, 6], [x, 2.25, 31], ship.steel);
  box([8, 4.5, 0.3], [17, 2.25, 34], ship.steel);
  box([8, 0.2, 6], [17, 4.6, 31], ship.dark);
  const rewardLight = new THREE.PointLight(0xc2e3d8, 16, 9);
  rewardLight.position.set(17, 3.6, 31.5);
  scene.add(rewardLight);
  box([2.4, 0.04, 0.12], [17, 4.42, 31.5], ship.cyan, false);
  const shutter = new THREE.Group();
  shutter.name = "RustChamberCounterweightedShutter";
  shutter.position.set(17, 2.5, 27.25);
  scene.add(shutter);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5, 0.4), rusted);
  plate.castShadow = true;
  shutter.add(plate);
  const doorStatus = new THREE.Group();
  doorStatus.name = "RustChamberDoorStatus";
  doorStatus.position.set(0, 0.2, -0.34);
  doorStatus.rotation.y = Math.PI;
  doorStatus.scale.setScalar(1.6);
  shutter.add(doorStatus);
  const lockMaterial = new THREE.MeshStandardMaterial({
    color: 0xffc06c,
    emissive: 0x5f2c08,
    emissiveIntensity: 0.55,
    metalness: 0.7,
    roughness: 0.35,
  });
  const lockBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.55, 0.18),
    lockMaterial,
  );
  lockBody.name = "RustChamberPadlock";
  lockBody.position.y = -0.1;
  doorStatus.add(lockBody);
  const shackle = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.055, 8, 20, Math.PI),
    steel,
  );
  shackle.position.y = 0.18;
  doorStatus.add(shackle);
  const keyhole = new THREE.Mesh(
    new THREE.CircleGeometry(0.055, 16),
    new THREE.MeshBasicMaterial({ color: 0x142029 }),
  );
  keyhole.position.set(0, -0.08, 0.1);
  doorStatus.add(keyhole);
  const ringTrack = new THREE.Mesh(
    new THREE.RingGeometry(0.66, 0.85, 64),
    new THREE.MeshBasicMaterial({ color: 0x26333b }),
  );
  doorStatus.add(ringTrack);
  const lockSegments = RELEASES.map((_, index) => {
    const segment = new THREE.Mesh(
      new THREE.RingGeometry(
        0.68,
        0.83,
        10,
        1,
        (index * Math.PI * 2) / RELEASES.length + 0.045,
        (Math.PI * 2) / RELEASES.length - 0.09,
      ),
      new THREE.MeshBasicMaterial({ color: 0xffb75f, toneMapped: false }),
    );
    segment.name = `RustChamberLockSegment-${index + 1}`;
    segment.position.z = 0.015;
    doorStatus.add(segment);
    return segment;
  });
  let shownReleaseCount = -1;
  for (const x of [-2.6, 0, 2.6]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5, 0.5), steel);
    rib.position.x = x;
    shutter.add(rib);
  }
  const shutterBody = physics.addBox(
    { x: 5.6, y: 5, z: 0.5 },
    shutter.position,
  );
  const gears: Array<{ root: THREE.Group; ratio: number; phase: number }> = [];
  function gear(x: number, y: number, z: number, radius: number, ratio = 1) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.name = "RustChamberDriveGear";
    scene.add(root);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.8, radius * 0.17, 8, 32),
      worn,
    );
    root.add(rim);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.23, radius * 0.23, 0.3, 16),
      steel,
    );
    hub.rotation.x = Math.PI / 2;
    root.add(hub);
    const teeth = radius < 0.75 ? 12 : 24;
    for (let tooth = 0; tooth < teeth; tooth++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (tooth * Math.PI * 2) / teeth;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 0.24, radius * 0.23, 0.28),
        worn,
      );
      mesh.position.y = radius;
      pivot.add(mesh);
      root.add(pivot);
    }
    for (let spoke = 0; spoke < 4; spoke++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(radius * 1.5, 0.12, 0.2),
        steel,
      );
      mesh.rotation.z = (spoke * Math.PI) / 4;
      root.add(mesh);
    }
    gears.push({ root, ratio, phase: radius < 0.75 ? Math.PI / 12 : 0 });
    return root;
  }
  gear(14.2, 10.7, 26.85, 1, -1);
  gear(15.7, 10.7, 26.85, 0.5, 2);
  gear(19.8, 10.7, 26.85, 1, 1);
  gear(18.3, 10.7, 26.85, 0.5, -2);
  const drum = gear(33.65, 2.2, 20.1, 0.7, -1.5);
  drum.rotation.y = Math.PI / 2;
  const chainGeometry = new THREE.TorusGeometry(0.105, 0.031, 6, 12);
  const suspendedChains = [14.2, 19.8].map((x) =>
    Array.from({ length: 54 }, (_, index) => {
      const link = new THREE.Mesh(chainGeometry, steel);
      link.rotation.y = index % 2 ? Math.PI / 2 : 0;
      link.position.set(x, 0, 26.85);
      scene.add(link);
      return link;
    }),
  );
  const counterweights = [12.9, 21.1].map((x) => {
    const mesh = box([0.75, 2, 0.65], [x, 8.5, 27], worn, false);
    mesh.name = "RustChamberCounterweight";
    return {
      mesh,
      body: physics.addBox({ x: 0.75, y: 2, z: 0.65 }, mesh.position),
    };
  });
  const returnChains = counterweights.map(({ mesh }) =>
    Array.from({ length: 64 }, (_, index) => {
      const link = new THREE.Mesh(chainGeometry, steel);
      link.rotation.y = index % 2 ? Math.PI / 2 : 0;
      link.position.set(mesh.position.x, 0, 26.85);
      link.name = "RustChamberCounterweightChain";
      scene.add(link);
      return link;
    }),
  );
  // The winch drive runs along the wall to the overhead door pulleys.
  const driveRoute = [
    new THREE.Vector3(33.65, 2.2, 20.1),
    new THREE.Vector3(33.65, 10.7, 20.1),
    new THREE.Vector3(33.65, 10.7, 26.85),
    new THREE.Vector3(19.8, 10.7, 26.85),
  ];
  for (let index = 1; index < driveRoute.length; index++) {
    const start = driveRoute[index - 1],
      end = driveRoute[index],
      direction = end.clone().sub(start);
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, direction.length(), 8),
      worn,
    );
    cable.name = "RustChamberWinchDrive";
    cable.position.copy(start).add(end).multiplyScalar(0.5);
    cable.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    scene.add(cable);
  }
  for (const x of [13.55, 20.45]) gear(x, 10.7, 26.85, 0.65, x < 17 ? -1 : 1);
  const net = new THREE.Group();
  net.name = "RustChamberSafetyGrille";
  net.position.set(17, 2.2, 26.55);
  scene.add(net);
  for (const x of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.4, 0.14), steel);
    bar.position.x = x;
    net.add(bar);
  }
  for (const y of [-2.15, -1.05, 0, 1.05, 2.15]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.16), worn);
    bar.position.y = y;
    net.add(bar);
  }
  const netBody = physics.addBox({ x: 5.2, y: 4.4, z: 0.2 }, net.position);
  const fallenChain = new THREE.Group();
  fallenChain.name = "ReleasedWinchChain";
  scene.add(fallenChain);
  const looseLinks = Array.from({ length: 15 }, (_, index) => {
    const link = new THREE.Mesh(chainGeometry, worn);
    link.rotation.y = index % 2 ? Math.PI / 2 : 0;
    fallenChain.add(link);
    return link;
  });
  let lift = 0,
    chainReleasedAt = -1,
    clampReleasedAt = -1;
  let melting: {
    time: number;
    position: THREE.Vector3;
    camera: THREE.Vector3;
  } | null = null;

  type Presentation = {
    kind: "release" | "mirror" | "poem";
    time: number;
    returning: boolean;
    returnTime: number;
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
    fov: number;
    from: THREE.Vector3;
    focus: THREE.Vector3;
    nextFocus?: THREE.Vector3;
    impactTime: number;
  };
  let presentation: Presentation | null = null;
  type MirrorHit = { target: Breakable; at: number; beam: number };
  let mirrorShot: { time: number; hits: MirrorHit[]; bonus: boolean } | null =
    null;
  function playable() {
    return (
      active &&
      !paused &&
      !disposed &&
      !presentation &&
      !melting &&
      player.isEnabled() &&
      player.getHealth() > 0
    );
  }
  function hidePrompt() {
    if (ownsPrompt) prompt?.classList.add("hidden");
    ownsPrompt = false;
  }
  function startPresentation(
    kind: Presentation["kind"],
    focus: THREE.Vector3,
    nextFocus?: THREE.Vector3,
    impactTime = 0,
  ) {
    if (preview || !active || presentation || melting) return;
    if (skipCinematics) {
      if (kind === "poem") {
        reading.classList.remove("hidden");
        setInputHint(closeReading, "E / Return");
      }
      return;
    }
    presentation = {
      kind,
      time: 0,
      returning: false,
      returnTime: 0,
      position: camera.position.clone(),
      rotation: camera.quaternion.clone(),
      fov: camera.fov,
      from: focus
        .clone()
        .add(
          kind === "poem"
            ? new THREE.Vector3(0, 0.05, 2.7)
            : focus.x > 29
              ? new THREE.Vector3(-3.4, 0.6, 0)
              : new THREE.Vector3(-3.1, 1.1, -4.6),
        ),
      focus: focus.clone(),
      nextFocus: nextFocus?.clone(),
      impactTime,
    };
    player.clearInput();
    player.setInputLocked(true);
    player.body.velocity.set(0, 0, 0);
    hidePrompt();
    caption.classList.add("hidden");
    reading.classList.toggle("hidden", kind !== "poem");
    visitUI?.setVisible(false);
    setInputHint(closeReading, "E / Return");
  }
  function endPresentation() {
    const state = presentation;
    if (!state) return;
    camera.position.copy(state.position);
    camera.quaternion.copy(state.rotation);
    camera.fov = state.fov;
    camera.updateProjectionMatrix();
    presentation = null;
    reading.classList.add("hidden");
    player.clearInput();
    player.setInputLocked(false);
    visitUI?.setVisible(active && !disposed);
  }
  const breakables = createBreakables(scene, world);
  function release(id: string) {
    loot.cleared.add(id);
    if (id === CHAIN) chainReleasedAt = clock;
    if (
      (id === CLAMP || id === FAR_CLAMP) &&
      broken(CLAMP) &&
      broken(FAR_CLAMP)
    )
      clampReleasedAt = clock;
    const item = breakables.objects.find((item) => item.id === id);
    if (BOLTS.includes(id) && !BOLTS.every(broken)) return;
    if (id !== BARS) playSfx("servo", 0.18);
    if (item && id !== BARS && !mirrorShot)
      startPresentation("release", item.root.position);
  }
  for (const [index, y] of [9.4, 10.15, 10.9].entries()) {
    breakables.add(
      BOLTS[index],
      "crowbar",
      new THREE.Vector3(17, y, 27.25),
      new THREE.Vector3(2.2, 0.55, 0.65),
      release,
    );
    box([2.7, 0.12, 0.25], [17, y - 0.34, 27.45], steel, false);
  }
  // A low, open-front winch alcove keeps the chain within normal melee reach.
  box([2.7, 0.3, 3.4], [32.6, 4.1, 20.1], rusted);
  for (const z of [18.5, 21.7]) box([2.7, 4, 0.3], [32.6, 2, z], rusted);
  breakables.add(
    BARS,
    "crowbar",
    new THREE.Vector3(31.2, 1.4, 20.1),
    new THREE.Vector3(0.2, 2.8, 2.9),
    release,
    {
      showBox: false,
      decorate(root, material) {
        for (const z of [-1.2, -0.6, 0, 0.6, 1.2]) {
          const bar = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 2.8, 0.1),
            material,
          );
          bar.position.z = z;
          root.add(bar);
        }
        for (const y of [-1.25, 1.25]) {
          const rail = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.12, 2.8),
            material,
          );
          rail.position.y = y;
          root.add(rail);
        }
      },
    },
  );
  breakables.add(
    CHAIN,
    "crowbar",
    new THREE.Vector3(32.9, 1.8, 20.1),
    new THREE.Vector3(0.4, 3.3, 0.45),
    release,
    {
      hits: 3,
      showBox: false,
      decorate(root, material) {
        for (let index = 0; index < 15; index++) {
          const link = new THREE.Mesh(chainGeometry.clone(), material);
          link.position.y = 1.65 - index * 0.22;
          link.rotation.y = index % 2 ? Math.PI / 2 : 0;
          root.add(link);
        }
      },
    },
  );
  const firstMirrorPoint = new THREE.Vector3(17.5, 5.8, 13);
  const secondMirrorPoint = new THREE.Vector3(33, 5.8, 16);
  const clampPoint = firstMirrorPoint.clone().lerp(secondMirrorPoint, 0.8);
  const clamp = breakables.add(
    CLAMP,
    "pistol",
    clampPoint,
    new THREE.Vector3(0.8, 1.3, 1.2),
    release,
  );
  for (const y of [-0.55, 0.55]) {
    const jaw = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.2, 1.9),
      clamp.material,
    );
    jaw.position.y = y;
    clamp.root.add(jaw);
  }
  const farClamp = breakables.add(
    FAR_CLAMP,
    "pistol",
    new THREE.Vector3(1, 5.8, 16),
    new THREE.Vector3(0.8, 1.3, 1.2),
    release,
  );
  const shieldCrystal = createRecoveryPickup(
    "shield",
    new THREE.Vector3(1, 0.5, 15.3),
  );
  shieldCrystal.root.name = "RustMirrorBonusShield";
  shieldCrystal.root.visible = loot.bonusShield === "available";
  scene.add(shieldCrystal.root);
  let crystalDropTime = -1;
  const hangingPoint = ropeStart
    .clone()
    .lerp(ropeEnd, 0.5)
    .add(new THREE.Vector3(0, 1.1, 0));
  breakables.add(
    HANGING,
    "crowbar",
    hangingPoint,
    new THREE.Vector3(0.65, 0.7, 0.65),
    release,
  );
  const hanger = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 13.8 - hangingPoint.y - 0.35, 8),
    steel,
  );
  hanger.position.set(
    hangingPoint.x,
    (13.8 + hangingPoint.y + 0.35) / 2,
    hangingPoint.z,
  );
  scene.add(hanger);
  const mirrors: Reflector[] = [];
  function addMirror(
    position: THREE.Vector3,
    incoming: THREE.Vector3,
    outgoing: THREE.Vector3,
  ) {
    const normal = outgoing
      .clone()
      .normalize()
      .sub(incoming.clone().normalize())
      .normalize();
    const mirror = new Reflector(new THREE.PlaneGeometry(1.8, 1.8), {
      clipBias: 0.004,
      textureWidth: preview ? 256 : 512,
      textureHeight: preview ? 256 : 512,
      color: 0xb7cbd0,
    });
    mirror.name = `RustChamberMirror-${mirrors.length + 1}`;
    mirror.position.copy(position);
    mirror.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mirror.camera.layers.enable(1);
    scene.add(mirror);
    const frame = new THREE.Group();
    frame.position.copy(position);
    frame.quaternion.copy(mirror.quaternion);
    scene.add(frame);
    for (const x of [-0.97, 0.97]) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 2.07, 0.16),
        worn,
      );
      edge.position.x = x;
      frame.add(edge);
    }
    for (const y of [-0.97, 0.97]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.13, 0.16), worn);
      edge.position.y = y;
      frame.add(edge);
    }
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(2.07, 2.07, 0.12),
      steel,
    );
    backing.position.z = -0.09;
    frame.add(backing);
    physics.addBoxFromMesh(backing);
    const renderReflection = mirror.onBeforeRender;
    mirror.onBeforeRender = (...args) => {
      const others = mirrors
        .filter((other) => other !== mirror)
        .map((other) => ({ other, visible: other.visible }));
      for (const { other } of others) other.visible = false;
      try {
        renderReflection.apply(mirror, args);
      } finally {
        for (const { other, visible } of others) other.visible = visible;
      }
    };
    mirrors.push(mirror);
    return mirror;
  }
  addMirror(
    firstMirrorPoint,
    firstMirrorPoint.clone().sub(new THREE.Vector3(17.5, 1.4, 8)),
    secondMirrorPoint.clone().sub(firstMirrorPoint),
  );
  addMirror(
    secondMirrorPoint,
    secondMirrorPoint.clone().sub(firstMirrorPoint),
    farClamp.root.position.clone().sub(secondMirrorPoint),
  );
  box([0.16, 5.1, 0.16], [17.5, 2.55, 13], worn);
  box([0.6, 0.2, 0.6], [17.5, 0.1, 13], steel);

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x8edbff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  const beamGeometry = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
  const reflectedBeams = Array.from({ length: 5 }, () => {
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.name = "RustReflectedShot";
    beam.visible = false;
    scene.add(beam);
    return beam;
  });
  let beamLife = 0;
  function notifyJam() {
    setInputHint(
      caption,
      "The relay is out of sync. Both blue clasps must break together. Use the rebuild console.",
      "foot",
      true,
    );
    captionTime = popupDuration(6);
    caption.classList.remove("hidden");
  }
  function reflectShot(point: THREE.Vector3, _origin: THREE.Vector3) {
    if (preview || !active || melting) return;
    scene.updateMatrixWorld(true);
    const initialMirror = mirrors.find((mirror) => {
      const local = mirror.worldToLocal(point.clone());
      return (
        Math.abs(local.z) < 0.035 &&
        Math.abs(local.x) < 0.9 &&
        Math.abs(local.y) < 0.9
      );
    });
    if (!initialMirror) return;
    if (presentation || mirrorShot) return;
    if (clamp.broken !== farClamp.broken) {
      notifyJam();
      return;
    }
    const bothIntact = !clamp.broken && !farClamp.broken;
    const hits: MirrorHit[] = [];
    const position = initialMirror.position.clone(),
      direction = new THREE.Vector3();
    let mirror: Reflector | undefined = initialMirror;
    const ignored: THREE.Object3D[] = [...reflectedBeams];
    for (const beam of reflectedBeams) beam.visible = false;
    for (let bounce = 0; bounce < reflectedBeams.length; bounce++) {
      if (mirror) {
        // These aligned relay mirrors guide any hit on their face onto the next puzzle element.
        const destination =
          mirror === mirrors[0]
            ? clamp.broken || hits.some((hit) => hit.target === clamp)
              ? secondMirrorPoint
              : clamp.root.position
            : farClamp.root.position;
        direction.copy(destination).sub(position).normalize();
        ignored.push(mirror);
      }
      const ray = new THREE.Ray(
        position.clone().addScaledVector(direction, 0.025),
        direction.clone(),
      );
      const hit = traceShot(
        scene,
        world,
        ray,
        breakables.getDamageTargets(),
        ignored,
        65,
      );
      const beam = reflectedBeams[bounce],
        offset = hit.point.clone().sub(position);
      beam.position.copy(position).add(hit.point).multiplyScalar(0.5);
      beam.scale.y = offset.length();
      beam.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        offset.normalize(),
      );
      beam.visible = bounce === 0;
      beamLife = 0.22;
      if (hit.target === clamp || hit.target === farClamp) {
        hits.push({
          target: hit.target === clamp ? clamp : farClamp,
          at: hits.length ? 1.65 : 0.6,
          beam: bounce,
        });
        ignored.push(hit.target.root);
        position.copy(hit.point);
        if (hit.target === clamp)
          direction.copy(secondMirrorPoint).sub(position).normalize();
        mirror = undefined;
        continue;
      }
      mirror = mirrors.find((candidate) => candidate === hit.object);
      if (!mirror) break;
      position.copy(hit.point);
    }
    if (hits.length) {
      mirrorShot = { time: 0, hits, bonus: bothIntact && hits.length === 2 };
      startPresentation(
        "mirror",
        hits[0].target.root.position,
        hits[1]?.target.root.position,
        hits[hits.length - 1].at,
      );
      if (hits.length === 1) notifyJam();
    }
  }
  // A visible cable connects the high blue clasp to the grille's lifting eye.
  const cableCurve = new THREE.CatmullRomCurve3([
    clampPoint.clone().add(new THREE.Vector3(0, 0.8, 0)),
    new THREE.Vector3(27, 7, 24),
    new THREE.Vector3(19.6, 4.4, 26.55),
  ]);
  const cableGeometry = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
  const cableSegments = Array.from({ length: 28 }, () => {
    const segment = new THREE.Mesh(cableGeometry, steel);
    scene.add(segment);
    return segment;
  });
  const cableUp = new THREE.Vector3(0, 1, 0),
    cableDirection = new THREE.Vector3();
  breakables.restoreBroken(loot.cleared);
  const broken = (id: string) =>
    breakables.objects.some((item) => item.id === id && item.broken);
  const complete = () => RELEASES.every(broken);
  function moveBody(body: typeof shutterBody, object: THREE.Object3D) {
    body.position.set(object.position.x, object.position.y, object.position.z);
    body.quaternion.set(
      object.quaternion.x,
      object.quaternion.y,
      object.quaternion.z,
      object.quaternion.w,
    );
    body.aabbNeedsUpdate = true;
  }
  function updateMechanisms(dt: number, snap = false) {
    const count = RELEASES.filter(broken).length;
    const target = (count / RELEASES.length) * 5.35;
    const showingDoor =
      !presentation ||
      presentation.kind === "poem" ||
      presentation.time >=
        (presentation.kind === "mirror" ? presentation.impactTime + 1.45 : 1.2);
    lift = snap
      ? target
      : showingDoor
        ? THREE.MathUtils.damp(lift, target, 2.4, dt)
        : lift;
    if (count !== shownReleaseCount) {
      shownReleaseCount = count;
      const remaining = RELEASES.length - count;
      lockSegments.forEach((segment, index) => {
        segment.visible = index < remaining;
      });
      lockMaterial.color.setHex(remaining ? 0xffc06c : 0x83ffd0);
      shackle.position.y = remaining ? 0.18 : 0.31;
      shackle.rotation.z = remaining ? 0 : -0.25;
      doorStatus.userData.remaining = remaining;
    }
    shutter.position.y = 2.5 + lift;
    moveBody(shutterBody, shutter);
    gears.forEach(({ root, ratio, phase }) => {
      root.rotation.z = phase + lift * ratio;
    });
    counterweights.forEach(({ mesh, body }) => {
      mesh.position.y = 8.5 - lift;
      moveBody(body, mesh);
    });
    suspendedChains.forEach((links) =>
      links.forEach((link, index) => {
        const top = 10.65,
          bottom = shutter.position.y + 2.5,
          y = top - index * 0.2 + (lift % 0.2);
        link.visible = y >= bottom && y <= top;
        link.position.y = y;
      }),
    );
    returnChains.forEach((links, side) =>
      links.forEach((link, index) => {
        const y = 10.65 - index * 0.2 - (lift % 0.2);
        link.visible =
          y >= counterweights[side].mesh.position.y + 1 && y <= 10.65;
        link.position.y = y;
      }),
    );
    const chainGone = broken(CHAIN);
    fallenChain.visible = chainGone;
    looseLinks.forEach((link, index) => {
      const elapsed = chainReleasedAt < 0 ? 3 : clock - chainReleasedAt;
      const fall = THREE.MathUtils.clamp(
        (elapsed - index * 0.025) / 0.85,
        0,
        1,
      );
      link.position.set(
        32.9 + Math.sin(index * 1.7) * 0.35 * fall,
        THREE.MathUtils.lerp(
          3.45 - index * 0.22,
          0.08 + (index % 3) * 0.025,
          fall * fall,
        ),
        20.1 + index * 0.065 * fall,
      );
      link.rotation.x = fall * (Math.PI / 2 + Math.sin(index) * 0.3);
    });
    const clampGone = broken(CLAMP) && broken(FAR_CLAMP);
    const elapsed = clampReleasedAt < 0 ? 3 : clock - clampReleasedAt;
    const slide = clampGone
      ? THREE.MathUtils.smootherstep(elapsed, 0.65, 1.8)
      : 0;
    const angle = (slide * Math.PI) / 2;
    net.position.set(
      17,
      0.12 + 2.08 * Math.cos(angle),
      26.55 - 2.08 * Math.sin(angle),
    );
    net.rotation.x = -angle;
    net.rotation.z = 0;
    net.updateMatrixWorld(true);
    moveBody(netBody, net);
    cableCurve.points[0]
      .copy(clampPoint)
      .add(new THREE.Vector3(0, 0.8, 0))
      .lerp(new THREE.Vector3(25.3, 0.2, 26.4), slide);
    cableCurve.points[2].set(
      net.position.x + 2.6,
      net.position.y + 2.2 * Math.cos(angle),
      net.position.z - 2.2 * Math.sin(angle),
    );
    cableCurve.points[1].lerpVectors(
      cableCurve.points[0],
      cableCurve.points[2],
      0.5,
    );
    cableCurve.points[1].y -= 0.5 + slide * 1.2;
    const points = cableCurve.getPoints(cableSegments.length);
    cableSegments.forEach((segment, index) => {
      cableDirection.subVectors(points[index + 1], points[index]);
      segment.position
        .addVectors(points[index], points[index + 1])
        .multiplyScalar(0.5);
      segment.scale.y = cableDirection.length();
      segment.quaternion.setFromUnitVectors(
        cableUp,
        cableDirection.normalize(),
      );
    });
    const open = complete() && lift > 5.28 && slide > 0.98;
    rewardDoor.setLocked(!open);
    rewardDoor.update(dt, player, open);
    if (snap && open) rewardDoor.openImmediately();
  }
  updateMechanisms(0, true);

  const poem = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 2.1),
    new THREE.MeshStandardMaterial({
      map: inscriptionTexture(),
      roughness: 0.92,
      metalness: 0.15,
    }),
  );
  poem.name = "RustChamberWallPoem";
  poem.position.set(17, 2.1, 0.025);
  scene.add(poem);
  box([2.98, 2.28, 0.08], [17, 2.1, -0.025], worn, false);
  const resetCanvas = document.createElement("canvas");
  resetCanvas.width = resetCanvas.height = 256;
  const resetContext = resetCanvas.getContext("2d");
  if (!resetContext)
    throw new Error("Unable to draw the simulation reset console");
  resetContext.fillStyle = "#15252c";
  resetContext.fillRect(0, 0, 256, 256);
  resetContext.strokeStyle = "#7dbfc9";
  resetContext.lineWidth = 12;
  resetContext.beginPath();
  resetContext.arc(128, 113, 58, -Math.PI * 0.7, Math.PI * 0.9);
  resetContext.stroke();
  resetContext.fillStyle = "#7dbfc9";
  resetContext.beginPath();
  resetContext.moveTo(65, 109);
  resetContext.lineTo(47, 150);
  resetContext.lineTo(90, 142);
  resetContext.fill();
  resetContext.font = "24px sans-serif";
  resetContext.textAlign = "center";
  resetContext.fillText("REBUILD", 128, 220);
  const resetTexture = new THREE.CanvasTexture(resetCanvas);
  resetTexture.colorSpace = THREE.SRGBColorSpace;
  const resetConsole = createShipTerminal(resetTexture);
  box([0.8, 1.15, 0.16], [23, 1.35, 6.34], ship.dark);
  resetConsole.root.name = "RustChamberRebuildControl";
  resetConsole.root.position.set(23, 1.1, 6.55);
  resetConsole.root.rotation.y = Math.PI;
  scene.add(resetConsole.root);

  const raycaster = new THREE.Raycaster(),
    screenCenter = new THREE.Vector2();
  function near(point: THREE.Vector3, radius = 2.2) {
    return (
      Math.hypot(
        player.body.position.x - point.x,
        player.body.position.z - point.z,
      ) < radius && player.body.position.y < 1
    );
  }
  function poemFocused() {
    if (!near(poem.position, 3)) return false;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(screenCenter, camera);
    return raycaster.intersectObject(poem).length > 0;
  }
  function resetChamber() {
    endPresentation();
    melting = null;
    player.setInputLocked(false);
    beamLife = 0;
    reflectedBeams.forEach((beam) => {
      beam.visible = false;
    });
    mirrorShot = null;
    loot.cleared.clear();
    breakables.reset();
    chainReleasedAt = clampReleasedAt = -1;
    lift = 0;
    updateMechanisms(0, true);
    teleportPlayer(player, { x: 17, y: player.radius, z: 2.2 }, Math.PI);
    caption.classList.add("hidden");
    captionTime = 0;
    hidePrompt();
  }
  function onKey(event: KeyboardEvent) {
    if (
      event.code !== "KeyE" ||
      event.repeat ||
      event.defaultPrevented ||
      !active ||
      paused ||
      disposed ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open") ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          'button, input, textarea, select, [contenteditable="true"]',
        ))
    )
      return;
    if (skipCinematics && !reading.classList.contains("hidden")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      reading.classList.add("hidden");
      return;
    }
    if (presentation) {
      if (
        presentation.kind === "poem" &&
        presentation.time > 0.5 &&
        !presentation.returning
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        presentation.returning = true;
        presentation.returnTime = 0;
        reading.classList.add("hidden");
      }
      return;
    }
    if (!playable()) return;
    if (near(resetConsole.root.position, 1.7)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resetChamber();
    } else if (poemFocused()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startPresentation("poem", poem.position);
    }
  }
  if (!preview) window.addEventListener("keydown", onKey, true);
  const chest = createRewardChest(
    {
      scene,
      world,
      player,
      position: new THREE.Vector3(17, -0.02, 32.2),
      yaw: 0,
      reward: "keycard",
      style: "crew",
      initialCollected: loot.rewardCollected,
      unlocked: complete,
      canInteract: playable,
      onCollect: () => {
        onKeycardCollected?.();
        loot.rewardCollected = true;
        return true;
      },
    },
    modelLoader,
  );
  const visitUI =
    !preview && onRestart
      ? createCameraVisitUI({
          title: "Rust chamber",
          player,
          hasReturnMarker,
          onRestart,
          canInteract: playable,
        })
      : null;
  visitUI?.setVisible(active);
  lockedDoors.forEach((door) => visitUI?.registerLockedExit(door.group));
  scene.add(new THREE.HemisphereLight(0x9db7c8, 0x433124, 1.65));
  const key = new THREE.DirectionalLight(0xd7dfe7, 1.6);
  key.position.set(-4, 12, 6);
  scene.add(key);
  for (const [x, y, z, intensity, color] of [
    [17, 3.9, 3, 25, 0xc7e3ed],
    [8, 12, 18, 65, 0xffc28a],
    [26, 12, 19, 65, 0xffbb80],
    [17, 11.8, 25, 45, 0xf5d9ac],
    [32, 3.3, 20.1, 9, 0xffb36d],
  ]) {
    const lamp = new THREE.PointLight(color, intensity, 22, 2);
    lamp.position.set(x, y, z);
    scene.add(lamp);
  }
  const view = new THREE.PerspectiveCamera();
  function applyCinematicCamera() {
    if (melting) {
      const focus = melting.position.clone().add(new THREE.Vector3(0, 0.4, 0));
      camera.position
        .copy(melting.camera)
        .lerp(
          focus.clone().add(new THREE.Vector3(2.8, 2, -3.4)),
          THREE.MathUtils.smoothstep(melting.time, 0, 0.5),
        );
      camera.lookAt(focus);
      return true;
    }
    const state = presentation;
    if (!state) return false;
    const position = state.from.clone(),
      focus = state.focus.clone();
    const readingFov = camera.aspect < 1 ? 62 : 48;
    if (state.kind === "poem") {
      const distance = Math.max(
        2.7,
        (2.8 * 1.12) /
          (2 *
            Math.tan(THREE.MathUtils.degToRad(readingFov / 2)) *
            camera.aspect),
      );
      position.copy(focus).add(new THREE.Vector3(0, 0, distance));
    }
    if (state.kind === "release") {
      const travel = THREE.MathUtils.smootherstep(state.time, 0.45, 1.2);
      position.lerp(new THREE.Vector3(24, 6.8, 17.5), travel);
      focus.lerp(new THREE.Vector3(17, 6.2, 26.85), travel);
    }
    if (state.kind === "mirror") {
      const across = THREE.MathUtils.smootherstep(state.time, 0.95, 1.45);
      focus.copy(state.focus).lerp(state.nextFocus ?? state.focus, across);
      position.copy(focus).add(new THREE.Vector3(0, 1.3, -5.5));
      const fenceView = THREE.MathUtils.smootherstep(
        state.time,
        state.impactTime + 0.4,
        state.impactTime + 0.65,
      );
      position.lerp(new THREE.Vector3(24, 6.8, 17.5), fenceView);
      focus.lerp(new THREE.Vector3(17, 6.2, 26.85), fenceView);
    }
    view.position.copy(position);
    view.lookAt(focus);
    const blend = state.returning
      ? 1 - THREE.MathUtils.smootherstep(state.returnTime, 0, 0.6)
      : THREE.MathUtils.smootherstep(state.time, 0, 0.45);
    camera.position.lerpVectors(state.position, view.position, blend);
    camera.quaternion.slerpQuaternions(state.rotation, view.quaternion, blend);
    camera.fov = THREE.MathUtils.lerp(
      state.fov,
      state.kind === "poem" ? readingFov : 56,
      blend,
    );
    camera.updateProjectionMatrix();
    return true;
  }
  return {
    roomId: "rust-chamber",
    scene,
    camera,
    player,
    physicsWorld: world,
    cutsceneManager: null,
    ready: chest.ready,
    getSceneId: () => "stage2-rust",
    getMapLayout: () => cameraVisitMap(38),
    getMapSceneId: () => "scene38",
    getMusicTrack: () => "stealth-2" as const,
    activate() {
      active = true;
      ui.classList.remove("hidden");
      visitUI?.setVisible(true);
      player.clearInput();
      player.enable();
    },
    controlsReady: playable,
    isCinematic: () => !!presentation || !!melting,
    get ownsWeaponInput() {
      return !!presentation || !!melting;
    },
    getCinematicState: () =>
      presentation || melting
        ? {
            ...player.getState(),
            isMoving: false,
            actionRequest: null,
            crouching: false,
            sprinting: false,
            sliding: false,
            climbing: false,
            boxHandling: false,
          }
        : null,
    getCinematicPose: () =>
      presentation || melting
        ? {
            clip: "Idle_Loop" as const,
            time: melting?.time ?? presentation!.time,
            loop: true,
          }
        : null,
    getHologramTransition: () =>
      melting
        ? {
            blend: 0,
            opacity: 1 - THREE.MathUtils.smoothstep(melting.time, 1.8, 2.8),
            time: melting.time,
            melt: THREE.MathUtils.clamp(melting.time / 2.8, 0, 1),
          }
        : null,
    getCinematicDelta: () => lastDelta,
    applyCinematicCamera,
    applyCameraEffects() {
      if (!playable()) return;
      camera.translateX(ropeSway);
      camera.rotateZ(ropeRoll);
    },
    getTightropeState: () => ({
      balance: ropeBalance,
      progress: ropeProgress,
      roll: ropeRoll,
      sway: ropeSway,
    }),
    getDamageTargets: () =>
      playable()
        ? breakables
            .getDamageTargets()
            .filter((item) => item !== clamp && item !== farClamp)
        : [],
    onPistolShot: reflectShot,
    canPlaceMarker(position: { x: number; y: number; z: number }) {
      return position.x > 6.05 &&
        position.x < 15.95 &&
        position.z > 11.05 &&
        position.z < 24.15 &&
        position.y - player.radius <= water.position.y + 0.05
        ? "The corrosive water cannot hold a marker. Place it on solid ground."
        : null;
    },
    setGogglesActive: breakables.setHighlighted,
    setMenuPaused(value: boolean) {
      paused = value;
      player.clearInput();
    },
    updateInteractionFocus() {
      if (!playable()) {
        hidePrompt();
        return;
      }
      const text = near(resetConsole.root.position, 1.7)
        ? "E / Rebuild chamber"
        : poemFocused()
          ? "E / Read inscription"
          : "";
      if (text && prompt) {
        prompt.textContent = inputHint(text);
        prompt.classList.remove("hidden");
        ownsPrompt = true;
      } else hidePrompt();
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || paused || document.hidden) return;
      const frame = Number.isFinite(dt)
        ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime)
        : 0;
      if (!active && !preview) return;
      lastDelta = frame;
      clock += frame;
      sumpWater.update(clock);
      if (mirrorShot) {
        mirrorShot.time += frame;
        for (const hit of mirrorShot.hits) {
          if (mirrorShot.time >= hit.at && !hit.target.broken) {
            reflectedBeams.forEach((beam, index) => {
              beam.visible = index <= hit.beam;
            });
            beamLife = 0.4;
            hit.target.damage(25, "pistol");
          }
        }
        if (mirrorShot.hits.every((hit) => hit.target.broken)) {
          if (mirrorShot.bonus && !loot.bonusShield) {
            loot.bonusShield = "available";
            crystalDropTime = 0;
            shieldCrystal.root.visible = true;
            shieldCrystal.root.position.copy(farClamp.root.position);
          }
          mirrorShot = null;
        }
      }
      updateMechanisms(frame);
      breakables.update(frame);
      beamLife = Math.max(0, beamLife - frame);
      if (!beamLife)
        reflectedBeams.forEach((beam) => {
          beam.visible = false;
        });
      shieldCrystal.root.visible = loot.bonusShield === "available";
      if (shieldCrystal.root.visible) {
        shieldCrystal.update(clock);
        if (crystalDropTime >= 0) {
          crystalDropTime += frame;
          const fall = Math.min(5.3, 4.91 * crystalDropTime * crystalDropTime);
          shieldCrystal.root.position.set(
            1,
            5.8 - fall,
            16 - Math.min(0.7, crystalDropTime * 0.7),
          );
          if (fall >= 5.3) crystalDropTime = -1;
        }
        if (
          !preview &&
          playable() &&
          crystalDropTime < 0 &&
          shieldCrystal.root.position.distanceTo(
            new THREE.Vector3(
              player.body.position.x,
              player.body.position.y + 0.3,
              player.body.position.z,
            ),
          ) < 1.25 &&
          player.addShield(25)
        ) {
          loot.bonusShield = "collected";
          shieldCrystal.root.visible = false;
        }
      }
      if (!preview) {
        if (!melting) physics.step(frame, player, thirdPerson);
        const p = player.body.position;
        if (
          !melting &&
          p.x > 6.05 &&
          p.x < 15.95 &&
          p.z > 11.05 &&
          p.z < 24.15 &&
          p.y - player.radius <= -0.48
        ) {
          endPresentation();
          melting = {
            time: skipCinematics ? 3.2 : 0,
            position: new THREE.Vector3(p.x, p.y, p.z),
            camera: camera.position.clone(),
          };
          player.clearInput();
          player.setInputLocked(true);
          player.body.velocity.set(0, 0, 0);
          hidePrompt();
          visitUI?.setVisible(false);
        }
        if (melting) {
          melting.time += frame;
          player.body.position.y =
            melting.position.y - Math.min(0.35, melting.time * 0.13);
          if (melting.time >= 3.2) {
            melting = null;
            player.setInputLocked(false);
            teleportPlayer(
              player,
              { x: 17, y: player.radius, z: 2.2 },
              Math.PI,
            );
            camera.fov = 68;
            camera.updateProjectionMatrix();
            visitUI?.setVisible(active);
          }
        }
        chest.update(frame);
        visitUI?.update();
        if (active && !greeted) {
          greeted = true;
          setInputHint(
            caption,
            "Prime: This is one of Brendan's simulation rooms.",
            "foot",
            true,
            true,
          );
          captionTime = popupDuration(5);
          caption.classList.remove("hidden");
        }
        if (presentation) {
          presentation.time += frame;
          if (
            presentation.kind !== "poem" &&
            presentation.time >=
              (presentation.kind === "mirror"
                ? presentation.impactTime + 3.65
                : 3.3) &&
            !presentation.returning
          ) {
            presentation.returning = true;
            presentation.returnTime = 0;
          }
          if (presentation.returning) {
            presentation.returnTime += frame;
            if (presentation.returnTime >= 0.6) endPresentation();
          }
        }
        updateRopeBalance(frame);
        captionTime = Math.max(0, captionTime - frame);
        if (!captionTime) caption.classList.add("hidden");
      }
    },
    syncProgress() {
      if (
        breakables.objects.some(
          (item) => item.broken !== loot.cleared.has(item.id),
        )
      ) {
        breakables.reset();
        breakables.restoreBroken(loot.cleared);
        chainReleasedAt = clampReleasedAt = -1;
        updateMechanisms(0, true);
      }
      if (loot.rewardCollected) chest.setCollected();
      shieldCrystal.root.visible = loot.bonusShield === "available";
    },
    minimap: { bounds: { minX: 0, maxX: 34, minZ: 0, maxZ: 34 }, floor: 0 },
    dispose() {
      if (disposed) return;
      disposed = true;
      endPresentation();
      hidePrompt();
      window.removeEventListener("keydown", onKey, true);
      visitUI?.dispose();
      chest.dispose();
      breakables.dispose();
      mirrors.forEach((mirror) => mirror.dispose());
      ui.remove();
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}
