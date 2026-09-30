import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCrowbar } from './items/createCrowbar.js';
import { traceShot, type DamageTarget } from './pistol.js';
import type { Player } from './player.js';
import { registerTouchAttackCallback, refreshTouchAttackButton } from './touchControls.js';

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
  private unregisterTouchAttack: () => void;

  constructor(private context: () => CrowbarContext) {
    this.root.name = 'PlayerCrowbar';
    this.root.add(createCrowbar());
    this.root.position.set(0.28, -0.28, -0.55);
    this.root.rotation.set(-0.45, 0.35, 0.35);
    this.root.visible = false;
    this.status = document.getElementById('weapon-status');
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onMouseDown);
    this.unregisterTouchAttack = registerTouchAttackCallback(() => this.swing(), () => this.equipped ? 'SWING' : null);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyT' || event.repeat) return;
    const { player, hasCrowbar } = this.context();
    if (!hasCrowbar || !player?.isEnabled()) return;
    event.preventDefault();
    if (!this.equipped) this.context().holsterOther?.();
    this.equipped = !this.equipped;
    refreshTouchAttackButton();
    if (this.status) this.status.textContent = this.equipped
      ? 'T: holster | Left click: crowbar' : 'T: equip crowbar';
  };

  holster() {
    this.equipped = false;
    refreshTouchAttackButton();
    this.context().setCharacterEquipped(false);
  }

  equip() {
    const { player, hasCrowbar } = this.context();
    if (!hasCrowbar || !player?.isEnabled()) return;
    this.context().holsterOther?.();
    this.equipped = true;
    refreshTouchAttackButton();
    if (this.status) this.status.textContent = 'T: holster | Left click: crowbar';
  }

  private onMouseDown = (event: MouseEvent) => {
    const touchActive = (window as any).__touchActive === true;
    if (event.button === 0 && (document.pointerLockElement || touchActive)) this.swing();
  };

  private swing() {
    const { scene, camera, world, player, character, targets, doorTarget, openDoor } = this.context();
    if (!this.equipped || this.cooldown > 0 || !player?.isEnabled() || player.getState().climbing || player.getState().ventMode || player.getState().boxHandling || !scene || !camera) return false;
    player.requestAction('Sword_Attack');
    camera.updateMatrixWorld(true);
    const aim = new THREE.Raycaster();
    aim.setFromCamera(new THREE.Vector2(0, 0), camera);
    const reach = 1.8;
    const ignored = character ? [character, this.root] : [this.root];
    const origin = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    const sight = traceShot(scene, world, aim.ray, targets, ignored, reach + camera.position.distanceTo(origin));
    const direction = sight.point.clone().sub(origin);
    const strike = direction.length() <= reach
      ? traceShot(scene, world, new THREE.Ray(origin, direction.clone().normalize()), targets, ignored, direction.length() + 0.03)
      : null;
    // Door interaction is zone-based: a swing near the cafeteria door opens it
    // even when the crosshair is aimed at the surrounding wall or frame.
    openDoor();
    const hit = strike?.target?.damage(35, 'crowbar') ?? false;

    if (world) {
      const closest: { body: CANNON.Body | null; distance: number } = { body: null, distance: reach };
      const end = origin.clone().addScaledVector(direction.clone().normalize(), Math.min(reach, direction.length()));
      world.raycastAll(
        new CANNON.Vec3(origin.x, origin.y, origin.z),
        new CANNON.Vec3(end.x, end.y, end.z),
        { skipBackfaces: false, checkCollisionResponse: true },
        result => {
          if (!result.body || result.body === player.body || result.body.mass <= 0) return;
          if (result.distance < closest.distance) {
            closest.body = result.body;
            closest.distance = result.distance;
          }
        },
      );
      if (closest.body) {
        const impulse = new CANNON.Vec3(aim.ray.direction.x * 3.5, 0.8, aim.ray.direction.z * 3.5);
        closest.body.applyImpulse(impulse);
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
    if (!hasCrowbar && this.equipped) { this.equipped = false; refreshTouchAttackButton(); }
    const usable = !!player?.isEnabled() && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling;
    setCharacterEquipped(this.equipped && usable);
    this.root.visible = this.equipped && !thirdPerson && usable;
    if (this.equipped && usable && !thirdPerson) firstPersonHands?.update(this.swingTime > 0 ? 1 - this.swingTime / 0.16 : null);
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
    if (hasCrowbar && this.equipped && !thirdPerson && player?.isEnabled() && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling) firstPersonHands?.render(renderer);
  }

  dispose() {
    this.unregisterTouchAttack();
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousedown', this.onMouseDown);
    this.root.removeFromParent();
    this.context().setCharacterEquipped(false);
  }
}
