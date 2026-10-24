import * as THREE from "three";
import {
  loadSubjectModel,
  loadToolModel,
  loadVergilsChair,
} from "../../core/loader.js";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { fitRoomProp, disposeRoom } from "../global/shipRoom.js";
import { normalizeFinaleActor, SUDOERS_5 } from "./finaleActors.js";
import { FACILITY } from "../global/facilityArchitecture.js";

export const FACILITY_OFFICE = Object.freeze({
  floor: FACILITY.officeFloor,
  front: 9,
  tableZ: 0,
});
export const FACILITY_OFFICE_SEATS = [
  [-3.5, FACILITY_OFFICE.tableZ],
  [-1.8, FACILITY_OFFICE.tableZ - 2.4],
  [1.8, FACILITY_OFFICE.tableZ - 2.4],
  [3.5, FACILITY_OFFICE.tableZ],
  [0, FACILITY_OFFICE.tableZ + 2.5],
].map(([x, z]) =>
  Object.freeze({
    x,
    z,
    yaw: Math.atan2(-x, FACILITY_OFFICE.tableZ - z),
  }),
);

export function placeFacilityOfficeChair(chair: THREE.Group, index: number) {
  const seat = FACILITY_OFFICE_SEATS[index];
  fitRoomProp(chair, 0.96, 0.8, 0.9, seat.yaw);
  chair.position.add(new THREE.Vector3(seat.x, FACILITY_OFFICE.floor, seat.z));
  chair.name = `FacilityOfficeChair${index + 1}`;
}

export function alignFacilityOfficeStudent(
  model: THREE.Object3D,
  chair: THREE.Object3D,
) {
  model.updateWorldMatrix(true, false);
  model.updateMatrixWorld(true);
  // The authored chair is skinned; refresh its bind inverse before raycasting.
  chair.updateWorldMatrix(true, false);
  chair.updateMatrixWorld(true);
  const pelvis = model.getObjectByName("pelvis");
  if (!pelvis) throw new Error("Office student is missing its pelvis bone");
  const bounds = new THREE.Box3().setFromObject(chair);
  const origin = bounds.getCenter(new THREE.Vector3());
  origin.y = bounds.max.y + 0.2;
  const seat = new THREE.Raycaster(
    origin,
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(chair, true)[0];
  if (!seat) throw new Error("Office chair has no seated contact surface");
  model.position.y +=
    seat.point.y + 0.09 - pelvis.getWorldPosition(new THREE.Vector3()).y;
  return model.position.y;
}

export function createFacilityOffice(
  scene: THREE.Scene,
  physics: ReturnType<typeof createScenePhysics>,
  loadChair = loadToolModel,
  loadStudent = loadSubjectModel,
) {
  const root = new THREE.Group();
  root.name = "FacilityGlassOffice";
  scene.add(root);
  const { floor, front, tableZ } = FACILITY_OFFICE;
  const peekPoint = new THREE.Vector3(0, floor + 1.55, front + 1.1);
  const tablePoint = new THREE.Vector3(0, floor + 1.1, tableZ);
  const metal = new THREE.MeshStandardMaterial({
    color: 0x253e48,
    metalness: 0.65,
    roughness: 0.35,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0x925d3f,
    roughness: 0.55,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc5e8ed,
    transparent: true,
    opacity: 0.14,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const bodies: ReturnType<typeof physics.addBox>[] = [];
  function box(
    name: string,
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material,
    solid = false,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = material !== glass;
    root.add(mesh);
    if (solid) bodies.push(physics.addBoxFromMesh(mesh));
    return mesh;
  }
  // The room uses the existing exterior walls; only the atrium edge is glazed.
  // Glass panels on either side of a central door that meets the top of the stairs.
  for (const side of [-1, 1])
    for (let index = 0; index < 4; index++) {
      const width = 12.5 / 4,
        x = side * (1.5 + width * (index + 0.5));
      box(
        "OfficeGlassPanel",
        [width - 0.06, 3.5, 0.06],
        [x, floor + 1.85, front],
        glass,
        true,
      );
      box(
        "OfficeWindowMullion",
        [0.06, 3.7, 0.12],
        [side * (1.5 + width * (index + 1)), floor + 1.85, front],
        metal,
      );
    }
  box(
    "OfficeGlassDoor",
    [2.94, 3.5, 0.06],
    [0, floor + 1.85, front],
    glass,
    true,
  );
  for (const x of [-1.5, 1.5])
    box(
      "OfficeWindowMullion",
      [0.06, 3.7, 0.12],
      [x, floor + 1.85, front],
      metal,
    );
  for (const y of [floor + 0.08, 7.92])
    box("OfficeWindowRail", [28, 0.12, 0.12], [0, y, front], metal);
  box(
    "OfficeDoorHandle",
    [0.07, 0.5, 0.1],
    [-1.2, floor + 1.1, front + 0.09],
    metal,
  );
  box(
    "OfficeMeetingTable",
    [5.6, 0.16, 3.2],
    [0, floor + 0.84, tableZ],
    wood,
    true,
  );
  for (const x of [-2.1, 2.1])
    box("OfficeTableLeg", [0.22, 0.76, 2.3], [x, floor + 0.38, tableZ], metal);
  const light = new THREE.PointLight(0xffe2bb, 30, 20);
  light.position.set(0, 7.4, tableZ);
  root.add(light);
  const students: Array<{
    root: THREE.Group;
    mixer: THREE.AnimationMixer;
    model: THREE.Group;
  }> = [];
  let disposed = false;
  const ready = Promise.allSettled(
    FACILITY_OFFICE_SEATS.flatMap(() => [loadStudent(), loadVergilsChair()]),
  ).then((results) => {
    const assets = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find((result) => result.status === "rejected");
    if (disposed || failure?.status === "rejected") {
      assets.forEach((asset) => disposeRoom(asset.scene));
      if (failure?.status === "rejected")
        throw new Error(
          `Office models failed to load: ${String(failure.reason)}`,
        );
      return;
    }
    try {
      FACILITY_OFFICE_SEATS.forEach(({ x, z, yaw }, index) => {
        const asset = assets[index * 2],
          chair = assets[index * 2 + 1].scene;
        placeFacilityOfficeChair(chair, index);
        root.add(chair);
        const actor = new THREE.Group();
        actor.name = SUDOERS_5[index].name;
        actor.position.set(x, floor, z);
        actor.rotation.y = yaw;
        root.add(actor);
        const model = normalizeFinaleActor(asset.scene, 1.83);
        actor.add(model);
        const clip = THREE.AnimationClip.findByName(
          asset.animations,
          index % 2 ? "Sitting_Idle_Loop" : "Sitting_Talking_Loop",
        );
        if (!clip)
          throw new Error(
            `Subject is missing a seated office animation for ${actor.name}`,
          );
        const mixer = new THREE.AnimationMixer(asset.scene);
        mixer.clipAction(clip).play();
        mixer.update(index * 0.2);
        alignFacilityOfficeStudent(model, chair);
        students.push({ root: actor, mixer, model: asset.scene });
      });
    } catch (error) {
      assets
        .filter((asset) => !asset.scene.parent)
        .forEach((asset) => disposeRoom(asset.scene));
      throw error;
    }
  });
  return {
    root,
    ready,
    peekPoint,
    tablePoint,
    canPeek(position: { x: number; y: number; z: number }) {
      return (
        Math.abs(position.y - (floor + 0.3)) < 0.65 &&
        position.z > front &&
        Math.hypot(position.x - peekPoint.x, position.z - peekPoint.z) < 2.3
      );
    },
    update(dt: number, _noticed: boolean) {
      for (const student of students) {
        student.mixer.update(dt);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const student of students) {
        student.mixer.stopAllAction();
        student.mixer.uncacheRoot(student.model);
      }
      root.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      });
      bodies.forEach((body) => {
        if (body.world === physics.world) physics.world.removeBody(body);
      });
      root.removeFromParent();
      disposeRoom(root);
    },
  };
}
