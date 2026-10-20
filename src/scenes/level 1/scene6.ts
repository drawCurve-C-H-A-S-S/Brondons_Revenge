import { playSfx } from '../../helpers/audio/sfx.js';
/**
 * Scene 6 - Target range, reached via the surveillance camera.
 * Same door/threshold mechanics as scene4, entered from a single back door.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import comicVert from '../../shaders/comic.vert.glsl?raw';
import comicFrag from '../../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS, hasNearbyActor } from '../../helpers/physics/scenePhysics.js';
import { createBreakables } from '../../scripts/breakables.js';
import { createRewardChest } from '../../scripts/rewardChest.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createCameraVisitUI } from '../../helpers/scene/cameraVisit.js';
import { SHIP_INTERIOR_PALETTE } from '../../helpers/scene/shipInterior.js';
import { teleportPlayer } from '../../scripts/teleportationDevice.js';
import { cameraVisitMap, type CameraRoomProgress } from '../level 1 stage 2/stageTwoLayout.js';
import { loadToolModel } from '../../core/loader.js';
import fireVertexShader from '../../shaders/fireExplosion.vert.glsl?raw';
import fireFragmentShader from '../../shaders/fireExplosion.frag.glsl?raw';
import { GOGGLES_READABLE_LAYER } from '../../scripts/gogglesPostProcess.js';

const RANGE_WORD = 'BRONDON';
const RANGE_LETTERS = ['N', 'O', 'B', 'N', 'D', 'R', 'O'];
const RANGE_POEM = [
  'Borrow new eyes to see our game;',
  'Read hidden marks and spell your name.',
  'One shot, one letter, keep them true;',
  'No step astray, or flames find you.',
  'Double echoes share their sound;',
  'Only in order is treasure found.',
];

export function createScene({ audioManager, entryState, gogglesCollected = false, onGogglesCollected,
  remoteVisit = false, preview = false, deferActivation = false, loot, hasReturnMarker, onRestart,
  onKeycardCollected, modelLoader = loadToolModel }: {
  audioManager?: unknown; entryState?: PlayerTransitionState;
  gogglesCollected?: boolean; onGogglesCollected?: () => void;
  remoteVisit?: boolean; preview?: boolean; deferActivation?: boolean; loot?: CameraRoomProgress;
  hasReturnMarker?: () => boolean; onRestart?: () => Promise<boolean>;
  onKeycardCollected?: () => void; modelLoader?: typeof loadToolModel;
} = {}) {
  if (remoteVisit && !preview && (!hasReturnMarker || !onRestart || !onKeycardCollected || !loot))
    throw new Error('Camera visits require a return link, checkpoint restart and persistent keycard reward');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(remoteVisit ? SHIP_INTERIOR_PALETTE.background : 0x100a0a);

  // --- Room dimensions ---
  const roomWidth = 10;
  const roomDepth = 10;
  const roomHeight = 4.5;

  // --- Physics ---
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  const floorPhysMat = physics.solidMaterial;

  // --- Procedural tile texture ---
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 256;
  tileCanvas.height = 256;
  const tileCtx = tileCanvas.getContext('2d')!;
  tileCtx.fillStyle = '#8a7a7a';
  tileCtx.fillRect(0, 0, 256, 256);
  tileCtx.strokeStyle = '#6a5a5a';
  tileCtx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) {
    tileCtx.beginPath(); tileCtx.moveTo(x, 0); tileCtx.lineTo(x, 256); tileCtx.stroke();
  }
  for (let y = 0; y <= 256; y += 64) {
    tileCtx.beginPath(); tileCtx.moveTo(0, y); tileCtx.lineTo(256, y); tileCtx.stroke();
  }
  const tileTexture = new THREE.CanvasTexture(tileCanvas);
  tileTexture.wrapS = THREE.RepeatWrapping;
  tileTexture.wrapT = THREE.RepeatWrapping;

  // --- Materials ---
  const floorMat = new THREE.MeshStandardMaterial({
    map: tileTexture.clone(), color: remoteVisit ? 0x536375 : 0x776666, roughness: 0.7, metalness: 0.15,
    emissive: 0x140a0a, emissiveIntensity: 0.35,
  });
  floorMat.map!.repeat.set(5, 5);
  const wallMat = new THREE.MeshStandardMaterial({
    map: tileTexture.clone(), color: remoteVisit ? 0x536375 : 0x6f5f5f, roughness: 0.75, metalness: 0.1,
    emissive: 0x140a0a, emissiveIntensity: 0.3,
  });
  wallMat.map!.repeat.set(5, 2);
  const ceilingMat = new THREE.MeshStandardMaterial({ color: remoteVisit ? 0x182431 : 0x453a3a, roughness: 0.8, metalness: 0.1 });
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.5, roughness: 0.4 });
  function makeComicMaterial(color: number) {
    return new THREE.ShaderMaterial({
      vertexShader: comicVert, fragmentShader: comicFrag,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uLightDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uTime: { value: 0 },
      },
    });
  }
  const tankMat = makeComicMaterial(0x995533);
  const pipeMat = makeComicMaterial(0x554a4a);

  // --- Floor / ceiling ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.addBox({ x: roomWidth, y: 0.4, z: roomDepth }, { x: 0, y: -0.2, z: 0 });
  physics.addBox({ x: 3, y: 0.4, z: 2 }, { x: 0, y: -0.2, z: -(roomDepth / 2 + 1) });

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  scene.add(ceiling);

  // --- Walls ---
  const doorW = 3, doorH = 3.5;
  const makeWall = (w: number, h: number, pos: THREE.Vector3, rotY: number) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    wall.position.copy(pos);
    wall.rotation.y = rotY;
    wall.receiveShadow = true;
    scene.add(wall);
    return wall;
  };
  const backWallLeftW = (roomWidth - doorW) / 2;
  makeWall(backWallLeftW, roomHeight, new THREE.Vector3(-roomWidth / 2 + backWallLeftW / 2, roomHeight / 2, -roomDepth / 2), 0);
  makeWall(backWallLeftW, roomHeight, new THREE.Vector3(roomWidth / 2 - backWallLeftW / 2, roomHeight / 2, -roomDepth / 2), 0);
  makeWall(doorW, roomHeight - doorH, new THREE.Vector3(0, doorH + (roomHeight - doorH) / 2, -roomDepth / 2), 0);
  makeWall(roomWidth, roomHeight, new THREE.Vector3(0, roomHeight / 2, roomDepth / 2), Math.PI);
  makeWall(roomDepth, roomHeight, new THREE.Vector3(-roomWidth / 2, roomHeight / 2, 0), Math.PI / 2);
  makeWall(roomDepth, roomHeight, new THREE.Vector3(roomWidth / 2, roomHeight / 2, 0), -Math.PI / 2);

  // --- Wall collision bodies ---
  const wallThickness = 0.15;
  const addWallBody = (cx: number, cy: number, cz: number, hw: number, hh: number, hd: number) => {
    const body = new CANNON.Body({ mass: 0, material: floorPhysMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(hw, hh, hd)));
    body.position.set(cx, cy, cz);
    physicsWorld.addBody(body);
  };
  addWallBody(-roomWidth / 2 + backWallLeftW / 2, roomHeight / 2, -roomDepth / 2, backWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(roomWidth / 2 - backWallLeftW / 2, roomHeight / 2, -roomDepth / 2, backWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(0, doorH + (roomHeight - doorH) / 2, -roomDepth / 2, doorW / 2, (roomHeight - doorH) / 2, wallThickness);
  addWallBody(0, roomHeight / 2, roomDepth / 2, roomWidth / 2, roomHeight / 2, wallThickness);
  addWallBody(-roomWidth / 2, roomHeight / 2, 0, wallThickness, roomHeight / 2, roomDepth / 2);
  addWallBody(roomWidth / 2, roomHeight / 2, 0, wallThickness, roomHeight / 2, roomDepth / 2);

  // --- Door frame ---
  const frameThick = 0.12;
  const frameDepth = 0.2;
  const jambL = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, frameDepth), doorFrameMat);
  jambL.position.set(-doorW / 2 - frameThick / 2, doorH / 2, -roomDepth / 2);
  jambL.castShadow = true;
  scene.add(jambL);
  const jambR = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, frameDepth), doorFrameMat);
  jambR.position.set(doorW / 2 + frameThick / 2, doorH / 2, -roomDepth / 2);
  jambR.castShadow = true;
  scene.add(jambR);
  const header = new THREE.Mesh(new THREE.BoxGeometry(doorW + frameThick * 2, frameThick, frameDepth), doorFrameMat);
  header.position.set(0, doorH + frameThick / 2, -roomDepth / 2);
  header.castShadow = true;
  scene.add(header);

  const doorwayGlowMat = new THREE.MeshBasicMaterial({ color: 0xaa8888, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
  const doorwayGlow = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorwayGlowMat);
  doorwayGlow.position.set(0, doorH / 2, -roomDepth / 2);
  scene.add(doorwayGlow);

  // --- Sliding door (entry) ---
  const doorComicMat = makeComicMaterial(0xaa8888);
  const doorPanelW = doorW / 2 + 0.1;
  const doorPanelD = 0.08;
  const doorSlideDistance = doorPanelW + 0.3;
  const doorSlideSpeed = 1.5;
  const doorSensorRange = 3.5;
  const doorSeamMat = new THREE.MeshStandardMaterial({ color: 0x222233, emissive: 0x111122, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.2 });

  interface DoorState {
    panelL: THREE.Mesh; panelR: THREE.Mesh; seam: THREE.Mesh; sLightMat: THREE.MeshStandardMaterial;
    open: number; targetOpen: number; z: number;
  }
  const doorZ = -roomDepth / 2 - 0.15;
  const panelL = new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorH, doorPanelD), doorComicMat);
  const panelR = new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorH, doorPanelD), doorComicMat);
  panelL.position.set(-doorPanelW / 2, doorH / 2, doorZ);
  panelR.position.set(doorPanelW / 2, doorH / 2, doorZ);
  panelL.castShadow = true; panelR.castShadow = true;
  scene.add(panelL); scene.add(panelR);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, doorH, doorPanelD + 0.01), doorSeamMat);
  seam.position.set(0, doorH / 2, doorZ);
  scene.add(seam);
  const sBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.7, roughness: 0.3 }));
  sBase.position.set(0, doorH + 0.2, -roomDepth / 2 + 0.06);
  scene.add(sBase);
  const sLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  const sLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), sLightMat);
  sLight.position.set(0, doorH + 0.2, -roomDepth / 2 - 0.02);
  scene.add(sLight);
  const doorBack: DoorState = { panelL, panelR, seam, sLightMat, open: 0, targetOpen: 0, z: doorZ };
  if (remoteVisit) physics.addBox({ x: doorW, y: doorH, z: 0.2 }, { x: 0, y: doorH / 2, z: doorZ });

  // --- Lighting ---
  const ambLight = new THREE.AmbientLight(0x664444, 3.5);
  scene.add(ambLight);
  const lightPositions = [{ x: -2.5, z: -2 }, { x: 2.5, z: -2 }, { x: -2.5, z: 2 }, { x: 2.5, z: 2 }];
  for (const lp of lightPositions) {
    const light = new THREE.PointLight(remoteVisit ? SHIP_INTERIOR_PALETTE.light : 0xcc9977, 6, 14);
    light.position.set(lp.x, roomHeight - 0.4, lp.z);
    scene.add(light);
  }

  // --- Engine tanks ---
  const tankPositions = [{ x: -3, z: -2 }, { x: 3, z: -2 }, { x: -3, z: 2.5 }, { x: 3, z: 2.5 }];
  for (const tp of tankPositions) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2, 12), tankMat);
    tank.position.set(tp.x, 1, tp.z);
    tank.castShadow = true;
    scene.add(tank);
    const body = new CANNON.Body({ mass: 0, material: floorPhysMat });
    body.addShape(new CANNON.Cylinder(0.6, 0.6, 2, 12));
    body.position.set(tp.x, 1, tp.z);
    physicsWorld.addBody(body);
  }

  // --- Wall pipes ---
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, roomDepth - 1, 8), pipeMat);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(-roomWidth / 2 + 0.1, 3.2, 0);
  scene.add(pipe);

  const breakables = createBreakables(scene, physicsWorld);
  let sequence = '', exploding = false, blastTime = 0, greeted = false, captionTime = 0;
  const caption = document.createElement('div');
  caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  if (!preview) document.body.append(caption);
  function tell(text: string, seconds = 5) {
    caption.textContent = text; captionTime = seconds; caption.classList.remove('hidden');
  }
  function wallText(name: string, lines: string[], width: number, height: number, color: string) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Unable to draw ${name}`);
    ctx.fillStyle = '#13232c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.strokeRect(12, 12, 1000, 744);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = lines.length === 1 ? 'bold 540px monospace' : 'bold 38px monospace';
    lines.forEach((line, index) => ctx.fillText(line, 512, (index + 1) * 768 / (lines.length + 1)));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    mesh.name = name; mesh.userData.text = lines.join('\n'); scene.add(mesh); return mesh;
  }
  const letters = RANGE_LETTERS.map((letter, index) => {
    const x = (index - 3) * 1.15;
    const label = wallText(`RangeLetter-${index}`, [letter], 0.85, 0.85, '#f4fff8');
    label.position.set(x, 3.12, 4.79); label.rotation.y = Math.PI; label.visible = false;
    label.layers.enable(GOGGLES_READABLE_LAYER);
    const target = breakables.add(`RangeTarget-${index}`, 'pistol', new THREE.Vector3(x, 2.1, 4.7),
      new THREE.Vector3(0.8, 0.8, 0.18));
    target.root.userData.rangeLetter = letter;
    const damage = target.damage.bind(target);
    target.damage = (amount, weapon) => {
      if (!active || preview || exploding || target.broken || weapon !== 'pistol' || !Number.isFinite(amount) || amount <= 0) return false;
      if (letter !== RANGE_WORD[sequence.length]) {
        exploding = true; blastTime = 0; playSfx('explosion', 1); blast.position.copy(target.root.position);
        blast.scale.setScalar(0.15); blast.visible = true; blastLight.position.copy(blast.position);
        player.disable(); tell('Wrong order! The range is exploding!', 3);
        return true;
      }
      if (!damage(amount, weapon)) return false;
      sequence += letter;
      if (sequence === RANGE_WORD) {
        for (const item of breakables.objects) loot?.cleared.add(item.id);
        tell('BRONDON / Sequence complete. The chest is unlocked.');
      } else tell(`${sequence} / ${RANGE_WORD.length} letters`, 2);
      return true;
    };
    return label;
  });
  const poem = wallText('RangeWallPoem', ["THE STUDENTS' GAME", ...RANGE_POEM], 3.8, 2.6, '#ffe6ac');
  const posterCanvas = poem.material.map!.image as HTMLCanvasElement;
  const posterContext = posterCanvas.getContext('2d');
  if (!posterContext) throw new Error('Unable to draw the target range poster');
  posterContext.fillStyle = '#ead9ae'; posterContext.fillRect(0, 0, 1024, 768);
  posterContext.fillStyle = '#203540'; posterContext.fillRect(34, 34, 956, 152);
  posterContext.strokeStyle = '#a2763c'; posterContext.lineWidth = 4; posterContext.strokeRect(18, 18, 988, 732);
  posterContext.textAlign = 'center'; posterContext.textBaseline = 'middle';
  posterContext.font = '20px monospace'; posterContext.fillStyle = '#e7c78e';
  posterContext.fillText('CREW RECREATION / TARGET RANGE', 512, 70);
  posterContext.font = 'bold 52px Georgia, serif'; posterContext.fillStyle = '#fff1d1';
  posterContext.fillText("THE STUDENTS' GAME", 512, 132);
  posterContext.fillStyle = '#263840'; posterContext.font = 'italic 38px Georgia, serif';
  RANGE_POEM.forEach((line, index) => posterContext.fillText(line, 512, 265 + index * 68));
  posterContext.strokeStyle = '#a2763c'; posterContext.lineWidth = 2;
  posterContext.beginPath(); posterContext.moveTo(180, 690); posterContext.lineTo(844, 690); posterContext.stroke();
  posterContext.font = '18px monospace'; posterContext.fillText('BORROW NEW EYES. TAKE YOUR SHOT.', 512, 723);
  poem.material.map!.needsUpdate = true;
  poem.position.set(4.81, 2.5, 0); poem.rotation.y = -Math.PI / 2;
  const posterFrame = new THREE.Group(); posterFrame.name = 'RangeWallPoemFrame';
  posterFrame.position.copy(poem.position); posterFrame.rotation.copy(poem.rotation); scene.add(posterFrame);
  const posterFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x35434a, metalness: 0.65, roughness: 0.48 });
  for (const x of [-1.96, 1.96]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.82, 0.1), posterFrameMaterial);
    edge.position.x = x; posterFrame.add(edge);
  }
  for (const y of [-1.36, 1.36]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(4.02, 0.1, 0.1), posterFrameMaterial);
    edge.position.y = y; posterFrame.add(edge);
  }
  const blastUniforms = {
    uTime: { value: 0 }, uProgress: { value: 0 }, uIntensity: { value: 1 }, uCameraLocal: { value: new THREE.Vector3() },
    uColorCore: { value: new THREE.Color(0xfff2b0) }, uColorMid: { value: new THREE.Color(0xff8a1f) },
    uColorEdge: { value: new THREE.Color(0xc41608) }, uColorSmoke: { value: new THREE.Color(0x1a1613) },
  };
  const blast = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.ShaderMaterial({
    uniforms: blastUniforms, vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: false,
  }));
  blast.name = 'RangeFireExplosion'; blast.visible = false; blast.frustumCulled = false; scene.add(blast);
  blast.onBeforeRender = (_renderer, _scene, viewCamera) => {
    viewCamera.getWorldPosition(blastUniforms.uCameraLocal.value); blast.worldToLocal(blastUniforms.uCameraLocal.value);
  };
  const blastLight = new THREE.PointLight(0xff6a14, 0, 25); scene.add(blastLight);
  function syncProgress() {
    if (loot?.rewardCollected || breakables.objects.every(item => loot?.cleared.has(item.id))) {
      sequence = RANGE_WORD;
      breakables.restoreBroken(new Set(breakables.objects.map(item => item.id)));
    }
  }
  syncProgress();

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

  // --- Player ---
  const spawnZ = -roomDepth / 2 + 2;
  const spawnY = PHYSICS.playerRadius;
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: spawnY, z: spawnZ } });
  player.setRotation(0, 0);
  let active = !preview && !deferActivation;
  if (active) player.enable();
  if (remoteVisit) {
    teleportPlayer(player, { x: 0, y: spawnY, z: spawnZ }, Math.PI, entryState);
  } else if (entryState) {
    player.restoreTransition(entryState, { x: 0, y: 0, z: -roomDepth / 2 });
    doorBack.open = doorBack.targetOpen = 1;
    doorBack.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
    doorBack.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
    doorBack.seam.visible = false;
  }
  const entranceState = player.captureTransition({ x: 0, y: 0, z: 0 });

  const chest = !remoteVisit && gogglesCollected ? null : createRewardChest({ scene, world: physicsWorld, player,
    position: new THREE.Vector3(0, 0, 3.7), reward: remoteVisit ? 'keycard' : 'goggles', style: 'crew',
    initialCollected: loot?.rewardCollected, canInteract: () => active && !exploding, unlocked: () => sequence === RANGE_WORD,
    lockedPrompt: 'Read the wall poem. Goggles reveal the target letters; shoot your name in order.',
    removeOnCollect: !remoteVisit, onCollect: () => {
      if (!remoteVisit) { onGogglesCollected?.(); return true; }
      onKeycardCollected?.(); if (loot) loot.rewardCollected = true; player.addShield(25); return true;
    } }, modelLoader);
  if (preview) player.disable();
  const visitUI = remoteVisit && !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: '06 / Target range', player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);
  let disposed = false;

  // --- Door trigger callback ---
  let onBackTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let backCooldown = false;
  function setBackTrigger(callback: (state: PlayerTransitionState) => void) { onBackTrigger = callback; }

  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    if (disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    if (active && !greeted) {
      greeted = true; tell('Prime: The students would always play in here.');
    }
    captionTime = Math.max(0, captionTime - dt);
    if (!captionTime) caption.classList.add('hidden');
    if (exploding) {
      blastTime += dt;
      const progress = Math.min(blastTime / 2.4, 1);
      blastUniforms.uTime.value = blastTime; blastUniforms.uProgress.value = progress;
      blast.scale.setScalar(0.15 + 14 * Math.min(blastTime / 1.1, 1));
      blastLight.intensity = 90 * Math.sin(progress * Math.PI);
      breakables.update(dt);
      if (progress === 1) {
        exploding = false; blast.visible = false; blastLight.intensity = 0; sequence = '';
        breakables.reset();
        teleportPlayer(player, { x: 0, y: spawnY, z: spawnZ }, remoteVisit ? Math.PI : 0, entranceState);
        player.clearInput(); if (active) player.enable();
        tell('Range reset. Read the poem and try again.');
      }
      return;
    }
    physics.step(dt, player, thirdPerson);
    breakables.update(dt); chest?.update(dt); visitUI?.update();

    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorX = px > -doorW / 2 - 1 && px < doorW / 2 + 1;

    const dist = Math.sqrt(px * px + (pz - doorBack.z) * (pz - doorBack.z));
    const near = !remoteVisit && ((dist < doorSensorRange && inDoorX) || hasNearbyActor(physicsWorld, 0, doorBack.z, doorSensorRange));
    doorBack.targetOpen = near ? 1 : 0;
    if (near) { sLightMat.color.setHex(0x00ff44); sLightMat.emissive.setHex(0x00ff44); }
    else { sLightMat.color.setHex(0xff0000); sLightMat.emissive.setHex(0xff0000); }
    const slideDelta = doorSlideSpeed * dt;
     if (doorBack.open === 0 && doorBack.targetOpen > 0) playSfx('shipDoor');
    if (doorBack.open < doorBack.targetOpen) doorBack.open = Math.min(doorBack.open + slideDelta, 1);
    else if (doorBack.open > doorBack.targetOpen) doorBack.open = Math.max(doorBack.open - slideDelta, 0);
    const slideOffset = doorBack.open * doorSlideDistance;
    doorBack.panelL.position.x = -doorPanelW / 2 - slideOffset;
    doorBack.panelR.position.x = doorPanelW / 2 + slideOffset;
    doorBack.seam.visible = doorBack.open < 0.1;

    if (onBackTrigger && !backCooldown && doorBack.open > 0.9 && pz <= -roomDepth / 2 && Math.abs(px) <= (doorW + 2) / 2 + player.radius) {
      backCooldown = true;
      onBackTrigger(player.captureDoorTransition({ x: 0, y: 0, z: -roomDepth / 2, yaw: 0 }));
    }
  }

  return {
    scene, camera, physicsWorld, updatePhysics, ready: chest?.ready ?? Promise.resolve(),
    cutsceneManager: null,
    player,
    roomId: 'camera-range', getSceneId: () => 'scene6', getMapLayout: () => cameraVisitMap(6),
    minimap: { bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, floor: 0 },
    activate() { active = true; visitUI?.setVisible(true); player.clearInput(); player.enable(); },
    syncProgress() { syncProgress(); if (loot?.rewardCollected) chest?.setCollected(); },
    isCinematic: () => exploding,
    getRangeState: () => ({ sequence, exploding }),
    setBackTrigger, breakables, chest,
    getDamageTargets: () => active && !preview && !exploding ? breakables.getDamageTargets() : [],
    setGogglesActive(value: boolean) { for (const letter of letters) letter.visible = value && !preview; },
    dispose: () => { if (disposed) return; disposed = true; caption.remove(); visitUI?.dispose(); chest?.dispose(); breakables.dispose(); player.dispose(); physics.dispose(); disposeRoom(scene); },
  };
}
