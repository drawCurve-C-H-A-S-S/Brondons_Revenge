import * as THREE from 'three';
import type { createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import { HERO_TRANSFORM, cinematicProgress } from '../../scripts/finaleChoreography.js';
import type { FinalePhase } from '../../scripts/finaleDirector.js';
import { captureFinaleResources } from './finaleActors.js';
import { FINALE_BATTLE_YAW } from './finaleWorld.js';

export function createFinaleShipTransformation(scene: THREE.Scene, ship: ReturnType<typeof createEscapeShip>, destination: THREE.Vector3) {
  const root = new THREE.Group(); root.name = 'ShuttleToPrimeFrame';
  const parked = ship.root.position.clone(), parkedRotation = ship.root.quaternion.clone();
  const resources = captureFinaleResources(ship.root);
  root.add(ship.root); scene.add(root);
  const parts = ship.root.children.map(node => ({
    node, position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible,
  }));
  const materials = new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  ship.root.traverse(node => {
    if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    }
  });
  const arrival = destination.clone().add(new THREE.Vector3(0, 12, 0));
  const route = new THREE.CatmullRomCurve3([
    parked, parked.clone().add(new THREE.Vector3(0, 15, -3)),
    new THREE.Vector3(-62, 37, 43), new THREE.Vector3(-35, 49, -25),
    arrival.clone().add(new THREE.Vector3(-3, 3, 12)), arrival,
  ], false, 'centripetal');
  const forward = new THREE.Vector3(0, 0, -1), point = new THREE.Vector3(), orbit = new THREE.Vector3();
  const arrivalRotation = new THREE.Quaternion().setFromUnitVectors(forward, route.getTangentAt(1));
  const frameRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FINALE_BATTLE_YAW);
  const ports = [[0, 11.2, 0], [2.1, 10, 0], [-2.1, 10, 0], [0, 7, 0], [1.1, 2.8, 0], [-1.1, 2.8, 0]];
  let disposed = false;

  return { root, ship: ship.root,
    update(phase: FinalePhase, time: number) {
      const transforming = phase === 'heroTransform';
      const before = phase === 'loading' || phase === 'error' || phase === 'reveal' || phase === 'enemyTransform';
      ship.root.visible = before || (transforming && time < HERO_TRANSFORM.assembled);
      if (!ship.root.visible) return;
      const flight = transforming ? cinematicProgress(time, HERO_TRANSFORM.launch, HERO_TRANSFORM.arrival) : 0;
      for (const part of parts) {
        part.node.position.copy(part.position); part.node.quaternion.copy(part.rotation); part.node.scale.copy(part.scale);
        part.node.visible = part.visible;
      }
      ship.setFlying(flight > 0, true);
      ship.setThrust(flight > 0 ? 1.4 : 0);
      ship.setCanopyOpen(transforming ? 1 - cinematicProgress(time, 0.25, HERO_TRANSFORM.launch) : 1);
      ship.setPilotVisible(false);
      const morph = transforming ? cinematicProgress(time, HERO_TRANSFORM.disassemble, HERO_TRANSFORM.assembled) : 0;
      for (const [material, original] of materials) {
        const fading = morph > 0.35;
        if (material.transparent !== (original.transparent || fading)) {
          material.transparent = original.transparent || fading; material.needsUpdate = true;
        }
        material.opacity = original.opacity * (1 - cinematicProgress(morph, 0.4, 0.96));
        material.depthWrite = fading ? false : original.depthWrite;
      }
      if (flight <= 0) {
        ship.root.position.copy(parked); ship.root.quaternion.copy(parkedRotation);
        return;
      }
      ship.root.position.copy(route.getPointAt(flight));
      ship.root.quaternion.setFromUnitVectors(forward, route.getTangentAt(flight));
      ship.root.rotateZ(-Math.sin(flight * Math.PI) * 0.19);
      if (morph <= 0) return;
      ship.root.position.copy(arrival); ship.root.quaternion.copy(arrivalRotation);
      ship.root.updateMatrixWorld(true);
      const growth = 0.115 + cinematicProgress(time, HERO_TRANSFORM.materialize, HERO_TRANSFORM.assembled) * 0.885;
      parts.forEach((part, index) => {
        point.copy(part.position).applyQuaternion(arrivalRotation).add(arrival);
        const port = ports[index % ports.length];
        const angle = index * 2.399 + morph * Math.PI * 3;
        const radius = Math.sin(morph * Math.PI) * (4.2 + index % 3 * 0.65);
        orbit.set(port[0] * growth + Math.cos(angle) * radius, port[1] * growth,
          port[2] + Math.sin(angle) * radius).applyQuaternion(frameRotation).add(destination);
        point.lerp(orbit, cinematicProgress(morph, 0, 0.72));
        part.node.position.copy(ship.root.worldToLocal(point));
        part.node.quaternion.copy(part.rotation).multiply(new THREE.Quaternion().setFromEuler(
          new THREE.Euler(morph * (index % 3 - 1) * 3, morph * 4, morph * (index % 2 ? 2 : -2))));
        part.node.scale.copy(part.scale).multiplyScalar(1 - cinematicProgress(morph, 0.35, 1));
        part.node.visible = part.visible && morph < 0.99;
      });
      ship.root.updateMatrixWorld(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true; root.removeFromParent(); resources.dispose();
    },
  };
}
