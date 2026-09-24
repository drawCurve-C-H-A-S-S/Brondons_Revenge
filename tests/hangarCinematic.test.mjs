import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, THREE, GLTFLoader, createHangar, loadCharacter;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{ name: 'hangar-test-dependencies',
      resolveId: id => id === 'virtual:hangar-dependencies' ? '\0hangar-dependencies' : null,
      load: id => id === '\0hangar-dependencies' ? `export * as THREE from 'three'; export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';` : null,
    }],
  });
  ({ THREE, GLTFLoader } = await server.ssrLoadModule('virtual:hangar-dependencies'));
  ({ createScene: createHangar } = await server.ssrLoadModule('/scenes/scene14.ts'));
  ({ loadCharacter } = await server.ssrLoadModule('/scripts/characterManager.ts'));
});
after(async () => server?.close());

function browser(t) {
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, ProgressEvent: globalThis.ProgressEvent, self: globalThis.self };
  class Element extends EventTarget {
    style = {}; dataset = {}; textContent = ''; classes = new Set(['hidden']);
    classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), contains: n => this.classes.has(n), toggle: (n, force) => force ? this.classes.add(n) : this.classes.delete(n) };
    closest() { return null; }
    requestPointerLock() {}
    setAttribute(name, value) { this[name] = String(value); }
    removeAttribute(name) { if (name === 'style') this.style = {}; else delete this[name]; }
  }
  const elements = new Map();
  globalThis.HTMLElement = Element; globalThis.ProgressEvent = class extends Event {}; globalThis.self = globalThis;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { pointerLockElement: null, body: new Element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
  });
  t.mock.method(console, 'log', () => {});
  const cleanups = []; t.cleanup = callback => cleanups.push(callback);
  t.after(() => { cleanups.reverse().forEach(fn => fn()); Object.assign(globalThis, old); });
  return elements;
}
async function subjectModel() {
  const buffer = await readFile(new URL('../src/assets/models/Subject.glb', import.meta.url));
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
}
async function toolModel(name) {
  const base = new URL('../src/assets/models/Tools/', import.meta.url);
  const json = JSON.parse(await readFile(new URL(`${name}.gltf`, base), 'utf8'));
  for (const buffer of json.buffers) {
    const bytes = await readFile(new URL(buffer.uri, base));
    buffer.uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
  }
  delete json.materials; delete json.textures; delete json.images;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}
function key(code, type = 'keydown', repeat = false) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  window.dispatchEvent(event);
}

test('production rig contains authored cinematic clips', async t => {
  browser(t);
  const gltf = await subjectModel();
  const mixer = new THREE.AnimationMixer(gltf.scene);
  for (const name of ['Idle_Loop', 'Sprint_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Sword_Idle', 'Sword_Attack', 'Roll', 'Hit_Chest', 'Death01', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Sitting_Enter']) {
    const clip = gltf.animations.find(c => c.name === name);
    assert.ok(clip, `Missing authored clip: ${name}`);
    const root = clip.tracks.find(track => track.name === 'root.position');
    if (root) {
      let delta = 0;
      for (let i = 3; i < root.values.length; i++) delta = Math.max(delta, Math.abs(root.values[i] - root.values[i % 3]));
      assert.ok(delta < 1e-5, `${name} must remain in place; the scene owns travel`);
    }
    if (['Roll', 'Death01', 'Sitting_Enter', 'Jump_Loop'].includes(name)) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play(); action.clampWhenFinished = true;
      mixer.update(clip.duration); gltf.scene.updateMatrixWorld(true);
      const pelvis = gltf.scene.getObjectByName('pelvis').getWorldPosition(new THREE.Vector3());
      if (name === 'Death01') assert.ok(pelvis.y < 0.15, 'Authored death ends on the floor');
      if (name === 'Sitting_Enter') assert.ok(pelvis.y > 0.4 && pelvis.y < 0.7, 'Sitting lowers the hips to seat height');
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
});

const idleState = { yaw: Math.PI, pitch: 0, isMoving: false, isOnGround: true, jumping: false, velocityY: 0,
  actionRequest: null, crouching: false, sprinting: false, climbing: false, climbDirection: 1,
  floating: false, floatTime: 0, ventMode: false, boxHandling: false, boxMotion: 0 };

test('cinematic sampling deforms the actual rig, freezes, repeats, and returns to gameplay', async t => {
  browser(t);
  const character = await loadCharacter({ loadAsync: subjectModel }); assert.ok(character);
  t.cleanup(() => character.dispose()); character.setFacing(Math.PI);
  const pos = { x: 0, y: 0.3, z: 0 }, rig = [];
  character.model.traverse(n => { if (n.isBone) rig.push(n); });
  const snapshot = () => rig.flatMap(n => [...n.position.toArray(), ...n.quaternion.toArray()]);
  const apply = (pose, dt = 0.1) => character.update(dt, pos, idleState, true, 0.3, pose);
  const dominant = () => character.mixer._actions.filter(a => a.isScheduled() && a.getEffectiveWeight() > 0.99);
  for (const clip of ['Pistol_Shoot', 'Sword_Attack', 'Roll', 'Death01', 'Sitting_Enter']) {
    apply({ clip, time: 0 }); apply({ clip, time: 0 });
    const start = snapshot();
    apply({ clip, time: 0.5, duration: 1 });
    assert.ok(snapshot().some((v, i) => Math.abs(v - start[i]) > 0.01), `${clip} must move bones`);
    assert.equal(dominant().at(-1).getClip().name, clip);
    const still = snapshot(); const mixerTime = character.mixer.time;
    for (let i = 0; i < 5; i++) apply({ clip, time: 0.5, duration: 1 }, 0);
    assert.deepEqual(snapshot(), still); assert.equal(character.mixer.time, mixerTime);
    apply({ clip, time: 5, duration: 1 });
    assert.ok(dominant().length, `${clip} holds its last pose`);
    assert.equal(character.model.rotation.z, 0, 'No fake whole-model roll/death rotation');
    apply({ clip: 'Idle_Loop', time: 0.4, loop: true });
    apply({ clip, time: 0 }); apply({ clip, time: 0 });
    assert.ok(snapshot().every((v, i) => Math.abs(v - start[i]) < 1e-5), `${clip} restarts without stale pose`);
  }
  character.update(0.1, pos, { ...idleState, isMoving: true }, true, 0.3);
  character.update(0.2, pos, { ...idleState, isMoving: true }, true, 0.3);
  assert.equal(dominant().at(-1).getClip().name, 'Walk_Loop');
  character.update(0.1, pos, { ...idleState, actionRequest: 'Sword_Attack' }, true, 0.3);
  character.update(0.1, pos, idleState, true, 0.3);
  const attack = dominant().at(-1);
  assert.equal(attack.getClip().name, 'Sword_Attack');
  assert.equal(attack.getEffectiveTimeScale(), 2.8, 'Cinematic sampling preserves gameplay attack settings');
});

async function hangar(t, fps = 60, withCharacter = false) {
  const elements = browser(t); let failures = 0; const launches = [];
  const room = createHangar({ loadModel: toolModel, onFailure: () => failures++, onLaunch: state => launches.push(state) });
  t.cleanup(() => room.dispose()); await Promise.all([room.ready, room.gunReady]);
  assert.equal(room.robots.length, 48);
  const character = withCharacter ? await loadCharacter({ loadAsync: subjectModel }) : null;
  if (character) { room.scene.add(character.model); character.setFacing(Math.PI); t.cleanup(() => character.dispose()); }
  function frame() {
    room.updatePhysics(1 / fps, true);
    if (['orbit', 'prompt', 'action', 'escape', 'boarding'].includes(room.getEscapeStatus().phase)) {
      assert.ok(room.robots.every(robot => robot.root.position.x * robot.side >= 1.85),
        'All robots, including stunned targets, stay outside the straight running lane');
    }
    if (character) {
      const state = room.getCinematicState();
      character.weapon.setEquipped(false); character.setCrowbarEquipped(room.getCinematicWeapon() === 'crowbar');
      if (room.hideCharacter()) character.model.visible = false;
      else character.update(state ? room.getCinematicDelta() : 1 / fps, room.player.body.position, state ?? room.player.getState(), true, room.player.radius, room.getCinematicPose());
      room.updateCinematicCharacter(character);
    }
    const before = [...room.camera.position.toArray(), ...room.camera.quaternion.toArray(), room.camera.fov];
    room.applyCinematicCamera(); room.applyCinematicCamera();
    assert.deepEqual([...room.camera.position.toArray(), ...room.camera.quaternion.toArray(), room.camera.fov], before, 'Repeated presentation must not advance camera tracking');
    assert.ok(before.every(Number.isFinite));
    room.camera.updateMatrixWorld(true);
  }
  function seconds(time) { for (let i = 0; i < Math.ceil(time * fps); i++) frame(); }
  function until(predicate, maximum = 5) {
    for (let i = 0; i < maximum * fps && !predicate(); i++) frame();
    assert.ok(predicate(), `Bounded wait expired in ${room.getEscapeStatus().phase}`);
  }
  function enterPrompt() {
    until(() => room.getEscapeStatus().phase === 'run');
    assert.equal(room.camera.fov, 70); assert.equal(room.getCinematicPose(), null);
    room.player.setPosition(0, 0.3, -21.9); frame();
    assert.equal(room.getEscapeStatus().phase, 'orbit');
    assert.equal(room.getCinematicPose().clip, 'Sprint_Loop');
    until(() => room.getEscapeStatus().phase === 'prompt');
    assert.ok(room.player.body.position.z > -19, 'The camera orbit preserves forward running');
  }
  return { room, character, elements, frame, seconds, until, enterPrompt, launches, failures: () => failures };
}

for (const fps of [30, 60, 144]) test(`six continuous running actions, boarding, and launch at ${fps} FPS`, { timeout: 30000 }, async t => {
  const h = await hangar(t, fps, fps === 60), { room, character } = h;
  h.enterPrompt(); const seen = new Set();
  for (let stage = 0; stage < 6; stage++) {
    const expected = room.getEscapeStatus().expected; seen.add(expected);
    assert.equal(room.getEscapeStatus().timeLeft, 2.2);
    const before = room.camera.position.clone(), start = new THREE.Vector3().copy(room.player.body.position);
    const stunned = room.robots.filter(r => r.stunned).length;
    key(expected); key(expected, 'keyup');
    assert.equal(room.getEscapeStatus().phase, 'action');
    assert.equal(room.getEscapeStatus().shot, 'one-take');
    assert.ok(room.camera.position.equals(before), 'Accepting input does not cut or advance the camera');
    h.seconds(0.7);
    const pose = room.getCinematicPose();
    assert.ok(room.player.body.position.z > start.z + 0.5, 'Every attack and roll keeps moving forward');
    assert.ok(Math.abs(room.player.body.position.x) < 1e-6, 'Actions stay in the straight escape lane');
    if (expected !== 'KeyZ') {
      assert.equal(pose.clip, 'Sprint_Loop');
      assert.equal(pose.upperBody.clip, expected === 'KeyX' ? 'Pistol_Shoot' : 'Sword_Attack');
      assert.equal(room.robots.filter(r => r.stunned).length, stunned + 1);
    } else {
      assert.equal(pose.clip, 'Roll');
      assert.equal(room.robots.filter(r => r.stunned).length, stunned, 'Dodge does not kill its target');
    }
    const projected = new THREE.Vector3(room.player.body.position.x, room.player.body.position.y + 0.65, room.player.body.position.z).project(room.camera);
    assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95, 'Actor remains framed by action camera');
    if (character) assert.equal(character.model.rotation.z, 0);
    h.until(() => room.getCinematicPose().clip === 'Sprint_Loop' && !room.getCinematicPose().upperBody);
    assert.equal(room.getEscapeStatus().shot, 'one-take');
    h.until(() => room.getEscapeStatus().phase !== 'action');
    assert.equal(room.getEscapeStatus().phase, 'escape');
    assert.equal(room.getEscapeStatus().stage, stage + 1);
    h.until(() => room.getEscapeStatus().phase === (stage === 5 ? 'boarding' : 'prompt'));
  }
  assert.deepEqual([...seen].sort(), ['KeyX', 'KeyY', 'KeyZ']);
  assert.equal(room.getEscapeStatus().phase, 'boarding');
  const clips = new Set(), shots = new Set(); let peak = 0;
  for (let i = 0; i < 6 * fps && room.getEscapeStatus().phase === 'boarding'; i++) {
    clips.add(room.getCinematicPose().clip); shots.add(room.getEscapeStatus().shot);
    peak = Math.max(peak, room.player.body.position.y); h.frame();
  }
  for (const clip of ['Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Sitting_Enter']) assert.ok(clips.has(clip), clip);
  for (const shot of ['boarding-approach', 'boarding-jump', 'boarding-seat']) assert.ok(shots.has(shot), shot);
  assert.ok(peak > 2); assert.equal(room.getEscapeStatus().phase, 'aboard'); assert.ok(room.hideCharacter());
  assert.equal(room.getEscapeStatus().shot, 'cockpit');
  assert.equal(room.getEscapeStatus().timeLeft, 3);
  assert.equal(h.elements.get('escape-key').textContent, 'E');
  assert.equal(h.elements.get('escape-qte').classList.contains('hidden'), false);
  assert.match(h.elements.get('escape-qte')['aria-label'], /Press E within three seconds/);
  const beforeLaunch = room.robots.map(r => r.root.position.z);
  key('KeyE'); key('KeyE', 'keyup'); assert.equal(room.getEscapeStatus().phase, 'launch');
  h.frame(); assert.equal(room.getEscapeStatus().shot, 'launch-console');
  h.seconds(1); assert.equal(room.getEscapeStatus().shot, 'decompression-wide');
  h.seconds(3.4); assert.equal(room.getEscapeStatus().shot, 'launch-side');
  h.seconds(2.2); assert.equal(room.getEscapeStatus().shot, 'launch-chase');
  h.seconds(3);
  assert.equal(h.launches.length, 1); assert.equal(h.failures(), 0);
  assert.equal(h.launches[0].health, 100);
  assert.ok(room.robots.every((r, i) => r.root.position.z > beforeLaunch[i] + 40 && !r.body.collisionResponse));
  h.seconds(0.2); assert.equal(h.launches.length, 1);
});

test('paused QTE/animation/camera stay fixed; wrong keys show authored death then checkpoint once', { timeout: 30000 }, async t => {
  const h = await hangar(t, 60, true), { room, character } = h;
  h.enterPrompt(); const expected = room.getEscapeStatus().expected;
  key(expected, 'keydown', true); assert.equal(room.getEscapeStatus().phase, 'prompt', 'Repeats cannot satisfy a prompt');
  window.dispatchEvent(new Event('blur'));
  const paused = room.getEscapeStatus(), camera = room.camera.position.clone(), mixerTime = character.mixer.time;
  h.seconds(3); key(expected);
  assert.deepEqual(room.getEscapeStatus(), paused); assert.ok(camera.equals(room.camera.position)); assert.equal(character.mixer.time, mixerTime);
  window.dispatchEvent(new Event('focus'));
  const wrong = expected === 'KeyX' ? 'KeyY' : 'KeyX'; key(wrong); key(wrong, 'keyup');
  assert.equal(room.getCinematicPose().clip, 'Hit_Chest'); assert.equal(room.player.getHealth(), 0);
  h.seconds(0.5); assert.equal(room.getCinematicPose().clip, 'Death01'); assert.equal(room.getEscapeStatus().shot, 'failure');
  h.seconds(2.3); assert.equal(h.failures(), 0, 'Death finishes before checkpoint transfer');
  h.seconds(0.6); assert.equal(h.failures(), 1); assert.equal(h.launches.length, 0);
  h.seconds(1); assert.equal(h.failures(), 1);
});

test('missed cockpit launch window destroys the occupied shuttle and returns once', async t => {
  const h = await hangar(t), { room } = h;
  h.enterPrompt();
  for (let stage = 0; stage < 6; stage++) {
    const expected = room.getEscapeStatus().expected;
    key(expected); key(expected, 'keyup');
    h.until(() => room.getEscapeStatus().phase === (stage === 5 ? 'boarding' : 'prompt'));
  }
  h.until(() => room.getEscapeStatus().phase === 'aboard');
  h.seconds(2.9); assert.equal(room.getEscapeStatus().phase, 'aboard');
  h.seconds(0.2); assert.equal(room.getEscapeStatus().phase, 'failed');
  assert.equal(room.player.getHealth(), 0); assert.ok(room.hideCharacter());
  assert.match(h.elements.get('boss-subtitles').textContent, /SHUTTLE DESTROYED WITH PILOT ABOARD/);
  h.seconds(0.6); assert.equal(room.ship.root.visible, false);
  key('KeyE'); key('KeyE', 'keyup'); h.seconds(3);
  assert.equal(h.failures(), 1); assert.equal(h.launches.length, 0);
  h.seconds(1); assert.equal(h.failures(), 1);
});

test('timeout and disposed input handlers do not launch or transfer twice', async t => {
  const h = await hangar(t); h.enterPrompt(); h.seconds(2.25);
  assert.equal(h.room.getEscapeStatus().phase, 'failed'); h.seconds(3.3); assert.equal(h.failures(), 1);
  h.room.dispose(); key('KeyE'); key('KeyX'); h.seconds(1);
  assert.equal(h.failures(), 1); assert.equal(h.launches.length, 0);
});
