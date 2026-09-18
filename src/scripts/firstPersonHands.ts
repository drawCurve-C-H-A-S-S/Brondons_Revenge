import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createHeldItemHandler } from './items/heldItemHandler.js';
import { itemRegistry } from './items/itemRegistry.js';
import subjectModelUrl from '../assets/models/Subject.glb';

export async function createFirstPersonHands(loader = new GLTFLoader()) {
  const gltf = await loader.loadAsync(subjectModelUrl);
  const model = gltf.scene;
  const mixer = new THREE.AnimationMixer(model);
  const idle = THREE.AnimationClip.findByName(gltf.animations, 'Sword_Idle');
  if (!idle) throw new Error('Subject.glb is missing Sword_Idle');
  mixer.clipAction(idle).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.update();
  });

  // The viewmodel has its own scene so it cannot enter the mirror or world depth buffer.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  const handsGroup = new THREE.Group();
  handsGroup.name = 'FirstPersonHands';
  scene.add(camera);
  camera.add(handsGroup);
  // Single ambient light is much cheaper than hemisphere + directional
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  function createArm(side: 'l' | 'r', wristPosition: THREE.Vector3, elbowPosition: THREE.Vector3, parent: THREE.Group) {
    const hand = model.getObjectByName(`hand_${side}`);
    const elbow = model.getObjectByName(`lowerarm_${side}`);
    if (!hand || !elbow) throw new Error(`Subject.glb is missing the ${side} arm`);
    const armBones = new Set<THREE.Object3D>();
    // Only forearms and hands belong in the viewmodel; shoulders enter the camera during a swing.
    elbow.traverse(bone => armBones.add(bone));
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const sourceDirection = elbow.getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
    const arm = new THREE.Group();
    arm.name = `SubjectArm_${side}`;
    arm.position.copy(wristPosition);
    const targetDirection = elbowPosition.clone().sub(wristPosition).normalize();
    arm.quaternion.setFromUnitVectors(sourceDirection, targetDirection);
    if (side === 'r') {
      // Orient the entire posed arm, not the wrist, to preserve the original grip.
      const up = new THREE.Vector3(0, 1, 0);
      const shaftDirection = up.clone()
        .applyEuler(new THREE.Euler(...itemRegistry.crowbar.rotation))
        .applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
      arm.quaternion.setFromUnitVectors(shaftDirection.normalize(), up);
      const alignedElbow = sourceDirection.clone().applyQuaternion(arm.quaternion);
      const yaw = Math.atan2(targetDirection.x, targetDirection.z) - Math.atan2(alignedElbow.x, alignedElbow.z);
      arm.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
    }
    parent.add(arm);
    let triangleCount = 0;

    model.traverse(node => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const source = mesh.geometry;
      const positions = source.getAttribute('position');
      const skinIndex = source.getAttribute('skinIndex');
      const skinWeight = source.getAttribute('skinWeight');
      const included = new Uint8Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) {
          if (armBones.has(mesh.skeleton.bones[skinIndex.getComponent(i, j)])) {
            weight += skinWeight.getComponent(i, j);
          }
        }
        included[i] = weight >= 0.5 ? 1 : 0;
      }
      const indices: number[] = [];
      const index = source.getIndex();
      const count = index?.count ?? positions.count;
      for (let i = 0; i < count; i += 3) {
        const a = index ? index.getX(i) : i;
        const b = index ? index.getX(i + 1) : i + 1;
        const c = index ? index.getX(i + 2) : i + 2;
        if (included[a] && included[b] && included[c]) indices.push(a, b, c);
      }
      if (!indices.length) return;
      triangleCount += indices.length / 3;
      const geometry = source.clone();
      geometry.setIndex(indices);
      geometry.clearGroups();
      const bakedPositions = geometry.getAttribute('position');
      const vertex = new THREE.Vector3();
      // Bake with the original skeleton and inverse bind matrices before removing skin attributes.
      for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, vertex);
        vertex.applyMatrix4(mesh.matrixWorld).sub(wrist);
        bakedPositions.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      geometry.deleteAttribute('skinIndex');
      geometry.deleteAttribute('skinWeight');
      geometry.computeVertexNormals();
      // Clone so viewmodel changes never touch the world model's materials.
      // DoubleSide: the glove/suit shells are open at the grip and wrist, and
      // mid-swing the camera looks into those openings — backface culling
      // would make the hand vanish.
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(m => { const clone = m.clone(); clone.side = THREE.DoubleSide; return clone; })
        : (() => { const clone = mesh.material.clone(); clone.side = THREE.DoubleSide; return clone; })();
      const armMesh = new THREE.Mesh(geometry, material);
      armMesh.name = `${mesh.name}_${side}`;
      arm.add(armMesh);
    });
    if (!triangleCount) throw new Error(`Subject.glb has no ${side} arm triangles`);
    const grip = new THREE.Group();
    grip.name = `Grip_${side}`;
    grip.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()));
    if (side === 'r') {
      const knuckle = model.getObjectByName('middle_01_r');
      const curledFinger = model.getObjectByName('middle_03_r');
      if (!knuckle || !curledFinger) throw new Error('Subject.glb is missing the right-hand grip bones');
      // The hand bone is at the wrist; the shaft belongs inside the curled fingers.
      grip.position.copy(knuckle.getWorldPosition(new THREE.Vector3()))
        .add(curledFinger.getWorldPosition(new THREE.Vector3()))
        .multiplyScalar(0.5).sub(wrist);
    }
    arm.add(grip);
    return grip;
  }

  createArm('l', new THREE.Vector3(-0.23, -0.31, -0.65), new THREE.Vector3(-0.36, -0.62, -0.25), handsGroup);
  const swingPivot = new THREE.Group();
  swingPivot.name = 'CrowbarSwing';
  const restingWrist = new THREE.Vector3(0.25, -0.16, -0.62);
  swingPivot.position.copy(restingWrist);
  handsGroup.add(swingPivot);
  const rightHand = createArm('r', new THREE.Vector3(), new THREE.Vector3(0.16, -0.39, 0.40), swingPivot);
  const heldItems = createHeldItemHandler(rightHand);
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse(node => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) {
      mesh.geometry.dispose();
      skeletons.add(mesh.skeleton);
    }
  });
  skeletons.forEach(skeleton => skeleton.dispose());

  function update(attackProgress: number | null, bob: { x: number; y: number; pitch: number } = { x: 0, y: 0, pitch: 0 }) {
    // Viewmodel sway follows head bob at reduced amplitude.
    handsGroup.position.set(bob.x * 0.5, bob.y * 0.5, 0);
    handsGroup.rotation.z = bob.pitch * 0.5;
    const t = attackProgress ?? 1;
    let windup = 0;
    let strike = 0;
    if (t < 0.25) {
      windup = THREE.MathUtils.smoothstep(t, 0, 0.25);
    } else if (t < 0.5) {
      strike = THREE.MathUtils.smoothstep(t, 0.25, 0.5);
      windup = 1 - strike;
    } else {
      strike = 1 - THREE.MathUtils.smoothstep(t, 0.5, 1);
    }
    swingPivot.rotation.set(0.20 * windup - 0.45 * strike, -0.10 * windup, -0.15 * windup + 0.50 * strike);
    // The hand arcs upward and inward through the strike so it never dips
    // below the bottom edge of the frame (that is what hid it before).
    swingPivot.position.set(
      restingWrist.x - 0.03 * windup - 0.12 * strike,
      restingWrist.y + 0.03 * windup + 0.05 * strike,
      restingWrist.z - 0.06 * strike,
    );
  }

  function render(renderer: THREE.WebGLRenderer, aspect: number) {
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.clearDepth();
      renderer.render(scene, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  function dispose() {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const root of [model, handsGroup]) root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach(material => materials.add(material));
    });
    materials.forEach(material => {
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
      material.dispose();
    });
    textures.forEach(texture => texture.dispose());
    heldItems.dispose();
    handsGroup.removeFromParent();
  }

  return { handsGroup, heldItems, update, render, dispose };
}
