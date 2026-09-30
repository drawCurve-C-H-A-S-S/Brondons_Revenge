import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server, createScene, createBridge, createReturn, courseX, touch;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene } = await server.ssrLoadModule('/scenes/level 3/scene18.ts'));
  ({ createScene: createBridge } = await server.ssrLoadModule('/scenes/level 3/scene17.ts'));
  ({ createScene: createReturn } = await server.ssrLoadModule('/scenes/level 3/scene19.ts'));
  ({ courseX } = await server.ssrLoadModule('/helpers/scene/junglePlatformCourse.ts'));
  touch = await server.ssrLoadModule('/scripts/touchControls.ts');
});
after(async () => server?.close());

function asset(rigged = false) {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  if (rigged) {
    const count = geometry.attributes.position.count, weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, material), bone = new THREE.Bone();
    mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); scene.add(mesh);
  } else scene.add(new THREE.Mesh(geometry, material));
  return { scene, animations: ['Idle', 'Walk', 'Hit', 'Attack', 'Charge', 'TurnOff'].map(name => new THREE.AnimationClip(name, 1, [])) };
}

function browser(t) {
  const old = Object.fromEntries(['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'KeyboardEvent', 'MouseEvent']
    .map(name => [name, globalThis[name]]));
  const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  class Element extends EventTarget {
    constructor(tag = 'div') {
      super(); this.tag = tag; this.children = []; this.style = { setProperty(name, value) { this[name] = value; } };
      this.dataset = {}; this.attributes = {}; this.textContent = ''; this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: (name, force = !this.classes.has(name)) => { if (force) this.classes.add(name); else this.classes.delete(name); return force; },
      };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/)); }
    get className() { return [...this.classes].join(' '); }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...elements) { for (const el of elements) { el.remove(); this.children.push(el); el.parent = this; } }
    appendChild(el) { this.append(el); return el; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(el => el !== this); this.parent = null; }
    closest(selector) { return selector.split(',').some(s => s.trim() === this.tag) ? this : null; }
    requestPointerLock() {}
    getContext() { return context; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      const result = [];
      for (const el of this.children) {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) result.push(el);
        result.push(...el.querySelectorAll(selector));
      }
      return result;
    }
  }
  class Canvas extends Element { constructor() { super('canvas'); } }
  class InputEvent extends Event {
    constructor(type, options = {}) {
      super(type, { bubbles: true, cancelable: true });
      for (const [key, value] of Object.entries(options)) if (key !== 'bubbles') Object.defineProperty(this, key, { value });
    }
  }
  globalThis.HTMLElement = Element; globalThis.HTMLCanvasElement = Canvas;
  globalThis.KeyboardEvent = globalThis.MouseEvent = InputEvent;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720, ontouchstart: null });
  const body = new Element('body'), elements = new Map();
  for (const id of ['space-cinematic-caption', 'loading-bay-status', 'interact-prompt', 'touch-controls', 'touch-flight-stick', 'touch-flight-knob',
    'touch-jump', 'touch-fire', 'touch-menu', 'touch-sprint', 'touch-interact', 'touch-attack', 'touch-pistol', 'touch-crowbar',
    'touch-goggles', 'touch-action9', 'touch-view', 'touch-crouch', 'touch-evade']) {
    const el = new Element(id.startsWith('touch-') && !id.includes('stick') && !id.includes('knob') && id !== 'touch-controls' ? 'button' : 'div');
    el.id = id; elements.set(id, el);
  }
  const controls = elements.get('touch-controls'); body.append(controls);
  const base = new Element(), knob = new Element(); base.className = 'touch-move-base'; knob.className = 'touch-knob'; base.append(knob); controls.append(base);
  for (const [id, el] of elements) if (id !== 'touch-controls') (id.startsWith('touch-') ? controls : body).append(el);
  const canvas = new Canvas(); body.append(canvas);
  globalThis.document = Object.assign(new EventTarget(), { body, hidden: false, pointerLockElement: null,
    getElementById: id => elements.get(id) ?? null, createElement: tag => tag === 'canvas' ? new Canvas() : new Element(tag) });
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => asset());
  const cleanups = []; t.cleanup = fn => cleanups.push(fn);
  t.after(() => { for (const fn of cleanups.reverse()) fn(); touch.disposeTouchControls(); Object.assign(globalThis, old); });
  return { elements, canvas, body };
}
const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, repeat: false }));
const step = (data, seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) data.updatePhysics(1 / fps); };
function until(data, condition, fps = 60, limit = 5) {
  for (let i = 0; i < fps * limit && !condition(); i++) data.updatePhysics(1 / fps);
  assert.ok(condition(), JSON.stringify(data.getPlatformerStatus()));
}
function target(data, name) {
  const found = data.getDamageTargets().find(item => item.root.name === name);
  assert.ok(found, `Missing target: ${name}`); return found;
}
async function fixture(t, options = {}) {
  const dom = browser(t), respawns = [], finishes = [];
  const data = createScene({ loadModel: async () => asset(), onRespawn: state => respawns.push(state), onFinished: state => finishes.push(state), ...options });
  t.cleanup(() => data.dispose()); await data.ready;
  return { data, respawns, finishes, ...dom };
}
const bossEntry = () => ({ platformProgress: { checkpoint: 'boss', activatedRelays: ['relay1', 'relay2', 'relay3'],
  defeatedRobots: Array.from({ length: 7 }, (_, i) => `patrol${i + 1}`) } });

for (const fps of [30, 60, 144]) {
  test(`Scene 18 entry uses grounded dynamic physics and a simulation-only side camera at ${fps} FPS`, async t => {
    const { data, body } = await fixture(t);
    assert.equal(data.player.isEnabled(), false);
    step(data, 1.3, fps);
    assert.equal(data.getPlatformerStatus().phase, 'traversal');
    assert.equal(data.player.body.type, CANNON.Body.DYNAMIC);
    assert.equal(data.player.getState().isOnGround, true);
    assert.equal(data.getCinematicPose(), null);
    assert.equal(body.querySelector('.jungle-scrambler-pulse').style.opacity, '0');
    const phaseTime = data.getPlatformerStatus().phaseTime, position = data.player.body.position.clone();
    for (let i = 0; i < 25; i++) data.applyCinematicCamera();
    assert.equal(data.getPlatformerStatus().phaseTime, phaseTime);
    assert.equal(data.player.body.position.distanceTo(position), 0);
    const ahead = new THREE.Vector3(position.x - 3, position.y, 17).project(data.camera);
    const behind = new THREE.Vector3(position.x + 3, position.y, 17).project(data.camera);
    assert.ok(ahead.x > behind.x, 'World -X must be screen-right');
    data.camera.aspect = 0.5; data.applyCinematicCamera();
    assert.ok(data.camera.position.z < -10 && data.camera.matrixWorld.elements.every(Number.isFinite));
  });

  test(`Boss shield, two-second window, three orb hits and exactly one dry exit at ${fps} FPS`, async t => {
    const { data, finishes } = await fixture(t, { entryState: bossEntry() }); step(data, 1.3, fps);
    const warden = target(data, 'Platform-warden'), orb = target(data, 'FacilitySidescrollScrambler');
    const waitForOpen = () => {
      for (let i = 0; i < fps * 8 && data.getPlatformerStatus().bossStage !== 'open'; i++) {
        data.player.heal(100); data.updatePhysics(1 / fps);
      }
      assert.equal(data.getPlatformerStatus().bossStage, 'open', 'Warden did not enter its vulnerable window');
    };
    assert.equal(orb.damage(25, 'pistol'), false); assert.equal(warden.damage(25, 'pistol'), false);
    data.player.setPosition(courseX(104), 1.6, 17); step(data, 1.1, fps);
    for (let i = 0; i < 8; i++) {
      assert.equal(orb.damage(25, 'pistol'), true);
      assert.equal(data.getPlatformerStatus().orbHealth, 175 - i * 25);
    }
    until(data, () => data.getPlatformerStatus().phase === 'boss', fps, 7);
    assert.equal(data.getPlatformerStatus().bossShielded, false);
    assert.equal(warden.damage(25, 'pistol'), false, 'Warden is invulnerable while charging');
    waitForOpen();
    assert.equal(warden.damage(35, 'crowbar'), false); assert.equal(warden.damage(NaN, 'pistol'), false);
    assert.equal(warden.damage(25, 'pistol'), true);
    step(data, 1.8, fps); assert.equal(data.getPlatformerStatus().bossStage, 'open');
    step(data, 0.25, fps); assert.equal(warden.damage(25, 'pistol'), false);
    waitForOpen();
    assert.equal(data.getPlatformerStatus().bossVolley, 1, 'Attack alternates from ground pulse to burst');
    while (data.getPlatformerStatus().bossHealth > 0) {
      waitForOpen();
      assert.equal(warden.damage(25, 'pistol'), true);
    }
    assert.equal(data.getPlatformerStatus().phase, 'cleared');
    assert.equal(data.getPlatformerStatus().shots.hostile, 0);
    assert.equal(finishes.length, 0, 'Boss defeat alone cannot finish');
    data.player.setPosition(courseX(104), 1.6, 9); step(data, 1 / fps, fps);
    data.player.heal(100); data.player.takeDamage(33);
    const expectedHealth = data.player.getHealth();
    const camera = data.camera.position.clone(); data.updatePhysics(1 / fps);
    assert.equal(data.getPlatformerStatus().phase, 'exit');
    assert.ok(data.camera.position.distanceTo(camera) < 0.2, 'Exit captures the side camera, not the ordinary physics camera');
    step(data, 5, fps); step(data, 2, fps);
    assert.equal(finishes.length, 1); assert.equal(finishes[0].pilotState.health, expectedHealth);
    assert.deepEqual(finishes[0].pilotState.heldKeys, []); assert.equal(finishes[0].scramblerDestroyed, true);
    assert.ok(Math.abs(finishes[0].pilotState.position.x + 146) < 1e-6);
    assert.ok(Math.abs(finishes[0].pilotState.position.z - 5) < 1e-6);
    assert.ok(finishes[0].cameraPosition.distanceTo(data.camera.position) < 1e-9);
  });
}

test('Checkpoint restart restores saved relays/robots, full health and a fresh unfinished boss', async t => {
  const { data, respawns } = await fixture(t); step(data, 1.3);
  target(data, 'Platform-patrol1').damage(75, 'pistol');
  target(data, 'PlatformRelay-relay1').damage(75, 'pistol'); step(data, 1.2);
  data.player.setPosition(courseX(53), 1.8, 17); data.updatePhysics(1 / 60);
  assert.equal(data.getPlatformerStatus().checkpoint, 'middle');
  target(data, 'Platform-patrol2').damage(75, 'pistol'); target(data, 'PlatformRelay-relay2').damage(75, 'pistol');
  key('KeyD'); key('Space'); data.player.setPosition(courseX(60), -3, 17); data.updatePhysics(1 / 60); step(data, 2);
  key('KeyR'); step(data, 2);
  assert.equal(respawns.length, 1);
  const state = respawns[0];
  assert.equal(state.platformProgress.checkpoint, 'middle'); assert.deepEqual(state.platformProgress.activatedRelays, ['relay1']);
  assert.deepEqual(state.platformProgress.defeatedRobots, ['patrol1']); assert.equal(state.pilotState.health, 100);
  assert.deepEqual(state.pilotState.heldKeys, []); assert.equal(state.cameraPosition, undefined);
  data.dispose();
  const restored = createScene({ entryState: state, loadModel: async () => asset(), onRespawn() {}, onFinished() {} });
  t.cleanup(() => restored.dispose()); await restored.ready; step(restored, 1.3);
  assert.equal(restored.getPlatformerStatus().phase, 'traversal'); assert.equal(restored.player.getHealth(), 100);
  assert.equal(restored.course.relays[0].deployment, 1); assert.equal(restored.course.relays[1].deployment, 0);
  assert.equal(restored.getPlatformerStatus().bossHealth, 600); assert.equal(restored.getPlatformerStatus().orbHealth, 200);
  assert.equal(restored.player.getState().isMoving, false); assert.equal(restored.player.getState().jumping, false);
});

test('A river fall triggers an animated shark attack before the death pose', async t => {
  const { data, respawns } = await fixture(t); step(data, 1.3);
  const shark = data.scene.getObjectByName('RiverShark-0');
  assert.ok(shark, 'River sharks load before Scene 18 gameplay begins');
  assert.notEqual(shark.position.z, 17, 'Sharks wait at the river edge outside the rock path');
  data.player.setPosition(courseX(36), -4, 17); data.updatePhysics(1 / 60);
  assert.equal(data.getPlatformerStatus().phase, 'sharkAttack');
  assert.equal(data.player.getHealth(), 0);
  assert.ok(data.getRetroConsoleStrength() > 0);
  step(data, 0.95); assert.equal(data.getPlatformerStatus().phase, 'death');
  assert.equal(data.getCinematicPose().clip, 'Death01');
  const initialZ = data.camera.position.z;
  step(data, 1.5);
  assert.ok(data.camera.position.z < initialZ - 4, 'death camera pulls farther from the platform');
  assert.equal(respawns.length, 0);
  step(data, 0.8); assert.equal(respawns.length, 0);
  step(data, 0.3); assert.equal(respawns.length, 1);
});

test('Swept held fire hits the nearest robot and cannot shoot through solid cover', async t => {
  const { data } = await fixture(t); step(data, 1.3);
  data.player.setPosition(courseX(10), 1.65, 17);
  const robot = target(data, 'Platform-patrol1');
  const wall = data.physics.addBox({ x: 0.2, y: 4, z: 3 }, { x: courseX(10.8), y: 2, z: 17 });
  document.pointerLockElement = document.body;
  window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); step(data, 0.85);
  assert.ok(!data.getPlatformerStatus().defeatedRobots.includes('patrol1'));
  data.physicsWorld.removeBody(wall);
  step(data, 1.5); window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  assert.ok(data.getPlatformerStatus().defeatedRobots.includes('patrol1'));
  assert.equal(robot.damage(25, 'pistol'), false, 'Dead target cannot absorb further damage');
  assert.ok(!data.getPlatformerStatus().defeatedRobots.includes('patrol2'), 'Higher firing lane is not hit through its platform');
});

test('Pause freezes relays, AI and effects, clears held inputs, and preserves weapon presentation', async t => {
  const { data } = await fixture(t); step(data, 1.3);
  target(data, 'PlatformRelay-relay1').damage(75, 'pistol'); step(data, 0.2);
  const snapshot = data.getPlatformerStatus(), deployment = data.course.relays[0].deployment;
  key('KeyD'); window.dispatchEvent(new Event('blur')); step(data, 3);
  assert.equal(data.getPlatformerStatus().phaseTime, snapshot.phaseTime);
  assert.equal(data.course.relays[0].deployment, deployment);
  assert.equal(data.getCinematicDelta(), 0); assert.equal(data.getCinematicWeapon(), 'pistol');
  window.dispatchEvent(new Event('focus'));
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); step(data, 3);
  assert.equal(data.getPlatformerStatus().phaseTime, snapshot.phaseTime);
  document.hidden = false; document.body.classList.add('quick-menu-open'); step(data, 3);
  assert.equal(data.course.relays[0].deployment, deployment);
  document.body.classList.remove('quick-menu-open'); step(data, 0.2);
  assert.equal(data.player.getState().isMoving, false);
  assert.ok(data.course.relays[0].deployment > deployment);
});

test('Mobile joystick, JUMP and held FIRE work simultaneously without touch-look or ordinary attacks', async t => {
  const { data, elements, canvas } = await fixture(t); step(data, 1.3); touch.initTouchControls();
  const ordinary = t.mock.fn(() => true), unregister = touch.registerTouchAttackCallback(ordinary, () => 'SHOOT');
  t.cleanup(unregister);
  const gesture = (type, id, x) => document.dispatchEvent(new MouseEvent(type, {
    changedTouches: [{ identifier: id, clientX: x, clientY: 300, target: canvas }],
  }));
  const pointer = (id, pointerId, type = 'pointerdown') => elements.get(id).dispatchEvent(new MouseEvent(type, { pointerId, pointerType: 'touch', button: 0 }));
  gesture('touchstart', 1, 80); gesture('touchmove', 1, 130);
  pointer('touch-fire', 2); pointer('touch-jump', 3); pointer('touch-attack', 4);
  const start = data.player.body.position.clone(); step(data, 0.06);
  assert.ok(data.player.body.position.x < start.x); assert.ok(data.player.body.position.y > start.y);
  assert.equal(data.player.getState().jumping, true); assert.ok(data.getPlatformerStatus().shots.friendly > 0);
  assert.equal(touch.isTouchFire(), true); assert.equal(ordinary.mock.callCount(), 0);
  gesture('touchstart', 5, 800); gesture('touchmove', 5, 1000);
  assert.equal(data.player.getState().yaw, Math.PI / 2); assert.ok(Math.abs(data.player.getState().pitch) < 1e-8);
  window.dispatchEvent(new Event('blur')); assert.equal(touch.isTouchFire(), false);
  assert.equal(data.player.getState().isMoving, false);
});

test('Required asset failures remain visible and can retry without invisible progression blockers', async t => {
  t.mock.method(console, 'error', () => {});
  const { data, respawns, finishes, body, elements } = await fixture(t, {
    loadModel: async name => { if (name === 'Enemy_QuadShell') throw new Error('fixture asset failure'); return asset(); },
  });
  step(data, 10); assert.equal(data.getPlatformerStatus().phase, 'entry'); assert.equal(data.player.isEnabled(), false);
  assert.match(elements.get('space-cinematic-caption').textContent, /COULD NOT LOAD.*RETRY CHECKPOINT/);
  const retry = body.querySelector('.platformer-retry'); assert.equal(retry.classList.contains('hidden'), false);
  retry.dispatchEvent(new Event('click')); retry.dispatchEvent(new Event('click'));
  assert.equal(respawns.length, 1); assert.equal(finishes.length, 0);
});

test('Shared robot templates produce independent skeletons and never dispose the persistent player', async t => {
  const load = t.mock.fn(async () => asset(true));
  const { data, body } = await fixture(t, { loadModel: load }); step(data, 1.3);
  assert.equal(load.mock.callCount(), 3);
  const rigs = [1, 2].map(id => { let rig; data.scene.getObjectByName(`Platform-patrol${id}`).traverse(node => { if (node.isSkinnedMesh) rig = node; }); return rig; });
  assert.notEqual(rigs[0].skeleton, rigs[1].skeleton); assert.notEqual(rigs[0].skeleton.bones[0], rigs[1].skeleton.bones[0]);
  const model = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), socket = new THREE.Group();
  model.add(mesh, socket); data.scene.add(model);
  const geometryDispose = t.mock.method(mesh.geometry, 'dispose'), materialDispose = t.mock.method(mesh.material, 'dispose');
  data.updateCinematicCharacter({ model, weapon: { socket, shoot() {}, setEquipped() {} } });
  data.dispose(); data.dispose(); key('KeyD');
  assert.equal(data.physicsWorld.bodies.length, 0); assert.equal(data.player.isEnabled(), false);
  assert.equal(body.classList.contains('jungle-platformer'), false); assert.equal(body.querySelector('.platformer-hud'), null);
  assert.equal(socket.children.length, 0); assert.equal(geometryDispose.mock.callCount(), 0); assert.equal(materialDispose.mock.callCount(), 0);
});

test('Late asset completion after disposal releases its resources and cannot recreate actors', async t => {
  browser(t); const pending = [];
  const data = createScene({ loadModel: () => new Promise(resolve => pending.push(resolve)), onRespawn() {}, onFinished() {} });
  data.dispose();
  const releases = pending.map(resolve => { const model = asset(), dispose = t.mock.method(model.scene.children[0].geometry, 'dispose'); resolve(model); return dispose; });
  await data.ready;
  assert.equal(data.physicsWorld.bodies.length, 0); assert.ok(releases.every(fn => fn.mock.callCount() === 1));
  assert.equal(data.scene.children.some(node => node.name.startsWith('Platform-')), false);
});

test('Scene 17 collapses the bridge on impact, preserves health/camera and hands off once', async t => {
  browser(t); const states = [];
  const data = createBridge({ loadModel: async () => asset(), loadDinosaur: async () => asset(), onRespawn() {}, onPlatformer: state => states.push(state) });
  t.cleanup(() => data.dispose()); await data.ready;
  data.player.takeDamage(19); data.player.setPosition(-42, 0.53, 17);
  data.camera.position.set(-41, 3, 22); data.camera.lookAt(-42, 1, 17);
  const start = data.camera.position.clone(); data.updatePhysics(0);
  assert.ok(data.camera.position.distanceTo(start) < 1e-9);
  step(data, 2); const clock = data.getCinematicPose().time;
  window.dispatchEvent(new Event('blur')); step(data, 2); assert.equal(data.getCinematicPose().time, clock);
  window.dispatchEvent(new Event('focus')); step(data, 6);
  assert.equal(states.length, 1); assert.equal(states[0].pilotState.health, 81);
  assert.ok(Math.abs(states[0].pilotState.position.y - 0.53) < 1e-9);
  assert.ok(states[0].cameraPosition.distanceTo(data.camera.position) < 1e-9);
  assert.ok(states[0].scramblerPosition.distanceTo(new THREE.Vector3(-42, 5, 17)) < 1e-9);
  assert.deepEqual(states[0].platformProgress, { checkpoint: 'bridge', activatedRelays: [], defeatedRobots: [] });
  assert.equal(data.physicsWorld.bodies.some(b => b.type === CANNON.Body.STATIC && b.position.x === -42 && b.position.z === 17 && b.position.y === 0.08), false);
});

for (const [label, position] of [
  ['17', [-82, 49]], ['19', [-120, -27]],
]) test(`Scene ${label} dinosaurs load only off path, stun on obstacles and kill on contact`, async t => {
  browser(t);
  let loads = 0;
  const dino = asset(true); dino.animations = [new THREE.AnimationClip('Animation', 9, [])];
  const data = (label === '17' ? createBridge : createReturn)({ loadModel: async () => asset(), loadDinosaur: async () => { loads++; return dino; }, onRespawn() {} });
  t.cleanup(() => data.dispose()); await data.ready;
  step(data, 0.2);
  assert.equal(loads, 0);
  assert.equal(data.dinosaurs.length, 0);
  data.player.setPosition(position[0], 0.3, position[1]);
  data.updatePhysics(1 / 60);
  await Promise.resolve();
  assert.equal(loads, 1);
  step(data, 0.2);
  const enemy = data.dinosaurs.find(actor => actor.phase === 'chasing');
  assert.ok(enemy, 'off-path entry spawns a chasing dinosaur');
  assert.equal(enemy.actions.get('Run')?.getClip().name, 'Animation');
  assert.equal(data.getDamageTargets().some(target => target.root === enemy.root), false);
  const obstacle = data.physicsWorld.bodies.find(body => body.type === CANNON.Body.STATIC && body.shapes.some(shape => shape instanceof CANNON.Cylinder));
  assert.ok(obstacle, 'jungle trees have physical colliders');
  let trunk, trunkIndex;
  for (const mesh of data.scene.children.filter(node => node.name.startsWith('JungleTrunks/'))) {
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      if (Math.hypot(matrix.elements[12] + mesh.position.x - obstacle.position.x, matrix.elements[14] + mesh.position.z - obstacle.position.z) < 0.01) {
        trunk = mesh; trunkIndex = index; break;
      }
    }
    if (trunk) break;
  }
  assert.ok(trunk, 'struck tree has a matching rendered trunk');
  const originalTrunk = new THREE.Matrix4(); trunk.getMatrixAt(trunkIndex, originalTrunk);
  enemy.body.dispatchEvent({ type: 'collide', body: obstacle, contact: { getImpactVelocityAlongNormal: () => -8 } });
  assert.equal(enemy.phase, 'stunned');
  assert.equal(enemy.timer, 10);
  data.player.setPosition(enemy.body.position.x + 1.5, 0.3, enemy.body.position.z);
  data.updatePhysics(1 / 60);
  assert.equal(data.physicsWorld.bodies.includes(obstacle), false, 'fallen tree collider is removed');
  step(data, 0.4);
  const tiltedTrunk = new THREE.Matrix4(); trunk.getMatrixAt(trunkIndex, tiltedTrunk);
  assert.notDeepEqual(tiltedTrunk.elements, originalTrunk.elements, 'trunk tips with its canopy');
  assert.ok(data.player.getHealth() > 0, 'stunned dinosaurs cannot kill');
  data.player.setPosition(position[0], 0.3, position[1]);
  enemy.timer = 0.001;
  data.updatePhysics(1 / 60);
  assert.equal(enemy.phase, 'chasing');
  data.player.setPosition(...(label === '17' ? [-57, 0.3, 49] : [-120, 0.3, 0]));
  data.updatePhysics(1 / 60);
  assert.equal(enemy.body.velocity.x, 0, 'stone paths end pursuit');
  data.player.setPosition(enemy.body.position.x, 0.3, enemy.body.position.z);
  data.updatePhysics(1 / 60);
  assert.equal(data.player.getHealth(), 0);
});

test('Dinosaur impact shatters jungle rocks with level-one box debris', async t => {
  browser(t);
  const data = createBridge({ loadModel: async () => asset(), loadDinosaur: async () => asset(true), onRespawn() {} });
  t.cleanup(() => data.dispose()); await data.ready;
  data.player.setPosition(-82, 0.3, 49); data.updatePhysics(1 / 60);
  await Promise.resolve(); step(data, 0.2);
  const enemy = data.dinosaurs.find(actor => actor.phase === 'chasing'); assert.ok(enemy);
  const rock = data.scene.children.filter(node => node.geometry?.type === 'DodecahedronGeometry')
    .sort((a, b) => a.position.distanceToSquared(enemy.root.position) - b.position.distanceToSquared(enemy.root.position))[0];
  assert.ok(rock);
  assert.ok(rock.position.distanceTo(enemy.root.position) < 45);
  data.player.setPosition(rock.position.x + 2, 0.3, rock.position.z + 2);
  data.updatePhysics(1 / 60);
  const rockBody = data.physicsWorld.bodies.find(body => body.type === CANNON.Body.STATIC
    && Math.hypot(body.position.x - rock.position.x, body.position.z - rock.position.z) < 0.01 && Math.abs(body.position.y - rock.position.y) < 2);
  assert.ok(rockBody, 'rock physics is streamed in near the player');
  enemy.phase = 'chasing';
  enemy.body.dispatchEvent({ type: 'collide', body: rockBody, contact: { getImpactVelocityAlongNormal: () => 8 } });
  data.updatePhysics(1 / 60);
  assert.equal(rock.visible, false);
  assert.equal(data.physicsWorld.bodies.includes(rockBody), false);
  assert.equal(data.scene.children.filter(node => node.name === 'BreakableDebris').length, 10);
});

test('Routing and presentation keep scene 19 defenses and normal weapon/view ownership intact', async () => {
  const source = async path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const [main, bridge, returnScene, css, html] = await Promise.all([
    source('main.ts'), source('scenes/level 3/scene17.ts'), source('scenes/level 3/scene19.ts'), source('styles/main.css'), source('index.html'),
  ]);
  assert.doesNotMatch(main, /loadRiver18|onRiver/); assert.match(main, /onPlatformer: loadPlatformer18/);
  assert.match(main, /onRespawn: state => loadPlatformer18\(checkpointArrival\(state\)\)/);
  assert.match(main, /weaponAnimation: currentSceneData\?\.ownsWeaponInput \? undefined/);
  assert.match(main, /function toggleView\(\)\s*\{\s*if \(currentSceneData\?\.ownsWeaponInput\) return/);
  assert.match(returnScene, /section: 'return'/); assert.match(bridge, /site\.breakBridge\(/);
  for (const behavior of ['updateSentries', 'updateDefense', 'updatePatrols', 'doorLatched', 'applyEntryCamera']) assert.ok(bridge.includes(behavior));
  assert.doesNotMatch(css, /river-run|river-hud|river-lane-controls/);
  assert.match(css, /jungle-platformer #touch-controls:not\(\.flight-mode\) #touch-fire \{ display: block/);
  assert.match(html, /18: keep up with the camera; A\/D or arrows move, Space jumps/);
});
