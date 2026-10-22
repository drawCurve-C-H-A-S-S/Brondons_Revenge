import * as THREE from 'three';

/** Tennis racket built along +Y with the string bed in the XY plane (facing +Z). */
export function createTennisRacket() {
  const root = new THREE.Group(); root.name = 'TennisRacket';
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1f27, metalness: 0.55, roughness: 0.28 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xc8ef35, emissive: 0x2c3a05, metalness: 0.3, roughness: 0.35 });
  const gripMaterial = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.85 });
  const tapeMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.7 });
  const stringMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f3d8, roughness: 0.6 });

  const headY = 0.5, rx = 0.13, ry = 0.17;
  const hoop = new THREE.EllipseCurve(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  const hoopPath = new THREE.CatmullRomCurve3(hoop.getPoints(72).map(p => new THREE.Vector3(p.x, p.y + headY, 0)), true);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(hoopPath, 120, 0.012, 8, true), frameMaterial));
  // Thin accent stripe around the outside of the hoop.
  const stripe = new THREE.EllipseCurve(0, 0, rx + 0.009, ry + 0.009, 0, Math.PI * 2, false, 0);
  const stripePath = new THREE.CatmullRomCurve3(stripe.getPoints(72).map(p => new THREE.Vector3(p.x, p.y + headY, 0)), true);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(stripePath, 120, 0.004, 6, true), accentMaterial));

  // String bed: mains (vertical) and crosses (horizontal) clipped to the ellipse.
  const stringGroup = new THREE.Group(); stringGroup.position.y = headY; root.add(stringGroup);
  for (let i = -7; i <= 7; i++) {
    const x = (i / 8) * rx, half = ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.0022, half * 2, 0.0022), stringMaterial);
    main.position.x = x; stringGroup.add(main);
  }
  for (let i = -9; i <= 9; i++) {
    const y = (i / 10) * ry, half = rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
    const cross = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.0022, 0.0022), stringMaterial);
    cross.position.set(0, y, 0.0012); stringGroup.add(cross);
  }
  const stencil = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 24), accentMaterial);
  stencil.position.set(0, headY, 0.003); root.add(stencil);

  // Open-throat V joining the hoop to the shaft.
  const throatBase = new THREE.Vector3(0, headY - ry - 0.09, 0);
  for (const side of [-1, 1]) {
    const top = new THREE.Vector3(side * rx * 0.62, headY - ry * 0.78, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, top.distanceTo(throatBase), 8), frameMaterial);
    arm.position.copy(top).add(throatBase).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(throatBase).normalize());
    root.add(arm);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(rx * 1.15, 0.012, 0.018), frameMaterial);
  bridge.position.y = headY - ry * 0.86; root.add(bridge);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.1, 8), frameMaterial);
  shaft.position.y = throatBase.y - 0.05; root.add(shaft);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.018, 8), accentMaterial);
  collar.position.y = throatBase.y - 0.105; root.add(collar);

  // Octagonal grip with spiral overgrip bands and a butt cap.
  const gripLength = 0.2, gripTop = throatBase.y - 0.114;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, gripLength, 8), gripMaterial);
  grip.position.y = gripTop - gripLength / 2; root.add(grip);
  for (let i = 0; i < 7; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0185, 0.0022, 4, 8), tapeMaterial);
    band.rotation.set(Math.PI / 2 + 0.25, 0, 0); band.position.y = gripTop - 0.02 - i * 0.026; root.add(band);
  }
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.014, 8), accentMaterial);
  butt.position.y = gripTop - gripLength - 0.007; root.add(butt);

  root.position.y = -(gripTop - gripLength - 0.014);
  root.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = true; });
  const wrapper = new THREE.Group(); wrapper.name = 'TennisRacket'; wrapper.add(root);
  return wrapper;
}

export function disposeTennisRacket(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => materials.add(material));
  });
  materials.forEach(material => material.dispose());
  root.removeFromParent();
}
