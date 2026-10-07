import { FINALE_START_X, RIFLE_SEQUENCE } from './finaleChoreography.js';

export type MechMove = 'idle' | 'walk' | 'slash' | 'cleave' | 'missiles' | 'guard' | 'dash' | 'stagger' | 'overdrive' | 'defeat';
export type DuelPhase = 'ground' | 'rupture' | 'space' | 'finisher' | 'lost' | 'won';
export type MechSide = 'hero' | 'enemy';
export type MechAction = 'slash' | 'missiles' | 'dash' | 'overdrive';
export interface DuelInput { move: number; lift: number; guard: boolean; }
export interface Fighter {
  x: number; y: number; vx: number; vy: number; health: number; energy: number; shield: number;
  shieldCooldown: number; shieldLock: number;
  move: MechMove; time: number; duration: number; hit: boolean; invulnerable: number;
  guardTime: number; facing: number; combo: number; volley: number;
}
export interface DuelMissile {
  id: number; owner: MechSide; x: number; y: number; vx: number; vy: number; life: number; age: number;
}
export interface DuelEvent {
  kind: 'hit' | 'parry' | 'guard' | 'guardBreak' | 'launch' | 'cut' | 'dash' | 'swing' | 'special' | 'rupture' | 'finish' | 'lost' | 'tell';
  x: number; y: number; owner: MechSide; move: MechMove; attack: MechMove | null; damage: number;
}
export const DUEL = Object.freeze({
  health: 1800, heroHealth: 1000, half: 900, range: 18, arena: 32, speed: 9,
  separation: 7, slashDamage: 58, cleaveDamage: 96, missileDamage: 22,
  parryWindow: 0.24, parryCost: 12, shieldMax: 100, shieldDrain: 24, shieldRegen: 34,
  shieldRegenDelay: 0.8, shieldBreak: 2.2, spaceShield: 55,
  overdriveDamage: 245, specialSeconds: 2.8, step: 1 / 120, repair: 240,
});
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const neutralInput = (): DuelInput => ({ move: 0, lift: 0, guard: false });
const busy = (f: Fighter) => f.move !== 'idle' && f.move !== 'walk' && f.move !== 'guard';
const fighter = (x: number, health: number, facing: number, shield = 0): Fighter => ({
  x, y: 0, vx: 0, vy: 0, health, energy: 100, shield, shieldCooldown: 0, shieldLock: 0,
  move: 'idle', time: 0, duration: 0,
  hit: false, invulnerable: 0, guardTime: 10, facing, combo: 0, volley: 0,
});

function frameTime(dt: number) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Mech simulation requires a finite, nonnegative delta');
  return Math.min(dt, 0.1);
}

// Swept, scaled-circle contact prevents fast missiles tunnelling through either mech.
function missileContact(ax: number, ay: number, bx: number, by: number, target: Fighter, radius = 1) {
  const x = (ax - target.x) / (3.2 * radius), y = (ay - target.y - 7.5) / (5.8 * radius);
  const dx = (bx - ax) / (3.2 * radius), dy = (by - ay) / (5.8 * radius);
  const length = dx * dx + dy * dy;
  const t = length > 0 ? clamp(-(x * dx + y * dy) / length, 0, 1) : 0;
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 <= 1;
}

export function createMechDuel(start: 'ground' | 'space' | 'finisher' = 'ground') {
  const hero = fighter(-FINALE_START_X, DUEL.heroHealth, 1, DUEL.shieldMax);
  const enemy = fighter(FINALE_START_X, start === 'ground' ? DUEL.health : start === 'space' ? DUEL.half : 0, -1);
  let phase: DuelPhase = start, time = 0, sync = 0, combo = 0, comboClock = 0;
  let aiClock = 2.1, aiPattern = 0, missileId = 0, hitStop = 0, guardWasDown = false, parryArmed = false;
  let input = neutralInput(), bufferedSlash = 0, feedback = '';
  const missiles: DuelMissile[] = [], events: DuelEvent[] = [];
  const live = () => phase === 'ground' || phase === 'space';
  function emit(kind: DuelEvent['kind'], f: Fighter, owner: MechSide, damage = 0, attack: MechMove | null = null) {
    events.push({ kind, x: f.x, y: f.y + 8, owner, move: f.move, attack, damage });
  }
  function move(f: Fighter, name: MechMove, duration: number) {
    f.move = name; f.time = 0; f.duration = duration; f.hit = false; f.volley = 0;
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
  function hurt(target: Fighter, damage: number, owner: MechSide, blockable = true, attack?: MechMove): 'hit' | 'guard' | 'parry' | 'evade' {
    if (!live() || target.invulnerable > 0) return 'evade';
    const attacker = owner === 'hero' ? hero : enemy;
    const attackMove = attack ?? attacker.move;
    if (blockable && target === hero && target.move === 'guard' && target.shield > 0 && target.shieldLock <= 0) {
      target.shieldCooldown = DUEL.shieldRegenDelay;
      if (parryArmed && target.guardTime <= DUEL.parryWindow && target.shield >= DUEL.parryCost) {
        target.shield -= DUEL.parryCost;
        parryArmed = false; sync = clamp(sync + 28, 0, 100);
        move(attacker, 'stagger', 1.3); hitStop = 0.1; emit('parry', target, owner, 0, attackMove);
        return 'parry';
      }
      const absorbed = Math.min(target.shield, damage);
      target.shield -= absorbed; damage -= absorbed;
      if (damage <= 0) {
        emit('guard', target, owner, absorbed, attackMove);
        hitStop = Math.max(hitStop, 0.035);
        return 'guard';
      }
      target.shield = 0;
      target.shieldLock = target.shieldCooldown = DUEL.shieldBreak;
      parryArmed = false;
      move(target, 'stagger', 1.1);
      emit('guardBreak', target, owner, damage, attackMove);
    } else move(target, 'stagger', 0.46);
    target.health = Math.max(0, target.health - damage); target.invulnerable = 0.18;
    sync = clamp(sync + (owner === 'hero' ? 12 : 4), 0, 100);
    emit('hit', target, owner, damage, attackMove); hitStop = Math.max(hitStop, 0.065); checkOutcome();
    return target.move === 'guard' ? 'guard' : 'hit';
  }
  function launch(f: Fighter, owner: MechSide) {
    const target = owner === 'hero' ? enemy : hero, slot = f.volley++;
    const x = f.x + f.facing * 3.5, y = f.y + 10.5 + (slot % 2) * 0.65;
    const dx = target.x - x, dy = target.y + 7.5 - y, length = Math.hypot(dx, dy) || 1;
    missiles.push({ id: missileId++, owner, x, y, vx: dx / length * 25, vy: dy / length * 25 + 5 - slot,
      life: 4.5, age: 0 });
    emit('launch', f, owner, 0, 'missiles');
  }
  function act(action: MechAction) {
    feedback = '';
    if (!live()) return false;
    if (busy(hero)) {
      if (action === 'slash' && (hero.move === 'slash' || hero.move === 'cleave') && hero.time >= hero.duration * 0.55) {
        bufferedSlash = 0.35; return true;
      }
      feedback = 'WAIT FOR THE RECOVERY'; return false;
    }
    if (action === 'slash') {
      combo = comboClock > 0 ? (combo + 1) % 3 : 0; comboClock = 1.8;
      hero.combo = combo; move(hero, combo === 2 ? 'cleave' : 'slash', combo === 2 ? 1.22 : combo === 1 ? 0.82 : 0.92);
      emit('swing', hero, 'hero', 0, hero.move);
    } else if (action === 'dash') {
      if (hero.energy < 22) { feedback = 'BOOST NEEDS 22 ENERGY'; return false; }
      hero.energy -= 22; hero.vx = (input.move || -hero.facing) * 29;
      hero.invulnerable = 0.38; move(hero, 'dash', 0.42); emit('dash', hero, 'hero', 0, 'dash');
    } else if (action === 'missiles') {
      if (hero.energy < 38) { feedback = 'SALVO NEEDS 38 ENERGY'; return false; }
      hero.energy -= 38; move(hero, 'missiles', RIFLE_SEQUENCE.swordReady + 0.1);
    } else {
      if (sync < 100) { feedback = 'BUILD 100 SYNC WITH HITS AND PERFECT GUARDS'; return false; }
      sync = 0; hero.invulnerable = DUEL.specialSeconds;
      move(hero, 'overdrive', DUEL.specialSeconds); emit('special', hero, 'hero', 0, 'overdrive');
    }
    return true;
  }
  function tickAttack(f: Fighter, target: Fighter, owner: MechSide, dt: number) {
    f.invulnerable = Math.max(0, f.invulnerable - dt);
    if (!busy(f)) return;
    f.time += dt;
    if (f.move === 'missiles') {
      while (f.volley < 5 && f.time >= RIFLE_SEQUENCE.fire + f.volley * 0.14 && live()) launch(f, owner);
    }
    const impact = f.move === 'overdrive' ? 2.0 : f.move === 'cleave' ? (owner === 'hero' ? 0.73 : 1.06)
      : owner === 'hero' ? (f.combo === 1 ? 0.36 : 0.44) : 0.72;
    if (!f.hit && f.time >= impact && (f.move === 'slash' || f.move === 'cleave' || f.move === 'overdrive')) {
      f.hit = true;
      if (f.move === 'overdrive' || (Math.abs(f.x - target.x) <= DUEL.range && Math.abs(f.y - target.y) <= 6.5)) {
        const damage = f.move === 'overdrive' ? DUEL.overdriveDamage
          : f.move === 'cleave' ? DUEL.cleaveDamage : DUEL.slashDamage;
        hurt(target, damage * (owner === 'enemy' ? 1.18 : 1), owner, f.move !== 'overdrive', f.move);
      }
    }
    if (f.time >= f.duration && f.move !== 'defeat') {
      move(f, 'idle', 0);
      if (f === hero && bufferedSlash > 0 && live()) { bufferedSlash = 0; act('slash'); }
    }
  }
  function tickAI(dt: number) {
    aiClock -= dt;
    if (busy(enemy)) return;
    const distance = enemy.x - hero.x;
    const closing = distance > 14;
    enemy.vx += clamp((closing ? -5.8 : 0) - enemy.vx, -24 * dt, 24 * dt);
    enemy.move = closing ? 'walk' : 'idle'; enemy.time += dt;
    if (phase === 'space') enemy.vy += clamp((hero.y + Math.sin(time * 0.8) * 4 - enemy.y) * 1.5 - enemy.vy, -18 * dt, 18 * dt);
    if (aiClock > 0) return;
    const pattern = aiPattern++ % (phase === 'space' ? 6 : 4);
    const attack: MechMove = pattern === 1 || pattern === 4 ? 'missiles' : pattern === 2 ? 'cleave'
      : pattern === 5 ? 'overdrive' : 'slash';
    move(enemy, attack, attack === 'overdrive' ? 2.8 : attack === 'cleave' ? 1.65 : attack === 'missiles' ? RIFLE_SEQUENCE.swordReady + 0.1 : 1.2);
    enemy.vx = 0; aiClock = phase === 'space' ? 2.15 : 2.75;
    emit('tell', enemy, 'enemy', 0, attack);
    if (attack === 'overdrive') emit('special', enemy, 'enemy', 0, attack);
  }
  function tickMissiles(dt: number) {
    for (let i = missiles.length - 1; i >= 0 && live(); i--) {
      const m = missiles[i], target = m.owner === 'hero' ? enemy : hero;
      const ax = m.x, ay = m.y, dx = target.x - m.x, dy = target.y + 7.5 - m.y, length = Math.hypot(dx, dy) || 1;
      m.vx += clamp(dx / length * 27 - m.vx, -16 * dt, 16 * dt);
      m.vy += clamp(dy / length * 27 - m.vy, -18 * dt, 18 * dt);
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt; m.age += dt;
      const cutting = (target.move === 'slash' || target.move === 'cleave')
        && target.time / target.duration > 0.28 && target.time / target.duration < 0.7;
      if (cutting && missileContact(ax, ay, m.x, m.y, target, 1.85)) {
        emit('cut', { ...target, x: m.x, y: m.y - 8 }, m.owner === 'hero' ? 'enemy' : 'hero', 0, 'missiles');
        if (target === hero) sync = clamp(sync + 7, 0, 100);
        m.life = 0;
      } else if (missileContact(ax, ay, m.x, m.y, target)) {
        const outcome = hurt(target, DUEL.missileDamage, m.owner, true, 'missiles');
        if (!live()) break;
        if (outcome === 'parry') {
          m.owner = 'hero'; m.vx = Math.abs(m.vx) + 8; m.vy *= -0.5; m.life = 3;
        } else m.life = 0;
      }
      if (m.life <= 0) missiles.splice(i, 1);
    }
  }
  function step(dt: number) {
    if (!live()) return;
    time += dt;
    if (input.guard && !guardWasDown) { parryArmed = true; hero.guardTime = 0; }
    if (!input.guard) parryArmed = false;
    guardWasDown = input.guard;
    if (hitStop > 0) { hitStop = Math.max(0, hitStop - dt); return; }
    comboClock = Math.max(0, comboClock - dt); bufferedSlash = Math.max(0, bufferedSlash - dt);
    hero.shieldLock = Math.max(0, hero.shieldLock - dt);
    hero.shieldCooldown = Math.max(0, hero.shieldCooldown - dt);
    hero.energy = clamp(hero.energy + dt * (input.guard ? 1.5 : 12), 0, 100);
    if (!input.guard && hero.shieldLock <= 0 && hero.shieldCooldown <= 0) {
      hero.shield = clamp(hero.shield + dt * DUEL.shieldRegen, 0, DUEL.shieldMax);
    }
    if (!busy(hero)) {
      if (input.guard && hero.shield > 0 && hero.shieldLock <= 0) {
        hero.move = 'guard'; hero.guardTime += dt;
        hero.vx += clamp(-hero.vx, -45 * dt, 45 * dt); hero.vy += clamp(-hero.vy, -35 * dt, 35 * dt);
        hero.shieldCooldown = DUEL.shieldRegenDelay;
        hero.shield = Math.max(0, hero.shield - dt * DUEL.shieldDrain);
        if (hero.shield <= 0) {
          hero.shieldLock = hero.shieldCooldown = DUEL.shieldBreak;
          parryArmed = false;
          move(hero, 'stagger', 1.1);
          emit('guardBreak', hero, 'enemy', 0, 'guard');
        }
      } else {
        hero.move = input.move || (phase === 'space' && input.lift) ? 'walk' : 'idle'; hero.time += dt;
        hero.vx += clamp(input.move * DUEL.speed - hero.vx, -38 * dt, 38 * dt);
        hero.vy += clamp((phase === 'space' ? input.lift * 8.5 : 0) - hero.vy, -30 * dt, 30 * dt);
      }
    } else if (hero.move !== 'dash') {
      hero.vx *= Math.exp(-dt * 16); hero.vy *= Math.exp(-dt * 12);
    }
    tickAI(dt);
    if (busy(enemy)) { enemy.vx *= Math.exp(-dt * 14); enemy.vy *= Math.exp(-dt * 10); }
    hero.x += hero.vx * dt; enemy.x += enemy.vx * dt;
    hero.y = phase === 'space' ? clamp(hero.y + hero.vy * dt, -10, 15) : 0;
    enemy.y = phase === 'space' ? clamp(enemy.y + enemy.vy * dt, -10, 15) : 0;
    hero.x = clamp(hero.x, -DUEL.arena, DUEL.arena - DUEL.separation);
    enemy.x = clamp(enemy.x, -DUEL.arena + DUEL.separation, DUEL.arena);
    if (enemy.x - hero.x < DUEL.separation) {
      const center = clamp((hero.x + enemy.x) / 2, -DUEL.arena + DUEL.separation / 2, DUEL.arena - DUEL.separation / 2);
      hero.x = center - DUEL.separation / 2; enemy.x = center + DUEL.separation / 2; hero.vx = enemy.vx = 0;
    }
    tickAttack(hero, enemy, 'hero', dt);
    if (live()) tickAttack(enemy, hero, 'enemy', dt);
    if (live()) tickMissiles(dt);
    checkOutcome();
  }
  return {
    hero, enemy, missiles, act,
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
      hero.shield = Math.max(hero.shield, DUEL.spaceShield); hero.shieldLock = hero.shieldCooldown = 0;
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
    getState: () => ({ phase, time, sync, hitStop, feedback, combo: hero.combo,
      shield: hero.shield, shieldLock: hero.shieldLock, shieldCooldown: hero.shieldCooldown,
      specialOwner: hero.move === 'overdrive' ? 'hero' as const : enemy.move === 'overdrive' ? 'enemy' as const : null,
      specialTime: hero.move === 'overdrive' ? hero.time : enemy.move === 'overdrive' ? enemy.time : 0,
      enemyTell: enemy.move, enemyWindup: enemy.duration ? enemy.time / enemy.duration : 0 }),
  };
}

export interface FinisherBeat {
  id: string; key: string; label: string; mode: 'tap' | 'hold' | 'mash';
  lead: number; window: number; hold: number; presses: number; resolve: number;
  shot: 'evade' | 'missileCut' | 'countershot' | 'boost' | 'clash' | 'armCut' | 'ascend' | 'reactor' | 'finalCut';
}
export const FINISHER_BEATS: readonly FinisherBeat[] = Object.freeze([
  { id: 'evade', key: 'KeyA', label: 'DODGE THE EXECUTION SHOT', mode: 'tap', lead: 0.8, window: 1.8, hold: 0, presses: 1, resolve: 1.6, shot: 'evade' },
  { id: 'missile-cut', key: 'KeyJ', label: 'CUT THROUGH THE MISSILE WALL', mode: 'tap', lead: 0.5, window: 1.75, hold: 0, presses: 1, resolve: 1.45, shot: 'missileCut' },
  { id: 'countershot', key: 'KeyF', label: 'RETURN FIRE / OPEN THEIR GUARD', mode: 'tap', lead: 0.65, window: 1.75, hold: 0, presses: 1, resolve: 1.55, shot: 'countershot' },
  { id: 'boost', key: 'Space', label: 'BOOST THROUGH THE SHATTERED WORLD', mode: 'hold', lead: 0.55, window: 2.5, hold: 0.8, presses: 1, resolve: 1.55, shot: 'boost' },
  { id: 'clash', key: 'KeyD', label: 'BREAK THE BLADE LOCK', mode: 'mash', lead: 0.5, window: 2.8, hold: 0, presses: 6, resolve: 1.5, shot: 'clash' },
  { id: 'arm-cut', key: 'KeyJ', label: 'SEVER THE WEAPON ARM', mode: 'tap', lead: 0.45, window: 1.65, hold: 0, presses: 1, resolve: 1.55, shot: 'armCut' },
  { id: 'ascend', key: 'KeyW', label: 'RISE ABOVE THE REACTOR BLAST', mode: 'tap', lead: 0.5, window: 1.65, hold: 0, presses: 1, resolve: 1.4, shot: 'ascend' },
  { id: 'reactor', key: 'KeyE', label: 'PRIME / SYNCHRONIZE THE LAST LIGHT', mode: 'hold', lead: 0.65, window: 2.8, hold: 1.15, presses: 1, resolve: 1.7, shot: 'reactor' },
  { id: 'final-cut', key: 'KeyJ', label: 'FINISH IT / ONE LAST CUT', mode: 'tap', lead: 0.6, window: 1.6, hold: 0, presses: 1, resolve: 2.3, shot: 'finalCut' },
]);
export interface QteEvent { kind: 'armed' | 'success' | 'beat' | 'lost' | 'won'; index: number; }
const QTE_KEYS = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyC', 'KeyJ', 'KeyF', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);

export function createFinaleQte() {
  let index = 0, clock = 0, hold = 0, presses = 0, resolveTime = -1, armed = false;
  let result: 'active' | 'won' | 'lost' = 'active', failure: 'timeout' | 'wrong-input' | null = null;
  const held = new Set<string>(), events: QteEvent[] = [];
  function lose(reason: NonNullable<typeof failure>) {
    result = 'lost'; failure = reason; held.clear(); events.push({ kind: 'lost', index });
  }
  function success() { resolveTime = 0; events.push({ kind: 'success', index }); }
  function step(dt: number) {
    if (result !== 'active') return;
    const beat = FINISHER_BEATS[index];
    if (resolveTime >= 0) {
      resolveTime += dt;
      if (resolveTime + 1e-8 >= beat.resolve) {
        index++; clock = hold = presses = 0; resolveTime = -1; armed = false;
        if (index === FINISHER_BEATS.length) { result = 'won'; events.push({ kind: 'won', index: index - 1 }); }
        else events.push({ kind: 'beat', index });
      }
      return;
    }
    clock += dt;
    if (!armed && clock + 1e-8 >= beat.lead) { armed = true; events.push({ kind: 'armed', index }); }
    if (!armed) return;
    if (beat.mode === 'hold') {
      hold = held.has(beat.key) ? hold + dt : 0;
      if (hold + 1e-8 >= beat.hold) { success(); return; }
    }
    if (clock + 1e-8 >= beat.lead + beat.window) lose('timeout');
  }
  return {
    press(code: string, repeat = false) {
      if (!QTE_KEYS.has(code) || result !== 'active' || resolveTime >= 0 || repeat || held.has(code)) return false;
      held.add(code);
      if (!armed) return false;
      const beat = FINISHER_BEATS[index];
      if (code !== beat.key) { lose('wrong-input'); return false; }
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
      return { index, clock, hold, presses, resolveTime, armed, result, failure, beat,
        remaining: clamp(1 - Math.max(0, clock - beat.lead) / beat.window, 0, 1),
        progress: beat.mode === 'hold' ? clamp(hold / beat.hold, 0, 1) : beat.mode === 'mash' ? presses / beat.presses : resolveTime >= 0 ? 1 : 0 };
    },
  };
}
