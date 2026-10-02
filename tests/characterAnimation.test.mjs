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
const originalSelf = globalThis.self;
const originalCreateImageBitmap = globalThis.createImageBitmap;

before(async () => {
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
  const buffer = await readFile(new URL('../src/assets/models/MC.glb', import.meta.url));
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

after(async () => {
  await server?.close();
  globalThis.self = originalSelf;
  globalThis.createImageBitmap = originalCreateImageBitmap;
});

async function fixture(t, asset) {
  const buffer = asset ? await readFile(new URL(`../src/assets/models/${asset}`, import.meta.url)) : null;
  const data = buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : modelData;
  // Use the actual GLB and loader; replace only the browser URL transport.
  const loader = new GLTFLoader();
  t.mock.method(loader, 'loadAsync', function () {
    return this.parseAsync(data.slice(0), '');
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
  assert.equal(bones.length, 99);
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
  frame(15);
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

test('scripted ladder traversal selects the generated alternating climb loop', async t => {
  const { player, character, frame, weight } = await fixture(t);
  player.setClimbing(true);
  frame(15);
  assert.ok(weight('Ladder_Climb_Loop') > 0.99);
  const leftArm = character.model.getObjectByName('upperarm_l').quaternion.clone();
  frame(10);
  assert.ok(leftArm.angleTo(character.model.getObjectByName('upperarm_l').quaternion) > 0.1);
  player.setClimbing(false);
  frame(30);
  assert.ok(weight('Idle_Loop') > 0.99);
});

for (const asset of ['Subject.glb', 'MC.glb']) {
  test(`${asset} ladder IK alternates hands and flexes both knees, with seamless looping`, async t => {
    const { player, character, frame } = await fixture(t, asset);
    player.setClimbing(true);
    character.weapon.setEquipped(true);
    frame(15);
    const action = character.mixer._actions.find(a => a.getClip().name === 'Ladder_Climb_Loop');
    const clip = action.getClip();
    const names = clip.tracks.map(t => t.name);
    for (const bone of ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r']) {
      assert.ok(names.includes(`${bone}.quaternion`), `${bone} is animated`);
      const track = clip.tracks.find(t => t.name === `${bone}.quaternion`);
      const first = new THREE.Quaternion().fromArray(track.values);
      const middle = new THREE.Quaternion().fromArray(track.values, 24 * 4);
      const last = new THREE.Quaternion().fromArray(track.values, track.values.length - 4);
      assert.ok(first.angleTo(middle) > 0.1, `${bone} has meaningful motion`);
      assert.ok(first.angleTo(last) < 0.001, `${bone} loop is seamless`);
    }
    const pose = time => {
      action.time = time;
      character.update(0, player.body.position, player.getState(), true, player.radius);
      character.model.updateMatrixWorld(true);
      return ['hand_l', 'hand_r', 'foot_l', 'foot_r'].map(name =>
        character.model.worldToLocal(character.model.getObjectByName(name).getWorldPosition(new THREE.Vector3())));
    };
    const a = pose(0), b = pose(clip.duration / 2);
    assert.ok(a[0].y > a[1].y + 0.25 && b[1].y > b[0].y + 0.25, 'Opposite hands reach in alternation');
    assert.ok(Math.abs(a[2].y - b[2].y) > 0.25 && Math.abs(a[3].y - b[3].y) > 0.25, 'Boots step between rungs');
    assert.ok(a.slice(0, 2).every(p => p.z > 0.35), 'Hands reach toward the ladder, even while armed');
    player.setClimbing(true, -1); frame();
    assert.equal(action.getEffectiveTimeScale(), -1, 'Descent reverses the climb');
  });

  test(`${asset} hands face the rungs and relax instead of keeping the climbing grip in zero-G`, async t => {
    const { player, character, frame, world } = await fixture(t, asset);
    player.setClimbing(true); frame(30);
    const direction = suffix => {
      character.model.updateMatrixWorld(true);
      const hand = character.model.getObjectByName(`hand_${suffix}`);
      const finger = character.model.getObjectByName(`middle_01_${suffix}`);
      return finger.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3()))
        .applyQuaternion(character.model.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    };
    for (const suffix of ['l', 'r']) {
      assert.ok(direction(suffix).y > 0.98, 'Fingers point upward to wrap over a rung, not sideways');
      const hand = character.model.getObjectByName(`hand_${suffix}`);
      const palm = hand.userData.restPalm.clone().applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()))
        .applyQuaternion(character.model.getWorldQuaternion(new THREE.Quaternion()).invert());
      assert.ok(palm.z > 0.98, 'Both palms face the ladder');
    }
    world.gravity.set(0, 0, 0); player.setClimbing(false); player.setZeroGravity(true); frame(60);
    for (const suffix of ['l', 'r']) {
      assert.ok(direction(suffix).z > 0.9, 'Floating hands relax forward');
      assert.ok(direction(suffix).y < 0.2, 'Ladder wrist orientation does not leak into floating');
    }
  });

  test(`${asset} floating yields to climbing and returns to normal locomotion`, async t => {
    const { player, character, frame, world, weight } = await fixture(t, asset);
    world.gravity.set(0, 0, 0); player.setZeroGravity(true); frame(30);
    assert.ok(weight('Float_Loop') > 0.99);
    const clip = character.mixer._actions.find(a => a.getClip().name === 'Float_Loop').getClip();
    assert.ok(clip.tracks.some(t => t.name === 'calf_l.quaternion'));
    player.setClimbing(true); frame(30);
    assert.ok(weight('Ladder_Climb_Loop') > 0.99, 'Climbing takes priority in zero-G');
    player.setClimbing(false); frame(30);
    assert.ok(weight('Float_Loop') > 0.99);
    player.setZeroGravity(false); world.gravity.set(0, -9.82, 0); frame(120);
    assert.ok(weight('Idle_Loop') > 0.99);
  });
}

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
    assert.ok(modelForward.dot(cameraForward) > 0.999999, `Arrival yaw=${yaw}, model=${modelForward.toArray()}, camera=${cameraForward.toArray()}`);
  }
});

test('view changes keep animation running while first person hides the model', async t => {
  const { character, frame, key, weight } = await fixture(t);
  key('keydown', 'KeyW');
  frame(30, false);
  character.model.traverse(node => {
    assert.equal(node.layers.isEnabled(0), false, 'First-person gameplay layer hides the model');
    assert.equal(node.layers.isEnabled(1), true, 'CCTV/mirror layer retains the model');
  });
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

test('pistol equip reloads once, firing plays the shot, and upper-body transitions preserve walking', async t => {
  const { character, frame, key, weight } = await fixture(t);
  const layer = name => character.weapon.mixer._actions.find(action => action.getClip().name === `${name}_UpperBody`);
  key('keydown', 'KeyW'); frame(30);
  character.weapon.setEquipped(true); frame(12);
  assert.ok(layer('Pistol_Reload').isRunning(), 'Equip starts the authored reload clip');
  assert.ok(weight('Walk_Loop') > 0.99, 'Reload does not replace leg locomotion');
  const time = layer('Pistol_Reload').time;
  character.weapon.setEquipped(true); frame();
  assert.ok(layer('Pistol_Reload').time > time, 'Repeated equip state does not restart reload');
  frame(180);
  assert.ok(layer('Pistol_Aim_Neutral').isRunning(), 'Equip returns to a two-handed aiming hold');
  character.weapon.shoot(); frame(6);
  assert.ok(layer('Pistol_Shoot').isRunning(), 'Actual firing starts the authored shooting clip');
  assert.ok(weight('Walk_Loop') > 0.99);
  frame(120);
  assert.ok(layer('Pistol_Aim_Neutral').isRunning(), 'Shot returns to aiming');
  key('keydown', 'Digit8'); frame(10);
  assert.ok(layer('Pistol_Reload').isRunning(), '8 triggers reload on the same upper-body layer');
  assert.ok(weight('Walk_Loop') > 0.99);
  character.weapon.setEquipped(false); frame(60);
  assert.ok(weight('Walk_Loop') > 0.99, 'Holstering preserves walking');
});

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
