import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { loadBrandenModel, loadBrendanModel } from "../../core/loader.js";
import { FINALE_DURATION, type FinalePhase } from "../global/finaleDirector.js";
import { captureFinaleResources, normalizeFinaleActor } from "./finaleActors.js";

export const REMEMBRANCE_START = 4.2;

export function createFinaleRemembrance(scene: THREE.Scene, viewCamera: THREE.PerspectiveCamera) {
  const root = new THREE.Group();
  root.name = "BrondonRemorse";
  root.visible = false;
  root.userData.minimap = false;
  root.userData.preserveComicAppearance = true;
  scene.add(root);
  const ghosts: {
    model: THREE.Object3D;
    creditsModel: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    action: THREE.AnimationAction;
    animations: THREE.AnimationClip[];
  }[] = [];
  const ghostMaterials = new Set<THREE.MeshBasicMaterial>();
  const resources: ReturnType<typeof captureFinaleResources>[] = [];
  const camera = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  let disposed = false, active = false, clock = 0;
  const ready = Promise.all([loadBrandenModel(), loadBrendanModel()]).then((assets) => {
    assets.forEach((asset, index) => {
      const owned = captureFinaleResources(asset.scene);
      if (disposed) {
        owned.dispose();
        return;
      }
      resources.push(owned);
      // Credits keep the solid authored palette, independent of the memory effect.
      const creditsModel = clone(asset.scene);
      resources.push(captureFinaleResources(creditsModel, true));
      const actor = new THREE.Group();
      actor.name = index === 0 ? "MemoryOfBranden" : "MemoryOfBrendan";
      actor.position.set(index === 0 ? -4.5 : 4.5, 17, 5);
      actor.rotation.y = Math.PI;
      actor.add(normalizeFinaleActor(asset.scene, 6));
      const tint = new THREE.Color(index === 0 ? 0xdfbacb : 0xb9d8e9);
      const converted = new Map<THREE.Material, THREE.MeshBasicMaterial>();
      asset.scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const material = (source: THREE.Material) => {
          const cached = converted.get(source);
          if (cached) return cached;
          const textured = source instanceof THREE.MeshStandardMaterial ||
            source instanceof THREE.MeshBasicMaterial;
          const copy = new THREE.MeshBasicMaterial({
            color: textured ? source.color.clone().lerp(tint, 0.6) : tint,
            map: textured ? source.map : null,
            transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
          });
          converted.set(source, copy);
          ghostMaterials.add(copy);
          return copy;
        };
        node.material = Array.isArray(node.material) ? node.material.map(material) : material(node.material);
        node.castShadow = false;
        node.receiveShadow = false;
        node.renderOrder = 2;
      });
      const idle = asset.animations.find((clip) => clip.name === "Idle_Loop");
      if (!idle) throw new Error(`${actor.name} needs its authored Idle_Loop animation`);
      const mixer = new THREE.AnimationMixer(asset.scene);
      const action = mixer.clipAction(idle).play();
      action.paused = true;
      ghosts.push({
        model: asset.scene,
        creditsModel,
        mixer,
        action,
        animations: asset.animations,
      });
      root.add(actor);
    });
  });
  return {
    ready,
    getCreditsCast() {
      return ghosts.map((ghost, index) => ({
        name: index === 0 ? "Branden" : "Brendan",
        model: ghost.creditsModel,
        animations: ghost.animations,
      }));
    },
    get active() { return active; },
    update(phase: FinalePhase, time: number, hero: THREE.Object3D) {
      active = !disposed && (
        (phase === "victory" && time >= REMEMBRANCE_START) ||
        phase === "credits" || phase === "done"
      );
      root.visible = active;
      if (!active) return;
      clock = phase === "victory" ? time : FINALE_DURATION.victory + time;
      root.position.copy(hero.position);
      root.rotation.y = hero.rotation.y;
      root.updateMatrixWorld(true);
      const appear = THREE.MathUtils.smootherstep(clock, 5.3, 6.6);
      const fade = 1 - THREE.MathUtils.smootherstep(clock, 14.5, 17.8);
      ghostMaterials.forEach((material) => { material.opacity = appear * fade * 0.68; });
      ghosts.forEach(({ mixer, action }, index) => {
        action.time = (clock * 0.5 + index * 0.7) % action.getClip().duration;
        mixer.update(0);
      });
      camera.position.copy(root.localToWorld(new THREE.Vector3(
        0, -4, -32 * Math.max(1, 1 / viewCamera.aspect),
      )));
      camera.target.copy(root.localToWorld(new THREE.Vector3(0, 11, 3.8)));
    },
    getCamera() { return active ? camera : undefined; },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      ghosts.forEach(({ model, mixer }) => {
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
      });
      resources.forEach((resource) => resource.dispose());
      ghostMaterials.forEach((material) => material.dispose());
      root.removeFromParent();
    },
  };
}
