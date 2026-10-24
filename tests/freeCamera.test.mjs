import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("development free camera is bound to = and pauses scene simulation", async () => {
  const [main, controller] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/core/freeCamera.ts", import.meta.url), "utf8"),
  ]);
  assert.match(main, /event\.code === "Equal"/);
  assert.match(main, /freeCamera\.update\(delta\)/);
  assert.match(main, /freeCameraOpen/);
  assert.match(controller, /WASD move/);
  assert.match(controller, /requestPointerLock/);
  assert.match(controller, /savedQuaternion/);
});
