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
  if (state.ventMode && !state.climbing && !thirdPerson) {
    camera.position.set(p.x, feet + 0.9, p.z);
    camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
    return true;
  }
  if (state.climbing || thirdPerson) {
    camera.position.copy(target).addScaledVector(forward, state.ventMode ? -1.15 : -2.3)
      .addScaledVector(right, state.ventMode ? 0.34 : 0.75);
    camera.position.y += state.ventMode ? 0.32 : 0.65;
    // Pull the camera in before it crosses a solid wall or ceiling.
    const world = player.body.world;
    const from = new CANNON.Vec3(target.x, target.y, target.z);
    const to = new CANNON.Vec3(camera.position.x, camera.position.y, camera.position.z);
    let distance = from.distanceTo(to);
    const direction = to.vsub(from); direction.normalize();
    to.vadd(direction.scale(0.4), to);
    world?.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: true }, hit => {
      if (hit.body === player.body) return;
      const clearance = 0.15 / Math.max(0.1, Math.abs(hit.hitNormalWorld.dot(direction)));
      distance = Math.min(distance, Math.max(0.05, hit.distance - clearance));
    });
    camera.position.sub(target).setLength(distance).add(target);
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
