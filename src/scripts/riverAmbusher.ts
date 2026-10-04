import * as THREE from 'three';
import { loadToolModel } from '../core/loader.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { emitComicEffect } from '../helpers/scene/comicEffects.js';

type QuadShellAsset = Awaited<ReturnType<typeof loadToolModel>>;
function releaseAsset(asset: QuadShellAsset) {
  asset.scene.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
  disposeRoom(asset.scene as unknown as THREE.Scene);
}

/** One asset allocation per encounter, with independent skeletons and mixers for each actor. */
export function createRiverAmbushers(scene: THREE.Object3D, health: number[]) {
  let disposed = false, asset: QuadShellAsset | null = null;
  const source = loadToolModel('Enemy_QuadShell');
  const actors = health.map(value => createRiverAmbusher(scene, value, source));
  const ready = Promise.all(actors.map(actor => actor.ready));
  void source.then(value => { if (disposed) releaseAsset(value); else asset = value; }).catch(() => {});
  return { actors, ready, dispose() {
    if (disposed) return; disposed = true;
    actors.forEach(actor => actor.dispose());
    if (asset) { releaseAsset(asset); asset = null; }
  } };
}

/** Shared identity and animation for the bridge attacker and its river pursuit. */
export function createRiverAmbusher(scene: THREE.Object3D, initialHealth = 125, source?: Promise<QuadShellAsset>) {
  const root = new THREE.Group(); root.name = 'RiverQuadShell'; scene.add(root);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 2.2, 1.3); root.add(muzzle);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xff5038 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), lampMaterial); muzzle.add(lamp);
  let mixer: THREE.AnimationMixer | null = null, health = initialHealth, disposed = false, loaded = false, error = false;
  let clips: THREE.AnimationClip[] = [], current = '', shotTime = 0, deathTime = 0, chargeLevel = 0, walking = false;
  let model: THREE.Object3D | null = null, ownedAsset: QuadShellAsset | null = null;
  const restingClip = () => chargeLevel > 0 ? 'Charge' : walking ? 'Walk' : 'Idle';
  function clipDuration(name: string, fallback: number) { return clips.find(clip => clip.name === name)?.duration || fallback; }
  function play(name: string, once = false) {
    if (!mixer || current === name) return;
    const clip = clips.find(c => c.name === name) ?? clips.find(c => /idle|walk/i.test(c.name));
    if (!clip) return;
    mixer.stopAllAction(); const action = mixer.clipAction(clip); action.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity).play();
    action.clampWhenFinished = once; current = name;
  }
  const ready = (source ?? loadToolModel('Enemy_QuadShell')).then(gltf => {
    if (disposed) { if (!source) releaseAsset(gltf); return; }
    if (!source) ownedAsset = gltf;
    model = clone(gltf.scene);
    const bounds = new THREE.Box3().setFromObject(model);
    model.scale.multiplyScalar(3.1 / Math.max(0.01, bounds.getSize(new THREE.Vector3()).y));
    bounds.setFromObject(model); const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    model.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    root.add(model); clips = gltf.animations; mixer = new THREE.AnimationMixer(model); loaded = true;
    play(health > 0 ? 'Idle' : 'TurnOff', health <= 0);
  }).catch(reason => { if (!disposed) { error = true; console.error('[River] QuadShell could not load:', reason); } });
  return {
    root, muzzle, ready,
    get health() { return health; }, get loaded() { return loaded; }, get error() { return error; },
    aimAt(target: THREE.Vector3) { if (health > 0) root.rotation.y = Math.atan2(target.x - root.position.x, target.z - root.position.z); },
    walk(value: boolean) { walking = value; if (health > 0 && shotTime <= 0) play(restingClip()); },
    fire() {
      if (disposed || health <= 0) return;
      shotTime = clipDuration('Attack', 0.3); chargeLevel = 0; current = ''; play('Attack', true);
    },
    charge(value: number) {
      if (disposed || health <= 0) return;
      chargeLevel = THREE.MathUtils.clamp(value, 0, 1);
      lamp.scale.setScalar(1 + chargeLevel * 2.5); lampMaterial.color.setHex(chargeLevel > 0.7 ? 0xffeeaa : 0xff5038);
      if (shotTime <= 0) play(restingClip());
    },
    damage(amount: number, weapon?: string) {
      if (disposed || health <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
      health = Math.max(0, health - amount); lampMaterial.color.setHex(0xffffff);
      emitComicEffect(scene, health === 0 ? 'clank' : 'hit', { source: root, weapon });
      if (health === 0) { deathTime = 0; play('TurnOff', true); }
      return true;
    },
    update(dt: number) {
      mixer?.update(dt);
      shotTime = Math.max(0, shotTime - dt);
      if (health <= 0) {
        deathTime += dt; root.rotation.z = Math.min(1.25, deathTime * 0.65);
        if (deathTime > Math.max(2.4, clipDuration('TurnOff', 2.15) + 0.25)) root.visible = false;
      } else if (shotTime <= 0 && current === 'Attack') {
        play(restingClip());
        lamp.scale.setScalar(1 + chargeLevel * 2.5); lampMaterial.color.setHex(chargeLevel > 0.7 ? 0xffeeaa : 0xff5038);
      }
    },
    dispose() {
      if (disposed) return; disposed = true; mixer?.stopAllAction(); if (mixer) mixer.uncacheRoot(mixer.getRoot());
      model?.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      model?.removeFromParent(); model = null;
      root.removeFromParent(); disposeRoom(root as unknown as THREE.Scene);
      if (ownedAsset) { releaseAsset(ownedAsset); ownedAsset = null; }
    },
  };
}
