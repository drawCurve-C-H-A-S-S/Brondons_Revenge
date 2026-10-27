import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { FINALE_CREDITS } from "../global/finaleDirector.js";
import { normalizeFinaleActor } from "./finaleActors.js";

export interface FinaleCreditsSource {
  name: string;
  model: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  outcome: "winner" | "kneel" | "fall";
}

export function createFinaleCredits(
  sources: readonly FinaleCreditsSource[],
  reducedMotion: boolean,
) {
  if (sources.length !== 8)
    throw new Error("The credits curtain call requires all eight characters");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050914);
  const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 50);
  camera.position.z = 20;
  const size = new THREE.Vector2();
  const materials = new Set<THREE.MeshBasicMaterial>();
  const castSkeletons = new Set<THREE.Skeleton>();
  const actors: {
    root: THREE.Group;
    model: THREE.Object3D;
    outcome: FinaleCreditsSource["outcome"];
    mixer: THREE.AnimationMixer;
    actions: Record<"dance" | "walk" | "finish", THREE.AnimationAction>;
    mode: "dance" | "walk" | "finish" | "";
  }[] = [];
  let disposed = false;
  let previousTime = -1;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const actor of actors) {
      actor.mixer.stopAllAction();
      actor.mixer.uncacheRoot(actor.model);
      actor.root.removeFromParent();
    }
    castSkeletons.forEach((skeleton) => skeleton.dispose());
    // Geometry, textures and clips belong to the already-loaded campaign cast.
    materials.forEach((material) => material.dispose());
  }

  try {
    sources.forEach((source) => {
      const required = (name: string) => {
        const clip = source.animations.find((entry) => entry.name === name);
        if (!clip)
          throw new Error(
            `${source.name} is missing its cached ${name} animation`,
          );
        return clip;
      };
      const dance = required("Dance_Loop");
      const walk = required("Walk_Loop");
      const finish =
        source.outcome === "winner"
          ? dance
          : required(source.outcome === "kneel" ? "Fixing_Kneeling" : "Death01");
      const model = clone(source.model);
      model.visible = true;
      model.position.set(0, 0, 0);
      model.quaternion.identity();
      const skeletons = new Set<THREE.Skeleton>();
      const hidden: THREE.Object3D[] = [];
      model.traverse((node) => {
        if (!node.visible || node.name === "BrondonComicInk") hidden.push(node);
        if (node instanceof THREE.SkinnedMesh) {
          skeletons.add(node.skeleton);
          castSkeletons.add(node.skeleton);
        }
      });
      hidden.forEach((node) => node.removeFromParent());
      skeletons.forEach((skeleton) => skeleton.pose());
      model.updateMatrixWorld(true);
      const root = new THREE.Group();
      root.name = `Credits_${source.name}`;
      const mixer = new THREE.AnimationMixer(model);
      const actions = {
        dance: mixer.clipAction(dance),
        walk: mixer.clipAction(walk),
        finish: mixer.clipAction(finish),
      };
      if (source.outcome !== "winner") {
        actions.finish.setLoop(THREE.LoopOnce, 1);
        actions.finish.clampWhenFinished = true;
      }
      actors.push({
        root,
        model,
        outcome: source.outcome,
        mixer,
        actions,
        mode: "",
      });
      const converted = new Map<THREE.Material, THREE.MeshBasicMaterial>();
      const convert = (material: THREE.Material) => {
        const cached = converted.get(material);
        if (cached) return cached;
        if (
          !(material instanceof THREE.MeshStandardMaterial) &&
          !(material instanceof THREE.MeshBasicMaterial)
        )
          throw new Error(`${source.name} has an unsupported credits material`);
        const color =
          material instanceof THREE.MeshStandardMaterial &&
          material.emissive.getHex() !== 0
            ? material.emissive
            : material.color;
        const copy = new THREE.MeshBasicMaterial({
          color,
          map: material.map,
          alphaMap: material.alphaMap,
          alphaTest: material.alphaTest,
          side: material.side,
          toneMapped: false,
        });
        converted.set(material, copy);
        materials.add(copy);
        return copy;
      };
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.material = Array.isArray(node.material)
          ? node.material.map(convert)
          : convert(node.material);
        node.castShadow = node.receiveShadow = false;
      });
      root.add(normalizeFinaleActor(model, 1.7));
      scene.add(root);
    });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    render(renderer: THREE.WebGLRenderer, time: number) {
      if (disposed) return;
      renderer.getSize(size);
      const width = Math.max(1, size.x);
      const height = Math.max(1, size.y);
      const viewWidth = (width / height) * 10;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.updateProjectionMatrix();
      const delta =
        previousTime < 0
          ? 0
          : THREE.MathUtils.clamp(time - previousTime, 0, 0.1);
      previousTime = time;
      const ending = time >= FINALE_CREDITS.roll;
      const entranceTime = time - FINALE_CREDITS.roll;
      const posing = entranceTime >= FINALE_CREDITS.walkIn;
      const margin =
        (((width - Math.min(680, width * 0.62)) / width) * viewWidth) / 2;
      const lineupScale = Math.min(1.25, viewWidth / (actors.length * 1.65 + 1.2));
      actors.forEach((actor, index) => {
        const side = ending
          ? index < actors.length / 2
            ? -1
            : 1
          : index % 2
            ? 1
            : -1;
        let mode: "dance" | "walk" | "finish";
        let sample: number;
        actor.root.scale.setScalar(ending ? lineupScale : 1);
        if (!ending) {
          const row = Math.floor(index / 2);
          const drift = reducedMotion
            ? 0
            : Math.sin(time * 0.35 + index) * 0.14;
          actor.root.position.set(
            side * (viewWidth / 2 - margin / 2) + drift,
            (1.5 - row) * 2.25 -
              1 +
              (reducedMotion ? 0 : Math.sin(time * 1.1 + index) * 0.08),
            0,
          );
          actor.root.rotation.y = reducedMotion
            ? 0
            : Math.sin(time * 0.3 + index) * 0.3;
          mode = "dance";
          sample = reducedMotion ? index * 0.37 : time * 0.9 + index * 0.8;
        } else {
          const spacing = 1.65 * lineupScale;
          const targetX = (index - (actors.length - 1) / 2) * spacing;
          const entranceColumn =
            side < 0
              ? actors.length / 2 - 1 - index
              : index - actors.length / 2;
          const entranceX =
            side *
            (viewWidth / 2 + 1.5 * lineupScale + entranceColumn * spacing);
          const walk = THREE.MathUtils.smoothstep(
            entranceTime,
            0,
            FINALE_CREDITS.walkIn,
          );
          actor.root.position.set(
            THREE.MathUtils.lerp(entranceX, targetX, walk),
            -1.1 * lineupScale,
            0,
          );
          actor.root.rotation.y =
            ((-side * Math.PI) / 2) *
            (1 - THREE.MathUtils.smoothstep(walk, 0.78, 1));
          mode = posing
            ? actor.outcome === "winner"
              ? "dance"
              : "finish"
            : "walk";
          sample = posing ? entranceTime - FINALE_CREDITS.walkIn : entranceTime;
          if (posing && actor.outcome === "kneel")
            sample = Math.min(
              sample,
              actor.actions.finish.getClip().duration * 0.42,
            );
          if (posing && actor.outcome === "winner" && reducedMotion)
            sample = actor.actions.dance.getClip().duration * 0.35;
        }
        const next = actor.actions[mode];
        if (actor.mode !== mode) {
          const previous = actor.mode ? actor.actions[actor.mode] : null;
          next.reset().setEffectiveWeight(1).play();
          if (previous) next.crossFadeFrom(previous, 0.28, false);
          actor.mode = mode;
        }
        const duration = next.getClip().duration;
        next.time =
          mode === "finish" ? Math.min(sample, duration) : sample % duration;
        next.paused = true;
        actor.mixer.update(delta);
      });
      const autoClear = renderer.autoClear;
      const target = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(target);
      }
    },
    dispose,
  };
}
