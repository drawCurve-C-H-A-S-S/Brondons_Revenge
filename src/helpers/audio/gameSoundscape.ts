import * as THREE from "three";
import { RECORDED_SOUNDS } from "./recordedSounds.js";
import {
  createSampleEmitter,
  stopSceneAudio,
  type SoundPoint,
} from "./spatialAudio.js";
import { playWorldSfx, setFootstepSurface } from "./sfx.js";

interface SoundTree {
  x: number;
  z: number;
  height: number;
  alive(): boolean;
}

export function createForestSoundscape(
  scene: THREE.Scene,
  trees: readonly SoundTree[],
  visible: () => boolean = () => true,
) {
  let nearest: SoundTree | undefined;
  const previous = new THREE.Vector3(Infinity, 0, Infinity);
  const point = new THREE.Vector3();
  function treePosition(listener: SoundPoint) {
    if (
      !nearest?.alive() ||
      Math.hypot(previous.x - listener.x, previous.z - listener.z) > 2
    ) {
      previous.set(listener.x, listener.y, listener.z);
      let closest = Infinity;
      nearest = undefined;
      for (const tree of trees) {
        const distance =
          (tree.x - listener.x) ** 2 + (tree.z - listener.z) ** 2;
        if (distance < closest && tree.alive()) {
          closest = distance;
          nearest = tree;
        }
      }
    }
    return nearest
      ? point.set(nearest.x, Math.min(7, nearest.height * 0.25), nearest.z)
      : null;
  }
  const loops = [
    createSampleEmitter(RECORDED_SOUNDS.wind[0], scene, treePosition, {
      volume: 0.17,
      radius: 110,
      enabled: visible,
    }),
    createSampleEmitter(RECORDED_SOUNDS.leaves[0], scene, treePosition, {
      volume: 0.2,
      radius: 32,
      enabled: visible,
    }),
    createSampleEmitter(RECORDED_SOUNDS.birds[0], scene, treePosition, {
      volume: 0.13,
      radius: 85,
      enabled: visible,
    }),
  ];
  return { dispose: () => loops.forEach((loop) => loop.dispose()) };
}

export function createMechMovementAudio(
  scene: THREE.Scene,
  root: THREE.Object3D,
) {
  const previous = new THREE.Vector3();
  const current = new THREE.Vector3();
  let initialized = false,
    moving = false,
    airborne = false,
    distance = 0,
    speed = 0;
  const motor = createSampleEmitter(RECORDED_SOUNDS.mechMotor[0], scene, root, {
    radius: 135,
    volume: 0.28,
    enabled: () => moving && !airborne,
    pitch: () => 0.72 + Math.min(0.5, speed * 0.025),
  });
  const boost = createSampleEmitter(RECORDED_SOUNDS.thruster[0], scene, root, {
    radius: 170,
    volume: 0.26,
    enabled: () => moving && airborne,
    pitch: () => 0.85 + Math.min(0.4, speed * 0.02),
  });
  return {
    update(dt: number, inAir: boolean, actuating = false) {
      root.getWorldPosition(current);
      const travel = initialized ? current.distanceTo(previous) : 0;
      previous.copy(current);
      initialized = true;
      airborne = inAir;
      speed = dt > 0 ? travel / dt : 0;
      moving = root.visible && dt > 0 && (travel > 0.015 || actuating);
      if (!moving || airborne || travel > 20) {
        distance = 0;
        return;
      }
      distance += travel;
      if (distance >= 3.2) {
        distance %= 3.2;
        playWorldSfx(
          "mechStep",
          root,
          120,
          0.85,
          0.76 + Math.min(0.2, speed * 0.01),
        );
      }
    },
    dispose() {
      motor.dispose();
      boost.dispose();
    },
  };
}

export function isShipInterior(sceneId: string) {
  return (
    sceneId === "prologue1" ||
    sceneId === "living-quarters" ||
    sceneId === "stage1-storage" ||
    sceneId === "stage2-infiltration" ||
    sceneId === "scene5" ||
    sceneId === "scene6" ||
    /^scene(?:[2-9]|1[0-4])$/.test(sceneId) ||
    sceneId === "scene20"
  );
}

export function createGameSoundscape() {
  let scene: THREE.Scene | null = null;
  const loops: ReturnType<typeof createSampleEmitter>[] = [];
  function clear() {
    loops.splice(0).forEach((loop) => loop.dispose());
    scene = null;
  }
  return {
    update(sceneId: string, next: THREE.Scene | null) {
      if (scene === next) return;
      clear();
      scene = next;
      if (!scene) return;
      setFootstepSurface(sceneId === "scene17" ? "grass" : "floor");
      if (isShipInterior(sceneId)) {
        loops.push(
          createSampleEmitter(RECORDED_SOUNDS.shipHum[0], scene, undefined, {
            volume: 0.13,
          }),
        );
      }
      let vents = 0;
      scene.traverse((node) => {
        if (node.name === "EscapeShuttle") {
          loops.push(
            createSampleEmitter(RECORDED_SOUNDS.thruster[0], next!, node, {
              volume: 0.28,
              radius: 55,
              gain: () =>
                0.45 + Math.min(1.5, node.userData.engineThrust ?? 0) * 0.5,
              pitch: () =>
                0.8 + Math.min(1.5, node.userData.engineThrust ?? 0) * 0.18,
            }),
          );
        } else if (
          isShipInterior(sceneId) &&
          vents < 4 &&
          (node.name === "ShipCeilingVent" || node.name === "ShipServerRack")
        ) {
          vents++;
          loops.push(
            createSampleEmitter(RECORDED_SOUNDS.shipHum[0], next!, node, {
              volume: 0.16,
              radius: 12,
              rate: node.name === "ShipServerRack" ? 1.15 : 0.9,
            }),
          );
        }
      });
    },
    stop() {
      clear();
      stopSceneAudio();
    },
  };
}
