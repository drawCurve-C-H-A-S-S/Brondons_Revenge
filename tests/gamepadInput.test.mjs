import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { setMaxListeners } from "node:events";
import { createServer } from "vite";

let server,
  inputModule,
  THREE,
  createPlayer,
  createScenePhysics,
  createWeaponWheel;
let PistolController,
  CrowbarController,
  BloomstickController,
  createFinaleDirector,
  choreography;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "controller-test-deps",
        resolveId: (id) =>
          id === "virtual:controller-test-deps"
            ? "\0controller-test-deps"
            : null,
        load: (id) =>
          id === "\0controller-test-deps"
            ? "export * as THREE from 'three';"
            : null,
      },
    ],
  });
  ({ THREE } = await server.ssrLoadModule("virtual:controller-test-deps"));
  inputModule = await server.ssrLoadModule("/scripts/player/gamepadInput.ts");
  ({ createPlayer } = await server.ssrLoadModule("/scripts/player/player.ts"));
  ({ createScenePhysics } = await server.ssrLoadModule(
    "/helpers/physics/scenePhysics.ts",
  ));
  ({ createWeaponWheel } = await server.ssrLoadModule(
    "/scripts/weapons/weaponWheel.ts",
  ));
  ({ PistolController } = await server.ssrLoadModule(
    "/scripts/weapons/pistol.ts",
  ));
  ({ CrowbarController } = await server.ssrLoadModule(
    "/scripts/weapons/crowbar.ts",
  ));
  ({ BloomstickController } = await server.ssrLoadModule(
    "/scripts/weapons/bloomstick.ts",
  ));
  ({ createFinaleDirector } = await server.ssrLoadModule(
    "/scripts/global/finaleDirector.ts",
  ));
  choreography = await server.ssrLoadModule(
    "/scripts/global/finaleChoreography.ts",
  );
});
after(async () => server?.close());

function fixture(t, overrides = {}) {
  const names = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLCanvasElement",
    "Node",
    "KeyboardEvent",
    "MouseEvent",
    "PointerEvent",
  ];
  const original = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  class Element extends EventTarget {
    style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    dataset = {};
    children = [];
    selectors = new Map();
    classes = new Set();
    textContent = "";
    disabled = false;
    classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, value = !this.classes.has(name)) => {
        this.classList[value ? "add" : "remove"](name);
        return value;
      },
    };
    set className(value) {
      this.classes = new Set(value.split(/\s+/));
    }
    get className() {
      return [...this.classes].join(" ");
    }
    appendChild(node) {
      this.children.push(node);
      node.parentElement = this;
      return node;
    }
    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter(
          (node) => node !== this,
        );
    }
    closest() {
      return null;
    }
    setAttribute(name, value) {
      this[name] = String(value);
    }
    removeAttribute(name) {
      delete this[name];
    }
    querySelector(selector) {
      if (!this.selectors.has(selector))
        this.selectors.set(selector, new Element());
      return this.selectors.get(selector);
    }
    querySelectorAll() {
      return [];
    }
    getBoundingClientRect() {
      return { left: 450, top: 170, width: 380, height: 380 };
    }
    requestPointerLock() {
      throw new Error("Controller input must not request pointer lock");
    }
  }
  class KeyEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      Object.assign(this, {
        code: "",
        key: "",
        repeat: false,
        ...Object.fromEntries(
          Object.entries(options).filter(
            ([key]) => !["bubbles", "cancelable"].includes(key),
          ),
        ),
      });
    }
  }
  class MouseEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      Object.assign(this, {
        button: 0,
        clientX: 640,
        clientY: 360,
        movementX: 0,
        movementY: 0,
        ...Object.fromEntries(
          Object.entries(options).filter(
            ([key]) => !["bubbles", "cancelable"].includes(key),
          ),
        ),
      });
    }
  }
  const pad = {
    id: "NES-themed USB controller",
    index: 0,
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    ...overrides,
  };
  const elements = new Map(),
    window = Object.assign(new EventTarget(), {
      innerWidth: 1280,
      innerHeight: 720,
    });
  const document = Object.assign(new EventTarget(), {
    body: new Element(),
    hidden: false,
    pointerLockElement: null,
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    baseURI: "http://localhost:5173/",
  });
  const dispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = (event) => {
    const result = dispatch(event);
    if (event.bubbles && !event.cancelBubble) window.dispatchEvent(event);
    return result && !event.defaultPrevented;
  };
  const globals = {
    window,
    document,
    navigator: { getGamepads: () => [pad.connected ? pad : null] },
    HTMLElement: Element,
    HTMLCanvasElement: Element,
    Node: Element,
    KeyboardEvent: KeyEvent,
    MouseEvent,
    PointerEvent: MouseEvent,
  };
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  setMaxListeners(0, window, document);
  const cleanups = [],
    context = {
      id: "test-scene",
      kind: "foot",
      menuOpen: false,
      wheelOpen: false,
    };
  const status = [],
    notices = [],
    menu = [],
    keys = [],
    mouse = [];
  const titleOrbits = [];
  const teleportActions = [];
  let player,
    wheel,
    epoch = () => "";
  const input = inputModule.createGamepadInput({
    getContext: () => ({ ...context, id: `${context.id}:${epoch()}` }),
    onModeChange: () => player?.clearInput(),
    onStatus: (state) => status.push(state),
    onNotice: (text) => notices.push(text),
    onMenuAction: (action) => menu.push(action),
    onTitleOrbit: (x, y, delta) => titleOrbits.push({ x, y, delta }),
    onTeleportAction: (action, heldSeconds) =>
      teleportActions.push({ action, heldSeconds }),
    aimWheel: (x, y) => wheel?.aimFromStick(x, y),
    cancelWheel: () => wheel?.close(),
  });
  cleanups.push(() => input.dispose());
  for (const type of ["keydown", "keyup"])
    window.addEventListener(type, (event) => {
      if (inputModule.isControllerEvent(event))
        keys.push({ type, code: event.code, repeat: event.repeat });
    });
  for (const type of ["mousedown", "mouseup", "mousemove"])
    document.addEventListener(type, (event) => {
      if (inputModule.isControllerEvent(event))
        mouse.push({ type, x: event.movementX, y: event.movementY });
    });
  const f = {
    pad,
    window,
    document,
    context,
    input,
    status,
    notices,
    menu,
    keys,
    mouse,
    titleOrbits,
    teleportActions,
    cleanups,
    setEpoch: (getter) => {
      epoch = getter;
    },
    activate() {
      input.setControllerType("switch");
      assert.equal(input.setMode("controller"), true);
      input.update(1 / 60);
    },
    button(index, down) {
      pad.buttons[index].pressed = down;
      pad.buttons[index].value = down ? 1 : 0;
      input.update(1 / 60);
    },
    key(code) {
      window.dispatchEvent(new KeyEvent("keydown", { code, cancelable: true }));
    },
    attachPlayer() {
      const physics = createScenePhysics(),
        scene = new THREE.Scene(),
        camera = new THREE.PerspectiveCamera();
      const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 60));
      floor.position.y = -0.25;
      scene.add(floor);
      physics.addBoxFromMesh(floor);
      player = createPlayer({
        camera,
        physicsWorld: physics.world,
        spawnPosition: { x: 0, y: 0.3, z: 0 },
      });
      player.enable();
      Object.assign(f, { player, physics, scene, camera });
      for (let i = 0; i < 30; i++) physics.step(1 / 60, player);
      cleanups.push(() => {
        player.dispose();
        physics.dispose();
        floor.geometry.dispose();
        floor.material.dispose();
      });
    },
    attachWheel() {
      wheel = createWeaponWheel({
        getEntries: () =>
          ["unarmed", "pistol", "crowbar", "bloomstick"].map((id) => ({
            id,
            label: id,
          })),
        getCurrentId: () => "unarmed",
        isBlocked: () => false,
        onSelect: (id) => f.selections.push(id),
        setPaused(value) {
          context.wheelOpen = value;
          input.reset(value);
          player?.clearInput();
        },
      });
      f.selections = [];
      f.wheel = wheel;
      cleanups.push(() => wheel.dispose());
    },
  };
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return f;
}

test("USB detection automatically enables the detected controller and reports its layout", (t) => {
  const f = fixture(t);
  assert.equal(inputModule.isControllerActive(), true);
  assert.equal(f.input.getStatus().ready, true);
  assert.equal(f.input.getStatus().type, "switch");
  assert.equal(f.input.getStatus().name, f.pad.id);
  f.pad.axes[1] = -1;
  f.input.update(1 / 60);
  assert.equal(inputModule.getControllerMovement().y, -1);
});

test("the radial dead zone is exactly 18 percent with proportional and capped diagonal output", () => {
  assert.equal(inputModule.CONTROLLER_DEAD_ZONE, 0.18);
  assert.deepEqual(inputModule.controllerStick(0.18, 0), { x: 0, y: 0 });
  assert.ok(inputModule.controllerStick(0.1801, 0).x > 0);
  assert.ok(
    Math.abs(inputModule.controllerStick(0.5, 0).x - (0.5 - 0.18) / 0.82) <
      1e-12,
  );
  const diagonal = inputModule.controllerStick(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.equal(diagonal.x, diagonal.y);
});

test("Nintendo face buttons, shoulders, teleport, goggles and dance map to the requested actions", (t) => {
  const f = fixture(t);
  f.activate();
  const bindings = [
    [0, "Space"],
    [1, "KeyE"],
    [2, "KeyC"],
    [3, "Digit9"],
    [11, "KeyV"],
    [6, "ShiftLeft"],
    [4, "Tab"],
    [7, "KeyN"],
    [8, "Enter"],
    [12, "KeyT"],
    [14, "KeyR"],
  ];
  for (const [button, code] of bindings) {
    f.keys.length = 0;
    f.button(button, true);
    f.button(button, false);
    assert.deepEqual(
      f.keys.map((event) => [event.type, event.code]),
      [
        ["keydown", code],
        ["keyup", code],
      ],
    );
  }
  f.button(9, true);
  f.button(9, false);
  assert.deepEqual(f.menu, ["pause"]);
});

test("D-pad Down only places and D-pad Right always throws, with optional charging", (t) => {
  const f = fixture(t);
  f.activate();
  f.button(13, true);
  for (let i = 0; i < 90; i++) f.input.update(1 / 60);
  f.button(13, false);
  assert.deepEqual(f.teleportActions, [{ action: "place", heldSeconds: 0 }]);
  f.button(15, true);
  f.button(15, false);
  assert.equal(f.teleportActions.at(-1).action, "throw");
  assert.ok(f.teleportActions.at(-1).heldSeconds < 0.3);
  f.button(15, true);
  for (let i = 0; i < 60; i++) f.input.update(1 / 60);
  f.button(15, false);
  assert.ok(f.teleportActions.at(-1).heldSeconds >= 1);
  assert.equal(f.teleportActions.length, 3);
  assert.ok(f.keys.every((event) => !["KeyQ", "Digit9"].includes(event.code)));
});

test("menus, scene changes and focus loss cancel charged controller throws", (t) => {
  const f = fixture(t);
  f.activate();
  for (const interrupt of [
    () => { f.context.menuOpen = true; },
    () => { f.context.id = "next-room"; },
    () => f.window.dispatchEvent(new Event("blur")),
  ]) {
    f.button(15, true);
    interrupt();
    f.input.update(1 / 60);
    f.button(15, false);
    f.context.menuOpen = false;
    f.window.dispatchEvent(new Event("focus"));
    f.input.update(1 / 60);
  }
  assert.deepEqual(f.teleportActions, []);
});

test("held controls emit one press and one release, not keyboard repeat or auto-mash", (t) => {
  const f = fixture(t);
  f.activate();
  f.button(6, true);
  f.button(5, true);
  for (let i = 0; i < 120; i++) f.input.update(1 / 60);
  assert.equal(
    f.keys.filter(
      (event) => event.type === "keydown" && event.code === "ShiftLeft",
    ).length,
    1,
  );
  assert.equal(f.mouse.filter((event) => event.type === "mousedown").length, 1);
  assert.ok(f.keys.every((event) => !event.repeat));
  f.button(6, false);
  f.button(5, false);
  assert.equal(
    f.keys.filter(
      (event) => event.type === "keyup" && event.code === "ShiftLeft",
    ).length,
    1,
  );
  assert.equal(f.mouse.filter((event) => event.type === "mouseup").length, 1);
});

test("the real player moves proportionally, sprints, jumps and crouches without pointer lock", (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.activate();
  assert.equal(f.player.getState().isOnGround, true);
  f.pad.axes[1] = -0.5;
  f.input.update(1 / 60);
  f.physics.step(1 / 60, f.player);
  const half = Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z);
  f.pad.axes[1] = -1;
  f.input.update(1 / 60);
  f.physics.step(1 / 60, f.player);
  const full = Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z);
  assert.ok(full > half && half > 0);
  assert.ok(Math.abs(half / full - (0.5 - 0.18) / 0.82) < 0.02);
  f.button(6, true);
  f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().sprinting, true);
  assert.ok(
    Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z) > full,
  );
  f.button(6, false);
  f.pad.axes[1] = 0;
  f.input.update(1 / 60);
  f.button(2, true);
  assert.equal(f.player.getState().crouching, true);
  f.button(2, false);
  f.button(2, true);
  assert.equal(f.player.getState().crouching, false);
  f.button(2, false);
  f.button(0, true);
  f.physics.step(1 / 60, f.player);
  assert.ok(f.player.body.velocity.y > 1);
  f.button(0, false);
});

test("right-stick yaw is frame-rate independent and pitch stays clamped", (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.activate();
  const sample = (fps) => {
    f.pad.axes[2] = f.pad.axes[3] = 0;
    f.input.reset();
    f.player.setRotation(0, 0);
    f.input.update(1 / fps);
    f.pad.axes[2] = 0.75;
    for (let i = 0; i < fps; i++) f.input.update(1 / fps);
    return f.player.getState().yaw;
  };
  const at30 = sample(30),
    at60 = sample(60);
  assert.ok(at30 < 0);
  assert.ok(Math.abs(at30 - at60) < 1e-10);
  f.pad.axes[3] = 1;
  for (let i = 0; i < 300; i++) f.input.update(1 / 60);
  assert.ok(
    f.player.getState().pitch > -Math.PI / 2 &&
      f.player.getState().pitch < Math.PI / 2,
  );
});

test("physical gameplay keys restore keyboard input automatically without swallowing the key", (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.activate();
  f.key("KeyW");
  f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().isMoving, true);
  assert.equal(inputModule.isControllerActive(), false);
  f.key("KeyM");
  assert.equal(inputModule.isControllerActive(), false);
  f.input.setMode("keyboard");
  f.key("KeyW");
  f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().isMoving, true);
});

test("R drives the real pistol, crowbar and bloomstick document handlers without mouse capture", async (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.activate();
  let shots = 0;
  const character = new THREE.Group(),
    sword = new THREE.Group();
  sword.name = "bloomstick";
  character.add(sword);
  f.scene.add(character);
  const context = () => ({
    scene: f.scene,
    camera: f.camera,
    world: f.physics.world,
    player: f.player,
    character,
    attackClips: [new THREE.AnimationClip("Sword_Attack", 1, [])],
    thirdPerson: false,
    hasPistol: true,
    hasCrowbar: true,
    hasBloomstick: true,
    targets: [],
    setCharacterEquipped() {},
    weaponAnimation: null,
    doorTarget: null,
    openDoor() {},
    onShot() {
      shots++;
    },
  });
  const pistol = new PistolController(context, async () => ({
    scene: new THREE.Group(),
  }));
  const crowbar = new CrowbarController(context),
    bloomstick = new BloomstickController(context);
  f.cleanups.push(() => {
    pistol.dispose();
    crowbar.dispose();
    bloomstick.dispose();
  });
  await pistol.ready;
  pistol.equip();
  f.button(5, true);
  assert.equal(shots, 1);
  f.button(5, false);
  pistol.holster();
  crowbar.equip();
  f.button(5, true);
  assert.equal(f.player.getState().actionRequest, "Sword_Attack");
  f.button(5, false);
  crowbar.holster();
  f.player.clearInput();
  f.input.update(1 / 60);
  bloomstick.equip();
  f.button(5, true);
  assert.equal(f.player.getState().actionRequest, "Sword_Attack");
  f.button(5, false);
  assert.equal(f.document.pointerLockElement, null);
});

test("L opens the real weapon wheel, right stick selects, centering retains selection and release equips", (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.attachWheel();
  f.activate();
  const yaw = f.player.getState().yaw;
  f.button(4, true);
  assert.equal(f.wheel.isOpen(), true);
  f.pad.axes[2] = 1;
  f.input.update(1 / 60);
  assert.equal(f.player.getState().yaw, yaw);
  f.pad.axes[2] = 0;
  f.input.update(1 / 60);
  f.button(4, false);
  assert.equal(f.wheel.isOpen(), false);
  assert.deepEqual(f.selections, ["pistol"]);
});

test("B cancels weapon selection without reopening L and unplugging leaves no stuck inputs", (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.attachWheel();
  f.activate();
  f.button(4, true);
  f.pad.axes[2] = 1;
  f.input.update(1 / 60);
  f.button(0, true);
  assert.equal(f.wheel.isOpen(), false);
  assert.deepEqual(f.selections, []);
  f.input.update(1 / 60);
  assert.equal(
    f.wheel.isOpen(),
    false,
    "Held L must not reopen a cancelled wheel",
  );
  f.button(0, false);
  f.button(4, false);
  f.pad.axes[2] = 0;
  f.input.update(1 / 60);
  f.button(4, true);
  f.pad.axes[2] = 1;
  f.input.update(1 / 60);
  f.pad.connected = false;
  f.input.update(1 / 60);
  assert.equal(f.wheel.isOpen(), false);
  assert.deepEqual(f.selections, []);
  assert.equal(inputModule.isControllerActive(), false);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  assert.match(f.notices.at(-1), /disconnected.*Keyboard & mouse restored/);
  f.key("KeyW");
  f.physics.step(1 / 60, f.player);
  assert.equal(f.player.getState().isMoving, true);
});

test("blur stops input, then focus and scene changes resume held movement without retriggering an attack", (t) => {
  const f = fixture(t);
  f.activate();
  f.pad.axes[1] = -1;
  f.button(5, true);
  f.window.dispatchEvent(new Event("blur"));
  f.input.update(1 / 60);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  f.window.dispatchEvent(new Event("focus"));
  f.input.update(1 / 60);
  assert.ok(inputModule.getControllerMovement().y < 0);
  assert.equal(f.mouse.filter((event) => event.type === "mousedown").length, 1);
  f.button(5, false);
  f.button(5, true);
  assert.ok(inputModule.getControllerMovement().y < 0);
  assert.equal(f.mouse.filter((event) => event.type === "mousedown").length, 2);
  f.context.id = "next-scene";
  f.input.update(1 / 60);
  assert.ok(inputModule.getControllerMovement().y < 0);
});

test("controller menus use A to confirm, B to go back and repeatable directional navigation without gameplay", (t) => {
  const f = fixture(t);
  f.activate();
  f.context.menuOpen = true;
  f.input.update(1 / 60);
  f.button(1, true);
  for (let i = 0; i < 60; i++) f.input.update(1 / 60);
  f.button(1, false);
  f.button(0, true);
  f.button(0, false);
  f.button(13, true);
  for (let i = 0; i < 40; i++) f.input.update(1 / 60);
  f.button(13, false);
  assert.deepEqual(f.menu.slice(0, 2), ["confirm", "back"]);
  assert.ok(f.menu.filter((action) => action === "down").length >= 3);
  assert.equal(f.keys.length, 0);
});

test("directional QTEs accept left-stick and four-way d-pad inputs", (t) => {
  const f = fixture(t);
  f.context.kind = "finale-qte";
  f.activate();
  for (const [x, y, code] of [
    [0, -1, "KeyW"],
    [0, 1, "KeyS"],
    [-1, 0, "KeyA"],
    [1, 0, "KeyD"],
  ]) {
    f.pad.axes[0] = x;
    f.pad.axes[1] = y;
    f.input.update(1 / 60);
    assert.equal(
      f.keys.findLast((event) => event.type === "keydown").code,
      code,
    );
    assert.match(inputModule.controllerLabel(code, "finale-qte"), /Left stick/);
    f.pad.axes[0] = f.pad.axes[1] = 0;
    f.input.update(1 / 60);
  }
  for (const [button, code] of [
    [12, "KeyW"],
    [13, "KeyS"],
    [14, "KeyA"],
    [15, "KeyD"],
  ]) {
    f.button(button, true);
    assert.equal(
      f.keys.findLast((event) => event.type === "keydown").code,
      code,
    );
    f.button(button, false);
  }
});

test("menu stick jitter does not restart navigation and repeat timing has a distinct initial delay", (t) => {
  const f = fixture(t);
  f.activate();
  f.context.menuOpen = true;
  f.input.update(1 / 60);
  f.pad.axes[1] = 0.8;
  f.input.update(1 / 60);
  for (let frame = 0; frame < 18; frame++) {
    f.pad.axes[1] = frame % 2 ? 0.6 : 0.7;
    f.input.update(1 / 60);
  }
  assert.deepEqual(
    f.menu,
    ["down"],
    "Jitter across the entry threshold cannot cause extra steps",
  );
  for (let frame = 0; frame < 12; frame++) f.input.update(1 / 60);
  assert.equal(
    f.menu.length,
    3,
    "Initial delay is 350ms; subsequent steps are 120ms apart",
  );
  f.pad.axes[1] = 0;
  f.input.update(1 / 60);
  f.pad.axes[1] = 0.8;
  f.input.update(1 / 60);
  assert.equal(
    f.menu.length,
    4,
    "A fresh deliberate push responds immediately",
  );
});

test("inspection maps the D-pad to keypad arrows and closes with E, never Escape", (t) => {
  const f = fixture(t);
  f.context.kind = "inspection";
  f.activate();
  for (const [button, code] of [
    [12, "ArrowUp"],
    [13, "ArrowDown"],
    [14, "ArrowLeft"],
    [15, "ArrowRight"],
    [0, "KeyE"],
  ]) {
    f.button(button, true);
    assert.equal(
      f.keys.findLast((event) => event.type === "keydown").code,
      code,
    );
    f.button(button, false);
  }
  assert.ok(f.keys.every((event) => event.code !== "Escape"));
});

test("title menus forward right-stick dragging without moving the menu selection or firing", (t) => {
  const f = fixture(t);
  f.activate();
  f.context.menuOpen = true;
  f.pad.axes[2] = 0.8;
  f.pad.axes[3] = -0.65;
  f.input.update(1 / 60);
  const orbit = f.titleOrbits.at(-1);
  assert.ok(orbit.x > 0 && orbit.y < 0 && orbit.delta > 0);
  assert.equal(f.menu.length, 0);
  assert.equal(f.keys.length, 0);
  assert.equal(f.mouse.length, 0);
});

test("escape and final-boss mappings use the same displayed controller labels as their real key actions", (t) => {
  const f = fixture(t);
  f.activate();
  f.context.kind = "escape";
  f.input.update(1 / 60);
  for (const [button, code, label] of [
    [5, "KeyY", "R"],
    [3, "KeyU", "X"],
    [0, "KeyI", "B"],
    [2, "KeyO", "Y"],
    [1, "KeyE", "A"],
  ]) {
    f.button(button, true);
    assert.equal(f.keys.at(-1).code, code);
    f.button(button, false);
    assert.equal(inputModule.controllerLabel(code, "escape"), label);
  }
  f.context.kind = "finale";
  f.input.update(1 / 60);
  for (const [button, code, label] of [
    [5, "KeyJ", "R"],
    [3, "KeyF", "X"],
    [6, "KeyR", "ZL"],
    [0, "Space", "B"],
    [1, "KeyE", "A"],
  ]) {
    f.button(button, true);
    assert.equal(f.keys.at(-1).code, code);
    f.button(button, false);
    assert.equal(inputModule.controllerLabel(code, "finale"), label);
  }
});

test("controller combat taps and held guard cannot interrupt the continuous finisher", (t) => {
  const f = fixture(t),
    director = createFinaleDirector("finisher");
  director.assetsLoaded();
  f.context.kind = "finale";
  f.activate();
  const actions = {
    KeyJ: "slash",
    KeyF: "missiles",
    Space: "dash",
    KeyC: "slide",
    KeyE: "overdrive",
  };
  let attempted = 0;
  f.window.addEventListener("keydown", (event) => {
    if (!inputModule.isControllerEvent(event) || !actions[event.code]) return;
    attempted++;
    assert.equal(director.duel.act(actions[event.code]), false);
  });
  function advance(seconds) {
    for (let remaining = seconds; remaining > 1e-8;) {
      const dt = Math.min(1 / 60, remaining);
      f.input.update(dt);
      director.update(dt);
      remaining -= dt;
    }
  }
  f.button(6, true);
  for (const beat of choreography.FINISHER_BEATS) {
    assert.equal(director.getState().phase, "finisher", beat.id);
    for (const button of [1, 3, 0, 2, 5]) {
      f.button(button, true);
      f.button(button, false);
    }
    advance(choreography.finisherBeatDuration(beat));
    assert.equal(director.getState().failure, "", beat.id);
  }
  f.button(6, false);
  assert.equal(attempted, choreography.FINISHER_BEATS.length * 5);
  assert.equal(director.getState().phase, "victory");
  assert.equal(director.duel.getState().phase, "won");
  assert.equal("qte" in director, false);
});

test("calibration covers only game controls, including swapped buttons, trigger axes and a hat D-pad", (t) => {
  const neutral = [0, 0, 0, 0, -1, -1, 1.285714];
  const f = fixture(t, {
    mapping: "",
    axes: [...neutral],
    buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })),
  });
  f.input.setControllerType("switch");
  assert.equal(f.input.getStatus().ready, false);
  assert.equal(f.input.setMode("controller"), false);
  f.input.beginSetup();
  f.input.update(1 / 60);
  assert.equal(f.input.getStatus().setupStep, "1 / 19: Press B");
  const bindings = [
    { button: 3 },
    { button: 0 },
    { button: 1 },
    { button: 2 },
    { button: 5 },
    { button: 4 },
    { axis: 4, value: 1 },
    { axis: 5, value: 1 },
    { button: 6 },
    { button: 7 },
    { button: 8 },
    { axis: 6, value: -1 },
    { axis: 6, value: 0.142857 },
    { axis: 6, value: 0.714286 },
    { axis: 6, value: -0.428571 },
    { axis: 2, value: 1 },
    { axis: 3, value: 1 },
    { axis: 0, value: -1 },
    { axis: 1, value: -1 },
  ];
  for (const [index, binding] of bindings.entries()) {
    assert.ok(f.input.getStatus().setupStep.startsWith(`${index + 1} / 19:`));
    assert.doesNotMatch(
      f.input.getStatus().setupStep,
      /left stick click|Home|Capture|extra button/i,
    );
    if ("button" in binding) {
      f.pad.buttons[binding.button].pressed = true;
      f.pad.buttons[binding.button].value = 1;
    } else f.pad.axes[binding.axis] = binding.value;
    f.input.update(1 / 60);
    f.pad.buttons.forEach((button) => {
      button.pressed = false;
      button.value = 0;
    });
    f.pad.axes = [...neutral];
    f.input.update(1 / 60);
  }
  assert.equal(
    f.input.getStatus().setupStep,
    null,
    "Unused browser buttons must not add calibration steps",
  );
  assert.equal(f.input.getStatus().ready, true);
  f.activate();
  f.button(4, true);
  f.button(4, false);
  assert.equal(f.mouse.filter((event) => event.type === "mousedown").length, 1);
  f.button(8, true);
  f.button(8, false);
  assert.equal(f.keys.at(-1).code, "KeyV");
  f.pad.axes[2] = 0.5;
  f.input.update(1 / 60);
  assert.ok(inputModule.getControllerMovement().x > 0);
  f.pad.axes[6] = -1;
  f.input.update(1 / 60);
  assert.equal(f.keys.at(-1).code, "KeyT");
  f.pad.axes[6] = neutral[6];
  f.pad.axes[4] = 0.8;
  f.input.update(1 / 60);
  assert.equal(f.keys.at(-1).code, "ShiftLeft");
  f.pad.axes = [...neutral];
  f.input.update(1 / 60);
  f.input.beginSetup();
  f.input.update(1 / 60);
  f.button(2, true);
  f.button(2, false);
  f.input.cancelSetup();
  assert.equal(f.input.getStatus().ready, true);
  f.button(4, true);
  f.button(4, false);
  assert.equal(f.mouse.filter((event) => event.type === "mousedown").length, 2);
});

test("Escape cancels incomplete calibration and restores the previous controls", (t) => {
  const f = fixture(t);
  f.activate();
  f.input.beginSetup();
  f.input.update(1 / 60);
  f.button(1, true);
  f.button(1, false);
  assert.match(f.input.getStatus().setupStep, /^2 \/ 19:/);
  f.key("Escape");
  assert.equal(f.input.getStatus().setupStep, null);
  assert.equal(f.input.getStatus().ready, true);
  assert.match(f.notices.at(-1), /cancelled.*Previous controls kept/);
  f.button(0, true);
  assert.equal(f.keys.at(-1).code, "Space");
  f.button(0, false);
  f.button(1, true);
  assert.equal(f.keys.at(-1).code, "KeyE");
});

test("a one-second two-button hold cancels calibration without leaking menu actions", (t) => {
  const f = fixture(t);
  f.activate();
  f.context.menuOpen = true;
  f.input.beginSetup();
  f.input.update(1 / 60);
  for (const index of [0, 1])
    Object.assign(f.pad.buttons[index], { pressed: true, value: 1 });
  for (let i = 0; i < 19; i++) f.input.update(0.05);
  assert.notEqual(f.input.getStatus().setupStep, null);
  f.input.update(0.05);
  assert.equal(f.input.getStatus().setupStep, null);
  f.input.update(1 / 60);
  assert.deepEqual(f.menu, []);
  assert.equal(f.input.getStatus().ready, true);
});

test("releasing L immediately restores a continuously held left stick and ZL sprint without centering", (t) => {
  const f = fixture(t);
  f.attachPlayer();
  f.attachWheel();
  f.activate();
  f.pad.axes[0] = -1;
  f.button(6, true);
  f.physics.step(1 / 60, f.player);
  const before = Math.hypot(f.player.body.velocity.x, f.player.body.velocity.z);
  assert.ok(before > 0);
  assert.equal(f.player.getState().sprinting, true);
  f.button(4, true);
  assert.equal(f.wheel.isOpen(), true);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  f.pad.axes[2] = -1;
  f.input.update(1 / 60);
  f.button(4, false);
  assert.equal(f.wheel.isOpen(), false);
  assert.equal(
    inputModule.getControllerMovement().x,
    -1,
    "Movement is restored in the release frame",
  );
  assert.equal(
    f.player.getState().sprinting,
    true,
    "Held ZL is restored without another press",
  );
  f.physics.step(1 / 60, f.player);
  assert.ok(
    f.player.body.velocity.x < 0,
    "The actual player moves left without resetting either stick",
  );
  f.input.update(1 / 60);
  assert.equal(inputModule.getControllerMovement().x, -1);
});

test("menus freeze movement but closing them polls the still-held stick and ZL without neutral gating", (t) => {
  const f = fixture(t);
  f.activate();
  f.pad.axes[0] = -0.7;
  f.button(6, true);
  const held = inputModule.getControllerMovement().x;
  f.context.menuOpen = true;
  f.input.update(1 / 60);
  assert.deepEqual(inputModule.getControllerMovement(), { x: 0, y: 0 });
  f.context.menuOpen = false;
  f.input.update(1 / 60);
  assert.equal(inputModule.getControllerMovement().x, held);
  assert.equal(f.keys.at(-1).code, "ShiftLeft");
});

test("Nintendo button positions and an adapter-specific swap change gameplay and menu actions together", (t) => {
  const f = fixture(t);
  f.activate();
  f.button(1, true);
  f.button(1, false);
  assert.equal(f.keys.at(-1).code, "KeyE", "Physical A interacts");
  f.button(0, true);
  assert.equal(f.keys.at(-1).code, "Space");
  f.button(0, false);
  f.input.setSwapAB(true);
  assert.equal(f.input.getStatus().swapAB, true);
  f.button(1, true);
  assert.equal(f.keys.at(-1).code, "Space");
  f.button(1, false);
  f.button(0, true);
  f.button(0, false);
  assert.equal(f.keys.at(-1).code, "KeyE");
  f.button(5, true);
  f.button(5, false);
  assert.equal(f.mouse.filter((event) => event.type === "mousedown").length, 1);
  f.context.menuOpen = true;
  f.input.update(1 / 60);
  f.button(0, true);
  f.button(0, false);
  f.button(1, true);
  f.button(1, false);
  assert.deepEqual(f.menu, ["confirm", "back"]);
});

test("missing sticks are explicitly reported rather than pretending controller mode works", (t) => {
  const f = fixture(t, { axes: [], buttons: [{ pressed: false, value: 0 }] });
  f.input.setControllerType("switch");
  assert.equal(f.input.getStatus().ready, false);
  assert.equal(f.input.getStatus().canSetup, false);
  assert.equal(f.input.setMode("controller"), false);
  assert.match(f.notices.at(-1), /two sticks/);
  assert.equal(inputModule.isControllerActive(), false);
});
