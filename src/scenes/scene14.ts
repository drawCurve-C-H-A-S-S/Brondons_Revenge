import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadToolModel } from '../core/loader.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom } from '../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerActionName, type PlayerTransitionState } from '../scripts/player.js';
import { createEscapeShip, addPlanetBackdrop } from '../scripts/items/createEscapeShip.js';
import type { DamageTarget } from '../scripts/pistol.js';

export const ESCAPE_QTE = Object.freeze({ seconds: 2.2, stages: 6, robots: 48 });
type Phase = 'arrival' | 'run' | 'prompt' | 'action' | 'boarding' | 'aboard' | 'launch' | 'failed';

/** A playable approach, a timed escape sequence, then cockpit decompression and launch. */
export function createScene({ entryState, onFailure, onLaunch }: {
  entryState?: PlayerTransitionState; onFailure: () => void; onLaunch: (state: PlayerTransitionState) => void;
}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020611);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const steel = new THREE.MeshStandardMaterial({ color: 0x435667, metalness: 0.6, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2c3a, metalness: 0.45, roughness: 0.7 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe4a14a, emissive: 0xa86614, emissiveIntensity: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x84d8ee });
  const box = (s: [number, number, number], p: [number, number, number], mat: THREE.Material = steel, solid = true) => roomBox(scene, physics, s, p, mat, solid);
  box([36, 0.5, 72], [0, -0.25, 0], dark);
  box([0.5, 15, 72], [-18, 7.5, 0]); box([0.5, 15, 72], [18, 7.5, 0]);
  box([36, 15, 0.5], [0, 7.5, -36]); box([36, 0.4, 72], [0, 15, 0], dark);
  box([8, 15, 0.5], [-14, 7.5, 36]); box([8, 15, 0.5], [14, 7.5, 36]); box([20, 4, 0.5], [0, 13, 36]);
  const blastDoors = [-1, 1].map(sign => {
    const mesh = box([10, 11, 0.6], [sign * 5, 5.5, 36], dark, false);
    return { mesh, sign, body: physics.addBoxFromMesh(mesh) };
  });
  for (let z = -30; z <= 30; z += 6) for (const x of [-17.7, 17.7]) {
    box([0.12, 0.18, 3], [x, 4, z], glow, false); box([0.5, 15, 0.5], [x, 7.5, z], steel);
  }
  for (const x of [-6, 6]) box([0.2, 0.025, 66], [x, 0.02, 0], amber, false);
  for (const z of [-24, -12, 0, 12, 24]) box([24, 0.08, 0.7], [0, 14.7, z], glow, false);
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.35, 48), steel); lift.name = 'HangarArrivalLift'; lift.position.set(0, -0.175, -29); scene.add(lift);
  const ship = createEscapeShip(); ship.root.position.set(0, 0, 21); ship.root.rotation.y = Math.PI; ship.setThrust(0); scene.add(ship.root);
  const shipCollider = physics.addBox({ x: 3, y: 2.6, z: 7 }, { x: 0, y: 1.3, z: 21 });
  const planet = addPlanetBackdrop(scene, new THREE.Vector3(0, 60, 1500), 320, 2400);
  scene.add(new THREE.HemisphereLight(0xa8cce9, 0x2b3139, 2.2));
  const sun = new THREE.DirectionalLight(0xb9d8ff, 3); sun.position.set(-20, 50, 30); scene.add(sun);
  for (const z of [-25, -5, 15]) { const light = new THREE.PointLight(0xb3def7, 180, 40); light.position.set(0, 12, z); scene.add(light); }
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 5000);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 3.3, z: -29 } }); player.enable();
  if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: 3.3, z: -29 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, heldKeys: [], crouching: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.setRotation(Math.PI); player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties();
  let phase: Phase = 'arrival', clock = 0, stage = 0, timeLeft: number = ESCAPE_QTE.seconds;
  let expected = 'KeyX', actionKey = '', pendingAction: PlayerActionName | null = null;
  let disposed = false, transferred = false, paused = false, loaded = false, assetError = false, impact = false;
  let gun: THREE.Object3D | null = null;
  const actionStart = new THREE.Vector3(), actionEnd = new THREE.Vector3(), threatStart = new THREE.Vector3();
  const pressed = new Set<string>();
  const qte = document.getElementById('escape-qte'), keyLabel = document.getElementById('escape-key'), timer = document.getElementById('escape-timer-fill'), actionLabel = document.getElementById('escape-action');
  const prompt = document.getElementById('interact-prompt'), subtitles = document.getElementById('boss-subtitles'), status = document.getElementById('loading-bay-status');
  document.getElementById('boss-hud')?.classList.add('hidden'); status?.classList.remove('hidden', 'restored');
  type Robot = { root: THREE.Group; body: CANNON.Body; mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[]; stunned: boolean; health: number; vacuum: THREE.Vector3; target: DamageTarget };
  const robots: Robot[] = [];
  let threat: Robot | undefined;
  const queue: string[] = [];
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff5950 })); beam.visible = false; scene.add(beam);
  const windGeometry = new THREE.BufferGeometry(), windPositions = new Float32Array(180 * 3);
  for (let i = 0; i < windPositions.length; i += 3) { windPositions[i] = (Math.random() - 0.5) * 28; windPositions[i + 1] = Math.random() * 10; windPositions[i + 2] = Math.random() * 72 - 36; }
  windGeometry.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
  const wind = new THREE.Points(windGeometry, new THREE.PointsMaterial({ color: 0xccedff, size: 0.09, transparent: true, opacity: 0.6 })); wind.visible = false; scene.add(wind);
  function playRobot(robot: Robot, name: string) {
    const clip = robot.clips.find(c => c.name === name); if (!clip) return;
    robot.mixer.stopAllAction(); const action = robot.mixer.clipAction(clip); action.reset().play();
    if (name === 'TurnOff') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
  }
  function stopRobot(robot: Robot) {
    if (robot.stunned) return;
    robot.stunned = true; robot.body.collisionResponse = false; playRobot(robot, 'TurnOff');
  }
  async function loadCrowd() {
    assetError = false;
    try {
      const gltf = await loadToolModel('Enemy_Trilobite');
      if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; }
      const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3());
      gltf.scene.scale.multiplyScalar(1.4 / Math.max(size.x, size.y, size.z, 0.001)); bounds.setFromObject(gltf.scene); gltf.scene.position.y -= bounds.min.y;
      for (let i = 0; i < ESCAPE_QTE.robots; i++) {
        const root = new THREE.Group(); root.name = `HangarTrilobite-${i}`; root.add(clone(gltf.scene));
        const column = i % 8, row = Math.floor(i / 8);
        root.position.set((column < 4 ? -1 : 1) * (3.2 + (column % 4) * 3.2), 0, -16 + row * 8.4 + (column % 2) * 1.4); scene.add(root);
        root.traverse(n => { if (n instanceof THREE.Mesh) { n.castShadow = true; n.receiveShadow = true; } });
        const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.55, 0.5, 0.65)) }); body.position.set(root.position.x, 0.5, root.position.z); physicsWorld.addBody(body);
        const robot: Robot = { root, body, mixer: new THREE.AnimationMixer(root), clips: gltf.animations, stunned: false, health: 75, vacuum: new THREE.Vector3(),
          target: { root, body, damage(amount, weapon) { if (disposed || phase !== 'run' || robot.stunned || !Number.isFinite(amount) || amount <= 0 || (weapon !== 'pistol' && weapon !== 'crowbar')) return false; robot.health -= amount; if (robot.health <= 0) stopRobot(robot); return true; } } };
        robots.push(robot); playRobot(robot, 'Walk'); robot.mixer.update(i * 0.13);
      }
      loaded = true;
    } catch (error) { if (!disposed) { assetError = true; console.error('[Scene 14] Robot crowd could not load:', error); } }
  }
  const ready = loadCrowd();
  const gunReady = loadToolModel('Gun_Revolver').then(gltf => { if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; } gun = gltf.scene; gun.rotation.y = -Math.PI / 2; }).catch(error => { if (!disposed) console.error('[Scene 14] Cinematic pistol could not load:', error); });
  function freeze() { player.disable(); player.body.velocity.set(0, 0, 0); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties(); }
  function beginPrompt() {
    if (!queue.length) {
      const bag = ['KeyX', 'KeyY', 'KeyZ'];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      queue.push(...bag);
    }
    expected = queue.shift()!; phase = 'prompt'; clock = 0; timeLeft = ESCAPE_QTE.seconds;
    freeze(); qte?.classList.remove('hidden', 'urgent');
    if (timer) timer.style.width = '100%';
    if (keyLabel) keyLabel.textContent = expected.slice(3);
    if (actionLabel) actionLabel.textContent = `${stage + 1} / ${ESCAPE_QTE.stages} - ${expected === 'KeyX' ? 'FIRE THROUGH THE GAP' : expected === 'KeyY' ? 'STRIKE WITH THE CROWBAR' : 'DUCK AND DODGE'}`;
    const candidates = robots.filter(r => !r.stunned && r.root.position.z > player.body.position.z - 0.5);
    const position = new THREE.Vector3().copy(player.body.position);
    threat = (candidates.length ? candidates : robots.filter(r => !r.stunned)).sort((a, b) => a.root.position.distanceToSquared(position) - b.root.position.distanceToSquared(position))[0];
  }
  function fail(reason = 'TOO SLOW') {
    if (phase === 'failed' || transferred) return;
    player.enable(); player.takeDamage(player.getHealth()); freeze(); phase = 'failed'; clock = 0; pendingAction = null; beam.visible = false;
    qte?.classList.add('hidden'); prompt?.classList.add('hidden');
    if (subtitles) { subtitles.textContent = `${reason} / THE SWARM OVERRAN YOU\nReturning to the cleared loading bay...`; subtitles.classList.remove('hidden'); }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (disposed || event.repeat || pressed.has(event.code) || paused) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, [contenteditable="true"]')) return;
    pressed.add(event.code);
    if (phase === 'arrival' && assetError && event.code === 'KeyE') { void loadCrowd(); return; }
    if (phase === 'aboard' && event.code === 'KeyE') { event.preventDefault(); phase = 'launch'; clock = 0; prompt?.classList.add('hidden'); ship.setFlying(true); return; }
    if (phase !== 'prompt' || !['KeyX', 'KeyY', 'KeyZ'].includes(event.code)) return;
    event.preventDefault();
    if (event.code !== expected) { fail('WRONG MOVE'); return; }
    actionKey = expected; phase = 'action'; clock = 0; impact = false;
    pendingAction = actionKey === 'KeyX' ? 'Pistol_Shoot' : actionKey === 'KeyY' ? 'Sword_Attack' : null;
    actionStart.copy(player.body.position); actionEnd.set(stage % 2 ? 0.7 : -0.7, 0.3, -16 + stage * 5.5);
    if (threat) threatStart.copy(threat.root.position);
    qte?.classList.add('hidden');
  }
  function onKeyUp(event: KeyboardEvent) { pressed.delete(event.code); }
  function onBlur() { paused = true; pressed.clear(); }
  function onFocus() { paused = false; }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
  function cameraView() {
    if (phase === 'run') return false;
    const p = player.body.position;
    if (phase === 'aboard' || (phase === 'launch' && clock < 1.5)) {
      ship.root.updateMatrixWorld(true); ship.cockpit.getWorldPosition(camera.position); camera.lookAt(camera.position.x, camera.position.y, camera.position.z + 100);
    } else if (phase === 'launch') {
      camera.position.set(12, 8, ship.root.position.z - 12); camera.lookAt(0, 2.5, ship.root.position.z + 6);
    } else if (phase === 'arrival') { camera.position.set(3.2, 4, p.z - 3.6); camera.lookAt(0, 1.8, 18); }
    else { camera.position.set(p.x + 2.7, p.y + 2.2, p.z - 3.6); camera.lookAt(p.x, p.y + 0.7, p.z + 1); }
    return true;
  }
  function updateRobots(dt: number) {
    for (const robot of robots) {
      if (phase === 'launch' && clock > 1) {
        robot.body.collisionResponse = false;
        robot.vacuum.z += dt * 13; robot.vacuum.y += dt * 0.8; robot.vacuum.x += -robot.root.position.x * dt * 0.8;
        robot.root.position.addScaledVector(robot.vacuum, dt);
        if (robot.root.position.z > 30 && robot.root.position.z < 39) robot.root.position.x = THREE.MathUtils.clamp(robot.root.position.x, -8.8, 8.8);
        robot.root.rotation.x += dt * 1.8; robot.root.rotation.z += dt;
      } else if (!robot.stunned && phase !== 'arrival' && !(phase === 'action' && robot === threat && clock <= 0.3)) {
        const p = player.body.position, toward = new THREE.Vector3(p.x - robot.root.position.x, 0, p.z - robot.root.position.z);
        robot.root.rotation.y = Math.atan2(toward.x, toward.z);
        if (toward.length() > 2.3 && phase !== 'failed') robot.root.position.addScaledVector(toward.normalize(), dt * (phase === 'run' ? 0.8 : 1.4));
      }
      robot.body.position.set(robot.root.position.x, robot.root.position.y + 0.5, robot.root.position.z); robot.body.aabbNeedsUpdate = true; robot.mixer.update(dt);
    }
  }
  cameraView();
  return { roomId: 'scene14', scene, camera, physicsWorld, player, ship, robots, ready, gunReady, cutsceneManager: null,
    getDamageTargets: () => phase === 'run' ? robots.filter(r => !r.stunned).map(r => r.target) : [],
    isCinematic: () => phase !== 'run', hideCharacter: () => phase === 'aboard' || phase === 'launch',
    getCinematicWeapon: () => phase === 'action' && actionKey === 'KeyY' ? 'crowbar' : null,
    getCinematicState() {
      if (phase === 'run') return null;
      const actionRequest = pendingAction; pendingAction = null;
      const aiming = phase === 'action' && actionKey !== 'KeyZ' && threat;
      const yaw = aiming ? Math.atan2(player.body.position.x - threat!.root.position.x, player.body.position.z - threat!.root.position.z) : Math.PI;
      return { ...player.getState(), yaw, pitch: 0, isOnGround: true, jumping: false, isMoving: phase === 'action' || phase === 'boarding', sprinting: phase === 'action' || phase === 'boarding', crouching: phase === 'action' && actionKey === 'KeyZ', actionRequest };
    },
    updateCinematicCharacter(character: { model: THREE.Object3D; weapon: { socket: THREE.Object3D | null } } | null) {
      if (!character) return;
      if (phase === 'action' && actionKey === 'KeyX' && gun && character.weapon.socket) { character.weapon.socket.add(gun); gun.position.set(0, 0, 0); gun.visible = true; }
      else gun?.removeFromParent();
      if (phase === 'action' && actionKey === 'KeyZ') character.model.rotation.z = Math.sin(Math.min(1, clock / 1.25) * Math.PI) * 0.65;
      if (phase === 'failed') character.model.rotation.z = -Math.PI / 2;
    },
    applyCinematicCamera: cameraView,
    onPlayerDeath() { fail(); return true; },
    getEscapeStatus: () => ({ phase, stage, expected, timeLeft, loaded, paused }),
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || transferred) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
      if (paused) return;
      clock += dt;
      if (phase === 'arrival') {
        if (!loaded) clock = Math.min(clock, 1.4);
        const h = 3 * (1 - THREE.MathUtils.smoothstep(clock, 0, 2)); lift.position.y = h - 0.175; player.setPosition(0, h + 0.3, -29);
        if (clock >= 2 && loaded) { phase = 'run'; clock = 0; player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.enable(); }
      } else if (phase === 'run') {
        if (player.body.position.z > -22 || robots.some(r => !r.stunned && r.root.position.distanceTo(new THREE.Vector3().copy(player.body.position)) < 3)) beginPrompt();
      } else if (phase === 'prompt') {
        timeLeft = Math.max(0, timeLeft - dt); if (timer) timer.style.width = `${timeLeft / ESCAPE_QTE.seconds * 100}%`;
        qte?.classList.toggle('urgent', timeLeft < 0.7);
        if (timeLeft <= 0) fail();
      } else if (phase === 'action') {
        const t = THREE.MathUtils.smoothstep(clock, 0, 1.25), p = actionStart.clone().lerp(actionEnd, t);
        if (actionKey === 'KeyZ') p.x += Math.sin(t * Math.PI) * 1.8;
        player.setPosition(p.x, p.y, p.z);
        if (threat && actionKey !== 'KeyX' && !impact) {
          // The attacking robot lunges into melee range before the swing or dodge.
          const intercept = new THREE.Vector3(actionKey === 'KeyZ' ? actionStart.x : p.x, 0, p.z + 1.1);
          threat.root.position.lerpVectors(threatStart, intercept, THREE.MathUtils.smoothstep(clock, 0, 0.25));
        }
        if (clock >= 0.25 && !impact) {
          impact = true; if (threat && actionKey !== 'KeyZ') stopRobot(threat);
          if (actionKey === 'KeyX' && threat) { const from = new THREE.Vector3(p.x, p.y + 1.1, p.z), to = threat.root.position.clone().add(new THREE.Vector3(0, 0.5, 0)), delta = to.sub(from); beam.position.copy(from).addScaledVector(delta, 0.5); beam.scale.y = delta.length(); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); }
        }
        beam.visible = actionKey === 'KeyX' && clock > 0.25 && clock < 0.4;
        if (clock >= 1.25) { beam.visible = false; stage++; if (stage >= ESCAPE_QTE.stages) { phase = 'boarding'; clock = 0; actionStart.copy(player.body.position); } else beginPrompt(); }
      } else if (phase === 'boarding') {
        const t = THREE.MathUtils.smoothstep(clock, 0, 1.8); player.setPosition(THREE.MathUtils.lerp(actionStart.x, 0, t), 0.3 + t, THREE.MathUtils.lerp(actionStart.z, 18, t));
        if (clock >= 1.8) { phase = 'aboard'; clock = 0; player.setPosition(0, 2, 21); if (prompt) { prompt.textContent = 'Press E to open the hangar doors and launch'; prompt.classList.remove('hidden'); } }
      } else if (phase === 'launch') {
        const opening = THREE.MathUtils.smoothstep(clock, 0, 3);
        for (const door of blastDoors) { door.mesh.position.x = door.sign * (5 + opening * 10.5); door.body.position.x = door.mesh.position.x; door.body.aabbNeedsUpdate = true; }
        wind.visible = clock > 1;
        for (let i = 2; i < windPositions.length; i += 3) { windPositions[i] += dt * 45; if (windPositions[i] > 75) windPositions[i] = -35; } windGeometry.attributes.position.needsUpdate = true;
        const travel = Math.max(0, clock - 4); ship.root.position.set(0, Math.min(3, travel), 21 + travel * travel * 3.5); ship.setThrust(Math.min(1.6, travel)); shipCollider.collisionResponse = false;
        player.setPosition(0, ship.root.position.y + 2, ship.root.position.z);
        if (clock > 9) { transferred = true; onLaunch(player.captureTransition({ x: 0, y: 0, z: 0 })); return; }
      } else if (phase === 'failed' && clock > 1.6) { transferred = true; onFailure(); return; }
      updateRobots(dt); physics.step(dt, player, thirdPerson); planet.rotation.y += dt * 0.008;
      if (status) status.textContent = assetError ? 'ROBOT ASSETS COULD NOT LOAD / E: retry' : phase === 'arrival' ? '14 / HANGAR\nLift arriving. One ship. Too many robots.' : phase === 'run' ? 'RUN TO THE SHIP / WASD + SHIFT\nBe ready to press the displayed X, Y or Z key.' : phase === 'launch' ? 'HANGAR DEPRESSURIZING\nAll robots are being pulled into space. Launching toward the planet...' : phase === 'aboard' ? 'COCKPIT SEALED / PRESS E TO LAUNCH' : 'BREAK THROUGH THE SWARM';
      cameraView();
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      qte?.classList.add('hidden'); prompt?.classList.add('hidden'); subtitles?.classList.add('hidden'); status?.classList.add('hidden');
      if (gun) { gun.removeFromParent(); scene.add(gun); }
      robots.forEach(r => { r.mixer.stopAllAction(); r.mixer.uncacheRoot(r.root); r.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); }); });
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
