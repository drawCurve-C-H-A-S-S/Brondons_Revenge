import * as THREE from 'three';
import vertexShader from '../../shaders/jungleWater.vert.glsl?raw';
import fragmentShader from '../../shaders/jungleWater.frag.glsl?raw';

/** GPU-driven river surface; the owning scene disposes its geometry and material. */
export function createJungleWater(scene: THREE.Scene, options: { y: number; z: number; halfWidth: number; length: number }) {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uRiverZ: { value: options.z },
    uHalfWidth: { value: options.halfWidth },
    uDeepColor: { value: new THREE.Color(0x17443f) },
    uShallowColor: { value: new THREE.Color(0x4c9680) },
    uSkyColor: { value: new THREE.Color(0x90afba) },
    uForestColor: { value: new THREE.Color(0x344d32) },
    uFoamColor: { value: new THREE.Color(0xd9e7cd) },
    uSunColor: { value: new THREE.Color(0xffe8b9) },
    uSunDirection: { value: new THREE.Vector3(-40, 90, 30).normalize() },
    uObstacleCount: { value: 0 },
    uObstacles: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'JungleRiverWater', uniforms, vertexShader, fragmentShader,
    fog: true, side: THREE.DoubleSide, depthWrite: true, toneMapped: true,
  });
  const geometry = new THREE.PlaneGeometry(options.length, options.halfWidth * 2, 256, 24);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.boundingBox!.min.y -= 0.13;
  geometry.boundingBox!.max.y += 0.13;
  geometry.computeBoundingSphere();
  geometry.boundingSphere!.radius += 0.13;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'JungleRiver'; mesh.position.set(0, options.y, options.z); scene.add(mesh);

  const obstacles: THREE.Mesh[] = [];
  const bounds = new THREE.Box3(), center = new THREE.Vector3(), size = new THREE.Vector3();
  function updateContacts() {
    let count = 0;
    for (const obstacle of obstacles) {
      if (!obstacle.visible || count === uniforms.uObstacles.value.length) continue;
      bounds.setFromObject(obstacle);
      if (bounds.min.y > options.y + 0.12 || bounds.max.y < options.y - 0.12) continue;
      bounds.getCenter(center); bounds.getSize(size);
      let taper = 1;
      if (obstacle.geometry instanceof THREE.CylinderGeometry) {
        const { radiusTop, radiusBottom } = obstacle.geometry.parameters;
        const height = THREE.MathUtils.clamp((options.y - bounds.min.y) / Math.max(size.y, 0.01), 0, 1);
        taper = THREE.MathUtils.lerp(radiusBottom, radiusTop, height) / Math.max(radiusTop, radiusBottom, 0.01);
      }
      uniforms.uObstacles.value[count++].set(center.x, center.z, size.x * taper / 2, size.z * taper / 2);
    }
    uniforms.uObstacleCount.value = count;
  }

  return {
    mesh,
    setObstacles(root: THREE.Object3D | null) {
      obstacles.length = 0;
      root?.updateMatrixWorld(true);
      root?.traverse(node => {
        if (node instanceof THREE.Mesh && /^(PlatformDeck-|GroundPillar-|RockExitLanding$)/.test(node.name)) obstacles.push(node);
      });
      updateContacts();
    },
    update(dt: number) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      uniforms.uTime.value += Math.min(dt, 0.1);
      updateContacts();
    },
  };
}
