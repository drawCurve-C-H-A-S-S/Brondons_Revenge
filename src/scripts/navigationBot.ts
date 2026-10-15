import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS } from '../helpers/physics/scenePhysics.js';

export interface BotWaypoint {
  position: THREE.Vector3;
  action?: 'attack' | 'wait' | 'jump';
  actionDelay?: number;
  condition?: (bot: NavigationBot) => boolean;
}

export class NavigationBot {
  public body: CANNON.Body;
  public mesh: THREE.Group;
  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public onGround: boolean;
  public health: number;

  private moveSpeed = 4.2;
  private jumpSpeed = 5.5;
  private radius = 0.3;
  private eyeHeight = 1.6;
  private waypoints: BotWaypoint[];
  private currentWaypoint = 0;
  private attackCooldown = 0;
  private waitTimer = 0;

  constructor(scene: THREE.Scene, world: CANNON.World, startPosition: THREE.Vector3) {
    this.position = startPosition.clone();
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.health = 100;
    this.waypoints = [];

    // Create physics body (same as player)
    this.body = new CANNON.Body({
      mass: 70, // kg, similar to player
      position: new CANNON.Vec3(startPosition.x, startPosition.y, startPosition.z),
      shape: new CANNON.Sphere(this.radius),
      linearDamping: 0.1,
      angularDamping: 0.9,
    });
    this.body.fixedRotation = true;
    world.addBody(this.body);

    // Create visual representation
    this.mesh = new THREE.Group();
    const bodyMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(this.radius, this.eyeHeight - this.radius * 2, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00aa44, emissiveIntensity: 0.5 })
    );
    bodyMesh.position.y = this.eyeHeight / 2;
    this.mesh.add(bodyMesh);

    // Add a light to make it visible
    const light = new THREE.PointLight(0x00ff88, 5, 8);
    light.position.y = this.eyeHeight;
    this.mesh.add(light);

    this.mesh.position.copy(startPosition);
    scene.add(this.mesh);
  }

  setWaypoints(waypoints: BotWaypoint[]) {
    this.waypoints = waypoints;
    this.currentWaypoint = 0;
  }

  private getTargetPosition(): THREE.Vector3 | null {
    if (this.currentWaypoint >= this.waypoints.length) return null;
    return this.waypoints[this.currentWaypoint].position;
  }

  private updateMovement(dt: number, target: THREE.Vector3) {
    const direction = new THREE.Vector3().subVectors(target, this.position);
    direction.y = 0;
    const distance = direction.length();

    if (distance < 0.5) {
      // Reached waypoint
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
      return;
    }

    direction.normalize();

    // Apply movement force
    const speed = this.moveSpeed;
    this.velocity.x = direction.x * speed;
    this.velocity.z = direction.z * speed;

    // Jump if needed (simple heuristic: if target is higher)
    if (target.y > this.position.y + 0.5 && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }
  }

  private updatePhysics(dt: number) {
    // Apply gravity
    this.velocity.y += PHYSICS.gravity * dt;

    // Update position
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // Update cannon body
    this.body.position.set(this.position.x, this.position.y, this.position.z);
    this.body.velocity.set(this.velocity.x, this.velocity.y, this.velocity.z);

    // Update mesh
    this.mesh.position.copy(this.position);

    // Simple ground check
    if (this.position.y < this.radius + 0.1) {
      this.position.y = this.radius + 0.1;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Decay horizontal velocity
    this.velocity.x *= 0.95;
    this.velocity.z *= 0.95;
  }

  private checkWaypointAction(): boolean {
    if (this.currentWaypoint >= this.waypoints.length) return false;

    const waypoint = this.waypoints[this.currentWaypoint];
    const distance = this.position.distanceTo(waypoint.position);

    if (distance > 1.0) return false;

    // Check condition
    if (waypoint.condition && !waypoint.condition(this)) {
      return false;
    }

    // Perform action
    if (waypoint.action === 'wait') {
      this.waitTimer = waypoint.actionDelay || 1.0;
    } else if (waypoint.action === 'attack') {
      if (this.attackCooldown <= 0) {
        this.attackCooldown = 0.35; // Same as crowbar cooldown
        return true; // Signal that attack should happen
      }
    } else if (waypoint.action === 'jump' && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }

    return false;
  }

  advanceWaypoint() {
    this.currentWaypoint++;
  }

  getCurrentWaypoint(): BotWaypoint | null {
    if (this.currentWaypoint >= this.waypoints.length) return null;
    return this.waypoints[this.currentWaypoint];
  }

  isComplete(): boolean {
    return this.currentWaypoint >= this.waypoints.length;
  }

  update(dt: number): { attack: boolean; targetPosition: THREE.Vector3 | null } {
    // Update cooldowns
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      return { attack: false, targetPosition: null };
    }

    const target = this.getTargetPosition();
    let shouldAttack = false;

    if (target) {
      this.updateMovement(dt, target);
      shouldAttack = this.checkWaypointAction();
    }

    this.updatePhysics(dt);

    return { attack: shouldAttack, targetPosition: target };
  }

  dispose(scene: THREE.Scene, world: CANNON.World) {
    scene.remove(this.mesh);
    world.removeBody(this.body);
  }
}
