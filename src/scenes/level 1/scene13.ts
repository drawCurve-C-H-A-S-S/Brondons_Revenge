import * as THREE from 'three';
import { inputHint } from '../../scripts/gamepadInput.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { BAY_THIRTEEN_MAP } from '../level 1 stage 2/stageTwoLayout.js';
import * as CANNON from 'cannon-es';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadBoyModel, preloadBossModels } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, createSlidingPortal, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createHangarVersus } from '../../helpers/scene/hangarVersus.js';
import { createHoldToSkip } from '../../helpers/animation/holdToSkip.js';
import { createHoldToDeploy } from '../../helpers/animation/holdToDeploy.js';
import { createPhase4Decoys } from '../../scripts/phase4Decoys.js';
import { createPhase4DetectionHud } from '../../scripts/phase4DetectionHud.js';
import { createRecoveryPickup } from '../../helpers/scene/recoveryPickup.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { BOSS_RULES, PHASE4_RULES, createLoadingBayBoss, type BossPillar, type BossDetectionTarget } from '../../scripts/mechBaymaxBoss.js';
import { preloadMusic } from '../../helpers/audio/bufferedMusic.js';
import bgmUrl from '../../assets/bgm/DonRevBGM1.m4a?url';

export const BOSS_ENTRY_SECONDS = 7;
export const BOSS_VERSUS_SECONDS = 2.6;
export const ARENA_PILLAR_SUPPLIES = [
  { id: 'warden-shield-west', kind: 'shield', x: -13, z: -15 },
  { id: 'warden-health-west', kind: 'health', x: -13, z: 15 },
  { id: 'warden-health-east', kind: 'health', x: 13, z: -15 },
  { id: 'warden-shield-east', kind: 'shield', x: 13, z: 15 },
] as const;

export function preloadAssets() {
  return Promise.all([preloadMusic(bgmUrl), preloadBossModels()]);
}

/** Bay 13 arena, reached through the surveillance service elevator. */
export function createScene({ entryState, fromServiceLift = false, defeated = false, checkpoint = false, startAtPhaseFour = false, onDefeated, onDescend, onRespawn, loadBoy = loadBoyModel, loadDrone, loadBoss, renderer, healthPackCollected: initialHealthPackCollected = false, onHealthPackCollected }: {
  entryState?: PlayerTransitionState;
  fromServiceLift?: boolean;
  defeated?: boolean;
  checkpoint?: boolean;
  startAtPhaseFour?: boolean;
  onDefeated?: () => void;
  onRespawn?: () => void;
  onDescend?: (state: PlayerTransitionState) => void;
  loadBoy?: () => Promise<GLTF>;
  loadDrone?: () => Promise<GLTF>;
  loadBoss?: () => Promise<GLTF>;
  renderer?: THREE.WebGLRenderer;
  healthPackCollected?: boolean;
  onHealthPackCollected?: () => void;
} = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101a28); scene.fog = new THREE.Fog(0x101a28, 35, 95);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  // Tight bounds avoid narrow-phase work for distant limbs, drones, and room geometry.
  physicsWorld.broadphase.useBoundingBoxes = true;
  const broadphase = physicsWorld.broadphase;
  const needsCollision = broadphase.needBroadphaseCollision;
  // Cannon still runs expensive overlap-only narrowphase for kinematic pairs.
  // This arena scripts the rig, cinematic passenger, and lift; none use overlap events.
  // Their room clearance comes from sweeps. Keep all dynamic contacts and raycasts.
  broadphase.needBroadphaseCollision = function (a, b) {
    return (a.type === CANNON.Body.DYNAMIC || b.type === CANNON.Body.DYNAMIC)
      && needsCollision.call(this, a, b);
  };
  const steel = new THREE.MeshStandardMaterial({ color: 0x3e5060, metalness: 0.65, roughness: 0.48 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x566575, metalness: 0.4, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202d3a, metalness: 0.6, roughness: 0.55 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xeaa64c, emissive: 0xb36419, emissiveIntensity: 0.65 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x93dbef });
  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = steel, solid = true) => roomBox(scene, physics, s, p, m, solid);
  // A real circular opening lets the lift descend through the deck.
  const deckShape = new THREE.Shape(); deckShape.moveTo(-20, -24); deckShape.lineTo(20, -24); deckShape.lineTo(20, 24); deckShape.lineTo(-20, 24); deckShape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 4.5, 0, Math.PI * 2, true); deckShape.holes.push(hole);
  const deckGeometry = new THREE.ExtrudeGeometry(deckShape, { depth: 0.5, bevelEnabled: false, curveSegments: 24 });
  deckGeometry.rotateX(-Math.PI / 2); deckGeometry.translate(0, -0.5, 0);
  const deck = new THREE.Mesh(deckGeometry, dark); deck.receiveShadow = true; scene.add(deck);
  const vertices = Array.from(deckGeometry.attributes.position.array);
  const deckBody = new CANNON.Body({ mass: 0, shape: new CANNON.Trimesh(vertices, Array.from({ length: vertices.length / 3 }, (_, i) => i)) }); physicsWorld.addBody(deckBody);
  const platform = new THREE.Group(); platform.name = 'HangarElevator'; scene.add(platform);
  const liftDeck = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.4, 48), steel); liftDeck.position.y = -0.2; platform.add(liftDeck);
  // A parked lift is walkable static ground; scripted descent owns it only after E.
  const liftBody = new CANNON.Body({ type: CANNON.Body.STATIC, mass: 0, material: physics.solidMaterial, shape: new CANNON.Cylinder(4.5, 4.5, 0.4, 48) }); liftBody.position.y = -0.2; physicsWorld.addBody(liftBody);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.62, 4.62, 14, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x293645, side: THREE.BackSide, metalness: 0.5, roughness: 0.6 })); shaft.position.y = -7.2; scene.add(shaft);
  const consoleRoot = new THREE.Group(); consoleRoot.name = 'ElevatorConsole'; consoleRoot.position.set(0, defeated ? 0 : -1.5, -2.8); platform.add(consoleRoot);
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.6), steel); pedestal.position.y = 0.55; consoleRoot.add(pedestal);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.42, 0.09), cyan); screen.position.set(0, 1.12, -0.3); screen.rotation.x = -0.2; consoleRoot.add(screen);
  const consoleBody = physics.addBox({ x: 0.8, y: 1.3, z: 0.7 }, { x: 0, y: 0.65, z: -2.8 }); consoleBody.collisionResponse = defeated;
  box([0.6, 14, 48], [-20, 7, 0], wall); box([0.6, 14, 48], [20, 7, 0], wall);
  box([40, 14, 0.6], [0, 7, 24], wall); box([40, 0.5, 48], [0, 14, 0], dark);
  box([40, 3, 0.5], [0, 1.5, -24], wall);
  const door = createSlidingPortal(scene, physics, { x: 0, y: 3, z: -24, yaw: 0 }, 40, 11, 'SERVICE ELEVATOR / BAY 13');
  if (fromServiceLift) {
    box([4.4, 0.2, 3.6], [0, 2.9, -25.8], steel);
    box([4.4, 0.16, 3.6], [0, 6.2, -25.8], dark);
    box([4.4, 3.2, 0.18], [0, 4.6, -27.6], wall);
    for (const x of [-2.2, 2.2]) {
      box([0.18, 3.2, 3.6], [x, 4.6, -25.8], wall);
      box([0.04, 0.1, 2.2], [x * 0.96, 5.6, -25.8], cyan, false);
    }
    const light = new THREE.PointLight(0x93dbef, 12, 7); light.position.set(0, 5.9, -25.8); scene.add(light);
  }
  box([5, 3, 3], [0, 1.5, -22.5], steel);
  const stairs = physics.addStaircase({ width: 5, run: 9, rise: 3, position: { x: 0, y: 0, z: -12 }, yaw: Math.PI, stepCount: 18, material: steel });
  stairs.group.name = 'ArenaEntryStairs'; scene.add(stairs.group);
  // Rails follow the physical wedge rather than obstructing the walkable stair surface.
  for (const x of [-2.65, 2.65]) {
    for (let i = 0; i <= 6; i++) box([0.12, 1, 0.12], [x, 0.5 + i * 0.5, -12 - i * 1.5], amber);
    const rail = box([0.13, 0.13, Math.hypot(9, 3)], [x, 2.5, -16.5], amber, false);
    rail.rotation.x = Math.atan(3 / 9); physics.addBoxFromMesh(rail);
    box([0.14, 1, 3], [x, 3.5, -22.5], amber);
  }
  const pillars: THREE.Mesh[] = [], covers: BossPillar[] = [];
  const arenaSupplies: Array<{ id: string; kind: 'health' | 'shield'; collected: boolean; pickup: ReturnType<typeof createRecoveryPickup> }> = [];
  const rubble: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const rubbleGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const { id, kind, x, z } of ARENA_PILLAR_SUPPLIES) {
    const side = Math.sign(x);
    // Rear service recesses hold supplies; full-volume colliders retain the original cover behavior.
    const pillar = box([2.5, 14, 3], [x - side * 0.25, 7, z], wall, false); pillar.name = 'ArenaCoverPillar'; pillars.push(pillar);
    const parts = [pillar, box([3.5, 0.35, 3.5], [x, 0.175, z], steel, false),
      box([0.5, 0.4, 3], [x + side * 1.25, 0.2, z], wall, false),
      box([0.5, 12.6, 3], [x + side * 1.25, 7.7, z], wall, false)];
    for (const offset of [-1, 1]) parts.push(box([0.5, 1, 1], [x + side * 1.25, 0.9, z + offset], wall, false));
    const bodies = [physics.addBox({ x: 3, y: 14, z: 3 }, { x, y: 7, z }), physics.addBox({ x: 3.5, y: 0.35, z: 3.5 }, { x, y: 0.175, z })];
    for (const y of [1.55, 5.5, 10]) parts.push(box([3.06, 0.16, 3.06], [x, y, z], y === 1.55 ? amber : dark, false));
    const pickup = createRecoveryPickup(kind, new THREE.Vector3(x + side * 1.25, 0.88, z), { compact: true, illuminate: false });
    pickup.root.name = id; pickup.root.visible = !defeated; pickup.root.userData.minimap = false; scene.add(pickup.root);
    arenaSupplies.push({ id, kind, collected: false, pickup });
    let intact = true;
    covers.push({ position: new THREE.Vector3(x, 0, z), intact: () => intact, shatter() {
      if (!intact) return; intact = false; parts.forEach(part => { part.visible = false; }); bodies.forEach(body => physicsWorld.removeBody(body));
      for (let i = 0; i < 42; i++) {
        const mesh = new THREE.Mesh(rubbleGeometry, i % 4 ? wall : steel);
        mesh.scale.set(0.3 + (i % 3) * 0.25, 0.35 + (i % 4) * 0.18, 0.45);
        mesh.position.set(x + Math.sin(i) * 1.2, 0.5 + (i / 42) * 13, z + Math.cos(i) * 1.2); scene.add(mesh);
        rubble.push({ mesh, velocity: new THREE.Vector3(Math.sin(i * 4) * 6, 2 + i % 5, Math.cos(i * 7) * 6), life: 7 });
      }
    } });
  }
  for (let z = -20; z <= 20; z += 4) {
    if (Math.abs(z) >= 5) box([39, 0.015, 0.025], [0, 0.012, z], steel, false);
    for (const x of [-19.64, 19.64]) box([0.05, 0.12, 2.8], [x, 3, z], cyan, false);
  }
  // Giant sealed cargo doors and a loading lane establish the second bay.
  for (const x of [-5.1, 5.1]) box([9.8, 10, 0.2], [x, 5, 23.63], dark, false);
  for (let x = -9; x <= 9; x += 1.5) box([0.08, 9.2, 0.06], [x, 5, 23.48], steel, false);
  for (const x of [-6, 6]) box([0.16, 0.016, 34], [x, 0.014, 2], amber, false);
  for (const x of [-12, 0, 12]) box([0.5, 0.12, 38], [x, 13.65, 0], cyan, false);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.35, 4.48, 64), amber); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; platform.add(ring);
  scene.add(new THREE.HemisphereLight(0xb8d8ff, 0x31343a, 2));
  for (const x of [-10, 10]) for (const z of [-10, 10]) {
    const light = new THREE.PointLight(0xb4dbff, 120, 35); light.position.set(x, 11, z); scene.add(light);
  }
  const keyLight = new THREE.DirectionalLight(0xf4e9d2, 2.5); keyLight.position.set(-5, 12, -8); scene.add(keyLight);

  // --- Phase 4 room-light dimming (additive; round 1 change 2b). Snapshot the bay lights exactly as
  // they stand before the beacons/player/boss exist, so we can scale them down during the intro and
  // restore them when gravity returns. Phases 1-3 are untouched (the tween only runs in phase 4). ---
  const roomLights: Array<{ light: THREE.Light; base: number }> = [];
  scene.traverse(node => { if (node instanceof THREE.Light) roomLights.push({ light: node, base: node.intensity }); });
  let roomLightScale = 1, lightTween: { from: number; to: number; time: number; duration: number } | null = null;
  function applyRoomLightScale(scale: number) {
    roomLightScale = scale;
    for (const entry of roomLights) entry.light.intensity = entry.base * scale;
  }
  function startLightDim(to: number, duration: number) {
    lightTween = { from: roomLightScale, to, time: 0, duration: Math.max(0.001, duration) };
  }
  function updateLightDim(dt: number) {
    if (!lightTween) return;
    lightTween.time += dt;
    const t = Math.min(1, lightTween.time / lightTween.duration);
    applyRoomLightScale(THREE.MathUtils.lerp(lightTween.from, lightTween.to, THREE.MathUtils.smootherstep(t, 0, 1)));
    if (t >= 1) lightTween = null;
  }

  // --- Phase 4 red alarm beacons (additive; change 5). Built once, hidden until zero-G, disposed on exit. ---
  // Four spinning emissive beacons in the upper corners; at most 2 real lights (no shadows) for performance.
  const beacons: Array<{ spin: THREE.Mesh }> = [];
  const beaconLights: THREE.SpotLight[] = [];
  const beaconLightTargets: THREE.Object3D[] = [];
  const beaconHousingMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.7, roughness: 0.5 });
  const beaconLensMaterial = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: PHASE4_RULES.beaconColor, emissiveIntensity: PHASE4_RULES.beaconEmissiveIntensity, side: THREE.DoubleSide, metalness: 0.2, roughness: 0.35 });
  const beaconBaseGeometry = new THREE.BoxGeometry(0.72, 0.16, 0.72);
  const beaconHousingGeometry = new THREE.CylinderGeometry(0.34, 0.4, 0.5, 16);
  const beaconLensGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.36, 16, 1, false, 0, Math.PI);
  const beaconGroup = new THREE.Group(); beaconGroup.name = 'Phase4Beacons'; beaconGroup.visible = false; scene.add(beaconGroup);
  let beaconTime = 0;
  {
    const bx = 20 - PHASE4_RULES.beaconInsetX, bz = 24 - PHASE4_RULES.beaconInsetZ;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const mount = new THREE.Group();
      mount.position.set(sx * bx, PHASE4_RULES.beaconY, sz * bz);
      const base = new THREE.Mesh(beaconBaseGeometry, beaconHousingMaterial); base.position.y = -0.32; mount.add(base);
      const housing = new THREE.Mesh(beaconHousingGeometry, beaconHousingMaterial); mount.add(housing);
      const spin = new THREE.Mesh(beaconLensGeometry, beaconLensMaterial);
      spin.scale.setScalar(PHASE4_RULES.beaconScale); spin.position.y = 0.02; mount.add(spin);
      beacons.push({ spin });
      beaconGroup.add(mount);
      // Only two real lights (diagonal corners) so the shader light budget stays small; no shadows.
      // Round 1 change 2c: rotating red SpotLights whose targets sweep the walls, floor and ceiling.
      if ((sx > 0) === (sz > 0)) {
        const light = new THREE.SpotLight(PHASE4_RULES.beaconColor, PHASE4_RULES.beaconSpotIntensity,
          PHASE4_RULES.beaconSpotDistance, PHASE4_RULES.beaconSpotAngle, PHASE4_RULES.beaconSpotPenumbra, PHASE4_RULES.beaconSpotDecay);
        light.castShadow = false; light.visible = false; light.position.copy(mount.position);
        const target = new THREE.Object3D(); target.position.set(0, PHASE4_RULES.beaconSweepHeightCenter, 0);
        light.target = target;
        beaconGroup.add(light); beaconGroup.add(target);
        beaconLights.push(light); beaconLightTargets.push(target);
      }
    }
  }

  // --- Health Pack (appears after boss defeat) ---
  const healthPackPos = new THREE.Vector3(0, 1.2, -2.8);
  const healthPack = createRecoveryPickup('health', healthPackPos);
  const healthPackGroup = healthPack.root;
  healthPackGroup.visible = defeated && !initialHealthPackCollected;
  scene.add(healthPackGroup);
  let healthPackCollected = initialHealthPackCollected;
  if (healthPackCollected) {
    healthPackGroup.visible = false;
  }
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 150);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 3.3, z: -22.8 } }); player.enable();
  if (fromServiceLift) teleportPlayer(player, { x: 0, y: 3 + player.radius, z: -25.2 }, Math.PI, entryState);
  else if (entryState) player.restoreTransition(entryState, door.frame);
  else player.setRotation(Math.PI);
  if (checkpoint) player.setPosition(0, 0.3, defeated ? -6.2 : -10.2);
  door.openImmediately();
  let deathClock = 0;
  let bossVictory = false;
  let disposed = false, cleared = defeated, cinematic: 'entry' | 'versus' | 'awakening' | 'reveal' | 'lift' | 'gravityIntro' | null = defeated || checkpoint || startAtPhaseFour ? null : 'entry', cinematicTime = 0;
  let versus: ReturnType<typeof createHangarVersus> | null = null;
  let arenaSupplyTime = 0, supplyNoticeTime = 0;
  let droneCutscene: { root: THREE.Object3D; stage: 'incoming' | 'impact'; clock: number; time: number; poseTime: number; impactPosition: THREE.Vector3 | null;
    start: THREE.Vector3; dodge: THREE.Vector3; impactStart: THREE.Vector3; recoil: THREE.Vector3;
    yaw: number; pitch: number; side: number; attackAngle: number; envelope: THREE.Box3 } | null = null;
  type OrbitShot = { kind: 'boss' | 'drone'; bounds: THREE.Box3; points: THREE.Vector3[]; focus: THREE.Vector3;
    angle: number; sweep: number; distance: number; height: number };
  let orbitShot: OrbitShot | null = null, awakeningReleaseClock = -1;
  const cameraUp = new THREE.Vector3(0, 1, 0);
  const shotStart = new THREE.Vector3(), shotRotation = new THREE.Quaternion();
  let shotFov = 70, returnClock = 0, returnFov = 70;
  const returnPosition = new THREE.Vector3(), returnRotation = new THREE.Quaternion();
  const revealOrigin = new THREE.Vector3();
  function captureShot() {
    shotStart.copy(camera.position); shotRotation.copy(camera.quaternion); shotFov = returnClock > 0 ? shotFov : camera.fov;
    returnClock = 0; orbitShot = null;
  }
  function returnToBattle() {
    returnPosition.copy(camera.position); returnRotation.copy(camera.quaternion); returnFov = camera.fov; returnClock = 0.3;
    camera.fov = shotFov; camera.updateProjectionMatrix();
    subtitles?.classList.add('hidden'); if (!disposed && !deathClock) release();
  }
  function dodgeDestination(start: THREE.Vector3, direction: THREE.Vector3, reach = 1.05) {
    let distance = reach;
    const across = new THREE.Vector3(-direction.z, 0, direction.x);
    for (const offset of [-player.radius, 0, player.radius]) for (const height of [0.1, 0.8]) {
      const from = start.clone().addScaledVector(across, offset); from.y += height;
      const to = from.clone().addScaledVector(direction, distance + player.radius);
      physicsWorld.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z),
        { checkCollisionResponse: true }, hit => {
          if (hit.body !== player.body && hit.body?.type !== CANNON.Body.DYNAMIC) distance = Math.min(distance, Math.max(0, hit.distance - player.radius - 0.08));
        });
    }
    return start.clone().addScaledVector(direction, distance);
  }
  let cinematicDelta = 0;
  let liftTransferred = false;
  const liftPassenger = new THREE.Vector3();
  const boyOrigin = new THREE.Vector3();
  const prompt = document.getElementById('interact-prompt');
  function nearConsole() { return cleared && !cinematic && player.isEnabled() && player.getState().isOnGround && Math.hypot(player.body.position.x, player.body.position.z + 2.8) < 1.65 && Math.hypot(player.body.position.x, player.body.position.z) < 4.2; }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || !nearConsole() || !onDescend) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, [contenteditable="true"]')) return;
    event.preventDefault(); cinematic = 'lift'; cinematicTime = 0;
    liftPassenger.set(player.body.position.x, player.radius, player.body.position.z);
    for (const body of [liftBody, consoleBody]) { body.type = CANNON.Body.KINEMATIC; body.updateMassProperties(); body.wakeUp(); }
    freeze(); player.body.collisionResponse = false; prompt?.classList.add('hidden');
  }
  window.addEventListener('keydown', onKey);
  const entryStart = new THREE.Vector3().copy(player.body.position);
  let boy: THREE.Group | null = null, boyMixer: THREE.AnimationMixer | null = null;
  let boyError = false;
  const hud = document.getElementById('boss-hud'), fill = document.getElementById('boss-health-fill');
  const label = document.getElementById('boss-health-label');
  const subtitles = document.getElementById('boss-subtitles');
  // --- Phase 4 HUD (thruster heat + entanglement pips) and near-miss slow-mo / camera state. ---
  const phase4Hud = document.getElementById('phase4-hud');
  const phase4Heat = document.getElementById('phase4-heat-fill');
  const phase4Pips = document.getElementById('phase4-entangle-pips');
  // Round 1 change 2d: centre-screen flashing "gravity offline" warning shown during the intro.
  const warningEl = document.getElementById('phase4-warning');
  const NEAR_MISS = { duration: 0.4, slowMo: 0.45, fovPunch: 9, offset: 0.14 };
  let nearMissClock = 0, nearMissSide = 1, nearMissBaseFov = 70, nearMissApplied = false, phaseNoticeTime = 0;
  const nearMissRight = new THREE.Vector3();
  // Wall push-off prompt elements (change 4) and zero-G camera-sway state (change 2).
  const pushPrompt = {
    container: document.getElementById('phase4-push-prompt'),
    left: document.getElementById('phase4-push-left'),
    right: document.getElementById('phase4-push-right'),
    top: document.getElementById('phase4-push-top'),
    bottom: document.getElementById('phase4-push-bottom'),
  };
  let frameDt = 1 / 60, cameraSwayCurrent = 0;
  const swayRight = new THREE.Vector3();
  function triggerNearMiss(side: number) { nearMissSide = Math.sign(side) || 1; nearMissClock = NEAR_MISS.duration; }
  function showPhaseNotice(text: string) {
    if (!subtitles) return;
    subtitles.textContent = text; subtitles.classList.remove('hidden'); phaseNoticeTime = 3.2;
  }
  const skipButton = document.createElement('button');
  skipButton.type = 'button'; skipButton.className = 'scene-dialogue-skip hidden';
  document.body.appendChild(skipButton);
  function finishVictoryDialogue() {
    if (disposed || cinematic !== 'reveal' || cleared) return;
    cloud.visible = false;
    if (boy) { boy.visible = true; boy.position.x = boyOrigin.x + 6.7; }
    consoleRoot.position.y = 0;
    cinematic = null; cleared = true; door.setLocked(false); consoleBody.collisionResponse = true;
    release(); subtitles?.classList.add('hidden'); skipButton.classList.add('hidden');
    if (!healthPackCollected) healthPackGroup.visible = true;
    onDefeated?.();
  }
  const skipHold = createHoldToSkip({ button: skipButton, onSkip: finishVictoryDialogue,
    isAvailable: () => !disposed && cinematic === 'reveal' && cinematicTime >= 3.5 });
  // Round 1 change 2: a separate hold-to-skip instance for the phase-4 intro. The existing
  // skipButton/skipHold stay wired to the victory reveal and are left byte-for-byte unchanged.
  const introSkipButton = document.createElement('button');
  introSkipButton.type = 'button'; introSkipButton.className = 'scene-dialogue-skip hidden';
  document.body.appendChild(introSkipButton);
  const introSkip = createHoldToSkip({ button: introSkipButton, onSkip: () => finishPhase4Intro(),
    isAvailable: () => !disposed && cinematic === 'gravityIntro' && cinematicTime >= PHASE4_RULES.introSkipAvailableAt });
  const status = document.getElementById('loading-bay-status');
  status?.classList.add('hidden');
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 1, depthWrite: false });
  const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cloud = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, 260); cloud.name = 'BossBlackParticles'; cloud.visible = false; cloud.frustumCulled = false; scene.add(cloud);
  const particles = Array.from({ length: 260 }, () => ({ start: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 7, (Math.random() - 0.5) * 5), drift: new THREE.Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2), size: 0.2 + Math.random() * 0.5 }));
  function freeze() { player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties(); player.body.velocity.set(0, 0, 0); }
  function release() { player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.enable(); }
  function beginVersus() {
    cinematic = 'versus'; cinematicTime = 0; door.setLocked(true); subtitles?.classList.add('hidden');
    versus = createHangarVersus({ singleOpponent: true, playerName: 'BRONDON', opponentName: 'BAY WARDEN' });
    versus.update(0);
  }
  if (cinematic) freeze();
  // --- Phase 4 round 2a: holographic decoys + the AI's ML human-detection HUD. Additive; inert until the
  // zero-G barrage runs. Owns the decoy pool, the three plantable anchors + pulsing ring markers, the
  // screen-space detection boxes, and the hold-E deploy interaction. Nothing here touches phases 1-3. ---
  const decoyCount = PHASE4_RULES.decoyCount;
  const decoys = createPhase4Decoys({ scene, rules: {
    count: decoyCount, color: PHASE4_RULES.decoyColor, height: PHASE4_RULES.decoyHeight,
    idleTimeScale: PHASE4_RULES.decoyIdleTimeScale, flickerIn: PHASE4_RULES.decoyFlickerIn,
    timeOffset: PHASE4_RULES.decoyTimeOffset, glitchSeconds: PHASE4_RULES.decoyGlitchSeconds,
  } });
  const detectionContainer = document.getElementById('phase4-detection');
  const detectionHud = createPhase4DetectionHud({
    container: detectionContainer, camera, boxCount: decoyCount + 1,
    boxHeight: PHASE4_RULES.detBoxHeight, boxWidthFactor: PHASE4_RULES.detBoxWidthFactor,
    glitchLabels: PHASE4_RULES.detGlitchLabels, glitchReshuffle: PHASE4_RULES.detGlitchReshuffle,
  });
  const deployPrompt = document.getElementById('phase4-deploy-prompt');
  const deployFill = document.getElementById('phase4-deploy-fill');
  // Anchor points (configurable in PHASE4_RULES), a preallocated probe vector, and a pooled ring marker each.
  const decoyAnchors: THREE.Vector3[] = [];
  const decoyRings: Array<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }> = [];
  const decoyConfidence: number[] = [];
  const ringGeometry = new THREE.TorusGeometry(PHASE4_RULES.ringRadius, PHASE4_RULES.ringTube, 8, 40);
  for (let i = 0; i < decoyCount; i++) {
    decoyAnchors.push(new THREE.Vector3(PHASE4_RULES.decoyAnchorX[i], PHASE4_RULES.decoyAnchorY[i], PHASE4_RULES.decoyAnchorZ[i]));
    decoyConfidence.push(PHASE4_RULES.decoyConfidenceMin);
    const material = new THREE.MeshBasicMaterial({ color: PHASE4_RULES.ringColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.name = `Phase4DecoyRing-${i}`; mesh.rotation.x = -Math.PI / 2; mesh.position.copy(decoyAnchors[i]);
    mesh.visible = false; mesh.frustumCulled = false; mesh.userData.minimap = false; scene.add(mesh);
    decoyRings.push({ mesh, material });
  }
  // The live detection candidate list, reused every frame (index 0 = the player, i+1 = decoy i). The boss
  // reads it only when it launches a volley; the HUD reads it every frame. Neither path allocates.
  const detectionTargets: BossDetectionTarget[] = [
    { id: -1, isPlayer: true, position: new THREE.Vector3(), confidence: PHASE4_RULES.playerConfidence0, visible: false },
  ];
  for (let i = 0; i < decoyCount; i++) detectionTargets.push({ id: i, isPlayer: false, position: new THREE.Vector3(), confidence: PHASE4_RULES.decoyConfidenceMin, visible: false });
  let nearestAnchor = -1, decoyElapsed = 0;
  const _anchorProbe = new THREE.Vector3();
  function rollDecoyConfidence() {
    const span = PHASE4_RULES.decoyConfidenceMax - PHASE4_RULES.decoyConfidenceMin;
    return PHASE4_RULES.decoyConfidenceMin + Math.random() * span;
  }
  function plantDecoy(index: number) {
    if (index < 0 || decoys.isActive(index)) return;
    if (decoys.plant(index, decoyAnchors[index])) { decoyConfidence[index] = rollDecoyConfidence(); showPhaseNotice('DECOY DEPLOYED'); }
  }
  const deployHold = createHoldToDeploy({
    holdSeconds: PHASE4_RULES.deployHoldSeconds, onDeploy: () => plantDecoy(nearestAnchor),
    prompt: deployPrompt, fill: deployFill,
    isAvailable: () => nearestAnchor >= 0,
    isPaused: () => cinematic !== null || cleared,
  });
  function resetDecoys() {
    decoys.resetAll(); nearestAnchor = -1;
    for (let i = 0; i < decoyCount; i++) decoyConfidence[i] = PHASE4_RULES.decoyConfidenceMin;
  }
  // Per-frame phase-4 decoy/detection update, called from updateHud (which already has the boss status).
  function updatePhase4Decoys(s: { modelFailing: boolean; aimedDecoyId: number }, phase4Visible: boolean, dt: number) {
    decoyElapsed += dt;
    decoys.update(dt);
    // Pulsing ring markers: shown only for anchors that are still free, and only while floating.
    for (let i = 0; i < decoyCount; i++) {
      const marker = decoyRings[i];
      const show = phase4Visible && !decoys.isActive(i);
      marker.mesh.visible = show;
      if (!show) continue;
      const pulse = 0.5 + 0.5 * Math.sin(decoyElapsed * PHASE4_RULES.ringPulseSpeed + i * 1.3);
      marker.mesh.scale.setScalar(1 + pulse * 0.16);
      marker.material.opacity = 0.3 + pulse * 0.4;
    }
    // Nearest free anchor within deploy range (3D; the player floats in the dodge plane).
    nearestAnchor = -1;
    if (phase4Visible && player.isEnabled() && player.getHealth() > 0) {
      const p = player.body.position;
      let best: number = PHASE4_RULES.deployRadius;
      for (let i = 0; i < decoyCount; i++) {
        if (decoys.isActive(i)) continue;
        const a = decoyAnchors[i];
        const d = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
        if (d < best) { best = d; nearestAnchor = i; }
      }
    }
    // Refresh the detection candidate list in place for both the boss targeting and the HUD labels.
    const active = decoys.activeCount();
    detectionTargets[0].visible = phase4Visible;
    detectionTargets[0].confidence = active >= 3 ? PHASE4_RULES.playerConfidence3
      : active === 2 ? PHASE4_RULES.playerConfidence2
        : active === 1 ? PHASE4_RULES.playerConfidence1 : PHASE4_RULES.playerConfidence0;
    detectionTargets[0].position.set(player.body.position.x, player.body.position.y, player.body.position.z);
    for (let i = 0; i < decoyCount; i++) {
      const t = detectionTargets[i + 1];
      const on = decoys.isActive(i) && phase4Visible;
      t.visible = on;
      if (!on) continue;
      _anchorProbe.copy(decoys.getPosition(i)); _anchorProbe.y += PHASE4_RULES.detCenterHeight;
      t.position.copy(_anchorProbe);
      t.confidence = THREE.MathUtils.clamp(decoyConfidence[i] + (Math.random() - 0.5) * PHASE4_RULES.decoyConfidenceJitter, 0, 1);
    }
    deployHold.update(dt);
    if (phase4Visible) {
      detectionHud.show();
      detectionHud.update(dt, detectionTargets, s.modelFailing, s.aimedDecoyId < 0 ? 0 : s.aimedDecoyId + 1);
    } else detectionHud.hide();
  }
  const boss = createLoadingBayBoss(scene, physicsWorld, player, () => {
    bossVictory = true;
    cinematic = 'reveal'; cinematicTime = 0; freeze(); cloud.visible = true;
    revealOrigin.set(boss.root.position.x, 0, boss.root.position.z); cloud.position.copy(revealOrigin);
    if (boy) { boy.visible = true; boy.position.copy(boyOrigin).add(revealOrigin); }
  }, covers, {
    loadDrone, loadBoss,
    onPhaseThree() { captureShot(); cinematic = 'awakening'; cinematicTime = 0; awakeningReleaseClock = -1; freeze(); },
    onPhaseThreeEnd() { if (cinematic === 'awakening') awakeningReleaseClock = 0.85; },
    onDroneApproach(root) {
      if (droneCutscene || cinematic) return;
      captureShot();
      const start = new THREE.Vector3().copy(player.body.position), state = player.getState();
      const toward = root.position.clone().sub(start); toward.y = 0; toward.normalize();
      if (toward.lengthSq() < 0.001) toward.set(0, 0, 1);
      const right = new THREE.Vector3(toward.z, 0, -toward.x);
      const a = dodgeDestination(start, right), b = dodgeDestination(start, right.clone().negate());
      const side = a.distanceToSquared(start) >= b.distanceToSquared(start) ? 1 : -1;
      const dodge = side === 1 ? a : b;
      const explosion = root.getWorldPosition(new THREE.Vector3()).lerp(new THREE.Vector3(start.x, player.getHeadY(), start.z), 0.78);
      const envelope = new THREE.Box3().setFromPoints([start, dodge, root.getWorldPosition(new THREE.Vector3()),
        start.clone().add(new THREE.Vector3(0, 2.2, 0)), dodge.clone().add(new THREE.Vector3(0, 2.2, 0))]);
      envelope.union(new THREE.Box3(explosion.clone().addScalar(-3.6), explosion.clone().addScalar(3.6)));
      envelope.expandByScalar(0.45); envelope.min.y = Math.max(0.05, envelope.min.y);
      droneCutscene = { root, stage: 'incoming', clock: 0, time: 0, poseTime: 0, impactPosition: null,
        start, dodge, impactStart: dodge.clone(), recoil: dodge.clone(), yaw: state.yaw, pitch: state.pitch, side,
        attackAngle: Math.atan2(toward.x, toward.z), envelope };
      freeze();
    },
    onDroneExplosion(root, position) {
      if (!droneCutscene) return;
      const dc = droneCutscene;
      dc.stage = 'impact'; dc.clock = 0; dc.poseTime = 0; dc.impactPosition = position; dc.root = root;
      dc.impactStart.copy(player.body.position);
      const away = dc.impactStart.clone().sub(position); away.y = 0;
      if (away.lengthSq() < 0.001) away.set(Math.sin(dc.yaw), 0, Math.cos(dc.yaw));
      dc.recoil.copy(dodgeDestination(dc.impactStart, away.normalize(), 0.7));
      dc.envelope.expandByPoint(dc.recoil.clone().add(new THREE.Vector3(0, 2.2, 0)));
    },
    onDroneExplosionEnd() {
      if (!droneCutscene) return;
      player.setRotation(droneCutscene.yaw, droneCutscene.pitch);
      droneCutscene = null; returnToBattle();
    },
    // Phase 4 hooks (additive): subtitle notices plus the near-miss slow-mo / camera punch.
    onPhaseFour() { startPhase4Intro(); },
    onTrapped() { showPhaseNotice('ENTANGLED — RESETTING THE BARRAGE'); },
    onNearMiss(side) { triggerNearMiss(side); },
    // Round 2a: feed the detection model, glitch a decoy the net hits, and reset/glitch on the breaking
    // point. onBarrageStart fires on first entry and the exposed-window return (never the trapped retry).
    getDetectionTargets() { return detectionTargets; },
    onNetHitDecoy(id) { decoys.glitch(id); },
    onBarrageStart() { resetDecoys(); },
    onModelFail() { showPhaseNotice('DETECTION MODEL OVERLOADING'); },
  });
  if (defeated) boss.dispose();
  else if (startAtPhaseFour) { door.setLocked(true); player.setPosition(0, player.radius + 0.4, -8); boss.startAtPhaseFour(); }
  else if (checkpoint) { door.setLocked(true); boss.start(); }
  const ready = loadBoy().then(gltf => {
    if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; }
    boy = gltf.scene; boy.name = 'FreedBoy';
    const bounds = new THREE.Box3().setFromObject(boy), height = bounds.getSize(new THREE.Vector3()).y;
    boy.scale.multiplyScalar(1.75 / Math.max(height, 0.01));
    bounds.setFromObject(boy); const center = bounds.getCenter(new THREE.Vector3());
    boy.position.set(-center.x, -bounds.min.y, -center.z); boyOrigin.copy(boy.position);
    if (cleared) boy.position.x += 6.7;
    scene.add(boy);
    boy.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    boy.visible = cleared || cinematic === 'reveal';
    boyMixer = new THREE.AnimationMixer(boy);
    const idle = gltf.animations.find(clip => /idle/i.test(clip.name));
    if (idle) boyMixer.clipAction(idle).play();
  }).catch(error => { if (!disposed) { boyError = true; console.error('[Scene 13] Failed to load boy.glb:', error); } });
  // Sample both sides of the action; clamp and sweep the winning camera against the room.
  const fitForward = new THREE.Vector3(), fitRight = new THREE.Vector3(), fitUp = new THREE.Vector3(), fitLocal = new THREE.Vector3();
  const liveBossBounds = new THREE.Box3(), droneFrameBounds = new THREE.Box3();
  const droneFrameFocus = new THREE.Vector3(), droneFramePoint = new THREE.Vector3();
  const droneFramePoints = Array.from({ length: 8 }, () => new THREE.Vector3());
  function clearCamera(focus: THREE.Vector3, desired: THREE.Vector3) {
    const end = desired.clone();
    end.x = THREE.MathUtils.clamp(end.x, -19.25, 19.25);
    end.y = THREE.MathUtils.clamp(end.y, 0.65, 13.2);
    end.z = THREE.MathUtils.clamp(end.z, -23.25, 23.25);
    const direction = end.clone().sub(focus), length = direction.length();
    if (length < 0.001) return end;
    direction.divideScalar(length);
    let clearance = length;
    for (const offset of [new THREE.Vector3(), new THREE.Vector3(0.18, 0, 0), new THREE.Vector3(-0.18, 0, 0), new THREE.Vector3(0, 0.18, 0)]) {
      const from = focus.clone().add(offset), to = end.clone().add(offset);
      physicsWorld.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z), { skipBackfaces: false }, hit => {
        if (hit.body?.type === CANNON.Body.STATIC && hit.body.collisionResponse) clearance = Math.min(clearance, Math.max(0.05, hit.distance - 0.25));
      });
    }
    return focus.clone().addScaledVector(direction, clearance);
  }
  function corners(bounds: THREE.Box3, points = Array.from({ length: 8 }, () => new THREE.Vector3())) {
    for (let i = 0; i < 8; i++) points[i].set(i & 4 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y, i & 1 ? bounds.max.z : bounds.min.z);
    return points;
  }
  function orbitPosition(shot: OrbitShot, progress: number, position = new THREE.Vector3()) {
    const angle = shot.angle + shot.sweep * progress;
    // Ease a dolly-in through the dodge, hold the impact, then open up for the recoil.
    const push = THREE.MathUtils.smootherstep(progress, 0, 0.42);
    const recover = THREE.MathUtils.smootherstep(progress, 0.65, 1);
    const distance = shot.distance * (shot.kind === 'drone' ? 1.4 - push * 0.4 + recover * 0.08
      : 1 + Math.sin(progress * Math.PI) * 0.04);
    return position.set(
      THREE.MathUtils.clamp(shot.focus.x + Math.sin(angle) * distance, -19, 19),
      THREE.MathUtils.clamp(shot.focus.y + shot.height + progress * 0.35, 0.85, 12.8),
      THREE.MathUtils.clamp(shot.focus.z + Math.cos(angle) * distance, -23, 23));
  }
  function fittedFov(position: THREE.Vector3, focus: THREE.Vector3, points: THREE.Vector3[]) {
    const forward = fitForward.copy(focus).sub(position).normalize();
    const right = fitRight.crossVectors(forward, cameraUp).normalize();
    const up = fitUp.crossVectors(right, forward);
    let tangent = 0;
    for (const point of points) {
      const local = fitLocal.copy(point).sub(position), depth = local.dot(forward);
      if (depth <= 0.4) return 175;
      // Leave headroom, room below the boots, and space for the blast at every aspect ratio.
      tangent = Math.max(tangent, Math.abs(local.dot(up)) / (depth * 0.78),
        Math.abs(local.dot(right)) / (depth * Math.max(0.25, camera.aspect) * 0.84));
    }
    return THREE.MathUtils.radToDeg(2 * Math.atan(tangent));
  }
  function cameraBlockers(kind: OrbitShot['kind']) {
    return physicsWorld.bodies.filter(body => body.collisionResponse && body !== player.body
      && (body.type === CANNON.Body.STATIC || kind === 'drone' && body.type === CANNON.Body.KINEMATIC));
  }
  function segmentBlocked(from: THREE.Vector3, to: THREE.Vector3, box: THREE.Box3) {
    let near = 0, far = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-8) {
        if (from[axis] < box.min[axis] || from[axis] > box.max[axis]) return false;
      } else {
        const a = (box.min[axis] - from[axis]) / delta, b = (box.max[axis] - from[axis]) / delta;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
      }
    }
    return true;
  }
  function selectOrbit(kind: OrbitShot['kind'], bounds: THREE.Box3, preferredAngle: number, attackAngle = 0) {
    const focus = bounds.getCenter(new THREE.Vector3()), points = corners(bounds);
    const size = bounds.getSize(new THREE.Vector3());
    const baseDistance = Math.max(kind === 'boss' ? 14 : 6.5, size.y * 0.9, Math.hypot(size.x, size.z) * 0.8);
    const blockers = cameraBlockers(kind);
    // Snapshot conservative obstacle bounds once; arc scoring needs visibility, not contact points.
    const solids = blockers.map(body => {
      if (body.aabbNeedsUpdate) body.updateAABB();
      return new THREE.Box3(new THREE.Vector3().copy(body.aabb.lowerBound), new THREE.Vector3().copy(body.aabb.upperBound)).expandByScalar(0.35);
    });
    const samples = kind === 'boss'
      ? [focus, new THREE.Vector3(focus.x, bounds.max.y - 0.5, focus.z), new THREE.Vector3(focus.x, bounds.min.y + 0.8, focus.z)]
      : [droneCutscene!.start.clone().add(new THREE.Vector3(0, 1, 0)), droneCutscene!.dodge.clone().add(new THREE.Vector3(0, 1.2, 0)),
        droneCutscene!.root.getWorldPosition(new THREE.Vector3())];
    let best: OrbitShot | null = null, bestScore = -Infinity;
    const samplePosition = new THREE.Vector3(), previousSample = new THREE.Vector3();
    // Choose an entire clear arc once, rather than switching sides midway through the shot.
    for (let i = 0; i < 12; i++) for (const direction of [-1, 1]) for (const scale of [1, 1.3]) {
      const middle = preferredAngle + i * Math.PI / 6;
      const sweep = direction * (kind === 'boss' ? 0.65 : 1.25);
      const candidate: OrbitShot = { kind, bounds, points, focus, angle: middle - sweep * 0.5,
        sweep, distance: baseDistance * scale, height: kind === 'boss' ? -0.75 : 0.9 };
      let score = Math.cos(middle - preferredAngle) * 8, maxFov = 0;
      const intervals = kind === 'drone' ? 8 : 4;
      for (let sample = 0; sample <= intervals; sample++) {
        const t = sample / intervals;
        const position = orbitPosition(candidate, t, samplePosition);
        // Check the path between samples too: a zooming arc can cross a pillar
        // even when its sampled endpoints are clear. Solid clearance wins over framing.
        if (solids.some(box => box.containsPoint(position) || sample > 0 && segmentBlocked(previousSample, position, box))) score -= 1000000;
        previousSample.copy(position);
        maxFov = Math.max(maxFov, fittedFov(position, focus, points));
        for (const target of samples) {
          if (solids.some(box => segmentBlocked(position, target, box))) score -= 500;
        }
        if (kind === 'drone') {
          const viewAngle = candidate.angle + sweep * t;
          // Keep the player and fireball side by side, not one hidden behind the other.
          score += Math.abs(Math.sin(viewAngle - attackAngle)) * 12;
          if (Math.cos(viewAngle - attackAngle) > 0.35) score -= 15;
        }
      }
      score -= Math.max(0, maxFov - 82) * 30 + Math.abs(maxFov - 58) * 0.25;
      if (score > bestScore) { best = candidate; bestScore = score; }
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
    let focus = shot.focus, points = corners(shot.bounds, shot.points);
    if (shot.kind === 'drone' && droneCutscene) {
      const dc = droneCutscene, p = player.body.position;
      // Track the two live subjects, not the empty space left by the approaching drone.
      droneFrameBounds.min.set(p.x - 0.65, Math.max(0.05, p.y - player.radius), p.z - 0.65);
      droneFrameBounds.max.set(p.x + 0.65, p.y + 1.9, p.z + 0.65);
      const blastProgress = dc.poseTime / (BOSS_RULES.droneExplosionDuration - BOSS_RULES.droneDetonateAt);
      const radius = dc.stage === 'incoming' ? 0.45
        : 0.55 + THREE.MathUtils.smootherstep(blastProgress, 0, 0.7) * 3;
      const center = dc.impactPosition ?? dc.root.position;
      droneFrameBounds.expandByPoint(droneFramePoint.copy(center).addScalar(radius));
      droneFrameBounds.expandByPoint(droneFramePoint.copy(center).addScalar(-radius));
      droneFrameBounds.min.y = Math.max(0.05, droneFrameBounds.min.y);
      focus = droneFrameBounds.getCenter(droneFrameFocus);
      points = corners(droneFrameBounds, droneFramePoints);
    }
    camera.position.copy(position); camera.up.copy(cameraUp); camera.lookAt(focus);
    const fit = fittedFov(position, focus, points);
    const lens = shot.kind === 'drone'
      ? THREE.MathUtils.lerp(68, 32, THREE.MathUtils.smootherstep(progress, 0, 0.42))
        + THREE.MathUtils.smootherstep(progress, 0.65, 1) * 6
      : 52;
    // Subject fitting takes priority over the zoom near walls and on portrait screens.
    camera.fov = THREE.MathUtils.clamp(Math.max(lens, fit + 2), 32, 110);
    if (impactClock >= 0) {
      camera.fov = Math.min(112, camera.fov + Math.sin(Math.min(1, impactClock / 0.2) * Math.PI) * 4);
      camera.rotateZ(Math.sin(impactClock * 15) * Math.exp(-impactClock * 5) * 0.016);
    }
    camera.updateProjectionMatrix();
  }
  function applyCinematicCamera() {
    if (droneCutscene) {
      const dc = droneCutscene;
      if (!orbitShot || orbitShot.kind !== 'drone') orbitShot = selectOrbit('drone', dc.envelope, dc.attackAngle + dc.side * 1.9, dc.attackAngle);
      orbitShot.bounds.union(dc.envelope);
      drawOrbit(orbitShot, THREE.MathUtils.smootherstep(dc.time, 0, 3.05), dc.stage === 'impact' ? dc.clock : -1);
      return true;
    }
    if (cinematic === 'awakening') {
      const actual = boss.getCinematicBounds(liveBossBounds);
      if (!orbitShot || orbitShot.kind !== 'boss') {
        // Reserve space for the standing head, raised arms, and released swarm before the rise starts.
        const envelope = new THREE.Box3(new THREE.Vector3(boss.root.position.x - 5.8, 0.05, boss.root.position.z - 5.8),
          new THREE.Vector3(boss.root.position.x + 5.8, 11.5, boss.root.position.z + 5.8)).union(actual);
        orbitShot = selectOrbit('boss', envelope, boss.root.rotation.y + 0.3);
      }
      orbitShot.bounds.union(actual);
      drawOrbit(orbitShot, THREE.MathUtils.smootherstep(cinematicTime, 0, 4.5));
      return true;
    }
    // Round 1 change 2: slow boss orbit across the whole phase-4 intro (taunt, dim, warning, player line).
    if (cinematic === 'gravityIntro') {
      const actual = boss.getCinematicBounds(liveBossBounds);
      if (!orbitShot || orbitShot.kind !== 'boss') {
        const envelope = new THREE.Box3(new THREE.Vector3(boss.root.position.x - 5.8, 0.05, boss.root.position.z - 5.8),
          new THREE.Vector3(boss.root.position.x + 5.8, 11.5, boss.root.position.z + 5.8)).union(actual);
        orbitShot = selectOrbit('boss', envelope, boss.root.rotation.y + 0.3);
      }
      orbitShot.bounds.union(actual);
      drawOrbit(orbitShot, THREE.MathUtils.smootherstep(cinematicTime, 0, PHASE4_RULES.introEndAt));
      return true;
    }
    if (!cinematic) return false;
    if (cinematic === 'versus') return true;
    if (cinematic === 'entry') {
      const p = player.body.position;
      camera.position.set(p.x + 2.1, p.y + 2.1, Math.max(fromServiceLift ? -26.8 : -23.4, p.z - 3));
      camera.lookAt(0, cinematicTime < 5.5 ? p.y + 0.8 : 5.8, cinematicTime < 5.5 ? p.z + 2.5 : 0);
    } else if (cinematic === 'lift') {
      camera.position.set(2.6, platform.position.y + 3, 0.5); camera.lookAt(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    } else {
      const t = Math.min(1, cinematicTime / 3.5);
      const focus = cinematicTime > 15 ? new THREE.Vector3(0, 0.8, -2.8) : revealOrigin.clone().add(new THREE.Vector3(0, 1.1, 0));
      camera.position.copy(clearCamera(focus, revealOrigin.clone().add(new THREE.Vector3(5 - t * 2.4, 3 - t * 1.2, -7 + t * 2.5))));
      camera.lookAt(focus);
    }
    return true;
  }
  function updateCinematic(dt: number) {
    if (!cinematic) return;
    cinematicTime += dt;
    // Round 1 change 2: phase-4 intro beats (taunt, dim, beacons, warning, player line, then drift-up).
    if (cinematic === 'gravityIntro') {
      const R = PHASE4_RULES;
      if (!introDimStarted && cinematicTime >= R.introDimAt) { introDimStarted = true; startLightDim(R.introDimFraction, R.introDimSeconds); }
      if (!introBeaconsOn && cinematicTime >= R.introBeaconsAt) introBeaconsOn = true;
      if (warningEl) {
        const inWarning = cinematicTime >= R.introWarningAt && cinematicTime < R.introWarningAt + R.introWarningSeconds;
        warningEl.classList.toggle('hidden', !inWarning);
        if (inWarning) warningEl.style.opacity = (Math.sin(cinematicTime * 12) * 0.5 + 0.5) < 0.5 ? '0.25' : '1';
      }
      if (subtitles) {
        if (cinematicTime >= R.introTauntAt && cinematicTime < R.introTauntAt + R.introTauntSeconds) {
          subtitles.classList.remove('hidden');
          subtitles.textContent = "Hahaha. You thought destroying my weapons meant you'd won? I control this entire ship, including its gravity.";
        } else if (cinematicTime >= R.introPlayerLineAt && cinematicTime < R.introPlayerLineAt + R.introPlayerLineSeconds) {
          subtitles.classList.remove('hidden');
          subtitles.textContent = 'Oh no... oh no, no, no.';
        } else subtitles.classList.add('hidden');
      }
      if (cinematicTime >= R.introEndAt) finishPhase4Intro();
      return;
    }
    if (cinematic === 'versus') {
      versus?.update(cinematicTime);
      if (cinematicTime >= BOSS_VERSUS_SECONDS) {
        versus?.dispose(); versus = null;
        cinematic = null; release(); boss.start();
      }
      return;
    }
    if (cinematic === 'awakening') {
      subtitles?.classList.add('hidden');
      if (awakeningReleaseClock >= 0) {
        awakeningReleaseClock = Math.max(0, awakeningReleaseClock - dt);
        if (!awakeningReleaseClock) { cinematic = null; returnToBattle(); }
      }
      return;
    }
    if (cinematic === 'reveal' && !boy && !boyError) cinematicTime = Math.min(cinematicTime, 2.5);
    if (cinematic === 'entry') {
      // Walk across the landing, descend the physical stair run, then face the robot.
      const distance = Math.min(1, cinematicTime / 5.8);
      const z = THREE.MathUtils.lerp(entryStart.z, -10.2, distance);
      const y = z < -21 ? 3 : z < -12 ? (-12 - z) / 3 : 0;
      player.setPosition(THREE.MathUtils.lerp(entryStart.x, 0, Math.min(1, distance * 5)), y + player.radius, z); player.setRotation(Math.PI);
      if (subtitles) { subtitles.classList.remove('hidden'); subtitles.textContent = cinematicTime < 5 ? 'LOWER LOADING BAY / 13' : 'That machine is guarding the bay.'; }
      if (cinematicTime >= BOSS_ENTRY_SECONDS) beginVersus();
    } else if (cinematic === 'lift') {
      platform.position.y = -12 * THREE.MathUtils.smoothstep(cinematicTime, 0, 4.5);
      liftBody.position.y = platform.position.y - 0.2; liftBody.aabbNeedsUpdate = true;
      consoleBody.position.y = platform.position.y + 0.65; consoleBody.aabbNeedsUpdate = true;
      player.setPosition(liftPassenger.x, liftPassenger.y + platform.position.y, liftPassenger.z);
      if (subtitles) { subtitles.classList.remove('hidden'); subtitles.textContent = 'DESCENDING / HANGAR 14'; }
      if (cinematicTime >= 4.8 && !liftTransferred) { liftTransferred = true; onDescend?.(player.captureTransition({ x: 0, y: platform.position.y, z: 0 })); }
    } else {
      const t = Math.min(1, cinematicTime / 3.5), dummy = new THREE.Object3D();
      cloudMaterial.opacity = 1 - t;
      particles.forEach((p, i) => { dummy.position.copy(p.start).addScaledVector(p.drift, cinematicTime); dummy.scale.setScalar(p.size * (1 - t * 0.8)); dummy.rotation.set(t * i, t * 3, t); dummy.updateMatrix(); cloud.setMatrixAt(i, dummy.matrix); });
      cloud.instanceMatrix.needsUpdate = true;
      if (boy) { boy.visible = true; boy.rotation.y = Math.PI - 0.5; boy.position.x = boyOrigin.x + revealOrigin.x + (6.7 - revealOrigin.x) * THREE.MathUtils.smoothstep(cinematicTime, 13, 17); }
      consoleRoot.position.y = -1.5 * (1 - THREE.MathUtils.smoothstep(cinematicTime, 15, 18));
      if (subtitles) {
        subtitles.classList.remove('hidden');
        subtitles.textContent = cinematicTime < 3.5 ? 'The black shell is breaking apart...'
          : cinematicTime < 8.5 ? '"Thank you for defeating that thing. I was trapped inside. You saved me."'
          : cinematicTime < 15 ? '"The AI took your friends to the nearest planet. It is experimenting on them, just like it did to me."'
          : '"Take this lift down to the hangar. Reach the ship and go after them. Use the console when you are ready."';
        if (boyError && cinematicTime < 3.5) subtitles.textContent = 'The prisoner is free. (Character model could not be loaded.)';
      }
      if (cinematicTime >= 21) {
        finishVictoryDialogue();
      }
    }
  }
  // --- Phase 4 push-off prompt + beacon helpers (additive; changes 4 and 5). ---
  function setPushSide(el: HTMLElement | null, active: boolean, letter: string, progress: number, required: number) {
    if (!el) return;
    el.classList.toggle('hidden', !active);
    if (!active) return;
    const key = el.querySelector('.p4-push-key'); if (key) key.textContent = letter;
    const count = el.querySelector('.p4-push-count'); if (count) count.textContent = `${progress}/${required}`;
    const pips = el.querySelector('.p4-push-pips');
    if (pips) {
      if (pips.childElementCount !== required) {
        pips.textContent = '';
        for (let i = 0; i < required; i++) {
          const pip = document.createElement('i');
          pip.style.cssText = 'width:9px;height:9px;border-radius:50%;border:1px solid #ff8a6a;background:#2a120c;transition:background .12s,box-shadow .12s;';
          pips.appendChild(pip);
        }
      }
      for (let i = 0; i < pips.childElementCount; i++) {
        const pip = pips.children[i] as HTMLElement, on = i < progress;
        pip.style.background = on ? '#ff5a3c' : '#2a120c';
        pip.style.boxShadow = on ? '0 0 8px rgba(255,90,60,.9)' : 'none';
      }
    }
  }
  function updatePushPrompt(push: { key: number; progress: number; required: number; cooldown: number } | null) {
    const k = push?.key ?? 0, progress = push?.progress ?? 0, required = push?.required ?? PHASE4_RULES.pushOffTaps;
    pushPrompt.container?.classList.toggle('hidden', k === 0);
    setPushSide(pushPrompt.left, k === -1, 'A', progress, required);
    setPushSide(pushPrompt.right, k === 1, 'D', progress, required);
    setPushSide(pushPrompt.top, k === 2, 'W', progress, required);
    setPushSide(pushPrompt.bottom, k === -2, 'S', progress, required);
  }
  function updateBeacons(active: boolean) {
    if (beaconGroup.visible !== active) {
      beaconGroup.visible = active;
      for (const light of beaconLights) light.visible = active;
    }
    if (!active) return;
    beaconTime += cinematicDelta;
    const pulse = 0.55 + 0.45 * Math.sin(beaconTime * PHASE4_RULES.beaconPulseSpeed * Math.PI * 2);
    beaconLensMaterial.emissiveIntensity = PHASE4_RULES.beaconEmissiveIntensity * pulse;
    const spinStep = cinematicDelta * PHASE4_RULES.beaconSpinSpeed * Math.PI * 2;
    for (const beacon of beacons) beacon.spin.rotation.y += spinStep;
    // Round 1 change 2c: sweep each spotlight's target around the room so the red beam travels
    // across the walls, floor and ceiling. Two lights, offset by half a turn for full coverage.
    for (let i = 0; i < beaconLights.length; i++) {
      const light = beaconLights[i], target = beaconLightTargets[i];
      light.intensity = PHASE4_RULES.beaconSpotIntensity * pulse;
      const a = beaconTime * PHASE4_RULES.beaconSweepSpeed * Math.PI * 2 + i * Math.PI;
      target.position.set(
        Math.sin(a) * PHASE4_RULES.beaconSweepRadiusX,
        PHASE4_RULES.beaconSweepHeightCenter + Math.sin(a * PHASE4_RULES.beaconSweepTilt + i * 1.7) * PHASE4_RULES.beaconSweepHeightAmp,
        Math.cos(a) * PHASE4_RULES.beaconSweepRadiusZ);
    }
  }
  // --- Phase 4 intro sequence (round 1 change 2). Plays once on first entry; skipped on retries and
  // on the return to zero-G after an exposed window. Uses the cinematic camera + #boss-subtitles. ---
  let introDimStarted = false, introBeaconsOn = false, prevZeroGActive = false;
  function startPhase4Intro() {
    if (disposed || cleared) { boss.beginZeroGBarrage(); return; }
    captureShot();
    cinematic = 'gravityIntro'; cinematicTime = 0;
    introDimStarted = false; introBeaconsOn = false;
    freeze();
  }
  function finishPhase4Intro() {
    if (cinematic !== 'gravityIntro') return;   // idempotent: natural end and hold-to-skip both call this
    cinematic = null;
    introSkipButton.classList.add('hidden');
    if (warningEl) warningEl.classList.add('hidden');
    // Guarantee the end-state even on an early skip: beacons on, bay lights dimmed.
    introBeaconsOn = true;
    if (roomLightScale > PHASE4_RULES.introDimFraction + 1e-3) startLightDim(PHASE4_RULES.introDimFraction, PHASE4_RULES.introDimSeconds);
    boss.beginZeroGBarrage();   // opens the barrage: enables zero-G, the player drifts up (beat f)
    returnToBattle();           // releases the player and blends the camera back over 0.3 s
    // A short control hint once floating begins (returnToBattle hid the subtitles just above).
    if (subtitles) { subtitles.textContent = 'GRAVITY OFFLINE — TAP A / D / W / S TO DODGE THE NETS'; subtitles.classList.remove('hidden'); phaseNoticeTime = 3.2; }
  }
  function updateHud() {
    const s = boss.getStatus();
    hud?.classList.toggle('hidden', cleared || cinematic === 'versus' || cinematic === 'reveal' || cinematic === 'lift');
    if (cleared && !cinematic && prompt) { prompt.textContent = inputHint('Press E to interact — descend to hangar'); prompt.classList.toggle('hidden', !nearConsole()); }
    if (fill) fill.style.width = `${s.health / s.maxHealth * 100}%`;
    if (label) label.textContent = `BAY WARDEN / ${s.health} / ${s.maxHealth}`;
    // Phase 4 HUD (additive): thruster heat bar + entanglement pips, inline-styled (no CSS edits).
    const phase4Visible = s.zeroGActive && !cleared && !cinematic;
    if (phase4Hud) phase4Hud.classList.toggle('hidden', !phase4Visible);
    if (phase4Visible) {
      if (phase4Heat) {
        phase4Heat.style.width = `${Math.round(THREE.MathUtils.clamp(s.thrusterHeat, 0, 1) * 100)}%`;
        phase4Heat.style.background = s.overheated ? '#ff4d3d' : '#7fe3ff';
      }
      if (phase4Pips) {
        if (phase4Pips.childElementCount !== s.maxEntanglement) {
          phase4Pips.textContent = '';
          for (let i = 0; i < s.maxEntanglement; i++) {
            const pip = document.createElement('span');
            pip.style.cssText = 'display:inline-block;width:13px;height:13px;margin:0 3px;border-radius:50%;border:1px solid #9fe8ff;background:#0d2a38;transition:opacity .15s,background .15s;';
            phase4Pips.appendChild(pip);
          }
        }
        for (let i = 0; i < phase4Pips.childElementCount; i++) {
          const pip = phase4Pips.children[i] as HTMLElement;
          const wrapped = i < s.entanglement;
          pip.style.opacity = wrapped ? '1' : '0.3';
          pip.style.background = wrapped ? '#ff5a3c' : '#0d2a38';
        }
      }
      // Wall push-off prompt (change 4): matching key on the barrier side with tap progress.
      updatePushPrompt(player.getZeroGPushOff());
    } else updatePushPrompt(null);
    // Red alarm beacons (change 5 + round 1 change 2c): on during the intro and while gravity is off.
    updateBeacons((s.zeroGActive || (cinematic === 'gravityIntro' && introBeaconsOn)) && !cleared);
    // Round 1 change 2b: dim the bay lights while gravity is off; restore smoothly when it returns.
    if (prevZeroGActive && !s.zeroGActive) startLightDim(1, PHASE4_RULES.lightRestoreSeconds);
    else if (!prevZeroGActive && s.zeroGActive) startLightDim(PHASE4_RULES.introDimFraction, PHASE4_RULES.introDimSeconds);
    prevZeroGActive = s.zeroGActive;
    // Round 2a: drive the decoys, ring markers, detection boxes and the hold-E deploy prompt.
    updatePhase4Decoys(s, phase4Visible, frameDt);
  }
  const assetsReady = Promise.all([ready, boss.ready]).then(async () => {
    if (disposed || !renderer || defeated) return;
    try { await boss.prepareRendering(renderer, camera); }
    catch (error) { if (!disposed) console.warn('[Scene 13] Render warmup deferred to first use:', error); }
  });
  updateHud(); applyCinematicCamera();
  return { roomId: 'scene13', scene, camera, physics, physicsWorld, player, door, boss, pillars, ready: assetsReady, cutsceneManager: null,
    getSceneId: () => 'scene13', getMapLayout: () => BAY_THIRTEEN_MAP,
    elevator: { platform, body: liftBody, console: consoleRoot, consoleBody },
    getLiftStatus: () => ({ ready: cleared && !cinematic, canInteract: nearConsole(), descending: cinematic === 'lift', transferred: liftTransferred }),
    setBackTrigger: door.setTrigger, getDamageTargets: () => cleared || droneCutscene ? [] : boss.getDamageTargets(), setGogglesActive: boss.setGogglesActive,
    getParryableBolts: () => cleared || droneCutscene ? [] : boss.getParryableBolts(),
    getHealthPackCollected: () => healthPackCollected,
    getArenaSupplies: () => arenaSupplies.map(supply => ({
      id: supply.id, kind: supply.kind, collected: supply.collected, position: supply.pickup.root.position.clone(),
    })),
    hasBossVictory: () => bossVictory,
    isCinematic: () => cinematic !== null || droneCutscene !== null,
    getCinematicDelta: () => cinematicDelta,
    getCinematicState: () => cinematic || droneCutscene ? { ...player.getState(), isMoving: cinematic === 'entry' && cinematicTime < 5.8, isOnGround: true, jumping: false, climbing: false, velocityY: 0 } : null,
    getCinematicPose: () => {
      if (!droneCutscene) return undefined;
      const clock = droneCutscene.clock;
      if (droneCutscene.stage === 'incoming') {
        return { clip: 'Roll' as const, time: 0.08 + clock * BOSS_RULES.droneExplosionSlow,
          duration: 0.95, loop: false, lean: droneCutscene.side * 0.22 };
      }
      return { clip: 'Hit_Chest' as const, time: droneCutscene.poseTime, loop: false,
        bodyPitch: -Math.sin(Math.min(1, clock / 1.3) * Math.PI) * 0.18,
        lean: -droneCutscene.side * Math.sin(Math.min(1, clock / 1.3) * Math.PI) * 0.12 };
    },
    applyCinematicCamera,
    updateCinematicCharacter(character: { model: THREE.Object3D } | null) {
      if (cinematic === 'versus' && character) versus?.capture(character.model, [boss.root]);
    },
    renderCinematicOverlay(renderer: THREE.WebGLRenderer) { if (cinematic === 'versus') versus?.render(renderer); },
    applyEntryCamera() {
      if (returnClock <= 0) return;
      const blend = THREE.MathUtils.smootherstep(1 - returnClock / 0.3, 0, 1);
      camera.position.lerpVectors(returnPosition, camera.position.clone(), blend);
      camera.position.copy(clearCamera(new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z), camera.position));
      camera.quaternion.slerpQuaternions(returnRotation, camera.quaternion.clone(), blend);
      camera.fov = THREE.MathUtils.lerp(returnFov, shotFov, blend); camera.updateProjectionMatrix();
    },
    // Near-miss camera punch (additive): FOV kick + small lateral offset, never touching the quaternion.
    applyNearMissCamera() {
      // Zero-G camera sway (change 2): a few degrees of roll following lateral drift velocity. This runs
      // after player.updateCamera zeroed rotation.z, so it is additive and never touches mouse-look yaw/pitch.
      const swayActive = player.isZeroGMode() && !cleared && returnClock <= 0 && !cinematic && !droneCutscene;
      if (swayActive) {
        camera.updateMatrixWorld();
        swayRight.setFromMatrixColumn(camera.matrixWorld, 0);
        const v = player.body.velocity;
        const lat = v.x * swayRight.x + v.y * swayRight.y + v.z * swayRight.z;
        const target = THREE.MathUtils.clamp(-lat / PHASE4_RULES.maxZeroGSpeed, -1, 1) * PHASE4_RULES.cameraSwayRoll;
        cameraSwayCurrent = THREE.MathUtils.damp(cameraSwayCurrent, target, PHASE4_RULES.cameraSwayResponse, frameDt);
      } else {
        cameraSwayCurrent = THREE.MathUtils.damp(cameraSwayCurrent, 0, PHASE4_RULES.cameraSwayResponse, frameDt);
      }
      if (Math.abs(cameraSwayCurrent) > 1e-5) camera.rotation.z += cameraSwayCurrent;
      if (nearMissClock <= 0) {
        if (nearMissApplied) { camera.fov = nearMissBaseFov; camera.updateProjectionMatrix(); nearMissApplied = false; }
        return;
      }
      if (returnClock > 0) return;
      if (!nearMissApplied) { nearMissBaseFov = camera.fov; nearMissApplied = true; }
      const p = THREE.MathUtils.clamp(1 - nearMissClock / NEAR_MISS.duration, 0, 1);
      const punch = Math.sin(p * Math.PI);
      camera.fov = nearMissBaseFov + NEAR_MISS.fovPunch * punch; camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      nearMissRight.setFromMatrixColumn(camera.matrixWorld, 0);
      camera.position.addScaledVector(nearMissRight, NEAR_MISS.offset * punch * nearMissSide);
    },
    onPlayerDeath() {
      if (!onRespawn) return false;
      if (!deathClock) { deathClock = 2.5; boss.dispose(); freeze(); phase4Hud?.classList.add('hidden'); detectionHud.hide(); deployHold.reset(); deployPrompt?.classList.add('hidden'); for (const ringMark of decoyRings) ringMark.mesh.visible = false; if (cinematic === 'gravityIntro') cinematic = null; startLightDim(1, PHASE4_RULES.lightRestoreSeconds); if (warningEl) warningEl.classList.add('hidden'); introSkipButton.classList.add('hidden'); if (subtitles) { subtitles.textContent = 'WARDEN CHECKPOINT / RESTARTING'; subtitles.classList.remove('hidden'); } }
      return true;
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
      frameDt = dt;   // consumed by the zero-G camera sway in applyNearMissCamera (change 2)
      updateLightDim(dt);   // phase-4 bay-light dim/restore tween (round 1 change 2b); runs even during the death clock
      skipButton.classList.toggle('hidden', cinematic !== 'reveal' || cinematicTime < 3.5);
      skipHold.update(dt); if (disposed) return;
      introSkipButton.classList.toggle('hidden', cinematic !== 'gravityIntro' || cinematicTime < PHASE4_RULES.introSkipAvailableAt);
      introSkip.update(dt); if (disposed) return;
      if (deathClock > 0) { deathClock = Math.max(0, deathClock - dt); if (!deathClock) onRespawn?.(); return; }
      if (returnClock > 0) {
        returnClock = Math.max(0, returnClock - dt);
        if (!returnClock) { camera.fov = shotFov; camera.updateProjectionMatrix(); }
      }
      updateCinematic(dt); if (disposed) return;
      if (droneCutscene) {
        droneCutscene.clock += dt; droneCutscene.time += dt;
        if (droneCutscene.stage === 'incoming') {
          const t = THREE.MathUtils.smootherstep(droneCutscene.clock, 0.12, BOSS_RULES.droneDetonateAt / BOSS_RULES.droneExplosionSlow);
          const position = droneCutscene.start.clone().lerp(droneCutscene.dodge, t);
          player.setPosition(position.x, position.y, position.z);
          const direction = droneCutscene.dodge.clone().sub(droneCutscene.start);
          if (direction.lengthSq() > 0.001) player.setRotation(Math.atan2(-direction.x, -direction.z), 0);
        } else {
          const position = droneCutscene.impactStart.clone().lerp(droneCutscene.recoil, THREE.MathUtils.smootherstep(droneCutscene.clock, 0, 0.9));
          player.setPosition(position.x, position.y, position.z);
        }
        subtitles?.classList.add('hidden');
      }
      const droneScale = !droneCutscene ? 1 : droneCutscene.stage === 'incoming' ? BOSS_RULES.droneExplosionSlow
        : THREE.MathUtils.lerp(0.25, 1, THREE.MathUtils.smoothstep(droneCutscene.clock, 0.65, 1.3));
      // Near-miss slow-mo (additive): dip the scene timeScale, never below the drone cutscene scale.
      let nearMissScale = 1;
      if (nearMissClock > 0) {
        nearMissClock = Math.max(0, nearMissClock - dt);
        const p = THREE.MathUtils.clamp(1 - nearMissClock / NEAR_MISS.duration, 0, 1);
        nearMissScale = 1 - (1 - NEAR_MISS.slowMo) * Math.sin(p * Math.PI);
      }
      const timeScale = Math.min(droneScale, nearMissScale);
      cinematicDelta = dt * timeScale;
      if (droneCutscene?.stage === 'impact') droneCutscene.poseTime += cinematicDelta;
      physics.step(cinematicDelta, player, thirdPerson);
      boss.updateVisuals(cinematicDelta);
      if (boy?.visible) boyMixer?.update(cinematicDelta);
      for (const piece of rubble) {
        if (piece.life <= 0) continue;
        piece.life -= cinematicDelta; piece.velocity.y -= cinematicDelta * 9.82; piece.mesh.position.addScaledVector(piece.velocity, cinematicDelta);
        if (piece.mesh.position.y < 0.12) { piece.mesh.position.y = 0.12; piece.velocity.set(0, 0, 0); }
        else { piece.mesh.rotation.x += cinematicDelta * 2; piece.mesh.rotation.z += cinematicDelta; }
        if (piece.life <= 0) piece.mesh.visible = false;
      }
      door.update(dt, player, cleared && !cinematic && door.near(player));
      if (disposed) return;

      arenaSupplyTime += cinematicDelta;
      if (supplyNoticeTime > 0) {
        supplyNoticeTime = Math.max(0, supplyNoticeTime - cinematicDelta);
        if (!supplyNoticeTime && !cinematic && !droneCutscene) subtitles?.classList.add('hidden');
      }
      if (phaseNoticeTime > 0) {
        phaseNoticeTime = Math.max(0, phaseNoticeTime - cinematicDelta);
        if (!phaseNoticeTime && !supplyNoticeTime && !cinematic && !droneCutscene) subtitles?.classList.add('hidden');
      }
      for (const supply of arenaSupplies) {
        const { pickup } = supply;
        pickup.root.visible = !supply.collected && !cleared && cinematic !== 'reveal' && cinematic !== 'lift';
        if (!pickup.root.visible) continue;
        pickup.update(arenaSupplyTime);
        if (cinematic || droneCutscene || !player.isEnabled() || player.getHealth() <= 0) continue;
        const p = player.body.position, target = pickup.root.position;
        if (Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) >= 1.1) continue;
        const previous = supply.kind === 'shield' ? player.getShield() : player.getHealth();
        const recovered = supply.kind === 'shield' ? player.addShield(50) : player.heal(100);
        if (!recovered) continue;
        supply.collected = true; pickup.root.visible = false; supplyNoticeTime = 1.8;
        if (subtitles) {
          const current = supply.kind === 'shield' ? player.getShield() : player.getHealth();
          subtitles.textContent = `${supply.kind === 'shield' ? 'SHIELD' : 'HEALTH'} +${current - previous}`;
          subtitles.classList.remove('hidden');
        }
      }

      // Health pack animation and collection
      if (healthPackGroup.visible && !healthPackCollected) {
        healthPack.update(performance.now() * 0.001);

        const dx = player.body.position.x - healthPackPos.x;
        const dz = player.body.position.z - healthPackPos.z;
        if (Math.hypot(dx, dz) < 1.2 && player.isEnabled() && !cinematic) {
          healthPackCollected = true;
          player.heal(100);
          healthPackGroup.visible = false;
          onHealthPackCollected?.();
        }
      }

      // The main view update applies the cinematic camera once, after character animation.
      updateHud();
    },
    dispose() {
      if (disposed) return; disposed = true;
      skipHold.dispose(); skipButton.remove();
      introSkip.dispose(); introSkipButton.remove();   // round 1 change 2: the phase-4 intro skip control
      window.removeEventListener('keydown', onKey); prompt?.classList.add('hidden');
      hud?.classList.add('hidden'); subtitles?.classList.add('hidden'); phase4Hud?.classList.add('hidden');
      updatePushPrompt(null);   // hide the shared push-off prompt elements (change 4)
      if (warningEl) warningEl.classList.add('hidden');   // round 1 change 2d
      applyRoomLightScale(1); lightTween = null;   // restore bay lights to their stored base (round 1 change 2b)
      // Dispose the phase-4 beacons (change 5): built once here, so release them here.
      beaconGroup.removeFromParent();
      for (const light of beaconLights) { light.removeFromParent(); light.dispose(); }
      for (const target of beaconLightTargets) target.removeFromParent();
      beaconBaseGeometry.dispose(); beaconHousingGeometry.dispose(); beaconLensGeometry.dispose();
      beaconHousingMaterial.dispose(); beaconLensMaterial.dispose();
      versus?.dispose(); versus = null;
      // Round 2a: release the decoy pool, detection HUD, deploy control and the ring markers.
      deployHold.dispose(); detectionHud.dispose(); decoys.dispose();
      deployPrompt?.classList.add('hidden');
      for (const ringMark of decoyRings) { ringMark.mesh.removeFromParent(); ringMark.material.dispose(); }
      decoyRings.length = 0; ringGeometry.dispose();
      boss.dispose(); boyMixer?.stopAllAction(); if (boy) boyMixer?.uncacheRoot(boy);
      player.dispose(); physics.dispose(); disposeRoom(scene); rubbleGeometry.dispose();
    },
  };
}
