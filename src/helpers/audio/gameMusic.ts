import { AudioManager } from './AudioManager.js';
import { preloadMusic } from './bufferedMusic.js';
import type { FinalePhase } from '../../scripts/finaleDirector.js';
import loading from '../../assets/bgm/Loading.ogg?url';
import prologue from '../../assets/bgm/Prologue less mashing .ogg?url';
import livingQuarters from '../../assets/bgm/Living quarters.ogg?url';
import menu from '../../assets/bgm/Menu.ogg?url';
import stealth1 from '../../assets/bgm/Stealth1.ogg?url';
import stealth2 from '../../assets/bgm/Stealth1 2.ogg?url';
import stealthAlert from '../../assets/bgm/Stealth1 3.ogg?url';
import tension from '../../assets/bgm/Tension.ogg?url';
import puzzle from '../../assets/bgm/Puzzle_.ogg?url';
import boss from '../../assets/bgm/Some boss_.ogg?url';
import ship from '../../assets/bgm/DonRevBGM1.ogg?url';
import finalBattle from '../../assets/bgm/Final battle.ogg?url';
import level2 from '../../assets/bgm/DonRevLevel2.ogg?url';
import level2Boss from '../../assets/bgm/DonRevLevel2Boss.ogg?url';
import planet from '../../assets/bgm/Planetbfm.ogg?url';
import brokenChains from '../../assets/bgm/BrokenChainsBGm.ogg?url';
import credits from '../../assets/bgm/Level 2.ogg?url';

export const MUSIC_URLS = {
  loading, prologue, 'living-quarters': livingQuarters, menu,
  'stealth-1': stealth1, 'stealth-2': stealth2, 'stealth-alert': stealthAlert, tension, puzzle, boss,
  ship, 'final-battle': finalBattle, 'level-2': level2, 'level-2-boss': level2Boss, planet, 'broken-chains': brokenChains, credits,
} as const;
export type BackgroundMusicTrack = Exclude<keyof typeof MUSIC_URLS, 'menu'>;
export interface SceneMusicState {
  getMusicTrack?(): BackgroundMusicTrack;
  hasBossVictory?(): boolean;
}
export const FINAL_BOSS_CROSSFADE_SECONDS = 3;
export const MUSIC_CROSSFADE_SECONDS = 0.9;

const sources = new Map<string, string>(Object.entries(MUSIC_URLS));
const sceneTracks = new Map<string, BackgroundMusicTrack>([
  ['scene1', 'loading'], ['prologue1', 'prologue'], ['living-quarters', 'living-quarters'],
  ['stage1-storage', 'stealth-1'], ['scene5', 'puzzle'], ['scene6', 'puzzle'], ['scene13', 'boss'], ['scene14', 'ship'],
  ['scene15', 'level-2'], ['scene16', 'level-2'], ['scene17', 'planet'],
  ['scene20', 'stealth-2'], ['scene21', 'loading'],
]);

/** `bombDetonated` tells the phases that straddle the Planet Breaker blast (rupture, defeat) which side they are on. */
export function finaleMusicTrack(phase: FinalePhase, bombDetonated = false): BackgroundMusicTrack {
  if (phase === 'credits' || phase === 'done') return 'credits';
  if (phase === 'loading' || phase === 'error' || phase === 'reveal' || phase === 'enemyTransform'
    || phase === 'heroTransform' || phase === 'versus') return 'loading';
  return bombDetonated || phase === 'space' || phase === 'finisher' || phase === 'victory' ? 'final-battle' : 'ship';
}

function createMusicManager(pauseWithMenu = true) {
  return new AudioManager({ pauseWithMenu, getFile: (path: string) => {
    const source = sources.get(path);
    return source ? { content: source } : null;
  } });
}

export function createGameMusic() {
  const background = createMusicManager(false);
  const menuMusic = createMusicManager(false);
  let sceneId: string | null = null, sceneData: SceneMusicState | null = null;
  let track: BackgroundMusicTrack | null = null;
  let menuOpen = false, paused = false;

  function setTrack(next: BackgroundMusicTrack | null) {
    if (next === track) return;
    track = next;
    if (!next) { background.stopBgm(); return; }
    const settings = { path: next, loop: true, volume: next.startsWith('level-2') ? 0.45 : 0.5, autoplay: !paused };
    const immediate = next === 'prologue' || next === 'stealth-alert' || next === 'broken-chains';
    if (background.bgm && !paused && !immediate) {
      background.crossfadeBgm(settings, sceneId === 'scene21' && next === 'ship'
        ? FINAL_BOSS_CROSSFADE_SECONDS : MUSIC_CROSSFADE_SECONDS);
    } else background.setBgm(settings);
  }
  function syncScene() {
    setTrack(sceneData?.getMusicTrack?.() ?? (sceneId ? sceneTracks.get(sceneId) : null) ?? null);
  }
  return {
    enterScene(id: string | null, data: SceneMusicState | null = null) {
      sceneId = id; sceneData = data; syncScene();
      if (id === 'living-quarters' || id === 'stage1-storage' || id === 'stage2-infiltration') {
        const source = MUSIC_URLS['stealth-alert'];
        void preloadMusic(source).catch(error => console.warn('[Audio] Immediate music preparation failed:', error));
      }
      if (id === 'scene21') {
        void preloadMusic(MUSIC_URLS.credits).catch(error => console.warn('[Audio] Credits preparation failed:', error));
      }
    },
    setMenuOpen(open: boolean) {
      if (menuOpen === open) return;
      menuOpen = open;
      if (open) menuMusic.setBgm({ path: 'menu', loop: true, volume: 0.5, autoplay: true });
      else menuMusic.stopBgm();
    },
    setPaused(value: boolean) {
      if (paused === value) return;
      paused = value;
      if (value) background.pauseBgm();
      else background.playBgm();
    },
    setWeaponWheelOpen(open: boolean) { background.setBgmMuffled(open); },
    update(deltaTime: number) { syncScene(); background.update(deltaTime); menuMusic.update(deltaTime); },
    dispose() {
      background.dispose(); menuMusic.dispose();
    },
  };
}
