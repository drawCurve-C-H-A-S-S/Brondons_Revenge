import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

let server, predictsCollision, createFlightShield;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ predictsCollision } = await server.ssrLoadModule('/helpers/scene/flightCollision.ts'));
  ({ createFlightShield } = await server.ssrLoadModule('/scripts/flightShield.ts'));
});
after(async () => server?.close());

test('predicts a head-on collision within the lookahead window', () => {
  assert.equal(predictsCollision(new THREE.Vector3(0, 0, 80), new THREE.Vector3(0, 0, -100), 1, 12), true);
});

test('predicts crossing paths and rejects a lateral near miss', () => {
  assert.equal(predictsCollision(new THREE.Vector3(35, 0, 30), new THREE.Vector3(-70, 0, -60), 1, 12), true);
  assert.equal(predictsCollision(new THREE.Vector3(35, 0, 30), new THREE.Vector3(0, 0, -60), 1, 20), false);
});

test('does not predict a collision for objects moving apart', () => {
  assert.equal(predictsCollision(new THREE.Vector3(0, 0, 30), new THREE.Vector3(0, 0, 60), 1, 10), false);
});

test('shield pickups stack to three, activate once, expire after twenty seconds and reset cleanly', () => {
  const scene = new THREE.Scene(), ship = new THREE.Group(); scene.add(ship);
  const shield = createFlightShield({ scene, ship, texture: new THREE.Texture(), iconUrl: '' });
  assert.equal(shield.activate(), false);
  for (let index = 0; index < 4; index++) shield.drop(new THREE.Vector3(0, 0, 20), 0);
  shield.update(0.3, ship.position.clone(), 4);
  assert.equal(shield.status.stored, 3);
  assert.equal(shield.activate(), true); assert.equal(shield.status.stored, 2);
  assert.equal(shield.activate(), false); assert.equal(shield.active, true);
  shield.update(0, ship.position.clone(), 4, false);
  shield.update(19, ship.position.clone(), 4, false);
  assert.equal(shield.status.remaining, 1);
  shield.update(1, ship.position.clone(), 4, false);
  assert.equal(shield.active, false); assert.equal(shield.status.stored, 2);
  assert.equal(shield.activate(), true);
  shield.reset(); assert.deepEqual(shield.status, { stored: 0, remaining: 0, drops: 0 });
  shield.dispose(); assert.equal(scene.getObjectByName('PlayerShieldForceField'), undefined);
});

test('shield HUD consumes right to left and puts its countdown around the active icon', () => {
  const old = globalThis.document;
  const buttons = [];
  globalThis.document = { createElement: tag => ({
    tag, classList: { toggle(name, active) { this[name] = active; } },
    style: { setProperty(name, value) { this[name] = value; } },
    appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {},
  }) };
  const scene = new THREE.Scene(), ship = new THREE.Group(), hud = { appendChild: button => buttons.push(button) };
  scene.add(ship);
  const shield = createFlightShield({ scene, ship, texture: new THREE.Texture(), iconUrl: '', hud });
  try {
    for (let i = 0; i < 3; i++) shield.drop(new THREE.Vector3(0, 0, 20), 0);
    const coin = scene.getObjectByName('ShieldPowerupCoin'), glow = coin.getObjectByName('ShieldPowerupGlow');
    assert.ok(glow.isMesh); assert.equal(glow.material.blending, THREE.AdditiveBlending);
    shield.update(0.3, ship.position.clone(), 4);
    for (const index of [2, 1, 0]) {
      assert.equal(shield.activate(), true);
      assert.deepEqual(buttons.map(button => button.classList.active), buttons.map((_, i) => i === index));
      assert.equal(buttons[index].style['--shield-arc'], '360deg');
      shield.update(10, ship.position.clone(), 4, false);
      assert.equal(buttons[index].style['--shield-arc'], '180deg');
      shield.update(10, ship.position.clone(), 4, false);
      assert.equal(buttons[index].hidden, true);
    }
    assert.equal(shield.activate(), false);
  } finally { shield.dispose(); globalThis.document = old; }
});

test('shield coins spin and follow their original straight trajectory without homing', () => {
  const scene = new THREE.Scene(), ship = new THREE.Group(); scene.add(ship);
  const shield = createFlightShield({ scene, ship, texture: new THREE.Texture(), iconUrl: '' });
  shield.drop(new THREE.Vector3(0, 0, 100), 200);
  ship.position.set(30, 0, 200);
  shield.update(1, new THREE.Vector3(), 4);
  const coin = scene.getObjectByName('ShieldPowerupCoin');
  assert.equal(coin.position.x, 0); assert.equal(coin.position.z, 215); assert.equal(coin.rotation.y, 0.8);
  assert.equal(shield.status.stored, 0);
  shield.dispose();
});