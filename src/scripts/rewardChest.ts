import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel } from '../core/loader.js';
import type { Player } from './player.js';
import { createLightsaber } from './items/createLightsaber.js';

export function createGoggles() {
  const root = new THREE.Group(); root.name = 'ScannerGoggles';
  const frame = new THREE.MeshStandardMaterial({ color: 0x202b34, metalness: 0.65, roughness: 0.35 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x54f4df, emissive: 0x167d72, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.15 });
  for (const x of [-0.065, 0.065]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.085, 0.045), frame);
    rim.position.x = x; root.add(rim);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.093, 0.058, 0.009), lens);
    glass.position.set(x, 0, 0.025); root.add(glass);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.03), frame); root.add(bridge);
  for (const x of [-0.13, 0.13]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.028, 0.19), frame);
    strap.position.set(x, 0, -0.075); root.add(strap);
  }
  return root;
}

function disposeObject(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => materials.add(material));
  });
  materials.forEach(material => {
    Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
    material.dispose();
  });
  textures.forEach(texture => texture.dispose());
  root.removeFromParent();
}

/** One reward per visit; the caller owns cross-visit reward persistence. */
export function createRewardChest({ scene, world, player, position, reward, unlocked, onCollect, removeOnCollect = false }: {
  scene: THREE.Scene; world: CANNON.World; player: Player; position: THREE.Vector3;
  reward: 'goggles' | 'health' | 'lightsaber'; unlocked: () => boolean; onCollect: () => boolean; removeOnCollect?: boolean;
}, load = () => loadToolModel('Prop_Chest')) {
  const root = new THREE.Group(); root.name = `${reward}Chest`; root.position.copy(position); scene.add(root);
  // A usable fallback avoids locking progression if an optional model fails to load.
  const fallback = new THREE.Group(); root.add(fallback);
  const material = new THREE.MeshStandardMaterial({ color: 0x495865, metalness: 0.65, roughness: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.85), material);
  base.position.y = 0.3; fallback.add(base);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.6, 0.425); fallback.add(lidPivot);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.85), material);
  lid.position.set(0, 0.1, -0.425); lidPivot.add(lid);
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.7, 0.4, 0.425)));
  body.position.set(position.x, position.y + 0.4, position.z); world.addBody(body);
  const loot = reward === 'goggles' ? createGoggles() : reward === 'lightsaber' ? createLightsaber() : new THREE.Group();
  if (reward === 'health') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0xf0f4ee }));
    loot.add(box);
    const red = new THREE.MeshBasicMaterial({ color: 0xe74747 });
    for (const size of [[0.22, 0.065], [0.065, 0.22]]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], 0.01), red);
      cross.position.z = -0.116; loot.add(cross);
    }
  }
  loot.position.set(0, 0.85, 0); loot.visible = false; root.add(loot);
  let mixer: THREE.AnimationMixer | null = null;
  let openAction: THREE.AnimationAction | null = null;
  let opening = 0, collected = false, disposed = false;
  const prompt = document.getElementById('interact-prompt');
  let ownsPrompt = false;
  function hidePrompt() { if (ownsPrompt) prompt?.classList.add('hidden'); ownsPrompt = false; }
  const ready = load().then(gltf => {
    if (disposed || opening > 0 || collected) { disposeObject(gltf.scene); return; }
    const model = gltf.scene;
    let box = new THREE.Box3().setFromObject(model);
    model.scale.multiplyScalar(1.4 / Math.max(box.getSize(new THREE.Vector3()).x, 0.01));
    model.rotation.y = Math.PI;
    box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.add(new THREE.Vector3(-center.x, -box.min.y, -center.z));
    model.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    disposeObject(fallback); root.add(model);
    const size = box.getSize(new THREE.Vector3());
    body.removeShape(body.shapes[0]);
    body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
    body.position.y = position.y + size.y / 2; body.aabbNeedsUpdate = true;
    mixer = new THREE.AnimationMixer(model);
    const closed = THREE.AnimationClip.findByName(gltf.animations, 'Idle_Closed');
    if (closed) mixer.clipAction(closed).play();
    const clip = THREE.AnimationClip.findByName(gltf.animations, 'Open');
    if (clip) { openAction = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); openAction.clampWhenFinished = true; }
  }).catch(error => { if (!disposed) console.error('[RewardChest] Using fallback chest:', error); });

  function near() { return player.body.position.distanceTo(new CANNON.Vec3(position.x, position.y + player.radius, position.z)) <= 1.8; }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || disposed || collected || opening > 0 || !player.isEnabled() || !near() || !unlocked()) return;
    if (reward === 'health' && player.getHealth() >= 100) return;
    event.preventDefault(); player.requestAction('Interact');
    opening = 0.001; loot.visible = true; hidePrompt();
    if (openAction && mixer) { mixer.stopAllAction(); openAction.reset().play(); }
  }
  window.addEventListener('keydown', onKeyDown);

  function update(dt: number) {
    if (disposed) return;
    dt = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    mixer?.update(dt);
    if (opening > 0 && !collected) {
      opening += dt;
      lidPivot.rotation.x = -Math.min(1, opening / 0.6) * 1.2;
      loot.position.y = 0.85 + Math.min(0.35, opening * 0.4);
      if (opening >= Math.max(0.8, openAction?.getClip().duration ?? 0)) {
        collected = onCollect(); opening = 0; loot.visible = false;
        if (collected && removeOnCollect) { root.removeFromParent(); world.removeBody(body); }
      }
    }
    if (player.isEnabled() && near() && !collected && opening === 0 && prompt) {
      prompt.textContent = !unlocked() ? (reward === 'goggles' ? 'Destroy every wall target with the pistol' : reward === 'lightsaber' ? 'Defeat the Bay Warden' : 'Break the crates with your crowbar')
        : reward === 'health' && player.getHealth() >= 100 ? 'Health is full' : `Press E to open chest — ${reward === 'goggles' ? 'scanner goggles' : reward === 'lightsaber' ? 'lightsaber' : '+15 HP'}`;
      prompt.classList.remove('hidden'); ownsPrompt = true;
    } else hidePrompt();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; hidePrompt(); window.removeEventListener('keydown', onKeyDown);
    mixer?.stopAllAction();
    if (body.world === world) world.removeBody(body);
    disposeObject(root);
  }
  return { root, body, ready, update, dispose, isCollected: () => collected };
}
