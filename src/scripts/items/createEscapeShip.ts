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
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.05, 6.5, 8), hull);
  fuselage.rotation.x = Math.PI / 2; fuselage.scale.z = 0.55; fuselage.position.y = 0.95; root.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3.2, 8), hull); nose.rotation.x = -Math.PI / 2; nose.scale.z = 0.55; nose.position.set(0, 0.95, -4.85); root.add(nose);
  box([1.8, 0.14, 7.6], [0, 0.42, -0.5], dark);
  box([0.3, 0.08, 3.8], [0, 1.68, -3.3], orange);
  const noseCap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), dark); noseCap.position.set(0, 0.95, -6.5); root.add(noseCap);
  const canopy = new THREE.Group(); canopy.name = 'ShuttleCanopy'; canopy.position.set(0, 1.4, 1.1); root.add(canopy);
  const canopyGlass = box([2.15, 1.3, 2.7], [0, 2, -0.3], glass); canopy.attach(canopyGlass);
  for (const x of [-1.12, 1.12]) {
    for (const z of [-1.7, 1.05]) canopy.attach(box([0.07, 1.35, 0.08], [x, 2, z], dark));
    canopy.attach(box([0.08, 0.08, 2.9], [x, 2.67, -0.3], hull));
  }
  const flaps: Array<{ hinge: THREE.Group; side: number }> = [];
  const nozzlePetals: Array<{ mesh: THREE.Mesh; angle: number }> = [];
  const engineGimbals: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const outline = new THREE.Shape(); outline.moveTo(0, -1.8); outline.lineTo(side * 3.6, 0.6); outline.lineTo(side * 3.35, 2.5); outline.lineTo(0, 2); outline.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.16, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.04, bevelSegments: 1, steps: 1 }); wingGeo.rotateX(Math.PI / 2);
    const wing = new THREE.Mesh(wingGeo, hull); wing.position.set(side * 1.1, 0.95, 0.3); wing.castShadow = true; root.add(wing);
    for (const z of [-0.8, 0, 0.8, 1.6]) box([0.03, 0.025, 0.6], [side * 2, 1.07, z], dark);
    box([0.12, 0.08, 1.25], [side * 4.35, 1.02, 1.65], orange);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff4444 : 0x66ffbb })); nav.position.set(side * 4.5, 1.08, 1.2); root.add(nav);
    const hinge = new THREE.Group(); hinge.position.set(side * 2.9, 1, 2.3); root.add(hinge);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.13, 0.6), dark); flap.position.z = 0.3; hinge.add(flap); flaps.push({ hinge, side });
    const fin = box([0.13, 1.7, 1.9], [side * 1.35, 2, 2.3], hull); fin.rotation.z = -side * 0.25;
    box([0.15, 0.15, 1.45], [side * 1.55, 2.83, 2.3], orange);
    const engine = new THREE.Group(); engine.position.set(side * 2.36, 0.9, 1.8); root.add(engine); engineGimbals.push(engine);
    for (const [radius, length, z] of [[0.62, 2.8, 0], [0.7, 0.16, -1.1], [0.68, 0.16, 1.15]] as const) {
      const casing = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), z === 0 ? dark : hull); casing.rotation.x = Math.PI / 2; casing.position.z = z; engine.add(casing);
    }
    const chamber = new THREE.Mesh(new THREE.CircleGeometry(0.46, 20), glow); chamber.position.z = 1.51; engine.add(chamber);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.65), hull);
      petal.position.set(Math.cos(angle) * 0.54, Math.sin(angle) * 0.54, 1.55); petal.rotation.z = angle; engine.add(petal); nozzlePetals.push({ mesh: petal, angle });
    }
    for (let i = 0; i < 7; i++) box([0.4, 0.035, 0.07], [side * 0.82, 1.62, 1.45 + i * 0.2], dark);
  }
  for (const side of [-1, 1]) for (const z of [-3.6, -2.8, 0.8, 2.5]) {
    box([0.045, 0.16, 0.055], [side * 1.29, 0.92, z], dark);
    box([0.18, 0.12, 0.3], [side * 1.28, 0.67, z], hull);
  }
  box([1.5, 0.12, 0.55], [0, 1.6, -1.5], dark);
  for (const x of [-0.45, 0, 0.45]) { const screen = box([0.34, 0.18, 0.04], [x, 1.72, -1.4], glow); screen.rotation.x = -0.35; }
  box([0.65, 0.9, 0.3], [0, 1.8, 0.85], dark); box([0.7, 0.2, 0.8], [0, 1.35, 0.5], dark);
  const thrusters = [-2.36, 2.36].map(x => {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2, 12), glow); flame.rotation.x = Math.PI / 2; flame.position.set(x, 0.9, 4.1); root.add(flame); return flame;
  });
  const gear = [[-1.1, 1.9], [1.1, 1.9], [0, -3.1]].map(([x, z]) => {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.7, z); root.add(pivot);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 0.55, 12), hull); strut.position.y = -0.28; pivot.add(strut);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 10), dark); piston.position.set(0.13, -0.22, 0.13); piston.rotation.x = -0.4; pivot.add(piston);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.85), dark); foot.position.y = -0.63; pivot.add(foot); return pivot;
  });
  let flying = false, gearFold = 0, thrust = 0, mechanismTime = 0;
  const cockpit = new THREE.Object3D(); cockpit.position.set(0, 2.05, -0.1); root.add(cockpit);
  return { root, cockpit, canopy,
    setThrust(amount: number) { thrust = Math.max(0, amount); thrusters.forEach((t, i) => { t.visible = amount > 0; t.scale.y = 0.45 + amount * (1 + Math.sin(mechanismTime * 27 + i) * 0.08); }); },
    setCanopyOpen(amount: number) { canopy.rotation.x = -THREE.MathUtils.clamp(amount, 0, 1) * 1.15; canopy.position.y = 1.4 + amount * 0.22; },
    setFlying(active: boolean, immediate = false) { flying = active; if (immediate) { gearFold = active ? 1 : 0; gear.forEach(g => { g.rotation.x = gearFold * Math.PI * 0.48; g.visible = gearFold < 0.99; }); } },
    update(dt: number) {
      mechanismTime += dt; gearFold = THREE.MathUtils.damp(gearFold, flying ? 1 : 0, 3, dt);
      gear.forEach(g => { g.rotation.x = gearFold * Math.PI * 0.48; g.visible = gearFold < 0.995; });
      flaps.forEach(({ hinge, side }) => { hinge.rotation.x = flying ? Math.sin(mechanismTime * 1.7 + side) * 0.06 - 0.12 : 0.3; });
      engineGimbals.forEach((g, i) => { g.rotation.x = flying ? Math.sin(mechanismTime * 1.5 + i) * 0.035 : -0.16 * Math.min(thrust, 1); });
      nozzlePetals.forEach(({ mesh, angle }) => { const radius = 0.5 + Math.min(thrust, 1.6) * 0.07; mesh.position.x = Math.cos(angle) * radius; mesh.position.y = Math.sin(angle) * radius; });
    },
  };
}

/** Shared pod keeps the boss ejection and planetary pursuit visually continuous. */
export function createEscapePod() {
  const root = new THREE.Group(); root.name = 'EscapePod';
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.8, 8, 12), new THREE.MeshStandardMaterial({ color: 0x8a7a6a, metalness: 0.6, roughness: 0.4 }));
  body.rotation.x = Math.PI / 2; root.add(body);
  const window = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7fe6ff }));
  window.position.set(0, 0.8, -1); window.scale.y = 0.4; root.add(window);
  const hatch = new THREE.Group(); hatch.name = 'PodHatch'; hatch.position.set(0.75, 0.7, 0); root.add(hatch);
  const hatchPanel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 1.55), new THREE.MeshStandardMaterial({ color: 0xb9b4a4, metalness: 0.7, roughness: 0.55 })); hatchPanel.position.set(0.25, -0.45, 0); hatch.add(hatchPanel);
  for (const z of [-1.6, 1.6]) { const band = new THREE.Mesh(new THREE.TorusGeometry(1.21, 0.08, 8, 24), new THREE.MeshStandardMaterial({ color: 0x29343d, metalness: 0.8 })); band.position.z = z; root.add(band); }
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
