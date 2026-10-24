import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let server,
  createScene,
  THREE,
  CANNON,
  GLTFLoader,
  bossBytes,
  boyBytes,
  droneJSON,
  droneBytes,
  zeroGBossRules,
  phaseFourRules,
  updateComicEffects,
  clearComicEffects,
  disposeComicEffects;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createScene } = await server.ssrLoadModule(
    "/scenes/level 1 boss stage/scene13.ts",
  ));
  ({ ZERO_G_BOSS: zeroGBossRules, PHASE4_RULES: phaseFourRules } =
    await server.ssrLoadModule("/scripts/npc/mechBaymaxBoss.ts"));
  ({ updateComicEffects, clearComicEffects, disposeComicEffects } =
    await server.ssrLoadModule("/scripts/global/comicEffects.ts"));
  // Use the scene's module graph: Windows drive-letter casing can otherwise load
  // two copies of Three.js, breaking instanceof checks for the imported real rig.
  THREE = await server.ssrLoadModule("three");
  CANNON = await server.ssrLoadModule("cannon-es");
  ({ GLTFLoader } = await server.ssrLoadModule(
    "three/addons/loaders/GLTFLoader.js",
  ));
  const binary = async (path) => {
    const bytes = await readFile(new URL(path, import.meta.url));
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  };
  [bossBytes, boyBytes, droneBytes, droneJSON] = await Promise.all([
    binary("../src/assets/models/bayboss.glb"),
    binary("../src/assets/models/boy.glb"),
    binary("../src/assets/models/Tools/Enemy_EyeDrone.bin"),
    readFile(
      new URL(
        "../src/assets/models/Tools/Enemy_EyeDrone.gltf",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
});
after(async () => server?.close());

function parse(bytes, buffer) {
  const loader = new GLTFLoader();
  // Preserve actual skin, bones, geometry, and clips; only image decoding is mocked.
  loader.register((parser) => ({
    name: "NodeAssetTransport",
    beforeRoot() {
      if (buffer)
        parser.cache.add("buffer:0", Promise.resolve(buffer.slice(0)));
    },
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader.parseAsync(
    typeof bytes === "string" ? bytes : bytes.slice(0),
    "",
  );
}
async function fixture(t, options = {}) {
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    self: globalThis.self,
    Audio: globalThis.Audio,
  };
  let data;
  t.after(() => {
    if (data) {
      disposeComicEffects(data.scene);
      data.dispose();
    }
    Object.assign(globalThis, old);
  });
  globalThis.Audio = class extends EventTarget {
    load() {}
    pause() {}
    play() {
      return Promise.resolve();
    }
  };
  globalThis.self = globalThis;
  class Element extends EventTarget {
    classes = new Set();
    dataset = {};
    children = [];
    textContent = "";
    style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, active) =>
        active ? this.classes.add(name) : this.classes.delete(name),
    };
    set className(value) {
      this.classes = new Set(value.split(/\s+/));
    }
    setAttribute() {}
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    remove() {}
    requestPointerLock() {}
    getContext() {
      return new Proxy(
        { measureText: (text) => ({ width: text.length * 60 }) },
        { get: (target, key) => target[key] ?? (() => {}) },
      );
    }
  }
  globalThis.HTMLElement = Element;
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 1280,
    innerHeight: 720,
    location: new URL("http://localhost/"),
  });
  const subtitles = new Element();
  globalThis.document = Object.assign(new EventTarget(), {
    body: new Element(),
    baseURI: "http://localhost/",
    pointerLockElement: null,
    getElementById: (id) => (id === "boss-subtitles" ? subtitles : null),
    createElement: () => new Element(),
  });
  data = createScene({
    checkpoint: true,
    loadBoss: () => parse(bossBytes),
    loadBoy: () => parse(boyBytes),
    loadDrone: () => parse(droneJSON, droneBytes),
    ...options,
  });
  await data.ready;
  if (!options.defeated)
    assert.ok(
      data.boss.bodyTarget.root.getObjectsByProperty("isSkinnedMesh", true)
        .length,
      "actual boss rig must load",
    );
  data.player.setPosition(0, 0.3, 10);
  return data;
}
function tick(data, dt = 1 / 60) {
  data.player.heal(100);
  data.updatePhysics(dt, true);
}
function until(data, predicate, seconds = 20, fps = 60) {
  for (let i = 0; i < seconds * fps && !predicate(); i++) tick(data, 1 / fps);
  assert.ok(predicate(), JSON.stringify(data.boss.getStatus()));
}
function advanceToTransformation(data) {
  for (let phase = 1; phase <= 2; phase++) {
    until(data, () => data.boss.getStatus().phase === "flying");
    for (const target of data.boss.targets)
      while (target.hits()) assert.equal(target.damage(25, "pistol"), true);
    until(data, () => data.boss.getStatus().phase === "exposed");
    assert.equal(data.boss.bodyTarget.damage(250, "pistol"), true);
  }
  assert.equal(data.boss.getStatus().health, 480);
  assert.equal(data.boss.getStatus().phase, "phaseThreeAwakening");
}
function pairs(world) {
  const a = [],
    b = [];
  world.broadphase.collisionPairs(world, a, b);
  return a.map((body, i) => [body, b[i]]);
}

function key(code, type = "keydown") {
  const event = new Event(type);
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: false },
  });
  window.dispatchEvent(event);
}
function renderEffects(data, dt = 0) {
  const head = data.boss.head.getWorldPosition(new THREE.Vector3());
  const camera = data.camera.clone();
  camera.aspect = 16 / 9;
  camera.fov = 70;
  camera.updateProjectionMatrix();
  camera.position.copy(head).add(new THREE.Vector3(0, 2, 15));
  camera.lookAt(head);
  camera.updateMatrixWorld(true);
  updateComicEffects(data.scene, camera, dt, {
    getSize: (size) => size.set(1280, 720),
  });
  return data.scene
    .getObjectByName("ComicCombatEffects")
    .children.filter((sprite) => sprite.visible);
}
async function phaseFourFixture(t) {
  const data = await fixture(t, { startAtPhaseFour: true });
  until(
    data,
    () => !data.isCinematic() && data.boss.getStatus().phase === "zeroG",
  );
  until(data, () => data.boss.getStatus().zeroGStage === "drones");
  clearComicEffects(data.scene);
  return data;
}

test("Bay13 refinements introduce the mining bot as Prime while leaving the service lift", async (t) => {
  const data = await fixture(t, {
    checkpoint: false,
    fromServiceLift: true,
  });
  for (let i = 0; i < 60; i++) tick(data);
  assert.match(
    document.getElementById("boss-subtitles").textContent,
    /^Prime: This is the mining bot Brondon was designing, but it looks like it wants to fight\./,
  );
  const signs = [];
  data.door.group.traverse((node) => {
    if (node.isMesh && node.material?.map?.isCanvasTexture) signs.push(node);
  });
  assert.ok(
    signs.some((sign) => !sign.visible),
    "door sign is hidden",
  );
});

test("Bay13 refinements walk to phase four without a snap, then show possession before Donus speaks", async (t) => {
  const data = await fixture(t);
  advanceToTransformation(data);
  until(
    data,
    () => data.boss.getStatus().phase === "gravity" && data.player.isEnabled(),
  );
  for (const target of data.boss.targets)
    while (target.hits()) assert.equal(target.damage(25, "pistol"), true);
  for (const target of data.boss.getDamageTargets())
    if (target.root.name.startsWith("BossEyeDrone"))
      assert.equal(target.damage(25, "pistol"), true);
  until(data, () => data.boss.getStatus().phase === "exposed");
  data.boss.root.position.set(7, data.boss.root.position.y, -4);
  const previous = data.boss.getRootPosition();
  assert.equal(data.boss.bodyTarget.damage(250, "pistol"), true);
  assert.equal(data.boss.getStatus().phase, "phaseFourReturn");
  assert.equal(data.player.isEnabled(), false);
  assert.equal(data.boss.root.position.x, previous.x);
  assert.equal(data.boss.root.position.z, previous.z);
  let moved = false;
  for (
    let i = 0;
    i < 600 && data.boss.getStatus().phase === "phaseFourReturn";
    i++
  ) {
    tick(data, 1 / 30);
    const current = data.boss.getRootPosition();
    const travel = Math.hypot(current.x - previous.x, current.z - previous.z);
    assert.ok(travel <= phaseFourRules.returnWalkSpeed / 30 + 1e-4);
    moved ||= travel > 0.01;
    previous.copy(current);
  }
  assert.ok(moved, "the bot visibly walks");
  assert.equal(data.boss.getStatus().phase, "phaseFourAwakening");
  assert.ok(
    Math.abs(data.boss.root.position.x - phaseFourRules.bossHoverX) < 1e-4,
  );
  assert.ok(
    Math.abs(data.boss.root.position.z - phaseFourRules.bossHoverZ) < 1e-4,
  );
  const aura = data.boss.root.getObjectByName("BossEnergyAura");
  assert.equal(aura.children.filter((ring) => ring.visible).length, 10);
  for (let i = 0; i < 120; i++) {
    tick(data);
    assert.doesNotMatch(
      document.getElementById("boss-subtitles").textContent,
      /^Donus:/,
    );
  }
  for (let i = 0; i < 45; i++) tick(data);
  assert.match(
    document.getElementById("boss-subtitles").textContent,
    /^Donus:/,
  );
});

test("Bay13 refinements bake the dying shell, instance debris and disintegrate Branden without shield overlap", async (t) => {
  const data = await fixture(t);
  until(data, () => data.boss.getStatus().phase === "flying");
  for (const target of data.boss.targets)
    while (target.hits()) assert.equal(target.damage(25, "pistol"), true);
  until(data, () => data.boss.getStatus().phase === "exposed");
  assert.equal(data.boss.bodyTarget.damage(980, "pistol"), true);
  for (const name of ["BossHalfLeft", "BossHalfRight"]) {
    const half = data.scene.getObjectByName(name);
    assert.ok(half);
    assert.equal(half.getObjectsByProperty("isSkinnedMesh", true).length, 0);
    assert.ok(half.children.some((node) => node.isMesh));
  }
  assert.equal(data.scene.getObjectByName("WardenShrapnel").count, 48);
  assert.equal(data.scene.getObjectByName("WardenExplosionSparks").count, 70);
  let physicsSteps = 0;
  const stepPhysics = data.physics.step;
  data.physics.step = (...args) => {
    physicsSteps++;
    return stepPhysics(...args);
  };
  for (let i = 0; i < 180; i++) tick(data);
  assert.equal(physicsSteps, 0, "frozen reveal does not run Cannon contacts");
  const boy = data.scene.getObjectByName("FreedBoy");
  let sawShield = false,
    sawDisintegration = false;
  for (let i = 0; i < 3000 && data.isCinematic(); i++) {
    tick(data);
    const shield = data.scene.children.find(
      (node) =>
        node.isMesh &&
        node.material?.color?.getHex() === 0x6fd8ff &&
        node.geometry.type === "SphereGeometry",
    );
    if (shield?.visible && boy.visible) {
      sawShield = true;
      const gap = Math.hypot(
        boy.position.x - shield.position.x,
        boy.position.z - shield.position.z,
      );
      assert.ok(gap > shield.scale.x + 0.5, "shield stays clear of Branden");
    }
    if (data.scene.getObjectByName("BossBlackParticles").visible)
      sawDisintegration = true;
  }
  assert.ok(sawShield);
  assert.ok(sawDisintegration);
  assert.equal(boy.visible, false);
  assert.equal(boy.userData.disintegrated, true);
  assert.equal(data.isCinematic(), false);
  assert.equal(data.player.isEnabled(), true);
});

test("Bay13 refinements retain unused pillar supplies after victory without console rewards or revisit farming", async (t) => {
  const attempt = await fixture(t);
  const supply = attempt
    .getArenaSupplies()
    .find((item) => item.kind === "shield");
  attempt.player.setPosition(
    Math.sign(supply.position.x) * 15.08,
    supply.position.y - 0.35,
    supply.position.z,
  );
  attempt.updatePhysics(1 / 60, true);
  assert.equal(
    attempt.getArenaSupplies().find((item) => item.id === supply.id).collected,
    true,
  );
  attempt.dispose();
  const revisit = createScene({
    defeated: true,
    checkpoint: true,
    loadBoss: () => parse(bossBytes),
    loadBoy: () => parse(boyBytes),
    loadDrone: () => parse(droneJSON, droneBytes),
  });
  try {
    await revisit.ready;
    assert.equal(
      revisit.getArenaSupplies().find((item) => item.id === supply.id)
        .collected,
      true,
    );
    const health = revisit
      .getArenaSupplies()
      .find((item) => item.kind === "health");
    revisit.player.takeDamage(40, true);
    assert.equal(revisit.player.getHealth(), 60);
    revisit.player.setPosition(0, 0.3, -2);
    revisit.updatePhysics(1 / 60, true);
    assert.equal(
      revisit.player.getHealth(),
      60,
      "console has no bonus health pack",
    );
    revisit.player.setPosition(
      Math.sign(health.position.x) * 15.08,
      health.position.y - 0.35,
      health.position.z,
    );
    revisit.updatePhysics(1 / 60, true);
    assert.equal(revisit.player.getHealth(), 100);
    assert.equal(
      revisit.getArenaSupplies().find((item) => item.id === health.id)
        .collected,
      true,
    );
    assert.equal(revisit.scene.getObjectByName("FreedBoy").visible, false);
  } finally {
    revisit.dispose();
  }
});

for (const fps of [30, 60, 144]) {
  test(`phase-four rear teleport holds facing for 3.5 seconds, then rescans and resumes attacks at ${fps} FPS`, async (t) => {
    const data = await phaseFourFixture(t),
      boss = data.boss;
    const position = boss.getRootPosition(),
      yaw = boss.getYaw();
    data.player.setPosition(
      position.x + Math.sin(yaw) * 4.6,
      5,
      position.z + Math.cos(yaw) * 4.6,
    );
    assert.equal(
      boss.onPlayerTeleport(),
      false,
      "front-side arrivals must not confuse the boss",
    );
    assert.equal(boss.getStatus().zeroGStage, "drones");
    data.player.setPosition(
      position.x - Math.sin(yaw) * 4.6,
      5,
      position.z - Math.cos(yaw) * 4.6,
    );
    assert.equal(boss.onPlayerTeleport(), true);
    assert.equal(boss.getStatus().zeroGStage, "confused");
    assert.equal(
      boss.onPlayerTeleport(),
      false,
      "notifications cannot restart an active confusion window",
    );
    assert.equal(data.scene.getObjectByName("BossScanBeam").visible, false);
    const labels = renderEffects(data);
    assert.equal(labels.length, 1);
    assert.ok(
      labels[0].position.y > boss.head.getWorldPosition(new THREE.Vector3()).y,
    );
    const back = boss
      .getDamageTargets()
      .find((target) => target.root.name === "BossBackTarget");
    assert.equal(
      back.damage(25, "pistol"),
      true,
      "blue target stays vulnerable during confusion",
    );
    for (
      let frame = 0;
      frame < Math.floor((zeroGBossRules.confusionSeconds - 0.1) * fps);
      frame++
    ) {
      tick(data, 1 / fps);
      assert.equal(boss.getStatus().zeroGStage, "confused");
      assert.ok(
        Math.abs(boss.getYaw() - yaw) < 1e-8,
        "boss must not turn during confusion",
      );
      assert.equal(data.scene.getObjectByName("BossScanBeam").visible, false);
      assert.equal(boss.getStatus().drones, 0, "no new drones while confused");
      assert.equal(
        boss.getStatus().projectiles,
        0,
        "no new lasers while confused",
      );
    }
    assert.equal(labels[0].visible, true);
    until(data, () => boss.getStatus().zeroGStage === "scan", 1, fps);
    assert.equal(
      labels[0].visible,
      false,
      "question marks stop when scanning starts",
    );
    tick(data, 1 / fps);
    assert.equal(data.scene.getObjectByName("BossScanBeam").visible, true);
    assert.ok(
      Math.abs(boss.getYaw() - yaw) < 1e-8,
      "rescanning must not snap the boss around",
    );
    until(data, () => boss.getStatus().zeroGStage === "drones", 12, fps);
    until(
      data,
      () => boss.getStatus().drones > 0 && boss.getStatus().projectiles > 0,
      2,
      fps,
    );
    assert.ok(
      Math.abs(boss.getYaw() - yaw) > 0.1,
      "turning resumes after the scan",
    );
    assert.equal(
      back.damage(25, "pistol"),
      true,
      "rescanning preserves previous back-target damage",
    );
    until(data, () => boss.getStatus().zeroGStage === "drones", 1, fps);
    for (
      let frame = 0;
      frame < Math.ceil(zeroGBossRules.backHitGrace * fps) + 1;
      frame++
    )
      tick(data, 1 / fps);
    assert.equal(back.damage(25, "pistol"), true);
    assert.equal(
      boss.getStatus().phase,
      "zeroGOverload",
      "the original three-hit overload still works",
    );
    assert.equal(
      boss.onPlayerTeleport(),
      false,
      "teleports outside the barrage do not confuse him",
    );
  });
}

test("phase-four thrown crystal confuses the boss only on actual rear arrival, and overload cancels the label", async (t) => {
  const data = await phaseFourFixture(t),
    boss = data.boss;
  const position = boss.getRootPosition(),
    yaw = boss.getYaw();
  data.player.setPosition(
    position.x + Math.sin(yaw) * 6,
    5,
    position.z + Math.cos(yaw) * 6,
  );
  data.player.setRotation(yaw, 0);
  data.camera.position.copy(data.player.body.position);
  data.camera.lookAt(position.x, 5, position.z);
  data.camera.updateMatrixWorld(true);
  key("KeyQ");
  for (let frame = 0; frame < 30; frame++) tick(data);
  const click = new Event("mousedown");
  Object.defineProperty(click, "button", { value: 0 });
  window.dispatchEvent(click);
  key("KeyQ", "keyup");
  for (let frame = 0; frame < 18; frame++) tick(data);
  assert.ok(
    data.scene.getObjectByName("PurpleTeleportCrystal"),
    "throw leaves a destination crystal",
  );
  assert.equal(
    boss.getStatus().zeroGStage,
    "drones",
    "throwing alone does not confuse him",
  );
  key("KeyT");
  key("KeyT", "keyup");
  assert.equal(data.getHologramTransition().hologramColor, 0xa44dff);
  for (let frame = 0; frame < 12; frame++) tick(data);
  assert.equal(
    boss.getStatus().zeroGStage,
    "drones",
    "confusion waits for the dissolve-out to finish",
  );
  clearComicEffects(data.scene);
  until(data, () => boss.getStatus().zeroGStage === "confused", 1);
  assert.equal(data.getHologramTransition().hologramColor, 0xa44dff);
  const dx = data.player.body.position.x - position.x,
    dz = data.player.body.position.z - position.z;
  assert.ok(
    dx * Math.sin(boss.getYaw()) + dz * Math.cos(boss.getYaw()) < 0,
    "real teleport arrives behind the boss",
  );
  const labels = renderEffects(data);
  assert.equal(labels.length, 1);
  const back = boss
    .getDamageTargets()
    .find((target) => target.root.name === "BossBackTarget");
  for (let hit = 0; hit < zeroGBossRules.backHitsRequired; hit++) {
    assert.equal(back.damage(25, "pistol"), true);
    if (hit < zeroGBossRules.backHitsRequired - 1)
      for (let frame = 0; frame < 23; frame++) tick(data);
  }
  assert.equal(boss.getStatus().phase, "zeroGOverload");
  assert.equal(boss.getStatus().zeroGStage, null);
  assert.equal(
    labels[0].visible,
    false,
    "overload immediately removes the confusion label",
  );
});

test("real phase-three rig excludes overlap-only narrowphase without removing colliders", async (t) => {
  const data = await fixture(t),
    world = data.physicsWorld;
  advanceToTransformation(data);
  const rigBodies = world.bodies.filter(
    (body) => body.type === CANNON.Body.KINEMATIC && body !== data.player.body,
  );
  assert.ok(
    rigBodies.length >= 20,
    "full rig collision representation remains present",
  );
  const captured = [],
    getContacts = world.narrowphase.getContacts;
  world.narrowphase.getContacts = function (a, b, ...rest) {
    captured.push(...a.map((body, i) => [body, b[i]]));
    return getContacts.call(this, a, b, ...rest);
  };
  until(data, () => data.boss.getStatus().phase === "gravityWindup");
  const optimizedPairs = pairs(world);
  const filtered = world.broadphase.needBroadphaseCollision;
  let legacyPairs;
  try {
    world.broadphase.needBroadphaseCollision =
      CANNON.Broadphase.prototype.needBroadphaseCollision;
    legacyPairs = pairs(world);
  } finally {
    world.broadphase.needBroadphaseCollision = filtered;
  }
  assert.ok(
    legacyPairs.length > 0,
    "test reproduces overlapping scripted rig bodies",
  );
  assert.equal(
    optimizedPairs.length,
    0,
    "no dynamic bodies during the transformation",
  );
  const timings = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    tick(data);
    timings.push(performance.now() - start);
  }
  assert.ok(
    captured.every(
      ([a, b]) =>
        a.type === CANNON.Body.DYNAMIC || b.type === CANNON.Body.DYNAMIC,
    ),
  );
  assert.ok(
    rigBodies.every((body) => body.world === world && body.collisionResponse),
  );
  // Structural assertion is deterministic on slow CI; browser harness reports CPU/GPU budgets.
  t.diagnostic(
    `Transformation: ${legacyPairs.length} legacy pairs -> ${optimizedPairs.length}; simulation mean ${(timings.reduce((a, b) => a + b) / timings.length).toFixed(2)} ms`,
  );
  until(
    data,
    () => data.boss.getStatus().phase === "gravity" && data.player.isEnabled(),
  );
  const drones = data.boss
    .getDamageTargets()
    .filter((target) => target.root.name.startsWith("BossEyeDrone"));
  assert.equal(drones.length, 4);
  assert.deepEqual(data.boss.getStatus().targets, [2, 2, 2, 2]);
  assert.ok(drones.every((drone) => drone.body.type === CANNON.Body.DYNAMIC));
  for (const body of rigBodies)
    assert.equal(filtered.call(world.broadphase, data.player.body, body), true);
  const result = new CANNON.RaycastResult();
  assert.equal(
    world.raycastClosest(
      new CANNON.Vec3(-10, 5, -15),
      new CANNON.Vec3(-16, 5, -15),
      {},
      result,
    ),
    true,
  );
  assert.equal(
    result.body.type,
    CANNON.Body.STATIC,
    "pillar ray queries remain enabled",
  );
  const drone = drones[0].body;
  drone.position.set(-11.25, 5, -15);
  drone.velocity.setZero();
  drone.aabbNeedsUpdate = true;
  for (let i = 0; i < 20; i++) world.step(1 / 120);
  assert.ok(
    drone.position.x > -11.21,
    "dynamic drone is pushed out of the pillar",
  );
  assert.ok(
    captured.some(([a, b]) => a === drone || b === drone),
    "drone still enters narrowphase",
  );
});

for (const [x, z, aspect] of [
  [0, 10, 16 / 9],
  [18, 21, 16 / 9],
  [-16, -18, 9 / 16],
]) {
  test(`drone zoom/pan frames player and blast at (${x}, ${z}), aspect ${aspect}`, async (t) => {
    const data = await fixture(t);
    advanceToTransformation(data);
    until(
      data,
      () =>
        data.boss.getStatus().phase === "gravity" && data.player.isEnabled(),
    );
    data.player.setPosition(x, 0.3, z);
    // Pillars correctly block remote charges. Seed a close approach at the boundary
    // locations to test framing there without bypassing the actual attack/cutscene logic.
    let placed = x === 0,
      setupFrames = 0;
    until(
      data,
      () => {
        // Launch motors can also exceed charge speed; wait until that state has ended.
        if (!placed && setupFrames++ > 180) {
          const charging = data.boss
            .getDamageTargets()
            .find(
              (target) =>
                target.root.name.startsWith("BossEyeDrone") &&
                target.body.velocity.length() > 7,
            );
          if (charging) {
            charging.body.position.set(
              x - Math.sign(x) * 2.4,
              data.player.getHeadY(),
              z,
            );
            charging.body.aabbNeedsUpdate = true;
            placed = true;
          }
        }
        return data.boss.getStatus().phase === "droneExplosion";
      },
      15,
    );
    data.camera.aspect = aspect;
    data.camera.updateProjectionMatrix();
    const frames = [];
    while (data.boss.getStatus().phase === "droneExplosion") {
      data.applyCinematicCamera();
      data.camera.updateMatrixWorld(true);
      const p = data.player.body.position;
      for (const y of [p.y - data.player.radius, p.y + 1.7]) {
        const projected = new THREE.Vector3(p.x, y, p.z).project(data.camera);
        assert.ok(
          Math.abs(projected.x) < 0.95 &&
            Math.abs(projected.y) < 0.95 &&
            projected.z > -1 &&
            projected.z < 1,
          "player stays in frame",
        );
      }
      const blast = data.scene.getObjectByName("EyeDroneExplosion");
      if (blast.visible) {
        const radius = blast.children[0].scale.x;
        for (const offset of [
          [0, 0, 0],
          [radius, 0, 0],
          [-radius, 0, 0],
          [0, radius, 0],
          [0, 0, radius],
          [0, 0, -radius],
        ]) {
          const projected = blast.position
            .clone()
            .add(new THREE.Vector3(...offset))
            .project(data.camera);
          assert.ok(
            Math.abs(projected.x) < 0.95 &&
              Math.abs(projected.y) < 0.95 &&
              projected.z > -1 &&
              projected.z < 1,
            "growing fireball stays in frame",
          );
        }
      }
      frames.push({
        fov: data.camera.fov,
        position: data.camera.position.clone(),
        impact: blast.visible,
      });
      assert.ok(
        data.camera.position.distanceTo(new THREE.Vector3(p.x, p.y + 1, p.z)) >
          2,
        "third-person clearance",
      );
      for (const body of data.physicsWorld.bodies) {
        if (body.type !== CANNON.Body.STATIC || !body.collisionResponse)
          continue;
        if (body.aabbNeedsUpdate) body.updateAABB();
        const bounds = new THREE.Box3(
          new THREE.Vector3().copy(body.aabb.lowerBound),
          new THREE.Vector3().copy(body.aabb.upperBound),
        );
        assert.equal(
          bounds.containsPoint(data.camera.position),
          false,
          `camera stays outside solid room geometry: ${JSON.stringify({ frame: frames.length, camera: data.camera.position, bounds })}`,
        );
      }
      tick(data);
      assert.ok(frames.length < 400, "cinematic completes");
    }
    assert.ok(frames.some((frame) => frame.impact));
    assert.ok(
      frames[0].position.distanceTo(frames.at(-1).position) > 1,
      "camera pans across the action",
    );
    if (aspect > 1)
      assert.ok(
        Math.min(...frames.map((frame) => frame.fov)) < frames[0].fov - 8,
        "visible optical zoom-in",
      );
    assert.equal(data.player.isEnabled(), true);
    assert.equal(
      data.boss.getStatus().drones,
      3,
      "detonated drone does not respawn",
    );
  });
}
