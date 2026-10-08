import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCrowbar } from './items/createCrowbar.js';
import type { DamageTarget } from './pistol.js';
import { MeleeSwing, getAttackSegment } from './melee.js';
import type { Player } from './player.js';
import { registerTouchAttackCallback, refreshTouchAttackButton } from './touchControls.js';

const CROWBAR_SWING_DURATION = 0.35;

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
  private melee = new MeleeSwing('crowbar');
  private swingPlayer: Player | null = null;
  private status: HTMLElement | null;
  private unregisterTouchAttack: () => void;

  constructor(private context: () => CrowbarContext) {
    this.root.name = 'PlayerCrowbar';
    this.root.add(createCrowbar());
    this.root.position.set(0.28, -0.28, -0.55);
    this.root.rotation.set(-0.45, 0.35, 0.35);
    this.root.visible = false;
    this.status = document.getElementById('weapon-status');
    document.addEventListener('mousedown', this.onMouseDown);
    this.unregisterTouchAttack = registerTouchAttackCallback(() => this.swing(), () => this.equipped ? 'SWING' : null);
  }

  isEquipped() { return this.equipped; }

  holster() {
    this.equipped = false;
    this.swingTime = 0;
    this.swingPlayer = null;
    this.melee.reset();
    this.root.visible = false;
    this.root.removeFromParent();
    refreshTouchAttackButton();
    this.context().setCharacterEquipped(false);
  }

  equip() {
    const { player, hasCrowbar } = this.context();
    if (!hasCrowbar || !player?.isEnabled()) return;
    this.context().holsterOther?.();
    this.equipped = true;
    refreshTouchAttackButton();
    if (this.status) this.status.textContent = 'Hold Tab: weapons | Left click: crowbar';
  }

  private onMouseDown = (event: MouseEvent) => {
    const touchActive = (window as any).__touchActive === true;
    if (event.button === 0 && (document.pointerLockElement || touchActive)) this.swing();
  };

  private swing() {
    const { scene, camera, player, openDoor } = this.context();
    if (document.hidden || document.body.classList.contains('quick-menu-open') || !this.equipped || this.cooldown > 0 || !player?.isEnabled() || player.getState().sliding || player.getState().climbing || player.getState().ventMode || player.getState().boxHandling || !scene || !camera) return false;
    player.requestAction('Sword_Attack');
    openDoor();
    this.melee.reset();
    this.cooldown = CROWBAR_SWING_DURATION;
    this.swingTime = CROWBAR_SWING_DURATION;
    this.swingPlayer = player;
    if (this.status) this.status.dataset.hit = 'false';
    this.update(0);
    return true;
  }

  update(dt: number) {
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const previousSwing = this.swingTime;
    this.cooldown = Math.max(0, this.cooldown - frame);
    this.swingTime = Math.max(0, this.swingTime - frame);
    const context = this.context();
    const { camera, player, thirdPerson, hasCrowbar, setCharacterEquipped, firstPersonHands: handsSource } = context;
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (!hasCrowbar && this.equipped) this.holster();
    const usable = !!player?.isEnabled() && !player.getState().sliding && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling;
    setCharacterEquipped(this.equipped && usable);
    this.root.visible = this.equipped && !thirdPerson && usable;
    const progress = this.swingTime > 0 ? 1 - this.swingTime / CROWBAR_SWING_DURATION : 1;
    if (this.equipped && usable && !thirdPerson) firstPersonHands?.update(this.swingTime > 0 ? progress : null);
    if (camera && this.root.visible) {
      if (this.root.parent !== camera) camera.add(this.root);
      this.root.rotation.set(-0.45 - Math.sin(Math.PI * progress) * 1.8, 0.35, 0.35);
    } else this.root.removeFromParent();
    if (!this.equipped || !usable || !player || !camera || (previousSwing > 0 && player !== this.swingPlayer)) {
      this.swingTime = 0; this.swingPlayer = null; this.melee.reset(); return;
    }
    if (previousSwing > 0) {
      // The attack follows player aim; presentation rigs must not shorten its physical reach.
      const segment = getAttackSegment(player, progress);
      if (frame > 0) {
        if (this.melee.update(context, segment, [this.root]) && this.status) this.status.dataset.hit = 'true';
      } else this.melee.prime(segment);
    }
  }

  renderFirstPerson(renderer: THREE.WebGLRenderer) {
    const { player, thirdPerson, hasCrowbar, firstPersonHands: handsSource } = this.context();
    const firstPersonHands = typeof handsSource === 'function' ? handsSource() : handsSource;
    if (hasCrowbar && this.equipped && !thirdPerson && player?.isEnabled() && !player.getState().sliding && !player.getState().climbing && !player.getState().ventMode && !player.getState().boxHandling) firstPersonHands?.render(renderer);
  }

  dispose() {
    this.holster();
    this.unregisterTouchAttack();
    document.removeEventListener('mousedown', this.onMouseDown);
    this.root.removeFromParent();
    this.context().setCharacterEquipped(false);
  }
}
