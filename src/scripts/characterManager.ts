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
import { createCrowbar } from './items/createCrowbar.js';
import { LADDER } from '../utils/constants.js';
import { createGoggles } from './rewardChest.js';

import type { PlayerState } from './player.js';

interface Vec3Like { x: number; y: number; z: number; }

export interface CinematicPose {
  clip: 'Walk_Loop' | 'Float_Loop' | 'Ladder_Climb_Loop' | 'Crouch_Idle_Loop' | 'Interact' | 'Idle_Loop' | 'Sprint_Loop' | 'Pistol_Aim_Neutral' | 'Pistol_Shoot' | 'Sword_Idle' | 'Sword_Attack' | 'Roll' | 'Hit_Chest' | 'Death01' | 'Jump_Start' | 'Jump_Loop' | 'Jump_Land' | 'Sitting_Enter';
  time: number;
  duration?: number;
  loop?: boolean;
  upperBody?: { clip: 'Pistol_Aim_Neutral' | 'Pistol_Shoot' | 'Sword_Attack'; time: number; duration?: number; yaw?: number; pitch?: number };
  swimming?: boolean;
  lean?: number;
  bodyPitch?: number;
  handTargets?: { left: Vec3Like; right: Vec3Like; weight: number };
  footTargets?: { left: Vec3Like; right: Vec3Like; weight: number };
}

const CLIP_NAMES = [
  'Idle_Loop', 'Walk_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
  // One-shot action clips on number keys 6-9 (input mapping in player.ts).
  'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Dance_Loop', 'Interact',
  // Crouch animations
  'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
  'Ladder_Climb_Loop',
  'Float_Loop', 'Box_Push_Loop', 'Box_Pull_Loop',
] as const;
type ClipName = typeof CLIP_NAMES[number];

// One-shot action clips. They play once per key press, then the normal
// locomotion state machine resumes (idle or walk, mixer-driven completion).
const ACTION_CLIPS: ReadonlySet<string> = new Set([
  'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Dance_Loop', 'Interact',
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
  model.rotation.set(0, MODEL_ROT_OFFSET, 0, 'YXZ');

  // Layer 0 is the gameplay camera; layer 1 is the mirror camera.
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

  // Bake two-bone IK once at load time. The actual UAL leg names are thigh/calf.
  // Targets are model-local (+Z forward), independent of each bone's rest axes.
  const rig: Array<{ bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }> = [];
  model.traverse(node => {
    if ((node as THREE.Bone).isBone) rig.push({ bone: node as THREE.Bone, position: node.position.clone(), quaternion: node.quaternion.clone() });
  });
  function resetRig() {
    for (const { bone, position, quaternion } of rig) { bone.position.copy(position); bone.quaternion.copy(quaternion); }
    model.updateMatrixWorld(true);
  }
  function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const desired = target.clone().sub(origin).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(current, desired)
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    model.updateMatrixWorld(true);
  }
  function solveLimb(upperName: string, lowerName: string, tipName: string, target: THREE.Vector3, pole: THREE.Vector3) {
    const upper = model.getObjectByName(upperName), lower = model.getObjectByName(lowerName), tip = model.getObjectByName(tipName);
    if (!upper || !lower || !tip) throw new Error(`Traversal animation requires ${upperName}/${lowerName}/${tipName}`);
    const origin = upper.getWorldPosition(new THREE.Vector3());
    const joint = lower.getWorldPosition(new THREE.Vector3());
    const end = tip.getWorldPosition(new THREE.Vector3());
    const endRotation = tip.getWorldQuaternion(new THREE.Quaternion());
    const a = origin.distanceTo(joint), b = joint.distanceTo(end);
    const direction = target.clone().sub(origin);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    direction.normalize();
    const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const knee = origin.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    aimBone(upper, lower, knee);
    aimBone(lower, tip, origin.clone().addScaledVector(direction, distance));
    // Keep boots level while knees flex; hands retain their grip orientation.
    tip.quaternion.copy(tip.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(endRotation));
    model.updateMatrixWorld(true);
  }
  function orientHand(suffix: string, climbing: boolean, curl = climbing) {
    const hand = model.getObjectByName(`hand_${suffix}`)!;
    const middle = model.getObjectByName(`middle_01_${suffix}`)!;
    const index = model.getObjectByName(`index_01_${suffix}`)!;
    const pinky = model.getObjectByName(`pinky_01_${suffix}`)!;
    const rest = rig.find(entry => entry.bone === hand)!;
    const finger = middle.position.clone().normalize();
    const palm = index.position.clone().sub(pinky.position).cross(finger).normalize();
    // UAL's mirrored rest palms face down. Build a hand-local anatomical frame
    // instead of retaining the T-pose's world rotation after solving the elbows.
    const restWorld = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(rest.quaternion);
    const savedPalm = hand.userData.restPalm as THREE.Vector3 | undefined;
    if (savedPalm) palm.copy(savedPalm);
    else {
      if (palm.clone().applyQuaternion(restWorld).y > 0) palm.negate();
      hand.userData.restPalm = palm.clone();
    }
    const side = suffix === 'l' ? 1 : -1;
    const fingersToward = climbing ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(side * 0.2, 0.1, 1).normalize();
    const palmToward = climbing ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
    const basis = (y: THREE.Vector3, z: THREE.Vector3) => {
      const x = new THREE.Vector3().crossVectors(y, z).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
    };
    const rotation = basis(fingersToward, palmToward).multiply(basis(finger, palm).invert());
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    model.updateMatrixWorld(true);
    // Curl the distal joints around the rung; float with relaxed, open fingers.
    if (curl) for (const digit of ['index', 'middle', 'ring', 'pinky']) {
      for (const segment of ['02', '03']) {
        const joint = model.getObjectByName(`${digit}_${segment}_${suffix}`);
        if (!joint) continue;
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert());
        joint.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, 0.85));
      }
    }
  }
  // Calibrate the mirrored palm normals from the untouched neutral pose.
  const calibrationFacing = model.quaternion.clone(); model.quaternion.identity(); resetRig();
  orientHand('l', false); orientHand('r', false); resetRig(); model.quaternion.copy(calibrationFacing);

  function bakeTraversal(name: string, duration: number, climbing: boolean, handling = 0) {
    const facing = model.quaternion.clone();
    model.quaternion.identity();
    const times = Array.from({ length: 49 }, (_, i) => i * duration / 48);
    const rotations = rig.map(() => [] as number[]);
    const positions = rig.map(() => [] as number[]);
    for (let frame = 0; frame < times.length; frame++) {
      resetRig();
      const phase = frame / 48;
      for (const side of [1, -1]) {
        const suffix = side === 1 ? 'l' : 'r';
        const cycle = (phase + (side === 1 ? 0 : 0.5)) % 1;
        // Planted for half a cycle, then lifted to the next rung in a smooth arc.
        const planted = cycle < 0.5;
        const recovery = (cycle - 0.5) * 2;
        const reach = planted ? 1 - cycle * 2 : THREE.MathUtils.smoothstep(recovery, 0, 1);
        const lift = planted ? 0 : Math.sin(recovery * Math.PI);
        const drift = Math.sin(cycle * Math.PI * 2);
        const handTarget = handling
          ? new THREE.Vector3(side * 0.28, 1.12, 0.54)
          : climbing ? new THREE.Vector3(side * 0.26, 1.25 + LADDER.rungSpacing * reach, LADDER.bodyOffset - lift * 0.1)
          : new THREE.Vector3(side * (0.32 + drift * 0.03), 1.16 + drift * 0.06, 0.24);
        const footTarget = handling
          ? new THREE.Vector3(side * 0.15, 0.025 + Math.max(0, drift) * 0.10, Math.cos(cycle * Math.PI * 2) * 0.19 * handling)
          : climbing ? new THREE.Vector3(side * 0.16, 0.08 + LADDER.rungSpacing * (1 - reach), LADDER.bodyOffset - 0.13 - lift * 0.09)
          : new THREE.Vector3(side * 0.16, 0.14 + drift * 0.05, 0.08 + drift * 0.04);
        solveLimb(`upperarm_${suffix}`, `lowerarm_${suffix}`, `hand_${suffix}`, handTarget, new THREE.Vector3(side, -0.2, -0.1));
        solveLimb(`thigh_${suffix}`, `calf_${suffix}`, `foot_${suffix}`, footTarget, new THREE.Vector3(side * 0.15, 0, 1));
        orientHand(suffix, climbing || handling !== 0, climbing || handling < 0);
      }
      rig.forEach(({ bone }, i) => { rotations[i].push(...bone.quaternion.toArray()); positions[i].push(...bone.position.toArray()); });
    }
    resetRig();
    model.quaternion.copy(facing);
    model.updateMatrixWorld(true);
    // Full-pose tracks prevent stale walk/aim tracks leaking into traversal.
    return new THREE.AnimationClip(name, duration, rig.flatMap(({ bone }, i) => [
      new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations[i]),
      new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions[i]),
    ]));
  }
  clips.push(bakeTraversal('Ladder_Climb_Loop', LADDER.cycleDuration, true));
  clips.push(bakeTraversal('Float_Loop', 2.4, false));
  clips.push(bakeTraversal('Box_Push_Loop', 0.95, false, 1));
  clips.push(bakeTraversal('Box_Pull_Loop', 1.05, false, -1));
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

  const rightHand = model.getObjectByName('hand_r');
  const crowbar = createCrowbar();
  crowbar.position.set(0, 0, 0);
  crowbar.rotation.set(Math.PI / 2, 0, 0);
  crowbar.visible = false;
  let crowbarEquipped = false;
  rightHand?.add(crowbar);

  const goggles = createGoggles();
  goggles.visible = false;
  const head = model.getObjectByName('head');
  if (head) {
    model.updateMatrixWorld(true);
    const headPosition = model.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
    const eyePosition = new THREE.Vector3(0, headPosition.y + 0.09, headPosition.z + 0.12);
    goggles.position.copy(head.worldToLocal(model.localToWorld(eyePosition)));
    goggles.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(model.getWorldQuaternion(new THREE.Quaternion())));
    head.add(goggles);
  }

  const cinematicUpperActions = new Map<string, THREE.AnimationAction>();
  let cinematicUpper: THREE.AnimationAction | null = null;
  const cinematicActions = new Map<string, THREE.AnimationAction>();
  let cinematicAction: THREE.AnimationAction | null = null;
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
    next.reset().setEffectiveTimeScale(name === 'Sword_Attack' ? 2.8 : 1).setEffectiveWeight(1).fadeIn(0.2).play();
    currentAction = next;
  }

  const armChains = ['l', 'r'].map(suffix => ({
    hand: model.getObjectByName(`hand_${suffix}`),
    joints: [model.getObjectByName(`lowerarm_${suffix}`), model.getObjectByName(`upperarm_${suffix}`)],
  }));
  const legChains = ['l', 'r'].map(suffix => ({
    hand: model.getObjectByName(`foot_${suffix}`),
    joints: [model.getObjectByName(`calf_${suffix}`), model.getObjectByName(`thigh_${suffix}`)],
  }));
  const swimmingLegs = ['thigh_l', 'thigh_r', 'calf_l', 'calf_r'].flatMap(name => {
    const bone = model.getObjectByName(name);
    return bone ? [{ bone, quaternion: bone.quaternion.clone() }] : [];
  });
  const gripPosition = new THREE.Vector3(), jointPosition = new THREE.Vector3(), handDirection = new THREE.Vector3(), targetDirection = new THREE.Vector3();
  const parentRotation = new THREE.Quaternion(), worldRotation = new THREE.Quaternion(), adjustment = new THREE.Quaternion();
  function applyHandTargets(targets: NonNullable<CinematicPose['handTargets']>, chains = armChains) {
    const weight = THREE.MathUtils.clamp(targets.weight, 0, 1);
    model.updateMatrixWorld(true);
    chains.forEach((chain, index) => {
      if (!chain.hand) return;
      gripPosition.copy(index === 0 ? targets.left : targets.right);
      // A short CCD solve keeps each authored arm on its scene-owned handhold.
      for (let iteration = 0; iteration < 4; iteration++) for (const joint of chain.joints) {
        if (!joint?.parent) continue;
        joint.getWorldPosition(jointPosition);
        handDirection.copy(chain.hand.getWorldPosition(handDirection)).sub(jointPosition).normalize();
        targetDirection.copy(gripPosition).sub(jointPosition).normalize();
        adjustment.setFromUnitVectors(handDirection, targetDirection);
        joint.getWorldQuaternion(worldRotation); joint.parent.getWorldQuaternion(parentRotation).invert();
        worldRotation.premultiply(adjustment).premultiply(parentRotation);
        joint.quaternion.slerp(worldRotation, weight); joint.updateWorldMatrix(false, true);
      }
    });
  }

  // ---- Per-frame update ----

  function update(
    dt: number,
    playerBodyPos: Vec3Like,
    playerState: PlayerState,
    thirdPerson: boolean,
    playerRadius: number,
    cinematic?: CinematicPose | null,
  ) {
    const { yaw, pitch, isMoving, isOnGround, velocityY, jumping, actionRequest, crouching, sprinting, climbing, climbDirection, floating, floatTime, boxHandling, boxMotion } = playerState;
    model.traverse((child: THREE.Object3D) => {
      if (thirdPerson) {
        child.layers.enable(0);
      } else {
        child.layers.disable(0);
      }
      child.layers.enable(1);
    });
    model.visible = true;
    model.position.set(playerBodyPos.x, playerBodyPos.y - playerRadius + modelOffsetY, playerBodyPos.z);

    let diff = yaw + MODEL_ROT_OFFSET - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    model.rotation.y += diff * Math.min(1, 10 * dt);
    const weightless = floating && !climbing;
    model.rotation.x = THREE.MathUtils.damp(model.rotation.x, weightless ? 0.08 : 0, 8, dt);
    model.rotation.z = THREE.MathUtils.damp(model.rotation.z, weightless ? Math.sin((floatTime ?? 0) * 1.2) * 0.035 : 0, 8, dt);

    // Grounded input always takes priority over airborne animation state.
    // One-shot completion is driven by the mixer, never by wall-clock timers.
    if (!cinematic && cinematicAction) {
      mixer.stopAllAction(); cinematicAction = null;
      currentAction = actions.get('Idle_Loop')!;
      currentAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      wasOnGround = null;
    }
    const name = currentAction.getClip().name;
    if (cinematic) {
      let next = cinematicActions.get(cinematic.clip);
      if (!next) {
        const clip = THREE.AnimationClip.findByName(clips, cinematic.clip) ?? actions.get('Idle_Loop')!.getClip();
        // Separate actions preserve gameplay looping/time-scale settings on the shared rig.
        next = mixer.clipAction(clip.clone()); cinematicActions.set(cinematic.clip, next);
      }
      if (next !== cinematicAction) {
        if (cinematicAction) cinematicAction.fadeOut(0.1);
        else mixer.stopAllAction();
        next.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).fadeIn(0.1).play();
        cinematicAction = next;
      }
      const duration = next.getClip().duration;
      const time = Math.max(0, cinematic.time) * (cinematic.duration ? duration / cinematic.duration : 1);
      next.paused = true;
      next.time = cinematic.loop ? time % duration : Math.min(time, duration);
    } else if (climbing) {
      fadeTo('Ladder_Climb_Loop');
      currentAction.setEffectiveTimeScale(climbDirection ?? 1);
    } else if (floating) {
      fadeTo('Float_Loop');
      currentAction.setEffectiveTimeScale(isMoving ? 1.3 : 0.8);
    } else if (boxHandling) {
      fadeTo(boxMotion < -0.07 ? 'Box_Pull_Loop' : 'Box_Push_Loop');
      currentAction.setEffectiveTimeScale(Math.abs(boxMotion) < 0.07 ? 0 : Math.min(1.5, Math.abs(boxMotion) / 1.1));
    } else if (isOnGround) {
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
        } else if (name === 'Ladder_Climb_Loop') {
          fadeTo('Idle_Loop');
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
    for (const base of swimmingLegs) base.bone.quaternion.copy(base.quaternion);
    mixer.update(dt);
    for (const base of swimmingLegs) base.quaternion.copy(base.bone.quaternion);
    for (const base of layerBones) {
      base.position.copy(base.bone.position);
      base.quaternion.copy(base.bone.quaternion);
      base.scale.copy(base.bone.scale);
    }
    // The second mixer owns only spine/arms/head; hips and legs retain locomotion.
    const handsFree = !climbing && !playerState.ventMode && !boxHandling;
    socket.visible = handsFree;
    crowbar.visible = crowbarEquipped && handsFree;
    if (cinematic?.upperBody && handsFree) {
      const layer = cinematic.upperBody;
      let next = cinematicUpperActions.get(layer.clip);
      if (!next) {
        const source = THREE.AnimationClip.findByName(clips, layer.clip);
        if (source) { next = upperMixer.clipAction(upperClip(source).clone()); cinematicUpperActions.set(layer.clip, next); }
      }
      if (next) {
        if (next !== cinematicUpper) { upperMixer.stopAllAction(); next.reset().play(); cinematicUpper = next; }
        next.paused = true;
        next.time = Math.min(next.getClip().duration, Math.max(0, layer.time) * (layer.duration ? next.getClip().duration / layer.duration : 1));
        upperMixer.update(0);
        for (const { bone, pose } of layerBones) {
          bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
        }
        if (upperRoot) {
          upperRoot.rotateY(THREE.MathUtils.clamp(layer.yaw ?? 0, -1.2, 1.2));
          upperRoot.rotateX(-(layer.pitch ?? 0));
        }
      }
    } else if (cinematicUpper) {
      upperMixer.stopAllAction(); cinematicUpper = null;
      if (armed) holdAction?.reset().play();
    }
    if (cinematic?.swimming) {
      const cycle = cinematic.time * 3.8;
      for (const suffix of ['l', 'r']) {
        const sign = suffix === 'l' ? 1 : -1;
        const thigh = model.getObjectByName(`thigh_${suffix}`);
        const calf = model.getObjectByName(`calf_${suffix}`);
        thigh?.rotateX(Math.sin(cycle + sign * Math.PI / 2) * 0.3);
        calf?.rotateX(0.35 + Math.sin(cycle + sign * Math.PI / 2) * 0.2);
        if (!cinematic.upperBody) {
          model.getObjectByName(`upperarm_${suffix}`)?.rotateX(Math.sin(cycle) * 0.28);
          model.getObjectByName(`lowerarm_${suffix}`)?.rotateY(sign * (0.3 + Math.cos(cycle) * 0.25));
        }
      }
      model.rotation.x = 0.14;
      model.rotation.z = cinematic.lean ?? 0;
    }
    if (cinematic?.bodyPitch !== undefined) model.rotation.x = cinematic.bodyPitch;
    if (cinematic?.handTargets) applyHandTargets(cinematic.handTargets);
    if (cinematic?.footTargets) applyHandTargets(cinematic.footTargets, legChains);
    if (armed && handsFree && !cinematic) {
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
    model.rotation.set(0, yaw + MODEL_ROT_OFFSET, 0, 'YXZ');
  }

  function dispose() {
    crowbar.removeFromParent();
    goggles.removeFromParent();
    const gogglesMaterials = new Set<THREE.Material>();
    goggles.traverse(node => {
      if (node instanceof THREE.Mesh) { node.geometry.dispose(); (Array.isArray(node.material) ? node.material : [node.material]).forEach(mat => gogglesMaterials.add(mat)); }
    });
    gogglesMaterials.forEach(mat => mat.dispose());
    upperMixer.stopAllAction();
    upperMixer.uncacheRoot(upperPose);
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    model.removeFromParent();
  }

  return {
    model, mixer, update, setFacing, weapon, crowbar,
    setCrowbarEquipped: (equipped: boolean) => { crowbarEquipped = equipped; crowbar.visible = equipped; },
    setGogglesEquipped: (equipped: boolean) => { goggles.visible = equipped; },
    dispose,
  };
}
