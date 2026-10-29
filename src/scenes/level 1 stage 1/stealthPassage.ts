import * as THREE from "three";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { roomBox, createSlidingPortal } from "../../scripts/global/shipRoom.js";
import {
  createShipInteriorMaterials,
  createShipServiceDetails,
  SHIP_INTERIOR_PALETTE,
} from "../../scripts/global/shipInterior.js";

export const STORAGE_CLOSET = {
  width: 3.6,
  depth: 3.3,
  height: 3.05,
  doorWidth: 1.5,
  doorHeight: 2.55,
};

export function createStealthPassage(
  scene: THREE.Scene,
  physics: ReturnType<typeof createScenePhysics>,
  deckY: number,
) {
  const roomHeight = STORAGE_CLOSET.height;
  const {
    steel: wall,
    dark,
    trim,
    cyan: lightStrip,
    deck: floor,
  } = createShipInteriorMaterials(14, 2.5);
  const storageFloor = floor.clone();
  scene.add(createShipServiceDetails({
    width: 5, depth: 27.6, height: roomHeight,
    y: deckY, z: -2.5, yaw: Math.PI / 2,
    label: "DECK 01 / PRESSURIZED TRANSIT", spacing: 4,
  }));
  const crate = wall.clone();
  crate.color.setHex(0x536b7d);
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xdab943,
    metalness: 0.25,
    roughness: 0.52,
  });
  const box = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material = wall,
    solid = true,
  ) =>
    roomBox(
      scene,
      physics,
      size,
      [position[0], deckY + position[1], position[2]],
      material,
      solid,
    );

  box(
    [STORAGE_CLOSET.width, 0.2, STORAGE_CLOSET.depth],
    [0, -0.1, STORAGE_CLOSET.depth / 2],
    storageFloor,
  );
  box([28, 0.2, 5], [0, -0.1, -2.5], floor).name = "DeckOnePatrolPassageFloor";
  box([0.2, roomHeight, STORAGE_CLOSET.depth], [-1.8, roomHeight / 2, 1.65]);
  box([0.2, roomHeight, STORAGE_CLOSET.depth], [1.8, roomHeight / 2, 1.65]);
  box(
    [STORAGE_CLOSET.width, roomHeight, 0.2],
    [0, roomHeight / 2, STORAGE_CLOSET.depth],
  );
  for (const side of [-1, 1]) {
    box([1, roomHeight, 0.2], [side * 1.3, roomHeight / 2, 0]);
    box([12.2, roomHeight, 0.2], [side * 7.9, roomHeight / 2, 0]);
    box(
      [0.14, STORAGE_CLOSET.doorHeight, 0.32],
      [side * 0.84, STORAGE_CLOSET.doorHeight / 2, 0],
      trim,
    );
  }
  const quartersDoor = createSlidingPortal(
    scene,
    physics,
    { x: -14, y: deckY, z: -2.5, yaw: Math.PI / 2 },
    5,
    roomHeight,
    "LIVING QUARTERS",
    { doorHeight: 2.5, landingFloor: false, sign: false },
  );
  box([1.6, 0.2, 5], [-14.8, -0.1, -2.5], floor);
  box([1.6, 0.16, 5], [-14.8, roomHeight, -2.5], dark).userData.minimap = false;
  for (const z of [-5, 0])
    box([1.6, roomHeight, 0.18], [-14.8, roomHeight / 2, z]);
  box(
    [0.12, roomHeight, 5],
    [-15.55, roomHeight / 2, -2.5],
    dark,
  ).userData.minimap = false;
  box(
    [1.6, roomHeight - STORAGE_CLOSET.doorHeight, 0.2],
    [0, (roomHeight + STORAGE_CLOSET.doorHeight) / 2, 0],
  );
  box([1.82, 0.14, 0.32], [0, STORAGE_CLOSET.doorHeight + 0.07, 0], trim);
  box([28, roomHeight, 0.2], [0, roomHeight / 2, -5]);
  for (const [size, position] of [
    [
      [STORAGE_CLOSET.width, 0.16, STORAGE_CLOSET.depth],
      [0, roomHeight, 1.65],
    ],
    [
      [28, 0.16, 5],
      [0, roomHeight, -2.5],
    ],
  ] as Array<[[number, number, number], [number, number, number]]>) {
    box(size, position, dark).userData.minimap = false;
  }
  for (const x of [-1.3, 1.3]) {
    for (const z of [1.85]) {
      for (const height of [0.55, 1.7]) {
        box([0.72, 0.08, 1.5], [x, height - 0.5, z], trim);
        box([0.64, 0.95, 1.2], [x, height, z], crate);
        box([0.66, 0.06, 1.22], [x, height + 0.3, z], yellow, false);
        for (const offset of [-0.36, 0.36])
          box([0.04, 2.5, 0.06], [x + offset, 1.25, z - 0.72], trim);
      }
    }
  }
  for (const x of [-12, -8, -4, 0, 4, 8, 12]) {
    box([0.12, roomHeight, 0.12], [x, roomHeight / 2, -4.85], dark, false);
    box([0.24, 0.17, 4.64], [x, roomHeight - 0.18, -2.5], trim, false);
    box([2.3, 0.045, 0.2], [x, roomHeight - 0.1, -2.5], lightStrip, false);
    const light = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 5, 14);
    light.position.set(x, deckY + 2.7, -2.5);
    scene.add(light);
  }
  for (const z of [-4.78, -0.22]) {
    box([27.6, 0.022, 0.035], [0, 0.012, z], lightStrip, false);
    box([27.6, 0.045, 0.05], [0, 0.18, z], trim, false);
  }
  for (const side of [-1, 1])
    box([0.035, 0.022, 3.02], [side * 1.59, 0.012, 1.65], lightStrip, false);
  box([1.5, 0.025, 0.1], [0, 0.015, 0.25], yellow, false);
  scene.add(new THREE.AmbientLight(SHIP_INTERIOR_PALETTE.ambient, 1.4));
  const roomLight = new THREE.PointLight(SHIP_INTERIOR_PALETTE.light, 2.5, 7);
  roomLight.position.set(0, deckY + 2.75, 2.25);
  scene.add(roomLight);

  const doorPivot = new THREE.Group();
  doorPivot.name = "StorageHideDoor";
  doorPivot.position.set(-STORAGE_CLOSET.doorWidth / 2, deckY, 0);
  scene.add(doorPivot);
  const doorLeaf = new THREE.Mesh(
    new THREE.BoxGeometry(
      STORAGE_CLOSET.doorWidth,
      STORAGE_CLOSET.doorHeight - 0.04,
      0.12,
    ),
    wall,
  );
  doorLeaf.position.set(
    STORAGE_CLOSET.doorWidth / 2,
    (STORAGE_CLOSET.doorHeight - 0.04) / 2,
    0,
  );
  doorLeaf.castShadow = doorLeaf.receiveShadow = true;
  doorPivot.add(doorLeaf);
  const doorBody = physics.addBoxFromMesh(doorLeaf);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.09), trim);
  handle.position.set(1.27, 1.15, 0.105);
  doorPivot.add(handle);
  const doorInset = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.65, 0.018),
    dark,
  );
  doorInset.position.set(0.75, 1.4, 0.07);
  doorPivot.add(doorInset);
  const doorIndicator = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.025, 0.012),
    lightStrip,
  );
  doorIndicator.position.set(1.27, 1.38, 0.11);
  doorPivot.add(doorIndicator);
  for (const part of [handle, doorInset, doorIndicator]) {
    const mirrored = part.clone();
    mirrored.position.z = -part.position.z;
    doorPivot.add(mirrored);
  }
  return { quartersDoor, doorPivot, doorLeaf, doorBody, trim, roomLight };
}
