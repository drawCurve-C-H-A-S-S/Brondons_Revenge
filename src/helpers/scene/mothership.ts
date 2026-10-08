import * as THREE from 'three';
import { loadModel } from '../../core/loader.js';
import mothershipUrl from '../../assets/models/mothership.glb';
import { disposeRoom } from './shipRoom.js';

export function createMothership(loadShip: typeof loadModel = loadModel) {
  const root = new THREE.Group(); root.name = 'Mothership';
  root.scale.setScalar(10); root.position.set(0, 15, 0); root.rotation.y = -Math.PI / 2;
  const glow = new THREE.PointLight(0x88aacc, 3, 30);
  const front = new THREE.PointLight(0xaaccff, 2, 20); front.position.set(2, 0, 0);
  root.add(glow, front);
  let disposed = false;
  const ready = loadShip(mothershipUrl).then(model => {
    if (disposed) { disposeRoom(model); return; }
    const fitted = new THREE.Group(); fitted.add(model); fitted.rotation.y = -Math.PI / 2;
    const bounds = new THREE.Box3().setFromObject(fitted), size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(span) || span <= 0) {
      disposeRoom(fitted);
      throw new Error('Mothership model has invalid or empty bounds');
    }
    const scale = 4.6 / span;
    fitted.scale.setScalar(scale);
    fitted.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
    root.add(fitted);
  });
  return { root, ready,
    dispose() {
      if (disposed) return;
      disposed = true; root.removeFromParent(); disposeRoom(root);
    },
  };
}
