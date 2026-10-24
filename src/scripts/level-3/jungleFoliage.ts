import * as THREE from "three";
import type { createJungleTextures } from "./jungleTextures.js";

export const CONIFER_PARTS = {
  trunk: 1,
  branch: 42,
  spray: 129,
  canopy: 43,
} as const;
export const JUNGLE_GRASS_SPACING = 2;
export const JUNGLE_GRASS_RANGE = 40;
export type ConiferPart = keyof typeof CONIFER_PARTS;

export function createJungleFoliageMaterials(
  textures: ReturnType<typeof createJungleTextures>,
  wind: { value: number },
) {
  const bark = new THREE.MeshStandardMaterial({
    map: textures.bark,
    roughness: 1,
  });
  const branches = bark.clone();
  const sprays = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.pineBranch,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const canopy = sprays.clone();
  const grass = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.grassTuft,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  for (const [material, kind] of [
    [canopy, "canopy"],
    [sprays, "spray"],
    [grass, "grass"],
  ] as const) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCanopyWind = wind;
      shader.vertexShader =
        "uniform float uCanopyWind;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float foliagePhase = uCanopyWind;
        #ifdef USE_INSTANCING
          foliagePhase += instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.11;
        #endif
        ${
          kind === "grass"
            ? `
          vec4 foliageOrigin = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            foliageOrigin = instanceMatrix * foliageOrigin;
          #endif
          float foliageDistance = distance((modelMatrix * foliageOrigin).xz, cameraPosition.xz);
          transformed *= 1.0 - smoothstep(24.0, 38.0, foliageDistance);
          float grassSway = position.y * position.y;
          transformed.x += sin(foliagePhase * 1.3 + position.x * 2.1) * 0.18 * grassSway;
          transformed.z += cos(foliagePhase * 1.1 + position.y * 1.7) * 0.13 * grassSway;
        `
            : `
          transformed.x += sin(foliagePhase * 0.9 + position.y * 1.7) * 0.08;
          transformed.z += cos(foliagePhase * 0.7 + position.x * 1.3) * 0.05;
        `
        }`,
      );
    };
    material.customProgramCacheKey = () => `jungle-${kind}-wind-v3`;
  }
  return { bark, branches, canopy, sprays, grass };
}

export function createJungleFoliageGeometry() {
  const tuft = new THREE.PlaneGeometry(1, 1);
  tuft.translate(0, 0.5, 0);
  const spray = new THREE.PlaneGeometry(1, 1);
  return {
    trunk: new THREE.CylinderGeometry(0.5, 1, 1, 7),
    branch: new THREE.CylinderGeometry(0.12, 0.3, 1, 5),
    spray,
    canopy: spray,
    tuft,
  };
}

// Writers copy the scratch transform immediately, rather than retaining the reused matrix.
export function writeConifer(
  x: number,
  z: number,
  height: number,
  radius: number,
  random: () => number,
  write: (
    part: ConiferPart,
    matrix: THREE.Matrix4,
    color?: THREE.Color,
  ) => void,
) {
  const dummy = new THREE.Object3D(),
    tint = new THREE.Color(),
    direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  dummy.position.set(x, height / 2, z);
  dummy.scale.set(radius, height, radius);
  dummy.updateMatrix();
  write("trunk", dummy.matrix);
  for (let whorl = 0; whorl < 9; whorl++) {
    const t = whorl / 8,
      y = height * (0.16 + 0.78 * t);
    const reach = (3.8 - 2.7 * t) * (0.85 + random() * 0.3),
      arms = whorl < 6 ? 5 : 4;
    for (let arm = 0; arm < arms; arm++) {
      const angle = (arm * Math.PI * 2) / arms + random() * 0.6 + whorl * 0.5;
      const dx = Math.sin(angle),
        dz = Math.cos(angle),
        length = reach * 0.75;
      dummy.position.set(
        x + dx * length * 0.5,
        y - 0.15,
        z + dz * length * 0.5,
      );
      dummy.scale.set(1, length, 1);
      dummy.quaternion.setFromUnitVectors(
        up,
        direction.set(dx, -0.18, dz).normalize(),
      );
      dummy.updateMatrix();
      write("branch", dummy.matrix);
      for (let card = 0; card < 3; card++) {
        dummy.position.set(
          x + dx * reach * 0.5,
          y + (random() - 0.5) * 0.35,
          z + dz * reach * 0.5,
        );
        dummy.scale.set(reach * 1.8, 2.9 + (1 - t) * 1.6, 1);
        dummy.rotation.set(
          0,
          angle + Math.PI / 2 + (card * Math.PI) / 3,
          -0.14,
        );
        dummy.updateMatrix();
        tint.setHSL(
          0.3 + random() * 0.06,
          0.45 + random() * 0.2,
          0.3 + random() * 0.16,
        );
        write("spray", dummy.matrix, tint);
        if (card === 0) write("canopy", dummy.matrix, tint);
      }
    }
  }
  for (let card = 0; card < 3; card++) {
    dummy.position.set(x, height * 0.95, z);
    dummy.scale.set(2.3, 3.2, 1);
    dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.updateMatrix();
    write("spray", dummy.matrix, tint.setHSL(0.31, 0.5, 0.32));
    if (card === 0) write("canopy", dummy.matrix, tint);
  }
}

export function writeGrassTuft(
  x: number,
  z: number,
  random: () => number,
  write: (matrix: THREE.Matrix4, color: THREE.Color) => void,
) {
  const dummy = new THREE.Object3D(),
    tint = new THREE.Color();
  dummy.position.set(x, 0, z);
  dummy.scale.set(0.85 + random() * 0.7, 0.55 + random() * 0.5, 1);
  dummy.rotation.set(0, random() * Math.PI, 0);
  dummy.updateMatrix();
  tint.setHSL(
    0.24 + random() * 0.09,
    0.3 + random() * 0.3,
    0.5 + random() * 0.28,
  );
  write(dummy.matrix, tint);
}

export function partitionJungleInstances(source: THREE.InstancedMesh) {
  const cellSize = 24,
    matrix = new THREE.Matrix4(),
    color = new THREE.Color();
  const buckets = new Map<
    string,
    { x: number; z: number; indices: number[] }
  >();
  const locations: Array<{ mesh: THREE.InstancedMesh; index: number }> =
    new Array(source.count);
  for (let index = 0; index < source.count; index++) {
    source.getMatrixAt(index, matrix);
    const x = Math.floor(matrix.elements[12] / cellSize),
      z = Math.floor(matrix.elements[14] / cellSize),
      key = `${x},${z}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        x: (x + 0.5) * cellSize,
        z: (z + 0.5) * cellSize,
        indices: [],
      };
      buckets.set(key, bucket);
    }
    bucket.indices.push(index);
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const [key, bucket] of buckets) {
    const mesh = new THREE.InstancedMesh(
      source.geometry,
      source.material,
      bucket.indices.length,
    );
    mesh.name = `${source.name}/${key}`;
    mesh.position.set(bucket.x, 0, bucket.z);
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.frustumCulled = true;
    bucket.indices.forEach((original, index) => {
      source.getMatrixAt(original, matrix);
      matrix.elements[12] -= bucket.x;
      matrix.elements[14] -= bucket.z;
      mesh.setMatrixAt(index, matrix);
      locations[original] = { mesh, index };
      if (source.instanceColor) {
        source.getColorAt(original, color);
        mesh.setColorAt(index, color);
      }
    });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.computeBoundingBox();
    mesh.boundingBox!.min.y = Math.min(0, mesh.boundingBox!.min.y);
    mesh.boundingBox!.expandByScalar(0.3);
    mesh.boundingSphere = mesh.boundingBox!.getBoundingSphere(
      new THREE.Sphere(),
    );
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    mesh.raycast = function (raycaster, hits) {
      if (this.visible)
        THREE.InstancedMesh.prototype.raycast.call(this, raycaster, hits);
    };
    meshes.push(mesh);
  }
  return { meshes, locations };
}

export function createJungleView() {
  const frustum = new THREE.Frustum(),
    projection = new THREE.Matrix4(),
    bounds = new THREE.Box3();
  const position = new THREE.Vector3();
  function visibleBounds(box: THREE.Box3, range: number) {
    const dx = Math.max(box.min.x - position.x, 0, position.x - box.max.x);
    const dz = Math.max(box.min.z - position.z, 0, position.z - box.max.z);
    return dx * dx + dz * dz < range * range && frustum.intersectsBox(box);
  }
  return {
    position,
    visibleBounds,
    update(camera: THREE.Camera) {
      camera.updateMatrixWorld();
      camera.getWorldPosition(position);
      frustum.setFromProjectionMatrix(
        projection.multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        ),
      );
    },
    visible(mesh: THREE.InstancedMesh, range: number) {
      bounds.copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld);
      return visibleBounds(bounds, range);
    },
    detailed(mesh: THREE.InstancedMesh, previous: boolean) {
      const x = mesh.matrixWorld.elements[12] - position.x,
        z = mesh.matrixWorld.elements[14] - position.z;
      return x * x + z * z < (previous ? 52 : 44) ** 2;
    },
  };
}
