import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Player } from './player.js';
import { createVentGate, createSpikePlate, cargoSign } from '../helpers/scene/cargoVisuals.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
/** Remote presentation only: no destination player, listeners, physics, or triggers. */
export function createPuzzleCinematic(player: Player, camera: THREE.PerspectiveCamera) {
  let view: THREE.Scene | null = null, elapsed = 0, kind: 10 | 11 | 12 = 10;
  let gate: ReturnType<typeof createVentGate> | null = null, plate: ReturnType<typeof createSpikePlate> | null = null;
  let previousType: CANNON.Body['type'] = CANNON.Body.DYNAMIC;
  function finish() {
    if (!view) return; disposeRoom(view); view = null; gate = null; plate = null;
    player.body.type = previousType; player.body.updateMassProperties(); player.clearInput(); player.enable(); player.body.wakeUp();
  }
  function begin(target: 10 | 11 | 12) {
    if (view) return; kind = target; elapsed = 0; view = new THREE.Scene(); view.background = new THREE.Color(0x0b151d);
    view.add(new THREE.HemisphereLight(0xc7edff, 0x33414c, 3));
    const mat = new THREE.MeshStandardMaterial({ color: 0x334650, metalness: 0.5, roughness: 0.7 });
    function box(s: [number, number, number], p: [number, number, number]) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...s), mat); mesh.position.set(...p); view!.add(mesh); }
    if (target === 12) {
      box([8, 0.2, 20], [0, -0.1, 0]); box([8, 4.5, 0.2], [0, 2.25, -10]);
      for (const x of [-4, 4]) box([0.2, 4.5, 20], [x, 2.25, 0]);
      plate = createSpikePlate(view); cargoSign(view, '12 / TRANSFER HUB - AUXILIARY LOCK', [0, 2, -9.8], 6);
    } else {
      const side = target === 10 ? 1 : -1;
      box([8, 0.15, 2.2], [side * 4, -0.075, 0]); box([8, 0.1, 2.2], [side * 4, 1.4, 0]);
      for (const z of [-1.1, 1.1]) box([8, 1.4, 0.1], [side * 4, 0.7, z]);
      gate = createVentGate(view, null, side); cargoSign(view, `VENT ${target} / ACCESS RESTORED`, [side * 3.5, 0.95, -1.03], 1.8);
    }
    previousType = player.body.type; player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties(); player.body.velocity.set(0, 0, 0);
  }
  function applyCinematicCamera() {
    if (!view) return false;
    if (kind === 12) { camera.position.set(3, 3.7, 4); camera.lookAt(0, 0.1, 0); }
    else { const side = kind === 10 ? 1 : -1; camera.position.set(side * 0.35, 0.75, 0.4); camera.lookAt(side * 2.1, 0.65, 0); }
    return true;
  }
  return { begin, isCinematic: () => !!view, getRenderScene: () => view, hideCharacter: () => !!view,
    getCinematicState: () => view ? { ...player.getState(), isMoving: false } : null, applyCinematicCamera,
    update(dt: number) { if (!view) return; elapsed += dt; const t = THREE.MathUtils.smoothstep(elapsed, 0.35, 1.8); gate?.setProgress(t); plate?.update(t, 0); applyCinematicCamera(); if (elapsed >= 2.5) finish(); },
    dispose() { if (view) { disposeRoom(view); view = null; } },
  };
}
