import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { loadStudentModel, loadVergilsChair } from "../../core/loader.js";
import { CABINS } from "../../scenes/living quarters/layout.js";
import {
  createStudentBoardingClip,
  createStudentPoseClip,
} from "../npc/mechAnimation.js";
import {
  FACILITY_OFFICE,
  FACILITY_OFFICE_SEATS,
  createFacilityOfficeTable,
  alignFacilityOfficeStudent,
  placeFacilityOfficeChair,
} from "./facilityOffice.js";

export const SUDOERS_5 = CABINS.filter((cabin) => cabin.role === "student").map(
  (cabin, index) => ({
    name: cabin.occupant,
    color: [0x8e3039, 0x9c4940, 0x752e38, 0xa34a50, 0x873e48][index],
  }),
);

export function normalizeFinaleActor(source: THREE.Object3D, height: number) {
  source.updateMatrixWorld(true);
  source.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      node.skeleton.update();
      node.computeBoundingBox();
    }
  });
  const bounds = new THREE.Box3().setFromObject(source),
    sourceHeight = bounds.getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0)
    throw new Error("Finale model has invalid or empty bounds");
  const wrapper = new THREE.Group(),
    scale = height / sourceHeight,
    center = bounds.getCenter(new THREE.Vector3());
  wrapper.add(source);
  wrapper.scale.setScalar(scale);
  wrapper.position.set(
    -center.x * scale,
    -bounds.min.y * scale,
    -center.z * scale,
  );
  source.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.frustumCulled = false;
      node.castShadow = node.receiveShadow = true;
    }
  });
  return wrapper;
}

export function captureFinaleResources(root: THREE.Object3D, shared = false) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return {
    dispose() {
      root.removeFromParent();
      root.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      });
      if (!shared) {
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        textures.forEach((texture) => texture.dispose());
      }
    },
  };
}

export function createFinaleStudents(loadModel = loadStudentModel) {
  const root = new THREE.Group();
  root.name = "Sudoers5";
  const furniture = createFacilityOfficeTable().root;
  furniture.name = "FinaleOfficeMeetingFurniture";
  root.add(furniture);
  type Student = {
    root: THREE.Group;
    model: THREE.Object3D;
    animations: readonly THREE.AnimationClip[];
    wrapper: THREE.Group;
    standingY: number;
    seatedY: number;
    mixer: THREE.AnimationMixer;
    actions: Record<
      "sit" | "stand" | "walk" | "idle" | "talk" | "pose" | "board",
      THREE.AnimationAction
    >;
    mode: keyof Student["actions"] | "";
  };
  const students: Student[] = [];
  let disposed = false,
    chairResources: ReturnType<typeof captureFinaleResources> | null = null;
  let sourceResources: ReturnType<typeof captureFinaleResources>[] = [];
  const loaded = Promise.allSettled([
    ...SUDOERS_5.map((student) => loadModel(student.name)),
    loadVergilsChair(),
  ]).then((results) => {
    const assets = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      assets.forEach((asset) => captureFinaleResources(asset.scene).dispose());
      dispose();
      throw new Error(
        `Finale student models failed to load: ${String(failure.reason)}`,
      );
    }
    const chairAsset = assets[SUDOERS_5.length];
    sourceResources = assets
      .slice(0, SUDOERS_5.length)
      .map((asset) => captureFinaleResources(asset.scene));
    chairResources = captureFinaleResources(chairAsset.scene);
    if (disposed) {
      sourceResources.forEach((resources) => resources.dispose());
      chairResources.dispose();
      return;
    }
    try {
      SUDOERS_5.forEach((student, i) => {
        const asset = assets[i];
        function required(name: string) {
          const clip = asset.animations.find(
            (animation) => animation.name === name,
          );
          if (!clip)
            throw new Error(
              `${student.name} model is missing the ${name} animation`,
            );
          return clip;
        }
        const walk = required("Walk_Loop"),
          idle = required("Idle_Loop"),
          talk = required("Idle_Talking_Loop"),
          seatedIdle = required("Sitting_Idle_Loop"),
          seatedTalk = required("Sitting_Talking_Loop"),
          stand = required("Sitting_Exit");
        const actor = new THREE.Group();
        actor.name = student.name;
        const model = asset.scene;
        const wrapper = normalizeFinaleActor(model, 1.83),
          standingY = wrapper.position.y,
          seat = FACILITY_OFFICE_SEATS[i];
        actor.add(wrapper);
        actor.position.set(seat.x, FACILITY_OFFICE.floor, seat.z);
        actor.rotation.y = seat.yaw;
        const mixer = new THREE.AnimationMixer(model);
        const actions = {
          sit: mixer.clipAction(i % 2 ? seatedIdle : seatedTalk),
          stand: mixer.clipAction(stand),
          walk: mixer.clipAction(walk),
          idle: mixer.clipAction(idle),
          talk: mixer.clipAction(talk),
          pose: mixer.clipAction(createStudentPoseClip(model, i)),
          board: mixer.clipAction(createStudentBoardingClip(model)),
        };
        actions.stand.setLoop(THREE.LoopOnce, 1);
        actions.stand.clampWhenFinished = true;
        actions.sit.play();
        mixer.update(i * 0.2);
        const chair = new THREE.Group();
        chair.add(clone(chairAsset.scene));
        placeFacilityOfficeChair(chair, i);
        const seatedY = alignFacilityOfficeStudent(wrapper, chair);
        furniture.add(chair);
        root.add(actor);
        mixer.stopAllAction();
        actions.pose.setLoop(THREE.LoopOnce, 1);
        actions.pose.clampWhenFinished = true;
        actions.board.setLoop(THREE.LoopOnce, 1);
        actions.board.clampWhenFinished = true;
        students.push({
          root: actor,
          model,
          animations: asset.animations,
          wrapper,
          standingY,
          seatedY,
          mixer,
          actions,
          mode: "",
        });
      });
    } catch (error) {
      dispose();
      throw error;
    }
  });
  return {
    root,
    furniture,
    students,
    loaded,
    getCreditsCast() {
      return students.map((student, index) => ({
        name: SUDOERS_5[index].name,
        model: student.model,
        animations: student.animations,
        pose: student.actions.pose.getClip(),
      }));
    },
    animate(
      index: number,
      mode: keyof Student["actions"],
      time: number,
      dt = 0,
    ) {
      const student = students[index];
      if (!student) return;
      if (student.mode !== mode) {
        const previous = student.mode ? student.actions[student.mode] : null;
        const next = student.actions[mode];
        next.reset().setEffectiveWeight(1).play();
        if (previous && dt > 0) next.crossFadeFrom(previous, 0.28, false);
        else previous?.stop();
        student.mode = mode;
      }
      const action = student.actions[mode];
      action.time =
        mode === "pose" || mode === "board" || mode === "stand"
          ? Math.min(Math.max(0, time), action.getClip().duration)
          : Math.max(0, time) % action.getClip().duration;
      action.paused = true;
      student.mixer.update(Math.max(0, dt));
      student.wrapper.position.y =
        mode === "sit"
          ? student.seatedY
          : mode === "stand"
            ? THREE.MathUtils.lerp(
                student.seatedY,
                student.standingY,
                THREE.MathUtils.smoothstep(
                  action.time,
                  0,
                  action.getClip().duration,
                ),
              )
            : student.standingY;
    },
    dispose,
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const student of students) {
      student.mixer.stopAllAction();
      student.mixer.uncacheRoot(student.model);
    }
    root.removeFromParent();
    furniture.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    });
    sourceResources.forEach((resources) => resources.dispose());
    chairResources?.dispose();
    for (const child of furniture.children)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach((material) => material.dispose());
      }
  }
}
