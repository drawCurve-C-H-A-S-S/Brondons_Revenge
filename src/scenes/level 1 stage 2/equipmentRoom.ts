import * as THREE from 'three';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { playSfx } from '../../helpers/audio/sfx.js';
import { roomBox, disposeRoom } from '../../scripts/global/shipRoom.js';
import { createShipInteriorMaterials, SHIP_INTERIOR_PALETTE } from '../../scripts/global/shipInterior.js';
import { createCameraVisitUI } from '../../scripts/global/cameraVisit.js';
import { createRecoveryPickup } from '../../scripts/global/recoveryPickup.js';
import { createLightsaber, disposeLightsaber } from '../../scripts/items/createLightsaber.js';
import { createTennisRacket, disposeTennisRacket } from '../../scripts/items/createTennisRacket.js';
import fireVertexShader from '../../shaders/vert/fireExplosion.vert.glsl?raw';
import fireFragmentShader from '../../shaders/frag/fireExplosion.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player/player.js';
import { teleportPlayer } from '../../scripts/global/teleportationDevice.js';
import { createRewardChest } from '../../scripts/global/rewardChest.js';
import type { ParryableBolt } from '../../scripts/weapons/lightsaber.js';
import { inputHint } from '../../scripts/player/gamepadInput.js';
import { cameraVisitMap, createStageTwoProgress, type StageTwoProgress } from './stageTwoLayout.js';

interface TennisRoomOptions {
  progress?: StageTwoProgress;
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onLightsaberCollected?: () => void;
  onKeycardCollected?: () => void;
  modelLoader?: typeof loadToolModel;
}

type LaneKind = 'tennis' | 'bullets' | 'bombs';
interface Shot { bolt: ParryableBolt; lane: number; age: number; spark?: THREE.Mesh }
interface Fx { mesh: THREE.Mesh; age: number; life: number; velocity?: THREE.Vector3; grow?: number; ownsMaterial: boolean;
  fire?: { uTime: { value: number }; uProgress: { value: number } }; light?: THREE.PointLight }

const HALF_W = 9, HALF_D = 11, HEIGHT = 6, WALL_Z = -HALF_D + 0.2, FIELD_Z = WALL_Z + 0.45, TARGET_HITS = 10;
const SCREEN_Y = 2.6, SCREEN_W = 4.4, SCREEN_H = 2.4, PLATE_Z = 2.5;
const BULLET_DAMAGE = 10, BOMB_DAMAGE = 25, BOMB_RADIUS = 3.6, BOMB_FUSE = 2.6;
// Each successful hit adds 5% launch speed (up to +45% at 9/10) so the streak ramps without becoming unreturnable.
const SPEED_RAMP = 0.05;
const LANES: Array<{ kind: LaneKind; name: string; x: number; speed: number; accent: string; color: number }> = [
  { kind: 'tennis', name: 'CENTRE COURT', x: -6, speed: 11, accent: '#c8ef35', color: 0xc8ef35 },
  { kind: 'bullets', name: 'DECK GUNNERY', x: 0, speed: 13, accent: '#ff4b5c', color: 0xff4b5c },
  { kind: 'bombs', name: "NO MAN'S LAND", x: 6, speed: 9, accent: '#ff9a2e', color: 0xff9a2e },
];

export function createScene({ progress = createStageTwoProgress(), entryState, preview = false, deferActivation = false,
  hasReturnMarker, onRestart, onLightsaberCollected, onKeycardCollected, modelLoader = loadToolModel }: TennisRoomOptions = {}) {
  if (!preview && (!hasReturnMarker || !onRestart || !onKeycardCollected))
    throw new Error('Saber Batting Cage requires a camera return link and persistent keycard reward');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 90);
  const materials = createShipInteriorMaterials(9, 11);
  const ownedMaterials: THREE.Material[] = [], ownedTextures: THREE.Texture[] = [];
  const own = <T extends THREE.Material>(material: T) => { ownedMaterials.push(material); return material; };
  const box = (size: [number, number, number], point: [number, number, number],
    material: THREE.Material = materials.steel, solid = true) => roomBox(scene, physics, size, point, material, solid);
  function canvasPlane(width: number, height: number, pxW: number, pxH: number) {
    const canvas = document.createElement('canvas'); canvas.width = pxW; canvas.height = pxH;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create a Saber Batting Cage display');
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; ownedTextures.push(texture);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })));
    scene.add(mesh);
    return { context, texture, mesh };
  }

  // Shell
  const laneLength = HALF_D + 4, laneCenter = (4 - HALF_D) / 2;
  box([HALF_W * 2, 0.2, HALF_D * 2], [0, -0.1, 0], materials.deck);
  box([HALF_W * 2, 0.16, HALF_D * 2], [0, HEIGHT, 0], materials.dark).userData.minimap = false;
  for (const side of [-1, 1]) {
    box([0.18, HEIGHT, HALF_D * 2], [side * HALF_W, HEIGHT / 2, 0]);
    box([HALF_W * 2, HEIGHT, 0.18], [0, HEIGHT / 2, side * HALF_D]);
    box([0.035, 0.06, HALF_D * 2 - 0.5], [side * (HALF_W - 0.15), 0.12, 0], materials.cyan, false);
    box([0.2, 1.1, laneLength - 1], [side * 3, 0.55, laneCenter - 0.5], materials.trim);
    box([0.06, 0.06, laneLength - 1], [side * 3, 1.12, laneCenter - 0.5], materials.cyan, false);
  }
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.3),
    new THREE.HemisphereLight(0xbbd7ed, 0x273342, 1.6));
  const lamp = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 30, 22);
  lamp.position.set(0, HEIGHT - 0.5, 6); scene.add(lamp);

  // Centre Court: green court, white lines and a low net.
  const court = own(new THREE.MeshStandardMaterial({ color: 0x2f7d4a, roughness: 0.9 }));
  const courtLine = own(new THREE.MeshBasicMaterial({ color: 0xf4f8f0 }));
  const net = own(new THREE.MeshStandardMaterial({ color: 0xe8eef0, transparent: true, opacity: 0.45, roughness: 1 }));
  box([5.6, 0.03, laneLength], [-6, 0.015, laneCenter], court, false);
  for (const x of [-8.5, -3.5]) box([0.08, 0.035, laneLength], [x, 0.03, laneCenter], courtLine, false);
  for (const z of [-10.6, -4, 1, 3.8]) box([5, 0.035, 0.08], [-6, 0.03, z], courtLine, false);
  box([0.08, 0.035, 5], [-6, 0.03, -1.5], courtLine, false);
  box([5, 0.9, 0.04], [-6, 0.45, -4], net, false);
  box([5, 0.06, 0.06], [-6, 0.92, -4], courtLine, false);
  for (const x of [-8.55, -3.45]) box([0.08, 1, 0.08], [x, 0.5, -4], materials.trim, false);
  const tennisLight = new THREE.PointLight(0xe7ffd0, 12, 14); tennisLight.position.set(-6, HEIGHT - 0.6, -3); scene.add(tennisLight);

  // Deck Gunnery: ship deck, hazard striping, cover pillars and red alarm light.
  const hazard = own(new THREE.MeshStandardMaterial({ color: 0xc93340, emissive: 0x4a0710, roughness: 0.5 }));
  box([5.6, 0.03, laneLength], [0, 0.015, laneCenter], materials.dark, false);
  for (const x of [-2.6, 2.6]) box([0.2, 0.035, laneLength], [x, 0.03, laneCenter], hazard, false);
  for (let z = -10; z <= 3; z += 2) box([4.8, 0.035, 0.12], [0, 0.03, z], materials.cyan, false);
  for (const x of [-2.2, 2.2]) for (const z of [-8.5, -5]) box([0.5, 2.2, 0.5], [x, 1.1, z], materials.steel);
  const alarm = new THREE.PointLight(0xff3a4a, 10, 14); alarm.position.set(0, HEIGHT - 0.6, -5); scene.add(alarm);

  // No Man's Land: scorched earth, craters and sandbag walls.
  const dirt = own(new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }));
  const crater = own(new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 }));
  const sandbag = own(new THREE.MeshStandardMaterial({ color: 0x8c7a55, roughness: 1 }));
  box([5.6, 0.03, laneLength], [6, 0.015, laneCenter], dirt, false);
  for (const [x, z, r] of [[5, -8, 0.8], [7.2, -4.5, 0.6], [5.6, -1, 0.5], [7, 1.5, 0.4]] as const) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 20), crater);
    hole.rotation.x = -Math.PI / 2; hole.position.set(x, 0.04, z); scene.add(hole);
  }
  for (const x of [3.55, 8.45]) for (let z = -10.4; z <= 1.2; z += 0.66) for (let row = 0; row < 2; row++)
    box([0.55, 0.3, 0.62], [x, 0.15 + row * 0.3, z + row * 0.2], sandbag, false);
  const fire = new THREE.PointLight(0xff8a2a, 11, 14); fire.position.set(6, HEIGHT - 0.6, -4); scene.add(fire);

  // Far wall: one launcher screen behind a force field per lane.
  const lanes = LANES.map(lane => {
    box([SCREEN_W + 0.3, SCREEN_H + 0.3, 0.12], [lane.x, SCREEN_Y, -HALF_D + 0.09], materials.trim, false);
    const display = canvasPlane(SCREEN_W, SCREEN_H, 512, 280); display.mesh.position.set(lane.x, SCREEN_Y, WALL_Z);
    const launcher = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), own(new THREE.MeshBasicMaterial({ color: 0x010305, toneMapped: false })));
    launcher.position.set(lane.x, SCREEN_Y - 0.5, WALL_Z + 0.02); scene.add(launcher);
    const accent = own(new THREE.MeshBasicMaterial({ color: lane.color, toneMapped: false }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 8, 40), accent);
    rim.position.copy(launcher.position); rim.position.z += 0.015; scene.add(rim);
    const plate = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.86, 4), accent);
    plate.rotation.set(-Math.PI / 2, 0, Math.PI / 4); plate.position.set(lane.x, 0.05, PLATE_Z); scene.add(plate);
    const fieldMaterial = own(new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const field = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), fieldMaterial);
    field.position.set(lane.x, SCREEN_Y, FIELD_Z); scene.add(field);
    for (const side of [-1, 1]) box([0.1, SCREEN_H + 0.2, 0.5], [lane.x + side * (SCREEN_W / 2 + 0.1), SCREEN_Y, WALL_Z + 0.25], materials.cyan, false);
    return { display, launcher, fieldMaterial, flash: 0 };
  });
  box([HALF_W * 2 - 1, 1.3, 0.12], [0, 5.05, -HALF_D + 0.09], materials.trim, false);
  const board = canvasPlane(HALF_W * 2 - 1.3, 1.1, 2048, 160); board.mesh.position.set(0, 5.05, WALL_Z);

  // Hanging lane-name signs above each lane entrance.
  LANES.forEach(lane => {
    for (const side of [-1, 1]) box([0.04, HEIGHT - 4.95, 0.04], [lane.x + side * 1.7, (HEIGHT + 4.95) / 2, 0.5], materials.steel, false);
    box([4, 0.8, 0.1], [lane.x, 4.6, 0.44], materials.trim, false);
    const sign = canvasPlane(3.85, 0.68, 1024, 180); sign.mesh.position.set(lane.x, 4.6, 0.5);
    const c = sign.context;
    c.fillStyle = '#071019'; c.fillRect(0, 0, 1024, 180);
    c.strokeStyle = lane.accent; c.lineWidth = 10; c.strokeRect(8, 8, 1008, 164);
    c.textAlign = 'center'; c.fillStyle = lane.accent; c.font = 'bold 92px sans-serif'; c.fillText(lane.name, 512, 122);
    sign.texture.needsUpdate = true;
  });

  // Front wall: sealed door.
  box([2.6, 3.2, 0.2], [0, 1.6, HALF_D - 0.12], materials.trim, false);
  for (const side of [-1, 1]) box([1.1, 2.9, 0.12], [side * 0.57, 1.45, HALF_D - 0.24], materials.dark, false);
  box([2.2, 0.1, 0.14], [0, 1.45, HALF_D - 0.27], hazard, false);
  const lockMaterial = own(new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }));
  box([0.36, 0.5, 0.08], [1.5, 1.4, HALF_D - 0.24], lockMaterial, false);
  const lockLight = new THREE.PointLight(0xff2a3a, 3, 4); lockLight.position.set(1.5, 1.4, HALF_D - 0.6); scene.add(lockLight);
  const doorSign = canvasPlane(1.8, 0.4, 512, 112); doorSign.mesh.position.set(0, 3.45, HALF_D - 0.3); doorSign.mesh.rotation.y = Math.PI;
  doorSign.context.fillStyle = '#1a0306'; doorSign.context.fillRect(0, 0, 512, 112);
  doorSign.context.fillStyle = '#ff4054'; doorSign.context.font = 'bold 64px monospace'; doorSign.context.textAlign = 'center';
  doorSign.context.fillText('LOCKED', 256, 78);

  // East wall: poem plaque.
  const poem = canvasPlane(2.6, 2, 640, 492); poem.mesh.position.set(HALF_W - 0.11, 2.1, 5); poem.mesh.rotation.y = -Math.PI / 2;
  {
    const c = poem.context; c.fillStyle = '#0b1622'; c.fillRect(0, 0, 640, 492);
    c.strokeStyle = '#c9a85a'; c.lineWidth = 8; c.strokeRect(10, 10, 620, 472);
    c.fillStyle = '#f0d58a'; c.textAlign = 'center'; c.font = 'bold 40px serif'; c.fillText('ODE TO THE CAGE', 320, 70);
    c.fillStyle = '#e6eef5'; c.font = 'italic 27px serif';
    ['Swing for the court where the white lines run,', 'swing for the deck where the red bolts come,',
      'swing for the field where the fuses burn -', 'whatever they send you, send back in turn.',
      '', 'Miss but once and the count goes cold;', 'ten in a row is the only gold.']
      .forEach((line, index) => c.fillText(line, 320, 135 + index * 42));
    c.fillStyle = '#9fb3c4'; c.font = '22px serif'; c.fillText('- Cadet Saber Club', 320, 455);
  }

  // West wall: equipment rack with a tennis racket and a working lightsaber.
  box([0.08, 1.2, 2.4], [-HALF_W + 0.13, 1.75, 5.5], materials.trim, false);
  for (const z of [4.8, 6.2]) box([0.18, 0.05, 0.05], [-HALF_W + 0.22, 1.5, z], materials.steel, false);
  const racket = createTennisRacket(); racket.name = 'WallTennisRacket'; racket.scale.setScalar(1.15);
  racket.rotation.set(0, Math.PI / 2, -0.22); racket.position.set(-HALF_W + 0.22, 1.18, 6.2); scene.add(racket);
  box([0.1, 0.06, 0.06], [-HALF_W + 0.18, 1.82, 6.12], materials.steel, false);
  const saberPosition = new THREE.Vector3(-HALF_W + 0.24, 1.55, 4.8);
  const wallSaber = createLightsaber(true); wallSaber.name = 'WallLightsaber';
  wallSaber.rotation.set(0.35, 0, 0); wallSaber.position.copy(saberPosition); scene.add(wallSaber);
  wallSaber.visible = !progress.lightsaberBeamCollected;

  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 8.5 } });
  teleportPlayer(player, { x: 0, y: player.radius, z: 8.5 }, 0, entryState);
  const loot = progress.remoteRooms['stage2-armory'];
  const alreadyWon = () => loot.cleared.has('tennis-won') || loot.rewardCollected;
  const hits: number[] = LANES.map(lane => alreadyWon() || loot.cleared.has(`cage-${lane.kind}`) ? TARGET_HITS : 0);
  const loseTime = [0, 0, 0];
  let won = alreadyWon();
  let active = !preview && !deferActivation, disposed = false, paused = false, greeted = false;
  let launchDelay = 1.5, captionTime = 0, time = 0, lastLane = -1, doorWarned = false;
  const shots: Shot[] = [], effects: Fx[] = [];

  const ballGeometry = new THREE.SphereGeometry(0.14, 16, 12);
  const ballMaterial = own(new THREE.MeshStandardMaterial({ color: 0xc8ef35, emissive: 0x516b08, roughness: 0.85 }));
  const seamGeometry = new THREE.TorusGeometry(0.141, 0.008, 5, 32);
  const seamMaterial = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const boltGeometry = new THREE.CapsuleGeometry(0.07, 0.6, 4, 10); boltGeometry.rotateX(Math.PI / 2);
  const boltMaterial = own(new THREE.MeshBasicMaterial({ color: 0xff3344, toneMapped: false }));
  const bombGeometry = new THREE.SphereGeometry(0.24, 18, 14);
  const bombMaterial = own(new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.5, roughness: 0.5 }));
  const sparkGeometry = new THREE.SphereGeometry(0.07, 8, 6);
  const sparkMaterial = own(new THREE.MeshBasicMaterial({ color: 0xffb13b, toneMapped: false }));
  const fuseGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6);
  const blastGeometry = new THREE.SphereGeometry(1, 20, 14);
  const rippleGeometry = new THREE.RingGeometry(0.12, 0.2, 40);

  const caption = document.createElement('div'); caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  if (!preview) document.body.append(caption);
  function tell(text: string, seconds = 3) { caption.textContent = inputHint(text); captionTime = seconds; caption.classList.remove('hidden'); }

  function drawLaneScreen(index: number) {
    const lane = LANES[index], { context: c, texture } = lanes[index].display, done = hits[index] >= TARGET_HITS;
    c.fillStyle = '#061524'; c.fillRect(0, 0, 512, 280);
    c.strokeStyle = done ? '#a5ff73' : lane.accent; c.lineWidth = 8; c.strokeRect(8, 8, 496, 264);
    c.textAlign = 'center'; c.fillStyle = done ? '#a5ff73' : lane.accent;     c.font = 'bold 28px sans-serif';
        c.fillText(done ? 'LANE CLEAR' : 'HIT THE FIELD', 256, 112);
    texture.needsUpdate = true;
  }
  function drawBoard() {
    const c = board.context, segment = 2048 / 3;
    c.fillStyle = '#050505'; c.fillRect(0, 0, 2048, 160);
    LANES.forEach((_, index) => {
      const x = segment * index + segment / 2, losing = loseTime[index] > 0, done = hits[index] >= TARGET_HITS;
      c.textAlign = 'center';
      c.fillStyle = losing ? '#ff2a3a' : done ? '#7dff6a' : '#ffcf3a';       c.font = 'bold 74px monospace';
            c.fillText(losing ? 'YOU LOSE' : done ? 'CLEAR' : `${String(hits[index]).padStart(2, '0')}/${TARGET_HITS}`, x, 132);
      if (index) { c.fillStyle = '#1d1d1d'; c.fillRect(segment * index - 3, 10, 6, 140); }
    });
    // LED dot-matrix mask.
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < 2048; x += 6) c.fillRect(x, 0, 2, 160);
    for (let y = 0; y < 160; y += 6) c.fillRect(0, y, 2048, 2);
    board.texture.needsUpdate = true;
  }
  LANES.forEach((_, index) => drawLaneScreen(index)); drawBoard();

  const chest = createRewardChest({ scene, world: physics.world, player,
    position: new THREE.Vector3(HALF_W - 1.1, 0, 8.5), yaw: Math.PI / 2, reward: 'keycard', style: 'crew',
    initialCollected: loot.rewardCollected, unlocked: () => won,
    lockedPrompt: 'Clear all three lanes to unlock this keycard',
    canInteract: () => active && !paused,
    onCollect: () => { onKeycardCollected?.(); loot.rewardCollected = true; return true; } }, modelLoader);

  // Supply table opposite the chest: two health, two shield.
  box([1.1, 0.08, 3.4], [-HALF_W + 0.75, 0.9, 8.8], materials.trim);
  for (const z of [7.3, 10.3]) for (const x of [-HALF_W + 0.35, -HALF_W + 1.15])
    box([0.08, 0.86, 0.08], [x, 0.43, z], materials.steel, false);
  const supplies = (['health', 'health', 'shield', 'shield'] as const).map((kind, index) => {
    const id = `cage-${kind}-${index}`;
    const pickup = createRecoveryPickup(kind, new THREE.Vector3(-HALF_W + 0.75, 1.18, 7.55 + index * 0.8), { compact: true, illuminate: index % 2 === 0 });
    pickup.root.userData.minimap = false; pickup.root.visible = !loot.cleared.has(id); scene.add(pickup.root);
    return { id, kind, pickup };
  });

  const visitUI = !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: 'Saber Batting Cage', player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);
  if (active) player.enable();

  const interactPrompt = document.getElementById('interact-prompt');
  let ownsPrompt = false;
  const nearSaber = () => wallSaber.visible && Math.hypot(player.body.position.x - saberPosition.x, player.body.position.z - saberPosition.z) < 1.8;
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || !active || paused || !player.isEnabled() || !nearSaber()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    wallSaber.visible = false; progress.lightsaberBeamCollected = true; onLightsaberCollected?.(); playSfx('slash', 0.6);
    tell('Lightsaber taken. Equip it and stand on a lane plate.', 4);
  }
  window.addEventListener('keydown', onKeyDown);

  function addFx(mesh: THREE.Mesh, life: number, options: Partial<Pick<Fx, 'velocity' | 'grow' | 'ownsMaterial'>> = {}) {
    scene.add(mesh); effects.push({ mesh, age: 0, life, ownsMaterial: options.ownsMaterial ?? true, velocity: options.velocity, grow: options.grow });
  }
  function removeShot(shot: Shot) {
    shot.bolt.mesh.removeFromParent();
    const index = shots.indexOf(shot); if (index >= 0) shots.splice(index, 1);
  }
  function clearShots() { for (const shot of [...shots]) removeShot(shot); }
  function ripple(point: THREE.Vector3, color: number) {
    const mesh = new THREE.Mesh(rippleGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(point.x, point.y, FIELD_Z + 0.01); addFx(mesh, 0.55, { grow: 9 });
  }
  function explode(position: THREE.Vector3, harmful: boolean) {
    const uniforms = {
      uTime: { value: Math.random() * 10 }, uProgress: { value: 0 }, uIntensity: { value: 1.2 }, uCameraLocal: { value: new THREE.Vector3() },
      uColorCore: { value: new THREE.Color(0xfff2b0) }, uColorMid: { value: new THREE.Color(0xff8a1f) },
      uColorEdge: { value: new THREE.Color(0xc41608) }, uColorSmoke: { value: new THREE.Color(0x1a1613) },
    };
    const mesh = new THREE.Mesh(blastGeometry, new THREE.ShaderMaterial({
      uniforms, vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: false }));
    mesh.frustumCulled = false; mesh.position.copy(position); mesh.scale.setScalar(0.4);
    mesh.onBeforeRender = (_renderer, _scene, viewCamera) => {
      viewCamera.getWorldPosition(uniforms.uCameraLocal.value); mesh.worldToLocal(uniforms.uCameraLocal.value);
    };
    const light = new THREE.PointLight(0xff6a14, 25, 10); light.position.copy(position); scene.add(light);
    scene.add(mesh); effects.push({ mesh, age: 0, life: 0.9, ownsMaterial: true, fire: uniforms, light });
    playSfx('explosion', harmful ? 0.9 : 0.6);
    if (!harmful) return false;
    const p = player.body.position;
    if (Math.hypot(p.x - position.x, p.y + 0.6 - position.y, p.z - position.z) > BOMB_RADIUS) return false;
    player.takeDamage(BOMB_DAMAGE); return true;
  }
  function lose(lane: number, reason: string) {
    hits[lane] = 0; loseTime[lane] = 1.8; launchDelay = 1.8;
    tell(`You lose! ${reason} ${LANES[lane].name} resets to 0.`); drawBoard();
  }
  function scoreHit(lane: number) {
    hits[lane] = Math.min(TARGET_HITS, hits[lane] + 1);
    if (hits[lane] >= TARGET_HITS) {
      loot.cleared.add(`cage-${LANES[lane].kind}`); drawLaneScreen(lane); tell(`${LANES[lane].name} clear!`);
    }
    if (hits.every(count => count >= TARGET_HITS)) {
      won = true; loot.cleared.add('tennis-won'); clearShots(); tell('All lanes clear! The keycard chest is unlocked.', 5);
    }
    drawBoard();
  }
  const aim = new THREE.Vector3(), previous = new THREE.Vector3(), delta = new THREE.Vector3(), closest = new THREE.Vector3();
  function aimPoint() { return aim.set(player.body.position.x, player.body.position.y + 0.75, player.body.position.z); }
  function launch(lane: number) {
    const config = LANES[lane], start = lanes[lane].launcher.position.clone(); start.z += 0.6;
    let mesh: THREE.Mesh, spark: THREE.Mesh | undefined;
    if (config.kind === 'tennis') {
      mesh = new THREE.Mesh(ballGeometry, ballMaterial);
      const seam = new THREE.Mesh(seamGeometry, seamMaterial); seam.rotation.y = Math.PI / 3; mesh.add(seam);
      playSfx('clank', 0.35, 1.6);
    } else if (config.kind === 'bullets') {
      mesh = new THREE.Mesh(boltGeometry, boltMaterial); playSfx('gunshot', 0.5);
    } else {
      mesh = new THREE.Mesh(bombGeometry, bombMaterial);
      const fuse = new THREE.Mesh(fuseGeometry, sparkMaterial); fuse.position.y = 0.3; mesh.add(fuse);
      spark = new THREE.Mesh(sparkGeometry, sparkMaterial); spark.position.y = 0.4; mesh.add(spark);
      playSfx('redBomb', 0.5);
    }
    mesh.position.copy(start); scene.add(mesh);
    const velocity = aimPoint().clone().sub(start).normalize().multiplyScalar(config.speed * (1 + hits[lane] * SPEED_RAMP));
    if (config.kind === 'bullets') mesh.lookAt(start.clone().add(velocity));
    shots.push({ bolt: { mesh, velocity, parried: false, owner: 'boss' }, lane, age: 0, spark });
  }
  function updateShot(shot: Shot, frame: number) {
    const { bolt, lane } = shot, kind = LANES[lane].kind, mesh = bolt.mesh;
    shot.age += frame; previous.copy(mesh.position);
    mesh.position.addScaledVector(bolt.velocity, frame);
    if (kind === 'bullets') mesh.lookAt(closest.copy(mesh.position).add(bolt.velocity));
    else { mesh.rotation.x += frame * 9; mesh.rotation.y += frame * 5; }
    if (shot.spark) shot.spark.scale.setScalar(0.7 + Math.random() * 0.8);
    if (bolt.parried && bolt.velocity.z < 0 && mesh.position.z <= FIELD_Z) {
      const fraction = (FIELD_Z - previous.z) / (mesh.position.z - previous.z);
      closest.lerpVectors(previous, mesh.position, THREE.MathUtils.clamp(fraction, 0, 1));
      const onField = Math.abs(closest.x - LANES[lane].x) <= SCREEN_W / 2 && Math.abs(closest.y - SCREEN_Y) <= SCREEN_H / 2;
      removeShot(shot);
      if (!onField) {
        if (kind === 'bombs') explode(closest.clone(), false);
        lose(lane, 'Missed the force field.'); return;
      }
      lanes[lane].flash = 1; ripple(closest, LANES[lane].color); playSfx('clank', 0.55, kind === 'bullets' ? 1.4 : 1);
      if (kind === 'bombs') explode(closest.clone(), false);
      else if (kind === 'tennis') {
        // The ball rebounds off the field and drops to the court.
        mesh.position.copy(closest); mesh.position.z += 0.05;
        addFx(mesh, 1.4, { velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5, 3.5), ownsMaterial: false });
      }
      scoreHit(lane); return;
    }
    if (!bolt.parried) {
      aimPoint(); delta.copy(mesh.position).sub(previous);
      const t = delta.lengthSq() > 0 ? THREE.MathUtils.clamp(aim.clone().sub(previous).dot(delta) / delta.lengthSq(), 0, 1) : 0;
      closest.copy(previous).addScaledVector(delta, t);
      const reached = closest.distanceTo(aim) < (kind === 'bombs' ? 0.9 : 0.55);
      if (kind === 'bombs' && (reached || shot.age > BOMB_FUSE || mesh.position.z > player.body.position.z + 0.8)) {
        const hurt = explode(mesh.position.clone(), true); removeShot(shot);
        lose(lane, hurt ? `Caught in the blast (-${BOMB_DAMAGE} HP).` : 'The bomb went off.'); return;
      }
      if (reached) {
        removeShot(shot);
        if (kind === 'bullets') { player.takeDamage(BULLET_DAMAGE); lose(lane, `Hit by a bolt (-${BULLET_DAMAGE} HP).`); }
        else lose(lane, 'The ball got past you.');
        return;
      }
    }
    const p = mesh.position;
    if (shot.age > 6 || Math.abs(p.x) > HALF_W - 0.1 || p.z > HALF_D - 0.1 || p.z < -HALF_D || p.y < 0.05 || p.y > HEIGHT - 0.1) {
      removeShot(shot);
      if (kind === 'bombs') { explode(p.clone(), !bolt.parried); lose(lane, 'The bomb went off.'); }
      else if (kind === 'tennis' || bolt.parried) lose(lane, 'Missed the return.');
    }
  }
  function activeLane() {
    const p = player.body.position;
    if (p.z < -HALF_D + 2 || p.z > PLATE_Z + 2.5) return -1;
    return p.x < -3 ? 0 : p.x > 3 ? 2 : 1;
  }

  return {
    roomId: 'saber-tennis', scene, camera, player, physicsWorld: physics.world, ready: chest.ready, cutsceneManager: null,
    getSceneId: () => 'scene1.3', getMapLayout: () => cameraVisitMap(37), getMapSceneId: () => 'scene37',
    getMusicTrack: () => 'puzzle' as const,
    activate() { active = true; visitUI?.setVisible(true); player.clearInput(); player.enable(); },
    controlsReady: () => active && !paused, isCinematic: () => false, ownsWeaponInput: false,
    setMenuPaused(value: boolean) { paused = value; player.clearInput(); },
    getParryableBolts: () => active && !paused && !won ? shots.map(shot => shot.bolt) : [],
    getTennisState: () => ({ hits: [...hits], won }),
    chest,
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || !active || paused || document.hidden) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0;
      time += frame;
      if (!greeted) { greeted = true; tell('Prime: The students would always play in here.', 5); }
      physics.step(frame, player, thirdPerson); chest.update(frame); visitUI?.update();
      captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
      if (loseTime.some(t => t > 0)) {
        for (let i = 0; i < 3; i++) loseTime[i] = Math.max(0, loseTime[i] - frame);
        if (loseTime.every(t => t === 0)) drawBoard();
      }
      for (const lane of lanes) {
        lane.flash = Math.max(0, lane.flash - frame * 2.5);
        lane.fieldMaterial.opacity = 0.08 + Math.sin(time * 3) * 0.02 + lane.flash * 0.55;
      }
      for (const fx of [...effects]) {
        fx.age += frame;
        if (fx.velocity) { fx.velocity.y -= 9.8 * frame; fx.mesh.position.addScaledVector(fx.velocity, frame);
          if (fx.mesh.position.y < 0.14) { fx.mesh.position.y = 0.14; fx.velocity.y = Math.abs(fx.velocity.y) * 0.5; } }
        if (fx.grow) {
          fx.mesh.scale.setScalar(0.3 + fx.age * fx.grow);
          (fx.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - fx.age / fx.life));
        }
        if (fx.fire) {
          const t = fx.age / fx.life;
          fx.fire.uTime.value += frame; fx.fire.uProgress.value = Math.min(1, t);
          fx.mesh.scale.setScalar(0.4 + (1 - Math.pow(1 - Math.min(1, t * 1.6), 3)) * 1.9);
          if (fx.light) fx.light.intensity = 25 * Math.max(0, 1 - t * 1.4);
        }
        if (fx.age >= fx.life) {
          fx.light?.removeFromParent(); fx.light?.dispose();
          fx.mesh.removeFromParent(); if (fx.ownsMaterial) (fx.mesh.material as THREE.Material).dispose();
          effects.splice(effects.indexOf(fx), 1);
        }
      }
      const p = player.body.position;
      if (nearSaber() && player.isEnabled() && interactPrompt) {
        interactPrompt.textContent = inputHint('Press E to take the lightsaber'); interactPrompt.classList.remove('hidden'); ownsPrompt = true;
      } else if (ownsPrompt) { interactPrompt?.classList.add('hidden'); ownsPrompt = false; }
      const nearDoor = Math.abs(p.x) < 1.6 && p.z > HALF_D - 2;
      if (nearDoor && !doorWarned) tell('The door is locked.');
      doorWarned = nearDoor;
      for (const supply of supplies) {
        if (!supply.pickup.root.visible) continue;
        supply.pickup.update(time);
        const at = supply.pickup.root.position;
        if (Math.hypot(p.x - at.x, p.z - at.z) >= 1.3) continue;
        if (supply.kind === 'health' ? player.heal(50) : player.addShield(25)) {
          supply.pickup.root.visible = false; loot.cleared.add(supply.id);
          tell(supply.kind === 'health' ? 'Health +50.' : 'Shield +25.', 2);
        }
      }
      if (won) return;
      const lane = activeLane();
      if (lane !== lastLane) {
        lastLane = lane; launchDelay = Math.max(launchDelay, 1);
        if (lane >= 0 && !progress.lightsaberBeamCollected) tell('Take the lightsaber from the wall rack first.');
      }
      for (const shot of [...shots]) updateShot(shot, frame);
      if (lane < 0 || hits[lane] >= TARGET_HITS || shots.length || !progress.lightsaberBeamCollected
        || !player.isEnabled() || player.getHealth() <= 0) return;
      launchDelay -= frame;
      if (launchDelay <= 0) { launch(lane); launchDelay = 0.9; }
    },
    syncProgress() {
      wallSaber.visible = !progress.lightsaberBeamCollected;
      if (alreadyWon()) { won = true; hits.fill(TARGET_HITS); clearShots(); LANES.forEach((_, i) => drawLaneScreen(i)); drawBoard(); }
      if (loot.rewardCollected) chest.setCollected();
    },
    minimap: { bounds: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D }, floor: 0 },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      if (ownsPrompt) interactPrompt?.classList.add('hidden');
      clearShots();
      for (const fx of effects) { fx.mesh.removeFromParent(); fx.light?.removeFromParent(); fx.light?.dispose(); if (fx.ownsMaterial) (fx.mesh.material as THREE.Material).dispose(); }
      for (const geometry of [ballGeometry, seamGeometry, boltGeometry, bombGeometry, sparkGeometry, fuseGeometry, blastGeometry, rippleGeometry]) geometry.dispose();
      disposeLightsaber(wallSaber); disposeTennisRacket(racket);
      for (const material of ownedMaterials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      visitUI?.dispose(); chest.dispose(); caption.remove(); player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
