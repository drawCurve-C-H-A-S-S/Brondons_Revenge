import * as THREE from 'three';

/** The same single-seat shuttle is used in the hangar and in playable space flight. */
export function createEscapeShip() {
  const root = new THREE.Group(); root.name = 'EscapeShuttle';
  const hull = new THREE.MeshStandardMaterial({ color: 0xc1ced3, metalness: 0.65, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x172934, metalness: 0.6, roughness: 0.4 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd98535, metalness: 0.4, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x65bfda, transparent: true, opacity: 0.25, metalness: 0.5, roughness: 0.1, depthWrite: false });
  const glow = new THREE.MeshBasicMaterial({ color: 0x69cfff });
  function box(size: [number, number, number], p: [number, number, number], mat: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); mesh.position.set(...p); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  box([2.8, 1, 6.5], [0, 0.9, 0], hull);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.45, 3.2, 16), hull); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.9, -4.85); root.add(nose);
  const noseCap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), orange); noseCap.position.set(0, 0.9, -6.5); root.add(noseCap);
  const canopy = box([2.3, 1.55, 2.8], [0, 1.95, -0.4], glass); canopy.name = 'ShuttleCanopy';
  for (const x of [-1.18, 1.18]) {
    box([0.1, 1.6, 0.1], [x, 1.95, -1.85], dark); box([0.1, 0.1, 2.9], [x, 2.7, -0.4], dark);
    const wing = box([3.7, 0.2, 2.8], [x * 2.1, 0.95, 0.8], hull); wing.rotation.z = -Math.sign(x) * 0.08;
    box([0.2, 0.24, 2.5], [x * 3.4, 0.97, 0.8], orange);
    box([0.8, 0.9, 2.4], [x * 2, 0.9, 2], dark);
    box([0.12, 0.16, 1.8], [x * 3.3, 1.13, 0.8], glow);
  }
  box([1.5, 0.12, 0.55], [0, 1.6, -1.5], dark);
  for (const x of [-0.45, 0, 0.45]) { const screen = box([0.34, 0.18, 0.04], [x, 1.72, -1.4], glow); screen.rotation.x = -0.35; }
  box([0.65, 0.9, 0.3], [0, 1.8, 0.85], dark); box([0.7, 0.2, 0.8], [0, 1.35, 0.5], dark);
  const thrusters = [-2.36, 2.36].map(x => {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2, 12), glow); flame.rotation.x = Math.PI / 2; flame.position.set(x, 0.9, 4.1); root.add(flame); return flame;
  });
  const gear = [-1, 1].map(x => box([0.22, 0.5, 2.2], [x, 0.25, 0.6], dark));
  const cockpit = new THREE.Object3D(); cockpit.position.set(0, 2.05, -0.1); root.add(cockpit);
  return { root, cockpit, canopy,
    setThrust(amount: number) { thrusters.forEach((t, i) => { t.visible = amount > 0; t.scale.y = 0.45 + amount * (1 + Math.sin(amount * 17 + i) * 0.08); }); },
    setFlying(active: boolean) { gear.forEach(g => { g.visible = !active; }); },
  };
}

/** Shared pod keeps the boss ejection and planetary pursuit visually continuous. */
export function createEscapePod() {
  const root = new THREE.Group(); root.name = 'EscapePod';
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.8, 8, 12), new THREE.MeshStandardMaterial({ color: 0x8a7a6a, metalness: 0.6, roughness: 0.4 }));
  body.rotation.x = Math.PI / 2; root.add(body);
  const window = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7fe6ff }));
  window.position.set(0, 0.8, -1); window.scale.y = 0.4; root.add(window);
  const trail = new THREE.Mesh(new THREE.ConeGeometry(0.8, 7, 12), new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.85, depthWrite: false }));
  trail.rotation.x = -Math.PI / 2; trail.position.z = 5; trail.name = 'PodTrail'; root.add(trail);
  return root;
}

export function addPlanetBackdrop(scene: THREE.Scene, position: THREE.Vector3, radius: number, starRadius: number) {
  const data = new Uint8Array(512 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) {
    const lat = (y / 255 - 0.5) * Math.PI, lon = x / 512 * Math.PI * 2;
    const terrain = Math.sin(lon * 3 + Math.cos(lat * 7)) + Math.cos(lon * 5 - lat * 4) * 0.5 + Math.sin(lon * 13 + lat * 9) * 0.22;
    const snow = Math.abs(lat) > 1.25, land = terrain > 0.25;
    const color = snow ? [210, 226, 229] : land ? (terrain > 1 ? [114, 115, 74] : [59, 106, 76]) : [18, 60 + terrain * 5, 107 + terrain * 8];
    const i = (y * 512 + x) * 4; data.set([color[0], color[1], color[2], 255], i);
  }
  const texture = new THREE.DataTexture(data, 512, 256); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.93 })); planet.name = 'NearestPlanet'; planet.position.copy(position); scene.add(planet);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.025, 64, 48), new THREE.MeshBasicMaterial({ color: 0x59acdd, transparent: true, opacity: 0.13, side: THREE.BackSide, depthWrite: false })); planet.add(atmosphere);
  const stars = new Float32Array(2400 * 3);
  for (let i = 0; i < stars.length; i += 3) {
    const angle = Math.random() * Math.PI * 2, v = Math.random() * 2 - 1, r = starRadius * (0.7 + Math.random() * 0.3);
    stars[i] = Math.cos(angle) * Math.sqrt(1 - v * v) * r; stars[i + 1] = v * r; stars[i + 2] = Math.sin(angle) * Math.sqrt(1 - v * v) * r;
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starfield = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xd7e8ff, size: starRadius * 0.0006, sizeAttenuation: true })); starfield.name = 'Starfield'; scene.add(starfield);
  return planet;
}
