import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel } from '../core/loader.js';
import type { Player } from './player.js';

export interface DamageTarget {
  root: THREE.Object3D;
  damage(amount: number): boolean;
}
interface WeaponContext {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  thirdPerson: boolean;
  targets: DamageTarget[];
  weaponAnimation?: {
    socket: THREE.Object3D | null;
    setEquipped(equipped: boolean): void;
    shoot(): void;
  };
  holsterOther?: () => void;
}
function belongsTo(object: THREE.Object3D, root: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}
function visible(object: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Nearest surface wins. Damage is dispatched only to explicitly registered NPCs. */
export function traceShot(scene: THREE.Scene, world: CANNON.World | null, ray: THREE.Ray,
  targets: DamageTarget[], ignored: THREE.Object3D[] = [], range = 100) {
  scene.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0, range);
  const hits = raycaster.intersectObjects(scene.children, true).filter(hit => {
    if (!visible(hit.object) || ignored.some(root => belongsTo(hit.object, root))) return false;
    if (!(hit.object instanceof THREE.Mesh)) return false;
    const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
    return materials.some(material => material.visible && (!material.transparent || material.opacity >= 0.5));
  });
  const first = hits[0];
  let distance = first?.distance ?? range;
  let target = first && targets.find(candidate => belongsTo(first.object, candidate.root));
  // Static physics also blocks rays from the back of a single-sided wall and through glass rails.
  world?.raycastAll(new CANNON.Vec3(ray.origin.x, ray.origin.y, ray.origin.z),
    new CANNON.Vec3(ray.origin.x + ray.direction.x * range, ray.origin.y + ray.direction.y * range, ray.origin.z + ray.direction.z * range),
    { skipBackfaces: false, checkCollisionResponse: true }, hit => {
      if (hit.body?.type === CANNON.Body.STATIC && hit.distance < distance - 0.001) {
        distance = hit.distance;
        target = undefined;
      }
    });
  return { point: ray.at(distance, new THREE.Vector3()), target, object: first?.object ?? null };
}

/** One input owner and one weapon instance for the entire application. */
export class PistolController {
  readonly ready: Promise<void>;
  readonly root = new THREE.Group();
  private equipped = false;
  private loaded = false;
  private disposed = false;
  private cooldown = 0;
  private recoil = 0;
  private hitTime = 0;
  private flash = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffdd77 }));
  private beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.85, depthWrite: false }));
  private beamLife = 0;
  private crosshair: HTMLElement | null;
  private status: HTMLElement | null;

  constructor(private context: () => WeaponContext, load = () => loadToolModel('Gun_Revolver')) {
    this.root.name = 'PlayerPistol';
    this.root.visible = false;
    this.flash.position.set(0, 0.12, -0.38);
    this.flash.visible = false;
    this.root.add(this.flash);
    this.beam.visible = false;
    this.beam.renderOrder = 999;
    this.crosshair = document.getElementById('crosshair');
    this.status = document.getElementById('weapon-status');
    this.ready = load().then(gltf => {
      if (this.disposed) return;
      // Same modeling convention as Gun_Pistol: barrel points along local -X; aim it down local -Z.
      gltf.scene.rotation.y = -Math.PI / 2;
      gltf.scene.position.y = 0.02;
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) object.castShadow = true;
      });
      this.root.add(gltf.scene);
      this.loaded = true;
      this.updateStatus();
    }).catch(error => {
      console.error('[Pistol] Load failed:', error);
      if (this.status) this.status.textContent = 'Pistol unavailable';
    });
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('blur', this.clearFeedback);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyK' || event.repeat || !this.context().player?.isEnabled()) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    if (!this.equipped) this.context().holsterOther?.();
    this.equipped = !this.equipped;
    this.context().weaponAnimation?.setEquipped(this.equipped && this.loaded);
    this.updateStatus();
  };

  private onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !document.pointerLockElement) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea')) return;
    this.shoot();
  };

  private updateStatus() {
    if (this.status) this.status.textContent = this.equipped
      ? (this.loaded ? 'K: holster | Left click: shoot' : 'Loading pistol...') : 'K: equip pistol';
  }

  holster() {
    this.equipped = false;
    this.context().weaponAnimation?.setEquipped(false);
    this.updateStatus();
  }

  shoot() {
    const { scene, camera, world, player, character, targets, weaponAnimation } = this.context();
    if (!this.equipped || !this.loaded || this.cooldown > 0 || !player?.isEnabled() || !scene || !camera) return false;
    this.update(0);
    camera.updateMatrixWorld(true);
    const aim = new THREE.Raycaster();
    aim.setFromCamera(new THREE.Vector2(0, 0), camera);
    const ignored = character ? [character, this.root] : [this.root];
    const sight = traceShot(scene, world, aim.ray, targets, ignored);
    // Check from the physical muzzle too, so third-person aiming cannot shoot around cover.
    const origin = this.flash.getWorldPosition(new THREE.Vector3());
    const direction = sight.point.clone().sub(origin);
    const shot = traceShot(scene, world, new THREE.Ray(origin, direction.clone().normalize()), targets, ignored, direction.length() + 0.05);
    const hit = shot.target?.damage(25) ?? false;
    weaponAnimation?.shoot();
    this.cooldown = 0.2;
    this.recoil = 0.1;
    this.hitTime = hit ? 0.15 : 0;
    this.flash.visible = true;
    this.fireBeam(scene, origin, shot.point);
    if (this.crosshair) this.crosshair.dataset.hit = String(hit);
    return true;
  }

  /** Stretches the laser mesh from the muzzle to the impact point for a short flash. */
  private fireBeam(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3) {
    if (this.beam.parent !== scene) scene.add(this.beam);
    const offset = new THREE.Vector3().subVectors(to, from);
    const length = Math.max(offset.length(), 0.01);
    this.beam.position.copy(from).addScaledVector(offset, 0.5);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), offset.normalize());
    this.beam.scale.set(1, length, 1);
    this.beam.visible = true;
    this.beamLife = 0.06;
  }

  update(dt: number) {
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.cooldown = Math.max(0, this.cooldown - frame);
    this.recoil = Math.max(0, this.recoil - frame);
    this.hitTime = Math.max(0, this.hitTime - frame);
    if (this.crosshair && !this.hitTime) this.crosshair.dataset.hit = 'false';
    this.flash.visible = this.recoil > 0.065;
    this.beamLife = Math.max(0, this.beamLife - frame);
    this.beam.visible = this.beamLife > 0;
    const { scene, camera, player, thirdPerson, weaponAnimation } = this.context();
    this.root.visible = this.loaded && this.equipped && !!player?.isEnabled();
    weaponAnimation?.setEquipped(this.root.visible);
    if (!scene || !camera || !this.root.visible) { this.root.removeFromParent(); this.beam.removeFromParent(); return; }
    camera.updateMatrixWorld(true);
    const socket = thirdPerson ? weaponAnimation?.socket : null;
    if (socket) {
      if (this.root.parent !== socket) socket.add(this.root);
      this.root.position.set(0, 0, 0);
      this.root.quaternion.identity();
    } else {
      if (this.root.parent !== scene) scene.add(this.root);
      this.root.position.set(0.24, -0.24, -0.48 + this.recoil * 0.4).applyMatrix4(camera.matrixWorld);
      camera.getWorldQuaternion(this.root.quaternion);
      this.root.rotateX(this.recoil * 0.7);
    }
    this.root.updateWorldMatrix(true, true);
  }

  private clearFeedback = () => {
    this.recoil = 0;
    this.hitTime = 0;
    this.flash.visible = false;
    this.beamLife = 0;
    this.beam.visible = false;
    if (this.crosshair) this.crosshair.dataset.hit = 'false';
  };
  private onPointerLockChange = () => { if (!document.pointerLockElement) this.clearFeedback(); };

  dispose() {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('blur', this.clearFeedback);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.root.removeFromParent();
    this.beam.removeFromParent();
    this.context().weaponAnimation?.setEquipped(false);
    this.clearFeedback();
  }
}
