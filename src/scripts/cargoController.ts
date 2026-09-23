import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { registerPhysicsActor } from '../helpers/physics/scenePhysics.js';
import { disposeRoom, type PortalFrame } from '../helpers/scene/shipRoom.js';
import type { Player, PlayerTransitionState } from './player.js';
import type { DamageTarget } from './pistol.js';
import { CARGO, beltMoving, cargoPosition, laneX, removeCargo, type CargoPuzzleState, type CargoRecord, type CargoRoom } from './cargoPuzzle.js';
interface CargoObject extends DamageTarget { record: CargoRecord; root: THREE.Group; body: CANNON.Body; }
/** Stable cargo obstacles and an explicitly controlled, swept player/crate pair. */
export function createCargoController(scene: THREE.Scene, world: CANNON.World, player: Player, state: CargoPuzzleState, room: CargoRoom,
  onBreak?: (record: CargoRecord) => void) {
  const objects = new Map<string, CargoObject>();
  let held: CargoObject | null = null, disposed = false, highlighted = false;
  const offset = new CANNON.Vec3(), axis = new THREE.Vector3(0, 1, 0);
  const debris: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const shardGeometry = new THREE.BoxGeometry(0.25, 0.23, 0.28), shardMaterial = new THREE.MeshStandardMaterial({ color: 0xa17c4e });
  function release() {
    if (held) {
      const { x, y, z } = held.body.position;
      held.record.position = { x, y, z }; held.record.moving = false;
      held.body.type = CANNON.Body.STATIC; held.body.velocity.set(0, 0, 0); held.body.updateMassProperties();
    }
    held = null; player.setBoxHandling(false);
  }
  function destroy(id: string) {
    const item = objects.get(id); if (!item) return false;
    if (held === item) release();
    item.record.position = { ...item.body.position };
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(shardGeometry, shardMaterial); mesh.name = 'BreakableDebris'; mesh.position.copy(item.body.position); scene.add(mesh);
      debris.push({ mesh, velocity: new THREE.Vector3(Math.sin(i * 7) * 2, 1 + i * 0.1, Math.cos(i * 3) * 2), life: 1.4 });
    }
    removeCargo(state, id); onBreak?.(item.record); removeObject(item); return true;
  }
  function removeObject(item: CargoObject) {
    world.removeBody(item.body); item.root.removeFromParent(); disposeRoom(item.root as unknown as THREE.Scene); objects.delete(item.record.id);
  }
  function add(record: CargoRecord) {
    const root = new THREE.Group(); root.name = record.id; root.userData.breakableWeapon = record.breakable ? 'crowbar' : undefined;
    const material = new THREE.MeshStandardMaterial({ color: 0x517b8b, metalness: 0.6, roughness: 0.68 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), material); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
    const trim = new THREE.MeshStandardMaterial({ color: 0xcedee1, metalness: 0.6 });
    for (const x of [-0.48, 0.48]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.42, 1.42), trim); band.position.x = x; root.add(band); }
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.43, 0.1, 1.43), trim); root.add(band);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.7, 0.7, 0.7)), fixedRotation: true });
    body.position.copy(record.position as CANNON.Vec3); root.position.copy(body.position); world.addBody(body); scene.add(root);
    const item: CargoObject = { record, root, body, damage(amount, weapon) {
      return !disposed && record.breakable && weapon === 'crowbar' && Number.isFinite(amount) && amount > 0 ? destroy(record.id) : false;
    } };
    objects.set(record.id, item); return item;
  }
  function support(x: number, z: number, bottom: number, ignore: CANNON.Body, spread = 0.6) {
    let height = -Infinity;
    for (const [dx, dz] of [[0, 0], [-spread, -spread], [-spread, spread], [spread, -spread], [spread, spread]]) {
      world.raycastAll(new CANNON.Vec3(x + dx, bottom + 0.25, z + dz), new CANNON.Vec3(x + dx, bottom - 1, z + dz),
        { skipBackfaces: true, checkCollisionResponse: true }, hit => {
          if (hit.body !== ignore && hit.body !== player.body && hit.body?.type === CANNON.Body.STATIC && hit.hitNormalWorld.y > 0.8 && hit.hitPointWorld.y <= bottom + 0.21) height = Math.max(height, hit.hitPointWorld.y);
        });
    }
    return height;
  }
  function limitAxis(position: CANNON.Vec3, half: number, direction: 'x' | 'z', distance: number, ignore: CANNON.Body) {
    const other = direction === 'x' ? 'z' : 'x'; let allowed = distance;
    for (const body of world.bodies) {
      if (body === player.body || body === ignore || !body.collisionResponse || !(body.collisionFilterMask & player.body.collisionFilterGroup)) continue;
      if (body.aabbNeedsUpdate) body.updateAABB(); const { lowerBound: lo, upperBound: hi } = body.aabb;
      if (hi.y <= position.y - half + 0.025 || lo.y >= position.y + half - 0.02 || hi[other] <= position[other] - half + 0.005 || lo[other] >= position[other] + half - 0.005) continue;
      if (distance > 0 && position[direction] + half <= lo[direction] + 0.02) allowed = Math.min(allowed, Math.max(0, lo[direction] - position[direction] - half - 0.005));
      if (distance < 0 && position[direction] - half >= hi[direction] - 0.02) allowed = Math.max(allowed, Math.min(0, hi[direction] - position[direction] + half + 0.005));
    }
    return allowed;
  }
  function ejectFromMovingBelt() {
    if (room === 12 || !player.isEnabled() || player.getState().climbing ||
        !state.gravityRestored || (!beltMoving(state) && state.alignment <= 0)) return;
    const p = player.body.position, radius = player.radius;
    if (p.y < -0.2 || p.y - radius > CARGO.beltTop + 0.25) return;
    const transverse = room === 9 ? 'x' : 'z', longitudinal = room === 9 ? 'z' : 'x';
    const center = room === 9 ? laneX(p.x >= 0 ? 10 : 11, true) : CARGO.sideBeltZ;
    if (Math.abs(p[transverse] - center) > 1.05 + radius ||
        p[longitudinal] < (room === 9 ? -13.5 : -6.2) || p[longitudinal] > (room === 9 ? 11.6 : 6.2)) return;
    const inward = room === 9 ? -Math.sign(center) : -1;
    const alongLimit = room === 9 ? 11.5 : 5.1;
    // Move onto a clear interior aisle before scripted freight reaches the physics solver.
    for (const clearance of [1.6, 2.2, 2.8, 3.4]) {
      for (const along of [0, -0.75, 0.75, -1.5, 1.5, -2.25, 2.25]) {
        const target = p.clone(); target[transverse] = center + inward * clearance;
        target[longitudinal] = THREE.MathUtils.clamp(p[longitudinal] + along, -alongLimit, alongLimit);
        if (!Number.isFinite(support(target.x, target.z, p.y - radius, player.body, radius * 0.8))) continue;
        const blocked = world.bodies.some(body => {
          if (body === player.body || !body.collisionResponse || !(body.collisionFilterMask & player.body.collisionFilterGroup)) return false;
          if (body.aabbNeedsUpdate) body.updateAABB();
          const { lowerBound: lo, upperBound: hi } = body.aabb;
          return hi.y > target.y - radius + 0.025 && lo.y < target.y + radius &&
            hi.x > target.x - radius && lo.x < target.x + radius && hi.z > target.z - radius && lo.z < target.z + radius;
        });
        if (blocked) continue;
        release(); player.body.position.copy(target);
        player.body.previousPosition.copy(target); player.body.interpolatedPosition.copy(target);
        player.body.velocity.x = player.body.velocity.z = 0;
        player.body.aabbNeedsUpdate = true; player.body.wakeUp(); return;
      }
    }
  }
  const unregister = registerPhysicsActor(world, { body: player.body, beforePhysicsStep(dt) {
    ejectFromMovingBelt();
    if (!held) return;
    if (!player.isEnabled() || player.getHealth() <= 0 || !player.getState().isOnGround) { release(); return; }
    const p = player.body.position.clone(), b = held.body.position.clone();
    for (const direction of ['x', 'z'] as const) {
      const proposed = player.body.velocity[direction] * dt;
      let distance = limitAxis(b, CARGO.half, direction, proposed, held.body);
      distance = limitAxis(p, player.radius, direction, distance, held.body);
      const nextX = b.x + (direction === 'x' ? distance : 0), nextZ = b.z + (direction === 'z' ? distance : 0);
      const playerX = p.x + (direction === 'x' ? distance : 0), playerZ = p.z + (direction === 'z' ? distance : 0);
      if (!Number.isFinite(support(nextX, nextZ, b.y - 0.7, held.body)) ||
          !Number.isFinite(support(playerX, playerZ, p.y - player.radius, held.body, player.radius * 0.8))) distance = 0;
      player.body.velocity[direction] = held.body.velocity[direction] = distance / dt;
      p[direction] += distance; b[direction] += distance;
    }
    const floor = support(b.x, b.z, b.y - 0.7, held.body);
    held.body.velocity.y = Number.isFinite(floor) ? THREE.MathUtils.clamp((floor + 0.7 - b.y) / dt, -1.8, 1.8) : 0;
  }, afterPhysicsStep() {
    if (!held) return;
    const b = held.body.position; held.record.position = { x: b.x, y: b.y, z: b.z }; held.root.position.copy(b);
    held.record.moving = held.body.velocity.lengthSquared() > 0.001;
  } });
  function canGrab(item: CargoObject) {
    const p = player.body.position, b = item.body.position;
    return room !== 9 && state.handle !== 'carried' && player.isEnabled() && player.getHealth() > 0 && player.getState().isOnGround && b.y > 0.5 && b.y < 1.1 &&
      (item.record.mode !== 'belt' || !beltMoving(state)) && Math.hypot(b.x - p.x, b.z - p.z) <= 1.85;
  }
  function nearest() { return [...objects.values()].filter(canGrab).sort((a, b) => a.body.position.distanceTo(player.body.position) - b.body.position.distanceTo(player.body.position))[0]; }
  function grab(item: CargoObject, preserveFacing = false) {
    held = item; item.record.mode = 'parked'; item.record.moving = false;
    const { x, y, z } = item.body.position; item.record.position = { x, y, z };
    offset.copy(item.body.position.vsub(player.body.position));
    if (!preserveFacing) player.setRotation(Math.atan2(-offset.x, -offset.z), 0);
    item.body.type = CANNON.Body.KINEMATIC; item.body.updateMassProperties(); player.setBoxHandling(true);
  }
  function interact() { if (held) { release(); return true; } const item = nearest(); if (!item) return false; grab(item); return true; }
  function update(dt: number, floating = false) {
    if (disposed) return;
    if (held && (!player.isEnabled() || player.getHealth() <= 0)) release();
    const records = state.cargo.filter(item => item.room === room);
    for (const item of [...objects.values()]) if (!records.includes(item.record)) removeObject(item);
    records.forEach(record => { if (!objects.has(record.id)) add(record); });
    for (const item of objects.values()) {
      const { record, body, root } = item;
      if (item !== held && record.mode === 'belt' && !floating) {
        const target = cargoPosition(record, state);
        if (state.alignment > 0 && room === 9) { body.position.x = THREE.MathUtils.damp(body.position.x, target.x, 5, dt); body.position.y = THREE.MathUtils.damp(body.position.y, target.y, 5, dt); body.position.z = THREE.MathUtils.damp(body.position.z, target.z, 5, dt); }
        else body.position.set(target.x, target.y, target.z);
        body.quaternion.set(0, 0, 0, 1);
      } else if (item !== held && record.mode === 'parked') {
        const floor = support(body.position.x, body.position.z, body.position.y - 0.7, body);
        if (Number.isFinite(floor)) body.position.y = Math.max(floor + 0.7, body.position.y - dt * 2);
        else body.position.y -= dt * 2;
        record.moving = Number.isFinite(floor) ? Math.abs(body.position.y - floor - 0.7) > 0.02 : true;
        if (body.position.y < -8) { removeCargo(state, record.id); removeObject(item); continue; }
      }
      body.aabbNeedsUpdate = true; root.position.copy(body.position); root.quaternion.copy(body.quaternion);
      if (record.mode === 'parked') record.position = { x: body.position.x, y: body.position.y, z: body.position.z };
      const mat = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.color.setHex(highlighted && record.breakable ? 0xffd629 : 0x517b8b);
    }
    for (let i = debris.length - 1; i >= 0; i--) { const d = debris[i]; d.life -= dt; d.velocity.y -= dt * 9.82; d.mesh.position.addScaledVector(d.velocity, dt); d.mesh.position.y = Math.max(0.1, d.mesh.position.y); d.mesh.rotation.x += dt * 3; if (d.life <= 0) { d.mesh.removeFromParent(); debris.splice(i, 1); } }
  }
  function transfer(transition: PlayerTransitionState, frame: PortalFrame, destination: CargoRoom) {
    if (!held) return transition;
    const local = new THREE.Vector3().copy(held.body.position).sub(new THREE.Vector3(frame.x, frame.y, frame.z)).applyAxisAngle(axis, -frame.yaw);
    const relative = new THREE.Vector3().copy(held.body.position).sub(new THREE.Vector3().copy(player.body.position)).applyAxisAngle(axis, -frame.yaw);
    const playerClearance = 1.5 - player.radius - 0.05, cargoClearance = 1.5 - CARGO.half - 0.05;
    const position = { ...transition.position, x: THREE.MathUtils.clamp(transition.position.x,
      Math.max(-playerClearance, -cargoClearance - relative.x), Math.min(playerClearance, cargoClearance - relative.x)) };
    const id = held.record.id; held.record.room = destination; release();
    return { ...transition, position, cargo: { id, position: local, offset: relative } };
  }
  function accept(transition: PlayerTransitionState | undefined, frame: PortalFrame) {
    if (!transition?.cargo) return;
    const record = state.cargo.find(item => item.id === transition.cargo!.id); if (!record) return;
    const pos = new THREE.Vector3().copy(transition.cargo.offset).applyAxisAngle(axis, frame.yaw + Math.PI)
      .add(new THREE.Vector3().copy(player.body.position));
    record.room = room; record.position = { x: pos.x, y: pos.y, z: pos.z }; record.mode = 'parked';
    const item = objects.get(record.id) ?? add(record);
    item.body.position.set(pos.x, pos.y, pos.z); item.body.aabbNeedsUpdate = true;
    item.body.velocity.set(0, 0, 0); item.root.position.copy(pos);
    grab(item, true);
  }
  window.addEventListener('blur', release);
  update(0);
  return { objects, update, interact, release, transfer, accept, destroy,
    held: () => held, nearby: nearest,
    prompt: () => held ? 'E: release | WASD: move box' : nearest() ? 'E: grab stationary box' : '',
    getDamageTargets: () => [...objects.values()].filter(item => item.record.breakable),
    setHighlighted: (active: boolean) => { highlighted = active; },
    dispose() { if (disposed) return; disposed = true; release(); unregister(); window.removeEventListener('blur', release); for (const item of [...objects.values()]) removeObject(item); debris.forEach(d => d.mesh.removeFromParent()); shardGeometry.dispose(); shardMaterial.dispose(); },
  };
}
