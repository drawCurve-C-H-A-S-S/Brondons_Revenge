import * as THREE from 'three';
import type { ShipRoom, ShipMapBlock } from '../../scripts/global/shipLayout.js';
import type { ShipMapLayout } from '../../core/shipMap.js';

export type CabinId = 'brondon' | 'branden' | 'brendan'
  | 'student-01' | 'student-02' | 'student-03' | 'student-04' | 'student-05';
export type QuartersLocation = CabinId | 'hallway';
export interface CabinDefinition {
  id: CabinId;
  mapId: number;
  occupant: string;
  role: 'lecturer' | 'student';
  side: -1 | 1;
  slot: number;
  z: number;
  code: string;
  locked: boolean;
  accent: number;
  quote: string;
}

export const QUARTERS = {
  hallwayWidth: 4.8, hallwayLength: 32, cabinWidth: 5.8, cabinDepth: 6.8, height: 3.2,
  doorWidth: 1.6, doorHeight: 2.5, wallThickness: 0.18, interactionRange: 2.1,
  slots: [-11.4, -3.8, 3.8, 11.4],
} as const;

const cabin = (id: CabinId, mapId: number, occupant: string, side: -1 | 1, slot: number,
  accent: number, quote: string): CabinDefinition => ({
  id, mapId, occupant, side, slot, z: QUARTERS.slots[slot], code: `${side < 0 ? 'L' : 'R'}-0${slot + 1}`,
  role: id.startsWith('student-') ? 'student' : 'lecturer', locked: id.startsWith('student-'), accent, quote,
});

export const CABINS: readonly CabinDefinition[] = [
  cabin('brondon', 21, 'Brondon', -1, 0, 0x65d9e8, 'The next horizon is a question worth asking. Wits for good.'),
  cabin('student-01', 22, 'Caleb', -1, 1, 0x9caae6, 'Small steps can cross the greatest distances.'),
  cabin('student-02', 23, 'Husain', -1, 2, 0xe5b878, 'Look beyond the charts. Discovery starts there.'),
  cabin('branden', 24, 'Branden', -1, 3, 0xe3bf75, 'Plan the journey. Terrorise with Claude.'),
  cabin('brendan', 25, 'Brendan', 1, 0, 0x83d5ae, 'Every star is a reason to keep exploring. Gitea server was on fire, is this a sign?'),
  cabin('student-03', 26, "Andre'", 1, 1, 0xc891d9, 'Bring curiosity. Leave no crewmate behind.'),
  cabin('student-04', 27, 'Sibusiso', 1, 2, 0x86bfe3, 'A good expedition returns with better questions.'),
  cabin('student-05', 28, 'Sohrab', 1, 3, 0xd79786, 'The universe is vast. Our courage can be, too.'),
];
export const CABIN_BY_ID = new Map(CABINS.map(cabin => [cabin.id, cabin]));
export const FORWARD_BULKHEAD_CODE = '4817';

/** Student cabins are sealed in the campaign; developer mode opens them. */
export function setStudentCabinAccess(open: boolean) {
  for (const cabin of CABINS) if (cabin.role === 'student') cabin.locked = !open;
  for (const room of LIVING_QUARTERS_MAP.rooms) {
    const cabin = CABINS.find(candidate => candidate.mapId === room.id);
    if (!cabin) continue;
    room.locked = cabin.locked;
    room.description = cabin.locked ? 'Student cabin / Interior unavailable' : `${cabin.role === 'student' ? 'Student' : 'Lecturer'} cabin / Bed, workstation${cabin.role === 'lecturer' ? ' and personal chest' : ''}`;
  }
}

export function cabinRoomName(cabin: CabinDefinition) {
  return `${cabin.occupant}${cabin.occupant.endsWith("'") ? 's' : "'s"} room`;
}

export function cabinCenter(cabin: CabinDefinition) {
  return new THREE.Vector3(cabin.side * (QUARTERS.hallwayWidth + QUARTERS.cabinWidth) / 2, 0, cabin.z);
}
export function cabinPoint(cabin: CabinDefinition, x: number, y: number, z: number) {
  return cabinCenter(cabin).add(new THREE.Vector3(cabin.side * x, y, z));
}
export function cabinDoorPoint(cabin: CabinDefinition) {
  return new THREE.Vector3(cabin.side * QUARTERS.hallwayWidth / 2, 0, cabin.z);
}

export interface QuartersProgress {
  arrivalSeen: boolean;
  pistolCollected: boolean;
  lightsaberCollected: boolean;
  crystalCollected: boolean;
  gogglesCollected: boolean;
  rescueMessageRead: boolean;
  bulkheadUnlocked: boolean;
  visited: Set<CabinId>;
  openedChests: Set<CabinId>;
}
export function createQuartersProgress(): QuartersProgress {
  return { arrivalSeen: false, pistolCollected: false, lightsaberCollected: false,
    crystalCollected: false, gogglesCollected: false,
    rescueMessageRead: false, bulkheadUnlocked: false,
    visited: new Set(), openedChests: new Set() };
}
export function quartersEquipmentReady(progress: QuartersProgress) {
  return progress.pistolCollected && progress.crystalCollected && progress.gogglesCollected && progress.lightsaberCollected;
}
export function quartersObjective(progress: QuartersProgress) {
  if (!quartersEquipmentReady(progress)) return 'Look around the crew cabins for useful items before leaving';
  return progress.bulkheadUnlocked ? 'Enter the Deck One patrol passage' : 'Look around the crew cabins for a way through the forward bulkhead';
}
export function quartersExitHint(progress: QuartersProgress) {
  if (!progress.pistolCollected) return 'You may have left something useful in your own chest.';
  if (!progress.crystalCollected) return "Brendan kept an unusual purple shard in his chest.";
  if (!progress.gogglesCollected) return "Try Branden's chest. His survey gear could come in handy.";
  if (!progress.lightsaberCollected) return "Check Andre's locker in the communal bathroom.";
  if (!progress.bulkheadUnlocked) return progress.rescueMessageRead
    ? 'Try the password you found at the number panel beside the bulkhead.'
    : "Branden's computer may hold a way through this bulkhead.";
  return null;
}

export function cabinMapContents(cabin: CabinDefinition): ShipMapBlock[] {
  const at = (size: ShipMapBlock['size'], x: number, y: number, z: number): ShipMapBlock =>
    ({ size, position: [cabin.side * x, y, z] });
  return [
    at([1.6, 0.62, 2.45], 1.65, 0.31, -1.7),
    at([1.85, 0.84, 0.92], -0.55, 0.42, 2.65),
    at([0.55, 0.4, 0.12], -0.55, 1.08, 2.75),
    at([0.6, 1.12, 0.77], -0.55, 0.56, 1.65),
    ...(cabin.role === 'lecturer' ? [at([0.8, 0.68, 1.3], 1.7, 0.34, 0.65)] : []),
  ];
}
const hallway: ShipRoom = {
  id: 20, name: 'Living quarters passage', deck: 'main', width: QUARTERS.hallwayWidth,
  depth: QUARTERS.hallwayLength, position: new THREE.Vector3(), yaw: 0, portalWidth: QUARTERS.doorWidth,
  description: 'No surveillance / Eight crew cabins / Keypad bulkhead to the Deck One patrol passage',
  portals: Object.fromEntries([
    ...CABINS.map(cabin => [cabin.id, { x: cabin.side * QUARTERS.hallwayWidth / 2, z: cabin.z, yaw: cabin.side * Math.PI / 2 }]),
    ['forward', { x: 0, z: QUARTERS.hallwayLength / 2, yaw: Math.PI }],
  ]),
};
export const LIVING_QUARTERS_MAP: ShipMapLayout = {
  name: 'Living Quarters', initialRoom: 21,
  rooms: [hallway, ...CABINS.map((cabin): ShipRoom => ({
    id: cabin.mapId, name: cabinRoomName(cabin), deck: 'main', width: QUARTERS.cabinWidth,
    depth: QUARTERS.cabinDepth, position: cabinCenter(cabin), yaw: 0, locked: cabin.locked,
    portalWidth: QUARTERS.doorWidth,
    portals: { entrance: { x: -cabin.side * QUARTERS.cabinWidth / 2, z: 0, yaw: -cabin.side * Math.PI / 2 } },
    description: cabin.locked ? 'Student cabin / Interior unavailable' : 'Lecturer cabin / Bed, workstation and personal chest',
    mapContents: cabinMapContents(cabin),
  }))],
  connections: CABINS.map(cabin => [20, cabin.mapId] as const),
  playerPoint: (_id, point) => new THREE.Vector3(point.x, 2.2, point.z),
};
