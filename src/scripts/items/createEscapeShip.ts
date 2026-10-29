import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  createEarthTextures,
  createEarthGroup,
  updateEarthGroup,
} from "../global/earthTexture.js";
import { disposeRoom } from "../global/shipRoom.js";
import { createStarfield, type Starfield } from "../global/starfield.js";
import { MECH_PALETTES } from "../level-3/finaleMaterials.js";

const cockpitGeometry = new Map<string, THREE.BufferGeometry>();

export function preloadEscapeShipGeometry() {
  const ship = createEscapeShip();
  disposeRoom(ship.root);
}

/** The same single-seat shuttle is used in the hangar and in playable space flight. */
export function createEscapeShip() {
  const root = new THREE.Group();
  root.name = "EscapeShuttle";
  const hull = new THREE.MeshStandardMaterial({
    color: MECH_PALETTES.hero.platelight,
    metalness: 0.65,
    roughness: 0.42,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: MECH_PALETTES.hero.plateshad,
    metalness: 0.6,
    roughness: 0.4,
  });
  const orange = new THREE.MeshStandardMaterial({
    color: MECH_PALETTES.hero.platemid,
    metalness: 0.4,
    roughness: 0.5,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x65bfda,
    transparent: true,
    opacity: 0.25,
    metalness: 0.5,
    roughness: 0.1,
    depthWrite: false,
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0x69cfff });
  const upholstery = new THREE.MeshStandardMaterial({
    color: 0x34434a,
    roughness: 0.95,
    metalness: 0.05,
  });
  const instrumentFace = new THREE.MeshStandardMaterial({
    color: 0x080f14,
    roughness: 0.55,
    metalness: 0.25,
  });
  function box(
    size: [number, number, number],
    p: [number, number, number],
    mat: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...p);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  const cabinCutter = new Brush(new THREE.BoxGeometry(1.7, 3.8, 3.6), hull);
  cabinCutter.position.set(0, 2.37, -0.15);
  cabinCutter.updateMatrixWorld(true);
  function carvedHull(
    key: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) {
    const prepared = cockpitGeometry.get(key);
    if (prepared) {
      geometry.dispose();
      const mesh = new THREE.Mesh(prepared.clone(), material);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    }
    const source = new Brush(geometry, material);
    source.updateMatrixWorld(true);
    const result = evaluator.evaluate(source, cabinCutter, SUBTRACTION);
    cockpitGeometry.set(key, result.geometry.clone());
    const mesh = new THREE.Mesh(result.geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    source.disposeCacheData();
    geometry.dispose();
    return mesh;
  }
  const fuselageGeometry = new THREE.CylinderGeometry(1.3, 1.05, 6.5, 20);
  fuselageGeometry.rotateX(Math.PI / 2);
  fuselageGeometry.scale(1, 0.55, 1);
  fuselageGeometry.translate(0, 0.95, 0);
  const fuselage = carvedHull("fuselage", fuselageGeometry, hull);
  fuselage.name = "ShuttleHullWithCockpitCutout";
  for (const side of [-1, 1]) {
    box([0.2, 0.8, 3.35], [side * 1.04, 1.06, -0.22], hull);
    box([0.24, 0.14, 3.45], [side * 1.04, 1.52, -0.22], dark);
    box([0.22, 0.42, 1.3], [side * 0.93, 1.53, -0.38], dark);
    const console = box(
      [0.3, 0.06, 1.1],
      [side * 0.91, 1.78, -0.38],
      instrumentFace,
    );
    console.rotation.z = -side * 0.12;
    for (const index of [0, 1, 2])
      box(
        [0.1, 0.025, 0.1],
        [side * 0.92, 1.84, -0.7 + index * 0.25],
        index === 0 ? orange : glow,
      );
  }
  box([1.8, 0.12, 3.2], [0, 0.5, -0.16], dark);
  carvedHull(
    "rear-bulkhead",
    new THREE.BoxGeometry(1.9, 0.82, 0.18).translate(0, 1.29, 1.47),
    hull,
  );
  carvedHull(
    "front-bulkhead",
    new THREE.BoxGeometry(1.9, 0.28, 1.22).translate(0, 1.29, -2.34),
    hull,
  );
  cabinCutter.disposeCacheData();
  cabinCutter.geometry.dispose();
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3.2, 8), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.scale.z = 0.55;
  nose.position.set(0, 0.95, -4.85);
  root.add(nose);
  box([1.8, 0.14, 7.6], [0, 0.42, -0.5], dark);
  box([0.3, 0.08, 3.8], [0, 1.68, -3.3], orange);
  const noseCap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), dark);
  noseCap.position.set(0, 0.95, -6.5);
  root.add(noseCap);
  const canopy = new THREE.Group();
  canopy.name = "ShuttleCanopy";
  canopy.position.set(0, 1.48, 1.12);
  root.add(canopy);
  const canopyProfile = [
    { z: 1.12, y: 1.48, width: 1.12 },
    { z: 0.78, y: 2.7, width: 0.96 },
    { z: -1.35, y: 2.7, width: 0.96 },
    { z: -2.08, y: 1.5, width: 1.12 },
  ];
  const canopyVertices = new Float32Array(
    canopyProfile.flatMap((section) => [
      -section.width,
      section.y,
      section.z,
      section.width,
      section.y,
      section.z,
    ]),
  );
  const canopyGeometry = new THREE.BufferGeometry();
  canopyGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(canopyVertices, 3),
  );
  canopyGeometry.setIndex([
    0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6, 0, 2, 4, 0, 4, 6, 1,
    5, 3, 1, 7, 5,
  ]);
  canopyGeometry.computeVertexNormals();
  glass.side = THREE.DoubleSide;
  const canopyGlass = new THREE.Mesh(canopyGeometry, glass);
  canopyGlass.name = "ShuttleWindshield";
  root.add(canopyGlass);
  canopy.attach(canopyGlass);
  function canopyStrut(
    start: THREE.Vector3,
    end: THREE.Vector3,
    thickness = 0.07,
  ) {
    const direction = end.clone().sub(start);
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(thickness, thickness, direction.length()),
      dark,
    );
    strut.position.copy(start).add(end).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction.normalize(),
    );
    root.add(strut);
    canopy.attach(strut);
    return strut;
  }
  for (const side of [-1, 1]) {
    const corners = canopyProfile.map(
      (section) =>
        new THREE.Vector3(side * section.width, section.y, section.z),
    );
    for (let index = 0; index < corners.length - 1; index++)
      canopyStrut(corners[index], corners[index + 1]);
    canopyStrut(corners[0], corners[3], 0.1);
  }
  for (const section of [canopyProfile[1], canopyProfile[2]])
    canopyStrut(
      new THREE.Vector3(-section.width, section.y, section.z),
      new THREE.Vector3(section.width, section.y, section.z),
    );
  const canopySupports = [-1, 1].map((side) => {
    const hinge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.18, 12),
      dark,
    );
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(side * 1.12, 1.48, 1.12);
    root.add(hinge);
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1, 10),
      dark,
    );
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.023, 0.023, 1, 8),
      hull,
    );
    root.add(sleeve, rod);
    return {
      base: new THREE.Vector3(side * 1.15, 1.15, -0.1),
      top: new THREE.Vector3(side * 1.02, 0.9, -1.3),
      sleeve,
      rod,
    };
  });
  function setCanopyOpen(amount: number) {
    canopy.rotation.x = THREE.MathUtils.clamp(amount, 0, 1) * 1.32;
    for (const support of canopySupports) {
      const end = support.top
        .clone()
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), canopy.rotation.x)
        .add(canopy.position);
      const direction = end.sub(support.base),
        length = direction.length();
      direction.normalize();
      const orientation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      );
      support.sleeve.quaternion.copy(orientation);
      support.rod.quaternion.copy(orientation);
      support.sleeve.scale.y = length * 0.56;
      support.rod.scale.y = length * 0.66;
      support.sleeve.position
        .copy(support.base)
        .addScaledVector(direction, length * 0.28);
      support.rod.position
        .copy(support.base)
        .addScaledVector(direction, length * 0.67);
    }
  }
  setCanopyOpen(0);
  const flaps: Array<{ hinge: THREE.Group; side: number }> = [];
  const nozzlePetals: Array<{ mesh: THREE.Mesh; angle: number }> = [];
  const engineGimbals: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const outline = new THREE.Shape();
    outline.moveTo(0, -1.8);
    outline.lineTo(side * 3.6, 0.6);
    outline.lineTo(side * 3.35, 2.5);
    outline.lineTo(0, 2);
    outline.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(outline, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.08,
      bevelThickness: 0.04,
      bevelSegments: 1,
      steps: 1,
    });
    wingGeo.rotateX(Math.PI / 2);
    const wing = new THREE.Mesh(wingGeo, hull);
    wing.position.set(side * 1.1, 0.95, 0.3);
    wing.castShadow = true;
    root.add(wing);
    for (const z of [-0.8, 0, 0.8, 1.6])
      box([0.03, 0.025, 0.6], [side * 2, 1.07, z], dark);
    box([0.12, 0.08, 1.25], [side * 4.35, 1.02, 1.65], orange);
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff4444 : 0x66ffbb }),
    );
    nav.position.set(side * 4.5, 1.08, 1.2);
    root.add(nav);
    const hinge = new THREE.Group();
    hinge.position.set(side * 2.9, 1, 2.3);
    root.add(hinge);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.13, 0.6), dark);
    flap.position.z = 0.3;
    hinge.add(flap);
    flaps.push({ hinge, side });
    const fin = box([0.13, 1.7, 1.9], [side * 1.35, 2, 2.3], hull);
    fin.rotation.z = -side * 0.25;
    box([0.15, 0.15, 1.45], [side * 1.55, 2.83, 2.3], orange);
    const engine = new THREE.Group();
    engine.position.set(side * 2.36, 0.9, 1.8);
    root.add(engine);
    engineGimbals.push(engine);
    for (const [radius, length, z] of [
      [0.62, 2.8, 0],
      [0.7, 0.16, -1.1],
      [0.68, 0.16, 1.15],
    ] as const) {
      const casing = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 20),
        z === 0 ? dark : hull,
      );
      casing.rotation.x = Math.PI / 2;
      casing.position.z = z;
      engine.add(casing);
    }
    const chamber = new THREE.Mesh(new THREE.CircleGeometry(0.46, 20), glow);
    chamber.position.z = 1.51;
    engine.add(chamber);
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      const petal = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.09, 0.65),
        hull,
      );
      petal.position.set(Math.cos(angle) * 0.54, Math.sin(angle) * 0.54, 1.55);
      petal.rotation.z = angle;
      engine.add(petal);
      nozzlePetals.push({ mesh: petal, angle });
    }
    for (let i = 0; i < 7; i++)
      box([0.4, 0.035, 0.07], [side * 0.82, 1.62, 1.45 + i * 0.2], dark);
  }
  for (const side of [-1, 1])
    for (const z of [-3.6, -2.8, 0.8, 2.5]) {
      box([0.045, 0.16, 0.055], [side * 1.29, 0.92, z], dark);
      box([0.18, 0.12, 0.3], [side * 1.28, 0.67, z], hull);
    }
  box([1.7, 0.16, 0.68], [0, 1.63, -1.4], dark);
  const dashboard = box([1.55, 0.42, 0.14], [0, 1.9, -1.53], instrumentFace);
  dashboard.rotation.x = -0.28;
  for (const x of [-0.5, 0, 0.5]) {
    const screen = box([0.42, 0.27, 0.02], [x, 1.91, -1.44], glow);
    screen.rotation.x = -0.28;
    for (const row of [0, 1, 2]) {
      const readout = box(
        [0.28 - row * 0.05, 0.025, 0.024],
        [x, 1.85 + row * 0.06, -1.423 + row * 0.018],
        instrumentFace,
      );
      readout.rotation.x = -0.28;
    }
  }
  const controlStick = box([0.08, 0.28, 0.08], [0, 1.47, -0.66], dark);
  controlStick.rotation.x = -0.22;
  box([0.28, 0.07, 0.09], [0, 1.63, -0.7], dark);
  box([0.12, 0.16, 0.25], [0, 1.15, -0.66], hull);
  for (const side of [-1, 1]) {
    const pedal = box([0.25, 0.08, 0.3], [side * 0.27, 1.04, -1.05], dark);
    pedal.rotation.x = -0.28;
  }
  const seat = new THREE.Group();
  seat.name = "ShuttlePilotSeat";
  root.add(seat);
  const seatPart = (
    dimensions: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
  ) => {
    const part = box(dimensions, position, material);
    seat.attach(part);
    return part;
  };
  seatPart([0.52, 0.14, 0.65], [0, 1.06, 0.3], dark);
  seatPart([0.72, 0.16, 0.78], [0, 1.2, 0.3], upholstery);
  const backrest = seatPart([0.76, 0.91, 0.16], [0, 1.64, 0.76], upholstery);
  backrest.rotation.x = -0.09;
  seatPart([0.5, 0.23, 0.16], [0, 2.19, 0.81], upholstery);
  for (const side of [-1, 1]) {
    seatPart([0.12, 0.46, 0.7], [side * 0.4, 1.34, 0.32], dark);
    seatPart([0.13, 0.07, 0.52], [side * 0.4, 1.61, 0.25], upholstery);
    seatPart([0.075, 0.72, 0.035], [side * 0.19, 1.63, 0.66], orange);
  }
  const boardingDeck = new THREE.Object3D();
  boardingDeck.name = "ShuttleBoardingDeck";
  boardingDeck.position.set(0, 0.62, -0.28);
  root.add(boardingDeck);
  const pilotSeat = new THREE.Object3D();
  pilotSeat.name = "ShuttlePilotPosition";
  pilotSeat.position.set(0, 1.28, 0.18);
  root.add(pilotSeat);
  const thrusters = [-2.36, 2.36].map((x) => {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2, 12), glow);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, 0.9, 4.1);
    root.add(flame);
    return flame;
  });
  const gear = [
    [-1.1, 1.9],
    [1.1, 1.9],
    [0, -3.1],
  ].map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.7, z);
    root.add(pivot);
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.085, 0.55, 12),
      hull,
    );
    strut.position.y = -0.28;
    pivot.add(strut);
    const piston = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.32, 10),
      dark,
    );
    piston.position.set(0.13, -0.22, 0.13);
    piston.rotation.x = -0.4;
    pivot.add(piston);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.85), dark);
    foot.position.y = -0.63;
    pivot.add(foot);
    return pivot;
  });
  let flying = false,
    gearFold = 0,
    thrust = 0,
    mechanismTime = 0;
  let pilot: THREE.Mesh | null = null;
  const cockpit = new THREE.Object3D();
  cockpit.position.set(0, 2.32, -0.12);
  root.add(cockpit);
  return {
    root,
    cockpit,
    canopy,
    seat,
    pilotSeat,
    boardingDeck,
    setPilotVisible(visible: boolean) {
      if (visible && !pilot) {
        pilot = createSeatedPilot();
        root.add(pilot);
      }
      if (pilot) pilot.visible = visible;
    },
    setThrust(amount: number) {
      thrust = Math.max(0, amount);
      root.userData.engineThrust = thrust;
      thrusters.forEach((t, i) => {
        t.visible = amount > 0;
        t.scale.y =
          0.45 + amount * (1 + Math.sin(mechanismTime * 27 + i) * 0.08);
      });
    },
    setCanopyOpen,
    setFlying(active: boolean, immediate = false) {
      flying = active;
      if (immediate) {
        gearFold = active ? 1 : 0;
        gear.forEach((g) => {
          g.rotation.x = gearFold * Math.PI * 0.48;
          g.visible = gearFold < 0.99;
        });
      }
    },
    update(dt: number) {
      mechanismTime += dt;
      gearFold = THREE.MathUtils.damp(gearFold, flying ? 1 : 0, 3, dt);
      gear.forEach((g) => {
        g.rotation.x = gearFold * Math.PI * 0.48;
        g.visible = gearFold < 0.995;
      });
      flaps.forEach(({ hinge, side }) => {
        hinge.rotation.x = flying
          ? Math.sin(mechanismTime * 1.7 + side) * 0.06 - 0.12
          : 0.3;
      });
      engineGimbals.forEach((g, i) => {
        g.rotation.x = flying
          ? Math.sin(mechanismTime * 1.5 + i) * 0.035
          : -0.16 * Math.min(thrust, 1);
      });
      nozzlePetals.forEach(({ mesh, angle }) => {
        const radius = 0.5 + Math.min(thrust, 1.6) * 0.07;
        mesh.position.x = Math.cos(angle) * radius;
        mesh.position.y = Math.sin(angle) * radius;
      });
    },
  };
}

function createSeatedPilot() {
  const parts: THREE.BufferGeometry[] = [];
  const suit = 0x293e48,
    armor = 0x9aaeb7,
    trim = 0xe5a343;
  function part(geometry: THREE.BufferGeometry, color: number) {
    const surface = geometry.index ? geometry.toNonIndexed() : geometry;
    if (surface !== geometry) geometry.dispose();
    const tint = new THREE.Color(color),
      colors = new Float32Array(surface.attributes.position.count * 3);
    for (let vertex = 0; vertex < colors.length; vertex += 3)
      tint.toArray(colors, vertex);
    surface.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    parts.push(surface);
  }
  function block(
    size: [number, number, number],
    position: [number, number, number],
    color: number,
  ) {
    part(new THREE.BoxGeometry(...size).translate(...position), color);
  }
  function limb(
    from: [number, number, number],
    to: [number, number, number],
    radius: number,
    color: number,
  ) {
    const start = new THREE.Vector3(...from),
      end = new THREE.Vector3(...to),
      direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(
      radius * 0.82,
      radius,
      direction.length(),
      6,
    );
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    );
    const center = start.add(end).multiplyScalar(0.5);
    geometry.translate(center.x, center.y, center.z);
    part(geometry, color);
  }
  block([0.46, 0.55, 0.3], [0, 1.66, 0.22], suit);
  block([0.4, 0.29, 0.06], [0, 1.71, 0.05], armor);
  block([0.47, 0.22, 0.38], [0, 1.38, 0.16], suit);
  block([0.47, 0.055, 0.39], [0, 1.46, 0.16], trim);
  limb([0, 1.9, 0.2], [0, 1.99, 0.2], 0.075, suit);
  part(
    new THREE.SphereGeometry(0.19, 8, 6)
      .scale(1, 1.12, 0.95)
      .translate(0, 2.12, 0.2),
    armor,
  );
  block([0.22, 0.1, 0.045], [0, 2.08, 0.017], 0xd1ab92);
  block([0.26, 0.065, 0.06], [0, 2.17, 0.01], 0x57b8cf);
  for (const side of [-1, 1]) {
    limb([side * 0.17, 1.36, 0.15], [side * 0.19, 1.26, -0.51], 0.095, suit);
    limb([side * 0.19, 1.26, -0.51], [side * 0.19, 0.72, -0.9], 0.078, suit);
    block([0.16, 0.12, 0.3], [side * 0.19, 0.62, -1.01], suit);
    limb([side * 0.25, 1.85, 0.2], [side * 0.31, 1.57, -0.12], 0.083, armor);
    limb([side * 0.31, 1.57, -0.12], [side * 0.13, 1.63, -0.67], 0.066, suit);
    part(
      new THREE.SphereGeometry(0.065, 6, 4).translate(side * 0.13, 1.63, -0.67),
      suit,
    );
  }
  const geometry = mergeGeometries(parts, false)!;
  parts.forEach((surface) => surface.dispose());
  const pilot = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0.12,
    }),
  );
  pilot.name = "ShuttleLowPolyPilot";
  return pilot;
}

/** Shared pod keeps the boss ejection and planetary pursuit visually continuous. */
export function createEscapePod(options: { occupant?: boolean; opening?: boolean } = {}) {
  const root = new THREE.Group();
  root.name = "EscapePod";
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x141d24,
    metalness: 0.65,
    roughness: 0.5,
  });
  const neon = new THREE.MeshBasicMaterial({ color: 0x54ff3c });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fd8b0,
    transparent: true,
    opacity: 0.14,
    roughness: 0.08,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fluidMat = new THREE.MeshBasicMaterial({
    color: 0x54ff3c,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const silhouetteMat = new THREE.MeshStandardMaterial({
    color: 0x0a0f14,
    emissive: 0x1a2a3a,
    emissiveIntensity: 0.6,
    roughness: 0.9,
  });

  // Glass containment tube along the travel axis, with the trapped occupant inside
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.05, 3.2, 24, 1, true),
    glassMat,
  );
  tube.rotation.x = Math.PI / 2;
  root.add(tube);
  const fluid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 3.0, 20, 1, true),
    fluidMat,
  );
  fluid.rotation.x = Math.PI / 2;
  root.add(fluid);
  const occupant = new THREE.Group();
  occupant.visible = options.occupant !== false;
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.8, 4, 8),
    silhouetteMat,
  );
  torso.rotation.x = Math.PI / 2;
  occupant.add(torso);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    silhouetteMat,
  );
  head.position.z = -0.62;
  occupant.add(head);
  root.add(occupant);
  const glow = new THREE.PointLight(0x54ff3c, 6, 6);
  root.add(glow);

  // Longitudinal struts + neon strips on the diagonals
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const cx = Math.cos(a),
      cy = Math.sin(a);
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 3.2),
      darkMetal,
    );
    strut.position.set(cx * 1.12, cy * 1.12, 0);
    strut.rotation.z = a;
    root.add(strut);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.6), neon);
    strip.position.set(cx * 1.2, cy * 1.2, 0);
    strip.rotation.z = a;
    root.add(strip);
  }

  // Dark nose/tail caps joined by glowing rim rings
  const nose = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.2, 1.0, 24),
    darkMetal,
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.1;
  root.add(nose);
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.05, 1.0, 24),
    darkMetal,
  );
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = 2.1;
  root.add(tail);
  if (options.opening) {
    const exitDoor = new THREE.Group();
    exitDoor.name = "PodExitDoor";
    exitDoor.position.set(1.25, 0, 1.6);
    root.add(exitDoor);
    exitDoor.attach(tail);
  }
  for (const z of [-1.6, 1.6]) {
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(1.22, 1.22, 0.12, 24, 1, true),
      neon,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.z = z;
    root.add(rim);
  }

  const hatch = new THREE.Group();
  hatch.name = "PodHatch";
  hatch.position.set(0.75, 0.7, 0);
  root.add(hatch);
  const hatchPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 1.1, 1.55),
    darkMetal,
  );
  hatchPanel.position.set(0.25, -0.45, 0);
  hatch.add(hatchPanel);
  const trail = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 7, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff8833,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  trail.rotation.x = -Math.PI / 2;
  trail.position.z = 5;
  trail.name = "PodTrail";
  root.add(trail);
  return root;
}

export function addPlanetBackdrop(
  scene: THREE.Scene,
  position: THREE.Vector3,
  radius: number,
  starRadius: number,
  options: {
    nebulaOpacity?: number;
    nebulaProgress?: number;
    renderer?: THREE.WebGLRenderer;
  } = {},
): { planet: THREE.Group; starfield: Starfield } {
  const earthGroup = createEarthGroup(
    scene,
    position,
    radius,
    createEarthTextures(),
  );
  earthGroup.name = "NearestPlanet";
  const starfield = createStarfield({
    scene,
    renderer: options.renderer,
    scale: starRadius / 170,
    nebulaScale: Math.min(starRadius / 170, 100),
    sizeScale: starRadius / 100,
    glowOpacity: 0.08,
    nebulaOpacity: options.nebulaOpacity,
    nebulaProgress: options.nebulaProgress,
    // Scene 1 palette without the red tones, which read as enemy bullets.
    starColors: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, 0.9, 0.4],
      [1, 0.6, 0.2],
    ],
  });
  return { planet: earthGroup, starfield };
}

export function animatePlanetBackdrop(group: THREE.Group, dt: number): void {
  updateEarthGroup(group, dt);
}
