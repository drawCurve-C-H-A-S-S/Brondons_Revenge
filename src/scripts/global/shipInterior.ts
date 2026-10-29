import * as THREE from "three";
import { createShipSurfaceMaterial } from "./shipSurface.js";
export { createShipSurfaceMaterial } from "./shipSurface.js";

export const SHIP_INTERIOR_PALETTE = {
  steel: 0x536375,
  dark: 0x182431,
  trim: 0x8395a5,
  cyan: 0x6ad9e8,
  background: 0x0a121d,
  ambient: 0x7895ae,
  light: 0xb6dfec,
} as const;

// Legacy repeat arguments remain accepted; structural UVs now use physical meters.
export function createShipInteriorMaterials(
  _repeatX: number,
  _repeatZ: number,
  profile: "industrial" | "crew" | "command" = "industrial",
) {
  const steel = createShipSurfaceMaterial(
    profile === "crew" ? "clean-panel" : "panel",
    profile === "crew" ? 0x9daeb7 : profile === "command" ? 0x788fa3 : 0x81909c,
  );
  const dark = createShipSurfaceMaterial("machinery", 0x3b4a58);
  const trim = createShipSurfaceMaterial("trim", SHIP_INTERIOR_PALETTE.trim);
  const cyan = new THREE.MeshBasicMaterial({
    color: SHIP_INTERIOR_PALETTE.cyan,
    toneMapped: false,
  });
  const deck = createShipSurfaceMaterial("deck", profile === "crew" ? 0x536573 : 0x435260);
  const deckTexture = deck.map!;
  return { steel, dark, trim, cyan, deck, deckTexture };
}

/** Cosmetic overhead services stay out of navigation, cover, and doorway collision. */
export function createShipServiceDetails({
  width,
  depth,
  height,
  x = 0,
  y = 0,
  z = 0,
  yaw = 0,
  spacing = 4,
  ribs = true,
  label = "SHIP SYSTEMS / SERVICE ACCESS",
  accent = SHIP_INTERIOR_PALETTE.cyan,
}: {
  width: number;
  depth: number;
  height: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  spacing?: number;
  ribs?: boolean;
  label?: string;
  accent?: number;
}) {
  const root = new THREE.Group();
  root.name = "ShipOverheadServices";
  root.position.set(x, y, z);
  root.rotation.y = yaw;
  root.userData.minimap = false;
  root.userData.teleportIgnore = true;
  const steel = new THREE.MeshStandardMaterial({ color: 0x748796, metalness: 0.7, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24333f, metalness: 0.45, roughness: 0.76 });
  const light = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  const batches = new Map<THREE.Material, THREE.Matrix4[]>();
  const transform = new THREE.Object3D();
  function box(size: [number, number, number], position: [number, number, number], material: THREE.Material, angle = 0) {
    transform.position.set(...position);
    transform.scale.set(...size);
    transform.rotation.set(0, 0, angle);
    transform.updateMatrix();
    const matrices = batches.get(material) ?? [];
    matrices.push(transform.matrix.clone());
    batches.set(material, matrices);
  }
  const half = width / 2;
  for (const side of [-1, 1]) {
    box([0.32, 0.16, depth - 0.6], [side * (half - 0.38), height - 0.14, 0], dark);
    for (const offset of [-0.1, 0.1])
      box([0.035, 0.045, depth - 0.7], [side * (half - 0.38) + offset, height - 0.245, 0], steel);
    // Short luminous sections give direction without adding more real lights.
    for (let along = -depth / 2 + 1.4; along < depth / 2 - 0.7; along += spacing) {
      box([0.022, 0.025, Math.min(1.2, spacing * 0.4)], [side * (half - 0.58), height - 0.1, along], light);
      box([0.46, 0.035, 0.09], [side * (half - 0.38), height - 0.27, along], steel);
      if (ribs)
        box([0.12, 0.56, 0.17], [side * (half - 0.28), height - 0.37, along], steel, side * -Math.PI / 4);
    }
  }
  if (ribs)
    for (let along = -depth / 2 + 1.4; along < depth / 2 - 0.7; along += spacing)
      box([width - 0.18, 0.14, 0.2], [0, height - 0.075, along], steel);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const [material, matrices] of batches) {
    const mesh = new THREE.InstancedMesh(boxGeometry, material, matrices.length);
    mesh.name = "ShipServiceBatch";
    mesh.userData.minimap = false;
    mesh.userData.teleportIgnore = true;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const pipeGeometry = new THREE.CylinderGeometry(0.055, 0.055, depth - 0.75, 8);
  pipeGeometry.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(pipeGeometry, steel);
    pipe.position.set(side * (half - 0.8), height - 0.2, 0);
    pipe.userData.minimap = false;
    root.add(pipe);
  }
  const ventMaterial = createShipSurfaceMaterial("vent", 0x697d89);
  const ventGeometry = new THREE.BoxGeometry(0.7, 0.035, 1.3);
  for (let along = -depth / 2 + 2.4; along < depth / 2 - 1; along += spacing * 2) {
    const vent = new THREE.Mesh(ventGeometry, ventMaterial);
    vent.name = "ShipCeilingVent";
    vent.position.set(half - 1.25, height - 0.025, along);
    vent.userData.minimap = false;
    root.add(vent);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#18242e";
    context.fillRect(0, 0, 768, 128);
    context.fillStyle = "#c3a254";
    for (let i = -128; i < 768; i += 56) {
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i + 24, 0);
      context.lineTo(i + 42, 18);
      context.lineTo(i + 18, 18);
      context.fill();
    }
    context.fillStyle = "#d8e3e8";
    context.font = "bold 30px monospace";
    context.textAlign = "center";
    context.fillText(label, 384, 77, 720);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.3),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  sign.name = "ShipServiceStencil";
  sign.position.set(half - 0.11, height - 0.48, -depth / 2 + 1.8);
  sign.rotation.y = -Math.PI / 2;
  root.add(sign);
  return root;
}

export function createShipTerminal(texture: THREE.Texture) {
  const root = new THREE.Group();
  root.name = "ShipTerminal";
  const steel = new THREE.MeshStandardMaterial({
    color: 0x293746,
    roughness: 0.6,
    metalness: 0.65,
  });
  const pale = new THREE.MeshStandardMaterial({
    color: 0xbfcad0,
    roughness: 0.8,
    metalness: 0.1,
  });
  function box(
    size: [number, number, number],
    at: [number, number, number],
    material = steel,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    root.add(mesh);
  }
  box([0.48, 0.035, 0.25], [0, 0.018, 0]);
  box([0.08, 0.17, 0.07], [0, 0.1, 0]);
  box([0.66, 0.4, 0.09], [0, 0.33, 0]);
  box([0.54, 0.025, 0.17], [0, 0.014, -0.26], pale);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.34),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  screen.name = "TerminalScreen";
  screen.rotation.y = Math.PI;
  screen.position.set(0, 0.33, -0.047);
  root.add(screen);
  return { root, screen };
}

export function createShipStorageShelf(
  materials: ReturnType<typeof createShipInteriorMaterials>,
) {
  const root = new THREE.Group();
  root.name = "ShipStorageShelf";
  const cargo = materials.steel.clone();
  cargo.color.setHex(0x536b7d);
  const bands = new THREE.MeshStandardMaterial({
    color: 0xdab943,
    metalness: 0.25,
    roughness: 0.52,
  });
  function box(
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  for (const x of [-1, 1])
    for (const z of [-0.35, 0.35])
      box([0.065, 2.55, 0.065], [x, 1.275, z], materials.trim);
  for (const y of [0.12, 0.93, 1.74, 2.55]) {
    box([2.08, 0.075, 0.8], [0, y, 0], materials.trim);
    box([2, 0.045, 0.025], [0, y + 0.055, 0.41], bands);
  }
  for (const [level, y] of [0.46, 1.27, 2.08].entries()) {
    for (const x of [-0.53, 0.53]) {
      box([0.78, 0.57, 0.57], [x, y, -0.02], cargo);
      box([0.8, 0.035, 0.59], [x, y + 0.18, -0.02], bands);
      for (const offset of [-0.24, 0.24])
        box([0.045, 0.58, 0.59], [x + offset, y, -0.02], materials.dark);
      if (level === 1)
        box([0.23, 0.075, 0.015], [x, y + 0.05, 0.28], materials.cyan);
    }
  }
  return root;
}

export function createShipServerRack(
  materials: ReturnType<typeof createShipInteriorMaterials>,
) {
  const root = new THREE.Group();
  root.name = "ShipServerRack";
  function box(
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  box([0.86, 2.65, 0.8], [0, 1.325, 0], materials.dark);
  for (const x of [-0.38, 0.38])
    box([0.055, 2.55, 0.045], [x, 1.325, 0.42], materials.trim);
  for (let row = 0; row < 10; row++) {
    const y = 0.3 + row * 0.235;
    box([0.65, 0.17, 0.035], [0, y, 0.42], materials.steel);
    box([0.033, 0.033, 0.045], [-0.26, y, 0.447], materials.cyan);
    for (const x of [-0.08, 0.02, 0.12, 0.22])
      box([0.035, 0.085, 0.016], [x, y, 0.446], materials.dark);
  }
  return root;
}

export function createShipStatusTexture(
  title: string,
  lines: readonly string[],
  accent = 0x6ad9e8,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to draw the ship console display");
  context.fillStyle = "#06171f";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#163747";
  context.lineWidth = 1;
  for (let x = 24; x < 768; x += 32) {
    context.beginPath();
    context.moveTo(x, 24);
    context.lineTo(x, 360);
    context.stroke();
  }
  for (let y = 24; y < 384; y += 32) {
    context.beginPath();
    context.moveTo(24, y);
    context.lineTo(744, y);
    context.stroke();
  }
  context.fillStyle = `#${accent.toString(16).padStart(6, "0")}`;
  context.font = "bold 32px monospace";
  context.fillText(title, 32, 59);
  context.fillStyle = "#b7d9e4";
  context.font = "24px monospace";
  lines.forEach((line, index) => context.fillText(line, 32, 106 + index * 39));
  context.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
  context.lineWidth = 3;
  context.beginPath();
  for (let step = 0; step < 32; step++) {
    const x = 32 + step * 22,
      y = 329 - Math.sin(step * 0.76) * 13 - (step % 7 === 0 ? 30 : 0);
    if (step) context.lineTo(x, y);
    else context.moveTo(x, y);
  }
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
