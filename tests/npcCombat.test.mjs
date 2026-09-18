import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let server, THREE, GLTFLoader, OBJLoader, NPCEnemyManager, PistolController, traceShot, createScenePhysics, loadCharacter;
const factories = {};
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'combat-test-dependencies',
      resolveId: id => id === 'virtual:combat-dependencies' ? '\0combat-dependencies' : null,
      load: id => id === '\0combat-dependencies' ? `
        export * as THREE from 'three';
        export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        export { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
      ` : null,
    }],
  });
  // Use the runner's module instance (Windows drive-letter casing can otherwise duplicate Three.js).
  ({ THREE, GLTFLoader, OBJLoader } = await server.ssrLoadModule('virtual:combat-dependencies'));
  ({ NPCEnemyManager } = await server.ssrLoadModule('/scripts/npc-enemy-robots.ts'));
  ({ PistolController, traceShot } = await server.ssrLoadModule('/scripts/pistol.ts'));
  ({ createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  ({ loadCharacter } = await server.ssrLoadModule('/scripts/characterManager.ts'));
  for (const id of ['scene2', 'scene3', 'scene4']) {
    factories[id] = (await server.ssrLoadModule(`/scenes/${id}.ts`)).createScene;
  }
});
after(async () => { await server?.close(); });

function browser(t) {
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement,
    ProgressEvent: globalThis.ProgressEvent };
  class Element extends EventTarget {
    style = {};
    dataset = {};
    textContent = '';
    closest() { return null; }
    requestPointerLock() {}
    appendChild() {}
    remove() {}
  }
  globalThis.HTMLElement = Element;
  globalThis.ProgressEvent = class extends Event {};
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  const elements = { crosshair: new Element(), 'weapon-status': new Element() };
  const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = Object.assign(new EventTarget(), {
    pointerLockElement: null, body: new Element(),
    createElement: () => Object.assign(new Element(), { getContext: () => context }),
    getElementById: id => elements[id] ?? null,
  });
  // Decorative textures/computers do not participate in scene collision tests.
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  t.mock.method(OBJLoader.prototype, 'load', () => {});
  const cleanups = [];
  t.cleanup = fn => cleanups.push(fn);
  t.after(() => {
    for (const dispose of cleanups.reverse()) dispose();
    Object.assign(globalThis, old);
  });
  return elements;
}

function key(code, type = 'keydown', extra = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ code, repeat: false, ...extra })
    .map(([name, value]) => [name, { value }])));
  window.dispatchEvent(event);
}
function click(extra = {}) {
  const event = new Event('mousedown');
  Object.defineProperties(event, Object.fromEntries(Object.entries({ button: 0, ...extra })
    .map(([name, value]) => [name, { value }])));
  document.dispatchEvent(event);
}

async function toolModel(name) {
  const base = new URL('../src/assets/models/Tools/', import.meta.url);
  const json = JSON.parse(await readFile(new URL(`${name}.gltf`, base), 'utf8'));
  for (const buffer of json.buffers) {
    const bytes = await readFile(new URL(buffer.uri, base));
    buffer.uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
  }
  // Preserve real geometry, skeleton, and animation tracks without a browser image decoder.
  delete json.materials;
  delete json.textures;
  delete json.images;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

async function subjectModel() {
  const buffer = await readFile(new URL('../src/assets/models/Subject.glb', import.meta.url));
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
}

test('production Subject rig supplies the pistol clips and grip bones', async t => {
  browser(t);
  const gltf = await subjectModel();
  for (const name of ['Pistol_Aim_Neutral', 'Pistol_Idle_Loop', 'Pistol_Shoot']) {
    assert.ok(gltf.animations.some(clip => clip.name === name));
  }
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const shoot = gltf.animations.find(clip => clip.name === 'Pistol_Shoot');
  assert.ok(shoot);
  mixer.clipAction(shoot).play();
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  for (const name of ['hand_r', 'index_01_r', 'middle_01_r', 'thumb_01_r']) {
    const bone = gltf.scene.getObjectByName(name);
    assert.ok(bone?.isBone, `${name} is present in the production rig`);
  }
  mixer.stopAllAction();
});

async function characterFixture(t) {
  const gltf = await subjectModel();
  t.mock.method(console, 'log', () => {});
  const character = await loadCharacter({ loadAsync: async () => gltf });
  assert.ok(character);
  t.cleanup(() => character.dispose());
  return character;
}

test('armed upper body holds and shoots while the real Subject legs keep walking', async t => {
  browser(t);
  const armed = await characterFixture(t);
  const unarmed = await characterFixture(t);
  const state = { yaw: 0, isOnGround: true, isMoving: true, jumping: false, velocityY: 0,
    actionRequest: null, crouching: false, sprinting: false };
  armed.weapon.setEquipped(true);
  const update = (dt = 1 / 60) => {
    for (const character of [armed, unarmed]) character.update(dt, { x: 0, y: 0.3, z: 0 }, state, true, 0.3);
  };
  for (let i = 0; i < 30; i++) update();
  const leg = armed.model.getObjectByName('thigh_l');
  const otherLeg = unarmed.model.getObjectByName('thigh_l');
  const arm = armed.model.getObjectByName('upperarm_r');
  assert.ok(leg.quaternion.angleTo(otherLeg.quaternion) < 1e-5, 'Arming must not alter the walking legs');
  assert.ok(arm.quaternion.angleTo(unarmed.model.getObjectByName('upperarm_r').quaternion) > 0.1);
  const beforeLeg = leg.quaternion.clone();
  const beforeArm = arm.quaternion.clone();
  armed.weapon.shoot();
  let recoilMotion = 0;
  for (let i = 0; i < 12; i++) {
    update();
    recoilMotion = Math.max(recoilMotion, beforeArm.angleTo(arm.quaternion));
    assert.ok(leg.quaternion.angleTo(otherLeg.quaternion) < 1e-5, 'Shooting must preserve full walking motion');
  }
  assert.ok(beforeLeg.angleTo(leg.quaternion) > 0.01, 'Legs continue animating during firing');
  assert.ok(recoilMotion > 0.01, 'The GLB shooting clip moves the upper body');
  for (let i = 0; i < 120; i++) update();
  assert.ok(arm.quaternion.angleTo(beforeArm) < 0.2, 'Shot returns to the equipped holding pose');
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(armed.weapon.socket.getWorldQuaternion(new THREE.Quaternion()));
  t.diagnostic(`Equipped barrel direction: ${direction.toArray()}`);
  assert.ok(direction.z < -0.9, 'Calibrated hand grip points the barrel forward');
  armed.weapon.setEquipped(false);
  update();
  for (const name of ['spine_01', 'upperarm_r', 'hand_r', 'thigh_l']) {
    assert.ok(armed.model.getObjectByName(name).quaternion.angleTo(unarmed.model.getObjectByName(name).quaternion) < 1e-5,
      `Holstering restores normal ${name} animation`);
  }
});

test('pistol is fixed to the animated grip, survives view switches, and firing calls the GLB layer', async t => {
  browser(t);
  const character = await characterFixture(t);
  const scene = new THREE.Scene(); scene.add(character.model);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 1.5);
  let thirdPerson = true;
  const pistol = new PistolController(() => ({ scene, camera, world: null, player: { isEnabled: () => true },
    character: character.model, targets: [], thirdPerson, weaponAnimation: character.weapon }), () => toolModel('Gun_Pistol'));
  t.cleanup(() => pistol.dispose());
  const shot = t.mock.method(character.weapon, 'shoot');
  await pistol.ready;
  document.pointerLockElement = document.body;
  key('KeyK');
  character.update(1 / 60, { x: 0, y: 0.3, z: 0 }, { yaw: 0, isOnGround: true, isMoving: false }, true, 0.3);
  pistol.update(0);
  assert.equal(pistol.root.parent, character.weapon.socket);
  assert.ok(pistol.root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  const local = pistol.root.position.clone();
  click(); click();
  assert.equal(shot.mock.callCount(), 1, 'One animation per accepted shot, including misses');
  character.update(0.1, { x: 0, y: 0.3, z: 0 }, { yaw: 0.5, isOnGround: true, isMoving: true }, true, 0.3);
  pistol.update(0.1);
  assert.deepEqual(pistol.root.position, local, 'Recoil comes from the hand animation, not independent gun rotation');
  thirdPerson = false; pistol.update(0);
  assert.equal(pistol.root.parent, scene);
  thirdPerson = true; pistol.update(0);
  assert.equal(pistol.root.parent, character.weapon.socket);
  key('KeyK'); pistol.update(0);
  assert.equal(pistol.root.parent, null);
});

function scene(t, id, options = {}) {
  const data = factories[id]({ skipWake: true, ...options });
  data.id = id;
  data.disposals = 0;
  const dispose = data.dispose;
  data.dispose = () => { data.disposals++; dispose(); };
  t.cleanup(() => dispose());
  return data;
}
async function manager(t, load = () => toolModel('Enemy_Trilobite')) {
  const npc = new NPCEnemyManager(load, () => 0);
  t.cleanup(() => npc.dispose());
  await npc.ready;
  return npc;
}
function tick(npc, data, count = 1, fps = 60, check) {
  for (let i = 0; i < count; i++) {
    npc.update(1 / fps);
    data.updatePhysics(1 / fps);
    check?.();
  }
}
function walk(npc, data, x, z, fps = 60) {
  key('KeyW');
  let reached = false;
  for (let i = 0; i < fps * 15; i++) {
    const p = data.player.body.position;
    if (Math.hypot(x - p.x, z - p.z) < 0.12) { reached = true; break; }
    data.player.setRotation(Math.atan2(p.x - x, p.z - z));
    tick(npc, data, 1, fps);
  }
  key('KeyW', 'keyup');
  assert.ok(reached, `Player blocked going to ${x},${z}: ${data.player.body.position.toString()}`);
}
function enemyBody(data) { return data.physicsWorld.bodies.find(body => body.mass === 10); }

test('Trilobite loads late only in scene4, paces with real Walk, and never spawns in scene2/3', async t => {
  browser(t);
  let resolve;
  const npc = new NPCEnemyManager(() => new Promise(done => { resolve = done; }));
  t.cleanup(() => npc.dispose());
  const s2 = scene(t, 'scene2');
  npc.enterScene('scene2', s2);
  const s3 = scene(t, 'scene3');
  npc.enterScene('scene3', s3);
  assert.equal(enemyBody(s3), undefined);
  const s4 = scene(t, 'scene4');
  npc.enterScene('scene4', s4);
  resolve(await toolModel('Enemy_Trilobite'));
  await npc.ready;
  assert.equal(npc.getStatus().state, 'PACING');
  const model = s4.scene.getObjectByName('Trilobite');
  const mesh = model.getObjectsByProperty('isSkinnedMesh', true)[0];
  assert.ok(mesh, 'Use the actual rigged Trilobite');
  const bone = mesh.skeleton.bones.map(node => node.quaternion.clone());
  tick(npc, s4, 30);
  assert.equal(npc.getStatus().animation, 'Walk');
  assert.ok(mesh.skeleton.bones.some((node, i) => node.quaternion.angleTo(bone[i]) > 0.01));
  assert.ok(npc.getStatus().position.x > 0.3);
  tick(npc, s4, 300);
  assert.equal(npc.getStatus().state, 'PACING');
  assert.ok(Math.abs(npc.getStatus().position.x) <= 2.1);
  assert.ok(Math.abs(npc.getStatus().position.y - 0.3) < 0.02);
  assert.equal(s2.disposals, 1);
  assert.equal(s3.disposals, 1);
  npc.enterScene('scene3', scene(t, 'scene3'));
  assert.equal(npc.getStatus().state, 'WAITING');
  assert.equal(npc.getStatus().scene, null);
});

test('trigger aggro, randomized attacks, hit recovery, and death advance without freezing', async t => {
  browser(t);
  const npc = await manager(t);
  const s4 = scene(t, 'scene4');
  npc.enterScene('scene4', s4);
  s4.player.setPosition(0, 0.3, -1.5);
  tick(npc, s4);
  assert.equal(npc.getStatus().state, 'CHASING');
  assert.equal(npc.getStatus().animation, 'Run');
  const animations = new Set();
  tick(npc, s4, 240, 60, () => animations.add(npc.getStatus().animation));
  assert.ok(animations.has('Attack'));
  assert.equal(npc.getStatus().animation, 'Run');
  assert.equal(npc.takeDamage(25), true);
  assert.equal(npc.getStatus().animation, 'Hit');
  let recovered = false;
  tick(npc, s4, 60, 60, () => { recovered ||= npc.getStatus().animation === 'Run'; });
  assert.ok(recovered, 'Hit returns to Run before the next random attack');
  assert.equal(npc.takeDamage(NaN), false);
  assert.equal(npc.getStatus().health, 75);
  assert.equal(npc.takeDamage(75), true);
  assert.equal(npc.getStatus().state, 'DYING');
  assert.equal(npc.getStatus().animation, 'TurnOff');
  tick(npc, s4, 300);
  assert.equal(npc.getStatus().state, 'DISAPPEARED');
  assert.equal(enemyBody(s4), undefined);
  assert.equal(npc.getDamageTargets().length, 0);
  npc.enterScene('scene3', scene(t, 'scene3'));
  const returnVisit = scene(t, 'scene4');
  npc.enterScene('scene4', returnVisit);
  assert.equal(npc.getStatus().health, 100);
  assert.equal(npc.getStatus().state, 'PACING');
});

for (const fps of [30, 60, 144]) for (const stairX of [-3, 3]) {
  test(`same Trilobite follows real doors, stairs x=${stairX}, and upstairs board at ${fps} FPS`, async t => {
    browser(t);
    const npc = await manager(t);
    const s4 = scene(t, 'scene4');
    npc.enterScene('scene4', s4);
    const body = enemyBody(s4);
    const model = s4.scene.getObjectByName('Trilobite');
    walk(npc, s4, 0, -1.5, fps);
    assert.equal(npc.getStatus().state, 'CHASING');
    npc.takeDamage(25);
    let s3;
    s4.setBackTrigger(state => {
      s3 = scene(t, 'scene3', { entryState: state, entryDoor: 'back' });
      npc.enterScene('scene3', s3);
    });
    s4.player.setRotation(0);
    key('ShiftLeft'); key('KeyW');
    for (let i = 0; i < fps * 3 && !s3; i++) tick(npc, s4, 1, fps);
    assert.ok(s3, 'Player must cross the actual scene4 exit');
    assert.equal(npc.getStatus().scene, 'scene4', 'NPC must finish its own route');
    assert.equal(s4.player.isEnabled(), false, 'Old input owner removed immediately');
    key('ShiftLeft', 'keyup'); key('KeyW', 'keyup');
    tick(npc, s3, fps * 3, fps);
    assert.equal(npc.getStatus().scene, 'scene3');
    assert.equal(enemyBody(s3), body);
    assert.equal(s3.scene.getObjectByName('Trilobite'), model);
    assert.equal(s4.disposals, 1);
    let s2;
    s3.setBackTrigger(state => {
      s2 = scene(t, 'scene2', { entryState: state });
      npc.enterScene('scene2', s2);
    });
    s3.player.setRotation(Math.PI);
    key('KeyW');
    for (let i = 0; i < fps * 7 && !s2; i++) tick(npc, s3, 1, fps);
    assert.ok(s2, 'Player must cross the actual scene3 exit');
    key('KeyW', 'keyup');
    assert.equal(s2.npcSafeZone.containsPoint(new THREE.Vector3(0, 0, -13.5)), false);
    walk(npc, s2, 0, 1.5, fps);
    walk(npc, s2, stairX, 1.5, fps);
    walk(npc, s2, stairX, 10.5, fps);
    assert.ok(s2.player.body.position.y > 5.1, 'Player uses real ramp support');
    tick(npc, s2, fps * 6, fps);
    assert.equal(npc.getStatus().scene, 'scene2');
    assert.equal(enemyBody(s2), body);
    assert.equal(npc.getStatus().health, 75);
    assert.ok(Math.abs(npc.getStatus().position.y - 5.2) < 0.03,
      `NPC must climb the ramp: ${npc.getStatus().position.toString()}`);
    assert.equal(s3.disposals, 1);
    walk(npc, s2, Math.sign(stairX) * 6, 10.5, fps);
    walk(npc, s2, Math.sign(stairX) * 6, -12, fps);
    walk(npc, s2, 0, -12, fps);
    assert.equal(npc.getStatus().state, 'CHASING');
    walk(npc, s2, 0, -13.5, fps);
    assert.ok(['DYING', 'DISAPPEARED'].includes(npc.getStatus().state));
    tick(npc, s2, fps * 3, fps);
    assert.equal(npc.getStatus().state, 'DISAPPEARED');
    assert.equal(enemyBody(s2), undefined);
  });
}

test('queued room visits retain one pursuer and release all old worlds after escape', async t => {
  browser(t);
  const npc = await manager(t);
  const s4 = scene(t, 'scene4');
  npc.enterScene('scene4', s4);
  s4.player.setPosition(0, 0.3, -1.5);
  tick(npc, s4);
  s4.player.setPosition(0, 0.3, -6.9);
  const s3 = scene(t, 'scene3');
  s3.player.setPosition(0, 0.3, -9);
  npc.enterScene('scene3', s3);
  s3.player.setPosition(0, 0.3, 10.9);
  const s2 = scene(t, 'scene2');
  s2.player.setPosition(0, 0.3, 14);
  npc.enterScene('scene2', s2);
  assert.equal(npc.getStatus().scene, 'scene4');
  tick(npc, s2, 600);
  assert.equal(npc.getStatus().scene, 'scene2');
  assert.equal(s4.disposals, 1);
  assert.equal(s3.disposals, 1);
  assert.equal(s2.physicsWorld.bodies.filter(body => body.mass === 10).length, 1);
  s2.player.setPosition(0, 5.2, -14);
  tick(npc, s2, 180);
  assert.equal(npc.getStatus().state, 'DISAPPEARED');
});

function shootingScene() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  camera.position.set(0, 1, 0);
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  root.add(mesh); root.position.set(0, 1, -5); scene.add(root);
  let health = 100;
  const targets = [{ root, damage(amount) { health -= amount; return true; } }];
  return { scene, camera, root, targets, health: () => health };
}

test('hitscan respects visible cover and static physics but never mutates environment', t => {
  browser(t);
  const fixture = shootingScene();
  const physics = createScenePhysics();
  t.cleanup(() => physics.dispose());
  const ray = new THREE.Ray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  assert.equal(traceShot(fixture.scene, physics.world, ray, fixture.targets).target, fixture.targets[0]);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1, -2);
  fixture.scene.add(wall);
  wall.updateMatrixWorld(true);
  const snapshot = wall.toJSON();
  assert.equal(traceShot(fixture.scene, physics.world, ray, fixture.targets).target, undefined);
  assert.deepEqual(wall.toJSON(), snapshot);
  wall.visible = false;
  assert.ok(traceShot(fixture.scene, physics.world, ray, fixture.targets).target);
  physics.addBox({ x: 2, y: 2, z: 0.2 }, wall.position);
  assert.equal(traceShot(fixture.scene, physics.world, ray, fixture.targets).target, undefined);
  assert.equal(fixture.health(), 100, 'Ray queries do not apply damage themselves');
});

test('real pistol toggles on K, fires NPC-only damage, obeys input gates, and persists across scenes', async t => {
  const elements = browser(t);
  const fixture = shootingScene();
  let enabled = true;
  let context = { ...fixture, world: null, player: { isEnabled: () => enabled }, character: null, thirdPerson: false };
  const pistol = new PistolController(() => context, () => toolModel('Gun_Pistol'));
  t.cleanup(() => pistol.dispose());
  await pistol.ready;
  document.pointerLockElement = document.body;
  click(); assert.equal(fixture.health(), 100);
  key('KeyK'); key('KeyK', 'keydown', { repeat: true });
  pistol.update(0);
  assert.equal(pistol.root.visible, true);
  assert.equal(pistol.root.parent, fixture.scene);
  assert.ok(pistol.root.getObjectsByProperty('isMesh', true).length > 1, 'Actual pistol mesh loaded');
  click(); assert.equal(fixture.health(), 75);
  assert.equal(elements.crosshair.dataset.hit, 'true');
  click(); assert.equal(fixture.health(), 75, 'Cooldown');
  pistol.update(0.1); pistol.update(0.1);
  click(); assert.equal(fixture.health(), 50);
  pistol.update(0.1); pistol.update(0.1);
  document.pointerLockElement = null;
  click(); assert.equal(fixture.health(), 50);
  document.pointerLockElement = document.body;
  const button = new HTMLElement(); button.closest = () => button;
  click({ target: button }); assert.equal(fixture.health(), 50);
  enabled = false;
  click(); assert.equal(fixture.health(), 50);
  enabled = true;
  const next = new THREE.Scene();
  context = { ...context, scene: next, targets: [] };
  pistol.update(0);
  assert.equal(pistol.root.parent, next);
  assert.equal(pistol.root.visible, true);
  key('KeyK'); pistol.update(0);
  assert.equal(pistol.root.visible, false);
  click(); assert.equal(fixture.health(), 50);
});
