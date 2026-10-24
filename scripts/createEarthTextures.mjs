import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createServer } from "vite";

const directory = new URL("../src/assets/planets/", import.meta.url);
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../src/", import.meta.url)),
  server: { middlewareMode: true, watch: null, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { createEarthTextures } = await server.ssrLoadModule(
    "/scripts/global/earthTexture.ts",
  );
  const textures = createEarthTextures();
  try {
    const pixels = Buffer.concat([
      textures.colorTexture.image.data,
      textures.roughnessTexture.image.data,
      textures.cloudTexture.image.data,
    ]);
    const compressed = gzipSync(pixels, { level: 9 });
    await mkdir(directory, { recursive: true });
    // A .gz extension makes static servers decode the payload before our loader does.
    await writeFile(new URL("earth-maps.rgba.bin", directory), compressed);
    console.log(
      `Generated 2048 x 1024 Earth maps: ${(compressed.byteLength / 1048576).toFixed(2)} MiB compressed`,
    );
  } finally {
    Object.values(textures).forEach((texture) => texture.dispose());
  }
} finally {
  await server.close();
}
