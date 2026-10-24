import * as THREE from "three";
import * as CANNON from "cannon-es";
import { loadBrendanModel } from "../../core/loader.js";
import {
  createBrendanBehavior,
  type BrendanActivity,
} from "./brendanBehavior.js";
import type { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { createSlidingPortal, roomBox, disposeRoom } from "./shipRoom.js";
import {
  createEscapePod,
  createEscapeShip,
} from "../items/createEscapeShip.js";
import type { PlayerTransitionState } from "../player/player.js";
import { createBreakableDebris } from "./breakables.js";
import {
  createJungleWater,
  JUNGLE_WATER_COLORS,
} from "../level-3/jungleWater.js";
import { createJungleTextures } from "../level-3/jungleTextures.js";
import {
  CONIFER_PARTS,
  JUNGLE_GRASS_RANGE,
  JUNGLE_GRASS_SPACING,
  createJungleFoliageGeometry,
  createJungleFoliageMaterials,
  createJungleView,
  partitionJungleInstances,
  writeConifer,
  writeGrassTuft,
} from "../level-3/jungleFoliage.js";
import {
  createFallingPinecones,
  type PineconeTree,
} from "../level-3/fallingPinecones.js";
import waterfallVertex from "../../shaders/vert/waterfall.vert.glsl?raw";
import waterfallFragment from "../../shaders/frag/waterfall.frag.glsl?raw";
import waterNoise from "../../shaders/waterNoise.glsl?raw";
import mountainRock from "../../shaders/mountainRock.glsl?raw";
import {
  FACILITY,
  FACILITY_DOOR_Z,
  createFacilityArchitecture,
} from "./facilityArchitecture.js";

export interface RescueArrival {
  pilotState?: PlayerTransitionState;
  hullHealth?: number;
  waterfallDefeated?: boolean;
  bossImmunityCollected?: boolean;
  waterfallAchievementUnlocked?: boolean;
  facilitySolved?: boolean;
  cameraPosition?: THREE.Vector3;
  cameraQuaternion?: THREE.Quaternion;
  cameraFov?: number;
}
export interface WaterfallCharacterContact {
  position: { x: number; y: number; z: number };
  headY: number;
  radius: number;
}
export const WATERFALL_LEDGE = {
  minX: -108,
  maxX: -77.5,
  minZ: 6,
  maxZ: 28,
  y: 0.06,
  thickness: 0.8,
} as const;
export const RESCUE_SITE = {
  landingOffset: new THREE.Vector3(-66, 0, 72),
  clearing: new THREE.Vector3(-66, 0, 84),
  pod: new THREE.Vector3(-60, 1.05, 82),
  podRotation: new THREE.Euler(0, -2.06, 0.18),
  ship: new THREE.Vector3(-74, 0.65, 87),
  boy: new THREE.Vector3(-61.8, 0, 85.4),
  player: new THREE.Vector3(-63, 0.3, 85),
  doorZ: FACILITY_DOOR_Z,
  bridge: new THREE.Vector3(-42, 0, 17),
  riverY: -1.8,
  riverZ: 17,
  riverHalfWidth: 7,
  mountainX: -84,
  west: -240,
  east: 72,
};
export const JUNGLE_PATH = new THREE.CatmullRomCurve3(
  [
    [-63, 85],
    [-59, 67],
    [-57, 49],
    [-46, 34],
    [-42, 26],
    [-42, 8],
    [-29, -10],
    [-24, -30],
    [-7, -41],
    [0, FACILITY_DOOR_Z + 4],
    [0, FACILITY_DOOR_Z - 4],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  "centripetal",
);
export const JUNGLE_ROUTE = JUNGLE_PATH.getSpacedPoints(240);
export const WATERFALL_PATH = new THREE.CatmullRomCurve3(
  [
    [-46, 34],
    [-62, 31],
    [-78, 28],
    [-81, 23],
    [-81, 17],
    [-92, 17],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  "centripetal",
);
const WATERFALL_ROUTE = WATERFALL_PATH.getSpacedPoints(70);
const EXPLORATION_PATHS = [
  [
    [-63, 120],
    [-64, 102],
    [-63, 85],
  ],
  [
    [-59, 67],
    [-33, 92],
    [10, 104],
    [49, 82],
    [46, 50],
    [14, 32],
    [-42, 26],
  ],
  [
    [-42, 8],
    [-63, -8],
    [-71, -49],
    [-50, -91],
    [-7, -109],
    [42, -96],
    [57, -58],
    [26, -17],
    [-29, -10],
  ],
].map(
  (points) =>
    new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      "centripetal",
    ),
);
const EXPLORATION_ROUTES = EXPLORATION_PATHS.flatMap((path) =>
  path.getSpacedPoints(Math.ceil(path.getLength() / 2)),
);
const TRAIL_CELLS = new Map<string, THREE.Vector3[]>();
for (const point of [
  ...JUNGLE_ROUTE,
  ...WATERFALL_ROUTE,
  ...EXPLORATION_ROUTES,
]) {
  const column = Math.floor(point.x / 8),
    row = Math.floor(point.z / 8);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const key = `${column + dx},${row + dz}`,
        points = TRAIL_CELLS.get(key) ?? [];
      points.push(point);
      TRAIL_CELLS.set(key, points);
    }
}
export function jungleTrailDistance(x: number, z: number) {
  let distance = Infinity;
  for (const point of TRAIL_CELLS.get(
    `${Math.floor(x / 8)},${Math.floor(z / 8)}`,
  ) ?? []) {
    distance = Math.min(distance, (point.x - x) ** 2 + (point.z - z) ** 2);
  }
  return Math.sqrt(distance);
}
export function isJungleGrassSite(x: number, z: number) {
  const onBridge =
    Math.abs(x - RESCUE_SITE.bridge.x) < 3.4 &&
    Math.abs(z - RESCUE_SITE.bridge.z) < 12.2;
  const inFacility =
    Math.hypot(x - FACILITY.x, z - FACILITY.z) < FACILITY.radius + 2;
  return (
    !onBridge &&
    !inFacility &&
    jungleTrailDistance(x, z) >= 3.2 &&
    Math.abs(z - RESCUE_SITE.riverZ) >= RESCUE_SITE.riverHalfWidth + 1
  );
}
const entryDirection = new THREE.Vector3(0, 0, RESCUE_SITE.doorZ)
  .sub(RESCUE_SITE.player)
  .setY(0)
  .normalize();
export const JUNGLE_ENTRY_YAW = Math.atan2(
  -entryDirection.x,
  -entryDirection.z,
);

/** Scene-owned resources with identical placement in the landing film and playable exterior. */
export function createRescueSite(
  physics: ReturnType<typeof createScenePhysics>,
  {
    culling = false,
    bridgeBrokenAtStart = false,
  }: {
    culling?: boolean;
    bridgeBrokenAtStart?: boolean;
    facilityFootprint?: { width: number; depth: number };
  } = {},
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(culling ? 0x698475 : 0x9cae98);
  scene.fog = new THREE.Fog(0x698475, 55, 230);
  physics.world.broadphase = new CANNON.SAPBroadphase(physics.world);
  const surfaceTextures = createJungleTextures();
  const chunkSize = 32;
  type Point = { x: number; y: number; z: number };
  type PhysicsChunk = {
    bodies: CANNON.Body[];
    bounds: THREE.Box3;
    active: boolean;
  };
  const physicsChunks = new Map<string, PhysicsChunk>();
  const renderChunks: Array<{
    mesh: THREE.InstancedMesh;
    farMesh?: THREE.InstancedMesh;
    range: number;
    shadows: boolean;
    detailed: boolean;
    lod?: "near" | "far";
  }> = [];
  const instanceLocations = new Map<
    THREE.InstancedMesh,
    Array<{ mesh: THREE.InstancedMesh; index: number }>
  >();
  const distantProps: Array<{
    root: THREE.Object3D;
    center: THREE.Vector3;
    range: number;
    farMesh?: THREE.Mesh;
    detailed?: boolean;
    bounds?: THREE.Box3;
    dynamic?: boolean;
  }> = [];
  function distanceSquared(bounds: THREE.Box3, point: Point) {
    const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
    const dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
    return dx * dx + dz * dz;
  }
  // Collision streaming is independent of camera visibility: off-screen cover stays solid.
  function trackStaticBody(body: CANNON.Body) {
    if (!culling) return;
    const key = `${Math.floor(body.position.x / chunkSize)},${Math.floor(body.position.z / chunkSize)}`;
    let chunk = physicsChunks.get(key);
    if (!chunk) {
      chunk = { bodies: [], bounds: new THREE.Box3(), active: false };
      physicsChunks.set(key, chunk);
    }
    body.updateAABB();
    chunk.bounds.expandByPoint(new THREE.Vector3().copy(body.aabb.lowerBound));
    chunk.bounds.expandByPoint(new THREE.Vector3().copy(body.aabb.upperBound));
    chunk.bodies.push(body);
    if (!chunk.active && body.world === physics.world)
      physics.world.removeBody(body);
  }
  function setPhysicsActive(chunk: PhysicsChunk, active: boolean) {
    if (chunk.active === active) return;
    chunk.active = active;
    for (const body of chunk.bodies) {
      if (active && body.world !== physics.world) physics.world.addBody(body);
      else if (!active && body.world === physics.world)
        physics.world.removeBody(body);
    }
  }
  function activatePhysicsNear(point: Point) {
    for (const chunk of physicsChunks.values())
      if (!chunk.active && distanceSquared(chunk.bounds, point) < 18 * 18)
        setPhysicsActive(chunk, true);
  }
  function updateActivePhysics(points: readonly Point[]) {
    for (const chunk of physicsChunks.values()) {
      const radius = chunk.active ? 24 : 18;
      setPhysicsActive(
        chunk,
        points.some(
          (point) => distanceSquared(chunk.bounds, point) < radius * radius,
        ),
      );
    }
  }
  // Each batch has tight bounds, so the renderer culls it separately for the view and shadow cameras.
  function addJungleBatch(
    source: THREE.InstancedMesh,
    range: number,
    lod?: "near" | "far",
    parent: THREE.Object3D = scene,
  ) {
    source.instanceMatrix.needsUpdate = true;
    if (!culling) {
      instanceLocations.set(
        source,
        Array.from({ length: source.count }, (_, index) => ({
          mesh: source,
          index,
        })),
      );
      source.computeBoundingBox();
      source.computeBoundingSphere();
      parent.add(source);
      return;
    }
    const { locations, meshes } = partitionJungleInstances(source);
    instanceLocations.set(source, locations);
    const farGeometry =
      source.name === "JungleTrunks"
        ? new THREE.CylinderGeometry(0.5, 1, 1, 3)
        : undefined;
    for (const mesh of meshes) {
      parent.add(mesh);
      let farMesh: THREE.InstancedMesh | undefined;
      if (farGeometry) {
        farMesh = new THREE.InstancedMesh(
          farGeometry,
          source.material,
          mesh.count,
        );
        farMesh.name = `${mesh.name}/distant`;
        farMesh.position.copy(mesh.position);
        farMesh.frustumCulled = true;
        farMesh.instanceMatrix = mesh.instanceMatrix;
        farMesh.instanceColor = mesh.instanceColor;
        farMesh.computeBoundingBox();
        farMesh.computeBoundingSphere();
        farMesh.updateMatrix();
        farMesh.matrixAutoUpdate = false;
        farMesh.raycast = mesh.raycast;
        farMesh.visible = false;
        parent.add(farMesh);
      }
      renderChunks.push({
        mesh,
        farMesh,
        range,
        shadows: source.castShadow,
        detailed: true,
        lod,
      });
    }
    source.dispose();
  }
  const grassMap = surfaceTextures.grass;
  grassMap.repeat.set(64, 50);
  const dirt = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    vertexColors: true,
    map: grassMap,
  });
  let seed = 170916;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const obstacles: Array<{ x: number; z: number; radius: number }> = [];
  const pineconeTrees: PineconeTree[] = [];
  const jungleObstacleBodies = new WeakSet<CANNON.Body>();
  type TreePart = { source: THREE.InstancedMesh; index: number };
  const obstacleVisuals = new Map<
    CANNON.Body,
    {
      entry: (typeof obstacles)[number];
      rock?: THREE.Mesh;
      farMesh?: THREE.Mesh;
      size?: THREE.Vector3;
      parts?: TreePart[];
    }
  >();
  const pendingImpacts: Array<{
    body: CANNON.Body;
    from: Point;
    disintegrate: boolean;
  }> = [];
  const fallingTrees: Array<{
    age: number;
    direction: THREE.Vector3;
    disintegrate: boolean;
    parts: Array<{
      mesh: THREE.InstancedMesh;
      index: number;
      rest: THREE.Matrix4;
      pivot: THREE.Vector3;
    }>;
  }> = [];
  const rockDebris = createBreakableDebris(scene, 0x58654a);
  function breakJungleObstacle(body: CANNON.Body, from: Point) {
    if (
      obstacleVisuals.has(body) &&
      !pendingImpacts.some((impact) => impact.body === body)
    ) {
      pendingImpacts.push({
        body,
        from: { x: from.x, y: from.y, z: from.z },
        disintegrate: false,
      });
    }
  }
  function disintegrateTrees(center: Point, radius: number) {
    const positions: Point[] = [],
      radiusSquared = radius * radius;
    for (const [body, visual] of obstacleVisuals) {
      if (!visual.parts?.length) continue;
      const dx = visual.entry.x - center.x,
        dz = visual.entry.z - center.z;
      if (dx * dx + dz * dz > radiusSquared) continue;
      if (pendingImpacts.some((impact) => impact.body === body)) continue;
      positions.push({
        x: visual.entry.x,
        y: body.position.y + 8,
        z: visual.entry.z,
      });
      pendingImpacts.push({
        body,
        from: { x: center.x, y: center.y, z: center.z },
        disintegrate: true,
      });
    }
    return positions;
  }
  function applyObstacleImpacts() {
    for (const { body, from, disintegrate } of pendingImpacts.splice(0)) {
      const visual = obstacleVisuals.get(body);
      if (!visual) continue;
      obstacleVisuals.delete(body);
      const { entry, rock, farMesh, size, parts } = visual;
      obstacles.splice(obstacles.indexOf(entry), 1);
      if (body.world === physics.world) physics.world.removeBody(body);
      for (const chunk of physicsChunks.values()) {
        const index = chunk.bodies.indexOf(body);
        if (index >= 0) chunk.bodies.splice(index, 1);
      }
      if (rock && size) {
        rock.visible = false;
        if (farMesh) farMesh.visible = false;
        const distant = distantProps.findIndex((prop) => prop.root === rock);
        if (distant >= 0) distantProps.splice(distant, 1);
        rockDebris.emit(rock.position, size);
      }
      if (parts) {
        const direction = new THREE.Vector3(
          entry.x - from.x,
          0,
          entry.z - from.z,
        ).normalize();
        if (!direction.lengthSq()) direction.set(1, 0, 0);
        fallingTrees.push({
          age: 0,
          direction,
          disintegrate,
          parts: parts.map((part) => {
            const { mesh, index } = instanceLocations.get(part.source)![
                part.index
              ],
              rest = new THREE.Matrix4();
            mesh.getMatrixAt(index, rest);
            mesh.frustumCulled = false;
            return {
              mesh,
              index,
              rest,
              pivot: new THREE.Vector3(
                entry.x - mesh.position.x,
                0,
                entry.z - mesh.position.z,
              ),
            };
          }),
        });
      }
    }
  }
  const fallMatrix = new THREE.Matrix4(),
    fallRotation = new THREE.Matrix4(),
    fallOffset = new THREE.Matrix4(),
    fallAxis = new THREE.Vector3();
  const scaleMatrix = new THREE.Matrix4();
  function updateFallingTrees(dt: number) {
    for (let i = fallingTrees.length - 1; i >= 0; i--) {
      const tree = fallingTrees[i];
      tree.age = Math.min(1.4, tree.age + dt);
      const progress = THREE.MathUtils.smoothstep(tree.age, 0, 1.4);
      const tilt =
        progress * (tree.disintegrate ? Math.PI * 0.06 : Math.PI * 0.48);
      fallAxis.set(tree.direction.z, 0, -tree.direction.x);
      fallRotation.makeRotationAxis(fallAxis, tilt);
      for (const { mesh, index, rest, pivot } of tree.parts) {
        mesh.frustumCulled = false;
        fallMatrix
          .makeTranslation(pivot.x, pivot.y, pivot.z)
          .multiply(fallRotation)
          .multiply(fallOffset.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
          .multiply(rest);
        if (tree.disintegrate) {
          const scale = Math.max(0.001, 1 - progress);
          fallMatrix.multiply(scaleMatrix.makeScale(scale, scale, scale));
        }
        mesh.setMatrixAt(index, fallMatrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (tree.age >= 1.4) {
        for (const { mesh, index } of tree.parts) {
          if (tree.disintegrate) {
            mesh.setMatrixAt(index, scaleMatrix.makeScale(0, 0, 0));
            mesh.instanceMatrix.needsUpdate = true;
          }
        }
        for (const mesh of new Set(tree.parts.map((part) => part.mesh))) {
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
          mesh.frustumCulled = true;
          const chunk = renderChunks.find((item) => item.mesh === mesh);
          chunk?.farMesh?.computeBoundingBox();
          chunk?.farMesh?.computeBoundingSphere();
        }
        fallingTrees.splice(i, 1);
      }
    }
  }
  function nearestPathPoint(x: number, z: number) {
    let index = 0,
      distance = Infinity;
    JUNGLE_ROUTE.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < distance) {
        distance = d;
        index = i;
      }
    });
    return { index, distance: Math.sqrt(distance) };
  }
  function clearing(x: number, z: number, margin = 0) {
    return (
      ((x - RESCUE_SITE.clearing.x) / (25 + margin)) ** 2 +
        ((z - RESCUE_SITE.clearing.z) / (23 + margin)) ** 2 <
      1
    );
  }
  const facility = (x: number, z: number, margin = 0) =>
    Math.hypot(x - FACILITY.x, z - FACILITY.z) < FACILITY.radius + margin;
  const routeDistance = jungleTrailDistance;
  let bridgeBroken = false;
  const river = (z: number, margin = 0) =>
    Math.abs(z - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth + margin;
  const waterfallLedge = (x: number, z: number, radius = 0) =>
    x > WATERFALL_LEDGE.minX + radius &&
    x < WATERFALL_LEDGE.maxX - radius &&
    z > WATERFALL_LEDGE.minZ + radius &&
    z < WATERFALL_LEDGE.maxZ - radius;
  const isWalkable = (x: number, z: number, radius = 0.6) =>
    x > RESCUE_SITE.west + radius &&
    x < RESCUE_SITE.east - radius &&
    Math.abs(z) < 118 &&
    (x > RESCUE_SITE.mountainX + radius ||
      (x > -106 + radius && z > 9 + radius && z < 25 - radius)) &&
    (!river(z) ||
      waterfallLedge(x, z, radius) ||
      (!bridgeBroken &&
        Math.abs(x - RESCUE_SITE.bridge.x) < Math.max(0.2, 2.03 - radius))) &&
    !facility(x, z) &&
    !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius);
  const gray = new THREE.MeshStandardMaterial({
    color: 0x727b80,
    roughness: 0.9,
    metalness: 0.08,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x353e43,
    roughness: 0.72,
    metalness: 0.45,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0xe15848,
    emissive: 0xcc3024,
    emissiveIntensity: 1.2,
  });
  const box = (
    s: [number, number, number],
    p: [number, number, number],
    m: THREE.Material = gray,
    solid = true,
  ) => {
    const mesh = roomBox(scene, physics, s, p, m, solid);
    if (culling && !solid)
      distantProps.push({
        root: mesh,
        center: mesh.position.clone(),
        range: 85,
      });
    return mesh;
  };
  // Duplicate edge rows form river cliffs exactly at the collision banks (z=10 and z=24).
  const terrainRows: Array<{ z: number; y: number }> = [];
  for (let z = -120; z <= 9; z += 3) terrainRows.push({ z, y: 0 });
  terrainRows.push({ z: 10, y: 0 }, { z: 10, y: -4.5 });
  for (let z = 12; z < 24; z += 3) terrainRows.push({ z, y: -4.5 });
  terrainRows.push({ z: 24, y: -4.5 }, { z: 24, y: 0 });
  for (let z = 27; z <= 120; z += 3) terrainRows.push({ z, y: 0 });
  const groundGeometry = new THREE.PlaneGeometry(
    RESCUE_SITE.east - RESCUE_SITE.west,
    240,
    128,
    terrainRows.length - 1,
  );
  groundGeometry.rotateX(-Math.PI / 2);
  groundGeometry.translate((RESCUE_SITE.east + RESCUE_SITE.west) / 2, 0, 0);
  const colors = new Float32Array(groundGeometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    const row = terrainRows[Math.floor(i / 3 / 129)],
      x = groundGeometry.attributes.position.getX(i / 3),
      z = row.z;
    groundGeometry.attributes.position.setY(i / 3, row.y);
    groundGeometry.attributes.position.setZ(i / 3, z);
    const n = 0.65 + random() * 0.35,
      soil = clearing(x, z) || routeDistance(x, z) < 2.8;
    colors.set(
      soil ? [n, n * 0.88, n * 0.66] : [n * 0.56, n * 0.86, n * 0.45],
      i,
    );
  }
  groundGeometry.computeVertexNormals();
  groundGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeometry, dirt);
  ground.receiveShadow = true;
  scene.add(ground);
  const terrainWidth = RESCUE_SITE.east - RESCUE_SITE.west,
    terrainCenter = (RESCUE_SITE.east + RESCUE_SITE.west) / 2;
  physics.addBox(
    { x: terrainWidth, y: 4.5, z: 96 },
    { x: terrainCenter, y: -2.25, z: 72 },
  );
  physics.addBox(
    { x: terrainWidth, y: 4.5, z: 130 },
    { x: terrainCenter, y: -2.25, z: -55 },
  );
  physics.addBox(
    { x: terrainWidth, y: 1, z: 14 },
    { x: terrainCenter, y: -5, z: RESCUE_SITE.riverZ },
  );
  for (const x of [RESCUE_SITE.west + 1, RESCUE_SITE.east - 1])
    physics.addBox({ x: 2, y: 120, z: 240 }, { x, y: 59, z: 0 });
  for (const z of [-119, 119])
    physics.addBox(
      { x: terrainWidth, y: 120, z: 2 },
      { x: terrainCenter, y: 59, z },
    );
  const riverWater = createJungleWater(scene, {
    x: terrainCenter,
    y: RESCUE_SITE.riverY,
    z: RESCUE_SITE.riverZ,
    halfWidth: RESCUE_SITE.riverHalfWidth,
    length: terrainWidth,
  });
  const water = riverWater.mesh;
  const bridge = new THREE.Group();
  bridge.name = "OldStoneTrailBridge";
  bridge.position.copy(RESCUE_SITE.bridge);
  scene.add(bridge);
  const timber = new THREE.MeshStandardMaterial({
    color: 0x61513c,
    roughness: 0.95,
  });
  const planks = Array.from({ length: 18 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.22, 0.94), timber);
    mesh.position.set(0, 0.12, -8.5 + i);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bridge.add(mesh);
    return { mesh, rest: mesh.position.clone() };
  });
  const supports: Array<{ mesh: THREE.Mesh; rest: THREE.Vector3 }> = [];
  const railingBodies: CANNON.Body[] = [];
  for (const x of [-2.15, 2.15]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 18), timber);
    beam.position.set(x, -0.18, 0);
    bridge.add(beam);
    supports.push({ mesh: beam, rest: beam.position.clone() });
    for (const z of [-8, -4, 0, 4, 8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), timber);
      post.position.set(x, 0.7, z);
      bridge.add(post);
      supports.push({ mesh: post, rest: post.position.clone() });
      railingBodies.push(physics.addBoxFromMesh(post));
    }
    for (const z of [0]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.15, 18),
        timber,
      );
      rail.position.set(x, 1.3, z);
      bridge.add(rail);
      supports.push({ mesh: rail, rest: rail.position.clone() });
      railingBodies.push(
        physics.addBox(
          { x: 0.24, y: 1.35, z: 18 },
          { x: RESCUE_SITE.bridge.x + x, y: 0.72, z: RESCUE_SITE.bridge.z },
        ),
      );
    }
  }
  const bridgeBody = physics.addBox(
    { x: 4.8, y: 0.3, z: 18 },
    { x: RESCUE_SITE.bridge.x, y: 0.08, z: RESCUE_SITE.bridge.z },
  );
  const bridgeBodies = [bridgeBody, ...railingBodies];
  // Overlap both banks and the deck; the top faces rise continuously from soil to planks.
  for (const side of [-1, 1]) {
    const slope = Math.atan2(0.25, 2.6);
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 0.2, Math.hypot(2.6, 0.25)),
      timber,
    );
    ramp.rotation.x = side * slope;
    ramp.position.set(
      RESCUE_SITE.bridge.x,
      0.105 - 0.1 * Math.cos(slope),
      RESCUE_SITE.bridge.z + side * 9.9,
    );
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    scene.add(ramp);
    bridgeBodies.push(physics.addBoxFromMesh(ramp));
    supports.push({ mesh: ramp, rest: ramp.position.clone() });
  }
  function damageBridge(age: number) {
    if (bridgeBroken) return;
    const hit = THREE.MathUtils.smoothstep(age, 0, 0.45);
    supports.forEach((part, index) => {
      if (part.rest.x < 0) {
        part.mesh.rotation.z = hit * (0.12 + (index % 3) * 0.08);
        part.mesh.position.y = part.rest.y - hit * 0.25;
      }
    });
    for (const plank of planks)
      if (plank.rest.z > 4) {
        plank.mesh.rotation.z = hit * 0.1;
        plank.mesh.position.y = plank.rest.y - hit * 0.12;
      }
  }
  function breakBridge(age: number) {
    if (!bridgeBroken) {
      bridgeBroken = true;
      for (const body of bridgeBodies)
        if (body.world) physics.world.removeBody(body);
    }
    const visible = age < 0.8;
    bridge.visible = visible;
    for (let i = 0; i < planks.length; i++) {
      const p = planks[i],
        t = Math.max(0, age - Math.abs(i - 9) * 0.035);
      p.mesh.visible = visible;
      p.mesh.position.copy(p.rest);
      p.mesh.position.y -= Math.min(4.8, t * t * 5);
      p.mesh.position.x += Math.sin(i * 5) * Math.min(1.5, t);
      p.mesh.rotation.set(
        Math.min(1.5, t) * Math.sin(i),
        0,
        Math.min(2, t) * Math.cos(i * 3),
      );
    }
    supports.forEach((part, index) => {
      part.mesh.visible = visible;
      const t = Math.max(0, age - (index % 3) * 0.08);
      part.mesh.position
        .copy(part.rest)
        .add(
          new THREE.Vector3(
            Math.sign(part.rest.x) * Math.min(2, t),
            -Math.min(5.2, t * t * 4.9),
            Math.sin(index) * t,
          ),
        );
      part.mesh.rotation.set(
        t * Math.sin(index),
        t * 0.3,
        Math.sign(part.rest.x) * Math.min(1.8, t),
      );
    });
  }
  if (bridgeBrokenAtStart) breakBridge(2.4);
  const mountain = new THREE.Group();
  mountain.name = "ImpassableWesternMountain";
  scene.add(mountain);
  const cliffMaterial = new THREE.MeshStandardMaterial({
    name: "WeatheredMountainRock",
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  cliffMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vRockWorldPosition;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvRockWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vRockWorldPosition;\n${mountainRock}`,
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb *= mountainSurface(vRockWorldPosition);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec3 rockNormal = inverseTransformDirection(normal, viewMatrix);
        vec3 rockDx = dFdx(vRockWorldPosition), rockDy = dFdy(vRockWorldPosition);
        vec3 rockR1 = cross(rockDy, rockNormal), rockR2 = cross(rockNormal, rockDx);
        float rockDet = dot(rockDx, rockR1);
        float rockHeight = mountainBump(vRockWorldPosition);
        vec3 rockGradient = sign(rockDet) * (dFdx(rockHeight) * rockR1 + dFdy(rockHeight) * rockR2);
        normal = normalize(mat3(viewMatrix) * (max(abs(rockDet), 0.00001) * rockNormal - rockGradient));`,
      );
  };
  cliffMaterial.customProgramCacheKey = () => "weathered-mountain-rock-v1";
  const ridgeHeight = (z: number) =>
    76 +
    Math.sin(z * 0.045) * 9 +
    Math.cos(z * 0.113) * 6 +
    Math.sin(z * 0.27) * 2;
  const summitHeight = (x: number, z: number) => {
    const inland = Math.max(0, (-x - 97) / 142);
    return (
      ridgeHeight(z) +
      Math.sin(inland * Math.PI) * 25 +
      inland *
        (Math.sin(z * 0.063 + inland * 9) * 16 +
          Math.cos(z * 0.11 - inland * 7) * 9)
    );
  };
  const faceX = (z: number, height: number) =>
    -81.5 -
    height * 0.17 +
    Math.sin(z * 0.13 + height * 0.09) * 2.3 +
    Math.sin(z * 0.38 - height * 0.16) * 0.9;
  const faceVertices: number[] = [],
    faceIndices: number[] = [],
    faceRows = 28,
    faceColumns = 80;
  const openingEdges = new Map<string, [number, number]>();
  function openingEdge(a: number, b: number) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (openingEdges.has(key)) openingEdges.delete(key);
    else openingEdges.set(key, [a, b]);
  }
  for (let row = 0; row <= faceRows; row++)
    for (let column = 0; column <= faceColumns; column++) {
      const z = -120 + column * 3,
        y = row === 0 ? -4.5 : ((row - 1) / (faceRows - 1)) * ridgeHeight(z);
      faceVertices.push(faceX(z, Math.max(0, y)), y, z);
    }
  for (let row = 0; row < faceRows; row++)
    for (let column = 0; column < faceColumns; column++) {
      const a = row * (faceColumns + 1) + column,
        b = a + faceColumns + 1;
      const z = -120 + (column + 0.5) * 3,
        y = (faceVertices[a * 3 + 1] + faceVertices[b * 3 + 1]) / 2;
      if (row > 0 && ((z - 17) / 7.9) ** 2 + ((y - 3) / 5.5) ** 2 < 1) {
        openingEdge(a, b);
        openingEdge(b, b + 1);
        openingEdge(b + 1, a + 1);
        openingEdge(a + 1, a);
        continue;
      }
      faceIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }

  // Use the cliff's exact hole boundary as the first tunnel ring, including shared normals.
  const nextRimVertex = new Map<number, number>();
  for (const [a, b] of openingEdges.values()) {
    if (nextRimVertex.has(a))
      throw new Error("Waterfall cave opening has an ambiguous boundary");
    nextRimVertex.set(a, b);
  }
  const firstRimVertex = nextRimVertex.keys().next().value;
  if (firstRimVertex === undefined)
    throw new Error("Waterfall cave opening is missing");
  const caveRim: number[] = [];
  let rimVertex = firstRimVertex;
  do {
    caveRim.push(rimVertex);
    const next = nextRimVertex.get(rimVertex);
    if (next === undefined || caveRim.length > openingEdges.size)
      throw new Error("Waterfall cave opening is not a closed loop");
    rimVertex = next;
  } while (rimVertex !== firstRimVertex);
  if (caveRim.length !== openingEdges.size)
    throw new Error("Waterfall cave has disconnected opening boundaries");

  const caveRings = 12,
    caveRingIndices = [caveRim];
  for (let ring = 1; ring <= caveRings; ring++) {
    const t = ring / caveRings,
      blend = THREE.MathUtils.smoothstep(t, 0, 0.25),
      indices: number[] = [];
    for (const vertex of caveRim) {
      const x = faceVertices[vertex * 3],
        y = faceVertices[vertex * 3 + 1],
        z = faceVertices[vertex * 3 + 2];
      const angle = Math.atan2((y - 3.35) / 4.6, (z - 17) / 6.9);
      const radius =
        1 +
        Math.sin(angle * 3 + t * 4.1) * 0.055 +
        Math.cos(angle * 5 - t * 2.7) * 0.035;
      const innerY = Math.max(
        0,
        3.35 + Math.sin(angle) * (4.6 - t * 0.65) * radius,
      );
      const innerZ =
        17 +
        Math.cos(angle) * (6.9 - t * 0.2) * radius +
        Math.sin(t * Math.PI) * 0.35;
      indices.push(faceVertices.length / 3);
      faceVertices.push(
        THREE.MathUtils.lerp(x, -108, t),
        THREE.MathUtils.lerp(y, innerY, blend),
        THREE.MathUtils.lerp(z, innerZ, blend),
      );
    }
    caveRingIndices.push(indices);
  }
  for (let ring = 0; ring < caveRings; ring++)
    for (let side = 0; side < caveRim.length; side++) {
      const next = (side + 1) % caveRim.length,
        a = caveRingIndices[ring][side],
        b = caveRingIndices[ring + 1][side];
      faceIndices.push(
        a,
        caveRingIndices[ring][next],
        b,
        caveRingIndices[ring][next],
        caveRingIndices[ring + 1][next],
        b,
      );
    }
  const caveBack = faceVertices.length / 3;
  faceVertices.push(-108.35, 3.35, 17);
  const finalRing = caveRingIndices[caveRings];
  for (let side = 0; side < caveRim.length; side++)
    faceIndices.push(
      caveBack,
      finalRing[(side + 1) % caveRim.length],
      finalRing[side],
    );

  const cliffGeometry = new THREE.BufferGeometry();
  cliffGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(faceVertices, 3),
  );
  cliffGeometry.setIndex(faceIndices);
  cliffGeometry.computeVertexNormals();
  const cliff = new THREE.Mesh(cliffGeometry, cliffMaterial);
  cliff.name = "WesternMountainAndWaterfallCave";
  cliff.castShadow = cliff.receiveShadow = true;
  mountain.add(cliff);
  const ridge = new THREE.PlaneGeometry(142, 240, 24, 60);
  ridge.rotateX(-Math.PI / 2);
  ridge.translate(-168, 0, 0);
  const ridgePositions = ridge.getAttribute("position");
  for (let index = 0; index < ridgePositions.count; index++) {
    ridgePositions.setY(
      index,
      summitHeight(ridgePositions.getX(index), ridgePositions.getZ(index)),
    );
  }
  ridge.computeVertexNormals();
  const summit = new THREE.Mesh(ridge, cliffMaterial);
  summit.castShadow = summit.receiveShadow = true;
  mountain.add(summit);
  const seamVertices: number[] = [],
    seamIndices: number[] = [];
  for (let column = 0; column <= faceColumns; column++) {
    const z = -120 + column * 3,
      height = ridgeHeight(z);
    seamVertices.push(faceX(z, height), height, z, -97, height, z);
    if (column < faceColumns) {
      const a = column * 2;
      seamIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(seamVertices, 3),
  );
  seamGeometry.setIndex(seamIndices);
  seamGeometry.computeVertexNormals();
  const seamMaterial = cliffMaterial.clone();
  seamMaterial.side = THREE.DoubleSide;
  seamMaterial.onBeforeCompile = cliffMaterial.onBeforeCompile;
  seamMaterial.customProgramCacheKey = cliffMaterial.customProgramCacheKey;
  mountain.add(new THREE.Mesh(seamGeometry, seamMaterial));
  for (const [size, position] of [
    [
      [156, 100, 129],
      [-162, 45.5, -55.5],
    ],
    [
      [156, 100, 95],
      [-162, 45.5, 72.5],
    ],
    [
      [156, 92, 16],
      [-162, 54, 17],
    ],
    [
      [132, 100, 16],
      [-174, 45.5, 17],
    ],
  ] as const)
    physics.addBox(
      { x: size[0], y: size[1], z: size[2] },
      { x: position[0], y: position[1], z: position[2] },
    );
  const caveRockGeometry = new THREE.DodecahedronGeometry(1, 0);
  for (let index = 0; index < 14; index++) {
    const side = index % 2 ? 1 : -1,
      x = -84 - Math.floor(index / 2) * 3.3;
    const rock = new THREE.Mesh(caveRockGeometry, cliffMaterial);
    rock.position.set(
      x,
      1.3 + Math.sin(index) * 0.25,
      17 + side * (7.3 - index * 0.035),
    );
    rock.scale.set(1.3, 1.7, 1.2);
    rock.rotation.set(index * 0.2, index, 0);
    mountain.add(rock);
    physics.addBox({ x: 2, y: 2.8, z: 1.6 }, rock.position);
    if (index % 3 === 0) {
      const stalactite = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, 1.7, 6),
        cliffMaterial,
      );
      stalactite.rotation.z = Math.PI;
      stalactite.position.set(x, 6.4, 17 + side * 3.2);
      mountain.add(stalactite);
    }
  }
  for (let z = -110; z <= 110; z += 20) {
    if (z > -2 && z < 36) continue;
    const face = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      cliffMaterial,
    );
    face.position.set(-87, 25, z);
    face.scale.set(5, 30 + Math.sin(z) * 5, 13);
    mountain.add(face);
  }
  const ledgeSize = new THREE.Vector3(
    WATERFALL_LEDGE.maxX - WATERFALL_LEDGE.minX,
    WATERFALL_LEDGE.thickness,
    WATERFALL_LEDGE.maxZ - WATERFALL_LEDGE.minZ,
  );
  const ledge = new THREE.Mesh(
    new THREE.BoxGeometry(ledgeSize.x, ledgeSize.y, ledgeSize.z),
    cliffMaterial,
  );
  ledge.name = "WaterfallStonePathSupport";
  ledge.position.set(
    (WATERFALL_LEDGE.minX + WATERFALL_LEDGE.maxX) / 2,
    WATERFALL_LEDGE.y - ledgeSize.y / 2,
    (WATERFALL_LEDGE.minZ + WATERFALL_LEDGE.maxZ) / 2,
  );
  ledge.castShadow = ledge.receiveShadow = true;
  mountain.add(ledge);
  const ledgeBody = physics.addBox(ledgeSize, ledge.position);
  const waterfallRoot = new THREE.Group();
  let waterfallVisible = true;
  waterfallRoot.name = "HiddenWaterfallArena";
  scene.add(waterfallRoot);
  const waterfallSheetX = (z: number, y: number) =>
    faceX(z, Math.max(0, y)) + 1.6;
  const waterfallOrigin = new THREE.Vector3(
    waterfallSheetX(17, 0),
    RESCUE_SITE.riverY,
    17,
  );
  const waterfallHeight =
    ridgeHeight(waterfallOrigin.z) - waterfallOrigin.y + 0.2;
  const waterfallUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uHeight: { value: waterfallHeight },
    uMode: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    uOrigin: { value: waterfallOrigin },
    uViewportHeight: { value: window.innerHeight },
    uDeepColor: { value: new THREE.Color(JUNGLE_WATER_COLORS.deep) },
    uContact: { value: new THREE.Vector4() },
    uContactHeight: { value: 0 },
    uContactStrength: { value: 0 },
    uWaterColor: { value: new THREE.Color(JUNGLE_WATER_COLORS.shallow) },
    uFoamColor: { value: new THREE.Color(JUNGLE_WATER_COLORS.foam) },
    uSkyColor: { value: new THREE.Color(JUNGLE_WATER_COLORS.sky) },
    uForestColor: { value: new THREE.Color(JUNGLE_WATER_COLORS.forest) },
    uSunColor: { value: new THREE.Color(JUNGLE_WATER_COLORS.sun) },
    uSunDirection: { value: new THREE.Vector3(-40, 90, 30).normalize() },
  };
  const waterfallShader = waterfallFragment.replace(
    "#include <jungle_water_noise>",
    waterNoise,
  );
  const waterfallMaterial = new THREE.ShaderMaterial({
    name: "FlowingWaterfall",
    uniforms: waterfallUniforms,
    vertexShader: waterfallVertex,
    fragmentShader: waterfallShader,
    side: THREE.DoubleSide,
    depthWrite: true,
    toneMapped: true,
    fog: true,
  });
  const waterfallCurtain = new THREE.Mesh(
    new THREE.PlaneGeometry(16, waterfallHeight, 48, 168),
    waterfallMaterial,
  );
  const curtainVertices = waterfallCurtain.geometry.getAttribute("position");
  for (let index = 0; index < curtainVertices.count; index++) {
    const t =
      (curtainVertices.getY(index) + waterfallHeight / 2) / waterfallHeight;
    const across = curtainVertices.getX(index) * (1 - t * 0.28),
      z = waterfallOrigin.z - across;
    const y = THREE.MathUtils.lerp(waterfallOrigin.y, ridgeHeight(z) + 0.2, t);
    curtainVertices.setX(index, across);
    curtainVertices.setY(index, y - waterfallOrigin.y - waterfallHeight / 2);
    curtainVertices.setZ(index, waterfallSheetX(z, y) - waterfallOrigin.x);
  }
  waterfallCurtain.geometry.computeVertexNormals();
  waterfallCurtain.name = "RiverWaterfall";
  waterfallCurtain.rotation.y = Math.PI / 2;
  waterfallCurtain.position
    .copy(waterfallOrigin)
    .add(new THREE.Vector3(0, waterfallHeight / 2, 0));
  waterfallCurtain.raycast = () => {};
  waterfallCurtain.geometry.computeBoundingSphere();
  waterfallCurtain.geometry.boundingSphere!.radius += 0.85;
  waterfallRoot.add(waterfallCurtain);
  for (const side of [-1, 1]) {
    const spillway = new THREE.Mesh(caveRockGeometry, cliffMaterial);
    const z = 17 + side * 6.7,
      y = ridgeHeight(z);
    spillway.name = "WaterfallRockLip";
    spillway.position.set(waterfallSheetX(z, y) - 1, y - 0.6, z);
    spillway.scale.set(3.2, 2.4, 2.8);
    waterfallRoot.add(spillway);
  }
  const foamMaterial = new THREE.ShaderMaterial({
    name: "WaterfallImpactFoam",
    uniforms: { ...waterfallUniforms, uMode: { value: 1 } },
    vertexShader: waterfallVertex,
    fragmentShader: waterfallShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: true,
    fog: true,
  });
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 16, 1, 1),
    foamMaterial,
  );
  foam.name = "WaterfallImpactFoam";
  foam.rotation.x = -Math.PI / 2;
  foam.position.copy(waterfallOrigin).add(new THREE.Vector3(1.6, 0.045, 0));
  foam.raycast = () => {};
  waterfallRoot.add(foam);
  const sprayGeometry = new THREE.BufferGeometry(),
    spraySeeds = new Float32Array(384 * 4);
  for (let i = 0; i < spraySeeds.length; i++) spraySeeds[i] = random();
  sprayGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(384 * 3), 3),
  );
  sprayGeometry.setAttribute(
    "aSpray",
    new THREE.Float32BufferAttribute(spraySeeds, 4),
  );
  sprayGeometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-2, -1, -8),
    new THREE.Vector3(6, 5, 8),
  );
  sprayGeometry.boundingSphere = sprayGeometry.boundingBox.getBoundingSphere(
    new THREE.Sphere(),
  );
  const sprayMaterial = new THREE.ShaderMaterial({
    name: "WaterfallSpray",
    defines: { WATERFALL_SPRAY: 1 },
    uniforms: waterfallUniforms,
    vertexShader: waterfallVertex,
    fragmentShader: waterfallShader,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    fog: true,
  });
  const spray = new THREE.Points(sprayGeometry, sprayMaterial);
  spray.name = "WaterfallSpray";
  spray.position.copy(waterfallOrigin);
  spray.raycast = () => {};
  waterfallRoot.add(spray);

  const droplets = Array.from({ length: 128 }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 0,
    life: 0,
    size: 0,
  }));
  const dropletPositions = new Float32Array(droplets.length * 3),
    dropletAppearance = new Float32Array(droplets.length * 2);
  const contactGeometry = new THREE.BufferGeometry();
  const contactPositions = new THREE.BufferAttribute(
    dropletPositions,
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  const contactAppearance = new THREE.BufferAttribute(
    dropletAppearance,
    2,
  ).setUsage(THREE.DynamicDrawUsage);
  contactGeometry.setAttribute("position", contactPositions);
  contactGeometry.setAttribute("aDroplet", contactAppearance);
  const contactMaterial = new THREE.ShaderMaterial({
    name: "WaterfallCharacterSplash",
    defines: { WATERFALL_CHARACTER_SPLASH: 1 },
    uniforms: waterfallUniforms,
    vertexShader: waterfallVertex,
    fragmentShader: waterfallShader,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    fog: true,
  });
  const contactSpray = new THREE.Points(contactGeometry, contactMaterial);
  contactSpray.name = "WaterfallCharacterSplash";
  contactSpray.userData.minimap = false;
  contactSpray.frustumCulled = false;
  contactSpray.visible = false;
  contactSpray.raycast = () => {};
  waterfallRoot.add(contactSpray);
  let dropletCursor = 0,
    dropletEmission = 0;

  function updateWaterfallContact(
    dt: number,
    contact?: WaterfallCharacterContact,
  ) {
    waterfallUniforms.uContactStrength.value = 0;
    waterfallUniforms.uPixelRatio.value = Math.min(
      window.devicePixelRatio || 1,
      1.5,
    );
    waterfallUniforms.uViewportHeight.value = window.innerHeight;
    if (contact) {
      const { position, radius, headY } = contact,
        feetY = position.y - radius,
        height = headY - feetY;
      if (
        ![position.x, position.y, position.z, radius, headY].every(
          Number.isFinite,
        ) ||
        radius <= 0 ||
        height <= 0
      )
        throw new Error(
          "Waterfall contact requires a finite character position, height and radius",
        );
      const contactY = feetY + height * 0.65;
      const t = THREE.MathUtils.clamp(
        (contactY - waterfallOrigin.y) / waterfallHeight,
        0,
        1,
      );
      const sheetX = waterfallSheetX(position.z, contactY),
        halfWidth = 8 * (1 - t * 0.28);
      const crossed =
        Math.abs(position.z - waterfallOrigin.z) < halfWidth + radius &&
        headY > waterfallOrigin.y &&
        feetY < waterfallOrigin.y + waterfallHeight;
      const strength = crossed
        ? 1 -
          THREE.MathUtils.smoothstep(
            Math.abs(position.x - sheetX),
            radius * 0.35,
            radius + 0.8,
          )
        : 0;
      waterfallUniforms.uContact.value.set(
        position.x,
        feetY,
        position.z,
        radius,
      );
      waterfallUniforms.uContactHeight.value = height;
      waterfallUniforms.uContactStrength.value = strength;
      if (!waterfallVisible) return;
      dropletEmission += dt * strength * 210;
      while (dropletEmission >= 1) {
        dropletEmission--;
        const droplet = droplets[dropletCursor++ % droplets.length],
          angle = random() * Math.PI * 2;
        const speed = 1.4 + random() * 2.5;
        droplet.position.set(
          position.x + Math.cos(angle) * radius * 0.9,
          feetY + height * (0.58 + random() * 0.43),
          position.z + Math.sin(angle) * radius * 0.9,
        );
        droplet.velocity.set(
          Math.cos(angle) * speed + 0.65,
          0.1 + random() * 1.9,
          Math.sin(angle) * speed,
        );
        droplet.age = 0;
        droplet.life = 0.28 + random() * 0.3;
        droplet.size = 0.018 + random() * 0.025;
      }
      if (!strength) dropletEmission = 0;
    } else dropletEmission = 0;

    if (!waterfallVisible) return;
    let activeDroplets = 0;
    for (let index = 0; index < droplets.length; index++) {
      const droplet = droplets[index];
      if (droplet.life > 0) {
        droplet.age += dt;
        droplet.velocity.y -= 9.82 * dt;
        droplet.position.addScaledVector(droplet.velocity, dt);
        const surface = waterfallLedge(droplet.position.x, droplet.position.z)
          ? WATERFALL_LEDGE.y
          : RESCUE_SITE.riverY;
        if (droplet.age >= droplet.life || droplet.position.y < surface + 0.025)
          droplet.life = 0;
      }
      if (droplet.life > 0) {
        droplet.position.toArray(dropletPositions, index * 3);
        dropletAppearance[index * 2] = droplet.size;
        dropletAppearance[index * 2 + 1] =
          1 - THREE.MathUtils.smoothstep(droplet.age / droplet.life, 0.1, 1);
        activeDroplets++;
      } else dropletAppearance[index * 2 + 1] = 0;
    }
    contactSpray.visible = activeDroplets > 0;
    if (contactSpray.visible) {
      contactPositions.needsUpdate = true;
      contactAppearance.needsUpdate = true;
    }
  }
  const caveLight = new THREE.PointLight(0x9dc4b4, 18, 22);
  caveLight.position.set(-90, 4.8, 17);
  waterfallRoot.add(caveLight);
  const seal = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 8),
    new THREE.MeshBasicMaterial({
      color: 0xaf72ff,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  seal.name = "WaterfallArenaSeal";
  seal.rotation.y = Math.PI / 2;
  seal.position.set(-83.7, 4, 17);
  seal.visible = false;
  waterfallRoot.add(seal);
  const sealBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(0.25, 4, 8)),
  });
  sealBody.position.set(-83.7, 4, 17);
  const waterfall = {
    root: waterfallRoot,
    center: new THREE.Vector3(-97, WATERFALL_LEDGE.y, 17),
    bounds: new THREE.Box3(
      new THREE.Vector3(-106, WATERFALL_LEDGE.y, 9),
      new THREE.Vector3(-84, 8, 25),
    ),
    support: { mesh: ledge, body: ledgeBody, bounds: WATERFALL_LEDGE },
    get contactStrength() {
      return waterfallUniforms.uContactStrength.value;
    },
    contains(point: Point) {
      return (
        point.x < -85 &&
        point.x > -106 &&
        point.z > 9 &&
        point.z < 25 &&
        point.y < 7
      );
    },
    setLocked(locked: boolean) {
      seal.visible = locked;
      if (locked && sealBody.world !== physics.world)
        physics.world.addBody(sealBody);
      else if (!locked && sealBody.world === physics.world)
        physics.world.removeBody(sealBody);
    },
    get locked() {
      return sealBody.world === physics.world;
    },
  };
  const farRockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0),
    rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x58654a,
      roughness: 1,
    });
  for (let i = 0; i < 100; i++) {
    const x = (random() - 0.5) * 374,
      z = (random() - 0.5) * 230;
    if (
      x < RESCUE_SITE.mountainX + 3 ||
      x > RESCUE_SITE.east - 3 ||
      river(z, 3) ||
      clearing(x, z, 2) ||
      facility(x, z, 3) ||
      routeDistance(x, z) < 6
    )
      continue;
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    const s = 0.5 + (i % 7) * 0.32;
    rock.position.set(x, s * 0.45, z);
    rock.scale.set(s * 1.3, s * 0.8, s);
    rock.rotation.set(i, i * 0.4, 0);
    rock.castShadow = true;
    scene.add(rock);
    const bounds = new THREE.Box3().setFromObject(rock),
      rockBody = physics.addBox(
        bounds.getSize(new THREE.Vector3()),
        bounds.getCenter(new THREE.Vector3()),
      );
    jungleObstacleBodies.add(rockBody);
    trackStaticBody(rockBody);
    let farMesh: THREE.Mesh | undefined;
    if (culling) {
      rock.updateMatrix();
      rock.matrixAutoUpdate = false;
      farMesh = new THREE.Mesh(farRockGeometry, rockMaterial);
      farMesh.position.copy(rock.position);
      farMesh.quaternion.copy(rock.quaternion);
      farMesh.scale.copy(rock.scale);
      farMesh.visible = false;
      farMesh.updateMatrix();
      farMesh.matrixAutoUpdate = false;
      scene.add(farMesh);
      distantProps.push({
        root: rock,
        center: rock.position.clone(),
        range: 140,
        farMesh,
        detailed: true,
      });
    }
    const entry = {
      x,
      z,
      radius: bounds.getSize(new THREE.Vector3()).length() * 0.5,
    };
    obstacles.push(entry);
    obstacleVisuals.set(rockBody, {
      entry,
      rock,
      farMesh,
      size: bounds.getSize(new THREE.Vector3()),
    });
  }
  const canopyWind = { value: 0 };
  const {
    bark,
    branches: branchMat,
    canopy: foliage,
    sprays: sprayMat,
    grass: tuftMat,
  } = createJungleFoliageMaterials(surfaceTextures, canopyWind);
  const foliageGeometry = createJungleFoliageGeometry(),
    sprayCard = foliageGeometry.spray;
  const sourceWater = createJungleWater(scene, {
    y: 0,
    z: 17,
    halfWidth: 5.76,
    length: 15,
  });
  sourceWater.mesh.name = "WaterfallSummitStream";
  waterfallRoot.add(sourceWater.mesh);
  const streamPositions = sourceWater.mesh.geometry.getAttribute("position");
  for (let index = 0; index < streamPositions.count; index++) {
    const z = 17 + streamPositions.getZ(index),
      crest = waterfallSheetX(z, ridgeHeight(z));
    const x = crest - 7.5 + streamPositions.getX(index);
    streamPositions.setX(index, x);
    streamPositions.setY(index, summitHeight(x, z) + 0.35);
  }
  sourceWater.mesh.geometry.computeVertexNormals();
  sourceWater.mesh.geometry.computeBoundingBox();
  sourceWater.mesh.geometry.computeBoundingSphere();
  sourceWater.mesh.geometry.boundingSphere!.radius += 0.13;
  const sourceDress = new THREE.Group();
  sourceDress.name = "WaterfallSourceGrove";
  waterfallRoot.add(sourceDress);
  const sourceTrunk = new THREE.CylinderGeometry(0.3, 0.55, 1, 7);
  const sourceBranch = new THREE.CylinderGeometry(0.08, 0.2, 1, 5);
  function sourceTree(x: number, y: number, z: number, height: number) {
    const trunk = new THREE.Mesh(sourceTrunk, bark);
    trunk.position.set(x, y + height / 2, z);
    trunk.scale.y = height;
    trunk.castShadow = true;
    sourceDress.add(trunk);
    const whorls = 5;
    for (let w = 0; w < whorls; w++) {
      const t = w / (whorls - 1);
      const wy = y + height * (0.3 + 0.62 * t),
        radius = 2.6 - 1.9 * t;
      for (let a = 0; a < 3; a++) {
        const angle = a * 2.09 + w * 0.7;
        const dirX = Math.sin(angle),
          dirZ = Math.cos(angle);
        const arm = new THREE.Mesh(sourceBranch, bark);
        arm.position.set(
          x + dirX * radius * 0.4,
          wy - 0.12,
          z + dirZ * radius * 0.4,
        );
        arm.scale.y = radius * 0.8;
        arm.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(dirX, -0.2, dirZ).normalize(),
        );
        arm.castShadow = true;
        sourceDress.add(arm);
        for (let c = 0; c < 3; c++) {
          const card = new THREE.Mesh(sprayCard, sprayMat);
          card.position.set(
            x + dirX * radius * 0.5,
            wy + (Math.random() - 0.5) * 0.3,
            z + dirZ * radius * 0.5,
          );
          card.rotation.set(0, angle + Math.PI / 2 + (c * Math.PI) / 3, -0.14);
          card.scale.set(radius * 1.8, 2.4 + (1 - t) * 1.1, 1);
          sourceDress.add(card);
        }
      }
    }
    for (let c = 0; c < 3; c++) {
      const spire = new THREE.Mesh(sprayCard, sprayMat);
      spire.position.set(x, y + height * 0.96, z);
      spire.scale.set(2, 2.8, 1);
      spire.rotation.y = Math.random() * Math.PI;
      sourceDress.add(spire);
    }
  }
  const crestX = waterfallSheetX(17, ridgeHeight(17));
  for (const side of [-1, 1])
    for (let index = 0; index < 5; index++) {
      const x = crestX - 3 - index * 3.7,
        z = 17 + side * (8.5 + Math.sin(index * 2) * 1.2);
      sourceTree(x, summitHeight(x, z), z, 7 + (index % 3) * 1.8);
      const rock = new THREE.Mesh(caveRockGeometry, cliffMaterial);
      rock.position.set(x, summitHeight(x, z) + 0.3, z - side * 1.4);
      rock.scale.set(2.4, 1.5, 1.7);
      rock.rotation.y = index * 1.7;
      sourceDress.add(rock);
    }
  const riverEnd = new THREE.Group();
  riverEnd.name = "RiverBoundaryBank";
  scene.add(riverEnd);
  for (let index = 0; index < 8; index++) {
    const rock = new THREE.Mesh(caveRockGeometry, cliffMaterial);
    rock.position.set(RESCUE_SITE.east - 1.4, -0.6, 8.5 + index * 2.5);
    rock.scale.set(1.35, 3.2 + Math.sin(index) * 0.4, 2);
    riverEnd.add(rock);
  }
  for (const z of [7, 27]) sourceTree(RESCUE_SITE.east - 5, 0, z, 11);
  const groveBatches = new Map<THREE.BufferGeometry, THREE.Mesh[]>();
  for (const child of [...sourceDress.children]) {
    if (
      !(child instanceof THREE.Mesh) ||
      (child.geometry !== sourceTrunk &&
        child.geometry !== sourceBranch &&
        child.geometry !== sprayCard)
    )
      continue;
    const group = groveBatches.get(child.geometry) ?? [];
    group.push(child);
    groveBatches.set(child.geometry, group);
  }
  for (const [geometry, nodes] of groveBatches) {
    const batch = new THREE.InstancedMesh(
      geometry,
      nodes[0].material,
      nodes.length,
    );
    batch.name =
      geometry === sourceTrunk
        ? "WaterfallGroveTrunks"
        : geometry === sourceBranch
          ? "WaterfallGroveBranches"
          : "WaterfallGroveNeedles";
    batch.castShadow = geometry === sourceTrunk;
    batch.receiveShadow = true;
    nodes.forEach((node, index) => {
      node.updateMatrix();
      batch.setMatrixAt(index, node.matrix);
      node.removeFromParent();
    });
    addJungleBatch(
      batch,
      geometry === sourceBranch ? 46 : 110,
      undefined,
      sourceDress,
    );
  }
  const TRUNK_CAP = 512,
    BRANCH_CAP = TRUNK_CAP * CONIFER_PARTS.branch,
    SPRAY_CAP = TRUNK_CAP * CONIFER_PARTS.spray;
  const trunks = new THREE.InstancedMesh(
    foliageGeometry.trunk,
    bark,
    TRUNK_CAP,
  );
  const crowns = new THREE.InstancedMesh(
    foliageGeometry.canopy,
    foliage,
    TRUNK_CAP * CONIFER_PARTS.canopy,
  );
  const branches = new THREE.InstancedMesh(
    foliageGeometry.branch,
    branchMat,
    BRANCH_CAP,
  );
  const vines = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.025, 0.04, 1, 5),
    new THREE.MeshStandardMaterial({ color: 0x536338, roughness: 1 }),
    8,
  );
  const foliageCards = new THREE.InstancedMesh(sprayCard, sprayMat, SPRAY_CAP);
  trunks.name = "JungleTrunks";
  crowns.name = "JungleCanopy";
  branches.name = "JungleBranches";
  vines.name = "HangingVines";
  foliageCards.name = "ConiferSprays";
  const dummy = new THREE.Object3D(),
    tint = new THREE.Color(),
    yAxis = new THREE.Vector3(0, 1, 0);
  let treeCount = 0,
    crownCount = 0,
    branchCount = 0,
    vineCount = 0,
    sprayCount = 0;
  function instance(
    mesh: THREE.InstancedMesh,
    index: number,
    position: THREE.Vector3,
    scale: THREE.Vector3,
    rotation = new THREE.Euler(),
  ) {
    dummy.position.copy(position);
    dummy.scale.copy(scale);
    dummy.rotation.copy(rotation);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  // ── Textured conifers: visible bark log + woody arms + feathery spray cards ─
  function conifer(x: number, z: number, height: number, radius: number) {
    if (
      treeCount >= TRUNK_CAP ||
      branchCount + CONIFER_PARTS.branch > BRANCH_CAP ||
      sprayCount + CONIFER_PARTS.spray > SPRAY_CAP
    )
      return;
    const parts: TreePart[] = [];
    writeConifer(x, z, height, radius, random, (part, matrix, color) => {
      const mesh =
        part === "trunk"
          ? trunks
          : part === "branch"
            ? branches
            : part === "canopy"
              ? crowns
              : foliageCards;
      const index =
        part === "trunk"
          ? treeCount++
          : part === "branch"
            ? branchCount++
            : part === "canopy"
              ? crownCount++
              : sprayCount++;
      mesh.setMatrixAt(index, matrix);
      if (color) mesh.setColorAt(index, color);
      parts.push({ source: mesh, index });
    });
    const body = new CANNON.Body({
      mass: 0,
      material: physics.solidMaterial,
      shape: new CANNON.Cylinder(radius * 0.6, radius, height, 7),
    });
    body.position.set(x, height / 2, z);
    physics.world.addBody(body);
    jungleObstacleBodies.add(body);
    trackStaticBody(body);
    const entry = { x, z, radius };
    obstacles.push(entry);
    obstacleVisuals.set(body, { entry, parts });
    pineconeTrees.push({
      x,
      z,
      height,
      alive: () => obstacleVisuals.has(body),
    });
  }
  for (let x0 = -184; x0 <= 184; x0 += 9)
    for (let z0 = -112; z0 <= 112; z0 += 9) {
      const x = x0 + (random() - 0.5) * 5,
        z = z0 + (random() - 0.5) * 5;
      if (
        river(z, 4) ||
        clearing(x, z, 3) ||
        facility(x, z, 3) ||
        routeDistance(x, z) < 5 ||
        !isWalkable(x, z, 1.5)
      )
        continue;
      conifer(x, z, 15 + random() * 11, 0.4 + random() * 0.35);
    }
  const pinecones = createFallingPinecones(scene, pineconeTrees);
  for (const [mesh, count, range, shadow, lod] of [
    [trunks, treeCount, 145, true, undefined],
    [branches, branchCount, 46, false, "near"],
    [foliageCards, sprayCount, 110, false, "near"],
    [crowns, crownCount, 110, false, "far"],
    [vines, vineCount, 38, false, undefined],
  ] as const) {
    mesh.count = count;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    addJungleBatch(mesh, range, lod);
  }

  // ── Dense grass carpet: crossed alpha-tested tuft cards, knee-high ─────────
  const tuftCard = foliageGeometry.tuft;
  const GRASS_CAP = 12000;
  const grass = new THREE.InstancedMesh(tuftCard, tuftMat, GRASS_CAP);
  grass.name = "GroundGrass";
  let grassCount = 0;
  carpet: for (
    let x0 = RESCUE_SITE.mountainX + 2;
    x0 <= RESCUE_SITE.east - 2;
    x0 += JUNGLE_GRASS_SPACING
  ) {
    for (let z0 = -118; z0 <= 118; z0 += JUNGLE_GRASS_SPACING) {
      const x = x0 + (random() - 0.5) * 0.9,
        z = z0 + (random() - 0.5) * 0.9;
      if (!isJungleGrassSite(x, z) || !isWalkable(x, z, 0.4)) continue;
      if (grassCount >= GRASS_CAP) break carpet;
      writeGrassTuft(x, z, random, (matrix, color) => {
        grass.setMatrixAt(grassCount, matrix);
        grass.setColorAt(grassCount++, color);
      });
    }
  }
  grass.count = grassCount;
  grass.receiveShadow = true;
  addJungleBatch(grass, JUNGLE_GRASS_RANGE);

  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0);
  leaf.quadraticCurveTo(-0.48, 0.42, 0, 1);
  leaf.quadraticCurveTo(0.48, 0.42, 0, 0);
  const fronds = new THREE.InstancedMesh(
    new THREE.ShapeGeometry(leaf, 5),
    new THREE.MeshStandardMaterial({
      color: 0xa4ba85,
      map: surfaceTextures.leaves,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    21000,
  );
  fronds.name = "JungleFerns";
  let frondCount = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (random() - 0.5) * 379,
      z = (random() - 0.5) * 235;
    if (
      x < RESCUE_SITE.mountainX + 3 ||
      x > RESCUE_SITE.east - 3 ||
      river(z, 2) ||
      clearing(x, z) ||
      facility(x, z) ||
      routeDistance(x, z) < 2.5
    )
      continue;
    const scale = 0.7 + random() * 1.1;
    for (let j = 0; j < 7; j++) {
      const angle = (j / 7) * Math.PI * 2 + i;
      dummy.position.set(x, 0.04, z);
      dummy.scale.set(scale, scale * 1.7, scale);
      dummy.quaternion.setFromUnitVectors(
        yAxis,
        new THREE.Vector3(Math.sin(angle), 0.45, Math.cos(angle)).normalize(),
      );
      dummy.updateMatrix();
      fronds.setMatrixAt(frondCount, dummy.matrix);
      fronds.setColorAt(
        frondCount++,
        tint.setHSL(0.22 + random() * 0.1, 0.5, 0.35 + random() * 0.2),
      );
    }
  }
  fronds.count = frondCount;
  fronds.receiveShadow = true;
  addJungleBatch(fronds, 42);
  const pathLength = JUNGLE_PATH.getLength();
  const trailSteps = [JUNGLE_PATH, WATERFALL_PATH, ...EXPLORATION_PATHS].map(
    (path) => ({ path, steps: Math.ceil(path.getLength() / 1.25) }),
  );
  const stones = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.65, 0.69, 0.06, 6),
    new THREE.MeshStandardMaterial({
      color: 0xc5c4af,
      map: surfaceTextures.stone,
      roughness: 1,
    }),
    trailSteps.reduce((sum, trail) => sum + trail.steps + 1, 0) * 3,
  );
  stones.name = "WindingStoneTrail";
  let stoneCount = 0;
  for (const { path, steps } of trailSteps)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        p = path.getPointAt(t),
        tangent = path.getTangentAt(t),
        normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
      if (river(p.z, 2) && !waterfallLedge(p.x, p.z)) continue;
      for (const lane of [-1, 0, 1]) {
        const size = new THREE.Vector3(
          1.02 + random() * 0.08,
          1,
          1.06 + random() * 0.1,
        );
        const center = p.clone().addScaledVector(normal, lane * 1.06);
        center.y = 0.02;
        if (
          center.x - 0.75 < waterfallOrigin.x + 0.7 &&
          Math.abs(center.z - waterfallOrigin.z) < 10
        )
          continue;
        if (waterfallLedge(center.x, center.z))
          center.y = WATERFALL_LEDGE.y + 0.035;
        const yaw = Math.atan2(tangent.x, tangent.z) + (random() - 0.5) * 0.07;
        instance(stones, stoneCount, center, size, new THREE.Euler(0, yaw, 0));
        stones.setColorAt(
          stoneCount++,
          tint.setHSL(
            0.16 + random() * 0.08,
            0.08 + random() * 0.12,
            0.56 + random() * 0.2,
          ),
        );
      }
    }
  stones.count = stoneCount;
  stones.receiveShadow = true;
  addJungleBatch(stones, 140);
  for (const t of [0.16, 0.36, 0.57, 0.78]) {
    const p = JUNGLE_PATH.getPointAt(t),
      tangent = JUNGLE_PATH.getTangentAt(t);
    const x = p.x + tangent.z * 2.25,
      z = p.z - tangent.x * 2.25;
    box([0.18, 0.85, 0.18], [x, 0.425, z], dark);
    box(
      [0.23, 0.08, 0.23],
      [x, 0.8, z],
      new THREE.MeshStandardMaterial({
        color: 0xb7c89b,
        emissive: 0x8ead78,
        emissiveIntensity: 0.65,
      }),
      false,
    );
  }
  for (let i = 0; i < (culling ? 0 : 28); i++) {
    const angle = (i / 28) * Math.PI * 2,
      mountain = new THREE.Mesh(
        new THREE.ConeGeometry(20 + (i % 5) * 5, 30 + (i % 4) * 10, 5),
        rockMaterial,
      );
    mountain.position.set(Math.sin(angle) * 205, 8, Math.cos(angle) * 205);
    mountain.rotation.y = i;
    scene.add(mountain);
  }
  const architecture = createFacilityArchitecture();
  scene.add(architecture.root);
  architecture.door.visible = false;
  const facilityRoof = architecture.roof,
    dome = architecture.dome,
    domeRings = architecture.rings;
  for (let index = 1; index < 48; index++) {
    const angle = (index * Math.PI * 2) / 48;
    if (
      Math.abs(Math.sin(angle)) * FACILITY.radius <
        FACILITY.doorWidth / 2 + 0.2 &&
      Math.cos(angle) > 0
    )
      continue;
    const body = physics.addBox(
      { x: 3.25, y: 6, z: 0.5 },
      {
        x: Math.sin(angle) * (FACILITY.radius - 0.2),
        y: 3,
        z: FACILITY.z + Math.cos(angle) * (FACILITY.radius - 0.2),
      },
    );
    body.quaternion.setFromEuler(0, angle, 0);
    body.aabbNeedsUpdate = true;
    trackStaticBody(body);
  }
  for (const pillar of architecture.pillars.children) {
    architecture.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(pillar);
    trackStaticBody(
      physics.addBox(
        bounds.getSize(new THREE.Vector3()),
        bounds.getCenter(new THREE.Vector3()),
      ),
    );
  }
  const door = createSlidingPortal(
    scene,
    physics,
    { x: 0, y: 0, z: FACILITY_DOOR_Z + 0.14, yaw: 0 },
    FACILITY.entranceSpan,
    FACILITY.entranceHeight,
    "AI RESEARCH / ACCESS",
    { landingFloor: false, sign: false },
  );
  const sentinelHull = new THREE.MeshStandardMaterial({
    color: 0x171921,
    metalness: 0.78,
    roughness: 0.34,
  });
  const sentinelArmor = new THREE.MeshStandardMaterial({
    color: 0x552138,
    metalness: 0.65,
    roughness: 0.38,
  });
  const sentinelGlow = new THREE.MeshBasicMaterial({
    color: 0xff294d,
    toneMapped: false,
  });
  const turrets = [-9, 9].map((x) => {
    const turretZ = FACILITY_DOOR_Z - 2.3;
    box([2, 0.5, 2], [x, 4.5, turretZ], dark);
    const root = new THREE.Group();
    root.name = `FacilityShipSentinel${x < 0 ? "Left" : "Right"}`;
    root.position.set(x, 5, turretZ + 0.35);
    scene.add(root);
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(1.65, 0.75, 1.7),
      sentinelHull,
    );
    hull.rotation.z = 0.08;
    hull.rotation.y = Math.PI / 4;
    root.add(hull);
    for (const side of [-1, 1]) {
      const armor = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.6, 2.1),
        sentinelArmor,
      );
      armor.position.set(side * 0.9, -0.05, -0.12);
      armor.rotation.z = side * 0.2;
      root.add(armor);
      const horn = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 1.05, 4),
        sentinelHull,
      );
      horn.position.set(side * 0.78, 0.68, -0.45);
      horn.rotation.z = side * -0.32;
      root.add(horn);
      const engine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.3, 0.16, 12),
        sentinelGlow,
      );
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 0.9, -0.05, -1.22);
      root.add(engine);
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.18, 1.35),
        sentinelHull,
      );
      barrel.position.set(side * 0.43, 0, 1.1);
      root.add(barrel);
    }
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.14, 0.05),
      sentinelGlow,
    );
    visor.position.set(0, 0.2, 0.88);
    root.add(visor);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), red);
    muzzle.position.z = 1.85;
    root.add(muzzle);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = true;
    });
    return { root, muzzle };
  });
  const pod = createEscapePod();
  pod.position.copy(RESCUE_SITE.pod);
  pod.rotation.copy(RESCUE_SITE.podRotation);
  scene.add(pod);
  const podTrail = pod.getObjectByName("PodTrail")!;
  podTrail.visible = false;
  const ship = createEscapeShip();
  ship.root.position.copy(RESCUE_SITE.ship);
  ship.setThrust(0);
  ship.setFlying(false, true);
  scene.add(ship.root);
  const crater = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshStandardMaterial({ color: 0x4f3d2e, roughness: 1 }),
  );
  crater.rotation.x = -Math.PI / 2;
  crater.scale.set(3.5, 8, 1);
  crater.position.set(RESCUE_SITE.pod.x, 0.025, RESCUE_SITE.pod.z + 2);
  scene.add(crater);
  const dust = Array.from({ length: 24 }, (_, i) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xa58b6e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    scene.add(mesh);
    return { mesh, angle: i * 2.4, delay: i * 0.025 };
  });
  const boy = new THREE.Group();
  boy.name = "RescuedPodBoy";
  boy.position.copy(RESCUE_SITE.boy);
  scene.add(boy);
  let disposed = false,
    settled = false,
    brendan: ReturnType<typeof createBrendanBehavior> | null = null;
  let brendanActivity: BrendanActivity = "idle";
  const boyReady = loadBrendanModel()
    .then((gltf) => {
      if (disposed) {
        disposeRoom(gltf.scene as unknown as THREE.Scene);
        return;
      }
      const model = gltf.scene;
      brendan = createBrendanBehavior(
        boy,
        model,
        gltf.animations,
        RESCUE_SITE.pod,
      );
      const bounds = new THREE.Box3().setFromObject(model);
      model.scale.multiplyScalar(
        1.75 / Math.max(0.01, bounds.getSize(new THREE.Vector3()).y),
      );
      bounds.setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -bounds.min.y, -center.z);
      model.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      brendan.pivot.add(model);
      brendan.setActivity(brendanActivity);
    })
    .catch((error) => {
      if (!disposed) {
        console.error("[Rescue] Could not load Brendan:", error);
        throw error;
      }
    });
  const ready = boyReady.then(() => {
    settled = true;
  });
  scene.add(new THREE.HemisphereLight(0xd1e2c0, 0x253921, 2));
  const sun = new THREE.DirectionalLight(0xffe3ac, 3.6);
  sun.position.set(-70, 90, 25);
  sun.castShadow = true;
  sun.target.position.set(-30, 0, -5);
  scene.add(sun.target);
  sun.shadow.mapSize.set(culling ? 1024 : 2048, culling ? 1024 : 2048);
  const shadowSpan = culling ? 38 : 115;
  Object.assign(sun.shadow.camera, {
    left: -shadowSpan,
    right: shadowSpan,
    top: shadowSpan,
    bottom: -shadowSpan,
    far: 260,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.001;
  scene.add(sun);
  if (culling)
    for (const root of [ship.root, pod, boy])
      distantProps.push({
        root,
        center: root.position.clone(),
        range: 140,
        dynamic: true,
      });
  const localBounds = new THREE.Box3(),
    cameraPosition = new THREE.Vector3(),
    foliageView = createJungleView();
  const waterfallFrustum = new THREE.Frustum(),
    waterfallProjection = new THREE.Matrix4(),
    waterfallRay = new THREE.Raycaster(),
    lastWaterfallCamera = new THREE.Vector3(Infinity, Infinity, Infinity),
    lastWaterfallRotation = new THREE.Quaternion(),
    waterfallRotation = new THREE.Quaternion();
  const mountainOccluders = [
    cliff,
    summit,
    ...mountain.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.geometry === seamGeometry,
    ),
  ];
  const waterfallSurfaces = [
    waterfallCurtain,
    foam,
    spray,
    sourceWater.mesh,
  ].map((mesh) => {
    mesh.updateWorldMatrix(true, false);
    const bounds = new THREE.Box3().setFromObject(mesh).expandByScalar(0.7);
    const center = bounds.getCenter(new THREE.Vector3());
    const samples =
      mesh === waterfallCurtain
        ? [0.04, 0.35, 0.78].flatMap((height) =>
            [-5.5, 0, 5.5].map((across) => {
              const z = waterfallOrigin.z + across,
                y = THREE.MathUtils.lerp(
                  waterfallOrigin.y,
                  ridgeHeight(z),
                  height,
                );
              return new THREE.Vector3(waterfallSheetX(z, y), y, z);
            }),
          )
        : [
            center,
            center.clone().setZ(bounds.min.z + 1),
            center.clone().setZ(bounds.max.z - 1),
          ];
    return { mesh, bounds, samples, unoccluded: true };
  });
  let lastWaterfallTest = -Infinity,
    waterfallClock = 0;
  function updateWaterfallVisibility(camera: THREE.Camera) {
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(waterfallRotation);
    waterfallProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    waterfallFrustum.setFromProjectionMatrix(waterfallProjection);
    const testOcclusion =
      waterfallClock - lastWaterfallTest > 0.18 ||
      cameraPosition.distanceToSquared(lastWaterfallCamera) > 2.25 ||
      waterfallRotation.angleTo(lastWaterfallRotation) > 0.12;
    if (testOcclusion) {
      mountain.updateMatrixWorld(true);
      lastWaterfallTest = waterfallClock;
      lastWaterfallCamera.copy(cameraPosition);
      lastWaterfallRotation.copy(waterfallRotation);
    }
    let visible = false;
    for (const surface of waterfallSurfaces) {
      const inView =
        surface.bounds.distanceToPoint(cameraPosition) < 180 &&
        waterfallFrustum.intersectsBox(surface.bounds);
      if (inView && testOcclusion)
        surface.unoccluded = surface.samples.some((point) => {
          if (!waterfallFrustum.containsPoint(point)) return false;
          const direction = point.clone().sub(cameraPosition),
            distance = direction.length();
          if (distance < 1) return true;
          waterfallRay.set(cameraPosition, direction.divideScalar(distance));
          waterfallRay.near = 0.08;
          waterfallRay.far = Math.max(0.08, distance - 0.25);
          return (
            waterfallRay.intersectObjects(mountainOccluders, false).length === 0
          );
        });
      surface.mesh.visible = inView && surface.unoccluded;
      visible ||= surface.mesh.visible && surface.mesh !== sourceWater.mesh;
    }
    if (waterfallVisible && !visible) {
      for (const droplet of droplets) droplet.life = 0;
      dropletEmission = 0;
      contactSpray.visible = false;
    }
    waterfallVisible = visible;
  }
  function updateVisibility(camera: THREE.Camera, focus: Point) {
    pinecones.updateView(camera);
    updateWaterfallVisibility(camera);
    if (!culling) return;
    foliageView.update(camera);
    camera.getWorldPosition(cameraPosition);
    for (const chunk of renderChunks) {
      localBounds.copy(chunk.mesh.boundingBox!).translate(chunk.mesh.position);
      const wasVisible = chunk.mesh.visible || !!chunk.farMesh?.visible,
        range = chunk.range + (wasVisible ? 4 : -4);
      const visible = foliageView.visible(chunk.mesh, range);
      chunk.detailed = foliageView.detailed(chunk.mesh, chunk.detailed);
      if (chunk.farMesh) {
        chunk.farMesh.visible = visible && !chunk.detailed;
      }
      chunk.mesh.visible =
        visible &&
        (!chunk.farMesh || chunk.detailed) &&
        (!chunk.lod ||
          (chunk.lod === "near" ? chunk.detailed : !chunk.detailed));
      chunk.mesh.castShadow =
        chunk.mesh.visible &&
        chunk.shadows &&
        distanceSquared(localBounds, focus) < 52 * 52;
    }
    for (const prop of distantProps) {
      if (!prop.bounds || prop.dynamic) {
        prop.bounds ??= new THREE.Box3();
        prop.bounds.setFromObject(prop.root).expandByScalar(0.3);
        if (prop.dynamic) prop.bounds.getCenter(prop.center);
      }
      const dx = prop.center.x - cameraPosition.x,
        dz = prop.center.z - cameraPosition.z;
      const distance = dx * dx + dz * dz,
        range =
          prop.range + (prop.root.visible || prop.farMesh?.visible ? 4 : -4);
      const visible = foliageView.visibleBounds(prop.bounds, range);
      if (prop.farMesh) {
        const threshold = prop.detailed ? 54 : 46;
        prop.detailed = distance < threshold * threshold;
        prop.farMesh.visible = visible && !prop.detailed;
      }
      prop.root.visible = visible && (!prop.farMesh || !!prop.detailed);
      const near =
        Math.hypot(prop.center.x - focus.x, prop.center.z - focus.z) < 45;
      prop.root.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = visible && near;
      });
    }
    // Keep a small, stable shadow region around gameplay rather than shading the entire jungle.
    const x = Math.round(focus.x / 2) * 2,
      z = Math.round(focus.z / 2) * 2;
    sun.target.position.set(x, 0, z);
    sun.position.set(x - 40, 90, z + 30);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  function prepareMinimap(focus: Point, radius: number) {
    const visibility: Array<[THREE.Object3D, boolean]> = [];
    const show = (object: THREE.Object3D, visible: boolean) => {
      visibility.push([object, object.visible]);
      object.visible = visible;
    };
    // Map visibility is independent of the gameplay camera and never streams physics.
    for (const chunk of renderChunks) {
      localBounds.copy(chunk.mesh.boundingBox!).translate(chunk.mesh.position);
      const visible =
        distanceSquared(localBounds, focus) < radius * radius &&
        chunk.lod !== "near";
      show(chunk.mesh, visible);
      if (chunk.farMesh) show(chunk.farMesh, false);
    }
    for (const prop of distantProps) {
      show(
        prop.root,
        Math.hypot(prop.center.x - focus.x, prop.center.z - focus.z) <
          radius + 12,
      );
      if (prop.farMesh) show(prop.farMesh, false);
    }
    return () => {
      for (const [object, visible] of visibility) object.visible = visible;
    };
  }
  let windTime = 0;
  return {
    scene,
    ship,
    pod,
    boy,
    door,
    facilityRoof,
    facilityDome: dome,
    domeRings,
    turrets,
    ready,
    pathLength,
    nearestPathPoint,
    isWalkable,
    trackStaticBody,
    updateActivePhysics,
    activatePhysicsNear,
    updateVisibility,
    prepareMinimap,
    isReady: () => settled,
    releasePropCulling(root: THREE.Object3D) {
      const index = distantProps.findIndex((prop) => prop.root === root);
      if (index >= 0) distantProps.splice(index, 1);
    },
    distanceToSafePath: (x: number, z: number) => routeDistance(x, z),
    isJungleObstacleBody: (body: CANNON.Body) => obstacleVisuals.has(body),
    breakJungleObstacle,
    disintegrateTrees,
    setBrendanActivity(value: BrendanActivity) {
      brendanActivity = value;
      brendan?.setActivity(value);
    },
    getBrendanTarget: () => ({
      root: boy,
      damage: (amount: number) => brendan?.damage(amount) ?? false,
      knockDown: () => brendan?.knockDown() ?? false,
    }),
    bridge,
    water,
    waterfall,
    mountain,
    damageBridge,
    breakBridge,
    setImpact(age: number) {
      crater.visible = age >= 0;
      for (const d of dust) {
        const t = Math.max(0, age - d.delay),
          radius = 0.8 + t * (2 + d.delay * 4);
        d.mesh.visible = age >= d.delay && t < 5;
        d.mesh.position.set(
          RESCUE_SITE.pod.x + Math.sin(d.angle) * radius,
          0.4 + t * 0.9,
          RESCUE_SITE.pod.z + Math.cos(d.angle) * radius,
        );
        d.mesh.scale.setScalar(0.5 + t * 1.1);
        d.mesh.material.opacity = Math.max(0, 0.42 * (1 - t / 5));
      }
    },
    update(dt: number, characterContact?: WaterfallCharacterContact) {
      if (!Number.isFinite(dt) || dt < 0)
        throw new RangeError(
          "Rescue-site updates require a finite, nonnegative delta",
        );
      dt = Math.min(dt, 0.1);
      applyObstacleImpacts();
      updateFallingTrees(dt);
      rockDebris.update(dt);
      windTime += dt;
      waterfallClock += dt;
      pinecones.update(dt);
      canopyWind.value = windTime;
      if (waterfallVisible || sourceWater.mesh.visible)
        waterfallUniforms.uTime.value = windTime;
      updateWaterfallContact(dt, characterContact);
      riverWater.update(dt);
      if (sourceWater.mesh.visible) sourceWater.update(dt);
      if (ship.root.visible) ship.update(dt);
      brendan?.update(dt, characterContact?.position);
      if (!culling) crowns.rotation.z = Math.sin(windTime * 0.45) * 0.001;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      brendan?.dispose();
      pinecones.dispose();
      waterfall.setLocked(false);
      if (ledgeBody.world === physics.world)
        physics.world.removeBody(ledgeBody);
      rockDebris.dispose();
      obstacleVisuals.clear();
      instanceLocations.clear();
      pendingImpacts.length = 0;
      fallingTrees.length = 0;
      boy.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      });
      scene.traverse((node) => {
        if (node instanceof THREE.InstancedMesh) node.dispose();
      });
      for (const chunk of physicsChunks.values())
        for (const body of chunk.bodies)
          if (body.world === physics.world) physics.world.removeBody(body);
      physicsChunks.clear();
      renderChunks.length = 0;
      distantProps.length = 0;
      disposeRoom(scene);
      farRockGeometry.dispose();
    },
  };
}
