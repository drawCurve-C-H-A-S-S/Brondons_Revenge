import * as THREE from 'three';

export type RecoveryPickupKind = 'health' | 'shield';

export function createRecoveryPickup(kind: RecoveryPickupKind, position: THREE.Vector3,
  { compact = false, illuminate = true }: { compact?: boolean; illuminate?: boolean } = {}) {
  const root = new THREE.Group();
  root.name = kind === 'health' ? 'HealthPickup' : 'ShieldPickup';
  root.position.copy(position);
  const origin = position.clone();
  const material = new THREE.MeshStandardMaterial({
    color: kind === 'health' ? 0x2ecc40 : 0x3498db,
    emissive: kind === 'health' ? 0x7cf25a : 0x5dade2,
    emissiveIntensity: 1.5,
    metalness: kind === 'health' ? 0.4 : 0.6,
    roughness: 0.3,
    transparent: kind === 'shield',
    opacity: kind === 'shield' ? 0.9 : 1,
  });
  if (kind === 'health') {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), material));
    const crossMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8,
    });
    for (const size of [[0.35, 0.08, 0.12], [0.12, 0.08, 0.35]] as const) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(...size), crossMaterial);
      cross.position.y = 0.21;
      root.add(cross);
    }
  } else {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), material);
    crystal.castShadow = true;
    root.add(crystal);
  }
  if (compact) root.scale.setScalar(0.62);
  if (illuminate) {
    const light = new THREE.PointLight(material.emissive, 2, 4);
    if (kind === 'health') light.position.y = 0.3;
    root.add(light);
  }
  return {
    root,
    update(time: number) {
      root.rotation.y = time * (kind === 'health' ? 1.2 : 1.5);
      if (kind === 'shield') root.rotation.x = Math.sin(time * 2) * 0.2;
      root.position.y = origin.y + Math.sin(time * (kind === 'health' ? 2 : 2.5)) * (compact ? 0.04 : kind === 'health' ? 0.1 : 0.15);
      material.emissiveIntensity = (kind === 'health' ? 1.3 : 1.2) + Math.sin(time * 3) * 0.3;
    },
  };
}
