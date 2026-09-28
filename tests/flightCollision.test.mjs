import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

let server, predictsCollision;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  ({ predictsCollision } = await server.ssrLoadModule('/helpers/scene/flightCollision.ts'));
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