import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel } from '../core/loader.js';
import type { Player } from './player.js';
import { createLightsaber } from './items/createLightsaber.js';
import { createCrowbar } from './items/createCrowbar.js';
import { createCrewChest, CREW_CHEST_SIZE } from '../helpers/scene/crewChest.js';
import { createRecoveryPickup } from '../helpers/scene/recoveryPickup.js';

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
export function createRewardChest({ scene, world, player, position, yaw = 0, reward, unlocked, onCollect, removeOnCollect = false,
  style = 'model', initialCollected = false, canInteract = () => true, lockedPrompt }: {
  scene: THREE.Scene; world: CANNON.World; player: Player; position: THREE.Vector3; yaw?: number;
  reward: 'goggles' | 'health' | 'shield' | 'lightsaber' | 'crowbar';
  unlocked: () => boolean; onCollect: () => boolean; removeOnCollect?: boolean;
  style?: 'model' | 'crew'; initialCollected?: boolean; canInteract?: () => boolean; lockedPrompt?: string;
}, load = () => loadToolModel('Prop_Chest')) {
  const root = new THREE.Group(); root.name = `${reward}Chest`; root.position.copy(position); root.rotation.y = yaw; scene.add(root);
  const footlocker = createCrewChest(reward === 'lightsaber' ? 0xbd77ff : 0x6ad9e8), fallback = footlocker.root;
  root.add(fallback); footlocker.update(0, initialCollected, true);
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(new CANNON.Box(new CANNON.Vec3(CREW_CHEST_SIZE.x / 2, CREW_CHEST_SIZE.y / 2, CREW_CHEST_SIZE.z / 2)));
  body.position.set(position.x, position.y + CREW_CHEST_SIZE.y / 2, position.z);
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw); world.addBody(body);
  const loot = reward === 'goggles' ? createGoggles() : reward === 'lightsaber' ? createLightsaber()
    : reward === 'crowbar' ? createCrowbar() : reward === 'shield'
      ? createRecoveryPickup('shield', new THREE.Vector3(), { compact: true, illuminate: false }).root : new THREE.Group();
  if (reward === 'crowbar' || reward === 'lightsaber') {
    loot.rotation.z = Math.PI / 2; loot.scale.setScalar(reward === 'lightsaber' ? 0.8 : 0.9);
  }
  if (reward === 'health') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0xf0f4ee }));
    loot.add(box);
    const red = new THREE.MeshBasicMaterial({ color: 0xe74747 });
    for (const size of [[0.22, 0.065], [0.065, 0.22]]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], 0.01), red);
      cross.position.z = -0.116; loot.add(cross);
    }
  }
  loot.position.set(reward === 'lightsaber' ? 0.5 : reward === 'crowbar' ? 0.2 : 0, 0.85, 0);
  loot.visible = false; root.add(loot);
  let mixer: THREE.AnimationMixer | null = null;
  let openAction: THREE.AnimationAction | null = null;
  let opening = 0, collected = initialCollected, disposed = false;
  const prompt = document.getElementById('interact-prompt');
  let ownsPrompt = false;
  function hidePrompt() { if (ownsPrompt) prompt?.classList.add('hidden'); ownsPrompt = false; }
  const ready = style === 'crew' ? Promise.resolve() : load().then(gltf => {
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
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || disposed || collected || opening > 0
      || !canInteract() || !player.isEnabled() || player.getState().boxHandling || !near() || !unlocked()) return;
    if (document.hidden || document.body.classList.contains('quick-menu-open') ||
      (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]'))) return;
    if (reward === 'health' && player.getHealth() >= 100) return;
    if (reward === 'shield' && player.getShield() >= player.getMaxShield()) return;
    event.preventDefault(); event.stopImmediatePropagation(); player.requestAction('Interact');
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
      footlocker.update(dt, true);
      loot.position.y = 0.85 + Math.min(0.35, opening * 0.4);
      if (opening >= Math.max(0.8, openAction?.getClip().duration ?? 0)) {
        collected = onCollect(); opening = 0; loot.visible = false;
        if (collected && removeOnCollect) { root.removeFromParent(); world.removeBody(body); }
      }
    }
    if (canInteract() && player.isEnabled() && !player.getState().boxHandling && near() && !collected && opening === 0 && prompt) {
      prompt.textContent = !unlocked() ? lockedPrompt ?? (reward === 'goggles' ? 'Destroy every wall target with the pistol' : reward === 'lightsaber' ? 'Unlock the Bay Warden door' : 'Break the crates with your crowbar')
        : reward === 'health' && player.getHealth() >= 100 ? 'Health is full'
          : reward === 'shield' && player.getShield() >= player.getMaxShield() ? 'Shield is full'
            : `Press E to open chest - ${reward === 'goggles' ? 'scanner goggles' : reward === 'lightsaber' ? 'lightsaber'
              : reward === 'crowbar' ? 'crowbar' : reward === 'shield' ? '+25 shield' : '+15 HP'}`;
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
  return { root, body, ready, update, dispose, isCollected: () => collected, isPromptVisible: () => ownsPrompt, isOpening: () => opening > 0,
    setCollected() {
      collected = true; opening = 0; loot.visible = false; hidePrompt(); footlocker.update(0, true, true);
      if (removeOnCollect) { root.removeFromParent(); if (body.world === world) world.removeBody(body); }
    } };
}
