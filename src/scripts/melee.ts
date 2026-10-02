import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Capsule } from 'three/addons/math/Capsule.js';
import type { DamageTarget, DamageWeapon } from './pistol.js';
import type { Player } from './player.js';

export interface MeleeSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
}

interface MeleeContext {
  scene: THREE.Scene | null;
  world: CANNON.World | null;
  player: Player | null;
  character: THREE.Object3D | null;
  targets: DamageTarget[];
}

function belongsTo(object: THREE.Object3D, root: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

function visible(object: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

export function getWeaponSegment(weapon: THREE.Object3D): MeleeSegment {
  weapon.updateWorldMatrix(true, true);
  const saber = weapon.name === 'lightsaber';
  return {
    start: weapon.localToWorld(new THREE.Vector3(0, saber ? 0.32 : -0.16, saber ? 0 : -0.015)),
    end: weapon.localToWorld(new THREE.Vector3(0, saber ? 1.22 : 0.66, saber ? 0 : -0.1)),
  };
}

export function getAttackSegment(player: Player, progress: number, side = 1): MeleeSegment {
  const state = player.getState();
  const pitch = THREE.MathUtils.clamp(state.pitch, -1.25, 1.25);
  const yaw = state.yaw + side * THREE.MathUtils.lerp(-0.85, 0.85, progress);
  const direction = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const origin = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
  return { start: origin.clone().addScaledVector(direction, 0.3), end: origin.addScaledVector(direction, 1.65) };
}

export class MeleeSwing {
  private previous: MeleeSegment | null = null;
  private hitTargets = new Set<THREE.Object3D>();
  private hitBodies = new Set<CANNON.Body>();

  constructor(private weapon: DamageWeapon, private damage = 35, private radius = 0.12, private reach = 1.8) {}

  reset() {
    this.previous = null;
    this.hitTargets.clear();
    this.hitBodies.clear();
  }

  prime(segment: MeleeSegment) {
    this.previous = { start: segment.start.clone(), end: segment.end.clone() };
  }

  update(context: MeleeContext, segment: MeleeSegment, ignored: THREE.Object3D[] = []) {
    const { scene, world, player, character, targets } = context;
    if (!scene || !player) return false;
    scene.updateMatrixWorld(true);
    const origin = new THREE.Vector3(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    const previous = this.previous ?? segment;
    const travel = Math.max(previous.start.distanceTo(segment.start), previous.end.distanceTo(segment.end));
    const steps = Math.max(1, Math.min(64, Math.ceil(travel / (this.radius * 0.5))));
    const capsules: Capsule[] = [];
    for (let sample = 0; sample <= steps; sample++) {
      const progress = sample / steps;
      capsules.push(new Capsule(previous.start.clone().lerp(segment.start, progress), previous.end.clone().lerp(segment.end, progress), this.radius));
    }
    this.prime(segment);
    const ignoredRoots = character ? [...ignored, character] : ignored;
    const blocked = (point: THREE.Vector3, root?: THREE.Object3D, body?: CANNON.Body) => {
      const offset = point.clone().sub(origin), distance = offset.length();
      if (distance > this.reach || distance < 0.001) return distance > this.reach;
      let obstruction = false;
      world?.raycastAll(new CANNON.Vec3(origin.x, origin.y, origin.z), new CANNON.Vec3(point.x, point.y, point.z),
        { skipBackfaces: false, checkCollisionResponse: true }, hit => {
          if (hit.body !== player.body && hit.body !== body && hit.distance < distance - 0.02) obstruction = true;
        });
      if (obstruction) return true;
      if (body && !root) return false;
      let owner: THREE.Object3D | undefined;
      if (root instanceof THREE.Mesh && (Array.isArray(root.material) ? root.material : [root.material]).every(material => !material.visible)) {
        owner = root;
        while (owner.parent && owner.parent !== scene) owner = owner.parent;
      }
      const ray = new THREE.Raycaster(origin, offset.normalize(), 0, Math.max(0, distance - 0.02));
      return ray.intersectObjects(scene.children, true).some(hit => {
        if (!(hit.object instanceof THREE.Mesh) || !visible(hit.object) || hit.object.name === 'BreakableDebris'
          || (root && belongsTo(hit.object, root)) || (owner && belongsTo(hit.object, owner))
          || ignoredRoots.some(candidate => belongsTo(hit.object, candidate))) return false;
        const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
        return materials.some(material => material.visible && (!material.transparent || material.opacity >= 0.5));
      });
    };
    const contact = (bounds: THREE.Box3, root?: THREE.Object3D, body?: CANNON.Body) => {
      if (bounds.isEmpty()) return null;
      for (const capsule of capsules) {
        if (!capsule.intersectsBox(bounds)) continue;
        const point = bounds.clampPoint(capsule.getCenter(new THREE.Vector3()), new THREE.Vector3());
        if (!blocked(point, root, body)) return point;
      }
      return null;
    };
    const push = (body: CANNON.Body, point: THREE.Vector3) => {
      if (this.hitBodies.has(body)) return;
      this.hitBodies.add(body);
      if (body.mass <= 0 || body.world !== world) return;
      const direction = point.clone().sub(origin).normalize();
      body.applyImpulse(new CANNON.Vec3(direction.x * 3.5, 0.8, direction.z * 3.5));
    };
    let hit = false;
    for (const target of targets) {
      if (this.hitTargets.has(target.root) || !visible(target.root)) continue;
      const point = contact(new THREE.Box3().setFromObject(target.root), target.root, target.body);
      if (!point) continue;
      this.hitTargets.add(target.root);
      if (target.body) push(target.body, point);
      hit = target.damage(this.damage, this.weapon) || hit;
    }
    for (const body of world?.bodies ?? []) {
      if (body === player.body || body.mass <= 0 || this.hitBodies.has(body)) continue;
      body.updateAABB();
      const bounds = new THREE.Box3(new THREE.Vector3(body.aabb.lowerBound.x, body.aabb.lowerBound.y, body.aabb.lowerBound.z),
        new THREE.Vector3(body.aabb.upperBound.x, body.aabb.upperBound.y, body.aabb.upperBound.z));
      const point = contact(bounds, undefined, body);
      if (point) push(body, point);
    }
    return hit;
  }
}