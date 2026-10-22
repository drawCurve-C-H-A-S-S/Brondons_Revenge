import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createLightsaber, disposeLightsaber, setLightsaberBeamVisible, LIGHTSABER_ATTACK_SPEED, LIGHTSABER_SWING_DURATION } from '../items/createLightsaber.js';
import type { DamageTarget } from './pistol.js';
import { MeleeSwing, getWeaponSegment, type MeleeSegment } from './melee.js';
import type { Player } from '../player/player.js';
import { LightsaberAudio } from './lightsaberAudio.js';
import { registerTouchAttackCallback, refreshTouchAttackButton } from '../player/touchControls.js';
import { isControllerEvent } from '../player/gamepadInput.js';
import type { FirstPersonHands } from '../player/firstPersonHands.js';
import {
  directionalSwordAttack, MELEE_STRIKES, SWORD_ATTACK_CLIPS, swordHitWindows, type PlayerSwordStrike,
} from '../global/finaleChoreography.js';

/** Projectile that the lightsaber can deflect during a well-timed swing. */
export interface ParryableBolt {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  parried: boolean;
  owner: 'boss' | 'player';
}

const PARRY_RANGE = 3;
const PARRY_PERFECT_SECONDS = 0.2;
const PARRY_TOTAL_SECONDS = 0.36;
const RAPID_CLICK_WINDOW_MS = 450;
const KEYBOARD_ATTACKS: readonly PlayerSwordStrike[] = ['slash', 'sideSlash', 'reap', 'cleave', 'thrust', 'regularCombo'];
export const PARRY_DAMAGE = 50;

interface LightsaberContext {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  thirdPerson: boolean;
  hasLightsaber: boolean;
  hasLightsaberBeam?: boolean;
  attackClips?: readonly THREE.AnimationClip[];
  targets: DamageTarget[];
  setCharacterEquipped: (equipped: boolean) => void;
  openDoor: () => void;
  holsterOther?: () => void;
  getParryableBolts?: () => ParryableBolt[];
  firstPersonHands?: FirstPersonHands | null | (() => FirstPersonHands | null);
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
  private queuedMove: PlayerSwordStrike | null = null;
  private keyboardClickTimes: number[] = [];
  private activeWindow = -1;
  private previousSegment: MeleeSegment | null = null;
  private viewFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  private viewRotation = new THREE.Quaternion();
  private sourceRotation = new THREE.Quaternion();
  private cameraPosition = new THREE.Vector3();
  private characterPosition = new THREE.Vector3();
  private posePosition = new THREE.Vector3();
  private poseQuaternion = new THREE.Quaternion();
  private yawInverse = new THREE.Quaternion();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private ignitionTime = 0;
  private beamActive = false;
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
    refreshTouchAttackButton();
  }

  /** Detach persistent presentation before an outgoing room disposes its meshes. */
  detach() {
    this.audio.stopHum();
    this.beamActive = false;
    this.swingTime = this.cooldown = this.comboTime = this.parryWindow = 0;
    this.parryPerfect = false;
    this.swingPlayer = null;
    this.queuedMove = null;
    this.keyboardClickTimes = [];
    this.previousSegment = null;
    this.activeWindow = -1;
    this.melee.reset();
    this.root.visible = false;
    this.root.removeFromParent();
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea')) return;
    const touchActive = (window as any).__touchActive === true;
    if (event.button === 0 && (document.pointerLockElement || touchActive || isControllerEvent(event))) {
      this.swing(undefined, !touchActive && !isControllerEvent(event));
    }
  };

  private swing(queuedMove?: PlayerSwordStrike, keyboard = false) {
    const { scene, camera, player, character, attackClips, hasLightsaberBeam = true } = this.context();
    if (this.inputBlocked() || !this.equipped || !player?.isEnabled() || player.getHealth() <= 0
      || player.getState().sliding || player.getState().climbing || player.getState().ventMode || player.getState().boxHandling || !scene || !camera) return false;
    const input = player.getAttackDirection();
    const combo = this.comboTime > 0 ? (this.swingIndex + 1) % 3 : 0;
    let rapidClicks = false;
    if (keyboard) {
      const now = performance.now();
      this.keyboardClickTimes = this.keyboardClickTimes.slice(-2).filter(time => now - time <= RAPID_CLICK_WINDOW_MS);
      this.keyboardClickTimes.push(now);
      rapidClicks = this.keyboardClickTimes.length === 3;
    }
    let move = queuedMove ?? directionalSwordAttack(input.x, input.y, combo);
    if (keyboard) {
      const choices = KEYBOARD_ATTACKS.filter(attack => this.swingIndex < 0 || attack !== this.attackMove);
      move = rapidClicks ? 'heavyCombo' : choices[Math.floor(Math.random() * choices.length)];
    }
    if (this.cooldown > 0) {
      if (rapidClicks) {
        this.queuedMove = 'heavyCombo'; return true;
      }
      if (this.swingTime > 0 && this.swingTime <= this.swingDuration * 0.5) {
        if (!keyboard || this.queuedMove !== 'heavyCombo') this.queuedMove = move;
        return true;
      }
      return false;
    }
    const name = SWORD_ATTACK_CLIPS[move];
    const clip = attackClips?.find(clip => clip.name === name);
    if (!clip || !character?.getObjectByName('lightsaber')) {
      console.error('[Lightsaber] Prepared character/sword animation is missing:', name); return false;
    }
    if (!player.requestAction(name)) return false;
    this.swingIndex = combo; this.attackMove = move;
    this.swingDuration = clip.duration / LIGHTSABER_ATTACK_SPEED;
    this.comboTime = this.swingDuration + 0.65;
    if (hasLightsaberBeam) this.audio.playSwing();
    this.melee.reset();
    this.activeWindow = -1;
    this.cooldown = this.swingTime = this.swingDuration;
    this.swingPlayer = player;
    this.parryWindow = hasLightsaberBeam ? PARRY_TOTAL_SECONDS : 0; this.parryPerfect = hasLightsaberBeam;
    this.queuedMove = null;
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
    const { scene, camera, player, character, thirdPerson, hasLightsaber, hasLightsaberBeam = true, setCharacterEquipped, firstPersonHands: handsSource } = context;
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (!hasLightsaber && this.equipped) this.holster();
    const usable = !!player?.isEnabled() && player.getHealth() > 0 && !player.getState().climbing
      && !player.getState().sliding && !player.getState().ventMode && !player.getState().boxHandling;
    const active = this.equipped && usable;
    setCharacterEquipped(active);
    if (active && hasLightsaberBeam) {
      if (!this.beamActive) { this.audio.playIgnite(); this.ignitionTime = 0.6; }
      this.ignitionTime = Math.max(0, this.ignitionTime - frame);
      if (this.ignitionTime === 0) this.audio.startHum();
    } else this.audio.stopHum();
    this.beamActive = active && hasLightsaberBeam;
    this.root.visible = active && !thirdPerson && !firstPersonHands;
    const sourceWeapon = character?.getObjectByName('lightsaber');
    setLightsaberBeamVisible(this.root, hasLightsaberBeam);
    if (sourceWeapon) setLightsaberBeamVisible(sourceWeapon, hasLightsaberBeam);
    firstPersonHands?.setLightsaberBeamVisible(hasLightsaberBeam);
    if (firstPersonHands && active && !thirdPerson && player) {
      firstPersonHands.setWeapon('lightsaber');
      if (this.swingTime > 0 && camera && character && sourceWeapon) {
        camera.getWorldPosition(this.cameraPosition);
        character.getWorldPosition(this.characterPosition);
        this.yawInverse.setFromAxisAngle(this.yAxis, -player.getState().yaw);
        sourceWeapon.getWorldPosition(this.posePosition);
        this.posePosition.x -= this.characterPosition.x;
        this.posePosition.y -= this.cameraPosition.y;
        this.posePosition.z -= this.characterPosition.z;
        this.posePosition.applyQuaternion(this.yawInverse);
        this.poseQuaternion.copy(this.yawInverse).multiply(sourceWeapon.getWorldQuaternion(this.sourceRotation));
        firstPersonHands.setLightsaberPose(this.posePosition, this.poseQuaternion, camera.fov);
      } else firstPersonHands.setLightsaberPose(null);
      firstPersonHands.update(this.swingTime > 0 ? 1 - this.swingTime / this.swingDuration : null);
    }
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
      this.queuedMove = null; this.keyboardClickTimes = [];
      this.previousSegment = null; this.melee.reset(); return;
    }
    const weapon = thirdPerson || firstPersonHands ? sourceWeapon : this.root.getObjectByName('lightsaber');
    if (!weapon) return;
    if (hasLightsaberBeam) {
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
    } else {
      this.previousSegment = null; this.parryWindow = 0; this.melee.reset();
    }
    if (previousSwing > 0 && this.swingTime === 0 && this.queuedMove) {
      const move = this.queuedMove; this.queuedMove = null;
      this.swing(move);
    }
  }

  renderFirstPerson(renderer: THREE.WebGLRenderer) {
    const { player, thirdPerson, hasLightsaber, firstPersonHands: handsSource } = this.context();
    const hands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (hasLightsaber && this.equipped && !thirdPerson && player?.isEnabled() && player.getHealth() > 0
      && !player.getState().sliding && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling) {
      hands?.render(renderer);
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
    const { player, getParryableBolts, hasLightsaberBeam = true } = this.context();
    if (!hasLightsaberBeam || !player || !getParryableBolts || this.parryWindow <= 0) return;
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
