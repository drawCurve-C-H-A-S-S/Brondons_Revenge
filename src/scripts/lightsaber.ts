import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createLightsaber, disposeLightsaber, LIGHTSABER_SWING_DURATION, type LightsaberAttackName } from './items/createLightsaber.js';
import { traceShot, type DamageTarget } from './pistol.js';
import type { Player } from './player.js';
import { LightsaberAudio } from './lightsaberAudio.js';
import { registerTouchAttackCallback, refreshTouchAttackButton } from './touchControls.js';

/** Projectile that the lightsaber can deflect during a well-timed swing. */
export interface ParryableBolt {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  parried: boolean;
  owner: 'boss' | 'player';
}

const PARRY_RANGE = 3;
const PARRY_PERFECT_SECONDS = 0.14;
const PARRY_TOTAL_SECONDS = 0.24;
export const PARRY_DAMAGE = 50;

interface LightsaberContext {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  thirdPerson: boolean;
  hasLightsaber: boolean;
  attackClips?: readonly LightsaberAttackName[];
  targets: DamageTarget[];
  setCharacterEquipped: (equipped: boolean) => void;
  openDoor: () => void;
  holsterOther?: () => void;
  getParryableBolts?: () => ParryableBolt[];
}

export class LightsaberController {
  readonly root = new THREE.Group();
  private equipped = false;
  private disposed = false;
  private cooldown = 0;
  private swingTime = 0;
  private swingIndex = -1;
  private attackClip: LightsaberAttackName = 'Sword_Attack';
  private ignitionTime = 0;
  private parryWindow = 0;
  private parryPerfect = false;
  private parryFlash = 0;
  private unregisterTouchAttack: () => void;
  private audio = new LightsaberAudio();

  constructor(private context: () => LightsaberContext) {
    this.root.name = 'PlayerLightsaber';
    this.root.add(createLightsaber());
    this.root.visible = false;
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousedown', this.onMouseDown);
    this.unregisterTouchAttack = registerTouchAttackCallback(() => this.swing(), () => this.equipped ? 'SLASH' : null);
  }

  private inputBlocked() { return this.disposed || document.hidden || document.body.classList.contains('quick-menu-open'); }
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyL' || event.repeat || this.inputBlocked()) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    const { player, hasLightsaber } = this.context();
    if (!hasLightsaber || !player?.isEnabled()) return;
    event.preventDefault();
    if (this.equipped) this.holster(); else this.equip();
  };

  holster() {
    this.equipped = false;
    this.ignitionTime = this.swingTime = 0;
    this.detach();
    refreshTouchAttackButton();
    this.context().setCharacterEquipped(false);
  }

  equip() {
    const { player, hasLightsaber } = this.context();
    if (this.disposed || this.equipped || !hasLightsaber || !player?.isEnabled()) return;
    this.context().holsterOther?.();
    this.equipped = true;
    this.audio.playIgnite();
    this.ignitionTime = 0.6;
    refreshTouchAttackButton();
  }

  /** Detach persistent presentation before an outgoing room disposes its meshes. */
  detach() {
    this.audio.stopHum();
    this.root.visible = false;
    this.root.removeFromParent();
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea')) return;
    const touchActive = (window as any).__touchActive === true;
    if (event.button === 0 && (document.pointerLockElement || touchActive)) this.swing();
  };

  private swing() {
    const { scene, camera, world, player, character, targets, openDoor, attackClips } = this.context();
    if (this.inputBlocked() || !this.equipped || this.cooldown > 0 || !player?.isEnabled() || player.getHealth() <= 0
      || player.getState().climbing || player.getState().ventMode || player.getState().boxHandling || !scene || !camera) return false;
    this.swingIndex++;
    this.attackClip = attackClips?.length ? attackClips[this.swingIndex % attackClips.length] : 'Sword_Attack';
    player.requestAction(this.attackClip);
    this.audio.playSwing();
    camera.updateMatrixWorld(true);
    const aim = new THREE.Raycaster();
    aim.setFromCamera(new THREE.Vector2(0, 0), camera);
    const reach = 1.8;
    const ignored = character ? [character, this.root] : [this.root];
    const origin = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    const sight = traceShot(scene, world, aim.ray, targets, ignored, reach + camera.position.distanceTo(origin));
    const direction = sight.point.clone().sub(origin);
    const distance = direction.length();
    const strike = distance > 0.001 && distance <= reach
      ? traceShot(scene, world, new THREE.Ray(origin, direction.clone().normalize()), targets, ignored, distance + 0.03)
      : null;
    openDoor();
    const hit = strike?.target?.damage(35, 'lightsaber') ?? false;
    if (hit) this.audio.playClash();

    if (world && distance > 0.001) {
      const closest: { body: CANNON.Body | null; distance: number } = { body: null, distance: Math.min(reach, distance) + 0.03 };
      const end = origin.clone().addScaledVector(direction.clone().normalize(), Math.min(reach, distance) + 0.03);
      world.raycastAll(new CANNON.Vec3(origin.x, origin.y, origin.z), new CANNON.Vec3(end.x, end.y, end.z),
        { skipBackfaces: false, checkCollisionResponse: true }, result => {
          if (!result.body || result.body === player.body || result.body.mass <= 0) return;
          if (result.distance < closest.distance) { closest.body = result.body; closest.distance = result.distance; }
        });
      if (closest.body) closest.body.applyImpulse(new CANNON.Vec3(aim.ray.direction.x * 3.5, 0.8, aim.ray.direction.z * 3.5));
    }
    this.cooldown = 0.28;
    this.swingTime = LIGHTSABER_SWING_DURATION;
    this.parryWindow = PARRY_TOTAL_SECONDS;
    this.parryPerfect = true;
    return true;
  }

  update(dt: number) {
    if (this.disposed) return;
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.cooldown = Math.max(0, this.cooldown - frame);
    this.swingTime = Math.max(0, this.swingTime - frame);
    this.parryFlash = Math.max(0, this.parryFlash - frame);
    if (this.parryWindow > 0) {
      this.parryWindow = Math.max(0, this.parryWindow - frame);
      if (this.parryWindow <= 0) this.parryPerfect = false;
      this.checkParry();
    }
    const { scene, camera, player, thirdPerson, hasLightsaber, setCharacterEquipped } = this.context();
    if (!hasLightsaber && this.equipped) this.holster();
    const usable = !!player?.isEnabled() && player.getHealth() > 0 && !player.getState().climbing
      && !player.getState().ventMode && !player.getState().boxHandling;
    const active = this.equipped && usable;
    setCharacterEquipped(active);
    if (active) {
      this.ignitionTime = Math.max(0, this.ignitionTime - frame);
      if (this.ignitionTime === 0) this.audio.startHum();
    } else this.audio.stopHum();
    this.root.visible = active && !thirdPerson;
    if (!scene || !camera || !this.root.visible) { this.root.removeFromParent(); return; }
    camera.updateMatrixWorld(true);
    scene.add(this.root);
    this.root.position.set(0.3, -0.25, -0.5).applyMatrix4(camera.matrixWorld);
    camera.getWorldQuaternion(this.root.quaternion);
    const progress = this.swingTime > 0 ? 1 - this.swingTime / LIGHTSABER_SWING_DURATION : 1;
    const arc = Math.sin(Math.PI * progress);
    const side = this.swingIndex % 2 === 0 ? 1 : -1;
    this.root.rotateX(-0.3 - arc * (this.swingIndex % 3 === 2 ? 1.9 : 0.9));
    this.root.rotateY(0.2 + side * arc * 0.7);
    this.root.rotateZ(0.4 + side * arc * 1.1);
  }

  dispose() {
    if (this.disposed) return;
    this.holster();
    this.disposed = true;
    this.unregisterTouchAttack();
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousedown', this.onMouseDown);
    this.audio.dispose();
    disposeLightsaber(this.root);
  }

  private checkParry() {
    const { player, getParryableBolts } = this.context();
    if (!player || !getParryableBolts || this.parryWindow <= 0) return;
    const bolts = getParryableBolts();
    if (!bolts.length) return;
    const origin = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    for (const bolt of bolts) {
      if (bolt.parried) continue;
      const boltPos = bolt.mesh.position;
      const toBolt = boltPos.clone().sub(origin);
      const distance = toBolt.length();
      if (distance > PARRY_RANGE) continue;
      const toPlayer = origin.clone().sub(boltPos).normalize();
      const boltDir = bolt.velocity.clone().normalize();
      if (boltDir.dot(toPlayer) < 0.15) continue;
      const perfect = this.parryPerfect && distance < PARRY_RANGE * 0.6;
      bolt.parried = true;
      bolt.owner = 'player';
      if (perfect) {
        bolt.velocity.negate();
        bolt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bolt.velocity.clone().normalize());
      } else {
        bolt.velocity.negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 36);
        bolt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bolt.velocity.clone().normalize());
      }
      this.parryWindow = 0;
      this.parryFlash = 0.3;
      this.audio.playParry();
      return;
    }
  }
}
