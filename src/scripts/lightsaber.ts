import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createLightsaber, disposeLightsaber, LIGHTSABER_SWING_DURATION } from './items/createLightsaber.js';
import type { DamageTarget } from './pistol.js';
import { MeleeSwing, getWeaponSegment, type MeleeSegment } from './melee.js';
import type { Player } from './player.js';
import { LightsaberAudio } from './lightsaberAudio.js';
import { registerTouchAttackCallback, refreshTouchAttackButton } from './touchControls.js';
import { isControllerEvent } from './gamepadInput.js';
import {
  directionalSwordAttack, MELEE_STRIKES, SWORD_ATTACK_CLIPS, swordHitWindows, type PlayerSwordStrike,
} from './finaleChoreography.js';

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
  attackClips?: readonly THREE.AnimationClip[];
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
  private melee = new MeleeSwing('lightsaber');
  private swingPlayer: Player | null = null;
  private swingIndex = -1;
  private attackMove: PlayerSwordStrike = 'slash';
  private swingDuration = LIGHTSABER_SWING_DURATION;
  private comboTime = 0;
  private queuedDirection: { x: number; y: number } | null = null;
  private activeWindow = -1;
  private previousSegment: MeleeSegment | null = null;
  private viewFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  private viewRotation = new THREE.Quaternion();
  private sourceRotation = new THREE.Quaternion();
  private cameraPosition = new THREE.Vector3();
  private characterPosition = new THREE.Vector3();
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
    document.addEventListener('mousedown', this.onMouseDown);
    this.unregisterTouchAttack = registerTouchAttackCallback(() => this.swing(), () => this.equipped ? 'SLASH' : null);
  }

  private inputBlocked() { return this.disposed || document.hidden || document.body.classList.contains('quick-menu-open'); }
  isEquipped() { return this.equipped; }

  holster() {
    this.equipped = false;
    this.ignitionTime = this.swingTime = this.cooldown = this.comboTime = 0;
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
    this.swingTime = this.cooldown = this.comboTime = this.parryWindow = 0;
    this.parryPerfect = false;
    this.swingPlayer = null;
    this.queuedDirection = null;
    this.previousSegment = null;
    this.activeWindow = -1;
    this.melee.reset();
    this.root.visible = false;
    this.root.removeFromParent();
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea')) return;
    const touchActive = (window as any).__touchActive === true;
    if (event.button === 0 && (document.pointerLockElement || touchActive || isControllerEvent(event))) this.swing();
  };

  private swing(direction?: { x: number; y: number }) {
    const { scene, camera, player, character, attackClips } = this.context();
    if (this.inputBlocked() || !this.equipped || !player?.isEnabled() || player.getHealth() <= 0
      || player.getState().sliding || player.getState().climbing || player.getState().ventMode || player.getState().boxHandling || !scene || !camera) return false;
    const input = direction ?? player.getAttackDirection();
    if (this.cooldown > 0) {
      if (this.swingTime > 0 && this.swingTime <= this.swingDuration * 0.5) {
        this.queuedDirection = { ...input }; return true;
      }
      return false;
    }
    const combo = this.comboTime > 0 ? (this.swingIndex + 1) % 3 : 0;
    const move = directionalSwordAttack(input.x, input.y, combo), name = SWORD_ATTACK_CLIPS[move];
    const clip = attackClips?.find(clip => clip.name === name);
    if (!clip || !character?.getObjectByName('lightsaber')) {
      console.error('[Lightsaber] Prepared character/sword animation is missing:', name); return false;
    }
    if (!player.requestAction(name)) return false;
    this.swingIndex = combo; this.attackMove = move;
    this.swingDuration = clip.duration;
    this.comboTime = clip.duration + 0.65;
    this.audio.playSwing();
    this.melee.reset();
    this.activeWindow = -1;
    this.cooldown = this.swingTime = clip.duration;
    this.swingPlayer = player;
    this.parryWindow = 0;
    this.queuedDirection = null;
    this.update(0);
    return true;
  }

  update(dt: number) {
    if (this.disposed) return;
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const previousSwing = this.swingTime;
    this.cooldown = Math.max(0, this.cooldown - frame);
    this.swingTime = Math.max(0, this.swingTime - frame);
    this.comboTime = Math.max(0, this.comboTime - frame);
    this.parryFlash = Math.max(0, this.parryFlash - frame);
    if (this.parryWindow > 0) {
      this.parryWindow = Math.max(0, this.parryWindow - frame);
      this.parryPerfect = this.parryWindow > PARRY_TOTAL_SECONDS - PARRY_PERFECT_SECONDS;
    }
    const context = this.context();
    const { scene, camera, player, character, thirdPerson, hasLightsaber, setCharacterEquipped } = context;
    if (!hasLightsaber && this.equipped) this.holster();
    const usable = !!player?.isEnabled() && player.getHealth() > 0 && !player.getState().climbing
      && !player.getState().sliding && !player.getState().ventMode && !player.getState().boxHandling;
    const active = this.equipped && usable;
    setCharacterEquipped(active);
    if (active) {
      this.ignitionTime = Math.max(0, this.ignitionTime - frame);
      if (this.ignitionTime === 0) this.audio.startHum();
    } else this.audio.stopHum();
    this.root.visible = active && !thirdPerson;
    const sourceWeapon = character?.getObjectByName('lightsaber');
    if (scene && camera && character && sourceWeapon && this.root.visible) {
      camera.updateMatrixWorld(true);
      scene.add(this.root);
      camera.getWorldPosition(this.cameraPosition);
      character.getWorldPosition(this.characterPosition);
      sourceWeapon.getWorldPosition(this.root.position);
      character.worldToLocal(this.root.position);
      this.root.position.y -= this.cameraPosition.y - this.characterPosition.y;
      camera.getWorldQuaternion(this.viewRotation).multiply(this.viewFacing);
      this.root.position.applyQuaternion(this.viewRotation).add(this.cameraPosition);
      character.getWorldQuaternion(this.sourceRotation).invert();
      this.root.quaternion.copy(this.viewRotation).multiply(this.sourceRotation)
        .multiply(sourceWeapon.getWorldQuaternion(this.sourceRotation));
      sourceWeapon.getWorldScale(this.root.scale);
    } else this.root.removeFromParent();
    if (!active || !player || !scene || !camera || (previousSwing > 0 && player !== this.swingPlayer)) {
      this.swingTime = this.cooldown = this.parryWindow = 0; this.swingPlayer = null;
      this.queuedDirection = null; this.previousSegment = null; this.melee.reset(); return;
    }
    const weapon = thirdPerson ? sourceWeapon : this.root.getObjectByName('lightsaber');
    if (!weapon) return;
    const segment = getWeaponSegment(weapon);
    if (previousSwing > 0) {
      const scale = this.swingDuration / MELEE_STRIKES[this.attackMove].duration;
      const before = (this.swingDuration - previousSwing) / scale, after = (this.swingDuration - this.swingTime) / scale;
      let damaging = false;
      for (const [index, window] of swordHitWindows(this.attackMove).entries()) {
        if (after < window.start || before > window.end) continue;
        if (this.activeWindow !== index) {
          this.activeWindow = index;
          this.melee.reset(); this.melee.prime(this.previousSegment ?? segment);
          this.parryWindow = PARRY_TOTAL_SECONDS; this.parryPerfect = true;
          if (index > 0) this.audio.playSwing();
          context.openDoor();
        }
        damaging = true;
        if (frame > 0 && this.melee.update(context, segment, [this.root])) this.audio.playClash();
      }
      if (!damaging) this.melee.prime(segment);
    }
    this.previousSegment = segment;
    this.checkParry();
    if (previousSwing > 0 && this.swingTime === 0 && this.queuedDirection) {
      const direction = this.queuedDirection; this.queuedDirection = null;
      this.swing(direction);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.holster();
    this.disposed = true;
    this.unregisterTouchAttack();
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
