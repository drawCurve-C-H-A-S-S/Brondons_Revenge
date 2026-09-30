import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { registerPhysicsActor } from '../helpers/physics/scenePhysics.js';
import { PLAYER_MAX_HEALTH, type Player } from './player.js';
import type { DamageTarget } from './pistol.js';
import { loadToolModel } from '../core/loader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import baybossUrl from '../assets/models/bayboss.glb?url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fireVertexShader from '../shaders/fireExplosion.vert.glsl?raw';
import fireFragmentShader from '../shaders/fireExplosion.frag.glsl?raw';

export const BOSS_RULES = Object.freeze({
  health: 980, headDamage: 35, headCooldown: 0.18, exposedSeconds: 10, pillarStunSeconds: 4,
  phaseTwoThreshold: 0.75, phaseThreeThreshold: 0.5,
  laserSpeed: 18, laserDamage: 8, chargeSeconds: 0.4, shotInterval: 0.9, volleyGap: 0.14,
  rushInterval: 9, windupSeconds: 1.8, rushSpeed: 27,
  phaseThreeTargetHits: 2,
  transformSeconds: 2.4, gravityWindup: 2.4, gravityDuration: 18,
  phaseTwoReturn: 5.5,
  droneCount: 4, droneSize: 0.55, droneDamage: 42,
  droneExplosionSlow: 0.25, droneDetonateAt: 0.32, droneExplosionDuration: 1.05,
  droneLaunchSeconds: 0.85, droneOrbitRadius: 3.4, droneOrbitHeight: 0.8,
  droneOrbitSpeed: 0.25, droneOrbitHoldBase: 3.5, droneOrbitHoldStep: 1.2,
  droneWindupSeconds: 0.35, droneChargeSpeed: 11,
  droneApproachTrigger: 3.4, droneContactTrigger: 1.05,
  droneShotInterval: 2.4, droneShotStagger: 0.4, droneShotFirstDelay: 1.4,
  droneLaserSpeed: 15, droneLaserDamage: 5,
});
export type BossPhase = 'dormant' | 'flying' | 'windup' | 'rushing' | 'recovering' | 'falling' | 'exposed' | 'rising'
  | 'phaseThreeAwakening' | 'gravityWindup' | 'gravity' | 'droneExplosion' | 'phaseThreeTargets'
  | 'phaseThreeRecovery' | 'defeated';
export interface BossPillar { position: THREE.Vector3; intact: () => boolean; shatter: () => void; }
interface BossOptions {
  loadDrone?: () => ReturnType<typeof loadToolModel>;
  loadBoss?: () => ReturnType<GLTFLoader['loadAsync']>;
  onPhaseThree?: () => void;
  onPhaseThreeEnd?: () => void;
  onDroneApproach?: (drone: THREE.Object3D) => void;
  onDroneExplosion?: (drone: THREE.Object3D, position: THREE.Vector3) => void;
  onDroneExplosionEnd?: () => void;
}
type DroneState = 'launch' | 'orbit' | 'windup' | 'charge';
type Drone = {
  root: THREE.Group; mixer: THREE.AnimationMixer; life: number; active: boolean; exploded: boolean;
  state: DroneState; stateTime: number; index: number; launchFrom: THREE.Vector3; orbitAngle: number; orbitDir: 1 | -1;
  chargeDirection: THREE.Vector3; laserCooldown: number; body: CANNON.Body;
  emissiveRest: Array<{ material: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }>;
};
type AttackPattern = 'single' | 'twin' | 'spread' | 'burst';

const BOSS_SCALE = 1.35;
const TARGET_ORBIT_RADIUS = 4.8;
const TARGET_ORBIT_HEIGHT = 5.2;
const TARGET_ORBIT_SPEED = 0.25;

/** Scene-owned boss using bayboss.glb with procedural bone posing, black shader,
 *  floating orbiting targets, and shoulder-cannon attacks. */
export function createLoadingBayBoss(scene: THREE.Scene, world: CANNON.World, player: Player, onDefeated: () => void, pillars: BossPillar[] = [], options: BossOptions = {}) {
  const root = new THREE.Group(); root.name = 'LoadingBayBoss'; scene.add(root);

  // --- Black shader material for the mech with subtle emissive glow. ---
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x1a1a2e, emissiveIntensity: 0.3, metalness: 0.75, roughness: 0.3 });
  const visorGreen = new THREE.MeshStandardMaterial({ color: 0x1de072, emissive: 0x18e068, emissiveIntensity: 2.4, metalness: 0.55, roughness: 0.2 });
  const visorRed = new THREE.MeshStandardMaterial({ color: 0xff2618, emissive: 0xff0a06, emissiveIntensity: 3.2, metalness: 0.5, roughness: 0.2 });
  const heartCore = new THREE.MeshStandardMaterial({ color: 0xff2540, emissive: 0xff1428, emissiveIntensity: 1.6, metalness: 0.35, roughness: 0.28 });
  const targetIdle = new THREE.MeshStandardMaterial({ color: 0xe6ecda, emissive: 0x394a3c, emissiveIntensity: 0.35 });
  const targetGoggle = new THREE.MeshStandardMaterial({ color: 0xff2828, emissive: 0xff1515, emissiveIntensity: 0.85 });
  const targetPhaseThree = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xff5322, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.35 });
  const yellowScan = new THREE.MeshStandardMaterial({ color: 0xffd126, emissive: 0xffb300, emissiveIntensity: 0.9 });
  const targetCrossMat = new THREE.MeshBasicMaterial({ color: 0x59ff79 });
  const phaseThreeShellMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x8c130f, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
  const auraBlue = new THREE.MeshBasicMaterial({ color: 0x65dfff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const auraRed = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  // --- Aura rings (kept for cross-scene test compatibility). ---
  const auraRoot = new THREE.Group(); auraRoot.name = 'BossEnergyAura'; root.add(auraRoot);
  const auraRings = [0, 1, 2].map(index => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5 + index * 0.75, 0.045, 8, 64), auraBlue);
    ring.rotation.set(index * 0.82, index * 0.47, index * 0.35); ring.position.y = 4.4; auraRoot.add(ring); return ring;
  });
  const auraLight = new THREE.PointLight(0x52dfff, 7, 13, 2); auraLight.position.set(0, 5.2, 0); root.add(auraLight);
  const eyeLight = new THREE.PointLight(0xff1810, 0, 9, 2); eyeLight.position.set(0, 7.86, 1.1); root.add(eyeLight);
  const helmetLight = new THREE.PointLight(0x2af08a, 4, 7, 2); helmetLight.position.set(0, 7.86, 1.15); root.add(helmetLight);

  // --- Shared geometry for bolts, debris, targets. ---
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(0.5, 24, 18);
  const shardMaterial = new THREE.MeshStandardMaterial({ color: 0x718c80, roughness: 0.6 });

  // --- Model + bone references (populated after GLB loads). ---
  let modelRoot: THREE.Group | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  const bones = new Map<string, THREE.Bone>();
  const restPoses = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  let skeleton: THREE.Skeleton | null = null;
  let modelLoaded = false;

  // Head hitbox: invisible sphere parented to the head bone.
  const headHitbox = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  headHitbox.name = 'BossHead'; headHitbox.userData.breakableWeapon = 'crowbar';
  root.add(headHitbox);

  // Body hitbox: large invisible box covering the entire model when fallen.
  const bodyHitbox = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 4), new THREE.MeshBasicMaterial({ visible: false }));
  bodyHitbox.name = 'BossBody'; bodyHitbox.position.set(0, 3, 0);
  root.add(bodyHitbox);

  // --- Floating orbiting targets. ---
  let phaseThree = false, health = BOSS_RULES.health as number, round = 1, remaining = 0;
  let phase: BossPhase = 'dormant';
  let phaseTime = 0, elapsed = 0, shotClock = 0, headCooldown = 0, scanning = false, disposed = false;
  let transformProgress = 0, targetsPhaseThreeMode = false;
  const healthPhase = () => health <= BOSS_RULES.health * BOSS_RULES.phaseThreeThreshold ? 3
    : health <= BOSS_RULES.health * BOSS_RULES.phaseTwoThreshold ? 2 : 1;
  let lastPhaseThreeState = false;
  let volleyQueue = 0, volleyClock = 0, volleyPattern: AttackPattern = 'single', volleyMuzzle = 0;
  const bolts: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; damage: number }> = [];
  const droneBoltMaterial = new THREE.MeshBasicMaterial({ color: 0xff9424 });
  const fragments: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];

  function burst(position: THREE.Vector3) {
    for (let i = 0; i < 14; i++) {
      const shardMesh = new THREE.Mesh(boxGeometry, shardMaterial); shardMesh.name = 'BreakableDebris'; shardMesh.scale.setScalar(0.12 + Math.random() * 0.12);
      shardMesh.position.copy(position); scene.add(shardMesh);
      fragments.push({ mesh: shardMesh, life: 2, velocity: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4) });
    }
  }

  // Create 4 orbiting targets.
  const targetMeshes: THREE.Mesh[] = [];
  const targetAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const targets = targetAngles.map((startAngle, i) => {
    const mesh = new THREE.Mesh(boxGeometry, targetIdle);
    mesh.name = `BossTarget-${i}`; mesh.scale.set(0.9, 0.9, 0.18);
    mesh.userData.breakableWeapon = 'pistol';
    const cross = new THREE.Mesh(boxGeometry, targetCrossMat); cross.scale.set(0.16, 0.65, 0.2); cross.position.z = 0.55; mesh.add(cross);
    root.add(mesh); targetMeshes.push(mesh);
    let hits = 1;
    const target: DamageTarget & { mesh: THREE.Mesh; hits: () => number; reset: (mode: 'phase1' | 'phase3') => void } = {
      root: mesh,
      damage(amount: number, weapon?: string) {
        const validPhase = ['flying', 'windup', 'rushing', 'recovering', 'gravity'].includes(phase);
        if (disposed || !validPhase || !player.isEnabled() || weapon !== 'pistol' || hits <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
        hits--; if (targetsPhaseThreeMode) mesh.material = targetPhaseThree;
        cross.visible = hits > 0 && !targetsPhaseThreeMode;
        if (!hits) {
          const pos = mesh.getWorldPosition(new THREE.Vector3());
          burst(pos); mesh.visible = false;
          checkArmorCleared();
        }
        return true;
      },
      mesh, hits: () => hits,
      reset(mode: 'phase1' | 'phase3' = 'phase1') {
        targetsPhaseThreeMode = mode === 'phase3';
        hits = healthPhase() === 1 ? 1 : 2;
        mesh.visible = true; mesh.material = mode === 'phase3' ? targetPhaseThree : (scanning ? targetGoggle : targetIdle);
        cross.visible = mode !== 'phase3';
      },
    };
    return target;
  });

  function damageBody(amount: number, weapon?: string) {
    if (disposed || phase !== 'exposed' || !player.isEnabled() || headCooldown > 0
      || !Number.isFinite(amount) || amount <= 0 || (weapon !== 'crowbar' && weapon !== 'pistol' && weapon !== 'lightsaber')) return false;
    const previousPhase = healthPhase();
    health = Math.max(0, health - amount); headCooldown = BOSS_RULES.headCooldown;
    burst(getHeadWorldPosition());
    if (!health) finishBoss();
    else if (healthPhase() === 3 && !phaseThree) enterPhaseThree();
    else if (previousPhase === 1 && healthPhase() === 2) { phase = 'rising'; phaseTime = 0; remaining = 0; }
    return true;
  }
  const headTarget: DamageTarget = { root: headHitbox, damage: damageBody };
  const bodyTarget: DamageTarget = { root: bodyHitbox, damage: damageBody };

  function checkArmorCleared() {
    if (['flying', 'windup', 'rushing', 'recovering', 'gravity'].includes(phase)
      && targets.every(target => target.hits() === 0) && drones.every(drone => !drone.active)) beginFall(false);
  }
  function enterPhaseThree() {
    phaseThree = true; phase = 'phaseThreeAwakening'; phaseTime = 0;
    rushClock = 0; pillarStun = false; remaining = 0; clearBolts();
    targets.forEach(target => target.reset('phase3'));
    options.onPhaseThree?.();
  }
  function clearBolts() { for (const bolt of bolts) bolt.mesh.removeFromParent(); bolts.length = 0; charging = false; volleyQueue = 0; }
  function removeDrones() {
    for (const drone of drones) {
      if (drone.body.world === world) world.removeBody(drone.body);
      drone.body.velocity.setZero(); drone.body.force.setZero();
      drone.root.visible = false; drone.active = false; drone.exploded = false;
    }
  }
  function disposeDronePool() {
    removeDrones();
    const materials = new Set<THREE.Material>(), skeletons = new Set<THREE.Skeleton>();
    for (const drone of drones) {
      drone.mixer.stopAllAction(); drone.mixer.uncacheRoot(drone.mixer.getRoot());
      drone.root.traverse(node => {
        if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
        if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      });
      drone.root.removeFromParent();
    }
    skeletons.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
    drones.length = 0;
  }
  function finishBoss() {
    if (phase === 'droneExplosion') options.onDroneExplosionEnd?.();
    phase = 'defeated'; root.visible = false; clearBolts(); removeDrones();
    blast.visible = false; blastLight.intensity = 0;
    for (const { body } of colliders) if (body.world === world) world.removeBody(body);
    onDefeated();
  }

  // --- Explosion rig (unchanged). ---
  const blast = new THREE.Group(); blast.name = 'EyeDroneExplosion'; blast.visible = false; scene.add(blast);
  const fireUniforms = {
    uTime: { value: 0 }, uProgress: { value: 0 }, uIntensity: { value: 1 }, uCameraLocal: { value: new THREE.Vector3() },
    uColorCore: { value: new THREE.Color(0xfff2b0) }, uColorMid: { value: new THREE.Color(0xff8a1f) },
    uColorEdge: { value: new THREE.Color(0xc41608) }, uColorSmoke: { value: new THREE.Color(0x1a1613) },
  };
  const fireMaterial = new THREE.ShaderMaterial({
    name: 'DroneFireExplosion', uniforms: fireUniforms, vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  });
  const fireBall = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), fireMaterial); fireBall.frustumCulled = false; blast.add(fireBall);
  fireBall.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(fireUniforms.uCameraLocal.value);
    fireBall.worldToLocal(fireUniforms.uCameraLocal.value);
  };
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), flashMaterial); blast.add(flash);
  const shockwaveMaterial = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48), shockwaveMaterial); blast.add(shockwave);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2622, transparent: true, opacity: 0, depthWrite: false });
  const smokePuffs = [0, 1, 2, 3, 4].map(() => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), smokeMaterial.clone()); blast.add(mesh); return mesh; });
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = Array.from({ length: 12 }, () => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), sparkMaterial.clone()); blast.add(mesh); return mesh; });
  const sparkVelocities = sparks.map((_, index) => {
    const angle = index / sparks.length * Math.PI * 2, tilt = (Math.random() - 0.5) * 0.9;
    return new THREE.Vector3(Math.cos(angle) * 2.4, 1.1 + Math.abs(tilt) * 1.4, Math.sin(angle) * 2.4);
  });
  const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.55, roughness: 0.5 });
  const debris = Array.from({ length: 6 }, () => { const mesh = new THREE.Mesh(boxGeometry, debrisMaterial); mesh.scale.setScalar(0.14 + Math.random() * 0.14); blast.add(mesh); return mesh; });
  const debrisVelocities = debris.map(() => new THREE.Vector3((Math.random() - 0.5) * 3.6, 1.8 + Math.random() * 2.4, (Math.random() - 0.5) * 3.6));
  // Keep the light count stable: revealing the blast must not recompile every lit material.
  const blastLight = new THREE.PointLight(0xff8a3c, 0, 12); scene.add(blastLight);

  // --- Drones. ---
  const drones: Drone[] = [];
  let droneTemplate: THREE.Group | null = null, droneLoadError = false, droneExplosionClock = 0;
  let droneClips: THREE.AnimationClip[] = [], droneDetonated = false;
  const detonationAim = new THREE.Vector3();
  let droneOrbitCentre = new THREE.Vector3(0, 5.3, 0);

  function disposeTemplate(template: THREE.Group) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    template.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      if (!(node instanceof THREE.Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
  }

  // Fit solid boxes to the rig's actual skin vertices once, then follow the animated bones.
  const colliders: Array<{ node: THREE.Object3D; center: THREE.Vector3; body: CANNON.Body }> = [];
  const bossBodies = new Set<CANNON.Body>();
  const colliderPosition = new THREE.Vector3(), colliderRotation = new THREE.Quaternion();
  const colliderTranslation = new THREE.Vector3(), colliderScale = new THREE.Vector3();
  const cinematicBoundsPoint = new THREE.Vector3();
  function buildColliders(model: THREE.Group) {
    model.updateWorldMatrix(true, true);
    const boxes = new Map<THREE.Object3D, THREE.Box3>();
    const inverse = new Map<THREE.Object3D, THREE.Matrix4>();
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const positions = node.geometry.getAttribute('position');
      const indices = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight');
      for (let i = 0; i < positions.count; i++) {
        let owner: THREE.Object3D = node;
        if (node instanceof THREE.SkinnedMesh && indices && weights) {
          let channel = 0;
          for (let c = 1; c < 4; c++) if (weights.getComponent(i, c) > weights.getComponent(i, channel)) channel = c;
          owner = node.skeleton.bones[indices.getComponent(i, channel)] ?? node;
          while (owner.parent instanceof THREE.Bone && !/bujur|dada|pundak|lengan|paha|kaki|kepala/i.test(owner.name)) owner = owner.parent;
        }
        if (!boxes.has(owner)) { boxes.set(owner, new THREE.Box3()); inverse.set(owner, owner.matrixWorld.clone().invert()); }
        node.getVertexPosition(i, colliderPosition).applyMatrix4(node.matrixWorld).applyMatrix4(inverse.get(owner)!);
        boxes.get(owner)!.expandByPoint(colliderPosition);
      }
      node.frustumCulled = false;
      if (node instanceof THREE.SkinnedMesh) { node.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100); node.boundingBox = new THREE.Box3(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100)); }
    });
    for (const [node, bounds] of boxes) {
      const size = bounds.getSize(new THREE.Vector3()).multiply(node.getWorldScale(new THREE.Vector3()));
      const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(Math.max(0.08, size.x / 2), Math.max(0.08, size.y / 2), Math.max(0.08, size.z / 2))) });
      colliders.push({ node, center: bounds.getCenter(new THREE.Vector3()), body });
      bossBodies.add(body); world.addBody(body);
    }
    syncColliders();
  }
  function syncColliders() {
    root.updateMatrixWorld(true);
    for (const { node, center, body } of colliders) {
      colliderPosition.copy(center).applyMatrix4(node.matrixWorld);
      // The hierarchy was updated above; avoid walking every bone's ancestors again.
      node.matrixWorld.decompose(colliderTranslation, colliderRotation, colliderScale);
      body.position.set(colliderPosition.x, colliderPosition.y, colliderPosition.z);
      body.quaternion.set(colliderRotation.x, colliderRotation.y, colliderRotation.z, colliderRotation.w);
      body.previousPosition.copy(body.position); body.interpolatedPosition.copy(body.position);
      body.aabbNeedsUpdate = true; body.updateAABB();
    }
  }
  // Swept expanded static bounds prevent scripted motion from tunneling through cover.
  const sweepDirection = new THREE.Vector3(), sweepPoint = new THREE.Vector3();
  const sweepRay = new THREE.Ray(), sweepBox = new THREE.Box3();
  const dronePadding = new THREE.Vector3().setScalar(BOSS_RULES.droneSize * 0.55);
  function sweepRoom(from: THREE.Vector3, to: THREE.Vector3, padding: THREE.Vector3) {
    const direction = sweepDirection.copy(to).sub(from), length = direction.length();
    let distance = length;
    let obstacle: CANNON.Body | null = null;
    if (length < 1e-7) return { position: to.clone(), obstacle };
    direction.divideScalar(length);
    const ray = sweepRay.set(from, direction), point = sweepPoint;
    for (const body of world.bodies) {
      if (body.type !== CANNON.Body.STATIC || !body.collisionResponse) continue;
      if (body.aabbNeedsUpdate) body.updateAABB();
      if (body.aabb.upperBound.y <= from.y - padding.y + 0.06 && to.y >= from.y - 0.001) continue;
      const box = sweepBox;
      box.min.set(body.aabb.lowerBound.x, body.aabb.lowerBound.y, body.aabb.lowerBound.z);
      box.max.set(body.aabb.upperBound.x, body.aabb.upperBound.y, body.aabb.upperBound.z);
      box.expandByVector(padding);
      if (box.containsPoint(from)) {
        // Permit motion away from a resting contact, never further into it.
        if (to.distanceToSquared(box.getCenter(point)) >= from.distanceToSquared(point)) continue;
        distance = 0; obstacle = body; break;
      }
      if (ray.intersectBox(box, point)) {
        const hit = from.distanceTo(point);
        if (hit <= distance) { distance = Math.max(0, hit - 0.03); obstacle = body; }
      }
    }
    return { position: from.clone().addScaledVector(direction, distance), obstacle };
  }

  // Load the bayboss.glb model.
  const modelReady = Promise.resolve().then(options.loadBoss ?? (() => new GLTFLoader().loadAsync(baybossUrl))).then(gltf => {
      if (disposed) { disposeTemplate(gltf.scene); return; }
      modelRoot = gltf.scene;
      modelRoot.scale.setScalar(BOSS_SCALE);
      // Centre the model so its base sits at y=0.
      modelRoot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(modelRoot);
      modelRoot.scale.multiplyScalar(8.2 / Math.max(0.01, bounds.getSize(new THREE.Vector3()).y));
      modelRoot.updateMatrixWorld(true); bounds.setFromObject(modelRoot);
      const center = bounds.getCenter(new THREE.Vector3());
      modelRoot.position.set(-center.x, -bounds.min.y, -center.z);
      // Apply black shader to model meshes only (not floor).
      modelRoot.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true; node.receiveShadow = false;
        // Clone material per mesh to prevent cross-contamination.
        const mat = blackMat.clone();
        node.material = mat;
      });
      root.add(modelRoot);
      // Build bone map.
      modelRoot.traverse(node => {
        if ((node as THREE.Bone).isBone) bones.set(node.name, node as THREE.Bone);
      });
      // Find skeleton from the first skinned mesh.
      modelRoot.traverse(node => {
        if (node instanceof THREE.SkinnedMesh && node.skeleton && !skeleton) {
          skeleton = node.skeleton;
          mixer = new THREE.AnimationMixer(node);
        }
      });
      // Store rest poses.
      for (const [name, bone] of bones) {
        restPoses.set(name, { pos: bone.position.clone(), quat: bone.quaternion.clone() });
      }
      bodyTarget.root = modelRoot;
      buildColliders(modelRoot);
      modelLoaded = true; pose();
  }).catch(error => {
    console.error('[Boss] Failed to load bayboss.glb:', error);
    modelLoaded = false;
  });

  const droneReady = Promise.resolve().then(options.loadDrone ?? (() => loadToolModel('Enemy_EyeDrone'))).then(asset => {
    if (disposed) { disposeTemplate(asset.scene); return; }
    droneTemplate = asset.scene; droneClips = asset.animations;
    asset.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(asset.scene), size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error('EyeDrone model has invalid bounds');
    const scale = BOSS_RULES.droneSize / Math.max(size.x, size.y, size.z, 0.001), centre = bounds.getCenter(new THREE.Vector3());
    asset.scene.scale.setScalar(scale); asset.scene.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
    asset.scene.updateMatrixWorld(true); droneTemplate = asset.scene;
  }).catch(error => {
    if (disposed) return;
    droneLoadError = true; console.error('[Scene 13] EyeDrone could not load:', error);
    if (droneTemplate) disposeTemplate(droneTemplate);
    droneTemplate = new THREE.Group();
    const shellMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), new THREE.MeshStandardMaterial({ color: 0x687780, metalness: 0.7, roughness: 0.3 }));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2410 }));
    eye.position.z = 0.24; droneTemplate.add(shellMesh, eye); droneClips = [];
  }).then(() => { if (!disposed && droneTemplate) prepareDronePool(); });

  // --- Shoulder cannon helpers. ---
  const _shoulderPos = new THREE.Vector3();
  function getShoulderWorld(side: 'l' | 'r'): THREE.Vector3 {
    const bone = bones.get(side === 'l' ? 'pundak.l' : 'pundak.r');
    if (bone) {
      bone.getWorldPosition(_shoulderPos);
      // The round shoulder emitters sit above the joint and ahead of the shell.
      return _shoulderPos.clone().add(new THREE.Vector3(0, 0.65, 0.85).applyQuaternion(root.quaternion));
    }
    return root.localToWorld(new THREE.Vector3(side === 'l' ? -2.5 : 2.5, 6.5, 0));
  }
  function getHeadWorldPosition(): THREE.Vector3 {
    const boneL = bones.get('kepala.l');
    const boneR = bones.get('kepala.r');
    if (boneL && boneR) {
      const lPos = new THREE.Vector3(); const rPos = new THREE.Vector3();
      boneL.getWorldPosition(lPos); boneR.getWorldPosition(rPos);
      return lPos.lerp(rPos, 0.5).add(new THREE.Vector3(0, 0.5, 0));
    }
    return root.localToWorld(new THREE.Vector3(0, 7.8, 0));
  }

  const chargedAim = new THREE.Vector3();
  let charging = false, rushClock = 0, rushHit = false, pillarStun = false;
  const rushDirection = new THREE.Vector3(), rushAim = new THREE.Vector3();
  const impactPosition = new THREE.Vector3(), headStart = new THREE.Vector3();
  const headLanding = new THREE.Vector3(0, 1.05, 0);

  function droneOrbitAnchor(drone: Drone) {
    return new THREE.Vector3(
      THREE.MathUtils.clamp(droneOrbitCentre.x + Math.cos(drone.orbitAngle) * BOSS_RULES.droneOrbitRadius, -18.6, 18.6),
      droneOrbitCentre.y + BOSS_RULES.droneOrbitHeight + Math.sin(elapsed * 1.4 + drone.index) * 0.18,
      THREE.MathUtils.clamp(droneOrbitCentre.z + Math.sin(drone.orbitAngle) * BOSS_RULES.droneOrbitRadius, -22.6, 22.6),
    );
  }
  function prepareDronePool() {
    // Allocate rigs, animation bindings, materials, and bodies during asset loading, not the cutscene.
    for (let index = 0; index < BOSS_RULES.droneCount; index++) {
      const model = skeletonClone(droneTemplate!), droneRoot = new THREE.Group();
      const materials = new Map<THREE.Material, THREE.Material>();
      const emissiveRest: Drone['emissiveRest'] = [];
      droneRoot.name = `BossEyeDrone-${index}`; droneRoot.add(model); droneRoot.visible = false;
      droneRoot.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true; node.receiveShadow = true;
        const cloneMaterial = (source: THREE.Material) => {
          let material = materials.get(source);
          if (!material) {
            material = source.clone(); materials.set(source, material);
            if (material instanceof THREE.MeshStandardMaterial) emissiveRest.push({
              material, color: material.emissive.clone(), intensity: material.emissiveIntensity,
            });
          }
          return material;
        };
        node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
      });
      const mixerInst = new THREE.AnimationMixer(model);
      if (droneClips[0]) mixerInst.clipAction(droneClips[0]).play();
      mixerInst.update(0); droneRoot.updateMatrixWorld(true);
      droneRoot.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
        if (node instanceof THREE.SkinnedMesh) {
          if (!node.boundingSphere) node.computeBoundingSphere();
          if (!node.skeleton.boneTexture) node.skeleton.computeBoneTexture();
        }
      });
      const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(BOSS_RULES.droneSize * 0.55), linearDamping: 0, fixedRotation: true });
      scene.add(droneRoot);
      drones.push({ root: droneRoot, mixer: mixerInst, body, emissiveRest, life: Infinity, active: false, exploded: false,
        state: 'launch', stateTime: 0, index, launchFrom: new THREE.Vector3(), orbitAngle: 0,
        orbitDir: 1, chargeDirection: new THREE.Vector3(), laserCooldown: 0 });
    }
  }
  function spawnDroneWave() {
    if (!droneTemplate) return;
    removeDrones();
    root.updateMatrixWorld(true);
    droneOrbitCentre.copy(root.position); droneOrbitCentre.y = 5.3;
    for (const drone of drones) {
      const side = drone.index % 2 ? 'r' as const : 'l' as const;
      drone.launchFrom.copy(getShoulderWorld(side)); drone.launchFrom.y += drone.index < 2 ? 0 : 0.8;
      drone.root.position.copy(drone.launchFrom);
      drone.active = true; drone.root.visible = true; drone.state = 'launch'; drone.stateTime = 0;
      drone.orbitAngle = drone.index * Math.PI / 2 + Math.PI / 4 + elapsed * TARGET_ORBIT_SPEED;
      drone.laserCooldown = BOSS_RULES.droneShotFirstDelay + drone.index * BOSS_RULES.droneShotStagger;
      drone.chargeDirection.set(0, 0, 0);
      for (const rest of drone.emissiveRest) {
        rest.material.emissive.copy(rest.color); rest.material.emissiveIntensity = rest.intensity;
      }
      drone.mixer.setTime(0);
      drone.root.lookAt(droneOrbitAnchor(drone));
      const body = drone.body;
      body.position.set(drone.launchFrom.x, drone.launchFrom.y, drone.launchFrom.z);
      body.previousPosition.copy(body.position); body.interpolatedPosition.copy(body.position);
      body.quaternion.set(0, 0, 0, 1); body.previousQuaternion.copy(body.quaternion); body.interpolatedQuaternion.copy(body.quaternion);
      body.angularVelocity.setZero(); body.torque.setZero(); body.aabbNeedsUpdate = true;
      body.wakeUp(); world.addBody(body);
    }
  }


  function droneTargets(): DamageTarget[] {
    return drones.filter(drone => drone.active).map(drone => ({ root: drone.root, body: drone.body, damage(amount: number, weapon?: string) {
      if (disposed || phase !== 'gravity' || !player.isEnabled() || weapon !== 'pistol' || !Number.isFinite(amount) || amount <= 0 || !drone.active) return false;
      drone.active = false; drone.root.visible = false;
      if (drone.body.world === world) world.removeBody(drone.body);
      const mesh = drone.root.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
      if (mesh) burst(mesh.getWorldPosition(new THREE.Vector3()));
      checkArmorCleared();
      return true;
    } }));
  }
  function beginDroneExplosion(drone: Drone) {
    if (phase !== 'gravity' || !drone.active) return;
    drone.active = false; drone.exploded = true;
    phase = 'droneExplosion'; phaseTime = 0; droneExplosionClock = 0; droneDetonated = false;
    const playerHead = new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z);
    detonationAim.copy(playerHead);
    drone.launchFrom.copy(drone.root.position);
    if (drone.body.world === world) world.removeBody(drone.body);
    for (const other of drones) other.body.velocity.setZero();
    const towardPlayer = playerHead.clone().sub(drone.root.position).normalize();
    shockwave.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), towardPlayer.lengthSq() > 0 ? towardPlayer : new THREE.Vector3(0, 0, 1));
    drone.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.setHex(0xff2414); material.emissiveIntensity = 2.5;
      }
    });
    options.onDroneApproach?.(drone.root);
  }
  function updateDroneExplosionVisuals(progress: number, dt: number) {
    fireUniforms.uTime.value = elapsed;
    fireUniforms.uProgress.value = progress;
    const fireScale = 0.5 + THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(progress / 0.7, 0, 1), 0, 1) * 3.0;
    fireBall.scale.setScalar(fireScale);
    fireUniforms.uIntensity.value = Math.max(0, 1 - THREE.MathUtils.smoothstep(progress, 0.7, 1)) * 1.35;
    flashMaterial.opacity = Math.max(0, 1 - progress * 9);
    flash.scale.setScalar(0.35 + progress * 2.4);
    const shockProgress = THREE.MathUtils.clamp(progress / 0.7, 0, 1);
    shockwave.scale.setScalar(0.4 + THREE.MathUtils.smootherstep(shockProgress, 0, 1) * 6.0);
    shockwaveMaterial.opacity = Math.max(0, 0.85 - shockProgress * 0.95);
    smokePuffs.forEach((mesh, index) => {
      const local = THREE.MathUtils.clamp((progress - index * 0.055) / (1 - index * 0.055), 0, 1);
      mesh.visible = local > 0;
      mesh.scale.setScalar(0.5 + local * (2.2 + index * 0.35));
      mesh.position.set(Math.sin(index * 2.4) * local * 0.9, local * 1.7 + index * 0.06, Math.cos(index * 2.4) * local * 0.9);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.6, local * 1.4) * Math.max(0, 1 - local);
    });
    sparks.forEach((mesh, index) => {
      const local = THREE.MathUtils.clamp(progress / 0.45, 0, 1);
      const velocity = sparkVelocities[index];
      mesh.position.set(velocity.x * local * 0.8, velocity.y * local - 0.5 * local * local * 4.5, velocity.z * local * 0.8);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - local * 1.6);
    });
    debris.forEach((mesh, index) => {
      const local = THREE.MathUtils.clamp(progress / 0.75, 0, 1);
      const velocity = debrisVelocities[index];
      mesh.position.set(velocity.x * local, velocity.y * local - 0.5 * local * local * 3, velocity.z * local);
      mesh.rotation.x += dt * 4 * (index % 2 ? 1 : -1);
      mesh.rotation.z += dt * 3;
      mesh.visible = progress < 0.95;
    });
    blastLight.color.setHex(progress < 0.3 ? 0xffe4a8 : 0xff6a24);
    blastLight.intensity = Math.max(0, 1 - progress * 1.2) * 55;
  }
  function updateDrones(dt: number) {
    for (const drone of drones) {
      if (!drone.active && !drone.exploded) continue;
      // Hover motors cancel gravity without disabling room collisions.
      drone.body.force.set(-world.gravity.x * drone.body.mass, -world.gravity.y * drone.body.mass, -world.gravity.z * drone.body.mass);
      if (phase === 'droneExplosion') drone.body.velocity.setZero();
    }
    if (phase === 'gravity') {
      droneOrbitCentre.copy(root.position); droneOrbitCentre.y += 5.3;
      let chargingDrone = drones.find(drone => drone.active && (drone.state === 'windup' || drone.state === 'charge'));
      for (const drone of drones) {
        if (!drone.active) continue;
        drone.stateTime += dt;
        const from = new THREE.Vector3().copy(drone.body.position);
        drone.root.position.copy(from);
        const facePlayer = new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z);
        drone.orbitAngle = drone.index * Math.PI / 2 + Math.PI / 4 + elapsed * TARGET_ORBIT_SPEED;
        const anchor = droneOrbitAnchor(drone);
        const desired = from.clone();
        if (drone.state === 'launch') {
          desired.lerp(anchor, 1 - Math.exp(-dt * 4));
          if (drone.stateTime >= BOSS_RULES.droneLaunchSeconds) { drone.state = 'orbit'; drone.stateTime = 0; }
        } else if (drone.state === 'charge') {
          desired.addScaledVector(drone.chargeDirection, BOSS_RULES.droneChargeSpeed * dt);
        } else {
          desired.lerp(anchor, 1 - Math.exp(-dt * 4));
          if (drone.state === 'orbit') {
            drone.laserCooldown -= dt;
            if (drone.laserCooldown <= 0) {
              fireDroneBolt(from, facePlayer); drone.laserCooldown = BOSS_RULES.droneShotInterval;
            }
            if (!chargingDrone && drone.stateTime >= BOSS_RULES.droneOrbitHoldBase + drone.index * BOSS_RULES.droneOrbitHoldStep) {
              drone.state = 'windup'; drone.stateTime = 0; chargingDrone = drone;
            }
          } else if (drone.stateTime >= BOSS_RULES.droneWindupSeconds) {
            drone.state = 'charge'; drone.stateTime = 0;
            drone.chargeDirection.copy(facePlayer).sub(from).normalize();
          }
        }
        const movement = sweepRoom(from, desired, dronePadding);
        const velocity = movement.position.clone().sub(from).divideScalar(Math.max(dt, 1e-6));
        drone.body.velocity.set(velocity.x, velocity.y, velocity.z);
        drone.root.lookAt(drone.state === 'charge' ? from.clone().add(drone.chargeDirection) : facePlayer);
        if (drone.state === 'charge') {
          const closest = new THREE.Line3(from, movement.position).closestPointToPoint(facePlayer, true, new THREE.Vector3());
          let occluded = false;
          world.raycastAll(new CANNON.Vec3(closest.x, closest.y, closest.z), new CANNON.Vec3(facePlayer.x, facePlayer.y, facePlayer.z),
            { checkCollisionResponse: true }, hit => { if (hit.body?.type === CANNON.Body.STATIC) occluded = true; });
          if (!occluded && closest.distanceTo(facePlayer) < BOSS_RULES.droneApproachTrigger) { beginDroneExplosion(drone); break; }
          if (movement.obstacle || drone.stateTime > 2.2) { drone.state = 'orbit'; drone.stateTime = 0; drone.body.velocity.setZero(); }
        }
      }
      checkArmorCleared();
    } else if (phase === 'droneExplosion') {
      droneExplosionClock += dt;
      const drone = drones.find(item => item.exploded);
      if (!drone) return;
      if (!droneDetonated) {
        const t = THREE.MathUtils.clamp(droneExplosionClock / BOSS_RULES.droneDetonateAt, 0, 1);
        const destination = drone.launchFrom.clone().lerp(detonationAim, 0.78);
        drone.root.position.copy(sweepRoom(drone.launchFrom, drone.launchFrom.clone().lerp(destination, t), new THREE.Vector3().setScalar(0.3)).position);
      }
      if (!droneDetonated && droneExplosionClock >= BOSS_RULES.droneDetonateAt) {
        droneDetonated = true;
        blast.position.copy(drone.root.position); blastLight.position.copy(blast.position);
        blast.visible = true; drone.root.visible = false;
        burst(drone.root.position);
        options.onDroneExplosion?.(drone.root, drone.root.position.clone());
        player.takeDamage(PLAYER_MAX_HEALTH * BOSS_RULES.droneDamage / 100, true);
      }
      if (droneDetonated) {
        const progress = THREE.MathUtils.clamp((droneExplosionClock - BOSS_RULES.droneDetonateAt) / (BOSS_RULES.droneExplosionDuration - BOSS_RULES.droneDetonateAt), 0, 1);
        updateDroneExplosionVisuals(progress, dt);
      }
      if (droneExplosionClock >= BOSS_RULES.droneExplosionDuration) {
        drone.exploded = false; drone.root.visible = false;
        blast.visible = false; blastLight.intensity = 0; phase = 'gravity'; phaseTime = 0;
        options.onDroneExplosionEnd?.(); checkArmorCleared();
      }
    }
  }
  function beginFall(hitPillar: boolean) {
    headStart.copy(getHeadWorldPosition()); impactPosition.copy(root.position); impactPosition.y = 0;
    pillarStun = hitPillar; phase = 'falling'; phaseTime = 0; rushClock = 0; clearBolts();
    root.rotation.x = 0; root.rotation.z = 0;
  }
  function stepRush(dt: number) {
    const bounds = new THREE.Box3();
    for (const { body } of colliders) {
      bounds.expandByPoint(new THREE.Vector3().copy(body.aabb.lowerBound));
      bounds.expandByPoint(new THREE.Vector3().copy(body.aabb.upperBound));
    }
    if (bounds.isEmpty()) bounds.set(root.position.clone().add(new THREE.Vector3(-2, 0, -2)), root.position.clone().add(new THREE.Vector3(2, 8, 2)));
    const center = bounds.getCenter(new THREE.Vector3()), padding = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const motion = rushDirection.clone().multiplyScalar(BOSS_RULES.rushSpeed * dt);
    const movement = sweepRoom(center, center.clone().add(motion), padding);
    // Sweep the player's body against the same occupied volume, stopping at the first wall/pillar.
    const playerPoint = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.65, player.body.position.z);
    const hitBox = new THREE.Box3(playerPoint.clone(), playerPoint.clone()).expandByVector(padding.clone().add(new THREE.Vector3(player.radius, 0.8, player.radius)));
    const ray = new THREE.Ray(center, rushDirection), impact = new THREE.Vector3();
    const contact = hitBox.containsPoint(center) || !!ray.intersectBox(hitBox, impact) && center.distanceTo(impact) <= center.distanceTo(movement.position);
    if (!rushHit && contact) { rushHit = true; player.takeDamage(PLAYER_MAX_HEALTH * 0.5, true); }
    root.position.add(movement.position.sub(center));
    if (movement.obstacle) {
      const obstacle = movement.obstacle;
      const pillar = pillars.find(item => item.intact() && Math.hypot(item.position.x - obstacle.position.x, item.position.z - obstacle.position.z) < 1.8);
      if (pillar) { pillar.shatter(); beginFall(true); return; }
    }
    if (movement.obstacle || phaseTime >= 1.6) {
      impactPosition.copy(root.position); phase = 'recovering'; phaseTime = 0;
    }
  }

  // --- Procedural bone posing. ---
  const _xAxis = new THREE.Vector3(1, 0, 0), _yAxis = new THREE.Vector3(0, 1, 0), _zAxis = new THREE.Vector3(0, 0, 1);
  function resetBones() {
    for (const [name, bone] of bones) {
      const rest = restPoses.get(name);
      if (rest) { bone.position.copy(rest.pos); bone.quaternion.copy(rest.quat); }
    }
  }
  const poseRotation = new THREE.Quaternion();
  function setBoneRotation(name: string, axis: THREE.Vector3, angle: number) {
    const bone = bones.get(name);
    if (!bone) return;
    bone.quaternion.multiply(poseRotation.setFromAxisAngle(axis, angle));
  }
  function pose() {
    if (!modelLoaded) return;
    resetBones();
    const isExposed = phase === 'exposed';
    const drop = phase === 'falling' ? THREE.MathUtils.smootherstep(phaseTime, 0, 0.85) : isExposed ? 1
      : phase === 'phaseThreeAwakening' ? 1 - THREE.MathUtils.smootherstep(phaseTime, 0, 1.25)
      : phase === 'rising' ? 1 - THREE.MathUtils.smootherstep(phaseTime, 0, 1.2) : 0;
    const transform = phase === 'phaseThreeAwakening' ? THREE.MathUtils.smootherstep(phaseTime, 0, 1.25) * 0.35
      : phase === 'gravityWindup' ? 0.35 + THREE.MathUtils.smootherstep(phaseTime, 0, BOSS_RULES.transformSeconds) * 0.65
      : phase === 'gravity' || phase === 'droneExplosion' ? 1 : 0;
    transformProgress = transform;
    const windup = phase === 'windup' ? THREE.MathUtils.smoothstep(phaseTime, 0, BOSS_RULES.windupSeconds) : 0;
    const run = phase === 'rushing' ? 1 : phase === 'recovering' ? 1 - THREE.MathUtils.smoothstep(phaseTime, 0, 0.65) : 0;
    const stride = phaseTime * 19;
    root.rotation.x = -drop * 0.16 + run * 0.14;
    root.position.y = drop > 0 ? -drop * 3.4 : run > 0 ? Math.abs(Math.sin(stride)) * 0.09
      : windup > 0 ? Math.abs(Math.sin(phaseTime * 65)) * 0.04 : 0.18 + Math.sin(elapsed * 1.6) * 0.1;
    setBoneRotation('bujur', _xAxis, -drop * 0.22 + windup * 0.28 + run * 0.32);
    setBoneRotation('dada', _xAxis, drop * 0.18 + windup * 0.12 + run * 0.12);
    setBoneRotation('dada', _yAxis, run * Math.sin(stride) * 0.1);
    for (const side of ['l', 'r'] as const) {
      const sign = side === 'l' ? -1 : 1;
      const swing = Math.sin(stride + (side === 'l' ? 0 : Math.PI));
      // Alternating planted strides and opposite arm pumps give the charge a weighted run.
      setBoneRotation(`paha.${side}`, _xAxis, -drop * 1.45 - windup * 0.45 + run * swing * 0.85);
      setBoneRotation(`paha.${side}`, _zAxis, sign * (drop * 0.22 + windup * 0.08));
      setBoneRotation(`kaki.${side}`, _xAxis, drop * 0.22 + windup * 0.75 + run * (0.18 + Math.max(0, -swing) * 1.15));
      setBoneRotation(`pundak.${side}`, _zAxis, sign * (drop * 0.5 + transform * 0.95));
      setBoneRotation(`pundak.${side}`, _xAxis, -drop * 0.2 - transform * 0.6 - run * swing * 0.62);
      setBoneRotation(`lengan.${side}`, _zAxis, sign * (drop * 0.45 + transform * 0.65));
      setBoneRotation(`lengan.${side}`, _xAxis, -windup * 0.7 - run * (0.6 + swing * 0.28));
      setBoneRotation(`kepala.${side}`, _xAxis, drop * 0.4 - run * 0.2);
      setBoneRotation(`kepala.${side}`, _zAxis, isExposed ? Math.sin(elapsed * 3) * 0.06 : 0);
      setBoneRotation(`antene.${side}`, _xAxis, Math.sin(elapsed * (isExposed ? 9 : 3)) * (isExposed ? 0.14 : 0.04));
    }
    syncColliders();
    // Keep the seated rig and charging boots above the physical deck.
    let lowest = Infinity;
    for (const { body } of colliders) lowest = Math.min(lowest, body.aabb.lowerBound.y);
    if (lowest < 0.035) { root.position.y += 0.035 - lowest; syncColliders(); }
    headHitbox.position.copy(root.worldToLocal(getHeadWorldPosition()));
    headHitbox.scale.setScalar(drop > 0 ? 1.4 : 1);

    // --- Visor and eye lighting. ---
    // Yellow visor during exposed (goggles scanning), red in phase 3, green normally.
    const isExposedPhase = isExposed || (phase === 'rising' && drop > 0.3);
    helmetLight.color.setHex(isExposedPhase ? 0xffd126 : phaseThree ? 0xff2a12 : 0x2af08a);
    helmetLight.intensity = isExposedPhase ? 8 + Math.sin(elapsed * 8) * 2 : phaseThree ? 6 + Math.sin(elapsed * 6) * 2 : 4;
    eyeLight.intensity = phaseThree && phase !== 'defeated' ? 22 + Math.sin(elapsed * 9) * 5 : 0;
    eyeLight.color.setHex(phaseThree ? 0xff251b : 0xffd126);
    if (isExposedPhase) eyeLight.intensity = 15 + Math.sin(elapsed * 7) * 4;
    auraLight.color.setHex(phaseThree ? 0xff251b : 0x52dfff);
    auraLight.intensity = phaseThree ? 18 + Math.sin(elapsed * 4) * 3 : 7;

    // Aura rings.
    auraRings.forEach((ring, index) => {
      ring.material = phaseThree ? auraRed : auraBlue;
      ring.visible = phaseThree && phase !== 'defeated';
      ring.rotation.x = index * 0.82 + elapsed * 0.96 * (index + 1) * (index % 2 ? -1 : 1);
      ring.rotation.z = index * 0.35 + elapsed * 1.44 * (index + 1);
    });

    // Phase 3 shell tint - only update when phase changes, not every frame.
    if (modelRoot && phaseThree !== lastPhaseThreeState) {
      lastPhaseThreeState = phaseThree;
      modelRoot.traverse(node => {
        if (node instanceof THREE.Mesh && node !== headHitbox && node !== bodyHitbox) {
          if (node.material instanceof THREE.MeshStandardMaterial) {
            node.material.color.copy((phaseThree ? phaseThreeShellMat : blackMat).color);
            node.material.emissive.copy((phaseThree ? phaseThreeShellMat : blackMat).emissive);
            node.material.emissiveIntensity = phaseThree ? 0.8 : 0.3;
          }
        }
      });
    }

    // Update orbiting target positions.
    for (let i = 0; i < targets.length; i++) {
      const angle = targetAngles[i] + elapsed * TARGET_ORBIT_SPEED;
      const worldPosition = new THREE.Vector3(root.position.x + Math.cos(angle) * TARGET_ORBIT_RADIUS,
        0.3 + TARGET_ORBIT_HEIGHT + Math.sin(elapsed * 1.2 + i) * 0.3,
        root.position.z + Math.sin(angle) * TARGET_ORBIT_RADIUS);
      worldPosition.x = THREE.MathUtils.clamp(worldPosition.x, -18.5, 18.5);
      worldPosition.z = THREE.MathUtils.clamp(worldPosition.z, -22.5, 22.5);
      for (const pillar of pillars) {
        if (!pillar.intact()) continue;
        const dx = worldPosition.x - pillar.position.x, dz = worldPosition.z - pillar.position.z;
        if (Math.abs(dx) < 2.05 && Math.abs(dz) < 2.05) {
          if (Math.abs(dx) > Math.abs(dz)) worldPosition.x = pillar.position.x + Math.sign(dx || 1) * 2.05;
          else worldPosition.z = pillar.position.z + Math.sign(dz || 1) * 2.05;
        }
      }
      targets[i].mesh.position.copy(root.worldToLocal(worldPosition));
      targets[i].mesh.lookAt(player.body.position.x, player.getHeadY(), player.body.position.z);
    }

  }

  // --- Phase 1 attacks. ---
  const patternWeights: Array<[AttackPattern, number]> = [['single', 3], ['twin', 4], ['spread', 3], ['burst', 2]];
  function choosePattern(): AttackPattern {
    const total = patternWeights.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = Math.random() * total;
    for (const [pattern, weight] of patternWeights) { if ((roll -= weight) <= 0) return pattern; }
    return 'single';
  }
  function fireBolt(offsetAngle: number, muzzleIndexOverride?: number) {
    const side = (muzzleIndexOverride ?? (volleyMuzzle++ % 2)) === 0 ? 'l' : 'r';
    const from = getShoulderWorld(side as 'l' | 'r');
    const direction = chargedAim.clone().sub(from).normalize();
    if (offsetAngle !== 0) direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), offsetAngle);
    const mesh = new THREE.Mesh(boxGeometry, targetCrossMat); mesh.name = 'BossLaser'; mesh.scale.set(0.12, 0.12, 1.2);
    mesh.position.copy(from); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); scene.add(mesh);
    bolts.push({ mesh, velocity: direction.multiplyScalar(BOSS_RULES.laserSpeed), life: 5, damage: BOSS_RULES.laserDamage });
  }
  function fireDroneBolt(fromPosition: THREE.Vector3, targetPosition: THREE.Vector3) {
    const from = fromPosition.clone();
    const direction = targetPosition.clone().sub(from).normalize();
    const mesh = new THREE.Mesh(boxGeometry, droneBoltMaterial); mesh.name = 'DroneLaser'; mesh.scale.set(0.09, 0.09, 0.8);
    mesh.position.copy(from); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); scene.add(mesh);
    bolts.push({ mesh, velocity: direction.multiplyScalar(BOSS_RULES.droneLaserSpeed), life: 4, damage: BOSS_RULES.droneLaserDamage });
  }
  function releaseVolley(pattern: AttackPattern) {
    volleyPattern = pattern;
    if (pattern === 'single') { fireBolt(0); volleyQueue = 0; }
    else if (pattern === 'twin') { fireBolt(0, 0); fireBolt(0, 1); volleyQueue = 0; }
    else if (pattern === 'spread') { fireBolt(-0.18, 0); fireBolt(0); fireBolt(0.18, 1); volleyQueue = 0; }
    else { fireBolt(0); volleyQueue = 2; volleyClock = BOSS_RULES.volleyGap; }
  }
  function stepBolts(dt: number) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i], from = bolt.mesh.position.clone(), to = from.clone().addScaledVector(bolt.velocity, dt);
      let distance = Infinity, hitPlayer = false;
      world.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z), { skipBackfaces: false }, hit => {
        if (!hit.body || bossBodies.has(hit.body) || drones.some(drone => drone.body === hit.body) || !hit.body.collisionResponse || hit.distance >= distance) return;
        distance = hit.distance; hitPlayer = hit.body === player.body;
      });
      bolt.life -= dt;
      if (distance !== Infinity || bolt.life <= 0) {
        if (hitPlayer) player.takeDamage(bolt.damage);
        bolt.mesh.removeFromParent(); bolts.splice(i, 1);
      } else bolt.mesh.position.copy(to);
    }
  }

  function update(dt: number) {
    if (disposed) return;
    elapsed += dt; phaseTime += dt; headCooldown = Math.max(0, headCooldown - dt);
    mixer?.update(dt);
    for (let i = fragments.length - 1; i >= 0; i--) {
      const shard = fragments[i]; shard.life -= dt; shard.velocity.y -= 9.82 * dt; shard.mesh.position.addScaledVector(shard.velocity, dt);
      if (shard.mesh.position.y < 0.1) { shard.mesh.position.y = 0.1; shard.velocity.set(0, 0, 0); }
      if (shard.life < 0.5) shard.mesh.scale.multiplyScalar(Math.exp(-7 * dt));
      if (shard.life <= 0) { shard.mesh.removeFromParent(); fragments.splice(i, 1); }
    }
    if (phase === 'defeated' || !modelLoaded) return;
    if (phase === 'droneExplosion') { updateDrones(dt); return; }
    if (player.getHealth() <= 0) { removeDrones(); clearBolts(); return; }
    if (phase === 'flying' || phase === 'dormant' || phase === 'gravityWindup' || phase === 'gravity') {
      root.rotation.y = Math.atan2(player.body.position.x - root.position.x, player.body.position.z - root.position.z);
    }
    root.rotation.z = phase === 'windup' ? root.rotation.z : 0;
    if (phase === 'phaseThreeAwakening' && phaseTime >= 1.25) {
      phase = 'gravityWindup'; phaseTime = 0; shotClock = 0;
    }
    // Phase 3 repeats only after a completed knockdown, never on a timer.
    if (healthPhase() === 2 && phase === 'flying' && player.isEnabled() && player.getHealth() > 0) {
      rushClock += dt;
      if (rushClock >= BOSS_RULES.rushInterval) {
        phase = 'windup'; phaseTime = 0; rushClock = 0; clearBolts(); rushAim.copy(player.body.position);
      }
    }
    if (phase === 'windup') {
      if (phaseTime < 1.1) rushAim.copy(player.body.position);
      rushDirection.copy(rushAim).sub(root.position); rushDirection.y = 0; rushDirection.normalize();
      root.rotation.y = Math.atan2(rushDirection.x, rushDirection.z);
      root.rotation.z = Math.sin(phaseTime * 65) * 0.045 * (1 + phaseTime);
      root.position.y = Math.sin(phaseTime * 80) * 0.08;
      if (phaseTime >= BOSS_RULES.windupSeconds) { phase = 'rushing'; phaseTime = 0; rushHit = false; root.rotation.z = 0; }
    } else if (phase === 'rushing') stepRush(dt);
    else if (phase === 'recovering') {
      if (phaseTime >= 0.9) { phase = 'flying'; phaseTime = 0; shotClock = 0; }
    } else if (phase === 'gravityWindup' && phaseTime >= BOSS_RULES.transformSeconds && droneTemplate) {
      phase = 'gravity'; phaseTime = 0; spawnDroneWave(); options.onPhaseThreeEnd?.();
    }
    if (phase === 'falling' && phaseTime >= 0.85) {
      phase = 'exposed'; phaseTime = 0;
      remaining = pillarStun ? BOSS_RULES.pillarStunSeconds : BOSS_RULES.exposedSeconds;
    }
    else if (phase === 'exposed') {
      remaining = Math.max(0, (pillarStun ? BOSS_RULES.pillarStunSeconds : BOSS_RULES.exposedSeconds) - phaseTime);
      if (remaining <= 1e-7) {
        phase = 'rising'; phaseTime = 0; remaining = 0;
      }
    } else if (phase === 'rising' && phaseTime >= 1.2) {
      round++; shotClock = 0; rushClock = 0; remaining = 0; pillarStun = false;
      targets.forEach(target => target.reset(healthPhase() === 3 ? 'phase3' : 'phase1'));
      if (healthPhase() === 3) { removeDrones(); phase = 'gravityWindup'; phaseTime = 0; }
      else { phase = 'flying'; phaseTime = 0; }
    }
    pose();

    // Phase 1 variable fire.
    if ((phase === 'flying' || phase === 'gravity') && player.isEnabled() && player.getHealth() > 0) {
      shotClock += dt;
      if (!charging && shotClock >= BOSS_RULES.shotInterval - BOSS_RULES.chargeSeconds) {
        charging = true; chargedAim.copy(player.body.position);
      }
      if (shotClock >= BOSS_RULES.shotInterval) { releaseVolley(choosePattern()); shotClock = 0; charging = false; }
      if (volleyQueue > 0) {
        volleyClock -= dt;
        if (volleyClock <= 0) {
          fireBolt(volleyPattern === 'burst' ? 0 : 0);
          volleyQueue--; volleyClock = BOSS_RULES.volleyGap;
        }
      }
    }

    if (phase === 'gravity') updateDrones(dt);
    if (player.isEnabled()) stepBolts(dt);
  }
  pose();
  const unregister = registerPhysicsActor(world, { body: player.body, beforePhysicsStep: update, afterPhysicsStep() {
    for (const drone of drones) if (drone.active) drone.root.position.copy(drone.body.position);
  } });
  return {
    root, head: headHitbox, body: bodyHitbox, targets, headTarget, bodyTarget, ready: Promise.all([modelReady, droneReady]),
    start() { if (phase === 'dormant') { phase = 'flying'; phaseTime = 0; shotClock = 0; } },
    async prepareRendering(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
      if (disposed) return;
      const textures = new Set<THREE.Texture>();
      for (const drone of drones) drone.root.traverse(node => {
        if (node instanceof THREE.SkinnedMesh && node.skeleton.boneTexture) textures.add(node.skeleton.boneTexture);
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      textures.forEach(texture => renderer.initTexture(texture));
      // compileAsync includes hidden pooled drones without exposing them to the gameplay camera.
      await renderer.compileAsync(scene, camera);
    },
    updateVisuals(dt: number) {
      if (disposed) return;
      for (const drone of drones) if (drone.root.visible && (drone.active || drone.exploded)) {
        drone.mixer.update(phase === 'droneExplosion' ? dt * 0.25 : dt);
      }
    },
    getCinematicBounds(bounds = new THREE.Box3()) {
      bounds.makeEmpty();
      for (const { body } of colliders) {
        if (body.aabbNeedsUpdate) body.updateAABB();
        bounds.expandByPoint(cinematicBoundsPoint.set(body.aabb.lowerBound.x, body.aabb.lowerBound.y, body.aabb.lowerBound.z));
        bounds.expandByPoint(cinematicBoundsPoint.set(body.aabb.upperBound.x, body.aabb.upperBound.y, body.aabb.upperBound.z));
      }
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(root.position.x - 3, 0, root.position.z - 3),
        new THREE.Vector3(root.position.x + 3, 9, root.position.z + 3));
      return bounds;
    },
    getDamageTargets: (): DamageTarget[] => {
      if (disposed || phase === 'defeated' || phase === 'droneExplosion') return [];
      if (phase === 'exposed') return [bodyTarget];
      if (['flying', 'windup', 'rushing', 'recovering', 'gravity'].includes(phase)) return [...targets.filter(target => target.hits() > 0), ...droneTargets()];
      return [];
    },
    setGogglesActive(active: boolean) {
      scanning = active;
      for (const t of targets) if (!targetsPhaseThreeMode) t.mesh.material = active ? targetGoggle : targetIdle;
    },
    getStatus: () => ({ phase, phaseThree, combatPhase: healthPhase(), health, maxHealth: BOSS_RULES.health, pillarStun,
      round, remaining, targets: targets.map(t => t.hits()), charging, drones: drones.filter(drone => drone.active).length,
      droneLoadError, projectiles: bolts.length, pillarsRemaining: pillars.filter(p => p.intact()).length,
      transformProgress, phaseThreeTargetsActive: targetsPhaseThreeMode }),
    dispose() {
      if (disposed) return; disposed = true; if (phase === 'droneExplosion') options.onDroneExplosionEnd?.();
      unregister(); clearBolts(); disposeDronePool(); fragments.forEach(f => f.mesh.removeFromParent());
      for (const { body } of colliders) if (body.world === world) world.removeBody(body);
      mixer?.stopAllAction(); if (modelRoot) { disposeTemplate(modelRoot); modelRoot = null; }
      root.removeFromParent();
      boxGeometry.dispose(); sphereGeometry.dispose();
      blast.removeFromParent(); blastLight.removeFromParent();
      for (const mesh of [flash, shockwave, ...smokePuffs, ...sparks, ...debris, fireBall]) mesh.geometry.dispose();
      for (const material of [flashMaterial, shockwaveMaterial, smokeMaterial, sparkMaterial, fireMaterial, debrisMaterial]) material.dispose();
      for (const mesh of [...smokePuffs, ...sparks]) (mesh.material as THREE.Material).dispose();
      if (droneTemplate) { disposeTemplate(droneTemplate); droneTemplate = null; }
      for (const material of [blackMat, visorGreen, visorRed, heartCore, targetIdle, targetGoggle, targetPhaseThree, yellowScan, targetCrossMat,
        phaseThreeShellMat, auraBlue, auraRed, shardMaterial, droneBoltMaterial]) material.dispose();
      auraRings.forEach(ring => ring.geometry.dispose());
      headHitbox.geometry.dispose(); bodyHitbox.geometry.dispose();
      (headHitbox.material as THREE.Material).dispose(); (bodyHitbox.material as THREE.Material).dispose();
    },
  };
}
