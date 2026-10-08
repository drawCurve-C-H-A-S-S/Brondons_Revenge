import type { FinisherBeat } from './mechDuel.js';
import type { MechPoseName } from './mechAnimation.js';
import type { FinalePhase } from './finaleDirector.js';

export const FINALE_START_X = 14;
export const RIFLE_SEQUENCE = Object.freeze({
  sheath: 0.45, draw: 0.8, ready: 1.4, cameraEnd: 1.48, fire: 2.05, lastShot: 2.61,
  return: 2.9, holstered: 3.5, swordDraw: 3.78, swordReady: 4.25,
});
export function sampleRifleSequence(time: number) {
  return {
    sheath: cinematicProgress(time, 0, RIFLE_SEQUENCE.sheath),
    draw: cinematicProgress(time, RIFLE_SEQUENCE.sheath, RIFLE_SEQUENCE.draw),
    shoulderToAim: cinematicProgress(time, RIFLE_SEQUENCE.draw, RIFLE_SEQUENCE.ready),
    returning: cinematicProgress(time, RIFLE_SEQUENCE.return, RIFLE_SEQUENCE.holstered),
    swordReturn: cinematicProgress(time, RIFLE_SEQUENCE.swordDraw, RIFLE_SEQUENCE.swordReady),
    firing: time >= RIFLE_SEQUENCE.fire && time <= RIFLE_SEQUENCE.lastShot + 0.12,
  };
}
export const HERO_ULTIMATE = Object.freeze({ cameraEnd: 1.45, release: 2.05, duration: 2.95, cooldown: 18 });
export const ENEMY_VERDICT = Object.freeze({ cameraEnd: 1.5, release: 2.12, duration: 3.15 });
export const ENEMY_ATTACK_LEAPS = Object.freeze({
  thrust: { takeoff: 0.12, land: 0.68, height: 3.4, distance: 12 },
  verdict: { takeoff: 0.08, land: 0.68, height: 3, distance: 12 },
});
export function sampleEnemyAttackLeap(move: keyof typeof ENEMY_ATTACK_LEAPS, time: number) {
  const leap = ENEMY_ATTACK_LEAPS[move];
  const progress = Math.max(0, Math.min(1, (time - leap.takeoff) / (leap.land - leap.takeoff)));
  return {
    progress: cinematicProgress(time, leap.takeoff, leap.land),
    lift: progress === 0 || progress === 1 ? 0 : Math.sin(progress * Math.PI) * leap.height,
  };
}
export const MECH_DODGE = Object.freeze({ duration: 0.48, distance: 14, crossDuration: 0.6, crossRange: 19, clearance: 9 });
export function sampleDodgeArc(time: number, duration: number, crossing: boolean) {
  const progress = Math.max(0, Math.min(1, time / duration));
  const arc = Math.sin(progress * Math.PI);
  return { progress: cinematicProgress(time, 0, duration), lane: crossing ? arc * 7 : 0,
    lift: arc * (crossing ? 3.2 : 0.8), roll: arc * (crossing ? 0.22 : 0.12) };
}
export const MELEE_STRIKES = Object.freeze({
  slash: { duration: 1.04, start: 0.34, end: 0.62 },
  sideSlash: { duration: 1.12, start: 0.25, end: 0.88 },
  cleave: { duration: 1.4, start: 0.6, end: 0.94 },
  thrust: { duration: 1.38, start: 0.72, end: 0.96 },
  reap: { duration: 1.7, start: 0.78, end: 1.1 },
});
export type MeleeStrike = keyof typeof MELEE_STRIKES;
export type CinematicPoint = [number, number, number];

export function isMeleeStrike(move: string): move is MeleeStrike {
  return Object.prototype.hasOwnProperty.call(MELEE_STRIKES, move);
}

const pointMix = (a: CinematicPoint, b: CinematicPoint, p: number): CinematicPoint =>
  [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const normalized = (point: CinematicPoint): CinematicPoint => {
  const length = Math.hypot(...point);
  return [point[0] / length, point[1] / length, point[2] / length];
};

// IK guides signature attacks; loaded rigs supply their sampled, hand-attached paths to combat.
export function sampleMeleeBlade(move: MeleeStrike, time: number) {
  const strike = MELEE_STRIKES[move];
  const wind = cinematicProgress(time, 0, strike.start);
  const swing = cinematicProgress(time, strike.start, strike.end);
  const recover = cinematicProgress(time, strike.end + 0.1, strike.duration);
  const rest: CinematicPoint = [-2.6, 8.6, 1.8];
  let grip: CinematicPoint, direction: CinematicPoint;
  if (move === 'slash' || move === 'cleave') {
    const angle = -0.3 + swing * 2.65;
    grip = pointMix(pointMix(rest, [-2, move === 'cleave' ? 14.8 : 14, 1.4], wind), [-2, 7.8, 4], swing);
    direction = [0.025, Math.cos(angle), Math.sin(angle)];
  } else if (move === 'thrust') {
    grip = pointMix(pointMix(rest, [-2.6, 10.4, -0.9], wind), [-0.8, 10.1, 5.2], swing);
    direction = [0.025, -0.035, 1];
  } else {
    const reverse = move === 'reap';
    const angle = reverse ? 1.15 - swing * 2.8 : -1.2 + swing * 2.4;
    grip = pointMix(pointMix(rest, reverse ? [3, 12, 1] : [-3.4, 10.1, 2], wind),
      reverse ? [-3.1, 6.8, 3.4] : [2.2, 9.8, 2.8], swing);
    direction = [Math.sin(angle), reverse ? 0.25 - swing * 0.58 : 0.035, Math.cos(angle)];
  }
  grip = pointMix(grip, rest, recover);
  direction = normalized(pointMix(direction, [-0.12, 0.86, 0.58], recover));
  const base = grip.map((value, axis) => value + direction[axis] * 0.9) as CinematicPoint;
  const tip = grip.map((value, axis) => value + direction[axis] * 12.7) as CinematicPoint;
  return { grip, direction, base, tip, active: time >= strike.start && time <= strike.end, swing };
}

export function sampleUltimateBlade(time: number) {
  const strike = MELEE_STRIKES.cleave;
  const poised = strike.start - 0.06;
  const releasePose = strike.start + (strike.end - strike.start) * 0.62;
  const bladeTime = time < HERO_ULTIMATE.cameraEnd
    ? poised * cinematicProgress(time, 0, HERO_ULTIMATE.cameraEnd)
    : poised + (releasePose - poised) * cinematicProgress(time, HERO_ULTIMATE.cameraEnd, HERO_ULTIMATE.release);
  return sampleMeleeBlade('cleave', time > HERO_ULTIMATE.release
    ? releasePose + (time - HERO_ULTIMATE.release) * 0.8 : bladeTime);
}
export const STUDENT_TIMELINE = Object.freeze(Array.from({ length: 5 }, (_, index) => ({
  reveal: { start: 8.2 + index * 2.6, end: 8.2 + (index + 1) * 2.6 },
  boarding: { start: 5.4 + index * 2.3, end: 5.4 + (index + 1) * 2.3 },
})));
export const HERO_TRANSFORM = Object.freeze({
  launch: 1.1, arrival: 6.2, disassemble: 6.4, materialize: 6.7, pilotMerge: 8.1,
  assembled: 11.8, sword: 12.2, lock: 14.2,
});
export const PLANET_RUPTURE = Object.freeze({
  jump: 0.85, land: 1.75, raise: 1.9, materialize: 2.45, release: 3.8, apex: 5.2,
  slam: 5.45, escape: 6.05, wide: 7.6, impact: 8.65, burst: 10.25,
  returnToDuel: 14.8, orbit: 18.8,
});
export const FINISHER_EXECUTION = Object.freeze({
  dash: 1.65, vanish: 2.7, gone: 2.95, appear: 3.2, materialized: 3.65,
  cuts: 4.25, lastCut: 6.25, collapse: 6.6,
});
export const DONUS_RETURN = Object.freeze({ appear: 9.2, arrival: 14 });

export function sampleRooftopNight(phase: FinalePhase, time: number) {
  if (phase === 'loading' || phase === 'error' || phase === 'reveal' || phase === 'enemyTransform') return 0;
  if (phase === 'heroTransform') return cinematicProgress(time, HERO_TRANSFORM.assembled, 17) * 0.55;
  if (phase === 'versus') return 0.55 + cinematicProgress(time, 0, 4.6) * 0.3;
  if (phase === 'ground') return 0.85 + cinematicProgress(time, 0, 8) * 0.15;
  return 1;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function cinematicProgress(time: number, start: number, end: number) {
  const p = clamp((time - start) / (end - start));
  return p * p * p * (p * (p * 6 - 15) + 10);
}

export function activeStudent(time: number, sequence: 'reveal' | 'boarding') {
  return STUDENT_TIMELINE.findIndex(timing => time >= timing[sequence].start && time < timing[sequence].end);
}

export function sampleStudentBoarding(index: number, time: number) {
  const timing = STUDENT_TIMELINE[index];
  if (!timing) throw new RangeError(`Unknown student index: ${index}`);
  const { start, end } = timing.boarding;
  const ascent = cinematicProgress(time, start + 0.25, start + 1.55);
  const merge = cinematicProgress(time, start + 1.5, start + 2.05);
  return {
    active: time >= start && time < end,
    visible: time < start + 2.05,
    ascent, merge, scale: 1 - merge * 0.98,
    beam: cinematicProgress(time, start, start + 0.25) * (1 - cinematicProgress(time, start + 1.95, end)),
  };
}

export function finisherBeatDuration(beat: FinisherBeat) {
  return beat.lead + beat.window + beat.resolve;
}

export function finisherActionTime(beat: FinisherBeat) {
  return beat.lead + beat.window * 0.72;
}

export function samplePlanetBreaker(time: number, origin: CinematicPoint, impact: CinematicPoint) {
  const apex: CinematicPoint = [origin[0] - 12, origin[1] + 260, origin[2] - 28];
  if (time <= PLANET_RUPTURE.release) return [...origin] as CinematicPoint;
  if (time < PLANET_RUPTURE.apex) return pointMix(origin, apex,
    1 - (1 - clamp((time - PLANET_RUPTURE.release) / (PLANET_RUPTURE.apex - PLANET_RUPTURE.release))) ** 2);
  const fall = clamp((time - PLANET_RUPTURE.slam) / (PLANET_RUPTURE.impact - PLANET_RUPTURE.slam));
  return pointMix(apex, impact, fall ** 2.2);
}

export function sampleFinisher(beat: FinisherBeat, clock: number) {
  const duration = finisherBeatDuration(beat), action = finisherActionTime(beat);
  const p = cinematicProgress(clock, 0, duration);
  const strike = cinematicProgress(clock, action - 0.3, action + Math.min(1.1, beat.resolve * 0.65));
  const sine = Math.sin(p * Math.PI);
  let hero: CinematicPoint = [-14, 0, 0];
  let enemy: CinematicPoint = [14, 1, -2];
  let heroPose: MechPoseName = 'idle', enemyPose: MechPoseName = 'idle';
  let heroRoll = 0, enemyRoll = 0;
  let heroYaw = 0, enemyYaw = 0, speed = 0;
  let heroPoseProgress = 0, enemyPoseProgress = 0;
  let heroDissolve = 0, heroCharge = 0, barrage = 0;
  let heroVisible = true;

  if (beat.shot === 'evade') {
    const dodge = cinematicProgress(clock, 0.7, action + 0.35);
    const settle = cinematicProgress(clock, action + 0.5, duration);
    hero = pointMix(pointMix([-14, 0, 0], [-16, -3.5, 8], dodge), [-12, 0, 3], settle);
    heroPose = 'evade'; enemyPose = 'verdict';
    heroRoll = -Math.sin(dodge * Math.PI / 2) * (1 - settle) * 0.62;
    heroPoseProgress = p; enemyPoseProgress = Math.min(1, clock / 2.8);
  } else if (beat.shot === 'missileCut') {
    hero = pointMix([-12, 0, 3], [-10, 2, 2], p);
    enemy = pointMix([14, 1, -2], [14, 2, -2], p);
    heroPose = 'sideSlash'; enemyPose = 'verdict';
    heroPoseProgress = strike; enemyPoseProgress = 0.55 + p * 0.4;
  } else if (beat.shot === 'countershot') {
    hero = [-10, 2, 2]; enemy = pointMix([14, 2, -2], [12, 2, -2], strike);
    heroPose = 'missiles'; enemyPose = clock > RIFLE_SEQUENCE.fire + 0.4 ? 'stagger' : 'guard';
    heroPoseProgress = Math.min(1, clock / RIFLE_SEQUENCE.swordReady);
    enemyPoseProgress = clock < RIFLE_SEQUENCE.lastShot + 0.65
      ? clamp((clock - RIFLE_SEQUENCE.fire - 0.4) % 0.24 / 0.24) * 0.8 : cinematicProgress(clock, RIFLE_SEQUENCE.lastShot + 0.65, duration);
    enemy[2] -= Math.sin(strike * Math.PI) * 1.8;
    enemyRoll = Math.sin(strike * Math.PI) * 0.16;
  } else if (beat.shot === 'boost') {
    hero = pointMix([-10, 2, 2], [-5.9, 0, 0], p);
    enemy = pointMix([12, 2, -2], [5.9, 0, 0], p);
    hero[1] += sine * 2;
    heroPose = p > 0.75 ? 'clash' : 'boost'; enemyPose = p > 0.75 ? 'clash' : 'thrust';
    heroPoseProgress = p; enemyPoseProgress = p * 0.45;
    speed = sine * 0.3;
  } else if (beat.shot === 'clash') {
    hero = pointMix([-5.9, 0, 0], [-6, 0, 0], strike);
    enemy = pointMix([5.9, 0, 0], [6.3, 0, 0], strike);
    heroPose = strike > 0.25 ? 'sideSlash' : 'clash'; enemyPose = strike > 0.25 ? 'stagger' : 'clash';
    heroPoseProgress = strike; enemyPoseProgress = strike;
    const pressure = sine * (1 - strike);
    hero[0] += pressure * 0.42; enemy[0] += pressure * 0.28;
    heroRoll = -pressure * 0.07; enemyRoll = pressure * 0.09;
  } else if (beat.shot === 'armCut') {
    hero = pointMix([-6, 0, 0], [-3, 3, 1], p);
    enemy = pointMix([6.3, 0, 0], [6, 0, 0], p);
    heroPose = 'slash'; enemyPose = strike > 0.45 ? 'stagger' : 'guard';
    heroPoseProgress = strike; enemyPoseProgress = strike;
    enemy[0] += Math.sin(strike * Math.PI) * 1.4;
    enemyRoll = Math.sin(strike * Math.PI) * 0.2;
  } else if (beat.shot === 'ascend') {
    hero = pointMix([-3, 3, 1], [-9, 16, -2], p); enemy = [6, 0, 0];
    heroPose = 'boost'; enemyPose = 'verdict';
    heroPoseProgress = p; enemyPoseProgress = 0.2 + p * 0.5;
    heroRoll = -sine * 0.16;
  } else if (beat.shot === 'reactor') {
    hero = [-9, 16, -2]; enemy = [6, 0, 0];
    heroPose = 'skyCharge'; enemyPose = clock < 2.7 ? 'verdict' : 'guard';
    heroPoseProgress = p; enemyPoseProgress = clock < 2.7 ? clock / 2.7 : (clock - 2.7) / (duration - 2.7);
    heroCharge = cinematicProgress(clock, 0, duration - 0.2);
    hero[2] -= sine * 1.1; enemy[0] += sine * 0.6;
    enemyRoll = sine * 0.08;
  } else if (beat.shot === 'finalCut') {
    const timing = FINISHER_EXECUTION;
    const charge = cinematicProgress(clock, timing.dash, timing.vanish);
    const arrival = cinematicProgress(clock, timing.appear, timing.cuts - 0.15);
    const counter = cinematicProgress(clock, timing.dash + 0.35, timing.gone);
    const recover = cinematicProgress(clock, timing.appear, timing.cuts);
    hero = clock < timing.appear ? pointMix([-9, 16, -2], [-1, 1, -1], charge ** 1.7)
      : pointMix([17, 1.2, 2.5], [15, 0, 1], arrival);
    enemy = [6 - counter * 2.2 * (1 - recover), -Math.sin(counter * Math.PI) * 0.45, 0];
    heroPose = clock < timing.dash ? 'skyCharge' : clock < timing.appear ? 'boost'
      : clock < timing.materialized ? 'sideSlash' : 'afterCut';
    heroPoseProgress = clock < timing.dash ? 0.88 + cinematicProgress(clock, 0, timing.dash) * 0.12
      : clock < timing.appear ? 0.2 + charge * 0.55
        : clock < timing.materialized ? 0.68 + cinematicProgress(clock, timing.appear, timing.materialized) * 0.3
          : cinematicProgress(clock, timing.materialized, timing.lastCut);
    heroDissolve = clock < timing.appear ? cinematicProgress(clock, timing.vanish, timing.gone)
      : 1 - cinematicProgress(clock, timing.appear, timing.materialized);
    heroVisible = clock < timing.gone || clock >= timing.appear;
    heroCharge = clock < timing.vanish ? 1 : 0;
    barrage = cinematicProgress(clock, timing.cuts, timing.lastCut);
    heroRoll = clock < timing.appear ? -Math.sin(charge * Math.PI) * 0.38 : (1 - arrival) * 0.18;
    heroYaw = clock >= timing.materialized ? cinematicProgress(clock, timing.materialized, timing.cuts) * 0.12 : 0;
    enemyYaw = recover * -0.5 * (1 - barrage);
    speed = clock >= timing.dash && clock < timing.gone ? 0.18 + charge * 0.24
      : clock >= timing.cuts && clock < timing.lastCut ? 0.16 + Math.sin(barrage * Math.PI) * 0.16 : 0;
    enemyPose = clock >= timing.collapse ? 'defeat' : clock >= timing.cuts ? 'stagger'
      : clock >= timing.dash && clock < timing.cuts - 0.25 ? 'thrust' : 'guard';
    enemyPoseProgress = clock >= timing.collapse ? cinematicProgress(clock, timing.collapse, duration)
      : clock >= timing.cuts ? 0.45 + Math.sin((clock - timing.cuts) * 24) * 0.16 + barrage * 0.2
        : Math.min(0.98, counter * 0.8 + recover * 0.18);
    const recoil = clock >= timing.cuts && clock < timing.collapse
      ? Math.sin((clock - timing.cuts) * 24) * (0.09 + barrage * 0.05) : 0;
    enemyRoll = recoil - cinematicProgress(clock, timing.collapse, duration) * 0.25;
    enemy[0] += recoil * 2; enemy[1] += barrage * 0.8; enemy[2] += recoil * 3;
  }
  hero[1] += sine * 0.12; enemy[1] += sine * 0.16;
  return { hero, enemy, heroPose, enemyPose, heroRoll, enemyRoll, heroYaw, enemyYaw, heroPoseProgress, enemyPoseProgress,
    heroDissolve, heroVisible, heroCharge, barrage, speed, progress: p };
}
