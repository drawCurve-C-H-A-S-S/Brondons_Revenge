import * as THREE from 'three';

export type LightsaberAttackName = `Sword_${string}`;
export const LIGHTSABER_SWING_DURATION = 0.35;

/** Discover the rig's authored strikes without treating blocks or idles as attacks. */
export function getLightsaberAttackClips(clips: readonly THREE.AnimationClip[]) {
  return clips.filter((clip): clip is THREE.AnimationClip & { name: LightsaberAttackName } =>
    clip.name.startsWith('Sword_') && /attack|slash|stab|thrust|combo|swing|chop|spin/i.test(clip.name)
    && !/block|parry|react|hit|death|(?:^|_)RM(?:_|$)|root.?motion/i.test(clip.name)
    && Number.isFinite(clip.duration) && clip.duration > 0
  ).sort((a, b) => a.name.localeCompare(b.name));
}

/** Fit the hilt inside the curled fist, with the blade exiting on the thumb side. */
export function fitLightsaberToHand(lightsaber: THREE.Object3D, hand: THREE.Object3D) {
  hand.updateWorldMatrix(true, true);
  const point = (name: string) => {
    const bone = hand.getObjectByName(name);
    return bone ? hand.worldToLocal(bone.getWorldPosition(new THREE.Vector3())) : null;
  };
  const index = point('index_01_r'), pinky = point('pinky_01_r');
  const knuckle = point('middle_01_r'), fingertip = point('middle_03_r');
  const axis = index && pinky ? index.sub(pinky).normalize() : new THREE.Vector3(0, 0, 1);
  if (axis.lengthSq() < 0.5) axis.set(0, 0, 1);
  lightsaber.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const grip = knuckle && fingertip ? knuckle.add(fingertip).multiplyScalar(0.5) : new THREE.Vector3();
  // The model origin is the pommel; its 28 cm hilt must straddle the grip.
  lightsaber.position.copy(grip).addScaledVector(axis, -0.14);
  hand.add(lightsaber);
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
  const bladeMaterial = new THREE.MeshBasicMaterial({ color: bladeColor, transparent: true, opacity: 0.9, depthWrite: false });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), bladeMaterial);
  blade.position.y = 0.77;
  blade.name = 'blade';
  lightsaber.add(blade);

  // Blade glow (outer)
  const glowMaterial = new THREE.MeshBasicMaterial({ color: bladeColor, transparent: true, opacity: 0.3, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), glowMaterial);
  glow.position.y = 0.77;
  glow.name = 'bladeGlow';
  lightsaber.add(glow);

  // Blade tip light
  const bladeLight = new THREE.PointLight(bladeColor, 2, 3);
  bladeLight.position.y = 0.77;
  bladeLight.name = 'bladeLight';
  lightsaber.add(bladeLight);

  lightsaber.traverse(child => {
    if (child instanceof THREE.Mesh && child.name !== 'blade' && child.name !== 'bladeGlow') {
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
