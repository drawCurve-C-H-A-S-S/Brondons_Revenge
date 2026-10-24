import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createServer } from "vite";

test("green return crystals and purple player markers keep separate visual and hologram colors", async () => {
  const [teleportSource, quartersSource, stageTwoSource, mainSource] =
    await Promise.all([
      readFile(
        new URL(
          "../src/scripts/global/teleportationDevice.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/scenes/living quarters/furnishings.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../src/scenes/level 1 stage 2/scene.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    ]);
  assert.match(teleportSource, /GreenReturnCrystal/);
  assert.match(teleportSource, /0x58ff9a/);
  assert.match(
    quartersSource,
    /cabin\.id === "brondon" \? createGreenReturnCrystal/,
  );
  assert.match(
    stageTwoSource,
    /const hangingCrystal = createGreenReturnCrystal/,
  );
  assert.match(mainSource, /teleportArrivalColor = 0xbd77ff/);
  assert.match(mainSource, /teleportArrivalColor = 0x58ff9a/);
  assert.match(mainSource, /event\.code === "KeyR"/);
  assert.doesNotMatch(mainSource, /returnToBrondonRoom/);
  assert.match(mainSource, /returnToSurveillanceAnchor/);
  assert.match(stageTwoSource, /Press R to return to this room/);
});

test("hologram transitions expose a caller-selected color", async () => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { hologramTransitionAt } = await server.ssrLoadModule(
      "/scripts/player/characterManager.ts",
    );
    assert.equal(
      hologramTransitionAt(0, true, 0.18, 0x58ff9a).hologramColor,
      0x58ff9a,
    );
    assert.equal(
      hologramTransitionAt(0, true, 0.18, 0xbd77ff).hologramColor,
      0xbd77ff,
    );
  } finally {
    await server.close();
  }
});
