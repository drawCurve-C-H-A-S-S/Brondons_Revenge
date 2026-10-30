import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let server, runPreloadTasks;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ runPreloadTasks } = await server.ssrLoadModule("/core/assetCache.ts"));
});
after(async () => server?.close());

test("startup caching includes every imported runtime GLB and excludes optional voices", async () => {
  const { GAME_ASSET_URLS } = await server.ssrLoadModule(
    "/core/gamePreload.ts",
  );
  const { MODEL_ASSET_URLS } = await server.ssrLoadModule("/core/loader.ts");
  const { DIALOGUE_VOICE_URLS } = await server.ssrLoadModule(
    "/helpers/audio/dialogueVoice.ts",
  );
  const { SFX_URLS } = await server.ssrLoadModule("/helpers/audio/sfx.ts");
  const { RECORDED_SOUND_URLS } = await server.ssrLoadModule(
    "/helpers/audio/recordedSounds.ts",
  );
  const models = MODEL_ASSET_URLS.map((source) => decodeURIComponent(source));
  for (const file of [
    "../src/core/loader.ts",
    "../src/scripts/global/mothership.ts",
    "../src/scenes/living quarters/bathroom.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const [, path] of source.matchAll(/from "([^"]+\.glb)"/g)) {
      const filename = path.split("/").at(-1);
      assert.ok(
        models.some((url) => url.endsWith(`/${filename}`)),
        `${filename} must be cached before gameplay`,
      );
    }
  }
  for (const source of MODEL_ASSET_URLS)
    assert.ok(GAME_ASSET_URLS.includes(source));
  for (const source of DIALOGUE_VOICE_URLS)
    assert.ok(!GAME_ASSET_URLS.includes(source), "Voices must load on demand");
  assert.ok(!GAME_ASSET_URLS.includes(SFX_URLS.brendan));
  for (const [name, source] of Object.entries(SFX_URLS))
    if (name !== "brendan") assert.ok(GAME_ASSET_URLS.includes(source));
  for (const source of RECORDED_SOUND_URLS)
    assert.ok(GAME_ASSET_URLS.includes(source));
});

test("every cached GLB decodes into a nonempty model", async (t) => {
  const saved = new Map(
    ["self", "createImageBitmap"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({
    width: 1,
    height: 1,
    close() {},
  });
  t.after(() => {
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  const { MODEL_ASSET_URLS } = await server.ssrLoadModule("/core/loader.ts");
  const loader = new GLTFLoader();
  for (const source of MODEL_ASSET_URLS.filter((url) => url.endsWith(".glb"))) {
    await t.test(decodeURIComponent(source).split("/").at(-1), async () => {
      const bytes = await readFile(new URL(`../src${source}`, import.meta.url));
      const model = await loader.parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      );
      let meshes = 0;
      model.scene.traverse((node) => {
        if (node.isMesh) {
          meshes++;
          assert.ok(node.geometry.getAttribute("position").count > 0);
          node.geometry.dispose();
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material]) {
            for (const value of Object.values(material))
              if (value?.isTexture) value.dispose();
            material.dispose();
          }
          if (node.isSkinnedMesh) node.skeleton.dispose();
        }
      });
      assert.ok(meshes > 0, "A loaded model must contain renderable geometry");
    });
  }
});

test("loading reports the active task before running it and only counts finished tasks", async () => {
  const reports = [];
  await runPreloadTasks(
    [
      {
        label: "Preparing footage",
        async run() {
          assert.deepEqual(reports.at(-1), {
            completed: 0,
            total: 2,
            label: "Preparing footage",
          });
        },
      },
      {
        label: "Preparing planet maps",
        async run() {
          assert.deepEqual(reports.at(-1), {
            completed: 1,
            total: 2,
            label: "Preparing planet maps",
          });
        },
      },
    ],
    (progress) => reports.push(progress),
  );
  assert.deepEqual(reports, [
    { completed: 0, total: 2, label: "Preparing footage" },
    { completed: 1, total: 2, label: "Preparing footage" },
    { completed: 1, total: 2, label: "Preparing planet maps" },
    { completed: 2, total: 2, label: "Preparing planet maps" },
  ]);
});

test("parallel preparations retain accurate completion counts", async () => {
  const reports = [],
    finish = [];
  const pending = runPreloadTasks(
    ["first", "second"].map((label) => ({
      label,
      run: () => new Promise((resolve) => finish.push(resolve)),
    })),
    (progress) => reports.push(progress),
    2,
  );
  assert.deepEqual(
    reports.map((progress) => progress.completed),
    [0, 0],
  );
  finish[1]();
  finish[0]();
  await pending;
  assert.deepEqual(
    reports.map((progress) => progress.completed),
    [0, 0, 1, 2],
  );
  assert.ok(reports.every((progress) => progress.total === 2));
});

test("failed preparations never count as completed or start later tasks", async () => {
  const failure = new Error("Footage preparation failed"),
    reports = [];
  await assert.rejects(
    runPreloadTasks(
      [
        {
          label: "Preparing footage",
          async run() {
            throw failure;
          },
        },
        {
          label: "Preparing planet maps",
          async run() {
            assert.fail("Later tasks must not start after a failure");
          },
        },
      ],
      (progress) => reports.push(progress),
    ),
    failure,
  );
  assert.deepEqual(reports, [
    { completed: 0, total: 2, label: "Preparing footage" },
  ]);
});
