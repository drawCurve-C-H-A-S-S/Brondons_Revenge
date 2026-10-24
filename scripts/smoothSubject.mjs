/**
 * Adds a thin, continuous skinned surface without editing the source mesh or rig.
 * Regenerates from Subject.glb.bak, never from a previously generated shell.
 * Usage: node scripts/smoothSubject.mjs
 */
import { NodeIO } from "@gltf-transform/core";
import * as THREE from "three";
import { edgeTable, triTable } from "three/addons/objects/MarchingCubes.js";
import { MeshBVH } from "three-mesh-bvh";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THICKNESS = 0.003;
const CELL = 0.004;
const BAND = THICKNESS + CELL * 2;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "src", "assets", "models", "Subject.glb");
const BAK = SRC + ".bak";
const OUT = SRC + ".tmp";
const io = new NodeIO();
const doc = await io.read(fs.existsSync(BAK) ? BAK : SRC);
const root = doc.getRoot();
if (
  root.listMaterials().some((material) => material.getName() === "SubjectSkin")
) {
  throw new Error(
    "The original Subject backup is missing. Restore the original model before generating its skin.",
  );
}

const nodes = root.listNodes().filter((node) => node.getMesh());
if (nodes.length !== 1 || !nodes[0].getSkin()) {
  throw new Error(
    "Subject skin generation requires one mesh node with its original skeleton.",
  );
}
const mesh = nodes[0].getMesh();
const bodyMaterials = new Set([
  "SoldierSkin",
  "SuitBase",
  "SuitGloves",
  "SuitBoots",
]);
const primitives = mesh
  .listPrimitives()
  .filter((primitive) => bodyMaterials.has(primitive.getMaterial()?.getName()));
if (primitives.length !== bodyMaterials.size) {
  throw new Error(
    "Subject must contain the original head, body, gloves and boots.",
  );
}

const positions = [],
  sourceJoints = [],
  sourceWeights = [],
  indices = [];
for (const primitive of primitives) {
  const position = primitive.getAttribute("POSITION");
  const joints = primitive.getAttribute("JOINTS_0");
  const weights = primitive.getAttribute("WEIGHTS_0");
  if (
    primitive.getMode() !== 4 ||
    !position ||
    !joints ||
    !weights ||
    position.getCount() !== joints.getCount() ||
    position.getCount() !== weights.getCount()
  ) {
    throw new Error(
      "Every body primitive must contain triangles and complete skin attributes.",
    );
  }
  if (primitive.listTargets().length || primitive.getAttribute("JOINTS_1")) {
    throw new Error(
      "Subject skin generation does not support morph targets or more than four influences.",
    );
  }
  const offset = positions.length / 3;
  const vertex = [],
    joint = [],
    weight = [];
  for (let index = 0; index < position.getCount(); index++) {
    positions.push(...position.getElement(index, vertex));
    sourceJoints.push(...joints.getElement(index, joint));
    sourceWeights.push(...weights.getElement(index, weight));
  }
  const sourceIndices = primitive.getIndices()?.getArray();
  const count = sourceIndices?.length ?? position.getCount();
  if (count % 3 !== 0) throw new Error("Subject has an incomplete triangle.");
  for (let index = 0; index < count; index++) {
    const sourceIndex = sourceIndices ? sourceIndices[index] : index;
    if (sourceIndex >= position.getCount())
      throw new Error("Subject has an invalid vertex index.");
    indices.push(offset + sourceIndex);
  }
}

const source = new THREE.BufferGeometry();
source.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
source.setIndex(indices);
// BVH may reorder triangles, but does not change the vertices or skin attributes.
const bvh = new MeshBVH(source);
source.computeBoundingBox();
const bounds = source.boundingBox.clone().expandByScalar(BAND + CELL);
const origin = bounds.min;
const size = bounds.getSize(new THREE.Vector3());
const nx = Math.ceil(size.x / CELL) + 1;
const ny = Math.ceil(size.y / CELL) + 1;
const nz = Math.ceil(size.z / CELL) + 1;
const plane = nx * ny;
const field = new Float32Array(plane * nz).fill(BAND);
const triangle = new THREE.Triangle();
const point = new THREE.Vector3();
const closest = new THREE.Vector3();
const sourcePosition = source.getAttribute("position");
const sourceIndex = source.getIndex();
function readTriangle(face) {
  const a = sourceIndex.getX(face * 3);
  const b = sourceIndex.getX(face * 3 + 1);
  const c = sourceIndex.getX(face * 3 + 2);
  triangle.a.fromBufferAttribute(sourcePosition, a);
  triangle.b.fromBufferAttribute(sourcePosition, b);
  triangle.c.fromBufferAttribute(sourcePosition, c);
  return [a, b, c];
}

console.log(
  "Building a 3 mm outer skin; original geometry, skeleton and clips are unchanged.",
);
// Exact triangle distances in a narrow band retain the silhouette and finger gaps.
for (let face = 0; face < sourceIndex.count / 3; face++) {
  readTriangle(face);
  const min = triangle.a
    .clone()
    .min(triangle.b)
    .min(triangle.c)
    .addScalar(-BAND)
    .sub(origin)
    .divideScalar(CELL);
  const max = triangle.a
    .clone()
    .max(triangle.b)
    .max(triangle.c)
    .addScalar(BAND)
    .sub(origin)
    .divideScalar(CELL);
  const x0 = Math.max(0, Math.floor(min.x)),
    x1 = Math.min(nx - 1, Math.ceil(max.x));
  const y0 = Math.max(0, Math.floor(min.y)),
    y1 = Math.min(ny - 1, Math.ceil(max.y));
  const z0 = Math.max(0, Math.floor(min.z)),
    z1 = Math.min(nz - 1, Math.ceil(max.z));
  for (let z = z0; z <= z1; z++) {
    point.z = origin.z + z * CELL;
    for (let y = y0; y <= y1; y++) {
      point.y = origin.y + y * CELL;
      for (let x = x0; x <= x1; x++) {
        point.x = origin.x + x * CELL;
        const index = z * plane + y * nx + x;
        triangle.closestPointToPoint(point, closest);
        const distance = point.distanceTo(closest);
        if (distance < field[index]) field[index] = distance;
      }
    }
  }
}

// Signed winding, not odd/even parity: overlapping mannequin parts form a union.
const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
for (let z = 0; z < nz; z++) {
  for (let y = 0; y < ny; y++) {
    ray.origin.set(
      origin.x,
      origin.y + y * CELL + 1e-8,
      origin.z + z * CELL + 2e-8,
    );
    const hits = bvh
      .raycast(ray, THREE.DoubleSide)
      .sort((a, b) => a.distance - b.distance);
    let cursor = 0,
      winding = 0;
    for (let x = 0; x < nx; x++) {
      while (cursor < hits.length && hits[cursor].distance <= x * CELL) {
        const distance = hits[cursor].distance;
        let crossing = 0;
        do {
          crossing += hits[cursor].face.normal.x < 0 ? 1 : -1;
          cursor++;
        } while (
          cursor < hits.length &&
          Math.abs(hits[cursor].distance - distance) < 1e-7
        );
        winding += Math.sign(crossing);
      }
      if (winding !== 0) {
        const index = z * plane + y * nx + x;
        field[index] = -field[index];
      }
    }
  }
}

const corners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const edges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
const offsets = corners.map(([x, y, z]) => x + y * nx + z * plane);
const skinPositions = [],
  skinIndices = [];
const edgeVertices = new Map();
const cubeEdges = new Uint32Array(12);
for (let z = 0; z < nz - 1; z++) {
  for (let y = 0; y < ny - 1; y++) {
    for (let x = 0; x < nx - 1; x++) {
      const base = x + y * nx + z * plane;
      let mask = 0;
      for (let corner = 0; corner < 8; corner++) {
        if (field[base + offsets[corner]] < THICKNESS) mask |= 1 << corner;
      }
      const active = edgeTable[mask];
      if (!active) continue;
      for (let edge = 0; edge < 12; edge++) {
        if (!(active & (1 << edge))) continue;
        const [a, b] = edges[edge];
        const ca = corners[a],
          cb = corners[b];
        const axis = ca.findIndex((value, index) => value !== cb[index]);
        const key = Math.min(base + offsets[a], base + offsets[b]) * 3 + axis;
        let vertex = edgeVertices.get(key);
        if (vertex === undefined) {
          const va = field[base + offsets[a]],
            vb = field[base + offsets[b]];
          const t = (THICKNESS - va) / (vb - va);
          vertex = skinPositions.length / 3;
          skinPositions.push(
            origin.x + (x + ca[0] + t * (cb[0] - ca[0])) * CELL,
            origin.y + (y + ca[1] + t * (cb[1] - ca[1])) * CELL,
            origin.z + (z + ca[2] + t * (cb[2] - ca[2])) * CELL,
          );
          edgeVertices.set(key, vertex);
        }
        cubeEdges[edge] = vertex;
      }
      for (let entry = mask * 16; triTable[entry] !== -1; entry += 3) {
        skinIndices.push(
          cubeEdges[triTable[entry]],
          cubeEdges[triTable[entry + 2]],
          cubeEdges[triTable[entry + 1]],
        );
      }
    }
  }
}
if (!skinIndices.length)
  throw new Error("No outer skin surface could be generated.");

// Shared vertices and bounded, simultaneous smoothing avoid cracks and shrinkage.
const vertexCount = skinPositions.length / 3;
const neighbours = Array.from({ length: vertexCount }, () => new Set());
for (let index = 0; index < skinIndices.length; index += 3) {
  const face = skinIndices.slice(index, index + 3);
  for (let corner = 0; corner < 3; corner++) {
    neighbours[face[corner]].add(face[(corner + 1) % 3]);
    neighbours[face[corner]].add(face[(corner + 2) % 3]);
  }
}
let smoothed = new Float32Array(skinPositions);
for (const amount of [0.35, -0.36, 0.35, -0.36]) {
  const next = smoothed.slice();
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const adjacent = neighbours[vertex];
    if (!adjacent.size) continue;
    point.set(0, 0, 0);
    for (const neighbour of adjacent) {
      point.x += smoothed[neighbour * 3];
      point.y += smoothed[neighbour * 3 + 1];
      point.z += smoothed[neighbour * 3 + 2];
    }
    point.divideScalar(adjacent.size);
    closest.fromArray(smoothed, vertex * 3).lerp(point, amount);
    point.fromArray(skinPositions, vertex * 3);
    closest
      .sub(point)
      .clampLength(0, THICKNESS / 3)
      .add(point)
      .toArray(next, vertex * 3);
  }
  smoothed = next;
}

// Barycentric weight transfer binds the new surface to the same animated joints.
const skinJoints = new Uint16Array(vertexCount * 4);
const skinWeights = new Float32Array(vertexCount * 4);
const barycentric = new THREE.Vector3();
const hit = { point: new THREE.Vector3() };
for (let vertex = 0; vertex < vertexCount; vertex++) {
  point.fromArray(smoothed, vertex * 3);
  if (!bvh.closestPointToPoint(point, hit))
    throw new Error("Unable to bind an outer-skin vertex.");
  const face = readTriangle(hit.faceIndex);
  triangle.getBarycoord(hit.point, barycentric);
  const influences = new Map();
  for (let corner = 0; corner < 3; corner++) {
    const blend = Math.max(0, barycentric.getComponent(corner));
    for (let influence = 0; influence < 4; influence++) {
      const offset = face[corner] * 4 + influence;
      const joint = sourceJoints[offset];
      influences.set(
        joint,
        (influences.get(joint) ?? 0) + sourceWeights[offset] * blend,
      );
    }
  }
  const strongest = [...influences]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0)
    throw new Error("Outer skin has an unweighted vertex.");
  strongest.forEach(([joint, weight], influence) => {
    skinJoints[vertex * 4 + influence] = joint;
    skinWeights[vertex * 4 + influence] = weight / total;
  });
}

const skin = new THREE.BufferGeometry();
skin.setAttribute("position", new THREE.BufferAttribute(smoothed, 3));
skin.setIndex(skinIndices);
skin.computeVertexNormals();
const skinMaterial = doc
  .createMaterial("SubjectSkin")
  .setBaseColorFactor(
    primitives
      .find((primitive) => primitive.getMaterial().getName() === "SoldierSkin")
      .getMaterial()
      .getBaseColorFactor(),
  )
  .setMetallicFactor(0)
  .setRoughnessFactor(0.85);
const buffer = root.listBuffers()[0];
const accessor = (name, type, array) =>
  doc.createAccessor(name, buffer).setType(type).setArray(array);
mesh.addPrimitive(
  doc
    .createPrimitive()
    .setAttribute("POSITION", accessor("skin position", "VEC3", smoothed))
    .setAttribute(
      "NORMAL",
      accessor("skin normal", "VEC3", skin.getAttribute("normal").array),
    )
    .setAttribute("JOINTS_0", accessor("skin joints", "VEC4", skinJoints))
    .setAttribute("WEIGHTS_0", accessor("skin weights", "VEC4", skinWeights))
    .setIndices(accessor("skin indices", "SCALAR", skin.getIndex().array))
    .setMaterial(skinMaterial)
    .setExtras({ subjectOuterSkin: true, thickness: THICKNESS }),
);

// Keep the original primitives, hair, glasses, skeleton and animation data intact.
if (!fs.existsSync(BAK)) fs.copyFileSync(SRC, BAK);
try {
  fs.writeFileSync(OUT, await io.writeBinary(doc));
  fs.renameSync(OUT, SRC);
} finally {
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
}
source.dispose();
skin.dispose();
console.log(
  `Added ${vertexCount.toLocaleString()} skin vertices sharing the original skeleton.`,
);
console.log(`Output: ${SRC}\nOriginal: ${BAK}`);
