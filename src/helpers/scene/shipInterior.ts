import * as THREE from 'three';

export const SHIP_INTERIOR_PALETTE = {
  steel: 0x536375, dark: 0x182431, trim: 0x8395a5, cyan: 0x6ad9e8,
  background: 0x0a121d, ambient: 0x7895ae, light: 0xb6dfec,
} as const;

export function createShipInteriorMaterials(repeatX: number, repeatZ: number) {
  const steel = new THREE.MeshStandardMaterial({ color: SHIP_INTERIOR_PALETTE.steel, metalness: 0.6, roughness: 0.66 });
  const dark = new THREE.MeshStandardMaterial({ color: SHIP_INTERIOR_PALETTE.dark, metalness: 0.55, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: SHIP_INTERIOR_PALETTE.trim, metalness: 0.7, roughness: 0.4 });
  const cyan = new THREE.MeshBasicMaterial({ color: SHIP_INTERIOR_PALETTE.cyan, toneMapped: false });
  const deck = dark.clone(), pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4, shade = x % 32 < 1 || y % 32 < 1 ? 55 : 135 + (x * 13 + y * 7) % 12;
    pixels.set([shade, shade + 5, shade + 10, 255], offset);
  }

  const deckTexture = new THREE.DataTexture(pixels, 64, 64);
  deckTexture.wrapS = deckTexture.wrapT = THREE.RepeatWrapping;
  deckTexture.repeat.set(repeatX, repeatZ); deckTexture.needsUpdate = true; deck.map = deckTexture;
  return { steel, dark, trim, cyan, deck, deckTexture };
}

export function createShipTerminal(texture: THREE.Texture) {
  const root = new THREE.Group(); root.name = 'ShipTerminal';
  const steel = new THREE.MeshStandardMaterial({ color: 0x293746, roughness: 0.6, metalness: 0.65 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.1 });
  function box(size: [number, number, number], at: [number, number, number], material = steel) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...at); root.add(mesh);
  }
  box([0.48, 0.035, 0.25], [0, 0.018, 0]);
  box([0.08, 0.17, 0.07], [0, 0.1, 0]);
  box([0.66, 0.4, 0.09], [0, 0.33, 0]);
  box([0.54, 0.025, 0.17], [0, 0.014, -0.26], pale);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.name = 'TerminalScreen'; screen.rotation.y = Math.PI; screen.position.set(0, 0.33, -0.047); root.add(screen);
  return { root, screen };
}

export function createShipStorageShelf(materials: ReturnType<typeof createShipInteriorMaterials>) {
  const root = new THREE.Group(); root.name = 'ShipStorageShelf';
  const cargo = materials.steel.clone(); cargo.color.setHex(0x536b7d);
  const bands = new THREE.MeshStandardMaterial({ color: 0xdab943, metalness: 0.25, roughness: 0.52 });
  function box(size: [number, number, number], at: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  for (const x of [-1, 1]) for (const z of [-0.35, 0.35]) box([0.065, 2.55, 0.065], [x, 1.275, z], materials.trim);
  for (const y of [0.12, 0.93, 1.74, 2.55]) {
    box([2.08, 0.075, 0.8], [0, y, 0], materials.trim);
    box([2, 0.045, 0.025], [0, y + 0.055, 0.41], bands);
  }
  for (const [level, y] of [0.46, 1.27, 2.08].entries()) {
    for (const x of [-0.53, 0.53]) {
      box([0.78, 0.57, 0.57], [x, y, -0.02], cargo);
      box([0.8, 0.035, 0.59], [x, y + 0.18, -0.02], bands);
      for (const offset of [-0.24, 0.24]) box([0.045, 0.58, 0.59], [x + offset, y, -0.02], materials.dark);
      if (level === 1) box([0.23, 0.075, 0.015], [x, y + 0.05, 0.28], materials.cyan);
    }
  }
  return root;
}

export function createShipServerRack(materials: ReturnType<typeof createShipInteriorMaterials>) {
  const root = new THREE.Group(); root.name = 'ShipServerRack';
  function box(size: [number, number, number], at: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  box([0.86, 2.65, 0.8], [0, 1.325, 0], materials.dark);
  for (const x of [-0.38, 0.38]) box([0.055, 2.55, 0.045], [x, 1.325, 0.42], materials.trim);
  for (let row = 0; row < 10; row++) {
    const y = 0.3 + row * 0.235;
    box([0.65, 0.17, 0.035], [0, y, 0.42], materials.steel);
    box([0.033, 0.033, 0.045], [-0.26, y, 0.447], materials.cyan);
    for (const x of [-0.08, 0.02, 0.12, 0.22]) box([0.035, 0.085, 0.016], [x, y, 0.446], materials.dark);
  }
  return root;
}

export function createShipStatusTexture(title: string, lines: readonly string[], accent = 0x6ad9e8) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 384;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw the ship console display');
  context.fillStyle = '#06171f'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#163747'; context.lineWidth = 1;
  for (let x = 24; x < 768; x += 32) { context.beginPath(); context.moveTo(x, 24); context.lineTo(x, 360); context.stroke(); }
  for (let y = 24; y < 384; y += 32) { context.beginPath(); context.moveTo(24, y); context.lineTo(744, y); context.stroke(); }
  context.fillStyle = `#${accent.toString(16).padStart(6, '0')}`; context.font = 'bold 32px monospace';
  context.fillText(title, 32, 59);
  context.fillStyle = '#b7d9e4'; context.font = '24px monospace';
  lines.forEach((line, index) => context.fillText(line, 32, 106 + index * 39));
  context.strokeStyle = `#${accent.toString(16).padStart(6, '0')}`; context.lineWidth = 3;
  context.beginPath();
  for (let step = 0; step < 32; step++) {
    const x = 32 + step * 22, y = 329 - Math.sin(step * 0.76) * 13 - (step % 7 === 0 ? 30 : 0);
    if (step) context.lineTo(x, y); else context.moveTo(x, y);
  }
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
