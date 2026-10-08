import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let server, THREE, CANNON, PistolController, CrowbarController, GogglesController, traceShot, createBreakables, createRewardChest;
let createPlayer, createScenePhysics, chestJSON, touchControls;
let LightsaberController, MeleeSwing;
const scenes = {};
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{ name: 'tutorial-deps',
      resolveId: id => id === 'virtual:tutorial-deps' ? '\0tutorial-deps' : null,
      load: id => id === '\0tutorial-deps' ? "export * as THREE from 'three'; export * as CANNON from 'cannon-es';" : null }] });
  ({ THREE, CANNON } = await server.ssrLoadModule('virtual:tutorial-deps'));
  ({ PistolController, traceShot } = await server.ssrLoadModule('/scripts/pistol.ts'));
  ({ CrowbarController } = await server.ssrLoadModule('/scripts/crowbar.ts'));
  ({ LightsaberController } = await server.ssrLoadModule('/scripts/lightsaber.ts'));
  ({ MeleeSwing } = await server.ssrLoadModule('/scripts/melee.ts'));
  touchControls = await server.ssrLoadModule('/scripts/touchControls.ts');
  ({ GogglesController } = await server.ssrLoadModule('/scripts/goggles.ts'));
  ({ createBreakables } = await server.ssrLoadModule('/scripts/breakables.ts'));
  ({ createRewardChest } = await server.ssrLoadModule('/scripts/rewardChest.ts'));
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
  ({ createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  for (const id of [3, 5, 6, 7]) scenes[id] = (await server.ssrLoadModule(`/scenes/level 1/scene${id}.ts`)).createScene;
  const base = new URL('../src/assets/models/Tools/', import.meta.url);
  chestJSON = JSON.parse(await readFile(new URL('Prop_Chest.gltf', base), 'utf8'));
  for (const buffer of chestJSON.buffers) buffer.uri = `data:application/octet-stream;base64,${(await readFile(new URL(buffer.uri, base))).toString('base64')}`;
  delete chestJSON.materials; delete chestJSON.textures; delete chestJSON.images;
  for (const mesh of chestJSON.meshes) for (const primitive of mesh.primitives) delete primitive.material;
});
after(async () => server?.close());
function browser(t) {
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, ProgressEvent: globalThis.ProgressEvent, KeyboardEvent: globalThis.KeyboardEvent };
  class Element extends EventTarget {
    style = {}; dataset = {}; textContent = ''; hidden = true; disabled = false;
    classes = new Set(['hidden']);
    classList = {
      add: (...names) => { names.forEach(name => this.classes.add(name)); this.hidden = this.classes.has('hidden'); },
      remove: (...names) => { names.forEach(name => this.classes.delete(name)); this.hidden = this.classes.has('hidden'); },
      contains: name => this.classes.has(name),
      toggle: (name, value = !this.classes.has(name)) => { this.classList[value ? 'add' : 'remove'](name); return value; },
    };
    closest() { return null; } requestPointerLock() {} querySelector() { return null; }
    querySelectorAll() { return []; }
    setAttribute(name, value) { this[name] = value; }
    setPointerCapture() {} hasPointerCapture() { return false; } releasePointerCapture() {}
  }
  globalThis.KeyboardEvent = class extends Event {
    constructor(type, options = {}) { super(type, options); this.code = options.code; this.key = options.key; this.repeat = options.repeat ?? false; }
  };
  const elements = new Map();
  globalThis.HTMLElement = Element; globalThis.ProgressEvent = class extends Event {};
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { baseURI: 'http://localhost:5173/', pointerLockElement: null, body: new Element(),
    getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }) });
  const fetchOriginal = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => String(url).includes('Prop_Chest')
    ? new Response(JSON.stringify(chestJSON), { status: 200 }) : fetchOriginal(url, options));
  const cleanups = []; t.cleanup = fn => cleanups.push(fn);
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); Object.assign(globalThis, old); });
  return elements;
}
function key(code, extra = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ code, repeat: false, ...extra }).map(([k, value]) => [k, { value }])));
  window.dispatchEvent(event);
}
function click() { const event = new Event('mousedown'); Object.defineProperty(event, 'button', { value: 0 }); document.dispatchEvent(event); }
function step(data, seconds = 1) { for (let i = 0; i < seconds * 60; i++) data.updatePhysics(1 / 60); }
async function room(t, id, options) {
  const data = scenes[id](options); t.cleanup(() => data.dispose()); await data.chest?.ready; return data;
}
function fixture(t) {
  const physics = createScenePhysics(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: 0.3, z: 0 } }); player.enable();
  const breakables = createBreakables(scene, physics.world);
  t.cleanup(() => { breakables.dispose(); player.dispose(); physics.dispose(); });
  return { scene, camera, world: physics.world, player, breakables };
}

test('real weapon input rejects wrong tools and breaks targets/crates in both views', async t => {
  browser(t);
  const f = fixture(t);
  let thirdPerson = false;
  const context = () => ({ ...f, character: null, thirdPerson, hasCrowbar: true, targets: f.breakables.getDamageTargets(), setCharacterEquipped() {}, doorTarget: null, openDoor() {} });
  const advanceWeapons = seconds => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++) { pistol.update(1 / 60); crowbar.update(1 / 60); }
  };
  const pistol = new PistolController(context, async () => ({ scene: new THREE.Group() })); await pistol.ready;
  const crowbar = new CrowbarController(context); t.cleanup(() => { pistol.dispose(); crowbar.dispose(); });
  const target = f.breakables.add('Target', 'pistol', new THREE.Vector3(0, 1.3, -1), new THREE.Vector3(0.8, 0.8, 0.15));
  f.camera.position.set(0, 1.3, 0); f.camera.lookAt(0, 1.3, -1);
  document.pointerLockElement = document.body;
  crowbar.equip(); click(); assert.equal(target.broken, false, 'Crowbar cannot break a pistol target'); crowbar.holster();
  pistol.equip(); assert.equal(pistol.shoot(), true); assert.equal(target.broken, true);
  const crate = f.breakables.add('Crate', 'crowbar', new THREE.Vector3(0, 0.6, -1.2), new THREE.Vector3(1, 1.2, 1));
  f.camera.lookAt(0, 0.7, -1.2); advanceWeapons(0.3); assert.equal(pistol.shoot(), true); assert.equal(crate.broken, false); pistol.holster();
  crowbar.equip(); advanceWeapons(0.4); click();
  assert.equal(crate.broken, false, 'Click starts the attack, not instant ray damage');
  advanceWeapons(0.4); assert.equal(crate.broken, true, 'First-person crowbar reaches from the body');
  const third = f.breakables.add('ThirdPersonCrate', 'crowbar', new THREE.Vector3(0, 0.6, -1.2), new THREE.Vector3(1, 1.2, 1));
  thirdPerson = true;
  f.camera.position.set(0.7, 1.9, 1.5); f.camera.lookAt(0, 0.7, -1.2); advanceWeapons(0.4); click(); advanceWeapons(0.4);
  assert.equal(third.broken, true, 'Third-person camera distance must not shorten the physical melee reach');
  assert.ok(f.scene.children.some(node => node.name === 'BreakableDebris'));
  for (let i = 0; i < 150; i++) f.breakables.update(1 / 60);
  assert.ok(!f.scene.children.some(node => node.name === 'BreakableDebris'));
  assert.ok(!f.world.bodies.includes(third.body));
});

for (const thirdPerson of [false, true]) {
  test(`ladder crate breaks with a rendered crowbar and decorative sprites in ${thirdPerson ? 'third' : 'first'} person`, t => {
    browser(t); const f = fixture(t);
    const character = new THREE.Group(), renderedWeapon = new THREE.Group();
    renderedWeapon.name = 'crowbar'; renderedWeapon.position.set(0.4, 2, 0.8);
    character.add(renderedWeapon); f.scene.add(character);
    const caption = new THREE.Sprite(new THREE.SpriteMaterial());
    caption.position.set(0, 1.1, -0.4); f.scene.add(caption);
    const crate = f.breakables.add('StoreroomLadderCrate', 'crowbar',
      new THREE.Vector3(0, 0.65, -1.8), new THREE.Vector3(1.65, 1.3, 1.4));
    const crowbar = new CrowbarController(() => ({ ...f, character, thirdPerson, hasCrowbar: true,
      targets: f.breakables.getDamageTargets(), setCharacterEquipped() {}, doorTarget: null, openDoor() {} }));
    t.cleanup(() => { crowbar.dispose(); caption.material.dispose(); });
    f.camera.position.set(0.7, 1.9, 1.5); f.camera.lookAt(0, 1.1, -1.8);
    document.pointerLockElement = document.body; crowbar.equip(); click();
    assert.equal(crate.broken, false, 'Starting the attack does not skip the contact sweep');
    for (let frame = 0; frame < 24; frame++) crowbar.update(1 / 60);
    assert.equal(crate.broken, true, 'Rig pose and camera offset cannot shorten crowbar reach');
    assert.ok(!f.world.bodies.includes(crate.body), 'The broken crate no longer blocks the ladder');
  });
}

test('crew reward chest faces into the room and rotates its collider without loading the model chest', async t => {
  browser(t); const f = fixture(t);
  let modelRequests = 0;
  const yaw = -Math.PI / 2;
  const chest = createRewardChest({ ...f, world: f.world, position: new THREE.Vector3(-1.5, 0, 0), yaw,
    reward: 'lightsaber', style: 'crew', unlocked: () => true, onCollect: () => true },
    async () => { modelRequests++; throw new Error('The heavy chest must not be requested'); });
  t.cleanup(() => chest.dispose()); await chest.ready;
  assert.equal(modelRequests, 0);
  const front = new THREE.Vector3(0, 0, -1).applyQuaternion(chest.root.quaternion);
  assert.ok(front.x > 0.999 && Math.abs(front.z) < 0.001);
  const body = f.world.bodies.at(-1);
  const physicalFront = body.quaternion.vmult(new CANNON.Vec3(0, 0, -1));
  assert.ok(physicalFront.x > 0.999 && Math.abs(physicalFront.z) < 0.001);
  chest.root.updateMatrixWorld(true);
  const latch = chest.root.getObjectByName('ChestLatch').getWorldPosition(new THREE.Vector3());
  assert.ok(latch.x > chest.root.position.x, 'The latch is on the approach side, not against the wall');
});

function input(element, type, properties = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, { value }])));
  element.dispatchEvent(event);
}
function touch(element, type, identifier = 1) {
  input(element, type, { changedTouches: [{ identifier, target: element, clientX: 600, clientY: 300 }] });
}
async function mobileWeapons(t) {
  browser(t); window.ontouchstart = null;
  const f = fixture(t);
  let pistol, crowbar;
  const context = () => ({ ...f, character: null, thirdPerson: false, hasCrowbar: true,
    targets: f.breakables.getDamageTargets(), setCharacterEquipped() {}, doorTarget: null, openDoor() {} });
  pistol = new PistolController(() => ({ ...context(), holsterOther: () => crowbar?.holster() }), async () => ({ scene: new THREE.Group() }));
  await pistol.ready;
  crowbar = new CrowbarController(() => ({ ...context(), holsterOther: () => pistol.holster() }));
  t.cleanup(() => { pistol.dispose(); crowbar.dispose(); });
  t.cleanup(touchControls.registerWeaponEquip('pistol', () => pistol.isEquipped() ? pistol.holster() : pistol.equip()));
  t.cleanup(touchControls.registerWeaponEquip('crowbar', () => crowbar.isEquipped() ? crowbar.holster() : crowbar.equip()));
  touchControls.initTouchControls();
  t.cleanup(() => touchControls.disposeTouchControls());
  const attack = document.getElementById('touch-attack');
  const pistolButton = document.getElementById('touch-pistol');
  touch(pistolButton, 'touchstart'); touch(pistolButton, 'touchend');
  f.camera.position.set(0, 1.3, 0); f.camera.lookAt(0, 1.3, -1);
  const target = f.breakables.add('MobileTarget', 'pistol', new THREE.Vector3(0, 1.3, -1), new THREE.Vector3(0.8, 0.8, 0.15));
  return { ...f, pistol, crowbar, attack, target };
}

for (const mode of ['touch', 'pointer', 'click']) {
  test(`mobile attack breaks a target and a crate through ${mode} input without pointer lock`, async t => {
    const f = await mobileWeapons(t);
    const tap = () => {
      if (mode === 'touch') { touch(f.attack, 'touchstart'); touch(f.attack, 'touchend'); }
      else if (mode === 'pointer') {
        input(f.attack, 'pointerdown', { pointerId: 2, pointerType: 'touch', button: 0, isPrimary: false });
        input(f.attack, 'pointerup', { pointerId: 2 });
      } else input(f.attack, 'click', { detail: 0, button: 0 });
    };
    assert.equal(document.pointerLockElement, null);
    tap(); assert.equal(f.target.broken, true, `${mode} activation must reach the real pistol damage path`);
    assert.equal(f.attack.textContent, 'SHOOT');
    const crate = f.breakables.add('MobileCrate', 'crowbar', new THREE.Vector3(0, 0.6, -1.2), new THREE.Vector3(1, 1.2, 1));
    f.camera.lookAt(0, 0.7, -1.2);
    const crowbarButton = document.getElementById('touch-crowbar');
    touch(crowbarButton, 'touchstart'); touch(crowbarButton, 'touchend');
    assert.equal(f.attack.textContent, 'SWING');
    tap();
    for (let frame = 0; frame < 24; frame++) f.crowbar.update(1 / 60);
    assert.equal(crate.broken, true, `${mode} activation must reach the real crowbar damage path`);
    f.crowbar.holster(); assert.equal(f.attack.disabled, true);
  });
}

test('mobile attack deduplicates pointer/touch/click and USE stays E-only', async t => {
  const f = await mobileWeapons(t);
  const shoot = t.mock.method(f.pistol, 'shoot');
  const swing = t.mock.method(f.crowbar, 'swing');
  const use = document.getElementById('touch-interact');
  let interactions = 0;
  window.addEventListener('keydown', event => { if (event.code === 'KeyE') interactions++; });
  touch(use, 'touchstart'); touch(use, 'touchend');
  assert.equal(interactions, 1); assert.equal(shoot.mock.callCount(), 0); assert.equal(swing.mock.callCount(), 0);
  input(f.attack, 'pointerdown', { pointerId: 2, pointerType: 'touch', button: 0, isPrimary: false });
  touch(f.attack, 'touchstart', 2);
  touch(f.attack, 'touchstart', 3);
  input(f.attack, 'pointerup', { pointerId: 2 });
  touch(f.attack, 'touchend', 2);
  input(f.attack, 'click', { detail: 1, button: 0 });
  assert.equal(shoot.mock.callCount(), 1, 'One physical press must call shoot once');
  assert.equal(swing.mock.callCount(), 0, 'The holstered weapon must not be invoked');
  assert.equal(f.target.broken, true);
  assert.equal(f.attack.classList.contains('active'), false);
});

test('mobile attack guards pause/flight/disposal and releases canceled pointers', async t => {
  const f = await mobileWeapons(t);
  const shoot = t.mock.method(f.pistol, 'shoot');
  const press = () => input(f.attack, 'pointerdown', { pointerId: 2, pointerType: 'touch', button: 0 });
  const cancel = () => input(f.attack, 'pointercancel', { pointerId: 2 });
  press(); cancel();
  assert.equal(f.attack.classList.contains('active'), false);
  press(); cancel(); assert.equal(shoot.mock.callCount(), 2, 'Canceled input must not leave the button held');
  document.body.classList.add('quick-menu-open'); press(); cancel();
  document.body.classList.remove('quick-menu-open');
  touchControls.setTouchFlightMode(true); touch(f.attack, 'touchstart'); touch(f.attack, 'touchend');
  touchControls.setTouchFlightMode(false);
  assert.equal(shoot.mock.callCount(), 2, 'Hidden gameplay controls cannot attack while paused or flying');
  touchControls.disposeTouchControls(); press(); cancel(); input(f.attack, 'click', { detail: 0 });
  assert.equal(shoot.mock.callCount(), 2);
  touchControls.initTouchControls(); press(); cancel();
  assert.equal(shoot.mock.callCount(), 3, 'Reinitialization must not duplicate listeners');
  f.pistol.dispose(); input(f.attack, 'click', { detail: 0 });
  assert.equal(shoot.mock.callCount(), 3, 'Disposed controllers must unregister');
});

test('walls occlude breakables and distant crates cannot be hit by the crowbar', t => {
  browser(t); const f = fixture(t);
  const item = f.breakables.add('Covered', 'pistol', new THREE.Vector3(0, 1, -3), new THREE.Vector3(1, 1, 0.2));
  const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(2, 2, 0.15)) }); wall.position.set(0, 1, -1); f.world.addBody(wall);
  const ray = new THREE.Ray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  assert.equal(traceShot(f.scene, f.world, ray, [item]).target, undefined);
  f.world.removeBody(wall);
  assert.equal(traceShot(f.scene, f.world, ray, [item]).target, item);
  const crate = f.breakables.add('Distant', 'crowbar', new THREE.Vector3(0, 1, -2.5), new THREE.Vector3(1, 1, 0.2));
  const crowbar = new CrowbarController(() => ({ ...f, hasCrowbar: true, character: null, thirdPerson: false, targets: [crate], setCharacterEquipped() {}, doorTarget: null, openDoor() {} }));
  t.cleanup(() => crowbar.dispose()); f.camera.position.set(0, 1, 0); f.camera.lookAt(0, 1, -3); document.pointerLockElement = document.body;
  crowbar.equip(); click(); assert.equal(crate.broken, false);
});

test('crowbar swing intersects off-centre targets once and never damages while idle or holstered', t => {
  browser(t); const f = fixture(t);
  f.camera.position.set(0.7, 1.9, 1.5); f.camera.rotation.set(0.8, 0, 0);
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), new THREE.MeshBasicMaterial());
  target.position.set(0.8, 1.1, -1.1); f.scene.add(target);
  let damage = 0;
  const crowbar = new CrowbarController(() => ({ ...f, character: null, thirdPerson: true, hasCrowbar: true,
    targets: [{ root: target, damage: () => { damage++; return true; } }], setCharacterEquipped() {}, doorTarget: null, openDoor() {} }));
  t.cleanup(() => crowbar.dispose());
  const advance = seconds => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) crowbar.update(1 / 60); };
  crowbar.equip(); advance(0.4); assert.equal(damage, 0, 'holding a weapon does not deal contact damage');
  document.pointerLockElement = document.body; click(); assert.equal(damage, 0);
  advance(0.4); assert.equal(damage, 1, 'physical swing hits despite the camera looking elsewhere');
  advance(0.4); assert.equal(damage, 1, 'recovery and idle do not repeat damage');
  click(); crowbar.holster(); advance(0.4); assert.equal(damage, 1, 'holstering cancels a pending strike');
});

test('crowbar swept contact respects solid walls and physical melee reach', t => {
  browser(t); const f = fixture(t);
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), new THREE.MeshBasicMaterial());
  target.position.set(0.8, 1.1, -1.1); f.scene.add(target);
  const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(2, 2, 0.1)), position: new CANNON.Vec3(0, 1, -0.45) });
  f.world.addBody(wall);
  let damage = 0;
  const crowbar = new CrowbarController(() => ({ ...f, character: null, thirdPerson: true, hasCrowbar: true,
    targets: [{ root: target, damage: () => { damage++; return true; } }], setCharacterEquipped() {}, doorTarget: null, openDoor() {} }));
  t.cleanup(() => crowbar.dispose());
  const swing = () => { click(); for (let frame = 0; frame < 24; frame++) crowbar.update(1 / 60); };
  crowbar.equip(); document.pointerLockElement = document.body; swing(); assert.equal(damage, 0, 'solid wall stops the swing');
  f.world.removeBody(wall);
  swing(); assert.equal(damage, 1, 'uncovered contact is accepted');
  target.position.set(0, 1.1, -3); swing(); assert.equal(damage, 1, 'camera distance cannot extend melee reach');
});

for (const thirdPerson of [false, true]) {
  test(`lightsaber uses contact instead of the crosshair in ${thirdPerson ? 'third' : 'first'} person`, t => {
    browser(t); const f = fixture(t);
    f.camera.position.set(thirdPerson ? 0.7 : 0, thirdPerson ? 1.9 : 1.6, thirdPerson ? 1.5 : 0);
    f.camera.rotation.set(thirdPerson ? 0.8 : 0, 0, 0);
    const target = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
    target.position.set(thirdPerson ? 0.8 : -0.05, thirdPerson ? 1.1 : 1.3, -1.1); f.scene.add(target);
    let damage = 0;
    const saber = new LightsaberController(() => ({ ...f, character: null, thirdPerson, hasLightsaber: true,
      targets: [{ root: target, damage: (amount, weapon) => { assert.equal(amount, 35); assert.equal(weapon, 'lightsaber'); damage++; return true; } }],
      setCharacterEquipped() {}, openDoor() {} }));
    t.cleanup(() => saber.dispose());
    const advance = () => { for (let frame = 0; frame < 24; frame++) saber.update(1 / 60); };
    saber.equip(); advance(); assert.equal(damage, 0);
    document.pointerLockElement = document.body; click(); assert.equal(damage, 0);
    advance(); assert.equal(damage, 1, 'intersection hits an off-centre target once per swing');
    advance(); assert.equal(damage, 1, 'idle contact cannot deal damage');
    click(); saber.holster(); advance(); assert.equal(damage, 1, 'holster cancels damage');
  });
}

test('lightsaber parry timing survives contact attacks and holstering cancels the window', t => {
  browser(t); const f = fixture(t);
  const bolt = { mesh: new THREE.Mesh(new THREE.SphereGeometry(0.05)), velocity: new THREE.Vector3(0, 0, 3), parried: false, owner: 'boss' };
  bolt.mesh.position.set(0, 1.1, -1);
  const saber = new LightsaberController(() => ({ ...f, character: null, thirdPerson: true, hasLightsaber: true,
    targets: [], setCharacterEquipped() {}, openDoor() {}, getParryableBolts: () => [bolt] }));
  t.cleanup(() => saber.dispose()); saber.equip(); document.pointerLockElement = document.body;
  click(); saber.update(1 / 60);
  assert.equal(bolt.parried, true); assert.equal(bolt.owner, 'player'); assert.ok(bolt.velocity.z < 0);
  for (let frame = 0; frame < 24; frame++) saber.update(1 / 60);
  bolt.parried = false; bolt.owner = 'boss'; bolt.velocity.z = 3;
  click(); saber.holster(); saber.update(1 / 60); assert.equal(bolt.parried, true, 'initial well-timed parry remains valid');
  bolt.parried = false; saber.update(1 / 60); assert.equal(bolt.parried, false, 'holstered saber cannot parry new bolts');
});

test('melee sweep catches contacts between frames and pushes dynamic objects once', t => {
  browser(t); const f = fixture(t);
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.25), new THREE.MeshBasicMaterial());
  target.position.set(0, 1.1, -0.9); f.scene.add(target);
  let damage = 0;
  const context = { ...f, character: null, targets: [{ root: target, damage: () => { damage++; return true; } }] };
  const swing = new MeleeSwing('crowbar');
  swing.prime({ start: new THREE.Vector3(-1.1, 0.8, -0.9), end: new THREE.Vector3(-1.1, 1.4, -0.9) });
  const segment = { start: new THREE.Vector3(1.1, 0.8, -0.9), end: new THREE.Vector3(1.1, 1.4, -0.9) };
  assert.equal(swing.update(context, segment), true); assert.equal(damage, 1);
  swing.update(context, segment); assert.equal(damage, 1, 'swept contact cannot repeat within one attack');
  f.scene.remove(target);
  const body = new CANNON.Body({ mass: 2, shape: new CANNON.Box(new CANNON.Vec3(0.2, 0.2, 0.2)), position: new CANNON.Vec3(0, 1.1, -0.8) });
  f.world.addBody(body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1.1, -0.8); f.scene.add(mesh);
  const contact = { start: new THREE.Vector3(0, 0.9, -0.8), end: new THREE.Vector3(0, 1.3, -0.8) };
  swing.reset(); swing.update({ ...context, targets: [] }, contact);
  const velocity = body.velocity.clone(); assert.ok(velocity.z < 0);
  swing.update({ ...context, targets: [] }, contact); assert.deepEqual(body.velocity, velocity);
  body.velocity.set(0, 0, 0);
  f.world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(1, 2, 0.1)), position: new CANNON.Vec3(0, 1, -0.4) }));
  swing.reset(); swing.update({ ...context, targets: [] }, contact); assert.equal(body.velocity.length(), 0, 'wall blocks physical impulses too');
});

test('melee contacts invisible actor hurtboxes without treating their own model as a wall', t => {
  browser(t); const f = fixture(t);
  const actor = new THREE.Group(); f.scene.add(actor);
  const visual = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.4), new THREE.MeshBasicMaterial());
  visual.position.set(0, 1.1, -0.8); actor.add(visual);
  const hurtbox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  hurtbox.position.copy(visual.position); actor.add(hurtbox);
  let damage = 0;
  const context = { ...f, character: null, targets: [{ root: hurtbox, damage: () => { damage++; return true; } }] };
  const segment = { start: new THREE.Vector3(0, 0.9, -0.8), end: new THREE.Vector3(0, 1.3, -0.8) };
  const swing = new MeleeSwing('crowbar');
  swing.update(context, segment); assert.equal(damage, 1, 'visible actor and hidden proxy are one damage owner');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.1), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1.1, -0.4); f.scene.add(wall);
  swing.reset(); swing.update(context, segment); assert.equal(damage, 1, 'unrelated visible geometry still blocks contact');
});

test('goggles unlock after all scene 6 targets, auto-equip, toggle, and persist without chest/collider', async t => {
  const elements = browser(t); let current;
  const goggles = new GogglesController(() => ({ player: current?.player ?? null, scene: current, setCharacterEquipped() {} })); t.cleanup(() => goggles.dispose());
  current = await room(t, 6, { onGogglesCollected: () => goggles.collect() });
  const chest = current.chest;
  current.player.setPosition(0, 0.3, 2.3); key('KeyN'); assert.equal(goggles.isEquipped(), false);
  key('KeyE'); step(current, 2); assert.equal(goggles.isCollected(), false);
  const targets = current.getDamageTargets();
  targets.slice(0, -1).forEach(item => item.damage(25, 'pistol'));
  key('KeyE'); step(current, 2); assert.equal(goggles.isCollected(), false);
  targets.at(-1).damage(25, 'pistol'); key('KeyE'); step(current, 3);
  assert.equal(goggles.isCollected(), true); assert.equal(goggles.isEquipped(), true);
  assert.equal(chest.root.parent, null); assert.ok(!current.physicsWorld.bodies.includes(chest.body));
  current.dispose();
  current = await room(t, 6, { gogglesCollected: goggles.isCollected() }); goggles.update();
  assert.equal(current.chest, null); assert.equal(current.getDamageTargets().length, 6);
  const mesh = current.getDamageTargets()[0].root.children[0]; assert.equal(mesh.material.color.getHex(), 0xff2424);
  key('KeyN', { repeat: true }); assert.equal(goggles.isEquipped(), true);
  key('KeyN'); assert.equal(goggles.isEquipped(), false); assert.notEqual(mesh.material.color.getHex(), 0xff2424);
  key('KeyN'); assert.equal(mesh.material.color.getHex(), 0xff2424);
  assert.match(elements.get('goggles-status').textContent, /Red: pistol/);
  current.player.disable(); key('KeyN'); assert.equal(goggles.isEquipped(), true);
});

test('scene 5 crates scan yellow; health chest gives 15 HP per visit and stays', async t => {
  browser(t); let data = await room(t, 5); data.player.takeDamage(40); data.player.setPosition(0, 0.3, 1);
  data.setGogglesActive(true);
  assert.ok(data.getDamageTargets().every(item => item.root.children[0].material.color.getHex() === 0xffd629));
  key('KeyE'); step(data, 2); assert.equal(data.player.getHealth(), 60);
  data.getDamageTargets().forEach(item => item.damage(35, 'crowbar'));
  data.player.setPosition(0, 0.3, 1.5); key('KeyE'); step(data, 3);
  assert.equal(data.player.getHealth(), 75); assert.ok(data.chest.root.parent); assert.ok(data.physicsWorld.bodies.includes(data.chest.body));
  key('KeyE'); step(data, 3); assert.equal(data.player.getHealth(), 75);
  data.dispose(); data = await room(t, 5);
  assert.equal(data.getDamageTargets().length, 8);
  data.player.takeDamage(10); data.getDamageTargets().forEach(item => item.damage(35, 'crowbar'));
  data.player.setPosition(0, 0.3, 1.5); key('KeyE'); step(data, 3); assert.equal(data.player.getHealth(), 100);
});

test('scene 3 stuck door requires an equipped crowbar swing and slides inside solid walls', async t => {
  const elements = browser(t); let data = await room(t, 3); let transitions = 0;
  data.setLeftTrigger(() => transitions++); data.player.setPosition(-2.8, 0.3, 0); data.player.setRotation(Math.PI / 2, 0);
  step(data); key('KeyE'); step(data, 0.1); assert.match(elements.get('interact-prompt').textContent, /door is stuck/);
  assert.equal(data.hitCargoDoor(), false); assert.equal(data.sideDoors[0].open, 0);
  data.player.setPosition(-3.3, 0.3, 0); key('KeyW'); step(data, 1); key('KeyW');
  assert.ok(data.player.body.position.x > -4, 'Closed door collider prevents crossing'); assert.equal(transitions, 0);
  data.dispose(); let unlocked = false;
  data = await room(t, 3, { hasCrowbar: true, onCargoDoorOpened: () => { unlocked = true; } });
  data.player.setPosition(-2.8, 0.3, 0); data.player.setRotation(Math.PI / 2, 0); step(data); assert.equal(data.sideDoors[0].open, 0);
  const crowbar = new CrowbarController(() => ({ scene: data.scene, world: data.physicsWorld, camera: data.camera, player: data.player, character: null, thirdPerson: false,
    hasCrowbar: true, targets: [], setCharacterEquipped() {}, doorTarget: null, openDoor: data.hitCargoDoor })); t.cleanup(() => crowbar.dispose());
  document.pointerLockElement = document.body; click(); assert.equal(unlocked, false); crowbar.equip(); click(); assert.equal(unlocked, true);
  step(data); const door = data.sideDoors[0];
  assert.equal(door.open, 1); assert.equal(door.panelL.position.x, -4); assert.equal(door.bodyL.position.z, door.panelL.position.z);
  assert.equal(door.panelL.visible, true, 'Solid walls occlude the retracted panels; no visibility pop');
  const wallRay = new THREE.Raycaster(new THREE.Vector3(0, 1, door.panelL.position.z), new THREE.Vector3(-1, 0, 0)); data.scene.updateMatrixWorld(true);
  assert.notEqual(wallRay.intersectObjects(data.scene.children, true)[0].object, door.panelL, 'Wall surface hides the panel');
  data.dispose(); data = await room(t, 3, { hasCrowbar: true, cargoDoorUnlocked: unlocked }); data.player.setPosition(-2.8, 0.3, 0); step(data);
  assert.equal(data.sideDoors[0].open, 1);
  data.player.setPosition(2.8, 0.3, 0); step(data); assert.equal(data.sideDoors[1].open, 1, 'Scene 6 remains sensor-operated');
});

test('each scene 7 ladder crate stays cleared, and the climb prompt waits for all four', async t => {
  const elements = browser(t); const cleared = new Set(); let data = await room(t, 7, { clearedCrates: cleared, onCrateBroken: id => cleared.add(id) });
  data.setLadderTrigger(() => {}); data.player.setPosition(4.6, 0.3, -2.95); key('KeyE');
  assert.equal(data.player.getState().climbing, false); assert.equal(elements.get('interact-prompt').hidden, true);
  data.getDamageTargets()[0].damage(35, 'crowbar'); data.dispose();
  data = await room(t, 7, { clearedCrates: cleared, onCrateBroken: id => cleared.add(id) }); assert.equal(data.getDamageTargets().length, 3);
  data.getDamageTargets().forEach(item => item.damage(35, 'crowbar'));
  data.player.setPosition(4.6, 0.3, -2.95); data.setLadderTrigger(() => {}); step(data, 0.1);
  assert.equal(elements.get('interact-prompt').textContent, 'E: climb / Space while climbing: zip upward'); key('KeyE'); assert.equal(data.player.getState().climbing, true);
  data.dispose(); data = await room(t, 7, { clearedCrates: cleared }); assert.equal(data.getDamageTargets().length, 0);
});

test('chest disposal before async load cannot resurrect a collider or reward', async t => {
  browser(t); const f = fixture(t); let complete, rewards = 0;
  const chest = createRewardChest({ scene: f.scene, world: f.world, player: f.player, position: new THREE.Vector3(), reward: 'goggles', unlocked: () => true,
    onCollect: () => { rewards++; return true; } }, () => new Promise(resolve => { complete = resolve; }));
  chest.dispose(); complete({ scene: new THREE.Group(), animations: [] }); await chest.ready;
  key('KeyE'); chest.update(1); assert.equal(rewards, 0); assert.equal(chest.root.parent, null); assert.ok(!f.world.bodies.includes(chest.body));
});
