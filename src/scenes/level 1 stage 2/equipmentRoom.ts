import * as THREE from 'three';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createShipInteriorMaterials, createShipTerminal, createShipStatusTexture, SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import { createCameraVisitUI } from '../../helpers/scene/cameraVisit.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { createRewardChest } from '../../scripts/rewardChest.js';
import { createLightsaber } from '../../scripts/items/createLightsaber.js';
import { fitCabinProp } from '../living quarters/furnishings.js';
import { cameraVisitMap, createStageTwoProgress, type StageTwoProgress } from './stageTwoLayout.js';

interface EquipmentRoomOptions {
  progress?: StageTwoProgress;
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onLightsaberCollected?: () => void;
  onKeycardCollected?: () => void;
  modelLoader?: typeof loadToolModel;
}

export function createScene({ progress = createStageTwoProgress(), entryState, preview = false, deferActivation = false,
  hasReturnMarker, onRestart, onLightsaberCollected, onKeycardCollected, modelLoader = loadToolModel }: EquipmentRoomOptions = {}) {
  if (!preview && (!hasReturnMarker || !onRestart || !onKeycardCollected))
    throw new Error('The equipment archive requires a camera return link and persistent keycard reward');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 70);
  const materials = createShipInteriorMaterials(4, 4); materials.deck.color.setHex(0x3b4c5d);
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.15 });
  const box = (size: [number, number, number], point: [number, number, number],
    material: THREE.Material = materials.steel, solid = true) => roomBox(scene, physics, size, point, material, solid);
  box([8, 0.2, 8], [0, -0.1, 0], materials.deck);
  box([8, 0.16, 8], [0, 3.2, 0], materials.dark).userData.minimap = false;
  for (const side of [-1, 1]) {
    box([0.18, 3.2, 8], [side * 4, 1.6, 0]); box([8, 3.2, 0.18], [0, 1.6, side * 4]);
    for (const z of [-2.5, 0, 2.5]) box([0.025, 0.045, 1.4], [side * 3.89, 2.4, z], materials.cyan, false);
    box([0.045, 0.07, 7.6], [side * 3.84, 0.16, 0], materials.trim, false);
    box([7.6, 0.07, 0.045], [0, 0.16, side * 3.84], materials.trim, false);
    box([0.14, 0.12, 7.6], [side * 2.5, 3.02, 0], materials.trim, false).userData.minimap = false;
  }
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.4), new THREE.HemisphereLight(0xbbd7ed, 0x273342, 1.8));
  const lamp = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 13, 12); lamp.position.set(0, 2.9, 0); scene.add(lamp);
  box([2.4, 0.04, 0.16], [0, 3.05, 0], materials.cyan, false);
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 2 } });
  teleportPlayer(player, { x: 0, y: player.radius, z: 2 }, 0, entryState);
  let active = !preview && !deferActivation, disposed = false, paused = false, captionTime = 0;
  if (active) player.enable();
  const ui = document.createElement('section'); ui.className = 'stage-two-ui equipment-archive-ui'; ui.classList.toggle('hidden', !active);
  const caption = document.createElement('div'); caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  ui.append(caption); if (!preview) document.body.append(ui);
  const desktop = createShipStatusTexture('ARCHIVE TERMINAL', ['INVENTORY SEALED', 'CAMERA RELAY ONLINE', 'DECK UNDER SURVEILLANCE']);
  box([1.95, 0.08, 1.05], [1.5, 0.82, -3], pale);
  box([0.52, 0.78, 0.9], [0.87, 0.39, -3], materials.dark);
  for (const z of [-3.4, -2.6]) box([0.075, 0.78, 0.075], [2.33, 0.39, z], materials.trim);
  const terminal = createShipTerminal(desktop); terminal.root.position.set(1.5, 0.86, -3.05);
  terminal.root.rotation.y = Math.PI; scene.add(terminal.root);
  const chairReady = modelLoader('Prop_Chair').then(gltf => {
    if (disposed) { disposeRoom(gltf.scene); return; }
    const size = fitCabinProp(gltf.scene, 1.05, 0.68, 0.8); gltf.scene.name = 'ArchiveComputerChair';
    gltf.scene.position.add(new THREE.Vector3(1.5, 0, -1.7)); scene.add(gltf.scene);
    physics.addBox(size, { x: 1.5, y: size.y / 2, z: -1.7 });
  });
  const recoveredSaber = createLightsaber(); recoveredSaber.name = 'ArchiveRecoveredLightsaber';
  recoveredSaber.position.set(-3.55, 1.15, -1.3); recoveredSaber.scale.setScalar(0.7);
  recoveredSaber.visible = !progress.lightsaberCollected; scene.add(recoveredSaber);
  const loot = progress.remoteRooms['stage2-armory'];
  const chest = createRewardChest({ scene, world: physics.world, player, position: new THREE.Vector3(-3.32, 0, -1.3), yaw: -Math.PI / 2,
    reward: 'keycard', style: 'crew', initialCollected: loot.rewardCollected, unlocked: () => true, canInteract: () => active && !paused,
    onCollect: () => {
      onKeycardCollected?.(); loot.rewardCollected = true; progress.lightsaberCollected = true; onLightsaberCollected?.();
      recoveredSaber.visible = false; caption.textContent = 'Keycard and lightsaber recovered. T: return.'; captionTime = 3.5;
      caption.classList.remove('hidden'); return true;
    } }, modelLoader);
  const visitUI = !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: 'Equipment archive', player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);
  return {
    roomId: 'equipment-archive', scene, camera, player, physicsWorld: physics.world,
    ready: Promise.all([chest.ready, chairReady]).then(() => undefined), cutsceneManager: null,
    getSceneId: () => 'scene1.3', getMapLayout: () => cameraVisitMap(37), getMapSceneId: () => 'scene37',
    getMusicTrack: () => 'stealth-2' as const,
    activate() { active = true; ui.classList.remove('hidden'); visitUI?.setVisible(true); player.clearInput(); player.enable(); },
    controlsReady: () => active && !paused,
    setMenuPaused(value: boolean) { paused = value; player.clearInput(); },
    chest,
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || !active || paused) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0;
      physics.step(frame, player, thirdPerson); chest.update(frame); visitUI?.update();
      captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
    },
    syncProgress() { if (loot.rewardCollected) chest.setCollected(); recoveredSaber.visible = !progress.lightsaberCollected; },
    minimap: { bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }, floor: 0 },
    dispose() {
      if (disposed) return; disposed = true; visitUI?.dispose(); chest.dispose(); ui.remove();
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
