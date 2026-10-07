import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import playerModelUrl from "../assets/models/brondonv2rigged.glb";
import subjectModelUrl from "../assets/models/Subject.glb";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import dinoModelUrl from "../assets/models/Dino/dino.glb";
import sharkModelUrl from "../assets/models/Dino/Shark.glb";
import bossModelUrl from "../assets/models/bayboss.glb";
import boyModelUrl from "../assets/models/boy.glb";

const gltfLoader = new GLTFLoader();
const playerLoader = new GLTFLoader();
const playerTemplates = new WeakMap<GLTFLoader, Promise<GLTF>>();
const modelTemplates = new Map<string, Promise<GLTF>>();
type ToolModelName =
  | "Enemy_Trilobite"
  | "Enemy_QuadShell"
  | "Enemy_EyeDrone"
  | "Gun_Pistol"
  | "Gun_Revolver"
  | "Prop_Chest";
const toolTemplates = new Map<ToolModelName, Promise<GLTF>>();

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
    pending = gltfLoader.loadAsync(url).catch((error) => {
      modelTemplates.delete(url);
      throw error;
    });
    modelTemplates.set(url, pending);
  }
  return pending;
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
    if (!(node instanceof THREE.Mesh)) return;
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
    modelTemplate(boyModelUrl),
    toolTemplate("Enemy_EyeDrone"),
  ]);
}

export async function loadBossModel() {
  return cloneModel(await modelTemplate(bossModelUrl));
}
export async function loadBoyModel() {
  return cloneModel(await modelTemplate(boyModelUrl));
}
export async function loadSubjectModel() {
  return cloneModel(await modelTemplate(subjectModelUrl));
}
export async function preloadToolModel(name: ToolModelName) {
  await toolTemplate(name);
}

/** Decode the player asset once; each view gets an independent skeleton and mixer. */
export async function loadPlayerModel(loader = playerLoader) {
  let pending = playerTemplates.get(loader);
  if (!pending) {
    pending = loader
      .loadAsync(playerModelUrl)
      .then((template) => {
        template.scene.updateMatrixWorld(true);
        template.scene.traverse((node) => {
          if (node instanceof THREE.SkinnedMesh) node.skeleton.update();
        });
        const height = new THREE.Box3()
          .setFromObject(template.scene)
          .getSize(new THREE.Vector3()).y;
        if (!Number.isFinite(height) || height <= 0)
          throw new Error("MC character has invalid bounds");
        template.scene.scale.multiplyScalar(1.83 / height);
        const scene = new THREE.Group();
        scene.name = "MC Player";
        scene.add(template.scene);
        scene.updateMatrixWorld(true);
        return { ...template, scene, scenes: [scene] };
      })
      .catch((error) => {
        playerTemplates.delete(loader);
        throw error;
      });
    playerTemplates.set(loader, pending);
  }
  const template = await pending;
  return {
    ...template,
    scene: cloneRig(template.scene),
    animations: template.animations.slice(),
  };
}

// Only bundle the tools used by gameplay, including their external dependencies.
const toolAssets = import.meta.glob<string>(
  [
    "../assets/models/Tools/Enemy_Trilobite.{gltf,bin}",
    "../assets/models/Tools/Enemy_QuadShell.{gltf,bin}",
    "../assets/models/Tools/Enemy_EyeDrone.{gltf,bin}",
    "../assets/models/Tools/Gun_Pistol.{gltf,bin}",
    "../assets/models/Tools/Gun_Revolver.{gltf,bin}",
    "../assets/models/Tools/Prop_Chest.{gltf,bin}",
    "../assets/textures/*.png",
  ],
  { eager: true, query: "?url", import: "default" },
);
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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Loading ${name}: HTTP ${response.status}`);
  const json = await response.json();
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!entry.uri || entry.uri.startsWith("data:")) continue;
    const resolved = toolUrls.get(
      decodeURIComponent(entry.uri).split("/").pop()!,
    );
    if (!resolved)
      throw new Error(`Missing dependency for ${name}: ${entry.uri}`);
    entry.uri = new URL(resolved, document.baseURI).href;
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
  return cloneModel(await toolTemplate(name));
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
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      path,
      (gltf) => {
        // Enable shadows on all meshes in the model
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      (error) => {
        console.error(`Failed to load model: ${path}`, error);
        reject(error);
      },
    );
  });
}

/**
 * Load a GLTF with full data (animations, scenes, etc).
 * Use this when you need access to gltf.animations or multiple scenes.
 */
export function loadGLTF(
  path: string,
): Promise<THREE.Group & { animations: THREE.AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      path,
      (gltf) => {
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        const result = gltf.scene as THREE.Group & {
          animations: THREE.AnimationClip[];
        };
        result.animations = gltf.animations;
        resolve(result);
      },
      undefined,
      (error) => {
        console.error(`Failed to load GLTF: ${path}`, error);
        reject(error);
      },
    );
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
      path,
      (texture) => resolve(texture),
      undefined,
      (error) => {
        console.error(`Failed to load texture: ${path}`, error);
        reject(error);
      },
    );
  });
}
