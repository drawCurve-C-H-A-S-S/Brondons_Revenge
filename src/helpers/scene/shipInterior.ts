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
