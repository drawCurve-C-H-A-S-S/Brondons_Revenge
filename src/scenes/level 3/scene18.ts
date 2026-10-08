import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createScenePhysics, createGroundMotor, registerPhysicsActor, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { createRescueSite, RESCUE_SITE, type RescueArrival } from '../../helpers/scene/rescueSite.js';
import { COURSE_PLATFORMS, COURSE_ROBOTS, PLATFORM_COURSE, courseX, courseDistance,
  createJungleScrambler, createJungleScramblerPulse, type PlatformProgress, type PlatformCheckpoint } from '../../helpers/scene/junglePlatformCourse.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';
import { emitComicEffect } from '../../helpers/scene/comicEffects.js';
import { createPlayer, PLAYER_MAX_HEALTH } from '../../scripts/player.js';
import { isTouchFire, consumePlatformerAim, resetTouchInput } from '../../scripts/touchControls.js';
import { loadSharkModel, loadToolModel } from '../../core/loader.js';
import type { CinematicPose, loadCharacter } from '../../scripts/characterManager.js';
import { traceShot, type DamageTarget, type DamageWeapon } from '../../scripts/pistol.js';
import { PARRY_DAMAGE, type ParryableBolt } from '../../scripts/lightsaber.js';

type Phase = 'entry' | 'traversal' | 'scrambler' | 'warp' | 'boss' | 'cleared' | 'sharkAttack' | 'exit' | 'death' | 'done';
type RiverShark = { root: THREE.Group; mixer: THREE.AnimationMixer; baseY: number; baseZ: number; side: number; phase: number; baseYaw: number; swimRate: number; scale: number };
type Actor = {
  id: string; root: THREE.Group; body: CANNON.Body; motor: ReturnType<typeof createGroundMotor>;
  mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[]; animation: string;
  health: number; boss: boolean; from: number; to: number; direction: number;
  cooldown: number; charge: number; deathTime: number; hitTime: number; aim: THREE.Vector3;
  signal: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
};
const BOSS_HEALTH = 600, ORB_HEALTH = 200, DEPTH = PLATFORM_COURSE.depth;
const SCROLL_SPEED = 2.1;
const smooth = THREE.MathUtils.smootherstep;
const copyProgress = (value: PlatformProgress): PlatformProgress => ({ ...value,
  activatedRelays: [...value.activatedRelays], defeatedRobots: [...value.defeatedRobots] });

/** Scene-owned combat/camera over the shared dynamic player and fixed-step ground physics. */
export function createScene({ entryState, onRespawn, onFinished, loadModel = loadToolModel, loadShark = loadSharkModel }: {
  entryState?: RescueArrival; onRespawn: (state: RescueArrival) => void; onFinished: (state: RescueArrival) => void;
  loadModel?: typeof loadToolModel;
  loadShark?: typeof loadSharkModel;
}) {
  let saved: PlatformProgress = copyProgress(entryState?.platformProgress ?? { checkpoint: 'bridge', activatedRelays: [], defeatedRobots: [] });
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const site = createRescueSite(physics, { culling: true, platformer: true, activatedRelays: saved.activatedRelays,
    ascendingPillars: true, bridgeBrokenAtStart: true });
  const { scene } = site, course = site.platformCourse!;
  site.setImpact(30); site.ship.setCanopyOpen(1); site.pod.getObjectByName('PodHatch')!.rotation.z = -1.5;
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 260);
  const checkpoint = PLATFORM_COURSE.checkpoints[saved.checkpoint];
  const spawn = new THREE.Vector3(courseX(checkpoint.u), checkpoint.top + PHYSICS.playerRadius, DEPTH);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  if (entryState?.pilotState) player.restoreTransition({ ...entryState.pilotState, position: spawn, velocity: { x: 0, y: 0, z: 0 },
    heldKeys: [], blockedKeys: [], yaw: Math.PI / 2, pitch: 0, crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false,
  }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.setSideScrollDepth(DEPTH); player.disable();
  // Actor contact damage is explicit; body impulses must not push robots off their patrol decks.
  player.body.collisionFilterMask &= ~2;
  player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties();
  let phase: Phase = 'entry', phaseTime = 0, elapsed = 0, lastDelta = 0, disposed = false, paused = false, transferred = false;
  let bossVictory = false;
  let firing = false, shotRequested = false, touchFiring = false, fireCooldown = 0, pendingShot = false, invulnerability = 0, damageFlash = 0;
  let equipped: DamageWeapon = 'pistol', normalSpace = false, aimMoved = false, laserLife = 0;
  const aimNdc = new THREE.Vector2(0.25, 0), aimPoint = new THREE.Vector3(), aimRay = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -DEPTH);
  const renderedCamera = camera.clone();
  const sharkCameraStart = new THREE.Vector3(), sharkCameraRotation = new THREE.Quaternion();
  let loadedCount = 0, assetError = '', deathReason = '', checkpointNotice = 0;
  let orbHealth = ORB_HEALTH, scramblerDeathGlow = -1, deathRetroStrength = 0;
  let bossTime = 0, bossStage: 'charge' | 'attack' | 'open' | 'recover' = 'charge', bossVolley = 0, burstShots = 0;
  const actors: Actor[] = [], templates: THREE.Group[] = [];
  let boss: Actor | null = null, gun: THREE.Group | null = null;
  let character: Awaited<ReturnType<typeof loadCharacter>> = null;
  const defeated = new Set(saved.defeatedRobots);
  const scrambler = createJungleScrambler(scene), pulse = createJungleScramblerPulse();
  const orbStart = entryState?.scramblerPosition?.clone() ?? new THREE.Vector3(spawn.x, checkpoint.top + 5, DEPTH);
  scrambler.root.position.copy(orbStart);
  if (entryState?.scramblerQuaternion) scrambler.root.quaternion.copy(entryState.scramblerQuaternion);
  const focus = new THREE.Vector3(spawn.x - 3, checkpoint.top + 1.2, DEPTH);
  let scrollDistance = checkpoint.u + 3;
  const entryCamera = entryState?.cameraPosition?.clone(), entryRotation = entryState?.cameraQuaternion?.clone();
  const exitStart = new THREE.Vector3(), exitCamera = new THREE.Vector3(), exitRotation = new THREE.Quaternion();
  const deathCamera = new THREE.Vector3(), deathRotation = new THREE.Quaternion();
  const warpCamera = new THREE.Vector3(), warpRotation = new THREE.Quaternion();
  let exitFov = 75, exitYaw = 0, deathFov = 75;
  const up = new THREE.Vector3(0, 1, 0), ray = new THREE.Ray(), contact = new THREE.Vector3(), direction = new THREE.Vector3();
  const oldPoint = new THREE.Vector3(), nextPoint = new THREE.Vector3(), hitBounds = new THREE.Box3();
  const shotGeometry = new THREE.SphereGeometry(0.09, 8, 6);
  const friendlyMaterial = new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.85, depthWrite: false });
  const hostileMaterial = new THREE.MeshBasicMaterial({ color: 0xff6850 });
  const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), friendlyMaterial);
  laser.name = 'PlatformLaserBeam'; laser.visible = false; scene.add(laser);
  const shots = Array.from({ length: 48 }, () => {
    const mesh = new THREE.Mesh(shotGeometry, hostileMaterial); mesh.visible = false; scene.add(mesh);
    return { mesh, life: 0, wave: false, velocity: new THREE.Vector3(), parried: false, owner: 'boss' as 'boss' | 'player' };
  });
  const sharks: RiverShark[] = [];
  let sharkTemplate: THREE.Group | null = null, sharkAnimations: THREE.AnimationClip[] = [], sharksReady = false;
  let bitingShark: RiverShark | null = null;
  const sharkReady = loadShark().then(asset => {
    if (disposed) { releaseAsset(asset.scene); sharksReady = true; return; }
    asset.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(asset.scene), size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
      || Math.max(size.x, size.y, size.z) <= 0) {
      releaseAsset(asset.scene); sharksReady = true; throw new Error('Shark model has invalid geometry');
    }
    const center = bounds.getCenter(new THREE.Vector3()), scale = 4.4 / Math.max(size.x, size.z);
    asset.scene.scale.setScalar(scale);
    asset.scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    asset.scene.updateMatrixWorld(true); sharkTemplate = asset.scene; sharkAnimations = asset.animations;
    const placements = [
      { u: 8, side: -1 }, { u: 18, side: 1 }, { u: 36, side: -1 },
      { u: 48, side: 1 }, { u: 67, side: -1 }, { u: 84, side: 1 }, { u: 97, side: -1 },
    ];
    for (const [index, placement] of placements.entries()) {
      const model = clone(sharkTemplate), root = new THREE.Group();
      root.name = `RiverShark-${index}`; root.add(model);
      // Deterministic per-individual variety so the shoal is not a row of clones.
      const scale = 0.86 + ((index * 37) % 10) / 10 * 0.28;
      const swimRate = 0.82 + ((index * 53) % 10) / 10 * 0.3;
      const baseYaw = placement.side > 0 ? Math.PI : 0;
      root.scale.setScalar(scale);
      const baseY = RESCUE_SITE.riverY - 0.62, baseZ = RESCUE_SITE.riverZ + placement.side * 5.2;
      root.position.set(courseX(placement.u), baseY, baseZ);
      root.rotation.y = baseYaw;
      root.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root), swim = sharkAnimations[0];
      if (swim) mixer.clipAction(swim).setLoop(THREE.LoopRepeat, Infinity).play();
      sharks.push({ root, mixer, baseY, baseZ, side: placement.side, phase: index * 1.7, baseYaw, swimRate, scale });
    }
    sharksReady = true;
  }).catch(error => {
    if (!disposed) console.warn('[Scene 18] Could not load river sharks:', error);
    sharksReady = true;
  });
  const impactMaterial = new THREE.MeshBasicMaterial({ color: 0xa9ffd0, transparent: true, opacity: 0, depthWrite: false });
  const impact = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), impactMaterial); impact.visible = false; scene.add(impact);
  let impactTime = 0;
  const bossShieldMaterial = new THREE.MeshBasicMaterial({ color: 0x79ffac, transparent: true, opacity: 0.17, depthWrite: false });
  const bossShield = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), bossShieldMaterial); bossShield.visible = false; scene.add(bossShield);
  const warningMaterial = new THREE.MeshBasicMaterial({ color: 0xffa057, transparent: true, opacity: 0.5, depthWrite: false });
  const warning = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), warningMaterial); warning.visible = false; scene.add(warning);
  const hud = document.createElement('div'); hud.className = 'platformer-hud';
  const hudText = document.createElement('div');
  const healthTrack = document.createElement('div'); healthTrack.className = 'platformer-health-track';
  healthTrack.setAttribute('role', 'progressbar'); healthTrack.setAttribute('aria-valuemin', '0');
  const healthFill = document.createElement('div'); healthFill.className = 'platformer-health-fill';
  healthTrack.append(healthFill); hud.append(hudText, healthTrack);
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'platformer-retry hidden'; retry.textContent = 'RETRY CHECKPOINT';
  const reticle = document.createElement('div'); reticle.className = 'platformer-crosshair hidden'; reticle.setAttribute('aria-hidden', 'true');
  document.body.append(hud, retry, reticle); document.body.classList.add('jungle-platformer', 'jungle-platformer-side');
  const caption = document.getElementById('space-cinematic-caption');
  document.getElementById('loading-bay-status')?.classList.add('hidden');
  scene.onBeforeRender = (_renderer, _scene, viewCamera) => site.updateVisibility(viewCamera, player.body.position);

  function blocked() { return disposed || paused || document.hidden || document.body.classList.contains('quick-menu-open'); }
  function armedPhase() { return phase === 'traversal' || phase === 'scrambler' || phase === 'boss' || phase === 'cleared'; }
  function live() { return !blocked() && armedPhase() && player.getHealth() > 0; }
  function clearInput() { firing = shotRequested = touchFiring = pendingShot = false; player.clearInput(); resetTouchInput(); }
  function freeze() {
    clearInput(); player.disable(); player.body.velocity.set(0, 0, 0); player.body.force.set(0, 0, 0);
    player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties();
  }
  function clearShots() { for (const shot of shots) { shot.life = 0; shot.mesh.visible = false; shot.parried = false; shot.owner = 'boss'; } warning.visible = laser.visible = false; laserLife = 0; }
  function checkpointState(): RescueArrival {
    return { ...entryState, platformProgress: copyProgress(saved), scramblerPosition: undefined, scramblerQuaternion: undefined,
      cameraPosition: undefined, cameraQuaternion: undefined, cameraFov: undefined,
      pilotState: { ...player.captureTransition({ x: 0, y: 0, z: 0 }), health: PLAYER_MAX_HEALTH, heldKeys: [], blockedKeys: [] } };
  }
  function restart() {
    if (blocked() || transferred || (!assetError && phase !== 'death')) return;
    transferred = true; clearInput(); onRespawn(checkpointState());
  }
  const retryClick = () => restart(); retry.addEventListener('click', retryClick);
  const keyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyR' && !event.repeat && (assetError || phase === 'death')) restart();
    if (!live() || event.repeat || (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]'))) return;
    if (event.code === 'KeyK' || event.code === 'KeyT') {
      event.preventDefault(); equipped = event.code === 'KeyT' ? 'crowbar' : 'pistol';
      firing = shotRequested = pendingShot = false; touchFiring = isTouchFire(); fireCooldown = 0.2;
    }
  };
  function moveReticle(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    aimNdc.x = THREE.MathUtils.clamp(aimNdc.x + dx * 2 / window.innerWidth, -0.96, 0.96);
    aimNdc.y = THREE.MathUtils.clamp(aimNdc.y - dy * 2 / window.innerHeight, -0.96, 0.96);
    aimMoved = true;
  }
  const mouseMove = (event: MouseEvent) => {
    if (!live() || normalSpace || (event.target instanceof HTMLElement && event.target.closest('button, input, dialog'))) return;
    if (document.pointerLockElement) moveReticle(event.movementX, event.movementY);
    else if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      aimNdc.set(0, 0); moveReticle(event.clientX - window.innerWidth / 2, event.clientY - window.innerHeight / 2);
    }
  };
  const mouseDown = (event: MouseEvent) => {
    if (event.button === 0 && live() && (event.target instanceof HTMLCanvasElement || document.pointerLockElement) &&
      !(event.target instanceof HTMLElement && event.target.closest('button, input, dialog'))) {
      if (!firing && equipped === 'pistol' && fireCooldown <= 0) shotRequested = true;
      firing = true;
    }
  };
  const mouseUp = (event: MouseEvent) => { if (event.button === 0) firing = false; };
  const blur = () => { paused = true; clearInput(); }, focusWindow = () => { paused = false; };
  const visibility = () => { if (document.hidden) clearInput(); };
  const unlock = () => { if (!document.pointerLockElement) clearInput(); };
  window.addEventListener('keydown', keyDown); window.addEventListener('mousedown', mouseDown); window.addEventListener('mouseup', mouseUp);
  window.addEventListener('mousemove', mouseMove);
  window.addEventListener('blur', blur); window.addEventListener('focus', focusWindow);
  document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerlockchange', unlock);

  function releaseAsset(root: THREE.Group) {
    root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
    disposeRoom(root as unknown as THREE.Scene);
  }
  function animate(actor: Actor, name: string, once = false) {
    if (actor.animation === name) return;
    const clip = actor.clips.find(item => item.name === name) ?? actor.clips.find(item => item.name === 'Idle');
    if (!clip) return;
    actor.mixer.stopAllAction(); actor.animation = name;
    const action = actor.mixer.clipAction(clip).reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once; action.play();
  }
  function makeActor(template: THREE.Group, clips: THREE.AnimationClip[], id: string, from: number, to: number, top: number, big = false) {
    const root = new THREE.Group(), model = clone(template); root.name = `Platform-${id}`; root.add(model); scene.add(root);
    const radius = big ? 0.95 : 0.4;
    const body = new CANNON.Body({ mass: big ? 50 : 12, shape: new CANNON.Sphere(radius), fixedRotation: true, allowSleep: false, linearDamping: 0,
      collisionFilterGroup: 2, collisionFilterMask: 1, material: new CANNON.Material({ friction: 0, restitution: 0 }) });
    body.position.set(courseX((from + to) / 2), top + radius, DEPTH); body.linearFactor.set(1, 1, 0); physicsWorld.addBody(body);
    root.position.set(body.position.x, top, DEPTH);
    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffa057 }));
    signal.position.set(0, big ? 3.3 : 1.5, -0.45); signal.visible = false; root.add(signal);
    const actor: Actor = { id, root, body, motor: createGroundMotor(body, radius), mixer: new THREE.AnimationMixer(model), clips, animation: '',
      health: big ? BOSS_HEALTH : defeated.has(id) ? 0 : 75, boss: big, from, to, direction: 1,
      cooldown: 0.8, charge: -1, deathTime: 0, hitTime: 0, aim: new THREE.Vector3(), signal };
    if (!actor.health) { root.visible = false; physicsWorld.removeBody(body); }
    else animate(actor, 'Idle');
    actors.push(actor); return actor;
  }
  function loadActors(big: boolean) {
    const name = 'Enemy_QuadShell';
    return loadModel(name).then(asset => {
      if (disposed) { releaseAsset(asset.scene); return; }
      const template = new THREE.Group(); template.add(asset.scene); template.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(template), height = bounds.getSize(new THREE.Vector3()).y;
      if (!Number.isFinite(height) || height <= 0) { releaseAsset(template); throw new Error(`${name} has empty geometry`); }
      template.scale.setScalar((big ? 3.6 : 1.65) / height); bounds.setFromObject(template);
      const center = bounds.getCenter(new THREE.Vector3()); template.position.set(-center.x, -bounds.min.y, -center.z);
      template.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
      if (big) boss = makeActor(template, asset.animations, 'warden', 100, 106, 1.3, true);
      else for (const placement of COURSE_ROBOTS) {
        const floatingPlatform: Record<string, { from: number; to: number; top: number }> = {
          step1: { from: 10, to: 14, top: 0.8 },
          step2: { from: 15, to: 18, top: 1.95 },
        };
        const platform = floatingPlatform[placement.platform] ?? COURSE_PLATFORMS.find(item => item.id === placement.platform)!;
        makeActor(template, asset.animations, placement.id, platform.from + 1, platform.to - 1, platform.top);
      }
      template.visible = false; templates.push(template); scene.add(template); loadedCount++;
    }).catch(error => { if (!disposed) { assetError = `${name} could not load`; console.error('[Platformer]', error); } });
  }
  const robotReady = loadActors(false), bossReady = loadActors(true);
  const gunReady = loadModel('Gun_Revolver').then(asset => {
    if (disposed) { releaseAsset(asset.scene); return; }
    const bounds = new THREE.Box3().setFromObject(asset.scene);
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
      releaseAsset(asset.scene); throw new Error('Pistol has empty geometry');
    }
    gun = asset.scene; gun.rotation.y = -Math.PI / 2; scene.add(gun); gun.visible = false; loadedCount++;
  }).catch(error => { if (!disposed) { assetError = 'Pistol could not load'; console.error('[Platformer]', error); } });

  function burst(point: THREE.Vector3) { impact.position.copy(point); impact.visible = true; impactTime = 0.22; }
  function retroConsoleStrength() {
    if (phase === 'death' || phase === 'sharkAttack') return deathRetroStrength;
    if (phase === 'entry') return THREE.MathUtils.clamp(phaseTime / 0.35, 0, 1);
    if (phase === 'traversal') return 1;
    if (phase !== 'scrambler') return 0;
    if (orbHealth > 0) return 1;
    return scramblerDeathGlow >= 0 ? 1 - THREE.MathUtils.smootherstep(scramblerDeathGlow, 0, 1.2) : 0;
  }
  function die(reason: string) {
    if (phase === 'death' || phase === 'done' || phase === 'exit' || phase === 'entry') return;
    deathRetroStrength = retroConsoleStrength();
    deathCamera.copy(renderedCamera.position); deathRotation.copy(renderedCamera.quaternion); deathFov = renderedCamera.fov;
    phase = 'death'; phaseTime = 0; deathReason = reason; clearShots(); freeze();
  }
  function startSharkAttack() {
    if (phase === 'sharkAttack' || phase === 'death') return;
    if (!sharks.length) { die('SWEPT AWAY BY THE RIVER'); return; }
    bitingShark = sharks.reduce((nearest, shark) =>
      shark.root.position.distanceToSquared(player.body.position) < nearest.root.position.distanceToSquared(player.body.position) ? shark : nearest);
    deathRetroStrength = retroConsoleStrength();
    sharkCameraStart.copy(renderedCamera.position); sharkCameraRotation.copy(renderedCamera.quaternion);
    player.takeDamage(player.getHealth()); freeze(); phase = 'sharkAttack'; phaseTime = 0;
  }
  function updateSharks(dt: number) {
    for (const shark of sharks) {
      const attacking = phase === 'sharkAttack' && shark === bitingShark;
      shark.mixer.update(dt * (attacking ? 1.8 : shark.swimRate));
      if (!attacking) {
        const bob = elapsed * 1.8 + shark.phase;
        const steer = elapsed * 0.5 + shark.phase;
        shark.root.position.y = shark.baseY + Math.sin(bob) * 0.05;
        shark.root.rotation.y = shark.baseYaw + Math.sin(steer) * 0.12;
        shark.root.rotation.z = Math.cos(steer) * 0.06;
        shark.root.rotation.x = Math.sin(bob * 0.9) * 0.035;
        continue;
      }
      const lunge = smooth(phaseTime, 0, 0.28), recoil = smooth(phaseTime, 0.52, 0.82);
      const approach = lunge * (1 - recoil * 0.2);
      shark.root.position.z = THREE.MathUtils.lerp(shark.baseZ, DEPTH, approach);
      shark.root.position.y = shark.baseY + approach * 1.15;
      shark.root.rotation.y = shark.baseYaw;
      shark.root.rotation.z = 0;
      shark.root.rotation.x = -shark.side * approach * 0.14;
    }
  }
  function hurt(amount: number) {
    if (!live() || invulnerability > 0) return;
    player.takeDamage(amount); invulnerability = 0.65; damageFlash = 0.65;
    if (player.getHealth() <= 0) die('HIT BY FACILITY DEFENSES');
  }
  function defeatBoss() {
    bossVictory = true;
    phase = 'cleared'; phaseTime = 0; clearShots(); bossShield.visible = false;
    for (const actor of actors) if (!actor.boss) { actor.body.velocity.set(0, 0, 0); actor.charge = -1; }
  }
  function damageActor(actor: Actor, amount: number, weapon?: DamageWeapon) {
    if (!live() || (weapon !== 'pistol' && weapon !== 'crowbar') || !Number.isFinite(amount) || amount <= 0 || actor.health <= 0) return false;
    if (actor.boss && (weapon !== 'pistol' || phase !== 'boss' || orbHealth > 0 || bossStage !== 'open')) return false;
    actor.health = Math.max(0, actor.health - amount); actor.hitTime = 0.25;
    emitComicEffect(scene, actor.health === 0 ? 'clank' : 'hit', { source: actor.root, weapon });
    if (!actor.boss) { actor.charge = -1; actor.cooldown = 1.2; }
    burst(actor.root.position.clone().add(new THREE.Vector3(0, 1, 0)));
    if (!actor.health) {
      actor.body.velocity.set(0, 0, 0); actor.body.type = CANNON.Body.KINEMATIC; actor.body.collisionResponse = false; actor.body.updateMassProperties();
      animate(actor, 'TurnOff', true); defeated.add(actor.id);
      if (actor.boss) defeatBoss();
    }
    return true;
  }
  function damageOrb(amount: number, weapon?: DamageWeapon) {
    if (!live() || phase !== 'scrambler' || courseDistance(player.body.position.x) < 94 || phaseTime < 1 || orbHealth <= 0 || weapon !== 'pistol' || !Number.isFinite(amount) || amount <= 0) return false;
    orbHealth = Math.max(0, orbHealth - amount); burst(scrambler.root.position);
    emitComicEffect(scene, orbHealth === 0 ? 'boom' : 'hit', { source: scrambler.root, weapon });
    if (!orbHealth) { scramblerDeathGlow = 0; scrambler.root.visible = false; bossShield.visible = false; clearShots(); clearInput(); invulnerability = 2; }
    return true;
  }
  function damageTargets(): DamageTarget[] {
    if (!live()) return [];
    return [
      ...actors.filter(actor => actor.health > 0 && actor.root.visible).map(actor => ({ root: actor.root, body: actor.body, damage: (amount: number, weapon?: DamageWeapon) => damageActor(actor, amount, weapon) })),
      ...course.relays.filter(relay => !relay.activated).map(relay => ({ root: relay.root, damage: (amount: number, weapon?: DamageWeapon) => {
        if (!live() || weapon !== 'pistol') return false;
        const hit = course.damageRelay(relay.id, amount); if (hit) burst(relay.root.position); return hit;
      } })),
      { root: scrambler.root, damage: damageOrb },
    ];
  }
  function fire(from: THREE.Vector3, to: THREE.Vector3, wave = false, source?: THREE.Object3D) {
    const shot = shots.find(item => item.life <= 0); if (!shot) return;
    emitComicEffect(scene, 'pew', { source, position: from, size: 1.5 });
    shot.life = 2.5; shot.wave = wave;
    shot.parried = false; shot.owner = 'boss';
    shot.mesh.position.copy(from); shot.mesh.scale.set(wave ? 3 : 1, wave ? 2.2 : 1, wave ? 6 : 1);
    shot.velocity.copy(to).sub(from);
    if (!normalSpace) shot.velocity.z = 0;
    shot.velocity.normalize().multiplyScalar(wave ? 9 : 13); shot.mesh.visible = true;
  }
  function drawWarning(from: THREE.Vector3, to: THREE.Vector3) {
    direction.copy(to).sub(from); warning.position.copy(from).addScaledVector(direction, 0.5);
    warning.scale.y = direction.length(); warning.quaternion.setFromUnitVectors(up, direction.normalize()); warning.visible = true;
  }
  function updateBoss(dt: number) {
    if (!boss || boss.health <= 0 || (phase !== 'boss' && (phase !== 'scrambler' || orbHealth === 0))) return;
    bossTime += dt;
    const p = new THREE.Vector3().copy(player.body.position).add(new THREE.Vector3(0, 0.7, 0));
    const muzzle = boss.root.position.clone().add(new THREE.Vector3(0, bossVolley % 2 ? 1.25 : 0.22, 0));
    boss.root.rotation.y = Math.atan2(p.x - boss.root.position.x, p.z - boss.root.position.z);
    if (Math.hypot(player.body.position.x - boss.body.position.x, player.body.position.z - boss.body.position.z) < 1.2 && player.body.position.y < boss.root.position.y + 2) hurt(10);
    if (bossStage === 'charge') {
      boss.motor.drive(0, 0, 0); animate(boss, 'Charge');
      if (bossTime < 0.8) boss.aim.copy(p);
      const target = bossVolley % 2 ? boss.aim : new THREE.Vector3(p.x, 1.52, p.z);
      drawWarning(muzzle, target);
      if (bossTime >= 1.2) { bossStage = 'attack'; bossTime = 0; burstShots = 0; warning.visible = false; animate(boss, 'Attack', true); }
    } else if (bossStage === 'attack') {
      if (bossVolley % 2) {
        if (burstShots < 3 && bossTime >= burstShots * 0.2) { fire(muzzle, boss.aim, false, boss.root); burstShots++; }
      } else if (!burstShots) {
        const forward = new THREE.Vector3(p.x - muzzle.x, 0, p.z - muzzle.z).normalize();
        for (const angle of normalSpace ? [-0.4, 0, 0.4] : [0]) {
          fire(muzzle, muzzle.clone().add(forward.clone().applyAxisAngle(up, angle)), true, boss.root);
        }
        burstShots++;
      }
      if (bossTime >= 0.65) { bossStage = 'open'; bossTime = 0; }
    } else if (bossStage === 'open') {
      animate(boss, 'Idle'); boss.motor.drive(0, 0, 0);
      if (bossTime >= 2) { bossStage = 'recover'; bossTime = 0; }
    } else {
      const u = courseDistance(boss.body.position.x);
      if (u >= 104.5) boss.direction = -1; if (u <= 101) boss.direction = 1;
      const z = boss.body.position.z;
      const strafe = normalSpace ? (z < 12 ? 1 : z > 22 ? -1 : Math.sign(p.z - z)) : 0;
      boss.motor.drive(-boss.direction, strafe, 0.8); animate(boss, 'Walk');
      if (bossTime >= 1) { bossStage = 'charge'; bossTime = 0; bossVolley++; }
    }
  }
  function updateActors(dt: number) {
    const p = new THREE.Vector3().copy(player.body.position);
    for (const actor of actors) {
      if (actor.health <= 0) continue;
      actor.hitTime = Math.max(0, actor.hitTime - dt);
      if (actor.boss) { if (phase !== 'boss' && phase !== 'scrambler') actor.motor.drive(0, 0, 0); continue; }
      const distance = Math.abs(actor.body.position.x - p.x), u = courseDistance(actor.body.position.x);
      const halfView = Math.max(16, 10 / Math.max(0.25, camera.aspect)) * Math.tan(25 * Math.PI / 180) * camera.aspect;
      if (normalSpace || distance > 17 || Math.abs(actor.body.position.x - focus.x) > halfView - 1) {
        actor.motor.drive(0, 0, 0); actor.charge = -1; animate(actor, 'Idle'); continue;
      }
      if (actor.hitTime > 0) { actor.motor.drive(0, 0, 0); animate(actor, 'Hit', true); continue; }
      actor.cooldown -= dt;
      if (actor.charge >= 0) {
        actor.motor.drive(0, 0, 0); actor.charge -= dt;
        actor.root.rotation.y = actor.aim.x < actor.root.position.x ? -Math.PI / 2 : Math.PI / 2;
        if (actor.charge <= 0) {
          fire(actor.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)), actor.aim, false, actor.root);
          actor.charge = -1; actor.cooldown = 1.6; animate(actor, 'Attack', true);
        }
      } else if (distance < 11 && actor.cooldown <= 0) {
        actor.charge = 0.45; actor.aim.copy(p).add(new THREE.Vector3(0, 0.8, 0)); animate(actor, 'Charge');
      } else {
        if (u >= actor.to) actor.direction = -1; if (u <= actor.from) actor.direction = 1;
        actor.motor.drive(-actor.direction, 0, 1.15); actor.root.rotation.y = actor.direction > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (actor.cooldown < 2.3) animate(actor, 'Walk');
      }
      if (distance < 0.7 && Math.abs(actor.body.position.y - p.y) < 1.2) hurt(10);
    }
    updateBoss(dt);
  }
  function intersectionDistance(bounds: THREE.Box3, travel: number) {
    if (bounds.containsPoint(oldPoint)) return 0;
    const point = ray.intersectBox(bounds, contact); if (!point) return Infinity;
    const distance = oldPoint.distanceTo(point); return distance <= travel ? distance : Infinity;
  }
  function updateShots(dt: number) {
    const parryBounds = new THREE.Box3();
    for (const shot of shots) {
      if (shot.life <= 0) continue;
      oldPoint.copy(shot.mesh.position); nextPoint.copy(oldPoint).addScaledVector(shot.velocity, dt);
      const travel = oldPoint.distanceTo(nextPoint); ray.set(oldPoint, direction.copy(shot.velocity).normalize());
      let nearest = Infinity, hit: (() => void) | null = null;
      const consider = (bounds: THREE.Box3, action: () => void) => {
        const distance = intersectionDistance(bounds, travel);
        if (distance < nearest) { nearest = distance; hit = action; }
      };
      if (shot.parried && shot.owner === 'player') {
        for (const actor of actors) {
          if (actor.health <= 0 || !actor.root.visible) continue;
          const centre = actor.body.position;
          parryBounds.setFromCenterAndSize(
            new THREE.Vector3(centre.x, centre.y + (actor.boss ? 1.1 : 0.6), centre.z),
            new THREE.Vector3(actor.boss ? 2.4 : 1.2, actor.boss ? 2.4 : 1.6, actor.boss ? 2.4 : 1.2));
          if (shot.wave) parryBounds.expandByScalar(0.2);
          consider(parryBounds, () => damageActor(actor, PARRY_DAMAGE, 'pistol'));
        }
      } else {
        const p = player.body.position;
        hitBounds.min.set(p.x - 0.32, p.y - player.radius, p.z - 0.4);
        hitBounds.max.set(p.x + 0.32, p.y - player.radius + (player.getState().crouching ? 0.85 : 1.65), p.z + 0.4);
        if (shot.wave) hitBounds.expandByScalar(0.15);
        consider(hitBounds, () => hurt(shot.wave ? 20 : 12));
      }
      physicsWorld.raycastAll(new CANNON.Vec3(oldPoint.x, oldPoint.y, oldPoint.z), new CANNON.Vec3(nextPoint.x, nextPoint.y, nextPoint.z),
        { skipBackfaces: false, checkCollisionResponse: true }, result => {
          if (result.body?.type === CANNON.Body.STATIC && result.distance <= nearest) { nearest = result.distance; hit = null; }
        });
      shot.mesh.position.copy(nextPoint); shot.life -= dt;
      if (nearest !== Infinity) { const action = hit as (() => void) | null; action?.(); shot.life = 0; }
      shot.mesh.visible = shot.life > 0;
      if (!live()) break;
    }
  }
  function ignoredWeapons() {
    return [laser, warning, impact, bossShield, ...shots.map(shot => shot.mesh),
      ...(character ? [character.model] : []), ...(gun ? [gun] : [])];
  }
  function prepareAim() {
    if (!normalSpace) {
      if (!aimMoved) {
        const state = player.getState(), sign = state.yaw > 0 ? -1 : 1;
        aimPoint.set(player.body.position.x + sign * 8, player.body.position.y - player.radius + (state.crouching ? 0.65 : 1.25), DEPTH);
        const screen = aimPoint.clone().project(renderedCamera); aimNdc.set(screen.x, screen.y);
      }
      aimRay.setFromCamera(aimNdc, renderedCamera); aimRay.ray.intersectPlane(aimPlane, aimPoint);
    } else {
      aimRay.setFromCamera(new THREE.Vector2(), renderedCamera);
      aimPoint.copy(traceShot(scene, physicsWorld, aimRay.ray, damageTargets(), ignoredWeapons(), 65).point);
    }
  }
  function useWeapon() {
    prepareAim();
    const state = player.getState();
    const from = new THREE.Vector3(player.body.position.x, player.body.position.y - player.radius + (state.crouching ? 0.65 : 1.25), player.body.position.z);
    const aimDirection = aimPoint.clone().sub(from).normalize();
    if (equipped === 'crowbar') {
      if (!player.requestAction('Sword_Attack')) return;
      const strike = traceShot(scene, physicsWorld, new THREE.Ray(from, aimDirection), damageTargets(), ignoredWeapons(), 1.8);
      strike.target?.damage(35, 'crowbar'); fireCooldown = 0.28;
      return;
    }
    // Use the ordinary gun's red hitscan beam, including the physical-muzzle cover check.
    if (character?.weapon.socket && gun?.visible) {
      character.model.updateMatrixWorld(true);
      from.copy(character.weapon.socket.localToWorld(new THREE.Vector3(0, 0.12, -0.38)));
    }
    const offset = aimPoint.clone().sub(from);
    const shot = traceShot(scene, physicsWorld, new THREE.Ray(from, offset.clone().normalize()), damageTargets(), ignoredWeapons(), normalSpace ? Math.min(65, offset.length() + 0.05) : 65);
    const hit = shot.target?.damage(25, 'pistol') ?? false;
    offset.copy(shot.point).sub(from); laser.position.copy(from).addScaledVector(offset, 0.5);
    laser.scale.y = Math.max(0.01, offset.length()); laser.quaternion.setFromUnitVectors(up, offset.normalize());
    laser.visible = true; laserLife = 0.08; reticle.dataset.hit = String(hit);
    fireCooldown = 0.2; pendingShot = true;
  }
  function combatStep(dt: number) {
    if (!live()) return;
    invulnerability = Math.max(0, invulnerability - dt); fireCooldown = Math.max(0, fireCooldown - dt);
    if (!normalSpace) {
      if (!aimMoved) prepareAim();
      const offset = aimPoint.clone().sub(new THREE.Vector3(player.body.position.x, player.body.position.y - player.radius + (player.getState().crouching ? 0.65 : 1.25), DEPTH));
      player.setRotation(offset.x < 0 ? Math.PI / 2 : -Math.PI / 2, Math.atan2(offset.y, Math.abs(offset.x)));
    }
    if (phase === 'traversal') {
      const halfView = Math.max(16, 10 / Math.max(0.25, camera.aspect)) * Math.tan(25 * Math.PI / 180) * camera.aspect;
      if (courseDistance(player.body.position.x) > scrollDistance + halfView - 2) player.body.velocity.x = Math.max(0, player.body.velocity.x);
    }
    const touchHeld = isTouchFire();
    if (touchHeld && !touchFiring && equipped === 'pistol' && fireCooldown <= 0) shotRequested = true;
    touchFiring = touchHeld;
    if ((equipped === 'crowbar' ? firing || touchHeld : shotRequested) && fireCooldown <= 0) useWeapon();
    shotRequested = false;
    updateActors(dt); if (live()) updateShots(dt);
  }
  const unregister = registerPhysicsActor(physicsWorld, { body: player.body, beforePhysicsStep: combatStep, afterPhysicsStep() {
    for (const actor of actors) if (actor.body.world) {
      const radius = actor.boss ? 0.95 : 0.4;
      if (!actor.boss || !normalSpace) { actor.body.position.z = DEPTH; actor.body.velocity.z = 0; }
      if (actor.health > 0) actor.motor.readSupport();
      actor.root.position.set(actor.body.position.x, actor.body.position.y - radius, actor.body.position.z);
    }
  } });
  function saveCheckpoint(id: PlatformCheckpoint) {
    if (saved.checkpoint === id) return;
    saved = { checkpoint: id, activatedRelays: course.getActivated(), defeatedRobots: [...defeated].filter(id => id !== 'warden') };
    checkpointNotice = 2.5; clearInput(); clearShots(); invulnerability = 1;
  }
  function beginWarp() {
    cameraView(); warpCamera.copy(camera.position); warpRotation.copy(camera.quaternion);
    phase = 'warp'; phaseTime = 0; clearShots(); freeze(); normalSpace = true;
    player.setSideScrollDepth(null); player.setInputLocked(true);
    const target = boss?.body.position;
    player.setRotation(target ? Math.atan2(player.body.position.x - target.x, player.body.position.z - target.z) : Math.PI / 2);
    player.enable();
    if (boss) boss.body.linearFactor.set(1, 1, 1);
    document.body.classList.remove('jungle-platformer-side');
  }
  function beginExit() {
    camera.copy(renderedCamera);
    phase = 'exit'; phaseTime = 0; exitStart.copy(player.body.position); exitCamera.copy(camera.position); exitRotation.copy(camera.quaternion);
    exitFov = camera.fov; exitYaw = player.getState().yaw;
    clearShots(); freeze(); player.setSideScrollDepth(null);
  }
  function cameraView() {
    if (phase === 'death') {
      const playerPosition = player.body.position, target = new THREE.Vector3(playerPosition.x, playerPosition.y + 0.6, playerPosition.z);
      const yaw = player.getState().yaw;
      const destination = normalSpace ? target.clone().add(new THREE.Vector3(Math.sin(yaw) * 7, 2.8, Math.cos(yaw) * 7))
        : target.clone().add(new THREE.Vector3(0, 3.7, -Math.max(23, 14 / Math.max(0.25, camera.aspect)) - 7));
      const reveal = smooth(phaseTime, 0, 1.5), view = camera.clone();
      view.position.copy(destination); view.lookAt(target);
      camera.position.lerpVectors(deathCamera, destination, reveal);
      camera.quaternion.slerpQuaternions(deathRotation, view.quaternion, reveal);
      camera.fov = THREE.MathUtils.lerp(deathFov, 78, reveal);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); renderedCamera.copy(camera);
      return;
    }
    if (phase === 'sharkAttack' && bitingShark) {
      const target = new THREE.Vector3(player.body.position.x, RESCUE_SITE.riverY + 0.2, DEPTH);
      const closePosition = new THREE.Vector3((bitingShark.root.position.x + target.x) / 2 + 2.2,
        RESCUE_SITE.riverY + 2.8, DEPTH - 6.5);
      const view = camera.clone(); view.position.copy(closePosition); view.lookAt(target);
      const blend = smooth(phaseTime, 0, 0.32);
      camera.position.lerpVectors(sharkCameraStart, closePosition, blend);
      camera.quaternion.slerpQuaternions(sharkCameraRotation, view.quaternion, blend);
      camera.fov = THREE.MathUtils.lerp(50, 43, blend);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); renderedCamera.copy(camera);
      return;
    }
    if (normalSpace && phase !== 'exit' && phase !== 'done') {
      camera.position.copy(renderedCamera.position); camera.quaternion.copy(renderedCamera.quaternion); camera.fov = renderedCamera.fov;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); return;
    }
    const side = new THREE.Vector3(focus.x, focus.y + 3.7, DEPTH - Math.max(10, 14 / Math.max(0.25, camera.aspect)));
    camera.position.copy(side); camera.up.set(0, 1, 0); camera.lookAt(focus); camera.fov = 50;
    if (phase === 'entry' && entryCamera && entryRotation) {
      const t = smooth(phaseTime, 0, 1.2), rotation = camera.quaternion.clone();
      camera.position.lerpVectors(entryCamera, side, t); camera.quaternion.slerpQuaternions(entryRotation, rotation, t);
      camera.fov = THREE.MathUtils.lerp(entryState?.cameraFov ?? 50, 50, t);
    } else if (phase === 'exit' || (phase === 'done' && orbHealth === 0)) {
      const t = smooth(phaseTime, 0, 3.8);
      camera.position.lerpVectors(exitCamera, new THREE.Vector3(RESCUE_SITE.downstream.x + 0.7, 1.9, RESCUE_SITE.downstream.z), t);
      camera.quaternion.slerpQuaternions(exitRotation, new THREE.Quaternion(), t); camera.fov = THREE.MathUtils.lerp(exitFov, 75, t);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); renderedCamera.copy(camera);
  }
  function applyEntryCamera() {
    if (!normalSpace) return;
    camera.fov = 75;
    if (phase === 'warp') {
      const t = smooth(phaseTime, 0, 2.4), end = camera.position.clone(), rotation = camera.quaternion.clone();
      camera.position.lerpVectors(warpCamera, end, t); camera.quaternion.slerpQuaternions(warpRotation, rotation, t);
      camera.fov = THREE.MathUtils.lerp(50, 75, t);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); renderedCamera.copy(camera);
  }
  function updateHud() {
    hudText.textContent = phase === 'boss' ? 'BRIDGE WARDEN' : phase === 'scrambler' ? 'SCRAMBLER' : '';
    reticle.classList.toggle('hidden', !live() || normalSpace);
    reticle.style.left = `${(aimNdc.x + 1) * 50}%`; reticle.style.top = `${(1 - aimNdc.y) * 50}%`;
    healthTrack.classList.toggle('hidden', phase !== 'boss' && phase !== 'scrambler');
    healthTrack.classList.toggle('exposed', phase === 'boss');
    const health = phase === 'scrambler' ? orbHealth : boss?.health ?? BOSS_HEALTH;
    const maximum = phase === 'scrambler' ? ORB_HEALTH : BOSS_HEALTH;
    healthTrack.setAttribute('aria-label', phase === 'scrambler' ? 'Scrambler health' : 'Bridge Warden health');
    healthTrack.setAttribute('aria-valuenow', String(health)); healthTrack.setAttribute('aria-valuemax', String(maximum));
    healthFill.style.width = `${health / maximum * 100}%`;
    hud.classList.toggle('hidden', (phase !== 'boss' && phase !== 'scrambler') || !!assetError);
    retry.classList.toggle('hidden', !assetError && phase !== 'death');
    const text = assetError ? `${assetError.toUpperCase()} / PRESS R OR RETRY CHECKPOINT`
      : phase === 'entry' ? loadedCount < 3 ? 'LOADING...' : ''
      : phase === 'sharkAttack' ? 'A SHARK HAULS YOU UNDER'
      : phase === 'death' ? `${deathReason} / RETURNING TO ${saved.checkpoint.toUpperCase()} CHECKPOINT`
      : phase === 'warp' ? ''
      : phase === 'exit' ? 'WARDEN DEFEATED / RETURN TO THE FACILITY' : '';
    if (caption) { caption.textContent = text; caption.classList.toggle('hidden', !text); }
  }
  cameraView(); updateHud();
  return {
    roomId: 'scene18', scene, camera, physics, physicsWorld, player, course, ready: Promise.all([site.ready, robotReady, bossReady, gunReady, sharkReady]), cutsceneManager: null,
    hasBossVictory: () => bossVictory,
    ownsWeaponInput: true, clearInput, isCinematic: () => phase !== 'boss' && phase !== 'cleared', getDamageFlash: () => damageFlash,
    controlsReady: () => live() && !blocked(),
    hasAimReticle: () => !reticle.classList.contains('hidden'),
    minimap: { radius: 35, floor: 0, openSky: true, prepare: site.prepareMinimap },
    isThirdPersonView: () => true,
    get forceThirdPerson() { return normalSpace; },
    getCinematicDelta: () => blocked() ? 0 : lastDelta,
    getCinematicState: () => normalSpace && (phase === 'warp' || phase === 'boss' || phase === 'cleared') ? null : player.getState(),
    getCinematicWeapon: () => armedPhase() ? equipped : null,
    getCinematicPose(): CinematicPose | null {
      if (phase === 'death') return { clip: 'Death01', time: phaseTime };
      if (phase === 'entry') return { clip: 'Idle_Loop', time: phaseTime, loop: true };
      if (phase === 'exit') return { clip: phaseTime < 1.6 ? 'Sprint_Loop' : 'Walk_Loop', time: phaseTime, loop: true };
      return null;
    },
    applyCinematicCamera: cameraView, applyEntryCamera,
    updateCinematicCharacter(value: Awaited<ReturnType<typeof loadCharacter>>) {
      character = value;
      if (gun && character?.weapon.socket && armedPhase() && equipped === 'pistol') {
        character.weapon.socket.add(gun); gun.position.set(0, 0.02, 0); gun.visible = true;
        if (pendingShot && !blocked()) { character.weapon.shoot(); pendingShot = false; }
      } else if (gun) { gun.removeFromParent(); scene.add(gun); gun.visible = false; }
    },
    getDamageTargets: damageTargets,
    getParryableBolts: (): ParryableBolt[] => live() ? shots.filter(shot => shot.life > 0) : [],
    getPlatformerStatus: () => ({ phase, phaseTime, checkpoint: saved.checkpoint, bossHealth: boss?.health ?? BOSS_HEALTH, bossStage,
      orbHealth, bossVolley, normalSpace, equipped, scrollDistance, scrollSpeed: phase === 'traversal' ? SCROLL_SPEED : 0,
      aim: aimNdc.toArray(), bossShielded: orbHealth > 0, loaded: loadedCount === 3 && sharksReady, assetError,
      activatedRelays: course.getActivated(), defeatedRobots: [...defeated],
      shots: { friendly: laserLife > 0 ? 1 : 0, hostile: shots.filter(shot => shot.life > 0).length } }),
    getRetroConsoleStrength: retroConsoleStrength,
    onPlayerDeath() { die('HIT BY FACILITY DEFENSES'); return true; },
    updatePhysics(dt: number) {
      lastDelta = 0;
      if (blocked()) { clearInput(); return; }
      if (transferred) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
      lastDelta = dt; elapsed += dt;
      laserLife = Math.max(0, laserLife - dt); laser.visible = laserLife > 0;
      damageFlash = Math.max(0, damageFlash - dt * 1.8); checkpointNotice = Math.max(0, checkpointNotice - dt);
      if (phase !== 'entry' || loadedCount === 3 && sharksReady) phaseTime += dt;
      site.update(dt);
      updateSharks(dt);
      if (phase === 'sharkAttack' && phaseTime >= 0.9) die('EATEN BY A SHARK');
      if (phase === 'entry') {
        if (!entryCamera) pulse.update(phaseTime - 0.15);
        if (loadedCount === 3 && sharksReady && !assetError && phaseTime >= 1.2) {
          phase = saved.checkpoint === 'boss' ? 'scrambler' : 'traversal'; phaseTime = 0; pulse.update(-1);
          player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.enable(); clearInput(); invulnerability = 1;
        }
      }
      if (phase === 'warp') {
        pulse.update(phaseTime, true);
        if (phaseTime >= 2.4) {
          phase = 'boss'; phaseTime = bossTime = 0; bossStage = 'charge'; bossVolley = burstShots = 0;
          player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.setInputLocked(false);
          clearInput(); invulnerability = 1; pulse.update(-1);
        }
      }
      if (phase === 'scrambler') {
        if (orbHealth === 0 && scramblerDeathGlow >= 0) {
          scramblerDeathGlow = Math.min(1.2, scramblerDeathGlow + dt);
          pulse.update(scramblerDeathGlow);
        }
      }
      if (live()) {
        if (!normalSpace) {
          const aim = consumePlatformerAim(); if (aim.dx || aim.dy) moveReticle(aim.dx, aim.dy);
          prepareAim();
        }
        physics.step(dt, player, true);
        const u = courseDistance(player.body.position.x);
        if (player.body.position.y < RESCUE_SITE.riverY + 0.4) startSharkAttack();
        else if (u < -2 || u > PLATFORM_COURSE.end + 0.3) die('MISSED THE PLATFORM');
        if (phase === 'traversal' && player.getState().isOnGround) {
          if (u >= 51 && u <= 58 && saved.checkpoint === 'bridge') saveCheckpoint('middle');
          if (u >= 91 && u <= 107) { saveCheckpoint('boss'); phase = 'scrambler'; phaseTime = 0; bossTime = 0; }
        }
        if (phase === 'scrambler' && orbHealth === 0 && scramblerDeathGlow >= 1.2 && player.getState().isOnGround && u >= 94 && u <= 107) beginWarp();
        if (phase === 'cleared' && player.getState().isOnGround && u >= 103.5 && u <= 104.5 && player.body.position.z >= 7 && player.body.position.z <= 11) beginExit();
        if (phase === 'traversal') {
          scrollDistance += SCROLL_SPEED * dt; focus.x = courseX(scrollDistance);
        } else if (phase === 'scrambler') focus.x = THREE.MathUtils.damp(focus.x, courseX(100.5), 2, dt);
        if (!normalSpace && player.getState().isOnGround) focus.y = THREE.MathUtils.damp(focus.y, player.body.position.y - player.radius + 1.2, 5, dt);
      }
      if (phase === 'death' && phaseTime >= 2.5) { restart(); return; }
      if (phase === 'exit') {
        const t = smooth(phaseTime, 0, 1.6), bank = smooth(phaseTime, 1.6, 3.8);
        const x = THREE.MathUtils.lerp(exitStart.x, RESCUE_SITE.downstream.x, t);
        const z = phaseTime < 1.6 ? THREE.MathUtils.lerp(exitStart.z, 9, t) : THREE.MathUtils.lerp(9, RESCUE_SITE.downstream.z, bank);
        const y = player.radius + 1.3 * THREE.MathUtils.clamp((z - RESCUE_SITE.downstream.z) / 5, 0, 1);
        player.setPosition(x, y, z); player.setRotation(THREE.MathUtils.lerp(exitYaw, 0, smooth(phaseTime, 0, 1.6)));
      }
      for (const actor of actors) {
        actor.signal.visible = actor.health > 0 && (actor.hitTime > 0 || (!actor.boss && actor.charge >= 0));
        actor.signal.material.color.setHex(actor.hitTime > 0 ? 0xa9ffd0 : 0xffa057);
        actor.signal.scale.setScalar(actor.hitTime > 0 ? 1.4 : 1 + Math.max(0, 0.85 - actor.charge) * 1.6);
        actor.mixer.update(dt);
        if (actor.health <= 0) {
          actor.deathTime += dt;
          if (actor.deathTime > 2) { actor.root.visible = false; if (actor.body.world) physicsWorld.removeBody(actor.body); }
        }
      }
      if (orbHealth > 0 && phase !== 'exit' && phase !== 'death') {
        const u = courseDistance(player.body.position.x), orbitX = courseX(Math.min(104, Math.max(checkpoint.u, u) + 12));
        const target = phase === 'entry' ? orbStart : new THREE.Vector3(phase === 'scrambler' ? courseX(100) : orbitX,
          6.2 + Math.sin(elapsed * 1.8) * 0.18, DEPTH);
        scrambler.root.position.lerp(target, 1 - Math.exp(-dt * 4));
        scrambler.update(dt, phase !== 'scrambler');
      }
      bossShield.visible = !!boss && boss.health > 0 && orbHealth > 0;
      if (boss) bossShield.position.copy(boss.root.position).add(new THREE.Vector3(0, 1.8, 0));
      impactTime = Math.max(0, impactTime - dt); impact.visible = impactTime > 0;
      impactMaterial.opacity = impactTime / 0.22; impact.scale.setScalar(1 + (1 - impactTime / 0.22) * 2);
      cameraView();
      if (phase === 'traversal') {
        const screen = new THREE.Vector3().copy(player.body.position).project(camera);
        if (screen.x < -1.05) die('LEFT BEHIND / KEEP UP WITH THE CAMERA');
      }
      updateHud();
      if (phase === 'exit' && phaseTime >= 3.8 && !transferred) {
        phase = 'done'; transferred = true;
        onFinished({ ...entryState, platformProgress: { checkpoint: 'boss', activatedRelays: course.getActivated(), defeatedRobots: [...defeated] },
          scramblerDestroyed: true, scramblerPosition: undefined, scramblerQuaternion: undefined,
          pilotState: { ...player.captureTransition({ x: 0, y: 0, z: 0 }), heldKeys: [], blockedKeys: [] },
          cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov });
      }
    },
    dispose() {
      if (disposed) return; disposed = true; unregister(); clearInput(); pulse.dispose();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('mousedown', mouseDown); window.removeEventListener('mouseup', mouseUp);
      window.removeEventListener('mousemove', mouseMove);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focusWindow);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', unlock);
      retry.removeEventListener('click', retryClick); retry.remove(); hud.remove(); reticle.remove(); caption?.classList.add('hidden');
      document.body.classList.remove('jungle-platformer', 'jungle-platformer-side');
      character?.weapon.setEquipped(false); character?.setCrowbarEquipped?.(false); if (gun) { gun.removeFromParent(); scene.add(gun); }
      if (character?.model.parent === scene) character.model.removeFromParent();
      for (const actor of actors) { actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.mixer.getRoot()); }
      for (const root of [...actors.map(actor => actor.root), ...templates]) root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      for (const shark of sharks) {
        shark.mixer.stopAllAction(); shark.mixer.uncacheRoot(shark.root); shark.root.removeFromParent();
        shark.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      }
      if (sharkTemplate) releaseAsset(sharkTemplate);
      scene.onBeforeRender = () => {}; player.dispose(); physics.dispose(); site.dispose();
      friendlyMaterial.dispose(); hostileMaterial.dispose();
    },
  };
}
