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
  tableZ: 2.4,
  tableWidth: 10.6,
  tableDepth: 2.2,
  chairSetback: 0.18,
});
export const FACILITY_OFFICE_SEATS = [-4.2, -2.1, 0, 2.1, 4.2].map((x) =>
  Object.freeze({
    x,
    z: FACILITY_OFFICE.tableZ - 2.2,
    yaw: 0,
  }),
);

export function placeFacilityOfficeChair(chair: THREE.Group, index: number) {
  const seat = FACILITY_OFFICE_SEATS[index];
  fitRoomProp(chair, 1.2, 0.95, 1.05, seat.yaw);
  chair.position.add(new THREE.Vector3(
    seat.x, FACILITY_OFFICE.floor, seat.z - FACILITY_OFFICE.chairSetback,
  ));
  chair.name = `FacilityOfficeChair${index + 1}`;
}

export function alignFacilityOfficeStudent(
  model: THREE.Object3D,
  chair: THREE.Object3D,
) {
  model.updateWorldMatrix(true, false);
  model.updateMatrixWorld(true);
  chair.updateWorldMatrix(true, false);
  chair.updateMatrixWorld(true);
  chair.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      node.skeleton.update();
      node.computeBoundingBox();
    }
  });
  const pelvis = model.getObjectByName("pelvis");
  if (!pelvis) throw new Error("Office student is missing its pelvis bone");
  const hip = pelvis.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(model.matrixWorld);
  const vertex = new THREE.Vector3(), relative = new THREE.Vector3();
  let contactY = Infinity, footY = Infinity;
  model.traverse((node) => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    node.skeleton.update();
    const { position, skinIndex, skinWeight } = node.geometry.attributes;
    for (let index = 0; index < position.count; index++) {
      let hipWeight = 0, footWeight = 0;
      for (let component = 0; component < 4; component++) {
        const name = node.skeleton.bones[skinIndex.getComponent(index, component)].name;
        const weight = skinWeight.getComponent(index, component);
        if (/pelvis|hips|thigh|upleg/i.test(name)) hipWeight += weight;
        if (/foot|ball|toe/i.test(name)) footWeight += weight;
      }
      if (hipWeight < 0.6 && footWeight < 0.6) continue;
      node.getVertexPosition(index, vertex);
      node.localToWorld(vertex);
      if (footWeight >= 0.6) footY = Math.min(footY, vertex.y);
      relative.copy(vertex).sub(hip);
      if (hipWeight >= 0.6 && relative.dot(forward) <= 0.035 &&
          relative.y > -0.25 && relative.y < 0.04)
        contactY = Math.min(contactY, vertex.y);
    }
  });
  if (!Number.isFinite(contactY) || !Number.isFinite(footY))
    throw new Error("Office student has no seated skin or foot contact surface");
  const findCushion = () => {
    const bounds = new THREE.Box3().setFromObject(chair);
    const center = bounds.getCenter(new THREE.Vector3());
    const height = bounds.max.y - bounds.min.y;
    const ray = new THREE.Raycaster(
      new THREE.Vector3(center.x, bounds.min.y + height * 0.7, center.z + 0.06),
      new THREE.Vector3(0, -1, 0),
    );
    const normal = new THREE.Vector3(), matrix = new THREE.Matrix3();
    const hit = ray.intersectObject(chair, true).find((candidate) => {
      if (!candidate.face ||
          candidate.point.y < bounds.min.y + height * 0.22 ||
          candidate.point.y > bounds.min.y + height * 0.65) return false;
      matrix.getNormalMatrix(candidate.object.matrixWorld);
      return normal.copy(candidate.face.normal).applyMatrix3(matrix).normalize().y > 0.75;
    });
    if (!hit) throw new Error("Office chair has no upward-facing cushion surface");
    return { point: hit.point.clone(), bounds, center };
  };
  let cushion = findCushion();
  // Fit the cushion to the rig's seated leg length instead of raising the feet off the floor.
  const scale = (contactY - footY) / (cushion.point.y - cushion.bounds.min.y);
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Office chair cannot be fitted to the student's seated pose");
  chair.scale.multiplyScalar(scale);
  chair.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(chair);
  chair.position.add(new THREE.Vector3(
    cushion.center.x - fitted.getCenter(new THREE.Vector3()).x,
    cushion.bounds.min.y - fitted.min.y,
    cushion.center.z - fitted.getCenter(new THREE.Vector3()).z,
  ));
  chair.updateMatrixWorld(true);
  cushion = findCushion();
  const offset = new THREE.Vector3(
    cushion.point.x - hip.x,
    cushion.point.y + 0.002 - contactY,
    cushion.point.z - hip.z,
  );
  if (model.parent) {
    const origin = model.parent.worldToLocal(new THREE.Vector3());
    model.parent.worldToLocal(offset).sub(origin);
  }
  model.position.add(offset);
  chair.userData.seatedZ = chair.position.z;
  return model.position.y;
}

type OfficePhysics = ReturnType<typeof createScenePhysics>;

export function createFacilityOfficeGlazing(physics?: OfficePhysics) {
  const root = new THREE.Group();
  root.name = "FacilityOfficeGlazing";
  const { floor, front } = FACILITY_OFFICE;
  const metal = new THREE.MeshStandardMaterial({
    color: 0x253e48,
    metalness: 0.65,
    roughness: 0.35,
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
  const bodies: ReturnType<OfficePhysics["addBox"]>[] = [];
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
    if (solid && physics) bodies.push(physics.addBoxFromMesh(mesh));
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
  return { root, bodies };
}

export function createFacilityOfficeTable(physics?: OfficePhysics) {
  const root = new THREE.Group();
  root.name = "FacilityOfficeMeetingFurniture";
  const { floor, tableZ, tableWidth, tableDepth } = FACILITY_OFFICE;
  const wood = new THREE.MeshStandardMaterial({ color: 0x925d3f, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x253e48, metalness: 0.65, roughness: 0.35,
  });
  const tabletop = new THREE.Mesh(
    new THREE.BoxGeometry(tableWidth, 0.16, tableDepth), wood,
  );
  tabletop.name = "OfficeMeetingTable";
  tabletop.position.set(0, floor + 0.84, tableZ);
  tabletop.castShadow = tabletop.receiveShadow = true;
  root.add(tabletop);
  const bodies = physics ? [physics.addBoxFromMesh(tabletop)] : [];
  for (const x of [-tableWidth * 0.37, tableWidth * 0.37]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.76, 1.6), metal);
    leg.name = "OfficeTableLeg";
    leg.position.set(x, floor + 0.38, tableZ);
    leg.castShadow = leg.receiveShadow = true;
    root.add(leg);
  }
  return { root, bodies };
}

export function createFacilityOffice(
  scene: THREE.Scene,
  physics: OfficePhysics,
  loadChair = loadToolModel,
  loadStudent = loadSubjectModel,
) {
  const root = new THREE.Group();
  root.name = "FacilityGlassOffice";
  scene.add(root);
  const { floor, front, tableZ } = FACILITY_OFFICE;
  const peekPoint = new THREE.Vector3(0, floor + 1.55, front + 1.1);
  const tablePoint = new THREE.Vector3(0, floor + 1.25, FACILITY_OFFICE_SEATS[2].z);
  const glazing = createFacilityOfficeGlazing(physics);
  const table = createFacilityOfficeTable(physics);
  root.add(glazing.root, table.root);
  const bodies = [...glazing.bodies, ...table.bodies];
  const light = new THREE.PointLight(0xffe2bb, 12, 20, 2);
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
