/**
 * Scene 6 - Engine room, reached via the passageway's right-hand door.
 * Same door/threshold mechanics as scene4, entered from a single back door.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import comicVert from '../shaders/comic.vert.glsl?raw';
import comicFrag from '../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS, hasNearbyActor } from '../helpers/physics/scenePhysics.js';
import { createBreakables } from '../scripts/breakables.js';
import { createRewardChest } from '../scripts/rewardChest.js';

export function createScene({ audioManager, entryState, gogglesCollected = false, onGogglesCollected }: {
  audioManager?: unknown; entryState?: PlayerTransitionState;
  gogglesCollected?: boolean; onGogglesCollected?: () => void;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x100a0a);

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
    map: tileTexture.clone(), color: 0x776666, roughness: 0.7, metalness: 0.15,
    emissive: 0x140a0a, emissiveIntensity: 0.35,
  });
  floorMat.map!.repeat.set(5, 5);
  const wallMat = new THREE.MeshStandardMaterial({
    map: tileTexture.clone(), color: 0x6f5f5f, roughness: 0.75, metalness: 0.1,
    emissive: 0x140a0a, emissiveIntensity: 0.3,
  });
  wallMat.map!.repeat.set(5, 2);
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x453a3a, roughness: 0.8, metalness: 0.1 });
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

  // --- Lighting ---
  const ambLight = new THREE.AmbientLight(0x664444, 3.5);
  scene.add(ambLight);
  const lightPositions = [{ x: -2.5, z: -2 }, { x: 2.5, z: -2 }, { x: -2.5, z: 2 }, { x: 2.5, z: 2 }];
  for (const lp of lightPositions) {
    const light = new THREE.PointLight(0xcc9977, 6, 14);
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
  for (const side of [-1, 1]) {
    for (const z of [-0.5, 3.4]) breakables.add(`WallTarget${side}_${z}`, 'pistol', new THREE.Vector3(side * 4.7, 1.8, z), new THREE.Vector3(0.18, 0.85, 0.85));
    breakables.add(`EndTarget${side}`, 'pistol', new THREE.Vector3(side * 1.7, 2.1, 4.7), new THREE.Vector3(0.85, 0.85, 0.18));
  }

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

  // --- Player ---
  const spawnZ = -roomDepth / 2 + 2;
  const spawnY = PHYSICS.playerRadius;
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: spawnY, z: spawnZ } });
  player.setRotation(0, 0);
  player.enable();
  if (entryState) {
    player.restoreTransition(entryState, { x: 0, y: 0, z: -roomDepth / 2 });
    doorBack.open = doorBack.targetOpen = 1;
    doorBack.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
    doorBack.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
    doorBack.seam.visible = false;
  }

  const chest = gogglesCollected ? null : createRewardChest({ scene, world: physicsWorld, player,
    position: new THREE.Vector3(0, 0, 3.7), reward: 'goggles', unlocked: () => breakables.remaining() === 0,
    removeOnCollect: true, onCollect: () => { onGogglesCollected?.(); return true; } });

  // --- Door trigger callback ---
  let onBackTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let backCooldown = false;
  function setBackTrigger(callback: (state: PlayerTransitionState) => void) { onBackTrigger = callback; }

  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(dt, player, thirdPerson);
    breakables.update(dt); chest?.update(dt);

    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorX = px > -doorW / 2 - 1 && px < doorW / 2 + 1;

    const dist = Math.sqrt(px * px + (pz - doorBack.z) * (pz - doorBack.z));
    const near = (dist < doorSensorRange && inDoorX) || hasNearbyActor(physicsWorld, 0, doorBack.z, doorSensorRange);
    doorBack.targetOpen = near ? 1 : 0;
    if (near) { sLightMat.color.setHex(0x00ff44); sLightMat.emissive.setHex(0x00ff44); }
    else { sLightMat.color.setHex(0xff0000); sLightMat.emissive.setHex(0xff0000); }
    const slideDelta = doorSlideSpeed * dt;
    if (doorBack.open < doorBack.targetOpen) doorBack.open = Math.min(doorBack.open + slideDelta, 1);
    else if (doorBack.open > doorBack.targetOpen) doorBack.open = Math.max(doorBack.open - slideDelta, 0);
    const slideOffset = doorBack.open * doorSlideDistance;
    doorBack.panelL.position.x = -doorPanelW / 2 - slideOffset;
    doorBack.panelR.position.x = doorPanelW / 2 + slideOffset;
    doorBack.seam.visible = doorBack.open < 0.1;

    if (onBackTrigger && !backCooldown && doorBack.open > 0.9 && pz < -roomDepth / 2 - 0.8 && inDoorX) {
      backCooldown = true;
      onBackTrigger(player.captureTransition({ x: 0, y: 0, z: -roomDepth / 2, yaw: 0 }));
    }
  }

  return {
    scene, camera, physicsWorld, updatePhysics,
    cutsceneManager: null,
    player,
    setBackTrigger, breakables, chest, getDamageTargets: breakables.getDamageTargets,
    setGogglesActive: breakables.setHighlighted,
    dispose: () => { chest?.dispose(); breakables.dispose(); player.dispose(); physics.dispose(); },
  };
}
