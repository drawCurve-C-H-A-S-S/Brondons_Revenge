import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server, createScene, createFacility, siteRules, createMechDuel, createFinaleDirector, immunitySeconds;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene } = await server.ssrLoadModule('/scenes/level 3/scene17.ts'));
  ({ createScene: createFacility } = await server.ssrLoadModule('/scenes/level 3/scene20.ts'));
  siteRules = await server.ssrLoadModule('/helpers/scene/rescueSite.ts');
  ({ createMechDuel, BOSS_IMMUNITY_SECONDS: immunitySeconds } = await server.ssrLoadModule('/scripts/mechDuel.ts'));
  ({ createFinaleDirector } = await server.ssrLoadModule('/scripts/finaleDirector.ts'));
});
after(async () => server?.close());

function asset() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return { scene, animations: ['Idle', 'Walk', 'Hit', 'Attack', 'Charge', 'TurnOff'].map(name => new THREE.AnimationClip(name, 1, [])) };
}
function dom(t) {
  const old = Object.fromEntries(['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'KeyboardEvent', 'MouseEvent']
    .map(name => [name, globalThis[name]]));
  const context = new Proxy({ measureText: text => ({ width: text.length * 60 }) }, { get: (target, key) => target[key] ?? (() => {}) });
  class Element extends EventTarget {
    constructor(tag = 'div') {
      super(); this.tag = tag; this.children = []; this.style = { setProperty(name, value) { this[name] = value; } };
      this.dataset = {}; this.textContent = ''; this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: (name, force = !this.classes.has(name)) => { if (force) this.classes.add(name); else this.classes.delete(name); return force; },
      };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/)); }
    get className() { return [...this.classes].join(' '); }
    setAttribute(name, value) { this[name] = String(value); }
    append(...elements) { for (const el of elements) { el.remove(); this.children.push(el); el.parent = this; } }
    appendChild(el) { this.append(el); return el; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(el => el !== this); this.parent = null; }
    closest(selector) { return selector.split(',').some(s => s.trim() === this.tag) ? this : null; }
    requestPointerLock() {}
    getContext() { return context; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      return this.children.flatMap(el => [
        ...(selector.startsWith('.') && el.classList.contains(selector.slice(1)) ? [el] : []), ...el.querySelectorAll(selector),
      ]);
    }
  }
  class Canvas extends Element { constructor() { super('canvas'); } }
  class InputEvent extends Event {
    constructor(type, options = {}) {
      super(type, { cancelable: true });
      for (const [key, value] of Object.entries(options)) Object.defineProperty(this, key, { value });
    }
  }
  globalThis.HTMLElement = Element; globalThis.HTMLCanvasElement = Canvas;
  globalThis.KeyboardEvent = globalThis.MouseEvent = InputEvent;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false }) });
  const body = new Element('body'), elements = new Map();
  for (const id of ['space-cinematic-caption', 'loading-bay-status', 'interact-prompt']) {
    const el = new Element(); el.id = id; elements.set(id, el); body.append(el);
  }
  globalThis.document = Object.assign(new EventTarget(), { body, hidden: false, pointerLockElement: null,
    getElementById: id => elements.get(id) ?? null, createElement: tag => tag === 'canvas' ? new Canvas() : new Element(tag) });
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => asset());
  const cleanup = [];
  t.cleanup = fn => cleanup.push(fn);
  t.after(() => { for (const fn of cleanup.reverse()) fn(); Object.assign(globalThis, old); });
  return { body, elements };
}
const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, repeat: false }));
function step(data, seconds, fps = 60) {
  let remaining = seconds;
  while (remaining > 1e-9) { const dt = Math.min(remaining, 1 / fps); data.updatePhysics(dt); remaining -= dt; }
}
async function fixture(t, options = {}) {
  const ui = dom(t), respawns = [], finishes = [];
  const data = createScene({ loadModel: async () => asset(), loadDinosaur: async () => asset(), loadShark: async () => asset(),
    onRespawn: state => respawns.push(state), onFinished: state => finishes.push(state), ...options });
  t.cleanup(() => data.dispose()); await data.ready;
  return { data, respawns, finishes, ...ui };
}
const target = (data, name) => {
  const found = data.getDamageTargets().find(target => target.root.name === name);
  assert.ok(found, `Missing damage target ${name}`); return found;
};

test('one route replaces scenes 18 and 19, including their platform course', async () => {
  const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const main = await source('main.ts'), approach = await source('scenes/level 3/scene17.ts');
  for (const path of ['scenes/level 3/scene18.ts', 'scenes/level 3/scene19.ts', 'helpers/scene/junglePlatformCourse.ts']) {
    await assert.rejects(access(new URL(`../src/${path}`, import.meta.url)), { code: 'ENOENT' });
  }
  assert.doesNotMatch(main, /loadPlatformer18|onPlatformer|scene18\.js|scene19\.js/);
  assert.match(main, /17: \[20\], 20: \[21\]/);
  assert.doesNotMatch(approach, /setSideScrollDepth|breakBridge|PLATFORM_COURSE/);
});

for (const fps of [30, 60, 144]) {
  test(`western half is impassable, bridge stays solid, spiders spawn only beyond it at ${fps} FPS`, async t => {
    const { data } = await fixture(t);
    const { RESCUE_SITE } = siteRules;
    assert.equal(RESCUE_SITE.mountainX, (RESCUE_SITE.west + RESCUE_SITE.east) / 2);
    assert.ok(data.scene.getObjectByName('ImpassableWesternMountain'));
    assert.equal(data.site.isWalkable(-95, 60), false);
    assert.equal(data.site.isWalkable(-95, 17), true, 'Waterfall is the only western opening');
    assert.equal(data.site.isWalkable(-120, 17), false, 'Cave does not bypass the mountain');
    const direction = new THREE.Vector3(0, 0, RESCUE_SITE.doorZ).sub(new THREE.Vector3().copy(data.player.body.position)).setY(0).normalize();
    const forward = new THREE.Vector3(-Math.sin(data.player.getState().yaw), 0, -Math.cos(data.player.getState().yaw));
    assert.ok(direction.dot(forward) > 0.999, 'Spawn faces the facility from the ships');
    assert.equal(data.getDamageTargets().some(item => item.root.name.startsWith('PostBridgeSpiderBot')), false);
    data.player.setPosition(-42, 0.3, 29); data.player.setRotation(0); key('KeyW');
    let minimumHeight = Infinity;
    for (let i = 0; i < Math.ceil(6 * fps); i++) {
      data.updatePhysics(1 / fps);
      minimumHeight = Math.min(minimumHeight, data.player.body.position.y);
      assert.equal(data.isCinematic(), false, 'Crossing never enters a QTE or side camera');
      assert.equal(data.player.body.type, CANNON.Body.DYNAMIC);
    }
    key('KeyW', 'keyup');
    assert.ok(data.player.body.position.z < 10, `Bridge exit reached: ${data.player.body.position.toString()}`);
    assert.ok(minimumHeight > 0.26, 'Bridge and banks stay supported');
    assert.ok(data.site.bridge.visible);
    assert.ok(data.getDamageTargets().some(item => item.root.name.startsWith('PostBridgeSpiderBot')));
    assert.equal(data.sharks.length, 7);
    assert.ok(data.sharks.every(shark => Math.abs(shark.root.position.z - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth));
  });

  test(`optional waterfall locks for its VS and hopping fight, then awards one core at ${fps} FPS`, async t => {
    const { data, body } = await fixture(t);
    assert.equal(data.miniboss.getStatus().phase, 'dormant');
    data.player.setPosition(-88, 0.3, 17); data.updatePhysics(1 / fps);
    assert.equal(data.miniboss.getStatus().phase, 'versus');
    assert.equal(data.site.waterfall.locked, true);
    assert.equal(data.isArenaLocked(), true, 'Teleport cannot bypass the optional arena');
    assert.equal(data.player.isEnabled(), false);
    assert.equal(body.querySelector('.hangar-versus').classList.contains('hidden'), false);
    const time = data.miniboss.getStatus(), camera = data.camera.position.clone();
    data.applyCinematicCamera(); data.applyCinematicCamera();
    assert.deepEqual(data.miniboss.getStatus(), time); assert.ok(data.camera.position.equals(camera));
    step(data, 2.7, fps);
    assert.equal(data.miniboss.getStatus().phase, 'fight'); assert.equal(data.player.isEnabled(), true);
    assert.equal(data.player.body.type, CANNON.Body.DYNAMIC);
    data.player.setRotation(-Math.PI / 2); key('KeyW'); step(data, 0.9, fps); key('KeyW', 'keyup');
    assert.ok(data.player.body.position.x < -84, 'Seal cannot be crossed while the boss lives');
    const boss = target(data, 'WaterfallSpiderRobobot');
    for (const weapon of ['pistol', 'crowbar', 'lightsaber']) assert.equal(boss.damage(25, weapon), true);
    assert.equal(data.miniboss.getStatus().health, 345);
    step(data, 1, fps);
    assert.ok(data.miniboss.body.position.y > 1.4, 'Miniboss actually hops using vertical physics');
    assert.equal(boss.damage(1000, 'lightsaber'), true);
    assert.equal(data.site.waterfall.locked, false);
    const chest = data.scene.getObjectByName('aegisChest'); assert.ok(chest);
    data.player.setPosition(chest.position.x + 1.5, 0.3, chest.position.z);
    key('KeyE'); key('KeyE', 'keyup'); step(data, 1, fps);
    assert.equal(data.miniboss.getStatus().collected, true);
    key('KeyE'); key('KeyE', 'keyup'); step(data, 1, fps);
    assert.equal(data.miniboss.getStatus().collected, true, 'Reward stays single-use');
    assert.equal(data.getDamageTargets().some(item => item.root.name === 'WaterfallSpiderRobobot'), false);
  });
}

test('bullets and returned laser beams destroy ship-styled facility sentinels', async t => {
  const { data } = await fixture(t);
  const first = target(data, 'FacilityShipSentinelLeft'), second = target(data, 'FacilityShipSentinelRight');
  assert.ok(first.root.children.length >= 7, 'Sentinel has ship armor, twin barrels, thrusters and visor');
  assert.equal(first.damage(100, 'pistol'), true);
  assert.equal(first.root.visible, false);
  assert.equal(first.damage(100, 'pistol'), false);
  data.player.setPosition(0, 0.3, -41);
  for (let hit = 0; hit < 2; hit++) {
    let bolt;
    for (let i = 0; i < 240 && !bolt; i++) {
      data.updatePhysics(1 / 60); bolt = data.getParryableBolts().find(bolt => !bolt.parried);
    }
    assert.ok(bolt, 'Alive sentinel fires a parryable beam');
    bolt.velocity.negate(); bolt.owner = 'player'; bolt.parried = true;
    step(data, 0.2);
  }
  assert.equal(second.root.visible, false);
  assert.equal(data.turrets.every(turret => turret.health === 0), true);
  assert.equal(data.getDamageTargets().some(item => item.root.name.startsWith('FacilityShipSentinel')), false);
});

test('skipping the optional fight still enters the facility smoothly and once', async t => {
  const { data, finishes } = await fixture(t);
  for (const item of data.getDamageTargets()) if (item.root.name.startsWith('FacilityShipSentinel')) item.damage(100, 'pistol');
  data.player.setPosition(0, 0.3, -48); data.player.setRotation(0);
  step(data, 0.8); key('KeyW');
  for (let i = 0; i < 120 && !data.isCinematic(); i++) data.updatePhysics(1 / 60);
  key('KeyW', 'keyup');
  assert.equal(data.isCinematic(), true); assert.equal(finishes.length, 0);
  const before = data.camera.position.clone(); data.applyCinematicCamera();
  assert.ok(data.camera.position.distanceTo(before) < 0.001);
  step(data, 1.2); assert.equal(finishes.length, 1);
  assert.equal(finishes[0].waterfallDefeated, false); assert.equal(finishes[0].bossImmunityCollected, false);
  assert.ok(finishes[0].cameraPosition.toArray().every(Number.isFinite));
  step(data, 1); assert.equal(finishes.length, 1);
});

test('miniboss victory and the collected core survive exterior respawning', async t => {
  const { data, respawns } = await fixture(t, { entryState: { waterfallDefeated: true, bossImmunityCollected: true } });
  assert.equal(data.miniboss.getStatus().phase, 'defeated');
  assert.equal(data.miniboss.getStatus().collected, true);
  assert.equal(data.scene.getObjectByName('aegisChest'), undefined);
  data.player.takeDamage(1000); data.onPlayerDeath(); step(data, 2.6);
  assert.equal(respawns.length, 1);
  assert.equal(respawns[0].waterfallDefeated, true); assert.equal(respawns[0].bossImmunityCollected, true);
});

test('waterfall has lit flowing water, shared foam/spray timing, and world-space textured mountain rock', async t => {
  const { data } = await fixture(t);
  const water = data.scene.getObjectByName('RiverWaterfall'), foam = data.scene.getObjectByName('WaterfallImpactFoam');
  const spray = data.scene.getObjectByName('WaterfallSpray');
  assert.equal(water.material.name, 'FlowingWaterfall');
  assert.equal(water.material.fog, true); assert.equal(water.material.transparent, true);
  assert.equal(water.material.depthWrite, false);
  assert.ok(water.geometry.parameters.heightSegments >= 100, 'Flow distorts geometry, not just a flat overlay');
  assert.match(water.material.vertexShader, /sqrt\(2\.0 \* \(down \+ 1\.0\) \/ 9\.82\)/);
  assert.match(water.material.fragmentShader, /fresnel|transmission/);
  assert.doesNotMatch(water.material.fragmentShader, /#include <jungle_water_noise>/, 'Shared water noise is resolved before GPU compilation');
  assert.equal(foam.material.uniforms.uTime, water.material.uniforms.uTime);
  assert.equal(spray.material.uniforms.uTime, water.material.uniforms.uTime);
  assert.equal(spray.isPoints, true); assert.equal(spray.geometry.getAttribute('aSpray').count, 240);
  step(data, 0.5); assert.ok(Math.abs(water.material.uniforms.uTime.value - 0.5) < 1e-6);
  document.body.classList.add('quick-menu-open'); step(data, 0.5);
  assert.ok(Math.abs(water.material.uniforms.uTime.value - 0.5) < 1e-6);
  document.body.classList.remove('quick-menu-open');
  const cliff = data.site.mountain.children.find(child => child.isMesh);
  assert.equal(cliff.material.name, 'WeatheredMountainRock');
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  cliff.material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /mountainSurface\(vRockWorldPosition\)/);
  assert.match(shader.fragmentShader, /rockGradient|mountainBump/);
  assert.match(shader.vertexShader, /vRockWorldPosition = \(modelMatrix/);
});

for (const fps of [30, 60, 144]) test(`submerged sharks show only their tops and swarm before killing at ${fps} FPS`, async t => {
  const { data, respawns } = await fixture(t);
  for (const shark of data.sharks) {
    const bounds = new THREE.Box3().setFromObject(shark.root);
    assert.ok(bounds.max.y > siteRules.RESCUE_SITE.riverY);
    assert.ok(bounds.max.y - siteRules.RESCUE_SITE.riverY <= 0.15, 'Only the fin/top peeks out');
    assert.ok(bounds.min.y < siteRules.RESCUE_SITE.riverY - 0.5);
  }
  data.player.setPosition(-45, -1.55, 17);
  const start = data.sharks.map(shark => shark.root.position.clone());
  data.updatePhysics(1 / fps);
  assert.equal(data.getRiverStatus().swarming, true);
  assert.equal(data.getRiverStatus().sharks, 4); assert.equal(data.player.getHealth(), 100);
  assert.equal(data.getCinematicPose().swimming, true);
  step(data, 2.5, fps);
  assert.equal(data.player.getHealth(), 100, 'The swarm is visible before any fatal hit');
  assert.ok(data.sharks.filter((shark, i) => shark.root.position.distanceTo(start[i]) > 2).length >= 3);
  const before = data.camera.position.clone(); data.applyCinematicCamera(); data.applyCinematicCamera();
  assert.ok(data.camera.position.equals(before), 'Applying the stored swarm shot is idempotent');
  document.body.classList.add('quick-menu-open'); const time = data.getRiverStatus().time; step(data, 1, fps);
  assert.equal(data.getRiverStatus().time, time); document.body.classList.remove('quick-menu-open');
  step(data, 1.8, fps); assert.equal(data.player.getHealth(), 0);
  assert.equal(respawns.length, 0, 'Death animation completes before the checkpoint loads');
  step(data, 2.6, fps); assert.equal(respawns.length, 1);
  step(data, 1, fps); assert.equal(respawns.length, 1);
});

test('facility entry speaks Prime dialogue, blends its view, pauses, and passes the core onward', t => {
  const { body } = dom(t), finishes = [];
  const entryState = { waterfallDefeated: true, bossImmunityCollected: true,
    cameraPosition: new THREE.Vector3(0, 1.5, -61), cameraQuaternion: new THREE.Quaternion(), cameraFov: 75 };
  const data = createFacility({ entryState, onFinished: state => finishes.push(state) });
  t.cleanup(() => data.dispose());
  assert.ok(body.children.some(child => child.textContent === 'PRIME: I expected more security.'));
  data.applyEntryCamera(); assert.ok(data.camera.position.distanceTo(new THREE.Vector3(0, 1.5, 10)) < 1e-6);
  document.body.classList.add('quick-menu-open'); step(data, 4); document.body.classList.remove('quick-menu-open');
  assert.ok(body.children.some(child => child.textContent.startsWith('PRIME:') && child.style.display === 'block'));
  step(data, 0.8); data.player.updateCamera(0); data.applyEntryCamera();
  assert.ok(data.camera.position.toArray().every(Number.isFinite));
  for (const x of [-6, -2, 2, 6]) {
    data.player.setPosition(x, 0.3, -16.6); key('KeyE'); key('KeyE', 'keyup'); data.updatePhysics(1 / 60);
  }
  assert.ok(body.children.some(child => child.textContent.includes('STAIRWELL POWER RESTORED')));
  data.player.setPosition(0, 4.5, -16); step(data, 3.6);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].bossImmunityCollected, true);
  assert.equal(finishes[0].waterfallDefeated, true);
  assert.equal(finishes[0].cameraPosition, undefined, 'Exterior camera does not leak into the finale');
});

test('Aegis grants exactly thirty seconds, is not cancelled by boost, and cannot be used twice', () => {
  assert.equal(immunitySeconds, 30);
  const duel = createMechDuel('ground', { bossImmunityAvailable: true });
  assert.equal(duel.activateBossImmunity(), true); assert.equal(duel.activateBossImmunity(), false);
  const health = duel.hero.health;
  for (let i = 0; i < 2990; i++) {
    if (i % 100 === 0) duel.act('dash');
    duel.update(0.01);
  }
  assert.equal(duel.hero.health, health);
  assert.ok(Math.abs(duel.getState().bossImmunityRemaining - 0.1) < 1e-6);
  duel.update(0.1); assert.ok(duel.getState().bossImmunityRemaining < 1e-6);
  assert.equal(duel.activateBossImmunity(), false);
  const retry = createMechDuel('ground', { bossImmunityAvailable: true, bossImmunityUsed: duel.getState().bossImmunityUsed });
  assert.equal(retry.activateBossImmunity(), false);
});

test('finale activates the core at combat, not during the intro, and preserves use in its checkpoint', () => {
  const director = createFinaleDirector('ground', { bossImmunityAvailable: true });
  director.assetsLoaded(); assert.equal(director.getState().phase, 'versus');
  assert.equal(director.duel.getState().bossImmunityRemaining, 0);
  for (let i = 0; i < 47; i++) director.update(0.1);
  assert.equal(director.getState().phase, 'ground');
  assert.ok(director.duel.getState().bossImmunityRemaining > 29.8);
  assert.equal(director.getCheckpoint().bossImmunityUsed, true);
  director.pause(true); const remaining = director.duel.getState().bossImmunityRemaining;
  director.update(0.1); assert.equal(director.duel.getState().bossImmunityRemaining, remaining);
});
