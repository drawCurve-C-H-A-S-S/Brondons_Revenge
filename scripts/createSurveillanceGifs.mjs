import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "vite";
import ffmpeg from "ffmpeg-static";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rooms = [
  ["stage2-prison", "prison"],
  ["scene5", "cargo-hold"],
  ["stage2-armory", "bloomstick-tennis"],
  ["stage2-rust", "rust-chamber"],
  ["stage2-vents", "vent-maze"],
  ["scene6", "target-range"],
  ["stage2-reactor", "reactor-sequencer"],
  ["stage2-rust2", "rust-chamber-2"],
];
const execute = promisify(execFile);
const work = await mkdtemp(join(tmpdir(), "brondon-surveillance-"));
const virtualId = "virtual:surveillance-authoring";
const browserModule = `
import * as THREE from "three";
import { createStageTwoProgress } from "/scenes/level 1 stage 2/stageTwoLayout.ts";
import { prepareEnvironmentComicShading, withoutComicLook } from "/core/comicShading.ts";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(384, 216);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
let source = null;
const factories = {
  scene5: () => import("/scenes/level 1 stage 2/cargoHold.ts"),
  scene6: () => import("/scenes/level 1 stage 2/targetRange.ts"),
  "stage2-armory": () => import("/scenes/level 1 stage 2/equipmentRoom.ts"),
  "stage2-rust": () => import("/scenes/level 1 stage 2/rustChamber.ts"),
  "stage2-rust2": () => import("/scenes/level 1 stage 2/rustChamber2.ts"),
  "stage2-reactor": () => import("/scenes/level 1 stage 2/reactorSequencer.ts"),
};
window.surveillanceAuthoring = {
  async load(id) {
    source?.dispose();
    source = null;
    const progress = createStageTwoProgress();
    let data, camera;
    if (id === "stage2-prison") {
      data = (await import("/scenes/prologue/prologue_scene_1.ts")).createScene({ preview: true });
      camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 60);
      camera.position.set(3.1, 3.1, 3.9);
      camera.lookAt(0, 1.4, 0);
    } else if (id === "stage2-vents") {
      data = (await import("/scenes/level 1 stage 2/scene.ts")).createVentFeed();
      camera = data.camera;
    } else {
      data = (await factories[id]()).createScene({
        preview: true,
        remoteVisit: true,
        progress,
        loot: progress.remoteRooms[id],
      });
      if (id === "stage2-rust" || id === "stage2-rust2") camera = data.camera;
      else {
        camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 60);
        if (id === "stage2-armory") {
          camera.position.set(3.35, 2.7, 3.1);
          camera.lookAt(-0.8, 0.9, -1.8);
        } else if (id === "stage2-reactor") {
          camera.position.set(5.5, 3.6, 5.5);
          camera.lookAt(-0.5, 1.2, -4.5);
        } else {
          camera.position.set(3.3, 2.8, -3.6);
          camera.lookAt(0, 0.8, 1.8);
        }
      }
    }
    source = {
      scene: data.scene,
      camera,
      update: (dt) => {
        if (id === "stage2-prison") data.updatePrisonFeed(dt);
        else if (id === "stage2-vents") data.update(dt);
        else data.updatePhysics(dt);
      },
      dispose: () => data.dispose(),
    };
    await data.ready;
    prepareEnvironmentComicShading(source.scene);
    await renderer.compileAsync(source.scene, source.camera);
  },
  frame() {
    for (let step = 0; step < 6; step++) source.update(1 / 60);
    withoutComicLook(() => renderer.render(source.scene, source.camera));
    return renderer.domElement.toDataURL("image/png").split(",")[1];
  },
  dispose() {
    source?.dispose();
    source = null;
    renderer.dispose();
  },
};
`;

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Offline authoring browser disconnected"));
    }
    pending.clear();
  });
  return {
    opened: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Offline authoring timed out: ${method}`));
        }, 180000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => socket.close(),
  };
}

let server, browser, protocol;
try {
  const candidates = [
    process.env.SURVEILLANCE_BROWSER,
    join(
      process.env.PROGRAMFILES ?? "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    join(
      process.env["PROGRAMFILES(X86)"] ?? "",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
  ].filter(Boolean);
  let executable;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!executable)
    throw new Error("Set SURVEILLANCE_BROWSER to a Chromium executable");
  if (!ffmpeg)
    throw new Error("The existing ffmpeg-static dependency is unavailable");
  const template = (await readFile(join(root, "src", "index.html"), "utf8"))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(
      "</body>",
      `<script type="module" src="/@id/${virtualId}"></script></body>`,
    );
  server = await createServer({
    configFile: join(root, "vite.config.js"),
    root: join(root, "src"),
    cacheDir: join(work, "vite"),
    appType: "custom",
    server: { host: "127.0.0.1", port: 0, watch: null, ws: false },
    plugins: [
      {
        name: "offline-surveillance-authoring",
        enforce: "pre",
        resolveId(id) {
          if (id === virtualId) return `\0${virtualId}`;
          // The prison module imports the prologue wall, but these clips do not exist yet.
          if (
            rooms.some(([, name]) => id.endsWith(`/surveillance/${name}.gif`))
          )
            return "\0unused-authoring-footage";
        },
        load(id) {
          if (id === `\0${virtualId}`) return browserModule;
          if (id === "\0unused-authoring-footage") return 'export default "";';
        },
        configureServer(vite) {
          vite.middlewares.use(
            "/__surveillance-authoring",
            async (_request, response, next) => {
              try {
                const html = await vite.transformIndexHtml(
                  "/__surveillance-authoring",
                  template,
                );
                response.setHeader("Content-Type", "text/html");
                response.end(html);
              } catch (error) {
                next(error);
              }
            },
          );
        },
      },
    ],
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(work, "browser")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--mute-audio",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Offline browser startup timed out")),
      30000,
    );
    browser.once("error", reject);
    browser.once("exit", (code) =>
      reject(new Error(`Offline browser exited: ${code}`)),
    );
    browser.stderr.on("data", (chunk) => {
      const match = chunk
        .toString()
        .match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  protocol = connect(endpoint);
  await protocol.opened;
  const { targetId } = await protocol.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await protocol.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const evaluate = async (expression) => {
    const result = await protocol.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  await protocol.send(
    "Page.navigate",
    {
      url: `${origin}__surveillance-authoring`,
    },
    sessionId,
  );
  const deadline = Date.now() + 180000;
  while (!(await evaluate("!!window.surveillanceAuthoring"))) {
    if (Date.now() > deadline)
      throw new Error("Offline authoring module failed to load");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(
    "Offline GIF authoring ready; no game server or shared browser is used.",
  );
  for (const [id, name] of rooms) {
    console.log(`Recording ${name}`);
    await evaluate(`window.surveillanceAuthoring.load(${JSON.stringify(id)})`);
    const frames = join(work, name);
    await mkdir(frames);
    for (let frame = 0; frame < 24; frame++) {
      const png = await evaluate("window.surveillanceAuthoring.frame()");
      await writeFile(
        join(frames, `${String(frame).padStart(3, "0")}.png`),
        Buffer.from(png, "base64"),
      );
    }
    const destination = join(
      root,
      "src",
      "assets",
      "surveillance",
      `${name}.gif`,
    );
    await execute(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      "10",
      "-i",
      join(frames, "%03d.png"),
      "-filter_complex",
      "[0:v]split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop",
      "0",
      destination,
    ]);
    console.log(`Created ${name}.gif (384x216, 24 frames, 10 fps)`);
  }
  await evaluate("window.surveillanceAuthoring.dispose()");
} finally {
  if (protocol) {
    try {
      await protocol.send("Browser.close");
    } finally {
      protocol.close();
    }
  } else if (browser && browser.exitCode === null) {
    await execute("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Stop-Process -Id ${browser.pid}`,
    ]);
  }
  if (browser && browser.exitCode === null) await once(browser, "exit");
  await server?.close();
  await rm(work, { recursive: true, force: true });
}
