import * as THREE from 'three';

export function createCrowbar(): THREE.Group {
  const crowbar = new THREE.Group();
  crowbar.name = 'crowbar';
  const paint = new THREE.MeshStandardMaterial({ color: 0x8f201a, metalness: 0.65, roughness: 0.38 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x999da3, metalness: 0.9, roughness: 0.28 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), paint);
  shaft.position.y = 0.20;
  crowbar.add(shaft);

  const hookPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.52, 0),
    new THREE.Vector3(0, 0.61, 0),
    new THREE.Vector3(0, 0.66, -0.055),
    new THREE.Vector3(0, 0.64, -0.12),
    new THREE.Vector3(0, 0.58, -0.15),
  ]);
  const hook = new THREE.Mesh(new THREE.TubeGeometry(hookPath, 24, 0.022, 10, false), steel);
  crowbar.add(hook);
  for (const x of [-0.014, 0.014]) {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.075, 0.012), steel);
    claw.position.set(x, 0.55, -0.15);
    crowbar.add(claw);
  }
  const pryTip = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.10, 0.014), steel);
  pryTip.position.set(0, -0.16, -0.015);
  pryTip.rotation.x = 0.3;
  crowbar.add(pryTip);
  crowbar.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return crowbar;
}
