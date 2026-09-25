import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server, createScene, createPassage, createPuzzleState, traceShot, CrowbarController, rules, boyData;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene } = await server.ssrLoadModule('/scenes/level 1/scene13.ts'));
  ({ createScene: createPassage } = await server.ssrLoadModule('/scenes/level 1/scene12.ts'));
  ({ createCargoPuzzleState: createPuzzleState } = await server.ssrLoadModule('/scripts/cargoPuzzle.ts'));
  ({ traceShot } = await server.ssrLoadModule('/scripts/pistol.ts'));
  ({ CrowbarController } = await server.ssrLoadModule('/scripts/crowbar.ts'));
  ({ BOSS_RULES: rules } = await server.ssrLoadModule('/scripts/loadingBayBoss.ts'));
  const buffer = await readFile(new URL('../src/assets/models/boy.glb', import.meta.url));
  boyData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});
after(async () => server?.close());
function loadBoy() {
  const loader = new GLTFLoader();
  // Keep the actual GLB meshes, skeleton and clips; only browser image decoding is stubbed.
  loader.register(() => ({ name: 'NodeImageTransport', loadTexture: async () => new THREE.Texture() }));
  return loader.parseAsync(boyData.slice(0), '');
}
function browser(t) {
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, self: globalThis.self };
  const elements = new Map();
  globalThis.HTMLElement = class {};
  globalThis.self = globalThis;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { body: { requestPointerLock() {} }, pointerLockElement: null,
    getElementById(id) {
      if (!elements.has(id)) { const classes = new Set(['hidden']); elements.set(id, { style: {}, dataset: {}, textContent: '', classList: {
        add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: n => classes.has(n), toggle(n, active) { if (active) classes.add(n); else classes.delete(n); },
      } }); }
      return elements.get(id);
    }, createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }) });
  const cleanups = []; t.cleanup = fn => cleanups.push(fn);
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); Object.assign(globalThis, old); });
  return elements;
}
async function fixture(t, options = {}) {
  const elements = browser(t), data = createScene({ loadBoy, ...options });
  t.cleanup(() => data.dispose()); await data.ready; return { data, elements };
}
function step(data, seconds, fps = 60) { for (let i = 0; i < Math.round(seconds * fps); i++) data.updatePhysics(1 / fps, true); }
function key(code, type = 'keydown') { const e = new Event(type); Object.defineProperties(e, { code: { value: code }, repeat: { value: false } }); window.dispatchEvent(e); }
function down(data, fps = 60) {
  for (const target of data.boss.targets) while (target.hits()) assert.equal(target.damage(25, 'pistol'), true);
  assert.equal(data.boss.getStatus().phase, 'falling'); step(data, 0.9, fps); assert.equal(data.boss.getStatus().phase, 'exposed');
}
function cover(data) { data.player.setPosition(16.5, 0.3, 19); }

for (const fps of [30, 60, 144]) {
  test(`Stair intro owns camera and animation, preserves health and releases controls at ${fps} FPS`, async t => {
    const { data, elements } = await fixture(t);
    assert.equal(data.player.isEnabled(), false); assert.equal(data.isCinematic(), true);
    assert.equal(data.getCinematicState().isMoving, true); assert.equal(data.boss.getStatus().phase, 'dormant');
    assert.equal(data.boss.targets[0].damage(25, 'pistol'), false);
    const start = data.player.body.position.clone(); key('KeyA'); key('Space');
    step(data, 3, fps); assert.ok(data.player.body.position.y < start.y - 0.5); assert.ok(Math.abs(data.player.body.position.x) < 0.01);
    assert.ok(data.camera.position.z > -24); assert.equal(data.player.getHealth(), 100);
    step(data, 4.2, fps); key('KeyA', 'keyup'); key('Space', 'keyup');
    assert.equal(data.isCinematic(), false); assert.equal(data.player.body.type, CANNON.Body.DYNAMIC);
    assert.equal(data.player.isEnabled(), true); assert.equal(data.boss.getStatus().phase, 'flying');
    assert.ok(Math.abs(data.player.body.position.y - 0.3) < 0.03); assert.equal(data.player.getState().isOnGround, true);
    assert.equal(elements.get('boss-hud').classList.contains('hidden'), false);
    key('KeyW'); step(data, 0.3, fps); key('KeyW', 'keyup'); assert.ok(data.player.body.position.z > -9.3);
  });
  test(`Four targets, 10-second head window and two-hit subsequent rounds at ${fps} FPS`, async t => {
    const { data } = await fixture(t); step(data, 7.2, fps); cover(data);
    assert.equal(data.boss.headTarget.damage(35, 'crowbar'), false);
    assert.equal(data.boss.targets[0].damage(35, 'crowbar'), false);
    assert.equal(data.boss.targets[0].damage(NaN, 'pistol'), false);
    down(data, fps); assert.equal(data.boss.getStatus().health, rules.health);
    assert.equal(data.boss.headTarget.damage(25, 'pistol'), false);
    assert.equal(data.boss.headTarget.damage(35, 'crowbar'), true);
    assert.equal(data.boss.getStatus().health, rules.health - rules.headDamage);
    assert.equal(data.boss.headTarget.damage(35, 'crowbar'), false, 'stagger prevents click-spam damage');
    step(data, 9.7, fps); assert.equal(data.boss.getStatus().phase, 'exposed');
    step(data, 0.4, fps); assert.equal(data.boss.getStatus().phase, 'rising');
    assert.equal(data.boss.headTarget.damage(35, 'crowbar'), false);
    step(data, 1.3, fps); assert.equal(data.boss.getStatus().phase, 'flying'); assert.equal(data.boss.getStatus().round, 2);
    assert.deepEqual(data.boss.getStatus().targets, [2, 2, 2, 2]);
    for (const target of data.boss.targets) assert.equal(target.damage(25, 'pistol'), true);
    assert.equal(data.boss.getStatus().phase, 'flying'); assert.deepEqual(data.boss.getStatus().targets, [1, 1, 1, 1]);
    down(data, fps); assert.equal(data.boss.getStatus().health, rules.health - rules.headDamage);
  });
  test(`Green lasers hit a stationary player, can be dodged, and stop at all four pillars at ${fps} FPS`, async t => {
    const { data } = await fixture(t); step(data, 7.1, fps); data.player.setPosition(0, 0.3, 10);
    step(data, 3, fps); assert.ok(data.player.getHealth() < 100, 'uncovered stationary player takes a laser hit');
    data.player.heal(100); data.player.setPosition(0, 0.3, 10);
    while (!data.boss.getStatus().charging) step(data, 1 / fps, fps);
    key('KeyA'); step(data, 1.5, fps); key('KeyA', 'keyup');
    assert.equal(data.player.getHealth(), 100, 'a bolt never homes after aim is locked');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      data.player.setPosition(sx * 16.5, 0.3, sz * 19); data.player.heal(100); step(data, 5, fps);
      assert.equal(data.player.getHealth(), 100, `pillar ${sx},${sz} blocks lasers`);
    }
    assert.equal(data.boss.root.position.x, 0); assert.equal(data.boss.root.position.z, 0);
  });
}

test('Targets remain unobstructed as the boss faces the player around the entire room', async t => {
  const { data } = await fixture(t); step(data, 7.1);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    data.player.setPosition(Math.sin(angle) * 9, 0.3, Math.cos(angle) * 9); step(data, 1 / 60);
    const from = new THREE.Vector3(data.player.body.position.x, 1.6, data.player.body.position.z);
    for (const target of data.boss.targets) {
      const to = target.root.getWorldPosition(new THREE.Vector3());
      const shot = traceShot(data.scene, data.physicsWorld, new THREE.Ray(from, to.sub(from).normalize()), data.getDamageTargets());
      assert.equal(shot.target?.root, target.root, `unobstructed target at angle ${angle}`);
    }
  }
});

test('Goggles reveal the head in yellow; real crowbar reaches it without goggles in either view', async t => {
  const { data, elements } = await fixture(t); step(data, 7.1); cover(data); down(data);
  const ordinary = data.boss.head.material; data.setGogglesActive(true); assert.equal(data.boss.head.material.color.getHex(), 0xffd126);
  data.setGogglesActive(false); assert.equal(data.boss.head.material, ordinary);
  let thirdPerson = false;
  const weapon = new CrowbarController(() => ({ scene: data.scene, camera: data.camera, world: data.physicsWorld, player: data.player, character: null,
    thirdPerson, hasCrowbar: true, targets: data.getDamageTargets(), setCharacterEquipped() {}, openDoor() {}, doorTarget: null }));
  t.cleanup(() => weapon.dispose()); weapon.equip();
  const head = data.boss.head.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(Math.sin(data.boss.root.rotation.y), 0, Math.cos(data.boss.root.rotation.y));
  const p = head.clone().addScaledVector(forward, 2); data.player.setPosition(p.x, 0.3, p.z);
  for (const view of [false, true]) {
    thirdPerson = view; data.camera.position.set(p.x, 1.6, p.z); if (view) data.camera.position.addScaledVector(forward, 1.5);
    data.camera.lookAt(head); data.camera.updateMatrixWorld(true);
    const health = data.boss.getStatus().health; weapon.swing();
    assert.equal(data.boss.getStatus().health, health - rules.headDamage, `physical melee in ${view ? 'third' : 'first'} person`);
    step(data, 1.1); for (let i = 0; i < 4; i++) weapon.update(0.1);
  }
  assert.match(elements.get('boss-health-label').textContent, /BAY WARDEN/);
});

test('Defeat fades black particles, reveals the actual boy.glb, thanks player and restores control', async t => {
  let completed = 0;
  const { data, elements } = await fixture(t, { onDefeated: () => completed++ }); step(data, 7.1); cover(data);
  const boy = data.scene.getObjectByName('FreedBoy'); assert.ok(boy); assert.equal(boy.visible, false);
  assert.ok(boy.getObjectsByProperty('isMesh', true).length > 0, 'real GLB mesh loaded');
  const requiredHits = Math.ceil(rules.health / rules.headDamage);
  let hits = 0;
  for (let attempts = 0; attempts < requiredHits * 2 && data.boss.getStatus().health > 0; attempts++) {
    if (data.boss.getStatus().phase === 'flying') down(data);
    if (data.boss.getStatus().phase === 'exposed' && data.boss.headTarget.damage(35, 'crowbar')) hits++;
    step(data, rules.headCooldown + 0.1);
  }
  assert.equal(hits, requiredHits, 'Defeat requires the configured number of accepted melee hits');
  assert.equal(data.boss.getStatus().health, 0, JSON.stringify(data.boss.getStatus()));
  assert.equal(data.isCinematic(), true); assert.equal(data.player.isEnabled(), false); assert.equal(boy.visible, true);
  const cloud = data.scene.getObjectByName('BossBlackParticles'); assert.equal(cloud.visible, true);
  assert.equal(data.getDamageTargets().length, 0); assert.equal(data.boss.getStatus().projectiles, 0);
  step(data, 3); assert.ok(cloud.material.opacity < 0.05); assert.match(elements.get('boss-subtitles').textContent, /Thank you for defeating/);
  step(data, 6); assert.match(elements.get('boss-subtitles').textContent, /AI took your friends to the nearest planet/);
  assert.equal(completed, 0); assert.equal(data.player.isEnabled(), false);
  step(data, 6); assert.match(elements.get('boss-subtitles').textContent, /Use the console/);
  step(data, 6); assert.equal(completed, 1); assert.equal(data.isCinematic(), false); assert.equal(data.player.isEnabled(), true); assert.equal(cloud.visible, false);
  assert.equal(elements.get('boss-hud').classList.contains('hidden'), true);
  step(data, 2); assert.equal(completed, 1);
  data.dispose(); assert.equal(data.physicsWorld.bodies.length, 0);
  const next = createScene({ defeated: true, loadBoy }); t.cleanup(() => next.dispose()); await next.ready;
  assert.equal(next.isCinematic(), false); assert.equal(next.getDamageTargets().length, 0); assert.equal(next.scene.getObjectByName('FreedBoy').visible, true);
});

for (const fps of [30, 60, 144]) {
  test(`Lift supports standing, walking and jumping; console E carries player down at ${fps} FPS`, async t => {
    let calls = 0, transfer;
    const { data, elements } = await fixture(t, { defeated: true, checkpoint: true, onDescend: state => { calls++; transfer = state; } });
    assert.equal(data.elevator.body.type, CANNON.Body.STATIC);
    key('KeyE'); step(data, 0.1, fps); assert.equal(data.getLiftStatus().descending, false, 'E from checkpoint is too far away');
    // Cross the deck/lift seam without teleporting onto a hidden fallback floor.
    data.player.setPosition(1.4, 0.3, -5.5); data.player.setRotation(Math.PI);
    key('KeyW'); step(data, 1.3, fps); key('KeyW', 'keyup'); step(data, 3, fps);
    assert.ok(Math.abs(data.player.body.position.z) < 0.3);
    assert.ok(Math.abs(data.player.body.position.y - 0.3) < 0.025);
    assert.equal(data.player.getState().isOnGround, true);
    for (const [x, z] of [[0, 0], [4.1, 0], [-4.1, 0], [0, 4.1], [2.9, -2.9]]) {
      data.player.setPosition(x, 0.3, z); step(data, 1, fps);
      assert.ok(Math.abs(data.player.body.position.y - 0.3) < 0.025, `solid lift at ${x},${z}`);
      assert.equal(data.player.getState().isOnGround, true);
    }
    data.player.setPosition(0, 0.3, 0); step(data, 0.1, fps);
    key('Space'); step(data, 0.3, fps); key('Space', 'keyup');
    assert.ok(data.player.body.position.y > 0.8, 'jump starts from the physical platform');
    step(data, 1.2, fps); assert.equal(data.player.getState().isOnGround, true);
    assert.ok(Math.abs(data.player.body.position.y - 0.3) < 0.025);
    data.player.setPosition(0, 0.3, -3.8); step(data, 0.2, fps); data.player.takeDamage(17);
    assert.equal(data.getLiftStatus().canInteract, true);
    assert.equal(elements.get('interact-prompt').classList.contains('hidden'), false);
    assert.match(elements.get('interact-prompt').textContent, /Press E to interact/);
    key('KeyE'); assert.equal(data.getLiftStatus().descending, true);
    assert.equal(data.player.isEnabled(), false); assert.equal(data.elevator.body.type, CANNON.Body.KINEMATIC);
    for (let frame = 0; frame < Math.round(4.9 * fps); frame++) {
      data.updatePhysics(1 / fps);
      assert.ok(Math.abs(data.player.body.position.y - data.elevator.platform.position.y - data.player.radius) < 0.001);
      assert.ok(Math.abs(data.elevator.body.position.y - data.elevator.platform.position.y + 0.2) < 0.001);
      assert.ok(Math.abs(data.elevator.consoleBody.position.y - data.elevator.platform.position.y - 0.65) < 0.001);
    }
    key('KeyE'); step(data, 1, fps);
    assert.equal(calls, 1); assert.equal(transfer.health, 83);
    assert.ok(Math.abs(transfer.position.y - data.player.radius) < 0.001);
    assert.ok(Math.abs(data.elevator.platform.position.y + 12) < 0.001);
  });
}

test('Player can physically climb back to passage 12 and return through the raised doorway', async t => {
  const puzzle = createPuzzleState(12); puzzle.exitUnlocked = true;
  const { data } = await fixture(t, { defeated: true, puzzle });
  data.player.setPosition(0, 0.3, -10); data.player.setRotation(0, 0.12); data.player.takeDamage(20);
  let passage, next;
  data.setBackTrigger(state => { data.dispose(); passage = createPassage({ from: 13, entryState: state, puzzle }); });
  key('KeyW'); for (let i = 0; i < 360 && !passage; i++) data.updatePhysics(1 / 60); key('KeyW', 'keyup');
  assert.ok(passage, 'real staircase and door are traversable'); t.cleanup(() => passage.dispose()); assert.equal(passage.player.getHealth(), 80);
  assert.ok(Math.abs(passage.player.body.position.y - 0.3) < 0.04);
  passage.setDoorTrigger(13, state => { passage.dispose(); next = createScene({ entryState: state, loadBoy, puzzle }); });
  passage.player.setRotation(Math.PI); key('KeyW'); for (let i = 0; i < 120 && !next; i++) passage.updatePhysics(1 / 60); key('KeyW', 'keyup');
  assert.ok(next); t.cleanup(() => next.dispose()); await next.ready;
  assert.equal(next.isCinematic(), true); assert.equal(next.player.getHealth(), 80); assert.ok(next.player.body.position.y > 3.2);
});
