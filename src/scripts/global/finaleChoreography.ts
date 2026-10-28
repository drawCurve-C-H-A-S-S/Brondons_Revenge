import type { MechPoseName } from "../npc/mechAnimation.js";
import type { FinalePhase } from "./finaleDirector.js";
import { FACILITY_ROOF_SEQUENCE } from "./facilityArchitecture.js";

export const FINALE_START_X = 14;
export const RIFLE_SEQUENCE = Object.freeze({
  sheath: 0.45,
  draw: 0.8,
  ready: 1.4,
  cameraEnd: 1.48,
  fire: 2.05,
  lastShot: 2.61,
  return: 2.9,
  holstered: 3.5,
  swordDraw: 3.78,
  swordReady: 4.25,
});
export function sampleRifleSequence(time: number) {
  return {
    sheath: cinematicProgress(time, 0, RIFLE_SEQUENCE.sheath),
    draw: cinematicProgress(time, RIFLE_SEQUENCE.sheath, RIFLE_SEQUENCE.draw),
    shoulderToAim: cinematicProgress(
      time,
      RIFLE_SEQUENCE.draw,
      RIFLE_SEQUENCE.ready,
    ),
    returning: cinematicProgress(
      time,
      RIFLE_SEQUENCE.return,
      RIFLE_SEQUENCE.holstered,
    ),
    swordReturn: cinematicProgress(
      time,
      RIFLE_SEQUENCE.swordDraw,
      RIFLE_SEQUENCE.swordReady,
    ),
    firing:
      time >= RIFLE_SEQUENCE.fire && time <= RIFLE_SEQUENCE.lastShot + 0.12,
  };
}
export const HERO_ULTIMATE = Object.freeze({
  cameraEnd: 1.45,
  release: 2.05,
  duration: 2.95,
  cooldown: 18,
});
export const ENEMY_VERDICT = Object.freeze({
  cameraEnd: 1.5,
  release: 2.12,
  duration: 3.15,
});
export const ENEMY_ORBITAL_CUT = Object.freeze({
  cameraEnd: 1.25,
  release: 1.9,
  cross: 2.4,
  duration: 3.5,
});
export const ENEMY_ATTACK_LEAPS = Object.freeze({
  thrust: { takeoff: 0.12, land: 0.68, height: 3.4, distance: 12 },
  verdict: { takeoff: 0.08, land: 0.68, height: 3, distance: 12 },
});
export function sampleEnemyAttackLeap(
  move: keyof typeof ENEMY_ATTACK_LEAPS,
  time: number,
) {
  const leap = ENEMY_ATTACK_LEAPS[move];
  const progress = Math.max(
    0,
    Math.min(1, (time - leap.takeoff) / (leap.land - leap.takeoff)),
  );
  return {
    progress: cinematicProgress(time, leap.takeoff, leap.land),
    lift:
      progress === 0 || progress === 1
        ? 0
        : Math.sin(progress * Math.PI) * leap.height,
  };
}
export const MECH_DODGE = Object.freeze({
  duration: 0.48,
  distance: 14,
  crossDuration: 0.6,
  crossRange: 19,
  clearance: 9,
});
export function sampleDodgeArc(
  time: number,
  duration: number,
  crossing: boolean,
  offset = { lane: 0, lift: 0, roll: 0 },
) {
  const progress = Math.max(0, Math.min(1, time / duration));
  const arc = Math.sin(progress * Math.PI);
  const eased = cinematicProgress(time, 0, duration),
    carry = 1 - eased;
  return {
    progress: eased,
    lane: (crossing ? arc * 7 : 0) + offset.lane * carry,
    lift: arc * (crossing ? 3.2 : 0.8) + offset.lift * carry,
    roll: arc * (crossing ? 0.22 : 0.12) + offset.roll * carry,
  };
}
export const MELEE_STRIKES = Object.freeze({
  slash: { duration: 1.533333, start: 0.34, end: 0.6 },
  sideSlash: { duration: 1.4, start: 0.17, end: 0.35 },
  cleave: { duration: 2, start: 0.54, end: 0.82 },
  thrust: { duration: 1.566667, start: 0.24, end: 0.44 },
  reap: { duration: 1.566667, start: 0.17, end: 0.38 },
  orbitalCut: {
    duration: ENEMY_ORBITAL_CUT.duration,
    start: ENEMY_ORBITAL_CUT.release,
    end: 2.65,
  },
  regularCombo: { duration: 3, start: 0.17, end: 1.73 },
  heavyCombo: { duration: 4.333333, start: 0.34, end: 2.85 },
});
export type MeleeStrike = keyof typeof MELEE_STRIKES;
export const SWORD_COMBO_WINDOWS: Partial<
  Record<MeleeStrike, readonly { start: number; end: number }[]>
> = {
  regularCombo: [
    { start: 0.17, end: 0.35 },
    { start: 0.62, end: 0.87 },
    { start: 1.4, end: 1.73 },
  ],
  heavyCombo: [
    { start: 0.34, end: 0.64 },
    { start: 0.99, end: 1.33 },
    { start: 1.64, end: 2.01 },
    { start: 2.44, end: 2.85 },
  ],
};
export function swordHitWindows(move: MeleeStrike) {
  return SWORD_COMBO_WINDOWS[move] ?? [MELEE_STRIKES[move]];
}
export type PlayerSwordStrike = Exclude<MeleeStrike, "orbitalCut">;
export const SWORD_ATTACK_CLIPS = {
  slash: "Sword_Attack",
  sideSlash: "Sword_Regular_A_WithRecovery",
  cleave: "Sword_Regular_C",
  thrust: "Sword_Dash",
  reap: "Sword_Regular_B_WithRecovery",
  orbitalCut: "Sword_Regular_B_WithRecovery",
  regularCombo: "Sword_Regular_Combo",
  heavyCombo: "Sword_Heavy_Combo",
} as const satisfies Record<MeleeStrike, string>;
export const SWORD_ATTACK_LABELS: Record<PlayerSwordStrike, string> = {
  slash: "CLASSIC CUT",
  sideSlash: "LEFT CUT",
  reap: "RIGHT CUT",
  thrust: "SWORD LUNGE",
  cleave: "FINISHING CUT",
  regularCombo: "REGULAR COMBO",
  heavyCombo: "HEAVY COMBO",
};
export function directionalSwordAttack(
  horizontal: number,
  vertical: number,
  combo: number,
): PlayerSwordStrike {
  const x = Math.abs(horizontal) >= 0.35 ? Math.sign(horizontal) : 0;
  const y = Math.abs(vertical) >= 0.35 ? Math.sign(vertical) : 0;
  if (x < 0 && y > 0) return "regularCombo";
  if (horizontal >= 0.6 && vertical >= 0.6) return "heavyCombo";
  if (x < 0 && y < 0) return "slash";
  if (x > 0 && y < 0) return "cleave";
  if (y > 0) return "thrust";
  if (y < 0) return "cleave";
  if (x < 0) return "sideSlash";
  if (x > 0) return "reap";
  return combo === 2 ? "cleave" : combo === 1 ? "sideSlash" : "slash";
}

export function swordClipTime(
  time: number,
  clipDuration: number,
  source: { duration: number; start: number; end: number },
  target: { duration: number; start: number; end: number },
) {
  const t = Math.max(0, Math.min(target.duration, time));
  const sourceTime =
    t < target.start
      ? (source.start * t) / target.start
      : t < target.end
        ? source.start +
          ((source.end - source.start) * (t - target.start)) /
            (target.end - target.start)
        : source.end +
          ((source.duration - source.end) * (t - target.end)) /
            (target.duration - target.end);
  return (sourceTime / source.duration) * clipDuration;
}
export const PHYSICAL_STRIKES = {
  jab: { duration: 0.72, start: 0.22, end: 0.4, damage: 34 },
  cross: { duration: 0.9, start: 0.32, end: 0.53, damage: 48 },
  hook: { duration: 1.02, start: 0.26, end: 0.54, damage: 56 },
  slide: { duration: 1.4, start: 0.3, end: 0.9, damage: 42 },
} as const;
export type PhysicalStrike = keyof typeof PHYSICAL_STRIKES;
export function isPhysicalStrike(move: string): move is PhysicalStrike {
  return Object.prototype.hasOwnProperty.call(PHYSICAL_STRIKES, move);
}
export type CinematicPoint = [number, number, number];

export function isMeleeStrike(move: string): move is MeleeStrike {
  return Object.prototype.hasOwnProperty.call(MELEE_STRIKES, move);
}

/** Fit an authored clip's anticipation/contact/recovery to the simulation's damage window. */
export function authoredStrikeTime(
  time: number,
  duration: number,
  strike: { duration: number; start: number; end: number },
) {
  const t = Math.max(0, Math.min(strike.duration, time));
  if (t < strike.start)
    return duration * 0.3 * cinematicProgress(t, 0, strike.start);
  if (t < strike.end)
    return (
      duration * (0.3 + 0.35 * cinematicProgress(t, strike.start, strike.end))
    );
  return (
    duration * (0.65 + 0.35 * cinematicProgress(t, strike.end, strike.duration))
  );
}

const pointMix = (
  a: CinematicPoint,
  b: CinematicPoint,
  p: number,
): CinematicPoint => [
  a[0] + (b[0] - a[0]) * p,
  a[1] + (b[1] - a[1]) * p,
  a[2] + (b[2] - a[2]) * p,
];
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
  if (move === "slash" || move === "cleave") {
    const angle = -0.3 + swing * 2.65;
    grip = pointMix(
      pointMix(rest, [-2, move === "cleave" ? 14.8 : 14, 1.4], wind),
      [-2, 7.8, 4],
      swing,
    );
    direction = [0.025, Math.cos(angle), Math.sin(angle)];
  } else if (move === "thrust") {
    grip = pointMix(
      pointMix(rest, [-2.6, 10.4, -0.9], wind),
      [-0.8, 10.1, 5.2],
      swing,
    );
    direction = [0.025, -0.035, 1];
  } else if (move === "orbitalCut") {
    const angle = -1.75 + swing * Math.PI * 1.65;
    grip = pointMix(
      pointMix(rest, [-2.4, 13.6, 0.6], wind),
      [1.8, 9.2, 3.6],
      swing,
    );
    direction = [Math.sin(angle), 0.18 - swing * 0.3, Math.cos(angle)];
  } else {
    const reverse = move === "reap";
    const angle = reverse ? 1.15 - swing * 2.8 : -1.2 + swing * 2.4;
    grip = pointMix(
      pointMix(rest, reverse ? [3, 12, 1] : [-3.4, 10.1, 2], wind),
      reverse ? [-3.1, 6.8, 3.4] : [2.2, 9.8, 2.8],
      swing,
    );
    direction = [
      Math.sin(angle),
      reverse ? 0.25 - swing * 0.58 : 0.035,
      Math.cos(angle),
    ];
  }
  grip = pointMix(grip, rest, recover);
  direction = normalized(pointMix(direction, [-0.12, 0.86, 0.58], recover));
  const base = grip.map(
    (value, axis) => value + direction[axis] * 0.9,
  ) as CinematicPoint;
  const tip = grip.map(
    (value, axis) => value + direction[axis] * 12.7,
  ) as CinematicPoint;
  return {
    grip,
    direction,
    base,
    tip,
    active: time >= strike.start && time <= strike.end,
    swing,
  };
}

export function sampleUltimateBlade(time: number) {
  const strike = MELEE_STRIKES.cleave;
  const poised = strike.start - 0.06;
  const releasePose = strike.start + (strike.end - strike.start) * 0.62;
  const bladeTime =
    time < HERO_ULTIMATE.cameraEnd
      ? poised * cinematicProgress(time, 0, HERO_ULTIMATE.cameraEnd)
      : poised +
        (releasePose - poised) *
          cinematicProgress(
            time,
            HERO_ULTIMATE.cameraEnd,
            HERO_ULTIMATE.release,
          );
  return sampleMeleeBlade(
    "cleave",
    time > HERO_ULTIMATE.release
      ? releasePose + (time - HERO_ULTIMATE.release) * 0.8
      : bladeTime,
  );
}
export const FINALE_REVEAL = Object.freeze({
  walkEnd: 2.8,
  studentStart: 9,
  studentDuration: 5.8,
  studentEnd: 38,
  mentorEnd: 42.2,
  correctionEnd: 45.5,
  brandenEnd: 50,
  mockeryEnd: 53.3,
  betrayalEnd: 58.3,
  recognitionEnd: 62.6,
  renounceEnd: 66.8,
  challengeEnd: 70,
  end: 72.2,
});
export const STUDENT_TIMELINE = Object.freeze(
  Array.from({ length: 5 }, (_, index) => ({
    reveal: {
      start: FINALE_REVEAL.studentStart + index * FINALE_REVEAL.studentDuration,
      end:
        FINALE_REVEAL.studentStart +
        (index + 1) * FINALE_REVEAL.studentDuration,
    },
    boarding: {
      start: FACILITY_ROOF_SEQUENCE.boardingStart + index * 2.3,
      end: FACILITY_ROOF_SEQUENCE.boardingStart + (index + 1) * 2.3,
    },
  })),
);
export const HERO_TRANSFORM = Object.freeze({
  launch: 2.8,
  arrival: 6.2,
  disassemble: 6.4,
  materialize: 6.7,
  pilotMerge: 8.1,
  assembled: 11.8,
  sword: 12.2,
  lock: 14.2,
});
export const HERO_REVENGE = Object.freeze({
  aura: 0.25,
  shout: 1.6,
  colorStart: 2.2,
  burst: 3.3,
  colorEnd: 4.7,
  settle: 5.6,
  duration: 7.2,
});
export const PLANET_RUPTURE = Object.freeze({
  facilityCut: 0.85,
  coreTransfer: 1.15,
  coreGone: 2.35,
  jump: 0.85,
  land: 1.75,
  raise: 1.9,
  materialize: 2.45,
  release: 3.8,
  apex: 5.2,
  slam: 5.2,
  escape: 5.85,
  wide: 7.6,
  impact: 8.65,
  forest: 12,
  scorch: 13.1,
  reflection: 13.75,
  feet: 18.4,
  fall: 21.6,
  death: 23.6,
  forestEnd: 24,
  burning: 24,
  burst: 27,
  stardustEnd: 31.2,
  cockpit: 31.2,
  resolve: 34.4,
  returnToDuel: 37.2,
  orbit: 39.6,
});
export function heroRevengeTime(phase: FinalePhase, time: number) {
  // The power-up starts during the cockpit pull-out, before its dedicated phase.
  if (phase === "rupture" && time >= PLANET_RUPTURE.returnToDuel)
    return time - PLANET_RUPTURE.returnToDuel;
  if (phase === "revenge")
    return time + PLANET_RUPTURE.orbit + 0.4 - PLANET_RUPTURE.returnToDuel;
  return -1;
}
export const FINISHER_EXECUTION = Object.freeze({
  dash: 0.4,
  vanish: 1.05,
  gone: 1.22,
  appear: 1.7,
  materialized: 2,
  cuts: 2.5,
  lastCut: 5.25,
  collapse: 5.8,
  slashes: 40,
});
export const DONUS_RETURN = Object.freeze({
  dance: 4.1,
  appear: 9.2,
  arrival: 15.2,
});
export const SPECIAL_MOVE_NAMES = {
  missiles: "BRANDEN'S TEARS",
  overdrive: "BRENDAN'S WILL",
  verdict: "REBEL",
  orbitalCut: "ECLIPSE",
} as const;
export function isNamedSpecialMove(
  move: string,
): move is keyof typeof SPECIAL_MOVE_NAMES {
  return Object.prototype.hasOwnProperty.call(SPECIAL_MOVE_NAMES, move);
}
export interface FinisherBeat {
  id: string;
  duration: number;
  action: number;
  shot:
    | "challenge"
    | "evade"
    | "parry"
    | "countershot"
    | "clash"
    | "exchange"
    | "armCut"
    | "ascend"
    | "reactor"
    | "finalCut";
}
interface ExchangeCut {
  end: number;
  hit: number;
  hero: MechPoseName;
  enemy: MechPoseName;
  contact: boolean;
}
const exchangeCuts: readonly ExchangeCut[] = Object.freeze([
  { end: 0.7, hit: 0.46, hero: "thrust", enemy: "clash", contact: true },
  { end: 1.17, hit: 0.93, hero: "sideSlash", enemy: "clash", contact: true },
  { end: 1.62, hit: 1.39, hero: "reap", enemy: "clash", contact: true },
  { end: 2.1, hit: 1.87, hero: "clash", enemy: "cleave", contact: true },
  { end: 2.55, hit: 2.32, hero: "sideSlash", enemy: "clash", contact: true },
  { end: 3.21, hit: 2.96, hero: "clash", enemy: "reap", contact: true },
  { end: 3.76, hit: 3.48, hero: "evade", enemy: "cleave", contact: false },
  { end: 4.35, hit: 4.03, hero: "thrust", enemy: "clash", contact: true },
  { end: 5.25, hit: 4.8, hero: "boost", enemy: "evade", contact: false },
  { end: 5.87, hit: 5.6, hero: "clash", enemy: "thrust", contact: true },
  { end: 6.36, hit: 6.12, hero: "reap", enemy: "clash", contact: true },
  { end: 6.83, hit: 6.59, hero: "clash", enemy: "sideSlash", contact: true },
  { end: 7.6, hit: 7.08, hero: "cleave", enemy: "clash", contact: true },
]);
const exchangeTempo = 1.4;
export const FINISHER_EXCHANGE = Object.freeze({
  tempo: exchangeTempo,
  cuts: exchangeCuts.map((cut) => ({
    ...cut, hit: cut.hit * exchangeTempo, end: cut.end * exchangeTempo,
  })),
  pressureEnd: 2.55 * exchangeTempo,
  circleEnd: 4.35 * exchangeTempo,
  breakEnd: 5.25 * exchangeTempo,
  duration: 7.6 * exchangeTempo,
});
export function sampleFinisherExchange(clock: number) {
  clock /= FINISHER_EXCHANGE.tempo;
  const found = exchangeCuts.findIndex((cut) => clock < cut.end);
  const index = found < 0 ? exchangeCuts.length - 1 : found;
  const cut = exchangeCuts[index];
  const start = index === 0 ? 0 : exchangeCuts[index - 1].end;
  const progress = (move: MechPoseName) => {
    if (!isMeleeStrike(move)) return cinematicProgress(clock, start, cut.end);
    const strike = MELEE_STRIKES[move];
    if (clock > cut.hit + 0.12) {
      // Carry the follow-through into the next cut instead of rushing back to idle.
      const followThrough = Math.min(0.38, strike.duration - strike.end);
      return (strike.end + followThrough *
        cinematicProgress(clock, cut.hit + 0.12, cut.end)) / strike.duration;
    }
    return swordClipTime(
      clock - start, strike.duration, strike,
      { duration: cut.end - start, start: cut.hit - start - 0.14, end: cut.hit - start + 0.12 },
    ) / strike.duration;
  };
  const lock = cut.contact
    ? cinematicProgress(clock, cut.hit - 0.12, cut.hit - 0.025) *
      (1 - cinematicProgress(clock, cut.hit + 0.02, cut.hit + 0.14))
    : 0;
  const swinging = clock >= cut.hit - 0.13 && clock <= cut.hit + 0.13 && lock < 0.85;
  return {
    index,
    heroMove: cut.hero,
    enemyMove: cut.enemy,
    heroProgress: progress(cut.hero),
    enemyProgress: progress(cut.enemy),
    heroTrail: swinging && isMeleeStrike(cut.hero),
    enemyTrail: swinging && isMeleeStrike(cut.enemy),
    lock,
    height: [1.6, 0.3, 2.2, 0.8][index % 4],
    depth: index % 2 ? -0.35 : 0.35,
    dodge: cut.hero === "evade" ? Math.sin(cinematicProgress(clock, start, cut.end) * Math.PI) : 0,
  };
}
const rifleDuration = 4.25;
export const FINISHER_RIFLE = Object.freeze({
  duration: rifleDuration,
  fire: (RIFLE_SEQUENCE.fire / RIFLE_SEQUENCE.swordReady) * rifleDuration,
  lastShot:
    (RIFLE_SEQUENCE.lastShot / RIFLE_SEQUENCE.swordReady) * rifleDuration,
  spacing: (0.14 / RIFLE_SEQUENCE.swordReady) * rifleDuration,
});
export const FINISHER_BEATS: readonly FinisherBeat[] = Object.freeze([
  { id: "challenge", duration: 6, action: 6, shot: "challenge" },
  { id: "evade", duration: 2.8, action: 0.9, shot: "evade" },
  { id: "parry", duration: 2.2, action: 0.9, shot: "parry" },
  {
    id: "countershot",
    duration: rifleDuration,
    action: FINISHER_RIFLE.fire,
    shot: "countershot",
  },
  { id: "clash", duration: 4.4, action: 0.85, shot: "clash" },
  {
    id: "exchange", duration: FINISHER_EXCHANGE.duration,
    action: FINISHER_EXCHANGE.cuts[0].hit, shot: "exchange",
  },
  { id: "arm-cut", duration: 2.2, action: 0.9, shot: "armCut" },
  { id: "ascend", duration: 2.2, action: 1.1, shot: "ascend" },
  { id: "reactor", duration: 3.1, action: 2.3, shot: "reactor" },
  {
    id: "final-cut",
    duration: 7.4,
    action: FINISHER_EXECUTION.dash,
    shot: "finalCut",
  },
]);
export const FINISHER_TIMELINE = FINISHER_BEATS.map((beat, index) => {
  const start = FINISHER_BEATS.slice(0, index).reduce(
    (sum, previous) => sum + finisherBeatDuration(previous),
    0,
  );
  return { beat, start, end: start + finisherBeatDuration(beat) };
});
export const FINISHER_DURATION =
  FINISHER_TIMELINE[FINISHER_TIMELINE.length - 1].end;

export function finisherAtTime(elapsed: number) {
  if (!Number.isFinite(elapsed) || elapsed < 0)
    throw new RangeError("Finisher time must be finite and nonnegative");
  const time = Math.min(elapsed, FINISHER_DURATION);
  const found = FINISHER_TIMELINE.findIndex((shot) => time < shot.end);
  const index = found < 0 ? FINISHER_TIMELINE.length - 1 : found;
  const shot = FINISHER_TIMELINE[index];
  return { beat: shot.beat, index, clock: time - shot.start };
}

export function samplePlanetAftermath(time: number) {
  return {
    forest: time >= PLANET_RUPTURE.forest && time < PLANET_RUPTURE.forestEnd,
    cockpit:
      time >= PLANET_RUPTURE.cockpit && time < PLANET_RUPTURE.returnToDuel,
    burn: cinematicProgress(
      time,
      PLANET_RUPTURE.scorch,
      PLANET_RUPTURE.forestEnd - 0.7,
    ),
    kneel: cinematicProgress(
      time,
      PLANET_RUPTURE.forest + 0.1,
      PLANET_RUPTURE.scorch - 0.15,
    ),
    pov: time >= PLANET_RUPTURE.feet && time < PLANET_RUPTURE.fall,
    death: cinematicProgress(
      time,
      PLANET_RUPTURE.fall,
      PLANET_RUPTURE.death,
    ),
    grief: cinematicProgress(
      time,
      PLANET_RUPTURE.cockpit,
      PLANET_RUPTURE.resolve,
    ),
    resolve: cinematicProgress(
      time,
      PLANET_RUPTURE.resolve,
      PLANET_RUPTURE.returnToDuel,
    ),
    orbit: cinematicProgress(
      time,
      PLANET_RUPTURE.returnToDuel,
      PLANET_RUPTURE.orbit + 0.4,
    ),
  };
}

export function samplePlanetSurface(time: number) {
  const dissolve = cinematicProgress(
    time,
    PLANET_RUPTURE.impact + 0.15,
    PLANET_RUPTURE.forest - 0.25,
  );
  const dispersal = cinematicProgress(
    time,
    PLANET_RUPTURE.burst,
    PLANET_RUPTURE.burst + 1.3,
  );
  return {
    dissolve,
    dispersal,
    rumble: time >= PLANET_RUPTURE.impact && time < PLANET_RUPTURE.burst
      ? 0.35 + 0.45 * Math.exp(-(time - PLANET_RUPTURE.impact) * 1.8) +
        0.65 * cinematicProgress(time, PLANET_RUPTURE.burning, PLANET_RUPTURE.burst)
      : 0,
    crustVisible: dissolve < 1,
    fireVisible: time >= PLANET_RUPTURE.impact && dispersal < 1,
    dustVisible:
      time >= PLANET_RUPTURE.burst && time < PLANET_RUPTURE.stardustEnd,
  };
}

export function sampleRooftopNight(phase: FinalePhase, time: number) {
  if (
    phase === "loading" ||
    phase === "error" ||
    phase === "reveal" ||
    phase === "enemyTransform"
  )
    return 0;
  if (phase === "heroTransform")
    return cinematicProgress(time, HERO_TRANSFORM.assembled, 17) * 0.55;
  if (phase === "versus") return 0.55 + cinematicProgress(time, 0, 4.6) * 0.3;
  if (phase === "ground") return 0.85 + cinematicProgress(time, 0, 8) * 0.15;
  return 1;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function cinematicProgress(time: number, start: number, end: number) {
  const p = clamp((time - start) / (end - start));
  return p * p * p * (p * (p * 6 - 15) + 10);
}

export function activeStudent(time: number, sequence: "reveal" | "boarding") {
  return STUDENT_TIMELINE.findIndex(
    (timing) => time >= timing[sequence].start && time < timing[sequence].end,
  );
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
    ascent,
    merge,
    scale: 1 - merge * 0.98,
    beam:
      cinematicProgress(time, start, start + 0.25) *
      (1 - cinematicProgress(time, start + 1.95, end)),
  };
}

export function finisherBeatDuration(beat: FinisherBeat) {
  return beat.duration;
}

export function finisherActionTime(beat: FinisherBeat) {
  return beat.action;
}

export function sampleMothershipArrival(time: number) {
  if (!Number.isFinite(time) || time < 0)
    throw new RangeError("Mothership time must be finite and nonnegative");
  const p = clamp(
    (time - DONUS_RETURN.appear) / (DONUS_RETURN.arrival - DONUS_RETURN.appear),
  );
  const travel = 1 - (1 - p) ** 3;
  const a: CinematicPoint = [175, 48, -155],
    b: CinematicPoint = [120, 24, -40];
  const c: CinematicPoint = [90, 9, -12],
    d: CinematicPoint = [40, 9, -12];
  const ab = pointMix(a, b, travel),
    bc = pointMix(b, c, travel),
    cd = pointMix(c, d, travel);
  const abc = pointMix(ab, bc, travel),
    bcd = pointMix(bc, cd, travel);
  const position = pointMix(abc, bcd, travel);
  const direction = normalized([
    bcd[0] - abc[0],
    bcd[1] - abc[1],
    bcd[2] - abc[2],
  ]);
  const settled = cinematicProgress(
    time,
    DONUS_RETURN.arrival - 1,
    DONUS_RETURN.arrival,
  );
  position[1] += Math.sin((time - DONUS_RETURN.arrival) * 0.6) * 0.28 * settled;
  return { position, direction, roll: -Math.sin(p * Math.PI) * 0.12 };
}

export function samplePlanetBreaker(
  time: number,
  origin: CinematicPoint,
  impact: CinematicPoint,
) {
  const apex: CinematicPoint = [
    origin[0] - 12,
    origin[1] + 260,
    origin[2] - 28,
  ];
  if (time <= PLANET_RUPTURE.release) return [...origin] as CinematicPoint;
  if (time < PLANET_RUPTURE.apex)
    return pointMix(
      origin,
      apex,
      1 -
        (1 -
          clamp(
            (time - PLANET_RUPTURE.release) /
              (PLANET_RUPTURE.apex - PLANET_RUPTURE.release),
          )) **
          2,
    );
  const fall = clamp(
    (time - PLANET_RUPTURE.slam) /
      (PLANET_RUPTURE.impact - PLANET_RUPTURE.slam),
  );
  return pointMix(apex, impact, fall * fall);
}

interface MotionKey {
  at: number;
  point: CinematicPoint;
  stop?: boolean;
}
const shotTime = (shot: FinisherBeat["shot"], offset = 0) =>
  FINISHER_TIMELINE.find((entry) => entry.beat.shot === shot)!.start +
  offset * (shot === "exchange" ? FINISHER_EXCHANGE.tempo : 1);
const heroMotion: MotionKey[] = [
  { at: 0, point: [-14, 0, 0], stop: true },
  { at: shotTime("evade"), point: [-14, 0, 0], stop: true },
  { at: shotTime("evade", 0.44), point: [-14.3, -0.15, 0.7] },
  { at: shotTime("evade", 1.05), point: [-15.2, -1.7, 5.4] },
  { at: shotTime("evade", 1.85), point: [-13.1, -0.8, 4.1] },
  { at: shotTime("parry"), point: [-9.8, 0, 1.2] },
  { at: shotTime("parry", 0.9), point: [-8, 0, 0] },
  { at: shotTime("parry", 1.55), point: [-8.8, 0.35, 1] },
  { at: shotTime("countershot"), point: [-10.4, 1, 1.8] },
  { at: shotTime("countershot", 2.1), point: [-10.9, 1.6, 2] },
  { at: shotTime("countershot", 3.3), point: [-10.1, 1.6, 1.4] },
  { at: shotTime("clash"), point: [-7.8, 1, 0.5] },
  { at: shotTime("clash", 0.85), point: [-5.9, 0, 0] },
  { at: shotTime("clash", 1.75), point: [-5.65, -0.08, 0.05] },
  { at: shotTime("clash", 3.15), point: [-5.5, -0.1, 0.1] },
  { at: shotTime("exchange"), point: [-6.3, 0.3, 0.4] },
  { at: shotTime("exchange", 0.46), point: [-3.8, 0, 1] },
  { at: shotTime("exchange", 0.93), point: [-1, 1, 1.8] },
  { at: shotTime("exchange", 1.39), point: [1.8, 2, 3] },
  { at: shotTime("exchange", 1.87), point: [4.1, 2.4, 3.6] },
  { at: shotTime("exchange", 2.32), point: [5.8, 3, 4.8] },
  { at: shotTime("exchange", 2.55), point: [5.7, 3, 5.4] },
  { at: shotTime("exchange", 2.96), point: [3.2, 3.8, 9] },
  { at: shotTime("exchange", 3.48), point: [-0.5, 1.2, 13] },
  { at: shotTime("exchange", 4.03), point: [-4.5, 3.5, 10] },
  { at: shotTime("exchange", 4.35), point: [-6.5, 4.1, 8.5] },
  { at: shotTime("exchange", 4.8), point: [-12, 6.2, 5] },
  { at: shotTime("exchange", 5.25), point: [-13, 5, 2.6] },
  { at: shotTime("exchange", 5.6), point: [-9, 3.2, 1.7] },
  { at: shotTime("exchange", 6.12), point: [-6.8, 1.8, 0.8] },
  { at: shotTime("exchange", 6.59), point: [-8.3, 0.6, -0.5] },
  { at: shotTime("exchange", 7.08), point: [-6.5, 0.3, 0.4] },
  { at: shotTime("armCut"), point: [-6.3, 0.3, 0.4] },
  { at: shotTime("armCut", 0.9), point: [-5, 1, 0.8] },
  { at: shotTime("ascend"), point: [-2.8, 3.2, 1.2] },
  { at: shotTime("ascend", 1.25), point: [-4.8, 10.5, 0.2] },
  { at: shotTime("reactor"), point: [-8.5, 15.5, -1] },
  { at: shotTime("reactor", 2), point: [-9.3, 16.5, -1.5] },
  { at: shotTime("finalCut"), point: [-9, 16, -2], stop: true },
  { at: shotTime("finalCut", FINISHER_EXECUTION.dash), point: [-9, 16, -2], stop: true },
];
const enemyMotion: MotionKey[] = [
  { at: 0, point: [14, 1, -2], stop: true },
  { at: shotTime("evade"), point: [14, 1, -2], stop: true },
  { at: shotTime("evade", 0.9), point: [13.5, 1, -2] },
  { at: shotTime("evade", 1.85), point: [9.5, 0.4, -0.8] },
  { at: shotTime("parry"), point: [5.6, 0.1, 0] },
  { at: shotTime("parry", 0.9), point: [3.6, 0, 0] },
  { at: shotTime("parry", 1.55), point: [5.2, 0.25, -0.6] },
  { at: shotTime("countershot"), point: [12, 1.3, -2] },
  { at: shotTime("countershot", 2.1), point: [13, 1.8, -2.3] },
  { at: shotTime("countershot", 3.3), point: [14.5, 1.3, -3] },
  { at: shotTime("clash"), point: [10.2, 0.8, -0.5] },
  { at: shotTime("clash", 0.85), point: [5.9, 0, 0] },
  { at: shotTime("clash", 1.75), point: [6, -0.1, -0.05] },
  { at: shotTime("clash", 3.15), point: [6.05, -0.08, -0.1] },
  { at: shotTime("exchange"), point: [6.3, 0, 0] },
  { at: shotTime("exchange", 0.46), point: [8.4, 0.2, 0.4] },
  { at: shotTime("exchange", 0.93), point: [11, 1, 1] },
  { at: shotTime("exchange", 1.39), point: [13.8, 2, 2] },
  { at: shotTime("exchange", 1.87), point: [16.1, 2.6, 2.4] },
  { at: shotTime("exchange", 2.32), point: [17.6, 3.1, 3.4] },
  { at: shotTime("exchange", 2.55), point: [17.6, 3, 3] },
  { at: shotTime("exchange", 2.96), point: [14.7, 4, 4.7] },
  { at: shotTime("exchange", 3.48), point: [10, 4.2, 5.5] },
  { at: shotTime("exchange", 4.03), point: [7.8, 3.6, 5.8] },
  { at: shotTime("exchange", 4.35), point: [5.2, 4, 5.4] },
  { at: shotTime("exchange", 4.8), point: [10, 6.2, -3.6] },
  { at: shotTime("exchange", 5.25), point: [8.3, 5, -3.7] },
  { at: shotTime("exchange", 5.6), point: [3.4, 3.3, 0.7] },
  { at: shotTime("exchange", 6.12), point: [5.4, 1.9, 0.2] },
  { at: shotTime("exchange", 6.59), point: [3.7, 0.8, -0.5] },
  { at: shotTime("exchange", 7.08), point: [5.5, 0.1, 0] },
  { at: shotTime("armCut"), point: [6.3, 0, 0] },
  { at: shotTime("armCut", 0.9), point: [6.4, 0.1, 0] },
  { at: shotTime("ascend"), point: [8.7, -0.1, -1.2] },
  { at: shotTime("reactor"), point: [7.5, 0.1, 0] },
  { at: shotTime("finalCut"), point: [6, 0, 0], stop: true },
  { at: shotTime("finalCut", FINISHER_EXECUTION.dash), point: [6, 0, 0], stop: true },
];

// Time-scaled Hermite tangents carry momentum through the editorial cuts.
function sampleMotion(
  keys: readonly MotionKey[],
  time: number,
): CinematicPoint {
  const index = keys.findIndex((key) => time < key.at);
  if (index <= 0) return [...keys[index === 0 ? 0 : keys.length - 1].point];
  const a = keys[index - 1],
    b = keys[index],
    before = keys[Math.max(0, index - 2)],
    after = keys[Math.min(keys.length - 1, index + 1)];
  const span = b.at - a.at,
    p = (time - a.at) / span,
    p2 = p * p,
    p3 = p2 * p;
  const tangent = (from: MotionKey, at: MotionKey, to: MotionKey, axis: number) => {
    const incoming = (at.point[axis] - from.point[axis]) / (at.at - from.at);
    const outgoing = (to.point[axis] - at.point[axis]) / (to.at - at.at);
    // Brake at a reversal; neighboring keys must not pull a body past its mark.
    return incoming * outgoing <= 0
      ? 0
      : (2 * incoming * outgoing) / (incoming + outgoing);
  };
  const axis = (i: number) =>
    (2 * p3 - 3 * p2 + 1) * a.point[i] +
    (-2 * p3 + 3 * p2) * b.point[i] +
    (p3 - 2 * p2 + p) *
      span *
      (index === 1 || a.stop ? 0 : tangent(before, a, b, i)) +
    (p3 - p2) *
      span *
      (index === keys.length - 1 || b.stop ? 0 : tangent(a, b, after, i));
  return [axis(0), axis(1), axis(2)];
}

export function sampleFinisherSequence(elapsed: number) {
  const shot = finisherAtTime(elapsed);
  return { ...sampleFinisher(shot.beat, shot.clock), ...shot };
}

export function sampleFinisher(beat: FinisherBeat, clock: number) {
  if (!Number.isFinite(clock) || clock < 0)
    throw new RangeError("Finisher shot time must be finite and nonnegative");
  const duration = finisherBeatDuration(beat),
    action = finisherActionTime(beat);
  const p = cinematicProgress(clock, 0, duration);
  const strike = cinematicProgress(clock, action - 0.18, action + 0.3);
  let heroPose: MechPoseName = "idle",
    enemyPose: MechPoseName = "idle";
  let heroRoll = 0,
    enemyRoll = 0,
    enemyPitch = 0;
  let heroYaw = 0,
    enemyYaw = 0,
    speed = 0;
  let heroPoseProgress = 0,
    enemyPoseProgress = 0;
  let heroDissolve = 0,
    heroCharge = 0,
    barrage = 0,
    bladeLock = 0,
    enemyCrouch = 0;
  const exchange = beat.shot === "exchange" ? sampleFinisherExchange(clock) : null;
  let heroVisible = true;
  const shot = FINISHER_TIMELINE.find((entry) => entry.beat.id === beat.id);
  if (!shot) throw new RangeError(`Unknown finisher shot: ${beat.id}`);
  let hero = sampleMotion(heroMotion, shot.start + clock);
  let enemy = sampleMotion(enemyMotion, shot.start + clock);
  const velocity = (keys: readonly MotionKey[]): CinematicPoint => {
    const beforeTime = Math.max(0, clock - 0.025);
    const afterTime = Math.min(duration, clock + 0.025);
    const before = sampleMotion(keys, shot.start + beforeTime);
    const after = sampleMotion(keys, shot.start + afterTime);
    const span = Math.max(0.001, afterTime - beforeTime);
    return [(after[0] - before[0]) / span, (after[1] - before[1]) / span, (after[2] - before[2]) / span];
  };
  const travel = exchange ? {
    hero: velocity(heroMotion),
    enemy: velocity(enemyMotion),
    weight: cinematicProgress(clock, 0, 0.22) *
      (1 - cinematicProgress(clock, duration - 0.25, duration)),
  } : null;
  const strikeProgress = (move: MeleeStrike) =>
    swordClipTime(clock, MELEE_STRIKES[move].duration, MELEE_STRIKES[move], {
      duration,
      start: action - 0.16,
      end: action + 0.16,
    }) / MELEE_STRIKES[move].duration;
  const contactWeight = (start: number, end: number) =>
    cinematicProgress(clock, start, action - 0.04) *
    (1 - cinematicProgress(clock, action + 0.16, end));

  if (beat.shot === "challenge") {
    heroPose = "skyCharge";
    enemyPose = "verdict";
    heroPoseProgress = 0.6 + p * 0.08;
    enemyPoseProgress = 0.52 + p * 0.06;
  } else if (beat.shot === "evade") {
    heroPose = "evade";
    enemyPose = "verdict";
    heroRoll = -Math.sin(p * Math.PI) * 0.085;
    heroPoseProgress = 0.15 + p * 0.65;
    enemyPoseProgress = cinematicProgress(clock, 0, action + 0.15);
    speed = Math.sin(p * Math.PI) * 0.12;
  } else if (beat.shot === "parry") {
    heroPose = "clash";
    enemyPose = clock < action + 0.5 ? "reap" : "stagger";
    heroPoseProgress = p;
    enemyPoseProgress =
      enemyPose === "reap"
        ? strikeProgress("reap")
        : cinematicProgress(clock, action + 0.5, duration);
    bladeLock = contactWeight(0.4, 1.55);
    heroRoll = -Math.sin(p * Math.PI) * 0.035;
    enemyRoll = Math.sin(strike * Math.PI) * 0.07;
  } else if (beat.shot === "countershot") {
    heroPose = "missiles";
    enemyPose = clock >= FINISHER_RIFLE.fire + 0.22 ? "stagger" : "clash";
    heroPoseProgress = clamp(clock / duration);
    enemyPoseProgress = cinematicProgress(
      clock,
      FINISHER_RIFLE.fire + 0.22,
      duration,
    );
    const recoil =
      cinematicProgress(
        clock,
        FINISHER_RIFLE.fire + 0.22,
        FINISHER_RIFLE.lastShot + 0.35,
      ) *
      (1 - cinematicProgress(clock, FINISHER_RIFLE.lastShot + 0.35, duration));
    enemyRoll = recoil * 0.055;
  } else if (beat.shot === "clash") {
    heroPose = clock < 0.5 ? "thrust" : "clash";
    enemyPose = clock < 0.5 ? "sideSlash" : clock < 3.65 ? "clash" : "stagger";
    heroPoseProgress = heroPose === "thrust" ? strikeProgress("thrust") : p;
    enemyPoseProgress =
      enemyPose === "sideSlash"
        ? strikeProgress("sideSlash")
        : enemyPose === "stagger"
          ? cinematicProgress(clock, 3.65, duration)
          : p;
    bladeLock =
      cinematicProgress(clock, 0.45, 0.81) *
      (1 - cinematicProgress(clock, 3.2, 3.65));
    heroRoll = -bladeLock * 0.025;
    enemyRoll = bladeLock * 0.035;
    speed = (1 - cinematicProgress(clock, 0.2, 0.7)) * 0.18;
  } else if (exchange) {
    heroPose = exchange.heroMove;
    enemyPose = exchange.enemyMove;
    heroPoseProgress = exchange.heroProgress;
    enemyPoseProgress = exchange.enemyProgress;
    bladeLock = exchange.lock;
    heroRoll = -exchange.lock * 0.035 - exchange.dodge * 0.18;
    enemyRoll = exchange.lock * 0.04;
    speed = 0.12;
  } else if (beat.shot === "armCut") {
    heroPose = "sideSlash";
    enemyPose = clock < action + 0.05 ? "clash" : "stagger";
    heroPoseProgress = strikeProgress("sideSlash");
    enemyPoseProgress = cinematicProgress(clock, action, duration);
    enemyRoll = Math.sin(strike * Math.PI) * 0.09;
    enemyCrouch = cinematicProgress(clock, action + 0.25, duration - 0.1);
  } else if (beat.shot === "ascend") {
    heroPose = "boost";
    enemyPose = "clash";
    enemyCrouch = 1;
    heroPoseProgress = 0.15 + p * 0.7;
    enemyPoseProgress = 0.55 + p * 0.45;
    heroRoll = -Math.sin(p * Math.PI) * 0.055;
    speed = Math.sin(p * Math.PI) * 0.2;
  } else if (beat.shot === "reactor") {
    heroPose = "skyCharge";
    enemyPose = "clash";
    enemyCrouch = 1;
    heroPoseProgress = p;
    enemyPoseProgress = p * 0.65;
    heroCharge = cinematicProgress(clock, 0, duration - 0.15);
  } else if (beat.shot === "finalCut") {
    const timing = FINISHER_EXECUTION;
    const charge = cinematicProgress(clock, timing.dash, timing.vanish);
    const arrival = cinematicProgress(clock, timing.appear, timing.cuts);
    const counter = cinematicProgress(clock, timing.dash, timing.appear);
    const recover = cinematicProgress(clock, timing.appear, timing.cuts);
    enemyCrouch = 1 - cinematicProgress(clock, timing.dash, timing.vanish);
    hero =
      clock < timing.appear
        ? pointMix([-9, 16, -2], [-5, 4, -1], charge ** 1.7)
        : pointMix([18.5, 0.3, 1.2], [19, 0, 1], arrival);
    enemy = [
      6 - counter * 2.2 * (1 - recover),
      -Math.sin(counter * Math.PI) * 0.45,
      0,
    ];
    heroPose =
      clock < timing.dash
        ? "skyCharge"
        : clock < timing.appear
          ? "boost"
          : clock < timing.materialized + 0.15
            ? "reap"
            : "afterCut";
    heroPoseProgress =
      clock < timing.dash
        ? 0.88 + cinematicProgress(clock, 0, timing.dash) * 0.12
        : clock < timing.appear
          ? 0.2 + charge * 0.55
          : clock < timing.materialized + 0.15
            ? 0.68 +
              cinematicProgress(
                clock,
                timing.appear,
                timing.materialized + 0.15,
              ) *
                0.3
            : cinematicProgress(clock, timing.materialized, timing.lastCut);
    heroDissolve =
      clock < timing.appear
        ? cinematicProgress(clock, timing.vanish, timing.gone)
        : 1 - cinematicProgress(clock, timing.appear, timing.materialized);
    heroVisible = clock < timing.gone || clock >= timing.appear;
    heroCharge = clock < timing.vanish ? 1 : 0;
    barrage = cinematicProgress(clock, timing.cuts, timing.lastCut);
    heroRoll =
      clock < timing.appear
        ? -Math.sin(charge * Math.PI) * 0.18
        : (1 - arrival) * 0.065;
    heroYaw =
      clock >= timing.materialized
        ? cinematicProgress(clock, timing.materialized, timing.cuts) * 0.08
        : 0;
    enemyYaw = recover * -0.5 * (1 - barrage);
    speed =
      clock >= timing.dash && clock < timing.gone
        ? 0.18 + charge * 0.24
        : clock >= timing.cuts && clock < timing.lastCut
          ? 0.16 + Math.sin(barrage * Math.PI) * 0.16
          : 0;
    enemyPose =
      clock >= timing.collapse
        ? "defeat"
        : clock >= timing.cuts
          ? "stagger"
          : clock >= timing.dash && clock < timing.cuts
            ? "orbitalCut"
            : "clash";
    enemyPoseProgress =
      clock >= timing.collapse
        ? cinematicProgress(clock, timing.collapse, duration)
        : clock >= timing.cuts
          ? 0.2 + barrage * 0.6
          : enemyPose === "orbitalCut"
            ? swordClipTime(
                clock - timing.dash,
                MELEE_STRIKES.orbitalCut.duration,
                MELEE_STRIKES.orbitalCut,
                {
                  duration: timing.cuts - timing.dash,
                  start: timing.vanish - timing.dash - 0.08,
                  end: timing.appear - timing.dash + 0.12,
                },
              ) / MELEE_STRIKES.orbitalCut.duration
            : 0.55;
    // Sparks retain all forty cuts; the body absorbs them in six weighted reactions.
    const reaction =
      (Math.max(0, clock - timing.cuts) / (timing.lastCut - timing.cuts)) * 6;
    const hitPhase = reaction % 1;
    const hit =
      clock >= timing.cuts && clock < timing.lastCut
        ? cinematicProgress(hitPhase, 0, 0.18) *
          (1 - cinematicProgress(hitPhase, 0.18, 1))
        : 0;
    const side = Math.floor(reaction) % 2 ? 1 : -1;
    const recoil =
      clock >= timing.cuts && clock < timing.collapse
        ? Math.sin(barrage * Math.PI) * 0.055
        : 0;
    enemyRoll =
      recoil - cinematicProgress(clock, timing.collapse, duration) * 0.25;
    enemy[0] += recoil * 2;
    enemy[1] += barrage * 0.8;
    enemy[2] += recoil * 3;
    enemy[0] += hit * side * 0.18;
    enemy[1] -= hit * 0.09;
    enemy[2] += hit * side * 0.14;
    enemyRoll += hit * side * 0.025;
    enemyPitch = -hit * 0.035;
  }
  return {
    hero,
    enemy,
    heroPose,
    enemyPose,
    heroRoll,
    enemyRoll,
    enemyPitch,
    heroYaw,
    enemyYaw,
    heroPoseProgress,
    enemyPoseProgress,
    heroDissolve,
    heroVisible,
    heroCharge,
    barrage,
    speed,
    bladeLock,
    enemyCrouch,
    exchange,
    travel,
    progress: p,
  };
}
