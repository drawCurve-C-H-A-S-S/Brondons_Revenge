import * as THREE from 'three';
import type { MechSide } from '../../scripts/mechDuel.js';

export const MECH_HEIGHT = 16;
export const FRAME_COLORS = { hero: 0x63eaff, enemy: 0xff4a8d } as const;

function dataTexture(data: Uint8Array, size: number, color = false) {
  const buffer = new ArrayBuffer(data.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(data);
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true; return texture;
}

export function createArmorTextures(side?: MechSide) {
  const size = 128, albedo = new Uint8Array(size * size * 4), normal = albedo.slice(), orm = albedo.slice();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const grain = noise - Math.floor(noise), seam = x % 64 < 2 || y % 32 < 2;
    const rivet = ((x % 64 - 5) ** 2 + (y % 32 - 5) ** 2) < 3;
    const scratch = Math.sin(y * 5.3 + Math.sin(x * 0.035)) > 0.96;
    const stripe = side === 'hero' && x % 64 >= 51 && x % 64 <= 55;
    const paint = seam ? 32 : rivet ? 205 : Math.floor((side === 'enemy' ? 102 : 174) + grain * 24 + (scratch ? 24 : 0));
    const color = stripe ? [217, 133, 53] : side === 'enemy'
      ? [paint, Math.floor(paint * 0.82), Math.min(255, paint + 28)]
      : [paint, Math.min(255, paint + 8), Math.min(255, paint + 15)];
    albedo.set([...color, 255], i);
    normal.set([Math.round(128 + Math.sin(x * 1.7) * 9), seam ? 95 : Math.round(128 + (grain - 0.5) * 13), 251, 255], i);
    orm.set([255, seam ? 210 : Math.round(90 + grain * 45 + (scratch ? 35 : 0)), 245, 255], i);
  }
  const map = dataTexture(albedo, size, true), normalMap = dataTexture(normal, size), roughnessMap = dataTexture(orm, size);
  return { map, normalMap, roughnessMap,
    dispose() { map.dispose(); normalMap.dispose(); roughnessMap.dispose(); } };
}

export function createIndustrialSkin(side: MechSide) {
  const textures = createArmorTextures(side);
  const uniforms = {
    uFrameTime: { value: 0 }, uBuild: { value: 1 }, uDamage: { value: 0 }, uDissolve: { value: 0 },
    uMechInverse: { value: new THREE.Matrix4() }, uFrameGlow: { value: new THREE.Color(FRAME_COLORS[side]) },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: side === 'hero' ? 0xc0d7e2 : 0x665b79, map: textures.map, normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: textures.roughnessMap,
    metalness: 0.94, roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.25,
    emissive: FRAME_COLORS[side], emissiveIntensity: 0.025, envMapIntensity: 1.7,
  });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];
  const declarations = `
    varying vec3 vArmorP;
    varying vec3 vMechP;
    uniform float uFrameTime;
    uniform float uBuild;
    uniform float uDamage;
    uniform float uDissolve;
    uniform vec3 uFrameGlow;
    float armorHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 39.425))) * 43758.5453); }
  `;
  function inject(shader: Shader, surface: boolean) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vArmorP; varying vec3 vMechP; uniform mat4 uMechInverse;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', `#include <project_vertex>
        vArmorP = position;
        vMechP = (uMechInverse * modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = declarations + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float buildHeight = vMechP.y / ${MECH_HEIGHT.toFixed(1)};
      if (uBuild < 0.999 && buildHeight > uBuild) discard;
      if (uDissolve > 0.0 && armorHash(floor(vArmorP * 65.0)) < uDissolve) discard;`);
    if (surface) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cell = abs(fract(vArmorP * 3.5) - 0.5);
        float seam = smoothstep(0.46, 0.485, max(cell.x, max(cell.y, cell.z)));
        float caution = step(0.64, fract((vArmorP.x + vArmorP.y) * 9.0));
        diffuseColor.rgb *= mix(1.0, 0.3, seam);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.48, 0.18) * (0.3 + caution * 0.7), seam * 0.15);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float construction = (1.0 - smoothstep(0.0, 0.04, abs(buildHeight - uBuild))) * step(uBuild, 0.995);
        float circuit = pow(max(0.0, sin(vArmorP.y * 40.0 + uFrameTime * 1.2)), 24.0) * seam;
        totalEmissiveRadiance += uFrameGlow * (construction * 5.0 + circuit * 0.12);
        totalEmissiveRadiance += vec3(1.0, 0.18, 0.025) * uDamage * armorHash(floor(vArmorP * 15.0)) * 0.65;`);
    }
  }
  material.onBeforeCompile = shader => inject(shader, true);
  depth.onBeforeCompile = shader => inject(shader, false);
  material.customProgramCacheKey = () => 'finale-pbr-armor-v3';
  depth.customProgramCacheKey = () => 'finale-pbr-armor-depth-v3';
  return { material, depth, uniforms,
    update(root: THREE.Object3D, time: number, build: number, damage: number, dissolve: number) {
      root.updateMatrixWorld(true); uniforms.uMechInverse.value.copy(root.matrixWorld).invert();
      uniforms.uFrameTime.value = time; uniforms.uBuild.value = build;
      uniforms.uDamage.value = damage; uniforms.uDissolve.value = dissolve;
    },
    dispose() { material.dispose(); depth.dispose(); textures.dispose(); },
  };
}

export function createEnergyMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; uniform float uPower; varying vec2 vUv;
      void main() {
        float edge = pow(max(0.0, 1.0 - abs(vUv.x * 2.0 - 1.0)), 1.4);
        float noise = 0.75 + 0.25 * sin(vUv.y * 50.0 - uTime * 19.0 + sin(vUv.x * 37.0));
        gl_FragColor = vec4(uColor * (1.5 + edge * 1.7), edge * noise * uPower);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
}
