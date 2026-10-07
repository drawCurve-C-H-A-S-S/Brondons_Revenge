import * as THREE from 'three';
import type { FinalePhase } from '../../scripts/finaleDirector.js';
import type { MechSide, FinisherBeat } from '../../scripts/mechDuel.js';
import { FINALE_DECK_Y, FINALE_ROOFTOP, PLANET_CENTER } from './finaleWorld.js';
import { HERO_TRANSFORM, PLANET_RUPTURE, RIFLE_SEQUENCE, activeStudent } from '../../scripts/finaleChoreography.js';

export interface FinaleCameraContext {
  phase: FinalePhase; phaseTime: number; time: number; space: boolean;
  hero: THREE.Object3D; enemy: THREE.Object3D; human: THREE.Vector3; students: readonly THREE.Object3D[];
  ship: THREE.Object3D; bomb: THREE.Vector3; heroChest: THREE.Vector3; enemyChest: THREE.Vector3;
  heroMuzzle: THREE.Vector3; enemyMuzzle: THREE.Vector3; clash: THREE.Vector3;
  special: { owner: MechSide; kind: 'missiles' | 'overdrive' | 'impact'; time: number; duration: number } | null;
  qte: { beat: FinisherBeat; clock: number; resolveTime: number; progress: number };
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smootherstep;
const local = (x: number, y: number, z: number) =>
  V(FINALE_ROOFTOP.x + x, FINALE_DECK_Y + y, FINALE_ROOFTOP.z + z);

export function createFinaleCamera(camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
  const position = camera.position.clone(), target = new THREE.Vector3(), rotation = camera.quaternion.clone();
  const desired = new THREE.PerspectiveCamera(), lastPosition = position.clone(), lastRotation = rotation.clone();
  let shotId = '', transition = 1, shake = 0, fov = camera.fov;
  function duelView(context: FinaleCameraContext) {
    const center = context.hero.position.clone().lerp(context.enemy.position, 0.5).add(V(0, 8, 0));
    const gap = Math.abs(context.enemy.position.x - context.hero.position.x) + 16;
    const height = 28 + Math.abs(context.enemy.position.y - context.hero.position.y);
    const angle = THREE.MathUtils.degToRad(56 / 2);
    const horizontalDistance = gap / (Math.max(0.5, camera.aspect) * 2 * Math.tan(angle));
    const verticalDistance = height / (2 * Math.tan(angle));
    const distance = Math.max(36, horizontalDistance, verticalDistance) * 1.04;
    const orbit = reducedMotion ? 0 : Math.sin(context.time * 0.22) * 4.5;
    return { center, position: center.clone().add(V(distance * 0.16 + orbit, distance * 0.35, distance)) };
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
        if (t < PLANET_RUPTURE.release) {
          id += '-breaker'; frame(context.bomb.clone().add(V(-12, 2, 16)), context.bomb, 52, -0.035);
        } else if (t < PLANET_RUPTURE.wide) {
          id += '-bomb-drop'; const p = smooth(t, PLANET_RUPTURE.release, PLANET_RUPTURE.wide);
          frame(context.bomb.clone().add(V(-18 - p * 25, 11 + p * 8, 33 + p * 30)), context.bomb, 58 + p * 6, 0.04);
        } else if (t < PLANET_RUPTURE.returnToDuel) {
          id += '-planet'; const p = smooth(t, PLANET_RUPTURE.wide, PLANET_RUPTURE.returnToDuel);
          frame(PLANET_CENTER.clone().add(V(600 + p * 100, 380 + p * 100, 900)), PLANET_CENTER.clone().add(V(0, 35, 0)), 45, -0.018);
        } else {
          id += '-orbit'; const p = smooth(t, PLANET_RUPTURE.returnToDuel, 16);
          const start = PLANET_CENTER.clone().add(V(700, 480, 900));
          frame(start.lerp(combat.position, p), PLANET_CENTER.clone().add(V(0, 35, 0)).lerp(combat.center, p), 45 + p * 6);
        }
      } else if (phase === 'finisher') {
        const { beat, clock, resolveTime, progress } = context.qte;
        const p = resolveTime >= 0 ? smooth(resolveTime, 0, beat.resolve) : 0;
        id += `-${beat.shot}-${resolveTime >= 0 ? 'resolve' : 'prompt'}`;
        const center = hero.position.clone().lerp(enemy.position, 0.5).add(V(0, 9, 0));
        if (beat.shot === 'evade') {
          if (resolveTime < 0) {
            const lead = smooth(clock, 0, beat.lead);
            frame(context.enemyMuzzle.clone().add(V(-4 - lead * 4, 2, 9)), context.heroChest, 56, -0.035);
          } else frame(context.heroChest.clone().add(V(-8 + p * 15, 2 + p * 5, 17)), context.heroChest, 58, -Math.sin(p * Math.PI) * 0.12);
        }
        else if (beat.shot === 'missileCut') frame(hero.position.clone().add(V(-10 + p * 18, 12, 31)), center, 58, p * 0.04);
        else if (beat.shot === 'countershot') {
          const focus = resolveTime >= 0 && p > 0.28 ? context.enemyChest : context.heroMuzzle;
          frame(focus.clone().add(V(-9 + p * 15, 2 + p * 3, 16 + p * 3)), focus, 51, -0.02);
        }
        else if (beat.shot === 'boost') frame(hero.position.clone().add(V(-7, 1.5 - p * 5, 27)), hero.position.clone().add(V(5, 7, -4)), 65, p * 0.05);
        else if (beat.shot === 'clash') {
          if (resolveTime < 0) frame(context.clash.clone().add(V(-2.5, 1.5, 11 - progress * 2.2)),
            context.clash, 45, reducedMotion ? 0 : Math.sin(clock * 17) * progress * 0.014);
          else frame(context.clash.clone().add(V(-4 + p * 10, 2 + p * 4, 10 + p * 23)), center.clone().lerp(context.clash, 1 - p), 52 + p * 7);
        }
        else if (beat.shot === 'armCut') frame(enemy.position.clone().add(V(-18 + p * 30, 12, 24)), enemy.position.clone().add(V(0, 9, 0)), 56, p * 0.08);
        else if (beat.shot === 'ascend') frame(hero.position.clone().add(V(6, -8, 27)), hero.position.clone().add(V(0, 10, 0)), 62);
        else if (beat.shot === 'reactor' && resolveTime < 0) frame(hero.position.clone().add(V(4.8, 0.8, 10)), hero.position.clone().add(V(0, 8, 0)), 46);
        else frame(center.clone().add(V(-24 + p * 42, 12 + p * 9, 36 - p * 8)), center, beat.shot === 'finalCut' ? 62 : 56, -p * 0.06);
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
        } else if (t < 12) {
          id += '-survivor'; frame(hero.position.clone().add(V(4.6, 0.35, 8)), hero.position.clone().add(V(0, 8, 0)), 44);
        } else {
          id += '-end'; frame(hero.position.clone().add(V(23 + (t - 12) * 2, 12, 47)), hero.position.clone().add(V(0, 9, 0)), 54);
        }
      } else if (phase === 'credits' || phase === 'done') {
        frame(hero.position.clone().add(V(34, 15, 72 + t * 0.18)), hero.position.clone().add(V(0, 8, 0)), 54);
      } else {
        const special = context.special;
        if (special && !reducedMotion) {
          id += `-${special.owner}-${special.kind}`;
          const actor = special.owner === 'hero' ? hero : enemy;
          if (special.kind === 'missiles') {
            const owner = special.owner === 'hero' ? 1 : -1;
            const chest = special.owner === 'hero' ? context.heroChest : context.enemyChest;
            const muzzle = special.owner === 'hero' ? context.heroMuzzle : context.enemyMuzzle;
            if (special.time < RIFLE_SEQUENCE.ready) {
              id += '-draw'; const p = smooth(special.time, 0, RIFLE_SEQUENCE.ready);
              frame(chest.clone().add(V(owner * (9 - p * 3), 2.5, -12)), chest.clone().add(V(0, 1, -1)), 55);
            } else if (special.time < RIFLE_SEQUENCE.return) {
              id += '-fire'; const p = smooth(special.time, RIFLE_SEQUENCE.ready, RIFLE_SEQUENCE.return);
              const victim = special.owner === 'hero' ? context.enemyChest : context.heroChest;
              frame(muzzle.clone().add(V(-owner * 6, 2, 10 + p * 4)), muzzle.clone().lerp(victim, 0.26 + p * 0.3), 60, owner * -0.025);
            } else {
              id += '-stow'; frame(chest.clone().add(V(owner * 8, 4, 15)), chest, 55);
            }
          }
          else if (special.kind === 'impact') frame(enemy.position.clone().add(V(-12, 6, 26)), enemy.position.clone().add(V(0, 8, 0)), 58);
          else if (special.time < 0.85) {
            id += '-charge'; frame(actor.position.clone().add(V(special.owner === 'hero' ? 14 : -14, 9, 23)), actor.position.clone().add(V(0, 10, 0)), 57);
          } else {
            id += '-strike'; const p = smooth(special.time, 0.85, special.duration);
            frame(combat.center.clone().add(V(Math.cos(p * Math.PI) * 22, 5 + Math.sin(p * Math.PI) * 10, 34 - p * 8)), combat.center, 60, Math.sin(p * Math.PI) * 0.04);
          }
        } else frame(combat.position, combat.center, 51);
      }
      if (id !== shotId) {
        lastPosition.copy(camera.position); lastRotation.copy(camera.quaternion);
        shotId = id; transition = reducedMotion ? 1 : 0;
      }
      transition = Math.min(1, transition + dt / (phase === 'ground' || phase === 'space' ? 0.22 : 0.32));
      if (transition < 1) {
        const blend = smooth(transition, 0, 1);
        position.lerpVectors(lastPosition, position.clone(), blend); rotation.slerpQuaternions(lastRotation, rotation.clone(), blend);
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
