import * as THREE from "three";
import { loadBrendanModel, loadPlayerModel } from "../../core/loader.js";
import {
  createScenePhysics,
  PHYSICS,
} from "../../helpers/physics/scenePhysics.js";
import { roomBox, disposeRoom } from "../../scripts/global/shipRoom.js";
import { applyStoneStatueShader } from "../../scripts/museum/stoneStatue.js";
import { createStarfield } from "../../scripts/global/starfield.js";
import { createPlayer } from "../../scripts/player/player.js";
import { teleportPlayer } from "../../scripts/global/teleportationDevice.js";
import { inputHint } from "../../scripts/player/gamepadInput.js";
import { createPrisonLight } from "../../scripts/global/prisonLight.js";
import {
  createBannerTexture,
  createComicLabel,
  createLogoTexture,
  createPainting,
  createTextTexture,
} from "./museumArt.js";
import {
  createDisplayFigure,
  createExhibitFigure,
  type DisplayKind,
} from "./museumExhibits.js";
import { createEscapeShip } from "../../scripts/items/createEscapeShip.js";
import { cachedAssetUrl } from "../../core/assetCache.js";
import {
  MUSEUM_EXHIBITS,
  MUSEUM_HALL,
  WING_SIGNS,
  paintingOffsets,
  type MuseumExhibit,
  type MuseumWall,
} from "./museumCatalog.js";
import fireVertexShader from "../../shaders/vert/fireExplosion.vert.glsl?raw";
import fireFragmentShader from "../../shaders/frag/fireExplosion.frag.glsl?raw";
import rollGifUrl from "../../assets/surveillance/ROLL.gif?url";

export type MuseumCharacter = "brondon" | "brendan";
interface MuseumOptions {
  character: MuseumCharacter;
  returnTo?: number;
  onEnterStage: (id: number) => Promise<unknown> | void;
  onReturnToMainMenu: () => void;
}

const { halfX: HX, halfZ: HZ, height: HEIGHT } = MUSEUM_HALL;
const PAINT_W = 5.6,
  PAINT_H = 3.5,
  PAINT_Y = 3.7,
  PEDESTAL_OFFSET = 2.7;
const OCULUS = 8;
const BANNER_SPAN: Record<"north" | "south" | "east", number> = {
  north: 14,
  south: 10,
  east: 24,
};

const FRAMES: Record<
  MuseumWall,
  { point: (s: number) => THREE.Vector3; normal: THREE.Vector3; yaw: number }
> = {
  north: {
    point: (s) => new THREE.Vector3(s, 0, -HZ),
    normal: new THREE.Vector3(0, 0, 1),
    yaw: 0,
  },
  south: {
    point: (s) => new THREE.Vector3(s, 0, HZ),
    normal: new THREE.Vector3(0, 0, -1),
    yaw: Math.PI,
  },
  west: {
    point: (s) => new THREE.Vector3(-HX, 0, s),
    normal: new THREE.Vector3(1, 0, 0),
    yaw: Math.PI / 2,
  },
  east: {
    point: (s) => new THREE.Vector3(HX, 0, s),
    normal: new THREE.Vector3(-1, 0, 0),
    yaw: -Math.PI / 2,
  },
};

function marbleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#b9b19f" : "#e2dccd";
      ctx.fillRect(x * 128, y * 128, 128, 128);
    }
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(90,84,72,${Math.random() * 0.1})`;
    ctx.lineWidth = Math.random() * 1.6;
    ctx.beginPath();
    const x = Math.random() * 256,
      y = Math.random() * 256;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 70, y + (Math.random() - 0.5) * 70);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(60,54,44,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);
  ctx.strokeRect(0, 0, 128, 128);
  ctx.strokeRect(128, 128, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set((HX * 2) / 8, (HZ * 2) / 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function stoneTexture(kind: "brick" | "column") {
  const size = 512,
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c9ba94";
  ctx.fillRect(0, 0, size, size);
  if (kind === "brick") {
    const rows = 4,
      rowH = size / rows,
      cols = 2,
      colW = size / cols;
    for (let r = 0; r < rows; r++)
      for (let c = -1; c <= cols; c++) {
        const x = c * colW + (r % 2 ? colW / 2 : 0),
          shade = 168 + Math.floor(Math.random() * 40);
        ctx.fillStyle = `rgb(${shade + 26},${shade + 8},${shade - 38})`;
        ctx.fillRect(x, r * rowH, colW, rowH);
      }
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "70,56,34" : "240,226,190"},${Math.random() * 0.14})`;
      ctx.fillRect(
        Math.random() * size,
        Math.random() * size,
        1 + Math.random() * 3,
        1 + Math.random() * 3,
      );
    }
    ctx.strokeStyle = "rgba(60,46,28,0.75)";
    ctx.lineWidth = 5;
    for (let r = 0; r < rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * rowH);
      ctx.lineTo(size, r * rowH);
      ctx.stroke();
      for (let c = 0; c <= cols; c++) {
        const x = c * colW + (r % 2 ? colW / 2 : 0) - (r % 2 ? colW : 0);
        ctx.beginPath();
        ctx.moveTo(x, r * rowH);
        ctx.lineTo(x, (r + 1) * rowH);
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = "#e6dfcc";
    ctx.fillRect(0, 0, size, size);
    const flutes = 20;
    for (let i = 0; i < flutes; i++) {
      const x = (i / flutes) * size,
        w = size / flutes;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "rgba(70,58,38,0.55)");
      g.addColorStop(0.35, "rgba(255,255,255,0.1)");
      g.addColorStop(1, "rgba(70,58,38,0.15)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, size);
    }
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = `rgba(90,80,60,${Math.random() * 0.1})`;
      ctx.fillRect(
        Math.random() * size,
        Math.random() * size,
        1,
        2 + Math.random() * 12,
      );
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function carpetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#9a1420";
  ctx.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 4) {
    ctx.fillStyle = `rgba(0,0,0,${x % 8 ? 0.07 : 0})`;
    ctx.fillRect(x, 0, 2, 128);
  }
  ctx.fillStyle = "#e2b84e";
  ctx.fillRect(0, 0, 256, 14);
  ctx.fillRect(0, 114, 256, 14);
  ctx.fillStyle = "#6e0c16";
  ctx.fillRect(0, 18, 256, 6);
  ctx.fillRect(0, 104, 256, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
export function createScene({
  character,
  returnTo,
  onEnterStage,
  onReturnToMainMenu,
}: MuseumOptions) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020510);
  const starfield = createStarfield({ scene });
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(
    72,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.05,
    900,
  );
  const mainMenuLight = createPrisonLight();
  mainMenuLight.root.name = "Main Menu exit";
  mainMenuLight.root.position.y = 0.025;
  scene.add(mainMenuLight.root);

  const wallTextures: THREE.CanvasTexture[] = [];
  const wallMaterial = (repeatX: number, repeatY: number) => {
    const map = brickMap.clone();
    map.repeat.set(repeatX, repeatY);
    map.needsUpdate = true;
    wallTextures.push(map);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.92 });
  };
  const brickMap = stoneTexture("brick"),
    shaftMap = stoneTexture("column");
  wallTextures.push(brickMap, shaftMap);
  const stone = new THREE.MeshStandardMaterial({
    color: 0xc6b793,
    roughness: 0.9,
  });
  const marble = new THREE.MeshStandardMaterial({
    color: 0xe8e1d2,
    roughness: 0.4,
    metalness: 0.05,
  });
  const shaftMaterial = new THREE.MeshStandardMaterial({
    map: shaftMap,
    roughness: 0.55,
  });
  const darkStone = new THREE.MeshStandardMaterial({
    color: 0x6f6552,
    roughness: 0.92,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd9ac45,
    roughness: 0.3,
    metalness: 0.85,
    emissive: 0x3a2808,
    emissiveIntensity: 0.6,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: marbleTexture(),
    roughness: 0.32,
    metalness: 0.04,
  });
  const box = (
    size: [number, number, number],
    point: [number, number, number],
    material: THREE.Material = stone,
    solid = true,
  ) => roomBox(scene, physics, size, point, material, solid);

  // Shell: floor, walls, and a ceiling with an open oculus to the night sky.
  box([HX * 2 + 2, 0.2, HZ * 2 + 2], [0, -0.1, 0], floorMaterial);
  const northSouthWall = wallMaterial((HX * 2 + 2) / 4, HEIGHT / 4),
    sideWall = wallMaterial((HZ * 2) / 4, HEIGHT / 4);
  box([HX * 2 + 2, HEIGHT, 1], [0, HEIGHT / 2, -HZ - 0.5], northSouthWall);
  box([HX * 2 + 2, HEIGHT, 1], [0, HEIGHT / 2, HZ + 0.5], northSouthWall);
  box([1, HEIGHT, HZ * 2], [HX + 0.5, HEIGHT / 2, 0], sideWall);
  box([1, HEIGHT, HZ * 2], [-HX - 0.5, HEIGHT / 2, 0], sideWall);
  const roofY = HEIGHT + 0.3,
    strip = HZ - OCULUS;
  box([HX * 2 + 2, 0.6, strip], [0, roofY, -HZ + strip / 2], darkStone, false);
  box([HX * 2 + 2, 0.6, strip], [0, roofY, HZ - strip / 2], darkStone, false);
  box(
    [HX - OCULUS, 0.6, OCULUS * 2],
    [-(HX + OCULUS) / 2, roofY, 0],
    darkStone,
    false,
  );
  box(
    [HX - OCULUS, 0.6, OCULUS * 2],
    [(HX + OCULUS) / 2, roofY, 0],
    darkStone,
    false,
  );
  // The oculus is a view of the sky, not a traversal exit.
  physics.addCeiling(
    { x: HX * 2 + 2, z: HZ * 2 + 2 },
    { x: 0, y: HEIGHT, z: 0 },
    0.6,
  );
  for (let x = -HX + 6; x <= HX - 6; x += 6)
    if (Math.abs(x) > OCULUS + 1)
      box([0.7, 0.55, HZ * 2], [x, HEIGHT - 0.25, 0], stone, false);
  for (const z of [-HZ + 0.4, HZ - 0.4])
    box([HX * 2, 0.4, 0.5], [0, HEIGHT - 0.6, z], gold, false);
  for (const x of [-HX + 0.4, HX - 0.4])
    box([0.5, 0.4, HZ * 2], [x, HEIGHT - 0.6, 0], gold, false);
  for (const wall of ["north", "south", "east", "west"] as const) {
    const f = FRAMES[wall],
      p = f.point(0);
    const length = wall === "north" || wall === "south" ? HX * 2 : HZ * 2;
    const skirting = box(
      wall === "north" || wall === "south"
        ? [length, 0.45, 0.2]
        : [0.2, 0.45, length],
      [p.x, 0.225, p.z],
      darkStone,
      false,
    );
    skirting.position.addScaledVector(f.normal, 0.1);
  }
  // A golden medallion beneath the oculus.
  const medallion = new THREE.Mesh(
    new THREE.RingGeometry(5.2, 5.7, 64),
    new THREE.MeshStandardMaterial({
      color: 0xd9ac45,
      emissive: 0x7a5a14,
      emissiveIntensity: 0.6,
      metalness: 0.7,
      roughness: 0.35,
    }),
  );
  medallion.rotation.x = -Math.PI / 2;
  medallion.position.y = 0.02;
  scene.add(medallion);

  // Lighting.
  scene.add(
    new THREE.AmbientLight(0xffe9c8, 0.55),
    new THREE.HemisphereLight(0xfff0d6, 0x4a4030, 1.0),
  );
  const moonlight = new THREE.DirectionalLight(0xa9bfff, 0.9);
  moonlight.position.set(-20, 60, 10);
  scene.add(moonlight);
  // Key light sits just under the roof so the ceiling does not block it; it gives the player and exhibits real floor shadows.
  const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.6);
  keyLight.position.set(7, 9.2, 5);
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.04;
  Object.assign(keyLight.shadow.camera, {
    left: -HX - 2,
    right: HX + 2,
    top: HZ + 2,
    bottom: -HZ - 2,
    near: 0.5,
    far: 20,
  });
  scene.add(keyLight, keyLight.target);
  const fireTime = { value: 0 };
  const fireGeometry = new THREE.SphereGeometry(1, 20, 14),
    fireMaterials: THREE.ShaderMaterial[] = [];
  const flames: Array<{
    mesh: THREE.Mesh;
    light: THREE.PointLight;
    phase: number;
  }> = [];
  const braziers: Array<[number, number]> = [
    [-12, -3.4],
    [-12, 3.4],
    [12, -3.4],
    [12, 3.4],
  ];
  for (const [x, z] of braziers) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.3, 0.45, 20),
      gold,
    );
    bowl.position.y = 1.2;
    group.add(bowl);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.26, 1.0, 12),
      darkStone,
    );
    stem.position.y = 0.5;
    group.add(stem);
    const uniforms = {
      uTime: fireTime,
      uProgress: { value: 0.25 },
      uIntensity: { value: 1 },
      uCameraLocal: { value: new THREE.Vector3() },
      uColorCore: { value: new THREE.Color(0xfff2b0) },
      uColorMid: { value: new THREE.Color(0xff8a1f) },
      uColorEdge: { value: new THREE.Color(0xc41608) },
      uColorSmoke: { value: new THREE.Color(0x1a1613) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: fireVertexShader,
      fragmentShader: fireFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      toneMapped: false,
    });
    fireMaterials.push(material);
    const flame = new THREE.Mesh(fireGeometry, material);
    flame.frustumCulled = false;
    flame.position.y = 1.85;
    flame.scale.set(0.5, 0.85, 0.5);
    group.add(flame);
    flame.onBeforeRender = (_renderer, _scene, viewCamera) => {
      viewCamera.getWorldPosition(uniforms.uCameraLocal.value);
      flame.worldToLocal(uniforms.uCameraLocal.value);
    };
    scene.add(group);
    physics.addBox({ x: 1.1, y: 1.6, z: 1.1 }, new THREE.Vector3(x, 0.8, z));
    const light = new THREE.PointLight(0xffa24a, 34, 24, 2);
    light.position.set(x, 2.4, z);
    scene.add(light);
    flames.push({ mesh: flame, light, phase: Math.random() * 10 });
  }

  // Columns on the gaps between paintings.
  const columnShaft = new THREE.CylinderGeometry(0.42, 0.52, HEIGHT - 1.4, 20);
  function addColumn(x: number, z: number) {
    const column = new THREE.Group();
    column.position.set(x, 0, z);
    const shaft = new THREE.Mesh(columnShaft, shaftMaterial);
    shaft.position.y = (HEIGHT - 1.4) / 2 + 0.3;
    column.add(shaft);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 1.3), marble);
    base.position.y = 0.15;
    column.add(base);
    const capital = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.5, 0.45, 4, 1),
      marble,
    );
    capital.rotation.y = Math.PI / 4;
    capital.position.y = HEIGHT - 1.3;
    column.add(capital);
    const abacus = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), marble);
    abacus.position.y = HEIGHT - 1.0;
    column.add(abacus);
    scene.add(column);
    physics.addBox(
      { x: 1.2, y: HEIGHT, z: 1.2 },
      new THREE.Vector3(x, HEIGHT / 2, z),
    );
  }
  // Paintings, pedestals and plaques.
  const paintings: Array<{
    exhibit: MuseumExhibit;
    pedestal: THREE.Vector3;
    normal: THREE.Vector3;
    yaw: number;
    draw: (t: number) => void;
    figure: THREE.Group;
    frame: THREE.Mesh;
  }> = [];
  const disposables: Array<() => void> = [];
  const figureReady: Promise<unknown>[] = [];
  const banners: Array<{ geometry: THREE.PlaneGeometry; home: Float32Array }> =
    [];
  const plaqueGeometry = new THREE.PlaneGeometry(0.78, 0.3),
    ringGeometry = new THREE.RingGeometry(0.95, 1.12, 40);
  for (const wall of ["north", "south", "east"] as const) {
    const frame = FRAMES[wall];
    const entries = paintingOffsets(wall);
    const spacing = entries[0]?.spacing ?? 8;
    const count = entries.length;
    for (let j = 0; j <= count; j++) {
      const column = frame
        .point((j - count / 2) * spacing)
        .addScaledVector(frame.normal, 0.9);
      addColumn(column.x, column.z);
    }
    entries.forEach(({ exhibit, offset }) => {
      const anchor = frame.point(offset),
        pedestalPosition = anchor
          .clone()
          .addScaledVector(frame.normal, PEDESTAL_OFFSET);
      const painting = createPainting(exhibit);
      disposables.push(painting.dispose);
      const group = new THREE.Group();
      group.position.copy(anchor).addScaledVector(frame.normal, 0.08);
      group.position.y = PAINT_Y;
      group.rotation.y = frame.yaw;
      scene.add(group);
      const frameMesh = new THREE.Mesh(
        new THREE.BoxGeometry(PAINT_W + 0.55, PAINT_H + 0.55, 0.14),
        gold,
      );
      frameMesh.position.z = 0.02;
      group.add(frameMesh);
      const canvasMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PAINT_W, PAINT_H),
        new THREE.MeshBasicMaterial({
          map: painting.texture,
          toneMapped: false,
        }),
      );
      canvasMesh.position.z = 0.1;
      group.add(canvasMesh);
      const pedestal = new THREE.Group();
      pedestal.position.copy(pedestalPosition);
      scene.add(pedestal);
      const column = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.0, 0.9),
        marble,
      );
      column.position.y = 0.5;
      pedestal.add(column);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(1.08, 0.1, 1.08),
        marble,
      );
      cap.position.y = 1.05;
      pedestal.add(cap);
      const rune = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffd36a,
          toneMapped: false,
          transparent: true,
          opacity: 0.55,
        }),
      );
      rune.rotation.x = -Math.PI / 2;
      rune.position.y = 0.02;
      pedestal.add(rune);
      physics.addBox(
        { x: 0.9, y: 1.0, z: 0.9 },
        new THREE.Vector3(pedestalPosition.x, 0.5, pedestalPosition.z),
      );
      const plaqueTexture = createTextTexture(
        [exhibit.caption.toUpperCase(), `ID ${exhibit.id}`],
        320,
        124,
        { size: 30, color: "#f4dd9a", background: "#2a1f10" },
      );
      disposables.push(() => plaqueTexture.dispose());
      const plaque = new THREE.Mesh(
        plaqueGeometry,
        new THREE.MeshBasicMaterial({ map: plaqueTexture, toneMapped: false }),
      );
      plaque.position.copy(frame.normal).multiplyScalar(0.46);
      plaque.position.y = 0.55;
      plaque.rotation.y = frame.yaw;
      pedestal.add(plaque);
      const figure = new THREE.Group();
      figure.position.y = 1.1 + (exhibit.lift ?? 0);
      pedestal.add(figure);
      figureReady.push(
        createExhibitFigure(exhibit.kind)
          .then((model) => {
            figure.add(model);
          })
          .catch((error) =>
            console.warn("[Museum] Exhibit unavailable:", exhibit.id, error),
          ),
      );
      paintings.push({
        exhibit,
        pedestal: pedestalPosition,
        normal: frame.normal,
        yaw: frame.yaw,
        draw: painting.redraw,
        figure,
        frame: canvasMesh,
      });
    });
    // A cloth banner hung across the pillars at the middle of the wall, spelling out the wing's name.
    const span = BANNER_SPAN[wall],
      bannerHeight = 2.4;
    const bannerTexture = createBannerTexture(
      WING_SIGNS[wall],
      2048,
      Math.round((2048 * bannerHeight) / span),
    );
    disposables.push(() => bannerTexture.dispose());
    const bannerGeometry = new THREE.PlaneGeometry(span, bannerHeight, 36, 1);
    disposables.push(() => bannerGeometry.dispose());
    const banner = new THREE.Mesh(
      bannerGeometry,
      new THREE.MeshStandardMaterial({
        map: bannerTexture,
        side: THREE.DoubleSide,
        roughness: 0.95,
        emissive: 0x2a0508,
        emissiveIntensity: 0.5,
      }),
    );
    const home =
      bannerGeometry.attributes.position.array.slice() as Float32Array;
    const bannerRoot = new THREE.Group();
    bannerRoot.position
      .copy(frame.point(0))
      .addScaledVector(frame.normal, 1.55);
    bannerRoot.position.y = 7.4;
    bannerRoot.rotation.y = frame.yaw;
    scene.add(bannerRoot);
    banner.position.y = -bannerHeight / 2 - 0.1;
    bannerRoot.add(banner);
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, span + 0.8, 10),
      gold,
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 0.0;
    bannerRoot.add(rod);
    for (const end of [-span / 2 - 0.4, span / 2 + 0.4]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), gold);
      knob.position.set(end, 0, 0);
      bannerRoot.add(knob);
    }
    banners.push({ geometry: bannerGeometry, home });
  }
  // The hero's end of the hall: a stepped dais, a stone statue of Brondon, and his name.
  const daisX = -HX + 7;
  box([13, 0.12, 13], [daisX, 0.06, 0], marble, false);
  box([10, 0.32, 10], [daisX, 0.16, 0], marble);
  box([3.4, 1.7, 3.4], [daisX, 1.0, 0], marble);
  const nameTexture = createTextTexture(
    ["BRONDON,", "THE BIGGEST DON"],
    1024,
    256,
    { size: 100, color: "#f6e3a4" },
  );
  disposables.push(() => nameTexture.dispose());
  const nameplate = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 0.78),
    new THREE.MeshBasicMaterial({
      map: nameTexture,
      transparent: true,
      toneMapped: false,
    }),
  );
  nameplate.position.set(daisX + 1.73, 0.95, 0);
  nameplate.rotation.y = Math.PI / 2;
  scene.add(nameplate);
  const logoTexture = createLogoTexture();
  disposables.push(() => logoTexture.dispose());
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(15, (15 * 640) / 2048),
    new THREE.MeshBasicMaterial({
      map: logoTexture,
      transparent: true,
      toneMapped: false,
    }),
  );
  logo.position.set(-HX + 0.1, 6.2, 0);
  logo.rotation.y = Math.PI / 2;
  scene.add(logo);

  // Red carpet from the entrance end of the hall up the dais steps to the statue.
  const carpetMap = carpetTexture();
  disposables.push(() => carpetMap.dispose());
  const carpetMaterial = new THREE.MeshStandardMaterial({
    map: carpetMap,
    roughness: 0.95,
  });
  const carpetRun = (fromX: number, toX: number, top: number) => {
    const length = toX - fromX,
      strip = new THREE.Mesh(
        new THREE.BoxGeometry(length, top, 3.2),
        carpetMaterial,
      );
    strip.position.set((fromX + toX) / 2, top / 2, 0);
    scene.add(strip);
  };
  carpetRun(daisX + 6.5, HX - 3, 0.025);
  carpetRun(daisX + 5, daisX + 6.5, 0.135);
  carpetRun(daisX + 1.7, daisX + 5, 0.335);
  const statueSpot = new THREE.SpotLight(0xfff0d0, 90, 22, 0.45, 0.6, 1.4);
  statueSpot.position.set(daisX + 7, 8, 0);
  statueSpot.target.position.set(daisX, 3.2, 0);
  statueSpot.castShadow = true;
  statueSpot.shadow.mapSize.set(1024, 1024);
  statueSpot.shadow.bias = -0.0005;
  scene.add(statueSpot, statueSpot.target);
  const statueRoot = new THREE.Group();
  statueRoot.position.set(daisX, 1.85, 0);
  statueRoot.rotation.y = Math.PI / 2;
  scene.add(statueRoot);
  const statueReady = loadPlayerModel()
    .then((gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(2.6);
      const pose =
        gltf.animations.find((clip) => clip.name === "Idle_Loop") ??
        gltf.animations[0];
      if (pose) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(pose).play();
        mixer.setTime(0.4);
        model.updateMatrixWorld(true);
      }
      applyStoneStatueShader(model, 1);
      const box3 = new THREE.Box3().setFromObject(model);
      model.position.y -= box3.min.y;
      statueRoot.add(model);
    })
    .catch((error) => console.warn("[Museum] Statue unavailable:", error));

  // Corner display: Brondon's ship parked at real size beside the statue, on the Level 2 (south) wall.
  const parkedShip = createEscapeShip().root;
  parkedShip.rotation.y = Math.PI / 2;
  parkedShip.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true;
  });
  const shipBox = new THREE.Box3().setFromObject(parkedShip),
    shipSize = shipBox.getSize(new THREE.Vector3()),
    shipCenter = shipBox.getCenter(new THREE.Vector3());
  const shipX = -HX + shipSize.x / 2 + 1.5,
    shipZ = HZ - shipSize.z / 2 - 1.5;
  parkedShip.position.set(
    shipX - shipCenter.x,
    -shipBox.min.y + 0.12,
    shipZ - shipCenter.z,
  );
  scene.add(parkedShip);
  box(
    [shipSize.x + 1, 0.12, shipSize.z + 1],
    [shipX, 0.06, shipZ],
    darkStone,
    false,
  );
  physics.addBox(
    { x: shipSize.x * 0.9, y: shipSize.y, z: shipSize.z * 0.9 },
    new THREE.Vector3(shipX, shipSize.y / 2, shipZ),
  );
  const shipLabelTexture = createComicLabel("BRONDON'S SHIP");
  disposables.push(() => shipLabelTexture.dispose());
  const shipLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.75),
    new THREE.MeshBasicMaterial({
      map: shipLabelTexture,
      transparent: true,
      toneMapped: false,
    }),
  );
  shipLabel.position.set(shipX, 0.5, shipZ - shipSize.z / 2 - 0.75);
  shipLabel.rotation.y = Math.PI;
  scene.add(shipLabel);

  figureReady.push(
    import("../level 2/scene15.js").then(({ createBossMesh }) => {
      if (disposed) return;
      const capitalShip = createBossMesh().root;
      capitalShip.name = "MuseumEnemyCapitalShip";
      capitalShip.rotation.y = Math.PI * 0.75;
      const bounds = new THREE.Box3().setFromObject(capitalShip);
      const size = bounds.getSize(new THREE.Vector3());
      capitalShip.scale.multiplyScalar(9 / Math.max(size.x, size.y, size.z));
      bounds.setFromObject(capitalShip);
      bounds.getSize(size);
      const center = bounds.getCenter(new THREE.Vector3());
      const x = HX - size.x / 2 - 2;
      const z = -HZ + size.z / 2 + 2;
      capitalShip.position.set(x - center.x, 0.22 - bounds.min.y, z - center.z);
      capitalShip.traverse((node) => {
        if (node instanceof THREE.Mesh)
          node.castShadow = node.receiveShadow = true;
      });
      scene.add(capitalShip);
      box([size.x + 1, 0.22, size.z + 1], [x, 0.11, z], darkStone, false);
      physics.addBox(
        size,
        new THREE.Vector3(x, 0.22 + size.y / 2, z),
      );
      const texture = createComicLabel("LEVEL 2 / ENEMY CAPITAL SHIP");
      disposables.push(() => texture.dispose());
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 0.85),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          toneMapped: false,
        }),
      );
      const inset = Math.max(size.x, size.z) / 2 + 0.75;
      label.position.set(x - inset / Math.SQRT2, 0.65, z + inset / Math.SQRT2);
      label.rotation.y = -Math.PI / 4;
      scene.add(label);
    }),
  );

  // Opposite corner: enemy showcase on stands, each with a comic label (not to scale).
  const showcase: Array<{ kind: DisplayKind; label: string }> = [
    { kind: "enemyFighter", label: "ENEMY FIGHTER" },
    { kind: "mothership", label: "THE MOTHERSHIP" },
    { kind: "bigMech", label: "THE BIG MECH" },
    { kind: "scavenger", label: "SCAVENGER" },
    { kind: "quadShell", label: "QUAD-SHELL BOT" },
    { kind: "eyeDrone", label: "EYE DRONE" },
  ];
  const showcaseFigures: THREE.Group[] = [];
  const standGeometry = new THREE.BoxGeometry(1.3, 0.9, 1.3),
    standCap = new THREE.BoxGeometry(1.5, 0.12, 1.5),
    labelGeometry = new THREE.PlaneGeometry(1.4, 0.44);
  showcase.forEach(({ kind, label }, index) => {
    const x = HX - 2.6 - (showcase.length - 1 - index) * 3.6,
      z = HZ - 3;
    const stand = new THREE.Group();
    stand.position.set(x, 0, z);
    scene.add(stand);
    const base = new THREE.Mesh(standGeometry, marble);
    base.position.y = 0.45;
    base.castShadow = base.receiveShadow = true;
    stand.add(base);
    const cap = new THREE.Mesh(standCap, gold);
    cap.position.y = 0.96;
    cap.castShadow = true;
    stand.add(cap);
    const texture = createComicLabel(label);
    disposables.push(() => texture.dispose());
    const sign = new THREE.Mesh(
      labelGeometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        toneMapped: false,
      }),
    );
    sign.position.set(0, 0.5, -0.67);
    sign.rotation.y = Math.PI;
    stand.add(sign);
    const figure = new THREE.Group();
    figure.position.y = 1.02;
    stand.add(figure);
    showcaseFigures.push(figure);
    physics.addBox({ x: 1.3, y: 1.0, z: 1.3 }, new THREE.Vector3(x, 0.5, z));
    figureReady.push(
      createDisplayFigure(kind)
        .then((model) => {
          model.traverse((node) => {
            if (node instanceof THREE.Mesh) node.castShadow = true;
          });
          figure.add(model);
        })
        .catch((error) =>
          console.warn("[Museum] Display unavailable:", kind, error),
        ),
    );
  });

  // Interactive telescope under the oculus.
  const SCOPE_POS = { x: -20, z: 8 };
  const telescope = new THREE.Group();
  telescope.position.set(SCOPE_POS.x, 0, SCOPE_POS.z);
  scene.add(telescope);
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb98a3a,
    roughness: 0.35,
    metalness: 0.8,
  });
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 + 0.4,
      leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.06, 1.7, 8),
        darkStone,
      );
    leg.position.set(Math.cos(angle) * 0.38, 0.8, Math.sin(angle) * 0.38);
    leg.rotation.set(-Math.sin(angle) * 0.4, 0, Math.cos(angle) * 0.4);
    telescope.add(leg);
  }
  const mount = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), brass);
  mount.position.y = 1.65;
  telescope.add(mount);
  const tubePivot = new THREE.Group();
  tubePivot.position.y = 1.65;
  tubePivot.rotation.z = -0.95;
  telescope.add(tubePivot);
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.13, 2.1, 20),
    brass,
  );
  tube.position.y = 0.5;
  tubePivot.add(tube);
  const lensRim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20),
    gold,
  );
  lensRim.position.y = 1.55;
  tubePivot.add(lensRim);
  const eyepiece = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 0.3, 12),
    darkStone,
  );
  eyepiece.position.y = -0.62;
  tubePivot.add(eyepiece);
  physics.addBox(
    { x: 1.6, y: 1.8, z: 1.6 },
    new THREE.Vector3(SCOPE_POS.x, 0.9, SCOPE_POS.z),
  );
  const scopeLabelTexture = createComicLabel("TELESCOPE");
  disposables.push(() => scopeLabelTexture.dispose());
  const scopeLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.44),
    new THREE.MeshBasicMaterial({
      map: scopeLabelTexture,
      transparent: true,
      toneMapped: false,
    }),
  );
  scopeLabel.position.set(SCOPE_POS.x, 0.35, SCOPE_POS.z + 0.9);
  scopeLabel.rotation.y = 0;
  scene.add(scopeLabel);
  const scopeView = document.createElement("div");
  scopeView.style.cssText =
    "position:fixed;inset:0;z-index:140;display:none;align-items:center;justify-content:center;background:#000;cursor:pointer";
  const scopeFrame = document.createElement("div");
  scopeFrame.style.cssText =
    "position:relative;display:flex;align-items:center;justify-content:center;height:min(92vh,92vw);width:min(92vh,92vw);overflow:hidden;border-radius:50%;background:#000;box-shadow:0 0 0 10px #3a2a10,0 0 0 16px #b98a3a,0 0 60px #000 inset";
  const scopeImage = document.createElement("img");
  scopeImage.alt = "ROLL animation through the museum telescope";
  scopeImage.decoding = "async";
  scopeImage.draggable = false;
  scopeImage.hidden = true;
  scopeImage.style.cssText = "width:100%;height:100%;object-fit:contain";
  const scopeStatus = document.createElement("p");
  scopeStatus.setAttribute("role", "status");
  scopeStatus.style.cssText =
    "position:absolute;max-width:70%;margin:0;text-align:center;color:#f4dd9a;font:700 18px sans-serif";
  scopeFrame.append(scopeImage, scopeStatus);
  const scopeHint = document.createElement("div");
  scopeHint.textContent = "Press E or Esc to stop looking";
  scopeHint.style.cssText =
    "position:absolute;bottom:18px;left:0;right:0;text-align:center;color:#f4dd9a;font:700 14px sans-serif";
  scopeView.append(scopeFrame, scopeHint);
  document.body.append(scopeView);
  const onScopeLoad = () => {
    scopeImage.hidden = false;
    scopeStatus.hidden = true;
  };
  const onScopeError = () => {
    scopeImage.hidden = true;
    scopeStatus.hidden = false;
    scopeStatus.textContent = "The telescope image could not load. Close and look again to retry.";
    console.error("[Museum] Could not load the telescope animation:", rollGifUrl);
  };
  scopeImage.addEventListener("load", onScopeLoad);
  scopeImage.addEventListener("error", onScopeError);
  function loadScopeImage() {
    scopeImage.hidden = true;
    scopeStatus.hidden = false;
    scopeStatus.textContent = "Loading telescope view...";
    scopeImage.src = cachedAssetUrl(rollGifUrl);
  }
  disposables.push(() => {
    scopeImage.removeEventListener("load", onScopeLoad);
    scopeImage.removeEventListener("error", onScopeError);
    scopeImage.removeAttribute("src");
    scopeView.remove();
  });

  // The player.
  const spawnFrame =
    returnTo === undefined
      ? undefined
      : paintings.find((entry) => entry.exhibit.id === returnTo);
  const spawn = spawnFrame
    ? spawnFrame.pedestal.clone().addScaledVector(spawnFrame.normal, 2.4)
    : new THREE.Vector3(HX - 6, 0, 0);
  const spawnYaw = spawnFrame
    ? Math.atan2(spawnFrame.normal.x, spawnFrame.normal.z)
    : Math.PI / 2;
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: { x: spawn.x, y: PHYSICS.playerRadius, z: spawn.z },
  });
  teleportPlayer(
    player,
    { x: spawn.x, y: player.radius, z: spawn.z },
    spawnYaw,
  );
  player.enable();

  // Brendan is a visiting avatar: the scene animates him in place of the shared Brondon model.
  const avatar = new THREE.Group();
  avatar.visible = false;
  scene.add(avatar);
  let avatarMixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | undefined,
    walkAction: THREE.AnimationAction | undefined,
    runAction: THREE.AnimationAction | undefined,
    activeAction: THREE.AnimationAction | undefined;
  const avatarReady =
    character === "brendan"
      ? loadBrendanModel()
          .then((gltf) => {
            const model = gltf.scene,
              fit = new THREE.Box3().setFromObject(model);
            model.scale.multiplyScalar(
              1.83 / Math.max(0.01, fit.getSize(new THREE.Vector3()).y),
            );
            const fitted = new THREE.Box3().setFromObject(model);
            model.position.y = -fitted.min.y;
            avatar.add(model);
            model.traverse((node) => {
              if (node instanceof THREE.Mesh) node.castShadow = true;
            });
            avatarMixer = new THREE.AnimationMixer(model);
            const find = (...names: string[]) => {
              for (const name of names) {
                const clip = gltf.animations.find((c) => c.name === name);
                if (clip) return avatarMixer!.clipAction(clip);
              }
            };
            idleAction = find("Idle_Loop", "Idle");
            walkAction = find("Walk_Loop", "Jog_Fwd_Loop", "Walk");
            runAction = find("Sprint_Loop", "Run_Loop", "Jog_Fwd_Loop", "Run");
            activeAction = idleAction;
            idleAction?.play();
            avatar.visible = true;
          })
          .catch((error) =>
            console.warn("[Museum] Brendan unavailable:", error),
          )
      : Promise.resolve();

  // Teleport-into-painting interaction.
  const prompt = document.getElementById("interact-prompt");
  const flash = document.createElement("div");
  flash.style.cssText =
    "position:fixed;inset:0;z-index:150;pointer-events:none;opacity:0;transition:opacity .45s ease;background:radial-gradient(circle,#ffffff 0%,#9fe6ff 35%,#1a3a6a 100%)";
  document.body.append(flash);
  let active = true,
    disposed = false,
    paused = false,
    entering = false,
    time = 0,
    focus: (typeof paintings)[number] | null = null;
  let nearScope = false,
    looking = false,
    nearMainMenu = false;
  function setLooking(value: boolean) {
    if (looking === value) return;
    looking = value;
    if (value) {
      loadScopeImage();
      player.disable();
      player.clearInput();
      prompt?.classList.add("hidden");
    } else {
      scopeImage.removeAttribute("src");
      player.enable();
    }
    scopeView.style.display = value ? "flex" : "none";
  }
  scopeView.addEventListener("click", () => setLooking(false));
  async function enter(entry: (typeof paintings)[number]) {
    if (entering) return;
    entering = true;
    player.disable();
    player.clearInput();
    prompt?.classList.add("hidden");
    flash.style.opacity = "1";
    await new Promise((resolve) => setTimeout(resolve, 480));
    try {
      await onEnterStage(entry.exhibit.id);
    } catch (error) {
      console.error("[Museum] Stage failed to load:", error);
    }
    if (disposed) return;
    entering = false;
    flash.style.opacity = "0";
    player.enable();
  }
  const onKey = (event: KeyboardEvent) => {
    if (
      disposed ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (looking) {
      if (event.code === "KeyE" || event.code === "Escape") {
        if (event.code === "KeyE") event.preventDefault();
        setLooking(false);
      }
      return;
    }
    if (
      event.code === "KeyE" &&
      !event.repeat &&
      active &&
      !paused &&
      !entering &&
      nearMainMenu
    ) {
      event.preventDefault();
      player.clearInput();
      onReturnToMainMenu();
      return;
    }
    if (
      event.code === "KeyE" &&
      !event.repeat &&
      active &&
      !paused &&
      !focus &&
      !entering &&
      nearScope
    ) {
      event.preventDefault();
      setLooking(true);
      return;
    }
    if (
      event.code !== "KeyE" ||
      event.repeat ||
      !active ||
      paused ||
      !focus ||
      entering
    )
      return;
    event.preventDefault();
    void enter(focus);
  };
  window.addEventListener("keydown", onKey, true);

  const lastPosition = new THREE.Vector3(spawn.x, 0, spawn.z);
  let lastClock = performance.now();
  let drawn = 0,
    shadowed = false;
  return {
    roomId: "museum",
    scene,
    camera,
    player,
    physicsWorld: physics.world,
    cutsceneManager: null,
    ready: Promise.all([...figureReady, statueReady, avatarReady]).then(
      () => undefined,
    ),
    forceThirdPerson: true,
    getMusicTrack: () => "puzzle" as const,
    controlsReady: () => active && !paused && !entering,
    setMenuPaused(value: boolean) {
      paused = value;
      player.clearInput();
    },
    updateCharacterAppearance(model: { model: THREE.Object3D } | null) {
      if (model && !shadowed) {
        shadowed = true;
        model.model.traverse((node) => {
          if (node instanceof THREE.Mesh) node.castShadow = true;
        });
      }
      if (character !== "brendan" || !model) return;
      model.model.visible = false;
      const now = performance.now(),
        dt = Math.min(0.1, (now - lastClock) / 1000);
      lastClock = now;
      const position = player.body.position;
      const speed =
        Math.hypot(position.x - lastPosition.x, position.z - lastPosition.z) /
        Math.max(dt, 1e-4);
      lastPosition.set(position.x, 0, position.z);
      avatar.position.set(position.x, position.y - player.radius, position.z);
      avatar.rotation.y = player.getState().yaw + Math.PI;
      const next = speed > 0.6
        ? (player.getState().sprinting ? runAction ?? walkAction : walkAction) ?? idleAction
        : idleAction;
      if (next && next !== activeAction) {
        activeAction?.fadeOut(0.2);
        next.reset().fadeIn(0.2).play();
        activeAction = next;
      }
      if (walkAction && activeAction === walkAction)
        walkAction.timeScale = THREE.MathUtils.clamp(speed / 2.4, 0.7, 2);
      avatarMixer?.update(dt);
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || !active || paused) return;
      const frame = Number.isFinite(dt)
        ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime)
        : 0;
      physics.step(frame, player, thirdPerson);
      time += frame;
      fireTime.value = time;
      starfield.update(time);
      mainMenuLight.update(time);
      for (const banner of banners) {
        const array = banner.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < array.length; i += 3)
          array[i + 2] =
            banner.home[i + 2] +
            Math.sin(banner.home[i] * 0.9 + time * 1.6) *
              0.07 *
              (1 - ((banner.home[i + 1] + 1.2) / 2.4) * 0.4);
        banner.geometry.attributes.position.needsUpdate = true;
      }
      for (const flame of flames) {
        const flicker =
          0.85 +
          Math.sin(time * 11 + flame.phase) * 0.12 +
          Math.sin(time * 23 + flame.phase * 2) * 0.05;
        flame.mesh.scale.set(
          0.5 * flicker,
          0.85 * (flicker + Math.sin(time * 7 + flame.phase) * 0.1),
          0.5 * flicker,
        );
        flame.light.intensity = 30 + (flicker - 0.85) * 60;
      }
      for (const figure of showcaseFigures) figure.rotation.y += frame * 0.5;
      const p = player.body.position;
      let best: typeof focus = null,
        bestDistance = 3.6;
      drawn = (drawn + 1) % 6;
      paintings.forEach((entry, index) => {
        const distance = Math.hypot(
          entry.pedestal.x - p.x,
          entry.pedestal.z - p.z,
        );
        entry.figure.rotation.y += frame * 0.7;
        if (distance < 24 && (index + drawn) % 6 === 0) entry.draw(time);
        if (distance < bestDistance) {
          best = entry;
          bestDistance = distance;
        }
      });
      focus = best;
      nearMainMenu =
        Math.hypot(p.x / 1.15, p.z / (1.15 * 1.35)) <= 1 &&
        Math.abs(p.y - player.radius) < 1;
      nearScope =
        !focus && Math.hypot(p.x - SCOPE_POS.x, p.z - SCOPE_POS.z) < 3.2;
      if (prompt && !entering && !looking) {
        if (nearMainMenu) {
          prompt.textContent = inputHint("Press E to return to Main Menu");
          prompt.classList.remove("hidden");
        } else if (focus) {
          prompt.textContent = inputHint(
            `E / Enter the painting: ${(focus as (typeof paintings)[number]).exhibit.title}`,
          );
          prompt.classList.remove("hidden");
        } else if (nearScope) {
          prompt.textContent = inputHint("E / Look through the telescope");
          prompt.classList.remove("hidden");
        } else {
          prompt.classList.add("hidden");
        }
      }
    },
    minimap: { bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ }, floor: 0 },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("keydown", onKey, true);
      flash.remove();
      prompt?.classList.add("hidden");
      disposables.forEach((dispose) => dispose());
      starfield.dispose();
      wallTextures.forEach((texture) => texture.dispose());
      fireMaterials.forEach((material) => material.dispose());
      fireGeometry.dispose();
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}

export { MUSEUM_EXHIBITS };
