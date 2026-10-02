import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Player } from '../scripts/player.js';

const followCameras = new WeakMap<THREE.PerspectiveCamera, {
  player: Player; pivot: THREE.Vector3; distance: number; firstPerson: boolean;
}>();

export function resetThirdPersonCamera(camera: THREE.PerspectiveCamera) {
  followCameras.delete(camera);
}

export function isCameraForcedFirstPerson(camera: THREE.PerspectiveCamera | null): boolean {
  return camera ? followCameras.get(camera)?.firstPerson ?? false : false;
}

export function applyThirdPersonCamera(
  camera: THREE.PerspectiveCamera, player: Player, dt: number,
  options: { distance: number; height: number; right: number },
): boolean {
  const state = player.getState();
  const firstPersonPosition = camera.position.clone();
  const pivot = new THREE.Vector3(player.body.position.x, camera.position.y - 0.2, player.body.position.z);
  const pitch = THREE.MathUtils.clamp(state.pitch, -1.25, 1.25);
  camera.rotation.set(pitch, state.yaw, 0, 'YXZ');
  const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const shoulderLimit = options.distance * halfFovTan * camera.aspect * 0.45;
  const rightOffset = THREE.MathUtils.clamp(options.right, -shoulderLimit, shoulderLimit);
  const offset = new THREE.Vector3(rightOffset, options.height, options.distance).applyQuaternion(camera.quaternion);
  const desiredDistance = offset.length();
  if (desiredDistance === 0) {
    followCameras.set(camera, { player, pivot, distance: 0, firstPerson: true });
    return false;
  }
  const direction = offset.clone().normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const halfHeight = camera.near * halfFovTan;
  const halfWidth = halfHeight * camera.aspect;
  const radius = Math.max(0.16, Math.hypot(halfWidth, halfHeight, camera.near) + 0.04);
  const world = player.body.world;
  const clearDistance = (candidate: THREE.Vector3) => {
    let distance = desiredDistance;
    const rayDirection = new CANNON.Vec3(candidate.x, candidate.y, candidate.z);
    for (const horizontal of [-1, 0, 1]) {
      for (const vertical of [-1, 0, 1]) {
        const origin = pivot.clone().addScaledVector(right, horizontal * halfWidth).addScaledVector(up, vertical * halfHeight);
        const end = origin.clone().addScaledVector(candidate, desiredDistance + radius);
        world?.raycastAll(
          new CANNON.Vec3(origin.x, origin.y, origin.z), new CANNON.Vec3(end.x, end.y, end.z),
          { skipBackfaces: false, checkCollisionResponse: true }, hit => {
            if (hit.body === player.body) return;
            const incidence = Math.max(0.05, Math.abs(hit.hitNormalWorld.dot(rayDirection)));
            const clearance = (horizontal === 0 && vertical === 0 ? radius : 0.04) / incidence;
            distance = Math.min(distance, Math.max(0, hit.distance - clearance));
          },
        );
      }
    }
    return distance;
  };
  const safeDistance = clearDistance(direction);
  const previous = followCameras.get(camera);
  const samePlayer = previous?.player === player && previous.pivot.distanceToSquared(pivot) <= 9;
  const wasFirstPerson = samePlayer && previous!.firstPerson;
  const reset = !samePlayer || dt <= 0;
  const distance = reset || safeDistance <= previous!.distance ? safeDistance
    : THREE.MathUtils.lerp(previous!.distance, safeDistance, 1 - Math.exp(-6 * Math.min(dt, 0.1)));
  const firstPerson = safeDistance < (wasFirstPerson ? 1.05 : 0.75) || (wasFirstPerson && distance < 0.85);
  followCameras.set(camera, { player, pivot, distance, firstPerson });
  if (firstPerson) {
    camera.position.copy(firstPersonPosition);
    return false;
  }
  camera.position.copy(pivot).addScaledVector(direction, distance);
  return true;
}

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
