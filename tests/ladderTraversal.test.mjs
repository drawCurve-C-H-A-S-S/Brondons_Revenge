import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, createScene7, createScene8, createScene9, applyTraversalCamera;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene: createScene7 } = await server.ssrLoadModule('/scenes/scene7.ts'));
  ({ createScene: createScene8 } = await server.ssrLoadModule('/scenes/scene8.ts'));
  ({ createScene: createScene9 } = await server.ssrLoadModule('/scenes/scene9.ts'));
  ({ applyTraversalCamera } = await server.ssrLoadModule('/core/camera.ts'));
});
after(async () => { await server?.close(); });

function browser(t) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const prompt = { textContent: '', classList: { toggle() {}, add() {}, remove() {} } };
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), {
    pointerLockElement: null, body: { requestPointerLock() {} }, getElementById: () => prompt,
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }),
  });
  return () => { globalThis.window = oldWindow; globalThis.document = oldDocument; };
}
function pressE() { const event = new Event('keydown'); Object.defineProperties(event, { code: { value: 'KeyE' }, repeat: { value: false } }); window.dispatchEvent(event); }
function key(type, code) { const event = new Event(type); Object.defineProperties(event, { code: { value: code }, repeat: { value: false } }); window.dispatchEvent(event); }

test('Scene 7 ladder entry completes one climb handoff', t => {
  const restore = browser(t);
  const data = createScene7(); t.after(() => { data.dispose(); restore(); });
  let climbed = 0; data.setLadderTrigger(() => { climbed++; });
  data.getDamageTargets().forEach(item => item.damage(35, 'crowbar'));
  data.player.setPosition(4.6, 0.3, -2.95); pressE();
  for (let index = 0; index < 420; index++) data.updatePhysics(1 / 60, true);
  assert.equal(climbed, 1);
  assert.ok(data.player.body.position.y > 4, 'Climb reaches the hatch before handing off');
});

test('Scene 8 forces crouch and its galley hatch completes one ladder handoff', t => {
  const restore = browser(t);
  const data = createScene8(); t.after(() => { data.dispose(); restore(); });
  assert.equal(data.player.getState().crouching, true);
  let returned = 0;
  data.setReturnToSeven(() => { returned++; });
  data.player.setPosition(0, 0.3, -6.5); pressE();
  for (let index = 0; index < 100; index++) data.updatePhysics(1 / 60, true);
  assert.equal(returned, 1);
});

test('Scene 8 forward hatch completes one ladder handoff', t => {
  const restore = browser(t);
  const data = createScene8(); t.after(() => { data.dispose(); restore(); });
  let descended = 0;
  data.setDescendToNine(() => { descended++; });
  data.player.setPosition(0, 0.3, 6.5); pressE();
  for (let index = 0; index < 100; index++) data.updatePhysics(1 / 60, true);
  assert.equal(descended, 1);
});

test('Scene 8 deck return spawns at the far end facing the galley with solid endpoint walls', t => {
  const restore = browser(t);
  const data = createScene8({ entry: 'deck' }); t.after(() => { data.dispose(); restore(); });
  assert.ok(data.player.body.position.z > 5);
  assert.equal(data.player.getState().yaw, 0);
  const walls = data.physicsWorld.bodies.filter(body => body.shapes.some(shape => shape.type === 4));
  assert.ok(walls.length >= 6, 'Vent shell includes endpoint barriers');
});

test('Scene 9 holds the player in the ladder animation state during entry and returns to the vent', t => {
  const restore = browser(t);
  const data = createScene9(); t.after(() => { data.dispose(); restore(); });
  assert.equal(data.player.getState().climbing, true);
  step(data, 12);
  assert.equal(data.player.getState().climbing, false);
  let returned = 0;
  data.setReturnToEight(() => { returned++; });
  data.player.setPosition(0, 0.3, data.ladderZ + 0.72); pressE();
  step(data, 13);
  assert.equal(returned, 1);
});

test('Scene 9 clears held movement when the entry climb releases the player', t => {
  const restore = browser(t);
  const data = createScene9(); t.after(() => { data.dispose(); restore(); });
  key('keydown', 'KeyW');
  step(data, 12);
  const startZ = data.player.body.position.z;
  for (let index = 0; index < 60; index++) data.updatePhysics(1 / 60, true);
  key('keyup', 'KeyW');
  assert.equal(data.player.getState().climbing, false);
  assert.ok(Math.abs(data.player.body.position.z - startZ) < 0.01, 'entry handoff requires a fresh movement press');
  key('keydown', 'KeyW'); step(data, 1); key('keyup', 'KeyW');
  assert.ok(data.player.body.position.z > startZ + 2);
});

function step(data, seconds, fps = 60) {
  for (let i = 0; i < Math.ceil(seconds * fps); i++) data.updatePhysics(1 / fps, true);
}
function bay(t, options) {
  const restore = browser(t);
  const data = createScene9(options);
  t.after(() => { data.dispose(); restore(); });
  step(data, 12);
  return data;
}

for (const fps of [30, 60, 144]) {
  for (const [code, axis, sign] of [['KeyW', 'z', 1], ['KeyS', 'z', -1], ['KeyA', 'x', 1], ['KeyD', 'x', -1], ['Space', 'y', 1], ['KeyC', 'y', -1]]) {
    test(`Zero-G ${code} responds after idle at ${fps} FPS`, t => {
      const data = bay(t);
      data.player.setPosition(0, 4, -4);
      step(data, 3, fps);
      const start = data.player.body.position[axis];
      key('keydown', code); step(data, 1, fps); key('keyup', code);
      assert.ok((data.player.body.position[axis] - start) * sign > 2, `${code} actually changes position after sleep timeout`);
      assert.equal(data.player.body.type, 1, 'DYNAMIC after descent');
      assert.equal(data.player.body.sleepState, 0, 'Controlled body never sleeps');
      assert.equal(data.player.getState().crouching, false);
      const speed = data.player.body.velocity.length();
      step(data, 0.5, fps);
      assert.ok(data.player.body.velocity.length() < speed * 0.1, 'Release brakes drift');
    });
  }
  test(`Vent A/D turns reverse direction without strafing at ${fps} FPS`, t => {
    const restore = browser(t);
    const data = createScene8(); t.after(() => { data.dispose(); restore(); });
    data.player.setPosition(0, 0.3, -3); step(data, 0.1, fps);
    const startYaw = data.player.getState().yaw;
    key('keydown', 'KeyA'); step(data, 0.6, fps); key('keyup', 'KeyA');
    assert.ok(Math.abs(data.player.getState().yaw - startYaw - Math.PI) < 0.001);
    assert.ok(Math.abs(data.player.body.position.x) < 0.01);
    key('keydown', 'KeyW'); step(data, 1, fps); key('keyup', 'KeyW');
    assert.ok(data.player.body.position.z < -4.5, 'W follows the reversed heading');
    key('keydown', 'KeyD'); step(data, 0.6, fps); key('keyup', 'KeyD');
    assert.ok(Math.abs(data.player.getState().yaw - startYaw) < 0.001);
    key('keydown', 'KeyW'); step(data, 1, fps); key('keyup', 'KeyW');
    assert.ok(Math.abs(data.player.body.position.z + 3) < 0.1);
  });
}

test('Zero-G boost, diagonal speed, blur and collision containment', t => {
  const data = bay(t);
  data.player.setPosition(0, 4, -4);
  key('keydown', 'KeyW'); key('keydown', 'ShiftLeft'); step(data, 1);
  assert.ok(data.player.body.velocity.length() > 4.5);
  key('keydown', 'KeyA'); key('keydown', 'Space'); step(data, 0.25);
  assert.ok(data.player.body.velocity.length() <= 4.81);
  window.dispatchEvent(new Event('blur')); step(data, 0.1);
  assert.ok(data.player.body.velocity.length() < 0.001);
  data.player.setPosition(0, 3, 12);
  key('keydown', 'KeyW'); step(data, 3); key('keyup', 'KeyW');
  assert.ok(data.player.body.position.z < 13, 'Pressure field contains the player');
  data.player.setPosition(3, 8.5, -3);
  key('keydown', 'Space'); step(data, 3); key('keyup', 'Space');
  assert.ok(data.player.body.position.y < 9, 'Ceiling contains the physics body');
});

test('Gravity control aligns cargo on belts, then floats it again without resetting progress', t => {
  const changes = [], data = bay(t, { onGravityChanged: value => changes.push(value) });
  pressE(); assert.deepEqual(changes, [], 'Out-of-range E does nothing');
  data.player.setPosition(0, 0.3, 11.3); pressE(); step(data, 2);
  assert.equal(data.isGravityRestored(), true); assert.equal(data.player.getState().floating, false);
  assert.equal(data.player.getState().isOnGround, true);
  assert.ok([...data.cargo.objects.values()].every(o => Math.abs(o.body.position.x) > 7.7));
  const ids = data.puzzle.cargo.map(c => c.id); data.puzzle.gates[10] = true;
  pressE(); step(data, 2); assert.equal(data.isGravityRestored(), false);
  assert.ok([...data.cargo.objects.values()].every(o => o.body.position.y > 1.5));
  assert.deepEqual(data.puzzle.cargo.map(c => c.id), ids); assert.equal(data.puzzle.gates[10], true);
  key('keydown', 'Space'); step(data, 0.3); key('keyup', 'Space'); assert.ok(data.player.body.position.y > 0.6);
  pressE(); assert.equal(data.isGravityRestored(), true); assert.deepEqual(changes, [true, false, true]);
  data.player.disable(); pressE(); assert.deepEqual(changes, [true, false, true]);
});

test('Both gravity modes can be restored on revisiting scene 9', t => {
  const restore = browser(t);
  t.after(restore);
  for (const gravityRestored of [true, false]) {
    const data = createScene9({ gravityRestored });
    step(data, 12);
    assert.equal(data.isGravityRestored(), gravityRestored);
    assert.equal(data.player.getState().floating, !gravityRestored);
    assert.equal(data.physicsWorld.gravity.y === 0, !gravityRestored);
    data.dispose();
  }
});

test('Traversal camera frames the climber and stays inside the vent during turns', t => {
  const restore = browser(t);
  const data = createScene8(); t.after(() => { data.dispose(); restore(); });
  for (const z of [-7.5, 0, 7.5]) {
    data.player.setPosition(0, 0.3, z);
    key('keydown', 'KeyD');
    for (let i = 0; i < 40; i++) {
      data.updatePhysics(1 / 60, true);
      assert.equal(applyTraversalCamera(data.camera, data.player, true), true);
      assert.ok(Math.abs(data.camera.position.x) <= (z === 0 ? 1.25 : 1));
      assert.ok(data.camera.position.y <= 1.12 && data.camera.position.y >= 0.35);
      assert.ok(Math.abs(data.camera.position.z) <= 7.85, JSON.stringify({ camera: data.camera.position, player: data.player.body.position, yaw: data.player.getState().yaw }));
    }
    key('keyup', 'KeyD');
  }
  const galley = createScene7();
  try {
    galley.getDamageTargets().forEach(item => item.damage(35, 'crowbar'));
    galley.player.setPosition(4.6, 0.3, -2.95); galley.player.setClimbing(true);
    applyTraversalCamera(galley.camera, galley.player, true);
    assert.ok(galley.camera.position.distanceTo(galley.player.body.position) > 1.5, 'Climb camera is outside the model in the galley');
  } finally { galley.dispose(); }
});