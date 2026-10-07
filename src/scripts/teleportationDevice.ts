import * as THREE from 'three';
import type { Player, PlayerTransitionState } from './player.js';

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
  onTeleport: (sceneId: string, position: { x: number; y: number; z: number }, rotation: number) => void;
  showMessage: (message: string) => void;
}

export class TeleportationDeviceController {
  private state: TeleportationDeviceState;
  private context: () => TeleportationDeviceContext;
  private placedMarker: THREE.Group | null = null;
  private markerRadius = 0.3;
  private time = 0;

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
    if (announce) this.showMessage('Teleportation Device acquired! Q: place / T: teleport.');
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || !this.state.collected) return;
    if (document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;

    const ctx = this.context();
    if (!ctx.currentSceneId || ctx.isInputBlocked()) return;

    if (event.code === 'KeyQ') {
      event.preventDefault();
      this.placeDevice();
    } else if (event.code === 'KeyT') {
      event.preventDefault();
      this.teleportToDevice();
    }
  };

  private placeDevice() {
    const ctx = this.context();

    if (ctx.isBossFight()) {
      ctx.showMessage('Cannot place device during boss fight!');
      return;
    }

    if (!this.state.collected) {
      ctx.showMessage('Teleportation Device not acquired!');
      return;
    }

    const position = ctx.getPlayerPosition();
    const rotation = ctx.getPlayerRotation();

    this.state.placed = true;
    this.state.placementScene = ctx.currentSceneId;
    this.state.placementPosition = { ...position };
    this.state.placementRotation = rotation;
    this.markerRadius = ctx.getPlayerRadius();
    this.update(0);
    ctx.showMessage('Device placed. Press T to teleport back.');
  }

  private teleportToDevice() {
    const ctx = this.context();

    if (ctx.isBossFight()) {
      ctx.showMessage('Cannot teleport during boss fight!');
      return;
    }

    if (!this.state.collected) {
      ctx.showMessage('Teleportation Device not acquired!');
      return;
    }

    if (!this.state.placed || !this.state.placementPosition || !this.state.placementScene) {
      ctx.showMessage('Device not placed yet! Press Q to place it.');
      return;
    }

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
    // Unlit geometry gives a purple glow without changing the room's light count.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.27, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xbd77ff, side: THREE.DoubleSide, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18),
      new THREE.MeshBasicMaterial({ color: 0xbd77ff, wireframe: true, toneMapped: false }));
    gem.name = 'TeleportAnchorGem'; gem.position.y = 0.32;
    root.add(ring, gem);
    this.placedMarker = root;
    return root;
  }

  update(dt: number) {
    this.time += Number.isFinite(dt) ? Math.max(0, dt) : 0;
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
    this.detachMarker();
    this.placedMarker?.traverse(node => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (node.material as THREE.Material).dispose(); }
    });
    this.placedMarker = null;
  }
}
