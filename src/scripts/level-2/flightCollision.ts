import * as THREE from 'three';

export function predictsCollision(
  relativePosition: THREE.Vector3,
  relativeVelocity: THREE.Vector3,
  horizon: number,
  radius: number,
): boolean {
  if (!Number.isFinite(horizon) || !Number.isFinite(radius) || horizon < 0 || radius < 0) return false;
  const speedSquared = relativeVelocity.lengthSq();
  const time = speedSquared > 1e-8
    ? THREE.MathUtils.clamp(-relativePosition.dot(relativeVelocity) / speedSquared, 0, horizon)
    : 0;
  const closestX = relativePosition.x + relativeVelocity.x * time;
  const closestY = relativePosition.y + relativeVelocity.y * time;
  const closestZ = relativePosition.z + relativeVelocity.z * time;
  return closestX * closestX + closestY * closestY + closestZ * closestZ <= radius * radius;
}