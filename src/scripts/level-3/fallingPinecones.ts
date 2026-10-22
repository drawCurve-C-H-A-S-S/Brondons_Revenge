import * as THREE from 'three';

export interface PineconeTree { x: number; z: number; height: number; alive(): boolean; }

export function createFallingPinecones(parent: THREE.Object3D, trees: readonly PineconeTree[]) {
  const geometry = new THREE.IcosahedronGeometry(0.12, 1); geometry.scale(0.8, 1.5, 0.8);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3), color = new THREE.Color();
  for (let vertex = 0; vertex < colors.length / 3; vertex++) {
    color.setHSL(0.065, 0.38, 0.17 + Math.floor(vertex / 3) % 4 * 0.035).toArray(colors, vertex * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, 8);
  mesh.name = 'FallingPinecones'; mesh.visible = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parent.add(mesh);
  const cones = Array.from({ length: mesh.count }, () => ({
    age: -1, position: new THREE.Vector3(), velocity: new THREE.Vector3(), rotation: new THREE.Euler(),
  }));
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), cameraPosition = new THREE.Vector3();
  const sphere = new THREE.Sphere(), dummy = new THREE.Object3D();
  let seed = 41983, countdown = 6, hasView = false;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  function updateInstances() {
    let visible = false;
    cones.forEach((cone, index) => {
      const inView = hasView && cone.age >= 0 && cone.position.distanceToSquared(cameraPosition) < 45 * 45
        && frustum.intersectsSphere(sphere.set(cone.position, 0.2));
      dummy.position.copy(cone.position); dummy.rotation.copy(cone.rotation);
      dummy.scale.setScalar(inView ? 1 - THREE.MathUtils.smoothstep(cone.age, 12, 14) : 0);
      dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix); visible ||= inView;
    });
    mesh.visible = visible; mesh.instanceMatrix.needsUpdate = true;
    if (visible) mesh.computeBoundingSphere();
  }
  return {
    updateView(camera: THREE.Camera) {
      camera.updateMatrixWorld(); camera.getWorldPosition(cameraPosition);
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      hasView = true; updateInstances();
    },
    update(dt: number) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Pinecone updates require finite, nonnegative time');
      if (!hasView || dt === 0) return;
      countdown -= dt;
      if (countdown <= 0) {
        countdown = 8 + random() * 10;
        const cone = cones.find(item => item.age < 0);
        if (cone) for (let attempt = 0; attempt < 24 && trees.length; attempt++) {
          const tree = trees[Math.floor(random() * trees.length)];
          if (!tree.alive()) continue;
          const y = Math.min(tree.height * 0.55, 7 + random() * 3);
          sphere.center.set(tree.x, y, tree.z); sphere.radius = 3;
          if (sphere.center.distanceToSquared(cameraPosition) > 42 * 42 || !frustum.intersectsSphere(sphere)) continue;
          cone.age = 0; cone.position.set(tree.x + random() * 2 - 1, y, tree.z + random() * 2 - 1);
          cone.velocity.set(random() - 0.5, 0, random() - 0.5); cone.rotation.set(random(), random(), random());
          break;
        }
      }
      for (const cone of cones) {
        if (cone.age < 0) continue;
        cone.age += dt;
        if (cone.age >= 14) { cone.age = -1; continue; }
        if (cone.position.y > 0.12 || cone.velocity.y > 0) {
          cone.velocity.y -= 9.82 * dt;
          cone.position.addScaledVector(cone.velocity, dt);
          cone.rotation.x += dt * 2.4; cone.rotation.z += dt * 1.7;
          if (cone.position.y < 0.12) {
            cone.position.y = 0.12;
            cone.velocity.y = Math.abs(cone.velocity.y) > 1 ? -cone.velocity.y * 0.2 : 0;
            cone.velocity.x *= 0.5; cone.velocity.z *= 0.5;
          }
        }
      }
      updateInstances();
    },
    dispose() { mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}
