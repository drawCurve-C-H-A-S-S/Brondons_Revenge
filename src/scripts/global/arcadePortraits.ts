import * as THREE from "three";
import {
  loadPlayableCharacterModel,
  PLAYABLE_CHARACTERS,
  type PlayableCharacter,
} from "../../core/loader.js";
import { disposeRoom } from "./shipRoom.js";

export function frameCharacterHeadshot(
  model: THREE.Object3D,
  camera: THREE.OrthographicCamera,
) {
  model.updateMatrixWorld(true);
  const head = model.getObjectByName("Head");
  if (!head) throw new Error("A character portrait requires the Head bone");
  const target = head.getWorldPosition(new THREE.Vector3());
  target.y -= 0.06;
  camera.position.copy(target).add(new THREE.Vector3(0.08, 0.02, 3));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

export async function renderArcadePortraits() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const portraits = new Map<PlayableCharacter, string>();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.4, 0.4, 0.4, -0.4, 0.1, 10);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9dcfff, 1);
  fill.position.set(-2, 1, 2);
  scene.add(fill);
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(256, 256);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    for (const character of PLAYABLE_CHARACTERS) {
      const asset = await loadPlayableCharacterModel(character);
      const mixer = new THREE.AnimationMixer(asset.scene);
      try {
        const idle = asset.animations.find((clip) => clip.name === "Idle_Loop");
        if (!idle)
          throw new Error(`${character} has no portrait idle animation`);
        mixer.clipAction(idle).play();
        mixer.setTime(0.3);
        frameCharacterHeadshot(asset.scene, camera);
        scene.add(asset.scene);
        renderer.render(scene, camera);
        portraits.set(character, renderer.domElement.toDataURL("image/png"));
      } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(asset.scene);
        asset.scene.removeFromParent();
        const skeletons = new Set<THREE.Skeleton>();
        asset.scene.traverse((node) => {
          if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
        });
        skeletons.forEach((skeleton) => skeleton.dispose());
        disposeRoom(asset.scene);
      }
    }
    return portraits;
  } finally {
    renderer.dispose();
  }
}
