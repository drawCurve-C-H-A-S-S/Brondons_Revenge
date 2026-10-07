import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { createServer } from 'vite';

let server, THREE, createPlayer, createScenePhysics, createWeaponWheel, weaponWheelIndex;
let TeleportationDeviceController, teleportPlayer, hologramTransitionAt, TELEPORT_TRANSFER_DURATION;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  THREE = await server.ssrLoadModule('three');
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
  ({ createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  ({ createWeaponWheel, weaponWheelIndex } = await server.ssrLoadModule('/scripts/weaponWheel.ts'));
  ({ TeleportationDeviceController, teleportPlayer } = await server.ssrLoadModule('/scripts/teleportationDevice.ts'));
  ({ hologramTransitionAt, TELEPORT_TRANSFER_DURATION } = await server.ssrLoadModule('/scripts/characterManager.ts'));
});
after(async () => server?.close());

// Minimal DOM fixture: no browser, WebGL context, or downloaded assets.
function dom(t) {
  const saved = Object.fromEntries(['window', 'document', 'HTMLElement'].map(key => [key, globalThis[key]]));
  class Element extends EventTarget {
    constructor(tag = 'div') {
      super(); this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.textContent = '';
      this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: (name, force = !this.classes.has(name)) => { if (force) this.classes.add(name); else this.classes.delete(name); return force; },
      };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/)); }
    get className() { return [...this.classes].join(' '); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    matches(selector) { return selector[0] === '.' ? this.classList.contains(selector.slice(1)) : this.tag === selector; }
    closest(selectors) { return selectors.split(',').some(selector => this.matches(selector.trim())) ? this : this.parent?.closest(selectors) ?? null; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    getBoundingClientRect() { return { left: 450, top: 170, width: 380, height: 380 }; }
    requestPointerLock() {}
    set innerHTML(html) {
      this.children = [];
      const stack = [this];
      for (const match of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)\/?\s*>/gi)) {
        if (match[0].startsWith('</')) { stack.pop(); continue; }
        const child = new Element(match[1]);
        for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attr[1], attr[2]);
        stack.at(-1).appendChild(child);
        if (!match[0].endsWith('/>') && !['br', 'input'].includes(match[1])) stack.push(child);
      }
    }
  }
  globalThis.HTMLElement = Element;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { body: new Element('body'), hidden: false, pointerLockElement: null,
    createElement: tag => new Element(tag), getElementById: () => null });
  const cleanups = [];
  t.cleanup = fn => cleanups.push(fn);
  t.after(() => { for (const fn of cleanups.reverse()) fn(); Object.assign(globalThis, saved); });
  return { Element };
}
function input(type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(properties)) Object.defineProperty(event, name, { value });
  window.dispatchEvent(event); return event;
}
const key = (code, type = 'keydown', properties = {}) => input(type, { code, repeat: false, ...properties });
function wheelFixture(t) {
  dom(t);
  let collected = ['unarmed', 'pistol'], selected = 'unarmed', paused = false, blocked = false;
  const pauses = [], selections = [];
  const wheel = createWeaponWheel({
    getEntries: () => collected.map(id => ({ id, label: id })), getCurrentId: () => selected,
    isBlocked: () => blocked,
    setPaused(value) { paused = value; pauses.push(value); document.body.classList.toggle('quick-menu-open', value); },
    onSelect(id) { assert.equal(paused, false); selected = id; selections.push(id); },
  });
  t.cleanup(() => wheel.dispose());
  return { wheel, pauses, selections, root: document.body.children[0],
    setCollected: value => { collected = value; }, block: value => { blocked = value; }, isPaused: () => paused };
}

test('radial selection maps collected counts, segment boundaries, and the neutral center', () => {
  for (let count = 1; count <= 4; count++) {
    assert.equal(weaponWheelIndex(0, 0, count), -1);
    assert.equal(weaponWheelIndex(0, -31, count), -1);
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count;
      assert.equal(weaponWheelIndex(Math.sin(angle) * 112, -Math.cos(angle) * 112, count), i);
    }
  }
  assert.equal(weaponWheelIndex(500, 0, 4), 1);
  assert.equal(weaponWheelIndex(-500, 0, 4), 3);
  assert.equal(weaponWheelIndex(0, -100, 0), -1);
  assert.equal(weaponWheelIndex(NaN, 0, 4), -1);
});

test('hold Tab pauses, cursor draws a center line, release equips only collected weapons', t => {
  const f = wheelFixture(t);
  assert.equal(key('Tab').defaultPrevented, true); assert.equal(f.isPaused(), true);
  key('Tab', 'keydown', { repeat: true }); assert.deepEqual(f.pauses, [true]);
  assert.equal(f.root.querySelector('.ww-nodes').children.length, 2);
  input('mousemove', { clientX: 640, clientY: 460 });
  const line = f.root.querySelector('.ww-line');
  assert.equal(line.classList.contains('active'), true); assert.ok(Number(line.getAttribute('y2')) > 0);
  assert.deepEqual(f.selections, [], 'Hover never equips before release');
  key('Tab', 'keyup'); assert.deepEqual(f.selections, ['pistol']); assert.equal(f.isPaused(), false);
  f.setCollected(['unarmed', 'pistol', 'crowbar', 'lightsaber']);
  key('Tab'); assert.equal(f.root.querySelector('.ww-nodes').children.length, 4);
  input('mousemove', { clientX: 540, clientY: 360 }); key('Tab', 'keyup');
  assert.deepEqual(f.selections, ['pistol', 'lightsaber']);
  key('Tab'); input('mousemove', { clientX: 640, clientY: 260 }); key('Tab', 'keyup');
  assert.equal(f.selections.at(-1), 'unarmed', 'An explicit unarmed slot holsters');
});

test('locked mouse drives a virtual cursor and captures combat, movement, teleport, and camera input', t => {
  const f = wheelFixture(t); document.pointerLockElement = document.body;
  let leaked = 0;
  for (const type of ['keydown', 'keyup', 'mousedown', 'mousemove']) window.addEventListener(type, () => leaked++);
  key('Tab'); input('mousemove', { movementX: 0, movementY: 100 });
  key('KeyT'); key('KeyQ'); key('KeyW'); input('mousedown', { button: 0 }); key('KeyW', 'keyup');
  assert.equal(leaked, 0); assert.equal(f.isPaused(), true);
  assert.equal(document.pointerLockElement, document.body, 'Opening must preserve pointer lock');
  key('Tab', 'keyup'); assert.deepEqual(f.selections, ['pistol']); assert.equal(leaked, 0);
  key('KeyW'); assert.equal(leaked, 1, 'Gameplay input is released after the wheel closes');
});

test('neutral release, Escape, blur, hidden tab, pointer unlock, and disposal cancel safely', t => {
  const f = wheelFixture(t);
  key('Tab'); key('Tab', 'keyup'); assert.deepEqual(f.selections, []);
  for (const cancel of [
    () => key('Escape'), () => window.dispatchEvent(new Event('blur')),
    () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); document.hidden = false; },
    () => { document.pointerLockElement = null; document.dispatchEvent(new Event('pointerlockchange')); },
  ]) {
    key('Tab'); input('mousemove', { clientX: 640, clientY: 460 }); cancel();
    assert.equal(f.isPaused(), false); key('Tab', 'keyup'); assert.deepEqual(f.selections, []);
  }
  key('Tab'); f.wheel.dispose(); assert.equal(f.isPaused(), false);
  key('Tab'); assert.equal(f.wheel.isOpen(), false); assert.equal(document.body.children.length, 0);
});

test('blocked scenes and text fields retain Tab; arrow selection is keyboard-accessible', t => {
  const f = wheelFixture(t); f.block(true);
  assert.equal(key('Tab').defaultPrevented, false); assert.equal(f.wheel.isOpen(), false);
  f.block(false);
  assert.equal(key('Tab', 'keydown', { target: new HTMLElement('input') }).defaultPrevented, false);
  assert.equal(f.wheel.isOpen(), false);
  key('Tab'); key('ArrowLeft'); key('Tab', 'keyup'); assert.deepEqual(f.selections, ['pistol']);
});

function teleportFixture(t) {
  dom(t);
  const physics = createScenePhysics(), camera = new THREE.PerspectiveCamera();
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 2, y: 3.3, z: 4 } }); player.enable();
  let scene = new THREE.Scene(), sceneId = 'scene5', blocked = false, boss = false;
  const teleports = [], messages = [];
  const device = new TeleportationDeviceController(() => ({
    currentSceneId: sceneId, isBossFight: () => boss, isInputBlocked: () => blocked,
    getActiveScene: () => scene, getPlayerRadius: () => player.radius,
    getPlayerPosition: () => ({ ...player.body.position }), getPlayerRotation: () => player.getState().yaw,
    onTeleport: (id, position, rotation) => { teleports.push(id); teleportPlayer(player, position, rotation); },
    showMessage: message => messages.push(message),
  }));
  t.cleanup(() => { device.dispose(); player.dispose(); physics.dispose(); });
  return { device, player, teleports, messages, scene: () => scene,
    changeScene(id) { sceneId = id; scene = new THREE.Scene(); device.update(0); },
    block(value) { blocked = value; }, boss(value) { boss = value; } };
}

test('Q places only after collection; purple markers work outside scene 4 without extra lights', t => {
  const f = teleportFixture(t);
  key('KeyQ'); assert.equal(f.device.isPlaced(), false);
  f.device.collect(false); assert.equal(f.messages.length, 0);
  f.player.setRotation(0.7); key('KeyQ');
  const marker = f.scene().getObjectByName('TeleportAnchor'); assert.ok(marker);
  assert.ok(Math.abs(marker.position.y - 3.06) < 1e-6, 'Marker follows the saved floor, not global y=0');
  assert.equal(marker.getObjectsByProperty('isLight', true).length, 0);
  assert.ok(marker.children.every(mesh => mesh.material.isMeshBasicMaterial));
  const ring = marker.children[0]; assert.equal(ring.rotation.x, -Math.PI / 2);
  const snapshot = f.device.getState(); snapshot.placementPosition.x = 999;
  assert.equal(f.device.getState().placementPosition.x, 2, 'Saved coordinates cannot be mutated by a caller');
  const oldScene = f.scene(); f.device.detachMarker(); assert.equal(marker.parent, null);
  f.changeScene('scene6'); assert.equal(marker.parent, null);
  f.changeScene('scene5'); assert.equal(marker.parent, f.scene()); assert.notEqual(f.scene(), oldScene);
  f.player.setPosition(8, 6.3, 9); key('KeyQ'); assert.equal(f.scene().getObjectByName('TeleportAnchor'), marker);
  assert.equal(f.scene().children.filter(node => node.name === 'TeleportAnchor').length, 1);
  const dispose = t.mock.method(ring.geometry, 'dispose'); f.device.dispose();
  assert.equal(dispose.mock.callCount(), 1); assert.equal(marker.parent, null);
});

test('T moves synchronously with no character model and clears motion without resetting health', t => {
  const f = teleportFixture(t); f.device.collect(false); f.player.setRotation(0.7); key('KeyQ');
  f.player.takeDamage(20); const health = f.player.getHealth(), shield = f.player.getShield();
  f.player.setPosition(10, 8, 10); f.player.body.velocity.set(5, 2, 4); f.player.body.force.set(2, 3, 4);
  key('KeyW'); key('Tab'); assert.deepEqual(f.teleports, [], 'Tab no longer teleports');
  key('KeyT');
  assert.deepEqual(f.teleports, ['scene5']);
  assert.deepEqual([f.player.body.position.x, f.player.body.position.y, f.player.body.position.z], [2, 3.3, 4]);
  assert.equal(f.player.body.velocity.length(), 0); assert.equal(f.player.body.force.length(), 0);
  assert.equal(f.player.body.previousPosition.distanceTo(f.player.body.position), 0);
  assert.equal(f.player.body.interpolatedPosition.distanceTo(f.player.body.position), 0);
  assert.equal(f.player.getHealth(), health); assert.equal(f.player.getShield(), shield);
  assert.ok(Math.abs(f.player.getState().yaw - 0.7) < 1e-6);
  assert.deepEqual(f.player.captureTransition({ x: 0, y: 0, z: 0 }).heldKeys, []);
  assert.equal(f.player.isEnabled(), true);
});

test('teleport blocks repeats, menus, cinematics, boss fights, and typing', t => {
  const f = teleportFixture(t); f.device.collect(false); key('KeyQ');
  key('KeyT', 'keydown', { repeat: true });
  key('KeyT', 'keydown', { target: new HTMLElement('textarea') });
  f.block(true); key('KeyT'); f.block(false);
  document.body.classList.add('quick-menu-open'); key('KeyT'); document.body.classList.remove('quick-menu-open');
  f.boss(true); key('KeyT'); key('KeyQ'); f.boss(false);
  assert.deepEqual(f.teleports, []); assert.ok(f.messages.some(message => /boss fight/.test(message)));
  f.changeScene('scene6'); key('KeyT'); assert.deepEqual(f.teleports, ['scene5']);
});

test('device hologram finishes in 180ms; cinematic transfers keep their original timing', () => {
  assert.equal(TELEPORT_TRANSFER_DURATION, 0.18);
  assert.equal(hologramTransitionAt(0, true, TELEPORT_TRANSFER_DURATION).opacity, 0);
  const middle = hologramTransitionAt(0.09, true, TELEPORT_TRANSFER_DURATION);
  assert.ok(middle.opacity > 0 && middle.opacity < 1); assert.ok(middle.blend > 0);
  const end = hologramTransitionAt(TELEPORT_TRANSFER_DURATION, true, TELEPORT_TRANSFER_DURATION);
  assert.equal(end.opacity, 1); assert.equal(end.blend, 0);
  assert.equal(hologramTransitionAt(0.18, true).opacity, 0);
});

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
test('production integration freezes the loop, grants developer gear, and retains a single Bay Warden scene', async () => {
  const main = await source('main.ts');
  const loop = main.slice(main.indexOf('function animate()'));
  assert.match(loop, /if \(quickMenuOpen \|\| weaponWheelOpen \|\| teleportLoading \|\| document.hidden\)/);
  assert.ok(loop.indexOf('return;') < loop.indexOf('advanceSceneActions('));
  assert.ok(loop.indexOf('return;') < loop.indexOf('npcManager.update('));
  assert.ok(loop.indexOf('return;') < loop.indexOf('updatePhysics(delta'));
  assert.match(main, /teleportDevice\.collect\(false\)/);
  assert.match(main, /getEntries: weaponEntries/);
  assert.match(main, /if \(hasCrowbar\) entries.push/);
  assert.match(main, /if \(hasLightsaber\) entries.push/);
  const transfer = main.slice(main.indexOf('async function teleportToAnchor('), main.indexOf('function weaponEntries('));
  assert.doesNotMatch(transfer, /cctvTeleportTarget|setTimeout|scheduleSceneAction|\.disable\(/);
  assert.match(transfer, /teleportPlayer\(currentPlayer, position, rotation, state\)/);
  assert.doesNotMatch(main, /scene13[-.]5/);
  await assert.rejects(access(new URL('../src/scenes/level 1/scene13-5.ts', import.meta.url)), { code: 'ENOENT' });
  assert.match(main, /13: \(\) => import\('\.\/scenes\/level 1\/scene13\.js'\)/);
});

test('gem collection preserves the shader light layout and no weapon consumes T/K/L', async () => {
  const room = await source('scenes/level 1/scene4.ts');
  assert.doesNotMatch(room, /teleportDeviceLight\.visible\s*=\s*false/);
  assert.match(room, /teleportDevice\.visible = false;\s*teleportDeviceLight\.intensity = 0;/);
  assert.doesNotMatch(room, /createPlacedMarker|placedMarkerLight/);
  for (const path of ['scripts/crowbar.ts', 'scripts/pistol.ts', 'scripts/lightsaber.ts', 'scripts/touchControls.ts', 'scenes/level 3/scene18.ts']) {
    assert.doesNotMatch(await source(path), /['"]Key[TKL]['"]/);
  }
});

for (const name of ['Don.glb', 'Subject.glb']) {
  test(`${name} retains the remote-main uncompressed geometry contract`, async () => {
    const bytes = await readFile(new URL(`../src/assets/models/${name}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.ok(json.meshes.length > 0); assert.ok(json.skins.length > 0);
    assert.ok(!(json.extensionsRequired ?? []).includes('KHR_draco_mesh_compression'));
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
      assert.equal(primitive.extensions?.KHR_draco_mesh_compression, undefined);
      assert.equal(typeof primitive.attributes.POSITION, 'number');
    }
    assert.match(await source('core/loader.ts'), /import playerModelUrl from '\.\.\/assets\/models\/Don\.glb'/);
  });
}
