import {
  FINALE_START_X,
  RIFLE_SEQUENCE,
  HERO_ULTIMATE,
  ENEMY_VERDICT,
  ENEMY_ORBITAL_CUT,
  FINISHER_EXECUTION,
  PLANET_RUPTURE,
  ENEMY_ATTACK_LEAPS,
  MELEE_STRIKES,
  cinematicProgress,
  isMeleeStrike,
  sampleMeleeBlade,
  MECH_DODGE,
  sampleDodgeArc,
  sampleEnemyAttackLeap,
  PHYSICAL_STRIKES,
  isPhysicalStrike,
  directionalSwordAttack,
  swordHitWindows,
  type PhysicalStrike,
  type CinematicPoint,
  type MeleeStrike,
} from "../global/finaleChoreography.js";

export type MechMove =
  | "idle"
  | "walk"
  | "verdict"
  | "missiles"
  | "guard"
  | "dash"
  | "stagger"
  | "overdrive"
  | "knockdown"
  | "defeat"
  | MeleeStrike
  | PhysicalStrike;
export type DuelPhase =
  "ground" | "rupture" | "space" | "finisher" | "lost" | "won";
export type MechSide = "hero" | "enemy";
export type MechAction = "slash" | "missiles" | "dash" | "overdrive" | "slide";
export interface DuelInput {
  move: number;
  lift: number;
  guard: boolean;
}
export interface DuelDash {
  from: number;
  to: number;
  crossing: boolean;
  evading: boolean;
  offset: { lane: number; lift: number; roll: number };
}
export interface Fighter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  energy: number;
  shield: number;
  shieldCooldown: number;
  shieldLock: number;
  move: MechMove;
  time: number;
  duration: number;
  hit: boolean;
  invulnerable: number;
  guardTime: number;
  facing: number;
  combo: number;
  volley: number;
  ultimateCooldown: number;
  aimX: number;
  aimY: number;
  aimLocked: boolean;
  dash: DuelDash | null;
  strikeHits: number;
}
export type DuelProjectileKind = "round" | "bladeWave" | "verdictBeam";
export interface DuelMissile {
  id: number;
  owner: MechSide;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  kind: DuelProjectileKind;
  damage: number;
}
export interface BladeDamageTrace {
  from: CinematicPoint;
  to: CinematicPoint;
}
export interface BladeSegment {
  base: CinematicPoint;
  tip: CinematicPoint;
}
export type DuelBladePaths = Record<MeleeStrike, readonly BladeSegment[]>;
export type DuelPhysicalPaths = Record<PhysicalStrike, readonly BladeSegment[]>;
export interface DuelEvent {
  kind:
    | "hit"
    | "parry"
    | "guard"
    | "guardBreak"
    | "launch"
    | "cut"
    | "dash"
    | "swing"
    | "special"
    | "rupture"
    | "finish"
    | "lost"
    | "tell";
  x: number;
  y: number;
  owner: MechSide;
  move: MechMove;
  attack: MechMove | null;
  damage: number;
  trace: BladeDamageTrace | null;
}
export const DUEL = Object.freeze({
  health: 1800,
  heroHealth: 1000,
  half: 900,
  range: 18,
  arena: 38,
  speed: 9,
  separation: 7,
  slashDamage: 58,
  cleaveDamage: 96,
  missileDamage: 22,
  parryWindow: 0.24,
  parryCost: 12,
  shieldMax: 100,
  shieldDrain: 24,
  shieldRegen: 34,
  shieldRegenDelay: 0.8,
  shieldBreak: 2.2,
  shieldHitScale: 0.5,
  shieldRadius: 10.5,
  spaceShield: 55,
  overdriveDamage: 245,
  verdictDamage: 64,
  orbitalCutDamage: 112,
  specialSeconds: HERO_ULTIMATE.duration,
  ultimateCooldown: HERO_ULTIMATE.cooldown,
  counterWindow: 0.55,
  step: 1 / 120,
  repair: 240,
  slideKnockdown: 1.8,
  enemyReaction: 0.2,
  enemyDefenseCooldown: 2.6,
  enemyGuardDuration: 1.15,
  enemyRushCooldown: 2.5,
});
export const BOSS_IMMUNITY_SECONDS = 30;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const neutralInput = (): DuelInput => ({ move: 0, lift: 0, guard: false });
const busy = (f: Fighter) =>
  f.move !== "idle" && f.move !== "walk" && f.move !== "guard";
const fighter = (
  x: number,
  health: number,
  facing: number,
  shield = 0,
): Fighter => ({
  x,
  y: 0,
  vx: 0,
  vy: 0,
  health,
  energy: 100,
  shield,
  shieldCooldown: 0,
  shieldLock: 0,
  move: "idle",
  time: 0,
  duration: 0,
  hit: false,
  invulnerable: 0,
  guardTime: 10,
  facing,
  combo: 0,
  volley: 0,
  ultimateCooldown: 0,
  aimX: 0,
  aimY: 0,
  aimLocked: false,
  dash: null,
  strikeHits: 0,
});

function frameTime(dt: number) {
  if (!Number.isFinite(dt) || dt < 0)
    throw new RangeError(
      "Mech simulation requires a finite, nonnegative delta",
    );
  return Math.min(dt, 0.1);
}

// Swept, scaled-circle contact prevents fast missiles tunnelling through either mech.
function missileContact(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  target: Fighter,
  radius = 1,
  shield = false,
) {
  const rx = shield ? DUEL.shieldRadius : 3.2 * radius,
    ry = shield ? DUEL.shieldRadius : 5.8 * radius;
  const x = (ax - target.x) / rx,
    y = (ay - target.y - 7.5) / ry;
  const dx = (bx - ax) / rx,
    dy = (by - ay) / ry;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? clamp(-(x * dx + y * dy) / length, 0, 1) : 0;
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 <= 1;
}

function bladePoint(point: CinematicPoint, fighter: Fighter): CinematicPoint {
  return [
    fighter.x + point[2] * fighter.facing,
    fighter.y + point[1],
    point[0] * fighter.facing,
  ];
}

function sampledBlade(
  move: MeleeStrike,
  time: number,
  paths?: DuelBladePaths,
): BladeSegment {
  if (!paths) return sampleMeleeBlade(move, time);
  const frames = paths[move],
    frame =
      clamp(time / MELEE_STRIKES[move].duration, 0, 1) * (frames.length - 1);
  const a = frames[Math.floor(frame)],
    b = frames[Math.min(Math.floor(frame) + 1, frames.length - 1)];
  const alpha = frame % 1;
  const mix = (from: CinematicPoint, to: CinematicPoint): CinematicPoint => [
    from[0] + (to[0] - from[0]) * alpha,
    from[1] + (to[1] - from[1]) * alpha,
    from[2] + (to[2] - from[2]) * alpha,
  ];
  return { base: mix(a.base, b.base), tip: mix(a.tip, b.tip) };
}

function bladeContact(
  move: MeleeStrike,
  before: number,
  after: number,
  attacker: Fighter,
  target: Fighter,
  paths?: DuelBladePaths,
  shield = false,
  strike: { start: number; end: number } = MELEE_STRIKES[move],
) {
  if (after < strike.start || before > strike.end) return false;
  const start = Math.max(before, strike.start),
    end = Math.min(after, strike.end);
  for (let sample = 0; sample <= 3; sample++) {
    const blade = sampledBlade(
      move,
      start + ((end - start) * sample) / 3,
      paths,
    );
    const a = bladePoint(blade.base, attacker),
      b = bladePoint(blade.tip, attacker);
    const rx = shield ? DUEL.shieldRadius : 3.2,
      ry = shield ? DUEL.shieldRadius : 6.2;
    const rz = shield ? DUEL.shieldRadius : 3.4,
      cy = shield ? 7.5 : 8.6;
    const origin = [
      (a[0] - target.x) / rx,
      (a[1] - target.y - cy) / ry,
      a[2] / rz,
    ];
    const delta = [(b[0] - a[0]) / rx, (b[1] - a[1]) / ry, (b[2] - a[2]) / rz];
    const length = delta.reduce((sum, value) => sum + value * value, 0);
    const t = clamp(
      -origin.reduce((sum, value, axis) => sum + value * delta[axis], 0) /
        Math.max(length, 1e-8),
      0,
      1,
    );
    if (
      origin.reduce(
        (sum, value, axis) => sum + (value + delta[axis] * t) ** 2,
        0,
      ) <= 1
    )
      return true;
  }
  return false;
}

function physicalContact(
  move: PhysicalStrike,
  before: number,
  after: number,
  attacker: Fighter,
  target: Fighter,
  paths: DuelPhysicalPaths,
  shield: boolean,
) {
  const strike = PHYSICAL_STRIKES[move];
  if (after < strike.start || before > strike.end) return false;
  const frames = paths[move];
  for (let sample = 0; sample <= 4; sample++) {
    const time =
      Math.max(before, strike.start) +
      ((Math.min(after, strike.end) - Math.max(before, strike.start)) *
        sample) /
        4;
    const frame = clamp(time / strike.duration, 0, 1) * (frames.length - 1),
      alpha = frame % 1;
    const a = frames[Math.floor(frame)],
      b = frames[Math.min(Math.floor(frame) + 1, frames.length - 1)];
    const mix = (from: CinematicPoint, to: CinematicPoint): CinematicPoint =>
      from.map(
        (value, axis) => value + (to[axis] - value) * alpha,
      ) as CinematicPoint;
    const from = bladePoint(mix(a.base, b.base), attacker),
      to = bladePoint(mix(a.tip, b.tip), attacker);
    const radii = shield
      ? [DUEL.shieldRadius, DUEL.shieldRadius, DUEL.shieldRadius]
      : [3.6, 7, 3.8];
    const origin = [
      (from[0] - target.x) / radii[0],
      (from[1] - target.y - 7.4) / radii[1],
      from[2] / radii[2],
    ];
    const delta = from.map((value, axis) => (to[axis] - value) / radii[axis]);
    const length = delta.reduce((sum, value) => sum + value * value, 0);
    const t = clamp(
      -origin.reduce((sum, value, axis) => sum + value * delta[axis], 0) /
        Math.max(length, 1e-8),
      0,
      1,
    );
    if (
      origin.reduce(
        (sum, value, axis) => sum + (value + delta[axis] * t) ** 2,
        0,
      ) <= 1
    )
      return true;
  }
  return false;
}

export function sampleBladeDamageTrace(
  move: MeleeStrike,
  attacker: Fighter,
  target: Fighter,
  paths?: DuelBladePaths,
): BladeDamageTrace {
  const strike = MELEE_STRIKES[move],
    points: CinematicPoint[] = [];
  const plane = Math.abs(target.x - attacker.x) - 2.2;
  for (let sample = 0; sample <= 32; sample++) {
    const blade = sampledBlade(
      move,
      strike.start + ((strike.end - strike.start) * sample) / 32,
      paths,
    );
    const distance = (plane - blade.base[2]) / (blade.tip[2] - blade.base[2]);
    if (distance < 0 || distance > 1 || !Number.isFinite(distance)) continue;
    const local: CinematicPoint = [
      blade.base[0] + (blade.tip[0] - blade.base[0]) * distance,
      blade.base[1] + (blade.tip[1] - blade.base[1]) * distance,
      plane,
    ];
    const point = bladePoint(local, attacker);
    if (
      Math.abs(point[2]) <= 3.8 &&
      point[1] >= target.y + 3 &&
      point[1] <= target.y + 15
    )
      points.push(point);
  }
  if (points.length >= 2 && move !== "thrust")
    return { from: points[0], to: points[points.length - 1] };
  const impact: CinematicPoint = [
    target.x - attacker.facing * 2.2,
    target.y + 10,
    -attacker.facing,
  ];
  return {
    from: [impact[0], impact[1] - 0.5, impact[2]],
    to: [impact[0], impact[1] + 0.5, impact[2]],
  };
}

export const LOCAL_DUEL = Object.freeze({
  health: 1000,
  bombImpact: 1.6,
  bombSeconds: 2.2,
  spaceArena: 160,
  spaceFloor: -55,
  spaceCeiling: 95,
  spaceSpeed: 18,
  ultimateDamage: 300,
  revengeDamage: 270,
  finalVerdictDamage: 280,
});
export type LocalMechAction = MechAction | "ultimate";
export const LOCAL_SPECIAL_NAMES = {
  hero: ["BRANDEN'S TEARS", "BRENDAN'S WILL", "BRONDON'S REVENGE"],
  enemy: ["REBEL", "ECLIPSE", "FINAL VERDICT"],
} as const;

/** Two human fighters share contact rules, but never run campaign AI or phase gates. */
export function createLocalMechDuel(characters: readonly [MechSide, MechSide]) {
  const fighters = [
    Object.assign(fighter(-FINALE_START_X, LOCAL_DUEL.health, 1, DUEL.shieldMax),
      { ultimateCharge: 0, ultimateActive: false, teleported: false }),
    Object.assign(fighter(FINALE_START_X, LOCAL_DUEL.health, -1, DUEL.shieldMax),
      { ultimateCharge: 0, ultimateActive: false, teleported: false }),
  ] as const;
  const inputs = [neutralInput(), neutralInput()];
  const parry = [false, false], guardDown = [false, false], comboTimes = [0, 0];
  const paths: Array<DuelBladePaths | undefined> = [];
  const physical: Array<DuelPhysicalPaths | undefined> = [];
  const dashHeights: Array<{ from: number; to: number } | null> = [null, null];
  const missiles: Array<DuelMissile & { localAttack: MechMove; charged: boolean }> = [], events: DuelEvent[] = [];
  let phase: "fight" | "bomb" | "won" = "fight";
  let stage: "ground" | "space" = "ground";
  let time = 0, bombTime = 0, bombX: number | null = null;
  let winner: 0 | 1 | null = null, hitStop = 0, projectileId = 0, priority = 0;
  const arenaSize = () => stage === "space" ? LOCAL_DUEL.spaceArena : DUEL.arena;
  const owner = (index: number): MechSide => index === 0 ? "hero" : "enemy";
  const emit = (kind: DuelEvent["kind"], index: number, target: Fighter, attack: MechMove | null,
    damage = 0, trace: BladeDamageTrace | null = null) => {
    events.push({ kind, owner: owner(index), x: target.x, y: target.y + 8,
      move: fighters[index].move, attack, damage, trace });
  };
  function move(index: number, name: MechMove, duration: number) {
    const f = fighters[index];
    f.move = name;
    f.time = 0;
    f.duration = duration;
    f.hit = false;
    f.strikeHits = f.volley = 0;
    f.dash = null;
    dashHeights[index] = null;
    f.ultimateActive = f.teleported = false;
    f.aimLocked = false;
  }
  function clearInput() {
    for (let i = 0; i < 2; i++) {
      inputs[i] = neutralInput();
      parry[i] = guardDown[i] = false;
      fighters[i].guardTime = 10;
    }
  }
  const guarding = (index: number) => inputs[index].guard &&
    fighters[index].shield > 0 && fighters[index].shieldLock <= 0 &&
    !busy(fighters[index]);
  function outcome() {
    const dead = fighters.findIndex((f) => f.health <= 0);
    if (dead >= 0) {
      winner = dead === 0 ? 1 : 0;
      phase = "won";
      move(dead, "defeat", 3);
      move(winner, "idle", 3);
      emit("finish", winner, fighters[dead], null);
    } else if (bombX === null && fighters.some((f) => f.health <= LOCAL_DUEL.health / 2)) {
      bombX = (fighters[0].x + fighters[1].x) / 2;
      phase = "bomb";
      bombTime = 0;
      for (let i = 0; i < 2; i++) move(i, "idle", 0);
      emit("rupture", 0, { ...fighters[0], x: bombX }, null);
    }
    if (phase !== "fight") {
      missiles.length = 0;
      for (const f of fighters) f.vx = f.vy = 0;
      clearInput();
    }
  }
  function hurt(index: number, damage: number, attack: MechMove, charged = false, trace: BladeDamageTrace | null = null) {
    const targetIndex = 1 - index, f = fighters[index], target = fighters[targetIndex];
    if (phase !== "fight" || target.invulnerable > 0) return;
    if (guarding(targetIndex)) {
      const perfect = parry[targetIndex] && target.guardTime <= DUEL.parryWindow && target.shield >= DUEL.parryCost;
      parry[targetIndex] = false;
      target.shield = Math.max(0, target.shield - (perfect ? DUEL.parryCost : damage * DUEL.shieldHitScale));
      target.shieldCooldown = DUEL.shieldRegenDelay;
      emit(perfect ? "parry" : "guard", index, target, attack);
      if (isMeleeStrike(attack) || attack === "slide") {
        move(index, "stagger", perfect ? 0.85 : 0.35);
        f.vx = -f.facing * 6;
      }
      if (target.shield === 0) {
        target.shieldLock = DUEL.shieldBreak;
        move(targetIndex, "stagger", 0.7);
        emit("guardBreak", index, target, attack);
      }
      hitStop = perfect ? 0.09 : 0.045;
      return;
    }
    const dealt = Math.min(target.health, damage);
    target.health -= dealt;
    if (!charged)
      f.ultimateCharge = Math.min(LOCAL_DUEL.ultimateDamage, f.ultimateCharge + dealt);
    target.invulnerable = 0.18;
    move(targetIndex, attack === "slide" ? "knockdown" : "stagger", attack === "slide" ? DUEL.slideKnockdown : 0.42);
    target.vx = f.facing * 5;
    emit("hit", index, target, attack, dealt, trace);
    hitStop = 0.065;
    outcome();
  }
  function act(index: 0 | 1, action: LocalMechAction) {
    const f = fighters[index], target = fighters[1 - index];
    if (phase !== "fight" || busy(f)) return false;
    f.facing = Math.sign(target.x - f.x) || f.facing;
    if (action === "slash") {
      f.combo = comboTimes[index] > 0 ? (f.combo + 1) % 3 : 0;
      const attack = directionalSwordAttack(inputs[index].move, inputs[index].lift, f.combo);
      move(index, attack, MELEE_STRIKES[attack].duration);
      comboTimes[index] = f.duration + 0.7;
      emit("swing", index, f, attack);
    } else if (action === "dash" || action === "slide") {
      if (action === "slide" && stage === "space") return false;
      if (f.energy < 14) return false;
      f.energy -= 14;
      const direction = Math.sign(inputs[index].move) || (action === "slide" ? f.facing : -f.facing);
      const lift = stage === "space" ? inputs[index].lift : 0;
      const dx = stage === "space" && Math.hypot(inputs[index].move, lift) > 0
        ? inputs[index].move : direction;
      const length = Math.max(1, Math.hypot(dx, lift));
      const distance = MECH_DODGE.distance * (stage === "space" ? 1.5 : 1);
      move(index, action, action === "slide" ? PHYSICAL_STRIKES.slide.duration : MECH_DODGE.duration);
      f.dash = { from: f.x, to: clamp(f.x + dx / length * distance, -arenaSize(), arenaSize()),
        crossing: false, evading: true, offset: { lane: 0, lift: 0, roll: 0 } };
      if (stage === "space")
        dashHeights[index] = { from: f.y, to: clamp(f.y + lift / length * distance, LOCAL_DUEL.spaceFloor, LOCAL_DUEL.spaceCeiling) };
      f.invulnerable = action === "dash" ? f.duration : 0.3;
      emit("dash", index, f, action);
    } else if (action === "missiles") {
      if (f.energy < 38) return false;
      f.energy -= 38;
      const attack = characters[index] === "hero" ? "missiles" : "verdict";
      move(index, attack, attack === "missiles" ? RIFLE_SEQUENCE.swordReady : ENEMY_VERDICT.duration);
      emit("special", index, f, attack);
    } else if (action === "overdrive") {
      if (f.ultimateCooldown > 0) return false;
      f.ultimateCooldown = DUEL.ultimateCooldown;
      const attack = characters[index] === "hero" ? "overdrive" : "orbitalCut";
      move(index, attack, attack === "overdrive" ? HERO_ULTIMATE.duration : ENEMY_ORBITAL_CUT.duration);
      if (attack === "orbitalCut") {
        f.dash = { from: f.x, to: clamp(target.x + f.facing * 12, -arenaSize(), arenaSize()),
          crossing: true, evading: false, offset: { lane: 0, lift: 0, roll: 0 } };
        if (stage === "space") dashHeights[index] = { from: f.y, to: target.y };
      }
      emit("special", index, f, attack);
    } else {
      if (f.ultimateCharge < LOCAL_DUEL.ultimateDamage) return false;
      const attack = characters[index] === "hero" ? "overdrive" : "orbitalCut";
      move(index, attack, attack === "overdrive" ? FINISHER_EXECUTION.collapse : ENEMY_ORBITAL_CUT.duration);
      f.ultimateCharge = 0;
      f.ultimateActive = true;
      f.invulnerable = 0.4;
      emit("special", index, f, attack);
    }
    return true;
  }
  function launch(index: number, kind: DuelProjectileKind) {
    const f = fighters[index], target = fighters[1 - index];
    const x = f.x + f.facing * (kind === "round" ? 4.8 : kind === "bladeWave" ? 4.2 : 13.2);
    const y = f.y + (kind === "bladeWave" ? 8.6 : 10.5);
    const dx = (f.aimLocked ? f.aimX : target.x) - x;
    const dy = (f.aimLocked ? f.aimY : target.y + 9) - y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const speed = kind === "round" ? 55 : 43;
    missiles.push({ id: projectileId++, owner: owner(index), x,
      y, vx: dx / length * speed, vy: dy / length * speed,
      life: Math.max(3, length / speed + 0.6), age: 0, kind,
      localAttack: f.move, charged: f.ultimateActive,
      damage: f.ultimateActive ? LOCAL_DUEL.finalVerdictDamage :
        kind === "bladeWave" ? DUEL.overdriveDamage : kind === "round" ? DUEL.missileDamage : DUEL.missileDamage * 5 });
    if (!f.aimLocked) {
      f.aimX = target.x;
      f.aimY = target.y + 9;
    }
    emit("launch", index, f, f.move);
  }
  function step(dt: number) {
    time += dt;
    if (phase === "won") {
      for (const f of fighters) f.time += dt;
      return;
    }
    if (phase === "bomb") {
      bombTime += dt;
      if (bombTime >= LOCAL_DUEL.bombSeconds) {
        phase = "fight";
        stage = "space";
        clearInput();
        const order = Math.sign(fighters[1].x - fighters[0].x) || 1;
        for (const i of [0, 1]) {
          const f = fighters[i];
          f.x = (i === 0 ? -24 : 24) * order;
          f.y = f.vx = f.vy = 0;
          f.invulnerable = 0.5;
        }
      }
      return;
    }
    if (hitStop > 0) { hitStop = Math.max(0, hitStop - dt); return; }
    for (let i = 0; i < 2; i++) {
      const f = fighters[i], target = fighters[1 - i];
      if (inputs[i].guard && !guardDown[i]) { parry[i] = true; f.guardTime = 0; }
      if (!inputs[i].guard) parry[i] = false;
      guardDown[i] = inputs[i].guard;
      f.ultimateCooldown = Math.max(0, f.ultimateCooldown - dt);
      f.invulnerable = Math.max(0, f.invulnerable - dt);
      f.shieldLock = Math.max(0, f.shieldLock - dt);
      f.shieldCooldown = Math.max(0, f.shieldCooldown - dt);
      comboTimes[i] = Math.max(0, comboTimes[i] - dt);
      f.energy = clamp(f.energy + dt * 12, 0, 100);
      if (guarding(i)) {
        f.guardTime += dt;
        f.shieldCooldown = DUEL.shieldRegenDelay;
        f.shield = Math.max(0, f.shield - dt * DUEL.shieldDrain);
        if (f.shield === 0) f.shieldLock = DUEL.shieldBreak;
      } else if (!inputs[i].guard && f.shieldCooldown === 0 && f.shieldLock === 0)
        f.shield = Math.min(DUEL.shieldMax, f.shield + dt * DUEL.shieldRegen);
      if (!busy(f)) {
        f.facing = Math.sign(target.x - f.x) || f.facing;
        f.move = guarding(i) ? "guard" : inputs[i].move || (stage === "space" && inputs[i].lift) ? "walk" : "idle";
        const speed = stage === "space" ? LOCAL_DUEL.spaceSpeed : DUEL.speed;
        const length = stage === "space" ? Math.max(1, Math.hypot(inputs[i].move, inputs[i].lift)) : 1;
        f.vx += ((guarding(i) ? 0 : inputs[i].move / length * speed) - f.vx) * (1 - Math.exp(-dt * 9));
        f.vy += ((stage === "space" && !guarding(i) ? inputs[i].lift / length * speed : 0) - f.vy) * (1 - Math.exp(-dt * 9));
      } else if (!f.dash) {
        f.vx *= Math.exp(-dt * 14);
        f.vy *= Math.exp(-dt * 14);
      }
      if (stage === "space" && !dashHeights[i])
        f.y = clamp(f.y + f.vy * dt, LOCAL_DUEL.spaceFloor, LOCAL_DUEL.spaceCeiling);
      if (f.ultimateActive && characters[i] === "hero" &&
          !f.teleported && f.time + dt >= FINISHER_EXECUTION.appear) {
        target.x = clamp(target.x, -arenaSize() + DUEL.separation + 1, arenaSize() - DUEL.separation - 1);
        f.x = target.x - target.facing * (DUEL.separation + 1);
        f.y = target.y;
        f.facing = target.facing;
        f.teleported = true;
        emit("dash", i, f, "overdrive");
      }
      if (f.ultimateActive && characters[i] === "hero" &&
          f.time >= FINISHER_EXECUTION.vanish && f.time < FINISHER_EXECUTION.materialized)
        f.invulnerable = Math.max(f.invulnerable, dt * 2);
      if (f.dash) {
        const p = f.move === "orbitalCut"
          ? cinematicProgress(f.time + dt, ENEMY_ORBITAL_CUT.release - 0.18, ENEMY_ORBITAL_CUT.cross)
          : cinematicProgress(f.time + dt, 0, f.duration);
        f.x = f.dash.from + (f.dash.to - f.dash.from) * p;
        const height = dashHeights[i];
        if (height) f.y = height.from + (height.to - height.from) * p;
        if (f.move === "orbitalCut" && p >= 1) {
          f.dash = null;
          dashHeights[i] = null;
        }
      } else f.x = clamp(f.x + f.vx * dt, -arenaSize(), arenaSize());
    }
    const separation = 9;
    if (!fighters.some((f) => f.move === "orbitalCut" && f.dash) &&
        Math.abs(fighters[0].y - fighters[1].y) < 12 &&
        Math.abs(fighters[1].x - fighters[0].x) < separation) {
      const order = fighters[0].facing;
      const center = clamp((fighters[0].x + fighters[1].x) / 2, -arenaSize() + separation / 2, arenaSize() - separation / 2);
      fighters[0].x = center - order * separation / 2;
      fighters[1].x = center + order * separation / 2;
      for (const f of fighters) { f.vx = 0; if (f.dash) f.dash.to = f.x; }
    }
    // Simultaneous close sword attacks clash instead of giving one player update-order priority.
    const [a, b] = fighters;
    if (!a.ultimateActive && !b.ultimateActive &&
        isMeleeStrike(a.move) && isMeleeStrike(b.move) &&
        bladeContact(a.move, a.time, a.time + dt, a, b, paths[0]) &&
        bladeContact(b.move, b.time, b.time + dt, b, a, paths[1])) {
      emit("parry", 0, { ...a, x: (a.x + b.x) / 2 }, a.move);
      move(0, "stagger", 0.32); move(1, "stagger", 0.32);
      hitStop = 0.09;
      return;
    }
    for (const i of (++priority % 2 ? [0, 1] : [1, 0])) {
      if (phase !== "fight") break;
      const f = fighters[i], target = fighters[1 - i], attack = f.move, before = f.time;
      f.time += dt;
      if (attack === "verdict" && !f.aimLocked && f.time >= ENEMY_VERDICT.cameraEnd) {
        f.aimLocked = true;
        f.aimX = target.x;
        f.aimY = target.y + 9;
      }
      if (f.ultimateActive && characters[i] === "hero") {
        const cuts = 6;
        while (f.strikeHits < cuts && f.time >= FINISHER_EXECUTION.cuts +
            f.strikeHits * (FINISHER_EXECUTION.lastCut - FINISHER_EXECUTION.cuts) / (cuts - 1)) {
          f.strikeHits++;
          if (Math.abs(f.x - target.x) <= DUEL.range && Math.abs(f.y - target.y) < 12)
            hurt(i, LOCAL_DUEL.revengeDamage / cuts, attack, true);
          if (phase !== "fight" || !f.ultimateActive) break;
        }
      } else if (attack === "missiles") {
        while (f.volley < 5 && f.time >= RIFLE_SEQUENCE.fire + f.volley * 0.14) {
          f.volley++; launch(i, "round");
        }
      } else if ((attack === "overdrive" || attack === "verdict" ||
          (attack === "orbitalCut" && f.ultimateActive)) && !f.hit &&
        f.time >= (attack === "overdrive" ? HERO_ULTIMATE.release :
          attack === "orbitalCut" ? ENEMY_ORBITAL_CUT.release : ENEMY_VERDICT.release)) {
        f.hit = true; launch(i, attack === "verdict" ? "verdictBeam" : "bladeWave");
      } else if (attack === "slide" && !f.hit && physical[i] &&
        physicalContact("slide", before, f.time, f, target, physical[i]!, guarding(1 - i))) {
        f.hit = true; hurt(i, PHYSICAL_STRIKES.slide.damage, attack);
      } else if (isMeleeStrike(attack)) {
        for (const [hit, window] of swordHitWindows(attack).entries()) {
          if ((f.strikeHits & (1 << hit)) || !bladeContact(attack, before, f.time, f, target, paths[i], guarding(1 - i), window)) continue;
          f.strikeHits |= 1 << hit;
          hurt(i, attack === "orbitalCut" ? DUEL.orbitalCutDamage :
            attack === "heavyCombo" ? 64 : attack === "regularCombo" ? 42 :
              attack === "cleave" || attack === "reap" ? DUEL.cleaveDamage :
                attack === "thrust" ? 72 : DUEL.slashDamage,
          attack, false, sampleBladeDamageTrace(attack, f, target, paths[i]));
          if (phase !== "fight" || f.move !== attack) break;
        }
      }
      if (phase === "fight" && busy(f) && f.time >= f.duration) move(i, "idle", 0);
    }
    for (let i = missiles.length - 1; i >= 0 && phase === "fight"; i--) {
      const m = missiles[i], index = m.owner === "hero" ? 0 : 1;
      const x = m.x, y = m.y;
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt; m.age += dt;
      const target = fighters[1 - index];
      if (missileContact(x, y, m.x, m.y, target, m.kind === "bladeWave" ? 1.2 : 1, guarding(1 - index))) {
        const trace: BladeDamageTrace | null = m.kind === "bladeWave"
          ? { from: [target.x, target.y + 4, -2.7], to: [target.x, target.y + 13.5, 2.7] } : null;
        hurt(index, m.damage, m.localAttack, m.charged, trace);
        m.life = 0;
      }
      if (phase === "fight" && m.life <= 0) missiles.splice(i, 1);
    }
  }
  return {
    fighters, missiles, act, clearInput, guarding,
    setPaths(index: 0 | 1, blade: DuelBladePaths, contacts: DuelPhysicalPaths) { paths[index] = blade; physical[index] = contacts; },
    setInput(index: 0 | 1, value: DuelInput) {
      inputs[index] = { move: clamp(Number.isFinite(value.move) ? value.move : 0, -1, 1),
        lift: clamp(Number.isFinite(value.lift) ? value.lift : 0, -1, 1), guard: value.guard };
    },
    update(dt: number) {
      let remaining = frameTime(dt);
      while (remaining > 1e-9) { const delta = Math.min(DUEL.step, remaining); step(delta); remaining -= delta; }
    },
    drainEvents: () => events.splice(0),
    getState: () => ({ phase, stage, time, bombTime, bombX, winner }),
  };
}

export function createMechDuel(
  start: "ground" | "rupture" | "space" | "finisher" = "ground",
  {
    bossImmunityAvailable = false,
    bossImmunityUsed = false,
  }: { bossImmunityAvailable?: boolean; bossImmunityUsed?: boolean } = {},
) {
  const hero = fighter(-FINALE_START_X, DUEL.heroHealth, 1, DUEL.shieldMax);
  const enemy = fighter(
    FINALE_START_X,
    start === "ground"
      ? DUEL.health
      : start === "space" || start === "rupture"
        ? DUEL.half
        : 0,
    -1,
    DUEL.shieldMax,
  );
  let phase: DuelPhase = start,
    time = 0,
    sync = 0,
    combo = 0,
    comboClock = 0;
  let bossImmunityRemaining = 0;
  let aiClock = 2.1,
    aiPattern = 0,
    missileId = 0,
    hitStop = 0,
    guardWasDown = false,
    parryArmed = false;
  let defenseClock = 0.12,
    defensePattern = 0,
    threatTime = 0,
    rushClock = 0.65;
  let enemyLeap: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null = null;
  let orbitalArc: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null = null;
  let input = neutralInput(),
    bufferedSlash = 0,
    feedback = "";
  let bufferedDirection: { x: number; y: number } | null = null;
  const missiles: DuelMissile[] = [],
    events: DuelEvent[] = [];
  const bladePaths: Partial<Record<MechSide, DuelBladePaths>> = {};
  let physicalPaths: DuelPhysicalPaths | null = null;
  const live = () => phase === "ground" || phase === "space";
  function emit(
    kind: DuelEvent["kind"],
    f: Fighter,
    owner: MechSide,
    damage = 0,
    attack: MechMove | null = null,
    trace: BladeDamageTrace | null = null,
  ) {
    events.push({
      kind,
      x: f.x,
      y: f.y + 8,
      owner,
      move: f.move,
      attack,
      damage,
      trace,
    });
  }
  function move(f: Fighter, name: MechMove, duration: number) {
    f.move = name;
    f.time = 0;
    f.duration = duration;
    f.hit = false;
    f.volley = 0;
    f.aimLocked = false;
    f.strikeHits = 0;
    if (f === enemy) {
      enemyLeap = null;
      orbitalArc = null;
      if (name === "thrust" || name === "verdict") {
        const leap = ENEMY_ATTACK_LEAPS[name];
        const distance =
          name === "verdict"
            ? -leap.distance
            : Math.min(
                leap.distance,
                Math.max(0, Math.abs(hero.x - f.x) - DUEL.separation - 1),
              );
        enemyLeap = {
          fromX: f.x,
          fromY: f.y,
          toX: clamp(f.x + f.facing * distance, -DUEL.arena, DUEL.arena),
          toY: phase === "space" ? (name === "thrust" ? hero.y : f.y) : 0,
        };
        f.vx = f.vy = 0;
      }
    }
  }
  function tickEnemyLeap(dt: number) {
    if (!enemyLeap || (enemy.move !== "thrust" && enemy.move !== "verdict"))
      return false;
    const sample = sampleEnemyAttackLeap(enemy.move, enemy.time + dt);
    enemy.x =
      enemyLeap.fromX + (enemyLeap.toX - enemyLeap.fromX) * sample.progress;
    enemy.y =
      enemyLeap.fromY +
      (enemyLeap.toY - enemyLeap.fromY) * sample.progress +
      sample.lift;
    enemy.vx = enemy.vy = 0;
    if (enemy.time + dt >= ENEMY_ATTACK_LEAPS[enemy.move].land) {
      enemy.y = enemyLeap.toY;
      enemyLeap = null;
    }
    return true;
  }
  function special() {
    const f =
      hero.move === "overdrive" || hero.move === "missiles"
        ? hero
        : enemy.move === "verdict" || enemy.move === "orbitalCut"
          ? enemy
          : null;
    if (!f) return null;
    const cameraEnd =
      f.move === "missiles"
        ? RIFLE_SEQUENCE.cameraEnd
        : f.move === "verdict"
          ? ENEMY_VERDICT.cameraEnd
          : f.move === "orbitalCut"
            ? ENEMY_ORBITAL_CUT.cameraEnd
            : HERO_ULTIMATE.cameraEnd;
    const release =
      f.move === "missiles"
        ? RIFLE_SEQUENCE.fire
        : f.move === "verdict"
          ? ENEMY_VERDICT.release
          : f.move === "orbitalCut"
            ? ENEMY_ORBITAL_CUT.release
            : HERO_ULTIMATE.release;
    return {
      owner: f === hero ? ("hero" as const) : ("enemy" as const),
      kind: f.move,
      time: f.time,
      duration: f.duration,
      cinematic: f.time < cameraEnd,
      counterRemaining: Math.max(0, release - f.time),
    };
  }
  const guarding = (f = hero) =>
    live() &&
    (f === hero ? input.guard : f.move === "guard") &&
    f.shield > 0 &&
    f.shieldLock <= 0 &&
    f.move !== "stagger" &&
    f.move !== "knockdown" &&
    f.move !== "defeat" &&
    f.move !== "dash" &&
    !special()?.cinematic;
  function breakShield(f = hero) {
    f.shield = 0;
    f.shieldLock = f.shieldCooldown = DUEL.shieldBreak;
    if (f === hero) parryArmed = false;
    else defenseClock = DUEL.shieldBreak;
    move(f, "stagger", 0.7);
    emit("guardBreak", f, f === hero ? "enemy" : "hero", 0, "guard");
  }
  function startDash(
    f: Fighter,
    direction: number,
    evading: boolean,
    crossing = false,
  ) {
    const target = f === hero ? enemy : hero;
    const offset = f.dash
      ? sampleDodgeArc(f.time, f.duration, f.dash.crossing, f.dash.offset)
      : { lane: 0, lift: 0, roll: 0 };
    const landing = target.x + direction * MECH_DODGE.clearance;
    crossing = crossing && Math.abs(landing) <= DUEL.arena;
    const distance =
      !evading && f === enemy
        ? Math.min(
            MECH_DODGE.distance,
            Math.max(0, Math.abs(target.x - f.x) - 13),
          )
        : MECH_DODGE.distance;
    const end = crossing
      ? landing
      : clamp(f.x + direction * distance, -DUEL.arena, DUEL.arena);
    move(f, "dash", crossing ? MECH_DODGE.crossDuration : MECH_DODGE.duration);
    f.dash = {
      from: f.x,
      to: end,
      crossing,
      evading,
      offset: { lane: offset.lane, lift: offset.lift, roll: offset.roll },
    };
    f.vx = (end - f.x) / f.duration;
    f.invulnerable = evading ? f.duration : 0;
    emit("dash", f, f === hero ? "hero" : "enemy", 0, "dash");
  }
  function checkOutcome() {
    if (!live()) return;
    if (hero.health <= 0) {
      phase = "lost";
      move(hero, "defeat", 4);
      emit("lost", hero, "enemy");
    } else if (phase === "ground" && enemy.health <= DUEL.half) {
      enemy.health = DUEL.half;
      phase = "rupture";
      emit("rupture", enemy, "enemy");
    } else if (phase === "space" && enemy.health <= 0) {
      enemy.health = 0;
      phase = "finisher";
      move(enemy, "stagger", 4);
      emit("finish", enemy, "hero");
    }
    if (!live()) {
      missiles.length = 0;
      bufferedSlash = 0;
      input = neutralInput();
    }
  }
  function hurt(
    target: Fighter,
    damage: number,
    owner: MechSide,
    blockable = true,
    attack?: MechMove,
    trace: BladeDamageTrace | null = null,
  ): "hit" | "guard" | "parry" | "evade" {
    if (!live()) return "evade";
    if (target === hero && bossImmunityRemaining > 0) return "evade";
    const attacker = owner === "hero" ? hero : enemy;
    const attackMove = attack ?? attacker.move;
    if (blockable && guarding(target)) {
      target.shieldCooldown = DUEL.shieldRegenDelay;
      const perfect =
        target === hero &&
        parryArmed &&
        target.guardTime <= DUEL.parryWindow &&
        target.shield >= DUEL.parryCost;
      const cost = perfect ? DUEL.parryCost : damage * DUEL.shieldHitScale;
      target.shield = Math.max(0, target.shield - cost);
      if (isMeleeStrike(attackMove) || isPhysicalStrike(attackMove)) {
        move(attacker, "stagger", perfect ? 1.3 : 0.6);
        attacker.vx = -attacker.facing * (perfect ? 13 : 8);
      }
      const impact = {
        ...target,
        x: target.x + Math.sign(attacker.x - target.x) * 8.5,
      };
      if (perfect) {
        parryArmed = false;
        sync = clamp(sync + 28, 0, 100);
        hitStop = 0.1;
        emit("parry", impact, owner, 0, attackMove);
      } else {
        emit("guard", impact, owner, damage, attackMove);
        hitStop = Math.max(hitStop, 0.055);
      }
      if (target.shield <= 1e-7) breakShield(target);
      return perfect ? "parry" : "guard";
    }
    if (target.invulnerable > 0) return "evade";
    const knockedDown = target === enemy && attackMove === "slide";
    move(
      target,
      knockedDown ? "knockdown" : "stagger",
      knockedDown ? DUEL.slideKnockdown : 0.46,
    );
    target.health = Math.max(0, target.health - damage);
    target.invulnerable = 0.18;
    target.dash = null;
    if (knockedDown) {
      target.vx = attacker.facing * 10;
      feedback = "SLIDE TACKLE / KNOCKDOWN";
    }
    if (target === enemy) defenseClock = Math.max(defenseClock, 0.7);
    sync = clamp(sync + (owner === "hero" ? 12 : 4), 0, 100);
    emit("hit", target, owner, damage, attackMove, trace);
    hitStop = Math.max(hitStop, 0.065);
    checkOutcome();
    return target.move === "guard" ? "guard" : "hit";
  }
  function launch(
    f: Fighter,
    owner: MechSide,
    kind: DuelProjectileKind = "round",
  ) {
    const target = owner === "hero" ? enemy : hero,
      slot = f.volley++;
    const x =
      f.x +
      f.facing * (kind === "round" ? 4.8 : kind === "bladeWave" ? 4.2 : 13.2);
    const y = f.y + (kind === "bladeWave" ? 8.6 : 10.5);
    const aimX = (f.aimLocked ? f.aimX : target.x) - x;
    const dx =
      kind === "bladeWave" ? f.facing * Math.max(1, aimX * f.facing) : aimX;
    const dy = (f.aimLocked ? f.aimY : target.y + 8.6) - y;
    const length = Math.hypot(dx, dy) || 1,
      speed = kind === "round" ? 55 : kind === "bladeWave" ? 43 : 48;
    const damage =
      kind === "round"
        ? DUEL.missileDamage
        : kind === "bladeWave"
          ? DUEL.overdriveDamage
          : DUEL.verdictDamage;
    missiles.push({
      id: missileId++,
      owner,
      x,
      y,
      vx: (dx / length) * speed,
      vy: (dy / length) * speed,
      life: 4,
      age: 0,
      kind,
      damage,
    });
    emit(
      "launch",
      f,
      owner,
      0,
      kind === "round"
        ? "missiles"
        : kind === "bladeWave"
          ? "overdrive"
          : "verdict",
    );
  }
  function act(
    action: MechAction,
    direction = { x: input.move, y: input.lift },
  ) {
    feedback = "";
    if (!live()) return false;
    if (special()?.cinematic && special()?.owner === "enemy") {
      return false;
    }
    if (action === "slide") {
      if (
        phase !== "ground" ||
        hero.y > 0.1 ||
        busy(hero) ||
        special()?.cinematic
      ) {
        feedback = "SLIDE REQUIRES A FREE GROUNDED STANCE";
        return false;
      }
      if (!physicalPaths)
        throw new Error("The finale slide needs prepared rig contact paths");
      const direction = input.move ? Math.sign(input.move) : hero.facing;
      const crossing =
        direction === Math.sign(enemy.x - hero.x) &&
        Math.abs(enemy.x - hero.x) < MECH_DODGE.crossRange;
      startDash(hero, direction, true, crossing);
      hero.move = "slide";
      hero.duration = PHYSICAL_STRIKES.slide.duration;
      hero.invulnerable = 0.65;
      bufferedSlash = 0;
      return true;
    }
    if (action === "dash" && !special()?.cinematic) {
      const direction = input.move ? Math.sign(input.move) : -hero.facing;
      const crossing =
        direction === Math.sign(enemy.x - hero.x) &&
        Math.abs(enemy.x - hero.x) <= MECH_DODGE.crossRange &&
        Math.abs(enemy.y - hero.y) < 7;
      bufferedSlash = 0;
      startDash(hero, direction, true, crossing);
      return true;
    }
    if (busy(hero)) {
      if (
        action === "slash" &&
        (isMeleeStrike(hero.move) || isPhysicalStrike(hero.move)) &&
        hero.time >= hero.duration * 0.5
      ) {
        bufferedSlash = hero.duration - hero.time + 0.2;
        bufferedDirection = { ...direction };
        return true;
      }
      return false;
    }
    if (action === "slash") {
      combo = comboClock > 0 ? (combo + 1) % 3 : 0;
      const attack = directionalSwordAttack(direction.x, direction.y, combo);
      hero.combo = combo;
      move(hero, attack, MELEE_STRIKES[attack].duration);
      comboClock = hero.duration + 0.65;
      emit("swing", hero, "hero", 0, hero.move);
    } else if (action === "missiles") {
      if (hero.energy < 38) {
        feedback = "SALVO NEEDS 38 ENERGY";
        return false;
      }
      hero.energy -= 38;
      move(hero, "missiles", RIFLE_SEQUENCE.swordReady + 0.1);
    } else {
      if (hero.ultimateCooldown > 0) {
        feedback = `ULTIMATE RECHARGING / ${Math.ceil(hero.ultimateCooldown)}s`;
        return false;
      }
      hero.ultimateCooldown = DUEL.ultimateCooldown;
      sync = 0;
      move(hero, "overdrive", DUEL.specialSeconds);
      emit("special", hero, "hero", 0, "overdrive");
    }
    return true;
  }
  function tickAttack(
    f: Fighter,
    target: Fighter,
    owner: MechSide,
    dt: number,
  ) {
    f.invulnerable = Math.max(0, f.invulnerable - dt);
    if (!busy(f)) return;
    const before = f.time;
    f.time += dt;
    const cameraEnd =
      f.move === "missiles"
        ? RIFLE_SEQUENCE.cameraEnd
        : f.move === "overdrive"
          ? HERO_ULTIMATE.cameraEnd
          : f.move === "verdict"
            ? ENEMY_VERDICT.cameraEnd
            : f.move === "orbitalCut"
              ? ENEMY_ORBITAL_CUT.cameraEnd
              : Infinity;
    if (!f.aimLocked && f.time >= cameraEnd) {
      f.aimLocked = true;
      f.aimX = target.x;
      f.aimY = target.y + 8.6;
      if (f === enemy && f.move === "orbitalCut")
        orbitalArc = {
          fromX: f.x,
          fromY: f.y,
          toX: clamp(
            target.x + f.facing * MECH_DODGE.clearance,
            -DUEL.arena,
            DUEL.arena,
          ),
          toY: target.y,
        };
    }
    if (f.move === "missiles") {
      while (
        f.volley < 5 &&
        f.time >= RIFLE_SEQUENCE.fire + f.volley * 0.14 &&
        live()
      )
        launch(f, owner);
    }
    if (
      !f.hit &&
      (f.move === "overdrive" || f.move === "verdict") &&
      f.time >=
        (f.move === "overdrive" ? HERO_ULTIMATE.release : ENEMY_VERDICT.release)
    ) {
      f.hit = true;
      launch(f, owner, f.move === "overdrive" ? "bladeWave" : "verdictBeam");
    } else if (
      !f.hit &&
      isPhysicalStrike(f.move) &&
      physicalPaths &&
      physicalContact(
        f.move,
        before,
        f.time,
        f,
        target,
        physicalPaths,
        guarding(target),
      )
    ) {
      f.hit = true;
      hurt(target, PHYSICAL_STRIKES[f.move].damage, owner, true, f.move);
    } else if (isMeleeStrike(f.move)) {
      const move = f.move,
        windows = swordHitWindows(move);
      for (let index = 0; index < windows.length; index++) {
        if (
          f.strikeHits & (1 << index) ||
          !bladeContact(
            move,
            before,
            f.time,
            f,
            target,
            bladePaths[owner],
            guarding(target),
            windows[index],
          )
        )
          continue;
        f.strikeHits |= 1 << index;
        f.hit = true;
        const damage =
          move === "orbitalCut"
            ? DUEL.orbitalCutDamage
            : move === "heavyCombo"
              ? 64
              : move === "regularCombo"
                ? 42
                : move === "cleave" || move === "reap"
                  ? DUEL.cleaveDamage
                  : move === "thrust"
                    ? 72
                    : DUEL.slashDamage;
        hurt(
          target,
          damage,
          owner,
          true,
          move,
          sampleBladeDamageTrace(move, f, target, bladePaths[owner]),
        );
        if (!live() || f.move !== move) break;
      }
    }
    if (f.time >= f.duration && f.move !== "defeat") {
      if (f.dash) {
        f.dash = null;
        f.vx = 0;
        f.facing = Math.sign(target.x - f.x) || f.facing;
      }
      move(f, "idle", 0);
      if (f === hero && bufferedSlash > 0 && bufferedDirection && live()) {
        const direction = bufferedDirection;
        bufferedSlash = 0;
        bufferedDirection = null;
        act("slash", direction);
      }
    }
  }
  function tickAI(dt: number) {
    aiClock -= dt;
    defenseClock = Math.max(0, defenseClock - dt);
    rushClock = Math.max(0, rushClock - dt);
    const distance = Math.abs(enemy.x - hero.x),
      direction = Math.sign(hero.x - enemy.x) || enemy.facing;
    const closeStrike =
      (isMeleeStrike(hero.move) || isPhysicalStrike(hero.move)) &&
      hero.time >= 0.06 &&
      hero.time <
        (isPhysicalStrike(hero.move)
          ? PHYSICAL_STRIKES[hero.move].end
          : MELEE_STRIKES[hero.move].end) &&
      distance < 21 &&
      Math.abs(hero.y - enemy.y) < 8;
    const incoming = missiles.some(
      (m) =>
        m.owner === "hero" &&
        m.damage > 0 &&
        (enemy.x - m.x) * m.vx > 0 &&
        Math.abs(enemy.x - m.x) / Math.max(1, Math.abs(m.vx)) < 0.5 &&
        Math.abs(m.y - enemy.y - 8.6) < 8,
    );
    const rifleTell =
      hero.move === "missiles" &&
      hero.time >= RIFLE_SEQUENCE.cameraEnd - 0.08 &&
      hero.time < RIFLE_SEQUENCE.lastShot;
    threatTime = closeStrike || incoming || rifleTell ? threatTime + dt : 0;
    if (busy(enemy)) return;
    enemy.facing = direction;
    if (enemy.move === "guard") {
      enemy.time += dt;
      enemy.vx *= Math.exp(-dt * 22);
      enemy.vy *= Math.exp(-dt * 14);
      if (enemy.time < enemy.duration) return;
      move(enemy, "idle", 0);
      aiClock = Math.min(aiClock, 0.25);
    }
    if (defenseClock <= 0 && (threatTime >= DUEL.enemyReaction || rifleTell)) {
      const shield =
        enemy.shield >= 28 &&
        enemy.shieldLock <= 0 &&
        (rifleTell ||
          defensePattern++ % 2 === 1 ||
          Math.abs(enemy.x - direction * MECH_DODGE.distance) > DUEL.arena);
      if (shield) {
        move(enemy, "guard", DUEL.enemyGuardDuration);
        enemy.guardTime = 0;
      } else startDash(enemy, -direction, true);
      if (enemy.move === "guard" || enemy.move === "dash") {
        defenseClock = DUEL.enemyDefenseCooldown;
        threatTime = 0;
        aiClock = 0.35;
        return;
      }
    }
    if (distance > 22 && rushClock <= 0 && Math.abs(hero.y - enemy.y) < 8) {
      startDash(enemy, direction, false);
      rushClock = DUEL.enemyRushCooldown;
      aiClock = 0.15;
      return;
    }
    const closing = distance > 13;
    const speed = closing
      ? direction * (distance > 20 ? 11.5 : 8.5)
      : distance < 9
        ? -direction * 3
        : 0;
    enemy.vx += clamp(speed - enemy.vx, -38 * dt, 38 * dt);
    enemy.move = Math.abs(speed) > 0 ? "walk" : "idle";
    enemy.time += dt;
    if (phase === "space") {
      const lift = clamp((hero.y - enemy.y) * 1.7, -8.5, 8.5);
      enemy.vy += (lift - enemy.vy) * (1 - Math.exp(-dt * 5.5));
    }
    if (aiClock > 0) return;
    const pattern = aiPattern++ % (phase === "space" ? 6 : 5);
    if (distance > 20 || Math.abs(hero.y - enemy.y) > 9) {
      if (pattern !== 3 && pattern !== 5) {
        aiPattern--;
        return;
      }
    }
    const attack =
      pattern === 5
        ? "orbitalCut"
        : pattern === 3
          ? "verdict"
          : pattern === 1 || pattern === 4
            ? "reap"
            : "thrust";
    move(
      enemy,
      attack,
      attack === "verdict"
        ? ENEMY_VERDICT.duration
        : MELEE_STRIKES[attack].duration,
    );
    enemy.vx = 0;
    aiClock = enemy.duration + (phase === "space" ? 0.32 : 0.48);
    emit("tell", enemy, "enemy", 0, attack);
    if (attack === "verdict" || attack === "orbitalCut")
      emit("special", enemy, "enemy", 0, attack);
  }
  function tickMissiles(dt: number) {
    for (let i = missiles.length - 1; i >= 0 && live(); i--) {
      const m = missiles[i],
        target = m.owner === "hero" ? enemy : hero;
      const ax = m.x,
        ay = m.y;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt;
      m.age += dt;
      if (m.damage <= 0) {
        if (m.life <= 0) missiles.splice(i, 1);
        continue;
      }
      const cutting =
        isMeleeStrike(target.move) &&
        sampleMeleeBlade(target.move, target.time).active;
      const attack =
        m.kind === "round"
          ? "missiles"
          : m.kind === "bladeWave"
            ? "overdrive"
            : "verdict";
      if (
        m.kind === "round" &&
        cutting &&
        !guarding(target) &&
        missileContact(ax, ay, m.x, m.y, target, 1.45)
      ) {
        emit(
          "cut",
          { ...target, x: m.x, y: m.y - 8 },
          m.owner === "hero" ? "enemy" : "hero",
          0,
          "missiles",
        );
        if (target === hero) sync = clamp(sync + 7, 0, 100);
        m.life = 0;
      } else if (
        missileContact(
          ax,
          ay,
          m.x,
          m.y,
          target,
          m.kind === "bladeWave" ? 1.2 : 1,
          guarding(target),
        )
      ) {
        const trace: BladeDamageTrace | null =
          m.kind === "bladeWave"
            ? {
                from: [target.x, target.y + 4, -2.7],
                to: [target.x, target.y + 13.5, 2.7],
              }
            : null;
        const outcome = hurt(target, m.damage, m.owner, true, attack, trace);
        if (!live()) break;
        if (outcome === "parry" || outcome === "guard") {
          m.owner = target === hero ? "hero" : "enemy";
          if (outcome === "parry") {
            const attacker = target === hero ? enemy : hero;
            const dx = attacker.x - m.x,
              dy = attacker.y + 8.6 - m.y,
              length = Math.hypot(dx, dy) || 1;
            const speed = Math.hypot(m.vx, m.vy) + 12;
            m.vx = (dx / length) * speed;
            m.vy = (dy / length) * speed;
            m.life = 3;
          } else {
            m.vx *= -0.7;
            m.vy = Math.max(30, Math.abs(m.vy) + 24);
            m.life = 0.7;
          }
        } else if (m.kind === "bladeWave") {
          m.damage = 0;
          m.life = 0.24;
        } else m.life = 0;
      }
      if (m.life <= 0) missiles.splice(i, 1);
    }
  }
  function step(dt: number) {
    if (!live()) return;
    time += dt;
    bossImmunityRemaining = Math.max(0, bossImmunityRemaining - dt);
    const cinematic = special();
    hero.ultimateCooldown = Math.max(0, hero.ultimateCooldown - dt);
    if (cinematic?.cinematic) {
      const actor = cinematic.owner === "hero" ? hero : enemy;
      const target = actor === hero ? enemy : hero;
      hero.vx = hero.vy = enemy.vy = 0;
      if (actor.move === "verdict") tickEnemyLeap(dt);
      tickAttack(actor, target, cinematic.owner, dt);
      return;
    }
    if (input.guard && !guardWasDown) {
      parryArmed = true;
      hero.guardTime = 0;
    }
    if (!input.guard) parryArmed = false;
    guardWasDown = input.guard;
    if (hitStop > 0) {
      hitStop = Math.max(0, hitStop - dt);
      return;
    }
    comboClock = Math.max(0, comboClock - dt);
    bufferedSlash = Math.max(0, bufferedSlash - dt);
    hero.energy = clamp(hero.energy + dt * (input.guard ? 1.5 : 12), 0, 100);
    enemy.energy = clamp(enemy.energy + dt * 10, 0, 100);
    for (const f of [hero, enemy]) {
      f.shieldLock = Math.max(0, f.shieldLock - dt);
      f.shieldCooldown = Math.max(0, f.shieldCooldown - dt);
      if (guarding(f)) {
        f.guardTime += dt;
        f.shieldCooldown = DUEL.shieldRegenDelay;
        f.shield = Math.max(0, f.shield - dt * DUEL.shieldDrain);
        if (f.shield <= 1e-7) breakShield(f);
      } else if (
        (f !== hero || !input.guard) &&
        f.shieldLock <= 0 &&
        f.shieldCooldown <= 0
      ) {
        f.shield = clamp(f.shield + dt * DUEL.shieldRegen, 0, DUEL.shieldMax);
      }
    }
    if (!busy(hero)) {
      hero.facing = Math.sign(enemy.x - hero.x) || hero.facing;
      if (guarding()) {
        hero.move = "guard";
        hero.vx += clamp(-hero.vx, -45 * dt, 45 * dt);
        hero.vy += clamp(-hero.vy, -35 * dt, 35 * dt);
      } else {
        hero.move =
          input.move || (phase === "space" && input.lift) ? "walk" : "idle";
        hero.time += dt;
        hero.vx +=
          (input.move * DUEL.speed - hero.vx) * (1 - Math.exp(-dt * 7));
        hero.vy +=
          ((phase === "space" ? input.lift * 8.5 : 0) - hero.vy) *
          (1 - Math.exp(-dt * 7));
      }
    } else if (hero.move !== "dash" && hero.move !== "slide") {
      hero.vx *= Math.exp(-dt * 16);
      hero.vy *= Math.exp(-dt * 12);
    }
    tickAI(dt);
    if (busy(enemy) && enemy.move !== "dash") {
      const thrusting =
        enemy.move === "thrust" &&
        enemy.time > 0.25 &&
        enemy.time < MELEE_STRIKES.thrust.end;
      enemy.vx = thrusting ? enemy.facing * 13 : enemy.vx * Math.exp(-dt * 14);
      enemy.vy *= Math.exp(-dt * 10);
    }
    const enemyLeaping = tickEnemyLeap(dt);
    const orbitCrossing = enemy.move === "orbitalCut" && orbitalArc !== null;
    if (orbitCrossing && orbitalArc) {
      const p = cinematicProgress(
        enemy.time + dt,
        ENEMY_ORBITAL_CUT.release - 0.18,
        ENEMY_ORBITAL_CUT.cross,
      );
      enemy.x = orbitalArc.fromX + (orbitalArc.toX - orbitalArc.fromX) * p;
      enemy.y =
        orbitalArc.fromY +
        (orbitalArc.toY - orbitalArc.fromY) * p +
        Math.sin(p * Math.PI) * 3.2;
      enemy.vx = enemy.vy = 0;
      if (enemy.time + dt >= ENEMY_ORBITAL_CUT.cross) orbitalArc = null;
    }
    for (const f of [hero, enemy]) {
      if (f === enemy && (enemyLeaping || orbitCrossing)) continue;
      if ((f.move === "dash" || f.move === "slide") && f.dash) {
        const progress =
          f.move === "slide"
            ? cinematicProgress(f.time + dt, 0.12, 1.06)
            : sampleDodgeArc(f.time + dt, f.duration, f.dash.crossing).progress;
        f.x = f.dash.from + (f.dash.to - f.dash.from) * progress;
      } else f.x += f.vx * dt;
    }
    hero.y = phase === "space" ? clamp(hero.y + hero.vy * dt, -10, 15) : 0;
    if (hero.y === -10 || hero.y === 15) hero.vy = 0;
    if (!enemyLeaping && !orbitCrossing) {
      if (phase === "space") enemy.y = clamp(enemy.y + enemy.vy * dt, -10, 15);
      else {
        enemy.vy -= 48 * dt;
        enemy.y = Math.max(0, enemy.y + enemy.vy * dt);
        if (enemy.y === 0) enemy.vy = 0;
      }
    }
    hero.x = clamp(hero.x, -DUEL.arena, DUEL.arena);
    enemy.x = clamp(enemy.x, -DUEL.arena, DUEL.arena);
    if (
      Math.abs(enemy.x - hero.x) < DUEL.separation &&
      Math.abs(enemy.y - hero.y) < 8 &&
      !hero.dash?.crossing &&
      !enemy.dash?.crossing &&
      !orbitCrossing
    ) {
      const center = clamp(
        (hero.x + enemy.x) / 2,
        -DUEL.arena + DUEL.separation / 2,
        DUEL.arena - DUEL.separation / 2,
      );
      const order = Math.sign(enemy.x - hero.x) || hero.facing;
      hero.x = center - (order * DUEL.separation) / 2;
      enemy.x = center + (order * DUEL.separation) / 2;
      hero.vx = enemy.vx = 0;
    }
    tickAttack(hero, enemy, "hero", dt);
    if (live()) tickAttack(enemy, hero, "enemy", dt);
    if (live()) tickMissiles(dt);
    checkOutcome();
  }
  return {
    hero,
    enemy,
    missiles,
    act,
    activateBossImmunity() {
      if (!live() || !bossImmunityAvailable || bossImmunityUsed) return false;
      bossImmunityUsed = true;
      bossImmunityAvailable = false;
      bossImmunityRemaining = BOSS_IMMUNITY_SECONDS;
      return true;
    },
    setBladePaths(side: MechSide, paths: DuelBladePaths) {
      for (const move of Object.keys(MELEE_STRIKES) as MeleeStrike[]) {
        const frames = paths[move];
        if (
          !frames ||
          frames.length < 2 ||
          frames.some((frame) =>
            [...frame.base, ...frame.tip].some(
              (value) => !Number.isFinite(value),
            ),
          )
        ) {
          throw new Error(`Invalid ${side} rig blade path for ${move}`);
        }
      }
      bladePaths[side] = paths;
    },
    setPhysicalPaths(paths: DuelPhysicalPaths) {
      for (const move of Object.keys(PHYSICAL_STRIKES) as PhysicalStrike[]) {
        const frames = paths[move];
        if (
          !frames ||
          frames.length < 2 ||
          frames.some((frame) =>
            [...frame.base, ...frame.tip].some(
              (value) => !Number.isFinite(value),
            ),
          )
        )
          throw new Error(`Invalid rig contact path for ${move}`);
      }
      physicalPaths = paths;
    },
    setInput(value: DuelInput) {
      if (!Number.isFinite(value.move) || !Number.isFinite(value.lift))
        throw new RangeError("Mech input axes must be finite");
      input = {
        move: clamp(value.move, -1, 1),
        lift: clamp(value.lift, -1, 1),
        guard: value.guard,
      };
    },
    clearInput() {
      input = neutralInput();
      bufferedSlash = 0;
      bufferedDirection = null;
      guardWasDown = parryArmed = false;
      hero.guardTime = 10;
    },
    update(dt: number) {
      let remaining = frameTime(dt);
      while (remaining > 1e-9) {
        const stepTime = Math.min(DUEL.step, remaining);
        step(stepTime);
        remaining -= stepTime;
      }
    },
    enterSpace() {
      if (phase !== "rupture") return false;
      phase = "space";
      hero.x = -FINALE_START_X;
      enemy.x = FINALE_START_X;
      hero.y = enemy.y = 0;
      hero.vx = hero.vy = enemy.vx = enemy.vy = 0;
      hero.energy = 100;
      hero.facing = 1;
      enemy.facing = -1;
      hero.dash = enemy.dash = null;
      hero.shield = Math.max(hero.shield, DUEL.spaceShield);
      hero.shieldLock = hero.shieldCooldown = 0;
      enemy.shield = DUEL.shieldMax;
      enemy.shieldLock = enemy.shieldCooldown = 0;
      defenseClock = 1.6;
      threatTime = 0;
      rushClock = 0.65;
      hero.health = Math.min(DUEL.heroHealth, hero.health + DUEL.repair);
      hero.invulnerable = enemy.invulnerable = hitStop = 0;
      move(hero, "idle", 0);
      move(enemy, "idle", 0);
      aiClock = 2.1;
      input = neutralInput();
      return true;
    },
    finish(won: boolean) {
      if (phase !== "finisher") return false;
      phase = won ? "won" : "lost";
      if (!won) {
        hero.health = 0;
        move(hero, "defeat", 4);
        emit("lost", hero, "enemy");
      }
      return true;
    },
    drainEvents() {
      return events.splice(0);
    },
    getState: () => ({
      phase,
      time,
      sync,
      hitStop,
      feedback,
      combo: hero.combo,
      bossImmunityRemaining,
      bossImmunityUsed,
      shield: hero.shield,
      shieldLock: hero.shieldLock,
      shieldCooldown: hero.shieldCooldown,
      guarding: guarding(),
      enemyShield: enemy.shield,
      enemyShieldLock: enemy.shieldLock,
      enemyGuarding: guarding(enemy),
      ultimateCooldown: hero.ultimateCooldown,
      special: special(),
      enemyTell: enemy.move,
      enemyWindup: enemy.duration ? enemy.time / enemy.duration : 0,
    }),
  };
}
