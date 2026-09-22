import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createDropRoom } from '../helpers/scene/shipRoom.js';
import { PHYSICS } from '../helpers/physics/scenePhysics.js';
import type { PlayerTransitionState } from '../scripts/player.js';

export interface PuzzleState { box: { x: number; y: number; z: number }; }
export function createScene({ entryState, fromPassage = false, puzzleState, onPuzzleChanged }: {
  entryState?: PlayerTransitionState; fromPassage?: boolean; puzzleState?: PuzzleState;
  onPuzzleChanged?: (state: PuzzleState) => void;
} = {}) {
  const room = createDropRoom(10, { entryState, fromPassage });
  const { player, physics, physicsWorld, scene } = room;
  const crateMaterial = new THREE.MeshStandardMaterial({ color: 0xc28c45, roughness: 0.6, metalness: 0.25 });
  const crate = room.box([1.4, 1.4, 1.4], [0, 0.7, 1.5], crateMaterial, false); crate.name = 'PuzzleBox';
  const band = new THREE.MeshStandardMaterial({ color: 0x233945, metalness: 0.7, roughness: 0.4 });
  for (const x of [-0.46, 0.46]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.43, 1.43), band); mesh.position.x = x; crate.add(mesh);
  }
  const material = new CANNON.Material({ friction: 0.15, restitution: 0 });
  const boxBody = new CANNON.Body({ mass: 45, material, shape: new CANNON.Box(new CANNON.Vec3(0.7, 0.7, 0.7)), fixedRotation: true, allowSleep: false, linearDamping: 0.95 });
  const saved = puzzleState?.box;
  boxBody.position.set(saved?.x ?? 0, saved?.y ?? 0.7, saved?.z ?? 1.5); boxBody.updateMassProperties(); physicsWorld.addBody(boxBody);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xf0b74f, emissive: 0xa05810, emissiveIntensity: 0.6 });
  // Flush sensor: no raised collision edge that can catch the moving crate.
  const plate = room.box([2.1, 0.035, 2.1], [0, 0.025, -2], plateMaterial, false); plate.name = 'PressurePlate';
  const wire = room.box([0.06, 0.014, 2.9], [0, 0.012, -4.5], plateMaterial, false); wire.name = 'SwitchDoorConnection';
  let pressed = false, disposed = false;
  let grip: CANNON.PointToPointConstraint | null = null;
  const prompt = document.getElementById('interact-prompt');
  function release() {
    if (grip) physicsWorld.removeConstraint(grip);
    grip = null; player.setBoxHandling(false);
  }
  function canGrab() {
    const p = player.body.position, b = boxBody.position;
    const dx = p.x - b.x, dz = p.z - b.z;
    return player.isEnabled() && player.getState().isOnGround && b.y < 0.85 &&
      Math.max(Math.abs(dx), Math.abs(dz)) < 1.55 && Math.min(Math.abs(dx), Math.abs(dz)) < 0.38;
  }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || !player.isEnabled()) return;
    if (grip) { release(); return; }
    if (!canGrab()) return;
    const p = player.body.position, b = boxBody.position;
    const dx = b.x - p.x, dz = b.z - p.z;
    const direction = Math.abs(dx) > Math.abs(dz) ? new CANNON.Vec3(Math.sign(dx), 0, 0) : new CANNON.Vec3(0, 0, Math.sign(dz));
    player.setRotation(Math.atan2(-direction.x, -direction.z), 0);
    // A finite-force joint keeps both bodies dynamic; walls stop pushing AND pulling.
    const anchor = direction.scale(-0.7); anchor.y = p.y - b.y;
    const playerAnchor = b.vadd(anchor).vsub(p);
    grip = new CANNON.PointToPointConstraint(player.body, playerAnchor, boxBody, anchor, 1500);
    physicsWorld.addConstraint(grip); boxBody.wakeUp(); player.setBoxHandling(true);
  }
  window.addEventListener('keydown', onKey); window.addEventListener('blur', release);
  const snapshot = (): PuzzleState => ({ box: { x: boxBody.position.x, y: boxBody.position.y, z: boxBody.position.z } });
  return { ...room, boxBody, crate, plate, getPuzzleState: snapshot, isPlatePressed: () => pressed,
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
      if (grip && (!player.isEnabled() || !player.getState().isOnGround || boxBody.position.distanceTo(player.body.position) > 2.2)) release();
      physics.step(dt, player, thirdPerson);
      crate.position.copy(boxBody.position); crate.quaternion.copy(boxBody.position.y < -5 ? new THREE.Quaternion() : boxBody.quaternion);
      if (boxBody.position.y < -5) { release(); boxBody.position.set(0, 0.7, 1.5); boxBody.velocity.set(0, 0, 0); boxBody.aabbNeedsUpdate = true; }
      const onPlate = Math.abs(boxBody.position.x) < 0.48 && Math.abs(boxBody.position.z + 2) < 0.48 && Math.abs(boxBody.position.y - 0.7) < 0.12;
      if (pressed !== onPlate) { pressed = onPlate; onPuzzleChanged?.(snapshot()); }
      plateMaterial.color.setHex(pressed ? 0x62ffad : 0xf0b74f); plateMaterial.emissive.copy(plateMaterial.color);
      plate.position.y = pressed ? 0.005 : 0.025;
      if (prompt) { prompt.textContent = grip ? 'E: release | W: push | S: pull' : 'Press E to grab the box'; prompt.classList.toggle('hidden', !grip && !canGrab()); }
      room.updateDoor(dt, pressed);
    },
    dispose() {
      if (disposed) return; disposed = true; onPuzzleChanged?.(snapshot()); release();
      window.removeEventListener('keydown', onKey); window.removeEventListener('blur', release); prompt?.classList.add('hidden'); room.dispose();
    },
  };
}
