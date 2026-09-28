import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import boyUrl from '../../assets/models/boy.glb';
import type { createScenePhysics } from '../physics/scenePhysics.js';
import { createSlidingPortal, roomBox, disposeRoom } from './shipRoom.js';
import { cargoSign } from './cargoVisuals.js';
import { createEscapePod, createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import type { PlayerTransitionState } from '../../scripts/player.js';
import { createJunglePlatformCourse, createFacilityScramblerLauncher, type PlatformProgress } from './junglePlatformCourse.js';
import { createBreakableDebris } from '../../scripts/breakables.js';
import { createJungleWater } from './jungleWater.js';

export interface RescueArrival {
  pilotState?: PlayerTransitionState; hullHealth?: number;
  platformProgress?: PlatformProgress;
  scramblerPosition?: THREE.Vector3; scramblerQuaternion?: THREE.Quaternion;
  scramblerDestroyed?: boolean;
  cameraPosition?: THREE.Vector3; cameraQuaternion?: THREE.Quaternion; cameraFov?: number;
}
export const RESCUE_SITE = {
  landingOffset: new THREE.Vector3(-66, 0, 72), clearing: new THREE.Vector3(-66, 0, 84),
  pod: new THREE.Vector3(-60, 1.05, 82), podRotation: new THREE.Euler(0, -2.06, 0.18), ship: new THREE.Vector3(-74, 0, 87),
  boy: new THREE.Vector3(-61.8, 0, 85.4), player: new THREE.Vector3(-63, 0.3, 85), doorZ: -55,
  bridge: new THREE.Vector3(-42, 0, 17), riverY: -1.8, riverZ: 17, riverHalfWidth: 7,
  downstream: new THREE.Vector3(-146, 0.3, 5)
};
export const JUNGLE_PATH = new THREE.CatmullRomCurve3([
  [-63, 85], [-59, 67], [-57, 49], [-46, 34], [-42, 26], [-42, 8],
  [-29, -10], [-24, -30], [-7, -41], [0, -51], [0, -59],
].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
export const JUNGLE_ROUTE = JUNGLE_PATH.getSpacedPoints(240);
export const RETURN_PATH = new THREE.CatmullRomCurve3([
  [-146, 5], [-128, 1], [-105, -4], [-83, -7], [-65, -9], [-46, -8], [-29, -10]
].map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const RETURN_ROUTE = RETURN_PATH.getSpacedPoints(70);
/** The same handhold is visible during the river exit and on the downstream bank. */
export function createRiverExitLog(parent: THREE.Object3D) {
  const root = new THREE.Group(); root.name = 'DownstreamExitLog'; root.position.set(RESCUE_SITE.downstream.x, -0.85, 11);
  const bark = new THREE.MeshStandardMaterial({ color: 0x67543b, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 5.4, 9), bark);
  trunk.rotation.z = Math.PI / 2; trunk.castShadow = true; root.add(trunk);
  for (const x of [-1.4, 1.1]) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.25, 2.4, 6), bark);
    branch.position.set(x, 0.35, -0.8); branch.rotation.x = -0.95; root.add(branch);
  }
  parent.add(root); return root;
}
const entryDirection = JUNGLE_PATH.getTangentAt(0);
export const JUNGLE_ENTRY_YAW = Math.atan2(-entryDirection.x, -entryDirection.z);

/** Scene-owned resources with identical placement in the landing film and playable exterior. */
export function createRescueSite(physics: ReturnType<typeof createScenePhysics>, { culling = false, platformer = false, activatedRelays = [], ascendingPillars = false, downstreamPlank = false, bridgeBrokenAtStart = false }: {
  culling?: boolean; platformer?: boolean; activatedRelays?: readonly string[]; ascendingPillars?: boolean; downstreamPlank?: boolean; bridgeBrokenAtStart?: boolean;
} = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(culling ? 0x698475 : 0x9cae98); scene.fog = new THREE.Fog(0x698475, culling ? 45 : 55, culling ? 132 : 230);
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
  const pendingImpacts: Array<{ body: CANNON.Body; from: Point }> = [];
  const fallingTrees: Array<{ age: number; direction: THREE.Vector3; parts: Array<{ mesh: THREE.InstancedMesh; index: number; rest: THREE.Matrix4; pivot: THREE.Vector3 }> }> = [];
  const rockDebris = createBreakableDebris(scene, 0x58654a);
  function breakJungleObstacle(body: CANNON.Body, from: Point) {
    if (obstacleVisuals.has(body) && !pendingImpacts.some(impact => impact.body === body)) pendingImpacts.push({ body, from: { x: from.x, y: from.y, z: from.z } });
  }
  function applyObstacleImpacts() {
    for (const { body, from } of pendingImpacts.splice(0)) {
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
        fallingTrees.push({ age: 0, direction, parts: parts.map(part => {
          const { mesh, index } = instanceLocations.get(part.source)![part.index], rest = new THREE.Matrix4();
          mesh.getMatrixAt(index, rest);
          mesh.frustumCulled = false;
          return { mesh, index, rest, pivot: new THREE.Vector3(entry.x - mesh.position.x, 0, entry.z - mesh.position.z) };
        }) });
      }
    }
  }
  const fallMatrix = new THREE.Matrix4(), fallRotation = new THREE.Matrix4(), fallOffset = new THREE.Matrix4(), fallAxis = new THREE.Vector3();
  function updateFallingTrees(dt: number) {
    for (let i = fallingTrees.length - 1; i >= 0; i--) {
      const tree = fallingTrees[i]; tree.age = Math.min(1.4, tree.age + dt);
      const tilt = THREE.MathUtils.smoothstep(tree.age, 0, 1.4) * Math.PI * 0.48;
      fallAxis.set(tree.direction.z, 0, -tree.direction.x);
      fallRotation.makeRotationAxis(fallAxis, tilt);
      for (const { mesh, index, rest, pivot } of tree.parts) {
        mesh.frustumCulled = false;
        fallMatrix.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(fallRotation)
          .multiply(fallOffset.makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(rest);
        mesh.setMatrixAt(index, fallMatrix); mesh.instanceMatrix.needsUpdate = true;
      }
      if (tree.age >= 1.4) {
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
  const routeDistance = (x: number, z: number) => Math.min(nearestPathPoint(x, z).distance, ...RETURN_ROUTE.map(p => Math.hypot(p.x - x, p.z - z)));
  let bridgeBroken = false;
  const river = (z: number, margin = 0) => Math.abs(z - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth + margin;
  const isWalkable = (x: number, z: number, radius = 0.6) => Math.abs(x) < 190 && Math.abs(z) < 118
    && (!river(z) || (!bridgeBroken && Math.abs(x - RESCUE_SITE.bridge.x) < 2.3))
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
  const groundGeometry = new THREE.PlaneGeometry(384, 240, 128, terrainRows.length - 1); groundGeometry.rotateX(-Math.PI / 2);
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
  physics.addBox({ x: 384, y: 4.5, z: 96 }, { x: 0, y: -2.25, z: 72 });
  physics.addBox({ x: 384, y: 4.5, z: 130 }, { x: 0, y: -2.25, z: -55 });
  physics.addBox({ x: 384, y: 1, z: 14 }, { x: 0, y: -5, z: RESCUE_SITE.riverZ });
  for (const side of [-1, 1]) {
    physics.addBox({ x: 2, y: 60, z: 240 }, { x: side * 191, y: 29, z: 0 });
    physics.addBox({ x: 384, y: 60, z: 2 }, { x: 0, y: 29, z: side * 119 });
  }
  const riverWater = createJungleWater(scene, { y: RESCUE_SITE.riverY, z: RESCUE_SITE.riverZ,
    halfWidth: RESCUE_SITE.riverHalfWidth, length: 384 });
  const water = riverWater.mesh;
  const exitLog = createRiverExitLog(scene); exitLog.visible = !platformer;
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
      if (platformer && x < 0 && z === 0) continue;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), timber); post.position.set(x, 0.7, z); bridge.add(post); supports.push({ mesh: post, rest: post.position.clone() });
    }
    for (const z of platformer && x < 0 ? [-5.5, 5.5] : [0]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.15, platformer && x < 0 ? 7 : 18), timber);
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
  const platformCourse = platformer ? createJunglePlatformCourse(scene, physics, activatedRelays, { ascendingPillars, downstreamPlank }) : null;
  riverWater.setObstacles(platformCourse?.root ?? null);
  const farRockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0), rockMaterial = new THREE.MeshStandardMaterial({ color: 0x58654a, roughness: 1 });
  for (let i = 0; i < 100; i++) {
    const x = (random() - 0.5) * 374, z = (random() - 0.5) * 230;
    if (river(z, 3) || clearing(x, z, 2) || facility(x, z, 3) || routeDistance(x, z) < 6) continue;
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
    if (river(z, 2) || clearing(x, z) || facility(x, z) || routeDistance(x, z) < 2.5) continue;
    const scale = 0.7 + random() * 1.1;
    for (let j = 0; j < 7; j++) {
      const angle = j / 7 * Math.PI * 2 + i;
      dummy.position.set(x, 0.04, z); dummy.scale.set(scale, scale * 1.7, scale);
      dummy.quaternion.setFromUnitVectors(yAxis, new THREE.Vector3(Math.sin(angle), 0.45, Math.cos(angle)).normalize()); dummy.updateMatrix();
      fronds.setMatrixAt(frondCount, dummy.matrix); fronds.setColorAt(frondCount++, tint.setHSL(0.22 + random() * 0.1, 0.5, 0.35 + random() * 0.2));
    }
  }
  fronds.count = frondCount; fronds.receiveShadow = true; addJungleBatch(fronds, 42);
  const pathLength = JUNGLE_PATH.getLength(), steps = Math.ceil(pathLength / 1.15);
  const stones = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), new THREE.MeshStandardMaterial({ color: 0x929185, roughness: 1 }), (steps + 1) * 3);
  stones.name = 'WindingStoneTrail'; let stoneCount = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = JUNGLE_PATH.getPointAt(t), tangent = JUNGLE_PATH.getTangentAt(t), normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
    if (river(p.z, 2)) continue;
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
  for (const t of [0.08, 0.34, 0.65, 0.9]) {
    const p = RETURN_PATH.getPointAt(t);
    box([0.18, 0.9, 0.18], [p.x, 0.45, p.z - 2.2], dark);
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0xbbd4a0, emissive: 0x425c2f, emissiveIntensity: 0.5 }));
    marker.rotation.z = -Math.PI / 2; marker.position.set(p.x, 0.95, p.z - 2.2); scene.add(marker);
  }
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
  box([71, 0.8, 33], [0, 24, -71], dark); box([70, 0.2, 32], [0, -0.1, -71], dark);
  const door = createSlidingPortal(scene, physics, { x: 0, y: 0, z: RESCUE_SITE.doorZ, yaw: 0 }, 70, 24, 'AI RESEARCH / ACCESS 17');
  for (const x of [-30, -20, -10, 10, 20, 30]) {
    box([1.1, 24.6, 1.4], [x, 12.1, -54.5], dark);
    for (const y of [8, 15, 21]) {
      box([7.4, 3.2, 0.25], [x + (x < 0 ? 4.5 : -4.5), y, -54.62], trim, false);
      for (let k = 0; k < 5; k++) box([6.8, 0.16, 0.4], [x + (x < 0 ? 4.5 : -4.5), y - 1.2 + k * 0.55, -54.35], dark, false);
    }
  }
  box([10, 0.5, 4], [0, 4.5, -53.5], dark); box([9.5, 0.09, 0.12], [0, 4.17, -51.55], red, false);
  cargoSign(scene, 'C E N T R A L   I N T E L L I G E N C E', [0, 18, -54.2], 22);
  for (const x of [-12, 15]) {
    box([9, 4, 9], [x, 26, -72], dark); box([9.4, 0.3, 9.4], [x, 28, -72], trim, false);
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 12, 10), trim); aerial.position.set(x, 30, -72); scene.add(aerial);
  }
  const scramblerLauncher = platformer ? createFacilityScramblerLauncher(scene) : null;
  const turrets = [-11, 11].map(x => {
    box([2, 1, 2], [x, 6, -53.6], dark);
    const root = new THREE.Group(); root.position.set(x, 6.8, -53.25); scene.add(root);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 12), dark); root.add(dome);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.8, 12), trim); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.85; root.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), red); muzzle.position.z = 1.8; root.add(muzzle);
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
  const ready = new GLTFLoader().loadAsync(boyUrl).then(gltf => {
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
  let windTime = 0;
  return { scene, ship, pod, boy, door, turrets, ready, pathLength, nearestPathPoint, isWalkable, trackStaticBody, updateActivePhysics, activatePhysicsNear, updateVisibility, isReady: () => settled,
    distanceToSafePath: (x: number, z: number) => routeDistance(x, z), isJungleObstacleBody: (body: CANNON.Body) => obstacleVisuals.has(body), breakJungleObstacle,
    setWalking(value: boolean) { if (value === walking) return; walking = value; (value ? idle : walk)?.fadeOut(0.2); (value ? walk ?? idle : idle)?.reset().fadeIn(0.2).play(); },
    bridge, water, exitLog, damageBridge, breakBridge, platformCourse, scramblerLauncher,
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
      platformCourse?.update(dt);
      riverWater.update(dt);
      if (ship.root.visible) ship.update(dt);
      if (boy.visible) mixer?.update(dt);
      if (!culling) crowns.rotation.z = Math.sin(windTime * 0.45) * 0.001;
    },
    dispose() {
      if (disposed) return; disposed = true; mixer?.stopAllAction();
      rockDebris.dispose(); obstacleVisuals.clear(); instanceLocations.clear(); pendingImpacts.length = 0; fallingTrees.length = 0;
      boy.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      scene.traverse(node => { if (node instanceof THREE.InstancedMesh) node.dispose(); });
      for (const chunk of physicsChunks.values()) for (const body of chunk.bodies) if (body.world === physics.world) physics.world.removeBody(body);
      physicsChunks.clear(); renderChunks.length = 0; distantProps.length = 0;
      disposeRoom(scene); farRockGeometry.dispose();
    },
  };
}
