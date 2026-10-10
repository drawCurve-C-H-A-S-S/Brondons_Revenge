import * as THREE from 'three';
import { preloadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { createHoldToSkip } from '../../helpers/animation/holdToSkip.js';
import { createPlayer, type PlayerState, type PlayerTransitionState } from '../../scripts/player.js';
import { HOLOGRAM_TRANSFER_DURATION, hologramTransitionAt } from '../../scripts/characterManager.js';
import { CABINS, CABIN_BY_ID, QUARTERS, LIVING_QUARTERS_MAP, cabinPoint, cabinDoorPoint,
  createQuartersProgress, cabinRoomName, FORWARD_BULKHEAD_CODE, quartersEquipmentReady,
  type CabinId, type QuartersLocation, type QuartersProgress } from './layout.js';
import { createCabinFurnishings, disposeQuartersObject, type CabinFurnishings, type CabinModelLoader } from './furnishings.js';
import { createQuartersHull } from './hull.js';
import { createInspectionView, type InspectionTarget } from './inspectionView.js';
import { inputHint } from '../../scripts/gamepadInput.js';

interface QuartersOptions {
  progress?: QuartersProgress;
  skipArrival?: boolean;
  fromPassage?: boolean;
  entryState?: PlayerTransitionState;
  deferActivation?: boolean;
  loadCabinModel?: CabinModelLoader;
  warmRoom?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => Promise<void>;
  onPistolCollected?: () => void;
  onTeleporterCollected?: () => void;
  onCrystalCollected?: () => void;
  onGogglesCollected?: () => void;
  preparePassage?: () => Promise<void>;
  onExitToPassage?: (state: PlayerTransitionState) => Promise<boolean>;
}
interface Interaction {
  kind: 'sign' | 'door' | 'forward' | 'keypad' | 'chest' | 'teleporter' | 'poster' | 'computer';
  cabin?: CabinId;
  root: THREE.Object3D;
  point: THREE.Vector3;
}
interface Cinematic {
  kind: 'arrival' | 'pistol' | 'crystal' | 'goggles' | 'empty-chest' | 'teleporter';
  time: number;
  duration: number;
  ready: boolean;
  error: boolean;
  cabin: CabinId;
}

export async function preloadAssets() {
  await Promise.all([preloadToolModel('Prop_Desk_Small'), preloadToolModel('Prop_Chair'), preloadToolModel('Gun_Revolver')]);
}

export function createScene({ progress = createQuartersProgress(), skipArrival = false, fromPassage = false, entryState, deferActivation = false,
  loadCabinModel, warmRoom, onPistolCollected, onTeleporterCollected, onCrystalCollected, onGogglesCollected,
  preparePassage, onExitToPassage }: QuartersOptions = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a121d); scene.fog = new THREE.Fog(0x0a121d, 22, 48);
  scene.add(new THREE.AmbientLight(0x7895ae, 1.4), new THREE.HemisphereLight(0xbbd7ed, 0x273342, 1.8));
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 90);
  const physics = createScenePhysics();
  const brondon = CABIN_BY_ID.get('brondon')!;
  const spawn = fromPassage ? new THREE.Vector3(0, PHYSICS.playerRadius, 14.25) : cabinPoint(brondon, -0.6, PHYSICS.playerRadius, 0);
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: spawn });
  if (entryState) player.restoreTransition({ ...entryState, position: spawn, velocity: new THREE.Vector3(),
    yaw: fromPassage ? 0 : brondon.side * Math.PI / 2, pitch: 0, heldKeys: [], sprinting: false,
    intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.setRotation(fromPassage ? 0 : brondon.side * Math.PI / 2); player.disable();
  const hull = createQuartersHull(scene, physics, progress);
  const interiors = new Map<CabinId, CabinFurnishings>(), pending = new Map<CabinId, Promise<CabinFurnishings>>();
  const doorRequests = new Set<CabinId>(), doorLoading = new Set<CabinId>(), doorErrors = new Set<CabinId>();
  let lastDoorError: CabinId | null = null;
  let forwardRequested = false, passagePreparing = false, passagePrepared = false, passageTransferring = false;
  let passageFailed = false, passageBlocked = false;
  let location: QuartersLocation = fromPassage ? 'hallway' : 'brondon', disposed = false, paused = false, clock = 0, lastDelta = 0;
  let noticeTime = 0, skipRequested = false, target: Interaction | null = null;
  let cinematic: Cinematic | null = null;
  let inspectionCaptionTime = 0;
  let active = !deferActivation;

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = '', className = '') {
    const node = document.createElement(tag); node.id = id; node.textContent = text; node.className = className; return node;
  }
  const ui = element('div', 'living-quarters-ui');
  if (!active) ui.classList.add('hidden');
  const status = element('section', 'quarters-status');
  const locationLabel = element('strong', 'quarters-location');
  status.append(locationLabel); ui.append(status);
  const notice = element('div', 'quarters-notice', '', 'hidden'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); ui.append(notice);
  const roomName = element('div', 'quarters-room-name', '', 'hidden'); roomName.setAttribute('role', 'status'); roomName.setAttribute('aria-live', 'polite'); ui.append(roomName);
  const prompt = element('div', 'quarters-interact', '', 'hidden'); ui.append(prompt);
  const bars = element('div', 'quarters-letterbox', '', 'hidden'); bars.setAttribute('aria-hidden', 'true'); ui.append(bars);
  const subtitle = element('section', 'quarters-subtitle', '', 'hidden'); subtitle.setAttribute('aria-live', 'polite');
  const speaker = element('strong', 'quarters-speaker', 'Prime'), subtitleText = element('p', 'quarters-subtitle-text');
  subtitle.append(speaker, subtitleText); ui.append(subtitle);
  const skip = element('button', 'quarters-skip', '', 'hidden'); skip.type = 'button'; ui.append(skip);
  const loading = element('div', 'quarters-loading', '', 'hidden'); loading.setAttribute('role', 'status'); ui.append(loading);
  document.body.append(ui);
  const inspection = createInspectionView(scene, camera, ui, () => {
    inspectionCaptionTime = 0; subtitle.classList.add('hidden');
    document.body.classList.remove('quarters-cinematic');
    player.clearInput(); player.enable();
  });

  function inspect(surface: InspectionTarget) {
    player.clearInput(); player.disable(); target = null;
    prompt.classList.add('hidden'); roomName.classList.add('hidden'); notice.classList.add('hidden'); noticeTime = 0;
    subtitle.classList.add('hidden'); inspectionCaptionTime = 0;
    document.body.classList.add('quarters-cinematic'); inspection.open(surface);
  }

  function showNotice(text: string, seconds = 5) {
    prompt.classList.add('hidden'); roomName.classList.add('hidden');
    notice.textContent = text; noticeTime = seconds; notice.classList.remove('hidden');
  }
  function updateStatus() {
    locationLabel.textContent = location === 'hallway' ? 'Living quarters' : cabinRoomName(CABIN_BY_ID.get(location)!);
  }
  function showInteriors(additional?: CabinId) {
    interiors.forEach((room, id) => { room.root.visible = id === location || id === additional
      || doorRequests.has(id) || hull.doors.get(id)!.open > 0; });
  }
  function prepareCabin(id: CabinId): Promise<CabinFurnishings> {
    const definition = CABIN_BY_ID.get(id)!;
    if (definition.locked) return Promise.reject(new Error(`${cabinRoomName(definition)} is locked`));
    const existing = interiors.get(id); if (existing) return Promise.resolve(existing);
    const loading = pending.get(id); if (loading) return loading;
    const preparation = createCabinFurnishings(definition, physics, progress, loadCabinModel).then(async room => {
      if (disposed) { room.dispose(); throw new Error('Living quarters were closed during cabin preparation'); }
      scene.add(room.root);
      try { await warmRoom?.(scene, camera); }
      catch (error) { room.dispose(); throw error; }
      if (disposed) { room.dispose(); throw new Error('Living quarters were closed during cabin preparation'); }
      interiors.set(id, room); showInteriors(cinematic?.cabin); return room;
    }).finally(() => pending.delete(id));
    pending.set(id, preparation);
    return preparation;
  }
  function loadForCinematic(shot: Cinematic) {
    shot.ready = shot.error = false;
    const preparation = prepareCabin(shot.cabin);
    void preparation.then(() => {
      if (disposed || cinematic !== shot) return;
      shot.ready = true;
      if (shot.kind === 'arrival' && skipRequested) finishCinematic();
    }, error => {
      if (disposed || cinematic !== shot) return;
      console.error(`[LivingQuarters] Unable to prepare ${shot.cabin}:`, error);
      shot.error = true;
      loading.textContent = 'Unable to load cabin resources. Press R to retry.';
      loading.classList.remove('hidden');
    });
    return preparation;
  }
  function startCinematic(kind: Cinematic['kind'], cabin: CabinId, duration: number, ready = true) {
    player.clearInput(); player.disable(); target = null; prompt.classList.add('hidden'); roomName.classList.add('hidden');
    cinematic = { kind, cabin, duration, time: 0, ready, error: false };
    bars.classList.remove('hidden'); if (active) document.body.classList.add('quarters-cinematic');
    skip.classList.toggle('hidden', kind !== 'arrival'); skipHold.reset();
    return cinematic;
  }
  function finishCinematic() {
    const shot = cinematic; if (!shot || !shot.ready || shot.error) return;
    if (shot.kind === 'arrival') { progress.arrivalSeen = true; progress.visited.add('brondon'); }
    cinematic = null; skipRequested = false; skipHold.reset();
    bars.classList.add('hidden'); skip.classList.add('hidden'); subtitle.classList.add('hidden'); loading.classList.add('hidden');
    if (active) document.body.classList.remove('quarters-cinematic');
    showInteriors(); camera.fov = 75; camera.updateProjectionMatrix(); player.clearInput(); player.enable();
    updateStatus();
  }
  const skipHold = createHoldToSkip({ button: skip, isAvailable: () => active && cinematic?.kind === 'arrival' && !cinematic.error,
    isPaused: () => paused, onSkip: () => { skipRequested = true; finishCinematic(); } });

  function startDoor(id: CabinId) {
    const cabin = CABIN_BY_ID.get(id)!;
    if (cabin.locked) { showNotice(`${cabinRoomName(cabin)}. Door is locked.`); return; }
    player.requestAction('Interact');
    if (doorRequests.delete(id)) { showInteriors(); return; }
    doorRequests.add(id); doorErrors.delete(id); if (lastDoorError === id) lastDoorError = null;
    if (interiors.has(id) || doorLoading.has(id)) { showInteriors(); return; }
    doorLoading.add(id);
    void prepareCabin(id).then(() => {
      if (disposed) return;
      doorLoading.delete(id); showInteriors();
    }, error => {
      if (disposed) return;
      console.error(`[LivingQuarters] Unable to open ${id}:`, error);
      doorLoading.delete(id); doorRequests.delete(id); doorErrors.add(id); lastDoorError = id;
      showNotice(`Unable to prepare ${cabinRoomName(cabin)}. Press R to retry or interact with the door again.`, 8);
    });
  }
  function passageError(error: unknown) {
    if (disposed) return;
    console.error('[LivingQuarters] Unable to open the Deck One connection:', error);
    passageFailed = true; passagePreparing = passageTransferring = false; player.setInputLocked(false);
    loading.textContent = inputHint('Unable to load Deck One. Press R to retry or E to cancel.'); loading.classList.remove('hidden');
  }
  function prepareBulkhead() {
    if (passagePreparing || passagePrepared) return;
    passageFailed = false; passagePreparing = true;
    void Promise.resolve().then(() => preparePassage?.()).then(() => {
      if (!disposed) { passagePreparing = false; passagePrepared = true; }
    }, passageError);
  }
  function startBulkhead() {
    if (!progress.bulkheadUnlocked) { showNotice('Prime: This bulkhead needs a code. Use the number panel beside it.'); return; }
    if (!quartersEquipmentReady(progress)) {
      showNotice("Prime: Take your pistol and device, the purple crystal from Brendan's chest, and the goggles from Branden's chest before leaving.", 8);
      return;
    }
    forwardRequested = !forwardRequested; player.requestAction('Interact');
    if (forwardRequested) prepareBulkhead();
  }
  function transferToPassage() {
    if (passageTransferring) return;
    if (!quartersEquipmentReady(progress)) { startBulkhead(); return; }
    passageFailed = false; passageTransferring = true; player.clearInput(); player.setInputLocked(true);
    loading.textContent = 'Opening Deck One passage...'; loading.classList.remove('hidden');
    void Promise.resolve().then(() => {
      if (!onExitToPassage) throw new Error('The Deck One scene connection is not configured');
      return onExitToPassage(player.captureTransition({ x: 0, y: 0, z: 0 }));
    }).then(entered => {
      if (!entered) passageError(new Error('Deck One scene transfer was cancelled or failed'));
    }, passageError);
  }
  function updateLocation() {
    const p = player.body.position, half = QUARTERS.hallwayWidth / 2;
    let next = location;
    if (location !== 'hallway') {
      if (CABIN_BY_ID.get(location)!.side * p.x < half - 0.12) next = 'hallway';
    } else {
      const cabin = CABINS.find(cabin => !cabin.locked && interiors.has(cabin.id)
        && cabin.side * p.x > half + 0.12 && cabin.side * p.x < half + QUARTERS.cabinWidth
        && Math.abs(p.z - cabin.z) < QUARTERS.cabinDepth / 2);
      if (cabin) next = cabin.id;
    }
    if (next === location) return;
    location = next; updateStatus(); showInteriors();
    if (next !== 'hallway') {
      const firstVisit = !progress.visited.has(next); progress.visited.add(next);
      if (firstVisit && next !== 'brondon') showNotice(`Prime: ${CABIN_BY_ID.get(next)!.occupant}'s room is clear. Check the chest; we may need anything the crew left behind.`);
    }
  }
  function interactions(): Interaction[] {
    const candidates: Interaction[] = [];
    if (location === 'hallway') {
      for (const cabin of CABINS) {
        const sign = hull.signs.get(cabin.id)!;
        candidates.push({ kind: 'sign', cabin: cabin.id, root: sign, point: sign.position.clone() },
          { kind: 'door', cabin: cabin.id, root: hull.doors.get(cabin.id)!.root, point: cabinDoorPoint(cabin).setY(1.3) });
      }
      candidates.push({ kind: 'forward', root: hull.forwardDoor.root, point: new THREE.Vector3(0, 1.3, 16) },
        { kind: 'keypad', root: hull.keypadRoot, point: hull.keypadRoot.position.clone() });
    } else {
      const room = interiors.get(location), cabin = CABIN_BY_ID.get(location)!;
      candidates.push({ kind: 'door', cabin: location, root: hull.doors.get(location)!.root, point: cabinDoorPoint(cabin).setY(1.3) });
      if (room) {
        candidates.push({ kind: 'chest', cabin: location, root: room.chest, point: room.chestPoint },
          { kind: 'poster', cabin: location, root: room.poster, point: room.poster.getWorldPosition(new THREE.Vector3()) },
          { kind: 'computer', cabin: location, root: room.computer, point: room.computer.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)) });
        if (location === 'brondon' && !progress.teleporterCollected)
          candidates.push({ kind: 'teleporter', cabin: location, root: room.teleporter, point: room.teleporterPoint });
      }
    }
    return candidates.filter(candidate => Math.hypot(candidate.point.x - player.body.position.x,
      candidate.point.z - player.body.position.z) <= QUARTERS.interactionRange);
  }
  const raycaster = new THREE.Raycaster(), center = new THREE.Vector2(), projection = new THREE.Vector3();
  function findTarget() {
    const candidates = interactions();
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); raycaster.setFromCamera(center, camera);
    const hits = raycaster.intersectObjects(candidates.map(candidate => candidate.root), true);
    for (const hit of hits) {
      for (const candidate of candidates) {
        for (let ancestor: THREE.Object3D | null = hit.object; ancestor; ancestor = ancestor.parent) {
          if (ancestor === candidate.root) return candidate;
        }
      }
    }
    // Small controls remain usable with the third-person shoulder offset.
    let selected: Interaction | null = null, best = 0.18;
    for (const candidate of candidates) {
      projection.copy(candidate.point).project(camera);
      const distance = Math.hypot(projection.x, projection.y);
      if (projection.z > -1 && projection.z < 1 && distance < best) { best = distance; selected = candidate; }
    }
    return selected;
  }
  function targetText(candidate: Interaction) {
    const cabin = candidate.cabin ? CABIN_BY_ID.get(candidate.cabin)! : undefined;
    switch (candidate.kind) {
      case 'sign': return '';
      case 'door': return cabin!.locked ? 'E / Check locked door' : doorErrors.has(cabin!.id) ? 'E / Retry cabin loading'
        : `E / ${doorRequests.has(cabin!.id) ? doorLoading.has(cabin!.id) ? 'Cancel door opening' : 'Close door' : 'Open door'}`;
      case 'forward': return progress.bulkheadUnlocked ? `E / ${forwardRequested ? 'Close' : 'Open'} bulkhead` : 'E / Check forward bulkhead';
      case 'keypad': return `E / ${progress.bulkheadUnlocked ? 'Inspect unlocked' : 'Use bulkhead'} keypad`;
      case 'chest': return `E / ${progress.openedChests.has(candidate.cabin!) ? 'Inspect' : 'Open'} personal chest`;
      case 'teleporter': return 'E / Recover the device with the blue LED';
      case 'poster': return 'E / Read expedition poster';
      case 'computer': return candidate.cabin === 'branden' ? 'E / Use computer' : 'E / Inspect workstation';
    }
  }
  function updateInteractionFocus() {
    if (disposed || paused || cinematic || inspection.active || passageTransferring || noticeTime > 0 || !player.isEnabled()) {
      target = null; prompt.classList.add('hidden'); roomName.classList.add('hidden'); return;
    }
    target = findTarget();
    const name = target?.kind === 'sign' && target.cabin ? cabinRoomName(CABIN_BY_ID.get(target.cabin)!) : '';
    roomName.classList.toggle('hidden', !name);
    if (name && roomName.textContent !== name) roomName.textContent = name;
    const actionable = target && target.kind !== 'sign';
    prompt.classList.toggle('hidden', !actionable);
    if (target && actionable) {
      const text = inputHint(targetText(target)); if (prompt.textContent !== text) prompt.textContent = text;
    }
  }
  function interact(candidate: Interaction) {
    const cabin = candidate.cabin ? CABIN_BY_ID.get(candidate.cabin)! : undefined;
    switch (candidate.kind) {
      case 'door': startDoor(candidate.cabin!); break;
      case 'forward': startBulkhead(); break;
      case 'keypad':
        inspect({ screen: hull.keypadScreen, display: hull.keypad, width: 0.54, height: 0.84,
          title: 'Forward bulkhead keypad', pointer: 'hand', onAction: action => {
            if (action !== 'unlock') return;
            hull.forwardDoor.setLocked(false);
            forwardRequested = quartersEquipmentReady(progress);
            if (forwardRequested) prepareBulkhead();
            caption(forwardRequested ? 'That worked. The bulkhead is open. Beyond it, surveillance is live. Stay out of their sight.'
              : "The code worked. First collect the purple crystal from Brendan and the goggles from Branden, then open the bulkhead.");
            inspectionCaptionTime = 7;
          } });
        break;
      case 'poster': player.requestAction('Interact'); showNotice(`${cabin!.occupant}'s expedition poster: "${cabin!.quote}"`, 7); break;
      case 'computer': {
        const room = interiors.get(candidate.cabin!);
        if (candidate.cabin === 'branden' && room?.desktop) {
          inspect({ screen: room.screen, display: room.desktop, width: 0.6, height: 0.34,
            title: "Branden's computer", pointer: 'arrow', onAction: action => {
              if (action === 'read-file') {
                caption(`Branden must've set up one of his many local bots. Here's a password that may be useful: ${FORWARD_BULKHEAD_CODE}.`);
                inspectionCaptionTime = 12;
              } else if (action === 'close-file') { inspectionCaptionTime = 0; subtitle.classList.add('hidden'); }
            } });
        } else {
          player.requestAction('Interact'); showNotice(`${cabin!.occupant}'s computer / Local survey archive. The ship network is disconnected in this wing.`);
        }
        break;
      }
      case 'chest':
        if (progress.openedChests.has(candidate.cabin!) && (candidate.cabin === 'brondon' ? progress.pistolCollected
          : candidate.cabin === 'brendan' ? progress.crystalCollected : candidate.cabin === 'branden' ? progress.gogglesCollected : true)) {
          showNotice(`${cabin!.occupant}'s chest is empty.`); break;
        }
        progress.openedChests.add(candidate.cabin!);
        startCinematic(candidate.cabin === 'brondon' ? 'pistol' : candidate.cabin === 'brendan' ? 'crystal'
          : candidate.cabin === 'branden' ? 'goggles' : 'empty-chest', candidate.cabin!, 4.4);
        break;
      case 'teleporter': startCinematic('teleporter', 'brondon', 5); break;
    }
  }
  function onKey(event: KeyboardEvent) {
    if (event.repeat || event.defaultPrevented || disposed || !active || paused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    if (inspection.active) return;
    if (passageFailed && (event.code === 'KeyR' || event.code === 'KeyE')) {
      event.preventDefault();
      if (event.code === 'KeyR') { if (passagePrepared) transferToPassage(); else prepareBulkhead(); }
      else {
        passageFailed = false; passageBlocked = true; loading.classList.add('hidden');
        showNotice('Transfer cancelled. Walk back through the bulkhead to the hallway.');
      }
      return;
    }
    if (!cinematic && lastDoorError && event.code === 'KeyR') { event.preventDefault(); startDoor(lastDoorError); return; }
    if (cinematic?.error && event.code === 'KeyR') {
      event.preventDefault();
      loadForCinematic(cinematic); return;
    }
    if (event.code !== 'KeyE' || cinematic || passageTransferring || !player.isEnabled()) return;
    target = findTarget();
    if (!target || target.kind === 'sign') return;
    event.preventDefault(); event.stopImmediatePropagation(); interact(target);
  }
  window.addEventListener('keydown', onKey);

  function caption(text: string) {
    speaker.textContent = 'Prime'; subtitleText.textContent = text; subtitle.classList.remove('hidden');
  }
  function updateCinematic(dt: number) {
    const shot = cinematic; if (!shot) return;
    if (shot.error) { loading.classList.remove('hidden'); return; }
    loading.classList.toggle('hidden', shot.ready);
    if (!shot.ready) loading.textContent = 'Preparing cabin systems...';
    if (!shot.ready && (shot.kind === 'arrival' || shot.time >= 0.55)) return;
    shot.time += dt;
    if (shot.kind === 'arrival') {
      const t = shot.time;
      caption(t < 5 ? 'You are in your room, Brondon. Your cabin is the only teleport anchor I can reach.'
        : t < 12 ? 'These living quarters are the only area of the ship without surveillance. The crew privacy systems are isolated from Donus.'
        : t < 19 ? 'Eight cabins. The five students\' doors are locked; your room, Branden\'s and Brendan\'s are unlocked. Check their rooms before trying to escape.'
        : 'Your pistol is in the chest. The small device with a blue LED on your desk is your personal teleporter. Recover both; we will need them.');
    } else if (shot.kind === 'pistol') {
      caption('Your pistol. Take it, then look for the blue LED on your desk.');
      if (shot.time >= 3.1 && !progress.pistolCollected) {
        progress.pistolCollected = true; onPistolCollected?.(); updateStatus();
      }
    } else if (shot.kind === 'teleporter') {
      caption("Your personal teleporter needs a power crystal. Brendan kept a purple one in his chest. Find it before we leave.");
      if (shot.time >= 3.4 && !progress.teleporterCollected) {
        progress.teleporterCollected = true; onTeleporterCollected?.(); updateStatus();
      }
    } else if (shot.kind === 'crystal') {
      caption('The purple crystal powers your teleporter. Keep it ready; the surveillance cameras can provide destination links.');
      if (shot.time >= 3.1 && !progress.crystalCollected) {
        progress.crystalCollected = true; onCrystalCollected?.(); updateStatus();
      }
    } else if (shot.kind === 'goggles') {
      caption("Branden's scanner goggles. Press N to reveal hidden maintenance markings and secret controls.");
      if (shot.time >= 3.1 && !progress.gogglesCollected) {
        progress.gogglesCollected = true; onGogglesCollected?.(); updateStatus();
      }
    } else caption(`${CABIN_BY_ID.get(shot.cabin)!.occupant}'s chest is empty. We can search the rest of the quarters.`);
    if (shot.time >= shot.duration) finishCinematic();
  }

  const view = new THREE.PerspectiveCamera();
  function setShot(from: THREE.Vector3, to: THREE.Vector3, look: THREE.Vector3, progress: number, fov: number) {
    camera.position.lerpVectors(from, to, THREE.MathUtils.smootherstep(progress, 0, 1)); camera.lookAt(look);
    camera.fov = camera.aspect < 1 ? Math.min(88, fov + 16) : fov; camera.updateProjectionMatrix();
  }
  function applyCinematicCamera() {
    if (inspection.active) { inspection.applyCamera(); return; }
    const shot = cinematic; if (!shot) return;
    const cabin = CABIN_BY_ID.get(shot.cabin)!, room = interiors.get(shot.cabin), t = shot.time;
    if (shot.kind === 'arrival') {
      if (t < 5) setShot(cabinPoint(brondon, 1.8, 1.9, 1.8), cabinPoint(brondon, 0.8, 1.65, 1.9),
        spawn.clone().add(new THREE.Vector3(0, 1, 0)), t / 5, 56);
      else if (t < 9) setShot(cabinPoint(brondon, -1.7, 1.8, 1.45), cabinPoint(brondon, -1.7, 1.55, 0),
        cabinPoint(brondon, 1.3, 0.9, -1.25), (t - 5) / 4, 64);
      else if (t < 16) {
        const z = THREE.MathUtils.lerp(-14.2, 5.6, THREE.MathUtils.smootherstep((t - 9) / 7, 0, 1));
        camera.position.set(0.22 * Math.sin(t * 0.5), 1.6 + Math.sin(t * 0.3) * 0.08, z);
        camera.lookAt(-0.1, 1.35, Math.min(z + 8, 15.8)); camera.fov = camera.aspect < 1 ? 88 : 72; camera.updateProjectionMatrix();
      } else if (t < 21) setShot(cabinPoint(brondon, -0.35, 1.35, 1.9), cabinPoint(brondon, 0.5, 1.1, 1.85),
        room?.chestPoint ?? cabinPoint(brondon, 1.7, 0.6, 0.65), (t - 16) / 5, 52);
      else if (t < 24) setShot(cabinPoint(brondon, -1.85, 1.4, 1.5), cabinPoint(brondon, -1.6, 1.18, 1.6),
        room?.teleporterPoint ?? cabinPoint(brondon, -1.12, 0.9, 2.41), (t - 21) / 3, 45);
      else {
        const yaw = player.getState().yaw;
        const destination = new THREE.Vector3().copy(player.body.position);
        destination.y = player.getHeadY() + 0.3;
        destination.add(new THREE.Vector3(Math.sin(yaw) * 1.5 + Math.cos(yaw) * 0.7, 0, Math.cos(yaw) * 1.5 - Math.sin(yaw) * 0.7));
        const blend = THREE.MathUtils.smootherstep((t - 24) / 3, 0, 1);
        view.position.copy(cabinPoint(brondon, -1.6, 1.18, 1.6)); view.lookAt(room?.teleporterPoint ?? cabinPoint(brondon, -1.12, 0.9, 2.41));
        camera.position.lerpVectors(view.position, destination, blend);
        camera.quaternion.slerpQuaternions(view.quaternion, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), blend);
        camera.fov = THREE.MathUtils.lerp(45, 75, blend); camera.updateProjectionMatrix();
      }
    } else {
      const point = shot.kind === 'teleporter' ? room!.teleporterPoint : room!.chestPoint;
      const close = shot.kind === 'teleporter';
      setShot(cabinPoint(cabin, close ? -1.85 : -0.55, close ? 1.45 : 1.4, close ? 1.55 : 1.8),
        cabinPoint(cabin, close ? -1.6 : 0.55, close ? 1.22 : 1.05, close ? 1.7 : 1.85), point, t / shot.duration, close ? 43 : 52);
    }
  }
  function updatePhysics(dt: number, thirdPerson = true) {
    if (disposed || !active || paused) return;
    const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0; lastDelta = frame; clock += frame;
    skipHold.update(frame);
    updateCinematic(frame);
    for (const [id, door] of hull.doors) {
      const p = player.body.position, point = cabinDoorPoint(CABIN_BY_ID.get(id)!);
      const insideOpening = Math.abs(p.x - point.x) < player.radius + 0.16 && Math.abs(p.z - point.z) < QUARTERS.doorWidth / 2 + player.radius;
      door.update(frame, doorRequests.has(id) && interiors.has(id) && !doorLoading.has(id) && !doorErrors.has(id)
        || door.open > 0 && insideOpening);
    }
    hull.forwardDoor.setLocked(!progress.bulkheadUnlocked);
    const p = player.body.position;
    hull.forwardDoor.update(frame, progress.bulkheadUnlocked && quartersEquipmentReady(progress) && (forwardRequested && passagePrepared
      || hull.forwardDoor.open > 0 && Math.abs(p.z - 16) < player.radius + 0.16 && Math.abs(p.x) < QUARTERS.doorWidth / 2 + player.radius));
    showInteriors(cinematic?.cabin);
    if (!inspection.active) hull.keypad.update(frame);
    interiors.forEach(room => room.update(frame, clock));
    if (cinematic) applyCinematicCamera();
    else if (inspection.active) {
      inspection.update(frame);
      inspectionCaptionTime = Math.max(0, inspectionCaptionTime - frame);
      if (inspectionCaptionTime === 0) subtitle.classList.add('hidden');
    }
    else {
      physics.step(frame, player, thirdPerson);
      updateLocation();
      if (passageBlocked && player.body.position.z < 15.25) passageBlocked = false;
      if (progress.bulkheadUnlocked && passagePrepared && forwardRequested && !passageBlocked && !passageFailed
        && location === 'hallway' && player.body.position.z > 16.4
        && Math.abs(player.body.position.x) < QUARTERS.doorWidth / 2) transferToPassage();
      if (!passageFailed && !passageTransferring) {
        const preparing = passagePreparing || doorLoading.size > 0;
        loading.classList.toggle('hidden', !preparing);
        if (preparing) loading.textContent = passagePreparing ? 'Preparing Deck One passage...' : 'Preparing cabin resources...';
      }
    }
    noticeTime = Math.max(0, noticeTime - frame); if (noticeTime === 0) notice.classList.add('hidden');
  }

  let ready: Promise<unknown>;
  if (fromPassage) { if (active) player.enable(); ready = Promise.resolve(); camera.fov = 75; camera.updateProjectionMatrix(); }
  else {
    const arrival = startCinematic('arrival', 'brondon', 27, false); ready = loadForCinematic(arrival);
    if (skipArrival || progress.arrivalSeen) skipRequested = true;
  }
  updateStatus(); applyCinematicCamera();
  return {
    roomId: 'living-quarters', scene, camera, player, physicsWorld: physics.world, ready, updatePhysics,
    activate() {
      if (disposed) throw new Error('Cannot activate disposed living quarters');
      active = true; ui.classList.remove('hidden');
      document.body.classList.toggle('quarters-cinematic', cinematic !== null || inspection.active);
      if (!cinematic && !inspection.active) { player.clearInput(); player.enable(); }
    },
    getSceneId: () => 'scene0.5', getLocation: () => location,
    getMapLayout: () => LIVING_QUARTERS_MAP,
    getMapSceneId: () => `scene${location === 'hallway' ? 20 : CABIN_BY_ID.get(location)!.mapId}`,
    getHologramTransition: () => cinematic?.kind === 'arrival' && cinematic.time < HOLOGRAM_TRANSFER_DURATION
      ? hologramTransitionAt(cinematic.time, true) : null,
    isCinematic: () => cinematic !== null || inspection.active,
    hideCharacter: () => inspection.active,
    get ownsWeaponInput() { return cinematic !== null || inspection.active || passageTransferring || !progress.pistolCollected; },
    getCinematicWeapon: () => null,
    getCinematicDelta: () => lastDelta,
    getCinematicState: (): PlayerState | null => cinematic || inspection.active ? { ...player.getState(),
      isMoving: false, isOnGround: true, jumping: false,
      crouching: false, sprinting: false, actionRequest: null } : null,
    applyCinematicCamera,
    updateInteractionFocus,
    controlsReady: () => !cinematic && !inspection.active && !passageTransferring && !paused,
    hideMinimap: () => cinematic !== null || inspection.active,
    setMenuPaused(value: boolean) { paused = value; player.clearInput(); skipHold.reset(); },
    preloadCabin: prepareCabin,
    doors: hull.doors,
    minimap: {
      bounds: { minX: -8.2, maxX: 8.2, minZ: -16, maxZ: 16 }, floor: 0, deckLabel: 'CREW QUARTERS',
      prepare() {
        const visibility = [...interiors.values()].map(room => [room.root, room.root.visible] as const);
        visibility.forEach(([root]) => { root.visible = true; }); hull.masks.forEach(mask => { mask.visible = true; });
        return () => { visibility.forEach(([root, visible]) => { root.visible = visible; }); hull.masks.forEach(mask => { mask.visible = false; }); };
      },
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKey); skipHold.dispose(); inspection.dispose(); ui.remove();
      if (active) document.body.classList.remove('quarters-cinematic');
      interiors.forEach(room => room.dispose()); interiors.clear(); player.dispose(); physics.dispose(); disposeQuartersObject(scene);
    },
  };
}
