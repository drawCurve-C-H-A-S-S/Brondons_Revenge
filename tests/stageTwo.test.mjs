import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let server,
  THREE,
  CANNON,
  GLTFLoader,
  layout,
  createStage,
  createStorage,
  createHangar,
  hangarLayout;
let createPhysics,
  createPlayer,
  createCctv,
  cameraFootage,
  createEquipment,
  createRust,
  createRust2,
  keycardJSON,
  corridorMonitor,
  droneStrategy;
const rooms = {};
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "stage-two-test-deps",
        resolveId: (id) =>
          id === "virtual:stage-two-deps" ? "\0stage-two-deps" : null,
        load: (id) =>
          id === "\0stage-two-deps"
            ? "export * as THREE from 'three'; export * as CANNON from 'cannon-es'; export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';"
            : null,
      },
    ],
  });
  ({ THREE, CANNON, GLTFLoader } = await server.ssrLoadModule(
    "virtual:stage-two-deps",
  ));
  layout = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/stageTwoLayout.ts",
  );
  ({ createScene: createStage } = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/scene.ts",
  ));
  ({ createScene: createStorage } = await server.ssrLoadModule(
    "/scenes/level 1 stage 1/storageRoom.ts",
  ));
  ({ createStealthHangar: createHangar, HANGAR_LAYOUT: hangarLayout } =
    await server.ssrLoadModule("/scenes/level 1 stage 1/stealthHangar.ts"));
  ({ createScenePhysics: createPhysics } = await server.ssrLoadModule(
    "/helpers/physics/scenePhysics.ts",
  ));
  ({ createPlayer } = await server.ssrLoadModule("/scripts/player/player.ts"));
  ({ createCctvSystem: createCctv, CAMERA_FOOTAGE: cameraFootage } =
    await server.ssrLoadModule("/scripts/npc/cctv.ts"));
  ({ createScene: createEquipment } = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/equipmentRoom.ts",
  ));
  ({ createScene: createRust } = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/rustChamber.ts",
  ));
  ({ createScene: createRust2 } = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/rustChamber2.ts",
  ));
  corridorMonitor = await server.ssrLoadModule(
    "/scripts/global/corridorMonitor.ts",
  );
  droneStrategy = await server.ssrLoadModule(
    "/scenes/level 1 stage 1/stealthDirector.ts",
  );
  for (const [id, name] of [
    [5, "cargoHold"],
    [6, "targetRange"],
  ])
    rooms[id] = (
      await server.ssrLoadModule(`/scenes/level 1 stage 2/${name}.ts`)
    ).createScene;
  const base = new URL("../src/assets/models/Tools/", import.meta.url);
  keycardJSON = JSON.parse(
    await readFile(new URL("Prop_KeyCard.gltf", base), "utf8"),
  );
  for (const buffer of keycardJSON.buffers)
    buffer.uri = `data:application/octet-stream;base64,${(await readFile(new URL(buffer.uri, base))).toString("base64")}`;
  delete keycardJSON.materials;
  delete keycardJSON.textures;
  delete keycardJSON.images;
  for (const mesh of keycardJSON.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
});
after(async () => server?.close());

function browser(t) {
  const previous = Object.fromEntries(
    ["window", "document", "HTMLElement", "ProgressEvent"].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const elements = new Map();
  const context = new Proxy(
    {
      measureText: (text) => ({ width: text.length * 14 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    },
    { get: (target, name) => target[name] ?? (() => {}) },
  );
  class Element extends EventTarget {
    constructor(tag = "div") {
      super();
      this.tagName = tag.toUpperCase();
    }
    style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    dataset = {};
    children = [];
    classes = new Set();
    selectors = new Map();
    textContent = "";
    set className(value) {
      this.classes = new Set(value.split(/\s+/).filter(Boolean));
    }
    get className() {
      return [...this.classes].join(" ");
    }
    classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force = !this.classes.has(name)) => {
        this.classList[force ? "add" : "remove"](name);
        return force;
      },
    };
    append(...nodes) {
      nodes.forEach((node) => {
        this.children.push(node);
        node.parent = this;
      });
    }
    appendChild(node) {
      this.append(node);
      return node;
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter(
          (node) => node !== this,
        );
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    removeAttribute(name) {
      delete this[name];
    }
    closest(selector) {
      return selector
        .split(",")
        .some((tag) => tag.trim().toUpperCase() === this.tagName)
        ? this
        : null;
    }
    querySelector(selector) {
      if (!this.selectors.has(selector))
        this.selectors.set(
          selector,
          new Element(selector === "img" ? "img" : "div"),
        );
      return this.selectors.get(selector);
    }
    getContext() {
      return context;
    }
    requestPointerLock() {}
  }
  globalThis.HTMLElement = Element;
  globalThis.ProgressEvent = class extends Event {};
  const body = new Element("body");
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
  });
  globalThis.document = Object.assign(new EventTarget(), {
    body,
    hidden: false,
    pointerLockElement: body,
    baseURI: "http://localhost:5174/",
    createElement: (tag) => new Element(tag),
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
  });
  const cleanup = [];
  t.cleanup = (fn) => cleanup.push(fn);
  t.after(() => {
    for (const fn of cleanup.reverse()) fn();
    Object.assign(globalThis, previous);
  });
  return elements;
}
async function modelLoader(name) {
  if (name === "Prop_KeyCard")
    return new GLTFLoader().parseAsync(JSON.stringify(keycardJSON), "");
  const scene = new THREE.Group();
  const dimensions =
    name === "Prop_Desk_Small"
      ? [2.4, 0.86, 1.2]
      : name === "Prop_Chair"
        ? [0.6, 1.05, 0.7]
        : [0.8, 1.7, 0.8];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...dimensions),
    new THREE.MeshStandardMaterial(),
  );
  mesh.position.y = dimensions[1] / 2;
  scene.add(mesh);
  return { scene, animations: [] };
}
function key(code, type = "keydown") {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: false },
  });
  window.dispatchEvent(event);
}
function tap(code) {
  key(code);
  key(code, "keyup");
}
function step(data, seconds, fps = 60) {
  for (let i = 0; i < Math.ceil(seconds * fps); i++)
    data.updatePhysics(1 / fps, true);
}
async function stage(
  t,
  progress = layout.createStageTwoProgress(),
  overrides = {},
) {
  const data = createStage({
    progress,
    modelLoader,
    getCameraTarget: () => null,
    holsterWeapons() {},
    onCrowbarCollected() {},
    onRetryFeed() {},
    onCameraTeleport: async () => true,
    onVentDrop: async () => {},
    prepareBay13: async () => {},
    onExitToBay13: async () => true,
    onAirlockReturn: async () => true,
    monitorFactory: () => ({
      texture: new THREE.Texture(),
      ready: Promise.resolve(),
      update() {},
      getFrameIndex: () => 0,
      dispose() {},
    }),
    ...overrides,
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  return data;
}

async function rustTwo(
  t,
  { progress = layout.createStageTwoProgress(), ...options } = {},
) {
  const data = createRust2({
    modelLoader,
    loot: progress.remoteRooms["stage2-rust2"],
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected: () =>
      layout.collectStageTwoKeycard(progress, "stage2-rust2"),
    ...options,
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  return { data, progress };
}

const minigameRooms = [
  "scene5",
  "scene6",
  "stage2-armory",
  "stage2-rust",
  "stage2-rust2",
  "stage2-reactor",
];
const keycardOrders = minigameRooms.flatMap((_id, index) => {
  const order = [
    ...minigameRooms.slice(index),
    ...minigameRooms.slice(0, index),
  ];
  return [order, [...order].reverse()];
});
test("camera wall has one canonical reading order", () => {
  assert.deepEqual(layout.STAGE_TWO_CAMERA_ORDER, [
    "stage2-prison",
    "scene5",
    "stage2-armory",
    "stage2-rust",
    "stage2-vents",
    "scene6",
    "stage2-reactor",
    "stage2-rust2",
  ]);
});

for (const order of keycardOrders) {
  test(`only the final chest keycard works in order ${order.join(" -> ")}`, () => {
    const progress = layout.createStageTwoProgress();
    assert.equal(layout.swipeStageTwoKeycard(progress), "missing");
    assert.equal(layout.collectStageTwoKeycard(progress, "stage2-vents"), true);
    assert.equal(layout.swipeStageTwoKeycard(progress), "rejected");
    order.forEach((id, index) => {
      assert.equal(layout.collectStageTwoKeycard(progress, id), true);
      assert.equal(
        layout.collectStageTwoKeycard(progress, id),
        false,
        "no duplicate cards on revisits",
      );
      assert.equal(
        progress.elevatorUnlocked,
        false,
        "collecting a card never opens the door automatically",
      );
      assert.equal(
        layout.swipeStageTwoKeycard(progress),
        index === order.length - 1 ? "accepted" : "rejected",
      );
    });
    assert.deepEqual(progress.keycards, ["stage2-vents", ...order]);
    assert.equal(progress.acceptedKeycard, order.at(-1));
    assert.equal(progress.elevatorUnlocked, true);
  });
}

test("branching maze has a shorter solution and places every sensor/checkpoint on connected floor", () => {
  const { VENT_MAZE: maze, VENT_START: start, VENT_EXIT: exit } = layout;
  assert.equal(maze.length, 25);
  assert.ok(maze.every((row) => row.length === 17));
  const queue = [[start.column, start.row, 0]],
    seen = new Set([`${start.column},${start.row}`]);
  let distance,
    junctions = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x, z, steps] = queue[i];
    if (x === exit.column && z === exit.row) distance = steps;
    const next = [
      [x - 1, z],
      [x + 1, z],
      [x, z - 1],
      [x, z + 1],
    ].filter(([nx, nz]) => maze[nz]?.[nx] && maze[nz][nx] !== "#");
    if (next.length > 2) junctions++;
    for (const [nx, nz] of next)
      if (!seen.has(`${nx},${nz}`)) {
        seen.add(`${nx},${nz}`);
        queue.push([nx, nz, steps + 1]);
      }
  }
  assert.ok(
    distance >= 40 && distance <= 64,
    `maze should take about half the original 128 steps (${distance})`,
  );
  assert.ok(junctions >= 8);
  assert.equal(seen.size, maze.join("").replaceAll("#", "").length);
  for (const cell of [...layout.VENT_SAFE_CELLS, ...layout.VENT_SENSORS])
    assert.ok(seen.has(`${cell.column},${cell.row}`));
  assert.ok(
    layout.ventPoint(exit.column, exit.row).x === layout.STAGE_TWO.drop.x,
  );
  assert.ok(
    layout.ventPoint(exit.column, exit.row).z === layout.STAGE_TWO.drop.z,
  );
});

for (const fps of [30, 60, 144]) {
  test(`Shift doubles vent speed while retaining crouch, camera clearance and no jump at ${fps} FPS`, (t) => {
    browser(t);
    const physics = createPhysics(),
      camera = new THREE.PerspectiveCamera();
    physics.addBox({ x: 20, y: 0.2, z: 100 }, { x: 0, y: -0.1, z: 0 });
    const player = createPlayer({
      camera,
      physicsWorld: physics.world,
      spawnPosition: { x: 0, y: 0.3, z: 15 },
    });
    t.cleanup(() => {
      player.dispose();
      physics.dispose();
    });
    player.enable();
    player.setVentMode(true);
    const data = { updatePhysics: (dt) => physics.step(dt, player) };
    step(data, 0.2, fps);
    key("KeyW");
    const startZ = player.body.position.z;
    step(data, 1, fps);
    const crawl = startZ - player.body.position.z;
    assert.ok(Math.abs(crawl - 1.6) < 0.1);
    key("ShiftLeft");
    const sprintStart = player.body.position.z;
    step(data, 1, fps);
    assert.ok(
      Math.abs(sprintStart - player.body.position.z - crawl * 2) < 0.12,
    );
    assert.equal(player.getState().sprinting, true);
    assert.equal(player.getState().crouching, true);
    tap("Space");
    tap("KeyC");
    step(data, 0.2, fps);
    assert.equal(player.getState().jumping, false);
    assert.equal(player.getState().sliding, false);
    assert.ok(
      camera.position.y < 1.05,
      "sprinting never stands up in the tunnel",
    );
    key("ShiftLeft", "keyup");
    const slowStart = player.body.position.z;
    step(data, 1, fps);
    assert.ok(Math.abs(slowStart - player.body.position.z - crawl) < 0.12);
    assert.equal(player.getState().sprinting, false);
    key("KeyW", "keyup");
  });
}

test("hangar ladder stays at the far end across from the airlock with a real open ceiling hatch", (t) => {
  browser(t);
  const physics = createPhysics(),
    scene = new THREE.Scene();
  const hangar = createHangar(scene, physics, 12);
  t.cleanup(() => physics.dispose());
  const ladder = hangar.ladders.find((item) => item.id === "VentAccessLadder");
  assert.ok(ladder.x > 80 && ladder.z < -20);
  assert.ok(hangarLayout.exit.z > 15);
  assert.equal(ladder.height, 24.125);
  assert.ok(Math.abs(ladder.topZ - (ladder.z + 0.42)) < 1e-9);
  const hatch = hangarLayout.ventAccess,
    ray = new CANNON.RaycastResult();
  physics.world.raycastClosest(
    new CANNON.Vec3(hatch.x, 23.5, hatch.z),
    new CANNON.Vec3(hatch.x, 24.8, hatch.z),
    {},
    ray,
  );
  assert.equal(
    ray.hasHit,
    false,
    "the shaft must not be capped by a ceiling or fake platform",
  );
  physics.world.raycastClosest(
    new CANNON.Vec3(hatch.x + 1.3, 23.5, hatch.z),
    new CANNON.Vec3(hatch.x + 1.3, 24.8, hatch.z),
    {},
    ray,
  );
  assert.equal(ray.hasHit, true, "ceiling remains solid around the hatch");
  assert.equal(hangar.ladders.length, 13);
  assert.ok(scene.getObjectByName("VentCeilingShaft"));
});

test("ceiling climb loops by height, rises without sideward dismount, and transitions exactly once", async (t) => {
  browser(t);
  let transfers = 0;
  const data = createStorage({
    modelLoader,
    restoreCheckpoint: true,
    onComplete: async () => {
      transfers++;
      return true;
    },
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  data.stealth.actors.forEach((actor) => {
    actor.mode = "reserve";
  });
  const ladder = data.hangar.ladders.find(
    (item) => item.id === "VentAccessLadder",
  );
  data.player.setPosition(ladder.x, 12.3, ladder.topZ);
  tap("KeyE");
  assert.equal(data.isCinematic(), true);
  assert.equal(data.getCinematicPose().loop, true);
  step(data, 2);
  const a = data.getCinematicPose().time;
  const x = data.player.body.position.x,
    z = data.player.body.position.z;
  step(data, 2);
  assert.ok(data.getCinematicPose().time > a);
  assert.equal(data.player.body.position.x, x);
  assert.equal(data.player.body.position.z, z);
  step(data, 12);
  await Promise.resolve();
  assert.equal(transfers, 1);
  assert.ok(data.player.body.position.y >= 24.4);
  step(data, 1);
  assert.equal(transfers, 1);
});

test("vent completion drops through a real hole and loads Phase Two exactly once into surveillance", async (t) => {
  browser(t);
  const progress = layout.createStageTwoProgress();
  let loads = 0,
    release;
  const data = await stage(t, progress, {
    onVentDrop: () => {
      loads++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  assert.equal(data.getStageState().phase, "maze");
  assert.equal(data.player.getState().ventMode, true);
  assert.ok(data.scene.getObjectByName("VentWallTrim"));
  assert.equal(data.scene.getObjectByName("VentRibs"), undefined);
  assert.equal(data.ventChest.root.rotation.y, 0);
  data.player.setPosition(
    layout.STAGE_TWO.ventChest.x - 1.2,
    4.3,
    layout.STAGE_TWO.ventChest.z,
  );
  tap("KeyE");
  step(data, 1);
  assert.equal(data.ventChest.isCollected(), true);
  assert.deepEqual(progress.keycards, ["stage2-vents"]);
  data.player.setPosition(
    layout.STAGE_TWO.drop.x,
    4.3,
    layout.STAGE_TWO.drop.z,
  );
  step(data, 1.8);
  assert.equal(loads, 1);
  assert.equal(data.getStageState().phase, "hub-loading");
  assert.equal(progress.ventCleared, true);
  assert.equal(data.player.isEnabled(), false);
  step(data, 3);
  assert.equal(loads, 1);
  release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(data.getStageState().phase, "surveillance");
  assert.equal(data.player.getState().crouching, false);
  assert.equal(progress.guardDown, true);
  const ui = document.body.children.find((element) =>
    element.classList.contains("stage-two-ui"),
  );
  assert.match(
    ui.children.find((element) =>
      element.classList.contains("stage-two-dialogue"),
    ).textContent,
    /Security seems kind of lacklustre/,
  );
});

test("Phase Two loading uses the actual camera-wall screenshot and holds it for at least three seconds", async (t) => {
  browser(t);
  const previous = globalThis.requestAnimationFrame;
  const previousImage = globalThis.Image;
  const requested = [];
  t.mock.method(Math, "random", () => 0.99);
  t.mock.method(globalThis, "fetch", async (source) => {
    requested.push(source);
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      headers: { "Content-Type": "image/jpeg" },
    });
  });
  globalThis.Image = class {
    async decode() {}
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
  t.after(() => {
    globalThis.requestAnimationFrame = previous;
    globalThis.Image = previousImage;
  });
  const { createCinematicLoadingScreen } = await server.ssrLoadModule(
    "/scripts/global/cinematicLoading.ts",
  );
  const screen = createCinematicLoadingScreen(),
    transition = screen.begin("stage2");
  const root = document.body.children.find((element) =>
    element.classList.contains("cinematic-loading"),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const { LOADING_CHAPTERS } = await server.ssrLoadModule("/core/chapters.ts");
  assert.equal(root.dataset.destination, "stage2");
  assert.equal(
    root.querySelector(".cinematic-loading-chapter").textContent,
    LOADING_CHAPTERS.stage2.chapter,
  );
  assert.equal(
    root.querySelector("h1").textContent,
    LOADING_CHAPTERS.stage2.title,
  );
  assert.ok(requested.some((source) => /stage2-camera-wall/.test(source)));
  assert.match(root.querySelector("img").src, /^blob:/);
  let presented = false;
  void transition.presented.then(() => {
    presented = true;
  });
  for (let frame = 0; frame < 29; frame++) screen.update(0.1);
  await Promise.resolve();
  assert.equal(presented, false);
  screen.update(0.1);
  await transition.presented;
  assert.equal(presented, true);
  transition.finish();
  assert.equal(screen.active, false);
  assert.equal(root.classList.contains("hidden"), true);
});

test("camera-room arrival unlocks the crowbar chest and camera links without a guard", async (t) => {
  browser(t);
  const progress = layout.createStageTwoProgress();
  progress.checkpoint = "surveillance";
  progress.ventCleared = true;
  let teleports = 0,
    crowbars = 0;
  const data = await stage(t, progress, {
    getCameraTarget: () => ({
      id: "scene5",
      label: "Cargo hold",
      status: "ready",
    }),
    onCameraTeleport: async () => {
      teleports++;
      return true;
    },
    onCrowbarCollected: () => crowbars++,
  });
  assert.equal(data.scene.getObjectByName("SurveillanceDoorGuard"), undefined);
  assert.equal(progress.guardDown, true);
  assert.equal(progress.crowbarCollected, false);
  assert.equal(crowbars, 0);
  assert.equal(data.getStageState().phase, "surveillance");
  assert.equal(data.getDamageTargets().length, 0);
  assert.equal(data.player.getState().climbing, false);
  const objective = document.body.children
    .find((item) => item.classList.contains("stage-two-ui"))
    .children.find((item) => item.classList.contains("stage-two-objective"));
  assert.equal(objective.classList.contains("hidden"), true);
  assert.equal(data.crowbarChest.root.position.x, 28);
  assert.equal(data.crowbarChest.root.position.z, -53);
  assert.equal(data.crowbarChest.root.rotation.y, Math.PI);
  assert.equal(data.returnToAnchor(), true);
  assert.equal(data.player.body.position.x, 28);
  assert.equal(data.player.body.position.z, -56);
  data.player.setPosition(
    layout.STAGE_TWO.crowbarChest.x,
    0.3,
    layout.STAGE_TWO.crowbarChest.z - 1.2,
  );
  tap("KeyE");
  step(data, 1);
  assert.equal(progress.crowbarCollected, true);
  assert.equal(crowbars, 1);
  data.player.setPosition(28, 0.3, -48);
  tap("KeyE");
  step(data, 2);
  await Promise.resolve();
  assert.equal(teleports, 1);
  assert.equal(
    data.scene.children.some((item) => /Keypad/i.test(item.name)),
    false,
  );
});

test("camera-room checkpoint restarts directly in surveillance without resetting vent progress", async (t) => {
  browser(t);
  const progress = layout.createStageTwoProgress();
  progress.checkpoint = "surveillance";
  progress.ventCleared = true;
  const data = await stage(t, progress);
  assert.equal(data.onPistolShot, undefined);
  assert.equal(data.restartAtCheckpoint(), true);
  assert.equal(data.getStageState().phase, "surveillance");
  assert.equal(data.player.getHealth(), 100);
  assert.equal(progress.ventCleared, true);
  assert.equal(progress.guardDown, true);
  assert.equal(data.player.getState().crouching, false);
});

test("cleared vent and prison feeds never teleport or add keycards when used", async (t) => {
  browser(t);
  const progress = layout.createStageTwoProgress();
  progress.checkpoint = "surveillance";
  progress.guardDown = true;
  layout.collectStageTwoKeycard(progress, "stage2-vents");
  let transfers = 0,
    id = "stage2-prison";
  const data = await stage(t, progress, {
    getCameraTarget: () => ({ id, label: id, status: "ready" }),
    onCameraTeleport: async () => {
      transfers++;
      return true;
    },
  });
  tap("KeyE");
  step(data, 2);
  id = "stage2-vents";
  tap("KeyE");
  step(data, 2);
  assert.equal(transfers, 0);
  assert.equal(data.getStageState().phase, "surveillance");
  assert.deepEqual(progress.keycards, ["stage2-vents"]);
});

for (const developerAccess of [false, true]) {
  test(`hub elevator access without minigames (developer: ${developerAccess})`, async (t) => {
    browser(t);
    const progress = layout.createStageTwoProgress();
    progress.checkpoint = "surveillance";
    let exits = 0;
    const data = await stage(t, progress, {
      developerAccess,
      onExitToBay13: async () => {
        exits++;
        return true;
      },
    });
    data.player.setPosition(
      layout.STAGE_TWO.elevator.x,
      data.player.radius,
      layout.STAGE_TWO.camera.minZ + 2,
    );
    tap("KeyE");
    assert.equal(
      data.getStageState().phase,
      developerAccess ? "swipe" : "surveillance",
    );
    assert.deepEqual(progress.keycards, []);
    assert.equal(progress.acceptedKeycard, null);
    assert.equal(progress.elevatorUnlocked, false);
    assert.ok(
      Object.values(progress.remoteRooms).every(
        (room) => !room.rewardCollected,
      ),
    );
    if (developerAccess) {
      step(data, 2);
      assert.equal(data.getStageState().phase, "lift");
      step(data, 14);
      await Promise.resolve();
      assert.equal(exits, 1);
      assert.equal(data.getStageState().phase, "handoff");
    }
  });
}

test("orange perimeter lights are removed while detection zones remain", async (t) => {
  browser(t);
  const data = createStorage({ modelLoader, restoreCheckpoint: true });
  t.cleanup(() => data.dispose());
  await data.ready;
  assert.equal(data.hangar.edgeSensors.length, 8);
  for (const sensor of data.hangar.edgeSensors) {
    assert.ok(sensor.width > 0 && sensor.depth > 0);
    assert.equal(data.scene.getObjectByName(sensor.id), undefined);
  }
  let orangeLamps = 0;
  data.scene.traverse((node) => {
    if (node instanceof THREE.PointLight && node.color.getHex() === 0xffbd48)
      orangeLamps++;
  });
  assert.equal(orangeLamps, 0);
});

test("Bloomstick models are always powered", async () => {
  const { createBloomstick, disposeBloomstick } = await server.ssrLoadModule(
    "/scripts/items/createBloomstick.ts",
  );
  const weapon = createBloomstick();
  try {
    assert.equal(createBloomstick.length, 0);
    assert.equal(weapon.getObjectByName("BloomstickBeam").visible, true);
    assert.equal(weapon.getObjectByName("blade").visible, true);
  } finally {
    disposeBloomstick(weapon);
  }
});

test("developer equipment is granted after scene-specific resets and in URL previews", async () => {
  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const enter = main.slice(main.indexOf("async function enterSceneById("));
  assert.ok(
    enter.indexOf("grantDeveloperEquipment();") >
      enter.lastIndexOf("stageTwoProgress = createStageTwoProgress();"),
  );
  const loadout = main.slice(
    main.indexOf("function grantDeveloperEquipment("),
    main.indexOf("function equipmentInputBlocked("),
  );
  assert.match(loadout, /hasPistol = hasCrowbar = hasBloomstick = true/);
  for (const field of [
    "crowbarCollected",
    "bloomstickCollected",
    "pistolCollected",
    "crystalCollected",
    "gogglesCollected",
  ])
    assert.match(loadout, new RegExp(`\\.${field} = true`));
  assert.match(loadout, /goggles\.collect\(false\)/);
  assert.match(loadout, /teleportDevice\.collect\(false\)/);
  assert.match(
    main,
    /if \(developerPreview\) \{[\s\S]*?developerRun = true;[\s\S]*?grantDeveloperEquipment\(\)/,
  );
  assert.match(
    main,
    /function enterManagedScene[\s\S]*?if \(developerRun\) grantDeveloperEquipment\(\)/,
  );
});

test("the final hub keycard swipe immediately boards the elevator and presses its button", async (t) => {
  browser(t);
  const progress = layout.createStageTwoProgress();
  progress.checkpoint = "surveillance";
  progress.guardDown = true;
  progress.ventCleared = true;
  let exits = 0;
  layout.collectStageTwoKeycard(progress, "stage2-vents");
  for (const { id } of layout.STAGE_TWO_MINIGAMES)
    layout.collectStageTwoKeycard(progress, id);
  const data = await stage(t, progress, {
    onExitToBay13: async () => {
      exits++;
      return true;
    },
  });
  let desks = 0,
    computers = 0;
  data.scene.traverse((item) => {
    if (/^SurveillanceDesk-/.test(item.name)) desks++;
    if (/^SurveillanceComputer-/.test(item.name)) computers++;
  });
  assert.equal(desks, 12);
  assert.equal(computers, 12);
  const reader = layout.STAGE_TWO.reader,
    lift = layout.STAGE_TWO.elevator,
    room = layout.STAGE_TWO.camera;
  assert.equal(lift.x, (room.minX + room.maxX) / 2);
  data.player.setPosition(lift.x, 0.3, room.minZ + 2);
  tap("KeyE");
  step(data, 1.9);
  assert.equal(progress.elevatorUnlocked, true);
  assert.equal(data.getStageState().phase, "lift");
  assert.equal(data.controlsReady(), false);
  assert.equal(data.getCinematicPose().clip, "Walk_Loop");
  assert.equal(data.getCinematicPose().handTargets, undefined);
  assert.equal(exits, 0);
  step(data, 1.8);
  assert.equal(data.getCinematicPose().clip, "Interact");
  assert.equal(data.getCinematicPose().handTargets, undefined);
  step(data, 11);
  await Promise.resolve();
  assert.equal(exits, 1);
  assert.equal(data.getStageState().phase, "handoff");
  assert.ok(
    data.scene
      .getObjectByName("ElevatorKeycardReader")
      .position.distanceTo(new THREE.Vector3(reader.x, reader.y, reader.z)) <
      1e-9,
  );
});

for (const id of [5, 6, 37]) {
  test(`minigame ${id} awards the real keycard model even at full health/shield and cannot duplicate it`, async (t) => {
    browser(t);
    const progress = layout.createStageTwoProgress(),
      feedId = id === 37 ? "stage2-armory" : `scene${id}`;
    const options = {
      modelLoader,
      hasReturnMarker: () => true,
      onRestart: async () => true,
      onKeycardCollected: () => layout.collectStageTwoKeycard(progress, feedId),
    };
    const data =
      id === 37
        ? createEquipment({ ...options, progress })
        : rooms[id]({
            ...options,
            remoteVisit: true,
            loot: progress.remoteRooms[feedId],
          });
    t.cleanup(() => data.dispose());
    await data.ready;
    data.player.addShield(50);
    if (id === 6) {
      for (const letter of "BRONDON")
        data
          .getDamageTargets()
          .find((item) => item.root.userData.rangeLetter === letter)
          .damage(100, "pistol");
    } else
      data.breakables?.objects.forEach((item) => item.damage(100, "crowbar"));
    const asset = data.chest.root.getObjectByName("ChestKeycardAsset");
    assert.ok(asset);
    assert.ok(
      new THREE.Box3()
        .setFromObject(asset)
        .getSize(new THREE.Vector3())
        .length() > 0.3,
    );
    data.player.setPosition(
      id === 37 ? -2 : 0,
      0.3,
      id === 37 ? -1.3 : id === 5 ? 2.7 : 3.7,
    );
    tap("KeyE");
    step(data, 1);
    assert.equal(data.chest.isCollected(), true);
    assert.deepEqual(progress.keycards, [feedId]);
    assert.equal(progress.remoteRooms[feedId].rewardCollected, true);
    assert.equal(data.player.getHealth(), 100);
    tap("KeyE");
    step(data, 1);
    assert.deepEqual(progress.keycards, [feedId]);
    if (id === 37) assert.equal(progress.bloomstickCollected, true);
  });
}

for (const [id, name] of [
  [5, "cargo hold"],
  [6, "target range"],
]) {
  test(`${name} has solid ceiling collision across the entire room`, async (t) => {
    browser(t);
    const data = rooms[id]({
      preview: true,
      remoteVisit: true,
      modelLoader,
    });
    t.cleanup(() => data.dispose());
    await data.ready;
    for (const x of [-4.75, 0, 4.75])
      for (const z of [-4.75, 0, 4.75]) {
        let ceilingHit = false;
        data.physicsWorld.raycastAll(
          new CANNON.Vec3(x, 4.4, z),
          new CANNON.Vec3(x, 4.8, z),
          { checkCollisionResponse: true },
          (hit) => {
            if (
              hit.body?.type === CANNON.Body.STATIC &&
              hit.hitNormalWorld.y < -0.99 &&
              Math.abs(hit.hitPointWorld.y - 4.5) < 1e-6
            )
              ceilingHit = true;
          },
        );
        assert.ok(ceilingHit, `${name} ceiling is missing at (${x}, ${z})`);
      }
  });
}

test("cargo poem is a framed, readable wall poster and hints at the crowbar and orange crates", async (t) => {
  browser(t);
  const data = rooms[5]({ preview: true, remoteVisit: true, modelLoader });
  t.cleanup(() => data.dispose());
  await data.ready;
  const poster = data.scene.getObjectByName("CargoPoemPoster");
  assert.ok(poster?.isMesh);
  assert.ok(data.scene.getObjectByName("CargoPoemPosterFrame"));
  assert.match(poster.userData.text, /A crow may crow, a bar may bar/);
  assert.match(poster.userData.text, /crow and bar and oranges meet/);
  assert.equal(poster.userData.text.split("\n").length, 4);
  assert.equal(poster.userData.illustration, "crow + drinks bar");
  assert.ok(poster.material.map.isCanvasTexture);
  assert.equal(poster.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.ok(poster.position.x > -5 && poster.position.y > 2);
  assert.equal(poster.rotation.y, Math.PI / 2);
});

test("range goggles reveal seven shuffled wall letters and Prime greets only an active arrival", async (t) => {
  browser(t);
  const data = rooms[6]({
    remoteVisit: true,
    deferActivation: true,
    loot: { cleared: new Set(), rewardCollected: false },
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  const labels = data.scene.children.filter((item) =>
    item.name.startsWith("RangeLetter-"),
  );
  assert.equal(labels.length, 7);
  assert.equal(
    labels
      .map((item) => item.userData.text)
      .sort()
      .join(""),
    [..."BRONDON"].sort().join(""),
  );
  assert.notEqual(labels.map((item) => item.userData.text).join(""), "BRONDON");
  assert.ok(labels.every((item) => !item.visible && item.position.y > 2.5));
  const caption = document.body.children.find((item) =>
    item.className.includes("stage-two-dialogue"),
  );
  step(data, 0.1);
  assert.equal(caption.textContent, "");
  assert.equal(data.getDamageTargets().length, 0);
  data.activate();
  step(data, 0.1);
  assert.equal(
    caption.textContent,
    "Prime: The students would always play in here.",
  );
  data.setGogglesActive(true);
  assert.ok(labels.every((item) => item.visible));
  assert.ok(
    labels.every(
      (item) =>
        item.layers.isEnabled(2) &&
        item.geometry.parameters.width >= 0.85 &&
        item.material.map.colorSpace === THREE.SRGBColorSpace &&
        !item.material.toneMapped,
    ),
  );
  data.setGogglesActive(false);
  assert.ok(labels.every((item) => !item.visible));
  const poem = data.scene.getObjectByName("RangeWallPoem");
  assert.match(poem.userData.text, /remember your name/);
  assert.match(poem.userData.text, /false note.*fire/);
  assert.equal(poem.userData.text.split("\n").length, 5);
  assert.doesNotMatch(poem.userData.text, /Name yourself/);
  assert.ok(data.scene.getObjectByName("RangeWallPoemFrame"));
});

for (const correctHits of [0, 1, 3, 5]) {
  test(`range wrong hit after ${correctHits} letters fills the room with fire and respawns locally`, async (t) => {
    browser(t);
    const loot = { cleared: new Set(), rewardCollected: false };
    const data = rooms[6]({
      remoteVisit: true,
      loot,
      modelLoader,
      hasReturnMarker: () => true,
      onRestart: async () => {
        assert.fail("Failure must respawn in the range, not surveillance");
      },
      onKeycardCollected() {},
    });
    t.cleanup(() => data.dispose());
    await data.ready;
    for (const letter of "BRONDON".slice(0, correctHits))
      data
        .getDamageTargets()
        .find((item) => item.root.userData.rangeLetter === letter)
        .damage(25, "pistol");
    const expected = "BRONDON"[correctHits];
    const wrong = data
      .getDamageTargets()
      .find((item) => item.root.userData.rangeLetter !== expected);
    assert.equal(wrong.damage(25, "crowbar"), false);
    assert.equal(wrong.damage(0, "pistol"), false);
    data.player.setPosition(1, 0.3, 1);
    data.player.body.velocity.set(4, 0, 3);
    assert.equal(wrong.damage(25, "pistol"), true);
    assert.equal(data.isCinematic(), true);
    assert.equal(data.player.isEnabled(), false);
    assert.equal(data.getDamageTargets().length, 0);
    const blast = data.scene.getObjectByName("RangeFireExplosion");
    assert.equal(blast.visible, true);
    assert.ok(blast.material.isShaderMaterial);
    assert.match(blast.material.fragmentShader, /radiance/);
    step(data, 1.2);
    assert.ok(blast.scale.x > 10, "the fire must engulf the 10m room");
    step(data, 1.3);
    assert.deepEqual(data.getRangeState(), { sequence: "", exploding: false });
    assert.equal(blast.visible, false);
    assert.equal(data.player.isEnabled(), true);
    assert.equal(data.getDamageTargets().length, 7);
    assert.equal(loot.cleared.size, 0);
    assert.equal(data.player.body.position.x, 0);
    assert.equal(data.player.body.position.z, -3);
    assert.ok(
      Math.abs(data.player.body.velocity.x) < 1e-9 &&
        Math.abs(data.player.body.velocity.z) < 1e-9,
    );
    assert.equal(data.chest.isCollected(), false);
  });
}

test("range accepts interchangeable repeated letters and persists only a complete solution", async (t) => {
  browser(t);
  const loot = { cleared: new Set(), rewardCollected: false };
  const options = {
    remoteVisit: true,
    loot,
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  };
  const data = rooms[6](options);
  t.cleanup(() => data.dispose());
  await data.ready;
  for (const letter of "BRONDON") {
    const matches = data
      .getDamageTargets()
      .filter((item) => item.root.userData.rangeLetter === letter);
    assert.equal(matches.at(-1).damage(25, "pistol"), true);
    if (data.getRangeState().sequence.length < 7)
      assert.equal(loot.cleared.size, 0);
  }
  assert.equal(data.getRangeState().sequence, "BRONDON");
  assert.equal(loot.cleared.size, 7);
  assert.equal(data.getDamageTargets().length, 0);
  assert.equal(data.isCinematic(), false);
  const revisit = rooms[6](options);
  t.cleanup(() => revisit.dispose());
  await revisit.ready;
  assert.equal(revisit.getRangeState().sequence, "BRONDON");
  assert.equal(revisit.getDamageTargets().length, 0);
  const preview = rooms[6]({ ...options, preview: true });
  t.cleanup(() => preview.dispose());
  await preview.ready;
  preview.setGogglesActive(true);
  assert.ok(
    preview.scene.children
      .filter((item) => item.name.startsWith("RangeLetter-"))
      .every((item) => !item.visible),
  );
});

for (const direct of [false, true]) {
  test(`Bloomstick Tennis clears a lane with ${direct ? "one true firing-hole hit" : "five force-field returns"}`, async (t) => {
    browser(t);
    const progress = layout.createStageTwoProgress();
    progress.bloomstickCollected = true;
    const data = createEquipment({
      progress,
      modelLoader,
      onRestart: async () => true,
      onKeycardCollected() {},
    });
    t.cleanup(() => data.dispose());
    await data.ready;
    data.player.setPosition(-6, 0.3, 2.5);
    const poster = data.scene.getObjectByName("BloomstickTennisRulesPoster");
    assert.ok(poster.material.map.isCanvasTexture);
    assert.equal(poster.position.z, data.chest.root.position.z);
    for (let count = 0; count < (direct ? 1 : 5); count++) {
      let bolt;
      for (let frame = 0; frame < 360 && !bolt; frame++) {
        data.updatePhysics(1 / 120);
        [bolt] = data.getParryableBolts();
      }
      assert.ok(bolt, "standing on a lane plate serves a shot");
      bolt.parried = true;
      bolt.owner = "player";
      bolt.mesh.position.set(direct ? -6 : -5, direct ? 2.1 : 2.6, -10.15);
      bolt.velocity.set(0, 0, -15);
      data.updatePhysics(0.05);
      assert.equal(data.getTennisState().hits[0], direct ? 5 : count + 1);
    }
    assert.equal(
      progress.remoteRooms["stage2-armory"].cleared.has("cage-tennis"),
      true,
    );
    assert.deepEqual(data.getTennisState().hits, [5, 0, 0]);
    const deskHit = new CANNON.RaycastResult();
    data.physicsWorld.raycastClosest(
      new CANNON.Vec3(-7, 0.5, 8.8),
      new CANNON.Vec3(-8.25, 0.5, 8.8),
      {},
      deskHit,
    );
    assert.equal(
      deskHit.hasHit,
      true,
      "the supply desk blocks the player's body",
    );
  });
}

test("a firing-hole hit uses a circular muzzle crossing, not the force-field rectangle", async () => {
  const { crossesFiringHole } = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/equipmentRoom.ts",
  );
  const hole = { x: -6, y: 2.1, z: -10.78 };
  assert.equal(
    crossesFiringHole({ ...hole, z: -10 }, { ...hole, z: -11 }, hole),
    true,
  );
  for (const offset of [
    { x: 1, y: 0 },
    { x: 0, y: 0.5 },
    { x: 0.24, y: 0.24 },
  ])
    assert.equal(
      crossesFiringHole(
        { x: hole.x + offset.x, y: hole.y + offset.y, z: -10 },
        { x: hole.x + offset.x, y: hole.y + offset.y, z: -11 },
        hole,
      ),
      false,
    );
});

test("reactor consoles rest on the floor without a hidden dais step", async (t) => {
  browser(t);
  const { createScene } = await server.ssrLoadModule(
    "/scenes/level 1 stage 2/reactorSequencer.ts",
  );
  const data = createScene({ preview: true, modelLoader });
  t.cleanup(() => data.dispose());
  await data.ready;
  for (const name of ["REACTOR", "COMMS", "COOLANT", "VENT"])
    assert.equal(data.scene.getObjectByName(`Station-${name}`).position.y, 0);
  const stepHit = new CANNON.RaycastResult();
  data.physicsWorld.raycastClosest(
    new CANNON.Vec3(7, 0.06, -3),
    new CANNON.Vec3(7, 0.06, -6.5),
    {},
    stepHit,
  );
  assert.equal(stepHit.hasHit, false);
});

test("rust chamber releases animate, reset correctly, and award one persistent keycard", async (t) => {
  const elements = browser(t),
    progress = layout.createStageTwoProgress();
  const loot = progress.remoteRooms["stage2-rust"];
  const data = createRust({
    modelLoader,
    loot,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected: () =>
      layout.collectStageTwoKeycard(progress, "stage2-rust"),
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  step(data, 0.2);
  const targets = data.getDamageTargets();
  assert.equal(targets.length, 9);
  const bars = targets.find((item) => item.id === "rust:winch-bars");
  const chain = targets.find((item) => item.id === "rust:winch-chain");
  assert.equal(
    bars.root.children.filter((item) => item.visible).length,
    7,
    "custom bars must render",
  );
  assert.equal(
    chain.root.children.filter((item) => item.visible).length,
    15,
    "custom chain must render",
  );
  assert.equal(bars.damage(1, "pistol"), false);
  assert.equal(bars.damage(1, "bloomstick"), true);
  assert.equal(data.isCinematic(), false);
  assert.equal(data.getDamageTargets().length, 8);
  assert.equal(data.applyCinematicCamera(), false);
  assert.equal(data.isCinematic(), false);
  assert.equal(loot.cleared.has(bars.id), true);
  const rebuild = data.scene.getObjectByName("RustChamberRebuildControl");
  assert.equal(
    rebuild.position.z,
    6.55,
    "rebuild control is on the wall opposite the door",
  );
  data.player.setPosition(23, 0.3, 7.5);
  tap("KeyE");
  step(data, 0.2);
  assert.equal(data.getDamageTargets().length, 9);
  assert.equal(loot.cleared.size, 0);
  assert.equal(chain.hitsRemaining, 3);
  const shutter = data.scene.getObjectByName(
    "RustChamberCounterweightedShutter",
  );
  const gear = data.scene.getObjectByName("RustChamberDriveGear");
  const initialGearRotation = gear.rotation.z;
  const lock = data.scene.getObjectByName("RustChamberDoorStatus");
  assert.equal(lock.userData.remaining, 8);
  assert.ok(data.scene.getObjectByName("RustChamberPadlock"));
  assert.equal(
    lock.children.filter((item) => /^RustChamberLockSegment-/.test(item.name))
      .length,
    8,
  );
  for (const item of targets) {
    for (let hit = 0, hits = item.hitsRemaining; hit < hits; hit++) {
      assert.equal(item.damage(1, item.weapon), true);
      if (hit < hits - 1) assert.equal(item.broken, false);
    }
    if (item.id === "rust:bolt-1" || item.id === "rust:bolt-2")
      assert.equal(data.isCinematic(), false);
    if (item.id === "rust:bolt-3") {
      assert.equal(data.isCinematic(), true);
      const previousLift = shutter.position.y;
      step(data, 1.1);
      assert.equal(
        shutter.position.y,
        previousLift,
        "door waits for the mechanism camera",
      );
      data.applyCinematicCamera();
      const before = data.camera.position.clone();
      step(data, 1 / 60);
      data.applyCinematicCamera();
      assert.ok(
        data.camera.position.distanceTo(before) < 0.3,
        "mechanism transition must not jump",
      );
      step(data, 2.9);
    } else step(data, 4);
    if (item.id === "rust:bolt-1") {
      assert.ok(Math.abs(shutter.position.y - (2.5 + 5.35 / 8)) < 0.01);
      assert.equal(lock.userData.remaining, 7);
      assert.equal(
        lock.children.filter(
          (segment) =>
            /^RustChamberLockSegment-/.test(segment.name) && segment.visible,
        ).length,
        7,
      );
    }
  }
  assert.equal(loot.cleared.size, 9);
  assert.ok(shutter.position.y > 7.8);
  const fence = data.scene.getObjectByName("RustChamberSafetyGrille");
  assert.ok(Math.abs(fence.rotation.x + Math.PI / 2) < 0.001);
  assert.equal(
    fence.position.x,
    17,
    "the fence falls flat, never slides sideways",
  );
  assert.notEqual(gear.rotation.z, initialGearRotation);
  assert.equal(lock.userData.remaining, 0);
  assert.ok(data.scene.getObjectByName("RustChamberCounterweightChain"));
  assert.ok(data.scene.getObjectByName("RustChamberWinchDrive"));
  const obstruction = new CANNON.RaycastResult();
  data.physicsWorld.raycastClosest(
    new CANNON.Vec3(17, 1, 26),
    new CANNON.Vec3(17, 1, 29),
    {},
    obstruction,
  );
  assert.equal(
    obstruction.hasHit,
    false,
    "grille, shutter and reward door must clear the passage",
  );
  data.player.setPosition(17, 0.3, 31);
  tap("KeyE");
  step(data, 1);
  assert.equal(loot.rewardCollected, true);
  assert.deepEqual(progress.keycards, ["stage2-rust"]);
  data.player.setPosition(23, 0.3, 7.5);
  tap("KeyE");
  step(data, 0.2);
  assert.equal(loot.rewardCollected, true);
  assert.equal(data.getDamageTargets().length, 9);
  assert.equal(shutter.position.y, 2.5);
  data.player.setPosition(17, 0.3, 31);
  tap("KeyE");
  step(data, 1);
  assert.deepEqual(
    progress.keycards,
    ["stage2-rust"],
    "reset cannot duplicate the reward",
  );
  data.player.setPosition(17, 0.3, 2.2);
  data.player.setRotation(0, 0);
  step(data, 0.2);
  data.updateInteractionFocus();
  assert.match(elements.get("interact-prompt").textContent, /Read inscription/);
  tap("KeyE");
  step(data, 1);
  assert.equal(data.isCinematic(), true);
  assert.equal(data.applyCinematicCamera(), true);
  tap("KeyE");
  step(data, 1);
  assert.equal(data.isCinematic(), false);
  assert.equal(data.controlsReady(), true);
});

test("rust mechanisms respond to actual melee sweeps and pistol traces", async (t) => {
  browser(t);
  const { MeleeSwing, getAttackSegment } = await server.ssrLoadModule(
    "/scripts/weapons/melee.ts",
  );
  const { traceShot } = await server.ssrLoadModule(
    "/scripts/weapons/pistol.ts",
  );
  const data = createRust({
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  const targets = data.getDamageTargets();
  for (const id of [
    "rust:bolt-1",
    "rust:bolt-2",
    "rust:bolt-3",
    "rust:winch-bars",
    "rust:winch-chain",
  ]) {
    const target = targets.find((item) => item.id === id);
    const bolt = id.startsWith("rust:bolt-");
    data.player.setPosition(
      bolt ? 17 : id.endsWith("bars") ? 29.9 : 31.5,
      bolt ? 8.9 : 0.3,
      bolt ? 25.9 : 20.1,
    );
    const origin = new THREE.Vector3(
      data.player.body.position.x,
      data.player.body.position.y + 0.8,
      data.player.body.position.z,
    );
    const direction = target.root.position.clone().sub(origin);
    data.player.setRotation(
      Math.atan2(-direction.x, -direction.z),
      Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
    );
    for (let hit = 0, hits = target.hitsRemaining; hit < hits; hit++) {
      const swing = new MeleeSwing("crowbar");
      for (let sample = 0; sample <= 20; sample++)
        swing.update(
          {
            scene: data.scene,
            world: data.physicsWorld,
            player: data.player,
            character: null,
            targets: data.getDamageTargets(),
          },
          getAttackSegment(data.player, sample / 20),
        );
      assert.equal(
        target.hitsRemaining,
        hits - hit - 1,
        `${id} must accept one hit per real swing`,
      );
    }
    assert.equal(target.broken, true);
    step(data, 4);
  }
  const clamp = targets.find((item) => item.id === "rust:blue-clamp");
  const origin = new THREE.Vector3(27, 5.8, 19);
  const shot = traceShot(
    data.scene,
    data.physicsWorld,
    new THREE.Ray(origin, clamp.root.position.clone().sub(origin).normalize()),
    data.getDamageTargets(),
  );
  assert.equal(
    shot.target,
    clamp,
    "the visible blue clasp must be reachable by gunfire",
  );
  assert.equal(shot.target.damage(25, "pistol"), true);
  step(data, 4);
  assert.ok(
    data.scene.getObjectByName("RustChamberCounterweightedShutter").position.y >
      6,
    "the remaining hanging and far-blue locks must still hold the last stages",
  );
});

test("rust mirrors reflect one real pistol ray through both blue locks and drop the fence", async (t) => {
  browser(t);
  const { traceShot } = await server.ssrLoadModule(
    "/scripts/weapons/pistol.ts",
  );
  const data = createRust({
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  const origin = new THREE.Vector3(17.5, 1.4, 8);
  const mirror = data.scene.getObjectByName("RustChamberMirror-1");
  const shot = traceShot(
    data.scene,
    data.physicsWorld,
    new THREE.Ray(origin, mirror.position.clone().sub(origin).normalize()),
    data.getDamageTargets(),
  );
  assert.equal(
    shot.object,
    mirror,
    "the real first mirror must be shootable from the deck",
  );
  data.onPistolShot(shot.point, origin);
  const beams = [];
  data.scene.traverse((node) => {
    if (node.name === "RustReflectedShot" && node.visible) beams.push(node);
  });
  assert.equal(beams.length, 1, "the beam begins at the first mirror");
  const fence = data.scene.getObjectByName("RustChamberSafetyGrille");
  const first = data.scene.getObjectByName("rust:blue-clamp"),
    far = data.scene.getObjectByName("rust:far-blue-clamp");
  assert.ok(
    first && far,
    "both boxes are still visible when the shot presentation begins",
  );
  step(data, 0.8);
  data.applyCinematicCamera();
  assert.equal(first.parent, null);
  assert.equal(far.parent, data.scene);
  assert.equal(fence.rotation.x, 0, "fence stays up after the first impact");
  const firstView = data.camera.position.clone();
  step(data, 1);
  data.applyCinematicCamera();
  assert.equal(far.parent, null, "the second box breaks in its own shot");
  assert.equal(fence.rotation.x, 0, "both impacts precede the fence falling");
  assert.ok(
    data.camera.position.distanceTo(firstView) > 15,
    "camera visits both sides of the hall",
  );
  step(data, 0.4);
  assert.equal(fence.rotation.x, 0);
  step(data, 0.6);
  data.applyCinematicCamera();
  assert.ok(fence.rotation.x < -0.1, "fence falls only after the two impacts");
  step(data, 3.3);
  const remaining = data.getDamageTargets();
  assert.ok(!remaining.some((item) => item.id === "rust:blue-clamp"));
  assert.ok(!remaining.some((item) => item.id === "rust:far-blue-clamp"));
  assert.ok(Math.abs(fence.rotation.x + Math.PI / 2) < 0.001);
  assert.equal(fence.position.x, 17);
  assert.ok(
    data.scene.getObjectByName("RustChamberCounterweightedShutter").position.y <
      4.1,
    "the mirror shot must not bypass the orange releases",
  );
  data.player.setPosition(23, 0.3, 7.5);
  tap("KeyE");
  step(data, 0.2);
  assert.equal(data.getDamageTargets().length, 9);
  assert.ok(Math.abs(fence.rotation.x) < 0.001);
  assert.ok(
    beams.every((beam) => !beam.visible),
    "reset clears transient reflected beams",
  );
  assert.equal(
    data.scene.getObjectByName("keycardChest").rotation.y,
    0,
    "chest latch faces the room entrance",
  );
});

test("rust corrosive water melts a falling player and returns them without erasing puzzle progress", async (t) => {
  browser(t);
  const loot = { cleared: new Set(["rust:bolt-1"]), rewardCollected: false };
  const data = createRust({
    modelLoader,
    loot,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  data.player.setPosition(11, 3, 18);
  step(data, 1.2);
  assert.equal(data.isCinematic(), true);
  assert.ok(data.getHologramTransition().melt > 0);
  assert.equal(data.getDamageTargets().length, 0);
  assert.equal(data.applyCinematicCamera(), true);
  const firstMelt = data.getHologramTransition().melt;
  step(data, 0.6);
  assert.ok(data.getHologramTransition().melt > firstMelt);
  step(data, 3);
  assert.equal(data.isCinematic(), false);
  assert.equal(data.getHologramTransition(), null);
  assert.ok(Math.abs(data.player.body.position.x - 17) < 0.01);
  assert.ok(Math.abs(data.player.body.position.z - 2.2) < 0.01);
  assert.equal(loot.cleared.has("rust:bolt-1"), true);
  assert.equal(data.controlsReady(), true);
});

test("rust tightrope is a walkable narrow collider and its orange lock is within melee reach", async (t) => {
  browser(t);
  const { MeleeSwing, getAttackSegment } = await server.ssrLoadModule(
    "/scripts/weapons/melee.ts",
  );
  const data = createRust({
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  const start = new THREE.Vector3(5.1, 8.63, 16.6),
    end = new THREE.Vector3(17.4, 8.63, 24.8);
  const direction = end.clone().sub(start).normalize();
  data.player.setPosition(start.x, 8.96, start.z);
  data.player.setRotation(Math.atan2(-direction.x, -direction.z), 0);
  step(data, 0.2);
  key("KeyW");
  step(data, 1.6);
  key("KeyW", "keyup");
  step(data, 0.1);
  assert.ok(
    data.player.body.position.y > 8.8,
    "the player must stand on the rope, not fall through it",
  );
  const lock = data
    .getDamageTargets()
    .find((item) => item.id === "rust:hanging-lock");
  const swing = new MeleeSwing("crowbar");
  for (let i = 0; i <= 20; i++)
    swing.update(
      {
        scene: data.scene,
        world: data.physicsWorld,
        player: data.player,
        character: null,
        targets: data.getDamageTargets(),
      },
      getAttackSegment(data.player, i / 20),
    );
  assert.equal(
    lock.broken,
    true,
    "the hanging lock is reachable while standing halfway across the rope",
  );
});

for (const reduced of [false, true]) {
  test(`rust tightrope has braided fibres and bounded camera-only wobble (reduced motion: ${reduced})`, async (t) => {
    browser(t);
    window.matchMedia = () => ({ matches: reduced });
    const data = createRust({
      modelLoader,
      hasReturnMarker: () => true,
      onRestart: async () => true,
      onKeycardCollected() {},
    });
    t.cleanup(() => data.dispose());
    await data.ready;
    const rope = data.scene.getObjectByName("RustChamberTightrope");
    assert.equal(rope.geometry.type, "TubeGeometry");
    assert.equal(
      data.scene.children.filter((item) =>
        item.name.startsWith("RustTightropeStrand-"),
      ).length,
      3,
    );
    assert.equal(
      data.scene.children.filter(
        (item) => item.name === "RustTightropeAnchorKnot",
      ).length,
      8,
    );
    data.player.setPosition(11.25, 8.96, 20.7);
    step(data, 0.3);
    const balance = data.getTightropeState();
    assert.ok(balance.balance > 0.7);
    assert.ok(Math.abs(balance.progress - 0.5) < 0.01);
    assert.ok(Math.abs(balance.roll) <= 0.05 && Math.abs(balance.sway) <= 0.08);
    const position = data.player.body.position.clone();
    data.camera.position.set(0, 0, 0);
    data.camera.quaternion.identity();
    data.applyCameraEffects();
    assert.equal(
      data.player.body.position.distanceTo(position),
      0,
      "wobble must never push the player off the rope",
    );
    if (reduced) {
      assert.equal(data.camera.position.length(), 0);
      assert.equal(data.camera.rotation.z, 0);
    } else {
      assert.ok(Math.abs(data.camera.rotation.z) > 0.001);
      assert.ok(data.camera.position.length() > 0.001);
    }
    data.player.setPosition(17, 0.3, 2.2);
    step(data, 1);
    assert.ok(
      data.getTightropeState().balance < 0.001,
      "the effect must ease away off the rope",
    );
  });
}

test("rust railings physically block walking off the gantry outside the rope opening", async (t) => {
  browser(t);
  const data = createRust({
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  data.player.setPosition(10, 8.9, 25.5);
  data.player.setRotation(0, 0);
  step(data, 0.2);
  key("KeyW");
  step(data, 1);
  key("KeyW", "keyup");
  assert.ok(
    data.player.body.position.z > 24.6,
    "the guardrail must stop the player at the edge",
  );
  assert.ok(data.player.body.position.y > 8.7);
});

test("rust chamber stairs reach the bolt gantry using normal walking physics", async (t) => {
  browser(t);
  const data = createRust({
    modelLoader,
    hasReturnMarker: () => true,
    onRestart: async () => true,
    onKeycardCollected() {},
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  data.player.setPosition(3.6, 0.3, 9);
  data.player.setRotation(Math.PI, 0);
  step(data, 0.2);
  key("KeyW");
  step(data, 5.5);
  key("KeyW", "keyup");
  step(data, 0.2);
  assert.ok(
    data.player.body.position.y > 8.7,
    `gantry must be reachable: ${data.player.body.position.y}`,
  );
  assert.ok(
    data.player.body.position.z > 24,
    "stairs must connect to the gantry",
  );
  assert.ok(
    data.player.body.position.y < 9,
    "player must stand on the platform, not float",
  );
});

test("camera-room seating finds the cushion on the real chair asset", async (t) => {
  const elements = browser(t);
  const base = new URL("../src/assets/models/Tools/", import.meta.url);
  const json = JSON.parse(
    await readFile(new URL("Prop_Chair.gltf", base), "utf8"),
  );
  for (const buffer of json.buffers)
    buffer.uri = `data:application/octet-stream;base64,${(await readFile(new URL(buffer.uri, base))).toString("base64")}`;
  delete json.materials;
  delete json.textures;
  delete json.images;
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const chair = (await new GLTFLoader().parseAsync(JSON.stringify(json), ""))
    .scene;
  const { fitCabinProp } = await server.ssrLoadModule(
    "/scenes/living quarters/furnishings.ts",
  );
  const { createChairSeating } = await server.ssrLoadModule(
    "/scripts/player/chairSeating.ts",
  );
  fitCabinProp(chair, 1.05, 0.68, 0.8, Math.PI);
  const scene = new THREE.Scene(),
    physics = createPhysics(),
    camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 100);
  scene.add(chair);
  physics.addBox({ x: 10, y: 0.2, z: 10 }, { x: 0, y: -0.1, z: 0 });
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: { x: 0, y: 0.3, z: -1.2 },
  });
  player.enable();
  step({ updatePhysics: (dt) => physics.step(dt, player) }, 0.2);
  camera.position.set(0, 1.3, -1.2);
  camera.lookAt(0, 0.5, 0);
  const seating = createChairSeating({
    scene,
    camera,
    player,
    prompt: elements.get("interact-prompt"),
    chairs: () => [{ root: chair, yaw: Math.PI }],
    canInteract: () => true,
  });
  t.cleanup(() => {
    seating.dispose();
    player.dispose();
    physics.dispose();
  });
  tap("KeyE");
  assert.equal(seating.active, true);
  for (let i = 0; i < 72; i++) seating.update(1 / 60);
  const pose = seating.getPose();
  assert.equal(pose.clip, "Sitting_Idle_Loop");
  assert.equal(pose.seatContact.weight, 1);
  assert.ok(
    pose.seatContact.position.y > 0.3 && pose.seatContact.position.y < 0.7,
  );
  assert.equal(pose.footTargets.left.y, 0.055);
  assert.equal(seating.applyCamera(), true);
  tap("KeyE");
  for (let i = 0; i < 72; i++) seating.update(1 / 60);
  assert.equal(seating.active, false);
  assert.equal(player.body.type, CANNON.Body.DYNAMIC);
  const startZ = player.body.position.z;
  key("KeyW");
  step({ updatePhysics: (dt) => physics.step(dt, player) }, 0.3);
  key("KeyW", "keyup");
  assert.ok(
    Math.abs(player.body.position.z - startZ) > 0.5,
    "standing must restore movement",
  );
});

test("rust surveillance preview follows puzzle resets and completion without input", async (t) => {
  browser(t);
  const loot = { cleared: new Set(), rewardCollected: false };
  const data = createRust({ modelLoader, preview: true, loot });
  t.cleanup(() => data.dispose());
  await data.ready;
  const bars = data.scene.getObjectByName("rust:winch-bars");
  assert.ok(bars);
  loot.cleared.add("rust:winch-bars");
  data.syncProgress();
  assert.equal(bars.parent, null);
  loot.cleared.clear();
  data.syncProgress();
  assert.equal(bars.parent, data.scene);
  assert.equal(data.isCinematic(), false);
  assert.equal(data.player.isEnabled(), false);
});

test("Rust water shares an opaque rust finish and properly subdivided ripples in both chambers", async (t) => {
  browser(t);
  for (const [create, name] of [
    [createRust, "RustChamberCorrosiveWater"],
    [createRust2, "RustChamber2CorrosiveWater"],
  ]) {
    const data = create({ preview: true, modelLoader });
    t.cleanup(() => data.dispose());
    await data.ready;
    const water = data.scene.getObjectByName(name);
    assert.ok(water);
    assert.equal(water.material.transparent, false);
    assert.equal(water.material.depthWrite, true);
    assert.ok(water.material.color.r > water.material.color.g);
    assert.ok(water.material.color.g > water.material.color.b);
    const edges = data.scene.children.filter((item) =>
      /^RustChamber2?CorrodedEdge$/.test(item.name),
    );
    assert.ok(edges.length >= 4, "water rims have an explicit rust finish");
    assert.ok(
      edges.every(
        (edge) =>
          edge.material.name === "CorrodedRustWaterEdge" &&
          edge.material.color.r > edge.material.color.g &&
          edge.material.map.isCanvasTexture,
      ),
    );
    assert.ok(water.geometry.parameters.widthSegments >= 25);
    assert.ok(water.geometry.parameters.heightSegments >= 30);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    water.material.onBeforeCompile(shader);
    data.updatePhysics(0.05);
    assert.equal(shader.uniforms.uRustWaterTime.value, 0.05);
    assert.match(shader.vertexShader, /objectNormal = normalize/);
    if (create === createRust2) {
      const bounds = new THREE.Box3().setFromObject(water);
      assert.ok(Math.abs(bounds.min.z - 0.2) < 0.001);
      assert.ok(Math.abs(bounds.max.z - 21.8) < 0.001);
    }
  }
});

test("shared ceiling fittings stay inside room walls and below the passage roof skin", async (t) => {
  const { createShipServiceDetails } = await server.ssrLoadModule(
    "/scripts/global/shipInterior.ts",
  );
  const { disposeRoom } = await server.ssrLoadModule(
    "/scripts/global/shipRoom.ts",
  );
  for (const dimensions of [
    { width: 5, depth: 27.6, height: 3.05 },
    { width: 10, depth: 10, height: 4.5 },
  ]) {
    const services = createShipServiceDetails(dimensions);
    t.after(() => disposeRoom(services));
    const bounds = new THREE.Box3().setFromObject(services);
    assert.ok(bounds.min.x >= -dimensions.width / 2 + 0.14 - 1e-6);
    assert.ok(bounds.max.x <= dimensions.width / 2 - 0.14 + 1e-6);
    assert.ok(bounds.min.z >= -dimensions.depth / 2 + 0.2 - 1e-6);
    assert.ok(bounds.max.z <= dimensions.depth / 2 - 0.2 + 1e-6);
    assert.ok(bounds.max.y <= dimensions.height - 0.08 + 1e-6);
  }
});

test("rust chamber 2 has a lower roof, matching rust walls, flat torn decks, and a centered release button", async (t) => {
  browser(t);
  const { data } = await rustTwo(t);
  const ceiling = data.scene.getObjectByName("RustChamber2Ceiling");
  assert.ok(
    Math.abs(
      ceiling.position.y - ceiling.geometry.parameters.height / 2 - 8.4,
    ) < 1e-6,
  );
  const roof = data.scene.children.filter((node) =>
    node.name.startsWith("RustChamber2Roof"),
  );
  assert.equal(
    roof.filter((node) => node.name.endsWith("UpperChord")).length,
    4,
  );
  assert.equal(
    roof.filter((node) => node.name.endsWith("LowerChord")).length,
    4,
  );
  assert.equal(roof.filter((node) => node.name.endsWith("Brace")).length, 32);
  for (const member of roof) {
    const bounds = new THREE.Box3().setFromObject(member);
    assert.ok(bounds.min.x >= -1e-6 && bounds.max.x <= 64 + 1e-6);
    assert.ok(bounds.min.z >= -1e-6 && bounds.max.z <= 22 + 1e-6);
    assert.ok(bounds.max.y <= 8.4 + 1e-6);
    assert.equal(member.userData.minimap, false);
  }
  const wall = data.scene.getObjectByName("RustChamber2RiftWall");
  assert.equal(wall.material.roughness, 0.91);
  assert.ok(wall.material.map.isCanvasTexture);
  const cover = data
    .getDamageTargets()
    .find((item) => item.id === "rust2:cover");
  assert.equal(cover.root.position.x, 62.2);
  assert.equal(cover.root.position.z, 11);
  assert.ok(data.scene.getObjectByName("RustChamber2SuspensionRig"));
  assert.ok(data.scene.getObjectByName("RustChamber2SuspensionCable"));
  assert.equal(
    data.scene.children.filter(
      (item) => item.name === "RustChamber2OrangeWallFixture",
    ).length,
    12,
  );
  const wallLights = data.scene.children.filter(
    (item) => item.name === "RustChamber2OrangeWallLight",
  );
  assert.equal(wallLights.length, 6);
  assert.ok(
    wallLights.every(
      (light) => light.intensity >= 50 && light.color.r > light.color.b,
    ),
  );
  const decks = data.scene.children.filter((item) =>
    /^RustChamber2SplitDeck/.test(item.name),
  );
  assert.equal(decks.length, 24);
  for (const deck of decks) {
    assert.equal(deck.material[1].name, "CorrodedRustWaterEdge");
    assert.ok(deck.geometry.groups.some((group) => group.materialIndex === 1));
    const bounds = new THREE.Box3().setFromObject(deck);
    assert.ok(Math.abs(bounds.max.y) < 1e-6);
    assert.ok(Math.abs(bounds.min.y + 0.4) < 1e-6);
  }
  for (const x of [3, 12, 14, 54, 58, 60]) {
    for (const z of [1, 5, 11, 17, 21]) {
      const hit = new CANNON.RaycastResult();
      data.physicsWorld.raycastClosest(
        new CANNON.Vec3(x, 0.2, z),
        new CANNON.Vec3(x, -0.5, z),
        { skipBackfaces: true },
        hit,
      );
      assert.ok(hit.hasHit, `Solid deck missing at ${x}, ${z}`);
      assert.ok(Math.abs(hit.hitPointWorld.y) < 1e-5);
      assert.ok(hit.hitNormalWorld.y > 0.99);
    }
  }
  const gap = new CANNON.RaycastResult();
  data.physicsWorld.raycastClosest(
    new CANNON.Vec3(24, 1, 11),
    new CANNON.Vec3(24, -1, 11),
    {},
    gap,
  );
  assert.equal(
    gap.hasHit,
    false,
    "the split is not covered by an invisible floor",
  );
  data.player.setPosition(3, 0.3, 5);
  data.player.setRotation(-Math.PI / 2);
  key("KeyW");
  step(data, 2.2);
  key("KeyW", "keyup");
  assert.ok(data.player.body.position.x > 11);
  assert.ok(Math.abs(data.player.body.position.y - 0.3) < 0.03);
});

test("rust chamber 2 suspension uses fixed steps without body/mesh drift at 30, 60, and 120 FPS", async (t) => {
  browser(t);
  const states = [];
  for (const fps of [30, 60, 120]) {
    const { data } = await rustTwo(t);
    data
      .getDamageTargets()
      .find((item) => item.id === "rust2:cover")
      .damage(100, "crowbar");
    data.player.setPosition(61, 0.3, 11);
    step(data, 0.2, fps);
    tap("KeyE");
    assert.equal(data.getPuzzleState().mode, "swinging");
    step(data, 1.5, fps);
    const cube = data.scene.getObjectByName("RustChamber2Counterweight");
    const body = data.physicsWorld.bodies.find((item) => item.mass === 200);
    assert.ok(
      cube.position.distanceTo(
        new THREE.Vector3(body.position.x, body.position.y, body.position.z),
      ) < 1e-6,
    );
    states.push({
      ...data.getPuzzleState(),
      x: body.position.x,
      y: body.position.y,
    });
    data.dispose();
  }
  for (const state of states.slice(1)) {
    for (const field of ["theta", "thetaRate", "x", "y"])
      assert.ok(
        Math.abs(state[field] - states[0][field]) < 1e-8,
        `${field} depends on frame rate`,
      );
  }
});

for (const reduced of [false, true]) {
  test(`Rust 2's release cinematic is skippable and pauses without freezing swing physics (reduced motion: ${reduced})`, async (t) => {
    browser(t);
    window.matchMedia = () => ({ matches: reduced });
    let returns = 0;
    const { data } = await rustTwo(t, {
      hasReturnMarker: undefined,
      onRestart: async () => {
        returns++;
        return true;
      },
    });
    assert.ok(data.scene.getObjectByName("RustChamber2HintPoster"));
    assert.ok(data.scene.getObjectByName("RustChamber2CorrodedRiftWall"));
    const exit = data.scene.getObjectByName("RustChamber2LockedExit");
    data.player.setPosition(62, 0.3, 4);
    tap("KeyE");
    const help = document.body.children
      .find((item) => item.classList.contains("camera-visit-ui"))
      .children.find((item) => item.tagName === "P");
    assert.equal(
      help.textContent,
      "Locked. Press R to return to the camera room.",
    );
    assert.equal(returns, 0);
    assert.ok(exit);
    data
      .getDamageTargets()
      .find((item) => item.id === "rust2:cover")
      .damage(100, "crowbar");
    data.player.setPosition(61, 0.3, 11);
    step(data, 0.2);
    const originalCamera = data.camera.position.clone();
    tap("KeyE");
    assert.equal(data.getPuzzleState().presentation, "release");
    assert.equal(data.isCinematic(), true);
    assert.equal(data.controlsReady(), false);
    assert.equal(data.player.body.type, CANNON.Body.KINEMATIC);
    assert.equal(data.player.isEnabled(), false);
    const position = data.player.body.position.clone();
    const theta = data.getPuzzleState().theta;
    step(data, 0.6);
    assert.notEqual(data.getPuzzleState().theta, theta);
    assert.equal(data.applyCinematicCamera(), true);
    assert.equal(data.player.body.position.distanceTo(position), 0);
    data.setMenuPaused(true);
    const pausedTheta = data.getPuzzleState().theta;
    step(data, 0.6);
    assert.equal(data.getPuzzleState().theta, pausedTheta);
    data.setMenuPaused(false);
    tap("KeyE");
    assert.equal(data.isCinematic(), false);
    assert.equal(data.player.body.type, CANNON.Body.DYNAMIC);
    assert.equal(data.player.isEnabled(), true);
    assert.equal(data.camera.position.distanceTo(originalCamera), 0);
    assert.equal(returns, 0);
  });
}

for (const reduced of [false, true]) {
  test(`rust chamber 2 pink trampoline flexes and rebounds without moving its collider (reduced motion: ${reduced})`, async (t) => {
    browser(t);
    window.matchMedia = () => ({ matches: reduced });
    const { data } = await rustTwo(t);
    const trampoline = data.scene.getObjectByName("RustChamber2Trampoline");
    const surface = data.scene.getObjectByName("RustChamber2TrampolineSurface");
    const body = data.physicsWorld.bodies.find(
      (item) =>
        item.position.x === 33 && Math.abs(item.position.y + 3.68) < 1e-6,
    );
    assert.ok(trampoline.getObjectByName("RustChamber2TrampolineFrame"));
    assert.equal(
      trampoline.getObjectsByProperty("name", "RustChamber2TrampolineSpring")
        .length,
      36,
    );
    const fabric = surface.children[0];
    assert.equal(fabric.material.name, "PinkTrampolineFabric");
    assert.ok(fabric.material.map.isCanvasTexture);
    const positions = fabric.geometry.getAttribute("position");
    const center = 16 * 33 + 16;
    assert.equal(surface.children[0].material.metalness, 0);
    const impulse = data.getThrowBounce(
      trampoline.position.clone(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, -4, 0),
    );
    assert.ok(impulse.x > 0 && impulse.y > 0);
    let low = 0,
      high = 0;
    for (let frame = 0; frame < 192; frame++) {
      data.updatePhysics(1 / 120);
      low = Math.min(low, positions.getY(center));
      high = Math.max(high, positions.getY(center));
      assert.ok(Math.abs(body.position.y + 3.68) < 1e-10);
      assert.ok(
        Math.abs(positions.getY(0)) < 1e-10,
        "fabric edges stay attached to the springs",
      );
    }
    if (reduced) assert.equal(low, 0);
    else {
      assert.ok(low < -0.2);
      assert.ok(high > 0.08);
    }
    assert.equal(surface.position.y, 0);
    assert.equal(surface.scale.y, 1);
    assert.equal(positions.getY(center), 0);
    assert.equal(
      data.getThrowBounce(
        trampoline.position,
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, -2, 0),
      ),
      null,
    );
  });
}

test("rust chamber 2 counterweight can be released onto the trampoline, launched, placed, and rewarded persistently", async (t) => {
  browser(t);
  const { data, progress } = await rustTwo(t);
  data
    .getDamageTargets()
    .find((item) => item.id === "rust2:cover")
    .damage(100, "crowbar");
  data.player.setPosition(61, 0.3, 11);
  step(data, 0.2);
  tap("KeyE");
  step(data, 0.2);
  tap("KeyE");
  assert.equal(data.isCinematic(), false);
  for (
    let frame = 0;
    frame < 600 && data.getPuzzleState().theta < 0.65;
    frame++
  )
    data.updatePhysics(1 / 120);
  assert.equal(data.getPuzzleState().mode, "swinging");
  data
    .getDamageTargets()
    .find((item) => item.id === "rust2:link")
    .damage(25, "pistol");
  let launched = false;
  for (let frame = 0; frame < 720; frame++) {
    data.updatePhysics(1 / 120);
    launched ||= data.getPuzzleState().mode === "launched";
  }
  const body = data.physicsWorld.bodies.find((item) => item.mass === 200);
  assert.equal(
    launched,
    true,
    `Counterweight missed the trampoline: ${body.position.toString()}`,
  );
  assert.equal(
    data.getPuzzleState().mode,
    "parked",
    `Counterweight state: ${JSON.stringify({ position: body.position, velocity: body.velocity, damping: body.linearDamping })}`,
  );
  assert.ok(body.position.x > 52 && body.position.x < 64);
  data.player.setPosition(body.position.x - 1.5, 0.3, body.position.z);
  data.player.setRotation(-Math.PI / 2);
  step(data, 0.2);
  tap("KeyE");
  assert.equal(data.getPuzzleState().mode, "carried");
  data.player.setPosition(58.45, 0.3, 11);
  step(data, 0.3);
  assert.ok(
    body.position.x - 58 > 1.45,
    "test deliberately places the box off-center",
  );
  tap("KeyE");
  assert.equal(
    data.getPuzzleState().mode,
    "placed",
    "overlap with the button is sufficient",
  );
  assert.equal(
    progress.remoteRooms["stage2-rust2"].cleared.has("rust2:plate"),
    true,
  );
  assert.equal(data.isCinematic(), true);
  assert.equal(data.getPuzzleState().presentation, "placed");
  step(data, 0.2);
  tap("KeyE");
  assert.equal(data.isCinematic(), false);
  data
    .getDamageTargets()
    .find((item) => item.id === "rust2:dir")
    .damage(25, "pistol");
  data.updatePhysics(1 / 60);
  assert.equal(data.getPuzzleState().plateEast, false);
  assert.ok(
    data.getThrowBounce(
      new THREE.Vector3(33, -3.6, 11),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
    ).x < 0,
  );
  step(data, 1);
  data.player.setPosition(-3.5, 0.3, 12.6);
  step(data, 0.2);
  tap("KeyE");
  step(data, 1);
  assert.equal(data.chest.isCollected(), true);
  assert.deepEqual(progress.keycards, ["stage2-rust2"]);
  data.dispose();
  const { data: revisit } = await rustTwo(t, { progress });
  assert.equal(revisit.getPuzzleState().mode, "placed");
  assert.equal(revisit.chest.isCollected(), true);
  tap("KeyE");
  assert.deepEqual(progress.keycards, ["stage2-rust2"]);
});

test("rust chamber 2 carrying permits free look, smooth normal steering, and gravity when put down", async (t) => {
  browser(t);
  const progress = layout.createStageTwoProgress();
  progress.remoteRooms["stage2-rust2"].cleared.add("rust2:plate");
  const { data } = await rustTwo(t, { progress });
  data.player.setPosition(56.65, 0.3, 11);
  data.player.setRotation(-Math.PI / 2);
  step(data, 0.2);
  tap("KeyE");
  step(data, 0.2);
  assert.equal(data.getPuzzleState().mode, "carried");
  document.dispatchEvent(new Event("pointerlockchange"));
  const before = data.player.getState();
  const position = data.player.body.position.clone();
  const mouse = new Event("mousemove");
  Object.defineProperties(mouse, {
    movementX: { value: 160 },
    movementY: { value: 60 },
  });
  window.dispatchEvent(mouse);
  assert.notEqual(data.player.getState().yaw, before.yaw);
  assert.notEqual(data.player.getState().pitch, before.pitch);
  assert.ok(
    data.player.body.position.distanceTo(position) < 1e-8,
    "looking never moves the player",
  );
  key("KeyW");
  step(data, 0.5);
  key("KeyW", "keyup");
  const distance = data.player.body.position.distanceTo(position);
  assert.ok(
    distance > 1 && distance < 1.5,
    `Carry speed was ${distance * 2} m/s`,
  );
  data.player.setPosition(61, 0.3, 16);
  data.player.setRotation(Math.PI / 2);
  step(data, 0.3);
  const body = data.physicsWorld.bodies.find((item) => item.mass === 200);
  const heldHeight = body.position.y;
  tap("KeyE");
  assert.equal(
    body.type,
    CANNON.Body.DYNAMIC,
    "off-plate drops are not frozen in midair",
  );
  step(data, 1);
  assert.ok(body.position.y < heldHeight - 0.3);
  assert.equal(data.player.getState().boxHandling, false);
});

test("rust chamber 2 rust water melts and respawns without erasing releases", async (t) => {
  browser(t);
  const { data, progress } = await rustTwo(t);
  data
    .getDamageTargets()
    .find((item) => item.id === "rust2:cover")
    .damage(100, "crowbar");
  data.player.setPosition(24, 1, 11);
  step(data, 1.5);
  assert.equal(data.isCinematic(), true);
  assert.ok(data.getHologramTransition().melt > 0);
  assert.match(data.canPlaceMarker({ x: 24, y: -5.7, z: 11 }), /rust water/i);
  step(data, 3.5);
  assert.equal(data.isCinematic(), false);
  assert.ok(Math.abs(data.player.body.position.x - 3) < 0.01);
  assert.ok(Math.abs(data.player.body.position.z - 11) < 0.01);
  assert.equal(
    progress.remoteRooms["stage2-rust2"].cleared.has("rust2:cover"),
    true,
  );
});

test("camera wall plays eight room GIFs without a renderer or preview scenes", async (t) => {
  browser(t);
  const sources = [];
  let updates = 0,
    disposals = 0;
  const definitions = [
    ...layout.STAGE_TWO_MINIGAMES,
    { id: "stage2-vents", label: "Vent maze" },
    { id: "stage2-prison", label: "Prison" },
  ].map((item) => ({
    ...item,
    cleared: () => item.id === "stage2-vents" || item.id === "stage2-prison",
  }));
  const cctv = createCctv(definitions, (index, url) => {
    assert.equal(url, cameraFootage[definitions[index].id]);
    const source = {
      texture: new THREE.Texture(),
      ready: Promise.resolve(),
      update() {
        updates++;
      },
      getFrameIndex: () => 0,
      dispose() {
        disposals++;
        source.texture.dispose();
      },
    };
    sources.push(source);
    return source;
  });
  t.cleanup(() => cctv.dispose());
  await cctv.prepareFeeds();
  assert.equal(sources.length, 8);
  assert.equal(disposals, 0);
  definitions.forEach((definition, index) => {
    assert.equal(
      cctv.panel.getObjectByName(`cctv-screen-${definition.id}`).material.map,
      sources[index].texture,
    );
  });
  const scene = new THREE.Scene();
  cctv.update(0.2, scene, true);
  assert.equal(updates, 8);
  cctv.update(0.2, scene, true, true);
  assert.equal(updates, 8, "paused wall GIFs do not advance");
  cctv.update(0.2, scene, false);
  assert.equal(updates, 8, "inactive wall GIFs do not advance");
  cctv.update(0.2, scene, true);
  assert.equal(updates, 16);
  assert.equal(
    cctv.panel.children.filter((item) => /^cctv-screen-/.test(item.name))
      .length,
    8,
  );
  assert.equal(
    cctv.panel.children.filter((item) => /^cctv-standby-/.test(item.name))
      .length,
    0,
  );
  const screenRows = new Set(
    cctv.panel.children
      .filter((item) => /^cctv-(screen|standby)-/.test(item.name))
      .map((item) => item.position.y),
  );
  assert.equal(screenRows.size, 2);
  const rust = cctv.panel.getObjectByName("cctv-screen-stage2-rust");
  const rust2 = cctv.panel.getObjectByName("cctv-screen-stage2-rust2");
  assert.equal(rust.position.x, rust2.position.x);
  assert.ok(Math.abs(rust.position.y - rust2.position.y - 1.18) < 1e-6);
  const ventScreen = cctv.panel.getObjectByName("cctv-screen-stage2-vents");
  scene.updateMatrixWorld(true);
  const targetPoint = ventScreen.getWorldPosition(new THREE.Vector3()),
    camera = new THREE.PerspectiveCamera();
  camera.position.set(targetPoint.x, targetPoint.y, targetPoint.z - 3);
  camera.lookAt(targetPoint);
  camera.updateMatrixWorld(true);
  assert.equal(cctv.getTarget(camera).id, "stage2-vents");
  assert.equal(cctv.getTarget(camera).status, "ready");
  cctv.detach();
  assert.equal(cctv.getTarget(camera), null);
  cctv.update(1, scene, true);
  assert.equal(
    sources.length,
    8,
    "reattaching reuses the existing GIF players",
  );
  cctv.clearSources();
  assert.equal(disposals, 8);
  cctv.clearSources();
  assert.equal(disposals, 8, "GIF players are not disposed twice");
});

test("failed wall GIFs release their textures and remain retryable", async (t) => {
  browser(t);
  t.mock.method(console, "error", () => {});
  let fail = true,
    disposals = 0;
  const cctv = createCctv(
    [
      {
        id: "scene5",
        label: "Cargo",
      },
    ],
    () => ({
      texture: new THREE.Texture(),
      ready: fail
        ? Promise.reject(new Error("GIF unavailable"))
        : Promise.resolve(),
      update() {},
      getFrameIndex: () => 0,
      dispose() {
        disposals++;
      },
    }),
  );
  t.cleanup(() => cctv.dispose());
  await assert.rejects(cctv.prepareFeeds(), /Camera links unavailable: Cargo/);
  assert.equal(disposals, 1);
  assert.equal(cctv.panel.visible, true);
  fail = false;
  cctv.retryFeed("scene5");
  await cctv.prepareFeeds();
  assert.equal(disposals, 1, "the successfully loaded GIF remains alive");
  cctv.dispose();
  assert.equal(disposals, 2);
});

test("wall footage contains eight prerecorded room GIFs and runtime never captures previews", async () => {
  const urls = Object.values(cameraFootage);
  assert.equal(new Set(urls).size, 8);
  for (const url of urls) {
    assert.match(url, /\.gif$/);
    const buffer = await readFile(new URL(`../src${url}`, import.meta.url));
    const clip = corridorMonitor.decodeCorridorGif(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    );
    assert.equal(clip.frames.length, 24);
    assert.ok(Math.abs(clip.duration - 2.4) < 1e-8);
  }
  const runtime = await readFile(
    new URL("../src/scripts/npc/cctv.ts", import.meta.url),
    "utf8",
  );
  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    runtime,
    /WebGLRenderTarget|renderer\.|captureFeed|CctvFeedSource/,
  );
  assert.doesNotMatch(
    main,
    /async function cameraFeed|load: \(\) => cameraFeed/,
  );
});

test("desk monitors advance and loop the original corridor GIFs without playable scenes", async (t) => {
  browser(t);
  const buffer = await readFile(
    new URL("../src/assets/surveillance/corridor-bots-1.gif", import.meta.url),
  );
  const bytes = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  const clip = corridorMonitor.decodeCorridorGif(bytes);
  assert.equal(clip.frames.length, 24);
  assert.ok(Math.abs(clip.duration - 2.4) < 1e-8);
  assert.notDeepEqual(clip.frames[0].pixels, clip.frames[6].pixels);
  t.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const monitor = corridorMonitor.createCorridorMonitor(0);
  t.cleanup(() => monitor.dispose());
  await monitor.ready;
  assert.equal(monitor.texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(monitor.getFrameIndex(), 0);
  const version = monitor.texture.version;
  monitor.update(0.01);
  assert.equal(
    monitor.texture.version,
    version,
    "no upload within the same GIF frame",
  );
  monitor.update(0.09);
  monitor.update(0.1);
  assert.equal(monitor.getFrameIndex(), 2);
  assert.ok(monitor.texture.version > version);
  for (let frame = 0; frame < 24; frame++) monitor.update(0.1);
  assert.equal(monitor.getFrameIndex(), 2, "recording loops");
  assert.equal("scene" in monitor, false);
  assert.equal("camera" in monitor, false);
  monitor.dispose();
  monitor.update(0.1);
  assert.equal(monitor.getFrameIndex(), 2);
});

test("only directly rear pistol shots disable eye drones, with no added perimeter patrols", async (t) => {
  browser(t);
  const physics = createPhysics(),
    scene = new THREE.Scene(),
    hangar = createHangar(scene, physics, 12);
  let alarms = 0,
    blocked = 0;
  const shooter = { x: 33, y: 12.3, z: 0 };
  const director = droneStrategy.createStealthDirector(
    scene,
    physics,
    hangar,
    {
      getPlayerPosition: () => shooter,
      onAlarm: () => alarms++,
      onAttack() {},
      onDroneShotBlocked: () => blocked++,
    },
    modelLoader,
  );
  t.cleanup(() => {
    director.dispose();
    physics.dispose();
  });
  await director.ready;
  assert.equal(
    director.actors.filter((actor) => actor.kind === "eye").length,
    4,
  );
  assert.equal(
    director.actors.filter((actor) => actor.mode === "patrol").length,
    14,
  );
  const drone = director.actors.find((actor) => actor.kind === "eye"),
    target = director
      .getDamageTargets()
      .find((target) => target.root === drone.root);
  drone.root.position.set(30, 15.8, 0);
  drone.root.rotation.set(0, Math.PI / 2, 0);
  assert.equal(target.damage(25, "pistol"), false);
  assert.equal(blocked, 1);
  assert.equal(alarms, 1);
  assert.notEqual(drone.mode, "down");
  director.reset();
  drone.root.position.set(30, 15.8, 0);
  drone.root.rotation.set(0, Math.PI / 2, 0);
  shooter.x = 27;
  assert.equal(target.damage(25, "pistol"), true);
  assert.equal(drone.mode, "down");
  assert.equal(drone.light.visible, false);
  assert.equal(director.alarmed, false);
  assert.equal(director.consumeSilentDroneShot(), true);
  assert.equal(director.consumeSilentDroneShot(), false);
});

test("locked airlock gives its two short messages and the cleared hub can be entered through it", async (t) => {
  const elements = browser(t);
  let entered = 0;
  const data = createStorage({ modelLoader, restoreCheckpoint: true });
  t.cleanup(() => data.dispose());
  await data.ready;
  data.stealth.actors.forEach((actor) => {
    actor.mode = "reserve";
  });
  data.player.setPosition(84.5, 12.3, 20);
  tap("KeyE");
  assert.equal(elements.get("boss-subtitles").textContent, "Door locked.");
  step(data, 1.6);
  assert.equal(
    elements.get("boss-subtitles").textContent,
    "Prime: We must find another way.",
  );
  data.dispose();
  const linked = createStorage({
    modelLoader,
    restoreCheckpoint: true,
    airlockUnlocked: true,
    onAirlockEnter: async () => {
      entered++;
      return true;
    },
  });
  t.cleanup(() => linked.dispose());
  await linked.ready;
  linked.stealth.actors.forEach((actor) => {
    actor.mode = "reserve";
  });
  linked.player.setPosition(84.5, 12.3, 20);
  tap("KeyE");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(entered, 1);
  assert.equal(linked.getStageState().phase, "complete");
});

for (const entry of ["checkpoint", "teleport", "airlock"]) {
  test(`the surveillance airlock remains unusable after ${entry} entry, even in an old unlocked save`, async (t) => {
    browser(t);
    const progress = layout.createStageTwoProgress();
    progress.checkpoint = "surveillance";
    progress.guardDown = true;
    progress.airlockUnlocked = true;
    let returns = 0;
    const data = await stage(t, progress, {
      fromAirlock: entry === "airlock",
      onAirlockReturn: async () => {
        returns++;
        return true;
      },
    });
    if (entry === "teleport") {
      const { teleportPlayer } = await server.ssrLoadModule(
        "/scripts/global/teleportationDevice.ts",
      );
      teleportPlayer(data.player, { x: 20.1, y: 0.3, z: -46 }, Math.PI / 2);
    } else data.player.setPosition(20.1, 0.3, -46);
    step(data, 0.8);
    data.player.setPosition(18.9, 0.3, -46);
    step(data, 0.1);
    await Promise.resolve();
    assert.equal(returns, 0);
    assert.equal(progress.airlockUnlocked, false);
    assert.equal(data.getStageState().phase, "surveillance");
    assert.deepEqual(data.getDamageTargets(), []);
    tap("KeyE");
    step(data, 0.1);
    assert.equal(returns, 0, "walking, E and crowbar hits cannot unlock it");
  });
}

test("silent takedown takes priority over a ladder and freezes every other bot for its short animation", async (t) => {
  browser(t);
  const data = createStorage({ modelLoader, restoreCheckpoint: true });
  t.cleanup(() => data.dispose());
  await data.ready;
  const ladder = data.hangar.ladders[0],
    actor = data.stealth.actors.find((actor) => actor.kind === "trilobite");
  data.player.setPosition(ladder.x, 12.3, ladder.z + ladder.side * 0.42);
  data.player.setForcedCrouch(true);
  actor.root.position.set(ladder.x + 1.2, 12, data.player.body.position.z);
  actor.root.rotation.set(0, Math.PI / 2, 0);
  actor.path = [];
  actor.dwell = 10;
  actor.suspicion = 0;
  const positions = data.stealth.actors
    .filter((other) => other !== actor)
    .map((other) => other.root.position.clone());
  tap("KeyE");
  assert.equal(data.getStageState().phase, "takedown");
  assert.equal(data.getCinematicPose().clip, "Silent_Takedown");
  step(data, 0.7);
  data.stealth.actors
    .filter((other) => other !== actor)
    .forEach((other, index) =>
      assert.ok(other.root.position.equals(positions[index])),
    );
  assert.equal(data.player.getState().climbing, false);
  step(data, 1);
  assert.equal(data.getStageState().phase, "hangar");
});

test("mounting a ladder from crouch standardizes the pose; holding Space doubles climb travel", async (t) => {
  browser(t);
  const data = createStorage({ modelLoader, restoreCheckpoint: true });
  t.cleanup(() => data.dispose());
  await data.ready;
  data.stealth.actors.forEach((actor) => {
    actor.mode = "reserve";
  });
  const ladder = data.hangar.ladders.find(
    (ladder) => ladder.id === "VentAccessLadder",
  );
  data.player.setPosition(ladder.x, 12.3, ladder.topZ);
  data.player.setForcedCrouch(true);
  tap("KeyE");
  step(data, 0.5);
  assert.equal(data.player.getState().crouching, false);
  assert.equal(data.getCinematicPose().loop, true);
  const initial = data.player.body.position.y;
  step(data, 1);
  const normal = data.player.body.position.y - initial;
  key("Space");
  const fastStart = data.player.body.position.y;
  step(data, 1);
  key("Space", "keyup");
  assert.ok(
    Math.abs(data.player.body.position.y - fastStart - normal * 2) < 0.03,
  );
  assert.equal(data.player.getState().jumping, false);
});

test("ship map keeps traversal connected and stacks camera-only minigames on surveilled decks", async () => {
  const { createShipMapProgress } =
    await server.ssrLoadModule("/core/shipMap.ts");
  const { DECK_ONE_MAP } = await server.ssrLoadModule(
    "/scenes/level 1 stage 1/storageRoom.ts",
  );
  const progress = createShipMapProgress();
  progress.reveal(DECK_ONE_MAP);
  progress.reveal(layout.STAGE_TWO_MAP);
  for (const id of [5, 6, 37]) progress.reveal(layout.cameraVisitMap(id));
  progress.reveal(layout.BAY_THIRTEEN_MAP);
  const map = progress.getLayout();
  assert.equal(
    map.rooms.some((room) => room.id === 33),
    false,
    "old storeroom entrance is gone",
  );
  assert.equal(map.cameraLinks.length, 3);
  for (const id of [5, 6, 37]) {
    assert.equal(
      map.connections.some((pair) => pair.includes(35) && pair.includes(id)),
      false,
    );
    const remote = map.rooms.find((room) => room.id === id),
      hub = map.rooms.find((room) => room.id === 35);
    assert.ok(Math.abs(remote.position.x - hub.position.x) > 25);
    assert.notEqual(remote.position.y, hub.position.y);
    assert.notEqual(remote.deck, "main");
    assert.equal(
      map.playerPoint(id, { x: 0, y: 0.3, z: 0 }).y,
      remote.position.y + 2.2,
    );
  }
  assert.equal(map.goals.length, 2);
  assert.equal(map.verticalLinks.length, 2);
  const lift = map.rooms.find((room) => room.id === 36),
    boss = map.rooms.find((room) => room.id === 13);
  assert.equal(boss.position.y, lift.position.y - 18);
  assert.ok(
    map.rooms.find((room) => room.id === 34).position.x >
      map.rooms.find((room) => room.id === 31).position.x,
  );
  const hub = map.rooms.find((room) => room.id === 35),
    vents = map.rooms.find((room) => room.id === 34);
  assert.ok(
    Math.abs(hub.position.x - vents.position.x) < 3 &&
      Math.abs(hub.position.z - vents.position.z) < 15,
  );
  assert.ok(
    map.connections.some((pair) => pair.includes(31) && pair.includes(35)),
    "airlock connects hangar and camera room",
  );
  assert.equal(map.elevatorRoutes.length, 2);
  assert.ok(map.elevatorRoutes.every((route) => [13, 36].includes(route.id)));
});
