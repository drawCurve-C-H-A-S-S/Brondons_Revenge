import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

let server, portals, createState, applyCamera;
const scenes = {};
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  for (const id of [8, 9, 10, 11, 12, 13]) scenes[id] = (await server.ssrLoadModule(`/scenes/level 1/scene${id}.ts`)).createScene;
  portals = (await server.ssrLoadModule('/scenes/level 1/scene12.ts')).PASSAGE_PORTALS;
  createState = (await server.ssrLoadModule('/scripts/cargoPuzzle.ts')).createCargoPuzzleState;
  applyCamera = (await server.ssrLoadModule('/core/camera.ts')).applyTraversalCamera;
});
after(async () => server?.close());
function fixture(t) {
  const old = { window: globalThis.window, document: globalThis.document };
  const elements = new Map();
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { pointerLockElement: null, body: { requestPointerLock() {} },
    getElementById: id => { if (!elements.has(id)) elements.set(id, { textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }); return elements.get(id); },
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }) });
  const data = []; t.after(() => { for (const d of data) d.dispose(); Object.assign(globalThis, old); });
  return (id, options) => { const d = scenes[id](options); data.push(d); return d; };
}
function key(code, type = 'keydown', repeat = false) { const e = new Event(type); Object.defineProperties(e, { code: { value: code }, repeat: { value: repeat } }); window.dispatchEvent(e); }
function tap(code) { key(code); key(code, 'keyup'); }
function step(data, seconds, fps = 60) { for (let i = 0; i < Math.ceil(seconds * fps); i++) data.updatePhysics(1 / fps, true); }
function angle(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

for (const fps of [30, 60, 144]) {
  for (const [code, id, direction] of [['KeyA', 10, 1], ['KeyD', 11, -1]]) {
    test(`Vent gate ${id} blocks, unlocks, and clears held input on center drop at ${fps} FPS`, t => {
      const room = fixture(t), puzzle = createState(), vent = room(8, { puzzle }); let destination, drops = 0;
      const drop = state => { drops++; vent.dispose(); destination = room(id, { puzzle, entryState: state }); };
      vent.setDropToTen(id === 10 ? drop : () => assert.fail('wrong left route'));
      vent.setDropToEleven(id === 11 ? drop : () => assert.fail('wrong right route'));
      vent.player.takeDamage(25); vent.player.setPosition(0, 0.3, -0.1); step(vent, 0.01, fps); tap(code); step(vent, 0.5, fps);
      assert.ok(angle(vent.player.getState().yaw, direction > 0 ? -Math.PI / 2 : Math.PI / 2) < 1e-5);
      key('KeyW'); step(vent, 3, fps); key('KeyW', 'keyup'); assert.equal(drops, 0); assert.ok(Math.abs(vent.player.body.position.x) < 1.7);
      puzzle.gates[id] = true; key('KeyW');
      for (let i = 0; i < fps * 6 && !destination; i++) vent.updatePhysics(1 / fps, true);
      assert.equal(drops, 1); assert.ok(destination.player.body.position.y > 4);
      key('KeyW', 'keydown', true); step(destination, 2, fps);
      assert.ok(Math.abs(destination.player.body.position.x) < 0.025 && Math.abs(destination.player.body.position.z) < 0.025, 'no inherited W or key-repeat movement');
      assert.ok(Math.abs(destination.player.body.position.y - 0.3) < 0.025);
      assert.equal(destination.player.getState().ventMode, false); assert.equal(destination.player.getHealth(), 75);
      key('KeyW', 'keyup'); key('KeyW'); step(destination, 0.4, fps); key('KeyW', 'keyup'); assert.ok(destination.player.body.position.z < -1, 'fresh press works');
    });
    test(`Vent ${id} branch camera follows in both views at ${fps} FPS`, t => {
      const puzzle = createState(12), vent = fixture(t)(8, { puzzle });
      vent.player.setPosition(direction * 5, 0.3, 0); vent.player.setRotation(direction > 0 ? -Math.PI / 2 : Math.PI / 2);
      for (const thirdPerson of [false, true]) {
        for (let i = 0; i < fps; i++) {
          vent.updatePhysics(1 / fps, thirdPerson); vent.player.updateCamera(0, thirdPerson); assert.equal(applyCamera(vent.camera, vent.player, thirdPerson), true);
          assert.ok(Math.abs(vent.camera.position.x - vent.player.body.position.x) < 1.5, 'camera never snaps into central tunnel');
          assert.ok(Math.abs(vent.camera.position.z) < 1); assert.ok(vent.camera.position.y < 1.25);
          if (!thirdPerson) { assert.ok(angle(vent.camera.rotation.y, vent.player.getState().yaw) < 1e-6); assert.ok(Math.abs(vent.camera.position.x - vent.player.body.position.x) < 1e-6); }
        }
      }
    });
  }
  for (const id of [9, 10, 11, 13]) {
    test(`${id} and hub doorway walking preserves position, health, facing and held input at ${fps} FPS`, t => {
      const room = fixture(t), puzzle = createState(12); let hub, final, transfer;
      if (id === 13) puzzle.exitUnlocked = true;
      const source = room(id, { puzzle, fromPassage: id === 9, defeated: id === 13 }); step(source, 2, fps);
      const door = source.passageDoor ?? source.door;
      source.player.setPosition(0.2, door.frame.y + 0.3, door.frame.z + 1.5); source.player.setRotation(0, 0.17); source.player.takeDamage(20);
      (source.setPassageTrigger ?? source.setBackTrigger)(state => { transfer = state; source.dispose(); hub = room(12, { puzzle, entryState: state, from: id }); });
      step(source, 1, fps); key('KeyW'); for (let i = 0; i < fps * 2 && !hub; i++) source.updatePhysics(1 / fps);
      assert.ok(hub); assert.ok(hub.player.captureTransition(portals[id]).heldKeys.includes('KeyW')); key('KeyW', 'keyup');
      assert.ok(angle(hub.player.getState().yaw, portals[id].yaw + Math.PI) < 1e-6); assert.equal(hub.player.getHealth(), 80); assert.equal(hub.player.getState().pitch, 0.17);
      const local = hub.player.captureTransition(portals[id]).position;
      assert.ok(Math.abs(local.x + transfer.position.x) < 1e-9);
      assert.ok(Math.abs(local.z + transfer.position.z) < 1e-9);
      assert.ok(Math.abs(local.z - (hub.player.radius + 0.2)) < 1e-9, 'Arrival clears the return trigger by one radius plus padding');
      hub.setDoorTrigger(id, state => { hub.dispose(); final = room(id, { puzzle, entryState: state, fromPassage: true, defeated: id === 13 }); });
      step(hub, 0.3, fps); assert.equal(final, undefined);
      hub.player.setRotation(portals[id].yaw, 0.17); key('KeyW'); for (let i = 0; i < fps * 2 && !final; i++) hub.updatePhysics(1 / fps);
      key('KeyW', 'keyup'); assert.ok(final); assert.ok(angle(final.player.getState().yaw, Math.PI) < 1e-6); assert.equal(final.player.getHealth(), 80);
      step(final, 0.5, fps); assert.ok(final.player.body.position.y > 0.27);
    });
  }
}

test('Hub locks both side-room routes without parked crates and locks scene 13 initially', t => {
  const puzzle = createState(), hub = fixture(t)(12, { puzzle, from: 9 });
  for (const id of [10, 11, 13]) {
    const frame = portals[id]; hub.player.setPosition(frame.x + Math.sin(frame.yaw) * 1.5, 0.3, frame.z + Math.cos(frame.yaw) * 1.5);
    step(hub, 1); assert.equal(hub.doors.get(id).open, 0);
  }
});
