import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let server, createScene, THREE, CANNON, GLTFLoader, bossBytes, boyBytes, droneJSON, droneBytes;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene } = await server.ssrLoadModule('/scenes/level 1/scene13.ts'));
  // Use the scene's module graph: Windows drive-letter casing can otherwise load
  // two copies of Three.js, breaking instanceof checks for the imported real rig.
  THREE = await server.ssrLoadModule('three');
  CANNON = await server.ssrLoadModule('cannon-es');
  ({ GLTFLoader } = await server.ssrLoadModule('three/addons/loaders/GLTFLoader.js'));
  const binary = async path => {
    const bytes = await readFile(new URL(path, import.meta.url));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };
  [bossBytes, boyBytes, droneBytes, droneJSON] = await Promise.all([
    binary('../src/assets/models/bayboss.glb'), binary('../src/assets/models/boy.glb'),
    binary('../src/assets/models/Tools/Enemy_EyeDrone.bin'),
    readFile(new URL('../src/assets/models/Tools/Enemy_EyeDrone.gltf', import.meta.url), 'utf8'),
  ]);
});
after(async () => server?.close());

function parse(bytes, buffer) {
  const loader = new GLTFLoader();
  // Preserve actual skin, bones, geometry, and clips; only image decoding is mocked.
  loader.register(parser => ({ name: 'NodeAssetTransport',
    beforeRoot() { if (buffer) parser.cache.add('buffer:0', Promise.resolve(buffer.slice(0))); },
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader.parseAsync(typeof bytes === 'string' ? bytes : bytes.slice(0), '');
}
async function fixture(t) {
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, self: globalThis.self, Audio: globalThis.Audio };
  let data;
  t.after(() => { data?.dispose(); Object.assign(globalThis, old); });
  globalThis.Audio = class extends EventTarget { load() {} pause() {} play() { return Promise.resolve(); } };
  globalThis.self = globalThis;
  globalThis.HTMLElement = class {};
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), {
    body: { requestPointerLock() {} }, pointerLockElement: null, getElementById: () => null,
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }),
  });
  data = createScene({ checkpoint: true,
    loadBoss: () => parse(bossBytes), loadBoy: () => parse(boyBytes), loadDrone: () => parse(droneJSON, droneBytes),
  });
  await data.ready;
  assert.ok(data.boss.bodyTarget.root.getObjectsByProperty('isSkinnedMesh', true).length, 'actual boss rig must load');
  data.player.setPosition(0, 0.3, 10);
  return data;
}
function tick(data, dt = 1 / 60) { data.player.heal(100); data.updatePhysics(dt, true); }
function until(data, predicate, seconds = 20, fps = 60) {
  for (let i = 0; i < seconds * fps && !predicate(); i++) tick(data, 1 / fps);
  assert.ok(predicate(), JSON.stringify(data.boss.getStatus()));
}
function advanceToTransformation(data) {
  for (let phase = 1; phase <= 2; phase++) {
    until(data, () => data.boss.getStatus().phase === 'flying');
    for (const target of data.boss.targets) while (target.hits()) assert.equal(target.damage(25, 'pistol'), true);
    until(data, () => data.boss.getStatus().phase === 'exposed');
    assert.equal(data.boss.bodyTarget.damage(250, 'pistol'), true);
  }
  assert.equal(data.boss.getStatus().health, 480);
  assert.equal(data.boss.getStatus().phase, 'phaseThreeAwakening');
}
function pairs(world) {
  const a = [], b = []; world.broadphase.collisionPairs(world, a, b);
  return a.map((body, i) => [body, b[i]]);
}

test('real phase-three rig excludes overlap-only narrowphase without removing colliders', async t => {
  const data = await fixture(t), world = data.physicsWorld;
  advanceToTransformation(data);
  const rigBodies = world.bodies.filter(body => body.type === CANNON.Body.KINEMATIC && body !== data.player.body);
  assert.ok(rigBodies.length >= 20, 'full rig collision representation remains present');
  const captured = [], getContacts = world.narrowphase.getContacts;
  world.narrowphase.getContacts = function (a, b, ...rest) {
    captured.push(...a.map((body, i) => [body, b[i]]));
    return getContacts.call(this, a, b, ...rest);
  };
  until(data, () => data.boss.getStatus().phase === 'gravityWindup');
  const optimizedPairs = pairs(world);
  const filtered = world.broadphase.needBroadphaseCollision;
  let legacyPairs;
  try {
    world.broadphase.needBroadphaseCollision = CANNON.Broadphase.prototype.needBroadphaseCollision;
    legacyPairs = pairs(world);
  } finally { world.broadphase.needBroadphaseCollision = filtered; }
  assert.ok(legacyPairs.length > 0, 'test reproduces overlapping scripted rig bodies');
  assert.equal(optimizedPairs.length, 0, 'no dynamic bodies during the transformation');
  const timings = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now(); tick(data); timings.push(performance.now() - start);
  }
  assert.ok(captured.every(([a, b]) => a.type === CANNON.Body.DYNAMIC || b.type === CANNON.Body.DYNAMIC));
  assert.ok(rigBodies.every(body => body.world === world && body.collisionResponse));
  // Structural assertion is deterministic on slow CI; browser harness reports CPU/GPU budgets.
  t.diagnostic(`Transformation: ${legacyPairs.length} legacy pairs -> ${optimizedPairs.length}; simulation mean ${(timings.reduce((a, b) => a + b) / timings.length).toFixed(2)} ms`);
  until(data, () => data.boss.getStatus().phase === 'gravity' && data.player.isEnabled());
  const drones = data.boss.getDamageTargets().filter(target => target.root.name.startsWith('BossEyeDrone'));
  assert.equal(drones.length, 4);
  assert.deepEqual(data.boss.getStatus().targets, [2, 2, 2, 2]);
  assert.ok(drones.every(drone => drone.body.type === CANNON.Body.DYNAMIC));
  for (const body of rigBodies) assert.equal(filtered.call(world.broadphase, data.player.body, body), true);
  const result = new CANNON.RaycastResult();
  assert.equal(world.raycastClosest(new CANNON.Vec3(-10, 5, -15), new CANNON.Vec3(-16, 5, -15), {}, result), true);
  assert.equal(result.body.type, CANNON.Body.STATIC, 'pillar ray queries remain enabled');
  const drone = drones[0].body;
  drone.position.set(-11.25, 5, -15); drone.velocity.setZero(); drone.aabbNeedsUpdate = true;
  for (let i = 0; i < 20; i++) world.step(1 / 120);
  assert.ok(drone.position.x > -11.21, 'dynamic drone is pushed out of the pillar');
  assert.ok(captured.some(([a, b]) => a === drone || b === drone), 'drone still enters narrowphase');
});

for (const [x, z, aspect] of [[0, 10, 16 / 9], [18, 21, 16 / 9], [-16, -18, 9 / 16]]) {
  test(`drone zoom/pan frames player and blast at (${x}, ${z}), aspect ${aspect}`, async t => {
    const data = await fixture(t);
    advanceToTransformation(data);
    until(data, () => data.boss.getStatus().phase === 'gravity' && data.player.isEnabled());
    data.player.setPosition(x, 0.3, z);
    // Pillars correctly block remote charges. Seed a close approach at the boundary
    // locations to test framing there without bypassing the actual attack/cutscene logic.
    let placed = x === 0, setupFrames = 0;
    until(data, () => {
      // Launch motors can also exceed charge speed; wait until that state has ended.
      if (!placed && setupFrames++ > 180) {
        const charging = data.boss.getDamageTargets().find(target => target.root.name.startsWith('BossEyeDrone') && target.body.velocity.length() > 7);
        if (charging) {
          charging.body.position.set(x - Math.sign(x) * 2.4, data.player.getHeadY(), z);
          charging.body.aabbNeedsUpdate = true; placed = true;
        }
      }
      return data.boss.getStatus().phase === 'droneExplosion';
    }, 15);
    data.camera.aspect = aspect; data.camera.updateProjectionMatrix();
    const frames = [];
    while (data.boss.getStatus().phase === 'droneExplosion') {
      data.applyCinematicCamera(); data.camera.updateMatrixWorld(true);
      const p = data.player.body.position;
      for (const y of [p.y - data.player.radius, p.y + 1.7]) {
        const projected = new THREE.Vector3(p.x, y, p.z).project(data.camera);
        assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95 && projected.z > -1 && projected.z < 1, 'player stays in frame');
      }
      const blast = data.scene.getObjectByName('EyeDroneExplosion');
      if (blast.visible) {
        const radius = blast.children[0].scale.x;
        for (const offset of [[0, 0, 0], [radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, 0, radius], [0, 0, -radius]]) {
          const projected = blast.position.clone().add(new THREE.Vector3(...offset)).project(data.camera);
          assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95 && projected.z > -1 && projected.z < 1, 'growing fireball stays in frame');
        }
      }
      frames.push({ fov: data.camera.fov, position: data.camera.position.clone(), impact: blast.visible });
      assert.ok(data.camera.position.distanceTo(new THREE.Vector3(p.x, p.y + 1, p.z)) > 2, 'third-person clearance');
      for (const body of data.physicsWorld.bodies) {
        if (body.type !== CANNON.Body.STATIC || !body.collisionResponse) continue;
        if (body.aabbNeedsUpdate) body.updateAABB();
        const bounds = new THREE.Box3(new THREE.Vector3().copy(body.aabb.lowerBound), new THREE.Vector3().copy(body.aabb.upperBound));
        assert.equal(bounds.containsPoint(data.camera.position), false, `camera stays outside solid room geometry: ${JSON.stringify({ frame: frames.length, camera: data.camera.position, bounds })}`);
      }
      tick(data);
      assert.ok(frames.length < 400, 'cinematic completes');
    }
    assert.ok(frames.some(frame => frame.impact));
    assert.ok(frames[0].position.distanceTo(frames.at(-1).position) > 1, 'camera pans across the action');
    if (aspect > 1) assert.ok(Math.min(...frames.map(frame => frame.fov)) < frames[0].fov - 8, 'visible optical zoom-in');
    assert.equal(data.player.isEnabled(), true);
    assert.equal(data.boss.getStatus().drones, 3, 'detonated drone does not respawn');
  });
}
