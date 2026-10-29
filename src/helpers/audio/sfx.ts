import {
  getAudioSettings,
  getSfxGain,
  subscribeAudioSettings,
} from "./AudioManager.js";
import {
  BufferedMusic,
  sharedAudioContext,
  supportsBufferedMusic,
} from "./bufferedMusic.js";
import { cachedAssetUrl } from "../../core/assetCache.js";
import robotStepUrl from "../../assets/sounds/robot-step.mp3?url";
import doorUrl from "../../assets/sounds/door-open.mp3?url";
import gunshotUrl from "../../assets/sounds/gunshot.mp3?url";
import bombUrl from "../../assets/sounds/red-bomb.mp3?url";
import waterfallUrl from "../../assets/sounds/waterfall.mp3?url";
import shipDoorUrl from "../../assets/sounds/ship-door.mp3?url";
import keypadUrl from "../../assets/sounds/keypad.mp3?url";
import slashUrl from "../../assets/sounds/sword-slash.mp3?url";
import clankUrl from "../../assets/sounds/robot-clank.mp3?url";
import crowbarUrl from "../../assets/sounds/crowbar-swing.mp3?url";
import meleeUrl from "../../assets/sounds/punch.mp3?url";
import brendanUrl from "../../assets/sounds/brendan-voice.mp3?url";
import explosionUrl from "../../assets/sounds/explosion.mp3?url";
import toiletFlushUrl from "../../assets/sounds/toilet-flush.mp3?url";
import waterUrl from "../../assets/sounds/water.mp3?url";
import chestUrl from "../../assets/sounds/chest.ogg?url";
import * as THREE from "three";
import { RECORDED_SOUNDS } from "./recordedSounds.js";
import { playSample, type SoundPosition } from "./spatialAudio.js";

export const SFX_URLS = {
  robotStep: robotStepUrl,
  door: doorUrl,
  gunshot: gunshotUrl,
  redBomb: bombUrl,
  shipDoor: shipDoorUrl,
  keypad: keypadUrl,
  slash: slashUrl,
  clank: clankUrl,
  crowbar: crowbarUrl,
  melee: meleeUrl,
  brendan: brendanUrl,
  explosion: explosionUrl,
  toiletFlush: toiletFlushUrl,
  chest: chestUrl,
} as const;
const SYNTH_SFX = [
  "blockBreak",
  "bounce",
  "servo",
  "droneWhizz",
  "botShot",
  "pew",
  "revengeShout",
] as const;
type SynthSfxName = (typeof SYNTH_SFX)[number];
export type SfxName = keyof typeof SFX_URLS | keyof typeof RECORDED_SOUNDS | SynthSfxName;

export const SFX_MIX: Partial<Record<SfxName, number>> = {
  clank: 0.22,
  blockBreak: 0.5,
  bounce: 0.45,
  servo: 0.18,
  droneWhizz: 0.28,
  botShot: 0.22,
  pew: 0.3,
  revengeShout: 0.6,
  mechStep: 0.7,
  swordClash: 0.85,
  woodBreak: 0.7,
  glassBreak: 0.55,
  shieldHit: 0.65,
  doorClose: 0.65,
  metalHit: 0.55,
};
export const FOOTSTEP_GAIN = 1.45;

const MIN_GAP_MS: Partial<Record<SfxName, number>> = {
  robotStep: 90,
  clank: 80,
  redBomb: 120,
  slash: 60,
  gunshot: 40,
  explosion: 150,
  blockBreak: 65,
  bounce: 80,
  servo: 500,
  droneWhizz: 160,
  botShot: 65,
  pew: 60,
  revengeShout: 1000,
};
const lastPlayed = new Map<string, number>();
const sampleVariants = new Map<SfxName, number>();
function recorded(name: SfxName): name is keyof typeof RECORDED_SOUNDS {
  return name in RECORDED_SOUNDS;
}
function sampleUrl(name: SfxName) {
  if (!recorded(name)) return name in SFX_URLS ? SFX_URLS[name as keyof typeof SFX_URLS] : null;
  const clips = RECORDED_SOUNDS[name];
  const previous = sampleVariants.get(name) ?? -1;
  const index = clips.length === 1 ? 0 : previous < 0
    ? Math.floor(Math.random() * clips.length)
    : (previous + 1 + Math.floor(Math.random() * (clips.length - 1))) % clips.length;
  sampleVariants.set(name, index);
  return clips[index];
}
const synthesized = new Map<SynthSfxName, AudioBuffer>();
const activeShouts = new Set<() => void>();
subscribeAudioSettings(({ voiceActing, paused }) => {
  if (!voiceActing || paused)
    for (const stop of [...activeShouts]) stop();
});
let synthWarningShown = false;
function isSynthSfx(name: SfxName): name is SynthSfxName {
  return SYNTH_SFX.some((key) => key === name);
}

function playSynthSfx(name: SynthSfxName, level: number, rate: number) {
  if (
    typeof window === "undefined" ||
    typeof window.AudioContext !== "function"
  ) {
    if (!synthWarningShown) {
      console.warn("[Audio] Synthesized sound effects require Web Audio");
      synthWarningShown = true;
    }
    return;
  }
  const context = sharedAudioContext();
  if (context.state !== "running") return;
  let buffer = synthesized.get(name);
  if (!buffer) {
    const duration =
      name === "revengeShout"
        ? 3.8
        : name === "servo" || name === "droneWhizz"
        ? 0.65
        : name === "blockBreak"
          ? 0.3
          : name === "bounce"
            ? 0.28
            : 0.15;
    buffer = context.createBuffer(
      1,
      Math.ceil(duration * context.sampleRate),
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let phase = 0,
      low = 0,
      seed = 7139;
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate,
        progress = t / duration;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      low += (noise - low) * 0.22;
      const frequency =
        name === "revengeShout"
          ? 128 + 62 * Math.sin(progress * Math.PI * 0.7) + Math.sin(t * 37) * 2.5
          : name === "bounce"
          ? 70 + 370 * Math.exp(-t * 18)
          : name === "servo"
            ? 85 + Math.sin(progress * Math.PI) * 32
            : name === "droneWhizz"
              ? 240 + Math.sin(progress * Math.PI) * 1050
              : name === "blockBreak"
                ? 60
                : 130 + 1450 * Math.exp(-t * 35);
      phase += (Math.PI * 2 * frequency) / context.sampleRate;
      const envelope =
        name === "revengeShout"
          ? Math.min(1, t * 5) * Math.min(1, (duration - t) * 2.5)
          : Math.min(1, t * 160) *
            (name === "servo" || name === "droneWhizz"
              ? Math.sin(progress * Math.PI) ** 0.7
              : Math.exp(-progress * 6) * (1 - progress));
      const wave =
        name === "revengeShout"
          ? Math.tanh(
              Math.sin(phase) * 0.35 +
              Math.sin(phase * 2) * 0.15 +
              Math.sin(phase * 6) * 0.34 +
              Math.sin(phase * 9) * 0.24 +
              Math.sin(phase * 19) * 0.12 +
              low * 0.16,
            ) * 0.85
          : name === "blockBreak"
          ? low * 1.5 + Math.sin(phase) * 0.15
          : name === "servo"
            ? Math.sin(phase) * 0.65 + Math.sin(phase * 3) * 0.16
            : Math.sin(phase) * 0.75 +
              low * (name === "droneWhizz" ? 0.22 : 0.04);
      samples[i] = wave * envelope;
    }
    synthesized.set(name, buffer);
  }
  const source = context.createBufferSource(),
    gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  gain.gain.value = level;
  source.connect(gain);
  gain.connect(context.destination);
  let stopped = false;
  source.onended = () => {
    stopped = true;
    activeShouts.delete(stop);
    source.disconnect();
    gain.disconnect();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    activeShouts.delete(stop);
    source.stop();
  };
  if (name === "revengeShout") activeShouts.add(stop);
  source.start();
  return stop;
}

export function playSfx(name: SfxName, volume = 1, rate = 1) {
  const settings = getAudioSettings();
  if (
    settings.paused ||
    (!settings.voiceActing && (name === "brendan" || name === "revengeShout"))
  ) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 0)) return;
  lastPlayed.set(name, now);
  const level =
    Math.min(1, Math.max(0, volume * (SFX_MIX[name] ?? 1)));
  if (level <= 0 || getSfxGain() <= 0) return;
  if (name === "brendan")
    return playSample(brendanUrl, { volume: level, rate, voice: true });
  if (recorded(name)) {
    const url = sampleUrl(name);
    if (url) return playSample(url, { volume: level, rate });
  }
  if (isSynthSfx(name)) {
    return playSynthSfx(name, level * getSfxGain(), rate);
  }
  if (name in SFX_URLS && typeof Audio !== "undefined") {
    const audio = new Audio(cachedAssetUrl(SFX_URLS[name as keyof typeof SFX_URLS]));
    audio.volume = level * getSfxGain();
    audio.playbackRate = rate;
    audio.play().catch((error) =>
      console.warn("[Audio] Sound effect playback failed:", name, error),
    );
  }
}

/** Distance-attenuated sfx at a world position, relative to the supplied listener. */
export function playSfxAt(
  name: SfxName,
  source: { x: number; y: number; z: number },
  listener: { x: number; y: number; z: number },
  radius = 25,
  volume = 1,
) {
  const url = recorded(name) ? sampleUrl(name) : null;
  if (url) return playSample(url, {
    position: source, listener, radius,
    volume: Math.min(1, Math.max(0, volume * (SFX_MIX[name] ?? 1))),
    rate: 0.97 + Math.random() * 0.06,
  });
  const d = Math.hypot(
    source.x - listener.x,
    source.y - listener.y,
    source.z - listener.z,
  );
  const falloff = 1 - d / radius;
  if (falloff > 0) playSfx(name, volume * falloff * falloff);
}

export function playWorldSfx(name: SfxName, position: SoundPosition, radius = 25, volume = 1, rate = 1) {
  const url = sampleUrl(name);
  if (!url) throw new Error(`World sound requires a recorded effect: ${name}`);
  return playSample(url, {
    position: position instanceof THREE.Object3D ? position.getWorldPosition(new THREE.Vector3()) : position,
    radius, volume: Math.min(1, Math.max(0, volume * (SFX_MIX[name] ?? 1))),
    rate: rate * (0.97 + Math.random() * 0.06),
    voice: name === "brendan",
  });
}

const doorDirections = new WeakMap<object, number>();
export function playDoorMovement(source: THREE.Object3D, open: number, target: number) {
  const direction = Math.sign(target - open);
  if (direction !== 0 && direction !== (doorDirections.get(source) ?? 0))
    playWorldSfx(direction > 0 ? "shipDoor" : "doorClose", source, 24, 0.75);
  doorDirections.set(source, direction);
}

function createAmbientLoop(url: string, blendSeconds: number) {
  const context = supportsBufferedMusic(url) ? sharedAudioContext() : null;
  const audio = context
    ? new BufferedMusic(url, true, blendSeconds)
    : new Audio(cachedAssetUrl(url));
  if (!(audio instanceof BufferedMusic)) {
    audio.loop = true;
    console.warn(
      "[Audio] Web Audio is unavailable; ambient sound uses browser looping:",
      url,
    );
  }
  let volume = 0,
    pending = false,
    blocked = false,
    failed = false;
  const wanted = () =>
    volume > 0 &&
    getSfxGain() > 0 &&
    !getAudioSettings().paused &&
    !document.hidden;
  function sync() {
    audio.volume = volume * getSfxGain();
    if (!wanted()) {
      if (!audio.paused || pending) audio.pause();
      return;
    }
    if (
      pending ||
      blocked ||
      failed ||
      !audio.paused ||
      (context && context.state !== "running")
    )
      return;
    pending = true;
    void audio
      .play()
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (error?.name === "NotAllowedError") blocked = true;
        else failed = true;
        console.warn("[Audio] Ambient sound could not start:", url, error);
      })
      .finally(() => {
        pending = false;
        if (!wanted()) audio.pause();
      });
  }
  subscribeAudioSettings(sync);
  context?.addEventListener("statechange", sync);
  document.addEventListener("visibilitychange", sync);
  for (const type of ["pointerdown", "keydown"]) {
    window.addEventListener(
      type,
      () => {
        blocked = false;
        sync();
      },
      { passive: true },
    );
  }
  return {
    setVolume(value: number) {
      volume = Math.min(1, Math.max(0, value));
      sync();
    },
    stop() {
      volume = 0;
      sync();
    },
  };
}

export function waterfallAttenuation(distance: number | null, radius = 110) {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    (distance !== null && !Number.isFinite(distance))
  ) {
    throw new RangeError(
      "Waterfall distance and audible radius must be finite, with a positive radius",
    );
  }
  return distance === null
    ? 0
    : (1 - Math.min(1, Math.max(0, distance) / radius)) ** 2;
}

let waterfall: ReturnType<typeof createAmbientLoop> | null = null;
export function updateWaterfallAudio(distance: number | null, radius = 110) {
  const volume = waterfallAttenuation(distance, radius);
  if (!waterfall && volume > 0) waterfall = createAmbientLoop(waterfallUrl, 2);
  waterfall?.setVolume(volume);
}
export function stopWaterfallAudio() {
  waterfall?.stop();
}

let runningWater: ReturnType<typeof createAmbientLoop> | null = null;
/** Looping tap/shower water: pass the distance to the nearest running fixture, or null when none is on. */
export function updateRunningWaterAudio(distance: number | null, radius = 9) {
  const volume = waterfallAttenuation(distance, radius) ** 0.25 * 0.7;
  if (!runningWater && volume > 0)
    runningWater = createAmbientLoop(waterUrl, 0.65);
  runningWater?.setVolume(volume);
}
export function stopRunningWaterAudio() {
  runningWater?.stop();
}

export type Foot = "left" | "right";
let footstepSurface: "floor" | "grass" = "floor";
export function setFootstepSurface(surface: "floor" | "grass") {
  footstepSurface = surface;
}

export function playFootstep(foot: Foot, volume: number) {
  const url = sampleUrl(footstepSurface === "grass" ? "footstepGrass" : "footstepFloor");
  if (url) return playSample(url, {
    volume: Math.min(1, Math.max(0, volume * FOOTSTEP_GAIN)),
    rate: (foot === "left" ? 0.96 : 1) * (0.98 + Math.random() * 0.04),
  });
}

export function playJumpSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const osc = context.createOscillator();
  const output = context.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, context.currentTime);
  osc.frequency.exponentialRampToValueAtTime(280, context.currentTime + 0.08);
  osc.frequency.exponentialRampToValueAtTime(220, context.currentTime + 0.15);
  output.gain.setValueAtTime(gain * 0.3, context.currentTime);
  output.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
  osc.connect(output);
  output.connect(context.destination);
  osc.onended = () => { osc.disconnect(); output.disconnect(); };
  osc.start();
  osc.stop(context.currentTime + 0.2);
}

export function playLandingSound(impactVelocity: number, volume: number = 1) {
  const scaledVolume = Math.min(1, Math.abs(impactVelocity) / 15) * volume;
  const gain = Math.min(1, Math.max(0, scaledVolume)) * getSfxGain();
  if (gain <= 0.01 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.15), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 180 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const attack = 1 - Math.exp(-time * 600);
    const decay = Math.exp(-time * 18);
    samples[frame] = low * attack * decay;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.5;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start();
}

export function playSlideSound(volume: number = 0.6) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const duration = 0.4;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 400 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const envelope = Math.exp(-time * 4) * (1 - Math.exp(-time * 80));
    samples[frame] = low * envelope;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.4;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start();
}

export function playCrouchSound(volume: number = 0.3) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const duration = 0.15;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 800 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const envelope = Math.exp(-time * 20);
    samples[frame] = low * envelope * 0.3;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.3;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start();
}

export function playSprintSound(volume: number = 0.25) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const duration = 0.2;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 600 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const envelope = Math.exp(-time * 8);
    samples[frame] = low * envelope * 0.4;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.35;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start();
}

export function playPistolDrawSound(volume: number = 0.4) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const click = context.createOscillator();
  const clickGain = context.createGain();
  click.type = 'square';
  click.frequency.setValueAtTime(1200, now);
  click.frequency.exponentialRampToValueAtTime(800, now + 0.05);
  clickGain.gain.setValueAtTime(gain * 0.2, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  click.connect(clickGain);
  clickGain.connect(context.destination);
  click.onended = () => { click.disconnect(); clickGain.disconnect(); };
  click.start(now);
  click.stop(now + 0.08);
  const duration = 0.25;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 1500 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const envelope = Math.exp(-time * 6) * (1 - Math.exp(-time * 200));
    samples[frame] = low * envelope * 0.2;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.3;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(now + 0.05);
}

export function playCrowbarDrawSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const scrape = context.createOscillator();
  const scrapeGain = context.createGain();
  scrape.type = 'sawtooth';
  scrape.frequency.setValueAtTime(300, now);
  scrape.frequency.linearRampToValueAtTime(600, now + 0.15);
  scrape.frequency.linearRampToValueAtTime(400, now + 0.3);
  scrapeGain.gain.setValueAtTime(0.001, now);
  scrapeGain.gain.linearRampToValueAtTime(gain * 0.15, now + 0.05);
  scrapeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  scrape.connect(scrapeGain);
  scrapeGain.connect(context.destination);
  scrape.onended = () => { scrape.disconnect(); scrapeGain.disconnect(); };
  scrape.start(now);
  scrape.stop(now + 0.3);
  const clink = context.createOscillator();
  const clinkGain = context.createGain();
  clink.type = 'sine';
  clink.frequency.setValueAtTime(2400, now + 0.2);
  clink.frequency.exponentialRampToValueAtTime(1800, now + 0.25);
  clinkGain.gain.setValueAtTime(gain * 0.1, now + 0.2);
  clinkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  clink.connect(clinkGain);
  clinkGain.connect(context.destination);
  clink.onended = () => { clink.disconnect(); clinkGain.disconnect(); };
  clink.start(now + 0.2);
  clink.stop(now + 0.28);
}

export function playMeleeHitSound(volume: number = 0.7) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120, now);
  thud.frequency.exponentialRampToValueAtTime(60, now + 0.1);
  thudGain.gain.setValueAtTime(gain * 0.4, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  thud.connect(thudGain);
  thudGain.connect(context.destination);
  thud.onended = () => { thud.disconnect(); thudGain.disconnect(); };
  thud.start(now);
  thud.stop(now + 0.15);
  const ring = context.createOscillator();
  const ringGain = context.createGain();
  ring.type = 'sine';
  ring.frequency.setValueAtTime(400, now);
  ring.frequency.exponentialRampToValueAtTime(300, now + 0.1);
  ringGain.gain.setValueAtTime(gain * 0.15, now);
  ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  ring.connect(ringGain);
  ringGain.connect(context.destination);
  ring.onended = () => { ring.disconnect(); ringGain.disconnect(); };
  ring.start(now);
  ring.stop(now + 0.12);
  const duration = 0.25;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 300 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const envelope = Math.exp(-time * 12);
    samples[frame] = low * envelope * 0.3;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.4;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(now);
}

export function playRobotMeleeAttackSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const servo = context.createOscillator();
  const servoGain = context.createGain();
  servo.type = 'sawtooth';
  servo.frequency.setValueAtTime(200, now);
  servo.frequency.linearRampToValueAtTime(500, now + 0.15);
  servo.frequency.linearRampToValueAtTime(300, now + 0.3);
  servoGain.gain.setValueAtTime(gain * 0.12, now);
  servoGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  servo.connect(servoGain);
  servoGain.connect(context.destination);
  servo.onended = () => { servo.disconnect(); servoGain.disconnect(); };
  servo.start(now);
  servo.stop(now + 0.3);
  const duration = 0.3;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp(-Math.PI * 2 * 800 / context.sampleRate);
  let low = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const noise = Math.random() * 2 - 1;
    const time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    const envelope = Math.exp(-time * 6) * (1 - Math.exp(-time * 100));
    samples[frame] = low * envelope * 0.25;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.3;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(now + 0.1);
}

export function playRobotRangedAttackSound(volume: number = 0.6) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const charge = context.createOscillator();
  const chargeGain = context.createGain();
  charge.type = 'sine';
  charge.frequency.setValueAtTime(400, now);
  charge.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
  chargeGain.gain.setValueAtTime(gain * 0.15, now);
  chargeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  charge.connect(chargeGain);
  chargeGain.connect(context.destination);
  charge.onended = () => { charge.disconnect(); chargeGain.disconnect(); };
  charge.start(now);
  charge.stop(now + 0.12);
  const launch = context.createOscillator();
  const launchGain = context.createGain();
  launch.type = 'square';
  launch.frequency.setValueAtTime(800, now + 0.1);
  launch.frequency.exponentialRampToValueAtTime(200, now + 0.2);
  launchGain.gain.setValueAtTime(gain * 0.2, now + 0.1);
  launchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  launch.connect(launchGain);
  launchGain.connect(context.destination);
  launch.onended = () => { launch.disconnect(); launchGain.disconnect(); };
  launch.start(now + 0.1);
  launch.stop(now + 0.2);
}

export function playRobotAlertSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const tone1 = context.createOscillator();
  const tone1Gain = context.createGain();
  tone1.type = 'square';
  tone1.frequency.setValueAtTime(880, now);
  tone1Gain.gain.setValueAtTime(gain * 0.15, now);
  tone1Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  tone1.connect(tone1Gain);
  tone1Gain.connect(context.destination);
  tone1.onended = () => { tone1.disconnect(); tone1Gain.disconnect(); };
  tone1.start(now);
  tone1.stop(now + 0.15);
  const tone2 = context.createOscillator();
  const tone2Gain = context.createGain();
  tone2.type = 'square';
  tone2.frequency.setValueAtTime(660, now + 0.15);
  tone2Gain.gain.setValueAtTime(gain * 0.15, now + 0.15);
  tone2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  tone2.connect(tone2Gain);
  tone2Gain.connect(context.destination);
  tone2.onended = () => { tone2.disconnect(); tone2Gain.disconnect(); };
  tone2.start(now + 0.15);
  tone2.stop(now + 0.3);
}

export function playPlayerDamageSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const osc = context.createOscillator();
  const output = context.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
  output.gain.setValueAtTime(gain * 0.25, now);
  output.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(output);
  output.connect(context.destination);
  osc.onended = () => { osc.disconnect(); output.disconnect(); };
  osc.start(now);
  osc.stop(now + 0.2);
}

export function playPlayerDefeatSound(volume: number = 0.7) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(60, now);
  thud.frequency.exponentialRampToValueAtTime(30, now + 0.3);
  thudGain.gain.setValueAtTime(gain * 0.5, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  thud.connect(thudGain);
  thudGain.connect(context.destination);
  thud.onended = () => { thud.disconnect(); thudGain.disconnect(); };
  thud.start(now);
  thud.stop(now + 0.4);
  const descend = context.createOscillator();
  const descendGain = context.createGain();
  descend.type = 'sine';
  descend.frequency.setValueAtTime(300, now + 0.1);
  descend.frequency.exponentialRampToValueAtTime(80, now + 0.6);
  descendGain.gain.setValueAtTime(gain * 0.2, now + 0.1);
  descendGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  descend.connect(descendGain);
  descendGain.connect(context.destination);
  descend.onended = () => { descend.disconnect(); descendGain.disconnect(); };
  descend.start(now + 0.1);
  descend.stop(now + 0.6);
}

export function playItemPickupSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const freqs = [880, 1100, 1320];
  freqs.forEach((freq, i) => {
    const osc = context.createOscillator();
    const output = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * 0.08);
    output.gain.setValueAtTime(0.001, now + i * 0.08);
    output.gain.linearRampToValueAtTime(gain * 0.2, now + i * 0.08 + 0.02);
    output.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
    osc.connect(output);
    output.connect(context.destination);
    osc.onended = () => { osc.disconnect(); output.disconnect(); };
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.15);
  });
}

export function playTeleportCollectSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const ping1 = context.createOscillator();
  const ping1Gain = context.createGain();
  ping1.type = 'sine';
  ping1.frequency.setValueAtTime(1800, now);
  ping1Gain.gain.setValueAtTime(gain * 0.2, now);
  ping1Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  ping1.connect(ping1Gain);
  ping1Gain.connect(context.destination);
  ping1.onended = () => { ping1.disconnect(); ping1Gain.disconnect(); };
  ping1.start(now);
  ping1.stop(now + 0.3);
  const ping2 = context.createOscillator();
  const ping2Gain = context.createGain();
  ping2.type = 'sine';
  ping2.frequency.setValueAtTime(2400, now + 0.05);
  ping2Gain.gain.setValueAtTime(gain * 0.15, now + 0.05);
  ping2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  ping2.connect(ping2Gain);
  ping2Gain.connect(context.destination);
  ping2.onended = () => { ping2.disconnect(); ping2Gain.disconnect(); };
  ping2.start(now + 0.05);
  ping2.stop(now + 0.35);
}

export function playTeleportPlaceSound(volume: number = 0.6) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(100, now);
  thud.frequency.exponentialRampToValueAtTime(60, now + 0.1);
  thudGain.gain.setValueAtTime(gain * 0.3, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  thud.connect(thudGain);
  thudGain.connect(context.destination);
  thud.onended = () => { thud.disconnect(); thudGain.disconnect(); };
  thud.start(now);
  thud.stop(now + 0.15);
  const hum = context.createOscillator();
  const humGain = context.createGain();
  hum.type = 'sine';
  hum.frequency.setValueAtTime(440, now + 0.05);
  humGain.gain.setValueAtTime(gain * 0.15, now + 0.05);
  humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  hum.connect(humGain);
  humGain.connect(context.destination);
  hum.onended = () => { hum.disconnect(); humGain.disconnect(); };
  hum.start(now + 0.05);
  hum.stop(now + 0.5);
}

export function playTeleportThrowSound(volume: number = 0.4) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const osc = context.createOscillator();
  const output = context.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(1000, now + 0.25);
  output.gain.setValueAtTime(gain * 0.2, now);
  output.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.connect(output);
  output.connect(context.destination);
  osc.onended = () => { osc.disconnect(); output.disconnect(); };
  osc.start(now);
  osc.stop(now + 0.25);
}

export function playTeleportLandSound(volume: number = 0.5) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const clink = context.createOscillator();
  const clinkGain = context.createGain();
  clink.type = 'sine';
  clink.frequency.setValueAtTime(2000, now);
  clink.frequency.exponentialRampToValueAtTime(1500, now + 0.08);
  clinkGain.gain.setValueAtTime(gain * 0.2, now);
  clinkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  clink.connect(clinkGain);
  clinkGain.connect(context.destination);
  clink.onended = () => { clink.disconnect(); clinkGain.disconnect(); };
  clink.start(now);
  clink.stop(now + 0.12);
  const thud = context.createOscillator();
  const thudGain = context.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120, now + 0.02);
  thud.frequency.exponentialRampToValueAtTime(80, now + 0.1);
  thudGain.gain.setValueAtTime(gain * 0.25, now + 0.02);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  thud.connect(thudGain);
  thudGain.connect(context.destination);
  thud.onended = () => { thud.disconnect(); thudGain.disconnect(); };
  thud.start(now + 0.02);
  thud.stop(now + 0.15);
}

export function playTeleportActivateSound(volume: number = 0.7) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const osc = context.createOscillator();
  const output = context.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(2000, now + 0.6);
  output.gain.setValueAtTime(gain * 0.25, now);
  output.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  osc.connect(output);
  output.connect(context.destination);
  osc.onended = () => { osc.disconnect(); output.disconnect(); };
  osc.start(now);
  osc.stop(now + 0.6);
}

export function playBossPhaseTransitionSound(volume: number = 0.8) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const duration = 1.2;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let frame = 0; frame < samples.length; frame++) {
    const time = frame / context.sampleRate;
    const mechanical = Math.sin(time * 80 * Math.PI * 2) * Math.exp(-time * 1.5);
    const servo = Math.sin(time * 400 * Math.PI * 2 * (1 + time * 0.3)) * Math.exp(-time * 2);
    const impact = Math.sin(time * 50 * Math.PI * 2) * Math.exp(-time * 4) * (time < 0.1 ? 1 : 0);
    samples[frame] = (mechanical * 0.4 + servo * 0.3 + impact * 0.3) * 0.6;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.6;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(now);
}

export function playBossLaserSound(volume: number = 0.6) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const charge = context.createOscillator();
  const chargeGain = context.createGain();
  charge.type = 'sawtooth';
  charge.frequency.setValueAtTime(200, now);
  charge.frequency.exponentialRampToValueAtTime(1500, now + 0.3);
  chargeGain.gain.setValueAtTime(gain * 0.15, now);
  chargeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  charge.connect(chargeGain);
  chargeGain.connect(context.destination);
  charge.onended = () => { charge.disconnect(); chargeGain.disconnect(); };
  charge.start(now);
  charge.stop(now + 0.35);
  const beam = context.createOscillator();
  const beamGain = context.createGain();
  beam.type = 'square';
  beam.frequency.setValueAtTime(800, now + 0.3);
  beam.frequency.exponentialRampToValueAtTime(600, now + 0.5);
  beamGain.gain.setValueAtTime(gain * 0.2, now + 0.3);
  beamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  beam.connect(beamGain);
  beamGain.connect(context.destination);
  beam.onended = () => { beam.disconnect(); beamGain.disconnect(); };
  beam.start(now + 0.3);
  beam.stop(now + 0.5);
}

export function playBossDroneLaunchSound(volume: number = 0.6) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const duration = 0.7;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let frame = 0; frame < samples.length; frame++) {
    const time = frame / context.sampleRate;
    const hiss = (Math.random() * 2 - 1) * Math.exp(-time * 3) * (time < 0.2 ? 1 : 0);
    const pod = Math.sin(time * 150 * Math.PI * 2) * Math.exp(-time * 2) * (time > 0.15 && time < 0.5 ? 1 : 0);
    const whoosh = (Math.random() * 2 - 1) * Math.exp(-(time - 0.4) * 4) * (time > 0.4 ? 1 : 0);
    samples[frame] = (hiss * 0.3 + pod * 0.4 + whoosh * 0.3) * 0.5;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.5;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(now);
}

export function playBossDefeatSound(volume: number = 0.9) {
  const gain = Math.min(1, Math.max(0, volume)) * getSfxGain();
  if (gain <= 0 || getAudioSettings().paused || (typeof document !== 'undefined' && document.hidden)) return;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
  const context = sharedAudioContext();
  if (context.state !== 'running') return;
  const now = context.currentTime;
  const duration = 1.5;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let frame = 0; frame < samples.length; frame++) {
    const time = frame / context.sampleRate;
    const explosion1 = (Math.random() * 2 - 1) * Math.exp(-time * 2) * (time < 0.3 ? 1 : 0);
    const explosion2 = (Math.random() * 2 - 1) * Math.exp(-(time - 0.4) * 3) * (time > 0.3 && time < 0.7 ? 1 : 0);
    const powerDown = Math.sin(time * 300 * Math.PI * 2 * (1 - time * 0.5)) * Math.exp(-time * 1.5);
    const debris = (Math.random() * 2 - 1) * Math.exp(-(time - 0.8) * 2) * (time > 0.8 ? 1 : 0) * 0.3;
    samples[frame] = (explosion1 * 0.4 + explosion2 * 0.3 + powerDown * 0.2 + debris * 0.1) * 0.7;
  }
  const source = context.createBufferSource();
  const output = context.createGain();
  source.buffer = buffer;
  output.gain.value = gain * 0.7;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => { source.disconnect(); output.disconnect(); };
  source.start(now);
}
