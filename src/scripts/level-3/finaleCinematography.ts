import * as THREE from 'three';
import type { FinalePhase } from '../global/finaleDirector.js';
import type { MechSide } from '../npc/mechDuel.js';
import { FINALE_DECK_Y, FINALE_ROOFTOP, PLANET_CENTER } from './finaleWorld.js';
import {
  FINALE_REVEAL, HERO_TRANSFORM, PLANET_RUPTURE, RIFLE_SEQUENCE, FINISHER_EXECUTION, FINISHER_RIFLE, DONUS_RETURN,
  activeStudent, cinematicProgress, ENEMY_ATTACK_LEAPS, type FinisherBeat,
} from '../global/finaleChoreography.js';

export interface FinaleCameraContext {
  phase: FinalePhase; phaseTime: number; time: number; space: boolean;
  hero: THREE.Object3D; enemy: THREE.Object3D; human: THREE.Vector3; students: readonly THREE.Object3D[];
  boy: THREE.Vector3; pilotFace: THREE.Vector3; pilotCamera: THREE.Vector3;
  ship: THREE.Object3D; mothership: THREE.Object3D; bomb: THREE.Vector3; heroChest: THREE.Vector3; enemyChest: THREE.Vector3;
  heroFace: THREE.Vector3; enemyFace: THREE.Vector3; heroShoulder: THREE.Vector3;
  heroMuzzle: THREE.Vector3; enemyMuzzle: THREE.Vector3; clash: THREE.Vector3;
  heroBladeBase: THREE.Vector3; heroBladeTip: THREE.Vector3; enemyBladeTip: THREE.Vector3;
  facilityInterior?: { cameraPosition: THREE.Vector3; target: THREE.Vector3 };
  special: { owner: MechSide; kind: 'missiles' | 'overdrive' | 'verdict' | 'orbitalCut'; time: number; duration: number } | null;
  finisher: { beat: FinisherBeat; clock: number };
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smootherstep;
const local = (x: number, y: number, z: number) =>
  V(FINALE_ROOFTOP.x + x, FINALE_DECK_Y + y, FINALE_ROOFTOP.z + z);

export function createFinaleCamera(camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
  const position = camera.position.clone(), target = new THREE.Vector3(), rotation = camera.quaternion.clone();
  const desired = new THREE.PerspectiveCamera(), lastPosition = position.clone(), lastRotation = rotation.clone();
  let shotId = '', transition = 1, shake = 0, fov = camera.fov, lastFov = camera.fov;
  function duelView(context: FinaleCameraContext) {
    const center = context.hero.position.clone().lerp(context.enemy.position, 0.5).add(V(0, 8, 0));
    const gap = Math.abs(context.enemy.position.x - context.hero.position.x) + 16;
    const height = 34 + Math.abs(context.enemy.position.y - context.hero.position.y);
    const angle = THREE.MathUtils.degToRad(54 / 2);
    const horizontalDistance = gap / (Math.max(0.5, camera.aspect) * 2 * Math.tan(angle));
    const verticalDistance = height / (2 * Math.tan(angle));
    const distance = Math.max(36, horizontalDistance, verticalDistance) * 1.04;
    return { center, position: center.clone().add(V(distance * 0.16, distance * 0.28, distance)) };
  }
  function frame(p: THREE.Vector3, look: THREE.Vector3, lens = 51, roll = 0) {
    position.copy(p); target.copy(look); fov = lens;
    desired.position.copy(position); desired.up.set(0, 1, 0); desired.lookAt(target);
    if (!reducedMotion) desired.rotateZ(roll);
    rotation.copy(desired.quaternion);
  }
  return {
    impact(strength: number) { shake = Math.max(shake, reducedMotion ? 0 : strength); },
    update(context: FinaleCameraContext, dt: number) {
      const { phase, phaseTime: t, hero, enemy, human } = context;
      const combat = duelView(context);
      let id = phase as string;
      if (phase === 'loading' || phase === 'error') frame(local(0, 2.3, 13.5), local(0, 1.3, -5), 56);
      else if (phase === 'reveal') {
        if (t < 3.2) {
          id += '-door'; const p = smooth(t, 0, 3.2);
          frame(local(0.3 + p, 2.1, 13 - p * 3.2), local(0, 1.15, -5), 57 - p * 7);
        } else if (t < 6.3) {
          id += '-footsteps'; const p = smooth(t, 3.2, 6.3);
          frame(local(-5 + p * 9, 0.65, 0.7), local(-3 + p * 6, 0.45, -4.8), 47);
        } else if (t < FINALE_REVEAL.studentStart) {
          id += '-accusation'; frame(local(-1.4, 1.7, 3.4), local(0, 1.4, -3.5), 54);
        } else if (t < FINALE_REVEAL.studentEnd) {
          const index = activeStudent(t, 'reveal');
          id += `-student-${index}`;
          const actor = context.students[index], focus = actor?.position.clone().add(V(0, 1.45, 0)) ?? V(0, 1.45, -3.5);
          const drift = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.25;
          frame(focus.clone().add(V(index % 2 ? -1.7 + drift : 1.7 + drift, 0.12, 3.6)), focus, 39);
        } else if (t < FINALE_REVEAL.mentorEnd) {
          id += '-wound'; frame(context.human.clone().add(V(-2.15, 1.45, 3.5)),
            context.human.clone().add(V(0, 1.15, 0)), 42, -0.012);
        } else if (t < FINALE_REVEAL.correctionEnd) {
          const actor = context.students[4], focus = actor?.position.clone().add(V(0, 1.45, 0)) ?? local(4.9, 1.45, -3.5);
          id += '-cruel-reply'; frame(focus.clone().add(V(-1.8, 0.12, 3.5)), focus, 40, 0.01);
        } else if (t < FINALE_REVEAL.brandenEnd) {
          id += '-hurt'; frame(context.human.clone().add(V(2.1, 1.25, 3.2)),
            context.human.clone().add(V(0, 1.1, 0)), 44, 0.008);
        } else if (t < FINALE_REVEAL.mockeryEnd) {
          const actor = context.students[4], focus = actor?.position.clone().add(V(0, 1.45, 0)) ?? local(4.9, 1.45, -3.5);
          id += '-mockery'; frame(focus.clone().add(V(1.8, 0.08, 3.4)), focus, 40, -0.008);
        } else if (t < FINALE_REVEAL.betrayalEnd) {
          id += '-divide'; frame(local(-4.7, 2.15, 7.6), local(0, 1.25, -1.5), 52, -0.012);
        } else if (t < FINALE_REVEAL.recognitionEnd) {
          id += '-recognition'; frame(context.human.clone().add(V(-2, 1.2, 3)),
            context.human.clone().add(V(0, 1.15, 0)), 41);
        } else if (t < FINALE_REVEAL.renounceEnd) {
          id += '-resolve'; frame(context.human.clone().add(V(-1.45, 0.7, 2.65)),
            context.human.clone().add(V(0, 1.25, 0)), 39);
        } else if (t < FINALE_REVEAL.challengeEnd) {
          id += '-crane'; const p = smooth(t, FINALE_REVEAL.renounceEnd, FINALE_REVEAL.challengeEnd);
          frame(local(-5 + p * 9, 3 + p * 2.3, 8 + p * 2), local(0, 1.25, -3.5), 58);
        } else {
          id += '-answer'; frame(context.human.clone().add(V(1.45, 0.9, 2.55)),
            context.human.clone().add(V(0, 1.3, 0)), 38);
        }
      } else if (phase === 'enemyTransform') {
        if (t < 3.2) {
          id += '-fireworks'; frame(local(-3, 8 + t, 25), local(14, 4, 0), 62);
        } else if (t < 5.4) {
          id += '-assembly'; const p = smooth(t, 3.2, 5.4);
          frame(enemy.position.clone().add(V(-13, 1.4 + p * 11, 18)), enemy.position.clone().add(V(0, 3 + p * 8, 0)), 55, -0.025);
        } else if (activeStudent(t, 'boarding') >= 0) {
          const index = activeStudent(t, 'boarding');
          id += `-core-${index}`;
          const actor = context.students[index];
          const focus = actor.position.clone().add(V(0, Math.max(0.12, actor.scale.y), 0));
          const merge = actor.scale.y < 0.75;
          if (merge) focus.lerp(context.enemyChest, 0.6);
          frame(focus.clone().add(V(-5.5, 1.1, 8.5)), focus.clone().lerp(context.enemyChest, 0.16), 47, -0.012);
        } else {
          id += '-verdict'; const p = smooth(t, 17, 19.2);
          frame(enemy.position.clone().add(V(-17 - p * 3, 3.2 + p * 3.5, 23)), enemy.position.clone().add(V(0, 9, 0)), 56, -0.03);
        }
      } else if (phase === 'heroTransform') {
        if (t < HERO_TRANSFORM.launch + 0.2) {
          id += '-prime'; frame(human.clone().add(V(-2, 1.5, -2.9)), human.clone().add(V(0, 1.3, 0)), 48);
        } else if (t < 2.8) {
          id += '-forest-liftoff';
          const ship = context.ship.position;
          frame(ship.clone().add(V(-13, 6, 19)), ship.clone().add(V(0, 1, 0)), 58, -0.02);
        } else if (t < HERO_TRANSFORM.arrival) {
          id += '-ship-flyby';
          const p = smooth(t, 2.8, HERO_TRANSFORM.arrival);
          const ship = context.ship.position;
          frame(ship.clone().add(V(12 - p * 5, 4 + p * 2, 20)), ship.clone().add(V(0, 1, -2)), 61, -0.04 + p * 0.06);
        } else if (t < HERO_TRANSFORM.pilotMerge) {
          id += '-ship-morph'; const p = smooth(t, HERO_TRANSFORM.arrival, HERO_TRANSFORM.pilotMerge);
          const focus = hero.position.clone().add(V(0, 7 + p * 3, 0));
          frame(hero.position.clone().add(V(15 - p * 5, 8, 22)), focus, 60, 0.025);
        } else if (t < HERO_TRANSFORM.assembled) {
          id += '-light'; const p = smooth(t, HERO_TRANSFORM.pilotMerge, HERO_TRANSFORM.assembled);
          frame(hero.position.clone().add(V(13, 1.5 + p * 11, 16)), hero.position.clone().add(V(0, 4 + p * 7, 0)), 56, 0.025);
        } else if (t < 14.3) {
          id += '-blade'; const angle = reducedMotion ? 0.65 : 0.65 + (t - HERO_TRANSFORM.assembled) * 0.4;
          frame(hero.position.clone().add(V(Math.cos(angle) * 23, 7 + (t - HERO_TRANSFORM.assembled), Math.sin(angle) * 23)),
            hero.position.clone().add(V(0, 10, 0)), 59);
        } else {
          id += '-versus'; const p = smooth(t, 14.3, 17);
          frame(combat.position.clone().add(V(-8 * (1 - p), -14 * (1 - p), 8 * (1 - p))), combat.center, 54);
        }
      } else if (phase === 'versus') {
        frame(combat.position, combat.center, 51);
      } else if (phase === 'rupture') {
        if (t >= PLANET_RUPTURE.facilityCut && t < PLANET_RUPTURE.materialize && context.facilityInterior) {
          id += '-facility-core';
          frame(context.facilityInterior.cameraPosition, context.facilityInterior.target, 44);
        } else if (t < PLANET_RUPTURE.raise) {
          id += '-verdict-pose';
          frame(enemy.position.clone().add(V(-18, 4, 26)), context.enemyChest, 55, -0.018);
        } else if (t < PLANET_RUPTURE.release) {
          id += '-summon'; const p = smooth(t, PLANET_RUPTURE.raise, PLANET_RUPTURE.release);
          frame(enemy.position.clone().add(V(-16, 9 + p * 7, 27)), context.enemyChest.clone().lerp(context.bomb, p * 0.65), 56);
        } else if (t < PLANET_RUPTURE.apex) {
          id += '-launch'; const p = smooth(t, PLANET_RUPTURE.release, PLANET_RUPTURE.apex);
          frame(context.bomb.clone().add(V(-24, -10 + p * 15, 45)), context.bomb, 61, -0.025);
        } else if (t < PLANET_RUPTURE.escape) {
          id += '-command';
          frame(enemy.position.clone().add(V(-14, 12, 20)), context.enemyChest.clone().add(V(0, 3, 0)), 48, -0.02);
        } else if (t < PLANET_RUPTURE.wide) {
          id += '-meteor';
          frame(context.bomb.clone().add(V(-48, -25, 70)), context.bomb.clone().lerp(PLANET_CENTER, 0.1), 62, 0.035);
        } else if (t < PLANET_RUPTURE.forest) {
          id += '-planet'; const p = smooth(t, PLANET_RUPTURE.wide, PLANET_RUPTURE.forest);
          frame(PLANET_CENTER.clone().add(V(600 + p * 70, 480 + p * 45, 1000 + p * 25)),
            PLANET_CENTER.clone().add(V(0, 95, 0)), 46, -0.012);
        } else if (t < PLANET_RUPTURE.forestEnd) {
          if (t < PLANET_RUPTURE.scorch) {
            id += '-brendan';
            frame(context.boy.clone().add(V(-2.6, 0.5, 4)), context.boy.clone().add(V(0, -0.45, 0)), 43, -0.012);
          } else {
            id += '-brendan-head-fire'; const pull = cinematicProgress(t, PLANET_RUPTURE.scorch + 0.25, PLANET_RUPTURE.forestEnd);
            frame(context.boy.clone().add(V(-0.8 - pull * 0.6, 0.6 + pull * 0.5, 2.6 + pull * 0.8)),
              context.boy.clone().add(V(0, -0.08, 0)), 40, -0.012);
          }
        } else if (t < PLANET_RUPTURE.returnToDuel) {
          id += '-cockpit'; const resolve = cinematicProgress(t, PLANET_RUPTURE.resolve, PLANET_RUPTURE.returnToDuel);
          frame(context.pilotCamera, context.pilotFace, 43 - resolve * 3);
        } else {
          id += '-orbit'; const p = cinematicProgress(t, PLANET_RUPTURE.returnToDuel, PLANET_RUPTURE.orbit + 0.4);
          const start = context.pilotCamera.clone();
          const exit = start.clone().sub(context.pilotFace).normalize();
          frame(start.lerp(combat.position, p).addScaledVector(exit, Math.sin(p * Math.PI) * 6),
            context.pilotFace.clone().lerp(combat.center, p), 40 + p * 14);
        }
      } else if (phase === 'finisher') {
        const { beat, clock } = context.finisher;
        const duration = beat.duration;
        const p = cinematicProgress(clock, 0, duration);
        id += `-${beat.shot}`;
        const center = hero.position.clone().lerp(enemy.position, 0.5).add(V(0, 9, 0));
        const forward = V(0, 0, 1).applyQuaternion(hero.quaternion).normalize();
        const side = new THREE.Vector3().crossVectors(forward, V(0, 1, 0)).normalize();
        if (beat.shot === 'evade') {
          if (clock < 0.38) {
            id += '-threat';
            frame(context.enemyChest.clone().add(V(7, 3, 22)), context.enemyBladeTip.clone().lerp(context.heroChest, 0.35), 52, -0.015);
          } else {
            id += '-track';
            frame(context.heroChest.clone().add(V(-11 + p * 12, 2 + p * 3, 29)), context.heroChest.clone().lerp(context.enemyChest, 0.18),
              56, -Math.sin(p * Math.PI) * 0.035);
          }
        } else if (beat.shot === 'parry') {
          frame(context.clash.clone().add(V(-6 + p * 8, 2, 27)), context.clash.clone().lerp(center, 0.15), 48, -0.015);
        } else if (beat.shot === 'countershot') {
          if (clock < FINISHER_RIFLE.fire - 0.4) {
            id += '-draw'; frame(hero.localToWorld(V(-9, 13, -14)), context.heroChest, 49);
          } else if (clock < FINISHER_RIFLE.lastShot + 0.25) {
            id += '-sight'; frame(hero.localToWorld(V(-8, 13, -11)), context.heroMuzzle.clone().lerp(context.enemyChest, 0.25), 53);
          } else {
            id += '-pursuit'; frame(center.clone().add(V(-5, 4, 37)), center, 54, -0.01);
          }
        } else if (beat.shot === 'clash') {
          if (clock < 0.8) {
            id += '-approach'; frame(center.clone().add(V(-7, 5, 35)), center, 56, -0.02);
          } else if (clock < 1.85) {
            id += '-steel'; const slide = cinematicProgress(clock, 0.8, 1.85);
            frame(context.clash.clone().add(V(-2 + slide * 3, 1.2, 13)), context.clash, 44);
          } else if (clock < 2.65) {
            id += '-prime-face';
            frame(context.heroFace.clone().addScaledVector(forward, 6.8).addScaledVector(side, 3.1).add(V(0, 0.5, 0)),
              context.heroFace, 37);
          } else if (clock < 3.45) {
            id += '-verdict-face';
            const enemyForward = V(0, 0, 1).applyQuaternion(enemy.quaternion);
            frame(context.enemyFace.clone().addScaledVector(enemyForward, 6.8).addScaledVector(side, 3.1).add(V(0, 0.5, 0)),
              context.enemyFace, 37);
          } else {
            id += '-break'; frame(center.clone().add(V(-6 + p * 4, 3, 33)), center, 54);
          }
        } else if (beat.shot === 'armCut') {
          id += '-sword-arm';
          frame(context.heroShoulder.clone().addScaledVector(forward, -5.2).addScaledVector(side, 2.4 + p * 0.8).add(V(0, 1, 0)),
            context.enemyChest.clone().lerp(context.heroBladeTip, 0.16), 59, -Math.sin(p * Math.PI) * 0.018);
        } else if (beat.shot === 'ascend') {
          frame(hero.position.clone().add(V(7 - p * 4, 2, 34)), context.heroChest.clone().lerp(context.enemyChest, 0.18), 58);
        } else if (beat.shot === 'reactor') {
          const angle = reducedMotion ? 0.3 : 0.3 + p * 0.45;
          frame(hero.position.clone().add(V(Math.sin(angle) * 30, 12 + p * 6, Math.cos(angle) * 30)),
            context.heroChest.clone().lerp(context.heroBladeTip, 0.35 + p * 0.15), 48 + p * 5, -0.015);
        } else if (beat.shot === 'finalCut') {
          const timing = FINISHER_EXECUTION;
          if (clock < timing.vanish) {
            id += '-dive'; const rush = cinematicProgress(clock, timing.dash, timing.vanish);
            frame(reducedMotion ? combat.position : context.heroChest.clone().add(V(-10 + rush * 5, 6 - rush * 4, 28 - rush * 5)),
              context.heroChest.clone().lerp(context.enemyChest, 0.25), 54 + rush * 6, -rush * 0.035);
          } else if (clock < timing.appear) {
            id += '-empty-blade';
            frame(context.enemyChest.clone().add(V(-10, 2, 23)), context.enemyChest.clone().lerp(context.enemyBladeTip, 0.25), 48);
          } else if (clock < timing.cuts) {
            id += '-behind';
            frame(center.clone().add(V(9, 3, 33)), context.enemyChest.clone().lerp(context.heroChest, 0.5), 49);
          } else if (clock < timing.cuts + 0.9) {
            id += '-execution-orbit'; const arc = cinematicProgress(clock, timing.cuts, timing.cuts + 0.9);
            const angle = reducedMotion ? 0 : -0.45 + arc * 0.9;
            frame(context.enemyChest.clone().add(V(Math.sin(angle) * 32, 3 - arc * 3, Math.cos(angle) * 32)),
              context.enemyChest, 53, (arc - 0.5) * 0.04);
          } else if (clock < timing.lastCut) {
            id += '-execution-impact'; const push = cinematicProgress(clock, timing.cuts + 0.9, timing.lastCut);
            frame(context.enemyChest.clone().add(V(-10 + push * 4, 2, 28 - push * 3)),
              context.enemyChest, 50 - push * 3, -0.025);
          } else if (clock < timing.collapse) {
            id += '-blade-falls'; frame(center.clone().add(V(7, 3, 36)), center, 53);
          } else {
            id += '-aftermath'; const pull = cinematicProgress(clock, timing.collapse, duration);
            frame(center.clone().add(V(7 + pull * 10, 5 + pull * 8, 36 + pull * 16)), center, 55);
          }
        }
      } else if (phase === 'defeat') {
        if (t < 2.6) {
          id += '-execution'; frame(hero.position.clone().add(V(8, 1, 9)), hero.position.clone().add(V(0, 8, 0)), 44, -0.035);
        } else {
          id += '-dead'; const focus = hero.position.clone().add(V(0, 6, 0));
          frame(focus.clone().add(V(9 + t, 3, 22 + t)), focus, 47);
        }
      } else if (phase === 'victory') {
        if (t < DONUS_RETURN.dance) {
          id += '-last-cut'; const focus = hero.position.clone().lerp(enemy.position, 0.5).add(V(0, 8, 0));
          frame(focus.clone().add(V(17, 13, 52)), focus, 55);
        } else if (t < DONUS_RETURN.appear) {
          id += '-dance'; const drift = reducedMotion ? 0 : Math.sin((t - DONUS_RETURN.dance) * 0.35) * 4;
          frame(hero.position.clone().add(V(4 + drift, 9, 33)), hero.position.clone().add(V(0, 8, 0)), 44);
        } else if (t < DONUS_RETURN.arrival) {
          id += '-mothership'; frame(hero.position.clone().add(V(50, 26, 110)), hero.position.clone().add(V(25, 10, -12)), 54);
        } else {
          id += '-end'; const focus = hero.position.clone().lerp(context.mothership.position, 0.4).add(V(0, 8, 0));
          frame(focus.clone().add(V(24, 14, 100)), focus, 54);
        }
      } else if (phase === 'credits' || phase === 'done') {
        const focus = hero.position.clone().lerp(context.mothership.position, 0.4).add(V(0, 8, 0));
        frame(focus.clone().add(V(24, 14, 100 + t * 0.18)), focus, 54);
      } else {
        const special = context.special;
        if (special) {
          id += `-${special.owner}-${special.kind}`;
          const actor = special.owner === 'hero' ? hero : enemy;
          if (special.kind === 'missiles') {
            const opponent = special.owner === 'hero' ? context.enemyChest : context.heroChest;
            const facing = Math.sign(opponent.x - actor.position.x) || 1;
            const chest = special.owner === 'hero' ? context.heroChest : context.enemyChest;
            const muzzle = special.owner === 'hero' ? context.heroMuzzle : context.enemyMuzzle;
            if (special.time < RIFLE_SEQUENCE.sheath) {
              id += '-sheath'; frame(actor.localToWorld(V(-11, 14, -16)), chest.clone().add(V(0, 1, -1)), 48);
            } else if (special.time < RIFLE_SEQUENCE.ready) {
              id += '-draw'; const p = smooth(special.time, RIFLE_SEQUENCE.sheath, RIFLE_SEQUENCE.ready);
              frame(actor.localToWorld(V(-12 + p * 2, 14.5, -17 + p * 5)), chest, 53);
            } else {
              id += '-sight'; frame(muzzle.clone().add(V(-facing * 6, 2, 10)), muzzle.clone().lerp(opponent, 0.18), 53);
            }
          }
          else if (special.kind === 'orbitalCut') {
            id += '-eclipse-rend'; const orbit = cinematicProgress(special.time, 0, 1.25);
            frame(enemy.position.clone().add(V(-19 + orbit * 5, 12 + orbit * 3, 25 - orbit * 4)),
              context.enemyChest.clone().lerp(context.enemyBladeTip, 0.3 + orbit * 0.12), 51 - orbit * 4, -0.03);
          } else if (special.kind === 'verdict') {
            if (special.time < ENEMY_ATTACK_LEAPS.verdict.land) {
              id += '-retreat';
              frame(enemy.position.clone().add(V(-22, 9, 34)), enemy.position.clone().add(V(0, 8, 0)), 57, -0.015);
            } else {
              id += '-sword-tip';
              frame(context.enemyBladeTip.clone().add(V(-10, 2.5, 15)), context.enemyChest.clone().lerp(context.enemyBladeTip, 0.66), 49);
            }
          } else {
            id += '-poised'; const p = smooth(special.time, 0, 1.45);
            frame(actor.position.clone().add(V(15 - p * 4, 11 + p * 6, 28)),
              context.heroChest.clone().lerp(context.heroBladeTip, 0.3), 54);
          }
        } else frame(combat.position, combat.center, 54);
      }
      if (id !== shotId) {
        const firstShot = !shotId;
        lastPosition.copy(camera.position); lastRotation.copy(camera.quaternion);
        lastFov = camera.fov;
        const editorialCut = phase === 'finisher' && shotId.startsWith('finisher')
          && (id.endsWith('-behind') || id.endsWith('-empty-blade') || id.endsWith('-steel')
            || id.endsWith('-prime-face') || id.endsWith('-verdict-face') || id.endsWith('-sword-arm'))
          || phase === 'victory' && id.endsWith('-mothership');
        const locationCut = phase === 'rupture' && (id.endsWith('-brendan') || id.endsWith('-brendan-head-fire') || id.endsWith('-cockpit')
          || id.endsWith('-facility-core') || shotId.endsWith('-facility-core'))
          || phase === 'heroTransform' && id.endsWith('-forest-liftoff');
        shotId = id; transition = firstShot || reducedMotion || editorialCut || locationCut ? 1 : 0;
      }
      const transitionSeconds = phase === 'defeat' || (phase === 'rupture' && t >= PLANET_RUPTURE.forest) ? 0.65
        : phase === 'finisher' ? 0.16 : phase === 'ground' || phase === 'space' ? 0.28 : 0.32;
      transition = Math.min(1, transition + dt / transitionSeconds);
      if (transition < 1) {
        const blend = smooth(transition, 0, 1);
        position.lerpVectors(lastPosition, position.clone(), blend); rotation.slerpQuaternions(lastRotation, rotation.clone(), blend);
        fov = THREE.MathUtils.lerp(lastFov, fov, blend);
      } else if ((phase === 'ground' || phase === 'space') && !context.special && dt > 0) {
        const blend = 1 - Math.exp(-dt * 5);
        position.lerpVectors(camera.position, position.clone(), blend); rotation.slerpQuaternions(camera.quaternion, rotation.clone(), blend);
      }
      shake = Math.max(0, shake - dt * 2.1);
      if (!reducedMotion && shake > 0) position.add(V(Math.sin(context.time * 67) * shake, Math.cos(context.time * 79) * shake * 0.55, 0));
      camera.position.copy(position); camera.quaternion.copy(rotation); camera.fov = fov;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    },
    apply() {
      camera.position.copy(position); camera.quaternion.copy(rotation); camera.fov = fov;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    },
  };
}
