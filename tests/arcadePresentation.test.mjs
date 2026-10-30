import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createServer } from "vite";

let server, createStatueDance, STATUE_DANCE_HITS, traceShot, preview;
before(async () => {
  const fixtures = {
    "preview-three": `
      export * from "three";
      export class WebGLRenderer {
        domElement = { remove() {} };
        scenes = [];
        setSize(width, height) { this.width = width; this.height = height; }
        setPixelRatio() {}
        getDrawingBufferSize(size) { return size.set(this.width, this.height); }
        setRenderTarget() {}
        clear() {}
        render(scene) { this.scenes.push(scene); }
        dispose() {}
      }
    `,
    "preview-starfield": `
      export function createStarfield() {
        return { starLayers: [], nebulaCubes: [], update() {}, dispose() {} };
      }
    `,
    "preview-loader": `
      import * as THREE from "three";
      async function load() {
        return { scene: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()) };
      }
      export const loadPlayerModel = load, loadBrendanModel = load, loadPlayableCharacterModel = load;
      export function setPlayerCellShadingEnabled() {}
    `,
  };
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "preview-render-fixtures",
        enforce: "pre",
        resolveId(id, importer) {
          if (id === "virtual:preview-three") return "\0preview-three";
          if (importer?.endsWith("characterPreview.ts")) {
            if (id === "./starfield.js") return "\0preview-starfield";
            if (id === "../../core/loader.js") return "\0preview-loader";
          }
        },
        load(id) {
          return fixtures[id.slice(1)];
        },
        transform(code, id) {
          if (id.endsWith("characterPreview.ts"))
            return code.replace('from "three"', 'from "virtual:preview-three"');
        },
      },
    ],
  });
  ({ createStatueDance, STATUE_DANCE_HITS } = await server.ssrLoadModule(
    "/scripts/museum/stoneStatue.ts",
  ));
  ({ traceShot } = await server.ssrLoadModule("/scripts/weapons/pistol.ts"));
  preview = await server.ssrLoadModule("/scripts/global/characterPreview.ts");
});
after(async () => server?.close());

test("all Arcade gradients match portrait/backdrop and Story retains the original palette", async (t) => {
  const globals = [
    "window",
    "document",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const saved = Object.fromEntries(
    globals.map((key) => [key, globalThis[key]]),
  );
  globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  globalThis.document = { getElementById: () => null };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  t.mock.method(console, "log", () => {});
  t.after(() => {
    preview.stopCharacterPreview();
    Object.assign(globalThis, saved);
  });
  const { PLAYABLE_CHARACTERS } = await server.ssrLoadModule("/core/loader.ts");
  const palettes = new Set();
  for (const character of [...PLAYABLE_CHARACTERS, undefined]) {
    const container = {
      id: "pause-character-preview",
      clientWidth: 1280,
      clientHeight: 720,
      classList: { add() {} },
      appendChild() {},
    };
    const source = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    preview.startCharacterPreview(container, character, source);
    await Promise.resolve();
    const renderer = preview.getCharacterPreviewRenderer();
    const backdrop = renderer.scenes[1].children[0].material;
    let portrait;
    renderer.scenes[2].traverse((node) => {
      if (node instanceof THREE.Mesh && node.material.isShaderMaterial)
        portrait = node.material;
    });
    assert.ok(portrait, `${character ?? "Story"} portrait loaded`);
    const colors = ["uGradientBottom", "uGradientMiddle", "uGradientTop"].map(
      (key) => {
        assert.equal(portrait.uniforms[key], backdrop.uniforms[key]);
        return portrait.uniforms[key].value.getHex(THREE.LinearSRGBColorSpace);
      },
    );
    assert.match(portrait.fragmentShader, /previewGradient\(gradT\)/);
    assert.match(backdrop.fragmentShader, /previewGradient\(vUv.y\)/);
    assert.equal(backdrop.uniforms.uGradient.value, true);
    if (character) palettes.add(colors.join(","));
    if (!character || character === "brondon")
      assert.deepEqual(colors, [0x0b0e33, 0x774b22, 0xff991a]);
    preview.stopCharacterPreview();
    source.geometry.dispose();
    source.material.dispose();
  }
  assert.equal(palettes.size, PLAYABLE_CHARACTERS.length);
});

for (const fps of [30, 60, 144]) {
  test(`statue requires 10 direct pistol hits, dances once and can retrigger at ${fps} FPS`, (t) => {
    const scene = new THREE.Scene(),
      model = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshBasicMaterial(),
    );
    body.name = "StatueBody";
    body.position.set(0, 1, -3);
    model.add(body);
    scene.add(model);
    const clips = [
      new THREE.AnimationClip("Idle_Loop", 1, [
        new THREE.NumberKeyframeTrack(
          "StatueBody.rotation[z]",
          [0, 1],
          [0.1, 0.1],
        ),
      ]),
      new THREE.AnimationClip("Dance_Loop", 2, [
        new THREE.NumberKeyframeTrack(
          "StatueBody.rotation[z]",
          [0, 1, 2],
          [0.1, 0.7, 0.1],
        ),
      ]),
    ];
    const statue = createStatueDance(model, clips);
    t.after(() => {
      statue.dispose();
      body.geometry.dispose();
      body.material.dispose();
    });
    const ray = new THREE.Ray(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, -1),
    );
    const shoot = () =>
      traceShot(scene, null, ray, [statue.target]).target?.damage(25, "pistol");
    const idle = body.rotation.z;
    assert.equal(STATUE_DANCE_HITS, 10);
    for (const weapon of [
      "crowbar",
      "bloomstick",
      "unarmed",
      "tackle",
      undefined,
    ])
      assert.equal(statue.target.damage(100, weapon), false);
    for (const amount of [0, -1, NaN, Infinity])
      assert.equal(statue.target.damage(amount, "pistol"), false);
    const miss = new THREE.Ray(new THREE.Vector3(3, 1, 0), ray.direction);
    assert.equal(
      traceShot(scene, null, miss, [statue.target]).target,
      undefined,
    );
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 0.2),
      new THREE.MeshBasicMaterial(),
    );
    wall.position.set(0, 1, -1);
    scene.add(wall);
    assert.equal(
      traceShot(scene, null, ray, [statue.target]).target,
      undefined,
    );
    wall.removeFromParent();
    wall.geometry.dispose();
    wall.material.dispose();
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let hit = 0; hit < 9; hit++) assert.equal(shoot(), true);
      statue.update(0.5);
      assert.equal(body.rotation.z, idle, "Nine hits never start the dance");
      assert.equal(shoot(), true);
      statue.update(0.5);
      assert.ok(
        body.rotation.z > idle + 0.1,
        "Tenth hit animates the actual model",
      );
      const paused = body.rotation.z;
      statue.update(0);
      assert.equal(
        statue.target.damage(25, "pistol"),
        false,
        "Dance hits do not accumulate",
      );
      assert.equal(
        body.rotation.z,
        paused,
        "Pose holds without game-time updates",
      );
      for (let frame = 0; frame < fps * 2; frame++) statue.update(1 / fps);
      assert.equal(
        body.rotation.z,
        idle,
        "One dance returns to the original statue pose",
      );
    }
    statue.dispose();
    const disposedPose = body.rotation.z;
    assert.equal(statue.target.damage(25, "pistol"), false);
    statue.update(1);
    assert.equal(body.rotation.z, disposedPose);
  });
}

test("Brondon's real asset supplies the statue's idle and dance clips", async () => {
  const bytes = await readFile(
    new URL("../src/assets/models/Brondon.glb", import.meta.url),
  );
  const asset = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  for (const name of ["Idle_Loop", "Dance_Loop"]) {
    const clip = asset.animations.find((animation) => animation.name === name);
    assert.ok(clip?.channels.length > 0, `${name} animates Brondon's rig`);
  }
  assert.throws(
    () => createStatueDance(new THREE.Group(), []),
    /requires Idle_Loop and Dance_Loop/,
  );
});

test("Museum entry grants a pistol while Story's opening still requires recovery", async () => {
  const source = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const entry = source.slice(
    source.indexOf("function enterManagedScene("),
    source.indexOf("function retireTraversalRoom("),
  );
  assert.match(entry, /id === "museum" \|\|[\s\S]*?hasPistol = true/);
  assert.match(
    entry,
    /id === "stage1-storage" && !sceneData\.requiresRecoveredPistol/,
  );
  const reset = source.slice(
    source.indexOf("function resetStoryProgress("),
    source.indexOf("// --- Main Menu"),
  );
  assert.match(reset, /hasPistol =[\s\S]*?false/);
});
