import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const gltfLoader = new GLTFLoader();

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
