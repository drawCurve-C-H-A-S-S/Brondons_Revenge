import * as THREE from 'three';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { playSfx } from '../../helpers/audio/sfx.js';
import { roomBox, disposeRoom } from '../../scripts/global/shipRoom.js';
import { createShipInteriorMaterials, SHIP_INTERIOR_PALETTE } from '../../scripts/global/shipInterior.js';
import { createCameraVisitUI } from '../../scripts/global/cameraVisit.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player/player.js';
import { teleportPlayer } from '../../scripts/global/teleportationDevice.js';
import { createRewardChest } from '../../scripts/global/rewardChest.js';
import { inputHint } from '../../scripts/player/gamepadInput.js';
import { cameraVisitMap, type CameraRoomProgress } from './stageTwoLayout.js';

/**
 * Reactor Sequencer — four power stations only accept activations in the right
 * order, deduced from four wall-mounted data logs. Solving it unlocks a keycard chest.
 */

interface ReactorRoomOptions {
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  loot?: CameraRoomProgress;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onKeycardCollected?: () => void;
  modelLoader?: typeof loadToolModel;
}

type StationId = 'COOLANT' | 'REACTOR' | 'VENT' | 'COMMS';
const SOLUTION: StationId[] = ['COOLANT', 'REACTOR', 'VENT', 'COMMS'];
const HALF_W = 8, HALF_D = 7, HEIGHT = 5, SOLVED = 'reactor-solved';
const STATIONS: Record<StationId, { x: number; color: number; accent: string; icon: string }> = {
  REACTOR: { x: -5.1, color: 0xff8a2e, accent: '#ff8a2e', icon: '☢' },
  COMMS: { x: -1.7, color: 0xb67cff, accent: '#b67cff', icon: '⌁' },
  COOLANT: { x: 1.7, color: 0x3fc8ff, accent: '#3fc8ff', icon: '❄' },
  VENT: { x: 5.1, color: 0x5dff9c, accent: '#5dff9c', icon: '≋' },
};
const LOGS: Array<{ x: number; z: number; title: string; clue: string }> = [
  { x: -HALF_W, z: -2.2, title: 'LOG 01 / THERMAL', clue: 'The REACTOR must come immediately after COOLANT.' },
  { x: -HALF_W, z: 1.6, title: 'LOG 02 / COMMS', clue: 'COMMS is always activated last.' },
  { x: HALF_W, z: -2.2, title: 'LOG 03 / SAFETY', clue: 'VENT is never activated first.' },
  { x: HALF_W, z: 1.6, title: 'LOG 04 / SEQUENCE', clue: 'COOLANT precedes VENT.' },
];

export function createScene({ entryState, preview = false, deferActivation = false,
  loot = { cleared: new Set<string>(), rewardCollected: false }, hasReturnMarker, onRestart,
  onKeycardCollected, modelLoader = loadToolModel }: ReactorRoomOptions = {}) {
  if (!preview && (!hasReturnMarker || !onRestart || !onKeycardCollected))
    throw new Error('The Reactor Sequencer requires a camera return link and persistent keycard reward');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  scene.fog = new THREE.Fog(SHIP_INTERIOR_PALETTE.background, 18, 40);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 80);
  const materials = createShipInteriorMaterials(8, 7);
  const ownedMaterials: THREE.Material[] = [], ownedTextures: THREE.Texture[] = [];
  const own = <T extends THREE.Material>(material: T) => { ownedMaterials.push(material); return material; };
  const box = (size: [number, number, number], point: [number, number, number],
    material: THREE.Material = materials.steel, solid = true) => roomBox(scene, physics, size, point, material, solid);
  function canvasTexture(width: number, height: number) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to draw a Reactor Sequencer display');
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; ownedTextures.push(texture);
    return { context, texture };
  }

  // Shell
  box([HALF_W * 2, 0.2, HALF_D * 2], [0, -0.1, 0], materials.deck);
  box([HALF_W * 2, 0.16, HALF_D * 2], [0, HEIGHT, 0], materials.dark).userData.minimap = false;
  for (const side of [-1, 1]) {
    box([0.18, HEIGHT, HALF_D * 2], [side * HALF_W, HEIGHT / 2, 0]);
    box([HALF_W * 2, HEIGHT, 0.18], [0, HEIGHT / 2, side * HALF_D]);
    box([0.035, 0.06, HALF_D * 2 - 0.5], [side * (HALF_W - 0.15), 0.12, 0], materials.cyan, false);
    box([HALF_W * 2 - 0.5, 0.06, 0.035], [0, 0.12, side * (HALF_D - 0.15)], materials.cyan, false);
  }
  // Raised control dais in front of the station wall.
  const dais = own(new THREE.MeshStandardMaterial({ color: 0x1f2c38, metalness: 0.6, roughness: 0.4 }));
  box([HALF_W * 2 - 0.4, 0.12, 3.2], [0, 0.06, -HALF_D + 1.8], dais);
  box([HALF_W * 2 - 0.4, 0.03, 0.06], [0, 0.135, -HALF_D + 3.4], materials.cyan, false);
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.1), new THREE.HemisphereLight(0xbbd7ed, 0x1a2430, 1.3));
  const roomLights = [new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 22, 16), new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 18, 16)];
  roomLights[0].position.set(0, HEIGHT - 0.5, -3); roomLights[1].position.set(0, HEIGHT - 0.5, 4); scene.add(...roomLights);

  // Front wall: sealed door.
  const hazard = own(new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0x3a2a00, roughness: 0.5 }));
  box([2.6, 3.2, 0.2], [0, 1.6, HALF_D - 0.12], materials.trim, false);
  for (const side of [-1, 1]) box([1.1, 2.9, 0.12], [side * 0.57, 1.45, HALF_D - 0.24], materials.dark, false);
  box([2.2, 0.1, 0.14], [0, 1.45, HALF_D - 0.27], hazard, false);
  const lockMaterial = own(new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }));
  box([0.36, 0.5, 0.08], [1.5, 1.4, HALF_D - 0.24], lockMaterial, false);
  const lockLight = new THREE.PointLight(0xff2a3a, 3, 4); lockLight.position.set(1.5, 1.4, HALF_D - 0.6); scene.add(lockLight);
  const doorSign = canvasTexture(512, 112);
  doorSign.context.fillStyle = '#1a0306'; doorSign.context.fillRect(0, 0, 512, 112);
  doorSign.context.fillStyle = '#ff4054'; doorSign.context.font = 'bold 64px monospace'; doorSign.context.textAlign = 'center';
  doorSign.context.fillText('LOCKED', 256, 78);
  const doorSignMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.4), own(new THREE.MeshBasicMaterial({ map: doorSign.texture, toneMapped: false })));
  doorSignMesh.position.set(0, 3.45, HALF_D - 0.3); doorSignMesh.rotation.y = Math.PI; scene.add(doorSignMesh);

  // Stations: angled consoles with a big push button, ring light, floor glow, conduit and holo label.
  interface Station {
    id: StationId; root: THREE.Group; button: THREE.Mesh; glow: THREE.MeshStandardMaterial; conduit: THREE.MeshStandardMaterial;
    floor: THREE.MeshBasicMaterial; holo: THREE.Mesh; light: THREE.PointLight; press: number; state: 'idle' | 'lit' | 'error';
  }
  const shell = own(new THREE.MeshStandardMaterial({ color: 0x2a3846, metalness: 0.7, roughness: 0.35 }));
  const panel = own(new THREE.MeshStandardMaterial({ color: 0x0c141c, metalness: 0.4, roughness: 0.3 }));
  const chrome = own(new THREE.MeshStandardMaterial({ color: 0xc7d3dc, metalness: 0.9, roughness: 0.2 }));
  const stations: Station[] = (Object.keys(STATIONS) as StationId[]).map(id => {
    const config = STATIONS[id], root = new THREE.Group(); root.name = `Station-${id}`;
    root.position.set(config.x, 0.12, -HALF_D + 1.1); scene.add(root);
    const glow = own(new THREE.MeshStandardMaterial({ color: config.color, emissive: config.color, emissiveIntensity: 0.25, roughness: 0.3 }));
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, at: [number, number, number], rotX = 0) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...at); mesh.rotation.x = rotX;
      mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
    };
    add(new THREE.BoxGeometry(2.2, 0.18, 1.3), shell, [0, 0.09, 0]);
    add(new THREE.BoxGeometry(1.8, 0.95, 0.85), shell, [0, 0.65, -0.05]);
    add(new THREE.BoxGeometry(1.84, 0.04, 0.04), glow, [0, 0.45, 0.39]);
    add(new THREE.BoxGeometry(1.95, 0.1, 1.0), panel, [0, 1.2, 0.05], 0.42);
    add(new THREE.TorusGeometry(0.3, 0.035, 10, 36), chrome, [0, 1.28, 0.12], -Math.PI / 2 + 0.42);
    const button = add(new THREE.CylinderGeometry(0.24, 0.26, 0.12, 32), glow, [0, 1.29, 0.12], 0.42);
    for (const x of [-0.65, 0.65]) add(new THREE.BoxGeometry(0.3, 0.02, 0.18), glow, [x, 1.27, 0.12], 0.42);
    physics.addBox({ x: 2.2, y: 1.4, z: 1.3 }, { x: config.x, y: 0.82, z: -HALF_D + 1.1 });
    // Conduit up the wall to the banner.
    const conduit = own(new THREE.MeshStandardMaterial({ color: 0x223040, emissive: config.color, emissiveIntensity: 0.05, metalness: 0.5, roughness: 0.4 }));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, HEIGHT - 2.6, 12), conduit);
    pipe.position.set(0, 1.3 + (HEIGHT - 2.6) / 2, -0.85); root.add(pipe);
    for (const y of [1.6, 2.4]) add(new THREE.TorusGeometry(0.12, 0.025, 8, 20), chrome, [0, y, -0.85], Math.PI / 2);
    // Floor glow pad.
    const floor = own(new THREE.MeshBasicMaterial({ color: config.color, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 40), floor);
    pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.02, 1.25); root.add(pad);
    // Floating holo label.
    const label = canvasTexture(256, 128), c = label.context;
    c.clearRect(0, 0, 256, 128); c.fillStyle = 'rgba(6,18,28,0.75)'; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = config.accent; c.lineWidth = 5; c.strokeRect(4, 4, 248, 120);
    c.fillStyle = config.accent; c.textAlign = 'center'; c.font = '44px sans-serif'; c.fillText(config.icon, 128, 56);
    c.font = 'bold 34px monospace'; c.fillText(id, 128, 106);
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55),
      own(new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, opacity: 0.92, toneMapped: false, depthWrite: false, side: THREE.DoubleSide })));
    holo.position.set(0, 2.05, 0.1); root.add(holo);
    const light = new THREE.PointLight(config.color, 2, 4); light.position.set(0, 1.7, 0.6); root.add(light);
    return { id, root, button, glow, conduit, floor, holo, light, press: 0, state: 'idle' as const };
  });

  // Central sequencer core: a glass column with four rings that light per correct step.
  const coreGlass = own(new THREE.MeshPhysicalMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }));
  const coreEnergy = own(new THREE.MeshBasicMaterial({ color: 0x6ad9e8, transparent: true, opacity: 0.25, toneMapped: false }));
  box([1.9, 0.3, 1.9], [0, 0.15, 0.6], shell);
  box([1.9, 0.3, 1.9], [0, HEIGHT - 0.15, 0.6], shell, false);
  const coreColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, HEIGHT - 0.6, 32, 1, true), coreGlass);
  coreColumn.position.set(0, HEIGHT / 2, 0.6); scene.add(coreColumn);
  const coreBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, HEIGHT - 0.6, 16), coreEnergy);
  coreBeam.position.copy(coreColumn.position); scene.add(coreBeam);
  physics.addBox({ x: 1.3, y: HEIGHT, z: 1.3 }, { x: 0, y: HEIGHT / 2, z: 0.6 });
  const coreRings = SOLUTION.map((_, index) => {
    const material = own(new THREE.MeshStandardMaterial({ color: 0x2b3946, emissive: 0x000000, metalness: 0.7, roughness: 0.3 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.06, 10, 40), material);
    ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.9 + index * 0.9, 0.6); scene.add(ring);
    return material;
  });
  const coreLight = new THREE.PointLight(0x6ad9e8, 4, 9); coreLight.position.set(0, 2.5, 0.6); scene.add(coreLight);

  // Clue posters pinned to the side walls.
  LOGS.forEach((entry, index) => {
    const side = Math.sign(entry.x), face = new THREE.Group();
    face.position.set(entry.x - side * 0.1, 1.75, entry.z); face.rotation.y = -side * Math.PI / 2;
    face.rotation.z = (index % 2 ? 1 : -1) * 0.025; scene.add(face);
    const poster = canvasTexture(384, 512), c = poster.context;
    c.fillStyle = '#e9e1cc'; c.fillRect(0, 0, 384, 512);
    c.fillStyle = '#1b2a36'; c.fillRect(0, 0, 384, 96);
    c.fillStyle = '#ffcf3a'; c.textAlign = 'center'; c.font = 'bold 26px monospace'; c.fillText('ENGINEERING', 192, 42);
    c.font = 'bold 22px monospace'; c.fillText(entry.title, 192, 78);
    c.strokeStyle = '#1b2a36'; c.lineWidth = 8; c.strokeRect(4, 4, 376, 504);
    c.fillStyle = '#1b2a36'; c.font = 'bold 34px sans-serif';
    const words = entry.clue.split(' '), lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (c.measureText(next).width > 320 && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    const top = 300 - lines.length * 22;
    lines.forEach((text, row) => c.fillText(text, 192, top + row * 46));
    c.fillStyle = '#b8342c'; c.font = 'bold 20px monospace'; c.fillText('POWER-UP PROTOCOL', 192, 470);
    poster.texture.needsUpdate = true;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.46), own(new THREE.MeshStandardMaterial({ map: poster.texture, roughness: 0.85 })));
    plane.position.z = 0.01; face.add(plane);
    for (const [x, y] of [[-0.48, 0.66], [0.48, 0.66], [-0.48, -0.66], [0.48, -0.66]]) {
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), chrome); pin.position.set(x, y, 0.03); face.add(pin);
    }
  });

  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 5 } });
  teleportPlayer(player, { x: -3, y: player.radius, z: 5 }, 0, entryState);
  let solved = loot.cleared.has(SOLVED) || loot.rewardCollected;
  let progress = solved ? SOLUTION.length : 0;
  let active = !preview && !deferActivation, disposed = false, paused = false, greeted = false;
  let alarmTime = 0, surgeTime = 0, captionTime = 0, time = 0, ownsPrompt = false, doorWarned = false;

  const chest = createRewardChest({ scene, world: physics.world, player,
    position: new THREE.Vector3(HALF_W - 1.1, 0, 5), yaw: Math.PI / 2, reward: 'keycard', style: 'crew',
    initialCollected: loot.rewardCollected, unlocked: () => solved,
    lockedPrompt: 'Sequence all four stations to unlock this keycard',
    canInteract: () => active && !paused,
    onCollect: () => { onKeycardCollected?.(); loot.rewardCollected = true; return true; } }, modelLoader);

  const caption = document.createElement('div'); caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  if (!preview) document.body.append(caption);
  function tell(text: string, seconds = 3) { caption.textContent = inputHint(text); captionTime = seconds; caption.classList.remove('hidden'); }
  const visitUI = !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: 'Reactor Sequencer', player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);
  if (active) player.enable();

  function paint(station: Station, state: Station['state']) {
    station.state = state;
    const color = state === 'error' ? 0xff3344 : STATIONS[station.id].color;
    station.glow.emissive.setHex(color); station.glow.color.setHex(color);
    station.glow.emissiveIntensity = state === 'idle' ? 0.25 : 1.6;
    station.conduit.emissive.setHex(color); station.conduit.emissiveIntensity = state === 'idle' ? 0.05 : 1.2;
    station.floor.color.setHex(color); station.light.color.setHex(color); station.light.intensity = state === 'idle' ? 2 : 9;
  }
  function paintCore() {
    coreRings.forEach((ring, index) => {
      const on = index < progress;
      ring.emissive.setHex(on ? (solved ? 0x7dff6a : 0x6ad9e8) : 0x000000); ring.emissiveIntensity = on ? 1.4 : 0;
    });
    coreEnergy.color.setHex(solved ? 0x7dff6a : 0x6ad9e8);
    coreLight.color.setHex(solved ? 0x7dff6a : 0x6ad9e8);
  }
  function refresh() {
    for (const station of stations) paint(station, solved || SOLUTION.indexOf(station.id) < progress ? 'lit' : 'idle');
    paintCore();
  }
  refresh();

  function activate(station: Station) {
    station.press = 1;
    if (solved) { tell('The sequence is already complete.', 2); return; }
    if (station.id === SOLUTION[progress]) {
      progress++; playSfx('keypad', 0.6, 1 + progress * 0.08);
      if (progress === SOLUTION.length) {
        solved = true; loot.cleared.add(SOLVED); surgeTime = 1.8; playSfx('door', 0.6);
        tell('Power restored. The keycard chest is unlocked.', 4);
      } else tell(`${station.id} online.`, 1.6);
      refresh();
    } else {
      progress = 0; alarmTime = 1.2; playSfx('clank', 0.6, 0.7);
      for (const s of stations) paint(s, 'error');
      paintCore();
      tell('Wrong order. The panel reset. Check the posters.', 3);
    }
  }
  const interactPrompt = document.getElementById('interact-prompt');
  function target(): Station | null {
    const p = player.body.position;
    for (const station of stations) if (Math.hypot(p.x - station.root.position.x, p.z - (station.root.position.z + 1.3)) < 1.1) return station;
    return null;
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || !active || paused || !player.isEnabled()) return;
    const focus = target(); if (!focus) return;
    event.preventDefault(); event.stopImmediatePropagation();
    activate(focus);
  }
  if (!preview) window.addEventListener('keydown', onKeyDown);

  return {
    roomId: 'reactor-sequencer', scene, camera, player, physicsWorld: physics.world, ready: chest.ready, cutsceneManager: null,
    getSceneId: () => 'stage2-reactor', getMapLayout: () => cameraVisitMap(39), getMapSceneId: () => 'scene39',
    getMusicTrack: () => 'puzzle' as const,
    activate() { active = true; visitUI?.setVisible(true); player.clearInput(); player.enable(); },
    controlsReady: () => active && !paused, isCinematic: () => false, ownsWeaponInput: false,
    setMenuPaused(value: boolean) { paused = value; player.clearInput(); },
    chest,
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || paused || document.hidden || (!active && !preview)) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0;
      time += frame;
      for (const station of stations) {
        station.press = Math.max(0, station.press - frame * 5);
        station.button.position.y = 1.29 - station.press * 0.06;
        station.holo.position.y = 2.05 + Math.sin(time * 2 + station.root.position.x) * 0.05;
        station.floor.opacity = (station.state === 'idle' ? 0.12 : 0.4) + Math.sin(time * 3) * 0.05;
      }
      coreBeam.scale.set(1 + Math.sin(time * 6) * 0.08, 1, 1 + Math.sin(time * 6) * 0.08);
      coreEnergy.opacity = 0.2 + progress * 0.15 + Math.sin(time * 5) * 0.05;
      coreLight.intensity = 3 + progress * 3;
      if (preview) return;
      if (!greeted) { greeted = true; tell('Prime: Engineering cadets drilled power-up sequences in here. Read the posters first.', 5); }
      physics.step(frame, player, thirdPerson); chest.update(frame); visitUI?.update();
      captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
      if (alarmTime > 0) {
        alarmTime -= frame;
        const flash = Math.sin(time * 30) > 0;
        for (const light of roomLights) light.color.setHex(flash ? 0xff4455 : SHIP_INTERIOR_PALETTE.light);
        if (alarmTime <= 0) { for (const light of roomLights) light.color.setHex(SHIP_INTERIOR_PALETTE.light); refresh(); }
      }
      if (surgeTime > 0) {
        surgeTime -= frame;
        const flicker = 0.6 + Math.abs(Math.sin(time * 24)) * 0.8;
        for (const light of roomLights) light.intensity = 22 * flicker;
        if (surgeTime <= 0) for (const light of roomLights) light.intensity = 22;
      }
      const p = player.body.position;
      const nearDoor = Math.abs(p.x) < 1.6 && p.z > HALF_D - 2;
      if (nearDoor && !doorWarned) tell('The door is locked.');
      doorWarned = nearDoor;
      const focus = player.isEnabled() ? target() : null;
      if (focus && interactPrompt) {
        interactPrompt.textContent = inputHint(`E / Activate ${focus.id}`);
        interactPrompt.classList.remove('hidden'); ownsPrompt = true;
      } else if (ownsPrompt) { interactPrompt?.classList.add('hidden'); ownsPrompt = false; }
    },
    syncProgress() {
      if (loot.rewardCollected || loot.cleared.has(SOLVED)) { solved = true; progress = SOLUTION.length; refresh(); }
      if (loot.rewardCollected) chest.setCollected();
    },
    minimap: { bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }, floor: 0 },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      if (ownsPrompt) interactPrompt?.classList.add('hidden');
      for (const material of ownedMaterials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      visitUI?.dispose(); chest.dispose(); caption.remove(); player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
