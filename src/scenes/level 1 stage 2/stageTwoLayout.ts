import * as THREE from 'three';
import type { ShipMapLayout } from '../../core/shipMap.js';
import type { ShipMapBlock } from '../../helpers/scene/shipLayout.js';

export type CameraRoomId = 'scene5' | 'scene6' | 'stage2-armory';
export type CameraFeedId = CameraRoomId | 'stage2-vents' | 'stage2-prison';
export type KeycardRoomId = Exclude<CameraFeedId, 'stage2-prison'>;
export type StageTwoCheckpoint = 'vent' | 'surveillance';
export interface CameraRoomProgress { cleared: Set<string>; rewardCollected: boolean; }
export interface StageTwoProgress {
  checkpoint: StageTwoCheckpoint;
  ventCleared: boolean;
  crowbarCollected: boolean;
  guardDown: boolean;
  lightsaberCollected: boolean;
  elevatorUnlocked: boolean;
  keycards: KeycardRoomId[];
  acceptedKeycard: KeycardRoomId | null;
  remoteRooms: Record<KeycardRoomId, CameraRoomProgress>;
}

export const STAGE_TWO_MINIGAMES = [
  { id: 'scene5', label: 'Cargo hold' },
  { id: 'scene6', label: 'Target range' },
  { id: 'stage2-armory', label: 'Equipment archive' },
] as const;
export const STAGE_TWO_KEYCARD_ROOMS = ['stage2-vents', ...STAGE_TWO_MINIGAMES.map(room => room.id)] as const;
export const STAGE_TWO = {
  height: 3.8,
  ventHeight: 4,
  ventChest: { x: 44, z: -44 },
  crowbarChest: { x: 23.5, z: -44.7 },
  camera: { minX: 19, maxX: 37, minZ: -64, maxZ: -42 },
  drop: { x: 28, z: -44 },
  guard: { x: 28, z: -61.8 },
  cameraWall: { x: 28, y: 1.95, z: -42.22, yaw: Math.PI },
  elevator: { x: 28, z: -66.4, width: 4, depth: 4.8 },
  reader: { x: 30.25, y: 1.35, z: -63.78 },
} as const;

export function createStageTwoProgress(): StageTwoProgress {
  return { checkpoint: 'vent', ventCleared: false, crowbarCollected: false, guardDown: false,
    lightsaberCollected: false, elevatorUnlocked: false, keycards: [], acceptedKeycard: null,
    remoteRooms: { scene5: { cleared: new Set(), rewardCollected: false },
      scene6: { cleared: new Set(), rewardCollected: false },
      'stage2-armory': { cleared: new Set(), rewardCollected: false },
      'stage2-vents': { cleared: new Set(), rewardCollected: false } } };
}

export function collectStageTwoKeycard(progress: StageTwoProgress, id: KeycardRoomId) {
  if (progress.remoteRooms[id].rewardCollected) return false;
  progress.remoteRooms[id].rewardCollected = true;
  progress.keycards.push(id);
  if (STAGE_TWO_KEYCARD_ROOMS.every(id => progress.remoteRooms[id].rewardCollected)) progress.acceptedKeycard = id;
  return true;
}

export function swipeStageTwoKeycard(progress: StageTwoProgress): 'missing' | 'rejected' | 'accepted' {
  const card = progress.keycards[progress.keycards.length - 1];
  if (!card) return 'missing';
  if (card !== progress.acceptedKeycard) return 'rejected';
  progress.elevatorUnlocked = true;
  return 'accepted';
}

export const VENT_MAZE = [
  '#################',
  '#S..#.....#.....#',
  '###.###.#.#.###.#',
  '#.#.#...#.#...#.#',
  '#.#.#.###.#.#.###',
  '#.#...#...#.#...#',
  '#.#####.#######.#',
  '#.....#...#...#.#',
  '#.###.###.#.#.#.#',
  '#...#.....#.#...#',
  '###.#######.###.#',
  '#...#.....#.#.#.#',
  '#.###.###.#.#.#.#',
  '#.#.....#...#.#.#',
  '#.#####.#####.#.#',
  '#.....#.#...#...#',
  '#####.#.#.###.###',
  '#.....#.#...#.#.#',
  '#.#####.###.#.#.#',
  '#.......#...#...#',
  '#########.#####.#',
  '#...#...#.....#.#',
  '#.###.#.#.#.###.#',
  '#.....#E..#.....#',
  '#################',
] as const;
export const VENT_CELL_SIZE = 2;
export const VENT_ORIGIN = { x: 14, z: -90 };
export const VENT_START = { column: 1, row: 1 } as const;
export const VENT_EXIT = { column: 7, row: 23 } as const;
export const VENT_BOUNDS = { minX: 13, maxX: 47, minZ: -91, maxZ: -41 } as const;
export const VENT_CENTER = { x: 30, z: -66 } as const;
export const VENT_SAFE_CELLS = [
  VENT_START, { column: 7, row: 5 }, { column: 3, row: 11 },
  { column: 5, row: 19 }, { column: 11, row: 11 }, { column: 13, row: 19 },
] as const;
export const VENT_SENSORS = [
  { id: 'vent-sensor-1', column: 7, row: 3, axis: 'z', phase: 0 },
  { id: 'vent-sensor-2', column: 5, row: 7, axis: 'x', phase: 1.5 },
  { id: 'vent-sensor-3', column: 5, row: 17, axis: 'x', phase: 3 },
  { id: 'vent-sensor-4', column: 5, row: 11, axis: 'z', phase: 4.5 },
  { id: 'vent-sensor-5', column: 15, row: 11, axis: 'x', phase: 2 },
  { id: 'vent-sensor-6', column: 11, row: 22, axis: 'x', phase: 5 },
] as const;

export function ventPoint(column: number, row: number, height: number = STAGE_TWO.ventHeight) {
  return new THREE.Vector3(VENT_ORIGIN.x + column * VENT_CELL_SIZE, height, VENT_ORIGIN.z + row * VENT_CELL_SIZE);
}
export function ventSensorState(index: number, time: number) {
  const sensor = VENT_SENSORS[index];
  if (!sensor) throw new Error(`Unknown vent sensor ${index}`);
  const phase = (time + sensor.phase) % 8;
  const position = ventPoint(sensor.column, sensor.row, STAGE_TWO.ventHeight + 0.5);
  position[sensor.axis] += Math.sin((time + sensor.phase) * Math.PI / 3.5) * 0.73;
  return { position, active: phase < 4.5 };
}
export function isSurveillancePoint(point: { x: number; y: number; z: number }) {
  const room = STAGE_TWO.camera;
  return point.x > room.minX + 0.4 && point.x < room.maxX - 0.4 && point.z > room.minZ + 0.4
    && point.z < room.maxZ - 0.4 && point.y >= 0.2 && point.y < 1;
}

const mazeBlocks: ShipMapBlock[] = VENT_MAZE.flatMap((line, row) => [...line].flatMap((cell, column): ShipMapBlock[] => {
  const point = ventPoint(column, row);
  return cell === '#' ? [{ size: [2, 1.3, 2], position: [point.x - VENT_CENTER.x, 0.65, point.z - VENT_CENTER.z] }] : [];
}));
export const STAGE_TWO_MAP: ShipMapLayout = {
  name: 'Stage Two vent and camera hub', initialRoom: 34,
  joins: [
    { from: { room: 31, portal: 'airlock' }, to: { room: 35, portal: 'airlock' } },
    { from: { room: 32, portal: 'vent' }, to: { room: 34, portal: 'ladder' } },
  ],
  rooms: [
    { id: 34, name: 'Sensor vent maze', deck: 'upper', width: 34, depth: 50,
      position: new THREE.Vector3(VENT_CENTER.x, 18, VENT_CENTER.z), yaw: 0,
      portals: { ladder: { x: -14, z: -22, yaw: Math.PI } },
      description: 'Maintenance maze / Green sensors are safe / Blue checkpoint pads', mapContents: mazeBlocks },
    { id: 35, name: 'Surveillance minigame hub', deck: 'main', width: 18, depth: 22,
      position: new THREE.Vector3(28, 0, -53), yaw: 0, portalWidth: 4,
      description: 'Silent takedown / Camera-only links to surveilled decks / Keycard elevator',
      portals: { airlock: { x: -9, z: 7, yaw: Math.PI / 2 }, lift: { x: 0, z: -11, yaw: 0 }, 'feed-5': { x: 0, z: 0, yaw: 0 },
        'feed-6': { x: 0, z: 0, yaw: 0 }, 'feed-37': { x: 0, z: 0, yaw: 0 } } },
    { id: 36, name: 'Bay 13 service elevator', deck: 'main', width: 4, depth: 4.8,
      position: new THREE.Vector3(28, 0, -66.4), yaw: 0, description: 'Swipe the last recovered keycard / Walk in and press the Bay 13 button',
      portals: { camera: { x: 0, z: 2.4, yaw: Math.PI }, bay13: { x: 0, z: -2.4, yaw: 0 } } },
  ],
  connections: [[34, 35], [35, 36]],
  playerPoint: (id, point) => new THREE.Vector3(point.x, id === 34 ? 20.2 : 2.2, point.z),
  verticalLinks: [{ id: 35, position: new THREE.Vector3(28, 0, -44), upper: 18, label: 'Surveillance vent drop' }],
  goals: [{ id: 'service-elevator', room: 35, position: new THREE.Vector3(28, 1.5, -64), label: 'ELEVATOR' }],
  elevatorRoutes: [{ id: 36, position: new THREE.Vector3(28, 0, -66.4), width: 4, depth: 4.8,
    stops: [{ height: 0, label: 'CAMERA HUB' }, { height: -18, label: 'BAY 13' }, { height: -36, label: 'BAY 14 / OFFLINE', locked: true }] }],
};

export function cameraVisitMap(id: 5 | 6 | 37): ShipMapLayout {
  const name = id === 5 ? 'CCTV cargo hold' : id === 6 ? 'CCTV target range' : 'Sealed equipment archive';
  const altitude = id === 5 ? 36 : id === 6 ? -18 : 54;
  return { name, initialRoom: id, connections: [], playerPoint: (_id, point) => new THREE.Vector3(point.x, altitude + 2.2, point.z),
    joins: [{ from: { room: 35, portal: `feed-${id}` }, to: { room: id, portal: 'camera' },
      kind: 'camera', verticalOffset: altitude, displayOffset: { x: 34, z: id === 5 ? -16 : id === 6 ? 0 : 16 } }],
    rooms: [{ id, name, deck: id === 6 ? 'lower' : 'upper', width: id === 37 ? 8 : 10, depth: id === 37 ? 8 : 10,
      position: new THREE.Vector3(0, altitude, 0), yaw: 0, portals: { camera: { x: 0, z: 0, yaw: Math.PI } },
      description: 'Deck under surveillance / Camera teleport only / Collect a chest keycard / T to return' }] };
}

export const BAY_THIRTEEN_MAP: ShipMapLayout = {
  name: 'Bay 13 arena', initialRoom: 13,
  joins: [{ from: { room: 36, portal: 'bay13' }, to: { room: 13, portal: 'elevator' }, verticalOffset: -18 }],
  rooms: [{ id: 13, name: 'Bay 13 / Bay Warden arena', deck: 'lower', width: 40, depth: 48,
    position: new THREE.Vector3(0, -18, 0), yaw: 0, portals: { elevator: { x: 0, z: -24, yaw: 0 }, hangarLift: { x: 0, z: 0, yaw: 0 } },
    description: 'Bay Warden boss / Central lift to the Bay 14 hangar' }],
  connections: [], playerPoint: (_id, point) => new THREE.Vector3(point.x, -15.8, point.z),
  elevatorRoutes: [{ id: 13, position: new THREE.Vector3(0, -18, 0), width: 4, depth: 4,
    stops: [{ height: -18, label: 'BAY 13 ARENA' }, { height: -36, label: 'BAY 14 HANGAR' }] }],
};

export const BAY_FOURTEEN_MAP: ShipMapLayout = {
  name: 'Bay 14 escape hangar', initialRoom: 14,
  joins: [{ from: { room: 13, portal: 'hangarLift' }, to: { room: 14, portal: 'arenaLift' }, verticalOffset: -18 }],
  rooms: [{
    id: 14, name: 'Bay 14 / Escape hangar', deck: 'lower', width: 36, depth: 72,
    position: new THREE.Vector3(0, -36, 0), yaw: 0, portals: { arenaLift: { x: 0, z: -36, yaw: Math.PI } }, description: 'Reach the shuttle and escape the ship',
  }], connections: [], playerPoint: (_id, point) => new THREE.Vector3(point.x, -33.8, point.z),
};
