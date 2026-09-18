/**
 * Player controller - first-person camera with WASD movement and head bobbing.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { PHYSICS } from '../helpers/physics/scenePhysics.js';

// One-shot character actions (see characterManager.ts) on number keys 6-9.
export type PlayerActionName = 'Sword_Attack' | 'Pistol_Shoot' | 'Pistol_Reload' | 'Dance_Loop';

const ACTION_KEYS: Record<string, PlayerActionName> = {
  Digit6: 'Sword_Attack',
  Numpad6: 'Sword_Attack',
  Digit7: 'Pistol_Shoot',
  Numpad7: 'Pistol_Shoot',
  Digit8: 'Pistol_Reload',
  Numpad8: 'Pistol_Reload',
  Digit9: 'Dance_Loop',
  Numpad9: 'Dance_Loop',
};

export interface PlayerState {
  isMoving: boolean;
  isOnGround: boolean;
  jumping: boolean;
  yaw: number;
  velocityY: number;
  actionRequest: PlayerActionName | null;
  crouching: boolean;
  sprinting: boolean;
}

interface Doorway {
  x: number;
  y: number;
  z: number;
  // Heading into the room; yaw 0 points along -Z.
  yaw?: number;
}

export interface PlayerTransitionState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  heldKeys: string[];
  intentionalJump: boolean;
  jumpQueued: boolean;
  bobTime: number;
  bobIntensity: number;
  crouching: boolean;
  sprinting: boolean;
}

interface PlayerOptions {
  camera: THREE.PerspectiveCamera;
  physicsWorld: CANNON.World;
  spawnPosition: { x: number; y: number; z: number };
}

export function createPlayer({ camera, physicsWorld, spawnPosition }: PlayerOptions) {
  // --- Physics body ---
  const playerRadius = PHYSICS.playerRadius;
  const playerMass = 70;
  const eyeHeight = 1.6;
  const crouchEyeHeight = 0.9;

  const playerShape = new CANNON.Sphere(playerRadius);
  const playerBody = new CANNON.Body({ mass: playerMass });
  playerBody.addShape(playerShape);
  playerBody.linearDamping = 0;
  playerBody.fixedRotation = true;
  playerBody.updateMassProperties();
  const playerPhysMat = new CANNON.Material({ friction: 0, restitution: 0 });
  playerBody.material = playerPhysMat;
  playerBody.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  physicsWorld.addBody(playerBody);

  // --- Movement ---
  const keys: Record<string, boolean> = {};
  const moveSpeed = PHYSICS.moveSpeed;
  const crouchMoveSpeed = PHYSICS.moveSpeed * 0.6; // 60% speed when crouching
  const sprintMoveSpeed = PHYSICS.moveSpeed * 1.6; // 160% speed when sprinting
  let isOnGround = false;
  let enabled = false;
  let jumpQueued = false;
  let intentionalJump = false;
  let crouching = false;
  let sprinting = false;
  let actionRequest: PlayerActionName | null = null;
  // Requests stay readable for exactly one physics+animation frame, then
  // expire, so a held or unconsumed key can never retrigger the action.
  let actionRequestLife = 0;
  const groundNormal = new CANNON.Vec3(0, 1, 0);
  const minGroundY = Math.cos(PHYSICS.maxSlopeDegrees * Math.PI / 180);

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
  // Third-person view reduces bobbing since the camera is further from the head.
  const thirdPersonBobScale = 0.3;
  let isPointerLocked = document.pointerLockElement != null;

  // --- Input ---
  function onKeyDown(e: KeyboardEvent) {
    if (!enabled) return;
    if (e.code === 'Space' && !keys[e.code] && !e.repeat) jumpQueued = true;
    // Toggle crouch with C key (only on fresh press, not repeat)
    if (e.code === 'KeyC' && !keys[e.code] && !e.repeat) {
      crouching = !crouching;
    }
    // Sprint with Shift key
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      sprinting = true;
    }
    const action = ACTION_KEYS[e.code];
    if (action && !keys[e.code] && !e.repeat && isOnGround) {
      actionRequest = action;
      // Life 3: survives two updateCamera calls per frame (physics.step + main.ts),
      // giving exactly one character-update window before expiry.
      actionRequestLife = 3;
    }
    keys[e.code] = true;
  }
  function onKeyUp(e: KeyboardEvent) {
    keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      sprinting = false;
    }
  }

  function clearInput() {
    for (const code of Object.keys(keys)) delete keys[code];
    jumpQueued = false;
    actionRequest = null;
    actionRequestLife = 0;
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
    isPointerLocked = document.pointerLockElement != null;
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

  // Support comes only from solid colliders. Solver residuals are not jump input.
  function canSupport(body: CANNON.Body) {
    return body !== playerBody && body.type === CANNON.Body.STATIC && body.collisionResponse &&
      (body.collisionFilterGroup & playerBody.collisionFilterMask) !== 0 &&
      (body.collisionFilterMask & playerBody.collisionFilterGroup) !== 0;
  }

  function updateGroundState(useContacts: boolean) {
    const wasGrounded = isOnGround;
    isOnGround = false;
    if (intentionalJump && playerBody.velocity.y > 0) return;
    let support: CANNON.Vec3 | null = null;
    if (useContacts) {
      for (const contact of physicsWorld.contacts) {
        if (!contact.enabled) continue;
        const isFirst = contact.bi === playerBody;
        if (!isFirst && contact.bj !== playerBody) continue;
        const other = isFirst ? contact.bj : contact.bi;
        if (!canSupport(other)) continue;
        const normal = contact.ni.scale(isFirst ? -1 : 1);
        if (normal.y < minGroundY) continue;
        const point = other.position.vadd(isFirst ? contact.rj : contact.ri);
        const gap = playerBody.position.vsub(point).dot(normal) - playerRadius;
        if (Math.abs(gap) <= PHYSICS.contactTolerance && (!support || normal.y > support.y)) {
          support = normal;
        }
      }
    }

    // A short center ray bridges descending slopes and initializes spawn support.
    // Sphere clearance on a slope is radius / normal.y, not radius.
    if (!support && (wasGrounded || playerBody.velocity.y <= 0.5)) {
      const from = playerBody.position.clone();
      const to = from.vadd(new CANNON.Vec3(0, -(playerRadius / minGroundY + PHYSICS.groundSnapDistance), 0));
      const maxGap = wasGrounded ? PHYSICS.groundSnapDistance : PHYSICS.contactTolerance;
      let bestGap = Infinity;
      physicsWorld.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: true }, hit => {
        if (!hit.body || !canSupport(hit.body) || hit.hitNormalWorld.y < minGroundY) return;
        const gap = from.y - hit.hitPointWorld.y - playerRadius / hit.hitNormalWorld.y;
        if (gap >= -PHYSICS.contactTolerance && gap <= maxGap && gap < bestGap) {
          bestGap = gap;
          support = hit.hitNormalWorld.clone();
        }
      });
      if (support && bestGap > 0) {
        playerBody.position.y -= bestGap;
        playerBody.aabbNeedsUpdate = true;
      }
    }
    if (support) {
      groundNormal.copy(support);
      isOnGround = true;
      intentionalJump = false;
      const outwardSpeed = playerBody.velocity.dot(groundNormal);
      if (outwardSpeed > 0) {
        playerBody.velocity.vsub(groundNormal.scale(outwardSpeed), playerBody.velocity);
      }
    }
  }

  function beforePhysicsStep(_dt: number) {
    if (!enabled) return;
    const moveDir = getMoveDirection();
    const desired = new CANNON.Vec3(moveDir?.x ?? 0, 0, moveDir?.z ?? 0);
    let currentMoveSpeed = crouching ? crouchMoveSpeed : moveSpeed;
    if (sprinting && !crouching) currentMoveSpeed = sprintMoveSpeed;
    if (isOnGround) {
      desired.y = -(desired.x * groundNormal.x + desired.z * groundNormal.z) / groundNormal.y;
      desired.normalize();
      desired.scale(currentMoveSpeed, playerBody.velocity);
    } else {
      playerBody.velocity.x = desired.x * currentMoveSpeed;
      playerBody.velocity.z = desired.z * currentMoveSpeed;
    }
    if (jumpQueued && isOnGround && !crouching) {
      playerBody.velocity.y = PHYSICS.jumpSpeed;
      isOnGround = false;
      intentionalJump = true;
    }
    jumpQueued = false;
    if (isOnGround) {
      // Cancel gravity along the support plane so idle players do not slide.
      const gravityNormal = groundNormal.scale(physicsWorld.gravity.dot(groundNormal));
      const gravityTangent = physicsWorld.gravity.vsub(gravityNormal);
      playerBody.force.vsub(gravityTangent.scale(playerMass), playerBody.force);
    }
  }

  function afterPhysicsStep() {
    if (enabled) updateGroundState(true);
  }

  function updateCamera(dt: number, thirdPerson: boolean = false) {
    if (!enabled) return;
    // Expire action requests after one character-update cycle (physics.step
    // calls this once per render frame, before the character update).
    if (actionRequestLife > 0 && --actionRequestLife === 0) actionRequest = null;
    // Head bob
    const isMoving = getMoveDirection() && isOnGround;
    if (isMoving) {
      bobIntensity = Math.min(1, bobIntensity + dt * bobTransitionSpeed);
      bobTime += dt * bobFrequency;
    } else {
      bobIntensity = Math.max(0, bobIntensity - dt * bobTransitionSpeed);
      bobTime += dt * bobFrequency * bobIntensity;
    }

    // Scale down bobbing in third-person view since the camera is further away.
    const bobScale = thirdPerson ? thirdPersonBobScale : 1;
    const bobVertical = Math.sin(bobTime * 2) * bobAmplitudeVertical * bobIntensity * bobScale;
    const bobHorizontal = Math.cos(bobTime) * bobAmplitudeHorizontal * bobIntensity * bobScale;
    const bobPitch = Math.sin(bobTime * 2) * bobAmplitudePitch * bobIntensity * bobScale;

    // Camera
    const currentEyeHeight = crouching ? crouchEyeHeight : eyeHeight;
    camera.position.set(
      playerBody.position.x + bobHorizontal,
      playerBody.position.y - playerRadius + currentEyeHeight + bobVertical,
      playerBody.position.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch + bobPitch;
  }

  function captureTransition(doorway: Doorway): PlayerTransitionState {
    const axis = new THREE.Vector3(0, 1, 0);
    const rotation = -(doorway.yaw ?? 0);
    return {
      position: new THREE.Vector3(
        playerBody.position.x - doorway.x, playerBody.position.y - doorway.y, playerBody.position.z - doorway.z,
      ).applyAxisAngle(axis, rotation),
      velocity: new THREE.Vector3(playerBody.velocity.x, playerBody.velocity.y, playerBody.velocity.z).applyAxisAngle(axis, rotation),
      yaw: yaw + rotation,
      pitch,
      heldKeys: Object.keys(keys).filter(code => keys[code]),
      intentionalJump,
      jumpQueued,
      bobTime,
      bobIntensity,
      crouching,
      sprinting,
    };
  }

  function restoreTransition(state: PlayerTransitionState, doorway: Doorway) {
    // Crossing maps the source's outward direction to the destination's inward direction.
    const rotation = (doorway.yaw ?? 0) + Math.PI;
    const axis = new THREE.Vector3(0, 1, 0);
    const position = new THREE.Vector3().copy(state.position).applyAxisAngle(axis, rotation);
    const velocity = new THREE.Vector3().copy(state.velocity).applyAxisAngle(axis, rotation);
    clearInput();
    for (const code of state.heldKeys) keys[code] = true;
    playerBody.position.set(position.x + doorway.x, position.y + doorway.y, position.z + doorway.z);
    playerBody.velocity.set(velocity.x, velocity.y, velocity.z);
    playerBody.force.set(0, 0, 0);
    playerBody.aabbNeedsUpdate = true;
    playerBody.wakeUp();
    yaw = Math.atan2(Math.sin(state.yaw + rotation), Math.cos(state.yaw + rotation));
    pitch = state.pitch;
    intentionalJump = state.intentionalJump;
    jumpQueued = state.jumpQueued;
    bobTime = state.bobTime;
    bobIntensity = state.bobIntensity;
    crouching = state.crouching;
    sprinting = state.sprinting;
    isOnGround = false;
    updateGroundState(false);
    isPointerLocked = document.pointerLockElement != null;
    updateCamera(0);
  }

  function dispose() {
    enabled = false;
    clearInput();
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
    beforePhysicsStep,
    afterPhysicsStep,
    updateCamera,
    captureTransition,
    restoreTransition,
    dispose,
    enable: () => {
      isPointerLocked = document.pointerLockElement != null;
      updateGroundState(false);
      enabled = true;
    },
    disable: () => { enabled = false; clearInput(); },
    isEnabled: () => enabled,
    setPosition: (x: number, y: number, z: number) => {
      playerBody.position.set(x, y, z);
      playerBody.velocity.set(0, 0, 0);
      playerBody.force.set(0, 0, 0);
      playerBody.aabbNeedsUpdate = true;
      playerBody.wakeUp();
      intentionalJump = false;
      jumpQueued = false;
      isOnGround = false;
      updateGroundState(false);
    },
    setRotation: (newYaw: number, newPitch?: number) => {
      yaw = newYaw;
      pitch = newPitch || 0;
    },
    getState: (): PlayerState => ({
      isMoving: enabled && getMoveDirection() !== null,
      isOnGround,
      jumping: !isOnGround && intentionalJump && playerBody.velocity.y > 0.1,
      yaw,
      velocityY: playerBody.velocity.y,
      actionRequest,
      crouching,
      sprinting,
    }),
  };
}

export type Player = ReturnType<typeof createPlayer>;
