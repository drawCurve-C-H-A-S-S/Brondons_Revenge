import { createCargoRoom, type CargoRoomOptions } from '../../scripts/global/cargoRoom.js';

/** Durable freight line and the first crate-operated hub door. */
export function createScene(options: CargoRoomOptions = {}) {
  return createCargoRoom(10, options);
}
