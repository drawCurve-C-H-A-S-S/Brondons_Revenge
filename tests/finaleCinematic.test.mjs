import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createServer } from "vite";

let server,
  choreography,
  createFinaleDirector,
  shouldPauseFinale,
  createFinaleMech,
  createFinaleSite,
  createFinaleAftermath;
let prepareSceneRendering,
  createFinaleCamera,
  createStarfield,
  world,
  architecture,
  office,
  createFinaleStudents;
const studentNames = ["Caleb", "Husain", "André", "Sibusiso", "Sohrab"];
const studentFiles = ["Caleb", "Husain", "Andre", "Sibusiso", "Sohrab"];
const requestedAssets = new Set();
function assertStudentAppearance(model) {
  let skinnedMeshes = 0;
  model.traverse((node) => {
    if (!node.isMesh) return;
    if (node.name === "BrondonComicInk") return;
    if (!node.isSkinnedMesh) {
      assert.ok(
        !/^(Cube|Cube\.?001)$/.test(node.name),
        "Remove the stray head blocks",
      );
      return;
    }
    skinnedMeshes++;
    const material = node.material;
    assert.ok(material.isMeshStandardMaterial);
    const shader = {
      uniforms: {},
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader, {});
    assert.ok(shader.uniforms.uBrondonColor);
    assert.equal(shader.uniforms.uCellShadingEnabled.value, 1);
    assert.ok(shader.fragmentShader.includes("brondonShade"));
    assert.ok(shader.fragmentShader.includes("? 1.0 : 0.5"));
  });
  assert.ok(skinnedMeshes > 0, "Keep the skinned bodies");
}
const globals = new Map(
  [
    "self",
    "window",
    "document",
    "createImageBitmap",
    "ProgressEvent",
    "fetch",
  ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

function createBakeRenderer() {
  const clearColor = new THREE.Color(0x123456),
    targets = [];
  let target = null,
    clearAlpha = 0.6;
  return {
    targets,
    toneMapping: THREE.ACESFilmicToneMapping,
    getRenderTarget: () => target,
    setRenderTarget(value) {
      target = value;
    },
    getClearColor: (out) => out.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha) {
      clearColor.set(value);
      clearAlpha = alpha;
    },
    clear() {},
    render() {
      assert.ok(target?.isWebGLRenderTarget);
      targets.push(target);
    },
  };
}

before(async () => {
  const context = new Proxy(
    {
      measureText: (text) => ({ width: text.length * 35 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    },
  );
  class Image extends EventTarget {
    width = 512;
    height = 512;
    set src(value) {
      this.source = value;
      queueMicrotask(() => this.dispatchEvent(new Event("load")));
    }
    get src() {
      return this.source;
    }
  }
  globalThis.self = globalThis;
  globalThis.window = Object.assign(new EventTarget(), {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
  });
  globalThis.document = {
    baseURI: "http://localhost/",
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => context,
      toDataURL: () => "data:image/png;base64,",
    }),
    createElementNS: () => new Image(),
  };
  globalThis.createImageBitmap = async () => ({
    width: 512,
    height: 512,
    close() {},
  });
  globalThis.ProgressEvent = class extends Event {
    constructor(type, options) {
      super(type);
      Object.assign(this, options);
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const source =
      typeof input === "string" ? input : (input.url ?? String(input));
    if (source.startsWith("blob:") || source.startsWith("data:"))
      return originalFetch(input, options);
    const url = new URL(source, document.baseURI);
    if (url.hostname !== "localhost" || !url.pathname.startsWith("/assets/"))
      throw new Error(`Unexpected test request: ${source}`);
    requestedAssets.add(decodeURIComponent(url.pathname));
    const buffer = await readFile(
      new URL(`../src${url.pathname}`, import.meta.url),
    );
    return new Response(buffer, {
      headers: {
        "Content-Type":
          url.pathname.endsWith(".json") || url.pathname.endsWith(".gltf")
            ? "application/json"
            : "application/octet-stream",
      },
    });
  };
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  choreography = await server.ssrLoadModule(
    "/scripts/global/finaleChoreography.ts",
  );
  ({ createFinaleDirector, shouldPauseFinale } = await server.ssrLoadModule(
    "/scripts/global/finaleDirector.ts",
  ));
  ({ createFinaleMech } = await server.ssrLoadModule(
    "/scripts/level-3/finaleMechs.ts",
  ));
  ({ createFinaleSite } = await server.ssrLoadModule(
    "/scripts/level-3/finaleSite.ts",
  ));
  ({ createFinaleAftermath } = await server.ssrLoadModule(
    "/scripts/level-3/finaleAftermath.ts",
  ));
  ({ createFinaleCamera } = await server.ssrLoadModule(
    "/scripts/level-3/finaleCinematography.ts",
  ));
  ({ prepareSceneRendering } = await server.ssrLoadModule("/core/renderer.ts"));
  ({ createStarfield } = await server.ssrLoadModule(
    "/scripts/global/starfield.ts",
  ));
  world = await server.ssrLoadModule("/scripts/level-3/finaleWorld.ts");
  architecture = await server.ssrLoadModule(
    "/scripts/global/facilityArchitecture.ts",
  );
  office = await server.ssrLoadModule("/scripts/level-3/facilityOffice.ts");
  ({ createFinaleStudents } = await server.ssrLoadModule(
    "/scripts/level-3/finaleActors.ts",
  ));
});

after(async () => {
  await server?.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("remembrance uses distinct Branden and Brendan models without ghost tint leaking into credits", async (t) => {
  const { createFinaleRemembrance } = await server.ssrLoadModule(
    "/scripts/level-3/finaleRemembrance.ts",
  );
  const { createFinaleCredits } = await server.ssrLoadModule(
    "/scripts/level-3/finaleCredits.ts",
  );
  const scene = new THREE.Scene();
  const remembrance = createFinaleRemembrance(scene, new THREE.PerspectiveCamera());
  t.after(() => remembrance.dispose());
  await remembrance.ready;
  const cast = remembrance.getCreditsCast();
  assert.deepEqual(cast.map((actor) => actor.name), ["Branden", "Brendan"]);
  const materials = (model) => {
    const result = [];
    model.traverse((node) => {
      if (node.isMesh) result.push(...(Array.isArray(node.material) ? node.material : [node.material]));
    });
    return result;
  };
  const bodyVertices = (model) => {
    const counts = [];
    model.traverse((node) => {
      if (node.isSkinnedMesh) counts.push(node.geometry.getAttribute("position").count);
    });
    return counts;
  };
  assert.notDeepEqual(bodyVertices(cast[0].model), bodyVertices(cast[1].model),
    "Branden is not a second copy of Brendan");
  const originalColors = cast.map((actor) =>
    materials(actor.model).map((material) => material.color.clone()));
  remembrance.update("victory", 8, new THREE.Group());
  for (const [index, actor] of cast.entries()) {
    const ghost = scene.getObjectByName(`MemoryOf${actor.name}`);
    assert.ok(materials(ghost).some((material) => material.transparent && material.opacity < 1));
    materials(actor.model).forEach((material, materialIndex) => {
      assert.equal(material.opacity, 1);
      assert.ok(material.color.equals(originalColors[index][materialIndex]));
      assert.ok(!materials(ghost).includes(material));
    });
  }
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...cast[index % 2],
    outcome: "kneel",
  }));
  const credits = createFinaleCredits(sources, false);
  t.after(() => credits.dispose());
  let creditsScene;
  credits.render({
    autoClear: false,
    getSize: (target) => target.set(1280, 720),
    getRenderTarget: () => null,
    setRenderTarget() {},
    render(rendered) { creditsScene = rendered; },
  }, 3);
  const performers = creditsScene.children;
  assert.equal(performers.length, 8);
  for (const [index, actor] of performers.entries()) {
    const sourceMaterials = materials(cast[index % 2].model);
    materials(actor).forEach((material, materialIndex) => {
      const original = sourceMaterials[materialIndex];
      const expected = original.emissive?.getHex() ? original.emissive : original.color;
      assert.ok(material.color.equals(expected));
      assert.equal(material.opacity, 1);
      assert.equal(material.transparent, false);
    });
  }
});

test("arcade selection includes named headshots for all three characters and shares title styling", async () => {
  const [html, css, prologue] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/main.css", import.meta.url), "utf8"),
    readFile(new URL("../src/scenes/prologue/prologue_scene_1.ts", import.meta.url), "utf8"),
  ]);
  for (const character of ["brondon", "brendan", "branden"]) {
    assert.ok(html.includes(`data-character="${character}"`));
    assert.ok(html.includes(`data-character-portrait="${character}"`));
  }
  assert.match(css, /\.menu-title-main,\s*\.menu-title-kicker\s*\{[^}]*linear-gradient/s);
  assert.ok(html.includes('data-text="A TALE OF VENGEANCE"'));
  assert.ok(prologue.includes('data-text="A TALE OF VENGEANCE"'));
});

test("the finisher runs in the requested order and reaches victory at 30, 60 and 144 fps", () => {
  assert.deepEqual(
    choreography.FINISHER_BEATS.map((beat) => beat.shot),
    [
      "evade",
      "parry",
      "countershot",
      "clash",
      "armCut",
      "ascend",
      "reactor",
      "finalCut",
    ],
  );
  for (const fps of [30, 60, 144]) {
    const director = createFinaleDirector("finisher");
    director.assetsLoaded();
    let frames = 0;
    while (director.getState().phase === "finisher" && frames < fps * 35) {
      director.update(1 / fps);
      frames++;
    }
    assert.equal(director.getState().phase, "victory");
    assert.ok(
      Math.abs(frames / fps - choreography.FINISHER_DURATION) <= 1 / fps + 1e-7,
    );
    assert.equal(director.duel.getState().phase, "won");
  }
});

test("visible cinematics autoplay without canvas focus but deliberate and hidden-tab pauses remain", () => {
  for (const phase of ["reveal", "finisher", "victory", "credits"]) {
    assert.equal(
      shouldPauseFinale(phase, {
        menuPaused: false,
        hidden: false,
        blurred: true,
      }),
      false,
    );
    assert.equal(
      shouldPauseFinale(phase, {
        menuPaused: true,
        hidden: false,
        blurred: false,
      }),
      true,
    );
    assert.equal(
      shouldPauseFinale(phase, {
        menuPaused: false,
        hidden: true,
        blurred: false,
      }),
      true,
    );
  }
  for (const phase of ["ground", "space"]) {
    assert.equal(
      shouldPauseFinale(phase, {
        menuPaused: false,
        hidden: false,
        blurred: true,
      }),
      true,
    );
  }
});

test("each student confession has a complete reveal shot before Brondon answers them", () => {
  const { FINALE_REVEAL, STUDENT_TIMELINE, activeStudent } = choreography;
  assert.equal(STUDENT_TIMELINE.length, 5);
  assert.equal(STUDENT_TIMELINE[0].reveal.start, FINALE_REVEAL.studentStart);
  assert.equal(STUDENT_TIMELINE.at(-1).reveal.end, FINALE_REVEAL.studentEnd);
  STUDENT_TIMELINE.forEach((student, index) => {
    assert.ok(student.reveal.end - student.reveal.start >= 5);
    assert.equal(
      activeStudent((student.reveal.start + student.reveal.end) / 2, "reveal"),
      index,
    );
    if (index > 0)
      assert.equal(
        student.reveal.start,
        STUDENT_TIMELINE[index - 1].reveal.end,
      );
  });
  assert.ok(FINALE_REVEAL.end - FINALE_REVEAL.studentEnd >= 25);

  const director = createFinaleDirector("reveal");
  director.assetsLoaded();
  let elapsed = 0;
  while (
    director.getState().phase === "reveal" &&
    elapsed < FINALE_REVEAL.end + 1
  ) {
    director.update(1 / 60);
    elapsed += 1 / 60;
  }
  assert.equal(director.getState().phase, "enemyTransform");
  assert.ok(Math.abs(elapsed - FINALE_REVEAL.end) <= 1 / 60 + 1e-7);
});

test("the visible mechs keep body clearance, including the vanishing approach", () => {
  for (let time = 0; time < choreography.FINISHER_DURATION; time += 1 / 120) {
    const sample = choreography.sampleFinisherSequence(time);
    if (!sample.heroVisible || sample.heroDissolve > 0.7) continue;
    const distance = Math.hypot(
      ...sample.hero.map((value, axis) => value - sample.enemy[axis]),
    );
    assert.ok(
      distance > 9,
      `${sample.beat.id} at ${sample.clock}: body clearance ${distance}`,
    );
    assert.ok(
      [
        ...sample.hero,
        ...sample.enemy,
        sample.heroRoll,
        sample.enemyRoll,
      ].every(Number.isFinite),
    );
  }
});

test("the dance has its own screen time and the mothership brakes into a matching final heading", () => {
  const { DONUS_RETURN, sampleMothershipArrival } = choreography;
  assert.ok(DONUS_RETURN.appear - DONUS_RETURN.dance >= 4);
  const initial = sampleMothershipArrival(DONUS_RETURN.appear),
    parked = sampleMothershipArrival(DONUS_RETURN.arrival);
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
    assert.ok(
      Math.abs(incoming - outgoing) < 0.002,
      `arrival velocity axis ${axis}`,
    );
  }
});

test("the extended blade lock has three distinct close-ups and the cut follows behind the sword arm", () => {
  const hero = new THREE.Group(),
    enemy = new THREE.Group();
  hero.position.copy(world.finaleBattlePoint(-6, 0, world.SPACE_ALTITUDE));
  hero.rotation.y = world.FINALE_BATTLE_YAW;
  enemy.position.copy(world.finaleBattlePoint(6, 0, world.SPACE_ALTITUDE));
  enemy.rotation.y = world.FINALE_BATTLE_YAW + Math.PI;
  const heroChest = hero.position.clone().add(new THREE.Vector3(0, 11, 0));
  const enemyChest = enemy.position.clone().add(new THREE.Vector3(0, 11, 0));
  const heroFace = hero.position.clone().add(new THREE.Vector3(0, 15, 0));
  const enemyFace = enemy.position.clone().add(new THREE.Vector3(0, 15, 0));
  const heroShoulder = hero.position.clone().add(new THREE.Vector3(0, 12, 2));
  const clash = heroChest
    .clone()
    .lerp(enemyChest, 0.5)
    .add(new THREE.Vector3(0, 1.6, 2.2));
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.08, 5200),
    rig = createFinaleCamera(camera, false);
  const context = {
    phase: "finisher",
    phaseTime: 0,
    time: 0,
    space: true,
    hero,
    enemy,
    heroChest,
    enemyChest,
    heroFace,
    enemyFace,
    heroShoulder,
    clash,
    human: new THREE.Vector3(),
    students: [],
    boy: new THREE.Vector3(),
    pilotFace: new THREE.Vector3(),
    pilotCamera: new THREE.Vector3(),
    ship: new THREE.Group(),
    mothership: new THREE.Group(),
    bomb: new THREE.Vector3(),
    heroMuzzle: heroChest,
    enemyMuzzle: enemyChest,
    heroBladeBase: clash,
    heroBladeTip: clash,
    enemyBladeTip: clash,
    special: null,
  };
  const shot = choreography.FINISHER_TIMELINE.find(
    (shot) => shot.beat.shot === "clash",
  );
  assert.ok(shot.beat.duration >= 4);
  for (const [clock, focus] of [
    [1.2, clash],
    [2.2, heroFace],
    [3, enemyFace],
  ]) {
    rig.update(
      {
        ...context,
        finisher: choreography.sampleFinisherSequence(shot.start + clock),
      },
      0,
    );
    const expected = focus.clone().sub(camera.position).normalize();
    assert.ok(
      camera.getWorldDirection(new THREE.Vector3()).dot(expected) > 0.999,
    );
    assert.ok(camera.position.distanceTo(focus) < 14);
  }
  const cut = choreography.FINISHER_TIMELINE.find(
    (shot) => shot.beat.shot === "armCut",
  );
  rig.update(
    {
      ...context,
      finisher: choreography.sampleFinisherSequence(cut.start + 0.5),
    },
    0,
  );
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(hero.quaternion);
  assert.ok(camera.position.clone().sub(heroShoulder).dot(forward) < -5);
  assert.ok(camera.position.distanceTo(heroShoulder) < 7);
});

test("each execution slash produces a finite physical recoil before the enemy collapses", () => {
  const beat = choreography.FINISHER_BEATS.at(-1),
    timing = choreography.FINISHER_EXECUTION;
  const interval = (timing.lastCut - timing.cuts) / timing.slashes;
  for (let strike = 0; strike < timing.slashes; strike++) {
    const contact = timing.cuts + strike * interval;
    const reaction = choreography.sampleFinisher(
      beat,
      contact + interval * 0.5,
    );
    const recovery = choreography.sampleFinisher(beat, contact);
    assert.ok(reaction.enemyPitch < -0.05);
    assert.ok(Math.abs(reaction.enemy[2] - recovery.enemy[2]) > 0.2);
    assert.ok(
      [...reaction.enemy, reaction.enemyPitch, reaction.enemyRoll].every(
        Number.isFinite,
      ),
    );
  }
  assert.equal(
    choreography.sampleFinisher(beat, timing.collapse + 0.2).enemyPose,
    "defeat",
  );
});

async function mech(t, side) {
  const buffer = await readFile(
    new URL(
      `../src/assets/models/${side === "hero" ? "MC" : "Subject"}.glb`,
      import.meta.url,
    ),
  );
  const loader = new GLTFLoader();
  const asset = await loader.parseAsync(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
    "",
  );
  const actor = createFinaleMech(side, async () => asset);
  t.after(() => actor.dispose());
  await actor.loaded;
  return actor;
}

function bladeDistance(first, second) {
  const ab = first.tip.clone().sub(first.base),
    cd = second.tip.clone().sub(second.base),
    delta = first.base.clone().sub(second.base);
  const a = ab.dot(ab),
    b = ab.dot(cd),
    c = cd.dot(cd),
    d = ab.dot(delta),
    e = cd.dot(delta);
  const denominator = a * c - b * b;
  let s =
    denominator > 1e-9
      ? THREE.MathUtils.clamp((b * e - c * d) / denominator, 0, 1)
      : 0;
  let t = (b * s + e) / c;
  if (t < 0) {
    t = 0;
    s = THREE.MathUtils.clamp(-d / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = THREE.MathUtils.clamp((b - d) / a, 0, 1);
  }
  return first.base
    .clone()
    .addScaledVector(ab, s)
    .distanceTo(second.base.clone().addScaledVector(cd, t));
}

test("the real MC and Subject rigs meet at separated blade surfaces with weapons still in their hands", async (t) => {
  const hero = await mech(t, "hero"),
    enemy = await mech(t, "enemy");
  for (const shot of choreography.FINISHER_TIMELINE.filter((shot) =>
    ["parry", "clash"].includes(shot.beat.shot),
  )) {
    for (let clock = 0; clock < shot.beat.duration; clock += 1 / 60) {
      const sample = choreography.sampleFinisherSequence(shot.start + clock);
      for (const [actor, side] of [
        [hero, "hero"],
        [enemy, "enemy"],
      ]) {
        actor.root.position.copy(
          world.finaleBattlePoint(
            sample[side][0],
            sample[side][1],
            world.SPACE_ALTITUDE,
          ),
        );
        actor.root.position.z += sample[side][2];
        actor.root.rotation.set(
          0,
          world.FINALE_BATTLE_YAW + (side === "enemy" ? Math.PI : 0),
          sample[`${side}Roll`],
        );
        const move = sample[`${side}Pose`],
          duration = choreography.MELEE_STRIKES[move]?.duration ?? 1;
        actor.pose(
          move,
          sample[`${side}PoseProgress`] * duration,
          duration,
          true,
          0,
          shot.start + clock,
          true,
          shot.beat.id,
        );
      }
      const contact = hero
        .getChest()
        .lerp(enemy.getChest(), 0.5)
        .add(new THREE.Vector3(0, 1.6, 2.2));
      if (sample.bladeLock > 0) {
        hero.lockBlade(contact, 1, 0, sample.bladeLock);
        enemy.lockBlade(contact, -1, 0, sample.bladeLock);
      }
      if (sample.bladeLock < 0.99) continue;
      const distance = bladeDistance(hero.getBlade(), enemy.getBlade());
      assert.ok(
        distance >= 0.3 && distance < 0.8,
        `${shot.beat.id} at ${clock}: blade spacing ${distance}`,
      );
      for (const actor of [hero, enemy]) {
        assert.ok(
          actor
            .getHand("right")
            .distanceTo(actor.sword.getWorldPosition(new THREE.Vector3())) <
            1.3,
          "the contact solver must move the arm, not detach the weapon",
        );
      }
    }
  }
});

test("the finale site preserves the roof and rescue positions without constructing the traversal level", async (t) => {
  const site = createFinaleSite();
  t.after(() => site.dispose());
  await site.ready;
  const size = new THREE.Box3()
    .setFromObject(site.facilityRoof)
    .getSize(new THREE.Vector3());
  assert.equal(size.x, world.FINALE_ROOFTOP.width);
  assert.equal(size.z, world.FINALE_ROOFTOP.depth);
  function instances(prefix) {
    let count = 0;
    site.scene.traverse((node) => {
      if (node.isInstancedMesh && node.name.startsWith(prefix))
        count += node.count;
    });

    return count;
  }
  assert.equal(instances("FinaleBackdropTrunks/"), 320);
  assert.equal(instances("FinaleBackdropCanopy/"), 320 * 129);
  assert.equal(instances("FinaleDistantCanopy/"), 320 * 43);
  assert.ok(instances("FinaleGroundGrass/") > 0);
  assert.ok(site.scene.getObjectByName("FallingPinecones"));
  assert.equal(
    site.scene.getObjectByName("ImpassableWesternMountain"),
    undefined,
  );
  assert.equal(
    site.scene.getObjectByName("FacilityShipSentinelLeft"),
    undefined,
  );
  assert.ok(
    site.ship.root.position.distanceTo(new THREE.Vector3(-74, 0.65, 87)) < 1e-8,
  );
  assert.ok(
    site.boy.position.distanceTo(new THREE.Vector3(-61.8, 0, 85.4)) < 1e-8,
  );
});

test("shared dome architecture has four supports, a real roof opening and a flush actor-carrying lift", async (t) => {
  const site = createFinaleSite(),
    { FACILITY, FACILITY_ROOF_SEQUENCE, sampleFacilityLift } = architecture;
  t.after(() => site.dispose());
  await site.ready;
  const supports = site.scene.getObjectByName("FacilityFourRoofPillars");
  assert.equal(supports.children.length, 4);
  assert.equal(
    site.scene.getObjectByName("FacilityRooftopEquipment"),
    undefined,
  );
  assert.equal(site.scene.getObjectByName("FacilitySummitWalls"), undefined);
  assert.ok(site.scene.getObjectByName("FacilityExteriorDoor"));
  const shell = site.scene.getObjectByName("FacilityDomePermanentShell");
  assert.equal(shell.geometry.parameters.radius, FACILITY.radius);
  const windows = site.facilityDome.children.filter(
    (child) => child.name === "FacilityExteriorRoundWindow",
  );
  assert.equal(windows.length, 6);
  assert.equal(world.FINALE_DECK_Y, world.FINALE_ROOFTOP.y);
  assert.ok(
    FACILITY_ROOF_SEQUENCE.transformStart > FACILITY_ROOF_SEQUENCE.liftEnd,
  );
  site.scene.updateMatrixWorld(true);
  const roofBounds = new THREE.Box3().setFromObject(site.facilityRoof);
  assert.ok(Math.abs(roofBounds.max.y - world.FINALE_DECK_Y) < 1e-5);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(FACILITY.x, FACILITY.roofY + 10, FACILITY.z),
    new THREE.Vector3(0, -1, 0),
  );
  assert.equal(
    ray.intersectObject(site.facilityRoof, false).length,
    0,
    "the rectangular roof must have a real circular aperture",
  );
  let previousY = FACILITY.officeFloor;
  for (let time = 0; time <= FACILITY_ROOF_SEQUENCE.liftEnd; time += 1 / 60) {
    const sample = site.updateRoofSequence(time);
    assert.ok(sample.y >= previousY - 1e-8);
    assert.equal(sample.y, sampleFacilityLift(time).y);
    previousY = sample.y;
    assert.ok(
      Math.abs(site.elevatorPlatform.position.y + 0.175 - sample.y) < 1e-8,
    );
    if (time < FACILITY_ROOF_SEQUENCE.liftStart)
      assert.equal(
        sample.y,
        FACILITY.officeFloor,
        "the cap clears before passengers start rising",
      );
    assert.equal(shell.visible, true, "the permanent dome is never removed");
  }
  site.updateRoofSequence(FACILITY_ROOF_SEQUENCE.liftEnd);
  assert.ok(
    Math.abs(site.elevatorPlatform.position.y + 0.175 - world.FINALE_DECK_Y) <
      1e-8,
  );
  assert.equal(site.scene.getObjectByName("FacilityDomeCutCap").visible, false);
  assert.equal(site.scene.getObjectByName("FacilityDeckCutCap").visible, false);
  for (const seat of office.FACILITY_OFFICE_SEATS)
    assert.ok(Math.hypot(seat.x, seat.z) < FACILITY.liftRadius - 1);
  assert.ok(Math.hypot(4.9, -3.5) < FACILITY.liftRadius - 1);
  assert.ok(
    6 < FACILITY.liftRadius - 1,
    "Brondon stays on the same lift as the students",
  );
});

test("the five student GLBs are self-contained and use their named cached models", async (t) => {
  const { loadStudentModel, MODEL_ASSET_URLS, STUDENT_MODEL_URLS } =
    await server.ssrLoadModule("/core/loader.ts");
  const hashes = new Set();
  for (const [index, name] of studentNames.entries()) {
    const bytes = await readFile(
      new URL(
        `../src/assets/models/${studentFiles[index]}.glb`,
        import.meta.url,
      ),
    );
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const json = JSON.parse(
      bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
    );
    assert.ok(json.buffers.every((buffer) => !buffer.uri));
    assert.ok(
      (json.images ?? []).every((image) => image.bufferView !== undefined),
    );
    hashes.add(
      await crypto.subtle
        .digest("SHA-256", bytes)
        .then((hash) => Buffer.from(hash).toString("hex")),
    );
    const asset = await loadStudentModel(name);
    const resources = (
      await server.ssrLoadModule("/scripts/level-3/finaleActors.ts")
    ).captureFinaleResources(asset.scene);
    t.after(() => resources.dispose());
    assert.equal(asset.scene.name, name);
    assert.equal(asset.scene.userData.preserveComicAppearance, true);
    assertStudentAppearance(asset.scene);
    assert.ok(MODEL_ASSET_URLS.includes(STUDENT_MODEL_URLS.get(name)));
    assert.ok(requestedAssets.has(`/assets/models/${studentFiles[index]}.glb`));
    for (const clip of [
      "Walk_Loop",
      "Idle_Loop",
      "Idle_Talking_Loop",
      "Sitting_Idle_Loop",
      "Sitting_Talking_Loop",
      "Sitting_Exit",
      "Dance_Loop",
    ])
      assert.ok(
        asset.animations.some((animation) => animation.name === clip),
        `${name}: ${clip}`,
      );
    let bodyVertices = 0;
    asset.scene.traverse((node) => {
      if (!node.isSkinnedMesh) return;
      bodyVertices += node.geometry.attributes.position.count;
      assert.equal(
        node.geometry.attributes.position.count,
        node.geometry.attributes.skinWeight.count,
      );
      assert.ok(node.skeleton.bones.some((bone) => bone.name === "pelvis"));
    });
    const expectedVertices = json.nodes
      .filter((node) => node.skin !== undefined)
      .flatMap((node) => json.meshes[node.mesh].primitives)
      .reduce(
        (sum, primitive) =>
          sum + json.accessors[primitive.attributes.POSITION].count,
        0,
      );
    assert.equal(
      bodyVertices,
      expectedVertices,
      "Retain every authored body vertex",
    );
  }
  assert.equal(hashes.size, 5, "Use five distinct supplied assets");
  await assert.rejects(
    loadStudentModel("Unknown"),
    /No student character model/,
  );
});

test("reloading a student returns independently disposable geometry, materials and bones", async (t) => {
  const { loadStudentModel } = await server.ssrLoadModule("/core/loader.ts");
  const { captureFinaleResources } = await server.ssrLoadModule(
    "/scripts/level-3/finaleActors.ts",
  );
  const first = await loadStudentModel("Caleb"),
    second = await loadStudentModel("Caleb");
  t.after(() => {
    captureFinaleResources(first.scene).dispose();
    captureFinaleResources(second.scene).dispose();
  });
  const meshes = (root) => {
    const result = [];
    root.traverse((node) => {
      if (node.isSkinnedMesh) result.push(node);
    });
    return result;
  };
  const a = meshes(first.scene),
    b = meshes(second.scene);
  assert.ok(a.length > 0);
  for (let index = 0; index < a.length; index++) {
    assert.notEqual(a[index].geometry, b[index].geometry);
    assert.notEqual(a[index].material, b[index].material);
    assert.notEqual(a[index].skeleton.bones[0], b[index].skeleton.bones[0]);
  }
});

test("Arcade selection and playable models include all five students with compatible combat animations", async (t) => {
  const {
    loadPlayableCharacterModel,
    PLAYABLE_CHARACTERS,
    PLAYABLE_CHARACTER_NAMES,
    isPlayableCharacter,
  } = await server.ssrLoadModule("/core/loader.ts");
  const { loadCombatAnimationsForRig } = await server.ssrLoadModule(
    "/core/combatAnimations.ts",
  );
  const { captureFinaleResources } = await server.ssrLoadModule(
    "/scripts/level-3/finaleActors.ts",
  );
  const html = await readFile(
    new URL("../src/index.html", import.meta.url),
    "utf8",
  );
  const cards = [
    ...html.matchAll(/class="character-card"[^>]*data-character="([^"]+)"/g),
  ].map((match) => match[1]);
  const portraits = [
    ...html.matchAll(/data-character-portrait="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.equal(PLAYABLE_CHARACTERS.length, 8);
  assert.deepEqual(new Set(cards), new Set(PLAYABLE_CHARACTERS));
  assert.deepEqual(new Set(portraits), new Set(PLAYABLE_CHARACTERS));
  assert.equal(isPlayableCharacter("missing"), false);
  assert.equal(isPlayableCharacter(undefined), false);
  assert.equal(isPlayableCharacter("toString"), false);
  for (const [index, id] of [
    "caleb",
    "husain",
    "andre",
    "sibusiso",
    "sohrab",
  ].entries()) {
    assert.equal(isPlayableCharacter(id), true);
    assert.equal(PLAYABLE_CHARACTER_NAMES[id], studentNames[index]);
    const asset = await loadPlayableCharacterModel(id);
    t.after(() => captureFinaleResources(asset.scene).dispose());
    assertStudentAppearance(asset.scene);
    const size = new THREE.Box3()
      .setFromObject(asset.scene)
      .getSize(new THREE.Vector3());
    assert.ok(
      Math.abs(size.y - 1.83) < 0.001,
      `${id} must retain the gameplay height; got ${size.y}`,
    );
    const clips = await loadCombatAnimationsForRig(asset.scene);
    assert.ok(clips.length > 0, `${id} must match the baked combat rig`);
    const mixer = new THREE.AnimationMixer(asset.scene);
    t.after(() => {
      mixer.stopAllAction();
      mixer.uncacheRoot(asset.scene);
    });
    for (const name of [
      "Sword_Attack",
      "Sword_Block",
      "Punch_Jab",
      "Punch_Cross",
      "Melee_Hook_WithRecovery",
      "Slide_Tackle",
    ]) {
      const clip = clips.find((clip) => clip.name === name);
      assert.ok(clip, `${id} requires ${name}`);
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      mixer.setTime(clip.duration * 0.5);
      asset.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(asset.scene);
      assert.ok(
        [...bounds.min.toArray(), ...bounds.max.toArray()].every(
          Number.isFinite,
        ),
      );
    }
  }
});

test("the facility office seats all five named student models by default", async (t) => {
  const { createScenePhysics } = await server.ssrLoadModule(
    "/helpers/physics/scenePhysics.ts",
  );
  const scene = new THREE.Scene();
  const room = office.createFacilityOffice(scene, createScenePhysics());
  t.after(() => room.dispose());
  await room.ready;
  for (const [index, name] of studentNames.entries()) {
    const actor = room.root.children.find((child) => child.name === name);
    assert.ok(actor, `${name} must appear in the facility`);
    const model = actor.children[0].children[0];
    assert.equal(model.name, name);
    assert.equal(actor.position.x, office.FACILITY_OFFICE_SEATS[index].x);
    assert.equal(actor.position.z, office.FACILITY_OFFICE_SEATS[index].z);
    const bones = [];
    model.traverse((node) => {
      if (node.isBone) bones.push(node);
    });
    const before = bones.map((bone) => bone.quaternion.clone());
    room.update(0.5, false);
    assert.ok(
      bones.every((bone) => bone.quaternion.toArray().every(Number.isFinite)),
    );
    assert.ok(
      bones.some(
        (bone, boneIndex) =>
          before[boneIndex].angleTo(bone.quaternion) > 0.00001,
      ),
      `${name} must remain animated`,
    );
  }
});

test("finale and credits retain each student's model and individual animation clips", async (t) => {
  const actors = createFinaleStudents();
  t.after(() => actors.dispose());
  await actors.loaded;
  const cast = actors.getCreditsCast();
  assert.deepEqual(
    cast.map((student) => student.name),
    studentNames,
  );
  for (const [index, student] of actors.students.entries()) {
    assert.equal(student.model.name, studentNames[index]);
    assert.deepEqual(
      student.root.children,
      [student.wrapper],
      "Students display their animated model without floating diamond badges",
    );
    assert.equal(cast[index].model, student.model);
    assert.equal(cast[index].animations, student.animations);
    if (index > 0) assert.notEqual(cast[index].animations, cast[0].animations);
    for (const mode of [
      "sit",
      "stand",
      "walk",
      "idle",
      "talk",
      "pose",
      "board",
    ]) {
      actors.animate(index, mode, 0.4);
      student.model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(student.model);
      assert.ok(
        bounds.min.toArray().every(Number.isFinite),
        `${studentNames[index]} ${mode}`,
      );
      assert.ok(
        bounds.max.toArray().every(Number.isFinite),
        `${studentNames[index]} ${mode}`,
      );
    }
  }
});

test("student load failures release the other successfully loaded cast members", async () => {
  const { loadStudentModel } = await server.ssrLoadModule("/core/loader.ts");
  let geometryCount = 0,
    disposedCount = 0;
  const actors = createFinaleStudents(async (name) => {
    if (name === "Husain") throw new Error("Husain test load failed");
    const asset = await loadStudentModel(name);
    const geometries = new Set();
    asset.scene.traverse((node) => {
      if (node.isMesh) geometries.add(node.geometry);
    });
    for (const geometry of geometries) {
      geometryCount++;
      geometry.addEventListener("dispose", () => disposedCount++);
    }
    return asset;
  });
  await assert.rejects(actors.loaded, /Husain test load failed/);
  assert.ok(geometryCount > 0);
  assert.equal(disposedCount, geometryCount);
  actors.dispose();
});

test("credits and the final dance use the cleaned student models with Brondon's cel shadows", async (t) => {
  const { loadPlayerModel, loadBrandenModel, loadBrendanModel } =
    await server.ssrLoadModule("/core/loader.ts");
  const { captureFinaleResources } = await server.ssrLoadModule(
    "/scripts/level-3/finaleActors.ts",
  );
  const { createFinaleCredits } = await server.ssrLoadModule(
    "/scripts/level-3/finaleCredits.ts",
  );
  const { FINALE_CREDITS } = await server.ssrLoadModule(
    "/scripts/global/finaleDirector.ts",
  );
  const actors = createFinaleStudents();
  t.after(() => actors.dispose());
  const others = await Promise.all([
    loadPlayerModel(),
    loadBrandenModel(),
    loadBrendanModel(),
  ]);
  for (const asset of others)
    t.after(() => captureFinaleResources(asset.scene).dispose());
  await actors.loaded;
  const sources = [
    ...others.map((asset, index) => ({
      name: ["Brondon", "Branden", "Brendan"][index],
      model: asset.scene,
      animations: asset.animations,
      outcome: "winner",
    })),
    ...actors.getCreditsCast().map((source) => ({
      ...source,
      outcome: "fall",
    })),
  ];
  const credits = createFinaleCredits(sources, false);
  t.after(() => credits.dispose());
  let renderedScene;
  const renderer = {
    autoClear: false,
    getSize: (target) => target.set(1280, 720),
    getRenderTarget: () => null,
    setRenderTarget() {},
    render(scene) {
      renderedScene = scene;
    },
  };
  const poses = [];
  for (const time of [
    3,
    FINALE_CREDITS.roll + FINALE_CREDITS.walkIn * 0.5,
    FINALE_CREDITS.roll + FINALE_CREDITS.walkIn + 0.4,
    FINALE_CREDITS.roll + FINALE_CREDITS.walkIn + 0.9,
  ]) {
    credits.render(renderer, time);
    const frame = [];
    for (const name of studentNames) {
      const performer = renderedScene.getObjectByName(`Credits_${name}`);
      assert.ok(
        performer,
        `${name} must appear throughout credits and the final dance`,
      );
      assertStudentAppearance(performer);
      performer.traverse((node) => {
        if (node.isSkinnedMesh) {
          assert.equal(node.material.opacity, 1);
          assert.equal(node.material.transparent, false);
        }
      });
      frame.push(performer.getObjectByName("upperarm_l").quaternion.clone());
    }
    poses.push(frame);
  }
  for (const [index, name] of studentNames.entries())
    assert.ok(
      poses[2][index].angleTo(poses[3][index]) > 0.001,
      `${name}'s final dance must animate the new model`,
    );
});

test("finale students reuse the real office chairs, seated contact and authored stand-up clip", async (t) => {
  const actors = createFinaleStudents();
  t.after(() => actors.dispose());
  await actors.loaded;
  assert.equal(actors.students.length, 5);
  for (const [index, student] of actors.students.entries()) {
    const seat = office.FACILITY_OFFICE_SEATS[index],
      chair = actors.furniture.getObjectByName(
        `FacilityOfficeChair${index + 1}`,
      );
    assert.ok(chair);
    assert.equal(student.root.position.x, seat.x);
    assert.equal(student.root.position.z, seat.z);
    assert.equal(student.root.rotation.y, seat.yaw);
    actors.animate(index, "sit", index * 0.2);
    actors.root.updateMatrixWorld(true);
    const pelvis = student.model
      .getObjectByName("pelvis")
      .getWorldPosition(new THREE.Vector3());
    const contact = new THREE.Raycaster(
      pelvis,
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(chair, true)[0];
    assert.ok(
      contact,
      `${studentNames[index]} must sit above the chair cushion`,
    );
    assert.ok(pelvis.y - contact.point.y < 0.3);
    let footY = Infinity;
    student.model.traverse((node) => {
      if (!node.isSkinnedMesh) return;
      node.skeleton.update();
      const { position, skinIndex, skinWeight } = node.geometry.attributes;
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
        let weight = 0;
        for (let component = 0; component < 4; component++)
          if (
            /foot|ball|toe/i.test(
              node.skeleton.bones[
                skinIndex.getComponent(vertexIndex, component)
              ].name,
            )
          )
            weight += skinWeight.getComponent(vertexIndex, component);
        if (weight < 0.6) continue;
        const vertex = node.getVertexPosition(vertexIndex, new THREE.Vector3());
        footY = Math.min(footY, node.localToWorld(vertex).y);
      }
    });
    assert.ok(
      Math.abs(footY - office.FACILITY_OFFICE.floor) < 0.015,
      `${studentNames[index]}'s seated feet must rest on the floor`,
    );
    const stand = student.actions.stand.getClip();
    assert.equal(stand.name, "Sitting_Exit");
    actors.animate(index, "stand", stand.duration);
    assert.equal(student.wrapper.position.y, student.standingY);
  }
});

test("the facility reveal and rooftop duel never render an Earth atmosphere", (t) => {
  const scene = new THREE.Scene(),
    environment = world.createFinaleWorld(scene, {
      renderer: createBakeRenderer(),
    });
  t.after(() => environment.dispose());
  const earth = environment.root.getObjectByName("Earth");
  for (const roofTime of [-1, 0, 2.5, 5, 10]) {
    environment.update(10, 0, false, 5, roofTime, -1, 0);
    assert.equal(earth.visible, false);
    assert.equal(earth.atmosphere.visible, false);
  }
  environment.update(20, 0, true, 5, 5, -1, 0);
  assert.equal(earth.visible, false);
  assert.equal(earth.atmosphere.visible, false);
});

test("the shared starfield bakes once, restores renderer state and fades without rebaking", (t) => {
  const scene = new THREE.Scene(),
    renderer = createBakeRenderer(),
    originalTarget = new THREE.WebGLRenderTarget(4, 4);
  renderer.setRenderTarget(originalTarget);
  const starfield = createStarfield({ scene, renderer, starCount: 16 });
  t.after(() => originalTarget.dispose());
  assert.equal(renderer.targets.length, 4);
  assert.ok(renderer.targets.every((target) => !target.depthBuffer));
  assert.equal(renderer.getRenderTarget(), originalTarget);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.getClearColor(new THREE.Color()).getHex(), 0x123456);
  assert.equal(renderer.getClearAlpha(), 0.6);
  const baseOpacities = starfield.starLayers.map(
    (layer) => layer.material.uniforms.uOpacity.value,
  );
  starfield.setOpacity(0.5);
  assert.equal(starfield.nebulaCubes[0].material.uniforms.uOpacity.value, 0.5);
  starfield.starLayers.forEach((layer, index) => {
    assert.equal(
      layer.material.uniforms.uOpacity.value,
      baseOpacities[index] * 0.5,
    );
  });
  starfield.setOpacity(0);
  assert.ok(scene.children.every((node) => !node.visible));
  starfield.setOpacity(1);
  assert.ok(scene.children.every((node) => node.visible));
  assert.deepEqual(
    starfield.starLayers.map((layer) => layer.material.uniforms.uOpacity.value),
    baseOpacities,
  );
  assert.throws(() => starfield.setOpacity(NaN), RangeError);
  for (let frame = 0; frame < 144; frame++) starfield.update(frame / 144);
  assert.equal(renderer.targets.length, 4);
  let disposedTargets = 0;
  for (const target of renderer.targets)
    target.addEventListener("dispose", () => disposedTargets++);
  starfield.dispose();
  assert.equal(disposedTargets, 4);
  assert.equal(scene.children.length, 0);
});

test("impact cuts to Brendan before returning to a readable burning Earth and stardust burst", () => {
  const timing = choreography.PLANET_RUPTURE;
  assert.ok(timing.forest > timing.impact);
  assert.ok(timing.forest - timing.impact <= 0.4);
  assert.equal(timing.forestEnd, timing.burning);
  assert.ok(timing.burst - timing.burning >= 2.5);
  assert.ok(timing.stardustEnd - timing.burst >= 4);
  assert.equal(timing.cockpit, timing.stardustEnd);
  assert.ok(timing.cockpit < timing.resolve);
  assert.ok(timing.resolve < timing.returnToDuel);
  for (const fps of [30, 60, 144]) {
    const director = createFinaleDirector("rupture"),
      cues = [];
    director.assetsLoaded();
    for (
      let frame = 0;
      frame < fps * (timing.orbit + 1) &&
      director.getState().phase === "rupture";
      frame++
    ) {
      director.update(1 / fps);
      cues.push(...director.drainCues().map((cue) => cue.id));
    }
    assert.equal(director.getState().phase, "space");
    assert.deepEqual(cues, [
      "planet-breaker",
      "escape-boost",
      "world-crack",
      "forest-aftermath",
      "planet-burst",
      "brondon-grief",
      "orbit-lock",
    ]);
  }
});

test("the planet shots use location cuts around Brendan rather than flying through the clearing", () => {
  const timing = choreography.PLANET_RUPTURE,
    camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.08, 5200),
    rig = createFinaleCamera(camera, false),
    boy = new THREE.Vector3(-61.8, 1.5, 85.4),
    pilotCamera = new THREE.Vector3(0, 130, -65);
  const context = {
    phase: "rupture",
    phaseTime: timing.impact,
    time: timing.impact,
    hero: new THREE.Group(),
    enemy: new THREE.Group(),
    boy,
    pilotCamera,
    pilotFace: pilotCamera.clone().add(new THREE.Vector3(0, 0, -1)),
  };
  rig.update(context, 0);
  assert.ok(camera.position.distanceTo(world.PLANET_CENTER) > 1000);
  rig.update({ ...context, phaseTime: timing.forest }, 0);
  assert.ok(camera.position.distanceTo(boy) < 6);
  rig.update({ ...context, phaseTime: timing.burning }, 0);
  assert.ok(camera.position.distanceTo(world.PLANET_CENTER) > 1000);
  assert.ok(camera.position.distanceTo(boy) > 1000);
  rig.update({ ...context, phaseTime: timing.burst + 0.5 }, 1);
  const towardEarth = world.PLANET_CENTER.clone()
    .sub(camera.position)
    .normalize();
  assert.ok(
    camera.getWorldDirection(new THREE.Vector3()).dot(towardEarth) > 0.999,
  );
  rig.update({ ...context, phaseTime: timing.cockpit }, 0);
  assert.ok(camera.position.distanceTo(pilotCamera) < 1e-8);
});

test("impact dissolves all textured crust and leaves an opaque solar fire surface until the burst", (t) => {
  const scene = new THREE.Scene(),
    environment = world.createFinaleWorld(scene, {
      renderer: createBakeRenderer(),
    });
  t.after(() => environment.dispose());
  const timing = choreography.PLANET_RUPTURE,
    earth = environment.root.getObjectByName("Earth");
  const fire = environment.root.getObjectByName("EarthBurningSurface");
  const before = choreography.samplePlanetSurface(timing.impact - 0.01);
  assert.equal(before.dissolve, 0);
  assert.equal(before.fireVisible, false);
  environment.update(
    timing.impact + 0.6,
    0.2,
    false,
    4,
    3,
    timing.impact + 0.6,
    1,
  );
  assert.equal(earth.surface.visible, true);
  assert.equal(fire.visible, true);
  assert.ok(choreography.samplePlanetSurface(timing.impact + 0.6).dissolve > 0);
  environment.update(timing.burning, 0.5, false, 4, 3, timing.burning, 1);
  assert.equal(earth.visible, true);
  assert.equal(earth.surface.visible, false);
  assert.equal(earth.clouds.visible, false);
  assert.equal(earth.atmosphere.visible, false);
  assert.equal(fire.visible, true);
  assert.equal(fire.material.transparent, false);
  assert.equal(fire.material.blending, THREE.NormalBlending);
  environment.update(timing.burst + 1.3, 1, false, 4, 3, timing.burst + 1.3, 1);
  assert.equal(fire.visible, false);
  assert.equal(environment.root.getObjectByName("EarthStardust").visible, true);
});

test("impact-only rubble disperses outward while one static GPU dust buffer reveals the starfield", (t) => {
  const scene = new THREE.Scene(),
    renderer = createBakeRenderer(),
    environment = world.createFinaleWorld(scene, { renderer }),
    timing = choreography.PLANET_RUPTURE;
  const debris = environment.root.getObjectByName("EarthRockDebris"),
    dust = environment.root.getObjectByName("EarthStardust"),
    sky = environment.root.getObjectByName("FinaleSpaceSky"),
    shell = sky.getObjectByName("NebulaShell");
  let disposedDust = 0;
  dust.geometry.addEventListener("dispose", () => disposedDust++);
  t.after(() => {
    environment.dispose();
    assert.equal(disposedDust, 1);
    assert.equal(scene.getObjectByName("RescueSiteSummitAndOrbit"), undefined);
    assert.equal(sky.children.length, 0);
  });
  assert.equal(debris.count, 48);
  assert.equal(dust.geometry.getAttribute("position").count, 1600);
  assert.equal(debris.instanceMatrix.usage, THREE.DynamicDrawUsage);
  const layers = sky.children.filter((node) => node.isPoints);
  assert.equal(layers.length, 4);
  assert.equal(
    layers.reduce(
      (sum, layer) => sum + layer.geometry.getAttribute("position").count,
      0,
    ),
    1560,
  );
  for (const layer of layers) {
    const positions = layer.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const radius = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .length();
      assert.ok(Math.abs(radius - 3000) < 0.001);
    }
  }
  const positions = dust.geometry.getAttribute("position"),
    initialPositions = positions.array.slice(),
    initialVersion = positions.version,
    matrix = new THREE.Matrix4();
  function update(time) {
    environment.update(time, 1, false, 4, 3, time, 1);
  }
  update(timing.impact);
  assert.equal(debris.visible, false);
  assert.equal(dust.visible, false);
  update(timing.burst + 0.2);
  assert.equal(debris.visible, true);
  assert.equal(dust.visible, true);
  debris.getMatrixAt(0, matrix);
  const initialRadius = new THREE.Vector3()
    .setFromMatrixPosition(matrix)
    .distanceTo(world.PLANET_CENTER);
  assert.ok(initialRadius > world.PLANET_RADIUS);
  update(timing.burst + 1.2);
  debris.getMatrixAt(0, matrix);
  assert.ok(
    new THREE.Vector3()
      .setFromMatrixPosition(matrix)
      .distanceTo(world.PLANET_CENTER) >
      initialRadius + 100,
  );
  assert.ok(debris.material.opacity < 1);
  assert.equal(shell.material.uniforms.uOpacity.value, 1);
  update(timing.burst + 3);
  assert.equal(debris.visible, false);
  assert.equal(dust.visible, true);
  update(timing.stardustEnd);
  assert.equal(dust.visible, false);
  assert.equal(environment.planetRoot.visible, false);
  for (let frame = 0; frame < 120; frame++)
    environment.update(40 + frame / 60, 1, true, 4, 3, -1, 1);
  assert.equal(debris.visible, false);
  assert.equal(dust.visible, false);
  assert.equal(environment.planetRoot.visible, false);
  assert.ok(sky.children.every((node) => node.visible));
  assert.deepEqual(positions.array, initialPositions);
  assert.equal(positions.version, initialVersion);
  assert.equal(renderer.targets.length, 4);
});

test("Brendan drops to his knees then finishes the authored death with the fire attached to his head", async (t) => {
  const site = createFinaleSite();
  await site.ready;
  const aftermath = createFinaleAftermath(
    site.scene,
    site.boy,
    site.ready,
    false,
    site.getBoyAnimations,
  );
  t.after(() => {
    aftermath.dispose();
    site.dispose();
  });
  await aftermath.ready;
  const hero = new THREE.Group(),
    timing = choreography.PLANET_RUPTURE;
  aftermath.update(timing.forest, timing.forest, hero);
  const standing = aftermath.getBoyFocus().y;
  aftermath.update(timing.scorch, timing.scorch, hero);
  const kneeling = aftermath.getBoyFocus().y;
  assert.ok(
    kneeling < standing - 0.35,
    `head height ${standing} -> ${kneeling}`,
  );
  aftermath.update(timing.forestEnd - 0.1, timing.forestEnd - 0.1, hero);
  const fallen = aftermath.getBoyFocus().y;
  assert.ok(fallen < kneeling - 0.25, `head height ${kneeling} -> ${fallen}`);
  assert.ok(fallen >= -0.05, "the authored fall must remain above the ground");
  const fire = site.boy.getObjectByName("BrendanHeadFire");
  assert.equal(fire.parent.name, "Head");
  assert.equal(fire.visible, true);
  assert.equal(
    site.boy.rotation.z,
    0,
    "do not rotate the entire standing rig sideways to fake a fall",
  );
  assert.equal(
    choreography.samplePlanetAftermath(timing.cockpit).forest,
    false,
  );
});

test("the finale warmup compiles and renders once, retaining fog and restoring hidden objects", async () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  scene.fog = new THREE.Fog(0x263138, 55, 230);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.visible = false;
  scene.add(mesh);
  let compiles = 0,
    renders = 0;
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace,
    initTexture() {},
    getRenderTarget: () => null,
    getViewport: (target) => target.set(0, 0, 640, 480),
    getScissor: (target) => target.set(0, 0, 640, 480),
    getScissorTest: () => false,
    setRenderTarget() {},
    setScissorTest() {},
    setViewport() {},
    setScissor() {},
    compileAsync: async () => {
      compiles++;
    },
    render: () => {
      renders++;
    },
  };
  const fog = scene.fog;
  await prepareSceneRendering(renderer, scene, camera, { fogVariants: false });
  assert.equal(compiles, 1);
  assert.equal(renders, 1);
  assert.equal(scene.fog, fog);
  assert.equal(mesh.visible, false);
  assert.equal(mesh.frustumCulled, true);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
