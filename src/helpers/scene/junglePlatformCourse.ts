import * as THREE from 'three';
import type { createScenePhysics } from '../physics/scenePhysics.js';

export type PlatformCheckpoint = 'bridge' | 'middle' | 'boss';
export interface PlatformProgress {
  checkpoint: PlatformCheckpoint;
  activatedRelays: string[];
  defeatedRobots: string[];
}
export const PLATFORM_COURSE = {
  startX: -42, depth: 17, end: 107, bossAt: 103,
  checkpoints: { bridge: { u: 0, top: 0.23 }, middle: { u: 53, top: 1.5 }, boss: { u: 93, top: 2.3 } },
} as const;
export const COURSE_PLATFORMS = [
  { id: 'bridge', from: -2.4, to: 7, top: 0.23 },
  { id: 'step1', from: 9, to: 15, top: 0.8 },
  { id: 'step2', from: 17, to: 24, top: 1.5 },
  { id: 'relay1', from: 24, to: 33, top: 1.5, relay: true },
  { id: 'landing1', from: 33, to: 39, top: 1.5 },
  { id: 'step3', from: 41, to: 48, top: 2.3 },
  { id: 'middle', from: 50, to: 59, top: 1.5 },
  { id: 'relay2', from: 59, to: 68, top: 1.5, relay: true },
  { id: 'landing2', from: 68, to: 75, top: 1.5 },
  { id: 'step4', from: 77, to: 82, top: 2.3 },
  { id: 'relay3', from: 82, to: 90, top: 2.3, relay: true },
  { id: 'boss-ledge', from: 90, to: 94, top: 2.3 },
  { id: 'arena', from: 94, to: 107, top: 1.3 },
] as const;
export const COURSE_ROBOTS = [
  { id: 'patrol1', platform: 'step1' }, { id: 'patrol2', platform: 'step2' },
  { id: 'patrol3', platform: 'landing1' }, { id: 'patrol4', platform: 'step3' },
  { id: 'patrol5', platform: 'middle' }, { id: 'patrol6', platform: 'landing2' },
  { id: 'patrol7', platform: 'step4' },
] as const;
export const courseX = (u: number) => PLATFORM_COURSE.startX - u;
export const courseDistance = (x: number) => PLATFORM_COURSE.startX - x;

/** Identical, deterministic scenery and collision geometry across the three jungle scenes. */
export function createJunglePlatformCourse(scene: THREE.Scene, physics: ReturnType<typeof createScenePhysics>, activated: readonly string[] = []) {
  const root = new THREE.Group(); root.name = 'JungleMaintenancePlatforms'; scene.add(root);
  const stone = new THREE.MeshStandardMaterial({ color: 0x677461, roughness: 0.95 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x806849, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x354e48, roughness: 0.65, metalness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xc8d68b, emissive: 0x607c34, emissiveIntensity: 0.4 });
  const bodies: ReturnType<typeof physics.addBox>[] = [];
  const relays: Array<{ id: string; root: THREE.Group; target: THREE.Mesh; material: THREE.MeshStandardMaterial;
    platform: THREE.Mesh<THREE.BoxGeometry>; body: ReturnType<typeof physics.addBox>; top: number; health: number; deployment: number; activated: boolean }> = [];
  function box(size: [number, number, number], position: [number, number, number], material: THREE.Material, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
    if (solid) bodies.push(physics.addBoxFromMesh(mesh));
    return mesh;
  }
  for (const platform of COURSE_PLATFORMS) {
    const width = platform.to - platform.from, x = courseX((platform.from + platform.to) / 2);
    const moving = 'relay' in platform;
    const depth = platform.id === 'arena' ? 16 : 3.2;
    const deck = box([width, 0.4, depth], [x, platform.top - 0.2, PLATFORM_COURSE.depth], moving ? steel : timber);
    deck.name = `PlatformDeck-${platform.id}`;
    const body = physics.addBoxFromMesh(deck); bodies.push(body);
    if (moving) {
      physics.world.removeBody(body);
      const relay = new THREE.Group(); relay.name = `PlatformRelay-${platform.id}`;
      relay.position.set(courseX(platform.from + 0.3), platform.top + 1.25, PLATFORM_COURSE.depth); root.add(relay);
      const material = new THREE.MeshStandardMaterial({ color: 0xffb955, emissive: 0xff8822, emissiveIntensity: 1 });
      const target = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), material); relay.add(target);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.06, 6, 20), stripe); ring.rotation.y = Math.PI / 2; relay.add(ring);
      const cable = box([width, 0.07, 0.08], [x, platform.top - 0.5, PLATFORM_COURSE.depth + 1.4], stripe);
      cable.name = `RelayLink-${platform.id}`;
      relays.push({ id: platform.id, root: relay, target, material, platform: deck, body, top: platform.top, health: 75, deployment: 0, activated: false });
      deck.position.y += 4;
    } else {
      for (const u of [platform.from + 0.4, platform.to - 0.4]) {
        box([0.35, platform.top + 4.5, 0.4], [courseX(u), (platform.top - 4.5) / 2, PLATFORM_COURSE.depth + 1.2], stone);
      }
      for (const edge of [-1, 1]) box([width, 0.08, 0.14], [x, platform.top + 0.04, PLATFORM_COURSE.depth + edge * (depth / 2 - 0.08)], stripe);
    }
  }
  // The final dry crossing reaches the existing downstream spawn without a water climb.
  box([3.2, 0.4, 7.6], [-146, 1.1, 13.6], timber, true);
  const ramp = physics.addStaircase({ width: 3.2, run: 5, rise: 1.3, position: { x: -146, y: 0, z: 5 }, material: timber });
  root.add(ramp.group); bodies.push(ramp.body);
  const dodgeLedges = [{ from: 95, to: 97 }, { from: 105.8, to: 107 }].map(({ from, to }, index) => {
    const ledge = box([to - from, 0.8, 3.2], [courseX((from + to) / 2), 1.7, PLATFORM_COURSE.depth], stone, true);
    ledge.name = `ArenaDodgeLedge-${index}`;
    return ledge;
  });
  const exitMarker = box([0.8, 0.025, 2.8], [-146, 1.315, PLATFORM_COURSE.depth], stripe);
  exitMarker.name = 'PlatformDryExit';
  const markers = Object.entries(PLATFORM_COURSE.checkpoints).map(([id, point]) => {
    const marker = box([0.15, 1.6, 0.15], [courseX(point.u), point.top + 0.8, PLATFORM_COURSE.depth + 1.3], stripe);
    marker.name = `PlatformCheckpoint-${id}`; return marker;
  });
  function activateRelay(id: string, instant = false) {
    const relay = relays.find(item => item.id === id); if (!relay) return false;
    relay.health = 0; relay.activated = true;
    relay.material.color.setHex(0x79ffac); relay.material.emissive.setHex(0x25a968);
    if (instant) relay.deployment = 1;
    return true;
  }
  function update(dt: number) {
    for (const relay of relays) {
      if (relay.activated) relay.deployment = Math.min(1, relay.deployment + dt / 1.1);
      relay.platform.position.y = relay.top - 0.2 + (1 - THREE.MathUtils.smootherstep(relay.deployment, 0, 1)) * 4;
      if (relay.deployment === 1 && !relay.body.world) physics.world.addBody(relay.body);
      relay.target.rotation.y += dt;
    }
  }
  activated.forEach(id => activateRelay(id, true)); update(0);
  return { root, bodies, relays, markers, dodgeLedges, activateRelay, update,
    damageRelay(id: string, amount: number) {
      const relay = relays.find(item => item.id === id);
      if (!relay || relay.activated || !Number.isFinite(amount) || amount <= 0) return false;
      relay.health = Math.max(0, relay.health - amount);
      if (!relay.health) activateRelay(id);
      return true;
    },
    getActivated: () => relays.filter(item => item.activated).map(item => item.id),
  };
}

/** The same model is launched in scene 17 and fought in scene 18. Scene owns disposal. */
export function createJungleScrambler(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'FacilitySidescrollScrambler'; scene.add(root);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x6fff9e, emissive: 0x27ef70, emissiveIntensity: 2, metalness: 0.45, roughness: 0.3 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), coreMaterial); root.add(core);
  const metal = new THREE.MeshStandardMaterial({ color: 0x394f4c, metalness: 0.85, roughness: 0.25 });
  const rings = [0, 1, 2].map(i => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85 + i * 0.13, 0.07, 8, 32), metal);
    ring.rotation.set(i * 0.9, i * 1.1, 0); root.add(ring); return ring;
  });
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x66ffa1, transparent: true, opacity: 0.15, depthWrite: false });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 20, 14), shieldMaterial); root.add(shield);
  const light = new THREE.PointLight(0x5bff98, 12, 9, 2); root.add(light);
  return { root, core, shield, update(dt: number, shielded = true) {
    rings.forEach((ring, index) => { ring.rotation.y += dt * (0.7 + index * 0.3); ring.rotation.z += dt * 0.4; });
    shield.visible = shielded;
  } };
}

/** Roof-mounted launch chamber; shared scenery keeps the facility recognizable after launch. */
export function createFacilityScramblerLauncher(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'FacilityScramblerLauncher'; root.position.set(0, 27.4, -58); scene.add(root);
  const armor = new THREE.MeshStandardMaterial({ color: 0x354247, metalness: 0.65, roughness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x9da9a4, metalness: 0.65, roughness: 0.4 });
  const charge = new THREE.MeshStandardMaterial({ color: 0x79ffac, emissive: 0x30ff80, emissiveIntensity: 0.2 });
  function panel(size: [number, number, number], position: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  panel([7.2, 0.5, 8.6], [0, -2.75, 0], armor);
  panel([7.2, 0.5, 8.6], [0, 2.75, 0], armor);
  panel([0.5, 5.5, 8.6], [-3.35, 0, 0], armor); panel([0.5, 5.5, 8.6], [3.35, 0, 0], armor);
  panel([6.2, 5.5, 0.4], [0, 0, -4.1], armor);
  for (const side of [-1, 1]) {
    panel([0.2, 5.2, 0.2], [side * 3, 0, 4.35], charge);
    panel([0.18, 0.18, 6.8], [side * 1.1, -1.1, 0], charge);
  }
  const shutters = [-1, 1].map(side => {
    const mesh = panel([3.1, 5, 0.35], [side * 1.55, 0, 4.35], trim);
    mesh.name = `FacilityLaunchShutter-${side}`; return { mesh, side };
  });
  const light = new THREE.PointLight(0x63ff98, 0, 16, 2); light.position.z = 3.8; root.add(light);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xc5ffdb, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.6, 32), flashMaterial); flash.position.z = 4.6; flash.visible = false; root.add(flash);
  return { root, chamber: root.position.clone(), muzzle: root.position.clone().add(new THREE.Vector3(0, 0, 4.6)),
    setOpen(value: number) { for (const { mesh, side } of shutters) mesh.position.x = side * (1.55 + THREE.MathUtils.clamp(value, 0, 1) * 3.2); },
    setCharge(value: number) { const t = THREE.MathUtils.clamp(value, 0, 1); charge.emissiveIntensity = 0.2 + t * 3; light.intensity = t * 24; },
    setBurst(age: number) {
      flash.visible = age >= 0 && age < 0.55; flashMaterial.opacity = flash.visible ? (1 - age / 0.55) * 0.8 : 0;
      flash.scale.setScalar(1 + Math.max(0, age) * 6);
    },
  };
}

/** A single simulation-timed pulse; no wall-clock animations continue through pause. */
export function createJungleScramblerPulse() {
  const pulse = document.createElement('div'); pulse.className = 'scrambler-pulse jungle-scrambler-pulse';
  const flash = document.createElement('div'); flash.className = 'jungle-scrambler-flash';
  pulse.setAttribute('aria-hidden', 'true'); flash.setAttribute('aria-hidden', 'true');
  document.body.append(pulse, flash);
  function update(age: number, reverse = false) {
    const t = THREE.MathUtils.clamp(age / 1.2, 0, 1);
    pulse.style.opacity = String(age >= 0 ? Math.sin(t * Math.PI) * 0.65 : 0);
    pulse.style.setProperty('--pulse-scale', String(0.15 + (reverse ? 1 - t : t) * 2.8));
    flash.style.setProperty('--flash-opacity', String(age >= 0 ? 1 - THREE.MathUtils.smootherstep(age, 0.04, 0.45) : 0));
  }
  update(-1);
  return { update, dispose() { pulse.remove(); flash.remove(); } };
}
