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
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadPlayerModel, yieldToMainThread } from '../core/loader.js';
import { createCrowbar } from './items/createCrowbar.js';
import { createLightsaber, disposeLightsaber, fitLightsaberToHand, fitWeaponToHand, getLightsaberAttackClips, LIGHTSABER_SWING_DURATION, type LightsaberAttackName } from './items/createLightsaber.js';
import { LADDER } from '../utils/constants.js';
import { createGoggles } from './rewardChest.js';
import { SLIDE_TACKLE, slideTackleMotion } from '../helpers/animation/slideTackle.js';

import type { PlayerState } from './player.js';

interface Vec3Like { x: number; y: number; z: number; }

export const HOLOGRAM_TRANSFER_DURATION = 1.95;
export const TELEPORT_TRANSFER_DURATION = 0.18;

interface HologramTransition { blend: number; opacity: number; time: number; }

export function hologramTransitionAt(time: number, arriving = false, duration = HOLOGRAM_TRANSFER_DURATION): HologramTransition {
  const span = Number.isFinite(duration) && duration > 0 ? duration : HOLOGRAM_TRANSFER_DURATION;
  const elapsed = Number.isFinite(time) ? THREE.MathUtils.clamp(time / span, 0, 1) : 0;
  const phase = (arriving ? 1 - elapsed : elapsed) * HOLOGRAM_TRANSFER_DURATION;
  return {
    blend: THREE.MathUtils.smoothstep(phase, 0, 0.55),
    opacity: 1 - THREE.MathUtils.smoothstep(phase, 0.75, 1.65),
    time,
  };
}

export interface CinematicPose {
  clip: 'Walk_Loop' | 'Float_Loop' | 'Ladder_Climb_Loop' | 'Crouch_Idle_Loop' | 'Interact' | 'Idle_Loop' | 'Sprint_Loop' | 'Slide_Tackle' | 'Pistol_Aim_Neutral' | 'Pistol_Shoot' | 'Sword_Idle' | 'Sword_Attack' | 'Roll' | 'Hit_Chest' | 'Death01' | 'Jump_Start' | 'Jump_Loop' | 'Jump_Land' | 'Sitting_Enter';
  time: number;
  duration?: number;
  loop?: boolean;
  upperBody?: { clip: 'Pistol_Aim_Neutral' | 'Pistol_Shoot' | 'Sword_Attack'; time: number; duration?: number; yaw?: number; pitch?: number };
  swimming?: boolean;
  lean?: number;
  bodyPitch?: number;
  spinAttack?: number;
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
  'Slide_Tackle',
] as const;
type ClipName = typeof CLIP_NAMES[number] | LightsaberAttackName;

// One-shot action clips. They play once per key press, then the normal
// locomotion state machine resumes (idle or walk, mixer-driven completion).
const ACTION_CLIPS: ReadonlySet<string> = new Set([
  'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Dance_Loop', 'Interact',
]);
const ONE_SHOT_CLIPS = ['Jump_Start', 'Jump_Land', 'Slide_Tackle', ...ACTION_CLIPS];

// Rotation offset: the UAL model's local forward is +Z, but the camera
// looks toward -Z at yaw 0.  Adding PI keeps the model facing the same
// direction the camera is looking.
const MODEL_ROT_OFFSET = Math.PI;

/**
 * Pose the UAL1 rig in a motionless "lay flat" configuration: hips neutral,
 * spine untouched, legs straight (as per the T-rest), and both arms IK'd down
 * so the hands rest alongside the hips. Call once on a freshly loaded gltf
 * before setting the model's world rotation / position - the pose stays as
 * long as no AnimationMixer is ticked on this model afterward.
 */
export function applyLayFlatPose(gltf: { scene: THREE.Object3D }): void {
  const model = gltf.scene;

  // Normalise facing/position so our world-space IK targets are expressed in
  // model-local coordinates. We restore both at the end.
  const savedQuat = model.quaternion.clone();
  const savedPos = model.position.clone();
  model.quaternion.identity();
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const desired = target.clone().sub(origin).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(current, desired)
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(
      bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rot),
    );
    model.updateMatrixWorld(true);
  }

  function solveLimb(
    upperName: string, lowerName: string, tipName: string,
    target: THREE.Vector3, pole: THREE.Vector3,
  ): void {
    const upper = model.getObjectByName(upperName);
    const lower = model.getObjectByName(lowerName);
    const tip = model.getObjectByName(tipName);
    if (!upper || !lower || !tip) return;
    const origin = upper.getWorldPosition(new THREE.Vector3());
    const joint = lower.getWorldPosition(new THREE.Vector3());
    const end = tip.getWorldPosition(new THREE.Vector3());
    const a = origin.distanceTo(joint);
    const b = joint.distanceTo(end);
    const direction = target.clone().sub(origin);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    direction.normalize();
    const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const knee = origin.clone()
      .addScaledVector(direction, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    aimBone(upper, lower, knee);
    aimBone(lower, tip, origin.clone().addScaledVector(direction, distance));
  }

  // Shoulder-relative hand targets: hang down ~62cm, tucked a hair toward the
  // body centreline so the arms don't flare out from the ribs.
  for (const suffix of ['l', 'r'] as const) {
    const upper = model.getObjectByName(`upperarm_${suffix}`);
    if (!upper) continue;
    const side = suffix === 'l' ? 1 : -1;
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(
      shoulder.x - side * 0.03,
      shoulder.y - 0.62,
      shoulder.z + 0.04,
    );
    const pole = new THREE.Vector3(side * 0.8, -0.2, -1).normalize();
    solveLimb(`upperarm_${suffix}`, `lowerarm_${suffix}`, `hand_${suffix}`, target, pole);
  }

  // Legs are already straight in the UAL rest pose; nothing to do there.

  model.quaternion.copy(savedQuat);
  model.position.copy(savedPos);
  model.updateMatrixWorld(true);
}

export function createPrologueGetUpClip(gltf: { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] }): THREE.AnimationClip {
  const model = gltf.scene;
  const rig: Array<{ bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }> = [];
  model.traverse(node => {
    if (node instanceof THREE.Bone) rig.push({ bone: node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
  });
  const restore = () => {
    for (const entry of rig) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.quaternion);
      entry.bone.scale.copy(entry.scale);
    }
    model.updateMatrixWorld(true);
  };
  const capture = () => rig.map(({ bone }) => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
  const sampler = new THREE.AnimationMixer(model);
  const sample = (name: string, time: number) => {
    sampler.stopAllAction();
    restore();
    const clip = gltf.animations.find(animation => animation.name === name)
      ?? gltf.animations.find(animation => animation.name === 'Idle_Loop');
    if (clip) {
      sampler.clipAction(clip).reset().play();
      sampler.setTime(Math.min(time, clip.duration));
    }
    const pose = capture();
    sampler.stopAllAction();
    return pose;
  };
  const poses = [capture(), sample('Fixing_Kneeling', 0.65), sample('Crouch_Idle_Loop', 0.3), sample('Idle_Loop', 0.5)];
  sampler.uncacheRoot(model);
  restore();
  const times = [0, 0.9, 2.05, 3.3];
  return new THREE.AnimationClip('Prologue_GetUp', 3.3, rig.flatMap(({ bone }, boneIndex) => [
    new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, poses.flatMap(pose => pose[boneIndex].quaternion.toArray())),
    new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, poses.flatMap(pose => pose[boneIndex].position.toArray())),
    new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, poses.flatMap(pose => pose[boneIndex].scale.toArray())),
  ]));
}

export { createMechAnimator, type MechBoneMap, type MechPoseName } from './mechAnimation.js';

export async function loadCharacter(loader?: GLTFLoader) {

  let gltf;
  try {
    gltf = await loadPlayerModel(loader);
    console.log('MC character loaded');
  } catch (error) {
    console.error('Failed to load MC character model:', error);
    return null;
  }

  const model = gltf.scene;
  model.scale.set(1, 1, 1);
  const modelOffsetY = -new THREE.Box3().setFromObject(model).min.y;
  const ventFeet = ['foot_l', 'foot_r'].map(name => model.getObjectByName(name)).filter((bone): bone is THREE.Object3D => !!bone);
  const ventFootPosition = new THREE.Vector3();
  const ventSoleOffset = ventFeet.length
    ? Math.min(...ventFeet.map(bone => bone.getWorldPosition(ventFootPosition).y)) + modelOffsetY : 0;
  let wasOnGround: boolean | null = null;
  model.rotation.set(0, MODEL_ROT_OFFSET, 0, 'YXZ');

  const transitionMeshes: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
  const animatedBones = new Set<THREE.Object3D>();
  const hologramMaterials = new Map<THREE.Material, THREE.Material>();
  const hologramUniforms = {
    hologramTime: { value: 0 },
    hologramBlend: { value: 0 },
    hologramOpacity: { value: 1 },
  };
  let hologramActive = false;

  // Layer 0 is the gameplay camera; layer 1 is the mirror camera.
  model.traverse((child: THREE.Object3D) => {
    child.layers.enable(0);
    child.layers.enable(1);
    if (child instanceof THREE.SkinnedMesh) for (const joint of child.skeleton.bones) {
      for (let bone: THREE.Object3D | null = joint; bone; bone = bone.parent) {
        if (bone instanceof THREE.Bone) animatedBones.add(bone);
      }
    }
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      transitionMeshes.push({ mesh, material: mesh.material });
      (child as THREE.Mesh).castShadow = true;
      (child as THREE.Mesh).receiveShadow = true;
    }
  });

  // ---- Animation setup ----
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations || [];

  // Bake two-bone IK once at load time. The actual UAL leg names are thigh/calf.
  // Targets are model-local (+Z forward), independent of each bone's rest axes.
  const rig: Array<{ bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }> = [];
  model.traverse(node => {
    if (node instanceof THREE.Bone && animatedBones.has(node)) rig.push({ bone: node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
  });
  function resetRig() {
    for (const { bone, position, quaternion, scale } of rig) { bone.position.copy(position); bone.quaternion.copy(quaternion); bone.scale.copy(scale); }
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

  async function bakeRigClip(name: string, duration: number, frames: number, pose: (time: number) => void) {
    const facing = model.quaternion.clone();
    model.quaternion.identity();
    const times = Array.from({ length: frames }, (_, i) => i * duration / (frames - 1));
    const rotations = rig.map(() => [] as number[]);
    const positions = rig.map(() => [] as number[]);
    const scales = rig.map(() => [] as number[]);
    try {
      for (let frame = 0; frame < times.length; frame++) {
        if (frame > 0 && frame % 2 === 0) await yieldToMainThread();
        resetRig(); pose(times[frame]);
        rig.forEach(({ bone }, i) => {
          rotations[i].push(...bone.quaternion.toArray()); positions[i].push(...bone.position.toArray()); scales[i].push(...bone.scale.toArray());
        });
      }
    } finally {
      resetRig(); model.quaternion.copy(facing); model.updateMatrixWorld(true);
    }
    return new THREE.AnimationClip(name, duration, rig.flatMap(({ bone }, i) => [
      new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations[i]),
      new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, positions[i]),
      new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scales[i]),
    ]));
  }
  async function bakeTraversal(name: string, duration: number, climbing: boolean, handling = 0) {
    return bakeRigClip(name, duration, 49, time => {
      const phase = time / duration;
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
    });
  }
  clips.push(await bakeTraversal('Ladder_Climb_Loop', LADDER.cycleDuration, true));
  clips.push(await bakeTraversal('Float_Loop', 2.4, false));
  clips.push(await bakeTraversal('Box_Push_Loop', 0.95, false, 1));
  clips.push(await bakeTraversal('Box_Pull_Loop', 1.05, false, -1));

  const sprintClip = THREE.AnimationClip.findByName(clips, 'Sprint_Loop');
  if (!sprintClip) throw new Error('Slide tackle animation requires Sprint_Loop');
  const sampleMixer = new THREE.AnimationMixer(model);
  const sampleAction = sampleMixer.clipAction(sprintClip).play();
  const sampleSprint = (time: number) => {
    resetRig(); sampleAction.reset().play(); sampleMixer.setTime(time);
    return rig.map(({ bone }) => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
  };
  const entryPose = sampleSprint(sprintClip.duration * 0.2), exitPose = sampleSprint(sprintClip.duration * 0.7);
  sampleMixer.stopAllAction(); sampleMixer.uncacheRoot(model); resetRig();
  const facing = model.quaternion.clone(); model.quaternion.identity(); model.updateMatrixWorld(true);
  const requireBone = (name: string) => {
    const bone = rig.find(entry => entry.bone.name === name)?.bone;
    if (!bone?.parent) throw new Error(`Slide tackle animation requires ${name}`);
    return bone;
  };
  const pelvis = requireBone('pelvis'), spine = ['spine_01', 'spine_02', 'spine_03'].map(requireBone);
  const neck = requireBone('neck_01'), slideHead = requireBone('Head');
  const hipRest = pelvis.getWorldPosition(new THREE.Vector3());
  const thigh = requireBone('thigh_l'), calf = requireBone('calf_l');
  const foot = requireBone('foot_l');
  const legLength = thigh.getWorldPosition(new THREE.Vector3()).distanceTo(calf.getWorldPosition(new THREE.Vector3()))
    + calf.getWorldPosition(new THREE.Vector3()).distanceTo(foot.getWorldPosition(new THREE.Vector3()));
  const feetRest = ['l', 'r'].map(suffix => requireBone(`foot_${suffix}`).getWorldQuaternion(new THREE.Quaternion()));
  const floor = -modelOffsetY, ankleHeight = ventSoleOffset;
  model.quaternion.copy(facing); model.updateMatrixWorld(true);
  function rotateAnatomically(bone: THREE.Object3D, x: number, y = 0, z = 0) {
    for (const [axis, angle] of [[new THREE.Vector3(1, 0, 0), x], [new THREE.Vector3(0, 1, 0), y], [new THREE.Vector3(0, 0, 1), z]] as const) {
      if (!angle) continue;
      axis.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle)); model.updateMatrixWorld(true);
    }
  }
  clips.push(await bakeRigClip('Slide_Tackle', SLIDE_TACKLE.duration, 85, time => {
    const { low, recover } = slideTackleMotion(time);
    const drop = THREE.MathUtils.smootherstep(time, 0.04, 0.3);
    const plant = THREE.MathUtils.smootherstep(time, 0.78, 1.2);
    const push = Math.sin(recover * Math.PI);
    const hips = hipRest.clone();
    hips.x -= low * legLength * 0.045;
    hips.y = THREE.MathUtils.lerp(hipRest.y, floor + legLength * 0.29, low) - Math.sin(drop * Math.PI) * 0.06;
    hips.z -= low * legLength * 0.11;
    pelvis.position.copy(pelvis.parent!.worldToLocal(hips)); model.updateMatrixWorld(true);
    rotateAnatomically(pelvis, -low * 0.33, low * 0.12, low * 0.24);
    rotateAnatomically(spine[0], -low * 0.23 + push * 0.3, -low * 0.1, -low * 0.08);
    rotateAnatomically(spine[1], -low * 0.15 + push * 0.12);
    rotateAnatomically(spine[2], low * 0.05);
    rotateAnatomically(neck, low * 0.3 - push * 0.16);
    rotateAnatomically(slideHead, low * 0.28 - push * 0.08, -low * 0.06);
    for (const [index, suffix] of ['l', 'r'].entries()) {
      const side = suffix === 'l' ? 1 : -1;
      const lead = suffix === 'l';
      const footTarget = new THREE.Vector3(side * legLength * (lead ? 0.18 : 0.16),
        floor + ankleHeight + (lead ? low * 0.025 : Math.sin(drop * Math.PI) * 0.1),
        legLength * (lead ? THREE.MathUtils.lerp(0.86, 0.08, plant) * drop : THREE.MathUtils.lerp(0.045, -0.32, plant) * drop));
      solveLimb(`thigh_${suffix}`, `calf_${suffix}`, `foot_${suffix}`, footTarget,
        new THREE.Vector3(side * 0.16, lead ? 0.1 : 0.8, 1));
      const boot = requireBone(`foot_${suffix}`);
      const bootRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(lead ? -low * 0.38 : push * 0.15, side * low * 0.1, 0)).multiply(feetRest[index]);
      boot.quaternion.copy(boot.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bootRotation)); model.updateMatrixWorld(true);
      const handTarget = lead
        ? new THREE.Vector3(legLength * 0.49, floor + THREE.MathUtils.lerp(1.08, 0.67, low), legLength * 0.18)
        : new THREE.Vector3(-legLength * 0.45, floor + THREE.MathUtils.lerp(1.06, 0.09, low), -legLength * 0.28 * low);
      solveLimb(`upperarm_${suffix}`, `lowerarm_${suffix}`, `hand_${suffix}`, handTarget, new THREE.Vector3(side, -0.25, -0.65));
      orientHand(suffix, false);
    }
    // Preserve the authored run pose at both ends; all travel belongs to physics.
    const entry = 1 - THREE.MathUtils.smootherstep(time, 0, 0.12);
    const exit = THREE.MathUtils.smootherstep(time, 1.27, SLIDE_TACKLE.duration);
    rig.forEach(({ bone }, index) => {
      const pose = exit > 0 ? exitPose[index] : entryPose[index], weight = exit > 0 ? exit : entry;
      bone.position.lerp(pose.position, weight); bone.quaternion.slerp(pose.quaternion, weight); bone.scale.lerp(pose.scale, weight);
    });
  }));

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

  const lightsaberAttackClips = getLightsaberAttackClips(clips);
  const lightsaberAttacks = lightsaberAttackClips.map(clip => clip.name);
  const actionClips = new Set([...ACTION_CLIPS, ...lightsaberAttacks]);
  const swordIdle = THREE.AnimationClip.findByName(clips, 'Sword_Idle');
  for (const clip of [...lightsaberAttackClips, ...(swordIdle ? [swordIdle] : [])]) {
    const name = clip.name as LightsaberAttackName;
    if (actions.has(name)) continue;
    const action = mixer.clipAction(clip);
    const oneShot = actionClips.has(name);
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
  const reloadClip = THREE.AnimationClip.findByName(clips, 'Pistol_Reload');
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
  const readyClip = aimClip ?? holdClip;
  const holdAction = readyClip ? upperMixer.clipAction(upperClip(readyClip)) : null;
  const shootAction = shootClip ? upperMixer.clipAction(upperClip(shootClip)) : null;
  const reloadAction = reloadClip ? upperMixer.clipAction(upperClip(reloadClip)) : null;
  for (const action of [shootAction, reloadAction]) {
    if (!action) continue;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
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
  let pistolBlend = 0;
  let pistolPitch = 0;
  let pistolAction: THREE.AnimationAction | null = null;
  function playPistolAction(next: THREE.AnimationAction | null, blend = 0.1) {
    if (!next) return;
    const crossFade = pistolAction !== null && next !== pistolAction;
    if (crossFade) pistolAction!.fadeOut(blend);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    if (crossFade) next.fadeIn(blend);
    next.play();
    pistolAction = next;
  }
  const weapon = {
    socket: hand ? socket : null,
    mixer: upperMixer,
    setEquipped(equipped: boolean) {
      if (equipped === armed) return;
      armed = equipped;
      if (armed) {
        upperMixer.stopAllAction();
        pistolAction = null;
        playPistolAction(reloadAction ?? holdAction, 0.12);
      }
    },
    shoot() {
      if (!armed || !shootAction) return;
      playPistolAction(shootAction, 0.065);
    },
    reload() {
      if (armed) playPistolAction(reloadAction, 0.12);
    },
  };

  const rightHand = model.getObjectByName('hand_r');
  const crowbar = createCrowbar();
  crowbar.visible = false;
  let crowbarEquipped = false;

  const lightsaber = createLightsaber();
  const gripPose: { bone: THREE.Object3D; quaternion: THREE.Quaternion }[] = [];
  if (rightHand) {
    const sampler = new THREE.AnimationMixer(model);
    if (swordIdle) sampler.clipAction(swordIdle).play();
    sampler.update(0);
    fitWeaponToHand(crowbar, rightHand, 0.02);
    fitLightsaberToHand(lightsaber, rightHand);
    rightHand.traverse(bone => {
      if (/^(thumb|index|middle|ring|pinky)_0[1-3]_r$/.test(bone.name)) gripPose.push({ bone, quaternion: bone.quaternion.clone() });
    });
    sampler.stopAllAction();
    sampler.uncacheRoot(model);
    resetRig();
  }
  lightsaber.visible = false;
  let lightsaberEquipped = false;

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

  let previousActionRequest: PlayerState['actionRequest'] = null;
  let wasVentMode = false;
  function fadeTo(name: ClipName, restart = false, immediate = false) {
    const next = actions.get(name);
    if (!next || (next === currentAction && !restart && !immediate)) return;
    const saberAttack = lightsaberEquipped && lightsaberAttacks.includes(name as LightsaberAttackName);
    const blend = name === 'Slide_Tackle' ? 0.08 : currentAction.getClip().name === 'Slide_Tackle' ? 0.14 : saberAttack ? 0.045 : 0.2;
    const sameAction = next === currentAction;
    if (immediate) mixer.stopAllAction();
    else if (!sameAction) currentAction.fadeOut(blend);
    const speed = saberAttack ? next.getClip().duration / LIGHTSABER_SWING_DURATION : name === 'Sword_Attack' ? 2.8 : 1;
    next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
    if (!immediate && !sameAction) next.fadeIn(blend);
    next.play();
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
    const freshActionRequest = actionRequest !== previousActionRequest ? actionRequest : null;
    previousActionRequest = actionRequest;
    const pistolRequest = armed && (freshActionRequest === 'Pistol_Shoot' || freshActionRequest === 'Pistol_Reload');
    const idleName = lightsaberEquipped && swordIdle ? 'Sword_Idle' : 'Idle_Loop';
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
    if (playerState.sliding) model.rotation.y = playerState.slideYaw + MODEL_ROT_OFFSET;
    else model.rotation.y += diff * Math.min(1, 10 * dt);
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
        // Resume the already-advancing sprint clock at full weight on this
        // frame, including zero-delta updates; do not schedule a zero-time fade.
        const resumeSprint = cinematicAction?.getClip().name === 'Roll' && cinematic.clip === 'Sprint_Loop';
        if (resumeSprint) cinematicAction!.stop();
        else if (cinematicAction) cinematicAction.fadeOut(0.1);
        else mixer.stopAllAction();
        next.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).play();
        if (!resumeSprint) next.fadeIn(0.1);
        cinematicAction = next;
      }
      const duration = next.getClip().duration;
      const time = Math.max(0, cinematic.time) * (cinematic.duration ? duration / cinematic.duration : 1);
      next.paused = true;
      next.time = cinematic.loop ? time % duration : Math.min(time, duration);
    } else if (playerState.sliding) {
      fadeTo('Slide_Tackle');
      currentAction.paused = true;
      currentAction.time = THREE.MathUtils.clamp(playerState.slideTime, 0, SLIDE_TACKLE.duration);
    } else if (playerState.ventMode) {
      fadeTo(isMoving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop', false, !wasVentMode);
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
      const actionPlaying = actionClips.has(name) && !currentAction.paused;
      if (freshActionRequest && actions.has(freshActionRequest) && !pistolRequest) {
        fadeTo(freshActionRequest, true);
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
          fadeTo(idleName);
        } else if (wasOnGround === false) {
          fadeTo('Jump_Land');
        } else if (name !== 'Jump_Land' || currentAction.paused) {
          fadeTo(idleName);
        }
      }
    } else if (wasOnGround === true && jumping) {
      fadeTo('Jump_Start');
    } else if (name !== 'Jump_Start' || currentAction.paused || velocityY <= 0) {
      fadeTo('Jump_Loop');
    }
    wasOnGround = isOnGround;
    wasVentMode = playerState.ventMode;
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
    const slideAction = actions.get('Slide_Tackle');
    const slideBlending = playerState.sliding || !!(slideAction?.isScheduled() && slideAction.getEffectiveWeight() > 0.01);
    const handsFree = !slideBlending && !climbing && !playerState.ventMode && !boxHandling;
    socket.visible = handsFree;
    crowbar.visible = crowbarEquipped && handsFree;
    lightsaber.visible = lightsaberEquipped && handsFree;
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
      pistolAction = null;
      if (armed) playPistolAction(holdAction);
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
    if (crowbar.visible || lightsaber.visible) {
      for (const grip of gripPose) grip.bone.quaternion.copy(grip.quaternion);
    }
    if (cinematic?.bodyPitch !== undefined) model.rotation.x = cinematic.bodyPitch;
    if (cinematic?.handTargets) applyHandTargets(cinematic.handTargets);
    if (cinematic?.footTargets) applyHandTargets(cinematic.footTargets, legChains);
    if (cinematic?.spinAttack !== undefined) {
      const progress = THREE.MathUtils.clamp(cinematic.spinAttack, 0, 1);
      const windup = THREE.MathUtils.smootherstep(progress, 0, 0.2);
      const sweep = THREE.MathUtils.smootherstep(progress, 0.18, 0.84);
      const release = THREE.MathUtils.smootherstep(progress, 0.76, 1);
      const extended = THREE.MathUtils.smootherstep(progress, 0.12, 0.34) * (1 - release);
      model.rotation.y = yaw + MODEL_ROT_OFFSET + windup * 0.42 - sweep * (Math.PI * 2 + 0.42);
      model.rotation.x = extended * 0.045;
      model.rotation.z = -extended * 0.04;
      upperRoot?.rotateY((1 - release) * (-windup * 0.24 + sweep * 0.24));
      model.updateMatrixWorld(true);
      const rightTarget = model.localToWorld(new THREE.Vector3(0.42 + extended * 0.24, 1.32 - extended * 0.12, 0.24 * (1 - sweep)));
      const leftTarget = model.localToWorld(new THREE.Vector3(-0.3, 1.35, 0.3 - extended * 0.12));
      applyHandTargets({ right: rightTarget, left: leftTarget, weight: extended });
      const desiredBlade = new THREE.Vector3(0.98, -0.08 + release * 0.65, 0.18 * (1 - sweep)).normalize().transformDirection(model.matrixWorld);
      const bladeFacing = new THREE.Vector3(0, 0, 1).transformDirection(model.matrixWorld).projectOnPlane(desiredBlade).normalize();
      const bladeSide = desiredBlade.clone().cross(bladeFacing).normalize();
      if (rightHand?.parent) {
        const bladeRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(bladeSide, desiredBlade, bladeFacing));
        const desiredHand = rightHand.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(bladeRotation).multiply(lightsaber.quaternion.clone().invert());
        rightHand.quaternion.slerp(desiredHand, extended * 0.98);
      }
      model.updateMatrixWorld(true);
    }
    const pistolTarget = armed && handsFree && !cinematic ? 1 : 0;
    pistolBlend = playerState.ventMode || slideBlending ? 0 : THREE.MathUtils.damp(pistolBlend, pistolTarget, 14, dt);
    if (!cinematic && handsFree && pistolRequest) {
      if (freshActionRequest === 'Pistol_Reload') weapon.reload();
      else weapon.shoot();
    }
    if (!cinematic && pistolBlend > 0.001) {
      upperMixer.update(dt);
      if (pistolAction?.paused && pistolAction !== holdAction) {
        playPistolAction(holdAction, 0.14);
        upperMixer.update(0);
      }
      for (const { bone, pose } of layerBones) {
        bone.position.lerp(pose.position, pistolBlend);
        bone.quaternion.slerp(pose.quaternion, pistolBlend);
        bone.scale.lerp(pose.scale, pistolBlend);
      }
      pistolPitch = THREE.MathUtils.damp(pistolPitch, THREE.MathUtils.clamp(pitch ?? 0, -1.1, 1.1), 14, dt);
      if (upperRoot) {
        model.updateMatrixWorld(true);
        const axis = new THREE.Vector3(1, 0, 0).transformDirection(model.matrixWorld)
          .applyQuaternion(upperRoot.getWorldQuaternion(new THREE.Quaternion()).invert());
        upperRoot.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, -pistolPitch * pistolBlend));
      }
    }
    const crouchBlending = [actions.get('Crouch_Idle_Loop'), actions.get('Crouch_Fwd_Loop')]
      .some(action => action?.isRunning() && action.getEffectiveWeight() > 0);
    const groundCrouch = !cinematic && !slideBlending && (crouching || crouchBlending) && isOnGround && !climbing && !floating && !boxHandling;
    if ((playerState.ventMode || groundCrouch) && ventFeet.length) {
      model.updateMatrixWorld(true);
      const feetY = Math.min(...ventFeet.map(bone => bone.getWorldPosition(ventFootPosition).y));
      model.position.y += playerBodyPos.y - playerRadius + ventSoleOffset - feetY;
      model.updateMatrixWorld(true);
    }
  }

  function setFacing(yaw: number) {
    // Doorway coordinate changes are instantaneous, not an in-world turn.
    model.rotation.set(0, yaw + MODEL_ROT_OFFSET, 0, 'YXZ');
  }

  function hologramMaterial(original: THREE.Material): THREE.Material {
    const cached = hologramMaterials.get(original);
    if (cached) return cached;
    const material = original.clone();
    material.transparent = true;
    material.depthWrite = false;
    material.customProgramCacheKey = () => `${original.customProgramCacheKey()}-player-hologram`;
    material.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile(shader, renderer);
      Object.assign(shader.uniforms, hologramUniforms);
      shader.vertexShader = `varying vec3 hologramPosition;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nhologramPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      shader.fragmentShader = `
        uniform float hologramTime;
        uniform float hologramBlend;
        uniform float hologramOpacity;
        varying vec3 hologramPosition;
        ${shader.fragmentShader}
      `.replace('#include <opaque_fragment>', `
        #include <opaque_fragment>
        float hologramRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
        float hologramScan = 0.5 + 0.5 * sin(hologramPosition.y * 130.0 - hologramTime * 8.0);
        float hologramFlicker = 0.96 + 0.04 * sin(hologramTime * 25.0);
        vec3 hologramColor = vec3(0.04, 0.5, 1.4) * (0.6 + hologramScan * 0.28 + hologramRim * 0.8) * hologramFlicker;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hologramColor, hologramBlend);
        gl_FragColor.a *= hologramOpacity;
      `);
    };
    hologramMaterials.set(original, material);
    return material;
  }

  function setHologramTransition(state: HologramTransition | null) {
    if (!state) {
      if (!hologramActive) return;
      for (const entry of transitionMeshes) entry.mesh.material = entry.material;
      hologramActive = false;
      model.visible = true;
      return;
    }
    if (!hologramActive) {
      for (const entry of transitionMeshes) {
        entry.mesh.material = Array.isArray(entry.material) ? entry.material.map(hologramMaterial) : hologramMaterial(entry.material);
      }
      hologramActive = true;
    }
    hologramUniforms.hologramTime.value = state.time;
    hologramUniforms.hologramBlend.value = THREE.MathUtils.clamp(state.blend, 0, 1);
    hologramUniforms.hologramOpacity.value = THREE.MathUtils.clamp(state.opacity, 0, 1);
    model.visible = state.opacity > 0;
  }

  function dispose() {
    setHologramTransition(null);
    for (const material of hologramMaterials.values()) material.dispose();
    hologramMaterials.clear();
    disposeLightsaber(lightsaber);
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
    model, mixer, update, setFacing, setHologramTransition, weapon, crowbar, lightsaberAttacks,
    setCrowbarEquipped: (equipped: boolean) => { crowbarEquipped = equipped; crowbar.visible = equipped; },
    setLightsaberEquipped: (equipped: boolean) => { lightsaberEquipped = equipped; lightsaber.visible = equipped; },
    setGogglesEquipped: (equipped: boolean) => { goggles.visible = equipped; },
    dispose,
  };
}
