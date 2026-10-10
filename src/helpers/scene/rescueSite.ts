import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadBoyModel } from '../../core/loader.js';
import type { createScenePhysics } from '../physics/scenePhysics.js';
import { createSlidingPortal, roomBox, disposeRoom } from './shipRoom.js';
import { cargoSign } from './cargoVisuals.js';
import { createEscapePod, createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import type { PlayerTransitionState } from '../../scripts/player.js';
import { createBreakableDebris } from '../../scripts/breakables.js';
import { createJungleWater } from './jungleWater.js';
import waterfallVertex from '../../shaders/waterfall.vert.glsl?raw';
import waterfallFragment from '../../shaders/waterfall.frag.glsl?raw';
import waterNoise from '../../shaders/waterNoise.glsl?raw';
import mountainRock from '../../shaders/mountainRock.glsl?raw';

export interface RescueArrival {
  pilotState?: PlayerTransitionState; hullHealth?: number;
  waterfallDefeated?: boolean; bossImmunityCollected?: boolean;
  cameraPosition?: THREE.Vector3; cameraQuaternion?: THREE.Quaternion; cameraFov?: number;
}
export const RESCUE_SITE = {
  landingOffset: new THREE.Vector3(-66, 0, 72), clearing: new THREE.Vector3(-66, 0, 84),
  pod: new THREE.Vector3(-60, 1.05, 82), podRotation: new THREE.Euler(0, -2.06, 0.18), ship: new THREE.Vector3(-74, 0, 87),
  boy: new THREE.Vector3(-61.8, 0, 85.4), player: new THREE.Vector3(-63, 0.3, 85), doorZ: -55,
  bridge: new THREE.Vector3(-42, 0, 17), riverY: -1.8, riverZ: 17, riverHalfWidth: 7,
  mountainX: -84, west: -240, east: 72,
};
export const JUNGLE_PATH = new THREE.CatmullRomCurve3([
  [-63, 85], [-59, 67], [-57, 49], [-46, 34], [-42, 26], [-42, 8],
  [-29, -10], [-24, -30], [-7, -41], [0, -51], [0, -59],
].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
export const JUNGLE_ROUTE = JUNGLE_PATH.getSpacedPoints(240);
export const WATERFALL_PATH = new THREE.CatmullRomCurve3([
  [-46, 34], [-62, 31], [-78, 28], [-81, 23], [-81, 17], [-92, 17],
].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const WATERFALL_ROUTE = WATERFALL_PATH.getSpacedPoints(70);
const entryDirection = new THREE.Vector3(0, 0, RESCUE_SITE.doorZ).sub(RESCUE_SITE.player).setY(0).normalize();
export const JUNGLE_ENTRY_YAW = Math.atan2(-entryDirection.x, -entryDirection.z);

/** Scene-owned resources with identical placement in the landing film and playable exterior. */
export function createRescueSite(physics: ReturnType<typeof createScenePhysics>, { culling = false, bridgeBrokenAtStart = false }: {
  culling?: boolean; bridgeBrokenAtStart?: boolean;
} = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(culling ? 0x698475 : 0x9cae98); scene.fog = new THREE.Fog(0x698475, 55, 230);
  physics.world.broadphase = new CANNON.SAPBroadphase(physics.world);
  const chunkSize = 32;
  type Point = { x: number; y: number; z: number };
  type PhysicsChunk = { bodies: CANNON.Body[]; bounds: THREE.Box3; active: boolean };
  const physicsChunks = new Map<string, PhysicsChunk>();
  const renderChunks: Array<{ mesh: THREE.InstancedMesh; farMesh?: THREE.InstancedMesh; range: number; shadows: boolean; detailed: boolean }> = [];
  const instanceLocations = new Map<THREE.InstancedMesh, Array<{ mesh: THREE.InstancedMesh; index: number }>>();
  const distantProps: Array<{ root: THREE.Object3D; center: THREE.Vector3; range: number; farMesh?: THREE.Mesh; detailed?: boolean }> = [];
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
    if (!chunk) { chunk = { bodies: [], bounds: new THREE.Box3(), active: false }; physicsChunks.set(key, chunk); }
    body.updateAABB();
    chunk.bounds.expandByPoint(new THREE.Vector3().copy(body.aabb.lowerBound));
    chunk.bounds.expandByPoint(new THREE.Vector3().copy(body.aabb.upperBound));
    chunk.bodies.push(body);
    if (!chunk.active && body.world === physics.world) physics.world.removeBody(body);
  }
  function setPhysicsActive(chunk: PhysicsChunk, active: boolean) {
    if (chunk.active === active) return;
    chunk.active = active;
    for (const body of chunk.bodies) {
      if (active && body.world !== physics.world) physics.world.addBody(body);
      else if (!active && body.world === physics.world) physics.world.removeBody(body);
    }
  }
  function activatePhysicsNear(point: Point) {
    for (const chunk of physicsChunks.values()) if (!chunk.active && distanceSquared(chunk.bounds, point) < 18 * 18) setPhysicsActive(chunk, true);
  }
  function updateActivePhysics(points: readonly Point[]) {
    for (const chunk of physicsChunks.values()) {
      const radius = chunk.active ? 24 : 18;
      setPhysicsActive(chunk, points.some(point => distanceSquared(chunk.bounds, point) < radius * radius));
    }
  }
  // Each batch has tight bounds, so the renderer culls it separately for the view and shadow cameras.
  function addJungleBatch(source: THREE.InstancedMesh, range: number, canopy = false) {
    source.instanceMatrix.needsUpdate = true;
    if (!culling) {
      instanceLocations.set(source, Array.from({ length: source.count }, (_, index) => ({ mesh: source, index })));
      source.computeBoundingSphere(); scene.add(source); return;
    }
    const locations: Array<{ mesh: THREE.InstancedMesh; index: number }> = new Array(source.count);
    instanceLocations.set(source, locations);
    const buckets = new Map<string, { x: number; z: number; indices: number[] }>();
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    for (let i = 0; i < source.count; i++) {
      source.getMatrixAt(i, matrix);
      const x = Math.floor(matrix.elements[12] / chunkSize), z = Math.floor(matrix.elements[14] / chunkSize), key = `${x},${z}`;
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { x: (x + 0.5) * chunkSize, z: (z + 0.5) * chunkSize, indices: [] }; buckets.set(key, bucket); }
      bucket.indices.push(i);
    }
    const farGeometry = canopy ? new THREE.IcosahedronGeometry(1, 0) : source.name === 'JungleTrunks' ? new THREE.CylinderGeometry(0.65, 1, 1, 3) : undefined;
    for (const [key, bucket] of buckets) {
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, bucket.indices.length);
      mesh.name = `${source.name}/${key}`; mesh.position.set(bucket.x, 0, bucket.z);
      mesh.frustumCulled = true; mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
      for (let i = 0; i < bucket.indices.length; i++) {
        source.getMatrixAt(bucket.indices[i], matrix); matrix.elements[12] -= bucket.x; matrix.elements[14] -= bucket.z;
        mesh.setMatrixAt(i, matrix);
        locations[bucket.indices[i]] = { mesh, index: i };
        if (source.instanceColor) { source.getColorAt(bucket.indices[i], color); mesh.setColorAt(i, color); }
      }
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
      // Weapon traces must not raycast every hidden instance before discarding the hits.
      mesh.raycast = function (raycaster, hits) { if (this.visible) THREE.InstancedMesh.prototype.raycast.call(this, raycaster, hits); };
      scene.add(mesh);
      let farMesh: THREE.InstancedMesh | undefined;
      if (farGeometry) {
        farMesh = new THREE.InstancedMesh(farGeometry, source.material, mesh.count);
        farMesh.name = `${mesh.name}/distant`; farMesh.position.copy(mesh.position); farMesh.frustumCulled = true;
        farMesh.instanceMatrix = mesh.instanceMatrix; farMesh.instanceColor = mesh.instanceColor;
        farMesh.computeBoundingBox(); farMesh.computeBoundingSphere(); farMesh.updateMatrix(); farMesh.matrixAutoUpdate = false;
        farMesh.raycast = mesh.raycast; farMesh.visible = false; scene.add(farMesh);
      }
      renderChunks.push({ mesh, farMesh, range, shadows: source.castShadow, detailed: true });
    }
    source.dispose();
  }
  const dirt = new THREE.MeshStandardMaterial({ color: 0x62543c, roughness: 1, vertexColors: true });
  let seed = 170916;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const obstacles: Array<{ x: number; z: number; radius: number }> = [];
  const jungleObstacleBodies = new WeakSet<CANNON.Body>();
  type TreePart = { source: THREE.InstancedMesh; index: number };
  const obstacleVisuals = new Map<CANNON.Body, { entry: typeof obstacles[number]; rock?: THREE.Mesh; farMesh?: THREE.Mesh; size?: THREE.Vector3; parts?: TreePart[] }>();
  const pendingImpacts: Array<{ body: CANNON.Body; from: Point; disintegrate: boolean }> = [];
  const fallingTrees: Array<{ age: number; direction: THREE.Vector3; disintegrate: boolean; parts: Array<{ mesh: THREE.InstancedMesh; index: number; rest: THREE.Matrix4; pivot: THREE.Vector3 }> }> = [];
  const rockDebris = createBreakableDebris(scene, 0x58654a);
  function breakJungleObstacle(body: CANNON.Body, from: Point) {
    if (obstacleVisuals.has(body) && !pendingImpacts.some(impact => impact.body === body)) {
      pendingImpacts.push({ body, from: { x: from.x, y: from.y, z: from.z }, disintegrate: false });
    }
  }
  function disintegrateTrees(center: Point, radius: number) {
    const positions: Point[] = [], radiusSquared = radius * radius;
    for (const [body, visual] of obstacleVisuals) {
      if (!visual.parts?.length) continue;
      const dx = visual.entry.x - center.x, dz = visual.entry.z - center.z;
      if (dx * dx + dz * dz > radiusSquared) continue;
      if (pendingImpacts.some(impact => impact.body === body)) continue;
      positions.push({ x: visual.entry.x, y: body.position.y + 8, z: visual.entry.z });
      pendingImpacts.push({ body, from: { x: center.x, y: center.y, z: center.z }, disintegrate: true });
    }
    return positions;
  }
  function applyObstacleImpacts() {
    for (const { body, from, disintegrate } of pendingImpacts.splice(0)) {
      const visual = obstacleVisuals.get(body); if (!visual) continue;
      obstacleVisuals.delete(body);
      const { entry, rock, farMesh, size, parts } = visual;
      obstacles.splice(obstacles.indexOf(entry), 1);
      if (body.world === physics.world) physics.world.removeBody(body);
      for (const chunk of physicsChunks.values()) {
        const index = chunk.bodies.indexOf(body);
        if (index >= 0) chunk.bodies.splice(index, 1);
      }
      if (rock && size) {
        rock.visible = false; if (farMesh) farMesh.visible = false;
        const distant = distantProps.findIndex(prop => prop.root === rock);
        if (distant >= 0) distantProps.splice(distant, 1);
        rockDebris.emit(rock.position, size);
      }
      if (parts) {
        const direction = new THREE.Vector3(entry.x - from.x, 0, entry.z - from.z).normalize();
        if (!direction.lengthSq()) direction.set(1, 0, 0);
        fallingTrees.push({ age: 0, direction, disintegrate, parts: parts.map(part => {
          const { mesh, index } = instanceLocations.get(part.source)![part.index], rest = new THREE.Matrix4();
          mesh.getMatrixAt(index, rest);
          mesh.frustumCulled = false;
          return { mesh, index, rest, pivot: new THREE.Vector3(entry.x - mesh.position.x, 0, entry.z - mesh.position.z) };
        }) });
      }
    }
  }
  const fallMatrix = new THREE.Matrix4(), fallRotation = new THREE.Matrix4(), fallOffset = new THREE.Matrix4(), fallAxis = new THREE.Vector3();
  const scaleMatrix = new THREE.Matrix4();
  function updateFallingTrees(dt: number) {
    for (let i = fallingTrees.length - 1; i >= 0; i--) {
      const tree = fallingTrees[i]; tree.age = Math.min(1.4, tree.age + dt);
      const progress = THREE.MathUtils.smoothstep(tree.age, 0, 1.4);
      const tilt = progress * (tree.disintegrate ? Math.PI * 0.06 : Math.PI * 0.48);
      fallAxis.set(tree.direction.z, 0, -tree.direction.x);
      fallRotation.makeRotationAxis(fallAxis, tilt);
      for (const { mesh, index, rest, pivot } of tree.parts) {
        mesh.frustumCulled = false;
        fallMatrix.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(fallRotation)
          .multiply(fallOffset.makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(rest);
        if (tree.disintegrate) {
          const scale = Math.max(0.001, 1 - progress);
          fallMatrix.multiply(scaleMatrix.makeScale(scale, scale, scale));
        }
        mesh.setMatrixAt(index, fallMatrix); mesh.instanceMatrix.needsUpdate = true;
      }
      if (tree.age >= 1.4) {
        for (const { mesh, index } of tree.parts) {
          if (tree.disintegrate) { mesh.setMatrixAt(index, scaleMatrix.makeScale(0, 0, 0)); mesh.instanceMatrix.needsUpdate = true; }
        }
        for (const mesh of new Set(tree.parts.map(part => part.mesh))) {
          mesh.computeBoundingBox(); mesh.computeBoundingSphere(); mesh.frustumCulled = true;
          const chunk = renderChunks.find(item => item.mesh === mesh);
          chunk?.farMesh?.computeBoundingBox(); chunk?.farMesh?.computeBoundingSphere();
        }
        fallingTrees.splice(i, 1);
      }
    }
  }
  function nearestPathPoint(x: number, z: number) {
    let index = 0, distance = Infinity;
    JUNGLE_ROUTE.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < distance) { distance = d; index = i; } });
    return { index, distance: Math.sqrt(distance) };
  }
  function clearing(x: number, z: number, margin = 0) {
    return ((x - RESCUE_SITE.clearing.x) / (25 + margin)) ** 2 + ((z - RESCUE_SITE.clearing.z) / (23 + margin)) ** 2 < 1;
  }
  const facility = (x: number, z: number, margin = 0) => Math.abs(x) < 38 + margin && z < -49 + margin && z > -92 - margin;
  const routeDistance = (x: number, z: number) => Math.min(nearestPathPoint(x, z).distance, ...WATERFALL_ROUTE.map(p => Math.hypot(p.x - x, p.z - z)));
  let bridgeBroken = false;
  const river = (z: number, margin = 0) => Math.abs(z - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth + margin;
  const waterfallLedge = (x: number, z: number) => x > -107 && x < -79.5 && z > 7 && z < 27;
  const isWalkable = (x: number, z: number, radius = 0.6) => x > RESCUE_SITE.west + radius && x < RESCUE_SITE.east - radius && Math.abs(z) < 118
    && (x > RESCUE_SITE.mountainX + radius || (x > -106 + radius && z > 9 + radius && z < 25 - radius))
    && (!river(z) || waterfallLedge(x, z) || (!bridgeBroken && Math.abs(x - RESCUE_SITE.bridge.x) < 2.3))
    && !facility(x, z) && !obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.radius + radius);
  const gray = new THREE.MeshStandardMaterial({ color: 0x727b80, roughness: 0.9, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x353e43, roughness: 0.72, metalness: 0.45 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xa4a9a9, roughness: 0.7, metalness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xe15848, emissive: 0xcc3024, emissiveIntensity: 1.2 });
  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = gray, solid = true) => {
      const mesh = roomBox(scene, physics, s, p, m, solid);
      if (culling && !solid) distantProps.push({ root: mesh, center: mesh.position.clone(), range: 85 });
      return mesh;
    };
  // Duplicate edge rows form river cliffs exactly at the collision banks (z=10 and z=24).
  const terrainRows: Array<{ z: number; y: number }> = [];
  for (let z = -120; z <= 9; z += 3) terrainRows.push({ z, y: 0 });
  terrainRows.push({ z: 10, y: 0 }, { z: 10, y: -4.5 });
  for (let z = 12; z < 24; z += 3) terrainRows.push({ z, y: -4.5 });
  terrainRows.push({ z: 24, y: -4.5 }, { z: 24, y: 0 });
  for (let z = 27; z <= 120; z += 3) terrainRows.push({ z, y: 0 });
  const groundGeometry = new THREE.PlaneGeometry(RESCUE_SITE.east - RESCUE_SITE.west, 240, 128, terrainRows.length - 1);
  groundGeometry.rotateX(-Math.PI / 2); groundGeometry.translate((RESCUE_SITE.east + RESCUE_SITE.west) / 2, 0, 0);
  const colors = new Float32Array(groundGeometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    const row = terrainRows[Math.floor(i / 3 / 129)], x = groundGeometry.attributes.position.getX(i / 3), z = row.z;
    groundGeometry.attributes.position.setY(i / 3, row.y); groundGeometry.attributes.position.setZ(i / 3, z);
    const n = 0.65 + random() * 0.35, soil = clearing(x, z) || routeDistance(x, z) < 2.8;
    colors.set(soil ? [n, n * 0.88, n * 0.66] : [n * 0.56, n * 0.86, n * 0.45], i);
  }
  groundGeometry.computeVertexNormals();
  groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeometry, dirt); ground.receiveShadow = true; scene.add(ground);
  const terrainWidth = RESCUE_SITE.east - RESCUE_SITE.west, terrainCenter = (RESCUE_SITE.east + RESCUE_SITE.west) / 2;
  physics.addBox({ x: terrainWidth, y: 4.5, z: 96 }, { x: terrainCenter, y: -2.25, z: 72 });
  physics.addBox({ x: terrainWidth, y: 4.5, z: 130 }, { x: terrainCenter, y: -2.25, z: -55 });
  physics.addBox({ x: terrainWidth, y: 1, z: 14 }, { x: terrainCenter, y: -5, z: RESCUE_SITE.riverZ });
  for (const x of [RESCUE_SITE.west + 1, RESCUE_SITE.east - 1]) physics.addBox({ x: 2, y: 120, z: 240 }, { x, y: 59, z: 0 });
  for (const z of [-119, 119]) physics.addBox({ x: terrainWidth, y: 120, z: 2 }, { x: terrainCenter, y: 59, z });
  const riverWater = createJungleWater(scene, { y: RESCUE_SITE.riverY, z: RESCUE_SITE.riverZ,
    halfWidth: RESCUE_SITE.riverHalfWidth, length: 384 });
  const water = riverWater.mesh;
  const bridge = new THREE.Group(); bridge.name = 'OldStoneTrailBridge'; bridge.position.copy(RESCUE_SITE.bridge); scene.add(bridge);
  const timber = new THREE.MeshStandardMaterial({ color: 0x61513c, roughness: 0.95 });
  const planks = Array.from({ length: 18 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.22, 0.94), timber); mesh.position.set(0, 0.12, -8.5 + i); mesh.castShadow = true; mesh.receiveShadow = true; bridge.add(mesh);
    return { mesh, rest: mesh.position.clone() };
  });
  const supports: Array<{ mesh: THREE.Mesh; rest: THREE.Vector3 }> = [];
  for (const x of [-2.15, 2.15]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 18), timber); beam.position.set(x, -0.18, 0); bridge.add(beam); supports.push({ mesh: beam, rest: beam.position.clone() });
    for (const z of [-8, -4, 0, 4, 8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), timber); post.position.set(x, 0.7, z); bridge.add(post); supports.push({ mesh: post, rest: post.position.clone() });
    }
    for (const z of [0]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.15, 18), timber);
      rail.position.set(x, 1.3, z); bridge.add(rail); supports.push({ mesh: rail, rest: rail.position.clone() });
    }
  }
  const bridgeBody = physics.addBox({ x: 4.8, y: 0.3, z: 18 }, { x: RESCUE_SITE.bridge.x, y: 0.08, z: RESCUE_SITE.bridge.z });
  const bridgeBodies = [bridgeBody];
  // Overlap both banks and the deck; the top faces rise continuously from soil to planks.
  for (const side of [-1, 1]) {
    const slope = Math.atan2(0.25, 2.6);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, Math.hypot(2.6, 0.25)), timber);
    ramp.rotation.x = side * slope;
    ramp.position.set(RESCUE_SITE.bridge.x, 0.105 - 0.1 * Math.cos(slope), RESCUE_SITE.bridge.z + side * 9.9);
    ramp.castShadow = true; ramp.receiveShadow = true; scene.add(ramp);
    bridgeBodies.push(physics.addBoxFromMesh(ramp)); supports.push({ mesh: ramp, rest: ramp.position.clone() });
  }
  function damageBridge(age: number) {
    if (bridgeBroken) return;
    const hit = THREE.MathUtils.smoothstep(age, 0, 0.45);
    supports.forEach((part, index) => { if (part.rest.x < 0) { part.mesh.rotation.z = hit * (0.12 + index % 3 * 0.08); part.mesh.position.y = part.rest.y - hit * 0.25; } });
    for (const plank of planks) if (plank.rest.z > 4) { plank.mesh.rotation.z = hit * 0.1; plank.mesh.position.y = plank.rest.y - hit * 0.12; }
  }
  function breakBridge(age: number) {
    if (!bridgeBroken) {
      bridgeBroken = true;
      for (const body of bridgeBodies) if (body.world) physics.world.removeBody(body);
    }
    const visible = age < 0.8;
    bridge.visible = visible;
    for (let i = 0; i < planks.length; i++) {
      const p = planks[i], t = Math.max(0, age - Math.abs(i - 9) * 0.035);
      p.mesh.visible = visible;
      p.mesh.position.copy(p.rest); p.mesh.position.y -= Math.min(4.8, t * t * 5); p.mesh.position.x += Math.sin(i * 5) * Math.min(1.5, t);
      p.mesh.rotation.set(Math.min(1.5, t) * Math.sin(i), 0, Math.min(2, t) * Math.cos(i * 3));
    }
    supports.forEach((part, index) => {
      part.mesh.visible = visible;
      const t = Math.max(0, age - index % 3 * 0.08);
      part.mesh.position.copy(part.rest).add(new THREE.Vector3(Math.sign(part.rest.x) * Math.min(2, t), -Math.min(5.2, t * t * 4.9), Math.sin(index) * t));
      part.mesh.rotation.set(t * Math.sin(index), t * 0.3, Math.sign(part.rest.x) * Math.min(1.8, t));
    });
  }
  if (bridgeBrokenAtStart) breakBridge(2.4);
  const mountain = new THREE.Group(); mountain.name = 'ImpassableWesternMountain'; scene.add(mountain);
  const cliffMaterial = new THREE.MeshStandardMaterial({ name: 'WeatheredMountainRock', color: 0xffffff, roughness: 0.96, metalness: 0.03 });
  cliffMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockWorldPosition;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vRockWorldPosition;\n${mountainRock}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mountainSurface(vRockWorldPosition);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 rockNormal = inverseTransformDirection(normal, viewMatrix);
        vec3 rockDx = dFdx(vRockWorldPosition), rockDy = dFdy(vRockWorldPosition);
        vec3 rockR1 = cross(rockDy, rockNormal), rockR2 = cross(rockNormal, rockDx);
        float rockDet = dot(rockDx, rockR1);
        float rockHeight = mountainBump(vRockWorldPosition);
        vec3 rockGradient = sign(rockDet) * (dFdx(rockHeight) * rockR1 + dFdy(rockHeight) * rockR2);
        normal = normalize(mat3(viewMatrix) * (max(abs(rockDet), 0.00001) * rockNormal - rockGradient));`);
  };
  cliffMaterial.customProgramCacheKey = () => 'weathered-mountain-rock-v1';
  const profile = new THREE.Shape();
  profile.moveTo(-120, -4.5); profile.lineTo(9, -4.5); profile.lineTo(9, 8);
  profile.lineTo(25, 8); profile.lineTo(25, -4.5); profile.lineTo(120, -4.5);
  for (let z = 120; z >= -120; z -= 16) profile.lineTo(z, 76 + Math.sin(z * 0.11) * 11 + Math.cos(z * 0.27) * 8);
  profile.closePath();
  const cliffGeometry = new THREE.ExtrudeGeometry(profile, { depth: RESCUE_SITE.mountainX - RESCUE_SITE.west, bevelEnabled: false, steps: 1 });
  cliffGeometry.rotateY(-Math.PI / 2);
  const cliff = new THREE.Mesh(cliffGeometry, cliffMaterial); cliff.position.x = RESCUE_SITE.mountainX;
  cliff.castShadow = cliff.receiveShadow = true; mountain.add(cliff);
  for (const [size, position] of [
    [[156, 100, 129], [-162, 45.5, -55.5]], [[156, 100, 95], [-162, 45.5, 72.5]],
    [[156, 92, 16], [-162, 54, 17]], [[132, 100, 16], [-174, 45.5, 17]],
  ] as const) physics.addBox({ x: size[0], y: size[1], z: size[2] }, { x: position[0], y: position[1], z: position[2] });
  const caveBack = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 16), cliffMaterial);
  caveBack.position.set(-107.5, 4, 17); mountain.add(caveBack);
  for (let z = -110; z <= 110; z += 20) {
    if (z > -2 && z < 36) continue;
    const face = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), cliffMaterial);
    face.position.set(-87, 25, z); face.scale.set(5, 30 + Math.sin(z) * 5, 13); mountain.add(face);
  }
  box([28, 0.4, 20], [-94, -0.2, 17], cliffMaterial);
  const waterfallRoot = new THREE.Group(); waterfallRoot.name = 'HiddenWaterfallArena'; scene.add(waterfallRoot);
  const waterfallOrigin = new THREE.Vector3(-79.8, RESCUE_SITE.riverY, 17), waterfallHeight = 84;
  const waterfallUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 }, uHeight: { value: waterfallHeight }, uMode: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) }, uOrigin: { value: waterfallOrigin },
    uWaterColor: { value: new THREE.Color(0x4c968e) }, uFoamColor: { value: new THREE.Color(0xdcefe8) },
    uSkyColor: { value: new THREE.Color(0x90afba) }, uForestColor: { value: new THREE.Color(0x344d32) },
    uSunColor: { value: new THREE.Color(0xffe8b9) }, uSunDirection: { value: new THREE.Vector3(-40, 90, 30).normalize() },
  };
  const waterfallShader = waterfallFragment.replace('#include <jungle_water_noise>', waterNoise);
  const waterfallMaterial = new THREE.ShaderMaterial({
    name: 'FlowingWaterfall', uniforms: waterfallUniforms, vertexShader: waterfallVertex, fragmentShader: waterfallShader,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: true, fog: true,
  });
  const waterfallCurtain = new THREE.Mesh(new THREE.PlaneGeometry(16, waterfallHeight, 48, 168), waterfallMaterial);
  waterfallCurtain.name = 'RiverWaterfall'; waterfallCurtain.rotation.y = Math.PI / 2;
  waterfallCurtain.position.copy(waterfallOrigin).add(new THREE.Vector3(0, waterfallHeight / 2, 0)); waterfallCurtain.raycast = () => {};
  waterfallCurtain.geometry.computeBoundingSphere(); waterfallCurtain.geometry.boundingSphere!.radius += 0.3; waterfallRoot.add(waterfallCurtain);
  const spillway = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 17), cliffMaterial);
  spillway.name = 'WaterfallRockLip'; spillway.position.set(-82, waterfallOrigin.y + waterfallHeight + 0.65, 17);
  waterfallRoot.add(spillway);
  const foamMaterial = new THREE.ShaderMaterial({
    name: 'WaterfallImpactFoam', uniforms: { ...waterfallUniforms, uMode: { value: 1 } }, vertexShader: waterfallVertex, fragmentShader: waterfallShader,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: true, fog: true,
  });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(7, 16, 1, 1), foamMaterial);
  foam.name = 'WaterfallImpactFoam'; foam.rotation.x = -Math.PI / 2;
  foam.position.copy(waterfallOrigin).add(new THREE.Vector3(1.6, 0.045, 0)); foam.raycast = () => {}; waterfallRoot.add(foam);
  const sprayGeometry = new THREE.BufferGeometry(), spraySeeds = new Float32Array(240 * 4);
  for (let i = 0; i < spraySeeds.length; i++) spraySeeds[i] = random();
  sprayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(240 * 3), 3));
  sprayGeometry.setAttribute('aSpray', new THREE.Float32BufferAttribute(spraySeeds, 4));
  sprayGeometry.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -1, -8), new THREE.Vector3(5, 5, 8));
  sprayGeometry.boundingSphere = sprayGeometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const sprayMaterial = new THREE.ShaderMaterial({
    name: 'WaterfallSpray', defines: { WATERFALL_SPRAY: 1 }, uniforms: waterfallUniforms,
    vertexShader: waterfallVertex, fragmentShader: waterfallShader, transparent: true, depthWrite: false, toneMapped: true, fog: true,
  });
  const spray = new THREE.Points(sprayGeometry, sprayMaterial);
  spray.name = 'WaterfallSpray'; spray.position.copy(waterfallOrigin); spray.raycast = () => {}; waterfallRoot.add(spray);
  const caveLight = new THREE.PointLight(0x8eafff, 95, 30); caveLight.position.set(-99, 5, 17); waterfallRoot.add(caveLight);
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(16, 8),
    new THREE.MeshBasicMaterial({ color: 0xaf72ff, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
  seal.name = 'WaterfallArenaSeal'; seal.rotation.y = Math.PI / 2; seal.position.set(-83.7, 4, 17); seal.visible = false; waterfallRoot.add(seal);
  const sealBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.25, 4, 8)) });
  sealBody.position.set(-83.7, 4, 17);
  const waterfall = {
    root: waterfallRoot, center: new THREE.Vector3(-97, 0, 17), bounds: new THREE.Box3(new THREE.Vector3(-106, 0, 9), new THREE.Vector3(-84, 8, 25)),
    contains(point: Point) { return point.x < -85 && point.x > -106 && point.z > 9 && point.z < 25 && point.y < 7; },
    setLocked(locked: boolean) {
      seal.visible = locked;
      if (locked && sealBody.world !== physics.world) physics.world.addBody(sealBody);
      else if (!locked && sealBody.world === physics.world) physics.world.removeBody(sealBody);
    },
    get locked() { return sealBody.world === physics.world; },
  };
  const farRockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0), rockMaterial = new THREE.MeshStandardMaterial({ color: 0x58654a, roughness: 1 });
  for (let i = 0; i < 100; i++) {
    const x = (random() - 0.5) * 374, z = (random() - 0.5) * 230;
    if (x < RESCUE_SITE.mountainX + 3 || x > RESCUE_SITE.east - 3 || river(z, 3) || clearing(x, z, 2) || facility(x, z, 3) || routeDistance(x, z) < 6) continue;
    const rock = new THREE.Mesh(rockGeometry, rockMaterial); const s = 0.5 + (i % 7) * 0.32;
    rock.position.set(x, s * 0.45, z); rock.scale.set(s * 1.3, s * 0.8, s); rock.rotation.set(i, i * 0.4, 0); rock.castShadow = true; scene.add(rock);
    const bounds = new THREE.Box3().setFromObject(rock), rockBody = physics.addBox(bounds.getSize(new THREE.Vector3()), bounds.getCenter(new THREE.Vector3()));
    jungleObstacleBodies.add(rockBody); trackStaticBody(rockBody);
    let farMesh: THREE.Mesh | undefined;
    if (culling) {
          rock.updateMatrix(); rock.matrixAutoUpdate = false;
          farMesh = new THREE.Mesh(farRockGeometry, rockMaterial); farMesh.position.copy(rock.position); farMesh.quaternion.copy(rock.quaternion); farMesh.scale.copy(rock.scale);
          farMesh.visible = false; farMesh.updateMatrix(); farMesh.matrixAutoUpdate = false; scene.add(farMesh);
          distantProps.push({ root: rock, center: rock.position.clone(), range: 140, farMesh, detailed: true });
        }
    const entry = { x, z, radius: bounds.getSize(new THREE.Vector3()).length() * 0.5 };
    obstacles.push(entry); obstacleVisuals.set(rockBody, { entry, rock, farMesh, size: bounds.getSize(new THREE.Vector3()) });
  }
  const barkCanvas = document.createElement('canvas'); barkCanvas.width = 128; barkCanvas.height = 256;
  const barkContext = barkCanvas.getContext('2d')!; barkContext.fillStyle = '#493c29'; barkContext.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 180; i++) {
    barkContext.fillStyle = i % 3 ? '#62513a' : '#292e20';
    barkContext.fillRect(random() * 128, random() * 256, 1 + random() * 4, 12 + random() * 85);
  }
  const barkTexture = new THREE.CanvasTexture(barkCanvas); barkTexture.colorSpace = THREE.SRGBColorSpace;
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture, roughness: 1 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0x547e35, roughness: 1, flatShading: true });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.65, 1, 1, 7), bark, 1200);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), foliage, 4800);
  const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.38, 1, 5), bark, 3600);
  const vines = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.04, 1, 5), new THREE.MeshStandardMaterial({ color: 0x536338, roughness: 1 }), 2400);
  trunks.name = 'JungleTrunks'; crowns.name = 'JungleCanopy'; branches.name = 'JungleBranches'; vines.name = 'HangingVines';
  const dummy = new THREE.Object3D(), tint = new THREE.Color(), yAxis = new THREE.Vector3(0, 1, 0);
  let treeCount = 0, crownCount = 0, branchCount = 0, vineCount = 0;
  function instance(mesh: THREE.InstancedMesh, index: number, position: THREE.Vector3, scale: THREE.Vector3, rotation = new THREE.Euler()) {
    dummy.position.copy(position); dummy.scale.copy(scale); dummy.rotation.copy(rotation); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  }
  for (let x0 = -184; x0 <= 184; x0 += 9) for (let z0 = -112; z0 <= 112; z0 += 9) {
    const x = x0 + (random() - 0.5) * 5, z = z0 + (random() - 0.5) * 5;
    if (river(z, 4) || clearing(x, z, 3) || facility(x, z, 3) || routeDistance(x, z) < 5 || !isWalkable(x, z, 1.5)) continue;
    const height = 15 + random() * 11, radius = 0.38 + random() * 0.4;
    const parts: TreePart[] = [{ source: trunks, index: treeCount }];
    instance(trunks, treeCount++, new THREE.Vector3(x, height / 2, z), new THREE.Vector3(radius, height, radius));
    const body = new CANNON.Body({ mass: 0, material: physics.solidMaterial, shape: new CANNON.Cylinder(radius * 0.65, radius, height, 7) });
    body.position.set(x, height / 2, z); physics.world.addBody(body); jungleObstacleBodies.add(body); trackStaticBody(body);
    const entry = { x, z, radius }; obstacles.push(entry); obstacleVisuals.set(body, { entry, parts });
    for (let j = 0; j < 4; j++) {
      const angle = j * 2.4 + random(), spread = j === 0 ? 0 : 2.8;
      const p = new THREE.Vector3(x + Math.sin(angle) * spread, height - (j % 2) * 3, z + Math.cos(angle) * spread);
      instance(crowns, crownCount, p, new THREE.Vector3(4.3 + random() * 1.8, 2.3 + random(), 4.3 + random()), new THREE.Euler(0, angle, 0));
      parts.push({ source: crowns, index: crownCount });
      crowns.setColorAt(crownCount++, tint.setHSL(0.23 + random() * 0.08, 0.35 + random() * 0.2, 0.34 + random() * 0.22));
      if (j === 0) continue;
      const base = new THREE.Vector3(x, height - 5, z), delta = p.clone().sub(base);
      dummy.position.copy(base).addScaledVector(delta, 0.5); dummy.scale.set(1, delta.length(), 1);
      dummy.quaternion.setFromUnitVectors(yAxis, delta.normalize()); dummy.updateMatrix();
      parts.push({ source: branches, index: branchCount }); branches.setMatrixAt(branchCount++, dummy.matrix);
      if (j < 3) {
        parts.push({ source: vines, index: vineCount });
        instance(vines, vineCount++, p.clone().add(new THREE.Vector3(0, -5, 0)), new THREE.Vector3(1, 9 + random() * 4, 1));
      }
    }
  }
  for (const [mesh, count] of [[trunks, treeCount], [crowns, crownCount], [branches, branchCount], [vines, vineCount]] as const) {
    mesh.count = count; mesh.castShadow = mesh !== vines && (!culling || mesh !== branches); mesh.receiveShadow = true;
    addJungleBatch(mesh, mesh === vines ? 38 : mesh === branches ? 60 : 145, mesh === crowns);
  }
  const leaf = new THREE.Shape(); leaf.moveTo(0, 0); leaf.quadraticCurveTo(-0.48, 0.42, 0, 1); leaf.quadraticCurveTo(0.48, 0.42, 0, 0);
  const fronds = new THREE.InstancedMesh(new THREE.ShapeGeometry(leaf, 5), new THREE.MeshStandardMaterial({ color: 0x669642, roughness: 0.9, side: THREE.DoubleSide }), 21000);
  fronds.name = 'JungleFerns'; let frondCount = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (random() - 0.5) * 379, z = (random() - 0.5) * 235;
    if (x < RESCUE_SITE.mountainX + 3 || x > RESCUE_SITE.east - 3 || river(z, 2) || clearing(x, z) || facility(x, z) || routeDistance(x, z) < 2.5) continue;
    const scale = 0.7 + random() * 1.1;
    for (let j = 0; j < 7; j++) {
      const angle = j / 7 * Math.PI * 2 + i;
      dummy.position.set(x, 0.04, z); dummy.scale.set(scale, scale * 1.7, scale);
      dummy.quaternion.setFromUnitVectors(yAxis, new THREE.Vector3(Math.sin(angle), 0.45, Math.cos(angle)).normalize()); dummy.updateMatrix();
      fronds.setMatrixAt(frondCount, dummy.matrix); fronds.setColorAt(frondCount++, tint.setHSL(0.22 + random() * 0.1, 0.5, 0.35 + random() * 0.2));
    }
  }
  fronds.count = frondCount; fronds.receiveShadow = true; addJungleBatch(fronds, 42);
  const pathLength = JUNGLE_PATH.getLength();
  const trailSteps = [JUNGLE_PATH, WATERFALL_PATH].map(path => ({ path, steps: Math.ceil(path.getLength() / 1.15) }));
  const stones = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), new THREE.MeshStandardMaterial({ color: 0x929185, roughness: 1 }), trailSteps.reduce((sum, trail) => sum + trail.steps + 1, 0) * 3);
  stones.name = 'WindingStoneTrail'; let stoneCount = 0;
  for (const { path, steps } of trailSteps) for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = path.getPointAt(t), tangent = path.getTangentAt(t), normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
    if (river(p.z, 2) && !waterfallLedge(p.x, p.z)) continue;
    for (const lane of [-1, 0, 1]) {
      const size = new THREE.Vector3(1.02 + random() * 0.08, 1, 1.06 + random() * 0.1);
      const center = p.clone().addScaledVector(normal, lane * 1.12); center.y = 0;
      const yaw = Math.atan2(tangent.x, tangent.z) + (random() - 0.5) * 0.07;
      instance(stones, stoneCount, center, size, new THREE.Euler(0, yaw, 0));
      stones.setColorAt(stoneCount++, tint.setHSL(0.16 + random() * 0.08, 0.08 + random() * 0.12, 0.56 + random() * 0.2));
      const body = physics.addBox({ x: size.x, y: 0.06, z: size.z }, center); body.quaternion.setFromEuler(0, yaw, 0); body.aabbNeedsUpdate = true; trackStaticBody(body);
    }
  }
  stones.count = stoneCount; stones.receiveShadow = true; addJungleBatch(stones, 140);
  for (const t of [0.16, 0.36, 0.57, 0.78]) {
    const p = JUNGLE_PATH.getPointAt(t), tangent = JUNGLE_PATH.getTangentAt(t);
    const x = p.x + tangent.z * 2.25, z = p.z - tangent.x * 2.25;
    box([0.18, 0.85, 0.18], [x, 0.425, z], dark);
    box([0.23, 0.08, 0.23], [x, 0.8, z], new THREE.MeshStandardMaterial({ color: 0xb7c89b, emissive: 0x8ead78, emissiveIntensity: 0.65 }), false);
  }
  for (let i = 0; i < (culling ? 0 : 28); i++) {
    const angle = i / 28 * Math.PI * 2, mountain = new THREE.Mesh(new THREE.ConeGeometry(20 + i % 5 * 5, 30 + i % 4 * 10, 5), rockMaterial);
    mountain.position.set(Math.sin(angle) * 205, 8, Math.cos(angle) * 205); mountain.rotation.y = i; scene.add(mountain);
  }
  box([1, 24, 32], [-35, 12, -71]); box([1, 24, 32], [35, 12, -71]); box([70, 24, 1], [0, 12, -87]);
  const facilityRoof = box([71, 0.8, 33], [0, 24, -71], dark);
  facilityRoof.name = 'RescueSiteFacilityRoof';
  box([70, 0.2, 32], [0, -0.1, -71], dark);
  box([30, 24, 1], [-20, 12, RESCUE_SITE.doorZ]); box([30, 24, 1], [20, 12, RESCUE_SITE.doorZ]);
  box([10, 19, 1], [0, 14.5, RESCUE_SITE.doorZ]);
  const door = createSlidingPortal(scene, physics, { x: 0, y: 0, z: RESCUE_SITE.doorZ, yaw: 0 }, 10, 5, 'AI RESEARCH / ACCESS');
  for (const x of [-30, -20, -10, 10, 20, 30]) {
    box([1.1, 24.6, 1.4], [x, 12.1, -54.5], dark);
    for (const y of [8, 15, 21]) {
      box([7.4, 3.2, 0.25], [x + (x < 0 ? 4.5 : -4.5), y, -54.62], trim, false);
      for (let k = 0; k < 5; k++) box([6.8, 0.16, 0.4], [x + (x < 0 ? 4.5 : -4.5), y - 1.2 + k * 0.55, -54.35], dark, false);
    }
  }
  box([10, 0.5, 4], [0, 4.5, -53.5], dark); box([9.5, 0.09, 0.12], [0, 4.17, -51.55], red, false);
  cargoSign(scene, 'C E N T R A L   I N T E L L I G E N C E', [0, 18, -54.2], 22);
  const rooftopEquipment = new THREE.Group(); rooftopEquipment.name = 'FacilityRooftopEquipment'; scene.add(rooftopEquipment);
  for (const x of [-12, 15]) {
    rooftopEquipment.add(box([9, 4, 9], [x, 26, -72], dark), box([9.4, 0.3, 9.4], [x, 28, -72], trim, false));
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 12, 10), trim); aerial.position.set(x, 30, -72); rooftopEquipment.add(aerial);
  }
  const sentinelHull = new THREE.MeshStandardMaterial({ color: 0x324658, metalness: 0.78, roughness: 0.34 });
  const sentinelArmor = new THREE.MeshStandardMaterial({ color: 0xb5cbd4, metalness: 0.65, roughness: 0.38 });
  const sentinelGlow = new THREE.MeshBasicMaterial({ color: 0x74dfff });
  const turrets = [-9, 9].map(x => {
    box([2, 0.5, 2], [x, 4.5, -53.6], dark);
    const root = new THREE.Group(); root.name = `FacilityShipSentinel${x < 0 ? 'Left' : 'Right'}`;
    root.position.set(x, 5, -53.25); scene.add(root);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.75, 1.7), sentinelHull); hull.rotation.z = 0.08; root.add(hull);
    for (const side of [-1, 1]) {
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.6, 2.1), sentinelArmor);
      armor.position.set(side * 0.9, -0.05, -0.12); armor.rotation.z = side * 0.2; root.add(armor);
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.3, 0.16, 12), sentinelGlow);
      engine.rotation.x = Math.PI / 2; engine.position.set(side * 0.9, -0.05, -1.22); root.add(engine);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 1.35), sentinelHull);
      barrel.position.set(side * 0.43, 0, 1.1); root.add(barrel);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.14, 0.05), sentinelGlow);
    visor.position.set(0, 0.2, 0.88); root.add(visor);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), red); muzzle.position.z = 1.85; root.add(muzzle);
    root.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = true; });
    return { root, muzzle };
  });
  const wallMoss = new THREE.MeshStandardMaterial({ color: 0x4e613f, roughness: 1 });
  for (const x of [-32, -24, -15, 15, 24, 32]) {
    box([3.5, 0.05, 2.5], [x, 24.44, -55.8], wallMoss, false);
    for (let j = 0; j < 4; j++) {
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 3 + j, 5), wallMoss);
      vine.position.set(x + j * 0.35, 23 - j * 0.8, -54.66); scene.add(vine);
    }
  }
  for (const x of [-5, 5]) box([0.2, 5, 12], [x, 2.5, -61], dark);
  box([10, 5, 0.4], [0, 2.5, -67], dark);
  const pod = createEscapePod(); pod.position.copy(RESCUE_SITE.pod); pod.rotation.copy(RESCUE_SITE.podRotation); scene.add(pod);
  const podTrail = pod.getObjectByName('PodTrail')!; podTrail.visible = false;
  const ship = createEscapeShip(); ship.root.position.copy(RESCUE_SITE.ship); ship.setThrust(0); ship.setFlying(false, true); scene.add(ship.root);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0x4f3d2e, roughness: 1 }));
  crater.rotation.x = -Math.PI / 2; crater.scale.set(3.5, 8, 1); crater.position.set(RESCUE_SITE.pod.x, 0.025, RESCUE_SITE.pod.z + 2); scene.add(crater);
  const dust = Array.from({ length: 24 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xa58b6e, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(mesh); return { mesh, angle: i * 2.4, delay: i * 0.025 };
  });
  const boy = new THREE.Group(); boy.name = 'RescuedPodBoy'; boy.position.copy(RESCUE_SITE.boy); scene.add(boy);
  let disposed = false, settled = false, mixer: THREE.AnimationMixer | null = null;
  let idle: THREE.AnimationAction | undefined, walk: THREE.AnimationAction | undefined, walking = false;
  const ready = loadBoyModel().then(gltf => {
    if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; }
    const model = gltf.scene, bounds = new THREE.Box3().setFromObject(model);
    model.scale.multiplyScalar(1.75 / Math.max(0.01, bounds.getSize(new THREE.Vector3()).y));
    bounds.setFromObject(model); const center = bounds.getCenter(new THREE.Vector3()); model.position.set(-center.x, -bounds.min.y, -center.z);
    model.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    boy.add(model); mixer = new THREE.AnimationMixer(model);
    const idleClip = gltf.animations.find(c => /idle/i.test(c.name)), walkClip = gltf.animations.find(c => /walk/i.test(c.name));
    if (idleClip) idle = mixer.clipAction(idleClip);
    if (walkClip) walk = mixer.clipAction(walkClip);
    (walking ? walk ?? idle : idle)?.play(); settled = true;
  }).catch(error => { settled = true; if (!disposed) console.error('[Rescue] Could not load boy.glb:', error); });
  scene.add(new THREE.HemisphereLight(0xd1e2c0, 0x253921, 2));
  const sun = new THREE.DirectionalLight(0xffe3ac, 3.6); sun.position.set(-70, 90, 25); sun.castShadow = true;
  sun.target.position.set(-30, 0, -5); scene.add(sun.target);
  sun.shadow.mapSize.set(culling ? 1024 : 2048, culling ? 1024 : 2048);
  const shadowSpan = culling ? 38 : 115;
  Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, far: 260 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.001; scene.add(sun);
  if (culling) for (const root of [ship.root, pod, boy]) distantProps.push({ root, center: root.position.clone(), range: 140 });
  const localBounds = new THREE.Box3(), cameraPosition = new THREE.Vector3();
  function updateVisibility(camera: THREE.Camera, focus: Point) {
    if (!culling) return;
    camera.getWorldPosition(cameraPosition);
    for (const chunk of renderChunks) {
      localBounds.copy(chunk.mesh.boundingBox!).translate(chunk.mesh.position);
      const distance = distanceSquared(localBounds, cameraPosition);
            const wasVisible = chunk.mesh.visible || !!chunk.farMesh?.visible, range = chunk.range + (wasVisible ? 4 : -4);
            const visible = distance < range * range;
      if (chunk.farMesh) {
        const threshold = chunk.detailed ? 64 : 56;
        chunk.detailed = distance < threshold * threshold;
        chunk.farMesh.visible = visible && !chunk.detailed;
      }
      chunk.mesh.visible = visible && (!chunk.farMesh || chunk.detailed);
      chunk.mesh.castShadow = chunk.shadows && distanceSquared(localBounds, focus) < 52 * 52;
    }
    for (const prop of distantProps) {
      const dx = prop.center.x - cameraPosition.x, dz = prop.center.z - cameraPosition.z;
      const distance = dx * dx + dz * dz, range = prop.range + (prop.root.visible || prop.farMesh?.visible ? 4 : -4);
            const visible = distance < range * range;
            if (prop.farMesh) {
              const threshold = prop.detailed ? 54 : 46; prop.detailed = distance < threshold * threshold;
              prop.farMesh.visible = visible && !prop.detailed;
            }
            prop.root.visible = visible && (!prop.farMesh || !!prop.detailed);
            const near = Math.hypot(prop.center.x - focus.x, prop.center.z - focus.z) < 45;
            prop.root.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = near; });
    }
    // Keep a small, stable shadow region around gameplay rather than shading the entire jungle.
    const x = Math.round(focus.x / 2) * 2, z = Math.round(focus.z / 2) * 2;
    sun.target.position.set(x, 0, z); sun.position.set(x - 40, 90, z + 30);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  }
  function prepareMinimap(focus: Point, radius: number) {
    const visibility: Array<[THREE.Object3D, boolean]> = [];
    const show = (object: THREE.Object3D, visible: boolean) => { visibility.push([object, object.visible]); object.visible = visible; };
    // Map visibility is independent of the gameplay camera and never streams physics.
    for (const chunk of renderChunks) {
      localBounds.copy(chunk.mesh.boundingBox!).translate(chunk.mesh.position);
      const visible = distanceSquared(localBounds, focus) < radius * radius;
      show(chunk.mesh, visible);
      if (chunk.farMesh) show(chunk.farMesh, false);
    }
    for (const prop of distantProps) {
      show(prop.root, Math.hypot(prop.center.x - focus.x, prop.center.z - focus.z) < radius + 12);
      if (prop.farMesh) show(prop.farMesh, false);
    }
    return () => { for (const [object, visible] of visibility) object.visible = visible; };
  }
  let windTime = 0;
  return { scene, ship, pod, boy, door, facilityRoof, rooftopEquipment, turrets, ready, pathLength, nearestPathPoint, isWalkable, trackStaticBody, updateActivePhysics, activatePhysicsNear, updateVisibility, prepareMinimap, isReady: () => settled,
    releasePropCulling(root: THREE.Object3D) {
      const index = distantProps.findIndex(prop => prop.root === root);
      if (index >= 0) distantProps.splice(index, 1);
    },
    distanceToSafePath: (x: number, z: number) => routeDistance(x, z), isJungleObstacleBody: (body: CANNON.Body) => obstacleVisuals.has(body), breakJungleObstacle,
    disintegrateTrees,
    setWalking(value: boolean) { if (value === walking) return; walking = value; (value ? idle : walk)?.fadeOut(0.2); (value ? walk ?? idle : idle)?.reset().fadeIn(0.2).play(); },
    bridge, water, waterfall, mountain, damageBridge, breakBridge,
    setImpact(age: number) {
      crater.visible = age >= 0;
      for (const d of dust) {
        const t = Math.max(0, age - d.delay), radius = 0.8 + t * (2 + d.delay * 4);
        d.mesh.visible = age >= d.delay && t < 5;
        d.mesh.position.set(RESCUE_SITE.pod.x + Math.sin(d.angle) * radius, 0.4 + t * 0.9, RESCUE_SITE.pod.z + Math.cos(d.angle) * radius);
        d.mesh.scale.setScalar(0.5 + t * 1.1); d.mesh.material.opacity = Math.max(0, 0.42 * (1 - t / 5));
      }
    },
    update(dt: number) {
      applyObstacleImpacts(); updateFallingTrees(dt); rockDebris.update(dt);
      windTime += dt;
      waterfallUniforms.uTime.value = windTime;
      riverWater.update(dt);
      if (ship.root.visible) ship.update(dt);
      if (boy.visible) mixer?.update(dt);
      if (!culling) crowns.rotation.z = Math.sin(windTime * 0.45) * 0.001;
    },
    dispose() {
      if (disposed) return; disposed = true; mixer?.stopAllAction();
      waterfall.setLocked(false);
      rockDebris.dispose(); obstacleVisuals.clear(); instanceLocations.clear(); pendingImpacts.length = 0; fallingTrees.length = 0;
      boy.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      scene.traverse(node => { if (node instanceof THREE.InstancedMesh) node.dispose(); });
      for (const chunk of physicsChunks.values()) for (const body of chunk.bodies) if (body.world === physics.world) physics.world.removeBody(body);
      physicsChunks.clear(); renderChunks.length = 0; distantProps.length = 0;
      disposeRoom(scene); farRockGeometry.dispose();
    },
  };
}
