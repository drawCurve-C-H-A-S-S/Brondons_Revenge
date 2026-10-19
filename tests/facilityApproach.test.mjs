import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server, createScene, createFacility, siteRules, createMechDuel, createFinaleDirector, immunitySeconds;
let MeleeSwing, traceShot, UnarmedCombatController;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene } = await server.ssrLoadModule('/scenes/level 3/scene17.ts'));
  ({ createScene: createFacility } = await server.ssrLoadModule('/scenes/level 3/scene20.ts'));
  siteRules = await server.ssrLoadModule('/helpers/scene/rescueSite.ts');
  ({ createMechDuel, BOSS_IMMUNITY_SECONDS: immunitySeconds } = await server.ssrLoadModule('/scripts/mechDuel.ts'));
  ({ createFinaleDirector } = await server.ssrLoadModule('/scripts/finaleDirector.ts'));
  ({ MeleeSwing } = await server.ssrLoadModule('/scripts/melee.ts'));
  ({ traceShot } = await server.ssrLoadModule('/scripts/pistol.ts'));
  ({ UnarmedCombatController } = await server.ssrLoadModule('/scripts/unarmedCombat.ts'));
});
after(async () => server?.close());

function asset() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return { scene, animations: ['Idle', 'Walk', 'Hit', 'Attack', 'Charge', 'TurnOff',
    'Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Interact'].map(name => new THREE.AnimationClip(name, 1, [])) };
}
function officeStudent() {
  const result = asset(), pelvis = new THREE.Bone(); pelvis.name = 'pelvis'; pelvis.position.y = 0.6;
  result.scene.add(pelvis);
  result.animations.push(new THREE.AnimationClip('Sitting_Idle_Loop', 1, []),
    new THREE.AnimationClip('Sitting_Talking_Loop', 1, []));
  return result;
}
function dom(t) {
  const old = Object.fromEntries(['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'KeyboardEvent', 'MouseEvent']
    .map(name => [name, globalThis[name]]));
  const context = new Proxy({ measureText: text => ({ width: text.length * 60 }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (target, key) => target[key] ?? (() => {}) });
  class Element extends EventTarget {
    constructor(tag = 'div') {
      super(); this.tag = tag; this.children = []; this.style = { setProperty(name, value) { this[name] = value; } };
      this.ownerDocument = { defaultView: { Element } };
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
  globalThis.document = Object.assign(new EventTarget(), { body, baseURI: 'http://localhost/', hidden: false, pointerLockElement: null,
    getElementById: id => elements.get(id) ?? null, createElement: tag => tag === 'canvas' ? new Canvas() : new Element(tag) });
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => asset());
  t.mock.method(globalThis, 'fetch', async () => new Response('test asset'));
  t.mock.method(THREE.TextureLoader.prototype, 'load', (url, onLoad) => {
    const texture = new THREE.Texture({ width: 1024, height: 768 });
    queueMicrotask(() => onLoad(texture)); return texture;
  });
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

test('real jungle trilobites can be tackled and shot after moving and animating', async t => {
  const json = JSON.parse(await readFile(new URL('../src/assets/models/Tools/Enemy_Trilobite.gltf', import.meta.url), 'utf8'));
  for (const buffer of json.buffers) {
    const bytes = await readFile(new URL(`../src/assets/models/Tools/${buffer.uri}`, import.meta.url));
    buffer.uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
  }
  delete json.materials; delete json.textures; delete json.images;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const oldProgress = globalThis.ProgressEvent;
  globalThis.ProgressEvent = class extends Event {};
  t.after(() => { globalThis.ProgressEvent = oldProgress; });
  const trilobite = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  const { data } = await fixture(t, { loadModel: async name => name === 'Enemy_Trilobite' ? trilobite : asset() });
  t.mock.method(Math, 'random', () => 0.4);
  data.player.setPosition(-57, 0.3, 49);
  step(data, 3.2);
  const bot = data.getDamageTargets().find(item => item.root.name.startsWith('Jungle-robot'));
  assert.ok(bot, 'A real patrol has spawned');
  const enemy = data.robots.find(enemy => enemy.root === bot.root);
  enemy.mixer.stopAllAction();
  enemy.actions.get('Run').reset().play();
  enemy.action = 'Run'; enemy.phase = 'chasing';
  step(data, 0.3);
  // Isolate combat geometry from streamed jungle cover.
  const scene = new THREE.Scene(); scene.add(bot.root);
  bot.root.position.set(0, 0, -1.3); bot.root.rotation.set(0, 0, 0);
  data.player.setPosition(0, 0.3, 0);
  const start = new THREE.Vector3(0, 0.3, 0), end = new THREE.Vector3(0, 0.3, -1.1);
  const swing = new MeleeSwing('tackle', 2, 0.28, 1.8);
  assert.equal(swing.update({ scene, world: null, player: data.player, character: null, targets: [bot] }, { start, end }), true);
  data.updatePhysics(1 / 60);
  assert.notEqual(bot.root.rotation.z, 0, 'Tackle puts the patrol into knockdown');
  bot.root.position.set(0, 0, -3); bot.root.rotation.set(0, 0, 0);
  const bounds = new THREE.Box3().setFromObject(bot.root, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const shot = traceShot(scene, null, new THREE.Ray(new THREE.Vector3(center.x, bounds.max.y - 0.025, 0),
    new THREE.Vector3(0, 0, -1)), [bot]);
  assert.equal(shot.target?.root, bot.root, 'A shot at the visible shell hits the patrol');
  data.scene.add(bot.root);
  data.player.setPosition(-57, 0.3, 49); data.player.setRotation(0);
  enemy.body.position.set(-57, enemy.radius, 46.6); enemy.body.velocity.set(0, 0, 0);
  enemy.phase = 'hit'; enemy.timer = 10;
  step(data, 0.1);
  const combat = new UnarmedCombatController(() => ({ scene: data.scene, world: data.physicsWorld,
    player: data.player, character: null, targets: data.getDamageTargets(), thirdPerson: false,
    unarmed: false, attackClips: [], firstPersonHands: () => null }));
  t.cleanup(() => combat.dispose());
  key('KeyW'); key('ShiftLeft'); step(data, 0.2); key('KeyC');
  assert.equal(data.player.getState().sliding, true, JSON.stringify(data.player.getState()));
  for (let frame = 0; frame < 45; frame++) { data.updatePhysics(1 / 60); combat.update(1 / 60); }
  key('KeyW', 'keyup'); key('ShiftLeft', 'keyup'); key('KeyC', 'keyup');
  assert.equal(enemy.phase, 'stunned', 'Close-range slide reaches knockdown before the collider stops it');
});

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

  test(`optional waterfall locks for its VS and hopping fight, then awards a secret achievement at ${fps} FPS`, async t => {
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
    assert.equal(data.scene.getObjectByName('aegisChest'), undefined);
    assert.equal(data.miniboss.getStatus().achievementUnlocked, true);
    assert.equal(body.querySelector('.secret-achievement').classList.contains('hidden'), false);
    step(data, 6.6, fps);
    assert.equal(body.querySelector('.secret-achievement').classList.contains('hidden'), true);
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

test('secret achievement survives exterior respawning without granting old waterfall immunity', async t => {
  const { data, respawns } = await fixture(t, { entryState: {
    waterfallDefeated: true, waterfallAchievementUnlocked: true, bossImmunityCollected: true } });
  assert.equal(data.miniboss.getStatus().phase, 'defeated');
  assert.equal(data.miniboss.getStatus().achievementUnlocked, true);
  assert.equal(data.scene.getObjectByName('aegisChest'), undefined);
  data.player.takeDamage(1000); data.onPlayerDeath(); step(data, 2.6);
  assert.equal(respawns.length, 1);
  assert.equal(respawns[0].waterfallDefeated, true);
  assert.equal(respawns[0].waterfallAchievementUnlocked, true); assert.equal(respawns[0].bossImmunityCollected, false);
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

test('facility requires E at the glass office before the seated five notice Brondon and end the scene', async t => {
  const { body } = dom(t), finishes = [];
  const entryState = { waterfallDefeated: true, bossImmunityCollected: true,
    cameraPosition: new THREE.Vector3(0, 1.5, -61), cameraQuaternion: new THREE.Quaternion(), cameraFov: 75 };
  const data = createFacility({ entryState, onFinished: state => finishes.push(state), loadModel: async () => asset(),
    loadStudents: async () => officeStudent() });
  t.cleanup(() => data.dispose());
  await data.ready;
  const dialogue = body.querySelector('.facility-dialogue');
  assert.equal(dialogue.children[0].textContent, 'BRONDON');
  assert.equal(dialogue.children[1].textContent, 'This looks more like a resort than a prison.');
  document.body.classList.add('quick-menu-open'); step(data, 4); document.body.classList.remove('quick-menu-open');
  assert.equal(dialogue.children[0].textContent, 'BRONDON', 'arrival exchange pauses with the menu');
  step(data, 0.8); data.player.updateCamera(0);
  assert.ok(data.camera.position.toArray().every(Number.isFinite));
  for (const x of [2, -6, 6, -2]) {
    data.player.setPosition(x, 0.3, -16.6); key('KeyE'); key('KeyE', 'keyup'); data.updatePhysics(1 / 60);
  }
  assert.ok(body.children.some(child => child.textContent.includes('STAIRWELL POWER RESTORED')));
  const office = data.scene.getObjectByName('FacilityGlassOffice');
  assert.ok(office); assert.ok(office.getObjectByName('OfficeMeetingTable'));
  const glass = office.children.filter(node => node.name === 'OfficeGlassPanel' || node.name === 'OfficeGlassDoor');
  assert.equal(glass.length, 10);
  assert.ok(glass.every(node => node.position.z === 4), 'glass must follow the balcony edge, not enclose an inner room');
  assert.equal(office.getObjectByName('OfficeMeetingTable').position.z, -5);
  assert.ok(data.scene.getObjectByName('FacilityObservationLab'), 'Earth upstairs fit-out is present');
  assert.ok(data.scene.getObjectByName('FacilityCoreDisplay'), 'the floating finale core is present in the lab');
  assert.equal(office.children.filter(node => node.children.some(child => child.children.some(grandchild =>
    grandchild.getObjectByName('pelvis')))).length, 5);
  data.player.setPosition(11, 4.5, 5.1); step(data, 3.6);
  assert.equal(finishes.length, 0, 'walking upstairs must not automatically end the scene');
  key('KeyE'); key('KeyE', 'keyup'); assert.equal(data.isCinematic(), true);
  step(data, 6.1);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].bossImmunityCollected, true);
  assert.equal(finishes[0].waterfallDefeated, true);
  assert.equal(finishes[0].cameraPosition, undefined, 'Exterior camera does not leak into the finale');
});

test('earth facility has a real entrance opening, matching exterior coordinates and a planet dome', async t => {
  dom(t);
  const data = createFacility({ onFinished() {}, loadModel: async () => asset(), loadStudents: async () => officeStudent() }); t.cleanup(() => data.dispose());
  await data.ready;
  assert.ok(data.scene.getObjectByName('FacilityHolographicPlanetDome'));
  assert.ok(data.scene.getObjectByName('FacilityEntranceDoor'));
  const upperWindow = data.scene.getObjectByName('FacilityEntranceWindow');
  assert.ok(upperWindow.position.y - upperWindow.geometry.parameters.height / 2 > 3.93,
    'entrance window clears both the door and its sign');
  const roundWindows = [];
  data.scene.traverse(node => { if (node.name === 'FacilityRoundWindow') roundWindows.push(node); });
  assert.equal(roundWindows.length, 4);
  assert.ok(roundWindows.every(node => node.position.y + 0.96 < 3.8), 'round windows clear the mezzanine slab');
  assert.ok(data.scene.getObjectByName('FacilityHideoutWallScreen'));
  assert.equal(data.entrance.frame.z - data.player.body.position.z, 6,
    'spawn must be six metres beyond the door, matching scene 17');
  data.player.setPosition(0, 0.3, 16); step(data, 0.8);
  assert.ok(data.entrance.open > 0.95);
  data.player.setRotation(Math.PI); key('KeyW'); step(data, 0.9); key('KeyW', 'keyup');
  assert.ok(data.player.body.position.z > 18.5, 'the south wall must leave a physically passable doorway');
  assert.ok(data.player.body.position.y > 0.25, 'the entrance vestibule must have a supporting floor');
});

test('facility furniture uses grounded, uniformly scaled models with rotated matching colliders', async t => {
  dom(t);
  const requested = [];
  const data = createFacility({ onFinished() {}, loadStudents: async () => officeStudent(), loadModel: async name => {
    requested.push(name);
    const size = name === 'Prop_Chair' ? [0.88, 1.64, 1.12] : [2.06, 0.94, 1.03];
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
    mesh.position.set(0.2, size[1] / 2, -0.15); scene.add(mesh);
    return { scene };
  } });
  t.cleanup(() => data.dispose()); await data.ready;
  assert.equal(requested.filter(name => name === 'Prop_Desk_Small').length, 8);
  assert.equal(requested.filter(name => name === 'Prop_Chair').length, 13);
  let computers = 0;
  data.scene.traverse(node => { if (node.userData.website) computers++; });
  assert.equal(computers, 8, 'only workstation computer screens may embed the website');
  for (const group of data.scene.children.filter(node => node.name === 'FacilityWorkstation')) {
    for (const name of ['FacilityDesk', 'FacilityChair']) {
      const model = group.getObjectByName(name), bounds = new THREE.Box3().setFromObject(model);
      assert.ok(Math.abs(bounds.min.y) < 1e-6, `${name} must stand on the deck`);
      assert.equal(model.scale.x, model.scale.y); assert.equal(model.scale.y, model.scale.z);
      const center = bounds.getCenter(new THREE.Vector3());
      const body = data.physicsWorld.bodies.find(body => Math.hypot(body.position.x - center.x,
        body.position.y - center.y, body.position.z - center.z) < 1e-6);
      assert.ok(body, `${name} needs a collider matching its rotated position`);
      assert.ok(Math.abs(body.quaternion.y - group.quaternion.y) < 1e-6);
    }
  }
});

test('facility furniture load errors reject readiness rather than silently using box props', async t => {
  dom(t);
  const data = createFacility({ onFinished() {}, loadStudents: async () => officeStudent(),
    loadModel: async () => { throw new Error('missing furniture'); } });
  t.cleanup(() => data.dispose());
  await assert.rejects(data.ready, /Facility furniture failed to load.*missing furniture/);
});

test('facility uses standard portal transfers and chapter loading in both directions', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const handoff = main.slice(main.indexOf('async function loadFacility20('), main.indexOf('async function loadScene21('));
  assert.match(handoff, /activeSceneId === 'scene17'/);
  assert.match(handoff, /onReturn: next => \{ void loadGround17\(next, true\); \}/);
  assert.doesNotMatch(handoff, /seamless|!seamless/);
  const exterior = await readFile(new URL('../src/scenes/level 3/scene17.ts', import.meta.url), 'utf8');
  assert.match(exterior, /door\.setTrigger\(finish\)/);
  assert.match(exterior, /player\.restoreTransition\(entryState\.pilotState, door\.frame\)/);
  assert.doesNotMatch(exterior, /function updateEntry/);
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
