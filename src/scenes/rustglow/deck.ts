import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPlayer, type Player, type PlayerTransitionState } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { createBreakables } from '../../scripts/breakables.js';
import { createRewardChest } from '../../scripts/rewardChest.js';
import { createCameraVisitUI } from '../../helpers/scene/cameraVisit.js';
import { createSlidingPortal, disposeRoom, type PortalFrame } from '../../helpers/scene/shipRoom.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import { loadToolModel } from '../../core/loader.js';
import { rustglowDeckMap, type CameraRoomProgress } from '../level 1 stage 2/stageTwoLayout.js';
import { createRustWorld, createResetTerminal, type RustWorld } from './rustglowKit.js';
import { build as buildChamber1 } from './chamber1.js';
import { build as buildChamber2 } from './chamber2.js';
import { build as buildChamber3 } from './chamber3.js';
import { build as buildChamber4 } from './chamber4.js';
import { build as buildChamber5 } from './chamber5.js';

export const RUSTGLOW_CHAMBER_COUNT = 5;

export interface RouteWaypoint {
  p: [number, number, number];
  pause?: number;
  caption?: string;
}

export interface ChamberInstance {
  update(dt: number): void;
  reset(): void;
  objective(): string;
  spawn: { x: number; y: number; z: number; yaw: number };
  resetTerminal: { x: number; z: number; yaw: number };
  previewCamera: { position: THREE.Vector3; lookAt: THREE.Vector3 };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  route?: RouteWaypoint[];
  exitGate?: { frame: PortalFrame; span: number; height: number; label: string };
  chest?: { position: THREE.Vector3; yaw: number; unlocked: () => boolean };
  activateBot?(): void;
  dispose?(): void;
}

export interface ChamberContext {
  chamber: number;
  scene: THREE.Scene;
  physics: ReturnType<typeof createScenePhysics>;
  world: CANNON.World;
  rust: RustWorld;
  breakables: ReturnType<typeof createBreakables>;
  player: Player | null;
  preview: boolean;
  isBroken(id: string): boolean;
  openExit(): void;
  setExitAllowed(allowed: boolean): void;
  exitOpen(): boolean;
  say(message: string, seconds?: number): void;
}

const CHAMBER_BUILDERS = [buildChamber1, buildChamber2, buildChamber3, buildChamber4, buildChamber5] as const;

export function createScene({ chamber = 1, entryState, remoteVisit = false, preview = false, deferActivation = false, loot,
  hasReturnMarker, onRestart, onKeycardCollected, onChamberCleared, modelLoader = loadToolModel }: {
  chamber?: number; entryState?: PlayerTransitionState;
  remoteVisit?: boolean; preview?: boolean; deferActivation?: boolean; loot?: CameraRoomProgress;
  hasReturnMarker?: () => boolean; onRestart?: () => Promise<boolean>;
  onKeycardCollected?: () => void; onChamberCleared?: (chamber: number, state: PlayerTransitionState) => void;
  modelLoader?: typeof loadToolModel;
} = {}) {
  if (remoteVisit && !preview && (!hasReturnMarker || !onRestart))
    throw new Error('Rustglow visits require a return link and checkpoint restart');
  if (chamber < 1 || chamber > RUSTGLOW_CHAMBER_COUNT) throw new Error(`Unknown rustglow chamber ${chamber}`);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(preview ? 0x120d08 : SHIP_INTERIOR_PALETTE.background);
  scene.fog = new THREE.Fog(0x161d26, 34, 110);
  const physics = createScenePhysics();
  const world = physics.world;
  const rust = createRustWorld();
  const breakables = createBreakables(scene, world);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.08, 220);
  const player = createPlayer({ camera, physicsWorld: world, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 0 } });
  if (preview) player.disable();

  let exitAllowed = false, cleared = false, disposed = false, active = !preview && !deferActivation;
  const state = {
    openExit: () => { exitAllowed = true; },
    setExitAllowed: (allowed: boolean) => { exitAllowed = allowed; },
    exitOpen: () => exitAllowed,
  };

  const caption = document.createElement('div');
  caption.className = 'rustglow-caption hidden';
  Object.assign(caption.style, {
    position: 'fixed', top: '14%', left: '50%', transform: 'translateX(-50%)', maxWidth: '70vw',
    color: '#ffd8a0', fontFamily: 'monospace', fontSize: '17px', textAlign: 'center', pointerEvents: 'none',
    textShadow: '0 2px 8px #000', zIndex: '30', transition: 'opacity 400ms', whiteSpace: 'pre-line',
  } as CSSStyleDeclaration);
  if (!preview) document.body.append(caption);
  let captionTimer: ReturnType<typeof setTimeout> | null = null;
  function say(message: string, seconds = 4) {
    if (preview || disposed) return;
    caption.textContent = message;
    caption.classList.remove('hidden');
    caption.style.opacity = '1';
    if (captionTimer) clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { caption.style.opacity = '0'; }, seconds * 1000);
  }

  const ctx: ChamberContext = {
    chamber, scene, physics, world, rust, breakables,
    player: preview ? null : player,
    preview,
    isBroken: id => !!loot?.cleared.has(id),
    openExit: state.openExit,
    setExitAllowed: state.setExitAllowed,
    exitOpen: () => exitAllowed,
    say,
  };

  // Re-apply cleared state before the chamber reasons about it while building.
  const instance: ChamberInstance = CHAMBER_BUILDERS[chamber - 1](ctx);
  breakables.restoreBroken(loot?.cleared ?? new Set());

  let gate: ReturnType<typeof createSlidingPortal> | null = null;
  if (instance.exitGate && !preview) {
    gate = createSlidingPortal(scene, physics, instance.exitGate.frame, instance.exitGate.span,
      instance.exitGate.height, instance.exitGate.label, { doorHeight: Math.min(3.4, instance.exitGate.height - 0.6) });
    gate.setTrigger(next => {
      if (cleared || disposed || !player.isEnabled()) return;
      cleared = true;
      onChamberCleared?.(chamber, next);
    });
  }

  const terminal = !preview ? createResetTerminal(scene, physics, rust,
    new THREE.Vector3(instance.resetTerminal.x, 0, instance.resetTerminal.z), instance.resetTerminal.yaw, () => {
      breakables.reset();
      loot?.cleared.clear();
      instance.reset();
      say('The deck hums as the chamber rebuilds itself.');
    }) : null;

  const chest = instance.chest && !preview
    ? createRewardChest({ scene, world, player, position: instance.chest.position, yaw: instance.chest.yaw,
      reward: 'keycard', style: 'crew', initialCollected: loot?.rewardCollected, canInteract: () => active,
      unlocked: () => !!instance.chest?.unlocked(), lockedPrompt: 'The niche is sealed. Finish the chamber first.',
      onCollect: () => {
        if (loot) loot.rewardCollected = true;
        onKeycardCollected?.();
        player.heal(15);
        say('Prime: Deck keycard recovered. Press T to return to surveillance.', 6);
        return true;
      } }, modelLoader)
    : null;

  if (preview) {
    camera.aspect = 16 / 9;
    camera.updateProjectionMatrix();
    camera.position.copy(instance.previewCamera.position);
    camera.lookAt(instance.previewCamera.lookAt);
  } else {
    const spawn = instance.spawn;
    if (remoteVisit) teleportPlayer(player, { x: spawn.x, y: spawn.y, z: spawn.z }, spawn.yaw, entryState);
    else if (entryState) player.restoreTransition(entryState, { x: spawn.x, y: 0, z: spawn.z, yaw: spawn.yaw });
    else { player.body.position.set(spawn.x, spawn.y, spawn.z); player.setRotation(spawn.yaw, 0); }
  }

  const visitUI = remoteVisit && !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: `RUSTGLOW DECK / CHAMBER ${chamber} OF ${RUSTGLOW_CHAMBER_COUNT}`,
      player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);

  interface Ghost { group: THREE.Group; leg: number; wait: number }
  let ghost: Ghost | null = null;
  function stopGhost() { ghost?.group.removeFromParent(); ghost = null; }
  function playRoutePreview() {
    if (preview || disposed || !instance.route?.length) return;
    if (ghost) { stopGhost(); return; }
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x6ad9e8, emissive: 0x1f93a8, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }));
    body.position.y = 0.8; group.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x9ff3ff, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; group.add(ring);
    const lamp = new THREE.PointLight(0x6ad9e8, 8, 6, 2); lamp.position.y = 1.4; group.add(lamp);
    const first = instance.route[0].p;
    group.position.set(first[0], first[1], first[2]);
    scene.add(group);
    ghost = { group, leg: 1, wait: 1.2 };
    say('Route preview running: follow the cyan runner. Press F10 again to stop it.', 5);
  }

  function activateBot() {
    if (preview || disposed) return;
    instance.activateBot?.();
  }
  function updateGhost(dt: number) {
    const route = instance.route;
    if (!ghost || !route) return;
    if (ghost.wait > 0) { ghost.wait -= dt; if (ghost.wait > 0) return; }
    const target = route[ghost.leg];
    const to = new THREE.Vector3(target.p[0], target.p[1], target.p[2]);
    const step = 2.6 * dt;
    const delta = new THREE.Vector3().subVectors(to, ghost.group.position);
    if (delta.length() <= step) {
      ghost.group.position.copy(to);
      if (target.caption) say(target.caption, 6);
      ghost.leg += 1;
      ghost.wait = target.pause ?? 0.4;
      if (ghost.leg >= route.length) { stopGhost(); say('Route preview complete - your turn.', 4); }
    } else {
      ghost.group.position.add(delta.normalize().multiplyScalar(step));
      ghost.group.rotation.y = Math.atan2(delta.x, delta.z);
    }
  }

  function updatePhysics(dt: number, thirdPerson = false) {
    if (disposed) return;
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(frame, player, preview ? false : thirdPerson);
    breakables.update(frame);
    rust.update(frame);
    chest?.update(frame);
    visitUI?.update();
    terminal?.update(frame, preview ? null : player);
    if (gate) gate.update(frame, player, exitAllowed);
    instance.update(frame);
    updateGhost(frame);
    for (const item of breakables.objects) if (item.broken) loot?.cleared.add(item.id);
    if (!preview && player.isEnabled() && player.body.position.y < -6) {
      console.warn(`[rustglow] out-of-world failsafe at (${player.body.position.x.toFixed(2)}, ${player.body.position.y.toFixed(2)}, ${player.body.position.z.toFixed(2)})`);
      const spawn = instance.spawn;
      player.body.position.set(spawn.x, spawn.y + 0.4, spawn.z);
      player.body.velocity.setZero();
    }
    if (chest && loot?.rewardCollected) chest.setCollected();
  }

  function activate() {
    active = true;
    visitUI?.setVisible(true);
    player.clearInput();
    player.enable();
    say(instance.objective(), 7);
  }

  function syncProgress() {
    breakables.restoreBroken(loot?.cleared ?? new Set());
    if (loot?.rewardCollected) chest?.setCollected();
  }

  return {
    roomId: `rustglow-chamber-${chamber}`,
    scene, camera, physics, physicsWorld: world, player,
    cutsceneManager: null,
    ready: chest?.ready ?? Promise.resolve(),
    hideMinimap: () => false,
    minimap: { bounds: instance.bounds, floor: 0 },
    getSceneId: () => 'stage2-rustglow',
    getMapLayout: () => rustglowDeckMap(chamber),
    updatePhysics,
    activate,
    playRoutePreview,
    activateBot,
    syncProgress,
    getDamageTargets: breakables.getDamageTargets,
    setGogglesActive: breakables.setHighlighted,
    breakables,
    showTeleportMessage: (message: string) => say(message, 4),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopGhost();
      visitUI?.dispose();
      chest?.dispose();
      terminal?.dispose();
      instance.dispose?.();
      breakables.dispose();
      rust.update(0);
      player.dispose();
      physics.dispose();
      caption.remove();
      if (captionTimer) clearTimeout(captionTimer);
      disposeRoom(scene);
    },
  };
}
