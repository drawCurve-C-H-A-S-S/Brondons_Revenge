import * as THREE from 'three';
import type { ShipMapLayout } from '../../core/shipMap.js';
import type { ShipMapBlock, ShipRoom } from '../../helpers/scene/shipLayout.js';

export type CameraRoomId = 'scene5' | 'scene6' | 'stage2-armory';
export type StageTwoCheckpoint = 'passage' | 'storeroom' | 'vent' | 'surveillance';
export interface CameraRoomProgress { cleared: Set<string>; rewardCollected: boolean; }
export interface StageTwoProgress {
  checkpoint: StageTwoCheckpoint;
  crowbarCollected: boolean;
  crateBroken: boolean;
  guardDown: boolean;
  codeRead: boolean;
  lightsaberCollected: boolean;
  elevatorUnlocked: boolean;
  remoteRooms: { scene5: CameraRoomProgress; scene6: CameraRoomProgress };
}

export const SURVEILLANCE_CODE = '7314';
export const STAGE_TWO = {
  height: 3.2, passage: { minZ: -28, maxZ: 6, width: 5 },
  storage: { minX: 2.5, maxX: 9.5, minZ: -11, maxZ: -5 },
  ladder: { x: 8, z: -9.5, height: 4 },
  camera: { minX: 15, maxX: 25, minZ: -9.8, maxZ: 0.2 },
  guard: { x: 18, z: -6.2 },
  elevator: { x: 23, z: -12.2 },
  chaseSpeed: 3.6, climbSpeed: 0.55, fastClimbSpeed: 1.65,
} as const;

export function createStageTwoProgress(): StageTwoProgress {
  return { checkpoint: 'passage', crowbarCollected: false, crateBroken: false, guardDown: false,
    codeRead: false, lightsaberCollected: false, elevatorUnlocked: false,
    remoteRooms: { scene5: { cleared: new Set(), rewardCollected: false },
      scene6: { cleared: new Set(), rewardCollected: false } } };
}

export const VENT_MAZE = [
  '#########',
  '#S......#',
  '###.###.#',
  '#...#...#',
  '#.###.#.#',
  '#.....#E#',
  '#########',
] as const;
export const VENT_CELL_SIZE = 2;
export const VENT_ORIGIN = { x: 6, z: -11.5 };
export const VENT_SOLUTION = 'Go RIGHT across the top corridor, then DOWN the right-hand edge to the green CAMERA ROOM exit.';
export const VENT_ROUTE = [{ column: 1, row: 1 }, { column: 7, row: 1 }, { column: 7, row: 5 }] as const;
export const VENT_SAFE_CELLS = [{ column: 1, row: 1 }, { column: 3, row: 1 }, { column: 7, row: 2 }] as const;
export const VENT_SENSORS = [
  { id: 'vent-sensor-top', column: 5, row: 1, axis: 'z', phase: 0 },
  { id: 'vent-sensor-exit', column: 7, row: 3, axis: 'x', phase: 3 },
] as const;

export function ventPoint(column: number, row: number, height: number = STAGE_TWO.ladder.height) {
  return new THREE.Vector3(VENT_ORIGIN.x + column * VENT_CELL_SIZE, height, VENT_ORIGIN.z + row * VENT_CELL_SIZE);
}
export function ventSensorState(index: number, time: number) {
  const sensor = VENT_SENSORS[index];
  if (!sensor) throw new Error(`Unknown vent sensor ${index}`);
  const phase = (time + sensor.phase) % 8;
  const position = ventPoint(sensor.column, sensor.row, STAGE_TWO.ladder.height + 0.5);
  position[sensor.axis] += Math.sin((time + sensor.phase) * Math.PI / 3.5) * 0.73;
  return { position, active: phase < 4.5 };
}
export function isSurveillancePoint(point: { x: number; y: number; z: number }) {
  const room = STAGE_TWO.camera;
  return point.x > room.minX + 0.4 && point.x < room.maxX - 0.4 && point.z > room.minZ + 0.4
    && point.z < room.maxZ - 0.4 && point.y >= 0.2 && point.y < 1;
}

const mazeBlocks: ShipMapBlock[] = VENT_MAZE.flatMap((line, row) => [...line].flatMap((cell, column): ShipMapBlock[] =>
  cell === '#' ? [{ size: [2, 1.3, 2], position: [(column - 4) * 2, 0.65, (row - 3) * 2] }] : []));
export const STAGE_TWO_MAP: ShipMapLayout = {
  name: 'Stage Two service deck', initialRoom: 32,
  joins: [{ from: { room: 31, portal: 'airlock' }, to: { room: 32, portal: 'airlock' } }],
  rooms: [
    { id: 32, name: 'Service patrol passage', deck: 'main', width: 5, depth: 34,
      position: new THREE.Vector3(0, 0, -11), yaw: 0,
      description: 'Two distracted patrol robots / Storeroom on the right',
      portals: { airlock: { x: 0, z: 17, yaw: Math.PI }, storage: { x: 2.5, z: 3, yaw: -Math.PI / 2 } } },
    { id: 33, name: 'Maintenance storeroom', deck: 'main', width: 7, depth: 6,
      position: new THREE.Vector3(6, 0, -8), yaw: 0, description: 'Crowbar chest / Breakable ladder crate / Vent escape',
      portals: { passage: { x: -3.5, z: 0, yaw: Math.PI / 2 } } },
    { id: 34, name: 'Sensor vent maze', deck: 'upper', width: 18, depth: 14,
      position: new THREE.Vector3(14, 18, -5.5), yaw: 0, portals: {}, description: VENT_SOLUTION, mapContents: mazeBlocks },
    { id: 35, name: 'Surveillance room', deck: 'main', width: 10, depth: 10,
      position: new THREE.Vector3(20, 0, -4.8), yaw: 0, description: 'Silent takedown / CCTV teleport links / Hidden lift keypad',
      portals: { lift: { x: 3, z: -5, yaw: 0 } } },
    { id: 36, name: 'Bay 13 service elevator', deck: 'main', width: 4, depth: 4.8,
      position: new THREE.Vector3(23, 0, -12.2), yaw: 0, description: 'Bay 14 circuit broken / Select Bay 13',
      portals: { camera: { x: 0, z: 2.4, yaw: Math.PI }, bay13: { x: 0, z: -2.4, yaw: 0 } } },
  ],
  connections: [[32, 33], [33, 34], [34, 35], [35, 36]],
  playerPoint: (id, point) => new THREE.Vector3(point.x, id === 34 ? 20.2 : 2.2, point.z),
  verticalLinks: [
    { id: 33, position: new THREE.Vector3(8, 0, -9.5), upper: 18, label: 'Storeroom ladder' },
    { id: 35, position: new THREE.Vector3(20, 0, -1.5), upper: 18, label: 'Surveillance hatch' },
  ],
};

export function cameraVisitMap(id: 5 | 6 | 37): ShipMapLayout {
  const name = id === 5 ? 'CCTV cargo hold' : id === 6 ? 'CCTV target range' : 'Sealed equipment archive';
  return { name, initialRoom: id, connections: [], playerPoint: (_id, point) => new THREE.Vector3(point.x, 2.2, point.z),
    rooms: [{ id, name, deck: 'main', width: id === 37 ? 8 : 10, depth: id === 37 ? 8 : 10,
      position: new THREE.Vector3(), yaw: 0, portals: {}, description: 'Camera-linked room / Press T to return to your surveillance marker' }] };
}

export const BAY_THIRTEEN_MAP: ShipMapLayout = {
  name: 'Bay 13 arena', initialRoom: 13,
  joins: [{ from: { room: 36, portal: 'bay13' }, to: { room: 13, portal: 'elevator' } }],
  rooms: [{ id: 13, name: 'Bay 13 / Bay Warden arena', deck: 'lower', width: 40, depth: 48,
    position: new THREE.Vector3(0, -18, 0), yaw: 0, portals: { elevator: { x: 0, z: -24, yaw: Math.PI } },
    description: 'Bay Warden boss / Central lift to the Bay 14 hangar' }],
  connections: [], playerPoint: (_id, point) => new THREE.Vector3(point.x, -15.8, point.z),
};

export const BAY_FOURTEEN_MAP: ShipMapLayout = {
  name: 'Bay 14 escape hangar', initialRoom: 14, rooms: [{
    id: 14, name: 'Bay 14 / Escape hangar', deck: 'lower', width: 36, depth: 72,
    position: new THREE.Vector3(0, -36, 0), yaw: 0, portals: {}, description: 'Reach the shuttle and escape the ship',
  }], connections: [], playerPoint: (_id, point) => new THREE.Vector3(point.x, -33.8, point.z),
};
