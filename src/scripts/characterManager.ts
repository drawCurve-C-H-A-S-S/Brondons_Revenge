/**
 * Character Manager - Loads UAL1 rigged character, manages first/third-person
 * model positioning and animation state.
 *
 * First-person hides the model. Third-person shows it at the player's feet.
 * Animation state is local to each character and follows the player state.
 *
 * Character persists across scene transitions - reparent to the active scene.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import ualModelUrl from '../assets/models/Subject.glb';
import { createHeldItemHandler, HeldItemDef } from './items/heldItemHandler.js';
import { createHammer } from './items/createHammer.js';

import type { PlayerState } from './player.js';

interface Vec3Like { x: number; y: number; z: number; }

const CLIP_NAMES = [
  'Idle_Loop', 'Walk_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
  // One-shot action clips on number keys 6-9 (input mapping in player.ts).
  'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Dance_Loop',
] as const;
type ClipName = typeof CLIP_NAMES[number];

// One-shot action clips. They play once per key press, then the normal
// locomotion state machine resumes (idle or walk, mixer-driven completion).
const ACTION_CLIPS: ReadonlySet<string> = new Set([
  'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Dance_Loop',
]);
const ONE_SHOT_CLIPS = ['Jump_Start', 'Jump_Land', ...ACTION_CLIPS];

// Rotation offset: the UAL model's local forward is +Z, but the camera
// looks toward -Z at yaw 0.  Adding PI keeps the model facing the same
// direction the camera is looking.
const MODEL_ROT_OFFSET = Math.PI;

const RIGHT_HAND_BONE_CANDIDATES = [
  'hand_r', 'RightHand', 'mixamorigRightHand', 'Hand_R', 'hand.R',
];

function findBone(model: THREE.Object3D, candidates: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  model.traverse((child) => {
    if (found) return;
    if ((child as THREE.Bone).isBone && candidates.includes(child.name)) {
      found = child;
    }
  });
  return found;
}

export async function loadCharacter(loader = new GLTFLoader()) {

  let gltf;
  try {
    gltf = await loader.loadAsync(ualModelUrl);
    console.log('UAL1 character loaded');
  } catch (error) {
    console.error('Failed to load UAL1 character model:', error);
    return null;
  }

  const model = gltf.scene;
  model.scale.set(1, 1, 1);
  const modelOffsetY = -new THREE.Box3().setFromObject(model).min.y;
  let wasOnGround: boolean | null = null;
  model.rotation.y = MODEL_ROT_OFFSET;

  // Layer 0: third-person camera renders the character.
  // Layer 1: mirror reflection renders the character.
  model.traverse((child: THREE.Object3D) => {
    child.layers.enable(0);
    child.layers.enable(1);
    if ((child as THREE.Mesh).isMesh) {
      (child as THREE.Mesh).castShadow = true;
      (child as THREE.Mesh).receiveShadow = true;
    }
  });

  // ---- Animation setup ----
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations || [];
  console.log('=== UAL1 ANIMATION DEBUG ===');
  console.log('Total clips:', clips.length);
  console.log('Clip names:', clips.map((c: THREE.AnimationClip) => c.name));

  // Log all bones in the model
  const bones: string[] = [];
  model.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Bone).isBone) {
      bones.push((child as THREE.Bone).name);
    }
  });
  console.log('Bones (' + bones.length + '):', bones);

  // Log tracks for each clip (what bones/properties they target)
  for (const clip of clips) {
    const trackNames = clip.tracks.map((t: THREE.KeyframeTrack) => t.name);
    console.log('Clip "' + clip.name + '" tracks (' + trackNames.length + '):', trackNames.slice(0, 10).join(', ') + (trackNames.length > 10 ? '...' : ''));
  }

  // This is the in-place UAL export. Preserve its original bone tracks.
  const actions = new Map<ClipName, THREE.AnimationAction>();
  for (const name of CLIP_NAMES) {
    const clip = THREE.AnimationClip.findByName(clips, name);
    if (!clip) {
      console.error(`Required UAL1 animation missing: ${name}`);
      mixer.uncacheRoot(model);
      return null;
    }
    const action = mixer.clipAction(clip);
    const oneShot = ONE_SHOT_CLIPS.includes(name);
    action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    action.clampWhenFinished = oneShot;
    actions.set(name, action);
  }

  let currentAction = actions.get('Idle_Loop')!;
  currentAction.play();
  mixer.update(0);

  const rightHand = findBone(model, RIGHT_HAND_BONE_CANDIDATES);
  if (!rightHand) {
    console.warn('Right hand bone not found — check the bone list above and update RIGHT_HAND_BONE_CANDIDATES.');
  }
  const heldItems = rightHand ? createHeldItemHandler(rightHand) : null;

  function fadeTo(name: ClipName) {
    const next = actions.get(name)!;
    if (next === currentAction && !currentAction.paused) return;
    currentAction.fadeOut(0.2);
    next.reset().setEffectiveTimeScale(name === 'Sword_Attack' ? 1.8 : 1).setEffectiveWeight(1).fadeIn(0.2).play();
    currentAction = next;
  }

  // ---- Per-frame update ----

  function update(
    dt: number,
    playerBodyPos: Vec3Like,
    playerState: PlayerState,
    thirdPerson: boolean,
    playerRadius: number,
  ) {
    const { yaw, isMoving, isOnGround, velocityY, jumping, actionRequest } = playerState;
    // Third person model visibility:
    // - Third person: layer 0 (main camera) + layer 1 (mirror)
    // - First person: layer 1 only (mirror reflection, not main camera)
    // Must apply to all children, not just the root model.
    model.traverse((child: THREE.Object3D) => {
      if (thirdPerson) {
        child.layers.enable(0);
        child.layers.enable(1);
      } else {
        child.layers.disable(0);
        child.layers.enable(1);
      }
    });
    model.position.set(playerBodyPos.x, playerBodyPos.y - playerRadius + modelOffsetY, playerBodyPos.z);

    let diff = yaw + MODEL_ROT_OFFSET - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    model.rotation.y += diff * Math.min(1, 10 * dt);

    // Grounded input always takes priority over airborne animation state.
    // One-shot completion is driven by the mixer, never by wall-clock timers.
    let actionPlaying = false
    const name = currentAction.getClip().name;
    actionPlaying = ACTION_CLIPS.has(name) && !currentAction.paused;
    if (actionRequest && !actionPlaying) {
      fadeTo(actionRequest);
    } else if (isOnGround) {
      // One-shot action requests (keys 6-9) play once, then locomotion resumes.
      // While one plays, idle/walk/land transitions wait for mixer completion.
      if (!actionPlaying) {
        if (isMoving) {
          fadeTo('Walk_Loop');
        } else if (wasOnGround === false) {
          fadeTo('Jump_Land');
        } else if (name !== 'Jump_Land' || currentAction.paused) {
          fadeTo('Idle_Loop');
        }
      }
    } else if (!actionPlaying) {
      if (wasOnGround === true && jumping) {
        fadeTo('Jump_Start');
      } else if (name !== 'Jump_Start' || currentAction.paused || velocityY <= 0) {
        fadeTo('Jump_Loop');
      }
    }
    wasOnGround = isOnGround;

    if (heldItems) {
      if (actionPlaying) {
        const clip = currentAction.getClip();
        const progress = THREE.MathUtils.clamp(currentAction.time / clip.duration, 0, 1);
        heldItems.updateSwing(name, progress);
      } else {
        heldItems.updateSwing(null, null);
      }
    }
    mixer.update(dt);
  }

  function setFacing(yaw: number) {
    // Doorway coordinate changes are instantaneous, not an in-world turn.
    model.rotation.y = yaw + MODEL_ROT_OFFSET;
  }

  function dispose() {
    heldItems?.dispose();
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    model.removeFromParent();
  }

  function getAttackProgress(): number | null {
    if (currentAction.getClip().name !== 'Sword_Attack' || currentAction.paused) return null;
    return THREE.MathUtils.clamp(currentAction.time / currentAction.getClip().duration, 0, 1);
  }

  return { model, mixer, update, setFacing, dispose, heldItems, getAttackProgress };
}
