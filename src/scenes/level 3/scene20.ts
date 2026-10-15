import * as THREE from 'three';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createContainmentPod, type ContainmentPod } from '../../helpers/scene/containmentPod.js';
import { createPlayer } from '../../scripts/player.js';
import type { RescueArrival } from '../../helpers/scene/rescueSite.js';

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
  scene.background = new THREE.Color(0x16333d);
  scene.fog = new THREE.Fog(0x16333d, 24, 80);
  const physics = createScenePhysics(), physicsWorld = physics.world;

  // ── Materials (bright teal / white control-room palette with green accents) ──
  const wall = new THREE.MeshStandardMaterial({ color: 0x9db4b8, metalness: 0.25, roughness: 0.7 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e6076, metalness: 0.35, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22343c, metalness: 0.5, roughness: 0.5 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xdfe8ea, metalness: 0.3, roughness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x9fe8e0, emissive: 0x2f9c94, emissiveIntensity: 1 });
  const green = new THREE.MeshStandardMaterial({ color: 0x2f9d63, metalness: 0.2, roughness: 0.6 });
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

  // ── Lighting (bright, daylight control room) ───────────────────────────────
  scene.add(new THREE.HemisphereLight(0xd8f2ff, 0x3a4a50, 2.3));
  const labLights: THREE.PointLight[] = [];
  for (const [lx, lz] of [[-7, 8], [7, 8], [-7, -8], [7, -8]] as const) {
    const light = new THREE.PointLight(0xd6f0ff, 30, 18);
    light.position.set(lx, 3.4, lz);
    scene.add(light); labLights.push(light);
  }
  const mezzLight = new THREE.PointLight(0xbfe4ff, 26, 20);
  mezzLight.position.set(0, MEZZ_Y + 3, -10);
  scene.add(mezzLight);
  // Soft green wash from the ceiling dome hologram above the core
  const domeGlow = new THREE.PointLight(0x7fe8a8, 22, 26);
  domeGlow.position.set(0, CEIL - 1.2, 0);
  scene.add(domeGlow);

  // ── Canvas texture helpers for the control-room decor ─────────────────────
  const planetTexture = () => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(256, 256, 40, 256, 256, 250);
    grad.addColorStop(0, '#b8ffd0'); grad.addColorStop(0.5, '#4fd68a'); grad.addColorStop(1, '#0f7a4a');
    g.fillStyle = grad; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(230,255,240,0.8)'; g.lineWidth = 3;
    for (let i = 0; i < 7; i++) { const a = i * 0.9; g.beginPath(); g.moveTo(256 + Math.cos(a) * 60, 256 + Math.sin(a) * 60); g.lineTo(256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200); g.stroke(); }
    g.strokeStyle = 'rgba(240,255,250,0.9)'; g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 120, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(256, 256, 150, 0, Math.PI * 2); g.stroke();
    return new THREE.CanvasTexture(c);
  };
  const skylineTexture = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 256); sky.addColorStop(0, '#cfe8f2'); sky.addColorStop(1, '#e8f4f8');
    g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#b9c8cf';
    for (let i = 0; i < 14; i++) { const w = 20 + ((i * 37) % 30), h = 60 + ((i * 53) % 120); g.fillRect(i * 36, 256 - h, w, h); }
    g.fillStyle = '#a8b8c0';
    for (let i = 0; i < 10; i++) { const w = 16 + ((i * 29) % 24), h = 40 + ((i * 41) % 90); g.fillRect(i * 50 + 10, 256 - h, w, h); }
    return new THREE.CanvasTexture(c);
  };
  const terrainTexture = () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0d3a34'; g.fillRect(0, 0, 256, 160);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${60 + ((i * 13) % 60)},${180 + ((i * 7) % 60)},${120 + ((i * 11) % 60)},0.7)`;
      g.beginPath(); g.ellipse((i * 37) % 230, (i * 23) % 140, 14 + ((i * 5) % 16), 10 + ((i * 3) % 12), 0, 0, Math.PI * 2); g.fill();
    }
    return new THREE.CanvasTexture(c);
  };

  // ── Ceiling dome with green holographic planet + concentric rings ─────────
  const domeDisc = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ map: planetTexture() }));
  domeDisc.rotation.x = Math.PI / 2; domeDisc.position.set(0, CEIL - 0.06, 0);
  scene.add(domeDisc);
  const ringTrimMat = new THREE.MeshStandardMaterial({ color: 0xcfdde0, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide });
  for (const [inner, outer, y] of [[5, 5.7, CEIL - 0.12], [5.7, 6.6, CEIL - 0.24], [6.6, 7.6, CEIL - 0.36]] as const) {
    const trim = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), ringTrimMat);
    trim.rotation.x = Math.PI / 2; trim.position.set(0, y, 0); scene.add(trim);
  }
  const ringLightMat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, side: THREE.DoubleSide });
  for (const [lx, lz] of [[-7, 8], [7, 8], [-7, -8], [7, -8]] as const) {
    const rl = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 32), ringLightMat);
    rl.rotation.x = Math.PI / 2; rl.position.set(lx, CEIL - 0.4, lz); scene.add(rl);
  }

  // ── Concentric floor rings centred on the core dais ───────────────────────
  const floorRingMat = new THREE.MeshBasicMaterial({ color: 0xcfeef2, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  for (const r of [3.4, 5.2, 7.0, 8.8]) {
    const fr = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.14, 64), floorRingMat);
    fr.rotation.x = -Math.PI / 2; fr.position.set(0, 0.02, 0); scene.add(fr);
  }

  // ── Tall skyline windows (south wall + upper side walls) ──────────────────
  const windowMat = new THREE.MeshBasicMaterial({ map: skylineTexture() });
  const mullion = new THREE.MeshStandardMaterial({ color: 0xe6eef0, metalness: 0.3, roughness: 0.5 });
  const southPane = new THREE.Mesh(new THREE.PlaneGeometry(20, 4), windowMat);
  southPane.position.set(0, 4.2, D - 0.3); southPane.rotation.y = Math.PI; scene.add(southPane);
  for (let i = 0; i <= 6; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4, 0.12), mullion); bar.position.set(-10 + i * (20 / 6), 4.2, D - 0.34); scene.add(bar); }
  for (const sy of [2.15, 6.25]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(20.4, 0.2, 0.3), mullion); rail.position.set(0, sy, D - 0.34); scene.add(rail); }
  for (const sx of [-1, 1]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(24, 2), windowMat);
    pane.position.set(sx * (W - 0.3), 5.6, 0); pane.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(pane);
    for (let i = 0; i <= 8; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.14), mullion); bar.position.set(sx * (W - 0.34), 5.6, -12 + i * 3); scene.add(bar); }
  }

  // ── Wall screens, bookshelves and circular porthole displays ──────────────
  const tealScreenMat = new THREE.MeshBasicMaterial({ color: 0x2fb9c9 });
  for (const [sx, sz] of [[-1, 6], [1, -6]] as const) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 3.2), dark);
    frame.position.set(sx * (W - 0.24), 2.6, sz); scene.add(frame);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), tealScreenMat);
    scr.position.set(sx * (W - 0.28), 2.6, sz); scr.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(scr);
  }
  const spineColors = [0xc0563f, 0x3f7fc0, 0x4fae62, 0xd0a03f, 0x8a5fc0];
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.7 });
  for (const [sx, sz] of [[-1, -6], [1, 6]] as const) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 3.4), woodMat);
    shelf.position.set(sx * (W - 0.4), 1.3, sz); scene.add(shelf);
    for (let r = 0; r < 3; r++) for (let b = 0; b < 6; b++) {
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: spineColors[(r * 6 + b) % 5], roughness: 0.8 }));
      spine.position.set(sx * (W - 0.62), 0.5 + r * 0.8, sz - 1.4 + b * 0.55); scene.add(spine);
    }
  }
  const portholeRingMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ea, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide });
  const portholeGlowMat = new THREE.MeshBasicMaterial({ color: 0x35c8d8 });
  for (const [sx, sz] of [[-1, 12], [1, -12], [-1, -12], [1, 12]] as const) {
    const yaw = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 32), portholeRingMat);
    ring.position.set(sx * (W - 0.26), 3.4, sz); ring.rotation.y = yaw; scene.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), portholeGlowMat);
    disc.position.set(sx * (W - 0.27), 3.4, sz); disc.rotation.y = yaw; scene.add(disc);
  }

  // ── Central AI hologram on a raised dais ─────────────────────────────────
  // A glowing holographic projection of the AI's "mind" — the room's focal point.
  const holoGroup = new THREE.Group();
  holoGroup.position.set(0, 0, 0);
  scene.add(holoGroup);

  // Raised circular dais with two steps (the reference's central platform)
  const daisMat = new THREE.MeshStandardMaterial({ color: 0xe8eef0, metalness: 0.25, roughness: 0.5 });
  const dais1 = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.25, 40), daisMat);
  dais1.position.y = 0.125; dais1.receiveShadow = true; holoGroup.add(dais1);
  physics.addBox({ x: 2.8, y: 0.125, z: 2.8 }, { x: 0, y: 0.125, z: 0 });
  const dais2 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.25, 40), daisMat);
  dais2.position.y = 0.375; dais2.receiveShadow = true; holoGroup.add(dais2);
  physics.addBox({ x: 2.3, y: 0.125, z: 2.3 }, { x: 0, y: 0.375, z: 0 });
  for (const a of [0.6, 2.6, 4.4]) {
    const plant = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), green);
    plant.position.set(Math.cos(a) * 2.45, 0.62, Math.sin(a) * 2.45);
    plant.scale.y = 1.3; holoGroup.add(plant);
  }

  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x2a3a42, metalness: 0.7, roughness: 0.3 });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.4, 24), pedestalMat);
  pedestal.position.y = 1.2;
  pedestal.castShadow = pedestal.receiveShadow = true;
  holoGroup.add(pedestal);
  physics.addBox({ x: 1.3, y: 0.7, z: 1.3 }, { x: 0, y: 1.2, z: 0 });

  const holoMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, wireframe: true, transparent: true, opacity: 0.55 });
  const holoSphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), holoMat);
  holoSphere.position.y = 3.1;
  holoGroup.add(holoSphere);

  const coreMat = new THREE.MeshBasicMaterial({ color: 0xaaffee, transparent: true, opacity: 0.3 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), coreMat);
  core.position.y = 3.1;
  holoGroup.add(core);

  const holoLight = new THREE.PointLight(0x66ddff, 14, 12);
  holoLight.position.set(0, 3.1, 0);
  holoGroup.add(holoLight);

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x2a6a77, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.8, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.52;
  holoGroup.add(ring);

  // ── Workstation desks with terrain monitors and green chairs ─────────────
  const monitorTerrain = terrainTexture();
  const monitorMat = new THREE.MeshBasicMaterial({ map: monitorTerrain });
  const monitorBody = new THREE.MeshStandardMaterial({ color: 0x2b3a42, metalness: 0.5, roughness: 0.4 });
  function workstation(x: number, z: number) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = Math.atan2(-x, -z);
    scene.add(group);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.1), pale);
    top.position.y = 0.75; top.castShadow = top.receiveShadow = true; group.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.9), pale);
    base.position.y = 0.38; base.castShadow = base.receiveShadow = true; group.add(base);
    const mon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.08), monitorBody);
    mon.position.set(0, 1.25, -0.2); group.add(mon);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), monitorMat);
    scr.position.set(0, 1.25, -0.155); group.add(scr);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), green);
    seat.position.set(0, 0.5, 0.6); group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), green);
    back.position.set(0, 0.85, 0.85); group.add(back);
    physics.addBox({ x: 1.1, y: 0.4, z: 0.55 }, { x, y: 0.4, z });
  }
  for (const [wx, wz] of [[-6, -4], [6, -4], [-6, 6], [6, 6], [-11, 2], [11, 2], [-4, -12], [4, -12]] as const) {
    workstation(wx, wz);
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
  // Five students suspended in containment capsules behind the glass
  const students: THREE.Group[] = [];
  const pods: ContainmentPod[] = [];
  const silhouetteMat = new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: 0x1a2a3a, emissiveIntensity: 0.6, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const capsule = createContainmentPod();
    const x = -8 + i * 4;
    capsule.group.position.set(x, MEZZ_Y + 0.2, -14);
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 8), silhouetteMat);
    torso.position.y = 0.85; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), silhouetteMat);
    head.position.y = 1.62; g.add(head);
    capsule.interior.add(g);
    scene.add(capsule.group);
    students.push(g); pods.push(capsule);
  }
  const revealLight = new THREE.PointLight(0x66aaff, 18, 16);
  revealLight.position.set(0, MEZZ_Y + 2.4, -14);
  scene.add(revealLight);

  // ── Observation-deck fit-out: dark holographic lab (matches the reference) ──
  const roundedRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  // Dense glowing circuit-board panel (traces, vias, chips, bright rounded bezel)
  const circuitTexture = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320;
    const g = c.getContext('2d')!;
    g.fillStyle = '#02090d'; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = 'rgba(30,120,120,0.12)'; g.lineWidth = 1;
    for (let x = 0; x <= 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 320); g.stroke(); }
    for (let y = 0; y <= 320; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 90; i++) {
      const x = (i * 97) % 480 + 16, y = (i * 61) % 290 + 16;
      const dx = (i % 2 ? 1 : -1) * (24 + (i * 17) % 90), dy = (i % 3 ? 1 : -1) * (18 + (i * 11) % 70);
      g.strokeStyle = i % 7 === 0 ? 'rgba(200,255,250,1)' : 'rgba(70,245,235,0.78)';
      g.lineWidth = i % 7 === 0 ? 2.8 : 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y); g.lineTo(x + dx, y + dy); g.stroke();
      g.fillStyle = 'rgba(160,255,248,1)'; g.beginPath(); g.arc(x + dx, y + dy, 2.8, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 10; i++) {
      const x = (i * 167) % 440 + 20, y = (i * 113) % 250 + 30, w = 26 + (i % 3) * 14, h = 18 + (i % 2) * 12;
      g.fillStyle = 'rgba(6,30,36,0.95)'; roundedRect(g, x, y, w, h, 3); g.fill();
      g.strokeStyle = 'rgba(70,240,225,0.85)'; g.lineWidth = 1.4; roundedRect(g, x, y, w, h, 3); g.stroke();
      g.fillStyle = 'rgba(120,255,240,0.85)';
      for (let p = 0; p < Math.floor(w / 8); p++) { g.fillRect(x + 4 + p * 8, y - 2, 3, 3); g.fillRect(x + 4 + p * 8, y + h - 1, 3, 3); }
    }
    g.strokeStyle = 'rgba(150,255,246,1)'; g.lineWidth = 7; roundedRect(g, 10, 10, 492, 300, 26); g.stroke();
    g.strokeStyle = 'rgba(45,225,215,0.4)'; g.lineWidth = 2; roundedRect(g, 22, 22, 468, 276, 18); g.stroke();
    return new THREE.CanvasTexture(c);
  };

  // Holographic blueprint schematic for the big angled display
  const schematicTexture = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#03141a'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = 'rgba(45,200,200,0.15)'; g.lineWidth = 1;
    for (let x = 0; x <= 512; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let y = 0; y <= 256; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    g.strokeStyle = 'rgba(130,255,246,1)'; g.lineWidth = 2.4;
    g.beginPath(); g.arc(150, 128, 70, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(150, 128, 46, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(150, 128, 20, 0, Math.PI * 1.5); g.stroke();
    g.beginPath(); g.moveTo(60, 128); g.lineTo(240, 128); g.moveTo(150, 40); g.lineTo(150, 216); g.stroke();
    const br = (x: number, y: number, sx: number, sy: number) => { g.beginPath(); g.moveTo(x, y + sy * 22); g.lineTo(x, y); g.lineTo(x + sx * 22, y); g.stroke(); };
    br(280, 40, 1, 1); br(488, 40, -1, 1); br(280, 216, 1, -1); br(488, 216, -1, -1);
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(55,230,214,${0.35 + 0.05 * i})`; g.fillRect(292 + i * 16, 190 - ((i * 37) % 80), 10, 40 + ((i * 37) % 80)); }
    g.fillStyle = 'rgba(140,246,234,0.85)';
    for (let i = 0; i < 6; i++) g.fillRect(292, 52 + i * 10, 60 + ((i * 29) % 120), 3);
    return new THREE.CanvasTexture(c);
  };

  // Glowing touch-pad surface for the console tops
  const touchTexture = () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#04141a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(45,225,215,0.45)'; g.lineWidth = 1;
    for (let x = 0; x <= 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    const pads = [[18, 18, 92, 42], [128, 22, 104, 32], [22, 74, 74, 36], [108, 70, 124, 42]];
    for (const [px, py, pw, ph] of pads) {
      g.fillStyle = 'rgba(80,245,235,1)'; roundedRect(g, px, py, pw, ph, 6); g.fill();
      g.fillStyle = 'rgba(210,255,250,1)'; roundedRect(g, px + 6, py + 6, pw - 12, ph - 12, 4); g.fill();
    }
    return new THREE.CanvasTexture(c);
  };

  const deckDark = new THREE.MeshStandardMaterial({ color: 0x0a1418, metalness: 0.75, roughness: 0.4 });
  const deckMetal = new THREE.MeshStandardMaterial({ color: 0x1b2b31, metalness: 0.85, roughness: 0.35 });
  const cyanGlow = new THREE.MeshBasicMaterial({ color: 0x7dfff0 });
  const redGlow = new THREE.MeshBasicMaterial({ color: 0xff6a55 });
  const circuitMat = new THREE.MeshBasicMaterial({ map: circuitTexture() });
  const touchMat = new THREE.MeshBasicMaterial({ map: touchTexture() });

  // A framed circuit panel mounted on a wall (yaw picks which way it faces)
  function circuitPanel(w: number, h: number, x: number, y: number, z: number, yaw: number) {
    const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = yaw; scene.add(grp);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, h + 0.35, 0.18), deckDark); grp.add(back);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), circuitMat); face.position.z = 0.1; grp.add(face);
    const t = 0.07;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, t, t), cyanGlow); top.position.set(0, h / 2, 0.14); grp.add(top);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, t, t), cyanGlow); bot.position.set(0, -h / 2, 0.14); grp.add(bot);
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, h + 0.12, t), cyanGlow); left.position.set(-w / 2, 0, 0.14); grp.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(t, h + 0.12, t), cyanGlow); right.position.set(w / 2, 0, 0.14); grp.add(right);
  }

  // Containment-bay north wall: circuit panels flanking the pods
  circuitPanel(6.4, 3.0, -8, MEZZ_Y + 1.7, -D + 0.2, 0);
  circuitPanel(6.4, 3.0, 8, MEZZ_Y + 1.7, -D + 0.2, 0);
  // Side walls for depth
  circuitPanel(7.5, 2.8, -W + 0.2, MEZZ_Y + 1.7, -13, Math.PI / 2);
  circuitPanel(7.5, 2.8, W - 0.2, MEZZ_Y + 1.7, -13, -Math.PI / 2);

  // Big angled holographic blueprint display high on the north wall, above the pods
  const displayFrame = new THREE.Mesh(new THREE.BoxGeometry(10.6, 3.0, 0.22), deckDark);
  displayFrame.position.set(0, MEZZ_Y + 3.5, -D + 0.35); scene.add(displayFrame);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 2.4), new THREE.MeshBasicMaterial({ map: schematicTexture() }));
  display.position.set(0, MEZZ_Y + 3.5, -D + 0.5); display.rotation.x = 0.26; scene.add(display);
  // Glowing bezel + accent blocks along the top of the display (reference detail)
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.09, 0.09), cyanGlow);
  bezel.position.set(0, MEZZ_Y + 4.72, -D + 0.55); bezel.rotation.x = 0.26; scene.add(bezel);
  const bezelBot = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.09, 0.09), cyanGlow);
  bezelBot.position.set(0, MEZZ_Y + 2.28, -D + 0.5); bezelBot.rotation.x = 0.26; scene.add(bezelBot);
  for (let i = 0; i < 6; i++) {
    const accent = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.12), i === 1 ? redGlow : cyanGlow);
    accent.position.set(-3.75 + i * 1.5, MEZZ_Y + 4.95, -D + 0.42); scene.add(accent);
  }

  // Ceiling structural grid beams over the bay
  for (const cz of [-16.5, -13.5, -10.5]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2 - 1, 0.28, 0.28), deckDark);
    beam.position.set(0, CEIL - 0.35, cz); scene.add(beam);
  }
  for (const bx of [-9, -3, 3, 9]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 8), deckDark);
    rib.position.set(bx, CEIL - 0.4, -13.5); scene.add(rib);
  }

  // Cyan glow washing off the wall panels
  for (const gx of [-7, 7]) {
    const glow = new THREE.PointLight(0x4ffce8, 30, 20);
    glow.position.set(gx, MEZZ_Y + 2.4, -15.5); scene.add(glow);
  }
  const displayGlow = new THREE.PointLight(0x4ffce8, 26, 16);
  displayGlow.position.set(0, MEZZ_Y + 3.6, -15); scene.add(displayGlow);

  // Long metallic console: dark body, angled control face, glowing touch deck, red LED row
  function deckConsole(x: number, z: number, yaw: number, len = 3.6) {
    const grp = new THREE.Group(); grp.position.set(x, MEZZ_Y + 0.2, z); grp.rotation.y = yaw; scene.add(grp);
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 0.85, 1.15), deckMetal);
    body.position.y = 0.42; body.castShadow = body.receiveShadow = true; grp.add(body);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.12, 1.25), deckDark);
    kick.position.y = 0.06; grp.add(kick);
    const face = new THREE.Mesh(new THREE.BoxGeometry(len - 0.15, 0.55, 0.08), deckDark);
    face.position.set(0, 0.98, -0.3); face.rotation.x = -0.55; grp.add(face);
    const faceGlow = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.35, 0.4), touchMat);
    faceGlow.position.set(0, 1.0, -0.25); faceGlow.rotation.x = -0.55; grp.add(faceGlow);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.3, 0.95), touchMat);
    top.rotation.x = -Math.PI / 2; top.position.set(0, 0.851, 0.05); grp.add(top);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), cyanGlow);
    edge.position.set(0, 0.86, 0.56); grp.add(edge);
    for (let i = 0; i < 7; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), redGlow);
      led.position.set(-len / 2 + 0.5 + i * (len - 1.0) / 6, 0.5, 0.58); grp.add(led);
    }
    physics.addBox({ x: len / 2, y: 0.5, z: 0.6 }, { x, y: MEZZ_Y + 0.5, z });
  }
  // Low console under the wall display (decorative — pods/wall block the player here)
  deckConsole(0, -16.6, 0, 9);
  // Deck consoles flanking the centre so the walk-up to the glass (z < -7) stays open
  deckConsole(-7, -5, 0);
  deckConsole(7, -5, 0);
  deckConsole(-10.5, 0, Math.PI / 2);
  deckConsole(10.5, 0, -Math.PI / 2);

  // ── Player / camera ────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  const spawn = { x: 0, y: PHYSICS.playerRadius, z: 10 };
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  if (entryState?.pilotState) player.restoreTransition({ ...entryState.pilotState, position: spawn, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, heldKeys: [], blockedKeys: [], crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false, bobTime: 0, bobIntensity: 0 }, { x: 0, y: 0, z: 0, yaw: 0 });
  player.setRotation(0);
  player.enable();
  player.updateCamera(0);

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
    if (disposed || finished || document.hidden) return;
    dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
    clock += dt;
    physics.step(dt, player, thirdPerson);

    // Interact prompt
    if (prompt) {
      const target = currentTarget();
      if (target) {
        prompt.classList.remove('hidden');
        prompt.textContent = target.kind === 'log'
          ? (target.log.read ? 'E: re-read data log' : 'E: read data log')
          : `E: activate ${target.station.id}`;
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

    // Students idle sway inside their capsules; pods pulse their glow
    students.forEach((g, i) => { g.position.y = Math.sin(clock * 0.8 + i) * 0.02; });
    for (const capsule of pods) capsule.update(clock);

    // Reveal trigger: once unlocked and the player reaches the observation deck
    if (solved && revealTime < 0 && player.body.position.y > MEZZ_Y - 0.5 && player.body.position.z < GLASS_Z + 3) {
      revealTime = 0;
      message('THE FIVE ARE HERE.\nThey turned on Brondon. There is no going back.', 3.4);
    }
    if (revealTime >= 0) {
      revealTime += dt;
      if (revealTime > 3.4) {
        finished = true;
        onFinished({ pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }), hullHealth: entryState?.hullHealth });
      }
    }
  }

  return {
    roomId: 'scene20', scene, camera, physics, physicsWorld, player, cutsceneManager: null,
    ready: Promise.resolve(),
    hideMinimap: () => true,
    getMinimapState: () => ({ position: player.body.position, yaw: player.getState().yaw }),
    getMusicTrack: (): 'stealth-2' => 'stealth-2',
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
