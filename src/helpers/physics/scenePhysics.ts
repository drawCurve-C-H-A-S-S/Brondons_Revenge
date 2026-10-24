import * as THREE from "three";
import * as CANNON from "cannon-es";

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
  if (!set) {
    set = new Set();
    actors.set(world, set);
  }
  set.add(actor);
  return () => {
    set.delete(actor);
  };
}

/** Also used to advance a pursuer's previous room until it reaches its doorway. */
export function stepPhysicsWorld(world: CANNON.World, dt: number) {
  const active = [...(actors.get(world) ?? [])];
  for (const actor of active) actor.beforePhysicsStep(dt);
  world.step(dt);
  for (const actor of active) actor.afterPhysicsStep();
}

export function hasNearbyActor(
  world: CANNON.World,
  x: number,
  z: number,
  range: number,
) {
  return [...(actors.get(world) ?? [])].some(
    ({ body }) =>
      body.world === world &&
      body.position.y < 3 &&
      Math.hypot(body.position.x - x, body.position.z - z) < range,
  );
}

/** Grounded sphere steering: use real supports and preserve gravity when airborne. */
export function createGroundMotor(body: CANNON.Body, radius: number) {
  let grounded = false;
  const normal = new CANNON.Vec3(0, 1, 0);
  const minY = Math.cos((PHYSICS.maxSlopeDegrees * Math.PI) / 180);
  function readSupport() {
    const world = body.world;
    if (!world) return;
    let support: CANNON.Vec3 | null = null;
    for (const contact of world.contacts) {
      if (!contact.enabled) continue;
      const first = contact.bi === body;
      if (!first && contact.bj !== body) continue;
      const other = first ? contact.bj : contact.bi;
      if (other.type !== CANNON.Body.STATIC || !other.collisionResponse)
        continue;
      const n = contact.ni.scale(first ? -1 : 1);
      const point = other.position.vadd(first ? contact.rj : contact.ri);
      const gap = body.position.vsub(point).dot(n) - radius;
      if (
        n.y >= minY &&
        Math.abs(gap) <= PHYSICS.contactTolerance &&
        (!support || n.y > support.y)
      )
        support = n;
    }
    if (!support && (grounded || body.velocity.y <= 0.5)) {
      const from = body.position.clone();
      const to = from.vadd(
        new CANNON.Vec3(0, -(radius / minY + PHYSICS.groundSnapDistance), 0),
      );
      let bestGap = Infinity;
      world.raycastAll(
        from,
        to,
        { skipBackfaces: true, checkCollisionResponse: true },
        (hit) => {
          if (
            hit.body?.type !== CANNON.Body.STATIC ||
            hit.hitNormalWorld.y < minY
          )
            return;
          const gap =
            from.y - hit.hitPointWorld.y - radius / hit.hitNormalWorld.y;
          if (
            gap >= -PHYSICS.contactTolerance &&
            gap <=
              (grounded
                ? PHYSICS.groundSnapDistance
                : PHYSICS.contactTolerance) &&
            gap < bestGap
          ) {
            bestGap = gap;
            support = hit.hitNormalWorld.clone();
          }
        },
      );
      if (support && bestGap > 0) {
        body.position.y -= bestGap;
        body.aabbNeedsUpdate = true;
      }
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
  return {
    drive,
    readSupport,
    reset: () => {
      grounded = false;
    },
  };
}

function positiveDimensions(...values: number[]) {
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Collider dimensions must be finite and positive");
  }
}

function sweepSphereBox(
  from: CANNON.Vec3,
  to: CANNON.Vec3,
  radius: number,
  half: CANNON.Vec3,
) {
  const axes = ["x", "y", "z"] as const;
  const delta = to.vsub(from);
  const times = [0, 1];
  for (const axis of axes) {
    if (Math.abs(delta[axis]) < 1e-10) continue;
    for (const edge of [-half[axis], half[axis]]) {
      const time = (edge - from[axis]) / delta[axis];
      if (time > 0 && time < 1) times.push(time);
    }
  }
  times.sort((a, b) => a - b);
  // Squared distance to a box is quadratic between crossings of its face planes.
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i],
      end = times[i + 1],
      middle = (start + end) / 2;
    let a = 0,
      b = 0,
      c = -radius * radius;
    for (const axis of axes) {
      const point = from[axis] + delta[axis] * middle;
      const edge =
        point < -half[axis]
          ? -half[axis]
          : point > half[axis]
            ? half[axis]
            : null;
      if (edge === null) continue;
      const distance = from[axis] - edge;
      a += delta[axis] * delta[axis];
      b += 2 * distance * delta[axis];
      c += distance * distance;
    }
    let time = start;
    if ((a * start + b) * start + c > 1e-10) {
      const discriminant = b * b - 4 * a * c;
      if (a < 1e-12 || discriminant < 0) continue;
      time = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (time < start - 1e-10 || time > end + 1e-10) continue;
      time = Math.max(start, Math.min(end, time));
    }
    const point = from.vadd(delta.scale(time));
    const closest = new CANNON.Vec3(
      Math.max(-half.x, Math.min(half.x, point.x)),
      Math.max(-half.y, Math.min(half.y, point.y)),
      Math.max(-half.z, Math.min(half.z, point.z)),
    );
    const normal = point.vsub(closest);
    if (normal.lengthSquared() < 1e-12) continue;
    normal.normalize();
    if (delta.dot(normal) < -1e-10) return { time, normal };
  }
  return null;
}

/** A foot-anchored, upright sphere stack with collision-tested stance changes. */
export function createCharacterCollider(
  body: CANNON.Body,
  radius: number,
  height: number,
) {
  positiveDimensions(radius, height);
  if (height < radius * 2)
    throw new Error("Character height must fit its collision diameter");
  if (!body.world)
    throw new Error("Character collider requires a physics world");
  const world = body.world;
  const segments = Math.max(1, Math.ceil((height - radius * 2) / (radius * 2)));
  const firstShape = body.shapes.length;
  for (let i = 0; i <= segments; i++)
    body.addShape(
      new CANNON.Sphere(radius),
      new CANNON.Vec3(0, ((height - radius * 2) * i) / segments, 0),
    );
  const offsets = body.shapeOffsets.slice(firstShape);
  const headShape = body.shapes[firstShape + segments];
  const headOffset = offsets[segments];
  let currentHeight = height;
  const probe = new CANNON.Body({
    mass: 1,
    material: body.material ?? undefined,
  });
  for (let i = 1; i <= segments; i++)
    probe.addShape(
      new CANNON.Sphere(
        Math.max(radius * 0.9, radius - PHYSICS.contactTolerance),
      ),
      new CANNON.Vec3(0, ((height - radius * 2) * i) / segments, 0),
    );
  const narrowphase = new CANNON.Narrowphase(world);
  const contacts: CANNON.ContactEquation[] = [];
  const contactPool: CANNON.ContactEquation[] = [];
  const friction: CANNON.FrictionEquation[] = [];
  const frictionPool: CANNON.FrictionEquation[] = [];
  function collidesWith(other: CANNON.Body) {
    return (
      other !== body &&
      body.collisionResponse &&
      other.collisionResponse &&
      (body.collisionFilterGroup & other.collisionFilterMask) !== 0 &&
      (other.collisionFilterGroup & body.collisionFilterMask) !== 0
    );
  }
  function fits(nextHeight: number) {
    probe.position.copy(body.position);
    probe.quaternion.copy(body.quaternion);
    for (let i = 0; i < segments; i++)
      probe.shapeOffsets[i].y =
        ((nextHeight - radius * 2) * (i + 1)) / segments;
    probe.updateBoundingRadius();
    probe.updateAABB();
    for (const other of world.bodies) {
      if (!collidesWith(other)) continue;
      if (other.aabbNeedsUpdate) other.updateAABB();
      if (!probe.aabb.overlaps(other.aabb)) continue;
      contactPool.push(...contacts);
      contacts.length = 0;
      frictionPool.push(...friction);
      friction.length = 0;
      narrowphase.getContacts(
        [probe],
        [other],
        world,
        contacts,
        contactPool,
        friction,
        frictionPool,
      );
      if (contacts.some((contact) => contact.enabled)) return false;
    }
    return true;
  }

  const from = new CANNON.Vec3(),
    to = new CANNON.Vec3(),
    localFrom = new CANNON.Vec3(),
    localTo = new CANNON.Vec3(),
    inverse = new CANNON.Quaternion();
  function stopAtCeiling() {
    if (
      body.type !== CANNON.Body.DYNAMIC ||
      !body.collisionResponse ||
      body.position.y <= body.previousPosition.y
    )
      return;
    body.previousQuaternion.vmult(headOffset, from);
    from.vadd(body.previousPosition, from);
    body.pointToWorldFrame(headOffset, to);
    let earliest = 1;
    let normal: CANNON.Vec3 | null = null;
    for (const other of world.bodies) {
      if (other.type !== CANNON.Body.STATIC || !collidesWith(other)) continue;
      if (other.aabbNeedsUpdate) other.updateAABB();
      const bounds = other.aabb;
      if (
        Math.max(from.x, to.x) + radius < bounds.lowerBound.x ||
        Math.min(from.x, to.x) - radius > bounds.upperBound.x ||
        Math.max(from.y, to.y) + radius < bounds.lowerBound.y ||
        Math.min(from.y, to.y) - radius > bounds.upperBound.y ||
        Math.max(from.z, to.z) + radius < bounds.lowerBound.z ||
        Math.min(from.z, to.z) - radius > bounds.upperBound.z
      )
        continue;
      for (let i = 0; i < other.shapes.length; i++) {
        const shape = other.shapes[i];
        if (
          !(shape instanceof CANNON.Box) ||
          !shape.collisionResponse ||
          (headShape.collisionFilterGroup & shape.collisionFilterMask) === 0 ||
          (shape.collisionFilterGroup & headShape.collisionFilterMask) === 0
        )
          continue;
        other.pointToLocalFrame(from, localFrom);
        other.pointToLocalFrame(to, localTo);
        localFrom.vsub(other.shapeOffsets[i], localFrom);
        localTo.vsub(other.shapeOffsets[i], localTo);
        other.shapeOrientations[i].conjugate(inverse);
        inverse.vmult(localFrom, localFrom);
        inverse.vmult(localTo, localTo);
        const hit = sweepSphereBox(
          localFrom,
          localTo,
          radius,
          shape.halfExtents,
        );
        if (!hit || hit.time >= earliest) continue;
        other.shapeOrientations[i].vmult(hit.normal, hit.normal);
        other.vectorToWorldFrame(hit.normal, hit.normal);
        if (hit.normal.y >= -1e-6) continue;
        earliest = hit.time;
        normal = hit.normal;
      }
    }
    if (!normal) return;
    const movement = to.vsub(from);
    body.position.vsub(
      normal.scale(movement.dot(normal) * (1 - earliest)),
      body.position,
    );
    const into = body.velocity.dot(normal);
    if (into < 0) body.velocity.vsub(normal.scale(into), body.velocity);
    body.aabbNeedsUpdate = true;
    world.broadphase.dirty = true;
  }
  world.addEventListener("postStep", stopAtCeiling);

  return {
    get height() {
      return currentHeight;
    },
    setHeight(nextHeight: number) {
      positiveDimensions(nextHeight);
      if (nextHeight < radius * 2 || nextHeight > height)
        throw new Error("Character stance exceeds its collider height range");
      if (Math.abs(nextHeight - currentHeight) < 1e-8) return true;
      if (
        nextHeight > currentHeight &&
        body.type === CANNON.Body.DYNAMIC &&
        !fits(nextHeight)
      )
        return false;
      for (let i = 0; i <= segments; i++)
        offsets[i].y = ((nextHeight - radius * 2) * i) / segments;
      currentHeight = nextHeight;
      body.updateBoundingRadius();
      body.updateMassProperties();
      body.aabbNeedsUpdate = true;
      body.wakeUp();
      return true;
    },
    dispose() {
      world.removeEventListener("postStep", stopAtCeiling);
    },
  };
}

/** One world and one fixed-step clock per playable scene. Units are meters/seconds. */
export function createScenePhysics() {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, PHYSICS.gravity, 0),
  });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.addEventListener("addBody", ({ body }: { body: CANNON.Body }) => {
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
      throw new Error("Collider position must be finite");
    }
    const body = new CANNON.Body({ mass: 0, material: solidMaterial });
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
    );
    body.position.set(position.x, position.y, position.z);
    world.addBody(body);
    return body;
  }

  /** Position is the visible underside; thickness extends away from the room. */
  function addCeiling(
    size: { x: number; z: number },
    position: Point,
    thickness = 0.2,
  ) {
    positiveDimensions(thickness);
    return addBox(
      { x: size.x, y: thickness, z: size.z },
      { x: position.x, y: position.y + thickness / 2, z: position.z },
    );
  }

  /** Call after parenting/positioning the mesh. Static transforms must stay unchanged. */
  function addBoxFromMesh(mesh: THREE.Mesh<THREE.BoxGeometry>) {
    mesh.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.matrixWorld.decompose(position, rotation, scale);
    const recomposed = new THREE.Matrix4().compose(position, rotation, scale);
    if (
      mesh.matrixWorld.elements.some(
        (value, i) =>
          !Number.isFinite(value) ||
          Math.abs(value - recomposed.elements[i]) > 1e-6,
      )
    ) {
      throw new Error(
        "Box colliders require finite, nonsheared mesh transforms",
      );
    }
    const { width, height, depth } = mesh.geometry.parameters;
    const body = addBox(
      { x: width * scale.x, y: height * scale.y, z: depth * scale.z },
      position,
    );
    body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    body.aabbNeedsUpdate = true;
    return body;
  }

  /** Stairs use a solid wedge, not individual riser colliders or analytical floor heights. */
  function addStaircase(options: {
    width: number;
    run: number;
    rise: number;
    position: Point;
    material: THREE.Material;
    yaw?: number;
    stepCount?: number;
  }) {
    const { width, run, rise, position, material, yaw = 0 } = options;
    positiveDimensions(width, run, rise);
    if (![position.x, position.y, position.z, yaw].every(Number.isFinite)) {
      throw new Error("Stair position and yaw must be finite");
    }
    if ((Math.atan2(rise, run) * 180) / Math.PI > PHYSICS.maxSlopeDegrees) {
      throw new Error("Stair slope exceeds the player walkable slope limit");
    }
    const stepCount = options.stepCount ?? Math.ceil(rise / 0.18);
    if (!Number.isInteger(stepCount) || stepCount < 1)
      throw new Error("Invalid stair step count");
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = yaw;
    const stepDepth = run / stepCount;
    const stepHeight = rise / stepCount;
    for (let i = 0; i < stepCount; i++) {
      const height = stepHeight * (i + 1);
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, stepDepth),
        material,
      );
      step.position.set(0, height / 2, stepDepth * (i + 0.5));
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }

    const h = width / 2;
    const bottom = -0.1;
    const vertices = [
      new CANNON.Vec3(-h, bottom, 0),
      new CANNON.Vec3(h, bottom, 0),
      new CANNON.Vec3(h, bottom, run),
      new CANNON.Vec3(-h, bottom, run),
      new CANNON.Vec3(-h, 0, 0),
      new CANNON.Vec3(h, 0, 0),
      new CANNON.Vec3(h, rise, run),
      new CANNON.Vec3(-h, rise, run),
    ];
    const shape = new CANNON.ConvexPolyhedron({
      vertices,
      faces: [
        [0, 1, 2, 3],
        [4, 7, 6, 5],
        [0, 4, 5, 1],
        [3, 2, 6, 7],
        [0, 3, 7, 4],
        [1, 5, 6, 2],
      ],
    });
    const body = new CANNON.Body({ mass: 0, material: solidMaterial, shape });
    body.position.set(position.x, position.y, position.z);
    body.quaternion.setFromEuler(0, yaw, 0);
    world.addBody(body);
    return { group, body };
  }

  function step(
    dt: number,
    player: PhysicsPlayer,
    thirdPerson: boolean = false,
  ) {
    const frameTime = Number.isFinite(dt)
      ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime))
      : 0;
    accumulator += frameTime;
    let steps = 0;
    while (
      accumulator + 1e-10 >= PHYSICS.fixedStep &&
      steps < PHYSICS.maxSubSteps
    ) {
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

  return {
    world,
    solidMaterial,
    addBox,
    addCeiling,
    addBoxFromMesh,
    addStaircase,
    step,
    dispose,
  };
}
