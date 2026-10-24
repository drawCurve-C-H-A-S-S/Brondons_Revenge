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
] as const;
type SynthSfxName = (typeof SYNTH_SFX)[number];
export type SfxName = keyof typeof SFX_URLS | SynthSfxName;

export const SFX_MIX: Partial<Record<SfxName, number>> = {
  clank: 0.22,
  blockBreak: 0.5,
  bounce: 0.45,
  servo: 0.18,
  droneWhizz: 0.28,
  botShot: 0.22,
  pew: 0.3,
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
};
const lastPlayed = new Map<string, number>();
const synthesized = new Map<SynthSfxName, AudioBuffer>();
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
      console.warn("[Audio] Mechanical and impact effects require Web Audio");
      synthWarningShown = true;
    }
    return;
  }
  const context = sharedAudioContext();
  if (context.state !== "running") return;
  let buffer = synthesized.get(name);
  if (!buffer) {
    const duration =
      name === "servo" || name === "droneWhizz"
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
        name === "bounce"
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
        Math.min(1, t * 160) *
        (name === "servo" || name === "droneWhizz"
          ? Math.sin(progress * Math.PI) ** 0.7
          : Math.exp(-progress * 6) * (1 - progress));
      const wave =
        name === "blockBreak"
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
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  source.start();
}

export function playSfx(name: SfxName, volume = 1, rate = 1) {
  if (getAudioSettings().paused) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 0)) return;
  lastPlayed.set(name, now);
  const level =
    Math.min(1, Math.max(0, volume * (SFX_MIX[name] ?? 1))) * getSfxGain();
  if (level <= 0) return;
  if (isSynthSfx(name)) {
    playSynthSfx(name, level, rate);
    return;
  }
  if (typeof Audio === "undefined") return;
  const audio = new Audio(cachedAssetUrl(SFX_URLS[name]));
  audio.volume = level;
  audio.playbackRate = rate;
  audio
    .play()
    .catch((error) =>
      console.warn("[Audio] Sound effect playback failed:", name, error),
    );
}

/** Distance-attenuated sfx at a world position, relative to the supplied listener. */
export function playSfxAt(
  name: SfxName,
  source: { x: number; y: number; z: number },
  listener: { x: number; y: number; z: number },
  radius = 25,
  volume = 1,
) {
  const d = Math.hypot(
    source.x - listener.x,
    source.y - listener.y,
    source.z - listener.z,
  );
  const falloff = 1 - d / radius;
  if (falloff > 0) playSfx(name, volume * falloff * falloff);
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
let footstepBuffers: {
  context: AudioContext;
  left: AudioBuffer;
  right: AudioBuffer;
} | null = null;
let footstepWarningShown = false;

function createFootstepBuffer(context: BaseAudioContext, seed: number) {
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 0.22),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  const lowPass = 1 - Math.exp((-Math.PI * 2 * 420) / context.sampleRate);
  const bodyPass = 1 - Math.exp((-Math.PI * 2 * 120) / context.sampleRate);
  let low = 0,
    body = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1,
      time = frame / context.sampleRate;
    low += (noise - low) * lowPass;
    body += (low - body) * bodyPass;
    const attack = 1 - Math.exp(-time * 900);
    const heel =
      Math.sin(Math.PI * 2 * (54 * time - 55 * time * time)) *
      Math.exp(-time * 32);
    const scuff = (body * 0.8 + low * 0.2) * Math.exp(-time * 27);
    const fade = Math.min(
      1,
      (samples.length - 1 - frame) / (context.sampleRate * 0.02),
    );
    samples[frame] = (heel * 0.7 + scuff * 0.65) * attack * fade;
  }
  return buffer;
}

export function playFootstep(foot: Foot, volume: number) {
  const gain = Math.min(1, Math.max(0, volume * FOOTSTEP_GAIN)) * getSfxGain();
  if (
    gain <= 0 ||
    getAudioSettings().paused ||
    (typeof document !== "undefined" && document.hidden)
  )
    return;
  if (
    typeof window === "undefined" ||
    typeof window.AudioContext !== "function"
  ) {
    if (!footstepWarningShown) {
      console.warn("[Audio] Generated footsteps require Web Audio");
      footstepWarningShown = true;
    }
    return;
  }
  const context = sharedAudioContext();
  if (context.state !== "running") return;
  footstepBuffers ??= {
    context,
    left: createFootstepBuffer(context, 7319),
    right: createFootstepBuffer(context, 170916),
  };
  const source = context.createBufferSource(),
    output = context.createGain();
  source.buffer = footstepBuffers[foot];
  source.playbackRate.value = foot === "left" ? 0.96 : 1;
  output.gain.value = gain;
  source.connect(output);
  output.connect(context.destination);
  source.onended = () => {
    source.disconnect();
    output.disconnect();
  };
  source.start();
}
