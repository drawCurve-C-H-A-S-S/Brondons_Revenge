import * as THREE from "three";

export type WardenRigBeat = "wall" | "aim" | "recoil" | "push" | "flight" | "land";
export interface WardenRigFrame {
  beat: WardenRigBeat;
  time: number;
  delta: number;
  feet: THREE.Vector3;
  forward: THREE.Vector3;
  wall: THREE.Vector3;
  target: THREE.Vector3;
  socket?: THREE.Object3D | null;
}

/** Scene-owned, world-contact choreography. No gameplay animation clips are sampled. */
export function createWardenCinematicRig(model: THREE.Object3D) {
  const bones = new Map<string, THREE.Bone>();
  model.traverse((node) => {
    if (node instanceof THREE.Bone) bones.set(node.name, node);
  });
  const required = (name: string) => {
    const bone = bones.get(name);
    if (!bone) throw new Error(`Warden choreography needs Brondon's ${name} bone`);
    return bone;
  };
  const pelvis = required("pelvis");
  const limbs = ["l", "r"].map((side) => ({
    side: side === "l" ? -1 : 1,
    arm: [required(`upperarm_${side}`), required(`lowerarm_${side}`), required(`hand_${side}`)],
    leg: [required(`thigh_${side}`), required(`calf_${side}`), required(`foot_${side}`)],
  }));
  const entry = [...bones.values()].map((bone) => ({
    bone, position: bone.position.clone(), rotation: bone.quaternion.clone(),
  }));
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
  });
  skeletons.forEach((skeleton) => skeleton.pose());
  const rest = entry.map(({ bone }) => ({
    bone, position: bone.position.clone(), rotation: bone.quaternion.clone(),
  }));
  const previousPose = new Map<THREE.Bone, { position: THREE.Vector3; rotation: THREE.Quaternion }>();
  model.updateMatrixWorld(true);
  const restHip = pelvis.getWorldPosition(new THREE.Vector3());
  const restFoot = required("foot_l").getWorldPosition(new THREE.Vector3());
  const proportions = Math.max(0.5, restHip.distanceTo(restFoot)) / 0.93;
  const restore = () => {
    previousPose.clear();
    for (const item of entry) {
      item.bone.position.copy(item.position);
      item.bone.quaternion.copy(item.rotation);
    }
    model.updateMatrixWorld(true);
  };
  restore();
  const up = new THREE.Vector3(0, 1, 0);
  const rotation = new THREE.Quaternion();
  const right = new THREE.Vector3();
  const origin = new THREE.Vector3(), joint = new THREE.Vector3(), end = new THREE.Vector3();
  const direction = new THREE.Vector3(), bend = new THREE.Vector3(), elbow = new THREE.Vector3();
  const current = new THREE.Vector3(), desired = new THREE.Vector3();
  const parentRotation = new THREE.Quaternion(), worldRotation = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const point = (f: WardenRigFrame, x: number, y: number, z: number) =>
    f.feet.clone().addScaledVector(right, x * proportions).addScaledVector(up, y * proportions).addScaledVector(f.forward, z * proportions);
  function aim(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
    bone.getWorldPosition(origin);
    child.getWorldPosition(current).sub(origin).normalize();
    desired.copy(target).sub(origin).normalize();
    worldRotation.setFromUnitVectors(current, desired)
      .multiply(bone.getWorldQuaternion(rotation));
    parentRotation.copy(bone.parent!.getWorldQuaternion(rotation)).invert();
    bone.quaternion.copy(parentRotation.multiply(worldRotation));
    bone.updateWorldMatrix(false, true);
  }
  function solve(chain: THREE.Object3D[], target: THREE.Vector3, pole: THREE.Vector3) {
    const [upper, lower, tip] = chain;
    upper.getWorldPosition(origin);
    lower.getWorldPosition(joint);
    tip.getWorldPosition(end);
    const a = origin.distanceTo(joint), b = joint.distanceTo(end);
    direction.copy(target).sub(origin);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    direction.normalize();
    bend.copy(pole).addScaledVector(direction, -pole.dot(direction));
    if (bend.lengthSq() < 1e-6) bend.copy(up).addScaledVector(direction, -up.dot(direction));
    bend.normalize();
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    elbow.copy(origin).addScaledVector(direction, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    end.copy(origin).addScaledVector(direction, distance);
    aim(upper, lower, elbow);
    aim(lower, tip, end);
  }
  function orient(bone: THREE.Object3D, quaternion: THREE.Quaternion) {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(rotation).invert().multiply(quaternion));
    bone.updateWorldMatrix(false, true);
  }
  return {
    restore,
    release() { previousPose.clear(); },
    drawSword(feet: THREE.Vector3, forward: THREE.Vector3, time: number) {
      model.updateMatrixWorld(true);
      right.crossVectors(forward, up).normalize();
      const hand = limbs[1].arm[2];
      const grip = hand.getWorldQuaternion(new THREE.Quaternion());
      const target = feet.clone().addScaledVector(right, 0.24 * proportions)
        .addScaledVector(up, 0.83 * proportions).addScaledVector(forward, -0.08);
      target.lerp(hand.getWorldPosition(new THREE.Vector3()), THREE.MathUtils.smootherstep(time, 0, 0.6));
      solve(limbs[1].arm, target, right.clone().multiplyScalar(0.25).addScaledVector(up, -1));
      orient(hand, grip);
    },
    apply(f: WardenRigFrame) {
      for (const item of rest) {
        item.bone.position.copy(item.position);
        item.bone.quaternion.copy(item.rotation);
      }
      right.crossVectors(f.forward, up).normalize();
      const wall = ["wall", "aim", "recoil", "push"].includes(f.beat);
      const push = f.beat === "push" ? THREE.MathUtils.smootherstep(f.time, 0.16, 0.42) : 0;
      const compression = f.beat === "push" ? Math.sin(Math.min(1, f.time / 0.42) * Math.PI) * 0.08 : 0;
      const landing = f.beat === "land" ? 1 - THREE.MathUtils.smootherstep(f.time, 0.12, 0.68) : 0;
      const crouch = landing * 0.42;
      model.updateMatrixWorld(true);
      pelvis.position.copy(pelvis.parent!.worldToLocal(point(f, 0,
        wall ? 0.93 - compression + push * 0.1 : 0.93 - crouch, -landing * 0.08)));
      const spine = required("spine_01");
      const twist = wall ? -0.08 : f.beat === "flight" ? Math.sin(Math.min(1, f.time / 1.15) * Math.PI) * 0.38 : 0;
      spine.quaternion.multiply(rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist));
      spine.quaternion.multiply(rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), wall ? 0.08 - push * 0.2 : -landing * 0.48));
      spine.quaternion.multiply(rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), wall ? Math.sin(f.time * 1.3) * 0.035 : -landing * 0.12));
      const head = bones.get("Head") ?? bones.get("head");
      if (head) head.quaternion.multiply(rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), wall ? 0.08 : 0));
      model.updateMatrixWorld(true);
      for (const limb of limbs) {
        const side = limb.side;
        let foot = point(f, side * 0.18, 0.07, side > 0 ? 0.12 : -0.06);
        let hand = point(f, side * 0.29, 0.86, 0.06);
        if (wall) {
          const drift = Math.sin(f.time * 1.4 + side) * 0.035;
          foot = point(f, side * 0.22, side < 0 ? 0.22 + drift : 0.1 - drift,
            side < 0 ? -0.14 : 0.12);
          hand = point(f, side * 0.4, side < 0 ? 1.05 + drift : 0.82, side < 0 ? 0.12 : 0.18);
          if (side > 0 && (f.beat === "aim" || f.beat === "recoil" || f.beat === "wall")) {
            const ready = f.beat === "wall" ? 0 : THREE.MathUtils.smootherstep(f.time, 0, 0.55);
            const recoil = f.beat === "recoil" ? Math.sin(Math.min(1, f.time / 0.32) * Math.PI) : 0;
            const shoulder = limb.arm[0].getWorldPosition(new THREE.Vector3());
            const armLength = shoulder.distanceTo(limb.arm[1].getWorldPosition(new THREE.Vector3())) +
              limb.arm[1].getWorldPosition(new THREE.Vector3()).distanceTo(limb.arm[2].getWorldPosition(new THREE.Vector3()));
            const aimPoint = shoulder.clone().addScaledVector(f.target.clone().sub(shoulder).normalize(), armLength * 0.91 - recoil * 0.045);
            aimPoint.y += recoil * 0.12;
            hand.lerp(aimPoint, f.beat === "recoil" ? 1 : ready);
          }
          if (f.beat === "push") hand.lerp(point(f, side * 0.3, 1.05, 0.25), push);
        } else if (f.beat === "flight") {
          const tuck = Math.sin(THREE.MathUtils.clamp(f.time / 1.15, 0, 1) * Math.PI);
          const settle = THREE.MathUtils.smootherstep(f.time, 0.78, 1.15);
          foot = point(f, side * (0.2 + tuck * 0.1), 0.07 + tuck * (side < 0 ? 0.48 : 0.3),
            -0.25 * tuck + (side < 0 ? 0.22 : -0.16) * settle);
          hand = point(f, side * (0.38 + tuck * 0.12), side < 0 ? 0.96 - settle * 0.83 : 1.08,
            side < 0 ? 0.34 : -0.22 * tuck);
        } else if (f.beat === "land") {
          foot = point(f, side * 0.28, 0.07, side < 0 ? 0.28 : -0.24);
          hand = point(f, side * 0.36, side < 0 ? 0.86 - landing * 0.77 : 0.9, side < 0 ? 0.44 : -0.18);
        }
        solve(limb.leg, foot, f.forward.clone().addScaledVector(right, side * 0.45));
        solve(limb.arm, hand, right.clone().multiplyScalar(side * 0.28).addScaledVector(up, -1).addScaledVector(f.forward, -0.12));
      }
      const hand = required("hand_r");
      if (wall && f.beat !== "push" && f.socket) {
        const handAt = hand.getWorldPosition(new THREE.Vector3());
        basis.lookAt(handAt, f.beat === "wall" ? point(f, 0.5, 0.2, 0.3) : f.target, up);
        const grip = new THREE.Quaternion().setFromRotationMatrix(basis)
          .multiply(f.socket.quaternion.clone().invert());
        orient(hand, grip);
      }
      for (const [name, bone] of bones) {
        if (/^(index|middle|ring|pinky)_0[1-3]_r$/.test(name))
          bone.quaternion.multiply(rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), name.includes("_02_") ? 0.6 : 0.4));
      }
      const blend = 1 - Math.exp(-Math.max(0, f.delta) * 22);
      for (const { bone } of rest) {
        const previous = previousPose.get(bone);
        if (previous) {
          bone.position.lerpVectors(previous.position, bone.position.clone(), blend);
          bone.quaternion.slerpQuaternions(previous.rotation, bone.quaternion.clone(), blend);
          previous.position.copy(bone.position);
          previous.rotation.copy(bone.quaternion);
        } else previousPose.set(bone, { position: bone.position.clone(), rotation: bone.quaternion.clone() });
      }
      model.updateMatrixWorld(true);
    },
  };
}
