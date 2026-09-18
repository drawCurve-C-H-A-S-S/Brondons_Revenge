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

  // Sample the authored aiming pose once to calibrate the hand-local grip.
  const hand = model.getObjectByName('hand_r');
  const middleFinger = model.getObjectByName('middle_01_r');
  const upperRoot = model.getObjectByName('spine_01');
  const aimClip = THREE.AnimationClip.findByName(clips, 'Pistol_Aim_Neutral');
  const holdClip = THREE.AnimationClip.findByName(clips, 'Pistol_Idle_Loop');
  const shootClip = THREE.AnimationClip.findByName(clips, 'Pistol_Shoot');
  const socket = new THREE.Group();
  socket.name = 'PistolGrip';
  const upperBones = new Set<string>();
  upperRoot?.traverse(node => { if ((node as THREE.Bone).isBone) upperBones.add(node.name); });
  const upperPose = upperRoot?.clone(true) ?? new THREE.Group();
  const upperMixer = new THREE.AnimationMixer(upperPose);
  const layerBones = [...upperBones].map(name => {
    const bone = model.getObjectByName(name)!;
    return { bone, pose: upperPose.getObjectByName(name)!,
      position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() };
  });
  const upperClip = (clip: THREE.AnimationClip) => new THREE.AnimationClip(`${clip.name}_UpperBody`, clip.duration,
    clip.tracks.filter(track => upperBones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)).map(track => track.clone()));
  const holdAction = holdClip ? upperMixer.clipAction(upperClip(holdClip)) : null;
  const shootAction = shootClip ? upperMixer.clipAction(upperClip(shootClip)) : null;
  shootAction?.setLoop(THREE.LoopOnce, 1);
  if (shootAction) shootAction.clampWhenFinished = true;
  if (hand && aimClip) {
    const sampler = new THREE.AnimationMixer(model);
    sampler.clipAction(aimClip).play();
    sampler.update(0);
    model.updateMatrixWorld(true);
    const palm = hand.getWorldPosition(new THREE.Vector3());
    if (middleFinger) palm.lerp(middleFinger.getWorldPosition(new THREE.Vector3()), 0.65);
    socket.position.copy(hand.worldToLocal(palm));
    const forward = model.getWorldQuaternion(new THREE.Quaternion())
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    socket.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(forward));
    hand.add(socket);
    sampler.stopAllAction();
    sampler.uncacheRoot(model);
  }
  let armed = false;
  const weapon = {
    socket: hand ? socket : null,
    setEquipped(equipped: boolean) {
      if (equipped === armed) return;
      armed = equipped;
      upperMixer.stopAllAction();
      if (armed) holdAction?.reset().play();
    },
    shoot() {
      if (!armed || !shootAction) return;
      holdAction?.stop();
      shootAction.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    },
  };

  let currentAction = actions.get('Idle_Loop')!;
  currentAction.play();
  mixer.update(0);
  for (const base of layerBones) {
    base.position.copy(base.bone.position);
    base.quaternion.copy(base.bone.quaternion);
    base.scale.copy(base.bone.scale);
  }

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
    const { yaw, pitch, isMoving, isOnGround, velocityY, jumping, actionRequest, crouching, sprinting } = playerState;
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
    // Restore last frame's base pose before the mixer applies its cached bindings.
    for (const base of layerBones) {
      base.bone.position.copy(base.position);
      base.bone.quaternion.copy(base.quaternion);
      base.bone.scale.copy(base.scale);
    }
    mixer.update(dt);
    for (const base of layerBones) {
      base.position.copy(base.bone.position);
      base.quaternion.copy(base.bone.quaternion);
      base.scale.copy(base.bone.scale);
    }
    // The second mixer owns only spine/arms/head; hips and legs retain locomotion.
    if (armed) {
      upperMixer.update(dt);
      if (shootAction?.paused) {
        shootAction.stop();
        holdAction?.reset().play();
        upperMixer.update(0);
      }
      for (const { bone, pose } of layerBones) {
        bone.position.copy(pose.position);
        bone.quaternion.copy(pose.quaternion);
        bone.scale.copy(pose.scale);
      }
      // Tilt the whole upper body/gun with the camera's up-down look so the
      // aim pose actually points where the crosshair is, not just forward.
      if (upperRoot) {
        const aimPitch = Math.max(-1.1, Math.min(1.1, pitch));
        upperRoot.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -aimPitch));
      }
    }
  }

  function setFacing(yaw: number) {
    // Doorway coordinate changes are instantaneous, not an in-world turn.
    model.rotation.y = yaw + MODEL_ROT_OFFSET;
  }

  function dispose() {
    upperMixer.stopAllAction();
    upperMixer.uncacheRoot(upperPose);
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    model.removeFromParent();
  }

  return { model, mixer, update, setFacing, weapon, dispose };
}
