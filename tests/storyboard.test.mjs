import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";

const pageUrl = new URL("../storyboard/index.html", import.meta.url);

test("the discussion outline covers all ten sections in the 4:50 script", async () => {
  const html = await readFile(pageUrl, "utf8");
  assert.equal([...html.matchAll(/<article id="/g)].length, 10);
  const durations = [...html.matchAll(/\/ (\d+) seconds<\/span>/g)].map(
    (match) => Number(match[1]),
  );
  assert.equal(durations.length, 10);
  assert.equal(
    durations.reduce((total, seconds) => total + seconds, 0),
    290,
  );
  assert.match(html, /09 \/ 3:50-4:35 \/ 45 seconds/);
  assert.doesNotMatch(html, /<video\b|<img\b|<script\b|shots\/|id="animatic"/);
});

test("discussion links resolve to real topics and source files", async () => {
  const html = await readFile(pageUrl, "utf8");
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith("#")) {
      assert.ok(html.includes(`id="${href.slice(1)}"`), href);
    } else {
      await access(new URL(href, pageUrl));
    }
  }
});
