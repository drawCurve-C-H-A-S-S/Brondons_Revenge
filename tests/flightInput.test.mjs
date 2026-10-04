import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, THREE, createScene, hitRadius, openingRules, versusDuration;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{
      name: 'flight-input-deps',
      resolveId: id => id === 'virtual:flight-input-deps' ? '\0flight-input-deps' : null,
      load: id => id === '\0flight-input-deps' ? "export * as THREE from 'three';" : null,
    }] });
  ({ THREE } = await server.ssrLoadModule('virtual:flight-input-deps'));
  ({ createScene, OPENING_INTERCEPTOR_HIT_RADIUS: hitRadius, FLIGHT_OPENING_RULES: openingRules } = await server.ssrLoadModule('/scenes/level 2/scene15.ts'));
  ({ FLIGHT_VERSUS_DURATION: versusDuration } = await server.ssrLoadModule('/helpers/scene/flightVersus.ts'));
});
after(async () => server?.close());

function fixture(t, startAt, entryState) {
  const names = ['window', 'document', 'HTMLElement', 'Audio', 'self'];
  const old = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  const context = new Proxy({
    measureText: text => ({ width: text.length * 16 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, name) => name in target ? target[name] : () => {} });
  class Element extends EventTarget {
    style = { setProperty(name, value) { this[name] = value; } };
    dataset = {}; classes = new Set(); children = []; textContent = '';
    classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, value) => { this.classList[value ? 'add' : 'remove'](name); return value; },
    };
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
    setAttribute(name, value) { this[name] = String(value); }
    closest() { return null; }
    getContext() { return context; }
    requestPointerLock() {}
  }
  globalThis.HTMLElement = Element; globalThis.self = globalThis;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  const elements = new Map();
  globalThis.document = Object.assign(new EventTarget(), {
    body: new Element(), hidden: false, pointerLockElement: null, baseURI: 'http://localhost:5173/',
    createElement: () => new Element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
  });
  globalThis.Audio = class extends EventTarget {
    load() {}
    pause() {}
    play() { return Promise.resolve(); }
  };
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const data = createScene({ startAt, entryState, onTransition() {} });
  t.after(() => { data.dispose(); Object.assign(globalThis, old); });
  return data;
}
function step(data, seconds, fps = 60) {
  for (let index = 0; index < Math.ceil(seconds * fps); index++) data.updatePhysics(1 / fps);
}
function key(code, repeat = false) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  window.dispatchEvent(event);
}
function mouse(type) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { button: { value: 0 }, clientX: { value: 640 }, clientY: { value: 360 } });
  window.dispatchEvent(event);
}
function click() { mouse('mousedown'); mouse('mouseup'); }

test('only opening interceptors get the eight-unit invisible shot target', t => {
  const data = fixture(t);
  step(data, openingRules.solo + openingRules.carrierFade + versusDuration + 0.05);
  const target = data.scene.getObjectByName('OpeningInterceptorShotTarget');
  assert.ok(target);
  assert.equal(hitRadius, 8);
  assert.equal(target.material.visible, false);
  assert.equal(target.geometry.parameters.radius * target.getWorldScale(new THREE.Vector3()).x, hitRadius);
});

test('scene 14 handoff flies solo for two seconds, fades in the distant carrier, then plays VS before combat', t => {
  const launch = { shipPosition: new THREE.Vector3(5, 3, 110),
    shipQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, Math.PI, -0.04)),
    cameraPosition: new THREE.Vector3(3, 10, 80),
    cameraQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, Math.PI, -0.02)),
    cameraFov: 62, speed: 35 };
  const entryState = { position: { x: 0, y: 0.3, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0,
    heldKeys: [], intentionalJump: false, jumpQueued: false, bobTime: 0, bobIntensity: 0, crouching: false, sprinting: false, launch };
  const data = fixture(t, undefined, entryState), boss = data.scene.getObjectByName('CapitalShip');
  assert.equal(data.getFlightStatus().phase, 'opening');
  assert.ok(data.ship.root.position.equals(launch.shipPosition));
  assert.ok(data.ship.root.quaternion.angleTo(launch.shipQuaternion) < 1e-6);
  assert.ok(data.camera.position.equals(launch.cameraPosition), 'No camera teleport at the scene boundary');
  assert.ok(data.camera.quaternion.angleTo(launch.cameraQuaternion) < 1e-6);
  assert.equal(data.camera.fov, launch.cameraFov);
  assert.equal(boss.visible, false);
  assert.equal(data.controlsReady(), false);
  key('KeyW'); key('Space'); click(); step(data, 1.95);
  assert.equal(boss.visible, false, 'Shuttle must be alone for the full two-second opening');
  assert.equal(data.getFlightStatus().spawned, 0);
  assert.equal(data.getFlightStatus().shotsFired, 0);
  assert.ok(data.ship.root.position.z > launch.shipPosition.z + 100, 'The launch must keep moving, not freeze for VS');
  assert.equal(data.ship.root.position.x, launch.shipPosition.x, 'Cinematic input must not steer the ship');
  step(data, 0.65);
  assert.equal(data.getFlightStatus().phase, 'opening');
  assert.equal(boss.visible, true);
  const hull = boss.children.find(node => node.isMesh).material;
  assert.ok(hull.opacity > 0 && hull.opacity < 1, 'Carrier must fade, not pop into view');
  assert.ok(boss.position.z - data.ship.root.position.z > 1000, 'Reveal starts in the distance');
  step(data, 0.7);
  assert.equal(data.getFlightStatus().phase, 'versus');
  assert.equal(hull.opacity, 1);
  assert.equal(hull.transparent, false, 'Restore opaque combat materials after the fade');
  assert.equal(document.body.classList.contains('flight-versus-active'), true);
  const pose = data.ship.root.position.clone();
  click(); key('KeyV'); step(data, versusDuration - 0.15);
  assert.ok(data.ship.root.position.equals(pose), 'Actual combat must remain frozen during the montage');
  assert.equal(data.getFlightStatus().shotsFired, 0);
  assert.equal(data.getFlightStatus().playerHp, 260);
  assert.equal(data.getFlightStatus().cockpitView, false);
  step(data, 0.2);
  assert.equal(data.getFlightStatus().phase, 'combat');
  assert.equal(data.controlsReady(), true);
  assert.equal(document.body.classList.contains('flight-versus-active'), false);
  assert.equal(document.body.classList.contains('flight-intro-active'), false);
  assert.equal(data.getFlightStatus().shotsFired, 0, 'Intro presses cannot leak into combat');
  assert.ok(data.getFlightStatus().spawned >= 1);
  click(); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().shotsFired, 1, 'Normal combat firing resumes');
});

test('pause and menus freeze both the launch reveal and VS, and Enter skips without firing', t => {
  const data = fixture(t); step(data, 0.7);
  window.dispatchEvent(new Event('blur'));
  const opening = data.getFlightStatus().introTime, pose = data.ship.root.position.clone();
  step(data, 1);
  assert.equal(data.getFlightStatus().introTime, opening);
  assert.ok(data.ship.root.position.equals(pose));
  key('Escape'); step(data, 2.7);
  assert.equal(data.getFlightStatus().phase, 'versus');
  document.body.classList.add('quick-menu-open');
  const versus = data.getFlightStatus().introTime;
  step(data, 1); key('Enter');
  assert.equal(data.getFlightStatus().phase, 'versus');
  assert.equal(data.getFlightStatus().introTime, versus);
  document.body.classList.remove('quick-menu-open'); data.setMenuPaused(false);
  key('Escape'); key('Enter'); step(data, 0.4);
  assert.equal(data.getFlightStatus().phase, 'versus', 'Paused VS cannot be skipped');
  key('Escape'); key('Enter');
  assert.equal(data.getFlightStatus().phase, 'combat');
  assert.equal(data.getFlightStatus().shotsFired, 0);
  step(data, 0.2);
  assert.equal(data.getFlightStatus().shotsFired, 0);
});

for (const fps of [30, 120]) {
  test(`${fps} Hz opening preserves the solo/fade/versus timing`, t => {
    const data = fixture(t);
    step(data, openingRules.solo - 0.1, fps);
    assert.equal(data.scene.getObjectByName('CapitalShip').visible, false);
    step(data, openingRules.carrierFade + 0.2, fps);
    assert.equal(data.getFlightStatus().phase, 'versus');
    step(data, versusDuration - 0.2, fps);
    assert.equal(data.getFlightStatus().phase, 'versus');
    step(data, 0.25, fps);
    assert.equal(data.getFlightStatus().phase, 'combat');
  });
}

test('VS renders the real shuttle, carrier and six interceptors without changing renderer state or live assets', t => {
  const data = fixture(t); step(data, openingRules.solo + openingRules.carrierFade + 1.6);
  const livePose = data.ship.root.position.clone();
  let sourceDisposals = 0;
  const sourceGeometry = data.ship.root.children.find(node => node.isMesh).geometry;
  sourceGeometry.addEventListener('dispose', () => sourceDisposals++);
  const viewport = new THREE.Vector4(7, 9, 23, 31), scissor = new THREE.Vector4(4, 6, 15, 17), color = new THREE.Color(0x123456);
  const renderer = { autoClear: true, shadowMap: { autoUpdate: true }, scissorTest: false, alpha: 0.7,
    size: new THREE.Vector2(1280, 720), viewport: viewport.clone(), scissor: scissor.clone(), color: color.clone(), draws: [],
    getSize(out) { return out.copy(this.size); }, getViewport(out) { return out.copy(this.viewport); },
    getScissor(out) { return out.copy(this.scissor); }, getClearColor(out) { return out.copy(this.color); },
    getScissorTest() { return this.scissorTest; }, getClearAlpha() { return this.alpha; },
    setViewport(...args) { args[0]?.isVector4 ? this.viewport.copy(args[0]) : this.viewport.set(...args); },
    setScissor(...args) { args[0]?.isVector4 ? this.scissor.copy(args[0]) : this.scissor.set(...args); },
    setScissorTest(value) { this.scissorTest = value; }, setClearColor(value, alpha) { this.color.set(value); this.alpha = alpha; },
    clear() {}, render(scene, camera) { camera.updateMatrixWorld(true); scene.updateMatrixWorld(true); this.draws.push({ scene, camera, rect: this.viewport.clone() }); },
  };
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    renderer.size.set(width, height); renderer.draws.length = 0; data.renderCinematicOverlay(renderer);
    assert.equal(renderer.draws.length, 2);
    const [player, enemy] = renderer.draws;
    assert.ok(player.scene.getObjectByName('EscapeShuttle'), 'Use the gameplay shuttle, not a replacement icon');
    assert.ok(enemy.scene.getObjectByName('CapitalShip'));
    for (let index = 1; index <= 6; index++) assert.ok(enemy.scene.getObjectByName(`VersusInterceptor-${index}`));
    if (width > height) {
      assert.deepEqual(player.rect.toArray(), [0, 0, width / 2, height]);
      assert.deepEqual(enemy.rect.toArray(), [width / 2, 0, width / 2, height]);
    } else {
      assert.deepEqual(player.rect.toArray(), [0, height / 2, width, height / 2]);
      assert.deepEqual(enemy.rect.toArray(), [0, 0, width, height / 2]);
    }
    for (const draw of renderer.draws) {
      const names = draw === player ? ['VersusEscapeShuttle'] : ['VersusCapitalShip', ...Array.from({ length: 6 }, (_, i) => `VersusInterceptor-${i + 1}`)];
      for (const name of names) {
        const bounds = new THREE.Box3().setFromObject(draw.scene.getObjectByName(name));
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).project(draw.camera);
          assert.ok(Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1, `${name} must fit the ${width}x${height} panel`);
        }
      }
    }
    assert.ok(renderer.viewport.equals(viewport)); assert.ok(renderer.scissor.equals(scissor)); assert.ok(renderer.color.equals(color));
    assert.equal(renderer.alpha, 0.7); assert.equal(renderer.autoClear, true); assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.scissorTest, false);
  }
  const render = renderer.render; renderer.render = () => { throw new Error('Draw failed'); };
  assert.throws(() => data.renderCinematicOverlay(renderer), /Draw failed/);
  assert.ok(renderer.viewport.equals(viewport)); assert.ok(renderer.scissor.equals(scissor)); assert.ok(renderer.color.equals(color));
  assert.equal(renderer.autoClear, true); assert.equal(renderer.shadowMap.autoUpdate, true);
  renderer.render = render; key('Enter');
  assert.equal(sourceDisposals, 0, 'Disposing preview geometry must not dispose live ship assets');
  assert.ok(data.ship.root.position.equals(livePose));
  renderer.draws.length = 0; data.renderCinematicOverlay(renderer);
  assert.equal(renderer.draws.length, 0);
});

test('a top-down click released before the update still fires exactly once', t => {
  const data = fixture(t, 'topdownScrambler'); step(data, 4.9);
  assert.equal(data.getFlightStatus().scramblerStage, 'fight');
  assert.equal(data.scene.getObjectByName('OpeningInterceptorShotTarget'), undefined);
  const before = data.getFlightStatus().shotsFired;
  click(); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().shotsFired, before + 1);
  step(data, 0.15);
  assert.equal(data.getFlightStatus().shotsFired, before + 1, 'Released input must not become held autofire');
});

test('a second short click waits for cooldown without getting lost or bypassing fire rate', t => {
  const data = fixture(t, 'topdownScrambler'); step(data, 4.9);
  click(); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().shotsFired, 1);
  click(); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().shotsFired, 1);
  step(data, 0.1);
  assert.equal(data.getFlightStatus().shotsFired, 2);
});

test('holding fire keeps the existing cooldown cadence and releasing stops it', t => {
  const data = fixture(t, 'topdownScrambler'); step(data, 4.9);
  mouse('mousedown'); step(data, 0.36);
  assert.equal(data.getFlightStatus().shotsFired, 4);
  mouse('mouseup'); step(data, 0.2);
  assert.equal(data.getFlightStatus().shotsFired, 4);
});

test('pause and phase input resets discard a queued shot', t => {
  const data = fixture(t, 'topdownScrambler'); step(data, 4.9);
  click(); data.clearInput(); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().shotsFired, 0);
  click(); window.dispatchEvent(new Event('blur')); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().paused, true);
  assert.equal(data.getFlightStatus().shotsFired, 0);
  data.setMenuPaused(false); data.updatePhysics(1 / 60);
  assert.equal(data.getFlightStatus().shotsFired, 0);
});
