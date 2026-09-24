import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createScenePhysics } from '../helpers/physics/scenePhysics.js';
import { RESCUE_SITE, createRescueSite, type RescueArrival } from '../helpers/scene/rescueSite.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import { createPlayer, PLAYER_MAX_HEALTH } from '../scripts/player.js';
import { createRiverAmbushers } from '../scripts/riverAmbusher.js';
import { isTouchFire, resetTouchInput } from '../scripts/touchControls.js';
import { loadToolModel } from '../core/loader.js';
import type { CinematicPose, loadCharacter } from '../scripts/characterManager.js';

const LANES = [21, 17, 13];
const WATER = RESCUE_SITE.riverY;
const RUN_X = RESCUE_SITE.bridge.x;
const RIVER_DURATION = 30;
const FLOW = (RUN_X - RESCUE_SITE.downstream.x) / RIVER_DURATION;
const smooth = THREE.MathUtils.smootherstep;

/** Scene-owned swimming/input controller. Walking physics and ordinary weapons stay disabled. */
export function createScene({ entryState, onRespawn, onFinished }: {
  entryState?: RescueArrival; onRespawn: () => void; onFinished: (state: RescueArrival) => void;
}) {
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const site = createRescueSite(physics, { culling: true }), scene = site.scene;
  site.breakBridge(10); site.setImpact(30); site.ship.setCanopyOpen(1);
  site.pod.getObjectByName('PodHatch')!.rotation.z = -1.5;
  const world = new THREE.Group(); scene.add(world);
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 240);
  const position = new THREE.Vector3(RUN_X, WATER - 0.7, LANES[1]);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: position });
  const incoming = entryState?.pilotState ?? player.captureTransition({ x: 0, y: 0, z: 0 });
  player.restoreTransition({ ...incoming, position, velocity: { x: 0, y: 0, z: 0 }, heldKeys: [], blockedKeys: [],
    yaw: Math.PI / 2, pitch: 0, crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties();
  let health = player.getHealth(), phase: 'entry' | 'run' | 'dying' | 'exit' | 'done' = 'entry';
  let disposed = false, paused = false, phaseTime = 0, elapsed = 0, runTime = 0, lastDelta = 0;
  let lane = 1, laneFrom = LANES[1], laneTime = 1, originX = 0, lean = 0, firing = false, fireCooldown = 0, recoil = 1;
  let waveClock = 2, safeLane = 1, enemyClock = 2.8, enemyCharge = -1, committedLane = 1, shooter = -1, volley = 0;
  let logSpawned = false, invulnerable = 0, damageFlash = 0, deathReason = '';
  const nextLogTime = RIVER_DURATION - 6;
  scene.onBeforeRender = (_renderer, _scene, viewCamera) => site.updateVisibility(viewCamera, player.body.position);
  let gun: THREE.Object3D | null = null;
  const gunReady = loadToolModel('Gun_Revolver').then(gltf => {
    if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; }
    gun = gltf.scene; gun.rotation.y = -Math.PI / 2;
  }).catch(error => { if (!disposed) console.error('[River] Cinematic pistol could not load:', error); });
  const exitStart = new THREE.Vector3(), exitCamera = new THREE.Vector3(), exitRotation = new THREE.Quaternion();
  const keyLatch = new Set<string>();
  const up = new THREE.Vector3(0, 1, 0), downstream = new THREE.Vector3(-1, 0, 0);
  const oldPoint = new THREE.Vector3(), nextPoint = new THREE.Vector3(), contact = new THREE.Vector3();
  const ray = new THREE.Ray(), bounds = new THREE.Box3();

  // Travel through the actual jungle exterior; the bank and handhold never swap at the exit.
  const splashGeometry = new THREE.RingGeometry(0.2, 0.36, 14);
  const splashes = Array.from({ length: 24 }, () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xdaefda, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(splashGeometry, material); mesh.rotation.x = -Math.PI / 2; mesh.visible = false; world.add(mesh);
    return { mesh, life: 0, duration: 1 };
  });
  let wakeClock = 0;
  function splash(point: THREE.Vector3, size = 1) {
    const item = splashes.find(s => s.life <= 0); if (!item) return;
    item.life = item.duration = 0.65; item.mesh.position.set(point.x, WATER + 0.07, point.z);
    item.mesh.scale.setScalar(size); item.mesh.userData.size = size; item.mesh.visible = true;
  }
  const vineMaterial = new THREE.MeshStandardMaterial({ color: 0x507329, roughness: 1 });
  const vineGeometry = new THREE.TorusGeometry(0.7, 0.1, 5, 13);
  const warningGeometry = new THREE.RingGeometry(1, 1.18, 20);
  const vines = Array.from({ length: 12 }, (_, index) => {
    const root = new THREE.Group(); root.visible = false; world.add(root);
    for (let i = 0; i < 5; i++) {
      const loop = new THREE.Mesh(vineGeometry, vineMaterial); loop.position.set(Math.sin(i * 2) * 0.7, 0.15 + i * 0.13, Math.cos(i * 2) * 0.6);
      loop.rotation.set(i * 0.45, i + index, i * 0.3); root.add(loop);
    }
    const warning = new THREE.Mesh(warningGeometry, new THREE.MeshBasicMaterial({ color: 0xffbd5b, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    warning.rotation.x = -Math.PI / 2; warning.position.y = 0.08; root.add(warning);
    return { root, warning, active: false, lane: 1 };
  });
  const log = site.exitLog;
  const logMarker = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 5), new THREE.MeshBasicMaterial({ color: 0xc8ffa0 }));
  logMarker.rotation.z = Math.PI; logMarker.position.set(0, 3, 0); logMarker.visible = false; log.add(logMarker);
  const squad = createRiverAmbushers(world, [entryState?.ambusherHealth ?? 125, 125, 125, 125]);
  const swimmers = squad.actors.map((actor, index) => {
    actor.root.visible = index === 0;
    actor.root.position.set(RUN_X - 18 - index % 2 * 10, WATER - 4, LANES[index % 3]);
    return { actor, start: [0, 6.5, 13.5, 20.5][index], lane: index % 3, laneClock: 3 + index * 0.7, surfaced: index === 0, active: index === 0 };
  });
  const ambusher = squad.actors[0];
  const ambusherStart = entryState?.ambusherPosition?.clone() ?? new THREE.Vector3(RUN_X - 23, WATER - 1.5, LANES[1]);
  const ambusherRotation = entryState?.ambusherQuaternion?.clone() ?? new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2);
  ambusher.root.position.copy(ambusherStart); ambusher.root.quaternion.copy(ambusherRotation);
  const muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd9ffff }));
  muzzleFlash.visible = false; world.add(muzzleFlash);
  const shotGeometry = new THREE.CylinderGeometry(0.045, 0.045, 1.4, 6);
  const playerShotMaterial = new THREE.MeshBasicMaterial({ color: 0x9bf4ff }), enemyShotMaterial = new THREE.MeshBasicMaterial({ color: 0xff6047 });
  const shots = Array.from({ length: 48 }, () => {
    const mesh = new THREE.Mesh(shotGeometry, playerShotMaterial); mesh.visible = false; world.add(mesh);
    return { mesh, life: 0, friendly: true, velocity: new THREE.Vector3() };
  });
  const telegraph = new THREE.Mesh(new THREE.PlaneGeometry(36, 0.3), new THREE.MeshBasicMaterial({ color: 0xff6748, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  telegraph.rotation.x = -Math.PI / 2; telegraph.visible = false; world.add(telegraph);
  const hud = document.createElement('div'); hud.className = 'river-hud'; hud.setAttribute('role', 'status'); document.body.appendChild(hud);
  const controls = document.createElement('div'); controls.className = 'river-lane-controls';
  const laneButtons = [-1, 1].map(direction => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = direction < 0 ? '◀' : '▶';
    button.setAttribute('aria-label', direction < 0 ? 'Move one lane left' : 'Move one lane right');
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); changeLane(direction);
    });
    button.addEventListener('click', event => { if (event.detail === 0) changeLane(direction); });
    controls.appendChild(button); return button;
  });
  document.body.appendChild(controls); document.body.classList.add('river-run');
  const caption = document.getElementById('space-cinematic-caption');
  document.getElementById('loading-bay-status')?.classList.add('hidden');
  function blocked() { return disposed || paused || document.hidden || document.body.classList.contains('quick-menu-open'); }
  function clearInput() { keyLatch.clear(); firing = false; resetTouchInput(); }
  function changeLane(direction: number) {
    if (blocked() || phase !== 'run') return;
    laneFrom = position.z; lane = THREE.MathUtils.clamp(lane + direction, 0, 2); laneTime = 0;
  }
  function keyDown(event: KeyboardEvent) {
    if (blocked() || event.repeat || keyLatch.has(event.code) || (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]'))) return;
    keyLatch.add(event.code);
    if (event.code === 'KeyA' || event.code === 'ArrowLeft') { event.preventDefault(); changeLane(-1); }
    if (event.code === 'KeyD' || event.code === 'ArrowRight') { event.preventDefault(); changeLane(1); }
  }
  const keyUp = (event: KeyboardEvent) => { keyLatch.delete(event.code); };
  const mouseDown = (event: MouseEvent) => { if (event.button === 0 && !blocked() && (event.target instanceof HTMLCanvasElement || document.pointerLockElement)) firing = true; };
  const mouseUp = (event: MouseEvent) => { if (event.button === 0) firing = false; };
  const blur = () => { paused = true; clearInput(); }, focus = () => { paused = false; };
  const visibility = () => { if (document.hidden) clearInput(); };
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
  window.addEventListener('mousedown', mouseDown); window.addEventListener('mouseup', mouseUp);
  window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility);
  function syncHealth() {
    player.restoreTransition({ ...player.captureTransition({ x: 0, y: 0, z: 0 }), health, heldKeys: [], blockedKeys: [] }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  }
  function clearHazards() {
    for (const item of vines) { item.active = false; item.root.visible = false; }
    for (const shot of shots) { shot.life = 0; shot.mesh.visible = false; }
    telegraph.visible = muzzleFlash.visible = false; enemyCharge = -1; shooter = -1;
    swimmers.forEach(({ actor }) => actor.charge(0));
  }
  function die(reason: string) {
    if (phase !== 'run') return;
    phase = 'dying'; phaseTime = 0; deathReason = reason; health = 0; syncHealth(); clearHazards(); clearInput(); splash(position, 2);
  }
  function hurt() {
    if (phase !== 'run' || invulnerable > 0) return;
    health = Math.max(0, health - 18); invulnerable = 0.55; damageFlash = 0.6; syncHealth(); splash(position);
    if (!health) die('HIT BY THE PURSUER');
  }
  function fire(from: THREE.Vector3, to: THREE.Vector3, friendly: boolean) {
    const shot = shots.find(s => s.life <= 0); if (!shot) return;
    shot.friendly = friendly; shot.life = 3; shot.mesh.material = friendly ? playerShotMaterial : enemyShotMaterial;
    shot.mesh.position.copy(from); shot.velocity.copy(to).sub(from).normalize(); shot.mesh.quaternion.setFromUnitVectors(up, shot.velocity);
    shot.velocity.multiplyScalar(friendly ? 65 : 22); shot.mesh.visible = true;
  }
  function spawnWave() {
    // Adjacent safe-lane changes and 3.4-second spacing leave ample time for two lane steps.
    safeLane = THREE.MathUtils.clamp(safeLane + (Math.random() < 0.5 ? -1 : 1), 0, 2);
    const blockedLanes = [0, 1, 2].filter(i => i !== safeLane);
    if (Math.random() < 0.25) blockedLanes.pop();
    for (const index of blockedLanes) {
      const vine = vines.find(v => !v.active); if (!vine) break;
      vine.lane = index; vine.active = true; vine.root.visible = true; vine.root.position.set(RUN_X - FLOW * 4.7, WATER, LANES[index]);
    }
  }
  function beginExit() {
    phase = 'exit'; phaseTime = 0; clearInput(); clearHazards(); logMarker.visible = false;
    exitStart.copy(position); exitCamera.copy(camera.position); exitRotation.copy(camera.quaternion);
    splash(position, 1.5);
  }
  function cameraView() {
    const actual = position.clone().add(new THREE.Vector3(originX, 0, 0));
    const chase = new THREE.Vector3(actual.x + Math.max(5.2, 3.4 / camera.aspect), WATER + 3.2, THREE.MathUtils.lerp(RESCUE_SITE.riverZ, actual.z, 0.55));
    camera.position.copy(chase); camera.lookAt(actual.x - 10, WATER + 0.25, RESCUE_SITE.riverZ); camera.fov = 65;
    if (phase === 'entry' && entryState?.cameraPosition && entryState.cameraQuaternion) {
      const t = smooth(phaseTime, 0, 1.7), rotation = camera.quaternion.clone();
      camera.position.lerpVectors(entryState.cameraPosition, chase, t); camera.quaternion.slerpQuaternions(entryState.cameraQuaternion, rotation, t);
      camera.fov = THREE.MathUtils.lerp(entryState.cameraFov ?? 75, 65, t);
    } else if (phase === 'exit' || phase === 'done') {
      const t = smooth(phaseTime, 0, 2), destination = new THREE.Vector3(RESCUE_SITE.downstream.x + 5, 3.7, 14);
      camera.position.lerpVectors(exitCamera, destination, t); camera.lookAt(actual.clone().add(new THREE.Vector3(0, 0.8, -0.4)));
      camera.quaternion.slerpQuaternions(exitRotation, camera.quaternion.clone(), t);
      if (phaseTime > 5.5) {
        const end = new THREE.Vector3(RESCUE_SITE.downstream.x + 0.7, 1.95, RESCUE_SITE.downstream.z + 1.5);
        const blend = smooth(phaseTime, 5.5, 8.1); camera.position.lerp(end, blend);
        camera.quaternion.slerp(new THREE.Quaternion(), blend); camera.fov = THREE.MathUtils.lerp(65, 75, blend);
      }
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function pose(): CinematicPose {
    if (phase === 'dying') return { clip: 'Float_Loop', time: elapsed, loop: true, swimming: true, lean: Math.sin(phaseTime * 12) * 0.25, bodyPitch: -Math.min(0.8, phaseTime * 0.35) };
    if (phase === 'exit' || phase === 'done') {
      const t = phaseTime, x = RESCUE_SITE.downstream.x;
      if (t < 0.8) return { clip: 'Float_Loop', time: elapsed, loop: true, swimming: true };
      if (t < 4.65) {
        const leftTransfer = smooth(t, 3.1, 3.65), rightTransfer = smooth(t, 2.65, 3.2);
        const plant = smooth(t, 2.3, 3.15), recover = smooth(t, 3.65, 4.4);
        const gripY = THREE.MathUtils.lerp(-1.05, -0.4, smooth(t, 1.4, 2.1));
        const gripZ = THREE.MathUtils.lerp(11.4, 11.12, smooth(t, 1.4, 2.1));
        return { clip: t < 2.5 ? 'Float_Loop' : 'Crouch_Idle_Loop', time: t < 2.5 ? 0.6 : 0.25,
          bodyPitch: 0.12 + Math.sin(smooth(t, 1.4, 4.5) * Math.PI) * 0.28,
          handTargets: {
            left: { x: x + 0.32, y: THREE.MathUtils.lerp(gripY, 0.04, leftTransfer), z: THREE.MathUtils.lerp(gripZ, 9.95, leftTransfer) },
            right: { x: x - 0.32, y: THREE.MathUtils.lerp(gripY, 0.04, rightTransfer), z: THREE.MathUtils.lerp(gripZ, 9.95, rightTransfer) },
            weight: smooth(t, 0.8, 1.3) * (1 - smooth(t, 4, 4.65)),
          },
          footTargets: t < 2.3 ? undefined : {
            left: { x: x + 0.18, y: THREE.MathUtils.lerp(-0.9, 0.04, recover), z: THREE.MathUtils.lerp(11.5, 9.3, recover) },
            right: { x: x - 0.18, y: THREE.MathUtils.lerp(-0.35, 0.04, recover), z: THREE.MathUtils.lerp(11, 8.95, recover) },
            weight: plant * (1 - smooth(t, 4.25, 4.65)),
          },
        };
      }
      if (t < 5.1) return { clip: 'Crouch_Idle_Loop', time: 0.25, bodyPitch: 0.08 };
      if (t < 7.5) return { clip: 'Walk_Loop', time: t - 5.1, loop: true };
      return { clip: 'Idle_Loop', time: t - 7.5, loop: true };
    }
    return { clip: 'Float_Loop', time: elapsed, swimming: true, loop: true, lean,
      upperBody: recoil < 0.3 ? { clip: 'Pistol_Shoot', time: recoil, duration: 0.3 } : undefined };
  }
  function updateWorld(dt: number) {
    const moving = phase === 'run' || phase === 'entry';
    site.update(dt);
    wakeClock -= dt;
    if ((moving || phase === 'dying') && wakeClock <= 0) { wakeClock = 0.14; splash(position.clone().add(new THREE.Vector3(0.6, 0, 0)), 0.7); }
    for (const item of splashes) if (item.life > 0) {
      item.life -= dt; item.mesh.position.x += dt * 3;
      item.mesh.scale.setScalar(item.mesh.userData.size * (1 + (1 - item.life / item.duration) * 3));
      item.mesh.material.opacity = Math.max(0, item.life / item.duration) * 0.6; item.mesh.visible = item.life > 0;
    }
  }
  function updateCombat(dt: number) {
    invulnerable = Math.max(0, invulnerable - dt); recoil += dt; fireCooldown = Math.max(0, fireCooldown - dt);
    if ((firing || isTouchFire()) && fireCooldown <= 0) {
      fireCooldown = 0.2; recoil = 0;
      const muzzle = position.clone().add(new THREE.Vector3(-0.55, 1.2, 0)); fire(muzzle, muzzle.clone().add(downstream), true);
      muzzleFlash.position.copy(muzzle);
    }
    muzzleFlash.visible = recoil < 0.065;
    for (const [index, swimmer] of swimmers.entries()) {
      const actor = swimmer.actor, age = runTime - swimmer.start;
      if (age < 0 || !actor.loaded) continue;
      if (!swimmer.surfaced) { swimmer.surfaced = true; actor.root.visible = true; splash(actor.root.position, 2.2); }
      if (actor.health <= 0) { swimmer.active = false; actor.update(dt); continue; }
      const rise = index === 0 ? 1 : smooth(age, 0, 1.5);
      const dive = Math.max(smooth(age, 11.5, 13), smooth(runTime, nextLogTime, nextLogTime + 2));
      swimmer.active = rise > 0.85 && dive < 0.1;
      actor.root.visible = dive < 1;
      if (!actor.root.visible) continue;
      actor.root.position.y = WATER - 4 + rise * 2.5 - dive * 2.8 + Math.sin(elapsed * 2 + index) * 0.08;
      actor.root.position.x = THREE.MathUtils.damp(actor.root.position.x, RUN_X - 18 - index % 2 * 10, 2, dt);
      swimmer.laneClock -= dt;
      if (swimmer.laneClock <= 0 && index !== shooter) { swimmer.lane = (swimmer.lane + 1 + index % 2) % 3; swimmer.laneClock = 3.5; }
      const aiming = index === shooter && enemyCharge >= 0;
      actor.root.position.z = THREE.MathUtils.damp(actor.root.position.z, LANES[aiming ? committedLane : swimmer.lane], aiming ? 10 : 1.5, dt);
      actor.aimAt(new THREE.Vector3(position.x, WATER + 0.7, aiming ? LANES[committedLane] : position.z));
      actor.update(dt);
    }
    enemyClock -= dt;
    const imminentVines = vines.some(v => v.active && v.root.position.x > RUN_X - FLOW * 2 && v.root.position.x < RUN_X + 1.5);
    const available = swimmers.map((swimmer, index) => swimmer.active && swimmer.actor.health > 0 ? index : -1).filter(index => index >= 0);
    if (!logSpawned && enemyCharge < 0 && enemyClock <= 0 && !imminentVines && available.length) {
      shooter = available[volley++ % available.length]; enemyCharge = 1; committedLane = lane;
    }
    const attacker = swimmers[shooter];
    if (enemyCharge >= 0 && attacker?.active && attacker.actor.health > 0) {
      enemyCharge -= dt; attacker.actor.charge(1 - Math.max(0, enemyCharge));
      telegraph.visible = true; telegraph.position.set(RUN_X - 16, WATER + 0.09, LANES[committedLane]);
      if (enemyCharge <= 0) {
        world.updateMatrixWorld(true);
        const from = world.worldToLocal(attacker.actor.muzzle.getWorldPosition(new THREE.Vector3()));
        fire(from, new THREE.Vector3(RUN_X + 8, from.y, LANES[committedLane]), false);
        attacker.actor.fire(); enemyCharge = -1; shooter = -1; enemyClock = 2.4; telegraph.visible = false;
      }
    } else if (enemyCharge >= 0) {
      attacker?.actor.charge(0); enemyCharge = -1; shooter = -1; enemyClock = 0.8; telegraph.visible = false;
    }
    for (const shot of shots) {
      if (shot.life <= 0) continue;
      oldPoint.copy(shot.mesh.position); nextPoint.copy(oldPoint).addScaledVector(shot.velocity, dt);
      const travel = oldPoint.distanceTo(nextPoint); ray.set(oldPoint, contact.copy(shot.velocity).normalize());
      if (shot.friendly) {
        let closest = Infinity, target: typeof ambusher | null = null;
        const hitPoint = new THREE.Vector3();
        for (const { actor } of swimmers) {
          if (!actor.loaded || actor.health <= 0 || !actor.root.visible) continue;
          bounds.min.copy(actor.root.position).add(new THREE.Vector3(-1.25, 0, -1.1)); bounds.max.copy(actor.root.position).add(new THREE.Vector3(1.25, 3.1, 1.1));
          if (!ray.intersectBox(bounds, contact)) continue;
          const distance = bounds.containsPoint(oldPoint) ? 0 : oldPoint.distanceTo(contact);
          if (distance <= travel + 0.7 && distance < closest) { closest = distance; target = actor; hitPoint.copy(contact); }
        }
        if (target) { target.damage(25); splash(hitPoint, 0.8); shot.life = 0; }
      } else {
        bounds.min.copy(position).add(new THREE.Vector3(-0.45, 0.65, -0.5)); bounds.max.copy(position).add(new THREE.Vector3(0.45, 1.8, 0.5));
        if (ray.intersectBox(bounds, contact) && oldPoint.distanceTo(contact) <= travel + 0.7) { hurt(); shot.life = 0; }
      }
      shot.life -= dt; shot.mesh.position.copy(nextPoint); shot.mesh.visible = shot.life > 0;
      if (phase !== 'run') break;
    }
  }
  function updateHud() {
    const active = swimmers.filter(s => s.active && s.actor.health > 0).length;
    const defeated = swimmers.filter(s => s.actor.health <= 0).length;
    hud.textContent = `18 / RIVER ESCAPE | HEALTH ${Math.ceil(health)} / ${PLAYER_MAX_HEALTH}\n${ambusher.error ? 'QUADSHELL MODEL UNAVAILABLE' : `${active} QUADSHELLS IN RANGE / ${defeated} DESTROYED`} | BANK IN ${Math.ceil(Math.max(0, RIVER_DURATION - runTime))}s\nA / D or arrow keys: change lanes | Hold left-click / FIRE: shoot`;
    hud.classList.toggle('hidden', phase === 'exit' || phase === 'dying' || phase === 'done');
    laneButtons.forEach(button => { button.disabled = phase !== 'run'; });
    const text = phase === 'entry' ? 'KEEP YOUR HEAD ABOVE WATER. WATCH FOR VINES.' : phase === 'dying' ? `${deathReason} / RETURNING TO THE RIVER` : phase === 'exit' ? 'HOLD ON... GET TO THE BANK!' : logSpawned ? 'LOG AHEAD — MOVE TO THE RIGHT LANE TO GRAB IT!' : runTime < 6 ? 'SWIM BETWEEN LANES. SHOOT THE ROBOT AHEAD.' : '';
    if (caption) { caption.textContent = text; caption.classList.toggle('hidden', !text); }
  }
  cameraView(); updateHud();
  return {
    roomId: 'scene18', scene, camera, player, physics, physicsWorld, ready: Promise.all([site.ready, squad.ready, gunReady]), cutsceneManager: null,
    getDamageFlash: () => damageFlash,
    clearInput, isCinematic: () => true, getCinematicDelta: () => blocked() ? 0 : lastDelta,
    getCinematicState: () => ({ ...player.getState(), yaw: phase === 'exit' || phase === 'done' ? THREE.MathUtils.lerp(Math.PI / 2, 0, smooth(phaseTime, 0, 1.2)) : Math.PI / 2,
      isMoving: false, isOnGround: false, floating: false, climbing: false, jumping: false, actionRequest: null }),
    getCinematicPose: pose, applyCinematicCamera: cameraView,
    updateCinematicCharacter(character: Awaited<ReturnType<typeof loadCharacter>> | null) {
      if (phase === 'run' && recoil < 0.3 && gun && character?.weapon.socket) {
        character.weapon.socket.add(gun); gun.position.set(0, 0, 0); gun.visible = true;
      } else gun?.removeFromParent();
    },
    updatePhysics(dt: number) {
      lastDelta = 0; if (blocked() || phase === 'done') return;
      dt = Math.min(0.05, Math.max(0, Number.isFinite(dt) ? dt : 0)); lastDelta = dt; elapsed += dt;
      damageFlash = Math.max(0, damageFlash - dt * 1.8);
      if (phase !== 'entry' || ambusher.loaded || ambusher.error) phaseTime += dt;
      if (phase === 'entry') {
        const t = smooth(phaseTime, 0, 1.7);
        ambusher.root.position.lerpVectors(ambusherStart, new THREE.Vector3(RUN_X - 23, WATER - 1.5, LANES[1]), t);
        ambusher.root.quaternion.slerpQuaternions(ambusherRotation, new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2), t);
        ambusher.update(dt);
      }
      if (phase === 'entry' && phaseTime >= 1.7) { phase = 'run'; phaseTime = 0; clearInput(); }
      if (phase === 'run') {
        runTime += dt; laneTime = Math.min(1, laneTime + dt / 0.28);
        originX = -Math.min(RIVER_DURATION, runTime) * FLOW; world.position.x = originX;
        const previousZ = position.z; position.z = THREE.MathUtils.lerp(laneFrom, LANES[lane], smooth(laneTime, 0, 1));
        lean = THREE.MathUtils.damp(lean, (previousZ - position.z) * 0.45 / Math.max(dt, 0.001), 7, dt); lean = THREE.MathUtils.clamp(lean, -0.3, 0.3);
        position.y = WATER - 0.7 + Math.sin(elapsed * 3) * 0.055;
        if (!logSpawned) { waveClock -= dt; if (waveClock <= 0 && runTime < nextLogTime - 5) { spawnWave(); waveClock = 3.4; } }
        for (const vine of vines) if (vine.active) {
          const previousX = vine.root.position.x; vine.root.position.x += FLOW * dt;
          vine.warning.material.opacity = 0.45 + Math.sin(elapsed * 7) * 0.2;
          if (previousX <= RUN_X + 0.7 && vine.root.position.x >= RUN_X - 0.7 && Math.abs(position.z - LANES[vine.lane]) < 1.1) { die('SNAGGED BY RIVER VINES'); break; }
          if (vine.root.position.x > RUN_X + 12) { vine.active = false; vine.root.visible = false; }
        }
        if (phase === 'run') {
          if (!logSpawned && runTime >= nextLogTime) { logSpawned = true; logMarker.visible = true; clearHazards(); }
          if (logSpawned) {
            logMarker.position.y = 3 + Math.sin(elapsed * 4) * 0.15;
            if (runTime >= RIVER_DURATION && lane === 2 && Math.abs(position.z - LANES[2]) < 0.7) beginExit();
          }
          if (phase === 'run') updateCombat(dt);
        }
      } else if (phase === 'dying') {
        position.y = WATER - 0.7 - smooth(phaseTime, 0.25, 2) * 2.2;
        if (phaseTime > 2.6) { phase = 'done'; onRespawn(); return; }
      } else if (phase === 'exit') {
        position.copy(exitStart);
        const t = phaseTime;
        position.z = THREE.MathUtils.lerp(exitStart.z, 11.85, smooth(t, 0, 0.8));
        position.y = THREE.MathUtils.lerp(exitStart.y, -1.2, smooth(t, 1.4, 2.5));
        if (t > 1.4) position.z = THREE.MathUtils.lerp(11.85, 11.4, smooth(t, 1.4, 2.5));
        if (t > 2.5) {
          position.y = THREE.MathUtils.lerp(-1.2, -0.25, smooth(t, 2.5, 3.25));
          position.z = THREE.MathUtils.lerp(11.4, 10.45, smooth(t, 2.5, 3.25));
        }
        if (t > 3.25) {
          position.y = THREE.MathUtils.lerp(-0.25, 0.3, smooth(t, 3.25, 4.35));
          position.z = THREE.MathUtils.lerp(10.45, 9.1, smooth(t, 3.25, 4.35));
        }
        if (t > 5.1) position.z = THREE.MathUtils.lerp(9.1, RESCUE_SITE.downstream.z, THREE.MathUtils.clamp((t - 5.1) / 2.4, 0, 1));
      }
      player.setPosition(position.x + originX, position.y, position.z); updateWorld(dt); cameraView(); updateHud();
      if (phase === 'exit' && phaseTime >= 8.1) {
        phase = 'done'; onFinished({ ...entryState, pilotState: { ...player.captureTransition({ x: 0, y: 0, z: 0 }), health }, ambusherHealth: ambusher.health,
          cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov });
      }
    },
    dispose() {
      if (disposed) return; disposed = true; clearInput(); squad.dispose();
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
      window.removeEventListener('mousedown', mouseDown); window.removeEventListener('mouseup', mouseUp);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility);
      hud.remove(); controls.remove(); document.body.classList.remove('river-run'); caption?.classList.add('hidden');
      if (gun) { gun.removeFromParent(); scene.add(gun); }
      scene.onBeforeRender = () => {};
      playerShotMaterial.dispose(); enemyShotMaterial.dispose();
      player.dispose(); site.dispose(); physics.dispose();
    },
  };
}
