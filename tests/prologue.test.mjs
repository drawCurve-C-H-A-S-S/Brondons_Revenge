import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "vite";

let server,
  THREE,
  createPrologueFlashbacks,
  createPrologueShield,
  dialogue,
  securityCuts;
let previousBrowser;
before(async () => {
  previousBrowser = {
    window: globalThis.window,
    document: globalThis.document,
  };
  const context = new Proxy(
    {
      measureText: (text) => ({ width: text.length * 17 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    },
    { get: (target, name) => (name in target ? target[name] : () => {}) },
  );
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 1280,
    innerHeight: 720,
  });
  globalThis.document = Object.assign(new EventTarget(), {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "prologue-test-deps",
        resolveId: (id) =>
          id === "virtual:prologue-deps" ? "\0prologue-deps" : null,
        load: (id) =>
          id === "\0prologue-deps" ? "export * as THREE from 'three';" : null,
      },
    ],
  });
  ({ THREE } = await server.ssrLoadModule("virtual:prologue-deps"));
  ({
    createPrologueFlashbacks,
    createPrologueShield,
    PROLOGUE_SECURITY_CUTS: securityCuts,
  } = await server.ssrLoadModule("/scenes/prologue/prologueFlashbacks.ts"));
  ({ PROLOGUE_DIALOGUE: dialogue } = await server.ssrLoadModule(
    "/scenes/prologue/prologue_scene_1.ts",
  ));
});
after(async () => {
  await server?.close();
  Object.assign(globalThis, previousBrowser);
});

function character(name) {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 1.8, 0.3),
    new THREE.MeshStandardMaterial(),
  );
  mesh.name = name;
  mesh.position.y = 0.9;
  scene.add(mesh);
  return {
    scene,
    animations: [
      new THREE.AnimationClip("Idle_Loop", 2, []),
      new THREE.AnimationClip("Walk", 1, []),
    ],
  };
}
function loaders() {
  return {
    characterLoader: async () => character("RecoveredCrew"),
    playerLoader: async () => character("RecoveredBrondon"),
    modelLoader: async (name) => character(name),
    shipLoader: async () => character("MothershipHull").scene,
    bossLoader: async () => character("BayWardenModel"),
    monitorFactory: () => ({
      texture: new THREE.Texture(),
      ready: Promise.resolve(),
      update() {},
      dispose() {},
      getFrameIndex: () => 0,
    }),
  };
}
async function flashbacks(t, overrides = {}) {
  const data = createPrologueFlashbacks({ ...loaders(), ...overrides });
  t.after(() => data.dispose());
  await data.ready;
  return data;
}
function named(scene, name) {
  const result = [];
  scene.traverse((node) => {
    if (node.name === name) result.push(node);
  });
  return result;
}

test("the shortened dialogue follows the pod escape, camera loop and one-use cabin route in order", () => {
  assert.equal(dialogue.length, 28);
  assert.ok(
    dialogue
      .filter((line) => line.automatic)
      .reduce((total, line) => total + line.duration, 0) < 95,
  );
  assert.deepEqual(
    dialogue.filter((line) => line.shot).map((line) => line.shot),
    [
      "asteroid",
      "collection",
      "ingest",
      "corruption",
      "capture",
      "laboratory",
      "experiment",
      "breakout",
      "planet",
      "security",
    ],
  );
  const beats = [
    /ambushed.*restrained.*hostage/,
    /experimented on them/,
    /sealed you.*experiment pod/,
    /why.*experiment on me/i,
    /released your shield.*shattered your pod/,
    /chain you up.*chains sap your energy.*prevent me from easily releasing your shield/,
    /Where are we/,
    /still aboard the Donus mothership.*don't have physical records of where the others are/,
    /get out of these chains/,
    /I have stored enough energy to break the chains/,
    /loop.*camera feed.*surveillance.*won't notice/,
    /reach our ship in Hangar 14.*security everywhere/,
    /anywhere.*without being seen/,
    /homing beacon.*only once.*no patrols/,
    /Get your gear.*off this ship/,
  ];
  let previous = -1;
  for (const beat of beats) {
    const index = dialogue.findIndex((line) => beat.test(line.text));
    assert.ok(index > previous, `Missing or out-of-order story beat: ${beat}`);
    previous = index;
  }
  assert.deepEqual(
    dialogue.slice(-2).map((line) => [line.speaker, line.text]),
    [
      ["Brondon", "Let's do this."],
      ["Prime", "Brace for impact."],
    ],
  );
  assert.doesNotMatch(
    dialogue.map((line) => line.text).join(" "),
    /invasive command|isolated your neural|maintenance relay|only room I can/,
  );
});

test("the shield expands before the break point and completely fades afterwards", () => {
  const burst = createPrologueShield();
  burst.update(-1);
  assert.equal(burst.root.visible, false);
  burst.update(0.1);
  const initial = burst.root.scale.x;
  burst.update(0.45);
  assert.ok(burst.root.visible);
  assert.ok(burst.root.scale.x > initial * 3);
  burst.update(1.2);
  assert.equal(burst.root.visible, false);
  assert.ok(burst.root.children.every((mesh) => mesh.material.opacity === 0));
  burst.root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      node.material.dispose();
    }
  });
});

test("the laboratory has eight occupied pods and an unobstructed central aisle", async (t) => {
  const data = await flashbacks(t),
    lab = data.sceneFor("laboratory");
  assert.equal(named(lab, "ContainmentPodShell").length, 8);
  const pod = lab.getObjectByName("BrondonExperimentPod");
  assert.ok(pod.getObjectByName("RecoveredBrondon"));
  assert.equal(named(lab, "RecoveredCrew").length, 7);
  const aisle = new THREE.Box3(
    new THREE.Vector3(-0.8, 0.5, -5.5),
    new THREE.Vector3(0.8, 2.5, 5.5),
  );
  const obstructions = [];
  lab.updateMatrixWorld(true);
  lab.traverse((node) => {
    if (
      node instanceof THREE.Mesh &&
      new THREE.Box3().setFromObject(node).intersectsBox(aisle)
    )
      obstructions.push(node.name || node.geometry.type);
  });
  assert.deepEqual(obstructions, []);
});

test("the second lab shot closes in on Brondon instead of replaying the wide shot", async (t) => {
  const data = await flashbacks(t),
    camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 80);
  data.update("laboratory", 2, 6, 1 / 60, camera);
  const wide = camera.position.clone();
  data.update("experiment", 2, 4.5, 1 / 60, camera);
  const focus = data
    .sceneFor("experiment")
    .getObjectByName("BrondonExperimentPod")
    .position.clone()
    .add(new THREE.Vector3(0, 1.4, 0));
  assert.ok(camera.position.distanceTo(focus) < wide.distanceTo(focus));
  camera.updateMatrixWorld(true);
  const projected = focus.clone().project(camera);
  assert.ok(Math.abs(projected.x) < 0.01 && Math.abs(projected.y) < 0.01);
});

test("the lab shield visibly shatters Brondon's pod, then resets cleanly for a replay", async (t) => {
  const data = await flashbacks(t),
    camera = new THREE.PerspectiveCamera();
  const pod = data.sceneFor("breakout").getObjectByName("BrondonExperimentPod");
  const shell = pod.getObjectByName("ContainmentPodShell"),
    debris = pod.getObjectByName("BrondonPodDebris");
  data.update("breakout", 0.7, 6, 1 / 60, camera);
  assert.ok(shell.visible);
  assert.equal(debris.visible, false);
  const origins = debris.children.map((node) => node.position.clone());
  data.update("breakout", 1.2, 6, 1 / 60, camera);
  assert.equal(shell.visible, false);
  assert.ok(debris.visible);
  assert.ok(pod.getObjectByName("PrimeShieldBurst").visible);
  assert.equal(debris.children.length, 25);
  assert.ok(
    debris.children.every(
      (node, index) => node.position.distanceTo(origins[index]) > 0.1,
    ),
  );
  data.update("breakout", 3, 6, 1 / 60, camera);
  assert.equal(pod.getObjectByName("PrimeShieldBurst").visible, false);
  data.update("experiment", 0, 4.5, 1 / 60, camera);
  assert.ok(shell.visible);
  assert.equal(debris.visible, false);
});

test("the planet shot trails the foreground mothership with the planet far ahead", async (t) => {
  const data = await flashbacks(t),
    planet = data.sceneFor("planet");
  const ship = planet.getObjectByName("Mothership"),
    destination = planet.getObjectByName("DistantRescuePlanet");
  assert.ok(ship.getObjectByName("MothershipHull"));
  assert.ok(ship.position.distanceTo(destination.position) > 600);
  assert.ok(destination.position.z < ship.position.z);
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 80);
  for (const elapsed of [0, 3, 6]) {
    data.update("planet", elapsed, 6, 1 / 60, camera);
    camera.updateMatrixWorld(true);
    assert.ok(camera.position.z > ship.position.z);
    assert.ok(camera.position.distanceTo(ship.position) < 30);
    assert.ok(
      camera.far > camera.position.distanceTo(destination.position) + 50,
    );
    for (const target of [ship, destination]) {
      const projected = target.position.clone().project(camera);
      assert.ok(
        Math.abs(projected.x) < 0.9 &&
          Math.abs(projected.y) < 0.9 &&
          projected.z < 1,
      );
    }
  }
});

test("the slower montage shows Hangar 14 once and ends on the live surveillance screens", async (t) => {
  const data = await flashbacks(t),
    camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.05, 80);
  assert.equal(securityCuts[0].start, 0);
  const duration = dialogue.find((line) => line.shot === "security").duration;
  assert.equal(duration, 10);
  assert.equal(securityCuts.at(-1).end, duration);
  assert.deepEqual(
    securityCuts.map((cut) => cut.id),
    [
      "hangar14-ship",
      "surveillance-hub",
      "deck-one",
      "bay-warden",
      "surveillance-screens",
    ],
  );
  assert.equal(
    securityCuts.filter((cut) => cut.id.startsWith("hangar14")).length,
    1,
  );
  const wardenCut = securityCuts.find((cut) => cut.id === "bay-warden");
  assert.ok(wardenCut.end - wardenCut.start < 0.8);
  const seen = new Set();
  for (const [index, cut] of securityCuts.entries()) {
    if (index > 0) assert.equal(cut.start, securityCuts[index - 1].end);
    if (cut.id !== "bay-warden")
      assert.ok(cut.end - cut.start >= 2.2, `${cut.id} needs time to read`);
    data.update("security", cut.start, duration, 1 / 60, camera);
    assert.equal(data.getSecurityCut().id, cut.id);
    const scene = data.sceneFor("security");
    seen.add(scene.name);
    const start = camera.position.clone(),
      initialFov = camera.fov;
    data.update("security", cut.end - 0.001, duration, 1 / 60, camera);
    assert.ok(
      camera.position.distanceTo(start) > 1.5,
      `${cut.id} needs a real camera move`,
    );
    assert.ok(
      Math.abs(camera.fov - initialFov) > 4,
      `${cut.id} needs a zoom or pullback`,
    );
    assert.equal(data.getSecurityCut().label, cut.label);
    if (cut.id.startsWith("hangar14")) {
      assert.ok(scene.getObjectByName("EscapeShuttle"));
      assert.ok(scene.getObjectByName("HangarArrivalLift"));
      assert.equal(named(scene, "MontageSecurityRobot").length, 12);
    } else if (cut.id.startsWith("surveillance")) {
      assert.ok(scene.getObjectByName("SurveillanceFloor"));
      assert.equal(
        scene
          .getObjectByName("SurveillanceHub")
          .children.filter((node) =>
            node.name.startsWith("SurveillanceWorkstation-"),
          ).length,
        15,
      );
      assert.equal(named(scene, "MontageSecurityRobot").length, 1);
      const panel = scene.getObjectByName("SurveillanceCameraWall");
      assert.ok(panel);
      assert.equal(
        panel.children.filter((node) => node.name.startsWith("cctv-screen-"))
          .length,
        6,
      );
      assert.equal(
        panel.children.filter((node) => node.name.startsWith("cctv-standby-"))
          .length,
        6,
      );
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      for (const screen of panel.children.filter((node) =>
        node.name.startsWith("cctv-screen-"),
      )) {
        const center = screen
          .getWorldPosition(new THREE.Vector3())
          .project(camera);
        assert.ok(
          Math.abs(center.x) < 1 && Math.abs(center.y) < 1 && center.z < 1,
          "All live screens must be in frame",
        );
        assert.ok(
          screen.material.map,
          "The camera wall must display footage, not empty panels",
        );
      }
    } else if (cut.id === "deck-one") {
      assert.ok(scene.getObjectByName("DeckOneHangarFloor"));
      assert.equal(named(scene, "StealthPreviewScanField").length, 3);
    } else {
      assert.ok(scene.getObjectByName("BayWardenSecurityPreview"));
      assert.ok(scene.getObjectByName("BayWardenModel"));
    }
  }
  assert.equal(seen.size, 4);
  data.update("security", 30, duration, 0, camera);
  assert.equal(
    data.getSecurityCut().id,
    "surveillance-screens",
    "The brief boss reveal must not loop while waiting to advance",
  );
});

test("live security shots share the playable passage and hangar with exactly one passage eye drone", async (t) => {
  const data = await flashbacks(t),
    passage = data.sceneFor("corridor");
  assert.equal(passage, data.sceneFor("stealth"));
  assert.ok(passage.getObjectByName("DeckOnePatrolPassageFloor"));
  assert.ok(passage.getObjectByName("DeckOneHangarFloor"));
  assert.ok(passage.getObjectByName("StorageHideDoor"));
  assert.ok(passage.getObjectByName("HangarCargo-11-0"));
  const drones = named(passage, "StoragePatrolCameraDrone");
  assert.equal(drones.length, 1);
  assert.ok(drones[0].getObjectByName("Enemy_EyeDrone"));
  assert.equal(named(passage, "Sealed research-room entrance").length, 0);
  const camera = new THREE.PerspectiveCamera();
  data.update("corridor", 0, 5.5, 1 / 60, camera);
  const start = drones[0].position.clone();
  data.update("corridor", 5, 5.5, 1 / 60, camera);
  assert.ok(drones[0].position.distanceTo(start) > 5);
  assert.equal(drones[0].position.z, -2.5);
  assert.equal(named(passage, "StealthPreviewScanField").length, 3);
});

test("a missing mothership fails preparation instead of silently substituting a generic ship", async (t) => {
  const data = createPrologueFlashbacks({
    ...loaders(),
    shipLoader: async () => {
      throw new Error("Mothership unavailable");
    },
  });
  t.after(() => data.dispose());
  await assert.rejects(data.ready, /Mothership unavailable/);
});

test("a missing Warden fails preparation instead of silently omitting the cinematic reveal", async (t) => {
  const data = createPrologueFlashbacks({
    ...loaders(),
    bossLoader: async () => {
      throw new Error("Warden unavailable");
    },
  });
  t.after(() => data.dispose());
  await assert.rejects(data.ready, /Warden unavailable/);
});
