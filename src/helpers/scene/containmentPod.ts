import * as THREE from 'three';

/**
 * A cylindrical containment capsule in the house style (see the reference art):
 * a glass tube ringed by dark struts carrying vertical neon strips, a capped top
 * with a glowing rim, and a base that throws a starburst of floor lights with
 * cables snaking out across the deck.
 *
 * Purely visual — it adds no physics, so it never blocks traversal. Returns the
 * group plus an `interior` anchor (at the tube floor) for the trapped occupant,
 * and an `update(t)` that pulses the interior glow.
 */
export interface ContainmentPod {
  group: THREE.Group;
  interior: THREE.Group;
  light: THREE.PointLight;
  update(t: number): void;
}

export function createContainmentPod(options: {
  radius?: number;
  tubeHeight?: number;
  glow?: number;
} = {}): ContainmentPod {
  const R = options.radius ?? 0.55;
  const tubeH = options.tubeHeight ?? 2.2;
  const glowHex = options.glow ?? 0x54ff3c;

  const group = new THREE.Group();

  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x141d24, metalness: 0.65, roughness: 0.5 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x0c1216, metalness: 0.3, roughness: 0.8 });
  const neon = new THREE.MeshBasicMaterial({ color: glowHex });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fd8b0, transparent: true, opacity: 0.13, roughness: 0.08, metalness: 0.05,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const fluidMat = new THREE.MeshBasicMaterial({ color: glowHex, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });

  const baseTop = 0.34;

  // Base drum + glowing base ring
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.2, R + 0.26, baseTop, 24), darkMetal);
  base.position.y = baseTop / 2; base.castShadow = base.receiveShadow = true; group.add(base);
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.24, R + 0.24, 0.05, 24, 1, true), neon);
  baseRing.position.y = baseTop - 0.03; group.add(baseRing);

  // Glass tube + faint fluid column
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, tubeH, 28, 1, true), glassMat);
  tube.position.y = baseTop + tubeH / 2; group.add(tube);
  const fluid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.86, tubeH * 0.94, 20, 1, true), fluidMat);
  fluid.position.y = baseTop + tubeH / 2; group.add(fluid);

  // Struts + vertical neon strips on the diagonals so the front stays clear
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, tubeH, 0.1), darkMetal);
    strut.position.set(Math.cos(a) * (R + 0.06), baseTop + tubeH / 2, Math.sin(a) * (R + 0.06));
    strut.castShadow = true; group.add(strut);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, tubeH * 0.82, 0.035), neon);
    strip.position.set(Math.cos(a) * (R + 0.14), baseTop + tubeH / 2, Math.sin(a) * (R + 0.14));
    group.add(strip);
  }

  // Top cap + glowing rim
  const capY = baseTop + tubeH;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.24, R + 0.18, 0.3, 24), darkMetal);
  cap.position.y = capY + 0.15; cap.castShadow = true; group.add(cap);
  const capRim = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.25, R + 0.25, 0.06, 24, 1, true), neon);
  capRim.position.y = capY + 0.06; group.add(capRim);

  // Floor starburst: ring around the base + radiating neon spokes
  const floorRing = new THREE.Mesh(new THREE.RingGeometry(R + 0.3, R + 0.38, 32), neon);
  floorRing.rotation.x = -Math.PI / 2; floorRing.position.y = 0.02; group.add(floorRing);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.95), neon);
    spoke.position.set(Math.cos(a) * (R + 0.85), 0.02, Math.sin(a) * (R + 0.85));
    spoke.rotation.y = Math.PI / 2 - a;
    group.add(spoke);
  }

  // Cables snaking out from the base across the deck
  for (const [ca, len] of [[Math.PI * 0.15, 1.6], [Math.PI * 0.85, 1.4], [Math.PI * 1.4, 1.7]] as const) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(ca) * (R + 0.1), 0.16, Math.sin(ca) * (R + 0.1)),
      new THREE.Vector3(Math.cos(ca) * (R + 0.7), 0.06, Math.sin(ca) * (R + 0.7)),
      new THREE.Vector3(Math.cos(ca) * (R + len), 0.03, Math.sin(ca) * (R + len)),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 6, false), cableMat));
  }

  // Interior glow
  const light = new THREE.PointLight(glowHex, 5, 6);
  light.position.y = baseTop + tubeH / 2; group.add(light);

  // Anchor for the trapped occupant, seated on the tube floor
  const interior = new THREE.Group();
  interior.position.y = baseTop;
  group.add(interior);

  return {
    group, interior, light,
    update(t: number) {
      light.intensity = 4.5 + Math.sin(t * 2.2) * 0.8;
    },
  };
}
