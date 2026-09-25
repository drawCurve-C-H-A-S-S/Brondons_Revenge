import { createScene as createJungleScene } from './scene17.js';
import type { RescueArrival } from '../../helpers/scene/rescueSite.js';

/** Downstream checkpoint sharing the jungle's patrols, damage contract, and facility defenses. */
export function createScene(options: { entryState?: RescueArrival; onRespawn: () => void }) {
  return createJungleScene({ ...options, section: 'return' });
}
