/**
 * Scene 4 - Computer room / bridge with better lighting, ship consoles.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import comicVert from '../shaders/comic.vert.glsl?raw';
import comicFrag from '../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { disposeSurveillanceScene } from '../scripts/cctv.js';

// Computer model imports (FBX for 1-2, OBJ for 3-8)
import computer1Url from '../assets/models/Retro computers/models/Computer1.fbx';
import computer2Url from '../assets/models/Retro computers/models/Computer2.fbx';
import computer3Url from '../assets/models/Retro computers/models/computer3.obj';
import computer4Url from '../assets/models/Retro computers/models/computer4.obj';
import computer5Url from '../assets/models/Retro computers/models/computer5.obj';
import computer6Url from '../assets/models/Retro computers/models/computer6.obj';
import computer7Url from '../assets/models/Retro computers/models/computer7.obj';
import computer8Url from '../assets/models/Retro computers/models/computer8.obj';

// Texture imports
import tex1Url from '../assets/models/Retro computers/textures/MachineTexture1.png';
import tex1NormalUrl from '../assets/models/Retro computers/textures/MachineTexture1_normal.png';
import tex1SpecUrl from '../assets/models/Retro computers/textures/MachineTexture1_spec.png';
import tex2Url from '../assets/models/Retro computers/textures/MachineTexture2.png';
import tex2NormalUrl from '../assets/models/Retro computers/textures/MachineTexture2_normal.png';
import tex2SpecUrl from '../assets/models/Retro computers/textures/MachineTexture2_spec.png';
import tex3Url from '../assets/models/Retro computers/textures/MachineTexture3.png';
import tex3NormalUrl from '../assets/models/Retro computers/textures/MachineTexture3_normal.png';
import tex3SpecUrl from '../assets/models/Retro computers/textures/MachineTexture3_spec.png';
import tex4Url from '../assets/models/Retro computers/textures/MachineTexture4.png';
import tex4NormalUrl from '../assets/models/Retro computers/textures/MachineTexture4_normal.png';
import tex4SpecUrl from '../assets/models/Retro computers/textures/MachineTexture4_spec.png';
import tex5Url from '../assets/models/Retro computers/textures/MachineTexture5.png';
import tex5NormalUrl from '../assets/models/Retro computers/textures/MachineTexture5_normal.png';
import tex5SpecUrl from '../assets/models/Retro computers/textures/MachineTexture5_spec.png';
import tex6Url from '../assets/models/Retro computers/textures/MachineTexture6.png';
import tex6NormalUrl from '../assets/models/Retro computers/textures/MachineTexture6_normal.png';
import tex6SpecUrl from '../assets/models/Retro computers/textures/MachineTexture6_spec.png';
import tex7Url from '../assets/models/Retro computers/textures/MachineTexture7.png';
import tex7NormalUrl from '../assets/models/Retro computers/textures/MachineTexture7_normal.png';
import tex7SpecUrl from '../assets/models/Retro computers/textures/MachineTexture7_spec.png';
import tex8Url from '../assets/models/Retro computers/textures/MachineTexture8.png';

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

export function createScene({ audioManager, entryState, surveillanceOnly = false }: {
  audioManager?: unknown; entryState?: PlayerTransitionState; surveillanceOnly?: boolean;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a10);
  let disposed = false;

  // --- Room dimensions (smaller than scene2, similar wall style to scene3) ---
  const roomWidth = 10;
  const roomDepth = 12;
  const roomHeight = 4.5;

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
  // Threshold extends through the back door (entry from scene3)
  physics.addBox({ x: 3, y: 0.4, z: 2 }, { x: 0, y: -0.2, z: -(roomDepth / 2 + 1) });

  // --- Ceiling ---
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // --- Walls (same style as scene3) ---
  const doorW = 3, doorH = 3.5;
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
  // Front wall (solid, no exit)
  makeWall(roomWidth, roomHeight, new THREE.Vector3(0, roomHeight / 2, roomDepth / 2), Math.PI);
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
  addWallBody(0, roomHeight / 2, roomDepth / 2, roomWidth / 2, roomHeight / 2, wallThickness);
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

  // --- Soft glow at doorway ---
  const doorwayGlowMat = new THREE.MeshBasicMaterial({
    color: 0x8899aa,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
  });
  const doorwayGlow = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorwayGlowMat);
  doorwayGlow.position.set(0, doorH / 2, -roomDepth / 2);
  scene.add(doorwayGlow);

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

  // --- Computer consoles (ship-style arrangement) ---
  const objLoader = new OBJLoader();
  const fbxLoader = new FBXLoader();
  const computerModels: THREE.Group[] = [];
  const computerColliders: Array<{ min: THREE.Vector3; max: THREE.Vector3 }> = [];

  // Console desk material
  const consoleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.6, roughness: 0.4 });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x112233, emissive: 0x2244aa, emissiveIntensity: 0.8,
    metalness: 0.3, roughness: 0.2,
  });

  // Create materials with textures for each computer
  const textureLoader = new THREE.TextureLoader();
  const computerMaterials: THREE.MeshStandardMaterial[] = [];
  function createComputerMaterial(texSetIdx: number): THREE.MeshStandardMaterial {
    const texSet = TEXTURE_SETS[texSetIdx % TEXTURE_SETS.length];
    const diffuse = textureLoader.load(texSet.diffuse);
    diffuse.colorSpace = THREE.SRGBColorSpace;
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping;

    const matParams: THREE.MeshStandardMaterialParameters = {
      map: diffuse,
      metalness: 0.3,
      roughness: 0.6,
    };

    if (texSet.normal) {
      const normal = textureLoader.load(texSet.normal);
      normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
      matParams.normalMap = normal;
      matParams.normalScale = new THREE.Vector2(0.8, 0.8);
    }

    if (texSet.specular) {
      const roughness = textureLoader.load(texSet.specular); // Use specular as roughness
      roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
      matParams.roughnessMap = roughness;
    }

    return new THREE.MeshStandardMaterial(matParams);
  }

  // Computer placement positions (ship bridge style)
  const computerPlacements = [
    // Left wall consoles
    { x: -roomWidth / 2 + 0.8, z: -2, rotY: Math.PI / 2, modelIdx: 0 },
    { x: -roomWidth / 2 + 0.8, z: 1, rotY: Math.PI / 2, modelIdx: 1 },
    { x: -roomWidth / 2 + 0.8, z: 4, rotY: Math.PI / 2, modelIdx: 2 },
    // Right wall consoles
    { x: roomWidth / 2 - 0.8, z: -2, rotY: -Math.PI / 2, modelIdx: 3 },
    { x: roomWidth / 2 - 0.8, z: 1, rotY: -Math.PI / 2, modelIdx: 4 },
    { x: roomWidth / 2 - 0.8, z: 4, rotY: -Math.PI / 2, modelIdx: 5 },
    // Center consoles (facing back wall)
    { x: -2, z: 2, rotY: 0, modelIdx: 6 },
    { x: 2, z: 2, rotY: 0, modelIdx: 7 },
  ];

  // Desk height - computers sit on top of this
  const deskHeight = 0.8;

  // Load and place computers
  let loadedCount = 0;
  for (const placement of computerPlacements) {
    const url = COMPUTER_URLS[placement.modelIdx % COMPUTER_URLS.length];
    const material = createComputerMaterial(placement.modelIdx);
    computerMaterials.push(material);
    const isFBX = placement.modelIdx < 2; // Computer1 and Computer2 are FBX

    const onLoad = (obj: THREE.Group) => {
      if (disposed) {
        disposeSurveillanceScene(obj);
        return;
      }
      // Scale to reasonable size (models are roughly 1-2 units, scale to ~0.6-0.8)
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const targetHeight = 0.7;
      const scale = targetHeight / size.y;
      obj.scale.set(scale, scale, scale);

      // Position on top of desk
      obj.position.set(placement.x, deskHeight, placement.z);
      obj.rotation.y = placement.rotY;

      // Apply material and enable shadows
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = material;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(obj);
      computerModels.push(obj);

      // Add collider for the computer
      const scaledSize = size.clone().multiplyScalar(scale);
      computerColliders.push({
        min: new THREE.Vector3(placement.x - scaledSize.x / 2 - 0.1, 0, placement.z - scaledSize.z / 2 - 0.1),
        max: new THREE.Vector3(placement.x + scaledSize.x / 2 + 0.1, deskHeight + scaledSize.y, placement.z + scaledSize.z / 2 + 0.1),
      });

      loadedCount++;
    };

    if (isFBX) {
      fbxLoader.load(url, onLoad);
    } else {
      objLoader.load(url, onLoad);
    }
  }

  let flickerTime = 0;
  function updateEnvironment(dt: number) {
    flickerTime += dt;
    for (const fl of flickerLights) {
      const noise = Math.sin(flickerTime * fl.flickerSpeed + fl.phase) * 0.5 +
                    Math.sin(flickerTime * fl.flickerSpeed * 1.7 + fl.phase) * 0.3 +
                    (Math.random() - 0.5) * 0.1;
      const intensity = fl.baseIntensity * (0.9 + noise * fl.flickerAmount);
      fl.light.intensity = Math.max(0.5, intensity);
      fl.tubeMat.emissiveIntensity = Math.max(0.5, intensity / fl.baseIntensity * 2.0);
    }
  }

  if (surveillanceOnly) {
    physics.dispose();
    return {
      roomId: 'computer-room', scene, updateEnvironment,
      dispose() {
        disposed = true;
        const attachedMaterials = new Set<THREE.Material>();
        scene.traverse(object => {
          if (object instanceof THREE.Mesh) {
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) attachedMaterials.add(material);
          }
        });
        for (const material of computerMaterials) {
          if (attachedMaterials.has(material)) continue;
          material.map?.dispose();
          material.normalMap?.dispose();
          material.roughnessMap?.dispose();
          material.dispose();
        }
        disposeSurveillanceScene(scene);
      },
    };
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
  if (entryState) {
    player.restoreTransition(entryState, { x: 0, y: 0, z: -roomDepth / 2 });
    doorBack.open = doorBack.targetOpen = 1;
    doorBack.panelL.position.x = -doorPanelW / 2 - doorSlideDistance;
    doorBack.panelR.position.x = doorPanelW / 2 + doorSlideDistance;
    doorBack.seam.visible = false;
  }

  // --- Door trigger callback ---
  let onBackTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let backCooldown = false;

  function setBackTrigger(callback: (state: PlayerTransitionState) => void) { onBackTrigger = callback; }

  // --- Update ---
  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(dt, player, thirdPerson);
    updateEnvironment(dt);

    // Door sensor and animation
    const px = player.body.position.x;
    const pz = player.body.position.z;
    const inDoorX = px > -doorW / 2 - 1 && px < doorW / 2 + 1;

    const dist = Math.sqrt(px * px + (pz - doorBack.z) * (pz - doorBack.z));
    const near = dist < doorSensorRange && inDoorX;
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

    // Check door trigger (back to scene3)
    if (onBackTrigger && !backCooldown && doorBack.open > 0.9 && pz < -roomDepth / 2 - 0.8 && inDoorX) {
      backCooldown = true;
      onBackTrigger(player.captureTransition({ x: 0, y: 0, z: -roomDepth / 2, yaw: 0 }));
    }
  }

  return {
    roomId: 'computer-room',
    scene, camera, physicsWorld, updatePhysics, updateEnvironment,
    cutsceneManager: null,
    player,
    setBackTrigger,
    dispose: () => { player.dispose(); physics.dispose(); },
  };
}
