import * as THREE from 'three';

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
  const bladeMaterial = new THREE.MeshBasicMaterial({ color: bladeColor, transparent: true, opacity: 0.9 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), bladeMaterial);
  blade.position.y = 0.77;
  blade.name = 'blade';
  lightsaber.add(blade);

  // Blade glow (outer)
  const glowMaterial = new THREE.MeshBasicMaterial({ color: bladeColor, transparent: true, opacity: 0.3 });
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
