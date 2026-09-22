import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { registerPhysicsActor } from '../helpers/physics/scenePhysics.js';
import type { Player } from './player.js';
import type { DamageTarget } from './pistol.js';

export const BOSS_RULES = Object.freeze({ health: 420, headDamage: 35, headCooldown: 1,
  exposedSeconds: 10, laserSpeed: 14, laserDamage: 12, chargeSeconds: 0.8, shotInterval: 1.8 });
export type BossPhase = 'dormant' | 'flying' | 'falling' | 'exposed' | 'rising' | 'defeated';

/** Scene-owned, stationary hover boss. Its attack simulation uses the world's fixed clock. */
export function createLoadingBayBoss(scene: THREE.Scene, world: CANNON.World, player: Player, onDefeated: () => void) {
  const root = new THREE.Group(); root.name = 'LoadingBayBoss'; scene.add(root);
  const armor = new THREE.MeshStandardMaterial({ color: 0x25333e, metalness: 0.8, roughness: 0.42 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x637681, metalness: 0.6, roughness: 0.5 });
  const core = new THREE.MeshStandardMaterial({ color: 0x697980, metalness: 0.65, roughness: 0.4 });
  const targetMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e5ce, emissive: 0x587c5b, emissiveIntensity: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff2828, emissive: 0xff1515, emissiveIntensity: 0.85 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd126, emissive: 0xffb300, emissiveIntensity: 0.9 });
  const green = new THREE.MeshBasicMaterial({ color: 0x59ff79 });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const bodies: Array<{ mesh: THREE.Mesh; body: CANNON.Body }> = [];
  function block(name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, solid = true) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.scale.set(...size); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    if (solid) {
      const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
      world.addBody(body); bodies.push({ mesh, body });
    }
    return mesh;
  }
  const torso = block('BossTorso', [3.6, 3.2, 2], [0, 5.3, 0], armor);
  const head = block('BossHead', [1.6, 1.6, 1.6], [0, 7.75, 0.25], core);
  head.userData.breakableWeapon = 'crowbar';
  const visor = block('BossVisor', [1.3, 0.16, 0.05], [0, 7.85, 1.07], green, false);
  head.add(visor); visor.position.set(0, 0.0625, 0.515); visor.scale.divideScalar(1.6);
  const limbs = [-1, 1].flatMap(side => [
    block('BossShoulder', [1.4, 1.7, 1.7], [side * 2.6, 6, -0.1], trim),
    block('BossCannon', [1.2, 2.2, 1.6], [side * 2.8, 4.2, 0.1], armor),
    block('BossLeg', [1.1, 1.6, 1.4], [side * 1.1, 2.8, -0.25], trim),
  ]);
  const muzzles = [-1, 1].map(side => block('LaserMuzzle', [0.65, 0.65, 0.08], [side * 2.8, 4.1, 0.95], green, false));
  const thrusters = [-1, 1].map(side => block('BossThruster', [0.6, 0.8, 0.6], [side * 1.1, 1.6, -0.25], green, false));
  let phase: BossPhase = 'dormant', health = BOSS_RULES.health as number, round = 1, remaining = 0;
  let phaseTime = 0, elapsed = 0, shotClock = 0, headCooldown = 0, scanning = false, disposed = false, muzzleIndex = 0;
  const chargedAim = new THREE.Vector3();
  let charging = false;
  const bolts: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const fragments: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const shardMaterial = new THREE.MeshStandardMaterial({ color: 0x718c80, roughness: 0.6 });

  function burst(mesh: THREE.Mesh) {
    const center = mesh.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 14; i++) {
      const shard = new THREE.Mesh(geometry, shardMaterial); shard.name = 'BreakableDebris'; shard.scale.setScalar(0.12 + Math.random() * 0.12);
      shard.position.copy(center); scene.add(shard);
      fragments.push({ mesh: shard, life: 2, velocity: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4) });
    }
  }
  const targets = [-1, 1].flatMap(x => [-1, 1].map(y => {
    const mesh = block(`BossTarget-${x}-${y}`, [0.9, 0.9, 0.18], [x * 1.15, 5.3 + y * 0.9, 1.14], targetMaterial, false);
    mesh.userData.breakableWeapon = 'pistol';
    // The inset cross belongs to the same target, so it can never occlude its hit surface.
    const cross = new THREE.Mesh(geometry, green); cross.scale.set(0.16, 0.65, 0.2); cross.position.z = 0.55; mesh.add(cross);
    let hits = 1;
    const target: DamageTarget = { root: mesh, damage(amount, weapon) {
      if (disposed || phase !== 'flying' || !player.isEnabled() || weapon !== 'pistol' || hits <= 0 || !Number.isFinite(amount) || amount <= 0) return false;
      hits--; cross.visible = false;
      if (!hits) {
        burst(mesh); mesh.visible = false;
        if (targets.every(t => t.hits() === 0)) { phase = 'falling'; phaseTime = 0; clearBolts(); }
      }
      return true;
    } };
    return { ...target, mesh, hits: () => hits, reset() { hits = round === 1 ? 1 : 2; mesh.visible = true; cross.visible = true; } };
  }));
  const headTarget: DamageTarget = { root: head, body: bodies.find(p => p.mesh === head)!.body, damage(amount, weapon) {
    if (disposed || phase !== 'exposed' || !player.isEnabled() || weapon !== 'crowbar' || headCooldown > 0 || !Number.isFinite(amount) || amount <= 0) return false;
    health = Math.max(0, health - BOSS_RULES.headDamage); headCooldown = BOSS_RULES.headCooldown; burst(head);
    if (!health) {
      phase = 'defeated'; root.visible = false; clearBolts();
      for (const { body } of bodies) if (body.world === world) world.removeBody(body);
      onDefeated();
    }
    return true;
  } };
  function clearBolts() { for (const bolt of bolts) bolt.mesh.removeFromParent(); bolts.length = 0; charging = false; }
  const neutral = new Map([...limbs, torso, ...muzzles, ...thrusters, ...targets.map(t => t.mesh)].map(mesh => [mesh, mesh.position.clone()]));
  function pose(drop: number) {
    for (const [mesh, p] of neutral) { mesh.position.copy(p); mesh.position.y -= drop * (mesh.name === 'BossLeg' ? 2 : 2.65); }
    head.position.set(0, THREE.MathUtils.lerp(7.75, 1, drop), THREE.MathUtils.lerp(0.25, 2.8, drop));
    thrusters.forEach(t => { t.visible = phase === 'flying' || phase === 'dormant' || phase === 'rising'; });
    head.material = scanning && phase === 'exposed' ? yellow : core;
    core.emissive.setHex(headCooldown > 0.65 ? 0xffffff : 0x000000);
    root.updateMatrixWorld(true);
    for (const { mesh, body } of bodies) {
      const p = mesh.getWorldPosition(new THREE.Vector3()), q = mesh.getWorldQuaternion(new THREE.Quaternion());
      body.position.set(p.x, p.y, p.z); body.quaternion.set(q.x, q.y, q.z, q.w); body.aabbNeedsUpdate = true;
    }
  }
  function fire() {
    const from = muzzles[muzzleIndex++ % 2].getWorldPosition(new THREE.Vector3());
    const direction = chargedAim.clone().sub(from).normalize();
    const mesh = new THREE.Mesh(geometry, green); mesh.name = 'BossLaser'; mesh.scale.set(0.12, 0.12, 1.2);
    mesh.position.copy(from); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); scene.add(mesh);
    bolts.push({ mesh, velocity: direction.multiplyScalar(BOSS_RULES.laserSpeed), life: 5 });
  }
  function stepBolts(dt: number) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i], from = bolt.mesh.position.clone(), to = from.clone().addScaledVector(bolt.velocity, dt);
      // Sweep the full frame segment; pillars/walls win over the player's body, even at low FPS.
      let distance = Infinity, hitPlayer = false;
      world.raycastAll(new CANNON.Vec3(from.x, from.y, from.z), new CANNON.Vec3(to.x, to.y, to.z), { skipBackfaces: false }, hit => {
        if (!hit.body || bodies.some(part => part.body === hit.body) || !hit.body.collisionResponse || hit.distance >= distance) return;
        distance = hit.distance; hitPlayer = hit.body === player.body;
      });
      bolt.life -= dt;
      if (distance !== Infinity || bolt.life <= 0) {
        if (hitPlayer) player.takeDamage(BOSS_RULES.laserDamage);
        bolt.mesh.removeFromParent(); bolts.splice(i, 1);
      } else bolt.mesh.position.copy(to);
    }
  }
  function update(dt: number) {
    if (disposed) return;
    elapsed += dt; phaseTime += dt; headCooldown = Math.max(0, headCooldown - dt);
    for (let i = fragments.length - 1; i >= 0; i--) {
      const shard = fragments[i]; shard.life -= dt; shard.velocity.y -= 9.82 * dt; shard.mesh.position.addScaledVector(shard.velocity, dt);
      if (shard.mesh.position.y < 0.1) { shard.mesh.position.y = 0.1; shard.velocity.set(0, 0, 0); }
      if (shard.life < 0.5) shard.mesh.scale.multiplyScalar(Math.exp(-7 * dt));
      if (shard.life <= 0) { shard.mesh.removeFromParent(); fragments.splice(i, 1); }
    }
    if (phase === 'defeated') return;
    if (phase === 'flying' || phase === 'dormant' || phase === 'rising') {
      root.rotation.y = Math.atan2(player.body.position.x, player.body.position.z);
    }
    root.position.y = phase === 'flying' || phase === 'dormant' ? Math.sin(elapsed * 1.6) * 0.18 : 0;
    if (phase === 'falling' && phaseTime >= 0.85) { phase = 'exposed'; phaseTime = 0; remaining = BOSS_RULES.exposedSeconds; }
    else if (phase === 'exposed') {
      remaining = Math.max(0, BOSS_RULES.exposedSeconds - phaseTime);
      if (remaining <= 1e-7) { phase = 'rising'; phaseTime = 0; remaining = 0; }
    } else if (phase === 'rising' && phaseTime >= 1.2) {
      round++; targets.forEach(t => t.reset()); phase = 'flying'; phaseTime = 0; shotClock = 0;
    }
    pose(phase === 'falling' ? Math.min(1, (phaseTime / 0.85) ** 2) : phase === 'exposed' ? 1 : phase === 'rising' ? Math.max(0, 1 - phaseTime / 1.2) : 0);
    if (phase === 'flying' && player.isEnabled() && player.getHealth() > 0) {
      shotClock += dt;
      if (!charging && shotClock >= BOSS_RULES.shotInterval - BOSS_RULES.chargeSeconds) {
        charging = true; chargedAim.copy(player.body.position);
      }
      muzzles.forEach(m => m.scale.setScalar(charging ? 0.8 + Math.sin(elapsed * 28) * 0.15 : 0.65));
      if (shotClock >= BOSS_RULES.shotInterval) { fire(); shotClock = 0; charging = false; }
    }
    stepBolts(dt);
  }
  pose(0);
  const unregister = registerPhysicsActor(world, { body: bodies[0].body, beforePhysicsStep: update, afterPhysicsStep() {} });
  return {
    root, head, targets, headTarget,
    start() { if (phase === 'dormant') { phase = 'flying'; phaseTime = 0; shotClock = 0; } },
    getDamageTargets: (): DamageTarget[] => phase === 'flying' ? targets.filter(t => t.hits() > 0) : phase === 'exposed' ? [headTarget] : [],
    setGogglesActive(active: boolean) { scanning = active; for (const t of targets) t.mesh.material = active ? red : targetMaterial; head.material = active && phase === 'exposed' ? yellow : core; },
    getStatus: () => ({ phase, health, maxHealth: BOSS_RULES.health, round, remaining, targets: targets.map(t => t.hits()), charging, projectiles: bolts.length }),
    dispose() {
      if (disposed) return; disposed = true; unregister(); clearBolts(); fragments.forEach(f => f.mesh.removeFromParent());
      for (const { body } of bodies) if (body.world === world) world.removeBody(body);
      root.removeFromParent(); geometry.dispose();
      for (const material of [armor, trim, core, targetMaterial, red, yellow, green, shardMaterial]) material.dispose();
    },
  };
}
