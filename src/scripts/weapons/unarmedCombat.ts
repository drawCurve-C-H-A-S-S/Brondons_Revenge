import { playSfx } from "../../helpers/audio/sfx.js";
import * as THREE from "three";
import type * as CANNON from "cannon-es";
import {
  UNARMED_ATTACK_SPEED,
  type UnarmedAttackName,
} from "../../core/combatAnimations.js";
import type { createFirstPersonHands } from "../player/firstPersonHands.js";
import { isControllerEvent } from "../player/gamepadInput.js";
import { getAttackSegment, MeleeSwing, type MeleeSegment } from "./melee.js";
import type { DamageTarget } from "./pistol.js";
import type { Player } from "../player/player.js";
import { registerTouchAttackCallback } from "../player/touchControls.js";

const PUNCHES: ReadonlyArray<{
  clip: UnarmedAttackName;
  move: "jab" | "cross" | "hook";
  start: number;
  end: number;
  side: number;
}> = [
  { clip: "Punch_Jab", move: "jab", start: 0.3, end: 0.56, side: -1 },
  { clip: "Punch_Cross", move: "cross", start: 0.36, end: 0.59, side: 1 },
  {
    clip: "Melee_Hook_WithRecovery",
    move: "hook",
    start: 0.25,
    end: 0.53,
    side: 1,
  },
];
type Punch = (typeof PUNCHES)[number];

interface UnarmedContext {
  scene: THREE.Scene | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  thirdPerson: boolean;
  unarmed: boolean;
  attackClips: readonly THREE.AnimationClip[];
  targets: DamageTarget[];
  firstPersonHands(): Awaited<ReturnType<typeof createFirstPersonHands>> | null;
}

export class UnarmedCombatController {
  private punch: {
    move: Punch;
    player: Player;
    elapsed: number;
    duration: number;
  } | null = null;
  private lastPunch: UnarmedAttackName | null = null;
  private fists = new MeleeSwing("unarmed", 10, 0.15, 1.4);
  private tackle = new MeleeSwing("tackle", 2, 0.28, 1.8);
  private tacklePlayer: Player | null = null;
  private previousSlideTime = 0;
  private unregisterTouchAttack: () => void;

  constructor(private context: () => UnarmedContext) {
    document.addEventListener("mousedown", this.onMouseDown);
    this.unregisterTouchAttack = registerTouchAttackCallback(
      () => this.attack(),
      () =>
        this.context().unarmed && this.context().player?.isEnabled()
          ? "PUNCH"
          : null,
    );
  }

  private onMouseDown = (event: MouseEvent) => {
    if (
      event.button === 0 &&
      (document.pointerLockElement ||
        document.body.classList.contains("touch-device") ||
        isControllerEvent(event))
    )
      this.attack();
  };

  private attack() {
    const context = this.context(),
      { player } = context;
    if (
      document.hidden ||
      document.body.classList.contains("quick-menu-open") ||
      !context.scene ||
      !context.unarmed ||
      this.punch ||
      !player?.isEnabled() ||
      player.getHealth() <= 0
    )
      return false;
    const state = player.getState();
    if (
      !state.isOnGround ||
      state.sliding ||
      state.climbing ||
      state.ventMode ||
      state.floating ||
      state.boxHandling
    )
      return false;
    const available = PUNCHES.filter((move) =>
      context.attackClips.some((clip) => clip.name === move.clip),
    );
    const candidates =
      available.length > 1
        ? available.filter((move) => move.clip !== this.lastPunch)
        : available;
    if (!candidates.length) {
      console.error("[Unarmed] No authored punch animations are available");
      return false;
    }
    const move = candidates[Math.floor(Math.random() * candidates.length)];
    const clip = context.attackClips.find((clip) => clip.name === move.clip)!;
    if (!player.requestAction(move.clip)) return false;
    this.lastPunch = move.clip;
    playSfx("melee");
    this.punch = {
      move,
      player,
      elapsed: 0,
      duration: clip.duration / UNARMED_ATTACK_SPEED,
    };
    this.fists.reset();
    this.fists.prime(getAttackSegment(player, 0.4, move.side, 1.15));
    return true;
  }

  private slideSegment(player: Player): MeleeSegment {
    const state = player.getState();
    const start = new THREE.Vector3(
      player.body.position.x,
      player.body.position.y - player.radius + 0.3,
      player.body.position.z,
    );
    const forward = new THREE.Vector3(
      -Math.sin(state.slideYaw),
      0,
      -Math.cos(state.slideYaw),
    );
    return { start, end: start.clone().addScaledVector(forward, 1.1) };
  }

  reset() {
    this.punch = null;
    this.fists.reset();
    this.tackle.reset();
    this.tacklePlayer = null;
    this.previousSlideTime = 0;
  }

  update(dt: number) {
    const context = this.context(),
      { player } = context;
    if (
      !context.scene ||
      !player?.isEnabled() ||
      player.getHealth() <= 0 ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    ) {
      this.reset();
      return;
    }
    const state = player.getState();
    if (state.sliding) {
      this.punch = null;
      this.fists.reset();
      const segment = this.slideSegment(player);
      if (
        this.tacklePlayer !== player ||
        state.slideTime < this.previousSlideTime
      ) {
        this.tackle.reset();
        this.tackle.prime(segment);
        this.previousSlideTime = 0;
      }
      this.tacklePlayer = player;
      if (state.slideTime >= 0.04 && this.previousSlideTime <= 0.9)
        this.tackle.update(context, segment);
      else this.tackle.prime(segment);
      this.previousSlideTime = state.slideTime;
      return;
    }
    this.tacklePlayer = null;
    this.previousSlideTime = 0;
    this.tackle.reset();
    if (context.unarmed && !context.thirdPerson) {
      const hands = context.firstPersonHands();
      hands?.setWeapon("unarmed");
      hands?.update(null, "jab");
    }
    if (
      !context.unarmed ||
      !state.isOnGround ||
      state.climbing ||
      state.ventMode ||
      state.floating ||
      state.boxHandling ||
      (this.punch && this.punch.player !== player)
    ) {
      this.punch = null;
      this.fists.reset();
      return;
    }
    const punch = this.punch;
    if (!punch) return;
    const previous = punch.elapsed / punch.duration;
    punch.elapsed += Math.max(0, Math.min(0.1, dt));
    const progress = Math.min(1, punch.elapsed / punch.duration);
    const contact = THREE.MathUtils.clamp(
      (progress - punch.move.start) / (punch.move.end - punch.move.start),
      0,
      1,
    );
    const segment = getAttackSegment(
      player,
      0.4 + contact * 0.2,
      punch.move.side,
      1.15,
    );
    if (progress >= punch.move.start && previous <= punch.move.end)
      this.fists.update(context, segment);
    else this.fists.prime(segment);
    if (!context.thirdPerson)
      context.firstPersonHands()?.update(progress, punch.move.move);
    if (progress >= 1) {
      this.punch = null;
      this.fists.reset();
    }
  }

  renderFirstPerson(renderer: THREE.WebGLRenderer) {
    const context = this.context();
    const player = context.player;
    if (
      context.unarmed &&
      !context.thirdPerson &&
      player?.isEnabled() &&
      player.getHealth() > 0 &&
      !player.getState().sliding &&
      !player.getState().climbing &&
      !player.getState().ventMode &&
      !player.getState().floating &&
      !player.getState().boxHandling
    ) {
      context.firstPersonHands()?.render(renderer);
    }
  }

  dispose() {
    this.reset();
    this.unregisterTouchAttack();
    document.removeEventListener("mousedown", this.onMouseDown);
  }
}
