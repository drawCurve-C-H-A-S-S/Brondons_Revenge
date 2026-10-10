import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel, preloadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom, createSlidingPortal } from '../../helpers/scene/shipRoom.js';
import { createShipInteriorMaterials, SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import type { ShipMapLayout } from '../../core/shipMap.js';
import type { ShipMapBlock } from '../../helpers/scene/shipLayout.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { getAudioSettings } from '../../helpers/audio/AudioManager.js';
import { createStealthHangar, HANGAR_LAYOUT } from './stealthHangar.js';
import { createStealthDirector, isBehindDrone, type StealthActor } from './stealthDirector.js';
import beamVertex from '../../shaders/stealthBeam.vert.glsl?raw';
import beamFragment from '../../shaders/stealthBeam.frag.glsl?raw';
import { emitComicEffect } from '../../helpers/scene/comicEffects.js';
import { createHoldToSkip } from '../../helpers/animation/holdToSkip.js';
import { HOLOGRAM_TRANSFER_DURATION, hologramTransitionAt } from '../../scripts/characterManager.js';
import { applyTraversalCamera } from '../../core/camera.js';
import { LADDER } from '../../utils/constants.js';
import { isControllerActive, isControllerEvent, inputHint } from '../../scripts/gamepadInput.js';

export const STORAGE_CLOSET = { width: 3.6, depth: 3.3, height: 3.05, doorWidth: 1.5, doorHeight: 2.55 };
export const ALARM_SEQUENCE = { pullback: 2.4, approaches: 5.8, surround: 8.4, volley: 9.2, collapse: 10.1, retry: 12.2 };
export const QUARTERS_PASSAGE_ENTRY = { x: -12.6, z: -2.5, midpointX: 0 };

export const DECK_ONE_MAP: ShipMapLayout = {
  name: 'Deck One', initialRoom: 29,
  joins: [{ from: { room: 20, portal: 'forward' }, to: { room: 29, portal: 'quarters' } }],
  rooms: [
    { id: 29, name: 'Patrol passage', deck: 'main', width: 28, depth: 5, position: new THREE.Vector3(0, 0, -2.5),
      yaw: 0, portalWidth: 3, description: 'Living quarters at the west bulkhead / Storage cover at the midpoint / Hangar to the east',
      portals: { quarters: { x: -14, z: 0, yaw: Math.PI / 2 }, storage: { x: 0, z: 2.5, yaw: Math.PI },
        hangar: { x: 14, z: 0, yaw: -Math.PI / 2 } } },
    { id: 30, name: 'Storage room', deck: 'main', width: STORAGE_CLOSET.width, depth: STORAGE_CLOSET.depth,
      position: new THREE.Vector3(0, 0, STORAGE_CLOSET.depth / 2), yaw: 0, portalWidth: STORAGE_CLOSET.doorWidth,
      description: 'Concealed cover / Open and close the door, or peek from inside',
      portals: { passage: { x: 0, z: -STORAGE_CLOSET.depth / 2, yaw: 0 } },
      mapContents: [-1, 1].map((side): ShipMapBlock => ({ size: [0.72, 2.5, 1.5], position: [side * 1.3, 1.25, 0.2] })) },
    { id: 31, name: 'Deck One cargo hangar', deck: 'main',
      width: HANGAR_LAYOUT.bounds.maxX - HANGAR_LAYOUT.bounds.minX, depth: HANGAR_LAYOUT.bounds.maxZ - HANGAR_LAYOUT.bounds.minZ,
      position: new THREE.Vector3(50, 0, 0), yaw: 0, portalWidth: 3.2,
      description: 'Locked airlock target / Container cover / Ceiling vent at the far end, opposite the door',
      portals: { passage: { x: -36, z: -2.5, yaw: Math.PI / 2 }, airlock: { x: 36, z: 20, yaw: -Math.PI / 2 } },
      mapContents: HANGAR_LAYOUT.containers.map((cargo): ShipMapBlock => ({
        size: [cargo.width, cargo.height * (cargo.stacked ? 2 : 1), cargo.depth],
        position: [cargo.x - 50, cargo.height * (cargo.stacked ? 2 : 1) / 2, cargo.z],
      })) },
    { id: 32, name: 'Hangar vent landing', deck: 'upper', width: 2.2, depth: 1.8,
      position: new THREE.Vector3(HANGAR_LAYOUT.ventAccess.x, 18, HANGAR_LAYOUT.ventAccess.z), yaw: 0,
      portals: { vent: { x: 0, z: 0, yaw: 0 } }, description: 'Hangar ladder / Direct access to the vent maze' },
  ],
  connections: [[29, 30], [29, 31], [31, 32]],
  playerPoint: (id, position) => new THREE.Vector3(position.x, id === 32 ? 20.2 : 2.2, position.z),
  verticalLinks: [{ id: 31, position: new THREE.Vector3(HANGAR_LAYOUT.ventAccess.x, 0, HANGAR_LAYOUT.ventAccess.z),
    upper: 18, label: 'Hangar vent ladder' }],
  goals: [{ id: 'locked-airlock', room: 31, position: new THREE.Vector3(HANGAR_LAYOUT.exit.x, 1.5, HANGAR_LAYOUT.exit.z),
    label: 'AIRLOCK' }],
};

export async function preloadAssets() {
  await Promise.all([preloadToolModel('Enemy_EyeDrone'), preloadToolModel('Enemy_Trilobite'), preloadToolModel('Enemy_QuadShell')]);
}

export function createScene({ onComplete, hintsEnabled = true, restoreCheckpoint = false, openingEntry = false, fromQuarters = false,
  entryState, onReturnToQuarters, deferActivation = false, modelLoader = loadToolModel,
  fromCameraRoom = false, airlockUnlocked = false, onAirlockEnter }: {
  onComplete?: (presentation?: Promise<void>) => Promise<boolean>; hintsEnabled?: boolean; restoreCheckpoint?: boolean; openingEntry?: boolean; fromQuarters?: boolean;
  entryState?: PlayerTransitionState; onReturnToQuarters?: (state: PlayerTransitionState) => Promise<boolean>;
  deferActivation?: boolean; modelLoader?: typeof loadToolModel;
  fromCameraRoom?: boolean; airlockUnlocked?: boolean; onAirlockEnter?: (state: PlayerTransitionState) => Promise<boolean>;
} = {}) {
  const scene = new THREE.Scene();
  let active = !deferActivation;
  scene.background = new THREE.Color(SHIP_INTERIOR_PALETTE.background);
  scene.fog = new THREE.Fog(SHIP_INTERIOR_PALETTE.background, 42, 115);
  const physics = createScenePhysics();
  const deckY = 12;
  const roomHeight = STORAGE_CLOSET.height;
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 190);
  const entry = fromQuarters ? QUARTERS_PASSAGE_ENTRY : { x: 0, z: 2.25 };
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: entry.x, y: deckY + PHYSICS.playerRadius, z: entry.z } });
  if (entryState) player.restoreTransition({ ...entryState,
    position: { x: entry.x, y: deckY + player.radius, z: entry.z }, velocity: { x: 0, y: 0, z: 0 },
    yaw: fromQuarters ? -Math.PI / 2 : 0, pitch: 0, heldKeys: [], sprinting: false, intentionalJump: false, jumpQueued: false,
  }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.setRotation(fromQuarters ? -Math.PI / 2 : 0, 0);
  player.enable();

  const { steel: wall, dark, trim, cyan: lightStrip, deck: floor, deckTexture } = createShipInteriorMaterials(14, 2.5);
  const storageFloor = floor.clone(); storageFloor.map = deckTexture.clone(); storageFloor.map.repeat.set(1.8, 1.65);
  const crate = wall.clone(); crate.color.setHex(0x536b7d);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xdab943, metalness: 0.25, roughness: 0.52 });
  const box = (size: [number, number, number], position: [number, number, number], material: THREE.Material = wall, solid = true) =>
    roomBox(scene, physics, size, [position[0], deckY + position[1], position[2]], material, solid);

  box([STORAGE_CLOSET.width, 0.2, STORAGE_CLOSET.depth], [0, -0.1, STORAGE_CLOSET.depth / 2], storageFloor);
  box([28, 0.2, 5], [0, -0.1, -2.5], floor);
  box([0.2, roomHeight, STORAGE_CLOSET.depth], [-1.8, roomHeight / 2, 1.65]);
  box([0.2, roomHeight, STORAGE_CLOSET.depth], [1.8, roomHeight / 2, 1.65]);
  box([STORAGE_CLOSET.width, roomHeight, 0.2], [0, roomHeight / 2, STORAGE_CLOSET.depth]);
  for (const side of [-1, 1]) {
    box([1, roomHeight, 0.2], [side * 1.3, roomHeight / 2, 0]);
    box([12.2, roomHeight, 0.2], [side * 7.9, roomHeight / 2, 0]);
    box([0.14, STORAGE_CLOSET.doorHeight, 0.32], [side * 0.84, STORAGE_CLOSET.doorHeight / 2, 0], trim);
  }
  const quartersDoor = createSlidingPortal(scene, physics, { x: -14, y: deckY, z: -2.5, yaw: Math.PI / 2 },
    5, roomHeight, 'LIVING QUARTERS', { doorHeight: 2.5 });
  quartersDoor.setLocked(!onReturnToQuarters);
  box([1.6, 0.2, 5], [-14.8, -0.1, -2.5], floor);
  box([1.6, 0.16, 5], [-14.8, roomHeight, -2.5], dark).userData.minimap = false;
  for (const z of [-5, 0]) box([1.6, roomHeight, 0.18], [-14.8, roomHeight / 2, z]);
  box([0.12, roomHeight, 5], [-15.55, roomHeight / 2, -2.5], dark).userData.minimap = false;
  box([1.6, roomHeight - STORAGE_CLOSET.doorHeight, 0.2], [0, (roomHeight + STORAGE_CLOSET.doorHeight) / 2, 0]);
  box([1.82, 0.14, 0.32], [0, STORAGE_CLOSET.doorHeight + 0.07, 0], trim);
  box([28, roomHeight, 0.2], [0, roomHeight / 2, -5]);
  for (const [size, position] of [
    [[STORAGE_CLOSET.width, 0.16, STORAGE_CLOSET.depth], [0, roomHeight, 1.65]],
    [[28, 0.16, 5], [0, roomHeight, -2.5]],
  ] as Array<[[number, number, number], [number, number, number]]>) {
    box(size, position, dark).userData.minimap = false;
  }
  for (const x of [-1.3, 1.3]) {
    for (const z of [1.85]) {
      for (const height of [0.55, 1.7]) {
        box([0.72, 0.08, 1.5], [x, height - 0.5, z], trim);
        box([0.64, 0.95, 1.2], [x, height, z], crate);
        box([0.66, 0.06, 1.22], [x, height + 0.3, z], yellow, false);
        for (const offset of [-0.36, 0.36]) box([0.04, 2.5, 0.06], [x + offset, 1.25, z - 0.72], trim);
      }
    }
  }
  for (const x of [-12, -8, -4, 0, 4, 8, 12]) {
    box([0.12, roomHeight, 0.12], [x, roomHeight / 2, -4.85], dark, false);
    box([0.24, 0.17, 4.64], [x, roomHeight - 0.18, -2.5], trim, false);
    box([2.3, 0.045, 0.2], [x, roomHeight - 0.1, -2.5], lightStrip, false);
    const light = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 5, 14);
    light.position.set(x, deckY + 2.7, -2.5);
    scene.add(light);
  }
  for (const z of [-4.78, -0.22]) {
    box([27.6, 0.022, 0.035], [0, 0.012, z], lightStrip, false);
    box([27.6, 0.045, 0.05], [0, 0.18, z], trim, false);
  }
  for (const side of [-1, 1]) box([0.035, 0.022, 3.02], [side * 1.59, 0.012, 1.65], lightStrip, false);
  box([1.5, 0.025, 0.1], [0, 0.015, 0.25], yellow, false);
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.4));
  const roomLight = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 2.5, 7);
  roomLight.position.set(0, deckY + 2.75, 2.25);
  scene.add(roomLight);

  const doorPivot = new THREE.Group();
  doorPivot.position.set(-STORAGE_CLOSET.doorWidth / 2, deckY, 0);
  scene.add(doorPivot);
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(STORAGE_CLOSET.doorWidth, STORAGE_CLOSET.doorHeight - 0.04, 0.12), wall);
  doorLeaf.position.set(STORAGE_CLOSET.doorWidth / 2, (STORAGE_CLOSET.doorHeight - 0.04) / 2, 0);
  doorLeaf.castShadow = doorLeaf.receiveShadow = true;
  doorPivot.add(doorLeaf);
  const doorBody = physics.addBoxFromMesh(doorLeaf);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.09), trim);
  handle.position.set(1.27, 1.15, 0.105);
  doorPivot.add(handle);
  const doorInset = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.65, 0.018), dark);
  doorInset.position.set(0.75, 1.4, 0.07);
  doorPivot.add(doorInset);
  const doorIndicator = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.012), lightStrip);
  doorIndicator.position.set(1.27, 1.38, 0.11);
  doorPivot.add(doorIndicator);
  const doorPosition = new THREE.Vector3();
  const doorRotation = new THREE.Quaternion();

  const drone = new THREE.Group();
  drone.name = 'StoragePatrolCameraDrone';
  scene.add(drone);
  const droneLensMaterial = new THREE.MeshBasicMaterial({ color: 0xffb64b });
  const fallbackDrone = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), trim);
  drone.add(fallbackDrone);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), droneLensMaterial);
  lens.position.z = 0.37;
  drone.add(lens);
  const droneFacing = new THREE.Vector3(-1, 0, 0);
  const droneTarget = new THREE.Vector3();
  let droneDown = false, droneDownTime = 0, droneCaptionTime = 0, corridorRearShot = false;
  const droneBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Sphere(0.4), collisionFilterGroup: 2, collisionFilterMask: 1 });
  droneBody.position.set(0, deckY + 2.02, -2.5); physics.world.addBody(droneBody);
  const droneLight = new THREE.SpotLight(0xc5e7fa, 25, 12, Math.PI / 7, 0.65, 1.3);
  droneLight.name = 'HallwayDroneSearchlight'; droneLight.castShadow = true; droneLight.shadow.mapSize.set(256, 256);
  scene.add(droneLight, droneLight.target);
  const droneBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 1, 1, 24, 1, true),
    new THREE.ShaderMaterial({ vertexShader: beamVertex, fragmentShader: beamFragment,
      uniforms: { uColor: { value: new THREE.Color(0xc5e7fa) }, uTime: { value: 0 }, uAlert: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  droneBeam.name = 'HallwayDroneLightCone'; droneBeam.userData.minimap = false; scene.add(droneBeam);
  const beamFrom = new THREE.Vector3(), beamTo = new THREE.Vector3(), beamUp = new THREE.Vector3(0, 1, 0);
  function updateHallwayLight() {
    droneLight.visible = droneBeam.visible = !droneDown;
    if (droneDown) return;
    beamFrom.copy(drone.position).addScaledVector(droneFacing, 0.45);
    beamTo.copy(drone.position).addScaledVector(droneFacing, 5.5); beamTo.y = deckY + 0.04;
    let nearest = beamFrom.distanceTo(beamTo);
    physics.world.raycastAll(new CANNON.Vec3(beamFrom.x, beamFrom.y, beamFrom.z), new CANNON.Vec3(beamTo.x, beamTo.y, beamTo.z),
      { skipBackfaces: false, checkCollisionResponse: true }, hit => {
        if (hit.body?.type !== CANNON.Body.STATIC || hit.distance >= nearest) return;
        nearest = hit.distance; beamTo.set(hit.hitPointWorld.x, hit.hitPointWorld.y, hit.hitPointWorld.z);
      });
    droneLight.position.copy(beamFrom); droneLight.target.position.copy(beamTo);
    const direction = beamFrom.clone().sub(beamTo), length = direction.length();
    droneBeam.position.copy(beamFrom).add(beamTo).multiplyScalar(0.5);
    droneBeam.quaternion.setFromUnitVectors(beamUp, direction.normalize()); droneBeam.scale.set(length * 0.24, length, length * 0.24);
    droneBeam.material.uniforms.uTime.value = elapsed; droneBeam.material.uniforms.uAlert.value = suspicion;
  }
  let disposed = false;
  const corridorReady = modelLoader('Enemy_EyeDrone').then(gltf => {
    if (disposed) { disposeRoom(gltf.scene); return; }
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 0.95 / Math.max(size.x, size.y, size.z, 0.01);
    gltf.scene.scale.multiplyScalar(scale);
    gltf.scene.position.addScaledVector(center, -scale);
    drone.add(gltf.scene);
    fallbackDrone.visible = false;
    lens.visible = false;
  }).catch(error => console.warn('Storage patrol drone model unavailable:', error));

  const prompt = document.getElementById('interact-prompt');
  const subtitle = document.getElementById('boss-subtitles');
  const status = document.createElement('section');
  status.id = 'stealth-status';
  status.setAttribute('aria-label', 'Stealth status');
  status.innerHTML = '<strong class="stealth-state">UNSEEN</strong><div class="stealth-suspicion" role="progressbar" aria-label="Drone suspicion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>';
  const stateLabel = status.querySelector('strong')!;
  const suspicionTrack = status.querySelector<HTMLElement>('.stealth-suspicion')!;
  const suspicionFill = suspicionTrack.querySelector<HTMLElement>('span')!;
  document.body.appendChild(status);
  const actions = document.createElement('div');
  actions.id = 'stealth-peek-actions';
  actions.className = 'hidden';
  actions.setAttribute('aria-label', 'Door controls');
  for (const [key, label] of [['E', 'Open door'], ['B', 'Back to cover']]) {
    const action = document.createElement('span'); action.className = 'stealth-peek-action';
    const keycap = document.createElement('kbd'); keycap.textContent = key;
    const text = document.createElement('span'); text.textContent = label;
    action.append(keycap, text); actions.appendChild(action);
  }
  document.body.appendChild(actions);
  const retryButton = document.createElement('button');
  retryButton.id = 'stealth-retry';
  retryButton.type = 'button';
  retryButton.className = 'hidden';
  retryButton.textContent = 'Press R to retry from storage';
  retryButton.title = 'Retry from storage (R)';
  if (fromQuarters) { retryButton.textContent = 'Press R to retry from passage'; retryButton.title = 'Retry from the quarters bulkhead (R)'; }
  document.body.appendChild(retryButton);
  const hint = document.createElement('aside');
  hint.id = 'prime-stealth-hint'; hint.className = 'hidden'; hint.setAttribute('aria-live', 'polite');
  const hintHeading = document.createElement('strong'); hintHeading.textContent = 'PRIME';
  const hintText = document.createElement('p');
  const dismissHint = document.createElement('button'); dismissHint.type = 'button'; dismissHint.textContent = 'H';
  dismissHint.title = 'Dismiss hint (H)'; dismissHint.setAttribute('aria-label', 'Dismiss Prime hint');
  hint.append(hintHeading, hintText, dismissHint); document.body.appendChild(hint);
  const checkpointNotice = document.createElement('div'); checkpointNotice.id = 'stealth-checkpoint';
  checkpointNotice.className = 'hidden'; checkpointNotice.textContent = 'CHECKPOINT SAVED';
  checkpointNotice.setAttribute('role', 'status'); document.body.appendChild(checkpointNotice);
  const skip = document.createElement('button'); skip.id = 'stealth-cinematic-skip'; skip.className = 'hidden';
  skip.type = 'button'; document.body.appendChild(skip);
  const bars = document.createElement('div'); bars.id = 'stealth-letterbox'; bars.setAttribute('aria-hidden', 'true'); document.body.appendChild(bars);
  const transferFade = document.createElement('div'); transferFade.id = 'stealth-transfer-fade'; transferFade.setAttribute('aria-hidden', 'true');
  transferFade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:1801';
  document.body.appendChild(transferFade);
  const uiNodes = [status, actions, retryButton, hint, checkpointNotice, skip, bars, transferFade];
  if (!active) uiNodes.forEach(node => { node.style.visibility = 'hidden'; });

  const hangar = createStealthHangar(scene, physics, deckY);

  let elapsed = 0;
  let peeking = false;
  let peekTime = 0;
  let doorOpen = false;
  let doorAngle = 0;
  let suspicion = 0;
  let caught = false;
  let lastDelta = 0;
  let checkpoint = restoreCheckpoint, introSeen = restoreCheckpoint, entranceRequested = false, complete = false;
  let secondHalfReached = false;
  let quartersRequested = false, passageCaptionTime = fromQuarters ? 8 : 0;
  type Destination = 'quarters' | 'stage-two' | 'camera-room';
  let doorwayTransfer: { destination: Destination; error: boolean } | null = null;
  let blockedTransfer: Destination | null = null;
  let alarmAge = 0, hintTime = 0, hintCooldown = 3.5, noticeTime = 0, menuPaused = false;
  let hintsOn = hintsEnabled;
  let volleyCount = 0;
  let corridorDeathAt = -1;
  let corridorDeathFinished = false;
  let arrivalTime = openingEntry && !restoreCheckpoint && !fromQuarters ? 0 : HOLOGRAM_TRANSFER_DURATION;
  let corridorEngaged = !fromQuarters, corridorPatrolTime = 0;
  const usedHints = new Set<string>(), panelCooldowns = new Map<string, number>();
  type Cinematic = { kind: 'reveal' | 'alarm' | 'capture' | 'takedown';
    time: number; actor?: StealthActor; start: THREE.Vector3; startYaw: number; cameraStart: THREE.Vector3;
    facing?: THREE.Vector3; approachActors?: StealthActor[]; entryWalk?: { start: THREE.Vector3; time: number } };
  let cinematic: Cinematic | null = null;
  let climbing: { ladder: typeof hangar.ladders[number]; down: boolean; time: number; start: THREE.Vector3; duration: number } | null = null;
  let fastClimb = false, airlockCaptionTime = 0;
  let audioContext: AudioContext | null = null;
  const peekStartPosition = new THREE.Vector3();
  const peekStartRotation = new THREE.Quaternion();
  const peekTargetPosition = new THREE.Vector3(0.69, deckY + 1.55, -0.16);
  const peekCamera = new THREE.PerspectiveCamera();
  const shotCamera = new THREE.PerspectiveCamera();
  const cinematicPosition = new THREE.Vector3(), cinematicFocus = new THREE.Vector3();
  const actorDirection = new THREE.Vector3();

  function inStorage() {
    return Math.abs(player.body.position.x) < STORAGE_CLOSET.width / 2
      && player.body.position.z > 0.2 && player.body.position.z < STORAGE_CLOSET.depth;
  }
  function observation() {
    const state = player.getState();
    return { position: player.body.position, crouching: state.crouching, sprinting: state.sprinting, moving: state.isMoving,
      protected: peeking || director.isProtected(player.body.position) || inStorage(),
      enabled: checkpoint && !caught && !complete && !doorwayTransfer && cinematic?.kind !== 'reveal' };
  }
  const director = createStealthDirector(scene, physics, hangar, {
    onAlarm: actor => startAlarm(actor),
    getPlayerPosition: () => player.body.position,
    onDroneShotBlocked: () => {
      droneCaptionTime = 3;
      if (subtitle) { subtitle.textContent = 'Eye-drone armour. Shoot directly from behind.'; subtitle.classList.remove('hidden'); }
    },
    onAttack: (_actor, damage) => {
      if (!caught && !doorwayTransfer && cinematic?.kind !== 'reveal') {
        player.takeDamage(Math.min(damage, Math.max(0, player.getHealth() - 1))); ping(920, 0.12);
      }
    },
  }, modelLoader);
  const ready = Promise.all([corridorReady, director.ready]).then(() => undefined);
  const map: ShipMapLayout = { ...DECK_ONE_MAP, initialRoom: fromQuarters ? 29 : 30 };

  function ensureAudio() {
    if (!audioContext && typeof window.AudioContext === 'function') {
      try {
        audioContext = new AudioContext();
      } catch (error) { console.warn('[Stealth] Audio could not be initialized:', error); return; }
    }
    void audioContext?.resume().catch(error => console.warn('[Stealth] Audio could not be resumed:', error));
  }
  function ping(frequency: number, duration = 0.18) {
    if (!audioContext || menuPaused) return;
    const context = audioContext, oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(getAudioSettings().sfx * 0.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function hideHint() { hintTime = 0; hint.classList.add('hidden'); }
  function showHint(id: string, text: string) {
    if (!hintsOn || usedHints.has(id) || hintCooldown > 0 || peeking || cinematic || caught) return;
    usedHints.add(id); hintText.textContent = inputHint(text); hintTime = 4.5; hintCooldown = 30;
    hint.classList.remove('hidden');
  }
  function lock(locked: boolean) {
    player.setInputLocked(locked); player.setLookLocked(locked); player.clearInput();
  }
  function startCinematic(kind: Cinematic['kind'], actor?: StealthActor) {
    if (disposed) return;
    if (peeking) endPeek(false);
    cinematic = { kind, time: 0, actor, start: new THREE.Vector3().copy(player.body.position),
      startYaw: player.getState().yaw, cameraStart: camera.position.clone(),
      facing: actor ? new THREE.Vector3(0, 0, 1).applyQuaternion(actor.root.quaternion) : undefined,
      entryWalk: kind === 'reveal' && !checkpoint ? { start: new THREE.Vector3().copy(player.body.position), time: 0 } : undefined,
      approachActors: kind === 'alarm' ? director.actors.filter(candidate => candidate.mode === 'charge').sort((first, second) =>
        first.root.position.distanceTo(new THREE.Vector3().copy(player.body.position))
        - second.root.position.distanceTo(new THREE.Vector3().copy(player.body.position))) : undefined };
    lock(true); hideHint();
    if (active) { prompt?.classList.add('hidden'); document.body.classList.add('stealth-cinematic'); }
    skip.classList.toggle('hidden', !canSkipCinematic());
  }
  function endCinematic() {
    const kind = cinematic?.kind; cinematic = null;
    if (active) document.body.classList.remove('stealth-cinematic'); skip.classList.add('hidden');
    camera.fov = 75; camera.updateProjectionMatrix();
    if (!caught) lock(false);
    if (kind === 'reveal') hintCooldown = 1.2;
  }
  function startAlarm(actor?: StealthActor) {
    if (caught || complete || cinematic?.kind === 'alarm' || cinematic?.kind === 'capture' || alarmAge > 0) return;
    alarmAge = 0.001; suspicion = 1; volleyCount = 0;
    if (climbing) { climbing = null; player.setClimbing(false); }
    entranceRequested = false;
    director.formFiringSquad(player.body.position);
    document.body.classList.add('storage-alert');
    startCinematic('alarm', actor); ensureAudio();
    if (subtitle) { subtitle.textContent = 'Prime: They have sealed the exits.'; subtitle.classList.remove('hidden'); }
  }
  function activatePanel(id: string) {
    const panel = hangar.panels.find(candidate => candidate.id === id);
    if (!panel || (panelCooldowns.get(id) ?? 0) > 0 || director.alarmed || alarmAge > 0) return false;
    panelCooldowns.set(id, 14); panel.indicator.color.setHex(0xffb347); panel.indicator.emissive.setHex(0xff6d20);
    director.emitNoise(panel.position, 24); ping(740, 0.55); return true;
  }
  function eliminateInCorridor() {
    if (caught || complete || checkpoint) return;
    corridorDeathAt = elapsed; caught = true;
    player.takeDamage(player.getHealth() + player.getShield() + 1, true);
    player.disable(); lock(true); hideHint(); ensureAudio(); ping(70, 0.24);
    retryButton.classList.remove('hidden'); prompt?.classList.add('hidden'); subtitle?.classList.add('hidden');
    document.body.classList.add('storage-caught'); document.exitPointerLock?.();
  }
  function canSkipCinematic() {
    return active && !disposed && !menuPaused && (corridorDeathAt >= 0 && !corridorDeathFinished && elapsed - corridorDeathAt < 2.5
      || !caught && (cinematic?.kind === 'alarm' || cinematic?.kind === 'capture' || cinematic?.kind === 'reveal' && checkpoint));
  }
  function finishCapture() {
    if (caught) return;
    if (player.isEnabled()) player.takeDamage(player.getHealth() + player.getShield() + 1, true);
    caught = true; player.disable(); lock(true); hideHint(); retryButton.classList.remove('hidden'); skip.classList.add('hidden');
    document.body.classList.add('storage-caught'); subtitle?.classList.add('hidden'); document.exitPointerLock?.();
  }
  function skipCinematic() {
    if (!canSkipCinematic()) return;
    if (corridorDeathAt >= 0) { corridorDeathFinished = true; skip.classList.add('hidden'); }
    else if (cinematic?.kind === 'reveal') endCinematic();
    else {
      alarmAge = ALARM_SEQUENCE.retry;
      startCinematic('capture'); finishCapture();
    }
  }
  function startLadder(ladder: typeof hangar.ladders[number]) {
    if (alarmAge > 0 || cinematic || climbing) return;
    const down = player.body.position.y > deckY + 2.8;
    const start = new THREE.Vector3().copy(player.body.position);
    fastClimb = player.captureTransition({ x: 0, y: 0, z: 0 }).heldKeys.includes('Space');
    player.setForcedCrouch(false); player.setClimbing(true, down ? -1 : 1); lock(true);
    player.setRotation(ladder.side < 0 ? Math.PI : 0, 0);
    climbing = { ladder, down, time: 0, start, duration: (ladder.height - deckY) / LADDER.climbSpeed + LADDER.mountDuration * 2 };
    prompt?.classList.add('hidden');
  }
  function nearbyLadder() {
    const position = player.body.position, elevated = position.y > deckY + 2.8;
    return hangar.ladders.find(ladder => Math.abs(position.x - ladder.x) < 1
      && Math.abs(position.y - (elevated ? ladder.height + player.radius : deckY + player.radius)) < 0.65
      && Math.abs(position.z - (elevated ? ladder.topZ : ladder.z + ladder.side * LADDER.bodyOffset)) < 1.1);
  }
  function beginTakedown(actor: StealthActor) {
    if (!director.completeTakedown(actor.id)) return;
    actorDirection.set(0, 0, 1).applyQuaternion(actor.root.quaternion);
    player.setRotation(Math.atan2(-actorDirection.x, -actorDirection.z), 0);
    startCinematic('takedown', actor); ping(120, 0.18);
  }

  function syncDoor() {
    doorPivot.rotation.y = -doorAngle;
    doorPivot.updateMatrixWorld(true);
    doorLeaf.getWorldPosition(doorPosition);
    doorLeaf.getWorldQuaternion(doorRotation);
    doorBody.position.set(doorPosition.x, doorPosition.y, doorPosition.z);
    doorBody.quaternion.set(doorRotation.x, doorRotation.y, doorRotation.z, doorRotation.w);
    doorBody.aabbNeedsUpdate = true;
  }

  function nearDoor() {
    return Math.abs(player.body.position.x) < 1.5 && player.body.position.z > -1.3 && player.body.position.z < 1.9;
  }
  function nearQuartersDoor() {
    return !checkpoint && !!onReturnToQuarters && Math.hypot(player.body.position.x + 14, player.body.position.z + 2.5) < 2.6;
  }
  function transferError(request: NonNullable<typeof doorwayTransfer>, error: unknown) {
    if (disposed || doorwayTransfer !== request) return;
    console.error(`[StealthPassage] Unable to enter ${request.destination}:`, error);
    request.error = true; complete = false; player.setInputLocked(false);
    player.setLookLocked(false);
    if (request.destination === 'stage-two') {
      player.setClimbing(false); player.enable();
      const vent = hangar.ladders.find(ladder => ladder.id === 'VentAccessLadder')!;
      player.setPosition(vent.x, deckY + player.radius, vent.z + vent.side * LADDER.bodyOffset);
      player.setRotation(0, 0);
    }
    if (request.destination === 'camera-room') {
      player.setClimbing(false); player.enable(); player.setPosition(84.5, deckY + player.radius, 20);
    }
    transferFade.style.opacity = '0';
    if (subtitle) { subtitle.textContent = inputHint('Unable to load the next area. R to retry / E to cancel.'); subtitle.classList.remove('hidden'); }
  }
  function transferThroughDoor(destination: Destination) {
    if (doorwayTransfer && !doorwayTransfer.error) return;
    const request = { destination, error: false }; doorwayTransfer = request;
    complete = destination !== 'quarters'; player.clearInput(); player.setInputLocked(true);
    if (destination !== 'quarters') { player.setClimbing(true); player.disable(); }
    if (subtitle) { subtitle.textContent = destination === 'quarters' ? 'Opening living quarters...'
      : destination === 'camera-room' ? 'Entering the camera room...' : 'Entering the vents...'; subtitle.classList.remove('hidden'); }
    void Promise.resolve().then(() => {
      if (destination === 'quarters') {
        if (!onReturnToQuarters) throw new Error('The living-quarters return connection is not configured');
        return onReturnToQuarters(player.captureTransition({ x: 0, y: 0, z: 0 }));
      }
      if (destination === 'camera-room') {
        if (!onAirlockEnter) throw new Error('The camera-room airlock connection is not configured');
        return onAirlockEnter(player.captureTransition({ x: 0, y: 0, z: 0 }));
      }
      if (!onComplete) throw new Error('The Stage Two scene connection is not configured');
      return onComplete();
    }).then(entered => {
      if (!entered) transferError(request, new Error('Doorway scene transfer was cancelled or failed'));
    }, error => transferError(request, error));
  }

  function endPeek(open: boolean) {
    peeking = false;
    doorOpen = open;
    player.setInputLocked(false);
    player.setLookLocked(false);
    player.clearInput();
    document.body.classList.remove('storage-peeking');
    actions.classList.add('hidden');
    subtitle?.classList.add('hidden');
    camera.position.copy(peekStartPosition); camera.quaternion.copy(peekStartRotation);
    if (!open) player.setPosition(0, deckY + player.radius, 0.9);
  }

  function beginPeek() {
    if (peeking || caught || doorOpen || cinematic || climbing || player.body.position.z < 0) return;
    peeking = true;
    peekTime = 0;
    peekStartPosition.copy(camera.position);
    peekStartRotation.copy(camera.quaternion);
    player.clearInput();
    player.setInputLocked(true);
    player.setLookLocked(true);
    document.body.classList.add('storage-peeking');
    actions.classList.remove('hidden');
    prompt?.classList.add('hidden');
    hideHint();
  }

  function resetEncounter() {
    endPeek(false);
    elapsed = suspicion = doorAngle = alarmAge = volleyCount = corridorPatrolTime = airlockCaptionTime = 0;
    fastClimb = false; corridorEngaged = !fromQuarters;
    droneDown = false; droneDownTime = droneCaptionTime = 0; drone.visible = true;
    if (droneBody.world !== physics.world) physics.world.addBody(droneBody);
    caught = complete = false; cinematic = climbing = null; doorwayTransfer = null; blockedTransfer = null;
    secondHalfReached = false;
    quartersRequested = false; passageCaptionTime = 0;
    corridorDeathAt = -1;
    corridorDeathFinished = false;
    arrivalTime = HOLOGRAM_TRANSFER_DURATION;
    entranceRequested = checkpoint; introSeen = checkpoint; director.reset();
    player.setClimbing(false); player.enable();
    const spawn = checkpoint ? HANGAR_LAYOUT.checkpoint : fromQuarters ? QUARTERS_PASSAGE_ENTRY : { x: 0, z: 2.25 };
    const state = player.captureTransition({ x: 0, y: 0, z: 0, yaw: 0 });
    player.restoreTransition({ ...state, position: { x: spawn.x, y: deckY + player.radius, z: spawn.z },
      velocity: { x: 0, y: 0, z: 0 }, heldKeys: [], health: 100, shield: 0, yaw: checkpoint || fromQuarters ? -Math.PI / 2 : 0,
      pitch: 0, crouching: false, sprinting: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
    panelCooldowns.clear(); usedHints.clear(); hideHint(); hintCooldown = fromQuarters ? 0.5 : 3; noticeTime = 0;
    checkpointNotice.classList.add('hidden'); skip.classList.add('hidden');
    for (const panel of hangar.panels) { panel.indicator.color.setHex(0x92d1b5); panel.indicator.emissive.setHex(0x5aa883); }
    hangar.entrance.update(1, checkpoint); hangar.exit.update(1, false);
    quartersDoor.update(1, player, false);
    camera.fov = 75; camera.updateProjectionMatrix();
    syncDoor();
    lock(false);
    document.body.classList.remove('storage-alert', 'storage-caught', 'stealth-cinematic');
    retryButton.classList.add('hidden');
  }

  function interact() {
    if (caught || complete || doorwayTransfer || arrivalTime < HOLOGRAM_TRANSFER_DURATION) return;
    ensureAudio();
    if (cinematic) return;
    if (climbing) return;
    if (peeking) endPeek(true);
    else if (!checkpoint && nearDoor()) {
      if (player.body.position.z < 0) { doorOpen = !doorOpen; player.requestAction('Interact'); }
      else if (doorOpen) doorOpen = false;
      else beginPeek();
    } else if (nearQuartersDoor()) {
      quartersRequested = !quartersRequested; player.requestAction('Interact');
    } else if (Math.hypot(player.body.position.x - 14, player.body.position.z + 2.5) < 2.4 && !checkpoint) {
      entranceRequested = true; player.setRotation(-Math.PI / 2, 0); startCinematic('reveal');
    } else {
      const candidate = director.getTakedownCandidate(observation());
      if (candidate) { beginTakedown(candidate); return; }
      const ladder = nearbyLadder();
      if (ladder) { startLadder(ladder); return; }
      const panel = hangar.panels.find(item => item.position.distanceTo(new THREE.Vector3().copy(player.body.position)) < 2.2);
      if (panel) { activatePanel(panel.id); return; }
      if (alarmAge === 0 && Math.abs(player.body.position.y - deckY - player.radius) < 0.8
        && Math.hypot(player.body.position.x - 86, player.body.position.z - 20) < 2.5) {
        if (airlockUnlocked && onAirlockEnter) { transferThroughDoor('camera-room'); return; }
        airlockCaptionTime = 4.7;
        if (subtitle) { subtitle.textContent = 'Door locked.'; subtitle.classList.remove('hidden'); }
        ping(220, 0.3);
      }
    }
  }

  function onKey(event: KeyboardEvent) {
    if (!active || event.repeat || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (climbing && event.code === 'Space') { event.preventDefault(); fastClimb = true; return; }
    if (doorwayTransfer?.error) {
      if (event.code === 'KeyR') { event.preventDefault(); transferThroughDoor(doorwayTransfer.destination); }
      else if (event.code === 'KeyE') {
        event.preventDefault(); blockedTransfer = doorwayTransfer.destination; doorwayTransfer = null;
        subtitle?.classList.add('hidden');
      }
      return;
    }
    const hide = event.code === 'KeyB' || isControllerEvent(event)
      && (peeking && event.code === 'Space' || !caught && event.code === 'KeyR');
    if (event.code === 'KeyE') { event.preventDefault(); interact(); }
    else if (hide && peeking) { event.preventDefault(); endPeek(false); }
    else if (hide && !checkpoint && nearDoor() && doorOpen && alarmAge === 0) { event.preventDefault(); endPeek(false); }
    else if (event.code === 'KeyH') { event.preventDefault(); hideHint(); }
    else if (event.code === 'KeyR' && caught) { event.preventDefault(); resetEncounter(); }
  }
  window.addEventListener('keydown', onKey);
  function resetFastClimb() { fastClimb = false; }
  function onClimbKeyUp(event: KeyboardEvent) { if (event.code === 'Space') resetFastClimb(); }
  window.addEventListener('keyup', onClimbKeyUp); window.addEventListener('blur', resetFastClimb);
  retryButton.addEventListener('click', resetEncounter);
  dismissHint.addEventListener('click', hideHint);
  const skipHold = createHoldToSkip({ button: skip, onSkip: skipCinematic, isAvailable: canSkipCinematic, isPaused: () => menuPaused });

  function applyPeekCamera() {
    if (!peeking) return;
    const blend = THREE.MathUtils.smootherstep(peekTime, 0, 0.42);
    peekCamera.position.copy(peekTargetPosition);
    peekCamera.lookAt(drone.position.x, deckY + 1.9, -2.5);
    camera.position.lerpVectors(peekStartPosition, peekTargetPosition, blend);
    camera.quaternion.slerpQuaternions(peekStartRotation, peekCamera.quaternion, blend);
  }

  function applyCinematicCamera() {
    if (arrivalTime < HOLOGRAM_TRANSFER_DURATION) {
      camera.position.set(0.92, deckY + 1.75, 1.02);
      camera.lookAt(player.body.position.x, deckY + 0.95, player.body.position.z);
      camera.fov = 70; camera.updateProjectionMatrix(); return;
    }
    if (peeking) { applyPeekCamera(); return; }
    if (!cinematic) return;
    const time = cinematic.time, position = player.body.position;
    camera.fov = cinematic.kind === 'reveal' ? 64 : cinematic.kind === 'capture' ? 72 : 60;
    if (cinematic.kind === 'reveal') {
      if (cinematic.entryWalk && time < 2.8) {
        cinematicPosition.set(position.x - 2.5, deckY + 2.1, position.z + 0.65);
        cinematicFocus.set(position.x + 2, deckY + 1.25, position.z); camera.fov = 70;
      } else if (time < 3.4) {
        cinematicPosition.lerpVectors(new THREE.Vector3(18, deckY + 4, -5), new THREE.Vector3(25, deckY + 7.5, -10), time / 3.4);
        cinematicFocus.set(49, deckY + 2.8, 0);
      } else if (time < 6.4) {
        const actor = director.actors[10] ?? director.actors[director.actors.length - 1];
        cinematicPosition.copy(actor.root.position).add(new THREE.Vector3(-2, 1.3, -4));
        cinematicFocus.copy(actor.root.position).add(new THREE.Vector3(2.5, -2.6, 2.5));
      } else if (time < 9.2) {
        cinematicPosition.set(21 + (time - 6.4) * 1.4, deckY + 8.2, -22);
        cinematicFocus.set(28.5, deckY + 6.6, -15);
      } else {
        cinematicPosition.set(80 + (time - 9.2) * 0.7, deckY + 3.5, 13.5);
        cinematicFocus.set(86, deckY + 1.7, 20);
      }
    } else if (cinematic.kind === 'alarm') {
      if (alarmAge < ALARM_SEQUENCE.pullback) {
        const progress = THREE.MathUtils.smootherstep(alarmAge, 0, ALARM_SEQUENCE.pullback);
        const angle = player.getState().yaw + 0.65 + progress * 1.25;
        const radius = THREE.MathUtils.lerp(1.8, 9.5, progress);
        cinematicPosition.set(position.x + Math.sin(angle) * radius, deckY + THREE.MathUtils.lerp(2.1, 9.6, progress), position.z + Math.cos(angle) * radius);
        cinematicPosition.lerpVectors(cinematic.cameraStart, cinematicPosition.clone(), THREE.MathUtils.smoothstep(alarmAge, 0, 0.35));
        cinematicFocus.set(position.x, deckY + 0.95, position.z);
        camera.fov = THREE.MathUtils.lerp(60, 76, progress);
      } else {
        const approaching = cinematic.approachActors!;
        const shot = Math.min(2, Math.floor((alarmAge - ALARM_SEQUENCE.pullback) / 1.13));
        const actor = approaching[Math.min(approaching.length - 1, shot * 5 + 1)] ?? director.actors[0];
        actorDirection.set(position.x - actor.root.position.x, 0, position.z - actor.root.position.z).normalize();
        cinematicPosition.copy(actor.root.position).addScaledVector(actorDirection, -3.5)
          .add(new THREE.Vector3(actorDirection.z * 1.8, actor.kind === 'eye' ? 1 : 2.4, -actorDirection.x * 1.8));
        cinematicFocus.copy(actor.root.position).lerp(new THREE.Vector3(position.x, deckY, position.z), 0.28);
        cinematicFocus.y = actor.root.position.y + 0.7; camera.fov = 66;
      }
    } else if (cinematic.kind === 'takedown' && cinematic.actor) {
      actorDirection.copy(cinematic.facing!);
      cinematicPosition.copy(cinematic.actor.root.position).addScaledVector(actorDirection, -2.5).add(new THREE.Vector3(1.2, 1.9, 0.6));
      cinematicFocus.copy(cinematic.actor.root.position).add(new THREE.Vector3(0, 0.8, 0));
    } else {
      if (alarmAge < ALARM_SEQUENCE.surround) {
        const orbit = (alarmAge - ALARM_SEQUENCE.approaches) * 0.65 + player.getState().yaw;
        cinematicPosition.set(position.x + Math.sin(orbit) * 9.5, deckY + 9.7, position.z + Math.cos(orbit) * 9.5);
        cinematicFocus.set(position.x, deckY + 0.75, position.z); camera.fov = 78;
      } else if (alarmAge < ALARM_SEQUENCE.volley) {
        const actor = director.actors.filter(candidate => candidate.mode === 'charge' && candidate.formation)
          .sort((first, second) => first.root.position.distanceTo(first.formation!) - second.root.position.distanceTo(second.formation!))[0] ?? director.actors[0];
        actorDirection.set(position.x - actor.root.position.x, 0, position.z - actor.root.position.z).normalize();
        cinematicPosition.copy(actor.root.position).addScaledVector(actorDirection, 1.65)
          .add(new THREE.Vector3(actorDirection.z * 1.1, actor.kind === 'eye' ? 0.4 : 1.25, -actorDirection.x * 1.1));
        cinematicFocus.copy(actor.root.position).add(new THREE.Vector3(0, actor.kind === 'eye' ? 0 : 0.85, 0)); camera.fov = 52;
      } else {
        const progress = THREE.MathUtils.smootherstep(alarmAge, ALARM_SEQUENCE.volley, ALARM_SEQUENCE.retry);
        const angle = player.getState().yaw + 2.2 + progress * 0.7, radius = THREE.MathUtils.lerp(8, 12, progress);
        cinematicPosition.set(position.x + Math.sin(angle) * radius, deckY + 9.9, position.z + Math.cos(angle) * radius);
        cinematicFocus.set(position.x, deckY + (alarmAge < ALARM_SEQUENCE.collapse ? 0.85 : 0.25), position.z); camera.fov = 76;
      }
    }
    if (cinematic.kind === 'alarm' || cinematic.kind === 'capture') {
      let blocked = false;
      const from = player.body.position.clone(); from.set(cinematicFocus.x, cinematicFocus.y, cinematicFocus.z);
      const to = from.clone(); to.set(cinematicPosition.x, cinematicPosition.y, cinematicPosition.z);
      const length = from.distanceTo(to);
      physics.world.raycastAll(from, to, { skipBackfaces: false, checkCollisionResponse: true }, hit => {
        if (hit.body?.type === CANNON.Body.STATIC && hit.distance < length - 0.2) blocked = true;
      });
      if (blocked) {
        cinematicPosition.set(cinematicFocus.x + 0.08, deckY + (position.x < 14 ? 2.65 : 9.4), cinematicFocus.z + 0.15);
        camera.fov = 78;
      }
    }
    camera.position.copy(cinematicPosition); shotCamera.position.copy(cinematicPosition); shotCamera.lookAt(cinematicFocus);
    camera.quaternion.copy(shotCamera.quaternion); camera.updateProjectionMatrix();
  }

  function updateTraversal(frame: number, thirdPerson: boolean) {
    if (!climbing) return;
    climbing.time += frame * (fastClimb ? 2 : 1);
    const { ladder, down, start, duration } = climbing;
    const progress = THREE.MathUtils.clamp(climbing.time / duration, 0, 1);
    const height = down ? deckY + player.radius : ladder.height + player.radius;
    const standZ = ladder.z + ladder.side * LADDER.bodyOffset;
    const mount = THREE.MathUtils.smoothstep(climbing.time, 0, LADDER.mountDuration);
    const rise = THREE.MathUtils.clamp((climbing.time - LADDER.mountDuration) / (duration - LADDER.mountDuration * 2), 0, 1);
    const dismount = THREE.MathUtils.smoothstep(climbing.time, duration - LADDER.mountDuration, duration);
    player.body.position.set(THREE.MathUtils.lerp(start.x, ladder.x, mount), THREE.MathUtils.lerp(start.y, height, rise),
      THREE.MathUtils.lerp(THREE.MathUtils.lerp(start.z, standZ, mount), down ? standZ : ladder.topZ, dismount));
    player.body.aabbNeedsUpdate = true; player.updateCamera(0, thirdPerson);
    if (ladder.id === 'VentAccessLadder' && !down) transferFade.style.opacity = String(THREE.MathUtils.smoothstep(progress, 0.94, 1));
    if (progress >= 1) {
      player.setClimbing(false); climbing = null;
      if (ladder.id === 'VentAccessLadder' && !down && onComplete) {
        transferThroughDoor('stage-two');
      } else { transferFade.style.opacity = '0'; lock(false); }
    }
  }

  function updateHints(frame: number) {
    hintCooldown -= frame; hintTime -= frame;
    if (hintTime <= 0 || !hintsOn) hint.classList.add('hidden');
    if (!hintsOn || cinematic || peeking || alarmAge > 0 || caught || hintCooldown > 0) return;
    const position = player.body.position;
    if (!checkpoint) {
      if (fromQuarters && !corridorEngaged) showHint('quarters-approach', 'Storage is halfway. Hide inside when the eye comes.');
      else if (position.z > 0) showHint('closet', 'Let the camera pass.');
      else showHint('passage', 'Stay behind the drone.');
    } else if (player.body.position.y > deckY + 2.8) showHint('roof', 'Catwalks are exposed. Drop behind cargo if they sweep.');
    else if (director.suspicion > 0.25) showHint('suspicion', 'Break line of sight. Don\'t sprint.');
    else if (position.x > 70) showHint('exit', 'Airlock locked. Use the ceiling ladder at the far end, opposite the door.');
    else if (director.distractions === 0 && position.x > 32) showHint('distraction', 'Shoot metal away from you to pull them off.');
    else if (hangar.ladders.some(ladder => Math.hypot(position.x - ladder.x, position.z - ladder.z) < 8)) showHint('ladder', 'Ladders reach the container roofs.');
    else if (hangar.panels.some(panel => Math.hypot(position.x - panel.position.x, position.z - panel.position.z) < 9)) showHint('relay', 'Relays fake a fault. Patrols check it.');
    else showHint('entry', 'Stay behind the containers.');
  }

  function updatePhysics(dt: number, thirdPerson = false) {
    if (disposed || !active) return;
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    lastDelta = frame;
    const takedown = cinematic?.kind === 'takedown';
    if (!takedown) elapsed += frame;
    if (arrivalTime < HOLOGRAM_TRANSFER_DURATION) {
      arrivalTime = Math.min(HOLOGRAM_TRANSFER_DURATION, arrivalTime + frame);
      if (arrivalTime >= HOLOGRAM_TRANSFER_DURATION) {
        lock(false);
        if (!cinematic && !peeking) document.body.classList.remove('stealth-cinematic');
      }
    }
    if (peeking) peekTime += frame;
    if (corridorEngaged && !takedown) corridorPatrolTime += frame;
    const patrolTime = fromQuarters ? corridorPatrolTime : elapsed, phase = 2.15 + patrolTime * 0.19;
    if (!droneDown) {
      drone.position.set(Math.sin(phase) * 11, deckY + 2.02 + Math.sin(patrolTime * 2.2) * 0.055, -2.5);
      droneFacing.x = Math.cos(phase) >= 0 ? 1 : -1;
      drone.lookAt(droneTarget.copy(drone.position).add(droneFacing));
      droneBody.position.set(drone.position.x, drone.position.y, drone.position.z); droneBody.aabbNeedsUpdate = true;
    } else if (!takedown) {
      droneDownTime += frame; drone.position.y = Math.max(deckY + 0.4, drone.position.y - frame * 2);
      drone.rotation.z = Math.min(1.5, droneDownTime * 2);
      if (droneDownTime > 2) drone.visible = false;
    }
    updateHallwayLight();
    doorAngle = THREE.MathUtils.damp(doorAngle, doorOpen ? Math.PI / 2 : peeking ? 0.045 : 0, 9, frame);
    syncDoor();
    physics.step(frame, player, thirdPerson);
    quartersDoor.update(frame, player, quartersRequested || doorwayTransfer?.destination === 'quarters');
    updateTraversal(frame, thirdPerson);
    roomLight.intensity = 2.5 * (0.95 + Math.sin(elapsed * 3.7) * 0.05);
    for (const [id, cooldown] of panelCooldowns) {
      const remaining = Math.max(0, cooldown - frame); panelCooldowns.set(id, remaining);
      if (remaining === 0) {
        const panel = hangar.panels.find(item => item.id === id)!;
        panel.indicator.color.setHex(0x92d1b5); panel.indicator.emissive.setHex(0x5aa883);
      }
    }
    const position = player.body.position;
    if (!secondHalfReached && position.x >= HANGAR_LAYOUT.musicTriggerX && position.x <= HANGAR_LAYOUT.bounds.maxX
      && position.z >= HANGAR_LAYOUT.bounds.minZ && position.z <= HANGAR_LAYOUT.bounds.maxZ) secondHalfReached = true;
    if (!corridorEngaged && !checkpoint && position.x >= QUARTERS_PASSAGE_ENTRY.midpointX) {
      corridorEngaged = true; hintCooldown = 0;
      showHint('corridor-midpoint', 'The eye is moving. Hide in storage.');
    }
    const nearEntrance = Math.hypot(position.x - 14, position.z + 2.5) < 3;
    hangar.entrance.update(frame, alarmAge === 0 && (entranceRequested || (checkpoint && nearEntrance)));
    hangar.exit.update(frame, airlockUnlocked && alarmAge === 0 && Math.hypot(position.x - 86, position.z - 20) < 3);
    if (cinematic?.kind === 'reveal' && cinematic.entryWalk && hangar.entrance.open > 0.9) {
      const walk = cinematic.entryWalk; walk.time = Math.min(1.6, walk.time + frame);
      const progress = THREE.MathUtils.smoothstep(walk.time, 0, 1.6);
      player.setPosition(THREE.MathUtils.lerp(walk.start.x, HANGAR_LAYOUT.checkpoint.x, progress), deckY + player.radius,
        THREE.MathUtils.lerp(walk.start.z, HANGAR_LAYOUT.checkpoint.z, progress));
    }
    if (!checkpoint && position.x > 14.85 && Math.abs(position.z + 2.5) < 1.6 && hangar.entrance.open > 0.9) {
      checkpoint = true; introSeen = true; noticeTime = 2.5;
      checkpointNotice.classList.remove('hidden'); retryButton.textContent = 'Press R to retry from hangar'; retryButton.title = 'Retry from hangar checkpoint (R)';
      player.setRotation(-Math.PI / 2, 0);
      if (cinematic?.kind !== 'reveal') {
        player.setPosition(HANGAR_LAYOUT.checkpoint.x, deckY + player.radius, HANGAR_LAYOUT.checkpoint.z); startCinematic('reveal');
      } else skip.classList.remove('hidden');
    }
    if (blockedTransfer === 'quarters' && position.x > -13.25 || blockedTransfer === 'stage-two' && position.x < 85.25) blockedTransfer = null;
    if (!cinematic && !caught && !doorwayTransfer && quartersRequested && blockedTransfer !== 'quarters'
      && quartersDoor.open > 0.95 && position.x < -14.4 && Math.abs(position.z + 2.5) < 1.6)
      transferThroughDoor('quarters');
    if (passageCaptionTime > 0 && !cinematic && !peeking && !doorwayTransfer) {
      passageCaptionTime = Math.max(0, passageCaptionTime - frame);
      if (subtitle) {
        subtitle.textContent = 'Prime: Hide in storage when the eye passes.';
        subtitle.classList.toggle('hidden', passageCaptionTime === 0);
      }
    }
    if (airlockCaptionTime > 0 && !cinematic && !doorwayTransfer) {
      airlockCaptionTime = Math.max(0, airlockCaptionTime - frame);
      if (subtitle) {
        subtitle.textContent = airlockCaptionTime > 3.2 ? 'Door locked.' : 'Prime: We must find another way.';
        subtitle.classList.toggle('hidden', airlockCaptionTime === 0);
      }
    }
    if (droneCaptionTime > 0 && !cinematic && !doorwayTransfer) {
      droneCaptionTime = Math.max(0, droneCaptionTime - frame);
      if (droneCaptionTime === 0) subtitle?.classList.add('hidden');
    }
    if (noticeTime > 0) { noticeTime -= frame; if (noticeTime <= 0) checkpointNotice.classList.add('hidden'); }
    if (takedown) director.updateTakedown(frame, cinematic?.actor?.id);
    else director.update(frame, observation());

    let visible = false;
    if (!droneDown && corridorEngaged && !peeking && !caught && !checkpoint && alarmAge === 0 && !doorwayTransfer) {
      const from = player.body.position.clone();
      from.set(drone.position.x, drone.position.y, drone.position.z);
      const to = player.body.position.clone();
      to.y += player.getState().crouching ? 0.6 : 1.3;
      const distance = from.distanceTo(to);
      const facing = (to.x - from.x) * droneFacing.x / Math.max(distance, 0.001);
      if (distance < 7.5 && facing > Math.cos(THREE.MathUtils.degToRad(55))) {
        let blocked = false;
        physics.world.raycastAll(from, to, { skipBackfaces: true, checkCollisionResponse: true }, hit => {
          if (hit.body && hit.body !== player.body && hit.distance < distance - 0.05) blocked = true;
        });
        visible = !blocked;
      }
    }
    if (!caught && alarmAge === 0) suspicion = checkpoint ? director.suspicion
      : THREE.MathUtils.clamp(suspicion + (visible ? frame * 0.95 : -frame * 1.5), 0, 1);
    if (suspicion >= 1 && !caught && alarmAge === 0) {
      if (!checkpoint) eliminateInCorridor();
      else director.forceAlarm(director.actors[0].id);
    }
    if (alarmAge > 0) {
      alarmAge += frame;
      if (alarmAge >= ALARM_SEQUENCE.approaches && !caught && cinematic?.kind !== 'capture') {
        director.formFiringSquad(player.body.position); startCinematic('capture');
      }
      if (!caught && alarmAge >= ALARM_SEQUENCE.volley + volleyCount * 0.3 && volleyCount < 3) { director.fireVolley(); volleyCount++; }
      if (alarmAge >= ALARM_SEQUENCE.collapse && player.isEnabled()) {
        player.takeDamage(player.getHealth() + player.getShield() + 1, true); player.disable();
      }
    }
    hangar.updateAlarm(frame, alarmAge > 0);
    hangar.fillLight.visible = checkpoint || cinematic?.kind === 'reveal' || player.body.position.x > 13.5;
    if (cinematic) {
      cinematic.time += frame;
      if (cinematic.kind === 'reveal' && cinematic.time >= 11.8) endCinematic();
      else if (cinematic.kind === 'alarm' && cinematic.time >= 2.4) subtitle?.classList.add('hidden');
      else if (cinematic.kind === 'takedown') {
        if (cinematic.actor) {
          actorDirection.copy(cinematic.facing!);
          const reach = cinematic.actor.root.position.clone().addScaledVector(actorDirection, -0.65); reach.y = deckY + player.radius;
          const blend = THREE.MathUtils.smoothstep(cinematic.time, 0, 0.35);
          player.body.position.set(THREE.MathUtils.lerp(cinematic.start.x, reach.x, blend), reach.y,
            THREE.MathUtils.lerp(cinematic.start.z, reach.z, blend)); player.body.aabbNeedsUpdate = true;
        }
        if (cinematic.time >= 1.65) endCinematic();
      } else if (cinematic.kind === 'capture' && alarmAge >= ALARM_SEQUENCE.retry && !caught) {
        finishCapture();
      }
    }
    skip.classList.toggle('hidden', !canSkipCinematic()); skipHold.update(frame);
    if (complete) return;
    updateHints(frame);
    const safe = director.isProtected(player.body.position) || peeking || inStorage();
    status.dataset.state = caught || alarmAge > 0 ? 'caught' : suspicion > 0 ? 'suspicious' : safe ? 'safe' : 'unseen';
    stateLabel.textContent = caught ? corridorDeathAt >= 0 ? 'ELIMINATED' : 'OVERRUN'
      : alarmAge > 0 ? 'LOCKDOWN' : safe ? 'HIDDEN' : suspicion > 0 ? 'SUSPICIOUS' : 'UNSEEN';
    suspicionFill.style.width = `${suspicion * 100}%`;
    suspicionTrack.setAttribute('aria-valuenow', String(Math.round(suspicion * 100)));
    droneLensMaterial.color.setHex(suspicion > 0 ? 0xff4659 : 0xffb64b);
    if (prompt) {
      let text = '';
      if (!checkpoint && nearDoor()) text = doorOpen ? 'E: close door / B: hide' : player.body.position.z < 0 ? 'E: open storage door' : 'E: peek';
      else if (nearQuartersDoor()) text = `E: ${quartersRequested ? 'close' : 'open'} living-quarters bulkhead`;
      else if (!checkpoint && nearEntrance) text = 'E: open bulkhead';
      else if (director.getTakedownCandidate(observation())) text = 'E: silent takedown';
      else if (nearbyLadder()) text = player.body.position.y > deckY + 2.8 ? 'E: descend / Hold Space: faster' : 'E: climb / Hold Space: faster';
      else {
        const panel = hangar.panels.find(item => Math.hypot(position.x - item.position.x, position.z - item.position.z) < 1.8);
        if (panel) text = (panelCooldowns.get(panel.id) ?? 0) > 0 ? 'Relay cooling down' : 'E: trigger fault';
        else if (Math.abs(position.y - deckY - player.radius) < 0.8
          && Math.hypot(position.x - 86, position.z - 20) < 2.5) text = 'E: airlock';
      }
      prompt.textContent = inputHint(isControllerActive() ? text.replace('B: hide', 'D-pad Left: hide') : text);
      prompt.classList.toggle('hidden', !text || peeking || caught || !!cinematic || !!climbing || !!doorwayTransfer || alarmAge > 0);
    }
  }
  if (arrivalTime < HOLOGRAM_TRANSFER_DURATION) { lock(true); if (active) document.body.classList.add('stealth-cinematic'); }
  if (restoreCheckpoint) {
    player.setPosition(fromCameraRoom ? 84.5 : HANGAR_LAYOUT.checkpoint.x, deckY + player.radius, fromCameraRoom ? 20 : HANGAR_LAYOUT.checkpoint.z);
    player.setRotation(fromCameraRoom ? Math.PI / 2 : -Math.PI / 2, 0); entranceRequested = true;
    retryButton.textContent = 'Press R to retry from hangar'; retryButton.title = 'Retry from hangar checkpoint (R)';
  }
  updatePhysics(0);

  return {
    roomId: 'stage1-storage', scene, camera, physicsWorld: physics.world, player, ready, updatePhysics,
    getMusicTrack: (): 'stealth-1' | 'stealth-2' | 'stealth-alert' => caught || alarmAge > 0
      ? 'stealth-alert' : secondHalfReached ? 'stealth-2' : 'stealth-1',
    activate() {
      if (disposed) throw new Error('Cannot activate a disposed stealth passage');
      active = true; uiNodes.forEach(node => { node.style.visibility = ''; });
      document.body.classList.toggle('stealth-cinematic', arrivalTime < HOLOGRAM_TRANSFER_DURATION || peeking || cinematic !== null);
      player.enable(); updatePhysics(0);
    },
    requiresRecoveredPistol: fromQuarters,
    getMapLayout: () => map,
    getMapSceneId: () => `scene${checkpoint ? player.body.position.y >= deckY + HANGAR_LAYOUT.ventAccess.height - 0.1
      && Math.hypot(player.body.position.x - HANGAR_LAYOUT.ventAccess.x, player.body.position.z - HANGAR_LAYOUT.ventAccess.z) < 2 ? 32 : 31
      : inStorage() ? 30 : 29}`,
    cutsceneManager: null,
    get ownsWeaponInput() { return arrivalTime < HOLOGRAM_TRANSFER_DURATION || peeking || caught || !!cinematic || !!climbing; },
    canToggleView: () => arrivalTime >= HOLOGRAM_TRANSFER_DURATION && !peeking && !caught && !cinematic && !climbing,
    controlsReady: () => false,
    isCinematic: () => arrivalTime < HOLOGRAM_TRANSFER_DURATION || peeking || !!cinematic || !!climbing || complete || corridorDeathAt >= 0,
    hideCharacter: () => peeking,
    getCinematicState: () => complete ? { ...player.getState(), isMoving: false, isOnGround: false, climbing: false, jumping: false }
      : climbing ? { ...player.getState(), isMoving: false, isOnGround: false, climbing: true, jumping: false }
      : arrivalTime < HOLOGRAM_TRANSFER_DURATION || peeking || cinematic || corridorDeathAt >= 0 ? { ...player.getState(),
      isMoving: !!cinematic?.entryWalk && cinematic.entryWalk.time > 0 && cinematic.entryWalk.time < 1.6,
      isOnGround: true, sprinting: false } : null,
    getCinematicDelta: () => lastDelta,
    getHologramTransition: () => arrivalTime < HOLOGRAM_TRANSFER_DURATION ? hologramTransitionAt(arrivalTime, true) : null,
    applyCinematicCamera: () => {
      if (climbing) { player.updateCamera(0, true); applyTraversalCamera(camera, player, true); }
      else applyCinematicCamera();
    },
    getCinematicPose: () => corridorDeathAt >= 0 ? { clip: 'Death01', time: corridorDeathFinished ? 2.5 : elapsed - corridorDeathAt }
      : climbing ? { clip: 'Ladder_Climb_Loop', loop: true,
        time: climbing.down
          ? LADDER.cycleDuration - (Math.abs(player.body.position.y - climbing.start.y) / LADDER.climbSpeed) % LADDER.cycleDuration
          : Math.abs(player.body.position.y - climbing.start.y) / LADDER.climbSpeed }
      : cinematic?.entryWalk && cinematic.entryWalk.time > 0 && cinematic.entryWalk.time < 1.6 ? { clip: 'Walk_Loop', time: cinematic.entryWalk.time }
      : cinematic?.kind === 'takedown' ? { clip: 'Silent_Takedown', time: cinematic.time }
      : cinematic?.kind === 'capture' && alarmAge >= ALARM_SEQUENCE.volley ? { clip: 'Death01', time: alarmAge - ALARM_SEQUENCE.volley }
      : { clip: 'Idle_Loop', time: elapsed },
    onPistolShot: (point: THREE.Vector3) => {
      if (cinematic || peeking || caught || climbing) return;
      if (corridorRearShot) { corridorRearShot = false; return; }
      if (director.consumeSilentDroneShot()) return;
      const panel = hangar.panels.find(item => Math.hypot(point.x - item.position.x, point.z - item.position.z) < 1);
      if (panel) activatePanel(panel.id); else director.emitNoise(point, 21);
      ping(180, 0.1);
    },
    getDamageTargets: () => [...director.getDamageTargets(), ...droneDown ? [] : [{
      root: drone, body: droneBody, damage: (amount: number, weapon?: 'pistol' | 'crowbar' | 'lightsaber') => {
        if (!Number.isFinite(amount) || amount <= 0) return false;
        if (weapon !== 'pistol' || !isBehindDrone(drone.position, droneFacing, player.body.position)) {
          droneCaptionTime = 3;
          if (subtitle) { subtitle.textContent = 'Eye-drone armour. Shoot directly from behind.'; subtitle.classList.remove('hidden'); }
          if (!checkpoint) eliminateInCorridor();
          return false;
        }
        droneDown = true; droneDownTime = 0; corridorRearShot = true; suspicion = 0;
        physics.world.removeBody(droneBody); droneLight.visible = droneBeam.visible = false;
        emitComicEffect(scene, 'clank', { source: drone }); return true;
      },
    }]],
    getParryableBolts: () => [],
    minimap: { bounds: { minX: -16, maxX: 86, minZ: -31, maxZ: 31 }, radius: 19, floor: deckY,
      deckLabel: 'DECK ONE', deck: 'upper', stairs: hangar.ladders.slice(0, 2).map(ladder => ({ x: ladder.x, z: ladder.z })) },
    getMinimapState: () => ({ position: player.body.position, yaw: player.getState().yaw,
      goal: { ...HANGAR_LAYOUT.exit, label: 'AIRLOCK' },
      enemies: [...droneDown ? [] : [{ id: 'storage-camera-drone', position: drone.position, yaw: Math.atan2(-droneFacing.x, -droneFacing.z), alerted: suspicion > 0, range: 7.5 }], ...director.getMinimapEnemies()],
      stairs: [...hangar.ladders].sort((first, second) => Math.hypot(first.x - player.body.position.x, first.z - player.body.position.z)
        - Math.hypot(second.x - player.body.position.x, second.z - player.body.position.z)).slice(0, 2).map(ladder => ({ x: ladder.x, z: ladder.z })) }),
    getHintsEnabled: () => hintsOn,
    setHintsEnabled: (value: boolean) => { hintsOn = value; if (!value) hideHint(); else hintCooldown = 0.5; },
    setMenuPaused: (value: boolean) => { menuPaused = value; if (value) { fastClimb = false; skipHold.reset(); } },
    getStageState: () => ({ checkpoint, introSeen, hintsEnabled: hintsOn, fromQuarters, corridorEngaged, safeZone: director.safeZoneFor(player.body.position),
      phase: arrivalTime < HOLOGRAM_TRANSFER_DURATION ? 'arrival' : caught ? 'caught' : complete ? 'complete' : cinematic?.kind ?? (climbing ? 'ladder' : checkpoint ? 'hangar' : peeking ? 'peek' : fromQuarters && !inStorage() ? 'passage' : 'closet'),
      alarm: alarmAge > 0, suspicion, distractions: director.distractions, alarmTime: alarmAge, volleys: volleyCount, firingSquad: director.firingSquad }),
    stealth: director, hangar,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onClimbKeyUp); window.removeEventListener('blur', resetFastClimb);
      if (active) {
        document.body.classList.remove('storage-peeking', 'storage-alert', 'storage-caught', 'stealth-cinematic');
        prompt?.classList.add('hidden'); subtitle?.classList.add('hidden');
      }
      skipHold.dispose();
      status.remove(); actions.remove(); retryButton.remove(); hint.remove(); checkpointNotice.remove(); skip.remove(); bars.remove();
      transferFade.remove();
      director.dispose();
      if (audioContext) void audioContext.close().catch(error => console.warn('[Stealth] Audio context could not close:', error));
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}