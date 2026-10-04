import * as THREE from 'three';
import { loadPlayerModel } from '../core/loader.js';
import { bakePosedLimb, disposeBakedLimb } from '../helpers/animation/bakePosedLimb.js';

export async function createPointingHand() {
  const gltf = await loadPlayerModel(), model = gltf.scene;
  const clip = THREE.AnimationClip.findByName(gltf.animations, 'Interact');
  if (!clip) throw new Error('MC.glb is missing the Interact animation');
  const mixer = new THREE.AnimationMixer(model);
  try {
    mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
    mixer.setTime(clip.duration / 2);
    model.updateMatrixWorld(true);
    const hand = model.getObjectByName('hand_r'), index = model.getObjectByName('index_01_r');
    const tip = model.getObjectByName('index_04_leaf_r');
    if (!hand || !index || !tip) throw new Error('MC.glb is missing the pointing-hand bones');
    const wrist = hand.getWorldPosition(new THREE.Vector3()), fingertip = tip.getWorldPosition(new THREE.Vector3());
    const direction = fingertip.clone().sub(index.getWorldPosition(new THREE.Vector3()));
    if (direction.lengthSq() < 0.000001) throw new Error('The Interact animation has an invalid pointing-hand pose');
    const limb = bakePosedLimb(model, 'hand_r', wrist);
    limb.quaternion.setFromUnitVectors(direction.normalize(), new THREE.Vector3(0, 0.72, -0.69).normalize());
    limb.position.copy(fingertip.sub(wrist).applyQuaternion(limb.quaternion)).negate();
    const root = new THREE.Group(); root.name = 'BulkheadPointingHand'; root.add(limb); root.visible = false;
    root.userData.minimap = false;
    return { root, dispose: () => disposeBakedLimb(root) };
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(model);
    const skeletons = new Set<THREE.Skeleton>();
    model.traverse(mesh => { if (mesh instanceof THREE.SkinnedMesh) skeletons.add(mesh.skeleton); });
    skeletons.forEach(skeleton => skeleton.dispose());
  }
}

export type PointingHand = Awaited<ReturnType<typeof createPointingHand>>;
