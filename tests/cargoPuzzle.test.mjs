import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
let server, logic, camera;
const scenes = {};
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  logic = await server.ssrLoadModule('/scripts/cargoPuzzle.ts');
  camera = (await server.ssrLoadModule('/core/camera.ts')).applyTraversalCamera;
  for (const id of [8, 9, 10, 11, 12]) scenes[id] = (await server.ssrLoadModule(`/scenes/scene${id}.ts`)).createScene;
});
after(async () => server?.close());
function fixture(t) {
  const old = { window: globalThis.window, document: globalThis.document }, elements = new Map(), rooms = [];
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  globalThis.document = Object.assign(new EventTarget(), { pointerLockElement: null, body: { requestPointerLock() {} },
    getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, { textContent: '', classList: {
          add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
          toggle: (c, on) => (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c),
        } });
      }
      return elements.get(id);
    },
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) }) });
  t.after(() => { rooms.forEach(room => room.dispose()); Object.assign(globalThis, old); });
  return (id, options) => { const room = scenes[id](options); rooms.push(room); return room; };
}
function key(code, type = 'keydown', repeat = false) { const e = new Event(type); Object.defineProperties(e, { code: { value: code }, repeat: { value: repeat } }); window.dispatchEvent(e); }
function tap(code) { key(code); key(code, 'keyup'); }
function step(room, seconds, fps = 60) { for (let i = 0; i < Math.round(seconds * fps); i++) room.updatePhysics(1 / fps, true); }
function move(room, code, seconds, fps = 60) { key(code); step(room, seconds, fps); key(code, 'keyup'); }
function crate(state, room, position, breakable = false, id = `test-${state.cargo.length}`) {
  const record = { id, room, lane: room === 10 ? 10 : 11, position, mode: 'parked', slot: 9, breakable }; state.cargo.push(record); return record;
}
function parked(state, room) { return crate(state, room, { ...logic.PLATES[room], y: 0.7 }, false, `support-${room}`); }
function body(room, record) { return room.cargo.objects.get(record.id).body; }

for (const fps of [30, 60, 144]) {
  test(`Cargo schedule pauses, advances, preserves every-third type and stays bounded at ${fps} FPS`, () => {
    const state = logic.createCargoPuzzleState(); const clock = state.clock;
    for (let i = 0; i < fps * 10; i++) logic.advanceCargo(state, 1 / fps);
    assert.equal(state.clock, clock); state.gravityRestored = true;
    for (let i = 0; i < fps * 130; i++) logic.advanceCargo(state, 1 / fps);
    assert.ok(state.cargo.length <= 24); assert.equal(new Set(state.cargo.map(c => c.id)).size, state.cargo.length);
    for (const item of state.cargo) assert.equal(item.breakable, item.lane === 11 && Number(item.id.split('-').at(-1)) % 3 === 0);
    assert.ok(state.cargo.some(c => c.room === 10)); assert.ok(state.cargo.some(c => c.room === 11));
  });
  for (const id of [10, 11]) {
    test(`Room ${id}: heavy box ignores collisions, WASD drags, plate holds door at ${fps} FPS`, t => {
      const create = fixture(t), state = logic.createCargoPuzzleState(id); state.cargo = [];
      const item = crate(state, id, { x: 0, y: 0.7, z: 1 });
      const room = create(id, { puzzle: state }); step(room, 2, fps);
      room.player.setPosition(0, 0.3, 2.3); room.player.setRotation(0);
      move(room, 'KeyW', 1, fps); assert.ok(Math.abs(body(room, item).position.z - 1) < 1e-6, 'walking cannot shift idle cargo');
      room.player.setPosition(0, 0.3, 2.3); tap('KeyE'); assert.ok(room.cargo.held());
      move(room, 'KeyS', 0.4, fps); assert.ok(item.position.z > 1.4, 'pull');
      move(room, 'KeyW', 0.4, fps); assert.ok(Math.abs(item.position.z - 1) < 0.04, 'push');
      const code = id === 10 ? 'KeyD' : 'KeyA'; move(room, code, 3.4 / 1.25, fps);
      assert.ok(Math.abs(item.position.x - logic.PLATES[id].x) < 0.04, 'strafe in mirrored direction');
      move(room, 'KeyW', 5.5 / 1.25, fps);
      // Room 11 starts its remote reveal once the crate first overlaps the plate.
      if (room.isCinematic()) step(room, 3, fps);
      tap('KeyE'); step(room, 1, fps);
      if (room.isCinematic()) step(room, 3, fps);
      assert.ok(logic.plateCargo(state, id), JSON.stringify(item.position)); assert.equal(room.door.open, 1);
      assert.equal(room.player.getState().boxHandling, false); assert.equal(body(room, item).type, 2);
      if (id === 11) assert.equal(state.revealed, true);
      const snapshot = structuredClone(state); room.dispose();
      const next = create(id, { puzzle: snapshot, fromPassage: true }); step(next, 0.4, fps);
      assert.equal(next.door.open, 1); assert.ok(logic.plateCargo(snapshot, id));
    });
    test(`Room ${id}: player plate pulse cannot be sprinted through at ${fps} FPS`, t => {
      const room = fixture(t)(id); step(room, 2, fps);
      room.player.setPosition(logic.PLATES[id].x, 0.3, -4.5); step(room, 1, fps); assert.equal(room.door.open, 1);
      room.player.setRotation(id === 10 ? Math.PI / 2 : -Math.PI / 2); key('ShiftLeft'); move(room, 'KeyW', 0.51, fps); key('ShiftLeft', 'keyup');
      assert.ok(room.door.open < 0.1, `door closed before player reaches it: ${room.door.open}`);
      room.player.setRotation(0); move(room, 'KeyW', 1, fps); assert.ok(room.player.body.position.z > -5.8);
    });
  }
  test(`Full grip transfer to hub, breakable rejection, durable unlock at ${fps} FPS`, t => {
    const create = fixture(t), state = logic.createCargoPuzzleState(10); state.cargo = []; state.revealed = true;
    parked(state, 10); parked(state, 11);
    const spare = crate(state, 10, { x: 0, y: 0.7, z: -3.2 }, false, 'transfer-cargo');
    const source = create(10, { puzzle: state }); step(source, 2, fps);
    source.player.setPosition(0, 0.3, -1.9); source.player.setRotation(0); tap('KeyE'); assert.ok(source.cargo.held());
    let hub; source.setBackTrigger(transition => { source.dispose(); hub = create(12, { puzzle: state, from: 10, entryState: transition }); });
    key('KeyW'); for (let i = 0; i < fps * 6 && !hub; i++) source.updatePhysics(1 / fps, true);
    assert.ok(hub, 'dragging through door transitions'); assert.equal(hub.cargo.held().record.id, spare.id); assert.equal(spare.room, 12);
    assert.equal(state.cargo.filter(c => c.id === spare.id).length, 1); assert.ok(hub.player.getState().isOnGround);
    assert.ok(hub.player.captureTransition({ x: 0, y: 0, z: 0 }).heldKeys.includes('KeyW'));
    key('KeyW', 'keyup'); hub.cargo.release();
    const wood = crate(state, 12, { x: 0, y: 0.7, z: 0 }, true, 'wood-on-trap'); hub.cargo.update(0); step(hub, 0.2, fps);
    assert.ok(!state.cargo.includes(wood)); assert.equal(state.exitUnlocked, false);
    body(hub, spare).position.set(0, 0.7, 0); body(hub, spare).aabbNeedsUpdate = true;
    step(hub, 1.5, fps); assert.equal(state.exitUnlocked, true); assert.equal(hub.doors.get(13).open, 1);
    assert.ok(state.cargo.includes(spare)); assert.equal(hub.doors.get(10).open, 1); assert.equal(hub.doors.get(11).open, 1);
    hub.dispose(); const revisit = create(12, { puzzle: state, from: 9 }); step(revisit, 1, fps); assert.equal(revisit.doors.get(13).open, 1);
  });
  test(`Spike player damage is cooldown-limited at ${fps} FPS`, t => {
    const state = logic.createCargoPuzzleState(12); const room = fixture(t)(12, { puzzle: state });
    room.player.setPosition(0, 0.3, 0); step(room, 0.9, fps); assert.equal(room.player.getHealth(), 80);
    step(room, 0.2, fps); assert.equal(room.player.getHealth(), 60); assert.equal(state.exitUnlocked, false);
    room.player.setPosition(2, 0.3, 2); step(room, 2, fps); assert.equal(room.player.getHealth(), 60);
  });
}

test('Gravity, handle pickup/installation, lever cutscenes, and gated shortcut form a persistent chain', t => {
  const create = fixture(t), state = logic.createCargoPuzzleState(); const bay = create(9, { puzzle: state, fromPassage: true });
  step(bay, 0.1); assert.equal(bay.isGravityRestored(), false); assert.equal(bay.passageDoor.open, 0);
  bay.player.setPosition(0, 0.3, 11.3); tap('KeyE'); assert.equal(state.gravityRestored, true); step(bay, 1.8);
  assert.ok([...bay.cargo.objects.values()].every(o => Math.abs(o.body.position.x) > 7.7), 'alignment onto both belts');
  bay.player.setPosition(-4, 0.3, -11.3); tap('KeyE'); assert.equal(state.gates[10], true); assert.equal(bay.isCinematic(), true);
  const p = bay.player.body.position.clone(); move(bay, 'KeyW', 1); assert.equal(bay.player.body.position.distanceTo(p), 0);
  step(bay, 2); assert.equal(bay.isCinematic(), false); assert.equal(bay.player.isEnabled(), true);
  const target = bay.getDamageTargets()[0]; assert.ok(target); assert.equal(target.damage(30, 'pistol'), false); target.damage(35, 'crowbar');
  assert.equal(state.handle, 'loose'); step(bay, 0.02);
  bay.player.setPosition(state.handlePosition.x - 1, 0.3, state.handlePosition.z); tap('KeyE'); assert.equal(state.handle, 'carried');
  bay.getDamageTargets()[0]?.damage(35, 'crowbar'); assert.equal(state.handle, 'carried', 'no duplicate reward');
  bay.player.setPosition(4, 0.3, -11.3); tap('KeyE'); assert.equal(state.handle, 'installed'); assert.equal(state.gates[11], false);
  tap('KeyE'); assert.equal(state.gates[11], true); step(bay, 3); bay.dispose();
  const vent = create(8, { puzzle: state }); assert.ok(vent.gates[10].panel.position.y < 0); assert.ok(vent.gates[11].panel.position.y < 0); vent.dispose();
  const hub = create(12, { puzzle: state, from: 10 }); assert.equal(state.shortcutUnlocked, true); hub.dispose();
  const revisit = create(9, { puzzle: state, fromPassage: true }); step(revisit, 1); assert.equal(revisit.passageDoor.open, 1); assert.equal(state.handle, 'installed');
});

test('Conveyor grabs only during stops; detached crates do not rejoin the feed', t => {
  const state = logic.createCargoPuzzleState(10), room = fixture(t)(10, { puzzle: state }); step(room, 2);
  state.clock = 1.3; room.cargo.update(0); const record = state.cargo.find(c => c.room === 10 && c.slot === 9);
  const b = body(room, record); room.player.setPosition(b.position.x + 1.4, 0.3, b.position.z);
  state.clock = 3.1; room.cargo.update(0); tap('KeyE'); assert.equal(room.cargo.held(), null);
  state.clock = 1.3; room.cargo.update(0); tap('KeyE'); assert.ok(room.cargo.held()); tap('KeyE'); const position = { ...record.position };
  assert.ok(Math.abs(position.z - b.position.z) < 1e-9, 'detachment snapshots the current belt position');
  step(room, 20);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(record.position[axis] - position[axis]) < 1e-9);
  assert.equal(record.mode, 'parked');
});

test('Walls stop held cargo and blur releases without residual motion', t => {
  const state = logic.createCargoPuzzleState(10); state.cargo = [];
  const record = crate(state, 10, { x: 4.5, y: 0.7, z: 0 }); const room = fixture(t)(10, { puzzle: state }); step(room, 2);
  room.player.setPosition(3.2, 0.3, 0); tap('KeyE'); move(room, 'KeyW', 3); assert.ok(record.position.x < 5.12);
  move(room, 'KeyS', 1); assert.ok(record.position.x < 4.2);
  window.dispatchEvent(new Event('blur')); assert.equal(room.cargo.held(), null); assert.equal(body(room, record).velocity.length(), 0);
  move(room, 'Space', 0.2); assert.ok(room.player.body.position.y > 0.8);
});

for (const fps of [30, 60, 144]) for (const id of [10, 11]) {
  test(`Actual feed extraction lowers cargo onto mirrored plate ${id} at ${fps} FPS`, t => {
    const state = logic.createCargoPuzzleState(id), room = fixture(t)(id, { puzzle: state }); step(room, 2, fps);
    while (logic.beltMoving(state)) step(room, 1 / fps, fps);
    const record = state.cargo.find(c => c.room === id && c.slot === 9), b = body(room, record), side = id === 10 ? -1 : 1;
    room.player.setPosition(b.position.x - side * 1.4, 0.3, b.position.z);
    const startZ = b.position.z; tap('KeyE'); assert.ok(room.cargo.held());
    move(room, 'KeyS', 7 / 1.25, fps);
    assert.ok(Math.abs(record.position.y - 0.7) < 0.02, 'extracted crate lowers onto deck');
    assert.ok(Math.abs(record.position.x - logic.PLATES[id].x) < 0.04);
    move(room, id === 10 ? 'KeyD' : 'KeyA', (startZ + 4.5) / 1.25, fps);
    tap('KeyE'); step(room, 4, fps);
    assert.ok(logic.plateCargo(state, id), JSON.stringify(record.position)); assert.equal(room.door.open, 1);
    const serial = state.sequence[id]; step(room, 8, fps); assert.ok(state.sequence[id] > serial, 'feed replenishes after extraction');
  });
  test(`Push into hub and pull back to ${id} preserves crate and grip at ${fps} FPS`, t => {
    const create = fixture(t), state = logic.createCargoPuzzleState(id); state.cargo = []; state.revealed = false;
    parked(state, id); state.revealed = id === 11;
    const record = crate(state, id, { x: 0, y: 0.7, z: -3.2 }, id === 11, 'roundtrip');
    const room = create(id, { puzzle: state }); step(room, 2, fps);
    room.player.setPosition(0, 0.3, -1.9); tap('KeyE');
    let hub, returned;
    room.setBackTrigger(transition => { room.dispose(); hub = create(12, { puzzle: state, from: id, entryState: transition }); });
    key('KeyW'); for (let i = 0; i < fps * 5 && !hub; i++) room.updatePhysics(1 / fps, true); key('KeyW', 'keyup');
    assert.ok(hub); assert.ok(hub.cargo.held());
    const expectedDistance = body(hub, record).position.distanceTo(hub.player.body.position);
    assert.ok(expectedDistance > 1.3 && expectedDistance < 1.4, 'destination crate remains at the original grip offset');
    hub.setDoorTrigger(id, transition => { hub.dispose(); returned = create(id, { puzzle: state, fromPassage: true, entryState: transition }); });
    step(hub, 0.1, fps); assert.equal(returned, undefined);
    key('KeyS'); for (let i = 0; i < fps * 5 && !returned; i++) hub.updatePhysics(1 / fps, true); key('KeyS', 'keyup');
    assert.ok(returned, 'pulling backward crosses same doorway');
    step(returned, 0.2, fps);
    assert.equal(returned.cargo.held()?.record.id, record.id);
    assert.equal(record.room, id); assert.equal(record.breakable, id === 11);
    assert.equal(state.cargo.filter(c => c.id === record.id).length, 1);
    assert.ok(Math.abs(body(returned, record).position.distanceTo(returned.player.body.position) - expectedDistance) < 0.02,
      JSON.stringify({ expectedDistance, actual: body(returned, record).position.distanceTo(returned.player.body.position), crate: record.position, player: returned.player.body.position }));
    assert.ok(returned.player.body.position.y > 0.28 && record.position.y > 0.68);
  });
}

test('Removing plate support relocks both faces without hiding the revealed trap', t => {
  const create = fixture(t), state = logic.createCargoPuzzleState(12), room = create(11, { puzzle: state, fromPassage: true });
  const support = logic.plateCargo(state, 11); room.player.setPosition(-3.4, 0.3, -3.1); tap('KeyE');
  move(room, 'KeyS', 1); tap('KeyE'); step(room, 0.5);
  assert.equal(logic.plateCargo(state, 11), undefined); assert.equal(room.door.open, 0);
  assert.equal(state.revealed, true); room.dispose();
  const hub = create(12, { puzzle: state, from: 9 }); step(hub, 1);
  assert.equal(hub.doors.get(11).open, 0); assert.equal(hub.doors.get(10).open, 1); assert.equal(support.room, 11);
});

test('Lost loose handles recover once; installed or carried handles never duplicate', t => {
  const state = logic.createCargoPuzzleState(), room = fixture(t)(9, { puzzle: state, fromPassage: true });
  room.getDamageTargets()[0].damage(35, 'crowbar'); assert.equal(state.handle, 'loose');
  state.handlePosition.y = -5; step(room, 0.1); assert.equal(state.handle, 'missing');
  room.getDamageTargets()[0].damage(35, 'crowbar'); assert.equal(state.handle, 'loose');
  const position = { ...state.handlePosition }; state.gravityRestored = true; step(room, 20); room.getDamageTargets()[0].damage(35, 'crowbar');
  assert.deepEqual(state.handlePosition, position);
  state.handle = 'installed'; state.handlePosition = null; step(room, 18);
  room.getDamageTargets()[0].damage(35, 'crowbar'); assert.equal(state.handle, 'installed'); assert.equal(state.handlePosition, null);
});

test('Detached belt obstacles stop scheduled cargo without overlap and resume after clearing', t => {
  const state = logic.createCargoPuzzleState(10), room = fixture(t)(10, { puzzle: state }); step(room, 2);
  state.clock = 1.2; room.cargo.update(0);
  const record = state.cargo.find(c => c.room === 10 && c.slot === 9), b = body(room, record);
  room.player.setPosition(b.position.x + 1.4, 0.3, b.position.z); tap('KeyE'); tap('KeyE'); step(room, 10);
  assert.equal(state.feedBlocked, true);
  for (const other of state.cargo.filter(c => c.room === 10 && c.mode === 'belt')) assert.ok(Math.abs(other.position.z - record.position.z) >= 1.39);
  tap('KeyE'); move(room, 'KeyS', 2); tap('KeyE'); step(room, 0.2); assert.equal(state.feedBlocked, false);
});

test('Remote shots hide stale HUD, freeze simulation, restore view and never replay', t => {
  const create = fixture(t), state = logic.createCargoPuzzleState(10), room = create(9, { puzzle: state, fromPassage: true }); state.gates[10] = false;
  room.player.setPosition(-4, 0.3, -11.3); room.player.setRotation(0.3, -0.12); step(room, 0.1); tap('KeyE');
  const clock = state.clock, p = room.player.body.position.clone(); step(room, 0.5);
  assert.ok(document.getElementById('loading-bay-status').classList.contains('hidden'));
  assert.ok(document.getElementById('interact-prompt').classList.contains('hidden'));
  assert.equal(state.clock, clock); assert.equal(room.player.body.position.distanceTo(p), 0);
  key('KeyW'); step(room, 2.1); key('KeyW', 'keydown', true); step(room, 0.2); key('KeyW', 'keyup');
  assert.ok(room.player.body.position.distanceTo(p) < 0.0001);
  assert.equal(room.player.getState().yaw, 0.3); assert.equal(room.player.getState().pitch, -0.12);
  assert.equal(room.getRenderScene(), null); tap('KeyE'); assert.equal(room.isCinematic(), false);
  state.gates[11] = false; state.handle = 'installed'; room.player.setPosition(4, 0.3, -11.3); tap('KeyE'); assert.ok(room.isCinematic());
  room.dispose(); assert.equal(room.getRenderScene(), null); assert.equal(state.gates[11], true);
  const revisit = create(9, { puzzle: state, fromPassage: true }); assert.equal(revisit.isCinematic(), false);
});

test('Mouth blockers reject crouching, jumping, and floating players while jaws cycle', t => {
  const create = fixture(t);
  for (const floating of [false, true]) {
    const state = logic.createCargoPuzzleState(10); state.gravityRestored = !floating; state.cargo = [];
    const room = create(9, { puzzle: state, fromPassage: true });
    for (const x of [-7.8, 7.8]) for (const posture of ['normal', 'crouch', 'jump']) {
      room.player.clearInput(); room.player.setPosition(x, floating ? 1.5 : 0.3, -10.6); room.player.setRotation(0);
      if (posture === 'crouch') tap('KeyC'); if (posture === 'jump') tap('Space');
      move(room, 'KeyW', 2); assert.ok(room.player.body.position.z > -12.5, `${floating}/${posture}: mouth is player-proof`);
    }
    room.dispose();
  }
});

test('Airborne players do not strike; death releases cargo and unsupported crates settle', t => {
  const state = logic.createCargoPuzzleState(12), room = fixture(t)(12, { puzzle: state });
  room.player.setPosition(0, 2.5, 0); step(room, 0.2); assert.equal(room.player.getHealth(), 100);
  room.player.setPosition(1.8, 0.3, 4.8); tap('KeyE'); assert.ok(room.cargo.held()); room.player.takeDamage(100); step(room, 0.1);
  assert.equal(room.cargo.held(), null);
  const item = crate(state, 12, { x: 2.5, y: 1.3, z: -3 }); room.cargo.update(0); step(room, 1);
  assert.ok(Math.abs(item.position.y - 0.7) < 1e-6);
});

test('Fresh-session connected route earns gates, both plates, shortcut, and final unlock without state injection', t => {
  const create = fixture(t), puzzle = logic.createCargoPuzzleState(); let active = create(8, { puzzle });
  const change = (id, options = {}) => { active.dispose(); active = create(id, { puzzle, ...options }); };
  const walkToTransition = code => {
    const source = active; key(code);
    for (let i = 0; i < 60 * 20 && active === source; i++) source.updatePhysics(1 / 60, true);
    key(code, 'keyup'); assert.notEqual(active, source, 'door/drop transition completes');
  };
  const enterBranch = id => {
    active.setReturnToEight(() => change(8, { entry: 'deck' }));
    active.player.setPosition(0, 0.3, 0.72); tap('KeyE');
    for (let i = 0; i < 60 * 14 && active.roomId === 'loading-bay'; i++) active.updatePhysics(1 / 60, true);
    assert.equal(active.roomId, 'maintenance-vent');
    (id === 10 ? active.setDropToTen : active.setDropToEleven)(state => change(id, { entryState: state }));
    active.player.setPosition(0, 0.3, 0); step(active, 0.1); tap(id === 10 ? 'KeyD' : 'KeyA'); step(active, 0.5);
    walkToTransition('KeyW'); step(active, 2);
  };
  const extract = (id, toPlate, breakable) => {
    let item;
    for (let i = 0; i < 60 * 70 && !item; i++) {
      if (!logic.beltMoving(puzzle)) item = puzzle.cargo.find(c => c.room === id && c.mode === 'belt' && c.slot === 9 && (breakable === undefined || c.breakable === breakable));
      if (!item) step(active, 1 / 60);
    }
    assert.ok(item, 'repeating feed supplies requested cargo');
    const b = body(active, item), side = id === 10 ? -1 : 1, goal = toPlate ? logic.PLATES[id].x : 0;
    active.player.setPosition(b.position.x - side * 1.4, 0.3, b.position.z); tap('KeyE'); assert.equal(active.cargo.held()?.record.id, item.id);
    move(active, 'KeyS', Math.abs(goal - b.position.x) / 1.25); tap('KeyE'); step(active, 0.2);
    active.player.setPosition(item.position.x, 0.3, item.position.z + 1.3); tap('KeyE');
    if (toPlate) {
      move(active, 'KeyW', (item.position.z + 4.5) / 1.25); tap('KeyE'); step(active, 4);
      assert.equal(logic.plateCargo(puzzle, id)?.id, item.id);
    }
    return item;
  };
  active.setDescendToNine(() => change(9)); active.player.setPosition(0, 0.3, 6.5); tap('KeyE'); step(active, 2); step(active, 12);
  assert.equal(active.passageDoor.open, 0);
  active.player.setPosition(0, 0.3, 11.3); tap('KeyE'); step(active, 2);
  active.player.setPosition(-4, 0.3, -11.3); tap('KeyE'); step(active, 3);
  active.getDamageTargets()[0].damage(35, 'crowbar'); step(active, 0.1);
  active.player.setPosition(puzzle.handlePosition.x - 1, 0.3, puzzle.handlePosition.z); tap('KeyE');
  active.player.setPosition(4, 0.3, -11.3); tap('KeyE'); assert.equal(puzzle.gates[11], false); tap('KeyE'); step(active, 3);
  assert.deepEqual(puzzle.gates, { 10: true, 11: true });
  enterBranch(10); extract(10, true);
  active.setBackTrigger(state => change(12, { from: 10, entryState: state })); active.player.setPosition(0, 0.3, -4.5); active.player.setRotation(0); walkToTransition('KeyW');
  assert.equal(puzzle.shortcutUnlocked, true); assert.equal(puzzle.revealed, false);
  active.setDoorTrigger(9, state => change(9, { fromPassage: true, entryState: state })); active.player.setPosition(0, 0.3, -8.5); active.player.setRotation(0); walkToTransition('KeyW');
  enterBranch(11); extract(11, true); assert.equal(puzzle.revealed, true);
  for (const breakable of [true, false]) {
    const item = extract(11, false, breakable);
    active.setBackTrigger(state => change(12, { from: 11, entryState: state })); walkToTransition('KeyW');
    assert.equal(active.cargo.held()?.record.id, item.id);
    move(active, 'KeyW', Math.abs(item.position.x) / 1.25); step(active, 1.5);
    assert.equal(puzzle.exitUnlocked, !breakable);
    if (breakable) {
      assert.ok(!puzzle.cargo.includes(item));
      active.setDoorTrigger(11, state => change(11, { fromPassage: true, entryState: state }));
      active.player.setPosition(2.6, 0.3, 0); active.player.setRotation(-Math.PI / 2); walkToTransition('KeyW');
    }
  }
  assert.equal(active.doors.get(13).open, 1); assert.ok(logic.plateCargo(puzzle, 10)); assert.ok(logic.plateCargo(puzzle, 11));
});

test('Disposal releases cargo bodies, event listeners and remote render scenes', t => {
  const room = fixture(t)(11); room.dispose(); tap('KeyE'); assert.equal(room.physicsWorld.bodies.length, 0); assert.equal(room.cargo.objects.size, 0); assert.equal(room.getRenderScene(), null);
});
