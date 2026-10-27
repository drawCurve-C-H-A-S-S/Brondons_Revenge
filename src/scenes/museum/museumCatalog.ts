export type MuseumWall = "north" | "south" | "west" | "east";
export type PaintingTheme =
  | "stealth"
  | "vents"
  | "surveillance"
  | "cargo"
  | "range"
  | "archive"
  | "rust"
  | "warden"
  | "escape"
  | "flight"
  | "jungle"
  | "facility"
  | "finale";
export type ExhibitKind =
  | "eyeDrone"
  | "cctv"
  | "crates"
  | "target"
  | "bloomstick"
  | "ironBars"
  | "scavenger"
  | "warden"
  | "ship"
  | "dino"
  | "terminal"
  | "mech";

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

export const WING_SIGNS: Record<"north" | "south" | "east", string> = {
  north: "LEVEL 1  -  THE MOTHERSHIP",
  south: "LEVEL 2  -  THE FLIGHT",
  east: "LEVEL 3  -  THE JUNGLE",
};

export const MUSEUM_EXHIBITS: readonly MuseumExhibit[] = [
  {
    id: 1.1,
    title: "DECK ONE HANGAR",
    caption: "Three difficulties / exit ladder",
    wall: "north",
    theme: "stealth",
    kind: "eyeDrone",
    sceneKeys: [],
  },
  {
    id: 1.25,
    title: "CAMERA ROOM",
    caption: "Speedrun / printable record",
    wall: "north",
    theme: "surveillance",
    kind: "cctv",
    sceneKeys: [
      "stage2-infiltration",
      "scene5",
      "scene6",
      "stage2-armory",
      "stage2-rust",
      "stage2-rust2",
      "stage2-reactor",
    ],
  },
  {
    id: 13,
    title: "BAY WARDEN",
    caption: "Time + health / finisher QTE",
    wall: "north",
    theme: "warden",
    kind: "warden",
    sceneKeys: ["scene13", "scene13_5"],
  },
  {
    id: 14,
    title: "QTE ESCAPE",
    caption: "Escape QTE / ungraded",
    wall: "north",
    theme: "escape",
    kind: "scavenger",
    sceneKeys: [],
  },
  {
    id: 15,
    title: "LEVEL 2  /  THE FLIGHT",
    caption: "Dogfight to crash landing",
    wall: "south",
    theme: "flight",
    kind: "ship",
    sceneKeys: ["scene15"],
  },
  {
    id: 17,
    title: "BRIDGE AND WATERFALL",
    caption: "Endless ambush / waterfall warden",
    wall: "east",
    theme: "jungle",
    kind: "dino",
    sceneKeys: [],
    lift: 0.7,
  },
  {
    id: 21,
    title: "THE FINAL FIGHT",
    caption: "Final boss, all phases",
    wall: "east",
    theme: "finale",
    kind: "mech",
    sceneKeys: [],
  },
];

const SPACING: Record<MuseumWall, number> = {
  north: 7,
  south: 10,
  east: 8,
  west: 8,
};

/** Paintings are spaced evenly along their wall; columns sit on the gaps between them. */
export function paintingOffsets(wall: MuseumWall) {
  const entries = MUSEUM_EXHIBITS.filter((exhibit) => exhibit.wall === wall);
  const spacing = SPACING[wall];
  return entries.map((exhibit, index) => ({
    exhibit,
    offset: (index - (entries.length - 1) / 2) * spacing,
    spacing,
  }));
}
