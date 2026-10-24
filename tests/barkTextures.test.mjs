import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import * as THREE from "three";

let server, textures, foliage;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  textures = await server.ssrLoadModule("/scripts/level-3/jungleTextures.ts");
  foliage = await server.ssrLoadModule("/scripts/level-3/jungleFoliage.ts");
});
after(async () => server?.close());

test("packed bark reduces transfer bytes and retains the exact RGBA output shape", async () => {
  const directory = new URL("../src/assets/textures/", import.meta.url);
  const [packed, colour, normal] = await Promise.all(
    ["pine-bark.rgba.bin", "pine-bark-diff-2k.jpg", "pine-bark-nor-1k.jpg"].map(
      (name) => readFile(new URL(name, directory)),
    ),
  );
  assert.ok(packed.length < (colour.length + normal.length) * 0.6);
  assert.equal(gunzipSync(packed).length, (1024 * 1024 + 512 * 512) * 4);
});

test("invalid bark data fails explicitly and preparation can be retried", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (source) =>
      new Response(
        source === "bark-invalid-gzip"
          ? new Uint8Array([1, 2, 3])
          : gzipSync(new Uint8Array(12)),
      ),
  );
  await assert.rejects(
    textures.preloadPhotoBark("bark-invalid-gzip"),
    /invalid gzip data/,
  );
  await assert.rejects(
    textures.preloadPhotoBark("bark-invalid-size"),
    /Bark texture data must contain 5242880 bytes/,
  );
});

test("bark preparation shares one decode and creates correctly filtered GPU maps", async (t) => {
  const packed = await readFile(
    new URL("../src/assets/textures/pine-bark.rgba.bin", import.meta.url),
  );
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(packed);
  });
  t.mock.method(THREE.TextureLoader.prototype, "load", () => {
    throw new Error("Baked bark must not decode browser images");
  });
  const first = textures.preloadPhotoBark("bark-baked");
  assert.equal(first, textures.preloadPhotoBark("bark-baked"));
  await first;
  assert.equal(requests, 1);
  const { diffuse, normal } = textures.getPhotoBark();
  assert.ok(diffuse instanceof THREE.DataTexture);
  assert.ok(normal instanceof THREE.DataTexture);
  assert.deepEqual([diffuse.image.width, diffuse.image.height], [1024, 1024]);
  assert.deepEqual([normal.image.width, normal.image.height], [512, 512]);
  assert.equal(
    createHash("sha256")
      .update(Buffer.concat([diffuse.image.data, normal.image.data]))
      .digest("hex"),
    "13e8775f96564f2e4802f0a3555175ec4087af008599c2ae047998bdb8ea080f",
    "Row-delta decoding must restore every resized pixel exactly",
  );
  assert.equal(diffuse.colorSpace, THREE.SRGBColorSpace);
  assert.equal(normal.colorSpace, THREE.NoColorSpace);
  for (const texture of [diffuse, normal]) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, THREE.LinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.flipY, true);
    assert.equal(texture.anisotropy, 8);
    assert.ok(texture.version > 0);
  }
  await textures.preloadPhotoBark("bark-already-prepared");
  assert.equal(requests, 1);
});

test("trunk, branch and grove materials share cached pixels without sharing disposable handles", () => {
  const map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const materials = foliage.createJungleFoliageMaterials(
    { bark: map, pineBranch: map, grassTuft: map },
    { value: 0 },
  );
  const { diffuse, normal } = textures.getPhotoBark();
  try {
    for (const name of ["bark", "branches", "grove"]) {
      assert.notEqual(materials[name].map, diffuse);
      assert.notEqual(materials[name].normalMap, normal);
      assert.equal(materials[name].map.image.data, diffuse.image.data);
      assert.equal(materials[name].normalMap.image.data, normal.image.data);
    }
    assert.deepEqual(materials.bark.map.repeat.toArray(), [3, 22]);
    assert.deepEqual(materials.branches.map.repeat.toArray(), [1.5, 3]);
    assert.deepEqual(materials.grove.map.repeat.toArray(), [2, 8]);
  } finally {
    for (const material of Object.values(materials)) {
      if (material.normalMap) {
        material.map.dispose();
        material.normalMap.dispose();
      }
      material.dispose();
    }
    map.dispose();
  }
});
