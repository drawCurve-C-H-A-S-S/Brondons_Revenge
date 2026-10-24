/** Optional contextual Prime hints, timed using active gameplay only. */
import { setInputHint } from "../global/inputPrompts.js";
import { getPrimeHintsEnabled } from "./primeHints.js";

export interface HintTrigger {
  id: string;
  /** Check if this hint is relevant given current game state */
  check: (state: HintState) => boolean;
  /** Escalating hint messages from vague to specific */
  messages: string[];
  /** Active gameplay seconds before each escalation level */
  delays: number[];
}

export interface HintState {
  currentScene: string;
  phase?: string;
  hasCrowbar: boolean;
  hasBloomstick: boolean;
  hasPistol: boolean;
  hasGoggles: boolean;
  shieldCollected: boolean;
  healthPackCollected: boolean;
  bossDefeated: boolean;
  ladderCratesCleared: boolean;
  cargoDoorUnlocked: boolean;
  playerPosition: { x: number; y: number; z: number };
}

export class AdaptiveHintManager {
  private triggers: Map<string, HintTrigger> = new Map();
  private activeHint: {
    triggerId: string;
    level: number;
    timer: number;
  } | null = null;
  private elapsed = 0;
  private cooldown = 18;
  private context = "";
  private shownHints = new Set<string>();
  private hintElement: HTMLElement | null = null;
  private enabled = true;

  constructor() {
    this.hintElement = document.getElementById("adaptive-hint");
    this.registerDefaultTriggers();
  }

  private registerDefaultTriggers() {
    const levels = [
      {
        scenes: ["prologue1"],
        messages: [
          "Look for mineral samples among the coloured rocks.",
          "Move closer to a sample and watch for its interaction prompt.",
          "Check the nearby rocks before moving on.",
        ],
      },
      {
        scenes: ["living-quarters"],
        messages: [
          "Check the crew cabins for useful equipment before we leave.",
          "Look at the nameplates to keep track of whose room you are searching.",
          "The forward bulkhead will be ready once we have the required equipment.",
        ],
      },
      {
        scenes: ["scene32", "scene34", "stage2-infiltration"],
        messages: [
          "Watch the sensor timing before crossing the vents.",
          "Blue pads mark checkpoints. Take one section at a time.",
          "Explore the branches if this route loops back on itself.",
        ],
      },
      {
        scenes: ["scene35", "scene36"],
        messages: [
          "The camera screens link us to the other rooms.",
          "Press R to return here after visiting a camera room.",
          "Try your newest collected card at the elevator reader.",
        ],
      },
      {
        scenes: ["scene5"],
        messages: [
          "Look for cargo you can move with E.",
          "Check what changes when a crate is moved onto a mechanism.",
          "You can return to the camera room with R.",
        ],
      },
      {
        scenes: ["scene6"],
        messages: [
          "The scanner goggles can reveal details you would otherwise miss.",
          "Read the short wall clue and compare it with the targets.",
          "Take another look through the goggles before choosing your shots.",
        ],
      },
      {
        scenes: ["scene37", "scene1.3"],
        messages: [
          "Use the Bloomstick to send the incoming objects back.",
          "Returning an object into its launcher clears that lane.",
          "The rules above the chest explain the lane challenge.",
        ],
      },
      {
        scenes: ["scene38", "stage2-rust"],
        messages: [
          "Blue corrosion responds to gunfire; orange needs a melee strike.",
          "Watch the lock ring to see how much of the mechanism remains.",
          "Check above the rust water as well as along the floor.",
        ],
      },
      {
        scenes: ["scene40", "stage2-rust2"],
        messages: [
          "Watch the hanging load and the pink trampoline.",
          "The short wall hint describes how the room's mechanisms connect.",
          "Use E to carry the released block when it is safe to approach.",
        ],
      },
      {
        scenes: ["scene39", "stage2-reactor"],
        messages: [
          "Read the reactor diagram before changing the sequence.",
          "Watch which reactors respond to each control.",
          "Compare the current pattern with the poster, one step at a time.",
        ],
      },
      {
        scenes: ["scene13"],
        messages: [
          "Watch the bot's attack pattern before closing the distance.",
          "Keep moving when it sends the drones after you.",
          "Look for a new opening whenever its behaviour changes.",
        ],
      },
      {
        scenes: ["scene15", "scene15.6", "scene15.9"],
        messages: [
          "Keep moving between firing bursts.",
          "Use your evade just before the incoming fire reaches us.",
          "Concentrate on exposed targets before changing your firing line.",
        ],
      },
      {
        scenes: ["scene15.5", "scene15.75"],
        messages: [
          "Keep moving through the gaps between volleys.",
          "Time the dodge rather than holding a single direction.",
          "Stay clear of the next firing lane while returning fire.",
        ],
      },
      {
        scenes: ["scene17", "scene19"],
        messages: [
          "Keep the facility in view as you choose a route.",
          "Use cover when the sentinels start firing.",
          "Look for a walkable path rather than forcing the steep rock faces.",
        ],
      },
      {
        scenes: ["scene20"],
        messages: [
          "Take a look around the laboratory before heading upstairs.",
          "The central stairs lead to the upper office.",
          "Approach the glass door upstairs and press E to peek.",
        ],
      },
      {
        scenes: ["scene21"],
        messages: [
          "Watch the Final Verdict's wind-up before committing to an attack.",
          "Guard just before impact to parry, then look for an opening.",
          "Use a dodge to make room when the next attack is already coming.",
        ],
      },
      {
        scenes: ["museum"],
        messages: [
          "The paintings lead to the playable challenges.",
          "Move close to a painting and use its interaction prompt.",
          "The blue light in the middle returns you to the main menu.",
        ],
      },
    ];
    for (const { scenes, messages } of levels)
      this.addTrigger({
        id: scenes[0],
        check: (state) =>
          scenes.includes(state.currentScene) &&
          (state.currentScene !== "scene13" || !state.bossDefeated),
        messages,
        delays: [18, 55, 95],
      });
  }

  addTrigger(trigger: HintTrigger) {
    this.triggers.set(trigger.id, trigger);
  }

  removeTrigger(id: string) {
    this.triggers.delete(id);
  }

  recordActivity() {
    this.elapsed = 0;
    this.cooldown = 18;
    this.activeHint = null;
    this.hideHint();
  }

  update(dt: number, state: HintState) {
    if (!this.enabled || !getPrimeHintsEnabled() || !this.hintElement) {
      this.hideHint();
      return;
    }
    const context = `${state.currentScene}:${state.phase ?? ""}`;
    if (context !== this.context) {
      this.context = context;
      this.shownHints.clear();
      this.recordActivity();
    }
    const frame = Math.max(0, Math.min(dt, 0.1));
    this.elapsed += frame;
    this.cooldown -= frame;
    if (this.activeHint) {
      this.activeHint.timer -= frame;
      if (
        this.activeHint.timer <= 0 ||
        !this.triggers.get(this.activeHint.triggerId)?.check(state)
      ) {
        this.activeHint = null;
        this.hideHint();
      }
    }
    if (this.activeHint || this.cooldown > 0) return;
    let bestTrigger: HintTrigger | null = null;
    let bestLevel = -1;
    let bestDelay = Infinity;

    for (const trigger of this.triggers.values()) {
      if (!trigger.check(state)) continue;

      for (let i = 0; i < trigger.delays.length; i++) {
        if (
          this.elapsed >= trigger.delays[i] &&
          trigger.delays[i] < bestDelay &&
          !this.shownHints.has(`${trigger.id}:${i}`)
        ) {
          bestTrigger = trigger;
          bestLevel = i;
          bestDelay = trigger.delays[i];
        }
      }
    }

    if (bestTrigger && bestLevel >= 0) {
      this.shownHints.add(`${bestTrigger.id}:${bestLevel}`);
      this.activeHint = {
        triggerId: bestTrigger.id,
        level: bestLevel,
        timer: 4.5,
      };
      this.cooldown = 30;
      this.showHint(bestTrigger.messages[bestLevel]);
    }
  }

  private showHint(message: string) {
    if (!this.hintElement) return;
    setInputHint(this.hintElement, `Prime: ${message}`, "foot", true, true);
    this.hintElement.classList.remove("hidden");
    this.hintElement.classList.add("visible");
  }

  private hideHint() {
    if (!this.hintElement) return;
    this.hintElement.classList.remove("visible");
    this.hintElement.classList.add("hidden");
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.recordActivity();
  }

  dispose() {
    this.hideHint();
    this.triggers.clear();
    this.activeHint = null;
    this.shownHints.clear();
  }
}
