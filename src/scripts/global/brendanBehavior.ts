import * as THREE from 'three';
import { loadVergilsChair } from '../../core/loader.js';
import { disposeRoom } from './shipRoom.js';
import { playSfx } from '../../helpers/audio/sfx.js';

export type BrendanActivity = 'idle' | 'walk' | 'talk' | 'ambient';
type Mode = 'pace' | 'hit' | 'fall' | 'lying' | 'getUp' | 'dance' | 'loadChair' | 'toChair' | 'sitEnter' | 'sit' | 'sitExit';

const MAX_HEALTH = 30, LYING_HEIGHT = 0.22, SEAT_FORWARD = 0.25;

export function createBrendanBehavior(root: THREE.Group, model: THREE.Object3D, clips: THREE.AnimationClip[],
  pod: THREE.Vector3) {
  const mixer = new THREE.AnimationMixer(model);
  // The pivot lets the whole body tip over about the feet when Brendan is knocked down.
  const pivot = new THREE.Group(); root.add(pivot);
  function action(name: string) {
    const clip = clips.find(clip => clip.name === name);
    if (!clip) throw new Error(`Brendan requires the ${name} animation`);
    return mixer.clipAction(clip);
  }
  function once(name: string) {
    const a = action(name); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; return a;
  }
  const idle = action('Idle_Loop'), walk = action('Walk_Loop');
  const talk = action('Idle_Talking_Loop'), inspect = action('Interact');
  const dance = action('Dance_Loop'), sitIdle = action('Sitting_Idle_Loop');
  const hit = once('Hit_Chest'), hitHead = once('Hit_Head'), sitEnter = once('Sitting_Enter'), sitExit = once('Sitting_Exit');
  const actions = { idle, walk, talk, inspect };
  let current = idle, activity: BrendanActivity = 'idle';
  let destination = -1, waiting = 0, arrived = false;
  let mode: Mode = 'pace', modeTime = 0, modeDuration = 0, health = MAX_HEALTH;
  let chair: THREE.Object3D | null = null, chairAge = 0, chairRequest = 0, chairYaw = 0;
  const chairSeat = new THREE.Vector3(), chairStand = new THREE.Vector3(), sitFrom = new THREE.Vector3();
  // Stay on the open south side of the wreck, clear of its rotated hull and the shuttle.
  const stops = [
    new THREE.Vector3(pod.x - 2.5, 0, pod.z + 3.8),
    new THREE.Vector3(pod.x + 2.5, 0, pod.z + 3.8),
    new THREE.Vector3(pod.x - 1.5, 0, pod.z + 5.5),
    new THREE.Vector3(pod.x + 1.5, 0, pod.z + 5.5),
  ];
  const delta = new THREE.Vector3();
  idle.play(); mixer.update(0);
  function play(next: THREE.AnimationAction) {
    if (next === current) return;
    current.fadeOut(0.25);
    current = next.reset().fadeIn(0.25).play();
  }
  function faceYaw(yaw: number, dt: number) {
    root.rotation.y += Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y)) * Math.min(1, dt * 5);
  }
  function face(x: number, z: number, dt: number) { faceYaw(Math.atan2(x - root.position.x, z - root.position.z), dt); }
  function moveToward(target: THREE.Vector3, dt: number, speed = 0.75) {
    delta.subVectors(target, root.position); delta.y = 0;
    const distance = delta.length();
    face(target.x, target.z, dt);
    root.position.addScaledVector(delta, Math.min(distance, dt * speed) / Math.max(distance, 0.001));
    return distance;
  }
  function setMode(next: Mode, duration = 0) { mode = next; modeTime = 0; modeDuration = duration; }
  function removeChair() {
    chairRequest++;
    if (!chair) return;
    chair.removeFromParent(); disposeRoom(chair as unknown as THREE.Scene); chair = null;
  }
  function setTilt(amount: number) {
    pivot.rotation.x = -Math.PI / 2 * amount;
    pivot.position.y = LYING_HEIGHT * amount;
  }
  function startDance() { play(dance); setMode('dance', 3.5 + Math.random() * 2.5); }
  function resumePace() {
    setMode('pace'); setTilt(0); waiting = 0; arrived = false; destination = -1; play(walk);
  }
  function startChair() {
    const request = ++chairRequest;
    // Spawn the chair on open ground south of the wreck, away from Brendan himself.
    const position = new THREE.Vector3();
    for (let attempt = 0; attempt < 12; attempt++) {
      position.set(pod.x + (Math.random() * 2 - 1) * 3.2, 0, pod.z + 3.6 + Math.random() * 2.6);
      if (position.distanceTo(root.position) > 1.8) break;
    }
    chairYaw = Math.random() * Math.PI * 2;
    play(idle); setMode('loadChair');
    loadVergilsChair().then(gltf => {
      const asset = gltf.scene;
      if (request !== chairRequest) { disposeRoom(asset as unknown as THREE.Scene); return; }
      const bounds = new THREE.Box3().setFromObject(asset);
      asset.scale.multiplyScalar(1 / Math.max(0.01, bounds.getSize(new THREE.Vector3()).y));
      bounds.setFromObject(asset); const center = bounds.getCenter(new THREE.Vector3());
      asset.position.set(-center.x, -bounds.min.y, -center.z);
      asset.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
      const holder = new THREE.Group(); holder.add(asset);
      holder.position.copy(position); holder.rotation.y = chairYaw; holder.scale.setScalar(0.01);
      root.parent?.add(holder); chair = holder; chairAge = 0;
      const front = new THREE.Vector3(Math.sin(chairYaw), 0, Math.cos(chairYaw));
      chairSeat.copy(position).addScaledVector(front, SEAT_FORWARD);
      chairStand.copy(position).addScaledVector(front, 0.85 + SEAT_FORWARD);
      play(walk); setMode('toChair');
    }).catch(error => {
      console.error('[Brendan] Could not load Vergil\'s chair:', error);
      if (request === chairRequest) resumePace();
    });
  }
  function chooseNext() {
    const roll = Math.random();
    if (roll < 0.3) startDance();
    else if (roll < 0.6) startChair();
    else resumePace();
  }
  function takeHit(amount: number, knock = false) {
    if (activity !== 'ambient' || mode === 'fall' || mode === 'lying' || mode === 'getUp') return false;
    removeChair();
    playSfx('brendan', 0.9);
    health = Math.max(0, health - amount);
    if (health <= 0 || knock) { health = MAX_HEALTH; play(hitHead); setMode('fall', 0.4); }
    else { play(hit); setMode('hit', 0.55); }
    return true;
  }
  function updatePace(dt: number) {
    if (waiting > 0) {
      waiting = Math.max(0, waiting - dt);
      face(pod.x, pod.z, dt);
      if (waiting === 0 && arrived) { arrived = false; chooseNext(); }
      return;
    }
    if (destination < 0 || root.position.distanceTo(stops[destination]) < 0.02) {
      if (destination >= 0) {
        waiting = 3 + Math.random() * 4; arrived = true;
        play(Math.random() < 0.65 ? inspect : idle);
        return;
      }
      destination = Math.floor(Math.random() * stops.length);
    }
    moveToward(stops[destination], dt); play(walk);
  }
  function updateAmbient(dt: number) {
    modeTime += dt;
    const t = modeDuration > 0 ? Math.min(1, modeTime / modeDuration) : 0;
    if (chair && chairAge < 0.5) { chairAge += dt; chair.scale.setScalar(THREE.MathUtils.smoothstep(chairAge, 0, 0.5)); }
    switch (mode) {
      case 'pace': updatePace(dt); break;
      case 'hit': if (t >= 1) resumePace(); break;
      case 'fall':
        setTilt(THREE.MathUtils.smoothstep(t, 0, 1));
        if (t >= 1) { setMode('lying', 1.6 + Math.random() * 0.8); }
        break;
      case 'lying': if (t >= 1) setMode('getUp', 0.7); break;
      case 'getUp':
        setTilt(1 - THREE.MathUtils.smoothstep(t, 0, 1));
        if (t >= 1) { setTilt(0); startDance(); }
        break;
      case 'dance': if (t >= 1) resumePace(); break;
      case 'toChair':
        if (moveToward(chairStand, dt, 1) < 0.05) {
          sitFrom.copy(root.position); play(sitEnter); setMode('sitEnter', sitEnter.getClip().duration);
        }
        break;
      case 'sitEnter':
        faceYaw(chairYaw, dt * 1.5);
        root.position.lerpVectors(sitFrom, chairSeat, THREE.MathUtils.smoothstep(t, 0.3, 1));
        if (t >= 1) { play(sitIdle); setMode('sit', 5 + Math.random() * 5); }
        break;
      case 'sit':
        if (t >= 1) { sitFrom.copy(root.position); play(sitExit); setMode('sitExit', sitExit.getClip().duration); }
        break;
      case 'sitExit':
        root.position.lerpVectors(sitFrom, chairStand, THREE.MathUtils.smoothstep(t, 0, 0.6));
        if (t >= 1) { removeChair(); resumePace(); }
        break;
    }
  }
  return {
    pivot,
    setActivity(next: BrendanActivity) {
      if (activity === next) return;
      activity = next;
      removeChair(); setTilt(0); health = MAX_HEALTH; setMode('pace');
      if (next === 'ambient') { destination = -1; waiting = 0; arrived = false; }
      else play(actions[next]);
    },
    update(dt: number, viewer?: { x: number; z: number }) {
      if (activity === 'ambient') updateAmbient(dt);
      else if (activity === 'talk' && viewer) face(viewer.x, viewer.z, dt);
      mixer.update(dt);
    },
    // Punches stagger him and a few in a row, or a slide tackle, knock him flat.
    damage(amount: number) { return takeHit(amount); },
    knockDown() { return takeHit(0, true); },
    dispose() { removeChair(); mixer.stopAllAction(); mixer.uncacheRoot(model); },
  };
}
