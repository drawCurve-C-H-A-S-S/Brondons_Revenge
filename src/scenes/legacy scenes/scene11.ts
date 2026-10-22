import { createCargoRoom, type CargoRoomOptions } from '../../scripts/global/cargoRoom.js';

/** Mirrored freight line with breakable cargo and the hub-plate reveal. */
export function createScene(options: CargoRoomOptions = {}) {
  return createCargoRoom(11, options);
}
