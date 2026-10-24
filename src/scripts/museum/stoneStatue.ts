import * as THREE from "three";

const vertexDeclarations = /* glsl */ `
  varying vec3 vStonePos;
  varying vec3 vStoneNormal;
`;

const fragmentDeclarations = /* glsl */ `
  varying vec3 vStonePos;
  varying vec3 vStoneNormal;
  float stoneHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float stoneNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(stoneHash(i), stoneHash(i + vec3(1,0,0)), f.x), mix(stoneHash(i + vec3(0,1,0)), stoneHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(stoneHash(i + vec3(0,0,1)), stoneHash(i + vec3(1,0,1)), f.x), mix(stoneHash(i + vec3(0,1,1)), stoneHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float stoneFbm(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) { sum += stoneNoise(p) * amp; p *= 2.03; amp *= 0.5; }
    return sum;
  }
`;

const albedo = /* glsl */ `
  vec3 sp = vStonePos;
  float grain = stoneFbm(sp * 7.0);
  float cloud = stoneFbm(sp * 1.6 + 3.0);
  vec3 limestone = mix(vec3(0.50, 0.48, 0.44), vec3(0.80, 0.77, 0.71), grain);
  limestone = mix(limestone, vec3(0.64, 0.60, 0.53), cloud * 0.45);
  float vein = 1.0 - smoothstep(0.0, 0.035, abs(stoneFbm(sp * 2.4 + 9.0) - 0.5));
  limestone = mix(limestone, vec3(0.30, 0.28, 0.26), vein * 0.55);
  // Fine directional chisel marks, stronger on vertical faces.
  float chisel = stoneNoise(vec3(sp.x * 60.0, sp.y * 4.0, sp.z * 60.0));
  limestone *= 0.88 + chisel * 0.18;
  float pits = smoothstep(0.62, 0.8, stoneNoise(sp * 38.0));
  limestone *= 1.0 - pits * 0.35;
  // Weathering gathers low on the figure, and in crevices facing downwards.
  float low = smoothstep(0.35, -0.9, sp.y);
  limestone = mix(limestone, vec3(0.34, 0.37, 0.28), low * 0.35 * grain);
  diffuseColor.rgb = limestone;
`;

/**
 * Turns any model into a carved stone statue: procedural limestone, veining, chisel marks and
 * weathering, evaluated in the model's bind-pose space so it never swims when the rig moves.
 */
export function applyStoneStatueShader(root: THREE.Object3D, scale = 1) {
  const materials: THREE.Material[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const stone = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0,
    });
    stone.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\n${vertexDeclarations}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\nvStonePos = position * ${(1 / Math.max(0.0001, scale)).toFixed(4)};\nvStoneNormal = normal;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n${fragmentDeclarations}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>\n${albedo}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.92 - stoneFbm(vStonePos * 18.0) * 0.28, 0.5, 1.0);`,
        );
    };
    stone.customProgramCacheKey = () => "brondons-stone-statue";
    mesh.material = stone;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    materials.push(stone);
  });
  return materials;
}
