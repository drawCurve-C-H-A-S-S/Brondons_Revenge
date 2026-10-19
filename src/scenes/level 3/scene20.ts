import * as THREE from 'three';
import { inputHint } from '../../scripts/gamepadInput.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom, createSlidingPortal, fitRoomProp } from '../../helpers/scene/shipRoom.js';
import { loadToolModel, loadSubjectModel, loadTexture } from '../../core/loader.js';
import hideoutImageUrl from '../../assets/textures/sudoers-hideout.png?url';
import { createPlayer } from '../../scripts/player.js';
import type { RescueArrival } from '../../helpers/scene/rescueSite.js';
import { createFacilityOffice } from '../../helpers/scene/facilityOffice.js';
import { createFacilityBrowser } from '../../helpers/scene/facilityBrowser.js';
import { createFacilityDeck } from '../../helpers/scene/facilityDeck.js';
import { createFacilityCoreDisplay } from '../../helpers/scene/facilityCore.js';

/**
 * Scene 20 — AI Research Facility interior (Level 3).
 *
 * Ground floor: a laboratory / control room. A four-station control panel only
 * accepts activations in the correct order; the order is deduced from four data
 * logs grouped in the ground-floor archive. Solving it powers the stairwell.
 *
 * Second floor: a glass office. E peeks at the five seated students; their
 * discovery of Brondon triggers the finale (scene21).
 */

type StationId = 'COOLANT' | 'REACTOR' | 'VENT' | 'COMMS';
const SOLUTION: StationId[] = ['COOLANT', 'REACTOR', 'VENT', 'COMMS'];

/** One clue per log; together they uniquely determine SOLUTION. */
const LOG_CLUES: Array<{ position: [number, number, number]; title: string; clue: string }> = [
  { position: [-10.5, 0, 13], title: 'LOG 01 / THERMAL', clue: 'The REACTOR must come immediately after COOLANT.' },
  { position: [-8, 0, 13], title: 'LOG 02 / COMMS', clue: 'COMMS is always activated last.' },
  { position: [-5.5, 0, 13], title: 'LOG 03 / SAFETY', clue: 'VENT is never activated first.' },
  { position: [-3, 0, 13], title: 'LOG 04 / SEQUENCE', clue: 'COOLANT precedes VENT.' },
];

const STATION_X: Record<StationId, number> = { COOLANT: 2, REACTOR: -6, VENT: 6, COMMS: -2 };

export function createScene({ entryState, fromExterior = false, onReturn, onRespawn, onFinished,
  loadModel = loadToolModel, loadStudents = loadSubjectModel }: {
  entryState?: RescueArrival;
  fromExterior?: boolean;
  onReturn?: (state: RescueArrival) => void;
  onRespawn?: () => void;
  onFinished: (state: RescueArrival) => void;
  loadModel?: typeof loadToolModel;
  loadStudents?: typeof loadSubjectModel;
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x16333d);
  scene.fog = new THREE.Fog(0x16333d, 24, 80);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  let disposed = false;
  const browser = createFacilityBrowser(() => {
    player.clearInput(); player.disable(); prompt?.classList.add('hidden');
  }, () => {
    if (!disposed) { player.clearInput(); player.enable(); }
  });

  // ── Materials (bright teal / white control-room palette with green accents) ──
  const wall = new THREE.MeshStandardMaterial({ color: 0x9db4b8, metalness: 0.25, roughness: 0.7 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e6076, metalness: 0.35, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22343c, metalness: 0.5, roughness: 0.5 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xdfe8ea, metalness: 0.3, roughness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x9fe8e0, emissive: 0x2f9c94, emissiveIntensity: 1 });

  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = wall, solid = true) =>
    roomBox(scene, physics, s, p, m, solid);

  // ── Ground-floor shell (tall room; mezzanine slab splits off the 2nd floor) ──
  const W = 14, D = 18, CEIL = 8;
  box([W * 2, 0.4, D * 2], [0, -0.2, 0], floorMat);                 // ground floor
  box([0.4, CEIL, D * 2], [-W, CEIL / 2, 0]);                        // west wall
  box([0.4, CEIL, D * 2], [W, CEIL / 2, 0]);                         // east wall
  box([W * 2, CEIL, 0.4], [0, CEIL / 2, -D]);                       // north wall
  const entrance = createSlidingPortal(scene, physics, { x: 0, y: 0, z: D, yaw: Math.PI },
    W * 2, CEIL, 'AI RESEARCH / ACCESS', { doorHeight: 3.2, landingFloor: false });
  entrance.group.name = 'FacilityEntranceDoor';
  const entranceVoid = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.2),
    new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false, side: THREE.DoubleSide }));
  entranceVoid.name = 'FacilityDoorwayBlackVoid'; entranceVoid.position.set(0, 1.6, -0.18); entrance.group.add(entranceVoid);
  if (fromExterior) entrance.openImmediately();
  box([W * 2, 0.4, D * 2], [0, CEIL + 0.2, 0], dark);               // roof
  // Mezzanine slab over the north half → second floor walkable at y = 4.2.
  // The south half (z > MEZZ_EDGE) stays a double-height atrium for the stair.
  const MEZZ_Y = 4, MEZZ_EDGE = 4;
  box([W * 2, 0.4, D + MEZZ_EDGE], [0, MEZZ_Y, (-D + MEZZ_EDGE) / 2], floorMat);

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

  // ── Ceiling dome with green holographic planet + concentric rings ─────────
  const domeDisc = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ map: planetTexture() }));
  domeDisc.name = 'FacilityHolographicPlanetDome';
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

  // ── Tall skyline windows (south wall + upper side walls) ──────────────────
  const windowMat = new THREE.MeshBasicMaterial({ map: skylineTexture() });
  const mullion = new THREE.MeshStandardMaterial({ color: 0xe6eef0, metalness: 0.3, roughness: 0.5 });
  const southPane = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.5), windowMat);
  southPane.name = 'FacilityEntranceWindow';
  southPane.position.set(0, 5.9, D - 0.36); southPane.rotation.y = Math.PI; scene.add(southPane);
  for (let i = 0; i <= 6; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.5, 0.12), mullion); bar.position.set(-10 + i * (20 / 6), 5.9, D - 0.44); scene.add(bar); }
  for (const sy of [4.05, 7.75]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(20.4, 0.14, 0.3), mullion); rail.position.set(0, sy, D - 0.44); scene.add(rail); }
  for (const sx of [-1, 1]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(24, 2), windowMat);
    pane.position.set(sx * (W - 0.3), 5.6, 0); pane.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(pane);
    for (let i = 0; i <= 8; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.14), mullion); bar.position.set(sx * (W - 0.34), 5.6, -12 + i * 3); scene.add(bar); }
  }

  // ── Wall screens, bookshelves and circular porthole displays ──────────────
  const hideoutCanvas = document.createElement('canvas'); hideoutCanvas.width = 1024; hideoutCanvas.height = 614;
  const hideoutContext = hideoutCanvas.getContext('2d');
  if (!hideoutContext) throw new Error('Unable to draw facility hideout displays');
  const hideoutTexture = new THREE.CanvasTexture(hideoutCanvas); hideoutTexture.colorSpace = THREE.SRGBColorSpace;
  const hideoutScreenMat = new THREE.MeshBasicMaterial({ map: hideoutTexture, toneMapped: false });
  const wallScreensReady = loadTexture(hideoutImageUrl).then(source => {
    try {
      if (disposed) return;
      hideoutContext.drawImage(source.image, 0, 0, 1024, 614);
      hideoutContext.fillStyle = '#ffdb57'; hideoutContext.fillRect(0, 480, 1024, 134);
      hideoutContext.strokeStyle = '#17191f'; hideoutContext.lineWidth = 14; hideoutContext.strokeRect(7, 7, 1010, 600);
      hideoutContext.fillStyle = '#17191f'; hideoutContext.textAlign = 'center';
      hideoutContext.font = '900 80px Impact, Haettenschweiler, "Franklin Gothic Heavy", sans-serif';
      hideoutContext.fillText('SUDOERS HIDEOUT', 512, 576, 960); hideoutTexture.needsUpdate = true;
    } finally { source.dispose(); }
  });
  for (const [sx, sz] of [[-1, 6], [1, -6]] as const) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 3.2), dark);
    frame.position.set(sx * (W - 0.24), 2.6, sz); scene.add(frame);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), hideoutScreenMat);
    scr.name = 'FacilityHideoutWallScreen';
    scr.position.set(sx * (W - 0.38), 2.6, sz); scr.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(scr);
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
  const portholeRingMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ea, metalness: 0.4, roughness: 0.4 });
  for (const [sx, sz] of [[-1, 12], [1, -12], [-1, -12], [1, 12]] as const) {
    const yaw = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    const frame = new THREE.Group(); frame.name = 'FacilityRoundWindow';
    frame.position.set(sx * (W - 0.38), 2.6, sz); frame.rotation.y = yaw; scene.add(frame);
    const backing = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 0.12, 48), dark);
    backing.rotation.x = Math.PI / 2; frame.add(backing);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.83, 0.09, 12, 48), portholeRingMat);
    ring.position.z = 0.04; frame.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.74, 48), windowMat);
    disc.position.z = 0.075; frame.add(disc);
  }

  const facilityCore = createFacilityCoreDisplay(); scene.add(facilityCore.root);
  physics.addBox({ x: 2.8, y: 0.125, z: 2.8 }, { x: 0, y: 0.125, z: 0 });
  physics.addBox({ x: 2.3, y: 0.125, z: 2.3 }, { x: 0, y: 0.375, z: 0 });
  physics.addBox({ x: 1.3, y: 0.7, z: 1.3 }, { x: 0, y: 1.2, z: 0 });

  // ── Workstation models with internet monitors ───────────────────────────
  const monitorMat = browser.material;
  const monitorBody = new THREE.MeshStandardMaterial({ color: 0x2b3a42, metalness: 0.5, roughness: 0.4 });
  function workstation(x: number, z: number, desk: THREE.Group, chair: THREE.Group) {
    desk.name = 'FacilityDesk'; chair.name = 'FacilityChair';
    const deskSize = fitRoomProp(desk, 0.82, 2.2, 1.1);
    const chairSize = fitRoomProp(chair, 1.2, 0.8, 0.9);
    const group = new THREE.Group();
    group.name = 'FacilityWorkstation';
    group.position.set(x, 0, z);
    group.rotation.y = Math.atan2(x, z);
    scene.add(group);
    chair.position.z += 1.05;
    group.add(desk, chair);
    for (const [size, offset] of [[deskSize, 0], [chairSize, 1.05]] as const) {
      const center = group.localToWorld(new THREE.Vector3(0, size.y / 2, offset));
      const body = physics.addBox(size, center);
      body.quaternion.set(group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w);
      body.aabbNeedsUpdate = true;
    }
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), monitorBody);
    stand.position.set(0, deskSize.y + 0.08, -0.2); group.add(stand);
    const mon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.08), monitorBody);
    mon.position.set(0, deskSize.y + 0.51, -0.2); group.add(mon);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), monitorMat);
    scr.position.set(0, deskSize.y + 0.51, -0.155); group.add(scr);
    browser.register(scr);
  }
  const workstations = [[-6, -4], [6, -4], [-6, 6], [6, 6], [-11, 2], [11, 2], [-4, -12], [4, -12]] as const;
  const furnitureReady = Promise.allSettled(workstations.flatMap(() => [
    loadModel('Prop_Desk_Small'), loadModel('Prop_Chair'),
  ])).then(results => {
    const models = results.flatMap(result => result.status === 'fulfilled' ? [result.value.scene] : []);
    const failed = results.find(result => result.status === 'rejected');
    if (disposed || failed?.status === 'rejected') {
      models.forEach(disposeRoom);
      if (failed?.status === 'rejected') throw new Error(`Facility furniture failed to load: ${String(failed.reason)}`);
      return;
    }
    try {
      workstations.forEach(([x, z], index) => workstation(x, z, models[index * 2], models[index * 2 + 1]));
    } catch (error) {
      models.filter(model => !model.parent).forEach(disposeRoom);
      throw error;
    }
  });

  // ── Staircase to the second floor (east side of the atrium, ascending north) ─
  const STAIR_BASE = new THREE.Vector3(11, 0, 16);
  const stairs = physics.addStaircase({ width: 3, run: 12, rise: MEZZ_Y + 0.2, position: STAIR_BASE, material: pale, yaw: Math.PI, stepCount: 22 });
  scene.add(stairs.group);
  stairs.group.name = 'FacilityStaircase';
  const slope = Math.atan2(MEZZ_Y + 0.2, 12), railLength = Math.hypot(MEZZ_Y + 0.2, 12);
  const stairGlass = new THREE.MeshPhysicalMaterial({ color: 0x9fd8e0, transparent: true, opacity: 0.22,
    metalness: 0.15, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  for (const side of [-1, 1]) {
    for (const [height, thickness, material] of [[0.57, 1.02, stairGlass], [1.12, 0.09, dark], [-0.13, 0.22, dark]] as const) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, thickness, railLength), material);
      rail.position.set(side * 1.52, (MEZZ_Y + 0.2) / 2 + height, 6); rail.rotation.x = -slope;
      rail.name = 'StairSlopedRailing'; stairs.group.add(rail);
      if (material === stairGlass) physics.addBoxFromMesh(rail);
    }
    for (let step = 0; step <= 8; step++) {
      const z = 0.15 + step * 11.7 / 8;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), dark);
      post.position.set(side * 1.52, z / 12 * (MEZZ_Y + 0.2) + 0.55, z); stairs.group.add(post);
    }
  }
  for (let step = 0; step < 22; step++) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.88, 0.018, 0.045), stripe);
    edge.position.set(0, (step + 1) * (MEZZ_Y + 0.2) / 22 + 0.014, step * 12 / 22 + 0.025);
    stairs.group.add(edge);
  }

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

  createFacilityDeck(scene, physics);
  const office = createFacilityOffice(scene, physics, loadModel, loadStudents);

  // ── Player / camera ────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  const spawn = { x: 0, y: PHYSICS.playerRadius, z: D - 6 };
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  // Keys released during the load never reach this scene, so held keys stay blocked until released again.
  if (entryState?.pilotState && fromExterior) player.restoreTransition({
    ...entryState.pilotState, velocity: new THREE.Vector3(), heldKeys: [], blockedKeys: entryState.pilotState.heldKeys,
    sprinting: false, crouching: false, intentionalJump: false, jumpQueued: false, slide: undefined, bobIntensity: 0,
  }, entrance.frame);
  else player.setRotation(0);
  player.enable();
  player.updateCamera(0);
  entrance.setTrigger(state => {
    if (!onReturn || finished) return;
    finished = true; player.clearInput(); player.disable();
    onReturn({ ...entryState, facilitySolved: solved, pilotState: state, cameraPosition: undefined, cameraQuaternion: undefined, cameraFov: undefined });
  });

  // ── Puzzle state ───────────────────────────────────────────────────────────
  let progress = 0;             // how many stations correctly activated in a row
  let solved = !!entryState?.facilitySolved;
  let alarmTime = 0;            // >0 while the wrong-order alarm flashes
  let surgeTime = 0;            // >0 while the power surge plays
  let revealTime = -1;          // >=0 once the player has reached the observation deck
  let finished = false;
  const peekStart = new THREE.Vector3(), peekRotation = new THREE.Quaternion();
  let peekFov = 75;
  function applyPeekCamera() {
    if (revealTime < 0) return;
    const blend = THREE.MathUtils.smootherstep(revealTime, 0, 1.2);
    const view = new THREE.PerspectiveCamera(); view.position.copy(office.peekPoint); view.lookAt(office.tablePoint);
    camera.position.lerpVectors(peekStart, view.position, blend);
    camera.quaternion.slerpQuaternions(peekRotation, view.quaternion, blend);
    camera.fov = THREE.MathUtils.lerp(peekFov, 55, blend); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }

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
  messageEl.className = 'facility-message'; messageEl.style.display = 'none';
  messageEl.setAttribute('role', 'status'); messageEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(messageEl);
  const dialogue = document.createElement('section'); dialogue.className = 'facility-dialogue';
  dialogue.setAttribute('aria-live', 'polite');
  const dialogueSpeaker = document.createElement('strong'), dialogueText = document.createElement('p');
  dialogue.append(dialogueSpeaker, dialogueText); document.body.appendChild(dialogue);
  let arrivalTime = 0;
  function updateArrivalDialogue() {
    dialogue.classList.toggle('hidden', arrivalTime >= 8.2 || messageTime > 0 || revealTime >= 0);
    dialogueSpeaker.textContent = arrivalTime < 4.8 ? 'BRONDON' : 'PRIME';
    dialogueText.textContent = arrivalTime < 4.8
      ? 'This looks more like a resort than a prison.' : 'Could it be...?';
  }
  let messageTime = 0;
  function message(text: string, seconds: number) {
    messageEl.textContent = text;
    messageEl.style.display = 'block';
    messageTime = seconds;
  }
  updateArrivalDialogue();
  if (solved) {
    physics.world.removeBody(barrierBody); barrier.visible = false; barrierFrame.visible = false;
    barrierEmitter.color.setHex(0x66ff99);
    for (const station of stations) setLamp(station, 'lit');
  }

  // ── Interaction (E key) ────────────────────────────────────────────────────
  const prompt = document.getElementById('interact-prompt');
  function near(point: THREE.Vector3, radius = 2) {
    const q = player.body.position;
    return Math.hypot(q.x - point.x, q.y + 0.9 - point.y, q.z - point.z) < radius;
  }
  function currentTarget(): { kind: 'peek' } | { kind: 'browser'; screen: THREE.Object3D } | { kind: 'log'; log: Log } | { kind: 'station'; station: Station } | null {
    if (solved && office.canPeek(player.body.position)) return { kind: 'peek' };
    const screen = browser.focusedScreen(camera, player.body.position);
    if (screen) return { kind: 'browser', screen };
    for (const log of logs) if (near(log.position)) return { kind: 'log', log };
    for (const s of stations) if (near(new THREE.Vector3(STATION_X[s.id], 0, -D + 1.4))) return { kind: 'station', station: s };
    return null;
  }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || !player.isEnabled() || disposed || finished
      || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    const target = currentTarget();
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.kind === 'peek') {
      revealTime = 0; peekStart.copy(camera.position); peekRotation.copy(camera.quaternion); peekFov = camera.fov;
      dialogue.classList.add('hidden');
      player.clearInput(); player.disable(); prompt?.classList.add('hidden');
      message('BRONDON: Let me have a look...', 3);
    } else if (target.kind === 'browser') {
      browser.open(target.screen, camera);
    } else if (target.kind === 'log') {
      readLog(target.log);
    } else {
      activateStation(target.station);
    }
    function readLog(log: Log) {
      log.read = true; log.screenMat.color.setHex(0xa4ffcf);
      message(`${log.title}\n${log.clue}`, 4);
    }
  }
  window.addEventListener('keydown', onKey);

  // ── Update loop ────────────────────────────────────────────────────────────
  let clock = 0;
  function updatePhysics(dt: number, thirdPerson = false) {
    if (disposed || finished || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (browser.active) { browser.update(Math.max(0, Math.min(dt, PHYSICS.maxFrameTime))); return; }
    dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
    office.update(dt, revealTime >= 3);
    if (revealTime >= 0) {
      revealTime += dt; applyPeekCamera();
      if (revealTime >= 3) message('THE FIVE: Brondon?!', 0.5);
      if (revealTime >= 6) {
        finished = true;
        onFinished({ ...entryState, cameraPosition: undefined, cameraQuaternion: undefined, cameraFov: undefined,
          pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }) });
      }
      return;
    }
    clock += dt;
    if (messageTime <= 0) arrivalTime += dt;
    updateArrivalDialogue();
    physics.step(dt, player, thirdPerson);
    entrance.update(dt, player, entrance.near(player));
    if (finished) return;

    // Interact prompt
    if (prompt) {
      const target = currentTarget();
      if (target) {
        prompt.classList.remove('hidden');
        prompt.textContent = inputHint(target.kind === 'peek' ? 'E: peek into the office' : target.kind === 'browser' ? 'E: use computer / fla.capitalsigma.biz' : target.kind === 'log'
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

    facilityCore.update(clock);

  }

  return {
    restartAtCheckpoint: () => { if (!onRespawn) return false; onRespawn(); return true; },
    roomId: 'scene20', scene, camera, physics, physicsWorld, player, entrance, cutsceneManager: null,
    isCinematic: () => browser.active || revealTime >= 0,
    hideCharacter: () => revealTime >= 0 || browser.active,
    applyCinematicCamera: () => { if (revealTime >= 0) applyPeekCamera(); else browser.applyCamera(); },
    renderCinematicOverlay: (renderer: THREE.WebGLRenderer) => browser.render(renderer, camera),
    ready: Promise.all([furnitureReady, office.ready, wallScreensReady]),
    hideMinimap: () => true,
    getMinimapState: () => ({ position: player.body.position, yaw: player.getState().yaw }),
    getMusicTrack: (): 'stealth-2' => 'stealth-2',
    updatePhysics,
    dispose() {
      if (disposed) return;
      disposed = true;
      browser.dispose();
      office.dispose();
      window.removeEventListener('keydown', onKey);
      prompt?.classList.add('hidden');
      messageEl.remove(); dialogue.remove();
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}
