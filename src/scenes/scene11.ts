import { createDropRoom } from '../helpers/scene/shipRoom.js';
import type { PlayerTransitionState } from '../scripts/player.js';

/** Empty compartment reached by dropping from the right vent branch. */
export function createScene(options: { entryState?: PlayerTransitionState; fromPassage?: boolean } = {}) {
  return createDropRoom(11, options);
}
