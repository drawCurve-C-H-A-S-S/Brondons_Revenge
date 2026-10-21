import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createServer } from 'vite';

let server, choreography, createFinaleDirector, shouldPauseFinale, createFinaleMech, createFinaleSite, createFinaleAftermath;
let prepareSceneRendering, createFinaleCamera, world;
const globals = new Map(['self', 'window', 'document', 'createImageBitmap', 'ProgressEvent', 'fetch']
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

before(async () => {
  const context = new Proxy({
    measureText: text => ({ width: text.length * 35 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true; } });
  class Image extends EventTarget {
    width = 512; height = 512;
    set src(value) { this.source = value; queueMicrotask(() => this.dispatchEvent(new Event('load'))); }
    get src() { return this.source; }
  }
  globalThis.self = globalThis;
  globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  globalThis.document = {
    baseURI: 'http://localhost/',
    createElement: () => ({ width: 256, height: 256, getContext: () => context, toDataURL: () => 'data:image/png;base64,' }),
    createElementNS: () => new Image(),
  };
  globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
  globalThis.ProgressEvent = class extends Event { constructor(type, options) { super(type); Object.assign(this, options); } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const source = typeof input === 'string' ? input : input.url ?? String(input);
    if (source.startsWith('blob:') || source.startsWith('data:')) return originalFetch(input, options);
    const url = new URL(source, document.baseURI);
    if (url.hostname !== 'localhost' || !url.pathname.startsWith('/assets/')) throw new Error(`Unexpected test request: ${source}`);
    const buffer = await readFile(new URL(`../src${url.pathname}`, import.meta.url));
    return new Response(buffer, { headers: { 'Content-Type': url.pathname.endsWith('.json') || url.pathname.endsWith('.gltf')
      ? 'application/json' : 'application/octet-stream' } });
  };
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  choreography = await server.ssrLoadModule('/scripts/finaleChoreography.ts');
  ({ createFinaleDirector, shouldPauseFinale } = await server.ssrLoadModule('/scripts/finaleDirector.ts'));
  ({ createFinaleMech } = await server.ssrLoadModule('/helpers/scene/finaleMechs.ts'));
  ({ createFinaleSite } = await server.ssrLoadModule('/helpers/scene/finaleSite.ts'));
  ({ createFinaleAftermath } = await server.ssrLoadModule('/helpers/scene/finaleAftermath.ts'));
  ({ createFinaleCamera } = await server.ssrLoadModule('/helpers/scene/finaleCinematography.ts'));
  ({ prepareSceneRendering } = await server.ssrLoadModule('/core/renderer.ts'));
  world = await server.ssrLoadModule('/helpers/scene/finaleWorld.ts');
});

after(async () => {
  await server?.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test('the finisher runs in the requested order and reaches victory at 30, 60 and 144 fps', () => {
  assert.deepEqual(choreography.FINISHER_BEATS.map(beat => beat.shot),
    ['evade', 'parry', 'countershot', 'clash', 'armCut', 'ascend', 'reactor', 'finalCut']);
  for (const fps of [30, 60, 144]) {
    const director = createFinaleDirector('finisher'); director.assetsLoaded();
    let frames = 0;
    while (director.getState().phase === 'finisher' && frames < fps * 35) {
      director.update(1 / fps); frames++;
    }
    assert.equal(director.getState().phase, 'victory');
    assert.ok(Math.abs(frames / fps - choreography.FINISHER_DURATION) <= 1 / fps + 1e-7);
    assert.equal(director.duel.getState().phase, 'won');
  }
});

test('visible cinematics autoplay without canvas focus but deliberate and hidden-tab pauses remain', () => {
  for (const phase of ['reveal', 'finisher', 'victory', 'credits']) {
    assert.equal(shouldPauseFinale(phase, { menuPaused: false, hidden: false, blurred: true }), false);
    assert.equal(shouldPauseFinale(phase, { menuPaused: true, hidden: false, blurred: false }), true);
    assert.equal(shouldPauseFinale(phase, { menuPaused: false, hidden: true, blurred: false }), true);
  }
  for (const phase of ['ground', 'space']) {
    assert.equal(shouldPauseFinale(phase, { menuPaused: false, hidden: false, blurred: true }), true);
  }
});

test('the visible mechs keep body clearance, including the vanishing approach', () => {
  for (let time = 0; time < choreography.FINISHER_DURATION; time += 1 / 120) {
    const sample = choreography.sampleFinisherSequence(time);
    if (!sample.heroVisible || sample.heroDissolve > 0.7) continue;
    const distance = Math.hypot(...sample.hero.map((value, axis) => value - sample.enemy[axis]));
    assert.ok(distance > 9, `${sample.beat.id} at ${sample.clock}: body clearance ${distance}`);
    assert.ok([...sample.hero, ...sample.enemy, sample.heroRoll, sample.enemyRoll].every(Number.isFinite));
  }
});

test('the dance has its own screen time and the mothership brakes into a matching final heading', () => {
  const { DONUS_RETURN, sampleMothershipArrival } = choreography;
  assert.ok(DONUS_RETURN.appear - DONUS_RETURN.dance >= 4);
  const initial = sampleMothershipArrival(DONUS_RETURN.appear), parked = sampleMothershipArrival(DONUS_RETURN.arrival);
  assert.deepEqual(parked.position, [40, 9, -12]);
  assert.deepEqual(parked.direction, [-1, 0, 0]);
  assert.ok(initial.position[0] > 150 && initial.position[2] < -100);
  const epsilon = 0.001;
  const before = sampleMothershipArrival(DONUS_RETURN.arrival - epsilon);
  const after = sampleMothershipArrival(DONUS_RETURN.arrival + epsilon);
  assert.ok(Math.abs(before.direction[0] - parked.direction[0]) < 1e-5);
  for (let axis = 0; axis < 3; axis++) {
    const incoming = (parked.position[axis] - before.position[axis]) / epsilon;
    const outgoing = (after.position[axis] - parked.position[axis]) / epsilon;
    assert.ok(Math.abs(incoming - outgoing) < 0.002, `arrival velocity axis ${axis}`);
  }
});

test('the extended blade lock has three distinct close-ups and the cut follows behind the sword arm', () => {
  const hero = new THREE.Group(), enemy = new THREE.Group();
  hero.position.copy(world.finaleBattlePoint(-6, 0, world.SPACE_ALTITUDE)); hero.rotation.y = world.FINALE_BATTLE_YAW;
  enemy.position.copy(world.finaleBattlePoint(6, 0, world.SPACE_ALTITUDE)); enemy.rotation.y = world.FINALE_BATTLE_YAW + Math.PI;
  const heroChest = hero.position.clone().add(new THREE.Vector3(0, 11, 0));
  const enemyChest = enemy.position.clone().add(new THREE.Vector3(0, 11, 0));
  const heroFace = hero.position.clone().add(new THREE.Vector3(0, 15, 0));
  const enemyFace = enemy.position.clone().add(new THREE.Vector3(0, 15, 0));
  const heroShoulder = hero.position.clone().add(new THREE.Vector3(0, 12, 2));
  const clash = heroChest.clone().lerp(enemyChest, 0.5).add(new THREE.Vector3(0, 1.6, 2.2));
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.08, 5200), rig = createFinaleCamera(camera, false);
  const context = {
    phase: 'finisher', phaseTime: 0, time: 0, space: true, hero, enemy, heroChest, enemyChest, heroFace, enemyFace, heroShoulder, clash,
    human: new THREE.Vector3(), students: [], boy: new THREE.Vector3(), pilotFace: new THREE.Vector3(), pilotCamera: new THREE.Vector3(),
    ship: new THREE.Group(), mothership: new THREE.Group(), bomb: new THREE.Vector3(),
    heroMuzzle: heroChest, enemyMuzzle: enemyChest, heroBladeBase: clash, heroBladeTip: clash, enemyBladeTip: clash, special: null,
  };
  const shot = choreography.FINISHER_TIMELINE.find(shot => shot.beat.shot === 'clash');
  assert.ok(shot.beat.duration >= 4);
  for (const [clock, focus] of [[1.2, clash], [2.2, heroFace], [3, enemyFace]]) {
    rig.update({ ...context, finisher: choreography.sampleFinisherSequence(shot.start + clock) }, 0);
    const expected = focus.clone().sub(camera.position).normalize();
    assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(expected) > 0.999);
    assert.ok(camera.position.distanceTo(focus) < 14);
  }
  const cut = choreography.FINISHER_TIMELINE.find(shot => shot.beat.shot === 'armCut');
  rig.update({ ...context, finisher: choreography.sampleFinisherSequence(cut.start + 0.5) }, 0);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(hero.quaternion);
  assert.ok(camera.position.clone().sub(heroShoulder).dot(forward) < -5);
  assert.ok(camera.position.distanceTo(heroShoulder) < 7);
});

test('each execution slash produces a finite physical recoil before the enemy collapses', () => {
  const beat = choreography.FINISHER_BEATS.at(-1), timing = choreography.FINISHER_EXECUTION;
  const interval = (timing.lastCut - timing.cuts) / timing.slashes;
  for (let strike = 0; strike < timing.slashes; strike++) {
    const contact = timing.cuts + strike * interval;
    const reaction = choreography.sampleFinisher(beat, contact + interval * 0.5);
    const recovery = choreography.sampleFinisher(beat, contact);
    assert.ok(reaction.enemyPitch < -0.05);
    assert.ok(Math.abs(reaction.enemy[2] - recovery.enemy[2]) > 0.2);
    assert.ok([...reaction.enemy, reaction.enemyPitch, reaction.enemyRoll].every(Number.isFinite));
  }
  assert.equal(choreography.sampleFinisher(beat, timing.collapse + 0.2).enemyPose, 'defeat');
});

async function mech(t, side) {
  const buffer = await readFile(new URL(`../src/assets/models/${side === 'hero' ? 'MC' : 'Subject'}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  const asset = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const actor = createFinaleMech(side, async () => asset);
  t.after(() => actor.dispose());
  await actor.loaded;
  return actor;
}

function bladeDistance(first, second) {
  const ab = first.tip.clone().sub(first.base), cd = second.tip.clone().sub(second.base), delta = first.base.clone().sub(second.base);
  const a = ab.dot(ab), b = ab.dot(cd), c = cd.dot(cd), d = ab.dot(delta), e = cd.dot(delta);
  const denominator = a * c - b * b;
  let s = denominator > 1e-9 ? THREE.MathUtils.clamp((b * e - c * d) / denominator, 0, 1) : 0;
  let t = (b * s + e) / c;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-d / a, 0, 1); }
  else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - d) / a, 0, 1); }
  return first.base.clone().addScaledVector(ab, s).distanceTo(second.base.clone().addScaledVector(cd, t));
}

test('the real MC and Subject rigs meet at separated blade surfaces with weapons still in their hands', async t => {
  const hero = await mech(t, 'hero'), enemy = await mech(t, 'enemy');
  for (const shot of choreography.FINISHER_TIMELINE.filter(shot => ['parry', 'clash'].includes(shot.beat.shot))) {
    for (let clock = 0; clock < shot.beat.duration; clock += 1 / 60) {
      const sample = choreography.sampleFinisherSequence(shot.start + clock);
      for (const [actor, side] of [[hero, 'hero'], [enemy, 'enemy']]) {
        actor.root.position.copy(world.finaleBattlePoint(sample[side][0], sample[side][1], world.SPACE_ALTITUDE));
        actor.root.position.z += sample[side][2];
        actor.root.rotation.set(0, world.FINALE_BATTLE_YAW + (side === 'enemy' ? Math.PI : 0), sample[`${side}Roll`]);
        const move = sample[`${side}Pose`], duration = choreography.MELEE_STRIKES[move]?.duration ?? 1;
        actor.pose(move, sample[`${side}PoseProgress`] * duration, duration, true, 0, shot.start + clock, true, shot.beat.id);
      }
      const contact = hero.getChest().lerp(enemy.getChest(), 0.5).add(new THREE.Vector3(0, 1.6, 2.2));
      if (sample.bladeLock > 0) {
        hero.lockBlade(contact, 1, 0, sample.bladeLock); enemy.lockBlade(contact, -1, 0, sample.bladeLock);
      }
      if (sample.bladeLock < 0.99) continue;
      const distance = bladeDistance(hero.getBlade(), enemy.getBlade());
      assert.ok(distance >= 0.3 && distance < 0.8, `${shot.beat.id} at ${clock}: blade spacing ${distance}`);
      for (const actor of [hero, enemy]) {
        assert.ok(actor.getHand('right').distanceTo(actor.sword.getWorldPosition(new THREE.Vector3())) < 1.3,
          'the contact solver must move the arm, not detach the weapon');
      }
    }
  }
});

test('the finale site preserves the roof and rescue positions without constructing the traversal level', async t => {
  const site = createFinaleSite(); t.after(() => site.dispose());
  await site.ready;
  const size = new THREE.Box3().setFromObject(site.facilityRoof).getSize(new THREE.Vector3());
  assert.equal(size.x, world.FINALE_ROOFTOP.width);
  assert.equal(size.z, world.FINALE_ROOFTOP.depth);
  assert.equal(site.scene.getObjectByName('FinaleBackdropTrunks').count, 320);
  assert.equal(site.scene.getObjectByName('FinaleBackdropCanopy').count, 640);
  assert.equal(site.scene.getObjectByName('ImpassableWesternMountain'), undefined);
  assert.equal(site.scene.getObjectByName('FacilityShipSentinelLeft'), undefined);
  assert.ok(site.ship.root.position.distanceTo(new THREE.Vector3(-74, 0.65, 87)) < 1e-8);
  assert.ok(site.boy.position.distanceTo(new THREE.Vector3(-61.8, 0, 85.4)) < 1e-8);
});

test('impact dissolves all textured crust and leaves an opaque solar fire surface', t => {
  const scene = new THREE.Scene(), environment = world.createFinaleWorld(scene);
  t.after(() => environment.dispose());
  const timing = choreography.PLANET_RUPTURE, earth = environment.root.getObjectByName('Earth');
  const fire = environment.root.getObjectByName('EarthBurningSurface');
  const before = choreography.samplePlanetSurface(timing.impact - 0.01);
  assert.equal(before.dissolve, 0); assert.equal(before.fireVisible, false);
  environment.update(timing.impact + 0.6, 0.2, false, 4, 3, timing.impact + 0.6, 1);
  assert.equal(earth.surface.visible, true); assert.equal(fire.visible, true);
  assert.ok(choreography.samplePlanetSurface(timing.impact + 0.6).dissolve > 0);
  environment.update(timing.burst, 0.5, false, 4, 3, timing.burst, 1);
  assert.equal(earth.surface.visible, false);
  assert.equal(earth.clouds.visible, false); assert.equal(earth.atmosphere.visible, false);
  assert.equal(fire.visible, true); assert.equal(fire.material.transparent, false);
  assert.equal(fire.material.blending, THREE.NormalBlending);
});

test('Brendan drops to his knees then finishes the authored death with the fire attached to his head', async t => {
  const site = createFinaleSite(); await site.ready;
  const aftermath = createFinaleAftermath(site.scene, site.boy, site.ready, false, site.getBoyAnimations);
  t.after(() => { aftermath.dispose(); site.dispose(); });
  await aftermath.ready;
  const hero = new THREE.Group(), timing = choreography.PLANET_RUPTURE;
  aftermath.update(timing.forest, timing.forest, hero);
  const standing = aftermath.getBoyFocus().y;
  aftermath.update(timing.scorch, timing.scorch, hero);
  const kneeling = aftermath.getBoyFocus().y;
  assert.ok(kneeling < standing - 0.35, `head height ${standing} -> ${kneeling}`);
  aftermath.update(timing.forestEnd - 0.1, timing.forestEnd - 0.1, hero);
  const fallen = aftermath.getBoyFocus().y;
  assert.ok(fallen < kneeling - 0.25, `head height ${kneeling} -> ${fallen}`);
  assert.ok(fallen >= -0.05, 'the authored fall must remain above the ground');
  const fire = site.boy.getObjectByName('BrendanHeadFire');
  assert.equal(fire.parent.name, 'Head'); assert.equal(fire.visible, true);
  assert.equal(site.boy.rotation.z, 0, 'do not rotate the entire standing rig sideways to fake a fall');
  assert.equal(choreography.samplePlanetAftermath(timing.cockpit).forest, false);
});

test('the finale warmup compiles and renders once, retaining fog and restoring hidden objects', async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.fog = new THREE.Fog(0x263138, 55, 230);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.visible = false; scene.add(mesh);
  let compiles = 0, renders = 0;
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace,
    initTexture() {}, getRenderTarget: () => null,
    getViewport: target => target.set(0, 0, 640, 480), getScissor: target => target.set(0, 0, 640, 480),
    getScissorTest: () => false, setRenderTarget() {}, setScissorTest() {}, setViewport() {}, setScissor() {},
    compileAsync: async () => { compiles++; }, render: () => { renders++; },
  };
  const fog = scene.fog;
  await prepareSceneRendering(renderer, scene, camera, { fogVariants: false });
  assert.equal(compiles, 1); assert.equal(renders, 1);
  assert.equal(scene.fog, fog); assert.equal(mesh.visible, false); assert.equal(mesh.frustumCulled, true);
  mesh.geometry.dispose(); mesh.material.dispose();
});
