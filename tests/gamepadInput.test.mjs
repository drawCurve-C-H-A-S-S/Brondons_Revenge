import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { setMaxListeners } from 'node:events';
import { createServer } from 'vite';

let server, inputModule, THREE, createPlayer, createScenePhysics, createWeaponWheel;
let PistolController, CrowbarController, LightsaberController, createFinaleQte, FINISHER_BEATS, choreography;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
      name: 'controller-test-deps',
      resolveId: id => id === 'virtual:controller-test-deps' ? '\0controller-test-deps' : null,
      load: id => id === '\0controller-test-deps' ? "export * as THREE from 'three';" : null,
    }] });
  ({ THREE } = await server.ssrLoadModule('virtual:controller-test-deps'));
  inputModule = await server.ssrLoadModule('/scripts/gamepadInput.ts');
  ({ createPlayer } = await server.ssrLoadModule('/scripts/player.ts'));
  ({ createScenePhysics } = await server.ssrLoadModule('/helpers/physics/scenePhysics.ts'));
  ({ createWeaponWheel } = await server.ssrLoadModule('/scripts/weaponWheel.ts'));
  ({ PistolController } = await server.ssrLoadModule('/scripts/pistol.ts'));
  ({ CrowbarController } = await server.ssrLoadModule('/scripts/crowbar.ts'));
  ({ LightsaberController } = await server.ssrLoadModule('/scripts/lightsaber.ts'));
  ({ createFinaleQte, FINISHER_BEATS } = await server.ssrLoadModule('/scripts/mechDuel.ts'));
  choreography = await server.ssrLoadModule('/scripts/finaleChoreography.ts');
});
after(async () => server?.close());

function fixture(t, overrides = {}) {
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'KeyboardEvent', 'MouseEvent', 'PointerEvent'];
  const original = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class Element extends EventTarget {
    style = { setProperty(name, value) { this[name] = value; } };
    dataset = {}; children = []; selectors = new Map(); classes = new Set(); textContent = ''; disabled = false;
    classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, value = !this.classes.has(name)) => { this.classList[value ? 'add' : 'remove'](name); return value; },
    };
    set className(value) { this.classes = new Set(value.split(/\s+/)); }
    get className() { return [...this.classes].join(' '); }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
    closest() { return null; }
    setAttribute(name, value) { this[name] = String(value); }
    removeAttribute(name) { delete this[name]; }
    querySelector(selector) { if (!this.selectors.has(selector)) this.selectors.set(selector, new Element()); return this.selectors.get(selector); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 450, top: 170, width: 380, height: 380 }; }
    requestPointerLock() { throw new Error('Controller input must not request pointer lock'); }
  }
  class KeyEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      Object.assign(this, { code: '', key: '', repeat: false,
        ...Object.fromEntries(Object.entries(options).filter(([key]) => !['bubbles', 'cancelable'].includes(key))) });
    }
  }
  class MouseEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      Object.assign(this, { button: 0, clientX: 640, clientY: 360, movementX: 0, movementY: 0,
        ...Object.fromEntries(Object.entries(options).filter(([key]) => !['bubbles', 'cancelable'].includes(key))) });
    }
  }
  const pad = { id: 'NES-themed USB controller', index: 0, connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })), ...overrides };
  const elements = new Map(), window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  const document = Object.assign(new EventTarget(), { body: new Element(), hidden: false, pointerLockElement: null,
    getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => new Element(), baseURI: 'http://localhost:5173/' });
  const dispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = event => {
    const result = dispatch(event);
    if (event.bubbles && !event.cancelBubble) window.dispatchEvent(event);
    return result && !event.defaultPrevented;
  };
  const globals = { window, document, navigator: { getGamepads: () => [pad.connected ? pad : null] },
    HTMLElement: Element, HTMLCanvasElement: Element, Node: Element, KeyboardEvent: KeyEvent, MouseEvent, PointerEvent: MouseEvent };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  setMaxListeners(0, window, document);
  const cleanups = [], context = { id: 'test-scene', kind: 'foot', menuOpen: false, wheelOpen: false };
  const status = [], notices = [], menu = [], keys = [], mouse = [];
  let player, wheel, epoch = () => '';
  const input = inputModule.createGamepadInput({
    getContext: () => ({ ...context, id: `${context.id}:${epoch()}` }),
    onModeChange: () => player?.clearInput(), onStatus: state => status.push(state),
    onNotice: text => notices.push(text), onMenuAction: action => menu.push(action),
    aimWheel: (x, y) => wheel?.aimFromStick(x, y), cancelWheel: () => wheel?.close(),
  });
  cleanups.push(() => input.dispose());
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    if (inputModule.isControllerEvent(event)) keys.push({ type, code: event.code, repeat: event.repeat });
  });
  for (const type of ['mousedown', 'mouseup', 'mousemove']) document.addEventListener(type, event => {
    if (inputModule.isControllerEvent(event)) mouse.push({ type, x: event.movementX, y: event.movementY });
  });
  const f = {
    pad, window, document, context, input, status, notices, menu, keys, mouse, cleanups,
    setEpoch: getter => { epoch = getter; },
    activate() { input.setControllerType('switch'); assert.equal(input.setMode('controller'), true); input.update(1 / 60); },
    button(index, down) { pad.buttons[index].pressed = down; pad.buttons[index].value = down ? 1 : 0; input.update(1 / 60); },
    key(code) { window.dispatchEvent(new KeyEvent('keydown', { code, cancelable: true })); },
    attachPlayer() {
      const physics = createScenePhysics(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
      const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 60)); floor.position.y = -0.25; scene.add(floor); physics.addBoxFromMesh(floor);
      player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: 0.3, z: 0 } });
      player.enable(); Object.assign(f, { player, physics, scene, camera });
      for (let i = 0; i < 30; i++) physics.step(1 / 60, player);
      cleanups.push(() => { player.dispose(); physics.dispose(); floor.geometry.dispose(); floor.material.dispose(); });
    },
    attachWheel() {
      wheel = createWeaponWheel({ getEntries: () => ['unarmed', 'pistol', 'crowbar', 'lightsaber'].map(id => ({ id, label: id })),
        getCurrentId: () => 'unarmed', isBlocked: () => false, onSelect: id => f.selections.push(id),
        setPaused(value) { context.wheelOpen = value; input.reset(value); player?.clearInput(); } });
      f.selections = []; f.wheel = wheel; cleanups.push(() => wheel.dispose());
    },
  };
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  return f;
}

test('USB detection keeps keyboard and mouse as the default and reports the device', t => {
  const f = fixture(t); f.pad.axes[1] = -1; f.pad.buttons[0].pressed = true;
  f.input.update(1 / 60);
  assert.equal(inputModule.isControllerActive(), false);
  assert.equal(f.input.getStatus().ready, false);
  assert.equal(f.input.getStatus().type, null);
  f.input.setControllerType('switch');
  assert.equal(f.input.getStatus().ready, true);
  assert.equal(f.input.getStatus().name, f.pad.id);
  assert.equal(f.keys.length, 0);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
});

test('the radial dead zone is exactly 18 percent with proportional and capped diagonal output', () => {
  assert.equal(inputModule.CONTROLLER_DEAD_ZONE, 0.18);
  assert.deepEqual(inputModule.controllerStick(0.18, 0), { x: 0, y: 0 });
  assert.ok(inputModule.controllerStick(0.1801, 0).x > 0);
  assert.ok(Math.abs(inputModule.controllerStick(0.5, 0).x - (0.5 - 0.18) / 0.82) < 1e-12);
  const diagonal = inputModule.controllerStick(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.equal(diagonal.x, diagonal.y);
});

test('Nintendo face buttons, shoulders, teleport, goggles and dance map to the requested actions', t => {
  const f = fixture(t); f.activate();
  const bindings = [[0, 'Space'], [5, 'KeyE'], [2, 'KeyC'], [3, 'KeyV'], [6, 'ShiftLeft'],
    [4, 'Tab'], [7, 'KeyN'], [8, 'Enter'], [12, 'KeyT'], [13, 'KeyQ'], [14, 'KeyR'], [15, 'Digit9']];
  for (const [button, code] of bindings) {
    f.keys.length = 0; f.button(button, true); f.button(button, false);
    assert.deepEqual(f.keys.map(event => [event.type, event.code]), [['keydown', code], ['keyup', code]]);
  }
  f.button(9, true); f.button(9, false); assert.deepEqual(f.menu, ['pause']);
});

test('held controls emit one press and one release, not keyboard repeat or auto-mash', t => {
  const f = fixture(t); f.activate(); f.button(6, true); f.button(1, true);
  for (let i = 0; i < 120; i++) f.input.update(1 / 60);
  assert.equal(f.keys.filter(event => event.type === 'keydown' && event.code === 'ShiftLeft').length, 1);
  assert.equal(f.mouse.filter(event => event.type === 'mousedown').length, 1);
  assert.ok(f.keys.every(event => !event.repeat));
  f.button(6, false); f.button(1, false);
  assert.equal(f.keys.filter(event => event.type === 'keyup' && event.code === 'ShiftLeft').length, 1);
  assert.equal(f.mouse.filter(event => event.type === 'mouseup').length, 1);
});

test('the real player moves proportionally, sprints, jumps and crouches without pointer lock', t => {
  const f = fixture(t); f.attachPlayer(); f.activate();
  assert.equal(f.player.getState().isOnGround, true);
  f.pad.axes[1] = -0.5; f.input.update(1 / 60); f.physics.step(1 / 60, f.player);
  const half = Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z);
  f.pad.axes[1] = -1; f.input.update(1 / 60); f.physics.step(1 / 60, f.player);
  const full = Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z);
  assert.ok(full > half && half > 0);
  assert.ok(Math.abs(half / full - (0.5 - 0.18) / 0.82) < 0.02);
  f.button(6, true); f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().sprinting, true);
  assert.ok(Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z) > full);
  f.button(6, false); f.pad.axes[1] = 0; f.input.update(1 / 60);
  f.button(2, true); assert.equal(f.player.getState().crouching, true); f.button(2, false);
  f.button(2, true); assert.equal(f.player.getState().crouching, false); f.button(2, false);
  f.button(0, true); f.physics.step(1 / 60, f.player);
  assert.ok(f.player.body.velocity.y > 1); f.button(0, false);
});

test('right-stick yaw is frame-rate independent and pitch stays clamped', t => {
  const f = fixture(t); f.attachPlayer(); f.activate();
  const sample = fps => {
    f.pad.axes[2] = f.pad.axes[3] = 0; f.input.reset(); f.player.setRotation(0, 0); f.input.update(1 / fps);
    f.pad.axes[2] = 0.75;
    for (let i = 0; i < fps; i++) f.input.update(1 / fps);
    return f.player.getState().yaw;
  };
  const at30 = sample(30), at60 = sample(60);
  assert.ok(at30 < 0); assert.ok(Math.abs(at30 - at60) < 1e-10);
  f.pad.axes[3] = 1;
  for (let i = 0; i < 300; i++) f.input.update(1 / 60);
  assert.ok(f.player.getState().pitch > -Math.PI / 2 && f.player.getState().pitch < Math.PI / 2);
});

test('mode switching ignores physical gameplay keys in controller mode and restores keyboard behavior', t => {
  const f = fixture(t); f.attachPlayer(); f.activate(); f.key('KeyW'); f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().isMoving, false);
  f.key('KeyM'); assert.equal(inputModule.isControllerActive(), true);
  f.input.setMode('keyboard'); f.key('KeyW'); f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().isMoving, true);
});

test('A drives the real pistol, crowbar and lightsaber document handlers without mouse capture', async t => {
  const f = fixture(t); f.attachPlayer(); f.activate();
  let shots = 0;
  const context = () => ({ scene: f.scene, camera: f.camera, world: f.physics.world, player: f.player,
    character: null, thirdPerson: false, hasPistol: true, hasCrowbar: true, hasLightsaber: true, targets: [],
    setCharacterEquipped() {}, weaponAnimation: null, doorTarget: null, openDoor() {}, onShot() { shots++; } });
  const pistol = new PistolController(context, async () => ({ scene: new THREE.Group() }));
  const crowbar = new CrowbarController(context), saber = new LightsaberController(context);
  f.cleanups.push(() => { pistol.dispose(); crowbar.dispose(); saber.dispose(); });
  await pistol.ready;
  pistol.equip(); f.button(1, true); assert.equal(shots, 1); f.button(1, false); pistol.holster();
  crowbar.equip(); f.button(1, true); assert.equal(f.player.getState().actionRequest, 'Sword_Attack'); f.button(1, false); crowbar.holster();
  f.player.clearInput(); f.input.update(1 / 60);
  saber.equip(); f.button(1, true); assert.equal(f.player.getState().actionRequest, 'Sword_Attack'); f.button(1, false);
  assert.equal(f.document.pointerLockElement, null);
});

test('L opens the real weapon wheel, right stick selects, centering retains selection and release equips', t => {
  const f = fixture(t); f.attachPlayer(); f.attachWheel(); f.activate();
  const yaw = f.player.getState().yaw;
  f.button(4, true); assert.equal(f.wheel.isOpen(), true);
  f.pad.axes[2] = 1; f.input.update(1 / 60); assert.equal(f.player.getState().yaw, yaw);
  f.pad.axes[2] = 0; f.input.update(1 / 60); f.button(4, false);
  assert.equal(f.wheel.isOpen(), false); assert.deepEqual(f.selections, ['pistol']);
});

test('B cancels weapon selection without reopening L and unplugging leaves no stuck inputs', t => {
  const f = fixture(t); f.attachPlayer(); f.attachWheel(); f.activate();
  f.button(4, true); f.pad.axes[2] = 1; f.input.update(1 / 60); f.button(0, true);
  assert.equal(f.wheel.isOpen(), false); assert.deepEqual(f.selections, []);
  f.input.update(1 / 60); assert.equal(f.wheel.isOpen(), false, 'Held L must not reopen a cancelled wheel');
  f.button(0, false); f.button(4, false); f.pad.axes[2] = 0; f.input.update(1 / 60);
  f.button(4, true); f.pad.axes[2] = 1; f.input.update(1 / 60);
  f.pad.connected = false; f.input.update(1 / 60);
  assert.equal(f.wheel.isOpen(), false); assert.deepEqual(f.selections, []);
  assert.equal(inputModule.isControllerActive(), false);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  assert.match(f.notices.at(-1), /disconnected.*Keyboard & mouse restored/);
  f.key('KeyW'); f.physics.step(1 / 60, f.player); assert.equal(f.player.getState().isMoving, true);
});

test('blur stops input, then focus and scene changes resume held movement without retriggering an attack', t => {
  const f = fixture(t); f.activate(); f.pad.axes[1] = -1; f.button(1, true);
  f.window.dispatchEvent(new Event('blur')); f.input.update(1 / 60);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  f.window.dispatchEvent(new Event('focus')); f.input.update(1 / 60);
  assert.ok(inputModule.getControllerMovement().y < 0);
  assert.equal(f.mouse.filter(event => event.type === 'mousedown').length, 1);
  f.button(1, false); f.button(1, true);
  assert.ok(inputModule.getControllerMovement().y < 0);
  assert.equal(f.mouse.filter(event => event.type === 'mousedown').length, 2);
  f.context.id = 'next-scene'; f.input.update(1 / 60);
  assert.ok(inputModule.getControllerMovement().y < 0);
});

test('controller menus use A to confirm, B to go back and repeatable directional navigation without gameplay', t => {
  const f = fixture(t); f.activate(); f.context.menuOpen = true; f.input.update(1 / 60);
  f.button(1, true); for (let i = 0; i < 60; i++) f.input.update(1 / 60); f.button(1, false);
  f.button(0, true); f.button(0, false);
  f.button(13, true); for (let i = 0; i < 40; i++) f.input.update(1 / 60); f.button(13, false);
  assert.deepEqual(f.menu.slice(0, 2), ['confirm', 'back']);
  assert.ok(f.menu.filter(action => action === 'down').length >= 3);
  assert.equal(f.keys.length, 0);
});

test('escape and final-boss mappings use the same displayed controller labels as their real key actions', t => {
  const f = fixture(t); f.activate(); f.context.kind = 'escape'; f.input.update(1 / 60);
  for (const [button, code, label] of [[1, 'KeyY', 'A'], [3, 'KeyU', 'X'], [0, 'KeyI', 'B'], [2, 'KeyO', 'Y'], [5, 'KeyE', 'R']]) {
    f.button(button, true); assert.equal(f.keys.at(-1).code, code); f.button(button, false);
    assert.equal(inputModule.controllerLabel(code, 'escape'), label);
  }
  f.context.kind = 'finale'; f.input.update(1 / 60);
  for (const [button, code, label] of [[1, 'KeyJ', 'A'], [3, 'KeyF', 'X'], [6, 'KeyR', 'ZL'], [0, 'Space', 'B'], [5, 'KeyE', 'R']]) {
    f.button(button, true); assert.equal(f.keys.at(-1).code, code); f.button(button, false);
    assert.equal(inputModule.controllerLabel(code, 'finale'), label);
  }
});

test('all nine real finisher QTEs can be completed with controller taps, Y mashing and held R', t => {
  const f = fixture(t), qte = createFinaleQte(); f.context.kind = 'finale-qte'; f.setEpoch(() => qte.getState().index); f.activate();
  f.window.addEventListener('keydown', event => qte.press(event.code, event.repeat));
  f.window.addEventListener('keyup', event => qte.release(event.code));
  const buttons = { KeyA: 14, KeyJ: 1, KeyF: 3, Space: 0, KeyD: 2, KeyW: 12, KeyE: 5 };
  function advance(seconds) {
    for (let remaining = seconds; remaining > 1e-8;) {
      const dt = Math.min(0.01, remaining); f.input.update(dt); qte.update(dt); remaining -= dt;
    }
  }
  for (const beat of FINISHER_BEATS) {
    const at = beat.mode === 'tap' ? choreography.finisherActionTime(beat) : beat.lead + 0.04;
    advance(at - qte.getState().clock); f.button(buttons[beat.key], true);
    if (beat.mode === 'hold') advance(beat.hold + 0.001);
    f.button(buttons[beat.key], false);
    if (beat.mode === 'mash') for (let i = 1; i < beat.presses; i++) {
      advance(0.14); f.button(buttons[beat.key], true); f.button(buttons[beat.key], false);
    }
    assert.equal(qte.getState().judgement, 'success', beat.id);
    advance(choreography.finisherBeatDuration(beat) - qte.getState().clock + 0.001);
  }
  assert.equal(qte.getState().result, 'won'); assert.equal(qte.getState().misses, 0);
  assert.equal(qte.getState().totalStars, FINISHER_BEATS.length * 3);
});

test('calibration covers only game controls, including swapped buttons, trigger axes and a hat D-pad', t => {
  const neutral = [0, 0, 0, 0, -1, -1, 1.285714];
  const f = fixture(t, { mapping: '', axes: [...neutral],
    buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) });
  f.input.setControllerType('switch');
  assert.equal(f.input.getStatus().ready, false); assert.equal(f.input.setMode('controller'), false);
  f.input.beginSetup(); f.input.update(1 / 60);
  assert.equal(f.input.getStatus().setupStep, '1 / 18: Press B');
  const bindings = [{ button: 3 }, { button: 0 }, { button: 1 }, { button: 2 }, { button: 5 }, { button: 4 },
    { axis: 4, value: 1 }, { axis: 5, value: 1 }, { button: 6 }, { button: 7 },
    { axis: 6, value: -1 }, { axis: 6, value: 0.142857 }, { axis: 6, value: 0.714286 }, { axis: 6, value: -0.428571 },
    { axis: 2, value: 1 }, { axis: 3, value: 1 }, { axis: 0, value: -1 }, { axis: 1, value: -1 }];
  for (const [index, binding] of bindings.entries()) {
    assert.ok(f.input.getStatus().setupStep.startsWith(`${index + 1} / 18:`));
    assert.doesNotMatch(f.input.getStatus().setupStep, /stick click|Home|Capture|extra button/i);
    if ('button' in binding) { f.pad.buttons[binding.button].pressed = true; f.pad.buttons[binding.button].value = 1; }
    else f.pad.axes[binding.axis] = binding.value;
    f.input.update(1 / 60);
    f.pad.buttons.forEach(button => { button.pressed = false; button.value = 0; }); f.pad.axes = [...neutral]; f.input.update(1 / 60);
  }
  assert.equal(f.input.getStatus().setupStep, null, 'Unused browser buttons must not add calibration steps');
  assert.equal(f.input.getStatus().ready, true); f.activate(); f.button(0, true); f.button(0, false);
  assert.equal(f.mouse.filter(event => event.type === 'mousedown').length, 1);
  f.pad.axes[2] = 0.5; f.input.update(1 / 60); assert.ok(inputModule.getControllerMovement().x > 0);
  f.pad.axes[6] = -1; f.input.update(1 / 60); assert.equal(f.keys.at(-1).code, 'KeyT');
  f.pad.axes[6] = neutral[6]; f.pad.axes[4] = 0.8; f.input.update(1 / 60); assert.equal(f.keys.at(-1).code, 'ShiftLeft');
});

test('releasing L immediately restores a continuously held left stick and ZL sprint without centering', t => {
  const f = fixture(t); f.attachPlayer(); f.attachWheel(); f.activate();
  f.pad.axes[0] = -1; f.button(6, true); f.physics.step(1 / 60, f.player);
  const before = Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z);
  assert.ok(before > 0); assert.equal(f.player.getState().sprinting, true);
  f.button(4, true); assert.equal(f.wheel.isOpen(), true);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  f.pad.axes[2] = -1; f.input.update(1 / 60);
  f.button(4, false);
  assert.equal(f.wheel.isOpen(), false);
  assert.equal(inputModule.getControllerMovement().x, -1, 'Movement is restored in the release frame');
  assert.equal(f.player.getState().sprinting, true, 'Held ZL is restored without another press');
  f.physics.step(1 / 60, f.player);
  assert.ok(f.player.body.velocity.x < 0, 'The actual player moves left without resetting either stick');
  f.input.update(1 / 60); assert.equal(inputModule.getControllerMovement().x, -1);
});

test('menus freeze movement but closing them polls the still-held stick and ZL without neutral gating', t => {
  const f = fixture(t); f.activate(); f.pad.axes[0] = -0.7; f.button(6, true);
  const held = inputModule.getControllerMovement().x;
  f.context.menuOpen = true; f.input.update(1 / 60);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  f.context.menuOpen = false; f.input.update(1 / 60);
  assert.equal(inputModule.getControllerMovement().x, held);
  assert.equal(f.keys.at(-1).code, 'ShiftLeft');
});

test('Nintendo button positions and an adapter-specific swap change gameplay and menu actions together', t => {
  const f = fixture(t); f.activate(); f.button(1, true); f.button(1, false);
  assert.equal(f.mouse.filter(event => event.type === 'mousedown').length, 1, 'Physical A attacks');
  f.button(0, true); assert.equal(f.keys.at(-1).code, 'Space'); f.button(0, false);
  f.input.setSwapAB(true); assert.equal(f.input.getStatus().swapAB, true);
  f.button(1, true); assert.equal(f.keys.at(-1).code, 'Space'); f.button(1, false);
  f.button(0, true); f.button(0, false);
  assert.equal(f.mouse.filter(event => event.type === 'mousedown').length, 2);
  f.context.menuOpen = true; f.input.update(1 / 60);
  f.button(0, true); f.button(0, false); f.button(1, true); f.button(1, false);
  assert.deepEqual(f.menu, ['confirm', 'back']);
});

test('missing sticks are explicitly reported rather than pretending controller mode works', t => {
  const f = fixture(t, { axes: [], buttons: [{ pressed: false, value: 0 }] });
  f.input.setControllerType('switch');
  assert.equal(f.input.getStatus().ready, false); assert.equal(f.input.getStatus().canSetup, false);
  assert.equal(f.input.setMode('controller'), false); assert.match(f.notices.at(-1), /two sticks/);
  assert.equal(inputModule.isControllerActive(), false);
});
