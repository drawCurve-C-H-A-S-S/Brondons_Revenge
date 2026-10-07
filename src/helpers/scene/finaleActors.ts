import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadSubjectModel } from '../../core/loader.js';
import { CABINS } from '../../scenes/living quarters/layout.js';
import { createStudentBoardingClip, createStudentPoseClip } from '../../scripts/mechAnimation.js';

export const QUINTET = CABINS.filter(cabin => cabin.role === 'student').map((cabin, index) => ({
  name: cabin.occupant, color: [0xa571ff, 0xffbb45, 0xff4f9c, 0x43daff, 0x70ff98][index],
}));

export function normalizeFinaleActor(source: THREE.Object3D, height: number) {
  source.updateMatrixWorld(true);
  source.traverse(node => { if (node instanceof THREE.SkinnedMesh) { node.skeleton.update(); node.computeBoundingBox(); } });
  const bounds = new THREE.Box3().setFromObject(source), sourceHeight = bounds.getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) throw new Error('Finale model has invalid or empty bounds');
  const wrapper = new THREE.Group(), scale = height / sourceHeight, center = bounds.getCenter(new THREE.Vector3());
  wrapper.add(source); wrapper.scale.setScalar(scale);
  wrapper.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  source.traverse(node => { if (node instanceof THREE.Mesh) { node.frustumCulled = false; node.castShadow = node.receiveShadow = true; } });
  return wrapper;
}

export function captureFinaleResources(root: THREE.Object3D, shared = false) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { dispose() {
    root.removeFromParent();
    root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
    if (!shared) {
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
    }
  } };
}

export function createFinaleStudents(loadModel = loadSubjectModel) {
  const root = new THREE.Group(); root.name = 'TheQuintet';
  type Student = {
    root: THREE.Group; model: THREE.Object3D; mixer: THREE.AnimationMixer;
    actions: Record<'walk' | 'idle' | 'talk' | 'pose' | 'board', THREE.AnimationAction>; mode: string;
  };
  const students: Student[] = [];
  let disposed = false, sourceResources: ReturnType<typeof captureFinaleResources> | null = null;
  const badgeGeometry = new THREE.OctahedronGeometry(0.055), badges: THREE.MeshBasicMaterial[] = [];
  const loaded = loadModel().then(asset => {
    sourceResources = captureFinaleResources(asset.scene);
    if (disposed) { sourceResources.dispose(); return; }
    function required(name: string) {
      const clip = asset.animations.find(animation => animation.name === name);
      if (!clip) throw new Error(`Subject model is missing the ${name} animation`);
      return clip;
    }
    const walk = required('Walk_Loop'), idle = required('Idle_Loop'), talk = required('Idle_Talking_Loop');
    QUINTET.forEach((student, i) => {
      const actor = new THREE.Group(); actor.name = student.name;
      const model = clone(asset.scene); actor.add(normalizeFinaleActor(model, 1.83)); root.add(actor);
      const mixer = new THREE.AnimationMixer(model);
      const actions = { walk: mixer.clipAction(walk), idle: mixer.clipAction(idle), talk: mixer.clipAction(talk),
        pose: mixer.clipAction(createStudentPoseClip(model, i)), board: mixer.clipAction(createStudentBoardingClip(model)) };
      actions.pose.setLoop(THREE.LoopOnce, 1); actions.pose.clampWhenFinished = true;
      actions.board.setLoop(THREE.LoopOnce, 1); actions.board.clampWhenFinished = true;
      const badgeMaterial = new THREE.MeshBasicMaterial({ color: student.color, toneMapped: false }); badges.push(badgeMaterial);
      const badge = new THREE.Mesh(badgeGeometry, badgeMaterial); badge.position.set(-0.2, 1.35, 0.2); actor.add(badge);
      students.push({ root: actor, model, mixer, actions, mode: '' });
    });
  });
  return { root, students, loaded,
    animate(index: number, mode: keyof Student['actions'], time: number) {
      const student = students[index]; if (!student) return;
      if (student.mode !== mode) { student.mixer.stopAllAction(); student.actions[mode].reset().play(); student.mode = mode; }
      const action = student.actions[mode];
      action.time = mode === 'pose' || mode === 'board' ? Math.min(Math.max(0, time), action.getClip().duration) : Math.max(0, time) % action.getClip().duration;
      action.paused = true; student.mixer.update(0);
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const student of students) {
        student.mixer.stopAllAction(); student.mixer.uncacheRoot(student.model);
        student.model.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      }
      root.removeFromParent(); sourceResources?.dispose(); badgeGeometry.dispose(); badges.forEach(material => material.dispose());
    },
  };
}
