import * as THREE from 'three';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../physics/scenePhysics.js';
import { roomBox, createSlidingPortal, disposeRoom } from './shipRoom.js';
import { createCargoMouth, createConveyor, cargoSign } from './cargoVisuals.js';
import { createCargoPuzzleState, advanceCargo, plateCargo, PLATES, CARGO, beltMoving, type CargoPuzzleState, type CargoLane } from '../../scripts/cargoPuzzle.js';
import { createCargoController } from '../../scripts/cargoController.js';
import { createPuzzleCinematic } from '../../scripts/puzzleCinematic.js';
export interface CargoRoomOptions { entryState?: PlayerTransitionState; fromPassage?: boolean; puzzle?: CargoPuzzleState; }
export function createCargoRoom(id: CargoLane, { entryState, fromPassage = false, puzzle = createCargoPuzzleState(id) }: CargoRoomOptions = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111d28);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const wall = new THREE.MeshStandardMaterial({ color: 0x596970, metalness: 0.3, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263743, metalness: 0.4, roughness: 0.65 });
  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = wall, solid = true) => roomBox(scene, physics, s, p, m, solid);
  const side = id === 10 ? -1 : 1, beltZ = CARGO.sideBeltZ;
  // Deck is segmented around the conveyor disposal shaft.
  box([12, 0.4, 9.4], [0, -0.2, -1.3], dark);
  box([12, 0.4, 0.2], [0, -0.2, 5.9], dark);
  box([8.5, 0.4, 2.4], [side * 1.75, -0.2, beltZ], dark);
  box([0.2, 0.4, 2.4], [-side * 5.9, -0.2, beltZ], dark);
  box([0.15, 5, 2.4], [-side * 5.7, -2.5, beltZ], dark);
  for (const edge of [-1.22, 1.22]) box([2.8, 0.8, 0.08], [-side * 4.2, 0.4, beltZ + edge], wall);
  box([0.08, 0.8, 2.5], [-side * 5.65, 0.4, beltZ], wall);
  box([0.4, 4.5, 12], [-side * 6, 2.25, 0]);
  // Real center hatch; no ceiling collider spans it.
  for (const sx of [-3.5, 3.5]) box([5, 0.2, 12], [sx, 4.5, 0], dark);
  for (const z of [-3.5, 3.5]) box([2, 0.2, 5], [0, 4.5, z], dark);
  for (const sx of [-1, 1]) box([0.1, 1.2, 2], [sx, 5, 0], dark);
  for (const z of [-1, 1]) box([2, 1.2, 0.1], [0, 5, z], dark);
  // The feed crosses the wall opposite the entry door, with a mirrored side-wall inlet.
  box([12, 4.5, 0.4], [0, 2.25, 6]);
  box([0.4, 4.5, 9.4], [side * 6, 2.25, -1.3]);
  box([0.4, 4.5, 0.2], [side * 6, 2.25, 5.9]);
  box([0.4, 2, 2.4], [side * 6, 3.5, beltZ]);
  const mouth = createCargoMouth(scene, physics, side * 5.9, beltZ, -side * Math.PI / 2);
  cargoSign(scene, `09 / FEED ${id}`, [side * 5.65, 3.2, beltZ], 2.5, -side * Math.PI / 2);
  const belt = createConveyor(scene, physics, 0, 5.9, -3.1, { yaw: side * Math.PI / 2, z: beltZ, spacing: 2.8 });
  scene.add(new THREE.HemisphereLight(0xc4e5f1, 0x30393f, 2.5));
  for (const sx of [-3, 3]) { const light = new THREE.PointLight(0xb8e8ff, 40, 15); light.position.set(sx, 3.8, 0); scene.add(light); }
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 150);
  const spawn = { x: 0, y: 4.8, z: 0 };
  const player = createPlayer({ camera, physicsWorld, spawnPosition: fromPassage ? { x: 0, y: 0.3, z: -4.8 } : spawn }); player.enable();
  let cargo: ReturnType<typeof createCargoController>;
  const door = createSlidingPortal(scene, physics, { x: 0, y: 0, z: -6, yaw: 0 }, 12, 4.5, '12 / TRANSFER HUB', { closeSpeed: 1 / 0.3, cargo: () => [...(cargo?.objects.values() ?? [])].map(o => o.body) });
  if (entryState && fromPassage) player.restoreTransition(entryState, door.frame);
  else if (entryState) player.restoreTransition({ ...entryState, position: spawn, velocity: { x: 0, y: -1, z: 0 }, yaw: 0, pitch: 0, heldKeys: [], blockedKeys: entryState.heldKeys, crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  cargo = createCargoController(scene, physicsWorld, player, puzzle, id); cargo.accept(entryState, door.frame);
  if (fromPassage && plateCargo(puzzle, id)) door.openImmediately();
  const cinematic = createPuzzleCinematic(player, camera);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffba53, emissive: 0x804315, emissiveIntensity: 0.7 });
  const plate = box([2.1, 0.035, 2.1], [PLATES[id].x, 0.025, PLATES[id].z], plateMaterial, false); plate.name = `PressurePlate${id}`;
  box([Math.abs(PLATES[id].x), 0.012, 0.05], [PLATES[id].x / 2, 0.014, -4.5], plateMaterial, false);
  box([0.05, 0.012, 1.5], [0, 0.014, -5.25], plateMaterial, false);
  let disposed = false, pressed = false;
  const prompt = document.getElementById('interact-prompt'), status = document.getElementById('loading-bay-status');
  function onKey(event: KeyboardEvent) { if (event.code === 'KeyE' && !event.repeat && player.isEnabled() && !cinematic.isCinematic()) cargo.interact(); }
  window.addEventListener('keydown', onKey);
  return { roomId: `scene${id}`, scene, camera, physics, physicsWorld, player, door, cargo, plate, puzzle, cutsceneManager: null,
    isCinematic: cinematic.isCinematic, getCinematicState: cinematic.getCinematicState, applyCinematicCamera: cinematic.applyCinematicCamera, getRenderScene: cinematic.getRenderScene, hideCharacter: cinematic.hideCharacter,
    getDamageTargets: cargo.getDamageTargets, setGogglesActive: cargo.setHighlighted,
    isPlatePressed: () => pressed, getPuzzleState: () => puzzle,
    setBackTrigger(callback: (state: PlayerTransitionState) => void) { door.setTrigger(state => callback(cargo.transfer(state, door.frame, 12))); },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return; dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
      if (cinematic.isCinematic()) {
        prompt?.classList.add('hidden'); status?.classList.add('hidden');
        cinematic.update(dt); return;
      }
      advanceCargo(puzzle, dt); cargo.update(dt); belt.update(puzzle); mouth.update(beltMoving(puzzle) ? 1 : 0.1);
      physics.step(dt, player, thirdPerson); cargo.update(0);
      const p = player.body.position, target = PLATES[id];
      pressed = !!plateCargo(puzzle, id) || (player.getState().isOnGround && p.y < 0.5 && Math.abs(p.x - target.x) < 0.98 && Math.abs(p.z - target.z) < 0.98);
      plateMaterial.color.setHex(pressed ? 0x67ffb0 : 0xffba53); plateMaterial.emissive.copy(plateMaterial.color); plate.position.y = pressed ? 0.008 : 0.025;
      if (id === 11 && plateCargo(puzzle, 11) && !puzzle.revealed) { puzzle.revealed = puzzle.revealShown = true; cinematic.begin(12); }
      if (status) { status.classList.toggle('hidden', cinematic.isCinematic()); status.textContent = `${id} / CARGO TRANSFER${puzzle.feedBlocked ? ' - CLEAR BLOCKED BELT' : ''}\nE: grab / release | WASD: move box\nLeave a box on the plate. Take a spare through the open door.`; }
      if (prompt) { prompt.textContent = cargo.prompt(); prompt.classList.toggle('hidden', !prompt.textContent || cinematic.isCinematic()); }
      door.update(dt, player, pressed);
    },
    clearInput: cargo.release,
    dispose() { if (disposed) return; disposed = true; window.removeEventListener('keydown', onKey); prompt?.classList.add('hidden'); status?.classList.add('hidden'); cinematic.dispose(); cargo.dispose(); player.dispose(); physics.dispose(); disposeRoom(scene); },
  };
}
