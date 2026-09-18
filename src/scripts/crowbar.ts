import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCrowbar } from './items/createCrowbar.js';
import { traceShot, type DamageTarget } from './pistol.js';
import type { Player } from './player.js';

interface FirstPersonHands {
  update: (attackProgress: number | null) => void;
  render: (renderer: THREE.WebGLRenderer) => void;
  dispose: () => void;
}

interface CrowbarContext {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  thirdPerson: boolean;
  hasCrowbar: boolean;
  targets: DamageTarget[];
  setCharacterEquipped: (equipped: boolean) => void;
  doorTarget: THREE.Object3D | null;
  openDoor: () => void;
  holsterOther?: () => void;
  firstPersonHands?: FirstPersonHands | null | (() => FirstPersonHands | null);
}

export class CrowbarController {
  readonly root = new THREE.Group();
  private equipped = false;
  private cooldown = 0;
  private swingTime = 0;
  private status: HTMLElement | null;

  constructor(private context: () => CrowbarContext) {
    this.root.name = 'PlayerCrowbar';
    this.root.add(createCrowbar());
    this.root.position.set(0.28, -0.28, -0.55);
    this.root.rotation.set(-0.45, 0.35, 0.35);
    this.root.visible = false;
    this.status = document.getElementById('weapon-status');
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onMouseDown);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyT' || event.repeat) return;
    const { player, hasCrowbar } = this.context();
    if (!hasCrowbar || !player?.isEnabled()) return;
    event.preventDefault();
    if (!this.equipped) this.context().holsterOther?.();
    this.equipped = !this.equipped;
    if (this.status) this.status.textContent = this.equipped
      ? 'T: holster | Left click: crowbar' : 'T: equip crowbar';
  };

  holster() {
    this.equipped = false;
    this.context().setCharacterEquipped(false);
  }

  equip() {
    const { player, hasCrowbar } = this.context();
    if (!hasCrowbar || !player?.isEnabled()) return;
    this.context().holsterOther?.();
    this.equipped = true;
    if (this.status) this.status.textContent = 'T: holster | Left click: crowbar';
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.button === 0 && document.pointerLockElement) this.swing();
  };

  private swing() {
    const { scene, camera, world, player, character, targets, doorTarget, openDoor } = this.context();
    if (!this.equipped || this.cooldown > 0 || !player?.isEnabled() || !scene || !camera) return false;
    player.requestAction('Sword_Attack');
    camera.updateMatrixWorld(true);
    const aim = new THREE.Raycaster();
    aim.setFromCamera(new THREE.Vector2(0, 0), camera);
    const reach = 1.8;
    const sight = traceShot(scene, world, aim.ray, targets, character ? [character, this.root] : [this.root], reach);
    // Door interaction is zone-based: a swing near the cafeteria door opens it
    // even when the crosshair is aimed at the surrounding wall or frame.
    openDoor();
    const hit = sight.target ? sight.target.damage(35) : false;

    if (world) {
      let closestBody: CANNON.Body | null = null;
      let closestDistance = reach;
      world.raycastAll(
        new CANNON.Vec3(aim.ray.origin.x, aim.ray.origin.y, aim.ray.origin.z),
        new CANNON.Vec3(sight.point.x, sight.point.y, sight.point.z),
        { skipBackfaces: false, checkCollisionResponse: true },
        result => {
          if (!result.body || result.body === player.body || result.body.mass <= 0) return;
          if (result.distance < closestDistance) {
            closestBody = result.body;
            closestDistance = result.distance;
          }
        },
      );
      if (closestBody) {
        const impulse = new CANNON.Vec3(aim.ray.direction.x * 3.5, 0.8, aim.ray.direction.z * 3.5);
        closestBody.applyImpulse(impulse, closestBody.position);
      }
    }

    this.cooldown = 0.28;
    this.swingTime = 0.16;
    if (this.status) this.status.dataset.hit = String(hit);
    return true;
  }

  update(dt: number) {
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.cooldown = Math.max(0, this.cooldown - frame);
    this.swingTime = Math.max(0, this.swingTime - frame);
    const { camera, player, thirdPerson, hasCrowbar, setCharacterEquipped, firstPersonHands: handsSource } = this.context();
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (!hasCrowbar) this.equipped = false;
    setCharacterEquipped(this.equipped);
    this.root.visible = this.equipped && !thirdPerson && !!player?.isEnabled();
    firstPersonHands?.update(this.swingTime > 0 ? 1 - this.swingTime / 0.16 : null);
    if (!camera || !this.root.visible) {
      this.root.removeFromParent();
      return;
    }
    if (this.root.parent !== camera) camera.add(this.root);
    const progress = this.swingTime > 0 ? 1 - this.swingTime / 0.16 : 1;
    this.root.rotation.set(-0.45 - Math.sin(Math.PI * progress) * 1.8, 0.35, 0.35);
  }

  renderFirstPerson(renderer: THREE.WebGLRenderer) {
    const { player, thirdPerson, hasCrowbar, firstPersonHands: handsSource } = this.context();
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (hasCrowbar && this.equipped && !thirdPerson && player?.isEnabled()) firstPersonHands?.render(renderer);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousedown', this.onMouseDown);
    this.root.removeFromParent();
    this.context().setCharacterEquipped(false);
  }
}
