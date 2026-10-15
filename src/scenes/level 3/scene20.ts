import * as THREE from 'three';
import { inputHint } from '../../scripts/gamepadInput.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createPlayer } from '../../scripts/player.js';
import { RESCUE_SITE, type RescueArrival } from '../../helpers/scene/rescueSite.js';

/**
 * Scene 20 — AI Research Facility interior (Level 3).
 *
 * Ground floor: a laboratory / control room. A four-station control panel only
 * accepts activations in the correct order; the order is deduced from four data
 * logs scattered around the lab. Solving it powers the stairwell.
 *
 * Second floor: a sealed observation deck holding the five students. Reaching it
 * triggers the finale (scene21).
 */

type StationId = 'COOLANT' | 'REACTOR' | 'VENT' | 'COMMS';
const SOLUTION: StationId[] = ['COOLANT', 'REACTOR', 'VENT', 'COMMS'];

/** One clue per log; together they uniquely determine SOLUTION. */
const LOG_CLUES: Array<{ position: [number, number, number]; title: string; clue: string }> = [
  { position: [-10, 0, 10], title: 'LOG 01 / THERMAL', clue: 'The REACTOR must come immediately after COOLANT.' },
  { position: [10, 0, 8], title: 'LOG 02 / COMMS', clue: 'COMMS is always activated last.' },
  { position: [-11, 0, -8], title: 'LOG 03 / SAFETY', clue: 'VENT is never activated first.' },
  { position: [6, 0, -14], title: 'LOG 04 / SEQUENCE', clue: 'COOLANT precedes VENT.' },
];

const STATION_X: Record<StationId, number> = { COOLANT: -6, REACTOR: -2, VENT: 2, COMMS: 6 };

export function createScene({ entryState, onRespawn, onFinished }: {
  entryState?: RescueArrival;
  onRespawn?: () => void;
  onFinished: (state: RescueArrival) => void;
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1218);
  scene.fog = new THREE.Fog(0x0a1218, 20, 70);
  const physics = createScenePhysics(), physicsWorld = physics.world;

  // ── Materials ──────────────────────────────────────────────────────────────
  const wall = new THREE.MeshStandardMaterial({ color: 0x3c4a52, metalness: 0.3, roughness: 0.72 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1d2b34, metalness: 0.4, roughness: 0.66 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141f27, metalness: 0.6, roughness: 0.5 });
  const pale = new THREE.MeshStandardMaterial({ color: 0x70808a, metalness: 0.45, roughness: 0.55 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x87ddd8, emissive: 0x247c89, emissiveIntensity: 1 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xa4d1d8, transparent: true, opacity: 0.12, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });

  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = wall, solid = true) =>
    roomBox(scene, physics, s, p, m, solid);

  // ── Ground-floor shell (tall room; mezzanine slab splits off the 2nd floor) ──
  const W = 14, D = 18, CEIL = 8;
  box([W * 2, 0.4, D * 2], [0, -0.2, 0], floorMat);                 // ground floor
  box([0.4, CEIL, D * 2], [-W, CEIL / 2, 0]);                        // west wall
  box([0.4, CEIL, D * 2], [W, CEIL / 2, 0]);                         // east wall
  box([W * 2, CEIL, 0.4], [0, CEIL / 2, -D]);                       // north wall
  box([W * 2, CEIL, 0.4], [0, CEIL / 2, D]);                        // south wall
  box([W * 2, 0.4, D * 2], [0, CEIL + 0.2, 0], dark);               // roof
  // Mezzanine slab over the north half → second floor walkable at y = 4.2.
  // The south half (z > MEZZ_EDGE) stays a double-height atrium for the stair.
  const MEZZ_Y = 4, MEZZ_EDGE = 4;
  box([W * 2, 0.4, D + MEZZ_EDGE], [0, MEZZ_Y, (-D + MEZZ_EDGE) / 2], floorMat);
  // Railing along the mezzanine's open south edge, leaving a gap for the stair (x > 9.5)
  box([23.5, 1.1, 0.12], [-2.25, MEZZ_Y + 0.75, MEZZ_EDGE], pale);

  // Floor guide stripes
  for (const x of [-W + 0.24, W - 0.24]) for (const z of [-12, -4, 8, 14]) box([0.025, 0.08, 2.4], [x, 0.04, z], stripe, false);

  // ── Lighting ───────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xbce5ff, 0x2a343a, 1.6));
  const labLights: THREE.PointLight[] = [];
  for (const [lx, lz] of [[-7, 8], [7, 8], [-7, -8], [7, -8]] as const) {
    const light = new THREE.PointLight(0xc4e8ff, 30, 18);
    light.position.set(lx, 3.4, lz);
    scene.add(light); labLights.push(light);
  }
  const mezzLight = new THREE.PointLight(0x9fd8ff, 26, 20);
  mezzLight.position.set(0, MEZZ_Y + 3, -10);
  scene.add(mezzLight);

  // ── Graphic detail: light fixtures, floor grid, wall ribbing ───────────────
  const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff });
  const fixtureTrim = new THREE.MeshStandardMaterial({ color: 0x2b3a42, metalness: 0.6, roughness: 0.4 });
  const fixtureSpots: Array<[number, number, number]> = [[-7, 3.7, 8], [7, 3.7, 8], [-7, 3.7, -8], [7, 3.7, -8], [0, MEZZ_Y + 3.2, -10]];
  for (const [fx, fy, fz] of fixtureSpots) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 1.2), fixtureTrim);
    trim.position.set(fx, fy + 0.06, fz); scene.add(trim);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.95), fixtureMat);
    panel.rotation.x = Math.PI / 2; panel.position.set(fx, fy - 0.03, fz); scene.add(panel);
  }
  // Subtle emissive floor grid
  const gridMat = new THREE.MeshBasicMaterial({ color: 0x1d4f57, transparent: true, opacity: 0.55 });
  for (const gx of [-12, -8, -4, 0, 4, 8, 12]) box([0.06, 0.02, D * 2 - 1], [gx, 0.015, 0], gridMat, false);
  for (const gz of [-16, -12, -8, -4, 0, 4, 8, 12, 16]) box([W * 2 - 1, 0.02, 0.06], [0, 0.015, gz], gridMat, false);
  // Vertical wall ribbing on the long walls
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x2c3a42, metalness: 0.45, roughness: 0.6 });
  for (const rz of [-15, -11, -7, -3, 1, 5, 9, 13]) for (const rx of [-W + 0.22, W - 0.22]) {
    box([0.18, CEIL - 0.6, 0.5], [rx, (CEIL - 0.6) / 2, rz], ribMat, false);
  }

  // ── Central AI hologram ──────────────────────────────────────────────────
  // A glowing holographic projection of the AI's "mind" — the room's focal point.
  const holoGroup = new THREE.Group();
  holoGroup.position.set(0, 0, 0);
  scene.add(holoGroup);

  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1a2a33, metalness: 0.7, roughness: 0.3 });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.4, 24), pedestalMat);
  pedestal.position.y = 0.7;
  pedestal.castShadow = pedestal.receiveShadow = true;
  holoGroup.add(pedestal);
  physics.addBox({ x: 1.3, y: 0.7, z: 1.3 }, { x: 0, y: 0.7, z: 0 });

  const holoMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, wireframe: true, transparent: true, opacity: 0.55 });
  const holoSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), holoMat);
  holoSphere.position.y = 2.6;
  holoGroup.add(holoSphere);

  const coreMat = new THREE.MeshBasicMaterial({ color: 0xaaffee, transparent: true, opacity: 0.3 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), coreMat);
  core.position.y = 2.6;
  holoGroup.add(core);

  const holoLight = new THREE.PointLight(0x66ddff, 14, 12);
  holoLight.position.set(0, 2.6, 0);
  holoGroup.add(holoLight);

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x2a6a77, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.8, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  holoGroup.add(ring);

  // ── Server racks around the core ────────────────────────────────────────
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x0d1820, metalness: 0.5, roughness: 0.5 });
  const rackLedMat = new THREE.MeshBasicMaterial({ color: 0x44ff88 });
  for (const [rx, rz] of [[-5, -3], [5, -3], [-5, 4], [5, 4]] as const) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 0.7), rackMat);
    rack.position.set(rx, 1.2, rz);
    rack.castShadow = rack.receiveShadow = true;
    scene.add(rack);
    physics.addBox({ x: 0.5, y: 1.2, z: 0.35 }, { x: rx, y: 1.2, z: rz });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.02), rackLedMat);
    led.position.set(rx + 0.42, 1.2, rz + 0.36);
    scene.add(led);
  }

  // ── Lab benches along the side walls ────────────────────────────────────
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x2a3a44, metalness: 0.3, roughness: 0.6 });
  for (const [bx, bz] of [[-11, 0], [11, 0], [-11, -12], [11, -12]] as const) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.2), benchMat);
    bench.position.set(bx, 0.45, bz);
    bench.castShadow = bench.receiveShadow = true;
    scene.add(bench);
    physics.addBox({ x: 1.2, y: 0.45, z: 0.6 }, { x: bx, y: 0.45, z: bz });
  }

  // ── Staircase to the second floor (east side of the atrium, ascending north) ─
  const STAIR_BASE = new THREE.Vector3(11, 0, 16);
  const stairs = physics.addStaircase({ width: 3, run: 12, rise: MEZZ_Y + 0.2, position: STAIR_BASE, material: pale, yaw: Math.PI, stepCount: 22 });
  scene.add(stairs.group);
  // Stair railings
  for (const side of [-1, 1]) box([0.1, 1, 12], [11 + side * 1.55, 0.9, 10], pale);

  // ── Energy barrier gating the stairwell until the puzzle is solved ─────────
  // Full-footprint collider over the whole staircase volume so the stairs cannot
  // be side-climbed before the panel is sequenced; the glowing plane at the mouth
  // is the visible indicator.
  const barrierBody = physics.addBox({ x: 3.2, y: 4.4, z: 12 }, { x: 11, y: 2.2, z: 10 });
  const barrierMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.28, depthWrite: false });
  const barrier = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.2), barrierMat);
  barrier.position.set(11, 1.6, 16.4);
  scene.add(barrier);
  const barrierFrame = box([3.6, 0.2, 0.4], [11, 3.3, 16.4], dark, false);
  const barrierEmitter = new THREE.PointLight(0xff5a3c, 8, 8);
  barrierEmitter.position.set(11, 1.8, 16.4);
  scene.add(barrierEmitter);

  // ── Control panel: four stations along the north wall ─────────────────────
  interface Station { id: StationId; group: THREE.Group; lamp: THREE.Mesh; lampMat: THREE.MeshStandardMaterial; screen: THREE.Mesh; }
  const stations: Station[] = [];
  const consoleMat = new THREE.MeshStandardMaterial({ color: 0x0b141a, roughness: 0.55, metalness: 0.3 });
  for (const id of SOLUTION) {
    const x = STATION_X[id];
    const group = new THREE.Group();
    group.position.set(x, 0, -D + 0.9);
    scene.add(group);
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.7), consoleMat);
    bodyMesh.position.y = 0.6; bodyMesh.castShadow = bodyMesh.receiveShadow = true; group.add(bodyMesh);
    physics.addBox({ x: 2.4, y: 1.2, z: 0.7 }, { x, y: 0.6, z: -D + 0.9 });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0f2a33 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), screenMat);
    screen.position.set(0, 1.05, 0.36); screen.rotation.x = -0.3; group.add(screen);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x441111, emissiveIntensity: 1 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), lampMat);
    lamp.position.set(0, 1.35, 0.3); group.add(lamp);
    // Label
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0b141a'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#9fd8e0'; ctx.textAlign = 'center'; ctx.font = 'bold 30px monospace'; ctx.fillText(id, 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
    label.position.set(0, 1.62, 0.34); group.add(label);
    stations.push({ id, group, lamp, lampMat, screen });
  }

  // ── Data logs (interactable terminals) ─────────────────────────────────────
  interface Log { position: THREE.Vector3; title: string; clue: string; read: boolean; screen: THREE.Mesh; screenMat: THREE.MeshBasicMaterial; }
  const logs: Log[] = LOG_CLUES.map(entry => {
    const group = new THREE.Group();
    group.position.set(...entry.position);
    scene.add(group);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), pale);
    pedestal.position.y = 0.55; pedestal.castShadow = pedestal.receiveShadow = true; group.add(pedestal);
    physics.addBox({ x: 0.7, y: 1.1, z: 0.5 }, { x: entry.position[0], y: 0.55, z: entry.position[2] });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x123a44 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), screenMat);
    screen.position.set(0, 1.25, 0.26); screen.rotation.x = -0.35; group.add(screen);
    return { position: new THREE.Vector3(...entry.position), title: entry.title, clue: entry.clue, read: false, screen, screenMat };
  });

  // ── Second floor: observation deck with the five students behind glass ─────
  const GLASS_Z = -10;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 - 1, 3.2), glassMat);
  glass.position.set(0, MEZZ_Y + 1.8, GLASS_Z);
  scene.add(glass);
  box([W * 2, 0.3, 0.3], [0, MEZZ_Y + 3.5, GLASS_Z], dark, false);   // glass header
  // Five student silhouettes behind the glass
  const students: THREE.Group[] = [];
  const silhouetteMat = new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: 0x1a2a3a, emissiveIntensity: 0.6, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const x = -8 + i * 4;
    g.position.set(x, MEZZ_Y + 0.2, -14);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 8), silhouetteMat);
    torso.position.y = 0.85; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), silhouetteMat);
    head.position.y = 1.62; g.add(head);
    scene.add(g); students.push(g);
  }
  const revealLight = new THREE.PointLight(0x66aaff, 18, 16);
  revealLight.position.set(0, MEZZ_Y + 2.4, -14);
  scene.add(revealLight);

  // ── Player / camera ────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  const spawn = { x: 0, y: PHYSICS.playerRadius, z: 10 };
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  if (entryState?.pilotState) player.restoreTransition({ ...entryState.pilotState, position: spawn, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, heldKeys: [], blockedKeys: [], crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false, bobTime: 0, bobIntensity: 0 }, { x: 0, y: 0, z: 0, yaw: 0 });
  player.setRotation(0);
  player.enable();
  player.updateCamera(0);
  const exteriorCamera = entryState?.cameraPosition?.clone().add(new THREE.Vector3(0, 0, spawn.z - (RESCUE_SITE.doorZ - 6)));
  const entryBasePosition = new THREE.Vector3(), entryBaseRotation = new THREE.Quaternion();
  let entryViewClock = -1;

  // ── Puzzle state ───────────────────────────────────────────────────────────
  let progress = 0;             // how many stations correctly activated in a row
  let solved = false;
  let alarmTime = 0;            // >0 while the wrong-order alarm flashes
  let surgeTime = 0;            // >0 while the power surge plays
  let revealTime = -1;          // >=0 once the player has reached the observation deck
  let finished = false;
  let disposed = false;

  function setLamp(station: Station, state: 'idle' | 'lit' | 'error') {
    if (state === 'lit') { station.lampMat.color.setHex(0x114411); station.lampMat.emissive.setHex(0x33ff66); }
    else if (state === 'error') { station.lampMat.color.setHex(0x441111); station.lampMat.emissive.setHex(0xff3322); }
    else { station.lampMat.color.setHex(0x331111); station.lampMat.emissive.setHex(0x441111); }
  }
  function resetPanel() {
    progress = 0;
    for (const s of stations) setLamp(s, 'idle');
  }
  function unlockStairwell() {
    solved = true;
    physics.world.removeBody(barrierBody);
    barrier.visible = false;
    barrierFrame.visible = false;
    barrierEmitter.color.setHex(0x66ff99);
    surgeTime = 1.6;
    message('STAIRWELL POWER RESTORED — ASCEND TO THE OBSERVATION DECK', 4);
  }
  function activateStation(station: Station) {
    if (solved) { message('The panel is already sequenced.', 1.6); return; }
    if (station.id === SOLUTION[progress]) {
      setLamp(station, 'lit');
      progress++;
      if (progress === SOLUTION.length) unlockStairwell();
      else message(`${station.id} online — ${SOLUTION.length - progress} remaining.`, 1.8);
    } else {
      alarmTime = 1.2;
      resetPanel();
      message('INCORRECT SEQUENCE — PANEL RESET. Consult the data logs.', 2.6);
    }
  }

  // ── Transient on-screen message ────────────────────────────────────────────
  const messageEl = document.createElement('div');
  messageEl.style.cssText = 'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);padding:10px 22px;'
    + 'background:rgba(6,20,26,0.85);border:1px solid rgba(120,220,230,0.4);color:#bfeef2;font:600 15px monospace;'
    + 'letter-spacing:0.06em;border-radius:4px;pointer-events:none;z-index:60;white-space:pre-line;text-align:center;';
  document.body.appendChild(messageEl);
  let messageTime = 0;
  function message(text: string, seconds: number) {
    messageEl.textContent = text;
    messageEl.style.display = 'block';
    messageTime = seconds;
  }
  message('PRIME: I expected more security.', 3.8);

  // ── Interaction (E key) ────────────────────────────────────────────────────
  const prompt = document.getElementById('interact-prompt');
  function near(point: THREE.Vector3, radius = 2) {
    const q = player.body.position;
    return Math.hypot(q.x - point.x, q.y + 0.9 - point.y, q.z - point.z) < radius;
  }
  function currentTarget(): { kind: 'log'; log: Log } | { kind: 'station'; station: Station } | null {
    for (const log of logs) if (near(log.position)) return { kind: 'log', log };
    for (const s of stations) if (near(new THREE.Vector3(STATION_X[s.id], 0, -D + 1.4))) return { kind: 'station', station: s };
    return null;
  }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || !player.isEnabled() || disposed || finished) return;
    const target = currentTarget();
    if (!target) return;
    if (target.kind === 'log') {
      target.log.read = true;
      target.log.screenMat.color.setHex(0x2a6a55);
      message(`${target.log.title}\n${target.log.clue}`, 4);
    } else {
      activateStation(target.station);
    }
  }
  window.addEventListener('keydown', onKey);

  // ── Update loop ────────────────────────────────────────────────────────────
  let clock = 0;
  function updatePhysics(dt: number, thirdPerson = false) {
    if (disposed || finished || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
    clock += dt;
    physics.step(dt, player, thirdPerson);

    // Interact prompt
    if (prompt) {
      const target = currentTarget();
      if (target) {
        prompt.classList.remove('hidden');
        prompt.textContent = inputHint(target.kind === 'log'
          ? (target.log.read ? 'E: re-read data log' : 'E: read data log')
          : `E: activate ${target.station.id}`);
      } else prompt.classList.add('hidden');
    }

    // Message timer
    if (messageTime > 0) {
      messageTime -= dt;
      if (messageTime <= 0) messageEl.style.display = 'none';
    }

    // Alarm flash
    if (alarmTime > 0) {
      alarmTime -= dt;
      const flash = Math.sin(clock * 30) > 0;
      for (const s of stations) if (flash) setLamp(s, 'error');
      for (const l of labLights) l.color.setHex(flash ? 0xff5544 : 0xc4e8ff);
      if (alarmTime <= 0) { for (const l of labLights) l.color.setHex(0xc4e8ff); resetPanel(); }
    }

    // Power surge on unlock
    if (surgeTime > 0) {
      surgeTime -= dt;
      const flicker = 0.6 + Math.abs(Math.sin(clock * 24)) * 0.8;
      for (const l of labLights) l.intensity = 30 * flicker;
      mezzLight.intensity = 26 * flicker;
      if (surgeTime <= 0) { for (const l of labLights) l.intensity = 30; mezzLight.intensity = 26; }
    }

    // Barrier shimmer while locked
    if (!solved) barrierMat.opacity = 0.22 + Math.sin(clock * 4) * 0.08;

    // Hologram rotation and core pulse
    holoSphere.rotation.y += dt * 0.4;
    holoSphere.rotation.x += dt * 0.15;
    coreMat.opacity = 0.2 + Math.sin(clock * 2) * 0.15;

    // Students idle sway on the deck
    students.forEach((g, i) => { g.position.y = MEZZ_Y + 0.2 + Math.sin(clock * 0.8 + i) * 0.02; });

    // Reveal trigger: once unlocked and the player reaches the observation deck
    if (solved && revealTime < 0 && player.body.position.y > MEZZ_Y - 0.5 && player.body.position.z < GLASS_Z + 3) {
      revealTime = 0;
      message('THE FIVE ARE HERE.\nThey turned on Brondon. There is no going back.', 3.4);
    }
    if (revealTime >= 0) {
      revealTime += dt;
      if (revealTime > 3.4) {
        finished = true;
        onFinished({ ...entryState, cameraPosition: undefined, cameraQuaternion: undefined, cameraFov: undefined,
          pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }) });
      }
    }
  }

  return {
    roomId: 'scene20', scene, camera, physics, physicsWorld, player, cutsceneManager: null,
    ready: Promise.resolve(),
    hideMinimap: () => true,
    getMinimapState: () => ({ position: player.body.position, yaw: player.getState().yaw }),
    getMusicTrack: (): 'stealth-2' => 'stealth-2',
    applyEntryCamera() {
      if (!exteriorCamera || !entryState?.cameraQuaternion || clock >= 0.75) return;
      if (entryViewClock !== clock) {
        entryViewClock = clock; entryBasePosition.copy(camera.position); entryBaseRotation.copy(camera.quaternion);
      }
      const progress = THREE.MathUtils.smootherstep(clock, 0, 0.75);
      camera.position.lerpVectors(exteriorCamera, entryBasePosition, progress);
      camera.quaternion.slerpQuaternions(entryState.cameraQuaternion, entryBaseRotation, progress);
      camera.fov = THREE.MathUtils.lerp(entryState.cameraFov ?? 75, 75, progress); camera.updateProjectionMatrix();
    },
    updatePhysics,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKey);
      prompt?.classList.add('hidden');
      messageEl.remove();
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}
