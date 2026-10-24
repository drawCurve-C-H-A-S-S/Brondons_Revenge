import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("communal bathroom carries the ordered word-picture foreshadowing without a weapon pickup", async () => {
  const source = await readFile(
    new URL("../src/scenes/living quarters/bathroom.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /\["student-01", "YOU"\][\s\S]*\["student-02", "ARE"\][\s\S]*\["student-03", "A"\][\s\S]*\["student-04", "CHUMP"\][\s\S]*\["student-05", "BRONDON"\]/,
  );
  assert.match(source, /LockerShelf/);
  assert.doesNotMatch(source, /addShelfUnit/);
  assert.match(source, /addWordPicture\(locker, name, word/);
  assert.match(source, /BathroomWordPicture-/);
  assert.doesNotMatch(
    source,
    /createBloomstick|bloomstickLocker|RecoveredBloomstick/,
  );
});
