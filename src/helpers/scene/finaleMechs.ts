import * as THREE from 'three';
import { loadMCModel, loadSubjectModel, loadToolModel } from '../../core/loader.js';
import { createMechAnimator, type MechBoneMap, type MechPoseName } from '../../scripts/mechAnimation.js';
import type { MechSide } from '../../scripts/mechDuel.js';
import { captureFinaleResources, normalizeFinaleActor } from './finaleActors.js';
import { createIndustrialSkin, FRAME_COLORS, MECH_HEIGHT } from './finaleMaterials.js';
import { RIFLE_SEQUENCE, sampleRifleSequence } from '../../scripts/finaleChoreography.js';
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
    color: side === 'hero' ? 0xc1ced3 : 0x786784,
    metalness: 0.96, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12,
  });
  const bladeMaterial = new THREE.MeshPhysicalMaterial({
    color: side === 'hero' ? 0xc1ced3 : 0x987db2,
    metalness: 0.98, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1,
    emissive: FRAME_COLORS[side], emissiveIntensity: 0.16,
  });
  const cyan = new THREE.MeshBasicMaterial({ color: side === 'hero' ? 0x5ce6ff : FRAME_COLORS.enemy, toneMapped: false });
  const orange = new THREE.MeshBasicMaterial({ color: side === 'hero' ? 0xd98535 : 0xffbb45, toneMapped: false });
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
  let activeAnimator: 'native' | 'procedural' | null = null, activeClip = '';
  let previousMove = '', blendStart = 0, gunHeld = false, gunEnabled = true, rifleTime = 0;
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
  const gunHolster = new THREE.Vector3(1.7, -2.4, -1.6);
  const gunHolsterGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -0.16));
  const swordHolster = new THREE.Vector3(-1.4, -1.5, -1.3);
  const swordHolsterGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.14));
  const drawGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.1));
  const weaponLocal = new THREE.Vector3(), drawTarget = new THREE.Vector3(), stowTarget = new THREE.Vector3();
  const aimGripLocal = new THREE.Vector3(2.2, 11.5, 2.3);
  const drawLocal = new THREE.Vector3(2.5, 13.7, -0.7);
  const stowLocal = new THREE.Vector3(-2.5, 13.3, -0.9);

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
    gunBone = asset.sockets?.gun ? model.getObjectByName(asset.sockets.gun) ?? null : animator.slots.leftHand ?? null;
    chestBone = asset.sockets?.chest ? model.getObjectByName(asset.sockets.chest) ?? null : animator.slots.spineUpper ?? null;
    if (!gunBone || !chestBone) throw new Error(`${root.name} needs gun and chest sockets or semantic left-hand and upper-spine bones`);
    for (const bone of [swordBone, gunBone, chestBone]) socketRest.set(bone, relativeRotation(bone));
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
    foregripLocal.set(0, -0.02 * rifleScale, -bounds.min.x * rifleScale * 0.5);
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
  function nativeClip(move: MechPoseName, airborne: boolean, combo: number, custom: boolean, poseTime: number) {
    const find = (...names: string[]) => names.map(name => clips.get(name.toLowerCase())).find((clip): clip is THREE.AnimationClip => !!clip);
    if (custom) return undefined;
    if (airborne && (move === 'idle' || move === 'walk' || move === 'dash')) return find('Sword_Idle', 'Idle_Loop');
    if (move === 'idle' || move === 'guard') return find('Sword_Idle', 'Idle_Loop');
    if (move === 'walk') return find('Walk_Loop');
    if (move === 'slash') return combo % 2 === 0 ? find('Sword_Attack') : undefined;
    if (move === 'cleave' || move === 'overdrive') return find('Sword_Attack');
    if (move === 'missiles') return sampleRifleSequence(poseTime).firing
      ? find('Pistol_Shoot', 'Pistol_Idle_Loop') : find('Pistol_Idle_Loop', 'Idle_Loop');
    if (move === 'transform') return find('Idle_Loop');
    if (move === 'defeat') return find('Death01', 'Death_01', 'Death');
    if (move === 'victory') return find('Dance_Loop');
    if (move === 'stagger') return find('Hit_Chest', 'Hit', 'Idle_Loop');
    return undefined;
  }

  return { root, sword, gun, loaded, pointSwordAt,
    setAssembly(value: number) { build = clamp(value, 0, 1); },
    setDamage(value: number) { damage = clamp(value, 0, 1); },
    setDissolve(value: number) { dissolve = clamp(value, 0, 1); },
    setGunEnabled(value: boolean) { gunEnabled = value; },
    lockBlade(contact: THREE.Vector3, side: 1 | -1) {
      if (!animator || !swordBone) return;
      const grip = root.localToWorld(new THREE.Vector3(-1.5, 9.4, 3.2));
      animator.reach('right', grip, root.localToWorld(new THREE.Vector3(-5, 9, 3)));
      attachWeapon(sword, swordBone, swordOffset, swordGrip);
      pointSwordAt(contact);
      pointSwordAt(contact);
      const support = sword.localToWorld(new THREE.Vector3(0, -0.5, 0));
      animator.reach('left', support, root.localToWorld(new THREE.Vector3(5, 9, side * 0.4)));
      root.updateMatrixWorld(true);
    },
    pose(move: MechPoseName, time: number, duration = 1, airborne = false, combo = 0, effectTime = time, custom = false) {
      if (!animator || !nativeMixer || !normalized || !model) return;
      normalized.position.y = baseY;
      const clip = nativeClip(move, airborne, combo, custom, time);
      const looping = move === 'idle' || move === 'walk' || move === 'victory'
        || (airborne && move === 'dash');
      const moveKey = clip ? `native-${clip.name}` : `${move}-${combo}`;
      if (previousMove && previousMove !== moveKey) {
        previousPose.clear();
        for (const bone of Object.values(animator.slots)) if (bone) {
          previousPose.set(bone, { rotation: bone.quaternion.clone(), position: bone.position.clone() });
        }
        blendStart = effectTime;
      }
      previousMove = moveKey;
      if (clip) {
        if (activeAnimator !== 'native' || activeClip !== clip.name) {
          animator.stop();
          nativeMixer.stopAllAction();
          nativeAction = nativeMixer.clipAction(clip);
          nativeAction.reset().setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
          nativeAction.clampWhenFinished = true;
          nativeAction.play();
          nativeAction.paused = true;
          activeAnimator = 'native';
          activeClip = clip.name;
        }
        if (!nativeAction) return;
        nativeAction.time = looping
          ? Math.max(0, effectTime) % clip.duration
          : move === 'missiles' && clip.name === 'Pistol_Shoot'
            ? ((Math.max(0, time - RIFLE_SEQUENCE.fire) % 0.14) / 0.14) * clip.duration
          : clamp(time / Math.max(0.01, duration), 0, 1) * clip.duration;
        nativeAction.paused = true;
        nativeMixer.update(0);
      } else {
        if (activeAnimator !== 'procedural') { nativeMixer.stopAllAction(); animator.stop(); }
        const baseClip = clips.get('idle_loop');
        if (baseClip) {
          const baseAction = nativeMixer.clipAction(baseClip);
          baseAction.play(); baseAction.paused = true; baseAction.time = Math.max(0, effectTime) % baseClip.duration;
          nativeMixer.update(0);
        }
        animator.pose(move, looping ? effectTime : time, duration, airborne, combo);
        activeAnimator = 'procedural';
        activeClip = '';
      }
      const blend = THREE.MathUtils.smootherstep(effectTime - blendStart, 0, 0.13);
      if (blend < 1) for (const [bone, previous] of previousPose) {
        bone.quaternion.slerpQuaternions(previous.rotation, bone.quaternion.clone(), blend);
        bone.position.lerpVectors(previous.position, bone.position.clone(), blend);
      }
      root.updateMatrixWorld(true);
      if (!airborne && animator.slots.leftFoot && animator.slots.rightFoot) {
        const left = root.worldToLocal(animator.slots.leftFoot.getWorldPosition(new THREE.Vector3())).y;
        const right = root.worldToLocal(animator.slots.rightFoot.getWorldPosition(new THREE.Vector3())).y;
        normalized.position.y -= Math.min(left, right) - restFootY;
        root.updateMatrixWorld(true);
      }
      rifleTime = move === 'missiles' ? time : 0;
      gunHeld = move === 'missiles' && time >= RIFLE_SEQUENCE.draw && time < RIFLE_SEQUENCE.holstered;
      if (swordBone && chestBone) {
        const swordStowed = move === 'missiles' && time >= RIFLE_SEQUENCE.ready && time < RIFLE_SEQUENCE.holstered;
        attachWeapon(sword, swordStowed ? chestBone : swordBone, swordStowed ? swordHolster : swordOffset, swordStowed ? swordHolsterGrip : swordGrip);
      }
      if (gunBone && chestBone) {
        attachWeapon(gun, gunHeld ? gunBone : chestBone, gunHeld ? gunOffset : gunHolster, gunHeld ? gunGrip : gunHolsterGrip);
      }
      sword.visible = build > 0.65 && move !== 'defeat';
      gun.visible = gunEnabled && build > 0.95 && move !== 'defeat';
      if (move === 'missiles' && gunBone && swordBone && chestBone) {
        const sequence = sampleRifleSequence(time);
        attachWeapon(gun, chestBone, gunHolster, gunHolsterGrip);
        const grip = gun.getWorldPosition(new THREE.Vector3());
        gunBone.getWorldPosition(drawTarget);
        if (time < RIFLE_SEQUENCE.draw) {
          drawTarget.lerp(grip, sequence.draw);
        } else if (time < RIFLE_SEQUENCE.ready) {
          drawTarget.copy(root.localToWorld(drawLocal.clone())).lerp(root.localToWorld(aimGripLocal.clone()), sequence.shoulderToAim);
        } else if (time < RIFLE_SEQUENCE.return) {
          drawTarget.copy(root.localToWorld(aimGripLocal.clone()));
          const recoil = sequence.firing ? Math.max(0, Math.sin((time - RIFLE_SEQUENCE.fire) * Math.PI * 2 / 0.14)) * 0.16 : 0;
          drawTarget.add(new THREE.Vector3(0, 0, -recoil).applyQuaternion(root.quaternion));
        } else if (time < RIFLE_SEQUENCE.holstered) {
          drawTarget.copy(root.localToWorld(aimGripLocal.clone())).lerp(root.localToWorld(drawLocal.clone()), Math.min(1, sequence.returning * 2));
          if (sequence.returning > 0.5) drawTarget.lerp(grip, (sequence.returning - 0.5) * 2);
        }
        animator.reach('left', drawTarget, root.localToWorld(new THREE.Vector3(6, 12, -2)));
        if (gunHeld) {
          attachWeapon(gun, gunBone, gunOffset, gunGrip);
          const facing = root.localToWorld(weaponLocal.set(0, 0, 1)).sub(root.getWorldPosition(worldPosition)).normalize();
          const raise = time < RIFLE_SEQUENCE.ready ? sequence.shoulderToAim : time >= RIFLE_SEQUENCE.return ? 1 - sequence.returning : 1;
          desiredDirection.set(0, 1, 0).lerp(facing, raise).normalize();
          gun.getWorldPosition(weaponOrigin);
          aimHand(gun, gunBone, new THREE.Vector3(0, 0, 1), weaponOrigin.clone().addScaledVector(desiredDirection, 30));
          attachWeapon(gun, gunBone, gunOffset, gunGrip);
        }
        if (time < RIFLE_SEQUENCE.ready) {
          swordBone.getWorldPosition(stowTarget);
          stowTarget.lerp(root.localToWorld(stowLocal.clone()), sequence.draw);
          if (time >= RIFLE_SEQUENCE.draw) {
            attachWeapon(sword, chestBone, swordHolster, swordHolsterGrip);
            stowTarget.lerp(sword.getWorldPosition(new THREE.Vector3()), sequence.shoulderToAim);
          }
          animator.reach('right', stowTarget, root.localToWorld(new THREE.Vector3(-6, 12, -2)));
          attachWeapon(sword, swordBone, swordOffset, swordGrip);
          sword.quaternion.slerp(drawGrip, sequence.draw);
        } else if (time >= RIFLE_SEQUENCE.return) {
          attachWeapon(sword, chestBone, swordHolster, swordHolsterGrip);
          const grip = sword.getWorldPosition(new THREE.Vector3());
          swordBone.getWorldPosition(stowTarget);
          if (time < RIFLE_SEQUENCE.holstered) {
            stowTarget.lerp(root.localToWorld(stowLocal.clone()), sequence.returning).lerp(grip, sequence.returning);
          } else stowTarget.copy(grip).lerp(root.localToWorld(new THREE.Vector3(-3.4, 8, 1)), sequence.swordReturn);
          animator.reach('right', stowTarget, root.localToWorld(new THREE.Vector3(-6, 12, -2)));
          if (time >= RIFLE_SEQUENCE.holstered) {
            attachWeapon(sword, swordBone, swordOffset, swordGrip);
            sword.quaternion.copy(drawGrip).slerp(swordGrip, sequence.swordReturn);
          }
        }
        root.updateMatrixWorld(true);
      } else if (!clip) {
        const p = clamp(time / Math.max(0.01, duration), 0, 1);
        weaponDirection.set(-0.12, 0.86, 0.58);
        if (move === 'slash' || move === 'cleave' || move === 'overdrive') {
          const heavy = move !== 'slash', wind = THREE.MathUtils.smootherstep(p, 0, heavy ? 0.36 : 0.27);
          const strike = THREE.MathUtils.smootherstep(p, heavy ? 0.39 : 0.29, move === 'overdrive' ? 0.75 : heavy ? 0.64 : 0.52);
          const recovery = 1 - THREE.MathUtils.smootherstep(p, 0.76, 1);
          weaponDirection.set((combo === 1 ? -1 : 1) * (-0.55 * wind + 1.2 * strike) * recovery,
            0.86 + wind * 0.45 - strike * (heavy ? 1.7 : 0.65) * recovery,
            0.58 - wind * 0.95 + strike * 1.35 * recovery);
        } else if (move === 'reactor') weaponDirection.set(0.1, 1, 0.15);
        else if (move === 'evade' || move === 'boost') weaponDirection.set(-0.15, 0.18, -1);
        pointSwordAt(root.localToWorld(sword.position.clone().addScaledVector(weaponDirection.normalize(), 20)));
      }
      skin.update(root, effectTime, build, damage, dissolve);
      root.updateMatrixWorld(true);
    },
    aimGun(target: THREE.Vector3) {
      if (!gunHeld || !gunBone || !animator || rifleTime < RIFLE_SEQUENCE.ready || rifleTime >= RIFLE_SEQUENCE.return) return;
      aimHand(gun, gunBone, new THREE.Vector3(0, 0, 1), target);
      attachWeapon(gun, gunBone, gunOffset, gunGrip);
      const support = gun.localToWorld(foregripLocal.clone());
      animator.reach('right', support, root.localToWorld(new THREE.Vector3(-4, 7, 1)));
      root.updateMatrixWorld(true);
    },
    getMuzzle(out = new THREE.Vector3()) { return gun.localToWorld(out.copy(muzzleLocal)); },
    getChest(out = new THREE.Vector3()) {
      if (!chestBone) return root.localToWorld(out.set(0, 11.5, 0.7));
      chestBone.getWorldPosition(out);
      return out.add(new THREE.Vector3(0, 0, 0.7).applyQuaternion(root.quaternion).multiplyScalar(root.scale.x));
    },
    getHand(side: 'left' | 'right', out = new THREE.Vector3()) {
      const bone = side === 'left' ? gunBone : swordBone;
      return bone ? bone.getWorldPosition(out) : root.localToWorld(out.set(side === 'left' ? 2 : -2, 10, 0));
    },
    getBlade(outA = bladeA, outB = bladeB) {
      sword.updateWorldMatrix(true, false);
      outA.set(0, 0.9, 0).applyMatrix4(sword.matrixWorld);
      outB.set(0, 12.7, 0).applyMatrix4(sword.matrixWorld);
      return { base: outA, tip: outB };
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
}
