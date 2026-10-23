import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { disposeRoom, roomBox } from '../../scripts/global/shipRoom.js';
import { createShipInteriorMaterials, createShipTerminal } from '../../scripts/global/shipInterior.js';
import { createCameraVisitUI } from '../../scripts/global/cameraVisit.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player/player.js';
import { teleportPlayer, TELEPORT_THROW } from '../../scripts/global/teleportationDevice.js';
import { createBreakables } from '../../scripts/global/breakables.js';
import { BreakableMaterial } from '../../scripts/global/breakableMaterial.js';
import { createRewardChest } from '../../scripts/global/rewardChest.js';
import { inputHint } from '../../scripts/player/gamepadInput.js';
import { cameraVisitMap, type CameraRoomProgress } from './stageTwoLayout.js';

interface RustChamber2Options {
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  loot?: CameraRoomProgress;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onKeycardCollected?: () => void;
  modelLoader?: typeof loadToolModel;
}

// ---- Design numbers -------------------------------------------------------
// The rift is 34 m across: a max-charge crystal throw from the jagged lip
// reaches ~30 m, so no direct throw makes it - the crystal must bank off the
// launch platform standing in the melt at mid-rift, which fires it (and the
// pendulum-fed cube) on to the far ledge. The pendulum (9 m cable, 75°
// release) drops the cube on to the platform in a ~0.3 s timing window.
const WIDTH = 64, DEPTH = 22, HEIGHT = 14;
const CHASM_X0 = 16, CHASM_X1 = 52, CHASM_Z = DEPTH / 2;
const ACID_Y = -6, CHASM_FLOOR_Y = -9;
const ANCHOR = new THREE.Vector3(15.5, 12.8, 11);
const CABLE = 9;
const REST_ANGLE = -75 * Math.PI / 180;
const PAD = { minX: 29, maxX: 37, minZ: 7, maxZ: 15 };
const PAD_TOP = -3.6;
const LAUNCH_TARGET_X = 57;
const BUTTON = new THREE.Vector3(54, 1.15, 7);
const DIR_TOGGLE = new THREE.Vector3(56, 1.8, 21.7);
const WEST_LAUNCH_X = 8;
const FLOOR_PLATE = new THREE.Vector3(58, 0.06, 11);
const SPAWN = { x: 3, z: 11, yaw: -Math.PI / 2 };
const COVER = 'rust2:cover', LINK = 'rust2:link';

type CubeMode = 'locked' | 'swinging' | 'free' | 'launched' | 'parked' | 'carried' | 'placed';

function signTexture(title: string, lines: string[], color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw the chamber signage');
  context.fillStyle = '#142029'; context.fillRect(0, 0, 768, 256);
  context.strokeStyle = color; context.lineWidth = 6; context.strokeRect(8, 8, 752, 240);
  context.fillStyle = color; context.textAlign = 'center';
  context.font = 'bold 44px monospace'; context.fillText(title, 384, 74);
  context.font = '26px monospace';
  lines.forEach((line, index) => context.fillText(line, 384, 130 + index * 42));
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Adapted from the rustglow counterweight bay: swing, faith plate, and an acid fissure no jump clears. */
export function createScene({ entryState, preview = false, deferActivation = false,
  loot = { cleared: new Set<string>(), rewardCollected: false }, hasReturnMarker, onRestart,
  onKeycardCollected, modelLoader = loadToolModel }: RustChamber2Options = {}) {
  if (!preview && (!hasReturnMarker || !onRestart || !onKeycardCollected))
    throw new Error('The rust chamber requires a surveillance return link and persistent keycard reward');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x10161d);
  scene.fog = new THREE.Fog(0x10161d, 44, 92);
  const physics = createScenePhysics(), world = physics.world;
  const camera = new THREE.PerspectiveCamera(68, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 120);
  const ship = createShipInteriorMaterials(9, 7);
  ship.deck.color.setHex(0x55504a);
  const steel = new THREE.MeshStandardMaterial({ color: 0x4e5c66, metalness: 0.65, roughness: 0.58 });
  const worn = new THREE.MeshStandardMaterial({ color: 0x70523c, metalness: 0.4, roughness: 0.86 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232a30, metalness: 0.5, roughness: 0.8 });
  const box = (size: [number, number, number], at: [number, number, number], material: THREE.Material = steel, solid = true) =>
    roomBox(scene, physics, size, at, material, solid);
  let active = !preview && !deferActivation, paused = false, disposed = false, clock = 0, greeted = false;
  let captionTime = 0, lastDelta = 0, ownsPrompt = false;
  const player = createPlayer({ camera, physicsWorld: world, spawnPosition: { x: SPAWN.x, y: PHYSICS.playerRadius, z: SPAWN.z } });
  teleportPlayer(player, { x: SPAWN.x, y: player.radius, z: SPAWN.z }, SPAWN.yaw, entryState);
  if (active) player.enable();
  if (preview) { camera.position.set(8, 10, 3); camera.lookAt(42, 1, 12); }
  const ui = document.createElement('section'); ui.className = 'stage-two-ui rust-chamber-ui';
  ui.classList.toggle('hidden', !active);
  const caption = document.createElement('div'); caption.className = 'stage-two-dialogue hidden'; caption.setAttribute('role', 'status');
  ui.append(caption); if (!preview) document.body.append(ui);
  const prompt = document.getElementById('interact-prompt');
  function say(text: string, seconds: number) {
    if (preview) return;
    caption.textContent = text; captionTime = seconds; caption.classList.remove('hidden');
  }

  // ---- Shell: two ledges split by the fissure, chest alcove behind the east door.
  box([9, 0.4, DEPTH], [4.5, -0.2, CHASM_Z], ship.deck);
  box([6.5, 0.4, DEPTH], [60.75, -0.2, CHASM_Z], ship.deck);
  box([6, 0.4, 8], [-3, -0.2, 11], ship.deck);
  box([40, 0.4, DEPTH], [34, CHASM_FLOOR_Y - 0.2, CHASM_Z], dark);
  box([WIDTH + 6, 0.5, DEPTH], [(WIDTH + 6) / 2, HEIGHT + 0.25, CHASM_Z], dark);
  box([WIDTH + 6, 1.2, DEPTH - 6], [(WIDTH + 6) / 2, HEIGHT - 0.6, CHASM_Z], dark, false);
  // West wall carries the glass cradle door; the east wall is solid.
  box([0.4, HEIGHT, 8], [-0.2, HEIGHT / 2, 4], ship.steel);
  box([0.4, HEIGHT, 8], [-0.2, HEIGHT / 2, 18], ship.steel);
  box([0.4, HEIGHT - 4.5, 6.4], [-0.2, 4.5 + (HEIGHT - 4.5) / 2, 11], ship.steel);
  box([0.4, HEIGHT, DEPTH], [WIDTH + 0.2, HEIGHT / 2, CHASM_Z], ship.steel);
  box([6.4, HEIGHT, 0.4], [-3, HEIGHT / 2, 6.8], ship.steel);
  box([6.4, HEIGHT, 0.4], [-3, HEIGHT / 2, 15.2], ship.steel);
  box([0.4, HEIGHT, 8], [-6.2, HEIGHT / 2, 11], ship.steel);
  box([6, 0.2, 8], [-3, 4.6, 11], ship.dark);
  for (const z of [4, 8, 14, 18]) {
    box([0.4, HEIGHT, 0.35], [-0.1, HEIGHT / 2, z], ship.steel, false);
    box([0.4, HEIGHT, 0.35], [WIDTH + 0.1, HEIGHT / 2, z], ship.steel, false);
  }
  for (const z of [5, 11, 17]) {
    box([WIDTH + 5, 0.6, 0.4], [(WIDTH + 5) / 2, HEIGHT - 0.9, z], steel, false);
    for (const x of [6, 20, 30, 44, 52]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(5, 0.14, 0.3), steel);
      web.position.set(x, HEIGHT - 1.1, z);
      web.rotation.z = x < 25 ? 0.4 : -0.4;
      scene.add(web);
    }
  }
  for (const [x, z] of [[5, 3], [13, 19], [55, 3], [61, 19]]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, HEIGHT, 8), steel);
    pier.position.set(x, HEIGHT / 2, z); scene.add(pier);
    box([1.7, 0.5, 1.7], [x, 0.25, z], worn);
    physics.addBox({ x: 1.5, y: HEIGHT, z: 1.5 }, { x, y: HEIGHT / 2, z });
  }
  // Torn rift edges: zigzag slabs carry the visual and the collider together,
  // so the split in the deck reads jagged from every angle and stays walkable.
  const rock = new THREE.MeshStandardMaterial({ color: 0x4a3c33, roughness: 0.96, metalness: 0.05 });
  function riftEdge(baseX: number, inland: 1 | -1, phase: number) {
    const segs = 8, step = DEPTH / segs;
    const xs = Array.from({ length: segs + 1 }, (_, i) => baseX + (i % 2 ? 1.15 : -1.15) + Math.sin(i * 2.7 + phase) * 0.4);
    for (let i = 0; i < segs; i++) {
      const z0 = step * i, z1 = step * (i + 1);
      const dx = xs[i + 1] - xs[i], dz = z1 - z0;
      const len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
      const mx = (xs[i] + xs[i + 1]) / 2, mz = (z0 + z1) / 2;
      const nx = inland * Math.cos(yaw), nz = -inland * Math.sin(yaw);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, len + 0.4), rock);
      slab.position.set(mx + nx * 4.6, -0.78, mz + nz * 4.6);
      slab.rotation.y = yaw; slab.receiveShadow = true; scene.add(slab); physics.addBoxFromMesh(slab);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.8, len + 0.4), rock);
      rim.position.set(mx + nx * 0.25, -1.38, mz + nz * 0.25);
      rim.rotation.y = yaw; scene.add(rim); physics.addBoxFromMesh(rim);
      for (const [off, y, h] of [[1.2, -3.6, 5], [2.4, -6.4, 4.4]] as const) {
        const face = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, len + 0.5), rock);
        face.position.set(mx + nx * off, y, mz + nz * off);
        face.rotation.y = yaw; scene.add(face);
      }
      if (i % 2 === 0) {
        const shard = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 1.6), rock);
        shard.position.set(mx + nx * 0.9, 0.35, mz + nz * 0.9);
        shard.rotation.y = yaw + 0.4; scene.add(shard); physics.addBoxFromMesh(shard);
      }
    }
  }
  riftEdge(CHASM_X0 + 0.2, -1, 0.7);
  riftEdge(CHASM_X1 - 0.2, 1, 2.1);

  // ---- Acid: the fissure runs wall to wall, the melt sits six metres down.
  const acidTime = { value: 0 };
  const acidMaterial = new THREE.MeshStandardMaterial({
    color: 0x5d7a1c, emissive: 0x3c5208, emissiveIntensity: 0.9,
    roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  acidMaterial.onBeforeCompile = shader => {
    shader.uniforms.uAcidTime = acidTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uAcidTime;\nvarying vec2 vAcidUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAcidUv = uv;
        transformed.z += sin(position.x * 2.3 + uAcidTime * 0.9) * 0.02
          + sin(position.y * 3.1 - uAcidTime * 0.7) * 0.015;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uAcidTime;\nvarying vec2 vAcidUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float scum = sin(vAcidUv.x * 41.0 + sin(vAcidUv.y * 27.0) + uAcidTime * 0.2);
        float boil = smoothstep(0.72, 0.98, sin(vAcidUv.x * 9.0 + uAcidTime * 1.3) * sin(vAcidUv.y * 11.0 - uAcidTime));
        diffuseColor.rgb *= 0.85 + scum * 0.15;
        totalEmissiveRadiance += vec3(0.45, 0.62, 0.1) * boil * 0.6;`);
  };
  acidMaterial.customProgramCacheKey = () => 'rust2-acid-v1';
  const acidShape = new THREE.Shape();
  acidShape.moveTo(14.2, 0.2);
  acidShape.lineTo(53.8, 0.2);
  acidShape.lineTo(53.8, DEPTH - 0.2);
  acidShape.lineTo(14.2, DEPTH - 0.2);
  acidShape.closePath();
  const acidHole = new THREE.Path();
  acidHole.moveTo(PAD.minX, PAD.minZ);
  acidHole.lineTo(PAD.maxX, PAD.minZ);
  acidHole.lineTo(PAD.maxX, PAD.maxZ);
  acidHole.lineTo(PAD.minX, PAD.maxZ);
  acidHole.closePath();
  acidShape.holes.push(acidHole);
  const acid = new THREE.Mesh(new THREE.ShapeGeometry(acidShape, 24), acidMaterial);
  acid.name = 'RustChamber2Acid'; acid.rotation.x = -Math.PI / 2;
  acid.position.set(0, ACID_Y, DEPTH - 0.2); scene.add(acid);
  const acidGlows: THREE.PointLight[] = [];
  for (const x of [22, 46]) {
    const acidGlow = new THREE.PointLight(0x9abf2f, 22, 22, 2);
    acidGlow.position.set(x, ACID_Y + 1.5, CHASM_Z); scene.add(acidGlow);
    acidGlows.push(acidGlow);
  }
  for (const x of [22, 46]) {
    for (const z of [5, 11, 17]) {
      const steam = new THREE.Mesh(new THREE.PlaneGeometry(7, 4),
        new THREE.MeshBasicMaterial({ color: 0xa8c050, transparent: true, opacity: 0.06, depthWrite: false }));
      steam.position.set(x, ACID_Y + 2.4, z);
      steam.rotation.y = Math.PI / 2 + (z - 11) * 0.08; scene.add(steam);
    }
  }

  // ---- Pendulum: rust cradle holds the load against the west wall; the button on the far ledge drops it.
  const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x51606c, metalness: 0.6, roughness: 0.5 });
  const cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cubeMaterial);
  cubeMesh.name = 'RustChamber2Counterweight'; cubeMesh.castShadow = true; scene.add(cubeMesh);
  const cubeBody = new CANNON.Body({ mass: 200, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)) });
  cubeBody.type = CANNON.Body.KINEMATIC;
  const cubePhysMat = new CANNON.Material({ friction: 0.7, restitution: 0.02 });
  cubeBody.material = cubePhysMat;
  world.addContactMaterial(new CANNON.ContactMaterial(physics.solidMaterial, cubePhysMat, { friction: 0.7, restitution: 0.02 }));
  world.addBody(cubeBody);
  const anchorBracket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), steel);
  anchorBracket.position.copy(ANCHOR).add(new THREE.Vector3(0, 0.75, 0)); scene.add(anchorBracket);
  box([1.8, 0.4, 1.8], [ANCHOR.x, HEIGHT - 0.4, ANCHOR.z], dark);
  const cableMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 }));
  scene.add(cableMesh);
  const cradle = new THREE.Group(); cradle.name = 'RustChamber2Cradle'; scene.add(cradle);
  for (const side of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), worn);
    jaw.position.set(side * 0.62, 0.3, 0); cradle.add(jaw);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.14), worn);
    claw.position.set(side * 0.38, -0.42, 0); cradle.add(claw);
  }
  const cradleBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.7, 1.5), worn);
  cradleBack.position.set(-0.95, 0.25, 0); cradle.add(cradleBack);

  function restPosition() {
    return new THREE.Vector3(ANCHOR.x + CABLE * Math.sin(REST_ANGLE), ANCHOR.y - CABLE * Math.cos(REST_ANGLE), ANCHOR.z);
  }
  function swingPosition(theta: number, target: THREE.Vector3) {
    return target.set(ANCHOR.x + CABLE * Math.sin(theta), ANCHOR.y - CABLE * Math.cos(theta), ANCHOR.z);
  }
  let mode: CubeMode = 'locked';
  let plateEast = true;
  let theta = REST_ANGLE, thetaRate = 0, buttonUsed = false;
  let recallTimer = -1, lostTimer = -1, releaseTimer = -1, plateFlash = 0;
  function placeCubeKinematic(position: THREE.Vector3) {
    cubeBody.type = CANNON.Body.KINEMATIC; cubeBody.updateMassProperties();
    cubeBody.position.set(position.x, position.y, position.z);
    cubeBody.velocity.set(0, 0, 0); cubeBody.angularVelocity.set(0, 0, 0);
    cubeBody.quaternion.set(0, 0, 0, 1);
    cubeBody.aabbNeedsUpdate = true; cubeBody.wakeUp();
    cubeMesh.position.copy(position); cubeMesh.quaternion.identity(); cubeMesh.visible = true;
  }
  function lockCube() {
    mode = 'locked'; theta = REST_ANGLE; thetaRate = 0;
    placeCubeKinematic(restPosition());
    cradle.visible = true;
    cradle.position.copy(restPosition()).add(new THREE.Vector3(0, 0.6, 0));
    cradle.rotation.z = 0;
  }
  lockCube();
  const cradleAnchor = restPosition();
  box([0.3, HEIGHT - cradleAnchor.y - 0.55, 0.3],
    [cradleAnchor.x, (HEIGHT + cradleAnchor.y + 0.55) / 2, cradleAnchor.z], steel, false);

  // ---- Breakables: crowbar corrosion over the release button; pistol link on the swing cable.
  const breakables = createBreakables(scene, world);
  box([1.1, 1.1, 1.1], [BUTTON.x, 0.55, BUTTON.z], ship.dark);
  const buttonBase = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.16, 20), steel);
  buttonBase.position.set(BUTTON.x, BUTTON.y - 0.05, BUTTON.z); scene.add(buttonBase);
  const buttonCap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 20),
    new THREE.MeshStandardMaterial({ color: 0x330806, emissive: 0xff5a20, emissiveIntensity: 1.4 }));
  buttonCap.position.set(BUTTON.x, BUTTON.y + 0.06, BUTTON.z); scene.add(buttonCap);
  let buttonPress = 0;
  breakables.add(COVER, 'crowbar', new THREE.Vector3(BUTTON.x, BUTTON.y + 0.28, BUTTON.z),
    new THREE.Vector3(0.85, 0.6, 0.85), id => { loot.cleared.add(id); say('The corrosion cracks off the release housing. The button is live.', 4); });
  const link = breakables.add(LINK, 'pistol', ANCHOR.clone(), new THREE.Vector3(0.45, 1.1, 0.45), () => {
    if (mode !== 'swinging') return;
    mode = 'free';
    cubeBody.type = CANNON.Body.DYNAMIC; cubeBody.updateMassProperties();
    const speed = CABLE * thetaRate;
    cubeBody.velocity.set(speed * Math.cos(theta), speed * Math.sin(theta), 0);
    cubeBody.angularVelocity.set(0, 0, -thetaRate * 0.6);
    cubeBody.aabbNeedsUpdate = true; cubeBody.wakeUp();
    say('Link severed - the load is ballistic. It has to land on the launcher pad.', 4);
  });
  // Wall beacon on the right-hand wall: shooting it vectors the pad. The head, ring and
  // backplate live on the breakable root so pistol traces actually register the hit.
  let toggleHead!: THREE.Mesh, toggleRing!: THREE.Mesh;
  const dirToggle = breakables.add('rust2:dir', 'pistol', DIR_TOGGLE.clone(), new THREE.Vector3(0.8, 0.8, 0.8), undefined, {
    hits: 9999, showBox: false,
    decorate(root) {
      const backplate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.16), ship.dark);
      backplate.position.z = 0.22; root.add(backplate);
      toggleHead = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x220a12, emissive: 0xff4fa3, emissiveIntensity: 1.8 }));
      root.add(toggleHead);
      toggleRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xff4fa3, toneMapped: false }));
      toggleRing.position.z = 0.1; root.add(toggleRing);
    },
  });
  let toggleHits = dirToggle.hitsRemaining;
  breakables.restoreBroken(loot.cleared);
  const broken = (id: string) => breakables.objects.some(item => item.id === id && item.broken);
  function syncCable() {
    const top = new THREE.Vector3(ANCHOR.x, ANCHOR.y - 0.2, ANCHOR.z);
    const end = mode === 'free' || mode === 'launched' || mode === 'parked' || mode === 'carried' || mode === 'placed'
      ? top.clone().add(new THREE.Vector3(0, -1.6, 0))
      : cubeMesh.position.clone().add(new THREE.Vector3(0, 0.5, 0));
    const span = end.clone().sub(top);
    cableMesh.visible = span.length() > 0.2;
    cableMesh.position.copy(top).add(span.clone().multiplyScalar(0.5));
    cableMesh.scale.set(1, Math.max(0.01, span.length()), 1);
    cableMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
  }
  function syncLink() {
    if (link.broken) return;
    const point = mode === 'locked' || mode === 'swinging'
      ? new THREE.Vector3(ANCHOR.x + CABLE * 0.55 * Math.sin(theta), ANCHOR.y - CABLE * 0.55 * Math.cos(theta), ANCHOR.z)
      : new THREE.Vector3(ANCHOR.x, ANCHOR.y - 1.1, ANCHOR.z);
    link.root.position.copy(point);
    link.body.position.set(point.x, point.y, point.z);
    link.body.aabbNeedsUpdate = true;
  }
  syncLink(); syncCable();

  // ---- Faith plate on a plinth mid-rift: the swing must feed it, misses go in the acid.
  // Same corrosion-vein shader as the rust breakables, tinted pink to read as machinery.
  const padMat = new BreakableMaterial('crowbar', 0xff4fa3);
  box([8.6, 5.8, 8.6], [33, -6.5, 11], rock);
  for (const [sx, sz, sy] of [[29.6, 7.6, -5.2], [36.4, 14.4, -6.1], [30.2, 14.6, -4.6], [36.2, 7.4, -5.6]]) {
    const spur = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 1.6), rock);
    spur.position.set(sx, sy, sz); spur.rotation.y = sx + sz; scene.add(spur);
  }
  const padGroup = new THREE.Group(); padGroup.name = 'RustChamber2FaithPlate';
  padGroup.position.set(33, PAD_TOP, 11); scene.add(padGroup);
  // Plate top sits exactly flush with the plinth collider so visuals and bounce surface agree.
  const padPlate = new THREE.Mesh(new THREE.BoxGeometry(PAD.maxX - PAD.minX + 0.4, 0.12, PAD.maxZ - PAD.minZ + 0.4), padMat);
  padPlate.position.y = -0.06; padGroup.add(padPlate);
  for (const index of [0, 1, 2]) {
    const chevron = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 1.6 - index * 0.3), padMat);
    chevron.position.set(-1.4 + index * 1.4, -0.01, 0); padGroup.add(chevron);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.9), padMat);
    left.position.set(-1.4 + index * 1.4 + 0.3, -0.01, -0.62); left.rotation.y = 0.6; padGroup.add(left);
    const right = left.clone(); right.position.z = 0.62; right.rotation.y = -0.6; padGroup.add(right);
  }
  const padLight = new THREE.PointLight(0xff4fa3, 0, 10, 2); padLight.position.set(0, 0.8, 0); padGroup.add(padLight);
  // Floating direction arrows over the pad: the live vector burns bright, the other fades out.
  function padArrowGroup(dir: 1 | -1, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.9 });
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.6), mat);
    shaft.position.x = -dir * 0.5; group.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.2, 4), mat);
    head.rotation.z = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    head.position.x = dir * 1.0; group.add(head);
    group.position.set(dir * 2.4, 1.6, 0);
    padGroup.add(group);
    return mat;
  }
  const arrowMatE = padArrowGroup(1, 0xff4fa3);
  const arrowMatW = padArrowGroup(-1, 0x35e0ff);
  function launchVelocity(x: number, y: number, z: number, gravity: number, targetY: number) {
    // Fixed 45° elevation; speed solved per direction so the arc climbs from the plinth to the target ledge.
    const target = plateEast ? LAUNCH_TARGET_X : WEST_LAUNCH_X;
    const range = Math.max(10, Math.abs(target - x));
    const climb = targetY - y;
    const speed = Math.sqrt(gravity * range * range / Math.max(1, range - climb));
    return new THREE.Vector3((plateEast ? 1 : -1) * speed * Math.SQRT1_2, speed * Math.SQRT1_2, (11 - z) * 0.3);
  }
  function launchCube() {
    cubeBody.linearDamping = 0.01;
    const launch = launchVelocity(cubeBody.position.x, cubeBody.position.y, cubeBody.position.z,
      Math.abs(PHYSICS.gravity), 0.5);
    cubeBody.velocity.set(launch.x, launch.y, launch.z);
    cubeBody.angularVelocity.set(-2, 0, 0);
    cubeBody.wakeUp();
    mode = 'launched'; plateFlash = 1; padMat.hit(1);
    say(plateEast ? 'The launcher fires - the load arcs for the far ledge.' : 'The launcher fires west - the load comes home to the cradle wall.', 4);
  }

  // ---- East ledge: floor plate for the load, locked door, chest alcove.
  const floorPlate = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a434a, metalness: 0.5, roughness: 0.6 }));
  floorPlate.position.copy(FLOOR_PLATE); scene.add(floorPlate);
  const floorRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xff9a4a, toneMapped: false }));
  floorRing.rotation.x = Math.PI / 2; floorRing.position.set(FLOOR_PLATE.x, 0.08, FLOOR_PLATE.z); scene.add(floorRing);
  // ---- Glass cradle door on the spawn wall: two panes parting sideways into the wall pockets.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe8f2, transparent: true, opacity: 0.18,
    roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const doorL = new THREE.Group(); doorL.name = 'RustChamber2GlassDoorL';
  const doorR = new THREE.Group(); doorR.name = 'RustChamber2GlassDoorR';
  for (const [group, zc] of [[doorL, 9.55], [doorR, 12.45]] as const) {
    group.position.set(-0.2, 0, zc); scene.add(group);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.5, 2.9), glassMat);
    pane.position.y = 2.25; group.add(pane);
    for (const edge of [-1.45, 1.45]) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.5, 0.18), steel);
      stile.position.set(0, 2.25, edge); group.add(stile);
    }
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 6.4), steel);
  header.position.set(0, 4.75, 11); scene.add(header);
  const glassBody = physics.addBox({ x: 0.3, y: 4.5, z: 5.8 }, { x: 0, y: 2.25, z: 11 });
  let doorLift = 0;
  function updateGlassDoor(frame: number, open: boolean) {
    doorLift = THREE.MathUtils.damp(doorLift, open ? 1 : 0, 3, frame);
    doorL.position.z = 9.55 - 2.95 * doorLift;
    doorR.position.z = 12.45 + 2.95 * doorLift;
    if (open && doorLift > 0.9 && glassBody.world === world) world.removeBody(glassBody);
    if (!open && doorLift < 0.1 && glassBody.world !== world) {
      world.addBody(glassBody); glassBody.aabbNeedsUpdate = true;
    }
  }
  const alcoveLight = new THREE.PointLight(0xc2e3d8, 14, 9); alcoveLight.position.set(-3, 3.6, 11); scene.add(alcoveLight);
  const doorSign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85),
    new THREE.MeshBasicMaterial({ map: signTexture('LOAD CRADLE', ['SET THE COUNTERWEIGHT', 'ON THE FLOOR PLATE'], '#ff9a4a') }));
  doorSign.position.set(0.45, 5.7, 11); doorSign.rotation.y = Math.PI / 2; scene.add(doorSign);
  // Glowing lock wire: door frame, along the south wall across the rift, then a floor run
  // into the cube's floor plate - it burns green once the plate is loaded.
  const wireCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.45, 4.4, 11), new THREE.Vector3(0.45, 2.6, 8), new THREE.Vector3(0.45, 2.6, 0.6),
    new THREE.Vector3(20, 2.6, 0.5), new THREE.Vector3(33, 2.35, 0.5), new THREE.Vector3(50, 2.6, 0.5),
    new THREE.Vector3(63.4, 2.6, 0.6), new THREE.Vector3(63.4, 0.12, 0.8), new THREE.Vector3(61, 0.12, 2.0),
    new THREE.Vector3(FLOOR_PLATE.x, 0.12, 4.0), new THREE.Vector3(FLOOR_PLATE.x, 0.12, FLOOR_PLATE.z - 1.7),
  ]);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x35e0ff, toneMapped: false, transparent: true, opacity: 0.85 });
  const wire = new THREE.Mesh(new THREE.TubeGeometry(wireCurve, 120, 0.035, 6, false), wireMat);
  wire.name = 'RustChamber2LockWire'; scene.add(wire);

  // ---- Signage, reset console, lighting.
  const wallSign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.5),
    new THREE.MeshBasicMaterial({ map: signTexture('FISSURE 9C - COUNTERWEIGHT RUN', ['BANK CRYSTAL AND LOAD OFF THE PLATFORM', 'PINK BEACON FLIPS THE PAD WEST'], '#4fd6ff') }));
  wallSign.position.set(8, 3.6, 0.25); scene.add(wallSign);
  const resetConsole = createShipTerminal(signTexture('REBUILD', ['RESET THE BAY'], '#7dbfc9'));
  resetConsole.root.name = 'RustChamber2RebuildControl';
  resetConsole.root.position.set(1.1, 1.1, 15); resetConsole.root.rotation.y = Math.PI / 2; scene.add(resetConsole.root);
  box([0.16, 1.15, 0.8], [0.6, 1.35, 15], ship.dark);
  scene.add(new THREE.HemisphereLight(0x9db7c8, 0x433124, 1.6));
  const key = new THREE.DirectionalLight(0xd7dfe7, 1.5); key.position.set(-4, 12, 6); scene.add(key);
  for (const [x, y, z, intensity, color] of [
    [5, 8, 11, 22, 0xffc28a], [12, 5, 11, 12, 0xff8fc4], [33, 9, 11, 10, 0xbfd4e0],
    [58, 8, 11, 22, 0xffc28a], [-3, 3.4, 11, 8, 0xc2e3d8],
  ]) {
    const lamp = new THREE.PointLight(color, intensity, 24, 2); lamp.position.set(x, y, z); scene.add(lamp);
  }

  // ---- Interaction: button, cube carry, rebuild console.
  function near(point: THREE.Vector3, radius = 2.2) {
    return Math.hypot(player.body.position.x - point.x, player.body.position.z - point.z) < radius;
  }
  function nearCube() {
    return near(cubeMesh.position, 2.1) && Math.abs(player.body.position.y - cubeMesh.position.y) < 2.4;
  }
  function holding() { return mode === 'carried'; }
  function canGrab() {
    return (mode === 'parked' || mode === 'placed') && player.isEnabled() && player.getHealth() > 0
      && player.getState().isOnGround && !holding();
  }
  const heldOffset = new THREE.Vector3();
  function grabCube() {
    mode = 'carried';
    cubeBody.type = CANNON.Body.KINEMATIC; cubeBody.updateMassProperties();
    cubeBody.velocity.set(0, 0, 0); cubeBody.angularVelocity.set(0, 0, 0);
    player.setBoxHandling(true);
    heldOffset.set(0, -0.45, 0);
    say('The counterweight is heavy - no sprinting, no jumping, no teleporting while you hold it.', 5);
  }
  function releaseCube() {
    player.setBoxHandling(false);
    const onPlate = Math.hypot(cubeBody.position.x - FLOOR_PLATE.x, cubeBody.position.z - FLOOR_PLATE.z) < 1.45;
    cubeBody.type = CANNON.Body.STATIC; cubeBody.updateMassProperties();
    cubeBody.velocity.set(0, 0, 0); cubeBody.angularVelocity.set(0, 0, 0);
    if (onPlate) {
      cubeBody.position.set(FLOOR_PLATE.x, FLOOR_PLATE.y + 0.56, FLOOR_PLATE.z);
      cubeBody.quaternion.set(0, 0, 0, 1);
      cubeBody.aabbNeedsUpdate = true;
      cubeMesh.position.set(FLOOR_PLATE.x, FLOOR_PLATE.y + 0.56, FLOOR_PLATE.z);
      cubeMesh.quaternion.identity();
      mode = 'placed';
      say('The plate takes the weight. The alcove door grinds open.', 4);
    } else {
      mode = 'parked';
    }
  }
  function releaseFromCradle() {
    if (mode !== 'locked') { say('The cradle is already open.', 3); return; }
    mode = 'swinging'; theta = REST_ANGLE; thetaRate = 0;
    cradle.visible = false;
    buttonPress = 1; buttonUsed = true;
    say('The cradle lets go - the load is swinging over the pad. Cut the blue link at the right moment.', 6);
  }
  function resetChamber() {
    melting = null; player.setInputLocked(false);
    if (holding()) player.setBoxHandling(false);
    loot.cleared.clear(); breakables.reset();
    toggleHits = dirToggle.hitsRemaining;
    buttonUsed = false; buttonPress = 0;
    recallTimer = -1; lostTimer = -1; releaseTimer = -1; plateFlash = 0;
    plateEast = true; doorLift = 0; doorL.position.z = 9.55; doorR.position.z = 12.45;
    if (glassBody.world !== world) world.addBody(glassBody);
    lockCube(); syncLink(); syncCable();
    teleportPlayer(player, { x: SPAWN.x, y: player.radius, z: SPAWN.z }, SPAWN.yaw);
    caption.classList.add('hidden'); captionTime = 0; hidePrompt();
    say('Bay rebuilt. The load hangs in its cradle again.', 4);
  }
  function hidePrompt() { if (ownsPrompt) prompt?.classList.add('hidden'); ownsPrompt = false; }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || !active || paused || disposed || document.hidden
      || document.body.classList.contains('quick-menu-open')
      || event.ctrlKey || event.altKey || event.metaKey
      || event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    if (!playable()) return;
    if (holding()) {
      event.preventDefault(); event.stopImmediatePropagation(); releaseCube(); return;
    }
    if (near(resetConsole.root.position, 1.9) && player.body.position.y < 2) {
      event.preventDefault(); event.stopImmediatePropagation(); resetChamber(); return;
    }
    if (near(BUTTON, 1.9) && player.body.position.y < 2 && !broken(COVER)) {
      event.preventDefault(); event.stopImmediatePropagation();
      say('Corrosion seals the release housing. Crowbar it off.', 4); return;
    }
    if (near(BUTTON, 1.9) && player.body.position.y < 2) {
      event.preventDefault(); event.stopImmediatePropagation(); releaseFromCradle(); return;
    }
    if (canGrab() && nearCube()) {
      event.preventDefault(); event.stopImmediatePropagation(); grabCube();
    }
  }
  if (!preview) window.addEventListener('keydown', onKey, true);
  function playable() { return active && !paused && !disposed && !melting && player.isEnabled() && player.getHealth() > 0; }

  // ---- Reward chest behind the alcove door.
  const complete = () => mode === 'placed';
  const chest = createRewardChest({ scene, world, player, position: new THREE.Vector3(-3.5, -0.02, 11), yaw: -Math.PI / 2,
    reward: 'keycard', style: 'crew', initialCollected: loot.rewardCollected, unlocked: complete,
    canInteract: playable, onCollect: () => { onKeycardCollected?.(); loot.rewardCollected = true; return true; } }, modelLoader);
  if (loot.rewardCollected) chest.setCollected();
  const visitUI = !preview && hasReturnMarker && onRestart
    ? createCameraVisitUI({ title: 'Rust chamber 2', player, hasReturnMarker, onRestart }) : null;
  visitUI?.setVisible(active);

  // ---- Acid death: the same melt cinematic as the first chamber, then respawn at the entry.
  let melting: { time: number; position: THREE.Vector3; camera: THREE.Vector3 } | null = null;
  const view = new THREE.PerspectiveCamera();
  function applyCinematicCamera() {
    if (!melting) return false;
    const focus = melting.position.clone().add(new THREE.Vector3(0, 0.4, 0));
    camera.position.copy(melting.camera).lerp(focus.clone().add(new THREE.Vector3(2.8, 2, -3.4)),
      THREE.MathUtils.smoothstep(melting.time, 0, 0.5));
    camera.lookAt(focus); return true;
  }

  function startMelt() {
    const p = player.body.position;
    melting = { time: 0, position: new THREE.Vector3(p.x, p.y, p.z), camera: camera.position.clone() };
    player.clearInput(); player.setInputLocked(true); player.body.velocity.set(0, 0, 0);
    hidePrompt(); visitUI?.setVisible(false);
  }
  function updateCubeLoss(frame: number) {
    if ((mode === 'free' || mode === 'launched') && cubeBody.position.y < ACID_Y + 0.5) {
      cubeMesh.visible = false; mode = 'locked'; lostTimer = 4.5;
      acidGlows.forEach(glow => { glow.intensity = 90; });
      say('The load hisses into the melt. The cradle is already printing another.', 5);
      return;
    }
    if (mode === 'free' || mode === 'launched') {
      const speed = cubeBody.velocity.length();
      const settled = speed < 0.6 && cubeBody.position.y < 1.8;
      if (settled && cubeBody.position.x > (CHASM_X0 + CHASM_X1) / 2) {
        mode = 'parked';
        say('The load is down on the far ledge. Carry it to the floor plate.', 6);
      } else if (settled && recallTimer < 0) {
        recallTimer = 4;
      }
    }
    if (recallTimer > 0) {
      recallTimer -= frame;
      if (recallTimer <= 0) {
        recallTimer = -1;
        recradle();
        say('The recycler hauls the load back up to its cradle.', 4);
        if (buttonUsed) releaseTimer = 1.4;
      }
    }
    if (lostTimer > 0) {
      lostTimer -= frame;
      if (lostTimer <= 0) {
        lostTimer = -1;
        recradle();
        say('A fresh load cools in the cradle.', 4);
        if (buttonUsed) releaseTimer = 1.4;
      }
    }
    if (releaseTimer > 0) {
      releaseTimer -= frame;
      if (releaseTimer <= 0) { releaseTimer = -1; releaseFromCradle(); }
    }
  }
  // Respawning the load also re-forges a severed swing link, keeping the puzzle replayable.
  function recradle() {
    lockCube();
    if (link.broken) {
      breakables.reset();
      breakables.restoreBroken(loot.cleared);
    }
    syncLink(); syncCable();
  }

  return {
    roomId: 'rust-chamber-2', scene, camera, player, physicsWorld: world, cutsceneManager: null, ready: chest.ready,
    getSceneId: () => 'stage2-rust2',
    getMapLayout: () => cameraVisitMap(40), getMapSceneId: () => 'scene40', getMusicTrack: () => 'puzzle' as const,
    activate() { active = true; ui.classList.remove('hidden'); visitUI?.setVisible(true); player.clearInput(); player.enable(); },
    controlsReady: playable, isCinematic: () => !!melting,
    get ownsWeaponInput() { return !!melting; },
    getCinematicState: () => melting ? { ...player.getState(), isMoving: false, actionRequest: null, crouching: false,
      sprinting: false, sliding: false, climbing: false, boxHandling: false } : null,
    getCinematicPose: () => melting ? { clip: 'Idle_Loop' as const, time: melting.time, loop: true } : null,
    getHologramTransition: () => melting ? { blend: 0, opacity: 1 - THREE.MathUtils.smoothstep(melting.time, 1.8, 2.8),
      time: melting.time, melt: THREE.MathUtils.clamp(melting.time / 2.8, 0, 1) } : null,
    getCinematicDelta: () => lastDelta, applyCinematicCamera,
    getDamageTargets: () => {
      if (!playable()) return [];
      // The swing link is only a real target while the load is actually swinging.
      return breakables.getDamageTargets().filter(item => item !== link || mode === 'swinging');
    },
    canPlaceMarker: (position: { x: number; y: number; z: number }) =>
      position.x > 14 && position.x < 54 && position.y < 1
        ? 'The crystal sinks - molten acid will not hold a marker.' : null,
    // The platform banks a thrown crystal across the rift: same solve as the cube launch,
    // but under the throw ballistics (16 m/s²) so the marker lands mid-ledge.
    getThrowBounce: (point: THREE.Vector3) => {
      if (point.x < PAD.minX || point.x > PAD.maxX || point.z < PAD.minZ || point.z > PAD.maxZ
        || point.y < PAD_TOP - 0.6 || point.y > PAD_TOP + 1.2) return null;
      plateFlash = 1; padMat.hit(1);
      say(plateEast ? 'The platform banks your crystal across the melt.' : 'The platform banks your crystal back west.', 3);
      return launchVelocity(point.x, point.y, point.z, TELEPORT_THROW.gravity, 0.3);
    },
    setGogglesActive: breakables.setHighlighted,
    setMenuPaused(value: boolean) { paused = value; player.clearInput(); },
    updateInteractionFocus() {
      if (!playable()) { hidePrompt(); return; }
      const grounded = player.body.position.y < 2;
      const text = holding() ? 'E / Set the counterweight down'
        : canGrab() && nearCube() ? 'E / Pick up the counterweight'
          : grounded && near(BUTTON, 1.9) ? (broken(COVER) ? 'E / Release the cradle' : 'E / Sealed by corrosion')
            : grounded && near(resetConsole.root.position, 1.9) ? 'E / Rebuild chamber' : '';
      if (text && prompt) { prompt.textContent = inputHint(text); prompt.classList.remove('hidden'); ownsPrompt = true; }
      else hidePrompt();
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || paused) return;
      const frame = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime) : 0;
      if (!active && !preview) return;
      lastDelta = frame; clock += frame; acidTime.value = clock;

      if (mode === 'swinging') {
        // Pendulum integration; damping is negligible so the timing window stays predictable.
        thetaRate += (PHYSICS.gravity / CABLE) * Math.sin(theta) * frame;
        thetaRate *= 1 - 0.012 * frame;
        theta += thetaRate * frame;
        const position = swingPosition(theta, new THREE.Vector3());
        cubeBody.position.set(position.x, position.y, position.z);
        cubeBody.velocity.set(CABLE * thetaRate * Math.cos(theta), CABLE * thetaRate * Math.sin(theta), 0);
        cubeBody.aabbNeedsUpdate = true;
        cubeMesh.position.copy(position);
        cubeMesh.rotation.z = -theta;
        cradle.visible = false;
        syncLink();
      } else if (mode === 'locked') {
        syncLink();
      }
      syncCable();

      if (!melting) physics.step(frame, player, thirdPerson);
      breakables.update(frame);
      if (dirToggle.hitsRemaining !== toggleHits) {
        toggleHits = dirToggle.hitsRemaining;
        plateEast = !plateEast;
        say(plateEast ? 'Pad vectored EAST - launches fly to the far ledge.' : 'Pad vectored WEST - bank your crystal off the pad to ride home.', 4);
      }

      if (mode === 'free' || mode === 'launched') {
        cubeMesh.position.copy(cubeBody.position as unknown as THREE.Vector3);
        cubeMesh.quaternion.copy(cubeBody.quaternion as unknown as THREE.Quaternion);
        // Ground drag so the load stops rolling instead of skating into the east wall.
        const rolling = cubeBody.position.y < 1.2 && Math.abs(cubeBody.velocity.y) < 3;
        cubeBody.linearDamping = rolling ? 0.9 : 0.01;
        cubeBody.angularDamping = rolling ? 0.9 : 0.1;
        if (mode === 'free' && cubeBody.position.y < PAD_TOP + 0.8
          && cubeBody.position.x > PAD.minX && cubeBody.position.x < PAD.maxX
          && cubeBody.position.z > PAD.minZ && cubeBody.position.z < PAD.maxZ) {
          launchCube();
        }
      }
      if (mode === 'carried') {
        const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
        forward.y = 0; forward.normalize();
        const target = camera.position.clone().addScaledVector(forward, 1.35).add(heldOffset);
        target.y = Math.max(0.6, target.y);
        cubeBody.position.set(target.x, target.y, target.z);
        cubeBody.velocity.set(0, 0, 0);
        cubeBody.aabbNeedsUpdate = true;
        cubeMesh.position.copy(target); cubeMesh.quaternion.identity();
      }
      updateCubeLoss(frame);

      if (!preview) {
        const p = player.body.position;
        if (!melting && p.y - player.radius <= ACID_Y) {
          startMelt();
        }
        if (melting) {
          melting.time += frame;
          player.body.position.y = melting.position.y - Math.min(0.35, melting.time * 0.13);
          if (melting.time >= 3.2) {
            melting = null; player.setInputLocked(false);
            teleportPlayer(player, { x: SPAWN.x, y: player.radius, z: SPAWN.z }, SPAWN.yaw);
            visitUI?.setVisible(active);
          }
        }
        updateGlassDoor(frame, complete());
        chest.update(frame); visitUI?.update();
        if (active && !greeted) {
          greeted = true;
          say("Prime: Fissure 9C - no throw clears it direct, so the pink platform in the melt is your bank: hit its plate and the crystal rides across; T after it. On the far ledge, crowbar the corrosion seal and press the release - the load starts swinging back on this side. From over there, cut the blue link as the load swings over the platform and the pad fires it across to your ledge. Set the load on the floor plate, then shoot the beacon on the east wall - it vectors the pad west so your next banked throw comes home. Ride it back to the spawn wall; the glass door reads the plate, and the chest waits behind it.", 26);
        }
        captionTime = Math.max(0, captionTime - frame); if (!captionTime) caption.classList.add('hidden');
      }

      // Presentation polish.
      plateFlash = Math.max(0, plateFlash - frame * 2);
      padLight.intensity = 2 + Math.sin(clock * 2.4) * 1.2 + plateFlash * 30;
      padMat.update(frame);
      wireMat.opacity = 0.5 + 0.3 * Math.sin(clock * 2.2);
      wireMat.color.setHex(complete() ? 0x57ff9f : 0x35e0ff);
      arrowMatE.opacity = plateEast ? 0.95 : 0.08;
      arrowMatW.opacity = plateEast ? 0.08 : 0.95;
      (toggleHead.material as THREE.MeshStandardMaterial).emissive.setHex(plateEast ? 0xff4fa3 : 0x35e0ff);
      (toggleRing.material as THREE.MeshBasicMaterial).color.setHex(plateEast ? 0xff4fa3 : 0x35e0ff);
      acidGlows.forEach(glow => { glow.intensity = THREE.MathUtils.damp(glow.intensity, 22 + 5 * Math.sin(clock * 1.7), 2, frame); });
      buttonCap.position.y = BUTTON.y + 0.06 - buttonPress * 0.07;
      buttonPress = Math.max(0, buttonPress - frame * 3);
      const loaded = complete();
      (floorRing.material as THREE.MeshBasicMaterial).color.setHex(loaded ? 0x57ff9f : 0xff9a4a);
      floorRing.rotation.z = clock * (loaded ? 1.6 : 0.4);
      (buttonCap.material as THREE.MeshStandardMaterial).emissive.setHex(loaded || buttonUsed ? 0x2fdd6a : 0xff5a20);
    },
    syncProgress() {
      if (broken(COVER) !== loot.cleared.has(COVER)) {
        const wasHolding = holding();
        if (wasHolding) player.setBoxHandling(false);
        breakables.reset(); breakables.restoreBroken(loot.cleared);
        toggleHits = dirToggle.hitsRemaining;
        buttonUsed = false; recallTimer = -1; lostTimer = -1; releaseTimer = -1;
        lockCube();
      }
      syncLink();
      if (loot.rewardCollected) chest.setCollected();
    },
    minimap: { bounds: { minX: -6, maxX: WIDTH, minZ: 0, maxZ: DEPTH }, floor: 0 },
    dispose() {
      if (disposed) return; disposed = true; melting = null; hidePrompt();
      window.removeEventListener('keydown', onKey, true); visitUI?.dispose(); chest.dispose(); breakables.dispose();
      if (holding()) player.setBoxHandling(false);
      ui.remove(); player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
