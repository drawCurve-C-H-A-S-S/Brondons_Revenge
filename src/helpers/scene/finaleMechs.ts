import * as THREE from 'three';
import { loadMCModel, loadSubjectModel, loadToolModel } from '../../core/loader.js';
import { createMechAnimator, type MechBoneMap, type MechPoseName } from '../../scripts/mechAnimation.js';
import type { MechSide, DuelBladePaths, BladeSegment } from '../../scripts/mechDuel.js';
import { captureFinaleResources, normalizeFinaleActor } from './finaleActors.js';
import { createIndustrialSkin, FRAME_COLORS, MECH_HEIGHT } from './finaleMaterials.js';
import {
  RIFLE_SEQUENCE, PLANET_RUPTURE, MELEE_STRIKES, isMeleeStrike, sampleMeleeBlade, sampleUltimateBlade,
  sampleRifleSequence, cinematicProgress, ENEMY_ATTACK_LEAPS, sampleEnemyAttackLeap,
  type MeleeStrike, type CinematicPoint,
} from '../../scripts/finaleChoreography.js';
import { fitWeaponToHand } from '../../scripts/items/createLightsaber.js';

export interface MechAsset {
  scene: THREE.Object3D;
  animations?: THREE.AnimationClip[];
  bones?: MechBoneMap;
  armored?: boolean;
  ownership?: 'owned' | 'shared';
  sockets?: Partial<Record<'sword' | 'gun' | 'chest', string>>;
}
export type MechFactory = () => Promise<MechAsset>;
export const DEFAULT_MECH_FACTORIES: Record<MechSide, MechFactory> = {
  hero: async () => ({ ...(await loadMCModel()), ownership: 'owned' }),
  enemy: async () => ({ ...(await loadSubjectModel()), ownership: 'owned' }),
};

const clamp = THREE.MathUtils.clamp;

export function createFinaleMech(side: MechSide, factory: MechFactory = DEFAULT_MECH_FACTORIES[side]) {
  const root = new THREE.Group();
  root.name = side === 'hero' ? 'PrimeFrame' : 'FinalVerdict';
  const skin = createIndustrialSkin(side);
  const swordMetal = new THREE.MeshPhysicalMaterial({
    color: side === 'hero' ? 0xc1ced3 : 0x555158,
    metalness: 0.96, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12,
  });
  const bladeMaterial = new THREE.MeshPhysicalMaterial({
    color: side === 'hero' ? 0xc1ced3 : 0x716a70,
    metalness: 0.98, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1,
    emissive: FRAME_COLORS[side], emissiveIntensity: 0.16,
  });
  const cyan = new THREE.MeshBasicMaterial({ color: FRAME_COLORS[side], toneMapped: false });
  const orange = new THREE.MeshBasicMaterial({ color: side === 'hero' ? 0xb88750 : 0x6e202c, toneMapped: false });
  const generated: THREE.BufferGeometry[] = [];
  let model: THREE.Object3D | null = null, normalized: THREE.Group | null = null;
  let animator: ReturnType<typeof createMechAnimator> | null = null;
  let swordBone: THREE.Object3D | null = null, gunBone: THREE.Object3D | null = null, chestBone: THREE.Object3D | null = null;
  const swordGripSocket = new THREE.Object3D();
  const swordFingerGrip: Array<{ bone: THREE.Object3D; rotation: THREE.Quaternion }> = [];
  let nativeMixer: THREE.AnimationMixer | null = null, nativeAction: THREE.AnimationAction | null = null;
  let resources: ReturnType<typeof captureFinaleResources> | null = null;
  let gunResources: ReturnType<typeof captureFinaleResources> | null = null, disposed = false;
  let build = 1, damage = 0, dissolve = 0, baseY = 0, restFootY = 0;
  let previousMove = '', blendStart = 0, gunHeld = false, gunEnabled = side === 'hero', rifleTime = 0;
  let sampling = false;
  const previousPose = new Map<THREE.Object3D, { rotation: THREE.Quaternion; position: THREE.Vector3 }>();
  const clips = new Map<string, THREE.AnimationClip>();
  const socketRest = new Map<THREE.Object3D, THREE.Quaternion>();
  const worldPosition = new THREE.Vector3(), rootRotation = new THREE.Quaternion(), boneRotation = new THREE.Quaternion();
  const deltaRotation = new THREE.Quaternion(), bladeA = new THREE.Vector3(), bladeB = new THREE.Vector3();
  const gun = new THREE.Group(); gun.name = `${root.name}_Rifle`; root.add(gun);
  const muzzleLocal = new THREE.Vector3(), foregripLocal = new THREE.Vector3();
  const weaponDirection = new THREE.Vector3(), desiredDirection = new THREE.Vector3(), weaponOrigin = new THREE.Vector3();
  const handWorld = new THREE.Quaternion(), parentWorld = new THREE.Quaternion(), aimRotation = new THREE.Quaternion();
  const swordOffset = new THREE.Vector3(0, -0.25, 0.2), swordGrip = new THREE.Quaternion();
  const gunOffset = new THREE.Vector3(0, -0.1, 0.2), gunGrip = new THREE.Quaternion();
  const gunHolster = new THREE.Vector3(-1.7, -2.1, -1.6);
  const gunHolsterGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -0.16));
  const swordHolster = new THREE.Vector3(1.6, 1.15, -1.45);
  const swordHolsterGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI - 0.18));
  const weaponLocal = new THREE.Vector3(), drawTarget = new THREE.Vector3(), stowTarget = new THREE.Vector3();
  const aimGripLocal = new THREE.Vector3(-1.3, 11.3, 2.4);
  const rifleEntry = { grip: new THREE.Vector3(), direction: new THREE.Vector3() };
  const gunMountPosition = new THREE.Vector3(), gunMountRotation = new THREE.Quaternion();
  const sheathPosition = new THREE.Vector3(), sheathRotation = new THREE.Quaternion();
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
    depth: 0.2, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.07, bevelThickness: 0.06,
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
  generated.push(edgeGeometry, hiltGeometry, emitterGeometry, guardGeometry, pommelGeometry);
  const leftEdge = new THREE.Mesh(edgeGeometry, side === 'hero' ? orange : cyan);
  const rightEdge = new THREE.Mesh(edgeGeometry, cyan);
  leftEdge.position.set(-0.31, 5.8, 0.14);
  rightEdge.position.set(0.31, 5.8, 0.14);
  const hilt = new THREE.Mesh(hiltGeometry, swordMetal);
  hilt.position.y = -0.38;
  const emitter = new THREE.Mesh(emitterGeometry, side === 'hero' ? orange : cyan);
  emitter.position.y = 0.7;
  const guard = new THREE.Mesh(guardGeometry, swordMetal);
  guard.rotation.x = Math.PI / 2;
  guard.position.y = 0.92;
  const pommel = new THREE.Mesh(pommelGeometry, side === 'hero' ? cyan : orange);
  pommel.position.y = -1.38;
  sword.add(leftEdge, rightEdge, hilt, emitter, guard, pommel);
  sword.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = true; });
  const scabbard = new THREE.Group(); scabbard.name = `${root.name}_BladeSheath`; root.add(scabbard);
  const sheathGeometry = new THREE.BoxGeometry(0.86, 11.8, 0.44);
  generated.push(sheathGeometry);
  const sheath = new THREE.Mesh(sheathGeometry, skin.material);
  sheath.customDepthMaterial = skin.depth;
  sheath.position.y = 6.2; sheath.castShadow = sheath.receiveShadow = true; scabbard.add(sheath);

  function relativeRotation(bone: THREE.Object3D) {
    return root.getWorldQuaternion(rootRotation).invert().multiply(bone.getWorldQuaternion(boneRotation)).clone();
  }
  const loaded = Promise.all([factory(), loadToolModel('Gun_Rifle')]).then(([asset, rifle]) => {
    resources = captureFinaleResources(asset.scene, asset.ownership === 'shared');
    gunResources = captureFinaleResources(rifle.scene);
    if (disposed) { resources.dispose(); gunResources.dispose(); return; }
    model = asset.scene;
    normalized = normalizeFinaleActor(model, MECH_HEIGHT);
    baseY = normalized.position.y;
    root.add(normalized);
    model.traverse(node => {
      if (node instanceof THREE.Mesh) { node.material = skin.material; node.customDepthMaterial = skin.depth; }
    });
    animator = createMechAnimator(model, asset.bones);
    nativeMixer = new THREE.AnimationMixer(model);
    for (const clip of asset.animations ?? []) clips.set(clip.name.toLowerCase(), clip);
    root.updateMatrixWorld(true);
    swordBone = asset.sockets?.sword ? model.getObjectByName(asset.sockets.sword) ?? null : animator.slots.rightHand ?? null;
    if (!swordBone) throw new Error(`${root.name} needs a sword socket or a semantic right-hand bone`);
    gunBone = asset.sockets?.gun ? model.getObjectByName(asset.sockets.gun) ?? null : animator.slots.rightHand ?? null;
    chestBone = asset.sockets?.chest ? model.getObjectByName(asset.sockets.chest) ?? null : animator.slots.spineUpper ?? null;
    if (!gunBone || !chestBone) throw new Error(`${root.name} needs gun and chest sockets or semantic hand and upper-spine bones`);
    for (const bone of [swordBone, gunBone, chestBone, animator.slots.leftHand, animator.slots.rightHand]) {
      if (bone) socketRest.set(bone, relativeRotation(bone));
    }
    const swordIdle = clips.get('sword_idle');
    if (swordIdle) {
      const sample = nativeMixer.clipAction(swordIdle).play(); sample.paused = true; nativeMixer.update(0);
    }
    swordGripSocket.name = `${root.name}_SwordGripSocket`;
    fitWeaponToHand(swordGripSocket, swordBone, 0);
    swordBone.traverse(bone => {
      if (/^(thumb|index|middle|ring|pinky)_0[1-3]_r$/.test(bone.name)) {
        swordFingerGrip.push({ bone, rotation: bone.quaternion.clone() });
      }
    });
    nativeMixer.stopAllAction(); animator.stop(); root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(rifle.scene), length = bounds.getSize(new THREE.Vector3()).x;
    if (!Number.isFinite(length) || length <= 0) throw new Error('The finale rifle has invalid geometry bounds');
    const rifleScale = 8.4 / length;
    rifle.scene.scale.multiplyScalar(rifleScale);
    rifle.scene.rotation.y = Math.PI / 2;
    rifle.scene.position.y = -0.08 * rifleScale;
    rifle.scene.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.material = skin.material; node.customDepthMaterial = skin.depth;
        node.castShadow = node.receiveShadow = true;
      }
    });
    gun.add(rifle.scene);
    muzzleLocal.set(0, 0.05 * rifleScale, -bounds.min.x * rifleScale);
    foregripLocal.set(0, -0.07 * rifleScale, -bounds.min.x * rifleScale * 0.48);
    const feet = [animator.slots.leftFoot, animator.slots.rightFoot].filter((node): node is THREE.Object3D => !!node);
    restFootY = feet.length
      ? Math.min(...feet.map(foot => root.worldToLocal(foot.getWorldPosition(new THREE.Vector3())).y))
      : 0;
  });

  function attachWeapon(weapon: THREE.Object3D, bone: THREE.Object3D, offset: THREE.Vector3, grip: THREE.Quaternion) {
    if (weapon === sword && bone === swordBone) {
      for (const finger of swordFingerGrip) finger.bone.quaternion.copy(finger.rotation);
      swordGripSocket.getWorldPosition(worldPosition);
      sword.position.copy(root.worldToLocal(worldPosition));
      sword.quaternion.copy(relativeRotation(swordGripSocket));
      sword.position.add(new THREE.Vector3(0, 0.38, 0).applyQuaternion(sword.quaternion));
      sword.updateWorldMatrix(true, false);
      return;
    }
    bone.getWorldPosition(worldPosition);
    weapon.position.copy(root.worldToLocal(worldPosition));
    deltaRotation.copy(relativeRotation(bone)).multiply(socketRest.get(bone)!.clone().invert());
    weapon.position.add(worldPosition.copy(offset).applyQuaternion(deltaRotation));
    weapon.quaternion.copy(deltaRotation).multiply(grip);
    weapon.updateWorldMatrix(true, false);
  }
  function aimHand(weapon: THREE.Object3D, bone: THREE.Object3D, axis: THREE.Vector3, target: THREE.Vector3) {
    weapon.getWorldPosition(weaponOrigin);
    desiredDirection.copy(target).sub(weaponOrigin);
    if (desiredDirection.lengthSq() < 0.001) return;
    weaponDirection.copy(axis).applyQuaternion(weapon.getWorldQuaternion(handWorld)).normalize();
    aimRotation.setFromUnitVectors(weaponDirection, desiredDirection.normalize());
    bone.getWorldQuaternion(handWorld).premultiply(aimRotation);
    if (!bone.parent) throw new Error(`${bone.name} needs a parent for its weapon socket`);
    bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(handWorld));
    root.updateMatrixWorld(true);
  }
  function pointSwordAt(target: THREE.Vector3) {
    if (!swordBone || gunHeld) return;
    aimHand(sword, swordBone, new THREE.Vector3(0, 1, 0), target);
    attachWeapon(sword, swordBone, swordOffset, swordGrip);
  }
  function driveBlade(grip: THREE.Vector3, direction: THREE.Vector3, support = false) {
    if (!animator || !swordBone) return;
    const target = root.localToWorld(grip.clone());
    const look = root.localToWorld(grip.clone().addScaledVector(direction, 20));
    for (let pass = 0; pass < 4; pass++) {
      attachWeapon(sword, swordBone, swordOffset, swordGrip);
      const palm = swordBone.getWorldPosition(new THREE.Vector3());
      const correction = sword.getWorldPosition(new THREE.Vector3()).sub(palm);
      animator.reach('right', target.clone().sub(correction), root.localToWorld(new THREE.Vector3(-6, 11, 2)));
      attachWeapon(sword, swordBone, swordOffset, swordGrip);
      pointSwordAt(look);
    }
    if (support) {
      animator.reach('left', sword.localToWorld(new THREE.Vector3(0, -0.65, 0)),
        root.localToWorld(new THREE.Vector3(5, 11, 2)));
    }
    attachWeapon(sword, swordBone, swordOffset, swordGrip);
    root.updateMatrixWorld(true);
  }
  function orientWeapon(weapon: THREE.Object3D, bone: THREE.Object3D, rotation: THREE.Quaternion, offset: THREE.Vector3, grip: THREE.Quaternion) {
    root.getWorldQuaternion(rootRotation);
    aimRotation.copy(rootRotation).multiply(rotation).multiply(weapon.getWorldQuaternion(handWorld).invert());
    bone.getWorldQuaternion(handWorld).premultiply(aimRotation);
    if (!bone.parent) throw new Error(`${bone.name} needs a parent for weapon orientation`);
    bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(handWorld));
    root.updateMatrixWorld(true);
    attachWeapon(weapon, bone, offset, grip);
  }
  function supportRifle(weight = 1) {
    if (!animator || !gunBone || weight <= 0) return;
    const side = gunBone === animator.slots.leftHand ? 'right' : 'left';
    const hand = animator.slots[side === 'left' ? 'leftHand' : 'rightHand'];
    if (!hand) throw new Error('A two-handed rifle needs its support-hand bone');
    const target = hand.getWorldPosition(new THREE.Vector3()).lerp(gun.localToWorld(foregripLocal.clone()), weight);
    animator.reach(side, target, root.localToWorld(new THREE.Vector3(side === 'left' ? 4.5 : -4.5, 8.5, 3)));
    root.updateMatrixWorld(true);
  }
  function nativeClip(move: MechPoseName, airborne: boolean, poseTime: number, jumping: boolean) {
    const find = (...names: string[]) => names.map(name => clips.get(name.toLowerCase())).find((clip): clip is THREE.AnimationClip => !!clip);
    if (jumping) return find('Jump_Loop');
    if (airborne && (move === 'idle' || move === 'walk' || move === 'dash')) return find('Sword_Idle', 'Idle_Loop');
    if (move === 'idle') return find('Sword_Idle', 'Idle_Loop');
    if (move === 'walk') return find('Walk_Loop');
    if (move === 'slash' || move === 'sideSlash' || move === 'cleave' || move === 'reap' || move === 'overdrive') return find('Sword_Attack');
    if (move === 'thrust') return find('Punch_Jab');
    if (move === 'guard' || move === 'clash') return find('Push_Loop', 'Sword_Idle');
    if (move === 'missiles') return sampleRifleSequence(poseTime).firing ? find('Pistol_Shoot') : find('Pistol_Idle_Loop');
    if (move === 'skyCharge' || move === 'reactor' || move === 'verdict' || move === 'bomb') return find('Spell_Simple_Idle_Loop');
    if (move === 'boost' || move === 'evade' || move === 'dash') return find('Jump_Loop');
    if (move === 'afterCut') return find('Sword_Idle');
    if (move === 'transform') return find('Idle_Loop');
    if (move === 'defeat') return find('Death01', 'Death_01', 'Death');
    if (move === 'victory') return find('Sword_Idle', 'Idle_Loop');
    if (move === 'dance') return find('Dance_Loop');
    if (move === 'stagger') return find('Hit_Chest', 'Hit', 'Idle_Loop');
    return undefined;
  }

  const mech = { root, sword, gun, loaded, pointSwordAt,
    setAssembly(value: number) { build = clamp(value, 0, 1); },
    setDamage(value: number) { damage = clamp(value, 0, 1); },
    setDissolve(value: number) { dissolve = clamp(value, 0, 1); },
    setGunEnabled(value: boolean) { gunEnabled = value; },
    setBladeCharge(value: number) { bladeMaterial.emissiveIntensity = 0.16 + clamp(value, 0, 1) * 3.8; },
    markSlash(from: THREE.Vector3, to: THREE.Vector3) {
      skin.engrave(root.worldToLocal(from.clone()), root.worldToLocal(to.clone()));
    },
    lockBlade(contact: THREE.Vector3, side: 1 | -1, strain = 0) {
      if (!animator || !swordBone) return;
      const grip = new THREE.Vector3(-2.2, 8.6 + strain * 0.22, 1.5);
      const direction = root.worldToLocal(contact.clone()).sub(grip).normalize();
      driveBlade(grip, direction);
      for (let i = 0; i < 4; i++) pointSwordAt(contact);
      const support = sword.localToWorld(new THREE.Vector3(0, -0.5, 0));
      animator.reach('left', support, root.localToWorld(new THREE.Vector3(5, 9, side * 0.4)));
      root.updateMatrixWorld(true);
    },
    pose(move: MechPoseName, time: number, duration = 1, airborne = false, combo = 0, effectTime = time, custom = false) {
      if (!animator || !nativeMixer || !normalized || !model) return;
      const jump = side === 'enemy' && !custom && (move === 'thrust' || move === 'verdict') && time < ENEMY_ATTACK_LEAPS[move].land
        ? sampleEnemyAttackLeap(move, time) : null;
      const clip = nativeClip(move, airborne, time, !!jump);
      const looping = !jump && (move === 'idle' || move === 'walk' || move === 'victory' || move === 'dance' || move === 'afterCut'
        || move === 'guard' || move === 'clash' || move === 'skyCharge' || move === 'reactor'
        || move === 'verdict' || move === 'bomb' || (move === 'missiles' && !sampleRifleSequence(time).firing));
      const moveKey = `${move}-${clip?.name ?? 'procedural'}-${combo}`;
      if (previousMove && previousMove !== moveKey) {
        previousPose.clear();
        for (const bone of Object.values(animator.slots)) if (bone) {
          previousPose.set(bone, { rotation: bone.quaternion.clone(), position: bone.position.clone() });
        }
        blendStart = effectTime;
      }
      if (move === 'missiles' && !previousMove.startsWith('missiles-')) {
        rifleEntry.grip.copy(sword.position);
        rifleEntry.direction.copy(up).applyQuaternion(sword.quaternion);
      }
      previousMove = moveKey;
      normalized.position.y = baseY;
      nativeMixer.stopAllAction();
      animator.stop();
      if (clip) {
        nativeAction = nativeMixer.clipAction(clip).reset();
        nativeAction.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
        nativeAction.clampWhenFinished = true;
        nativeAction.play();
        nativeAction.time = jump ? jump.progress * clip.duration : looping
          ? Math.max(0, effectTime) % clip.duration
          : move === 'missiles' && clip.name === 'Pistol_Shoot'
            ? ((Math.max(0, time - RIFLE_SEQUENCE.fire) % 0.14) / 0.14) * clip.duration
          : clamp(time / Math.max(0.01, duration), 0, 1) * clip.duration;
        nativeAction.paused = true;
        nativeMixer.update(0);
      } else {
        animator.pose(move, looping ? effectTime : time, duration, airborne, combo);
      }
      const blend = sampling ? 1 : THREE.MathUtils.smootherstep(effectTime - blendStart, 0, custom ? 0.2 : 0.13);
      if (blend < 1) for (const [bone, previous] of previousPose) {
        bone.quaternion.slerpQuaternions(previous.rotation, bone.quaternion.clone(), blend);
        bone.position.lerpVectors(previous.position, bone.position.clone(), blend);
      }
      if (!sampling) animator.perform(move, effectTime, custom ? 1 : 0.45);
      root.updateMatrixWorld(true);
      if (!airborne && animator.slots.leftFoot && animator.slots.rightFoot) {
        const left = root.worldToLocal(animator.slots.leftFoot.getWorldPosition(new THREE.Vector3())).y;
        const right = root.worldToLocal(animator.slots.rightFoot.getWorldPosition(new THREE.Vector3())).y;
        normalized.position.y -= Math.min(left, right) - restFootY;
        root.updateMatrixWorld(true);
      }
      rifleTime = move === 'missiles' ? time : 0;
      gunHeld = move === 'missiles' && time >= RIFLE_SEQUENCE.draw && time < RIFLE_SEQUENCE.holstered;
      const swordStowed = move === 'bomb' || move === 'dance' || (move === 'missiles'
        && time >= RIFLE_SEQUENCE.sheath && time < RIFLE_SEQUENCE.swordDraw);
      if (swordBone && chestBone) {
        attachWeapon(sword, swordStowed ? chestBone : swordBone, swordStowed ? swordHolster : swordOffset, swordStowed ? swordHolsterGrip : swordGrip);
        attachWeapon(scabbard, chestBone, swordHolster, swordHolsterGrip);
      }
      if (gunBone && chestBone) {
        attachWeapon(gun, gunHeld ? gunBone : chestBone, gunHeld ? gunOffset : gunHolster, gunHeld ? gunGrip : gunHolsterGrip);
      }
      sword.visible = build > 0.65 && move !== 'defeat' && dissolve < 0.9;
      scabbard.visible = build > 0.65 && move !== 'defeat' && dissolve < 0.99;
      blade.visible = leftEdge.visible = rightEdge.visible = !swordStowed;
      blade.scale.y = leftEdge.scale.y = rightEdge.scale.y = 1;
      gun.visible = gunEnabled && build > 0.95 && move !== 'defeat' && dissolve < 0.99;
      if (move === 'missiles' && gunBone && swordBone && chestBone) {
        const sequence = sampleRifleSequence(time);
        attachWeapon(gun, chestBone, gunHolster, gunHolsterGrip);
        gunMountPosition.copy(gun.position); gunMountRotation.copy(gun.quaternion);
        const gunSide = gunBone === animator.slots.leftHand ? 'left' : 'right';
        const sign = gunSide === 'right' ? -1 : 1;
        aimGripLocal.x = sign * 1.3;
        gunHolster.x = sign * 1.7;
        const gunPole = root.localToWorld(new THREE.Vector3(sign * 6, 11, -0.5));
        attachWeapon(scabbard, chestBone, swordHolster, swordHolsterGrip);
        sheathPosition.copy(scabbard.position); sheathRotation.copy(scabbard.quaternion);
        if (time < RIFLE_SEQUENCE.sheath) {
          stowTarget.copy(rifleEntry.grip).lerp(sheathPosition, sequence.sheath);
          stowTarget.y += Math.sin(sequence.sheath * Math.PI) * 2;
          const direction = rifleEntry.direction.clone().lerp(up.clone().applyQuaternion(sheathRotation), sequence.sheath).normalize();
          driveBlade(stowTarget, direction);
          const retract = 1 - cinematicProgress(time, RIFLE_SEQUENCE.sheath * 0.45, RIFLE_SEQUENCE.sheath);
          blade.scale.y = leftEdge.scale.y = rightEdge.scale.y = Math.max(0.02, retract);
        } else if (time < RIFLE_SEQUENCE.draw) {
          drawTarget.copy(sheathPosition).lerp(gunMountPosition, sequence.draw);
          drawTarget.y += Math.sin(sequence.draw * Math.PI) * 1.4;
        } else if (time < RIFLE_SEQUENCE.ready) {
          const p = sequence.shoulderToAim;
          drawTarget.copy(gunMountPosition).lerp(aimGripLocal, p);
          drawTarget.y += Math.sin(p * Math.PI) * 4.2;
        } else if (time < RIFLE_SEQUENCE.return) {
          drawTarget.copy(aimGripLocal);
          const recoil = sequence.firing ? Math.max(0, Math.sin((time - RIFLE_SEQUENCE.fire) * Math.PI * 2 / 0.14)) * 0.16 : 0;
          drawTarget.z -= recoil;
        } else if (time < RIFLE_SEQUENCE.holstered) {
          drawTarget.copy(aimGripLocal).lerp(gunMountPosition, sequence.returning);
          drawTarget.y += Math.sin(sequence.returning * Math.PI) * 4.2;
        }
        if (time >= RIFLE_SEQUENCE.sheath && time < RIFLE_SEQUENCE.holstered) {
          animator.reach(gunSide, root.localToWorld(drawTarget.clone()), gunPole);
        }
        if (gunHeld) {
          attachWeapon(gun, gunBone, gunOffset, gunGrip);
          const raise = time < RIFLE_SEQUENCE.ready ? sequence.shoulderToAim : time >= RIFLE_SEQUENCE.return ? 1 - sequence.returning : 1;
          orientWeapon(gun, gunBone, gunMountRotation.clone().slerp(gunGrip, raise), gunOffset, gunGrip);
          supportRifle(cinematicProgress(raise, 0.4, 1));
        }
        if (time >= RIFLE_SEQUENCE.holstered && time < RIFLE_SEQUENCE.swordDraw) {
          stowTarget.copy(gunMountPosition).lerp(sheathPosition, cinematicProgress(time, RIFLE_SEQUENCE.holstered, RIFLE_SEQUENCE.swordDraw));
          animator.reach('right', root.localToWorld(stowTarget.clone()), gunPole);
        } else if (time >= RIFLE_SEQUENCE.swordDraw) {
          stowTarget.copy(sheathPosition).lerp(rifleEntry.grip, sequence.swordReturn);
          stowTarget.y += Math.sin(sequence.swordReturn * Math.PI) * 2;
          driveBlade(stowTarget, up.clone().applyQuaternion(sheathRotation).lerp(rifleEntry.direction, sequence.swordReturn).normalize());
          blade.scale.y = leftEdge.scale.y = rightEdge.scale.y = Math.max(0.02, sequence.swordReturn);
        }
        root.updateMatrixWorld(true);
      } else if ((isMeleeStrike(move) && move !== 'sideSlash') || move === 'overdrive') {
        const trajectory = move === 'overdrive' ? sampleUltimateBlade(time) : sampleMeleeBlade(move, time);
        driveBlade(new THREE.Vector3(...trajectory.grip), new THREE.Vector3(...trajectory.direction),
          move === 'slash' || move === 'cleave' || move === 'overdrive');
      } else if (move === 'skyCharge' || move === 'reactor') {
        const rise = cinematicProgress(time / Math.max(duration, 0.01), 0, 0.55);
        driveBlade(new THREE.Vector3(-0.6, 10 + rise * 4.5, 1.7), new THREE.Vector3(0, 1, 0.015), true);
      } else if (move === 'bomb') {
        const raise = cinematicProgress(time, PLANET_RUPTURE.raise, PLANET_RUPTURE.release - 0.35);
        const slam = cinematicProgress(time, PLANET_RUPTURE.slam, PLANET_RUPTURE.escape);
        for (const hand of ['left', 'right'] as const) {
          const sign = hand === 'left' ? 1 : -1;
          const target = new THREE.Vector3(sign * (2.7 + slam * 0.3), 9 + raise * 8 - slam * 7.4, 1 + slam * 5);
          animator.reach(hand, root.localToWorld(target), root.localToWorld(new THREE.Vector3(sign * 6, 13, 2)));
        }
        if (chestBone) attachWeapon(sword, chestBone, swordHolster, swordHolsterGrip);
      } else if (move === 'verdict') {
        driveBlade(new THREE.Vector3(-2, 10.5, 3.6), new THREE.Vector3(0, 0.015, 1));
      } else if (move === 'afterCut') {
        driveBlade(new THREE.Vector3(-3, 8.6, 1.8), new THREE.Vector3(-0.1, -0.9, 0.35));
      } else if (move === 'guard') {
        driveBlade(new THREE.Vector3(-2, 9.5, 2.4), new THREE.Vector3(-0.2, 0.92, 0.3));
        animator.reach('left', root.localToWorld(new THREE.Vector3(1.3, 10.3, 4)),
          root.localToWorld(new THREE.Vector3(5, 8, 3)));
      } else if (!clip) {
        weaponDirection.set(-0.12, 0.86, 0.58);
        if (move === 'evade' || move === 'boost') weaponDirection.set(-0.15, 0.18, -1);
        pointSwordAt(root.localToWorld(sword.position.clone().addScaledVector(weaponDirection.normalize(), 20)));
      }
      skin.update(root, effectTime, build, damage, dissolve);
      root.updateMatrixWorld(true);
    },
    watch(target: THREE.Vector3, weight: number) {
      const head = animator?.slots.head;
      if (!head?.parent || weight <= 0) return;
      const localHead = root.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
      const look = root.worldToLocal(target.clone()).sub(localHead);
      const yaw = clamp(Math.atan2(look.x, look.z), -0.65, 0.65) * weight;
      const pitch = -clamp(Math.atan2(look.y, Math.hypot(look.x, look.z)), -0.3, 0.3) * weight;
      root.getWorldQuaternion(rootRotation);
      aimRotation.setFromEuler(new THREE.Euler(pitch, yaw, 0));
      aimRotation.premultiply(rootRotation).multiply(rootRotation.clone().invert());
      head.getWorldQuaternion(handWorld).premultiply(aimRotation);
      head.parent.getWorldQuaternion(parentWorld);
      head.quaternion.copy(parentWorld.invert().multiply(handWorld));
      root.updateMatrixWorld(true);
    },
    aimGun(target: THREE.Vector3) {
      if (!gunHeld || !gunBone || !animator || rifleTime < RIFLE_SEQUENCE.ready || rifleTime >= RIFLE_SEQUENCE.return) return;
      aimHand(gun, gunBone, new THREE.Vector3(0, 0, 1), target);
      attachWeapon(gun, gunBone, gunOffset, gunGrip);
      supportRifle();
    },
    getMuzzle(out = new THREE.Vector3()) { return gun.localToWorld(out.copy(muzzleLocal)); },
    getChest(out = new THREE.Vector3()) {
      if (!chestBone) return root.localToWorld(out.set(0, 11.5, 0.7));
      chestBone.getWorldPosition(out);
      return out.add(new THREE.Vector3(0, 0, 0.7).applyQuaternion(root.quaternion).multiplyScalar(root.scale.x));
    },
    getHand(side: 'left' | 'right', out = new THREE.Vector3()) {
      const bone = animator?.slots[side === 'left' ? 'leftHand' : 'rightHand'];
      return bone ? bone.getWorldPosition(out) : root.localToWorld(out.set(side === 'left' ? 2 : -2, 10, 0));
    },
    getBlade(outA = bladeA, outB = bladeB) {
      sword.updateWorldMatrix(true, false);
      outA.set(0, 0.9, 0).applyMatrix4(sword.matrixWorld);
      outB.set(0, 12.7, 0).applyMatrix4(sword.matrixWorld);
      return { base: outA, tip: outB };
    },
    sampleAttackPaths(): DuelBladePaths {
      if (!animator || !model) throw new Error('Load the mech rig before sampling its blade paths');
      const paths: Record<MeleeStrike, BladeSegment[]> = { slash: [], sideSlash: [], cleave: [], thrust: [], reap: [] };
      const position = root.position.clone(), rotation = root.quaternion.clone(), scale = root.scale.clone();
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1);
      sampling = true;
      for (const move of Object.keys(paths) as MeleeStrike[]) {
        previousMove = '';
        for (let frame = 0; frame <= 64; frame++) {
          const time = frame / 64 * MELEE_STRIKES[move].duration;
          mech.pose(move, time, MELEE_STRIKES[move].duration, false, 0, time);
          const blade = mech.getBlade();
          const point = (p: THREE.Vector3): CinematicPoint => [p.x, p.y, p.z];
          paths[move].push({ base: point(blade.base), tip: point(blade.tip) });
        }
      }
      sampling = false; previousMove = ''; previousPose.clear();
      root.position.copy(position); root.quaternion.copy(rotation); root.scale.copy(scale);
      mech.pose('idle', 0, 1, false, 0, 0);
      return paths;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      animator?.dispose();
      if (nativeMixer && model) { nativeMixer.stopAllAction(); nativeMixer.uncacheRoot(model); }
      resources?.dispose();
      gunResources?.dispose();
      root.removeFromParent();
      skin.dispose();
      generated.forEach(geometry => geometry.dispose());
      swordMetal.dispose(); bladeMaterial.dispose(); cyan.dispose(); orange.dispose();
    },
  };
  return mech;
}
