import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadPlayerModel } from '../core/loader.js';
import { createCrowbar } from './items/createCrowbar.js';
import { bakePosedLimb, disposeBakedLimb } from '../helpers/animation/bakePosedLimb.js';

export async function createFirstPersonHands(loader?: GLTFLoader) {
  const gltf = await loadPlayerModel(loader);
  const model = gltf.scene;
  const mixer = new THREE.AnimationMixer(model);
  const idle = THREE.AnimationClip.findByName(gltf.animations, 'Sword_Idle');
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.update();
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

  createArm('l', new THREE.Vector3(-0.23, -0.31, -0.65), new THREE.Vector3(-0.36, -0.62, -0.25), handsGroup);
  const swingPivot = new THREE.Group();
  const restingWrist = new THREE.Vector3(0.25, -0.16, -0.62);
  swingPivot.position.copy(restingWrist); handsGroup.add(swingPivot);
  const rightHand = createArm('r', new THREE.Vector3(), new THREE.Vector3(0.16, -0.39, 0.40), swingPivot);
  const crowbar = createCrowbar();
  crowbar.rotation.set(Math.PI / 2, 0, 0); rightHand.add(crowbar);
  mixer.stopAllAction(); mixer.uncacheRoot(model);

  function update(attackProgress: number | null) {
    const t = attackProgress ?? 1;
    let windup = 0, strike = 0;
    if (t < 0.25) windup = THREE.MathUtils.smoothstep(t, 0, 0.25);
    else if (t < 0.5) { strike = THREE.MathUtils.smoothstep(t, 0.25, 0.5); windup = 1 - strike; }
    else strike = 1 - THREE.MathUtils.smoothstep(t, 0.5, 1);
    swingPivot.rotation.set(0.20 * windup - 0.45 * strike, -0.10 * windup, -0.15 * windup + 0.50 * strike);
    swingPivot.position.set(restingWrist.x - 0.03 * windup - 0.12 * strike, restingWrist.y + 0.03 * windup + 0.05 * strike, restingWrist.z - 0.06 * strike);
  }

  return {
    update,
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