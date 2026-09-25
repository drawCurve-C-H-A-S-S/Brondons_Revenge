import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createEscapeShip, createEscapePod, addPlanetBackdrop } from '../../scripts/items/createEscapeShip.js';
import { consumeFlightAim, isTouchFire, resetTouchInput } from '../../scripts/touchControls.js';
import type { LaunchState } from '../level 1/scene14.js';
import { createSidescrollPhase, SCRAMBLER_HEALTH } from './scene15-5.js';
import { AudioManager } from '../../helpers/audio/AudioManager.js';
import level2BgmUrl from '../../assets/bgm/Level 2.m4a?url';

export const FLIGHT_RULES = Object.freeze({ cruise: 200, dodgeSpeed: 52, width: 64, height: 38, planetRadius: 900 });
const TOTAL_FIGHTERS = 18, MAX_ACTIVE = 6, PLAYER_MAX_HP = 260;
const SHOT_DAMAGE = 14, FIGHTER_HP = 42, GENERATOR_HP = 315, CORE_HP = 1400;
const FORWARD = new THREE.Vector3(0, 0, 1), MODEL_FORWARD = new THREE.Vector3(0, 0, -1);
type Phase = 'combat' | 'bossArrival' | 'scrambler' | 'bossArmor' | 'bossCore' | 'victory' | 'dead';

export interface FlightExitState {
  shipPosition: THREE.Vector3;
  shipQuaternion: THREE.Quaternion;
  podPosition: THREE.Vector3;
  podQuaternion: THREE.Quaternion;
  planetPosition: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  cameraQuaternion: THREE.Quaternion;
  cameraFov: number;
  hullHealth?: number;
  pilotState?: PlayerTransitionState;
}

type Fighter = {
  root: THREE.Group; eye: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  health: number; fireCd: number; laneX: number; laneY: number; seed: number;
  state: 'launch' | 'attack' | 'regroup'; loop: THREE.CubicBezierCurve3 | null; loopTime: number;
};
type WeakPoint = { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; ring: THREE.Mesh; health: number; max: number };
type Boss = { root: THREE.Group; bow: THREE.Group; launchBays: THREE.Object3D[]; generators: WeakPoint[]; core: WeakPoint; shield: THREE.Mesh; fireCd: number; volley: number };

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
  const root = new THREE.Group(); root.name = 'CapitalShip'; root.scale.setScalar(10.5);
  const hull = new THREE.MeshStandardMaterial({ color: 0x899ba8, metalness: 0.8, roughness: 0.24 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x293641, metalness: 0.75, roughness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xc4d2db, metalness: 0.85, roughness: 0.2 });
  const hangarDark = new THREE.MeshStandardMaterial({ color: 0x060d13, roughness: 0.85 });
  const bow = new THREE.Group(); bow.name = 'ArmoredProw'; root.add(bow);
  const launchBays: THREE.Object3D[] = [];
  const windows = new THREE.MeshBasicMaterial({ color: 0x90dcff });
  const reactorGlow = new THREE.MeshBasicMaterial({ color: 0xf85458 });
  function box(size: [number, number, number], position: [number, number, number], material: THREE.Material = hull) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...position); root.add(mesh);
  }
  function prow(x: number, rear: number, nose: number, width: number, height: number, material: THREE.Material, parent: THREE.Object3D = root) {
    // Beveled armor panels converge on a single sharp leading point.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      x - width * 0.72, -height, rear, x + width * 0.72, -height, rear,
      x + width, -height * 0.65, rear, x + width, height * 0.65, rear,
      x + width * 0.72, height, rear, x - width * 0.72, height, rear,
      x - width, height * 0.65, rear, x - width, -height * 0.65, rear,
      x, 0, nose,
    ], 3));
    const indices: number[] = [];
    for (let i = 0; i < 8; i++) indices.push(i, 8, (i + 1) % 8);
    for (let i = 1; i < 7; i++) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    const faceted = geometry.toNonIndexed(); faceted.computeVertexNormals(); geometry.dispose();
    const mesh = new THREE.Mesh(faceted, material); parent.add(mesh);
  }
  box([6, 4, 10], [0, 0, 2]); box([3, 2, 5], [0, 3, 0], armor);
  prow(0, -3, -11.2, 3, 2, hull, bow);
  prow(0, -2.9, -10.9, 0.32, 2.08, trim, bow);
  for (const x of [-6, 6]) {
    box([6, 4.5, 8], [x, 0, 2]);
    prow(x, -2, -8.7, 3, 2.25, hull);
    prow(x + Math.sign(x) * 2.1, -2, -9.3, 0.75, 1.1, trim);
    box([0.18, 0.18, 4], [x + Math.sign(x) * 1.8, 1.65, -4.1], windows);
    const engine = new THREE.Mesh(new THREE.ConeGeometry(1, 5, 16), new THREE.MeshBasicMaterial({ color: 0x8bceff }));
    engine.rotation.x = Math.PI / 2; engine.position.set(x, 0, 9.6); root.add(engine);
  }
  // Recessed underside hangars are also the actual interceptor launch origins.
  for (const side of [-1, 1]) {
    const x = side * 5.6;
    box([3.4, 0.18, 3.2], [x, -2.45, -0.8], armor);
    box([3.4, 0.18, 3.2], [x, -4, -0.8], armor);
    for (const edge of [-1, 1]) {
      box([0.18, 1.55, 3.2], [x + edge * 1.6, -3.22, -0.8], hull);
      box([0.09, 1.35, 0.09], [x + edge * 1.48, -3.22, -2.46], windows);
    }
    box([3.1, 1.35, 0.12], [x, -3.22, 0.7], hangarDark);
    box([2.9, 0.08, 0.12], [x, -3.88, -2.46], windows);
    const bay = new THREE.Object3D(); bay.name = `InterceptorLaunchBay-${side}`;
    bay.position.set(x, -3.22, -2.65); root.add(bay); launchBays.push(bay);
  }
  // Layered armor, recessed service channels, bridge glazing, batteries, and engine bells.
  for (const side of [-1, 1]) {
    for (let z = -3; z <= 5; z += 2) {
      box([5.4, 0.24, 1.65], [side * 6, 2.45, z], hull);
      box([0.18, 3.7, 1.55], [side * 9.05, 0, z], armor);
      box([0.06, 0.14, 1.2], [side * 9.17, 0.5, z], windows);
      box([1.1, 0.6, 1.2], [side * 4.2, 2.8, z], armor);
      for (const dx of [-0.24, 0.24]) box([0.12, 0.14, 1.6], [side * 4.2 + dx, 3.15, z - 0.6], hull);
    }
    box([0.25, 1.1, 13], [side * 3.15, 0, -0.5], armor);
    for (let z = -5; z < 6; z += 1) box([0.1, 0.2, 0.45], [side * 3.31, 0, z], reactorGlow);
    box([1.8, 0.5, 3.5], [side * 1.8, 2.6, 2], hull);
    box([0.12, 3, 0.12], [side * 1.5, 5.1, 1], armor);
    for (const y of [-0.9, 0.9]) {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 1.5, 20, 1, true), armor);
      bell.rotation.x = Math.PI / 2; bell.position.set(side * 6, y, 6.5); root.add(bell);
    }
    for (const x of [0.4, 0.9, 1.4]) box([0.26, 0.2, 0.04], [side * x, 3.45, -2.55], windows);
  }
  box([2, 0.8, 2.8], [0, 4, 1.4], armor);
  box([2.5, 0.35, 0.06], [0, 4.12, -0.03], windows);
  box([0.25, 1.8, 10], [0, -2.65, 1], armor);
  function target(position: [number, number, number], radius: number, health: number, color: number): WeakPoint {
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 12), material);
    mesh.position.set(...position); mesh.name = 'CapitalWeakPoint'; root.add(mesh);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.5, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color }));
    ring.position.copy(mesh.position); ring.position.z -= radius * 0.4; root.add(ring);
    return { mesh, ring, health, max: health };
  }
  const generators = [-6, 6].flatMap(x => [-1.8, 1.8].map(y => target([x, y, -8.3], 1.05, GENERATOR_HP, 0xffbb44)));
  const core = target([0, 0, -7.6], 1.65, CORE_HP, 0xff4466); core.mesh.visible = false; core.ring.visible = false;
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.3 }));
  shield.position.copy(core.mesh.position); shield.visible = false; root.add(shield);
  return { root, bow, launchBays, generators, core, shield, fireCd: 2.8, volley: 0 };
}

export function createScene({ entryState, onTransition, startAt }: { entryState?: LaunchState; onTransition: (state: FlightExitState) => void; startAt?: 'scrambler' }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x01040b);
  const physics = createScenePhysics(), physicsWorld = physics.world; physicsWorld.gravity.set(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.1, 50000);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 2, z: 0 } });
  if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, heldKeys: [], crouching: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties();
  const ship = createEscapeShip(); ship.setFlying(true, true); ship.setThrust(1.5); scene.add(ship.root);
  let launch = entryState?.launch;
  if (launch) { ship.root.position.copy(launch.shipPosition); ship.root.quaternion.copy(launch.shipQuaternion); }
  const planetPosition = new THREE.Vector3(0, 120, 14000);
  const planet = addPlanetBackdrop(scene, planetPosition, FLIGHT_RULES.planetRadius, 30000); planet.visible = false;
  const starfield = scene.getObjectByName('Starfield');
  scene.add(new THREE.HemisphereLight(0xa3cfff, 0x181321, 2));
  const sun = new THREE.DirectionalLight(0xffecd8, 3.5); sun.position.set(-5000, 7000, -2500); scene.add(sun);

  const el = (id: string) => document.getElementById(id);
  const hud = el('flight-hud'), healthFill = el('space-health-fill'), healthLabel = el('space-health-label');
  const healthTrack = el('space-health-track'), speedLabel = el('flight-speed'), objective = el('flight-objective');
  const crosshair = el('space-crosshair'), bossHud = el('space-boss-hud'), bossFill = el('space-boss-fill');
  const bossLabel = el('space-boss-label'), bossTrack = el('space-boss-track'), enemyCount = el('space-enemy-count'), alert = el('space-alert');
  let controlsMode = ''; 
  const damageOverlay = el('space-damage'), pausePanel = el('space-pause'), pauseTitle = el('space-pause-title'), pauseHint = el('space-pause-hint');
  const controls = el('flight-controls'), rollLabel = el('space-roll-status'), threatLabel = el('space-threat');
  const ownedHud = [hud, controls, crosshair, bossHud, enemyCount, alert, damageOverlay, pausePanel];
  for (const node of [hud, controls, crosshair, enemyCount, alert, damageOverlay]) node?.classList.remove('hidden');
  for (const id of ['flight-target', 'boss-subtitles', 'boss-hud', 'escape-qte', 'loading-bay-status', 'interact-prompt']) el(id)?.classList.add('hidden');
  document.body.classList.add('space-flight');
  // Free screen-space aiming, with the native cursor hidden only over active flight.
  function releasePointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  releasePointerLock();

  let phase: Phase = 'combat';
  let clock = 0, phaseClock = 0, railZ = launch?.shipPosition.z ?? 0, spawned = 0, totalKilled = 0, spawnCd = 0;
  let deathClock = 0;
  let playerHp = PLAYER_MAX_HP, invulnerability = 0, damageFlash = 0, hitFlash = 0, fireCd = 0;
  let paused = false, disposed = false, transferred = false, firing = false, cockpitView = false;
  let rollCd = 0, rollTime = 0, rollSign = 1, sideEvadeSign = -1, alertTime = 0;
  let boss: Boss | null = null, pod: THREE.Group | null = null;
  let bossMotionTime = 0, bossDepth = 340;
  const bossArrivalStart = new THREE.Vector3(), bossArrivalRotation = new THREE.Quaternion();
  const neutralBossRotation = new THREE.Quaternion();
  const audioManager = new AudioManager({ camera, getFile: (path: string) => path === 'level-2' ? { content: level2BgmUrl } : null });
  let musicPaused = true;
  let sidescroll: ReturnType<typeof createSidescrollPhase> | null = null;
  let rocketCooldown = 3.2;
  const keys = new Set<string>(), velocity = new THREE.Vector2(), dash = new THREE.Vector2();
  const aim = new THREE.Vector2(0, 0), raycaster = new THREE.Raycaster(); raycaster.far = 1200;
  const fighters: Fighter[] = [];
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8), beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xffd074, transparent: true, opacity: 0.9, depthWrite: false });
  const boltMaterial = new THREE.MeshBasicMaterial({ color: 0x66ff88 });
  type Bolt = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; damage: number };
  type Flash = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; life: number; duration: number; size: number; beam: boolean };
  const bolts: Bolt[] = [], flashes: Flash[] = [];
  const playerShots = Array.from({ length: 96 }, () => {
    const mesh = new THREE.Mesh(beamGeo, beamMaterial); mesh.visible = false; mesh.scale.set(0.22, 14, 0.22); scene.add(mesh);
    return { mesh, direction: new THREE.Vector3(0, 0, 1), life: 0 };
  });
  const rocketGeometry = new THREE.ConeGeometry(1.3, 5, 8), rocketMaterial = new THREE.MeshBasicMaterial({ color: 0xff7050 });
  const markerGeometry = new THREE.RingGeometry(10.5, 11, 32), markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff7755, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  const rockets = Array.from({ length: 12 }, () => {
    const mesh = new THREE.Mesh(rocketGeometry, rocketMaterial), marker = new THREE.Mesh(markerGeometry, markerMaterial);
    const blast = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xff7850, transparent: true, opacity: 0.8, depthWrite: false }));
    mesh.visible = marker.visible = blast.visible = false; scene.add(mesh, marker, blast);
    return { mesh, marker, blast, velocity: new THREE.Vector3(), target: new THREE.Vector3(), life: 0, delay: 0, blastAge: -1, damaged: false };
  });
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
  function clearBolts() {
    for (const bolt of bolts) scene.remove(bolt.mesh); bolts.length = 0;
    playerShots.forEach(s => { s.life = 0; s.mesh.visible = false; });
    rockets.forEach(r => { r.life = 0; r.blastAge = -1; r.mesh.visible = r.marker.visible = r.blast.visible = false; });
  }
  function clearInput() {
    keys.clear(); firing = false; velocity.set(0, 0); dash.set(0, 0); rollTime = 0;
    aim.set(0, 0); resetTouchInput(); showCrosshair();
  }
  function combatLive() {
    return phase === 'combat' || phase === 'bossArmor' || phase === 'bossCore' || (phase === 'scrambler' && !!sidescroll?.active);
  }
  function inputBlocked() { return document.hidden || document.body.classList.contains('quick-menu-open'); }
  function showCrosshair() {
    if (crosshair) { crosshair.style.left = `${(aim.x + 1) * 50}%`; crosshair.style.top = `${(1 - aim.y) * 50}%`; }
  }
  function syncMusic() {
    const shouldPause = disposed || transferred || paused || inputBlocked();
    if (musicPaused === shouldPause) return;
    musicPaused = shouldPause;
    if (shouldPause) audioManager.pauseBgm(); else audioManager.playBgm();
  }
  function setPaused(value: boolean) {
    paused = value; clearInput(); syncMusic();
    document.body.classList.toggle('space-paused', value);
    if (value) releasePointerLock();
    updateHud();
  }
  function interactiveTarget(event: Event) { return event.target instanceof HTMLElement && !!event.target.closest('button, input, textarea, select, [contenteditable="true"]'); }
  function onKeyDown(event: KeyboardEvent) {
    if (disposed || transferred || interactiveTarget(event) || inputBlocked()) return;
    if (event.code === 'Escape' && !event.repeat) { event.preventDefault(); setPaused(!paused); return; }
    if (paused || !combatLive()) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyV' && phase !== 'scrambler' && phase !== 'bossArrival') { cockpitView = !cockpitView; cameraView(); }
    if ((phase === 'scrambler' && !sidescroll?.active) || phase === 'bossArrival') return;
    if (event.code === 'Space' && rollCd <= 0) {
      const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const y = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      if (phase === 'scrambler') {
        // Latch a vertical dodge, even if Space is pressed without movement.
        const fallback = ship.root.position.y > 65 ? -1 : ship.root.position.y < -60 ? 1 : -sideEvadeSign;
        sideEvadeSign = y || fallback;
        dash.set(0, sideEvadeSign);
      } else {
        rollSign = x || (ship.root.position.x > 0 ? 1 : -1);
        dash.set(-x || (y ? 0 : -rollSign), y).normalize();
      }
      rollCd = 3; rollTime = 0.42; invulnerability = 0.45;
      unlockAudio(); tone(650, 100, 0.25);
    }
  }
  function onKeyUp(event: KeyboardEvent) { keys.delete(event.code); }
  function onMouseMove(event: MouseEvent) {
    if (disposed || paused || inputBlocked() || !combatLive() || phase === 'scrambler') return;
    aim.set(THREE.MathUtils.clamp(event.clientX / window.innerWidth * 2 - 1, -1, 1), THREE.MathUtils.clamp(1 - event.clientY / window.innerHeight * 2, -1, 1));
    showCrosshair();
  }
  function onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || disposed || transferred || interactiveTarget(event) || inputBlocked()) return;
    if (paused) { setPaused(false); return; }
    if (combatLive()) { onMouseMove(event); unlockAudio(); firing = true; }
  }
  function onMouseUp(event: MouseEvent) { if (event.button === 0) firing = false; }
  function onBlur() { if (!disposed && !transferred) setPaused(true); }
  function onVisibility() { if (document.hidden) onBlur(); }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove); window.addEventListener('mousedown', onMouseDown); window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('pointerlockchange', releasePointerLock);

  function createCarrier() {
    boss = createBossMesh(); boss.root.position.set(-90, 45, railZ + 1000); scene.add(boss.root);
  }
  function updateDistantCarrier() {
    if (!boss || phase !== 'combat') return;
    boss.root.position.set(-90 + Math.sin(clock * 0.11) * 24, 45 + Math.sin(clock * 0.17) * 9, railZ + 1000);
    boss.root.rotation.set(0, Math.sin(clock * 0.13) * 0.035, Math.sin(clock * 0.1) * 0.025);
    boss.root.updateMatrixWorld(true);
  }
  function spawnFighter() {
    if (!boss) return;
    const { root, eye } = createFighterMesh();
    const laneX = (spawned % 3 - 1) * 40 + (Math.random() - 0.5) * 12;
    const laneY = (Math.floor(spawned / 3) % 2 ? 1 : -1) * 22;
    boss.launchBays[spawned % boss.launchBays.length].getWorldPosition(root.position);
    root.position.z -= 3; scene.add(root);
    const start = root.position.clone(); start.z -= railZ;
    const loop = new THREE.CubicBezierCurve3(start, start.clone().add(new THREE.Vector3(0, 0, -150)),
      new THREE.Vector3(laneX, laneY, 600), new THREE.Vector3(laneX, laneY, 440));
    fighters.push({ root, eye, health: FIGHTER_HP, fireCd: 0.8 + spawned % 6 * 0.35, laneX, laneY, seed: spawned * 1.7, state: 'launch', loop, loopTime: 0 });
    burst(root.position, 4, 0x9bdfff); spawned++;
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
      if ((f.state === 'launch' || f.state === 'regroup') && f.loop) {
        f.loopTime += dt / (f.state === 'launch' ? 3.2 : 3.4); f.loop.getPoint(Math.min(1, f.loopTime), f.root.position); f.root.position.z += railZ;
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
    if (!boss) return;
    // Promote the visible carrier into the encounter without replacing or teleporting it.
    bossArrivalStart.copy(boss.root.position); bossArrivalStart.z -= railZ;
    bossArrivalRotation.copy(boss.root.quaternion); bossMotionTime = 0; bossDepth = 340;
    if (corePhase) {
      boss.root.position.set(0, 4, railZ + bossDepth); boss.root.quaternion.identity();
      for (const target of boss.generators) { target.health = 0; target.mesh.visible = false; target.ring.visible = false; }
      boss.bow.visible = false; boss.shield.visible = false; boss.core.mesh.visible = true; boss.core.ring.visible = true;
    }
    phase = corePhase ? 'bossCore' : 'bossArrival'; phaseClock = 0; cockpitView = false;
    invulnerability = 2; clearBolts(); clearInput();
    announce(corePhase ? 'FINAL PHASE / EXPOSED REACTOR' : 'CAPITAL SHIP INBOUND / UNKNOWN WEAPON CHARGING', 3.5);
  }
  function updateBoss(dt: number) {
    if (!boss || (phase !== 'bossArmor' && phase !== 'bossCore')) return;
    // Wide crossing runs, altitude changes and depth variation require active aim.
    // This clock starts at the sidescroller exit pose and continues through core exposure.
    bossMotionTime += dt * (phase === 'bossCore' ? 1.28 : 1);
    const t = bossMotionTime, previousX = boss.root.position.x;
    boss.root.position.x = THREE.MathUtils.damp(previousX, Math.sin(t * 0.65) * 78 + Math.sin(t * 1.19) * 18, 2.2, dt);
    boss.root.position.y = THREE.MathUtils.damp(boss.root.position.y, 4 + Math.sin(t * 0.87) * 30 + Math.sin(t * 0.39) * 10, 2.2, dt);
    bossDepth = THREE.MathUtils.damp(bossDepth, 340 + Math.sin(t * 0.45) * 38, 1.8, dt);
    boss.root.position.z = railZ + bossDepth;
    const strafeSpeed = (boss.root.position.x - previousX) / Math.max(dt, 0.001);
    boss.root.rotation.x = THREE.MathUtils.damp(boss.root.rotation.x, -Math.sin(t * 0.87) * 0.06, 2, dt);
    boss.root.rotation.y = THREE.MathUtils.damp(boss.root.rotation.y, Math.sin(t * 0.65) * 0.14, 2, dt);
    boss.root.rotation.z = THREE.MathUtils.damp(boss.root.rotation.z, THREE.MathUtils.clamp(-strafeSpeed * 0.002, -0.14, 0.14), 2, dt);
    boss.root.updateMatrixWorld(true);
    boss.fireCd -= dt;
    if (phase === 'bossCore') {
      boss.shield.visible = phaseClock % 6 < 1.7;
      boss.shield.scale.setScalar(1 + Math.sin(clock * 8) * 0.06);
    }
    const charging = boss.fireCd < 0.65;
    for (const target of [...boss.generators, boss.core]) {
      if (target.health <= 0) continue;
      target.ring.rotation.z += dt * 0.7;
      target.mesh.material.color.setHex(charging ? 0xffffff : target === boss.core ? 0xff4466 : 0xffbb44);
    }
    if (boss.fireCd > 0) return;
    boss.fireCd = phase === 'bossCore' ? 1.15 : 1.7; boss.volley++;
    const from = boss.root.localToWorld(new THREE.Vector3(boss.volley % 2 ? -6 : 6, -1.8, -9));
    const aimAt = ship.root.position.clone().add(new THREE.Vector3(0, 1, 0));
    // Alternate aimed fans with walls that have a generous, readable dodge lane.
    if (boss.volley % (phase === 'bossCore' ? 2 : 3) === 0) {
      const vertical = phase === 'bossCore' && boss.volley % 4 === 0;
      const gap = boss.volley % 6 === 0 ? -25 : 25;
      for (let x = -60; x <= 60; x += 12) for (let y = -36; y <= 36; y += 12) {
        if (Math.abs((vertical ? y : x) - gap) < 16) continue;
        launchBolt(new THREE.Vector3(x, y, railZ + 245), new THREE.Vector3(x, y, railZ), 18, 195);
      }
      announce(vertical ? (gap < 0 ? 'BARRAGE / DIVE' : 'BARRAGE / CLIMB') : gap < 0 ? 'BARRAGE / DODGE RIGHT' : 'BARRAGE / DODGE LEFT', 1.3);
    } else {
      aimAt.x += velocity.x * 0.35; aimAt.y += velocity.y * 0.35;
      for (const offset of phase === 'bossCore' ? [-27, -18, -9, 0, 9, 18, 27] : [-20, -10, 0, 10, 20]) {
        launchBolt(from, aimAt.clone().add(new THREE.Vector3(offset, 0, 0)), 18, 235);
      }
      if (phase === 'bossCore') {
        const other = boss.root.localToWorld(new THREE.Vector3(boss.volley % 2 ? 6 : -6, 1.8, -9));
        for (const y of [-14, 0, 14]) launchBolt(other, aimAt.clone().add(new THREE.Vector3(0, y, 0)), 18, 235);
      }
    }
  }
  function damageWeakPoint(target: WeakPoint) {
    if (!boss || (phase !== 'bossArmor' && phase !== 'bossCore') || target.health <= 0 || (target === boss.core && boss.shield.visible)) return;
    target.health = Math.max(0, target.health - SHOT_DAMAGE);
    if (target.health > 0) return;
    target.mesh.visible = false; target.ring.visible = false;
    burst(target.mesh.getWorldPosition(new THREE.Vector3()), 14);
    if (phase === 'bossArmor' && boss.generators.every(t => t.health <= 0)) {
      phase = 'bossCore'; phaseClock = 1.7;
      boss.bow.visible = false;
      boss.shield.visible = false; boss.core.mesh.visible = true; boss.core.ring.visible = true;
      boss.fireCd = 2; clearBolts();
      announce('REACTOR EXPOSED / FIRE BETWEEN SHIELD PULSES', 3);
    } else if (phase === 'bossCore' && target === boss.core) {
      phase = 'victory'; phaseClock = 0; clearInput(); clearBolts();
      planetPosition.set(0, 200, railZ + 14000); planet.position.copy(planetPosition); planet.visible = true;
      pod = createEscapePod(); pod.position.copy(boss.root.position).add(new THREE.Vector3(0, 16, 0));
      pod.quaternion.setFromUnitVectors(MODEL_FORWARD, planetPosition.clone().sub(pod.position).normalize()); scene.add(pod);
      burst(boss.root.position, 65); boss.root.visible = false;
      announce('CAPITAL SHIP DESTROYED / ESCAPE POD DETECTED', 3);
    }
  }

  function firePlayerLaser() {
    tone(1200, 250, 0.065, 0.018);
    const shot = playerShots.find(s => s.life <= 0); if (!shot) return;
    scene.updateMatrixWorld(true);
    const muzzle = phase === 'scrambler' ? ship.root.position.clone().add(new THREE.Vector3(0, 1, 10)) : ship.root.localToWorld(new THREE.Vector3(Math.sin(clock * 70) > 0 ? -2.4 : 2.4, 1.1, -3.8));
    raycaster.setFromCamera(aim, camera);
    if (phase === 'scrambler') shot.direction.set(0, 0, 1);
    else {
      const hit = raycaster.intersectObjects(shotTargets(), true).find(validShotSurface);
      shot.direction.copy(hit?.point ?? raycaster.ray.at(950, new THREE.Vector3())).sub(muzzle).normalize();
    }
    shot.mesh.position.copy(muzzle); shot.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shot.direction);
    shot.mesh.visible = true; shot.life = 1.25;
  }
  function shotTargets(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = fighters.filter(f => f.health > 0).map(f => f.root);
    if (boss) roots.push(boss.root);
    if (sidescroll?.active) roots.push(sidescroll.device);
    return roots;
  }
  function validShotSurface(hit: THREE.Intersection) {
    for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) if (!object.visible) return false;
    if (hit.object instanceof THREE.Mesh && hit.object.material instanceof THREE.Material && hit.object.material.transparent && hit.object.material.opacity < 0.2) return false;
    return !boss || ![...boss.generators, boss.core].some(t => t.ring === hit.object);
  }
  function hitPlayerShot(hit: THREE.Intersection) {
    const point = hit.point;
    if (sidescroll?.active) {
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
        if (node === sidescroll.device) {
          sidescroll.damage(SHOT_DAMAGE); hitFlash = 0.12;
          if (!sidescroll.active) { clearBolts(); clearInput(); announce('SCRAMBLER DESTROYED / RESTORING FLIGHT AXES', 3.2); }
          return;
        }
      }
      sidescroll.shieldHit(point); burst(point, 3, 0x66ff99); return;
    }
    let fighter: Fighter | undefined;
    for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
      fighter = fighters.find(f => f.root === object); if (fighter) break;
    }
    if (fighter) {
      fighter.health = Math.max(0, fighter.health - SHOT_DAMAGE); hitFlash = 0.12; burst(point, 2, 0xffe4a3);
      if (fighter.health === 0) {
        totalKilled++; fighter.root.visible = false; burst(fighter.root.position, 11); tone(130, 35, 0.22, 0.06);
        // Hull damage persists for the entire sortie.
      }
      return;
    }
    const target = boss && [...boss.generators, boss.core].find(t => t.mesh === hit.object);
    if (target && target.health > 0 && (phase === 'bossArmor' ? target !== boss!.core : target === boss!.core)) {
      hitFlash = 0.12; burst(point, 3, 0xffffff); damageWeakPoint(target);
    } else {
      burst(point, 2, 0x77bbff);
      if (alertTime <= 0) announce(phase === 'combat' ? 'CARRIER PROTECTED / CLEAR THE INTERCEPTORS' : 'ARMORED / AIM AT THE GLOWING TARGETS', 0.7);
    }
  }
  function updatePlayerShots(dt: number) {
    scene.updateMatrixWorld(true);
    const targets = shotTargets();
    for (const shot of playerShots) {
      if (shot.life <= 0) continue;
      shot.mesh.position.z += FLIGHT_RULES.cruise * dt;
      raycaster.set(shot.mesh.position, shot.direction); raycaster.near = 0; raycaster.far = 950 * dt + 7;
      const hit = raycaster.intersectObjects(targets, true).find(validShotSurface);
      shot.life -= dt;
      if (hit) { shot.life = 0; hitPlayerShot(hit); }
      else shot.mesh.position.addScaledVector(shot.direction, 950 * dt);
      shot.mesh.visible = shot.life > 0;
    }
    raycaster.far = 1200;
  }
  function updateRockets(dt: number) {
    if (boss && (phase === 'bossArmor' || phase === 'bossCore')) {
      rocketCooldown -= dt;
      if (rocketCooldown <= 0) {
        rocketCooldown = phase === 'bossCore' ? 3.3 : 4.5;
        announce('ROCKETS LOCKED / MOVE OUT OF THE ORANGE RINGS', 1.4);
        for (const side of [-1, 1]) {
          const rocket = rockets.find(r => r.life <= 0 && r.blastAge < 0); if (!rocket) break;
          rocket.mesh.position.copy(boss.root.localToWorld(new THREE.Vector3(side * 6, 0, -8)));
          rocket.target.copy(ship.root.position).add(new THREE.Vector3(side * 7 + velocity.x * 0.2, velocity.y * 0.2, 0));
          rocket.velocity.copy(rocket.target).sub(rocket.mesh.position).normalize().multiplyScalar(220).addScaledVector(FORWARD, FLIGHT_RULES.cruise);
          rocket.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rocket.velocity.clone().addScaledVector(FORWARD, -FLIGHT_RULES.cruise).normalize());
          rocket.life = 6; rocket.delay = 0.8; rocket.marker.position.copy(rocket.target); rocket.mesh.visible = rocket.marker.visible = true;
        }
      }
    }
    for (const rocket of rockets) {
      if (rocket.blastAge >= 0) {
        rocket.blastAge += dt; rocket.blast.position.z += FLIGHT_RULES.cruise * dt;
        if (rocket.blastAge >= 0.55) { rocket.blastAge = -1; rocket.blast.visible = false; continue; }
        const radius = 11 * THREE.MathUtils.smoothstep(rocket.blastAge, 0, 0.18);
        rocket.blast.scale.setScalar(radius);
        rocket.blast.material.opacity = 0.8 * (1 - THREE.MathUtils.smoothstep(rocket.blastAge, 0.2, 0.55));
        if (!rocket.damaged && rocket.blast.position.distanceToSquared(ship.root.position) <= radius * radius) {
          rocket.damaged = true; damagePlayer(26);
          if (!combatLive()) break;
        }
        continue;
      }
      if (rocket.life <= 0) continue;
      rocket.life -= dt; rocket.marker.position.z += FLIGHT_RULES.cruise * dt;
      if (rocket.delay > 0) { rocket.delay -= dt; rocket.mesh.position.z += FLIGHT_RULES.cruise * dt; rocket.marker.scale.setScalar(1 + Math.sin(clock * 18) * 0.07); continue; }
      const previous = rocket.mesh.position.clone(), before = previous.z - oldShipPosition.z;
      rocket.mesh.position.addScaledVector(rocket.velocity, dt);
      const after = rocket.mesh.position.z - ship.root.position.z;
      if (before > 0 && after <= 0) {
        const contact = before / (before - after);
        rocket.blast.position.lerpVectors(previous, rocket.mesh.position, contact);
        rocket.blast.position.z += FLIGHT_RULES.cruise * dt * (1 - contact);
        rocket.blastAge = 0; rocket.damaged = false; rocket.blast.scale.setScalar(0);
        rocket.blast.material.opacity = 0.8; rocket.blast.visible = true; rocket.life = 0;
      }
      if (rocket.life <= 0) rocket.mesh.visible = rocket.marker.visible = false;
    }
  }
  function damagePlayer(amount: number) {
    if (invulnerability > 0 || phase === 'dead' || phase === 'victory' || phase === 'bossArrival' || (phase === 'scrambler' && !sidescroll?.active)) return;
    playerHp = Math.max(0, playerHp - amount); invulnerability = 0.55; damageFlash = 0.7; tone(90, 30, 0.24, 0.08);
    if (playerHp === 0) {
      phase = 'dead'; deathClock = 1.8; paused = false; ship.root.visible = false; clearInput(); clearBolts(); burst(ship.root.position, 14);
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
      const radius = phase === 'scrambler' ? 5.5 : 3.2;
      const hit = segment.closestPointToPoint(new THREE.Vector3(0, 1, 0), true, temp).distanceToSquared(new THREE.Vector3(0, 1, 0)) < radius * radius;
      if (hit || bolt.life <= 0 || bolt.mesh.position.z < ship.root.position.z - 55) {
        scene.remove(bolt.mesh); bolts.splice(i, 1);
        if (hit) { damagePlayer(bolt.damage); if (phase === 'dead') break; }
      }
    }
  }
  function restartScene() {
    sidescroll?.dispose(); sidescroll = null; rocketCooldown = 3.2;
    for (const f of fighters) { scene.remove(f.root); disposeRoomForGroup(f.root); }
    fighters.length = 0;
    if (boss) { scene.remove(boss.root); disposeRoomForGroup(boss.root); boss = null; }
    clearBolts(); playerHp = PLAYER_MAX_HP; invulnerability = 2; damageFlash = 0; hitFlash = 0;
    for (const f of flashes) { scene.remove(f.mesh); if (!f.beam) f.mesh.material.dispose(); } flashes.length = 0;
    if (pod) { scene.remove(pod); disposeRoomForGroup(pod); pod = null; }
    launch = undefined; clock = phaseClock = railZ = spawned = totalKilled = spawnCd = deathClock = 0;
    ship.root.position.set(0, 0, 0); ship.root.rotation.set(0, Math.PI, 0); ship.root.visible = true;
    velocity.set(0, 0); dash.set(0, 0); aim.set(0, 0); rollTime = rollCd = fireCd = 0; cockpitView = false;
    planet.visible = false; phase = 'combat'; setPaused(false);
    bossMotionTime = 0; bossDepth = 340; sideEvadeSign = -1;
    createCarrier(); spawnFighter(); spawnCd = 0.8;
    cameraView(); showCrosshair(); announce('SORTIE RESTARTED / INTERCEPTORS INBOUND', 2);
  }
  function disposeRoomForGroup(group: THREE.Group) {
    const holder = new THREE.Scene(); holder.add(group); disposeRoom(holder); holder.remove(group);
  }
  function cameraView() {
    if (phase === 'scrambler' && sidescroll) { sidescroll.applyCamera(); return; }
    ship.root.updateMatrixWorld(true); camera.up.set(0, 1, 0);
    if (cockpitView) {
      camera.position.copy(ship.root.position).add(new THREE.Vector3(0, 2.2, 1));
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0, 300)));
    } else {
      camera.position.set(ship.root.position.x * 0.65, ship.root.position.y * 0.8 + 12, railZ - 34);
      camera.lookAt(new THREE.Vector3(ship.root.position.x * 0.65, ship.root.position.y * 0.8 + 6, railZ + 260));
    }
    if (launch && clock < 2.5 && !cockpitView) {
      const t = THREE.MathUtils.smootherstep(clock, 0, 2.5);
      const start = launch.cameraPosition.clone().add(ship.root.position.clone().sub(launch.shipPosition));
      camera.position.lerpVectors(start, camera.position.clone(), t);
      camera.quaternion.slerpQuaternions(launch.cameraQuaternion, camera.quaternion.clone(), t);
      camera.fov = THREE.MathUtils.lerp(launch.cameraFov, 76, t);
    } else camera.fov = 76;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function updateHud() {
    const dead = phase === 'dead', won = phase === 'victory';
    const pct = playerHp / PLAYER_MAX_HP;
    if (healthFill) { healthFill.style.width = `${pct * 100}%`; healthFill.classList.toggle('low', pct <= 0.3); }
    healthTrack?.setAttribute('aria-valuenow', String(playerHp));
    if (healthLabel) healthLabel.textContent = `${playerHp} / ${PLAYER_MAX_HP}`;
    if (speedLabel) speedLabel.textContent = `AUTO THRUST / ${Math.round(launch ? THREE.MathUtils.lerp(launch.speed, FLIGHT_RULES.cruise, THREE.MathUtils.smootherstep(clock, 0, 2.5)) : FLIGHT_RULES.cruise)} m/s`;
    if (objective) objective.textContent = phase === 'bossArrival' ? 'CAPITAL SHIP INBOUND' : phase === 'scrambler' ? '15.5 / DESTROY THE SIDESCROLL SCRAMBLER' : phase === 'combat' ? 'CLEAR THE INTERCEPTORS' : phase === 'bossArmor' ? 'BREAK THE FOUR SHIELD GENERATORS' : phase === 'bossCore' ? 'DESTROY THE EXPOSED REACTOR' : won ? 'FOLLOW THE ESCAPE POD' : 'HULL LOST';
    if (rollLabel) rollLabel.textContent = rollCd <= 0
      ? phase === 'scrambler' ? 'SPACE / VERTICAL DODGE READY' : 'SPACE / EVASIVE ROLL READY'
      : `EVADE RECHARGING / ${rollCd.toFixed(1)}s`;
    if (threatLabel) {
      const incoming = bolts.filter(b => b.mesh.position.z > railZ && b.mesh.position.z < railZ + 500).length;
      threatLabel.textContent = incoming ? `INCOMING LASERS / ${incoming}` : 'WATCH FOR GREEN LASER FIRE';
      threatLabel.classList.toggle('incoming', incoming > 0);
    }
    if (enemyCount) {
      enemyCount.textContent = `INTERCEPTORS ${totalKilled} / ${TOTAL_FIGHTERS}`;
      enemyCount.classList.toggle('hidden', phase !== 'combat');
    }
    bossHud?.classList.toggle('hidden', phase !== 'bossArmor' && phase !== 'bossCore' && phase !== 'scrambler');
    if (boss) {
      const targets = phase === 'bossCore' ? [boss.core] : boss.generators;
      const health = targets.reduce((sum, t) => sum + t.health, 0), max = targets.reduce((sum, t) => sum + t.max, 0);
      if (bossFill) bossFill.style.width = `${health / max * 100}%`;
      bossTrack?.setAttribute('aria-valuenow', String(Math.round(health / max * 100)));
      bossTrack?.setAttribute('aria-label', phase === 'bossCore' ? 'Capital ship reactor health' : 'Capital ship shield generator health');
      if (bossLabel) bossLabel.textContent = phase === 'bossCore' ? (boss.shield.visible ? 'PHASE 2 / REACTOR SHIELD PULSE — EVADE' : 'PHASE 2 / REACTOR EXPOSED — FIRE') : `PHASE 1 / SHIELDS ${targets.filter(t => t.health > 0).length}/4`;
    }
    if (phase === 'scrambler' && sidescroll) {
      if (bossFill) bossFill.style.width = `${sidescroll.health / SCRAMBLER_HEALTH * 100}%`;
      if (bossLabel) bossLabel.textContent = 'SIDESCROLL SCRAMBLER / BOSS HULL BLOCKS YOUR SHOTS';
      bossTrack?.setAttribute('aria-valuenow', String(Math.round(sidescroll.health / SCRAMBLER_HEALTH * 100)));
      bossTrack?.setAttribute('aria-label', 'Sidescroll Scrambler health');
    }
    const nextControlsMode = phase === 'scrambler' ? 'side' : 'normal';
    if (controls && controlsMode !== nextControlsMode) {
      controlsMode = nextControlsMode;
      controls.innerHTML = nextControlsMode === 'side'
        ? '<div>WASD / arrows: move | Hold LMB: fire straight</div><div>W/S + Space: dodge up/down | Space alone: alternate dodge</div>'
        : '<div>WASD: dodge · Mouse: aim · Hold LMB: fire</div><div>Space: evade · V: view · Esc: pause</div>';
    }
    crosshair?.classList.toggle('hidden', paused || dead || won || phase === 'scrambler' || phase === 'bossArrival');
    crosshair?.setAttribute('data-hit', String(hitFlash > 0));
    if (damageOverlay) damageOverlay.style.opacity = String(Math.min(0.8, damageFlash + (pct <= 0.3 ? 0.1 : 0)));
    alert?.classList.toggle('hidden', alertTime <= 0 || paused || dead);
    controls?.classList.toggle('hidden', won || dead);
    pausePanel?.classList.toggle('hidden', !paused && !dead);
    if (pauseTitle) pauseTitle.textContent = dead ? 'SHUTTLE DESTROYED' : 'FLIGHT PAUSED';
    if (pauseHint) pauseHint.textContent = dead ? 'Restarting sortie...' : 'Click or Escape to resume';
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
    if (phase === 'dead') {
      deathClock -= dt; updateEffects(dt);
      if (deathClock <= 0) restartScene();
      return;
    }
    clock += dt; phaseClock += dt; oldShipPosition.copy(ship.root.position);
    invulnerability = Math.max(0, invulnerability - dt); damageFlash = Math.max(0, damageFlash - dt * 1.8);
    hitFlash = Math.max(0, hitFlash - dt); alertTime = Math.max(0, alertTime - dt);
    rollCd = Math.max(0, rollCd - dt); rollTime = Math.max(0, rollTime - dt);
    {
      railZ += (launch ? THREE.MathUtils.lerp(launch.speed, FLIGHT_RULES.cruise, THREE.MathUtils.smootherstep(clock, 0, 2.5)) : FLIGHT_RULES.cruise) * dt;
      const horizontal = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const vertical = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      if (phase === 'scrambler' && sidescroll) {
        const wasActive = sidescroll.active;
        sidescroll.update(dt, railZ, horizontal, vertical, rollTime > 0 ? dash.y : 0);
        if (wasActive !== sidescroll.active) { clearBolts(); clearInput(); }
        if (sidescroll.stage === 'done') {
          sidescroll.dispose(); sidescroll = null; phase = 'bossArmor'; phaseClock = 0;
          clearInput(); clearBolts(); invulnerability = 1.5;
          announce('SCRAMBLER DESTROYED / BREAK THE FOUR SHIELD GENERATORS', 3);
        }
      } else {
      const input = new THREE.Vector2(-horizontal, vertical); if (input.lengthSq() > 1) input.normalize();
      velocity.x = THREE.MathUtils.damp(velocity.x, input.x * FLIGHT_RULES.dodgeSpeed, 12, dt);
      velocity.y = THREE.MathUtils.damp(velocity.y, input.y * FLIGHT_RULES.dodgeSpeed, 12, dt);
      ship.root.position.x = THREE.MathUtils.clamp(ship.root.position.x + (velocity.x + (rollTime > 0 ? dash.x * 85 : 0)) * dt, -FLIGHT_RULES.width, FLIGHT_RULES.width);
      ship.root.position.y = THREE.MathUtils.clamp(ship.root.position.y + (velocity.y + (rollTime > 0 ? dash.y * 85 : 0)) * dt, -FLIGHT_RULES.height, FLIGHT_RULES.height);
      ship.root.position.z = railZ;
      const bank = -velocity.x / FLIGHT_RULES.dodgeSpeed * 0.3 + (rollTime > 0 ? rollSign * (1 - rollTime / 0.42) * Math.PI * 2 : 0);
      ship.root.rotation.set(velocity.y / FLIGHT_RULES.dodgeSpeed * 0.1, Math.PI, bank, 'YXZ');
      }
    }
    ship.root.visible = !cockpitView;
    ship.update(dt); ship.setThrust(1.6 + Math.sin(clock * 24) * 0.1); cameraView();
    updateDistantCarrier();
    if (phase === 'combat' && (!launch || clock >= 2.5)) {
      updateFighters(dt); spawnCd -= dt;
      if (spawned < TOTAL_FIGHTERS && fighters.filter(f => f.health > 0).length < MAX_ACTIVE && spawnCd <= 0) { spawnFighter(); spawnCd = 0.8; }
      if (totalKilled === TOTAL_FIGHTERS) spawnBoss();
    }
    if (phase === 'bossArrival' && boss) {
      const t = THREE.MathUtils.smootherstep(phaseClock, 0, 3.8);
      boss.root.position.lerpVectors(bossArrivalStart, new THREE.Vector3(0, 4, 340), t); boss.root.position.z += railZ;
      boss.root.quaternion.slerpQuaternions(bossArrivalRotation, neutralBossRotation, t);
      if (phaseClock >= 3.8) {
        clearBolts(); clearInput(); phase = 'scrambler'; phaseClock = 0; cockpitView = false;
        sidescroll = createSidescrollPhase({ scene, camera, ship: ship.root, boss: boss.root, rail: railZ, shoot: launchBolt, burst });
        announce('SIDESCROLL SCRAMBLER / FLIGHT AXES COMPROMISED', 4.6);
      }
    }
    updateBoss(dt);
    if (combatLive()) {
      fireCd -= dt;
      const touchAim = consumeFlightAim();
      if (phase !== 'scrambler' && (touchAim.dx !== 0 || touchAim.dy !== 0)) {
        aim.x = THREE.MathUtils.clamp(aim.x + touchAim.dx, -1, 1);
        aim.y = THREE.MathUtils.clamp(aim.y + touchAim.dy, -1, 1);
        showCrosshair();
      }
      const touchFiring = isTouchFire();
      if ((firing || touchFiring) && fireCd <= 0) { firePlayerLaser(); fireCd = 0.11; }
      updatePlayerShots(dt);
      if (combatLive()) updateBolts(dt);
      if (combatLive()) updateRockets(dt);
    }
    if (!planet.visible) { planetPosition.z = railZ + 14000; planet.position.copy(planetPosition); }
    if (phase === 'victory' && pod) {
      pod.position.addScaledVector(planetPosition.clone().sub(pod.position).normalize(), dt * 320);
      if (phaseClock >= 2.8 && !transferred) {
        transferred = true; syncMusic();
        onTransition({ shipPosition: ship.root.position.clone(), shipQuaternion: ship.root.quaternion.clone(), podPosition: pod.position.clone(), podQuaternion: pod.quaternion.clone(), planetPosition: planetPosition.clone(), cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov, hullHealth: playerHp, pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }) });
        return;
      }
    }
    updateEffects(dt);
    player.setPosition(ship.root.position.x, ship.root.position.y + 2, ship.root.position.z);
  }

  audioManager.setBgm({ path: 'level-2', loop: true, volume: 0.45, autoplay: false });
  syncMusic();
  createCarrier();
  if (!launch && !startAt) { spawnFighter(); spawnCd = 0.8; }
  if (startAt === 'scrambler') { spawned = totalKilled = TOTAL_FIGHTERS; spawnBoss(); }
  ship.root.rotation.y = Math.PI; cameraView(); showCrosshair(); updateHud();
  if (!startAt) announce('AUTO THRUST ENGAGED / INTERCEPTORS INBOUND', 3);
  return {
    roomId: 'scene15', scene, camera, physicsWorld, player, ship, planet, cutsceneManager: null,
    isCinematic: () => true, hideCharacter: () => true,
    getSceneId: () => phase === 'scrambler' || (startAt === 'scrambler' && phase === 'bossArrival') ? 'scene15.5' : 'scene15',
    getCinematicState: () => player.getState(), applyCinematicCamera: cameraView,
    clearInput, setMenuPaused: syncMusic,
    getFlightStatus: () => ({ speed: FLIGHT_RULES.cruise, cockpitView, paused, phase, playerHp, totalKilled, spawned, bossHp: boss ? [...boss.generators, boss.core].reduce((sum, t) => sum + t.health, 0) : 0 }),
    updatePhysics(dt: number) {
      if (disposed || transferred) return;
      syncMusic();
      if (paused || inputBlocked()) return;
      let remaining = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
      // Bounded substeps preserve dodge and projectile behavior across render rates.
      while (remaining > 0 && !disposed && !transferred) { const delta = Math.min(remaining, 1 / 120); step(delta); remaining -= delta; }
      if (!disposed && !transferred) updateHud();
    },
    dispose() {
      if (disposed) return; disposed = true; clearInput();
      audioManager.dispose();
      sidescroll?.dispose(); sidescroll = null;
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
