import * as THREE from 'three';

const tracksFor = (keyframes) => {
  const tracks = [];
  for (const [property, frames] of Object.entries(keyframes)) {
    if (!Array.isArray(frames) || frames.length === 0) continue;
    const times = frames.map((frame) => frame.time);
    const values = frames.flatMap((frame) => frame.value);
    const valueSize = frames[0].value.length;
    const trackType = valueSize === 3 ? 'VectorKeyframeTrack' : 'NumberKeyframeTrack';
    tracks.push(new THREE[trackType](`.${property}`, times, values));
  }
  return tracks;
};

export class AnimationManager {
  constructor() {
    this.mixers = new Map();
    this.actions = new Map();
  }

  createClipFromKeyframes(target, keyframes, name = 'generated-clip') {
    if (!target) throw new Error('Animation target is required.');
    const clip = new THREE.AnimationClip(name, -1, tracksFor(keyframes));
    const mixer = this.getMixer(target);
    const action = mixer.clipAction(clip);
    this.actions.set(name, action);
    return clip;
  }

  play(name, { loop = THREE.LoopRepeat, repetitions = Infinity } = {}) {
    const action = this.actions.get(name);
    if (!action) throw new Error(`Unknown animation clip: ${name}`);
    action.setLoop(loop, repetitions).reset().play();
    return action;
  }

  stop(name) {
    this.actions.get(name)?.stop();
  }

  update(deltaTime) {
    for (const mixer of this.mixers.values()) mixer.update(deltaTime);
  }

  getMixer(target) {
    if (!this.mixers.has(target)) this.mixers.set(target, new THREE.AnimationMixer(target));
    return this.mixers.get(target);
  }

  removeTarget(target) {
    this.mixers.get(target)?.stopAllAction();
    this.mixers.delete(target);
  }
}
