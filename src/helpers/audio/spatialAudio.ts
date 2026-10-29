import * as THREE from "three";
import { fetchAsset } from "../../core/assetCache.js";
import {
  getAudioSettings,
  getSfxGain,
  subscribeAudioSettings,
} from "./AudioManager.js";
import { prepareMusicLoop, sharedAudioContext } from "./bufferedMusic.js";

export type SoundPoint = { x: number; y: number; z: number };
export type SoundPosition =
  SoundPoint | THREE.Object3D | ((listener: SoundPoint) => SoundPoint | null);
interface SampleOptions {
  volume?: number;
  rate?: number;
  radius?: number;
  position?: SoundPosition;
  listener?: SoundPoint;
  owner?: THREE.Scene | null;
  loop?: boolean;
  gain?: () => number;
  pitch?: () => number;
}
interface Voice {
  stop(): void;
  sync(): void;
  owner: THREE.Scene | null;
  loop: boolean;
}
const buffers = new Map<
  string,
  Promise<{ buffer: AudioBuffer; loopStart: number }>
>();
const voices = new Set<Voice>();
const emitters = new Set<{
  update(): void;
  dispose(): void;
  owner: THREE.Scene;
}>();
const listenerPosition = new THREE.Vector3();
const listenerRight = new THREE.Vector3(1, 0, 0);
const listenerRotation = new THREE.Quaternion();
const sourcePosition = new THREE.Vector3();
let activeScene: THREE.Scene | null = null;
let hasListener = false;
let blocked = false;
let output: GainNode | null = null;
let unsupportedWarning = false;
export const MAX_SAMPLE_VOICES = 36;
export const MAX_AMBIENT_VOICES = 10;

export function soundAttenuation(distance: number, radius: number) {
  if (
    !Number.isFinite(distance) ||
    distance < 0 ||
    !Number.isFinite(radius) ||
    radius <= 0
  )
    throw new RangeError(
      "Spatial audio requires a finite nonnegative distance and positive radius",
    );
  return Math.max(0, 1 - distance / radius) ** 2;
}

function audible() {
  return (
    !blocked &&
    !getAudioSettings().paused &&
    !(typeof document !== "undefined" && document.hidden) &&
    getSfxGain() > 0
  );
}

function getOutput() {
  if (output) return output;
  const context = sharedAudioContext();
  output = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 15;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  output.connect(limiter);
  limiter.connect(context.destination);
  const sync = () => {
    output!.gain.setValueAtTime(
      audible() ? getSfxGain() : 0,
      context.currentTime,
    );
    if (!audible()) for (const voice of [...voices]) voice.stop();
  };
  subscribeAudioSettings(sync);
  document.addEventListener("visibilitychange", sync);
  return output;
}

export function preloadSample(url: string, loop = false) {
  const key = `${loop}:${url}`;
  let pending = buffers.get(key);
  if (!pending) {
    const context = sharedAudioContext();
    pending = fetchAsset(url).then(async (response) => {
      if (!response.ok)
        throw new Error(`Sound request failed (${response.status}): ${url}`);
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      return loop
        ? prepareMusicLoop(context, buffer, 0.2)
        : { buffer, loopStart: 0 };
    });
    buffers.set(key, pending);
    void pending.catch(() => buffers.delete(key));
  }
  return pending;
}

function resolvePosition(position: SoundPosition, listener: SoundPoint) {
  if (typeof position === "function") return position(listener);
  if (position instanceof THREE.Object3D) {
    for (let node: THREE.Object3D | null = position; node; node = node.parent)
      if (!node.visible) return null;
    return position.getWorldPosition(sourcePosition);
  }
  return position;
}

export function playSample(url: string, options: SampleOptions = {}) {
  if (!audible()) return;
  if (
    typeof window === "undefined" ||
    typeof window.AudioContext !== "function"
  ) {
    if (!unsupportedWarning) {
      console.warn("[Audio] Recorded spatial effects require Web Audio");
      unsupportedWarning = true;
    }
    return;
  }
  const context = sharedAudioContext();
  if (context.state !== "running") return;
  const loop = options.loop ?? false;
  const count = [...voices].filter((voice) => voice.loop === loop).length;
  if (count >= (loop ? MAX_AMBIENT_VOICES : MAX_SAMPLE_VOICES)) return;
  const owner = options.owner === undefined ? activeScene : options.owner;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let pan: StereoPannerNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let stopped = false;
  const created = performance.now();
  const mix = () => {
    const level = (options.volume ?? 1) * (options.gain?.() ?? 1);
    if (!options.position) return { gain: level, pan: 0, cutoff: 18000 };
    if (!hasListener && !options.listener)
      return { gain: 0, pan: 0, cutoff: 18000 };
    const listener = options.listener ?? listenerPosition;
    const position = resolvePosition(options.position, listener);
    if (!position) return { gain: 0, pan: 0, cutoff: 18000 };
    const dx = position.x - listener.x,
      dy = position.y - listener.y,
      dz = position.z - listener.z;
    const distance = Math.hypot(dx, dy, dz);
    const radius = options.radius ?? 25;
    return {
      gain: level * soundAttenuation(distance, radius),
      pan: THREE.MathUtils.clamp(
        (dx * listenerRight.x + dy * listenerRight.y + dz * listenerRight.z) /
          Math.max(1, distance),
        -0.95,
        0.95,
      ),
      cutoff: 18000 - Math.min(1, distance / radius) * 16000,
    };
  };
  if (mix().gain <= 0.0001) return;
  const voice: Voice = {
    owner,
    loop,
    stop() {
      if (stopped) return;
      stopped = true;
      voices.delete(voice);
      if (source) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      gain?.disconnect();
      pan?.disconnect();
      filter?.disconnect();
    },
    sync() {
      if (stopped || !gain || !pan || !filter) return;
      const values = mix();
      gain.gain.setTargetAtTime(values.gain, context.currentTime, 0.06);
      pan.pan.setTargetAtTime(values.pan, context.currentTime, 0.06);
      filter.frequency.setTargetAtTime(
        values.cutoff,
        context.currentTime,
        0.08,
      );
      if (source && options.pitch)
        source.playbackRate.setTargetAtTime(
          options.pitch(),
          context.currentTime,
          0.1,
        );
    },
  };
  voices.add(voice);
  const destination = getOutput();
  void preloadSample(url, loop)
    .then(({ buffer, loopStart }) => {
      if (stopped) return;
      if (
        !audible() ||
        owner !== activeScene ||
        (!loop && performance.now() - created > 350)
      ) {
        voice.stop();
        return;
      }
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.loopStart = loopStart;
      source.loopEnd = buffer.duration;
      source.playbackRate.value = options.rate ?? 1;
      gain = context.createGain();
      pan = context.createStereoPanner();
      filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.5;
      const values = mix();
      gain.gain.value = loop ? 0 : values.gain;
      pan.pan.value = values.pan;
      filter.frequency.value = values.cutoff;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(destination);
      voice.sync();
      source.onended = () => {
        source?.disconnect();
        source = null;
        voice.stop();
      };
      source.start(
        0,
        loop
          ? Math.random() * Math.max(0.01, buffer.duration - loopStart) +
              loopStart
          : 0,
      );
    })
    .catch((error) => {
      voice.stop();
      console.warn("[Audio] Recorded sound could not be loaded:", url, error);
    });
  return voice.stop;
}

export function createSampleEmitter(
  url: string,
  owner: THREE.Scene,
  position: SoundPosition | undefined,
  options: {
    volume?: number;
    radius?: number;
    rate?: number;
    enabled?: () => boolean;
    gain?: () => number;
    pitch?: () => number;
  } = {},
) {
  let stop: (() => void) | undefined;
  let volume = options.volume ?? 1;
  const emitter = {
    owner,
    update() {
      if (stop && ![...voices].some((voice) => voice.stop === stop))
        stop = undefined;
      const point = position
        ? resolvePosition(position, listenerPosition)
        : listenerPosition;
      const near =
        point &&
        soundAttenuation(
          Math.hypot(
            point.x - listenerPosition.x,
            point.y - listenerPosition.y,
            point.z - listenerPosition.z,
          ),
          options.radius ?? 25,
        ) *
          volume >
          0.001;
      if (
        !audible() ||
        owner !== activeScene ||
        !near ||
        options.enabled?.() === false
      ) {
        stop?.();
        stop = undefined;
        return;
      }
      stop ??= playSample(url, {
        position,
        owner,
        volume,
        radius: options.radius,
        rate: options.rate,
        loop: true,
        gain: options.gain,
        pitch: options.pitch,
      });
    },
    setVolume(value: number) {
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new RangeError("Emitter volume must be between zero and one");
      if (Math.abs(value - volume) < 0.005) return;
      volume = value;
      stop?.();
      stop = undefined;
    },
    dispose() {
      stop?.();
      emitters.delete(emitter);
    },
  };
  emitters.add(emitter);
  return emitter;
}

export function updateSpatialAudio(
  scene: THREE.Scene | null,
  camera: THREE.Camera | null,
  paused = false,
) {
  if (activeScene !== scene) {
    for (const voice of [...voices]) voice.stop();
    for (const emitter of [...emitters])
      if (emitter.owner === activeScene) emitter.dispose();
    activeScene = scene;
  }
  blocked = paused;
  hasListener = camera !== null;
  if (camera) {
    camera.getWorldPosition(listenerPosition);
    camera.getWorldQuaternion(listenerRotation);
    listenerRight.set(1, 0, 0).applyQuaternion(listenerRotation);
  }
  if (output)
    output.gain.setValueAtTime(
      audible() ? getSfxGain() : 0,
      sharedAudioContext().currentTime,
    );
  if (!audible()) for (const voice of [...voices]) voice.stop();
  for (const emitter of emitters) emitter.update();
  for (const voice of voices) voice.sync();
}

export function stopSceneAudio() {
  for (const voice of [...voices]) voice.stop();
  for (const emitter of [...emitters])
    if (emitter.owner === activeScene) emitter.dispose();
  activeScene = null;
  hasListener = false;
}
