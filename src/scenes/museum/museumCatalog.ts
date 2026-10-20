export type MuseumWall = 'north' | 'south' | 'west' | 'east';
export type PaintingTheme = 'stealth' | 'vents' | 'cargo' | 'range' | 'archive' | 'rust' | 'warden' | 'escape'
  | 'flight' | 'jungle' | 'facility' | 'finale';
export type ExhibitKind = 'eyeDrone' | 'cctv' | 'crates' | 'target' | 'lightsaber' | 'ironBars' | 'trilobite' | 'warden'
  | 'ship' | 'dino' | 'terminal' | 'mech';

export interface MuseumExhibit {
  /** The id understood by the scene jumper, so every painting maps onto an existing stage. */
  id: number;
  title: string;
  caption: string;
  wall: MuseumWall;
  theme: PaintingTheme;
  kind: ExhibitKind;
  /** Scene keys that make up this stage. Results show only once the player leaves all of them. */
  sceneKeys: readonly string[];
  /** Extra height of the pedestal figure above the plinth. */
  lift?: number;
}

export const MUSEUM_HALL = { halfX: 30, halfZ: 20, height: 10 } as const;

export const WING_SIGNS: Record<'north' | 'south' | 'east', string> = {
  north: 'LEVEL 1  -  THE MOTHERSHIP',
  south: 'LEVEL 2  -  THE FLIGHT',
  east: 'LEVEL 3  -  THE JUNGLE',
};

export const MUSEUM_EXHIBITS: readonly MuseumExhibit[] = [
  { id: 1.1, title: 'DECK ONE HANGAR', caption: 'Stealth stage', wall: 'north', theme: 'stealth', kind: 'eyeDrone', sceneKeys: [] },
  { id: 1.2, title: 'VENT MAZE', caption: 'Minigame stage', wall: 'north', theme: 'vents', kind: 'cctv', sceneKeys: [] },
  { id: 5, title: 'CARGO HOLD', caption: 'Minigame stage', wall: 'north', theme: 'cargo', kind: 'crates', sceneKeys: ['stage2-infiltration'] },
  { id: 6, title: 'TARGET RANGE', caption: 'Minigame stage', wall: 'north', theme: 'range', kind: 'target', sceneKeys: ['stage2-infiltration'] },
  { id: 1.3, title: 'EQUIPMENT ARCHIVE', caption: 'Minigame stage', wall: 'north', theme: 'archive', kind: 'lightsaber', sceneKeys: ['stage2-infiltration'] },
  { id: 1.4, title: 'RUST CHAMBER', caption: 'Minigame stage', wall: 'north', theme: 'rust', kind: 'ironBars', sceneKeys: ['stage2-infiltration'] },
  { id: 13, title: 'BAY WARDEN', caption: 'Boss fight, all phases', wall: 'north', theme: 'warden', kind: 'warden', sceneKeys: ['scene13', 'scene13_5'] },
  { id: 14, title: 'QTE ESCAPE', caption: 'Escape stage', wall: 'north', theme: 'escape', kind: 'trilobite', sceneKeys: [] },
  { id: 15, title: 'LEVEL 2  /  THE FLIGHT', caption: 'Dogfight to crash landing', wall: 'south', theme: 'flight', kind: 'ship', sceneKeys: ['scene15'] },
  { id: 17, title: 'BRIDGE AND WATERFALL', caption: 'Jungle stage', wall: 'east', theme: 'jungle', kind: 'dino', sceneKeys: [], lift: 0.7 },
  { id: 20, title: 'AI RESEARCH FACILITY', caption: 'Facility stage', wall: 'east', theme: 'facility', kind: 'terminal', sceneKeys: ['scene17'] },
  { id: 21, title: 'THE FINAL FIGHT', caption: 'Final boss, all phases', wall: 'east', theme: 'finale', kind: 'mech', sceneKeys: [] },
];

const SPACING: Record<MuseumWall, number> = { north: 7, south: 10, east: 8, west: 8 };

/** Paintings are spaced evenly along their wall; columns sit on the gaps between them. */
export function paintingOffsets(wall: MuseumWall) {
  const entries = MUSEUM_EXHIBITS.filter(exhibit => exhibit.wall === wall);
  const spacing = SPACING[wall];
  return entries.map((exhibit, index) => ({ exhibit, offset: (index - (entries.length - 1) / 2) * spacing, spacing }));
}
