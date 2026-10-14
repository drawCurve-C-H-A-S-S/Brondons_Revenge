import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let server, chapters;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  chapters = await server.ssrLoadModule('/core/chapters.ts');
});
after(async () => server?.close());

test('the refreshed screenshots resolve to the requested loading scenes', async () => {
  const expected = [
    ['stage1', 'stage1-patrol'],
    ['cargo', 'stage2-cargo'],
    ['range', 'stage2-range'],
    ['flight', 'level2-space'],
    ['scrambler', 'level2-sidescroll'],
    ['red-scrambler', 'level2-topdown'],
    ['reactor', 'level2-reactor'],
    ['jungle', 'level3-jungle'],
    ['facility', 'facility'],
    ['finale', 'finale-orbit'],
    ['finale', 'finale-rooftop'],
  ];
  for (const [chapter, filename] of expected) {
    assert.ok(chapters.LOADING_CHAPTERS[chapter].images.some(url => url.endsWith(`/${filename}.jpg`)));
    const bytes = await readFile(new URL(`../src/assets/loading/${filename}.jpg`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], `${filename} must be an encoded JPEG`);
  }
  assert.ok(chapters.LOADING_CHAPTERS.armor.images[0].endsWith('/level2-capital-ship.jpg'));
  assert.notEqual(chapters.LOADING_CHAPTERS.armor.images[0], chapters.LOADING_CHAPTERS.reactor.images[0]);
  assert.equal(chapters.LOADING_CHAPTERS.stage1.images.length, 2);
  assert.equal(chapters.LOADING_CHAPTERS.finale.images.length, 2);
});

test('the full loading deck includes every chapter image before repeating', () => {
  const expectedImages = new Set(Object.values(chapters.LOADING_CHAPTERS).flatMap(chapter => chapter.images));
  const deck = chapters.createLoadingSlideDeck('game', () => 0.5);
  const seen = new Set();
  for (let i = 0; i < expectedImages.size; i++) seen.add(deck.next().image);
  assert.deepEqual(seen, expectedImages);
});

test('developer scene choices include a dedicated epilogue shortcut after the finale', () => {
  assert.deepEqual(chapters.SCENE_CHOICES.at(-1), [22, 'Epilogue - Rolling credits']);
});
