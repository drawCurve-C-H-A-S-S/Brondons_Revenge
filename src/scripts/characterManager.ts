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

import type { PlayerState } from './player.js';

interface Vec3Like { x: number; y: number; z: number; }

const CLIP_NAMES = [
  'Idle_Loop', 'Walk_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
  // One-shot action clips on number keys 6-9 (input mapping in player.ts).
  'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Dance_Loop',
  // Crouch animations
  'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
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

  // Layer 0: third-person camera and mirror both render the character.
  model.traverse((child: THREE.Object3D) => {
    child.layers.set(0);
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

  function fadeTo(name: ClipName) {
    const next = actions.get(name)!;
    if (next === currentAction) return;
    currentAction.fadeOut(0.2);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.2).play();
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
    const { yaw, isMoving, isOnGround, velocityY, jumping, actionRequest, crouching, sprinting } = playerState;
    model.visible = thirdPerson;
    model.position.set(playerBodyPos.x, playerBodyPos.y - playerRadius + modelOffsetY, playerBodyPos.z);

    let diff = yaw + MODEL_ROT_OFFSET - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    model.rotation.y += diff * Math.min(1, 10 * dt);

    // Grounded input always takes priority over airborne animation state.
    // One-shot completion is driven by the mixer, never by wall-clock timers.
    const name = currentAction.getClip().name;
    if (isOnGround) {
      // One-shot action requests (keys 6-9) play once, then locomotion resumes.
      // While one plays, idle/walk/land transitions wait for mixer completion.
      const actionPlaying = ACTION_CLIPS.has(name) && !currentAction.paused;
      if (actionRequest) {
        fadeTo(actionRequest);
      } else if (!actionPlaying) {
        // Crouch animations take priority when crouching
        if (crouching) {
          if (isMoving) {
            fadeTo('Crouch_Fwd_Loop');
          } else {
            fadeTo('Crouch_Idle_Loop');
          }
        } else if (sprinting && isMoving) {
          fadeTo('Sprint_Loop');
        } else if (isMoving) {
          fadeTo('Walk_Loop');
        } else if (wasOnGround === false) {
          fadeTo('Jump_Land');
        } else if (name !== 'Jump_Land' || currentAction.paused) {
          fadeTo('Idle_Loop');
        }
      }
    } else if (wasOnGround === true && jumping) {
      fadeTo('Jump_Start');
    } else if (name !== 'Jump_Start' || currentAction.paused || velocityY <= 0) {
      fadeTo('Jump_Loop');
    }
    wasOnGround = isOnGround;
    mixer.update(dt);
  }

  function setFacing(yaw: number) {
    // Doorway coordinate changes are instantaneous, not an in-world turn.
    model.rotation.y = yaw + MODEL_ROT_OFFSET;
  }

  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    model.removeFromParent();
  }

  return { model, mixer, update, setFacing, dispose };
}
