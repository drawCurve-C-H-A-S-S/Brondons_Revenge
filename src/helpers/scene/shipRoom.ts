import * as THREE from 'three';
import { createScenePhysics, PHYSICS } from '../physics/scenePhysics.js';
import { createPlayer, type Player, type PlayerTransitionState } from '../../scripts/player.js';

export interface PortalFrame { x: number; y: number; z: number; yaw: number; }
type Physics = ReturnType<typeof createScenePhysics>;

export function roomBox(scene: THREE.Scene, physics: Physics, size: [number, number, number], position: [number, number, number], material: THREE.Material, solid = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  if (solid) physics.addBox({ x: size[0], y: size[1], z: size[2] }, mesh.position);
  return mesh;
}

/** Frames point out of their room. Panels and colliders retract into solid wall pockets. */
export function createSlidingPortal(scene: THREE.Scene, physics: Physics, frame: PortalFrame, span: number, height: number, label: string) {
  const group = new THREE.Group(); group.position.set(frame.x, frame.y, frame.z); group.rotation.y = frame.yaw;
  group.name = `Door-${label}`; scene.add(group);
  const wall = new THREE.MeshStandardMaterial({ color: 0x52616a, roughness: 0.78, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x23353f, metalness: 0.7, roughness: 0.45 });
  const indicator = new THREE.MeshStandardMaterial({ color: 0xffb34b, emissive: 0xff8a15, emissiveIntensity: 1.3 });
  function localBox(size: [number, number, number], p: [number, number, number], mat: THREE.Material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); mesh.position.set(...p); mesh.receiveShadow = true; group.add(mesh);
    return { mesh, body: solid ? physics.addBoxFromMesh(mesh) : null };
  }
  const w = 3, h = 3.2, side = (span - w) / 2;
  localBox([side, height, 0.5], [-(w + side) / 2, height / 2, 0], wall);
  localBox([side, height, 0.5], [(w + side) / 2, height / 2, 0], wall);
  localBox([w, height - h, 0.5], [0, (height + h) / 2, 0], wall);
  localBox([w, 0.4, 2.4], [0, -0.2, -0.8], steel);
  for (const x of [-1.56, 1.56]) localBox([0.12, h, 0.62], [x, h / 2, 0], steel, false);
  const panels = [-1, 1].map(sign => ({ ...localBox([1.5, h, 0.12], [sign * 0.75, h / 2, 0], steel), sign }));
  localBox([2.6, 0.055, 0.04], [0, h + 0.07, 0.28], indicator, false);
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#11232e'; ctx.fillRect(0, 0, 768, 128);
  ctx.fillStyle = '#c8ecee'; ctx.textAlign = 'center'; ctx.font = 'bold 42px monospace'; ctx.fillText(label, 384, 80);
  const texture = new THREE.CanvasTexture(canvas);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.46), new THREE.MeshBasicMaterial({ map: texture }));
  sign.position.set(0, h + 0.5, 0.27); group.add(sign);
  let open = 0, crossed = false;
  let callback: ((state: PlayerTransitionState) => void) | null = null;
  function sync() {
    for (const p of panels) {
      p.mesh.position.x = p.sign * (0.75 + open * 1.58);
      const world = p.mesh.getWorldPosition(new THREE.Vector3());
      p.body!.position.set(world.x, world.y, world.z); p.body!.aabbNeedsUpdate = true;
    }
  }
  function localPosition(player: Player) { return group.worldToLocal(new THREE.Vector3().copy(player.body.position)); }
  return {
    frame, group, panels, texture, get open() { return open; },
    setTrigger: (next: (state: PlayerTransitionState) => void) => { callback = next; },
    openImmediately: () => { open = 1; sync(); },
    near: (player: Player) => { const p = localPosition(player); return Math.abs(p.x) < 2.2 && Math.abs(p.z) < 3.4 && p.y < 2.2; },
    update(dt: number, player: Player, allowed: boolean) {
      const p = localPosition(player);
      // Never close on an actor already inside the opening, even when a plate releases.
      const occupied = open > 0.9 && Math.abs(p.x) < 1.8 && Math.abs(p.z) < 1.1 && p.y < h;
      open = THREE.MathUtils.clamp(open + ((allowed || occupied) ? 1 : -1) * dt * 1.8, 0, 1);
      indicator.color.setHex(allowed ? 0x65ffb6 : 0xffb34b); indicator.emissive.copy(indicator.color); sync();
      if (player.isEnabled() && !crossed && callback && open > 0.95 && Math.abs(p.x) < 1.15 && p.y < 2.2 && p.z < -0.8) {
        crossed = true; callback(player.captureTransition(frame));
      }
    },
  };
}

export function disposeRoom(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  scene.traverse(node => {
    const mesh = node as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material); const map = (material as THREE.MeshStandardMaterial).map; if (map) textures.add(map);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}

/** Shared empty drop-room shell. The only exit is a floor-level passage door. */
export function createDropRoom(id: number, { entryState, fromPassage = false }: { entryState?: PlayerTransitionState; fromPassage?: boolean } = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111d28);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const wall = new THREE.MeshStandardMaterial({ color: 0x596970, metalness: 0.3, roughness: 0.7 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x263743, metalness: 0.4, roughness: 0.65 });
  const box = (s: [number, number, number], p: [number, number, number], m = wall, solid = true) => roomBox(scene, physics, s, p, m, solid);
  box([12, 0.4, 12], [0, -0.2, 0], floor);
  box([0.4, 4.5, 12], [-6, 2.25, 0]); box([0.4, 4.5, 12], [6, 2.25, 0]); box([12, 4.5, 0.4], [0, 2.25, 6]);
  // Real opening in the ceiling at (-3, 3), with a short shaft and no return ladder.
  if (id !== 13) {
    box([2, 0.2, 12], [-5, 4.5, 0]); box([8, 0.2, 12], [2, 4.5, 0]);
    box([2, 0.2, 8], [-3, 4.5, -2]); box([2, 0.2, 2], [-3, 4.5, 5]);
    for (const x of [-4, -2]) box([0.1, 1.2, 2], [x, 5, 3], floor);
    for (const z of [2, 4]) box([2, 1.2, 0.1], [-3, 5, z], floor);
  } else box([12, 0.2, 12], [0, 4.5, 0], floor);
  const stripe = new THREE.MeshStandardMaterial({ color: 0x87ddd8, emissive: 0x247c89, emissiveIntensity: 1 });
  for (const x of [-5.76, 5.76]) for (const z of [-4, 0, 4]) box([0.025, 0.08, 2.4], [x, 2.5, z], stripe, false);
  scene.add(new THREE.HemisphereLight(0xbce5ff, 0x30393f, 2.5));
  for (const x of [-3, 3]) { const light = new THREE.PointLight(0xc4e8ff, 35, 15); light.position.set(x, 4, 0); scene.add(light); }
  const door = createSlidingPortal(scene, physics, { x: 0, y: 0, z: -6, yaw: 0 }, 12, 4.5, '12 / TRANSFER PASSAGE');
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 150);
  const spawn = { x: -3, y: 4.8, z: 3 };
  const player = createPlayer({ camera, physicsWorld, spawnPosition: fromPassage ? { x: 0, y: PHYSICS.playerRadius, z: -4.8 } : spawn }); player.enable();
  if (entryState && fromPassage) player.restoreTransition(entryState, door.frame);
  else if (entryState) player.restoreTransition({ ...entryState, position: spawn, velocity: { x: 0, y: -1, z: 0 }, yaw: 0, pitch: 0, crouching: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  if (fromPassage) door.openImmediately();
  let entrySafety = fromPassage, disposed = false;
  const status = document.getElementById('loading-bay-status');
  if (status) { status.textContent = `${id} / ${id === 10 ? 'CARGO TRANSFER TEST\nE: grab / release box | W: push | S: pull\nMove the box onto the amber floor switch to open the exit' : 'EMPTY COMPARTMENT\nExit through the door to passage 12'}`; status.classList.remove('hidden', 'restored'); }
  function updateDoor(dt: number, unlocked = true) {
    if (player.body.position.z > -4.6) entrySafety = false;
    door.update(dt, player, entrySafety || (unlocked && (id === 10 || door.near(player))));
  }
  return { roomId: `scene${id}`, scene, camera, physics, physicsWorld, player, door, box, updateDoor, cutsceneManager: null,
    setBackTrigger: door.setTrigger,
    updatePhysics(dt: number, thirdPerson = false) { dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime)); physics.step(dt, player, thirdPerson); updateDoor(dt); },
    dispose() { if (disposed) return; disposed = true; status?.classList.add('hidden'); player.dispose(); physics.dispose(); disposeRoom(scene); },
  };
}
