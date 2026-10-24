import { spawnSync } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ffmpeg from "ffmpeg-static";

if (!ffmpeg) throw new Error("Bark texture generation requires ffmpeg-static");

const directory = new URL("../src/assets/textures/", import.meta.url);
const maps = [
  { source: "pine-bark-diff-2k.jpg", size: 1024 },
  { source: "pine-bark-nor-1k.jpg", size: 512 },
];
let sourceBytes = 0;
const images = [];
for (const { source, size } of maps) {
  const filename = fileURLToPath(new URL(source, directory));
  sourceBytes += (await stat(filename)).size;
  const result = spawnSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      filename,
      "-frames:v",
      "1",
      "-vf",
      `scale=${size}:${size}:flags=lanczos`,
      "-pix_fmt",
      "rgba",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Could not decode ${source}: ${result.stderr.toString("utf8")}`,
    );
  if (result.stdout.byteLength !== size * size * 4)
    throw new Error(`Unexpected pixel count for ${source}`);
  images.push(result.stdout);
}
const pixels = Buffer.concat(images);
let offset = 0;
// PNG-style row differences improve gzip compression without changing the resized pixels.
for (const { size } of maps) {
  const rowBytes = size * 4;
  for (let row = 0; row < size; row++) {
    const start = offset + row * rowBytes;
    for (let index = start + rowBytes - 1; index >= start + 4; index--)
      pixels[index] -= pixels[index - 4];
  }
  offset += size * rowBytes;
}
const compressed = gzipSync(pixels, { level: 9 });
await writeFile(new URL("pine-bark.rgba.bin", directory), compressed);
console.log(
  `Bark: 1024px colour + 512px normals; ${(pixels.byteLength / 1048576).toFixed(2)} MiB base pixels`,
);
console.log(
  `${sourceBytes} source bytes -> ${compressed.byteLength} packed bytes (${(100 * (1 - compressed.byteLength / sourceBytes)).toFixed(1)}% smaller)`,
);
