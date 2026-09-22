import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

let server, portals;
const scenes = {};
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  for (const id of [8, 9, 10, 11, 12, 13]) scenes[id] = (await server.ssrLoadModule(`/scenes/scene${id}.ts`)).createScene;
  portals = (await server.ssrLoadModule('/scenes/scene12.ts')).PASSAGE_PORTALS;
});
after(async () => server?.close());
function fixture(t) {
  const old = { window: globalThis.window, document: globalThis.document };
  const elements = new Map();
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { pointerLockElement: null, body: { requestPointerLock() {} },
    getElementById: id => { if (!elements.has(id)) elements.set(id, { textContent: '', classList: { add() {}, remove() {}, toggle() {} } }); return elements.get(id); },
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }) });
  const data = []; t.after(() => { for (const d of data) d.dispose(); Object.assign(globalThis, old); });
  return (id, options) => { const d = scenes[id](options); data.push(d); return d; };
}
function key(code, type = 'keydown') { const e = new Event(type); Object.defineProperties(e, { code: { value: code }, repeat: { value: false } }); window.dispatchEvent(e); }
function tap(code) { key(code); key(code, 'keyup'); }
function step(data, seconds, fps = 60) { for (let i = 0; i < Math.round(seconds * fps); i++) data.updatePhysics(1 / fps, true); }
function angle(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

for (const fps of [30, 60, 144]) {
  for (const [code, id, direction] of [['KeyA', 10, 1], ['KeyD', 11, -1]]) {
    test(`Vent ${code} turns into ${id} and falls through real shaft at ${fps} FPS`, t => {
      const room = fixture(t), vent = room(8);
      let drops = 0, destination;
      const drop = state => { drops++; vent.player.disable(); destination = room(id, { entryState: state }); };
      vent.setDropToTen(id === 10 ? drop : () => assert.fail('wrong left route'));
      vent.setDropToEleven(id === 11 ? drop : () => assert.fail('wrong right route'));
      // Start on the approach, crawl into junction, turn, then crawl down the branch.
      vent.player.takeDamage(25); vent.player.setPosition(0, 0.3, -0.8);
      key('KeyW'); step(vent, 0.5, fps); key('KeyW', 'keyup');
      tap(code); step(vent, 0.5, fps);
      assert.ok(angle(vent.player.getState().yaw, direction > 0 ? -Math.PI / 2 : Math.PI / 2) < 1e-5);
      key('KeyW'); step(vent, 6, fps); key('KeyW', 'keyup');
      assert.equal(drops, 1); assert.ok(destination); assert.ok(destination.player.body.position.y > 4);
      step(destination, 2, fps); assert.ok(Math.abs(destination.player.body.position.y - 0.3) < 0.025);
      assert.equal(destination.player.getState().climbing, false); assert.equal(destination.player.getState().ventMode, false);
      assert.equal(destination.player.getHealth(), 75); assert.equal(destination.setReturnToEight, undefined);
    });
  }
  test(`Puzzle pushes, pulls, releases and opens only with box on plate at ${fps} FPS`, t => {
    const data = fixture(t)(10); step(data, 2, fps);
    data.player.setPosition(0, 0.3, -2); step(data, 1, fps); assert.equal(data.isPlatePressed(), false); assert.equal(data.door.open, 0);
    data.player.setPosition(0, 0.3, 2.75); tap('KeyE'); assert.equal(data.player.getState().boxHandling, true);
    key('KeyS'); step(data, 0.5, fps); key('KeyS', 'keyup'); assert.ok(data.boxBody.position.z > 1.85, `pull position ${data.boxBody.position.z}`);
    assert.ok(data.player.getState().boxMotion < 0);
    key('KeyW');
    for (let i = 0; i < fps * 7 && !data.isPlatePressed(); i++) data.updatePhysics(1 / fps, true);
    key('KeyW', 'keyup'); assert.equal(data.isPlatePressed(), true, `box=${data.boxBody.position} grip=${data.player.getState().boxHandling}`);
    step(data, 0.15, fps); tap('KeyE'); step(data, 1, fps);
    assert.equal(data.player.getState().boxHandling, false); assert.equal(data.physicsWorld.constraints.length, 0);
    assert.equal(data.door.open, 1); assert.equal(data.isPlatePressed(), true, 'released box stays on plate');
    data.boxBody.position.set(3, 0.7, 0); data.boxBody.velocity.set(0, 0, 0); data.boxBody.aabbNeedsUpdate = true;
    data.player.setPosition(3, 0.3, 2); step(data, 1, fps); assert.equal(data.isPlatePressed(), false); assert.equal(data.door.open, 0);
  });
}

test('Puzzle solid door blocks bypass, walls stop box, and release restores ordinary controls', t => {
  const data = fixture(t)(10); step(data, 2);
  data.player.setPosition(0, 0.3, -4.5); data.player.setRotation(0); key('KeyW'); step(data, 1); key('KeyW', 'keyup');
  assert.ok(data.player.body.position.z > -5.7, 'unpowered door blocks player');
  data.boxBody.position.set(4.8, 0.7, 0); data.boxBody.aabbNeedsUpdate = true; data.player.setPosition(3.55, 0.3, 0);
  tap('KeyE'); key('KeyW'); step(data, 3); key('KeyW', 'keyup');
  assert.ok(data.boxBody.position.x < 5.11); assert.ok(data.player.body.position.x < 4.2);
  key('KeyS'); step(data, 1); key('KeyS', 'keyup'); assert.ok(data.boxBody.position.x < 4.5, 'pull away from wall');
  window.dispatchEvent(new Event('blur')); assert.equal(data.physicsWorld.constraints.length, 0);
  key('Space'); step(data, 0.2); key('Space', 'keyup'); assert.ok(data.player.body.position.y > 0.8);
});

test('Puzzle position persists across room recreation and the entry door cannot trap arrivals', t => {
  const room = fixture(t); let saved;
  const first = room(10, { onPuzzleChanged: state => { saved = state; } });
  first.boxBody.position.set(0, 0.7, -2); first.boxBody.aabbNeedsUpdate = true; step(first, 2); first.dispose();
  const next = room(10, { puzzleState: saved, fromPassage: true }); step(next, 0.5);
  assert.equal(next.isPlatePressed(), true); assert.equal(next.door.open, 1);
});

for (const fps of [30, 60, 144]) for (const id of [9, 10, 11, 13]) {
  test(`${id} ↔ 12 doorway routing preserves controls, position and facing at ${fps} FPS`, t => {
    const room = fixture(t);
    const source = room(id, id === 9 ? { gravityRestored: true } : id === 10 ? { puzzleState: { box: { x: 0, y: 0.7, z: -2 } } } : undefined);
    step(source, 2, fps);
    const door = source.passageDoor ?? source.door;
    source.player.setPosition(0.2, 0.3, door.frame.z + 1.5); source.player.setRotation(0, 0.17); source.player.takeDamage(20);
    let passage, final;
    const connect = state => { source.dispose(); passage = room(12, { entryState: state, from: id }); };
    (source.setPassageTrigger ?? source.setBackTrigger)(connect);
    step(source, 1, fps); key('KeyW');
    for (let i = 0; i < fps * 2 && !passage; i++) source.updatePhysics(1 / fps);
    assert.ok(passage, 'source door fires'); key('KeyW', 'keyup');
    const frame = portals[id];
    assert.ok(angle(passage.player.getState().yaw, frame.yaw + Math.PI) < 1e-6);
    assert.equal(passage.player.getHealth(), 80); assert.equal(passage.player.getState().pitch, 0.17);
    assert.ok(passage.player.captureTransition(frame).heldKeys.length === 0);
    let local = passage.player.captureTransition(frame).position;
    assert.ok(local.z > 0.8 && local.z < 1.1, `spawn inside threshold ${local.z}`);
    passage.setDoorTrigger(id, state => { passage.dispose(); final = room(id, { entryState: state, fromPassage: true, gravityRestored: true }); });
    step(passage, 0.3, fps); assert.equal(final, undefined, 'no immediate bounce-back');
    passage.player.setRotation(frame.yaw, 0.17); key('KeyW');
    for (let i = 0; i < fps * 2 && !final; i++) passage.updatePhysics(1 / fps);
    key('KeyW', 'keyup'); assert.ok(final, 'return trigger fires');
    assert.ok(angle(final.player.getState().yaw, Math.PI) < 1e-6);
    assert.equal(final.player.getHealth(), 80); step(final, 0.5, fps);
    assert.ok(final.player.body.position.y > 0.27, 'no fall through destination threshold');
  });
}

test('Loading bay passage entry respects zero-G and both gravity toggles still work', t => {
  const room = fixture(t), passage = room(12, { from: 9 });
  passage.player.setPosition(0, 0.3, -10.85); passage.player.setRotation(0);
  const state = passage.player.captureTransition(portals[9]); passage.dispose();
  const bay = room(9, { entryState: state, fromPassage: true });
  assert.equal(bay.player.getState().floating, true); assert.equal(bay.player.getState().climbing, false);
  step(bay, 3); const y = bay.player.body.position.y; key('Space'); step(bay, 0.4); key('Space', 'keyup'); assert.ok(bay.player.body.position.y > y + 0.5);
  bay.player.setPosition(10.2, 0.3, 5); tap('KeyE'); assert.equal(bay.isGravityRestored(), true); step(bay, 0.5);
  tap('KeyE'); assert.equal(bay.isGravityRestored(), false); key('Space'); step(bay, 0.5); assert.ok(bay.player.body.position.y > 1);
});
