import { createCargoRoom, type CargoRoomOptions } from '../../helpers/scene/cargoRoom.js';

/** Mirrored freight line with breakable cargo and the hub-plate reveal. */
export function createScene(options: CargoRoomOptions = {}) {
  return createCargoRoom(11, options);
}
