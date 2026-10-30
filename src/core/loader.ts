import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import playerModelUrl from "../assets/models/Don.glb";
import mcModelUrl from "../assets/models/MC.glb";
import subjectModelUrl from "../assets/models/Subject.glb";
import calebModelUrl from "../assets/models/Caleb.glb";
import husainModelUrl from "../assets/models/Husain.glb";
import andreModelUrl from "../assets/models/Andre.glb";
import sibusisoModelUrl from "../assets/models/Sibusiso.glb";
import sohrabModelUrl from "../assets/models/Sohrab.glb";
import finaleMechModelUrl from "../assets/models/mechs.glb";
import brendanModelUrl from "../assets/models/DonfromStreets.glb";
import brandenModelUrl from "../assets/models/branden-the-dripless-export.glb";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import dinoModelUrl from "../assets/models/Dino/dino.glb";
import sharkModelUrl from "../assets/models/Dino/Shark.glb";
import bossModelUrl from "../assets/models/bayboss.glb";
import mothershipModelUrl from "../assets/models/mothership.glb";
import gundamModelUrl from "../assets/models/gundam.glb";
import vergilsChairUrl from "../assets/models/vergils chair.glb";
import toiletUrl from "../assets/models/toilet (1).glb";
import toiletPaperUrl from "../assets/models/toilet_paper.glb";
import {
  assetUrl,
  cachedAssetUrl,
  fetchAsset,
  type PreloadTask,
} from "./assetCache.js";
import playerCelUniforms from "../shaders/frag/playerCelUniforms.frag.glsl?raw";
import playerCelFragment from "../shaders/frag/playerCel.frag.glsl?raw";
import { applyDroneGlow, applyScavengerAppearance } from "./robotAppearance.js";
import { addCharacterInk } from "./comicShading.js";
import {
  createEarthGroup,
  createEarthTextures,
  preloadEarthTextures,
} from "../scripts/global/earthTexture.js";
import earthTextureUrl from "../assets/planets/earth-maps.rgba.bin?url";

const gltfLoader = new GLTFLoader();
const playerLoader = new GLTFLoader();
THREE.Cache.enabled = true;
const playerTemplates = new WeakMap<GLTFLoader, Promise<GLTF>>();
const modelTemplates = new Map<string, Promise<GLTF>>();
export const TOOL_MODEL_NAMES = [
  "Enemy_Trilobite",
  "Enemy_QuadShell",
  "Enemy_EyeDrone",
  "Gun_Pistol",
  "Gun_Revolver",
  "Gun_Rifle",
  "Prop_Chest",
  "Prop_Desk_Small",
  "Prop_Chair",
  "Prop_KeyCard",
] as const;
type ToolModelName = (typeof TOOL_MODEL_NAMES)[number];
const toolTemplates = new Map<ToolModelName, Promise<GLTF>>();
export const PLAYABLE_CHARACTER_NAMES = {
  brondon: "Brondon",
  brendan: "Brendan",
  branden: "Branden",
  caleb: "Caleb",
  husain: "Husain",
  andre: "André",
  sibusiso: "Sibusiso",
  sohrab: "Sohrab",
} as const;
export type PlayableCharacter = keyof typeof PLAYABLE_CHARACTER_NAMES;
export function isPlayableCharacter(value: unknown): value is PlayableCharacter {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PLAYABLE_CHARACTER_NAMES, value);
}
export const PLAYABLE_CHARACTERS =
  Object.keys(PLAYABLE_CHARACTER_NAMES).filter(isPlayableCharacter);
export const STUDENT_MODEL_URLS: ReadonlyMap<string, string> = new Map([
  ["Caleb", calebModelUrl],
  ["Husain", husainModelUrl],
  ["André", andreModelUrl],
  ["Sibusiso", sibusisoModelUrl],
  ["Sohrab", sohrabModelUrl],
]);

export function yieldToMainThread(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield: () => Promise<void> };
    }
  ).scheduler;
  return scheduler?.yield
    ? scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0));
}

function modelTemplate(url: string) {
  let pending = modelTemplates.get(url);
  if (!pending) {
    pending = assetUrl(url)
      .then((source) => gltfLoader.loadAsync(source))
      .then((asset) => {
        if ([...STUDENT_MODEL_URLS.values()].includes(url))
          removeStudentHeadBlocks(asset.scene);
        if ([
          playerModelUrl, mcModelUrl, subjectModelUrl, brendanModelUrl, brandenModelUrl,
          dinoModelUrl, sharkModelUrl, bossModelUrl, mothershipModelUrl,
          gundamModelUrl, finaleMechModelUrl,
        ].includes(url))
          asset.scene.userData.preserveComicAppearance = true;
        return asset;
      })
      .catch((error) => {
        modelTemplates.delete(url);
        throw error;
      });
    modelTemplates.set(url, pending);
  }
  return pending;
}

function removeStudentHeadBlocks(scene: THREE.Object3D) {
  const blocks: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (
      node instanceof THREE.Mesh &&
      !(node instanceof THREE.SkinnedMesh) &&
      /^(Cube|Cube\.?001)$/.test(node.name)
    )
      blocks.push(node);
  });
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  for (const block of blocks) {
    block.removeFromParent();
    geometries.add(block.geometry);
    for (const material of Array.isArray(block.material)
      ? block.material
      : [block.material])
      materials.add(material);
  }
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.delete(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      materials.delete(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function cloneModel(template: GLTF): GLTF {
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const copyMaterial = (source: THREE.Material) => {
    let copy = materials.get(source);
    if (!copy) {
      copy = source.clone();
      for (const property of Object.keys(source)) {
        const value = Reflect.get(source, property);
        if (!(value instanceof THREE.Texture)) continue;
        let texture = textures.get(value);
        if (!texture) {
          texture = value.clone();
          textures.set(value, texture);
        }
        Reflect.set(copy, property, texture);
      }
      materials.set(source, copy);
    }
    return copy;
  };
  const scene = cloneRig(template.scene) as THREE.Group;
  scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh)
      scene.userData.preserveComicAppearance = true;
  });
  scene.traverse((node) => {
    if (!(
      node instanceof THREE.Mesh ||
      node instanceof THREE.LineSegments ||
      node instanceof THREE.Points
    ))
      return;
    const original = node.geometry;
    let geometry = geometries.get(original);
    if (!geometry) {
      const copy = original.clone() as THREE.BufferGeometry;
      geometries.set(original, copy);
      geometry = copy;
    }
    node.geometry = geometry;
    node.material = Array.isArray(node.material)
      ? node.material.map(copyMaterial)
      : copyMaterial(node.material);
  });
  return {
    ...template,
    scene,
    scenes: [scene],
    animations: template.animations.slice(),
  };
}

export async function preloadBossModels() {
  await Promise.all([
    modelTemplate(bossModelUrl),
    modelTemplate(subjectModelUrl),
    modelTemplate(brandenModelUrl),
    toolTemplate("Enemy_EyeDrone"),
  ]);
}

export async function loadBossModel() {
  return cloneModel(await modelTemplate(bossModelUrl));
}
export async function loadBoyModel() {
  const gltf = await loadSubjectModel();
  const palette = {
    boots: new THREE.Color(0x202630),
    shorts: new THREE.Color(0x66513d),
    shirt: new THREE.Color(0x528ba8),
    skin: new THREE.Color(0xb47d58),
    hair: new THREE.Color(0x33251e),
  };
  const bounds = new THREE.Box3().setFromObject(gltf.scene),
    height = bounds.getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(height) || height <= 0)
    throw new Error("Brendan model has invalid body bounds");
  const color = new THREE.Color();
  const removedMaps = new Set<THREE.Texture>();
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.roughness = 0.88;
      material.metalness = 0;
      if (material.name === "SuitBase" || material.name === "SubjectSkin") {
        const positions = node.geometry.getAttribute("position");
        if (!positions) return;
        const colors = new Float32Array(positions.count * 3);
        for (let index = 0; index < positions.count; index++) {
          const y = (positions.getY(index) - bounds.min.y) / height;
          const bareArm =
            Math.abs(positions.getX(index)) > height * 0.19 && y > 0.58;
          const exposedSkin =
            bareArm || (material.name === "SubjectSkin" && y > 0.8);
          color.copy(
            material.name === "SubjectSkin" && y < 0.075
              ? palette.boots
              : exposedSkin
                ? palette.skin
                : y > 0.53
                  ? palette.shirt
                  : y > 0.31
                    ? palette.shorts
                    : palette.skin,
          );
          color.toArray(colors, index * 3);
        }
        node.geometry.setAttribute(
          "color",
          new THREE.BufferAttribute(colors, 3),
        );
        material.color.set(0xffffff);
        material.vertexColors = true;
      } else if (
        material.name === "SoldierSkin" ||
        material.name === "SuitGloves"
      )
        material.color.copy(palette.skin);
      else if (material.name === "SoldierHair")
        material.color.copy(palette.hair);
      else if (material.name === "SuitBoots")
        material.color.copy(palette.boots);
      else if (material.name === "SoldierGlasses") material.visible = false;
      if (material.name === "SuitBase" || material.name === "SuitGloves") {
        if (material.map) removedMaps.add(material.map);
        material.map = null;
      }
    }
  });
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) removedMaps.delete(value);
  });
  removedMaps.forEach((texture) => texture.dispose());
  return gltf;
}
export async function loadMCModel() {
  return cloneModel(await modelTemplate(mcModelUrl));
}
export async function loadFinaleMechModel() {
  return cloneModel(await modelTemplate(finaleMechModelUrl));
}
export async function loadBrendanModel() {
  const model = cloneModel(await modelTemplate(brendanModelUrl));
  applyPlayerCelShading(model.scene);
  return model;
}
export async function loadBrandenModel() {
  const model = cloneModel(await modelTemplate(brandenModelUrl));
  applyPlayerCelShading(model.scene);
  return model;
}
export async function loadSubjectModel() {
  return cloneModel(await modelTemplate(subjectModelUrl));
}
export async function loadStudentModel(name: string) {
  const url = STUDENT_MODEL_URLS.get(name);
  if (!url) throw new Error(`No student character model for ${name}`);
  const model = cloneModel(await modelTemplate(url));
  model.scene.name = name;
  applyPlayerCelShading(model.scene);
  return model;
}
export async function loadGundamModel() {
  return cloneModel(await modelTemplate(gundamModelUrl));
}
export async function loadEarthModel() {
  await preloadEarthTextures(earthTextureUrl);
  const scene = new THREE.Group();
  scene.name = "Earth";
  createEarthGroup(scene, new THREE.Vector3(), 1, createEarthTextures());
  return { scene, animations: [] };
}

/** The authored backrest sits on -Z, the opposite of Prop_Chair, so callers add half a turn. */
export async function loadVergilsChair() {
  return cloneModel(await modelTemplate(vergilsChairUrl));
}
export async function preloadToolModel(name: ToolModelName) {
  await toolTemplate(name);
}

const playerCelShading = new WeakMap<THREE.Object3D, { value: number }>();

export function setPlayerCellShadingEnabled(
  scene: THREE.Object3D,
  enabled: boolean,
) {
  const uniform = playerCelShading.get(scene);
  if (uniform) uniform.value = enabled ? 1 : 0;
}

export function applyPlayerCelShading(
  scene: THREE.Object3D,
  preserveEmissiveEffects = false,
) {
  const enabled = { value: 1 };
  playerCelShading.set(scene, enabled);
  const materials = new Set<THREE.MeshStandardMaterial>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (
        !(material instanceof THREE.MeshStandardMaterial) ||
        materials.has(material)
      )
        continue;
      materials.add(material);
      const baseColor =
        material.emissive.getHex() !== 0
          ? material.emissive
          : material.color;
      const unshaded = /faceskin|eyewhites/i.test(material.name);
      const previousCompile = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey();
      material.customProgramCacheKey = () =>
        `${previousKey}-brondon-two-tone-cel-v2-${preserveEmissiveEffects}`;
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile.call(material, shader, renderer);
        shader.uniforms.uBrondonColor = { value: baseColor };
        shader.uniforms.uBrondonUnshaded = { value: unshaded ? 1 : 0 };
        shader.uniforms.uCellShadingEnabled = enabled;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>\n${playerCelUniforms}`,
          )
          .replace(
            "#include <opaque_fragment>",
            `${playerCelFragment}
            ${preserveEmissiveEffects ? "outgoingLight += max(vec3(0.0), totalEmissiveRadiance - emissive);" : ""}
            #include <opaque_fragment>`,
          );
      };
      material.needsUpdate = true;
    }
  });
}

/** Area-weighted palette of the same material colors used by character cel shading. */
export function characterDominantColor(root: THREE.Object3D): number {
  const bins = new Map<string, { area: number; color: THREE.Color }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || /ink|outline|weapon|bloomstick/i.test(node.name)) return;
    for (let ancestor: THREE.Object3D | null = node; ancestor && ancestor !== root; ancestor = ancestor.parent)
      if (!ancestor.visible) return;
    const geometry = node.geometry, positions = geometry.getAttribute("position");
    if (!positions) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? positions.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) ||
          !material.visible || material.opacity < 0.5 || /outline|linework/i.test(material.name)) continue;
      const tint = material instanceof THREE.MeshStandardMaterial && material.emissive.getHex() !== 0
        ? material.emissive : material.color;
      const key = [tint.r, tint.g, tint.b].map((value) => Math.round(value * 12)).join(":");
      let area = 0;
      const stride = Math.max(1, Math.ceil(group.count / 3 / 1500)) * 3;
      const end = Math.min(group.start + group.count, geometry.index?.count ?? positions.count);
      for (let triangle = group.start; triangle + 2 < end; triangle += stride) {
        const vertex = (offset: number) => geometry.index?.getX(triangle + offset) ?? triangle + offset;
        a.fromBufferAttribute(positions, vertex(0)).applyMatrix4(node.matrixWorld);
        b.fromBufferAttribute(positions, vertex(1)).applyMatrix4(node.matrixWorld).sub(a);
        c.fromBufferAttribute(positions, vertex(2)).applyMatrix4(node.matrixWorld).sub(a);
        area += b.cross(c).length() * stride / 6;
      }
      if (!Number.isFinite(area) || area <= 0) continue;
      const bin = bins.get(key) ?? { area: 0, color: new THREE.Color(0, 0, 0) };
      bin.area += area;
      bin.color.add(tint.clone().multiplyScalar(area));
      bins.set(key, bin);
    }
  });
  const dominant = [...bins.values()].sort((a, b) => b.area - a.area)[0];
  if (!dominant) return 0x00ff88;
  const tint = dominant.color.multiplyScalar(1 / dominant.area);
  const hsl = tint.getHSL({ h: 0, s: 0, l: 0 });
  // Dark outfits retain their hue, with enough luminance to read as emitted light.
  tint.setHSL(hsl.h, hsl.s, Math.max(0.38, hsl.l));
  return tint.getHex();
}

function normalizePlayerModel(template: GLTF, name: string): GLTF {
  template.scene.updateMatrixWorld(true);
  template.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update();
  });
  const height = new THREE.Box3()
    .setFromObject(template.scene)
    .getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(height) || height <= 0)
    throw new Error(`${name} character has invalid bounds`);
  template.scene.scale.multiplyScalar(1.83 / height);
  const scene = new THREE.Group();
  scene.name = `${name} Player`;
  scene.add(template.scene);
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.update();
  });
  return { ...template, scene, scenes: [scene] };
}

/** Decode the player asset once; each view gets an independent skeleton and mixer. */
export async function loadPlayerModel(loader = playerLoader) {
  let pending = playerTemplates.get(loader);
  if (!pending) {
    const loading =
      loader === playerLoader
        ? assetUrl(playerModelUrl).then((source) => loader.loadAsync(source))
        : loader.loadAsync(playerModelUrl);
    pending = loading
      .then((template) => normalizePlayerModel(template, "MC"))
      .catch((error) => {
        playerTemplates.delete(loader);
        throw error;
      });
    playerTemplates.set(loader, pending);
  }
  const template = await pending;
  const model = cloneModel(template);
  // Install on the clone: Three.js material cloning does not retain shader hooks.
  applyPlayerCelShading(model.scene);
  addCharacterInk(model.scene);
  return model;
}

export async function loadPlayableCharacterModel(
  character: PlayableCharacter,
  loader?: GLTFLoader,
) {
  if (character === "brondon") return loadPlayerModel(loader);
  const name = PLAYABLE_CHARACTER_NAMES[character];
  const url = character === "brendan"
    ? brendanModelUrl
    : character === "branden"
      ? brandenModelUrl
      : STUDENT_MODEL_URLS.get(name);
  if (!url) throw new Error(`Unknown playable character: ${character}`);
  const template = loader
    ? await loader.loadAsync(url)
    : await modelTemplate(url);
  const asset = cloneModel(template);
  if (STUDENT_MODEL_URLS.has(name)) removeStudentHeadBlocks(asset.scene);
  const model = normalizePlayerModel(
    asset,
    name,
  );
  applyPlayerCelShading(model.scene);
  addCharacterInk(model.scene);
  model.scene.updateMatrixWorld(true);
  return model;
}

// Only bundle the tools used by gameplay, including their external dependencies.
const toolAssets = import.meta.glob<string>(
  [
    "../assets/models/Tools/Enemy_Trilobite.{gltf,bin}",
    "../assets/models/Tools/Enemy_QuadShell.{gltf,bin}",
    "../assets/models/Tools/Enemy_EyeDrone.{gltf,bin}",
    "../assets/models/Tools/Gun_Pistol.{gltf,bin}",
    "../assets/models/Tools/Gun_Revolver.{gltf,bin}",
    "../assets/models/Tools/Gun_Rifle.{gltf,bin}",
    "../assets/models/Tools/Prop_Chest.{gltf,bin}",
    "../assets/models/Tools/Prop_Desk_Small.{gltf,bin}",
    "../assets/models/Tools/Prop_Chair.{gltf,bin}",
    "../assets/models/Tools/Prop_KeyCard.{gltf,bin}",
    "../assets/textures/T_Enemies{,_Large}_{Normal,BaseColor,BaseColor_png,ORM}.png",
    "../assets/textures/T_Guns_Batch{1,2}_{Normal,BaseColor,ORM}.png",
    "../assets/textures/T_Props_Batch{1,2}_{Normal,BaseColor,ORM}.png",
    "../assets/textures/T_Trim_03_{Normal,Cables,ORM,BaseColor}.png",
    "../assets/textures/T_Trim_01_{Normal,BaseColor_Red,ORM}.png",
  ],
  { eager: true, query: "?url", import: "default" },
);
export const MODEL_ASSET_URLS = [
  playerModelUrl,
  mcModelUrl,
  subjectModelUrl,
  ...STUDENT_MODEL_URLS.values(),
  finaleMechModelUrl,
  brendanModelUrl,
  brandenModelUrl,
  dinoModelUrl,
  sharkModelUrl,
  bossModelUrl,
  mothershipModelUrl,
  gundamModelUrl,
  vergilsChairUrl,
  toiletUrl,
  toiletPaperUrl,
  ...Object.values(toolAssets),
];
const toolUrls = new Map(
  Object.entries(toolAssets).map(([path, url]) => [
    path.split("/").pop()!,
    url,
  ]),
);
gltfLoader.manager.setURLModifier((url) => {
  const filename = decodeURIComponent(url)
    .split(/[?#]/, 1)[0]
    .split(/[\\/]/)
    .pop();
  return filename ? (toolUrls.get(filename) ?? url) : url;
});

async function fetchToolModel(name: ToolModelName) {
  const url = toolUrls.get(`${name}.gltf`);
  if (!url) throw new Error(`Missing tool asset: ${name}`);
  const response = await fetchAsset(url);
  if (!response.ok) throw new Error(`Loading ${name}: HTTP ${response.status}`);
  const json = await response.json();
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!entry.uri || entry.uri.startsWith("data:")) continue;
    const resolved = toolUrls.get(
      decodeURIComponent(entry.uri).split("/").pop()!,
    );
    if (!resolved)
      throw new Error(`Missing dependency for ${name}: ${entry.uri}`);
    entry.uri = await assetUrl(resolved);
  }
  return gltfLoader.parseAsync(JSON.stringify(json), "");
}

function toolTemplate(name: ToolModelName) {
  let pending = toolTemplates.get(name);
  if (!pending) {
    pending = fetchToolModel(name).catch((error) => {
      toolTemplates.delete(name);
      throw error;
    });
    toolTemplates.set(name, pending);
  }
  return pending;
}

/** Resolve glTF dependencies through Vite in both dev and hashed production builds. */
export async function loadToolModel(name: ToolModelName) {
  const asset = cloneModel(await toolTemplate(name));
  if (name === "Enemy_Trilobite" || name === "Enemy_QuadShell")
    applyScavengerAppearance(asset.scene);
  if (name === "Enemy_EyeDrone") applyDroneGlow(asset.scene);
  return asset;
}

/** Load the rig and animation together so cloned dinosaurs can share the source asset. */
export async function loadDinoModel() {
  const gltf = cloneModel(await modelTemplate(dinoModelUrl));
  gltf.scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

/** Load the rigged river shark together with its authored swim animation. */
export async function loadSharkModel() {
  const gltf = cloneModel(await modelTemplate(sharkModelUrl));
  gltf.scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

export async function preloadJungleModels() {
  await Promise.all([
    modelTemplate(dinoModelUrl),
    modelTemplate(sharkModelUrl),
  ]);
}

export function modelPreloadTasks(): PreloadTask[] {
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  const lowMemory =
    (memory !== undefined && memory <= 4) ||
    window.matchMedia("(pointer: coarse)").matches;
  const models = lowMemory
    ? [subjectModelUrl, mothershipModelUrl]
    : [
        mcModelUrl,
        subjectModelUrl,
        ...STUDENT_MODEL_URLS.values(),
        dinoModelUrl,
        sharkModelUrl,
        bossModelUrl,
        mothershipModelUrl,
      ];
  const tools: readonly ToolModelName[] = lowMemory
    ? ["Enemy_Trilobite", "Enemy_EyeDrone", "Gun_Revolver"]
    : TOOL_MODEL_NAMES;
  return [
    { label: "Preparing character animations", run: () => loadPlayerModel() },
    ...models.map((url) => ({
      label: "Preparing reusable models",
      run: () => modelTemplate(url),
    })),
    ...tools.map((name) => ({
      label: "Preparing equipment and enemies",
      run: () => toolTemplate(name),
    })),
  ];
}

// Set up Draco decoder for compressed models
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
);
gltfLoader.setDRACOLoader(dracoLoader);

/**
 * Load a .glb or .gltf model.
 * Returns the scene group -- add it to your Three.js scene.
 *
 * Usage:
 *   const model = await loadModel('./assets/models/ship.glb');
 *   scene.add(model);
 */
export function loadModel(path: string): Promise<THREE.Group> {
  return modelTemplate(path).then((template) => {
    const model = cloneModel(template).scene;
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return model;
  });
}

/**
 * Load a GLTF with full data (animations, scenes, etc).
 * Use this when you need access to gltf.animations or multiple scenes.
 */
export function loadGLTF(
  path: string,
): Promise<THREE.Group & { animations: THREE.AnimationClip[] }> {
  return modelTemplate(path).then((template) => {
    const gltf = cloneModel(template);
    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return Object.assign(gltf.scene, { animations: gltf.animations });
  });
}

/**
 * Load a texture image.
 *
 * Usage:
 *   const texture = await loadTexture('./assets/textures/metal.png');
 *   material.map = texture;
 */
export function loadTexture(path: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      cachedAssetUrl(path),
      (texture) => resolve(texture),
      undefined,
      (error) => {
        console.error(`Failed to load texture: ${path}`, error);
        reject(error);
      },
    );
  });
}
