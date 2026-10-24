import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import * as THREE from "three";

let server,
  createEarthTextures,
  preloadEarthTextures,
  createEarthGroup,
  updateEarthGroup,
  addPlanetBackdrop,
  animatePlanetBackdrop,
  createFinaleWorld,
  PLANET_RUPTURE,
  samplePlanetSurface,
  disposeRoom;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({
    createEarthTextures,
    preloadEarthTextures,
    createEarthGroup,
    updateEarthGroup,
  } = await server.ssrLoadModule("/scripts/global/earthTexture.ts"));
  ({ addPlanetBackdrop, animatePlanetBackdrop } = await server.ssrLoadModule(
    "/scripts/items/createEscapeShip.ts",
  ));
  ({ createFinaleWorld } = await server.ssrLoadModule(
    "/scripts/level-3/finaleWorld.ts",
  ));
  ({ PLANET_RUPTURE, samplePlanetSurface } = await server.ssrLoadModule(
    "/scripts/global/finaleChoreography.ts",
  ));
  ({ disposeRoom } = await server.ssrLoadModule("/scripts/global/shipRoom.ts"));
});

after(async () => server?.close());

function createRendererStub() {
  return {
    toneMapping: THREE.NoToneMapping,
    getRenderTarget: () => null,
    setRenderTarget() {},
    getClearColor: (out) => out.set(0),
    getClearAlpha: () => 1,
    setClearColor() {},
    clear() {},
    render() {},
  };
}

test("generated Earth maps match the earth branch pixel-for-pixel", () => {
  const textures = createEarthTextures(128, 64);
  const expected = {
    colorTexture:
      "43b2892395ac161979f62f637e9dec5698e33aa6e12701c53d9d4d748f84d8cd",
    roughnessTexture:
      "899c30ca2074f15379dfd2ab7950ef5077a9dd17c4fd9b7329c1370d12d82ac2",
    cloudTexture:
      "b8d858ca0c17d8ec9092981b343476a26e2a75e4104ed3af470aff87326fdf74",
  };
  try {
    for (const [name, texture] of Object.entries(textures)) {
      assert.ok(texture instanceof THREE.DataTexture);
      assert.equal(texture.image.width, 128);
      assert.equal(texture.image.height, 64);
      assert.equal(texture.image.data.length, 128 * 64 * 4);
      assert.equal(
        createHash("sha256").update(texture.image.data).digest("hex"),
        expected[name],
      );
    }
    assert.equal(textures.colorTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(textures.cloudTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(textures.roughnessTexture.colorSpace, THREE.NoColorSpace);
  } finally {
    Object.values(textures).forEach((texture) => texture.dispose());
  }
});

test("invalid baked maps fail explicitly and allow another preparation attempt", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (source) =>
      new Response(
        source === "earth-invalid-gzip"
          ? new Uint8Array([1, 2, 3])
          : gzipSync(new Uint8Array(12)),
      ),
  );
  await assert.rejects(
    preloadEarthTextures("earth-invalid-gzip"),
    /invalid gzip data/,
  );
  await assert.rejects(
    preloadEarthTextures("earth-invalid-size"),
    /Earth texture data must contain 25165824 bytes/,
  );
});

test("baked full-resolution maps preserve every pixel without regenerating procedural noise", async (t) => {
  const compressed = await readFile(
    new URL("../src/assets/planets/earth-maps.rgba.bin", import.meta.url),
  );
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(compressed);
  });
  t.mock.method(Math, "sin", () => {
    throw new Error("Preloaded Earth maps must not regenerate noise");
  });
  const first = preloadEarthTextures("earth-baked"),
    second = preloadEarthTextures("earth-baked");
  assert.equal(first, second, "Concurrent preparation shares one decode");
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  const textures = createEarthTextures();
  const expected = {
    colorTexture:
      "d52a717aa7b1e92a8b12c816501bf5edf0d6827fb96dd50d9a4ea747c87e32e1",
    roughnessTexture:
      "539cea1668a13a02a76d9152305d1a1c36766eadad19e5ad0bb03ec868073411",
    cloudTexture:
      "9fc4843372a8b8384e92fed69ef0a347fa7814331daaae871c59d7ed7dfbc859",
  };
  try {
    for (const [name, texture] of Object.entries(textures)) {
      assert.equal(texture.image.width, 2048);
      assert.equal(texture.image.height, 1024);
      assert.equal(
        createHash("sha256").update(texture.image.data).digest("hex"),
        expected[name],
      );
    }
    assert.equal(textures.colorTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(textures.cloudTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(textures.roughnessTexture.colorSpace, THREE.NoColorSpace);
  } finally {
    Object.values(textures).forEach((texture) => texture.dispose());
  }
});

test("full-resolution maps are reused without sharing disposable texture handles", async (t) => {
  const first = createEarthTextures();
  Object.values(first).forEach((texture) => texture.dispose());
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Cached Earth maps must not download again");
  });
  t.mock.method(Math, "sin", () => {
    throw new Error("Cached Earth maps must not regenerate noise");
  });
  await preloadEarthTextures("earth-already-prepared");
  const second = createEarthTextures();
  try {
    for (const name of Object.keys(first)) {
      assert.equal(second[name].image.width, 2048);
      assert.equal(second[name].image.height, 1024);
      assert.notEqual(first[name], second[name]);
      assert.equal(first[name].image.data, second[name].image.data);
      assert.ok(
        second[name].version > 0,
        "A fresh texture must upload even after the earlier scene disposed",
      );
    }
  } finally {
    Object.values(second).forEach((texture) => texture.dispose());
  }
});

test("Earth groups keep the branch surface, cloud and atmosphere layers at the supplied location", (t) => {
  const scene = new THREE.Scene(),
    position = new THREE.Vector3(2, 3, -8);
  const textures = createEarthTextures(64, 32);
  const earth = createEarthGroup(scene, position, 5, textures);
  t.after(() => disposeRoom(scene));

  assert.equal(earth.parent, scene);
  assert.deepEqual(earth.position.toArray(), position.toArray());
  assert.notEqual(earth.position, position);
  assert.equal(earth.surface.name, "EarthSurface");
  assert.equal(earth.clouds.name, "EarthClouds");
  assert.equal(earth.atmosphere.name, "EarthAtmosphere");
  assert.equal(earth.surface.geometry.parameters.radius, 5);
  assert.equal(earth.clouds.geometry.parameters.radius, 5 * 1.006);
  assert.equal(earth.haze.geometry.parameters.radius, 5 * 1.018);
  assert.equal(earth.atmosphere.geometry.parameters.radius, 5 * 1.08);
  assert.equal(earth.surface.material.map, textures.colorTexture);
  assert.equal(earth.surface.material.roughnessMap, textures.roughnessTexture);
  assert.equal(earth.clouds.material.map, textures.cloudTexture);
  assert.equal(earth.clouds.material.opacity, 0.95);
  assert.equal(earth.clouds.material.depthWrite, false);
  assert.equal(earth.haze.material.opacity, 0.09);
  assert.equal(earth.atmosphere.material.blending, THREE.AdditiveBlending);
  assert.equal(earth.atmosphere.material.uniforms.uOpacity.value, 1);
});

test("surface rotation and faster cloud drift are independent of frame rate", (t) => {
  const scene = new THREE.Scene();
  const thirty = createEarthGroup(
    scene,
    new THREE.Vector3(),
    5,
    createEarthTextures(64, 32),
  );
  const sixty = createEarthGroup(
    scene,
    new THREE.Vector3(),
    5,
    createEarthTextures(64, 32),
  );
  t.after(() => disposeRoom(scene));

  for (let i = 0; i < 30; i++) updateEarthGroup(thirty, 1 / 30);
  for (let i = 0; i < 60; i++) updateEarthGroup(sixty, 1 / 60);
  for (const earth of [thirty, sixty]) {
    assert.ok(Math.abs(earth.surface.rotation.y - 0.018) < 1e-12);
    assert.ok(Math.abs(earth.clouds.rotation.y - 0.022) < 1e-12);
    const before = [earth.surface.rotation.y, earth.clouds.rotation.y];
    updateEarthGroup(earth, 0);
    assert.deepEqual(
      [earth.surface.rotation.y, earth.clouds.rotation.y],
      before,
    );
  }
});

test("flight backdrops retain planet transforms and use both branch starfield layers", (t) => {
  const scene = new THREE.Scene(),
    position = new THREE.Vector3(0, 60, 1500);
  const { planet, starfield } = addPlanetBackdrop(scene, position, 320, 2400, {
    renderer: createRendererStub(),
  });
  t.after(() => {
    starfield.dispose();
    disposeRoom(scene);
  });

  assert.equal(planet.name, "NearestPlanet");
  assert.deepEqual(planet.position.toArray(), position.toArray());
  assert.equal(planet.surface.geometry.parameters.radius, 320);
  const stars = scene.children.filter((node) => node.name === "Starfield");
  assert.deepEqual(
    stars.map((node) => node.geometry.attributes.position.count),
    [650, 406],
  );
  for (const layer of stars) {
    const positions = layer.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      for (const coordinate of [
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i),
      ])
        assert.ok(Number.isFinite(coordinate) && Math.abs(coordinate) <= 2400);
    }
    assert.equal(layer.material.uniforms.uRadius.value, 2400);
  }
  animatePlanetBackdrop(planet, 0.5);
  assert.equal(planet.surface.rotation.y, 0.009);
  assert.equal(planet.clouds.rotation.y, 0.011);
});

test("the finale shares Earth maps, melts its crust and clears every shell before stardust", (t) => {
  const scene = new THREE.Scene(),
    renderer = createRendererStub(),
    world = createFinaleWorld(scene, { renderer });
  t.after(() => world.dispose());

  assert.equal(world.planet, world.planetRoot.surface);
  assert.equal(world.planet.material.map.image.width, 2048);
  assert.equal(world.planet.material.roughnessMap.image.height, 1024);
  assert.equal(world.planetRoot.clouds.material.map.image.width, 2048);
  const fragments = world.planetRoot.children.filter(
    (node) => node !== world.planet && node.material === world.planet.material,
  );
  assert.equal(fragments.length, 0);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  world.planet.material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance.*uRupture/);

  const time = PLANET_RUPTURE.impact + 0.6,
    surface = samplePlanetSurface(time);
  world.update(time, 0.2, false, 4, 3, time, 1);
  assert.equal(shader.uniforms.uRupture.value, 0.2);
  assert.equal(world.planet.visible, true);
  assert.equal(world.planetRoot.clouds.visible, true);
  assert.equal(
    world.planetRoot.clouds.material.opacity,
    0.95 * (1 - surface.dissolve),
  );
  assert.equal(
    world.planetRoot.haze.material.opacity,
    0.09 * (1 - surface.dissolve),
  );
  assert.equal(
    world.planetRoot.atmosphere.material.uniforms.uOpacity.value,
    1 - surface.dissolve,
  );
  assert.equal(world.planetRoot.clouds.rotation.y, time * 0.004);

  world.update(
    PLANET_RUPTURE.burning,
    0.5,
    false,
    4,
    3,
    PLANET_RUPTURE.burning,
    1,
  );
  assert.equal(world.planet.visible, false);
  assert.equal(world.planetRoot.clouds.visible, false);
  assert.equal(world.planetRoot.haze.visible, false);
  assert.equal(world.planetRoot.atmosphere.visible, false);
  assert.equal(
    world.planetRoot.getObjectByName("EarthBurningSurface").visible,
    true,
  );

  world.update(7, 1, true);
  assert.equal(world.planetRoot.visible, false);
  assert.equal(world.root.getObjectByName("EarthRockDebris").visible, false);
});

test("disposing one backdrop leaves the next scene with independently owned texture handles", () => {
  const firstScene = new THREE.Scene(),
    nextScene = new THREE.Scene();
  const firstBackdrop = addPlanetBackdrop(
    firstScene,
    new THREE.Vector3(),
    5,
    100,
    {
      renderer: createRendererStub(),
    },
  );
  const nextBackdrop = addPlanetBackdrop(
    nextScene,
    new THREE.Vector3(),
    5,
    100,
    {
      renderer: createRendererStub(),
    },
  );
  const first = firstBackdrop.planet,
    next = nextBackdrop.planet;
  const firstTextures = [
    first.surface.material.map,
    first.surface.material.roughnessMap,
    first.clouds.material.map,
  ];
  const nextTextures = [
    next.surface.material.map,
    next.surface.material.roughnessMap,
    next.clouds.material.map,
  ];
  const firstDisposals = [0, 0, 0],
    nextDisposals = [0, 0, 0];
  firstTextures.forEach((texture, i) =>
    texture.addEventListener("dispose", () => {
      firstDisposals[i]++;
    }),
  );
  nextTextures.forEach((texture, i) =>
    texture.addEventListener("dispose", () => {
      nextDisposals[i]++;
    }),
  );

  firstBackdrop.starfield.dispose();
  disposeRoom(firstScene);
  assert.deepEqual(firstDisposals, [1, 1, 1]);
  assert.deepEqual(nextDisposals, [0, 0, 0]);
  for (let i = 0; i < firstTextures.length; i++)
    assert.notEqual(firstTextures[i], nextTextures[i]);
  nextBackdrop.starfield.dispose();
  disposeRoom(nextScene);
  assert.deepEqual(nextDisposals, [1, 1, 1]);
});

test("every existing Earth scene uses the shared renderer and its paused update path", async () => {
  for (const path of [
    "scenes/level 1 boss stage/scene14.ts",
    "scenes/level 2/scene15.ts",
    "scenes/level 2/scene16.ts",
  ]) {
    const source = await readFile(
      new URL(`../src/${path}`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /import\s*\{[^}]*\banimatePlanetBackdrop\b[^}]*\}\s*from\s*["'][^"']*createEscapeShip/,
    );
    assert.match(source, /animatePlanetBackdrop\(\s*planet,\s*dt\s*\)/);
    assert.match(source, /if\s*\(\s*disposed\s*\|\|/);
  }
  const prologue = await readFile(
    new URL("../src/scenes/prologue/prologueFlashbacks.ts", import.meta.url),
    "utf8",
  );
  assert.match(prologue, /createEarthGroup\(\s*planetScene,/);
  assert.match(prologue, /updateEarthGroup\(\s*planet,\s*dt\s*\)/);
});
