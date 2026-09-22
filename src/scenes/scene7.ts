/** Scene 7 - Cafeteria / Galley */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import comicVert from '../shaders/comic.vert.glsl?raw';
import comicFrag from '../shaders/comic.frag.glsl?raw';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { LADDER } from '../utils/constants.js';
import { createBreakables } from '../scripts/breakables.js';

export function createScene({ entryState, clearedCrates = new Set<string>(), onCrateBroken }: {
  entryState?: PlayerTransitionState; clearedCrates?: ReadonlySet<string>; onCrateBroken?: (id: string) => void;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b10);

  const roomWidth = 14, roomDepth = 12, roomHeight = 4.5;
  const doorW = 3, doorH = 3.5, wallThickness = 0.15;
  const physics = createScenePhysics();
  const physicsWorld = physics.world;

  // --- Tiled floor texture ---
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 256; tileCanvas.height = 256;
  const tc = tileCanvas.getContext('2d')!;
  tc.fillStyle = '#858b91'; tc.fillRect(0, 0, 256, 256);
  tc.strokeStyle = '#555d64'; tc.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    tc.beginPath(); tc.moveTo(i, 0); tc.lineTo(i, 256); tc.stroke();
    tc.beginPath(); tc.moveTo(0, i); tc.lineTo(256, i); tc.stroke();
  }
  for (let i = 0; i < 55; i++) {
    tc.fillStyle = `rgba(30, 30, 35, ${0.04 + Math.random() * 0.12})`;
    tc.beginPath();
    tc.ellipse(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 12, 2 + Math.random() * 8, Math.random() * Math.PI, 0, Math.PI * 2);
    tc.fill();
  }
  const tileTexture = new THREE.CanvasTexture(tileCanvas);
  tileTexture.wrapS = THREE.RepeatWrapping; tileTexture.wrapT = THREE.RepeatWrapping; tileTexture.repeat.set(7, 6);

  // --- Materials Factory ---
  const makeMaterial = {
    floor: () => new THREE.MeshStandardMaterial({ map: tileTexture, color: 0x90969b, roughness: 0.68, metalness: 0.12 }),
    wall: () => { const m = new THREE.MeshStandardMaterial({ map: tileTexture.clone(), color: 0x626a72, roughness: 0.78, metalness: 0.08 }); m.map!.repeat.set(7, 2.25); return m; },
    ceiling: () => new THREE.MeshStandardMaterial({ color: 0x353d46, roughness: 0.85, metalness: 0.1 }),
    steel: () => new THREE.MeshStandardMaterial({ color: 0x89929b, metalness: 0.78, roughness: 0.28 }),
    appliance: () => new THREE.MeshStandardMaterial({ color: 0x59626c, metalness: 0.55, roughness: 0.42 }),
    dark: () => new THREE.MeshStandardMaterial({ color: 0x20262d, metalness: 0.32, roughness: 0.58 }),
    wood: () => new THREE.MeshStandardMaterial({ color: 0x75604e, roughness: 0.66, metalness: 0.12 }),
    bench: () => new THREE.MeshStandardMaterial({ color: 0x4f5962, metalness: 0.45, roughness: 0.5 }),
    crate: () => new THREE.MeshStandardMaterial({ color: 0x6d5a43, roughness: 0.88 }),
    door: () => new THREE.MeshStandardMaterial({ color: 0x687783, metalness: 0.6, roughness: 0.38 }),
    doorSeam: () => new THREE.MeshStandardMaterial({ color: 0x1c252d, emissive: 0x101820, metalness: 0.8, roughness: 0.28 }),
    frame: () => new THREE.MeshStandardMaterial({ color: 0x4f5963, metalness: 0.6, roughness: 0.38 }),
    comic: (color: number) => new THREE.ShaderMaterial({
      vertexShader: comicVert, fragmentShader: comicFrag,
      uniforms: { uColor: { value: new THREE.Color(color) }, uLightDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() }, uTime: { value: 0 } },
    }),
  };

  // --- Physics/Mesh Factory ---
  function addBox(size: THREE.Vector3, pos: THREE.Vector3, mat: THREE.Material, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(pos); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    if (solid) physics.addBox({ x: size.x, y: size.y, z: size.z }, { x: pos.x, y: pos.y, z: pos.z });
    return mesh;
  }
  function addPhysicsBody(pos: THREE.Vector3, halfExtents: THREE.Vector3) {
    const body = new CANNON.Body({ mass: 0, material: physics.solidMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)));
    body.position.set(pos.x, pos.y, pos.z); physicsWorld.addBody(body);
  }

  // --- Room Shell ---
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, 0.1, roomDepth), makeMaterial.floor());
  floorMesh.position.set(0, -0.05, 0); floorMesh.receiveShadow = true; scene.add(floorMesh);
  physics.addBox({ x: roomWidth, y: 0.4, z: roomDepth }, { x: 0, y: -0.2, z: 0 });
  // Pad past the back door so the player never leaves solid ground mid-transition to scene 4
  physics.addBox({ x: doorW + 2, y: 0.4, z: 6 }, { x: 0, y: -0.2, z: roomDepth / 2 + 3 });
  const ladderX = 4.6, ladderZ = -3.6, hatchSize = 1.5;
  const leftCeilingWidth = ladderX - hatchSize / 2 + roomWidth / 2;
  const rightCeilingWidth = roomWidth / 2 - ladderX - hatchSize / 2;
  const frontCeilingDepth = ladderZ - hatchSize / 2 + roomDepth / 2;
  const backCeilingDepth = roomDepth / 2 - ladderZ - hatchSize / 2;
  addBox(new THREE.Vector3(leftCeilingWidth, 0.18, roomDepth), new THREE.Vector3(-roomWidth / 2 + leftCeilingWidth / 2, roomHeight, 0), makeMaterial.ceiling());
  addBox(new THREE.Vector3(rightCeilingWidth, 0.18, roomDepth), new THREE.Vector3(roomWidth / 2 - rightCeilingWidth / 2, roomHeight, 0), makeMaterial.ceiling());
  addBox(new THREE.Vector3(hatchSize, 0.18, frontCeilingDepth), new THREE.Vector3(ladderX, roomHeight, -roomDepth / 2 + frontCeilingDepth / 2), makeMaterial.ceiling());
  addBox(new THREE.Vector3(hatchSize, 0.18, backCeilingDepth), new THREE.Vector3(ladderX, roomHeight, roomDepth / 2 - backCeilingDepth / 2), makeMaterial.ceiling());
  for (const x of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, roomHeight - 0.25, 8), makeMaterial.steel());
    rail.position.set(ladderX + x, (roomHeight - 0.25) / 2, ladderZ); scene.add(rail);
  }
  for (let y = 0.45; y < roomHeight - 0.2; y += 0.38) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), makeMaterial.steel());
    rung.rotation.z = Math.PI / 2; rung.position.set(ladderX, y, ladderZ); scene.add(rung);
  }
  
  const sideWidth = (roomWidth - doorW) / 2;
  addBox(new THREE.Vector3(roomWidth, roomHeight, wallThickness), new THREE.Vector3(0, roomHeight / 2, -roomDepth / 2), makeMaterial.wall());
  addBox(new THREE.Vector3(roomDepth, roomHeight, wallThickness), new THREE.Vector3(-roomWidth / 2, roomHeight / 2, 0), makeMaterial.wall()).rotation.y = Math.PI / 2;
  addBox(new THREE.Vector3(roomDepth, roomHeight, wallThickness), new THREE.Vector3(roomWidth / 2, roomHeight / 2, 0), makeMaterial.wall()).rotation.y = -Math.PI / 2;
  addBox(new THREE.Vector3(sideWidth, roomHeight, wallThickness), new THREE.Vector3(-roomWidth / 2 + sideWidth / 2, roomHeight / 2, roomDepth / 2), makeMaterial.wall());
  addBox(new THREE.Vector3(sideWidth, roomHeight, wallThickness), new THREE.Vector3(roomWidth / 2 - sideWidth / 2, roomHeight / 2, roomDepth / 2), makeMaterial.wall());
  addBox(new THREE.Vector3(doorW, roomHeight - doorH, wallThickness), new THREE.Vector3(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2), makeMaterial.wall());
  addPhysicsBody(new THREE.Vector3(0, roomHeight / 2, -roomDepth / 2), new THREE.Vector3(roomWidth / 2, roomHeight / 2, wallThickness / 2));
  addPhysicsBody(new THREE.Vector3(-roomWidth / 2, roomHeight / 2, 0), new THREE.Vector3(wallThickness / 2, roomHeight / 2, roomDepth / 2));
  addPhysicsBody(new THREE.Vector3(roomWidth / 2, roomHeight / 2, 0), new THREE.Vector3(wallThickness / 2, roomHeight / 2, roomDepth / 2));
  addPhysicsBody(new THREE.Vector3(-roomWidth / 2 + sideWidth / 2, roomHeight / 2, roomDepth / 2), new THREE.Vector3(sideWidth / 2, roomHeight / 2, wallThickness / 2));
  addPhysicsBody(new THREE.Vector3(roomWidth / 2 - sideWidth / 2, roomHeight / 2, roomDepth / 2), new THREE.Vector3(sideWidth / 2, roomHeight / 2, wallThickness / 2));
  addPhysicsBody(new THREE.Vector3(0, doorH + (roomHeight - doorH) / 2, roomDepth / 2), new THREE.Vector3(doorW / 2, (roomHeight - doorH) / 2, wallThickness / 2));

  // --- Back Door (entry from scene 4) ---
  for (const x of [-doorW / 2 - 0.07, doorW / 2 + 0.07]) addBox(new THREE.Vector3(0.14, doorH, 0.22), new THREE.Vector3(x, doorH / 2, roomDepth / 2), makeMaterial.frame());
  addBox(new THREE.Vector3(doorW + 0.28, 0.14, 0.22), new THREE.Vector3(0, doorH + 0.07, roomDepth / 2), makeMaterial.frame());
  const panelW = doorW / 2 + 0.1, doorZ = roomDepth / 2 + 0.15, slideD = panelW + 0.3;
  const doorL = addBox(new THREE.Vector3(panelW, doorH, 0.08), new THREE.Vector3(-panelW / 2, doorH / 2, doorZ), makeMaterial.door());
  const doorR = addBox(new THREE.Vector3(panelW, doorH, 0.08), new THREE.Vector3(panelW / 2, doorH / 2, doorZ), makeMaterial.door());
  const doorSeam = addBox(new THREE.Vector3(0.025, doorH, 0.1), new THREE.Vector3(0, doorH / 2, doorZ), makeMaterial.doorSeam());
  const doorLightMat = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 1.8 });
  const doorLight = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), doorLightMat);
  doorLight.position.set(0, doorH + 0.22, roomDepth / 2 + 0.03); scene.add(doorLight);
  let doorOpen = entryState ? 1 : 0, doorTarget = doorOpen;

  // --- Status and live camera screens ---
  const leftWallX = -roomWidth / 2 + 0.13;
  const screenCanv = document.createElement('canvas'); screenCanv.width = 768; screenCanv.height = 384;
  const scx = screenCanv.getContext('2d')!;
  scx.fillStyle = '#071115'; scx.fillRect(0, 0, 768, 384);
  scx.strokeStyle = '#2a8990'; scx.lineWidth = 8; scx.strokeRect(18, 18, 732, 348);
  scx.fillStyle = '#74e4c4'; scx.font = 'bold 34px monospace'; scx.fillText('GALLEY STATUS', 48, 72);
  scx.font = '22px monospace'; scx.fillText('MEAL SERVICE // DECK 01', 48, 116);
  scx.fillStyle = '#d3a85e'; scx.fillRect(48, 162, 300, 12);
  scx.fillStyle = '#74e4c4'; scx.fillText('SYNTH STEW', 48, 220); scx.fillText('PROTEIN LOAF', 48, 264); scx.fillText('WATER RATION', 48, 308);
  const screenTex = new THREE.CanvasTexture(screenCanv); screenTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.5, roughness: 0.4 });
  addBox(new THREE.Vector3(0.18, 2.55, 4.9), new THREE.Vector3(-roomWidth / 2 + 0.02, 2.35, -2.55), makeMaterial.dark());
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.25), screenMat);
  screen.rotation.y = Math.PI / 2;
  screen.position.set(leftWallX, 2.35, -2.55); scene.add(screen);
  const screenGlow = new THREE.PointLight(0x37cfc0, 1.4, 8); screenGlow.position.set(leftWallX + 1, 2.35, -2.55); scene.add(screenGlow);

  // --- Kitchen Line ---
  addBox(new THREE.Vector3(1.65, 2.35, 0.85), new THREE.Vector3(-5.45, 1.18, -5.4), makeMaterial.appliance(), true);
  addBox(new THREE.Vector3(1.3, 2, 0.85), new THREE.Vector3(-3.5, 1, -5.4), makeMaterial.dark(), true);
  addBox(new THREE.Vector3(2.25, 0.85, 0.85), new THREE.Vector3(-1.2, 0.43, -5.4), makeMaterial.steel(), true);
  addBox(new THREE.Vector3(2.7, 0.85, 0.85), new THREE.Vector3(2.0, 0.43, -5.4), makeMaterial.appliance(), true);
  addBox(new THREE.Vector3(1.8, 2.2, 0.55), new THREE.Vector3(5.35, 1.1, -5.55), makeMaterial.appliance(), true);
  addBox(new THREE.Vector3(0.8, 0.48, 0.05), new THREE.Vector3(-3.5, 1.3, -4.94), new THREE.MeshStandardMaterial({ color: 0x241a17, emissive: 0x6d351e, emissiveIntensity: 0.7 }));
  for (const x of [-1.8, -0.6]) addBox(new THREE.Vector3(0.35, 0.04, 0.35), new THREE.Vector3(x, 0.88, -5.0), makeMaterial.dark());
  addBox(new THREE.Vector3(2.3, 0.45, 0.9), new THREE.Vector3(-0.9, 2.7, -5.4), makeMaterial.appliance());
  addBox(new THREE.Vector3(0.8, 0.1, 0.6), new THREE.Vector3(1.45, 0.88, -5.0), makeMaterial.dark());
  addBox(new THREE.Vector3(0.05, 0.45, 0.05), new THREE.Vector3(1.45, 1.12, -5.25), makeMaterial.steel());

  // --- Serving Island ---
  addBox(new THREE.Vector3(6.2, 0.9, 1.2), new THREE.Vector3(-0.35, 0.45, -1.25), makeMaterial.dark(), true);
  addBox(new THREE.Vector3(6.35, 0.08, 1.25), new THREE.Vector3(-0.35, 0.94, -1.25), makeMaterial.steel());
  addBox(new THREE.Vector3(6.2, 0.52, 0.04), new THREE.Vector3(-0.35, 1.35, -1.83), new THREE.MeshStandardMaterial({ color: 0xbcd2dd, transparent: true, opacity: 0.28, roughness: 0.1 }), true);
  const beverageMat = new THREE.MeshStandardMaterial({ color: 0x092e35, emissive: 0x30d4ad, emissiveIntensity: 1.4 });
  addBox(new THREE.Vector3(0.55, 0.75, 0.55), new THREE.Vector3(2.25, 1.32, -1.25), makeMaterial.dark(), true);
  const beverageScreen = addBox(new THREE.Vector3(0.42, 0.42, 0.025), new THREE.Vector3(2.25, 1.5, -0.96), beverageMat);

  // --- Dining Tables ---
  for (const [x, z] of [[-2.8, 1.7], [2.7, 1.7], [-2.8, 4.0], [2.7, 4.0]] as Array<[number, number]>) {
    addBox(new THREE.Vector3(1.8, 0.1, 0.95), new THREE.Vector3(x, 0.75, z), makeMaterial.wood(), true);
    addBox(new THREE.Vector3(0.14, 0.7, 0.14), new THREE.Vector3(x, 0.35, z), makeMaterial.steel(), true);
    for (const side of [-1, 1]) {
      const bz = z + side * 0.82;
      addBox(new THREE.Vector3(1.8, 0.1, 0.34), new THREE.Vector3(x, 0.42, bz), makeMaterial.bench(), true);
      addBox(new THREE.Vector3(0.1, 0.42, 0.25), new THREE.Vector3(x - 0.7, 0.21, bz), makeMaterial.steel(), true);
      addBox(new THREE.Vector3(0.1, 0.42, 0.25), new THREE.Vector3(x + 0.7, 0.21, bz), makeMaterial.steel(), true);
    }
  }

  // --- Storage & Equipment ---
  for (const p of [new THREE.Vector3(5.2, 0.35, 3.7), new THREE.Vector3(6.1, 0.35, 4.45), new THREE.Vector3(5.2, 1.05, 3.7)])
    addBox(new THREE.Vector3(0.72, 0.7, 0.72), p, makeMaterial.crate(), true);
  addBox(new THREE.Vector3(0.3, 0.55, 0.65), new THREE.Vector3(-6.78, 1.0, -3.1), makeMaterial.dark(), true);
  const extinguisher = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.62, 10), new THREE.MeshStandardMaterial({ color: 0xa8322a, metalness: 0.45, roughness: 0.48 }));
  extinguisher.position.set(-4.8, 0.7, 5.65); extinguisher.castShadow = true; scene.add(extinguisher);
  for (const [y, z] of [[3.85, -5.55], [3.68, -5.35]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 9, 8), makeMaterial.comic(0x4a5660));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(-1.2, y, z); pipe.castShadow = true; scene.add(pipe);
  }

  // --- Lighting Fixtures ---
  const fixtures = [[-3.6, -3.8, 0xffd0a0], [1.2, -3.8, 0xffd0a0], [-3.8, 1.8, 0x8ca8c4], [2.8, 1.8, 0x8ca8c4], [0, 4.4, 0x8ca8c4]] as const;
  for (const [x, z, color] of fixtures) {
    const light = new THREE.PointLight(color, 5.5, 15); light.position.set(x, roomHeight - 0.4, z); light.castShadow = true; light.shadow.mapSize.set(256, 256); scene.add(light);
    addBox(new THREE.Vector3(1.15, 0.06, 0.16), new THREE.Vector3(x, roomHeight - 0.05, z), new THREE.MeshStandardMaterial({ color: 0xd9dde0, emissive: color, emissiveIntensity: 1.7 }));
  }
  scene.add(new THREE.AmbientLight(0x657585, 2.2));

  // --- Camera & Player ---
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: roomDepth / 2 - 2 } });
  player.setRotation(Math.PI, 0); player.enable();
  if (entryState) {
    player.restoreTransition(entryState, { x: 0, y: 0, z: roomDepth / 2 });
    doorL.position.x = -panelW / 2 - slideD; doorR.position.x = panelW / 2 + slideD; doorSeam.visible = false;
  }

  const breakables = createBreakables(scene, physicsWorld);
  for (const [i, offset] of [[-0.6, 0.6], [0.6, 0.6], [-0.6, 1.8], [0.6, 1.8]].entries()) {
    const id = `LadderCrate${i}`;
    if (!clearedCrates.has(id)) breakables.add(id, 'crowbar',
      new THREE.Vector3(ladderX + offset[0], offset[1], ladderZ + 0.5), new THREE.Vector3(1.15, 1.2, 1.25), onCrateBroken);
  }

  // --- Scene Logic ---
  let onBackTrigger: ((state: PlayerTransitionState) => void) | null = null;
  let onLadderTrigger: (() => void) | null = null;
  let doorCooldown = false;
  let climbing = false;
  let handoffStarted = false;
  let climbTime = 0;
  const climbStart = new THREE.Vector3();
  const prompt = document.getElementById?.('interact-prompt');
  let promptVisible = false;
  const ladderInteractRange = 1.15;
  prompt?.classList.add('hidden');
  
  function setBackTrigger(callback: (state: PlayerTransitionState) => void) { onBackTrigger = callback; }
  function setLadderTrigger(callback: () => void) { onLadderTrigger = callback; }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || climbing || !onLadderTrigger || breakables.remaining() > 0) return;
    const dx = player.body.position.x - ladderX;
    const dz = player.body.position.z - (ladderZ + 0.65);
    if (Math.hypot(dx, dz) > ladderInteractRange) return;
    if (!player.isEnabled()) return;
    climbing = true; handoffStarted = false; climbTime = 0;
    climbStart.copy(player.body.position);
    player.setRotation(0, 0); player.setLookLocked(true); player.setClimbing(true);
    prompt?.classList.add('hidden'); promptVisible = false;
  }
  window.addEventListener('keydown', onKeyDown);

  function updatePhysics(dt: number, thirdPerson = false) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    physics.step(dt, player, thirdPerson);
    breakables.update(dt);
    const px = player.body.position.x, pz = player.body.position.z;
    if (climbing) {
      climbTime += dt;
      const mount = THREE.MathUtils.smoothstep(climbTime, 0, LADDER.mountDuration);
      const top = roomHeight + PHYSICS.playerRadius;
      const y = Math.min(top, climbStart.y + Math.max(0, climbTime - LADDER.mountDuration) * LADDER.climbSpeed);
      player.body.position.set(THREE.MathUtils.lerp(climbStart.x, ladderX, mount), y,
        THREE.MathUtils.lerp(climbStart.z, ladderZ + LADDER.bodyOffset, mount));
      player.body.aabbNeedsUpdate = true;
      player.updateCamera(0, thirdPerson);
      if (y >= top && !handoffStarted) { handoffStarted = true; onLadderTrigger?.(); }
      return;
    }
    const nearLadder = player.isEnabled() && breakables.remaining() === 0 && Math.hypot(px - ladderX, pz - (ladderZ + 0.65)) <= ladderInteractRange;
    if (prompt && nearLadder !== promptVisible) {
      promptVisible = nearLadder;
      prompt.textContent = 'Press E to climb';
      prompt.classList.toggle('hidden', !nearLadder);
    }

    const inDoorZone = Math.abs(px) < doorW / 2 + 1;
    const nearDoor = Math.hypot(px, pz - doorZ) < 3.5 && inDoorZone;
    doorTarget = nearDoor ? 1 : 0;
    
    const slideDelta = 1.5 * dt;
    doorOpen = doorOpen < doorTarget ? Math.min(doorOpen + slideDelta, 1) : Math.max(doorOpen - slideDelta, 0);
    const offset = doorOpen * slideD;
    doorL.position.x = -panelW / 2 - offset; doorR.position.x = panelW / 2 + offset; doorSeam.visible = doorOpen < 0.1;
    doorLightMat.color.setHex(nearDoor ? 0x00ff44 : 0xff3030); doorLightMat.emissive.setHex(nearDoor ? 0x00ff44 : 0xff2020);
    
    beverageMat.emissiveIntensity = 1.1 + Math.sin(performance.now() * 0.002) * 0.2;
    
    if (onBackTrigger && !doorCooldown && doorOpen > 0.9 && pz > roomDepth / 2 + 0.8 && inDoorZone) {
      doorCooldown = true;
      onBackTrigger(player.captureTransition({ x: 0, y: 0, z: roomDepth / 2 }));
    }
  }

  return { roomId: 'cafeteria', scene, camera, physicsWorld, updatePhysics, cutsceneManager: null, player, setBackTrigger, setLadderTrigger,
    breakables, getDamageTargets: breakables.getDamageTargets, setGogglesActive: breakables.setHighlighted,
    dispose: () => { breakables.dispose(); window.removeEventListener('keydown', onKeyDown); prompt?.classList.add('hidden'); player.dispose(); physics.dispose(); screenTex.dispose(); tileTexture.dispose(); } };
}
