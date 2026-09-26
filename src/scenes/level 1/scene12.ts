import * as THREE from 'three';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { createSlidingPortal, roomBox, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createCargoPuzzleState, advanceCargo, plateCargo, type CargoPuzzleState } from '../../scripts/cargoPuzzle.js';
import { createCargoController } from '../../scripts/cargoController.js';
import { createSpikePlate } from '../../helpers/scene/cargoVisuals.js';
import { createRewardChest } from '../../scripts/rewardChest.js';

export type PassageDestination = 9 | 10 | 11 | 13;
// Exiting 10 faces +X: 9 is left (-Z), 11 opposite (+X), 13 right (+Z).
export const PASSAGE_PORTALS = {
  9: { x: 0, y: 0, z: -10, yaw: 0 },
  10: { x: -4, y: 0, z: 0, yaw: Math.PI / 2 },
  11: { x: 4, y: 0, z: 0, yaw: -Math.PI / 2 },
  13: { x: 0, y: 0, z: 10, yaw: Math.PI },
} as const;
export function createScene({ entryState, from = 10, puzzle = createCargoPuzzleState(), onLightsaberCollected }: { entryState?: PlayerTransitionState; from?: PassageDestination; puzzle?: CargoPuzzleState; onLightsaberCollected?: () => void } = {}) {
  if (from === 10 || from === 11) puzzle.shortcutUnlocked = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x121c25);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const tile = new THREE.MeshStandardMaterial({ color: 0x74837e, roughness: 0.8, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263944, roughness: 0.6, metalness: 0.4 });
  roomBox(scene, physics, [8, 0.4, 20], [0, -0.2, 0], dark);
  roomBox(scene, physics, [8, 0.2, 20], [0, 4.5, 0], dark);
  // Tile seams and recessed strip lights echo the original four-door passage.
  for (let z = -9; z <= 9; z += 1) roomBox(scene, physics, [7.8, 0.008, 0.018], [0, 0.006, z], tile, false);
  for (const x of [-2, 0, 2]) roomBox(scene, physics, [0.018, 0.008, 19.8], [x, 0.006, 0], tile, false);
  let cargo: ReturnType<typeof createCargoController>;
  const doors = new Map<PassageDestination, ReturnType<typeof createSlidingPortal>>();
  for (const id of [9, 10, 11, 13] as const) {
    doors.set(id, createSlidingPortal(scene, physics, PASSAGE_PORTALS[id], id === 10 || id === 11 ? 20 : 8, 4.5,
      `${id} / ${id === 9 ? 'LOADING BAY' : id === 13 ? 'LOCKED / BAY WARDEN' : 'CARGO TRANSFER'}`,
      { closeSpeed: 1 / 0.3, cargo: () => [...(cargo?.objects.values() ?? [])].map(o => o.body) }));
  }
  scene.add(new THREE.HemisphereLight(0xd0e8ef, 0x303c40, 2.3));
  const glow = new THREE.MeshStandardMaterial({ color: 0xc4f5eb, emissive: 0x75cfc2, emissiveIntensity: 2 });
  for (const z of [-7, -3, 3, 7]) {
    roomBox(scene, physics, [3, 0.06, 0.24], [0, 4.3, z], glow, false);
    const light = new THREE.PointLight(0xd3f4ef, 24, 11); light.position.set(0, 3.8, z); scene.add(light);
  }
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 150);
  const frame = PASSAGE_PORTALS[from];
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: frame.x + Math.sin(frame.yaw) * 1.2, y: PHYSICS.playerRadius, z: frame.z + Math.cos(frame.yaw) * 1.2 } });
  player.enable(); player.setRotation(frame.yaw + Math.PI);
  if (entryState) player.restoreTransition(entryState, frame);
  cargo = createCargoController(scene, physicsWorld, player, puzzle, 12); cargo.accept(entryState, frame);
  const allowed = (id: PassageDestination) => id === 9 ? puzzle.shortcutUnlocked : id === 13 ? puzzle.exitUnlocked : !!plateCargo(puzzle, id);
  if (allowed(from)) doors.get(from)!.openImmediately();
  const trap = createSpikePlate(scene); trap.update(puzzle.revealed ? 1 : 0, 0, puzzle.exitUnlocked);
  const wireMaterial = new THREE.MeshStandardMaterial({ color: 0xf0b24b, emissive: 0x72420a });
  roomBox(scene, physics, [0.05, 0.012, 8.8], [0, 0.016, 5.5], wireMaterial, false);
  // Lightsaber chest (east side, visible on entry)
  const lightsaberChest = createRewardChest({
    scene, world: physicsWorld, player,
    position: new THREE.Vector3(2.5, 0, 0),
    reward: 'lightsaber',
    unlocked: () => puzzle.exitUnlocked,
    onCollect: () => { onLightsaberCollected?.(); return true; },
    removeOnCollect: true,
  });
  let disposed = false, strikeTime = 0, cooldown = 0;
  let trapState: 'hidden' | 'ready' | 'striking' | 'cooldown' | 'solved' = puzzle.exitUnlocked ? 'solved' : puzzle.revealed ? 'ready' : 'hidden';
  const prompt = document.getElementById('interact-prompt'), status = document.getElementById('loading-bay-status');
  function onKey(event: KeyboardEvent) { if (event.code === 'KeyE' && !event.repeat && player.isEnabled()) cargo.interact(); }
  window.addEventListener('keydown', onKey);
  return { roomId: 'transfer-passage', scene, camera, physicsWorld, player, doors, cargo, puzzle, trap, lightsaberChest, cutsceneManager: null,
    getTrapState: () => trapState, getDamageTargets: cargo.getDamageTargets, setGogglesActive: cargo.setHighlighted, clearInput: cargo.release,
    setDoorTrigger(id: PassageDestination, callback: (state: PlayerTransitionState) => void) {
      doors.get(id)!.setTrigger(state => { if (id === 10 || id === 11) callback(cargo.transfer(state, PASSAGE_PORTALS[id], id)); else { cargo.release(); callback(state); } });
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
      advanceCargo(puzzle, dt); cargo.update(dt); physics.step(dt, player, thirdPerson); cargo.update(0);
      lightsaberChest.update(dt);
      cooldown = Math.max(0, cooldown - dt); strikeTime = Math.max(0, strikeTime - dt);
      if (puzzle.revealed && !puzzle.exitUnlocked) {
        const crate = plateCargo(puzzle, 12), p = player.body.position;
        const playerOn = player.isEnabled() && player.getState().isOnGround && p.y < 0.5 && Math.abs(p.x) < 0.95 && Math.abs(p.z) < 0.95;
        if (cooldown === 0 && (crate || playerOn)) {
          strikeTime = 0.45; cooldown = 1;
          if (crate) { if (crate.breakable) cargo.destroy(crate.id); else puzzle.exitUnlocked = true; }
          if (playerOn) player.takeDamage(20);
        }
      }
      trapState = puzzle.exitUnlocked ? 'solved' : !puzzle.revealed ? 'hidden' : strikeTime > 0 ? 'striking' : cooldown > 0 ? 'cooldown' : 'ready';
      trap.update(puzzle.revealed ? 1 : 0, strikeTime > 0 ? Math.sin(Math.PI * (1 - strikeTime / 0.45)) : 0, puzzle.exitUnlocked);
      wireMaterial.color.setHex(puzzle.exitUnlocked ? 0x67ffb0 : 0xf0b24b); wireMaterial.emissive.copy(wireMaterial.color);
      if (prompt) { prompt.textContent = cargo.prompt(); prompt.classList.toggle('hidden', !prompt.textContent); }
      if (status) { status.classList.remove('hidden'); status.textContent = puzzle.exitUnlocked ? '12 / BAY WARDEN DOOR UNLOCKED' : puzzle.revealed ? '12 / AUXILIARY LOCK\nThe spike destroys wooden cargo. Bring a reinforced crate.\nLeave the side-room doors supported with spare crates.' : '12 / TRANSFER HUB\nThe loading-bay shortcut is now open.\nActivate the floor plate in room 11 to reveal the auxiliary lock.'; }
      for (const [id, door] of doors) { door.update(dt, player, allowed(id)); if (disposed) break; }
    },
    dispose() { if (disposed) return; disposed = true; window.removeEventListener('keydown', onKey); prompt?.classList.add('hidden'); status?.classList.add('hidden'); lightsaberChest.dispose(); cargo.dispose(); player.dispose(); physics.dispose(); disposeRoom(scene); },
  };
}
