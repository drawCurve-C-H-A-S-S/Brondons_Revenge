import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadPlayerModel } from '../core/loader.js';
import { createCrowbar } from './items/createCrowbar.js';

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
    if (!hand || !elbow) throw new Error(`Subject.glb is missing the ${side} arm`);
    const armBones = new Set<THREE.Object3D>();
    elbow.traverse(bone => armBones.add(bone));
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const sourceDirection = elbow.getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
    const arm = new THREE.Group();
    arm.position.copy(wristPosition);
    arm.quaternion.setFromUnitVectors(sourceDirection, elbowPosition.clone().sub(wristPosition).normalize());
    parent.add(arm);
    let triangleCount = 0;

    model.traverse(node => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const source = mesh.geometry;
      const positions = source.getAttribute('position');
      const skinIndex = source.getAttribute('skinIndex');
      const skinWeight = source.getAttribute('skinWeight');
      if (!skinIndex || !skinWeight) return;
      const included = new Uint8Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) {
          if (armBones.has(mesh.skeleton.bones[skinIndex.getComponent(i, j)])) weight += skinWeight.getComponent(i, j);
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
        if (included[a] && included[b] && included[c]) {
          indices.push(a, b, c);
        }
      }
      if (!indices.length) return;
      triangleCount += indices.length / 3;
      const geometry = source.clone();
      geometry.setIndex(indices); geometry.clearGroups();
      const vertex = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, vertex);
        vertex.applyMatrix4(mesh.matrixWorld).sub(wrist);
        geometry.getAttribute('position').setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight'); geometry.computeVertexNormals();
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(item => { const clone = item.clone(); clone.side = THREE.DoubleSide; return clone; })
        : (() => { const clone = mesh.material.clone(); clone.side = THREE.DoubleSide; return clone; })();
      arm.add(new THREE.Mesh(geometry, material));
    });
    if (!triangleCount) throw new Error(`Subject.glb has no ${side} arm triangles`);
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
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      handsGroup.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        const list = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        list.forEach(material => materials.add(material));
      });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
      handsGroup.removeFromParent();
    },
  };
}