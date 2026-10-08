import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import * as THREE from 'three';

let server, createEarthTextures, createEarthGroup, updateEarthGroup, addPlanetBackdrop, animatePlanetBackdrop, createFinaleWorld, disposeRoom;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createEarthTextures, createEarthGroup, updateEarthGroup } = await server.ssrLoadModule('/scripts/earthTexture.ts'));
  ({ addPlanetBackdrop, animatePlanetBackdrop } = await server.ssrLoadModule('/scripts/items/createEscapeShip.ts'));
  ({ createFinaleWorld } = await server.ssrLoadModule('/helpers/scene/finaleWorld.ts'));
  ({ disposeRoom } = await server.ssrLoadModule('/helpers/scene/shipRoom.ts'));
});

after(async () => server?.close());

test('generated Earth maps match the earth branch pixel-for-pixel', () => {
  const textures = createEarthTextures(128, 64);
  const expected = {
    colorTexture: '43b2892395ac161979f62f637e9dec5698e33aa6e12701c53d9d4d748f84d8cd',
    roughnessTexture: '899c30ca2074f15379dfd2ab7950ef5077a9dd17c4fd9b7329c1370d12d82ac2',
    cloudTexture: 'b8d858ca0c17d8ec9092981b343476a26e2a75e4104ed3af470aff87326fdf74',
  };
  try {
    for (const [name, texture] of Object.entries(textures)) {
      assert.ok(texture instanceof THREE.DataTexture);
      assert.equal(texture.image.width, 128);
      assert.equal(texture.image.height, 64);
      assert.equal(texture.image.data.length, 128 * 64 * 4);
      assert.equal(createHash('sha256').update(texture.image.data).digest('hex'), expected[name]);
    }
    assert.equal(textures.colorTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(textures.cloudTexture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(textures.roughnessTexture.colorSpace, THREE.NoColorSpace);
  } finally {
    Object.values(textures).forEach(texture => texture.dispose());
  }
});

test('full-resolution maps are reused without sharing disposable texture handles', t => {
  const first = createEarthTextures();
  Object.values(first).forEach(texture => texture.dispose());
  t.mock.method(Math, 'sin', () => { throw new Error('Cached Earth maps must not regenerate noise'); });
  const second = createEarthTextures();
  try {
    for (const name of Object.keys(first)) {
      assert.equal(second[name].image.width, 2048);
      assert.equal(second[name].image.height, 1024);
      assert.notEqual(first[name], second[name]);
      assert.equal(first[name].image.data, second[name].image.data);
      assert.ok(second[name].version > 0, 'A fresh texture must upload even after the earlier scene disposed');
    }
  } finally {
    Object.values(second).forEach(texture => texture.dispose());
  }
});

test('Earth groups keep the branch surface, cloud and atmosphere layers at the supplied location', t => {
  const scene = new THREE.Scene(), position = new THREE.Vector3(2, 3, -8);
  const textures = createEarthTextures(64, 32);
  const earth = createEarthGroup(scene, position, 5, textures);
  t.after(() => disposeRoom(scene));

  assert.equal(earth.parent, scene);
  assert.deepEqual(earth.position.toArray(), position.toArray());
  assert.notEqual(earth.position, position);
  assert.equal(earth.surface.name, 'EarthSurface');
  assert.equal(earth.clouds.name, 'EarthClouds');
  assert.equal(earth.atmosphere.name, 'EarthAtmosphere');
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

test('surface rotation and faster cloud drift are independent of frame rate', t => {
  const scene = new THREE.Scene();
  const thirty = createEarthGroup(scene, new THREE.Vector3(), 5, createEarthTextures(64, 32));
  const sixty = createEarthGroup(scene, new THREE.Vector3(), 5, createEarthTextures(64, 32));
  t.after(() => disposeRoom(scene));

  for (let i = 0; i < 30; i++) updateEarthGroup(thirty, 1 / 30);
  for (let i = 0; i < 60; i++) updateEarthGroup(sixty, 1 / 60);
  for (const earth of [thirty, sixty]) {
    assert.ok(Math.abs(earth.surface.rotation.y - 0.018) < 1e-12);
    assert.ok(Math.abs(earth.clouds.rotation.y - 0.022) < 1e-12);
    const before = [earth.surface.rotation.y, earth.clouds.rotation.y];
    updateEarthGroup(earth, 0);
    assert.deepEqual([earth.surface.rotation.y, earth.clouds.rotation.y], before);
  }
});

test('flight backdrops retain planet transforms and use both branch starfield layers', t => {
  const scene = new THREE.Scene(), position = new THREE.Vector3(0, 60, 1500);
  const planet = addPlanetBackdrop(scene, position, 320, 2400);
  t.after(() => disposeRoom(scene));

  assert.equal(planet.name, 'NearestPlanet');
  assert.deepEqual(planet.position.toArray(), position.toArray());
  assert.equal(planet.surface.geometry.parameters.radius, 320);
  const stars = scene.children.filter(node => node.name === 'Starfield');
  assert.deepEqual(stars.map(node => node.geometry.attributes.position.count), [3000, 600]);
  for (const layer of stars) {
    const positions = layer.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const radius = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      assert.ok(radius >= 2400 * 0.75 - 0.001 && radius <= 2400 + 0.001);
    }
  }
  animatePlanetBackdrop(planet, 0.5);
  assert.equal(planet.surface.rotation.y, 0.009);
  assert.equal(planet.clouds.rotation.y, 0.011);
});

test('the finale shares Earth maps and preserves textured breakup without ghost cloud shells', t => {
  const scene = new THREE.Scene(), world = createFinaleWorld(scene);
  t.after(() => world.dispose());

  assert.equal(world.planet, world.planetRoot.surface);
  assert.equal(world.planet.material.map.image.width, 2048);
  assert.equal(world.planet.material.roughnessMap.image.height, 1024);
  assert.equal(world.planetRoot.clouds.material.map.image.width, 2048);
  const fragments = world.planetRoot.children.filter(node => node !== world.planet && node.material === world.planet.material);
  assert.equal(fragments.length, 24);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  world.planet.material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance.*uRupture/);

  world.update(5, 0.2, false);
  assert.equal(shader.uniforms.uRupture.value, 0.2);
  assert.equal(world.planet.visible, true);
  assert.equal(world.planetRoot.clouds.visible, true);
  assert.equal(world.planetRoot.clouds.material.opacity, 0.95 * 0.8);
  assert.equal(world.planetRoot.haze.material.opacity, 0.09 * 0.8);
  assert.equal(world.planetRoot.atmosphere.material.uniforms.uOpacity.value, 0.8);
  assert.equal(world.planetRoot.clouds.rotation.y, 5 * 0.004);

  world.update(6, 0.5, false);
  assert.equal(world.planet.visible, false);
  assert.equal(world.planetRoot.clouds.visible, false);
  assert.equal(world.planetRoot.haze.visible, false);
  assert.equal(world.planetRoot.atmosphere.visible, false);
  assert.ok(fragments.every(fragment => fragment.visible));

  world.update(7, 1, true);
  assert.ok(fragments.every(fragment => !fragment.visible));
});

test('disposing one backdrop leaves the next scene with independently owned texture handles', () => {
  const firstScene = new THREE.Scene(), nextScene = new THREE.Scene();
  const first = addPlanetBackdrop(firstScene, new THREE.Vector3(), 5, 100);
  const next = addPlanetBackdrop(nextScene, new THREE.Vector3(), 5, 100);
  const firstTextures = [first.surface.material.map, first.surface.material.roughnessMap, first.clouds.material.map];
  const nextTextures = [next.surface.material.map, next.surface.material.roughnessMap, next.clouds.material.map];
  const firstDisposals = [0, 0, 0], nextDisposals = [0, 0, 0];
  firstTextures.forEach((texture, i) => texture.addEventListener('dispose', () => { firstDisposals[i]++; }));
  nextTextures.forEach((texture, i) => texture.addEventListener('dispose', () => { nextDisposals[i]++; }));

  disposeRoom(firstScene);
  assert.deepEqual(firstDisposals, [1, 1, 1]);
  assert.deepEqual(nextDisposals, [0, 0, 0]);
  for (let i = 0; i < firstTextures.length; i++) assert.notEqual(firstTextures[i], nextTextures[i]);
  disposeRoom(nextScene);
  assert.deepEqual(nextDisposals, [1, 1, 1]);
});

test('every existing Earth scene uses the shared renderer and its paused update path', async () => {
  for (const path of ['scenes/level 1/scene14.ts', 'scenes/level 2/scene15.ts', 'scenes/level 2/scene16.ts']) {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
    assert.match(source, /animatePlanetBackdrop.*from.*createEscapeShip/);
    assert.match(source, /animatePlanetBackdrop\(planet, dt\)/);
    assert.match(source, /if \(disposed \|\|/);
  }
  const prologue = await readFile(new URL('../src/scenes/prologue/prologueFlashbacks.ts', import.meta.url), 'utf8');
  assert.match(prologue, /createEarthGroup\(planetScene,/);
  assert.match(prologue, /updateEarthGroup\(planet, dt\)/);
});
