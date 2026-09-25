import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createScenePhysics, createGroundMotor, PHYSICS, registerPhysicsActor } from '../../helpers/physics/scenePhysics.js';
import { createRescueSite, RESCUE_SITE, JUNGLE_PATH, JUNGLE_ROUTE, RETURN_PATH, JUNGLE_ENTRY_YAW, type RescueArrival } from '../../helpers/scene/rescueSite.js';
import { createPlayer } from '../../scripts/player.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadToolModel, loadDinoModel } from '../../core/loader.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';
import type { DamageTarget, DamageWeapon } from '../../scripts/pistol.js';
import type { CinematicPose } from '../../scripts/characterManager.js';
import { createRiverAmbushers } from '../../scripts/riverAmbusher.js';
import { createJungleScrambler, createJungleScramblerPulse, PLATFORM_COURSE } from '../../helpers/scene/junglePlatformCourse.js';

/** Shared jungle encounters, with distinct bridge and downstream/facility checkpoints. */
export function createScene({ entryState, onRespawn, onPlatformer, section = 'approach', loadModel = loadToolModel, loadDinosaur = loadDinoModel }: {
  entryState?: RescueArrival; onRespawn: () => void; onPlatformer?: (state: RescueArrival) => void; section?: 'approach' | 'return';
  loadModel?: typeof loadToolModel; loadDinosaur?: typeof loadDinoModel;
}) {
  const returning = section === 'return';
  const spawn = returning ? RESCUE_SITE.downstream : RESCUE_SITE.player;
  const spawnYaw = returning ? 0 : JUNGLE_ENTRY_YAW;
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const site = createRescueSite(physics, { culling: true, platformer: true,
    activatedRelays: entryState?.platformProgress?.activatedRelays ?? (returning ? ['relay1', 'relay2', 'relay3'] : []),
  }), { scene, door, ship, pod, boy } = site;
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 650);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  if (entryState?.pilotState) player.restoreTransition({
    ...entryState.pilotState, position: spawn, velocity: { x: 0, y: 0, z: 0 },
    yaw: spawnYaw, pitch: 0, heldKeys: [], blockedKeys: [], crouching: false, sprinting: false,
    intentionalJump: false, jumpQueued: false, bobTime: 0, bobIntensity: 0,
  }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.setRotation(spawnYaw); player.enable(); player.updateCamera(0);
  ship.setCanopyOpen(1); ship.setFlying(false, true); ship.root.userData.hullHealth = entryState?.hullHealth;
  pod.getObjectByName('PodHatch')!.rotation.z = -1.5;
  boy.rotation.y = Math.atan2(RESCUE_SITE.player.x - boy.position.x, RESCUE_SITE.player.z - boy.position.z); site.setImpact(30);
  ship.update(0);
  for (const prop of [ship.root, pod]) {
    prop.updateMatrixWorld(true);
    const body = new CANNON.Body({ mass: 0, material: physics.solidMaterial });
    body.position.copy(new CANNON.Vec3(prop.position.x, prop.position.y, prop.position.z));
    prop.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial) || node.material.transparent) return;
      const positions = node.geometry.getAttribute('position'), index = node.geometry.getIndex();
      const vertices: number[] = [], vertex = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).sub(prop.position);
        vertices.push(vertex.x, vertex.y, vertex.z);
      }
      const indices = Array.from({ length: index?.count ?? positions.count }, (_, i): number => index ? index.getX(i) : i);
      body.addShape(new CANNON.Trimesh(vertices, indices));
    });
    physicsWorld.addBody(body); site.trackStaticBody(body);
  }
  site.trackStaticBody(physics.addBox({ x: 0.55, y: 1.75, z: 0.55 }, { x: RESCUE_SITE.boy.x, y: 0.875, z: RESCUE_SITE.boy.z }));
  // Use the final render camera, including third-person offsets, without advancing simulation.
  scene.onBeforeRender = (_renderer, _scene, viewCamera) => site.updateVisibility(viewCamera, player.body.position);

  const status = document.getElementById('loading-bay-status');
  const caption = document.getElementById('space-cinematic-caption');
  const prompt = document.getElementById('interact-prompt');
  document.body.classList.remove('space-cinematic');
  status?.classList.remove('hidden', 'restored'); caption?.classList.add('hidden'); prompt?.classList.add('hidden');
  let disposed = false, alerted = false, doorLatched = false, completed = false, deathClock = 0;
  let elapsed = 0, arrivalClock = 0, bridgeClock = -1, paused = false, animationDelta = 0;
  const bridgeStart = new THREE.Vector3(), bridgeCamera = new THREE.Vector3(), bridgeRotation = new THREE.Quaternion();
  const scrambler = returning ? null : createJungleScrambler(scene);
  const scramblerPulse = returning ? null : createJungleScramblerPulse();
  const launcher = site.scramblerLauncher!;
  if (scrambler) { scrambler.root.position.copy(launcher.chamber); scrambler.root.visible = false; }
  let bridgeYaw = 0, bridgeFov = 75;
  const launchArc = new THREE.CubicBezierCurve3(launcher.muzzle.clone(), new THREE.Vector3(-10, 43, -30),
    new THREE.Vector3(-42, 28, 12), new THREE.Vector3(-42, 5, PLATFORM_COURSE.depth));
  const launchTrail = returning ? null : new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.5, 10),
    new THREE.MeshBasicMaterial({ color: 0x99ffbf, transparent: true, opacity: 0.55, depthWrite: false }));
  if (launchTrail) { launchTrail.name = 'ScramblerLaunchTrail'; launchTrail.visible = false; scene.add(launchTrail); }
  const landSquad = returning ? createRiverAmbushers(scene, [125, 125, 125]) : null;
  const sentries = (landSquad?.actors ?? []).map((actor, index) => {
    const home = RETURN_PATH.getPointAt([0.22, 0.53, 0.83][index]);
    const body = new CANNON.Body({ mass: 25, shape: new CANNON.Sphere(0.85), fixedRotation: true, allowSleep: false, linearDamping: 0,
      material: new CANNON.Material({ friction: 0, restitution: 0 }) });
    actor.root.visible = false;
    return { actor, body, home, motor: createGroundMotor(body, 0.85), active: false, spent: false,
      aim: new THREE.Vector3(), steering: new THREE.Vector3(), steeringClock: 0, cooldown: 2 + index * 0.7, charge: -1 };
  });
  // The bridge remains solid; the facility now redirects the player onto its maintenance route.
  const onBlur = () => { paused = true; }, onFocus = () => { paused = false; };
  window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
  let spawnClock = 3, patrolLoaded = false, patrolLoadError = false, dinoLoadError = false, dinoIntroduced = false, defeatedPatrols = 0;
  let playerRoute = site.nearestPathPoint(player.body.position.x, player.body.position.z);
  type JungleEnemy = {
    root: THREE.Group; body: CANNON.Body; motor: ReturnType<typeof createGroundMotor>; mixer: THREE.AnimationMixer;
    actions: Map<string, THREE.AnimationAction>; action: string; ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    phase: 'dormant' | 'spawning' | 'chasing' | 'attacking' | 'hit' | 'dying';
    health: number; timer: number; cooldown: number; struck: boolean; navigationClock: number; goal: THREE.Vector3; speed: number;
    steeringClock: number; steering: THREE.Vector3; animationClock: number;
    kind: 'robot' | 'dino'; radius: number; maxHealth: number; attackDamage: number; attackRange: number; attackDuration: number;
  };
  const enemies: JungleEnemy[] = [], templates: THREE.Group[] = [];
  const spawnGeometry = new THREE.RingGeometry(0.7, 0.82, 24);
  const spawnMaterial = new THREE.MeshBasicMaterial({ color: 0xe89b4c, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
  function animateJungleEnemy(enemy: JungleEnemy, name: string, once = false) {
    if (enemy.action === name) return;
    const action = enemy.actions.get(name) ?? enemy.actions.get('Idle'); if (!action) return;
    enemy.mixer.stopAllAction(); enemy.action = name;
    const rate = name === 'Attack' ? action.getClip().duration / enemy.attackDuration : name === 'Run' && enemy.kind === 'dino' ? 1.5 : 1;
    action.reset().setEffectiveWeight(1).setEffectiveTimeScale(rate).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once; action.play();
  }
  function releaseTemplate(template: THREE.Group) {
    template.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
    disposeRoom(template as unknown as THREE.Scene);
  }
  function addEnemy(template: THREE.Group, clips: THREE.AnimationClip[], kind: JungleEnemy['kind'], index: number) {
    const dino = kind === 'dino', radius = dino ? 0.75 : 0.42, maxHealth = dino ? 150 : 75;
    const root = new THREE.Group(), model = clone(template); root.name = `Jungle-${kind}-${index}`; root.add(model); root.visible = false; scene.add(root);
    root.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = true; } });
    const body = new CANNON.Body({ mass: dino ? 40 : 12, shape: new CANNON.Sphere(radius), fixedRotation: true, allowSleep: false, linearDamping: 0,
      material: new CANNON.Material({ friction: 0, restitution: 0 }) });
    const mixer = new THREE.AnimationMixer(model), actions = new Map<string, THREE.AnimationAction>();
    if (dino) {
      const aliases: Array<[string, RegExp]> = [['Idle', /^idle animation$/i], ['Walk', /^walking animation$/i], ['Run', /^walking animation$/i], ['Attack', /^attack animation$/i], ['TurnOff', /^death animation$/i], ['Hit', /^idle animation$/i]];
      for (const [name, pattern] of aliases) {
        const clip = clips.find(clip => clip.duration > 0 && pattern.test(clip.name.trim()));
        if (clip) actions.set(name, mixer.clipAction(clip));
      }
    } else {
      for (const clip of clips) actions.set(clip.name, mixer.clipAction(clip));
      if (!actions.has('Idle') && actions.has('Walk')) actions.set('Idle', actions.get('Walk')!);
    }
    const ring = new THREE.Mesh(spawnGeometry, spawnMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; ring.visible = false; root.add(ring);
    enemies.push({ root, body, motor: createGroundMotor(body, radius), mixer, actions, action: '', ring, kind, radius, maxHealth,
      attackDamage: dino ? 22 : 12, attackRange: dino ? 2.2 : 1.6, attackDuration: dino ? 1.35 : 0.85,
      phase: 'dormant', health: maxHealth, timer: 0, cooldown: 1.5, struck: false, navigationClock: 0, goal: new THREE.Vector3(), speed: dino ? 3.65 : 3.2 + index * 0.25,
      steeringClock: 0, steering: new THREE.Vector3(), animationClock: 0 });
  }
  const patrolReady = loadModel('Enemy_Trilobite').then(gltf => {
    if (disposed) { releaseTemplate(gltf.scene); return; }
    const template = gltf.scene, bounds = new THREE.Box3().setFromObject(template), size = bounds.getSize(new THREE.Vector3());
    template.scale.multiplyScalar(1.65 / Math.max(size.x, size.y, size.z, 0.001));
    bounds.setFromObject(template); const center = bounds.getCenter(new THREE.Vector3());
    template.position.set(template.position.x - center.x, template.position.y - bounds.min.y, template.position.z - center.z);
    for (let i = 0; i < 4; i++) addEnemy(template, gltf.animations, 'robot', i);
    template.visible = false; template.name = 'JunglePatrolTemplate'; scene.add(template); templates.push(template); patrolLoaded = true;
  }).catch(error => { if (!disposed) { patrolLoadError = true; console.error('[Scene 17] Could not load jungle patrols:', error); } });
  const dinoReady = loadDinosaur().then(fbx => {
    if (disposed) { releaseTemplate(fbx.scene); return; }
    // Normalize a wrapper, leaving the FBX's animated hierarchy and local transforms intact.
    const template = new THREE.Group(); template.add(fbx.scene); template.updateMatrixWorld(true);
    const head = fbx.scene.getObjectByName('Head'), pelvis = fbx.scene.getObjectByName('Pelvis');
    if (head && pelvis) {
      const forward = head.getWorldPosition(new THREE.Vector3()).sub(pelvis.getWorldPosition(new THREE.Vector3()));
      if (Math.hypot(forward.x, forward.z) > 0.001) template.rotation.y = -Math.atan2(forward.x, forward.z);
    }
    const bounds = new THREE.Box3().setFromObject(template), size = bounds.getSize(new THREE.Vector3());
    template.scale.setScalar(Math.min(2.6 / Math.max(size.y, 0.001), 4.8 / Math.max(size.x, size.z, 0.001)));
    bounds.setFromObject(template);
    const anchor = pelvis ? pelvis.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
    template.position.set(-anchor.x, -bounds.min.y, -anchor.z);
    // A single reusable dinosaur shares the encounter cap with the existing robots.
    addEnemy(template, fbx.animations, 'dino', 0);
    template.visible = false; template.name = 'JungleDinoTemplate'; scene.add(template); templates.push(template); patrolLoaded = true;
  }).catch(error => { if (!disposed) { dinoLoadError = true; console.error('[Scene 17] Could not load dinosaur:', error); } });
  function clearSight(from: THREE.Vector3, to: THREE.Vector3) {
    let clear = true;
    physicsWorld.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z),
      { checkCollisionResponse: true, skipBackfaces: false }, hit => { if (hit.body?.type === CANNON.Body.STATIC) clear = false; });
    return clear;
  }
  function spawnPatrol() {
    const available = enemies.filter(enemy => enemy.phase === 'dormant');
    const dino = available.find(enemy => enemy.kind === 'dino');
    const enemy = dino && (!dinoIntroduced || Math.random() < 0.4) ? dino : available.find(enemy => enemy.kind === 'robot') ?? dino;
    if (!enemy) return false;
    const p = player.body.position;
    for (let attempt = 0; attempt < 24; attempt++) {
      const introduction = enemy.kind === 'dino' && !dinoIntroduced;
      const index = introduction ? site.nearestPathPoint(returning ? -24 : -57, returning ? -23 : 49).index
        : THREE.MathUtils.clamp(playerRoute.index + (Math.random() < 0.75 ? 1 : -1) * (16 + Math.floor(Math.random() * 23)), 32, 213);
      const t = index / (JUNGLE_ROUTE.length - 1), point = JUNGLE_ROUTE[index].clone(), tangent = JUNGLE_PATH.getTangentAt(t);
      point.addScaledVector(new THREE.Vector3(tangent.z, 0, -tangent.x), introduction ? 0.8 : (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.random() * 1.2));
      const distance = Math.hypot(point.x - p.x, point.z - p.z);
      if ((returning ? point.z > 7 : point.z < 28) || distance < (introduction ? 4 : 12) || distance > (introduction ? 65 : 30) || point.distanceTo(RESCUE_SITE.clearing) < 29 || Math.hypot(point.x, point.z - RESCUE_SITE.doorZ) < 20
        || !site.isWalkable(point.x, point.z, Math.max(0.85, enemy.radius + 0.35))
        || enemies.some(r => r.phase !== 'dormant' && Math.hypot(r.body.position.x - point.x, r.body.position.z - point.z) < r.radius + enemy.radius + 1.2)) continue;
      enemy.body.type = CANNON.Body.DYNAMIC; enemy.body.updateMassProperties();
      enemy.body.position.set(point.x, enemy.radius + 0.08, point.z); enemy.body.velocity.set(0, 0, 0); enemy.body.force.set(0, 0, 0);
      site.activatePhysicsNear(enemy.body.position);
      enemy.body.collisionResponse = true; enemy.body.aabbNeedsUpdate = true; enemy.body.wakeUp(); enemy.motor.reset(); physicsWorld.addBody(enemy.body);
      enemy.root.position.set(point.x, 0.08, point.z); enemy.root.rotation.y = Math.atan2(p.x - point.x, p.z - point.z); enemy.root.visible = true;
      enemy.health = enemy.maxHealth; enemy.phase = 'spawning'; enemy.timer = 1.1; enemy.cooldown = 1.2; enemy.navigationClock = 0; enemy.goal.copy(JUNGLE_ROUTE[index]);
      enemy.steeringClock = 0; enemy.steering.set(0, 0, 0); enemy.animationClock = 0;
      enemy.action = ''; animateJungleEnemy(enemy, 'Idle'); enemy.mixer.update(0); enemy.ring.visible = true;
      if (enemy.kind === 'dino') dinoIntroduced = true;
      return true;
    }
    return false;
  }
  function damageJungleEnemy(enemy: JungleEnemy, amount: number, weapon?: DamageWeapon) {
    if (disposed || completed || !player.isEnabled() || player.getHealth() <= 0 || enemy.phase === 'dormant' || enemy.phase === 'dying'
      || !Number.isFinite(amount) || amount <= 0 || (weapon !== 'pistol' && weapon !== 'crowbar')) return false;
    enemy.health = Math.max(0, enemy.health - amount); enemy.ring.visible = false;
    if (!enemy.health) {
      enemy.phase = 'dying'; enemy.body.collisionResponse = false; enemy.timer = Math.max(1, enemy.actions.get('TurnOff')?.getClip().duration ?? 1.3) + 0.25;
      enemy.body.type = CANNON.Body.KINEMATIC; enemy.body.velocity.set(0, 0, 0); enemy.body.force.set(0, 0, 0); enemy.body.updateMassProperties();
      animateJungleEnemy(enemy, 'TurnOff', true); defeatedPatrols++;
    } else { enemy.phase = 'hit'; enemy.timer = 0.3; enemy.action = ''; animateJungleEnemy(enemy, 'Hit', true); }
    return true;
  }
  function retireJungleEnemy(enemy: JungleEnemy) {
    if (enemy.body.world === physicsWorld) physicsWorld.removeBody(enemy.body);
    enemy.root.visible = false; enemy.ring.visible = false; enemy.phase = 'dormant'; enemy.mixer.stopAllAction(); enemy.action = '';
  }
  function updatePatrols(dt: number) {
    if (disposed || completed || bridgeClock >= 0 || deathClock > 0 || !player.isEnabled() || player.getHealth() <= 0) return;
    const p = player.body.position;
    const nearLanding = Math.hypot(p.x - RESCUE_SITE.clearing.x, p.z - RESCUE_SITE.clearing.z) < 27;
    const nearFacility = Math.hypot(p.x, p.z - RESCUE_SITE.doorZ) < 21;
    if (patrolLoaded && !nearLanding && !nearFacility && playerRoute.distance < 12) {
      spawnClock -= dt;
      if (!dinoIntroduced && enemies.some(enemy => enemy.kind === 'dino' && enemy.phase === 'dormant')) spawnClock = 0;
      const active = enemies.filter(r => r.phase !== 'dormant').length;
      if (spawnClock <= 0 && active < 3) {
        const spawned = spawnPatrol();
        if (spawned && active === 0 && Math.random() < 0.3) spawnPatrol();
        spawnClock = spawned ? 7 + Math.random() * 7 : 1;
      }
    }
    for (const enemy of enemies) {
      if (enemy.phase === 'dormant') continue;
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      const distance = Math.hypot(p.x - enemy.body.position.x, p.z - enemy.body.position.z);
      if (enemy.phase === 'dying') {
        enemy.body.velocity.set(0, 0, 0); enemy.timer -= dt;
        if (enemy.timer <= 0) retireJungleEnemy(enemy);
        continue;
      }
      if (distance > 62) { retireJungleEnemy(enemy); continue; }
      if (enemy.phase === 'spawning' || enemy.phase === 'hit') {
        enemy.timer -= dt; enemy.motor.drive(0, 0, 0); enemy.ring.scale.setScalar((1 + Math.sin(enemy.timer * 14) * 0.12) * enemy.radius / 0.42);
        if (enemy.timer <= 0) { enemy.phase = 'chasing'; enemy.ring.visible = false; animateJungleEnemy(enemy, 'Run'); }
        continue;
      }
      if (nearLanding || p.z < RESCUE_SITE.doorZ) {
        enemy.motor.drive(0, 0, 0); enemy.phase = 'chasing'; animateJungleEnemy(enemy, 'Idle'); continue;
      }
      const eye = new THREE.Vector3(enemy.body.position.x, enemy.body.position.y + 0.35, enemy.body.position.z);
      const target = new THREE.Vector3(p.x, p.y + 0.35, p.z);
      if (enemy.phase === 'attacking') {
        enemy.motor.drive(0, 0, 0); enemy.timer -= dt;
        if (!enemy.struck && enemy.timer <= enemy.attackDuration * 0.4) {
          enemy.struck = true;
          if (distance < enemy.attackRange + 0.3 && Math.abs(p.y - enemy.body.position.y) < 1.4 && clearSight(eye, target)) player.takeDamage(enemy.attackDamage);
        }
        if (enemy.timer <= 0) { enemy.phase = 'chasing'; animateJungleEnemy(enemy, 'Run'); }
        continue;
      }
      if (distance < enemy.attackRange && enemy.cooldown <= 0 && clearSight(eye, target)) {
        enemy.phase = 'attacking'; enemy.timer = enemy.attackDuration; enemy.struck = false; enemy.cooldown = enemy.attackDuration + 1 + Math.random();
        enemy.root.rotation.y = Math.atan2(p.x - eye.x, p.z - eye.z); animateJungleEnemy(enemy, 'Attack', true); enemy.motor.drive(0, 0, 0); continue;
      }
      enemy.navigationClock -= dt;
      if (enemy.navigationClock <= 0) {
        enemy.navigationClock = 0.35; enemy.steeringClock = 0;
        if (distance < 12 && clearSight(eye, target)) enemy.goal.set(p.x, 0, p.z);
        else {
          const nearest = site.nearestPathPoint(eye.x, eye.z), advance = nearest.distance > 2.1 ? 0 : Math.sign(playerRoute.index - nearest.index) * 3;
          enemy.goal.copy(JUNGLE_ROUTE[THREE.MathUtils.clamp(nearest.index + advance, 0, JUNGLE_ROUTE.length - 1)]);
        }
      }
      const toward = enemy.steering, remaining = Math.hypot(enemy.goal.x - eye.x, enemy.goal.z - eye.z);
      enemy.steeringClock -= dt;
      if (enemy.steeringClock <= 0) {
        // Avoidance does not need five world raycasts on every 120 Hz physics tick.
        enemy.steeringClock = 0.12;
        toward.set(enemy.goal.x - eye.x, 0, enemy.goal.z - eye.z).normalize();
        if (!clearSight(eye, eye.clone().addScaledVector(toward, 1.5))) {
          let found = false;
          for (const angle of [0.8, -0.8, 1.5, -1.5]) {
            const detour = toward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            if (clearSight(eye, eye.clone().addScaledVector(detour, 1.5))) { toward.copy(detour); found = true; break; }
          }
          if (!found) toward.set(0, 0, 0);
        }
      }
      enemy.motor.drive(toward.x, toward.z, distance < 1.1 ? 0 : Math.min(enemy.speed, remaining / dt));
      if (toward.lengthSq() > 0) {
        const yaw = Math.atan2(toward.x, toward.z), delta = Math.atan2(Math.sin(yaw - enemy.root.rotation.y), Math.cos(yaw - enemy.root.rotation.y));
        enemy.root.rotation.y += delta * (1 - Math.exp(-10 * dt));
      }
      animateJungleEnemy(enemy, 'Run');
    }
  }
  const boltGeometry = new THREE.CylinderGeometry(0.045, 0.045, 1.35, 8);
  const boltMaterial = new THREE.MeshBasicMaterial({ color: 0xff5643 });
  const beams = new THREE.Group(); beams.name = 'FacilityDefenseLasers'; scene.add(beams);
  const bolts = Array.from({ length: 32 }, () => {
    const mesh = new THREE.Mesh(boltGeometry, boltMaterial); mesh.visible = false; beams.add(mesh);
    return { mesh, velocity: new THREE.Vector3(), life: 0 };
  });
  const turrets = site.turrets.map((turret, index) => {
    const material = new THREE.MeshBasicMaterial({ color: 0xff4234, transparent: true, opacity: 0.28, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1, 6), material);
    mesh.visible = false; scene.add(mesh);
    return { ...turret, telegraph: mesh, aim: new THREE.Vector3(), clock: 1.2 + index * 0.65, delay: 0.9 + index * 0.65, charging: false };
  });
  const up = new THREE.Vector3(0, 1, 0), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  const playerBounds = new THREE.Box3(), ray = new THREE.Ray(), intersection = new THREE.Vector3();
  const rayFrom = new CANNON.Vec3(), rayTo = new CANNON.Vec3();

  function stopDefense() {
    for (const sentry of sentries) { sentry.body.velocity.set(0, 0, 0); sentry.charge = -1; sentry.actor.charge(0); sentry.actor.walk(false); }
    for (const bolt of bolts) { bolt.life = 0; bolt.mesh.visible = false; }
    for (const turret of turrets) { turret.charging = false; turret.telegraph.visible = false; turret.muzzle.scale.setScalar(1); }
    for (const enemy of enemies) { enemy.body.velocity.set(0, 0, 0); enemy.ring.visible = false; }
  }
  function freezePlayer() {
    player.disable(); player.body.velocity.set(0, 0, 0);
    player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties();
  }
  function fire(turret: { muzzle: THREE.Object3D; aim: THREE.Vector3 }, speed = 38) {
    const bolt = bolts.find(item => item.life <= 0); if (!bolt) return;
    turret.muzzle.getWorldPosition(origin);
    direction.copy(turret.aim).sub(origin).normalize();
    bolt.mesh.position.copy(origin); bolt.mesh.quaternion.setFromUnitVectors(up, direction);
    bolt.velocity.copy(direction).multiplyScalar(speed); bolt.life = 3; bolt.mesh.visible = true;
    site.activatePhysicsNear(origin);
  }
  function damageSentry(sentry: typeof sentries[number], amount: number, weapon?: DamageWeapon) {
    if (disposed || completed || deathClock > 0 || !player.isEnabled() || player.getHealth() <= 0 || !sentry.active
      || (weapon !== 'pistol' && weapon !== 'crowbar') || !sentry.actor.damage(amount)) return false;
    if (sentry.actor.health === 0) {
      sentry.charge = -1; sentry.body.collisionResponse = false;
      sentry.body.type = CANNON.Body.KINEMATIC; sentry.body.velocity.set(0, 0, 0); sentry.body.force.set(0, 0, 0); sentry.body.updateMassProperties();
      defeatedPatrols++;
    }
    return true;
  }
  function updateSentries(dt: number) {
    if (!returning || disposed || completed || deathClock > 0 || !player.isEnabled() || player.getHealth() <= 0) return;
    const p = new THREE.Vector3().copy(player.body.position), target = p.clone().add(new THREE.Vector3(0, 0.8, 0));
    for (const [index, sentry] of sentries.entries()) {
      const { actor, body, home } = sentry;
      if (sentry.spent || !actor.loaded) continue;
      if (!sentry.active) {
        if (arrivalClock < 2 || home.distanceTo(p) > 34) continue;
        let spawnPoint: THREE.Vector3 | null = null;
        for (const dz of [-2.5, 2.5, 0, -4, 4]) {
          const candidate = home.clone().add(new THREE.Vector3(0, 0, dz));
          if (candidate.distanceTo(p) > 8 && site.isWalkable(candidate.x, candidate.z, 1.2) && candidate.z < 8) { spawnPoint = candidate; break; }
        }
        if (!spawnPoint) continue;
        body.position.set(spawnPoint.x, 0.87, spawnPoint.z); body.velocity.set(0, 0, 0); body.aabbNeedsUpdate = true;
        site.activatePhysicsNear(body.position); physicsWorld.addBody(body); sentry.motor.reset(); sentry.active = true;
        actor.root.position.set(spawnPoint.x, 0.02, spawnPoint.z); actor.root.visible = true; actor.aimAt(target);
      }
      if (actor.health <= 0) continue;
      const from = new THREE.Vector3(body.position.x, body.position.y + 1.35, body.position.z);
      const delta = p.clone().sub(new THREE.Vector3().copy(body.position)); delta.y = 0;
      const distance = delta.length(); delta.normalize(); sentry.cooldown -= dt;
      if (distance > 48 || p.z < RESCUE_SITE.doorZ) {
        sentry.motor.drive(0, 0, 0); sentry.charge = -1; actor.charge(0); actor.walk(false); continue;
      }
      if (sentry.charge >= 0) {
        if (distance < 9 || distance > 32) { sentry.charge = -1; sentry.cooldown = 1; actor.charge(0); }
        else {
          sentry.motor.drive(0, 0, 0); actor.walk(false); sentry.charge -= dt;
          if (sentry.charge > 0.4) sentry.aim.copy(target).addScaledVector(new THREE.Vector3().copy(player.body.velocity), 0.12);
          actor.aimAt(sentry.aim); actor.charge(1 - Math.max(0, sentry.charge) / 1.15);
          if (sentry.charge <= 0) {
            actor.root.updateMatrixWorld(true);
            if (clearSight(from, sentry.aim)) { fire({ muzzle: actor.muzzle, aim: sentry.aim }, 26); actor.fire(); }
            else actor.charge(0);
            sentry.charge = -1; sentry.cooldown = 2.6 + index * 0.4;
          }
          continue;
        }
      }
      if (distance >= 12 && distance <= 29 && sentry.cooldown <= 0 && clearSight(from, target)) {
        sentry.charge = 1.15; sentry.aim.copy(target); actor.walk(false); sentry.motor.drive(0, 0, 0); continue;
      }
      sentry.steeringClock -= dt;
      if (sentry.steeringClock <= 0) {
        sentry.steeringClock = 0.16;
        const desired = distance < 13 ? delta.clone().negate() : distance > 20 ? delta.clone()
          : new THREE.Vector3(delta.z, 0, -delta.x).multiplyScalar(Math.sin(elapsed * 0.45 + index * 2) >= 0 ? 1 : -1);
        for (const other of sentries) if (other !== sentry && other.active && other.actor.health > 0) {
          const away = new THREE.Vector3().copy(body.position).sub(new THREE.Vector3().copy(other.body.position)); away.y = 0;
          if (away.lengthSq() < 16) desired.addScaledVector(away.normalize(), 1.2);
        }
        desired.normalize(); sentry.steering.set(0, 0, 0);
        for (const angle of [0, 0.75, -0.75, 1.45, -1.45]) {
          const option = desired.clone().applyAxisAngle(up, angle), probe = new THREE.Vector3().copy(body.position).addScaledVector(option, 2);
          if (probe.z > 8 || Math.hypot(probe.x - home.x, probe.z - home.z) > 25 || !site.isWalkable(probe.x, probe.z, 1.15)) continue;
          const eye = new THREE.Vector3(body.position.x, 0.7, body.position.z); probe.y = 0.7;
          if (clearSight(eye, probe)) { sentry.steering.copy(option); break; }
        }
      }
      const speed = distance < 13 ? 3.7 : distance > 20 ? 2.3 : 1;
      sentry.motor.drive(sentry.steering.x, sentry.steering.z, speed);
      actor.aimAt(target); actor.walk(sentry.steering.lengthSq() > 0);
    }
  }
  function updateDefense(dt: number) {
    if (disposed || completed || bridgeClock >= 0 || deathClock > 0 || !player.isEnabled() || player.getHealth() <= 0) return;
    elapsed += dt;
    if (!returning) return;
    const p = player.body.position, distance = Math.hypot(p.x, p.z - RESCUE_SITE.doorZ);
    if (!alerted && distance < 34 && p.z > RESCUE_SITE.doorZ) alerted = true;
    const exposed = alerted && distance < 65 && p.z > RESCUE_SITE.doorZ + 0.1;
    for (const turret of turrets) {
      if (!exposed) { turret.charging = false; turret.clock = turret.delay; turret.telegraph.visible = false; turret.muzzle.scale.setScalar(1); continue; }
      turret.clock -= dt;
      if (!turret.charging && turret.clock <= 0) { turret.charging = true; turret.clock = 0.85; }
      if (!turret.charging || turret.clock > 0.3) {
        turret.aim.set(p.x + player.body.velocity.x * 0.18, p.y + 0.7, p.z + player.body.velocity.z * 0.18);
      }
      turret.root.lookAt(turret.aim); turret.root.updateMatrixWorld(true);
      turret.muzzle.getWorldPosition(origin); direction.copy(turret.aim).sub(origin);
      turret.telegraph.visible = turret.charging;
      if (turret.charging) {
        turret.telegraph.position.copy(origin).addScaledVector(direction, 0.5);
        turret.telegraph.scale.y = direction.length(); turret.telegraph.quaternion.setFromUnitVectors(up, direction.normalize());
        turret.telegraph.material.opacity = turret.clock < 0.3 ? 0.65 : 0.22;
        turret.muzzle.scale.setScalar(1.2 + Math.sin(elapsed * 40) * 0.3);
        if (turret.clock <= 0) { fire(turret); turret.charging = false; turret.clock = 0.65; turret.telegraph.visible = false; }
      } else turret.muzzle.scale.setScalar(1);
    }
    // The walking controller uses a foot sphere; lasers also hit the visible torso.
    const height = player.getState().crouching ? 0.95 : 1.65;
    playerBounds.min.set(p.x - 0.32, p.y - player.radius, p.z - 0.32);
    playerBounds.max.set(p.x + 0.32, p.y - player.radius + height, p.z + 0.32);
    for (const bolt of bolts) {
      if (bolt.life <= 0) continue;
      const from = bolt.mesh.position, to = from.clone().addScaledVector(bolt.velocity, dt), travel = from.distanceTo(to);
      ray.set(from, direction.copy(bolt.velocity).normalize());
      const contact = ray.intersectBox(playerBounds, intersection);
      const playerDistance = playerBounds.containsPoint(from) ? 0 : contact ? from.distanceTo(contact) : Infinity;
      let obstruction = Infinity;
      rayFrom.set(from.x, from.y, from.z); rayTo.set(to.x, to.y, to.z);
      physicsWorld.raycastAll(rayFrom, rayTo, { skipBackfaces: false, checkCollisionResponse: true }, hit => {
        if (hit.body !== player.body && hit.body?.collisionResponse) obstruction = Math.min(obstruction, hit.distance);
      });
      bolt.life -= dt;
      if (playerDistance <= travel && playerDistance < obstruction) { player.takeDamage(12); bolt.life = 0; }
      else if (obstruction !== Infinity) bolt.life = 0;
      if (bolt.life <= 0) bolt.mesh.visible = false; else bolt.mesh.position.copy(to);
    }
  }
  const physicsFocus: Array<{ x: number; y: number; z: number }> = [];
  function syncNearbyPhysics() {
    physicsFocus.length = 0; physicsFocus.push(player.body.position);
    for (const enemy of enemies) if (enemy.phase !== 'dormant') physicsFocus.push(enemy.body.position);
    for (const sentry of sentries) if (sentry.active) physicsFocus.push(sentry.body.position);
    for (const bolt of bolts) if (bolt.life > 0) physicsFocus.push(bolt.mesh.position);
    site.updateActivePhysics(physicsFocus);
  }
  const unregister = registerPhysicsActor(physicsWorld, {
    body: player.body,
    beforePhysicsStep(dt: number) { updateSentries(dt); updateDefense(dt); updatePatrols(dt); },
    afterPhysicsStep() {
      for (const sentry of sentries) if (sentry.active) {
        if (sentry.actor.health > 0) sentry.motor.readSupport();
        sentry.actor.root.position.set(sentry.body.position.x, sentry.body.position.y - 0.85, sentry.body.position.z);
      }
      for (const enemy of enemies) if (enemy.phase !== 'dormant') {
        if (enemy.phase !== 'dying') enemy.motor.readSupport();
        enemy.root.position.set(enemy.body.position.x, enemy.body.position.y - enemy.radius, enemy.body.position.z);
      }
    },
  });
  function updateHud() {
    if (!status || completed || deathClock > 0 || bridgeClock >= 0) return;
    const distance = Math.ceil(Math.hypot(player.body.position.x, player.body.position.z - RESCUE_SITE.doorZ));
    status.textContent = doorLatched ? 'FACILITY ACCESS OPEN\nRUN THROUGH THE DOOR'
      : alerted ? `FACILITY DEFENSES ACTIVE / ${distance} m\nKEEP MOVING — SHIFT TO SPRINT TO THE ENTRANCE`
      : `${returning ? '19 / RETURN TO THE STONE PATH ON YOUR RIGHT' : '17 / FOLLOW THE STONE PATH TO THE BRIDGE'} / ${Math.ceil(returning ? site.pathLength * (1 - playerRoute.index / (JUNGLE_ROUTE.length - 1)) : Math.hypot(player.body.position.x - RESCUE_SITE.bridge.x, player.body.position.z - RESCUE_SITE.bridge.z))} m\n${enemies.filter(r => r.kind === 'robot' && r.phase !== 'dormant' && r.phase !== 'dying').length} ROBOTS / ${enemies.filter(r => r.kind === 'dino' && r.phase !== 'dormant' && r.phase !== 'dying').length} DINOSAURS NEARBY / ${defeatedPatrols} DEFEATED${returning ? ` / ${sentries.filter(s => s.active && s.actor.health > 0).length} RANGED QUADSHELLS` : ''}\nK: PISTOL / T: CROWBAR / SHIFT: SPRINT${patrolLoadError ? '\nROBOT MODEL COULD NOT LOAD' : ''}${dinoLoadError ? '\nDINOSAUR MODEL COULD NOT LOAD' : ''}${sentries.some(s => s.actor.error) ? '\nQUADSHELL MODEL COULD NOT LOAD' : ''}`;
    const nearBoy = !returning && arrivalClock < 7 && Math.hypot(player.body.position.x - boy.position.x, player.body.position.z - boy.position.z) < 12;
    caption?.classList.toggle('hidden', !nearBoy);
    status.classList.toggle('hidden', nearBoy);
    if (nearBoy && caption) caption.textContent = '"I will stay with the ships. Follow the stone path. Watch for robots — and something much bigger in the trees."';
  }
  function finish() {
    completed = true; stopDefense(); freezePlayer(); status?.classList.add('hidden'); prompt?.classList.add('hidden');
    if (caption) { caption.textContent = 'FACILITY REACHED / END OF SCENE 19'; caption.classList.remove('hidden'); }
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function bridgeView() {
    if (bridgeClock < 0 || !scrambler) return;
    const reveal = THREE.MathUtils.smootherstep(bridgeClock, 0, 1.7);
    const chase = THREE.MathUtils.smootherstep(bridgeClock, 3.3, 4.2);
    const orbit = THREE.MathUtils.smootherstep(bridgeClock, 6.4, 8.6);
    const facilityCamera = launcher.muzzle.clone().add(new THREE.Vector3(8, 4, Math.max(17, 10 / camera.aspect)));
    const chaseCamera = scrambler.root.position.clone().add(new THREE.Vector3(10, 5, Math.max(14, 9 / camera.aspect)));
    camera.position.lerpVectors(bridgeCamera, facilityCamera, reveal).lerp(chaseCamera, chase);
    const sideFocus = new THREE.Vector3(player.body.position.x - 3, 1.43, PLATFORM_COURSE.depth);
    const sidePosition = sideFocus.clone().add(new THREE.Vector3(0, 3.7, -Math.max(23, 14 / Math.max(0.25, camera.aspect))));
    camera.position.lerp(sidePosition, orbit);
    const target = launcher.muzzle.clone().lerp(scrambler.root.position, chase).lerp(sideFocus, orbit);
    camera.lookAt(target);
    camera.quaternion.slerpQuaternions(bridgeRotation, camera.quaternion.clone(), reveal);
    camera.fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(bridgeFov, 48, reveal), 50, orbit);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function updateBridge(dt: number) {
    bridgeClock += dt;
    const walk = THREE.MathUtils.smootherstep(bridgeClock, 0, 1.8);
    const p = bridgeStart.clone().lerp(new THREE.Vector3(-42, 0.53, PLATFORM_COURSE.depth), walk);
    p.y = 0.3 + 0.23 * THREE.MathUtils.clamp((28.2 - p.z) / 2.6, 0, 1);
    player.setPosition(p.x, p.y, p.z);
    player.setRotation(THREE.MathUtils.lerp(bridgeYaw, Math.PI / 2, THREE.MathUtils.smootherstep(bridgeClock, 1.8, 4.2)));
    launcher.setOpen(THREE.MathUtils.smootherstep(bridgeClock, 1.7, 2.7));
    launcher.setCharge(bridgeClock < 3.3 ? THREE.MathUtils.smootherstep(bridgeClock, 1.7, 3.1) : 1 - THREE.MathUtils.smootherstep(bridgeClock, 3.3, 3.9));
    launcher.setBurst(bridgeClock - 3.3);
    if (scrambler) {
      scrambler.root.visible = bridgeClock >= 1.7;
      if (bridgeClock < 3.3) scrambler.root.position.lerpVectors(launcher.chamber, launcher.muzzle, THREE.MathUtils.smootherstep(bridgeClock, 2.7, 3.3));
      else scrambler.root.position.copy(launchArc.getPoint(THREE.MathUtils.smootherstep(bridgeClock, 3.3, 6.4)));
      scrambler.update(dt);
      if (launchTrail) {
        launchTrail.visible = bridgeClock >= 3.3 && bridgeClock < 6.4;
        const tangent = launchArc.getTangent(THREE.MathUtils.smootherstep(bridgeClock, 3.3, 6.4));
        launchTrail.position.copy(scrambler.root.position).addScaledVector(tangent, -2.25);
        launchTrail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      }
    }
    scramblerPulse?.update(bridgeClock - 6.4);
    if (caption) {
      caption.classList.remove('hidden');
      caption.textContent = bridgeClock < 1.7 ? 'FACILITY DEFENSE SYSTEM / LAUNCH BAY ACTIVATING'
        : bridgeClock < 3.3 ? 'SCRAMBLER CHARGING / LAUNCH SHUTTERS OPEN'
        : bridgeClock < 6.4 ? 'SCRAMBLER LAUNCHED / INBOUND TO THE BRIDGE'
        : 'SPACE HAS SHIFTED / KEEP UP WITH THE CAMERA';
    }
    bridgeView();
    if (bridgeClock >= 8.6 && !completed) {
      completed = true;
      onPlatformer?.({ ...entryState, pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }),
        platformProgress: { checkpoint: 'bridge', activatedRelays: [], defeatedRobots: [] },
        scramblerPosition: scrambler?.root.position.clone(), scramblerQuaternion: scrambler?.root.quaternion.clone(),
        cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov });
    }
  }
  syncNearbyPhysics(); site.updateVisibility(camera, player.body.position); updateHud();
  return {
    roomId: returning ? 'scene19' : 'scene17', scene, camera, physics, physicsWorld, player, ship, pod, boy, door, enemies, ready: Promise.all([site.ready, patrolReady, dinoReady, landSquad?.ready]), cutsceneManager: null,
    get robots() { return enemies.filter(enemy => enemy.kind === 'robot'); },
    get dinosaurs() { return enemies.filter(enemy => enemy.kind === 'dino'); },
    getDamageTargets: (): DamageTarget[] => completed || bridgeClock >= 0 || deathClock > 0 ? [] : [
      ...enemies.filter(r => r.phase !== 'dormant' && r.phase !== 'dying')
        .map((enemy): DamageTarget => ({ root: enemy.root, body: enemy.body, damage: (amount, weapon) => damageJungleEnemy(enemy, amount, weapon) })),
      ...sentries.filter(s => s.active && s.actor.health > 0)
        .map((sentry): DamageTarget => ({ root: sentry.actor.root, body: sentry.body, damage: (amount, weapon) => damageSentry(sentry, amount, weapon) })),
    ],
    isCinematic: () => completed || bridgeClock >= 0 || deathClock > 0,
    getCinematicDelta: () => animationDelta,
    getCinematicState: () => completed || bridgeClock >= 0 || deathClock > 0 ? { ...player.getState(), isMoving: bridgeClock >= 0 && bridgeClock < 1.8, isOnGround: true, jumping: false, climbing: false } : null,
    getCinematicPose(): CinematicPose | null {
      if (bridgeClock < 0) return null;
      return { clip: bridgeClock < 1.8 ? 'Walk_Loop' : 'Idle_Loop', time: bridgeClock, loop: true };
    },
    applyCinematicCamera: bridgeView,
    applyEntryCamera() {
      if (entryState?.cameraPosition && entryState.cameraQuaternion && arrivalClock < 1.1) {
        const t = THREE.MathUtils.smootherstep(arrivalClock, 0, 1.1);
        camera.position.lerpVectors(entryState.cameraPosition, camera.position.clone(), t);
        camera.quaternion.slerpQuaternions(entryState.cameraQuaternion, camera.quaternion.clone(), t);
        camera.fov = THREE.MathUtils.lerp(entryState.cameraFov ?? 75, 75, t); camera.updateProjectionMatrix();
      }
    },
    onPlayerDeath() {
      if (!deathClock && !completed) {
        deathClock = 1.4; stopDefense(); freezePlayer(); status?.classList.add('hidden');
        if (caption) { caption.textContent = returning ? 'RETURNING TO THE DOWNSTREAM BANK' : 'RETURNING TO THE LANDING SITE'; caption.classList.remove('hidden'); }
      }
      return true;
    },
    updatePhysics(dt: number, thirdPerson = false) {
      animationDelta = 0;
      if (disposed || paused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime)); animationDelta = dt;
      site.update(dt);
      if (deathClock > 0) { deathClock = Math.max(0, deathClock - dt); if (!deathClock) onRespawn(); return; }
      if (completed) { door.update(dt, player, false); return; }
      if (bridgeClock >= 0) { updateBridge(dt); return; }
      arrivalClock += dt;
      const p = player.body.position;
      playerRoute = site.nearestPathPoint(p.x, p.z);
      if (!returning && player.getState().isOnGround && p.z < 28.3 && p.z > 10 && Math.abs(p.x - RESCUE_SITE.bridge.x) < 2.1) {
        bridgeStart.copy(p); bridgeCamera.copy(camera.position); bridgeRotation.copy(camera.quaternion);
        bridgeYaw = player.getState().yaw; bridgeFov = camera.fov;
        bridgeClock = 0; stopDefense(); freezePlayer(); player.body.collisionResponse = false; status?.classList.add('hidden');
        updateBridge(0); return;
      }
      if (p.y < RESCUE_SITE.riverY - 0.5) { onRespawn(); return; }
      if (returning && Math.abs(p.x) < 4 && Math.abs(p.z - RESCUE_SITE.doorZ) < 6.5) doorLatched = true;
      door.update(dt, player, doorLatched);
      syncNearbyPhysics();
      physics.step(dt, player, thirdPerson);
      for (const sentry of sentries) if (sentry.active) {
        sentry.actor.update(dt);
        if (sentry.actor.health <= 0 && !sentry.actor.root.visible) {
          if (sentry.body.world === physicsWorld) physicsWorld.removeBody(sentry.body);
          sentry.active = false; sentry.spent = true;
        }
      }
      for (const enemy of enemies) if (enemy.phase !== 'dormant') {
        const near = Math.hypot(enemy.body.position.x - p.x, enemy.body.position.z - p.z) < 35;
        enemy.root.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = near; });
        enemy.animationClock += dt;
        if (Math.hypot(enemy.body.position.x - p.x, enemy.body.position.z - p.z) < 28 || enemy.animationClock >= 1 / 15) {
          enemy.mixer.update(enemy.animationClock); enemy.animationClock = 0;
        }
      }
      if (player.getHealth() > 0 && doorLatched && Math.abs(p.x) < 4.5 && p.z < RESCUE_SITE.doorZ - 4) { finish(); return; }
      updateHud();
    },
    dispose() {
      if (disposed) return; disposed = true; unregister(); stopDefense(); scramblerPulse?.dispose(); landSquad?.dispose();
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      scene.onBeforeRender = () => {}; physicsFocus.length = 0;
      status?.classList.add('hidden'); caption?.classList.add('hidden'); prompt?.classList.add('hidden');
      for (const enemy of enemies) {
        enemy.mixer.stopAllAction(); enemy.mixer.uncacheRoot(enemy.mixer.getRoot());
        enemy.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      }
      for (const template of templates) template.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      player.dispose(); physics.dispose(); site.dispose();
      spawnGeometry.dispose(); spawnMaterial.dispose();
    },
  };
}
