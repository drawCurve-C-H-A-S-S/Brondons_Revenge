/**
 * Scene 2 - Medical Bay Interior (two-floor warehouse style)
 * Two floors of capsules, stairs by the door, window to space.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import comicVert from '../shaders/comic.vert.glsl?raw';
import comicFrag from '../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS, hasNearbyActor } from '../helpers/physics/scenePhysics.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export function createScene({ audioManager, skipWake, entryState }: {
  audioManager?: unknown; skipWake?: boolean; entryState?: PlayerTransitionState;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // --- Room dimensions ---
  const roomWidth = 20;
  const floorHeight = 4.5;
  const roomDepth = 30;
  const totalHeight = floorHeight * 2 + 0.4;
  const slabThickness = 0.4;
  const floor2Y = floorHeight + slabThickness;
  const walkwayWidth = 5.5;
  const railingHeight = 1.1;

  // --- Physics World ---
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  const walkwayPhysMat = physics.solidMaterial;

  // --- Procedural tile texture ---
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 256;
  tileCanvas.height = 256;
  const tileCtx = tileCanvas.getContext('2d')!;
  tileCtx.fillStyle = '#e8e8e8';
  tileCtx.fillRect(0, 0, 256, 256);
  tileCtx.strokeStyle = '#cccccc';
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

  function makeWallMat(repX: number, repY: number) {
    const mat = new THREE.MeshStandardMaterial({ map: tileTexture.clone(), color: 0xeeeeee, roughness: 0.4, metalness: 0.05 });
    mat.map!.repeat.set(repX, repY);
    return mat;
  }
  const floorMat = (() => {
    const mat = new THREE.MeshStandardMaterial({ map: tileTexture.clone(), color: 0xdddddd, roughness: 0.5, metalness: 0.05 });
    mat.map!.repeat.set(10, 15);
    return mat;
  })();
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, metalness: 0.05 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });

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

  const mkBox = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  function addFrame(geo: THREE.BoxGeometry, x: number, y: number, z: number) {
    const m = new THREE.Mesh(geo, frameMat);
    m.position.set(x, y, z);
    scene.add(m);
  }

  // --- Ground floor ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  // --- Ceiling ---
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = totalHeight;
  scene.add(ceiling);

  // --- Walls ---
  const winW = 8, winH = 3.5, winBot = 0.6;
  const bwL = new THREE.Mesh(new THREE.PlaneGeometry((roomWidth - winW) / 2, totalHeight), makeWallMat(4, 4));
  bwL.position.set(-(roomWidth / 2) + (roomWidth - winW) / 4, totalHeight / 2, -roomDepth / 2);
  scene.add(bwL);
  const bwR = new THREE.Mesh(new THREE.PlaneGeometry((roomWidth - winW) / 2, totalHeight), makeWallMat(4, 4));
  bwR.position.set((roomWidth / 2) - (roomWidth - winW) / 4, totalHeight / 2, -roomDepth / 2);
  scene.add(bwR);
  const bwA = new THREE.Mesh(new THREE.PlaneGeometry(winW, totalHeight - winBot - winH), makeWallMat(4, 1));
  bwA.position.set(0, winBot + winH + (totalHeight - winBot - winH) / 2, -roomDepth / 2);
  scene.add(bwA);
  const bwB = new THREE.Mesh(new THREE.PlaneGeometry(winW, winBot), makeWallMat(4, 1));
  bwB.position.set(0, winBot / 2, -roomDepth / 2);
  scene.add(bwB);

  // Window frame + glass
  const ft = 0.12;
  addFrame(mkBox(winW + 0.3, ft, 0.2), 0, winBot + winH, -roomDepth / 2 + 0.05);
  addFrame(mkBox(winW + 0.3, ft, 0.2), 0, winBot, -roomDepth / 2 + 0.05);
  addFrame(mkBox(ft, winH, 0.2), -winW / 2, winBot + winH / 2, -roomDepth / 2 + 0.05);
  addFrame(mkBox(ft, winH, 0.2), winW / 2, winBot + winH / 2, -roomDepth / 2 + 0.05);
  const windowGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    new THREE.MeshStandardMaterial({ color: 0x112244, transparent: true, opacity: 0.12, metalness: 0.1, roughness: 0.05 })
  );
  windowGlass.position.set(0, winBot + winH / 2, -roomDepth / 2 + 0.02);
  scene.add(windowGlass);

  // --- Second floor green screen ---
  const greenScreenCanvas = document.createElement('canvas');
  greenScreenCanvas.width = 512;
  greenScreenCanvas.height = 224;
  const gsCtx = greenScreenCanvas.getContext('2d')!;
  gsCtx.fillStyle = '#113322';
  gsCtx.fillRect(0, 0, 512, 224);
  gsCtx.strokeStyle = '#00ff66';
  gsCtx.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) { gsCtx.beginPath(); gsCtx.moveTo(x, 0); gsCtx.lineTo(x, 224); gsCtx.stroke(); }
  for (let y = 0; y <= 224; y += 32) { gsCtx.beginPath(); gsCtx.moveTo(0, y); gsCtx.lineTo(512, y); gsCtx.stroke(); }
  const greenScreenTexture = new THREE.CanvasTexture(greenScreenCanvas);
  const topScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    new THREE.MeshStandardMaterial({ map: greenScreenTexture, emissive: 0x00ff66, emissiveIntensity: 0.6, emissiveMap: greenScreenTexture })
  );
  topScreen.position.set(0, floor2Y + winH / 2 + 0.3, -roomDepth / 2 + 0.03);
  scene.add(topScreen);
  addFrame(mkBox(winW + 0.3, ft, 0.2), 0, floor2Y + winH + 0.3, -roomDepth / 2 + 0.05);
  addFrame(mkBox(winW + 0.3, ft, 0.2), 0, floor2Y + 0.3, -roomDepth / 2 + 0.05);
  addFrame(mkBox(ft, winH, 0.2), -winW / 2, floor2Y + winH / 2 + 0.3, -roomDepth / 2 + 0.05);
  addFrame(mkBox(ft, winH, 0.2), winW / 2, floor2Y + winH / 2 + 0.3, -roomDepth / 2 + 0.05);
  const screenGlow = new THREE.PointLight(0x00ff66, 1.5, 10);
  screenGlow.position.set(0, floor2Y + winH / 2 + 0.3, -roomDepth / 2 + 2);
  scene.add(screenGlow);

  // Front wall (door wall)
  const doorW = 3, doorH = 3.5;
  const fwL = new THREE.Mesh(new THREE.PlaneGeometry((roomWidth - doorW) / 2, totalHeight), makeWallMat(4, 4));
  fwL.rotation.y = Math.PI;
  fwL.position.set(-(roomWidth / 2) + (roomWidth - doorW) / 4, totalHeight / 2, roomDepth / 2);
  scene.add(fwL);
  const fwR = new THREE.Mesh(new THREE.PlaneGeometry((roomWidth - doorW) / 2, totalHeight), makeWallMat(4, 4));
  fwR.rotation.y = Math.PI;
  fwR.position.set((roomWidth / 2) - (roomWidth - doorW) / 4, totalHeight / 2, roomDepth / 2);
  scene.add(fwR);
  const fwA = new THREE.Mesh(new THREE.PlaneGeometry(doorW, totalHeight - doorH), makeWallMat(2, 1));
  fwA.rotation.y = Math.PI;
  fwA.position.set(0, doorH + (totalHeight - doorH) / 2, roomDepth / 2);
  scene.add(fwA);

  // Door - sliding metal panels with comic shader
  const doorComicMat = makeComicMaterial(0x8899aa);
  const doorPanelW = doorW / 2 + 0.1;
  const doorPanelH = doorH;
  const doorPanelD = 0.08;
  const doorZ = roomDepth / 2 + 0.15;
  const doorLeft = new THREE.Mesh(mkBox(doorPanelW, doorPanelH, doorPanelD), doorComicMat);
  const doorRight = new THREE.Mesh(mkBox(doorPanelW, doorPanelH, doorPanelD), doorComicMat);
  doorLeft.position.set(-doorPanelW / 2, doorH / 2, doorZ);
  doorRight.position.set(doorPanelW / 2, doorH / 2, doorZ);
  doorLeft.castShadow = true;
  doorRight.castShadow = true;
  scene.add(doorLeft);
  scene.add(doorRight);
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x222233, emissive: 0x111122, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.2 });
  const doorSeam = new THREE.Mesh(mkBox(0.02, doorH, doorPanelD + 0.01), seamMat);
  doorSeam.position.set(0, doorH / 2, doorZ);
  scene.add(doorSeam);
  addFrame(mkBox(doorW + 0.3, 0.12, 0.25), 0, doorH, roomDepth / 2 - 0.05);
  addFrame(mkBox(0.12, doorH, 0.25), -doorW / 2, doorH / 2, roomDepth / 2 - 0.05);
  addFrame(mkBox(0.12, doorH, 0.25), doorW / 2, doorH / 2, roomDepth / 2 - 0.05);
  const sensorBase = new THREE.Mesh(mkBox(0.2, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.7, roughness: 0.3 }));
  sensorBase.position.set(0, doorH + 0.2, roomDepth / 2 - 0.06);
  scene.add(sensorBase);
  const sensorLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  const sensorLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), sensorLightMat);
  sensorLight.position.set(0, doorH + 0.2, roomDepth / 2 + 0.02);
  scene.add(sensorLight);
  let doorOpen = 0;
  let doorTargetOpen = 0;
  const doorSlideSpeed = 1.5;
  const doorSlideDistance = doorPanelW + 0.3;
  const doorSensorRange = 3.5;

  // Side walls
  const lw = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, totalHeight), makeWallMat(12, 4));
  lw.rotation.y = Math.PI / 2;
  lw.position.set(-roomWidth / 2, totalHeight / 2, 0);
  scene.add(lw);
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, totalHeight), makeWallMat(12, 4));
  rw.rotation.y = -Math.PI / 2;
  rw.position.set(roomWidth / 2, totalHeight / 2, 0);
  scene.add(rw);

  // --- Mirror ---
  const mirrorWidth = roomWidth;
  const mirrorHeight = totalHeight - floor2Y;
  const mirror = new Reflector(new THREE.PlaneGeometry(mirrorWidth, mirrorHeight), {
    clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x889999,
  });
  mirror.rotation.y = Math.PI;
  mirror.position.set(0, floor2Y + mirrorHeight / 2, roomDepth / 2 - 0.05);
  mirror.camera.layers.enable(1);
  scene.add(mirror);

  // --- Second floor walkways ---
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.05 });
  const lw2 = new THREE.Mesh(mkBox(walkwayWidth, slabThickness, roomDepth), slabMat);
  lw2.position.set(-roomWidth / 2 + walkwayWidth / 2, floorHeight + slabThickness / 2, 0);
  lw2.receiveShadow = true; lw2.castShadow = true; scene.add(lw2);
  const rw2 = new THREE.Mesh(mkBox(walkwayWidth, slabThickness, roomDepth), slabMat);
  rw2.position.set(roomWidth / 2 - walkwayWidth / 2, floorHeight + slabThickness / 2, 0);
  rw2.receiveShadow = true; rw2.castShadow = true; scene.add(rw2);
  const bw2 = new THREE.Mesh(mkBox(roomWidth - walkwayWidth * 2, slabThickness, walkwayWidth), slabMat);
  bw2.position.set(0, floorHeight + slabThickness / 2, -roomDepth / 2 + walkwayWidth / 2);
  bw2.receiveShadow = true; scene.add(bw2);
  const fw2 = new THREE.Mesh(mkBox(roomWidth - walkwayWidth * 2, slabThickness, walkwayWidth), slabMat);
  fw2.position.set(0, floorHeight + slabThickness / 2, roomDepth / 2 - walkwayWidth / 2);
  fw2.receiveShadow = true; scene.add(fw2);

  // Floor 2 surfaces
  const f2SurfaceMat = floorMat.clone();
  const addFloorSurface = (w: number, d: number, x: number, z: number) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), f2SurfaceMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, floor2Y + 0.01, z);
    s.receiveShadow = true;
    scene.add(s);
  };
  addFloorSurface(walkwayWidth, roomDepth, -roomWidth / 2 + walkwayWidth / 2, 0);
  addFloorSurface(walkwayWidth, roomDepth, roomWidth / 2 - walkwayWidth / 2, 0);
  addFloorSurface(roomWidth - walkwayWidth * 2, walkwayWidth, 0, -roomDepth / 2 + walkwayWidth / 2);
  addFloorSurface(roomWidth - walkwayWidth * 2, walkwayWidth, 0, roomDepth / 2 - walkwayWidth / 2);

  // --- Stairs ---
  const stairWidth = 2;
  const stairRun = 7;
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.3, roughness: 0.5 });
  const totalRise = floorHeight + slabThickness;
  const railGlassMat = new THREE.MeshStandardMaterial({
    color: 0x7799aa, transparent: true, opacity: 0.25, roughness: 0.3,
  });

  function createStairs(xPos: number) {
    const { group: stairs } = physics.addStaircase({
      width: stairWidth, run: stairRun, rise: totalRise, material: stepMat,
      position: { x: xPos, y: 0, z: roomDepth / 2 - walkwayWidth - stairRun },
    });

    const railMat = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.7, roughness: 0.3 });
    const slopeAngle = Math.atan2(totalRise, stairRun);
    const railLen = Math.sqrt(totalRise * totalRise + stairRun * stairRun);
    const hrGeo = mkBox(0.06, 0.06, railLen);
    function addHandrail(xOffset: number) {
      const rail = new THREE.Mesh(hrGeo, railMat);
      rail.position.set(xOffset, totalRise / 2 + railingHeight, stairRun / 2);
      rail.rotation.x = -slopeAngle;
      rail.castShadow = true;
      stairs.add(rail);
      physics.addBoxFromMesh(rail);
      const glass = new THREE.Mesh(mkBox(0.04, railingHeight * Math.cos(slopeAngle), railLen), railGlassMat);
      glass.position.set(xOffset, totalRise / 2 + railingHeight / 2, stairRun / 2);
      glass.rotation.x = -slopeAngle;
      stairs.add(glass);
      physics.addBoxFromMesh(glass);
    }
    addHandrail(-stairWidth / 2 - 0.06);
    addHandrail(stairWidth / 2 + 0.06);
    const postGeo = mkBox(0.06, railingHeight, 0.06);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const postY = t * totalRise + railingHeight / 2;
      const postZ = t * stairRun;
      const postL = new THREE.Mesh(postGeo, railMat);
      postL.position.set(-stairWidth / 2 - 0.06, postY, postZ);
      postL.castShadow = true; stairs.add(postL);
      physics.addBoxFromMesh(postL);
      const postR = new THREE.Mesh(postGeo, railMat);
      postR.position.set(stairWidth / 2 + 0.06, postY, postZ);
      postR.castShadow = true; stairs.add(postR);
      physics.addBoxFromMesh(postR);
    }
    return stairs;
  }
  scene.add(createStairs(-doorW / 2 - stairWidth / 2 - 0.5));
  scene.add(createStairs(doorW / 2 + stairWidth / 2 + 0.5));

  // --- Railings ---
  const railMat = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.7, roughness: 0.3 });
  const addRailing = (x: number, z: number, length: number, alongX: boolean) => {
    const rail = new THREE.Mesh(mkBox(alongX ? length : 0.06, 0.06, alongX ? 0.06 : length), railMat);
    rail.position.set(x, floor2Y + railingHeight, z);
    rail.castShadow = true; scene.add(rail);
    physics.addBoxFromMesh(rail);
    const glass = new THREE.Mesh(mkBox(alongX ? length : 0.04, railingHeight, alongX ? 0.04 : length), railGlassMat);
    glass.position.set(x, floor2Y + railingHeight / 2, z);
    scene.add(glass);
    physics.addBoxFromMesh(glass);
    const postCount = Math.max(1, Math.ceil(length / 2.5));
    for (let i = 0; i <= postCount; i++) {
      const t = (i / postCount) - 0.5;
      const post = new THREE.Mesh(mkBox(0.06, railingHeight, 0.06), railMat);
      post.position.set(alongX ? x + t * length : x, floor2Y + railingHeight / 2, alongX ? z : z + t * length);
      post.castShadow = true; scene.add(post);
      physics.addBoxFromMesh(post);
    }
  };
  const sideRailLen = roomDepth - walkwayWidth * 2 - 1;
  addRailing(-roomWidth / 2 + walkwayWidth, 0, sideRailLen, false);
  addRailing(roomWidth / 2 - walkwayWidth, 0, sideRailLen, false);
  addRailing(0, -roomDepth / 2 + walkwayWidth, roomWidth - walkwayWidth * 2 - 1, true);
  const frontRailZ = roomDepth / 2 - walkwayWidth;
  const stairCenterL = -doorW / 2 - stairWidth / 2 - 0.5;
  const stairCenterR = doorW / 2 + stairWidth / 2 + 0.5;
  const gapHalf = stairWidth / 2 + 0.3;
  const seg1Len = (roomWidth / 2 - walkwayWidth) - (Math.abs(stairCenterL) + gapHalf);
  addRailing(-(roomWidth / 2 - walkwayWidth) + seg1Len / 2, frontRailZ, seg1Len, true);
  const seg2Len = (stairCenterR - gapHalf) - (stairCenterL + gapHalf);
  addRailing((stairCenterL + gapHalf + stairCenterR - gapHalf) / 2, frontRailZ, seg2Len, true);
  addRailing((roomWidth / 2 - walkwayWidth) - seg1Len / 2, frontRailZ, seg1Len, true);

  // --- Capsules ---
  const capsuleMat = makeComicMaterial(0xcccccc);
  const capsuleGlassMat = new THREE.MeshStandardMaterial({
    color: 0x44aaff, transparent: true, opacity: 0.25, metalness: 0.15, roughness: 0.05,
    emissive: 0x1133aa, emissiveIntensity: 0.4, side: THREE.DoubleSide,
  });
  const capsuleBaseMat = makeComicMaterial(0x888899);
  const panelMat = makeComicMaterial(0x444455);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x00ff66, emissiveIntensity: 0.6 });
  const btnMat = new THREE.MeshStandardMaterial({ color: 0x333344, emissive: 0x00aaff, emissiveIntensity: 0.3 });

  function createHumanoid() {
    const group = new THREE.Group();
    const hue = 0.55 + Math.random() * 0.1;
    const sat = 0.5 + Math.random() * 0.3;
    const lgt = 0.35 + Math.random() * 0.2;
    const skinColor = new THREE.Color().setHSL(hue, sat, lgt);
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, emissive: skinColor, emissiveIntensity: 0.15, metalness: 0.1, roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), skinMat);
    head.scale.set(1, 1.1, 0.95); head.position.y = 0.72;
    head.rotation.z = (Math.random() - 0.5) * 0.4; head.rotation.x = (Math.random() - 0.5) * 0.3;
    group.add(head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 8), skinMat);
    neck.position.y = 0.62; group.add(neck);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 8), skinMat);
    torso.position.y = 0.38; torso.scale.set(1, 1, 0.7); group.add(torso);
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.12, 8), skinMat);
    hips.position.y = 0.14; hips.scale.set(1, 1, 0.7); group.add(hips);
    for (const side of [-1, 1]) {
      const shoulderAng = (Math.random() - 0.5) * 0.6;
      const elbowAng = 0.2 + Math.random() * 0.8;
      const ua = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 6), skinMat);
      ua.position.set(side * 0.17, 0.46, 0); ua.rotation.z = side * shoulderAng; ua.rotation.x = (Math.random() - 0.5) * 0.3; group.add(ua);
      const la = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.2, 6), skinMat);
      la.position.set(side * 0.19, 0.28, 0.02); la.rotation.z = side * elbowAng; la.rotation.x = (Math.random() - 0.5) * 0.4; group.add(la);
    }
    const legSpread = 0.02 + Math.random() * 0.04;
    for (const side of [-1, 1]) {
      const ul = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.3, 6), skinMat);
      ul.position.set(side * legSpread, -0.08, 0); ul.rotation.z = side * (Math.random() - 0.5) * 0.15; group.add(ul);
      const ll = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.28, 6), skinMat);
      ll.position.set(side * legSpread, -0.34, 0); ll.rotation.z = side * (Math.random() - 0.5) * 0.1; group.add(ll);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.1), skinMat);
      foot.position.set(side * legSpread, -0.5, 0.02); group.add(foot);
    }
    return group;
  }

  function createCapsule(stripColor: number | null, hasHumanoid: boolean) {
    const pod = new THREE.Group();
    const r = 0.6, elongation = 1.8;
    const base = new THREE.Mesh(mkBox(r * 2 + 0.2, 0.15, r * 2 * elongation + 0.3), capsuleBaseMat);
    base.position.y = 0.075; base.castShadow = true; base.receiveShadow = true; pod.add(base);
    const lowerGeo = new THREE.SphereGeometry(r, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const lowerMat = capsuleMat.clone(); lowerMat.side = THREE.DoubleSide;
    const lower = new THREE.Mesh(lowerGeo, lowerMat);
    lower.scale.set(1, 1, elongation); lower.position.y = 0.6; lower.castShadow = true; lower.receiveShadow = true; pod.add(lower);
    const bottomPlate = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2 * elongation), capsuleMat);
    bottomPlate.rotation.x = -Math.PI / 2; bottomPlate.position.y = 0.6; pod.add(bottomPlate);
    const upperGeo = new THREE.SphereGeometry(r * 1.01, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const upper = new THREE.Mesh(upperGeo, capsuleGlassMat);
    upper.scale.set(1, 1, elongation); upper.position.y = 0.6; pod.add(upper);
    const stripGeo = mkBox(0.04, 0.04, r * 2 * elongation - 0.2);
    const rc = stripColor || 0x00ff88;
    const sm2 = new THREE.MeshStandardMaterial({ color: rc, emissive: rc, emissiveIntensity: 1.2 });
    const stripR = new THREE.Mesh(stripGeo, sm2); stripR.position.set(r + 0.02, 0.55, 0); pod.add(stripR);
    const stripL = new THREE.Mesh(stripGeo, sm2); stripL.position.set(-r - 0.02, 0.55, 0); pod.add(stripL);
    if (hasHumanoid) {
      const humanoid = createHumanoid();
      humanoid.rotation.x = -Math.PI / 2; humanoid.position.y = 0.78;
      humanoid.position.z = (Math.random() - 0.5) * 0.3; pod.add(humanoid);
    }
    return pod;
  }

  function createControlPanel() {
    const panel = new THREE.Group();
    const body = new THREE.Mesh(mkBox(0.3, 1.4, 0.8), panelMat);
    body.position.y = 0.7; body.castShadow = true; panel.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), screenMat);
    screen.position.set(0.16, 1.0, 0); screen.rotation.y = Math.PI / 2; panel.add(screen);
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), btnMat);
      btn.rotation.z = Math.PI / 2; btn.position.set(0.16, 0.6, -0.15 + i * 0.15); panel.add(btn);
    }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 2.0 }));
    led.position.set(0.16, 1.25, 0.25); panel.add(led);
    return panel;
  }

  const capsulesPerSide = 8;
  const capsuleSpacing = (roomDepth - 4) / capsulesPerSide;
  const startZ = -roomDepth / 2 + 2;
  function placeCapsules(floorY: number, side: 'left' | 'right') {
    const wallX = side === 'left' ? -roomWidth / 2 : roomWidth / 2;
    const capsuleX = side === 'left' ? wallX + 1.2 : wallX - 1.2;
    const panelX = side === 'left' ? wallX + 0.2 : wallX - 0.2;
    for (let i = 0; i < capsulesPerSide; i++) {
      const z = startZ + capsuleSpacing * (i + 0.5);
      const isPlayerCapsule = (side === 'right' && floorY === 0 && i === 0);
      const pod = createCapsule(isPlayerCapsule ? 0xff2200 : 0x00ff88, !isPlayerCapsule);
      pod.position.set(capsuleX, floorY, z);
      pod.rotation.y = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
      scene.add(pod);
      const capBody = new CANNON.Body({ mass: 0, material: walkwayPhysMat });
      capBody.addShape(new CANNON.Box(new CANNON.Vec3(1.3, 0.6, 1.2)));
      capBody.position.set(capsuleX, floorY + 0.6, z); physicsWorld.addBody(capBody);
      const gapZ = z + capsuleSpacing / 2;
      const cp = createControlPanel();
      cp.position.set(panelX, floorY, gapZ);
      cp.rotation.y = side === 'left' ? 0 : Math.PI; scene.add(cp);
      const panelBody = new CANNON.Body({ mass: 0, material: walkwayPhysMat });
      panelBody.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.7, 0.45)));
      panelBody.position.set(panelX, floorY + 0.7, gapZ); physicsWorld.addBody(panelBody);
    }
  }
  placeCapsules(0, 'left'); placeCapsules(0, 'right');
  placeCapsules(floor2Y, 'left'); placeCapsules(floor2Y, 'right');

  // --- Central Machine ---
  const machineRadius = 1.5;
  const machineZ = -6.25;
  const machineGroup = new THREE.Group();
  const machineBodyMat = makeComicMaterial(0x445566);
  const machineBody = new THREE.Mesh(new THREE.CylinderGeometry(machineRadius, machineRadius, totalHeight, 24), machineBodyMat);
  machineBody.position.y = totalHeight / 2; machineBody.castShadow = true; machineBody.receiveShadow = true; machineGroup.add(machineBody);
  const topCap = new THREE.Mesh(new THREE.CylinderGeometry(machineRadius * 0.8, machineRadius, 0.5, 24), makeComicMaterial(0x556677));
  topCap.position.y = totalHeight + 0.25; topCap.castShadow = true; machineGroup.add(topCap);
  const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(machineRadius * 1.2, machineRadius * 1.2, 0.3, 24), makeComicMaterial(0x334455));
  basePlate.position.y = 0.15; basePlate.castShadow = true; machineGroup.add(basePlate);
  const vpMat = makeComicMaterial(0x667788);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, totalHeight + 1, 12), vpMat);
    pipe.position.set(Math.cos(a) * (machineRadius + 0.2), totalHeight / 2, Math.sin(a) * (machineRadius + 0.2));
    pipe.castShadow = true; machineGroup.add(pipe);
  }
  // Screen text canvas
  const sCanvas = document.createElement('canvas'); sCanvas.width = 512; sCanvas.height = 256;
  const sCtx = sCanvas.getContext('2d')!;
  sCtx.fillStyle = '#0a0a0a'; sCtx.fillRect(0, 0, 512, 256);
  sCtx.fillStyle = '#cc3333'; sCtx.font = 'bold 36px monospace';
  sCtx.textAlign = 'center'; sCtx.textBaseline = 'middle';
  sCtx.fillText('EMERGENCY POWER', 256, 90); sCtx.fillText('ENABLED', 256, 140);
  sCtx.fillStyle = '#dd4444'; sCtx.font = 'bold 32px monospace'; sCtx.fillText('ONE ERROR', 256, 200);
  const sTexture = new THREE.CanvasTexture(sCanvas);
  const sMat2 = new THREE.MeshStandardMaterial({ map: sTexture, emissive: 0xff2222, emissiveIntensity: 0.6, emissiveMap: sTexture, side: THREE.DoubleSide });
  const pulsingScreens: Array<{ material: THREE.MeshStandardMaterial; light: THREE.PointLight; phase: number }> = [];
  for (const pos of [{ y: 2, angle: Math.PI / 4 }, { y: 4, angle: 3 * Math.PI / 4 }, { y: 6, angle: 5 * Math.PI / 4 }, { y: 8, angle: 7 * Math.PI / 4 }]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), sMat2);
    const sd = machineRadius + 0.3;
    scr.position.set(Math.cos(pos.angle) * sd, pos.y, Math.sin(pos.angle) * sd);
    scr.lookAt(Math.cos(pos.angle) * (sd + 1), pos.y, Math.sin(pos.angle) * (sd + 1));
    machineGroup.add(scr);
    const sl = new THREE.PointLight(0xff4444, 1.5, 4); sl.position.copy(scr.position); machineGroup.add(sl);
    pulsingScreens.push({ material: sMat2, light: sl, phase: pos.angle });
    const fr = new THREE.Mesh(mkBox(1.3, 0.9, 0.05), new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.6, roughness: 0.4 }));
    fr.position.copy(scr.position); fr.rotation.copy(scr.rotation); machineGroup.add(fr);
  }
  const btnColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];
  for (const height of [1.5, 3, 5, 7]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: btnColors[i % btnColors.length], emissive: btnColors[i % btnColors.length], emissiveIntensity: 0.8 }));
      btn.rotation.z = Math.PI / 2;
      btn.position.set(Math.cos(a) * (machineRadius + 0.03), height, Math.sin(a) * (machineRadius + 0.03));
      btn.rotation.y = -a; machineGroup.add(btn);
    }
  }
  const ringMat = makeComicMaterial(0x556677);
  for (let y = 2; y < totalHeight; y += 2.5) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(machineRadius + 0.05, 0.08, 8, 24), ringMat);
    ring.position.y = y; ring.rotation.x = Math.PI / 2; machineGroup.add(ring);
  }
  machineGroup.position.set(0, 0, machineZ); scene.add(machineGroup);
  const machineLight = new THREE.PointLight(0xff4444, 2, 8);
  machineLight.position.set(0, 4, machineZ); scene.add(machineLight);

  // --- Starfield visible through window ---
  const starCount = 3000;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 100 + Math.random() * 100;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi);
    starPositions[i * 3 + 2] = -roomDepth / 2 - Math.abs(r * Math.sin(phi) * Math.sin(theta));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.9 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // --- Lighting ---
  const ceilingLightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0 });
  for (let z = -roomDepth / 2 + 4; z < roomDepth / 2; z += 6) {
    const lp = new THREE.Mesh(mkBox(2.5, 0.05, 1), ceilingLightMat);
    lp.position.set(0, totalHeight - 0.03, z); scene.add(lp);
    const pl = new THREE.PointLight(0xeeeeff, 4, 12);
    pl.position.set(0, totalHeight - 0.3, z); scene.add(pl);
  }
  for (let z = -roomDepth / 2 + 4; z < roomDepth / 2; z += 8) {
    const ll = new THREE.PointLight(0xeeeeff, 2, 8);
    ll.position.set(-roomWidth / 2 + walkwayWidth / 2, totalHeight - 0.3, z); scene.add(ll);
    const rl = new THREE.PointLight(0xeeeeff, 2, 8);
    rl.position.set(roomWidth / 2 - walkwayWidth / 2, totalHeight - 0.3, z); scene.add(rl);
  }
  const ambLight = new THREE.AmbientLight(0xddeeff, 0.4); scene.add(ambLight);
  const windowGlow = new THREE.PointLight(0x4466aa, 2, 20);
  windowGlow.position.set(0, 3, -roomDepth / 2 + 2); scene.add(windowGlow);

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.layers.set(0);

  // --- Ground floor physics ---
  physics.addBox({ x: roomWidth, y: slabThickness, z: roomDepth }, { x: 0, y: -slabThickness / 2, z: 0 });
  // Keep the transition threshold physically supported beyond the doorway.
  physics.addBox({ x: doorW, y: slabThickness, z: 2 }, { x: 0, y: -slabThickness / 2, z: roomDepth / 2 + 1 });
  for (const slab of [lw2, rw2, bw2, fw2]) physics.addBoxFromMesh(slab);
  // Wall physics
  const wallPhysMat = physics.solidMaterial;
  const wt = 0.5;
  const bw = new CANNON.Body({ mass: 0, material: wallPhysMat });
  bw.addShape(new CANNON.Box(new CANNON.Vec3(roomWidth / 2, totalHeight / 2, wt / 2)));
  bw.position.set(0, totalHeight / 2, -roomDepth / 2); physicsWorld.addBody(bw);
  const doorHalfW = doorW / 2;
  const sideW = roomWidth / 2 - doorHalfW;
  const fwL2 = new CANNON.Body({ mass: 0, material: wallPhysMat });
  fwL2.addShape(new CANNON.Box(new CANNON.Vec3(sideW / 2, totalHeight / 2, wt / 2)));
  fwL2.position.set(-roomWidth / 2 + sideW / 2, totalHeight / 2, roomDepth / 2); physicsWorld.addBody(fwL2);
  const fwR2 = new CANNON.Body({ mass: 0, material: wallPhysMat });
  fwR2.addShape(new CANNON.Box(new CANNON.Vec3(sideW / 2, totalHeight / 2, wt / 2)));
  fwR2.position.set(roomWidth / 2 - sideW / 2, totalHeight / 2, roomDepth / 2); physicsWorld.addBody(fwR2);
  const aboveDoorH = totalHeight - doorH;
  const fwA2 = new CANNON.Body({ mass: 0, material: wallPhysMat });
  fwA2.addShape(new CANNON.Box(new CANNON.Vec3(doorHalfW, aboveDoorH / 2, wt / 2)));
  fwA2.position.set(0, doorH + aboveDoorH / 2, roomDepth / 2); physicsWorld.addBody(fwA2);
  const lwCol = new CANNON.Body({ mass: 0, material: wallPhysMat });
  lwCol.addShape(new CANNON.Box(new CANNON.Vec3(wt / 2, totalHeight / 2, roomDepth / 2)));
  lwCol.position.set(-roomWidth / 2, totalHeight / 2, 0); physicsWorld.addBody(lwCol);
  const rwCol = new CANNON.Body({ mass: 0, material: wallPhysMat });
  rwCol.addShape(new CANNON.Box(new CANNON.Vec3(wt / 2, totalHeight / 2, roomDepth / 2)));
  rwCol.position.set(roomWidth / 2, totalHeight / 2, 0); physicsWorld.addBody(rwCol);
  const machinePhysBody = new CANNON.Body({ mass: 0, material: wallPhysMat });
  machinePhysBody.addShape(new CANNON.Cylinder(machineRadius, machineRadius, totalHeight, 12));
  machinePhysBody.position.set(0, totalHeight / 2, machineZ); physicsWorld.addBody(machinePhysBody);

  // --- Player ---
  const capsuleX = 8.8;
  const capsuleZ = -11.375;
  const lyingY = 0.6;
  camera.position.set(capsuleX, lyingY + 0.1, capsuleZ);
  camera.rotation.set(-Math.PI / 2, 0, 0);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: capsuleX, y: lyingY, z: capsuleZ } });

  // --- Wake-up sequence ---
  let wakePhase = 'waiting';
  let wakeTime = 0;

  // DOM elements for eye effect (created lazily)
  let eyeOverlay: HTMLDivElement | null = null;
  let eyelidTop: HTMLDivElement | null = null;
  let eyelidBottom: HTMLDivElement | null = null;
  let wakeSkipBtn: HTMLButtonElement | null = null;

  function removeWakeSkipBtn() {
    wakeSkipBtn?.remove();
    wakeSkipBtn = null;
  }

  /** Ends the wake-up sequence immediately, whether reached naturally or via the skip button. */
  function finishWake() {
    eyelidTop?.remove();
    eyelidBottom?.remove();
    eyeOverlay?.remove();
    eyeOverlay = null; eyelidTop = null; eyelidBottom = null;
    removeWakeSkipBtn();
    const spawnX = capsuleX - 1.5;
    const spawnZ = capsuleZ;
    const bodyY = PHYSICS.playerRadius;
    camera.position.set(spawnX, bodyY + 1.3, spawnZ);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, 0, 0);
    player.setRotation(Math.PI / 2, 0);
    player.setPosition(spawnX, bodyY, spawnZ);
    player.enable();
    wakePhase = 'done';
    console.log('Player spawned upright next to capsule');
  }

  if (!skipWake && !entryState) {
    wakeSkipBtn = document.createElement('button');
    wakeSkipBtn.textContent = 'SKIP';
    wakeSkipBtn.className = 'wake-skip-btn';
    wakeSkipBtn.addEventListener('click', finishWake);
    document.body.appendChild(wakeSkipBtn);
  }

  function updateWakeSequence(dt: number) {
    if (skipWake || wakePhase === 'done') return;
    wakeTime += dt;
    switch (wakePhase) {
      case 'waiting':
        if (wakeTime > 2.0) {
          wakePhase = 'eyes'; wakeTime = 0;
          // Create eye overlay elements
          eyeOverlay = document.createElement('div');
          eyeOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:black;z-index:1000;pointer-events:none;opacity:1;';
          document.body.appendChild(eyeOverlay);
          eyelidTop = document.createElement('div');
          eyelidTop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:50%;background:linear-gradient(to bottom,black 60%,transparent 100%);z-index:1001;pointer-events:none;transform:translateY(-100%);';
          document.body.appendChild(eyelidTop);
          eyelidBottom = document.createElement('div');
          eyelidBottom.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;height:50%;background:linear-gradient(to top,black 60%,transparent 100%);z-index:1001;pointer-events:none;transform:translateY(100%);';
          document.body.appendChild(eyelidBottom);
          eyelidTop.style.transition = 'transform 4s ease-out';
          eyelidBottom.style.transition = 'transform 4s ease-out';
          eyelidTop.style.transform = 'translateY(0%)';
          eyelidBottom.style.transform = 'translateY(0%)';
        }
        break;
      case 'eyes': {
        const eyeProgress = Math.min(wakeTime / 4.0, 1.0);
        if (eyeOverlay) eyeOverlay.style.opacity = String(1 - eyeProgress);
        if (wakeTime > 4.5) {
          wakePhase = 'blink'; wakeTime = 0;
          if (eyelidTop) { eyelidTop.style.transition = 'transform 0.2s ease-in'; eyelidTop.style.transform = 'translateY(0%)'; }
          if (eyelidBottom) { eyelidBottom.style.transition = 'transform 0.2s ease-in'; eyelidBottom.style.transform = 'translateY(0%)'; }
        }
        break;
      }
      case 'blink':
        if (wakeTime > 0.3) {
          if (eyelidTop) { eyelidTop.style.transition = 'transform 0.5s ease-out'; eyelidTop.style.transform = 'translateY(-100%)'; }
          if (eyelidBottom) { eyelidBottom.style.transition = 'transform 0.5s ease-out'; eyelidBottom.style.transform = 'translateY(100%)'; }
          wakePhase = 'spawn'; wakeTime = 0;
        }
        break;
      case 'spawn':
        finishWake();
        break;
    }
  }

  if (skipWake || entryState) {
    wakePhase = 'done';
    const spawnX = 0;
    const spawnZ = roomDepth / 2 - 2;
    const bodyY = PHYSICS.playerRadius;
    camera.position.set(spawnX, bodyY + 1.3, spawnZ);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, 0, 0);
    player.setRotation(0, 0);
    player.setPosition(spawnX, bodyY, spawnZ);
    player.enable();
    if (entryState) {
      player.restoreTransition(entryState, { x: 0, y: 0, z: roomDepth / 2 });
      doorOpen = doorTargetOpen = 1;
      doorLeft.position.x = -doorPanelW / 2 - doorSlideDistance;
      doorRight.position.x = doorPanelW / 2 + doorSlideDistance;
      doorSeam.visible = false;
    }
  }

  // --- Door trigger ---
  let onDoorTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let doorTriggerCooldown = false;
  function setDoorTrigger(callback: (state: PlayerTransitionState) => void) { onDoorTrigger = callback; }

  function updatePhysics(dt: number, thirdPerson: boolean = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(dt, player, thirdPerson);
    if (wakePhase !== 'done') {
      updateWakeSequence(dt);
    } else {
      const px = player.body.position.x;
      const pz = player.body.position.z;
      const doorZPos = roomDepth / 2;
      const distToDoor = Math.sqrt(px * px + (pz - doorZPos) * (pz - doorZPos));
      const playerInFront = distToDoor < doorSensorRange && px > -doorW / 2 - 1 && px < doorW / 2 + 1;
      if (playerInFront || hasNearbyActor(physicsWorld, 0, doorZPos, doorSensorRange)) {
        doorTargetOpen = 1;
        sensorLightMat.color.setHex(0x00ff44);
        sensorLightMat.emissive.setHex(0x00ff44);
      } else {
        doorTargetOpen = 0;
        sensorLightMat.color.setHex(0xff0000);
        sensorLightMat.emissive.setHex(0xff0000);
      }
      const slideDelta = doorSlideSpeed * dt;
      if (doorOpen < doorTargetOpen) doorOpen = Math.min(doorOpen + slideDelta, 1);
      else if (doorOpen > doorTargetOpen) doorOpen = Math.max(doorOpen - slideDelta, 0);
      const slideOffset = doorOpen * doorSlideDistance;
      doorLeft.position.x = -doorPanelW / 2 - slideOffset;
      doorRight.position.x = doorPanelW / 2 + slideOffset;
      doorSeam.visible = doorOpen < 0.1;
      if (onDoorTrigger && !doorTriggerCooldown && doorOpen > 0.9) {
        if (pz > roomDepth / 2 + 0.5 && px > -doorW / 2 && px < doorW / 2) {
          doorTriggerCooldown = true;
          onDoorTrigger(player.captureTransition({ x: 0, y: 0, z: roomDepth / 2 }));
        }
      }
    }
    // Animate stars
    const positions = stars.geometry.attributes.position.array as Float32Array;
    const speed = 15;
    const windowZ = -roomDepth / 2;
    for (let i = 0; i < starCount; i++) {
      positions[i * 3 + 2] += speed * dt;
      if (positions[i * 3 + 2] > windowZ - 5) positions[i * 3 + 2] = windowZ - 200;
    }
    stars.geometry.attributes.position.needsUpdate = true;
    // Pulse screens
    const pulseTime = performance.now() * 0.001;
    for (const sf of pulsingScreens) {
      const pulse = 0.5 + 0.5 * Math.sin(pulseTime * 2 + sf.phase);
      sf.material.emissiveIntensity = 0.3 + pulse * 0.5;
      sf.light.intensity = 1.0 + pulse * 1.5;
    }
  }

  return {
    scene, camera, physicsWorld, updatePhysics,
    cutsceneManager: null,
    player,
    npcSafeZone: new THREE.Box3(
      new THREE.Vector3(-winW / 2, floor2Y - 0.15, -roomDepth / 2),
      new THREE.Vector3(winW / 2, floor2Y + 2, -roomDepth / 2 + 2),
    ),
    setDoorTrigger,
    dispose: () => {
      player.dispose();
      physics.dispose();
      eyeOverlay?.remove();
      eyelidTop?.remove();
      eyelidBottom?.remove();
      removeWakeSkipBtn();
    },
  };
}
