import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { DamageTarget, DamageWeapon } from '../weapons/pistol.js';
import { BreakableMaterial } from './breakableMaterial.js';

export interface Breakable extends DamageTarget {
  id: string;
  weapon: DamageWeapon;
  body: CANNON.Body;
  broken: boolean;
  material: BreakableMaterial;
  hitsRemaining: number;
}

interface BreakableOptions {
  hits?: number;
  showBox?: boolean;
  decorate?: (root: THREE.Group, material: BreakableMaterial) => void;
}

export function createBreakableDebris(scene: THREE.Scene, color = 0x998575) {
  const debris: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  function clear() { for (const piece of debris) piece.mesh.removeFromParent(); debris.length = 0; }
  return {
    clear,
    emit(position: THREE.Vector3, size: THREE.Vector3) {
      for (let i = 0; i < 10; i++) {
        const shard = new THREE.Mesh(geometry, material);
        shard.name = 'BreakableDebris';
        shard.scale.set(size.x * 0.22, size.y * 0.22, size.z * 0.22);
        shard.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * size.x, (Math.random() - 0.5) * size.y, (Math.random() - 0.5) * size.z));
        scene.add(shard);
        debris.push({ mesh: shard, velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random(), (Math.random() - 0.5) * 3), life: 2 });
      }
    },
    update(dt: number) {
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
    },
    dispose() {
      clear(); geometry.dispose(); material.dispose();
    },
  };
}

/** Scene-owned destructibles: collider, hit target, scan material, and short-lived debris. */
export function createBreakables(scene: THREE.Scene, world: CANNON.World) {
  const objects: Breakable[] = [];
  const debris = createBreakableDebris(scene);
  let disposed = false;
  let scanning = false;

  function add(id: string, weapon: DamageWeapon, position: THREE.Vector3, size: THREE.Vector3,
    onBreak?: (id: string) => void, options: BreakableOptions = {}): Breakable {
    const hits = options.hits ?? 1;
    if (!Number.isInteger(hits) || hits < 1) throw new Error('Breakables require a positive integer hit count');
    const root = new THREE.Group();
    root.name = id;
    root.position.copy(position);
    root.userData.breakableWeapon = weapon;
    const material = new BreakableMaterial(weapon);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = options.showBox !== false; root.add(mesh);
    const trim = new THREE.MeshStandardMaterial({ color: weapon === 'pistol' ? 0xe1e8e9 : 0x342f29, metalness: 0.35, roughness: 0.65 });
    if (options.showBox !== false && weapon !== 'pistol') {
      for (const x of [-0.32, 0.32]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.08, size.y * 1.015, size.z * 1.015), trim);
        band.position.x = size.x * x; root.add(band);
      }
    } else if (options.showBox !== false) {
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
    options.decorate?.(root, material);
    if (options.showBox === false) trim.dispose();
    scene.add(root);
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
    body.position.set(position.x, position.y, position.z);
    world.addBody(body);
    const item: Breakable = {
      id, root, body, weapon, material, broken: false, hitsRemaining: hits,
      damage(amount, usedWeapon) {
        const matchesWeapon = usedWeapon === weapon;
        if (disposed || item.broken || !matchesWeapon || !Number.isFinite(amount) || amount <= 0) return false;
        item.hitsRemaining--;
        material.hit(hits - item.hitsRemaining);
        if (item.hitsRemaining > 0) return true;
        item.broken = true;
        root.removeFromParent();
        world.removeBody(body);
        debris.emit(root.getWorldPosition(new THREE.Vector3()), size);
        onBreak?.(id);
        return true;
      },
    };
    objects.push(item);
    root.userData.breakableHits = hits;
    if (scanning) setHighlighted(true);
    return item;
  }

  function setHighlighted(active: boolean) {
    if (disposed) return;
    scanning = active;
    for (const item of objects) item.material.setHighlighted(active);
  }

  function update(dt: number) {
    debris.update(dt);
    for (const item of objects) item.material.update(Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0);
  }

  function restoreBroken(ids: ReadonlySet<string>) {
    for (const item of objects) if (ids.has(item.id) && !item.broken) {
      item.broken = true; item.root.removeFromParent();
      item.hitsRemaining = 0;
      if (item.body.world === world) world.removeBody(item.body);
    }
  }

  function reset() {
    if (disposed) return;
    debris.clear();
    for (const item of objects) {
      item.broken = false; item.hitsRemaining = item.root.userData.breakableHits;
      item.material.reset(); scene.add(item.root);
      if (item.body.world !== world) world.addBody(item.body);
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
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(mat => materials.add(mat));
      });
    }
    debris.dispose();
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }

  return { add, objects, getDamageTargets: () => objects.filter(item => !item.broken),
    remaining: () => objects.filter(item => !item.broken).length, restoreBroken, reset, setHighlighted, update, dispose };
}
