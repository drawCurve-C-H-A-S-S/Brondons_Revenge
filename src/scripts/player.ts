/**
 * Player controller - first-person camera with WASD movement and head bobbing.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { PHYSICS } from '../helpers/physics/scenePhysics.js';
import { SLIDE_TACKLE, slideTackleMotion, slideTackleSpeed } from '../helpers/animation/slideTackle.js';
import type { CargoTransfer } from './cargoPuzzle.js';

// One-shot character actions (see characterManager.ts) on number keys 6-9.
export type PlayerActionName = `Sword_${string}` | 'Pistol_Shoot' | 'Pistol_Reload' | 'Dance_Loop' | 'Interact';

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
  pitch: number;
  velocityY: number;
  actionRequest: PlayerActionName | null;
  crouching: boolean;
  sprinting: boolean;
  climbing: boolean;
  climbDirection: 1 | -1;
  floating: boolean;
  floatTime: number;
  ventMode: boolean;
  boxHandling: boolean;
  boxMotion: number;
  sliding: boolean;
  slideTime: number;
  slideYaw: number;
}

export const PLAYER_MAX_HEALTH = 100;

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
  health?: number;
  shield?: number;
  cargo?: CargoTransfer;
  blockedKeys?: string[];
  slide?: { time: number; yaw: number; entrySpeed: number };
  slideCooldown?: number;
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
  const ventShapes = [new CANNON.Sphere(playerRadius), new CANNON.Sphere(playerRadius)];
  // A directly controlled body must keep integrating even after standing still.
  const playerBody = new CANNON.Body({ mass: playerMass, allowSleep: false });
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
  const blockedKeys = new Set<string>();
  const moveSpeed = PHYSICS.moveSpeed;
  const crouchMoveSpeed = PHYSICS.moveSpeed * 0.6; // 60% speed when crouching
  const sprintMoveSpeed = PHYSICS.moveSpeed * 1.6; // 160% speed when sprinting
  let isOnGround = false;
  let enabled = false;
  let jumpQueued = false;
  let intentionalJump = false;
  let crouching = false;
  let crouchForced = false;
  let climbing = false;
  let climbDirection: 1 | -1 = 1;
  let floating = false;
  let floatingStrafeOnly = false;
  let floatingStrafeHeight = 0;
  let floatTime = 0;
  let ventMode = false;
  let overheadMovement = false;
  let turnRemaining = 0;
  let ventTurnAngle = Math.PI;
  let boxHandling = false;
  let lookLocked = false;
  let sideScrollDepth: number | null = null;
  let inputLocked = false;
  let sprinting = false;
  let sliding = false;
  let slideTime = 0;
  let slideYaw = 0;
  let slideEntrySpeed: number = moveSpeed;
  let slideCooldown = 0;
  let health = PLAYER_MAX_HEALTH;
  let shield = 0;
  const PLAYER_MAX_SHIELD = 50;
  let lastDamageAt = -Infinity;
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
    if (!enabled || inputLocked || blockedKeys.has(e.code) || (e.repeat && !keys[e.code])) return;
    if (floatingStrafeOnly) {
      if (e.code !== 'KeyA' && e.code !== 'KeyD') return;
      e.preventDefault();
    }
    if (sideScrollDepth !== null) {
      if (document.hidden || document.body.classList.contains('quick-menu-open') ||
        !['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight'].includes(e.code) ||
        (e.target instanceof HTMLElement && e.target.closest('button, input, textarea, select, [contenteditable="true"]'))) return;
      e.preventDefault();
    }
    if (e.code === 'Space' || (ventMode && ['KeyA', 'KeyD'].includes(e.code))) e.preventDefault();
    // Remember held movement during scripted traversal, but never queue a jump/action.
    if (climbing) { keys[e.code] = true; return; }
    if (ventMode && !overheadMovement && (e.code === 'KeyA' || e.code === 'KeyD') && !keys[e.code] && !e.repeat && turnRemaining === 0) {
      turnRemaining = e.code === 'KeyA' ? ventTurnAngle : -ventTurnAngle;
    }
    if (!sliding && !floating && !boxHandling && !crouchForced && !ventMode && e.code === 'Space' && !keys[e.code] && !e.repeat) jumpQueued = true;
    if (!floating && !boxHandling && e.code === 'KeyC' && !crouchForced && !keys[e.code] && !e.repeat) {
      const forwardSpeed = -playerBody.velocity.x * Math.sin(yaw) - playerBody.velocity.z * Math.cos(yaw);
      const runningForward = sideScrollDepth === null && keys.KeyW && !keys.KeyS && !crouching && !ventMode;
      if (!sliding && runningForward && isOnGround && forwardSpeed > moveSpeed * 0.45 && slideCooldown <= 0) {
        sliding = true; slideTime = 0; slideYaw = yaw; slideEntrySpeed = forwardSpeed;
        jumpQueued = false; actionRequest = null; actionRequestLife = 0;
      } else if (!sliding && !runningForward) {
        crouching = !crouching;
      }
    }
    // Sprint with Shift key
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      sprinting = true;
    }
    const action = ACTION_KEYS[e.code];
    if (!sliding && !boxHandling && !ventMode && action && !keys[e.code] && !e.repeat && isOnGround) {
      actionRequest = action;
      // Life 3: survives two updateCamera calls per frame (physics.step + main.ts),
      // giving exactly one character-update window before expiry.
      actionRequestLife = 3;
    }
    keys[e.code] = true;
  }
  function onKeyUp(e: KeyboardEvent) {
    blockedKeys.delete(e.code);
    keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      sprinting = !!(keys['ShiftLeft'] || keys['ShiftRight']);
    }
  }

  function clearInput() {
    for (const code of Object.keys(keys)) delete keys[code];
    jumpQueued = false;
    actionRequest = null;
    actionRequestLife = 0;
    playerBody.velocity.x = 0;
    playerBody.velocity.z = 0;
    if (floating) playerBody.velocity.y = 0;
    sprinting = false;
    turnRemaining = 0;
    cancelSlide();
  }

  function cancelSlide() {
    if (sliding) slideCooldown = SLIDE_TACKLE.cooldown;
    sliding = false; slideTime = 0;
  }

  function requestAction(action: PlayerActionName) {
    if (!enabled || inputLocked || sliding || !isOnGround || boxHandling || ventMode || actionRequest || (sideScrollDepth !== null && action !== 'Sword_Attack')) return false;
    actionRequest = action;
    actionRequestLife = 3;
    return true;
  }

  function onMouseMove(e: MouseEvent) {
    const touchActive = !!(window as any).__touchActive;
    if (!enabled || inputLocked || (!isPointerLocked && !touchActive) || lookLocked || sideScrollDepth !== null) return;
    yaw -= e.movementX * mouseSensitivity;
    pitch -= e.movementY * mouseSensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }

  function onPointerLockChange() {
    isPointerLocked = document.pointerLockElement != null;
    if (!isPointerLocked && !(window as any).__touchActive) clearInput();
  }

  function onClick() {
    if (enabled && !inputLocked && sideScrollDepth === null && !isPointerLocked && !(window as any).__touchActive) document.body.requestPointerLock();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearInput);
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('click', onClick);

  // --- Movement direction ---
  function getMoveDirection(): { x: number; z: number } | null {
    if (overheadMovement) {
      const x = Number(!!(keys.KeyD || keys.ArrowRight)) - Number(!!(keys.KeyA || keys.ArrowLeft));
      const z = Number(!!(keys.KeyS || keys.ArrowDown)) - Number(!!(keys.KeyW || keys.ArrowUp));
      const length = Math.hypot(x, z);
      return length ? { x: x / length, z: z / length } : null;
    }
    if (floatingStrafeOnly) {
      const right = Number(!!keys.KeyD) - Number(!!keys.KeyA);
      return right ? { x: right * Math.cos(yaw), z: -right * Math.sin(yaw) } : null;
    }
    if (sideScrollDepth !== null) {
      const right = Number(!!(keys.KeyD || keys.ArrowRight)) - Number(!!(keys.KeyA || keys.ArrowLeft));
      return right ? { x: -right, z: 0 } : null;
    }
    if (ventMode && turnRemaining !== 0) return null;
    const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const right = ventMode ? 0 : (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
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
    if (floating || climbing || (intentionalJump && playerBody.velocity.y > 0)) return;
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
    slideCooldown = Math.max(0, slideCooldown - _dt);
    if (ventMode) {
      crouching = true;
      jumpQueued = false;
      intentionalJump = false;
    }
    if (inputLocked) { playerBody.velocity.set(0, 0, 0); return; }
    if (climbing) {
      playerBody.velocity.set(0, 0, 0);
      playerBody.force.set(0, 0, 0);
      return;
    }
    if (ventMode && turnRemaining !== 0) {
      const turn = Math.sign(turnRemaining) * Math.min(Math.abs(turnRemaining), Math.PI * _dt / 0.45);
      yaw += turn;
      turnRemaining -= turn;
      if (Math.abs(turnRemaining) < 1e-6) turnRemaining = 0;
    }
    sprinting = !crouchForced && !boxHandling && !!(keys['ShiftLeft'] || keys['ShiftRight']);
    const moveDir = getMoveDirection();
    if (overheadMovement && moveDir) yaw = Math.atan2(-moveDir.x, -moveDir.z);
    if (sideScrollDepth !== null && moveDir) yaw = moveDir.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    const desired = new CANNON.Vec3(moveDir?.x ?? 0, 0, moveDir?.z ?? 0);
    if (floating) {
      desired.y = floatingStrafeOnly ? 0 : (keys['Space'] ? 1 : 0) - (keys['KeyC'] ? 1 : 0);
      if (desired.lengthSquared() > 0) desired.normalize();
      desired.scale(sprinting ? 4.8 : 3.2, desired);
      if (floatingStrafeOnly) desired.y = THREE.MathUtils.clamp((floatingStrafeHeight - playerBody.position.y) * 3, -1.5, 1.5);
      // Responsive thrusters with a short braking glide on release.
      const blend = 1 - Math.exp(-5 * _dt);
      playerBody.velocity.lerp(desired, blend, playerBody.velocity);
      jumpQueued = false;
      isOnGround = false;
      floatTime += _dt;
      return;
    }
    let currentMoveSpeed = boxHandling ? 1.25 : ventMode ? 1.6 : crouching ? crouchMoveSpeed : moveSpeed;
    if (sprinting && !crouching) currentMoveSpeed = sprintMoveSpeed;
    if (sliding) {
      if (!isOnGround || slideTime >= SLIDE_TACKLE.duration) cancelSlide();
      else {
        desired.set(-Math.sin(slideYaw), 0, -Math.cos(slideYaw));
        const exitSpeed = keys.KeyW && !keys.KeyS ? currentMoveSpeed : 0;
        currentMoveSpeed = slideTackleSpeed(slideTime, slideEntrySpeed, exitSpeed);
        slideTime = Math.min(SLIDE_TACKLE.duration, slideTime + _dt);
        jumpQueued = false;
      }
    }
    if (isOnGround) {
      desired.y = -(desired.x * groundNormal.x + desired.z * groundNormal.z) / groundNormal.y;
      desired.normalize();
      desired.scale(currentMoveSpeed, playerBody.velocity);
    } else {
      playerBody.velocity.x = desired.x * currentMoveSpeed;
      playerBody.velocity.z = desired.z * currentMoveSpeed;
    }
    if (jumpQueued && !sliding && isOnGround && !crouching && !crouchForced) {
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
    if (sideScrollDepth !== null) {
      playerBody.position.z = sideScrollDepth;
      playerBody.velocity.z = 0;
      playerBody.aabbNeedsUpdate = true;
    }
    if (enabled && !climbing) updateGroundState(true);
    if (sliding) {
      if (!isOnGround) cancelSlide();
      else for (const contact of physicsWorld.contacts) {
        if (!contact.enabled) continue;
        const first = contact.bi === playerBody;
        if (!first && contact.bj !== playerBody) continue;
        const normal = contact.ni.scale(first ? -1 : 1);
        if (normal.y < minGroundY && normal.x * -Math.sin(slideYaw) + normal.z * -Math.cos(slideYaw) < -0.55) {
          cancelSlide(); break;
        }
      }
    }
  }

  function updateCamera(dt: number, thirdPerson: boolean = false) {
    if (!enabled) return;
    // Expire action requests after one character-update cycle (physics.step
    // calls this once per render frame, before the character update).
    if (actionRequestLife > 0 && --actionRequestLife === 0) actionRequest = null;
    // Head bob
    const isMoving = !sliding && !climbing && getMoveDirection() && isOnGround;
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
    const currentEyeHeight = sliding ? slideTackleMotion(slideTime).eyeHeight
      : ventMode || (!climbing && (crouching || crouchForced)) ? crouchEyeHeight : eyeHeight;
    camera.position.set(
      playerBody.position.x + bobHorizontal,
      playerBody.position.y - playerRadius + currentEyeHeight + bobVertical,
      playerBody.position.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch + bobPitch;
    camera.rotation.z = sliding && !thirdPerson ? -slideTackleMotion(slideTime).low * 0.055
      : floating && !climbing ? Math.sin(floatTime * 0.85) * 0.012 : 0;
    if (floating && !climbing) camera.position.y += Math.sin(floatTime * 1.4) * 0.025;
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
      health,
      shield,
      slide: sliding ? { time: slideTime, yaw: slideYaw + rotation, entrySpeed: slideEntrySpeed } : undefined,
      slideCooldown,
    };
  }

  function captureDoorTransition(doorway: Doorway, outward: -1 | 1 = -1): PlayerTransitionState {
    const state = captureTransition(doorway);
    // Edge exits arrive inside the destination aperture, beyond its return trigger.
    const halfOpening = 1.5 - playerRadius - 0.05;
    state.position.x = THREE.MathUtils.clamp(state.position.x, -halfOpening, halfOpening);
    state.position.z = outward * Math.max(playerRadius + 0.2, state.position.z * outward);
    return state;
  }

  function restoreTransition(state: PlayerTransitionState, doorway: Doorway) {
    // Crossing maps the source's outward direction to the destination's inward direction.
    const rotation = (doorway.yaw ?? 0) + Math.PI;
    const axis = new THREE.Vector3(0, 1, 0);
    const position = new THREE.Vector3().copy(state.position).applyAxisAngle(axis, rotation);
    const velocity = new THREE.Vector3().copy(state.velocity).applyAxisAngle(axis, rotation);
    clearInput();
    blockedKeys.clear();
    for (const code of state.blockedKeys ?? []) blockedKeys.add(code);
    for (const code of state.heldKeys) if (!blockedKeys.has(code)) keys[code] = true;
    playerBody.position.set(position.x + doorway.x, position.y + doorway.y, position.z + doorway.z);
    playerBody.velocity.set(velocity.x, velocity.y, velocity.z);
    playerBody.force.set(0, 0, 0);
    playerBody.aabbNeedsUpdate = true;
    playerBody.wakeUp();
    yaw = Math.atan2(Math.sin(state.yaw + rotation), Math.cos(state.yaw + rotation));
    pitch = state.pitch;
    intentionalJump = !crouchForced && !ventMode && state.intentionalJump;
    jumpQueued = !crouchForced && !ventMode && state.jumpQueued;
    bobTime = state.bobTime;
    bobIntensity = state.bobIntensity;
    crouching = crouchForced || ventMode || state.crouching;
    sprinting = !crouchForced && !ventMode && state.sprinting;
    if (ventMode) playerBody.velocity.y = Math.min(0, playerBody.velocity.y);
    if (Number.isFinite(state.health)) health = Math.max(0, Math.min(PLAYER_MAX_HEALTH, state.health!));
    if (Number.isFinite(state.shield)) shield = Math.max(0, Math.min(PLAYER_MAX_SHIELD, state.shield!));
    isOnGround = false;
    updateGroundState(false);
    slideCooldown = Math.max(0, state.slideCooldown ?? 0);
    if (state.slide && isOnGround && !crouching && !crouchForced && !ventMode && !climbing && !floating && !boxHandling
      && sideScrollDepth === null && state.slide.time >= 0 && state.slide.time < SLIDE_TACKLE.duration) {
      sliding = true; slideTime = state.slide.time; slideYaw = state.slide.yaw + rotation;
      slideEntrySpeed = state.slide.entrySpeed;
      jumpQueued = false;
    }
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
    getHeadY: () => playerBody.position.y - playerRadius + (sliding ? slideTackleMotion(slideTime).eyeHeight : eyeHeight),
    beforePhysicsStep,
    afterPhysicsStep,
    updateCamera,
    captureTransition,
    captureDoorTransition,
    restoreTransition,
    clearInput,
    dispose,
    enable: () => {
      isPointerLocked = !!(window as any).__touchActive || document.pointerLockElement != null;
      updateGroundState(false);
      enabled = true;
    },
    disable: () => { enabled = false; clearInput(); },
    isEnabled: () => enabled,
    setPosition: (x: number, y: number, z: number) => {
      cancelSlide();
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
    setForcedCrouch: (forced: boolean) => {
      crouchForced = forced;
      if (forced) {
        cancelSlide();
        crouching = true;
        sprinting = false;
      }
      updateCamera(0);
    },
    setVentTurnAngle: (angle: number) => { ventTurnAngle = angle; },
    setOverheadMovement: (active: boolean) => {
      overheadMovement = active; turnRemaining = 0; clearInput();
    },
    setBoxHandling: (active: boolean) => {
      cancelSlide();
      boxHandling = active; lookLocked = active || ventMode;
      crouching = false; sprinting = false; jumpQueued = false;
      actionRequest = null; actionRequestLife = 0;
    },
    setVentMode: (active: boolean) => {
      ventShapes.forEach((shape, index) => {
        const attached = playerBody.shapes.includes(shape);
        if (active && !attached) {
          const offset = (crouchEyeHeight - playerRadius) * (index + 1) / ventShapes.length;
          playerBody.addShape(shape, new CANNON.Vec3(0, offset, 0));
        } else if (!active && attached) {
          playerBody.removeShape(shape);
        }
      });
      playerBody.aabbNeedsUpdate = true;
      playerBody.wakeUp();
      ventMode = active;
      if (!active) overheadMovement = false;
      turnRemaining = 0;
      crouchForced = active;
      crouching = active;
      lookLocked = active;
      clearInput();
      intentionalJump = false;
      if (active) playerBody.velocity.y = Math.min(0, playerBody.velocity.y);
      updateCamera(0);
    },
    setClimbing: (active: boolean, direction: 1 | -1 = 1) => {
      climbing = active;
      climbDirection = direction;
      if (active) clearInput();
      playerBody.velocity.set(0, 0, 0);
      playerBody.force.set(0, 0, 0);
      playerBody.type = active ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
      playerBody.updateMassProperties();
      playerBody.wakeUp();
      isOnGround = false;
      intentionalJump = false;
      bobIntensity = 0;
      if (!active) updateGroundState(false);
    },
    setZeroGravity: (active: boolean) => {
      if (active === floating) return;
      cancelSlide();
      jumpQueued = false;
      actionRequest = null;
      actionRequestLife = 0;
      playerBody.velocity.set(0, 0, 0);
      playerBody.force.set(0, 0, 0);
      floating = active;
      floatTime = 0;
      crouching = false;
      bobIntensity = 0;
      intentionalJump = false;
      isOnGround = false;
      playerBody.aabbNeedsUpdate = true;
      playerBody.wakeUp();
      updateGroundState(false);
    },
    setZeroGravityStrafe: (active: boolean) => {
      floatingStrafeOnly = active;
      if (active) floatingStrafeHeight = playerBody.position.y + 1.4;
      clearInput();
    },
    setLookLocked: (locked: boolean) => { lookLocked = locked; },
    setInputLocked: (locked: boolean) => { inputLocked = locked; if (locked) clearInput(); },
    setSideScrollDepth: (depth: number | null) => {
      if (depth !== null && !Number.isFinite(depth)) return;
      clearInput(); sideScrollDepth = depth;
      playerBody.linearFactor.set(1, 1, depth === null ? 1 : 0);
      crouching = crouchForced = sprinting = false;
      if (depth !== null) {
        playerBody.position.z = depth; playerBody.aabbNeedsUpdate = true;
        yaw = Math.PI / 2; pitch = 0;
      }
    },
    // Damage is ignored once dead; the caller (main.ts) handles respawning.
    takeDamage: (amount: number, allowWhileDisabled = false) => {
      if ((!enabled && !allowWhileDisabled) || health <= 0 || !Number.isFinite(amount) || amount <= 0) return;
      let remaining = amount;
      if (shield > 0) {
        const absorbed = Math.min(shield, remaining);
        shield -= absorbed;
        remaining -= absorbed;
      }
      if (remaining > 0) {
        health = Math.max(0, health - remaining);
        lastDamageAt = performance.now();
      }
    },
    heal: (amount: number) => {
      if (!enabled || health <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
      const previous = health;
      health = Math.min(PLAYER_MAX_HEALTH, health + amount);
      return health > previous;
    },
    addShield: (amount: number) => {
      if (!enabled || health <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
      const previous = shield;
      shield = Math.min(PLAYER_MAX_SHIELD, shield + amount);
      return shield > previous;
    },
    getShield: () => shield,
    getMaxShield: () => PLAYER_MAX_SHIELD,
    getHealth: () => health,
    getDamageFlash: () => Math.max(0, 0.72 - (performance.now() - lastDamageAt) / 650),
    requestAction,
    getState: (): PlayerState => ({
      isMoving: enabled && !climbing && (sliding || (floating ? playerBody.velocity.lengthSquared() > 0.04
        : sideScrollDepth !== null ? getMoveDirection() !== null && Math.abs(playerBody.velocity.x) > 0.05 : getMoveDirection() !== null)),
      isOnGround,
      jumping: !isOnGround && intentionalJump && playerBody.velocity.y > 0.1,
      yaw,
      pitch,
      velocityY: playerBody.velocity.y,
      actionRequest,
      crouching: crouching || crouchForced,
      sprinting: sprinting && !sliding,
      climbing,
      climbDirection,
      floating,
      floatTime,
      ventMode,
      boxHandling,
      boxMotion: boxHandling ? playerBody.velocity.x * -Math.sin(yaw) + playerBody.velocity.z * -Math.cos(yaw) : 0,
      sliding,
      slideTime,
      slideYaw,
    }),
  };
}

export type Player = ReturnType<typeof createPlayer>;
