import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadPlayerModel, loadToolModel } from '../core/loader.js';
import { createCrowbar } from './items/createCrowbar.js';
import { createLightsaber, setLightsaberBeamVisible } from './items/createLightsaber.js';
import { bakePosedLimb, disposeBakedLimb } from '../helpers/animation/bakePosedLimb.js';

export type FirstPersonWeapon = 'unarmed' | 'crowbar' | 'pistol' | 'lightsaber';

export async function createFirstPersonHands(loader?: GLTFLoader) {
  const pistolAsset = await loadToolModel('Gun_Revolver');
  const gltf = await loadPlayerModel(loader);
  const model = gltf.scene;
  const mixer = new THREE.AnimationMixer(model);
  const idle = THREE.AnimationClip.findByName(gltf.animations, 'Sword_Idle');
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update();
  });

  const viewScene = new THREE.Scene();
  const viewCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  const handsGroup = new THREE.Group();
  viewScene.add(viewCamera);
  viewCamera.add(handsGroup);
  viewScene.add(new THREE.AmbientLight(0xffffff, 1.5));

  function createArm(side: 'l' | 'r', wristPosition: THREE.Vector3, elbowPosition: THREE.Vector3, parent: THREE.Group) {
    const hand = model.getObjectByName(`hand_${side}`);
    const elbow = model.getObjectByName(`lowerarm_${side}`);
    if (!hand || !elbow) throw new Error(`MC.glb is missing the ${side} arm`);
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const sourceDirection = elbow.getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
    const arm = bakePosedLimb(model, `lowerarm_${side}`, wrist);
    arm.position.copy(wristPosition);
    arm.quaternion.setFromUnitVectors(sourceDirection, elbowPosition.clone().sub(wristPosition).normalize());
    parent.add(arm);
    const grip = new THREE.Group();
    grip.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()));
    if (side === 'r') {
      const knuckle = model.getObjectByName('middle_01_r');
      const curledFinger = model.getObjectByName('middle_03_r');
      if (knuckle && curledFinger) grip.position.copy(knuckle.getWorldPosition(new THREE.Vector3())).add(curledFinger.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5).sub(wrist);
    }
    arm.add(grip);
    return grip;
  }

  const leftPivot = new THREE.Group();
  const leftWrist = new THREE.Vector3(-0.23, -0.31, -0.65);
  leftPivot.position.copy(leftWrist); handsGroup.add(leftPivot);
  createArm('l', new THREE.Vector3(), new THREE.Vector3(-0.13, -0.31, 0.4), leftPivot);
  const swingPivot = new THREE.Group();
  const restingWrist = new THREE.Vector3(0.25, -0.16, -0.62);
  swingPivot.position.copy(restingWrist); handsGroup.add(swingPivot);
  const rightHand = createArm('r', new THREE.Vector3(), new THREE.Vector3(0.16, -0.39, 0.40), swingPivot);
  viewScene.updateMatrixWorld(true);
  const gripQuat = rightHand.getWorldQuaternion(new THREE.Quaternion());
  const handToPivot = swingPivot.matrixWorld.clone().invert().multiply(rightHand.matrixWorld).invert();
  const seatDown = new THREE.Vector3(0, -1, 0).applyQuaternion(gripQuat.clone().invert());
  function mount(object: THREE.Object3D, forwardAxis: THREE.Vector3, upAxis: THREE.Vector3,
    forward: THREE.Vector3, up: THREE.Vector3, anchor = new THREE.Vector3(), seat = 0) {
    const y = forward.clone().normalize();
    const z = up.clone().addScaledVector(y, -up.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const localX = new THREE.Vector3().crossVectors(forwardAxis, upAxis);
    const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(localX, forwardAxis, upAxis));
    object.quaternion.copy(gripQuat.clone().invert().multiply(target).multiply(local.invert()));
    object.position.copy(anchor.clone().applyQuaternion(object.quaternion).negate()).addScaledVector(seatDown, seat);
  }

  const crowbar = createCrowbar();
  const lightsaber = createLightsaber(), pistol = pistolAsset.scene;
  const carryForward = new THREE.Vector3(-0.08, 0.10, -1);
  const meleeForward = new THREE.Vector3(-0.12, 0.65, -1);
  const axisY = new THREE.Vector3(0, 1, 0), axisZ = new THREE.Vector3(0, 0, 1);
  mount(crowbar, axisY, axisZ, meleeForward, new THREE.Vector3(0.4, 0.55, 0.35), new THREE.Vector3(), 0.09);
  mount(lightsaber, axisY, axisZ, meleeForward, axisY, new THREE.Vector3(0, 0.12, 0), 0.09);
  mount(pistol, new THREE.Vector3(-1, 0, 0), axisY, carryForward, axisY, new THREE.Vector3(0.04, -0.06, 0), 0.10);
  rightHand.add(crowbar, lightsaber, pistol);
  const socketForward = carryForward.clone().normalize();
  const socketUp = axisY.clone().addScaledVector(socketForward, -socketForward.y).normalize();
  const socketQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3().crossVectors(socketUp, socketForward.clone().negate()), socketUp, socketForward.clone().negate()));
  mixer.stopAllAction(); mixer.uncacheRoot(model);

  let weapon: FirstPersonWeapon = 'unarmed', recoil = 0;
  const saberPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), valid: false };
  const saberMatrix = new THREE.Matrix4(), mountMatrix = new THREE.Matrix4();
  const pivotPosition = new THREE.Vector3(), pivotQuaternion = new THREE.Quaternion(), pivotScale = new THREE.Vector3();
  const unit = new THREE.Vector3(1, 1, 1);
  const pistolWrist = new THREE.Vector3(0.16, -0.2, -0.6), supportOffset = new THREE.Vector3(-0.07, -0.05, 0.05);

  function setWeapon(equipped: FirstPersonWeapon) {
    weapon = equipped;
    crowbar.visible = weapon === 'crowbar';
    pistol.visible = weapon === 'pistol';
    lightsaber.visible = weapon === 'lightsaber';
  }
  setWeapon('unarmed');

  function setLightsaberPose(position: THREE.Vector3 | null, quaternion?: THREE.Quaternion, mainFov = viewCamera.fov) {
    if (!position || !quaternion) { saberPose.valid = false; return; }
    const scale = Math.tan(THREE.MathUtils.degToRad(viewCamera.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(mainFov * 0.5));
    saberPose.position.set(position.x * scale, position.y * scale, position.z);
    saberPose.quaternion.copy(quaternion);
    saberPose.valid = true;
  }

  function update(attackProgress: number | null, move: 'crowbar' | 'jab' | 'cross' | 'hook' = 'crowbar') {
    if (weapon === 'pistol') {
      swingPivot.position.copy(pistolWrist); swingPivot.position.z += recoil * 0.04;
      swingPivot.rotation.set(recoil * 0.12, 0, 0);
      rightHand.getWorldPosition(leftPivot.position).add(supportOffset);
      leftPivot.rotation.set(0.35 + recoil * 0.12, -0.35, -1, 'YXZ');
      return;
    }
    leftPivot.position.copy(leftWrist); leftPivot.rotation.set(0, 0, 0);
    swingPivot.position.copy(restingWrist); swingPivot.rotation.set(0, 0, 0);
    if (weapon === 'lightsaber' && saberPose.valid && attackProgress !== null) {
      const weight = THREE.MathUtils.smoothstep(attackProgress, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(attackProgress, 0.85, 1));
      lightsaber.updateMatrix();
      mountMatrix.copy(lightsaber.matrix).invert();
      // saber = fist * mount, then convert the fist transform back to its arm pivot.
      saberMatrix.compose(saberPose.position, saberPose.quaternion, unit).multiply(mountMatrix).multiply(handToPivot);
      saberMatrix.decompose(pivotPosition, pivotQuaternion, pivotScale);
      swingPivot.position.lerp(pivotPosition, weight); swingPivot.quaternion.slerp(pivotQuaternion, weight);
      return;
    }
    const t = attackProgress ?? 1;
    let windup = 0, strike = 0;
    if (t < 0.25) windup = THREE.MathUtils.smoothstep(t, 0, 0.25);
    else if (t < 0.5) { strike = THREE.MathUtils.smoothstep(t, 0.25, 0.5); windup = 1 - strike; }
    else strike = 1 - THREE.MathUtils.smoothstep(t, 0.5, 1);
    if (move !== 'crowbar') {
      const pivot = move === 'jab' ? leftPivot : swingPivot;
      const wrist = move === 'jab' ? leftWrist : restingWrist;
      const side = move === 'jab' ? -1 : 1, hook = move === 'hook';
      pivot.position.set(wrist.x - side * strike * (hook ? 0.25 : 0.1),
        wrist.y + strike * 0.08, wrist.z + windup * 0.1 - strike * (hook ? 0.25 : 0.45));
      pivot.rotation.set(-strike * 0.1, side * (windup * 0.15 - strike * (hook ? 0.65 : 0.08)), side * strike * 0.12);
      return;
    }
    swingPivot.rotation.set(0.20 * windup - 0.45 * strike, -0.10 * windup, -0.15 * windup + 0.50 * strike);
    swingPivot.position.set(restingWrist.x - 0.03 * windup - 0.12 * strike, restingWrist.y + 0.03 * windup + 0.05 * strike, restingWrist.z - 0.06 * strike);
  }

  return {
    update,
    setWeapon,
    setLightsaberPose,
    setLightsaberBeamVisible: (visible: boolean) => setLightsaberBeamVisible(lightsaber, visible),
    setRecoil(amount: number) { recoil = THREE.MathUtils.clamp(amount, 0, 1); },
    getMuzzle(camera: THREE.PerspectiveCamera, position: THREE.Vector3, orientation: THREE.Quaternion) {
      rightHand.getWorldPosition(position);
      const scale = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(viewCamera.fov * 0.5));
      position.x *= scale; position.y *= scale;
      orientation.copy(socketQuat);
    },
    render(renderer: THREE.WebGLRenderer) {
      const oldAspect = viewCamera.aspect;
      viewCamera.aspect = renderer.domElement.width / renderer.domElement.height;
      if (oldAspect !== viewCamera.aspect) viewCamera.updateProjectionMatrix();
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      try { renderer.clearDepth(); renderer.render(viewScene, viewCamera); } finally { renderer.autoClear = oldAutoClear; }
    },
    dispose() {
      disposeBakedLimb(handsGroup);
    },
  };
}

export type FirstPersonHands = Awaited<ReturnType<typeof createFirstPersonHands>>;