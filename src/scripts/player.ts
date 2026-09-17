/**
 * Player controller - first-person camera with WASD movement and head bobbing.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

interface WalkableSurface {
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface WalkableRamp {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  startY: number;
  endY: number;
}

export interface PlayerState {
  isMoving: boolean;
  isOnGround: boolean;
  jumping: boolean;
  yaw: number;
  velocityY: number;
}

interface PlayerOptions {
  camera: THREE.PerspectiveCamera;
  physicsWorld: CANNON.World;
  spawnPosition: { x: number; y: number; z: number };
}

export function createPlayer({ camera, physicsWorld, spawnPosition }: PlayerOptions) {
  // --- Physics body ---
  const playerRadius = 0.3;
  const playerMass = 70;
  const eyeHeight = 1.6;

  const playerShape = new CANNON.Sphere(playerRadius);
  const playerBody = new CANNON.Body({ mass: playerMass });
  playerBody.addShape(playerShape);
  playerBody.linearDamping = 0.95;
  playerBody.angularDamping = 0.95;
  const playerPhysMat = new CANNON.Material({ friction: 0, restitution: 0 });
  playerBody.material = playerPhysMat;
  playerBody.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  physicsWorld.addBody(playerBody);

  // --- Walkable surfaces ---
  const walkableSurfaces: WalkableSurface[] = [
    { y: 0, minX: -10, maxX: 10, minZ: -15, maxZ: 17 },
    { y: 4.9, minX: -10, maxX: -4.5, minZ: -15, maxZ: 15 },
    { y: 4.9, minX: 4.5, maxX: 10, minZ: -15, maxZ: 15 },
    { y: 4.9, minX: -4.5, maxX: 4.5, minZ: -15, maxZ: -9.5 },
    { y: 4.9, minX: -4.5, maxX: 4.5, minZ: 9.5, maxZ: 15 },
  ];
  const walkableRamps: WalkableRamp[] = [];

  // --- Movement ---
  const keys: Record<string, boolean> = {};
  const moveSpeed = 6;
  const jumpForce = 7;
  let isOnGround = false;
  let enabled = false;

  // --- Camera ---
  let yaw = 0;
  let pitch = 0;
  const mouseSensitivity = 0.002;

  // --- Head bobbing ---
  let bobTime = 0;
  let bobIntensity = 0;
  const bobFrequency = 10;
  const bobAmplitudeVertical = 0.05;
  const bobAmplitudeHorizontal = 0.02;
  const bobAmplitudePitch = 0.008;
  const bobTransitionSpeed = 4;
  let isPointerLocked = false;

  // --- Input ---
  function onKeyDown(e: KeyboardEvent) { if (enabled) keys[e.code] = true; }
  function onKeyUp(e: KeyboardEvent) { keys[e.code] = false; }

  function clearInput() {
    for (const code of Object.keys(keys)) delete keys[code];
    playerBody.velocity.x = 0;
    playerBody.velocity.z = 0;
  }

  function onMouseMove(e: MouseEvent) {
    if (!enabled || !isPointerLocked) return;
    yaw -= e.movementX * mouseSensitivity;
    pitch -= e.movementY * mouseSensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }

  function onPointerLockChange() {
    isPointerLocked = document.pointerLockElement !== null;
    if (!isPointerLocked) clearInput();
  }

  function onClick() {
    if (enabled && !isPointerLocked) document.body.requestPointerLock();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearInput);
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('click', onClick);

  // --- Movement direction ---
  function getMoveDirection(): { x: number; z: number } | null {
    const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const right = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    if (fwd === 0 && right === 0) return null;
    const len = Math.sqrt(fwd * fwd + right * right);
    const f = fwd / len;
    const r = right / len;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    return { x: f * (-sinY) + r * cosY, z: f * (-cosY) + r * (-sinY) };
  }

  // --- Ground detection ---
  function getGroundHeight(px: number, pz: number, feetY: number): number | null {
    let bestY = -Infinity;
    let found = false;
    const tolerance = 0.5;
    for (const s of walkableSurfaces) {
      if (px >= s.minX && px <= s.maxX && pz >= s.minZ && pz <= s.maxZ) {
        if (s.y >= feetY - 0.15 && s.y <= feetY + tolerance) {
          if (s.y > bestY) { bestY = s.y; found = true; }
        }
      }
    }
    for (const r of walkableRamps) {
      if (px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ) {
        const t = (pz - r.minZ) / (r.maxZ - r.minZ);
        const rampY = r.startY + (r.endY - r.startY) * t;
        if (rampY >= feetY - 0.15 && rampY <= feetY + tolerance) {
          if (rampY > bestY) { bestY = rampY; found = true; }
        }
      }
    }
    return found ? bestY : null;
  }

  function updateGroundState() {
    const feetY = playerBody.position.y - playerRadius;
    const groundY = getGroundHeight(playerBody.position.x, playerBody.position.z, feetY);
    isOnGround = groundY !== null && playerBody.velocity.y <= 0;
    if (isOnGround && groundY !== null) {
      playerBody.position.y = groundY + playerRadius;
      playerBody.velocity.y = 0;
    }
  }

  // --- Update ---
  function update(dt: number) {
    if (!enabled) return;

    const safetyBound = 50;
    playerBody.position.x = Math.max(-safetyBound, Math.min(safetyBound, playerBody.position.x));
    playerBody.position.z = Math.max(-safetyBound, Math.min(safetyBound, playerBody.position.z));
    // Refresh ground state before input, then preserve an airborne jump takeoff.
    updateGroundState();

    // Movement
    const moveDir = getMoveDirection();
    if (moveDir) {
      playerBody.velocity.x = moveDir.x * moveSpeed;
      playerBody.velocity.z = moveDir.z * moveSpeed;
    } else {
      playerBody.velocity.x = 0;
      playerBody.velocity.z = 0;
    }

    if (keys['Space'] && isOnGround) {
      playerBody.velocity.y = jumpForce;
      isOnGround = false;
    }

    // Head bob
    const isMoving = moveDir && isOnGround;
    if (isMoving) {
      bobIntensity = Math.min(1, bobIntensity + dt * bobTransitionSpeed);
      bobTime += dt * bobFrequency;
    } else {
      bobIntensity = Math.max(0, bobIntensity - dt * bobTransitionSpeed);
      bobTime += dt * bobFrequency * bobIntensity;
    }

    const bobVertical = Math.sin(bobTime * 2) * bobAmplitudeVertical * bobIntensity;
    const bobHorizontal = Math.cos(bobTime) * bobAmplitudeHorizontal * bobIntensity;
    const bobPitch = Math.sin(bobTime * 2) * bobAmplitudePitch * bobIntensity;

    // Camera
    camera.position.set(
      playerBody.position.x + bobHorizontal,
      playerBody.position.y - playerRadius + eyeHeight + bobVertical,
      playerBody.position.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch + bobPitch;
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearInput);
    window.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('click', onClick);
    physicsWorld.removeBody(playerBody);
  }

  return {
    body: playerBody,
    radius: playerRadius,
    update,
    dispose,
    enable: () => { updateGroundState(); enabled = true; },
    disable: () => { enabled = false; clearInput(); },
    isEnabled: () => enabled,
    addWalkableSurface: (surface: WalkableSurface) => { walkableSurfaces.push(surface); },
    addWalkableRamp: (ramp: WalkableRamp) => { walkableRamps.push(ramp); },
    setPosition: (x: number, y: number, z: number) => {
      playerBody.position.set(x, y, z);
      playerBody.velocity.set(0, 0, 0);
      updateGroundState();
    },
    setRotation: (newYaw: number, newPitch?: number) => {
      yaw = newYaw;
      pitch = newPitch || 0;
    },
    getState: (): PlayerState => ({
      isMoving: enabled && getMoveDirection() !== null,
      isOnGround,
      jumping: !isOnGround && playerBody.velocity.y > 0,
      yaw,
      velocityY: playerBody.velocity.y,
    }),
  };
}

export type Player = ReturnType<typeof createPlayer>;
