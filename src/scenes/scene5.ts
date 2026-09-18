/**
 * Scene 5 - Cafeteria / galley with kitchen line, serving counter, and dining tables.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import comicVert from '../shaders/comic.vert.glsl?raw';
import comicFrag from '../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { disposeSurveillanceScene } from '../scripts/cctv.js';

export function createScene({ audioManager, entryState, surveillanceOnly = false }: {
  audioManager?: unknown; entryState?: PlayerTransitionState; surveillanceOnly?: boolean;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a10);

  // --- Room dimensions ---
  const roomWidth = 14;
  const roomDepth = 12;
  const roomHeight = 4.5;

  // --- Physics ---
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  const floorPhysMat = physics.solidMaterial;

  // --- Procedural dirty tile texture (same style as scenes 3 and 4) ---
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

  // --- Checkered galley floor texture (half-meter cells) ---
  const checkerCanvas = document.createElement('canvas');
  checkerCanvas.width = 128;
  checkerCanvas.height = 128;
  const checkerCtx = checkerCanvas.getContext('2d')!;
  for (let cx = 0; cx < 2; cx++) {
    for (let cy = 0; cy < 2; cy++) {
      checkerCtx.fillStyle = (cx + cy) % 2 === 0 ? '#9aa0a6' : '#4d5257';
      checkerCtx.fillRect(cx * 64, cy * 64, 64, 64);
    }
  }
  for (let i = 0; i < 60; i++) {
    const dx = Math.random() * 128;
    const dy = Math.random() * 128;
    const dr = 3 + Math.random() * 12;
    checkerCtx.fillStyle = `rgba(30, 26, 22, ${0.08 + Math.random() * 0.22})`;
    checkerCtx.beginPath();
    checkerCtx.ellipse(dx, dy, dr, dr * (0.5 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    checkerCtx.fill();
  }
  const checkerTexture = new THREE.CanvasTexture(checkerCanvas);
  checkerTexture.wrapS = THREE.RepeatWrapping;
  checkerTexture.wrapT = THREE.RepeatWrapping;
  checkerTexture.repeat.set(14, 12);

  // --- Materials ---
  const floorMat = new THREE.MeshStandardMaterial({
    map: checkerTexture, color: 0x8f9298, roughness: 0.65, metalness: 0.15,
    emissive: 0x101014, emissiveIntensity: 0.4,
  });
  function makeDirtyWallMat(repX: number, repY: number) {
    const mat = new THREE.MeshStandardMaterial({
      map: dirtyTileTexture.clone(), color: 0x6a6a74, roughness: 0.75, metalness: 0.1,
      emissive: 0x111118, emissiveIntensity: 0.35,
    });
    mat.map!.repeat.set(repX, repY);
    return mat;
  }
  const wallMat = makeDirtyWallMat(7, 2);
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
  const applianceMat = new THREE.MeshStandardMaterial({ color: 0x656b75, metalness: 0.5, roughness: 0.45 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8b929c, metalness: 0.75, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.35, roughness: 0.55 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a5c46, metalness: 0.1, roughness: 0.85 });
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x7d6c5a, metalness: 0.2, roughness: 0.6 });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x585d66, metalness: 0.45, roughness: 0.5 });

  function addProp(
    size: { x: number; y: number; z: number },
    position: { x: number; y: number; z: number },
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function addBox(
    size: { x: number; y: number; z: number },
    position: { x: number; y: number; z: number },
    material: THREE.Material,
  ) {
    const mesh = addProp(size, position, material);
    physics.addBox(size, position);
    return mesh;
  }

  // --- Floor ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.addBox({ x: roomWidth, y: 0.4, z: roomDepth }, { x: 0, y: -0.2, z: 0 });
  // Threshold extends through the door trigger zone back to the computer room.
  physics.addBox({ x: 3, y: 0.4, z: 2 }, { x: 0, y: -0.2, z: roomDepth / 2 + 1 });

  // --- Ceiling ---
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // --- Walls (door back to the computer room on the +Z wall) ---
  const doorW = 3, doorH = 3.5;
  const makeWall = (w: number, h: number, pos: THREE.Vector3, rotY: number) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    wall.position.copy(pos);
    wall.rotation.y = rotY;
    wall.receiveShadow = true;
    scene.add(wall);
    return wall;
  };

  // Back wall (kitchen end, solid)
  makeWall(roomWidth, roomHeight, new THREE.Vector3(0, roomHeight / 2, -roomDepth / 2), 0);
  // Front wall
  const frontWallLeftW = (roomWidth - doorW) / 2;
  makeWall(frontWallLeftW, roomHeight, new THREE.Vector3(-roomWidth / 2 + frontWallLeftW / 2, roomHeight / 2, roomDepth / 2), Math.PI);
  makeWall(frontWallLeftW, roomHeight, new THREE.Vector3(roomWidth / 2 - frontWallLeftW / 2, roomHeight / 2, roomDepth / 2), Math.PI);
  makeWall(doorW, roomHeight - doorH, new THREE.Vector3(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2), Math.PI);
  // Side walls
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
  addWallBody(0, roomHeight / 2, -roomDepth / 2, roomWidth / 2, roomHeight / 2, wallThickness);
  addWallBody(-roomWidth / 2 + frontWallLeftW / 2, roomHeight / 2, roomDepth / 2, frontWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(roomWidth / 2 - frontWallLeftW / 2, roomHeight / 2, roomDepth / 2, frontWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2, doorW / 2, (roomHeight - doorH) / 2, wallThickness);
  addWallBody(-roomWidth / 2, roomHeight / 2, 0, wallThickness, roomHeight / 2, roomDepth / 2);
  addWallBody(roomWidth / 2, roomHeight / 2, 0, wallThickness, roomHeight / 2, roomDepth / 2);

  // --- Door frame ---
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

  // --- Soft glow at the doorway ---
  const doorwayGlowMat = new THREE.MeshBasicMaterial({
    color: 0x8899aa,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
  });
  const doorwayGlow = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorwayGlowMat);
  doorwayGlow.position.set(0, doorH / 2, roomDepth / 2);
  scene.add(doorwayGlow);

  // --- Sliding door ---
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

  // --- Kitchen line along the back wall ---
  const ovenGlassMat = new THREE.MeshStandardMaterial({
    color: 0x2a1c10, emissive: 0x6a3a12, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.4,
  });
  // Upright fridge
  addBox({ x: 1.7, y: 2.4, z: 0.85 }, { x: -5.5, y: 1.2, z: -5.475 }, applianceMat);
  addProp({ x: 0.08, y: 1.3, z: 0.06 }, { x: -4.8, y: 1.2, z: -5.03 }, steelMat);
  // Oven stack
  addBox({ x: 1.3, y: 2.0, z: 0.85 }, { x: -3.55, y: 1.0, z: -5.525 }, darkMat);
  addProp({ x: 0.8, y: 0.45, z: 0.05 }, { x: -3.55, y: 1.3, z: -5.085 }, ovenGlassMat);
  addProp({ x: 0.9, y: 0.05, z: 0.05 }, { x: -3.55, y: 1.72, z: -5.07 }, steelMat);
  // Range and hood
  addBox({ x: 2.0, y: 0.9, z: 0.85 }, { x: -1.0, y: 0.45, z: -5.5 }, steelMat);
  for (const bx of [-1.6, -0.4]) {
    for (const bz of [-5.72, -5.28]) {
      addProp({ x: 0.34, y: 0.03, z: 0.34 }, { x: bx, y: 0.915, z: bz }, darkMat);
    }
  }
  addProp({ x: 2.2, y: 0.5, z: 0.9 }, { x: -1.0, y: 2.7, z: -5.5 }, applianceMat);
  // Prep counter with sink
  addBox({ x: 2.4, y: 0.9, z: 0.85 }, { x: 2.0, y: 0.45, z: -5.5 }, applianceMat);
  addProp({ x: 0.8, y: 0.1, z: 0.6 }, { x: 1.6, y: 0.88, z: -5.5 }, darkMat);
  addProp({ x: 0.05, y: 0.4, z: 0.05 }, { x: 1.6, y: 1.08, z: -5.78 }, steelMat);
  addProp({ x: 0.05, y: 0.05, z: 0.24 }, { x: 1.6, y: 1.26, z: -5.66 }, steelMat);
  // Storage cabinet
  addBox({ x: 1.8, y: 2.2, z: 0.55 }, { x: 5.3, y: 1.1, z: -5.65 }, applianceMat);
  addProp({ x: 0.05, y: 0.5, z: 0.05 }, { x: 4.85, y: 1.2, z: -5.36 }, steelMat);
  addProp({ x: 0.05, y: 0.5, z: 0.05 }, { x: 5.75, y: 1.2, z: -5.36 }, steelMat);

  // --- Serving island with sneeze guard ---
  addProp({ x: 6.0, y: 0.9, z: 1.1 }, { x: -0.4, y: 0.45, z: -1.2 }, darkMat);
  addProp({ x: 6.2, y: 0.08, z: 1.2 }, { x: -0.4, y: 0.94, z: -1.2 }, steelMat);
  physics.addBox({ x: 6.2, y: 0.98, z: 1.2 }, { x: -0.4, y: 0.49, z: -1.2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbcd2dd, transparent: true, opacity: 0.28, metalness: 0.2, roughness: 0.1,
  });
  addProp({ x: 6.2, y: 0.5, z: 0.04 }, { x: -0.4, y: 1.35, z: -1.7 }, glassMat);
  physics.addBox({ x: 6.2, y: 0.5, z: 0.04 }, { x: -0.4, y: 1.35, z: -1.7 });
  addProp({ x: 0.05, y: 0.4, z: 0.05 }, { x: -3.4, y: 1.18, z: -1.7 }, steelMat);
  addProp({ x: 0.05, y: 0.4, z: 0.05 }, { x: 2.6, y: 1.18, z: -1.7 }, steelMat);
  addProp({ x: 0.5, y: 0.04, z: 0.35 }, { x: -2.2, y: 1.0, z: -1.2 }, steelMat);
  addProp({ x: 0.5, y: 0.04, z: 0.35 }, { x: -1.4, y: 1.0, z: -1.2 }, steelMat);
  // --- Beverage unit on the island ---
  addBox({ x: 0.5, y: 0.7, z: 0.5 }, { x: 2.3, y: 1.33, z: -1.2 }, darkMat);
  const dispenserScreenMat = new THREE.MeshStandardMaterial({
    color: 0x0a2a33, emissive: 0x33ddaa, emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.3,
  });
  const beverageScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), dispenserScreenMat);
  beverageScreen.position.set(2.3, 1.5, -0.945);
  scene.add(beverageScreen);
  // --- Dining tables with benches ---
  const tableSpots: Array<[number, number]> = [[-2.6, 1.4], [2.6, 1.4], [-2.6, 3.8], [2.6, 3.8]];
  for (const [tx, tz] of tableSpots) {
    addProp({ x: 1.6, y: 0.06, z: 0.9 }, { x: tx, y: 0.72, z: tz }, tableMat);
    addProp({ x: 0.14, y: 0.69, z: 0.14 }, { x: tx, y: 0.345, z: tz }, steelMat);
    addProp({ x: 0.6, y: 0.05, z: 0.6 }, { x: tx, y: 0.025, z: tz }, steelMat);
    physics.addBox({ x: 1.6, y: 0.75, z: 0.9 }, { x: tx, y: 0.375, z: tz });
    for (const side of [-1, 1]) {
      const bz = tz + side * 0.78;
      addProp({ x: 1.6, y: 0.1, z: 0.32 }, { x: tx, y: 0.42, z: bz }, benchMat);
      addProp({ x: 0.08, y: 0.42, z: 0.28 }, { x: tx - 0.65, y: 0.21, z: bz }, steelMat);
      addProp({ x: 0.08, y: 0.42, z: 0.28 }, { x: tx + 0.65, y: 0.21, z: bz }, steelMat);
      physics.addBox({ x: 1.6, y: 0.45, z: 0.34 }, { x: tx, y: 0.225, z: bz });
    }
  }

  // --- Supply crates stacked near the door ---
  addBox({ x: 0.7, y: 0.7, z: 0.7 }, { x: 5.3, y: 0.35, z: 3.6 }, crateMat);
  addBox({ x: 0.7, y: 0.7, z: 0.7 }, { x: 6.15, y: 0.35, z: 4.5 }, crateMat);
  addBox({ x: 0.7, y: 0.7, z: 0.7 }, { x: 5.3, y: 1.05, z: 3.6 }, crateMat);

  // --- Trash chute on the left wall ---
  addBox({ x: 0.25, y: 0.5, z: 0.6 }, { x: -6.8, y: 1.0, z: -3.3 }, darkMat);
  addProp({ x: 0.06, y: 0.25, z: 0.08 }, { x: -6.66, y: 1.0, z: -3.3 }, steelMat);

  // --- Fire extinguisher by the door ---
  const extinguisherMat = new THREE.MeshStandardMaterial({ color: 0xaa2222, metalness: 0.4, roughness: 0.5 });
  const extinguisher = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10), extinguisherMat);
  extinguisher.position.set(-4.6, 0.65, 5.83);
  extinguisher.castShadow = true;
  scene.add(extinguisher);
  addProp({ x: 0.05, y: 0.12, z: 0.1 }, { x: -4.6, y: 0.98, z: 5.8 }, darkMat);
  physics.addBox({ x: 0.3, y: 0.7, z: 0.3 }, { x: -4.6, y: 0.7, z: 5.85 });

  // --- Menu board on the left wall ---
  const menuCanvas = document.createElement('canvas');
  menuCanvas.width = 256;
  menuCanvas.height = 192;
  const menuCtx = menuCanvas.getContext('2d')!;
  menuCtx.fillStyle = '#1c1a17';
  menuCtx.fillRect(0, 0, 256, 192);
  menuCtx.fillStyle = '#e8c47a';
  menuCtx.font = 'bold 22px sans-serif';
  menuCtx.fillText('GALLEY MENU', 16, 40);
  menuCtx.fillStyle = '#9fb4ae';
  menuCtx.font = '16px sans-serif';
  menuCtx.fillText('SYNTH STEW', 16, 84);
  menuCtx.fillText('PROTEIN LOAF', 16, 116);
  menuCtx.fillText('WATER RATION', 16, 148);
  menuCtx.fillStyle = '#79efbb';
  menuCtx.font = '13px sans-serif';
  menuCtx.fillText('HOT SYNTH ONLY', 16, 178);
  const menuTexture = new THREE.CanvasTexture(menuCanvas);
  const menuBoardMat = new THREE.MeshStandardMaterial({
    map: menuTexture, emissive: 0xffffff, emissiveMap: menuTexture, emissiveIntensity: 0.35, roughness: 0.7,
  });
  const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), menuBoardMat);
  menuBoard.position.set(-6.86, 2.0, 1.2);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);
  addProp({ x: 0.06, y: 1.32, z: 1.72 }, { x: -6.9, y: 2.0, z: 1.2 }, doorFrameMat);

  // --- Ration dispenser on the right wall ---
  addBox({ x: 0.45, y: 1.7, z: 0.8 }, { x: 6.62, y: 0.95, z: -3.2 }, applianceMat);
  const dispenserScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), dispenserScreenMat);
  dispenserScreen.position.set(6.39, 1.35, -3.2);
  dispenserScreen.rotation.y = -Math.PI / 2;
  scene.add(dispenserScreen);
  addProp({ x: 0.34, y: 0.06, z: 0.4 }, { x: 6.35, y: 0.62, z: -3.2 }, steelMat);

  // --- Ceiling pipes over the kitchen line ---
  const pipeMat = makeComicMaterial(0x4a4a55);
  const pipeA = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 8), pipeMat);
  pipeA.rotation.z = Math.PI / 2;
  pipeA.position.set(-1.5, 3.95, -5.7);
  pipeA.castShadow = true;
  scene.add(pipeA);
  const pipeB = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 9, 8), pipeMat);
  pipeB.rotation.z = Math.PI / 2;
  pipeB.position.set(-1.5, 3.75, -5.62);
  scene.add(pipeB);

  // --- Wall panel seams ---
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, metalness: 0.5, roughness: 0.5 });
  for (let z = -roomDepth / 2 + 2; z < roomDepth / 2; z += 3) {
    const seamL = new THREE.Mesh(new THREE.BoxGeometry(0.02, roomHeight, 0.02), seamMat);
    seamL.position.set(-roomWidth / 2 + 0.01, roomHeight / 2, z);
    scene.add(seamL);
    const seamR = new THREE.Mesh(new THREE.BoxGeometry(0.02, roomHeight, 0.02), seamMat);
    seamR.position.set(roomWidth / 2 - 0.01, roomHeight / 2, z);
    scene.add(seamR);
  }

  // --- Lighting ---
  interface GalleyLight {
    light: THREE.PointLight;
    tubeMat: THREE.MeshStandardMaterial;
    baseIntensity: number;
    flickerSpeed: number;
    flickerAmount: number;
    phase: number;
    mode: 'steady' | 'flicker' | 'dead';
  }
  const flickerLights: GalleyLight[] = [];
  const fixtureDefs: Array<{
    x: number; z: number; color: number; base: number; mode: GalleyLight['mode'];
  }> = [
    { x: -2.6, z: -4.3, color: 0xffcc99, base: 6.0, mode: 'steady' },
    { x: 2.2, z: -4.3, color: 0xffcc99, base: 6.0, mode: 'steady' },
    { x: -3.2, z: 1.5, color: 0x8899bb, base: 3.5, mode: 'flicker' },
    { x: 3.2, z: 1.5, color: 0x8899bb, base: 3.5, mode: 'flicker' },
    { x: 0, z: 4.2, color: 0x8899bb, base: 3.5, mode: 'flicker' },
    { x: -0.4, z: -1.2, color: 0x9db4c0, base: 2.5, mode: 'dead' },
  ];
  fixtureDefs.forEach((fixture, i) => {
    const light = new THREE.PointLight(fixture.color, fixture.mode === 'dead' ? 0.05 : fixture.base, 15);
    light.position.set(fixture.x, roomHeight - 0.4, fixture.z);
    if (i % 2 === 0) {
      light.castShadow = true;
      light.shadow.mapSize.set(256, 256);
    }
    scene.add(light);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      emissive: fixture.color,
      emissiveIntensity: fixture.mode === 'dead' ? 0.05 : 1.8,
    });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.15), tubeMat);
    tube.position.set(fixture.x, roomHeight - 0.05, fixture.z);
    scene.add(tube);
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x33343c, metalness: 0.6, roughness: 0.4 }),
    );
    housing.position.set(fixture.x, roomHeight - 0.02, fixture.z);
    scene.add(housing);
    flickerLights.push({
      light,
      tubeMat,
      baseIntensity: fixture.base,
      flickerSpeed: 1.5 + Math.random() * 3,
      flickerAmount: fixture.mode === 'steady' ? 0.03 + Math.random() * 0.03 : 0.18 + Math.random() * 0.14,
      phase: Math.random() * Math.PI * 2,
      mode: fixture.mode,
    });
  });
  const ambLight = new THREE.AmbientLight(0x445566, 2.0);
  scene.add(ambLight);
  const doorGlow = new THREE.PointLight(0x667788, 2.5, 16);
  doorGlow.position.set(0, 2.2, 4.8);
  scene.add(doorGlow);

  let flickerTime = 0;
  function updateEnvironment(dt: number) {
    flickerTime += dt;
    for (const fl of flickerLights) {
      if (fl.mode === 'dead') {
        const intensity = Math.random() < 0.04
          ? fl.baseIntensity * 0.5
          : fl.baseIntensity * (0.02 + Math.abs(Math.sin(flickerTime * 7.1 + fl.phase)) * 0.02);
        fl.light.intensity = Math.max(0.02, intensity);
        fl.tubeMat.emissiveIntensity = Math.max(0.02, intensity / fl.baseIntensity * 1.8);
        continue;
      }
      const baseline = fl.mode === 'steady' ? 0.94 : 0.7;
      const jitter = fl.mode === 'steady' ? 0.06 : 0.2;
      const noise = Math.sin(flickerTime * fl.flickerSpeed + fl.phase) * 0.5 +
                    Math.sin(flickerTime * fl.flickerSpeed * 2.3 + fl.phase) * 0.2 +
                    (Math.random() - 0.5) * jitter;
      const intensity = fl.baseIntensity * Math.max(0.05, baseline + noise * fl.flickerAmount);
      fl.light.intensity = intensity;
      fl.tubeMat.emissiveIntensity = intensity / fl.baseIntensity * 1.8;
    }
    dispenserScreenMat.emissiveIntensity = 1.1 + Math.sin(flickerTime * 2.2) * 0.45 + Math.sin(flickerTime * 7.3) * 0.1;
  }

  if (surveillanceOnly) {
    physics.dispose();
    return {
      roomId: 'cafeteria',
      scene,
      updateEnvironment,
      dispose: () => { disposeSurveillanceScene(scene); },
    };
  }

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

  // --- Player ---
  const spawnZ = roomDepth / 2 - 2;
  const player = createPlayer({
    camera,
    physicsWorld,
    spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: spawnZ },
  });
  player.setRotation(0, 0);
  player.enable();

  if (entryState) {
    player.restoreTransition(entryState, { x: 0, y: 0, z: roomDepth / 2 });
    doorFront.open = doorFront.targetOpen = 1;
    doorFront.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
    doorFront.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
    doorFront.seam.visible = false;
  }

  // --- Door trigger back to the computer room ---
  let onDoorTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let doorCooldown = false;
  function setDoorTrigger(callback: (state: PlayerTransitionState) => void) {
    onDoorTrigger = callback;
  }

  // --- Update ---
  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(dt, player, thirdPerson);
    updateEnvironment(dt);

    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorX = px > -doorW / 2 - 1 && px < doorW / 2 + 1;

    const door = doorFront;
    const dist = Math.sqrt(px * px + (pz - door.z) * (pz - door.z));
    const near = dist < doorSensorRange && inDoorX;
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

    if (onDoorTrigger && !doorCooldown && doorFront.open > 0.9 && pz > roomDepth / 2 + 0.8 && inDoorX) {
      doorCooldown = true;
      onDoorTrigger(player.captureTransition({ x: 0, y: 0, z: roomDepth / 2 }));
    }
  }

  return {
    roomId: 'cafeteria',
    scene,
    camera,
    physicsWorld,
    updatePhysics,
    updateEnvironment,
    cutsceneManager: null,
    player,
    setDoorTrigger,
    dispose: () => {
      player.dispose();
      physics.dispose();
    },
  };
}
