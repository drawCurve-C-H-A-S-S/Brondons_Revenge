import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

let server, input, prompts, reference, timing;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  input = await server.ssrLoadModule("/scripts/player/gamepadInput.ts");
  prompts = await server.ssrLoadModule("/scripts/global/inputPrompts.ts");
  reference = await server.ssrLoadModule(
    "/scripts/player/controlsReference.ts",
  );
  timing = await server.ssrLoadModule("/scripts/global/popupTiming.ts");
});
after(async () => server?.close());

function gamepad(id, index = 0, overrides = {}) {
  return {
    id,
    index,
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    ...overrides,
  };
}

function fixture(t, pads = []) {
  class KeyEvent extends Event {
    constructor(type, options = {}) {
      super(type, { bubbles: true, cancelable: true });
      this.code = options.code ?? "";
      this.repeat = options.repeat ?? false;
    }
  }
  class MouseEvent extends Event {
    constructor(type, options = {}) {
      super(type, { bubbles: true, cancelable: true });
      for (const [name, value] of Object.entries(options))
        if (!["bubbles", "cancelable"].includes(name)) this[name] = value;
      this.movementX ??= 0;
      this.movementY ??= 0;
    }
  }
  class Element extends EventTarget {
    constructor(tag = "div") {
      super();
      this.tag = tag;
    }
    dataset = {};
    children = [];
    attributes = {};
    nodeType = 1;
    classes = new Set();
    classList = {
      contains: (name) => this.classes.has(name),
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => {
        const enabled = force ?? !this.classes.has(name);
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      },
    };
    set className(value) {
      this.classes = new Set(value.split(/\s+/));
    }
    get className() {
      return [...this.classes].join(" ");
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    appendChild(node) {
      node.parentElement = this;
      this.children.push(node);
      return node;
    }
    append(...nodes) {
      nodes.forEach((node) => this.appendChild(node));
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.tag === selector) return child;
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    }
    get textContent() {
      return this.children
        .map((node) => node.data ?? node.textContent)
        .join("");
    }
    set textContent(value) {
      this.children = [{ nodeType: 3, data: value, parentElement: this }];
    }
    closest(selector) {
      if (
        selector.includes("[data-input-hint]") &&
        this.dataset.inputHint !== undefined
      )
        return this;
      if (selector === "[data-input-context]" && this.dataset.inputContext)
        return this;
      if (
        selector.includes("#pause-controls-panel") ||
        selector.includes("#info")
      )
        return null;
      return this.parentElement?.closest(selector) ?? null;
    }
  }
  const window = new EventTarget();
  const body = new Element();
  const document = Object.assign(new EventTarget(), {
    body,
    hidden: false,
    createElement: (tag) => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
    createTextNode: (data) => ({
      nodeType: 3,
      data,
      replaceWith(...nodes) {
        const parent = this.parentElement;
        const index = parent.children.indexOf(this);
        nodes.forEach((node) => { node.parentElement = parent; });
        parent.children.splice(index, 1, ...nodes);
      },
    }),
    createTreeWalker(node) {
      const text = [];
      const visit = (current) => {
        if (current.nodeType === 3) text.push(current);
        else current.children?.forEach(visit);
      };
      visit(node);
      let index = 0;
      return { nextNode: () => text[index++] ?? null };
    },
  });
  const dispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = (event) => {
    dispatch(event);
    if (event.bubbles) window.dispatchEvent(event);
    return !event.defaultPrevented;
  };
  const globals = {
    window,
    document,
    navigator: { getGamepads: () => pads.filter((pad) => pad.connected) },
    KeyboardEvent: KeyEvent,
    MouseEvent,
    PointerEvent: MouseEvent,
    HTMLElement: Element,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
  const originals = Object.entries(globals).map(([name, value]) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
    return [name, original];
  });
  const status = [],
    keys = [];
  window.addEventListener("keydown", (event) => {
    if (input.isControllerEvent(event)) keys.push(event.code);
  });
  const controller = input.createGamepadInput({
    getContext: () => ({
      id: "test",
      kind: "foot",
      menuOpen: false,
      wheelOpen: false,
    }),
    onModeChange() {},
    onStatus: (state) => status.push(state),
    onNotice() {},
    onMenuAction() {},
    aimWheel() {},
    cancelWheel() {},
  });
  const observers = [];
  t.after(() => {
    observers.forEach((observer) => observer.dispose());
    controller.dispose();
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  });
  return {
    pads,
    controller,
    status,
    keys,
    window,
    document,
    update: () => controller.update(1 / 60),
    key: (code) => window.dispatchEvent(new KeyEvent("keydown", { code })),
    mouse: (x, y) =>
      window.dispatchEvent(
        new MouseEvent("mousemove", { movementX: x, movementY: y }),
      ),
    button(pad, index, pressed) {
      Object.assign(pad.buttons[index], { pressed, value: pressed ? 1 : 0 });
      controller.update(1 / 60);
    },
    hint(source, context = "foot", dialogue = false) {
      const element = new Element();
      body.children.push(element);
      element.parentElement = body;
      prompts.setInputHint(element, source, context, dialogue);
      return element;
    },
    observe() {
      const observer = prompts.createInputPromptObserver(body);
      observers.push(observer);
      return observer;
    },
  };
}

test("detected devices have Xbox, PlayStation, Switch and honest generic button labels", (t) => {
  const f = fixture(t);
  for (const [id, type, expected] of [
    ["Xbox Wireless Controller (045e)", "xbox", "B"],
    ["Sony DualSense Wireless Controller", "playstation", "Circle"],
    ["Nintendo Switch Pro Controller", "switch", "A"],
    ["USB Gamepad 1234:5678", "generic", "Button 2"],
  ]) {
    f.pads.splice(0, f.pads.length, gamepad(id));
    f.update();
    assert.equal(f.controller.getStatus().type, type);
    assert.equal(
      input.inputHint("Press E to interact"),
      `Press ${expected} to interact`,
    );
  }
});

test("dialogue changes explicit inputs, never articles, pronouns or ordinary names", (t) => {
  fixture(t, [gamepad("Nintendo Switch Pro Controller")]);
  assert.equal(
    input.inputDialogue(
      "I found A student. Press E / Open. Hold Tab to choose; use it with Q.",
    ),
    "I found A student. Press A / Open. Hold L to choose; use it with D-pad Down.",
  );
  assert.equal(
    input.inputDialogue("Press [E] to open; tap Space or E to continue."),
    "Press A to open; tap B or A to continue.",
  );
  assert.equal(input.inputHint("LEFT", "foot"), "LEFT");
});

test("contextual flight, inspection, escape and finale hints match dispatched actions", (t) => {
  fixture(t, [gamepad("Sony DualSense")]);
  assert.equal(input.inputHint("Enter shield", "flight"), "Circle shield");
  assert.equal(input.inputHint("Click / Esc", "inspection"), "Cross / Circle");
  assert.equal(
    input.inputHint("Y / U / I / O / E", "escape"),
    "R1 / Triangle / Cross / Square / Circle",
  );
  assert.equal(
    input.inputHint("J / F / R / Space", "finale"),
    "R1 / Triangle / L2 / Cross",
  );
  assert.equal(
    input.inputHint("SPACE · SHIFT · left mouse button"),
    "Cross · L2 · R1",
  );
});

test("camera, dance, and separate teleport prompts match the controller layout", (t) => {
  const f = fixture(t, [gamepad("Xbox Controller")]);
  assert.equal(input.inputHint("V / 9 / E / Left click"), "RS / Y / B / RB");
  assert.equal(input.controllerText("{r3}"), "RS");
  assert.equal(
    input.inputHint("Tap Q / hold and release Q / T"),
    "Tap D-pad Down / hold and release D-pad Right / D-pad Up",
  );
  assert.equal(
    input.inputDialogue("Hold Q to throw; tap Q to place."),
    "Hold D-pad Right to throw; tap D-pad Down to place.",
  );
  const device = reference.getControlsReference(
    f.controller.getStatus().controllers,
  )[1];
  const rows = device.groups.flatMap((group) => group.rows);
  assert.equal(rows.find((row) => row.action === "Dance").binding, "Y");
  assert.equal(
    rows.find((row) => row.action === "Place teleport crystal").binding,
    "D-pad Down",
  );
  assert.match(
    rows.find((row) => row.action === "Throw teleport crystal").binding,
    /D-pad Right/,
  );
  f.key("KeyW");
  assert.equal(input.inputHint("Tap Q / hold and release Q"), "Tap Q / hold and release Q");
});

test("controller settings use a labelled dropdown and explain every calibration exit", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const select = html.match(/<select id="controller-type-select"[\s\S]*?<\/select>/)?.[0];
  assert.ok(select);
  assert.match(select, /aria-label="Controller type"/);
  for (const type of ["switch", "xbox", "playstation", "generic"])
    assert.ok(select.includes(`value="${type}"`));
  assert.doesNotMatch(html, /data-controller-type=/);
  assert.match(html, /aria-keyshortcuts="Escape"/);
  assert.match(html, /hold any two\s+controller buttons together for one second/);
});

test("keyboard/mouse switch immediately; idle sticks do not steal active input", (t) => {
  const pad = gamepad("Xbox Controller");
  const f = fixture(t, [pad]);
  f.update();
  f.mouse(0.5, 0.5);
  assert.equal(input.isControllerActive(), true);
  f.key("KeyW");
  assert.equal(input.isControllerActive(), false);
  f.update();
  assert.equal(input.isControllerActive(), false);
  f.button(pad, 1, true);
  assert.equal(input.isControllerActive(), true);
  assert.ok(
    f.keys.includes("KeyE"),
    "the first controller press must not be lost",
  );
  f.button(pad, 1, false);
  f.mouse(8, 0);
  assert.equal(input.isControllerActive(), false);
});

test("hotplug inventory includes every controller and most recently used pad wins", (t) => {
  const xbox = gamepad("Xbox Controller", 0),
    ps = gamepad("Sony DualSense", 2);
  const f = fixture(t, [xbox]);
  f.update();
  f.pads.push(ps);
  f.update();
  assert.deepEqual(
    f.controller.getStatus().controllers.map((pad) => pad.type),
    ["xbox", "playstation"],
  );
  f.button(ps, 1, true);
  assert.equal(f.controller.getStatus().index, 2);
  assert.equal(input.inputHint("Press E"), "Press Circle");
  ps.connected = false;
  f.window.dispatchEvent(new Event("gamepaddisconnected"));
  assert.equal(f.controller.getStatus().controllers.length, 1);
  assert.equal(input.inputHint("Press E"), "Press B");
  xbox.connected = false;
  f.update();
  assert.equal(input.isControllerActive(), false);
  assert.equal(f.controller.getStatus().type, null);
  assert.deepEqual(f.controller.getStatus().controllers, []);
});

test("complete controls reference is per-device, progression-independent and hotplug-aware", (t) => {
  const f = fixture(t, [
    gamepad("Xbox Controller"),
    gamepad("Sony DualSense", 1),
  ]);
  let devices = reference.getControlsReference(
    f.controller.getStatus().controllers,
  );
  assert.equal(devices.length, 3);
  const interact = (device) =>
    device.groups.find((group) => group.id === "interaction").rows[0].binding;
  assert.equal(interact(devices[0]), "E");
  assert.equal(interact(devices[1]), "B");
  assert.equal(interact(devices[2]), "Circle");
  assert.equal(devices[0].controllerType, null);
  assert.equal(devices[1].controllerType, "xbox");
  assert.equal(devices[2].controllerType, "playstation");
  assert.equal(
    devices[1].groups.find((group) => group.id === "interaction").rows[0]
      .controllerBinding,
    "{a}",
  );
  for (const device of devices) {
    assert.equal(device.groups.length, 8);
    assert.ok(device.groups.flatMap((group) => group.rows).length >= 45);
    assert.ok(device.groups.some((group) => group.id === "finale"));
    assert.ok(device.groups.some((group) => group.id === "ship-map"));
  }
  f.pads[1].connected = false;
  f.update();
  devices = reference.getControlsReference(
    f.controller.getStatus().controllers,
  );
  assert.deepEqual(
    devices.map((device) => device.id),
    ["keyboard", "controller-0"],
  );
});

test("face-button swaps affect prompts and references independently for identical pads", (t) => {
  const f = fixture(t, [
    gamepad("Xbox Controller"),
    gamepad("Xbox Controller", 1),
  ]);
  f.controller.setSwapAB(true);
  assert.equal(input.inputHint("Space / Left click"), "B / RB");
  assert.equal(input.controllerMenuLabel("confirm"), "B");
  const devices = reference.getControlsReference(
    f.controller.getStatus().controllers,
  );
  const attack = (device) =>
    device.groups[1].rows.find((row) => row.action.startsWith("Attack"))
      .binding;
  assert.equal(attack(devices[1]), "RB");
  assert.equal(attack(devices[2]), "RB");
  assert.equal(devices[1].groups[1].rows[0].binding, "A");
  assert.equal(devices[2].groups[1].rows[0].binding, "B");
});

test("visible dialogue restores original keyboard text and refreshes without restarting its timer", (t) => {
  const f = fixture(t, [gamepad("Nintendo Switch Pro Controller")]);
  const element = f.hint(
    "Prime: I found A door. Press E to open it.",
    "foot",
    true,
  );
  const observer = f.observe();
  assert.match(element.textContent, /Press A to open/);
  f.key("KeyW");
  assert.equal(element.textContent, "I found A door. Press E to open it.");
  assert.equal(element.dataset.dialogueSpeaker, "PRIME");
  f.controller.setControllerType("playstation");
  f.controller.setMode("controller");
  assert.match(element.textContent, /Press Circle to open/);
  for (let i = 0; i < 3; i++) observer.refresh();
  assert.match(element.textContent, /Press Circle to open/);
  assert.equal(
    element.dataset.inputHint,
    "Prime: I found A door. Press E to open it.",
  );
});

test("Prime's speaker styling cannot create a dialogue mutation loop", (t) => {
  const f = fixture(t, [gamepad("Nintendo Switch Pro Controller")]);
  const element = f.hint("Prime: Press E to interact.", "foot", true);
  element.classList.add("prime-tagged");
  f.observe();
  assert.equal(element.textContent, "Press A to interact.");
  assert.equal(element.dataset.primeLine, element.textContent);
  f.key("KeyW");
  assert.equal(element.textContent, "Press E to interact.");
  prompts.setInputHint(element, "No marker placed.", "foot", true);
  assert.equal(element.classList.contains("prime-tagged"), false);
});

test("another HUD owner can replace a retained prompt without old text returning", (t) => {
  const f = fixture(t, [gamepad("Nintendo Switch Pro Controller")]);
  const element = f.hint("Marker placed. Press T to teleport.", "foot", true);
  const observer = f.observe();
  element.textContent = input.inputHint("E / Open chest");
  observer.refresh();
  assert.equal(element.textContent, "A / Open chest");
  assert.equal(element.dataset.inputHint, undefined);
  f.key("KeyW");
  assert.equal(element.textContent, "R / Open chest");
  prompts.setInputHint(element, "Press E to open the door.", "foot", true);
  f.controller.setMode("controller");
  assert.equal(element.textContent, "Press R to open the door.");
});

test("popup reading time increases by exactly one second for defaults and explicit durations", async () => {
  assert.equal(timing.POPUP_EXTRA_SECONDS, 1);
  for (const base of [0, 1.8, 2.5, 3, 4, 5, 6, 8, 12])
    assert.equal(timing.popupDuration(base), base + 1);
  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(main, /controlTime = 12/);
  assert.match(main, /controllerNoticeTime = popupDuration\(5\)/);
  assert.match(main, /popupDuration\(3\) \* 1000/);
  assert.doesNotMatch(
    main.slice(
      main.indexOf("function renderControlsReference"),
      main.indexOf("function renderControllerStatus"),
    ),
    /seenControls|owned\.has|developerUnlocked|CONTROLLER_LESSONS/,
  );
});
