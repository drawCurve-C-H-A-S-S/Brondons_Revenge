import * as THREE from "three";
import bloomstickGlowVertex from "../../shaders/vert/bloomstickGlow.vert.glsl?raw";
import bloomstickGlowFragment from "../../shaders/frag/bloomstickGlow.frag.glsl?raw";
import {
  MELEE_STRIKES,
  SWORD_ATTACK_CLIPS,
} from "../global/finaleChoreography.js";

export type BloomstickAttackName =
  (typeof SWORD_ATTACK_CLIPS)[keyof typeof SWORD_ATTACK_CLIPS];
export const BLOOMSTICK_ATTACK_SPEED = 1.6;
export const BLOOMSTICK_SWING_DURATION =
  MELEE_STRIKES.slash.duration / BLOOMSTICK_ATTACK_SPEED;

/** Discover the rig's authored strikes without treating blocks or idles as attacks. */
export function getBloomstickAttackClips(
  clips: readonly THREE.AnimationClip[],
  requireComplete = true,
) {
  const names = new Set<string>(Object.values(SWORD_ATTACK_CLIPS));
  const attacks = clips.filter(
    (clip): clip is THREE.AnimationClip & { name: BloomstickAttackName } =>
      names.has(clip.name) &&
      Number.isFinite(clip.duration) &&
      clip.duration > 0,
  );
  const missing = [...names].filter(
    (name) => !attacks.some((clip) => clip.name === name),
  );
  if (requireComplete && missing.length)
    throw new Error(
      `Required bloomstick animations are missing: ${missing.join(", ")}`,
    );
  return attacks;
}

export function fitWeaponToHand(
  weapon: THREE.Object3D,
  hand: THREE.Object3D,
  gripHeight: number,
) {
  hand.updateWorldMatrix(true, true);
  const point = (name: string) => {
    const bone = hand.getObjectByName(name);
    return bone
      ? hand.worldToLocal(bone.getWorldPosition(new THREE.Vector3()))
      : null;
  };
  const index = point("index_01_r"),
    pinky = point("pinky_01_r");
  const knuckle = point("middle_01_r"),
    fingertip = point("middle_03_r");
  const axis =
    index && pinky ? index.sub(pinky).normalize() : new THREE.Vector3(0, 0, 1);
  if (axis.lengthSq() < 0.5) axis.set(0, 0, 1);
  const forward = (
    knuckle?.clone() ?? new THREE.Vector3(1, 0, 0)
  ).projectOnPlane(axis);
  if (forward.lengthSq() < 0.0001) forward.set(0, 1, 0).projectOnPlane(axis);
  if (forward.lengthSq() < 0.0001) forward.set(1, 0, 0).projectOnPlane(axis);
  forward.normalize();
  const side = axis.clone().cross(forward).normalize();
  weapon.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(side, axis, forward),
  );
  const grip =
    knuckle && fingertip
      ? knuckle.add(fingertip).multiplyScalar(0.5)
      : new THREE.Vector3();
  weapon.position.copy(grip).addScaledVector(axis, -gripHeight);
  hand.add(weapon);
}

export function fitBloomstickToHand(
  bloomstick: THREE.Object3D,
  hand: THREE.Object3D,
) {
  fitWeaponToHand(bloomstick, hand, 0.14);
}

export function createBloomstick(): THREE.Group {
  const bloomstick = new THREE.Group();
  bloomstick.name = "bloomstick";

  // Hilt
  const hiltMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    metalness: 0.9,
    roughness: 0.2,
  });
  const hilt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.028, 0.28, 12),
    hiltMaterial,
  );
  hilt.position.y = 0.14;
  bloomstick.add(hilt);

  // Hilt details (rings)
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.95,
    roughness: 0.15,
  });
  for (const y of [0.08, 0.2]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.005, 8, 16),
      ringMaterial,
    );
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    bloomstick.add(ring);
  }

  // Emitter
  const emitter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.025, 0.04, 12),
    hiltMaterial,
  );
  emitter.position.y = 0.3;
  bloomstick.add(emitter);

  const beam = createBloomstickBeam();
  beam.position.y = 0.32;
  bloomstick.add(beam);
  bloomstick.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.name !== "blade" &&
      child.name !== "bladeGlow" &&
      child.name !== "bladeCore"
    ) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return bloomstick;
}

export function createBloomstickBeam(): THREE.Group {
  const beam = new THREE.Group();
  beam.name = "BloomstickBeam";
  // Blade (glowing)
  const bladeColor = 0x00ff88;
  const bladeMaterial = new THREE.MeshBasicMaterial({
    color: bladeColor,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8),
    bladeMaterial,
  );
  blade.position.y = 0.45;
  blade.name = "blade";
  beam.add(blade);
  const core = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.011, 0.878, 4, 8),
    new THREE.MeshBasicMaterial({ color: 0xd8ffeb, toneMapped: false }),
  );
  core.position.y = 0.45;
  core.name = "bladeCore";
  beam.add(core);

  // Blade glow (outer)
  const glowMaterial = new THREE.ShaderMaterial({
    vertexShader: bloomstickGlowVertex,
    fragmentShader: bloomstickGlowFragment,
    uniforms: {
      uTint: { value: new THREE.Color(bladeColor) },
      uOpacity: { value: 0.32 },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.9, 16, 1, true),
    glowMaterial,
  );
  glow.position.y = 0.45;
  glow.name = "bladeGlow";
  beam.add(glow);

  // Blade tip light
  const bladeLight = new THREE.PointLight(bladeColor, 1.4, 2.8);
  bladeLight.position.y = 0.45;
  bladeLight.name = "bladeLight";
  beam.add(bladeLight);
  return beam;
}

/** Keep blade, white-hot core, halo and nearby lighting on one per-weapon palette. */
export function setBloomstickColor(root: THREE.Object3D, color: number) {
  if (root.userData.bladeTint === color) return;
  root.userData.bladeTint = color;
  const tint = new THREE.Color(color);
  const coreTint = tint.clone().lerp(new THREE.Color(0xffffff), 0.82);
  root.traverse((node) => {
    if (node instanceof THREE.PointLight && node.name === "bladeLight")
      node.color.copy(tint);
    if (!(node instanceof THREE.Mesh)) return;
    const material = node.material;
    if ((node.name === "blade" || node.name === "bladeCore") && material instanceof THREE.MeshBasicMaterial)
      material.color.copy(node.name === "bladeCore" ? coreTint : tint);
    if (node.name === "bladeGlow" && material instanceof THREE.ShaderMaterial)
      material.uniforms.uTint.value.copy(tint);
  });
}

export function disposeBloomstick(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    (Array.isArray(child.material) ? child.material : [child.material]).forEach(
      (material) => materials.add(material),
    );
  });
  materials.forEach((material) => material.dispose());
  root.removeFromParent();
}
