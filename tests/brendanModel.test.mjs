import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createServer } from 'vite';

test('rescue Brendan uses DonfromStreets with independent materials and the landing and finale rig', async t => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());
  const originalSelf = globalThis.self, originalBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
  t.after(() => {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalBitmap;
  });
  const buffer = await readFile(new URL('../src/assets/models/DonfromStreets.glb', import.meta.url));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async source => {
    requests.push(source);
    return new Response(buffer);
  });
  let template;
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async function () {
    template = await this.parseAsync(data.slice(0), '');
    return template;
  });
  const { loadBrendanModel } = await server.ssrLoadModule('/core/loader.ts');
  const first = await loadBrendanModel(), second = await loadBrendanModel();
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/DonfromStreets\.glb$/);
  assert.notEqual(first.scene, second.scene);
  for (const name of ['Head', 'spine_01', 'upperarm_l', 'upperarm_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r']) {
    assert.ok(first.scene.getObjectByName(name)?.isBone, `Finale bone ${name} is present`);
  }
  for (const name of ['Idle_Loop', 'Walk_Loop']) {
    const clip = first.animations.find(animation => animation.name === name);
    assert.ok(clip, `${name} is present`);
    const mixer = new THREE.AnimationMixer(first.scene);
    mixer.clipAction(clip).play();
    mixer.update(0.5);
    const bounds = new THREE.Box3().setFromObject(first.scene);
    assert.ok(Number.isFinite(bounds.min.y) && bounds.max.y > bounds.min.y);
    mixer.stopAllAction();
    mixer.uncacheRoot(first.scene);
  }
  let body;
  first.scene.traverse(node => { if (!body && node.isSkinnedMesh) body = node; });
  assert.ok(body, 'The replacement has a skinned body');
  const otherBody = second.scene.getObjectByName(body.name);
  const sourceBody = template.scene.getObjectByName(body.name);
  assert.ok(body.isSkinnedMesh);
  assert.notEqual(body.geometry, otherBody.geometry);
  assert.notEqual(body.skeleton, otherBody.skeleton);
  const materials = Array.isArray(body.material) ? body.material : [body.material];
  const otherMaterials = Array.isArray(otherBody.material) ? otherBody.material : [otherBody.material];
  const sourceMaterials = Array.isArray(sourceBody.material) ? sourceBody.material : [sourceBody.material];
  materials.forEach((material, index) => {
    assert.notEqual(material, otherMaterials[index]);
    assert.equal(material.name, sourceMaterials[index].name);
    assert.ok(material.color.equals(sourceMaterials[index].color), 'Original model palette is preserved');
    const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <opaque_fragment>' };
    material.onBeforeCompile(shader, null);
    assert.ok(shader.uniforms.uBrondonColor.value.equals(sourceMaterials[index].color));
    assert.equal(shader.uniforms.uCellShadingEnabled.value, 1);
    assert.match(shader.fragmentShader, /brondonShade/);
    material.color.set(0);
    assert.ok(otherMaterials[index].color.equals(sourceMaterials[index].color), 'Finale changes cannot affect another scene');
  });

  const { createBrendanBehavior } = await server.ssrLoadModule('/helpers/scene/brendanBehavior.ts');
  for (const fps of [30, 60, 144]) {
    await t.test(`standing conversation and autonomous pacing/inspection at ${fps} FPS`, () => {
      t.mock.method(Math, 'random', () => 0.25);
      const root = new THREE.Group(), model = new THREE.Group();
      root.position.set(-61.8, 0, 85.4); root.add(model);
      const clips = ['Crouch_Idle_Loop', 'Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Interact']
        .map((name, index) => new THREE.AnimationClip(name, 1, [
          new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [index, index]),
        ]));
      const behavior = createBrendanBehavior(root, model, clips, new THREE.Vector3(-60, 1.05, 82));
      assert.equal(model.position.y, 1, 'Standing idle, not the first crouch idle');
      const start = root.position.clone();
      behavior.setActivity('talk');
      for (let frame = 0; frame < fps * 7; frame++) behavior.update(1 / fps, { x: -63, z: 85 });
      assert.equal(model.position.y, 3, 'Standing talking clip');
      assert.ok(root.position.equals(start), 'Conversation does not wander');
      behavior.setActivity('ambient');
      root.visible = false;
      let walks = 0, inspections = 0, maxTravel = 0;
      for (let frame = 0; frame < fps * 120; frame++) {
        const previous = root.position.clone();
        behavior.update(1 / fps);
        const travel = root.position.distanceTo(previous);
        assert.ok(travel <= 0.75 / fps + 1e-8, 'Movement speed is bounded');
        assert.ok(root.position.z >= 85.4 && root.position.z <= 87.5, 'Stays clear of the pod hull');
        maxTravel = Math.max(maxTravel, root.position.distanceTo(start));
        if (travel > 0) walks++;
        if (travel === 0 && Math.abs(model.position.y - 4) < 0.01) inspections++;
      }
      assert.ok(walks > fps * 10 && maxTravel > 2, 'Keeps pacing while the player is away');
      assert.ok(inspections > fps * 10, 'Repeatedly pauses to inspect the pod');
      behavior.setActivity('idle');
      const parked = root.position.clone();
      for (let frame = 0; frame < fps; frame++) behavior.update(1 / fps);
      assert.ok(root.position.equals(parked), 'Cinematic idle disables ambient movement');
      assert.equal(model.position.y, 1);
      behavior.dispose();
      assert.throws(() => createBrendanBehavior(root, model, [], new THREE.Vector3()), /Idle_Loop/);
    });
  }

  await t.test('finale scorching composes with Brendan cel shading', async () => {
    const { createFinaleAftermath } = await server.ssrLoadModule('/helpers/scene/finaleAftermath.ts');
    const root = new THREE.Group(); root.add(second.scene);
    const aftermath = createFinaleAftermath(new THREE.Scene(), root, Promise.resolve(), false);
    await aftermath.ready;
    try {
      for (const material of otherMaterials) {
        const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>',
          fragmentShader: '#include <common>\n#include <opaque_fragment>' };
        material.onBeforeCompile(shader, null);
        assert.ok(shader.uniforms.uBrondonColor);
        assert.ok(shader.uniforms.uBurn);
        assert.ok(shader.fragmentShader.indexOf('outgoingLight = uBrondonColor')
          < shader.fragmentShader.indexOf('outgoingLight = mix'), 'Scorching is applied after cel shading');
        assert.equal(shader.fragmentShader.match(/float charNoise/g)?.length, 1);
      }
    } finally { aftermath.dispose(); }
  });
});
