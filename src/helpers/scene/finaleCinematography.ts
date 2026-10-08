import * as THREE from 'three';
import type { FinalePhase } from '../../scripts/finaleDirector.js';
import type { MechSide, FinisherBeat } from '../../scripts/mechDuel.js';
import { FINALE_DECK_Y, FINALE_ROOFTOP, PLANET_CENTER } from './finaleWorld.js';
import {
  HERO_TRANSFORM, PLANET_RUPTURE, RIFLE_SEQUENCE, FINISHER_EXECUTION, DONUS_RETURN,
  activeStudent, cinematicProgress, finisherActionTime, finisherBeatDuration, ENEMY_ATTACK_LEAPS,
} from '../../scripts/finaleChoreography.js';

export interface FinaleCameraContext {
  phase: FinalePhase; phaseTime: number; time: number; space: boolean;
  hero: THREE.Object3D; enemy: THREE.Object3D; human: THREE.Vector3; students: readonly THREE.Object3D[];
  ship: THREE.Object3D; mothership: THREE.Object3D; bomb: THREE.Vector3; heroChest: THREE.Vector3; enemyChest: THREE.Vector3;
  heroMuzzle: THREE.Vector3; enemyMuzzle: THREE.Vector3; clash: THREE.Vector3;
  heroBladeBase: THREE.Vector3; heroBladeTip: THREE.Vector3; enemyBladeTip: THREE.Vector3;
  special: { owner: MechSide; kind: 'missiles' | 'overdrive' | 'verdict'; time: number; duration: number } | null;
  qte: { beat: FinisherBeat; clock: number };
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
        } else if (t < 8.2) {
          id += '-accusation'; frame(local(-1.4, 1.7, 3.4), local(0, 1.4, -3.5), 54);
        } else if (t < 21.2) {
          const index = activeStudent(t, 'reveal');
          id += `-student-${index}`;
          const actor = context.students[index], focus = actor?.position.clone().add(V(0, 1.45, 0)) ?? V(0, 1.45, -3.5);
          const drift = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.25;
          frame(focus.clone().add(V(index % 2 ? -1.7 + drift : 1.7 + drift, 0.12, 3.6)), focus, 39);
        } else if (t < 24.3) {
          id += '-signature'; frame(local(0, 0.85, 6), local(0, 1.2, -3.5), 57, 0.018);
        } else {
          id += '-crane'; const p = smooth(t, 24.3, 27);
          frame(local(-5 + p * 9, 3 + p * 2.3, 8 + p * 2), local(0, 1.25, -3.5), 58);
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
        if (t < PLANET_RUPTURE.raise) {
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
        } else if (t < PLANET_RUPTURE.returnToDuel) {
          id += '-planet'; const p = smooth(t, PLANET_RUPTURE.wide, PLANET_RUPTURE.returnToDuel);
          frame(PLANET_CENTER.clone().add(V(600 + p * 70, 480 + p * 45, 1000 + p * 25)),
            PLANET_CENTER.clone().add(V(0, 95, 0)), 46, -0.012);
        } else {
          id += '-orbit'; const p = smooth(t, PLANET_RUPTURE.returnToDuel, 19.2);
          const start = PLANET_CENTER.clone().add(V(670, 525, 1025));
          frame(start.lerp(combat.position, p), PLANET_CENTER.clone().add(V(0, 95, 0)).lerp(combat.center, p), 46 + p * 8);
        }
      } else if (phase === 'finisher') {
        const { beat, clock } = context.qte;
        const action = finisherActionTime(beat), duration = finisherBeatDuration(beat);
        const p = cinematicProgress(clock, 0, duration);
        const strike = cinematicProgress(clock, action - 0.25, action + 1);
        id += `-${beat.shot}`;
        const center = hero.position.clone().lerp(enemy.position, 0.5).add(V(0, 9, 0));
        if (beat.shot === 'evade') {
          if (clock < 0.8) {
            id += '-threat'; frame(context.enemyBladeTip.clone().add(V(-6, 2, 12)), context.heroChest, 56, -0.025);
          } else {
            id += '-evade'; frame(context.heroChest.clone().add(V(-12 + p * 18, 3 + p * 4, 24)), context.heroChest, 58, -Math.sin(p * Math.PI) * 0.08);
          }
        }
        else if (beat.shot === 'missileCut') {
          frame(hero.position.clone().add(V(-7 + p * 3, 10, 30 - p * 3)), context.heroChest.clone().lerp(center, 0.25), 53, -0.018);
        }
        else if (beat.shot === 'countershot') {
          if (clock < RIFLE_SEQUENCE.draw) {
            id += '-sheath'; frame(hero.localToWorld(V(-11, 14, -16)), context.heroChest.clone().add(V(0, 1, -1)), 48);
          } else if (clock < RIFLE_SEQUENCE.fire) {
            id += '-sight'; frame(hero.localToWorld(V(-10, 13, -12)), context.heroMuzzle.clone().lerp(context.enemyChest, 0.15), 54);
          } else {
            id += '-impact'; frame(center.clone().add(V(-3, 4, 39)), center, 51, -0.012);
          }
        }
        else if (beat.shot === 'boost') frame(hero.position.clone().add(V(-9, 4, 30 - p * 5)),
          context.heroChest.clone().lerp(context.enemyChest, 0.32), 59, -Math.sin(p * Math.PI) * 0.035);
        else if (beat.shot === 'clash') {
          if (clock < action + 0.2) {
            id += '-lock'; frame(context.clash.clone().add(V(-3 + p * 2, 2, 25 - p * 2)),
              context.clash.clone().lerp(center, 0.2), 46);
          } else {
            id += '-break'; frame(center.clone().add(V(-8 + strike * 2, 3, 31)), center, 53);
          }
        }
        else if (beat.shot === 'armCut') frame(center.clone().add(V(-5 + p * 4, 5, 29)),
          context.enemyChest.clone().lerp(context.heroChest, 0.32), 53, -Math.sin(p * Math.PI) * 0.035);
        else if (beat.shot === 'ascend') frame(hero.position.clone().add(V(5, -4, 32)),
          context.heroChest.clone().lerp(context.enemyChest, 0.15), 59);
        else if (beat.shot === 'reactor') {
          if (clock < 0.9) {
            id += '-resolve'; frame(hero.position.clone().add(V(11, 14, 15)), context.heroChest.clone().add(V(0, 3, 0)), 44);
          } else {
            id += '-skyward'; const rise = cinematicProgress(clock, 0.9, duration);
            frame(hero.position.clone().add(V(12 - rise * 3, 8 + rise * 8, 33)),
              context.heroChest.clone().lerp(context.heroBladeTip, 0.46), 53, -0.012);
          }
        } else if (beat.shot === 'finalCut') {
          const timing = FINISHER_EXECUTION;
          if (clock < 0.65) {
            id += '-resolve'; const push = cinematicProgress(clock, 0, 0.65);
            frame(hero.localToWorld(V(-9 + push, 15, 13 - push * 2)), context.heroChest.clone().add(V(0, 3.5, 0)), 40 - push * 3);
          } else if (clock < timing.dash) {
            id += '-skyward'; const rise = cinematicProgress(clock, 0.65, timing.dash);
            frame(hero.position.clone().add(V(15 - rise * 6, 5 + rise * 16, 31)),
              context.heroChest.clone().lerp(context.heroBladeTip, 0.42 + rise * 0.1), 55 - rise * 4, -0.025);
          } else if (clock < timing.dash + 0.65) {
            id += '-dive'; const rush = cinematicProgress(clock, timing.dash, timing.dash + 0.65);
            frame(context.heroChest.clone().add(V(-16 + rush * 5, 9 - rush * 7, 28 - rush * 7)),
              context.heroChest.clone().lerp(context.enemyChest, 0.3), 54 + rush * 10, -rush * 0.1);
          } else if (clock < timing.vanish) {
            id += '-intercept';
            frame(enemy.localToWorld(V(11, 12, -16)), context.heroChest.clone().lerp(context.enemyChest, 0.22), 60, 0.035);
          } else if (clock < timing.appear) {
            id += '-empty-blade'; const drift = cinematicProgress(clock, timing.vanish, timing.appear);
            frame(context.enemyChest.clone().add(V(-13 + drift * 3, 2, 19)),
              context.enemyChest.clone().lerp(context.enemyBladeTip, 0.35), 49, 0.02);
          } else if (clock < timing.materialized) {
            id += '-behind'; const reveal = cinematicProgress(clock, timing.appear, timing.materialized);
            frame(hero.position.clone().add(V(10 - reveal * 3, 6 + reveal * 2, 22)),
              context.heroChest.clone().lerp(context.enemyChest, 0.35), 51 - reveal * 3, -0.02);
          } else if (clock < timing.cuts) {
            id += '-recognition'; const hold = cinematicProgress(clock, timing.materialized, timing.cuts);
            frame(context.enemyChest.clone().add(V(8 + hold * 3, 1.5, 19)),
              context.enemyChest.clone().lerp(context.heroChest, 0.27), 42 - hold * 2);
          } else if (clock < timing.cuts + 0.9) {
            id += '-execution-orbit'; const arc = cinematicProgress(clock, timing.cuts, timing.cuts + 0.9);
            const angle = -0.65 + arc * 1.15;
            frame(context.enemyChest.clone().add(V(Math.sin(angle) * 29, 4 - arc * 5, Math.cos(angle) * 29)),
              context.enemyChest, 54, (arc - 0.5) * 0.11);
          } else if (clock < timing.lastCut) {
            id += '-execution-impact'; const push = cinematicProgress(clock, timing.cuts + 0.9, timing.lastCut);
            frame(context.enemyChest.clone().add(V(-14 + push * 3, -1 + push * 4, 24 - push * 3)),
              context.enemyChest.clone().add(V(0, 1, 0)), 50 - push * 5, -0.045);
          } else if (clock < timing.collapse) {
            id += '-blade-falls';
            frame(hero.position.clone().add(V(12, 5, 20)), context.heroChest.clone().lerp(context.enemyChest, 0.25), 48, 0.02);
          } else {
            id += '-aftermath'; const pull = cinematicProgress(clock, timing.collapse, duration);
            frame(center.clone().add(V(-17 - pull * 13, 8 + pull * 9, 34 + pull * 17)), center, 55 + pull * 5);
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
        if (t < 6) {
          id += '-last-cut'; frame(enemy.position.clone().add(V(-18 + t * 3, 9 + t, 31)), enemy.position.clone().add(V(0, 8, 0)), 59, -0.02);
        } else if (t < DONUS_RETURN.appear) {
          id += '-survivor'; frame(hero.position.clone().add(V(4.6, 0.35, 8)), hero.position.clone().add(V(0, 8, 0)), 44);
        } else if (t < DONUS_RETURN.arrival) {
          id += '-mothership'; frame(hero.position.clone().add(V(40, 24, 85)), hero.position.clone().add(V(12, 10, 0)), 57);
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
          else if (special.kind === 'verdict') {
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
        lastPosition.copy(camera.position); lastRotation.copy(camera.quaternion);
        lastFov = camera.fov;
        const editorialCut = phase === 'finisher' || (context.special !== null && shotId.startsWith(phase));
        shotId = id; transition = reducedMotion || editorialCut ? 1 : 0;
      }
      transition = Math.min(1, transition + dt / (phase === 'ground' || phase === 'space' ? 0.22 : 0.32));
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
