import * as THREE from 'three';

/**
 * Example player script.
 *
 * This shows the pattern for a player controller.
 * Replace the orbit controls with this kind of first-person movement later.
 */
export class Player {
  public mesh: THREE.Mesh;
  public speed: number = 5;

  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();

  // Key state
  private keys: Record<string, boolean> = {};

  constructor() {
    const geometry = new THREE.CapsuleGeometry(0.4, 1, 4, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      roughness: 0.3,
      metalness: 0.7,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, 1, 5);
    this.mesh.castShadow = true;

    this.setupInput();
  }

  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  /**
   * Update player movement based on input.
   * @param dt - Delta time in seconds
   */
  update(dt: number): void {
    this.direction.set(0, 0, 0);

    if (this.keys['KeyW'] || this.keys['ArrowUp']) this.direction.z -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) this.direction.z += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.direction.x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) this.direction.x += 1;

    if (this.direction.length() > 0) {
      this.direction.normalize();
    }

    this.velocity.lerp(this.direction.multiplyScalar(this.speed), 0.1);
    this.mesh.position.addScaledVector(this.velocity, dt);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
