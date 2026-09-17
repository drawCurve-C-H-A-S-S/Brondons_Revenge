import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server;
let loadCharacter;
let createPlayer;
let createScenePhysics;
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
  ({ createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
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
  const physics = createScenePhysics();
  const world = physics.world;
  physics.addBox({ x: 100, y: 0.4, z: 100 }, { x: 0, y: -0.2, z: 0 });
  const player = createPlayer({ camera, physicsWorld: world, spawnPosition: { x: 0, y: 0.3, z: 0 } });
  t.after(() => {
    player.dispose();
    physics.dispose();
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
      physics.step(1 / 60, player);
      character.update(1 / 60, player.body.position, player.getState(), thirdPerson, player.radius);
    }
  }

  // Observe the real mixer's effective actions, not a mocked state machine.
  function weight(name) {
    // Three.js has no public action enumeration API; inspect it only in tests.
    const action = character.mixer._actions.find(action => action.getClip().name === name);
    return action?.getEffectiveWeight() ?? 0;
  }

  // Returns the mixer's local time for an action, or null if not found.
  // A never-played action has time === 0; one that advanced has time > 0.
  function actionTime(name) {
    const action = character.mixer._actions.find(action => action.getClip().name === name);
    return action ? action.time : null;
  }

  return { player, character, camera, world, physics, key, frame, weight, actionTime };
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
    isMoving: false, isOnGround: false, jumping: false, yaw: 0, velocityY: 0, actionRequest: null,
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
  frame(60);
  assert.equal(player.getState().isOnGround, false);
  assert.ok(weight('Jump_Loop') > 0.99);
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
  const { player, frame: physicsFrame, key, weight } = await fixture(t);
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

test('doorway arrival aligns the real character before rendering without a half-turn animation', async t => {
  const { character, player, camera } = await fixture(t);
  for (const yaw of [0.2, Math.PI, -Math.PI / 2]) {
    player.setRotation(yaw, 0);
    player.updateCamera(0);
    character.setFacing(yaw);
    character.update(0, player.body.position, player.getState(), true, player.radius);
    const modelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(character.model.quaternion);
    const cameraForward = camera.getWorldDirection(new THREE.Vector3());
    assert.ok(modelForward.dot(cameraForward) > 0.999999, 'Model must face the arrival direction immediately');
  }
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

for (const [code, clip] of [
  ['Digit6', 'Sword_Attack'],
  ['Digit7', 'Pistol_Shoot'],
  ['Digit8', 'Pistol_Reload'],
  ['Digit9', 'Dance_Loop'],
]) {
  test(`${code} plays ${clip} exactly once then returns to idle`, async t => {
    const { frame, key, weight } = await fixture(t);
    frame(30);
    key('keydown', code); // deliberately no keyup: holding must not retrigger
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
      frame();
      started = weight(clip) > 0.5;
    }
    assert.ok(started, `${code} must start ${clip}`);
    let returned = false;
    for (let i = 0; i < 600 && !returned; i++) {
      frame();
      returned = weight('Idle_Loop') > 0.99;
    }
    assert.ok(returned, `${clip} must finish and return to Idle_Loop`);
    frame(120);
    assert.ok(weight(clip) < 0.01, `${clip} must not replay while the key stays held`);
    assert.ok(weight('Idle_Loop') > 0.99, 'Idle must stay after the action');
  });
}

test('a one-shot action during walking resumes Walk_Loop after finishing', async t => {
  const { frame, key, weight } = await fixture(t);
  key('keydown', 'KeyW');
  frame(30);
  assert.ok(weight('Walk_Loop') > 0.99);
  key('keydown', 'Digit6');
  let started = false;
  for (let i = 0; i < 60 && !started; i++) {
    frame();
    started = weight('Sword_Attack') > 0.5;
  }
  assert.ok(started, 'Sword_Attack must play while walking');
  let walking = false;
  for (let i = 0; i < 600 && !walking; i++) {
    frame();
    walking = weight('Walk_Loop') > 0.99;
  }
  assert.ok(walking, 'Walk_Loop must resume after the action completes');
  key('keyup', 'Digit6');
  key('keyup', 'KeyW');
});

test('action keys pressed mid-air are ignored', async t => {
  const { frame, key, actionTime } = await fixture(t);
  frame(30);
  key('keydown', 'Space');
  frame(10); // rising
  key('keydown', 'Digit6');
  frame(240); // land and settle
  key('keyup', 'Space');
  // A never-played action keeps time === 0; getEffectiveWeight() reports 1
  // by default, so we check the mixer never advanced the action.
  assert.equal(actionTime('Sword_Attack'), 0, 'Mid-air action press must be dropped');
});
