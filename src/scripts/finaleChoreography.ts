import type { FinisherBeat } from './mechDuel.js';
import type { MechPoseName } from './mechAnimation.js';

export const FINALE_START_X = 14;
export const RIFLE_SEQUENCE = Object.freeze({
  draw: 0.3, ready: 0.9, fire: 1.05, lastShot: 1.61, return: 1.9, holstered: 2.35, swordReady: 2.85,
});
export function sampleRifleSequence(time: number) {
  return {
    draw: cinematicProgress(time, 0, RIFLE_SEQUENCE.draw),
    shoulderToAim: cinematicProgress(time, RIFLE_SEQUENCE.draw, RIFLE_SEQUENCE.ready),
    returning: cinematicProgress(time, RIFLE_SEQUENCE.return, RIFLE_SEQUENCE.holstered),
    swordReturn: cinematicProgress(time, RIFLE_SEQUENCE.holstered, RIFLE_SEQUENCE.swordReady),
    firing: time >= RIFLE_SEQUENCE.fire && time <= RIFLE_SEQUENCE.lastShot + 0.12,
  };
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
  raise: 0.8, release: 2.4, escape: 3.1, impact: 5.6, wide: 5.9, burst: 8.2,
  returnToDuel: 11.7, orbit: 15.5,
});

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

export function sampleFinisher(beat: FinisherBeat, clock: number, resolveTime: number) {
  const resolving = resolveTime >= 0;
  const p = resolving ? cinematicProgress(resolveTime, 0, beat.resolve) : 0;
  const lead = cinematicProgress(clock, 0, beat.lead);
  const sine = Math.sin(p * Math.PI);
  let hero: [number, number, number] = [-12, 0, 0];
  let enemy: [number, number, number] = [12, 0, 0];
  let heroPose: MechPoseName = 'idle', enemyPose: MechPoseName = 'idle';
  let heroRoll = 0, enemyRoll = 0;
  let heroPoseProgress = 0, enemyPoseProgress = 0;

  if (beat.shot === 'evade') {
    hero = [-12 - sine * 4, -sine * 3.5, sine * 7];
    enemy = [12, 1, -2];
    heroPose = 'evade'; enemyPose = 'missiles';
    heroRoll = -sine * 0.62;
    heroPoseProgress = p; enemyPoseProgress = 0.24 + lead * 0.35;
  } else if (beat.shot === 'missileCut') {
    hero = [-11 + sine * 3.5, sine * 2, sine * 1.5];
    enemy = [12, 2, -2];
    heroPose = 'slash'; enemyPose = 'missiles';
    heroPoseProgress = 0.24 + p * 0.76; enemyPoseProgress = 0.45;
  } else if (beat.shot === 'countershot') {
    hero = [-10, 3, 3];
    enemy = [11 + p * 4, 3 - p * 2, -2];
    heroPose = 'missiles'; enemyPose = p > 0.3 ? 'stagger' : 'guard';
    heroPoseProgress = resolving ? 0.24 + p * 0.65 : lead * 0.24;
    enemyPoseProgress = p;
  } else if (beat.shot === 'boost') {
    hero = [-14 + (resolving ? p : lead * 0.1) * 7, sine * 3, 2 - p * 2];
    enemy = [7, 1, 0];
    heroPose = 'boost'; enemyPose = 'cleave';
    heroPoseProgress = resolving ? p : 0.18 + lead * 0.18;
    enemyPoseProgress = 0.28;
  } else if (beat.shot === 'clash') {
    hero = [-6.4 + p * 1.2, 0, 0];
    enemy = [6.4 + p * 4, p * 2, 0];
    heroPose = resolving ? 'slash' : 'clash';
    enemyPose = resolving ? 'stagger' : 'clash';
    heroPoseProgress = resolving ? 0.3 + p * 0.7 : (clock % 1) * 0.35 + 0.25;
    enemyPoseProgress = resolving ? p : (clock % 1) * 0.35 + 0.25;
  } else if (beat.shot === 'armCut') {
    hero = [-6 + p * 13, sine * 2, -sine * 2];
    enemy = [6 + p * 1.5, 0, 0];
    heroPose = 'slash'; enemyPose = p > 0.42 ? 'stagger' : 'guard';
    heroPoseProgress = 0.25 + p * 0.75; enemyPoseProgress = p;
  } else if (beat.shot === 'ascend') {
    hero = [1 - p * 6, 4 + p * 18, 2 - p * 4];
    enemy = [6, 0, 0];
    heroPose = 'boost'; enemyPose = 'reactor';
    heroPoseProgress = resolving ? p : 0.18;
    enemyPoseProgress = resolving ? p : 0.25 + lead * 0.25;
    heroRoll = -sine * 0.16;
  } else if (beat.shot === 'reactor') {
    hero = [-5, 20 + sine * 2, -2];
    enemy = [7, 0, 0];
    heroPose = 'reactor'; enemyPose = 'stagger';
    heroPoseProgress = resolving ? 0.58 + p * 0.42 : 0.18 + lead * 0.4;
    enemyPoseProgress = resolving ? p : 0.2;
  } else if (beat.shot === 'finalCut') {
    hero = [-9 + p * 24, 22 * (1 - p), -2 + sine * 3];
    enemy = [4, 0, 0];
    heroPose = 'cleave'; enemyPose = p > 0.43 ? 'defeat' : 'guard';
    heroPoseProgress = 0.3 + p * 0.7;
    enemyPoseProgress = Math.max(0, (p - 0.43) / 0.57);
    heroRoll = sine * 0.16; enemyRoll = p > 0.43 ? -(p - 0.43) * 0.3 : 0;
  }
  return { hero, enemy, heroPose, enemyPose, heroRoll, enemyRoll, heroPoseProgress, enemyPoseProgress, resolving, progress: p };
}
