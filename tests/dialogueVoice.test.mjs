import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

let server, voice, settings, prompts;
let currentScene;
let initialSettings;
const original = {
  window: globalThis.window,
  document: globalThis.document,
  Audio: globalThis.Audio,
};
class TestAudio extends EventTarget {
  static instances = [];
  static failure;
  paused = true;
  ended = false;
  volume = 1;
  playCount = 0;
  playbackRate = 1;
  currentTime = 0;
  constructor(src) {
    super();
    this.src = src;
    TestAudio.instances.push(this);
  }
  load() {}
  pause() {
    this.paused = true;
  }
  play() {
    this.playCount++;
    const failure = TestAudio.failure;
    TestAudio.failure = undefined;
    if (failure) return Promise.reject(failure);
    this.paused = false;
    return Promise.resolve();
  }
  finish() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function element() {
  const classes = new Set();
  return {
    isConnected: true,
    hidden: false,
    dataset: {},
    textContent: "",
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    closest() {
      return this.hidden ? this : null;
    },
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
  };
}
const recordedLine = () => voice.DIALOGUE_VOICE_CLIPS[0];
function say(target = element()) {
  const clip = recordedLine();
  voice.sayDialogue(target, clip.speaker, clip.text);
  return target;
}

before(async () => {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    baseURI: "http://localhost/",
  });
  globalThis.Audio = TestAudio;
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  voice = await server.ssrLoadModule("/helpers/audio/dialogueVoice.ts");
  settings = await server.ssrLoadModule("/helpers/audio/AudioManager.js");
  initialSettings = settings.getAudioSettings();
  prompts = await server.ssrLoadModule("/scripts/global/inputPrompts.ts");
});
beforeEach(() => {
  currentScene = {};
  voice.updateDialogueVoice(currentScene, false);
  settings.setVoiceActingDeveloperMode(true);
  settings.setVoiceActingEnabled(true);
  settings.setAudioMenuPaused(false);
  settings.setAudioVolume("sfx", 1);
  document.hidden = false;
  TestAudio.instances = [];
  TestAudio.failure = undefined;
});
after(async () => {
  voice?.updateDialogueVoice(null, true);
  await server?.close();
  Object.assign(globalThis, original);
});

test("voice acting starts Off and locked until developer mode is unlocked", () => {
  assert.equal(initialSettings.voiceActing, false);
  assert.equal(initialSettings.voiceActingAvailable, false);
});

test("downloaded dialogue is local and catalogue keys are unambiguous", () => {
  const keys = voice.DIALOGUE_VOICE_CLIPS.map((clip) =>
    voice.dialogueVoiceKey(clip.speaker, clip.text),
  );
  assert.ok(keys.length > 0);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(voice.DIALOGUE_VOICE_URLS.length, keys.length);
  for (const url of voice.DIALOGUE_VOICE_URLS)
    assert.doesNotMatch(url, /^https?:/);
  assert.equal(
    voice.dialogueVoiceKey("???", "  It's   stable. "),
    voice.dialogueVoiceKey("Prime", "It's stable."),
  );
  assert.equal(
    voice.dialogueVoiceKey("Prime", "Hit! 2/4 — keep shooting the target!"),
    voice.dialogueVoiceKey("Prime", "Hit! keep shooting the target!"),
  );
});

test("the cast has ten distinct male references and five real layers for every group line", () => {
  const cast = [
    "Prime",
    "Brondon",
    "Branden",
    "Brendan",
    "Donus",
    "Caleb",
    "Husain",
    "André",
    "Sibusiso",
    "Sohrab",
  ];
  const references = new Map();
  assert.ok(voice.DIALOGUE_VOICE_CLIPS.length >= 204);
  for (const clip of voice.DIALOGUE_VOICE_CLIPS) {
    assert.ok(clip.duration > 0.15 && Number.isFinite(clip.duration), clip.id);
    assert.ok(clip.model, clip.id);
    const expected =
      clip.speaker === "Sudoers 5" ? cast.slice(5) : [clip.speaker];
    assert.deepEqual(
      clip.voices.map((part) => part.speaker),
      expected,
    );
    assert.equal(
      new Set(clip.voices.map((part) => part.reference)).size,
      expected.length,
    );
    for (const part of clip.voices) {
      assert.ok(part.reference);
      if (references.has(part.speaker))
        assert.equal(
          part.reference,
          references.get(part.speaker),
          part.speaker,
        );
      else references.set(part.speaker, part.reference);
    }
  }
  assert.deepEqual([...references.keys()].sort(), [...cast].sort());
  assert.equal(new Set(references.values()).size, 10);
  assert.ok(
    voice.DIALOGUE_VOICE_CLIPS.filter((clip) => clip.speaker === "Sudoers 5")
      .length >= 9,
  );
});

test("every dialogue source, optional hint and dynamic caption has a downloaded performance", async () => {
  const expected = new Map();
  const speakers =
    /^(Prime|Brondon|Branden|Brendan|Donus|Caleb|Husain|André|Sibusiso|Sohrab|Sudoers 5|\?\?\?)$/i;
  const add = (speaker, text) => {
    if (
      !speakers.test(speaker) ||
      !/[a-z]/i.test(text) ||
      /could not be loaded|RESTARTING CHECKPOINT/.test(text)
    )
      return;
    expected.set(voice.dialogueVoiceKey(speaker, text), `${speaker}: ${text}`);
  };
  const literal = (node) =>
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : undefined;
  const alternatives = (node) => {
    if (!node) return [];
    if (literal(node) !== undefined) return [literal(node)];
    return ts.isConditionalExpression(node)
      ? [...alternatives(node.whenTrue), ...alternatives(node.whenFalse)]
      : [];
  };
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "assets") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith(".ts")) {
        const tree = ts.createSourceFile(
          path,
          await readFile(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node) {
          const value = literal(node);
          const prefixed = value?.match(/^([^:]+):\s*([\s\S]+)/);
          if (prefixed) add(prefixed[1], prefixed[2]);
          if (ts.isObjectLiteralExpression(node)) {
            const properties = new Map(
              node.properties
                .filter(ts.isPropertyAssignment)
                .map((part) => [part.name.getText(tree), part.initializer]),
            );
            const text = literal(properties.get("text")),
              speaker = literal(properties.get("speaker"));
            if (text && speaker) add(speaker, text);
            else if (
              text &&
              properties.get("speaker")?.getText(tree) === "SUDOERS_5[4].name"
            )
              add("Sohrab", text);
            const messages = properties.get("messages");
            if (
              path.endsWith("adaptiveHints.ts") &&
              messages &&
              ts.isArrayLiteralExpression(messages)
            )
              for (const item of messages.elements)
                if (literal(item)) add("Prime", literal(item));
          }
          if (ts.isCallExpression(node)) {
            const name = node.expression.getText(tree);
            const argument =
              name === "caption" && path.includes("living quarters")
                ? 0
                : name === "showHint" && path.endsWith("storageRoom.ts")
                  ? 1
                  : name === "present" && path.endsWith("wardenFinisher.ts")
                    ? 3
                    : undefined;
            if (argument !== undefined)
              for (const text of alternatives(node.arguments[argument]))
                add("Prime", text);
            if (name === "setIntroDialogue" && literal(node.arguments[0]))
              for (const text of alternatives(node.arguments[1]))
                add(literal(node.arguments[0]), text);
          }
          if (
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "quartersExitHint"
          ) {
            function returns(part) {
              if (ts.isReturnStatement(part))
                for (const text of alternatives(part.expression))
                  add("Prime", text);
              ts.forEachChild(part, returns);
            }
            returns(node);
          }
          ts.forEachChild(node, visit);
        }
        visit(tree);
      }
    }
  }
  await scan(fileURLToPath(new URL("../src", import.meta.url)));
  const layout = await server.ssrLoadModule(
    "/scenes/living quarters/layout.ts",
  );
  add(
    "Prime",
    `Branden must've set up one of his many local bots. Here's a password that may be useful: ${layout.FORWARD_BULKHEAD_CODE}.`,
  );
  for (const name of [
    "Brondon",
    "Branden",
    "Brendan",
    "Caleb",
    "Husain",
    "André",
    "Sibusiso",
    "Sohrab",
  ])
    add("Prime", `${name}'s chest is empty.`);
  for (const text of [
    "Let the crystal land, then press T.",
    "Press T. Teleport behind him.",
    "Let the crystal recharge.",
    "Aim behind him, then use D-pad Right to throw.",
    "Hold Q and left-click to throw. Aim behind him first.",
    "Hit! keep shooting the target!",
  ])
    add("Prime", text);
  ["Caleb", "Husain", "André", "Sibusiso", "Sohrab"].forEach((speaker, index) =>
    add(
      speaker,
      [
        "We broke Donus's safeguards. Every order it gave came from us.",
        "Branden was our first neural link. With Brendan, we learned how far we could take it.",
        "Prime's memories of the laboratory were ours to write. It never knew the difference.",
        "We left the signals and opened the way. We wanted you to reach this room.",
        "Donus took the blame. Your friends paid the price. Now you get to see what we built.",
      ][index],
    ),
  );
  add("Sudoers 5", "Our ambition knows no limits.");
  add("Brondon", "Neither does my vengeance.");
  const downloaded = new Set(
    voice.DIALOGUE_VOICE_CLIPS.map((clip) =>
      voice.dialogueVoiceKey(clip.speaker, clip.text),
    ),
  );
  assert.ok(expected.size >= 204);
  assert.deepEqual(
    [...expected]
      .filter(([key]) => !downloaded.has(key))
      .map(([, text]) => text),
    [],
  );
});

test("repeated cinematic updates and dialogue formatting never restart a clip", async () => {
  const target = say();
  const clip = recordedLine();
  for (let i = 0; i < 10; i++) {
    voice.sayDialogue(target, clip.speaker.toUpperCase(), clip.text);
    prompts.formatDialogue(target, `${clip.speaker}: ${clip.text}`);
  }
  await flush();
  assert.equal(TestAudio.instances.length, 1);
  assert.equal(TestAudio.instances[0].playCount, 1);
});

test("switching voices off stops speech immediately and never replays an old cue", async () => {
  const target = say();
  await flush();
  const audio = TestAudio.instances[0];
  assert.equal(audio.paused, false);
  settings.setVoiceActingEnabled(false);
  assert.equal(audio.paused, true);
  say(target);
  settings.setVoiceActingEnabled(true);
  say(target);
  await flush();
  assert.equal(TestAudio.instances.length, 1);
  assert.equal(audio.playCount, 1);
  voice.stopDialogueVoice(target);
  say(target);
  await flush();
  assert.equal(TestAudio.instances.length, 2);
});

test("speech pauses and resumes with menus, hidden tabs and temporary scene pauses", async () => {
  say();
  await flush();
  const audio = TestAudio.instances[0];
  settings.setAudioMenuPaused(true);
  assert.equal(audio.paused, true);
  settings.setAudioMenuPaused(false);
  await flush();
  assert.equal(audio.paused, false);
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(audio.paused, true);
  document.hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(audio.paused, false);
  voice.updateDialogueVoice(currentScene, true);
  assert.equal(audio.paused, true);
  voice.updateDialogueVoice(currentScene, false);
  await flush();
  assert.equal(audio.paused, false);
});

test("an incoming scene keeps its first cue queued until activation", async () => {
  const incoming = {};
  const target = element();
  const clip = recordedLine();
  voice.sayDialogue(target, clip.speaker, clip.text, incoming);
  const audio = TestAudio.instances[0];
  assert.equal(audio.playCount, 0);
  voice.updateDialogueVoice(currentScene, true);
  assert.equal(audio.playCount, 0);
  currentScene = incoming;
  voice.updateDialogueVoice(currentScene, false);
  await flush();
  assert.equal(audio.playCount, 1);
  assert.equal(audio.paused, false);
  voice.sayDialogue(target, clip.speaker, clip.text, incoming);
  assert.equal(TestAudio.instances.length, 1);
});

test("a hidden dialogue panel can speak the same line again when reopened", async () => {
  const target = say();
  await flush();
  target.hidden = true;
  voice.updateDialogueVoice(currentScene, false);
  assert.equal(TestAudio.instances[0].paused, true);
  target.hidden = false;
  say(target);
  await flush();
  assert.equal(TestAudio.instances.length, 2);
  assert.equal(TestAudio.instances[1].paused, false);
});

test("fixed cinematic windows preserve pitch and play the complete recorded line", () => {
  const clip = voice.DIALOGUE_VOICE_CLIPS.find((item) => item.duration > 0);
  assert.ok(clip);
  voice.sayDialogue(
    element(),
    clip.speaker,
    clip.text,
    currentScene,
    clip.duration / 1.2,
  );
  const audio = TestAudio.instances[0];
  assert.ok(Math.abs(audio.playbackRate - 1.2) < 1e-8);
  assert.equal(audio.preservesPitch, true);
  assert.ok(clip.duration / audio.playbackRate <= clip.duration / 1.2 + 1e-8);
  assert.throws(
    () =>
      voice.sayDialogue(element(), clip.speaker, clip.text, currentScene, 0),
    RangeError,
  );
});

test("skips, hidden dialogue, removed panels and scene changes cancel outgoing speech", async () => {
  for (const cleanup of [
    (target) => voice.stopDialogueVoice(target),
    (target) => {
      target.hidden = true;
    },
    (target) => {
      target.isConnected = false;
    },
    () => {
      currentScene = {};
    },
  ]) {
    const target = say();
    await flush();
    const audio = TestAudio.instances.at(-1);
    cleanup(target);
    voice.updateDialogueVoice(currentScene, false);
    window.dispatchEvent(new Event("keydown"));
    await flush();
    assert.equal(audio.paused, true);
    assert.equal(audio.playCount, 1);
  }
});

test("character dialogue uses a clear mix without changing effects or music", async () => {
  settings.setAudioVolume("bgm", 0.4);
  settings.setAudioVolume("sfx", 0.6);
  const target = say();
  await flush();
  const audio = TestAudio.instances[0];
  assert.equal(audio.volume, 0.6);
  assert.equal(settings.getSfxGain(), 0.18);
  settings.setAudioVolume("sfx", 0.2);
  assert.equal(audio.volume, 0.2);
  assert.equal(settings.getAudioSettings().bgm, 0.4);
  voice.stopDialogueVoice(target);
});

test("autoplay-blocked speech cannot start after skipping or disabling voices", async () => {
  for (const cancel of [
    (target) => voice.stopDialogueVoice(target),
    () => settings.setVoiceActingEnabled(false),
  ]) {
    settings.setVoiceActingEnabled(true);
    TestAudio.failure = new DOMException(
      "Interaction needed",
      "NotAllowedError",
    );
    const target = say();
    await flush();
    const audio = TestAudio.instances.at(-1);
    cancel(target);
    window.dispatchEvent(new Event("pointerdown"));
    await flush();
    assert.equal(audio.paused, true);
    assert.equal(audio.playCount, 1);
  }
});

test("missing recordings are reported once and do not play an unrelated clip", (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const target = element();
  voice.sayDialogue(target, "Prime", "An intentionally unrecorded test cue.");
  voice.sayDialogue(target, "Prime", "An intentionally unrecorded test cue.");
  assert.equal(TestAudio.instances.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /no downloaded recording/);
});
