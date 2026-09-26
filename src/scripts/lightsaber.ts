import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createLightsaber } from './items/createLightsaber.js';
import { traceShot, type DamageTarget } from './pistol.js';
import type { Player } from './player.js';
import { LightsaberAudio } from './lightsaberAudio.js';
import { registerTouchAttackCallback, refreshTouchAttackButton } from './touchControls.js';

interface FirstPersonHands {
  update: (attackProgress: number | null) => void;
  render: (renderer: THREE.WebGLRenderer) => void;
  dispose: () => void;
}

interface LightsaberContext {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  thirdPerson: boolean;
  hasLightsaber: boolean;
  targets: DamageTarget[];
  setCharacterEquipped: (equipped: boolean) => void;
  doorTarget: THREE.Object3D | null;
  openDoor: () => void;
  holsterOther?: () => void;
  firstPersonHands?: FirstPersonHands | null | (() => FirstPersonHands | null);
}

export class LightsaberController {
  readonly root = new THREE.Group();
  private equipped = false;
  private cooldown = 0;
  private swingTime = 0;
  private status: HTMLElement | null;
  private unregisterTouchAttack: () => void;
  private audio: LightsaberAudio;
  private humActive = false;

  constructor(private context: () => LightsaberContext) {
    this.root.name = 'PlayerLightsaber';
    this.root.add(createLightsaber());
    this.root.position.set(0.3, -0.25, -0.5);
    this.root.rotation.set(-0.3, 0.2, 0.4);
    this.root.visible = false;
    this.status = document.getElementById('weapon-status');
    this.audio = new LightsaberAudio();
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onMouseDown);
    this.unregisterTouchAttack = registerTouchAttackCallback(() => this.swing(), () => this.equipped ? 'SLASH' : null);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyL' || event.repeat) return;
    const { player, hasLightsaber } = this.context();
    if (!hasLightsaber || !player?.isEnabled()) return;
    event.preventDefault();
    if (!this.equipped) {
      this.context().holsterOther?.();
      this.equip();
    } else {
      this.holster();
    }
  };

  holster() {
    if (this.equipped) {
      this.audio.stopHum();
      this.humActive = false;
    }
    this.equipped = false;
    refreshTouchAttackButton();
    this.context().setCharacterEquipped(false);
    if (this.status) this.status.textContent = 'L: equip lightsaber';
  }

  equip() {
    const { player, hasLightsaber } = this.context();
    if (!hasLightsaber || !player?.isEnabled()) return;
    this.context().holsterOther?.();
    this.equipped = true;
    this.audio.playIgnite();
    setTimeout(() => {
      if (this.equipped) {
        this.audio.startHum();
        this.humActive = true;
      }
    }, 600);
    refreshTouchAttackButton();
    if (this.status) this.status.textContent = 'L: holster | Left click: slash';
  }

  private onMouseDown = (event: MouseEvent) => {
    const touchActive = (window as any).__touchActive === true;
    if (event.button === 0 && (document.pointerLockElement || touchActive)) this.swing();
  };

  private swing() {
    const { scene, camera, world, player, character, targets, doorTarget, openDoor } = this.context();
    if (!this.equipped || this.cooldown > 0 || !player?.isEnabled() || player.getState().climbing || player.getState().ventMode || player.getState().boxHandling || !scene || !camera) return false;
    player.requestAction('Sword_Attack');
    this.audio.playSwing();
    camera.updateMatrixWorld(true);
    const aim = new THREE.Raycaster();
    aim.setFromCamera(new THREE.Vector2(0, 0), camera);
    const reach = 2.2; // Lightsaber has longer reach than crowbar
    const ignored = character ? [character, this.root] : [this.root];
    const origin = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    const sight = traceShot(scene, world, aim.ray, targets, ignored, reach + camera.position.distanceTo(origin));
    const direction = sight.point.clone().sub(origin);
    const strike = direction.length() <= reach
      ? traceShot(scene, world, new THREE.Ray(origin, direction.clone().normalize()), targets, ignored, direction.length() + 0.03)
      : null;
    openDoor();
    const hit = strike?.target?.damage(50, 'lightsaber') ?? false; // Higher damage than crowbar
    if (hit) this.audio.playClash();

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
        const impulse = new CANNON.Vec3(aim.ray.direction.x * 5, 1.2, aim.ray.direction.z * 5);
        closest.body.applyImpulse(impulse);
      }
    }

    this.cooldown = 0.35;
    this.swingTime = 0.2;
    if (this.status) this.status.dataset.hit = String(hit);
    return true;
  }

  update(dt: number) {
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.cooldown = Math.max(0, this.cooldown - frame);
    this.swingTime = Math.max(0, this.swingTime - frame);
    const { camera, player, thirdPerson, hasLightsaber, setCharacterEquipped, firstPersonHands: handsSource } = this.context();
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (!hasLightsaber && this.equipped) {
      this.holster();
    }
    const usable = !!player?.isEnabled() && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling;
    setCharacterEquipped(this.equipped && usable);
    this.root.visible = this.equipped && !thirdPerson && usable;
    firstPersonHands?.update(this.swingTime > 0 ? 1 - this.swingTime / 0.2 : null);
    if (!camera || !this.root.visible) {
      this.root.removeFromParent();
      return;
    }
    if (this.root.parent !== camera) camera.add(this.root);
    const progress = this.swingTime > 0 ? 1 - this.swingTime / 0.2 : 1;
    this.root.rotation.set(-0.3 - Math.sin(Math.PI * progress) * 2.0, 0.2, 0.4);
  }

  renderFirstPerson(renderer: THREE.WebGLRenderer) {
    const { player, thirdPerson, hasLightsaber, firstPersonHands: handsSource } = this.context();
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (hasLightsaber && this.equipped && !thirdPerson && player?.isEnabled() && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling) firstPersonHands?.render(renderer);
  }

  dispose() {
    this.unregisterTouchAttack();
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousedown', this.onMouseDown);
    this.audio.dispose();
    this.root.removeFromParent();
    this.context().setCharacterEquipped(false);
  }
}
