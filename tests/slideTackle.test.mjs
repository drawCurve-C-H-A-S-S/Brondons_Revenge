import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

let server, createPlayer, createScenePhysics, SLIDE_TACKLE;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
  ({ createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  ({ SLIDE_TACKLE } = await server.ssrLoadModule('/helpers/animation/slideTackle.ts'));
});
after(async () => server?.close());

function fixture(t, fps = 60) {
  const names = ['window', 'document', 'HTMLElement'];
  const old = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  globalThis.HTMLElement = class extends EventTarget { closest() { return null; } };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { pointerLockElement: null, hidden: false,
    body: { requestPointerLock() {}, classList: { contains: () => false } } });
  const physics = createScenePhysics();
  physics.addBox({ x: 100, y: 0.4, z: 100 }, { x: 0, y: -0.2, z: 0 });
  const camera = new THREE.PerspectiveCamera();
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: 0.3, z: 0 } });
  player.enable();
  t.after(() => { player.dispose(); physics.dispose(); Object.assign(globalThis, old); });
  const advance = seconds => {
    for (let frame = 0; frame < Math.round(seconds * fps); frame++) physics.step(1 / fps, player);
  };
  const run = () => { key('KeyW'); advance(0.2); };
  return { physics, player, camera, advance, run };
}
function key(code, type = 'keydown', repeat = false) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  window.dispatchEvent(event);
}

test('forward C starts a grounded slide, lowers the camera, and resumes the held run', t => {
  const { player, camera, advance, run } = fixture(t);
  run(); const start = player.body.position.clone(), standingEye = camera.position.y;
  key('KeyC');
  assert.equal(player.getState().sliding, true);
  assert.equal(player.getState().crouching, false);
  advance(0.35);
  assert.ok(camera.position.y < standingEye - 0.6);
  assert.ok(player.body.position.z < start.z - 1.6, 'The tackle must carry forward momentum');
  assert.equal(player.getState().isOnGround, true);
  assert.equal(player.requestAction('Sword_Attack'), false);
  key('Space'); key('Digit6'); key('KeyC', 'keydown', true);
  advance(0.2);
  assert.equal(player.getState().jumping, false);
  assert.equal(player.getState().actionRequest, null);
  assert.ok(player.getState().slideTime > 0.5, 'Held C cannot restart the slide clock');
  advance(1.1);
  assert.equal(player.getState().sliding, false);
  assert.equal(player.getState().crouching, false);
  assert.equal(player.getState().jumping, false, 'Jump cannot be buffered through recovery');
  assert.ok(Math.abs(player.body.velocity.z + 4.2) < 0.01);
  assert.ok(camera.position.y > 1.5);
  key('KeyC', 'keydown', true); advance(0.3);
  assert.equal(player.getState().sliding, false, 'A fresh C press is required for another slide');
});

test('releasing movement preserves the coast but brakes to a stop at recovery', t => {
  const { player, advance, run } = fixture(t);
  run(); key('KeyC'); key('KeyC', 'keyup'); advance(0.3);
  key('KeyW', 'keyup');
  const start = player.body.position.z;
  advance(0.25);
  assert.equal(player.getState().sliding, true);
  assert.equal(player.getState().isMoving, true);
  assert.ok(player.body.position.z < start - 1);
  advance(1);
  assert.equal(player.getState().sliding, false);
  assert.ok(player.body.velocity.lengthSquared() < 0.01);
});

test('looking elsewhere does not steer the committed slide heading', t => {
  const { player, advance, run } = fixture(t);
  run(); key('KeyC'); advance(0.2); player.setRotation(Math.PI / 2); advance(0.4);
  assert.equal(player.getState().slideYaw, 0);
  assert.ok(Math.abs(player.body.position.x) < 0.01);
  assert.ok(player.body.position.z < -2.5);
});

for (const movement of [null, 'KeyA', 'KeyS']) {
  test(`C preserves crouch instead of sliding during ${movement ?? 'idle'}`, t => {
    const { player, advance } = fixture(t);
    if (movement) { key(movement); advance(0.2); }
    key('KeyC'); key('KeyC', 'keyup'); advance(0.1);
    assert.equal(player.getState().sliding, false);
    assert.equal(player.getState().crouching, true);
    key('KeyC'); key('KeyC', 'keyup');
    assert.equal(player.getState().crouching, false);
  });
}

test('airborne and scripted modes cannot start a slide', t => {
  const { player, physics, advance, run } = fixture(t);
  run(); key('Space'); advance(0.1); key('KeyC'); key('KeyC', 'keyup');
  assert.equal(player.getState().sliding, false);
  player.clearInput(); player.setPosition(0, 0.3, 0); player.setClimbing(true);
  key('KeyW'); key('KeyC'); assert.equal(player.getState().sliding, false);
  player.setClimbing(false); player.setVentMode(true); key('KeyW'); key('KeyC');
  assert.equal(player.getState().sliding, false);
  player.setVentMode(false); physics.world.gravity.set(0, 0, 0); player.setZeroGravity(true);
  key('KeyW'); advance(0.2); key('KeyC'); key('KeyC', 'keyup');
  assert.equal(player.getState().sliding, false);
  player.setZeroGravity(false); physics.world.gravity.set(0, -9.82, 0);
  player.setPosition(0, 0.3, 0); player.setBoxHandling(true); key('KeyW'); advance(0.2); key('KeyC');
  assert.equal(player.getState().sliding, false);
  player.setBoxHandling(false); player.setSideScrollDepth(0); key('KeyA'); advance(0.2); key('KeyC');
  assert.equal(player.getState().sliding, false);
});

test('solid walls interrupt the slide without tunneling or keeping input stuck', t => {
  const { player, physics, advance, run } = fixture(t);
  physics.addBox({ x: 8, y: 5, z: 0.4 }, { x: 0, y: 2, z: -3 });
  run(); key('KeyC'); advance(0.5);
  assert.equal(player.getState().sliding, false);
  assert.ok(player.body.position.z > -2.55, `The collider crossed a wall: ${player.body.position.z}`);
  assert.equal(player.getState().isOnGround, true);
});

test('blur, input locks and disabling cancel the slide and clear buffered actions', t => {
  const { player, advance, run } = fixture(t);
  for (const cancel of [() => window.dispatchEvent(new Event('blur')), () => player.setInputLocked(true), () => player.disable()]) {
    player.setInputLocked(false); player.enable(); player.clearInput(); advance(0.3);
    run(); key('KeyC'); advance(0.1); assert.equal(player.getState().sliding, true);
    cancel();
    assert.equal(player.getState().sliding, false);
    assert.equal(player.getState().actionRequest, null);
    assert.equal(player.body.velocity.x, 0);
    assert.equal(player.body.velocity.z, 0);
  }
});

test('door transitions retain slide phase, momentum and the mapped heading', t => {
  const { player, advance, run } = fixture(t);
  run(); key('KeyC'); advance(0.4);
  const state = player.captureTransition({ x: 0, y: 0, z: 0, yaw: 0 });
  player.restoreTransition(state, { x: 10, y: 0, z: 10, yaw: -Math.PI / 2 });
  assert.equal(player.getState().sliding, true);
  assert.ok(Math.abs(player.getState().slideTime - state.slide.time) < 1e-6);
  assert.ok(Math.abs(player.getState().slideYaw - Math.PI / 2) < 1e-6);
  const before = player.body.position.clone(); advance(0.15);
  assert.ok(player.body.position.x < before.x - 0.4);
  assert.ok(Math.abs(player.body.position.z - before.z) < 0.01);
});

test('30, 60 and 120 Hz produce matching slide distance and duration', async t => {
  const distances = [];
  for (const fps of [30, 60, 120]) {
    await t.test(`${fps} Hz`, t => {
      const { player, advance, run } = fixture(t, fps);
      run(); key('ShiftLeft'); advance(0.1);
      const start = player.body.position.z;
      key('KeyC'); advance(SLIDE_TACKLE.duration + 0.1);
      assert.equal(player.getState().sliding, false);
      assert.equal(player.getState().sprinting, true);
      distances.push(start - player.body.position.z);
    });
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.08, `Frame-rate-dependent slide: ${distances}`);
});
