import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import PF from 'pathfinding';
import { loadToolModel } from '../../core/loader.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import type { DamageTarget } from '../../scripts/pistol.js';
import beamVertex from '../../shaders/stealthBeam.vert.glsl?raw';
import beamFragment from '../../shaders/stealthBeam.frag.glsl?raw';
import { HANGAR_LAYOUT, type StealthHangar, type HangarPoint } from './stealthHangar.js';

type Physics = ReturnType<typeof createScenePhysics>;
type Point = { x: number; y: number; z: number };
type RobotKind = 'trilobite' | 'quad' | 'eye';
export type PatrolMode = 'patrol' | 'investigate' | 'charge' | 'down' | 'reserve';
export interface StealthObservation {
  position: Point;
  crouching: boolean;
  sprinting: boolean;
  moving: boolean;
  protected: boolean;
  enabled: boolean;
}
export interface StealthActor {
  id: string;
  kind: RobotKind;
  root: THREE.Group;
  body: CANNON.Body;
  mode: PatrolMode;
  suspicion: number;
  range: number;
  route: HangarPoint[];
  routeIndex: number;
  path: THREE.Vector3[];
  target: THREE.Vector3 | null;
  dwell: number;
  searchTime: number;
  repath: number;
  attackTime: number;
  lastNoise: THREE.Vector3 | null;
  heardAt: number;
  health: number;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  animation: string;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  footprint: THREE.Mesh;
  light: THREE.SpotLight | null;
  downTime: number;
  formation: THREE.Vector3 | null;
  scanning: boolean;
  scanRoof: string | null;
  scanTarget: THREE.Vector3 | null;
}

export function createHangarNavigation(hangar: StealthHangar) {
  const minX = hangar.bounds.minX + 1, minZ = hangar.bounds.minZ + 1;
  const width = hangar.bounds.maxX - minX, height = hangar.bounds.maxZ - minZ;
  const grid = new PF.Grid(width, height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const x = minX + column, z = minZ + row;
    const blocked = hangar.obstacles.some(obstacle => x >= obstacle.min.x - 0.55 && x <= obstacle.max.x + 0.55
      && z >= obstacle.min.z - 0.55 && z <= obstacle.max.z + 0.55);
    if (blocked) grid.setWalkableAt(column, row, false);
  }
  const finder = new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles });
  function cell(point: HangarPoint, matrix = grid) {
    const column = THREE.MathUtils.clamp(Math.round(point.x - minX), 0, width - 1);
    const row = THREE.MathUtils.clamp(Math.round(point.z - minZ), 0, height - 1);
    if (matrix.isWalkableAt(column, row)) return [column, row];
    for (let radius = 1; radius < 8; radius++) {
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        if (matrix.isWalkableAt(column + dx, row + dz)) return [column + dx, row + dz];
      }
    }
    return null;
  }
  function findPath(from: HangarPoint, to: HangarPoint, exclusion?: { center: HangarPoint; radius: number }) {
    const matrix = grid.clone();
    if (exclusion) {
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        if (Math.hypot(minX + column - exclusion.center.x, minZ + row - exclusion.center.z) < exclusion.radius) {
          matrix.setWalkableAt(column, row, false);
        }
      }
    }
    const start = cell(from, matrix), end = cell(to, matrix);
    if (!start || !end) return [];
    return PF.Util.compressPath(finder.findPath(start[0], start[1], end[0], end[1], matrix))
      .map(([column, row]) => new THREE.Vector3(minX + column, hangar.deckY, minZ + row));
  }
  return { grid, findPath };
}

export function createStealthDirector(scene: THREE.Scene, physics: Physics, hangar: StealthHangar,
  callbacks: { onAlarm: (actor: StealthActor) => void; onAttack: (actor: StealthActor, damage: number) => void },
  modelLoader: typeof loadToolModel = loadToolModel) {
  const navigation = createHangarNavigation(hangar);
  const actors: StealthActor[] = [];
  const beamGeometry = new THREE.CylinderGeometry(0.025, 1, 1, 24, 1, true);
  const footprintGeometry = new THREE.CircleGeometry(1, 24);
  const facing = new THREE.Vector3(), eye = new THREE.Vector3(), target = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(), desiredRotation = new THREE.Quaternion();
  let elapsed = 0, disposed = false, alarmed = false, stepNoiseTime = 0, distractions = 0;
  let encirclement: THREE.Vector3 | null = null, firing = false;
  const volleyGeometry = new THREE.CylinderGeometry(0.022, 0.022, 1, 6);
  const volleyMaterial = new THREE.MeshBasicMaterial({ color: 0xff5266, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending });
  const volleys: Array<{ mesh: THREE.Mesh; life: number }> = [];
  const loading: Promise<unknown>[] = [];
  const eyeHeight = (actor: StealthActor) => actor.kind === 'eye' ? 0 : actor.kind === 'quad' ? 0.72 : 1.24;
  const actorFacing = (actor: StealthActor) => facing.set(0, 0, 1).applyQuaternion(actor.root.quaternion);
  const distance = (first: HangarPoint, second: HangarPoint) => Math.hypot(first.x - second.x, first.z - second.z);

  function animation(actor: StealthActor, requested: 'walk' | 'run' | 'attack' | 'down' | 'idle') {
    if (actor.animation === requested) return;
    actor.animation = requested;
    const expression = requested === 'down' ? /death|die|shutdown/i : requested === 'attack' ? /attack/i
      : requested === 'run' ? /run|walk/i : requested === 'walk' ? /walk/i : /idle/i;
    const next = [...actor.actions].find(([name]) => expression.test(name))?.[1];
    if (!next) return;
    for (const action of actor.actions.values()) action.stop();
    next.reset().setEffectiveTimeScale(requested === 'run' ? 1.6 : 1);
    next.setLoop(requested === 'down' || requested === 'attack' ? THREE.LoopOnce : THREE.LoopRepeat,
      requested === 'down' || requested === 'attack' ? 1 : Infinity);
    next.clampWhenFinished = requested === 'down'; next.play();
  }

  function addActor(kind: RobotKind, route: HangarPoint[], reserve = false) {
    const index = actors.length;
    const root = new THREE.Group(); root.name = `Hangar-${kind}-${index}`; scene.add(root);
    const start = route[index % route.length];
    root.position.set(start.x, hangar.deckY + (kind === 'eye' ? 3.8 : 0), start.z);
    root.rotation.y = index % 2 ? Math.PI : Math.PI / 2;
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Sphere(kind === 'eye' ? 0.5 : 0.45), collisionFilterGroup: 2, collisionFilterMask: 1 });
    body.position.set(root.position.x, root.position.y + (kind === 'eye' ? 0 : 0.45), root.position.z);
    physics.world.addBody(body);
    const fallback = new THREE.Group(); root.add(fallback);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(kind === 'eye' ? 0.6 : 0.9, kind === 'trilobite' ? 1.2 : 0.6, 0.8), hangar.materials.dark);
    shell.position.y = kind === 'eye' ? 0 : 0.8; fallback.add(shell);
    if (kind !== 'eye') for (const x of [-0.45, 0.45]) for (const z of [-0.33, 0.33]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.16), hangar.materials.steel);
      leg.position.set(x, 0.3, z); fallback.add(leg);
    }
    const lensMaterial = new THREE.MeshBasicMaterial({ color: kind === 'eye' ? 0xd2edfa : 0xe8d986 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), lensMaterial);
    lens.position.set(0, kind === 'eye' ? 0 : kind === 'quad' ? 0.72 : 1.24, 0.45); root.add(lens);
    const beamMaterial = new THREE.ShaderMaterial({ vertexShader: beamVertex, fragmentShader: beamFragment,
      uniforms: { uColor: { value: new THREE.Color(kind === 'eye' ? 0xc5e7fa : 0xe7d68e) }, uTime: { value: 0 }, uAlert: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial); beam.userData.minimap = false; scene.add(beam);
    const footprint = new THREE.Mesh(footprintGeometry, new THREE.MeshBasicMaterial({ color: kind === 'eye' ? 0xc5e7fa : 0xe7d68e,
      transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    footprint.rotation.x = -Math.PI / 2; footprint.userData.minimap = false; scene.add(footprint);
    let light: THREE.SpotLight | null = null;
    if (kind === 'eye') {
      light = new THREE.SpotLight(0xc5e7fa, 16, 17, Math.PI / 7, 0.7, 1.4);
      light.castShadow = index === 10; light.shadow.mapSize.set(256, 256);
      scene.add(light, light.target);
    }
    const actor: StealthActor = { id: root.name, kind, root, body, mode: reserve ? 'reserve' : 'patrol', suspicion: 0,
      range: kind === 'eye' ? 13 : 9, route, routeIndex: index % route.length, path: [], target: null,
      dwell: index % 3 * 0.5, searchTime: 0, repath: 0, attackTime: 0, lastNoise: null, heardAt: -Infinity,
      health: 50, mixer: null, actions: new Map(), animation: '', beam, footprint, light, downTime: 0, formation: null,
      scanning: false, scanRoof: null, scanTarget: null };
    root.visible = beam.visible = footprint.visible = !reserve;
    body.collisionResponse = !reserve;
    if (light) light.visible = !reserve;
    actors.push(actor);
    loading.push(modelLoader(kind === 'eye' ? 'Enemy_EyeDrone' : kind === 'quad' ? 'Enemy_QuadShell' : 'Enemy_Trilobite').then(gltf => {
      if (disposed) { disposeRoom(gltf.scene); return; }
      const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3());
      const scale = (kind === 'eye' ? 1.1 : kind === 'quad' ? 1.65 : 1.85) / Math.max(size.x, size.y, size.z, 0.01);
      gltf.scene.scale.multiplyScalar(scale);
      const center = bounds.getCenter(new THREE.Vector3());
      gltf.scene.position.set(-center.x * scale, -(kind === 'eye' ? center.y : bounds.min.y) * scale, -center.z * scale);
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) { object.castShadow = object.receiveShadow = true; }
      });
      root.add(gltf.scene); fallback.visible = false;
      actor.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) actor.actions.set(clip.name, actor.mixer.clipAction(clip));
      animation(actor, 'walk');
    }).catch(error => console.warn(`Hangar ${kind} model unavailable:`, error)));
    return actor;
  }

  for (const [column, x] of [27, 43, 59, 75].entries()) {
    addActor(column % 2 ? 'quad' : 'trilobite', [{ x: x - 6.5, z: -21 }, { x: x + 6.5, z: -21 }, { x: x + 6.5, z: -8 }, { x: x - 6.5, z: -8 }]);
    addActor(column % 2 ? 'trilobite' : 'quad', [{ x: x + 6.5, z: 8 }, { x: x + 6.5, z: 21 }, { x: x - 6.5, z: 21 }, { x: x - 6.5, z: 8 }]);
  }
  addActor('trilobite', [{ x: 35, z: -6 }, { x: 51, z: -6 }, { x: 51, z: 6 }, { x: 35, z: 6 }]);
  addActor('quad', [{ x: 67, z: -6 }, { x: 83, z: -6 }, { x: 83, z: 6 }, { x: 67, z: 6 }]);
  for (const x of [29, 45, 61, 77]) addActor('eye', [{ x: x - 7, z: -7 }, { x: x + 7, z: -7 }, { x: x + 7, z: 7 }, { x: x - 7, z: 7 }]);
  for (const [index, point] of [{ x: 18, z: -19 }, { x: 18, z: 19 }, { x: 38, z: -28 }, { x: 38, z: 28 },
    { x: 60, z: -28 }, { x: 60, z: 28 }, { x: 83, z: -19 }, { x: 83, z: 12 }].entries()) {
    addActor(index % 2 ? 'quad' : 'trilobite', [point], true);
  }

  function safeZoneFor(position: Point) {
    return hangar.safeZones.find(zone => zone.bounds.containsPoint(target.set(position.x, position.y, position.z)))?.id ?? null;
  }
  function isProtected(position: Point) {
    return hangar.safeZones.some(zone => zone.kind === 'refuge' && zone.bounds.containsPoint(target.set(position.x, position.y, position.z)));
  }
  function hasSight(from: Point, to: Point, ignored?: CANNON.Body) {
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    let blocked = false;
    physics.world.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z),
      { skipBackfaces: false, checkCollisionResponse: true }, hit => {
        if (hit.body?.type === CANNON.Body.STATIC && hit.body !== ignored && hit.distance < length - 0.08) blocked = true;
      });
    return !blocked;
  }
  function canSee(actor: StealthActor, observation: StealthObservation) {
    if (!observation.enabled || observation.protected || actor.mode === 'down' || actor.mode === 'reserve') return false;
    const elevated = observation.position.y > hangar.deckY + 2.8;
    if (observation.position.y < hangar.deckY - 1 || (elevated && (actor.kind !== 'eye' || !actor.scanning))) return false;
    if (!elevated && actor.scanning) return false;
    const length = distance(actor.root.position, observation.position);
    const range = actor.range * (observation.crouching ? 0.78 : 1);
    if (length > range || length < 0.01) return false;
    const forward = actorFacing(actor);
    const alignment = ((observation.position.x - actor.root.position.x) * forward.x
      + (observation.position.z - actor.root.position.z) * forward.z) / length;
    if (alignment < Math.cos(actor.kind === 'eye' ? 0.72 : 0.62)) return false;
    eye.copy(actor.root.position); eye.y += eyeHeight(actor);
    target.set(observation.position.x, observation.position.y + (observation.crouching ? 0.5 : 1.05), observation.position.z);
    return hasSight(eye, target, actor.body);
  }
  function forceAlarm(id: string) {
    if (alarmed || disposed) return;
    const culprit = actors.find(actor => actor.id === id) ?? actors[0];
    alarmed = true;
    for (const actor of actors) if (actor.mode !== 'down') {
      actor.mode = 'charge'; actor.suspicion = 1; actor.path = []; actor.target = null; actor.repath = 0;
      actor.root.visible = actor.beam.visible = actor.footprint.visible = true; actor.body.collisionResponse = true;
      if (actor.light) actor.light.visible = true;
      animation(actor, 'run');
    }
    callbacks.onAlarm(culprit);
  }
  function formFiringSquad(position: Point) {
    if (!alarmed || disposed || encirclement) return;
    encirclement = new THREE.Vector3(position.x, position.y, position.z);
    const active = actors.filter(actor => actor.mode === 'charge'), occupied: THREE.Vector3[] = [];
    for (const [index, actor] of active.entries()) {
      let best: THREE.Vector3[] = [];
      for (let attempt = 0; attempt < 48; attempt++) {
        const angle = index / active.length * Math.PI * 2 + attempt * 0.37;
        const radius = (actor.kind === 'eye' ? 8.5 : 5.5) + attempt % 3 * 1.4;
        const candidate = { x: position.x + Math.sin(angle) * radius, z: position.z + Math.cos(angle) * radius };
        const path = navigation.findPath(actor.root.position, candidate, { center: position, radius: 3 }), endpoint = path[path.length - 1];
        if (!endpoint || distance(endpoint, position) < 3.5 || occupied.some(point => distance(point, endpoint) < 2.1)) continue;
        best = path;
        const from = { x: endpoint.x, y: hangar.deckY + (actor.kind === 'eye' ? 3.8 : eyeHeight(actor)), z: endpoint.z };
        if (hasSight(from, { x: position.x, y: position.y + 0.8, z: position.z })) break;
      }
      actor.path = best; actor.formation = best[best.length - 1]?.clone() ?? actor.root.position.clone();
      actor.repath = 0; occupied.push(actor.formation);
    }
  }
  function fireVolley() {
    if (!alarmed || disposed || !encirclement) return 0;
    firing = true;
    let fired = 0;
    const aiming = new THREE.Vector3(encirclement.x, encirclement.y + 0.78, encirclement.z);
    for (const actor of actors) {
      if (actor.mode !== 'charge' || !actor.formation || distance(actor.root.position, actor.formation) > 2.2) continue;
      eye.copy(actor.root.position); eye.y += eyeHeight(actor);
      if (!hasSight(eye, aiming, actor.body)) continue;
      const bolt = new THREE.Mesh(volleyGeometry, volleyMaterial); bolt.name = 'FiringSquadVolley'; bolt.userData.minimap = false;
      direction.copy(aiming).sub(eye); const length = direction.length();
      bolt.position.copy(eye).add(aiming).multiplyScalar(0.5);
      bolt.quaternion.setFromUnitVectors(up, direction.normalize()); bolt.scale.y = length;
      scene.add(bolt); volleys.push({ mesh: bolt, life: 0.19 });
      animation(actor, 'attack'); callbacks.onAttack(actor, 10); fired++;
    }
    return fired;
  }
  function emitNoise(position: Point, radius = 18) {
    if (disposed || alarmed) return 0;
    let listeners = 0;
    for (const actor of actors) {
      if (actor.mode === 'down' || actor.mode === 'reserve' || distance(actor.root.position, position) > radius) continue;
      if (actor.lastNoise && distance(actor.lastNoise, position) < 2 && elapsed - actor.heardAt < 7) continue;
      actor.mode = 'investigate'; actor.target = new THREE.Vector3(position.x, hangar.deckY, position.z);
      actor.lastNoise = actor.target.clone(); actor.heardAt = elapsed;
      actor.path = navigation.findPath(actor.root.position, actor.target); actor.searchTime = 7; actor.dwell = 0;
      listeners++; animation(actor, 'walk');
    }
    if (listeners) distractions++;
    return listeners;
  }
  function getTakedownCandidate(observation: StealthObservation) {
    if (alarmed || !observation.enabled || observation.position.y > hangar.deckY + 1.2) return null;
    return actors.find(actor => {
      if (actor.kind === 'eye' || (actor.mode !== 'patrol' && actor.mode !== 'investigate') || actor.suspicion > 0.18) return false;
      const length = distance(actor.root.position, observation.position);
      if (length > 1.65 || length < 0.2) return false;
      const forward = actorFacing(actor);
      const rear = ((observation.position.x - actor.root.position.x) * forward.x
        + (observation.position.z - actor.root.position.z) * forward.z) / length;
      return rear < -0.45 && hasSight({ x: observation.position.x, y: observation.position.y + 0.65, z: observation.position.z },
        { x: actor.root.position.x, y: hangar.deckY + 0.85, z: actor.root.position.z }, actor.body);
    }) ?? null;
  }
  function completeTakedown(id: string) {
    const actor = actors.find(candidate => candidate.id === id);
    if (!actor || alarmed || actor.mode === 'down' || actor.kind === 'eye') return false;
    actor.mode = 'down'; actor.health = 0; actor.suspicion = 0; actor.downTime = 0;
    actor.body.collisionResponse = false; actor.beam.visible = actor.footprint.visible = false;
    animation(actor, 'down'); return true;
  }
  const damageTargets: DamageTarget[] = actors.map(actor => ({ root: actor.root, body: actor.body,
    damage(amount, weapon) {
      if (actor.mode === 'down' || actor.mode === 'reserve' || !Number.isFinite(amount) || amount <= 0) return false;
      actor.health -= amount;
      if (actor.health <= 0) { actor.mode = 'down'; actor.downTime = 0; actor.body.collisionResponse = false; animation(actor, 'down'); }
      if (weapon) forceAlarm(actor.id);
      return true;
    } }));

  function move(actor: StealthActor, dt: number, speed: number) {
    while (actor.path.length && distance(actor.root.position, actor.path[0]) < 0.18) actor.path.shift();
    const next = actor.path[0];
    if (!next) return false;
    direction.set(next.x - actor.root.position.x, 0, next.z - actor.root.position.z);
    const length = direction.length(); direction.normalize();
    const travel = Math.min(length, speed * dt);
    const proposed = actor.root.position.clone().addScaledVector(direction, travel);
    if (actor.mode === 'charge') {
      const blocked = actors.some(other => other !== actor && other.mode === 'charge'
        && Math.abs(other.root.position.y - actor.root.position.y) < 1.5
        && distance(proposed, other.root.position) < 1.6
        && distance(proposed, other.root.position) < distance(actor.root.position, other.root.position));
      if (blocked) return false;
    }
    actor.root.position.copy(proposed);
    desiredRotation.setFromAxisAngle(up, Math.atan2(direction.x, direction.z));
    actor.root.quaternion.slerp(desiredRotation, 1 - Math.exp(-dt * 7));
    return true;
  }
  function updateBeam(actor: StealthActor) {
    const active = actor.mode !== 'down' && actor.mode !== 'reserve';
    actor.beam.visible = actor.footprint.visible = active;
    if (actor.light) actor.light.visible = active;
    if (!active) return;
    const forward = actorFacing(actor).clone();
    eye.copy(actor.root.position).addScaledVector(forward, 0.48); eye.y += eyeHeight(actor);
    target.copy(actor.root.position).addScaledVector(forward, actor.range * 0.77); target.y = hangar.deckY + 0.025;
    if (actor.scanning && actor.scanTarget) target.copy(actor.scanTarget);
    const from = new CANNON.Vec3(eye.x, eye.y, eye.z), to = new CANNON.Vec3(target.x, target.y, target.z);
    let nearest = eye.distanceTo(target), horizontalSurface = true;
    physics.world.raycastAll(from, to, { skipBackfaces: false, checkCollisionResponse: true }, hit => {
      if (hit.body?.type !== CANNON.Body.STATIC || hit.distance >= nearest) return;
      nearest = hit.distance; target.set(hit.hitPointWorld.x, hit.hitPointWorld.y, hit.hitPointWorld.z);
      horizontalSurface = hit.hitNormalWorld.y > 0.65;
    });
    direction.copy(eye).sub(target);
    const length = Math.max(0.01, direction.length()), radius = Math.max(0.12, length * 0.3);
    actor.beam.position.copy(eye).add(target).multiplyScalar(0.5);
    actor.beam.quaternion.setFromUnitVectors(up, direction.normalize()); actor.beam.scale.set(radius, length, radius);
    actor.beam.material.uniforms.uTime.value = elapsed;
    actor.beam.material.uniforms.uAlert.value = alarmed ? 1 : actor.suspicion;
    actor.footprint.visible = horizontalSurface;
    actor.footprint.position.copy(target); actor.footprint.position.y += 0.02; actor.footprint.scale.setScalar(radius * 0.85);
    const footprintMaterial = actor.footprint.material as THREE.MeshBasicMaterial;
    footprintMaterial.color.setHex(alarmed ? 0xff3547 : actor.kind === 'eye' ? 0xc5e7fa : 0xe7d68e);
    if (actor.light) {
      actor.light.position.copy(eye); actor.light.target.position.copy(target);
      actor.light.color.setHex(alarmed ? 0xff3547 : 0xc5e7fa);
    }
  }
  function updateRooftopScan(actor: StealthActor, dt: number) {
    if (actor.kind !== 'eye') return;
    const index = actors.indexOf(actor) - 10, clock = elapsed + index * 5.5, phase = clock % 26;
    const scan = !alarmed && actor.mode === 'patrol' && phase > 21.5;
    if (scan && !actor.scanning) {
      const candidates = [...hangar.scanSurfaces].sort((first, second) => distance(first, actor.root.position) - distance(second, actor.root.position));
      actor.scanRoof = candidates[Math.floor(clock / 26) % 3].id; actor.path = [];
    }
    actor.scanning = scan;
    if (!scan) { actor.scanTarget = null; return; }
    const roof = hangar.scanSurfaces.find(item => item.id === actor.scanRoof)!;
    const progress = (phase - 21.5) / 4.5;
    actor.scanTarget ??= new THREE.Vector3();
    if ('mesh' in roof && roof.mesh instanceof THREE.Mesh) {
      actor.scanTarget.set(Math.sin(progress * Math.PI * 2) * (roof.width / 2 - 0.5), 0.14,
        Math.cos(progress * Math.PI * 2) * 0.7).applyMatrix4(roof.mesh.matrixWorld);
    } else actor.scanTarget.set(roof.x + Math.sin(progress * Math.PI * 2) * 2.3, roof.height + 0.05,
      roof.z + Math.cos(progress * Math.PI * 2) * 1.3);
    if (actor.root.position.y > roof.height + 1.3) {
      actor.root.position.x = THREE.MathUtils.damp(actor.root.position.x, roof.x + 5.2, 0.7, dt);
      actor.root.position.z = THREE.MathUtils.damp(actor.root.position.z, roof.z + 2.5, 0.7, dt);
    }
    direction.set(actor.scanTarget.x - actor.root.position.x, 0, actor.scanTarget.z - actor.root.position.z).normalize();
    desiredRotation.setFromAxisAngle(up, Math.atan2(direction.x, direction.z));
    actor.root.quaternion.slerp(desiredRotation, 1 - Math.exp(-dt * 3));
  }
  function update(dt: number, observation: StealthObservation) {
    if (disposed) return;
    elapsed += dt; stepNoiseTime -= dt;
    for (let index = volleys.length - 1; index >= 0; index--) {
      volleys[index].life -= dt;
      if (volleys[index].life <= 0) { volleys[index].mesh.removeFromParent(); volleys.splice(index, 1); }
    }
    if (observation.enabled && !observation.protected && observation.moving && observation.sprinting && stepNoiseTime <= 0) {
      emitNoise(observation.position, 7); stepNoiseTime = 1.1;
    }
    for (const actor of actors) {
      actor.mixer?.update(dt);
      if (actor.mode === 'reserve') continue;
      if (actor.mode === 'down') {
        actor.downTime += dt;
        if (![...actor.actions.keys()].some(name => /death|die|shutdown/i.test(name))) {
          actor.root.rotation.z = THREE.MathUtils.lerp(0, -1.25, THREE.MathUtils.smoothstep(actor.downTime, 0, 0.6));
        }
        updateBeam(actor); continue;
      }
      updateRooftopScan(actor, dt);
      if (!alarmed) {
        const visible = canSee(actor, observation);
        const pressure = (observation.crouching ? 0.55 : 1.05) * (distance(actor.root.position, observation.position) < 3 ? 1.8 : 1);
        actor.suspicion = THREE.MathUtils.clamp(actor.suspicion + (visible ? pressure : -0.65) * dt, 0, 1);
        if (visible && actor.suspicion > 0.25 && actor.mode === 'patrol' && !actor.scanning) {
          actor.mode = 'investigate'; actor.target = new THREE.Vector3(observation.position.x, hangar.deckY, observation.position.z);
          actor.path = navigation.findPath(actor.root.position, actor.target); actor.searchTime = 5; actor.dwell = 0;
        }
        if (actor.suspicion >= 1) forceAlarm(actor.id);
      }
      if (actor.scanning) {
        animation(actor, 'idle');
      } else if (actor.mode === 'charge') {
        actor.repath -= dt; actor.attackTime -= dt;
        if (encirclement && actor.formation) {
          move(actor, dt, actor.kind === 'eye' ? 9.5 : 8.8);
          if (distance(actor.root.position, actor.formation) < 1.2 || firing) {
            direction.set(encirclement.x - actor.root.position.x, 0, encirclement.z - actor.root.position.z).normalize();
            desiredRotation.setFromAxisAngle(up, Math.atan2(direction.x, direction.z));
            actor.root.quaternion.slerp(desiredRotation, 1 - Math.exp(-dt * 8));
            if (!firing) animation(actor, 'idle');
          }
        } else animation(actor, 'idle');
      } else if (actor.mode === 'investigate') {
        if (!move(actor, dt, actor.kind === 'eye' ? 2.6 : 2.1)) {
          actor.searchTime -= dt;
          actor.root.rotation.y += Math.sin(elapsed * 1.7 + actors.indexOf(actor)) * dt * 0.7;
          if (actor.searchTime <= 0 && actor.suspicion <= 0.05) {
            actor.mode = 'patrol'; actor.path = []; actor.target = null; actor.dwell = 0.5;
          }
        }
      } else {
        if (actor.dwell > 0) { actor.dwell -= dt; animation(actor, 'idle'); }
        else {
          if (!actor.path.length) {
            actor.routeIndex = (actor.routeIndex + 1) % actor.route.length;
            actor.path = navigation.findPath(actor.root.position, actor.route[actor.routeIndex]);
          }
          animation(actor, 'walk');
          if (!move(actor, dt, actor.kind === 'eye' ? 1.8 : 1.15)) actor.dwell = 0.7;
        }
      }
      if (actor.kind === 'eye') actor.root.position.y = THREE.MathUtils.damp(actor.root.position.y,
        hangar.deckY + (actor.scanning ? 8.6 : 3.8) + Math.sin(elapsed * 1.6 + actors.indexOf(actor)) * 0.1, 2.8, dt);
      actor.body.position.set(actor.root.position.x, actor.root.position.y + (actor.kind === 'eye' ? 0 : 0.45), actor.root.position.z);
      actor.body.aabbNeedsUpdate = true;
      updateBeam(actor);
    }
  }
  function reset() {
    alarmed = false; encirclement = null; firing = false; elapsed = distractions = stepNoiseTime = 0;
    for (const volley of volleys) volley.mesh.removeFromParent(); volleys.length = 0;
    actors.forEach((actor, index) => {
      const reserve = index >= 14, start = actor.route[index % actor.route.length];
      actor.mode = reserve ? 'reserve' : 'patrol'; actor.suspicion = actor.downTime = 0; actor.health = 50;
      actor.root.position.set(start.x, hangar.deckY + (actor.kind === 'eye' ? 3.8 : 0), start.z);
      actor.root.rotation.set(0, index % 2 ? Math.PI : Math.PI / 2, 0);
      actor.routeIndex = index % actor.route.length; actor.path = []; actor.target = actor.lastNoise = null;
      actor.formation = null;
      actor.scanning = false; actor.scanRoof = null; actor.scanTarget = null;
      actor.heardAt = -Infinity; actor.dwell = index % 3 * 0.5; actor.searchTime = actor.repath = actor.attackTime = 0;
      actor.body.position.set(start.x, actor.root.position.y + (actor.kind === 'eye' ? 0 : 0.45), start.z);
      actor.body.aabbNeedsUpdate = true; actor.body.collisionResponse = !reserve;
      actor.root.visible = actor.beam.visible = actor.footprint.visible = !reserve;
      if (actor.light) actor.light.visible = !reserve;
      actor.animation = ''; animation(actor, 'walk');
    });
  }
  return { actors, ready: Promise.all(loading).then(() => undefined), navigation, safeZoneFor, isProtected, canSee, emitNoise,
    getTakedownCandidate, completeTakedown, forceAlarm, formFiringSquad, fireVolley, reset, update,
    get alarmed() { return alarmed; },
    get suspicion() { return Math.max(0, ...actors.map(actor => actor.suspicion)); },
    get distractions() { return distractions; },
    get firingSquad() { return { forming: encirclement !== null, firing, shots: volleys.length,
      arrived: actors.filter(actor => actor.mode === 'charge' && actor.formation && distance(actor.root.position, actor.formation) < 1.4).length }; },
    getDamageTargets: () => damageTargets.filter((_, index) => actors[index].mode !== 'down' && actors[index].mode !== 'reserve'),
    getMinimapEnemies: () => actors.filter(actor => actor.mode !== 'down' && actor.mode !== 'reserve').map(actor => {
      const forward = actorFacing(actor);
      return { id: actor.id, position: actor.root.position, yaw: Math.atan2(-forward.x, -forward.z),
        alerted: actor.mode === 'charge' || actor.suspicion > 0.1, range: actor.range };
    }),
    dispose() {
      if (disposed) return; disposed = true;
      for (const actor of actors) {
        physics.world.removeBody(actor.body); actor.mixer?.stopAllAction(); actor.root.removeFromParent(); disposeRoom(actor.root);
        actor.beam.removeFromParent(); actor.beam.material.dispose(); actor.footprint.removeFromParent();
        (actor.footprint.material as THREE.Material).dispose();
        actor.light?.removeFromParent(); actor.light?.target.removeFromParent(); actor.light?.shadow.dispose();
      }
      for (const volley of volleys) volley.mesh.removeFromParent(); volleys.length = 0;
      volleyGeometry.dispose(); volleyMaterial.dispose(); beamGeometry.dispose(); footprintGeometry.dispose();
    } };
}

export type StealthDirector = ReturnType<typeof createStealthDirector>;