const artwork = import.meta.glob<string>('../assets/loading/*.jpg', { eager: true, query: '?url', import: 'default' });
function image(name: string) {
  const url = artwork[`../assets/loading/${name}.jpg`];
  if (!url) throw new Error(`Missing chapter screenshot: ${name}`);
  return url;
}
export const LOADING_IMAGE_URLS = Object.values(artwork);

export const LOADING_CHAPTERS = {
  opening: {
    chapter: 'OPENING / SPACE PROLOGUE', title: 'BRONDON\'S REVENGE', images: [image('space-opening')],
    tips: ['The opening follows the mothership. Hold Enter to skip once it begins.', 'Press M to review your controls.'],
  },
  prologue: {
    chapter: 'PROLOGUE / AWAKENING', title: 'THE PRISON', images: [image('prologue-prison')],
    tips: ['Listen to Prime to discover what happened aboard the ship.', 'After awakening, press E to teleport to your cabin.'],
  },
  quarters: {
    chapter: 'LEVEL 1 / LIVING QUARTERS', title: 'THE CREW CABINS', images: [image('living-quarters')],
    tips: ['Recover your pistol from Brondon\'s chest before leaving the cabins.',
      'Brendan has the teleport crystal. Branden has the scanner goggles.', 'Branden\'s computer holds the forward bulkhead password.'],
  },
  stage1: {
    chapter: 'LEVEL 1 / STEALTH STAGE', title: 'DECK ONE HANGAR', images: [image('stage1-overview'), image('stage1-patrol')],
    tips: ['Let the eye drone pass. Close the storage door, then slip out behind it.',
      'Peeking lets you watch a patrol without leaving cover.', 'Use the containers to break a drone\'s line of sight.',
      'Reach the hangar to secure your next checkpoint.'],
  },
  stage2: {
    chapter: 'LEVEL 1 / MINIGAME STAGE', title: 'THE SURVEILLANCE HUB', images: [image('stage2-camera-wall')],
    tips: ['Take down the door guard silently before using the cameras.',
      'Set a return marker with Q. Visit a camera room with E and return with T.',
      'Each minigame chest contains a keycard. Try your latest card at the elevator.'],
  },
  cargo: {
    chapter: 'LEVEL 1 / MINIGAME STAGE / CARGO', title: 'THE CARGO HOLD', images: [image('stage2-cargo')],
    tips: ['Move the cargo to solve the room\'s challenge and open its reward chest.',
      'Place your return marker in surveillance before visiting a camera room.'],
  },
  range: {
    chapter: 'LEVEL 1 / MINIGAME STAGE / RANGE', title: 'THE TARGET RANGE', images: [image('stage2-range')],
    tips: ['Use the weapon wheel to choose the right tool for the room.',
      'Collect the keycard from the reward chest, then return with T.'],
  },
  archive: {
    chapter: 'LEVEL 1 / MINIGAME STAGE / ARCHIVE', title: 'THE EQUIPMENT ARCHIVE', images: [image('stage2-archive')],
    tips: ['The sealed archive holds another weapon and a keycard.',
      'Keycards persist when you return to the surveillance room.'],
  },
  boss: {
    chapter: 'LEVEL 1 / BOSS STAGE', title: 'THE BAY WARDEN', images: [image('bay-warden')],
    tips: ['Keep moving. The Bay Warden punishes anyone who stands still.',
      'Shield and health supplies are scattered around the bay.', 'Watch the warden\'s wind-up and get clear before the strike lands.'],
  },
  escape: {
    chapter: 'LEVEL 1 / ESCAPE STAGE', title: 'HANGAR ESCAPE', images: [image('hangar-escape')],
    tips: ['React to the displayed QTE prompt before its timer runs out.', 'The escape shuttle is your route off the mothership.'],
  },
  flight: {
    chapter: 'LEVEL 2 / PHASE 1', title: 'THE INTERCEPTORS', images: [image('level2-space')],
    tips: ['Keep steering while you fire. Staying still makes you an easy target.',
      'Collected shield power-ups can help you survive the next attack.'],
  },
  scrambler: {
    chapter: 'LEVEL 2 / PHASE 2', title: 'THE BLUE SCRAMBLER', images: [image('level2-sidescroll')],
    tips: ['The battle shifts to a side view. Watch the gaps in the incoming attacks.',
      'Directional dodges can carry you out of a dangerous firing lane.'],
  },
  armor: {
    chapter: 'LEVEL 2 / PHASE 3', title: 'CAPITAL SHIP SHIELDS', images: [image('level2-capital-ship')],
    tips: ['Destroy the four shield generators before attacking the reactor.',
      'The capital ship moves across your firing lanes. Keep adjusting your aim.'],
  },
  'red-scrambler': {
    chapter: 'LEVEL 2 / PHASE 4', title: 'THE RED SCRAMBLER', images: [image('level2-topdown')],
    tips: ['The top-down battle opens up the flanks. Keep moving between safe lanes.',
      'Destroy the red scrambler to expose the capital ship\'s final phase.'],
  },
  reactor: {
    chapter: 'LEVEL 2 / PHASE 5', title: 'THE EXPOSED REACTOR', images: [image('level2-capital-ship')],
    tips: ['Fire at the exposed reactor while its shield is down.',
      'The last phase fires denser barrages. Dodge through the open lane.'],
  },
  crash: {
    chapter: 'LEVEL 2 / PHASE 6', title: 'CRASH LANDING', images: [image('level2-crash')],
    tips: ['Follow the escape pod toward the planet.', 'The landing site leads into the jungle and the research facility.'],
  },
  jungle: {
    chapter: 'LEVEL 3 / JUNGLE STAGE', title: 'THE FACILITY APPROACH', images: [image('level3-jungle')],
    tips: ['Follow the stone path and cross the bridge to reach the facility.',
      'Watch the river. Not every threat stays on dry land.', 'Use cover and keep an escape route when patrols close in.'],
  },
  waterfall: {
    chapter: 'LEVEL 3 / SECRET WATERFALL', title: 'BEHIND THE FALLS', images: [image('secret-waterfall')],
    tips: ['The waterfall hides an optional encounter away from the main path.',
      'Defeat the waterfall warden to unseal the arena and claim its reward.'],
  },
  facility: {
    chapter: 'LEVEL 3 / FACILITY STAGE', title: 'AI RESEARCH FACILITY', images: [image('facility')],
    tips: ['Read the research logs before sequencing the facility panel.',
      'The station clues reveal the correct order. Explore before guessing.'],
  },
  finale: {
    chapter: 'LEVEL 3 / FINAL BOSS', title: 'SUDOERS 5 / THE LAST LIGHT', images: [image('finale-rooftop'), image('finale-orbit')],
    tips: ['Hold R to block. Raise your shield just before impact to reflect an attack.',
      'Move toward your opponent and press Space to step over and switch sides.',
      'E unleashes a flying sword slash. Give the ultimate time to recharge.',
      'Watch the closing QTE ring. Mash D or hold E when the prompt calls for it.'],
  },
} as const;
export type LoadingChapterId = keyof typeof LOADING_CHAPTERS;
export type LoadingDestination = LoadingChapterId | 'game';

export const SCENE_CHOICES = [
  [1, 'Opening - Space prologue'], [0, 'Prologue - Awakening'],
  [0.5, 'Level 1 - Living quarters'],
  [1.1, 'Level 1 Stealth Stage - Deck One hangar'],
  [1.2, 'Level 1 Minigame Stage - Vents and surveillance'],
  [5, 'Level 1 Minigame Stage - Cargo hold'], [6, 'Level 1 Minigame Stage - Target range'],
  [1.3, 'Level 1 Minigame Stage - Equipment archive'],
  [13, 'Level 1 Boss Stage - Bay Warden'], [14, 'Level 1 Escape Stage - Hangar escape'],
  [15, 'Level 2 Phase 1 - Interceptors'], [15.5, 'Level 2 Phase 2 - Blue scrambler'],
  [15.6, 'Level 2 Phase 3 - Capital ship shields'], [15.75, 'Level 2 Phase 4 - Red scrambler'],
  [15.9, 'Level 2 Phase 5 - Exposed reactor'], [16, 'Level 2 Phase 6 - Crash landing'],
  [17, 'Level 3 Jungle Stage - Bridge and secret waterfall'],
  [20, 'Level 3 Facility Stage - AI research facility'], [21, 'Level 3 Final Boss - Sudoers 5'],
] as const;

export function createLoadingSlideDeck(destination: LoadingDestination, random = Math.random) {
  const ids: LoadingChapterId[] = destination === 'game' ? Object.keys(LOADING_CHAPTERS) as LoadingChapterId[] : [destination];
  const slides = ids.flatMap(id => LOADING_CHAPTERS[id].images.map(image => ({ id, image, content: LOADING_CHAPTERS[id] })));
  let remaining: typeof slides = [], previousImage = '';
  return {
    next() {
      if (!remaining.length) {
        remaining = slides.slice();
        for (let index = remaining.length - 1; index > 0; index--) {
          const other = Math.floor(random() * (index + 1));
          [remaining[index], remaining[other]] = [remaining[other], remaining[index]];
        }
      }
      const different = remaining.findIndex(slide => slide.image !== previousImage);
      const index = different < 0 ? remaining.length - 1 : different;
      const slide = remaining.splice(index, 1)[0]; previousImage = slide.image;
      const tip = slide.content.tips[Math.floor(random() * slide.content.tips.length)];
      return { ...slide, tip };
    },
  };
}
