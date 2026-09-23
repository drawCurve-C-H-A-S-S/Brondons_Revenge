import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createScenePhysics } from '../helpers/physics/scenePhysics.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createEscapeShip, createEscapePod, addPlanetBackdrop } from '../scripts/items/createEscapeShip.js';
import { consumeFlightAim, isTouchFire } from '../scripts/touchControls.js';

export const FLIGHT_RULES = Object.freeze({ cruise: 200, dodgeSpeed: 52, width: 64, height: 38, planetRadius: 900 });
const TOTAL_FIGHTERS = 18, MAX_ACTIVE = 6, PLAYER_MAX_HP = 120;
const SHOT_DAMAGE = 14, FIGHTER_HP = 42, GENERATOR_HP = 84, CORE_HP = 336;
const FORWARD = new THREE.Vector3(0, 0, 1), MODEL_FORWARD = new THREE.Vector3(0, 0, -1);
type Phase = 'combat' | 'bossArmor' | 'bossCore' | 'victory' | 'dead';

export interface FlightExitState {
  shipPosition: THREE.Vector3;
  shipQuaternion: THREE.Quaternion;
  podPosition: THREE.Vector3;
  podQuaternion: THREE.Quaternion;
  planetPosition: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  cameraQuaternion: THREE.Quaternion;
  cameraFov: number;
}

type Fighter = {
  root: THREE.Group; eye: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  health: number; fireCd: number; laneX: number; laneY: number; seed: number;
  state: 'attack' | 'regroup'; loop: THREE.CubicBezierCurve3 | null; loopTime: number;
};
type WeakPoint = { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; ring: THREE.Mesh; health: number; max: number };
type Boss = { root: THREE.Group; generators: WeakPoint[]; core: WeakPoint; shield: THREE.Mesh; fireCd: number; volley: number };

function createFighterMesh() {
  const root = new THREE.Group(); root.name = 'SpaceFighter'; root.scale.setScalar(3.5);
  const hull = new THREE.MeshStandardMaterial({ color: 0x674655, metalness: 0.7, roughness: 0.35 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x55ff88 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 2.4), hull); root.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), glow);
  eye.position.set(0, 0.22, -1.15); root.add(eye);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 1.3), hull);
    wing.position.set(side * 1.1, 0, 0.1); wing.rotation.z = side * 0.18; root.add(wing);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 1.6), glow);
    gun.position.set(side * 1.65, 0, -0.5); root.add(gun);
  }
  const engine = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0x8877ff }));
  engine.rotation.x = -Math.PI / 2; engine.position.z = 2; root.add(engine);
  return { root, eye };
}

function createBossMesh(): Boss {
  const root = new THREE.Group(); root.name = 'CapitalShip'; root.scale.setScalar(6);
  const hull = new THREE.MeshStandardMaterial({ color: 0x3d405b, metalness: 0.75, roughness: 0.32 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x181e30, metalness: 0.8, roughness: 0.3 });
  function box(size: [number, number, number], position: [number, number, number], material = hull) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...position); root.add(mesh);
  }
  box([6, 4, 14], [0, 0, 0]); box([3, 2, 5], [0, 3, 0], armor);
  for (const x of [-6, 6]) {
    box([6, 4.5, 10], [x, 0, 1]); box([2, 1, 5], [x, -1.8, -5], armor);
    const engine = new THREE.Mesh(new THREE.ConeGeometry(1, 5, 12), new THREE.MeshBasicMaterial({ color: 0x8877ff }));
    engine.rotation.x = -Math.PI / 2; engine.position.set(x, 0, 8); root.add(engine);
  }
  function target(position: [number, number, number], radius: number, health: number, color: number): WeakPoint {
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 12), material);
    mesh.position.set(...position); mesh.name = 'CapitalWeakPoint'; root.add(mesh);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.5, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color }));
    ring.position.copy(mesh.position); ring.position.z -= radius * 0.4; root.add(ring);
    return { mesh, ring, health, max: health };
  }
  const generators = [-6, 6].flatMap(x => [-1.5, 1.5].map(y => target([x, y, -5.8], 0.85, GENERATOR_HP, 0xffbb44)));
  const core = target([0, 0, -7.7], 1.45, CORE_HP, 0xff4466); core.mesh.visible = false; core.ring.visible = false;
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.3 }));
  shield.position.copy(core.mesh.position); root.add(shield);
  return { root, generators, core, shield, fireCd: 2.8, volley: 0 };
}

export function createScene({ entryState, onTransition }: { entryState?: PlayerTransitionState; onTransition: (state: FlightExitState) => void }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x01040b);
  const physics = createScenePhysics(), physicsWorld = physics.world; physicsWorld.gravity.set(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.1, 50000);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 2, z: 0 } });
  if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, heldKeys: [], crouching: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties();
  const ship = createEscapeShip(); ship.setFlying(true); ship.setThrust(1.5); scene.add(ship.root);
  const planetPosition = new THREE.Vector3(0, 120, 14000);
  const planet = addPlanetBackdrop(scene, planetPosition, FLIGHT_RULES.planetRadius, 30000); planet.visible = false;
  const starfield = scene.getObjectByName('Starfield');
  scene.add(new THREE.HemisphereLight(0xa3cfff, 0x181321, 2));
  const sun = new THREE.DirectionalLight(0xffecd8, 3.5); sun.position.set(-5000, 7000, -2500); scene.add(sun);

  const el = (id: string) => document.getElementById(id);
  const hud = el('flight-hud'), healthFill = el('space-health-fill'), healthLabel = el('space-health-label');
  const healthTrack = el('space-health-track'), speedLabel = el('flight-speed'), objective = el('flight-objective');
  const crosshair = el('space-crosshair'), bossHud = el('space-boss-hud'), bossFill = el('space-boss-fill');
  const bossLabel = el('space-boss-label'), enemyCount = el('space-enemy-count'), alert = el('space-alert');
  const damageOverlay = el('space-damage'), pausePanel = el('space-pause'), pauseTitle = el('space-pause-title'), pauseHint = el('space-pause-hint');
  const controls = el('flight-controls'), rollLabel = el('space-roll-status'), threatLabel = el('space-threat');
  const ownedHud = [hud, controls, crosshair, bossHud, enemyCount, alert, damageOverlay, pausePanel];
  for (const node of [hud, controls, crosshair, enemyCount, alert, damageOverlay]) node?.classList.remove('hidden');
  for (const id of ['flight-target', 'boss-subtitles', 'boss-hud', 'escape-qte', 'loading-bay-status', 'interact-prompt']) el(id)?.classList.add('hidden');
  document.body.classList.add('space-flight');
  // Free screen-space aiming, with the native cursor hidden only over active flight.
  function releasePointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  releasePointerLock();

  let phase: Phase = 'combat', checkpoint: 'combat' | 'bossArmor' | 'bossCore' = 'combat';
  let clock = 0, phaseClock = 0, railZ = 0, spawned = 0, totalKilled = 0, spawnCd = 0;
  let playerHp = PLAYER_MAX_HP, invulnerability = 0, damageFlash = 0, hitFlash = 0, fireCd = 0;
  let paused = false, disposed = false, transferred = false, firing = false, cockpitView = false;
  let rollCd = 0, rollTime = 0, rollSign = 1, alertTime = 0;
  let boss: Boss | null = null, pod: THREE.Group | null = null;
  const keys = new Set<string>(), velocity = new THREE.Vector2(), dash = new THREE.Vector2();
  const aim = new THREE.Vector2(0, 0), raycaster = new THREE.Raycaster(); raycaster.far = 1200;
  const fighters: Fighter[] = [];
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8), beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xffd074, transparent: true, opacity: 0.9, depthWrite: false });
  const boltMaterial = new THREE.MeshBasicMaterial({ color: 0x66ff88 });
  type Bolt = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; damage: number };
  type Flash = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; life: number; duration: number; size: number; beam: boolean };
  const bolts: Bolt[] = [], flashes: Flash[] = [];
  const oldShipPosition = new THREE.Vector3(), temp = new THREE.Vector3();
  let audio: AudioContext | null = null;
  function unlockAudio() {
    try { audio ??= new AudioContext(); if (audio.state === 'suspended') void audio.resume().catch(() => {}); } catch { /* Flight remains playable without audio support. */ }
  }
  function tone(start: number, end: number, duration: number, volume = 0.025) {
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(), time = audio.currentTime;
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(start, time); oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0.001, time); gain.gain.linearRampToValueAtTime(volume, time + 0.008); gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(time); oscillator.stop(time + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  // Near-field streaks supply parallax and a constant sense of forward motion.
  const streakPositions = new Float32Array(180 * 6);
  for (let i = 0; i < streakPositions.length; i += 6) {
    const angle = Math.random() * Math.PI * 2, radius = 65 + Math.random() * 300;
    streakPositions[i] = streakPositions[i + 3] = Math.cos(angle) * radius;
    streakPositions[i + 1] = streakPositions[i + 4] = Math.sin(angle) * radius;
    streakPositions[i + 2] = Math.random() * 900 - 80; streakPositions[i + 5] = streakPositions[i + 2] + 10;
  }
  const streakGeo = new THREE.BufferGeometry(); streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0x6496c7, transparent: true, opacity: 0.55 }));
  streaks.frustumCulled = false; scene.add(streaks);

  function announce(text: string, duration = 2) { if (alert) alert.textContent = text; alertTime = duration; }
  function burst(position: THREE.Vector3, size: number, color = 0xffa044) {
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }));
    mesh.position.copy(position); scene.add(mesh); flashes.push({ mesh, life: 0.5, duration: 0.5, size, beam: false });
  }
  function clearBolts() { for (const bolt of bolts) scene.remove(bolt.mesh); bolts.length = 0; }
  function showCrosshair() {
    if (crosshair) { crosshair.style.left = `${(aim.x + 1) * 50}%`; crosshair.style.top = `${(1 - aim.y) * 50}%`; }
  }
  function setPaused(value: boolean) {
    paused = value; firing = false; keys.clear(); velocity.set(0, 0);
    document.body.classList.toggle('space-paused', value);
    if (value) releasePointerLock();
    updateHud();
  }
  function interactiveTarget(event: Event) { return event.target instanceof HTMLElement && !!event.target.closest('button, input, textarea, select, [contenteditable="true"]'); }
  function onKeyDown(event: KeyboardEvent) {
    if (disposed || transferred || interactiveTarget(event)) return;
    if (event.code === 'Escape' && !event.repeat && phase !== 'victory') { event.preventDefault(); setPaused(!paused); return; }
    if (phase === 'dead') { if (event.code === 'KeyR' && !event.repeat) restartCheckpoint(); return; }
    if (paused || phase === 'victory') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyV') { cockpitView = !cockpitView; cameraView(); }
    if (event.code === 'Space' && rollCd <= 0) {
      const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const y = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      rollSign = x || (ship.root.position.x > 0 ? 1 : -1);
      dash.set(-x || (y ? 0 : -rollSign), y).normalize(); rollCd = 3; rollTime = 0.42; invulnerability = 0.45;
      unlockAudio(); tone(650, 100, 0.25);
    }
  }
  function onKeyUp(event: KeyboardEvent) { keys.delete(event.code); }
  function onMouseMove(event: MouseEvent) {
    if (disposed || paused || phase === 'dead') return;
    aim.set(THREE.MathUtils.clamp(event.clientX / window.innerWidth * 2 - 1, -1, 1), THREE.MathUtils.clamp(1 - event.clientY / window.innerHeight * 2, -1, 1));
    showCrosshair();
  }
  function onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || disposed || transferred || interactiveTarget(event)) return;
    if (paused) { setPaused(false); return; }
    if (phase !== 'dead' && phase !== 'victory') { onMouseMove(event); unlockAudio(); firing = true; fireCd = 0; }
  }
  function onMouseUp(event: MouseEvent) { if (event.button === 0) firing = false; }
  function onBlur() { if (!disposed && !transferred) setPaused(true); }
  function onVisibility() { if (document.hidden) onBlur(); }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove); window.addEventListener('mousedown', onMouseDown); window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('pointerlockchange', releasePointerLock);

  function spawnFighter() {
    const { root, eye } = createFighterMesh();
    const laneX = (spawned % 3 - 1) * 40 + (Math.random() - 0.5) * 12;
    const laneY = (Math.floor(spawned / 3) % 2 ? 1 : -1) * 22;
    root.position.set(laneX, laneY, railZ + (spawned < MAX_ACTIVE ? 230 + spawned * 38 : 450)); scene.add(root);
    fighters.push({ root, eye, health: FIGHTER_HP, fireCd: 0.8 + spawned % 6 * 0.35, laneX, laneY, seed: spawned * 1.7, state: 'attack', loop: null, loopTime: 0 });
    spawned++;
  }
  function beginRegroup(f: Fighter) {
    f.state = 'regroup'; f.loopTime = 0;
    f.eye.material.color.setHex(0x55ff88); f.eye.scale.setScalar(1);
    const start = f.root.position.clone(); start.z -= railZ;
    const side = f.laneX >= 0 ? 1 : -1;
    f.loop = new THREE.CubicBezierCurve3(start, new THREE.Vector3(side * 170, f.laneY + 50, -100), new THREE.Vector3(side * 180, f.laneY + 30, 540), new THREE.Vector3(f.laneX, f.laneY, 440));
  }
  function launchBolt(from: THREE.Vector3, target: THREE.Vector3, damage: number, speed = 230) {
    const direction = target.clone().sub(from).normalize();
    const mesh = new THREE.Mesh(beamGeo, boltMaterial); mesh.position.copy(from);
    mesh.scale.set(0.65, 13, 0.65); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); scene.add(mesh);
    // Add the rail velocity once. Bolts then travel straight; they never home after firing.
    bolts.push({ mesh, velocity: direction.multiplyScalar(speed).addScaledVector(FORWARD, FLIGHT_RULES.cruise), damage, life: 5 });
    burst(from, 3, 0x88ffbb);
  }
  function updateFighters(dt: number) {
    for (const f of fighters) {
      if (f.health <= 0) continue;
      const previous = f.root.position.clone(); previous.z += FLIGHT_RULES.cruise * dt;
      f.root.position.z += FLIGHT_RULES.cruise * dt;
      if (f.state === 'regroup' && f.loop) {
        f.loopTime += dt / 3.4; f.loop.getPoint(Math.min(1, f.loopTime), f.root.position); f.root.position.z += railZ;
        if (f.loopTime >= 1) { f.state = 'attack'; f.fireCd = 0.6 + Math.random(); }
      } else {
        const ahead = f.root.position.z - railZ;
        f.root.position.z -= 85 * dt;
        if (ahead > 90) {
          f.root.position.x = THREE.MathUtils.damp(f.root.position.x, f.laneX * 0.45 + ship.root.position.x * 0.5 + Math.sin(clock * 1.8 + f.seed) * 12, 1.2, dt);
          f.root.position.y = THREE.MathUtils.damp(f.root.position.y, f.laneY * 0.65 + Math.cos(clock * 1.5 + f.seed) * 8, 1.2, dt);
        }
        f.fireCd -= dt;
        const canFire = ahead > 105 && ahead < 460;
        f.eye.material.color.setHex(canFire && f.fireCd < 0.55 ? 0xffffff : 0x55ff88);
        f.eye.scale.setScalar(canFire && f.fireCd < 0.55 ? 1.5 : 1);
        if (canFire && f.fireCd <= 0) {
          f.fireCd = 2.1 + Math.random() * 0.9;
          launchBolt(f.root.position.clone().add(new THREE.Vector3(0, 0, -5)), ship.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 10);
        }
        if (ahead < -55) beginRegroup(f);
      }
      const direction = f.root.position.clone().sub(previous).normalize();
      if (direction.lengthSq() > 0) f.root.quaternion.setFromUnitVectors(MODEL_FORWARD, direction);
    }
  }

  function spawnBoss(corePhase = false) {
    boss = createBossMesh(); boss.root.position.set(0, 4, railZ + 340); scene.add(boss.root);
    if (corePhase) {
      for (const target of boss.generators) { target.health = 0; target.mesh.visible = false; target.ring.visible = false; }
      boss.shield.visible = false; boss.core.mesh.visible = true; boss.core.ring.visible = true;
    }
    phase = corePhase ? 'bossCore' : 'bossArmor'; checkpoint = phase; phaseClock = 0;
    playerHp = PLAYER_MAX_HP; invulnerability = 2; clearBolts();
    announce(corePhase ? 'PHASE 2 / EXPOSED REACTOR' : 'CAPITAL SHIP / DESTROY FOUR AMBER GENERATORS', 3);
  }
  function updateBoss(dt: number) {
    if (!boss || (phase !== 'bossArmor' && phase !== 'bossCore')) return;
    boss.root.position.set(Math.sin(clock * 0.35) * 18, 4 + Math.sin(clock * 0.5) * 9, railZ + 340);
    boss.root.rotation.z = Math.sin(clock * 0.4) * 0.04; boss.root.updateMatrixWorld(true);
    boss.fireCd -= dt;
    const charging = boss.fireCd < 0.65;
    for (const target of [...boss.generators, boss.core]) {
      if (target.health <= 0) continue;
      target.ring.rotation.z += dt * 0.7;
      target.mesh.material.color.setHex(charging ? 0xffffff : target === boss.core ? 0xff4466 : 0xffbb44);
    }
    if (boss.fireCd > 0) return;
    boss.fireCd = phase === 'bossCore' ? 1.65 : 2.4; boss.volley++;
    const from = boss.root.localToWorld(new THREE.Vector3(boss.volley % 2 ? -6 : 6, -1.8, -8));
    const aimAt = ship.root.position.clone().add(new THREE.Vector3(0, 1, 0));
    // Alternate aimed fans with walls that have a generous, readable dodge lane.
    if (phase === 'bossCore' && boss.volley % 2 === 0) {
      const gap = boss.volley % 4 === 0 ? 30 : -30;
      for (let x = -60; x <= 60; x += 15) {
        if (Math.abs(x - gap) < 22) continue;
        for (const y of [-24, 0, 24]) launchBolt(new THREE.Vector3(x, y, railZ + 280), new THREE.Vector3(x, y, railZ), 14, 190);
      }
      announce(gap < 0 ? 'BARRAGE / DODGE RIGHT' : 'BARRAGE / DODGE LEFT', 1.3);
    } else {
      for (const offset of phase === 'bossCore' ? [-22, -11, 0, 11, 22] : [-14, 0, 14]) {
        launchBolt(from, aimAt.clone().add(new THREE.Vector3(offset, 0, 0)), 14, 215);
      }
    }
  }
  function damageWeakPoint(target: WeakPoint) {
    if (!boss || target.health <= 0) return;
    target.health = Math.max(0, target.health - SHOT_DAMAGE);
    if (target.health > 0) return;
    target.mesh.visible = false; target.ring.visible = false;
    burst(target.mesh.getWorldPosition(new THREE.Vector3()), 14);
    if (phase === 'bossArmor' && boss.generators.every(t => t.health <= 0)) {
      phase = 'bossCore'; checkpoint = phase; phaseClock = 0;
      boss.shield.visible = false; boss.core.mesh.visible = true; boss.core.ring.visible = true;
      boss.fireCd = 2.5; clearBolts(); playerHp = Math.min(PLAYER_MAX_HP, playerHp + 30);
      announce('SHIELDS DOWN / SHOOT THE RED REACTOR / +30 HULL', 3);
    } else if (phase === 'bossCore' && target === boss.core) {
      phase = 'victory'; phaseClock = 0; firing = false; keys.clear(); clearBolts();
      planetPosition.set(0, 200, railZ + 14000); planet.position.copy(planetPosition); planet.visible = true;
      pod = createEscapePod(); pod.position.copy(boss.root.position).add(new THREE.Vector3(0, 16, 0));
      pod.quaternion.setFromUnitVectors(MODEL_FORWARD, planetPosition.clone().sub(pod.position).normalize()); scene.add(pod);
      burst(boss.root.position, 65); boss.root.visible = false;
      announce('CAPITAL SHIP DESTROYED / ESCAPE POD DETECTED', 3);
    }
  }

  function firePlayerLaser() {
    tone(1200, 250, 0.065, 0.018);
    // Raycast the rendered camera, including aspect/FOV and third-person parallax.
    scene.updateMatrixWorld(true); raycaster.setFromCamera(aim, camera);
    const roots: THREE.Object3D[] = fighters.filter(f => f.health > 0).map(f => f.root);
    if (boss && (phase === 'bossArmor' || phase === 'bossCore')) roots.push(boss.root);
    const hits = raycaster.intersectObjects(roots, true).filter(hit => {
      let object: THREE.Object3D | null = hit.object;
      while (object) { if (!object.visible) return false; object = object.parent; }
      return !boss || ![...boss.generators, boss.core].some(t => t.ring === hit.object);
    });
    const hit = hits[0];
    const point = hit ? hit.point : raycaster.ray.at(900, new THREE.Vector3());
    const muzzle = ship.root.localToWorld(new THREE.Vector3(Math.sin(clock * 70) > 0 ? -2.4 : 2.4, 1.1, -3.8));
    const beam = new THREE.Mesh(beamGeo, beamMaterial);
    beam.position.copy(muzzle).lerp(point, 0.5); beam.scale.set(0.18, muzzle.distanceTo(point), 0.18);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), point.clone().sub(muzzle).normalize()); scene.add(beam);
    flashes.push({ mesh: beam, life: 0.075, duration: 0.075, size: 1, beam: true });
    if (!hit) return;
    let fighter: Fighter | undefined;
    for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
      fighter = fighters.find(f => f.root === object); if (fighter) break;
    }
    if (fighter) {
      fighter.health = Math.max(0, fighter.health - SHOT_DAMAGE); hitFlash = 0.12; burst(point, 2, 0xffe4a3);
      if (fighter.health === 0) {
        totalKilled++; fighter.root.visible = false; burst(fighter.root.position, 11); tone(130, 35, 0.22, 0.06);
        playerHp = Math.min(PLAYER_MAX_HP, playerHp + 4);
      }
      return;
    }
    const target = boss && [...boss.generators, boss.core].find(t => t.mesh === hit.object);
    if (target && target.health > 0 && (phase === 'bossArmor' ? target !== boss!.core : target === boss!.core)) {
      hitFlash = 0.12; burst(point, 3, 0xffffff); damageWeakPoint(target);
    } else {
      burst(point, 2, 0x77bbff); if (alertTime <= 0) announce('ARMORED / AIM AT THE GLOWING TARGETS', 0.7);
    }
  }
  function damagePlayer(amount: number) {
    if (invulnerability > 0 || phase === 'dead' || phase === 'victory') return;
    playerHp = Math.max(0, playerHp - amount); invulnerability = 0.55; damageFlash = 0.7; tone(90, 30, 0.24, 0.08);
    if (playerHp === 0) {
      phase = 'dead'; firing = false; keys.clear(); clearBolts(); burst(ship.root.position, 14);
      document.body.classList.add('space-paused');
    }
  }
  function updateBolts(dt: number) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i];
      const relativeStart = bolt.mesh.position.clone().sub(oldShipPosition);
      bolt.mesh.position.addScaledVector(bolt.velocity, dt); bolt.life -= dt;
      const relativeEnd = bolt.mesh.position.clone().sub(ship.root.position);
      // Swept collision against the moving ship prevents tunneling at low frame rates.
      const segment = new THREE.Line3(relativeStart, relativeEnd);
      const hit = segment.closestPointToPoint(new THREE.Vector3(0, 1, 0), true, temp).distanceToSquared(new THREE.Vector3(0, 1, 0)) < 3.2 * 3.2;
      if (hit || bolt.life <= 0 || bolt.mesh.position.z < railZ - 55) {
        scene.remove(bolt.mesh); bolts.splice(i, 1);
        if (hit) { damagePlayer(bolt.damage); if (phase === 'dead') break; }
      }
    }
  }
  function restartCheckpoint() {
    for (const f of fighters) { scene.remove(f.root); disposeRoomForGroup(f.root); }
    fighters.length = 0;
    if (boss) { scene.remove(boss.root); disposeRoomForGroup(boss.root); boss = null; }
    clearBolts(); playerHp = PLAYER_MAX_HP; invulnerability = 2; damageFlash = 0; hitFlash = 0;
    ship.root.position.set(0, 0, railZ); velocity.set(0, 0); rollTime = 0; rollCd = 0; phaseClock = 0;
    setPaused(false);
    if (checkpoint === 'combat') {
      phase = 'combat'; spawned = 0; totalKilled = 0;
      for (let i = 0; i < MAX_ACTIVE; i++) spawnFighter();
    } else spawnBoss(checkpoint === 'bossCore');
  }
  function disposeRoomForGroup(group: THREE.Group) {
    const holder = new THREE.Scene(); holder.add(group); disposeRoom(holder); holder.remove(group);
  }
  function cameraView() {
    ship.root.updateMatrixWorld(true); camera.up.set(0, 1, 0);
    if (cockpitView) {
      camera.position.copy(ship.root.position).add(new THREE.Vector3(0, 2.2, 1));
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0, 300)));
    } else {
      camera.position.set(ship.root.position.x * 0.65, ship.root.position.y * 0.8 + 12, railZ - 34);
      camera.lookAt(new THREE.Vector3(ship.root.position.x * 0.65, ship.root.position.y * 0.8 + 6, railZ + 260));
    }
    camera.updateMatrixWorld(true);
  }
  function updateHud() {
    const dead = phase === 'dead', won = phase === 'victory';
    const pct = playerHp / PLAYER_MAX_HP;
    if (healthFill) { healthFill.style.width = `${pct * 100}%`; healthFill.classList.toggle('low', pct <= 0.3); }
    healthTrack?.setAttribute('aria-valuenow', String(playerHp));
    if (healthLabel) healthLabel.textContent = `${playerHp} / ${PLAYER_MAX_HP}`;
    if (speedLabel) speedLabel.textContent = `AUTO THRUST / ${FLIGHT_RULES.cruise} m/s`;
    if (objective) objective.textContent = phase === 'combat' ? 'CLEAR THE INTERCEPTORS' : phase === 'bossArmor' ? 'BREAK THE FOUR SHIELD GENERATORS' : phase === 'bossCore' ? 'DESTROY THE EXPOSED REACTOR' : won ? 'FOLLOW THE ESCAPE POD' : 'HULL LOST';
    if (rollLabel) rollLabel.textContent = rollCd <= 0 ? 'SPACE / EVASIVE ROLL READY' : `ROLL RECHARGING / ${rollCd.toFixed(1)}s`;
    if (threatLabel) {
      const incoming = bolts.filter(b => b.mesh.position.z > railZ && b.mesh.position.z < railZ + 500).length;
      threatLabel.textContent = incoming ? `INCOMING LASERS / ${incoming}` : 'WATCH FOR GREEN LASER FIRE';
      threatLabel.classList.toggle('incoming', incoming > 0);
    }
    if (enemyCount) {
      enemyCount.textContent = `INTERCEPTORS ${totalKilled} / ${TOTAL_FIGHTERS}`;
      enemyCount.classList.toggle('hidden', phase !== 'combat');
    }
    bossHud?.classList.toggle('hidden', phase !== 'bossArmor' && phase !== 'bossCore');
    if (boss) {
      const targets = phase === 'bossCore' ? [boss.core] : boss.generators;
      const health = targets.reduce((sum, t) => sum + t.health, 0), max = targets.reduce((sum, t) => sum + t.max, 0);
      if (bossFill) bossFill.style.width = `${health / max * 100}%`;
      if (bossLabel) bossLabel.textContent = phase === 'bossCore' ? 'PHASE 2 / REACTOR' : `PHASE 1 / SHIELDS ${targets.filter(t => t.health > 0).length}/4`;
    }
    crosshair?.classList.toggle('hidden', paused || dead || won);
    crosshair?.setAttribute('data-hit', String(hitFlash > 0));
    if (damageOverlay) damageOverlay.style.opacity = String(Math.min(0.8, damageFlash + (pct <= 0.3 ? 0.1 : 0)));
    alert?.classList.toggle('hidden', alertTime <= 0 || paused || dead);
    controls?.classList.toggle('hidden', won || dead);
    pausePanel?.classList.toggle('hidden', !paused && !dead);
    if (pauseTitle) pauseTitle.textContent = dead ? 'SHUTTLE DESTROYED' : 'FLIGHT PAUSED';
    if (pauseHint) pauseHint.textContent = dead ? 'R: retry this encounter' : 'Click or Escape to resume';
    document.body.classList.toggle('space-paused', paused || dead);
  }
  function updateEffects(dt: number) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]; f.life -= dt; f.mesh.position.z += FLIGHT_RULES.cruise * dt;
      if (!f.beam) { f.mesh.scale.setScalar(f.size * (1 - f.life / f.duration) + 0.5); f.mesh.material.opacity = Math.max(0, f.life / f.duration); }
      if (f.life <= 0) { scene.remove(f.mesh); if (!f.beam) f.mesh.material.dispose(); flashes.splice(i, 1); }
    }
    streaks.position.z = railZ;
    for (let i = 2; i < streakPositions.length; i += 6) {
      streakPositions[i] -= FLIGHT_RULES.cruise * dt;
      if (streakPositions[i] < -90) streakPositions[i] += 900;
      streakPositions[i + 3] = streakPositions[i] + 10;
    }
    streakGeo.attributes.position.needsUpdate = true;
    if (starfield) starfield.position.z = railZ;
  }
  function step(dt: number) {
    clock += dt; phaseClock += dt; oldShipPosition.copy(ship.root.position);
    invulnerability = Math.max(0, invulnerability - dt); damageFlash = Math.max(0, damageFlash - dt * 1.8);
    hitFlash = Math.max(0, hitFlash - dt); alertTime = Math.max(0, alertTime - dt);
    rollCd = Math.max(0, rollCd - dt); rollTime = Math.max(0, rollTime - dt);
    if (phase !== 'dead') {
      railZ += FLIGHT_RULES.cruise * dt;
      const horizontal = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const vertical = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      const input = new THREE.Vector2(-horizontal, vertical); if (input.lengthSq() > 1) input.normalize();
      velocity.x = THREE.MathUtils.damp(velocity.x, input.x * FLIGHT_RULES.dodgeSpeed, 12, dt);
      velocity.y = THREE.MathUtils.damp(velocity.y, input.y * FLIGHT_RULES.dodgeSpeed, 12, dt);
      ship.root.position.x = THREE.MathUtils.clamp(ship.root.position.x + (velocity.x + (rollTime > 0 ? dash.x * 85 : 0)) * dt, -FLIGHT_RULES.width, FLIGHT_RULES.width);
      ship.root.position.y = THREE.MathUtils.clamp(ship.root.position.y + (velocity.y + (rollTime > 0 ? dash.y * 85 : 0)) * dt, -FLIGHT_RULES.height, FLIGHT_RULES.height);
      ship.root.position.z = railZ;
      const bank = -velocity.x / FLIGHT_RULES.dodgeSpeed * 0.3 + (rollTime > 0 ? rollSign * (1 - rollTime / 0.42) * Math.PI * 2 : 0);
      ship.root.rotation.set(velocity.y / FLIGHT_RULES.dodgeSpeed * 0.1, Math.PI, bank, 'YXZ');
    }
    ship.root.visible = !cockpitView && phase !== 'dead';
    ship.setThrust(1.6 + Math.sin(clock * 24) * 0.1); cameraView();
    if (phase === 'combat') {
      updateFighters(dt); spawnCd -= dt;
      if (spawned < TOTAL_FIGHTERS && fighters.filter(f => f.health > 0).length < MAX_ACTIVE && spawnCd <= 0) { spawnFighter(); spawnCd = 0.8; }
      if (totalKilled === TOTAL_FIGHTERS) spawnBoss();
    }
    updateBoss(dt);
    if (phase !== 'dead' && phase !== 'victory') {
      fireCd -= dt;
      const touchAim = consumeFlightAim();
      if (touchAim.dx !== 0 || touchAim.dy !== 0) {
        aim.x = THREE.MathUtils.clamp(aim.x + touchAim.dx, -1, 1);
        aim.y = THREE.MathUtils.clamp(aim.y + touchAim.dy, -1, 1);
        showCrosshair();
      }
      const touchFiring = isTouchFire();
      if ((firing || touchFiring) && fireCd <= 0) { firePlayerLaser(); fireCd = 0.11; }
      updateBolts(dt);
    }
    if (!planet.visible) { planetPosition.z = railZ + 14000; planet.position.copy(planetPosition); }
    if (phase === 'victory' && pod) {
      pod.position.addScaledVector(planetPosition.clone().sub(pod.position).normalize(), dt * 320);
      if (phaseClock >= 2.8 && !transferred) {
        transferred = true;
        onTransition({ shipPosition: ship.root.position.clone(), shipQuaternion: ship.root.quaternion.clone(), podPosition: pod.position.clone(), podQuaternion: pod.quaternion.clone(), planetPosition: planetPosition.clone(), cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov });
        return;
      }
    }
    updateEffects(dt);
    player.setPosition(ship.root.position.x, ship.root.position.y + 2, ship.root.position.z);
  }

  for (let i = 0; i < MAX_ACTIVE; i++) spawnFighter();
  ship.root.rotation.y = Math.PI; cameraView(); showCrosshair(); updateHud();
  announce('AUTO THRUST ENGAGED / INTERCEPTORS INBOUND', 3);
  return {
    roomId: 'scene15', scene, camera, physicsWorld, player, ship, planet, cutsceneManager: null,
    isCinematic: () => true, hideCharacter: () => true,
    getCinematicState: () => player.getState(), applyCinematicCamera: cameraView,
    clearInput: () => { keys.clear(); firing = false; velocity.set(0, 0); },
    getFlightStatus: () => ({ speed: FLIGHT_RULES.cruise, cockpitView, paused, phase, playerHp, totalKilled, spawned, bossHp: boss ? [...boss.generators, boss.core].reduce((sum, t) => sum + t.health, 0) : 0 }),
    updatePhysics(dt: number) {
      if (disposed || transferred || paused) return;
      let remaining = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
      // Bounded substeps preserve dodge and projectile behavior across render rates.
      while (remaining > 0 && !disposed && !transferred) { const delta = Math.min(remaining, 1 / 120); step(delta); remaining -= delta; }
      if (!disposed && !transferred) updateHud();
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mousedown', onMouseDown); window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('pointerlockchange', releasePointerLock);
      document.body.classList.remove('space-flight', 'space-paused'); ownedHud.forEach(node => node?.classList.add('hidden'));
      if (damageOverlay) damageOverlay.style.opacity = '0';
      player.dispose(); physics.dispose(); disposeRoom(scene);
      sphereGeo.dispose(); beamGeo.dispose(); beamMaterial.dispose(); boltMaterial.dispose();
      if (audio) { void audio.close().catch(() => {}); audio = null; }
    },
  };
}
