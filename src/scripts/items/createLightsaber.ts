import * as THREE from 'three';
import saberGlowVertex from '../../shaders/saberGlow.vert.glsl?raw';
import saberGlowFragment from '../../shaders/saberGlow.frag.glsl?raw';
import { MELEE_STRIKES, SWORD_ATTACK_CLIPS } from '../finaleChoreography.js';

export type LightsaberAttackName = typeof SWORD_ATTACK_CLIPS[keyof typeof SWORD_ATTACK_CLIPS];
export const LIGHTSABER_SWING_DURATION = MELEE_STRIKES.slash.duration;

/** Discover the rig's authored strikes without treating blocks or idles as attacks. */
export function getLightsaberAttackClips(clips: readonly THREE.AnimationClip[], requireComplete = true) {
  const names = new Set<string>(Object.values(SWORD_ATTACK_CLIPS));
  const attacks = clips.filter((clip): clip is THREE.AnimationClip & { name: LightsaberAttackName } =>
    names.has(clip.name) && Number.isFinite(clip.duration) && clip.duration > 0);
  const missing = [...names].filter(name => !attacks.some(clip => clip.name === name));
  if (requireComplete && missing.length) throw new Error(`Required lightsaber animations are missing: ${missing.join(', ')}`);
  return attacks;
}

export function fitWeaponToHand(weapon: THREE.Object3D, hand: THREE.Object3D, gripHeight: number) {
  hand.updateWorldMatrix(true, true);
  const point = (name: string) => {
    const bone = hand.getObjectByName(name);
    return bone ? hand.worldToLocal(bone.getWorldPosition(new THREE.Vector3())) : null;
  };
  const index = point('index_01_r'), pinky = point('pinky_01_r');
  const knuckle = point('middle_01_r'), fingertip = point('middle_03_r');
  const axis = index && pinky ? index.sub(pinky).normalize() : new THREE.Vector3(0, 0, 1);
  if (axis.lengthSq() < 0.5) axis.set(0, 0, 1);
  const forward = (knuckle?.clone() ?? new THREE.Vector3(1, 0, 0)).projectOnPlane(axis);
  if (forward.lengthSq() < 0.0001) forward.set(0, 1, 0).projectOnPlane(axis);
  if (forward.lengthSq() < 0.0001) forward.set(1, 0, 0).projectOnPlane(axis);
  forward.normalize();
  const side = axis.clone().cross(forward).normalize();
  weapon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, axis, forward));
  const grip = knuckle && fingertip ? knuckle.add(fingertip).multiplyScalar(0.5) : new THREE.Vector3();
  weapon.position.copy(grip).addScaledVector(axis, -gripHeight);
  hand.add(weapon);
}

export function fitLightsaberToHand(lightsaber: THREE.Object3D, hand: THREE.Object3D) {
  fitWeaponToHand(lightsaber, hand, 0.14);
}

export function createLightsaber(): THREE.Group {
  const lightsaber = new THREE.Group();
  lightsaber.name = 'lightsaber';

  // Hilt
  const hiltMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.9, roughness: 0.2 });
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.28, 12), hiltMaterial);
  hilt.position.y = 0.14;
  lightsaber.add(hilt);

  // Hilt details (rings)
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.95, roughness: 0.15 });
  for (const y of [0.08, 0.2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 8, 16), ringMaterial);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    lightsaber.add(ring);
  }

  // Emitter
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.04, 12), hiltMaterial);
  emitter.position.y = 0.3;
  lightsaber.add(emitter);

  // Blade (glowing)
  const bladeColor = 0x00ff88;
  const bladeMaterial = new THREE.MeshBasicMaterial({ color: bladeColor, transparent: true, opacity: 0.8,
    depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), bladeMaterial);
  blade.position.y = 0.77;
  blade.name = 'blade';
  lightsaber.add(blade);
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.878, 4, 8),
    new THREE.MeshBasicMaterial({ color: 0xd8ffeb, toneMapped: false }));
  core.position.y = 0.77; core.name = 'bladeCore'; lightsaber.add(core);

  // Blade glow (outer)
  const glowMaterial = new THREE.ShaderMaterial({ vertexShader: saberGlowVertex, fragmentShader: saberGlowFragment,
    uniforms: { uTint: { value: new THREE.Color(bladeColor) }, uOpacity: { value: 0.32 } },
    transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.9, 16, 1, true), glowMaterial);
  glow.position.y = 0.77;
  glow.name = 'bladeGlow';
  lightsaber.add(glow);

  // Blade tip light
  const bladeLight = new THREE.PointLight(bladeColor, 1.4, 2.8);
  bladeLight.position.y = 0.77;
  bladeLight.name = 'bladeLight';
  lightsaber.add(bladeLight);

  lightsaber.traverse(child => {
    if (child instanceof THREE.Mesh && child.name !== 'blade' && child.name !== 'bladeGlow' && child.name !== 'bladeCore') {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return lightsaber;
}

export function disposeLightsaber(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => materials.add(material));
  });
  materials.forEach(material => material.dispose());
  root.removeFromParent();
}
