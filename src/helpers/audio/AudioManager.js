import * as THREE from 'three';
import { BufferedMusic, supportsBufferedMusic, resumeMusicContext } from './bufferedMusic.js';
import { cachedAssetUrl } from '../../core/assetCache.js';

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const volumes = { bgm: 1, sfx: 1 };
let menuPaused = false;
/** @type {Set<AudioManager>} */
const managers = new Set();
const preparedAudio = new Map();
/** @typedef {{ path: string, volume?: number, loop?: boolean, autoplay?: boolean }} BgmSettings */
/** @typedef {HTMLAudioElement | BufferedMusic} MusicAudio */
/** @typedef {{ audio: MusicAudio, settings: BgmSettings }} BgmTrack */

export function preloadAudio(source) {
  if (!source || preparedAudio.has(source) || typeof Audio === 'undefined') return;
  const audio = new Audio(cachedAssetUrl(source));
  audio.preload = 'auto';
  audio.load();
  preparedAudio.set(source, audio);
}

/** @type {Set<(settings: { bgm: number, sfx: number, paused: boolean }) => void>} */
const settingsListeners = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('brondons-revenge-audio') || '{}');
  for (const channel of ['bgm', 'sfx']) {
    if (typeof saved?.[channel] === 'number' && Number.isFinite(saved[channel])) volumes[channel] = clamp(saved[channel], 0, 1);
  }
} catch { /* Storage is optional; session volume controls still work. */ }

export function getAudioSettings() { return { ...volumes, paused: menuPaused }; }
function notifyAudioSettings() {
  for (const manager of managers) manager.update();
  for (const listener of settingsListeners) listener(getAudioSettings());
}
/** @param {'bgm' | 'sfx'} channel @param {number} value */
export function setAudioVolume(channel, value) {
  if (!Number.isFinite(value) || (channel !== 'bgm' && channel !== 'sfx')) return;
  volumes[channel] = clamp(value, 0, 1);
  try { localStorage.setItem('brondons-revenge-audio', JSON.stringify(volumes)); } catch { /* Session-only settings. */ }
  notifyAudioSettings();
}
/** @param {(settings: { bgm: number, sfx: number, paused: boolean }) => void} listener */
export function subscribeAudioSettings(listener) {
  settingsListeners.add(listener); listener(getAudioSettings());
  return () => { settingsListeners.delete(listener); };
}
/** @param {boolean} paused */
export function setAudioMenuPaused(paused) {
  if (menuPaused === paused) return;
  menuPaused = paused;
  for (const manager of managers) manager.setMenuPaused(paused);
  notifyAudioSettings();
}

export class AudioManager {
  /** @param {{ camera?: THREE.Camera, getFile?: (path: string) => { content: Blob | string } | null, pauseWithMenu?: boolean }} [options] */
  constructor({ camera, getFile, pauseWithMenu = true } = {}) {
    this.camera = camera;
    this.getFile = getFile || (() => null);
    this.pauseWithMenu = pauseWithMenu;
    /** @type {BgmTrack | null} */
    this.bgm = null;
    /** @type {{ outgoing: { track: BgmTrack, gain: number }[], elapsed: number, duration: number } | null} */
    this.bgmFade = null;
    this.emitters = new Map();
    this.activeSfx = new Set();
    this.objectUrls = new Map();
    this.activeEmitterActors = new Map();
    this.autoplayQueue = new Set();
    this.cancelledPlayback = new WeakSet();
    this.audioUnlocked = false;
    this.menuSuspended = new Set();
    managers.add(this);
    this.unlockAudio = this.unlockAudio.bind(this);
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) {
      window.addEventListener(type, this.unlockAudio, { passive: true });
    }
  }

  resolveSource(path) {
    const source = this.getFile(path)?.content;
    if (source instanceof Blob) {
      if (!this.objectUrls.has(path)) this.objectUrls.set(path, URL.createObjectURL(source));
      return this.objectUrls.get(path);
    }
    return typeof source === 'string' && source ? source : null;
  }

  createAudio(path, { loop = false } = {}) {
    const source = this.resolveSource(path);
    if (!source) throw new Error(`Audio file not found: ${path}`);
    const audio = preparedAudio.get(source) || new Audio(cachedAssetUrl(source));
    const prepared = preparedAudio.delete(source);
    audio.loop = loop;
    // Force a full buffer up front so the first play() call is instant once the user unlocks audio.
    audio.preload = 'auto';
    if (!prepared) audio.load();
    return audio;
  }

  createBgmAudio(path, loop) {
    const source = this.resolveSource(path);
    if (!source) throw new Error(`Audio file not found: ${path}`);
    if (!supportsBufferedMusic(source)) return this.createAudio(path, { loop });
    return new BufferedMusic(source, loop);
  }

  /** @param {BgmSettings | null | undefined} settings */
  setBgm(settings) {
    this.stopBgm();
    if (!settings?.path) return;
    const audio = this.createBgmAudio(settings.path, settings.loop !== false);
    audio.volume = clamp(settings.volume ?? 0.7, 0, 1) * volumes.bgm;
    this.bgm = { audio, settings: { ...settings } };
    if (settings.autoplay) this.requestAutoplay(audio);
  }

  /** @param {BgmSettings} settings */
  crossfadeBgm(settings, duration = 3) {
    if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('BGM crossfade duration must be positive and finite');
    if (!settings?.path) throw new Error('BGM crossfade requires an audio path');
    if (!this.bgm) { this.setBgm(settings); return; }
    if (this.bgm.settings.path === settings.path) return;
    const audio = this.createBgmAudio(settings.path, settings.loop !== false);
    const progress = this.bgmFade ? this.bgmFade.elapsed / this.bgmFade.duration : 1;
    const angle = progress * Math.PI / 2;
    const outgoing = this.bgmFade
      ? [...this.bgmFade.outgoing.map(entry => ({ track: entry.track, gain: entry.gain * Math.cos(angle) })),
        { track: this.bgm, gain: Math.sin(angle) }]
      : [{ track: this.bgm, gain: 1 }];
    this.bgmFade = { outgoing, elapsed: 0, duration };
    this.bgm = { audio, settings: { ...settings } };
    audio.volume = 0;
    if (settings.autoplay) this.requestAutoplay(audio);
    this.update();
  }

  finishBgmFade() {
    if (!this.bgmFade) return;
    for (const { track: { audio } } of this.bgmFade.outgoing) {
      this.cancelledPlayback.add(audio);
      this.autoplayQueue.delete(audio);
      this.menuSuspended.delete(audio);
      audio.pause();
      audio.currentTime = 0;
      if (audio instanceof BufferedMusic) audio.dispose();
    }
    this.bgmFade = null;
  }

  playBgm() {
    if (this.bgm) this.requestAutoplay(this.bgm.audio);
    for (const entry of this.bgmFade?.outgoing ?? []) this.requestAutoplay(entry.track.audio);
  }

  pauseBgm() {
    for (const audio of [this.bgm?.audio, ...(this.bgmFade?.outgoing.map(entry => entry.track.audio) ?? [])]) {
      if (!audio) continue;
      this.cancelledPlayback.add(audio);
      this.autoplayQueue.delete(audio);
      this.menuSuspended.delete(audio);
      audio.pause();
    }
  }

  stopBgm() {
    if (!this.bgm) return;
    this.pauseBgm();
    this.finishBgmFade();
    this.bgm.audio.currentTime = 0;
    if (this.bgm.audio instanceof BufferedMusic) this.bgm.audio.dispose();
    this.bgm = null;
  }

  registerEmitter(emitter) {
    this.removeEmitter(emitter.id);
    const audio = this.createAudio(emitter.path, { loop: emitter.loop !== false });
    const entry = { data: structuredClone(emitter), audio };
    this.emitters.set(emitter.id, entry);
    this.applySpatialVolume({ audio, position: emitter.position, volume: emitter.volume ?? 1, radius: emitter.radius ?? 12 });
    if (emitter.autoplay !== false) this.requestAutoplay(audio);
    return entry;
  }

  removeEmitter(id) {
    const entry = this.emitters.get(id);
    if (!entry) return;
    this.cancelledPlayback.add(entry.audio);
    this.autoplayQueue.delete(entry.audio);
    this.menuSuspended.delete(entry.audio);
    entry.audio.pause();
    this.emitters.delete(id);
    this.activeEmitterActors.delete(id);
  }

  clearEmitters() {
    for (const id of this.emitters.keys()) this.removeEmitter(id);
  }

  updateEmitterActors(actors) {
    for (const [id, entry] of this.emitters) {
      const activeActors = this.activeEmitterActors.get(id) || new Set();
      const nextActors = new Set();
      const origin = new THREE.Vector3(...(entry.data.position || [0, 0, 0]));
      const radius = Math.max(entry.data.radius ?? 12, 0.01);
      for (const actor of actors) {
        const actorPosition = new THREE.Vector3();
        actor.getWorldPosition(actorPosition);
        if (actorPosition.distanceTo(origin) <= radius) {
          nextActors.add(actor);
          if (!activeActors.has(actor)) this.playEmitter(id);
        }
      }
      this.activeEmitterActors.set(id, nextActors);
    }
  }

  playEmitter(id) {
    const entry = this.emitters.get(id);
    if (entry) this.playAudio(entry.audio);
  }

  stopEmitter(id) {
    const entry = this.emitters.get(id);
    if (!entry) return;
    this.cancelledPlayback.add(entry.audio);
    this.autoplayQueue.delete(entry.audio);
    this.menuSuspended.delete(entry.audio);
    entry.audio.pause();
    entry.audio.currentTime = 0;
  }

  playSfx(path, { position = null, volume = 1, radius = 12, loop = false } = {}) {
    const audio = this.createAudio(path, { loop });
    const entry = { audio, position, volume, radius };
    this.activeSfx.add(entry);
    audio.addEventListener('ended', () => this.activeSfx.delete(entry), { once: true });
    this.applySpatialVolume(entry);
    this.playAudio(audio);
    return audio;
  }

  setMenuPaused(paused) {
    if (!this.pauseWithMenu) return;
    if (paused) {
      const audioNodes = [this.bgm?.audio, ...(this.bgmFade?.outgoing.map(entry => entry.track.audio) ?? []), ...[...this.emitters.values()].map(entry => entry.audio),
        ...[...this.activeSfx].map(entry => entry.audio)];
      for (const audio of audioNodes) {
        if (audio && !audio.paused && !audio.ended) { this.menuSuspended.add(audio); audio.pause(); }
      }
    } else {
      for (const audio of this.menuSuspended) this.requestAutoplay(audio);
      this.menuSuspended.clear();
      for (const audio of this.autoplayQueue) this.playAudio(audio);
    }
  }

  update(deltaTime = 0) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError('Audio timing must be finite and nonnegative');
    if (this.bgmFade && (!menuPaused || !this.pauseWithMenu) && !this.bgm.audio.paused
      && !this.autoplayQueue.has(this.bgm.audio)) {
      this.bgmFade.elapsed = Math.min(this.bgmFade.duration, this.bgmFade.elapsed + deltaTime);
      if (this.bgmFade.elapsed >= this.bgmFade.duration) this.finishBgmFade();
    }
    const progress = this.bgmFade ? this.bgmFade.elapsed / this.bgmFade.duration : 1;
    const angle = progress * Math.PI / 2;
    if (this.bgm) this.bgm.audio.volume = clamp(this.bgm.settings.volume ?? 0.7, 0, 1) * volumes.bgm * Math.sin(angle);
    if (this.bgmFade) {
      for (const { track: { audio, settings }, gain } of this.bgmFade.outgoing) {
        audio.volume = clamp(settings.volume ?? 0.7, 0, 1) * volumes.bgm * gain * Math.cos(angle);
      }
    }
    for (const entry of this.emitters.values()) this.applySpatialVolume({
      audio: entry.audio,
      position: entry.data.position,
      volume: entry.data.volume ?? 1,
      radius: entry.data.radius ?? 12,
    });
    for (const entry of this.activeSfx) this.applySpatialVolume(entry);
  }

  applySpatialVolume({ audio, position, volume, radius }) {
    if (!position || !this.camera) {
      audio.volume = clamp(volume, 0, 1) * volumes.sfx;
      return;
    }
    const listenerPosition = new THREE.Vector3();
    this.camera.getWorldPosition(listenerPosition);
    const distance = listenerPosition.distanceTo(new THREE.Vector3(...position));
    audio.volume = clamp(volume * (1 - distance / Math.max(radius, 0.01)), 0, 1) * volumes.sfx;
  }

  playAudio(audio) {
    this.cancelledPlayback.delete(audio);
    if (menuPaused && this.pauseWithMenu) { this.autoplayQueue.add(audio); return; }
    audio.play().then(() => {
      if (this.cancelledPlayback.has(audio)) { audio.pause(); return; }
      this.autoplayQueue.delete(audio);
      if (menuPaused && this.pauseWithMenu && !audio.paused && !audio.ended) { this.menuSuspended.add(audio); audio.pause(); }
    }).catch(error => {
      if (this.cancelledPlayback.has(audio)) return;
      if (error?.name === 'NotAllowedError') { this.autoplayQueue.add(audio); return; }
      if (error?.name === 'AbortError' && audio.paused) return;
      this.autoplayQueue.delete(audio);
      console.warn('[Audio] Playback failed:', audio.src, error);
    });
  }

  requestAutoplay(audio) {
    // Scene entry may already be authorized by an earlier user gesture.
    // Keep blocked requests queued until playback succeeds or is canceled.
    this.autoplayQueue.add(audio);
    this.playAudio(audio);
  }

  unlockAudio() {
    this.audioUnlocked = true;
    void resumeMusicContext().then(() => {
      for (const audio of this.autoplayQueue) this.playAudio(audio);
    }).catch(error => console.warn('[Audio] Music context could not resume:', error));
  }

  dispose() {
    managers.delete(this);
    this.menuSuspended.clear();
    this.stopBgm();
    this.clearEmitters();
    for (const entry of this.activeSfx) { this.cancelledPlayback.add(entry.audio); entry.audio.pause(); }
    this.activeSfx.clear();
    this.autoplayQueue.clear();
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) {
      window.removeEventListener(type, this.unlockAudio);
    }
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}
