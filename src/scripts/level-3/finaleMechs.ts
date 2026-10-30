import * as THREE from "three";
import { applyPlayerCelShading, loadToolModel } from "../../core/loader.js";
import { createFinaleMechModel } from "./finaleMechModel.js";
import {
  loadCombatAnimationsForRig,
  preloadCombatAnimations,
} from "../../core/combatAnimations.js";
import {
  createMechAnimator,
  type MechBoneMap,
  type MechPoseName,
} from "../npc/mechAnimation.js";
import type {
  MechSide,
  DuelBladePaths,
  DuelPhysicalPaths,
  BladeSegment,
} from "../npc/mechDuel.js";
import {
  captureFinaleResources,
  normalizeFinaleActor,
} from "./finaleActors.js";
import {
  createIndustrialSkin,
  FRAME_COLORS,
  MECH_PALETTES,
  HERO_REVENGE_PALETTE,
  MECH_HEIGHT,
} from "./finaleMaterials.js";
import {
  RIFLE_SEQUENCE,
  PLANET_RUPTURE,
  MELEE_STRIKES,
  isMeleeStrike,
  sampleMeleeBlade,
  sampleUltimateBlade,
  sampleRifleSequence,
  cinematicProgress,
  ENEMY_ATTACK_LEAPS,
  sampleEnemyAttackLeap,
  PHYSICAL_STRIKES,
  isPhysicalStrike,
  authoredStrikeTime,
  SWORD_ATTACK_CLIPS,
  swordClipTime,
  HERO_ULTIMATE,
  type PhysicalStrike,
  type MeleeStrike,
  type CinematicPoint,
} from "../global/finaleChoreography.js";
import { fitWeaponToHand } from "../items/createBloomstick.js";

export interface MechAsset {
  scene: THREE.Object3D;
  animations?: THREE.AnimationClip[];
  bones?: MechBoneMap;
  armored?: boolean;
  authoredMaterials?: boolean;
  ownership?: "owned" | "shared";
  sockets?: Partial<Record<"sword" | "gun" | "chest" | "gem", string>>;
}
export type MechFactory = () => Promise<MechAsset>;
export const DEFAULT_MECH_FACTORIES: Record<MechSide, MechFactory> = {
  hero: () => createFinaleMechModel("hero"),
  enemy: () => createFinaleMechModel("enemy"),
};

const clamp = THREE.MathUtils.clamp;
const bladePathCache = new Map<MechSide, DuelBladePaths>();
let physicalPathCache: DuelPhysicalPaths | undefined;

export function createFinaleMech(
  side: MechSide,
  factory: MechFactory = DEFAULT_MECH_FACTORIES[side],
) {
  const reusableRig = factory === DEFAULT_MECH_FACTORIES[side];
  const root = new THREE.Group();
  root.name = side === "hero" ? "PrimeFrame" : "FinalVerdict";
  const skin = createIndustrialSkin(side);
  const swordMetal = new THREE.MeshPhysicalMaterial({
    color: side === "hero" ? 0xc1ced3 : 0x555158,
    metalness: 0.96,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  const bladeMaterial = new THREE.MeshPhysicalMaterial({
    color: side === "hero" ? 0xc1ced3 : 0x716a70,
    metalness: 0.98,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    emissive: FRAME_COLORS[side],
    emissiveIntensity: 0.16,
  });
  const cyan = new THREE.MeshBasicMaterial({
    color: FRAME_COLORS[side],
    toneMapped: false,
  });
  const orange = new THREE.MeshBasicMaterial({
    color: side === "hero" ? 0xb88750 : 0x6e202c,
    toneMapped: false,
  });
  const generated: THREE.BufferGeometry[] = [];
  let model: THREE.Object3D | null = null,
    normalized: THREE.Group | null = null;
  let animator: ReturnType<typeof createMechAnimator> | null = null;
  let swordBone: THREE.Object3D | null = null,
    gunBone: THREE.Object3D | null = null,
    chestBone: THREE.Object3D | null = null;
  let gemSocket: THREE.Object3D | null = null;
  const swordGripSocket = new THREE.Object3D();
  const swordFingerGrip: Array<{
    bone: THREE.Object3D;
    rotation: THREE.Quaternion;
  }> = [];
  const openHand = new Map<THREE.Object3D, THREE.Quaternion>();
  let nativeMixer: THREE.AnimationMixer | null = null,
    nativeAction: THREE.AnimationAction | null = null;
  let resources: ReturnType<typeof captureFinaleResources> | null = null;
  let gunResources: ReturnType<typeof captureFinaleResources> | null = null,
    disposed = false;
  let build = 1,
    damage = 0,
    dissolve = 0,
    powerUp = 0,
    baseY = 0,
    restFootY = 0;
  let previousMove = "",
    blendStart = 0,
    gunHeld = false,
    gunEnabled = side === "hero",
    rifleTime = 0;
  let sampling = false,
    shielded = false,
    forwardMotion = 0,
    liftMotion = 0,
    poseBlend = 1;
  let showWeapons = true;
  let weaponColors:
    | {
        metal: THREE.Color;
        metalGlow: THREE.Color;
        blade: THREE.Color;
        bladeGlow: THREE.Color;
        edge: THREE.Color;
        accent: THREE.Color;
      }
    | undefined;
  const powerPlate = new THREE.Color(HERO_REVENGE_PALETTE.platelight);
  const powerGem = new THREE.Color(HERO_REVENGE_PALETTE.gemlight);
  const bladeEntry = {
    grip: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 1, 0),
  };
  const shieldCenter = new THREE.Vector3();
  const previousPose = new Map<
    THREE.Object3D,
    { rotation: THREE.Quaternion; position: THREE.Vector3; scale: THREE.Vector3 }
  >();
  const sampledPose: Array<{
    bone: THREE.Bone;
    rotation: THREE.Quaternion;
    position: THREE.Vector3;
    scale: THREE.Vector3;
  }> = [];
  const clips = new Map<string, THREE.AnimationClip>();
  const socketRest = new Map<THREE.Object3D, THREE.Quaternion>();
  const worldPosition = new THREE.Vector3(),
    rootRotation = new THREE.Quaternion(),
    boneRotation = new THREE.Quaternion();
  const deltaRotation = new THREE.Quaternion(),
    bladeA = new THREE.Vector3(),
    bladeB = new THREE.Vector3();
  const gun = new THREE.Group();
  gun.name = `${root.name}_Rifle`;
  root.add(gun);
  const muzzleLocal = new THREE.Vector3(),
    foregripLocal = new THREE.Vector3();
  const weaponDirection = new THREE.Vector3(),
    desiredDirection = new THREE.Vector3(),
    weaponOrigin = new THREE.Vector3();
  const handWorld = new THREE.Quaternion(),
    parentWorld = new THREE.Quaternion(),
    aimRotation = new THREE.Quaternion();
  const swordOffset = new THREE.Vector3(0, -0.25, 0.2),
    swordGrip = new THREE.Quaternion();
  const gunOffset = new THREE.Vector3(0, -0.1, 0.2),
    gunGrip = new THREE.Quaternion();
  const gunHolster = new THREE.Vector3(-1.7, -2.1, -1.6);
  const gunHolsterGrip = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, -0.16),
  );
  const swordHolster = new THREE.Vector3(1.6, 1.15, -1.45);
  const swordHolsterGrip = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, 0, Math.PI - 0.18),
  );
  const weaponLocal = new THREE.Vector3(),
    drawTarget = new THREE.Vector3(),
    stowTarget = new THREE.Vector3();
  const aimGripLocal = new THREE.Vector3(-1.3, 11.3, 2.4);
  const rifleEntry = {
    grip: new THREE.Vector3(),
    direction: new THREE.Vector3(),
  };
  const gunMountPosition = new THREE.Vector3(),
    gunMountRotation = new THREE.Quaternion();
  const sheathPosition = new THREE.Vector3(),
    sheathRotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  const sword = new THREE.Group();
  sword.name = `${root.name}_ReactorBlade`;
  root.add(sword);
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.58, 0.72);
  bladeShape.lineTo(-0.36, 1.38);
  bladeShape.lineTo(-0.22, 10.25);
  bladeShape.lineTo(0, 13.05);
  bladeShape.lineTo(0.22, 10.25);
  bladeShape.lineTo(0.36, 1.38);
  bladeShape.lineTo(0.58, 0.72);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.07,
    bevelThickness: 0.06,
  });
  bladeGeometry.translate(0, 0, -0.1);
  generated.push(bladeGeometry);
  const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
  blade.castShadow = blade.receiveShadow = true;
  sword.add(blade);

  const edgeGeometry = new THREE.CylinderGeometry(0.045, 0.06, 9.2, 7);
  const hiltGeometry = new THREE.CylinderGeometry(0.15, 0.2, 1.8, 9);
  const emitterGeometry = new THREE.CylinderGeometry(0.16, 0.22, 0.42, 9);
  const guardGeometry = new THREE.TorusGeometry(0.62, 0.1, 8, 18);
  const pommelGeometry = new THREE.IcosahedronGeometry(0.3, 1);
  generated.push(
    edgeGeometry,
    hiltGeometry,
    emitterGeometry,
    guardGeometry,
    pommelGeometry,
  );
  const leftEdge = new THREE.Mesh(
    edgeGeometry,
    side === "hero" ? orange : cyan,
  );
  const rightEdge = new THREE.Mesh(edgeGeometry, cyan);
  leftEdge.position.set(-0.31, 5.8, 0.14);
  rightEdge.position.set(0.31, 5.8, 0.14);
  const hilt = new THREE.Mesh(hiltGeometry, swordMetal);
  hilt.position.y = -0.38;
  const emitter = new THREE.Mesh(
    emitterGeometry,
    side === "hero" ? orange : cyan,
  );
  emitter.position.y = 0.7;
  const guard = new THREE.Mesh(guardGeometry, swordMetal);
  guard.rotation.x = Math.PI / 2;
  guard.position.y = 0.92;
  const pommel = new THREE.Mesh(
    pommelGeometry,
    side === "hero" ? cyan : orange,
  );
  pommel.position.y = -1.38;
  sword.add(leftEdge, rightEdge, hilt, emitter, guard, pommel);
  sword.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true;
  });
  const scabbard = new THREE.Group();
  scabbard.name = `${root.name}_BladeSheath`;
  root.add(scabbard);
  const sheathGeometry = new THREE.BoxGeometry(0.86, 11.8, 0.44);
  generated.push(sheathGeometry);
  const sheath = new THREE.Mesh(sheathGeometry, skin.material);
  sheath.customDepthMaterial = skin.depth;
  sheath.position.y = 6.2;
  sheath.castShadow = sheath.receiveShadow = true;
  scabbard.add(sheath);

  function relativeRotation(bone: THREE.Object3D) {
    return root
      .getWorldQuaternion(rootRotation)
      .invert()
      .multiply(bone.getWorldQuaternion(boneRotation))
      .clone();
  }
  function applyPowerUp() {
    skin.setPowerUp(powerUp);
    if (!weaponColors) return;
    swordMetal.color.lerpColors(weaponColors.metal, powerPlate, powerUp);
    swordMetal.emissive.lerpColors(weaponColors.metalGlow, powerPlate, powerUp);
    bladeMaterial.color.lerpColors(weaponColors.blade, powerPlate, powerUp);
    bladeMaterial.emissive.lerpColors(weaponColors.bladeGlow, powerGem, powerUp);
    cyan.color.lerpColors(weaponColors.edge, powerGem, powerUp);
    orange.color.lerpColors(weaponColors.accent, powerGem, powerUp);
  }
  const loaded = Promise.all([
    factory(),
    loadToolModel("Gun_Rifle"),
    preloadCombatAnimations(),
  ]).then(async ([asset, rifle]) => {
    resources = captureFinaleResources(
      asset.scene,
      asset.ownership === "shared",
    );
    gunResources = captureFinaleResources(rifle.scene);
    const combatClips = await loadCombatAnimationsForRig(asset.scene);
    if (disposed) {
      resources.dispose();
      gunResources.dispose();
      return;
    }
    model = asset.scene;
    normalized = normalizeFinaleActor(model, MECH_HEIGHT);
    baseY = normalized.position.y;
    root.add(normalized);
    if (asset.authoredMaterials) {
      const materials = new Set<THREE.MeshStandardMaterial>();
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial))
            throw new Error(`${root.name} requires PBR materials for its authored finish`);
          materials.add(material);
        }
        node.customDepthMaterial = skin.depth;
      });
      for (const material of materials) skin.finishAuthoredMaterial(material);
      applyPlayerCelShading(model, true);
      const plate = [...materials].find((material) => material.name === "platelight");
      const gem = [...materials].find((material) => material.name === "gemlight");
      if (!plate || !gem)
        throw new Error("The finale mech is missing its plate or gem palette");
      const basePlate = new THREE.Color(MECH_PALETTES[side].platelight);
      const baseGem = new THREE.Color(MECH_PALETTES[side].gemlight);
      swordMetal.color.copy(basePlate).lerp(new THREE.Color(0xffffff), 0.25);
      swordMetal.emissive.copy(basePlate);
      swordMetal.emissiveIntensity = 0.12;
      bladeMaterial.color.copy(basePlate).lerp(new THREE.Color(0xffffff), 0.5);
      bladeMaterial.emissive.copy(basePlate);
      cyan.color.copy(basePlate);
      orange.color.set(side === "hero" ? baseGem : FRAME_COLORS.enemy);
      sheath.material = swordMetal;
      sheath.customDepthMaterial = undefined;
    } else {
      model.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.material = skin.material;
          node.customDepthMaterial = skin.depth;
        }
      });
    }
    weaponColors = {
      metal: swordMetal.color.clone(),
      metalGlow: swordMetal.emissive.clone(),
      blade: bladeMaterial.color.clone(),
      bladeGlow: bladeMaterial.emissive.clone(),
      edge: cyan.color.clone(),
      accent: orange.color.clone(),
    };
    applyPowerUp();
    animator = createMechAnimator(model, asset.bones);
    nativeMixer = new THREE.AnimationMixer(model);
    for (const clip of asset.animations ?? [])
      clips.set(clip.name.toLowerCase(), clip);
    for (const clip of combatClips) clips.set(clip.name.toLowerCase(), clip);
    root.updateMatrixWorld(true);
    swordBone = asset.sockets?.sword
      ? (model.getObjectByName(asset.sockets.sword) ?? null)
      : (animator.slots.rightHand ?? null);
    if (!swordBone)
      throw new Error(
        `${root.name} needs a sword socket or a semantic right-hand bone`,
      );
    gunBone = asset.sockets?.gun
      ? (model.getObjectByName(asset.sockets.gun) ?? null)
      : (animator.slots.rightHand ?? null);
    chestBone = asset.sockets?.chest
      ? (model.getObjectByName(asset.sockets.chest) ?? null)
      : (animator.slots.spineUpper ?? null);
    gemSocket = asset.sockets?.gem
      ? (model.getObjectByName(asset.sockets.gem) ?? null)
      : null;
    if (!gunBone || !chestBone)
      throw new Error(
        `${root.name} needs gun and chest sockets or semantic hand and upper-spine bones`,
      );
    for (const bone of [
      swordBone,
      gunBone,
      chestBone,
      animator.slots.leftHand,
      animator.slots.rightHand,
      animator.slots.head,
    ]) {
      if (bone) socketRest.set(bone, relativeRotation(bone));
    }
    animator.slots.leftHand?.traverse((bone) => {
      if (/^(thumb|index|middle|ring|pinky)_0[1-3]_l$/.test(bone.name))
        openHand.set(bone, bone.quaternion.clone());
    });
    const swordIdle = clips.get("sword_idle");
    if (swordIdle) {
      const sample = nativeMixer.clipAction(swordIdle).play();
      sample.paused = true;
      nativeMixer.update(0);
    }
    swordGripSocket.name = `${root.name}_SwordGripSocket`;
    fitWeaponToHand(swordGripSocket, swordBone, 0);
    swordBone.traverse((bone) => {
      if (/^(thumb|index|middle|ring|pinky)_0[1-3]_r$/.test(bone.name)) {
        swordFingerGrip.push({ bone, rotation: bone.quaternion.clone() });
      }
    });
    nativeMixer.stopAllAction();
    animator.stop();
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(rifle.scene),
      length = bounds.getSize(new THREE.Vector3()).x;
    if (!Number.isFinite(length) || length <= 0)
      throw new Error("The finale rifle has invalid geometry bounds");
    const rifleScale = 8.4 / length;
    rifle.scene.scale.multiplyScalar(rifleScale);
    rifle.scene.rotation.y = Math.PI / 2;
    rifle.scene.position.y = -0.08 * rifleScale;
    rifle.scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.material = asset.authoredMaterials ? swordMetal : skin.material;
        node.customDepthMaterial = asset.authoredMaterials ? undefined : skin.depth;
        node.castShadow = node.receiveShadow = true;
      }
    });
    gun.add(rifle.scene);
    muzzleLocal.set(0, 0.05 * rifleScale, -bounds.min.x * rifleScale);
    foregripLocal.set(0, -0.07 * rifleScale, -bounds.min.x * rifleScale * 0.48);
    const feet = [animator.slots.leftFoot, animator.slots.rightFoot].filter(
      (node): node is THREE.Object3D => !!node,
    );
    restFootY = feet.length
      ? Math.min(
          ...feet.map(
            (foot) =>
              root.worldToLocal(foot.getWorldPosition(new THREE.Vector3())).y,
          ),
        )
      : 0;
    model.traverse((node) => {
      if (node instanceof THREE.Bone)
        sampledPose.push({
          bone: node,
          rotation: node.quaternion.clone(),
          position: node.position.clone(),
          scale: node.scale.clone(),
        });
    });
  });

  function attachWeapon(
    weapon: THREE.Object3D,
    bone: THREE.Object3D,
    offset: THREE.Vector3,
    grip: THREE.Quaternion,
  ) {
    if (weapon === sword && bone === swordBone) {
      for (const finger of swordFingerGrip)
        finger.bone.quaternion.copy(finger.rotation);
      swordGripSocket.getWorldPosition(worldPosition);
      sword.position.copy(root.worldToLocal(worldPosition));
      sword.quaternion.copy(relativeRotation(swordGripSocket));
      sword.position.add(
        new THREE.Vector3(0, 0.38, 0).applyQuaternion(sword.quaternion),
      );
      sword.updateWorldMatrix(true, false);
      return;
    }
    bone.getWorldPosition(worldPosition);
    weapon.position.copy(root.worldToLocal(worldPosition));
    deltaRotation
      .copy(relativeRotation(bone))
      .multiply(socketRest.get(bone)!.clone().invert());
    weapon.position.add(
      worldPosition.copy(offset).applyQuaternion(deltaRotation),
    );
    weapon.quaternion.copy(deltaRotation).multiply(grip);
    weapon.updateWorldMatrix(true, false);
  }
  function aimHand(
    weapon: THREE.Object3D,
    bone: THREE.Object3D,
    axis: THREE.Vector3,
    target: THREE.Vector3,
    maxTwist = Infinity,
  ) {
    weapon.getWorldPosition(weaponOrigin);
    desiredDirection.copy(target).sub(weaponOrigin);
    if (desiredDirection.lengthSq() < 0.001) return;
    weaponDirection
      .copy(axis)
      .applyQuaternion(weapon.getWorldQuaternion(handWorld))
      .normalize();
    aimRotation.setFromUnitVectors(
      weaponDirection,
      desiredDirection.normalize(),
    );
    // Cap how far the wrist can crank off its rest pose so carrying the blade
    // never snaps into anatomically impossible angles. Full freedom is kept for
    // clash/drive aim where the blade must land on an exact contact line.
    if (Number.isFinite(maxTwist)) {
      const twist = 2 * Math.acos(clamp(Math.abs(aimRotation.w), 0, 1));
      if (twist > maxTwist)
        aimRotation.slerp(new THREE.Quaternion(), maxTwist / twist);
    }
    bone.getWorldQuaternion(handWorld).premultiply(aimRotation);
    if (!bone.parent)
      throw new Error(`${bone.name} needs a parent for its weapon socket`);
    bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(handWorld));
    root.updateMatrixWorld(true);
  }
  function pointSwordAt(target: THREE.Vector3, maxTwist = Infinity) {
    if (!swordBone || gunHeld) return;
    aimHand(sword, swordBone, new THREE.Vector3(0, 1, 0), target, maxTwist);
    attachWeapon(sword, swordBone, swordOffset, swordGrip);
  }
  function blendBladeDirection(from: THREE.Vector3, to: THREE.Vector3, weight: number) {
    const start = from.clone().normalize();
    const end = to.clone().normalize();
    if (start.lengthSq() < 0.001) return end;
    if (end.lengthSq() < 0.001) return start;
    const turn = new THREE.Quaternion().setFromUnitVectors(start, end);
    return start.applyQuaternion(new THREE.Quaternion().slerp(turn, weight));
  }
  function driveBlade(
    grip: THREE.Vector3,
    direction: THREE.Vector3,
    support = false,
    transition = true,
  ) {
    if (!animator || !swordBone) return;
    if (transition && poseBlend < 1) {
      grip.lerpVectors(bladeEntry.grip, grip.clone(), poseBlend);
      direction.copy(blendBladeDirection(bladeEntry.direction, direction, poseBlend));
    }
    const target = root.localToWorld(grip.clone());
    const look = root.localToWorld(grip.clone().addScaledVector(direction, 20));
    const armPose = [animator.slots.rightArm, animator.slots.rightElbow, swordBone]
      .filter((bone): bone is THREE.Object3D => !!bone)
      .map((bone) => ({ bone, rotation: bone.quaternion.clone() }));
    for (let pass = 0; pass < 4; pass++) {
      attachWeapon(sword, swordBone, swordOffset, swordGrip);
      const palm = swordBone.getWorldPosition(new THREE.Vector3());
      const correction = sword.getWorldPosition(new THREE.Vector3()).sub(palm);
      // Refine the grip offset from the same pose; do not wind up the wrist each pass.
      for (const entry of armPose) entry.bone.quaternion.copy(entry.rotation);
      root.updateMatrixWorld(true);
      animator.reach(
        "right",
        target.clone().sub(correction),
        root.localToWorld(new THREE.Vector3(-6, 11, 2)),
      );
      attachWeapon(sword, swordBone, swordOffset, swordGrip);
      pointSwordAt(look);
    }
    if (support) {
      animator.reach(
        "left",
        sword.localToWorld(new THREE.Vector3(0, -0.65, 0)),
        root.localToWorld(new THREE.Vector3(5, 11, 2)),
      );
    }
    attachWeapon(sword, swordBone, swordOffset, swordGrip);
    root.updateMatrixWorld(true);
  }
  function orientWeapon(
    weapon: THREE.Object3D,
    bone: THREE.Object3D,
    rotation: THREE.Quaternion,
    offset: THREE.Vector3,
    grip: THREE.Quaternion,
  ) {
    root.getWorldQuaternion(rootRotation);
    aimRotation
      .copy(rootRotation)
      .multiply(rotation)
      .multiply(weapon.getWorldQuaternion(handWorld).invert());
    bone.getWorldQuaternion(handWorld).premultiply(aimRotation);
    if (!bone.parent)
      throw new Error(`${bone.name} needs a parent for weapon orientation`);
    bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(handWorld));
    root.updateMatrixWorld(true);
    attachWeapon(weapon, bone, offset, grip);
  }
  function supportRifle(weight = 1) {
    if (!animator || !gunBone || weight <= 0) return;
    const side = gunBone === animator.slots.leftHand ? "right" : "left";
    const hand = animator.slots[side === "left" ? "leftHand" : "rightHand"];
    if (!hand)
      throw new Error("A two-handed rifle needs its support-hand bone");
    const target = hand
      .getWorldPosition(new THREE.Vector3())
      .lerp(gun.localToWorld(foregripLocal.clone()), weight);
    animator.reach(
      side,
      target,
      root.localToWorld(
        new THREE.Vector3(side === "left" ? 4.5 : -4.5, 8.5, 3),
      ),
    );
    root.updateMatrixWorld(true);
  }
  function nativeClip(
    move: MechPoseName,
    airborne: boolean,
    poseTime: number,
    jumping: boolean,
    cinematic: boolean,
  ) {
    const find = (...names: string[]) =>
      names
        .map((name) => clips.get(name.toLowerCase()))
        .find((clip): clip is THREE.AnimationClip => !!clip);
    if (isMeleeStrike(move)) return find(SWORD_ATTACK_CLIPS[move]);
    if (move === "guard" || move === "clash") return find("Sword_Block");
    if (move === "mourn") return find("Fixing_Kneeling", "Crouch_Idle_Loop");
    if (move === "slide") return find("Slide_Tackle");
    if (move === "jab") return find("Punch_Jab");
    if (move === "cross") return find("Punch_Cross");
    if (move === "hook") return find("Melee_Hook_WithRecovery");
    if (cinematic && (move === "evade" || move === "boost"))
      return find("Jump_Loop");
    if (cinematic && (move === "skyCharge" || move === "reactor"))
      return find("Spell_Simple_Idle_Loop");
    if (
      move === "hover" ||
      move === "flight" ||
      move === "evade" ||
      move === "boost" ||
      move === "dash" ||
      move === "bomb" ||
      move === "skyCharge" ||
      move === "reactor"
    )
      return undefined;
    if (jumping) return find("Jump_Loop");
    if (airborne && (move === "idle" || move === "walk"))
      return find("Sword_Idle", "Idle_Loop");
    if (move === "idle")
      return showWeapons ? find("Sword_Idle", "Idle_Loop") : find("Idle_Loop");
    if (move === "walk") return find("Walk_Loop");
    if (move === "overdrive") return find(SWORD_ATTACK_CLIPS.cleave);
    if (move === "missiles")
      return sampleRifleSequence(poseTime).firing
        ? find("Pistol_Shoot")
        : find("Pistol_Idle_Loop");
    if (move === "verdict") return find("Sword_Idle", "Idle_Loop");
    if (move === "afterCut" || move === "powerUp") return find("Sword_Idle");
    if (move === "transform") return find("Idle_Loop");
    if (move === "defeat") return find("Death01", "Death_01", "Death");
    if (move === "victory") return find("Sword_Idle", "Idle_Loop");
    if (move === "dance") return find("Dance_Loop");
    if (move === "stagger") return find("Hit_Chest", "Hit", "Idle_Loop");
    return undefined;
  }

  const mech = {
    root,
    sword,
    gun,
    loaded,
    pointSwordAt,
    setMotion(forward: number, lift: number) {
      forwardMotion = clamp(forward / 9, -1, 1);
      liftMotion = clamp(lift / 8.5, -1, 1);
    },
    setGuarding(value: boolean) {
      shielded = value;
    },
    setAssembly(value: number) {
      build = clamp(value, 0, 1);
    },
    setDamage(value: number) {
      damage = clamp(value, 0, 1);
    },
    setDissolve(value: number) {
      dissolve = clamp(value, 0, 1);
    },
    setPowerUp(value: number) {
      if (!Number.isFinite(value))
        throw new RangeError("Mech transformation progress must be finite");
      const progress = side === "hero" ? clamp(value, 0, 1) : 0;
      if (progress === powerUp) return;
      powerUp = progress;
      applyPowerUp();
    },
    setGunEnabled(value: boolean) {
      gunEnabled = value;
    },
    setBladeCharge(value: number) {
      bladeMaterial.emissiveIntensity = 0.16 + clamp(value, 0, 1) * 1.8;
    },
    markSlash(from: THREE.Vector3, to: THREE.Vector3) {
      skin.engrave(
        root.worldToLocal(from.clone()),
        root.worldToLocal(to.clone()),
      );
    },
    lockBlade(contact: THREE.Vector3, side: 1 | -1, strain = 0, weight = 1) {
      if (!animator || !swordBone) return;
      const forward = new THREE.Vector3(0, 0, side)
        .applyQuaternion(root.quaternion)
        .setY(0)
        .normalize();
      const normal = new THREE.Vector3().crossVectors(forward, up).normalize();
      const bladeDirection = forward
        .clone()
        .multiplyScalar(side * 0.74)
        .addScaledVector(up, 0.672 + strain)
        .normalize();
      // Offset the blade planes by their bevelled thickness; their edges meet without occupying the same volume.
      const edge = contact.clone().addScaledVector(normal, side * 0.18);
      const desiredGrip = root.worldToLocal(
        edge.clone().addScaledVector(bladeDirection, -7.2),
      );
      const grip = sword.position.clone().lerp(desiredGrip, weight);
      const localDirection = bladeDirection
        .clone()
        .applyQuaternion(root.getWorldQuaternion(rootRotation).invert());
      const direction = blendBladeDirection(
        up.clone().applyQuaternion(sword.quaternion), localDirection, weight,
      );
      driveBlade(grip, direction, false, false);
      const alignment = cinematicProgress(weight, 0.15, 0.95);
      for (let pass = 0; pass < 3; pass++) {
        const worldDirection = edge
          .clone()
          .sub(sword.getWorldPosition(new THREE.Vector3()))
          .normalize();
        const width = new THREE.Vector3()
          .crossVectors(worldDirection, normal)
          .normalize();
        const depth = new THREE.Vector3()
          .crossVectors(width, worldDirection)
          .normalize();
        const orientation = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(width, worldDirection, depth),
        );
        orientation.premultiply(root.getWorldQuaternion(rootRotation).invert());
        orientation.slerpQuaternions(sword.quaternion, orientation.clone(), alignment);
        orientWeapon(sword, swordBone, orientation, swordOffset, swordGrip);
      }
      const supportHand = animator.slots.leftHand;
      if (supportHand) {
        const support = supportHand.getWorldPosition(new THREE.Vector3()).lerp(
          sword.localToWorld(new THREE.Vector3(0, -0.65, 0)),
          cinematicProgress(weight, 0.08, 0.9),
        );
        animator.reach(
          "left",
          support,
          root.localToWorld(new THREE.Vector3(5, 9, 2)),
        );
      }
      root.updateMatrixWorld(true);
    },
    pose(
      move: MechPoseName,
      time: number,
      duration = 1,
      airborne = false,
      combo = 0,
      effectTime = time,
      custom = false,
      sequence = "",
      travel?: { velocity: THREE.Vector3; clock: number; weight: number },
    ) {
      if (!animator || !nativeMixer || !normalized || !model) return;
      const motion = Math.hypot(forwardMotion, liftMotion);
      const poseMove =
        airborne && !custom && (move === "idle" || move === "walk")
          ? motion > 0.05
            ? "flight"
            : "hover"
          : move;
      const jump =
        side === "enemy" &&
        !custom &&
        move === "verdict" &&
        time < ENEMY_ATTACK_LEAPS[move].land
          ? sampleEnemyAttackLeap(move, time)
          : null;
      const clip = nativeClip(poseMove, airborne, time, !!jump, custom);
      const looping =
        !jump &&
        (move === "idle" ||
          move === "walk" ||
          move === "victory" ||
          move === "dance" ||
          move === "afterCut" ||
          move === "powerUp" ||
          move === "guard" ||
          move === "clash" ||
          move === "skyCharge" ||
          move === "reactor" ||
          move === "verdict" ||
          move === "bomb" ||
          (move === "missiles" && !sampleRifleSequence(time).firing));
      const sustained =
        custom &&
        (move === "skyCharge" ||
          move === "reactor" ||
          move === "afterCut" ||
          move === "powerUp");
      const moveKey = `${poseMove}-${clip?.name ?? "procedural"}-${sustained ? "hold" : sequence}`;
      if (previousMove && previousMove !== moveKey) {
        previousPose.clear();
        // Twist bones and fingers must crossfade with the main joints.
        for (const { bone } of sampledPose) {
          previousPose.set(bone, {
            rotation: bone.quaternion.clone(),
            position: bone.position.clone(),
            scale: bone.scale.clone(),
          });
        }
        bladeEntry.grip.copy(sword.position);
        bladeEntry.direction.copy(up).applyQuaternion(sword.quaternion);
        blendStart = effectTime;
      }
      if (move === "missiles" && !previousMove.startsWith("missiles-")) {
        rifleEntry.grip.copy(sword.position);
        rifleEntry.direction.copy(up).applyQuaternion(sword.quaternion);
      }
      previousMove = moveKey;
      // PropertyMixer skips unchanged samples; restore the unmodified sample before IK and overlays.
      for (const sample of sampledPose) {
        sample.bone.quaternion.copy(sample.rotation);
        sample.bone.position.copy(sample.position);
        sample.bone.scale.copy(sample.scale);
      }
      normalized.position.y = baseY;
      if (clip) {
        const next = nativeMixer.clipAction(clip);
        if (nativeAction !== next) {
          nativeAction?.stop();
          animator.stop();
          nativeAction = next.reset().play();
        }
        nativeAction.setLoop(
          looping ? THREE.LoopRepeat : THREE.LoopOnce,
          looping ? Infinity : 1,
        );
        nativeAction.clampWhenFinished = true;
        nativeAction.time =
          move === "guard" || move === "clash"
            ? clip.duration * 0.55
            : isPhysicalStrike(move) && move !== "slide"
              ? authoredStrikeTime(time, clip.duration, PHYSICAL_STRIKES[move])
              : move === "orbitalCut"
                ? swordClipTime(
                    time,
                    clip.duration,
                    MELEE_STRIKES.reap,
                    MELEE_STRIKES.orbitalCut,
                  )
                : move === "overdrive"
                  ? swordClipTime(time, clip.duration, MELEE_STRIKES.cleave, {
                      duration: HERO_ULTIMATE.duration,
                      start: HERO_ULTIMATE.cameraEnd,
                      end: HERO_ULTIMATE.release,
                    })
                  : jump
                    ? jump.progress * clip.duration
                    : looping
                      ? Math.max(0, effectTime) % clip.duration
                      : move === "missiles" && clip.name === "Pistol_Shoot"
                        ? ((Math.max(0, time - RIFLE_SEQUENCE.fire) % 0.14) /
                            0.14) *
                          clip.duration
                        : clamp(time / Math.max(0.01, duration), 0, 1) *
                          clip.duration;
        if (move === "mourn") {
          nativeAction.time = Math.min(0.7, clip.duration) * cinematicProgress(time, 0, 1.6);
        } else if (custom && (move === "skyCharge" || move === "reactor")) {
          nativeAction.time = clip.duration * 0.35;
        } else if (custom && (move === "evade" || move === "boost")) {
          const flight = clamp(time / Math.max(duration, 0.01), 0, 1);
          nativeAction.time = clip.duration * (0.35 + flight * 0.2);
        }
        nativeAction.paused = true;
        nativeMixer.update(0);
      } else {
        nativeAction?.stop();
        nativeAction = null;
        animator.pose(
          poseMove,
          poseMove === "flight"
            ? Math.min(1, motion)
            : looping
              ? effectTime
              : time,
          poseMove === "flight" ? 1 : duration,
          airborne,
          combo,
          poseMove === "guard" ||
            poseMove === "hover" ||
            poseMove === "flight" ||
            poseMove === "boost" ||
            poseMove === "evade" ||
            poseMove === "dash" ||
            poseMove === "clash" ||
            poseMove === "bomb" ||
            poseMove === "skyCharge" ||
            poseMove === "reactor" ||
            poseMove === "powerUp",
        );
      }
      for (const sample of sampledPose) {
        sample.rotation.copy(sample.bone.quaternion);
        sample.position.copy(sample.bone.position);
        sample.scale.copy(sample.bone.scale);
      }
      const blend =
        sampling || !previousPose.size
          ? 1
          : THREE.MathUtils.smootherstep(
              effectTime - blendStart,
              0,
              custom
                ? sequence.includes("-exchange-")
                  ? isMeleeStrike(move) || move === "clash" ? 0.14 : 0.24
                  : move === "stagger" || isMeleeStrike(move)
                    ? 0.16
                    : sustained
                      ? 0.32
                      : 0.24
                : 0.13,
            );
      poseBlend = blend;
      if (blend < 1)
        for (const [bone, previous] of previousPose) {
          bone.quaternion.slerpQuaternions(
            previous.rotation,
            bone.quaternion.clone(),
            blend,
          );
          bone.position.lerpVectors(
            previous.position,
            bone.position.clone(),
            blend,
          );
          bone.scale.lerpVectors(previous.scale, bone.scale.clone(), blend);
        }
      if (!sampling)
        animator.perform(
          poseMove,
          effectTime,
          custom ? 0.35 : 0.25,
          forwardMotion,
          liftMotion,
        );
      if (travel && !sampling) {
        const localVelocity = travel.velocity.clone().applyQuaternion(
          root.getWorldQuaternion(rootRotation).invert(),
        );
        animator.travel(localVelocity, travel.clock, travel.weight);
      }
      root.updateMatrixWorld(true);
      const head = animator.slots.head;
      if (move === "guard" && head?.parent && socketRest.has(head)) {
        head.parent.getWorldQuaternion(boneRotation).invert();
        head.quaternion.copy(
          boneRotation
            .multiply(root.getWorldQuaternion(rootRotation))
            .multiply(socketRest.get(head)!),
        );
        root.updateMatrixWorld(true);
      }
      if (!airborne && animator.slots.leftFoot && animator.slots.rightFoot) {
        const left = root.worldToLocal(
          animator.slots.leftFoot.getWorldPosition(new THREE.Vector3()),
        ).y;
        const right = root.worldToLocal(
          animator.slots.rightFoot.getWorldPosition(new THREE.Vector3()),
        ).y;
        normalized.position.y -= Math.min(left, right) - restFootY;
        root.updateMatrixWorld(true);
      }
      rifleTime = move === "missiles" ? time : 0;
      gunHeld =
        move === "missiles" &&
        time >= RIFLE_SEQUENCE.draw &&
        time < RIFLE_SEQUENCE.holstered;
      const swordStowed =
        !showWeapons ||
        move === "slide" ||
        move === "bomb" ||
        move === "dance" ||
        (move === "missiles" &&
          time >= RIFLE_SEQUENCE.sheath &&
          time < RIFLE_SEQUENCE.swordDraw);
      if (swordBone && chestBone) {
        attachWeapon(
          sword,
          swordStowed ? chestBone : swordBone,
          swordStowed ? swordHolster : swordOffset,
          swordStowed ? swordHolsterGrip : swordGrip,
        );
        attachWeapon(scabbard, chestBone, swordHolster, swordHolsterGrip);
      }
      if (gunBone && chestBone) {
        attachWeapon(
          gun,
          gunHeld ? gunBone : chestBone,
          gunHeld ? gunOffset : gunHolster,
          gunHeld ? gunGrip : gunHolsterGrip,
        );
      }
      sword.visible = build > 0.65 && move !== "defeat" && move !== "mourn" && dissolve < 0.9;
      scabbard.visible = build > 0.65 && move !== "defeat" && dissolve < 0.99;
      blade.visible = leftEdge.visible = rightEdge.visible = !swordStowed;
      blade.scale.y = leftEdge.scale.y = rightEdge.scale.y = 1;
      gun.visible =
        gunEnabled && build > 0.95 && move !== "defeat" && dissolve < 0.99;
      if (move === "missiles" && gunBone && swordBone && chestBone) {
        const sequence = sampleRifleSequence(time);
        attachWeapon(gun, chestBone, gunHolster, gunHolsterGrip);
        gunMountPosition.copy(gun.position);
        gunMountRotation.copy(gun.quaternion);
        const gunSide = gunBone === animator.slots.leftHand ? "left" : "right";
        const sign = gunSide === "right" ? -1 : 1;
        aimGripLocal.x = sign * 1.3;
        gunHolster.x = sign * 1.7;
        const gunPole = root.localToWorld(
          new THREE.Vector3(sign * 6.5, 8.4, 2.8),
        );
        attachWeapon(scabbard, chestBone, swordHolster, swordHolsterGrip);
        sheathPosition.copy(scabbard.position);
        sheathRotation.copy(scabbard.quaternion);
        if (time < RIFLE_SEQUENCE.sheath) {
          stowTarget
            .copy(rifleEntry.grip)
            .lerp(sheathPosition, sequence.sheath);
          stowTarget.y += Math.sin(sequence.sheath * Math.PI) * 2;
          const direction = blendBladeDirection(
            rifleEntry.direction,
            up.clone().applyQuaternion(sheathRotation),
            sequence.sheath,
          );
          driveBlade(stowTarget, direction);
          const retract =
            1 -
            cinematicProgress(
              time,
              RIFLE_SEQUENCE.sheath * 0.45,
              RIFLE_SEQUENCE.sheath,
            );
          blade.scale.y =
            leftEdge.scale.y =
            rightEdge.scale.y =
              Math.max(0.02, retract);
        } else if (time < RIFLE_SEQUENCE.draw) {
          drawTarget.copy(sheathPosition).lerp(gunMountPosition, sequence.draw);
          drawTarget.y += Math.sin(sequence.draw * Math.PI) * 1.4;
        } else if (time < RIFLE_SEQUENCE.ready) {
          const p = sequence.shoulderToAim;
          drawTarget.copy(gunMountPosition).lerp(aimGripLocal, p);
          // Lift just above the shoulder line and sweep forward instead of arcing
          // over the crown, so the rifle settles into the cheek rather than
          // reading as an arm reaching behind the head.
          drawTarget.y += Math.sin(p * Math.PI) * 1.1;
          drawTarget.z += Math.sin(p * Math.PI) * 1.5;
        } else if (time < RIFLE_SEQUENCE.return) {
          drawTarget.copy(aimGripLocal);
          const recoil = sequence.firing
            ? Math.max(
                0,
                Math.sin(((time - RIFLE_SEQUENCE.fire) * Math.PI * 2) / 0.14),
              ) * 0.16
            : 0;
          drawTarget.z -= recoil;
        } else if (time < RIFLE_SEQUENCE.holstered) {
          drawTarget
            .copy(aimGripLocal)
            .lerp(gunMountPosition, sequence.returning);
          drawTarget.y += Math.sin(sequence.returning * Math.PI) * 1.1;
          drawTarget.z += Math.sin(sequence.returning * Math.PI) * 1.5;
        }
        if (time >= RIFLE_SEQUENCE.sheath && time < RIFLE_SEQUENCE.holstered) {
          animator.reach(
            gunSide,
            root.localToWorld(drawTarget.clone()),
            gunPole,
          );
        }
        if (gunHeld) {
          attachWeapon(gun, gunBone, gunOffset, gunGrip);
          const raise =
            time < RIFLE_SEQUENCE.ready
              ? sequence.shoulderToAim
              : time >= RIFLE_SEQUENCE.return
                ? 1 - sequence.returning
                : 1;
          orientWeapon(
            gun,
            gunBone,
            gunMountRotation.clone().slerp(gunGrip, raise),
            gunOffset,
            gunGrip,
          );
          supportRifle(cinematicProgress(raise, 0.4, 1));
        }
        if (
          time >= RIFLE_SEQUENCE.holstered &&
          time < RIFLE_SEQUENCE.swordDraw
        ) {
          stowTarget
            .copy(gunMountPosition)
            .lerp(
              sheathPosition,
              cinematicProgress(
                time,
                RIFLE_SEQUENCE.holstered,
                RIFLE_SEQUENCE.swordDraw,
              ),
            );
          animator.reach(
            "right",
            root.localToWorld(stowTarget.clone()),
            gunPole,
          );
        } else if (time >= RIFLE_SEQUENCE.swordDraw) {
          stowTarget
            .copy(sheathPosition)
            .lerp(rifleEntry.grip, sequence.swordReturn);
          stowTarget.y += Math.sin(sequence.swordReturn * Math.PI) * 2;
          driveBlade(
            stowTarget,
            blendBladeDirection(
              up.clone().applyQuaternion(sheathRotation),
              rifleEntry.direction,
              sequence.swordReturn,
            ),
          );
          blade.scale.y =
            leftEdge.scale.y =
            rightEdge.scale.y =
              Math.max(0.02, sequence.swordReturn);
        }
        root.updateMatrixWorld(true);
      } else if (
        showWeapons &&
        !clip &&
        (isMeleeStrike(move) || move === "overdrive")
      ) {
        const trajectory =
          move === "overdrive"
            ? sampleUltimateBlade(time)
            : sampleMeleeBlade(move, time);
        driveBlade(
          new THREE.Vector3(...trajectory.grip),
          new THREE.Vector3(...trajectory.direction),
          !shielded &&
            (move === "slash" || move === "cleave" || move === "overdrive"),
        );
      } else if (custom && (move === "evade" || move === "boost")) {
        driveBlade(
          new THREE.Vector3(-3.6, 9.2, 2.4),
          new THREE.Vector3(-0.22, -0.35, -0.91).normalize(),
        );
      } else if (move === "skyCharge" || move === "reactor") {
        const rise = cinematicProgress(
          time / Math.max(duration, 0.01),
          0,
          0.55,
        );
        driveBlade(
          new THREE.Vector3(-1.8 + rise, 11.6 + rise * 3.5, 3.5 - rise * 0.5),
          new THREE.Vector3(-0.04, 1, 0.08).normalize(),
          true,
        );
      } else if (move === "bomb") {
        const raise = cinematicProgress(
          time,
          PLANET_RUPTURE.raise,
          PLANET_RUPTURE.release - 0.35,
        );
        const slam = cinematicProgress(
          time,
          PLANET_RUPTURE.slam,
          PLANET_RUPTURE.escape,
        );
        for (const hand of ["left", "right"] as const) {
          const sign = hand === "left" ? 1 : -1;
          const target = new THREE.Vector3(
            sign * (2.7 + slam * 0.3),
            9 + raise * 8 - slam * 7.4,
            1 + slam * 5,
          );
          animator.reach(
            hand,
            root.localToWorld(target),
            root.localToWorld(new THREE.Vector3(sign * 6, 13, 2)),
          );
        }
        if (chestBone)
          attachWeapon(sword, chestBone, swordHolster, swordHolsterGrip);
      } else if (move === "verdict") {
        driveBlade(
          new THREE.Vector3(-2, 10.5, 3.6),
          new THREE.Vector3(0, 0.015, 1),
        );
      } else if (showWeapons && move === "afterCut") {
        driveBlade(
          new THREE.Vector3(-3, 8.6, 1.8),
          new THREE.Vector3(-0.1, -0.9, 0.35),
        );
      } else if (showWeapons && move === "guard") {
        driveBlade(
          new THREE.Vector3(-2.7, 8.2, 0.7),
          new THREE.Vector3(-0.12, 0.92, -0.35),
        );
      } else if (showWeapons && !clip) {
        weaponDirection.set(-0.12, 0.86, 0.58);
        if (move === "evade" || move === "boost")
          weaponDirection.set(-0.15, 0.18, -1);
        pointSwordAt(
          root.localToWorld(
            sword.position
              .clone()
              .addScaledVector(weaponDirection.normalize(), 20),
          ),
          0.85,
        );
      }
      if (shielded || move === "guard") {
        animator.reach(
          "left",
          root.localToWorld(new THREE.Vector3(3.4, 10.6, 5.4)),
          root.localToWorld(new THREE.Vector3(5.5, 10, 1)),
        );
        for (const [bone, rest] of openHand) bone.quaternion.copy(rest);
        const head = animator.slots.head,
          headRest = head ? socketRest.get(head) : undefined;
        if (head?.parent && headRest) {
          root.updateMatrixWorld(true);
          root.getWorldQuaternion(rootRotation);
          head.parent.getWorldQuaternion(parentWorld);
          head.quaternion.copy(
            parentWorld.invert().multiply(rootRotation).multiply(headRest),
          );
        }
      }
      skin.update(root, effectTime, build, damage, dissolve);
      root.updateMatrixWorld(true);
    },
    applyCrouch(weight: number) {
      if (!animator || !normalized || weight <= 0) return;
      const amount = clamp(weight, 0, 1);
      animator.crouch(amount);
      normalized.position.y -= MECH_HEIGHT * 0.15 * amount;
      root.updateMatrixWorld(true);
      if (swordBone) attachWeapon(sword, swordBone, swordOffset, swordGrip);
      if (chestBone) {
        attachWeapon(scabbard, chestBone, swordHolster, swordHolsterGrip);
        if (!gunHeld) attachWeapon(gun, chestBone, gunHolster, gunHolsterGrip);
      }
    },
    watch(target: THREE.Vector3, weight: number) {
      const head = animator?.slots.head;
      if (!head?.parent || weight <= 0) return;
      const localHead = root.worldToLocal(
        head.getWorldPosition(new THREE.Vector3()),
      );
      const look = root.worldToLocal(target.clone()).sub(localHead);
      const yaw = clamp(Math.atan2(look.x, look.z), -0.65, 0.65) * weight;
      const pitch =
        -clamp(Math.atan2(look.y, Math.hypot(look.x, look.z)), -0.3, 0.3) *
        weight;
      root.getWorldQuaternion(rootRotation);
      aimRotation.setFromEuler(new THREE.Euler(pitch, yaw, 0));
      aimRotation
        .premultiply(rootRotation)
        .multiply(rootRotation.clone().invert());
      head.getWorldQuaternion(handWorld).premultiply(aimRotation);
      head.parent.getWorldQuaternion(parentWorld);
      head.quaternion.copy(parentWorld.invert().multiply(handWorld));
      root.updateMatrixWorld(true);
    },
    aimGun(target: THREE.Vector3) {
      if (
        !gunHeld ||
        !gunBone ||
        !animator ||
        rifleTime < RIFLE_SEQUENCE.ready ||
        rifleTime >= RIFLE_SEQUENCE.return
      )
        return;
      aimHand(gun, gunBone, new THREE.Vector3(0, 0, 1), target);
      attachWeapon(gun, gunBone, gunOffset, gunGrip);
      supportRifle();
    },
    getMuzzle(out = new THREE.Vector3()) {
      return gun.localToWorld(out.copy(muzzleLocal));
    },
    getChest(out = new THREE.Vector3()) {
      if (!chestBone) return root.localToWorld(out.set(0, 11.5, 0.7));
      chestBone.getWorldPosition(out);
      return out.add(
        new THREE.Vector3(0, 0, 0.7)
          .applyQuaternion(root.quaternion)
          .multiplyScalar(root.scale.x),
      );
    },
    getGem(out = new THREE.Vector3()) {
      if (!gemSocket) throw new Error(`${root.name} has no chest gem socket`);
      return gemSocket.getWorldPosition(out);
    },
    getHand(side: "left" | "right", out = new THREE.Vector3()) {
      const bone = animator?.slots[side === "left" ? "leftHand" : "rightHand"];
      return bone
        ? bone.getWorldPosition(out)
        : root.localToWorld(out.set(side === "left" ? 2 : -2, 10, 0));
    },
    getFace(out = new THREE.Vector3()) {
      return (
        animator?.slots.head?.getWorldPosition(out) ??
        root.localToWorld(out.set(0, 15, 0))
      );
    },
    getShoulder(side: "left" | "right", out = new THREE.Vector3()) {
      const bone =
        animator?.slots[side === "left" ? "leftShoulder" : "rightShoulder"];
      return bone
        ? bone.getWorldPosition(out)
        : root.localToWorld(out.set(side === "left" ? 2.5 : -2.5, 12.5, 0));
    },
    getShieldCenter(out = new THREE.Vector3()) {
      const head = animator?.slots.head,
        left = animator?.slots.leftFoot,
        right = animator?.slots.rightFoot;
      if (!head || !left || !right)
        return root.localToWorld(out.set(0, MECH_HEIGHT / 2, 0));
      head.getWorldPosition(out);
      left.getWorldPosition(shieldCenter);
      const footY = Math.min(
        shieldCenter.y,
        right.getWorldPosition(shieldCenter).y,
      );
      out.y = (out.y + footY) / 2;
      out.x = root.position.x;
      out.z = root.position.z;
      return out;
    },
    getBlade(outA = bladeA, outB = bladeB) {
      sword.updateWorldMatrix(true, false);
      outA.set(0, 0.9, 0).applyMatrix4(sword.matrixWorld);
      outB.set(0, 12.7, 0).applyMatrix4(sword.matrixWorld);
      return { base: outA, tip: outB };
    },
    sampleAttackPaths(): DuelBladePaths {
      if (!animator || !model)
        throw new Error("Load the mech rig before sampling its blade paths");
      const cached = reusableRig ? bladePathCache.get(side) : undefined;
      if (cached) return cached;
      const paths: Record<MeleeStrike, BladeSegment[]> = {
        slash: [],
        sideSlash: [],
        cleave: [],
        thrust: [],
        reap: [],
        orbitalCut: [],
        regularCombo: [],
        heavyCombo: [],
      };
      const position = root.position.clone(),
        rotation = root.quaternion.clone(),
        scale = root.scale.clone();
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.scale.setScalar(1);
      sampling = true;
      for (const move of Object.keys(paths) as MeleeStrike[]) {
        previousMove = "";
        for (let frame = 0; frame <= 64; frame++) {
          const time = (frame / 64) * MELEE_STRIKES[move].duration;
          mech.pose(move, time, MELEE_STRIKES[move].duration, false, 0, time);
          const blade = mech.getBlade();
          const point = (p: THREE.Vector3): CinematicPoint => [p.x, p.y, p.z];
          paths[move].push({ base: point(blade.base), tip: point(blade.tip) });
        }
      }
      sampling = false;
      previousMove = "";
      previousPose.clear();
      root.position.copy(position);
      root.quaternion.copy(rotation);
      root.scale.copy(scale);
      mech.pose("idle", 0, 1, false, 0, 0);
      if (reusableRig) bladePathCache.set(side, paths);
      return paths;
    },
    samplePhysicalPaths(): DuelPhysicalPaths {
      if (!animator || !model)
        throw new Error("Load the rig before sampling unarmed contacts");
      if (reusableRig && side === "hero" && physicalPathCache)
        return physicalPathCache;
      const paths: Record<PhysicalStrike, BladeSegment[]> = {
        jab: [],
        cross: [],
        hook: [],
        slide: [],
      };
      const position = root.position.clone(),
        rotation = root.quaternion.clone(),
        scale = root.scale.clone(),
        equipment = showWeapons;
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.scale.setScalar(1);
      sampling = true;
      showWeapons = false;
      try {
        for (const move of Object.keys(paths) as PhysicalStrike[]) {
          previousMove = "";
          for (let frame = 0; frame <= 64; frame++) {
            const time = (frame / 64) * PHYSICAL_STRIKES[move].duration;
            mech.pose(
              move,
              time,
              PHYSICAL_STRIKES[move].duration,
              false,
              0,
              time,
            );
            const left =
              animator.slots[move === "slide" ? "leftFoot" : "leftHand"];
            const right =
              animator.slots[move === "slide" ? "rightFoot" : "rightHand"];
            if (!left || !right)
              throw new Error(
                `The rig requires two ${move === "slide" ? "feet" : "hands"} for ${move}`,
              );
            const a = root.worldToLocal(
              left.getWorldPosition(new THREE.Vector3()),
            );
            const b = root.worldToLocal(
              right.getWorldPosition(new THREE.Vector3()),
            );
            const isLeft = a.z >= b.z;
            const joint =
              animator.slots[
                move === "slide"
                  ? isLeft
                    ? "leftKnee"
                    : "rightKnee"
                  : isLeft
                    ? "leftElbow"
                    : "rightElbow"
              ];
            if (!joint)
              throw new Error(
                `The rig contact chain is incomplete for ${move}`,
              );
            const base = root.worldToLocal(
                joint.getWorldPosition(new THREE.Vector3()),
              ),
              tip = isLeft ? a : b;
            paths[move].push({
              base: [base.x, base.y, base.z],
              tip: [tip.x, tip.y, tip.z],
            });
          }
        }
      } finally {
        sampling = false;
        showWeapons = equipment;
        previousMove = "";
        previousPose.clear();
        root.position.copy(position);
        root.quaternion.copy(rotation);
        root.scale.copy(scale);
        mech.pose("idle", 0, 1, false, 0, 0);
      }
      if (reusableRig && side === "hero") physicalPathCache = paths;
      return paths;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      animator?.dispose();
      if (nativeMixer && model) {
        nativeMixer.stopAllAction();
        nativeMixer.uncacheRoot(model);
      }
      resources?.dispose();
      gunResources?.dispose();
      root.removeFromParent();
      skin.dispose();
      generated.forEach((geometry) => geometry.dispose());
      swordMetal.dispose();
      bladeMaterial.dispose();
      cyan.dispose();
      orange.dispose();
    },
  };
  return mech;
}
