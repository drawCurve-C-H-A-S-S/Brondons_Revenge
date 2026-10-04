import * as THREE from 'three';

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
  getPlayerPosition: () => { x: number; y: number; z: number };
  getPlayerRotation: () => number;
  onTeleport: (sceneId: string, position: { x: number; y: number; z: number }, rotation: number) => void;
  onPlace: (sceneId: string, position: { x: number; y: number; z: number }, rotation: number) => void;
  showMessage: (message: string) => void;
}

export class TeleportationDeviceController {
  private state: TeleportationDeviceState;
  private context: () => TeleportationDeviceContext;
  private deviceMesh: THREE.Mesh | null = null;
  private deviceLight: THREE.PointLight | null = null;
  private placedMarkerMesh: THREE.Mesh | null = null;
  private placedMarkerLight: THREE.PointLight | null = null;

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
    return { ...this.state };
  }

  isCollected() {
    return this.state.collected;
  }

  isPlaced() {
    return this.state.placed;
  }

  collect() {
    this.state.collected = true;
    this.showMessage('Teleportation Device acquired! Press Q to place, Tab to teleport.');
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || !this.state.collected) return;
    if (document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;

    const ctx = this.context();
    if (!ctx.currentSceneId) return;

    if (event.code === 'KeyQ') {
      event.preventDefault();
      this.placeDevice();
    } else if (event.code === 'Tab') {
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

    ctx.onPlace(ctx.currentSceneId, position, rotation);
    ctx.showMessage(`Device placed in ${ctx.currentSceneId}! Press Tab to teleport back.`);
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

  createDeviceMesh(scene: THREE.Scene, position: THREE.Vector3) {
    if (this.deviceMesh) return;

    const geometry = new THREE.OctahedronGeometry(0.3, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x9b59b6,
      emissive: 0x8e44ad,
      emissiveIntensity: 1.5,
      metalness: 0.7,
      roughness: 0.3,
      transparent: true,
      opacity: 0.9,
    });

    this.deviceMesh = new THREE.Mesh(geometry, material);
    this.deviceMesh.position.copy(position);
    this.deviceMesh.castShadow = true;
    scene.add(this.deviceMesh);

    this.deviceLight = new THREE.PointLight(0x8e44ad, 2, 4);
    this.deviceLight.position.copy(position);
    scene.add(this.deviceLight);
  }

  createPlacedMarker(scene: THREE.Scene, position: THREE.Vector3) {
    this.removePlacedMarker();

    const geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0x9b59b6,
      emissive: 0x8e44ad,
      emissiveIntensity: 2,
      metalness: 0.5,
      roughness: 0.4,
      transparent: true,
      opacity: 0.7,
    });

    this.placedMarkerMesh = new THREE.Mesh(geometry, material);
    this.placedMarkerMesh.position.set(position.x, position.y - 0.9, position.z);
    this.placedMarkerMesh.rotation.x = Math.PI / 2;
    scene.add(this.placedMarkerMesh);

    this.placedMarkerLight = new THREE.PointLight(0x8e44ad, 1.5, 3);
    this.placedMarkerLight.position.set(position.x, position.y - 0.5, position.z);
    scene.add(this.placedMarkerLight);
  }

  removePlacedMarker() {
    if (this.placedMarkerMesh) {
      this.placedMarkerMesh.removeFromParent();
      this.placedMarkerMesh.geometry.dispose();
      (this.placedMarkerMesh.material as THREE.Material).dispose();
      this.placedMarkerMesh = null;
    }
    if (this.placedMarkerLight) {
      this.placedMarkerLight.removeFromParent();
      this.placedMarkerLight = null;
    }
  }

  update(dt: number) {
    const t = performance.now() * 0.001;

    if (this.deviceMesh && this.deviceMesh.visible) {
      this.deviceMesh.rotation.y = t * 1.5;
      this.deviceMesh.rotation.x = Math.sin(t * 2) * 0.2;
      this.deviceMesh.position.y += Math.sin(t * 2.5) * 0.001;
      if (this.deviceMesh.material instanceof THREE.MeshStandardMaterial) {
        this.deviceMesh.material.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.3;
      }
    }

    if (this.placedMarkerMesh && this.placedMarkerMesh.visible) {
      this.placedMarkerMesh.rotation.z = t * 2;
      if (this.placedMarkerMesh.material instanceof THREE.MeshStandardMaterial) {
        this.placedMarkerMesh.material.emissiveIntensity = 1.5 + Math.sin(t * 4) * 0.5;
      }
    }
  }

  private showMessage(message: string) {
    this.context().showMessage(message);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.deviceMesh) {
      this.deviceMesh.removeFromParent();
      this.deviceMesh.geometry.dispose();
      (this.deviceMesh.material as THREE.Material).dispose();
      this.deviceMesh = null;
    }
    if (this.deviceLight) {
      this.deviceLight.removeFromParent();
      this.deviceLight = null;
    }
    this.removePlacedMarker();
  }
}
