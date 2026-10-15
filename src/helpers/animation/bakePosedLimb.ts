import * as THREE from 'three';

export function bakePosedLimb(model: THREE.Object3D, boneName: string, origin: THREE.Vector3) {
  const bone = model.getObjectByName(boneName);
  if (!bone) throw new Error(`MC.glb is missing ${boneName}`);
  const bones = new Set<THREE.Object3D>();
  bone.traverse(child => bones.add(child));
  const root = new THREE.Group();
  let triangles = 0;
  model.updateMatrixWorld(true);
  try {
    model.traverse(mesh => {
      if (!(mesh instanceof THREE.SkinnedMesh)) return;
      mesh.skeleton.update();
      const source = mesh.geometry, positions = source.getAttribute('position');
      const skinIndex = source.getAttribute('skinIndex'), skinWeight = source.getAttribute('skinWeight');
      if (!skinIndex || !skinWeight) return;
      const included = new Uint8Array(positions.count);
      for (let vertex = 0; vertex < positions.count; vertex++) {
        let weight = 0;
        for (let component = 0; component < 4; component++) {
          if (bones.has(mesh.skeleton.bones[skinIndex.getComponent(vertex, component)]))
            weight += skinWeight.getComponent(vertex, component);
        }
        included[vertex] = weight >= 0.5 ? 1 : 0;
      }
      const index = source.getIndex(), count = index?.count ?? positions.count;
      const indices: number[] = [], groups: Array<{ start: number; count: number; materialIndex: number }> = [];
      const sections = source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }];
      for (const section of sections) {
        const start = indices.length;
        for (let triangle = section.start; triangle < Math.min(count, section.start + section.count); triangle += 3) {
          const a = index ? index.getX(triangle) : triangle;
          const b = index ? index.getX(triangle + 1) : triangle + 1;
          const c = index ? index.getX(triangle + 2) : triangle + 2;
          if (included[a] && included[b] && included[c]) indices.push(a, b, c);
        }
        if (indices.length > start) groups.push({ start, count: indices.length - start, materialIndex: section.materialIndex ?? 0 });
      }
      if (!indices.length) return;
      triangles += indices.length / 3;
      const geometry = source.clone(), vertex = new THREE.Vector3();
      geometry.setIndex(indices); geometry.clearGroups();
      groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
      for (let index = 0; index < positions.count; index++) {
        mesh.getVertexPosition(index, vertex);
        vertex.applyMatrix4(mesh.matrixWorld).sub(origin);
        geometry.getAttribute('position').setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
      geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const clone = (material: THREE.Material) => { const copy = material.clone(); copy.side = THREE.DoubleSide; return copy; };
      root.add(new THREE.Mesh(geometry, Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material)));
    });
    if (!triangles) throw new Error(`MC.glb has no visible triangles for ${boneName}`);
    return root;
  } catch (error) {
    disposeBakedLimb(root);
    throw error;
  }
}

export function disposeBakedLimb(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh)) return;
    geometries.add(mesh.geometry);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose());
  // The cloned materials still share the cached character's textures.
  materials.forEach(material => material.dispose());
  root.removeFromParent();
}
