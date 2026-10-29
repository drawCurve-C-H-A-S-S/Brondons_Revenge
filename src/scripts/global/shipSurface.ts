import * as THREE from "three";

export type ShipSurface = "panel" | "clean-panel" | "deck" | "machinery" | "trim" | "vent";

type SurfaceMaps = {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

// Templates retain CPU pixels; material-owned clones share their texture source.
// Disposing a room releases its clones without disposing another room's materials.
const templates = new Map<ShipSurface, SurfaceMaps>();
const RESOLUTION = 512;
const surfaceSize: Record<ShipSurface, number> = {
  panel: 2.8,
  "clean-panel": 2.8,
  deck: 2,
  machinery: 2,
  trim: 1,
  vent: 1.4,
};

function noise(x: number, y: number, salt = 0) {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function generateSurface(kind: ShipSurface): SurfaceMaps {
  const cached = templates.get(kind);
  if (cached) return cached;
  const size = RESOLUTION;
  const color = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const properties = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const deck = kind === "deck";
  const trim = kind === "trim";
  const machinery = kind === "machinery";
  const vent = kind === "vent";
  const clean = kind === "clean-panel";
  const cellWidth = deck ? 256 : size;
  const cellHeight = trim ? size : 256;
  const smooth = THREE.MathUtils.smoothstep;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x % cellWidth;
      const py = y % cellHeight;
      const edge = Math.min(px, cellWidth - 1 - px, py, cellHeight - 1 - py);
      const seam = trim ? 0 : 1 - smooth(edge, 2, 7);
      const bevel = trim ? 0 : smooth(edge, 5, 9) * (1 - smooth(edge, 10, 15));
      const grain = noise(x, y);
      const panelTone = noise(Math.floor(x / cellWidth), Math.floor(y / cellHeight), 91);
      let shade = 207 + panelTone * 16 + (grain - 0.5) * 5;
      let relief = 0.5 - seam * 0.23 + bevel * 0.035;
      let roughness = trim ? 0.37 : deck ? 0.76 : machinery ? 0.7 : 0.66;
      let metalness = trim ? 0.94 : deck ? 0.72 : machinery ? 0.62 : 0.12;
      shade *= 1 - seam * 0.68;
      shade += bevel * 13;

      if (trim) {
        shade += (noise(Math.floor(x / 24), y, 71) - 0.5) * 16;
        roughness += (noise(Math.floor(x / 32), y) - 0.5) * 0.12;
      } else {
        // Four recessed fasteners per plate, with a readable slot and metal rim.
        const boltX = Math.min(Math.abs(px - 20), Math.abs(px - (cellWidth - 21)));
        const boltY = Math.min(Math.abs(py - 20), Math.abs(py - (cellHeight - 21)));
        const bolt = Math.hypot(boltX, boltY);
        if (bolt < 7) {
          const rim = smooth(bolt, 4.5, 6.5);
          shade = THREE.MathUtils.lerp(105, 220, rim);
          relief = 0.47 + rim * 0.1;
          metalness = 0.92;
          roughness = 0.42;
          if (boltX < 1.3 && boltY < 4.5) {
            shade = 62;
            relief = 0.4;
          }
        }

        if (deck && edge > 34) {
          const row = Math.floor(py / 32);
          const diagonal = ((px + (row % 2 ? py : -py)) % 64 + 64) % 64;
          const tread = smooth(diagonal, 2, 5) * (1 - smooth(diagonal, 14, 17)) *
            smooth(py % 32, 6, 9) * (1 - smooth(py % 32, 23, 26));
          relief += tread * 0.065;
          shade += tread * 13;
          roughness -= tread * 0.12;
        }

        if ((vent || machinery) && px > 58 && px < cellWidth - 58 && py > 62 && py < 190) {
          const slot = smooth(py % 22, 2, 5) * (1 - smooth(py % 22, 13, 17));
          shade *= 1 - slot * (vent ? 0.7 : 0.45);
          relief -= slot * 0.16;
        }

        if (!deck && !vent && !machinery) {
          const hatchX = Math.abs(px - 360);
          const hatchY = Math.abs(py - 126);
          if (hatchX < 67 && hatchY < 63) {
            const border = 1 - smooth(Math.min(67 - hatchX, 63 - hatchY), 2, 5);
            shade = shade * (0.96 - border * 0.5);
            relief -= 0.03 + border * 0.12;
          }
        }

        // Wear follows seams and fasteners instead of covering whole panels in rust.
        const grime = (1 - smooth(edge, 8, 36)) * noise(Math.floor(x / 12), Math.floor(y / 12), 31);
        shade *= 1 - grime * (clean ? 0.035 : 0.13);
        roughness += grime * 0.14;
        if (!clean && edge > 8 && edge < 18 && noise(Math.floor(x / 4), Math.floor(y / 3), 103) > 0.86) {
          shade += 19;
          metalness = 0.84;
          roughness = 0.44;
        }
        const scratch = py % 113;
        if (!clean && scratch > 44 && scratch < 46 && px > 90 && px < 167) {
          shade += 12;
          roughness -= 0.1;
        }
      }
      const offset = (y * size + x) * 4;
      const value = Math.round(THREE.MathUtils.clamp(shade, 0, 255));
      color.set([value, value, value, 255], offset);
      height[y * size + x] = relief;
      properties.set([
        255,
        Math.round(THREE.MathUtils.clamp(roughness + (grain - 0.5) * 0.035, 0, 1) * 255),
        Math.round(metalness * 255),
        255,
      ], offset);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size]) * 3;
      const dy = (height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]) * 3;
      const inverseLength = 1 / Math.hypot(dx, dy, 1);
      normal.set([
        Math.round((-dx * inverseLength * 0.5 + 0.5) * 255),
        Math.round((-dy * inverseLength * 0.5 + 0.5) * 255),
        Math.round((inverseLength * 0.5 + 0.5) * 255),
        255,
      ], (y * size + x) * 4);
    }
  }
  function texture(pixels: Uint8Array<ArrayBuffer>, name: string, srgb = false) {
    const result = new THREE.DataTexture(pixels, size, size);
    result.name = `Ship-${kind}-${name}`;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 4;
    result.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.needsUpdate = true;
    return result;
  }
  const result = {
    map: texture(color, "color", true),
    normalMap: texture(normal, "normal"),
    roughnessMap: texture(properties, "roughness-metalness"),
  };
  templates.set(kind, result);
  return result;
}

export function createShipSurfaceMaterial(kind: ShipSurface, color: THREE.ColorRepresentation) {
  const source = generateSurface(kind);
  const map = source.map.clone();
  const normalMap = source.normalMap.clone();
  const roughnessMap = source.roughnessMap.clone();
  for (const texture of [map, normalMap, roughnessMap]) texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    color,
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 1,
    metalness: 1,
    roughnessMap,
    metalnessMap: roughnessMap,
  });
  material.name = `ShipSurface-${kind}`;
  material.userData.shipSurface = kind;
  return material;
}

/** Called by the existing scene-addition tracker, never as a per-frame world scan. */
export function prepareShipSurfaceMesh(mesh: THREE.Mesh) {
  if (mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.SkinnedMesh ||
      mesh.userData.shipSurfaceMapped) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const material = materials.find((candidate) => candidate.userData.shipSurface) as
    THREE.MeshStandardMaterial | undefined;
  if (!material) return;
  const kind = material.userData.shipSurface as ShipSurface;
  const tileSize = surfaceSize[kind];
  if (!tileSize || !mesh.geometry.getAttribute("normal") || !mesh.geometry.getAttribute("uv")) return;
  const geometry = mesh.geometry.clone();
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  mesh.updateWorldMatrix(true, false);
  const scale = mesh.getWorldScale(new THREE.Vector3());
  for (let i = 0; i < positions.count; i++) {
    const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
    const x = positions.getX(i) * scale.x;
    const y = positions.getY(i) * scale.y;
    const z = positions.getZ(i) * scale.z;
    let u: number, v: number;
    if (Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz)) {
      u = x;
      v = -z * Math.sign(ny);
    } else if (Math.abs(nx) > Math.abs(nz)) {
      u = -z * Math.sign(nx);
      v = y;
    } else {
      u = x * Math.sign(nz);
      v = y;
    }
    uv.setXY(i, u / tileSize, v / tileSize);
  }
  uv.needsUpdate = true;
  mesh.geometry = geometry;
  mesh.userData.shipSurfaceMapped = true;
}
