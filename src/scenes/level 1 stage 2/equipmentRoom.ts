import * as THREE from 'three';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createShipInteriorMaterials, createShipTerminal, SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import { createCameraVisitUI } from '../../helpers/scene/cameraVisit.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { createRewardChest } from '../../scripts/rewardChest.js';
import { createFileDesktop } from '../living quarters/surfaces.js';
import { createInspectionView } from '../living quarters/inspectionView.js';
import { fitCabinProp, shipLabelTexture } from '../living quarters/furnishings.js';
import { cameraVisitMap, createStageTwoProgress, SURVEILLANCE_CODE, type StageTwoProgress } from './stageTwoLayout.js';

interface EquipmentRoomOptions {
  progress?: StageTwoProgress;
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onLightsaberCollected?: () => void;
}

export function createScene({ progress = createStageTwoProgress(), entryState, preview = false, deferActivation = false,
  hasReturnMarker, onRestart, onLightsaberCollected }: EquipmentRoomOptions = {}) {
  if (!preview && (!hasReturnMarker || !onRestart)) throw new Error('The equipment archive requires a camera return link');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  const physics = createScenePhysics();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 70);
  const materials = createShipInteriorMaterials(4, 4);
  materials.deck.color.setHex(0x3b4c5d);
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.15 });
  const box = (size: [number, number, number], point: [number, number, number],
    material: THREE.Material = materials.steel, solid = true) => roomBox(scene, physics, size, point, material, solid);
  box([8, 0.2, 8], [0, -0.1, 0], materials.deck);
  box([8, 0.16, 8], [0, 3.2, 0], materials.dark).userData.minimap = false;
  for (const side of [-1, 1]) {
    box([0.18, 3.2, 8], [side * 4, 1.6, 0]);
    box([8, 3.2, 0.18], [0, 1.6, side * 4]);
    for (const z of [-2.5, 0, 2.5]) box([0.025, 0.045, 1.4], [side * 3.89, 2.4, z], materials.cyan, false);
    box([0.045, 0.07, 7.6], [side * 3.84, 0.16, 0], materials.trim, false);
    box([7.6, 0.07, 0.045], [0, 0.16, side * 3.84], materials.trim, false);
    box([0.14, 0.12, 7.6], [side * 2.5, 3.02, 0], materials.trim, false).userData.minimap = false;
    for (const z of [-2.6, 0, 2.6]) box([0.04, 2.7, 0.08], [side * 3.86, 1.6, z], materials.dark, false);
  }
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.4),
    new THREE.HemisphereLight(0xbbd7ed, 0x273342, 1.8));
  const lamp = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 13, 12); lamp.position.set(0, 2.9, 0); scene.add(lamp);
  box([2.4, 0.04, 0.16], [0, 3.05, 0], materials.cyan, false);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6),
    new THREE.MeshBasicMaterial({ map: shipLabelTexture(['SEALED ARCHIVE', 'CAMERA ACCESS ONLY'], 0xbd77ff), toneMapped: false }));
  sign.position.set(0, 2.45, -3.89); scene.add(sign);
  const equipmentSign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.48),
    new THREE.MeshBasicMaterial({ map: shipLabelTexture(['RECOVERED EQUIPMENT', 'PERSONAL FOOTLOCKER'], 0xbd77ff), toneMapped: false }));
  equipmentSign.rotation.y = Math.PI / 2; equipmentSign.position.set(-3.89, 1.65, -1.3); scene.add(equipmentSign);
  box([0.03, 0.022, 2.5], [-2.55, 0.02, -1.3], materials.cyan, false);
  for (const z of [-2.55, -0.05]) box([1.22, 0.022, 0.03], [-3.16, 0.02, z], materials.cyan, false);

  const player = createPlayer({ camera, physicsWorld: physics.world,
    spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 2 } });
  teleportPlayer(player, { x: 0, y: player.radius, z: 2 }, 0, entryState);
  let active = !preview && !deferActivation, disposed = false, paused = false, captionTime = 0, lastDelta = 0;
  if (active) player.enable();
  const ui = document.createElement('section'); ui.className = 'stage-two-ui equipment-archive-ui';
  ui.classList.toggle('hidden', !active);
  const caption = document.createElement('div'); caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  ui.append(caption); if (!preview) document.body.append(ui);
  function tell(text: string, seconds = 8) {
    caption.textContent = text; captionTime = seconds; caption.classList.remove('hidden');
  }
  const desktop = createFileDesktop({
    title: 'camera link', owner: 'SURVEILLANCE / MAINTENANCE',
    lines: ['Surveillance maintenance notes', 'Hidden keypad: right of the camera wall.',
      'Wear scanner goggles (N) to reveal it.', '', `Service elevator code: ${SURVEILLANCE_CODE}`,
      '', 'Bay 14 selector circuit: SEVERED', 'Use Bay 13, then the arena service lift.', 'Keep the return marker in surveillance.'],
    onRead: () => { progress.codeRead = true; },
  });
  box([1.95, 0.08, 1.05], [1.5, 0.82, -3], pale);
  box([0.52, 0.78, 0.9], [0.87, 0.39, -3], materials.dark);
  for (const y of [0.24, 0.5]) box([0.35, 0.03, 0.045], [0.87, y, -2.52], materials.trim, false);
  for (const z of [-3.4, -2.6]) box([0.075, 0.78, 0.075], [2.33, 0.39, z], materials.trim);
  const terminal = createShipTerminal(desktop.texture);
  terminal.root.position.set(1.5, 0.86, -3.05); terminal.root.rotation.y = Math.PI; scene.add(terminal.root);
  const chairReady = loadToolModel('Prop_Chair').then(gltf => {
    if (disposed) { disposeRoom(gltf.scene); return; }
    const size = fitCabinProp(gltf.scene, 1.05, 0.68, 0.8);
    gltf.scene.name = 'ArchiveComputerChair'; gltf.scene.position.add(new THREE.Vector3(1.5, 0, -1.7)); scene.add(gltf.scene);
    physics.addBox(size, { x: 1.5, y: size.y / 2, z: -1.7 });
  });
  const inspection = preview ? null : createInspectionView(scene, camera, ui, () => {
    if (disposed) return;
    document.body.classList.remove('quarters-cinematic');
    player.clearInput(); player.enable();
  });
  const chest = createRewardChest({ scene, world: physics.world, player, position: new THREE.Vector3(-3.32, 0, -1.3), yaw: -Math.PI / 2,
    reward: 'lightsaber', style: 'crew', initialCollected: progress.lightsaberCollected, unlocked: () => true,
    canInteract: () => active && !paused && !inspection?.active,
    onCollect: () => {
      progress.lightsaberCollected = true; onLightsaberCollected?.();
      tell('Brondon: A lightsaber! Read the computer for the hidden keypad, then press T to return to the camera room.');
      return true;
    } });
  const visitUI = !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: 'Equipment archive / No doors', player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);
  const prompt = document.getElementById('interact-prompt'), projected = new THREE.Vector3();
  const computerPoint = new THREE.Vector3(1.5, 1.19, -3.05);
  function nearComputer() {
    if (Math.hypot(player.body.position.x - computerPoint.x, player.body.position.z - computerPoint.z) > 2.5) return false;
    projected.copy(computerPoint).project(camera);
    return projected.z > -1 && projected.z < 1 && Math.hypot(projected.x, projected.y) < 0.4;
  }
  function onKey(event: KeyboardEvent) {
    if (!active || disposed || paused || event.repeat || event.defaultPrevented || inspection?.active
      || !player.isEnabled() || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    if (event.code !== 'KeyE' || !nearComputer() || chest.isOpening()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    player.disable(); prompt?.classList.add('hidden'); document.body.classList.add('quarters-cinematic');
    inspection!.open({ screen: terminal.screen, display: desktop, width: 0.6, height: 0.34,
      title: 'Surveillance maintenance notes', pointer: 'arrow', instructions: 'Click camera link / Enter: read maintenance notes',
      onAction: action => {
        if (action === 'read-file') tell(`Prime: Code ${SURVEILLANCE_CODE}. Put on the goggles with N in surveillance; the keypad is beside the camera wall.`, 12);
      } });
  }
  if (!preview) window.addEventListener('keydown', onKey);
  return {
    roomId: 'equipment-archive', scene, camera, player, physicsWorld: physics.world,
    ready: Promise.all([chest.ready, chairReady]).then(() => undefined), cutsceneManager: null,
    getSceneId: () => 'scene1.3', getMapLayout: () => cameraVisitMap(37), getMapSceneId: () => 'scene37',
    getMusicTrack: () => 'stealth-2' as const,
    activate() { active = true; ui.classList.remove('hidden'); visitUI?.setVisible(true); player.clearInput(); player.enable(); },
    controlsReady: () => active && !paused && !inspection?.active,
    isCinematic: () => !!inspection?.active,
    get ownsWeaponInput() { return !!inspection?.active || !active; },
    hideCharacter: () => !!inspection?.active,
    hideMinimap: () => !!inspection?.active,
    getCinematicDelta: () => lastDelta,
    getCinematicState: () => inspection?.active ? { ...player.getState(), isMoving: false, isOnGround: true,
      jumping: false, climbing: false, actionRequest: null } : null,
    applyCinematicCamera: () => inspection?.applyCamera(),
    setMenuPaused(value: boolean) { paused = value; player.clearInput(); },
    updateInteractionFocus() {
      if (!active || paused || inspection?.active || chest.isPromptVisible() || !prompt) return;
      const focused = nearComputer();
      prompt.textContent = focused ? 'E / Inspect the maintenance computer' : '';
      prompt.classList.toggle('hidden', !focused);
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || !active || paused) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0; lastDelta = frame;
      if (inspection?.active) inspection.update(frame);
      else physics.step(frame, player, thirdPerson);
      chest.update(frame); visitUI?.update();
      captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
    },
    syncProgress() { if (progress.lightsaberCollected) chest.setCollected(); },
    minimap: { bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }, floor: 0 },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKey); inspection?.dispose(); visitUI?.dispose(); chest.dispose();
      ui.remove();
      if (!preview) { prompt?.classList.add('hidden'); document.body.classList.remove('quarters-cinematic'); }
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
