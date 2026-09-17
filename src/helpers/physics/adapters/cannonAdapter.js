import * as CANNON from 'cannon-es';

const shapesFor = (options, scale = [1, 1, 1]) => {
  const radialScale = (scale[0] + scale[2]) / 2;
  if (options.collider === 'sphere') {
    const radius = (options.radius ?? 0.5) * ((scale[0] + scale[1] + scale[2]) / 3);
    return [{ shape: new CANNON.Sphere(radius) }];
  }
  if (options.collider === 'cylinder') {
    const radius = (options.radius ?? 0.5) * radialScale;
    const height = (options.height ?? 1) * scale[1];
    return [{ shape: new CANNON.Cylinder(radius, radius, height, options.segments ?? 8) }];
  }
  if (options.collider === 'capsule') {
    const radius = (options.radius ?? 0.5) * radialScale;
    const height = (options.height ?? 1) * scale[1];
    return [
      { shape: new CANNON.Cylinder(radius, radius, height, options.segments ?? 8) },
      { shape: new CANNON.Sphere(radius), offset: new CANNON.Vec3(0, height / 2, 0) },
      { shape: new CANNON.Sphere(radius), offset: new CANNON.Vec3(0, -height / 2, 0) },
    ];
  }
  const size = (options.size ?? [1, 1, 1]).map((value, index) => value * (scale[index] ?? 1));
  return [{ shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)) }];
};

export class CannonAdapter {
  constructor({ gravity = [0, -9.81, 0] } = {}) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(...gravity) });
    this.bodies = new Map();
  }

  addRigidBody(mesh, options = {}) {
    const body = new CANNON.Body({
      mass: options.mass ?? 0,
      position: new CANNON.Vec3(...(options.position || mesh.position.toArray())),
      material: new CANNON.Material(options.material || 'default'),
      linearDamping: options.linearDamping ?? 0.01,
      angularDamping: options.angularDamping ?? 0.01,
    });
    const scale = mesh.scale.toArray();
    for (const { shape, offset } of shapesFor(options, scale)) body.addShape(shape, offset);
    for (const extra of options.extraColliders || []) {
      const localOffset = extra.position || [0, 0, 0];
      for (const { shape, offset } of shapesFor(extra, scale)) {
        const combined = new CANNON.Vec3(
          localOffset[0] * scale[0] + (offset?.x || 0),
          localOffset[1] * scale[1] + (offset?.y || 0),
          localOffset[2] * scale[2] + (offset?.z || 0),
        );
        body.addShape(shape, combined);
      }
    }
    body.velocity.set(...(options.velocity || [0, 0, 0]));
    const rotation = options.rotation || mesh.rotation.toArray();
    body.quaternion.setFromEuler(...rotation);
    this.world.addBody(body);
    this.bodies.set(mesh, body);
    return body;
  }

  setVelocity(mesh, velocity) {
    const body = this.bodies.get(mesh);
    if (!body) throw new Error('Cannot set velocity on a mesh without a rigid body.');
    body.velocity.set(...velocity);
    body.wakeUp();
  }

  getVelocity(mesh) {
    const body = this.bodies.get(mesh);
    if (!body) throw new Error('Cannot read velocity from a mesh without a rigid body.');
    return body.velocity.toArray();
  }

  moveKinematic(mesh, position, quaternion = null) {
    const body = this.bodies.get(mesh);
    if (!body) throw new Error('Cannot move a mesh without a rigid body.');
    body.type = CANNON.Body.KINEMATIC;
    body.position.set(...position);
    if (quaternion) body.quaternion.set(...quaternion);
    body.aabbNeedsUpdate = true;
  }

  removeRigidBody(mesh) {
    const body = this.bodies.get(mesh);
    if (!body) return;
    this.world.removeBody(body);
    this.bodies.delete(mesh);
  }

  applyImpulse(mesh, impulse) {
    const body = this.bodies.get(mesh);
    if (!body) throw new Error('Cannot apply impulse to a mesh without a rigid body.');
    body.applyImpulse(new CANNON.Vec3(...impulse), body.position);
  }

  beginGrab(mesh) {
    const body = this.bodies.get(mesh);
    if (!body || body.mass === 0) return false;
    body.userData = { previousType: body.type, previousMass: body.mass };
    body.type = CANNON.Body.KINEMATIC;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.updateMassProperties();
    return true;
  }

  moveGrabbedBody(mesh) {
    const body = this.bodies.get(mesh);
    if (!body || body.type !== CANNON.Body.KINEMATIC) return;
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
    body.aabbNeedsUpdate = true;
  }

  endGrab(mesh) {
    const body = this.bodies.get(mesh);
    if (!body || !body.userData?.previousType) return;
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
    body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
    body.type = body.userData.previousType;
    body.mass = body.userData.previousMass;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.updateMassProperties();
    body.wakeUp();
    delete body.userData;
  }

  setPhysicsEnabled(mesh, enabled) {
    const body = this.bodies.get(mesh);
    if (!body) return;
    body.type = enabled ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC;
    body.mass = enabled ? body.mass || 1 : 0;
    body.updateMassProperties();
  }

  stepPhysics(deltaTime) {
    this.world.step(1 / 60, deltaTime, 3);
    for (const [mesh, body] of this.bodies) {
      if (body.type === CANNON.Body.DYNAMIC) {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
      }
    }
  }

  onCollision(mesh, callback) {
    const body = this.bodies.get(mesh);
    if (!body) throw new Error('Cannot observe collisions for a mesh without a rigid body.');
    body.addEventListener('collide', (event) => callback(mesh, event.body, event));
  }
}