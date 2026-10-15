/** Adaptive hint system that escalates after player inactivity */
import { inputHint } from './gamepadInput.js';

export interface HintTrigger {
  id: string;
  /** Check if this hint is relevant given current game state */
  check: (state: HintState) => boolean;
  /** Escalating hint messages from vague to specific */
  messages: string[];
  /** Seconds of inactivity before showing each escalation level */
  delays: number[];
}

export interface HintState {
  currentScene: string;
  hasCrowbar: boolean;
  hasLightsaber: boolean;
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
  private activeHint: { triggerId: string; level: number; timer: number } | null = null;
  private lastActivityTime = 0;
  private hintElement: HTMLElement | null = null;
  private enabled = true;

  constructor() {
    this.hintElement = document.getElementById('adaptive-hint');
    this.registerDefaultTriggers();
  }

  private registerDefaultTriggers() {
    // Ladder crates in scene7 (Cafeteria)
    this.addTrigger({
      id: 'ladder-crates',
      check: (state) => state.currentScene === 'scene7' && !state.ladderCratesCleared && !state.hasCrowbar,
      messages: [
        'Something in this room might help you reach the ladder...',
        'The crates near the ladder look breakable with the right tool.',
        'Find the crowbar in the cargo bay to break those crates.',
      ],
      delays: [30, 60, 90],
    });

    // Shield pickup in scene7
    this.addTrigger({
      id: 'shield-pickup',
      check: (state) => state.currentScene === 'scene7' && !state.shieldCollected,
      messages: [
        'There\'s something valuable hidden in this room.',
        'A blue glow catches your eye in the dining area.',
        'The shield pickup is floating near the tables at the back of the cafeteria.',
      ],
      delays: [45, 75, 105],
    });

    // Boss weak point (scene13)
    this.addTrigger({
      id: 'boss-weak-point',
      check: (state) => state.currentScene === 'scene13' && !state.bossDefeated,
      messages: [
        'The Bay Warden seems vulnerable during certain phases...',
        'Watch for the drone attack — dodge to the side when it approaches.',
        'When the drone explodes, the boss\'s armor cracks. Strike then!',
      ],
      delays: [40, 70, 100],
    });

    // Health pack after boss
    this.addTrigger({
      id: 'health-pack',
      check: (state) => state.currentScene === 'scene13' && state.bossDefeated && !state.healthPackCollected,
      messages: [
        'The console nearby might have something useful.',
        'A medical kit appeared after defeating the boss.',
        'The health pack is floating near the elevator console — walk over it to heal.',
      ],
      delays: [30, 60, 90],
    });

    // Cargo door (scene10/11)
    this.addTrigger({
      id: 'cargo-door',
      check: (state) => (state.currentScene === 'scene10' || state.currentScene === 'scene11') && !state.cargoDoorUnlocked && !state.hasCrowbar,
      messages: [
        'That door looks like it needs something to hold it open.',
        'The cargo crate might be heavy enough to keep the door open.',
        'Grab the cargo crate (E) and place it in front of the door.',
      ],
      delays: [35, 65, 95],
    });

    // General exploration hint
    this.addTrigger({
      id: 'exploration',
      check: (state) => {
        // Generic hint when player seems lost in any scene
        return true;
      },
      messages: [
        'Look around for interactive objects and clues.',
        'Try pressing E near objects that look important.',
        'Check your inventory (K for pistol, T for crowbar, L for lightsaber, N for goggles).',
      ],
      delays: [120, 180, 240],
    });
  }

  addTrigger(trigger: HintTrigger) {
    this.triggers.set(trigger.id, trigger);
  }

  removeTrigger(id: string) {
    this.triggers.delete(id);
  }

  recordActivity() {
    this.lastActivityTime = performance.now();
    if (this.activeHint) {
      this.activeHint = null;
      this.hideHint();
    }
  }

  update(dt: number, state: HintState) {
    if (!this.enabled || !this.hintElement) return;

    const now = performance.now();
    const inactiveTime = (now - this.lastActivityTime) / 1000;

    // Check all triggers and find the most urgent one
    let bestTrigger: HintTrigger | null = null;
    let bestLevel = -1;
    let bestDelay = Infinity;

    for (const trigger of this.triggers.values()) {
      if (!trigger.check(state)) continue;

      for (let i = 0; i < trigger.delays.length; i++) {
        if (inactiveTime >= trigger.delays[i] && inactiveTime < bestDelay) {
          bestTrigger = trigger;
          bestLevel = i;
          bestDelay = trigger.delays[i];
        }
      }
    }

    // Show or update hint
    if (bestTrigger && bestLevel >= 0) {
      if (!this.activeHint || this.activeHint.triggerId !== bestTrigger.id || this.activeHint.level !== bestLevel) {
        this.activeHint = { triggerId: bestTrigger.id, level: bestLevel, timer: 0 };
        this.showHint(bestTrigger.messages[bestLevel]);
      }
    } else if (this.activeHint) {
      this.activeHint = null;
      this.hideHint();
    }
  }

  private showHint(message: string) {
    if (!this.hintElement) return;
    this.hintElement.textContent = inputHint(message);
    this.hintElement.classList.remove('hidden');
    this.hintElement.classList.add('visible');
  }

  private hideHint() {
    if (!this.hintElement) return;
    this.hintElement.classList.remove('visible');
    this.hintElement.classList.add('hidden');
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.hideHint();
  }

  dispose() {
    this.hideHint();
    this.triggers.clear();
    this.activeHint = null;
  }
}
