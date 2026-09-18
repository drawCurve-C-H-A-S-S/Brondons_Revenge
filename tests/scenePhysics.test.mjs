import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createServer } from 'vite';

let server;
let createScene2;
let createScene3;
let createScene4;
let createScene5;
let createScenePhysics;
let createPlayer;
let PHYSICS;
let loadCharacter;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createScene: createScene2 } = await server.ssrLoadModule('/scenes/scene2.ts'));
  ({ createScene: createScene3 } = await server.ssrLoadModule('/scenes/scene3.ts'));
  ({ createScene: createScene4 } = await server.ssrLoadModule('/scenes/scene4.ts'));
  ({ createScene: createScene5 } = await server.ssrLoadModule('/scenes/scene5.ts'));
  ({ createScenePhysics, PHYSICS } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
  ({ loadCharacter } = await server.ssrLoadModule('/scripts/characterManager.ts'));
});
after(async () => { await server?.close(); });

function browserStubs() {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = Object.assign(new EventTarget(), {
    pointerLockElement: null,
    body: { requestPointerLock() {}, appendChild() {} },
    createElement: () => ({ getContext: () => context, style: {}, remove() {} }),
  });
  return () => { globalThis.window = oldWindow; globalThis.document = oldDocument; };
}

function key(type, code) {
  const event = new Event(type);
  Object.defineProperty(event, 'code', { value: code });
  window.dispatchEvent(event);
}

function sceneFixture(t, factory = createScene2) {
  const restore = browserStubs();
  const data = factory({ skipWake: true });
  t.after(() => { data.dispose(); restore(); });
  return data;
}

function simpleFixture(t, setup) {
  const restore = browserStubs();
  const physics = createScenePhysics();
  setup?.(physics);
  const player = createPlayer({
    camera: new THREE.PerspectiveCamera(), physicsWorld: physics.world,
    spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 0 },
  });
  player.enable();
  t.after(() => { player.dispose(); physics.dispose(); restore(); });
  return { physics, player, updatePhysics: dt => physics.step(dt, player) };
}

function stubComputerLoaders(t) {
  const load = (_url, onLoad) => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    t.after(() => material.dispose());
    onLoad(group);
  };
  return [
    t.mock.method(OBJLoader.prototype, 'load', load),
    t.mock.method(FBXLoader.prototype, 'load', load),
    t.mock.method(THREE.TextureLoader.prototype, 'load', (_url, onLoad) => { const texture = new THREE.Texture(); onLoad?.(texture); return texture; }),
  ];
}

function grounded(player, message) {
  if (!player.getState().isOnGround) {
    const from = player.body.position.clone();
    const hits = [];
    player.body.world.raycastAll(from, from.vadd(new CANNON.Vec3(0, -0.6, 0)), { skipBackfaces: true }, hit => {
      if (hit.body !== player.body) hits.push({ point: hit.hitPointWorld.toString(), normal: hit.hitNormalWorld.toString() });
    });
    console.log('Support failure', message, hits);
  }
  assert.equal(player.getState().isOnGround, true,
    `${message}: position=${player.body.position.toString()}, velocity=${player.body.velocity.toString()}`);
  assert.equal(player.getState().jumping, false, message);
}

function frames(data, count, dt = 1 / 60, check) {
  for (let i = 0; i < count; i++) { data.updatePhysics(dt); check?.(i); }
}

test('actual Scene 2 upper floor supports a slightly penetrating player without false jumps', t => {
  const data = sceneFixture(t);
  data.player.setPosition(6, 5.19, 0);
  frames(data, 600, 1 / 60, () => grounded(data.player, 'Upper floor'));
  assert.ok(Math.abs(data.player.body.position.y - 5.2) < 0.01);
});

for (const fps of [30, 60, 144]) {
  for (const x of [-3, 3]) {
    test(`Scene 2 stairs x=${x}: up, stop, landing, and down at ${fps} FPS`, t => {
      const data = sceneFixture(t);
      const { player } = data;
      player.setPosition(x, 0.3, 2);
      player.setRotation(Math.PI);
      key('keydown', 'KeyW');
      frames(data, Math.ceil(0.85 * fps), 1 / fps, () => grounded(player, 'Climbing'));
      key('keyup', 'KeyW');
      const stop = player.body.position.clone();
      frames(data, fps * 2, 1 / fps, () => grounded(player, 'Stopped on slope'));
      assert.ok(player.body.position.distanceTo(stop) < 0.03, 'Idle slope drift');
      key('keydown', 'KeyW');
      frames(data, Math.ceil(1.1 * fps), 1 / fps, () => grounded(player, 'Top transition'));
      key('keyup', 'KeyW');
      assert.ok(player.body.position.z > 10, 'Must reach the landing');
      assert.ok(Math.abs(player.body.position.y - 5.2) < 0.015, `Must not launch above the landing: ${player.body.position.toString()}`);
      player.setRotation(0);
      key('keydown', 'KeyW');
      frames(data, Math.ceil(2 * fps), 1 / fps, () => grounded(player, 'Descending'));
      key('keyup', 'KeyW');
      assert.ok(player.body.position.z < 2.3, 'Must return to ground floor');
      assert.ok(Math.abs(player.body.position.y - 0.3) < 0.015);
    });
  }
}

test('Scene 2 upstairs jump lands once even while Space stays held', t => {
  const data = sceneFixture(t);
  const { player } = data;
  player.setPosition(6, 5.2, 0);
  key('keydown', 'Space');
  data.updatePhysics(1 / 60);
  assert.equal(player.getState().isOnGround, false);
  assert.equal(player.getState().jumping, true);
  let peak = player.body.position.y;
  frames(data, 240, 1 / 60, i => {
    peak = Math.max(peak, player.body.position.y);
    if (i > 110) grounded(player, 'Landed without auto-jumping');
  });
  assert.ok(peak > 7 && peak < 8);
  key('keyup', 'Space');
});

test('Scene 2 meshes and colliders remain finite, with two physical stair wedges', t => {
  const data = sceneFixture(t);
  let wedges = 0;
  for (const body of data.physicsWorld.bodies) {
    assert.ok([...body.position.toArray(), ...body.quaternion.toArray()].every(Number.isFinite));
    wedges += body.shapes.filter(shape => shape.type === CANNON.Shape.types.CONVEXPOLYHEDRON).length;
  }
  assert.equal(wedges, 2);
  data.scene.updateMatrixWorld(true);
  data.scene.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite), node.name));
});

test('no inherited scene coordinates: empty space and non-solid triggers never support a player', t => {
  const data = simpleFixture(t, physics => {
    const sensor = physics.addBox({ x: 20, y: 0.4, z: 30 }, { x: 0, y: 4.7, z: 0 });
    sensor.collisionResponse = false;
  });
  data.player.setPosition(6, 5.2, 0);
  assert.equal(data.player.getState().isOnGround, false);
  frames(data, 90);
  assert.ok(data.player.body.position.y < 0);
});

test('finite floor edge drops the player; wall contact is not ground', t => {
  const data = simpleFixture(t, physics => {
    physics.addBox({ x: 2, y: 0.4, z: 2 }, { x: 0, y: -0.2, z: 0 });
    physics.addBox({ x: 0.4, y: 10, z: 6 }, { x: 1.9, y: -1, z: 0 });
  });
  key('keydown', 'KeyD');
  frames(data, 90);
  assert.equal(data.player.getState().isOnGround, false);
  assert.ok(data.player.body.position.y < -2, 'Must fall despite pressing into a wall');
});

test('Scene 3 has no phantom upper floor and supports both door thresholds', t => {
  const data = sceneFixture(t, createScene3);
  data.player.setPosition(0, 5.2, 0);
  assert.equal(data.player.getState().isOnGround, false);
  frames(data, 180);
  grounded(data.player, 'Passage floor');
  for (const z of [-10.9, 10.9]) {
    data.player.setPosition(0, 0.3, z);
    frames(data, 60, 1 / 60, () => grounded(data.player, 'Door threshold'));
  }
});

test('Scene 5 floor, entry threshold, and serving island collision', t => {
  stubComputerLoaders(t);
  const data = sceneFixture(t, createScene5);
  data.player.setRotation(0);
  data.player.setPosition(0, 5.2, 0);
  assert.equal(data.player.getState().isOnGround, false);
  frames(data, 180);
  grounded(data.player, 'Cafeteria floor');
  data.player.setPosition(0, 0.3, 6.9);
  frames(data, 60, 1 / 60, () => grounded(data.player, 'Cafeteria threshold'));
  data.player.setPosition(0, 0.3, 0.4);
  key('keydown', 'KeyW');
  frames(data, 60, 1 / 60, () => grounded(data.player, 'Walking into the island'));
  key('keyup', 'KeyW');
  assert.ok(data.player.body.position.z > -0.4 && data.player.body.position.z < -0.2,
    `Island must block at the collider face: ${data.player.body.position.toString()}`);
});

test('Scene 5 kitchen appliances and dining furniture block movement', t => {
  stubComputerLoaders(t);
  const data = sceneFixture(t, createScene5);
  const { player } = data;
  player.setRotation(0);
  player.setPosition(2, 0.3, -4.2);
  key('keydown', 'KeyW');
  frames(data, 60, 1 / 60, () => grounded(player, 'Walking into the prep counter'));
  key('keyup', 'KeyW');
  assert.ok(player.body.position.z > -4.9 && player.body.position.z < -4.65,
    `Prep counter must block: ${player.body.position.toString()}`);
  player.setPosition(-2.6, 0.3, 5.6);
  key('keydown', 'KeyW');
  frames(data, 60, 1 / 60, () => grounded(player, 'Walking into the dining bench'));
  key('keyup', 'KeyW');
  assert.ok(player.body.position.z > 4.9 && player.body.position.z < 5.15,
    `Dining bench must block: ${player.body.position.toString()}`);
});

test('fixed-step movement is render-rate independent and long frames are bounded', t => {
  const data = simpleFixture(t, physics => {
    physics.addBox({ x: 100, y: 0.4, z: 100 }, { x: 0, y: -0.2, z: 0 });
  });
  const distances = [];
  for (const fps of [30, 60, 144]) {
    data.player.setPosition(0, 0.3, 0);
    key('keydown', 'KeyW');
    frames(data, fps, 1 / fps);
    key('keyup', 'KeyW');
    distances.push(-data.player.body.position.z);
  }
  for (const distance of distances) assert.ok(Math.abs(distance - 6) < 0.01, `${distances}`);
  const start = data.player.body.position.clone();
  key('keydown', 'KeyW');
  data.updatePhysics(10);
  assert.ok(data.player.body.position.distanceTo(start) <= 0.61);
  grounded(data.player, 'After a long frame');
});

test('real character stays in Walk_Loop climbing Scene 2 and returns to idle upstairs', async t => {
  const data = sceneFixture(t);
  const buffer = await readFile(new URL('../src/assets/models/UAL1_Standard.glb', import.meta.url));
  const loader = new GLTFLoader();
  t.mock.method(loader, 'loadAsync', function () {
    return this.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  });
  t.mock.method(console, 'log', () => {});
  const character = await loadCharacter(loader);
  assert.ok(character);
  t.after(() => character.dispose());
  const { player } = data;
  player.setPosition(3, 0.3, 2);
  player.setRotation(Math.PI);
  key('keydown', 'KeyW');
  const weight = name => character.mixer._actions.find(action => action.getClip().name === name).getEffectiveWeight();
  frames(data, 120, 1 / 60, i => {
    character.update(1 / 60, player.body.position, player.getState(), true, player.radius);
    if (i > 20) assert.ok(weight('Walk_Loop') > 0.99, 'Stairs must not select jump animation');
  });
  key('keyup', 'KeyW');
  frames(data, 60, 1 / 60, () => character.update(1 / 60, player.body.position, player.getState(), true, player.radius));
  assert.ok(weight('Idle_Loop') > 0.99);
  assert.ok(Math.abs(character.model.position.y - 4.9) < 0.01);
});

test('jumping on a Scene 2 slope takes off and returns to supported idle', t => {
  const data = sceneFixture(t);
  const { player } = data;
  player.setPosition(3, 2.45 + 0.3 * Math.sqrt(1 + 0.7 ** 2), 6);
  frames(data, 10);
  grounded(player, 'Slope spawn');
  key('keydown', 'Space');
  data.updatePhysics(1 / 60);
  key('keyup', 'Space');
  assert.equal(player.getState().jumping, true);
  assert.equal(player.getState().isOnGround, false);
  frames(data, 240);
  grounded(player, 'Slope landing');
  assert.ok(Math.abs(player.body.position.y - 2.8162) < 0.03);
});

test('stair rail panels block diagonal movement without launching the player', t => {
  const data = sceneFixture(t);
  const { player } = data;
  player.setPosition(3, 0.3, 2);
  player.setRotation(Math.PI);
  key('keydown', 'KeyW');
  frames(data, 30);
  key('keydown', 'KeyD');
  frames(data, 60, 1 / 60, () => grounded(player, 'Along stair barrier'));
  const insideRailLimit = 1.94 + 0.02 + player.radius - PHYSICS.contactTolerance;
  assert.ok(player.body.position.x >= insideRailLimit && player.body.position.x < 3, player.body.position.toString());
  key('keyup', 'KeyD');
  frames(data, 90, 1 / 60, () => grounded(player, 'Leaving stair barrier'));
  assert.ok(player.body.position.z > 10);
});

test('stair helper works at a different position, elevation, and orientation', t => {
  const data = simpleFixture(t, physics => {
    physics.addBox({ x: 40, y: 0.4, z: 40 }, { x: 0, y: 1.8, z: 0 });
    physics.addStaircase({ width: 2, run: 6, rise: 3, position: { x: 10, y: 2, z: -8 },
      yaw: Math.PI / 2, material: new THREE.MeshBasicMaterial() });
    physics.addBox({ x: 4, y: 0.4, z: 4 }, { x: 18, y: 4.8, z: -8 });
  });
  data.player.setPosition(9.5, 2.3, -8);
  data.player.setRotation(-Math.PI / 2);
  key('keydown', 'KeyW');
  frames(data, 90, 1 / 60, () => grounded(data.player, 'Rotated ramp'));
  assert.ok(data.player.body.position.x > 16.5);
  assert.ok(Math.abs(data.player.body.position.y - 5.3) < 0.015);
});

test('invalid geometry is rejected and steep surfaces are not walkable', t => {
  const data = simpleFixture(t, physics => {
    assert.throws(() => physics.addBox({ x: 0, y: 1, z: 1 }, { x: 0, y: 0, z: 0 }));
    assert.throws(() => physics.addStaircase({ width: 2, run: 1, rise: 5,
      position: { x: 0, y: 0, z: 0 }, material: new THREE.MeshBasicMaterial() }));
    assert.throws(() => physics.addStaircase({ width: 2, run: 7, rise: 4,
      position: { x: NaN, y: 0, z: 0 }, material: new THREE.MeshBasicMaterial() }));
    const parent = new THREE.Group();
    parent.scale.set(2, 1, 1);
    const sheared = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    sheared.rotation.z = Math.PI / 4;
    parent.add(sheared);
    assert.throws(() => physics.addBoxFromMesh(sheared), /nonsheared/);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 10));
    wall.rotation.z = Math.PI / 3;
    physics.addBoxFromMesh(wall);
  });
  data.player.setPosition(0, 1, 0);
  frames(data, 60);
  assert.equal(data.player.getState().isOnGround, false);
});

for (const direction of ['2-to-3', '3-to-2']) {
  for (const movement of [
    { name: 'forward at an angle', code: 'KeyW', yaw: Math.PI + 0.15 },
    { name: 'backward', code: 'KeyS', yaw: 0 },
    { name: 'sideways', code: 'KeyA', yaw: Math.PI / 2 },
  ]) {
    test(`door ${direction} preserves ${movement.name} movement, look, and existing mouse lock`, t => {
      const restore = browserStubs();
      document.pointerLockElement = document.body;
      const lockRequest = t.mock.method(document.body, 'requestPointerLock', () => {});
      const goingTo3 = direction === '2-to-3';
      const source = (goingTo3 ? createScene2 : createScene3)({ skipWake: true });
      const sourceDoorZ = goingTo3 ? 15 : 10;
      const destinationDoorZ = goingTo3 ? 10 : 15;
      let destination;
      let snapshot;
      let bounceCount = 0;
      t.after(() => { source.dispose(); destination?.dispose(); restore(); });
      const transition = state => {
        snapshot = state;
        destination = (goingTo3 ? createScene3 : createScene2)({ entryState: state });
        source.dispose();
        const onBounce = () => { bounceCount++; };
        if (goingTo3) destination.setBackTrigger(onBounce);
        else destination.setDoorTrigger(onBounce);
      };
      if (goingTo3) source.setDoorTrigger(transition);
      else source.setBackTrigger(transition);
      source.player.setPosition(0.2, 0.3, sourceDoorZ - 0.6);
      source.player.setRotation(movement.yaw, 0.27);
      frames(source, 60); // Open the exit before crossing it.
      key('keydown', movement.code);
      for (let i = 0; i < 60 && !destination; i++) source.updatePhysics(1 / 60);
      assert.ok(destination, 'The real door trigger must transition');
      assert.equal(destination.player.isEnabled(), true, 'Return must skip the wake sequence');
      const expectedYaw = Math.atan2(Math.sin(snapshot.yaw + Math.PI), Math.cos(snapshot.yaw + Math.PI));
      assert.ok(Math.abs(destination.player.getState().yaw - expectedYaw) < 1e-9);
      assert.ok(Math.abs(destination.camera.rotation.y - expectedYaw) < 1e-9, 'Camera heading is ready before the first frame');
      assert.ok(Math.abs(destination.player.body.position.x + snapshot.position.x) < 1e-9);
      assert.ok(Math.abs(destination.player.body.position.z - (destinationDoorZ - snapshot.position.z)) < 1e-9);
      assert.ok(Math.abs(destination.player.body.velocity.z + snapshot.velocity.z) < 1e-9);
      const arrival = destination.player.captureTransition({ x: 0, y: 0, z: destinationDoorZ });
      assert.equal(arrival.pitch, 0.27);
      assert.equal(arrival.bobTime, snapshot.bobTime);
      assert.equal(arrival.bobIntensity, snapshot.bobIntensity);
      assert.ok(arrival.heldKeys.includes(movement.code));
      const panels = destination.scene.children.filter(node => node.isMesh &&
        node.geometry.parameters.width === 1.6 && node.geometry.parameters.height === 3.5 &&
        node.geometry.parameters.depth === 0.08 && Math.abs(node.position.z - (destinationDoorZ + 0.15)) < 0.001);
      assert.equal(panels.length, 2);
      assert.ok(panels.every(panel => Math.abs(panel.position.x) > 2), 'Arrival door must already be open');
      const startZ = destination.player.body.position.z;
      frames(destination, 5);
      assert.ok(destination.player.body.position.z < startZ - 0.4, 'Held movement continues without another keydown');
      assert.equal(bounceCount, 0, 'Arrival must not retrigger the exit');
      const oldYaw = source.player.getState().yaw;
      const mouse = new Event('mousemove');
      Object.defineProperties(mouse, { movementX: { value: 12 }, movementY: { value: -3 } });
      window.dispatchEvent(mouse); // No pointerlockchange or click between controllers.
      assert.ok(Math.abs(destination.player.getState().yaw - (expectedYaw - 0.024)) < 1e-9);
      assert.equal(source.player.getState().yaw, oldYaw, 'Old input listeners must be removed');
      assert.equal(lockRequest.mock.callCount(), 0);
      key('keyup', movement.code);
      assert.equal(destination.player.getState().isMoving, false);
    });
  }
}

for (const direction of ['4-to-5', '5-to-4']) {
  for (const movement of [
    { name: 'forward at an angle', code: 'KeyW', yaw: Math.PI + 0.15 },
    { name: 'backward', code: 'KeyS', yaw: 0 },
    { name: 'sideways', code: 'KeyA', yaw: Math.PI / 2 },
  ]) {
    test(`door ${direction} preserves ${movement.name} movement, look, and existing mouse lock`, t => {
      const restore = browserStubs();
      document.pointerLockElement = document.body;
      const lockRequest = t.mock.method(document.body, 'requestPointerLock', () => {});
      stubComputerLoaders(t);
      const goingTo5 = direction === '4-to-5';
      const source = (goingTo5 ? createScene4 : createScene5)({ skipWake: true });
      const sourceDoorZ = 6;
      const destinationDoorZ = 6;
      let destination;
      let snapshot;
      let bounceCount = 0;
      t.after(() => { source.dispose(); destination?.dispose(); restore(); });
      const transition = state => {
        snapshot = state;
        destination = goingTo5
          ? createScene5({ entryState: state })
          : createScene4({ entryState: state, entryDoor: 'front' });
        source.dispose();
        const onBounce = () => { bounceCount++; };
        if (goingTo5) destination.setDoorTrigger(onBounce);
        else destination.setForwardTrigger(onBounce);
      };
      if (goingTo5) source.setForwardTrigger(transition);
      else source.setDoorTrigger(transition);
      source.player.setPosition(0.2, 0.3, sourceDoorZ - 0.6);
      source.player.setRotation(movement.yaw, 0.27);
      frames(source, 60); // Open the exit before crossing it.
      key('keydown', movement.code);
      for (let i = 0; i < 60 && !destination; i++) source.updatePhysics(1 / 60);
      assert.ok(destination, 'The real door trigger must transition');
      assert.equal(destination.player.isEnabled(), true, 'Return must skip the wake sequence');
      const expectedYaw = Math.atan2(Math.sin(snapshot.yaw + Math.PI), Math.cos(snapshot.yaw + Math.PI));
      assert.ok(Math.abs(destination.player.getState().yaw - expectedYaw) < 1e-9);
      assert.ok(Math.abs(destination.camera.rotation.y - expectedYaw) < 1e-9, 'Camera heading is ready before the first frame');
      assert.ok(Math.abs(destination.player.body.position.x + snapshot.position.x) < 1e-9);
      assert.ok(Math.abs(destination.player.body.position.z - (destinationDoorZ - snapshot.position.z)) < 1e-9);
      assert.ok(Math.abs(destination.player.body.velocity.z + snapshot.velocity.z) < 1e-9);
      const arrival = destination.player.captureTransition({ x: 0, y: 0, z: destinationDoorZ });
      assert.equal(arrival.pitch, 0.27);
      assert.equal(arrival.bobTime, snapshot.bobTime);
      assert.equal(arrival.bobIntensity, snapshot.bobIntensity);
      assert.ok(arrival.heldKeys.includes(movement.code));
      const panels = destination.scene.children.filter(node => node.isMesh &&
        node.geometry.parameters.width === 1.6 && node.geometry.parameters.height === 3.5 &&
        node.geometry.parameters.depth === 0.08 && Math.abs(node.position.z - (destinationDoorZ + 0.15)) < 0.001);
      assert.equal(panels.length, 2);
      assert.ok(panels.every(panel => Math.abs(panel.position.x) > 2), 'Arrival door must already be open');
      const startZ = destination.player.body.position.z;
      frames(destination, 5);
      assert.ok(destination.player.body.position.z < startZ - 0.4, 'Held movement continues without another keydown');
      assert.equal(bounceCount, 0, 'Arrival must not retrigger the exit');
      const oldYaw = source.player.getState().yaw;
      const mouse = new Event('mousemove');
      Object.defineProperties(mouse, { movementX: { value: 12 }, movementY: { value: -3 } });
      window.dispatchEvent(mouse); // No pointerlockchange or click between controllers.
      assert.ok(Math.abs(destination.player.getState().yaw - (expectedYaw - 0.024)) < 1e-9);
      assert.equal(source.player.getState().yaw, oldYaw, 'Old input listeners must be removed');
      assert.equal(lockRequest.mock.callCount(), 0);
      key('keyup', movement.code);
      assert.equal(destination.player.getState().isMoving, false);
    });
  }
}

test('manual pointer unlock still stops mouse look and clears held movement after transfer', t => {
  const data = sceneFixture(t);
  document.pointerLockElement = document.body;
  document.dispatchEvent(new Event('pointerlockchange'));
  key('keydown', 'KeyW');
  const next = createScene3({ entryState: data.player.captureTransition({ x: 0, y: 0, z: 15 }) });
  try {
    const yaw = next.player.getState().yaw;
    document.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));
    const mouse = new Event('mousemove');
    Object.defineProperties(mouse, { movementX: { value: 50 }, movementY: { value: 10 } });
    window.dispatchEvent(mouse);
    assert.equal(next.player.getState().yaw, yaw);
    assert.equal(next.player.getState().isMoving, false);
  } finally {
    next.dispose();
  }
});

test('door handoff preserves an airborne jump without jumping again on held Space', t => {
  const data = sceneFixture(t);
  data.player.setPosition(0, 0.3, 15.6);
  data.player.setRotation(Math.PI);
  key('keydown', 'Space');
  frames(data, 6);
  const state = data.player.captureTransition({ x: 0, y: 0, z: 15 });
  const next = createScene3({ entryState: state });
  try {
    assert.equal(next.player.getState().jumping, true);
    assert.equal(next.player.getState().isOnGround, false);
    assert.equal(next.player.body.velocity.y, state.velocity.y);
    assert.equal(next.player.body.position.y, state.position.y);
    frames(next, 240);
    grounded(next.player, 'Landing after scene transition');
  } finally {
    next.dispose();
  }
});

test('scene disposal removes old player listeners and physics bodies', t => {
  const data = sceneFixture(t);
  data.dispose();
  key('keydown', 'KeyW');
  assert.equal(data.player.isEnabled(), false);
  assert.equal(data.player.getState().isMoving, false);
  assert.equal(data.physicsWorld.bodies.length, 0);
});
