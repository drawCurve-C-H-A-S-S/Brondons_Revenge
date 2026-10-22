import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createServer } from 'vite';

let server, MeleeSwing, emitComicEffect, updateComicEffects, disposeComicEffects;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ MeleeSwing } = await server.ssrLoadModule('/scripts/weapons/melee.ts'));
  ({ emitComicEffect, updateComicEffects, disposeComicEffects } = await server.ssrLoadModule('/scripts/global/comicEffects.ts'));
});
after(async () => server?.close());

for (const [weapon, word] of [['crowbar', 'KRAK!'], ['lightsaber', 'ZAP!']]) {
  test(`${weapon} hits render visible onomatopoeia even when the enemy has no feedback handler`, t => {
    const old = globalThis.document, words = [];
    const context = new Proxy({ measureText: text => ({ width: text.length * 60 }),
      fillText: text => words.push(text) }, { get: (target, key) => target[key] ?? (() => {}) });
    globalThis.document = { createElement: () => ({ getContext: () => context }) };
    const scene = new THREE.Scene(), root = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.6), new THREE.MeshBasicMaterial());
    root.position.set(0, 1.1, -1); scene.add(root);
    let damage = 0;
    const player = { body: new CANNON.Body() }; player.body.position.set(0, 0.3, 0);
    const contextState = { scene, world: null, player, character: null,
      targets: [{ root, damage(amount, actualWeapon) { assert.equal(actualWeapon, weapon); damage += amount; return true; } }] };
    const swing = new MeleeSwing(weapon);
    const segment = { start: new THREE.Vector3(0, 1.1, -0.3), end: new THREE.Vector3(0, 1.1, -1.6) };
    assert.equal(swing.update(contextState, segment), true);
    assert.equal(swing.update(contextState, segment), false, 'One impact per target per swing');
    assert.equal(damage, 35);
    const camera = new THREE.PerspectiveCamera(70, 1280 / 720, 0.1, 100);
    camera.position.set(0, 1.1, 4); camera.lookAt(0, 1.1, -1); camera.updateMatrixWorld(true);
    updateComicEffects(scene, camera, 0.1, { getSize: size => size.set(1280, 720) });
    const sprite = scene.getObjectByName('ComicCombatWord');
    assert.ok(sprite?.visible, 'Impact word is actually presented, not only queued');
    assert.ok(sprite.material.opacity > 0.5); assert.ok(sprite.scale.y > 0);
    assert.ok(words.includes(word));
    const projected = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
    assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
    t.after(() => { disposeComicEffects(scene); root.geometry.dispose(); root.material.dispose(); globalThis.document = old; });
  });
}

test('rejected melee damage does not create success-shaped hit feedback', () => {
  const scene = new THREE.Scene(), root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  root.position.set(0, 1.1, -1); scene.add(root);
  const body = new CANNON.Body(); body.position.set(0, 0.3, 0);
  const swing = new MeleeSwing('crowbar');
  assert.equal(swing.update({ scene, player: { body }, world: null, character: null, targets: [{ root, damage: () => false }] },
    { start: new THREE.Vector3(0, 1.1, -0.3), end: new THREE.Vector3(0, 1.1, -1.6) }), false);
  assert.equal(scene.getObjectByName('ComicCombatEffects'), undefined);
  root.geometry.dispose(); root.material.dispose();
});

test('confusion renders literal ??? above its anchor for the requested duration and supports immediate cleanup', t => {
  const old = globalThis.document, words = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 60 }),
    fillText: text => words.push(text) }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const scene = new THREE.Scene(), root = new THREE.Group();
  scene.add(root);
  t.after(() => { disposeComicEffects(scene); globalThis.document = old; });
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
  camera.position.set(0, 2, 10); camera.lookAt(0, 2, 0); camera.updateMatrixWorld(true);
  const render = dt => updateComicEffects(scene, camera, dt, { getSize: size => size.set(1280, 720) });
  const cancel = emitComicEffect(scene, 'confused', { source: root, position: new THREE.Vector3(0, 2, 0), size: 2, duration: 3.5 });
  render(0);
  const sprite = scene.getObjectByName('ComicCombatWord');
  assert.ok(words.includes('???'));
  assert.equal(sprite.visible, true); assert.equal(sprite.material.opacity, 1);
  assert.equal(sprite.position.x, 0, 'label is centered above the head, not offset sideways');
  assert.ok(sprite.position.y > 2);
  root.position.x = 2; render(0.1);
  assert.equal(sprite.position.x, 2, 'label follows the boss');
  for (let frame = 0; frame < 33; frame++) render(0.1);
  assert.equal(sprite.visible, true); assert.equal(sprite.material.opacity, 1);
  render(0.1); render(0.1);
  assert.equal(sprite.visible, false);
  cancel(); cancel();
  const cancelNext = emitComicEffect(scene, 'confused', { source: root, size: 2, duration: 3.5 });
  render(0);
  assert.equal(sprite.visible, true);
  cancelNext();
  assert.equal(sprite.visible, false);
});