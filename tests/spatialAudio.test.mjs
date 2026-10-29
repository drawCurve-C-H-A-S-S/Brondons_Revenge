import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import * as THREE from "three";
import { createServer } from "vite";

let server, spatial, sfx, settings, recorded, soundscape, presentation;
const original = {
  window: globalThis.window,
  document: globalThis.document,
  fetch: globalThis.fetch,
};
class Param {
  value = 0;
  setValueAtTime(value) {
    this.value = value;
  }
  setTargetAtTime(value) {
    this.value = value;
  }
}
class Node {
  connections = [];
  disconnected = false;
  connect(node) {
    this.connections.push(node);
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Buffer {
  constructor(channels = 1, length = 2000, sampleRate = 1000) {
    Object.assign(this, {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
    });
    this.channels = Array.from({ length: channels }, () =>
      new Float32Array(length).fill(0.3),
    );
  }
  getChannelData(channel) {
    return this.channels[channel];
  }
}
class Context {
  static instance;
  currentTime = 0;
  state = "running";
  destination = new Node();
  sources = [];
  decoded = 0;
  constructor() {
    Context.instance = this;
  }
  createBuffer(...args) {
    return new Buffer(...args);
  }
  async decodeAudioData() {
    this.decoded++;
    return new Buffer();
  }
  createGain() {
    return Object.assign(new Node(), { gain: new Param() });
  }
  createStereoPanner() {
    return Object.assign(new Node(), { pan: new Param() });
  }
  createBiquadFilter() {
    return Object.assign(new Node(), {
      frequency: new Param(),
      Q: new Param(),
    });
  }
  createDynamicsCompressor() {
    return Object.assign(
      new Node(),
      Object.fromEntries(
        ["threshold", "knee", "ratio", "attack", "release"].map((key) => [
          key,
          new Param(),
        ]),
      ),
    );
  }
  createBufferSource() {
    const source = Object.assign(new Node(), {
      playbackRate: new Param(),
      stopped: false,
      onended: null,
      start(when, offset) {
        this.offset = offset;
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
      finish() {
        this.stopped = true;
        this.onended?.();
      },
    });
    this.sources.push(source);
    return source;
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
let scene, camera;
const latest = () => Context.instance.sources.at(-1);
const filter = (source = latest()) => source.connections[0];
const gain = (source = latest()) => filter(source).connections[0].gain.value;
const pan = (source = latest()) =>
  filter(source).connections[0].connections[0].pan.value;
const live = () => Context.instance.sources.filter((source) => !source.stopped);
const frame = (paused = false) =>
  spatial.updateSpatialAudio(scene, camera, paused);

before(async () => {
  globalThis.window = Object.assign(new EventTarget(), {
    AudioContext: Context,
  });
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    baseURI: "http://localhost/",
  });
  globalThis.fetch = async () =>
    new Response(new Uint8Array([79, 103, 103, 83]));
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  spatial = await server.ssrLoadModule("/helpers/audio/spatialAudio.ts");
  sfx = await server.ssrLoadModule("/helpers/audio/sfx.ts");
  settings = await server.ssrLoadModule("/helpers/audio/AudioManager.js");
  recorded = await server.ssrLoadModule("/helpers/audio/recordedSounds.ts");
  soundscape = await server.ssrLoadModule("/helpers/audio/gameSoundscape.ts");
  presentation = await server.ssrLoadModule(
    "/scripts/level-3/finalePresentation.ts",
  );
});
beforeEach(() => {
  spatial.stopSceneAudio();
  settings.setAudioMenuPaused(false);
  settings.setAudioVolume("sfx", 1);
  settings.setVoiceActingDeveloperMode(true);
  settings.setVoiceActingEnabled(true);
  document.hidden = false;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  frame();
  if (Context.instance) Context.instance.sources = [];
});
after(async () => {
  spatial?.stopSceneAudio();
  await server?.close();
  Object.assign(globalThis, original);
});

test("quadratic falloff is exact, finite and silent outside the radius", () => {
  assert.equal(spatial.soundAttenuation(0, 20), 1);
  assert.equal(spatial.soundAttenuation(10, 20), 0.25);
  assert.equal(spatial.soundAttenuation(20, 20), 0);
  assert.equal(spatial.soundAttenuation(200, 20), 0);
  for (const [distance, radius] of [
    [NaN, 20],
    [-1, 20],
    [1, 0],
    [1, Infinity],
  ])
    assert.throws(() => spatial.soundAttenuation(distance, radius), RangeError);
});

test("recorded point sources follow distance, camera rotation and distant filtering", async () => {
  const point = new THREE.Vector3(10, 0, 0);
  spatial.playSample("spatial-test.ogg", { position: point, radius: 20 });
  await flush();
  assert.equal(gain(), 0.25);
  assert.ok(pan() > 0.9);
  const initialCutoff = filter().frequency.value;
  camera.rotation.y = Math.PI;
  frame();
  assert.ok(pan() < -0.9);
  camera.position.x = -9;
  frame();
  assert.ok(gain() < 0.003);
  assert.ok(filter().frequency.value < initialCutoff);
  camera.position.x = -10;
  frame();
  assert.equal(gain(), 0);
});

test("both distance and mute are applied before new sounds are started", async () => {
  const previous = Context.instance.sources.length;
  spatial.playSample("distant-test.ogg", {
    position: { x: 25, y: 0, z: 0 },
    radius: 20,
  });
  settings.setAudioVolume("sfx", 0);
  spatial.playSample("muted-test.ogg");
  await flush();
  assert.equal(Context.instance.sources.length, previous);
});

test("voice mode stops only vocals and preserves effects, music and sound volume", async () => {
  const before = settings.getAudioSettings();
  spatial.playSample("voice-mode-dialogue.ogg", { voice: true });
  spatial.playSample("voice-mode-effect.ogg");
  await flush();
  assert.equal(live().length, 2);
  const [dialogue, effect] = live();
  settings.setVoiceActingEnabled(false);
  assert.equal(dialogue.stopped, true);
  assert.equal(effect.stopped, false);
  assert.deepEqual(settings.getAudioSettings(), {
    ...before,
    voiceActing: false,
  });
  const count = Context.instance.sources.length;
  spatial.playSample("disabled-dialogue.ogg", { voice: true });
  sfx.playSfx("brendan");
  sfx.playWorldSfx("brendan", { x: 0, y: 0, z: 0 });
  sfx.playSfx("revengeShout");
  await flush();
  assert.equal(Context.instance.sources.length, count);
  settings.setVoiceActingEnabled(true);
  assert.equal(
    dialogue.stopped,
    true,
    "Re-enabling never replays old dialogue",
  );
  spatial.playSample("new-dialogue.ogg", { voice: true });
  await flush();
  assert.equal(live().length, 2);
});

test("disabling voices cancels pending voice decoding without cancelling effects", async (t) => {
  let release;
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  spatial.playSample("pending-voice-mode.ogg", { voice: true });
  await flush();
  settings.setVoiceActingEnabled(false);
  settings.setVoiceActingEnabled(true);
  release(new Response(new Uint8Array([79, 103, 103, 83])));
  await flush();
  assert.equal(live().length, 0);
});

test("voice mode also stops an active synthesized character shout", () => {
  sfx.playSfx("revengeShout");
  const shout = latest();
  assert.equal(shout.stopped, false);
  settings.setVoiceActingEnabled(false);
  assert.equal(shout.stopped, true);
});

test("voices are unavailable outside developer mode, including a remembered On preference", async () => {
  spatial.playSample("developer-only-dialogue.ogg", { voice: true });
  spatial.playSample("developer-only-effect.ogg");
  await flush();
  const [dialogue, effect] = live();
  settings.setVoiceActingDeveloperMode(false);
  assert.equal(settings.getAudioSettings().voiceActing, false);
  assert.equal(settings.getAudioSettings().voiceActingAvailable, false);
  assert.equal(dialogue.stopped, true);
  assert.equal(effect.stopped, false);
  assert.throws(
    () => settings.setVoiceActingEnabled(true),
    /only available in developer mode/,
  );
  const count = Context.instance.sources.length;
  spatial.playSample("locked-developer-dialogue.ogg", { voice: true });
  sfx.playSfx("brendan");
  await flush();
  assert.equal(Context.instance.sources.length, count);
  settings.setVoiceActingDeveloperMode(true);
  assert.equal(settings.getAudioSettings().voiceActing, true);
  assert.equal(dialogue.stopped, true);
  assert.throws(() => settings.setVoiceActingDeveloperMode("on"), TypeError);
});

test("voice preference persists and blocked storage is reported without blocking the setting", (t) => {
  const stored = new Map();
  const previousStorage = window.localStorage;
  window.localStorage = { setItem: (key, value) => stored.set(key, value) };
  t.after(() => {
    if (previousStorage === undefined) delete window.localStorage;
    else window.localStorage = previousStorage;
  });
  settings.setVoiceActingEnabled(false);
  assert.equal(stored.get("brondons-revenge-voice-acting"), "off");
  settings.setVoiceActingEnabled(true);
  assert.equal(stored.get("brondons-revenge-voice-acting"), "on");
  t.mock.method(window.localStorage, "setItem", () => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  settings.setVoiceActingEnabled(false);
  assert.equal(settings.getAudioSettings().voiceActing, false);
  assert.match(warnings[0][0], /Unable to save voice-acting setting/);
  assert.throws(() => settings.setVoiceActingEnabled("off"), TypeError);
});

test("a saved developer On preference cannot enable voices at startup", async (t) => {
  const previousStorage = window.localStorage;
  window.localStorage = { getItem: () => "on" };
  t.after(() => {
    if (previousStorage === undefined) delete window.localStorage;
    else window.localStorage = previousStorage;
  });
  const fresh = await server.ssrLoadModule(
    "/helpers/audio/AudioManager.js?developer-default-test",
  );
  assert.equal(fresh.getAudioSettings().voiceActing, false);
  assert.equal(fresh.getAudioSettings().voiceActingAvailable, false);
  fresh.setVoiceActingDeveloperMode(true);
  assert.equal(fresh.getAudioSettings().voiceActing, true);
});

test("looping emitters virtualize at distance and restart after pause, mute and tab hiding", async () => {
  const target = new THREE.Group();
  scene.add(target);
  const emitter = spatial.createSampleEmitter("loop-test.ogg", scene, target, {
    radius: 20,
  });
  frame();
  await flush();
  assert.equal(live().length, 1);
  frame(true);
  assert.equal(live().length, 0);
  frame();
  await flush();
  assert.equal(live().length, 1);
  settings.setAudioVolume("sfx", 0);
  assert.equal(live().length, 0);
  settings.setAudioVolume("sfx", 1);
  frame();
  await flush();
  assert.equal(live().length, 1);
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(live().length, 0);
  document.hidden = false;
  frame();
  await flush();
  assert.equal(live().length, 1);
  target.position.x = 21;
  frame();
  assert.equal(live().length, 0);
  target.position.x = 0;
  frame();
  await flush();
  assert.equal(live().length, 1);
  emitter.dispose();
  assert.equal(live().length, 0);
});

test("scene transitions dispose outgoing loops and cancel pending one-shots", async () => {
  spatial.createSampleEmitter("outgoing-loop.ogg", scene, undefined);
  frame();
  spatial.playSample("outgoing-pending.ogg");
  scene = new THREE.Scene();
  frame();
  await flush();
  assert.equal(live().length, 0);
  frame();
  await flush();
  assert.equal(live().length, 0);
});

test("overlapping robots are not globally throttled and variants do not repeat", async () => {
  const point = new THREE.Vector3(1, 0, 0);
  sfx.playSfxAt("robotStep", point, camera.position, 18);
  sfx.playSfxAt("robotStep", point, camera.position, 18);
  await flush();
  assert.equal(live().length, 2);
  assert.notEqual(live()[0].buffer, live()[1].buffer);
});

test("door sounds play on opening and closing starts, not on every animation frame", async () => {
  const door = new THREE.Group();
  scene.add(door);
  sfx.playDoorMovement(door, 0, 1);
  sfx.playDoorMovement(door, 0.3, 1);
  await flush();
  assert.equal(live().length, 1);
  sfx.playDoorMovement(door, 1, 1);
  sfx.playDoorMovement(door, 1, 0);
  sfx.playDoorMovement(door, 0.6, 0);
  await flush();
  assert.equal(live().length, 2);
  assert.notEqual(live()[0].buffer, live()[1].buffer);
  sfx.playDoorMovement(door, 0.4, 1);
  await flush();
  assert.equal(
    live().length,
    3,
    "Reversing midway through closing starts the opening recording",
  );
});

test("transient and ambient voice counts are bounded", async () => {
  for (let i = 0; i < 80; i++) spatial.playSample("capped-transient.ogg");
  for (let i = 0; i < 20; i++)
    spatial.createSampleEmitter("capped-loop.ogg", scene, undefined);
  frame();
  await flush();
  assert.equal(
    live().filter((source) => !source.loop).length,
    spatial.MAX_SAMPLE_VOICES,
  );
  assert.equal(
    live().filter((source) => source.loop).length,
    spatial.MAX_AMBIENT_VOICES,
  );
});

test("hidden objects, dead trees and orbit scenes do not emit forest or indoor ambience", async () => {
  let alive = true;
  const forest = soundscape.createForestSoundscape(scene, [
    { x: 2, z: 0, height: 20, alive: () => alive },
  ]);
  frame();
  await flush();
  assert.equal(live().length, 3);
  alive = false;
  frame();
  assert.equal(live().length, 0);
  forest.dispose();
  const ambience = soundscape.createGameSoundscape();
  ambience.update("scene16", scene);
  frame();
  await flush();
  assert.equal(live().length, 0, "Orbit does not get the ship interior bed");
  ambience.stop();
});

test("mech footsteps follow ground travel and stop in the air or at rest", async () => {
  const mech = new THREE.Group();
  scene.add(mech);
  const audio = soundscape.createMechMovementAudio(scene, mech);
  audio.update(0.1, false);
  frame();
  await flush();
  assert.equal(live().length, 0);
  for (let i = 0; i < 4; i++) {
    mech.position.x += 1;
    audio.update(0.1, false);
  }
  frame();
  await flush();
  assert.equal(live().filter((source) => !source.loop).length, 1);
  latest().finish();
  for (const source of live().filter((source) => !source.loop)) source.finish();
  mech.position.x += 5;
  audio.update(0.1, true);
  frame();
  await flush();
  assert.equal(live().filter((source) => !source.loop).length, 0);
  audio.dispose();
});

test("combat mappings separate actual blade clashes, shields, swings and armour hits", () => {
  assert.equal(presentation.FINALE_SOUND_MAP.parry, "swordClash");
  assert.equal(presentation.FINALE_SOUND_MAP.guard, "shieldHit");
  assert.equal(presentation.FINALE_SOUND_MAP.swing, "slash");
  assert.equal(presentation.FINALE_SOUND_MAP.hit, "metalHit");
});

test("all new clips are real local Ogg files and every provider is in game credits", async () => {
  const directory = new URL("../src/assets/sounds/foley/", import.meta.url);
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".ogg"),
  );
  assert.ok(files.length > 0);
  assert.equal(recorded.RECORDED_SOUND_URLS.length, files.length);
  for (const file of files) {
    const bytes = await readFile(new URL(file, directory));
    assert.equal(bytes.subarray(0, 4).toString(), "OggS", file);
    assert.ok(bytes.length > 1000, file);
  }
  const credits = await readFile(
    new URL("../src/index.html", import.meta.url),
    "utf8",
  );
  for (const provider of [
    "Kenney",
    "StarNinjas",
    "isaiah658",
    "IgnasD",
    "qubodup",
    "AntumDeluge",
  ])
    assert.ok(credits.includes(provider), provider);
});
