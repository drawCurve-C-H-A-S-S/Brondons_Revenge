import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createServer } from "vite";

let server, comic;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  comic = await server.ssrLoadModule("/core/comicShading.ts");
});
after(async () => server?.close());

function compile(material) {
  const shader = {
    uniforms: {},
    vertexShader: "#include <project_vertex>",
    fragmentShader:
      "#include <clipping_planes_fragment>\n#include <opaque_fragment>",
  };
  material.onBeforeCompile(shader);
  return shader;
}

test("outlines and comic lighting have independent uniforms and frame gating", () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  scene.add(mesh);
  comic.prepareEnvironmentComicShading(scene);
  const environment = compile(mesh.material);
  const ink = mesh.getObjectByName("CabinComicInk");
  assert.ok(ink);
  const outline = compile(ink.material);
  const lightingVersion = mesh.material.version;
  const inkVersion = ink.material.version;
  assert.match(environment.fragmentShader, /if \(uComicEnabled > 0\.5\)/);
  assert.match(outline.fragmentShader, /if \(uInkEnabled < 0\.5\) discard/);
  assert.notStrictEqual(
    environment.uniforms.uComicEnabled,
    outline.uniforms.uInkEnabled,
  );

  comic.setComicLookEnabled(false);
  comic.setOutlinesEnabled(true);
  comic.setComicFrameEnabled(true);
  assert.equal(environment.uniforms.uComicEnabled.value, 0);
  assert.equal(outline.uniforms.uInkEnabled.value, 1);

  comic.setComicLookEnabled(true);
  comic.setOutlinesEnabled(false);
  assert.equal(environment.uniforms.uComicEnabled.value, 1);
  assert.equal(outline.uniforms.uInkEnabled.value, 0);

  comic.setOutlinesEnabled(true);
  comic.withoutComicLook(() => {
    assert.equal(environment.uniforms.uComicEnabled.value, 0);
    assert.equal(outline.uniforms.uInkEnabled.value, 0);
  });
  assert.equal(environment.uniforms.uComicEnabled.value, 1);
  assert.equal(outline.uniforms.uInkEnabled.value, 1);

  const renderError = new Error("Camera feed failed");
  assert.throws(
    () =>
      comic.withoutComicLook(() => {
        comic.withoutComicLook(() => {
          assert.equal(environment.uniforms.uComicEnabled.value, 0);
          assert.equal(outline.uniforms.uInkEnabled.value, 0);
        });
        assert.equal(environment.uniforms.uComicEnabled.value, 0);
        assert.equal(outline.uniforms.uInkEnabled.value, 0);
        throw renderError;
      }),
    renderError,
  );
  assert.equal(environment.uniforms.uComicEnabled.value, 1);
  assert.equal(outline.uniforms.uInkEnabled.value, 1);
  comic.setComicFrameEnabled(false);
  assert.equal(environment.uniforms.uComicEnabled.value, 0);
  assert.equal(outline.uniforms.uInkEnabled.value, 0);
  assert.equal(comic.getComicLookEnabled(), true);
  assert.equal(comic.getOutlinesEnabled(), true);
  assert.equal(mesh.material.version, lightingVersion);
  assert.equal(ink.material.version, inkVersion);
  comic.setComicLookEnabled(false);
  comic.setOutlinesEnabled(false);
  ink.geometry.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test("Display offers a persisted outline preference separate from Comic Look", async () => {
  const html = await readFile(
    new URL("../src/index.html", import.meta.url),
    "utf8",
  );
  const display = html.match(
    /<section\s+id="pause-display-panel"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(display);
  assert.match(display, /id="comic-look-toggle"/);
  assert.match(display, /id="outlines-toggle"/);
  const main = await readFile(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(main, /localStorage\.getItem\("outlinesEnabled"\)/);
  assert.match(main, /localStorage\.setItem\("outlinesEnabled"/);
  assert.match(
    main,
    /localStorage\.setItem\("outlinesEnabled", String\(getOutlinesEnabled\(\)\)\)/,
  );
  assert.match(main, /setComicFrameEnabled\(!minigame\)/);
});

test("character outlines also use the independent ink uniform", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  root.add(mesh);
  comic.addCharacterInk(root);
  const ink = mesh.getObjectByName("BrondonComicInk");
  assert.ok(ink);
  const shader = compile(ink.material);
  comic.setOutlinesEnabled(true);
  comic.setComicFrameEnabled(true);
  assert.equal(shader.uniforms.uInkEnabled.value, 1);
  assert.match(shader.fragmentShader, /if \(uInkEnabled < 0\.5\) discard/);
  comic.setComicFrameEnabled(false);
  comic.setOutlinesEnabled(false);
  ink.material.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});
