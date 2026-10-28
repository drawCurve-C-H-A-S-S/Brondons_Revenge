import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const topics = runInNewContext(
  `${read("storyboard/topics.js")}\ndevlogTopics;`,
);
const compact = (value) => value.replace(/\s+/g, "");

test("every devlog card has a unique, directly addressable chapter and artwork", () => {
  assert.equal(topics.length, 9);
  assert.equal(new Set(topics.map((topic) => topic.id)).size, topics.length);
  for (const topic of topics) {
    const html = read(`storyboard/${topic.id}.html`);
    assert.ok(html.includes(`data-page="${topic.id}"`), topic.id);
    assert.ok(html.includes('href="index.html"'), topic.id);
    assert.ok(html.includes('src="topics.js" defer'), topic.id);
    assert.ok(html.includes('src="devlog.js" defer'), topic.id);
    assert.match(html, /<noscript\b/, topic.id);
    assert.ok(existsSync(resolve(root, "src/assets/loading", topic.image)));
    assert.ok(topic.intro && topic.footage && topic.note);
    assert.ok(topic.paragraphs.length >= 2);
  }
});

test("every displayed code excerpt exists in its linked game source", () => {
  for (const topic of topics) {
    assert.ok(topic.snippets.length >= 2, topic.id);
    for (const snippet of topic.snippets) {
      assert.ok(snippet.title && snippet.explanation && snippet.symbol);
      assert.ok(
        compact(read(snippet.file)).includes(compact(snippet.code)),
        `${topic.id}: ${snippet.title} must match ${snippet.file}`,
      );
    }
  }
});

test("the music chapter uses existing playable game audio files", () => {
  for (const file of ["Stealth1.ogg", "Planetbfm.ogg"]) {
    assert.ok(existsSync(resolve(root, "src/assets/bgm", file)));
    assert.ok(read("storyboard/devlog.js").includes(file));
  }
});

test("the hub provides direct chapter links even without JavaScript", () => {
  const index = read("storyboard/index.html");
  assert.match(index, /Brondon's Revenge\s*<span>Devlog<\/span>/);
  for (const topic of topics) {
    assert.ok(index.includes(`href="${topic.id}.html"`), topic.id);
  }
});
