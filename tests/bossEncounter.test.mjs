import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server, createScene, createPassage, createPuzzleState, traceShot, CrowbarController, rules, boyData, droneData, droneBuffer;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ createScene } = await server.ssrLoadModule('/scenes/level 1/scene13.ts'));
  ({ createScene: createPassage } = await server.ssrLoadModule('/scenes/level 1/scene12.ts'));
  ({ createCargoPuzzleState: createPuzzleState } = await server.ssrLoadModule('/scripts/cargoPuzzle.ts'));
  ({ traceShot } = await server.ssrLoadModule('/scripts/pistol.ts'));
  ({ CrowbarController } = await server.ssrLoadModule('/scripts/crowbar.ts'));
  ({ BOSS_RULES: rules } = await server.ssrLoadModule('/scripts/mechBaymaxBoss.ts'));
  const buffer = await readFile(new URL('../src/assets/models/boy.glb', import.meta.url));
  boyData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  droneData = await readFile(new URL('../src/assets/models/Tools/Enemy_EyeDrone.gltf', import.meta.url), 'utf8');
  const droneBytes = await readFile(new URL('../src/assets/models/Tools/Enemy_EyeDrone.bin', import.meta.url));
  droneBuffer = droneBytes.buffer.slice(droneBytes.byteOffset, droneBytes.byteOffset + droneBytes.byteLength);
});
after(async () => server?.close());
function loadBoy() {
  const loader = new GLTFLoader();
  // Keep the actual GLB meshes, skeleton and clips; only browser image decoding is stubbed.
  loader.register(() => ({ name: 'NodeImageTransport', loadTexture: async () => new THREE.Texture() }));
  return loader.parseAsync(boyData.slice(0), '');
}
function loadDrone() {
  const loader = new GLTFLoader();
  loader.register(parser => ({ name: 'NodeDroneTransport',
    beforeRoot() { parser.cache.add('buffer:0', Promise.resolve(droneBuffer.slice(0))); },
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader.parseAsync(droneData, '');
}
function browser(t) {
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, self: globalThis.self, Audio: globalThis.Audio };
  const elements = new Map();
  globalThis.Audio = class extends EventTarget {
    paused = true;
    currentTime = 0;
    load() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  class Element extends EventTarget {
    style = { setProperty(name, value) { this[name] = value; } }; dataset = {}; textContent = ''; classes = new Set(); children = [];
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, value) => { this.classList[value ? 'add' : 'remove'](name); return value; },
    };
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
    setAttribute(name, value) { this[name] = String(value); }
    closest() { return null; }
    requestPointerLock() {}
    getContext() { return new Proxy({}, { get: () => () => {} }); }
  }
  globalThis.HTMLElement = Element;
  globalThis.self = globalThis;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { body: new Element(), pointerLockElement: null,
    getElementById(id) {
      if (!elements.has(id)) { const classes = new Set(['hidden']); elements.set(id, { style: {}, dataset: {}, textContent: '', classList: {
        add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: n => classes.has(n), toggle(n, active) { if (active) classes.add(n); else classes.delete(n); },
      } }); }
      return elements.get(id);
    }, createElement: () => new Element() });
  const cleanups = []; t.cleanup = fn => cleanups.push(fn);
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); Object.assign(globalThis, old); });
  return elements;
}
async function fixture(t, { startPhaseThree = false, ...options } = {}) {
  const elements = browser(t), data = createScene({ loadBoy, loadDrone, startPhaseThree, ...options });
  t.cleanup(() => data.dispose()); await data.ready; return { data, elements };
}
function step(data, seconds, fps = 60) { for (let i = 0; i < Math.round(seconds * fps); i++) data.updatePhysics(1 / fps, true); }
function key(code, type = 'keydown') { const e = new Event(type); Object.defineProperties(e, { code: { value: code }, repeat: { value: false } }); window.dispatchEvent(e); }
function down(data, fps = 60) {
  for (const target of data.boss.targets) while (target.hits()) assert.equal(target.damage(25, 'pistol'), true);
  assert.equal(data.boss.getStatus().phase, 'falling'); step(data, 0.9, fps); assert.equal(data.boss.getStatus().phase, 'exposed');
}
function cover(data) { data.player.setPosition(16.5, 0.3, 19); }
function untilPhase(data, phase, fps = 60, limit = 15) {
  for (let frame = 0; frame < limit * fps && data.boss.getStatus().phase !== phase; frame++) step(data, 1 / fps, fps);
  assert.equal(data.boss.getStatus().phase, phase, JSON.stringify(data.boss.getStatus()));
}

for (const fps of [30, 60, 144]) {
  test(`Scene 13 Phase 3 starts at half health, drones orbit the boss and Phase 3 targets appear once cleared at ${fps} FPS`, async t => {
    const { data, elements } = await fixture(t, { startPhaseThree: true });
    assert.equal(data.roomId, 'scene13'); assert.equal(data.isCinematic(), false);
    assert.equal(data.player.isEnabled(), true); assert.equal(data.player.getHealth(), 100);
    assert.equal(data.boss.getStatus().health, rules.phaseThreeHealth / 2);
    assert.equal(data.boss.getStatus().maxHealth, rules.phaseThreeHealth);
    assert.equal(elements.get('boss-health-fill').style.width, '50%');
    assert.equal(data.boss.getStatus().droneLoadError, false);
    assert.equal(data.boss.root.getObjectByName('BossRedEye').visible, true);
    assert.equal(data.boss.root.getObjectByName('BossEnergyAura').children.every(ring => ring.visible), true);
    assert.equal(data.boss.targets[0].damage(25, 'pistol'), false);
    assert.equal(data.boss.headTarget.damage(35, 'crowbar'), false);
    const from = new THREE.Vector3(data.player.body.position.x, data.player.getHeadY(), data.player.body.position.z);
    const headPosition = data.boss.head.getWorldPosition(new THREE.Vector3());
    const shot = traceShot(data.scene, data.physicsWorld, new THREE.Ray(from, headPosition.sub(from).normalize()), data.getDamageTargets());
    assert.equal(shot.target?.root, data.boss.head);
    assert.equal(shot.target.damage(25, 'pistol'), true);
    untilPhase(data, 'gravity', fps);
    // Phase 3 keeps normal gravity now — the boss transforms rather than dropping a zero-g field.
    assert.equal(data.physicsWorld.gravity.y, -9.82); assert.equal(data.player.getState().floating, false);
    assert.equal(data.boss.getStatus().drones, 4);
    const wave = data.getDamageTargets().filter(target => target.root.name.startsWith('BossEyeDrone'));
    assert.equal(wave.length, 4);
    assert.ok(wave[0].root.getObjectsByProperty('isSkinnedMesh', true).length > 0, 'actual drone rig is loaded');
    // With normal gravity the player stays on the ground: strafing shifts x, y stays near spawn.
    const start = data.player.body.position.clone();
    key('KeyD'); step(data, 0.25, fps); key('KeyD', 'keyup');
    assert.ok(data.player.body.position.x < start.x - 0.1, 'D strafes camera-right while facing the boss');
    assert.ok(Math.abs(data.player.body.position.y - start.y) < 0.05, 'no zero-g lift in Phase 3');
    for (const drone of wave) {
      assert.equal(drone.damage(25, 'crowbar'), false);
      assert.equal(drone.damage(NaN, 'pistol'), false);
      assert.equal(drone.damage(25, 'pistol'), true);
    }
    // Clearing the swarm reveals the four shootable Phase 3 targets (three pistol hits each).
    assert.equal(data.boss.getStatus().phase, 'phaseThreeTargets');
    assert.equal(data.boss.getStatus().phaseThreeTargetsActive, true);
    assert.deepEqual(data.boss.getStatus().targets, [3, 3, 3, 3]);
    assert.equal(data.boss.getStatus().health, rules.phaseThreeHealth / 2 - 25);
    assert.equal(data.scene.children.some(node => node.name.startsWith('BossEyeDrone')), false);
    assert.equal(wave[0].damage(25, 'pistol'), false);
    // Drop all four targets — three pistol hits each — to knock the boss down.
    for (const target of data.boss.targets) {
      assert.equal(target.damage(25, 'crowbar'), false);
      for (let i = 0; i < rules.phaseThreeTargetHits; i++) assert.equal(target.damage(25, 'pistol'), true);
    }
    assert.equal(data.boss.getStatus().phase, 'falling');
    step(data, 0.9, fps); assert.equal(data.boss.getStatus().phase, 'exposed');
    // Phase 3 exposed head accepts the crowbar bash for its full damage bonus.
    const before = data.boss.getStatus().health;
    assert.equal(data.boss.headTarget.damage(35, 'crowbar'), true);
    assert.equal(data.boss.getStatus().health, before - rules.phaseThreeHeadDamage);
    data.dispose(); assert.equal(data.physicsWorld.gravity.y, -9.82);
    assert.equal(data.scene.children.some(node => node.name.startsWith('BossEyeDrone')), false);
  });

  test(`Scene 13 Phase 3 drone impact frames the player, deals damage once and the remaining swarm keeps orbiting at ${fps} FPS`, async t => {
    const { data } = await fixture(t, { startPhaseThree: true });
    untilPhase(data, 'gravity', fps); untilPhase(data, 'droneExplosion', fps, 5);
    assert.equal(data.player.getHealth(), 100); assert.equal(data.player.isEnabled(), false);
    assert.equal(data.isCinematic(), true);
    assert.equal(data.getDamageTargets().length, 0);
    const playerPosition = data.player.body.position.clone();
    const drone = data.scene.children.find(node => node.name.startsWith('BossEyeDrone') && node.visible);
    const playerHead = new THREE.Vector3(playerPosition.x, data.player.getHeadY(), playerPosition.z);
    assert.ok(drone.position.distanceTo(playerHead) < 0.8);
    for (const aspect of [16 / 9, 9 / 16]) {
      data.camera.aspect = aspect; data.camera.updateProjectionMatrix(); data.applyCinematicCamera(); data.camera.updateMatrixWorld(true);
      for (const position of [playerHead, drone.position]) {
        const projected = position.clone().project(data.camera);
        assert.ok(Math.abs(projected.x) < 0.85 && Math.abs(projected.y) < 0.85 && projected.z > -1 && projected.z < 1, 'head and drone fit the close-up');
      }
    }
    step(data, 0.5, fps); assert.equal(data.player.getHealth(), 100, 'detonation waits for the slow-motion approach');
    step(data, 0.55, fps); assert.equal(data.player.getHealth(), 100 - rules.droneDamage);
    assert.equal(data.scene.getObjectByName('EyeDroneExplosion').visible, true);
    assert.ok(data.player.body.position.distanceTo(playerPosition) < 0.001);
    assert.ok(Math.abs(data.getCinematicDelta() - rules.droneExplosionSlow / fps) < 1e-8);
    // Explosion resolves and control returns — the surviving drones continue the swarm.
    untilPhase(data, 'gravity', fps, 6);
    assert.equal(data.player.getHealth(), 100 - rules.droneDamage); assert.equal(data.player.isEnabled(), true);
    assert.equal(data.isCinematic(), false); assert.equal(data.physicsWorld.gravity.y, -9.82);
    assert.equal(data.scene.getObjectByName('EyeDroneExplosion').visible, false);
    assert.equal(data.boss.getStatus().drones, 3, 'three drones survive the first detonation');
    assert.ok(data.scene.children.some(node => node.name.startsWith('BossEyeDrone')));
  });
}

test('Scene 13 Phase 3 death cleanup releases the drone swarm', async t => {
  let respawns = 0;
  const { data } = await fixture(t, { startPhaseThree: true, onRespawn: () => respawns++ });
  untilPhase(data, 'gravity');
  data.player.takeDamage(100); assert.equal(data.onPlayerDeath(), true);
  assert.equal(data.physicsWorld.gravity.y, -9.82); assert.equal(data.getDamageTargets().length, 0);
  step(data, 2.6); assert.equal(respawns, 1);
});

test('Scene 13 Phase 3 final defeat during Phase 3 clears drones and preserves the rescue sequence', async t => {
  const { data } = await fixture(t, { startPhaseThree: true });
  untilPhase(data, 'gravity');
  const oldDrone = data.getDamageTargets().find(target => target.root.name.startsWith('BossEyeDrone'));
  assert.equal(data.boss.headTarget.damage(rules.phaseThreeHealth / 2, 'pistol'), true);
  assert.equal(data.boss.getStatus().phase, 'defeated');
  assert.equal(data.physicsWorld.gravity.y, -9.82); assert.equal(data.player.getState().floating, false);
  assert.equal(data.getDamageTargets().length, 0); assert.equal(oldDrone.damage(25, 'pistol'), false);
  assert.equal(data.scene.children.some(node => node.name.startsWith('BossEyeDrone')), false);
  assert.equal(data.scene.getObjectByName('FreedBoy').visible, true);
  assert.equal(data.isCinematic(), true); assert.equal(data.player.isEnabled(), false);
});

test('Scene 13 Phase 3 is selectable in the quick menu with its own respawn route', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /\[13\.5, 'Bay Warden Phase 3'\]/);
  assert.match(main, /case 13\.5: loadWardenPhaseThree\(\)/);
  assert.match(main, /onRespawn: \(\) => loadWardenPhaseThree\(\)/);
  assert.match(main, /startPhaseThree: true/);
});

for (const fps of [30, 60, 144]) {
  test(`Stair and versus intro own camera, preserve health and release controls at ${fps} FPS`, async t => {
    const { data, elements } = await fixture(t);
    assert.equal(data.player.isEnabled(), false); assert.equal(data.isCinematic(), true);
    assert.equal(data.getCinematicState().isMoving, true); assert.equal(data.boss.getStatus().phase, 'dormant');
    assert.equal(data.boss.targets[0].damage(25, 'pistol'), false);
    const start = data.player.body.position.clone(); key('KeyA'); key('Space');
    step(data, 3, fps); assert.ok(data.player.body.position.y < start.y - 0.5); assert.ok(Math.abs(data.player.body.position.x) < 0.01);
    assert.ok(data.camera.position.z > -24); assert.equal(data.player.getHealth(), 100);
    step(data, 4.2, fps); key('KeyA', 'keyup'); key('Space', 'keyup');
    assert.equal(data.isCinematic(), true); assert.equal(data.player.isEnabled(), false);
    assert.equal(data.boss.getStatus().phase, 'dormant');
    assert.equal(document.body.classList.contains('hangar-versus-active'), true);
    step(data, 2.6, fps);
    assert.equal(document.body.classList.contains('hangar-versus-active'), false);
    assert.equal(data.isCinematic(), false); assert.equal(data.player.body.type, CANNON.Body.DYNAMIC);
    assert.equal(data.player.isEnabled(), true); assert.equal(data.boss.getStatus().phase, 'flying');
    assert.ok(Math.abs(data.player.body.position.y - 0.3) < 0.03); assert.equal(data.player.getState().isOnGround, true);
    assert.equal(elements.get('boss-hud').classList.contains('hidden'), false);
    key('KeyW'); step(data, 0.3, fps); key('KeyW', 'keyup'); assert.ok(data.player.body.position.z > -9.3);
  });
  test(`Four targets, 10-second head window and two-hit subsequent rounds at ${fps} FPS`, async t => {
    const { data } = await fixture(t); step(data, 9.8, fps); cover(data);
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
    const { data } = await fixture(t); step(data, 9.8, fps); data.player.setPosition(0, 0.3, 10);
    step(data, 3, fps); assert.ok(data.player.getHealth() < 100, 'uncovered stationary player takes a laser hit');
    data.player.heal(100); data.player.setPosition(0, 0.3, 10);
    while (!data.boss.getStatus().charging) step(data, 1 / fps, fps);
    key('KeyA'); step(data, 1.5, fps); key('KeyA', 'keyup');
    assert.equal(data.player.getHealth(), 100, 'a bolt never homes after aim is locked');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      data.player.setPosition(sx * 16.5, 0.3, sz * 19); data.player.heal(100); step(data, 5, fps);
      assert.equal(data.player.getHealth(), 100, `pillar ${sx},${sz} blocks lasers`);
    }

    test('four rear pillar caches provide exactly two shields and two health boxes during combat', async t => {
      const { data } = await fixture(t, { checkpoint: true });
      const supplies = data.getArenaSupplies();
      assert.equal(supplies.length, 4);
      assert.equal(supplies.filter(supply => supply.kind === 'shield').length, 2);
      assert.equal(supplies.filter(supply => supply.kind === 'health').length, 2);
      for (const supply of supplies) {
        assert.equal(Math.abs(supply.position.x), 14.25);
        assert.equal(Math.abs(supply.position.z), 15);
        data.player.setPosition(Math.sign(supply.position.x) * 15.08, 0.3, supply.position.z);
        if (supply.kind === 'health') {
          step(data, 0.01);
          assert.equal(data.getArenaSupplies().find(item => item.id === supply.id).collected, false, 'Full health must not waste a box');
          data.player.takeDamage(60, true);
        } else if (data.player.getShield() > 0) data.player.takeDamage(data.player.getShield(), true);
        step(data, 0.02);
        assert.equal(data.getArenaSupplies().find(item => item.id === supply.id).collected, true);
        if (supply.kind === 'shield') assert.equal(data.player.getShield(), 50);
        else assert.equal(data.player.getHealth(), 100);
      }
      assert.equal(data.getArenaSupplies().filter(supply => supply.collected).length, 4);
    });
    assert.equal(data.boss.root.position.x, 0); assert.equal(data.boss.root.position.z, 0);
  });
}

test('Targets remain unobstructed as the boss faces the player around the entire room', async t => {
  const { data } = await fixture(t); step(data, 9.8);
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
  const { data, elements } = await fixture(t); step(data, 9.8); cover(data); down(data);
  const ordinary = data.boss.head.material; data.setGogglesActive(true); assert.equal(data.boss.head.material.color.getHex(), 0xffd126);
  data.setGogglesActive(false); assert.equal(data.boss.head.material, ordinary);
  let thirdPerson = false;
  const weapon = new CrowbarController(() => ({ scene: data.scene, camera: data.camera, world: data.physicsWorld, player: data.player, character: null,
    thirdPerson, hasCrowbar: true, targets: data.getDamageTargets(), setCharacterEquipped() {}, openDoor() {}, doorTarget: null }));
  t.cleanup(() => weapon.dispose()); weapon.equip();
  const head = data.boss.head.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(Math.sin(data.boss.root.rotation.y), 0, Math.cos(data.boss.root.rotation.y));
  const p = head.clone().addScaledVector(forward, 1.25); data.player.setPosition(p.x, 0.3, p.z);
  data.player.setRotation(Math.atan2(p.x - head.x, p.z - head.z), Math.atan2(head.y - 1.1, 1.25));
  for (const view of [false, true]) {
    thirdPerson = view; data.camera.position.set(p.x, 1.6, p.z); if (view) data.camera.position.addScaledVector(forward, 1.5);
    data.camera.lookAt(head); data.camera.updateMatrixWorld(true);
    const health = data.boss.getStatus().health; weapon.swing();
    assert.equal(data.boss.getStatus().health, health, 'attack must reach the head before dealing damage');
    for (let frame = 0; frame < 24; frame++) weapon.update(1 / 60);
    assert.equal(data.boss.getStatus().health, health - rules.headDamage, `physical melee in ${view ? 'third' : 'first'} person`);
    step(data, 1.1); for (let i = 0; i < 4; i++) weapon.update(0.1);
  }
  assert.match(elements.get('boss-health-label').textContent, /BAY WARDEN/);
});

test('Bay Warden music victory is raised only by a new final defeat, not a phase change or a cleared-room visit', async t => {
  const bytes = await readFile(new URL('../src/assets/models/bayboss.glb', import.meta.url));
  const bossData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loadBoss = () => {
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'NodeBossImageTransport', loadTexture: async () => new THREE.Texture() }));
    return loader.parseAsync(bossData.slice(0), '');
  };
  const { data } = await fixture(t, { loadBoss, checkpoint: true });
  assert.equal(data.hasBossVictory(), false);
  cover(data); down(data);
  assert.equal(data.boss.headTarget.damage(rules.health * 0.25, 'pistol'), true);
  assert.equal(data.hasBossVictory(), false);
  untilPhase(data, 'flying'); down(data);
  assert.equal(data.boss.headTarget.damage(data.boss.getStatus().health, 'pistol'), true);
  assert.equal(data.boss.getStatus().phase, 'defeated');
  assert.equal(data.hasBossVictory(), true);
  step(data, 0.5); assert.equal(data.hasBossVictory(), true);
  data.dispose();
  const next = createScene({ defeated: true, checkpoint: true, loadBoy, loadDrone, loadBoss });
  t.cleanup(() => next.dispose()); await next.ready;
  assert.equal(next.hasBossVictory(), false);
});

test('Defeat fades black particles, reveals the actual boy.glb, thanks player and restores control', async t => {
  let completed = 0;
  const { data, elements } = await fixture(t, { onDefeated: () => completed++ }); step(data, 9.8); cover(data);
  assert.equal(data.hasBossVictory(), false);
  const boy = data.scene.getObjectByName('FreedBoy'); assert.ok(boy); assert.equal(boy.visible, false);
  assert.ok(boy.getObjectsByProperty('isMesh', true).length > 0, 'real GLB mesh loaded');
  const requiredHits = Math.ceil(rules.health / rules.headDamage);
  let hits = 0;
  for (let attempts = 0; attempts < requiredHits * 2 && hits < requiredHits; attempts++) {
    if (data.boss.getStatus().phase === 'flying') down(data);
    if (data.boss.getStatus().phase === 'exposed' && data.boss.headTarget.damage(35, 'crowbar')) hits++;
    step(data, rules.headCooldown + 0.1);
  }
  assert.equal(hits, requiredHits, 'Defeat requires the configured number of accepted melee hits');
  assert.equal(data.boss.getStatus().phaseThree, true);
  assert.equal(data.boss.getStatus().health, rules.phaseThreeHealth);
  assert.equal(boy.visible, false, 'rescue waits for final phase');
  assert.equal(data.boss.headTarget.damage(rules.phaseThreeHealth, 'pistol'), true);
  assert.equal(data.boss.getStatus().health, 0, JSON.stringify(data.boss.getStatus()));
  assert.equal(data.hasBossVictory(), true);
  assert.equal(data.isCinematic(), true); assert.equal(data.player.isEnabled(), false); assert.equal(boy.visible, true);
  const cloud = data.scene.getObjectByName('BossBlackParticles'); assert.equal(cloud.visible, true);
  assert.equal(data.getDamageTargets().length, 0); assert.equal(data.boss.getStatus().projectiles, 0);
  step(data, 3.6); assert.ok(cloud.material.opacity < 0.05); assert.match(elements.get('boss-subtitles').textContent, /Thank you for defeating/);
  step(data, 6); assert.match(elements.get('boss-subtitles').textContent, /AI took your friends to the nearest planet/);
  assert.equal(completed, 0); assert.equal(data.player.isEnabled(), false);
  step(data, 6); assert.match(elements.get('boss-subtitles').textContent, /Use the console/);
  step(data, 6); assert.equal(completed, 1); assert.equal(data.isCinematic(), false); assert.equal(data.player.isEnabled(), true); assert.equal(cloud.visible, false);
  assert.equal(elements.get('boss-hud').classList.contains('hidden'), true);
  step(data, 2); assert.equal(completed, 1);
  data.dispose(); assert.equal(data.physicsWorld.bodies.length, 0);
  const next = createScene({ defeated: true, loadBoy, loadDrone }); t.cleanup(() => next.dispose()); await next.ready;
  assert.equal(next.hasBossVictory(), false, 'Revisiting a cleared boss must not replay victory');
  assert.equal(next.isCinematic(), false); assert.equal(next.getDamageTargets().length, 0); assert.equal(next.scene.getObjectByName('FreedBoy').visible, true);
});

test('holding Enter skips only the victory dialogue and preserves the unlocked lift exactly once', async t => {
  let completed = 0;
  const bytes = await readFile(new URL('../src/assets/models/bayboss.glb', import.meta.url));
  const loadBoss = () => {
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'NodeSkipImageTransport', loadTexture: async () => new THREE.Texture() }));
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  };
  const { data } = await fixture(t, { checkpoint: true, loadBoss, onDefeated: () => completed++ });
  cover(data); untilPhase(data, 'flying'); down(data);
  assert.equal(data.boss.headTarget.damage(data.boss.getStatus().health, 'pistol'), true);
  const hold = seconds => { key('Enter'); step(data, seconds); key('Enter', 'keyup'); };
  hold(1.3);
  assert.equal(completed, 0, 'The shell-breaking animation cannot be skipped');
  step(data, 2.3);
  hold(0.4); step(data, 0.9); assert.equal(completed, 0, 'A released hold does not complete');
  hold(1.2);
  assert.equal(completed, 1); assert.equal(data.isCinematic(), false); assert.equal(data.player.isEnabled(), true);
  assert.equal(data.scene.getObjectByName('BossBlackParticles').visible, false);
  assert.equal(data.elevator.consoleBody.collisionResponse, true);
  assert.equal(data.elevator.console.position.y, 0);
  hold(1.4); step(data, 3); assert.equal(completed, 1);
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
  passage.setDoorTrigger(13, state => { passage.dispose(); next = createScene({ entryState: state, loadBoy, loadDrone, puzzle }); });
  passage.player.setRotation(Math.PI); key('KeyW'); for (let i = 0; i < 120 && !next; i++) passage.updatePhysics(1 / 60); key('KeyW', 'keyup');
  assert.ok(next); t.cleanup(() => next.dispose()); await next.ready;
  assert.equal(next.isCinematic(), true); assert.equal(next.player.getHealth(), 80); assert.ok(next.player.body.position.y > 3.2);
});
