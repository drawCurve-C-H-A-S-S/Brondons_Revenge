import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

test("footsteps and clanks use independent mix levels", async () => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { FOOTSTEP_GAIN, SFX_MIX } = await server.ssrLoadModule(
      "/helpers/audio/sfx.ts",
    );
    assert.equal(FOOTSTEP_GAIN, 1.45);
    assert.equal(SFX_MIX.clank, 0.22);
    assert.equal(SFX_MIX.robotStep, undefined);
  } finally {
    await server.close();
  }
});
