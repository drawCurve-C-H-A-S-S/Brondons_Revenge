import * as THREE from 'three';
import type { Player, PlayerTransitionState } from './player.js';
import { inputHint } from './gamepadInput.js';

export function createTeleportCrystal() {
  const root = new THREE.Group(); root.name = 'PurpleTeleportCrystal';
  const material = new THREE.MeshStandardMaterial({ color: 0xbd77ff, emissive: 0x8d38e5,
    emissiveIntensity: 1.2, metalness: 0.25, roughness: 0.2 });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), material);
  crystal.scale.y = 1.45; root.add(crystal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.014, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xd9a3ff, toneMapped: false }));
  ring.rotation.x = Math.PI / 2; root.add(ring);
  return root;
}

/** Exact world-space arrival, preserving health/shield but never stale movement. */
export function teleportPlayer(player: Player, position: { x: number; y: number; z: number }, yaw: number,
  state = player.captureTransition({ x: 0, y: 0, z: 0 })) {
  const arrival: PlayerTransitionState = {
    ...state, position: { ...position }, yaw, pitch: 0, velocity: { x: 0, y: 0, z: 0 },
    heldKeys: [], blockedKeys: [], intentionalJump: false, jumpQueued: false,
    bobTime: 0, bobIntensity: 0, crouching: false, sprinting: false, slide: undefined,
  };
  player.restoreTransition(arrival, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  // Cannon interpolates between frames; snap those endpoints as well as its current body.
  player.body.previousPosition.copy(player.body.position);
  player.body.interpolatedPosition.copy(player.body.position);
}

const TELEPORT_THROW = { holdSeconds: 0.3, chargeSeconds: 0.7, minSpeed: 8, maxSpeed: 22, gravity: 16, maxFlight: 5 };

export interface TeleportationDeviceState {
  collected: boolean;
  placed: boolean;
  placementScene: string | null;
  placementPosition: { x: number; y: number; z: number } | null;
  placementRotation: number | null;
}

export interface TeleportationDeviceContext {
  currentSceneId: string;
  isBossFight: () => boolean;
  isInputBlocked: () => boolean;
  getActiveScene: () => THREE.Scene | null;
  getPlayerRadius: () => number;
  getPlayerPosition: () => { x: number; y: number; z: number };
  getPlayerRotation: () => number;
  getAimDirection?: () => { x: number; y: number; z: number };
  onTeleport: (sceneId: string, position: { x: number; y: number; z: number }, rotation: number) => void;
  showMessage: (message: string) => void;
  canPlace?: (sceneId: string, position: { x: number; y: number; z: number }) => string | null;
  placementMessage?: (sceneId: string, position: { x: number; y: number; z: number }) => string;
  returnError?: (state: TeleportationDeviceState) => string | null;
  /** A fixed return destination that T uses regardless of any placed marker. */
  returnOverride?: () => { sceneId: string; position: { x: number; y: number; z: number }; rotation: number } | null;
}

export class TeleportationDeviceController {
  private state: TeleportationDeviceState;
  private context: () => TeleportationDeviceContext;
  private placedMarker: THREE.Group | null = null;
  private markerRadius = 0.3;
  private time = 0;
  private qDownAt = -1;
  private raycaster = new THREE.Raycaster();
  private thrown: { mesh: THREE.Group; scene: THREE.Scene; sceneId: string; rotation: number; age: number; velocity: THREE.Vector3 } | null = null;
  constructor(context: () => TeleportationDeviceContext, initialState: TeleportationDeviceState = {
    collected: false,
    placed: false,
    placementScene: null,
    placementPosition: null,
    placementRotation: null,
  }) {
    this.context = context;
    this.state = { ...initialState };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  getState(): TeleportationDeviceState {
    return { ...this.state, placementPosition: this.state.placementPosition ? { ...this.state.placementPosition } : null };
  }

  isCollected() {
    return this.state.collected;
  }

  isPlaced() {
    return this.state.placed;
  }

  collect(announce = true) {
    if (this.state.collected) return;
    this.state.collected = true;
    if (announce) this.showMessage(inputHint('Teleporting crystal shard linked! Q: place marker / T: return / Hold Tab: weapons.'));
  }

  reset() {
    this.detachMarker();
    this.state = { collected: false, placed: false, placementScene: null, placementPosition: null, placementRotation: null };
  }

  setMarker(sceneId: string, position: { x: number; y: number; z: number }, rotation: number) {
    if (!this.state.collected) throw new Error('Cannot set a teleport marker before collecting the crystal shard');
    if (!sceneId || ![position.x, position.y, position.z, rotation].every(Number.isFinite))
      throw new Error('Teleport markers require a scene and finite coordinates/rotation');
    this.state.placed = true;
    this.state.placementScene = sceneId;
    this.state.placementPosition = { ...position };
    this.state.placementRotation = rotation;
    this.markerRadius = this.context().getPlayerRadius();
    this.update(0);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || !this.state.collected) return;
    if (document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;

    const ctx = this.context();
    if (!ctx.currentSceneId || ctx.isInputBlocked()) return;

    if (event.code === 'KeyQ') {
      event.preventDefault();
      if (!ctx.isBossFight()) this.qDownAt = performance.now();
    } else if (event.code === 'KeyT') {
      event.preventDefault();
      this.teleportToDevice();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== 'KeyQ' || this.qDownAt < 0) return;
    const held = (performance.now() - this.qDownAt) / 1000;
    this.qDownAt = -1;
    if (!this.state.collected || document.hidden) return;
    const ctx = this.context();
    if (!ctx.currentSceneId || ctx.isInputBlocked() || ctx.isBossFight()) return;
    if (held < TELEPORT_THROW.holdSeconds) this.placeDevice();
    else this.throwDevice(Math.min(1, (held - TELEPORT_THROW.holdSeconds) / TELEPORT_THROW.chargeSeconds));
  };

  private onBlur = () => { this.qDownAt = -1; };

  private throwDevice(charge: number) {
    const ctx = this.context(), direction = ctx.getAimDirection?.(), scene = ctx.getActiveScene();
    if (!direction || !scene) { this.placeDevice(); return; }
    this.cancelThrow();
    const origin = ctx.getPlayerPosition(), aim = new THREE.Vector3(direction.x, direction.y + 0.12, direction.z).normalize();
    const mesh = createTeleportCrystal(); mesh.scale.setScalar(1.4);
    mesh.position.set(origin.x, origin.y + 0.5, origin.z).addScaledVector(aim, 0.6);
    scene.add(mesh);
    this.thrown = { mesh, scene, sceneId: ctx.currentSceneId, rotation: ctx.getPlayerRotation(), age: 0,
      velocity: aim.multiplyScalar(THREE.MathUtils.lerp(TELEPORT_THROW.minSpeed, TELEPORT_THROW.maxSpeed, charge)) };
    this.showMessage('Crystal thrown!');
  }

  private cancelThrow() {
    if (!this.thrown) return;
    this.thrown.mesh.removeFromParent();
    this.thrown.mesh.traverse(node => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
    });
    this.thrown = null;
  }

  private updateThrow(dt: number) {
    const flight = this.thrown;
    if (!flight) return;
    const ctx = this.context();
    if (ctx.currentSceneId !== flight.sceneId || ctx.getActiveScene() !== flight.scene) { this.cancelThrow(); return; }
    const step = Math.min(dt, 0.05);
    flight.age += step; flight.velocity.y -= TELEPORT_THROW.gravity * step;
    const move = flight.velocity.clone().multiplyScalar(step), distance = move.length();
    if (distance > 1e-6) {
      this.raycaster.set(flight.mesh.position, move.clone().normalize()); this.raycaster.far = distance + 0.15;
      const hit = this.raycaster.intersectObject(flight.scene, true).find(({ object }) => {
        if (!object.visible || object.parent === flight.mesh || !(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return false;
        for (let node: THREE.Object3D | null = object; node; node = node.parent) {
          if (node === flight.mesh || node === this.placedMarker || !node.visible) return false;
        }
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        return !material.transparent || material.opacity > 0.5;
      });
      if (hit) {
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        if (normal.dot(move) > 0) normal.negate();
        if (normal.y > 0.6) { this.landThrow(hit.point); return; }
        flight.mesh.position.copy(hit.point).addScaledVector(normal, 0.12);
        flight.velocity.set(normal.x * 1.5, Math.min(flight.velocity.y, 0), normal.z * 1.5);
      } else flight.mesh.position.add(move);
    }
    flight.mesh.rotation.y += step * 8;
    if (flight.age > TELEPORT_THROW.maxFlight || flight.mesh.position.y < -60) {
      this.cancelThrow(); this.showMessage('The crystal was lost. Throw it again.');
    }
  }

  private landThrow(point: THREE.Vector3) {
    const flight = this.thrown!, ctx = this.context();
    const position = { x: point.x, y: point.y + ctx.getPlayerRadius(), z: point.z };
    const rotation = flight.rotation;
    this.cancelThrow();
    const rejected = ctx.canPlace?.(ctx.currentSceneId, position);
    if (rejected) { this.showMessage(rejected); return; }
    this.setMarker(ctx.currentSceneId, position, rotation);
    this.showMessage(ctx.placementMessage?.(ctx.currentSceneId, position)
      ?? 'Marker placed. Press T to return; hold Tab to choose weapons.');
  }

  private placeDevice() {
    const ctx = this.context();

    if (ctx.isBossFight()) {
      return;
    }

    if (!this.state.collected) {
      ctx.showMessage('Teleportation Device not acquired!');
      return;
    }

    const position = ctx.getPlayerPosition();
    const rotation = ctx.getPlayerRotation();
    const rejected = ctx.canPlace?.(ctx.currentSceneId, position);
    if (rejected) { ctx.showMessage(rejected); return; }

    this.setMarker(ctx.currentSceneId, position, rotation);
    ctx.showMessage(ctx.placementMessage?.(ctx.currentSceneId, position)
      ?? 'Marker placed. Press T to return; hold Tab to choose weapons.');
  }

  teleportToDevice() {
    const ctx = this.context();

    if (ctx.isBossFight()) {
      return;
    }

    if (!this.state.collected) {
      ctx.showMessage('Teleportation Device not acquired!');
      return;
    }

    const fixed = ctx.returnOverride?.();
    if (fixed) { ctx.onTeleport(fixed.sceneId, fixed.position, fixed.rotation); return; }

    if (!this.state.placed || !this.state.placementPosition || !this.state.placementScene) {
      ctx.showMessage('Device not placed yet! Press Q to place it.');
      return;
    }

    const error = ctx.returnError?.(this.getState());
    if (error) { ctx.showMessage(error); return; }

    ctx.onTeleport(
      this.state.placementScene,
      this.state.placementPosition,
      this.state.placementRotation ?? 0,
    );
  }

  /** Detach before a room disposes its resources; keep the saved destination. */
  detachMarker() { this.placedMarker?.removeFromParent(); }

  private createMarker() {
    const root = new THREE.Group(); root.name = 'TeleportAnchor';
    // Self-lit geometry keeps the purple glow without changing the room's light count.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xbd77ff, side: THREE.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    const gem = createTeleportCrystal();
    gem.name = 'TeleportAnchorGem'; gem.position.y = 0.32;
    root.add(ring, gem);
    this.placedMarker = root;
    return root;
  }

  update(dt: number) {
    this.time += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.updateThrow(Number.isFinite(dt) ? Math.max(0, dt) : 0);
    const ctx = this.context(), position = this.state.placementPosition;
    const scene = ctx.getActiveScene();
    if (!scene || !this.state.placed || !position || this.state.placementScene !== ctx.currentSceneId) {
      this.detachMarker(); return;
    }
    const marker = this.placedMarker ?? this.createMarker();
    if (marker.parent !== scene) scene.add(marker);
    marker.position.set(position.x, position.y - this.markerRadius + 0.06, position.z);
    const gem = marker.children[1];
    gem.rotation.y = this.time * 1.8;
    gem.position.y = 0.32 + Math.sin(this.time * 3) * 0.04;
  }

  private showMessage(message: string) {
    this.context().showMessage(message);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.cancelThrow();
    this.detachMarker();
    this.placedMarker?.traverse(node => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
    });
    this.placedMarker = null;
  }
}
