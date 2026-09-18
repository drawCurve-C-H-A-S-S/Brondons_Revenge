import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const PHYSICS = Object.freeze({
  fixedStep: 1 / 120,
  maxFrameTime: 0.1,
  maxSubSteps: 12,
  gravity: -9.82,
  playerRadius: 0.3,
  moveSpeed: 4.2,
  jumpSpeed: 5.5,
  maxSlopeDegrees: 50,
  contactTolerance: 0.025,
  groundSnapDistance: 0.08,
});

interface PhysicsPlayer {
  beforePhysicsStep(dt: number): void;
  afterPhysicsStep(): void;
  updateCamera(dt: number, thirdPerson?: boolean): void;
}

type Point = { x: number; y: number; z: number };

interface PhysicsActor {
  body: CANNON.Body;
  beforePhysicsStep(dt: number): void;
  afterPhysicsStep(): void;
}
const actors = new WeakMap<CANNON.World, Set<PhysicsActor>>();

export function registerPhysicsActor(world: CANNON.World, actor: PhysicsActor) {
  let set = actors.get(world);
  if (!set) { set = new Set(); actors.set(world, set); }
  set.add(actor);
  return () => { set.delete(actor); };
}

/** Also used to advance a pursuer's previous room until it reaches its doorway. */
export function stepPhysicsWorld(world: CANNON.World, dt: number) {
  const active = [...(actors.get(world) ?? [])];
  for (const actor of active) actor.beforePhysicsStep(dt);
  world.step(dt);
  for (const actor of active) actor.afterPhysicsStep();
}

export function hasNearbyActor(world: CANNON.World, x: number, z: number, range: number) {
  return [...(actors.get(world) ?? [])].some(({ body }) =>
    body.world === world && body.position.y < 3 &&
    Math.hypot(body.position.x - x, body.position.z - z) < range);
}

/** Grounded sphere steering: use real supports and preserve gravity when airborne. */
export function createGroundMotor(body: CANNON.Body, radius: number) {
  let grounded = false;
  const normal = new CANNON.Vec3(0, 1, 0);
  const minY = Math.cos(PHYSICS.maxSlopeDegrees * Math.PI / 180);
  function readSupport() {
    const world = body.world;
    if (!world) return;
    let support: CANNON.Vec3 | null = null;
    for (const contact of world.contacts) {
      if (!contact.enabled) continue;
      const first = contact.bi === body;
      if (!first && contact.bj !== body) continue;
      const other = first ? contact.bj : contact.bi;
      if (other.type !== CANNON.Body.STATIC || !other.collisionResponse) continue;
      const n = contact.ni.scale(first ? -1 : 1);
      const point = other.position.vadd(first ? contact.rj : contact.ri);
      const gap = body.position.vsub(point).dot(n) - radius;
      if (n.y >= minY && Math.abs(gap) <= PHYSICS.contactTolerance && (!support || n.y > support.y)) support = n;
    }
    if (!support && (grounded || body.velocity.y <= 0.5)) {
      const from = body.position.clone();
      const to = from.vadd(new CANNON.Vec3(0, -(radius / minY + PHYSICS.groundSnapDistance), 0));
      let bestGap = Infinity;
      world.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: true }, hit => {
        if (hit.body?.type !== CANNON.Body.STATIC || hit.hitNormalWorld.y < minY) return;
        const gap = from.y - hit.hitPointWorld.y - radius / hit.hitNormalWorld.y;
        if (gap >= -PHYSICS.contactTolerance && gap <= (grounded ? PHYSICS.groundSnapDistance : PHYSICS.contactTolerance) && gap < bestGap) {
          bestGap = gap;
          support = hit.hitNormalWorld.clone();
        }
      });
      if (support && bestGap > 0) { body.position.y -= bestGap; body.aabbNeedsUpdate = true; }
    }
    grounded = support !== null;
    if (support) {
      normal.copy(support);
      const outward = body.velocity.dot(normal);
      if (outward > 0) body.velocity.vsub(normal.scale(outward), body.velocity);
    }
  }
  function drive(x: number, z: number, speed: number) {
    readSupport();
    const desired = new CANNON.Vec3(x, 0, z);
    if (grounded) desired.y = -(x * normal.x + z * normal.z) / normal.y;
    desired.normalize();
    if (grounded) {
      desired.scale(speed, body.velocity);
      const gravity = body.world!.gravity;
      const tangent = gravity.vsub(normal.scale(gravity.dot(normal)));
      body.force.vsub(tangent.scale(body.mass), body.force);
    } else {
      body.velocity.x = desired.x * speed;
      body.velocity.z = desired.z * speed;
    }
  }
  return { drive, readSupport, reset: () => { grounded = false; } };
}

function positiveDimensions(...values: number[]) {
  if (values.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Collider dimensions must be finite and positive');
  }
}

/** One world and one fixed-step clock per playable scene. Units are meters/seconds. */
export function createScenePhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYSICS.gravity, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.addEventListener('addBody', ({ body }: { body: CANNON.Body }) => {
    // Shapes compute bounds during construction, before scene code sets position.
    body.aabbNeedsUpdate = true;
  });
  const solver = new CANNON.GSSolver();
  solver.iterations = 20;
  solver.tolerance = 1e-7;
  world.solver = solver;
  world.defaultContactMaterial.friction = 0;
  world.defaultContactMaterial.restitution = 0;
  const solidMaterial = new CANNON.Material({ friction: 0, restitution: 0 });
  let accumulator = 0;

  function addBox(size: Point, position: Point) {
    positiveDimensions(size.x, size.y, size.z);
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      throw new Error('Collider position must be finite');
    }
    const body = new CANNON.Body({ mass: 0, material: solidMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
    body.position.set(position.x, position.y, position.z);
    world.addBody(body);
    return body;
  }

  /** Call after parenting/positioning the mesh. Static transforms must stay unchanged. */
  function addBoxFromMesh(mesh: THREE.Mesh<THREE.BoxGeometry>) {
    mesh.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.matrixWorld.decompose(position, rotation, scale);
    const recomposed = new THREE.Matrix4().compose(position, rotation, scale);
    if (mesh.matrixWorld.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - recomposed.elements[i]) > 1e-6)) {
      throw new Error('Box colliders require finite, nonsheared mesh transforms');
    }
    const { width, height, depth } = mesh.geometry.parameters;
    const body = addBox({ x: width * scale.x, y: height * scale.y, z: depth * scale.z }, position);
    body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    body.aabbNeedsUpdate = true;
    return body;
  }

  /** Stairs use a solid wedge, not individual riser colliders or analytical floor heights. */
  function addStaircase(options: {
    width: number; run: number; rise: number; position: Point;
    material: THREE.Material; yaw?: number; stepCount?: number;
  }) {
    const { width, run, rise, position, material, yaw = 0 } = options;
    positiveDimensions(width, run, rise);
    if (![position.x, position.y, position.z, yaw].every(Number.isFinite)) {
      throw new Error('Stair position and yaw must be finite');
    }
    if (Math.atan2(rise, run) * 180 / Math.PI > PHYSICS.maxSlopeDegrees) {
      throw new Error('Stair slope exceeds the player walkable slope limit');
    }
    const stepCount = options.stepCount ?? Math.ceil(rise / 0.18);
    if (!Number.isInteger(stepCount) || stepCount < 1) throw new Error('Invalid stair step count');
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = yaw;
    const stepDepth = run / stepCount;
    const stepHeight = rise / stepCount;
    for (let i = 0; i < stepCount; i++) {
      const height = stepHeight * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, height, stepDepth), material);
      step.position.set(0, height / 2, stepDepth * (i + 0.5));
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }

    const h = width / 2;
    const bottom = -0.1;
    const vertices = [
      new CANNON.Vec3(-h, bottom, 0), new CANNON.Vec3(h, bottom, 0),
      new CANNON.Vec3(h, bottom, run), new CANNON.Vec3(-h, bottom, run),
      new CANNON.Vec3(-h, 0, 0), new CANNON.Vec3(h, 0, 0),
      new CANNON.Vec3(h, rise, run), new CANNON.Vec3(-h, rise, run),
    ];
    const shape = new CANNON.ConvexPolyhedron({ vertices, faces: [
      [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
      [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2],
    ] });
    const body = new CANNON.Body({ mass: 0, material: solidMaterial, shape });
    body.position.set(position.x, position.y, position.z);
    body.quaternion.setFromEuler(0, yaw, 0);
    world.addBody(body);
    return { group, body };
  }

  function step(dt: number, player: PhysicsPlayer, thirdPerson: boolean = false) {
    const frameTime = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    accumulator += frameTime;
    let steps = 0;
    while (accumulator + 1e-10 >= PHYSICS.fixedStep && steps < PHYSICS.maxSubSteps) {
      player.beforePhysicsStep(PHYSICS.fixedStep);
      stepPhysicsWorld(world, PHYSICS.fixedStep);
      player.afterPhysicsStep();
      accumulator = Math.max(0, accumulator - PHYSICS.fixedStep);
      steps++;
    }
    player.updateCamera(frameTime, thirdPerson);
  }

  function dispose() {
    for (const body of [...world.bodies]) world.removeBody(body);
    actors.delete(world);
    accumulator = 0;
  }

  return { world, solidMaterial, addBox, addBoxFromMesh, addStaircase, step, dispose };
}
