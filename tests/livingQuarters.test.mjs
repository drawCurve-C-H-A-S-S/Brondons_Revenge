import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let server,
  THREE,
  CANNON,
  GLTFLoader,
  layout,
  createScene,
  createCabinFurnishings,
  getMapRoomContents;
let createShipMapProgress, DECK_ONE_MAP, SHIP_MAP_LAYOUT, roomPoint;
let createPrologueFlashbacks,
  PistolController,
  createPlayer,
  createScenePhysics;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "quarters-test-deps",
        resolveId: (id) =>
          id === "virtual:quarters-deps" ? "\0quarters-deps" : null,
        load: (id) =>
          id === "\0quarters-deps"
            ? "export * as THREE from 'three'; export * as CANNON from 'cannon-es'; export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';"
            : null,
      },
    ],
  });
  ({ THREE, CANNON, GLTFLoader } = await server.ssrLoadModule(
    "virtual:quarters-deps",
  ));
  layout = await server.ssrLoadModule("/scenes/living quarters/layout.ts");
  ({ createScene } = await server.ssrLoadModule(
    "/scenes/living quarters/scene.ts",
  ));
  ({ createCabinFurnishings } = await server.ssrLoadModule(
    "/scenes/living quarters/furnishings.ts",
  ));
  ({ getMapRoomContents, createShipMapProgress, SHIP_MAP_LAYOUT } =
    await server.ssrLoadModule("/core/shipMap.ts"));
  ({ DECK_ONE_MAP } = await server.ssrLoadModule(
    "/scenes/level 1 stage 1/storageRoom.ts",
  ));
  ({ roomPoint } = await server.ssrLoadModule("/scripts/global/shipLayout.ts"));
  ({ createPrologueFlashbacks } = await server.ssrLoadModule(
    "/scenes/prologue/prologueFlashbacks.ts",
  ));
  ({ PistolController } = await server.ssrLoadModule(
    "/scripts/weapons/pistol.ts",
  ));
  ({ createPlayer } = await server.ssrLoadModule("/scripts/player/player.ts"));
  ({ createScenePhysics } = await server.ssrLoadModule(
    "/helpers/physics/scenePhysics.ts",
  ));
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
      measureText: (text) => ({ width: text.length * 17 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    },
    { get: (target, name) => (name in target ? target[name] : () => {}) },
  );
  class Element extends EventTarget {
    constructor(tag = "div") {
      super();
      this.tagName = tag.toUpperCase();
      this.ownerDocument = { defaultView: { Element } };
    }
    style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    dataset = {};
    children = [];
    textContent = "";
    disabled = false;
    classes = new Set();
    set id(value) {
      this._id = value;
      elements.set(value, this);
    }
    get id() {
      return this._id;
    }
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
      toggle: (name, value = !this.classes.has(name)) => {
        this.classList[value ? "add" : "remove"](name);
        return value;
      },
    };
    append(...nodes) {
      nodes.forEach((node) => {
        this.children.push(node);
        node.parentElement = this;
      });
    }
    appendChild(node) {
      this.append(node);
      return node;
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter(
          (node) => node !== this,
        );
      this.parentElement = null;
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    set src(value) {
      this._src = value;
      if (this.tagName === "IMG") {
        this.width = 800;
        this.height = 450;
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    get src() {
      return this._src;
    }
    getContext() {
      return context;
    }
    closest(selector) {
      return selector
        .split(",")
        .some((tag) => tag.trim().toUpperCase() === this.tagName)
        ? this
        : null;
    }
    getBoundingClientRect() {
      return { width: 1280, height: 720, left: 0, top: 0, bottom: 720 };
    }
    requestPointerLock() {}
    focus() {}
  }
  globalThis.HTMLElement = Element;
  globalThis.ProgressEvent = class extends Event {};
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 1280,
    innerHeight: 720,
  });
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    pointerLockElement: null,
    baseURI: "http://localhost:5173/",
    body: new Element("body"),
    createElement: (tag) => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
    getElementById: (id) => {
      if (!elements.has(id)) {
        const node = new Element();
        node.id = id;
      }
      return elements.get(id);
    },
  });
  const cleanups = [];
  t.cleanup = (fn) => cleanups.push(fn);
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    Object.assign(globalThis, previous);
  });
  return elements;
}
function event(type, code) {
  const value = new Event(type, { cancelable: true });
  Object.defineProperties(value, {
    code: { value: code },
    repeat: { value: false },
  });
  window.dispatchEvent(value);
}
function key(code) {
  event("keydown", code);
  event("keyup", code);
}
function step(data, seconds) {
  for (let index = 0; index < Math.ceil(seconds * 60); index++) {
    data.updatePhysics(1 / 60);
    data.updateInteractionFocus?.();
  }
}
function prop(name) {
  const size =
    name === "Prop_Desk_Small"
      ? [2.0635, 0.9396, 1.0289]
      : name === "Prop_Chair"
        ? [0.8807, 1.6417, 1.1224]
        : [0.6, 0.2, 0.12];
  const group = new THREE.Group(),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial(),
    );
  mesh.position.y = size[1] / 2;
  group.add(mesh);
  return { scene: group };
}
async function quarters(t, options = {}) {
  const data = createScene({
    skipArrival: true,
    loadCabinModel: async (name) => prop(name),
    ...options,
  });
  t.cleanup(() => data.dispose());
  await data.ready;
  return data;
}
function aim(data, position, point) {
  data.player.setPosition(position.x, data.player.radius, position.z);
  data.player.setRotation(
    Math.atan2(-(point.x - position.x), -(point.z - position.z)),
    0,
  );
  data.camera.position.set(position.x, data.player.getHeadY(), position.z);
  data.camera.lookAt(point);
  data.camera.updateMatrixWorld(true);
}
function aimDoor(data, cabin, inside = false) {
  const position = layout.cabinDoorPoint(cabin);
  position.x += cabin.side * (inside ? 0.95 : -0.95);
  aim(data, position, layout.cabinDoorPoint(cabin).setY(1.3));
}
function leaveCabin(data, cabin) {
  aimDoor(data, cabin, true);
  key("KeyE");
  step(data, 1);
  event("keydown", "KeyW");
  step(data, 1.1);
  event("keyup", "KeyW");
  assert.equal(data.getLocation(), "hallway");
}
function leaveBrondon(data) {
  leaveCabin(data, layout.CABIN_BY_ID.get("brondon"));
}

test("Prime blocks cabin gaming during an unfinished campaign without seating or locking the player", async (t) => {
  const elements = browser(t),
    data = await quarters(t);
  step(data, 3);
  data.scene.updateMatrixWorld(true);
  const cabin = data.scene.getObjectByName("CabinFurnishings-brondon");
  const computer = cabin.getObjectByName("CabinComputer");
  assert.ok(computer);
  assert.equal(
    cabin.getObjectByName("CabinComputerScreen").material.map.name,
    "CrewGameMenu-brondon",
  );
  const iframeCount = (node) =>
    Number(node.tagName === "IFRAME") +
    node.children.reduce((count, child) => count + iframeCount(child), 0);
  assert.equal(
    iframeCount(document.body),
    0,
    "An unfinished campaign must not load a live website",
  );
  const point = computer
    .getWorldPosition(new THREE.Vector3())
    .add(new THREE.Vector3(0, 0.3, 0));
  aim(data, point.clone().add(new THREE.Vector3(0, 0, 1.25)), point);
  data.updateInteractionFocus();
  assert.match(
    elements.get("quarters-interact").textContent,
    /Inspect computer/,
  );
  key("KeyE");
  assert.equal(elements.get("quarters-speaker").textContent, "Prime");
  assert.match(
    elements.get("quarters-subtitle-text").textContent,
    /Lock in.*crewmembers/,
  );
  assert.doesNotMatch(
    elements.get("quarters-subtitle-text").textContent,
    /You can play when/,
  );
  assert.equal(
    elements.get("quarters-subtitle").classList.contains("hidden"),
    false,
  );
  assert.equal(data.isCinematic(), false);
  assert.equal(data.player.isEnabled(), true);
  step(data, 9.1);
  assert.equal(
    elements.get("quarters-subtitle").classList.contains("hidden"),
    true,
  );
});

test("Brondon cannot sit or play at his computer even during a developer visit", async (t) => {
  browser(t);
  const data = await quarters(t, { developerAccess: true });
  step(data, 3);
  const frames = [];
  const collect = (node) => {
    if (node.tagName === "IFRAME") frames.push(node);
    node.children.forEach(collect);
  };
  collect(document.body);
  assert.equal(frames.length, 0);
  const cabin = data.scene.getObjectByName("CabinFurnishings-brondon");
  const screen = cabin.getObjectByName("CabinComputerScreen"),
    material = screen.material;
  assert.equal(material.map.name, "CrewGameMenu-brondon");
  const point = cabin
    .getObjectByName("CabinComputer")
    .getWorldPosition(new THREE.Vector3())
    .add(new THREE.Vector3(0, 0.3, 0));
  aim(data, point.clone().add(new THREE.Vector3(0, 0, 1.25)), point);
  key("KeyE");
  step(data, 0.1);
  assert.equal(
    screen.material,
    material,
    "Inspecting the game must leave the static screen in place",
  );
  step(data, 3);
  collect(document.body);
  assert.equal(frames.length, 0);
  assert.equal(data.isCinematic(), false);
  assert.equal(data.player.isEnabled(), true);
  assert.equal(screen.material, material);
  frames.length = 0;
  collect(document.body);
  assert.equal(frames.length, 0);
  layout.setStudentCabinAccess(false);
});

test("keypad D-pad wraps a three-column grid and confirms the selected buttons", async (t) => {
  browser(t);
  const { createKeypad } = await server.ssrLoadModule(
    "/scenes/living quarters/surfaces.ts",
  );
  let unlocked = false;
  const keypad = createKeypad({
    code: "1230",
    title: "Test keypad",
    isUnlocked: () => unlocked,
    onUnlock: () => {
      unlocked = true;
    },
  });
  t.after(() => keypad.texture.dispose());
  keypad.reset();
  keypad.focus(true);
  keypad.click();
  keypad.key("ArrowRight");
  keypad.click();
  keypad.key("ArrowRight");
  keypad.click();
  keypad.key("ArrowUp");
  keypad.key("ArrowLeft");
  keypad.click();
  keypad.key("ArrowRight");
  assert.equal(keypad.click(), "unlock");
  assert.equal(unlocked, true);
  keypad.key("ArrowRight");
  assert.equal(keypad.cursor.x, 76, "Right wraps from OK to CLR");
  keypad.key("ArrowDown");
  assert.equal(keypad.cursor.y, 185.5, "Down wraps from CLR to 1");
});

test("eight cabins have four doors per side, three named lecturers, five locked students and distinct posters", () => {
  assert.equal(layout.CABINS.length, 8);
  for (const side of [-1, 1])
    assert.deepEqual(
      layout.CABINS.filter((cabin) => cabin.side === side).map(
        (cabin) => cabin.slot,
      ),
      [0, 1, 2, 3],
    );
  assert.deepEqual(
    layout.CABINS.filter((cabin) => !cabin.locked)
      .map((cabin) => cabin.occupant)
      .sort(),
    ["Branden", "Brendan", "Brondon"],
  );
  assert.equal(layout.CABINS.filter((cabin) => cabin.locked).length, 5);
  assert.deepEqual(
    layout.CABINS.filter((cabin) => cabin.locked).map(
      (cabin) => cabin.occupant,
    ),
    ["Caleb", "Husain", "Andre'", "Sibusiso", "Sohrab"],
  );
  assert.equal(
    layout.cabinRoomName(layout.CABIN_BY_ID.get("student-03")),
    "Andre's room",
  );
  assert.equal(new Set(layout.CABINS.map((cabin) => cabin.quote)).size, 8);
  assert.equal(new Set(layout.CABINS.map((cabin) => cabin.code)).size, 8);
  for (let index = 1; index < layout.QUARTERS.slots.length; index++)
    assert.ok(
      layout.QUARTERS.slots[index] - layout.QUARTERS.slots[index - 1] >
        layout.QUARTERS.cabinDepth,
    );
});

test("the map exposes furniture only in unlocked cabins, uses live coordinates and identifies the Deck One bulkhead", () => {
  const map = layout.LIVING_QUARTERS_MAP;
  assert.equal(map.rooms.length, 9);
  assert.equal(map.connections.length, 8);
  for (const room of map.rooms.filter((room) => room.id !== 20)) {
    assert.equal(getMapRoomContents(room).length, room.locked ? 0 : 5);
    if (room.locked)
      assert.ok(
        room.mapContents.length > 0,
        "Hiding must apply even when a locked cabin has furnishing data",
      );
  }
  assert.deepEqual(
    map.playerPoint(21, { x: -4.2, y: 0.3, z: -11.4 }).toArray(),
    [-4.2, 2.2, -11.4],
  );
  assert.ok(map.connections.every((pair) => pair.includes(20)));
  assert.match(
    map.rooms.find((room) => room.id === 20).description,
    /Keypad bulkhead.*Deck One/,
  );
});

function mapDoor(map, id, portal) {
  const room = map.rooms.find((room) => room.id === id),
    door = room.portals[portal];
  return roomPoint(room, door.x, door.z);
}

test("map discovery retains quarters and joins the entire stealth section only after entry", () => {
  const progress = createShipMapProgress();
  assert.equal(progress.getLayout().rooms.length, 0);
  progress.reveal(layout.LIVING_QUARTERS_MAP);
  const before = progress.getLayout();
  assert.equal(before.rooms.length, 9);
  assert.equal(
    before.rooms.some((room) => room.id === 29),
    false,
  );
  assert.equal(progress.getLayout(), before);
  const sourcePosition = DECK_ONE_MAP.rooms[0].position.clone();
  progress.reveal(DECK_ONE_MAP);
  const map = progress.getLayout();
  assert.equal(map.rooms.length, 13);
  assert.equal(map.connections.length, 12);
  assert.deepEqual(
    map.rooms.slice(-4).map((room) => room.id),
    [29, 30, 31, 32],
  );
  assert.ok(
    map.connections.some((pair) => pair.includes(20) && pair.includes(29)),
  );
  assert.ok(
    mapDoor(map, 20, "forward").distanceTo(mapDoor(map, 29, "quarters")) < 1e-9,
  );
  assert.ok(
    mapDoor(map, 29, "storage").distanceTo(mapDoor(map, 30, "passage")) < 1e-9,
  );
  assert.ok(
    mapDoor(map, 29, "hangar").distanceTo(mapDoor(map, 31, "passage")) < 1e-9,
  );
  assert.ok(
    map
      .playerPoint(29, { x: -12.6, y: 12.3, z: -2.5 })
      .distanceTo(new THREE.Vector3(0, 2.2, 17.4)) < 1e-9,
  );
  assert.deepEqual(
    map.playerPoint(21, { x: -4.2, y: 0.3, z: -11.4 }).toArray(),
    [-4.2, 2.2, -11.4],
  );
  for (const room of map.rooms.filter((room) => room.locked))
    assert.deepEqual(getMapRoomContents(room), []);
  assert.equal(map.rooms.filter((room) => room.locked).length, 5);
  assert.ok(
    DECK_ONE_MAP.rooms[0].position.equals(sourcePosition),
    "Map composition must not mutate the scene layout",
  );
  progress.reveal(layout.LIVING_QUARTERS_MAP);
  progress.reveal({ ...DECK_ONE_MAP, initialRoom: 30 });
  assert.equal(
    progress.getLayout(),
    map,
    "Returning to an area must not duplicate it or reset the map view",
  );
  assert.equal(before.rooms.length, 9, "Previous snapshots remain stable");
});

test("direct stealth entry can later discover quarters through the same bulkhead in reverse", () => {
  const progress = createShipMapProgress();
  progress.reveal(DECK_ONE_MAP);
  progress.reveal(layout.LIVING_QUARTERS_MAP);
  const map = progress.getLayout();
  assert.equal(map.rooms.length, 13);
  assert.ok(
    mapDoor(map, 20, "forward").distanceTo(mapDoor(map, 29, "quarters")) < 1e-9,
  );
  assert.deepEqual(
    map.playerPoint(29, { x: -12.6, y: 12.3, z: -2.5 }).toArray(),
    [-12.6, 2.2, -2.5],
  );
  assert.equal(
    map.connections.filter((pair) => pair.includes(20) && pair.includes(29))
      .length,
    1,
  );
});

test("later ship blueprints retain vent paths, vertical links and prior discovery; a fresh prologue clears it", () => {
  const progress = createShipMapProgress();
  progress.reveal(layout.LIVING_QUARTERS_MAP);
  progress.reveal(DECK_ONE_MAP);
  progress.reveal(SHIP_MAP_LAYOUT);
  const map = progress.getLayout();
  assert.equal(map.rooms.length, 13 + SHIP_MAP_LAYOUT.rooms.length);
  assert.equal(map.ventPaths.length, SHIP_MAP_LAYOUT.ventPaths.length);
  assert.equal(
    map.verticalLinks.length,
    SHIP_MAP_LAYOUT.verticalLinks.length + 1,
  );
  const room = map.rooms.find((room) => room.id === 3);
  assert.ok(
    map
      .playerPoint(3, { x: 0, y: 0.3, z: 0 })
      .distanceTo(room.position.clone().add(new THREE.Vector3(0, 2.2, 0))) <
      1e-9,
  );
  progress.reset();
  assert.equal(progress.getLayout().rooms.length, 0);
  assert.equal(progress.getLayout().connections.length, 0);
  assert.equal(
    progress.getLayout().playerPoint(29, { x: 0, y: 0, z: 0 }),
    null,
  );
  progress.reveal(layout.LIVING_QUARTERS_MAP);
  assert.equal(progress.getLayout().rooms.length, 9);
});

test("invalid map joins fail explicitly without partially charting a section", () => {
  const progress = createShipMapProgress();
  progress.reveal(layout.LIVING_QUARTERS_MAP);
  const before = progress.getLayout();
  assert.throws(
    () =>
      progress.reveal({
        ...DECK_ONE_MAP,
        joins: [
          {
            from: { room: 20, portal: "missing" },
            to: { room: 29, portal: "quarters" },
          },
        ],
      }),
    /Missing map portal/,
  );
  assert.equal(progress.getLayout(), before);
  assert.throws(
    () =>
      progress.reveal({
        ...DECK_ONE_MAP,
        rooms: [layout.LIVING_QUARTERS_MAP.rooms[0]],
      }),
    /Duplicate charted room/,
  );
});

test("every cabin template has a bed, scaled desk and chair, computer and readable unique poster", async (t) => {
  browser(t);
  const physics = createScenePhysics();
  t.after(() => physics.dispose());
  for (const cabin of layout.CABINS) {
    const room = await createCabinFurnishings(
      cabin,
      physics,
      layout.createQuartersProgress(),
      async (name) => prop(name),
    );
    for (const name of [
      "CabinBed",
      "CabinDesk",
      "CabinChair",
      "CabinComputer",
      "ExpeditionPoster",
    ])
      assert.ok(
        room.root.getObjectByName(name),
        `${cabin.occupant} needs ${name}`,
      );
    const screen = room.computer.getObjectByName("CabinComputerScreen");
    assert.equal(screen.material.map.image.width, 800);
    assert.equal(screen.material.map.image.height, 450);
    const desk = new THREE.Box3().setFromObject(room.desk),
      chair = new THREE.Box3().setFromObject(room.chair);
    const deskSize = desk.getSize(new THREE.Vector3()),
      chairSize = chair.getSize(new THREE.Vector3());
    assert.ok(Math.abs(deskSize.y - 0.84) < 0.001);
    assert.ok(deskSize.x <= 2.2 && deskSize.z <= 1.02);
    assert.ok(Math.abs(chairSize.y - 1.12) < 0.001);
    assert.ok(chairSize.x <= 0.75 && chairSize.z <= 0.85);
    assert.ok(Math.abs(desk.min.y) < 0.001 && Math.abs(chair.min.y) < 0.001);
    assert.equal(
      !!room.root.getObjectByName("CrewFootlocker"),
      cabin.role === "lecturer",
    );
    if (cabin.role === "lecturer") {
      for (const name of ["ChestBase", "ChestLid"])
        assert.equal(
          room.chest.getObjectByName(name).material.color.getHex(),
          0xc4c4c4,
        );
    }
    const server = room.root.getObjectByName("ShipServerRack");
    assert.equal(
      !!server,
      cabin.id === "student-05",
      "Only Sohrab has a camera-room server",
    );
    if (server) {
      room.root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(server),
        center = layout.cabinCenter(cabin);
      assert.ok(
        Math.abs(bounds.min.y) < 0.001 && Math.abs(bounds.max.y - 2.65) < 0.001,
      );
      assert.ok(bounds.min.x > center.x - layout.QUARTERS.cabinWidth / 2);
      assert.ok(bounds.max.x < center.x + layout.QUARTERS.cabinWidth / 2);
      assert.ok(bounds.min.z > center.z - layout.QUARTERS.cabinDepth / 2);
      assert.ok(bounds.max.z < center.z + layout.QUARTERS.cabinDepth / 2);
      for (const furnishing of [room.bed, room.desk, room.chair, room.poster])
        assert.equal(
          bounds.intersectsBox(new THREE.Box3().setFromObject(furnishing)),
          false,
        );
      const point = bounds.getCenter(new THREE.Vector3()),
        size = bounds.getSize(new THREE.Vector3());
      const body = physics.world.bodies.find(
        (body) =>
          body.position.distanceTo(new CANNON.Vec3(point.x, point.y, point.z)) <
          0.001,
      );
      assert.ok(body, "The server must have a matching collider");
      assert.ok(Math.abs(body.shapes[0].halfExtents.x * 2 - size.x) < 0.001);
      assert.ok(Math.abs(body.shapes[0].halfExtents.y * 2 - size.y) < 0.001);
      assert.ok(Math.abs(body.shapes[0].halfExtents.z * 2 - size.z) < 0.001);
    }
    room.dispose();
    assert.equal(physics.world.bodies.length, 0);
  }
});

test("the actual desk and chair glTF assets fit cabin dimensions without floating or nonuniform scaling", async (t) => {
  browser(t);
  const models = new Map();
  for (const name of ["Prop_Desk_Small", "Prop_Chair", "Gun_Revolver"]) {
    const base = new URL("../src/assets/models/Tools/", import.meta.url);
    const json = JSON.parse(
      await readFile(new URL(`${name}.gltf`, base), "utf8"),
    );
    for (const buffer of json.buffers)
      buffer.uri = `data:application/octet-stream;base64,${(await readFile(new URL(buffer.uri, base))).toString("base64")}`;
    delete json.materials;
    delete json.textures;
    delete json.images;
    for (const mesh of json.meshes)
      for (const primitive of mesh.primitives) delete primitive.material;
    models.set(
      name,
      (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene,
    );
  }
  const physics = createScenePhysics();
  t.after(() => physics.dispose());
  const room = await createCabinFurnishings(
    layout.CABIN_BY_ID.get("brondon"),
    physics,
    layout.createQuartersProgress(),
    async (name) => ({ scene: models.get(name) }),
  );
  t.after(() => room.dispose());
  for (const [model, expected] of [
    [room.desk, 0.84],
    [room.chair, 1.12],
  ]) {
    const box = new THREE.Box3().setFromObject(model),
      size = box.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - expected) < 0.001);
    assert.ok(Math.abs(box.min.y) < 0.001);
    assert.equal(model.scale.x, model.scale.y);
    assert.equal(model.scale.y, model.scale.z);
  }
  assert.equal(room.root.getObjectByName("PersonalTeleportDevice"), undefined);
  assert.equal("teleporter" in room, false);
});

test("arrival has moving room/hallway shots, hold-Enter skip, no premature control and pause-safe timing", async (t) => {
  const elements = browser(t),
    data = await quarters(t, { skipArrival: false });
  assert.equal(data.player.isEnabled(), false);
  assert.equal(data.isCinematic(), true);
  const start = data.camera.position.clone();
  step(data, 2);
  assert.ok(start.distanceTo(data.camera.position) > 0.05);
  const paused = data.camera.position.clone();
  data.setMenuPaused(true);
  step(data, 3);
  assert.ok(paused.equals(data.camera.position));
  data.setMenuPaused(false);
  step(data, 8);
  assert.ok(
    Math.abs(data.camera.position.x) < 1,
    "Arrival must cut into the actual living quarters passage",
  );
  assert.match(
    elements.get("quarters-subtitle-text").textContent,
    /I don't have physical records of where the others are/,
  );
  assert.doesNotMatch(
    elements.get("quarters-subtitle-text").textContent,
    /only area|facility|planet/,
  );
  step(data, 5);
  assert.match(
    elements.get("quarters-subtitle-text").textContent,
    /prison camera.*Hangar 14/,
  );
  step(data, 6);
  assert.match(
    elements.get("quarters-subtitle-text").textContent,
    /Look around the crew cabins for useful items/,
  );
  assert.doesNotMatch(
    elements.get("quarters-subtitle-text").textContent,
    /chest|locker|blue LED|Branden|Brendan/,
  );
  event("keydown", "Enter");
  step(data, 1.2);
  event("keyup", "Enter");
  assert.equal(data.isCinematic(), false);
  assert.equal(data.player.isEnabled(), true);
  assert.equal(data.getLocation(), "brondon");
  assert.equal(data.getMapSceneId(), "scene21");
  assert.equal(elements.get("quarters-status").children.length, 1);
  assert.equal(elements.get("quarters-location").textContent, "Brondon's room");
  assert.equal(data.scene.getObjectByName("CrewPrivacyDisplay"), undefined);
  assert.equal(data.scene.getObjectByName("CabinHullViewport"), undefined);
  assert.ok(
    data.scene.getObjectByName("CabinFurnishings-branden"),
    "Branden is preloaded",
  );
  assert.ok(
    data.scene.getObjectByName("CabinFurnishings-brendan"),
    "Brendan is preloaded",
  );
});

test("nameplates identify rooms without E, while locked doors retain E prompts, physical barriers and opaque maps", async (t) => {
  const elements = browser(t),
    data = await quarters(t);
  leaveBrondon(data);
  const cabin = layout.CABIN_BY_ID.get("student-01");
  const sign = data.scene.getObjectByName(`CabinIdentitySign-${cabin.id}`);
  const position = sign.position.clone();
  position.x -= cabin.side * 0.8;
  aim(data, position, sign.position);
  data.updateInteractionFocus();
  assert.equal(elements.get("quarters-room-name").textContent, "Caleb's room");
  assert.equal(
    elements.get("quarters-room-name").classList.contains("hidden"),
    false,
  );
  assert.equal(
    elements.get("quarters-interact").classList.contains("hidden"),
    true,
  );
  key("KeyE");
  assert.equal(data.isCinematic(), false);
  aimDoor(data, cabin);
  data.updateInteractionFocus();
  assert.equal(
    elements.get("quarters-room-name").classList.contains("hidden"),
    true,
  );
  assert.equal(
    elements.get("quarters-interact").classList.contains("hidden"),
    false,
  );
  assert.match(
    elements.get("quarters-interact").textContent,
    /E \/ Check locked door/,
  );
  key("KeyE");
  step(data, 0.2);
  assert.equal(
    elements.get("quarters-notice").textContent,
    "Caleb's room. Door is locked.",
  );
  assert.equal(data.doors.get(cabin.id).open, 0);
  let obstruction = null,
    distance = Infinity;
  data.physicsWorld.raycastAll(
    new CANNON.Vec3(0, 1.3, cabin.z),
    new CANNON.Vec3(-3.5, 1.3, cabin.z),
    { checkCollisionResponse: true },
    (hit) => {
      if (hit.body === data.player.body || hit.distance >= distance) return;
      obstruction = hit.body;
      distance = hit.distance;
    },
  );
  assert.ok(
    data.doors.get(cabin.id).leaves.some((leaf) => leaf.body === obstruction),
  );
  await assert.rejects(data.preloadCabin(cabin.id), /room is locked/);
  const mask = data.scene.getObjectByName(`LockedCabinMapMask-${cabin.id}`);
  assert.equal(mask.visible, false);
  const restore = data.minimap.prepare();
  assert.equal(mask.visible, true);
  restore();
  assert.equal(mask.visible, false);
  assert.equal(
    data.scene.getObjectByName(`CabinFurnishings-${cabin.id}`),
    undefined,
  );
});

for (const fromPassage of [false, true]) {
  test(`cabin preloading serializes renderer state before activation (checkpoint entry: ${fromPassage})`, async (t) => {
    browser(t);
    let active = 0,
      maximum = 0,
      warmed = 0,
      target = null;
    const releases = [];
    const data = createScene({
      fromPassage,
      skipArrival: true,
      deferActivation: true,
      loadCabinModel: async (name) => prop(name),
      warmRoom: async () => {
        const previous = target;
        target = ++warmed;
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => releases.push(resolve));
        target = previous;
        active--;
      },
    });
    t.cleanup(() => data.dispose());
    for (let index = 0; index < 3; index++) {
      for (let turn = 0; !releases.length && turn < 100; turn++)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        releases.length,
        1,
        "Only one renderer warm-up may own the render target",
      );
      assert.equal(data.player.isEnabled(), false);
      releases.shift()();
    }
    await data.ready;
    assert.equal(maximum, 1);
    assert.equal(warmed, 3);
    assert.equal(target, null);
    for (const id of ["brondon", "branden", "brendan"])
      assert.ok(data.scene.getObjectByName(`CabinFurnishings-${id}`));
    data.activate();
    assert.equal(data.player.isEnabled(), true);
  });
}

test("failed initial cabin preloads report errors and retry without enabling unfinished quarters", async (t) => {
  const elements = browser(t),
    errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  let fail = true;
  const data = createScene({
    skipArrival: true,
    loadCabinModel: async (name) => {
      if (fail) throw new Error("Fixture resource failure");
      return prop(name);
    },
  });
  t.cleanup(() => data.dispose());
  await assert.rejects(data.ready, /Fixture resource failure/);
  assert.equal(data.player.isEnabled(), false);
  assert.ok(errors.length > 0);
  assert.match(
    elements.get("quarters-loading").textContent,
    /Press R to retry/,
  );
  fail = false;
  key("KeyR");
  await Promise.all(
    ["brondon", "branden", "brendan"].map((id) => data.preloadCabin(id)),
  );
  await new Promise((resolve) => setImmediate(resolve));
  step(data, 0.1);
  assert.equal(data.player.isEnabled(), true);
});

test("pistol, crystal shard and goggles persist without a separate teleport device", async (t) => {
  const elements = browser(t),
    progress = layout.createQuartersProgress();
  let pistols = 0,
    crystals = 0,
    goggles = 0;
  const data = await quarters(t, {
    progress,
    onPistolCollected: () => pistols++,
    onCrystalCollected: () => crystals++,
    onGogglesCollected: () => goggles++,
  });
  const cabin = layout.CABIN_BY_ID.get("brondon");
  aim(
    data,
    layout.cabinPoint(cabin, 0.5, 0.3, 0.65),
    layout.cabinPoint(cabin, 1.7, 0.6, 0.65),
  );
  key("KeyE");
  assert.equal(data.isCinematic(), true);
  step(data, 4.6);
  assert.equal(progress.pistolCollected, true);
  assert.equal(pistols, 1);
  assert.equal(data.scene.getObjectByName("RecoveredPistol").visible, false);
  assert.equal(data.scene.getObjectByName("PersonalTeleportDevice"), undefined);
  assert.match(
    layout.quartersObjective(progress),
    /Look around the crew cabins/,
  );
  leaveBrondon(data);
  for (const id of ["branden", "brendan"]) {
    const other = layout.CABIN_BY_ID.get(id);
    aimDoor(data, other);
    key("KeyE");
    await data.preloadCabin(id);
    step(data, 1);
    event("keydown", "KeyW");
    step(data, 1.1);
    event("keyup", "KeyW");
    aim(
      data,
      layout.cabinPoint(other, 0.5, 0.3, 0.65),
      layout.cabinPoint(other, 1.7, 0.6, 0.65),
    );
    key("KeyE");
    step(data, 4.6);
    assert.ok(progress.openedChests.has(id));
    assert.equal(pistols, 1);
    leaveCabin(data, other);
  }
  assert.equal(progress.crystalCollected, true);
  assert.equal(progress.gogglesCollected, true);
  assert.equal(crystals, 1);
  assert.equal(goggles, 1);
  assert.equal(layout.quartersEquipmentReady(progress), true);
  const forward = data.scene.getObjectByName("QuartersForwardBulkhead");
  aim(
    data,
    new THREE.Vector3(0, 0.3, 14.5),
    forward.position.clone().setY(1.3),
  );
  key("KeyE");
  assert.equal(data.getLocation(), "hallway");
  assert.equal(data.isCinematic(), false);
  assert.doesNotMatch(
    elements.get("quarters-notice").textContent,
    /Andre's locker.*bathroom/,
  );
  data.dispose();
  const revisit = await quarters(t, { progress, skipArrival: false });
  assert.equal(revisit.isCinematic(), false);
  assert.equal(revisit.player.isEnabled(), true);
  assert.equal(
    revisit.scene.getObjectByName("PersonalTeleportDevice"),
    undefined,
  );
  assert.equal(revisit.scene.getObjectByName("RecoveredPistol").visible, false);
  assert.ok(
    revisit.scene.getObjectByName("CrewFootlocker").getObjectByName("ChestLid")
      .parent.rotation.x > 1.3,
  );
  revisit.dispose();
});

test("pistol input and programmatic equipping respect recovery, while legacy contexts keep their original behavior", async (t) => {
  browser(t);
  const physics = createScenePhysics(),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: { x: 0, y: 0.3, z: 0 },
  });
  player.enable();
  let hasPistol = false;
  const pistol = new PistolController(
    () => ({
      scene,
      camera,
      world: physics.world,
      player,
      hasPistol,
      character: null,
      thirdPerson: false,
      targets: [],
    }),
    async () => prop("Gun_Revolver"),
  );
  t.after(() => {
    pistol.dispose();
    player.dispose();
    physics.dispose();
  });
  await pistol.ready;
  pistol.equip();
  key("KeyK");
  assert.equal(pistol.shoot(), false);
  assert.equal(pistol.isAiming(), false);
  hasPistol = true;
  pistol.update(0);
  key("KeyK");
  assert.equal(pistol.isEquipped(), false);
  pistol.equip();
  assert.equal(pistol.shoot(), true);
  hasPistol = false;
  pistol.update(0);
  assert.equal(pistol.root.visible, false);
  assert.equal(pistol.shoot(), false);
  const legacy = new PistolController(
    () => ({
      scene,
      camera,
      world: physics.world,
      player,
      character: null,
      thirdPerson: false,
      targets: [],
    }),
    async () => prop("Gun_Revolver"),
  );
  t.after(() => legacy.dispose());
  await legacy.ready;
  legacy.equip();
  assert.equal(legacy.isAiming(), true);
});

test("the prologue stealth feed uses the real hangar geometry, animated patrols and moving cover shots", async (t) => {
  browser(t);
  t.mock.method(console, "warn", () => {});
  const model = async (name) => ({ ...prop(name), animations: [] });
  const preview = createPrologueFlashbacks({
    characterLoader: () => model("Crew"),
    playerLoader: () => model("Brondon"),
    modelLoader: model,
    shipLoader: async () => prop("Mothership").scene,
    bossLoader: () => model("Warden"),
    monitorFactory: () => ({
      texture: new THREE.Texture(),
      ready: Promise.resolve(),
      update() {},
      dispose() {},
      getFrameIndex: () => 0,
    }),
  });
  t.after(() => preview.dispose());
  await preview.ready;
  const scene = preview.sceneFor("stealth");
  assert.ok(scene.getObjectByName("DeckOneHangarFloor"));
  assert.ok(scene.getObjectByName("HangarCargo-11-0"));
  assert.ok(scene.getObjectByName("DeckOnePatrolPassageFloor"));
  const scans = scene.children.filter(
    (node) => node.name === "StealthPreviewScanField",
  );
  assert.equal(scans.length, 3);
  const start = scans[0].position.clone(),
    camera = new THREE.PerspectiveCamera();
  preview.update("stealth", 1, 9, 0.1, camera);
  const wide = camera.position.clone();
  preview.update("stealth", 5, 9, 0.1, camera);
  assert.ok(start.distanceTo(scans[0].position) > 0.1);
  assert.ok(wide.distanceTo(camera.position) > 5);
});
