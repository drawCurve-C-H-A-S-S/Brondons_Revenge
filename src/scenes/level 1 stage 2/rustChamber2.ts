import * as THREE from "three";
import * as CANNON from "cannon-es";
import { loadToolModel } from "../../core/loader.js";
import { playSfx } from "../../helpers/audio/sfx.js";
import {
  createScenePhysics,
  PHYSICS,
  registerPhysicsActor,
} from "../../helpers/physics/scenePhysics.js";
import {
  createSlidingPortal,
  disposeRoom,
  roomBox,
} from "../../scripts/global/shipRoom.js";
import {
  createShipInteriorMaterials,
  createShipTerminal,
} from "../../scripts/global/shipInterior.js";
import { createCameraVisitUI } from "../../scripts/global/cameraVisit.js";
import {
  createPlayer,
  type PlayerTransitionState,
} from "../../scripts/player/player.js";
import {
  teleportPlayer,
  TELEPORT_THROW,
} from "../../scripts/global/teleportationDevice.js";
import { createBreakables } from "../../scripts/global/breakables.js";
import { BreakableMaterial } from "../../scripts/global/breakableMaterial.js";
import { createRewardChest } from "../../scripts/global/rewardChest.js";
import { inputHint } from "../../scripts/player/gamepadInput.js";
import { setInputHint } from "../../scripts/global/inputPrompts.js";
import { popupDuration } from "../../scripts/global/popupTiming.js";
import { cameraVisitMap, type CameraRoomProgress } from "./stageTwoLayout.js";
import {
  createRustEdgeMaterial,
  createRustWallMaterial,
  createRustWater,
} from "./rustMaterials.js";

interface RustChamber2Options {
  entryState?: PlayerTransitionState;
  preview?: boolean;
  deferActivation?: boolean;
  skipCinematics?: boolean;
  loot?: CameraRoomProgress;
  hasReturnMarker?: () => boolean;
  onRestart?: () => Promise<boolean>;
  onKeycardCollected?: () => void;
  modelLoader?: typeof loadToolModel;
}

// A charged crystal cannot clear the split deck without the trampoline.
const WIDTH = 64,
  DEPTH = 22,
  HEIGHT = 8.4;
const CHASM_X0 = 16,
  CHASM_X1 = 52,
  CHASM_Z = DEPTH / 2;
const WATER_Y = -6,
  CHASM_FLOOR_Y = -9;
const ANCHOR = new THREE.Vector3(15.5, 7.35, 11);
const CABLE = 6.4;
const REST_ANGLE = (-75 * Math.PI) / 180;
const PAD = { minX: 29, maxX: 37, minZ: 7, maxZ: 15 };
const PAD_TOP = -3.6;
const LAUNCH_TARGET_X = 57;
const BUTTON = new THREE.Vector3(62.2, 1.15, CHASM_Z);
const DIR_TOGGLE = new THREE.Vector3(
  (CHASM_X0 + CHASM_X1) / 2,
  2,
  DEPTH - 0.55,
);
const LAUNCH_COLORS = { east: 0xff4fa3, west: 0x35e0ff };
const WEST_LAUNCH_X = 8;
const FLOOR_PLATE = new THREE.Vector3(58, 0.06, 11);
const SPAWN = { x: 3, z: 11, yaw: -Math.PI / 2 };
const COVER = "rust2:cover",
  LINK = "rust2:link",
  PLACED = "rust2:plate";

type CubeMode =
  | "locked"
  | "swinging"
  | "free"
  | "launched"
  | "parked"
  | "carried"
  | "placed"
  | "recycling";

function signTexture(title: string, lines: string[], color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to draw the chamber signage");
  context.fillStyle = "#142029";
  context.fillRect(0, 0, 768, 256);
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.strokeRect(8, 8, 752, 240);
  context.fillStyle = color;
  context.textAlign = "center";
  context.font = "bold 44px monospace";
  context.fillText(title, 384, 74);
  context.font = "26px monospace";
  lines.forEach((line, index) => context.fillText(line, 384, 130 + index * 42));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function splitDeckHintTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to draw the split-deck wall hint");
  context.fillStyle = "#101b22";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#b99b71";
  context.lineWidth = 6;
  context.strokeRect(24, 24, 1488, 976);
  context.fillStyle = "#dfbd87";
  context.font = "bold 28px monospace";
  context.fillText("RUST BAY 02 / COUNTERWEIGHT TRANSFER", 72, 90);
  context.fillStyle = "#fff1d8";
  context.font = "bold 64px monospace";
  context.fillText("THE SPLIT DECK", 72, 176);
  context.fillStyle = "#c8d7dc";
  context.font = "italic 30px monospace";
  context.fillText("Across the rust, let crystal fly;", 72, 244);
  context.fillText("A matching glow will guide it high.", 72, 288);
  const steps = [
    ["01", "BANK THE CRYSTAL", "Throw onto the mat; press T after it lands."],
    [
      "02",
      "FREE THE COUNTERWEIGHT",
      "Across the gap: break orange, then press E.",
    ],
    [
      "03",
      "TIME THE SHOT",
      "Shoot the blue link as the load swings over the mat.",
    ],
    [
      "04",
      "OPEN THE GLASS DOOR",
      "Carry the landed load with E; set it on the plate.",
    ],
    [
      "05",
      "BOUNCE BACK FOR THE KEYCARD",
      "Shoot the wall beacon, then bank another crystal.",
    ],
  ];
  steps.forEach(([number, title, detail], index) => {
    const y = 370 + index * 106;
    context.fillStyle = "#dfbd87";
    context.font = "bold 36px monospace";
    context.fillText(number, 72, y);
    context.fillStyle = "#fff1d8";
    context.font = "bold 34px monospace";
    context.fillText(title, 164, y);
    context.fillStyle = "#c8d7dc";
    context.font = "30px monospace";
    context.fillText(detail, 164, y + 42);
  });
  context.fillStyle = "#ff4fa3";
  context.fillRect(72, 934, 20, 20);
  context.font = "bold 28px monospace";
  context.fillText("PINK / FAR DECK", 108, 956);
  context.fillStyle = "#35e0ff";
  context.fillRect(800, 934, 20, 20);
  context.fillText("CYAN / ENTRANCE", 836, 956);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The split rust deck retains the branch's counterweight and crystal-bank puzzle. */
export function createScene({
  entryState,
  preview = false,
  deferActivation = false,
  skipCinematics = false,
  loot = { cleared: new Set<string>(), rewardCollected: false },
  hasReturnMarker,
  onRestart,
  onKeycardCollected,
  modelLoader = loadToolModel,
}: RustChamber2Options = {}) {
  if (!preview && (!onRestart || !onKeycardCollected))
    throw new Error(
      "The rust chamber requires a surveillance return link and persistent keycard reward",
    );
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111820);
  scene.fog = new THREE.Fog(0x111820, 36, 92);
  const physics = createScenePhysics(),
    world = physics.world;
  const camera = new THREE.PerspectiveCamera(
    68,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.05,
    120,
  );
  const ship = createShipInteriorMaterials(9, 7);
  ship.deck.color.setHex(0x55504a);
  const rusted = createRustWallMaterial();
  const rustEdge = createRustEdgeMaterial(rusted);
  const steel = new THREE.MeshStandardMaterial({
    color: 0x4e5c66,
    metalness: 0.65,
    roughness: 0.58,
  });
  const worn = new THREE.MeshStandardMaterial({
    color: 0x70523c,
    metalness: 0.4,
    roughness: 0.86,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x232a30,
    metalness: 0.5,
    roughness: 0.8,
  });
  const box = (
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material = steel,
    solid = true,
  ) => roomBox(scene, physics, size, at, material, solid);
  let active = !preview && !deferActivation,
    paused = false,
    disposed = false,
    clock = 0;
  let captionTime = 0,
    lastDelta = 0,
    ownsPrompt = false;
  const player = createPlayer({
    camera,
    physicsWorld: world,
    spawnPosition: { x: SPAWN.x, y: PHYSICS.playerRadius, z: SPAWN.z },
  });
  teleportPlayer(
    player,
    { x: SPAWN.x, y: player.radius, z: SPAWN.z },
    SPAWN.yaw,
    entryState,
  );
  if (preview) {
    camera.position.set(7, 5.8, 3);
    camera.lookAt(40, -0.5, 12);
  }
  const ui = document.createElement("section");
  ui.className = "stage-two-ui rust-chamber-ui";
  ui.classList.toggle("hidden", !active);
  const caption = document.createElement("div");
  caption.className = "stage-two-dialogue hidden";
  caption.setAttribute("role", "status");
  ui.append(caption);
  if (!preview) document.body.append(ui);
  const prompt = document.getElementById("interact-prompt");
  function say(text: string, seconds: number) {
    if (preview) return;
    setInputHint(caption, text, "foot", true);
    captionTime = popupDuration(seconds);
    caption.classList.remove("hidden");
  }
  type Presentation = {
    kind: "release" | "placed";
    time: number;
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
    fov: number;
    bodyType: CANNON.Body["type"];
  };
  let presentation: Presentation | null = null;
  function beginPresentation(kind: Presentation["kind"]) {
    if (skipCinematics || preview || !active || disposed || presentation || melting) return;
    presentation = {
      kind,
      time: 0,
      position: camera.position.clone(),
      rotation: camera.quaternion.clone(),
      fov: camera.fov,
      bodyType: player.body.type,
    };
    player.clearInput();
    player.setInputLocked(true);
    player.disable();
    player.body.type = CANNON.Body.KINEMATIC;
    player.body.updateMassProperties();
    player.body.velocity.set(0, 0, 0);
    player.body.angularVelocity.set(0, 0, 0);
    player.body.force.set(0, 0, 0);
    hidePrompt();
    visitUI?.setVisible(false);
    say("E / Skip", 4);
  }
  function endPresentation() {
    const state = presentation;
    if (!state) return;
    presentation = null;
    camera.position.copy(state.position);
    camera.quaternion.copy(state.rotation);
    camera.fov = state.fov;
    camera.updateProjectionMatrix();
    player.body.type = state.bodyType;
    player.body.updateMassProperties();
    player.body.velocity.set(0, 0, 0);
    player.body.force.set(0, 0, 0);
    player.body.wakeUp();
    player.clearInput();
    player.setInputLocked(false);
    caption.classList.add("hidden");
    captionTime = 0;
    if (active && !disposed && !preview) player.enable();
    visitUI?.setVisible(active && !disposed);
  }

  // ---- Shell: two ledges split by the fissure, chest alcove behind the east door.
  box([6, 0.4, 8], [-3, -0.2, 11], ship.deck);
  box([40, 0.4, DEPTH], [34, CHASM_FLOOR_Y - 0.2, CHASM_Z], dark);
  box(
    [WIDTH + 6, 0.5, DEPTH],
    [(WIDTH - 6) / 2, HEIGHT + 0.25, CHASM_Z],
    dark,
  ).name = "RustChamber2Ceiling";
  for (const z of [-0.2, DEPTH + 0.2]) {
    box(
      [WIDTH + 6, HEIGHT, 0.4],
      [(WIDTH - 6) / 2, HEIGHT / 2, z],
      rusted,
    ).name = "RustChamber2RiftWall";
    box(
      [CHASM_X1 - CHASM_X0 + 3.6, -CHASM_FLOOR_Y, 0.4],
      [(CHASM_X0 + CHASM_X1) / 2, CHASM_FLOOR_Y / 2, z],
      rusted,
    ).name = "RustChamber2CorrodedRiftWall";
    box(
      [CHASM_X1 - CHASM_X0 + 3.6, 1.1, 0.06],
      [(CHASM_X0 + CHASM_X1) / 2, WATER_Y + 0.2, z < 0 ? 0.03 : DEPTH - 0.03],
      rustEdge,
      false,
    ).name = "RustChamber2WaterlineCorrosion";
  }
  // West wall carries the glass cradle door; the east wall is solid.
  box([0.4, HEIGHT, 8], [-0.2, HEIGHT / 2, 4], rusted);
  box([0.4, HEIGHT, 8], [-0.2, HEIGHT / 2, 18], rusted);
  box([0.4, HEIGHT - 4.5, 6.4], [-0.2, 4.5 + (HEIGHT - 4.5) / 2, 11], rusted);
  box([0.4, HEIGHT, DEPTH], [WIDTH + 0.2, HEIGHT / 2, CHASM_Z], rusted);
  const lockedExit = createSlidingPortal(
    scene,
    physics,
    { x: WIDTH - 0.08, y: 0, z: 4, yaw: -Math.PI / 2 },
    5.6,
    4.4,
    "",
    { sign: false, landingFloor: false },
  );
  lockedExit.group.name = "RustChamber2LockedExit";
  lockedExit.setLocked(true);
  box([6.4, HEIGHT, 0.4], [-3, HEIGHT / 2, 6.8], rusted);
  box([6.4, HEIGHT, 0.4], [-3, HEIGHT / 2, 15.2], rusted);
  box([0.4, HEIGHT, 8], [-6.2, HEIGHT / 2, 11], rusted);
  box([6, 0.2, 8], [-3, 4.6, 11], ship.dark);
  for (const z of [4, 8, 14, 18]) {
    box([0.4, HEIGHT, 0.35], [-0.1, HEIGHT / 2, z], ship.steel, false);
    box([0.4, HEIGHT, 0.35], [WIDTH + 0.1, HEIGHT / 2, z], ship.steel, false);
  }
  for (const z of [5, 11, 17]) {
    box(
      [WIDTH + 5, 0.6, 0.4],
      [(WIDTH + 5) / 2, HEIGHT - 0.9, z],
      steel,
      false,
    );
    for (const x of [6, 20, 30, 44, 52]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(5, 0.14, 0.3), steel);
      web.position.set(x, HEIGHT - 1.1, z);
      web.rotation.z = x < 25 ? 0.4 : -0.4;
      scene.add(web);
    }
  }
  // Each torn deck segment and its collider share the same flat-topped polygon.
  function splitDeck(baseX: number, west: boolean, phase: number) {
    const segs = 12,
      step = DEPTH / segs,
      innerX = west ? 0 : WIDTH;
    const xs = Array.from(
      { length: segs + 1 },
      (_, i) => baseX + (i % 2 ? 0.7 : -0.7) + Math.sin(i * 2.7 + phase) * 0.35,
    );
    for (let i = 0; i < segs; i++) {
      const z0 = step * i,
        z1 = step * (i + 1);
      const corners = west
        ? [
            [innerX, z0],
            [xs[i], z0],
            [xs[i + 1], z1],
            [innerX, z1],
          ]
        : [
            [xs[i], z0],
            [innerX, z0],
            [innerX, z1],
            [xs[i + 1], z1],
          ];
      const shape = new THREE.Shape(
        corners.map(([x, z]) => new THREE.Vector2(x, -z)),
      );
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.4,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);
      const deck = new THREE.Mesh(geometry, [ship.deck, rustEdge]);
      deck.name = west
        ? "RustChamber2SplitDeckWest"
        : "RustChamber2SplitDeckEast";
      deck.position.y = -0.4;
      deck.receiveShadow = true;
      scene.add(deck);
      const inset = west ? -0.75 : 0.75;
      const edgeShape = new THREE.Shape([
        new THREE.Vector2(xs[i] + inset, -z0),
        new THREE.Vector2(xs[i], -z0),
        new THREE.Vector2(xs[i + 1], -z1),
        new THREE.Vector2(xs[i + 1] + inset, -z1),
      ]);
      const edge = new THREE.Mesh(new THREE.ShapeGeometry(edgeShape), rustEdge);
      edge.name = "RustChamber2CorrodedEdge";
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = 0.004;
      edge.userData.teleportIgnore = true;
      edge.userData.minimap = false;
      scene.add(edge);
      const centerX = corners.reduce((sum, point) => sum + point[0], 0) / 4;
      const centerZ = (z0 + z1) / 2;
      const vertices = [0.2, -0.2].flatMap((y) =>
        corners.map(([x, z]) => new CANNON.Vec3(x - centerX, y, z - centerZ)),
      );
      const body = new CANNON.Body({
        mass: 0,
        material: physics.solidMaterial,
      });
      body.addShape(
        new CANNON.ConvexPolyhedron({
          vertices,
          faces: [
            [0, 3, 2, 1],
            [4, 5, 6, 7],
            [0, 1, 5, 4],
            [1, 2, 6, 5],
            [2, 3, 7, 6],
            [3, 0, 4, 7],
          ],
        }),
      );
      body.position.set(centerX, -0.2, centerZ);
      world.addBody(body);
    }
  }
  splitDeck(CHASM_X0, true, 0.7);
  splitDeck(CHASM_X1, false, 2.1);

  const rustWater = createRustWater(
    CHASM_X1 - CHASM_X0 + 3.6,
    DEPTH - 0.4,
    new THREE.Vector3((CHASM_X0 + CHASM_X1) / 2, WATER_Y, CHASM_Z),
  );
  rustWater.mesh.name = "RustChamber2CorrosiveWater";
  scene.add(rustWater.mesh);
  const hintPoster = new THREE.Mesh(
    new THREE.PlaneGeometry(6.6, 4.4),
    new THREE.MeshBasicMaterial({
      map: splitDeckHintTexture(),
      toneMapped: false,
    }),
  );
  hintPoster.name = "RustChamber2HintPoster";
  hintPoster.position.set(9.5, 2.7, 0.24);
  box([6.9, 4.7, 0.12], [9.5, 2.7, 0.15], worn, false);
  scene.add(hintPoster);

  // ---- Pendulum: rust cradle holds the load against the west wall; the button on the far ledge drops it.
  const cubeMaterial = new THREE.MeshStandardMaterial({
    color: 0x51606c,
    metalness: 0.6,
    roughness: 0.5,
  });
  const cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cubeMaterial);
  cubeMesh.name = "RustChamber2Counterweight";
  cubeMesh.castShadow = true;
  scene.add(cubeMesh);
  for (const x of [-0.51, 0.51]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.06, 1.06), worn);
    band.position.x = x;
    cubeMesh.add(band);
  }
  const liftingEye = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.045, 8, 16),
    steel,
  );
  liftingEye.position.y = 0.64;
  cubeMesh.add(liftingEye);
  const cubeBody = new CANNON.Body({
    mass: 200,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
  });
  cubeBody.type = CANNON.Body.KINEMATIC;
  const cubePhysMat = new CANNON.Material({ friction: 0.7, restitution: 0.02 });
  cubeBody.material = cubePhysMat;
  world.addContactMaterial(
    new CANNON.ContactMaterial(physics.solidMaterial, cubePhysMat, {
      friction: 0.7,
      restitution: 0.02,
    }),
  );
  world.addBody(cubeBody);
  const suspension = new THREE.Group();
  suspension.name = "RustChamber2SuspensionRig";
  suspension.position.copy(ANCHOR);
  scene.add(suspension);
  box([0.55, 0.65, DEPTH - 0.6], [ANCHOR.x, HEIGHT - 0.4, CHASM_Z], worn);
  for (const z of [0.55, DEPTH - 0.55]) {
    box([0.35, HEIGHT, 0.35], [ANCHOR.x - 1, HEIGHT / 2, z], worn);
  }
  const pivot = new THREE.Group();
  pivot.name = "RustChamber2SwingPivot";
  suspension.add(pivot);
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 1.1, 20),
    steel,
  );
  axle.rotation.x = Math.PI / 2;
  pivot.add(axle);
  for (const z of [-0.55, 0.55]) {
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.07, 8, 20),
      worn,
    );
    wheel.position.z = z;
    pivot.add(wheel);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.95, 0.7), steel);
    cheek.position.set(z < 0 ? -0.55 : 0.55, 0.45, 0);
    suspension.add(cheek);
  }
  const cableMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 1, 10),
    new THREE.MeshStandardMaterial({
      color: 0x646562,
      roughness: 0.85,
      metalness: 0.7,
    }),
  );
  cableMesh.name = "RustChamber2SuspensionCable";
  scene.add(cableMesh);
  const cradle = new THREE.Group();
  cradle.name = "RustChamber2Cradle";
  scene.add(cradle);
  for (const side of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), worn);
    jaw.position.set(side * 0.62, 0.3, 0);
    cradle.add(jaw);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.14), worn);
    claw.position.set(side * 0.38, -0.42, 0);
    cradle.add(claw);
  }
  const cradleBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.7, 1.5), worn);
  cradleBack.position.set(-0.95, 0.25, 0);
  cradle.add(cradleBack);

  function restPosition() {
    return new THREE.Vector3(
      ANCHOR.x + CABLE * Math.sin(REST_ANGLE),
      ANCHOR.y - CABLE * Math.cos(REST_ANGLE),
      ANCHOR.z,
    );
  }
  function swingPosition(theta: number, target: THREE.Vector3) {
    return target.set(
      ANCHOR.x + CABLE * Math.sin(theta),
      ANCHOR.y - CABLE * Math.cos(theta),
      ANCHOR.z,
    );
  }
  let mode: CubeMode = "locked";
  let plateEast = true;
  let theta = REST_ANGLE,
    thetaRate = 0,
    buttonUsed = false;
  let recallTimer = -1,
    lostTimer = -1,
    releaseTimer = -1,
    plateFlash = 0;
  function placeCubeKinematic(position: THREE.Vector3) {
    cubeBody.fixedRotation = false;
    cubeBody.type = CANNON.Body.KINEMATIC;
    cubeBody.updateMassProperties();
    cubeBody.collisionResponse = true;
    cubeBody.position.set(position.x, position.y, position.z);
    cubeBody.velocity.set(0, 0, 0);
    cubeBody.angularVelocity.set(0, 0, 0);
    cubeBody.force.set(0, 0, 0);
    cubeBody.torque.set(0, 0, 0);
    cubeBody.quaternion.set(0, 0, 0, 1);
    cubeBody.previousPosition.copy(cubeBody.position);
    cubeBody.interpolatedPosition.copy(cubeBody.position);
    cubeBody.linearDamping = 0.01;
    cubeBody.angularDamping = 0.1;
    cubeBody.aabbNeedsUpdate = true;
    cubeBody.wakeUp();
    cubeMesh.position.copy(position);
    cubeMesh.quaternion.identity();
    cubeMesh.visible = true;
  }
  function lockCube() {
    mode = "locked";
    theta = REST_ANGLE;
    thetaRate = 0;
    placeCubeKinematic(restPosition());
    cradle.visible = true;
    cubeBody.quaternion.setFromEuler(0, 0, REST_ANGLE);
    cubeMesh.quaternion.set(
      cubeBody.quaternion.x,
      cubeBody.quaternion.y,
      cubeBody.quaternion.z,
      cubeBody.quaternion.w,
    );
    cradle.position.copy(restPosition());
    cradle.rotation.z = REST_ANGLE;
  }
  lockCube();
  const cradleAnchor = restPosition();
  for (const z of [-0.65, 0.65])
    box(
      [0.16, HEIGHT - cradleAnchor.y - 0.55, 0.16],
      [
        cradleAnchor.x,
        (HEIGHT + cradleAnchor.y + 0.55) / 2,
        cradleAnchor.z + z,
      ],
      steel,
      false,
    );

  // ---- Breakables: crowbar corrosion over the release button; pistol link on the swing cable.
  const breakables = createBreakables(scene, world);
  box([1.1, 1.1, 1.1], [BUTTON.x, 0.55, BUTTON.z], ship.dark);
  const buttonBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.4, 0.16, 20),
    steel,
  );
  buttonBase.position.set(BUTTON.x, BUTTON.y - 0.05, BUTTON.z);
  scene.add(buttonBase);
  const buttonCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.1, 20),
    new THREE.MeshStandardMaterial({
      color: 0x330806,
      emissive: 0xff5a20,
      emissiveIntensity: 1.4,
    }),
  );
  buttonCap.position.set(BUTTON.x, BUTTON.y + 0.06, BUTTON.z);
  scene.add(buttonCap);
  let buttonPress = 0;
  breakables.add(
    COVER,
    "crowbar",
    new THREE.Vector3(BUTTON.x, BUTTON.y + 0.28, BUTTON.z),
    new THREE.Vector3(0.85, 0.6, 0.85),
    (id) => {
      loot.cleared.add(id);
    },
  );
  const link = breakables.add(
    LINK,
    "pistol",
    ANCHOR.clone(),
    new THREE.Vector3(0.45, 1.1, 0.45),
    () => {
      if (mode !== "swinging") return;
      mode = "free";
      cubeBody.type = CANNON.Body.DYNAMIC;
      cubeBody.updateMassProperties();
      const speed = CABLE * thetaRate;
      cubeBody.velocity.set(
        speed * Math.cos(theta),
        speed * Math.sin(theta),
        0,
      );
      cubeBody.angularVelocity.set(0, 0, -thetaRate * 0.6);
      cubeBody.aabbNeedsUpdate = true;
      cubeBody.wakeUp();
    },
  );
  // Keep the entire beacon on the hit root, clear of the wall from either shore.
  const toggleHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0x220a12,
    emissive: LAUNCH_COLORS.east,
    emissiveIntensity: 1.8,
  });
  const toggleRingMaterial = new THREE.MeshBasicMaterial({
    color: LAUNCH_COLORS.east,
    toneMapped: false,
  });
  const dirToggle = breakables.add(
    "rust2:dir",
    "pistol",
    DIR_TOGGLE.clone(),
    new THREE.Vector3(0.8, 0.8, 0.8),
    undefined,
    {
      hits: 9999,
      showBox: false,
      decorate(root) {
        const backplate = new THREE.Mesh(
          new THREE.BoxGeometry(1.15, 1.15, 0.16),
          ship.dark,
        );
        backplate.position.z = 0.22;
        root.add(backplate);
        const toggleHead = new THREE.Mesh(
          new THREE.SphereGeometry(0.26, 14, 12),
          toggleHeadMaterial,
        );
        root.add(toggleHead);
        const toggleRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.46, 0.05, 8, 24),
          toggleRingMaterial,
        );
        toggleRing.position.z = 0.1;
        root.add(toggleRing);
      },
    },
  );
  breakables.restoreBroken(loot.cleared);
  const broken = (id: string) =>
    breakables.objects.some((item) => item.id === id && item.broken);
  function syncCable() {
    const top = new THREE.Vector3(ANCHOR.x, ANCHOR.y - 0.2, ANCHOR.z);
    const end =
      mode === "locked" || mode === "swinging"
        ? cubeMesh.position
            .clone()
            .add(
              new THREE.Vector3(0, 0.64, 0).applyQuaternion(
                cubeMesh.quaternion,
              ),
            )
        : top.clone().add(new THREE.Vector3(0, -1.6, 0));
    const span = end.clone().sub(top);
    cableMesh.visible = span.length() > 0.2;
    cableMesh.position.copy(top).add(span.clone().multiplyScalar(0.5));
    cableMesh.scale.set(1, Math.max(0.01, span.length()), 1);
    cableMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      span.clone().normalize(),
    );
  }
  function syncLink() {
    if (link.broken) return;
    const point =
      mode === "locked" || mode === "swinging"
        ? new THREE.Vector3(
            ANCHOR.x + CABLE * 0.55 * Math.sin(theta),
            ANCHOR.y - CABLE * 0.55 * Math.cos(theta),
            ANCHOR.z,
          )
        : new THREE.Vector3(ANCHOR.x, ANCHOR.y - 1.1, ANCHOR.z);
    link.root.position.copy(point);
    link.body.position.set(point.x, point.y, point.z);
    link.body.aabbNeedsUpdate = true;
  }
  syncLink();
  syncCable();

  const padMat = new BreakableMaterial("crowbar", LAUNCH_COLORS.east);
  padMat.roughness = 0.9;
  padMat.metalness = 0;
  padMat.name = "PinkTrampolineFabric";
  const weaveCanvas = document.createElement("canvas");
  weaveCanvas.width = weaveCanvas.height = 128;
  const weave = weaveCanvas.getContext("2d");
  if (!weave) throw new Error("Unable to draw the trampoline fabric");
  weave.fillStyle = "#ffffff";
  weave.fillRect(0, 0, 128, 128);
  weave.strokeStyle = "#b6b6b6";
  weave.lineWidth = 1;
  for (let line = 0; line < 128; line += 8) {
    weave.beginPath();
    weave.moveTo(line, 0);
    weave.lineTo(line, 128);
    weave.moveTo(0, line);
    weave.lineTo(128, line);
    weave.stroke();
  }
  const weaveTexture = new THREE.CanvasTexture(weaveCanvas);
  weaveTexture.colorSpace = THREE.SRGBColorSpace;
  weaveTexture.wrapS = weaveTexture.wrapT = THREE.RepeatWrapping;
  weaveTexture.repeat.set(6, 6);
  padMat.map = weaveTexture;
  const padGroup = new THREE.Group();
  padGroup.name = "RustChamber2Trampoline";
  padGroup.position.set(33, PAD_TOP, 11);
  scene.add(padGroup);
  const padBody = physics.addBox(
    { x: 8, y: 0.16, z: 8 },
    { x: 33, y: PAD_TOP - 0.08, z: 11 },
  );
  const padSurface = new THREE.Group();
  padSurface.name = "RustChamber2TrampolineSurface";
  padGroup.add(padSurface);
  const fabricGeometry = new THREE.PlaneGeometry(8, 8, 32, 32);
  fabricGeometry.rotateX(-Math.PI / 2);
  const fabric = new THREE.Mesh(fabricGeometry, padMat);
  fabric.name = "RustChamber2TrampolineFabric";
  fabric.castShadow = fabric.receiveShadow = true;
  padSurface.add(fabric);
  const frame = new THREE.Group();
  frame.name = "RustChamber2TrampolineFrame";
  frame.userData.teleportIgnore = true;
  padGroup.add(frame);
  function frameRod(from: THREE.Vector3, to: THREE.Vector3, radius = 0.11) {
    const span = to.clone().sub(from);
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, span.length(), 12),
      steel,
    );
    rod.position.copy(from).lerp(to, 0.5);
    rod.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      span.normalize(),
    );
    frame.add(rod);
  }
  for (const side of [-4.5, 4.5]) {
    frameRod(
      new THREE.Vector3(side, 0.05, -4.5),
      new THREE.Vector3(side, 0.05, 4.5),
    );
    frameRod(
      new THREE.Vector3(-4.5, 0.05, side),
      new THREE.Vector3(4.5, 0.05, side),
    );
  }
  for (const x of [-4.2, 4.2])
    for (const z of [-4.2, 4.2]) {
      frameRod(
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, -5.35, z),
        0.13,
      );
      frameRod(
        new THREE.Vector3(x, -1.5, z),
        new THREE.Vector3(x * 0.65, 0, z),
        0.07,
      );
    }
  const coilCurve = new THREE.CatmullRomCurve3(
    Array.from({ length: 33 }, (_, index) => {
      const t = index / 32,
        angle = t * Math.PI * 8;
      return new THREE.Vector3(
        t * 0.5,
        Math.cos(angle) * 0.05,
        Math.sin(angle) * 0.05,
      );
    }),
  );
  const coilGeometry = new THREE.TubeGeometry(coilCurve, 32, 0.018, 5, false);
  for (const side of [-1, 1])
    for (let index = 0; index < 9; index++) {
      const along = -3.6 + index * 0.9;
      for (const axis of ["x", "z"] as const) {
        const spring = new THREE.Mesh(coilGeometry, steel);
        spring.name = "RustChamber2TrampolineSpring";
        spring.position.set(
          axis === "x" ? side * 4 : along,
          0,
          axis === "z" ? side * 4 : along,
        );
        spring.rotation.y =
          axis === "x"
            ? side > 0
              ? 0
              : Math.PI
            : side > 0
              ? -Math.PI / 2
              : Math.PI / 2;
        frame.add(spring);
      }
    }
  let lastPadDeformation = 0;
  function deformTrampoline(offset: number) {
    if (offset === lastPadDeformation) return;
    const positions = fabricGeometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index) / 4,
        z = positions.getZ(index) / 4;
      const weight = Math.max(0, (1 - x * x) * (1 - z * z));
      positions.setY(index, offset * weight);
    }
    positions.needsUpdate = true;
    fabricGeometry.computeVertexNormals();
    lastPadDeformation = offset;
  }
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let padPulseTime = 2;
  function pulsePad() {
    plateFlash = 1;
    padPulseTime = 0;
    padMat.hit(1);
    if (!preview) playSfx("bounce", 0.2);
  }
  const padLight = new THREE.PointLight(LAUNCH_COLORS.east, 0, 10, 2);
  padLight.position.set(0, 0.8, 0);
  padGroup.add(padLight);
  function syncLaunchAppearance() {
    const color = plateEast ? LAUNCH_COLORS.east : LAUNCH_COLORS.west;
    toggleHeadMaterial.emissive.setHex(color);
    toggleRingMaterial.color.setHex(color);
    padMat.color.setHex(color);
    padMat.setGlowColor(color);
    padLight.color.setHex(color);
  }
  syncLaunchAppearance();
  const damageToggle = dirToggle.damage;
  dirToggle.damage = (amount, weapon) => {
    if (!damageToggle(amount, weapon)) return false;
    plateEast = !plateEast;
    syncLaunchAppearance();
    say(
      plateEast ? "Trampoline launches east." : "Trampoline launches west.",
      2,
    );
    return true;
  };
  function launchVelocity(
    x: number,
    y: number,
    z: number,
    gravity: number,
    targetY: number,
  ) {
    // Fixed 45° elevation; solve the speed for the target ledge.
    const target = plateEast ? LAUNCH_TARGET_X : WEST_LAUNCH_X;
    const range = Math.max(10, Math.abs(target - x));
    const climb = targetY - y;
    const speed = Math.sqrt(
      (gravity * range * range) / Math.max(1, range - climb),
    );
    const horizontalSpeed = speed * Math.SQRT1_2;
    return new THREE.Vector3(
      (plateEast ? 1 : -1) * horizontalSpeed,
      horizontalSpeed,
      ((11 - z) * horizontalSpeed) / range,
    );
  }
  function launchCube() {
    cubeBody.linearDamping = 0.01;
    cubeBody.fixedRotation = true;
    cubeBody.quaternion.set(0, 0, 0, 1);
    cubeBody.angularVelocity.set(0, 0, 0);
    cubeBody.updateMassProperties();
    const launch = launchVelocity(
      cubeBody.position.x,
      cubeBody.position.y,
      cubeBody.position.z,
      Math.abs(PHYSICS.gravity),
      0.5,
    );
    cubeBody.velocity.set(launch.x, launch.y, launch.z);
    cubeBody.wakeUp();
    mode = "launched";
    pulsePad();
  }

  // ---- East ledge: floor plate for the load, locked door, chest alcove.
  const floorPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.45, 0.12, 24),
    new THREE.MeshStandardMaterial({
      color: 0x3a434a,
      metalness: 0.5,
      roughness: 0.6,
    }),
  );
  floorPlate.position.copy(FLOOR_PLATE);
  scene.add(floorPlate);
  floorPlate.name = "RustChamber2FloorPlate";
  const floorRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.08, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xff9a4a, toneMapped: false }),
  );
  floorRing.rotation.x = Math.PI / 2;
  floorRing.position.set(FLOOR_PLATE.x, 0.08, FLOOR_PLATE.z);
  scene.add(floorRing);
  // ---- Glass cradle door on the spawn wall: two panes parting sideways into the wall pockets.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe8f2,
    transparent: true,
    opacity: 0.18,
    roughness: 0.08,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const doorL = new THREE.Group();
  doorL.name = "RustChamber2GlassDoorL";
  const doorR = new THREE.Group();
  doorR.name = "RustChamber2GlassDoorR";
  for (const [group, zc] of [
    [doorL, 9.55],
    [doorR, 12.45],
  ] as const) {
    group.position.set(-0.2, 0, zc);
    scene.add(group);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.5, 2.9), glassMat);
    pane.position.y = 2.25;
    group.add(pane);
    for (const edge of [-1.45, 1.45]) {
      const stile = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 4.5, 0.18),
        steel,
      );
      stile.position.set(0, 2.25, edge);
      group.add(stile);
    }
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 6.4), steel);
  header.position.set(0, 4.75, 11);
  scene.add(header);
  const glassBody = physics.addBox(
    { x: 0.3, y: 4.5, z: 5.8 },
    { x: 0, y: 2.25, z: 11 },
  );
  let doorLift = 0;
  function updateGlassDoor(frame: number, open: boolean) {
    doorLift = THREE.MathUtils.damp(doorLift, open ? 1 : 0, 3, frame);
    doorL.position.z = 9.55 - 2.95 * doorLift;
    doorR.position.z = 12.45 + 2.95 * doorLift;
    if (open && doorLift > 0.9 && glassBody.world === world)
      world.removeBody(glassBody);
    if (!open && doorLift < 0.1 && glassBody.world !== world) {
      world.addBody(glassBody);
      glassBody.aabbNeedsUpdate = true;
    }
  }
  const alcoveLight = new THREE.PointLight(0xc2e3d8, 14, 9);
  alcoveLight.position.set(-3, 3.6, 11);
  scene.add(alcoveLight);
  // Glowing lock wire: door frame, along the south wall across the rift, then a floor run
  // into the cube's floor plate - it burns green once the plate is loaded.
  const wireCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.45, 4.4, 11),
    new THREE.Vector3(0.45, 2.6, 8),
    new THREE.Vector3(0.45, 2.6, 0.6),
    new THREE.Vector3(20, 2.6, 0.5),
    new THREE.Vector3(33, 2.35, 0.5),
    new THREE.Vector3(50, 2.6, 0.5),
    new THREE.Vector3(63.4, 2.6, 0.6),
    new THREE.Vector3(63.4, 0.12, 0.8),
    new THREE.Vector3(61, 0.12, 2.0),
    new THREE.Vector3(FLOOR_PLATE.x, 0.12, 4.0),
    new THREE.Vector3(FLOOR_PLATE.x, 0.12, FLOOR_PLATE.z - 1.7),
  ]);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x35e0ff,
    toneMapped: false,
    transparent: true,
    opacity: 0.85,
  });
  const wire = new THREE.Mesh(
    new THREE.TubeGeometry(wireCurve, 120, 0.035, 6, false),
    wireMat,
  );
  wire.name = "RustChamber2LockWire";
  scene.add(wire);

  const resetConsole = createShipTerminal(
    signTexture("REBUILD", ["RESET THE BAY"], "#7dbfc9"),
  );
  resetConsole.root.name = "RustChamber2RebuildControl";
  resetConsole.root.position.set(1.1, 1.1, 15);
  resetConsole.root.rotation.y = -Math.PI / 2;
  scene.add(resetConsole.root);
  box([0.16, 1.15, 0.8], [0.6, 1.35, 15], ship.dark);
  scene.add(new THREE.HemisphereLight(0xffd8b2, 0x65503b, 2.4));
  const key = new THREE.DirectionalLight(0xd7dfe7, 1.8);
  key.position.set(-4, 12, 6);
  scene.add(key);
  const amber = new THREE.MeshStandardMaterial({
    color: 0xffa45c,
    emissive: 0xff781f,
    emissiveIntensity: 2.5,
    roughness: 0.35,
    metalness: 0.2,
  });
  for (const north of [true, false]) {
    for (const x of [5, 15, 27, 39, 51, 61]) {
      const housing = box(
        [3.8, 0.24, 0.14],
        [x, 3.05, north ? 0.09 : DEPTH - 0.09],
        dark,
        false,
      );
      housing.userData.teleportIgnore = true;
      const fixture = box(
        [3.5, 0.09, 0.055],
        [x, 3.05, north ? 0.18 : DEPTH - 0.18],
        amber,
        false,
      );
      fixture.name = "RustChamber2OrangeWallFixture";
      fixture.userData.teleportIgnore = true;
    }
    for (const x of [10, 32, 55]) {
      const lamp = new THREE.PointLight(0xffa45c, 70, 30, 2);
      lamp.name = "RustChamber2OrangeWallLight";
      lamp.position.set(x, 3.4, north ? 1.6 : DEPTH - 1.6);
      scene.add(lamp);
    }
  }

  // ---- Interaction: button, cube carry, rebuild console.
  function near(point: THREE.Vector3, radius = 2.2) {
    return (
      Math.hypot(
        player.body.position.x - point.x,
        player.body.position.z - point.z,
      ) < radius
    );
  }
  function nearCube() {
    return (
      near(cubeMesh.position, 2.1) &&
      Math.abs(player.body.position.y - cubeMesh.position.y) < 2.4
    );
  }
  function holding() {
    return mode === "carried";
  }
  function canGrab() {
    return (
      (mode === "parked" || mode === "placed") &&
      player.isEnabled() &&
      player.getHealth() > 0 &&
      player.getState().isOnGround &&
      !holding()
    );
  }
  function grabCube() {
    mode = "carried";
    loot.cleared.delete(PLACED);
    cubeBody.type = CANNON.Body.KINEMATIC;
    cubeBody.updateMassProperties();
    cubeBody.collisionResponse = false;
    cubeBody.velocity.set(0, 0, 0);
    cubeBody.angularVelocity.set(0, 0, 0);
    cubeBody.quaternion.set(0, 0, 0, 1);
    player.setBoxHandling(true, true);
  }
  function releaseCube() {
    player.setBoxHandling(false);
    const dx = Math.max(0, Math.abs(cubeBody.position.x - FLOOR_PLATE.x) - 0.5);
    const dz = Math.max(0, Math.abs(cubeBody.position.z - FLOOR_PLATE.z) - 0.5);
    const onPlate =
      Math.hypot(dx, dz) <= 1.5 && Math.abs(cubeBody.position.y - 0.62) < 1.5;
    cubeBody.collisionResponse = true;
    cubeBody.velocity.set(0, 0, 0);
    cubeBody.angularVelocity.set(0, 0, 0);
    if (onPlate) {
      placeOnFloorPlate();
      loot.cleared.add(PLACED);
      playSfx("servo", 0.2);
      beginPresentation("placed");
    } else {
      mode = "free";
      cubeBody.fixedRotation = true;
      cubeBody.type = CANNON.Body.DYNAMIC;
      cubeBody.updateMassProperties();
      cubeBody.aabbNeedsUpdate = true;
      cubeBody.wakeUp();
    }
  }
  function placeOnFloorPlate() {
    placeCubeKinematic(
      new THREE.Vector3(FLOOR_PLATE.x, FLOOR_PLATE.y + 0.56, FLOOR_PLATE.z),
    );
    cubeBody.type = CANNON.Body.STATIC;
    cubeBody.updateMassProperties();
    mode = "placed";
    cradle.visible = false;
  }
  function releaseFromCradle(present = false) {
    if (mode !== "locked") {
      say("The cradle is already open.", 2);
      return;
    }
    mode = "swinging";
    theta = REST_ANGLE;
    thetaRate = 0;
    cradle.visible = false;
    buttonPress = 1;
    buttonUsed = true;
    if (!preview) playSfx("servo", 0.18);
    if (present) beginPresentation("release");
  }
  function resetChamber() {
    endPresentation();
    melting = null;
    player.setInputLocked(false);
    if (holding()) player.setBoxHandling(false);
    loot.cleared.clear();
    breakables.reset();
    buttonUsed = false;
    buttonPress = 0;
    recallTimer = -1;
    lostTimer = -1;
    releaseTimer = -1;
    plateFlash = 0;
    padPulseTime = 2;
    padSurface.position.y = 0;
    padSurface.scale.set(1, 1, 1);
    deformTrampoline(0);
    plateEast = true;
    syncLaunchAppearance();
    doorLift = 0;
    doorL.position.z = 9.55;
    doorR.position.z = 12.45;
    if (glassBody.world !== world) world.addBody(glassBody);
    lockCube();
    syncLink();
    syncCable();
    teleportPlayer(
      player,
      { x: SPAWN.x, y: player.radius, z: SPAWN.z },
      SPAWN.yaw,
    );
    caption.classList.add("hidden");
    captionTime = 0;
    hidePrompt();
    say("Room reset.", 2);
  }
  function hidePrompt() {
    if (ownsPrompt) prompt?.classList.add("hidden");
    ownsPrompt = false;
  }
  function onKey(event: KeyboardEvent) {
    if (
      (event.code !== "KeyE" && event.code !== "Space") ||
      event.repeat ||
      event.defaultPrevented ||
      !active ||
      paused ||
      disposed ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open") ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          'button, input, textarea, select, [contenteditable="true"]',
        ))
    )
      return;
    if (presentation) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (presentation.time > 0.15) endPresentation();
      return;
    }
    if (event.code !== "KeyE") return;
    if (!playable()) return;
    if (holding()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      releaseCube();
      return;
    }
    if (near(resetConsole.root.position, 1.9) && player.body.position.y < 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resetChamber();
      return;
    }
    if (near(BUTTON, 1.9) && player.body.position.y < 2 && !broken(COVER)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      say("Break the orange corrosion first.", 2);
      return;
    }
    if (near(BUTTON, 1.9) && player.body.position.y < 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      releaseFromCradle(true);
      return;
    }
    if (canGrab() && nearCube()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      grabCube();
    }
  }
  if (!preview) window.addEventListener("keydown", onKey, true);
  function playable() {
    return (
      active &&
      !paused &&
      !disposed &&
      !presentation &&
      !melting &&
      player.isEnabled() &&
      player.getHealth() > 0
    );
  }

  // ---- Reward chest behind the alcove door.
  const complete = () => mode === "placed";
  const chest = createRewardChest(
    {
      scene,
      world,
      player,
      position: new THREE.Vector3(-3.5, -0.02, 11),
      yaw: -Math.PI / 2,
      reward: "keycard",
      style: "crew",
      initialCollected: loot.rewardCollected,
      unlocked: complete,
      canInteract: playable,
      onCollect: () => {
        onKeycardCollected?.();
        loot.rewardCollected = true;
        return true;
      },
    },
    modelLoader,
  );
  if (loot.rewardCollected) chest.setCollected();
  if (loot.cleared.has(PLACED) || loot.rewardCollected) {
    placeOnFloorPlate();
    updateGlassDoor(10, true);
    syncLink();
    syncCable();
  }
  const visitUI =
    !preview && onRestart
      ? createCameraVisitUI({
          title: "Rust chamber 2",
          player,
          hasReturnMarker,
          onRestart,
          canInteract: playable,
        })
      : null;
  visitUI?.setVisible(active);
  visitUI?.registerLockedExit(lockedExit.group);

  let melting: {
    time: number;
    position: THREE.Vector3;
    camera: THREE.Vector3;
  } | null = null;
  function applyCinematicCamera() {
    if (melting) {
      const focus = melting.position.clone().add(new THREE.Vector3(0, 0.4, 0));
      camera.position
        .copy(melting.camera)
        .lerp(
          focus.clone().add(new THREE.Vector3(2.8, 2, -3.4)),
          THREE.MathUtils.smoothstep(melting.time, 0, 0.5),
        );
      camera.lookAt(focus);
      return true;
    }
    const state = presentation;
    if (!state) return false;
    const duration = state.kind === "release" ? 2.6 : 3.2;
    const shot = new THREE.PerspectiveCamera();
    const focus = cubeMesh.position.clone();
    if (state.kind === "release") {
      shot.position.set(ANCHOR.x + 10, 5.5, CHASM_Z + 6);
      if (reducedMotion?.matches)
        focus.copy(ANCHOR).add(new THREE.Vector3(0, -CABLE * 0.55, 0));
      else focus.y += 0.3;
    } else {
      const across = reducedMotion?.matches
        ? state.time < 0.8
          ? 0
          : 1
        : THREE.MathUtils.smootherstep(state.time, 0.5, 1.5);
      shot.position.lerpVectors(
        new THREE.Vector3(FLOOR_PLATE.x - 4, 3.2, FLOOR_PLATE.z + 5),
        new THREE.Vector3(8, 3.4, 16),
        across,
      );
      focus.lerp(new THREE.Vector3(-0.2, 2.2, 11), across);
    }
    shot.lookAt(focus);
    const blend = reducedMotion?.matches
      ? 1
      : THREE.MathUtils.smootherstep(state.time, 0, 0.35) *
        (1 -
          THREE.MathUtils.smootherstep(state.time, duration - 0.35, duration));
    camera.position.lerpVectors(state.position, shot.position, blend);
    camera.quaternion.slerpQuaternions(state.rotation, shot.quaternion, blend);
    camera.fov = THREE.MathUtils.lerp(state.fov, 56, blend);
    camera.updateProjectionMatrix();
    return true;
  }

  function startMelt() {
    endPresentation();
    if (holding()) releaseCube();
    const p = player.body.position;
    melting = {
      time: skipCinematics ? 3.2 : 0,
      position: new THREE.Vector3(p.x, p.y, p.z),
      camera: camera.position.clone(),
    };
    player.clearInput();
    player.setInputLocked(true);
    player.body.velocity.set(0, 0, 0);
    hidePrompt();
    visitUI?.setVisible(false);
  }
  function updateCubeLoss(frame: number) {
    if (
      (mode === "free" || mode === "launched") &&
      cubeBody.position.y < WATER_Y + 0.5
    ) {
      cubeMesh.visible = false;
      mode = "recycling";
      lostTimer = 4.5;
      cubeBody.type = CANNON.Body.KINEMATIC;
      cubeBody.updateMassProperties();
      cubeBody.collisionResponse = false;
      cubeBody.velocity.set(0, 0, 0);
      cubeBody.angularVelocity.set(0, 0, 0);
      say("Lost in the rust water. Replacing the counterweight.", 3);
      return;
    }
    if (mode === "free" || mode === "launched") {
      const speed = cubeBody.velocity.length();
      const settled =
        speed < 0.6 && cubeBody.position.y > 0.3 && cubeBody.position.y < 1.8;
      if (settled && cubeBody.position.x > (CHASM_X0 + CHASM_X1) / 2) {
        mode = "parked";
      } else if (settled && recallTimer < 0) {
        recallTimer = 4;
      }
    }
    if (recallTimer > 0) {
      recallTimer -= frame;
      if (recallTimer <= 0) {
        recallTimer = -1;
        recradle();
        if (buttonUsed) releaseTimer = 1.4;
      }
    }
    if (lostTimer > 0) {
      lostTimer -= frame;
      if (lostTimer <= 0) {
        lostTimer = -1;
        recradle();
        if (buttonUsed) releaseTimer = 1.4;
      }
    }
    if (releaseTimer > 0) {
      releaseTimer -= frame;
      if (releaseTimer <= 0) {
        releaseTimer = -1;
        releaseFromCradle();
      }
    }
  }
  // Respawning the load also re-forges a severed swing link, keeping the puzzle replayable.
  function recradle() {
    lockCube();
    if (link.broken) {
      breakables.reset();
      breakables.restoreBroken(loot.cleared);
    }
    syncLink();
    syncCable();
  }

  const swingTarget = new THREE.Vector3();
  const unregisterCube = registerPhysicsActor(world, {
    body: cubeBody,
    beforePhysicsStep(dt) {
      if (mode === "swinging") {
        thetaRate += (PHYSICS.gravity / CABLE) * Math.sin(theta) * dt;
        thetaRate *= Math.exp(-0.012 * dt);
        theta += thetaRate * dt;
        swingPosition(theta, swingTarget);
        cubeBody.velocity.set(
          (swingTarget.x - cubeBody.position.x) / dt,
          (swingTarget.y - cubeBody.position.y) / dt,
          (swingTarget.z - cubeBody.position.z) / dt,
        );
        cubeBody.quaternion.setFromEuler(0, 0, theta);
        pivot.rotation.z = theta;
        cradle.visible = false;
      } else if (mode === "carried") {
        const p = player.body.position,
          yaw = player.getState().yaw;
        cubeBody.position.set(
          THREE.MathUtils.damp(
            cubeBody.position.x,
            p.x - Math.sin(yaw) * 1.35,
            18,
            dt,
          ),
          THREE.MathUtils.damp(cubeBody.position.y, p.y + 0.75, 18, dt),
          THREE.MathUtils.damp(
            cubeBody.position.z,
            p.z - Math.cos(yaw) * 1.35,
            18,
            dt,
          ),
        );
        cubeBody.velocity.set(0, 0, 0);
        cubeBody.aabbNeedsUpdate = true;
      }
      syncLink();
    },
    afterPhysicsStep() {
      if (mode === "free" || mode === "launched") {
        const supported = world.contacts.some(
          (contact) =>
            contact.enabled &&
            ((contact.bi === cubeBody && contact.ni.y < -0.6) ||
              (contact.bj === cubeBody && contact.ni.y > 0.6)),
        );
        const rolling = supported && cubeBody.position.y > 0;
        cubeBody.linearDamping = rolling ? 0.9 : 0.01;
        cubeBody.angularDamping = rolling ? 0.9 : 0.1;
        const onPad =
          mode === "free" &&
          world.contacts.some(
            (contact) =>
              contact.enabled &&
              ((contact.bi === cubeBody &&
                contact.bj === padBody &&
                contact.ni.y < -0.6) ||
                (contact.bj === cubeBody &&
                  contact.bi === padBody &&
                  contact.ni.y > 0.6)),
          );
        if (onPad) launchCube();
      }
      if (mode !== "recycling") {
        cubeMesh.position.set(
          cubeBody.position.x,
          cubeBody.position.y,
          cubeBody.position.z,
        );
        cubeMesh.quaternion.set(
          cubeBody.quaternion.x,
          cubeBody.quaternion.y,
          cubeBody.quaternion.z,
          cubeBody.quaternion.w,
        );
      }
      syncLink();
      syncCable();
    },
  });

  if (active) player.enable();
  return {
    roomId: "rust-chamber-2",
    scene,
    camera,
    player,
    physicsWorld: world,
    cutsceneManager: null,
    ready: chest.ready,
    chest,
    getPuzzleState: () => ({
      mode,
      theta,
      thetaRate,
      plateEast,
      presentation: presentation?.kind ?? null,
    }),
    getSceneId: () => "stage2-rust2",
    getMapLayout: () => cameraVisitMap(40),
    getMapSceneId: () => "scene40",
    getMusicTrack: () => "stealth-2" as const,
    activate() {
      active = true;
      ui.classList.remove("hidden");
      visitUI?.setVisible(true);
      player.clearInput();
      player.enable();
    },
    controlsReady: playable,
    isCinematic: () => !!melting || !!presentation,
    get ownsWeaponInput() {
      return !!melting || !!presentation;
    },
    getCinematicState: () =>
      melting || presentation
        ? {
            ...player.getState(),
            isMoving: false,
            actionRequest: null,
            crouching: false,
            sprinting: false,
            sliding: false,
            climbing: false,
            boxHandling: false,
          }
        : null,
    getCinematicPose: () =>
      melting || presentation
        ? {
            clip: "Idle_Loop" as const,
            time: melting?.time ?? presentation!.time,
            loop: true,
          }
        : null,
    getHologramTransition: () =>
      melting
        ? {
            blend: 0,
            opacity: 1 - THREE.MathUtils.smoothstep(melting.time, 1.8, 2.8),
            time: melting.time,
            melt: THREE.MathUtils.clamp(melting.time / 2.8, 0, 1),
          }
        : null,
    getCinematicDelta: () => lastDelta,
    applyCinematicCamera,
    getDamageTargets: () => {
      if (!playable()) return [];
      // The swing link is only a real target while the load is actually swinging.
      return breakables
        .getDamageTargets()
        .filter((item) => item !== link || mode === "swinging");
    },
    canPlaceMarker(position: { x: number; y: number; z: number }) {
      if (position.y - player.radius <= WATER_Y + 0.05)
        return "Rust water cannot hold a crystal marker.";
      let supported = false;
      world.raycastAll(
        new CANNON.Vec3(position.x, position.y + 0.05, position.z),
        new CANNON.Vec3(
          position.x,
          position.y - player.radius - 0.12,
          position.z,
        ),
        { skipBackfaces: true, checkCollisionResponse: true },
        (hit) => {
          if (
            hit.body !== player.body &&
            hit.body?.type === CANNON.Body.STATIC &&
            hit.hitNormalWorld.y > 0.6
          )
            supported = true;
        },
      );
      return supported
        ? null
        : "Place the crystal on solid ground, not over the rust water.";
    },
    // The platform banks a thrown crystal across the rift: same solve as the cube launch,
    // but under the throw ballistics (16 m/s²) so the marker lands mid-ledge.
    getThrowBounce: (
      point: THREE.Vector3,
      normal: THREE.Vector3,
      velocity: THREE.Vector3,
    ) => {
      if (!playable() || normal.y <= 0.6 || velocity.y >= 0) return null;
      if (
        point.x < PAD.minX ||
        point.x > PAD.maxX ||
        point.z < PAD.minZ ||
        point.z > PAD.maxZ ||
        point.y < PAD_TOP - 0.4 ||
        point.y > PAD_TOP + 0.4
      )
        return null;
      pulsePad();
      return launchVelocity(
        point.x,
        point.y,
        point.z,
        TELEPORT_THROW.gravity,
        0.3,
      );
    },
    setGogglesActive: breakables.setHighlighted,
    setMenuPaused(value: boolean) {
      paused = value;
      if (value) lastDelta = 0;
      player.clearInput();
    },
    updateInteractionFocus() {
      if (!playable()) {
        hidePrompt();
        return;
      }
      const grounded = player.body.position.y < 2;
      const text = holding()
        ? "E / Set the counterweight down"
        : canGrab() && nearCube()
          ? "E / Pick up the counterweight"
          : grounded && near(BUTTON, 1.9)
            ? broken(COVER)
              ? "E / Release the cradle"
              : "E / Sealed by corrosion"
            : grounded && near(resetConsole.root.position, 1.9)
              ? "E / Rebuild chamber"
              : "";
      if (text && prompt) {
        prompt.textContent = inputHint(text);
        prompt.classList.remove("hidden");
        ownsPrompt = true;
      } else hidePrompt();
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || paused || document.hidden) return;
      const frame = Number.isFinite(dt)
        ? THREE.MathUtils.clamp(dt, 0, PHYSICS.maxFrameTime)
        : 0;
      if (!active && !preview) return;
      lastDelta = frame;
      clock += frame;
      rustWater.update(clock);
      if (!melting && !preview) physics.step(frame, player, thirdPerson);
      breakables.update(frame);

      updateCubeLoss(frame);

      if (!preview) {
        const p = player.body.position;
        if (
          !melting &&
          ((p.x > CHASM_X0 - 1.8 &&
            p.x < CHASM_X1 + 1.8 &&
            p.z > 0.2 &&
            p.z < DEPTH - 0.2 &&
            p.y - player.radius <= WATER_Y) ||
            p.y < CHASM_FLOOR_Y - 4)
        ) {
          startMelt();
        }
        if (melting) {
          melting.time += frame;
          player.body.position.y =
            melting.position.y - Math.min(0.35, melting.time * 0.13);
          if (melting.time >= 3.2) {
            melting = null;
            player.setInputLocked(false);
            teleportPlayer(
              player,
              { x: SPAWN.x, y: player.radius, z: SPAWN.z },
              SPAWN.yaw,
            );
            visitUI?.setVisible(active);
          }
        }
        updateGlassDoor(
          frame,
          complete() &&
            (!presentation ||
              presentation.kind !== "placed" ||
              presentation.time >= 1),
        );
        chest.update(frame);
        visitUI?.update();
        captionTime = Math.max(0, captionTime - frame);
        if (!captionTime) caption.classList.add("hidden");
        if (presentation) {
          presentation.time += frame;
          if (
            presentation.time >= (presentation.kind === "release" ? 2.6 : 3.2)
          )
            endPresentation();
        }
      }

      // Presentation polish.
      padPulseTime = Math.min(2, padPulseTime + frame);
      const padOffset =
        reducedMotion?.matches || padPulseTime >= 1.5
          ? 0
          : -0.38 * Math.exp(-3.5 * padPulseTime) * Math.sin(14 * padPulseTime);
      deformTrampoline(padOffset);
      plateFlash = Math.max(0, plateFlash - frame * 2);
      padLight.intensity = 2 + Math.sin(clock * 2.4) * 1.2 + plateFlash * 30;
      padMat.update(frame);
      wireMat.opacity = 0.5 + 0.3 * Math.sin(clock * 2.2);
      wireMat.color.setHex(complete() ? 0x57ff9f : 0x35e0ff);
      buttonCap.position.y = BUTTON.y + 0.06 - buttonPress * 0.07;
      buttonPress = Math.max(0, buttonPress - frame * 3);
      const loaded = complete();
      (floorRing.material as THREE.MeshBasicMaterial).color.setHex(
        loaded ? 0x57ff9f : 0xff9a4a,
      );
      floorRing.rotation.z = clock * (loaded ? 1.6 : 0.4);
      (buttonCap.material as THREE.MeshStandardMaterial).emissive.setHex(
        loaded || buttonUsed ? 0x2fdd6a : 0xff5a20,
      );
    },
    syncProgress() {
      if (broken(COVER) !== loot.cleared.has(COVER)) {
        const wasHolding = holding();
        if (wasHolding) player.setBoxHandling(false);
        breakables.reset();
        breakables.restoreBroken(loot.cleared);
        buttonUsed = false;
        recallTimer = -1;
        lostTimer = -1;
        releaseTimer = -1;
        lockCube();
      }
      syncLink();
      if (
        preview &&
        (loot.cleared.has(PLACED) || loot.rewardCollected) &&
        mode !== "placed"
      ) {
        placeOnFloorPlate();
        syncCable();
      }
      if (preview) updateGlassDoor(0.1, complete());
      if (loot.rewardCollected) chest.setCollected();
    },
    minimap: {
      bounds: { minX: -6, maxX: WIDTH, minZ: 0, maxZ: DEPTH },
      floor: 0,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      endPresentation();
      melting = null;
      hidePrompt();
      window.removeEventListener("keydown", onKey, true);
      visitUI?.dispose();
      chest.dispose();
      breakables.dispose();
      if (holding()) player.setBoxHandling(false);
      unregisterCube();
      ui.remove();
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}
