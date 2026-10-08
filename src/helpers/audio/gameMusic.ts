import { AudioManager } from './AudioManager.js';
import { preloadMusic, type BufferedMusic } from './bufferedMusic.js';
import type { FinalePhase } from '../../scripts/finaleDirector.js';
import loading from '../../assets/bgm/Loading.m4a?url';
import emotional from '../../assets/bgm/Emotional.m4a?url';
import livingQuarters from '../../assets/bgm/Living quarters.m4a?url';
import menu from '../../assets/bgm/Menu.m4a?url';
import stealth1 from '../../assets/bgm/Stealth1.m4a?url';
import stealth2 from '../../assets/bgm/Stealth1 2.m4a?url';
import stealthAlert from '../../assets/bgm/Stealth1 3.m4a?url';
import ship from '../../assets/bgm/DonRevBGM1.m4a?url';
import level2 from '../../assets/bgm/DonRevLevel2.m4a?url';
import level2Boss from '../../assets/bgm/DonRevLevel2Boss.m4a?url';
import jungle from '../../assets/bgm/DonRevJungleLoop.m4a?url';
import victory from '../../assets/bgm/Victory boss 1.m4a?url';
import credits from '../../assets/bgm/Level 2.m4a?url';

export const MUSIC_URLS = {
  loading, emotional, 'living-quarters': livingQuarters, menu,
  'stealth-1': stealth1, 'stealth-2': stealth2, 'stealth-alert': stealthAlert,
  ship, 'level-2': level2, 'level-2-boss': level2Boss, jungle, victory, credits,
} as const;
export type BackgroundMusicTrack = Exclude<keyof typeof MUSIC_URLS, 'menu' | 'victory'>;
export interface SceneMusicState {
  getMusicTrack?(): BackgroundMusicTrack;
  hasBossVictory?(): boolean;
}
export const FINAL_BOSS_CROSSFADE_SECONDS = 3;
export const MUSIC_CROSSFADE_SECONDS = 0.9;

const sources = new Map<string, string>(Object.entries(MUSIC_URLS));
const sceneTracks = new Map<string, BackgroundMusicTrack>([
  ['scene1', 'loading'], ['prologue1', 'emotional'], ['living-quarters', 'living-quarters'],
  ['stage1-storage', 'stealth-1'], ['scene13', 'ship'], ['scene14', 'ship'],
  ['scene15', 'level-2'], ['scene16', 'level-2'], ['scene17', 'jungle'],
  ['scene18', 'jungle'], ['scene19', 'jungle'], ['scene21', 'loading'],
]);

export function finaleMusicTrack(phase: FinalePhase): BackgroundMusicTrack {
  if (phase === 'credits' || phase === 'done') return 'credits';
  if (phase === 'loading' || phase === 'error' || phase === 'reveal' || phase === 'enemyTransform'
    || phase === 'heroTransform' || phase === 'versus') return 'loading';
  return 'ship';
}

function createMusicManager(pauseWithMenu = true) {
  return new AudioManager({ pauseWithMenu, getFile: (path: string) => {
    const source = sources.get(path);
    return source ? { content: source } : null;
  } });
}

export function createGameMusic() {
  const background = createMusicManager();
  const victoryMusic = createMusicManager();
  const menuMusic = createMusicManager(false);
  const celebratedScenes = new WeakSet<SceneMusicState>();
  let sceneId: string | null = null, sceneData: SceneMusicState | null = null;
  let track: BackgroundMusicTrack | null = null, victoryAudio: HTMLAudioElement | BufferedMusic | null = null;
  let menuOpen = false, paused = false;

  function clearVictory(resume: boolean) {
    if (!victoryAudio) return;
    victoryAudio.removeEventListener('ended', onVictoryEnded);
    victoryAudio = null;
    victoryMusic.stopBgm();
    if (resume && !paused) background.playBgm();
  }
  function onVictoryEnded() { clearVictory(true); }
  function setTrack(next: BackgroundMusicTrack | null) {
    if (next === 'credits') clearVictory(false);
    if (next === track) return;
    track = next;
    if (!next) { background.stopBgm(); return; }
    const settings = { path: next, loop: true, volume: next.startsWith('level-2') ? 0.45 : 0.5, autoplay: !victoryAudio && !paused };
    if (background.bgm && !victoryAudio && !paused) {
      background.crossfadeBgm(settings, sceneId === 'scene21' && next === 'ship'
        ? FINAL_BOSS_CROSSFADE_SECONDS : MUSIC_CROSSFADE_SECONDS);
    } else background.setBgm(settings);
  }
  function playVictory() {
    if (victoryAudio) return;
    background.pauseBgm();
    victoryMusic.setBgm({ path: 'victory', loop: false, volume: 0.5, autoplay: !paused });
    const audio = victoryMusic.bgm?.audio;
    if (!audio) throw new Error('The boss victory track could not be created');
    victoryAudio = audio;
    victoryAudio.addEventListener('ended', onVictoryEnded, { once: true });
  }
  function syncScene() {
    setTrack(sceneData?.getMusicTrack?.() ?? (sceneId ? sceneTracks.get(sceneId) : null) ?? null);
    if (sceneData?.hasBossVictory?.() && !celebratedScenes.has(sceneData)) {
      celebratedScenes.add(sceneData);
      playVictory();
    }
  }
  return {
    enterScene(id: string | null, data: SceneMusicState | null = null) {
      sceneId = id; sceneData = data; syncScene();
      if (id === 'scene13' || id === 'scene18' || id === 'scene21') {
        void preloadMusic(MUSIC_URLS.victory, false).catch(error => console.warn('[Audio] Victory preparation failed:', error));
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
      if (value) { background.pauseBgm(); victoryMusic.pauseBgm(); }
      else if (victoryAudio) victoryMusic.playBgm();
      else background.playBgm();
    },
    update(deltaTime: number) { syncScene(); background.update(deltaTime); victoryMusic.update(deltaTime); menuMusic.update(deltaTime); },
    dispose() {
      clearVictory(false);
      background.dispose(); victoryMusic.dispose(); menuMusic.dispose();
    },
  };
}
