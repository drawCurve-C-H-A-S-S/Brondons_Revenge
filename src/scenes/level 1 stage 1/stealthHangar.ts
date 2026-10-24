import * as THREE from "three";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { roomBox } from "../../scripts/global/shipRoom.js";
import {
  createShipInteriorMaterials,
  SHIP_INTERIOR_PALETTE,
} from "../../scripts/global/shipInterior.js";
import { LADDER } from "../../utils/constants.js";
import beamVertex from "../../shaders/vert/stealthBeam.vert.glsl?raw";
import beamFragment from "../../shaders/frag/stealthBeam.frag.glsl?raw";

type Physics = ReturnType<typeof createScenePhysics>;
export type HangarPoint = { x: number; z: number };
const CRAWL_ROW_BY_COLUMN = [0, 2, 1, null] as const;
export const HANGAR_LAYOUT = {
  bounds: { minX: 14, maxX: 86, minZ: -24, maxZ: 24 },
  height: 12,
  entrance: { x: 14, z: -2.5 },
  checkpoint: { x: 17.4, z: -2.5 },
  exit: { x: 86, z: 0 },
  ventAccess: { x: 83, z: -22, height: 12, side: 1 },
  musicTriggerX: 43,
  containers: [27, 43, 63, 75].flatMap((x, column) =>
    [-15, 0, 15].map((z, row) => ({
      x,
      z,
      width: 8,
      depth: 6,
      height: 3.2,
      stacked: (column + row) % 3 !== 1,
      color: (column + row) % 4,
      crawl: CRAWL_ROW_BY_COLUMN[column] === row,
    })),
  ),
  roofLinks: [
    [0, 3],
    [3, 4],
    [4, 5],
    [6, 7],
    [7, 8],
    [8, 11],
    [10, 11],
  ],
  crawlOpening: { depth: 1.8, height: 1.35 },
  roofCover: { width: 2.1, height: 1.35, depth: 1.15, offsetX: 2.25, offsetZ: 1.45 },
  panels: [
    { x: 24, z: -21 },
    { x: 46, z: 21 },
    { x: 68, z: -21 },
  ],
} as const;

export function createStealthHangar(
  scene: THREE.Scene,
  physics: Physics,
  deckY: number,
) {
  const {
    steel,
    dark,
    trim,
    cyan: teal,
    deck: floor,
  } = createShipInteriorMaterials(36, 24);
  const panelSteel = steel.clone();
  panelSteel.color.setHex(0x61758a);
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xb9a45c,
    roughness: 0.78,
    metalness: 0.25,
  });
  const white = new THREE.MeshStandardMaterial({
    color: SHIP_INTERIOR_PALETTE.light,
    emissive: SHIP_INTERIOR_PALETTE.light,
    emissiveIntensity: 1.2,
  });
  const cargoMaterials = [0x536b7d, 0x65717f, 0x455967, 0x68758a].map(
    (color) => {
      const material = steel.clone();
      material.color.setHex(color);
      return material;
    },
  );
  const obstacles: THREE.Box3[] = [];
  const details = new Map<THREE.Material, THREE.Matrix4[]>();
  const transform = new THREE.Object3D();
  function detail(
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material = dark,
    yaw = 0,
  ) {
    transform.position.set(position[0], deckY + position[1], position[2]);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(...size);
    transform.updateMatrix();
    let matrices = details.get(material);
    if (!matrices) {
      matrices = [];
      details.set(material, matrices);
    }
    matrices.push(transform.matrix.clone());
  }
  function box(
    size: [number, number, number],
    position: [number, number, number],
    material = steel,
    blockNavigation = false,
  ) {
    const mesh = roomBox(
      scene,
      physics,
      size,
      [position[0], deckY + position[1], position[2]],
      material,
    );
    if (blockNavigation)
      obstacles.push(
        new THREE.Box3(
          new THREE.Vector3(
            position[0] - size[0] / 2,
            deckY,
            position[2] - size[2] / 2,
          ),
          new THREE.Vector3(
            position[0] + size[0] / 2,
            deckY + size[1],
            position[2] + size[2] / 2,
          ),
        ),
      );
    return mesh;
  }

  const { minZ, maxZ } = HANGAR_LAYOUT.bounds;
  const roomDepth = maxZ - minZ;
  box([72, 0.3, roomDepth], [50, -0.15, 0], floor).name = "DeckOneHangarFloor";
  const roof = new THREE.Group();
  roof.name = "HangarRoof";
  roof.userData.minimap = false;
  scene.add(roof);
  const hatch = HANGAR_LAYOUT.ventAccess,
    hatchHalf = 0.85;
  for (const [panelMinX, panelMaxX, panelMinZ, panelMaxZ] of [
    [14, hatch.x - hatchHalf, minZ, maxZ],
    [hatch.x + hatchHalf, 86, minZ, maxZ],
    [hatch.x - hatchHalf, hatch.x + hatchHalf, minZ, hatch.z - hatchHalf],
    [hatch.x - hatchHalf, hatch.x + hatchHalf, hatch.z + hatchHalf, maxZ],
  ]) {
    const panel = box(
      [panelMaxX - panelMinX, 0.25, panelMaxZ - panelMinZ],
      [(panelMinX + panelMaxX) / 2, 12, (panelMinZ + panelMaxZ) / 2],
      dark,
    );
    panel.userData.minimap = false;
    roof.add(panel);
  }
  for (const z of [minZ, maxZ]) box([72, 12, 0.4], [50, 6, z]);
  for (const [x, doorZ] of [
    [14, -2.5],
    [HANGAR_LAYOUT.exit.x, HANGAR_LAYOUT.exit.z],
  ]) {
    const lowerLength = doorZ - 1.6 - minZ;
    const upperLength = maxZ - doorZ - 1.6;
    box([0.4, 12, lowerLength], [x, 6, minZ + lowerLength / 2]);
    box([0.4, 12, upperLength], [x, 6, doorZ + 1.6 + upperLength / 2]);
    box([0.4, 8.6, 3.2], [x, 7.7, doorZ]);
  }
  for (const sign of [-1, 1]) {
    for (const x of [22, 30, 38, 46, 54, 62, 70, 78]) {
      detail([7.2, 4.8, 0.06], [x, 4.6, sign * (maxZ - 0.24)], panelSteel);
      detail([0.08, 10.8, 0.1], [x + 3.75, 5.5, sign * (maxZ - 0.28)]);
      detail([6.7, 0.055, 0.08], [x, 2.1, sign * (maxZ - 0.3)], trim);
      detail([6.7, 0.055, 0.08], [x, 7.1, sign * (maxZ - 0.3)], trim);
    }
    detail([70, 0.025, 0.035], [50, 0.014, sign * (maxZ - 0.7)], teal);
    detail([70, 0.045, 0.08], [50, 0.2, sign * (maxZ - 0.35)], trim);
    detail([70, 0.035, 0.045], [50, 7.5, sign * (maxZ - 0.35)], teal);
  }
  for (const x of [18, 34, 50, 66, 82]) {
    detail([0.12, 0.025, roomDepth - 10], [x, 10.63, 0], teal);
    for (const sign of [-1, 1]) {
      box([0.75, 12, 0.85], [x, 6, sign * (maxZ - 0.6)], dark);
      detail([1.3, 0.2, roomDepth - 1], [x, 11.1, 0], trim);
      detail([0.18, 0.5, roomDepth - 1], [x - 0.55, 10.9, 0]);
      detail([0.18, 0.5, roomDepth - 1], [x + 0.55, 10.9, 0]);
      detail([0.1, 0.45, 0.05], [x, 1.2, sign * (maxZ - 1.05)], yellow);
    }
  }

  const crawlPassages: Array<{
    id: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
  }> = [];
  for (const [index, cargo] of HANGAR_LAYOUT.containers.entries()) {
    const material = cargoMaterials[cargo.color];
    for (let tier = 0; tier < (cargo.stacked ? 2 : 1); tier++) {
      const y = cargo.height * (tier + 0.5);
      const crawl = tier === 0 && cargo.crawl;
      const opening = HANGAR_LAYOUT.crawlOpening;
      const sideDepth = (cargo.depth - opening.depth) / 2;
      const container = box(
        [
          cargo.width,
          crawl ? cargo.height - opening.height : cargo.height,
          cargo.depth,
        ],
        [cargo.x, crawl ? (cargo.height + opening.height) / 2 : y, cargo.z],
        material,
        tier === 0,
      );
      container.name = `HangarCargo-${index}-${tier}`;
      if (crawl) {
        // Keep the complete footprint blocked for robots; only the player can crouch through.
        for (const sign of [-1, 1]) {
          box(
            [cargo.width, opening.height, sideDepth],
            [
              cargo.x,
              opening.height / 2,
              cargo.z + (sign * (opening.depth + sideDepth)) / 2,
            ],
            material,
          ).name = `CargoCrawlSide-${index}-${sign}`;
          const x = cargo.x + sign * (cargo.width / 2 + 0.08);
          detail(
            [0.12, 0.1, opening.depth],
            [x, opening.height + 0.05, cargo.z],
            yellow,
          );
          for (const edge of [-1, 1])
            detail(
              [0.12, opening.height, 0.1],
              [
                x,
                opening.height / 2,
                cargo.z + edge * (opening.depth / 2 + 0.05),
              ],
              yellow,
            );
          detail([0.08, 0.035, opening.depth - 0.2], [x, 0.02, cargo.z], teal);
        }
        crawlPassages.push({
          id: `CargoCrawl-${index}`,
          x: cargo.x,
          z: cargo.z,
          width: cargo.width,
          ...opening,
        });
      }
      for (const sign of [-1, 1]) {
        for (let rib = -3.65; rib <= 3.65; rib += 0.42)
          detail(
            [0.08, 2.85, 0.09],
            [cargo.x + rib, y, cargo.z + sign * 3.04],
            material,
          );
        for (const edge of [-1, 1]) {
          detail(
            [8.12, 0.14, 0.1],
            [cargo.x, y + edge * 1.5, cargo.z + sign * 3.08],
          );
          detail([0.1, 0.16, 6.12], [cargo.x + edge * 4.04, y - 1.49, cargo.z]);
          detail(
            [0.12, 3.15, 0.16],
            [cargo.x + edge * 3.95, y, cargo.z + sign * 2.98],
          );
          detail(
            [0.11, 2.8, 0.1],
            [cargo.x + sign * 4.08, y, cargo.z + edge * 1.2],
            yellow,
          );
        }
        if (!crawl)
          detail([0.13, 2.95, 0.15], [cargo.x + sign * 4.1, y, cargo.z]);
        detail(
          [0.18, 0.14, 0.6],
          [cargo.x + sign * 4.15, y - 0.1, cargo.z - 1.2],
        );
        detail(
          [0.18, 0.14, 0.6],
          [cargo.x + sign * 4.15, y - 0.1, cargo.z + 1.2],
        );
      }
    }
  }
  // Roof bounds are traversal metadata, not detection immunity.
  const safeZones: Array<{
    id: string;
    kind: "refuge" | "roof";
    bounds: THREE.Box3;
  }> = [];
  const ladders: Array<{
    id: string;
    x: number;
    z: number;
    topZ: number;
    height: number;
    side: number;
    roof: string;
  }> = [];
  const rooftops = HANGAR_LAYOUT.containers.map((cargo, index) => {
    const height = cargo.height * (cargo.stacked ? 2 : 1),
      side = cargo.z < 0 ? -1 : 1;
    const id = `cargo-roof-${index}`,
      ladderZ = cargo.z + side * (cargo.depth / 2 + 0.28);
    const coverShape = HANGAR_LAYOUT.roofCover;
    for (const side of [-1, 1]) {
      const cover = box(
        [coverShape.width, coverShape.height, coverShape.depth],
        [
          cargo.x + side * coverShape.offsetX,
          height + coverShape.height / 2,
          cargo.z + coverShape.offsetZ,
        ],
        cargoMaterials[cargo.color],
      );
      cover.name = `CargoRoofCover-${index}-${side}`;
      detail(
        [coverShape.width + 0.1, 0.08, coverShape.depth + 0.08],
        [
          cargo.x + side * coverShape.offsetX,
          height + coverShape.height + 0.04,
          cargo.z + coverShape.offsetZ,
        ],
        dark,
      );
    }
    ladders.push({
      id: `CargoLadder-${index}`,
      x: cargo.x + 1.5,
      z: ladderZ,
      topZ: cargo.z + side * (cargo.depth / 2 - 0.9),
      height: deckY + height,
      side,
      roof: id,
    });
    for (const offset of [-0.48, 0.48])
      detail(
        [0.07, height + 0.6, 0.08],
        [cargo.x + 1.5 + offset, (height + 0.6) / 2, ladderZ],
        yellow,
      );
    for (let y = 0.25; y < height + 0.4; y += LADDER.rungSpacing)
      detail([1.02, 0.055, 0.09], [cargo.x + 1.5, y, ladderZ], steel);
    for (const sign of [-1, 1])
      detail(
        [0.08, 0.04, 5.8],
        [cargo.x + sign * 3.85, height + 0.025, cargo.z],
        yellow,
      );
    safeZones.push({
      id,
      kind: "roof",
      bounds: new THREE.Box3(
        new THREE.Vector3(cargo.x - 3.8, deckY + height - 0.15, cargo.z - 2.8),
        new THREE.Vector3(cargo.x + 3.8, deckY + height + 2, cargo.z + 2.8),
      ),
    });
    return {
      id,
      x: cargo.x,
      z: cargo.z,
      height: deckY + height,
      width: cargo.width,
      depth: cargo.depth,
    };
  });

  const platforms = HANGAR_LAYOUT.roofLinks.map(
    ([fromIndex, toIndex], index) => {
      const from = rooftops[fromIndex],
        to = rooftops[toIndex];
      const alongX = from.z === to.z,
        sign = Math.sign(alongX ? to.x - from.x : to.z - from.z);
      const start = new THREE.Vector3(
        from.x + (alongX ? (sign * from.width) / 2 : 0),
        from.height,
        from.z + (alongX ? -1.45 : (sign * from.depth) / 2),
      );
      const end = new THREE.Vector3(
        to.x - (alongX ? (sign * to.width) / 2 : 0),
        to.height,
        to.z + (alongX ? -1.45 : (-sign * to.depth) / 2),
      );
      const delta = end.clone().sub(start),
        length = delta.length();
      const root = new THREE.Group();
      root.name = `CargoCatwalk-${index}`;
      root.position.copy(start).add(end).multiplyScalar(0.5);
      root.rotation.set(
        0,
        -Math.atan2(delta.z, delta.x),
        Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
      );
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.18, 2.2),
        steel,
      );
      mesh.name = `CargoCatwalkDeck-${index}`;
      mesh.position.y = -0.09;
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
      scene.add(root);
      root.updateWorldMatrix(true, true);
      const body = physics.addBoxFromMesh(mesh);
      const railBodies: ReturnType<Physics["addBoxFromMesh"]>[] = [];
      for (const side of [-1, 1]) {
        const guardrail = new THREE.Mesh(
          new THREE.BoxGeometry(length, 0.07, 0.07),
          yellow,
        );
        guardrail.position.set(0, 0.95, side * 1.1);
        guardrail.castShadow = true;
        root.add(guardrail);
        const railingCollider = new THREE.Mesh(
          new THREE.BoxGeometry(length, 1.02, 0.1),
          yellow,
        );
        railingCollider.name = `CargoCatwalkRailingCollider-${index}-${side}`;
        railingCollider.position.set(0, 0.5, side * 1.1);
        railingCollider.visible = false;
        root.add(railingCollider);
        railBodies.push(physics.addBoxFromMesh(railingCollider));
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(length, 0.13, 0.09),
          dark,
        );
        edge.position.set(0, 0.065, side * 1.06);
        root.add(edge);
        for (
          let offset = -length / 2 + 0.4;
          offset < length / 2;
          offset += 1.8
        ) {
          const post = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.95, 0.06),
            yellow,
          );
          post.position.set(offset, 0.475, side * 1.1);
          root.add(post);
        }
      }
      for (
        let offset = -length / 2 + 0.3;
        offset < length / 2;
        offset += 0.42
      ) {
        const tread = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.025, 2.03),
          dark,
        );
        tread.position.set(offset, 0.0125, 0);
        root.add(tread);
      }
      root.updateWorldMatrix(true, true);
      return {
        id: root.name,
        from: from.id,
        to: to.id,
        start,
        end,
        mesh,
        body,
        railBodies,
        x: root.position.x,
        z: root.position.z,
        height: root.position.y,
        width: length,
        depth: 2.2,
      };
    },
  );
  const scanSurfaces = [...rooftops, ...platforms];

  const panels = HANGAR_LAYOUT.panels.map((point, index) => {
    const root = new THREE.Group();
    root.name = `HangarAlarmRelay-${index}`;
    root.position.set(point.x, deckY, point.z);
    scene.add(root);
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 1.1, 0.35),
      dark,
    );
    pedestal.position.y = 0.55;
    root.add(pedestal);
    const casing = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.65, 0.5),
      yellow,
    );
    casing.position.y = 1.3;
    root.add(casing);
    physics.addBox(
      { x: 0.9, y: 1.7, z: 0.55 },
      { x: point.x, y: deckY + 0.85, z: point.z },
    );
    const indicatorMaterial = new THREE.MeshStandardMaterial({
      color: 0x92d1b5,
      emissive: 0x5aa883,
      emissiveIntensity: 1.2,
    });
    const indicator = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.055, 0.015),
      indicatorMaterial,
    );
    indicator.position.set(0, 1.43, 0.26);
    root.add(indicator);
    const switchLever = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.23, 8),
      dark,
    );
    switchLever.rotation.x = Math.PI / 4;
    switchLever.position.set(0.24, 1.2, 0.28);
    root.add(switchLever);
    return {
      id: root.name,
      root,
      position: root.position,
      indicator: indicatorMaterial,
    };
  });

  const edgeSensors = [-1, 1].flatMap((sign) =>
    [22, 38, 54, 70].map((x, index) => ({
      id: `HangarEdgeSensor-${sign < 0 ? "North" : "South"}-${index}`,
      x,
      z: sign * (maxZ - 1.25),
      width: 6.2,
      depth: 2.5,
    })),
  );

  for (const z of [minZ + 3.5, maxZ - 3.5]) {
    detail([66, 0.3, 0.3], [50, 9.5, z]);
    detail([66, 0.065, 0.08], [50, 9.7, z], yellow);
    for (const x of [23, 47, 71]) {
      detail([1.4, 0.07, 0.25], [x, 7.8, z], white);
      const light = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 8.5, 23);
      light.position.set(x, deckY + 7.5, z);
      scene.add(light);
    }
  }
  detail([2.1, 0.65, roomDepth - 6], [49, 9.2, 0], yellow);
  for (const x of [48.2, 49.8]) detail([0.15, 4.2, 0.12], [x, 6.9, 4]);
  detail([3.8, 0.5, 3], [49, 4.9, 4], yellow);
  detail([0.25, 0.8, 0.3], [49, 4.25, 4]);
  for (const sign of [-1, 1]) {
    for (let x = 16; x < 84; x += 3)
      detail([0.8, 0.025, 0.15], [x, 0.02, sign * 9.5], yellow, -0.55);
  }

  const {
    x: ventLadderX,
    z: landingZ,
    height: ventRise,
    side: ventLadderSide,
  } = HANGAR_LAYOUT.ventAccess;
  const ventLadderZ = landingZ - ventLadderSide * LADDER.bodyOffset;
  const ventLadderHeight = deckY + ventRise + 0.125;
  for (const offset of [-0.48, 0.48])
    detail(
      [0.07, ventRise + 0.3, 0.08],
      [ventLadderX + offset, (ventRise + 0.3) / 2, ventLadderZ],
      yellow,
    );
  for (let y = 0.25; y < ventRise + 0.4; y += LADDER.rungSpacing)
    detail([1.02, 0.055, 0.09], [ventLadderX, y, ventLadderZ], steel);
  for (const side of [-1, 1]) {
    const shaft = box(
      [0.12, 1.35, 1.7],
      [ventLadderX + side * hatchHalf, ventRise + 0.75, landingZ],
      dark,
    );
    shaft.name = "VentCeilingShaft";
    shaft.userData.minimap = false;
    box(
      [1.7, 1.35, 0.12],
      [ventLadderX, ventRise + 0.75, landingZ + side * hatchHalf],
      dark,
    ).userData.minimap = false;
    detail(
      [1.85, 0.06, 0.1],
      [ventLadderX, ventRise - 0.15, landingZ + side * hatchHalf],
      yellow,
    );
    detail(
      [0.1, 0.06, 1.7],
      [ventLadderX + side * hatchHalf, ventRise - 0.15, landingZ],
      yellow,
    );
  }
  detail(
    [0.7, 0.035, 0.045],
    [ventLadderX, ventRise - 0.18, landingZ + hatchHalf - 0.02],
    teal,
  );
  const ventLadderLight = new THREE.PointLight(
    SHIP_INTERIOR_PALETTE.light,
    6,
    10,
  );
  ventLadderLight.position.set(ventLadderX, deckY + 10.5, landingZ);
  scene.add(ventLadderLight);
  ladders.push({
    id: "VentAccessLadder",
    x: ventLadderX,
    z: ventLadderZ,
    topZ: landingZ,
    height: ventLadderHeight,
    side: ventLadderSide,
    roof: "vent-access",
  });
  safeZones.push({
    id: "vent-access",
    kind: "roof",
    bounds: new THREE.Box3(
      new THREE.Vector3(
        ventLadderX - 1,
        ventLadderHeight - 0.15,
        landingZ - 0.8,
      ),
      new THREE.Vector3(
        ventLadderX + 1,
        ventLadderHeight + 1.3,
        landingZ + 0.8,
      ),
    ),
  });
  const exitLight = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 8, 12);
  exitLight.position.set(HANGAR_LAYOUT.exit.x - 2, deckY + 3, HANGAR_LAYOUT.exit.z);
  scene.add(exitLight);
  const fillLight = new THREE.HemisphereLight(0xbbd7ed, 0x273342, 1.8);
  fillLight.intensity = 0;
  scene.add(fillLight);
  const beacon = new THREE.Group();
  beacon.name = "CentralRotatingAlarmBeacon";
  beacon.position.set(50, deckY + 11.1, 0);
  scene.add(beacon);
  const beaconBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 0.7, 0.16, 20),
    dark,
  );
  beaconBase.position.y = 0.55;
  beacon.add(beaconBase);
  const beaconGlow = new THREE.MeshStandardMaterial({
    color: 0xe5433f,
    emissive: 0xff332b,
    emissiveIntensity: 0.12,
  });
  const beaconLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.43, 0.43, 0.62, 20),
    beaconGlow,
  );
  beaconLens.position.y = 0.12;
  beacon.add(beaconLens);
  const beaconCone = new THREE.CylinderGeometry(0.04, 1, 1, 32, 1, true);
  const alarmSpots = [0, Math.PI].map((offset, index) => {
    const light = new THREE.SpotLight(
      0xff5147,
      1000,
      105,
      Math.PI / 5,
      0.55,
      1.2,
    );
    light.position.set(Math.sin(offset) * 0.35, 0, Math.cos(offset) * 0.35);
    light.visible = false;
    light.castShadow = index === 0;
    light.shadow.mapSize.set(512, 512);
    beacon.add(light);
    scene.add(light.target);
    const material = new THREE.ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: {
        uColor: { value: new THREE.Color(0xff5147) },
        uTime: { value: 0 },
        uAlert: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(beaconCone, material);
    beam.userData.minimap = false;
    beam.visible = false;
    scene.add(beam);
    return { light, beam, offset };
  });
  const alarmFill = new THREE.PointLight(0xff5147, 18, 88, 0.7);
  alarmFill.position.copy(beacon.position);
  alarmFill.visible = false;
  scene.add(alarmFill);
  let beaconTime = 0;
  const beaconSource = new THREE.Vector3(),
    beaconDirection = new THREE.Vector3();
  function updateAlarm(dt: number, active: boolean) {
    beaconTime = active ? beaconTime + dt : 0;
    beacon.rotation.y = beaconTime * 0.95;
    beaconGlow.emissiveIntensity = active ? 2.2 : 0.12;
    alarmFill.visible = active;
    beacon.updateMatrixWorld(true);
    for (const spot of alarmSpots) {
      spot.light.visible = spot.beam.visible = active;
      const angle = beacon.rotation.y + spot.offset;
      spot.light.target.position.set(
        50 + Math.sin(angle) * 36,
        deckY + 0.15,
        Math.cos(angle) * (maxZ - 3),
      );
      spot.light.getWorldPosition(beaconSource);
      beaconDirection.copy(beaconSource).sub(spot.light.target.position);
      const length = beaconDirection.length();
      spot.beam.position
        .copy(beaconSource)
        .add(spot.light.target.position)
        .multiplyScalar(0.5);
      spot.beam.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        beaconDirection.normalize(),
      );
      spot.beam.scale.set(length * 0.55, length, length * 0.55);
      spot.beam.material.uniforms.uTime.value = beaconTime;
    }
  }

  const cube = new THREE.BoxGeometry(1, 1, 1);
  for (const [material, matrices] of details) {
    const instances = new THREE.InstancedMesh(cube, material, matrices.length);
    instances.name = "HangarIndustrialDetail";
    instances.userData.minimap = false;
    matrices.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
    instances.castShadow = instances.receiveShadow = true;
    instances.computeBoundingSphere();
    scene.add(instances);
  }

  function bulkhead(x: number, z: number) {
    const group = new THREE.Group();
    group.name = x === 14 ? "HangarEntranceBulkhead" : "StageTwoAirlock";
    group.position.set(x, deckY, z);
    group.rotation.y = Math.PI / 2;
    scene.add(group);
    const shape = new THREE.Shape();
    shape.moveTo(-1.84, 0);
    shape.lineTo(-1.84, 3.18);
    shape.lineTo(-1.43, 3.65);
    shape.lineTo(1.43, 3.65);
    shape.lineTo(1.84, 3.18);
    shape.lineTo(1.84, 0);
    shape.lineTo(1.6, 0);
    shape.lineTo(1.6, 3.04);
    shape.lineTo(1.23, 3.4);
    shape.lineTo(-1.23, 3.4);
    shape.lineTo(-1.6, 3.04);
    shape.lineTo(-1.6, 0);
    shape.closePath();
    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false }),
      trim,
    );
    frame.position.z = -0.2;
    group.add(frame);
    const leaves = [-1, 1].map((sign) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.38, 0.16), dark);
      mesh.position.set(sign * 0.8, 1.69, 0);
      group.add(mesh);
      const body = physics.addBoxFromMesh(mesh);
      for (const face of [-1, 1]) {
        const inset = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 2.98, 0.03),
          steel,
        );
        inset.position.z = face * 0.095;
        mesh.add(inset);
        const status = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, 2.95, 0.02),
          teal,
        );
        status.position.set(-sign * 0.735, 0, face * 0.1);
        mesh.add(status);
      }
      return { mesh, body, sign };
    });
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.035, 2.8, 0.19), teal);
    seam.position.y = 1.4;
    group.add(seam);
    let open = 0;
    function update(dt: number, allowed: boolean) {
      open = THREE.MathUtils.clamp(open + (allowed ? 1 : -1) * dt * 1.8, 0, 1);
      for (const leaf of leaves) {
        leaf.mesh.position.x = leaf.sign * (0.8 + open * 1.72);
        const position = leaf.mesh.getWorldPosition(new THREE.Vector3());
        leaf.body.position.set(position.x, position.y, position.z);
        leaf.body.aabbNeedsUpdate = true;
      }
      seam.visible = open < 0.05;
    }
    return {
      group,
      leaves,
      update,
      get open() {
        return open;
      },
    };
  }
  const entrance = bulkhead(14, -2.5),
    exit = bulkhead(HANGAR_LAYOUT.exit.x, HANGAR_LAYOUT.exit.z);
  const exitZ = HANGAR_LAYOUT.exit.z;
  box([2.8, 0.2, 3.2], [87.4, -0.1, exitZ], floor);
  box([3, 3.4, 0.25], [87.4, 1.7, exitZ - 1.72], dark);
  box([3, 3.4, 0.25], [87.4, 1.7, exitZ + 1.72], dark);
  box([0.25, 3.4, 3.7], [88.85, 1.7, exitZ], dark);
  box([3.2, 0.2, 3.7], [87.4, 3.5, exitZ], dark).userData.minimap = false;
  const innerSeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 2.8, 0.05),
    teal,
  );
  innerSeam.position.set(88.71, deckY + 1.4, exitZ);
  scene.add(innerSeam);
  return {
    obstacles,
    crawlPassages,
    edgeSensors,
    safeZones,
    ladders,
    rooftops,
    platforms,
    scanSurfaces,
    panels,
    entrance,
    exit,
    fillLight,
    beacon,
    alarmSpots,
    updateAlarm,
    materials: { steel, dark, teal },
    bounds: HANGAR_LAYOUT.bounds,
    deckY,
  };
}

export type StealthHangar = ReturnType<typeof createStealthHangar>;
