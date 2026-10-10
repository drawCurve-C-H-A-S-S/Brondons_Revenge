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
export const ENEMY_ORBITAL_CUT = Object.freeze({ cameraEnd: 1.25, release: 1.9, cross: 2.4, duration: 3.5 });
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
export function sampleDodgeArc(time: number, duration: number, crossing: boolean, offset = { lane: 0, lift: 0, roll: 0 }) {
  const progress = Math.max(0, Math.min(1, time / duration));
  const arc = Math.sin(progress * Math.PI);
  const eased = cinematicProgress(time, 0, duration), carry = 1 - eased;
  return { progress: eased, lane: (crossing ? arc * 7 : 0) + offset.lane * carry,
    lift: arc * (crossing ? 3.2 : 0.8) + offset.lift * carry,
    roll: arc * (crossing ? 0.22 : 0.12) + offset.roll * carry };
}
export const MELEE_STRIKES = Object.freeze({
  slash: { duration: 1.04, start: 0.34, end: 0.62 },
  sideSlash: { duration: 1.12, start: 0.25, end: 0.88 },
  cleave: { duration: 1.4, start: 0.6, end: 0.94 },
  thrust: { duration: 1.38, start: 0.72, end: 0.96 },
  reap: { duration: 1.7, start: 0.78, end: 1.1 },
  orbitalCut: { duration: ENEMY_ORBITAL_CUT.duration, start: ENEMY_ORBITAL_CUT.release, end: 2.65 },
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
  } else if (move === 'orbitalCut') {
    const angle = -1.75 + swing * Math.PI * 1.65;
    grip = pointMix(pointMix(rest, [-2.4, 13.6, 0.6], wind), [1.8, 9.2, 3.6], swing);
    direction = [Math.sin(angle), 0.18 - swing * 0.3, Math.cos(angle)];
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
  forest: 11.8, scorch: 13.3, forestEnd: 18.2, cockpit: 18.2, resolve: 23,
  returnToDuel: 27.4, orbit: 31.8,
});
export const FINISHER_EXECUTION = Object.freeze({
  dash: 1.65, vanish: 2.7, gone: 2.95, appear: 3.2, materialized: 3.65,
  cuts: 4.25, lastCut: 6.25, collapse: 6.6,
});
export const DONUS_RETURN = Object.freeze({ appear: 9.2, arrival: 14 });
export const FINISHER_BEATS: readonly FinisherBeat[] = Object.freeze([
  { id: 'evade', key: 'KeyA', label: 'EVADE THE EXECUTION SHOT', mode: 'tap', lead: 0.65, window: 1.65, hold: 0, presses: 1, resolve: 1.3, shot: 'evade' },
  { id: 'missile-cut', key: 'KeyJ', label: 'CUT THROUGH THE BARRAGE', mode: 'tap', lead: 0.5, window: 1.5, hold: 0, presses: 1, resolve: 1.45, shot: 'missileCut' },
  { id: 'countershot', key: 'KeyF', label: 'DRAW / RETURN FIRE', mode: 'tap', lead: 0.55, window: 1.4, hold: 0, presses: 1, resolve: 2.35, shot: 'countershot' },
  { id: 'boost', key: 'Space', label: 'CLOSE THE DISTANCE', mode: 'tap', lead: 0.5, window: 1.3, hold: 0, presses: 1, resolve: 1.5, shot: 'boost' },
  { id: 'clash', key: 'KeyD', label: 'BREAK THE BLADE LOCK', mode: 'mash', lead: 0.65, window: 1.5, hold: 0, presses: 6, resolve: 1.65, shot: 'clash' },
  { id: 'arm-cut', key: 'KeyJ', label: 'BREAK THEIR SWORD ARM', mode: 'tap', lead: 0.45, window: 1.5, hold: 0, presses: 1, resolve: 1.6, shot: 'armCut' },
  { id: 'ascend', key: 'KeyW', label: 'RISE ABOVE THE COUNTER', mode: 'tap', lead: 0.5, window: 1.45, hold: 0, presses: 1, resolve: 1.6, shot: 'ascend' },
  { id: 'reactor', key: 'KeyE', label: 'CHARGE THE SKYWARD BLADE', mode: 'hold', lead: 0.65, window: 1.6, hold: 1.15, presses: 1, resolve: 2.6, shot: 'reactor' },
  { id: 'final-cut', key: 'KeyJ', label: 'LAST LIGHT / RELEASE', mode: 'tap', lead: 0.45, window: 1.65, hold: 0, presses: 1, resolve: 5.25, shot: 'finalCut' },
]);
export const FINISHER_TIMELINE = FINISHER_BEATS.map((beat, index) => {
  const start = FINISHER_BEATS.slice(0, index).reduce((sum, previous) => sum + finisherBeatDuration(previous), 0);
  return { beat, start, end: start + finisherBeatDuration(beat) };
});
export const FINISHER_DURATION = FINISHER_TIMELINE[FINISHER_TIMELINE.length - 1].end;

export function finisherAtTime(elapsed: number) {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError('Finisher time must be finite and nonnegative');
  const time = Math.min(elapsed, FINISHER_DURATION);
  const found = FINISHER_TIMELINE.findIndex(shot => time < shot.end);
  const index = found < 0 ? FINISHER_TIMELINE.length - 1 : found;
  const shot = FINISHER_TIMELINE[index];
  return { beat: shot.beat, index, clock: time - shot.start };
}

export function samplePlanetAftermath(time: number) {
  return {
    forest: time >= PLANET_RUPTURE.forest && time < PLANET_RUPTURE.forestEnd,
    cockpit: time >= PLANET_RUPTURE.cockpit && time < PLANET_RUPTURE.returnToDuel,
    burn: cinematicProgress(time, PLANET_RUPTURE.scorch, PLANET_RUPTURE.forestEnd - 0.7),
    grief: cinematicProgress(time, PLANET_RUPTURE.cockpit, PLANET_RUPTURE.resolve),
    resolve: cinematicProgress(time, PLANET_RUPTURE.resolve, PLANET_RUPTURE.returnToDuel),
    orbit: cinematicProgress(time, PLANET_RUPTURE.returnToDuel, PLANET_RUPTURE.orbit + 0.4),
  };
}

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

interface MotionKey { at: number; point: CinematicPoint; stop?: boolean; }
const shotTime = (index: number, offset = 0) => FINISHER_TIMELINE[index].start + offset;
const heroMotion: MotionKey[] = [
  { at: 0, point: [-14, 0, 0] },
  { at: 0.85, point: [-14.6, -1, 2] },
  { at: 2.05, point: [-16, -3.5, 8] },
  { at: shotTime(1), point: [-12, 0, 3] },
  { at: shotTime(1, 1.4), point: [-11, 1.3, 3.4] },
  { at: shotTime(2), point: [-10, 2, 2] },
  { at: shotTime(2, 1.8), point: [-10.7, 1.8, 2.4] },
  { at: shotTime(3), point: [-10, 2, 2] },
  { at: shotTime(3, 1.3), point: [-8, 3, 1] },
  { at: shotTime(4), point: [-5.9, 0, 0] },
  { at: shotTime(4, 1.3), point: [-5.5, -0.25, 0.1] },
  { at: shotTime(5), point: [-6, 0, 0] },
  { at: shotTime(5, 1.55), point: [-4.9, 1.5, 1.2] },
  { at: shotTime(6), point: [-3, 3, 1] },
  { at: shotTime(6, 1.65), point: [-5, 10.5, 1] },
  { at: shotTime(7), point: [-9, 16, -2] },
  { at: shotTime(7, 2.4), point: [-9.5, 16.5, -2.7] },
  { at: shotTime(8), point: [-9, 16, -2], stop: true },
  { at: shotTime(8, FINISHER_EXECUTION.dash), point: [-9, 16, -2] },
];
const enemyMotion: MotionKey[] = [
  { at: 0, point: [14, 1, -2] },
  { at: shotTime(1), point: [14, 1, -2] },
  { at: shotTime(2), point: [14, 2, -2] },
  { at: shotTime(2, 2.7), point: [13.1, 2.1, -3.2] },
  { at: shotTime(3), point: [12, 2, -2] },
  { at: shotTime(4), point: [5.9, 0, 0] },
  { at: shotTime(4, 1.3), point: [6.1, -0.1, 0.1] },
  { at: shotTime(5), point: [6.3, 0, 0] },
  { at: shotTime(5, 2), point: [7.1, 0.3, -0.5] },
  { at: shotTime(6), point: [6, 0, 0] },
  { at: shotTime(7), point: [6, 0, 0] },
  { at: shotTime(7, 2.4), point: [6.5, 0.2, -0.2] },
  { at: shotTime(8), point: [6, 0, 0], stop: true },
  { at: shotTime(8, FINISHER_EXECUTION.dash), point: [6, 0, 0] },
];

// Time-scaled Hermite tangents carry momentum across shots rather than stopping at every prompt.
function sampleMotion(keys: readonly MotionKey[], time: number): CinematicPoint {
  const index = keys.findIndex(key => time < key.at);
  if (index <= 0) return [...keys[index === 0 ? 0 : keys.length - 1].point];
  const a = keys[index - 1], b = keys[index], before = keys[Math.max(0, index - 2)], after = keys[Math.min(keys.length - 1, index + 1)];
  const span = b.at - a.at, p = (time - a.at) / span, p2 = p * p, p3 = p2 * p;
  const tangent = (from: MotionKey, to: MotionKey, axis: number) => (to.point[axis] - from.point[axis]) / (to.at - from.at);
  const axis = (i: number) => (2 * p3 - 3 * p2 + 1) * a.point[i] + (-2 * p3 + 3 * p2) * b.point[i]
    + (p3 - 2 * p2 + p) * span * (index === 1 || a.stop ? 0 : tangent(before, b, i))
    + (p3 - p2) * span * (index === keys.length - 1 || b.stop ? 0 : tangent(a, after, i));
  return [axis(0), axis(1), axis(2)];
}

export function sampleFinisherSequence(elapsed: number) {
  const shot = finisherAtTime(elapsed);
  return { ...sampleFinisher(shot.beat, shot.clock), ...shot };
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
  const shot = FINISHER_TIMELINE.find(entry => entry.beat.id === beat.id);
  if (!shot) throw new RangeError(`Unknown finisher shot: ${beat.id}`);

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
    heroPose = p > 0.7 ? 'clash' : 'boost'; enemyPose = p > 0.7 ? 'clash' : 'thrust';
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
  if (beat.shot !== 'finalCut') {
    hero = sampleMotion(heroMotion, shot.start + clock);
    enemy = sampleMotion(enemyMotion, shot.start + clock);
  }
  const lockStart = shotTime(3, finisherBeatDuration(FINISHER_BEATS[3]) - 0.65);
  const lockEnd = shotTime(4, finisherActionTime(FINISHER_BEATS[4]) + 0.25);
  const bladeLock = cinematicProgress(shot.start + clock, lockStart, lockStart + 0.5)
    * (1 - cinematicProgress(shot.start + clock, lockEnd - 0.22, lockEnd));
  return { hero, enemy, heroPose, enemyPose, heroRoll, enemyRoll, heroYaw, enemyYaw, heroPoseProgress, enemyPoseProgress,
    heroDissolve, heroVisible, heroCharge, barrage, speed, bladeLock, progress: p };
}
