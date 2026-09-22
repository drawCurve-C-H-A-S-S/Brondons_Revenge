import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { DamageTarget, DamageWeapon } from './pistol.js';

export interface Breakable extends DamageTarget {
  id: string;
  weapon: DamageWeapon;
  body: CANNON.Body;
  broken: boolean;
}

/** Scene-owned destructibles: collider, hit target, scan material, and short-lived debris. */
export function createBreakables(scene: THREE.Scene, world: CANNON.World) {
  const objects: Breakable[] = [];
  const debris: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const red = new THREE.MeshStandardMaterial({ color: 0xff2424, emissive: 0xff0808, emissiveIntensity: 0.65 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd629, emissive: 0xffb800, emissiveIntensity: 0.6 });
  const shardGeometry = new THREE.BoxGeometry(1, 1, 1);
  const shardMaterial = new THREE.MeshStandardMaterial({ color: 0x998575, roughness: 0.9 });
  let disposed = false;
  let scanning = false;

  function add(id: string, weapon: DamageWeapon, position: THREE.Vector3, size: THREE.Vector3,
    onBreak?: (id: string) => void): Breakable {
    const root = new THREE.Group();
    root.name = id;
    root.position.copy(position);
    root.userData.breakableWeapon = weapon;
    const material = new THREE.MeshStandardMaterial({ color: weapon === 'pistol' ? 0x71828b : 0x8a6742, roughness: 0.72 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    const trim = new THREE.MeshStandardMaterial({ color: weapon === 'pistol' ? 0xe1e8e9 : 0x342f29, metalness: 0.35, roughness: 0.65 });
    if (weapon === 'crowbar') {
      for (const x of [-0.32, 0.32]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.08, size.y * 1.015, size.z * 1.015), trim);
        band.position.x = size.x * x; root.add(band);
      }
    } else {
      // Thin targets face inward; a contrasting cross is visible without the goggles.
      const sideWall = size.x < size.z;
      for (const vertical of [true, false]) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(
          sideWall ? size.x + 0.01 : size.x * (vertical ? 0.13 : 0.7),
          size.y * (vertical ? 0.7 : 0.13),
          sideWall ? size.z * (vertical ? 0.13 : 0.7) : size.z + 0.01), trim);
        root.add(cross);
      }
    }
    scene.add(root);
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
    body.position.set(position.x, position.y, position.z);
    world.addBody(body);
    const item: Breakable = {
      id, root, body, weapon, broken: false,
      damage(amount, usedWeapon) {
        if (disposed || item.broken || usedWeapon !== weapon || !Number.isFinite(amount) || amount <= 0) return false;
        item.broken = true;
        root.removeFromParent();
        world.removeBody(body);
        for (let i = 0; i < 10; i++) {
          const shard = new THREE.Mesh(shardGeometry, shardMaterial);
          shard.name = 'BreakableDebris';
          shard.scale.set(size.x * 0.22, size.y * 0.22, size.z * 0.22);
          shard.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * size.x, (Math.random() - 0.5) * size.y, (Math.random() - 0.5) * size.z));
          scene.add(shard);
          debris.push({ mesh: shard, velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random(), (Math.random() - 0.5) * 3), life: 2 });
        }
        onBreak?.(id);
        return true;
      },
    };
    root.traverse(node => { if (node instanceof THREE.Mesh) originals.set(node, node.material); });
    objects.push(item);
    if (scanning) setHighlighted(true);
    return item;
  }

  function setHighlighted(active: boolean) {
    if (disposed) return;
    scanning = active;
    for (const item of objects) item.root.traverse(node => {
      if (node instanceof THREE.Mesh) node.material = active ? (item.weapon === 'pistol' ? red : yellow) : originals.get(node)!;
    });
  }

  function update(dt: number) {
    dt = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    for (let i = debris.length - 1; i >= 0; i--) {
      const piece = debris[i];
      piece.life -= dt;
      piece.velocity.y -= 9.82 * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      if (piece.mesh.position.y < 0.06) { piece.mesh.position.y = 0.06; piece.velocity.set(0, 0, 0); }
      piece.mesh.rotation.x += dt * 2; piece.mesh.rotation.z += dt;
      if (piece.life < 0.5) piece.mesh.scale.multiplyScalar(Math.exp(-6 * dt));
      if (piece.life <= 0) { piece.mesh.removeFromParent(); debris.splice(i, 1); }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const item of objects) {
      item.root.removeFromParent();
      if (item.body.world === world) world.removeBody(item.body);
      item.root.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        geometries.add(node.geometry);
        const original = originals.get(node)!;
        (Array.isArray(original) ? original : [original]).forEach(mat => materials.add(mat));
      });
    }
    debris.forEach(piece => piece.mesh.removeFromParent()); debris.length = 0;
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    originals.clear(); red.dispose(); yellow.dispose(); shardGeometry.dispose(); shardMaterial.dispose();
  }

  return { add, objects, getDamageTargets: () => objects.filter(item => !item.broken),
    remaining: () => objects.filter(item => !item.broken).length, setHighlighted, update, dispose };
}
