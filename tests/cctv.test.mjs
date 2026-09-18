import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createServer } from 'vite';

let server;
let createCctvPanel;
let createCctvSystem;
let disposeSurveillanceScene;
let createScene2;
let createScene3;
let createScene4;
let createScene5;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createCctvPanel, createCctvSystem, disposeSurveillanceScene } = await server.ssrLoadModule('/scripts/cctv.ts'));
  ({ createScene: createScene2 } = await server.ssrLoadModule('/scenes/scene2.ts'));
  ({ createScene: createScene3 } = await server.ssrLoadModule('/scenes/scene3.ts'));
  ({ createScene: createScene4 } = await server.ssrLoadModule('/scenes/scene4.ts'));
  ({ createScene: createScene5 } = await server.ssrLoadModule('/scenes/scene5.ts'));
});
after(async () => { await server?.close(); });

function browserStubs(t) {
  const descriptors = ['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const texts = [];
  const context = new Proxy({ fillText: text => texts.push(text) }, {
    get: (target, key) => target[key] ?? (() => {}),
  });
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), {
    pointerLockElement: null,
    body: Object.assign(new EventTarget(), {
      requestPointerLock: t.mock.fn(), appendChild: t.mock.fn(),
    }),
    createElement: t.mock.fn(tag => ({
      tagName: tag.toUpperCase(), getContext: () => context, style: {}, remove() {},
    })),
  });
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { texts };
}

function mockRenderer() {
  const originalTarget = new THREE.WebGLRenderTarget(16, 16);
  return {
    originalTarget, target: originalTarget,
    xr: { enabled: true }, shadowMap: { autoUpdate: true },
    calls: [], targets: [], onRender: null,
    getRenderTarget() { return this.target; },
    setRenderTarget(target) { this.targets.push(target); this.target = target; },
    render(scene, camera) {
      const call = { scene, camera, target: this.target, xr: this.xr.enabled, shadows: this.shadowMap.autoUpdate };
      this.calls.push(call);
      this.onRender?.(call);
    },
  };
}

function fixture(t, { count = 3, buildSource = () => new THREE.Scene() } = {}) {
  const browser = browserStubs(t);
  const renderer = mockRenderer();
  const sources = Array.from({ length: count }, (_, index) => {
    const source = { view: null };
    source.definition = {
      id: `room-${index}`, label: `ROOM ${index}`,
      position: [index, 2, 4], lookAt: [0, 1, 0],
      panel: { position: [0, 0, 0], yaw: 0 },
      createView: t.mock.fn(() => {
        const scene = buildSource(index);
        source.view = {
          scene, updateEnvironment: t.mock.fn(),
          dispose: t.mock.fn(() => disposeSurveillanceScene(scene)),
        };
        return source.view;
      }),
    };
    return source;
  });
  const active = {
    roomId: 'room-0', scene: new THREE.Scene(),
    updateEnvironment: t.mock.fn(), dispose: t.mock.fn(),
  };
  const viewer = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  viewer.position.set(0, 0, 4);
  viewer.lookAt(0, 0, 0);
  const system = createCctvSystem(renderer, sources.map(source => source.definition));
  let disposed = false;
  function dispose() {
    if (!disposed) { disposed = true; system.dispose(); }
  }
  t.after(() => { dispose(); renderer.originalTarget.dispose(); });
  return {
    ...browser, renderer, sources, active, viewer, system, dispose,
    tick: (dt = 1 / 8, room = active, character) => system.update(dt, room, viewer, character),
  };
}

function panelIn(scene) { return scene.getObjectByName('hallway-cctv-panel'); }
function screensIn(panel) { return panel.children.filter(node => /^cctv-feed-\d+$/.test(node.name)); }
function updateCount(sources) {
  return sources.reduce((sum, source) => sum + (source.view?.updateEnvironment.mock.callCount() ?? 0), 0);
}

function texturedScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: new THREE.Texture() })));
  return scene;
}

function resourcesIn(root) {
  const resources = new Set();
  root.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of node.material ? [node.material].flat() : []) {
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.isRenderTargetTexture) resources.add(value);
      }
    }
  });
  return [...resources];
}

function watchDisposals(resources) {
  return resources.map(resource => {
    const record = { resource, count: 0 };
    resource.addEventListener('dispose', () => record.count++);
    return record;
  });
}

function assertDisposals(records, expected) {
  assert.ok(records.length > 0, 'Must observe actual resources');
  for (const { resource, count } of records) {
    assert.equal(count, expected, `${resource.type ?? resource.constructor.name} disposal count`);
  }
}

test('panel has four 16:9 slots, blank channels, page labels, and owns only its own resources', t => {
  const { texts } = browserStubs(t);
  const panel = createCctvPanel();
  const parent = new THREE.Scene();
  parent.add(panel.group);
  const textures = Array.from({ length: 3 }, () => new THREE.Texture());
  const feedDisposals = watchDisposals(textures);
  let disposed = false;
  t.after(() => {
    if (!disposed) panel.dispose();
    textures.forEach(texture => texture.dispose());
  });
  const panelDisposals = watchDisposals(resourcesIn(panel.group));
  assert.equal(panel.screens.length, 4);
  assert.equal(panel.housing.parent, panel.group);
  assert.deepEqual(panel.screens.map(screen => [Math.sign(screen.position.x), Math.sign(screen.position.y)]),
    [[-1, 1], [1, 1], [-1, -1], [1, -1]]);
  for (const screen of panel.screens) {
    assert.ok(screen instanceof THREE.Mesh);
    assert.ok(Math.abs(screen.geometry.parameters.width / screen.geometry.parameters.height - 16 / 9) < 1e-12);
  }
  panel.setFeeds(textures.map((texture, index) => ({ label: `ROOM ${index}`, texture })), 0, 1);
  assert.deepEqual(panel.screens.map(screen => screen.visible), [true, true, true, false]);
  assert.deepEqual(panel.screens.map(screen => screen.material.map), [...textures, null]);
  for (const text of ['SHIP SECURITY', '01 / ROOM 0', '03 / ROOM 2', 'UNASSIGNED', 'CHANNEL AVAILABLE', 'PAGE 1 / 1']) {
    assert.ok(texts.includes(text), text);
  }
  panel.setFeeds([{ label: 'BRIDGE', texture: textures[0] }], 1, 2);
  assert.deepEqual(panel.screens.map(screen => screen.visible), [true, false, false, false]);
  assert.deepEqual(panel.screens.map(screen => screen.material.map), [textures[0], null, null, null]);
  assert.ok(texts.includes('05 / BRIDGE'));
  assert.ok(texts.includes('PAGE 2 / 2'));
  panel.dispose();
  disposed = true;
  assert.equal(panel.group.parent, null);
  assert.ok(panel.screens.every(screen => screen.material.map === null));
  assertDisposals(panelDisposals, 1);
  assertDisposals(feedDisposals, 0);
});

test('empty-room LEDs blink independently of video refresh while the occupied room stays green', t => {
  const f = fixture(t);
  const character = new THREE.Group();
  character.visible = false;
  f.active.scene.add(character);
  f.tick(0, f.active, character);
  const indicators = panelIn(f.active.scene).children.filter(node => node.name.startsWith('cctv-room-status-'));
  const colors = () => indicators.slice(0, 3).map(indicator => indicator.material.color.getHex());
  assert.deepEqual(indicators.map(indicator => indicator.visible), [true, true, true, false]);
  assert.deepEqual(colors(), [0x79efbb, 0xff3030, 0xff3030]);
  f.tick(0.49, f.active, character);
  assert.deepEqual(colors(), [0x79efbb, 0xff3030, 0xff3030]);
  const renders = f.renderer.calls.length;
  f.tick(0.01, f.active, character);
  assert.equal(f.renderer.calls.length, renders, 'Blinking does not require another video render');
  assert.deepEqual(colors(), [0x79efbb, 0x400808, 0x400808]);
  f.tick(0.5, f.active, character);
  assert.deepEqual(colors(), [0x79efbb, 0xff3030, 0xff3030]);
  assert.equal(character.visible, false, 'First-person visibility does not determine occupancy');
});

test('room transitions move the occupied indicator to the destination feed', t => {
  const f = fixture(t);
  f.tick(0);
  const next = { roomId: 'room-1', scene: new THREE.Scene() };
  f.tick(0, next);
  const indicators = panelIn(next.scene).children.filter(node => node.name.startsWith('cctv-room-status-'));
  assert.deepEqual(indicators.slice(0, 3).map(indicator => indicator.material.color.getHex()),
    [0xff3030, 0x79efbb, 0xff3030]);
  assert.equal(indicators[3].visible, false);
});

test('occupancy LEDs follow camera pages and never light unassigned slots', t => {
  const f = fixture(t, { count: 6 });
  const active = { roomId: 'room-4', scene: new THREE.Scene() };
  f.tick(0, active);
  const indicators = panelIn(active.scene).children.filter(node => node.name.startsWith('cctv-room-status-'));
  assert.ok(indicators.every(indicator => indicator.material.color.getHex() === 0xff3030));
  f.tick(8, active);
  assert.deepEqual(indicators.map(indicator => indicator.visible), [true, true, false, false]);
  assert.equal(indicators[0].material.color.getHex(), 0x79efbb);
  assert.equal(indicators[1].material.color.getHex(), 0xff3030);
  f.tick(0.5, active);
  assert.equal(indicators[0].material.color.getHex(), 0x79efbb);
  assert.equal(indicators[1].material.color.getHex(), 0x400808);
});

test('an empty camera list does not mount, render, or fail', t => {
  const f = fixture(t, { count: 0 });
  f.tick(20);
  assert.equal(panelIn(f.active.scene), undefined);
  assert.equal(f.renderer.calls.length, 0);
  assert.equal(f.renderer.targets.length, 0);
});

test('sources are lazy and cached, and the active room uses its live scene without a duplicate update', t => {
  const f = fixture(t);
  assert.ok(f.sources.every(source => source.definition.createView.mock.callCount() === 0));
  assert.equal(panelIn(f.active.scene), undefined);
  f.tick(0);
  const first = f.renderer.calls[0];
  assert.equal(first.scene, f.active.scene);
  assert.ok(first.camera instanceof THREE.PerspectiveCamera);
  assert.deepEqual(first.camera.position.toArray(), f.sources[0].definition.position);
  const expectedDirection = new THREE.Vector3(...f.sources[0].definition.lookAt).sub(first.camera.position).normalize();
  assert.ok(first.camera.getWorldDirection(new THREE.Vector3()).distanceTo(expectedDirection) < 1e-12);
  assert.equal(first.target.width, 512);
  assert.equal(first.target.height, 288);
  assert.equal(first.target.texture.type, THREE.HalfFloatType);
  assert.ok(f.sources.every(source => source.view === null));
  f.tick();
  assert.equal(f.renderer.calls[1].scene, f.sources[1].view.scene);
  assert.deepEqual(f.sources[1].view.updateEnvironment.mock.calls[0].arguments, [1 / 8]);
  assert.equal(f.sources[2].view, null, 'Even another visible slot waits for its rendering turn');
  f.tick();
  assert.equal(f.renderer.calls[2].scene, f.sources[2].view.scene);
  f.tick();
  f.tick();
  assert.equal(f.renderer.calls[3].scene, f.active.scene);
  assert.equal(f.renderer.calls[3].camera, first.camera);
  assert.equal(f.renderer.calls[3].target, first.target);
  assert.equal(f.renderer.calls[4].scene, f.sources[1].view.scene);
  assert.equal(f.renderer.calls[4].camera, f.renderer.calls[1].camera);
  assert.equal(f.renderer.calls[4].target, f.renderer.calls[1].target);
  assert.deepEqual(f.sources.map(source => source.definition.createView.mock.callCount()), [0, 1, 1]);
  assert.equal(f.active.updateEnvironment.mock.callCount(), 0);
  assert.deepEqual(f.renderer.calls.map(call => call.shadows), [true, true, true, false, false]);
});

for (const count of [1, 2, 3, 4]) {
  test(`${count} feed(s): round-robin scheduling caps each at 8 FPS and does at most one render/update per tick`, t => {
    const f = fixture(t, { count });
    const times = new Map();
    // Binary-exact frame times avoid timing jitter and exercise all slot counts.
    for (let frame = 0; frame < 256; frame++) {
      const beforeRenders = f.renderer.calls.length;
      const beforeUpdates = updateCount(f.sources);
      f.tick(frame === 0 ? 0 : 1 / 256);
      assert.ok(f.renderer.calls.length - beforeRenders <= 1);
      assert.ok(updateCount(f.sources) - beforeUpdates <= 1);
      if (f.renderer.calls.length !== beforeRenders) {
        const target = f.renderer.calls.at(-1).target;
        if (!times.has(target)) times.set(target, []);
        times.get(target).push(frame / 256);
      }
    }
    assert.equal(times.size, count, 'No feed may starve');
    for (const timestamps of times.values()) {
      assert.ok(timestamps.length >= 7 && timestamps.length <= 8, `Frames in one second: ${timestamps.length}`);
      for (let i = 1; i < timestamps.length; i++) {
        assert.ok(timestamps[i] - timestamps[i - 1] >= 1 / 8 - 1e-12, 'A feed must not exceed 8 FPS');
      }
    }
    for (const source of f.sources) {
      for (const call of source.view?.updateEnvironment.mock.calls ?? []) assert.deepEqual(call.arguments, [1 / 8]);
    }
    assert.equal(updateCount(f.sources), f.renderer.calls.filter(call => call.scene !== f.active.scene).length);
    const renders = f.renderer.calls.length;
    const updates = updateCount(f.sources);
    f.tick(20);
    assert.equal(f.renderer.calls.length - renders, 1, 'A long frame must not catch up with multiple passes');
    assert.ok(updateCount(f.sources) - updates <= 1);
    f.tick(0);
    assert.equal(f.renderer.calls.length, renders + 1, 'No elapsed time means no extra pass');
  });
}

for (const throws of [false, true]) {
  for (const enabled of [false, true]) {
    test(`render ${throws ? 'failure' : 'success'} restores target, XR=${enabled}, shadows=${!enabled}, and visibility`, t => {
      const f = fixture(t, { count: 1 });
      const visibleReflector = Object.assign(new THREE.Group(), { isReflector: true });
      const hiddenReflector = Object.assign(new THREE.Group(), { isReflector: true, visible: false });
      const ordinary = new THREE.Group();
      const character = new THREE.Group();
      character.visible = false;
      const nested = new THREE.Group();
      nested.add(visibleReflector, hiddenReflector, ordinary);
      f.active.scene.add(nested, character);
      f.renderer.xr.enabled = enabled;
      f.renderer.shadowMap.autoUpdate = !enabled;
      // Exercise restoring the default framebuffer as well as a non-null render target.
      const previousTarget = enabled ? f.renderer.originalTarget : null;
      f.renderer.target = previousTarget;
      const failure = new Error('CCTV render failed');
      f.renderer.onRender = call => {
        assert.equal(call.scene, f.active.scene);
        assert.equal(panelIn(f.active.scene).visible, false);
        assert.equal(visibleReflector.visible, false);
        assert.equal(hiddenReflector.visible, false);
        assert.equal(ordinary.visible, true);
        assert.equal(character.visible, true);
        assert.equal(call.xr, false);
        assert.equal(call.shadows, true, 'First successful feed render must populate shadows');
        if (throws) throw failure;
      };
      const render = () => f.tick(0, f.active, character);
      if (throws) assert.throws(render, error => error === failure);
      else render();
      assert.equal(f.renderer.target, previousTarget);
      assert.equal(f.renderer.xr.enabled, enabled);
      assert.equal(f.renderer.shadowMap.autoUpdate, !enabled);
      assert.equal(panelIn(f.active.scene).visible, true);
      assert.equal(visibleReflector.visible, true);
      assert.equal(hiddenReflector.visible, false);
      assert.equal(character.visible, false);
      assert.deepEqual(f.renderer.targets, [f.renderer.calls[0].target, previousTarget]);
      f.renderer.onRender = null;
      character.visible = true;
      f.tick(1 / 8, f.active, character);
      assert.equal(character.visible, true, 'An already-visible character must remain visible');
      assert.equal(f.renderer.calls[1].shadows, throws, 'A failed render must not mark feed shadows initialized');
    });
  }
}

test('remote rendering hides its reflectors without changing the active character or panel', t => {
  const f = fixture(t, { count: 2, buildSource: () => {
    const scene = new THREE.Scene();
    scene.add(Object.assign(new THREE.Group(), { isReflector: true }));
    scene.add(Object.assign(new THREE.Group(), { isReflector: true, visible: false }));
    return scene;
  } });
  const character = new THREE.Group();
  character.visible = false;
  f.active.scene.add(character);
  f.tick(0, f.active, character);
  f.renderer.onRender = ({ scene }) => {
    assert.equal(scene, f.sources[1].view.scene);
    assert.deepEqual(scene.children.map(node => node.visible), [false, false]);
    assert.equal(character.visible, false);
    assert.equal(panelIn(f.active.scene).visible, true);
  };
  f.tick(1 / 8, f.active, character);
  assert.deepEqual(f.sources[1].view.scene.children.map(node => node.visible), [true, false]);
  assert.equal(character.visible, false);
});

for (const [name, position, lookAt] of [
  ['far away', [0, 0, 13], [0, 0, 0]],
  ['behind the panel', [0, 0, -4], [0, 0, 0]],
  ['looking away', [0, 0, 4], [0, 0, 10]],
  ['looking away up close', [0, 0, 1], [0, 0, 10]],
]) {
  test(`viewer ${name} skips rendering, environment updates, and lazy source creation`, t => {
    const f = fixture(t);
    const moveAway = () => { f.viewer.position.set(...position); f.viewer.lookAt(...lookAt); };
    const moveBack = () => { f.viewer.position.set(0, 0, 4); f.viewer.lookAt(0, 0, 0); };
    moveAway();
    f.tick(20);
    assert.ok(panelIn(f.active.scene), 'Mounting is independent of feed visibility');
    assert.equal(f.renderer.calls.length, 0);
    assert.equal(f.renderer.targets.length, 0);
    assert.equal(updateCount(f.sources), 0);
    assert.ok(f.sources.every(source => source.view === null));
    moveBack();
    f.tick(0);
    assert.equal(f.renderer.calls.length, 1, 'Feed resumes when the viewer can see the panel');
    moveAway();
    f.tick(20);
    assert.equal(f.renderer.calls.length, 1);
    assert.equal(updateCount(f.sources), 0);
    assert.ok(f.sources.every(source => source.view === null));
    moveBack();
    f.tick();
    assert.equal(f.renderer.calls.length, 2);
    assert.equal(updateCount(f.sources), 1);
  });
}

test('scene swaps replace and dispose panels, keep cached sources, and use a newly active scene directly', t => {
  const f = fixture(t);
  f.sources[1].definition.panel = { position: [1, 0, 0], yaw: 0.2 };
  delete f.sources[2].definition.panel;
  f.tick(0);
  f.tick();
  const originalPanel = panelIn(f.active.scene);
  const originalResources = watchDisposals(resourcesIn(originalPanel));
  const cached = f.sources[1].view;
  const next = { roomId: 'room-1', scene: new THREE.Scene() };
  f.tick(0, next);
  const nextPanel = panelIn(next.scene);
  assert.equal(originalPanel.parent, null);
  assert.equal(panelIn(f.active.scene), undefined);
  assertDisposals(originalResources, 1);
  assert.notEqual(nextPanel, originalPanel);
  assert.deepEqual(nextPanel.position.toArray(), [1, 0, 0]);
  assert.equal(nextPanel.rotation.y, 0.2);
  assert.equal(f.renderer.calls.at(-1).scene, f.sources[0].view.scene);
  f.tick(0, next);
  assert.equal(panelIn(next.scene), nextPanel, 'Repeated updates must not remount');
  f.tick(1 / 8, next);
  assert.equal(f.renderer.calls.at(-1).scene, next.scene, 'Do not use the cached view for the now-active room');
  assert.equal(cached.updateEnvironment.mock.callCount(), 1);
  assert.equal(cached.dispose.mock.callCount(), 0);
  const nextResources = watchDisposals(resourcesIn(nextPanel));
  const noPanel = { roomId: 'room-2', scene: new THREE.Scene() };
  const renderCount = f.renderer.calls.length;
  f.tick(20, noPanel);
  assert.equal(panelIn(noPanel.scene), undefined);
  assert.equal(nextPanel.parent, null);
  assertDisposals(nextResources, 1);
  assert.equal(f.renderer.calls.length, renderCount);
  f.tick(0);
  f.tick();
  assert.equal(f.renderer.calls.at(-1).scene, cached.scene);
  assert.equal(f.sources[1].definition.createView.mock.callCount(), 1);
  assert.equal(cached.dispose.mock.callCount(), 0);
});

test('more than four cameras automatically page every eight visible seconds and reuse cached feeds', t => {
  const f = fixture(t, { count: 6 });
  f.tick(0);
  for (let i = 0; i < 3; i++) f.tick();
  const panel = panelIn(f.active.scene);
  const screens = screensIn(panel);
  const pageNames = () => screens.map(screen => screen.material.map?.name ?? null);
  assert.deepEqual(pageNames(), ['cctv-room-0', 'cctv-room-1', 'cctv-room-2', 'cctv-room-3']);
  assert.equal(f.sources[4].view, null);
  assert.equal(f.sources[5].view, null);
  const cached = f.sources[1].view;
  f.tick(8 - 3 / 8);
  assert.equal(f.renderer.calls.length, 5, 'A page switch renders only one newly visible feed');
  assert.equal(f.renderer.calls.at(-1).scene, f.sources[4].view.scene);
  assert.equal(f.sources[5].view, null);
  assert.deepEqual(pageNames(), ['cctv-room-4', 'cctv-room-5', null, null]);
  assert.deepEqual(screens.map(screen => screen.visible), [true, true, false, false]);
  assert.ok(f.texts.includes('05 / ROOM 4'));
  assert.equal(f.texts.filter(text => text.startsWith('PAGE ')).at(-1), 'PAGE 2 / 2');
  f.tick();
  assert.equal(f.renderer.calls.at(-1).scene, f.sources[5].view.scene);
  assert.equal(cached.updateEnvironment.mock.callCount(), 1, 'Off-page sources must not update');
  f.tick(8 - 1 / 8);
  assert.equal(f.renderer.calls.at(-1).scene, f.active.scene);
  assert.deepEqual(pageNames(), ['cctv-room-0', 'cctv-room-1', 'cctv-room-2', 'cctv-room-3']);
  assert.equal(f.texts.filter(text => text.startsWith('PAGE ')).at(-1), 'PAGE 1 / 2');
  f.tick();
  assert.equal(f.renderer.calls.at(-1).scene, cached.scene);
  assert.ok(f.sources.every(source => source.definition.createView.mock.callCount() <= 1));
});

test('system disposal releases sources, all render targets, and panel assets but not active scene assets', t => {
  const f = fixture(t, { count: 6, buildSource: texturedScene });
  const activeAssets = texturedScene();
  f.active.scene.add(...activeAssets.children);
  const activeResources = watchDisposals(resourcesIn(f.active.scene));
  t.after(() => disposeSurveillanceScene(f.active.scene));
  const targetDispose = t.mock.method(THREE.WebGLRenderTarget.prototype, 'dispose');
  f.tick(0);
  f.tick();
  const source = f.sources[1].view;
  const sourceResources = watchDisposals(resourcesIn(source.scene));
  const panel = panelIn(f.active.scene);
  const panelResources = watchDisposals(resourcesIn(panel));
  f.dispose();
  assert.equal(panel.parent, null);
  assert.ok(screensIn(panel).every(screen => screen.material.map === null));
  assertDisposals(panelResources, 1);
  assertDisposals(sourceResources, 1);
  assertDisposals(activeResources, 0);
  assert.equal(source.dispose.mock.callCount(), 1);
  assert.equal(f.active.dispose.mock.callCount(), 0);
  assert.equal(targetDispose.mock.callCount(), 6, 'Even off-page, never-rendered targets must be released');
  assert.deepEqual(targetDispose.mock.calls.map(call => call.this.texture.name).sort(),
    Array.from({ length: 6 }, (_, index) => `cctv-room-${index}`));
  assert.ok(targetDispose.mock.calls.every(call => call.this !== f.renderer.originalTarget));
  assert.deepEqual(f.sources.map(item => item.definition.createView.mock.callCount()), [0, 1, 0, 0, 0, 0]);
  const renders = f.renderer.calls.length;
  f.tick(20);
  f.tick(20, { roomId: 'room-1', scene: new THREE.Scene() });
  assert.equal(f.renderer.calls.length, renders);
  assert.equal(panelIn(f.active.scene), undefined);
  assert.equal(source.updateEnvironment.mock.callCount(), 1);
  assert.equal(source.dispose.mock.callCount(), 1);
  assertDisposals(activeResources, 0);
});

test('surveillance disposal deduplicates shared geometry, material arrays, and textures and releases reflector/shadow resources', t => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  const otherMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const nested = new THREE.Group();
  nested.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material, otherMaterial]));
  const reflector = Object.assign(new THREE.Group(), { isReflector: true, dispose: t.mock.fn() });
  const light = new THREE.DirectionalLight();
  light.shadow.map = new THREE.WebGLRenderTarget(8, 8);
  const shadowDispose = t.mock.method(light.shadow, 'dispose');
  const records = watchDisposals([geometry, texture, material, otherMaterial, light.shadow.map]);
  scene.add(nested, reflector, light);
  disposeSurveillanceScene(scene);
  assertDisposals(records, 1);
  assert.equal(reflector.dispose.mock.callCount(), 1);
  assert.equal(shadowDispose.mock.callCount(), 1);
});

function stubComputerLoaders(t) {
  const load = (_url, onLoad) => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    // A nonempty real mesh keeps model bounding-box scaling finite.
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    t.after(() => material.dispose()); // Scene 4 replaces the loader's material.
    onLoad(group);
  };
  return [
    t.mock.method(OBJLoader.prototype, 'load', load),
    t.mock.method(FBXLoader.prototype, 'load', load),
    t.mock.method(THREE.TextureLoader.prototype, 'load', (_url, onLoad) => {
      const texture = new THREE.Texture();
      onLoad?.(texture);
      return texture;
    }),
  ];
}

for (const [name, roomId, factory] of [
  ['Scene 2', 'medical-bay', () => createScene2],
  ['Scene 3', 'hallway', () => createScene3],
  ['Scene 4', 'computer-room', () => createScene4],
  ['Scene 5', 'cafeteria', () => createScene5],
]) {
  test(`${name} surveillance mode animates the real environment without player, input listeners, wake overlays, or physics simulation`, t => {
    browserStubs(t);
    const loaders = name === 'Scene 4' ? stubComputerLoaders(t) : [];
    t.mock.method(Math, 'random', () => 0.5);
    const listeners = [window, document, document.body].map(target => t.mock.method(target, 'addEventListener'));
    const addBody = t.mock.method(CANNON.World.prototype, 'addBody');
    const step = t.mock.method(CANNON.World.prototype, 'step');
    const internalStep = t.mock.method(CANNON.World.prototype, 'internalStep');
    const data = factory()({ surveillanceOnly: true });
    let disposed = false;
    t.after(() => { if (!disposed) data.dispose(); });
    assert.equal(data.roomId, roomId);
    assert.deepEqual(Object.keys(data).sort(), ['dispose', 'roomId', 'scene', 'updateEnvironment']);
    assert.ok(data.scene instanceof THREE.Scene);
    assert.ok(data.scene.children.length > 0, 'Must build the actual room');
    assert.equal(typeof data.updateEnvironment, 'function');
    assert.equal(typeof data.dispose, 'function');
    assert.ok(addBody.mock.calls.every(call => call.arguments[0].mass === 0), 'No player/dynamic body may be created');
    const worlds = new Set(addBody.mock.calls.map(call => call.this));
    assert.ok([...worlds].every(world => world.bodies.length === 0), 'Construction colliders must not remain live');
    const resources = watchDisposals(resourcesIn(data.scene));
    const lights = [];
    const points = [];
    data.scene.traverse(node => {
      if (node.isPointLight) lights.push(node);
      if (node.isPoints) points.push(node);
    });
    const lightIntensities = lights.map(light => light.intensity);
    const pointVersions = points.map(point => point.geometry.attributes.position.version);
    for (let i = 0; i < 80; i++) data.updateEnvironment(1 / 8);
    assert.ok(lights.some((light, i) => light.intensity !== lightIntensities[i]) ||
      points.some((point, i) => point.geometry.attributes.position.version > pointVersions[i]),
    'Environment animation must remain active without a player');
    data.scene.updateMatrixWorld(true);
    data.scene.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite), node.name));
    assert.equal(step.mock.callCount(), 0);
    assert.equal(internalStep.mock.callCount(), 0);
    assert.ok([...worlds].every(world => world.bodies.length === 0));
    assert.equal(document.body.appendChild.mock.callCount(), 0, 'No wake overlay may be appended');
    assert.equal(document.body.requestPointerLock.mock.callCount(), 0);
    assert.ok(document.createElement.mock.calls.every(call => call.arguments[0] === 'canvas'), 'Only procedural texture canvases are needed');
    for (const loader of loaders) assert.ok(loader.mock.callCount() > 0, 'All external loader transports must be stubbed');
    data.dispose();
    disposed = true;
    for (const listener of listeners) assert.equal(listener.mock.callCount(), 0, 'Must never register input listeners, even transiently');
    assert.ok(resources.length > 0);
    for (const { resource, count } of resources) assert.ok(count >= 1, `${resource.type ?? resource.constructor.name} must be disposed`);
  });
}
