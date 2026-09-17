import * as THREE from 'three';

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

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
    this.unlockAudio = this.unlockAudio.bind(this);
    window.addEventListener('pointerdown', this.unlockAudio, { once: true });
    window.addEventListener('keydown', this.unlockAudio, { once: true });
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
    return audio;
  }

  setBgm(settings) {
    this.stopBgm();
    if (!settings?.path) return;
    const audio = this.createAudio(settings.path, { loop: settings.loop !== false });
    audio.volume = clamp(settings.volume ?? 0.7, 0, 1);
    this.bgm = { audio, settings: { ...settings } };
    if (settings.autoplay) this.requestAutoplay(audio);
  }

  playBgm() {
    if (this.bgm) this.playAudio(this.bgm.audio);
  }

  stopBgm() {
    if (!this.bgm) return;
    this.bgm.audio.pause();
    this.bgm.audio.currentTime = 0;
    this.bgm = null;
  }

  registerEmitter(emitter) {
    this.removeEmitter(emitter.id);
    const audio = this.createAudio(emitter.path, { loop: emitter.loop !== false });
    const entry = { data: structuredClone(emitter), audio };
    this.emitters.set(emitter.id, entry);
    if (emitter.autoplay !== false) this.requestAutoplay(audio);
    return entry;
  }

  removeEmitter(id) {
    const entry = this.emitters.get(id);
    if (!entry) return;
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

  update() {
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
      audio.volume = clamp(volume, 0, 1);
      return;
    }
    const listenerPosition = new THREE.Vector3();
    this.camera.getWorldPosition(listenerPosition);
    const distance = listenerPosition.distanceTo(new THREE.Vector3(...position));
    audio.volume = clamp(volume * (1 - distance / Math.max(radius, 0.01)), 0, 1);
  }

  playAudio(audio) {
    audio.play().catch(() => {});
  }

  requestAutoplay(audio) {
    if (this.audioUnlocked) this.playAudio(audio);
    else this.autoplayQueue.add(audio);
  }

  unlockAudio() {
    this.audioUnlocked = true;
    for (const audio of this.autoplayQueue) this.playAudio(audio);
    this.autoplayQueue.clear();
  }

  dispose() {
    this.stopBgm();
    this.clearEmitters();
    for (const entry of this.activeSfx) entry.audio.pause();
    this.activeSfx.clear();
    this.autoplayQueue.clear();
    window.removeEventListener('pointerdown', this.unlockAudio);
    window.removeEventListener('keydown', this.unlockAudio);
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }
}
