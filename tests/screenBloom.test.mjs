import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let server, createScreenBloom;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createScreenBloom } = await server.ssrLoadModule(
    "/scripts/global/screenBloom.ts",
  ));
});
after(async () => server?.close());

function createBloom(t, initial = {}) {
  const storage = new Map(Object.entries(initial));
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  t.after(() => {
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
  const bloom = createScreenBloom({}, false);
  t.after(() => bloom.dispose());
  return { bloom, storage };
}

test("bloom defaults to off and skips rendering when no scene requests glow", (t) => {
  const { bloom } = createBloom(t);
  assert.equal(bloom.level, 0);
  assert.equal(bloom.mode, "off");
  assert.doesNotThrow(() => bloom.apply(null, null));
});

test("bloom ignores previous visits and notifies the display slider without saving settings", (t) => {
  const { bloom, storage } = createBloom(t, {
    bloomLevel: "0.35",
    bloomStyle: "bright",
  });
  assert.equal(bloom.level, 0);
  assert.equal(bloom.mode, "off");
  let notifications = 0;
  const unsubscribe = bloom.onChange(() => notifications++);
  bloom.setLevel(0.75);
  assert.equal(bloom.level, 0.75);
  assert.equal(storage.get("bloomLevel"), "0.35");
  assert.equal(storage.get("bloomStyle"), "bright");
  assert.equal(notifications, 1);
  unsubscribe();
  bloom.setLevel(0.5);
  assert.equal(notifications, 1);
});

test("bloom cycles off, bright and soft while remembering the previous strength", (t) => {
  const { bloom, storage } = createBloom(t);
  assert.equal(bloom.cycle(), "bright");
  assert.equal(bloom.level, 0.6);
  bloom.setLevel(0.8);
  assert.equal(bloom.cycle(), "soft");
  assert.equal(bloom.mode, "soft");
  assert.equal(bloom.cycle(), "off");
  assert.equal(storage.size, 0);
  assert.equal(bloom.cycle(), "bright");
  assert.equal(bloom.level, 0.8);
});

test("bloom ignores saved strength and clamps selected strength to the slider bounds", (t) => {
  const { bloom } = createBloom(t, { bloomLevel: "2" });
  assert.equal(bloom.level, 0);
  bloom.setLevel(-0.5);
  assert.equal(bloom.level, 0);
  bloom.setLevel(1.5);
  assert.equal(bloom.level, 1);
});

test("the redesigned display menu retains bloom alongside HUD and performance settings", async () => {
  const html = await readFile(
    new URL("../src/index.html", import.meta.url),
    "utf8",
  );
  const panel = html.match(
    /<section\s+id="pause-display-panel"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(panel);
  for (const id of [
    "bloom-level",
    "bloom-level-value",
    "interface-visibility-toggle",
    "fps-counter-toggle",
    "perf-timers-toggle",
  ]) {
    assert.ok(
      panel.includes(`id="${id}"`),
      `${id} remains available in Display`,
    );
  }
  assert.match(panel, /id="bloom-level"\s+type="range"\s+min="0"\s+max="100"/);
  assert.match(
    html,
    /id="pause-return-museum"[^>]*class="menu-button menu-tilt hidden"/,
  );
  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    main,
    /renderGameScene\(scene, camera\);[\s\S]*screenBloom\.apply\([\s\S]*currentSceneData\?\.getBloomPulse\?\.\(\) \?\? 0,[\s\S]*currentSceneData\?\.getBloomTargets\?\.\(\) \?\? \[\],[\s\S]*currentSceneData\?\.renderPostBloom\?\.\(renderer\);[\s\S]*renderMinimap\(\);/,
  );
  assert.match(
    main,
    /bloomSlider\.addEventListener\("input", \(\) =>\s+screenBloom\.setLevel\(bloomSlider\.valueAsNumber \/ 100\)/,
  );
  assert.match(main, /screenBloom\.onChange\(syncBloomSlider\)/);
  assert.match(
    main,
    /if \(screen === "display"\) \{[\s\S]*?syncBloomSlider\(\)/,
  );
  assert.match(
    main,
    /event\.code !== "Backslash"[\s\S]*?screenBloom\.cycle\(\)/,
  );
});
