import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel } from '../core/loader.js';
import { createGroundMotor } from '../helpers/physics/scenePhysics.js';
import { createHangarVersus } from '../helpers/scene/hangarVersus.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import { emitComicEffect } from '../helpers/scene/comicEffects.js';
import { createRewardChest } from './rewardChest.js';
import type { Player } from './player.js';
import type { DamageTarget, DamageWeapon } from './pistol.js';
import type { CinematicPose } from './characterManager.js';
import { inputHint } from './gamepadInput.js';

export const WATERFALL_BOSS = Object.freeze({ health: 420, damage: 18, hopSeconds: 1.4, versusSeconds: 2.6 });
type Phase = 'dormant' | 'versus' | 'fight' | 'defeated';
interface WaterfallArena {
  center: THREE.Vector3;
  bounds: THREE.Box3;
  contains(point: { x: number; y: number; z: number }): boolean;
  setLocked(locked: boolean): void;
}

export function createWaterfallMiniboss({ scene, world, player, camera, arena, defeated = false, collected = false,
  loadModel = loadToolModel }: {
  scene: THREE.Scene; world: CANNON.World; player: Player; camera: THREE.PerspectiveCamera;
  arena: WaterfallArena; defeated?: boolean; collected?: boolean; loadModel?: typeof loadToolModel;
}) {
  const root = new THREE.Group(); root.name = 'WaterfallSpiderRobobot'; root.position.copy(arena.center); root.visible = false; scene.add(root);
  const radius = 1.05;
  const body = new CANNON.Body({ mass: 45, shape: new CANNON.Sphere(radius), fixedRotation: true, allowSleep: false,
    linearDamping: 0, material: new CANNON.Material({ friction: 0, restitution: 0 }) });
  body.position.set(root.position.x, radius + 0.04, root.position.z);
  const motor = createGroundMotor(body, radius);
  const versus = createHangarVersus({ singleOpponent: true, playerName: 'BRONDON', opponentName: 'WATERFALL WARDEN', layout: 'columns' });
  const hud = document.createElement('div'); hud.className = 'waterfall-boss-hud hidden';
  const label = document.createElement('strong'); label.textContent = 'WATERFALL WARDEN';
  const track = document.createElement('div'); track.className = 'waterfall-boss-track';
  const fill = document.createElement('div'); fill.className = 'waterfall-boss-fill'; track.appendChild(fill);
  const hint = document.createElement('span'); hint.textContent = 'All weapons available. Evade its landing.';
  hud.append(label, track, hint); document.body.appendChild(hud);
  const warning = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.1, 32),
    new THREE.MeshBasicMaterial({ color: 0xffae5a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  warning.name = 'WaterfallHopWarning'; warning.rotation.x = -Math.PI / 2; warning.visible = false; scene.add(warning);
  const entryCamera = camera.position.clone(), entryRotation = camera.quaternion.clone();
  const hopStart = new THREE.Vector3(), hopEnd = new THREE.Vector3();
  let phase: Phase = defeated ? 'defeated' : 'dormant', health = defeated ? 0 : WATERFALL_BOSS.health;
  let clock = 0, hopClock = -1, cooldown = 1.2, disposed = false, loaded = false, assetError = false, rewardCollected = collected;
  let mixer: THREE.AnimationMixer | null = null, model: THREE.Group | null = null, clips: THREE.AnimationClip[] = [], animation = '';
  let chest: ReturnType<typeof createRewardChest> | null = null;
  function spawnChest() {
    if (chest || rewardCollected || disposed) return;
    chest = createRewardChest({ scene, world, player, position: arena.center.clone().add(new THREE.Vector3(-4, 0, 0)),
      yaw: Math.PI / 2, reward: 'aegis', style: 'crew', unlocked: () => phase === 'defeated',
      canInteract: () => !disposed && player.getHealth() > 0 && !document.hidden && !document.body.classList.contains('quick-menu-open'),
      onCollect: () => { rewardCollected = true; return true; },
    }, loadModel);
  }
  function animate(name: string, once = false) {
    if (!mixer || animation === name) return;
    const clip = clips.find(clip => clip.name === name) ?? clips.find(clip => clip.name === 'Idle');
    if (!clip) return;
    animation = name; mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once; action.play();
  }
  async function load() {
    assetError = false;
    try {
      const asset = await loadModel('Enemy_QuadShell');
      if (disposed) { disposeRoom(asset.scene); return; }
      const bounds = new THREE.Box3().setFromObject(asset.scene), height = bounds.getSize(new THREE.Vector3()).y;
      if (!Number.isFinite(height) || height <= 0) { disposeRoom(asset.scene); throw new Error('Waterfall Warden has empty geometry'); }
      asset.scene.scale.multiplyScalar(3.4 / height); bounds.setFromObject(asset.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      asset.scene.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
      asset.scene.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
      model = asset.scene; root.add(model); clips = asset.animations; mixer = new THREE.AnimationMixer(model);
      loaded = true; animate('Idle');
    } catch (error) {
      if (!disposed) {
        assetError = true; console.error('[Waterfall Warden] Could not load miniboss:', error);
        label.textContent = 'WATERFALL WARDEN COULD NOT LOAD'; hint.textContent = inputHint('E: retry loading');
      }
    }
  }
  const ready = defeated ? Promise.resolve() : load();
  if (defeated) spawnChest();
  function begin() {
    phase = 'versus'; clock = 0; root.visible = true;
    entryCamera.copy(camera.position); entryRotation.copy(camera.quaternion);
    arena.setLocked(true); hud.classList.add('hidden');
    player.disable(); player.body.velocity.set(0, 0, 0);
    player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties();
    versus.update(0);
  }
  function finish() {
    phase = 'defeated'; clock = 0; health = 0; hopClock = -1;
    warning.visible = false; hud.classList.add('hidden'); arena.setLocked(false);
    body.velocity.set(0, 0, 0); body.type = CANNON.Body.KINEMATIC; body.collisionResponse = false; body.updateMassProperties();
    animate('TurnOff', true); spawnChest();
  }
  function damage(amount: number, weapon?: DamageWeapon) {
    if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('Waterfall Warden damage must be positive and finite');
    if (disposed || phase !== 'fight' || !player.isEnabled() || player.getHealth() <= 0
      || (weapon !== 'pistol' && weapon !== 'crowbar' && weapon !== 'lightsaber')) return false;
    health = Math.max(0, health - amount); fill.style.width = `${health / WATERFALL_BOSS.health * 100}%`;
    emitComicEffect(scene, health === 0 ? 'clank' : 'hit', { source: root, weapon, size: 3.4 });
    if (!health) finish();
    return true;
  }
  function beforePhysicsStep(dt: number) {
    if (disposed || phase !== 'fight' || player.getHealth() <= 0) return;
    const p = player.body.position;
    root.rotation.y = Math.atan2(p.x - body.position.x, p.z - body.position.z);
    if (hopClock >= 0) {
      hopClock += dt;
      const duration = WATERFALL_BOSS.hopSeconds, t = Math.min(1, hopClock / duration);
      body.velocity.x = (hopEnd.x - hopStart.x) / duration;
      body.velocity.z = (hopEnd.z - hopStart.z) / duration;
      warning.material.opacity = 0.4 + Math.sin(clock * 25) * 0.25;
      if (t >= 1) {
        const distance = Math.hypot(p.x - body.position.x, p.z - body.position.z);
        if (distance < 2.5 && Math.abs(p.y - player.radius) < 1.4) player.takeDamage(WATERFALL_BOSS.damage);
        emitComicEffect(scene, 'thud', { position: new THREE.Vector3(body.position.x, 0.1, body.position.z), size: 3 });
        hopClock = -1; cooldown = 1.1; warning.visible = false; animate('Idle');
      }
      return;
    }
    cooldown -= dt;
    const direction = new THREE.Vector3(p.x - body.position.x, 0, p.z - body.position.z);
    const distance = direction.length();
    if (cooldown > 0.4) {
      direction.normalize(); motor.drive(direction.x, direction.z, distance > 2.2 ? 1.7 : 0); animate(distance > 2.2 ? 'Walk' : 'Idle');
    } else {
      motor.drive(0, 0, 0); animate('Charge');
      hopEnd.set(THREE.MathUtils.clamp(p.x, arena.bounds.min.x + 2, arena.bounds.max.x - 2), radius + 0.04,
        THREE.MathUtils.clamp(p.z, arena.bounds.min.z + 2, arena.bounds.max.z - 2));
      warning.position.set(hopEnd.x, 0.07, hopEnd.z); warning.visible = true;
      if (cooldown <= 0) {
        hopStart.copy(body.position); hopClock = 0; motor.reset(); animate('Attack', true);
        body.velocity.y = -world.gravity.y * WATERFALL_BOSS.hopSeconds * 0.5;
        body.wakeUp();
      }
    }
  }
  function afterPhysicsStep() {
    if (phase !== 'fight') return;
    body.position.x = THREE.MathUtils.clamp(body.position.x, arena.bounds.min.x + radius, arena.bounds.max.x - radius);
    body.position.z = THREE.MathUtils.clamp(body.position.z, arena.bounds.min.z + radius, arena.bounds.max.z - radius);
    if (hopClock < 0) motor.readSupport();
    root.position.set(body.position.x, body.position.y - radius, body.position.z);
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'KeyE' && !event.repeat && assetError && arena.contains(player.body.position)
      && !document.hidden && !document.body.classList.contains('quick-menu-open')) { event.preventDefault(); void load(); }
  };
  window.addEventListener('keydown', onKey);
  return {
    root, body, ready, beforePhysicsStep, afterPhysicsStep,
    getDamageTargets: (): DamageTarget[] => phase === 'fight' && !disposed ? [{ root, body, damage }] : [],
    getStatus: () => ({ phase, health, loaded, assetError, hopping: hopClock >= 0, defeated: phase === 'defeated', collected: rewardCollected }),
    isCinematic: () => phase === 'versus',
    getCinematicPose: (): CinematicPose | null => phase === 'versus' ? { clip: 'Idle_Loop', time: clock, loop: true } : null,
    captureCharacter(character: THREE.Object3D) { if (phase === 'versus') versus.capture(character, [root]); },
    renderOverlay(renderer: THREE.WebGLRenderer) { if (phase === 'versus') versus.render(renderer); },
    applyCinematicCamera() {
      if (phase !== 'versus') return false;
      camera.position.copy(entryCamera); camera.quaternion.copy(entryRotation); return true;
    },
    update(dt: number) {
      if (disposed) return;
      clock += dt; mixer?.update(dt); chest?.update(dt);
      if (phase === 'dormant' && arena.contains(player.body.position) && player.isEnabled() && player.getHealth() > 0) {
        hud.classList.toggle('hidden', !assetError);
        if (loaded) begin();
      } else if (phase === 'versus') {
        versus.update(clock);
        if (clock >= WATERFALL_BOSS.versusSeconds) {
          versus.hide(); phase = 'fight'; clock = 0;
          world.addBody(body); body.aabbNeedsUpdate = true; motor.reset();
          player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.enable();
          hud.classList.remove('hidden'); fill.style.width = '100%';
          label.textContent = 'WATERFALL WARDEN'; hint.textContent = 'All weapons available. Evade its landing.';
        }
      } else if (phase === 'defeated' && clock > 1.8) root.visible = false;
    },
    dispose() {
      if (disposed) return; disposed = true; arena.setLocked(false);
      window.removeEventListener('keydown', onKey); versus.dispose(); hud.remove(); chest?.dispose();
      mixer?.stopAllAction(); if (model) mixer?.uncacheRoot(model);
      root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      if (body.world === world) world.removeBody(body);
      root.removeFromParent(); warning.removeFromParent(); warning.geometry.dispose(); warning.material.dispose();
      disposeRoom(root);
    },
  };
}