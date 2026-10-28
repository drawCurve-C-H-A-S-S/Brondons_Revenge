const artwork = import.meta.glob<string>("../assets/loading/*.{jpg,png}", {
  eager: true,
  query: "?url",
  import: "default",
});
function image(name: string) {
  const url = optionalImage(name);
  if (!url) throw new Error(`Missing chapter screenshot: ${name}`);
  return url;
}
function optionalImage(name: string): string | undefined {
  return (
    artwork[`../assets/loading/${name}.jpg`] ??
    artwork[`../assets/loading/${name}.png`]
  );
}
// Prefer a newer capture when present, otherwise keep the existing artwork.
function images(...names: string[]) {
  const found = names.flatMap((name) => optionalImage(name) ?? []);
  return found.length ? found : [image(names[0])];
}
export const LOADING_IMAGE_URLS = Object.values(artwork);

export const LOADING_CHAPTERS = {
  prologue: {
    chapter: "PROLOGUE / AWAKENING",
    title: "THE PRISON",
    images: [
      image("cabins"),
      image("stealthbay"),
      image("cargo"),
      image("bloomstick"),
      image("target"),
      image("reactor"),
      image("rust1"),
      image("rust2"),
    ],
  },
  quarters: {
    chapter: "LEVEL 1 / LIVING QUARTERS",
    title: "THE CREW CABINS",
    images: [image("living-quarters")],
  },
  stage1: {
    chapter: "LEVEL 1 / STEALTH STAGE",
    title: "DECK ONE HANGAR",
    images: [image("stage1-overview")],
  },
  stage2: {
    chapter: "LEVEL 1 / MINIGAME STAGE",
    title: "THE SURVEILLANCE HUB",
    images: images("stage2-camera-wall", "stage2-maze"),
  },
  cargo: {
    chapter: "LEVEL 1 / MINIGAME STAGE / CARGO",
    title: "THE CARGO HOLD",
    images: [image("stage2-cargo")],
  },
  range: {
    chapter: "LEVEL 1 / MINIGAME STAGE / RANGE",
    title: "THE TARGET RANGE",
    images: [image("stage2-range")],
  },
  archive: {
    chapter: "LEVEL 1 / MINIGAME STAGE / TENNIS",
    title: "BLOOMSTICK TENNIS",
    images: [image("stage2-archive")],
  },
  rust: {
    chapter: "LEVEL 1 / MINIGAME STAGE / RUST CHAMBER",
    title: "THE RUST CHAMBER",
    images: images("stage2-rust", "stage2-archive"),
  },
  boss: {
    chapter: "LEVEL 1 / BOSS STAGE",
    title: "THE BAY WARDEN",
    images: [image("bay-warden")],
  },
  escape: {
    chapter: "LEVEL 1 / ESCAPE STAGE",
    title: "HANGAR ESCAPE",
    images: [image("hangar-escape")],
  },
  flight: {
    chapter: "LEVEL 2 / PHASE 1",
    title: "THE INTERCEPTORS",
    images: [image("level2-space")],
  },
  scrambler: {
    chapter: "LEVEL 2 / PHASE 2",
    title: "THE GREEN SCRAMBLER",
    images: [image("level2-sidescroll")],
  },
  armor: {
    chapter: "LEVEL 2 / PHASE 3",
    title: "CAPITAL SHIP SHIELDS",
    images: [image("level2-capital-ship")],
  },
  "red-scrambler": {
    chapter: "LEVEL 2 / PHASE 4",
    title: "THE RED SCRAMBLER",
    images: [image("level2-topdown")],
  },
  reactor: {
    chapter: "LEVEL 2 / PHASE 5",
    title: "THE EXPOSED REACTOR",
    images: [image("level2-reactor")],
  },
  crash: {
    chapter: "LEVEL 2 / PHASE 6",
    title: "CRASH LANDING",
    images: [image("level2-crash")],
  },
  jungle: {
    chapter: "LEVEL 3 / JUNGLE STAGE",
    title: "THE FACILITY APPROACH",
    images: [image("level3-jungle")],
  },
  waterfall: {
    chapter: "LEVEL 3 / SECRET WATERFALL",
    title: "BEHIND THE FALLS",
    images: [image("secret-waterfall")],
  },
  facility: {
    chapter: "LEVEL 3 / FACILITY STAGE",
    title: "AI RESEARCH FACILITY",
    images: [image("facility")],
  },
  finale: {
    chapter: "LEVEL 3 / FINAL BOSS",
    title: "SUDOERS 5 / THE LAST LIGHT",
    images: [image("finale-chairs")],
  },
  trailer: {
    chapter: "TRAILER / FIVE CHAIRS",
    title: "FIVE MINDS. ONE HORIZON.",
    images: [image("finale-chairs")],
  },
} as const;
export type LoadingChapterId = keyof typeof LOADING_CHAPTERS;
export type LoadingDestination = LoadingChapterId | "game";

export const SCENE_CHOICES = [
  [1, "Main Menu"],
  [0, "Prologue - Awakening"],
  [0.5, "Level 1 - Living quarters"],
  [1.1, "Level 1 Stealth Stage - Deck One hangar"],
  [1.2, "Level 1 Minigame Stage - Vents and surveillance"],
  [1.25, "Level 1 Minigame Stage - Camera room"],
  [5, "Level 1 Minigame Stage - Cargo hold"],
  [6, "Level 1 Minigame Stage - Target range"],
  [1.3, "Level 1 Minigame Stage - Bloomstick Tennis"],
  [1.4, "Level 1 Minigame Stage - Rust chamber"],
  [1.45, "Level 1 Minigame Stage - Rust chamber 2"],
  [1.5, "Level 1 Minigame Stage - Reactor Sequencer"],
  [13, "Level 1 Boss Stage - Bay Warden"],
  [13.5, "Level 1 Boss Stage - Bay Warden Phase 4"],
  [14, "Level 1 Escape Stage - Hangar escape"],
  [15, "Level 2 Phase 1 - Interceptors"],
  [15.5, "Level 2 Phase 2 - Green scrambler"],
  [15.6, "Level 2 Phase 3 - Capital ship shields"],
  [15.75, "Level 2 Phase 4 - Red scrambler"],
  [15.9, "Level 2 Phase 5 - Exposed reactor"],
  [16, "Level 2 Phase 6 - Crash landing"],
  [17, "Level 3 Jungle Stage - Bridge and secret waterfall"],
  [20, "Level 3 Facility Stage - AI research facility"],
  [21, "Level 3 Final Boss - Sudoers 5"],
  [21.5, "Level 3 Final Boss - Bomb release / 50% health"],
  [21.9, "Level 3 Final Boss - Final cinematic start"],
  [22, "Epilogue - Rolling credits"],
  [99, "Brondon's Museum"],
  [100, "Trailer - Five Chairs"],
] as const;

export function createLoadingSlideDeck(
  destination: LoadingDestination,
  random = Math.random,
) {
  const ids: LoadingChapterId[] =
    destination === "game"
      ? (Object.keys(LOADING_CHAPTERS) as LoadingChapterId[])
      : [destination];
  const seen = new Set<string>();
  const slides = ids.flatMap((id) =>
    LOADING_CHAPTERS[id].images
      .filter((image) => {
        if (seen.has(image)) return false;
        seen.add(image);
        return true;
      })
      .map((image) => ({ id, image, content: LOADING_CHAPTERS[id] })),
  );
  let remaining: typeof slides = [],
    previousImage = "";
  return {
    next() {
      if (!remaining.length) {
        remaining = slides.slice();
        for (let index = remaining.length - 1; index > 0; index--) {
          const other = Math.floor(random() * (index + 1));
          [remaining[index], remaining[other]] = [
            remaining[other],
            remaining[index],
          ];
        }
      }
      const different = remaining.findIndex(
        (slide) => slide.image !== previousImage,
      );
      const index = different < 0 ? remaining.length - 1 : different;
      const slide = remaining.splice(index, 1)[0];
      previousImage = slide.image;
      return slide;
    },
  };
}
