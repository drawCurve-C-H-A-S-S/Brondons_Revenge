import * as THREE from 'three';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { createSlidingPortal, roomBox, disposeRoom } from '../helpers/scene/shipRoom.js';

export type PassageDestination = 9 | 10 | 11 | 13;
// Exiting 10 faces +X: 9 is left (-Z), 11 opposite (+X), 13 right (+Z).
export const PASSAGE_PORTALS = {
  9: { x: 0, y: 0, z: -10, yaw: 0 },
  10: { x: -4, y: 0, z: 0, yaw: Math.PI / 2 },
  11: { x: 4, y: 0, z: 0, yaw: -Math.PI / 2 },
  13: { x: 0, y: 0, z: 10, yaw: Math.PI },
} as const;
export function createScene({ entryState, from = 10 }: { entryState?: PlayerTransitionState; from?: PassageDestination } = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x121c25);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const tile = new THREE.MeshStandardMaterial({ color: 0x74837e, roughness: 0.8, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263944, roughness: 0.6, metalness: 0.4 });
  roomBox(scene, physics, [8, 0.4, 20], [0, -0.2, 0], dark);
  roomBox(scene, physics, [8, 0.2, 20], [0, 4.5, 0], dark);
  // Tile seams and recessed strip lights echo the original four-door passage.
  for (let z = -9; z <= 9; z += 1) roomBox(scene, physics, [7.8, 0.008, 0.018], [0, 0.006, z], tile, false);
  for (const x of [-2, 0, 2]) roomBox(scene, physics, [0.018, 0.008, 19.8], [x, 0.006, 0], tile, false);
  const doors = new Map<PassageDestination, ReturnType<typeof createSlidingPortal>>();
  for (const id of [9, 10, 11, 13] as const) {
    doors.set(id, createSlidingPortal(scene, physics, PASSAGE_PORTALS[id], id === 10 || id === 11 ? 20 : 8, 4.5,
      `${id} / ${id === 9 ? 'LOADING BAY' : id === 10 ? 'TRANSFER TEST' : 'COMPARTMENT'}`));
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
  doors.get(from)!.openImmediately();
  let disposed = false;
  return { roomId: 'transfer-passage', scene, camera, physicsWorld, player, doors, cutsceneManager: null,
    setDoorTrigger(id: PassageDestination, callback: (state: PlayerTransitionState) => void) { doors.get(id)!.setTrigger(callback); },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
      physics.step(dt, player, thirdPerson);
      for (const door of doors.values()) { door.update(dt, player, door.near(player)); if (disposed) break; }
    },
    dispose() { if (disposed) return; disposed = true; player.dispose(); physics.dispose(); disposeRoom(scene); },
  };
}
