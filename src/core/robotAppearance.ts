import * as THREE from "three";

export function createVersusToonRamp() {
  const ramp = new THREE.DataTexture(
    new Uint8Array([75, 145, 205, 255]),
    4,
    1,
    THREE.RedFormat,
  );
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export function createVersusToonMaterial(
  original: THREE.Material,
  ramp: THREE.DataTexture,
) {
  const lit = original instanceof THREE.MeshStandardMaterial ||
    original instanceof THREE.MeshToonMaterial ||
    original instanceof THREE.MeshPhongMaterial ||
    original instanceof THREE.MeshLambertMaterial
    ? original : undefined;
  const surface = lit ?? (original instanceof THREE.MeshBasicMaterial
    ? original : undefined);
  return new THREE.MeshToonMaterial({
    name: original.name,
    color: surface?.color ?? 0xffffff,
    emissive: lit?.emissive ?? 0x000000,
    emissiveMap: lit?.emissiveMap ?? null,
    emissiveIntensity: lit?.emissiveIntensity ?? 1,
    map: surface?.map ?? null,
    gradientMap: ramp,
    side: original.side,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
    visible: original.visible,
    clippingPlanes: [],
  });
}

export function applyScavengerAppearance(scene: THREE.Object3D) {
  const ramp = createVersusToonRamp();
  const materials = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const convert = (original: THREE.Material) => {
    let material = materials.get(original);
    if (!material) {
      material = createVersusToonMaterial(original, ramp);
      materials.set(original, material);
    }
    return material;
  };
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.material = Array.isArray(node.material)
      ? node.material.map(convert)
      : convert(node.material);
  });
  materials.forEach((_replacement, original) => original.dispose());
}

export function applyDroneGlow(scene: THREE.Object3D) {
  const materials = new Set<THREE.MeshStandardMaterial>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial))
        throw new Error(`Unsupported drone surface material: ${material.type}`);
      materials.add(material);
    }
  });
  const blue = new THREE.Color(0x38bcff).multiplyScalar(0.16);
  for (const material of materials) {
    material.emissive.multiplyScalar(material.emissiveIntensity).add(blue);
    material.emissiveIntensity = 1;
  }
}
