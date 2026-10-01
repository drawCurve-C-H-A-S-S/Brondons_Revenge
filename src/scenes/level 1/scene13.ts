import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import boyUrl from '../../assets/models/boy.glb';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, createSlidingPortal, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { BOSS_RULES, createLoadingBayBoss, type BossPillar } from '../../scripts/mechBaymaxBoss.js';
import { AudioManager } from '../../helpers/audio/AudioManager.js';
import bgmUrl from '../../assets/bgm/DonRevBGM1.m4a?url';

export const BOSS_ENTRY_SECONDS = 7;

/** Loading bay below passage 12, with a stair entrance and a stationary aerial boss. */
export function createScene({ entryState, defeated = false, checkpoint = false, onDefeated, onDescend, onRespawn, loadBoy = () => new GLTFLoader().loadAsync(boyUrl), loadDrone, loadBoss, renderer, healthPackCollected: initialHealthPackCollected = false, onHealthPackCollected }: {
  entryState?: PlayerTransitionState;
  defeated?: boolean;
  checkpoint?: boolean;
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
  const door = createSlidingPortal(scene, physics, { x: 0, y: 3, z: -24, yaw: 0 }, 40, 11, '12 / TRANSFER PASSAGE');
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
  const rubble: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const rubbleGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const x of [-13, 13]) for (const z of [-15, 15]) {
    const pillar = box([3, 14, 3], [x, 7, z], wall, false); pillar.name = 'ArenaCoverPillar'; pillars.push(pillar);
    const parts = [pillar, box([3.5, 0.35, 3.5], [x, 0.175, z], steel, false)];
    const bodies = [physics.addBox({ x: 3, y: 14, z: 3 }, { x, y: 7, z }), physics.addBox({ x: 3.5, y: 0.35, z: 3.5 }, { x, y: 0.175, z })];
    for (const y of [1.2, 5.5, 10]) parts.push(box([3.06, 0.16, 3.06], [x, y, z], y === 1.2 ? amber : dark, false));
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

  // --- Health Pack (appears after boss defeat) ---
  const healthPackPos = new THREE.Vector3(0, 1.2, -2.8);
  const healthPackGroup = new THREE.Group();
  healthPackGroup.position.copy(healthPackPos);
  healthPackGroup.visible = false;
  scene.add(healthPackGroup);

  const healthPackMat = new THREE.MeshStandardMaterial({
    color: 0x2ecc40,
    emissive: 0x7cf25a,
    emissiveIntensity: 1.5,
    metalness: 0.4,
    roughness: 0.3
  });
  const healthPackBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), healthPackMat);
  healthPackGroup.add(healthPackBox);

  // Red cross on top
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 });
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.12), crossMat);
  crossH.position.y = 0.21;
  healthPackGroup.add(crossH);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.35), crossMat);
  crossV.position.y = 0.21;
  healthPackGroup.add(crossV);

  const healthPackLight = new THREE.PointLight(0x7cf25a, 2, 4);
  healthPackLight.position.set(0, 0.3, 0);
  healthPackGroup.add(healthPackLight);
  let healthPackCollected = initialHealthPackCollected;
  if (healthPackCollected) {
    healthPackGroup.visible = false;
  }
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 150);
  const audioManager = new AudioManager({ camera, getFile: (path: string) => path === 'bgm1' ? { content: bgmUrl } : null });
  audioManager.setBgm({ path: 'bgm1', loop: true, volume: 0.5, autoplay: true });
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 3.3, z: -22.8 } }); player.enable();
  if (entryState) player.restoreTransition(entryState, door.frame); else player.setRotation(Math.PI);
  if (checkpoint) player.setPosition(0, 0.3, defeated ? -6.2 : -10.2);
  door.openImmediately();
  let deathClock = 0;
  let disposed = false, cleared = defeated, cinematic: 'entry' | 'awakening' | 'reveal' | 'lift' | null = defeated || checkpoint ? null : 'entry', cinematicTime = 0;
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
  const status = document.getElementById('loading-bay-status');
  status?.classList.add('hidden');
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 1, depthWrite: false });
  const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cloud = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, 260); cloud.name = 'BossBlackParticles'; cloud.visible = false; cloud.frustumCulled = false; scene.add(cloud);
  const particles = Array.from({ length: 260 }, () => ({ start: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 7, (Math.random() - 0.5) * 5), drift: new THREE.Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2), size: 0.2 + Math.random() * 0.5 }));
  function freeze() { player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties(); player.body.velocity.set(0, 0, 0); }
  function release() { player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.enable(); }
  if (cinematic) freeze();
  const boss = createLoadingBayBoss(scene, physicsWorld, player, () => {
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
  });
  if (defeated) boss.dispose();
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
    if (!cinematic) return false;
    if (cinematic === 'entry') {
      const p = player.body.position;
      camera.position.set(p.x + 2.1, p.y + 2.1, Math.max(-23.4, p.z - 3));
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
      if (cinematicTime >= BOSS_ENTRY_SECONDS) { cinematic = null; release(); door.setLocked(true); boss.start(); subtitles?.classList.add('hidden'); }
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
        cloud.visible = false; cinematic = null; cleared = true; door.setLocked(false); consoleBody.collisionResponse = true; release(); subtitles?.classList.add('hidden'); onDefeated?.();
        if (!healthPackCollected) {
          healthPackGroup.visible = true;
        }
      }
    }
  }
  function updateHud() {
    const s = boss.getStatus();
    hud?.classList.toggle('hidden', cleared || cinematic === 'reveal' || cinematic === 'lift');
    if (cleared && !cinematic && prompt) { prompt.textContent = 'Press E to interact — descend to hangar'; prompt.classList.toggle('hidden', !nearConsole()); }
    if (fill) fill.style.width = `${s.health / s.maxHealth * 100}%`;
    if (label) label.textContent = `BAY WARDEN / ${s.health} / ${s.maxHealth}`;
  }
  const assetsReady = Promise.all([ready, boss.ready]).then(async () => {
    if (disposed || !renderer || defeated) return;
    try { await boss.prepareRendering(renderer, camera); }
    catch (error) { if (!disposed) console.warn('[Scene 13] Render warmup deferred to first use:', error); }
  });
  updateHud(); applyCinematicCamera();
  return { roomId: 'scene13', scene, camera, physics, physicsWorld, player, door, boss, pillars, ready: assetsReady, cutsceneManager: null,
    elevator: { platform, body: liftBody, console: consoleRoot, consoleBody },
    getLiftStatus: () => ({ ready: cleared && !cinematic, canInteract: nearConsole(), descending: cinematic === 'lift', transferred: liftTransferred }),
    setBackTrigger: door.setTrigger, getDamageTargets: () => cleared || droneCutscene ? [] : boss.getDamageTargets(), setGogglesActive: boss.setGogglesActive,
    getParryableBolts: () => cleared || droneCutscene ? [] : boss.getParryableBolts(),
    getHealthPackCollected: () => healthPackCollected,
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
    applyEntryCamera() {
      if (returnClock <= 0) return;
      const blend = THREE.MathUtils.smootherstep(1 - returnClock / 0.3, 0, 1);
      camera.position.lerpVectors(returnPosition, camera.position.clone(), blend);
      camera.position.copy(clearCamera(new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z), camera.position));
      camera.quaternion.slerpQuaternions(returnRotation, camera.quaternion.clone(), blend);
      camera.fov = THREE.MathUtils.lerp(returnFov, shotFov, blend); camera.updateProjectionMatrix();
    },
    onPlayerDeath() {
      if (!onRespawn) return false;
      if (!deathClock) { deathClock = 2.5; boss.dispose(); freeze(); if (subtitles) { subtitles.textContent = 'WARDEN CHECKPOINT / RESTARTING'; subtitles.classList.remove('hidden'); } }
      return true;
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
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
      const timeScale = !droneCutscene ? 1 : droneCutscene.stage === 'incoming' ? BOSS_RULES.droneExplosionSlow
        : THREE.MathUtils.lerp(0.25, 1, THREE.MathUtils.smoothstep(droneCutscene.clock, 0.65, 1.3));
      cinematicDelta = dt * timeScale;
      if (droneCutscene?.stage === 'impact') droneCutscene.poseTime += cinematicDelta;
      physics.step(cinematicDelta, player, thirdPerson);
      boss.updateVisuals(cinematicDelta);
      if (boy?.visible) boyMixer?.update(cinematicDelta);
      audioManager.update();
      for (const piece of rubble) {
        if (piece.life <= 0) continue;
        piece.life -= cinematicDelta; piece.velocity.y -= cinematicDelta * 9.82; piece.mesh.position.addScaledVector(piece.velocity, cinematicDelta);
        if (piece.mesh.position.y < 0.12) { piece.mesh.position.y = 0.12; piece.velocity.set(0, 0, 0); }
        else { piece.mesh.rotation.x += cinematicDelta * 2; piece.mesh.rotation.z += cinematicDelta; }
        if (piece.life <= 0) piece.mesh.visible = false;
      }
      door.update(dt, player, cleared && !cinematic && door.near(player));
      if (disposed) return;

      // Health pack animation and collection
      if (healthPackGroup.visible && !healthPackCollected) {
        const t = performance.now() * 0.001;
        healthPackGroup.rotation.y = t * 1.2;
        healthPackGroup.position.y = healthPackPos.y + Math.sin(t * 2) * 0.1;
        healthPackMat.emissiveIntensity = 1.3 + Math.sin(t * 3) * 0.3;

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
      window.removeEventListener('keydown', onKey); prompt?.classList.add('hidden');
      hud?.classList.add('hidden'); subtitles?.classList.add('hidden');
      boss.dispose(); boyMixer?.stopAllAction(); if (boy) boyMixer?.uncacheRoot(boy);
      player.dispose(); physics.dispose(); disposeRoom(scene); rubbleGeometry.dispose();
      healthPackMat.dispose(); crossMat.dispose();
      audioManager.dispose();
    },
  };
}
