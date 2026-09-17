import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server;
let loadCharacter;
let createPlayer;
let modelData;

before(async () => {
  const buffer = await readFile(new URL('../src/assets/models/UAL1_Standard.glb', import.meta.url));
  modelData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ loadCharacter } = await server.ssrLoadModule('/scripts/characterManager.ts'));
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
});

after(async () => { await server?.close(); });

async function fixture(t) {
  // Use the actual GLB and loader; replace only the browser URL transport.
  const loader = new GLTFLoader();
  t.mock.method(loader, 'loadAsync', function () {
    return this.parseAsync(modelData.slice(0), '');
  });
  t.mock.method(console, 'log', () => {});
  const character = await loadCharacter(loader);
  assert.ok(character, 'Real model must load');
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.document.pointerLockElement = null;
  globalThis.document.body = { requestPointerLock() {} };
  const camera = new THREE.PerspectiveCamera();
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  const player = createPlayer({ camera, physicsWorld: world, spawnPosition: { x: 0, y: 0.3, z: 0 } });
  t.after(() => {
    player.dispose();
    character.dispose();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  });
  player.enable();

  function key(type, code) {
    const event = new Event(type);
    Object.defineProperty(event, 'code', { value: code });
    window.dispatchEvent(event);
  }

  function frame(frames = 1, thirdPerson = true) {
    for (let i = 0; i < frames; i++) {
      player.update(1 / 60);
      character.update(1 / 60, player.body.position, player.getState(), thirdPerson, player.radius);
    }
  }

  // Observe the real mixer's effective actions, not a mocked state machine.
  function weight(name) {
    // Three.js has no public action enumeration API; inspect it only in tests.
    const action = character.mixer._actions.find(action => action.getClip().name === name);
    return action?.getEffectiveWeight() ?? 0;
  }

  return { player, character, camera, world, key, frame, weight };
}

test('actual GLB binds idle/walk to the skeleton and deforms the skin', async t => {
  const { scene, animations } = await new GLTFLoader().parseAsync(modelData.slice(0), '');
  const bones = [];
  const meshes = [];
  scene.traverse(node => {
    if (node.isBone) bones.push(node);
    if (node.isSkinnedMesh) meshes.push(node);
  });
  assert.equal(animations.length, 43);
  assert.equal(bones.length, 65);
  assert.ok(meshes.length > 0);
  const mixer = new THREE.AnimationMixer(scene);
  const thigh = scene.getObjectByName('thigh_l');
  for (const name of ['Idle_Loop', 'Walk_Loop']) {
    const clip = THREE.AnimationClip.findByName(animations, name);
    assert.ok(clip);
    for (const track of clip.tracks) {
      const target = THREE.PropertyBinding.parseTrackName(track.name);
      const node = THREE.PropertyBinding.findNode(scene, target.nodeName);
      assert.ok(node?.isBone, `Missing bone binding: ${track.name}`);
      assert.ok(meshes.some(mesh => mesh.skeleton.bones.includes(node)), `${track.name} is not in a skin`);
    }
    const root = clip.tracks.find(track => track.name === 'root.position');
    let rootDelta = 0;
    for (let i = 3; i < root.values.length; i++) {
      rootDelta = Math.max(rootDelta, Math.abs(root.values[i] - root.values[i % 3]));
    }
    assert.ok(rootDelta < 1e-5, `${name} unexpectedly contains root translation`);
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    mixer.update(0);
    scene.updateMatrixWorld(true);
    const initialThigh = thigh.quaternion.clone();
    const mesh = meshes[0];
    const vertices = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) =>
      mesh.getVertexPosition(i, new THREE.Vector3()));
    mixer.update(clip.duration * 0.25);
    scene.updateMatrixWorld(true);
    let maxDeformation = 0;
    for (let i = 0; i < vertices.length; i++) {
      maxDeformation = Math.max(maxDeformation, vertices[i].distanceTo(mesh.getVertexPosition(i, new THREE.Vector3())));
    }
    assert.ok(maxDeformation > 1e-5, `${name} must animate skinned vertices`);
    t.diagnostic(`${name}: ${clip.tracks.length} valid tracks; root delta=${rootDelta}; thigh angle=${initialThigh.angleTo(thigh.quaternion)}; max vertex motion=${maxDeformation}`);
  }
  mixer.stopAllAction();
});

test('wake-up initializes grounded state before the first animation update', async t => {
  const { player } = await fixture(t);
  player.disable();
  player.setPosition(7.3, 0.3, -11.375);
  player.enable();
  assert.equal(player.getState().isOnGround, true);
  assert.equal(player.getState().isMoving, false);
});

test('grounded WASD selects Walk_Loop and release returns to Idle_Loop', async t => {
  const { frame, key, weight, character } = await fixture(t);
  frame(30);
  assert.ok(weight('Idle_Loop') > 0.99);
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    key('keydown', code);
    frame(30);
    assert.ok(weight('Walk_Loop') > 0.99, `${code} must select Walk_Loop`);
    const thigh = character.model.getObjectByName('thigh_l');
    const initial = thigh.quaternion.clone();
    frame(10);
    assert.ok(initial.angleTo(thigh.quaternion) > 0.01, `${code} must move the leg`);
    key('keyup', code);
    frame(30);
    assert.ok(weight('Idle_Loop') > 0.99, `${code} release must select Idle_Loop`);
    assert.ok(weight('Walk_Loop') < 0.01);
  }
});

test('an airborne frame cannot permanently block grounded walk or idle', async t => {
  const { player, character, frame, key, weight } = await fixture(t);
  character.update(1 / 60, player.body.position, {
    isMoving: false, isOnGround: false, jumping: false, yaw: 0, velocityY: 0,
  }, true, player.radius);
  frame(120);
  assert.ok(weight('Idle_Loop') > 0.99, 'Landing must leave airborne animation');
  key('keydown', 'KeyW');
  frame(30);
  assert.ok(weight('Walk_Loop') > 0.99);
});

test('jump takeoff stays airborne and landing restores locomotion', async t => {
  const { player, frame, key, weight } = await fixture(t);
  frame(30);
  key('keydown', 'Space');
  frame();
  assert.ok(player.body.velocity.y > 0);
  assert.equal(player.getState().isOnGround, false);
  assert.equal(player.getState().jumping, true);
  key('keyup', 'Space');
  player.body.position.y = 1.5;
  frame(45);
  assert.ok(weight('Jump_Loop') > 0.99);
  player.body.position.y = 0.3;
  player.body.velocity.y = -1;
  frame(120);
  assert.ok(weight('Idle_Loop') > 0.99);
  key('keydown', 'KeyW');
  frame(30);
  assert.ok(weight('Walk_Loop') > 0.99);
});

test('opposed keys, blur, and disable do not leave walking stuck', async t => {
  const { player, frame, key, weight } = await fixture(t);
  key('keydown', 'KeyW');
  key('keydown', 'KeyS');
  frame(30);
  assert.ok(weight('Idle_Loop') > 0.99);
  key('keyup', 'KeyS');
  frame(30);
  window.dispatchEvent(new Event('blur'));
  frame(30);
  assert.equal(player.getState().isMoving, false);
  assert.ok(weight('Idle_Loop') > 0.99);
  key('keydown', 'KeyW');
  player.disable();
  assert.equal(player.getState().isMoving, false);
  player.enable();
  frame(30);
  assert.ok(weight('Idle_Loop') > 0.99);
});

test('physics stepping keeps grounded locomotion stable and recovers after a jump', async t => {
  const { player, character, world, key, weight } = await fixture(t);
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  function physicsFrame() {
    world.step(1 / 60);
    player.update(1 / 60);
    character.update(1 / 60, player.body.position, player.getState(), true, player.radius);
  }
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    key('keydown', code);
    for (let i = 0; i < 45; i++) {
      physicsFrame();
      assert.equal(player.getState().isOnGround, true, 'Walking must not report spurious flight');
    }
    assert.ok(weight('Walk_Loop') > 0.99);
    key('keyup', code);
  }
  for (let i = 0; i < 30; i++) physicsFrame();
  assert.ok(weight('Idle_Loop') > 0.99);
  key('keydown', 'Space');
  physicsFrame();
  key('keyup', 'Space');
  assert.equal(player.getState().isOnGround, false);
  for (let i = 0; i < 180; i++) physicsFrame();
  assert.equal(player.getState().isOnGround, true);
  assert.ok(weight('Idle_Loop') > 0.99);
  key('keydown', 'KeyW');
  for (let i = 0; i < 30; i++) physicsFrame();
  assert.ok(weight('Walk_Loop') > 0.99);
});

test('view changes keep animation running while first person hides the model', async t => {
  const { character, frame, key, weight } = await fixture(t);
  key('keydown', 'KeyW');
  frame(30, false);
  assert.equal(character.model.visible, false);
  assert.ok(weight('Walk_Loop') > 0.99);
  key('keyup', 'KeyW');
  frame(30, true);
  assert.equal(character.model.visible, true);
  assert.ok(weight('Idle_Loop') > 0.99);
});
