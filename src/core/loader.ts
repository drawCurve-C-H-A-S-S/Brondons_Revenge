import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import subjectModelUrl from '../assets/models/Subject.glb';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import dinoModelUrl from '../assets/models/Dino/dino.glb';
import sharkModelUrl from '../assets/models/Dino/Shark.glb';

const gltfLoader = new GLTFLoader();
const playerLoader = new GLTFLoader();
const playerTemplates = new WeakMap<GLTFLoader, Promise<GLTF>>();

/** Decode the player asset once; each view gets an independent skeleton and mixer. */
export async function loadPlayerModel(loader = playerLoader) {
  let pending = playerTemplates.get(loader);
  if (!pending) {
    pending = loader.loadAsync(subjectModelUrl).catch(error => {
      playerTemplates.delete(loader);
      throw error;
    });
    playerTemplates.set(loader, pending);
  }
  const template = await pending;
  return { ...template, scene: cloneRig(template.scene), animations: template.animations.slice() };
}

// Only bundle the tools used by gameplay, including their external dependencies.
const toolAssets = import.meta.glob<string>([
  '../assets/models/Tools/Enemy_Trilobite.{gltf,bin}',
  '../assets/models/Tools/Enemy_QuadShell.{gltf,bin}',
  '../assets/models/Tools/Enemy_EyeDrone.{gltf,bin}',
  '../assets/models/Tools/Gun_Pistol.{gltf,bin}',
  '../assets/models/Tools/Gun_Revolver.{gltf,bin}',
  '../assets/models/Tools/Prop_Chest.{gltf,bin}',
  '../assets/textures/*.png',
], { eager: true, query: '?url', import: 'default' });
const toolUrls = new Map(Object.entries(toolAssets).map(([path, url]) => [path.split('/').pop()!, url]));
gltfLoader.manager.setURLModifier(url => {
  const filename = decodeURIComponent(url).split(/[?#]/, 1)[0].split(/[\\/]/).pop();
  return filename ? toolUrls.get(filename) ?? url : url;
});

/** Resolve glTF dependencies through Vite in both dev and hashed production builds. */
export async function loadToolModel(name: 'Enemy_Trilobite' | 'Enemy_QuadShell' | 'Enemy_EyeDrone' | 'Gun_Pistol' | 'Gun_Revolver' | 'Prop_Chest') {
  const url = toolUrls.get(`${name}.gltf`);
  if (!url) throw new Error(`Missing tool asset: ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Loading ${name}: HTTP ${response.status}`);
  const json = await response.json();
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!entry.uri || entry.uri.startsWith('data:')) continue;
    const resolved = toolUrls.get(decodeURIComponent(entry.uri).split('/').pop()!);
    if (!resolved) throw new Error(`Missing dependency for ${name}: ${entry.uri}`);
    entry.uri = new URL(resolved, document.baseURI).href;
  }
  return gltfLoader.parseAsync(JSON.stringify(json), '');
}

/** Load the rig and animation together so cloned dinosaurs can share the source asset. */
export async function loadDinoModel() {
  const gltf = await gltfLoader.loadAsync(dinoModelUrl);
  gltf.scene.traverse(node => {
    if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; }
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

/** Load the rigged river shark together with its authored swim animation. */
export async function loadSharkModel() {
  const gltf = await gltfLoader.loadAsync(sharkModelUrl);
  gltf.scene.traverse(node => {
    if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; }
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

// Set up Draco decoder for compressed models
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
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
      }
    );
  });
}

/**
 * Load a GLTF with full data (animations, scenes, etc).
 * Use this when you need access to gltf.animations or multiple scenes.
 */
export function loadGLTF(path: string): Promise<THREE.Group & { animations: THREE.AnimationClip[] }> {
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
        const result = gltf.scene as THREE.Group & { animations: THREE.AnimationClip[] };
        result.animations = gltf.animations;
        resolve(result);
      },
      undefined,
      (error) => {
        console.error(`Failed to load GLTF: ${path}`, error);
        reject(error);
      }
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
      }
    );
  });
}
