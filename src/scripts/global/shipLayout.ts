import * as THREE from 'three';

export type ShipDeck = 'upper' | 'main' | 'lower';
export interface MapPortal { x: number; z: number; yaw: number; }
export interface ShipMapBlock {
  size: [number, number, number];
  position: [number, number, number];
}
export interface ShipRoom {
  id: number;
  name: string;
  deck: ShipDeck;
  width: number;
  depth: number;
  position: THREE.Vector3;
  yaw: number;
  portals: Record<string, MapPortal>;
  portalWidth?: number;
  locked?: boolean;
  description?: string;
  mapContents?: readonly ShipMapBlock[];
}
export const SHIP_DECKS = {
  upper: { name: 'Vent deck', level: '+1', height: 18, color: '#efbe64' },
  main: { name: 'Main deck', level: '0', height: 0, color: '#75d9c5' },
  lower: { name: 'Hangar deck', level: '-1', height: -18, color: '#fa897c' },
} as const;

const portal = (x: number, z: number, yaw = 0): MapPortal => ({ x, z, yaw });
const room = (id: number, name: string, width: number, depth: number, portals: ShipRoom['portals'] = {}, deck: ShipDeck = 'main'): ShipRoom =>
  ({ id, name, deck, width, depth, portals, position: new THREE.Vector3(0, SHIP_DECKS[deck].height, 0), yaw: 0 });

export function roomPoint(room: ShipRoom, x: number, z: number, height = 0) {
  return new THREE.Vector3(x, height, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), room.yaw).add(room.position);
}
function attach(source: ShipRoom, sourceDoor: string, destination: ShipRoom, destinationDoor: string) {
  const from = source.portals[sourceDoor], to = destination.portals[destinationDoor];
  destination.yaw = source.yaw + from.yaw - to.yaw + Math.PI;
  const anchor = roomPoint(source, from.x, from.z);
  const offset = new THREE.Vector3(to.x, 0, to.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), destination.yaw);
  destination.position.copy(anchor).sub(offset); destination.position.y = SHIP_DECKS[destination.deck].height;
}

export const SHIP_ROOMS = [
  room(2, 'Medical bay', 20, 30, { exit: portal(0, 15, Math.PI) }),
  room(3, 'Passageway', 8, 20, { back: portal(0, -10), front: portal(0, 10, Math.PI), left: portal(-4, 0, Math.PI / 2), right: portal(4, 0, -Math.PI / 2) }),
  room(4, 'Computer room', 10, 12, { back: portal(0, -6), front: portal(0, 6, Math.PI) }),
  room(5, 'Cargo hold', 10, 10, { back: portal(0, -5) }),
  room(6, 'Target range', 10, 10, { back: portal(0, -5) }),
  room(7, 'Cafeteria', 14, 12, { back: portal(0, -6) }),
  room(8, 'Maintenance vents', 22, 100, {}, 'upper'),
  room(9, 'Zero-gravity loading bay', 24, 26, { back: portal(0, -13) }),
  room(10, 'Durable cargo puzzle', 12, 12, { back: portal(0, -6) }),
  room(11, 'Mixed cargo puzzle', 12, 12, { back: portal(0, -6) }),
  room(12, 'Transfer passage', 8, 20, { bay: portal(0, -10), left: portal(-4, 0, Math.PI / 2), right: portal(4, 0, -Math.PI / 2), boss: portal(0, 10, Math.PI) }),
  room(13, 'Bay Warden arena', 40, 48, { back: portal(0, -24) }),
  room(14, 'Hangar', 36, 72, {}, 'lower'),
];
export const SHIP_ROOM_BY_ID = new Map(SHIP_ROOMS.map(room => [room.id, room]));
const getRoom = (id: number) => SHIP_ROOM_BY_ID.get(id)!;
attach(getRoom(3), 'back', getRoom(2), 'exit');
attach(getRoom(3), 'front', getRoom(4), 'back');
attach(getRoom(3), 'left', getRoom(5), 'back');
attach(getRoom(3), 'right', getRoom(6), 'back');
attach(getRoom(4), 'front', getRoom(7), 'back');
getRoom(12).position.z = 100; getRoom(12).yaw = Math.PI;
attach(getRoom(12), 'bay', getRoom(9), 'back');
attach(getRoom(12), 'left', getRoom(10), 'back');
attach(getRoom(12), 'right', getRoom(11), 'back');
attach(getRoom(12), 'boss', getRoom(13), 'back');
getRoom(14).yaw = getRoom(13).yaw;
const lift = roomPoint(getRoom(13), 0, 0);
getRoom(14).position.copy(lift).sub(new THREE.Vector3(0, 0, -29).applyAxisAngle(new THREE.Vector3(0, 1, 0), getRoom(14).yaw));
getRoom(14).position.y = SHIP_DECKS.lower.height;
getRoom(8).position.set(0, SHIP_DECKS.upper.height, 82);

const galleyHatch = roomPoint(getRoom(7), 4.6, -3.6);
const ventJunction = roomPoint(getRoom(12), 0, 0);
export const SHIP_VENT_PATHS = [
  [galleyHatch, new THREE.Vector3(galleyHatch.x, 0, 38), new THREE.Vector3(0, 0, 38), ventJunction, roomPoint(getRoom(9), 0, 0)],
  [ventJunction, roomPoint(getRoom(10), 0, 0)],
  [ventJunction, roomPoint(getRoom(11), 0, 0)],
].map(path => path.map(point => point.clone().setY(SHIP_DECKS.upper.height)));
export const SHIP_CONNECTIONS = [
  [2, 3], [3, 4], [3, 5], [3, 6], [4, 7], [7, 8], [8, 9], [8, 10], [8, 11],
  [9, 12], [10, 12], [11, 12], [12, 13], [13, 14],
] as const;
export const SHIP_VERTICAL_LINKS = [
  { id: 7, position: galleyHatch, upper: SHIP_DECKS.upper.height, label: 'Cafeteria ladder' },
  ...[9, 10, 11].map(id => ({ id, position: roomPoint(getRoom(id), 0, 0), upper: SHIP_DECKS.upper.height, label: `${getRoom(id).name} hatch` })),
  { id: 13, position: lift.clone().setY(SHIP_DECKS.lower.height), upper: SHIP_DECKS.main.height, label: 'Hangar lift' },
];

function alongPath(path: THREE.Vector3[], fraction: number) {
  const lengths = path.slice(1).map((point, index) => point.distanceTo(path[index]));
  let remaining = THREE.MathUtils.clamp(fraction, 0, 1) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index]) return path[index].clone().lerp(path[index + 1], remaining / lengths[index]);
    remaining -= lengths[index];
  }
  return path[path.length - 1].clone();
}
export function shipPlayerPoint(id: number, position: { x: number; y: number; z: number }) {
  const room = SHIP_ROOM_BY_ID.get(id);
  if (!room) return null;
  if (id !== 8) return roomPoint(room, position.x, position.z, 2.2);
  if (Math.abs(position.x) > 1.1) return alongPath(SHIP_VENT_PATHS[position.x > 0 ? 1 : 2], Math.abs(position.x) / 7.4).add(new THREE.Vector3(0, 2.2, 0));
  const path = SHIP_VENT_PATHS[0];
  return (position.z < 0 ? alongPath(path.slice(0, -1), (position.z + 7.2) / 7.2)
    : alongPath(path.slice(-2), position.z / 7.2)).add(new THREE.Vector3(0, 2.2, 0));
}