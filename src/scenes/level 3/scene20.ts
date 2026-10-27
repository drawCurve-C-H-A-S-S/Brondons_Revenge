import * as THREE from "three";
import * as CANNON from "cannon-es";
import { inputHint } from "../../scripts/player/gamepadInput.js";
import {
  createScenePhysics,
  PHYSICS,
} from "../../helpers/physics/scenePhysics.js";
import {
  roomBox,
  disposeRoom,
  createSlidingPortal,
  fitRoomProp,
} from "../../scripts/global/shipRoom.js";
import {
  loadToolModel,
  loadSubjectModel,
  loadTexture,
} from "../../core/loader.js";
import hideoutImageUrl from "../../assets/textures/sudoers-hideout.png?url";
import facilityPreviewUrl from "../../assets/textures/fla-screen-preview.png?url";
import { createPlayer } from "../../scripts/player/player.js";
import {
  createChairSeating,
  type ChairSeat,
} from "../../scripts/player/chairSeating.js";
import type { RescueArrival } from "../../scripts/global/rescueSite.js";
import {
  createFacilityOffice,
  FACILITY_OFFICE,
} from "../../scripts/level-3/facilityOffice.js";
import { createFacilityBrowser } from "../../scripts/global/facilityBrowser.js";
import { createHoldToSkip } from "../../scripts/global/holdToSkip.js";
import { createFacilityDeck } from "../../scripts/level-3/facilityDeck.js";
import { createFacilityCoreDisplay } from "../../scripts/level-3/facilityCore.js";
import {
  FACILITY,
  FACILITY_WINDOW_ANGLES,
  createFacilityDomeGeometry,
  createFacilityMezzanineShape,
} from "../../scripts/global/facilityArchitecture.js";

/**
 * Scene 20 — AI Research Facility interior (Level 3).
 *
 * Ground floor: a laboratory / control room with a central staircase up to the
 * mezzanine.
 *
 * Second floor: a glass office. E peeks at the five seated students; their
 * discovery of Brondon triggers the finale (scene21).
 */

// The stair climbs north from the atrium to the mezzanine edge, centred in the room.
const STAIR_RUN = 9;

export function createScene({
  entryState,
  fromExterior = false,
  onReturn,
  onRespawn,
  onFinished,
  loadModel = loadToolModel,
  loadStudents = loadSubjectModel,
}: {
  entryState?: RescueArrival;
  fromExterior?: boolean;
  onReturn?: (state: RescueArrival) => void;
  onRespawn?: () => void;
  onFinished: (state: RescueArrival) => void;
  loadModel?: typeof loadToolModel;
  loadStudents?: typeof loadSubjectModel;
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc3dce0);
  scene.fog = new THREE.Fog(0xc3dce0, 38, 85);
  const physics = createScenePhysics(),
    physicsWorld = physics.world;
  let disposed = false;
  let browser: ReturnType<typeof createFacilityBrowser> | null = null;

  // The sinister exterior conceals the students' comfortable, bright laboratory.
  const wall = new THREE.MeshStandardMaterial({
    color: 0xe0eaec,
    metalness: 0.25,
    roughness: 0.7,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x2e6076,
    metalness: 0.35,
    roughness: 0.6,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x22343c,
    metalness: 0.5,
    roughness: 0.5,
  });
  const pale = new THREE.MeshStandardMaterial({
    color: 0xe8eef0,
    metalness: 0.25,
    roughness: 0.5,
  });
  const stripe = new THREE.MeshStandardMaterial({
    color: 0xb0e5df,
    emissive: 0x55b9b1,
    emissiveIntensity: 0.55,
  });

  const box = (
    s: [number, number, number],
    p: [number, number, number],
    m: THREE.Material = wall,
    solid = true,
  ) => roomBox(scene, physics, s, p, m, solid);

  // ── Ground-floor shell (tall room; mezzanine slab splits off the 2nd floor) ──
  const W = 14,
    D = FACILITY.radius,
    CEIL = 8;
  const labFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(D, D, 0.4, 96),
    floorMat,
  );
  labFloor.name = "FacilityRoundLabFloor";
  labFloor.position.y = -0.2;
  labFloor.receiveShadow = true;
  scene.add(labFloor);
  physics.addBox(
    { x: D * 2 + 4, y: 0.4, z: D * 2 + 4 },
    { x: 0, y: -0.2, z: 0 },
  );
  for (let i = 1; i < 48; i++) {
    const angle = (i * Math.PI * 2) / 48;
    if (
      Math.abs(Math.sin(angle)) * D < FACILITY.doorWidth / 2 + 0.2 &&
      Math.cos(angle) > 0
    )
      continue;
    const body = physics.addBox(
      { x: 3.25, y: 8, z: 0.5 },
      { x: Math.sin(angle) * (D - 0.2), y: 4, z: Math.cos(angle) * (D - 0.2) },
    );
    body.quaternion.setFromEuler(0, angle, 0);
    body.aabbNeedsUpdate = true;
  }
  const entrance = createSlidingPortal(
    scene,
    physics,
    { x: 0, y: 0, z: D, yaw: Math.PI },
    FACILITY.entranceSpan,
    FACILITY.entranceHeight,
    "AI RESEARCH / ACCESS",
    { doorHeight: 3.2, landingFloor: false },
  );
  entrance.group.name = "FacilityEntranceDoor";
  const entranceVoid = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3.2),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  entranceVoid.name = "FacilityDoorwayBlackVoid";
  entranceVoid.position.set(0, 1.6, -0.18);
  entrance.group.add(entranceVoid);
  if (fromExterior) entrance.openImmediately();
  const domeCeiling = new THREE.Mesh(
    createFacilityDomeGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0xe0eaec,
      metalness: 0.25,
      roughness: 0.7,
      side: THREE.BackSide,
    }),
  );
  domeCeiling.name = "FacilityVillainDomeCeiling";
  domeCeiling.position.y = 0;
  scene.add(domeCeiling);
  physics.addBox(
    { x: W * 2, y: 0.4, z: D * 2 },
    { x: 0, y: FACILITY.radius + 0.2, z: 0 },
  );
  const MEZZ_Y = 4,
    MEZZ_EDGE = FACILITY_OFFICE.front;
  const mezzanineShape = createFacilityMezzanineShape(MEZZ_EDGE);
  const mezzanine = new THREE.Mesh(
    new THREE.ExtrudeGeometry(mezzanineShape, {
      depth: 0.4,
      bevelEnabled: false,
      curveSegments: 32,
    }),
    floorMat,
  );
  mezzanine.name = "FacilityCurvedMezzanine";
  mezzanine.rotation.x = -Math.PI / 2;
  mezzanine.position.y = MEZZ_Y - 0.2;
  mezzanine.castShadow = mezzanine.receiveShadow = true;
  scene.add(mezzanine);
  // The slab collider uses the rendered outline; the entrance atrium stays open.
  const outline = mezzanineShape.getPoints(32).slice(0, -1);
  const count = outline.length;
  const mezzanineBody = new CANNON.Body({
    mass: 0,
    material: physics.solidMaterial,
    position: new CANNON.Vec3(0, MEZZ_Y, 0),
    shape: new CANNON.ConvexPolyhedron({
      vertices: [-0.2, 0.2].flatMap((y) =>
        outline.map((point) => new CANNON.Vec3(point.x, y, -point.y)),
      ),
      faces: [
        Array.from({ length: count }, (_, i) => count - 1 - i),
        Array.from({ length: count }, (_, i) => count + i),
        ...Array.from({ length: count }, (_, i) => [
          i,
          (i + 1) % count,
          count + (i + 1) % count,
          count + i,
        ]),
      ],
    }),
  });
  physicsWorld.addBody(mezzanineBody);
  const balconyGlass = new THREE.MeshPhysicalMaterial({
    color: 0xc5e8ed,
    transparent: true,
    opacity: 0.14,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mezzanineRadius = FACILITY.radius - 1.5;
  const guardStart = Math.acos(MEZZ_EDGE / mezzanineRadius);
  const guardArc = Math.PI * 2 - guardStart * 2;
  const guard = new THREE.Mesh(
    new THREE.CylinderGeometry(
      mezzanineRadius,
      mezzanineRadius,
      1.1,
      64,
      1,
      true,
      guardStart,
      guardArc,
    ),
    balconyGlass,
  );
  guard.name = "FacilityMezzaninePerimeterGuard";
  guard.position.y = FACILITY.officeFloor + 0.55;
  scene.add(guard);
  const guardTrimGeometry = new THREE.TorusGeometry(
    mezzanineRadius, 0.045, 6, 64, guardArc,
  );
  guardTrimGeometry.rotateX(-Math.PI / 2);
  guardTrimGeometry.rotateY(guardStart - Math.PI / 2);
  const guardTrim = new THREE.Mesh(guardTrimGeometry, pale);
  guardTrim.position.y = FACILITY.officeFloor + 1.1;
  scene.add(guardTrim);
  const guardSegments = 32;
  const guardHalfAngle = guardArc / (guardSegments * 2);
  for (let i = 0; i < guardSegments; i++) {
    const angle = guardStart + (i + 0.5) * guardArc / guardSegments;
    const radius = mezzanineRadius * Math.cos(guardHalfAngle);
    const body = physics.addBox(
      {
        x: 2 * mezzanineRadius * Math.sin(guardHalfAngle),
        y: 1.1,
        z: 0.06,
      },
      {
        x: Math.sin(angle) * radius,
        y: FACILITY.officeFloor + 0.55,
        z: Math.cos(angle) * radius,
      },
    );
    body.quaternion.setFromEuler(0, angle, 0);
    body.aabbNeedsUpdate = true;
  }
  const wingWidth = Math.sqrt(mezzanineRadius ** 2 - MEZZ_EDGE ** 2) - W;
  for (const side of [-1, 1]) {
    const x = side * (W + wingWidth / 2);
    const glass = box(
      [wingWidth, 3.5, 0.06],
      [x, FACILITY.officeFloor + 1.85, MEZZ_EDGE],
      balconyGlass,
    );
    glass.name = "FacilityMezzanineWingGlass";
    for (const y of [FACILITY.officeFloor + 0.08, 7.92])
      box([wingWidth, 0.12, 0.12], [x, y, MEZZ_EDGE], dark, false);
  }

  // Floor guide stripes
  for (const x of [-W + 0.24, W - 0.24])
    for (const z of [-12, -4, 8, 14])
      box([0.025, 0.08, 2.4], [x, 0.04, z], stripe, false);

  // ── Lighting (bright, daylight control room) ───────────────────────────────
  scene.add(new THREE.HemisphereLight(0xd8f2ff, 0x3a4a50, 2.3));
  const labLights: THREE.PointLight[] = [];
  const labLightPositions = [
    [-15, 6], [15, 6], [-12, -13], [12, -13],
  ] as const;
  for (const [lx, lz] of labLightPositions) {
    const light = new THREE.PointLight(0xd6f0ff, 32, 24);
    light.position.set(lx, 3.4, lz);
    scene.add(light);
    labLights.push(light);
  }
  const mezzLight = new THREE.PointLight(0xc7f3ec, 18, 25);
  mezzLight.position.set(0, MEZZ_Y + 3, -10);
  scene.add(mezzLight);
  // Soft green wash from the ceiling dome hologram above the core
  const domeGlow = new THREE.PointLight(0x9fe8d7, 24, 26);
  domeGlow.position.set(0, CEIL - 1.2, 0);
  scene.add(domeGlow);

  // ── Canvas texture helpers for the control-room decor ─────────────────────
  const planetTexture = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(256, 256, 40, 256, 256, 250);
    grad.addColorStop(0, "#d5fff0");
    grad.addColorStop(0.5, "#66c7ad");
    grad.addColorStop(1, "#173d48");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(256, 256, 250, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(205,255,238,0.8)";
    g.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      g.beginPath();
      g.moveTo(256 + Math.cos(a) * 60, 256 + Math.sin(a) * 60);
      g.lineTo(256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200);
      g.stroke();
    }
    g.strokeStyle = "rgba(225,255,248,0.9)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(256, 256, 120, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.arc(256, 256, 150, 0, Math.PI * 2);
    g.stroke();
    return new THREE.CanvasTexture(c);
  };
  const skylineTexture = () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const g = c.getContext("2d")!;
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#cfe8f2");
    sky.addColorStop(1, "#e8f4f8");
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = "#b9c8cf";
    for (let i = 0; i < 14; i++) {
      const w = 20 + ((i * 37) % 30),
        h = 60 + ((i * 53) % 120);
      g.fillRect(i * 36, 256 - h, w, h);
    }
    g.fillStyle = "#a8b8c0";
    for (let i = 0; i < 10; i++) {
      const w = 16 + ((i * 29) % 24),
        h = 40 + ((i * 41) % 90);
      g.fillRect(i * 50 + 10, 256 - h, w, h);
    }
    return new THREE.CanvasTexture(c);
  };

  // ── Ceiling dome with green holographic planet + concentric rings ─────────
  const domeDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5, 48),
    new THREE.MeshBasicMaterial({ map: planetTexture() }),
  );
  domeDisc.name = "FacilityHolographicPlanetDome";
  domeDisc.rotation.x = Math.PI / 2;
  domeDisc.position.set(0, CEIL - 0.06, 0);
  scene.add(domeDisc);
  const ringTrimMat = new THREE.MeshStandardMaterial({
    color: 0xc8dfe0,
    emissive: 0x306b70,
    emissiveIntensity: 0.8,
    metalness: 0.7,
    roughness: 0.35,
    side: THREE.DoubleSide,
  });
  for (const [inner, outer, y] of [
    [5, 5.7, CEIL - 0.12],
    [5.7, 6.6, CEIL - 0.24],
    [6.6, 7.6, CEIL - 0.36],
  ] as const) {
    const trim = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 48),
      ringTrimMat,
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.set(0, y, 0);
    scene.add(trim);
  }
  const ringLightMat = new THREE.MeshBasicMaterial({
    color: 0xb8f8ed,
    side: THREE.DoubleSide,
  });
  for (const [lx, lz] of labLightPositions) {
    const rl = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.4, 32),
      ringLightMat,
    );
    rl.rotation.x = Math.PI / 2;
    rl.position.set(lx, CEIL - 0.4, lz);
    scene.add(rl);
  }

  // ── Concentric floor rings centred on the core dais ───────────────────────

  // Portholes belong to the curved shell, not a second rectangular facade.
  const windowMat = new THREE.MeshBasicMaterial({
    map: skylineTexture(),
    color: 0xffffff,
  });

  // ── Wall screens, bookshelves and circular porthole displays ──────────────
  const hideoutCanvas = document.createElement("canvas");
  hideoutCanvas.width = 1024;
  hideoutCanvas.height = 614;
  const hideoutContext = hideoutCanvas.getContext("2d");
  if (!hideoutContext)
    throw new Error("Unable to draw facility hideout displays");
  const hideoutTexture = new THREE.CanvasTexture(hideoutCanvas);
  hideoutTexture.colorSpace = THREE.SRGBColorSpace;
  const hideoutScreenMat = new THREE.MeshBasicMaterial({
    map: hideoutTexture,
    toneMapped: false,
  });
  const wallScreensReady = loadTexture(hideoutImageUrl).then((source) => {
    try {
      if (disposed) return;
      hideoutContext.drawImage(source.image, 0, 0, 1024, 614);
      hideoutContext.fillStyle = "#ffdb57";
      hideoutContext.fillRect(0, 480, 1024, 134);
      hideoutContext.strokeStyle = "#17191f";
      hideoutContext.lineWidth = 14;
      hideoutContext.strokeRect(7, 7, 1010, 600);
      hideoutContext.fillStyle = "#17191f";
      hideoutContext.textAlign = "center";
      hideoutContext.font =
        '900 80px Impact, Haettenschweiler, "Franklin Gothic Heavy", sans-serif';
      hideoutContext.fillText("SUDOERS HIDEOUT", 512, 576, 960);
      hideoutTexture.needsUpdate = true;
    } finally {
      source.dispose();
    }
  });
  const displayX = D - 3.2;
  for (const [sx, sz] of [
    [-1, 6],
    [1, -6],
  ] as const) {
    const cabinet = box([0.65, 1.6, 3.2], [sx * displayX, 0.8, sz], pale);
    cabinet.name = "FacilityHideoutDisplayCabinet";
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 3.2), dark);
    frame.position.set(sx * (displayX - 0.36), 2.6, sz);
    scene.add(frame);
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 1.8),
      hideoutScreenMat,
    );
    scr.name = "FacilityHideoutWallScreen";
    scr.position.set(sx * (displayX - 0.42), 2.6, sz);
    scr.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(scr);
  }
  const spineColors = [0xc0563f, 0x3f7fc0, 0x4fae62, 0xd0a03f, 0x8a5fc0];
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xb98a5a,
    roughness: 0.7,
  });
  const spineMaterials = spineColors.map((color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  for (const x of [-6, 6]) {
    const archive = new THREE.Group();
    archive.name = "FacilityRearArchive";
    archive.position.set(x, 0, -21);
    archive.rotation.y = Math.atan2(-x, 21);
    scene.add(archive);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 0.5), woodMat);
    shelf.position.y = 1.3;
    archive.add(shelf);
    physics.addBoxFromMesh(shelf);
    for (let r = 0; r < 3; r++)
      for (let b = 0; b < 6; b++) {
        const spine = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.5, 0.1),
          spineMaterials[(r * 6 + b) % spineMaterials.length],
        );
        spine.position.set(-1.4 + b * 0.55, 0.5 + r * 0.8, 0.28);
        archive.add(spine);
      }
  }
  const portholeRingMat = new THREE.MeshStandardMaterial({
    color: 0xdfe8ea,
    metalness: 0.4,
    roughness: 0.4,
  });
  for (const angle of FACILITY_WINDOW_ANGLES) {
    const frame = new THREE.Group();
    frame.name = "FacilityRoundWindow";
    const radius = Math.sqrt(D ** 2 - FACILITY.windowY ** 2) - 0.15;
    frame.position.set(
      Math.sin(angle) * radius,
      FACILITY.windowY,
      Math.cos(angle) * radius,
    );
    frame.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      frame.position.clone().normalize().negate(),
    );
    scene.add(frame);
    const backing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.12, 48),
      dark,
    );
    backing.rotation.x = Math.PI / 2;
    frame.add(backing);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.16, 12, 48),
      portholeRingMat,
    );
    ring.position.z = 0.04;
    frame.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.94, 48), windowMat);
    disc.position.z = 0.075;
    frame.add(disc);
  }

  const facilityCore = createFacilityCoreDisplay();
  scene.add(facilityCore.root);
  physics.addBox({ x: 2.8, y: 0.125, z: 2.8 }, { x: 0, y: 0.125, z: 0 });
  physics.addBox({ x: 2.3, y: 0.125, z: 2.3 }, { x: 0, y: 0.375, z: 0 });
  physics.addBox({ x: 1.3, y: 0.7, z: 1.3 }, { x: 0, y: 1.2, z: 0 });

  // ── Workstations show one cheap static capture until Brondon sits down. ──
  const monitorMat = new THREE.MeshBasicMaterial({
    color: 0xd9bd91,
    toneMapped: false,
  });
  const monitorPreviewReady = loadTexture(facilityPreviewUrl).then(
    (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      monitorMat.map = texture;
      monitorMat.color.setHex(0xffffff);
      monitorMat.needsUpdate = true;
    },
  );
  const monitorBody = new THREE.MeshStandardMaterial({
    color: 0x2b3a42,
    metalness: 0.5,
    roughness: 0.4,
  });
  interface FacilityWorkstation {
    screen: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
    seat: ChairSeat;
    previewMaterial: THREE.Material;
  }
  const workstationByScreen = new Map<THREE.Object3D, FacilityWorkstation>();
  function workstation(
    x: number,
    z: number,
    desk: THREE.Group,
    chair: THREE.Group,
  ) {
    desk.name = "FacilityDesk";
    chair.name = "FacilityChair";
    const deskSize = fitRoomProp(desk, 0.82, 2.2, 1.1);
    const chairSize = fitRoomProp(chair, 1.2, 0.8, 0.9);
    const group = new THREE.Group();
    group.name = "FacilityWorkstation";
    group.position.set(x, 0, z);
    group.rotation.y = Math.atan2(x, z);
    scene.add(group);
    chair.position.z += 1.05;
    group.add(desk, chair);
    for (const [size, offset] of [
      [deskSize, 0],
      [chairSize, 1.05],
    ] as const) {
      const center = group.localToWorld(
        new THREE.Vector3(0, size.y / 2, offset),
      );
      const body = physics.addBox(size, center);
      body.quaternion.set(
        group.quaternion.x,
        group.quaternion.y,
        group.quaternion.z,
        group.quaternion.w,
      );
      body.aabbNeedsUpdate = true;
    }
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.16, 0.1),
      monitorBody,
    );
    stand.position.set(0, deskSize.y + 0.08, -0.2);
    group.add(stand);
    const mon = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.7, 0.08),
      monitorBody,
    );
    mon.position.set(0, deskSize.y + 0.51, -0.2);
    group.add(mon);
    const scr = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(
      new THREE.PlaneGeometry(1.1, 0.6),
      monitorMat,
    );
    scr.name = "FacilityComputerPreview";
    scr.position.set(0, deskSize.y + 0.51, -0.155);
    group.add(scr);
    const seat: ChairSeat = {
      root: chair,
      yaw: group.rotation.y,
      surface: () => {
        const bounds = new THREE.Box3().setFromObject(chair);
        const surface = bounds.getCenter(new THREE.Vector3());
        surface.y = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.48;
        return surface;
      },
    };
    workstationByScreen.set(scr, {
      screen: scr,
      seat,
      previewMaterial: monitorMat,
    });
  }
  const workstations = [
    [-12, 14],
    [12, 14],
    [-18.5, 1],
    [18.5, 1],
    [-17.5, -10],
    [17.5, -10],
    [-9.5, -18],
    [9.5, -18],
  ] as const;
  const furnitureReady = Promise.allSettled(
    workstations.flatMap(() => [
      loadModel("Prop_Desk_Small"),
      loadModel("Prop_Chair"),
    ]),
  ).then((results) => {
    const models = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.scene] : [],
    );
    const failed = results.find((result) => result.status === "rejected");
    if (disposed || failed?.status === "rejected") {
      models.forEach(disposeRoom);
      if (failed?.status === "rejected")
        throw new Error(
          `Facility furniture failed to load: ${String(failed.reason)}`,
        );
      return;
    }
    try {
      workstations.forEach(([x, z], index) =>
        workstation(x, z, models[index * 2], models[index * 2 + 1]),
      );
    } catch (error) {
      models.filter((model) => !model.parent).forEach(disposeRoom);
      throw error;
    }
  });

  // ── Staircase to the second floor (centre of the atrium, ascending north) ─
  const STAIR_BASE = new THREE.Vector3(0, 0, MEZZ_EDGE + STAIR_RUN);
  const stairs = physics.addStaircase({
    width: 3,
    run: STAIR_RUN,
    rise: MEZZ_Y + 0.2,
    position: STAIR_BASE,
    material: pale,
    yaw: Math.PI,
    stepCount: 22,
  });
  scene.add(stairs.group);
  stairs.group.name = "FacilityStaircase";
  const slope = Math.atan2(MEZZ_Y + 0.2, STAIR_RUN),
    railLength = Math.hypot(MEZZ_Y + 0.2, STAIR_RUN);
  const stairGlass = new THREE.MeshPhysicalMaterial({
    color: 0x9fd8e0,
    transparent: true,
    opacity: 0.22,
    metalness: 0.15,
    roughness: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (const side of [-1, 1]) {
    for (const [height, thickness, material] of [
      [0.57, 1.02, stairGlass],
      [1.12, 0.09, dark],
      [-0.13, 0.22, dark],
    ] as const) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, thickness, railLength),
        material,
      );
      rail.position.set(
        side * 1.52,
        (MEZZ_Y + 0.2) / 2 + height,
        STAIR_RUN / 2,
      );
      rail.rotation.x = -slope;
      rail.name = "StairSlopedRailing";
      stairs.group.add(rail);
      if (material === stairGlass) physics.addBoxFromMesh(rail);
    }
    for (let step = 0; step <= 8; step++) {
      const z = 0.15 + (step * (STAIR_RUN - 0.3)) / 8;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), dark);
      post.position.set(
        side * 1.52,
        (z / STAIR_RUN) * (MEZZ_Y + 0.2) + 0.55,
        z,
      );
      stairs.group.add(post);
    }
  }
  for (let step = 0; step < 22; step++) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(2.88, 0.018, 0.045),
      stripe,
    );
    edge.position.set(
      0,
      ((step + 1) * (MEZZ_Y + 0.2)) / 22 + 0.014,
      (step * STAIR_RUN) / 22 + 0.025,
    );
    stairs.group.add(edge);
  }

  createFacilityDeck(scene, physics);
  const office = createFacilityOffice(scene, physics, loadModel, loadStudents);

  // ── Player / camera ────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.05,
    200,
  );
  const spawn = { x: 0, y: PHYSICS.playerRadius, z: D - 3.6 };
  const player = createPlayer({ camera, physicsWorld, spawnPosition: spawn });
  // Keys released during the load never reach this scene, so held keys stay blocked until released again.
  if (entryState?.pilotState && fromExterior)
    player.restoreTransition(
      {
        ...entryState.pilotState,
        velocity: new THREE.Vector3(),
        heldKeys: [],
        blockedKeys: entryState.pilotState.heldKeys,
        sprinting: false,
        crouching: false,
        intentionalJump: false,
        jumpQueued: false,
        slide: undefined,
        bobIntensity: 0,
      },
      entrance.frame,
    );
  else player.setRotation(0);
  // Step clear of the doorway so the third-person camera never sits inside the black entrance void.
  if (player.body.position.z > spawn.z) {
    player.body.position.z = spawn.z;
    player.body.previousPosition.copy(player.body.position);
    player.body.interpolatedPosition.copy(player.body.position);
  }
  player.enable();
  player.updateCamera(0);
  entrance.setTrigger((state) => {
    if (!onReturn || finished) return;
    finished = true;
    player.clearInput();
    player.disable();
    onReturn({
      ...entryState,
      facilitySolved: true,
      pilotState: state,
      cameraPosition: undefined,
      cameraQuaternion: undefined,
      cameraFov: undefined,
    });
  });

  // ── Office reveal state ────────────────────────────────────────────────────
  let revealTime = -1; // >=0 once the player has reached the observation deck
  let finished = false;
  const peekStart = new THREE.Vector3(),
    peekRotation = new THREE.Quaternion();
  let peekFov = 75;
  function applyPeekCamera() {
    if (revealTime < 0) return;
    const blend = THREE.MathUtils.smootherstep(revealTime, 0, 1.2);
    const view = new THREE.PerspectiveCamera();
    const drift = THREE.MathUtils.smootherstep(revealTime, 1.2, 4);
    view.position.copy(office.peekPoint).add(new THREE.Vector3(-0.45 * drift, 0.1 * drift, -0.3 * drift));
    view.lookAt(office.tablePoint);
    camera.position.lerpVectors(peekStart, view.position, blend);
    camera.quaternion.slerpQuaternions(peekRotation, view.quaternion, blend);
    camera.fov = THREE.MathUtils.lerp(peekFov, 50, blend);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  // ── Transient on-screen message ────────────────────────────────────────────
  const messageEl = document.createElement("div");
  messageEl.className = "facility-message";
  messageEl.style.display = "none";
  messageEl.setAttribute("role", "status");
  messageEl.setAttribute("aria-live", "polite");
  document.body.appendChild(messageEl);
  const dialogue = document.createElement("section");
  dialogue.className = "facility-dialogue";
  dialogue.setAttribute("aria-live", "polite");
  const dialogueSpeaker = document.createElement("strong"),
    dialogueText = document.createElement("p");
  dialogue.append(dialogueSpeaker, dialogueText);
  document.body.appendChild(dialogue);
  // Arrival cutscene: Prime remarks on the resort, then Brondon approaches the hideout picture.
  const INTRO = Object.freeze({
    primeEnd: 3.6,
    walkEnd: 15.2,
    firstLineEnd: 18.6,
    end: 23.2,
  });
  const introStart = new THREE.Vector3(
    player.body.position.x,
    player.radius,
    player.body.position.z,
  );
  const picturePoint = new THREE.Vector3(-displayX + 0.42, 2.6, 6);
  const introEnd = new THREE.Vector3(picturePoint.x + 2.8, player.radius, 6);
  const introPath = new THREE.CatmullRomCurve3([
    introStart,
    new THREE.Vector3(-4.5, player.radius, spawn.z),
    new THREE.Vector3(-6, player.radius, 18.9),
    new THREE.Vector3(-6, player.radius, 12),
    new THREE.Vector3(-10, player.radius, 8.2),
    introEnd,
  ], false, "centripetal");
  const introStartYaw = player.getState().yaw;
  const introPosition = introStart.clone(),
    introLook = new THREE.Vector3(),
    introTangent = new THREE.Vector3(),
    introFollowCamera = new THREE.Vector3();
  const introOpeningCamera = new THREE.Vector3(-7.5, 2.8, 21.5);
  const introRevealCamera = introEnd.clone().add(new THREE.Vector3(3.6, 1.95, 3.5));
  let introTime = 0,
    introActive = true,
    cinematicDelta = 0;
  const introSkipButton = document.createElement("button");
  introSkipButton.type = "button";
  introSkipButton.className = "scene-dialogue-skip facility-intro-skip";
  document.body.appendChild(introSkipButton);
  function setIntroDialogue(speaker = "", text = "") {
    dialogue.classList.toggle("hidden", !text);
    dialogueSpeaker.textContent = speaker;
    dialogueText.textContent = text;
  }
  function endIntro() {
    if (!introActive) return;
    introActive = false;
    setIntroDialogue();
    introSkipButton.classList.add("hidden");
    player.setPosition(introEnd.x, player.radius, introEnd.z);
    player.setRotation(Math.PI / 2);
    camera.fov = 75;
    camera.updateProjectionMatrix();
    if (!disposed && !finished && !browser?.active) {
      player.clearInput();
      player.enable();
      player.updateCamera(0);
    }
  }
  const introSkip = createHoldToSkip({
    button: introSkipButton,
    onSkip: endIntro,
    isAvailable: () => introActive,
  });
  function updateIntro(dt: number) {
    if (!introActive) return;
    introSkip.update(dt);
    if (!introActive) return;
    introTime = Math.min(INTRO.end, introTime + dt);
    const walkDuration = INTRO.walkEnd - INTRO.primeEnd;
    const walkTime = THREE.MathUtils.clamp(
      introTime - INTRO.primeEnd, 0, walkDuration,
    );
    const ramp = 0.45;
    const distance =
      walkTime < ramp
        ? walkTime ** 2 / (2 * ramp)
        : walkTime > walkDuration - ramp
          ? walkDuration - ramp - (walkDuration - walkTime) ** 2 / (2 * ramp)
          : walkTime - ramp / 2;
    const progress = distance / (walkDuration - ramp);
    introPath.getPointAt(progress, introPosition);
    introPath.getTangentAt(progress, introTangent);
    if (introTime < INTRO.primeEnd) {
      setIntroDialogue("PRIME", "This looks more like a resort than a prison.");
    } else if (introTime < INTRO.walkEnd) {
      setIntroDialogue();
    } else {
      if (introTime < INTRO.firstLineEnd) {
        setIntroDialogue("BRONDON", "They were behind this. All of it.");
      } else {
        setIntroDialogue(
          "BRONDON",
          "I need to hear the truth from them.",
        );
      }
    }
    const walkYaw = Math.atan2(-introTangent.x, -introTangent.z);
    let yaw = walkYaw;
    if (introTime < INTRO.primeEnd) {
      const turn = Math.atan2(
        Math.sin(walkYaw - introStartYaw), Math.cos(walkYaw - introStartYaw),
      );
      yaw = introStartYaw + turn * THREE.MathUtils.smootherstep(
        introTime, INTRO.primeEnd - 0.9, INTRO.primeEnd,
      );
    } else if (introTime >= INTRO.walkEnd) {
      const pictureYaw = Math.atan2(
        introEnd.x - picturePoint.x, introEnd.z - picturePoint.z,
      );
      const turn = Math.atan2(
        Math.sin(pictureYaw - walkYaw), Math.cos(pictureYaw - walkYaw),
      );
      yaw = walkYaw + turn * THREE.MathUtils.smootherstep(
        introTime, INTRO.walkEnd, INTRO.walkEnd + 0.65,
      );
    }
    player.setPosition(introPosition.x, player.radius, introPosition.z);
    player.setRotation(yaw);
    if (introTime >= INTRO.end) endIntro();
  }
  function applyIntroCamera() {
    if (!introActive) return;
    const follow = THREE.MathUtils.smootherstep(
      introTime, INTRO.primeEnd - 1.1, INTRO.primeEnd + 1,
    );
    const reveal = THREE.MathUtils.smootherstep(
      introTime, INTRO.walkEnd - 0.8, INTRO.walkEnd + 1.4,
    );
    introFollowCamera.copy(introPosition);
    introFollowCamera.x += 3.4;
    introFollowCamera.y = 2.45;
    introFollowCamera.z += 1.9;
    camera.position
      .lerpVectors(introOpeningCamera, introFollowCamera, follow)
      .lerp(introRevealCamera, reveal);
    introLook.copy(introPosition).setY(1.3).lerp(picturePoint, reveal);
    camera.fov = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(60, 52, follow), 48, reveal,
    );
    camera.lookAt(introLook);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  let messageTime = 0;
  function message(text: string, seconds: number) {
    messageEl.textContent = text;
    messageEl.style.display = "block";
    messageTime = seconds;
  }
  setIntroDialogue("PRIME", "This looks more like a resort than a prison.");
  player.clearInput();
  player.disable();
  // ── Interaction (E key) ────────────────────────────────────────────────────
  const prompt = document.getElementById("interact-prompt");
  let computerPending: FacilityWorkstation | null = null;
  let activeComputer: FacilityWorkstation | null = null;
  const computerRaycaster = new THREE.Raycaster();
  const computerScreenCenter = new THREE.Vector2();
  const computerEye = new THREE.Vector3();
  const seating = createChairSeating({
    scene,
    camera,
    player,
    prompt,
    chairs: () => [],
    canInteract: () =>
      !disposed &&
      !finished &&
      !introActive &&
      revealTime < 0 &&
      !browser?.active &&
      !document.body.classList.contains("quick-menu-open"),
  });
  function closeComputer() {
    if (
      activeComputer &&
      browser &&
      activeComputer.screen.material === browser.material
    ) {
      activeComputer.screen.material = activeComputer.previewMaterial;
    }
    activeComputer = null;
    browser?.dispose();
    browser?.material.dispose();
    browser = null;
  }
  function openComputer(workstation: FacilityWorkstation) {
    activeComputer = workstation;
    browser = createFacilityBrowser(
      () => {
        player.clearInput();
        prompt?.classList.add("hidden");
      },
      () => {
        closeComputer();
        if (!disposed) {
          player.clearInput();
          seating.stand();
        }
      },
    );
    browser.register(workstation.screen);
    workstation.screen.material = browser.material;
    browser.open(workstation.screen, camera);
  }
  function focusedComputerScreen() {
    if (browser?.active || disposed || workstationByScreen.size === 0)
      return null;
    camera.updateWorldMatrix(true, false);
    const screens = [...workstationByScreen.keys()];
    for (const screen of screens) screen.updateWorldMatrix(true, false);
    computerRaycaster.setFromCamera(computerScreenCenter, camera);
    computerEye.set(
      player.body.position.x,
      player.body.position.y + 1,
      player.body.position.z,
    );
    return (
      computerRaycaster
        .intersectObjects(screens, false)
        .find((hit) => hit.point.distanceTo(computerEye) < 4)?.object ?? null
    );
  }
  function currentTarget():
    { kind: "peek" } | { kind: "browser"; screen: THREE.Object3D } | null {
    if (seating.active) return null;
    if (office.canPeek(player.body.position)) return { kind: "peek" };
    const screen = focusedComputerScreen();
    if (screen) return { kind: "browser", screen };
    return null;
  }
  function onKey(event: KeyboardEvent) {
    if (
      event.code !== "KeyE" ||
      event.repeat ||
      event.defaultPrevented ||
      !player.isEnabled() ||
      disposed ||
      finished ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    const target = currentTarget();
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.kind === "peek") {
      revealTime = 0;
      peekStart.copy(camera.position);
      peekRotation.copy(camera.quaternion);
      peekFov = camera.fov;
      dialogue.classList.add("hidden");
      player.clearInput();
      player.disable();
      prompt?.classList.add("hidden");
      message("BRONDON: Let me have a look...", 3);
    } else {
      const workstation = workstationByScreen.get(target.screen);
      if (!workstation)
        throw new Error("Cannot sit at an unregistered facility workstation");
      if (seating.sit(workstation.seat)) computerPending = workstation;
      else
        message(
          "Move beside the chair and face the monitor before sitting down.",
          3,
        );
    }
  }
  window.addEventListener("keydown", onKey);

  // ── Update loop ────────────────────────────────────────────────────────────
  let clock = 0;
  function updatePhysics(dt: number, thirdPerson = false) {
    if (
      disposed ||
      finished ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    dt = Math.max(
      0,
      Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime),
    );
    cinematicDelta = dt;
    if (browser?.active) {
      browser.update(dt);
      return;
    }
    office.update(dt, revealTime >= 3);
    if (revealTime >= 0) {
      revealTime += dt;
      applyPeekCamera();
      if (revealTime >= 3) message("Sudoers 5: We've been expecting you, Professor.", 0.5);
      if (revealTime >= 6) {
        finished = true;
        onFinished({
          ...entryState,
          cameraPosition: camera.position.clone(),
          cameraQuaternion: camera.quaternion.clone(),
          cameraFov: camera.fov,
          pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }),
        });
      }
      return;
    }
    clock += dt;
    physics.step(dt, player, thirdPerson);
    updateIntro(dt);
    seating.update(dt);
    if (computerPending && !seating.active) computerPending = null;
    if (computerPending && seating.resting && !browser?.active) {
      const workstation = computerPending;
      computerPending = null;
      seating.applyCamera();
      openComputer(workstation);
    }
    entrance.update(
      dt,
      player,
      !introActive && !seating.active && entrance.near(player),
    );
    if (finished) return;

    // Interact prompt
    const seatingOwnsPrompt = seating.updateInteractionFocus();
    if (prompt && !introActive && !seatingOwnsPrompt) {
      const target = currentTarget();
      if (target) {
        prompt.classList.remove("hidden");
        prompt.textContent = inputHint(
          target.kind === "peek"
            ? "E: peek into the office"
            : "E: sit down and use fla.capitalsigma.biz",
        );
      } else prompt.classList.add("hidden");
    } else if (!seatingOwnsPrompt) prompt?.classList.add("hidden");

    // Message timer
    if (messageTime > 0) {
      messageTime -= dt;
      if (messageTime <= 0) messageEl.style.display = "none";
    }

    facilityCore.update(clock);
  }

  return {
    restartAtCheckpoint: () => {
      if (!onRespawn) return false;
      onRespawn();
      return true;
    },
    roomId: "scene20",
    scene,
    camera,
    physics,
    physicsWorld,
    player,
    entrance,
    cutsceneManager: null,
    isCinematic: () =>
      introActive || seating.active || !!browser?.active || revealTime >= 0,
    hideCharacter: () => revealTime >= 0 || !!browser?.active,
    getCinematicDelta: () => (seating.active ? seating.delta : cinematicDelta),
    getCinematicState: () =>
      seating.getState() ??
      (introActive || browser?.active || revealTime >= 0
        ? {
            ...player.getState(),
            isMoving:
              introActive &&
              introTime >= INTRO.primeEnd &&
              introTime < INTRO.walkEnd,
            isOnGround: true,
            jumping: false,
            climbing: false,
            crouching: false,
            velocityY: 0,
          }
        : null),
    getCinematicPose: () =>
      seating.getPose() ??
      (introActive
        ? {
            clip:
              introTime >= INTRO.primeEnd && introTime < INTRO.walkEnd
                ? ("Walk_Loop" as const)
                : ("Idle_Loop" as const),
            time: introTime,
            loop: true,
          }
        : undefined),
    applyCinematicCamera: () => {
      if (introActive) applyIntroCamera();
      else if (revealTime >= 0) applyPeekCamera();
      else if (browser?.active) browser.applyCamera();
      else seating.applyCamera();
    },
    renderCinematicOverlay: (renderer: THREE.WebGLRenderer) =>
      browser?.render(renderer, camera),
    ready: Promise.all([
      furnitureReady,
      office.ready,
      wallScreensReady,
      monitorPreviewReady,
    ]),
    hideMinimap: () => true,
    getMinimapState: () => ({
      position: player.body.position,
      yaw: player.getState().yaw,
    }),
    getMusicTrack: (): "puzzle" => "puzzle",
    updatePhysics,
    dispose() {
      if (disposed) return;
      disposed = true;
      closeComputer();
      seating.dispose();
      office.dispose();
      introSkip.dispose();
      window.removeEventListener("keydown", onKey);
      prompt?.classList.add("hidden");
      messageEl.remove();
      dialogue.remove();
      introSkipButton.remove();
      player.dispose();
      physics.dispose();
      disposeRoom(scene);
    },
  };
}
