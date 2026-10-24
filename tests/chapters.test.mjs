import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let server, chapters;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  chapters = await server.ssrLoadModule("/core/chapters.ts");
});
after(async () => server?.close());

test("the refreshed screenshots resolve to the requested loading scenes", async () => {
  const expected = [
    ["stage1", "stage1-patrol"],
    ["cargo", "stage2-cargo"],
    ["range", "stage2-range"],
    ["flight", "level2-space"],
    ["scrambler", "level2-sidescroll"],
    ["red-scrambler", "level2-topdown"],
    ["reactor", "level2-reactor"],
    ["jungle", "level3-jungle"],
    ["facility", "facility"],
  ];
  for (const [chapter, filename] of expected) {
    assert.ok(
      chapters.LOADING_CHAPTERS[chapter].images.some((url) =>
        url.endsWith(`/${filename}.jpg`),
      ),
    );
    const bytes = await readFile(
      new URL(`../src/assets/loading/${filename}.jpg`, import.meta.url),
    );
    assert.deepEqual(
      [...bytes.subarray(0, 3)],
      [0xff, 0xd8, 0xff],
      `${filename} must be an encoded JPEG`,
    );
  }
  assert.ok(
    chapters.LOADING_CHAPTERS.armor.images[0].endsWith(
      "/level2-capital-ship.jpg",
    ),
  );
  assert.notEqual(
    chapters.LOADING_CHAPTERS.armor.images[0],
    chapters.LOADING_CHAPTERS.reactor.images[0],
  );
  assert.equal(chapters.LOADING_CHAPTERS.stage1.images.length, 2);
  assert.deepEqual(
    chapters.LOADING_CHAPTERS.finale.images,
    chapters.LOADING_CHAPTERS.trailer.images,
  );
  assert.equal(chapters.LOADING_CHAPTERS.finale.images.length, 1);
  assert.ok(
    chapters.LOADING_CHAPTERS.finale.images[0].endsWith("/finale-chairs.png"),
  );
  const finaleArt = await readFile(
    new URL("../src/assets/loading/finale-chairs.png", import.meta.url),
  );
  assert.deepEqual(
    [...finaleArt.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  assert.equal(finaleArt.readUInt32BE(16), 1920);
  assert.equal(finaleArt.readUInt32BE(20), 1080);
});

test("the full loading deck includes every chapter image before repeating", () => {
  const expectedImages = new Set(
    Object.values(chapters.LOADING_CHAPTERS).flatMap(
      (chapter) => chapter.images,
    ),
  );
  const deck = chapters.createLoadingSlideDeck("game", () => 0.5);
  const seen = new Set();
  for (let i = 0; i < expectedImages.size; i++) seen.add(deck.next().image);
  assert.deepEqual(seen, expectedImages);
});

test("developer scene choices include a dedicated epilogue shortcut after the finale", () => {
  const museum = chapters.SCENE_CHOICES.findIndex(([id]) => id === 99);
  assert.deepEqual(chapters.SCENE_CHOICES[museum + 1], [
    100,
    "Trailer - Five Chairs",
  ]);
});
