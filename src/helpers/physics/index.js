import { CannonAdapter } from './adapters/cannonAdapter.js';

let adapter = null;

export function initPhysics(options = {}) {
  if (options.engine && options.engine !== 'cannon') {
    throw new Error(`Unsupported physics engine: ${options.engine}`);
  }
  adapter = new CannonAdapter(options);
  return adapter;
}

function requireAdapter() {
  if (!adapter) throw new Error('Physics has not been initialized.');
  return adapter;
}

export const addRigidBody = (...args) => requireAdapter().addRigidBody(...args);
export const removeRigidBody = (...args) => requireAdapter().removeRigidBody(...args);
export const applyImpulse = (...args) => requireAdapter().applyImpulse(...args);
export const setVelocity = (...args) => requireAdapter().setVelocity(...args);
export const getVelocity = (...args) => requireAdapter().getVelocity(...args);
export const moveKinematic = (...args) => requireAdapter().moveKinematic(...args);
export const beginGrab = (...args) => requireAdapter().beginGrab(...args);
export const moveGrabbedBody = (...args) => requireAdapter().moveGrabbedBody(...args);
export const endGrab = (...args) => requireAdapter().endGrab(...args);
export const setPhysicsEnabled = (...args) => requireAdapter().setPhysicsEnabled(...args);
export const stepPhysics = (...args) => requireAdapter().stepPhysics(...args);
export const onCollision = (...args) => requireAdapter().onCollision(...args);