import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createServer } from "vite";

let server, createScenePhysics, createPlayer, PHYSICS;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createScenePhysics, PHYSICS } = await server.ssrLoadModule(
    "/helpers/physics/scenePhysics.ts",
  ));
  ({ createPlayer } = await server.ssrLoadModule("/scripts/player/player.ts"));
});
after(async () => server?.close());

function fixture(t) {
  const previous = Object.fromEntries(
    ["window", "document", "HTMLElement"].map((name) => [
      name,
      globalThis[name],
    ]),
  );
  globalThis.HTMLElement = class extends EventTarget {
    closest() {
      return null;
    }
  };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), {
    pointerLockElement: null,
    hidden: false,
    body: { requestPointerLock() {}, classList: { contains: () => false } },
  });
  const physics = createScenePhysics();
  physics.addBox({ x: 40, y: 0.4, z: 40 }, { x: 0, y: -0.2, z: 0 });
  const camera = new THREE.PerspectiveCamera();
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 0 },
  });
  player.enable();
  t.after(() => {
    player.dispose();
    physics.dispose();
    Object.assign(globalThis, previous);
  });
  function advance(seconds, dt = 1 / 60, check) {
    for (let frame = 0; frame < Math.ceil(seconds / dt); frame++) {
      physics.step(dt, player);
      check?.();
    }
  }
  function top() {
    player.body.updateAABB();
    return player.body.aabb.upperBound.y;
  }
  return { physics, player, camera, advance, top };
}

function tap(code) {
  for (const type of ["keydown", "keyup"]) {
    key(code, type);
  }
}

function key(code, type = "keydown") {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "code", { value: code });
  window.dispatchEvent(event);
}

test("ceiling slabs start at the visible underside and reject invalid dimensions", (t) => {
  const { physics } = fixture(t);
  const roof = physics.addCeiling({ x: 8, z: 10 }, { x: 5, y: 3, z: -7 }, 0.2);
  roof.updateAABB();
  assert.equal(roof.type, CANNON.Body.STATIC);
  assert.equal(roof.collisionResponse, true);
  assert.deepEqual(roof.aabb.lowerBound.toArray(), [1, 3, -12]);
  assert.deepEqual(roof.aabb.upperBound.toArray(), [9, 3.2, -2]);
  for (const thickness of [0, -1, NaN, Infinity])
    assert.throws(
      () =>
        physics.addCeiling({ x: 8, z: 10 }, { x: 0, y: 3, z: 0 }, thickness),
      /finite and positive/,
    );
});

test("the player has standing head collision and a shorter crouched body", (t) => {
  const { player, camera, advance, top } = fixture(t);
  advance(0.1);
  assert.ok(Math.abs(top() - 1.9) < 0.02);
  tap("KeyC");
  advance(0.1);
  assert.equal(player.getState().crouching, true);
  assert.ok(Math.abs(top() - 1.2) < 0.02);
  assert.ok(Math.abs(player.getHeadY() - camera.position.y) < 0.02);
  tap("KeyC");
  advance(0.1);
  assert.ok(Math.abs(top() - 1.9) < 0.02);
});

for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.1]) {
  test(`jumping cannot put the head or camera through a roof at dt=${dt}`, (t) => {
    const { physics, player, camera, advance, top } = fixture(t);
    physics.addCeiling({ x: 8, z: 8 }, { x: 0, y: 2.6, z: 0 });
    advance(0.2, dt);
    tap("Space");
    let highest = 0;
    advance(1.5, dt, () => {
      highest = Math.max(highest, top());
      assert.ok(top() <= 2.6 + PHYSICS.contactTolerance);
      assert.ok(camera.position.y < 2.6);
    });
    assert.ok(highest > 2.5, "the jump must actually reach the roof");
    assert.equal(player.getState().isOnGround, true);
    assert.equal(player.getState().jumping, false);
  });

  test(`fast upward motion cannot tunnel through a thin roof at dt=${dt}`, (t) => {
    const { physics, player, advance, top } = fixture(t);
    physics.addCeiling({ x: 8, z: 8 }, { x: 0, y: 3, z: 0 }, 0.08);
    player.setPosition(3.85, 0.5, 0);
    player.body.velocity.y = 80;
    advance(0.2, dt, () => {
      assert.ok(
        top() <= 3 + PHYSICS.contactTolerance,
        `head crossed the roof: ${top()}`,
      );
    });
    assert.ok(player.body.velocity.y <= 0);
    assert.equal(player.getState().isOnGround, false);
    advance(1, dt);
    assert.equal(player.getState().isOnGround, true);
  });
}

test("standing up under a roof is blocked without forcing the player through it", (t) => {
  const { physics, player, camera, advance, top } = fixture(t);
  physics.addCeiling({ x: 2, z: 4 }, { x: 0, y: 1.35, z: 0 });
  tap("KeyC");
  advance(0.1);
  tap("KeyC");
  advance(0.2);
  assert.equal(player.getState().crouching, true);
  assert.ok(top() < 1.35);
  assert.ok(camera.position.y < 1.05);
  player.setPosition(3, PHYSICS.playerRadius, 0);
  tap("KeyC");
  advance(0.1);
  assert.equal(player.getState().crouching, false);
  assert.ok(top() > 1.8);
});

test("vent and forced-crouch modes retain low physical head clearance", (t) => {
  const { physics, player, advance, top } = fixture(t);
  physics.addCeiling({ x: 8, z: 8 }, { x: 0, y: 1.35, z: 0 });
  for (const mode of ["setVentMode", "setForcedCrouch"]) {
    player[mode](true);
    advance(0.2);
    assert.ok(top() <= 1.22);
    tap("Space");
    advance(0.2);
    assert.ok(top() < 1.35);
    player[mode](false);
  }
});

test("a slide fits below a low roof and recovers crouched instead of phasing upward", (t) => {
  const { physics, player, camera, advance, top } = fixture(t);
  physics.addCeiling({ x: 8, z: 6 }, { x: 0, y: 1.35, z: -3 });
  player.setPosition(0, PHYSICS.playerRadius, 4);
  key("KeyW");
  key("ShiftLeft");
  advance(0.2);
  tap("KeyC");
  assert.equal(player.getState().sliding, true);
  advance(1.6, 1 / 60, () => {
    if (player.body.position.z < -0.3) {
      assert.ok(top() <= 1.35 + PHYSICS.contactTolerance);
      assert.ok(camera.position.y < 1.1);
    }
  });
  assert.ok(player.body.position.z < -1);
  assert.equal(player.getState().sliding, false);
  assert.equal(player.getState().crouching, true);
});

test("sprint is still required to enter a slide", (t) => {
  const { player, advance } = fixture(t);
  key("KeyW");
  advance(0.2);
  tap("KeyC");
  assert.equal(player.getState().sliding, false);
  assert.equal(player.getState().crouching, true);
  tap("KeyC");
  key("ShiftLeft");
  advance(0.1);
  tap("KeyC");
  assert.equal(player.getState().sliding, true);
});

test("intentional ceiling hatches remain open", (t) => {
  const { physics, player, advance } = fixture(t);
  for (const x of [-2.425, 2.425])
    physics.addCeiling({ x: 3.15, z: 8 }, { x, y: 3, z: 0 });
  for (const z of [-2.425, 2.425])
    physics.addCeiling({ x: 1.7, z: 3.15 }, { x: 0, y: 3, z });
  player.setPosition(0, 0.5, 0);
  player.body.velocity.y = 20;
  advance(0.3);
  assert.ok(player.body.position.y > 4);
});

test("ceiling protection honors sensors and collision masks", (t) => {
  const { physics, player, advance } = fixture(t);
  const sensor = physics.addCeiling({ x: 8, z: 8 }, { x: 0, y: 2.6, z: 0 });
  sensor.collisionResponse = false;
  const excluded = physics.addCeiling({ x: 8, z: 8 }, { x: 0, y: 3.1, z: 0 });
  excluded.collisionFilterGroup = 2;
  player.body.collisionFilterMask = 1;
  player.setPosition(0, 0.5, 0);
  player.body.velocity.y = 20;
  advance(0.3);
  assert.ok(player.body.position.y > 4);
});

test("ceiling collision follows parented, translated and rotated roof boxes", (t) => {
  const { physics, player, advance, top } = fixture(t);
  const group = new THREE.Group();
  group.position.set(6, 3, -4);
  group.rotation.y = Math.PI / 4;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.12, 8),
    new THREE.MeshBasicMaterial(),
  );
  roof.position.y = 0.06;
  group.add(roof);
  physics.addBoxFromMesh(roof);
  t.after(() => {
    roof.geometry.dispose();
    roof.material.dispose();
  });
  player.setPosition(6, 0.5, -4);
  player.body.velocity.y = 80;
  advance(0.2, 1 / 30, () => assert.ok(top() <= 3 + PHYSICS.contactTolerance));
});
