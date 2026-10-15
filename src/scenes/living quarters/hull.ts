import * as THREE from 'three';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import { createShipInteriorMaterials } from '../../helpers/scene/shipInterior.js';
import { CABINS, QUARTERS, cabinCenter, cabinDoorPoint } from './layout.js';
import { cabinNameTexture, shipLabelTexture } from './furnishings.js';
import { createBulkheadKeypad } from './surfaces.js';
import type { QuartersProgress } from './layout.js';

type Physics = ReturnType<typeof createScenePhysics>;

export function createQuartersHull(scene: THREE.Scene, physics: Physics, progress: QuartersProgress) {
  const { steel, dark, trim, cyan, deck } = createShipInteriorMaterials(3, 12);
  const red = new THREE.MeshBasicMaterial({ color: 0xf2766e, toneMapped: false });
  function box(parent: THREE.Object3D, name: string, size: [number, number, number], at: [number, number, number],
    material: THREE.Material = steel, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.name = name; mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    if (solid) physics.addBoxFromMesh(mesh);
    return mesh;
  }
  function label(parent: THREE.Object3D, name: string, lines: string[], width: number, height: number,
    at: [number, number, number], yaw = 0, accent = 0x65d9e8) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: shipLabelTexture(lines, accent), toneMapped: false }));
    mesh.name = name; mesh.position.set(...at); mesh.rotation.y = yaw; parent.add(mesh); return mesh;
  }
  const half = QUARTERS.hallwayWidth / 2, roomHalf = QUARTERS.cabinWidth / 2, depthHalf = QUARTERS.cabinDepth / 2;
  const roof = box(scene, 'QuartersHallCeiling', [QUARTERS.hallwayWidth, 0.18, QUARTERS.hallwayLength],
    [0, QUARTERS.height + 0.09, 0], dark, true); roof.userData.minimap = false;
  box(scene, 'QuartersHallDeck', [QUARTERS.hallwayWidth, 0.2, QUARTERS.hallwayLength], [0, -0.1, 0], deck, true);
  box(scene, 'QuartersAftWall', [QUARTERS.hallwayWidth, QUARTERS.height, 0.18], [0, QUARTERS.height / 2, -16], steel, true);
  for (const side of [-1, 1]) {
    box(scene, 'HallDeckGuide', [0.035, 0.022, 31.7], [side * (half - 0.17), 0.012, 0], cyan);
    for (const z of [-15.7, -7.6, 0, 7.6, 15.7]) {
      box(scene, 'HallWallSeam', [0.2, 3.16, 0.34], [side * half, 1.58, z], dark);
      box(scene, 'HallStructuralRib', [4.64, 0.17, 0.24], [0, 3.02, z], trim);
    }
  }
  for (const z of QUARTERS.slots) {
    box(scene, 'HallOverheadStrip', [2.4, 0.025, 0.12], [0, 3.08, z], cyan);
    const light = new THREE.PointLight(0xb6dfec, 9, 10, 1.7); light.position.set(0, 2.9, z); scene.add(light);
  }

  function door(name: string, position: THREE.Vector3, yaw: number, locked: boolean) {
    const root = new THREE.Group(); root.name = name; root.position.copy(position); root.rotation.y = yaw; scene.add(root);
    const width = QUARTERS.doorWidth, height = QUARTERS.doorHeight;
    for (const side of [-1, 1]) box(root, 'BulkheadJamb', [0.16, height + 0.18, 0.28], [side * (width / 2 + 0.07), (height + 0.18) / 2, 0], trim);
    box(root, 'BulkheadHeader', [width + 0.3, 0.18, 0.28], [0, height + 0.09, 0], trim);
    const leaves = [-1, 1].map(side => {
      const mesh = box(root, 'BulkheadLeaf', [width / 2, height, 0.12], [side * width / 4, height / 2, 0], dark);
      box(mesh, 'DoorArmorInset', [width / 2 - 0.1, height - 0.35, 0.135], [0, 0, 0], steel);
      const indicator = box(mesh, 'DoorStatusStrip', [0.035, height - 0.3, 0.15], [-side * (width / 4 - 0.04), 0, 0], locked ? red : cyan);
      return { mesh, body: physics.addBoxFromMesh(mesh), side, indicator };
    });
    let openness = 0;
    function update(dt: number, open: boolean) {
      openness = THREE.MathUtils.clamp(openness + (open && !locked ? 1 : -1) * dt * 2.4, 0, 1);
      for (const leaf of leaves) {
        leaf.mesh.position.x = leaf.side * (width / 4 + openness * (width / 2 + 0.06));
        const point = leaf.mesh.getWorldPosition(new THREE.Vector3()); leaf.body.position.set(point.x, point.y, point.z); leaf.body.aabbNeedsUpdate = true;
      }
    }
    return { root, leaves, update, get locked() { return locked; }, get open() { return openness; },
      setLocked(value: boolean) {
        locked = value; leaves.forEach(leaf => { leaf.indicator.material = value ? red : cyan; });
        if (value) openness = 0;
        update(0, false);
      } };
  }
  const doors = new Map(CABINS.map(cabin => [cabin.id,
    door(`CabinDoor-${cabin.id}`, cabinDoorPoint(cabin), cabin.side * Math.PI / 2, cabin.locked)]));
  const signs = new Map<string, THREE.Group>();
  const masks: THREE.Mesh[] = [];
  for (const cabin of CABINS) {
    const shell = new THREE.Group(); shell.name = `CabinShell-${cabin.id}`; shell.position.copy(cabinCenter(cabin)); scene.add(shell);
    box(shell, 'CabinDeck', [QUARTERS.cabinWidth, 0.2, QUARTERS.cabinDepth], [0, -0.1, 0], deck, true);
    const ceiling = box(shell, 'CabinCeiling', [QUARTERS.cabinWidth, 0.18, QUARTERS.cabinDepth], [0, QUARTERS.height + 0.09, 0], dark, true);
    ceiling.userData.minimap = false;
    for (const z of [-depthHalf, depthHalf]) box(shell, 'CabinPartition', [QUARTERS.cabinWidth, QUARTERS.height, 0.18], [0, QUARTERS.height / 2, z], steel, true);
    box(shell, 'CabinOuterHull', [0.18, QUARTERS.height, QUARTERS.cabinDepth], [cabin.side * roomHalf, QUARTERS.height / 2, 0], steel, true);
    const span = (QUARTERS.cabinDepth - QUARTERS.doorWidth) / 2;
    for (const z of [-1, 1]) box(shell, 'CabinEntrancePartition', [0.18, QUARTERS.height, span],
      [-cabin.side * roomHalf, QUARTERS.height / 2, z * (QUARTERS.doorWidth / 2 + span / 2)], steel, true);
    box(shell, 'CabinEntranceLintel', [0.18, QUARTERS.height - QUARTERS.doorHeight, QUARTERS.doorWidth],
      [-cabin.side * roomHalf, (QUARTERS.height + QUARTERS.doorHeight) / 2, 0], steel, true);
    for (const z of [-depthHalf + 0.12, depthHalf - 0.12]) box(shell, 'CabinHullTrim',
      [QUARTERS.cabinWidth - 0.24, 0.045, 0.05], [0, 0.18, z], trim);

    const sign = new THREE.Group(); sign.name = `CabinIdentitySign-${cabin.id}`;
    sign.position.set(cabin.side * (half - 0.115), 1.52, cabin.z - 1.45); sign.rotation.y = -cabin.side * Math.PI / 2; scene.add(sign);
    box(sign, 'IdentityPlateBacking', [1.04, 0.29, 0.045], [0, 0, 0], dark);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25),
      new THREE.MeshBasicMaterial({ map: cabinNameTexture(cabin.occupant), toneMapped: false }));
    plate.name = 'IdentityPlate'; plate.position.z = 0.026; sign.add(plate);
    signs.set(cabin.id, sign);
    if (cabin.locked) {
      const mask = box(scene, `LockedCabinMapMask-${cabin.id}`, [QUARTERS.cabinWidth - 0.2, 3.19, QUARTERS.cabinDepth - 0.2],
        [shell.position.x, 1.595, cabin.z], dark);
      mask.visible = false; masks.push(mask);
    }
  }
  for (const side of [-1, 1]) {
    for (const z of [-15.2, -7.6, 0, 7.6, 15.2]) {
      const length = Math.abs(z) === 15.2 ? 1.6 : 0.8;
      box(scene, 'HallPartitionJoin', [0.18, QUARTERS.height, length], [side * half, QUARTERS.height / 2, z], steel, true);
    }
  }
  for (const side of [-1, 1]) box(scene, 'ForwardBulkheadWall', [(QUARTERS.hallwayWidth - QUARTERS.doorWidth) / 2, QUARTERS.height, 0.18],
    [side * (QUARTERS.hallwayWidth + QUARTERS.doorWidth) / 4, QUARTERS.height / 2, 16], steel, true);
  box(scene, 'ForwardBulkheadLintel', [QUARTERS.doorWidth, QUARTERS.height - QUARTERS.doorHeight, 0.18],
    [0, (QUARTERS.height + QUARTERS.doorHeight) / 2, 16], steel, true);
  const forwardDoor = door('QuartersForwardBulkhead', new THREE.Vector3(0, 0, 16), 0, !progress.bulkheadUnlocked);
  box(scene, 'ForwardTransferDeck', [QUARTERS.hallwayWidth, 0.2, 1.6], [0, -0.1, 16.8], deck, true);
  const transferRoof = box(scene, 'ForwardTransferCeiling', [QUARTERS.hallwayWidth, 0.18, 1.6],
    [0, QUARTERS.height + 0.09, 16.8], dark, true); transferRoof.userData.minimap = false;
  for (const side of [-1, 1]) box(scene, 'ForwardTransferWall', [0.18, QUARTERS.height, 1.6],
    [side * half, QUARTERS.height / 2, 16.8], steel, true);
  const transferEnd = box(scene, 'ForwardTransferEndCap', [QUARTERS.hallwayWidth, QUARTERS.height, 0.12],
    [0, QUARTERS.height / 2, 17.55], dark, true); transferEnd.userData.minimap = false;
  label(scene, 'ForwardBulkheadStatus', ['FORWARD BULKHEAD', 'DECK ONE PASSAGE'], 1.45, 0.29, [0, 2.91, 15.87], Math.PI, 0xe3bf75);
  const keypad = createBulkheadKeypad(progress);
  const keypadRoot = new THREE.Group(); keypadRoot.name = 'ForwardBulkheadKeypad'; keypadRoot.position.set(1.52, 1.38, 15.85);
  keypadRoot.rotation.y = Math.PI; scene.add(keypadRoot);
  box(keypadRoot, 'KeypadHousing', [0.62, 1.0, 0.12], [0, 0, 0], dark);
  const keypadScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.84),
    new THREE.MeshBasicMaterial({ map: keypad.texture, toneMapped: false }));
  keypadScreen.name = 'BulkheadKeypadScreen'; keypadScreen.position.z = 0.066; keypadRoot.add(keypadScreen);
  return { doors, signs, masks, forwardDoor, keypad, keypadRoot, keypadScreen };
}

export type CabinDoor = ReturnType<typeof createQuartersHull>['forwardDoor'];
