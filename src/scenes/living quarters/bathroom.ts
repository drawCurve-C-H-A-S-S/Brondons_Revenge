import {
  playSfx,
  playWorldSfx,
  stopRunningWaterAudio,
  updateRunningWaterAudio,
} from "../../helpers/audio/sfx.js";
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import toiletUrl from "../../assets/models/toilet (1).glb";
import toiletPaperUrl from "../../assets/models/toilet_paper.glb";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import {
  createShipInteriorMaterials,
  createShipSurfaceMaterial,
} from "../../scripts/global/shipInterior.js";
import { QUARTERS, CABINS } from "./layout.js";
import { comicNameTexture } from "./furnishings.js";
import type { ChairSeat } from "../../scripts/player/chairSeating.js";

type Physics = ReturnType<typeof createScenePhysics>;

/** The bathroom opens off the aft end of the hallway, to the left of Brondon's door. */
export const BATHROOM = {
  halfWidth: 5.69,
  frontZ: -16,
  backZ: -34,
  height: QUARTERS.height,
} as const;

export interface BathroomFixture {
  id: string;
  label: string;
  root: THREE.Object3D;
  point: THREE.Vector3;
  isOn(): boolean;
  toggle(): void;
  /** Overrides the default "Turn on/off the <label>" prompt. */
  prompt?(): string;
}

interface DropField {
  points: THREE.Points;
  positions: Float32Array;
  speeds: Float32Array;
  origin: THREE.Vector3;
}

/**
 * Communal bathroom. Every object named `Placeholder-*` is a stand-in made of primitives
 * and can be replaced with an imported model without touching the rest of the room.
 */
export function createCommunalBathroom(scene: THREE.Scene, physics: Physics) {
  const { steel, dark, trim, cyan, deck } = createShipInteriorMaterials(6, 6, "crew");
  const stallDoorMaterial = new THREE.MeshStandardMaterial({
    color: steel.color.clone(),
    roughness: 0.66,
    metalness: 0.12,
  });
  const tile = new THREE.MeshStandardMaterial({
    color: 0xc9dae2,
    roughness: 0.35,
    metalness: 0.15,
  });
  const porcelain = createShipSurfaceMaterial("porcelain", 0xeef4f6);
  const sinkCabinet = createShipSurfaceMaterial("painted-metal", 0x45535e);
  const lockerPaint = createShipSurfaceMaterial("painted-metal", 0x9daeb7);
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xd5dde2,
    roughness: 0.18,
    metalness: 0.95,
  });
  const curtainMaterial = new THREE.MeshStandardMaterial({
    color: 0x6fb7c7,
    roughness: 0.8,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const waterMaterial = new THREE.MeshBasicMaterial({
    color: 0xa9dcff,
    transparent: true,
    opacity: 0.55,
    toneMapped: false,
  });
  const root = new THREE.Group();
  root.name = "CommunalBathroom";
  scene.add(root);
  let disposed = false;
  const modelCache = new Map<string, Promise<THREE.Group>>();
  const labelMaterials: THREE.MeshBasicMaterial[] = [];
  // Comic-book name plate: bold outlined lettering on a coloured burst with halftone dots.
  function comicLabelMaterial(name: string, seed: number) {
    const material = new THREE.MeshBasicMaterial({
      map: comicNameTexture(name, seed),
      transparent: true,
      toneMapped: false,
    });
    labelMaterials.push(material);
    return material;
  }
  // Loads a model once, scales it to the target height and sits it on y = 0 centred on x/z.
  function loadFitted(
    url: string,
    targetHeight: number,
    uprightZ = 0,
  ): Promise<THREE.Group> {
    let source = modelCache.get(url);
    if (!source) {
      source = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
      modelCache.set(url, source);
    }
    return source.then((model) => {
      const clone = model.clone(true);
      clone.rotation.z = uprightZ;
      const bounds = new THREE.Box3().setFromObject(clone),
        size = bounds.getSize(new THREE.Vector3());
      const scale = size.y > 0 ? targetHeight / size.y : 1;
      clone.scale.multiplyScalar(scale);
      const fitted = new THREE.Box3().setFromObject(clone),
        center = fitted.getCenter(new THREE.Vector3());
      clone.position.set(-center.x, -fitted.min.y, -center.z);
      clone.traverse((node) => {
        if (node instanceof THREE.Mesh)
          node.castShadow = node.receiveShadow = true;
      });
      const holder = new THREE.Group();
      holder.add(clone);
      return holder;
    });
  }

  function box(
    parent: THREE.Object3D,
    name: string,
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material = steel,
    solid = false,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.shipSurfaceContinuous = solid && (
      material === steel || material === deck || name === "BathroomCeiling"
    );
    parent.add(mesh);
    if (solid) physics.addBoxFromMesh(mesh);
    return mesh;
  }
  function cylinder(
    parent: THREE.Object3D,
    name: string,
    radius: number,
    height: number,
    at: [number, number, number],
    material: THREE.Material = porcelain,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 16),
      material,
    );
    mesh.name = name;
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function wordPictureTexture(owner: string, word: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 280;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to draw bathroom word pictures");
    context.fillStyle = "#b99261";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ebe1c9";
    context.fillRect(24, 24, canvas.width - 48, canvas.height - 48);
    context.strokeStyle = "#25292a";
    context.lineWidth = 10;
    context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
    context.fillStyle = "#283332";
    context.textAlign = "center";
    context.textBaseline = "middle";
    let size = 76;
    context.font = `700 ${size}px sans-serif`;
    while (context.measureText(word).width > 390 && size > 26) {
      size -= 4;
      context.font = `700 ${size}px sans-serif`;
    }
    context.fillText(word, canvas.width / 2, 132);
    context.fillStyle = "#59615b";
    context.font = "18px sans-serif";
    context.fillText(owner, canvas.width / 2, 224);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
  function addWordPicture(
    locker: THREE.Group,
    owner: string,
    word: string,
    side: number,
    z: number,
  ) {
    box(
      locker,
      "BathroomWordPictureFrame",
      [0.055, 0.56, 0.92],
      [side * 0.22, 0.87, z],
      trim,
    );
    const material = new THREE.MeshBasicMaterial({
      map: wordPictureTexture(owner, word),
      toneMapped: false,
    });
    labelMaterials.push(material);
    const picture = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.47),
      material,
    );
    picture.name = `BathroomWordPicture-${owner}`;
    picture.position.set(side * 0.255, 0.87, z);
    picture.rotation.y = (side * Math.PI) / 2;
    locker.add(picture);
  }

  const { halfWidth: hw, frontZ, backZ, height } = BATHROOM;
  const length = frontZ - backZ,
    centerZ = (frontZ + backZ) / 2,
    wallInner = hw - 0.09;
  // The aft hallway wall occupies z -16.09..-15.91, so shell pieces stop at its bathroom face to avoid coplanar overlaps.
  const shellFront = frontZ - 0.09,
    shellLength = shellFront - (backZ - 0.18),
    shellCenterZ = (shellFront + backZ - 0.18) / 2;
  const slabLength = frontZ - (backZ - 0.18),
    slabCenterZ = (frontZ + backZ - 0.18) / 2;
  box(
    root,
    "BathroomDeck",
    [hw * 2 + 0.18, 0.2, slabLength],
    [0, -0.1, slabCenterZ],
    deck,
    true,
  );
  const ceiling = box(
    root,
    "BathroomCeiling",
    [hw * 2 + 0.18, 0.18, slabLength],
    [0, height + 0.09, slabCenterZ],
    dark,
    true,
  );
  ceiling.userData.minimap = false;
  for (const side of [-1, 1])
    box(
      root,
      "BathroomSideWall",
      [0.18, height, shellLength],
      [side * hw, height / 2, shellCenterZ],
      steel,
      true,
    );
  box(
    root,
    "BathroomBackWall",
    [hw * 2 - 0.18, height, 0.18],
    [0, height / 2, backZ - 0.09],
    steel,
    true,
  );
  // Tiled wainscot and a cyan guide strip tie the room to the crew corridor.
  for (const side of [-1, 1]) {
    box(
      root,
      "BathroomWallTile",
      [0.04, 1.3, length - 0.3],
      [side * (wallInner - 0.025), 0.65, centerZ],
      tile,
    );
    box(
      root,
      "BathroomGuideStrip",
      [0.02, 0.04, length - 0.4],
      [side * (wallInner - 0.03), 1.36, centerZ],
      cyan,
    );
  }
  box(
    root,
    "BathroomBackWallTile",
    [hw * 2 - 0.4, 1.3, 0.04],
    [0, 0.65, backZ + 0.025],
    tile,
  );
  // The front tile stops short of the door jambs so it never pokes through the doorway.
  const tileGap = 1.1,
    frontTileWidth = wallInner - 0.2 - tileGap;
  for (const side of [-1, 1])
    box(
      root,
      "BathroomFrontWallTile",
      [frontTileWidth, 1.3, 0.04],
      [side * (tileGap + frontTileWidth / 2), 0.65, shellFront - 0.025],
      tile,
    );
  for (const z of [-20, -26, -32]) {
    box(
      root,
      "BathroomCeilingLight",
      [2.4, 0.025, 0.14],
      [0, height - 0.02, z],
      cyan,
    );
    for (const x of [-3, 3]) {
      const light = new THREE.PointLight(0xdcf1ff, 9, 11, 1.6);
      light.position.set(x, 2.85, z);
      root.add(light);
    }
  }

  // Eight sinks along the west wall, with one long mirror above them.
  const sinkZ = Array.from({ length: 8 }, (_, i) => -17.4 - i * 1.8),
    counterZ = -23.7,
    counterX = -hw + 0.5;
  box(
    root,
    "SinkCounter",
    [0.8, 0.88, 14.2],
    [counterX, 0.44, counterZ],
    sinkCabinet,
    true,
  );
  box(
    root,
    "SinkCounterTop",
    [0.86, 0.06, 14.26],
    [counterX, 0.91, counterZ],
    porcelain,
  );
  const fixtures: BathroomFixture[] = [];
  const streams: Array<{ mesh: THREE.Mesh; fixture: BathroomFixture }> = [];
  const knobs = new Map<string, THREE.Object3D>();
  for (const [index, z] of sinkZ.entries()) {
    const sink = new THREE.Group();
    sink.name = `Placeholder-Sink-${index + 1}`;
    sink.position.set(counterX + 0.05, 0.94, z);
    root.add(sink);
    const basin = new THREE.Mesh(
      new THREE.LatheGeometry([
        [0, 0], [0.18, 0], [0.24, 0.025], [0.27, 0.1],
        [0.27, 0.12], [0.255, 0.135], [0.24, 0.12],
        [0.21, 0.06], [0.14, 0.028], [0.06, 0.018], [0, 0.018],
      ].map(([radius, height]) => new THREE.Vector2(radius, height)), 48),
      porcelain,
    );
    basin.name = "SinkBasin";
    basin.castShadow = basin.receiveShadow = true;
    sink.add(basin);
    cylinder(sink, "SinkDrain", 0.035, 0.008, [0, 0.022, 0], chrome);
    for (const x of [-0.015, 0, 0.015])
      cylinder(sink, "SinkDrainHole", 0.004, 0.002, [x, 0.027, 0], sinkCabinet);
    const tap = new THREE.Group();
    tap.name = `SinkTap-${index + 1}`;
    tap.position.set(-0.3, 0, 0);
    sink.add(tap);
    cylinder(tap, "TapRiser", 0.02, 0.17, [0, 0.085, 0], chrome);
    box(tap, "TapSpout", [0.19, 0.03, 0.03], [0.09, 0.17, 0], chrome);
    const knob = box(tap, "TapKnob", [0.04, 0.03, 0.14], [0, 0.17, 0], chrome);
    const stream = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.15, 8),
      waterMaterial,
    );
    stream.name = "TapWater";
    stream.position.set(-0.12, 0.085, 0);
    stream.visible = false;
    sink.add(stream);
    const fixture: BathroomFixture = {
      id: `sink-${index + 1}`,
      label: "sink tap",
      root: tap,
      point: new THREE.Vector3(counterX - 0.2, 1.1, z),
      isOn: () => stream.visible,
      toggle: () => {
        stream.visible = !stream.visible;
      },
    };
    fixtures.push(fixture);
    streams.push({ mesh: stream, fixture });
    knobs.set(fixture.id, knob);
  }
  const mirrorZ = counterZ,
    mirrorWidth = 14.0;
  box(
    root,
    "MirrorFrame",
    [0.05, 1.12, mirrorWidth + 0.12],
    [-wallInner + 0.025, 1.9, mirrorZ],
    trim,
  );
  const mirror = new Reflector(new THREE.PlaneGeometry(mirrorWidth, 1.0), {
    clipBias: 0.003,
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0xa7b4bb,
  });
  mirror.name = "BathroomMirror";
  mirror.position.set(-wallInner + 0.055, 1.9, mirrorZ);
  mirror.rotation.y = Math.PI / 2;
  mirror.camera.layers.enable(1);
  mirror.visible = false;
  root.add(mirror);

  // Shower stalls along the east wall, each with its own valve.
  const showerZ = Array.from({ length: 8 }, (_, i) => -17.4 - i * 1.8),
    showerX = hw - 0.75;
  const partitionZ = Array.from({ length: 9 }, (_, i) => -16.5 - i * 1.8);
  const stallBounds = showerZ.map((z) => ({
    minX: showerX - 0.65,
    maxX: showerX + 0.65,
    minZ: z - 0.86,
    maxZ: z + 0.86,
  }));
  for (const z of partitionZ)
    box(
      root,
      "ShowerPartition",
      [1.3, 2.3, 0.06],
      [showerX - 0.05, 1.2, z],
      porcelain,
      true,
    );
  const drops: DropField[] = [];
  const curtains: Array<{
    mesh: THREE.Mesh;
    body: ReturnType<Physics["addBox"]>;
    state: { open: boolean; amount: number; z: number };
  }> = [];
  const deckLevel = 0;
  const lastPlayer = new THREE.Vector3();
  for (const [index, z] of showerZ.entries()) {
    const stall = new THREE.Group();
    stall.name = `Placeholder-Shower-${index + 1}`;
    root.add(stall);
    const trayFront = showerX - 0.65,
      trayBack = wallInner - 0.105,
      trayWidth = trayBack - trayFront,
      trayCenter = (trayFront + trayBack) / 2;
    box(
      stall,
      "ShowerBackPanel",
      [0.035, 2.3, 1.72],
      [wallInner - 0.065, 1.2, z],
      porcelain,
    );
    box(
      stall,
      "ShowerTray",
      [trayWidth, 0.05, 1.72],
      [trayCenter, 0.025, z],
      porcelain,
    );
    for (const x of [trayFront + 0.03, trayBack - 0.03])
      box(stall, "ShowerTrayRim", [0.06, 0.08, 1.72], [x, 0.09, z], porcelain);
    for (const side of [-1, 1])
      box(
        stall,
        "ShowerTrayRim",
        [trayWidth, 0.08, 0.06],
        [trayCenter, 0.09, z + side * 0.83],
        porcelain,
      );
    cylinder(
      stall,
      "ShowerDrain",
      0.09,
      0.01,
      [showerX + 0.25, 0.055, z],
      chrome,
    );
    for (const offset of [-0.03, 0, 0.03])
      box(
        stall,
        "ShowerDrainSlot",
        [0.11, 0.002, 0.012],
        [showerX + 0.25, 0.061, z + offset],
        dark,
      );
    const curtain = box(
      stall,
      "ShowerCurtain",
      [0.04, 1.85, 1.66],
      [showerX - 0.64, 1.0, z],
      curtainMaterial,
    );
    const curtainBody = physics.addBox(
      { x: 0.2, y: 1.85, z: 1.66 },
      new THREE.Vector3(showerX - 0.64, deckLevel + 1.0, z),
    );
    const curtainState = { open: false, amount: 0, z };
    curtains.push({ mesh: curtain, body: curtainBody, state: curtainState });
    box(
      stall,
      "CurtainRail",
      [0.04, 0.03, 1.72],
      [showerX - 0.64, 1.95, z],
      chrome,
    );
    cylinder(
      stall,
      "ShowerPipe",
      0.025,
      1.05,
      [wallInner - 0.14, 1.675, z + 0.55],
      chrome,
    );
    cylinder(
      stall,
      "ShowerPipeReturn",
      0.025,
      0.55,
      [wallInner - 0.14, 2.2, z + 0.275],
      chrome,
    ).rotation.x = Math.PI / 2;
    cylinder(
      stall,
      "ShowerHeadArm",
      0.025,
      0.26,
      [wallInner - 0.27, 2.2, z],
      chrome,
    ).rotation.z = Math.PI / 2;
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16),
      chrome,
    );
    head.name = "ShowerHead";
    head.rotation.z = -Math.PI / 8;
    head.position.set(wallInner - 0.4, 2.18, z);
    stall.add(head);
    const valve = new THREE.Group();
    valve.name = `ShowerValve-${index + 1}`;
    valve.position.set(wallInner - 0.095, 1.15, z + 0.55);
    stall.add(valve);
    cylinder(valve, "ValvePlate", 0.07, 0.03, [0, 0, 0], chrome).rotation.z =
      Math.PI / 2;
    const handle = box(
      valve,
      "ValveHandle",
      [0.05, 0.05, 0.16],
      [-0.04, 0, 0],
      chrome,
    );
    const count = 90,
      positions = new Float32Array(count * 3),
      speeds = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xb8e2ff,
        size: 0.035,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    points.name = "ShowerWater";
    points.frustumCulled = false;
    points.visible = false;
    stall.add(points);
    const origin = new THREE.Vector3(wallInner - 0.43, 2.15, z);
    for (let i = 0; i < count; i++) respawn(positions, speeds, i, origin, true);
    drops.push({ points, positions, speeds, origin });
    const fixture: BathroomFixture = {
      id: `shower-${index + 1}`,
      label: "shower",
      root: valve,
      point: new THREE.Vector3(wallInner - 0.1, 1.15, z + 0.55),
      isOn: () => points.visible,
      toggle: () => {
        points.visible = !points.visible;
      },
    };
    fixtures.push(fixture);
    knobs.set(fixture.id, handle);
    fixtures.push({
      id: `shower-curtain-${index + 1}`,
      label: "shower curtain",
      root: curtain,
      point: new THREE.Vector3(showerX - 0.8, 1.2, z),
      isOn: () => curtainState.open,
      prompt: () =>
        `E / ${curtainState.open ? "Close" : "Open"} the shower curtain`,
      toggle: () => {
        const inDoorway =
          Math.abs(lastPlayer.x - (showerX - 0.64)) < 0.55 &&
          Math.abs(lastPlayer.z - z) < 0.95;
        if (curtainState.open && inDoorway) return;
        curtainState.open = !curtainState.open;
      },
    });
  }

  // Toilet stalls run wall to wall along the back; every door can be opened and closed.
  const pitch = (wallInner * 2) / 8;
  const stallX = Array.from(
    { length: 8 },
    (_, i) => -wallInner + pitch / 2 + i * pitch,
  );
  for (let i = 1; i < 8; i++)
    box(
      root,
      "StallPartition",
      [0.06, 2.0, 1.8],
      [-wallInner + i * pitch, 1.15, backZ + 0.9],
      steel,
      true,
    );
  const seats: ChairSeat[] = [];
  const OPEN_FOLD = 1.45;
  const crewNames = CABINS.map((cabin) => cabin.occupant);
  const stallDoors: Array<{
    foldA: THREE.Group;
    foldB: THREE.Group;
    body: ReturnType<Physics["addBox"]>;
    open: boolean;
    amount: number;
  }> = [];
  for (const [index, x] of stallX.entries()) {
    const toilet = new THREE.Group();
    toilet.name = `Placeholder-Toilet-${index + 1}`;
    toilet.position.set(x, 0, backZ + 0.45);
    root.add(toilet);
    cylinder(toilet, "ToiletPedestal", 0.17, 0.34, [0, 0.17, 0.02]);
    box(toilet, "ToiletBowl", [0.38, 0.14, 0.52], [0, 0.4, 0.2]);
    box(toilet, "ToiletSeat", [0.4, 0.035, 0.46], [0, 0.49, 0.22], dark);
    box(toilet, "ToiletTank", [0.42, 0.42, 0.17], [0, 0.62, -0.18]);
    cylinder(toilet, "ToiletFlushButton", 0.03, 0.02, [0, 0.84, -0.18], chrome);
    cylinder(toilet, "ToiletPaper", 0.05, 0.11, [0.12, 0.89, -0.2], tile);
    const placeholders = [...toilet.children];
    // Invisible seat target from the floor to the seat, used by the sit-down interaction (facing the stall door).
    const seatTarget = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.5, 0.44),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    seatTarget.name = `ToiletSeatTarget-${index + 1}`;
    seatTarget.position.set(0, 0.25, 0.08);
    toilet.add(seatTarget);
    seats.push({
      root: seatTarget,
      prompt: "E / Relieve yourself at toilet",
      yaw: Math.PI,
      surface: () => seatTarget.localToWorld(new THREE.Vector3(0, 0.25, 0)),
      onStand: () => playSfx("toiletFlush", 0.8),
    });
    // The roll is stood upright on the cistern lid, clear of the flush handle.
    void Promise.all([
      loadFitted(toiletUrl, 0.8),
      loadFitted(toiletPaperUrl, 0.14, Math.PI / 2),
    ])
      .then(([bowl, roll]) => {
        if (disposed) return;
        placeholders.forEach((part) => part.removeFromParent());
        bowl.name = "ToiletModel";
        toilet.add(bowl);
        roll.name = "ToiletPaperModel";
        roll.position.set(0.12, 0.8, -0.235);
        toilet.add(roll);
      })
      .catch(() => {
        /* placeholders stay if a model fails to load */
      });
    physics.addBox(
      { x: 0.42, y: 0.8, z: 0.72 },
      new THREE.Vector3(x, 0.4, backZ + 0.45 + 0.05),
    );
    // Bi-fold door: two panels hinged to each other that stack into the stall when opened.
    const doorZ = backZ + 1.8,
      panel = pitch / 2 - 0.05;
    const hinge = new THREE.Group();
    hinge.name = `StallDoor-${index + 1}`;
    hinge.position.set(x - panel, 0, doorZ);
    root.add(hinge);
    const foldA = new THREE.Group();
    hinge.add(foldA);
    const foldB = new THREE.Group();
    foldB.position.x = panel;
    foldA.add(foldB);
    box(
      foldA,
      "StallDoorPanelA",
      [panel, 1.85, 0.04],
      [panel / 2, 1.05, 0],
      stallDoorMaterial,
    );
    box(
      foldB,
      "StallDoorPanelB",
      [panel, 1.85, 0.04],
      [panel / 2, 1.05, 0],
      stallDoorMaterial,
    );
    box(
      foldB,
      "StallDoorLatch",
      [0.05, 0.14, 0.07],
      [panel - 0.1, 1.05, 0],
      chrome,
    );
    for (const [target, offset] of [
      [foldA, 0],
      [foldB, 0],
    ] as const)
      box(
        target,
        "StallDoorHingeStrip",
        [0.03, 1.85, 0.06],
        [offset, 1.05, 0],
        chrome,
      );
    const name = crewNames[index];
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(panel * 0.92, panel * 0.46),
      comicLabelMaterial(name, index),
    );
    tag.name = "StallNameLabel";
    tag.position.set(panel / 2, 1.55, 0.023);
    foldA.add(tag);
    const body = physics.addBox(
      { x: panel * 2, y: 1.85, z: 0.04 },
      new THREE.Vector3(x, 1.05, doorZ),
    );
    // Every stall door starts closed.
    const door = { foldA, foldB, body, open: false, amount: 0 };
    door.amount = 0;
    body.collisionResponse = true;
    stallDoors.push(door);
    fixtures.push({
      id: `stall-door-${index + 1}`,
      label: "stall door",
      root: hinge,
      point: new THREE.Vector3(x, 1.1, doorZ),
      isOn: () => door.open,
      prompt: () => `E / ${door.open ? "Close" : "Open"} ${name}'s stall door`,
      toggle: () => {
        const blocking =
          Math.abs(lastPlayer.x - x) < 0.9 &&
          Math.abs(lastPlayer.z - doorZ) < 0.55;
        if (door.open && blocking) return;
        door.open = !door.open;
        playWorldSfx(door.open ? "door" : "doorClose", hinge, 14, 0.55);
      },
    });
  }

  // Lockers back to back down the middle of the room, with a bench well clear of each side so the doors can swing.
  const lockerLength = 7.2,
    lockerZ = -24,
    lockersPerSide = 4,
    unit = lockerLength / lockersPerSide,
    lockerDoorWidth = unit / 2 - 0.04;
  box(
    root,
    "LockerBlock",
    [0.12, 2.0, lockerLength],
    [0, 1.0, lockerZ],
    dark,
    true,
  );
  box(
    root,
    "LockerCap",
    [0.94, 0.05, lockerLength + 0.04],
    [0, 2.025, lockerZ],
    trim,
  );
  const lockerDoors: Array<{
    hinge: THREE.Group;
    swing: number;
    open: boolean;
    amount: number;
  }> = [];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < lockersPerSide; i++) {
      const centerLockerZ = lockerZ - lockerLength / 2 + unit * (i + 0.5);
      const cabin = CABINS[(side < 0 ? 0 : lockersPerSide) + i],
        name = cabin.occupant;
      const locker = new THREE.Group();
      locker.name = `Locker-${name}`;
      root.add(locker);
      const state = { open: false };
      const leaves: typeof lockerDoors = [];
      for (const y of [0.03, 0.55, 1.3, 1.97])
        box(
          locker,
          "LockerShelf",
          [0.39, 0.06, unit - 0.06],
          [side * 0.255, y, centerLockerZ],
          trim,
          true,
        );
      for (const end of [-1, 1])
        box(
          locker,
          "LockerDivider",
          [0.39, 2, 0.05],
          [side * 0.255, 1, centerLockerZ + (end * unit) / 2],
          dark,
          true,
        );
      const word = new Map([
        ["student-01", "YOU"],
        ["student-02", "ARE"],
        ["student-03", "A"],
        ["student-04", "CHUMP"],
        ["student-05", "BRONDON"],
      ]).get(cabin.id);
      if (word) addWordPicture(locker, name, word, side, centerLockerZ);
      for (const dir of [1, -1] as const) {
        const hinge = new THREE.Group();
        hinge.position.set(
          side * 0.46,
          1.0,
          centerLockerZ - dir * (unit / 2 - 0.02),
        );
        locker.add(hinge);
        box(
          hinge,
          "LockerDoor",
          [0.025, 1.8, lockerDoorWidth],
          [0, 0, (dir * lockerDoorWidth) / 2],
          lockerPaint,
        );
        for (let vent = 0; vent < 3; vent++)
          box(
            hinge,
            vent === 0 ? "LockerVent" : `LockerVent-${vent + 1}`,
            [0.012, 0.025, lockerDoorWidth - 0.3],
            [side * 0.018, 0.7 - vent * 0.07, (dir * lockerDoorWidth) / 2],
            sinkCabinet,
          );
        box(
          hinge,
          "LockerHandle",
          [0.03, 0.14, 0.03],
          [side * 0.025, -0.05, dir * (lockerDoorWidth - 0.1)],
          chrome,
        );
        if (dir === 1) {
          const tag = new THREE.Mesh(
            new THREE.PlaneGeometry(
              lockerDoorWidth * 0.95,
              lockerDoorWidth * 0.5,
            ),
            comicLabelMaterial(name, i + (side < 0 ? 0 : lockersPerSide)),
          );
          tag.name = "LockerNameLabel";
          tag.position.set(side * 0.0135, 0.45, lockerDoorWidth / 2);
          tag.rotation.y = (side * Math.PI) / 2;
          hinge.add(tag);
        }
        leaves.push({ hinge, swing: side * dir, open: false, amount: 0 });
      }
      lockerDoors.push(...leaves);
      fixtures.push({
        id: `locker-${name.toLowerCase()}`,
        label: "locker",
        root: locker,
        point: new THREE.Vector3(side * 0.5, 1.2, centerLockerZ),
        isOn: () => state.open,
        prompt: () =>
          `E / ${state.open ? "Close" : "Open"} ${name}${name.endsWith("'") ? "s" : "'s"} locker`,
        toggle: () => {
          state.open = !state.open;
          playWorldSfx(state.open ? "door" : "doorClose", locker, 12, 0.4);
          leaves.forEach((leaf) => {
            leaf.open = state.open;
          });
        },
      });
    }
    box(
      root,
      "BenchSeat",
      [0.42, 0.07, lockerLength - 0.4],
      [side * 2.55, 0.46, lockerZ],
      trim,
      true,
    );
    for (const legZ of [-1, 1])
      box(
        root,
        "BenchLeg",
        [0.34, 0.43, 0.06],
        [side * 2.55, 0.215, lockerZ + legZ * (lockerLength / 2 - 0.5)],
        dark,
      );
  }

  const bathroomMirrorZone = {
    minX: -hw,
    maxX: hw,
    minZ: backZ - 0.5,
    maxZ: frontZ + 1.5,
  };
  let clock = 0,
    showeringStall = -1;
  function update(dt: number, player: THREE.Vector3Like) {
    clock += dt;
    lastPlayer.set(player.x, player.y, player.z);
    const inside =
      player.x > bathroomMirrorZone.minX &&
      player.x < bathroomMirrorZone.maxX &&
      player.z > bathroomMirrorZone.minZ &&
      player.z < bathroomMirrorZone.maxZ;
    mirror.visible = inside;
    for (const { mesh, body, state } of curtains) {
      const target = state.open ? 1 : 0;
      state.amount += (target - state.amount) * Math.min(1, dt * 8);
      if (Math.abs(target - state.amount) < 0.01) state.amount = target;
      mesh.scale.z = 1 - state.amount * 0.88;
      mesh.position.z = state.z + state.amount * 0.74;
      body.collisionResponse = state.amount < 0.5;
    }
    for (const door of stallDoors) {
      const target = door.open ? 1 : 0;
      door.amount += (target - door.amount) * Math.min(1, dt * 8);
      if (Math.abs(target - door.amount) < 0.01) door.amount = target;
      door.foldA.rotation.y = door.amount * OPEN_FOLD;
      door.foldB.rotation.y = -2 * door.amount * OPEN_FOLD;
      door.body.collisionResponse = door.amount < 0.5;
    }
    for (const leaf of lockerDoors) {
      const target = leaf.open ? 1 : 0;
      leaf.amount += (target - leaf.amount) * Math.min(1, dt * 8);
      if (Math.abs(target - leaf.amount) < 0.01) leaf.amount = target;
      leaf.hinge.rotation.y = leaf.swing * leaf.amount * 1.75;
    }
    // Showering starts once the water is running with Brondon in the stall and lasts until he steps out.
    const stall = stallBounds.findIndex(
      (b) =>
        player.x > b.minX &&
        player.x < b.maxX &&
        player.z > b.minZ &&
        player.z < b.maxZ,
    );
    if (stall < 0) showeringStall = -1;
    else if (showeringStall !== stall)
      showeringStall = drops[stall]?.points.visible ? stall : -1;
    for (const field of drops) {
      if (!field.points.visible) continue;
      for (let i = 0; i < field.speeds.length; i++) {
        field.positions[i * 3 + 1] -= field.speeds[i] * dt;
        if (field.positions[i * 3 + 1] <= 0.06)
          respawn(field.positions, field.speeds, i, field.origin, false);
      }
      (
        field.points.geometry.attributes.position as THREE.BufferAttribute
      ).needsUpdate = true;
    }
    let waterDistance: number | null = null;
    for (const fixture of fixtures) {
      if (!fixture.id.startsWith("sink-") && !/^shower-\d+$/.test(fixture.id))
        continue;
      if (!fixture.isOn()) continue;
      const d = Math.hypot(
        fixture.point.x - player.x,
        fixture.point.y - player.y,
        fixture.point.z - player.z,
      );
      if (waterDistance === null || d < waterDistance) waterDistance = d;
    }
    updateRunningWaterAudio(waterDistance);
    for (const { mesh } of streams)
      if (mesh.visible)
        mesh.scale.x = mesh.scale.z =
          0.85 + Math.sin(clock * 40 + mesh.id) * 0.15;
    for (const fixture of fixtures) {
      const knob = knobs.get(fixture.id);
      if (!knob) continue;
      const target = fixture.isOn() ? Math.PI / 2 : 0;
      knob.rotation.x += (target - knob.rotation.x) * Math.min(1, dt * 10);
    }
  }
  function dispose() {
    disposed = true;
    stopRunningWaterAudio();
    mirror.dispose();
    for (const field of drops) {
      field.points.geometry.dispose();
      (field.points.material as THREE.Material).dispose();
    }
    waterMaterial.dispose();
    for (const material of labelMaterials) {
      material.map?.dispose();
      material.dispose();
    }
    curtainMaterial.dispose();
    stallDoorMaterial.dispose();
    porcelain.dispose();
    chrome.dispose();
    tile.dispose();
  }
  return {
    root,
    fixtures,
    seats,
    update,
    dispose,
    mirror,
    isShowering: () => showeringStall >= 0,
  };
}

function respawn(
  positions: Float32Array,
  speeds: Float32Array,
  index: number,
  origin: THREE.Vector3,
  scatter: boolean,
) {
  const angle = Math.random() * Math.PI * 2,
    spread = Math.random() * 0.12;
  positions[index * 3] =
    origin.x - Math.random() * 0.45 + Math.cos(angle) * spread * 0.4;
  positions[index * 3 + 1] = scatter
    ? 0.1 + Math.random() * (origin.y - 0.1)
    : origin.y - Math.random() * 0.05;
  positions[index * 3 + 2] = origin.z + Math.sin(angle) * spread;
  speeds[index] = 2.6 + Math.random() * 1.2;
}
