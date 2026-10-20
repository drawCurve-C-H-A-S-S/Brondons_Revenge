import { getAudioSettings } from './AudioManager.js';
import footstepUrl from '../../assets/sounds/footstep.mp3?url';
import robotStepUrl from '../../assets/sounds/robot-step.mp3?url';
import doorUrl from '../../assets/sounds/door-open.mp3?url';
import gunshotUrl from '../../assets/sounds/gunshot.mp3?url';
import bombUrl from '../../assets/sounds/red-bomb.mp3?url';
import waterfallUrl from '../../assets/sounds/waterfall.mp3?url';
import shipDoorUrl from '../../assets/sounds/ship-door.mp3?url';
import keypadUrl from '../../assets/sounds/keypad.mp3?url';
import slashUrl from '../../assets/sounds/sword-slash.mp3?url';
import clankUrl from '../../assets/sounds/robot-clank.mp3?url';
import crowbarUrl from '../../assets/sounds/crowbar-swing.mp3?url';
import meleeUrl from '../../assets/sounds/punch.mp3?url';
import brendanUrl from '../../assets/sounds/brendan-voice.mp3?url';
import explosionUrl from '../../assets/sounds/explosion.mp3?url';
import toiletFlushUrl from '../../assets/sounds/toilet-flush.mp3?url';
import waterUrl from '../../assets/sounds/water.mp3?url';

export const SFX_URLS = {
  footstep: footstepUrl, robotStep: robotStepUrl, door: doorUrl, gunshot: gunshotUrl, redBomb: bombUrl,
  shipDoor: shipDoorUrl, keypad: keypadUrl, slash: slashUrl, clank: clankUrl, crowbar: crowbarUrl,
  melee: meleeUrl,   brendan: brendanUrl, explosion: explosionUrl, toiletFlush: toiletFlushUrl,
} as const;
export type SfxName = keyof typeof SFX_URLS;

const MIN_GAP_MS: Partial<Record<SfxName, number>> = { robotStep: 90, clank: 80, redBomb: 120, slash: 60, gunshot: 40, explosion: 150 };
const lastPlayed = new Map<string, number>();

export function playSfx(name: SfxName, volume = 1, rate = 1) {
  if (typeof Audio === 'undefined') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 0)) return;
  lastPlayed.set(name, now);
  const level = Math.min(1, Math.max(0, volume)) * getAudioSettings().sfx;
  if (level <= 0) return;
  const audio = new Audio(SFX_URLS[name]);
  audio.volume = level;
  audio.playbackRate = rate;
  audio.play().catch(() => undefined);
}

/** Distance-attenuated sfx at a world position, relative to the supplied listener. */
export function playSfxAt(name: SfxName, source: { x: number; y: number; z: number },
  listener: { x: number; y: number; z: number }, radius = 25, volume = 1) {
  const d = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  const falloff = 1 - d / radius;
  if (falloff > 0) playSfx(name, volume * falloff * falloff);
}

let waterfall: HTMLAudioElement | null = null;
/** Looping waterfall bed: loudest at the falls, fading to silence by `radius`. */
export function updateWaterfallAudio(distance: number | null, radius = 110) {
  if (distance === null || distance >= radius || getAudioSettings().sfx <= 0) {
    if (waterfall && !waterfall.paused) waterfall.pause();
    return;
  }
  if (!waterfall) { waterfall = new Audio(waterfallUrl); waterfall.loop = true; }
  const t = 1 - Math.max(0, distance) / radius;
  waterfall.volume = Math.min(1, Math.sqrt(t) * getAudioSettings().sfx);
  if (waterfall.paused) waterfall.play().catch(() => undefined);
}
export function stopWaterfallAudio() { waterfall?.pause(); }

let runningWater: HTMLAudioElement | null = null;
/** Looping tap/shower water: pass the distance to the nearest running fixture, or null when none is on. */
export function updateRunningWaterAudio(distance: number | null, radius = 9) {
  if (distance === null || distance >= radius || getAudioSettings().sfx <= 0) {
    if (runningWater && !runningWater.paused) runningWater.pause();
    return;
  }
  if (!runningWater) { runningWater = new Audio(waterUrl); runningWater.loop = true; }
  runningWater.volume = Math.min(1, Math.sqrt(1 - distance / radius) * 0.7 * getAudioSettings().sfx);
  if (runningWater.paused) runningWater.play().catch(() => undefined);
}
export function stopRunningWaterAudio() { runningWater?.pause(); }
