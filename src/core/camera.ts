import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Player } from '../scripts/player.js';

/** Traversal framing, shared by the game loop and regression tests. */
export function applyTraversalCamera(camera: THREE.PerspectiveCamera, player: Player, thirdPerson: boolean): boolean {
  const state = player.getState();
  if (!state.climbing && !state.ventMode) return false;
  const p = player.body.position;
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const feet = p.y - player.radius;
  const target = new THREE.Vector3(p.x, feet + (state.ventMode ? 0.65 : 1.05), p.z);
  if (state.climbing || thirdPerson) {
    camera.position.copy(target).addScaledVector(forward, state.ventMode ? -1.15 : -2.3)
      .addScaledVector(right, state.ventMode ? 0.34 : 0.75);
    camera.position.y += state.ventMode ? 0.32 : 0.65;
    // Pull the camera in before it crosses a solid wall or ceiling.
    const world = player.body.world;
    const from = new CANNON.Vec3(target.x, target.y, target.z);
    const to = new CANNON.Vec3(camera.position.x, camera.position.y, camera.position.z);
    let distance = from.distanceTo(to);
    world?.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: true }, hit => {
      if (hit.body !== player.body) distance = Math.min(distance, Math.max(0.15, hit.distance - 0.15));
    });
    camera.position.sub(target).setLength(distance).add(target);
  }
  if (state.ventMode) {
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -0.8, 0.8);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.35, 1.12);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -7.75, 7.75);
    if (!state.climbing && !thirdPerson) return true;
  }
  camera.lookAt(target);
  return true;
}

/**
 * Creates the perspective camera.
 */
export function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );

  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  return camera;
}
