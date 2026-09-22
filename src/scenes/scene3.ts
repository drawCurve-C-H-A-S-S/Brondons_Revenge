/**
 * Scene 3 - Passageway with dirty tiles, flickering lights, two sliding doors.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import comicVert from '../shaders/comic.vert.glsl?raw';
import comicFrag from '../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS, hasNearbyActor } from '../helpers/physics/scenePhysics.js';

export function createScene({ audioManager, entryState, entryDoor, hasCrowbar = false, cargoDoorUnlocked = false, onCargoDoorOpened }: {
  audioManager?: unknown; entryState?: PlayerTransitionState; entryDoor?: 'front' | 'back' | 'left' | 'right';
  hasCrowbar?: boolean; cargoDoorUnlocked?: boolean; onCargoDoorOpened?: () => void;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a10);

  // --- Room dimensions ---
  const roomWidth = 8;
  const roomDepth = 20;
  const roomHeight = 4.5;

  // --- Physics ---
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  const floorPhysMat = physics.solidMaterial;

  // --- Procedural dirty tile texture ---
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 256;
  tileCanvas.height = 256;
  const tileCtx = tileCanvas.getContext('2d')!;
  tileCtx.fillStyle = '#8a8a90';
  tileCtx.fillRect(0, 0, 256, 256);
  tileCtx.strokeStyle = '#6a6a72';
  tileCtx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) {
    tileCtx.beginPath(); tileCtx.moveTo(x, 0); tileCtx.lineTo(x, 256); tileCtx.stroke();
  }
  for (let y = 0; y <= 256; y += 64) {
    tileCtx.beginPath(); tileCtx.moveTo(0, y); tileCtx.lineTo(256, y); tileCtx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const dx = Math.random() * 256;
    const dy = Math.random() * 256;
    const dr = 5 + Math.random() * 20;
    const alpha = 0.1 + Math.random() * 0.25;
    tileCtx.fillStyle = `rgba(40, 35, 30, ${alpha})`;
    tileCtx.beginPath();
    tileCtx.ellipse(dx, dy, dr, dr * (0.5 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    tileCtx.fill();
  }
  for (let i = 0; i < 8; i++) {
    const sx = Math.random() * 256;
    const sy = Math.random() * 256;
    tileCtx.strokeStyle = `rgba(30, 28, 25, ${0.15 + Math.random() * 0.2})`;
    tileCtx.lineWidth = 1 + Math.random() * 3;
    tileCtx.beginPath();
    tileCtx.moveTo(sx, sy);
    tileCtx.lineTo(sx + (Math.random() - 0.5) * 60, sy + 20 + Math.random() * 40);
    tileCtx.stroke();
  }
  for (let gx = 0; gx <= 256; gx += 64) {
    for (let gy = 0; gy <= 256; gy += 64) {
      const grimeAlpha = 0.08 + Math.random() * 0.12;
      tileCtx.fillStyle = `rgba(25, 22, 18, ${grimeAlpha})`;
      tileCtx.fillRect(gx - 8, gy - 8, 16, 16);
    }
  }
  const dirtyTileTexture = new THREE.CanvasTexture(tileCanvas);
  dirtyTileTexture.wrapS = THREE.RepeatWrapping;
  dirtyTileTexture.wrapT = THREE.RepeatWrapping;

  // --- Materials ---
  const floorMat = (() => {
    const mat = new THREE.MeshStandardMaterial({
      map: dirtyTileTexture.clone(), color: 0x666670, roughness: 0.7, metalness: 0.15,
      emissive: 0x111118, emissiveIntensity: 0.4,
    });
    mat.map!.repeat.set(4, 10);
    return mat;
  })();
  function makeDirtyWallMat(repX: number, repY: number) {
    const mat = new THREE.MeshStandardMaterial({
      map: dirtyTileTexture.clone(), color: 0x6a6a74, roughness: 0.75, metalness: 0.1,
      emissive: 0x111118, emissiveIntensity: 0.35,
    });
    mat.map!.repeat.set(repX, repY);
    return mat;
  }
  const wallMat = makeDirtyWallMat(4, 2);
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x444450, roughness: 0.8, metalness: 0.1,
    emissive: 0x0a0a10, emissiveIntensity: 0.5,
  });
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
  const pipeMat = makeComicMaterial(0x4a4a55);

  // --- Floor ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.addBox({ x: roomWidth, y: 0.4, z: roomDepth }, { x: 0, y: -0.2, z: 0 });
  // Thresholds extend through the transition trigger zones, not the entire world.
  for (const side of [-1, 1]) {
    physics.addBox({ x: 3, y: 0.4, z: 2 }, { x: 0, y: -0.2, z: side * (roomDepth / 2 + 1) });
    physics.addBox({ x: 2, y: 0.4, z: 3 }, { x: side * (roomWidth / 2 + 1), y: -0.2, z: 0 });
  }

  // --- Ceiling ---
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // --- Walls ---
  const doorW = 3, doorH = 3.5;
  const makeWall = (w: number, h: number, pos: THREE.Vector3, rotY: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), wallMat);
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
  const frontWallLeftW = (roomWidth - doorW) / 2;
  makeWall(frontWallLeftW, roomHeight, new THREE.Vector3(-roomWidth / 2 + frontWallLeftW / 2, roomHeight / 2, roomDepth / 2), Math.PI);
  makeWall(frontWallLeftW, roomHeight, new THREE.Vector3(roomWidth / 2 - frontWallLeftW / 2, roomHeight / 2, roomDepth / 2), Math.PI);
  makeWall(doorW, roomHeight - doorH, new THREE.Vector3(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2), Math.PI);
  // Side walls each have a doorway halfway down the passage (to scene 5 / scene 6).
  const sideWallLen = (roomDepth - doorW) / 2;
  makeWall(sideWallLen, roomHeight, new THREE.Vector3(-roomWidth / 2, roomHeight / 2, -roomDepth / 2 + sideWallLen / 2), Math.PI / 2);
  makeWall(sideWallLen, roomHeight, new THREE.Vector3(-roomWidth / 2, roomHeight / 2, roomDepth / 2 - sideWallLen / 2), Math.PI / 2);
  makeWall(doorW, roomHeight - doorH, new THREE.Vector3(-roomWidth / 2, doorH + (roomHeight - doorH) / 2, 0), Math.PI / 2);
  makeWall(sideWallLen, roomHeight, new THREE.Vector3(roomWidth / 2, roomHeight / 2, -roomDepth / 2 + sideWallLen / 2), -Math.PI / 2);
  makeWall(sideWallLen, roomHeight, new THREE.Vector3(roomWidth / 2, roomHeight / 2, roomDepth / 2 - sideWallLen / 2), -Math.PI / 2);
  makeWall(doorW, roomHeight - doorH, new THREE.Vector3(roomWidth / 2, doorH + (roomHeight - doorH) / 2, 0), -Math.PI / 2);

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
  addWallBody(-roomWidth / 2 + frontWallLeftW / 2, roomHeight / 2, roomDepth / 2, frontWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(roomWidth / 2 - frontWallLeftW / 2, roomHeight / 2, roomDepth / 2, frontWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2, doorW / 2, (roomHeight - doorH) / 2, wallThickness);
  addWallBody(-roomWidth / 2, roomHeight / 2, -roomDepth / 2 + sideWallLen / 2, wallThickness, roomHeight / 2, sideWallLen / 2);
  addWallBody(-roomWidth / 2, roomHeight / 2, roomDepth / 2 - sideWallLen / 2, wallThickness, roomHeight / 2, sideWallLen / 2);
  addWallBody(-roomWidth / 2, doorH + (roomHeight - doorH) / 2, 0, wallThickness, (roomHeight - doorH) / 2, doorW / 2);
  addWallBody(roomWidth / 2, roomHeight / 2, -roomDepth / 2 + sideWallLen / 2, wallThickness, roomHeight / 2, sideWallLen / 2);
  addWallBody(roomWidth / 2, roomHeight / 2, roomDepth / 2 - sideWallLen / 2, wallThickness, roomHeight / 2, sideWallLen / 2);
  addWallBody(roomWidth / 2, doorH + (roomHeight - doorH) / 2, 0, wallThickness, (roomHeight - doorH) / 2, doorW / 2);

  // --- Door frames ---
  const frameThick = 0.12;
  const frameDepth = 0.2;
  const addDoorFrame = (z: number) => {
    const jambL = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, frameDepth), doorFrameMat);
    jambL.position.set(-doorW / 2 - frameThick / 2, doorH / 2, z);
    jambL.castShadow = true;
    scene.add(jambL);
    const jambR = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, frameDepth), doorFrameMat);
    jambR.position.set(doorW / 2 + frameThick / 2, doorH / 2, z);
    jambR.castShadow = true;
    scene.add(jambR);
    const header = new THREE.Mesh(new THREE.BoxGeometry(doorW + frameThick * 2, frameThick, frameDepth), doorFrameMat);
    header.position.set(0, doorH + frameThick / 2, z);
    header.castShadow = true;
    scene.add(header);
  };
  addDoorFrame(roomDepth / 2);
  addDoorFrame(-roomDepth / 2);

  // --- Side door frames (left/right, halfway down the passage) ---
  const addSideDoorFrame = (x: number) => {
    const jambF = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, doorH, frameThick), doorFrameMat);
    jambF.position.set(x, doorH / 2, -doorW / 2 - frameThick / 2);
    jambF.castShadow = true;
    scene.add(jambF);
    const jambB = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, doorH, frameThick), doorFrameMat);
    jambB.position.set(x, doorH / 2, doorW / 2 + frameThick / 2);
    jambB.castShadow = true;
    scene.add(jambB);
    const header = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, frameThick, doorW + frameThick * 2), doorFrameMat);
    header.position.set(x, doorH + frameThick / 2, 0);
    header.castShadow = true;
    scene.add(header);
  };
  addSideDoorFrame(-roomWidth / 2);
  addSideDoorFrame(roomWidth / 2);

  // --- Sliding doors ---
  const doorComicMat = makeComicMaterial(0x8899aa);
  const doorPanelW = doorW / 2 + 0.1;
  const doorPanelD = 0.08;
  const doorSlideDistance = doorPanelW + 0.3;
  const doorSlideSpeed = 1.5;
  const doorSensorRange = 3.5;
  const doorSeamMat = new THREE.MeshStandardMaterial({ color: 0x222233, emissive: 0x111122, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.2 });

  interface DoorState {
    panelL: THREE.Mesh;
    panelR: THREE.Mesh;
    seam: THREE.Mesh;
    sLightMat: THREE.MeshStandardMaterial;
    open: number;
    targetOpen: number;
    z: number;
  }

  function createDoor(z: number, faceZ: number): DoorState {
    const doorZ = z + faceZ * 0.15;
    const panelL = new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorH, doorPanelD), doorComicMat);
    const panelR = new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorH, doorPanelD), doorComicMat);
    panelL.position.set(-doorPanelW / 2, doorH / 2, doorZ);
    panelR.position.set(doorPanelW / 2, doorH / 2, doorZ);
    panelL.castShadow = true;
    panelR.castShadow = true;
    scene.add(panelL);
    scene.add(panelR);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, doorH, doorPanelD + 0.01), doorSeamMat);
    seam.position.set(0, doorH / 2, doorZ);
    scene.add(seam);
    const sBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.7, roughness: 0.3 }));
    sBase.position.set(0, doorH + 0.2, z - faceZ * 0.06);
    scene.add(sBase);
    const sLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
    const sLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), sLightMat);
    sLight.position.set(0, doorH + 0.2, z + faceZ * 0.02);
    scene.add(sLight);
    return { panelL, panelR, seam, sLightMat, open: 0, targetOpen: 0, z: doorZ };
  }

  const doorFront = createDoor(roomDepth / 2, 1);
  const doorBack = createDoor(-roomDepth / 2, -1);

  // --- Side sliding doors (left/right, same mechanics as front/back) ---
  interface SideDoorState {
    panelL: THREE.Mesh;
    panelR: THREE.Mesh;
    seam: THREE.Mesh;
    sLightMat: THREE.MeshStandardMaterial;
    open: number;
    targetOpen: number;
    x: number;
    bodyL: CANNON.Body;
    bodyR: CANNON.Body;
  }

  function createSideDoor(x: number, faceX: number): SideDoorState {
    // Panels slide inside the wall thickness, occluded by its actual surfaces.
    const doorX = x;
    const panelL = new THREE.Mesh(new THREE.BoxGeometry(doorPanelD, doorH, doorPanelW), doorComicMat);
    const panelR = new THREE.Mesh(new THREE.BoxGeometry(doorPanelD, doorH, doorPanelW), doorComicMat);
    panelL.position.set(doorX, doorH / 2, -doorPanelW / 2);
    panelR.position.set(doorX, doorH / 2, doorPanelW / 2);
    panelL.castShadow = true;
    panelR.castShadow = true;
    scene.add(panelL);
    scene.add(panelR);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(doorPanelD + 0.01, doorH, 0.02), doorSeamMat);
    seam.position.set(doorX, doorH / 2, 0);
    scene.add(seam);
    const sBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.7, roughness: 0.3 }));
    sBase.position.set(x - faceX * 0.06, doorH + 0.2, 0);
    scene.add(sBase);
    const sLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
    const sLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), sLightMat);
    sLight.position.set(x + faceX * 0.02, doorH + 0.2, 0);
    scene.add(sLight);
    const bodies = [panelL, panelR].map(panel => {
      const body = new CANNON.Body({ mass: 0, material: floorPhysMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(doorPanelD / 2, doorH / 2, doorPanelW / 2)));
      body.position.set(panel.position.x, panel.position.y, panel.position.z); physicsWorld.addBody(body);
      return body;
    });
    return { panelL, panelR, seam, sLightMat, open: 0, targetOpen: 0, x: doorX, bodyL: bodies[0], bodyR: bodies[1] };
  }

  const doorLeft = createSideDoor(-roomWidth / 2, 1);
  const doorRight = createSideDoor(roomWidth / 2, -1);

  // --- Lighting ---
  const lightColor = 0x8899bb;
  const flickerLights: Array<{
    light: THREE.PointLight;
    tubeMat: THREE.MeshStandardMaterial;
    baseIntensity: number;
    flickerSpeed: number;
    flickerAmount: number;
    phase: number;
    isAggressive: boolean;
  }> = [];

  const lightPositions = [
    { x: 0, z: -8 }, { x: 0, z: -4.5 }, { x: 0, z: -1 },
    { x: 0, z: 2.5 }, { x: 0, z: 6 }, { x: 0, z: 9 },
  ];

  for (let i = 0; i < lightPositions.length; i++) {
    const lp = lightPositions[i];
    const light = new THREE.PointLight(lightColor, 5, 14);
    light.position.set(lp.x, roomHeight - 0.4, lp.z);
    light.castShadow = i % 2 === 0;
    if (light.castShadow) light.shadow.mapSize.set(256, 256);
    scene.add(light);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lightColor, emissiveIntensity: 1.5 });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.15), tubeMat);
    tube.position.set(lp.x, roomHeight - 0.05, lp.z);
    scene.add(tube);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x444450, metalness: 0.6, roughness: 0.4 }));
    housing.position.set(lp.x, roomHeight - 0.02, lp.z);
    scene.add(housing);
    flickerLights.push({
      light, tubeMat, baseIntensity: 5,
      flickerSpeed: 2 + Math.random() * 6,
      flickerAmount: 0.2 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      isAggressive: i === 2 || i === 4,
    });
  }

  const ambLight = new THREE.AmbientLight(0x445566, 2.8);
  scene.add(ambLight);

  // --- Wall pipes (gapped around the side doorways at z = 0) ---
  const pipeDoorGap = doorW / 2 + 0.4;
  function addSplitPipe(radius: number, x: number, y: number, halfSpan: number) {
    const segLen = halfSpan - pipeDoorGap;
    if (segLen <= 0) return;
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, segLen, 8), pipeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, y, side * (pipeDoorGap + segLen / 2));
      pipe.castShadow = true;
      scene.add(pipe);
    }
  }
  addSplitPipe(0.06, -roomWidth / 2 + 0.1, 3.2, (roomDepth - 1) / 2);
  addSplitPipe(0.04, -roomWidth / 2 + 0.08, 1.5, (roomDepth - 1) / 2);
  addSplitPipe(0.05, roomWidth / 2 - 0.1, 2.8, roomDepth * 0.3);

  // Wall panel seams
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, metalness: 0.2, roughness: 0.9 });
  for (let z = -roomDepth / 2 + 2; z < roomDepth / 2; z += 3) {
    const seamL = new THREE.Mesh(new THREE.BoxGeometry(0.02, roomHeight, 0.02), seamMat);
    seamL.position.set(-roomWidth / 2 + 0.01, roomHeight / 2, z);
    scene.add(seamL);
    const seamR = new THREE.Mesh(new THREE.BoxGeometry(0.02, roomHeight, 0.02), seamMat);
    seamR.position.set(roomWidth / 2 - 0.01, roomHeight / 2, z);
    scene.add(seamR);
  }

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

  // --- Player ---
  const spawnZ = roomDepth / 2 - 2;
  const spawnY = PHYSICS.playerRadius;
  const player = createPlayer({
    camera, physicsWorld,
    spawnPosition: { x: 0, y: spawnY, z: spawnZ },
  });
  player.setRotation(0, 0);
  player.enable();
  if (entryState) {
    // Restore at the appropriate door based on entryDoor
    const doorway = entryDoor === 'back' ? { x: 0, y: 0, z: -roomDepth / 2 }
      : entryDoor === 'left' ? { x: -roomWidth / 2, y: 0, z: 0, yaw: Math.PI / 2 }
      : entryDoor === 'right' ? { x: roomWidth / 2, y: 0, z: 0, yaw: -Math.PI / 2 }
      : { x: 0, y: 0, z: roomDepth / 2 };
    player.restoreTransition(entryState, doorway);
    if (entryDoor === 'back') {
      doorBack.open = doorBack.targetOpen = 1;
      doorBack.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
      doorBack.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
      doorBack.seam.visible = false;
    } else if (entryDoor === 'left' && cargoDoorUnlocked) {
      doorLeft.open = doorLeft.targetOpen = 1;
      doorLeft.panelL.position.z = -doorPanelW / 2 - doorSlideDistance;
      doorLeft.panelR.position.z = doorPanelW / 2 + doorSlideDistance;
      doorLeft.seam.visible = false;
    } else if (entryDoor === 'right') {
      doorRight.open = doorRight.targetOpen = 1;
      doorRight.panelL.position.z = -doorPanelW / 2 - doorSlideDistance;
      doorRight.panelR.position.z = doorPanelW / 2 + doorSlideDistance;
      doorRight.seam.visible = false;
    } else {
      doorFront.open = doorFront.targetOpen = 1;
      doorFront.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
      doorFront.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
      doorFront.seam.visible = false;
    }
  }

  function syncSideDoor(door: SideDoorState) {
    for (const [body, panel] of [[door.bodyL, door.panelL], [door.bodyR, door.panelR]] as const) {
      body.position.set(panel.position.x, panel.position.y, panel.position.z); body.aabbNeedsUpdate = true;
    }
  }
  syncSideDoor(doorLeft); syncSideDoor(doorRight);
  const prompt = document.getElementById('interact-prompt');
  let stuckMessageTime = 0, ownsPrompt = false;
  const nearCargoDoor = () => Math.hypot(player.body.position.x + roomWidth / 2, player.body.position.z) < 2.1 && player.body.position.y < 1.5;
  function hitCargoDoor() {
    if (!hasCrowbar || cargoDoorUnlocked || !player.isEnabled() || !nearCargoDoor()) return false;
    const towardDoor = -Math.sin(player.getState().yaw);
    if (towardDoor > -0.4) return false;
    cargoDoorUnlocked = true; onCargoDoorOpened?.();
    prompt?.classList.add('hidden'); ownsPrompt = false;
    return true;
  }
  function onInteract(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || !player.isEnabled() || cargoDoorUnlocked || !nearCargoDoor()) return;
    event.preventDefault(); stuckMessageTime = 3.5;
  }
  window.addEventListener('keydown', onInteract);

  // --- Door trigger callbacks ---
  let onBackTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let onForwardTrigger: (() => void) | null = null;
  let onLeftTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let onRightTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let backCooldown = false;
  let forwardCooldown = false;
  let leftCooldown = false;
  let rightCooldown = false;

  function setBackTrigger(callback: (state: PlayerTransitionState) => void) { onBackTrigger = callback; }
  function setForwardTrigger(callback: () => void) { onForwardTrigger = callback; }
  function setLeftTrigger(callback: (state: PlayerTransitionState) => void) { onLeftTrigger = callback; }
  function setRightTrigger(callback: (state: PlayerTransitionState) => void) { onRightTrigger = callback; }

  // --- Update ---
  let flickerTime = 0;
  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(dt, player, thirdPerson);

    // Flicker lights
    flickerTime += dt;
    for (const fl of flickerLights) {
      let intensity = fl.baseIntensity;
      if (fl.isAggressive) {
        const noise = Math.sin(flickerTime * fl.flickerSpeed * 10) * 0.5 +
                      Math.sin(flickerTime * 37.7) * 0.3 +
                      (Math.random() - 0.5) * 0.8;
        intensity = fl.baseIntensity * (0.3 + Math.max(0, noise) * fl.flickerAmount * 4);
        if (Math.random() < 0.02) intensity *= 0.1;
      } else {
        const noise = Math.sin(flickerTime * fl.flickerSpeed + fl.phase) * 0.5 +
                      Math.sin(flickerTime * fl.flickerSpeed * 2.3 + fl.phase) * 0.2 +
                      (Math.random() - 0.5) * 0.15;
        intensity = fl.baseIntensity * (0.7 + noise * fl.flickerAmount);
      }
      fl.light.intensity = Math.max(0.1, intensity);
      fl.tubeMat.emissiveIntensity = Math.max(0.1, intensity / fl.baseIntensity * 2.0);
    }

    // Door sensor and animation
    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorX = px > -doorW / 2 - 1 && px < doorW / 2 + 1;
    const inDoorZ = pz > -doorW / 2 - 1 && pz < doorW / 2 + 1;

    for (const door of [doorFront, doorBack]) {
      const dist = Math.sqrt(px * px + (pz - door.z) * (pz - door.z));
      const near = (dist < doorSensorRange && inDoorX) || hasNearbyActor(physicsWorld, 0, door.z, doorSensorRange);
      door.targetOpen = near ? 1 : 0;
      if (near) {
        door.sLightMat.color.setHex(0x00ff44);
        door.sLightMat.emissive.setHex(0x00ff44);
      } else {
        door.sLightMat.color.setHex(0xff0000);
        door.sLightMat.emissive.setHex(0xff0000);
      }
      const slideDelta = doorSlideSpeed * dt;
      if (door.open < door.targetOpen) door.open = Math.min(door.open + slideDelta, 1);
      else if (door.open > door.targetOpen) door.open = Math.max(door.open - slideDelta, 0);
      const slideOffset = door.open * doorSlideDistance;
      door.panelL.position.x = -doorPanelW / 2 - slideOffset;
      door.panelR.position.x = doorPanelW / 2 + slideOffset;
      door.seam.visible = door.open < 0.1;
      // Fully open panels vanish into the wall pocket instead of floating in the doorway.
      door.panelL.visible = door.open < 0.97;
      door.panelR.visible = door.open < 0.97;
    }

    for (const door of [doorLeft, doorRight]) {
      const dist = Math.sqrt((px - door.x) * (px - door.x) + pz * pz);
      const unlocked = door !== doorLeft || cargoDoorUnlocked;
      const near = unlocked && ((dist < doorSensorRange && inDoorZ) || hasNearbyActor(physicsWorld, door.x, 0, doorSensorRange));
      door.targetOpen = near ? 1 : 0;
      if (near) {
        door.sLightMat.color.setHex(0x00ff44);
        door.sLightMat.emissive.setHex(0x00ff44);
      } else {
        door.sLightMat.color.setHex(0xff0000);
        door.sLightMat.emissive.setHex(0xff0000);
      }
      const slideDelta = doorSlideSpeed * dt;
      if (door.open < door.targetOpen) door.open = Math.min(door.open + slideDelta, 1);
      else if (door.open > door.targetOpen) door.open = Math.max(door.open - slideDelta, 0);
      const slideOffset = door.open * doorSlideDistance;
      door.panelL.position.z = -doorPanelW / 2 - slideOffset;
      door.panelR.position.z = doorPanelW / 2 + slideOffset;
      door.seam.visible = door.open < 0.1;
      syncSideDoor(door);
    }
    stuckMessageTime = Math.max(0, stuckMessageTime - dt);
    if (player.isEnabled() && !cargoDoorUnlocked && nearCargoDoor() && prompt) {
      prompt.textContent = stuckMessageTime > 0 ? 'Hmm, it seems this door is stuck. I need a crowbar.'
        : hasCrowbar ? 'T: equip crowbar · Swing at the door to pry it open' : 'Press E to interact';
      prompt.classList.remove('hidden'); ownsPrompt = true;
    } else if (ownsPrompt) { prompt?.classList.add('hidden'); ownsPrompt = false; }

    // Check door triggers
    if (onBackTrigger && !backCooldown && doorFront.open > 0.9 && pz > roomDepth / 2 + 0.8 && inDoorX) {
      backCooldown = true;
      onBackTrigger(player.captureTransition({ x: 0, y: 0, z: roomDepth / 2 }));
    }
    if (onForwardTrigger && !forwardCooldown && doorBack.open > 0.9 && pz < -roomDepth / 2 - 0.8 && inDoorX) {
      forwardCooldown = true;
      onForwardTrigger();
    }
    if (cargoDoorUnlocked && onLeftTrigger && !leftCooldown && doorLeft.open > 0.9 && px < -roomWidth / 2 - 0.8 && inDoorZ) {
      leftCooldown = true;
      onLeftTrigger(player.captureTransition({ x: -roomWidth / 2, y: 0, z: 0, yaw: Math.PI / 2 }));
    }
    if (onRightTrigger && !rightCooldown && doorRight.open > 0.9 && px > roomWidth / 2 + 0.8 && inDoorZ) {
      rightCooldown = true;
      onRightTrigger(player.captureTransition({ x: roomWidth / 2, y: 0, z: 0, yaw: -Math.PI / 2 }));
    }
  }

  return {
    scene, camera, physicsWorld, updatePhysics,
    cutsceneManager: null,
    player,
    setBackTrigger,
    setForwardTrigger,
    setLeftTrigger,
    setRightTrigger, hitCargoDoor, sideDoors: [doorLeft, doorRight],
    isCargoDoorUnlocked: () => cargoDoorUnlocked,
    dispose: () => { window.removeEventListener('keydown', onInteract); if (ownsPrompt) prompt?.classList.add('hidden'); player.dispose(); physics.dispose(); },
  };
}
