import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { CinematicPose } from './characterManager.js';
import { inputHint } from './gamepadInput.js';
import type { Player, PlayerState } from './player.js';

export interface ChairSeat { root: THREE.Object3D; yaw: number; /** World-space cushion point, for seats whose proxy has no top face to raycast. */ surface?: () => THREE.Vector3; }
interface SeatingOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: Player;
  chairs(): readonly ChairSeat[];
  canInteract(): boolean;
  prompt: HTMLElement | null;
}
interface Sitting {
  phase: 'enter' | 'rest' | 'exit';
  time: number;
  healTime: number;
  position: THREE.Vector3;
  surface: THREE.Vector3;
  floor: number;
  start: THREE.Vector3;
  yaw: number;
  startYaw: number;
  startPitch: number;
  bodyType: CANNON.BodyType;
  cameraPosition: THREE.Vector3;
  cameraRotation: THREE.Quaternion;
  cameraFov: number;
}

const ENTER_SECONDS = 1.1, EXIT_SECONDS = 1.1, HEAL_SECONDS = 4;

export function createChairSeating({ scene, camera, player, chairs, canInteract, prompt }: SeatingOptions) {
  let sitting: Sitting | null = null, lastDelta = 0, disposed = false, ownsPrompt = false;
  const raycaster = new THREE.Raycaster(), center = new THREE.Vector2(), projected = new THREE.Vector3();
  const view = new THREE.PerspectiveCamera();

  function findChair() {
    if (disposed || !canInteract() || !player.isEnabled() || player.getHealth() <= 0) return null;
    const state = player.getState();
    if (!state.isOnGround || state.sliding || state.climbing || state.ventMode || state.floating || state.boxHandling) return null;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const nearby = chairs().filter(seat => {
      for (let node: THREE.Object3D | null = seat.root; node; node = node.parent) if (!node.visible) return false;
      const bounds = new THREE.Box3().setFromObject(seat.root), point = bounds.getCenter(new THREE.Vector3());
      return Math.abs(bounds.min.y + player.radius - player.body.position.y) < 0.7
        && Math.hypot(point.x - player.body.position.x, point.z - player.body.position.z) <= 1.8;
    });
    raycaster.setFromCamera(center, camera);
    for (const hit of raycaster.intersectObjects(nearby.map(seat => seat.root), true)) {
      for (const seat of nearby) for (let node: THREE.Object3D | null = hit.object; node; node = node.parent)
        if (node === seat.root) return seat;
    }
    let target: ChairSeat | null = null, closest = 0.1;
    for (const seat of nearby) {
      new THREE.Box3().setFromObject(seat.root).getCenter(projected); projected.project(camera);
      const distance = Math.hypot(projected.x, projected.y);
      if (Math.abs(projected.z) < 1 && distance < closest) { closest = distance; target = seat; }
    }
    return target;
  }

  function restore() {
    const state = sitting; if (!state) return;
    sitting = null;
    player.body.type = state.bodyType; player.body.updateMassProperties();
    player.setPosition(state.start.x, state.start.y, state.start.z);
    player.setRotation(state.startYaw, state.startPitch); player.setInputLocked(false);
    camera.position.copy(state.cameraPosition); camera.quaternion.copy(state.cameraRotation);
    camera.fov = state.cameraFov; camera.updateProjectionMatrix();
    if (ownsPrompt) prompt?.classList.add('hidden'); ownsPrompt = false;
  }

  function sit(seat: ChairSeat) {
    if (sitting || disposed || !canInteract() || !player.isEnabled() || player.getHealth() <= 0) return false;
    const state = player.getState(), bounds = new THREE.Box3().setFromObject(seat.root);
    const height = bounds.max.y - bounds.min.y;
    const surfaceRay = new THREE.Raycaster();
    const normalMatrix = new THREE.Matrix3(), normal = new THREE.Vector3();
    let surface: THREE.Vector3 | null = seat.surface?.() ?? null;
    const center = bounds.getCenter(new THREE.Vector3());
    for (const [dx, dz] of surface ? [] : [[0, 0], [-0.07, 0], [0.07, 0], [0, -0.07], [0, 0.07]]) {
      surfaceRay.set(new THREE.Vector3(center.x + dx, bounds.min.y + height * 0.72, center.z + dz), new THREE.Vector3(0, -1, 0));
      for (const hit of surfaceRay.intersectObject(seat.root, true)) {
        if (!hit.face || hit.point.y < bounds.min.y + height * 0.28) continue;
        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
        if (normal.y > 0.75) { surface = hit.point.clone(); break; }
      }
      if (surface) break;
    }
    if (!surface) {
      console.error('[ChairSeating] No usable cushion surface:', seat.root.name);
      if (prompt) { prompt.textContent = 'Unable to sit on this chair.'; prompt.classList.remove('hidden'); }
      return false;
    }
    const position = bounds.getCenter(new THREE.Vector3()); position.y = bounds.min.y + player.radius;
    sitting = {
      phase: 'enter', time: 0, healTime: 0, position, surface, floor: bounds.min.y,
      start: new THREE.Vector3().copy(player.body.position), yaw: seat.yaw, startYaw: state.yaw, startPitch: state.pitch,
      bodyType: player.body.type, cameraPosition: camera.position.clone(), cameraRotation: camera.quaternion.clone(), cameraFov: camera.fov,
    };
    player.setInputLocked(true); player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties();
    player.body.velocity.set(0, 0, 0); player.body.force.set(0, 0, 0);
    return true;
  }

  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || disposed || !canInteract()
      || document.hidden || document.body.classList.contains('quick-menu-open') || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    if (sitting) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (sitting.phase === 'rest') { sitting.phase = 'exit'; sitting.time = 0; }
      return;
    }
    const seat = findChair(); if (!seat) return;
    event.preventDefault(); event.stopImmediatePropagation(); sit(seat);
  }
  window.addEventListener('keydown', onKey, true);

  return {
    get active() { return sitting !== null; },
    get resting() { return sitting?.phase === 'rest'; },
    sit,
    stand() { if (sitting?.phase === 'rest') { sitting.phase = 'exit'; sitting.time = 0; } },
    get delta() { return lastDelta; },
    update(dt: number) {
      lastDelta = Math.max(0, Math.min(0.1, dt));
      const state = sitting; if (!state) return;
      if (!canInteract() || !player.isEnabled() || player.getHealth() <= 0) { restore(); return; }
      state.time += lastDelta;
      if (state.phase === 'enter' && state.time >= ENTER_SECONDS) { state.phase = 'rest'; state.time = 0; }
      if (state.phase === 'exit' && state.time >= EXIT_SECONDS) { restore(); return; }
      if (state.phase === 'rest') {
        state.healTime += lastDelta;
        if (state.healTime >= HEAL_SECONDS) { player.heal(1); state.healTime -= HEAL_SECONDS; }
      }
      const progress = state.phase === 'enter' ? THREE.MathUtils.smootherstep(state.time, 0, ENTER_SECONDS * 0.65)
        : state.phase === 'exit' ? 1 - THREE.MathUtils.smootherstep(state.time, EXIT_SECONDS * 0.5, EXIT_SECONDS) : 1;
      const position = state.start.clone().lerp(state.position, progress);
      player.body.position.set(position.x, position.y, position.z); player.body.aabbNeedsUpdate = true;
      player.body.velocity.set(0, 0, 0); player.body.force.set(0, 0, 0);
      const turn = Math.atan2(Math.sin(state.yaw - state.startYaw), Math.cos(state.yaw - state.startYaw));
      player.setRotation(state.startYaw + turn * progress, state.startPitch * (1 - progress));
    },
    updateInteractionFocus() {
      if (disposed || !canInteract() || (!sitting && !findChair())) {
        if (ownsPrompt) prompt?.classList.add('hidden'); ownsPrompt = false;
        return false;
      }
      if (prompt) {
        prompt.textContent = inputHint(sitting ? 'E / Stand up' : 'E / Sit and rest');
        prompt.classList.remove('hidden'); ownsPrompt = true;
      }
      return true;
    },
    getState(): PlayerState | null {
      return sitting ? { ...player.getState(), isMoving: false, isOnGround: true, jumping: false, climbing: false,
        crouching: false, sprinting: false, actionRequest: null, sliding: false, boxHandling: false } : null;
    },
    getPose(): CinematicPose | null {
      if (!sitting) return null;
      const pose: CinematicPose = sitting.phase === 'enter' ? { clip: 'Sitting_Enter', time: sitting.time, duration: ENTER_SECONDS }
        : sitting.phase === 'exit' ? { clip: 'Sitting_Exit', time: sitting.time, duration: EXIT_SECONDS }
        : { clip: 'Sitting_Idle_Loop', time: sitting.time, loop: true };
      const weight = sitting.phase === 'enter' ? THREE.MathUtils.smootherstep(sitting.time, ENTER_SECONDS * 0.25, ENTER_SECONDS * 0.9)
        : sitting.phase === 'exit' ? 1 - THREE.MathUtils.smootherstep(sitting.time, 0, EXIT_SECONDS * 0.65) : 1;
      pose.seatContact = { position: sitting.surface, weight };
      const forward = new THREE.Vector3(-Math.sin(sitting.yaw), 0, -Math.cos(sitting.yaw));
      const right = new THREE.Vector3(Math.cos(sitting.yaw), 0, -Math.sin(sitting.yaw));
      const feet = sitting.surface.clone().addScaledVector(forward, 0.43); feet.y = sitting.floor + 0.055;
      pose.footTargets = { left: feet.clone().addScaledVector(right, -0.14),
        right: feet.clone().addScaledVector(right, 0.14), weight };
      return pose;
    },
    applyCamera() {
      const state = sitting; if (!state) return false;
      const focus = state.surface.clone().add(new THREE.Vector3(0, 0.45, 0));
      const offset = new THREE.Vector3(Math.sin(state.yaw) * 2.5 + Math.cos(state.yaw) * 0.6, 0.9,
        Math.cos(state.yaw) * 2.5 - Math.sin(state.yaw) * 0.6);
      const destination = focus.clone().add(offset), distance = offset.length();
      let fraction = 1;
      player.body.world?.raycastAll(new CANNON.Vec3(focus.x, focus.y, focus.z),
        new CANNON.Vec3(destination.x, destination.y, destination.z),
        { skipBackfaces: false, checkCollisionResponse: true }, hit => {
          if (hit.body !== player.body) fraction = Math.min(fraction, Math.max(0.05, (hit.distance - 0.15) / distance));
        });
      view.position.copy(focus).addScaledVector(offset, fraction); view.lookAt(focus);
      const blend = state.phase === 'enter' ? THREE.MathUtils.smootherstep(state.time, 0, ENTER_SECONDS)
        : state.phase === 'exit' ? 1 - THREE.MathUtils.smootherstep(state.time, 0, EXIT_SECONDS) : 1;
      camera.position.lerpVectors(state.cameraPosition, view.position, blend);
      camera.quaternion.slerpQuaternions(state.cameraRotation, view.quaternion, blend);
      camera.fov = state.cameraFov; camera.updateProjectionMatrix();
      return true;
    },
    dispose() {
      if (disposed) return; disposed = true;
      restore(); window.removeEventListener('keydown', onKey, true);
    },
  };
}
