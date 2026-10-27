import * as THREE from "three";
import type { FinalePhase } from "../global/finaleDirector.js";
import type { MechSide } from "../npc/mechDuel.js";
import {
  FINALE_BATTLE_YAW,
  FINALE_DECK_Y,
  FINALE_ROOFTOP,
  PLANET_CENTER,
} from "./finaleWorld.js";
import {
  FINALE_REVEAL,
  HERO_TRANSFORM,
  PLANET_RUPTURE,
  RIFLE_SEQUENCE,
  FINISHER_EXECUTION,
  FINISHER_EXCHANGE,
  FINISHER_RIFLE,
  activeStudent,
  cinematicProgress,
  samplePlanetSurface,
  ENEMY_ATTACK_LEAPS,
  type FinisherBeat,
} from "../global/finaleChoreography.js";
import {
  FACILITY,
  FACILITY_CUT_Y,
  FACILITY_ROOF_SEQUENCE,
  sampleFacilityLift,
} from "../global/facilityArchitecture.js";
import { FACILITY_OFFICE, FACILITY_OFFICE_SEATS } from "./facilityOffice.js";

export interface FinaleCameraContext {
  phase: FinalePhase;
  phaseTime: number;
  time: number;
  space: boolean;
  hero: THREE.Object3D;
  enemy: THREE.Object3D;
  human: THREE.Vector3;
  students: readonly THREE.Object3D[];
  boy: THREE.Vector3;
  boyGround?: THREE.Vector3;
  boyPOV?: { cameraPosition: THREE.Vector3; target: THREE.Vector3 };
  pilotFace: THREE.Vector3;
  pilotCamera: THREE.Vector3;
  ship: THREE.Object3D;
  remembrance?: { position: THREE.Vector3; target: THREE.Vector3 };
  bomb: THREE.Vector3;
  heroChest: THREE.Vector3;
  enemyChest: THREE.Vector3;
  heroFace: THREE.Vector3;
  enemyFace: THREE.Vector3;
  heroShoulder: THREE.Vector3;
  enemyShoulder?: THREE.Vector3;
  heroMuzzle: THREE.Vector3;
  enemyMuzzle: THREE.Vector3;
  clash: THREE.Vector3;
  heroBladeBase: THREE.Vector3;
  heroBladeTip: THREE.Vector3;
  enemyBladeTip: THREE.Vector3;
  facilityInterior?: { cameraPosition: THREE.Vector3; target: THREE.Vector3 };
  special: {
    owner: MechSide;
    kind: "missiles" | "overdrive" | "verdict" | "orbitalCut";
    time: number;
    duration: number;
  } | null;
  finisher: { beat: FinisherBeat; clock: number };
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smootherstep;
export function createFinaleCamera(
  camera: THREE.PerspectiveCamera,
  reducedMotion: boolean,
) {
  const position = camera.position.clone(),
    target = new THREE.Vector3(),
    rotation = camera.quaternion.clone();
  const desired = new THREE.PerspectiveCamera(),
    lastPosition = position.clone(),
    lastRotation = rotation.clone();
  const stageRight = V(Math.sin(FINALE_BATTLE_YAW), 0, Math.cos(FINALE_BATTLE_YAW));
  const stageFront = new THREE.Vector3().crossVectors(stageRight, V(0, 1, 0));
  const previousTarget = new THREE.Vector3(), lastTarget = new THREE.Vector3();
  const stablePosition = position.clone();
  const shakeRotation = new THREE.Quaternion();
  const shakeAngles = new THREE.Euler();
  let shakeAge = 0;
  const clearanceLine = new THREE.Line3();
  const clearancePoint = new THREE.Vector3();
  const clearanceOffset = new THREE.Vector3();
  let frameRoll = 0;
  let shotId = "",
    transition = 1,
    shake = 0,
    fov = camera.fov,
    lastFov = camera.fov;
  function duelView(context: FinaleCameraContext) {
    const center = context.hero.position
      .clone()
      .lerp(context.enemy.position, 0.5)
      .add(V(0, 8, 0));
    const gap =
      Math.abs(context.enemy.position.x - context.hero.position.x) + 16;
    const height =
      34 + Math.abs(context.enemy.position.y - context.hero.position.y);
    const angle = THREE.MathUtils.degToRad(54 / 2);
    const horizontalDistance =
      gap / (Math.max(0.5, camera.aspect) * 2 * Math.tan(angle));
    const verticalDistance = height / (2 * Math.tan(angle));
    const distance = Math.max(36, horizontalDistance, verticalDistance) * 1.04;
    return {
      center,
      position: center
        .clone()
        .add(V(distance * 0.16, distance * 0.28, distance)),
    };
  }
  function frame(p: THREE.Vector3, look: THREE.Vector3, lens = 51, roll = 0) {
    position.copy(p);
    target.copy(look);
    fov = lens;
    frameRoll = roll;
    desired.position.copy(position);
    desired.up.set(0, 1, 0);
    desired.lookAt(target);
    if (!reducedMotion) desired.rotateZ(roll);
    rotation.copy(desired.quaternion);
  }
  function stageFrame(
    focus: THREE.Vector3,
    across: number,
    height: number,
    distance: number,
    lens = 44,
    roll = 0,
  ) {
    // Keep every reverse angle on the same side of the established duel axis.
    const portrait = Math.max(1, 1.35 / Math.max(0.5, camera.aspect));
    frame(
      focus.clone()
        .addScaledVector(stageRight, across)
        .addScaledVector(stageFront, distance * portrait)
        .add(V(0, height, 0)),
      focus,
      lens,
      roll,
    );
  }
  function poseFrame(
    context: FinaleCameraContext,
    across: number,
    height: number,
    distance: number,
    lens = 46,
  ) {
    const focus = context.hero.position.clone().lerp(context.enemy.position, 0.5).add(V(0, 9, 0));
    const back = stageFront.clone().multiplyScalar(distance)
      .addScaledVector(stageRight, across).add(V(0, height, 0)).normalize();
    const right = new THREE.Vector3().crossVectors(V(0, 1, 0), back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    const tanY = Math.tan(THREE.MathUtils.degToRad(lens / 2));
    const tanX = tanY * Math.max(0.5, camera.aspect);
    let clearance = Math.hypot(across, height, distance);
    for (const point of [
      context.hero.position, context.enemy.position,
      context.heroFace, context.enemyFace,
      context.heroBladeBase, context.heroBladeTip, context.enemyBladeTip,
    ]) {
      const offset = point.clone().sub(focus);
      const depth = offset.dot(back);
      clearance = Math.max(clearance,
        depth + (Math.abs(offset.dot(right)) + 3) / tanX,
        depth + (Math.abs(offset.dot(up)) + 2.5) / tanY);
    }
    frame(focus.clone().addScaledVector(back, clearance), focus, lens);
  }
  function armView(context: FinaleCameraContext, owner: MechSide, slide = 0) {
    const actor = owner === "hero" ? context.hero : context.enemy;
    const chest = owner === "hero" ? context.heroChest : context.enemyChest;
    const opponent = owner === "hero" ? context.enemyChest : context.heroChest;
    const shoulder = owner === "hero"
      ? context.heroShoulder
      : context.enemyShoulder ?? actor.localToWorld(V(-2.5, 12.5, 0));
    const forward = V(0, 0, 1).applyQuaternion(actor.quaternion).normalize();
    const side = new THREE.Vector3().crossVectors(forward, V(0, 1, 0)).normalize();
    if (side.dot(stageFront) < 0) side.negate();
    return {
      position: shoulder.clone()
        .addScaledVector(forward, -9.5)
        .addScaledVector(side, 6.2 + slide * 0.8)
        .add(V(0, 1.8, 0)),
      target: opponent.clone().lerp(chest, 0.15),
    };
  }
  function clearFinisherCamera(context: FinaleCameraContext) {
    const nearMargin = camera.near * Math.tan(THREE.MathUtils.degToRad(fov / 2)) *
      Math.hypot(1, camera.aspect) + 0.7;
    const clearSegment = (a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
      clearanceLine.set(a, b).closestPointToPoint(position, true, clearancePoint);
      clearanceOffset.copy(position).sub(clearancePoint);
      const distance = clearanceOffset.length();
      if (distance >= radius + nearMargin) return;
      if (distance < 0.001) clearanceOffset.copy(stageFront);
      else clearanceOffset.multiplyScalar(1 / distance);
      position.copy(clearancePoint).addScaledVector(clearanceOffset, radius + nearMargin);
    };
    // Conservative body and blade capsules protect the lens without mesh raycasts.
    for (let pass = 0; pass < 2; pass++) {
      for (const [actor, face] of [
        [context.hero, context.heroFace],
        [context.enemy, context.enemyFace],
      ] as const) {
        if (!actor.visible) continue;
        clearSegment(actor.localToWorld(V(0, 3.5, 0)), face, 3.8 * actor.scale.x);
      }
      if (context.hero.visible)
        clearSegment(context.heroBladeBase, context.heroBladeTip, 0.85);
      if (context.enemy.visible)
        clearSegment(context.enemyChest, context.enemyBladeTip, 0.85);
    }
    frame(position, target, fov, frameRoll);
  }
  return {
    impact(strength: number) {
      shake = Math.max(shake, reducedMotion ? 0 : strength);
      shakeAge = 0;
    },
    update(context: FinaleCameraContext, dt: number) {
      const { phase, phaseTime: t, hero, enemy, human } = context;
      const local = (x: number, y: number, z: number) =>
        V(
          FINALE_ROOFTOP.x + x,
          (phase === "loading" || phase === "error" || phase === "reveal"
            ? FACILITY.officeFloor
            : FINALE_DECK_Y) + y,
          FINALE_ROOFTOP.z + z,
        );
      const combat = duelView(context);
      let id = phase as string;
      if (phase === "loading" || phase === "error")
        frame(local(-5, 2.5, 8.1), local(0, 1.3, FACILITY_OFFICE.tableZ), 56);
      else if (phase === "reveal") {
        if (t < 3.4) {
          id += "-brondon-arrives";
          const p = reducedMotion ? 0.5 : smooth(t, 0, 3.4);
          frame(
            human.clone().add(V(-2.25 + p * 0.35, 1.35, -3.2 + p * 0.25)),
            human.clone().add(V(0, 1.18, 0)),
            46,
          );
        } else if (t < 6.4) {
          id += "-across-table";
          const p = reducedMotion ? 0.5 : smooth(t, 3.4, 6.4);
          frame(
            human.clone().add(V(-1 - p * 0.2, 1.45, 2)),
            local(0, 1.3, FACILITY_OFFICE_SEATS[2].z),
            58,
          );
        } else if (t < FINALE_REVEAL.studentStart) {
          id += "-accusation";
          const p = reducedMotion ? 0.5 : smooth(t, 6.4, FINALE_REVEAL.studentStart);
          frame(
            human.clone().add(V(-1.9 + p * 0.25, 1.25, -2.9)),
            human.clone().add(V(0, 1.2, 0)), 42,
          );
        } else if (t < FINALE_REVEAL.studentEnd) {
          const index = activeStudent(t, "reveal");
          id += `-student-${index}`;
          const actor = context.students[index],
            focus =
              actor?.position.clone().add(V(0, 1.45, 0)) ??
              local(FACILITY_OFFICE_SEATS[index].x, 1.45, FACILITY_OFFICE_SEATS[index].z);
          const drift = reducedMotion ? 0 : Math.sin(t * 0.28) * 0.1;
          frame(
            focus
              .clone()
              .add(V(-1.35 + drift, 0.08, 3.8)),
            focus,
            39,
          );
        } else if (t < FINALE_REVEAL.mentorEnd) {
          id += "-wound";
          frame(
            context.human.clone().add(V(-2.15 + smooth(t, FINALE_REVEAL.studentEnd, FINALE_REVEAL.mentorEnd) * 0.3, 1.45, -3.5)),
            context.human.clone().add(V(0, 1.15, 0)),
            42,
            -0.012,
          );
        } else if (t < FINALE_REVEAL.correctionEnd) {
          const actor = context.students[4],
            focus =
              actor?.position.clone().add(V(0, 1.45, 0)) ??
              local(FACILITY_OFFICE_SEATS[4].x, 1.45, FACILITY_OFFICE_SEATS[4].z);
          id += "-cruel-reply";
          frame(focus.clone().add(V(-1.8, 0.12, 3.5)), focus, 40, 0.01);
        } else if (t < FINALE_REVEAL.brandenEnd) {
          id += "-hurt";
          frame(
            context.human.clone().add(V(-2.1, 1.25, -3.2)),
            context.human.clone().add(V(0, 1.1, 0)),
            44,
            0.008,
          );
        } else if (t < FINALE_REVEAL.mockeryEnd) {
          const actor = context.students[4],
            focus =
              actor?.position.clone().add(V(0, 1.45, 0)) ??
              local(FACILITY_OFFICE_SEATS[4].x, 1.45, FACILITY_OFFICE_SEATS[4].z);
          id += "-mockery";
          frame(focus.clone().add(V(1.8, 0.08, 3.4)), focus, 40, -0.008);
        } else if (t < FINALE_REVEAL.betrayalEnd) {
          id += "-divide";
          const p = reducedMotion ? 0.5 : smooth(t, FINALE_REVEAL.mockeryEnd, FINALE_REVEAL.betrayalEnd);
          frame(
            human.clone().add(V(-1.4 - p * 0.25, 1.6, 2.1)),
            local(0, 1.25, FACILITY_OFFICE_SEATS[2].z), 58, -0.008,
          );
        } else if (t < FINALE_REVEAL.recognitionEnd) {
          id += "-recognition";
          frame(
            context.human.clone().add(V(-2, 1.2, -3)),
            context.human.clone().add(V(0, 1.15, 0)),
            41,
          );
        } else if (t < FINALE_REVEAL.renounceEnd) {
          id += "-resolve";
          frame(
            context.human.clone().add(V(-1.45, 0.9, -2.65)),
            context.human.clone().add(V(0, 1.25, 0)),
            39,
          );
        } else if (t < FINALE_REVEAL.challengeEnd) {
          id += "-crane";
          const p = smooth(
            t,
            FINALE_REVEAL.renounceEnd,
            FINALE_REVEAL.challengeEnd,
          );
          frame(
            local(-6 + p * 2, 3.4 + p * 0.9, 7.8 + p * 0.2),
            local(0, 1.25, FACILITY_OFFICE.tableZ),
            58,
          );
        } else {
          id += "-answer";
          frame(
            context.human.clone().add(V(-1.6, 0.95, -2.9)),
            context.human.clone().add(V(0, 1.3, 0)),
            38,
          );
        }
      } else if (phase === "enemyTransform") {
        if (t < FACILITY_ROOF_SEQUENCE.cutStart) {
          id += "-office-clearing-blast";
          const pull = reducedMotion ? 0 : smooth(t, 0, FACILITY_ROOF_SEQUENCE.cutStart);
          frame(
            V(FACILITY.x - 7.4 - pull * 0.4, FACILITY.officeFloor + 3.1, FACILITY.z + 7.6),
            V(FACILITY.x, FACILITY.officeFloor + 1.1, FACILITY.z + FACILITY_OFFICE.tableZ),
            62,
          );
        } else if (t < FACILITY_ROOF_SEQUENCE.capClear) {
          id += "-roof-circle-cut";
          frame(
            V(FACILITY.x - 12, FACILITY.roofY + 11, FACILITY.z + 21),
            V(FACILITY.x, FACILITY_CUT_Y, FACILITY.z),
            51,
          );
        } else if (t < FACILITY_ROOF_SEQUENCE.liftEnd) {
          id += "-roof-lift-passengers";
          const lift = sampleFacilityLift(t);
          frame(
            V(FACILITY.x + 4, lift.y + 5.4, FACILITY.z + 6),
            V(FACILITY.x, lift.y + 0.9, FACILITY.z + 1.2),
            66,
          );
        } else if (t < FACILITY_ROOF_SEQUENCE.boardingStart) {
          id += "-assembly";
          const p = smooth(t, FACILITY_ROOF_SEQUENCE.liftEnd, FACILITY_ROOF_SEQUENCE.boardingStart);
          frame(
            enemy.position.clone().add(V(-13, 1.4 + p * 11, 18)),
            enemy.position.clone().add(V(0, 3 + p * 8, 0)),
            55,
            -0.025,
          );
        } else if (activeStudent(t, "boarding") >= 0) {
          const index = activeStudent(t, "boarding");
          id += `-core-${index}`;
          const actor = context.students[index];
          const focus = actor.position
            .clone()
            .add(V(0, Math.max(0.12, actor.scale.y), 0));
          const merge = actor.scale.y < 0.75;
          if (merge) focus.lerp(context.enemyChest, 0.6);
          frame(
            focus.clone().add(V(-5.5, 1.1, 8.5)),
            focus.clone().lerp(context.enemyChest, 0.16),
            47,
            -0.012,
          );
        } else {
          id += "-verdict";
          const p = smooth(t, FACILITY_ROOF_SEQUENCE.assembled, FACILITY_ROOF_SEQUENCE.end);
          frame(
            enemy.position.clone().add(V(-17 - p * 3, 3.2 + p * 3.5, 23)),
            enemy.position.clone().add(V(0, 9, 0)),
            56,
            -0.03,
          );
        }
      } else if (phase === "heroTransform") {
        const liftoffEnd = HERO_TRANSFORM.launch + 1.6;
        if (t < HERO_TRANSFORM.launch) {
          id += "-prime";
          frame(
            human.clone().add(V(-2, 1.5, -2.9)),
            human.clone().add(V(0, 1.3, 0)),
            48,
          );
        } else if (t < liftoffEnd) {
          id += "-forest-liftoff";
          const ship = context.ship.position;
          frame(
            ship.clone().add(V(-13, 6, 19)),
            ship.clone().add(V(0, 1, 0)),
            58,
            -0.02,
          );
        } else if (t < HERO_TRANSFORM.arrival) {
          id += "-ship-flyby";
          const p = smooth(t, liftoffEnd, HERO_TRANSFORM.arrival);
          const ship = context.ship.position;
          frame(
            ship.clone().add(V(12 - p * 5, 4 + p * 2, 20)),
            ship.clone().add(V(0, 1, -2)),
            61,
            -0.04 + p * 0.06,
          );
        } else if (t < HERO_TRANSFORM.pilotMerge) {
          id += "-ship-morph";
          const p = smooth(
            t,
            HERO_TRANSFORM.arrival,
            HERO_TRANSFORM.pilotMerge,
          );
          const focus = hero.position.clone().add(V(0, 7 + p * 3, 0));
          frame(
            hero.position.clone().add(V(15 - p * 5, 8, 22)),
            focus,
            60,
            0.025,
          );
        } else if (t < HERO_TRANSFORM.assembled) {
          id += "-light";
          const p = smooth(
            t,
            HERO_TRANSFORM.pilotMerge,
            HERO_TRANSFORM.assembled,
          );
          frame(
            hero.position.clone().add(V(13, 1.5 + p * 11, 16)),
            hero.position.clone().add(V(0, 4 + p * 7, 0)),
            56,
            0.025,
          );
        } else if (t < 14.3) {
          id += "-blade";
          const angle = reducedMotion
            ? 0.65
            : 0.65 + (t - HERO_TRANSFORM.assembled) * 0.4;
          frame(
            hero.position
              .clone()
              .add(
                V(
                  Math.cos(angle) * 23,
                  7 + (t - HERO_TRANSFORM.assembled),
                  Math.sin(angle) * 23,
                ),
              ),
            hero.position.clone().add(V(0, 10, 0)),
            59,
          );
        } else {
          id += "-versus";
          const p = smooth(t, 14.3, 17);
          frame(
            combat.position
              .clone()
              .add(V(-8 * (1 - p), -14 * (1 - p), 8 * (1 - p))),
            combat.center,
            54,
          );
        }
      } else if (phase === "versus") {
        frame(combat.position, combat.center, 51);
      } else if (phase === "rupture") {
        if (
          t >= PLANET_RUPTURE.facilityCut &&
          t < PLANET_RUPTURE.materialize &&
          context.facilityInterior
        ) {
          id += "-facility-core";
          frame(
            context.facilityInterior.cameraPosition,
            context.facilityInterior.target,
            44,
          );
        } else if (t < PLANET_RUPTURE.raise) {
          id += "-verdict-pose";
          frame(
            enemy.position.clone().add(V(-18, 4, 26)),
            context.enemyChest,
            55,
            -0.018,
          );
        } else if (t < PLANET_RUPTURE.release) {
          id += "-summon";
          const p = smooth(t, PLANET_RUPTURE.raise, PLANET_RUPTURE.release);
          frame(
            enemy.position.clone().add(V(-16, 9 + p * 7, 27)),
            context.enemyChest.clone().lerp(context.bomb, p * 0.65),
            56,
          );
        } else if (t < PLANET_RUPTURE.apex) {
          id += "-launch";
          const p = smooth(t, PLANET_RUPTURE.release, PLANET_RUPTURE.apex);
          frame(
            context.bomb.clone().add(V(-24, -10 + p * 15, 45)),
            context.bomb,
            61,
            -0.025,
          );
        } else if (t < PLANET_RUPTURE.escape) {
          id += "-command";
          frame(
            enemy.position.clone().add(V(-14, 12, 20)),
            context.enemyChest.clone().add(V(0, 3, 0)),
            48,
            -0.02,
          );
        } else if (t < PLANET_RUPTURE.wide) {
          id += "-meteor";
          frame(
            context.bomb.clone().add(V(-48, -25, 70)),
            context.bomb.clone().lerp(PLANET_CENTER, 0.1),
            62,
            0.035,
          );
        } else if (t < PLANET_RUPTURE.forest) {
          id += "-planet";
          const p = smooth(t, PLANET_RUPTURE.wide, PLANET_RUPTURE.forest);
          frame(
            PLANET_CENTER.clone().add(
              V(600 + p * 70, 480 + p * 45, 1000 + p * 25),
            ),
            PLANET_CENTER.clone().add(V(0, 95, 0)),
            46,
            -0.012,
          );
        } else if (t < PLANET_RUPTURE.forestEnd) {
          const ground = context.boyGround ?? context.boy.clone().add(V(0, -0.9, 0));
          if (t < PLANET_RUPTURE.reflection) {
            id += "-brendan";
            frame(ground.clone().add(V(-2.5, 1.25, 3.6)),
              ground.clone().lerp(context.boy, 0.55), 46, -0.008);
          } else if (t < PLANET_RUPTURE.feet) {
            id += "-brendan-crouch";
            const push = reducedMotion ? 0 : cinematicProgress(
              t, PLANET_RUPTURE.reflection, PLANET_RUPTURE.feet,
            );
            frame(ground.clone().add(V(-2.15 + push * 0.25, 1.05, 3.2 - push * 0.3)),
              ground.clone().lerp(context.boy, 0.65), 43, -0.008);
          } else if (t < PLANET_RUPTURE.fall) {
            id += "-brendan-feet-pov";
            frame(context.boyPOV?.cameraPosition ?? context.boy.clone().add(V(0, 0.06, 0.3)),
              context.boyPOV?.target ?? ground, 72);
          } else {
            id += "-brendan-backward-fall";
            const pull = reducedMotion ? 0 : cinematicProgress(t, PLANET_RUPTURE.fall, PLANET_RUPTURE.death);
            frame(ground.clone().add(V(-3.3 - pull * 0.4, 1.5 + pull * 0.35, 3.1)),
              ground.clone().lerp(context.boy, 0.45), 49, -0.008);
          }
        } else if (t < PLANET_RUPTURE.cockpit) {
          id += t < PLANET_RUPTURE.burst ? "-burning-earth" : "-stardust";
          const p = cinematicProgress(
            t,
            PLANET_RUPTURE.burning,
            PLANET_RUPTURE.stardustEnd,
          );
          frame(
            PLANET_CENTER.clone().add(
              V(670 + p * 170, 525 + p * 70, 1025 + p * 220),
            ),
            PLANET_CENTER.clone().add(V(0, 40 * (1 - p), 0)),
            46 + p * 3,
            -0.012,
          );
        } else if (t < PLANET_RUPTURE.returnToDuel) {
          id += "-cockpit";
          const resolve = cinematicProgress(
            t,
            PLANET_RUPTURE.resolve,
            PLANET_RUPTURE.returnToDuel,
          );
          frame(context.pilotCamera, context.pilotFace, 43 - resolve * 3);
        } else {
          id += "-orbit";
          const p = cinematicProgress(
            t,
            PLANET_RUPTURE.returnToDuel,
            PLANET_RUPTURE.orbit + 0.4,
          );
          const start = context.pilotCamera.clone();
          const exit = start.clone().sub(context.pilotFace).normalize();
          frame(
            start
              .lerp(combat.position, p)
              .addScaledVector(exit, Math.sin(p * Math.PI) * 6),
            context.pilotFace.clone().lerp(combat.center, p),
            40 + p * 14,
          );
        }
      } else if (phase === "finisher") {
        const { beat, clock } = context.finisher;
        const duration = beat.duration;
        const p = cinematicProgress(clock, 0, duration);
        id += `-${beat.shot}`;
        const center = hero.position
          .clone()
          .lerp(enemy.position, 0.5)
          .add(V(0, 9, 0));
        if (beat.shot === "challenge") {
          const enemySpeaking = clock < duration / 2;
          id += enemySpeaking ? "-ambition" : "-vengeance";
          const actor = enemySpeaking ? enemy : hero;
          const envelope = new THREE.Box3().setFromPoints([
            actor.position.clone().add(V(0, -0.5, 0)),
            enemySpeaking ? context.enemyFace : context.heroFace,
            enemySpeaking ? context.enemyBladeTip : context.heroBladeTip,
            enemySpeaking ? context.enemyChest : context.heroBladeBase,
          ]).expandByScalar(3);
          const focus = envelope.getCenter(new THREE.Vector3());
          const vertical = THREE.MathUtils.degToRad(40 / 2);
          const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.35, camera.aspect));
          const distance = envelope.getSize(new THREE.Vector3()).length() * 0.58 /
            Math.sin(Math.min(vertical, horizontal));
          const drift = reducedMotion ? 0 : cinematicProgress(clock % (duration / 2), 0, duration / 2);
          frame(
            focus.clone().addScaledVector(stageFront, distance)
              .addScaledVector(stageRight, (enemySpeaking ? -1 : 1) * distance * (0.18 - drift * 0.04))
              .add(V(0, -2.2, 0)),
            focus, 40,
          );
        } else if (beat.shot === "evade") {
          if (clock < 0.38) {
            id += "-threat";
            frame(
              context.enemyChest.clone().add(V(7, 3, 22)),
              context.enemyBladeTip.clone().lerp(context.heroChest, 0.35),
              52,
              -0.015,
            );
          } else {
            id += "-track";
            stageFrame(
              context.heroChest.clone().lerp(context.enemyChest, 0.32),
              -8 + p * 6, 2.5, 43, 46,
              -Math.sin(p * Math.PI) * 0.012,
            );
          }
        } else if (beat.shot === "parry") {
          stageFrame(
            context.heroChest.clone().lerp(context.enemyChest, 0.5),
            -5 + p * 3, 1.8, 35, 43,
          );
        } else if (beat.shot === "countershot") {
          if (clock < FINISHER_RIFLE.fire - 0.4) {
            id += "-draw";
            stageFrame(context.heroChest, -13, 2.4, 25, 42);
          } else if (clock < FINISHER_RIFLE.lastShot + 0.25) {
            id += "-sight";
            stageFrame(
              context.heroMuzzle.clone().lerp(context.enemyChest, 0.3),
              -18, 2.2, 31, 43,
            );
          } else {
            id += "-pursuit";
            stageFrame(center, -6, 3, 43, 46);
          }
        } else if (beat.shot === "clash") {
          if (clock < 0.8) {
            id += "-contact-wide";
            const pan = reducedMotion ? 0.5 : cinematicProgress(clock, 0, 0.8);
            poseFrame(context, -9 + pan * 4, 3, 44, 47);
          } else if (clock < 1.85) {
            // Steel insert while the blades lock, leading into the face pair.
            id += "-locked-steel";
            const slide = reducedMotion
              ? 0.5
              : cinematicProgress(clock, 0.8, 1.85);
            frame(
              context.clash
                .clone()
                .add(V(-2 + slide * 3, 1.2, 13 - slide * 2)),
              context.clash,
              44,
            );
          } else if (clock < 3.45) {
            const heroShot = clock < 2.65;
            id += heroShot ? "-prime-face" : "-verdict-face";
            // Reverse the gaze, not the side of the sword lock.
            frame(
              context.clash
                .clone()
                .addScaledVector(stageFront, 3.1)
                .add(V(0, 1.2, 0)),
              heroShot ? context.heroFace : context.enemyFace,
              37,
            );
          } else {
            id += "-break-wide";
            const pan = reducedMotion ? 0.5 : cinematicProgress(clock, 3.45, duration);
            poseFrame(context, -8 + pan * 3, 4, 46, 47);
          }
        } else if (beat.shot === "exchange") {
          const timing = FINISHER_EXCHANGE;
          const firstPhrase = timing.cuts[2].end;
          const counterPhrase = timing.cuts[5].end;
          const finalContact = timing.cuts[11].end;
          const heroArmStart = timing.cuts[1].end;
          const impactStart = timing.cuts[5].hit - 0.14;
          const enemyArmEnd = timing.cuts[9].end;
          const armInsert = (owner: MechSide, slide: number) => {
            const arm = armView(context, owner, slide);
            const focus = context.heroChest.clone().lerp(context.enemyChest, 0.5).add(V(0, 1.4, 0));
            arm.position.addScaledVector(arm.position.clone().sub(focus).normalize(), 3.5);
            frame(arm.position, focus, 53);
          };
          const pan = (start: number, end: number) =>
            reducedMotion ? 0.5 : cinematicProgress(clock, start, end);
          if (reducedMotion) {
            id += "-steady-exchange";
            poseFrame(context, 0, 6, 52, 48);
          } else if (clock < heroArmStart) {
            id += "-opening-poses";
            poseFrame(context, -10 + pan(0, heroArmStart) * 6, 4, 44, 47);
          } else if (clock < firstPhrase) {
            id += "-hero-arm-contact";
            armInsert("hero", pan(heroArmStart, firstPhrase));
          } else if (clock < impactStart) {
            id += "-counter-blades";
            poseFrame(context, 9 - pan(firstPhrase, impactStart) * 4, 2.3, 39, 49);
          } else if (clock < counterPhrase) {
            id += "-counter-impact";
            stageFrame(context.heroChest.clone().lerp(context.enemyChest, 0.5)
              .lerp(context.clash, 0.35), -3, 1.2, 26, 44);
          } else if (clock < timing.circleEnd) {
            id += "-circling-footwork";
            const arc = pan(counterPhrase, timing.circleEnd);
            poseFrame(context, -10 + arc * 6, 8 - arc * 3, 46, 47);
          } else if (clock < timing.breakEnd) {
            id += "-separation-wide";
            const pull = pan(timing.circleEnd, timing.breakEnd);
            poseFrame(context, -3 + pull * 4, 7 + pull * 5, 48 + pull * 8, 47);
          } else if (clock < enemyArmEnd) {
            id += "-enemy-arm-contact";
            armInsert("enemy", pan(timing.breakEnd, enemyArmEnd));
          } else if (clock < finalContact) {
            id += "-return-side";
            poseFrame(context, 3 - pan(enemyArmEnd, finalContact) * 6, 3, 42, 48);
          } else {
            id += "-final-impact";
            stageFrame(context.heroChest.clone().lerp(context.enemyChest, 0.5)
              .lerp(context.clash, 0.3), -7, 2, 29, 46);
          }
        } else if (beat.shot === "armCut") {
          id += "-sword-arm";
          const arm = armView(context, "hero", p);
          frame(arm.position, arm.target, 46, -Math.sin(p * Math.PI) * 0.008);
        } else if (beat.shot === "ascend") {
          stageFrame(
            context.heroChest.clone().lerp(context.enemyChest, 0.32),
            5 - p * 3, -4 + p * 6, 48, 46,
          );
        } else if (beat.shot === "reactor") {
          id += "-revenge-charge";
          const push = reducedMotion ? 0 : cinematicProgress(clock, 0, duration);
          stageFrame(
            context.heroChest.clone().lerp(context.heroBladeTip, 0.25),
            8 - push * 3, -3 + push * 2, 43 - push * 4, 42,
          );
        } else if (beat.shot === "finalCut") {
          const timing = FINISHER_EXECUTION;
          if (clock < timing.vanish) {
            id += "-dive";
            const rush = cinematicProgress(clock, timing.dash, timing.vanish);
            stageFrame(
              context.heroChest.clone().lerp(context.enemyChest, 0.5),
              reducedMotion ? -3 : -7 + rush * 5,
              3, 48, 48, -rush * 0.012,
            );
          } else if (clock < timing.appear) {
            id += "-empty-blade";
            stageFrame(
              context.enemyChest.clone().lerp(context.enemyBladeTip, 0.2),
              -7, 3, 35, 47,
            );
          } else if (clock < timing.cuts) {
            id += "-behind";
            stageFrame(
              context.enemyChest.clone().lerp(context.heroChest, 0.5),
              9, 1.8, 42, 43,
            );
          } else if (clock < timing.cuts + 0.9) {
            id += "-execution-orbit";
            const arc = cinematicProgress(
              clock,
              timing.cuts,
              timing.cuts + 0.9,
            );
            const track = reducedMotion ? 0.5 : arc;
            stageFrame(context.enemyChest, -7 + track * 4, 2, 37, 44);
          } else if (clock < timing.lastCut) {
            id += "-execution-orbit";
            const push = cinematicProgress(
              clock,
              timing.cuts + 0.9,
              timing.lastCut,
            );
            stageFrame(context.enemyChest, -3 + push * 2, 2, 37 - push * 3, 44);
          } else if (clock < timing.collapse) {
            id += "-blade-falls";
            stageFrame(center, 7, 2, 43, 45);
          } else {
            id += "-aftermath";
            const pull = cinematicProgress(clock, timing.collapse, duration);
            stageFrame(center, 7 + pull * 4, 2 + pull * 5, 43 + pull * 12, 45);
          }
        }
      } else if (phase === "defeat") {
        if (t < 2.6) {
          id += "-execution";
          frame(
            hero.position.clone().add(V(8, 1, 9)),
            hero.position.clone().add(V(0, 8, 0)),
            44,
            -0.035,
          );
        } else {
          id += "-dead";
          const focus = hero.position.clone().add(V(0, 6, 0));
          frame(focus.clone().add(V(9 + t, 3, 22 + t)), focus, 47);
        }
      } else if (phase === "victory" || phase === "credits" || phase === "done") {
        if (context.remembrance) {
          id += "-remorse-low-angle";
          frame(context.remembrance.position, context.remembrance.target, 44);
        } else {
          id += "-last-cut";
          const focus = hero.position
            .clone()
            .lerp(enemy.position, 0.5)
            .add(V(0, 8, 0));
          frame(focus.clone().add(V(17, 13, 52)), focus, 55);
        }
      } else {
        const special = context.special;
        if (special) {
          id += `-${special.owner}-${special.kind}`;
          const actor = special.owner === "hero" ? hero : enemy;
          if (special.kind === "missiles") {
            const opponent =
              special.owner === "hero" ? context.enemyChest : context.heroChest;
            const facing = Math.sign(opponent.x - actor.position.x) || 1;
            const chest =
              special.owner === "hero" ? context.heroChest : context.enemyChest;
            const muzzle =
              special.owner === "hero"
                ? context.heroMuzzle
                : context.enemyMuzzle;
            if (special.time < RIFLE_SEQUENCE.sheath) {
              id += "-sheath";
              frame(
                actor.localToWorld(V(-11, 14, -16)),
                chest.clone().add(V(0, 1, -1)),
                48,
              );
            } else if (special.time < RIFLE_SEQUENCE.ready) {
              id += "-draw";
              const p = smooth(
                special.time,
                RIFLE_SEQUENCE.sheath,
                RIFLE_SEQUENCE.ready,
              );
              frame(
                actor.localToWorld(V(-12 + p * 2, 14.5, -17 + p * 5)),
                chest,
                53,
              );
            } else {
              id += "-sight";
              frame(
                muzzle.clone().add(V(-facing * 6, 2, 10)),
                muzzle.clone().lerp(opponent, 0.18),
                53,
              );
            }
          } else if (special.kind === "orbitalCut") {
            id += "-eclipse-rend";
            const orbit = cinematicProgress(special.time, 0, 1.25);
            frame(
              enemy.position
                .clone()
                .add(V(-19 + orbit * 5, 12 + orbit * 3, 25 - orbit * 4)),
              context.enemyChest
                .clone()
                .lerp(context.enemyBladeTip, 0.3 + orbit * 0.12),
              51 - orbit * 4,
              -0.03,
            );
          } else if (special.kind === "verdict") {
            if (special.time < ENEMY_ATTACK_LEAPS.verdict.land) {
              id += "-retreat";
              frame(
                enemy.position.clone().add(V(-22, 9, 34)),
                enemy.position.clone().add(V(0, 8, 0)),
                57,
                -0.015,
              );
            } else {
              id += "-sword-tip";
              frame(
                context.enemyBladeTip.clone().add(V(-10, 2.5, 15)),
                context.enemyChest.clone().lerp(context.enemyBladeTip, 0.66),
                49,
              );
            }
          } else {
            id += "-poised";
            const p = smooth(special.time, 0, 1.45);
            frame(
              actor.position.clone().add(V(15 - p * 4, 11 + p * 6, 28)),
              context.heroChest.clone().lerp(context.heroBladeTip, 0.3),
              54,
            );
          }
        } else frame(combat.position, combat.center, 54);
      }
      const shotChanged = id !== shotId;
      if (shotChanged) {
        const firstShot = !shotId;
        lastPosition.copy(camera.position);
        lastRotation.copy(camera.quaternion);
        lastTarget.copy(previousTarget);
        lastFov = camera.fov;
        const editorialCut = phase === "victory" && id.endsWith("-remorse-low-angle");
        const locationCut =
          (phase === "rupture" &&
            (id.includes("-brendan") ||
              id.endsWith("-burning-earth") ||
              id.endsWith("-cockpit") ||
              id.endsWith("-facility-core") ||
              shotId.endsWith("-facility-core"))) ||
          (phase === "heroTransform" && id.endsWith("-forest-liftoff")) ||
          (phase === "enemyTransform" &&
            (id.endsWith("-office-clearing-blast") ||
              id.endsWith("-roof-circle-cut") ||
              id.endsWith("-roof-lift-passengers")));
        shotId = id;
        transition =
          firstShot || reducedMotion || editorialCut || locationCut ? 1 : 0;
      }
      const transitionSeconds =
        phase === "defeat" ||
        (phase === "rupture" && t >= PLANET_RUPTURE.forest)
          ? 0.65
          : phase === "reveal"
            ? 0.85
          : phase === "finisher"
            ? context.finisher.beat.shot === "challenge" ? 0.65 : 0.16
            : phase === "ground" || phase === "space"
              ? 0.28
              : 0.32;
      transition = Math.min(1, transition + dt / transitionSeconds);
      if (transition < 1) {
        const blend = smooth(transition, 0, 1);
        position.lerpVectors(lastPosition, position.clone(), blend);
        target.lerpVectors(lastTarget, target.clone(), blend);
        rotation.slerpQuaternions(lastRotation, rotation.clone(), blend);
        fov = THREE.MathUtils.lerp(lastFov, fov, blend);
      } else if (
        (phase === "ground" || phase === "space") &&
        !context.special &&
        dt > 0
      ) {
        const blend = 1 - Math.exp(-dt * 5);
        position.lerpVectors(camera.position, position.clone(), blend);
        rotation.slerpQuaternions(camera.quaternion, rotation.clone(), blend);
      }
      if (phase === "finisher") {
        if (!shotChanged && dt > 0) {
          const follow = 1 - Math.exp(-dt * 16);
          position.lerpVectors(stablePosition, position.clone(), follow);
          target.lerpVectors(previousTarget, target.clone(), follow);
        }
        previousTarget.copy(target);
        clearFinisherCamera(context);
      }
      stablePosition.copy(position);
      if (!reducedMotion && shake > 0.001) {
        const cinematic = phase === "finisher";
        const exchange = cinematic && context.finisher.beat.shot === "exchange";
        const amount = cinematic
          ? Math.min(shake, id.endsWith("-face") ? 0.04 : exchange ? 0.65 : 0.3)
          : shake;
        position.add(V(
          Math.cos(shakeAge * 38) * amount,
          Math.sin(shakeAge * 47 + 0.5) * amount * 0.55,
          -Math.cos(shakeAge * 31) * amount * 0.3,
        ).applyQuaternion(rotation));
        shakeAngles.set(
          Math.sin(shakeAge * 41 + 0.7) * amount * 0.012,
          Math.cos(shakeAge * 33) * amount * 0.008,
          Math.sin(shakeAge * 29) * amount * 0.006,
        );
        rotation.multiply(shakeRotation.setFromEuler(shakeAngles));
      }
      // Handheld tremor that runs under the whole blow exchange, hotter on the
      // contact inserts, so the duel never reads as locked-off between impacts.
      if (
        !reducedMotion &&
        phase === "finisher" &&
        id.includes("-exchange") &&
        !id.endsWith("-separation-wide") &&
        !id.endsWith("-circling-footwork")
      ) {
        const contact =
          id.endsWith("-counter-impact") || id.endsWith("-final-impact") ? 1
          : id.endsWith("-hero-arm-contact") ||
            id.endsWith("-enemy-arm-contact")
            ? 0.62
            : 0.34;
        const tremor = context.time;
        position.add(V(
          Math.sin(tremor * 13.7) * 0.18 + Math.sin(tremor * 27.1) * 0.055,
          Math.cos(tremor * 17.3) * 0.12 + Math.sin(tremor * 31.7) * 0.04,
          Math.sin(tremor * 11.9) * 0.065,
        ).multiplyScalar(contact).applyQuaternion(rotation));
        shakeAngles.set(
          Math.sin(tremor * 15.1) * 0.012 * contact,
          Math.cos(tremor * 12.3) * 0.009 * contact,
          Math.sin(tremor * 9.7) * 0.007 * contact,
        );
        rotation.multiply(shakeRotation.setFromEuler(shakeAngles));
      }
      shakeAge += dt;
      shake *= Math.exp(-dt * (
        phase === "finisher" && context.finisher.beat.shot === "exchange" ? 8 : 11
      ));
      if (phase === "rupture" && !reducedMotion) {
        const quake = samplePlanetSurface(t).rumble;
        const onSurface = t >= PLANET_RUPTURE.forest && t < PLANET_RUPTURE.forestEnd;
        const pov = t >= PLANET_RUPTURE.feet && t < PLANET_RUPTURE.fall;
        const amount = quake * (onSurface ? (pov ? 0.055 : 0.15) : 2.4);
        position.add(V(
          Math.sin(t * 23) + Math.sin(t * 41) * 0.25,
          Math.cos(t * 31) * 0.65,
          Math.sin(t * 19) * 0.25,
        ).multiplyScalar(amount).applyQuaternion(rotation));
        const angle = quake * (pov ? 0.003 : 0.005);
        shakeAngles.set(Math.sin(t * 21) * angle, Math.cos(t * 17) * angle * 0.6,
          Math.sin(t * 27) * angle * 0.5);
        rotation.multiply(shakeRotation.setFromEuler(shakeAngles));
      }
      const insideOffice = phase === "loading" || phase === "error" || phase === "reveal" ||
        (phase === "enemyTransform" && t < FACILITY_ROOF_SEQUENCE.cutStart);
      if (insideOffice) {
        const lensMargin = Math.max(0.6, camera.near *
          Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.hypot(1, camera.aspect) + 0.3);
        position.z = Math.min(position.z, FACILITY.z + FACILITY_OFFICE.front - lensMargin);
        frame(position, target, fov, frameRoll);
      }
      previousTarget.copy(target);
      camera.position.copy(position);
      camera.quaternion.copy(rotation);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    },
    apply() {
      camera.position.copy(position);
      camera.quaternion.copy(rotation);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    },
  };
}
