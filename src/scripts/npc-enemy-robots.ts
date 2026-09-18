/**
 * NPC Enemy Robots - Trilobite enemy AI.
 * Paces scene4 until player enters trigger zone, then chases across scenes.
 * Disappears when player reaches scene2's green board.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadToolModel } from '../core/loader.js';
import { PHYSICS, createGroundMotor, registerPhysicsActor, stepPhysicsWorld } from '../helpers/physics/scenePhysics.js';
import type { Player } from './player.js';

export interface NPCSceneData {
  scene: THREE.Scene;
  physicsWorld: CANNON.World;
  player: Player;
  dispose(): void;
  npcSafeZone?: THREE.Box3;
}
interface Visit extends NPCSceneData {
  id: string;
  trail: THREE.Vector3[];
  exit?: { destination: Visit; entryZ: number };
}
// Thresholds lie on the existing doorway floor extensions, outside the wall.
const PORTALS: Record<string, { exitZ: number; entryZ: number }> = {
  'scene4:scene3': { exitZ: -6.9, entryZ: -11.2 },
  'scene3:scene2': { exitZ: 10.9, entryZ: 16.2 },
  'scene2:scene3': { exitZ: 15.9, entryZ: 11.2 },
  'scene3:scene4': { exitZ: -10.9, entryZ: -7.2 },
};
type EnemyState = 'WAITING' | 'PACING' | 'CHASING' | 'DYING' | 'DISAPPEARED';

export class NPCEnemyManager {
  readonly ready: Promise<void>;
  private model = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private action: THREE.AnimationAction | null = null;
  private body = new CANNON.Body({
    mass: 10, shape: new CANNON.Sphere(PHYSICS.playerRadius),
    fixedRotation: true, linearDamping: 0,
    material: new CANNON.Material({ friction: 0, restitution: 0 }),
  });
  private motor = createGroundMotor(this.body, PHYSICS.playerRadius);
  private state: EnemyState = 'WAITING';
  private health = 100;
  private loaded = false;
  private disposed = false;
  private active: Visit | null = null;
  private owner: Visit | null = null;
  private retired = new Set<Visit>();
  private unregister: (() => void) | null = null;
  private accumulator = 0;
  private paceDirection = 1;
  private attackCooldown = 2.5;
  private oneShotTime = 0;
  private deathTime = 0;
  private readonly triggerRadius = 3;
  private readonly chaseSpeed = 3.5;
  private readonly meleeRange = 1.8;
  private readonly shootRange = 9;
  private readonly chargeRange = 4;
  private readonly chargeTimeScale = 1.6;

  constructor(load: () => Promise<Pick<GLTF, 'scene' | 'animations'>> = () => loadToolModel('Enemy_Trilobite'), private random = Math.random) {
    this.model.name = 'Trilobite';
    this.model.visible = false;
    this.ready = load().then(gltf => {
      if (this.disposed) return;
      const obj = gltf.scene;
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      obj.scale.multiplyScalar(1.4 / Math.max(size.x, size.y, size.z, 0.001));
      box.setFromObject(obj);
      obj.position.y -= box.min.y;
      this.model.add(obj);
      obj.traverse(child => {
        if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
      });
      this.mixer = new THREE.AnimationMixer(obj);
      for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
      this.loaded = true;
      // Loading may finish after the player has already entered or left scene4.
      if (this.active?.id === 'scene4' && this.state === 'WAITING') this.spawn(this.active);
    }).catch(error => { console.error('[NPC] Failed to load Trilobite:', error); });
  }

  /** Own scene disposal so the pursuer can finish walking through previous rooms. */
  enterScene(id: string, data: NPCSceneData) {
    const next: Visit = { ...data, id, trail: [] };
    const previous = this.active;
    const portal = previous && PORTALS[`${previous.id}:${id}`];
    if (previous) {
      if (portal && (this.state === 'CHASING' || this.state === 'DYING')) {
        this.recordPlayer(previous, true);
        previous.trail.push(new THREE.Vector3(0, 0, portal.exitZ));
        previous.exit = { destination: next, entryZ: portal.entryZ };
        previous.player.dispose();
        this.retired.add(previous);
      } else {
        this.detach();
        if (this.state !== 'DISAPPEARED') this.state = 'WAITING';
        previous.dispose();
        this.releaseRetired();
      }
    }
    this.active = next;
    if (this.state === 'CHASING') this.recordPlayer(next, true);
    if (id === 'scene4' && (this.state === 'WAITING' || this.state === 'DISAPPEARED')) {
      this.state = 'WAITING';
      if (this.loaded) this.spawn(next);
    }
  }

  private spawn(visit: Visit) {
    this.health = 100;
    this.state = 'PACING';
    this.paceDirection = 1;
    this.oneShotTime = 0;
    this.attackCooldown = 2.5;
    this.model.visible = true;
    this.moveToWorld(visit, 0, 1);
    this.playAnimation('Walk', true);
  }

  private detach() {
    this.unregister?.();
    this.unregister = null;
    this.body.world?.removeBody(this.body);
    this.model.removeFromParent();
    this.owner = null;
  }

  private moveToWorld(visit: Visit, x: number, z: number) {
    this.detach();
    this.owner = visit;
    this.body.position.set(x, PHYSICS.playerRadius, z);
    this.body.previousPosition.copy(this.body.position);
    this.body.interpolatedPosition.copy(this.body.position);
    this.body.velocity.set(0, 0, 0);
    this.body.force.set(0, 0, 0);
    this.body.aabbNeedsUpdate = true;
    this.body.wakeUp();
    this.motor.reset();
    visit.physicsWorld.addBody(this.body);
    visit.scene.add(this.model);
    this.unregister = registerPhysicsActor(visit.physicsWorld, {
      body: this.body,
      beforePhysicsStep: dt => this.beforePhysicsStep(dt),
      afterPhysicsStep: () => this.afterPhysicsStep(),
    });
    this.syncModel();
  }

  private playAnimation(name: string, loop: boolean) {
    const next = this.actions.get(name);
    if (!next) { this.oneShotTime = 0; return; }
    // Stop clamped one-shots too; isRunning() is false once they finish.
    for (const action of this.actions.values()) action.stop();
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    this.action = next;
    this.oneShotTime = loop ? 0 : next.getClip().duration;
  }

  private playerFeet(visit: Visit) {
    const p = visit.player.body.position;
    return new THREE.Vector3(p.x, p.y - visit.player.radius, p.z);
  }

  private recordPlayer(visit: Visit, force = false) {
    if (!force && !visit.player.getState().isOnGround) return;
    const point = this.playerFeet(visit);
    const last = visit.trail[visit.trail.length - 1];
    if (force || !last || point.distanceTo(last) >= 0.25) visit.trail.push(point);
  }

  /** Record the player's walkable route; advance only the inactive NPC world here. */
  update(dt: number) {
    const active = this.active;
    if (!active || !active.player.isEnabled()) return;
    if (this.state === 'CHASING') {
      this.recordPlayer(active);
      if (active.npcSafeZone?.containsPoint(this.playerFeet(active))) this.disappear();
    }
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    if (this.owner && this.owner !== active) {
      this.accumulator += frame;
      while (this.accumulator >= PHYSICS.fixedStep && this.owner && this.owner !== active) {
        stepPhysicsWorld(this.owner.physicsWorld, PHYSICS.fixedStep);
        this.accumulator -= PHYSICS.fixedStep;
      }
    } else this.accumulator = 0;
  }

  beforePhysicsStep(dt: number) {
    if (!this.owner || !this.active?.player.isEnabled()) { this.motor.drive(0, 0, 0); return; }
    this.mixer?.update(dt);
    if (this.state === 'DYING') {
      this.motor.drive(0, 0, 0);
      this.deathTime -= dt;
      return;
    }
    if (this.oneShotTime > 0) {
      this.oneShotTime -= dt;
      if (this.oneShotTime <= 0) this.playAnimation(this.state === 'CHASING' ? 'Run' : 'Walk', true);
    }
    if (this.state === 'PACING') {
      const target = this.playerFeet(this.active);
      const close = Math.hypot(target.x - this.body.position.x, target.z - this.body.position.z) < this.triggerRadius;
      if (this.owner === this.active && close && Math.abs(target.y - this.model.position.y) < 1 && this.hasSight(target)) {
        this.state = 'CHASING';
        this.owner.trail = [target];
        this.playAnimation('Run', true);
      } else {
        if (Math.abs(this.body.position.x - this.paceDirection * 2) < 0.15) this.paceDirection *= -1;
        this.steer(new THREE.Vector3(this.paceDirection * 2, 0, 1), 0.7, dt);
        return;
      }
    }
    if (this.state !== 'CHASING') return;
    const trail = this.owner.trail;
    while (trail.length && Math.hypot(trail[0].x - this.body.position.x, trail[0].z - this.body.position.z) < 0.15 &&
      Math.abs(trail[0].y - (this.body.position.y - PHYSICS.playerRadius)) < 0.5) trail.shift();
    const target = trail[0] ?? (this.owner === this.active ? this.playerFeet(this.active) : null);
    const distanceToPlayer = this.owner === this.active ? this.body.position.distanceTo(this.active.player.body.position) : Infinity;
    const touchingPlayer = this.owner === this.active && trail.length <= 1 && distanceToPlayer < 0.7;
    if (target && !touchingPlayer) this.steer(target, this.chaseSpeed, dt);
    else this.motor.drive(0, 0, 0);
    // Legs pump faster as it closes in, telegraphing the charge before it strikes.
    if (this.oneShotTime <= 0) {
      this.action?.setEffectiveTimeScale(distanceToPlayer <= this.chargeRange ? this.chargeTimeScale : 1);
    }
    this.attackCooldown -= dt;
    if (this.attackCooldown <= 0 && this.oneShotTime <= 0 && this.owner === this.active) {
      if (distanceToPlayer <= this.meleeRange) {
        this.playAnimation('Attack', false);
        this.active.player.takeDamage(15);
        this.attackCooldown = 2.5 + this.random() * 2;
      } else if (distanceToPlayer <= this.shootRange && this.hasSight(this.playerFeet(this.active))) {
        this.playAnimation('AttackAuto', false);
        this.active.player.takeDamage(10);
        this.attackCooldown = 1.8 + this.random() * 1.5;
      } else {
        this.attackCooldown = 0.5;
      }
    }
  }

  afterPhysicsStep() {
    this.motor.readSupport();
    this.syncModel();
    if (this.state === 'DYING' && this.deathTime <= 0) {
      this.detach();
      this.model.visible = false;
      this.state = 'DISAPPEARED';
      this.releaseRetired();
      return;
    }
    const source = this.owner;
    if (this.state === 'CHASING' && source?.exit && source.trail.length === 0) {
      const { destination, entryZ } = source.exit;
      this.moveToWorld(destination, 0, entryZ);
      this.retired.delete(source);
      source.dispose();
    }
  }

  private steer(target: THREE.Vector3, speed: number, dt: number) {
    const dx = target.x - this.body.position.x;
    const dz = target.z - this.body.position.z;
    const distance = Math.hypot(dx, dz);
    this.motor.drive(dx, dz, Math.min(speed, distance / dt));
    if (distance > 0.01) {
      const angle = Math.atan2(dx, dz);
      const difference = Math.atan2(Math.sin(angle - this.model.rotation.y), Math.cos(angle - this.model.rotation.y));
      this.model.rotation.y += difference * (1 - Math.exp(-12 * dt));
    }
  }

  private syncModel() {
    this.model.position.set(this.body.position.x, this.body.position.y - PHYSICS.playerRadius, this.body.position.z);
  }

  private hasSight(target: THREE.Vector3) {
    let clear = true;
    this.owner?.physicsWorld.raycastAll(this.body.position, new CANNON.Vec3(target.x, target.y + PHYSICS.playerRadius, target.z),
      { skipBackfaces: true, checkCollisionResponse: true }, hit => {
        if (hit.body?.type === CANNON.Body.STATIC) clear = false;
      });
    return clear;
  }

  /** The gun can damage only this registered, living NPC in the active scene. */
  takeDamage(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0 || this.owner !== this.active ||
      (this.state !== 'CHASING' && this.state !== 'PACING')) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) this.disappear();
    else {
      if (this.state === 'PACING') {
        this.state = 'CHASING';
        this.owner!.trail = [this.playerFeet(this.active!)];
      }
      this.playAnimation('Hit', false);
    }
    return true;
  }

  getDamageTargets() {
    return this.owner === this.active && (this.state === 'PACING' || this.state === 'CHASING')
      ? [{ root: this.model, damage: (amount: number) => this.takeDamage(amount) }] : [];
  }

  private disappear() {
    if (this.state === 'DYING' || this.state === 'DISAPPEARED') return;
    this.state = 'DYING';
    this.body.velocity.set(0, 0, 0);
    this.playAnimation('TurnOff', false);
    this.deathTime = Math.max(0.3, this.oneShotTime);
    for (const visit of this.retired) visit.trail = [];
  }

  private releaseRetired() {
    for (const visit of this.retired) visit.dispose();
    this.retired.clear();
  }

  getStatus() {
    return { state: this.state, health: this.health, scene: this.owner?.id ?? null,
      position: this.body.position.clone(), animation: this.action?.getClip().name ?? null };
  }

  dispose() {
    this.disposed = true;
    this.detach();
    this.releaseRetired();
    this.mixer?.stopAllAction();
    this.active = null;
  }
}
