import * as THREE from 'three';
import { emitComicEffect } from '../helpers/scene/comicEffects.js';
import * as CANNON from 'cannon-es';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { registerPhysicsActor } from '../helpers/physics/scenePhysics.js';
import { PLAYER_MAX_HEALTH, type Player } from './player.js';
import type { DamageTarget } from './pistol.js';
import { loadToolModel } from '../core/loader.js';

export const BOSS_RULES = Object.freeze({ health: 980, headDamage: 35, headCooldown: 1,
  exposedSeconds: 10, laserSpeed: 14, laserDamage: 12, chargeSeconds: 0.8, shotInterval: 1.8,
  rushInterval: 9, windupSeconds: 1.8, rushSpeed: 27, phaseThreeHealth: 420,
  gravityWindup: 0.85, gravityDuration: 8, phaseTwoReturn: 5.5, droneDamage: 42,
  droneExplosionSlow: 0.25, droneDetonateAt: 0.22, droneExplosionDuration: 1.1,
  // Drones launch off the boss, orbit at a stand-off distance, telegraph, then commit to a fast rush.
  droneLaunchSeconds: 0.8, droneOrbitRadius: 3.1, droneOrbitHeight: 1.3, droneOrbitSpeed: 1.05,
  droneOrbitHoldBase: 0.5, droneOrbitHoldStep: 0.35, droneWindupSeconds: 0.32,
  droneChargeSpeed: 10, droneApproachTrigger: 3.4, droneContactTrigger: 1.05 });
export type BossPhase = 'dormant' | 'flying' | 'windup' | 'rushing' | 'recovering' | 'falling' | 'exposed' | 'rising'
  | 'phaseThreeAwakening' | 'gravityWindup' | 'gravity' | 'droneExplosion' | 'phaseThreeRecovery' | 'defeated';
export interface BossPillar { position: THREE.Vector3; intact: () => boolean; shatter: () => void; }
interface BossOptions {
  loadDrone?: () => ReturnType<typeof loadToolModel>;
  onPhaseThree?: () => void;
  onDroneApproach?: (drone: THREE.Object3D) => void;
  onDroneExplosion?: (drone: THREE.Object3D, position: THREE.Vector3) => void;
  onDroneExplosionEnd?: () => void;
}
type DroneState = 'launch' | 'orbit' | 'windup' | 'charge';
type Drone = {
  root: THREE.Group; mixer: THREE.AnimationMixer; life: number; active: boolean; exploded: boolean;
  state: DroneState; stateTime: number; index: number; launchFrom: THREE.Vector3; orbitAngle: number; orbitDir: 1 | -1;
  chargeDirection: THREE.Vector3;
};

/** Scene-owned, stationary hover boss. Its attack simulation uses the world's fixed clock. */
export function createLoadingBayBoss(scene: THREE.Scene, world: CANNON.World, player: Player, onDefeated: () => void, pillars: BossPillar[] = [], options: BossOptions = {}) {
  const root = new THREE.Group(); root.name = 'LoadingBayBoss'; scene.add(root);
  const armor = new THREE.MeshStandardMaterial({ color: 0x2b3a46, metalness: 0.75, roughness: 0.38 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6c7f8c, metalness: 0.55, roughness: 0.45 });
  const core = new THREE.MeshStandardMaterial({ color: 0x71838a, metalness: 0.6, roughness: 0.35 });
  const hornMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2126, metalness: 0.4, roughness: 0.55 });
  const phaseThreeHorn = new THREE.MeshStandardMaterial({ color: 0x2c0e0e, emissive: 0xff2c10, emissiveIntensity: 0.9, metalness: 0.35, roughness: 0.4 });
  const targetMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e5ce, emissive: 0x587c5b, emissiveIntensity: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff2828, emissive: 0xff1515, emissiveIntensity: 0.85 });
  const eyeRed = new THREE.MeshStandardMaterial({ color: 0xff3028, emissive: 0xff1008, emissiveIntensity: 2.8, metalness: 0.25, roughness: 0.2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd126, emissive: 0xffb300, emissiveIntensity: 0.9 });
  const green = new THREE.MeshBasicMaterial({ color: 0x59ff79 });
  const phaseThreeRed = new THREE.MeshStandardMaterial({ color: 0x721b21, emissive: 0xff160d, emissiveIntensity: 1.8, roughness: 0.24, metalness: 0.5 });
  const auraMaterial = new THREE.MeshBasicMaterial({ color: 0x65dfff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const phaseThreeAuraMaterial = new THREE.MeshBasicMaterial({ color: 0xff2920, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const roundGeometry = new THREE.SphereGeometry(0.5, 22, 16);
  const limbGeometry = new THREE.CapsuleGeometry(0.5, 0.55, 5, 10);
  const hornGeometry = new THREE.ConeGeometry(0.16, 1, 10);
  const auraRoot = new THREE.Group(); auraRoot.name = 'BossEnergyAura'; root.add(auraRoot);
  const auraRings = [0, 1, 2].map(index => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5 + index * 0.75, 0.035, 6, 64), auraMaterial);
    ring.rotation.set(index * 0.82, index * 0.47, index * 0.35); ring.position.y = 4.2; auraRoot.add(ring); return ring;
  });
  const auraLight = new THREE.PointLight(0x52dfff, 7, 13, 2); auraLight.position.set(0, 5.1, 0); root.add(auraLight);
  const bodies: Array<{ mesh: THREE.Mesh; body: CANNON.Body }> = [];
  function block(name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, solid = true, shape: THREE.BufferGeometry = geometry) {
    const mesh = new THREE.Mesh(shape, material); mesh.name = name; mesh.scale.set(...size); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    if (solid) {
      const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
      world.addBody(body); bodies.push({ mesh, body });
    }
    return mesh;
  }
  const torso = block('BossTorso', [3.5, 3.1, 2.35], [0, 5.3, 0], armor, true, roundGeometry);
  const chestPlate = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), trim);
  chestPlate.scale.set(1.7, 1, 1.05); chestPlate.position.set(0, 0.35, 0.55); chestPlate.castShadow = true; torso.add(chestPlate);
  const head = block('BossHead', [1.55, 1.5, 1.55], [0, 7.75, 0.25], core, true, roundGeometry);
  head.userData.breakableWeapon = 'crowbar';
  const brow = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.22, 16, 1, false, Math.PI * 0.15, Math.PI * 0.7), trim);
  brow.rotation.z = Math.PI / 2; brow.position.set(0, 0.28, 0.42); brow.castShadow = true; head.add(brow);
  const horns = [-1, 1].map(side => {
    const horn = new THREE.Mesh(hornGeometry, hornMaterial); horn.name = 'BossHorn'; horn.castShadow = true;
    horn.position.set(side * 0.42, 0.62, -0.08); horn.rotation.set(-0.5, 0, side * 0.34); horn.scale.set(0.85, 1, 0.85); head.add(horn); return horn;
  });
  const visor = block('BossVisor', [1.15, 0.14, 0.05], [0, 7.85, 1.07], green, false);
  head.add(visor); visor.position.set(0, 0.0625, 0.66); visor.scale.divideScalar(1.6);
  const phaseThreeEyes = [-1, 1].map(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), eyeRed);
    eye.name = 'BossRedEye'; eye.position.set(side * 0.38, 0.24, 0.78); eye.visible = false; head.add(eye); return eye;
  });
  const eyeLight = new THREE.PointLight(0xff1810, 0, 9, 2); eyeLight.position.set(0, 7.95, 1.1); root.add(eyeLight);
  const limbs = [-1, 1].flatMap(side => {
    const shoulder = block('BossShoulder', [1.5, 1.6, 1.6], [side * 2.55, 6, -0.1], trim, true, roundGeometry);
    const spike = new THREE.Mesh(hornGeometry, hornMaterial); spike.name = 'BossShoulderSpike'; spike.castShadow = true;
    spike.scale.set(0.68, 0.6, 0.68); spike.position.set(0, 0.58, -0.15); spike.rotation.set(-0.3, 0, side * -0.25); shoulder.add(spike);
    const cannon = block('BossCannon', [1.15, 2.15, 1.1], [side * 2.8, 4.2, 0.1], armor, true, limbGeometry);
    const leg = block('BossLeg', [1.05, 1.55, 1.05], [side * 1.1, 2.8, -0.25], trim, true, limbGeometry);
    return [shoulder, cannon, leg];
  });
  const muzzles = [-1, 1].map(side => block('LaserMuzzle', [0.55, 0.55, 0.32], [side * 2.8, 4.1, 0.95], green, false, roundGeometry));
  const thrusters = [-1, 1].map(side => block('BossThruster', [0.6, 0.85, 0.6], [side * 1.1, 1.6, -0.25], green, false, limbGeometry));
  let phase: BossPhase = 'dormant', health = BOSS_RULES.health as number, round = 1, remaining = 0;
  let phaseTime = 0, elapsed = 0, shotClock = 0, headCooldown = 0, scanning = false, disposed = false, muzzleIndex = 0;
  let phaseThree = false, phaseThreeReturnClock = 0, gravityActive = false;
  const previousGravity = world.gravity.clone();
  let droneTemplate: THREE.Group | null = null, droneLoadError = false, droneExplosionClock = 0;
  let droneClips: THREE.AnimationClip[] = [], droneDetonated = false, waveApproachTriggered = false;
  const blast = new THREE.Group(); blast.name = 'EyeDroneExplosion'; blast.visible = false; scene.add(blast);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), flashMaterial); blast.add(flash);
  const fireballMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), fireballMaterial); blast.add(fireball);
  const shockwaveMaterial = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), shockwaveMaterial); blast.add(shockwave);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2622, transparent: true, opacity: 0, depthWrite: false });
  const smokePuffs = [0, 1, 2, 3].map(() => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), smokeMaterial.clone()); blast.add(mesh); return mesh; });
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = [0, 1, 2, 3, 4, 5].map(() => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), sparkMaterial.clone()); blast.add(mesh); return mesh; });
  const blastLight = new THREE.PointLight(0xff8a3c, 0, 9); blast.add(blastLight);
  const drones: Drone[] = [];
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
  const droneReady = Promise.resolve().then(options.loadDrone ?? (() => loadToolModel('Enemy_EyeDrone'))).then(asset => {
    if (disposed) { disposeTemplate(asset.scene); return; }
    droneTemplate = asset.scene; droneClips = asset.animations;
    asset.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(asset.scene), size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error('EyeDrone model has invalid bounds');
    const scale = 0.9 / Math.max(size.x, size.y, size.z, 0.001), center = bounds.getCenter(new THREE.Vector3());
    asset.scene.scale.setScalar(scale); asset.scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    asset.scene.updateMatrixWorld(true); droneTemplate = asset.scene;
  }).catch(error => {
    if (disposed) return;
    droneLoadError = true; console.error('[Scene 13] EyeDrone could not load:', error);
    if (droneTemplate) disposeTemplate(droneTemplate);
    droneTemplate = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), new THREE.MeshStandardMaterial({ color: 0x687780, metalness: 0.7, roughness: 0.3 }));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2410 }));
    eye.position.z = 0.34; droneTemplate.add(shell, eye); droneClips = [];
  });
  const chargedAim = new THREE.Vector3();
  let charging = false, rushClock = 0, rushHit = false, pillarStun = false;
  const rushDirection = new THREE.Vector3(), rushAim = new THREE.Vector3();
  const impactPosition = new THREE.Vector3(), headStart = new THREE.Vector3();
  const headLanding = new THREE.Vector3(0, 1.05, 0);
  const bolts: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const fragments: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const shardMaterial = new THREE.MeshStandardMaterial({ color: 0x718c80, roughness: 0.6 });

  function burst(mesh: THREE.Mesh) {
    const center = mesh.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 14; i++) {
      const shard = new THREE.Mesh(geometry, shardMaterial); shard.name = 'BreakableDebris'; shard.scale.setScalar(0.12 + Math.random() * 0.12);
      shard.position.copy(center); scene.add(shard);
      fragments.push({ mesh: shard, life: 2, velocity: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4) });
    }
  }
  const targets = [-1, 1].flatMap(x => [-1, 1].map(y => {
    const mesh = block(`BossTarget-${x}-${y}`, [0.9, 0.9, 0.18], [x * 1.15, 5.3 + y * 0.9, 1.14], targetMaterial, false);
    mesh.userData.breakableWeapon = 'pistol';
    // The inset cross belongs to the same target, so it can never occlude its hit surface.
    const cross = new THREE.Mesh(geometry, green); cross.scale.set(0.16, 0.65, 0.2); cross.position.z = 0.55; mesh.add(cross);
    let hits = 1;
    const target: DamageTarget = { root: mesh, damage(amount, weapon) {
      if (disposed || phaseThree || (phase !== 'flying' && phase !== 'windup') || !player.isEnabled() || weapon !== 'pistol' || hits <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
      hits--; cross.visible = false;
      emitComicEffect(scene, 'hit', { source: mesh, weapon });
      if (!hits) {
        burst(mesh); mesh.visible = false;
        if (targets.every(t => t.hits() === 0)) beginFall(false);
      }
      return true;
    } };
    return { ...target, mesh, hits: () => hits, reset() { hits = round === 1 ? 1 : 2; mesh.visible = true; cross.visible = true; } };
  }));
  const headTarget: DamageTarget = { root: head, body: bodies.find(p => p.mesh === head)!.body, damage(amount, weapon) {
    const phaseThreeOpen = phaseThree && !['dormant', 'defeated', 'droneExplosion'].includes(phase);
    if (disposed || !player.isEnabled() || headCooldown > 0 || !Number.isFinite(amount) || amount <= 0
      || (phaseThreeOpen ? weapon !== 'pistol' : phase !== 'exposed' || (weapon !== 'crowbar' && weapon !== 'lightsaber'))) return false;
    health = Math.max(0, health - (phaseThreeOpen ? amount : BOSS_RULES.headDamage)); headCooldown = BOSS_RULES.headCooldown; burst(head);
    if (health > 0 || !phaseThree) emitComicEffect(scene, 'hit', { source: head, weapon });
    if (!health) {
      if (!phaseThree) {
        enterPhaseThree(); options.onPhaseThree?.();
      } else finishBoss();
    }
    return true;
  } };
  function enterPhaseThree(healthFraction = 1) {
    phaseThree = true; health = BOSS_RULES.phaseThreeHealth * healthFraction; phase = 'phaseThreeAwakening'; phaseTime = 0;
    phaseThreeReturnClock = 0; rushClock = 0; headCooldown = 0; pillarStun = false; remaining = 0;
    head.userData.breakableWeapon = 'pistol'; clearBolts(); targets.forEach(target => { target.mesh.visible = false; });
    pose(0);
  }
  function clearBolts() { for (const bolt of bolts) bolt.mesh.removeFromParent(); bolts.length = 0; charging = false; }
  function setGravityMode(active: boolean) {
    if (gravityActive === active) return;
    gravityActive = active;
    if (active) { previousGravity.copy(world.gravity); world.gravity.set(0, 0, 0); }
    else world.gravity.copy(previousGravity);
    player.setZeroGravity(active);
    player.setZeroGravityStrafe(active);
  }
  function removeDrones() {
    for (const drone of drones) {
      drone.mixer.stopAllAction(); drone.mixer.uncacheRoot(drone.mixer.getRoot());
      drone.root.traverse(node => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
        if (!(node instanceof THREE.Mesh)) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(material => material.dispose());
      });
      drone.root.removeFromParent(); drone.active = false;
    }
    drones.length = 0;
  }
  function finishBoss() {
    if (phase === 'droneExplosion') options.onDroneExplosionEnd?.();
    emitComicEffect(scene, 'clank', { source: root });
    phase = 'defeated'; root.visible = false; clearBolts(); removeDrones(); setGravityMode(false);
    for (const { body } of bodies) if (body.world === world) world.removeBody(body);
    onDefeated();
  }
  function beginPhaseThreeRecovery() {
    removeDrones(); setGravityMode(false); blast.visible = false;
    phase = 'phaseThreeRecovery'; phaseTime = 0; phaseThreeReturnClock = 0; shotClock = 0; charging = false;
  }
  function droneOrbitAnchor(drone: Drone) {
    return new THREE.Vector3(
      player.body.position.x + Math.cos(drone.orbitAngle) * BOSS_RULES.droneOrbitRadius,
      player.getHeadY() + BOSS_RULES.droneOrbitHeight,
      player.body.position.z + Math.sin(drone.orbitAngle) * BOSS_RULES.droneOrbitRadius,
    );
  }
  function spawnDroneWave() {
    if (!droneTemplate) { beginPhaseThreeRecovery(); return; }
    removeDrones(); waveApproachTriggered = false;
    root.updateMatrixWorld(true);
    for (let index = 0; index < 4; index++) {
      const side = index % 2 ? 1 : -1;
      const model = clone(droneTemplate), droneRoot = new THREE.Group();
      droneRoot.name = `BossEyeDrone-${index}`; droneRoot.add(model);
      droneRoot.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true; node.receiveShadow = true;
        const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
        const clonedMaterials = sourceMaterials.map(material => material.clone());
        node.material = Array.isArray(node.material) ? clonedMaterials : clonedMaterials[0];
      });
      const launchFrom = root.localToWorld(new THREE.Vector3(side * 2.6, 5 + (index % 2) * 1.4, 1.1));
      droneRoot.position.copy(launchFrom);
      scene.add(droneRoot);
      const mixer = new THREE.AnimationMixer(model);
      if (droneClips[0]) mixer.clipAction(droneClips[0]).play();
      // Each drone spins a different way and holds its orbit for a different beat before committing.
      const drone: Drone = { root: droneRoot, mixer, life: BOSS_RULES.gravityDuration, active: true, exploded: false,
        state: 'launch', stateTime: 0, index, launchFrom: launchFrom.clone(),
        orbitAngle: (index / 4) * Math.PI * 2, orbitDir: index % 2 ? 1 : -1, chargeDirection: new THREE.Vector3() };
      drone.root.lookAt(droneOrbitAnchor(drone));
      drones.push(drone);
    }
  }
  function droneTargets(): DamageTarget[] {
    return drones.filter(drone => drone.active).map(drone => ({ root: drone.root, damage(amount, weapon) {
      if (disposed || phase !== 'gravity' || !player.isEnabled() || weapon !== 'pistol' || !Number.isFinite(amount) || amount <= 0 || !drone.active) return false;
      emitComicEffect(scene, 'boom', { source: drone.root });
      drone.active = false; drone.root.visible = false;
      const mesh = drone.root.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
      if (mesh) burst(mesh);
      if (drones.every(item => !item.active)) beginPhaseThreeRecovery();
      return true;
    } }));
  }
  function beginDroneExplosion(drone: Drone) {
    if (phase !== 'gravity' || !drone.active) return;
    drone.active = false; drone.exploded = true;
    for (const other of drones) if (other !== drone) { other.active = false; other.root.visible = false; }
    phase = 'droneExplosion'; phaseTime = 0; droneExplosionClock = 0; droneDetonated = false;
    const playerHead = new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z);
    const offset = drone.root.position.clone().sub(playerHead).normalize().multiplyScalar(0.7);
    drone.root.position.copy(playerHead).add(offset);
    const towardPlayer = playerHead.clone().sub(drone.root.position).normalize();
    shockwave.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), towardPlayer.lengthSq() > 0 ? towardPlayer : new THREE.Vector3(0, 0, 1));
    drone.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.setHex(0xff2414); material.emissiveIntensity = 2.5;
      }
    });
    options.onDroneExplosion?.(drone.root, drone.root.position.clone());
  }
  function updateDroneExplosionVisuals(progress: number) {
    flashMaterial.opacity = Math.max(0, 1 - progress * 9);
    flash.scale.setScalar(0.35 + progress * 2.4);
    const fireProgress = THREE.MathUtils.clamp(progress / 0.55, 0, 1);
    fireball.scale.setScalar(0.25 + THREE.MathUtils.smootherstep(fireProgress, 0, 1) * 2.7);
    fireballMaterial.opacity = Math.sin(Math.min(1, progress / 0.12) * Math.PI * 0.5) * Math.max(0, 1 - progress) * 0.95;
    const shockProgress = THREE.MathUtils.clamp(progress / 0.7, 0, 1);
    shockwave.scale.setScalar(0.4 + THREE.MathUtils.smootherstep(shockProgress, 0, 1) * 5.6);
    shockwaveMaterial.opacity = Math.max(0, 0.85 - shockProgress * 0.95);
    smokePuffs.forEach((mesh, index) => {
      const local = THREE.MathUtils.clamp((progress - index * 0.07) / (1 - index * 0.07), 0, 1);
      mesh.visible = local > 0;
      mesh.scale.setScalar(0.5 + local * (2.1 + index * 0.4));
      mesh.position.set(Math.sin(index * 2.4) * local * 0.8, local * 1.6 + index * 0.05, Math.cos(index * 2.4) * local * 0.8);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, local * 1.4) * Math.max(0, 1 - local);
    });
    sparks.forEach((mesh, index) => {
      const local = THREE.MathUtils.clamp(progress / 0.45, 0, 1);
      const angle = index * 1.05, tilt = (index % 2 ? 1 : -1) * 0.6;
      mesh.position.set(Math.cos(angle) * local * 1.6, Math.sin(tilt) * local * 1.1, Math.sin(angle) * local * 1.6);
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - local * 1.6);
    });
    blastLight.intensity = Math.max(0, 1 - progress * 1.3) * 55;
  }
  function updateDrones(dt: number) {
    for (const drone of drones) if (drone.active || drone.exploded) drone.mixer.update(dt);
    if (phase === 'gravity') {
      for (const drone of drones) {
        if (!drone.active) continue;
        drone.life -= dt; drone.stateTime += dt;
        if (drone.state === 'launch') {
          const t = THREE.MathUtils.clamp(drone.stateTime / BOSS_RULES.droneLaunchSeconds, 0, 1);
          const eased = THREE.MathUtils.smootherstep(t, 0, 1);
          const anchor = droneOrbitAnchor(drone);
          const arc = Math.sin(Math.PI * eased) * 1.4;
          drone.root.position.lerpVectors(drone.launchFrom, anchor, eased); drone.root.position.y += arc;
          drone.root.lookAt(anchor);
          if (t >= 1) { drone.state = 'orbit'; drone.stateTime = 0; }
        } else if (drone.state === 'orbit' || drone.state === 'windup') {
          if (drone.state === 'orbit') drone.orbitAngle += BOSS_RULES.droneOrbitSpeed * drone.orbitDir * dt;
          const anchor = droneOrbitAnchor(drone);
          anchor.y += Math.sin((elapsed + drone.index * 1.7) * 2.2) * 0.22;
          drone.root.position.lerp(anchor, 1 - Math.exp(-dt * (drone.state === 'orbit' ? 4 : 7)));
          const facePlayer = new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z);
          const lookTarget = new THREE.Object3D(); lookTarget.position.copy(drone.root.position); lookTarget.lookAt(facePlayer);
          drone.root.quaternion.slerp(lookTarget.quaternion, 1 - Math.exp(-dt * 5));
          if (drone.state === 'orbit') {
            const holdDuration = BOSS_RULES.droneOrbitHoldBase + drone.index * BOSS_RULES.droneOrbitHoldStep;
            if (drone.stateTime >= holdDuration) { drone.state = 'windup'; drone.stateTime = 0; }
          } else if (drone.stateTime >= BOSS_RULES.droneWindupSeconds) {
            drone.state = 'charge'; drone.stateTime = 0;
            drone.chargeDirection.copy(facePlayer).sub(drone.root.position).normalize();
          }
        } else if (drone.state === 'charge') {
          const from = drone.root.position.clone();
          drone.root.position.addScaledVector(drone.chargeDirection, BOSS_RULES.droneChargeSpeed * dt);
          drone.root.lookAt(drone.root.position.clone().add(drone.chargeDirection));
          const playerHead = new THREE.Vector3(player.body.position.x, player.getHeadY(), player.body.position.z);
          const closest = new THREE.Line3(from, drone.root.position).closestPointToPoint(playerHead, true, new THREE.Vector3());
          const distanceToHead = closest.distanceTo(playerHead);
          if (!waveApproachTriggered && distanceToHead < BOSS_RULES.droneApproachTrigger) {
            waveApproachTriggered = true; options.onDroneApproach?.(drone.root);
          }
          if (distanceToHead < BOSS_RULES.droneContactTrigger) { beginDroneExplosion(drone); break; }
        }
        if (drone.life <= 0) { drone.active = false; drone.root.visible = false; }
      }
      if (phase === 'gravity' && drones.every(drone => !drone.active)) beginPhaseThreeRecovery();
    } else if (phase === 'droneExplosion' && drones.some(drone => drone.exploded)) {
      droneExplosionClock += dt;
      if (!droneDetonated && droneExplosionClock >= BOSS_RULES.droneDetonateAt) {
        droneDetonated = true;
        for (const drone of drones) if (drone.exploded) {
          emitComicEffect(scene, 'boom', { source: drone.root });
          blast.position.copy(drone.root.position); blast.visible = true; drone.root.visible = false;
          const mesh = drone.root.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
          if (mesh) burst(mesh);
        }
        player.takeDamage(PLAYER_MAX_HEALTH * BOSS_RULES.droneDamage / 100, true);
      }
      if (droneDetonated) {
        const progress = THREE.MathUtils.clamp((droneExplosionClock - BOSS_RULES.droneDetonateAt) / (BOSS_RULES.droneExplosionDuration - BOSS_RULES.droneDetonateAt), 0, 1);
        updateDroneExplosionVisuals(progress);
      }
      if (droneExplosionClock >= BOSS_RULES.droneExplosionDuration) {
        beginPhaseThreeRecovery();
        options.onDroneExplosionEnd?.();
      }
    }
  }
  function beginFall(hitPillar: boolean) {
    head.getWorldPosition(headStart); impactPosition.copy(root.position); impactPosition.y = 0;
    pillarStun = hitPillar; phase = 'falling'; phaseTime = 0; rushClock = 0; clearBolts();
    root.rotation.z = 0;
  }
  function stepRush(dt: number) {
    const from = root.position.clone(), to = from.clone().addScaledVector(rushDirection, BOSS_RULES.rushSpeed * dt);
    from.y = to.y = 0;
    const segment = new THREE.Line3(from, to);
    let obstacle: BossPillar | null = null, first = Infinity;
    for (const pillar of pillars) {
      if (!pillar.intact()) continue;
      const center = pillar.position.clone(); center.y = 0;
      const closest = segment.closestPointToPoint(center, true, new THREE.Vector3());
      if (closest.distanceTo(center) < 3.5 && from.distanceTo(closest) < first) { obstacle = pillar; first = from.distanceTo(closest); }
    }
    const p = new THREE.Vector3(player.body.position.x, 0, player.body.position.z);
    const closest = segment.closestPointToPoint(p, true, new THREE.Vector3());
    if (!rushHit && closest.distanceTo(p) < 3.1 && from.distanceTo(closest) < first) {
      rushHit = true; player.takeDamage(PLAYER_MAX_HEALTH * 0.5);
    }
    root.position.copy(to);
    if (obstacle) {
      root.position.copy(from).addScaledVector(rushDirection, first);
      obstacle.shatter(); beginFall(true); return;
    }
    if (Math.abs(to.x) > 16.5 || Math.abs(to.z) > 20.5 || phaseTime >= 1.6) {
      root.position.x = THREE.MathUtils.clamp(to.x, -16.5, 16.5);
      root.position.z = THREE.MathUtils.clamp(to.z, -20.5, 20.5);
      impactPosition.copy(root.position); phase = 'recovering'; phaseTime = 0;
    }
  }
  const neutral = new Map([...limbs, torso, ...muzzles, ...thrusters, ...targets.map(t => t.mesh)].map(mesh => [mesh, mesh.position.clone()]));
  const neutralRotations = new Map([...neutral.keys()].map(mesh => [mesh, mesh.rotation.clone()]));
  function pose(drop: number) {
    for (const [mesh, p] of neutral) {
      mesh.position.copy(p); mesh.position.y -= drop * (mesh.name === 'BossLeg' ? 2 : 2.65);
      mesh.rotation.copy(neutralRotations.get(mesh)!);
    }
    head.position.set(0, THREE.MathUtils.lerp(7.75, 1, drop), THREE.MathUtils.lerp(0.25, 2.8, drop));
    thrusters.forEach(t => { t.visible = phase !== 'defeated'; });
    phaseThreeEyes.forEach(eye => { eye.visible = phaseThree && phase !== 'defeated'; });
    visor.visible = !phaseThree;
    torso.material = phaseThree ? phaseThreeRed : armor;
    horns.forEach(horn => { horn.material = phaseThree ? phaseThreeHorn : hornMaterial; });
    auraRings.forEach((ring, index) => {
      ring.material = phaseThree ? phaseThreeAuraMaterial : auraMaterial;
      ring.visible = phaseThree && phase !== 'defeated';
      ring.rotation.x = index * 0.82 + elapsed * 0.96 * (index + 1) * (index % 2 ? -1 : 1);
      ring.rotation.z = index * 0.35 + elapsed * 1.44 * (index + 1);
    });
    eyeLight.intensity = phaseThree && phase !== 'defeated' ? 24 + Math.sin(elapsed * 9) * 5 : 0;
    auraLight.color.setHex(phaseThree ? 0xff251b : 0x52dfff);
    auraLight.intensity = phaseThree ? 18 + Math.sin(elapsed * 4) * 3 : 7;
    const armsRaised = phase === 'gravityWindup' || phase === 'gravity';
    if (armsRaised) for (const sideIndex of [0, 1]) {
      const shoulder = limbs[sideIndex * 3], cannon = limbs[sideIndex * 3 + 1], side = sideIndex === 0 ? -1 : 1;
      const raised = phase === 'gravityWindup' ? THREE.MathUtils.smoothstep(phaseTime, 0, BOSS_RULES.gravityWindup) : 1;
      shoulder.position.y += raised * 1.3; shoulder.rotation.z = raised * side * -0.8;
      cannon.position.y += raised * 2.5; cannon.position.x = side * (2.8 - raised * 0.35); cannon.rotation.z = raised * side * -1.15;
      muzzles[sideIndex].position.y += raised * 2.5; muzzles[sideIndex].position.x = cannon.position.x;
    }
    if (pillarStun && (phase === 'falling' || phase === 'exposed')) {
      const t = phase === 'falling' ? THREE.MathUtils.smootherstep(phaseTime, 0, 0.85) : 1;
      const p = headStart.clone().lerp(headLanding, t); p.y += Math.sin(t * Math.PI) * 3.5;
      root.updateMatrixWorld(true); head.position.copy(root.worldToLocal(p));
      head.rotation.z = phase === 'falling' ? t * Math.PI * 4 : 0;
    } else {
      head.rotation.z = 0;
      if (pillarStun && phase === 'rising') {
        const t = THREE.MathUtils.smootherstep(phaseTime, 0, 1.2);
        head.position.set(0, THREE.MathUtils.lerp(headLanding.y, 7.75, t), THREE.MathUtils.lerp(0, 0.25, t));
      }
    }
    head.material = scanning && phase === 'exposed' ? yellow : core;
    core.emissive.setHex(headCooldown > 0.65 ? 0xffffff : 0x000000);
    root.updateMatrixWorld(true);
    for (const { mesh, body } of bodies) {
      const p = mesh.getWorldPosition(new THREE.Vector3()), q = mesh.getWorldQuaternion(new THREE.Quaternion());
      body.position.set(p.x, p.y, p.z); body.quaternion.set(q.x, q.y, q.z, q.w); body.aabbNeedsUpdate = true;
      body.collisionResponse = mesh === head || !['rushing', 'recovering', 'falling', 'exposed', 'rising'].includes(phase);
    }
  }
  function fire() {
    const from = muzzles[muzzleIndex++ % 2].getWorldPosition(new THREE.Vector3());
    emitComicEffect(scene, 'pew', { source: root, position: from });
    const direction = chargedAim.clone().sub(from).normalize();
    const mesh = new THREE.Mesh(geometry, green); mesh.name = 'BossLaser'; mesh.scale.set(0.12, 0.12, 1.2);
    mesh.position.copy(from); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); scene.add(mesh);
    bolts.push({ mesh, velocity: direction.multiplyScalar(BOSS_RULES.laserSpeed), life: 5 });
  }
  function stepBolts(dt: number) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i], from = bolt.mesh.position.clone(), to = from.clone().addScaledVector(bolt.velocity, dt);
      // Sweep the full frame segment; pillars/walls win over the player's body, even at low FPS.
      let distance = Infinity, hitPlayer = false;
      world.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z), { skipBackfaces: false }, hit => {
        if (!hit.body || bodies.some(part => part.body === hit.body) || !hit.body.collisionResponse || hit.distance >= distance) return;
        distance = hit.distance; hitPlayer = hit.body === player.body;
      });
      bolt.life -= dt;
      if (distance !== Infinity || bolt.life <= 0) {
        if (hitPlayer) player.takeDamage(BOSS_RULES.laserDamage);
        bolt.mesh.removeFromParent(); bolts.splice(i, 1);
      } else bolt.mesh.position.copy(to);
    }
  }
  function update(dt: number) {
    if (disposed) return;
    elapsed += dt; phaseTime += dt; headCooldown = Math.max(0, headCooldown - dt);
    for (let i = fragments.length - 1; i >= 0; i--) {
      const shard = fragments[i]; shard.life -= dt; shard.velocity.y -= 9.82 * dt; shard.mesh.position.addScaledVector(shard.velocity, dt);
      if (shard.mesh.position.y < 0.1) { shard.mesh.position.y = 0.1; shard.velocity.set(0, 0, 0); }
      if (shard.life < 0.5) shard.mesh.scale.multiplyScalar(Math.exp(-7 * dt));
      if (shard.life <= 0) { shard.mesh.removeFromParent(); fragments.splice(i, 1); }
    }
    if (phase === 'defeated') return;
    if (player.getHealth() <= 0 && phase !== 'droneExplosion') { removeDrones(); setGravityMode(false); clearBolts(); return; }
    if (phase === 'flying' || phase === 'dormant' || phase === 'rising' || phase === 'phaseThreeAwakening') {
      root.rotation.y = Math.atan2(player.body.position.x - root.position.x, player.body.position.z - root.position.z);
    }
    root.position.y = phase === 'flying' || phase === 'dormant' || phase === 'phaseThreeAwakening' ? Math.sin(elapsed * 1.6) * 0.18 : 0;
    if (phase === 'phaseThreeAwakening' && phaseTime >= 1.25) {
      phase = 'gravityWindup'; phaseTime = 0; phaseThreeReturnClock = 0; shotClock = 0;
    }
    if (phase === 'phaseThreeRecovery' && phaseTime >= 0.8) {
      phase = 'flying'; phaseTime = 0;
    }
    if (phaseThree && phase === 'flying') {
      phaseThreeReturnClock += dt;
      if (phaseThreeReturnClock >= BOSS_RULES.phaseTwoReturn && droneTemplate) {
        phase = 'gravityWindup'; phaseTime = 0; clearBolts();
      }
    }
    if ((round > 1 || phaseThree) && phase === 'flying' && player.isEnabled() && player.getHealth() > 0) {
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
      root.position.copy(impactPosition).multiplyScalar(1 - THREE.MathUtils.smootherstep(phaseTime, 0, 2.5));
      if (phaseTime >= 2.5) { phase = 'flying'; phaseTime = 0; shotClock = 0; }
    } else if (phase === 'gravityWindup' && phaseTime >= BOSS_RULES.gravityWindup) {
      setGravityMode(true); phase = 'gravity'; phaseTime = 0; spawnDroneWave();
    }
    if (phase === 'falling' && phaseTime >= 0.85) { phase = 'exposed'; phaseTime = 0; remaining = BOSS_RULES.exposedSeconds; }
    else if (phase === 'exposed') {
      remaining = Math.max(0, BOSS_RULES.exposedSeconds - phaseTime);
      if (pillarStun) root.position.copy(impactPosition).multiplyScalar(1 - THREE.MathUtils.smootherstep(phaseTime, 0, BOSS_RULES.exposedSeconds));
      if (remaining <= 1e-7) {
        if (pillarStun) root.position.set(0, 0, 0);
        phase = 'rising'; phaseTime = 0; remaining = 0;
      }
    } else if (phase === 'rising' && phaseTime >= 1.2) {
      round++; if (!phaseThree) targets.forEach(t => t.reset()); phase = 'flying'; phaseTime = 0; shotClock = 0; rushClock = 0; pillarStun = false;
    }
    pose(phase === 'falling' ? Math.min(1, (phaseTime / 0.85) ** 2) : phase === 'exposed' ? 1 : phase === 'rising' ? Math.max(0, 1 - phaseTime / 1.2) : 0);
    if (phase === 'flying' && player.isEnabled() && player.getHealth() > 0) {
      shotClock += dt;
      if (!charging && shotClock >= BOSS_RULES.shotInterval - BOSS_RULES.chargeSeconds) {
        charging = true; chargedAim.copy(player.body.position);
      }
      muzzles.forEach(m => m.scale.setScalar(charging ? 0.8 + Math.sin(elapsed * 28) * 0.15 : 0.65));
      if (shotClock >= BOSS_RULES.shotInterval) { fire(); shotClock = 0; charging = false; }
    }
    if (phase === 'gravity' || phase === 'droneExplosion') updateDrones(dt);
    if (phase === 'gravity' && phaseTime >= BOSS_RULES.gravityDuration) beginPhaseThreeRecovery();
    stepBolts(dt);
  }
  pose(0);
  const unregister = registerPhysicsActor(world, { body: bodies[0].body, beforePhysicsStep: update, afterPhysicsStep() {} });
  return {
    root, head, targets, headTarget, ready: droneReady,
    start() { if (phase === 'dormant') { phase = 'flying'; phaseTime = 0; shotClock = 0; } },
    startPhaseThree() { if (!disposed && phase === 'dormant') enterPhaseThree(0.5); },
    getDamageTargets: (): DamageTarget[] => disposed || phase === 'defeated' || phase === 'droneExplosion' ? [] : phaseThree
      ? phase === 'gravity' ? [...droneTargets(), headTarget] : [headTarget]
      : phase === 'flying' || phase === 'windup' ? targets.filter(t => t.hits() > 0) : phase === 'exposed' ? [headTarget] : [],
    setGogglesActive(active: boolean) { scanning = active; for (const t of targets) t.mesh.material = active ? red : targetMaterial; head.material = active && phase === 'exposed' ? yellow : core; },
    getStatus: () => ({ phase, phaseThree, health, maxHealth: phaseThree ? BOSS_RULES.phaseThreeHealth : BOSS_RULES.health, round, remaining, targets: targets.map(t => t.hits()), charging, drones: drones.filter(drone => drone.active).length, droneLoadError, projectiles: bolts.length, pillarsRemaining: pillars.filter(p => p.intact()).length }),
    dispose() {
      if (disposed) return; disposed = true; if (phase === 'droneExplosion') options.onDroneExplosionEnd?.();
      unregister(); clearBolts(); removeDrones(); setGravityMode(false); fragments.forEach(f => f.mesh.removeFromParent());
      for (const { body } of bodies) if (body.world === world) world.removeBody(body);
      root.removeFromParent(); geometry.dispose(); roundGeometry.dispose(); limbGeometry.dispose(); hornGeometry.dispose();
      blast.removeFromParent();
      for (const mesh of [flash, fireball, shockwave, ...smokePuffs, ...sparks]) mesh.geometry.dispose();
      for (const material of [flashMaterial, fireballMaterial, shockwaveMaterial, smokeMaterial, sparkMaterial]) material.dispose();
      for (const mesh of [...smokePuffs, ...sparks]) (mesh.material as THREE.Material).dispose();
      if (droneTemplate) { disposeTemplate(droneTemplate); droneTemplate = null; }
      for (const material of [armor, trim, core, hornMaterial, phaseThreeHorn, targetMaterial, red, yellow, green, phaseThreeRed, eyeRed,
        auraMaterial, phaseThreeAuraMaterial, shardMaterial]) material.dispose();
      chestPlate.geometry.dispose(); brow.geometry.dispose();
      phaseThreeEyes.forEach(eye => eye.geometry.dispose()); auraRings.forEach(ring => ring.geometry.dispose());
    },
  };
}
