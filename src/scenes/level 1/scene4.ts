/**
 * Scene 4 - Computer room / bridge with better lighting, ship consoles.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import comicVert from '../../shaders/comic.vert.glsl?raw';
import comicFrag from '../../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createScenePhysics, PHYSICS, hasNearbyActor } from '../../helpers/physics/scenePhysics.js';
import { loadToolModel } from '../../core/loader.js';
import { HOLOGRAM_TRANSFER_DURATION, hologramTransitionAt } from '../../scripts/characterManager.js';

// Computer model imports (FBX for 1-2, OBJ for 3-8)
import computer1Url from '../../assets/models/Retro computers/models/Computer1.fbx';
import computer2Url from '../../assets/models/Retro computers/models/Computer2.fbx';
import computer3Url from '../../assets/models/Retro computers/models/computer3.obj';
import computer4Url from '../../assets/models/Retro computers/models/computer4.obj';
import computer5Url from '../../assets/models/Retro computers/models/computer5.obj';
import computer6Url from '../../assets/models/Retro computers/models/computer6.obj';
import computer7Url from '../../assets/models/Retro computers/models/computer7.obj';
import computer8Url from '../../assets/models/Retro computers/models/computer8.obj';

// Texture imports
import tex1Url from '../../assets/textures/MachineTexture1.png';
import tex1NormalUrl from '../../assets/textures/MachineTexture1_normal.png';
import tex1SpecUrl from '../../assets/textures/MachineTexture1_spec.png';
import tex2Url from '../../assets/textures/MachineTexture2.png';
import tex2NormalUrl from '../../assets/textures/MachineTexture2_normal.png';
import tex2SpecUrl from '../../assets/textures/MachineTexture2_spec.png';
import tex3Url from '../../assets/textures/MachineTexture3.png';
import tex3NormalUrl from '../../assets/textures/MachineTexture3_normal.png';
import tex3SpecUrl from '../../assets/textures/MachineTexture3_spec.png';
import tex4Url from '../../assets/textures/MachineTexture4.png';
import tex4NormalUrl from '../../assets/textures/MachineTexture4_normal.png';
import tex4SpecUrl from '../../assets/textures/MachineTexture4_spec.png';
import tex5Url from '../../assets/textures/MachineTexture5.png';
import tex5NormalUrl from '../../assets/textures/MachineTexture5_normal.png';
import tex5SpecUrl from '../../assets/textures/MachineTexture5_spec.png';
import tex6Url from '../../assets/textures/MachineTexture6.png';
import tex6NormalUrl from '../../assets/textures/MachineTexture6_normal.png';
import tex6SpecUrl from '../../assets/textures/MachineTexture6_spec.png';
import tex7Url from '../../assets/textures/MachineTexture7.png';
import tex7NormalUrl from '../../assets/textures/MachineTexture7_normal.png';
import tex7SpecUrl from '../../assets/textures/MachineTexture7_spec.png';
import tex8Url from '../../assets/textures/MachineTexture8.png';

const COMPUTER_URLS = [computer1Url, computer2Url, computer3Url, computer4Url, computer5Url, computer6Url, computer7Url, computer8Url];

const TEXTURE_SETS = [
  { diffuse: tex1Url, normal: tex1NormalUrl, specular: tex1SpecUrl },
  { diffuse: tex2Url, normal: tex2NormalUrl, specular: tex2SpecUrl },
  { diffuse: tex3Url, normal: tex3NormalUrl, specular: tex3SpecUrl },
  { diffuse: tex4Url, normal: tex4NormalUrl, specular: tex4SpecUrl },
  { diffuse: tex5Url, normal: tex5NormalUrl, specular: tex5SpecUrl },
  { diffuse: tex6Url, normal: tex6NormalUrl, specular: tex6SpecUrl },
  { diffuse: tex7Url, normal: tex7NormalUrl, specular: tex7SpecUrl },
  { diffuse: tex8Url, normal: null, specular: null }, // Texture 8 has no normal/specular maps
];

export function createScene({ audioManager, entryState, entryDoor = 'back', cafeteriaUnlocked = false, chestOpened, onChestCollected, preview = false, teleportArrival = false, teleportDeviceCollected: initialTeleportDeviceCollected = false, onTeleportDeviceCollected }: {
  audioManager?: unknown; entryState?: PlayerTransitionState; entryDoor?: 'back' | 'front'; cafeteriaUnlocked?: boolean; chestOpened?: boolean; onChestCollected?: () => void; preview?: boolean; teleportArrival?: boolean; teleportDeviceCollected?: boolean; onTeleportDeviceCollected?: () => void;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a10);

  // --- Room dimensions (smaller than scene2, similar wall style to scene3) ---
  const roomWidth = 10;
  const roomDepth = 12;
  const roomHeight = 4.5;
  const doorW = 3;

  // --- Physics ---
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  const floorPhysMat = physics.solidMaterial;

  // --- Procedural dirty tile texture (same as scene3) ---
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
    mat.map!.repeat.set(5, 6);
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
  const wallMat = makeDirtyWallMat(5, 2);
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

  // --- Floor ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.addBox({ x: roomWidth, y: 0.4, z: roomDepth }, { x: 0, y: -0.2, z: 0 });
  // Pad past the front door so the player never leaves solid ground mid-transition to scene 7
  physics.addBox({ x: doorW + 2, y: 0.4, z: 6 }, { x: 0, y: -0.2, z: roomDepth / 2 + 3 });
  // Pad past the back door so the player never leaves solid ground mid-transition to scene 3
  physics.addBox({ x: doorW + 2, y: 0.4, z: 6 }, { x: 0, y: -0.2, z: -(roomDepth / 2 + 3) });

  // --- Ceiling ---
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // --- Walls (same style as scene3) ---
  const doorH = 3.5;
  const makeWall = (w: number, h: number, pos: THREE.Vector3, rotY: number) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    wall.position.copy(pos);
    wall.rotation.y = rotY;
    wall.receiveShadow = true;
    scene.add(wall);
    return wall;
  };

  // Back wall (entry from scene3)
  const backWallLeftW = (roomWidth - doorW) / 2;
  makeWall(backWallLeftW, roomHeight, new THREE.Vector3(-roomWidth / 2 + backWallLeftW / 2, roomHeight / 2, -roomDepth / 2), 0);
  makeWall(backWallLeftW, roomHeight, new THREE.Vector3(roomWidth / 2 - backWallLeftW / 2, roomHeight / 2, -roomDepth / 2), 0);
  makeWall(doorW, roomHeight - doorH, new THREE.Vector3(0, doorH + (roomHeight - doorH) / 2, -roomDepth / 2), 0);
  // Front wall with a doorway into the cafeteria scene.
  makeWall(backWallLeftW, roomHeight, new THREE.Vector3(-roomWidth / 2 + backWallLeftW / 2, roomHeight / 2, roomDepth / 2), Math.PI);
  makeWall(backWallLeftW, roomHeight, new THREE.Vector3(roomWidth / 2 - backWallLeftW / 2, roomHeight / 2, roomDepth / 2), Math.PI);
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
  addWallBody(-roomWidth / 2 + backWallLeftW / 2, roomHeight / 2, -roomDepth / 2, backWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(roomWidth / 2 - backWallLeftW / 2, roomHeight / 2, -roomDepth / 2, backWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(0, doorH + (roomHeight - doorH) / 2, -roomDepth / 2, doorW / 2, (roomHeight - doorH) / 2, wallThickness);
  addWallBody(-roomWidth / 2 + backWallLeftW / 2, roomHeight / 2, roomDepth / 2, backWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(roomWidth / 2 - backWallLeftW / 2, roomHeight / 2, roomDepth / 2, backWallLeftW / 2, roomHeight / 2, wallThickness);
  addWallBody(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2, doorW / 2, (roomHeight - doorH) / 2, wallThickness);
  addWallBody(-roomWidth / 2, roomHeight / 2, 0, wallThickness, roomHeight / 2, roomDepth / 2);
  addWallBody(roomWidth / 2, roomHeight / 2, 0, wallThickness, roomHeight / 2, roomDepth / 2);

  // --- Door frame (entry only) ---
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

  // --- Sliding door (entry) ---
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

  const doorZ = -roomDepth / 2 - 0.15;
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
  sBase.position.set(0, doorH + 0.2, -roomDepth / 2 + 0.06);
  scene.add(sBase);
  const sLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  const sLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), sLightMat);
  sLight.position.set(0, doorH + 0.2, -roomDepth / 2 - 0.02);
  scene.add(sLight);
  const doorBack: DoorState = { panelL, panelR, seam, sLightMat, open: 0, targetOpen: 0, z: doorZ };
  const frontDoorZ = roomDepth / 2 + 0.15;
  const frontDoorTarget = new THREE.Group();
  frontDoorTarget.name = 'cafeteria-door';
  scene.add(frontDoorTarget);
  const frontPanelL = new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorH, doorPanelD), wallMat);
  const frontPanelR = new THREE.Mesh(new THREE.BoxGeometry(doorPanelW, doorH, doorPanelD), wallMat);
  frontPanelL.position.set(-doorPanelW / 2, doorH / 2, frontDoorZ);
  frontPanelR.position.set(doorPanelW / 2, doorH / 2, frontDoorZ);
  frontPanelL.castShadow = true; frontPanelR.castShadow = true;
  frontDoorTarget.add(frontPanelL); frontDoorTarget.add(frontPanelR);
  const frontSeam = new THREE.Mesh(new THREE.BoxGeometry(0.02, doorH, doorPanelD + 0.01), doorSeamMat);
  frontSeam.position.set(0, doorH / 2, frontDoorZ);
  frontDoorTarget.add(frontSeam);
  const frontLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  const frontLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), frontLightMat);
  frontLight.position.set(0, doorH + 0.2, roomDepth / 2 + 0.02);
  frontDoorTarget.add(frontLight);
  const frontDoor: DoorState = { panelL: frontPanelL, panelR: frontPanelR, seam: frontSeam, sLightMat: frontLightMat, open: 0, targetOpen: 0, z: frontDoorZ };
  const frontDoorBody = new CANNON.Body({ mass: 0, material: floorPhysMat });
  frontDoorBody.addShape(new CANNON.Box(new CANNON.Vec3(doorW / 2, doorH / 2, wallThickness)));
  frontDoorBody.position.set(0, doorH / 2, roomDepth / 2);
  frontDoorBody.collisionResponse = true;
  physicsWorld.addBody(frontDoorBody);

  // --- BETTER LIGHTING (key difference from scene3) ---
  // More lights, higher intensity, less flicker - so you can see the dirty walls
  const lightColor = 0xaabbcc; // Slightly warmer/brighter than scene3
  const flickerLights: Array<{
    light: THREE.PointLight;
    tubeMat: THREE.MeshStandardMaterial;
    baseIntensity: number;
    flickerSpeed: number;
    flickerAmount: number;
    phase: number;
  }> = [];

  // Ceiling light positions - grid pattern for better coverage
  const lightPositions = [
    { x: -2.5, z: -3 }, { x: 2.5, z: -3 },
    { x: -2.5, z: 0 }, { x: 2.5, z: 0 },
    { x: -2.5, z: 3 }, { x: 2.5, z: 3 },
    { x: 0, z: -4.5 }, { x: 0, z: 4.5 },
  ];

  for (let i = 0; i < lightPositions.length; i++) {
    const lp = lightPositions[i];
    // Higher intensity lights for better visibility
    const light = new THREE.PointLight(lightColor, 8, 16);
    light.position.set(lp.x, roomHeight - 0.4, lp.z);
    light.castShadow = i % 2 === 0;
    if (light.castShadow) light.shadow.mapSize.set(256, 256);
    scene.add(light);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lightColor, emissiveIntensity: 2.0 });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.15), tubeMat);
    tube.position.set(lp.x, roomHeight - 0.05, lp.z);
    scene.add(tube);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x444450, metalness: 0.6, roughness: 0.4 }));
    housing.position.set(lp.x, roomHeight - 0.02, lp.z);
    scene.add(housing);
    flickerLights.push({
      light, tubeMat, baseIntensity: 8,
      // Much gentler flicker - mostly stable with subtle variation
      flickerSpeed: 1 + Math.random() * 2,
      flickerAmount: 0.05 + Math.random() * 0.05,
      phase: Math.random() * Math.PI * 2,
    });
  }

  // Stronger ambient light for overall visibility
  const ambLight = new THREE.AmbientLight(0x667788, 4.5);
  scene.add(ambLight);

  // Additional fill lights to illuminate walls
  const fillLight1 = new THREE.PointLight(0x8899aa, 3, 20);
  fillLight1.position.set(0, 2, 0);
  scene.add(fillLight1);

  // Wall wash lights
  const wallWashL = new THREE.PointLight(0x99aabb, 2.5, 15);
  wallWashL.position.set(-roomWidth / 2 + 0.5, 2.5, 0);
  scene.add(wallWashL);
  const wallWashR = new THREE.PointLight(0x99aabb, 2.5, 15);
  wallWashR.position.set(roomWidth / 2 - 0.5, 2.5, 0);
  scene.add(wallWashR);

  // --- Wall panel seams (same as scene3) ---
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, metalness: 0.2, roughness: 0.9 });
  for (let z = -roomDepth / 2 + 2; z < roomDepth / 2; z += 3) {
    const seamL = new THREE.Mesh(new THREE.BoxGeometry(0.02, roomHeight, 0.02), seamMat);
    seamL.position.set(-roomWidth / 2 + 0.01, roomHeight / 2, z);
    scene.add(seamL);
    const seamR = new THREE.Mesh(new THREE.BoxGeometry(0.02, roomHeight, 0.02), seamMat);
    seamR.position.set(roomWidth / 2 - 0.01, roomHeight / 2, z);
    scene.add(seamR);
  }

  // --- Computer consoles (single model repeated across walls) ---
  const objLoader = new OBJLoader();
  const computerModels: THREE.Group[] = [];

  // Use one textured material for all wall computers
  const textureLoader = new THREE.TextureLoader();
  const wallComputerMat = (() => {
    const diffuse = textureLoader.load(TEXTURE_SETS[0].diffuse);
    diffuse.colorSpace = THREE.SRGBColorSpace;
    const params: THREE.MeshStandardMaterialParameters = { map: diffuse, metalness: 0.3, roughness: 0.6 };
    if (TEXTURE_SETS[0].normal) {
      const n = textureLoader.load(TEXTURE_SETS[0].normal);
      n.wrapS = n.wrapT = THREE.RepeatWrapping;
      params.normalMap = n;
      params.normalScale = new THREE.Vector2(0.8, 0.8);
    }
    if (TEXTURE_SETS[0].specular) {
      const r = textureLoader.load(TEXTURE_SETS[0].specular);
      r.wrapS = r.wrapT = THREE.RepeatWrapping;
      params.roughnessMap = r;
    }
    return new THREE.MeshStandardMaterial(params);
  })();

  // Place one computer model many times, restricted to the left and right walls.
  const wallComputerPlacements: Array<{ x: number; z: number; rotY: number }> = [
    // Left wall (facing right)
    { x: -roomWidth / 2 + 0.6, z: -4, rotY: Math.PI / 2 },
    { x: -roomWidth / 2 + 0.6, z: -2, rotY: Math.PI / 2 },
    { x: -roomWidth / 2 + 0.6, z: 0, rotY: Math.PI / 2 },
    { x: -roomWidth / 2 + 0.6, z: 2, rotY: Math.PI / 2 },
    { x: -roomWidth / 2 + 0.6, z: 4, rotY: Math.PI / 2 },
    // Right wall (facing left)
    { x: roomWidth / 2 - 0.6, z: -4, rotY: -Math.PI / 2 },
    { x: roomWidth / 2 - 0.6, z: -2, rotY: -Math.PI / 2 },
    { x: roomWidth / 2 - 0.6, z: 0, rotY: -Math.PI / 2 },
    { x: roomWidth / 2 - 0.6, z: 2, rotY: -Math.PI / 2 },
    { x: roomWidth / 2 - 0.6, z: 4, rotY: -Math.PI / 2 },
  ];

  for (const placement of wallComputerPlacements) {
    // Static collider so the player can't walk through the wall-mounted consoles.
    const body = new CANNON.Body({ mass: 0, material: floorPhysMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.25, 0.35, 0.35)));
    body.position.set(placement.x, 0.8, placement.z);
    physicsWorld.addBody(body);

    objLoader.load(COMPUTER_URLS[4], (obj) => { // computer5.obj
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const targetHeight = 0.7;
      const scale = targetHeight / size.y;
      obj.scale.set(scale, scale, scale);
      obj.position.set(placement.x, 0.8, placement.z);
      obj.rotation.y = placement.rotY;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = wallComputerMat;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(obj);
      computerModels.push(obj);
    });
  }

  // --- Treasure chest (behind the enemy's pacing spot, against the front wall) ---
  const chestPosition = new THREE.Vector3(0, 0, roomDepth / 2 - 1.5);
  let chestMixer: THREE.AnimationMixer | null = null;
  let chestOpenAction: THREE.AnimationAction | null = null;
  let chestIdleOpenAction: THREE.AnimationAction | null = null;
  let chestInteractionStarted = false;
  let chestReady = false;
  let chestLooted = !!chestOpened;
  let chestModel: THREE.Group | null = null;
  let chestBody: CANNON.Body | null = null;
  const interactPrompt = preview ? null : document.getElementById('interact-prompt');
  const interactRange = 1.8;

  // Chest is already looted from a prior visit - never spawn it again.
  if (!chestLooted) {
    loadToolModel('Prop_Chest').then(gltf => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      gltf.scene.position.y -= box.min.y;
      gltf.scene.position.add(chestPosition);
      gltf.scene.rotation.y = Math.PI;
      gltf.scene.traverse(child => {
        if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
      });
      scene.add(gltf.scene);
      chestModel = gltf.scene;

      const size = box.getSize(new THREE.Vector3());
      chestBody = new CANNON.Body({ mass: 0, material: floorPhysMat });
      chestBody.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
      chestBody.position.set(chestPosition.x, size.y / 2, chestPosition.z);
      physicsWorld.addBody(chestBody);

      chestMixer = new THREE.AnimationMixer(gltf.scene);
      const findClip = (name: string) => THREE.AnimationClip.findByName(gltf.animations, name);
      const idleClosed = findClip('Idle_Closed');
      const openClip = findClip('Open');
      const idleOpen = findClip('Idle_Open');
      if (idleClosed) chestMixer.clipAction(idleClosed).play();
      if (openClip) {
        chestOpenAction = chestMixer.clipAction(openClip);
        chestOpenAction.setLoop(THREE.LoopOnce, 1);
        chestOpenAction.clampWhenFinished = true;
      }
      if (idleOpen) chestIdleOpenAction = chestMixer.clipAction(idleOpen);
      chestReady = true;
    }).catch(error => console.error('[Scene4] Failed to load chest:', error));
  }

  // --- Enemy defeat gate + 'E' interact ---
  let enemyDefeated = false;
  function setEnemyDefeated(defeated: boolean) { enemyDefeated = defeated; }

  function openChest() {
    if (chestInteractionStarted) return;
    chestInteractionStarted = true;
    player.requestAction('Interact');
    chestLooted = true;
    cafeteriaUnlocked = true;
    frontDoorTarget.visible = true;
    if (interactPrompt) interactPrompt.classList.add('hidden');
    if (chestOpenAction && chestMixer) {
      const onFinished = (event: THREE.AnimationMixerEventMap['finished']) => {
        if (event.action !== chestOpenAction) return;
        chestMixer?.removeEventListener('finished', onFinished);
        chestIdleOpenAction?.reset().play();
        if (chestModel) { scene.remove(chestModel); chestModel = null; }
        if (chestBody) { physicsWorld.removeBody(chestBody); chestBody = null; }
      };
      chestMixer.addEventListener('finished', onFinished);
      chestOpenAction.reset().play();
    }
    onChestCollected?.();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.code !== 'KeyE' || !player.isEnabled() || chestLooted || !enemyDefeated || !chestReady) return;
    const dx = player.body.position.x - chestPosition.x;
    const dz = player.body.position.z - chestPosition.z;
    if (Math.hypot(dx, dz) <= interactRange) openChest();
  }
  window.addEventListener('keydown', onKeyDown);

  // --- Teleportation Device Collectible ---
  const teleportDevicePos = new THREE.Vector3(-roomWidth / 2 + 0.6, 1.2, 0);
  const teleportDeviceGeo = new THREE.OctahedronGeometry(0.25, 0);
  const teleportDeviceMat = new THREE.MeshStandardMaterial({
    color: 0x9b59b6,
    emissive: 0x8e44ad,
    emissiveIntensity: 1.5,
    metalness: 0.7,
    roughness: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  const teleportDevice = new THREE.Mesh(teleportDeviceGeo, teleportDeviceMat);
  teleportDevice.position.copy(teleportDevicePos);
  teleportDevice.castShadow = true;
  scene.add(teleportDevice);
  const teleportDeviceLight = new THREE.PointLight(0x8e44ad, 2, 4);
  teleportDeviceLight.position.copy(teleportDevicePos);
  scene.add(teleportDeviceLight);
  let teleportDeviceCollected = initialTeleportDeviceCollected;
  if (teleportDeviceCollected) {
    teleportDevice.visible = false;
    teleportDeviceLight.visible = false;
  }

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

  // --- Player ---
  const spawnZ = -roomDepth / 2 + 2;
  const spawnY = PHYSICS.playerRadius;
  const player = createPlayer({
    camera, physicsWorld,
    spawnPosition: { x: 0, y: spawnY, z: spawnZ },
  });
  player.setRotation(0, 0);
  player.enable();
  let arrivalTime = teleportArrival ? 0 : HOLOGRAM_TRANSFER_DURATION;
  if (entryState) {
    const entryZ = entryDoor === 'front' ? roomDepth / 2 : -roomDepth / 2;
    player.restoreTransition(entryState, { x: 0, y: 0, z: entryZ });
    const entry = entryDoor === 'front' ? frontDoor : doorBack;
    entry.open = entry.targetOpen = 1;
    entry.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
    entry.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
    entry.seam.visible = false;
    if (entryDoor === 'front') frontDoorBody.collisionResponse = false;
  }

  // --- Door trigger callback ---
  let onBackTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let onForwardTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let backCooldown = false;
  let forwardCooldown = false;

  function setBackTrigger(callback: (state: PlayerTransitionState) => void) { onBackTrigger = callback; }
  function setForwardTrigger(callback: (state: PlayerTransitionState) => void) { onForwardTrigger = callback; }
  function hitForwardDoor() {
    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorZone = Math.hypot(px, pz - frontDoor.z) < doorSensorRange &&
      px > -doorW / 2 - 1 && px < doorW / 2 + 1;
    if (cafeteriaUnlocked && inDoorZone) frontDoor.targetOpen = 1;
  }

  // --- Update ---
  let flickerTime = 0;
  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    if (arrivalTime < HOLOGRAM_TRANSFER_DURATION) {
      player.clearInput();
      arrivalTime = Math.min(HOLOGRAM_TRANSFER_DURATION, arrivalTime + dt);
    }
    physics.step(dt, player, thirdPerson);

    // Gentle light flicker (much subtler than scene3)
    flickerTime += dt;
    for (const fl of flickerLights) {
      const noise = Math.sin(flickerTime * fl.flickerSpeed + fl.phase) * 0.5 +
                    Math.sin(flickerTime * fl.flickerSpeed * 1.7 + fl.phase) * 0.3 +
                    (Math.random() - 0.5) * 0.1;
      const intensity = fl.baseIntensity * (0.9 + noise * fl.flickerAmount);
      fl.light.intensity = Math.max(0.5, intensity);
      fl.tubeMat.emissiveIntensity = Math.max(0.5, intensity / fl.baseIntensity * 2.0);
    }

    // Door sensor and animation
    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorX = px > -doorW / 2 - 1 && px < doorW / 2 + 1;

    const dist = Math.sqrt(px * px + (pz - doorBack.z) * (pz - doorBack.z));
    const near = (dist < doorSensorRange && inDoorX) || hasNearbyActor(physicsWorld, 0, doorBack.z, doorSensorRange);
    doorBack.targetOpen = near ? 1 : 0;
    if (near) {
      sLightMat.color.setHex(0x00ff44);
      sLightMat.emissive.setHex(0x00ff44);
    } else {
      sLightMat.color.setHex(0xff0000);
      sLightMat.emissive.setHex(0xff0000);
    }
    const slideDelta = doorSlideSpeed * dt;
    if (doorBack.open < doorBack.targetOpen) doorBack.open = Math.min(doorBack.open + slideDelta, 1);
    else if (doorBack.open > doorBack.targetOpen) doorBack.open = Math.max(doorBack.open - slideDelta, 0);
    const slideOffset = doorBack.open * doorSlideDistance;
    doorBack.panelL.position.x = -doorPanelW / 2 - slideOffset;
    doorBack.panelR.position.x = doorPanelW / 2 + slideOffset;
    doorBack.seam.visible = doorBack.open < 0.1;

    const frontInRange = Math.hypot(px, pz - frontDoor.z) < doorSensorRange && inDoorX;
    if (cafeteriaUnlocked && frontInRange) {
      frontDoor.sLightMat.color.setHex(0x00ff44);
      frontDoor.sLightMat.emissive.setHex(0x00ff44);
    } else {
      frontDoor.sLightMat.color.setHex(0xff0000);
      frontDoor.sLightMat.emissive.setHex(0xff0000);
    }
    if (frontDoor.open < frontDoor.targetOpen) frontDoor.open = Math.min(frontDoor.open + slideDelta, 1);
    else if (frontDoor.open > frontDoor.targetOpen) frontDoor.open = Math.max(frontDoor.open - slideDelta, 0);
    const frontSlideOffset = frontDoor.open * doorSlideDistance;
    frontDoor.panelL.position.x = -doorPanelW / 2 - frontSlideOffset;
    frontDoor.panelR.position.x = doorPanelW / 2 + frontSlideOffset;
    frontDoor.seam.visible = frontDoor.open < 0.1;
    frontDoorBody.collisionResponse = frontDoor.open < 0.9;

    // Check door trigger (back to scene3)
    if (onBackTrigger && !backCooldown && doorBack.open > 0.9 && pz <= -roomDepth / 2 && Math.abs(px) <= (doorW + 2) / 2 + player.radius) {
      backCooldown = true;
      onBackTrigger(player.captureDoorTransition({ x: 0, y: 0, z: -roomDepth / 2, yaw: 0 }));
    }
    if (onForwardTrigger && !forwardCooldown && frontDoor.open > 0.9 && pz >= roomDepth / 2 && Math.abs(px) <= (doorW + 2) / 2 + player.radius) {
      forwardCooldown = true;
      onForwardTrigger(player.captureDoorTransition({ x: 0, y: 0, z: roomDepth / 2 }, 1));
    }

    // Chest animation + interact prompt
    chestMixer?.update(dt);
    if (interactPrompt) {
      const dxChest = px - chestPosition.x;
      const dzChest = pz - chestPosition.z;
      const inRange = chestReady && !chestLooted && enemyDefeated && Math.hypot(dxChest, dzChest) <= interactRange;
      interactPrompt.classList.toggle('hidden', !inRange);
    }

    // Teleportation device collection
    if (!teleportDeviceCollected) {
      const t = performance.now() * 0.001;
      teleportDevice.rotation.y = t * 1.5;
      teleportDevice.rotation.x = Math.sin(t * 2) * 0.2;
      teleportDevice.position.y = teleportDevicePos.y + Math.sin(t * 2.5) * 0.1;
      teleportDeviceMat.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.3;

      const dx = px - teleportDevicePos.x;
      const dz = pz - teleportDevicePos.z;
      if (Math.hypot(dx, dz) < 1.2 && player.isEnabled()) {
        teleportDeviceCollected = true;
        teleportDevice.visible = false;
        teleportDeviceLight.visible = false;
        onTeleportDeviceCollected?.();
      }
    }
  }

  // --- Teleportation Device Placed Marker ---
  let placedMarkerMesh: THREE.Mesh | null = null;
  let placedMarkerLight: THREE.PointLight | null = null;

  function createPlacedMarker(position: THREE.Vector3) {
    // Remove existing marker if any
    if (placedMarkerMesh) {
      scene.remove(placedMarkerMesh);
      placedMarkerMesh.geometry.dispose();
      (placedMarkerMesh.material as THREE.Material).dispose();
      placedMarkerMesh = null;
    }
    if (placedMarkerLight) {
      scene.remove(placedMarkerLight);
      placedMarkerLight = null;
    }

    // Create a glowing cylinder marker
    const markerGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0x9b59b6,
      emissive: 0x8e44ad,
      emissiveIntensity: 2,
      metalness: 0.5,
      roughness: 0.3,
      transparent: true,
      opacity: 0.8,
    });
    placedMarkerMesh = new THREE.Mesh(markerGeo, markerMat);
    placedMarkerMesh.position.copy(position);
    placedMarkerMesh.position.y = 0.025; // Just above the floor
    placedMarkerMesh.receiveShadow = true;
    scene.add(placedMarkerMesh);

    // Add a point light for glow effect
    placedMarkerLight = new THREE.PointLight(0x8e44ad, 3, 5);
    placedMarkerLight.position.copy(position);
    placedMarkerLight.position.y = 0.5;
    scene.add(placedMarkerLight);
  }

  return {
    scene, camera, physicsWorld, updatePhysics,
    cutsceneManager: null,
    player,
    setBackTrigger,
    setForwardTrigger,
    forwardDoorTarget: frontDoorTarget,
    hitForwardDoor,
    setEnemyDefeated,
    getHologramTransition: () => arrivalTime < HOLOGRAM_TRANSFER_DURATION ? hologramTransitionAt(arrivalTime, true) : null,
    getTeleportDeviceCollected: () => teleportDeviceCollected,
    createPlacedMarker,
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      if (interactPrompt) interactPrompt.classList.add('hidden');
      player.dispose();
      physics.dispose();
      teleportDeviceGeo.dispose();
      teleportDeviceMat.dispose();
      if (placedMarkerMesh) {
        placedMarkerMesh.geometry.dispose();
        (placedMarkerMesh.material as THREE.Material).dispose();
      }
    },
  };
}
