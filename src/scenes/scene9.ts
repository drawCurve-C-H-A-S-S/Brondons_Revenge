/** Scene 9 - Zero-gravity loading bay reached from the maintenance vent. */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { LADDER } from '../utils/constants.js';
import { createSlidingPortal } from '../helpers/scene/shipRoom.js';

export function createScene({ gravityRestored = false, onGravityChanged, entryState, fromPassage = false }: {
  gravityRestored?: boolean; onGravityChanged?: (active: boolean) => void;
  entryState?: PlayerTransitionState; fromPassage?: boolean;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020610);
  const physics = createScenePhysics();
  const physicsWorld = physics.world;
  physicsWorld.gravity.set(0, gravityRestored ? PHYSICS.gravity : 0, 0);
  physicsWorld.allowSleep = true;
  const steel = new THREE.MeshStandardMaterial({ color: 0x344653, metalness: 0.65, roughness: 0.48 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x131e29, metalness: 0.6, roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x82959e, metalness: 0.8, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe3a83b, roughness: 0.6 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x74ddff, emissive: 0x32b9ef, emissiveIntensity: 2 });
  const statusMaterial = new THREE.MeshStandardMaterial({ color: 0xffba45, emissive: 0xff8a20, emissiveIntensity: 2 });
  function box(size: [number, number, number], position: [number, number, number], material: THREE.Material = steel, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position); mesh.receiveShadow = true; mesh.castShadow = true; scene.add(mesh);
    if (solid) physics.addBox({ x: size[0], y: size[1], z: size[2] }, mesh.position);
    return mesh;
  }
  const textures: THREE.Texture[] = [];
  function sign(text: string, width: number, height: number, position: [number, number, number], yaw = 0, color = '#a9e9ff') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a1520'; ctx.fillRect(0, 0, 1024, 128);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 1016, 120);
    ctx.fillStyle = color; ctx.font = 'bold 58px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 65, 990);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh.position.set(...position); mesh.rotation.y = yaw; scene.add(mesh);
    return mesh;
  }

  // A tall industrial shell with loading lanes and structural ribs.
  box([24, 0.4, 26], [0, -0.2, 0], dark);
  box([24, 0.4, 26], [0, 9.2, 0], dark);
  const passageDoor = createSlidingPortal(scene, physics, { x: 0, y: 0, z: -13, yaw: 0 }, 24, 9, '12 / TRANSFER PASSAGE');
  box([0.4, 9, 26], [-12, 4.5, 0]); box([0.4, 9, 26], [12, 4.5, 0]);
  box([24, 1.1, 0.6], [0, 8.45, 13]);
  for (const x of [-11, -5.6, 5.6, 11]) box([0.09, 0.015, 23], [x, 0.012, 0], yellow, false);
  for (let z = -11; z <= 11; z += 2) {
    box([0.04, 0.016, 1], [0, 0.013, z], trim, false);
    for (const x of [-8.4, 8.4]) box([4.5, 0.016, 0.035], [x, 0.013, z], trim, false);
  }
  for (const z of [-11, -5, 1, 7, 12]) {
    for (const x of [-11.6, 11.6]) {
      box([0.35, 9, 0.45], [x, 4.5, z], dark);
      box([0.12, 3.7, 0.08], [x * 0.995, 5.2, z - 0.25], cyan, false);
    }
    box([23, 0.35, 0.45], [0, 8.75, z], trim, false);
  }
  for (const x of [-5.5, 5.5]) {
    box([0.3, 0.45, 23], [x, 8.4, 0], yellow, false);
    box([0.14, 0.05, 22], [x, 8.14, 0], cyan, false);
  }
  // The huge blast doors are parked open, behind an active pressure field.
  for (const side of [-1, 1]) {
    const door = box([5.1, 7.8, 0.85], [side * 9.5, 3.9, 12.7], dark);
    door.name = side < 0 ? 'LoadingDoorLeft' : 'LoadingDoorRight';
    for (let y = 0.6; y < 7.7; y += 1.15) box([4.7, 0.85, 0.12], [side * 9.5, y, 12.22], steel, false);
    box([0.18, 7.6, 0.2], [side * 6.9, 3.9, 12.15], yellow, false);
    box([0.06, 7.5, 0.15], [side * 6.65, 3.9, 12.05], cyan, false);
  }
  const fieldMaterial = new THREE.MeshBasicMaterial({ color: 0x388bca, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 7.8), fieldMaterial);
  field.position.set(0, 3.9, 12.9); field.name = 'PressureContainmentField'; scene.add(field);
  physics.addBox({ x: 24, y: 9, z: 0.25 }, { x: 0, y: 4.5, z: 13.1 });
  for (let y = 0.3; y < 7.8; y += 0.45) box([13.3, 0.008, 0.01], [0, y, 12.92], fieldMaterial, false);
  sign('09 / ORBITAL LOADING BAY', 10, 0.7, [0, 8.45, 12.64], Math.PI);
  sign('PRESSURE FIELD ACTIVE', 6, 0.38, [0, 7.65, 12.5], Math.PI);

  // Space is actual geometry beyond the opening, not a flat painted wall.
  const stars = new Float32Array(1200);
  for (let i = 0; i < stars.length; i += 3) {
    stars[i] = Math.sin(i * 12.9898) * 135;
    stars[i + 1] = Math.cos(i * 4.1414) * 85;
    stars[i + 2] = 45 + (i % 153);
  }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xc7e9ff, size: 0.24, sizeAttenuation: true })));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(22, 48, 32), new THREE.MeshStandardMaterial({ color: 0x375e96, roughness: 1 }));
  planet.position.set(-26, 4, 105); scene.add(planet);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(22.45, 48, 32), new THREE.MeshBasicMaterial({ color: 0x62baff, transparent: true, opacity: 0.16, side: THREE.BackSide }));
  atmosphere.position.copy(planet.position); scene.add(atmosphere);
  const sun = new THREE.DirectionalLight(0xb7d6ff, 2.5); sun.position.set(-25, 30, 25); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xa5d4f4, 0x29343c, 2.2));
  for (const z of [-7, 3, 10]) {
    const light = new THREE.PointLight(0xa7d9ff, 45, 22, 1.5); light.position.set(0, 7.6, z); scene.add(light);
  }

  // Keep the vent route clear. Its short ladder connects to an overhead service duct.
  const ladderZ = -6.5;
  for (const x of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 4.5, 8), trim);
    rail.position.set(x, 2.25, ladderZ); scene.add(rail);
  }
  for (let y = 0.35; y < 4.5; y += LADDER.rungSpacing) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), trim);
    rung.rotation.z = Math.PI / 2; rung.position.set(0, y, ladderZ); scene.add(rung);
  }
  box([2.1, 4.3, 0.18], [0, 6.85, -7.35], dark);
  for (const x of [-0.96, 0.96]) box([0.18, 4.3, 1.9], [x, 6.85, ladderZ], dark);
  for (const x of [-0.8, 0.8]) box([0.12, 0.18, 1.6], [x, 4.6, ladderZ], yellow, false);
  box([1.6, 0.18, 0.12], [0, 4.6, ladderZ + 0.8], yellow, false);
  sign('VENT ACCESS', 2, 0.3, [0, 5.1, ladderZ + 0.97]);
  sign('GRAVITY CONTROL  >>>', 5, 0.45, [3.8, 2, -12.75], 0, '#ffcd64');

  // All loose freight uses real dynamic bodies: drifting now, falling and settling at 1G.
  const cargoMaterial = new CANNON.Material({ friction: 0.6, restitution: 0.05 });
  physicsWorld.addContactMaterial(new CANNON.ContactMaterial(cargoMaterial, physics.solidMaterial, { friction: 0.65, restitution: 0.05 }));
  const cargo: Array<{ mesh: THREE.Group; body: CANNON.Body }> = [];
  const cargoColors = [0xb2753c, 0x517788, 0x737c66, 0xa89065];
  const locations = [[-6, 2.6, -3], [4, 4.7, -2], [-3, 5.8, 3], [2.2, 2.2, 5], [-7, 4.1, 7], [6, 5.6, 8], [-1.5, 6.5, 9], [6.6, 1.8, 1], [-4, 1.6, 9], [3, 6.8, 2]];
  locations.forEach(([x, y, z], i) => {
    const size = i % 3 === 0 ? 1.65 : i % 3 === 1 ? 1.2 : 0.85;
    const group = new THREE.Group(); group.name = `FloatingCargo${i}`;
    const material = new THREE.MeshStandardMaterial({ color: cargoColors[i % cargoColors.length], metalness: 0.35, roughness: 0.68 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material); crate.castShadow = true; crate.receiveShadow = true; group.add(crate);
    for (const offset of [-0.33, 0.33]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(size + 0.025, 0.09, size + 0.025), dark);
      band.position.y = offset * size; group.add(band);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.08, size + 0.03, size + 0.03), trim);
      strap.position.x = offset * size; group.add(strap);
    }
    const tag = new THREE.Mesh(new THREE.BoxGeometry(size * 0.38, size * 0.22, 0.02), yellow); tag.position.z = size / 2 + 0.025; group.add(tag);
    const body = new CANNON.Body({ mass: 24 + size * 12, material: cargoMaterial, shape: new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)), allowSleep: gravityRestored, sleepSpeedLimit: 0.12, sleepTimeLimit: 1 });
    body.position.set(x, gravityRestored ? size / 2 + 0.02 : y, z);
    body.linearDamping = gravityRestored ? 0.25 : 0; body.angularDamping = gravityRestored ? 0.5 : 0;
    if (!gravityRestored) {
      body.quaternion.setFromEuler(i * 0.21, i * 0.53, i * 0.15);
      body.velocity.set(Math.sin(i * 2) * 0.15, Math.cos(i * 1.7) * 0.12, Math.cos(i) * 0.16);
      body.angularVelocity.set(0.04 + i * 0.006, 0.065 * Math.sin(i + 1), 0.045);
    }
    group.position.copy(body.position); group.quaternion.copy(body.quaternion); scene.add(group); physicsWorld.addBody(body);
    cargo.push({ mesh: group, body });
  });

  // Operable both while floating and after landing on the deck.
  const switchPosition = new THREE.Vector3(11.25, 1.4, 5);
  box([0.45, 1.8, 1.5], [11.55, 1.4, 5], dark);
  box([0.08, 1.45, 1.2], [11.28, 1.4, 5], trim, false);
  const switchLight = box([0.1, 0.28, 0.8], [11.2, 1.9, 5], statusMaterial, false);
  switchLight.name = 'GravitySwitch';
  const lever = box([0.4, 0.12, 0.16], [11.04, 1.22, 5], yellow, false);
  const restoreSign = sign('ENABLE GRAVITY / E', 3.4, 0.4, [11.13, 2.65, 5], -Math.PI / 2, '#ffcd64');
  const restoredSign = sign('DISABLE GRAVITY / E', 3.4, 0.4, [11.12, 2.65, 5], -Math.PI / 2, '#7effb7');
  const beacon = new THREE.PointLight(0xffa32b, 12, 8); beacon.position.set(10.6, 1.9, 5); scene.add(beacon);
  function showGravityState() {
    restoreSign.visible = !gravityRestored; restoredSign.visible = gravityRestored;
    statusMaterial.color.setHex(gravityRestored ? 0x6fffb0 : 0xffba45);
    statusMaterial.emissive.setHex(gravityRestored ? 0x20d880 : 0xff8a20);
    beacon.color.setHex(gravityRestored ? 0x6fffb0 : 0xffa32b);
  }
  showGravityState();

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
  let entryTime = fromPassage ? 0 : 1.35;
  const entryY = gravityRestored ? PHYSICS.playerRadius : 1.25;
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: entryY + entryTime * LADDER.climbSpeed, z: ladderZ + LADDER.bodyOffset } });
  player.setRotation(0, 0); player.enable();
  if (fromPassage && entryState) {
    player.restoreTransition(entryState, passageDoor.frame); passageDoor.openImmediately();
    if (!gravityRestored) player.setZeroGravity(true);
  } else {
    if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: entryY + entryTime * LADDER.climbSpeed, z: ladderZ + LADDER.bodyOffset }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0 }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
    player.setLookLocked(true); player.setClimbing(true, -1);
  }
  let onReturnToEight: (() => void) | null = null;
  let returning = false, handoffStarted = false, disposed = false;
  let returnTime = 0, elapsed = 0;
  const climbStart = new THREE.Vector3();
  const prompt = document.getElementById('interact-prompt');
  const status = document.getElementById('loading-bay-status');
  prompt?.classList.add('hidden');
  function canInteract() { return player.isEnabled() && entryTime <= 0 && !returning; }
  function canClimb() {
    const p = player.body.position;
    return canInteract() && !!onReturnToEight && p.y <= 1.6 && Math.hypot(p.x, p.z - (ladderZ + 0.72)) <= 1.2;
  }
  function canToggleGravity() {
    const p = player.body.position;
    return canInteract() && Math.hypot(p.x - switchPosition.x, p.y + 0.9 - switchPosition.y, p.z - switchPosition.z) <= 1.8;
  }
  function updateHud() {
    if (status) {
      status.classList.toggle('hidden', !player.isEnabled());
      status.classList.toggle('restored', gravityRestored);
      const message = gravityRestored
        ? 'LOADING BAY 09 / GRAVITY ON\nWASD: walk | Space: jump | C: crouch\nPress E at the green switch to enable zero gravity'
        : 'LOADING BAY 09 / ZERO GRAVITY\nWASD: drift | Space: rise | C: descend | Shift: boost\nPress E at the amber switch beside the space doors to enable gravity';
      if (status.textContent !== message) status.textContent = message;
    }
    if (prompt) {
      prompt.textContent = canToggleGravity()
        ? (gravityRestored ? 'Press E to enable zero gravity' : 'Press E to restore gravity')
        : 'Press E to climb back into the vent';
      prompt.classList.toggle('hidden', !canToggleGravity() && !canClimb());
    }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || disposed) return;
    if (canToggleGravity()) {
      gravityRestored = !gravityRestored;
      physicsWorld.gravity.set(0, gravityRestored ? PHYSICS.gravity : 0, 0);
      player.setZeroGravity(!gravityRestored);
      for (const [i, { body }] of cargo.entries()) {
        body.linearDamping = gravityRestored ? 0.25 : 0;
        body.angularDamping = gravityRestored ? 0.5 : 0;
        body.allowSleep = gravityRestored;
        body.wakeUp();
        // A small release impulse lifts settled freight when the field switches off.
        if (!gravityRestored) {
          body.velocity.set(Math.sin(i * 2) * 0.15, 0.22, Math.cos(i) * 0.16);
          body.angularVelocity.set(0.04, 0.06 * Math.sin(i + 1), 0.045);
        }
      }
      showGravityState(); updateHud(); onGravityChanged?.(gravityRestored);
    } else if (canClimb()) {
      returning = true; handoffStarted = false; returnTime = 0;
      climbStart.copy(player.body.position);
      player.setRotation(0, 0); player.setLookLocked(true); player.setClimbing(true); prompt?.classList.add('hidden');
    }
  }
  window.addEventListener('keydown', onKeyDown);
  updateHud();
  function updatePhysics(dt: number, thirdPerson = false) {
    if (disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, PHYSICS.maxFrameTime)) : 0;
    elapsed += dt;
    physics.step(dt, player, thirdPerson);
    for (const { mesh, body } of cargo) { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); }
    statusMaterial.emissiveIntensity = gravityRestored ? 1.5 : 1.6 + Math.sin(elapsed * 3) * 0.5;
    lever.rotation.z = THREE.MathUtils.damp(lever.rotation.z, gravityRestored ? -0.7 : 0.5, 5, dt);
    if (entryTime > 0) {
      entryTime = Math.max(0, entryTime - dt);
      player.body.position.y = entryY + entryTime * LADDER.climbSpeed;
      const dismount = THREE.MathUtils.smoothstep(1.35 - entryTime, 1, 1.35);
      player.body.position.z = ladderZ + LADDER.bodyOffset + dismount * 1.5;
      player.body.aabbNeedsUpdate = true;
      if (entryTime === 0) {
        player.setClimbing(false); player.setLookLocked(false); player.setRotation(Math.PI, 0);
        if (!gravityRestored) player.setZeroGravity(true);
      }
    }
    updateHud();
    if (returning) {
      returnTime += dt;
      const mount = THREE.MathUtils.smoothstep(returnTime, 0, LADDER.mountDuration);
      const distance = 4.5 + PHYSICS.playerRadius - climbStart.y;
      const rise = Math.min(distance, Math.max(0, returnTime - LADDER.mountDuration) * LADDER.climbSpeed);
      player.body.position.set(THREE.MathUtils.lerp(climbStart.x, 0, mount), climbStart.y + rise,
        THREE.MathUtils.lerp(climbStart.z, ladderZ + LADDER.bodyOffset, mount));
      player.body.aabbNeedsUpdate = true;
      if (rise >= distance && !handoffStarted) { handoffStarted = true; onReturnToEight?.(); }
    }
    passageDoor.update(dt, player, canInteract() && passageDoor.near(player));
    if (!disposed) player.updateCamera(0, thirdPerson);
  }
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  scene.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  return { roomId: 'loading-bay', scene, camera, physicsWorld, player, updatePhysics, cutsceneManager: null,
    isGravityRestored: () => gravityRestored,
    passageDoor, setPassageTrigger: passageDoor.setTrigger,
    setReturnToEight: (callback: () => void) => { onReturnToEight = callback; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKeyDown); prompt?.classList.add('hidden'); status?.classList.add('hidden');
      player.dispose(); physics.dispose();
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); passageDoor.texture.dispose();
    } };
}
