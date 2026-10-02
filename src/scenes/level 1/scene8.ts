/** Scene 8 - A cramped maintenance vent between the galley and deck below. */
import * as THREE from 'three';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { LADDER } from '../../utils/constants.js';
import { createCargoPuzzleState, advanceCargo, type CargoPuzzleState } from '../../scripts/cargoPuzzle.js';
import { createVentGate, cargoSign } from '../../helpers/scene/cargoVisuals.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';

export function createScene({ entry = 'galley', entryState, puzzle = createCargoPuzzleState() }: { entry?: 'galley' | 'deck'; entryState?: PlayerTransitionState; puzzle?: CargoPuzzleState } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040608);
  scene.fog = new THREE.Fog(0x101b23, 8, 24);
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  const width = 2.2, height = 1.35, length = 16;
  const metal = new THREE.MeshStandardMaterial({ color: 0x354048, metalness: 0.8, roughness: 0.46 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x182126, metalness: 0.68, roughness: 0.58 });
  const hatchMaterial = new THREE.MeshBasicMaterial({ color: 0x020304 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x71858d, metalness: 0.75, roughness: 0.38 });
  const warning = new THREE.MeshStandardMaterial({ color: 0xd69b40, metalness: 0.3, roughness: 0.6 });
  const strip = new THREE.MeshStandardMaterial({ color: 0x7bdde8, emissive: 0x3999aa, emissiveIntensity: 1.4 });
  function box(size: [number, number, number], position: [number, number, number], material: THREE.Material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    if (solid) physics.addBox({ x: size[0], y: size[1], z: size[2] }, { x: position[0], y: position[1], z: position[2] });
    return mesh;
  }
  box([width, 0.12, length], [0, -0.06, 0], metal);
  box([width, 0.1, length], [0, height, 0], darkMetal);
  // Open cross-junction: arriving from the galley (+Z), left is +X (10).
  for (const side of [-1, 1]) {
    for (const z of [-4.55, 4.55]) box([0.12, height, 6.9], [side * width / 2, height / 2, z], darkMetal);
    box([5.7, 0.12, width], [side * 3.95, -0.06, 0], metal);
    box([0.4, 0.12, width], [side * 8.2, -0.06, 0], metal);
    // The final 1.2 meters are an actual open drop shaft, not a painted hatch.
    box([7.3, 0.1, width], [side * 4.75, height, 0], darkMetal);
    for (const z of [-width / 2, width / 2]) box([7.3, height, 0.12], [side * 4.75, height / 2, z], darkMetal);
    box([0.12, height, width], [side * 8.4, height / 2, 0], darkMetal);
    for (let x = 1.6; x < 8.1; x += 1.6) {
      box([0.1, 0.055, 2], [side * x, height - 0.09, 0], trim, false);
      for (const z of [-0.96, 0.96]) box([1.1, 0.03, 0.03], [side * x, 0.24, z], strip, false);
    }
    for (const z of [-0.93, 0.93]) box([1.2, 0.035, 0.08], [side * 7.4, 0.025, z], warning, false);
    const lamp = new THREE.PointLight(0x9de8eb, 4, 9); lamp.position.set(side * 4.5, 1, 0); scene.add(lamp);
  }
  const gates = { 10: createVentGate(scene, physics, 1, puzzle.gates[10]), 11: createVentGate(scene, physics, -1, puzzle.gates[11]) };
  cargoSign(scene, '10 / CARGO - BAY LEVER', [2.05, 0.95, -1.02], 1.7);
  cargoSign(scene, '11 / CARGO - REPAIR LEVER', [-2.05, 0.95, -1.02], 1.7);
  box([width, height, 0.12], [0, height / 2, -length / 2], darkMetal);
  box([width, height, 0.12], [0, height / 2, length / 2], darkMetal);
  for (let z = -7.8; z < 8; z += 1.6) {
    box([width - 0.14, 0.055, 0.1], [0, height - 0.09, z], trim, false).name = 'vent-rib';
    for (const side of [-1, 1]) {
      if (Math.abs(z) < 1.3 || Math.abs(z + 0.76) < 1.8) continue;
      box([0.055, height - 0.12, 0.1], [side * 0.99, height / 2, z], trim, false);
      box([0.018, 0.66, 1.4], [side * 1.025, 0.58, z + 0.76], metal, false);
      box([0.025, 0.025, 1.05], [side * 0.96, 0.23, z + 0.6], strip, false);
      for (const y of [0.32, 0.78]) {
        box([0.03, 0.025, 0.025], [side * 0.985, y, z + 0.2], trim, false);
        box([0.025, 0.018, 0.75], [side * 0.99, y + 0.05, z + 0.76], darkMetal, false);
      }
    }
  }
  // Narrow floor treads and service conduits provide scale and direction cues.
  for (let z = -6.2; z < 6.3; z += 0.24) box([1.72, 0.012, 0.025], [0, 0.01, z], trim, false);
  for (const x of [-0.78, 0.78]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 15.6, 8), warning);
    pipe.rotation.x = Math.PI / 2; pipe.position.set(x, 1.18, 0); scene.add(pipe);
  }
  for (const z of [-7.2, 7.2]) {
    box([1.35, 0.012, 1.35], [0, 0.008, z], hatchMaterial, false).name = 'vent-hatch';
    for (const side of [-1, 1]) {
      box([0.08, 0.035, 1.45], [side * 0.7, 0.025, z], warning, false);
      box([1.45, 0.035, 0.08], [0, 0.025, z + side * 0.7], warning, false);
    }
    const lid = box([0.055, 1.05, 1.3], [-0.85, 0.55, z], metal, false);
    lid.rotation.z = -0.18;
  }
  for (const [z, label] of [[-7.92, '07 / GALLEY'], [7.92, '09 / LOADING BAY']] as const) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0d202a'; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#e8ba68'; ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, 256, 55); ctx.font = '24px monospace'; ctx.fillText('LADDER ACCESS / E', 256, 99);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 0.42), new THREE.MeshBasicMaterial({ map: texture }));
    plate.position.set(0, 0.85, z); plate.rotation.y = z > 0 ? Math.PI : 0; scene.add(plate);
  }
  scene.add(new THREE.HemisphereLight(0xc8d9df, 0x263036, 1.5));
  scene.add(new THREE.AmbientLight(0x7e9198, 0.55));
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xd9f4ff, emissive: 0x9edfff, emissiveIntensity: 2.2 });
  for (const z of [-6, 0, 6]) {
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.18), lampMaterial);
    fixture.position.set(0, height - 0.08, z); scene.add(fixture);
    const lamp = new THREE.PointLight(0xc6ecff, 3.5, 7);
    lamp.position.set(0, height - 0.16, z); scene.add(lamp);
  }

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 100);
  const spawnZ = entry === 'deck' ? 5.5 : -5.5;
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: spawnZ } });
  player.setRotation(entry === 'deck' ? 0 : Math.PI, 0); player.enable(); player.setVentMode(true);
  if (entryState) {
    player.restoreTransition({ ...entryState, position: { x: 0, y: PHYSICS.playerRadius, z: spawnZ }, velocity: { x: 0, y: 0, z: 0 }, yaw: entry === 'deck' ? 0 : Math.PI, pitch: 0 }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  }
  let onDropToTen: ((state: PlayerTransitionState) => void) | null = null;
  let onDropToEleven: ((state: PlayerTransitionState) => void) | null = null;
  let dropStarted = false;
  let onReturnToSeven: ((drop?: boolean) => void) | null = null;
  let onDescendToNine: ((drop?: boolean) => void) | null = null;
  let climbing = false;
  let handoffStarted = false;
  let climbTime = 0;
  const climbStart = new THREE.Vector3();
  let hatchZ = 0;
  const status = document.getElementById('loading-bay-status');
  if (status) {
    status.textContent = 'MAINTENANCE DUCT 08\nW/S: crawl | A/D: turn (90° at junction, 180° elsewhere)\nFrom galley: LEFT → 10 / RIGHT → 11 (one-way drops)\nStraight → 09 loading bay | E: use end ladders';
    status.classList.remove('hidden', 'restored');
  }
  let destination: ((drop?: boolean) => void) | null = null;
  const prompt = document.getElementById?.('interact-prompt');
  let promptVisible = false;
  const hatchInteractZ = 6.1;
  prompt?.classList.add('hidden');
  function applyVentCamera(thirdPerson: boolean) {
    camera.position.y = Math.min(camera.position.y, height - 0.16);
    if (!thirdPerson) return;
    const yaw = player.getState().yaw;
    const from = player.body.position.clone();
    from.set(camera.position.x, camera.position.y, camera.position.z);
    const to = from.clone();
    const followDistance = 0.9;
    to.x += Math.sin(yaw) * followDistance;
    to.z += Math.cos(yaw) * followDistance;
    let clearance = followDistance;
    physicsWorld.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: true }, hit => {
      if (!hit.body || hit.body === player.body || !hit.body.collisionResponse) return;
      clearance = Math.min(clearance, Math.max(0, hit.distance - 0.12));
    });
    camera.position.x = from.x + Math.sin(yaw) * clearance;
    camera.position.z = from.z + Math.cos(yaw) * clearance;
  }
  function beginClimb(next: (drop?: boolean) => void) {
    if (climbing) return;
    climbing = true; handoffStarted = false; climbTime = 0; destination = next;
    climbStart.copy(player.body.position);
    hatchZ = climbStart.z < 0 ? -7.2 : 7.2;
    player.setRotation(hatchZ < 0 ? 0 : Math.PI, 0);
    player.setClimbing(true, -1);
    prompt?.classList.add('hidden'); promptVisible = false;
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code === 'Space' && climbing && !handoffStarted && !event.repeat) {
      event.preventDefault(); handoffStarted = true;
      player.setClimbing(false); player.setLookLocked(false); player.clearInput();
      destination?.(true); return;
    }
    if (event.code !== 'KeyE' || event.repeat || climbing || !player.isEnabled()) return;
    const z = player.body.position.z;
    if (z < -hatchInteractZ && onReturnToSeven) beginClimb(onReturnToSeven);
    else if (z > hatchInteractZ && onDescendToNine) beginClimb(onDescendToNine);
  }
  window.addEventListener('keydown', onKeyDown);
  function updatePhysics(dt: number, thirdPerson = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    advanceCargo(puzzle, dt);
    gates[10].setProgress(puzzle.gates[10] ? 1 : 0); gates[11].setProgress(puzzle.gates[11] ? 1 : 0);
    if (status) status.textContent = `DUCT 08 / W/S: crawl | A/D: turn | E: ladders\nLEFT 10: ${puzzle.gates[10] ? 'OPEN' : 'LOCKED - LOADING BAY LEVER'}\nRIGHT 11: ${puzzle.gates[11] ? 'OPEN' : 'LOCKED - REPAIR BAY LEVER'}\nStraight: 09 / loading bay`;
    player.setVentTurnAngle(Math.abs(player.body.position.x) < 1.2 && Math.abs(player.body.position.z) < 1.2 ? Math.PI / 2 : Math.PI);
    physics.step(dt, player, thirdPerson);
    if (!dropStarted && !climbing && player.body.position.y < -0.45 && Math.abs(player.body.position.x) > 6.8) {
      const next = player.body.position.x > 0 ? onDropToTen : onDropToEleven;
      if (next && puzzle.gates[player.body.position.x > 0 ? 10 : 11]) { dropStarted = true; const state = player.captureTransition({ x: 0, y: 0, z: 0 }); player.clearInput(); next(state); }
      return;
    }
    if (climbing) {
      if (handoffStarted) return;
      climbTime += dt;
      const mount = THREE.MathUtils.smoothstep(climbTime, 0, LADDER.mountDuration);
      const descent = Math.min(0.9, Math.max(0, climbTime - LADDER.mountDuration) * LADDER.climbSpeed);
      player.body.position.set(THREE.MathUtils.lerp(climbStart.x, 0, mount), climbStart.y - descent,
        THREE.MathUtils.lerp(climbStart.z, hatchZ, mount));
      player.body.aabbNeedsUpdate = true;
      player.updateCamera(0, thirdPerson);
      if (descent >= 0.9 && !handoffStarted) { handoffStarted = true; destination?.(); }
      return;
    }
    const z = player.body.position.z;
    const nearGalley = z < -hatchInteractZ, nearDeck = z > hatchInteractZ;
    const visible = nearGalley || nearDeck;
    if (prompt && visible !== promptVisible) {
      promptVisible = visible;
      prompt.textContent = nearGalley ? 'Press E to climb down to the galley' : 'Press E to climb down';
      prompt.classList.toggle('hidden', !visible);
    }
  }
  return {
    roomId: 'maintenance-vent', scene, camera, physicsWorld, player, updatePhysics, applyVentCamera, gates, puzzle, cutsceneManager: null,
    setDropToTen: (callback: (state: PlayerTransitionState) => void) => { onDropToTen = callback; },
    setDropToEleven: (callback: (state: PlayerTransitionState) => void) => { onDropToEleven = callback; },
    setReturnToSeven: (callback: (drop?: boolean) => void) => { onReturnToSeven = callback; },
    setDescendToNine: (callback: (drop?: boolean) => void) => { onDescendToNine = callback; },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown); prompt?.classList.add('hidden'); status?.classList.add('hidden');
      player.dispose(); physics.dispose();
      disposeRoom(scene);
    },
  };
}