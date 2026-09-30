import * as THREE from 'three';

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const volumes = { bgm: 1, sfx: 1 };
let menuPaused = false;
/** @type {Set<AudioManager>} */
const managers = new Set();
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
  constructor({ camera, getFile } = {}) {
    this.camera = camera;
    this.getFile = getFile || (() => null);
    this.bgm = null;
    this.emitters = new Map();
    this.activeSfx = new Set();
    this.objectUrls = new Map();
    this.activeEmitterActors = new Map();
    this.autoplayQueue = new Set();
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
    const audio = new Audio(source);
    audio.loop = loop;
    // Force a full buffer up front so the first play() call is instant once the user unlocks audio.
    audio.preload = 'auto';
    audio.load();
    return audio;
  }

  setBgm(settings) {
    this.stopBgm();
    if (!settings?.path) return;
    const audio = this.createAudio(settings.path, { loop: settings.loop !== false });
    audio.volume = clamp(settings.volume ?? 0.7, 0, 1) * volumes.bgm;
    this.bgm = { audio, settings: { ...settings } };
    if (settings.autoplay) this.requestAutoplay(audio);
  }

  playBgm() {
    if (this.bgm) this.requestAutoplay(this.bgm.audio);
  }

  pauseBgm() {
    if (!this.bgm) return;
    this.autoplayQueue.delete(this.bgm.audio);
    this.menuSuspended.delete(this.bgm.audio);
    this.bgm.audio.pause();
  }

  stopBgm() {
    if (!this.bgm) return;
    this.pauseBgm();
    this.bgm.audio.currentTime = 0;
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
    if (paused) {
      const audioNodes = [this.bgm?.audio, ...[...this.emitters.values()].map(entry => entry.audio),
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

  update() {
    if (this.bgm) this.bgm.audio.volume = clamp(this.bgm.settings.volume ?? 0.7, 0, 1) * volumes.bgm;
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
    if (menuPaused) { this.autoplayQueue.add(audio); return; }
    audio.play().then(() => {
      this.autoplayQueue.delete(audio);
      if (menuPaused) { this.menuSuspended.add(audio); audio.pause(); }
    }).catch(() => {});
  }

  requestAutoplay(audio) {
    // Scene entry may already be authorized by an earlier user gesture.
    // Keep blocked requests queued until playback succeeds or is canceled.
    this.autoplayQueue.add(audio);
    this.playAudio(audio);
  }

  unlockAudio() {
    this.audioUnlocked = true;
    for (const audio of this.autoplayQueue) this.playAudio(audio);
  }

  dispose() {
    managers.delete(this);
    this.menuSuspended.clear();
    this.stopBgm();
    this.clearEmitters();
    for (const entry of this.activeSfx) entry.audio.pause();
    this.activeSfx.clear();
    this.autoplayQueue.clear();
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) {
      window.removeEventListener(type, this.unlockAudio);
    }
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}
