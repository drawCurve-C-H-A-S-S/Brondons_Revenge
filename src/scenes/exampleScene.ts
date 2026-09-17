import * as THREE from 'three';

/**
 * Example scene -- demonstrates how to build a scene in this project.
 *
 * Each scene should export the same interface:
 *   - build(): creates objects and adds them to the THREE.Scene
 *   - update(dt): called every frame for animations / logic
 *   - dispose(): cleans up GPU resources when switching scenes
 */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);
scene.fog = new THREE.Fog(0x111122, 10, 50);

// --- Ground plane ---
const groundGeo = new THREE.PlaneGeometry(40, 40);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x333344,
  roughness: 0.8,
  metalness: 0.2,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Grid helper for spatial reference ---
const grid = new THREE.GridHelper(40, 40, 0x444466, 0x222233);
grid.position.y = 0.01;
scene.add(grid);

// --- Example objects: rotating cubes ---
const cubes: THREE.Mesh[] = [];
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);

for (let i = 0; i < 5; i++) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(i * 0.15, 0.7, 0.5),
    roughness: 0.4,
    metalness: 0.6,
  });
  const cube = new THREE.Mesh(cubeGeo, mat);
  cube.position.set(i * 2 - 4, 0.5, 0);
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);
  cubes.push(cube);
}

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(5, 10, 7);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -15;
directionalLight.shadow.camera.right = 15;
directionalLight.shadow.camera.top = 15;
directionalLight.shadow.camera.bottom = -15;
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0x4488ff, 1, 20);
pointLight.position.set(-3, 3, 3);
scene.add(pointLight);

// --- Public interface ---

export function build(): THREE.Scene {
  return scene;
}

export function update(dt: number): void {
  const elapsed = performance.now() * 0.001;
  cubes.forEach((cube, i) => {
    cube.rotation.x = elapsed * (0.5 + i * 0.1);
    cube.rotation.y = elapsed * (0.3 + i * 0.15);
    cube.position.y = 0.5 + Math.sin(elapsed + i) * 0.3;
  });
}

export function dispose(): void {
  groundGeo.dispose();
  groundMat.dispose();
  cubeGeo.dispose();
  cubes.forEach((cube) => {
    (cube.material as THREE.Material).dispose();
  });
}
