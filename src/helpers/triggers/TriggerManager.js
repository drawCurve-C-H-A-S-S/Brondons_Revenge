import * as THREE from 'three';

export class TriggerManager {
  constructor(scene) {
    this.scene = scene;
    this.triggers = new Map();
    this.listeners = new Map();
    this.actions = new Map();
    this.showTriggers = false;
  }

  registerTrigger(triggerJSON) {
    if (!triggerJSON?.id) throw new Error('Trigger requires an id.');
    if (this.triggers.has(triggerJSON.id)) this.unregisterTrigger(triggerJSON.id);

    const size = triggerJSON.size || [1, 1, 1];
    const isSphere = triggerJSON.type === 'sphere';
    const helper = new THREE.LineSegments(
      new THREE.EdgesGeometry(isSphere ? new THREE.SphereGeometry(size[0] / 2, 20, 12) : new THREE.BoxGeometry(...size)),
      new THREE.LineBasicMaterial({ color: 0xf2b880 }),
    );
    helper.position.fromArray(triggerJSON.position || [0, 0, 0]);
    helper.visible = this.showTriggers;
    helper.userData.triggerId = triggerJSON.id;
    this.scene.add(helper);
    this.triggers.set(triggerJSON.id, {
      data: structuredClone(triggerJSON),
      helper,
      activeActors: new Set(),
    });
    return triggerJSON.id;
  }

  unregisterTrigger(id) {
    const trigger = this.triggers.get(id);
    if (!trigger) return;
    this.scene.remove(trigger.helper);
    trigger.helper.geometry.dispose();
    trigger.helper.material.dispose();
    this.triggers.delete(id);
  }

  updateTrigger(triggerJSON) {
    const trigger = this.triggers.get(triggerJSON.id);
    if (!trigger) return this.registerTrigger(triggerJSON);
    const previousSize = trigger.data.size || [1, 1, 1];
    const nextSize = triggerJSON.size || [1, 1, 1];
    const geometryChanged = trigger.data.type !== triggerJSON.type
      || previousSize.some((value, index) => value !== nextSize[index]);
    if (geometryChanged) return this.registerTrigger(triggerJSON);
    trigger.data = structuredClone(triggerJSON);
    trigger.helper.position.fromArray(triggerJSON.position || [0, 0, 0]);
    return triggerJSON.id;
  }

  clear() {
    for (const id of this.triggers.keys()) this.unregisterTrigger(id);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  registerAction(name, callback) {
    this.actions.set(name, callback);
  }

  setVisible(visible) {
    this.showTriggers = visible;
    for (const trigger of this.triggers.values()) trigger.helper.visible = visible;
  }

  update(actorMeshes) {
    for (const trigger of this.triggers.values()) {
      const nextActors = new Set();
      for (const actor of actorMeshes) {
        if (this.intersects(trigger.data, actor)) {
          nextActors.add(actor);
          if (!trigger.activeActors.has(actor)) {
            this.emit('triggerEnter', trigger.data, actor);
            const action = this.actions.get(trigger.data.action);
            if (action) action(trigger.data.params || {}, actor, trigger.data);
          }
        }
      }
      for (const actor of trigger.activeActors) {
        if (!nextActors.has(actor)) this.emit('triggerExit', trigger.data, actor);
      }
      trigger.activeActors = nextActors;
    }
  }

  intersects(trigger, actor) {
    const triggerPosition = new THREE.Vector3().fromArray(trigger.position || [0, 0, 0]);
    const triggerSize = new THREE.Vector3().fromArray(trigger.size || [1, 1, 1]);
    const actorBox = new THREE.Box3().setFromObject(actor);
    if (trigger.type === 'sphere') {
      return actorBox.intersectsSphere(new THREE.Sphere(triggerPosition, triggerSize.x / 2));
    }
    const triggerBox = new THREE.Box3().setFromCenterAndSize(triggerPosition, triggerSize);
    return triggerBox.intersectsBox(actorBox);
  }

  emit(event, ...args) {
    for (const callback of this.listeners.get(event) || []) callback(...args);
  }
}
