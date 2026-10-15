import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const modelUrl = new URL('../src/assets/models/Subject.glb', import.meta.url);

test('Subject is a self-contained binary GLB with complete skin attributes', async () => {
  const bytes = await readFile(modelUrl);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Must be binary GLB, not JSON with a .glb extension');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  assert.ok(gltf.buffers.every(buffer => !buffer.uri), 'No external buffer may bypass the asset cache');
  assert.ok((gltf.images ?? []).every(image => image.bufferView !== undefined), 'Textures must be embedded');
  for (const node of gltf.nodes.filter(node => node.skin !== undefined)) {
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const count = gltf.accessors[primitive.attributes.POSITION].count;
      for (const semantic of ['NORMAL', 'JOINTS_0', 'WEIGHTS_0']) {
        assert.notEqual(primitive.attributes[semantic], undefined, `Missing ${semantic}`);
        assert.equal(gltf.accessors[primitive.attributes[semantic]].count, count);
      }
    }
  }
});

test('Three.js loads Subject with valid bounds, materials and an animatable skeleton', async t => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
  t.after(() => {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  });
  const bytes = await readFile(modelUrl);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const model = await new GLTFLoader().parseAsync(data, '');
  model.scene.updateMatrixWorld(true);
  const meshes = [];
  model.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  assert.equal(meshes.length, 6, 'Use the six original authored primitives without a smoothed outer skin');
  const materials = new Set(meshes.map(mesh => mesh.material.name));
  assert.ok(materials.has('SuitBase'));
  assert.ok(materials.has('SoldierSkin'));
  assert.ok(!materials.has('SubjectSkin'), 'Do not add the generated smoothing shell');
  for (const mesh of meshes) {
    mesh.skeleton.update();
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    assert.equal(skinIndex.count, position.count);
    assert.equal(skinWeight.count, position.count);
    assert.ok(mesh.skeleton.bones.length > 0);
    for (let index = 0; index < position.count; index++) {
      const vertex = mesh.getVertexPosition(index, new THREE.Vector3());
      assert.ok(vertex.toArray().every(Number.isFinite), 'Skinned vertices must remain finite');
    }
  }
  const size = new THREE.Box3().setFromObject(model.scene).getSize(new THREE.Vector3());
  assert.ok(size.y > 0.5 && size.y < 5, `Human-scale height expected, got ${size.y}`);
  assert.ok(size.toArray().every(value => value > 0 && value < 5));
});
