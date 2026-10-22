import * as THREE from 'three';

export function createPlanetBreakerCore() {
  const root = new THREE.Group(); root.name = 'PlanetBreakerCore';
  const visibility = { value: 1 };
  const shell = new THREE.MeshStandardMaterial({ color: 0xb6cbd0, metalness: 0.55, roughness: 0.3,
    emissive: 0x466c71, emissiveIntensity: 0.18 });
  const energy = new THREE.MeshBasicMaterial({ color: 0xa4eadc, toneMapped: false });
  for (const material of [shell, energy]) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uCoreVisibility = visibility;
      shader.vertexShader = `varying vec3 vCorePosition;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCorePosition = position;');
      shader.fragmentShader = `varying vec3 vCorePosition; uniform float uCoreVisibility;\n${shader.fragmentShader}`
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float cell = fract(sin(dot(floor(vCorePosition * 26.0), vec3(12.9898, 78.233, 39.425))) * 43758.5453);
          if (cell >= uCoreVisibility) discard;`);
    };
    material.customProgramCacheKey = () => 'facility-core-transfer-v1';
  }
  root.add(new THREE.Mesh(new THREE.IcosahedronGeometry(2.8, 2), shell));
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.82, 0.12, 8, 40), energy);
    band.rotation.set(i * Math.PI / 3, i * Math.PI / 2, i * 0.5); root.add(band);
  }
  const calm = new THREE.Color(0xb6cbd0), armed = new THREE.Color(0x121923);
  const calmGlow = new THREE.Color(0xa4eadc), armedGlow = new THREE.Color(0xf16c48);
  return {
    root,
    update(time: number, amount = 1, danger = 0) {
      visibility.value = THREE.MathUtils.clamp(amount, 0, 1); root.visible = amount > 0;
      root.rotation.set(time * 0.12, time * 0.25, time * 0.08);
      shell.color.copy(calm).lerp(armed, danger);
      energy.color.copy(calmGlow).lerp(armedGlow, danger).multiplyScalar(1 + danger);
    },
  };
}

export function createFacilityCoreDisplay() {
  const root = new THREE.Group(); root.name = 'FacilityCoreDisplay';
  const pale = new THREE.MeshStandardMaterial({ color: 0xe8eef0, metalness: 0.25, roughness: 0.5 });
  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x2a3a42, metalness: 0.7, roughness: 0.3 });
  for (const [top, bottom, y] of [[2.7, 2.9, 0.125], [2.2, 2.4, 0.375]]) {
    const step = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, 0.25, 40), pale);
    step.position.y = y; step.receiveShadow = true; root.add(step);
  }
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.4, 24), pedestalMat);
  pedestal.position.y = 1.2; pedestal.castShadow = pedestal.receiveShadow = true; root.add(pedestal);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xcfeef2, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  for (const radius of [3.4, 5.2, 7, 8.8]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.14, 64), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; root.add(ring);
  }
  const core = createPlanetBreakerCore(); core.root.scale.setScalar(0.28); core.root.position.y = 2.9; root.add(core.root);
  const light = new THREE.PointLight(0xa4eadc, 8, 12); light.position.set(0, 2.9, 0); root.add(light);
  return {
    root,
    update(time: number, amount = 1) {
      core.update(time, amount);
      core.root.position.y = 2.9 + Math.sin(time * 0.8) * 0.06;
      light.intensity = 8 * amount;
    },
  };
}

export function createFacilityCoreCutaway(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'FacilityInteriorCoreCutaway';
  root.position.set(2000, 0, 0); root.visible = false; scene.add(root);
  const floor = new THREE.MeshStandardMaterial({ color: 0x2e6076, metalness: 0.35, roughness: 0.6 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x9db4b8, metalness: 0.25, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22343c, metalness: 0.5, roughness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x9fe8e0 });
  function box(size: [number, number, number], at: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...at); root.add(mesh);
  }
  box([28, 0.4, 36], [0, -0.2, 0], floor);
  for (const x of [-14, 14]) box([0.4, 8, 36], [x, 4, 0], wall);
  box([28, 8, 0.4], [0, 4, -18], wall);
  box([28, 0.4, 22], [0, 4, -7], floor);
  box([28, 0.4, 36], [0, 8.2, 0], dark);
  for (const x of [-6, -2, 2, 6]) {
    box([2.4, 1.2, 0.7], [x, 0.6, -17.1], dark);
    box([2, 0.5, 0.02], [x, 1.05, -16.74], glow);
  }
  const display = createFacilityCoreDisplay(); root.add(display.root);
  const light = new THREE.PointLight(0xd6f0ff, 45, 30); light.position.set(0, 3.4, 6); root.add(light);
  root.add(new THREE.HemisphereLight(0xd8f2ff, 0x3a4a50, 2.3));
  return {
    root,
    cameraPosition: root.position.clone().add(new THREE.Vector3(5, 3.1, 8)),
    target: root.position.clone().add(new THREE.Vector3(0, 2.8, 0)),
    update(time: number, amount: number, visible: boolean) { root.visible = visible; display.update(time, amount); },
  };
}
