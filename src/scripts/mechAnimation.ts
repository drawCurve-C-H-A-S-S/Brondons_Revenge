import * as THREE from 'three';
import type { MechMove } from './mechDuel.js';
import {
  HERO_ULTIMATE, MELEE_STRIKES, RIFLE_SEQUENCE, PLANET_RUPTURE,
  isMeleeStrike, cinematicProgress, sampleRifleSequence,
} from './finaleChoreography.js';

export type MechPoseName = MechMove | 'transform' | 'clash' | 'victory' | 'dance' | 'evade' | 'boost' | 'reactor' | 'bomb' | 'skyCharge' | 'afterCut';
const SLOTS = ['hips', 'spine', 'spineUpper', 'head', 'leftShoulder', 'rightShoulder', 'leftArm', 'rightArm',
  'leftElbow', 'rightElbow', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftFoot', 'rightFoot'] as const;
export type MechSlot = typeof SLOTS[number];
export type MechBoneMap = Partial<Record<MechSlot, string>>;
type Angles = readonly [number, number, number];
type RigPose = Partial<Record<MechSlot, Angles>>;
const NAMES: Record<MechSlot, string> = {
  hips: 'pelvis', spine: 'spine_02', spineUpper: 'spine_03', head: 'Head',
  leftShoulder: 'clavicle_l', rightShoulder: 'clavicle_r', leftArm: 'upperarm_l', rightArm: 'upperarm_r',
  leftElbow: 'lowerarm_l', rightElbow: 'lowerarm_r', leftHand: 'hand_l', rightHand: 'hand_r',
  leftLeg: 'thigh_l', rightLeg: 'thigh_r', leftKnee: 'calf_l', rightKnee: 'calf_r', leftFoot: 'foot_l', rightFoot: 'foot_r',
};
const smooth = THREE.MathUtils.smootherstep;
const clamp = THREE.MathUtils.clamp;

function rigSampler(model: THREE.Object3D, aliases: MechBoneMap = {}) {
  model.updateMatrixWorld(true);
  const slots: Partial<Record<MechSlot, THREE.Object3D>> = {};
  const inverseModel = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  const entries = SLOTS.flatMap(slot => {
    const bone = model.getObjectByName(aliases[slot] ?? NAMES[slot]);
    if (!bone) return [];
    slots[slot] = bone;
    const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    const basis = inverseModel.clone().multiply(parent).invert();
    return [{ slot, bone, rest: bone.quaternion.clone(), position: bone.position.clone(),
      axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(basis)) }];
  });
  const required: MechSlot[] = ['hips', 'spine', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  const missing = required.filter(slot => !slots[slot]);
  if (missing.length) throw new Error(`Finale rig is missing ${missing.join(', ')}. Supply a semantic bone map for the replacement model.`);
  const rotation = new THREE.Quaternion();
  function restore() { for (const entry of entries) { entry.bone.quaternion.copy(entry.rest); entry.bone.position.copy(entry.position); } }
  return { slots, entries, restore,
    apply(pose: RigPose) {
      restore();
      for (const entry of entries) {
        const angles = pose[entry.slot];
        if (!angles) continue;
        for (let i = 0; i < 3; i++) if (angles[i]) {
          entry.bone.quaternion.premultiply(rotation.setFromAxisAngle(entry.axes[i], angles[i]));
        }
      }
    },
  };
}

function bakeClip(sampler: ReturnType<typeof rigSampler>, name: string, duration: number, pose: (progress: number) => RigPose, upperBodyOnly = false) {
  const entries = upperBodyOnly ? sampler.entries.filter(entry =>
    !['hips', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftFoot', 'rightFoot'].includes(entry.slot)) : sampler.entries;
  const times: number[] = [], rotations = entries.map(() => [] as number[]);
  const frames = 48;
  for (let frame = 0; frame <= frames; frame++) {
    const progress = frame / frames; times.push(progress * duration); sampler.apply(pose(progress));
    entries.forEach((entry, i) => rotations[i].push(...entry.bone.quaternion.toArray()));
  }
  sampler.restore();
  return new THREE.AnimationClip(name, duration, entries.map((entry, i) =>
    new THREE.QuaternionKeyframeTrack(`${entry.bone.uuid}.quaternion`, times, rotations[i])));
}

function mechPose(move: MechPoseName, p: number, secondSlash = false): RigPose {
  const pose: RigPose = {
    hips: [0, 0, 0], spine: [0.06, -0.08, 0], head: [-0.04, 0.08, 0],
    leftArm: [-0.05, -0.12, -1.28], rightArm: [-0.08, 0.24, 1.2],
    leftElbow: [0, 0.12, -0.3], rightElbow: [0, -0.12, 0.55], rightHand: [0, 0.12, 0],
    leftLeg: [-0.13, 0, 0.13], rightLeg: [-0.08, 0, -0.13],
    leftKnee: [0.2, 0, 0], rightKnee: [0.15, 0, 0],
    leftFoot: [-0.08, 0, 0], rightFoot: [-0.05, 0, 0],
  };
  if (move === 'idle') {
    const breathe = Math.sin(p * Math.PI * 2);
    pose.spine = [0.06 + breathe * 0.025, -0.08, 0]; pose.head = [-0.04, 0.08 + breathe * 0.02, 0];
  } else if (move === 'walk') {
    const stride = Math.sin(p * Math.PI * 2), left = Math.max(0, -stride), right = Math.max(0, stride);
    pose.hips = [0, stride * 0.07, 0.04 * stride]; pose.spine = [0.12, -stride * 0.14, -stride * 0.025];
    pose.leftLeg = [stride * 0.58 - 0.12, 0, 0.13]; pose.rightLeg = [-stride * 0.58 - 0.12, 0, -0.13];
    pose.leftKnee = [0.18 + left * 0.72, 0, 0]; pose.rightKnee = [0.18 + right * 0.72, 0, 0];
    pose.leftFoot = [-0.12 - left * 0.35, 0, 0]; pose.rightFoot = [-0.12 - right * 0.35, 0, 0];
    pose.leftArm = [-0.3 - stride * 0.23, -0.12, -1.28]; pose.rightArm = [-0.46 + stride * 0.16, 0.24, 1.2];
  } else if (isMeleeStrike(move) || move === 'overdrive') {
    const heavy = move === 'cleave' || move === 'slash' || move === 'overdrive';
    const reversed = move === 'reap' || secondSlash;
    const timing = isMeleeStrike(move) ? MELEE_STRIKES[move] : MELEE_STRIKES.cleave;
    const time = p * (move === 'overdrive' ? HERO_ULTIMATE.duration : timing.duration);
    const wind = cinematicProgress(time, 0, move === 'overdrive' ? HERO_ULTIMATE.cameraEnd : timing.start);
    const strike = cinematicProgress(time, move === 'overdrive' ? HERO_ULTIMATE.cameraEnd : timing.start,
      move === 'overdrive' ? HERO_ULTIMATE.release : timing.end);
    const recovery = 1 - smooth(p, 0.78, 1);
    const twist = (wind * -0.56 + strike * 1.12) * recovery * (reversed ? -1 : 1);
    pose.spine = [move === 'thrust' ? (wind * -0.08 + strike * 0.3) * recovery
      : heavy ? (-0.16 * wind + 0.34 * strike) * recovery : 0.1, heavy ? twist * 0.3 : twist, 0];
    pose.spineUpper = [heavy ? -wind * 0.12 * recovery : 0, twist * 0.2, 0];
    pose.rightArm = [-wind * 0.2, 0.24 + twist * 0.6, 1.2 - wind * (heavy ? 1.7 : 0.5) * recovery];
    pose.rightElbow = [0, -0.12 - wind * 0.2, 0.55 - wind * 0.25 + strike * 0.15];
    pose.leftArm = [-0.1, -0.12 - twist * 0.2, -1.28 + wind * (heavy ? 0.95 : 0.3) * recovery];
    pose.leftElbow = [0, 0.15, -0.3 - wind * (heavy ? 0.7 : 0.25) * recovery];
    pose.head = [0.02 + strike * 0.08 * recovery, -twist * 0.2, 0];
  } else if (move === 'guard' || move === 'clash') {
    const strain = move === 'clash' ? Math.sin(p * 37) * 0.035 : 0;
    pose.spine = [0.17, -0.28 + strain, 0];
    pose.leftArm = [0, -0.7, -0.65]; pose.rightArm = [0, 1.1, 0.35];
    pose.leftElbow = [0, -0.15, -1.1]; pose.rightElbow = [0, 0.2, 0.8]; pose.head = [-0.1, 0.2, 0];
    pose.leftLeg = [-0.38, 0, 0.2]; pose.leftKnee = [0.62, 0, 0]; pose.rightKnee = [0.42, 0, 0];
  } else if (move === 'missiles') {
    const time = p * RIFLE_SEQUENCE.swordReady, sequence = sampleRifleSequence(time);
    const brace = sequence.shoulderToAim * (1 - sequence.returning);
    const recoil = sequence.firing ? Math.max(0, Math.sin((time - RIFLE_SEQUENCE.fire) * Math.PI * 2 / 0.14)) * 0.045 : 0;
    pose.spine = [0.1 * brace - recoil, -0.18 * brace, 0];
    pose.leftArm = [0, -0.12 - brace * 1.08, -1.28 + brace * 0.95 + recoil];
    pose.rightArm = [0, 0.24 + brace * 0.76, 1.2 - brace * 0.8];
    pose.leftElbow = [0, 0, -0.3 - brace * 0.12];
    pose.rightElbow = [0, 0.15, 0.55 + brace * 0.45];
    pose.leftKnee = [0.2 + brace * 0.23, 0, 0]; pose.rightKnee = [0.15 + brace * 0.23, 0, 0];
    pose.head = [-0.08 * brace, 0.05, 0];
  } else if (move === 'verdict') {
    const aim = smooth(p, 0, 0.38), release = smooth(p, 0.65, 0.76);
    pose.spine = [-0.1 * aim + release * 0.08, -0.3 * aim, 0];
    pose.rightArm = [0, 0.5, 1.2 - aim * 0.8]; pose.rightElbow = [0, -0.25, 0.55 - aim * 0.45];
    pose.leftArm = [-0.15, -0.6 * aim, -1.28 + aim * 0.5];
    pose.leftElbow = [0, -0.1, -0.3 - aim * 0.75];
    pose.head = [-0.12, 0.22, 0];
  } else if (move === 'dash') {
    const weight = Math.sin(p * Math.PI);
    pose.spine = [0.45 * weight, -0.12, 0];
    pose.leftArm = [0.6 * weight, 0, -1.28]; pose.rightArm = [0.35 * weight, 0, 1.2];
    pose.leftLeg = [-0.65 * weight, 0, 0.08]; pose.rightLeg = [0.45 * weight, 0, -0.08];
    pose.leftKnee = [0.2 + 0.8 * weight, 0, 0]; pose.rightKnee = [0.15 + 0.45 * weight, 0, 0];
    pose.head = [-0.2 * weight, 0, 0];
  } else if (move === 'stagger') {
    const recoil = Math.sin(p * Math.PI);
    pose.spine = [-0.58 * recoil, -0.08, 0.13 * recoil]; pose.head = [-0.28 * recoil, 0.15, 0];
    pose.leftArm = [-0.3 - recoil * 0.4, -0.1, -1.28 + recoil * 0.25]; pose.rightKnee = [0.15 + recoil * 0.45, 0, 0];
  } else if (move === 'defeat') {
    const fall = smooth(p, 0, 0.85);
    pose.spine = [0.78 * fall, -0.18, 0.12 * fall]; pose.spineUpper = [0.35 * fall, 0, 0];
    pose.head = [0.45 * fall, 0, 0]; pose.leftArm = [0.2 * fall, 0, -1.4]; pose.rightArm = [0.1 * fall, 0, 1.4];
    pose.leftLeg = [-1.05 * fall, 0, 0.13]; pose.rightLeg = [-0.93 * fall, 0, -0.13];
    pose.leftKnee = [1.8 * fall, 0, 0]; pose.rightKnee = [1.65 * fall, 0, 0];
  } else if (move === 'evade') {
    const duck = Math.sin(p * Math.PI);
    pose.hips = [0, duck * -0.3, duck * 0.2];
    pose.spine = [0.45 * duck, -0.2, duck * -0.36];
    pose.head = [-0.2 * duck, 0.25, 0];
    pose.rightArm = [0, 0.3, 1.1]; pose.leftArm = [0.2, -0.3, -0.8 - duck * 0.45];
    pose.leftLeg = [-0.25 - duck * 0.3, 0, 0.15]; pose.rightLeg = [0.1 + duck * 0.25, 0, -0.1];
    pose.leftKnee = [0.2 + duck * 0.65, 0, 0]; pose.rightKnee = [0.15 + duck * 0.4, 0, 0];
  } else if (move === 'boost') {
    const drive = smooth(p, 0, 0.3) * (1 - smooth(p, 0.78, 1));
    pose.spine = [0.3 * drive, -0.12, 0]; pose.head = [-0.16 * drive, 0.1, 0];
    pose.leftArm = [0.1, -0.2, -1.3]; pose.rightArm = [0, 0.7, 0.9];
    pose.leftLeg = [-0.35, 0, 0.1]; pose.rightLeg = [0.18, 0, -0.1];
    pose.leftKnee = [0.65, 0, 0]; pose.rightKnee = [0.4, 0, 0];
  } else if (move === 'reactor' || move === 'skyCharge') {
    const charge = smooth(p, 0, 0.6);
    pose.spine = [-0.16 * charge, -0.2, 0]; pose.head = [-0.12, 0.2, 0];
    pose.rightArm = [0, 0.75, 1.2 - charge * 1.8];
    pose.rightElbow = [0, -0.2, 0.7 - charge * 0.6];
    pose.leftArm = [0, -0.6, -1.28 + charge * 1.7]; pose.leftElbow = [0, 0, -0.4 - charge * 0.4];
    pose.leftKnee = [0.35, 0, 0]; pose.rightKnee = [0.25, 0, 0];
  } else if (move === 'bomb') {
    const time = p * (PLANET_RUPTURE.escape + 0.5);
    const raise = cinematicProgress(time, PLANET_RUPTURE.raise, PLANET_RUPTURE.release - 0.35);
    const slam = cinematicProgress(time, PLANET_RUPTURE.slam, PLANET_RUPTURE.escape);
    pose.spine = [-0.2 * raise + slam * 0.5, 0.1 * (1 - slam), 0];
    pose.leftArm = [-slam * 0.7, -0.4, -1.28 + raise * 2.25 - slam * 1.1];
    pose.rightArm = [-slam * 0.7, 0.4, 1.2 - raise * 2.2 + slam * 1.1];
    pose.leftElbow = [0, 0, -0.25 - raise * 0.22 + slam * 0.16];
    pose.rightElbow = [0, 0, 0.25 + raise * 0.22 - slam * 0.16];
    pose.head = [-0.28 * raise + slam * 0.35, 0, 0];
  } else if (move === 'afterCut') {
    pose.spine = [0.13, -0.26, 0]; pose.head = [-0.04, 0.2, 0];
    pose.rightArm = [0.1, 0.6, 1.22]; pose.rightElbow = [0, -0.18, 0.2];
    pose.leftArm = [0, -0.1, -1.35];
  } else if (move === 'dance') {
    const sway = Math.sin(p * Math.PI * 2);
    pose.spine = [0.05, sway * 0.2, sway * 0.08]; pose.head = [-0.04, -sway * 0.15, 0];
    pose.leftArm = [-0.25, -0.12, -1.05 + sway * 0.4]; pose.rightArm = [-0.25, 0.24, 1.05 + sway * 0.4];
  } else if (move === 'transform' || move === 'victory') {
    const charge = smooth(p, 0, 0.35), lock = smooth(p, 0.65, 1);
    pose.spine = [-0.17 * charge + 0.2 * lock, -0.1 + lock * 0.3, 0];
    pose.leftArm = [0, -0.3 - charge * 0.3, -1.28 + charge * 0.5 - lock * 0.25];
    pose.rightArm = [0, 0.24 + charge * 0.45, 1.2 - charge * 0.35 + lock * 0.15];
    pose.rightElbow = [0, -0.12, 0.55 - charge * 0.2]; pose.head = [-0.15 * charge + lock * 0.12, 0.1, 0];
  }
  return pose;
}

export function createMechAnimator(model: THREE.Object3D, aliases: MechBoneMap = {}) {
  const sampler = rigSampler(model, aliases), mixer = new THREE.AnimationMixer(model);
  const moves: MechPoseName[] = ['idle', 'walk', 'slash', 'sideSlash', 'cleave', 'thrust', 'reap', 'verdict',
    'missiles', 'guard', 'dash', 'stagger', 'overdrive', 'defeat', 'transform', 'clash', 'victory',
    'evade', 'boost', 'reactor', 'bomb', 'skyCharge', 'afterCut', 'dance'];
  const clips = new Map<string, THREE.AnimationClip>();
  for (const move of moves) {
    clips.set(move, bakeClip(sampler, `Mech_${move}`, move === 'idle' ? 4 : move === 'walk' ? 1.1 : 1, p => mechPose(move, p), true));
  }
  clips.set('slash-reverse', bakeClip(sampler, 'Mech_Backhand', 1, p => mechPose('slash', p, true), true));
  let current = '', action: THREE.AnimationAction | null = null;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), goal = new THREE.Vector3();
  const direction = new THREE.Vector3(), pole = new THREE.Vector3(), elbow = new THREE.Vector3();
  const worldDelta = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), worldRotation = new THREE.Quaternion();
  function rotateSegment(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    worldDelta.setFromUnitVectors(from.normalize(), to.normalize());
    bone.getWorldQuaternion(worldRotation).premultiply(worldDelta);
    bone.parent?.getWorldQuaternion(parentRotation);
    bone.quaternion.copy(parentRotation.invert().multiply(worldRotation));
    model.updateMatrixWorld(true);
  }
  return {
    slots: sampler.slots, animations: [...clips.values()],
    perform(move: MechPoseName, time: number, weight: number) {
      const breath = Math.sin(time * 2.4), effort = move === 'clash' || move === 'guard'
        || move === 'reactor' || move === 'skyCharge' || move === 'verdict';
      const strain = effort ? Math.sin(time * 23) * Math.sin(time * 7.1) * 0.012 : 0;
      const offsets: RigPose = {
        spine: [breath * 0.017 + strain, Math.sin(time * 1.3) * 0.012, strain * 0.45],
        spineUpper: [-breath * 0.009, strain * 0.7, 0],
        head: [-breath * 0.009, Math.sin(time * 0.85) * 0.024, -strain],
        leftShoulder: [breath * 0.008, 0, strain],
        rightShoulder: [breath * 0.008, 0, -strain],
      };
      for (const entry of sampler.entries) {
        const angles = offsets[entry.slot];
        if (!angles) continue;
        for (let axis = 0; axis < 3; axis++) {
          worldDelta.setFromAxisAngle(entry.axes[axis], angles[axis] * weight);
          entry.bone.quaternion.premultiply(worldDelta);
        }
      }
      model.updateMatrixWorld(true);
    },
    pose(move: MechPoseName, time: number, duration = 1, airborne = false, combo = 0) {
      const stableAirPose = airborne && (move === 'walk' || move === 'dash') ? 'idle' : move;
      const key = stableAirPose === 'slash' && combo % 2 === 1 ? 'slash-reverse' : stableAirPose;
      const clip = clips.get(key)!;
      if (key !== current) { mixer.stopAllAction(); current = key; action = mixer.clipAction(clip).reset().play(); }
      if (!action) return;
      action.time = stableAirPose === 'idle' || stableAirPose === 'walk' || stableAirPose === 'dance' ? Math.max(0, time) % clip.duration
        : clamp(time / Math.max(0.01, duration), 0, 1) * clip.duration;
      action.paused = true; mixer.update(0);
      model.updateMatrixWorld(true);
    },
    reach(side: 'left' | 'right', target: THREE.Vector3, polePoint: THREE.Vector3) {
      const arm = sampler.slots[side === 'left' ? 'leftArm' : 'rightArm'];
      const forearm = sampler.slots[side === 'left' ? 'leftElbow' : 'rightElbow'];
      const hand = sampler.slots[side === 'left' ? 'leftHand' : 'rightHand'];
      if (!arm || !forearm || !hand) throw new Error(`The ${side} arm needs an arm, elbow, and hand for weapon IK`);
      arm.getWorldPosition(a); forearm.getWorldPosition(b); hand.getWorldPosition(c);
      const upperLength = a.distanceTo(b), lowerLength = b.distanceTo(c);
      direction.copy(target).sub(a);
      const distance = clamp(direction.length(), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
      direction.normalize(); goal.copy(a).addScaledVector(direction, distance);
      pole.copy(polePoint).sub(a);
      pole.addScaledVector(direction, -pole.dot(direction));
      if (pole.lengthSq() < 1e-8) {
        pole.set(Math.abs(direction.y) < 0.9 ? 0 : 1, Math.abs(direction.y) < 0.9 ? 1 : 0, 0);
        pole.addScaledVector(direction, -pole.dot(direction));
      }
      pole.normalize();
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      elbow.copy(a).addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, upperLength * upperLength - along * along)));
      rotateSegment(arm, b.clone().sub(a), elbow.clone().sub(a));
      forearm.getWorldPosition(b); hand.getWorldPosition(c);
      rotateSegment(forearm, c.clone().sub(b), goal.clone().sub(b));
    },
    stop() { mixer.stopAllAction(); current = ''; action = null; sampler.restore(); model.updateMatrixWorld(true); },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); sampler.restore(); },
  };
}

export function createStudentPoseClip(model: THREE.Object3D, index: number) {
  const sampler = rigSampler(model);
  const signature: RigPose[] = [
    { spine: [0, -0.4, 0], rightArm: [-1.8, -0.25, -0.4], rightElbow: [-0.15, 0, 0], leftArm: [-0.4, 0.25, -1.25], head: [-0.12, 0.2, 0] },
    { spine: [0.05, 0.3, -0.18], leftArm: [-1.65, 0, 0.35], rightArm: [-0.6, 0.5, 1.15], rightElbow: [-1.4, 0, 0], leftLeg: [-0.3, 0, 0.25] },
    { spine: [0.38, -0.2, 0], rightArm: [-1.45, 0.3, -0.25], leftArm: [-0.7, -0.1, -1.1], leftLeg: [-0.7, 0, 0.3], leftKnee: [1.15, 0, 0], rightKnee: [0.7, 0, 0] },
    { spine: [-0.15, 0.25, 0.12], leftArm: [-0.7, 0, 0.3], rightArm: [-1.55, 0, -0.3], leftElbow: [-1.15, 0, 0], head: [-0.18, -0.2, 0] },
    { spine: [0.06, -0.35, 0.12], leftArm: [-1.3, -0.6, 0.65], leftElbow: [-1.65, 0, 0], rightArm: [-1.35, 0.2, -0.15], rightElbow: [-0.25, 0, 0] },
  ];
  return bakeClip(sampler, `Sudoers5_Signature_${index + 1}`, 3.6, p => {
    const pose: RigPose = {
      spine: [0, 0, 0], head: [0, 0, 0], leftArm: [-0.05, 0, -1.4], rightArm: [-0.05, 0, 1.4],
      leftElbow: [-0.15, 0, 0], rightElbow: [-0.15, 0, 0], leftLeg: [0, 0, 0.08], rightLeg: [0, 0, -0.08],
      leftKnee: [0.08, 0, 0], rightKnee: [0.08, 0, 0],
    };
    const flourish = Math.sin(smooth(p, 0.04, 0.42) * Math.PI) * (1 - smooth(p, 0.5, 0.65));
    pose.leftArm = [-flourish * 1.2, -flourish * 0.4, -1.4 + flourish * 0.85];
    pose.rightArm = [-flourish * 1.4, flourish * 0.5, 1.4 - flourish * 0.75];
    const settle = smooth(p, 0.4, 0.82), target = signature[index % signature.length];
    for (const slot of SLOTS) {
      const angles = target[slot];
      if (!angles) continue;
      const base = pose[slot] ?? [0, 0, 0];
      pose[slot] = [THREE.MathUtils.lerp(base[0], angles[0], settle),
        THREE.MathUtils.lerp(base[1], angles[1], settle), THREE.MathUtils.lerp(base[2], angles[2], settle)];
    }
    return pose;
  });
}

export function createStudentBoardingClip(model: THREE.Object3D) {
  return bakeClip(rigSampler(model), 'Sudoers5_CoreAscension', 2.3, p => {
    const rise = smooth(p, 0.05, 0.55), merge = smooth(p, 0.65, 0.95);
    return {
      spine: [-0.08 * rise + 0.18 * merge, 0, 0], head: [-0.1 * rise + merge * 0.16, 0, 0],
      leftArm: [0, -0.25 - merge * 0.6, -1.3 + rise * 0.4 + merge * 0.4],
      rightArm: [0, 0.25 + merge * 0.6, 1.3 - rise * 0.4 - merge * 0.4],
      leftElbow: [0, 0, -0.2 - merge * 0.65], rightElbow: [0, 0, 0.2 + merge * 0.65],
      leftLeg: [-0.1, 0, 0.06], rightLeg: [-0.1, 0, -0.06],
      leftKnee: [0.18, 0, 0], rightKnee: [0.18, 0, 0],
    };
  });
}
