import * as THREE from 'three';
import { loadModel } from '../../core/loader.js';
import mothershipUrl from '../../assets/models/mothership.glb';
import { disposeRoom } from './shipRoom.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function batchHull(model: THREE.Group) {
  const batches = new Map<string, { parts: Array<THREE.Mesh | THREE.LineSegments>; material: THREE.Material; lines: boolean }>();
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.LineSegments) || node instanceof THREE.SkinnedMesh || node instanceof THREE.InstancedMesh
      || Array.isArray(node.material) || node.material.transparent || !node.visible
      || Object.keys(node.geometry.morphAttributes).length) return;
    const geometry: THREE.BufferGeometry = node.geometry;
    if (Object.values(geometry.attributes).some(attribute => !(attribute instanceof THREE.BufferAttribute))) return;
    const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}`).join(',');
    const lines = node instanceof THREE.LineSegments;
    const key = `${lines}:${node.material.uuid}:${!!geometry.index}:${attributes}:${node.castShadow}:${node.receiveShadow}:${node.renderOrder}`;
    const batch: { parts: Array<THREE.Mesh | THREE.LineSegments>; material: THREE.Material; lines: boolean } =
      batches.get(key) ?? { parts: [], material: node.material, lines };
    batch.parts.push(node); batches.set(key, batch);
  });
  const removed = new Set<THREE.BufferGeometry>();
  for (const batch of batches.values()) {
    if (batch.parts.length < 2) continue;
    const geometries = batch.parts.map(mesh => mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
    let geometry: THREE.BufferGeometry | null;
    try { geometry = mergeGeometries(geometries); }
    finally { geometries.forEach(copy => copy.dispose()); }
    if (!geometry) throw new Error('Unable to batch compatible mothership hull geometry');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = batch.lines ? new THREE.LineSegments(geometry, batch.material) : new THREE.Mesh(geometry, batch.material);
    mesh.name = 'BatchedMothershipHull'; mesh.castShadow = batch.parts[0].castShadow;
    mesh.receiveShadow = batch.parts[0].receiveShadow; mesh.renderOrder = batch.parts[0].renderOrder;
    for (const original of batch.parts) { removed.add(original.geometry); original.removeFromParent(); }
    model.add(mesh);
  }
  model.traverse(node => { if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) removed.delete(node.geometry); });
  removed.forEach(geometry => geometry.dispose());
}

export function createMothership(loadShip: typeof loadModel = loadModel) {
  const root = new THREE.Group(); root.name = 'Mothership';
  root.scale.setScalar(10); root.position.set(0, 15, 0); root.rotation.y = -Math.PI / 2;
  const glow = new THREE.PointLight(0x88aacc, 3, 30);
  const front = new THREE.PointLight(0xaaccff, 2, 20); front.position.set(2, 0, 0);
  root.add(glow, front);
  let disposed = false;
  const ready = loadShip(mothershipUrl).then(model => {
    if (disposed) { disposeRoom(model); return; }
    batchHull(model);
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
