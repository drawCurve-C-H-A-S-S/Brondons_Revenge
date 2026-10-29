import * as THREE from "three";

export function createRustWallMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to draw the chamber wall finish");
  context.fillStyle = "#4e565a";
  context.fillRect(0, 0, 512, 512);
  const noise = (seed: number) => {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  };
  for (let index = 0; index < 180; index++) {
    const x = noise(index) * 512,
      y = index % 3 ? noise(index + 1000) * 90 : 420 + noise(index + 1000) * 92;
    const length = 25 + noise(index + 2000) * 140,
      width = 2 + noise(index + 3000) * 16;
    const gradient = context.createLinearGradient(0, y, 0, y + length);
    gradient.addColorStop(0, "#84523780");
    gradient.addColorStop(1, "#654b3800");
    context.fillStyle = gradient;
    context.fillRect(x, y, width, length);
  }
  context.strokeStyle = "#283239";
  context.lineWidth = 5;
  context.strokeRect(2, 2, 508, 508);
  context.strokeStyle = "#697074";
  context.lineWidth = 1;
  context.strokeRect(7, 7, 498, 498);
  for (const x of [16, 496])
    for (const y of [16, 496]) {
      context.fillStyle = "#272e32";
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(7, 3);
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xb1a99a,
    roughness: 0.91,
    metalness: 0.25,
  });
}

export function createRustEdgeMaterial(walls: THREE.MeshStandardMaterial) {
  const material = walls.clone();
  material.name = "CorrodedRustWaterEdge";
  material.color.setHex(0xa77950);
  material.roughness = 0.97;
  material.metalness = 0.14;
  if (walls.map) {
    material.map = walls.map.clone();
    material.map.repeat.set(0.35, 0.35);
  }
  return material;
}

export function createRustWater(
  width: number,
  depth: number,
  position: THREE.Vector3,
) {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0x665038,
    emissive: 0x24160c,
    emissiveIntensity: 0.18,
    roughness: 0.32,
    metalness: 0.12,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRustWaterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uRustWaterTime;
        varying vec2 vRustWaterPosition;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        float swell = cos(position.x * 0.8 + position.y * 1.1 + uRustWaterTime * 0.4);
        objectNormal = normalize(vec3(
          -0.063 * cos(position.x * 2.1 + uRustWaterTime * 0.8) - swell * 0.0096,
          -0.074 * cos(position.y * 3.7 - uRustWaterTime * 0.6) - swell * 0.0132, 1.0));`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vRustWaterPosition = position.xy;
        transformed.z += sin(position.x * 2.1 + uRustWaterTime * 0.8) * 0.03
          + sin(position.y * 3.7 - uRustWaterTime * 0.6) * 0.02
          + sin(position.x * 0.8 + position.y * 1.1 + uRustWaterTime * 0.4) * 0.012;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uRustWaterTime;
        varying vec2 vRustWaterPosition;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float scum = sin((vRustWaterPosition.x - uRustWaterTime * 0.08) * 2.7
          + sin((vRustWaterPosition.y + uRustWaterTime * 0.05) * 1.9)
          + uRustWaterTime * 0.2);
        diffuseColor.rgb *= 0.88 + scum * 0.12;`,
      );
  };
  material.customProgramCacheKey = () => "rust-water-v3";
  // A subdivided, opaque surface avoids transparent sorting and triangulation
  // artifacts. The solid launcher plinth naturally occludes the water below it.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(
      width,
      depth,
      Math.ceil(width * 3),
      Math.ceil(depth * 3),
    ),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(position);
  mesh.userData.minimap = false;
  mesh.userData.teleportIgnore = true;
  return {
    mesh,
    update(elapsed: number) {
      time.value = elapsed;
    },
  };
}
