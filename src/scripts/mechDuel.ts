import {
  FINALE_START_X, RIFLE_SEQUENCE, HERO_ULTIMATE, ENEMY_VERDICT, ENEMY_ORBITAL_CUT, ENEMY_ATTACK_LEAPS, MELEE_STRIKES,
  FINISHER_BEATS, cinematicProgress,
  isMeleeStrike, sampleMeleeBlade, finisherBeatDuration, finisherActionTime, MECH_DODGE, sampleDodgeArc,
  sampleEnemyAttackLeap,
  type CinematicPoint, type MeleeStrike,
} from './finaleChoreography.js';

export type MechMove = 'idle' | 'walk' | 'slash' | 'sideSlash' | 'cleave' | 'thrust' | 'reap' | 'verdict'
  | 'orbitalCut' | 'missiles' | 'guard' | 'dash' | 'stagger' | 'overdrive' | 'defeat';
export type DuelPhase = 'ground' | 'rupture' | 'space' | 'finisher' | 'lost' | 'won';
export type MechSide = 'hero' | 'enemy';
export type MechAction = 'slash' | 'missiles' | 'dash' | 'overdrive';
export interface DuelInput { move: number; lift: number; guard: boolean; }
export interface DuelDash {
  from: number; to: number; crossing: boolean; evading: boolean;
  offset: { lane: number; lift: number; roll: number };
}
export interface Fighter {
  x: number; y: number; vx: number; vy: number; health: number; energy: number; shield: number;
  shieldCooldown: number; shieldLock: number;
  move: MechMove; time: number; duration: number; hit: boolean; invulnerable: number;
  guardTime: number; facing: number; combo: number; volley: number;
  ultimateCooldown: number; aimX: number; aimY: number; aimLocked: boolean;
  dash: DuelDash | null;
}
export type DuelProjectileKind = 'round' | 'bladeWave' | 'verdictBeam';
export interface DuelMissile {
  id: number; owner: MechSide; x: number; y: number; vx: number; vy: number; life: number; age: number;
  kind: DuelProjectileKind; damage: number;
}
export interface BladeDamageTrace { from: CinematicPoint; to: CinematicPoint; }
export interface BladeSegment { base: CinematicPoint; tip: CinematicPoint; }
export type DuelBladePaths = Record<MeleeStrike, readonly BladeSegment[]>;
export interface DuelEvent {
  kind: 'hit' | 'parry' | 'guard' | 'guardBreak' | 'launch' | 'cut' | 'dash' | 'swing' | 'special' | 'rupture' | 'finish' | 'lost' | 'tell';
  x: number; y: number; owner: MechSide; move: MechMove; attack: MechMove | null; damage: number;
  trace: BladeDamageTrace | null;
}
export const DUEL = Object.freeze({
  health: 1800, heroHealth: 1000, half: 900, range: 18, arena: 38, speed: 9,
  separation: 7, slashDamage: 58, cleaveDamage: 96, missileDamage: 22,
  parryWindow: 0.24, parryCost: 12, shieldMax: 100, shieldDrain: 24, shieldRegen: 34,
  shieldRegenDelay: 0.8, shieldBreak: 2.2, shieldHitScale: 0.5, shieldRadius: 10.5, spaceShield: 55,
  overdriveDamage: 245, verdictDamage: 64, orbitalCutDamage: 112, specialSeconds: HERO_ULTIMATE.duration,
  ultimateCooldown: HERO_ULTIMATE.cooldown, counterWindow: 0.55, step: 1 / 120, repair: 240,
  enemyReaction: 0.2, enemyDefenseCooldown: 2.6, enemyGuardDuration: 1.15, enemyRushCooldown: 2.5,
});
export const BOSS_IMMUNITY_SECONDS = 30;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const neutralInput = (): DuelInput => ({ move: 0, lift: 0, guard: false });
const busy = (f: Fighter) => f.move !== 'idle' && f.move !== 'walk' && f.move !== 'guard';
const fighter = (x: number, health: number, facing: number, shield = 0): Fighter => ({
  x, y: 0, vx: 0, vy: 0, health, energy: 100, shield, shieldCooldown: 0, shieldLock: 0,
  move: 'idle', time: 0, duration: 0,
  hit: false, invulnerable: 0, guardTime: 10, facing, combo: 0, volley: 0,
  ultimateCooldown: 0, aimX: 0, aimY: 0, aimLocked: false, dash: null,
});

function frameTime(dt: number) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Mech simulation requires a finite, nonnegative delta');
  return Math.min(dt, 0.1);
}

// Swept, scaled-circle contact prevents fast missiles tunnelling through either mech.
function missileContact(ax: number, ay: number, bx: number, by: number, target: Fighter, radius = 1, shield = false) {
  const rx = shield ? DUEL.shieldRadius : 3.2 * radius, ry = shield ? DUEL.shieldRadius : 5.8 * radius;
  const x = (ax - target.x) / rx, y = (ay - target.y - 7.5) / ry;
  const dx = (bx - ax) / rx, dy = (by - ay) / ry;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? clamp(-(x * dx + y * dy) / length, 0, 1) : 0;
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 <= 1;
}

function bladePoint(point: CinematicPoint, fighter: Fighter): CinematicPoint {
  return [fighter.x + point[2] * fighter.facing, fighter.y + point[1], point[0] * fighter.facing];
}

function sampledBlade(move: MeleeStrike, time: number, paths?: DuelBladePaths): BladeSegment {
  if (!paths) return sampleMeleeBlade(move, time);
  const frames = paths[move], frame = clamp(time / MELEE_STRIKES[move].duration, 0, 1) * (frames.length - 1);
  const a = frames[Math.floor(frame)], b = frames[Math.min(Math.floor(frame) + 1, frames.length - 1)];
  const alpha = frame % 1;
  const mix = (from: CinematicPoint, to: CinematicPoint): CinematicPoint =>
    [from[0] + (to[0] - from[0]) * alpha, from[1] + (to[1] - from[1]) * alpha, from[2] + (to[2] - from[2]) * alpha];
  return { base: mix(a.base, b.base), tip: mix(a.tip, b.tip) };
}

function bladeContact(move: MeleeStrike, before: number, after: number, attacker: Fighter, target: Fighter, paths?: DuelBladePaths, shield = false) {
  const strike = MELEE_STRIKES[move];
  if (after < strike.start || before > strike.end) return false;
  const start = Math.max(before, strike.start), end = Math.min(after, strike.end);
  for (let sample = 0; sample <= 3; sample++) {
    const blade = sampledBlade(move, start + (end - start) * sample / 3, paths);
    const a = bladePoint(blade.base, attacker), b = bladePoint(blade.tip, attacker);
    const rx = shield ? DUEL.shieldRadius : 3.2, ry = shield ? DUEL.shieldRadius : 6.2;
    const rz = shield ? DUEL.shieldRadius : 3.4, cy = shield ? 7.5 : 8.6;
    const origin = [(a[0] - target.x) / rx, (a[1] - target.y - cy) / ry, a[2] / rz];
    const delta = [(b[0] - a[0]) / rx, (b[1] - a[1]) / ry, (b[2] - a[2]) / rz];
    const length = delta.reduce((sum, value) => sum + value * value, 0);
    const t = clamp(-origin.reduce((sum, value, axis) => sum + value * delta[axis], 0) / Math.max(length, 1e-8), 0, 1);
    if (origin.reduce((sum, value, axis) => sum + (value + delta[axis] * t) ** 2, 0) <= 1) return true;
  }
  return false;
}

export function sampleBladeDamageTrace(move: MeleeStrike, attacker: Fighter, target: Fighter, paths?: DuelBladePaths): BladeDamageTrace {
  const strike = MELEE_STRIKES[move], points: CinematicPoint[] = [];
  const plane = Math.abs(target.x - attacker.x) - 2.2;
  for (let sample = 0; sample <= 32; sample++) {
    const blade = sampledBlade(move, strike.start + (strike.end - strike.start) * sample / 32, paths);
    const distance = (plane - blade.base[2]) / (blade.tip[2] - blade.base[2]);
    if (distance < 0 || distance > 1 || !Number.isFinite(distance)) continue;
    const local: CinematicPoint = [
      blade.base[0] + (blade.tip[0] - blade.base[0]) * distance,
      blade.base[1] + (blade.tip[1] - blade.base[1]) * distance,
      plane,
    ];
    const point = bladePoint(local, attacker);
    if (Math.abs(point[2]) <= 3.8 && point[1] >= target.y + 3 && point[1] <= target.y + 15) points.push(point);
  }
  if (points.length >= 2 && move !== 'thrust') return { from: points[0], to: points[points.length - 1] };
  const impact: CinematicPoint = [target.x - attacker.facing * 2.2, target.y + 10, -attacker.facing];
  return { from: [impact[0], impact[1] - 0.5, impact[2]], to: [impact[0], impact[1] + 0.5, impact[2]] };
}

export function createMechDuel(start: 'ground' | 'space' | 'finisher' = 'ground', {
  bossImmunityAvailable = false, bossImmunityUsed = false,
}: { bossImmunityAvailable?: boolean; bossImmunityUsed?: boolean } = {}) {
  const hero = fighter(-FINALE_START_X, DUEL.heroHealth, 1, DUEL.shieldMax);
  const enemy = fighter(FINALE_START_X, start === 'ground' ? DUEL.health : start === 'space' ? DUEL.half : 0, -1, DUEL.shieldMax);
  let phase: DuelPhase = start, time = 0, sync = 0, combo = 0, comboClock = 0;
  let bossImmunityRemaining = 0;
  let aiClock = 2.1, aiPattern = 0, missileId = 0, hitStop = 0, guardWasDown = false, parryArmed = false;
  let defenseClock = 0.12, defensePattern = 0, threatTime = 0, rushClock = 0.65;
  let enemyLeap: { fromX: number; fromY: number; toX: number; toY: number } | null = null;
  let orbitalArc: { fromX: number; fromY: number; toX: number; toY: number } | null = null;
  let input = neutralInput(), bufferedSlash = 0, feedback = '';
  const missiles: DuelMissile[] = [], events: DuelEvent[] = [];
  const bladePaths: Partial<Record<MechSide, DuelBladePaths>> = {};
  const live = () => phase === 'ground' || phase === 'space';
  function emit(kind: DuelEvent['kind'], f: Fighter, owner: MechSide, damage = 0, attack: MechMove | null = null, trace: BladeDamageTrace | null = null) {
    events.push({ kind, x: f.x, y: f.y + 8, owner, move: f.move, attack, damage, trace });
  }
  function move(f: Fighter, name: MechMove, duration: number) {
    f.move = name; f.time = 0; f.duration = duration; f.hit = false; f.volley = 0; f.aimLocked = false;
    if (f === enemy) {
      enemyLeap = null;
      orbitalArc = null;
      if (name === 'thrust' || name === 'verdict') {
        const leap = ENEMY_ATTACK_LEAPS[name];
        const distance = name === 'verdict' ? -leap.distance
          : Math.min(leap.distance, Math.max(0, Math.abs(hero.x - f.x) - DUEL.separation - 1));
        enemyLeap = { fromX: f.x, fromY: f.y, toX: clamp(f.x + f.facing * distance, -DUEL.arena, DUEL.arena),
          toY: phase === 'space' ? name === 'thrust' ? hero.y : f.y : 0 };
        f.vx = f.vy = 0;
      }
    }
  }
  function tickEnemyLeap(dt: number) {
    if (!enemyLeap || (enemy.move !== 'thrust' && enemy.move !== 'verdict')) return false;
    const sample = sampleEnemyAttackLeap(enemy.move, enemy.time + dt);
    enemy.x = enemyLeap.fromX + (enemyLeap.toX - enemyLeap.fromX) * sample.progress;
    enemy.y = enemyLeap.fromY + (enemyLeap.toY - enemyLeap.fromY) * sample.progress + sample.lift;
    enemy.vx = enemy.vy = 0;
    if (enemy.time + dt >= ENEMY_ATTACK_LEAPS[enemy.move].land) {
      enemy.y = enemyLeap.toY;
      enemyLeap = null;
    }
    return true;
  }
  function special() {
    const f = hero.move === 'overdrive' || hero.move === 'missiles' ? hero
      : enemy.move === 'verdict' || enemy.move === 'orbitalCut' ? enemy : null;
    if (!f) return null;
    const cameraEnd = f.move === 'missiles' ? RIFLE_SEQUENCE.cameraEnd
      : f.move === 'verdict' ? ENEMY_VERDICT.cameraEnd
        : f.move === 'orbitalCut' ? ENEMY_ORBITAL_CUT.cameraEnd : HERO_ULTIMATE.cameraEnd;
    const release = f.move === 'missiles' ? RIFLE_SEQUENCE.fire
      : f.move === 'verdict' ? ENEMY_VERDICT.release
        : f.move === 'orbitalCut' ? ENEMY_ORBITAL_CUT.release : HERO_ULTIMATE.release;
    return { owner: f === hero ? 'hero' as const : 'enemy' as const, kind: f.move, time: f.time,
      duration: f.duration, cinematic: f.time < cameraEnd, counterRemaining: Math.max(0, release - f.time) };
  }
  const guarding = (f = hero) => live() && (f === hero ? input.guard : f.move === 'guard') && f.shield > 0 && f.shieldLock <= 0
    && f.move !== 'stagger' && f.move !== 'defeat' && f.move !== 'dash' && !special()?.cinematic;
  function breakShield(f = hero) {
    f.shield = 0; f.shieldLock = f.shieldCooldown = DUEL.shieldBreak;
    if (f === hero) parryArmed = false;
    else defenseClock = DUEL.shieldBreak;
    move(f, 'stagger', 0.7); emit('guardBreak', f, f === hero ? 'enemy' : 'hero', 0, 'guard');
  }
  function startDash(f: Fighter, direction: number, evading: boolean, crossing = false) {
    const target = f === hero ? enemy : hero;
    const offset = f.dash ? sampleDodgeArc(f.time, f.duration, f.dash.crossing, f.dash.offset) : { lane: 0, lift: 0, roll: 0 };
    const landing = target.x + direction * MECH_DODGE.clearance;
    crossing = crossing && Math.abs(landing) <= DUEL.arena;
    const distance = !evading && f === enemy ? Math.min(MECH_DODGE.distance, Math.max(0, Math.abs(target.x - f.x) - 13))
      : MECH_DODGE.distance;
    const end = crossing ? landing : clamp(f.x + direction * distance, -DUEL.arena, DUEL.arena);
    move(f, 'dash', crossing ? MECH_DODGE.crossDuration : MECH_DODGE.duration);
    f.dash = { from: f.x, to: end, crossing, evading, offset: { lane: offset.lane, lift: offset.lift, roll: offset.roll } };
    f.vx = (end - f.x) / f.duration;
    f.invulnerable = evading ? f.duration : 0;
    emit('dash', f, f === hero ? 'hero' : 'enemy', 0, 'dash');
  }
  function checkOutcome() {
    if (!live()) return;
    if (hero.health <= 0) {
      phase = 'lost'; move(hero, 'defeat', 4); emit('lost', hero, 'enemy');
    } else if (phase === 'ground' && enemy.health <= DUEL.half) {
      enemy.health = DUEL.half; phase = 'rupture'; emit('rupture', enemy, 'enemy');
    } else if (phase === 'space' && enemy.health <= 0) {
      enemy.health = 0; phase = 'finisher'; move(enemy, 'stagger', 4); emit('finish', enemy, 'hero');
    }
    if (!live()) { missiles.length = 0; bufferedSlash = 0; input = neutralInput(); }
  }
  function hurt(target: Fighter, damage: number, owner: MechSide, blockable = true, attack?: MechMove, trace: BladeDamageTrace | null = null): 'hit' | 'guard' | 'parry' | 'evade' {
    if (!live()) return 'evade';
    if (target === hero && bossImmunityRemaining > 0) return 'evade';
    const attacker = owner === 'hero' ? hero : enemy;
    const attackMove = attack ?? attacker.move;
    if (blockable && guarding(target)) {
      target.shieldCooldown = DUEL.shieldRegenDelay;
      const perfect = target === hero && parryArmed && target.guardTime <= DUEL.parryWindow && target.shield >= DUEL.parryCost;
      const cost = perfect ? DUEL.parryCost : damage * DUEL.shieldHitScale;
      target.shield = Math.max(0, target.shield - cost);
      if (isMeleeStrike(attackMove)) {
        move(attacker, 'stagger', perfect ? 1.3 : 0.6);
        attacker.vx = -attacker.facing * (perfect ? 13 : 8);
      }
      const impact = { ...target, x: target.x + Math.sign(attacker.x - target.x) * 8.5 };
      if (perfect) {
        parryArmed = false; sync = clamp(sync + 28, 0, 100);
        hitStop = 0.1; emit('parry', impact, owner, 0, attackMove);
      } else {
        emit('guard', impact, owner, damage, attackMove);
        hitStop = Math.max(hitStop, 0.055);
      }
      if (target.shield <= 1e-7) breakShield(target);
      return perfect ? 'parry' : 'guard';
    }
    if (target.invulnerable > 0) return 'evade';
    move(target, 'stagger', 0.46);
    target.health = Math.max(0, target.health - damage); target.invulnerable = 0.18;
    target.dash = null;
    if (target === enemy) defenseClock = Math.max(defenseClock, 0.7);
    sync = clamp(sync + (owner === 'hero' ? 12 : 4), 0, 100);
    emit('hit', target, owner, damage, attackMove, trace); hitStop = Math.max(hitStop, 0.065); checkOutcome();
    return target.move === 'guard' ? 'guard' : 'hit';
  }
  function launch(f: Fighter, owner: MechSide, kind: DuelProjectileKind = 'round') {
    const target = owner === 'hero' ? enemy : hero, slot = f.volley++;
    const x = f.x + f.facing * (kind === 'round' ? 4.8 : kind === 'bladeWave' ? 4.2 : 13.2);
    const y = f.y + (kind === 'bladeWave' ? 8.6 : 10.5);
    const aimX = (f.aimLocked ? f.aimX : target.x) - x;
    const dx = kind === 'bladeWave' ? f.facing * Math.max(1, aimX * f.facing) : aimX;
    const dy = (f.aimLocked ? f.aimY : target.y + 8.6) - y;
    const length = Math.hypot(dx, dy) || 1, speed = kind === 'round' ? 55 : kind === 'bladeWave' ? 43 : 48;
    const damage = kind === 'round' ? DUEL.missileDamage : kind === 'bladeWave' ? DUEL.overdriveDamage : DUEL.verdictDamage;
    missiles.push({ id: missileId++, owner, x, y, vx: dx / length * speed, vy: dy / length * speed,
      life: 4, age: 0, kind, damage });
    emit('launch', f, owner, 0, kind === 'round' ? 'missiles' : kind === 'bladeWave' ? 'overdrive' : 'verdict');
  }
  function act(action: MechAction) {
    feedback = '';
    if (!live()) return false;
    if (special()?.cinematic && special()?.owner === 'enemy') {
      return false;
    }
    if (action === 'dash' && !special()?.cinematic) {
      const direction = input.move ? Math.sign(input.move) : -hero.facing;
      const crossing = direction === Math.sign(enemy.x - hero.x) && Math.abs(enemy.x - hero.x) <= MECH_DODGE.crossRange
        && Math.abs(enemy.y - hero.y) < 7;
      bufferedSlash = 0;
      startDash(hero, direction, true, crossing);
      return true;
    }
    if (busy(hero)) {
      if (action === 'slash' && isMeleeStrike(hero.move) && hero.time >= hero.duration * 0.5) {
        bufferedSlash = 0.75; return true;
      }
      return false;
    }
    if (action === 'slash') {
      combo = comboClock > 0 ? (combo + 1) % 3 : 0; comboClock = 1.8;
      const attack = combo === 2 ? 'cleave' : combo === 1 ? 'sideSlash' : 'slash';
      hero.combo = combo; move(hero, attack, MELEE_STRIKES[attack].duration);
      emit('swing', hero, 'hero', 0, hero.move);
    } else if (action === 'missiles') {
      if (hero.energy < 38) { feedback = 'SALVO NEEDS 38 ENERGY'; return false; }
      hero.energy -= 38; move(hero, 'missiles', RIFLE_SEQUENCE.swordReady + 0.1);
    } else {
      if (hero.ultimateCooldown > 0) { feedback = `ULTIMATE RECHARGING / ${Math.ceil(hero.ultimateCooldown)}s`; return false; }
      hero.ultimateCooldown = DUEL.ultimateCooldown; sync = 0;
      move(hero, 'overdrive', DUEL.specialSeconds); emit('special', hero, 'hero', 0, 'overdrive');
    }
    return true;
  }
  function tickAttack(f: Fighter, target: Fighter, owner: MechSide, dt: number) {
    f.invulnerable = Math.max(0, f.invulnerable - dt);
    if (!busy(f)) return;
    const before = f.time;
    f.time += dt;
    const cameraEnd = f.move === 'missiles' ? RIFLE_SEQUENCE.cameraEnd
      : f.move === 'overdrive' ? HERO_ULTIMATE.cameraEnd : f.move === 'verdict' ? ENEMY_VERDICT.cameraEnd
        : f.move === 'orbitalCut' ? ENEMY_ORBITAL_CUT.cameraEnd : Infinity;
    if (!f.aimLocked && f.time >= cameraEnd) {
      f.aimLocked = true; f.aimX = target.x; f.aimY = target.y + 8.6;
      if (f === enemy && f.move === 'orbitalCut') orbitalArc = { fromX: f.x, fromY: f.y,
        toX: clamp(target.x + f.facing * MECH_DODGE.clearance, -DUEL.arena, DUEL.arena), toY: target.y };
    }
    if (f.move === 'missiles') {
      while (f.volley < 5 && f.time >= RIFLE_SEQUENCE.fire + f.volley * 0.14 && live()) launch(f, owner);
    }
    if (!f.hit && (f.move === 'overdrive' || f.move === 'verdict')
      && f.time >= (f.move === 'overdrive' ? HERO_ULTIMATE.release : ENEMY_VERDICT.release)) {
      f.hit = true;
      launch(f, owner, f.move === 'overdrive' ? 'bladeWave' : 'verdictBeam');
    } else if (!f.hit && isMeleeStrike(f.move) && bladeContact(f.move, before, f.time, f, target, bladePaths[owner], guarding(target))) {
      f.hit = true;
      const damage = f.move === 'orbitalCut' ? DUEL.orbitalCutDamage
        : f.move === 'cleave' || f.move === 'reap' ? DUEL.cleaveDamage : f.move === 'thrust' ? 72 : DUEL.slashDamage;
      hurt(target, damage, owner, true, f.move, sampleBladeDamageTrace(f.move, f, target, bladePaths[owner]));
    }
    if (f.time >= f.duration && f.move !== 'defeat') {
      if (f.dash) { f.dash = null; f.vx = 0; f.facing = Math.sign(target.x - f.x) || f.facing; }
      move(f, 'idle', 0);
      if (f === hero && bufferedSlash > 0 && live()) { bufferedSlash = 0; act('slash'); }
    }
  }
  function tickAI(dt: number) {
    aiClock -= dt;
    defenseClock = Math.max(0, defenseClock - dt); rushClock = Math.max(0, rushClock - dt);
    const distance = Math.abs(enemy.x - hero.x), direction = Math.sign(hero.x - enemy.x) || enemy.facing;
    const closeStrike = isMeleeStrike(hero.move) && hero.time >= 0.06 && hero.time < MELEE_STRIKES[hero.move].end
      && distance < 21 && Math.abs(hero.y - enemy.y) < 8;
    const incoming = missiles.some(m => m.owner === 'hero' && m.damage > 0
      && (enemy.x - m.x) * m.vx > 0 && Math.abs(enemy.x - m.x) / Math.max(1, Math.abs(m.vx)) < 0.5
      && Math.abs(m.y - enemy.y - 8.6) < 8);
    const rifleTell = hero.move === 'missiles' && hero.time >= RIFLE_SEQUENCE.cameraEnd - 0.08
      && hero.time < RIFLE_SEQUENCE.lastShot;
    threatTime = closeStrike || incoming || rifleTell ? threatTime + dt : 0;
    if (busy(enemy)) return;
    enemy.facing = direction;
    if (enemy.move === 'guard') {
      enemy.time += dt; enemy.vx *= Math.exp(-dt * 22); enemy.vy *= Math.exp(-dt * 14);
      if (enemy.time < enemy.duration) return;
      move(enemy, 'idle', 0); aiClock = Math.min(aiClock, 0.25);
    }
    if (defenseClock <= 0 && (threatTime >= DUEL.enemyReaction || rifleTell)) {
      const shield = enemy.shield >= 28 && enemy.shieldLock <= 0 && (rifleTell || defensePattern++ % 2 === 1
        || Math.abs(enemy.x - direction * MECH_DODGE.distance) > DUEL.arena);
      if (shield) { move(enemy, 'guard', DUEL.enemyGuardDuration); enemy.guardTime = 0; }
      else startDash(enemy, -direction, true);
      if (enemy.move === 'guard' || enemy.move === 'dash') {
        defenseClock = DUEL.enemyDefenseCooldown; threatTime = 0; aiClock = 0.35; return;
      }
    }
    if (distance > 22 && rushClock <= 0 && Math.abs(hero.y - enemy.y) < 8) {
      startDash(enemy, direction, false); rushClock = DUEL.enemyRushCooldown; aiClock = 0.15; return;
    }
    const closing = distance > 13;
    const speed = closing ? direction * (distance > 20 ? 11.5 : 8.5) : distance < 9 ? -direction * 3 : 0;
    enemy.vx += clamp(speed - enemy.vx, -38 * dt, 38 * dt);
    enemy.move = Math.abs(speed) > 0 ? 'walk' : 'idle'; enemy.time += dt;
    if (phase === 'space') {
      const lift = clamp((hero.y - enemy.y) * 1.7, -8.5, 8.5);
      enemy.vy += (lift - enemy.vy) * (1 - Math.exp(-dt * 5.5));
    }
    if (aiClock > 0) return;
    const pattern = aiPattern++ % (phase === 'space' ? 6 : 5);
    if (distance > 20 || Math.abs(hero.y - enemy.y) > 9) {
      if (pattern !== 3 && pattern !== 5) { aiPattern--; return; }
    }
    const attack = pattern === 5 ? 'orbitalCut' : pattern === 3 ? 'verdict' : pattern === 1 || pattern === 4 ? 'reap' : 'thrust';
    move(enemy, attack, attack === 'verdict' ? ENEMY_VERDICT.duration : MELEE_STRIKES[attack].duration);
    enemy.vx = 0;
    aiClock = enemy.duration + (phase === 'space' ? 0.32 : 0.48);
    emit('tell', enemy, 'enemy', 0, attack);
    if (attack === 'verdict' || attack === 'orbitalCut') emit('special', enemy, 'enemy', 0, attack);
  }
  function tickMissiles(dt: number) {
    for (let i = missiles.length - 1; i >= 0 && live(); i--) {
      const m = missiles[i], target = m.owner === 'hero' ? enemy : hero;
      const ax = m.x, ay = m.y;
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt; m.age += dt;
      if (m.damage <= 0) {
        if (m.life <= 0) missiles.splice(i, 1);
        continue;
      }
      const cutting = isMeleeStrike(target.move) && sampleMeleeBlade(target.move, target.time).active;
      const attack = m.kind === 'round' ? 'missiles' : m.kind === 'bladeWave' ? 'overdrive' : 'verdict';
      if (m.kind === 'round' && cutting && !guarding(target) && missileContact(ax, ay, m.x, m.y, target, 1.45)) {
        emit('cut', { ...target, x: m.x, y: m.y - 8 }, m.owner === 'hero' ? 'enemy' : 'hero', 0, 'missiles');
        if (target === hero) sync = clamp(sync + 7, 0, 100);
        m.life = 0;
      } else if (missileContact(ax, ay, m.x, m.y, target, m.kind === 'bladeWave' ? 1.2 : 1, guarding(target))) {
        const trace: BladeDamageTrace | null = m.kind === 'bladeWave' ? {
          from: [target.x, target.y + 4, -2.7], to: [target.x, target.y + 13.5, 2.7],
        } : null;
        const outcome = hurt(target, m.damage, m.owner, true, attack, trace);
        if (!live()) break;
        if (outcome === 'parry' || outcome === 'guard') {
          m.owner = target === hero ? 'hero' : 'enemy';
          if (outcome === 'parry') {
            const attacker = target === hero ? enemy : hero;
            const dx = attacker.x - m.x, dy = attacker.y + 8.6 - m.y, length = Math.hypot(dx, dy) || 1;
            const speed = Math.hypot(m.vx, m.vy) + 12;
            m.vx = dx / length * speed; m.vy = dy / length * speed; m.life = 3;
          } else {
            m.vx *= -0.7; m.vy = Math.max(30, Math.abs(m.vy) + 24); m.life = 0.7;
          }
        } else if (m.kind === 'bladeWave') {
          m.damage = 0; m.life = 0.24;
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
      const actor = cinematic.owner === 'hero' ? hero : enemy;
      const target = actor === hero ? enemy : hero;
      hero.vx = hero.vy = enemy.vy = 0;
      if (actor.move === 'verdict') tickEnemyLeap(dt);
      tickAttack(actor, target, cinematic.owner, dt);
      return;
    }
    if (input.guard && !guardWasDown) { parryArmed = true; hero.guardTime = 0; }
    if (!input.guard) parryArmed = false;
    guardWasDown = input.guard;
    if (hitStop > 0) { hitStop = Math.max(0, hitStop - dt); return; }
    comboClock = Math.max(0, comboClock - dt); bufferedSlash = Math.max(0, bufferedSlash - dt);
    hero.energy = clamp(hero.energy + dt * (input.guard ? 1.5 : 12), 0, 100);
    enemy.energy = clamp(enemy.energy + dt * 10, 0, 100);
    for (const f of [hero, enemy]) {
      f.shieldLock = Math.max(0, f.shieldLock - dt); f.shieldCooldown = Math.max(0, f.shieldCooldown - dt);
      if (guarding(f)) {
        f.guardTime += dt; f.shieldCooldown = DUEL.shieldRegenDelay;
        f.shield = Math.max(0, f.shield - dt * DUEL.shieldDrain);
        if (f.shield <= 1e-7) breakShield(f);
      } else if ((f !== hero || !input.guard) && f.shieldLock <= 0 && f.shieldCooldown <= 0) {
        f.shield = clamp(f.shield + dt * DUEL.shieldRegen, 0, DUEL.shieldMax);
      }
    }
    if (!busy(hero)) {
      hero.facing = Math.sign(enemy.x - hero.x) || hero.facing;
      if (guarding()) {
        hero.move = 'guard';
        hero.vx += clamp(-hero.vx, -45 * dt, 45 * dt); hero.vy += clamp(-hero.vy, -35 * dt, 35 * dt);
      } else {
        hero.move = input.move || (phase === 'space' && input.lift) ? 'walk' : 'idle'; hero.time += dt;
        hero.vx += (input.move * DUEL.speed - hero.vx) * (1 - Math.exp(-dt * 7));
        hero.vy += ((phase === 'space' ? input.lift * 8.5 : 0) - hero.vy) * (1 - Math.exp(-dt * 7));
      }
    } else if (hero.move !== 'dash') {
      hero.vx *= Math.exp(-dt * 16); hero.vy *= Math.exp(-dt * 12);
    }
    tickAI(dt);
    if (busy(enemy) && enemy.move !== 'dash') {
      const thrusting = enemy.move === 'thrust' && enemy.time > 0.25 && enemy.time < MELEE_STRIKES.thrust.end;
      enemy.vx = thrusting ? enemy.facing * 13 : enemy.vx * Math.exp(-dt * 14);
      enemy.vy *= Math.exp(-dt * 10);
    }
    const enemyLeaping = tickEnemyLeap(dt);
    const orbitCrossing = enemy.move === 'orbitalCut' && orbitalArc !== null;
    if (orbitCrossing && orbitalArc) {
      const p = cinematicProgress(enemy.time + dt, ENEMY_ORBITAL_CUT.release - 0.18, ENEMY_ORBITAL_CUT.cross);
      enemy.x = orbitalArc.fromX + (orbitalArc.toX - orbitalArc.fromX) * p;
      enemy.y = orbitalArc.fromY + (orbitalArc.toY - orbitalArc.fromY) * p + Math.sin(p * Math.PI) * 3.2;
      enemy.vx = enemy.vy = 0;
      if (enemy.time + dt >= ENEMY_ORBITAL_CUT.cross) orbitalArc = null;
    }
    for (const f of [hero, enemy]) {
      if (f === enemy && (enemyLeaping || orbitCrossing)) continue;
      if (f.move === 'dash' && f.dash) {
        const progress = sampleDodgeArc(f.time + dt, f.duration, f.dash.crossing).progress;
        f.x = f.dash.from + (f.dash.to - f.dash.from) * progress;
      } else f.x += f.vx * dt;
    }
    hero.y = phase === 'space' ? clamp(hero.y + hero.vy * dt, -10, 15) : 0;
    if (hero.y === -10 || hero.y === 15) hero.vy = 0;
    if (!enemyLeaping && !orbitCrossing) {
      if (phase === 'space') enemy.y = clamp(enemy.y + enemy.vy * dt, -10, 15);
      else {
        enemy.vy -= 48 * dt;
        enemy.y = Math.max(0, enemy.y + enemy.vy * dt);
        if (enemy.y === 0) enemy.vy = 0;
      }
    }
    hero.x = clamp(hero.x, -DUEL.arena, DUEL.arena);
    enemy.x = clamp(enemy.x, -DUEL.arena, DUEL.arena);
    if (Math.abs(enemy.x - hero.x) < DUEL.separation && Math.abs(enemy.y - hero.y) < 8
      && !hero.dash?.crossing && !enemy.dash?.crossing && !orbitCrossing) {
      const center = clamp((hero.x + enemy.x) / 2, -DUEL.arena + DUEL.separation / 2, DUEL.arena - DUEL.separation / 2);
      const order = Math.sign(enemy.x - hero.x) || hero.facing;
      hero.x = center - order * DUEL.separation / 2; enemy.x = center + order * DUEL.separation / 2; hero.vx = enemy.vx = 0;
    }
    tickAttack(hero, enemy, 'hero', dt);
    if (live()) tickAttack(enemy, hero, 'enemy', dt);
    if (live()) tickMissiles(dt);
    checkOutcome();
  }
  return {
    hero, enemy, missiles, act,
    activateBossImmunity() {
      if (!live() || !bossImmunityAvailable || bossImmunityUsed) return false;
      bossImmunityUsed = true; bossImmunityAvailable = false; bossImmunityRemaining = BOSS_IMMUNITY_SECONDS;
      return true;
    },
    setBladePaths(side: MechSide, paths: DuelBladePaths) {
      for (const move of Object.keys(MELEE_STRIKES) as MeleeStrike[]) {
        const frames = paths[move];
        if (!frames || frames.length < 2 || frames.some(frame => [...frame.base, ...frame.tip].some(value => !Number.isFinite(value)))) {
          throw new Error(`Invalid ${side} rig blade path for ${move}`);
        }
      }
      bladePaths[side] = paths;
    },
    setInput(value: DuelInput) {
      if (!Number.isFinite(value.move) || !Number.isFinite(value.lift)) throw new RangeError('Mech input axes must be finite');
      input = { move: clamp(value.move, -1, 1), lift: clamp(value.lift, -1, 1), guard: value.guard };
    },
    clearInput() { input = neutralInput(); bufferedSlash = 0; guardWasDown = parryArmed = false; hero.guardTime = 10; },
    update(dt: number) {
      let remaining = frameTime(dt);
      while (remaining > 1e-9) { const stepTime = Math.min(DUEL.step, remaining); step(stepTime); remaining -= stepTime; }
    },
    enterSpace() {
      if (phase !== 'rupture') return false;
      phase = 'space'; hero.x = -FINALE_START_X; enemy.x = FINALE_START_X; hero.y = enemy.y = 0;
      hero.vx = hero.vy = enemy.vx = enemy.vy = 0; hero.energy = 100;
      hero.facing = 1; enemy.facing = -1; hero.dash = enemy.dash = null;
      hero.shield = Math.max(hero.shield, DUEL.spaceShield); hero.shieldLock = hero.shieldCooldown = 0;
      enemy.shield = DUEL.shieldMax; enemy.shieldLock = enemy.shieldCooldown = 0;
      defenseClock = 1.6; threatTime = 0; rushClock = 0.65;
      hero.health = Math.min(DUEL.heroHealth, hero.health + DUEL.repair);
      hero.invulnerable = enemy.invulnerable = hitStop = 0;
      move(hero, 'idle', 0); move(enemy, 'idle', 0); aiClock = 2.1; input = neutralInput(); return true;
    },
    finish(won: boolean) {
      if (phase !== 'finisher') return false;
      phase = won ? 'won' : 'lost';
      if (!won) { hero.health = 0; move(hero, 'defeat', 4); emit('lost', hero, 'enemy'); }
      return true;
    },
    drainEvents() { return events.splice(0); },
    getState: () => ({ phase, time, sync, hitStop, feedback, combo: hero.combo, bossImmunityRemaining, bossImmunityUsed,
      shield: hero.shield, shieldLock: hero.shieldLock, shieldCooldown: hero.shieldCooldown, guarding: guarding(),
      enemyShield: enemy.shield, enemyShieldLock: enemy.shieldLock, enemyGuarding: guarding(enemy),
      ultimateCooldown: hero.ultimateCooldown, special: special(),
      enemyTell: enemy.move, enemyWindup: enemy.duration ? enemy.time / enemy.duration : 0 }),
  };
}

export interface FinisherBeat {
  id: string; key: string; label: string; mode: 'tap' | 'hold' | 'mash';
  lead: number; window: number; hold: number; presses: number; resolve: number;
  shot: 'evade' | 'missileCut' | 'countershot' | 'boost' | 'clash' | 'armCut' | 'ascend' | 'reactor' | 'finalCut';
}
export { FINISHER_BEATS } from './finaleChoreography.js';
export interface QteEvent { kind: 'armed' | 'success' | 'miss' | 'beat' | 'lost' | 'won'; index: number; stars: number; }
const QTE_KEYS = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyC', 'KeyJ', 'KeyF', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);

export function createFinaleQte() {
  let index = 0, clock = 0, hold = 0, presses = 0, armed = false, judged = false;
  let misses = 0, stars = 0, totalStars = 0, elapsed = 0, judgedAt = 0;
  let result: 'active' | 'won' | 'lost' = 'active', failure: 'timeout' | 'wrong-input' | null = null;
  const held = new Set<string>(), events: QteEvent[] = [];
  function lose(reason: NonNullable<typeof failure>) {
    result = 'lost'; failure = reason; held.clear(); events.push({ kind: 'lost', index, stars: 0 });
  }
  function miss(reason: NonNullable<typeof failure>) {
    judged = true; judgedAt = clock; stars = 0; misses++;
    events.push({ kind: 'miss', index, stars: 0 });
    if (misses >= 3) lose(reason);
  }
  function success() {
    judged = true; judgedAt = clock;
    const beat = FINISHER_BEATS[index];
    if (beat.mode === 'tap') {
      const error = Math.abs(clock - finisherActionTime(beat));
      stars = error <= 0.12 ? 3 : error <= 0.3 ? 2 : 1;
    } else if (beat.mode === 'hold') {
      const delay = Math.max(0, clock - beat.lead - beat.hold);
      stars = delay <= 0.16 ? 3 : delay <= 0.3 ? 2 : 1;
    } else {
      const completion = (clock - beat.lead) / beat.window;
      stars = completion <= 0.65 ? 3 : completion <= 0.85 ? 2 : 1;
    }
    totalStars += stars; events.push({ kind: 'success', index, stars });
  }
  function step(dt: number) {
    if (result !== 'active') return;
    const beat = FINISHER_BEATS[index];
    clock += dt; elapsed += dt;
    if (!armed && clock + 1e-8 >= beat.lead) { armed = true; events.push({ kind: 'armed', index, stars: 0 }); }
    if (armed && !judged && beat.mode === 'hold') {
      hold = held.has(beat.key) ? hold + dt : 0;
      if (hold + 1e-8 >= beat.hold) success();
    }
    if (!judged && clock + 1e-8 >= beat.lead + beat.window) miss('timeout');
    if (result !== 'active') return;
    if (clock + 1e-8 >= finisherBeatDuration(beat)) {
      clock = Math.max(0, clock - finisherBeatDuration(beat));
      index++; hold = presses = stars = judgedAt = 0; judged = armed = false; held.clear();
      if (index === FINISHER_BEATS.length) { result = 'won'; events.push({ kind: 'won', index: index - 1, stars: totalStars }); }
      else events.push({ kind: 'beat', index, stars: 0 });
    }
  }
  return {
    press(code: string, repeat = false) {
      if (!QTE_KEYS.has(code) || result !== 'active' || judged || repeat || held.has(code)) return false;
      held.add(code);
      if (!armed) return false;
      const beat = FINISHER_BEATS[index];
      if (code !== beat.key) { miss('wrong-input'); return false; }
      if (beat.mode === 'tap') success();
      else if (beat.mode === 'mash') { presses++; if (presses >= beat.presses) success(); }
      return true;
    },
    release(code: string) { held.delete(code); },
    clearInput() { held.clear(); hold = 0; },
    update(dt: number) {
      let remaining = frameTime(dt);
      while (remaining > 1e-9) { const stepTime = Math.min(DUEL.step, remaining); step(stepTime); remaining -= stepTime; }
    },
    drainEvents() { return events.splice(0); },
    getState() {
      const beat = FINISHER_BEATS[Math.min(index, FINISHER_BEATS.length - 1)];
      return { index, clock, elapsed, hold, presses, armed, judged, judgedAt, result, failure, beat, misses, stars, totalStars,
        judgement: !judged ? 'pending' as const : stars > 0 ? 'success' as const : 'miss' as const,
        ringScale: clamp(1 + (finisherActionTime(beat) - clock) / beat.window * 1.6, 0.65, 2.6),
        inputProgress: judged && stars > 0 ? 1 : beat.mode === 'hold' ? clamp(hold / beat.hold, 0, 1)
          : beat.mode === 'mash' ? clamp(presses / beat.presses, 0, 1) : judged && stars > 0 ? 1 : 0,
        remaining: clamp(1 - Math.max(0, clock - beat.lead) / beat.window, 0, 1),
        progress: clamp(clock / finisherBeatDuration(beat), 0, 1) };
    },
  };
}
export type FinaleQteState = ReturnType<ReturnType<typeof createFinaleQte>['getState']>;
