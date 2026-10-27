import { playSfx, playItemPickupSound } from "../../helpers/audio/sfx.js";
import * as THREE from "three";
import { inputHint } from "../../scripts/player/gamepadInput.js";
import { renderDirectionalPrompt } from "../../scripts/player/directionalPrompt.js";
import {
  teleportPlayer,
  createTeleportCrystal,
} from "../../scripts/global/teleportationDevice.js";
import { BAY_THIRTEEN_MAP } from "../level 1 stage 2/stageTwoLayout.js";
import * as CANNON from "cannon-es";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { loadBoyModel, preloadBossModels } from "../../core/loader.js";
import {
  createScenePhysics,
  PHYSICS,
} from "../../helpers/physics/scenePhysics.js";
import {
  roomBox,
  createSlidingPortal,
  disposeRoom,
} from "../../scripts/global/shipRoom.js";
import { createHangarVersus } from "../../scripts/global/hangarVersus.js";
import { createHoldToSkip } from "../../scripts/global/holdToSkip.js";
import { createRecoveryPickup } from "../../scripts/global/recoveryPickup.js";
import { hologramTransitionAt } from "../../scripts/player/characterManager.js";
import fireVertexShader from "../../shaders/vert/fireExplosion.vert.glsl?raw";
import fireFragmentShader from "../../shaders/frag/fireExplosion.frag.glsl?raw";
import {
  createPlayer,
  type PlayerTransitionState,
} from "../../scripts/player/player.js";
import {
  BOSS_RULES,
  PHASE4_RULES,
  createLoadingBayBoss,
  type BossPillar,
} from "../../scripts/npc/mechBaymaxBoss.js";
import { preloadMusic } from "../../helpers/audio/bufferedMusic.js";
import { MUSIC_URLS } from "../../helpers/audio/gameMusic.js";

export const BOSS_ENTRY_SECONDS = 7;
export const BOSS_VERSUS_SECONDS = 2.6;
export const ARENA_PILLAR_SUPPLIES = [
  { id: "warden-shield-west", kind: "shield", x: -13, z: -15 },
  { id: "warden-health-west", kind: "health", x: -13, z: 15 },
  { id: "warden-health-east", kind: "health", x: 13, z: -15 },
  { id: "warden-shield-east", kind: "shield", x: 13, z: 15 },
] as const;
let lastAttemptSupplies = new Set<string>();

export function preloadAssets() {
  return Promise.all([preloadMusic(MUSIC_URLS.ship), preloadBossModels()]);
}

/** Bay 13 arena, reached through the surveillance service elevator. */
export function createScene({
  entryState,
  fromServiceLift = false,
  defeated = false,
  checkpoint = false,
  startAtPhaseFour = false,
  onDefeated,
  onDescend,
  onRespawn,
  loadBoy = loadBoyModel,
  loadDrone,
  loadBoss,
  renderer,
}: {
  entryState?: PlayerTransitionState;
  fromServiceLift?: boolean;
  defeated?: boolean;
  checkpoint?: boolean;
  startAtPhaseFour?: boolean;
  onDefeated?: () => void;
  onRespawn?: (phaseFour?: boolean) => void;
  onDescend?: (state: PlayerTransitionState) => void;
  loadBoy?: () => Promise<GLTF>;
  loadDrone?: () => Promise<GLTF>;
  loadBoss?: () => Promise<GLTF>;
  renderer?: THREE.WebGLRenderer;
  healthPackCollected?: boolean;
  onHealthPackCollected?: () => void;
} = {}) {
  const collectedSupplies = defeated
    ? lastAttemptSupplies
    : (lastAttemptSupplies = new Set<string>());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101a28);
  scene.fog = new THREE.Fog(0x101a28, 35, 95);
  const physics = createScenePhysics(),
    physicsWorld = physics.world;
  // Tight bounds avoid narrow-phase work for distant limbs, drones, and room geometry.
  physicsWorld.broadphase.useBoundingBoxes = true;
  const broadphase = physicsWorld.broadphase;
  const needsCollision = broadphase.needBroadphaseCollision;
  // Cannon still runs expensive overlap-only narrowphase for kinematic pairs.
  // This arena scripts the rig, cinematic passenger, and lift; none use overlap events.
  // Their room clearance comes from sweeps. Keep all dynamic contacts and raycasts.
  broadphase.needBroadphaseCollision = function (a, b) {
    return (
      (a.type === CANNON.Body.DYNAMIC || b.type === CANNON.Body.DYNAMIC) &&
      needsCollision.call(this, a, b)
    );
  };
  const steel = new THREE.MeshStandardMaterial({
    color: 0x3e5060,
    metalness: 0.65,
    roughness: 0.48,
  });
  const wall = new THREE.MeshStandardMaterial({
    color: 0x566575,
    metalness: 0.4,
    roughness: 0.7,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x202d3a,
    metalness: 0.6,
    roughness: 0.55,
  });
  const amber = new THREE.MeshStandardMaterial({
    color: 0xeaa64c,
    emissive: 0xb36419,
    emissiveIntensity: 0.65,
  });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x93dbef });
  const box = (
    s: [number, number, number],
    p: [number, number, number],
    m: THREE.Material = steel,
    solid = true,
  ) => roomBox(scene, physics, s, p, m, solid);
  // A real circular opening lets the lift descend through the deck.
  const deckShape = new THREE.Shape();
  deckShape.moveTo(-20, -24);
  deckShape.lineTo(20, -24);
  deckShape.lineTo(20, 24);
  deckShape.lineTo(-20, 24);
  deckShape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 4.5, 0, Math.PI * 2, true);
  deckShape.holes.push(hole);
  const deckGeometry = new THREE.ExtrudeGeometry(deckShape, {
    depth: 0.5,
    bevelEnabled: false,
    curveSegments: 24,
  });
  deckGeometry.rotateX(-Math.PI / 2);
  deckGeometry.translate(0, -0.5, 0);
  const deck = new THREE.Mesh(deckGeometry, dark);
  deck.receiveShadow = true;
  scene.add(deck);
  const vertices = Array.from(deckGeometry.attributes.position.array);
  const deckBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Trimesh(
      vertices,
      Array.from({ length: vertices.length / 3 }, (_, i) => i),
    ),
  });
  physicsWorld.addBody(deckBody);
  const platform = new THREE.Group();
  platform.name = "HangarElevator";
  scene.add(platform);
  const liftDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(4.5, 4.5, 0.4, 48),
    steel,
  );
  liftDeck.position.y = -0.2;
  platform.add(liftDeck);
  // A parked lift is walkable static ground; scripted descent owns it only after E.
  const liftBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    mass: 0,
    material: physics.solidMaterial,
    shape: new CANNON.Cylinder(4.5, 4.5, 0.4, 48),
  });
  liftBody.position.y = -0.2;
  physicsWorld.addBody(liftBody);
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(4.62, 4.62, 14, 48, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x293645,
      side: THREE.BackSide,
      metalness: 0.5,
      roughness: 0.6,
    }),
  );
  shaft.position.y = -7.2;
  scene.add(shaft);
  const consoleRoot = new THREE.Group();
  consoleRoot.name = "ElevatorConsole";
  consoleRoot.position.set(0, defeated ? 0 : -1.5, -2.8);
  platform.add(consoleRoot);
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.6), steel);
  pedestal.position.y = 0.55;
  consoleRoot.add(pedestal);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.42, 0.09), cyan);
  screen.position.set(0, 1.12, -0.3);
  screen.rotation.x = -0.2;
  consoleRoot.add(screen);
  const consoleBody = physics.addBox(
    { x: 0.8, y: 1.3, z: 0.7 },
    { x: 0, y: 0.65, z: -2.8 },
  );
  consoleBody.collisionResponse = defeated;
  box([0.6, 14, 48], [-20, 7, 0], wall);
  box([0.6, 14, 48], [20, 7, 0], wall);
  box([40, 14, 0.6], [0, 7, 24], wall);
  box([40, 0.5, 48], [0, 14, 0], dark);
  box([40, 3, 0.5], [0, 1.5, -24], wall);
  const door = createSlidingPortal(
    scene,
    physics,
    { x: 0, y: 3, z: -24, yaw: 0 },
    40,
    11,
    "SERVICE ELEVATOR / BAY 13",
    { landingFloor: !fromServiceLift, sign: false },
  );
  if (fromServiceLift) {
    box([4.4, 0.2, 3.6], [0, 2.9, -25.8], steel);
    box([4.4, 0.16, 3.6], [0, 6.2, -25.8], dark);
    box([4.4, 3.2, 0.18], [0, 4.6, -27.6], wall);
    for (const x of [-2.2, 2.2]) {
      box([0.18, 3.2, 3.6], [x, 4.6, -25.8], wall);
      box([0.04, 0.1, 2.2], [x * 0.96, 5.6, -25.8], cyan, false);
    }
    const light = new THREE.PointLight(0x93dbef, 12, 7);
    light.position.set(0, 5.9, -25.8);
    scene.add(light);
  }
  box([5, 3, 3], [0, 1.5, -22.5], steel);
  const stairs = physics.addStaircase({
    width: 5,
    run: 9,
    rise: 3,
    position: { x: 0, y: 0, z: -12 },
    yaw: Math.PI,
    stepCount: 18,
    material: steel,
  });
  stairs.group.name = "ArenaEntryStairs";
  scene.add(stairs.group);
  // Rails follow the physical wedge rather than obstructing the walkable stair surface.
  for (const x of [-2.65, 2.65]) {
    for (let i = 0; i <= 6; i++)
      box([0.12, 1, 0.12], [x, 0.5 + i * 0.5, -12 - i * 1.5], amber);
    const rail = box(
      [0.13, 0.13, Math.hypot(9, 3)],
      [x, 2.5, -16.5],
      amber,
      false,
    );
    rail.rotation.x = Math.atan(3 / 9);
    physics.addBoxFromMesh(rail);
    box([0.14, 1, 3], [x, 3.5, -22.5], amber);
  }
  const pillars: THREE.Mesh[] = [],
    covers: BossPillar[] = [];
  const arenaSupplies: Array<{
    id: string;
    kind: "health" | "shield";
    collected: boolean;
    pickup: ReturnType<typeof createRecoveryPickup>;
  }> = [];
  const rubble: Array<{
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
  }> = [];
  const rubbleGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const { id, kind, x, z } of ARENA_PILLAR_SUPPLIES) {
    const side = Math.sign(x);
    // Rear service recesses hold supplies; full-volume colliders retain the original cover behavior.
    const pillar = box([2.5, 14, 3], [x - side * 0.25, 7, z], wall, false);
    pillar.name = "ArenaCoverPillar";
    pillars.push(pillar);
    const parts = [
      pillar,
      box([3.5, 0.35, 3.5], [x, 0.175, z], steel, false),
      box([0.5, 0.4, 3], [x + side * 1.25, 0.2, z], wall, false),
      box([0.5, 12.6, 3], [x + side * 1.25, 7.7, z], wall, false),
    ];
    for (const offset of [-1, 1])
      parts.push(
        box([0.5, 1, 1], [x + side * 1.25, 0.9, z + offset], wall, false),
      );
    const bodies = [
      physics.addBox({ x: 3, y: 14, z: 3 }, { x, y: 7, z }),
      physics.addBox({ x: 3.5, y: 0.35, z: 3.5 }, { x, y: 0.175, z }),
    ];
    for (const y of [1.55, 5.5, 10])
      parts.push(
        box([3.06, 0.16, 3.06], [x, y, z], y === 1.55 ? amber : dark, false),
      );
    const pickup = createRecoveryPickup(
      kind,
      new THREE.Vector3(x + side * 1.25, 0.88, z),
      { compact: true, illuminate: false },
    );
    pickup.root.name = id;
    pickup.root.visible = !collectedSupplies.has(id);
    pickup.root.userData.minimap = false;
    scene.add(pickup.root);
    arenaSupplies.push({
      id,
      kind,
      collected: collectedSupplies.has(id),
      pickup,
    });
    let intact = true;
    covers.push({
      position: new THREE.Vector3(x, 0, z),
      intact: () => intact,
      shatter() {
        if (!intact) return;
        intact = false;
        parts.forEach((part) => {
          part.visible = false;
        });
        bodies.forEach((body) => physicsWorld.removeBody(body));
        for (let i = 0; i < 42; i++) {
          const mesh = new THREE.Mesh(rubbleGeometry, i % 4 ? wall : steel);
          mesh.scale.set(0.3 + (i % 3) * 0.25, 0.35 + (i % 4) * 0.18, 0.45);
          mesh.position.set(
            x + Math.sin(i) * 1.2,
            0.5 + (i / 42) * 13,
            z + Math.cos(i) * 1.2,
          );
          scene.add(mesh);
          rubble.push({
            mesh,
            velocity: new THREE.Vector3(
              Math.sin(i * 4) * 6,
              2 + (i % 5),
              Math.cos(i * 7) * 6,
            ),
            life: 7,
          });
        }
      },
    });
  }
  for (let z = -20; z <= 20; z += 4) {
    if (Math.abs(z) >= 5) box([39, 0.015, 0.025], [0, 0.012, z], steel, false);
    for (const x of [-19.64, 19.64])
      box([0.05, 0.12, 2.8], [x, 3, z], cyan, false);
  }
  // Giant sealed cargo doors and a loading lane establish the second bay.
  for (const x of [-5.1, 5.1]) box([9.8, 10, 0.2], [x, 5, 23.63], dark, false);
  for (let x = -9; x <= 9; x += 1.5)
    box([0.08, 9.2, 0.06], [x, 5, 23.48], steel, false);
  for (const x of [-6, 6]) box([0.16, 0.016, 34], [x, 0.014, 2], amber, false);
  for (const x of [-12, 0, 12])
    box([0.5, 0.12, 38], [x, 13.65, 0], cyan, false);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.35, 4.48, 64), amber);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  platform.add(ring);
  scene.add(new THREE.HemisphereLight(0xb8d8ff, 0x31343a, 2));
  for (const x of [-10, 10])
    for (const z of [-10, 10]) {
      const light = new THREE.PointLight(0xb4dbff, 120, 35);
      light.position.set(x, 11, z);
      scene.add(light);
    }
  const keyLight = new THREE.DirectionalLight(0xf4e9d2, 2.5);
  keyLight.position.set(-5, 12, -8);
  scene.add(keyLight);

  // --- Phase 4 room-light dimming (additive; round 1 change 2b). Snapshot the bay lights exactly as
  // they stand before the beacons/player/boss exist, so we can scale them down during the intro and
  // restore them when gravity returns. Phases 1-3 are untouched (the tween only runs in phase 4). ---
  const roomLights: Array<{ light: THREE.Light; base: number }> = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Light)
      roomLights.push({ light: node, base: node.intensity });
  });
  let roomLightScale = 1,
    lightTween: {
      from: number;
      to: number;
      time: number;
      duration: number;
    } | null = null;
  function applyRoomLightScale(scale: number) {
    roomLightScale = scale;
    for (const entry of roomLights) entry.light.intensity = entry.base * scale;
  }
  function startLightDim(to: number, duration: number) {
    lightTween = {
      from: roomLightScale,
      to,
      time: 0,
      duration: Math.max(0.001, duration),
    };
  }
  function updateLightDim(dt: number) {
    if (!lightTween) return;
    lightTween.time += dt;
    const t = Math.min(1, lightTween.time / lightTween.duration);
    applyRoomLightScale(
      THREE.MathUtils.lerp(
        lightTween.from,
        lightTween.to,
        THREE.MathUtils.smootherstep(t, 0, 1),
      ),
    );
    if (t >= 1) lightTween = null;
  }

  // --- Phase 4 red alarm beacons (additive; change 5). Built once, hidden until zero-G, disposed on exit. ---
  // Four spinning emissive beacons in the upper corners; at most 2 real lights (no shadows) for performance.
  const beacons: Array<{ spin: THREE.Mesh }> = [];
  const beaconLights: THREE.SpotLight[] = [];
  const beaconLightTargets: THREE.Object3D[] = [];
  const beaconHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2f36,
    metalness: 0.7,
    roughness: 0.5,
  });
  const beaconLensMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a0000,
    emissive: PHASE4_RULES.beaconColor,
    emissiveIntensity: PHASE4_RULES.beaconEmissiveIntensity,
    side: THREE.DoubleSide,
    metalness: 0.2,
    roughness: 0.35,
  });
  const beaconBaseGeometry = new THREE.BoxGeometry(0.72, 0.16, 0.72);
  const beaconHousingGeometry = new THREE.CylinderGeometry(0.34, 0.4, 0.5, 16);
  const beaconLensGeometry = new THREE.CylinderGeometry(
    0.27,
    0.27,
    0.36,
    16,
    1,
    false,
    0,
    Math.PI,
  );
  const beaconGroup = new THREE.Group();
  beaconGroup.name = "Phase4Beacons";
  beaconGroup.visible = false;
  scene.add(beaconGroup);
  let beaconTime = 0;
  {
    const bx = 20 - PHASE4_RULES.beaconInsetX,
      bz = 24 - PHASE4_RULES.beaconInsetZ;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const mount = new THREE.Group();
        mount.position.set(sx * bx, PHASE4_RULES.beaconY, sz * bz);
        const base = new THREE.Mesh(beaconBaseGeometry, beaconHousingMaterial);
        base.position.y = -0.32;
        mount.add(base);
        const housing = new THREE.Mesh(
          beaconHousingGeometry,
          beaconHousingMaterial,
        );
        mount.add(housing);
        const spin = new THREE.Mesh(beaconLensGeometry, beaconLensMaterial);
        spin.scale.setScalar(PHASE4_RULES.beaconScale);
        spin.position.y = 0.02;
        mount.add(spin);
        beacons.push({ spin });
        beaconGroup.add(mount);
        // Only two real lights (diagonal corners) so the shader light budget stays small; no shadows.
        // Round 1 change 2c: rotating red SpotLights whose targets sweep the walls, floor and ceiling.
        if (sx > 0 === sz > 0) {
          const light = new THREE.SpotLight(
            PHASE4_RULES.beaconColor,
            PHASE4_RULES.beaconSpotIntensity,
            PHASE4_RULES.beaconSpotDistance,
            PHASE4_RULES.beaconSpotAngle,
            PHASE4_RULES.beaconSpotPenumbra,
            PHASE4_RULES.beaconSpotDecay,
          );
          light.castShadow = false;
          light.visible = false;
          light.position.copy(mount.position);
          const target = new THREE.Object3D();
          target.position.set(0, PHASE4_RULES.beaconSweepHeightCenter, 0);
          light.target = target;
          beaconGroup.add(light);
          beaconGroup.add(target);
          beaconLights.push(light);
          beaconLightTargets.push(target);
        }
      }
  }

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    150,
  );
  const player = createPlayer({
    camera,
    physicsWorld,
    spawnPosition: { x: 0, y: 3.3, z: -22.8 },
  });
  player.enable();
  if (fromServiceLift)
    teleportPlayer(
      player,
      { x: 0, y: 3 + player.radius, z: -25.2 },
      Math.PI,
      entryState,
    );
  else if (entryState) player.restoreTransition(entryState, door.frame);
  else player.setRotation(Math.PI);
  if (checkpoint) player.setPosition(0, 0.3, defeated ? -6.2 : -10.2);
  door.openImmediately();
  let deathClock = 0;
  let respawnAtPhaseFour = startAtPhaseFour;
  const markPhaseFour = () => {
    const p = boss.getStatus().phase;
    if (p === "zeroG" || p === "phaseFourReturn" || p === "phaseFourAwakening")
      respawnAtPhaseFour = true;
  };
  let bossVictory = false;
  let disposed = false,
    cleared = defeated,
    cinematic:
      | "entry"
      | "versus"
      | "awakening"
      | "reveal"
      | "lift"
      | "bossReturn"
      | "gravityIntro"
      | null = defeated || checkpoint || startAtPhaseFour ? null : "entry",
    cinematicTime = 0;
  let versus: ReturnType<typeof createHangarVersus> | null = null;
  let arenaSupplyTime = 0,
    supplyNoticeTime = 0;
  let droneCutscene: {
    root: THREE.Object3D;
    stage: "incoming" | "impact";
    clock: number;
    time: number;
    poseTime: number;
    impactPosition: THREE.Vector3 | null;
    start: THREE.Vector3;
    dodge: THREE.Vector3;
    impactStart: THREE.Vector3;
    recoil: THREE.Vector3;
    yaw: number;
    pitch: number;
    side: number;
    attackAngle: number;
    envelope: THREE.Box3;
  } | null = null;
  type OrbitShot = {
    kind: "boss" | "drone";
    bounds: THREE.Box3;
    points: THREE.Vector3[];
    focus: THREE.Vector3;
    angle: number;
    sweep: number;
    distance: number;
    height: number;
  };
  let orbitShot: OrbitShot | null = null,
    awakeningReleaseClock = -1;
  const cameraUp = new THREE.Vector3(0, 1, 0);
  const shotStart = new THREE.Vector3(),
    shotRotation = new THREE.Quaternion();
  let shotFov = 70,
    returnClock = 0,
    returnFov = 70;
  const returnPosition = new THREE.Vector3(),
    returnRotation = new THREE.Quaternion();
  const revealOrigin = new THREE.Vector3();
  function captureShot() {
    shotStart.copy(camera.position);
    shotRotation.copy(camera.quaternion);
    shotFov = returnClock > 0 ? shotFov : camera.fov;
    returnClock = 0;
    orbitShot = null;
  }
  function returnToBattle() {
    returnPosition.copy(camera.position);
    returnRotation.copy(camera.quaternion);
    returnFov = camera.fov;
    returnClock = 0.3;
    camera.fov = shotFov;
    camera.updateProjectionMatrix();
    subtitles?.classList.add("hidden");
    if (!disposed && !deathClock) release();
  }
  function dodgeDestination(
    start: THREE.Vector3,
    direction: THREE.Vector3,
    reach = 1.05,
  ) {
    let distance = reach;
    const across = new THREE.Vector3(-direction.z, 0, direction.x);
    for (const offset of [-player.radius, 0, player.radius])
      for (const height of [0.1, 0.8]) {
        const from = start.clone().addScaledVector(across, offset);
        from.y += height;
        const to = from
          .clone()
          .addScaledVector(direction, distance + player.radius);
        physicsWorld.raycastAll(
          new CANNON.Vec3(from.x, from.y, from.z),
          new CANNON.Vec3(to.x, to.y, to.z),
          { checkCollisionResponse: true },
          (hit) => {
            if (
              hit.body !== player.body &&
              hit.body?.type !== CANNON.Body.DYNAMIC
            )
              distance = Math.min(
                distance,
                Math.max(0, hit.distance - player.radius - 0.08),
              );
          },
        );
      }
    return start.clone().addScaledVector(direction, distance);
  }
  let cinematicDelta = 0;
  let liftTransferred = false;
  const liftPassenger = new THREE.Vector3();
  const boyOrigin = new THREE.Vector3();
  const prompt = document.getElementById("interact-prompt");
  function nearConsole() {
    return (
      cleared &&
      !cinematic &&
      player.isEnabled() &&
      player.getState().isOnGround &&
      Math.hypot(player.body.position.x, player.body.position.z + 2.8) < 1.65 &&
      Math.hypot(player.body.position.x, player.body.position.z) < 4.2
    );
  }
  function onKey(event: KeyboardEvent) {
    if (event.code !== "KeyE" || event.repeat || !nearConsole() || !onDescend)
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, button, [contenteditable="true"]')
    )
      return;
    event.preventDefault();
    cinematic = "lift";
    cinematicTime = 0;
    liftPassenger.set(
      player.body.position.x,
      player.radius,
      player.body.position.z,
    );
    for (const body of [liftBody, consoleBody]) {
      body.type = CANNON.Body.KINEMATIC;
      body.updateMassProperties();
      body.wakeUp();
    }
    freeze();
    player.body.collisionResponse = false;
    prompt?.classList.add("hidden");
  }
  window.addEventListener("keydown", onKey);
  const entryStart = new THREE.Vector3().copy(player.body.position);
  const entryWalkYaw = Math.atan2(entryStart.x, entryStart.z + 10.2);
  if (cinematic === "entry") player.setRotation(entryWalkYaw, 0);
  let boy: THREE.Group | null = null,
    boyMixer: THREE.AnimationMixer | null = null;
  let boyError = false;
  const hud = document.getElementById("boss-hud"),
    fill = document.getElementById("boss-health-fill");
  const label = document.getElementById("boss-health-label");
  const subtitles = document.getElementById("boss-subtitles");
  function showSubtitle(text: string) {
    if (!subtitles) return;
    delete subtitles.dataset.primeHint;
    const colon = text.indexOf(":"),
      speaker = colon > 0 ? text.slice(0, colon).toUpperCase() : "",
      line = colon > 0 ? text.slice(colon + 1).trimStart() : text;
    const formatted =
      subtitles.dataset.dialogueSpeaker === speaker &&
      subtitles.dataset.dialogueLine === line &&
      subtitles.textContent === line;
    if (subtitles.textContent !== text && !formatted)
      subtitles.textContent = text;
    subtitles.classList.remove("hidden");
  }
  // --- Phase 4 HUD (thruster heat + entanglement pips) and near-miss slow-mo / camera state. ---
  const phase4Hud = document.getElementById("phase4-hud");
  const phase4Heat = document.getElementById("phase4-heat-fill");
  const phase4Pips = document.getElementById("phase4-entangle-pips");
  // Round 1 change 2d: centre-screen flashing "gravity offline" warning shown during the intro.
  const warningEl = document.getElementById("phase4-warning");
  const NEAR_MISS = { duration: 0.4, slowMo: 0.45, fovPunch: 9, offset: 0.14 };
  let nearMissClock = 0,
    nearMissSide = 1,
    nearMissBaseFov = 70,
    nearMissApplied = false,
    phaseNoticeTime = 0;
  const nearMissRight = new THREE.Vector3();
  // Wall push-off prompt elements (change 4) and zero-G camera-sway state (change 2).
  const pushPrompt = {
    container: document.getElementById("phase4-push-prompt"),
    left: document.getElementById("phase4-push-left"),
    right: document.getElementById("phase4-push-right"),
    top: document.getElementById("phase4-push-top"),
    bottom: document.getElementById("phase4-push-bottom"),
  };
  let frameDt = 1 / 60,
    cameraSwayCurrent = 0;
  const swayRight = new THREE.Vector3();
  function triggerNearMiss(side: number) {
    nearMissSide = Math.sign(side) || 1;
    nearMissClock = NEAR_MISS.duration;
  }
  function showPhaseNotice(text: string, seconds = 3.2) {
    if (!subtitles) return;
    showSubtitle(text);
    if (/^Prime:/i.test(text)) subtitles.dataset.primeHint = "true";
    phaseNoticeTime = seconds;
  }
  // --- Phase 4 teleport crystal: hold Q to charge, left click to throw, then teleport to where it lands. ---
  const THROW = {
    chargeSeconds: 1.1,
    minCharge: 0.12,
    minSpeed: 12,
    maxSpeed: 36,
    life: 2.2,
    cooldown: 1.2,
    behindDistance: 1.5,
    bossClearance: 3,
  };
  let qHeld = false,
    throwCharge = 0,
    throwCooldown = 0;
  let crystal: {
    mesh: THREE.Group;
    velocity: THREE.Vector3;
    life: number;
    spin: number;
  } | null = null;
  let landed: { mesh: THREE.Group; destination: THREE.Vector3 } | null = null;
  const throwHud = document.createElement("div");
  throwHud.id = "boss-teleport-prompt";
  throwHud.style.cssText =
    "position:fixed;left:50%;top:58%;transform:translate(-50%,-50%) rotate(-1deg);" +
    "z-index:30;pointer-events:none;max-width:min(82vw,340px);padding:10px 16px;" +
    "border:1px solid rgba(194,133,255,.38);border-radius:12px 3px 12px 3px;" +
    "background:rgba(28,12,44,.38);box-shadow:3px 3px 0 rgba(0,0,0,.18);" +
    "font:600 clamp(12px,1.2vw,16px) 'Comic Sans MS',system-ui,sans-serif;" +
    "color:#e8d4ff;text-align:center;text-shadow:0 1px 3px #120920;opacity:.84;display:none;";
  const throwPrime = document.createElement("div");
  throwPrime.dataset.primeHint = "true";
  const throwSpeaker = document.createElement("span");
  throwSpeaker.textContent = "Prime:";
  throwSpeaker.style.color = "#7fe3ff";
  const throwDialogue = document.createElement("span");
  throwDialogue.textContent = " We need to teleport behind it.";
  throwPrime.append(throwSpeaker, throwDialogue);
  const throwControls = document.createElement("div");
  throwControls.style.cssText =
    "display:flex;align-items:center;justify-content:center;gap:7px;margin-top:5px;font-size:12px;";
  const throwKey = document.createElement("span");
  const throwLabel = document.createElement("div");
  const throwBar = document.createElement("div");
  throwBar.style.cssText =
    "width:170px;height:6px;margin:6px auto 0;border:1px solid #bd77ff;background:rgba(20,6,40,.35);border-radius:6px;overflow:hidden;";
  const throwFill = document.createElement("div");
  throwFill.style.cssText =
    "height:100%;width:0%;background:linear-gradient(90deg,#8d38e5,#e0b3ff);";
  throwBar.appendChild(throwFill);
  throwControls.append(throwKey, throwLabel);
  throwHud.append(throwPrime, throwControls, throwBar);
  document.body.appendChild(throwHud);
  const throwTemp = new THREE.Vector3(),
    throwDirection = new THREE.Vector3(),
    throwFrom = new THREE.Vector3();
  function throwActive() {
    return (
      !disposed &&
      !cleared &&
      !cinematic &&
      !droneCutscene &&
      player.isEnabled() &&
      player.getHealth() > 0 &&
      boss.isTeleportWindow()
    );
  }
  function onThrowKey(event: KeyboardEvent) {
    if (
      event.code !== "KeyQ" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      !throwActive()
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, [contenteditable="true"]')
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat && throwCooldown <= 0 && !crystal) qHeld = true;
  }
  function onThrowKeyUp(event: KeyboardEvent) {
    if (event.code === "KeyQ") {
      qHeld = false;
      throwCharge = 0;
    }
  }
  function onThrowMouse(event: MouseEvent) {
    if (event.button !== 0 || !qHeld || !throwActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (throwCharge < THROW.minCharge || crystal) return;
    camera.getWorldDirection(throwDirection);
    throwFrom.copy(camera.position).addScaledVector(throwDirection, 0.6);
    const mesh = createTeleportCrystal();
    mesh.scale.setScalar(1.6);
    mesh.position.copy(throwFrom);
    scene.add(mesh);
    crystal = {
      mesh,
      velocity: throwDirection
        .clone()
        .multiplyScalar(
          THREE.MathUtils.lerp(THROW.minSpeed, THROW.maxSpeed, throwCharge),
        ),
      life: THROW.life,
      spin: 0,
    };
    qHeld = false;
    throwCharge = 0;
  }
  window.addEventListener("keydown", onThrowKey, true);
  window.addEventListener("keyup", onThrowKeyUp, true);
  window.addEventListener("mousedown", onThrowMouse, true);
  function landCrystal(point: THREE.Vector3) {
    if (!crystal) return;
    const mesh = crystal.mesh;
    crystal = null;
    throwCooldown = THROW.cooldown;
    if (!throwActive()) {
      mesh.removeFromParent();
      return;
    }
    const bossPosition = boss.getRootPosition(throwTemp);
    const dest = point.clone();
    dest.x = THREE.MathUtils.clamp(
      dest.x,
      PHASE4_RULES.boundsMinX + 1,
      PHASE4_RULES.boundsMaxX - 1,
    );
    dest.z = THREE.MathUtils.clamp(
      dest.z,
      PHASE4_RULES.boundsMinZ + 1,
      PHASE4_RULES.boundsMaxZ - 1,
    );
    dest.y = THREE.MathUtils.clamp(
      dest.y,
      1.4,
      PHASE4_RULES.boundsCeiling - 1.2,
    );
    let dx = dest.x - bossPosition.x,
      dz = dest.z - bossPosition.z;
    const gap = Math.hypot(dx, dz);
    if (gap < THROW.bossClearance) {
      const scale = THROW.bossClearance / Math.max(gap, 1e-3);
      if (gap < 1e-3) {
        dx = 0;
        dz = -1;
      }
      dest.x = bossPosition.x + dx * scale;
      dest.z = bossPosition.z + dz * scale;
    }
    landed?.mesh.removeFromParent();
    mesh.position.copy(dest);
    landed = { mesh, destination: dest };
  }
  // The thrown crystal only marks a spot; the player chooses when to blink there with T.
  // Hologram dissolve out (0.3 s), blink, then the standard hologram arrival.
  const TELEPORT_OUT = 0.3,
    TELEPORT_IN = 1.1;
  let teleportFx = -1,
    teleportPending: THREE.Vector3 | null = null;
  function teleportToCrystal() {
    if (!landed || !throwActive() || teleportFx >= 0) return;
    teleportPending = landed.destination.clone();
    teleportFx = 0;
    landed.mesh.removeFromParent();
    landed = null;
  }
  function stepTeleportFx(dt: number) {
    if (teleportFx < 0) return;
    teleportFx += dt;
    if (teleportPending && teleportFx >= TELEPORT_OUT) {
      const dest = teleportPending;
      teleportPending = null;
      if (throwActive()) {
        const bossPosition = boss.getRootPosition(throwTemp);
        player.setPosition(dest.x, dest.y, dest.z);
        player.setRotation(
          Math.atan2(dest.x - bossPosition.x, dest.z - bossPosition.z),
          -0.05,
        );
        player.clearZeroGTaps();
        if (boss.onPlayerTeleport())
          showPhaseNotice(
            "Prime: He's confused! Shoot the blue target on his back!",
          );
      }
    }
    if (teleportFx >= TELEPORT_OUT + TELEPORT_IN) {
      teleportFx = -1;
      teleportPending = null;
    }
  }
  function onTeleportKey(event: KeyboardEvent) {
    if (
      event.code !== "KeyT" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      !landed ||
      !throwActive()
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) teleportToCrystal();
  }
  window.addEventListener("keydown", onTeleportKey, true);
  function updateThrow(dt: number) {
    stepTeleportFx(dt);
    throwCooldown = Math.max(0, throwCooldown - dt);
    const active = throwActive();
    if (!active) {
      if (qHeld) {
        qHeld = false;
        throwCharge = 0;
      }
      if (crystal && boss.getStatus().phase !== "zeroG") {
        crystal.mesh.removeFromParent();
        crystal = null;
      }
      if (landed) {
        landed.mesh.removeFromParent();
        landed = null;
      }
    }
    if (landed) landed.mesh.rotation.y += dt * 2;
    if (qHeld)
      throwCharge = Math.min(1, throwCharge + dt / THROW.chargeSeconds);
    throwHud.style.display = active ? "block" : "none";
    if (active) {
      throwFill.style.width = `${Math.round(throwCharge * 100)}%`;
      renderDirectionalPrompt(
        throwKey,
        landed ? ["KeyT"] : throwCooldown > 0 || qHeld ? [] : ["KeyQ"],
      );
      throwLabel.textContent = landed
        ? "TELEPORT"
        : throwCooldown > 0
          ? "RECHARGING"
          : qHeld
            ? inputHint("Click to throw")
            : "HOLD TO CHARGE";
    }
    if (!crystal) return;
    crystal.life -= dt;
    crystal.spin += dt * 9;
    crystal.mesh.rotation.set(crystal.spin, crystal.spin * 0.7, 0);
    const from = crystal.mesh.position,
      to = from.clone().addScaledVector(crystal.velocity, dt);
    let distance = Infinity;
    physicsWorld.raycastAll(
      new CANNON.Vec3(from.x, from.y, from.z),
      new CANNON.Vec3(to.x, to.y, to.z),
      { checkCollisionResponse: true },
      (hit) => {
        if (
          hit.body &&
          hit.body !== player.body &&
          hit.body.type === CANNON.Body.STATIC
        )
          distance = Math.min(distance, hit.distance);
      },
    );
    const outside = to.y < 0.3 || to.y > PHASE4_RULES.boundsCeiling;
    // A throw that passes the boss lands behind him instead.
    const bossAt = boss.getRootPosition(throwTemp),
      yaw = boss.getYaw();
    const segX = to.x - from.x,
      segZ = to.z - from.z,
      segLen = Math.max(segX * segX + segZ * segZ, 1e-6);
    const along = THREE.MathUtils.clamp(
      ((bossAt.x - from.x) * segX + (bossAt.z - from.z) * segZ) / segLen,
      0,
      1,
    );
    const nearBoss =
      Math.hypot(
        from.x + segX * along - bossAt.x,
        from.z + segZ * along - bossAt.z,
      ) < 3.4 && from.y < 10;
    if (nearBoss) {
      const behind = new THREE.Vector3(
        bossAt.x - Math.sin(yaw) * 4.6,
        THREE.MathUtils.clamp(from.y, 2.5, 7),
        bossAt.z - Math.cos(yaw) * 4.6,
      );
      crystal.mesh.position.copy(behind);
      landCrystal(behind);
    } else if (distance !== Infinity) {
      const direction = crystal.velocity.clone().normalize();
      landCrystal(
        from.clone().addScaledVector(direction, Math.max(0, distance - 0.7)),
      );
    } else if (outside || crystal.life <= 0) landCrystal(from.clone());
    else from.copy(to);
  }
  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "scene-dialogue-skip hidden";
  document.body.appendChild(skipButton);
  function finishVictoryDialogue() {
    if (disposed || cinematic !== "reveal" || cleared) return;
    cloud.visible = false;
    disposeDefeatCutscene();
    finishBoyDisintegration();
    consoleRoot.position.y = 0;
    cinematic = null;
    cleared = true;
    door.setLocked(false);
    consoleBody.collisionResponse = true;
    release();
    subtitles?.classList.add("hidden");
    skipButton.classList.add("hidden");
    onDefeated?.();
  }
  const skipHold = createHoldToSkip({
    button: skipButton,
    onSkip: finishVictoryDialogue,
    isAvailable: () =>
      !disposed && cinematic === "reveal" && cinematicTime >= 3.5,
  });
  // --- Defeat cutscene: the Warden splits in half, Branden walks out, then the shell self-destructs. ---
  const BLAST_AT = 21,
    WALK_AWAY_AT = 17,
    KNEEL_AT = BLAST_AT + 1.8,
    DISSOLVE_AT = BLAST_AT + 7.6,
    DISSOLVE_SECONDS = 4.2,
    STAND_AT = BLAST_AT + 12.5,
    REVEAL_END = BLAST_AT + 17.5;
  const BLAST_SLOWMO_SECONDS = 1.6,
    BLAST_FRONT_SPEED = 9,
    BRANDEN_FALL_SECONDS = 1.1,
    BRANDEN_DISSOLVE_COLOR = 0xff2438;
  let brendanImpactAt = BLAST_AT,
    revealDelta = 0;
  type BossHalf = NonNullable<
    ReturnType<typeof boss.createSplitHalves>
  >[number];
  let halves: BossHalf[] = [],
    halfGlows: THREE.Mesh[] = [];
  const revealD = new THREE.Vector3(0, 0, -1),
    revealR = new THREE.Vector3(-1, 0, 0);
  const revealPlayerStart = new THREE.Vector3(),
    revealBrendanStart = new THREE.Vector3();
  const revealPlayerEnd = new THREE.Vector3(),
    revealBrendanEnd = new THREE.Vector3(),
    brendanDeathPosition = new THREE.Vector3();
  const tmpA = new THREE.Vector3(),
    tmpB = new THREE.Vector3();
  let boyClips: THREE.AnimationClip[] = [],
    boyAction: THREE.AnimationAction | null = null,
    boyClipName = "",
    boyDead = false;
  const boyDissolveUniforms = {
    defeatTime: { value: 0 },
    defeatBlend: { value: 0 },
    defeatDissolve: { value: 0 },
    defeatColor: { value: new THREE.Color(BRANDEN_DISSOLVE_COLOR) },
  };
  const boyOriginalMaterials = new Set<THREE.Material>();
  function prepareBoyDisintegration() {
    if (!boy) return;
    const materials = new Map<THREE.Material, THREE.Material>();
    const prepare = (original: THREE.Material) => {
      const existing = materials.get(original);
      if (existing) return existing;
      boyOriginalMaterials.add(original);
      const material = original.clone();
      material.customProgramCacheKey = () => "branden-red-disintegration";
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, boyDissolveUniforms);
        shader.vertexShader =
          "varying vec3 defeatPosition;\n" +
          shader.vertexShader.replace(
            "#include <project_vertex>",
            "#include <project_vertex>\ndefeatPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
          );
        shader.fragmentShader =
          "varying vec3 defeatPosition;\nuniform float defeatTime;\nuniform float defeatBlend;\nuniform float defeatDissolve;\nuniform vec3 defeatColor;\n" +
          shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `#include <dithering_fragment>
            float cell = fract(sin(dot(floor(defeatPosition * 32.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            if (cell < defeatDissolve) discard;
            float scan = 0.65 + 0.35 * sin(defeatPosition.y * 130.0 - defeatTime * 8.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, defeatColor * scan, defeatBlend);
            gl_FragColor.rgb += defeatColor * 1.4 * defeatBlend * (1.0 - smoothstep(0.0, 0.09, cell - defeatDissolve));`,
          );
      };
      materials.set(original, material);
      return material;
    };
    boy.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.material = Array.isArray(node.material)
        ? node.material.map(prepare)
        : prepare(node.material);
      node.castShadow = false;
    });
  }
  function finishBoyDisintegration() {
    if (boy?.userData.disintegrated) return;
    boyDead = true;
    boyDissolveUniforms.defeatDissolve.value = 1;
    if (boy) {
      boy.visible = false;
      boy.userData.disintegrated = true;
    }
    boyMixer?.stopAllAction();
  }
  let revealBlasted = false,
    revealShake = 0,
    previousLocalClipping: boolean | null = null;
  function playBoy(name: "walk" | "talk" | "idle" | "death") {
    if (!boyMixer || boyClipName === name) return;
    const pattern =
      name === "walk"
        ? /^Walk_Loop$/i
        : name === "talk"
          ? /Idle_Talking/i
          : name === "death"
            ? /^Death01$/i
            : /^Idle_Loop$/i;
    const clip =
      boyClips.find((item) => pattern.test(item.name)) ??
      boyClips.find((item) => /idle/i.test(item.name));
    if (!clip) return;
    boyClipName = name;
    if (name === "talk") playSfx("brendan", 0.8);
    const next = boyMixer.clipAction(clip);
    next.reset();
    next.setLoop(
      name === "death" ? THREE.LoopOnce : THREE.LoopRepeat,
      Infinity,
    );
    next.clampWhenFinished = name === "death";
    next.timeScale =
      name === "death" ? clip.duration / BRANDEN_FALL_SECONDS : 1;
    if (boyAction && boyAction !== next)
      next.crossFadeFrom(boyAction, name === "death" ? 0.06 : 0.25, false);
    next.play();
    boyAction = next;
  }
  const blastGroup = new THREE.Group();
  blastGroup.name = "WardenSelfDestruct";
  blastGroup.visible = false;
  scene.add(blastGroup);
  const blastCoreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa040,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const blastFlashMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff4d0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const blastRingMaterial = new THREE.MeshBasicMaterial({
    color: 0xc58cff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const blastSphereGeometry = new THREE.SphereGeometry(1, 24, 16);
  const blastCore = new THREE.Mesh(blastSphereGeometry, blastCoreMaterial),
    blastFlash = new THREE.Mesh(blastSphereGeometry, blastFlashMaterial);
  const blastRing = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 1, 48),
    blastRingMaterial,
  );
  blastRing.rotation.x = -Math.PI / 2;
  blastGroup.add(blastCore, blastFlash, blastRing);
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shieldBubble = new THREE.Mesh(blastSphereGeometry, shieldMaterial);
  shieldBubble.visible = false;
  shieldBubble.frustumCulled = false;
  scene.add(shieldBubble);
  const shieldLatticeMaterial = new THREE.MeshBasicMaterial({
    color: 0x9fe8ff,
    wireframe: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shieldLattice = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 2),
    shieldLatticeMaterial,
  );
  shieldLattice.visible = false;
  shieldLattice.frustumCulled = false;
  scene.add(shieldLattice);
  const shieldRingMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shieldRing = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 48),
    shieldRingMaterial,
  );
  shieldRing.rotation.x = -Math.PI / 2;
  shieldRing.visible = false;
  scene.add(shieldRing);
  const shieldLight = new THREE.PointLight(0x6fd8ff, 0, 14, 1.6);
  scene.add(shieldLight);
  const shrapnelGeometry = new THREE.BoxGeometry(1, 1, 1),
    shrapnelMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1224,
      emissive: 0x6a1fc4,
      emissiveIntensity: 0.6,
      metalness: 0.6,
      roughness: 0.4,
    });
  const shrapnelInstances = new THREE.InstancedMesh(
    shrapnelGeometry,
    shrapnelMaterial,
    48,
  );
  shrapnelInstances.name = "WardenShrapnel";
  shrapnelInstances.visible = false;
  shrapnelInstances.frustumCulled = false;
  shrapnelInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(shrapnelInstances);
  const shrapnel = Array.from({ length: 48 }, () => {
    const mesh = new THREE.Object3D();
    mesh.visible = false;
    return {
      mesh,
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      moving: false,
    };
  });
  // Detailed self-destruct extras: layered fireballs, rising smoke, streaking sparks, a scorch mark, a flash light and pre-blast bursts.
  // Fire shader fireballs (shared with the eye-drone explosions), one material each so they can age independently.
  const fireMaterials: THREE.ShaderMaterial[] = [];
  const fireballs = Array.from({ length: 3 }, (_, i) => {
    const uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uIntensity: { value: 1 },
      uCameraLocal: { value: new THREE.Vector3() },
      uColorCore: { value: new THREE.Color(0xfff2b0) },
      uColorMid: { value: new THREE.Color(0xff8a1f) },
      uColorEdge: { value: new THREE.Color(0xc41608) },
      uColorSmoke: { value: new THREE.Color(0x1a1613) },
    };
    const material = new THREE.ShaderMaterial({
      name: "WardenFireExplosion",
      uniforms,
      vertexShader: fireVertexShader,
      fragmentShader: fireFragmentShader,
      transparent: true,
      depthWrite: false,
      // The directed billow must engulf Branden, not be depth-rejected behind him.
      depthTest: i !== 0,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    fireMaterials.push(material);
    const mesh = new THREE.Mesh(blastSphereGeometry, material);
    mesh.frustumCulled = false;
    blastGroup.add(mesh);
    mesh.onBeforeRender = (_renderer, _scene, cam) => {
      cam.getWorldPosition(uniforms.uCameraLocal.value);
      mesh.worldToLocal(uniforms.uCameraLocal.value);
    };
    return {
      mesh,
      uniforms,
      offset: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 2.5 - 1,
        (Math.random() - 0.5) * 3,
      ),
      impact: i === 0,
      delay: i * 0.09,
      size: i === 0 ? 2.4 : 3.4 + Math.random(),
    };
  });
  const smokeMaterial = new THREE.MeshBasicMaterial({
    color: 0x17101e,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const smokeGeometry = new THREE.SphereGeometry(1, 12, 8);
  const smokePuffs = Array.from({ length: 10 }, () => {
    const mesh = new THREE.Mesh(smokeGeometry, smokeMaterial);
    blastGroup.add(mesh);
    return {
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        1 + Math.random() * 2,
        (Math.random() - 0.5) * 3,
      ),
      size: 1.4 + Math.random() * 1.6,
    };
  });
  const sparkGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.55),
    sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const sparkInstances = new THREE.InstancedMesh(
    sparkGeometry,
    sparkMaterial,
    70,
  );
  sparkInstances.name = "WardenExplosionSparks";
  sparkInstances.visible = false;
  sparkInstances.frustumCulled = false;
  sparkInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(sparkInstances);
  const sparks = Array.from({ length: 70 }, () => {
    const mesh = new THREE.Object3D();
    mesh.visible = false;
    return { mesh, velocity: new THREE.Vector3(), life: 0 };
  });
  const hiddenParticleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  function syncParticleInstances(
    instances: THREE.InstancedMesh,
    entries: Array<{ mesh: THREE.Object3D }>,
  ) {
    let visible = false;
    for (let i = 0; i < entries.length; i++) {
      const mesh = entries[i].mesh;
      if (mesh.visible) {
        visible = true;
        mesh.updateMatrix();
        instances.setMatrixAt(i, mesh.matrix);
      } else instances.setMatrixAt(i, hiddenParticleMatrix);
    }
    instances.visible = visible;
    instances.instanceMatrix.needsUpdate = true;
  }
  const scorchMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const scorchGeometry = new THREE.CircleGeometry(4.2, 40);
  scorchGeometry.rotateX(-Math.PI / 2);
  const scorch = new THREE.Mesh(scorchGeometry, scorchMaterial);
  scorch.visible = false;
  scorch.position.y = 0.03;
  scene.add(scorch);
  const blastLight = new THREE.PointLight(0xff8a3a, 0, 60, 1.5);
  scene.add(blastLight);
  const preBursts = Array.from({ length: 6 }, () => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xd9a0ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(blastSphereGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, material, life: 0, size: 1 };
  });
  let preBurstClock = 0;
  function emitSparks(origin: THREE.Vector3, count: number, speed: number) {
    let spawned = 0;
    for (const spark of sparks) {
      if (spawned >= count) break;
      if (spark.life > 0) continue;
      spark.life = 0.9 + Math.random() * 1.4;
      spark.mesh.visible = true;
      spark.mesh.position.copy(origin);
      spark.velocity
        .set(
          Math.random() - 0.5,
          Math.random() * 0.9 + 0.1,
          Math.random() - 0.5,
        )
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      spawned++;
    }
  }
  function emitPreBurst(position: THREE.Vector3, size: number) {
    const burst = preBursts.find((item) => item.life <= 0);
    if (!burst) return;
    burst.life = 0.45;
    burst.size = size;
    burst.mesh.visible = true;
    burst.mesh.position.copy(position);
    emitSparks(position, 6, 7);
  }
  function setupDefeatCutscene() {
    const origin = revealOrigin;
    // The robot always dies facing the stairs (-z) so the vertical cut runs cleanly along the room axis.
    revealD.set(0, 0, -1);
    revealR.set(-1, 0, 0);
    revealBrendanStart
      .copy(origin)
      .addScaledVector(revealD, 3.6)
      .addScaledVector(revealR, 0.5);
    revealPlayerStart
      .copy(origin)
      .addScaledVector(revealD, 5.2)
      .addScaledVector(revealR, -2.2);
    revealBrendanEnd
      .copy(origin)
      .addScaledVector(revealD, 4.9)
      .addScaledVector(revealR, 0.5);
    revealPlayerEnd
      .copy(origin)
      .addScaledVector(revealD, 7.3)
      .addScaledVector(revealR, -2.2);
    brendanDeathPosition.copy(revealBrendanEnd).addScaledVector(revealD, 2);
    tmpA.copy(origin).setY(3);
    tmpB.copy(revealBrendanEnd).setY(1);
    brendanImpactAt =
      BLAST_AT + Math.max(0, tmpA.distanceTo(tmpB) - 1) / BLAST_FRONT_SPEED;
    revealDelta = 0;
    revealBlasted = false;
    revealShake = 0;
    boyDead = false;
    boyDissolveUniforms.defeatBlend.value = 0;
    boyDissolveUniforms.defeatDissolve.value = 0;
    boyClipName = "";
    scorch.visible = false;
    scorchMaterial.opacity = 0;
    if (renderer) {
      previousLocalClipping = renderer.localClippingEnabled;
      renderer.localClippingEnabled = true;
    }
    halves = boss.createSplitHalves() ?? [];
    halfGlows = halves.map((half) => {
      half.group.rotation.set(0, Math.PI, 0);
      scene.add(half.group);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 6.4),
        new THREE.MeshBasicMaterial({
          color: 0xb45cff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      glow.rotation.y = Math.PI / 2;
      glow.position.set(0, 3.2, 0);
      half.group.add(glow);
      return glow;
    });
    player.setPosition(revealPlayerStart.x, player.radius, revealPlayerStart.z);
    player.setRotation(Math.atan2(revealD.x, revealD.z) + Math.PI);
    if (boy) {
      boy.visible = false;
      boy.position.copy(boyOrigin).add(origin);
      boy.rotation.set(0, Math.atan2(revealD.x, revealD.z), 0);
    }
    playBoy("walk");
  }
  function disposeDefeatCutscene() {
    for (const half of halves) half.dispose();
    for (const glow of halfGlows) {
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
      glow.removeFromParent();
    }
    halves = [];
    halfGlows = [];
    if (renderer && previousLocalClipping !== null) {
      renderer.localClippingEnabled = previousLocalClipping;
      previousLocalClipping = null;
    }
    blastGroup.visible = false;
    shrapnelInstances.visible = false;
    sparkInstances.visible = false;
    shieldBubble.visible = false;
    shieldLattice.visible = false;
    shieldRing.visible = false;
    shieldLight.intensity = 0;
    shrapnel.forEach((piece) => {
      piece.mesh.visible = false;
    });
    sparks.forEach((spark) => {
      spark.life = 0;
      spark.mesh.visible = false;
    });
    preBursts.forEach((burst) => {
      burst.life = 0;
      burst.mesh.visible = false;
    });
    blastLight.intensity = 0;
    scorchMaterial.opacity = Math.min(scorchMaterial.opacity, 0.75);
  }
  function revealSubtitle(t: number) {
    const lines: Array<[number, number, string]> = [
      [
        8.2,
        11.4,
        "Branden: Thank you, Brondon. Donus put me inside this machine.",
      ],
      [
        11.4,
        14.4,
        "Branden: The students are on the nearest planet. We have to go.",
      ],
      [14.4, 15.8, "Brondon: Let's go."],
      [BLAST_AT - 0.9, BLAST_AT + 0.9, "Prime: Shield deployed!"],
      [BLAST_AT + 1.8, BLAST_AT + 3.8, "Branden: Save them..."],
      [BLAST_AT + 4.0, BLAST_AT + 6.2, "Brondon: Stay with me, Branden!"],
      [BLAST_AT + 6.8, BLAST_AT + 9.2, "Prime: Oh no... he's gone."],
      [BLAST_AT + 9.6, BLAST_AT + 12, "Brondon: ...Branden..."],
      [
        BLAST_AT + 12.8,
        BLAST_AT + 16.6,
        "Brondon: Donus... I'll make you pay. But first, the others.",
      ],
    ];
    const line = lines.find(([from, to]) => t >= from && t < to);
    if (!subtitles) return;
    if (line) {
      showSubtitle(line[2]);
    } else subtitles.classList.add("hidden");
  }
  function updateReveal(dt: number) {
    const t = cinematicTime;
    revealSubtitle(t);
    // Halves: crack glows, slide apart, shake, then vanish in the blast.
    const crack = THREE.MathUtils.smoothstep(t, 0.6, 2.4),
      slide = THREE.MathUtils.smootherstep(t, 2.4, 5.2);
    const shake =
      t < WALK_AWAY_AT
        ? 0
        : Math.min(1, (t - WALK_AWAY_AT) / (BLAST_AT - WALK_AWAY_AT)) * 0.1;
    for (let i = 0; i < halves.length; i++) {
      const half = halves[i];
      half.group.visible = t < BLAST_AT;
      if (!half.group.visible) continue;
      const base = half.side;
      half.group.position.set(
        revealOrigin.x,
        boss.root.position.y,
        revealOrigin.z,
      );
      tmpA.set(base, 0, 0).applyQuaternion(half.group.quaternion);
      half.group.position.addScaledVector(
        tmpA,
        slide * 1.5 + Math.sin(t * 90 + i) * shake * 0.5,
      );
      half.group.position.y += Math.sin(t * 77 + i * 2) * shake * 0.4;
      half.plane.setFromNormalAndCoplanarPoint(
        tmpB.set(base, 0, 0).applyQuaternion(half.group.quaternion),
        half.group.position,
      );
      half.group.rotation.z = base * slide * -0.07;
      const glow = halfGlows[i];
      (glow.material as THREE.MeshBasicMaterial).opacity =
        (1 - slide * 0.5) * crack * (0.6 + Math.sin(t * 16) * 0.2);
      glow.position.x = 0;
      glow.visible = t < BLAST_AT;
    }
    // Branden: walks out between the halves at a steady pace, talks, drifts toward the lift edge, and is caught by the blast.
    if (boy && !boy.userData.disintegrated) {
      boy.visible = t >= 3.6 && t < DISSOLVE_AT + DISSOLVE_SECONDS;
      const forward = Math.atan2(revealD.x, revealD.z);
      let yaw = forward,
        walkSpeed = 0;
      if (t < 8.0) {
        const k = THREE.MathUtils.clamp((t - 3.6) / 4.4, 0, 1);
        tmpA.copy(revealOrigin).lerp(revealBrendanStart, k);
        walkSpeed = revealOrigin.distanceTo(revealBrendanStart) / 4.4;
        playBoy(k < 1 ? "walk" : "talk");
      } else if (t < WALK_AWAY_AT) {
        tmpA.copy(revealBrendanStart);
        playBoy("talk");
        yaw = Math.atan2(
          revealPlayerStart.x - tmpA.x,
          revealPlayerStart.z - tmpA.z,
        );
      } else if (t < BLAST_AT) {
        tmpA
          .copy(revealBrendanStart)
          .lerp(
            revealBrendanEnd,
            (t - WALK_AWAY_AT) / (BLAST_AT - WALK_AWAY_AT),
          );
        playBoy("walk");
        walkSpeed =
          revealBrendanStart.distanceTo(revealBrendanEnd) /
          (BLAST_AT - WALK_AWAY_AT);
        yaw = forward + Math.PI * THREE.MathUtils.smootherstep(
          t, BLAST_AT - 0.8, BLAST_AT,
        );
      } else if (t < brendanImpactAt) {
        tmpA.copy(revealBrendanEnd);
        playBoy("idle");
        yaw = forward + Math.PI;
      } else {
        const flight = THREE.MathUtils.clamp(
          (t - brendanImpactAt) / BRANDEN_FALL_SECONDS, 0, 1,
        );
        tmpA.copy(revealBrendanEnd).lerp(
          brendanDeathPosition, 1 - (1 - flight) ** 3,
        );
        tmpA.y = 4 * 0.65 * flight * (1 - flight);
        boy.rotation.z = -Math.sin(flight * Math.PI) * 0.16;
        playBoy("death");
        yaw = forward + Math.PI;
      }
      if (boyClipName === "walk" && boyAction)
        boyAction.timeScale = THREE.MathUtils.clamp(walkSpeed / 1.4, 0.4, 1.1);
      // Ease the facing so turns never snap.
      let delta = yaw - boy.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      boy.rotation.y += delta * Math.min(1, dt * 7);
      boy.position.set(
        boyOrigin.x + tmpA.x,
        boyOrigin.y + tmpA.y,
        boyOrigin.z + tmpA.z,
      );
      if (t >= DISSOLVE_AT) {
        const dissolve = hologramTransitionAt(
          t - DISSOLVE_AT,
          false,
          DISSOLVE_SECONDS,
          BRANDEN_DISSOLVE_COLOR,
        );
        boyDissolveUniforms.defeatTime.value = dissolve.time;
        boyDissolveUniforms.defeatBlend.value = dissolve.blend;
        boyDissolveUniforms.defeatDissolve.value = 1 - dissolve.opacity;
        if (t >= DISSOLVE_AT + DISSOLVE_SECONDS) finishBoyDisintegration();
      }
    }
    // Brondon: waits, walks to the lift edge beside Branden, then is shielded, drops to his knees and mourns.
    const walking = t >= WALK_AWAY_AT && t < BLAST_AT;
    const walkK = THREE.MathUtils.clamp(
      (t - WALK_AWAY_AT) / (BLAST_AT - WALK_AWAY_AT),
      0,
      1,
    );
    tmpB.copy(revealPlayerStart).lerp(revealPlayerEnd, walkK);
    if (
      Math.abs(player.body.position.x - tmpB.x) > 1e-5 ||
      Math.abs(player.body.position.z - tmpB.z) > 1e-5
    )
      player.setPosition(tmpB.x, player.radius, tmpB.z);
    if (t >= BLAST_AT && t < STAND_AT) {
      tmpA.copy(brendanDeathPosition).sub(tmpB);
      player.setRotation(Math.atan2(-tmpA.x, -tmpA.z));
    } else if (t >= STAND_AT || walking)
      player.setRotation(Math.atan2(-revealD.x, -revealD.z));
    else
      player.setRotation(
        Math.atan2(
          revealBrendanStart.x - tmpB.x,
          revealBrendanStart.z - tmpB.z,
        ) + Math.PI,
      );
    // Rising tremors: sparks and small purple bursts crawl over the halves before the blast.
    if (t >= WALK_AWAY_AT && t < BLAST_AT && !revealBlasted) {
      preBurstClock -= dt;
      const intensity = (t - WALK_AWAY_AT) / (BLAST_AT - WALK_AWAY_AT);
      if (preBurstClock <= 0) {
        preBurstClock = 0.55 - intensity * 0.4;
        emitPreBurst(
          tmpA.set(
            revealOrigin.x + (Math.random() - 0.5) * 5,
            1 + Math.random() * 5.5,
            revealOrigin.z + (Math.random() - 0.5) * 2,
          ),
          0.5 + intensity,
        );
      }
    }
    // Self-destruct.
    if (!revealBlasted && t >= BLAST_AT) {
      revealBlasted = true;
      revealShake = 1;
      blastGroup.visible = true;
      blastGroup.position.set(revealOrigin.x, 3, revealOrigin.z);
      shieldBubble.visible = true;
      scorch.visible = true;
      scorch.position.set(revealOrigin.x, 0.03, revealOrigin.z);
      emitSparks(tmpA.set(revealOrigin.x, 3, revealOrigin.z), 70, 22);
      for (const puff of smokePuffs)
        puff.mesh.position.set(
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 3,
        );
      for (const piece of shrapnel) {
        piece.mesh.visible = true;
        piece.moving = true;
        piece.mesh.scale.set(
          0.15 + Math.random() * 0.5,
          0.15 + Math.random() * 0.5,
          0.15 + Math.random() * 0.5,
        );
        piece.mesh.position.set(
          revealOrigin.x + (Math.random() - 0.5) * 2.5,
          1.5 + Math.random() * 4,
          revealOrigin.z + (Math.random() - 0.5) * 2.5,
        );
        piece.velocity.set(
          (Math.random() - 0.5) * 18,
          4 + Math.random() * 10,
          (Math.random() - 0.5) * 18,
        );
        piece.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      }
    }
    for (const burst of preBursts) {
      if (burst.life <= 0) continue;
      burst.life -= dt;
      burst.mesh.scale.setScalar(burst.size * (1 + (0.45 - burst.life) * 5));
      burst.material.opacity = Math.max(0, burst.life / 0.45) * 0.8;
      if (burst.life <= 0) burst.mesh.visible = false;
    }
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      spark.velocity.y -= 9.82 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      if (spark.mesh.position.y < 0.05) {
        spark.mesh.position.y = 0.05;
        spark.velocity.multiplyScalar(0.3);
      }
      spark.mesh.lookAt(tmpA.copy(spark.mesh.position).add(spark.velocity));
      if (spark.life <= 0) spark.mesh.visible = false;
    }
    if (sparks.some((spark) => spark.life > 0) || sparkInstances.visible)
      syncParticleInstances(sparkInstances, sparks);
    if (revealBlasted && blastGroup.visible) {
      const b = t - BLAST_AT;
      blastCore.scale.setScalar(Math.min(7.2, 1 + b * BLAST_FRONT_SPEED));
      blastCoreMaterial.opacity = Math.max(0, 0.7 - b * 0.55);
      blastCore.visible = blastCoreMaterial.opacity > 0;
      blastFlash.scale.setScalar(1 + b * 20);
      blastFlashMaterial.opacity = Math.max(0, 0.8 - b * 4);
      blastFlash.visible = blastFlashMaterial.opacity > 0;
      blastRing.scale.setScalar(1 + b * 11);
      blastRing.position.y = -2.8;
      blastRingMaterial.opacity = Math.max(0, 0.9 - b * 0.45);
      blastRing.visible = blastRingMaterial.opacity > 0;
      for (const fireball of fireballs) {
        const age = b - fireball.delay,
          lifetime = fireball.impact ? 1.2 : 2.4;
        fireball.mesh.visible = age > 0 && age < lifetime;
        if (!fireball.mesh.visible) continue;
        if (fireball.impact) {
          const travel = THREE.MathUtils.smoothstep(
            t, BLAST_AT, brendanImpactAt,
          );
          fireball.mesh.position.copy(revealBrendanEnd).sub(revealOrigin);
          fireball.mesh.position.y = -2;
          fireball.mesh.position.multiplyScalar(travel);
          fireball.mesh.scale.setScalar(
            fireball.size * (1 - Math.exp(-age * 6)),
          );
        } else {
          fireball.mesh.position.copy(fireball.offset)
            .multiplyScalar(1 + age * 0.65);
          fireball.mesh.position.y += age * 1.4;
          fireball.mesh.scale.setScalar(
            fireball.size * (1 - Math.exp(-age * 2.6)) * (1 + age * 0.2),
          );
        }
        const progress = age / lifetime;
        fireball.uniforms.uTime.value = t;
        fireball.uniforms.uProgress.value = progress;
        fireball.uniforms.uIntensity.value =
          (1 - THREE.MathUtils.smoothstep(progress, 0.7, 1)) *
          (fireball.impact ? 0.9 : 1.2);
      }
      smokeMaterial.opacity =
        Math.min(0.45, b * 0.8) * Math.max(0, 1 - Math.max(0, b - 2) / 4);
      for (const puff of smokePuffs) {
        puff.mesh.visible = smokeMaterial.opacity > 0;
        if (!puff.mesh.visible) continue;
        puff.mesh.position.addScaledVector(puff.velocity, dt);
        puff.velocity.multiplyScalar(Math.exp(-dt * 0.35));
        puff.mesh.scale.setScalar(puff.size * (1 + b * 0.55));
      }
      scorchMaterial.opacity = Math.min(0.75, b * 1.5);
      blastLight.position.set(revealOrigin.x, 3, revealOrigin.z);
      blastLight.intensity = 900 * Math.max(0, 1 - b / 2.4) ** 2;
      blastGroup.visible = b < 6;
      revealShake = Math.max(0, 1 - b / 2.2);
      const flyingShrapnel = shrapnel.some((piece) => piece.moving);
      for (const piece of shrapnel) {
        if (!piece.mesh.visible || !piece.moving) continue;
        piece.velocity.y -= 9.82 * dt;
        piece.mesh.position.addScaledVector(piece.velocity, dt);
        piece.mesh.rotation.x += piece.spin.x * dt;
        piece.mesh.rotation.y += piece.spin.y * dt;
        if (piece.mesh.position.y < 0.12) {
          piece.mesh.position.y = 0.12;
          piece.velocity.set(0, 0, 0);
          piece.spin.set(0, 0, 0);
          piece.moving = false;
        }
      }
      if (flyingShrapnel) syncParticleInstances(shrapnelInstances, shrapnel);
    }
    cloud.visible = t >= DISSOLVE_AT && t < DISSOLVE_AT + DISSOLVE_SECONDS;
    if (cloud.visible) {
      const age = t - DISSOLVE_AT,
        progress = age / DISSOLVE_SECONDS;
      cloud.position.copy(brendanDeathPosition);
      cloudMaterial.opacity = Math.sin(progress * Math.PI) * 0.7;
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        cloudTransform.position
          .copy(particle.start)
          .addScaledVector(particle.drift, age * 0.55);
        cloudTransform.scale.setScalar(
          particle.size * Math.sin(progress * Math.PI),
        );
        cloudTransform.updateMatrix();
        cloud.setMatrixAt(i, cloudTransform.matrix);
      }
      cloud.instanceMatrix.needsUpdate = true;
    }
    // Prime's shield: raised just before the blast, with a hex lattice, a ground ring and a cyan glow so it reads clearly.
    const shieldAge = t - (BLAST_AT - 0.8);
    if (shieldAge > 0 && t < BLAST_AT + 10.5) {
      const fadeOut =
        t > BLAST_AT + 9 ? Math.max(0, 1 - (t - BLAST_AT - 9) / 1.5) : 1;
      const raise = THREE.MathUtils.smootherstep(shieldAge, 0, 0.5);
      const flare = 1 + Math.max(0, 1 - shieldAge * 2) * 0.8;
      shieldBubble.visible = true;
      shieldBubble.position.set(tmpB.x, player.radius + 0.85, tmpB.z);
      shieldBubble.scale.setScalar(
        (1.55 + Math.sin(t * 10) * 0.04) * (0.4 + raise * 0.6) * flare,
      );
      shieldMaterial.opacity =
        raise * fadeOut * (0.28 + Math.sin(t * 14) * 0.06);
      shieldLatticeMaterial.opacity =
        raise * fadeOut * (0.75 + Math.sin(t * 9) * 0.15);
      shieldLattice.position.copy(shieldBubble.position);
      shieldLattice.scale.copy(shieldBubble.scale).multiplyScalar(1.02);
      shieldLattice.rotation.y = t * 0.5;
      shieldLattice.visible = true;
      shieldRing.position.set(tmpB.x, 0.06, tmpB.z);
      shieldRing.visible = true;
      shieldRing.scale.setScalar(1.3 + Math.max(0, 0.6 - shieldAge) * 3);
      shieldRingMaterial.opacity = raise * fadeOut * 0.8;
      shieldLight.position.set(tmpB.x, 1.4, tmpB.z);
      shieldLight.intensity =
        60 * raise * fadeOut * (1 + Math.max(0, 1 - shieldAge * 2));
    } else {
      shieldBubble.visible = false;
      shieldLattice.visible = false;
      shieldRing.visible = false;
      shieldLight.intensity = 0;
    }
    consoleRoot.position.y =
      -1.5 * (1 - THREE.MathUtils.smoothstep(t, STAND_AT, REVEAL_END));
    if (t >= REVEAL_END) finishVictoryDialogue();
  }
  function revealCamera() {
    const t = cinematicTime,
      origin = revealOrigin;
    let focus: THREE.Vector3, desired: THREE.Vector3;
    const walkProgress = THREE.MathUtils.clamp(
      (t - WALK_AWAY_AT) / (BLAST_AT - WALK_AWAY_AT),
      0,
      1,
    );
    const walkMid = revealBrendanStart
      .clone()
      .lerp(revealBrendanEnd, walkProgress)
      .add(revealPlayerStart.clone().lerp(revealPlayerEnd, walkProgress))
      .multiplyScalar(0.5);
    const corpseMid = brendanDeathPosition
      .clone()
      .add(revealPlayerEnd)
      .multiplyScalar(0.5);
    if (t < 8.4) {
      const k = THREE.MathUtils.smoothstep(t, 0, 8.4);
      focus = new THREE.Vector3(origin.x, 3.2, origin.z).addScaledVector(
        revealD,
        k * 1.8,
      );
      desired = new THREE.Vector3(origin.x, 3.4 - k * 1.4, origin.z)
        .addScaledVector(revealD, 12 - k * 4)
        .addScaledVector(revealR, 4.5 - k * 2);
    } else if (t < WALK_AWAY_AT) {
      const mid = revealBrendanStart
          .clone()
          .add(revealPlayerStart)
          .multiplyScalar(0.5),
        k = (t - 8.4) / (WALK_AWAY_AT - 8.4);
      focus = mid.clone().setY(1.35);
      desired = mid
        .clone()
        .addScaledVector(revealR, 4.6 - k * 0.8)
        .addScaledVector(revealD, -1.2 + k * 1.4)
        .setY(1.7);
    } else if (t < BLAST_AT - 1.2) {
      // Side tracking shot of the two walking to the lift edge.
      focus = walkMid.clone().setY(1.3);
      desired = walkMid
        .clone()
        .addScaledVector(revealR, 4.4)
        .addScaledVector(revealD, -1.5)
        .setY(1.6);
    } else if (t < KNEEL_AT + 0.4) {
      // Side-on framing keeps the expanding blast and Branden's knockback visible together.
      const k = THREE.MathUtils.smoothstep(t, BLAST_AT, KNEEL_AT + 0.4);
      focus = origin.clone().lerp(revealBrendanEnd, 0.65).setY(1.35);
      desired = focus.clone()
        .addScaledVector(revealR, 8.5 - k)
        .addScaledVector(revealD, 2)
        .setY(2.2);
      focus.lerp(tmpA.copy(brendanDeathPosition).setY(0.7), k * 0.4);
    } else if (t < DISSOLVE_AT + DISSOLVE_SECONDS) {
      // Hold Branden in frame through the entire red dissolve before cutting to Brondon.
      const k = THREE.MathUtils.smoothstep(
        t, KNEEL_AT + 0.4, DISSOLVE_AT + DISSOLVE_SECONDS,
      );
      focus = corpseMid.clone().lerp(brendanDeathPosition, k * 0.45).setY(0.7);
      desired = corpseMid
        .clone()
        .addScaledVector(revealR, 4.6 - k * 1.4)
        .addScaledVector(revealD, -0.8)
        .setY(1.35 - k * 0.2);
    } else if (t < STAND_AT) {
      // Close-up on Brondon's face as he makes his vow.
      focus = revealPlayerEnd.clone().setY(1.0);
      desired = revealPlayerEnd
        .clone()
        .addScaledVector(revealR, -1.5)
        .addScaledVector(revealD, -1.3)
        .setY(1.2);
    } else {
      const k = THREE.MathUtils.smoothstep(t, STAND_AT, REVEAL_END);
      focus = revealPlayerEnd.clone().setY(1.0 + k * 0.5);
      desired = revealPlayerEnd
        .clone()
        .addScaledVector(revealR, -(1.5 + k * 2.5))
        .addScaledVector(revealD, -1.3 - k * 2)
        .setY(1.3 + k * 0.5);
    }
    camera.position.copy(clearCamera(focus, desired));
    if (revealShake > 0)
      camera.position.add(
        tmpA
          .set(Math.sin(t * 61), Math.sin(t * 47 + 1), Math.sin(t * 53 + 2))
          .multiplyScalar(0.18 * revealShake),
      );
    camera.lookAt(focus);
  }
  // Round 1 change 2: a separate hold-to-skip instance for the phase-4 intro. The existing
  // skipButton/skipHold stay wired to the victory reveal and are left byte-for-byte unchanged.
  const introSkipButton = document.createElement("button");
  introSkipButton.type = "button";
  introSkipButton.className = "scene-dialogue-skip hidden";
  document.body.appendChild(introSkipButton);
  const introSkip = createHoldToSkip({
    button: introSkipButton,
    onSkip: () => finishPhase4Intro(),
    isAvailable: () =>
      !disposed &&
      cinematic === "gravityIntro" &&
      cinematicTime >=
        PHASE4_RULES.possessionSeconds + PHASE4_RULES.introSkipAvailableAt,
  });
  const status = document.getElementById("loading-bay-status");
  status?.classList.add("hidden");
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: BRANDEN_DISSOLVE_COLOR,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cloud = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, 96);
  cloud.name = "BossBlackParticles";
  cloud.visible = false;
  cloud.frustumCulled = false;
  cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cloud);
  const cloudTransform = new THREE.Object3D();
  const particles = Array.from({ length: 96 }, () => ({
    start: new THREE.Vector3(
      (Math.random() - 0.5) * 0.9,
      0.15 + Math.random() * 0.55,
      (Math.random() - 0.5) * 1.8,
    ),
    drift: new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      0.8 + Math.random(),
      (Math.random() - 0.5) * 0.5,
    ),
    size: 0.025 + Math.random() * 0.05,
  }));
  function freeze() {
    player.disable();
    player.body.type = CANNON.Body.KINEMATIC;
    player.body.updateMassProperties();
    player.body.velocity.set(0, 0, 0);
  }
  function release() {
    player.body.type = CANNON.Body.DYNAMIC;
    player.body.updateMassProperties();
    player.enable();
  }
  function beginVersus() {
    cinematic = "versus";
    cinematicTime = 0;
    door.setLocked(true);
    subtitles?.classList.add("hidden");
    versus = createHangarVersus({
      singleOpponent: true,
      playerName: "BRONDON",
      opponentName: "BAY WARDEN",
    });
    versus.update(0);
  }
  if (cinematic) freeze();
  const boss = createLoadingBayBoss(
    scene,
    physicsWorld,
    player,
    () => {
      bossVictory = true;
      cinematic = "reveal";
      cinematicTime = 0;
      freeze();
      cloud.visible = false;
      revealOrigin.set(boss.root.position.x, 0, boss.root.position.z);
      cloud.position.copy(revealOrigin);
      setupDefeatCutscene();
    },
    covers,
    {
      loadDrone,
      loadBoss,
      onPhaseThree() {
        captureShot();
        cinematic = "awakening";
        cinematicTime = 0;
        awakeningReleaseClock = -1;
        freeze();
      },
      onPhaseThreeEnd() {
        if (cinematic === "awakening") awakeningReleaseClock = 0.85;
      },
      onDroneApproach(root) {
        if (droneCutscene || cinematic) return;
        captureShot();
        const start = new THREE.Vector3().copy(player.body.position),
          state = player.getState();
        const toward = root.position.clone().sub(start);
        toward.y = 0;
        toward.normalize();
        if (toward.lengthSq() < 0.001) toward.set(0, 0, 1);
        const right = new THREE.Vector3(toward.z, 0, -toward.x);
        const a = dodgeDestination(start, right),
          b = dodgeDestination(start, right.clone().negate());
        const side =
          a.distanceToSquared(start) >= b.distanceToSquared(start) ? 1 : -1;
        const dodge = side === 1 ? a : b;
        const explosion = root
          .getWorldPosition(new THREE.Vector3())
          .lerp(new THREE.Vector3(start.x, player.getHeadY(), start.z), 0.78);
        const envelope = new THREE.Box3().setFromPoints([
          start,
          dodge,
          root.getWorldPosition(new THREE.Vector3()),
          start.clone().add(new THREE.Vector3(0, 2.2, 0)),
          dodge.clone().add(new THREE.Vector3(0, 2.2, 0)),
        ]);
        envelope.union(
          new THREE.Box3(
            explosion.clone().addScalar(-3.6),
            explosion.clone().addScalar(3.6),
          ),
        );
        envelope.expandByScalar(0.45);
        envelope.min.y = Math.max(0.05, envelope.min.y);
        droneCutscene = {
          root,
          stage: "incoming",
          clock: 0,
          time: 0,
          poseTime: 0,
          impactPosition: null,
          start,
          dodge,
          impactStart: dodge.clone(),
          recoil: dodge.clone(),
          yaw: state.yaw,
          pitch: state.pitch,
          side,
          attackAngle: Math.atan2(toward.x, toward.z),
          envelope,
        };
        freeze();
      },
      onDroneExplosion(root, position) {
        if (!droneCutscene) return;
        const dc = droneCutscene;
        dc.stage = "impact";
        dc.clock = 0;
        dc.poseTime = 0;
        dc.impactPosition = position;
        dc.root = root;
        dc.impactStart.copy(player.body.position);
        const away = dc.impactStart.clone().sub(position);
        away.y = 0;
        if (away.lengthSq() < 0.001)
          away.set(Math.sin(dc.yaw), 0, Math.cos(dc.yaw));
        dc.recoil.copy(dodgeDestination(dc.impactStart, away.normalize(), 0.7));
        dc.envelope.expandByPoint(
          dc.recoil.clone().add(new THREE.Vector3(0, 2.2, 0)),
        );
      },
      onDroneExplosionEnd() {
        if (!droneCutscene) return;
        player.setRotation(droneCutscene.yaw, droneCutscene.pitch);
        droneCutscene = null;
        returnToBattle();
      },
      // Phase 4 hooks (additive): subtitle notices plus the near-miss slow-mo / camera punch.
      onPhaseFourReturn() {
        captureShot();
        cinematic = "bossReturn";
        cinematicTime = 0;
        freeze();
        subtitles?.classList.add("hidden");
      },
      onPhaseFour() {
        startPhase4Intro();
      },
      onScanFound() {
        showPhaseNotice("Prime: He found us! Dodge the drones!", 3);
      },
      onNeedBehind() {
        showPhaseNotice("Prime: We need to teleport behind it.", 3.5);
      },
      onBackDamaged(hits, required) {
        showPhaseNotice(
          `Prime: Hit! ${hits}/${required} — keep shooting the target!`,
          2.2,
        );
      },
      onBackHit() {
        showPhaseNotice("Prime: Direct hit! Finish him!", 3);
      },
      onNearMiss(side) {
        triggerNearMiss(side);
      },
    },
  );
  if (defeated) boss.dispose();
  else if (startAtPhaseFour) {
    door.setLocked(true);
    player.setPosition(0, player.radius + 0.4, -8);
    boss.startAtPhaseFour();
  } else if (checkpoint) {
    door.setLocked(true);
    boss.start();
  }
  const ready = loadBoy()
    .then((gltf) => {
      if (disposed) {
        disposeRoom(gltf.scene as unknown as THREE.Scene);
        return;
      }
      boy = gltf.scene;
      boy.name = "FreedBoy";
      const bounds = new THREE.Box3().setFromObject(boy),
        height = bounds.getSize(new THREE.Vector3()).y;
      boy.scale.multiplyScalar(1.75 / Math.max(height, 0.01));
      bounds.setFromObject(boy);
      const center = bounds.getCenter(new THREE.Vector3());
      boy.position.set(-center.x, -bounds.min.y, -center.z);
      boyOrigin.copy(boy.position);
      scene.add(boy);
      boyClips = gltf.animations;
      boy.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.receiveShadow = true;
        }
      });
      prepareBoyDisintegration();
      boy.visible = !cleared && cinematic === "reveal";
      boyMixer = new THREE.AnimationMixer(boy);
      if (cleared) finishBoyDisintegration();
      else if (cinematic === "reveal") playBoy("walk");
      else {
        const idle = gltf.animations.find((clip) => /idle/i.test(clip.name));
        if (idle) boyMixer.clipAction(idle).play();
      }
    })
    .catch((error) => {
      if (!disposed) {
        boyError = true;
        console.error("[Scene 13] Failed to load boy.glb:", error);
      }
    });
  // Sample both sides of the action; clamp and sweep the winning camera against the room.
  const fitForward = new THREE.Vector3(),
    fitRight = new THREE.Vector3(),
    fitUp = new THREE.Vector3(),
    fitLocal = new THREE.Vector3();
  const liveBossBounds = new THREE.Box3(),
    droneFrameBounds = new THREE.Box3();
  const droneFrameFocus = new THREE.Vector3(),
    droneFramePoint = new THREE.Vector3();
  const droneFramePoints = Array.from({ length: 8 }, () => new THREE.Vector3());
  function clearCamera(focus: THREE.Vector3, desired: THREE.Vector3) {
    const end = desired.clone();
    end.x = THREE.MathUtils.clamp(end.x, -19.25, 19.25);
    end.y = THREE.MathUtils.clamp(end.y, 0.65, 13.2);
    end.z = THREE.MathUtils.clamp(end.z, -23.25, 23.25);
    const direction = end.clone().sub(focus),
      length = direction.length();
    if (length < 0.001) return end;
    direction.divideScalar(length);
    let clearance = length;
    for (const offset of [
      new THREE.Vector3(),
      new THREE.Vector3(0.18, 0, 0),
      new THREE.Vector3(-0.18, 0, 0),
      new THREE.Vector3(0, 0.18, 0),
    ]) {
      const from = focus.clone().add(offset),
        to = end.clone().add(offset);
      physicsWorld.raycastAll(
        new CANNON.Vec3(from.x, from.y, from.z),
        new CANNON.Vec3(to.x, to.y, to.z),
        { skipBackfaces: false },
        (hit) => {
          if (
            hit.body?.type === CANNON.Body.STATIC &&
            hit.body.collisionResponse
          )
            clearance = Math.min(
              clearance,
              Math.max(0.05, hit.distance - 0.25),
            );
        },
      );
    }
    return focus.clone().addScaledVector(direction, clearance);
  }
  function corners(
    bounds: THREE.Box3,
    points = Array.from({ length: 8 }, () => new THREE.Vector3()),
  ) {
    for (let i = 0; i < 8; i++)
      points[i].set(
        i & 4 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 1 ? bounds.max.z : bounds.min.z,
      );
    return points;
  }
  function orbitPosition(
    shot: OrbitShot,
    progress: number,
    position = new THREE.Vector3(),
  ) {
    const angle = shot.angle + shot.sweep * progress;
    // Ease a dolly-in through the dodge, hold the impact, then open up for the recoil.
    const push = THREE.MathUtils.smootherstep(progress, 0, 0.42);
    const recover = THREE.MathUtils.smootherstep(progress, 0.65, 1);
    const distance =
      shot.distance *
      (shot.kind === "drone"
        ? 1.4 - push * 0.4 + recover * 0.08
        : 1 + Math.sin(progress * Math.PI) * 0.04);
    return position.set(
      THREE.MathUtils.clamp(shot.focus.x + Math.sin(angle) * distance, -19, 19),
      THREE.MathUtils.clamp(
        shot.focus.y + shot.height + progress * 0.35,
        0.85,
        12.8,
      ),
      THREE.MathUtils.clamp(shot.focus.z + Math.cos(angle) * distance, -23, 23),
    );
  }
  function fittedFov(
    position: THREE.Vector3,
    focus: THREE.Vector3,
    points: THREE.Vector3[],
  ) {
    const forward = fitForward.copy(focus).sub(position).normalize();
    const right = fitRight.crossVectors(forward, cameraUp).normalize();
    const up = fitUp.crossVectors(right, forward);
    let tangent = 0;
    for (const point of points) {
      const local = fitLocal.copy(point).sub(position),
        depth = local.dot(forward);
      if (depth <= 0.4) return 175;
      // Leave headroom, room below the boots, and space for the blast at every aspect ratio.
      tangent = Math.max(
        tangent,
        Math.abs(local.dot(up)) / (depth * 0.78),
        Math.abs(local.dot(right)) /
          (depth * Math.max(0.25, camera.aspect) * 0.84),
      );
    }
    return THREE.MathUtils.radToDeg(2 * Math.atan(tangent));
  }
  function cameraBlockers(kind: OrbitShot["kind"]) {
    return physicsWorld.bodies.filter(
      (body) =>
        body.collisionResponse &&
        body !== player.body &&
        (body.type === CANNON.Body.STATIC ||
          (kind === "drone" && body.type === CANNON.Body.KINEMATIC)),
    );
  }
  function segmentBlocked(
    from: THREE.Vector3,
    to: THREE.Vector3,
    box: THREE.Box3,
  ) {
    let near = 0,
      far = 1;
    for (const axis of ["x", "y", "z"] as const) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-8) {
        if (from[axis] < box.min[axis] || from[axis] > box.max[axis])
          return false;
      } else {
        const a = (box.min[axis] - from[axis]) / delta,
          b = (box.max[axis] - from[axis]) / delta;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
      }
    }
    return true;
  }
  function selectOrbit(
    kind: OrbitShot["kind"],
    bounds: THREE.Box3,
    preferredAngle: number,
    attackAngle = 0,
  ) {
    const focus = bounds.getCenter(new THREE.Vector3()),
      points = corners(bounds);
    const size = bounds.getSize(new THREE.Vector3());
    const baseDistance = Math.max(
      kind === "boss" ? 14 : 6.5,
      size.y * 0.9,
      Math.hypot(size.x, size.z) * 0.8,
    );
    const blockers = cameraBlockers(kind);
    // Snapshot conservative obstacle bounds once; arc scoring needs visibility, not contact points.
    const solids = blockers.map((body) => {
      if (body.aabbNeedsUpdate) body.updateAABB();
      return new THREE.Box3(
        new THREE.Vector3().copy(body.aabb.lowerBound),
        new THREE.Vector3().copy(body.aabb.upperBound),
      ).expandByScalar(0.35);
    });
    const samples =
      kind === "boss"
        ? [
            focus,
            new THREE.Vector3(focus.x, bounds.max.y - 0.5, focus.z),
            new THREE.Vector3(focus.x, bounds.min.y + 0.8, focus.z),
          ]
        : [
            droneCutscene!.start.clone().add(new THREE.Vector3(0, 1, 0)),
            droneCutscene!.dodge.clone().add(new THREE.Vector3(0, 1.2, 0)),
            droneCutscene!.root.getWorldPosition(new THREE.Vector3()),
          ];
    let best: OrbitShot | null = null,
      bestScore = -Infinity;
    const samplePosition = new THREE.Vector3(),
      previousSample = new THREE.Vector3();
    // Choose an entire clear arc once, rather than switching sides midway through the shot.
    for (let i = 0; i < 12; i++)
      for (const direction of [-1, 1])
        for (const scale of [1, 1.3]) {
          const middle = preferredAngle + (i * Math.PI) / 6;
          const sweep = direction * (kind === "boss" ? 0.65 : 1.25);
          const candidate: OrbitShot = {
            kind,
            bounds,
            points,
            focus,
            angle: middle - sweep * 0.5,
            sweep,
            distance: baseDistance * scale,
            height: kind === "boss" ? -0.75 : 0.9,
          };
          let score = Math.cos(middle - preferredAngle) * 8,
            maxFov = 0;
          const intervals = kind === "drone" ? 8 : 4;
          for (let sample = 0; sample <= intervals; sample++) {
            const t = sample / intervals;
            const position = orbitPosition(candidate, t, samplePosition);
            // Check the path between samples too: a zooming arc can cross a pillar
            // even when its sampled endpoints are clear. Solid clearance wins over framing.
            if (
              solids.some(
                (box) =>
                  box.containsPoint(position) ||
                  (sample > 0 && segmentBlocked(previousSample, position, box)),
              )
            )
              score -= 1000000;
            previousSample.copy(position);
            maxFov = Math.max(maxFov, fittedFov(position, focus, points));
            for (const target of samples) {
              if (solids.some((box) => segmentBlocked(position, target, box)))
                score -= 500;
            }
            if (kind === "drone") {
              const viewAngle = candidate.angle + sweep * t;
              // Keep the player and fireball side by side, not one hidden behind the other.
              score += Math.abs(Math.sin(viewAngle - attackAngle)) * 12;
              if (Math.cos(viewAngle - attackAngle) > 0.35) score -= 15;
            }
          }
          score -= Math.max(0, maxFov - 82) * 30 + Math.abs(maxFov - 58) * 0.25;
          if (score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
    best!.bounds = bounds.clone();
    return best!;
  }
  function drawOrbit(shot: OrbitShot, progress: number, impactClock = -1) {
    const position = orbitPosition(shot, progress, camera.position);
    // Collision never collapses this shot into a first-person close-up.
    if (impactClock >= 0) {
      const shake = Math.exp(-impactClock * 8) * 0.06;
      position.y += Math.sin(impactClock * 47) * shake;
      position.x += Math.sin(impactClock * 61) * shake;
    }
    let focus = shot.focus,
      points = corners(shot.bounds, shot.points);
    if (shot.kind === "drone" && droneCutscene) {
      const dc = droneCutscene,
        p = player.body.position;
      // Track the two live subjects, not the empty space left by the approaching drone.
      droneFrameBounds.min.set(
        p.x - 0.65,
        Math.max(0.05, p.y - player.radius),
        p.z - 0.65,
      );
      droneFrameBounds.max.set(p.x + 0.65, p.y + 1.9, p.z + 0.65);
      const blastProgress =
        dc.poseTime /
        (BOSS_RULES.droneExplosionDuration - BOSS_RULES.droneDetonateAt);
      const radius =
        dc.stage === "incoming"
          ? 0.45
          : 0.55 + THREE.MathUtils.smootherstep(blastProgress, 0, 0.7) * 3;
      const center = dc.impactPosition ?? dc.root.position;
      droneFrameBounds.expandByPoint(
        droneFramePoint.copy(center).addScalar(radius),
      );
      droneFrameBounds.expandByPoint(
        droneFramePoint.copy(center).addScalar(-radius),
      );
      droneFrameBounds.min.y = Math.max(0.05, droneFrameBounds.min.y);
      focus = droneFrameBounds.getCenter(droneFrameFocus);
      points = corners(droneFrameBounds, droneFramePoints);
    }
    camera.position.copy(position);
    camera.up.copy(cameraUp);
    camera.lookAt(focus);
    const fit = fittedFov(position, focus, points);
    const lens =
      shot.kind === "drone"
        ? THREE.MathUtils.lerp(
            68,
            32,
            THREE.MathUtils.smootherstep(progress, 0, 0.42),
          ) +
          THREE.MathUtils.smootherstep(progress, 0.65, 1) * 6
        : 52;
    // Subject fitting takes priority over the zoom near walls and on portrait screens.
    camera.fov = THREE.MathUtils.clamp(Math.max(lens, fit + 2), 32, 110);
    if (impactClock >= 0) {
      camera.fov = Math.min(
        112,
        camera.fov + Math.sin(Math.min(1, impactClock / 0.2) * Math.PI) * 4,
      );
      camera.rotateZ(
        Math.sin(impactClock * 15) * Math.exp(-impactClock * 5) * 0.016,
      );
    }
    camera.updateProjectionMatrix();
  }
  function applyCinematicCamera() {
    if (droneCutscene) {
      const dc = droneCutscene;
      if (!orbitShot || orbitShot.kind !== "drone")
        orbitShot = selectOrbit(
          "drone",
          dc.envelope,
          dc.attackAngle + dc.side * 1.9,
          dc.attackAngle,
        );
      orbitShot.bounds.union(dc.envelope);
      drawOrbit(
        orbitShot,
        THREE.MathUtils.smootherstep(dc.time, 0, 3.05),
        dc.stage === "impact" ? dc.clock : -1,
      );
      return true;
    }
    if (cinematic === "awakening") {
      const actual = boss.getCinematicBounds(liveBossBounds);
      if (!orbitShot || orbitShot.kind !== "boss") {
        // Reserve space for the standing head, raised arms, and released swarm before the rise starts.
        const envelope = new THREE.Box3(
          new THREE.Vector3(
            boss.root.position.x - 5.8,
            0.05,
            boss.root.position.z - 5.8,
          ),
          new THREE.Vector3(
            boss.root.position.x + 5.8,
            11.5,
            boss.root.position.z + 5.8,
          ),
        ).union(actual);
        orbitShot = selectOrbit("boss", envelope, boss.root.rotation.y + 0.3);
      }
      orbitShot.bounds.union(actual);
      drawOrbit(orbitShot, THREE.MathUtils.smootherstep(cinematicTime, 0, 4.5));
      return true;
    }
    // Round 1 change 2: slow boss orbit across the whole phase-4 intro (taunt, dim, warning, player line).
    if (cinematic === "bossReturn") {
      const focus = boss.getRootPosition(tmpA).add(tmpB.set(0, 4.4, 0));
      const desired = boss
        .getRootPosition()
        .add(new THREE.Vector3(10.5, 5.6, -12));
      camera.position.copy(clearCamera(focus, desired));
      camera.lookAt(focus);
      camera.fov = 64;
      camera.updateProjectionMatrix();
      return true;
    }
    if (cinematic === "gravityIntro") {
      const actual = boss.getCinematicBounds(liveBossBounds);
      if (!orbitShot || orbitShot.kind !== "boss") {
        const envelope = new THREE.Box3(
          new THREE.Vector3(
            boss.root.position.x - 5.8,
            0.05,
            boss.root.position.z - 5.8,
          ),
          new THREE.Vector3(
            boss.root.position.x + 5.8,
            11.5,
            boss.root.position.z + 5.8,
          ),
        ).union(actual);
        orbitShot = selectOrbit("boss", envelope, boss.root.rotation.y + 0.3);
      }
      orbitShot.bounds.union(actual);
      drawOrbit(
        orbitShot,
        THREE.MathUtils.smootherstep(
          cinematicTime,
          0,
          PHASE4_RULES.possessionSeconds + PHASE4_RULES.introEndAt,
        ),
      );
      return true;
    }
    if (!cinematic) return false;
    if (cinematic === "versus") return true;
    if (cinematic === "entry") {
      const p = player.body.position;
      camera.position.set(
        p.x + 2.1,
        p.y + 2.1,
        Math.max(fromServiceLift ? -26.8 : -23.4, p.z - 3),
      );
      camera.lookAt(
        0,
        cinematicTime < 5.5 ? p.y + 0.8 : 5.8,
        cinematicTime < 5.5 ? p.z + 2.5 : 0,
      );
    } else if (cinematic === "lift") {
      camera.position.set(2.6, platform.position.y + 3, 0.5);
      camera.lookAt(
        player.body.position.x,
        player.body.position.y + 0.8,
        player.body.position.z,
      );
    } else {
      revealCamera();
    }
    return true;
  }
  function updateCinematic(dt: number) {
    if (!cinematic) return;
    if (
      cinematic === "reveal" &&
      cinematicTime >= BLAST_AT &&
      cinematicTime < BLAST_AT + BLAST_SLOWMO_SECONDS
    )
      dt *= 0.3;
    revealDelta = cinematic === "reveal" ? dt : 0;
    cinematicTime += dt;
    if (cinematic === "bossReturn") return;
    // Round 1 change 2: phase-4 intro beats (taunt, dim, beacons, warning, player line, then drift-up).
    if (cinematic === "gravityIntro") {
      const R = PHASE4_RULES,
        introTime = cinematicTime - R.possessionSeconds;
      if (!introDimStarted && introTime >= R.introDimAt) {
        introDimStarted = true;
        startLightDim(R.introDimFraction, R.introDimSeconds);
      }
      if (!introBeaconsOn && introTime >= R.introBeaconsAt)
        introBeaconsOn = true;
      if (warningEl) {
        const inWarning =
          introTime >= R.introWarningAt &&
          introTime < R.introWarningAt + R.introWarningSeconds;
        warningEl.classList.toggle("hidden", !inWarning);
        if (inWarning)
          warningEl.style.opacity =
            Math.sin(cinematicTime * 12) * 0.5 + 0.5 < 0.5 ? "0.25" : "1";
      }
      if (subtitles) {
        if (
          introTime >= R.introTauntAt &&
          introTime < R.introTauntAt + R.introTauntSeconds
        ) {
          showSubtitle(
            "Donus: Hahaha. You thought destroying my weapons meant you'd won? I control this entire ship, including its gravity.",
          );
        } else if (
          introTime >= R.introPlayerLineAt &&
          introTime < R.introPlayerLineAt + R.introPlayerLineSeconds
        ) {
          showSubtitle("Brondon: Oh no... oh no, no, no.");
        } else subtitles.classList.add("hidden");
      }
      if (introTime >= R.introEndAt) finishPhase4Intro();
      return;
    }
    if (cinematic === "versus") {
      versus?.update(cinematicTime);
      if (cinematicTime >= BOSS_VERSUS_SECONDS) {
        versus?.dispose();
        versus = null;
        cinematic = null;
        release();
        boss.start();
      }
      return;
    }
    if (cinematic === "awakening") {
      subtitles?.classList.add("hidden");
      if (awakeningReleaseClock >= 0) {
        awakeningReleaseClock = Math.max(0, awakeningReleaseClock - dt);
        if (!awakeningReleaseClock) {
          cinematic = null;
          returnToBattle();
        }
      }
      return;
    }
    if (cinematic === "reveal" && !boy && !boyError)
      cinematicTime = Math.min(cinematicTime, 2.5);
    if (cinematic === "entry") {
      // Walk across the landing, descend the physical stair run, then face the robot.
      const distance = Math.min(1, cinematicTime / 5.8);
      const z = THREE.MathUtils.lerp(entryStart.z, -10.2, distance);
      const y = z < -21 ? 3 : z < -12 ? (-12 - z) / 3 : 0;
      player.setPosition(
        THREE.MathUtils.lerp(entryStart.x, 0, distance),
        y + player.radius,
        z,
      );
      player.setRotation(entryWalkYaw, 0);
      if (subtitles) {
        showSubtitle(
          cinematicTime < 0.6
            ? "LOWER LOADING BAY / 13"
            : "Prime: That's the mining bot Branden was designing. It looks like it wants to fight.",
        );
      }
      if (cinematicTime >= BOSS_ENTRY_SECONDS) beginVersus();
    } else if (cinematic === "lift") {
      platform.position.y =
        -12 * THREE.MathUtils.smoothstep(cinematicTime, 0, 4.5);
      liftBody.position.y = platform.position.y - 0.2;
      liftBody.aabbNeedsUpdate = true;
      consoleBody.position.y = platform.position.y + 0.65;
      consoleBody.aabbNeedsUpdate = true;
      player.setPosition(
        liftPassenger.x,
        liftPassenger.y + platform.position.y,
        liftPassenger.z,
      );
      if (subtitles) {
        showSubtitle("DESCENDING / HANGAR 14");
      }
      if (cinematicTime >= 4.8 && !liftTransferred) {
        liftTransferred = true;
        onDescend?.(
          player.captureTransition({ x: 0, y: platform.position.y, z: 0 }),
        );
      }
    } else {
      updateReveal(dt);
      if (boyError && cinematicTime < 3.5 && subtitles) {
        showSubtitle(
          "Prime: The prisoner is free. (Character model could not be loaded.)",
        );
      }
    }
  }
  // --- Phase 4 push-off prompt + beacon helpers (additive; changes 4 and 5). ---
  function setPushSide(
    el: HTMLElement | null,
    active: boolean,
    code: string,
    progress: number,
    required: number,
  ) {
    if (!el) return;
    el.classList.toggle("hidden", !active);
    if (!active) return;
    const key = el.querySelector(".p4-push-key");
    if (key instanceof HTMLElement)
      renderDirectionalPrompt(key, [code], "foot");
    const count = el.querySelector(".p4-push-count");
    if (count) count.textContent = `${progress}/${required}`;
    const pips = el.querySelector(".p4-push-pips");
    if (pips) {
      if (pips.childElementCount !== required) {
        pips.textContent = "";
        for (let i = 0; i < required; i++) {
          const pip = document.createElement("i");
          pip.style.cssText =
            "width:9px;height:9px;border-radius:50%;border:1px solid #ff8a6a;background:#2a120c;transition:background .12s,box-shadow .12s;";
          pips.appendChild(pip);
        }
      }
      for (let i = 0; i < pips.childElementCount; i++) {
        const pip = pips.children[i] as HTMLElement,
          on = i < progress;
        pip.style.background = on ? "#ff5a3c" : "#2a120c";
        pip.style.boxShadow = on ? "0 0 8px rgba(255,90,60,.9)" : "none";
      }
    }
  }
  function updatePushPrompt(
    push: {
      key: number;
      progress: number;
      required: number;
      cooldown: number;
    } | null,
  ) {
    const k = push?.key ?? 0,
      progress = push?.progress ?? 0,
      required = push?.required ?? PHASE4_RULES.pushOffTaps;
    pushPrompt.container?.classList.toggle("hidden", k === 0);
    const zg = boss.getStatus().phase === "zeroG" && !cleared;
    document.body.classList.toggle("p4-bars-right", zg);
    document.body.classList.toggle("p4-bars-aside", zg && k !== 0);
    setPushSide(pushPrompt.left, k === -1, "KeyA", progress, required);
    setPushSide(pushPrompt.right, k === 1, "KeyD", progress, required);
    setPushSide(pushPrompt.top, k === 2, "KeyW", progress, required);
    setPushSide(pushPrompt.bottom, k === -2, "KeyS", progress, required);
  }
  function updateBeacons(active: boolean) {
    if (beaconGroup.visible !== active) {
      beaconGroup.visible = active;
      for (const light of beaconLights) light.visible = active;
    }
    if (!active) return;
    beaconTime += cinematicDelta;
    const pulse =
      0.55 +
      0.45 * Math.sin(beaconTime * PHASE4_RULES.beaconPulseSpeed * Math.PI * 2);
    beaconLensMaterial.emissiveIntensity =
      PHASE4_RULES.beaconEmissiveIntensity * pulse;
    const spinStep =
      cinematicDelta * PHASE4_RULES.beaconSpinSpeed * Math.PI * 2;
    for (const beacon of beacons) beacon.spin.rotation.y += spinStep;
    // Round 1 change 2c: sweep each spotlight's target around the room so the red beam travels
    // across the walls, floor and ceiling. Two lights, offset by half a turn for full coverage.
    for (let i = 0; i < beaconLights.length; i++) {
      const light = beaconLights[i],
        target = beaconLightTargets[i];
      light.intensity = PHASE4_RULES.beaconSpotIntensity * pulse;
      const a =
        beaconTime * PHASE4_RULES.beaconSweepSpeed * Math.PI * 2 + i * Math.PI;
      target.position.set(
        Math.sin(a) * PHASE4_RULES.beaconSweepRadiusX,
        PHASE4_RULES.beaconSweepHeightCenter +
          Math.sin(a * PHASE4_RULES.beaconSweepTilt + i * 1.7) *
            PHASE4_RULES.beaconSweepHeightAmp,
        Math.cos(a) * PHASE4_RULES.beaconSweepRadiusZ,
      );
    }
  }
  // --- Phase 4 intro sequence (round 1 change 2). Plays once on first entry; skipped on retries and
  // on the return to zero-G after an exposed window. Uses the cinematic camera + #boss-subtitles. ---
  let introDimStarted = false,
    introBeaconsOn = false,
    prevZeroGActive = false;
  function startPhase4Intro() {
    if (disposed || cleared) {
      boss.beginZeroGBarrage();
      return;
    }
    captureShot();
    cinematic = "gravityIntro";
    cinematicTime = 0;
    introDimStarted = false;
    introBeaconsOn = false;
    freeze();
  }
  function finishPhase4Intro() {
    if (cinematic !== "gravityIntro") return; // idempotent: natural end and hold-to-skip both call this
    cinematic = null;
    introSkipButton.classList.add("hidden");
    if (warningEl) warningEl.classList.add("hidden");
    // Guarantee the end-state even on an early skip: beacons on, bay lights dimmed.
    introBeaconsOn = true;
    if (roomLightScale > PHASE4_RULES.introDimFraction + 1e-3)
      startLightDim(
        PHASE4_RULES.introDimFraction,
        PHASE4_RULES.introDimSeconds,
      );
    boss.beginZeroGBarrage(); // opens the barrage: enables zero-G, the player drifts up (beat f)
    returnToBattle(); // releases the player and blends the camera back over 0.3 s
    // A short control hint once floating begins (returnToBattle hid the subtitles just above).
    phaseNoticeTime = 0;
  }
  function updateHud() {
    const s = boss.getStatus();
    hud?.classList.toggle(
      "hidden",
      cleared || cinematic !== null || droneCutscene !== null,
    );
    if (cleared && !cinematic && prompt) {
      prompt.textContent = inputHint("Press E to interact — descend to hangar");
      prompt.classList.toggle("hidden", !nearConsole());
    }
    if (fill) fill.style.width = `${(s.health / s.maxHealth) * 100}%`;
    if (label) label.textContent = `BAY WARDEN / ${s.health} / ${s.maxHealth}`;
    // Phase 4 HUD (additive): thruster heat bar + entanglement pips, inline-styled (no CSS edits).
    const phase4Visible = s.zeroGActive && !cleared && !cinematic;
    if (phase4Hud) phase4Hud.classList.toggle("hidden", !phase4Visible);
    if (phase4Visible) {
      if (phase4Heat) {
        phase4Heat.style.width = `${Math.round(THREE.MathUtils.clamp(s.thrusterHeat, 0, 1) * 100)}%`;
        phase4Heat.style.background = s.overheated ? "#ff4d3d" : "#7fe3ff";
      }
      if (phase4Pips) phase4Pips.style.display = "none";
      // Wall push-off prompt (change 4): matching key on the barrier side with tap progress.
      updatePushPrompt(player.getZeroGPushOff());
    } else updatePushPrompt(null);
    // Red alarm beacons (change 5 + round 1 change 2c): on during the intro and while gravity is off.
    updateBeacons(
      (s.zeroGActive || (cinematic === "gravityIntro" && introBeaconsOn)) &&
        !cleared,
    );
    // Round 1 change 2b: dim the bay lights while gravity is off; restore smoothly when it returns.
    if (prevZeroGActive && !s.zeroGActive)
      startLightDim(1, PHASE4_RULES.lightRestoreSeconds);
    else if (!prevZeroGActive && s.zeroGActive)
      startLightDim(
        PHASE4_RULES.introDimFraction,
        PHASE4_RULES.introDimSeconds,
      );
    prevZeroGActive = s.zeroGActive;
  }
  const assetsReady = Promise.all([ready, boss.ready]).then(async () => {
    if (disposed || !renderer || defeated) return;
    try {
      await boss.prepareRendering(renderer, camera);
    } catch (error) {
      if (!disposed)
        console.warn("[Scene 13] Render warmup deferred to first use:", error);
    }
  });
  updateHud();
  applyCinematicCamera();
  return {
    roomId: "scene13",
    scene,
    camera,
    physics,
    physicsWorld,
    player,
    door,
    boss,
    pillars,
    ready: assetsReady,
    cutsceneManager: null,
    getSceneId: () => "scene13",
    getMapLayout: () => BAY_THIRTEEN_MAP,
    elevator: { platform, body: liftBody, console: consoleRoot, consoleBody },
    getLiftStatus: () => ({
      ready: cleared && !cinematic,
      canInteract: nearConsole(),
      descending: cinematic === "lift",
      transferred: liftTransferred,
    }),
    setBackTrigger: door.setTrigger,
    getDamageTargets: () =>
      cleared || droneCutscene ? [] : boss.getDamageTargets(),
    setGogglesActive: boss.setGogglesActive,
    getParryableBolts: () =>
      cleared || droneCutscene ? [] : boss.getParryableBolts(),
    // Kept for existing save callers; the console no longer grants a health pack.
    getHealthPackCollected: () => true,
    getArenaSupplies: () =>
      arenaSupplies.map((supply) => ({
        id: supply.id,
        kind: supply.kind,
        collected: supply.collected,
        position: supply.pickup.root.position.clone(),
      })),
    hasBossVictory: () => bossVictory,
    getMusicTrack: () => "ship" as const,
    isCinematic: () => cinematic !== null || droneCutscene !== null,
    getCinematicDelta: () => cinematicDelta,
    getHologramTransition: () =>
      teleportFx < 0
        ? null
        : teleportFx < TELEPORT_OUT
          ? hologramTransitionAt(teleportFx, false, TELEPORT_OUT, 0xa44dff)
          : hologramTransitionAt(
              teleportFx - TELEPORT_OUT,
              true,
              TELEPORT_IN,
              0xa44dff,
            ),
    getCinematicState: () =>
      cinematic || droneCutscene
        ? {
            ...player.getState(),
            isMoving:
              (cinematic === "entry" && cinematicTime < 5.8) ||
              (cinematic === "reveal" &&
                cinematicTime >= WALK_AWAY_AT &&
                cinematicTime < BLAST_AT),
            isOnGround: true,
            jumping: false,
            climbing: false,
            velocityY: 0,
          }
        : null,
    getCinematicPose: () => {
      if (cinematic === "lift" && cinematicTime < 1.1)
        return {
          clip: "Interact" as const,
          time: cinematicTime,
          duration: 1.1,
          loop: false,
        };
      if (
        cinematic === "reveal" &&
        cinematicTime >= BLAST_AT &&
        cinematicTime < STAND_AT
      ) {
        return cinematicTime < KNEEL_AT
          ? {
              clip: "Hit_Chest" as const,
              time: cinematicTime - BLAST_AT,
              loop: false,
            }
          : {
              clip: "Crouch_Idle_Loop" as const,
              time: cinematicTime,
              loop: true,
              bodyPitch: -0.12,
            };
      }
      if (!droneCutscene) return undefined;
      const clock = droneCutscene.clock;
      if (droneCutscene.stage === "incoming") {
        return {
          clip: "Roll" as const,
          time: 0.08 + clock * BOSS_RULES.droneExplosionSlow,
          duration: 0.95,
          loop: false,
          lean: droneCutscene.side * 0.22,
        };
      }
      return {
        clip: "Hit_Chest" as const,
        time: droneCutscene.poseTime,
        loop: false,
        bodyPitch: -Math.sin(Math.min(1, clock / 1.3) * Math.PI) * 0.18,
        lean:
          -droneCutscene.side *
          Math.sin(Math.min(1, clock / 1.3) * Math.PI) *
          0.12,
      };
    },
    applyCinematicCamera,
    updateCinematicCharacter(character: { model: THREE.Object3D } | null) {
      if (cinematic === "versus" && character)
        versus?.capture(character.model, [boss.root]);
    },
    renderCinematicOverlay(renderer: THREE.WebGLRenderer) {
      if (cinematic === "versus") versus?.render(renderer);
    },
    applyEntryCamera() {
      if (returnClock <= 0) return;
      const blend = THREE.MathUtils.smootherstep(1 - returnClock / 0.3, 0, 1);
      camera.position.lerpVectors(
        returnPosition,
        camera.position.clone(),
        blend,
      );
      camera.position.copy(
        clearCamera(
          new THREE.Vector3(
            player.body.position.x,
            player.getHeadY(),
            player.body.position.z,
          ),
          camera.position,
        ),
      );
      camera.quaternion.slerpQuaternions(
        returnRotation,
        camera.quaternion.clone(),
        blend,
      );
      camera.fov = THREE.MathUtils.lerp(returnFov, shotFov, blend);
      camera.updateProjectionMatrix();
    },
    // Near-miss camera punch (additive): FOV kick + small lateral offset, never touching the quaternion.
    applyNearMissCamera() {
      // Zero-G camera sway (change 2): a few degrees of roll following lateral drift velocity. This runs
      // after player.updateCamera zeroed rotation.z, so it is additive and never touches mouse-look yaw/pitch.
      const swayActive =
        player.isZeroGMode() &&
        !cleared &&
        returnClock <= 0 &&
        !cinematic &&
        !droneCutscene;
      if (swayActive) {
        camera.updateMatrixWorld();
        swayRight.setFromMatrixColumn(camera.matrixWorld, 0);
        const v = player.body.velocity;
        const lat = v.x * swayRight.x + v.y * swayRight.y + v.z * swayRight.z;
        const target =
          THREE.MathUtils.clamp(-lat / PHASE4_RULES.maxZeroGSpeed, -1, 1) *
          PHASE4_RULES.cameraSwayRoll;
        cameraSwayCurrent = THREE.MathUtils.damp(
          cameraSwayCurrent,
          target,
          PHASE4_RULES.cameraSwayResponse,
          frameDt,
        );
      } else {
        cameraSwayCurrent = THREE.MathUtils.damp(
          cameraSwayCurrent,
          0,
          PHASE4_RULES.cameraSwayResponse,
          frameDt,
        );
      }
      if (Math.abs(cameraSwayCurrent) > 1e-5)
        camera.rotation.z += cameraSwayCurrent;
      if (nearMissClock <= 0) {
        if (nearMissApplied) {
          camera.fov = nearMissBaseFov;
          camera.updateProjectionMatrix();
          nearMissApplied = false;
        }
        return;
      }
      if (returnClock > 0) return;
      if (!nearMissApplied) {
        nearMissBaseFov = camera.fov;
        nearMissApplied = true;
      }
      const p = THREE.MathUtils.clamp(
        1 - nearMissClock / NEAR_MISS.duration,
        0,
        1,
      );
      const punch = Math.sin(p * Math.PI);
      camera.fov = nearMissBaseFov + NEAR_MISS.fovPunch * punch;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      nearMissRight.setFromMatrixColumn(camera.matrixWorld, 0);
      camera.position.addScaledVector(
        nearMissRight,
        NEAR_MISS.offset * punch * nearMissSide,
      );
    },
    restartAtCheckpoint() {
      if (!onRespawn || disposed) return false;
      if (!deathClock) {
        markPhaseFour();
        deathClock = 0.01;
      }
      return true;
    },
    onPlayerDeath() {
      if (!onRespawn) return false;
      if (!deathClock) {
        markPhaseFour();
        deathClock = 2.5;
        boss.dispose();
        freeze();
        phase4Hud?.classList.add("hidden");
        if (cinematic === "gravityIntro") cinematic = null;
        startLightDim(1, PHASE4_RULES.lightRestoreSeconds);
        if (warningEl) warningEl.classList.add("hidden");
        introSkipButton.classList.add("hidden");
        if (subtitles) {
          subtitles.textContent = "WARDEN CHECKPOINT / RESTARTING";
          subtitles.classList.remove("hidden");
        }
      }
      return true;
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Math.max(
        0,
        Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime),
      );
      frameDt = dt; // consumed by the zero-G camera sway in applyNearMissCamera (change 2)
      updateLightDim(dt); // phase-4 bay-light dim/restore tween (round 1 change 2b); runs even during the death clock
      skipButton.classList.toggle(
        "hidden",
        cinematic !== "reveal" || cinematicTime < 3.5,
      );
      skipHold.update(dt);
      if (disposed) return;
      introSkipButton.classList.toggle(
        "hidden",
        cinematic !== "gravityIntro" ||
          cinematicTime <
            PHASE4_RULES.possessionSeconds + PHASE4_RULES.introSkipAvailableAt,
      );
      introSkip.update(dt);
      if (disposed) return;
      if (deathClock > 0) {
        deathClock = Math.max(0, deathClock - dt);
        if (!deathClock) onRespawn?.(respawnAtPhaseFour);
        return;
      }
      if (returnClock > 0) {
        returnClock = Math.max(0, returnClock - dt);
        if (!returnClock) {
          camera.fov = shotFov;
          camera.updateProjectionMatrix();
        }
      }
      updateCinematic(dt);
      if (disposed) return;
      updateThrow(dt);
      if (droneCutscene) {
        droneCutscene.clock += dt;
        droneCutscene.time += dt;
        if (droneCutscene.stage === "incoming") {
          const t = THREE.MathUtils.smootherstep(
            droneCutscene.clock,
            0.12,
            BOSS_RULES.droneDetonateAt / BOSS_RULES.droneExplosionSlow,
          );
          const position = droneCutscene.start
            .clone()
            .lerp(droneCutscene.dodge, t);
          player.setPosition(position.x, position.y, position.z);
          const direction = droneCutscene.dodge
            .clone()
            .sub(droneCutscene.start);
          if (direction.lengthSq() > 0.001)
            player.setRotation(Math.atan2(-direction.x, -direction.z), 0);
        } else {
          const position = droneCutscene.impactStart
            .clone()
            .lerp(
              droneCutscene.recoil,
              THREE.MathUtils.smootherstep(droneCutscene.clock, 0, 0.9),
            );
          player.setPosition(position.x, position.y, position.z);
        }
        subtitles?.classList.add("hidden");
      }
      const droneScale = !droneCutscene
        ? 1
        : droneCutscene.stage === "incoming"
          ? BOSS_RULES.droneExplosionSlow
          : THREE.MathUtils.lerp(
              0.25,
              1,
              THREE.MathUtils.smoothstep(droneCutscene.clock, 0.65, 1.3),
            );
      // Near-miss slow-mo (additive): dip the scene timeScale, never below the drone cutscene scale.
      let nearMissScale = 1;
      if (nearMissClock > 0) {
        nearMissClock = Math.max(0, nearMissClock - dt);
        const p = THREE.MathUtils.clamp(
          1 - nearMissClock / NEAR_MISS.duration,
          0,
          1,
        );
        nearMissScale = 1 - (1 - NEAR_MISS.slowMo) * Math.sin(p * Math.PI);
      }
      const timeScale = Math.min(droneScale, nearMissScale);
      cinematicDelta = cinematic === "reveal" ? revealDelta : dt * timeScale;
      if (droneCutscene?.stage === "impact")
        droneCutscene.poseTime += cinematicDelta;
      if (cinematic !== "reveal") {
        physics.step(cinematicDelta, player, thirdPerson);
        boss.updateVisuals(cinematicDelta);
      }
      if (boy?.visible && !boyDead) {
        boyMixer?.update(cinematicDelta);
        if (
          boyClipName === "death" &&
          boyAction &&
          boyAction.time >= boyAction.getClip().duration
        )
          boyDead = true;
      }
      for (const piece of rubble) {
        if (piece.life <= 0) continue;
        piece.life -= cinematicDelta;
        piece.velocity.y -= cinematicDelta * 9.82;
        piece.mesh.position.addScaledVector(piece.velocity, cinematicDelta);
        if (piece.mesh.position.y < 0.12) {
          piece.mesh.position.y = 0.12;
          piece.velocity.set(0, 0, 0);
        } else {
          piece.mesh.rotation.x += cinematicDelta * 2;
          piece.mesh.rotation.z += cinematicDelta;
        }
        if (piece.life <= 0) piece.mesh.visible = false;
      }
      door.update(dt, player, cleared && !cinematic && door.near(player));
      if (disposed) return;

      arenaSupplyTime += cinematicDelta;
      if (supplyNoticeTime > 0) {
        supplyNoticeTime = Math.max(0, supplyNoticeTime - cinematicDelta);
        if (!supplyNoticeTime && !cinematic && !droneCutscene)
          subtitles?.classList.add("hidden");
      }
      if (phaseNoticeTime > 0) {
        phaseNoticeTime = Math.max(0, phaseNoticeTime - cinematicDelta);
        if (
          !phaseNoticeTime &&
          !supplyNoticeTime &&
          !cinematic &&
          !droneCutscene
        )
          subtitles?.classList.add("hidden");
      }
      for (const supply of arenaSupplies) {
        const { pickup } = supply;
        pickup.root.visible =
          !supply.collected && cinematic !== "reveal" && cinematic !== "lift";
        if (!pickup.root.visible) continue;
        pickup.update(arenaSupplyTime);
        if (
          cinematic ||
          droneCutscene ||
          !player.isEnabled() ||
          player.getHealth() <= 0
        )
          continue;
        const p = player.body.position,
          target = pickup.root.position;
        if (Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) >= 1.1)
          continue;
        const previous =
          supply.kind === "shield" ? player.getShield() : player.getHealth();
        const recovered =
          supply.kind === "shield" ? player.addShield(50) : player.heal(100);
        if (!recovered) continue;
        supply.collected = true;
        playItemPickupSound(0.5);
        collectedSupplies.add(supply.id);
        pickup.root.visible = false;
        supplyNoticeTime = 1.8;
        if (subtitles) {
          const current =
            supply.kind === "shield" ? player.getShield() : player.getHealth();
          subtitles.textContent = `${supply.kind === "shield" ? "SHIELD" : "HEALTH"} +${current - previous}`;
          subtitles.classList.remove("hidden");
        }
      }

      // The main view update applies the cinematic camera once, after character animation.
      updateHud();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      skipHold.dispose();
      skipButton.remove();
      introSkip.dispose();
      introSkipButton.remove(); // round 1 change 2: the phase-4 intro skip control
      window.removeEventListener("keydown", onKey);
      prompt?.classList.add("hidden");
      window.removeEventListener("keydown", onThrowKey, true);
      window.removeEventListener("keyup", onThrowKeyUp, true);
      window.removeEventListener("mousedown", onThrowMouse, true);
      window.removeEventListener("keydown", onTeleportKey, true);
      document.body.classList.remove("p4-bars-right", "p4-bars-aside");
      landed?.mesh.removeFromParent();
      landed = null;
      throwHud.remove();
      crystal?.mesh.removeFromParent();
      crystal = null;
      hud?.classList.add("hidden");
      subtitles?.classList.add("hidden");
      phase4Hud?.classList.add("hidden");
      updatePushPrompt(null); // hide the shared push-off prompt elements (change 4)
      if (warningEl) warningEl.classList.add("hidden"); // round 1 change 2d
      applyRoomLightScale(1);
      lightTween = null; // restore bay lights to their stored base (round 1 change 2b)
      // Dispose the phase-4 beacons (change 5): built once here, so release them here.
      beaconGroup.removeFromParent();
      for (const light of beaconLights) {
        light.removeFromParent();
        light.dispose();
      }
      for (const target of beaconLightTargets) target.removeFromParent();
      beaconBaseGeometry.dispose();
      beaconHousingGeometry.dispose();
      beaconLensGeometry.dispose();
      beaconHousingMaterial.dispose();
      beaconLensMaterial.dispose();
      versus?.dispose();
      versus = null;
      boss.dispose();
      disposeDefeatCutscene();
      blastGroup.removeFromParent();
      shieldBubble.removeFromParent();
      shrapnelInstances.removeFromParent();
      shrapnelInstances.dispose();
      blastSphereGeometry.dispose();
      blastCoreMaterial.dispose();
      blastFlashMaterial.dispose();
      blastRingMaterial.dispose();
      blastRing.geometry.dispose();
      shieldMaterial.dispose();
      shieldLatticeMaterial.dispose();
      shieldRingMaterial.dispose();
      shieldLattice.geometry.dispose();
      shieldRing.geometry.dispose();
      shieldLattice.removeFromParent();
      shieldRing.removeFromParent();
      shieldLight.removeFromParent();
      shrapnelGeometry.dispose();
      shrapnelMaterial.dispose();
      blastLight.removeFromParent();
      scorch.removeFromParent();
      sparkInstances.removeFromParent();
      sparkInstances.dispose();
      preBursts.forEach((burst) => {
        burst.mesh.removeFromParent();
        burst.material.dispose();
      });
      fireMaterials.forEach((material) => material.dispose());
      smokeMaterial.dispose();
      smokeGeometry.dispose();
      scorchMaterial.dispose();
      scorchGeometry.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      boyMixer?.stopAllAction();
      if (boy) boyMixer?.uncacheRoot(boy);
      boyOriginalMaterials.forEach((material) => material.dispose());
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
      rubbleGeometry.dispose();
    },
  };
}
