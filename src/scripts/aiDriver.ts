import * as THREE from 'three';
import type { Player } from './player.js';

export interface AIWaypoint {
  position: THREE.Vector3;
  action?: 'attack' | 'wait' | 'look';
  actionDelay?: number;
  lookTarget?: THREE.Vector3;
  condition?: (ai: AIDriver) => boolean;
}

export class AIDriver {
  private player: Player;
  private waypoints: AIWaypoint[];
  private currentWaypoint = 0;
  private attackCooldown = 0;
  private waitTimer = 0;
  private active = false;

  constructor(player: Player) {
    this.player = player;
    this.waypoints = [];
  }

  setWaypoints(waypoints: AIWaypoint[]) {
    this.waypoints = waypoints;
    this.currentWaypoint = 0;
  }

  activate() {
    this.active = true;
  }

  deactivate() {
    this.active = false;
    this.clearInput();
  }

  isActive() {
    return this.active;
  }

  isComplete() {
    return this.currentWaypoint >= this.waypoints.length;
  }

  getCurrentWaypoint(): AIWaypoint | null {
    if (this.currentWaypoint >= this.waypoints.length) return null;
    return this.waypoints[this.currentWaypoint];
  }

  advanceWaypoint() {
    this.currentWaypoint++;
  }

  private clearInput() {
    // Clear all keys by simulating keyup events
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'];
    for (const key of keys) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: key }));
    }
  }

  private setKey(code: string, pressed: boolean) {
    const event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', { 
      code,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
  }

  private updateMovement(target: THREE.Vector3, dt: number) {
    const playerPos = this.player.body.position;
    const direction = new THREE.Vector3().subVectors(target, new THREE.Vector3(playerPos.x, 0, playerPos.z));
    direction.y = 0;
    const distance = direction.length();

    if (distance < 0.5) {
      // Reached waypoint
      this.clearInput();
      return;
    }

    direction.normalize();

    // Get player's current yaw to convert world direction to local direction
    const state = this.player.getState();
    const yaw = state.yaw;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);

    // Convert world direction to local forward/right
    const forward = direction.x * (-sinY) + direction.z * (-cosY);
    const right = direction.x * cosY + direction.z * (-sinY);

    // Set movement keys
    this.setKey('KeyW', forward > 0.3);
    this.setKey('KeyS', forward < -0.3);
    this.setKey('KeyD', right > 0.3);
    this.setKey('KeyA', right < -0.3);

    // Sprint if distance is large
    this.setKey('ShiftLeft', distance > 5);

    // Jump if target is higher (stairs/ledges)
    // For stairs: jump when approaching a step that's higher than current position
    const heightDiff = target.y - playerPos.y;
    if (heightDiff > 0.3 && state.isOnGround) {
      this.setKey('Space', true);
      setTimeout(() => this.setKey('Space', false), 100);
    }
  }

  private updateCamera(lookTarget: THREE.Vector3) {
    const playerPos = this.player.body.position;
    const eyePos = new THREE.Vector3(playerPos.x, playerPos.y + 1.6, playerPos.z);
    const direction = new THREE.Vector3().subVectors(lookTarget, eyePos);

    // Calculate yaw and pitch
    const yaw = Math.atan2(-direction.x, -direction.z);
    const pitch = Math.atan2(direction.y, Math.sqrt(direction.x * direction.x + direction.z * direction.z));

    // Set camera rotation using the player's setRotation method
    this.player.setRotation(yaw, pitch);
  }

  update(dt: number): { attack: boolean } {
    if (!this.active) return { attack: false };

    // Debug: log first few frames
    if (this.attackCooldown === 0 && this.waitTimer === 0) {
      console.log('[AIDriver] update called, active:', this.active, 'waypoint:', this.currentWaypoint, 'dt:', dt.toFixed(3));
    }

    // Update cooldowns
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      return { attack: false };
    }

    const waypoint = this.getCurrentWaypoint();
    if (!waypoint) return { attack: false };

    // Check condition
    if (waypoint.condition && !waypoint.condition(this)) {
      return { attack: false };
    }

    // Handle different action types
    if (waypoint.action === 'wait') {
      this.waitTimer = waypoint.actionDelay || 1.0;
      this.clearInput();
      return { attack: false };
    }

    if (waypoint.action === 'look' && waypoint.lookTarget) {
      this.updateCamera(waypoint.lookTarget);
      return { attack: false };
    }

    // Move toward waypoint
    this.updateMovement(waypoint.position, dt);

    // Look at waypoint
    this.updateCamera(waypoint.position);

    // Check if reached waypoint
    const playerPos = this.player.body.position;
    const distance = new THREE.Vector3(playerPos.x, 0, playerPos.z).distanceTo(
      new THREE.Vector3(waypoint.position.x, 0, waypoint.position.z)
    );

    let shouldAttack = false;
    if (distance < 1.0 && waypoint.action === 'attack') {
      if (this.attackCooldown <= 0) {
        shouldAttack = true;
        this.attackCooldown = 0.35; // Crowbar cooldown
      }
    }

    return { attack: shouldAttack };
  }

  dispose() {
    this.deactivate();
  }
}
