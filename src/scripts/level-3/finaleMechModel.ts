import * as THREE from "three";
import {
  loadFinaleMechModel,
  loadSubjectModel,
} from "../../core/loader.js";
import type { MechSide } from "../npc/mechDuel.js";
import type { MechAsset } from "./finaleMechs.js";

export async function createFinaleMechModel(side: MechSide): Promise<MechAsset> {
  const [armour, rig] = await Promise.all([
    loadFinaleMechModel(),
    loadSubjectModel(),
  ]);
  armour.scene.updateMatrixWorld(true);
  rig.scene.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  rig.scene.traverse((node) => {
    if (node instanceof THREE.Bone) bones.set(node.name, node);
  });
  const handBones = new Set<THREE.Object3D>();
  for (const name of ["hand_l", "hand_r"]) {
    const hand = bones.get(name);
    if (!hand) throw new Error(`The finale ${side} rig is missing ${name}`);
    hand.traverse((bone) => handBones.add(bone));
  }
  const handBoneNames = new Set([...handBones].map((bone) => bone.name));
  let plateMaterial: THREE.MeshStandardMaterial | undefined;
  armour.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial &&
          material.name === "platelight")
        plateMaterial = material;
    }
  });
  if (!plateMaterial)
    throw new Error("The finale mech is missing its plate material for the hands");
  const handMaterial = plateMaterial.clone();
  handMaterial.name = "FinaleArticulatedHands_platelight";
  const oldGeometries = new Set<THREE.BufferGeometry>();
  const oldMaterials = new Set<THREE.Material>();
  const oldTextures = new Set<THREE.Texture>();
  const donorMeshes: THREE.Mesh[] = [];
  rig.scene.traverse((node) => {
    if (node instanceof THREE.Mesh) donorMeshes.push(node);
  });
  let hands = 0;
  for (const mesh of donorMeshes) {
    oldGeometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      oldMaterials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) oldTextures.add(value);
    }
    if (!(mesh instanceof THREE.SkinnedMesh)) {
      mesh.removeFromParent();
      continue;
    }
    const joints = mesh.geometry.getAttribute("skinIndex");
    const weights = mesh.geometry.getAttribute("skinWeight");
    if (!joints || !weights)
      throw new Error(`The finale ${side} hand donor has no skin weights`);
    const weight = (vertex: number) => {
      const indices = [
        joints.getX(vertex), joints.getY(vertex),
        joints.getZ(vertex), joints.getW(vertex),
      ];
      const values = [
        weights.getX(vertex), weights.getY(vertex),
        weights.getZ(vertex), weights.getW(vertex),
      ];
      return indices.reduce((sum, index, component) =>
        sum + (handBones.has(mesh.skeleton.bones[index]) ? values[component] : 0),
      0);
    };
    const index = mesh.geometry.index;
    const count = index?.count ?? joints.count;
    const triangles: number[] = [];
    for (let triangle = 0; triangle < count; triangle += 3) {
      const vertices = [0, 1, 2].map((offset) =>
        index ? index.getX(triangle + offset) : triangle + offset,
      );
      if (vertices.some((vertex) => weight(vertex) >= 0.5))
        triangles.push(...vertices);
    }
    if (!triangles.length) {
      mesh.removeFromParent();
      continue;
    }
    // Compact the attributes too: unused body vertices would distort normalization.
    const selected = mesh.geometry.clone();
    selected.setIndex(triangles);
    selected.clearGroups();
    mesh.geometry = selected.toNonIndexed();
    selected.dispose();
    mesh.material = handMaterial;
    mesh.name = `${side}_ArticulatedHands_${hands++}`;
  }
  oldGeometries.forEach((geometry) => geometry.dispose());
  oldMaterials.forEach((material) => material.dispose());
  oldTextures.forEach((texture) => texture.dispose());
  if (!hands) {
    handMaterial.dispose();
    throw new Error(`No articulated hand geometry was found for the finale ${side}`);
  }

  const armourMeshes: THREE.SkinnedMesh[] = [];
  armour.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) armourMeshes.push(node);
  });
  if (!armourMeshes.length)
    throw new Error("mechs.glb has no skinned armour meshes");
  const sourceSkeletons = new Set<THREE.Skeleton>();
  for (const mesh of armourMeshes) {
    const source = mesh.skeleton;
    sourceSkeletons.add(source);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    const joints = geometry.getAttribute("skinIndex");
    const weights = geometry.getAttribute("skinWeight");
    if (!positions || !joints || !weights)
      throw new Error("The finale armour is missing position or skin attributes");
    const wrists = ["hand_l", "hand_r"].map((name) => {
      const index = source.bones.findIndex((bone) => bone.name === name);
      if (index < 0) throw new Error(`The finale armour is missing ${name}`);
      return source.boneInverses[index];
    });
    const point = new THREE.Vector3();
    const local = new THREE.Vector3();
    const overlapsHand = (vertex: number) => {
      const indices = [
        joints.getX(vertex), joints.getY(vertex),
        joints.getZ(vertex), joints.getW(vertex),
      ];
      const values = [
        weights.getX(vertex), weights.getY(vertex),
        weights.getZ(vertex), weights.getW(vertex),
      ];
      const handWeight = indices.reduce((sum, index, component) =>
        sum + (handBoneNames.has(source.bones[index].name)
          ? values[component] : 0),
      0);
      if (side === "enemy" && handWeight > 0.2) return true;
      point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.bindMatrix);
      return wrists.some((inverse) => {
        local.copy(point).applyMatrix4(inverse);
        if (side === "hero")
          return local.y > 0.005 &&
            (handWeight > 0.5 || Math.hypot(local.x, local.z) < 0.12);
        return local.y > -0.025 && Math.hypot(local.x, local.z) < 0.18;
      });
    };
    const retained: number[] = [];
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: geometry.index?.count ?? positions.count, materialIndex: 0 }];
    const trimmed = geometry.clone();
    trimmed.clearGroups();
    for (const group of groups) {
      const start = retained.length;
      for (let triangle = group.start; triangle < group.start + group.count; triangle += 3) {
        const vertices = [0, 1, 2].map((offset) =>
          geometry.index ? geometry.index.getX(triangle + offset) : triangle + offset,
        );
        // Keep the hero's wrist-crossing faces so the original cuff meets the hand.
        const remove = side === "hero"
          ? vertices.every(overlapsHand)
          : vertices.some(overlapsHand);
        if (!remove) retained.push(...vertices);
      }
      trimmed.addGroup(start, retained.length - start, group.materialIndex);
    }
    if (!retained.length)
      throw new Error("Trimming the finale wrist overlap removed all armour geometry");
    trimmed.setIndex(retained);
    mesh.geometry = trimmed.toNonIndexed();
    trimmed.dispose();
    geometry.dispose();
    const mapped = source.bones.map((bone) => {
      const replacement = bones.get(bone.name);
      if (!replacement)
        throw new Error(`The finale ${side} rig cannot bind armour bone ${bone.name}`);
      return replacement;
    });
    // Keep the armour's inverse bind pose while the existing combat rig drives it.
    const skeleton = new THREE.Skeleton(
      mapped,
      source.boneInverses.map((inverse) => inverse.clone()),
    );
    const bindMatrix = mesh.bindMatrix.clone();
    rig.scene.attach(mesh);
    mesh.bind(skeleton, bindMatrix);
  }
  sourceSkeletons.forEach((skeleton) => skeleton.dispose());
  if (side === "enemy") {
    const wristGeometry = new THREE.CylinderGeometry(0.06, 0.075, 0.14, 8);
    for (const name of ["hand_l", "hand_r"]) {
      const hand = bones.get(name);
      if (!hand) throw new Error(`The finale ${side} rig is missing ${name}`);
      const cuff = new THREE.Mesh(wristGeometry, handMaterial);
      cuff.name = `${side}_WristBridge_${name}`;
      cuff.position.y = -0.045;
      cuff.castShadow = cuff.receiveShadow = true;
      hand.add(cuff);
    }
  }
  return {
    scene: rig.scene,
    animations: rig.animations,
    ownership: "owned",
    authoredMaterials: true,
  };
}
