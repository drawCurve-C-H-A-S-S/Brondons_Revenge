import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import * as THREE from 'three';

let server, createMechDuel, createFinaleQte, FINISHER_BEATS, createFinaleDirector, DUEL, choreography, createMechAnimator, FINALE_DURATION;
let createIndustrialSkin, createBeamMaterial, SLASH_MARK_LIFETIME, FRAME_COLORS;
let createBladeTrail;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createMechDuel, createFinaleQte, FINISHER_BEATS, DUEL } = await server.ssrLoadModule('/scripts/mechDuel.ts'));
  ({ createFinaleDirector, FINALE_DURATION } = await server.ssrLoadModule('/scripts/finaleDirector.ts'));
  choreography = await server.ssrLoadModule('/scripts/finaleChoreography.ts');
  ({ createMechAnimator } = await server.ssrLoadModule('/scripts/mechAnimation.ts'));
  ({ createIndustrialSkin, createBeamMaterial, SLASH_MARK_LIFETIME, FRAME_COLORS } = await server.ssrLoadModule('/helpers/scene/finaleMaterials.ts'));
  ({ createBladeTrail } = await server.ssrLoadModule('/helpers/scene/finaleEffects.ts'));
});

after(async () => server?.close());

function advance(update, seconds) {
  let remaining = seconds;
  while (remaining > 1e-8) {
    const dt = Math.min(0.1, remaining);
    update(dt);
    remaining -= dt;
  }
}

function waitForEnemyAttack(duel, attack) {
  for (let frame = 0; frame < 30 * 120; frame++) {
    duel.update(1 / 120);
    if (duel.enemy.move === attack) return;
  }
  assert.fail(`Sudoers 5 did not start ${attack}`);
}

function enterFinisherInput(qte, update, beat, miss = false) {
  const at = beat.mode === 'tap' ? choreography.finisherActionTime(beat) : beat.lead + 0.04;
  advance(update, at - qte.getState().clock);
  const key = miss ? beat.key === 'KeyF' ? 'KeyJ' : 'KeyF' : beat.key;
  qte.press(key);
  if (!miss && beat.mode === 'hold') advance(update, beat.hold + 0.001);
  qte.release(key);
  if (!miss && beat.mode === 'mash') for (let i = 1; i < beat.presses; i++) {
    advance(update, 0.14); qte.press(key); qte.release(key);
  }
}

test('sword combat resolves the same hits at 30 and 60 updates per second', () => {
  function simulate(fps) {
    const duel = createMechDuel('ground');
    duel.hero.x = -6;
    duel.enemy.x = 6;
    Object.assign(duel.enemy, { move: 'stagger', time: 0, duration: 10 });
    assert.equal(duel.act('slash'), true);
    for (let frame = 0; frame < fps; frame++) duel.update(1 / fps);
    return {
      heroHealth: duel.hero.health,
      enemyHealth: duel.enemy.health,
      events: duel.drainEvents().map(event => event.kind),
    };
  }

  const thirty = simulate(30);
  assert.deepEqual(simulate(60), thirty);
  assert.equal(thirty.enemyHealth, 1800 - 58);
  assert.equal(thirty.heroHealth, 1000);
  assert.ok(thirty.events.includes('hit'));
});

test('the held shield drains, breaks, and recharges after release', () => {
  const duel = createMechDuel('ground');
  duel.hero.shield = DUEL.shieldDrain / 10;
  duel.setInput({ move: 0, lift: 0, guard: true });
  advance(dt => duel.update(dt), 0.05);
  assert.ok(duel.getState().shield < DUEL.shieldDrain / 10);
  advance(dt => duel.update(dt), 0.05);

  assert.equal(duel.getState().shield, 0);
  assert.ok(duel.getState().shieldLock > 0);
  assert.ok(duel.drainEvents().some(event => event.kind === 'guardBreak'));

  duel.setInput({ move: 0, lift: 0, guard: false });
  advance(dt => duel.update(dt), duel.getState().shieldLock + 0.1);
  assert.ok(duel.getState().shield > 0);
  assert.equal(DUEL.shieldMax, 100);
});

test('a wrong QTE input records one miss without stopping the cinematic', () => {
  const qte = createFinaleQte();
  advance(dt => qte.update(dt), FINISHER_BEATS[0].lead + 0.05);
  assert.equal(qte.getState().armed, true);
  assert.equal(qte.press('KeyF'), false);
  assert.equal(qte.getState().result, 'active');
  assert.equal(qte.getState().misses, 1);
  assert.equal(qte.getState().judgement, 'miss');
  const clock = qte.getState().clock;
  qte.update(0.1);
  assert.ok(qte.getState().clock > clock);
  assert.equal(qte.press('KeyF'), false);
  assert.equal(qte.getState().misses, 1);
});

test('the complete finisher QTE reaches the victory branch', () => {
  const director = createFinaleDirector('finisher');
  director.assetsLoaded();

  for (const beat of FINISHER_BEATS) {
    assert.equal(director.getState().phase, 'finisher');
    enterFinisherInput(director.qte, dt => director.update(dt), beat);
    assert.equal(director.qte.getState().armed, true, `${beat.id} should arm before input`);
    assert.equal(director.qte.getState().stars, 3);
    advance(dt => director.update(dt), choreography.finisherBeatDuration(beat) - director.qte.getState().clock + 0.001);
  }

  assert.equal(director.getState().phase, 'victory');
  assert.equal(director.duel.getState().phase, 'won');
  assert.equal(director.qte.getState().totalStars, FINISHER_BEATS.length * 3);
});

test('the third missed QTE transitions to the game-over branch, not the first', () => {
  const director = createFinaleDirector('finisher');
  director.assetsLoaded();
  for (const beat of FINISHER_BEATS.slice(0, 3)) {
    advance(dt => director.update(dt), beat.lead + 0.05 - director.qte.getState().clock);
    director.qte.press(beat.key === 'KeyF' ? 'KeyJ' : 'KeyF');
    if (director.qte.getState().misses < 3) {
      assert.equal(director.getState().phase, 'finisher');
      advance(dt => director.update(dt), choreography.finisherBeatDuration(beat) - director.qte.getState().clock + 0.001);
    }
  }
  director.update(1 / 60);

  assert.equal(director.getState().phase, 'defeat');
  assert.match(director.getState().failure, /Three missed commands.*Sudoers 5/);
  assert.equal(director.qte.getState().misses, 3);
});

test('scene 16 enters the merged approach, then the facility interior and finale', async () => {
  const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const [main, approach, facility] = await Promise.all([
    source('main.ts'),
    source('scenes/level 3/scene17.ts'),
    source('scenes/level 3/scene20.ts'),
  ]);

  assert.match(main, /16: \(\) => import\('\.\/scenes\/level 2\/scene16\.js'\)/);
  for (const scene of [17, 20, 21]) {
    assert.match(main, new RegExp(`${scene}: \\(\\) => import\\('\\.\\/scenes\\/level 3\\/scene${scene}\\.js'\\)`));
  }
  assert.match(main, /onFinished: arrival => \{ void loadGround17\(arrival\); \}/);
  assert.doesNotMatch(main, /import\('\.\/scenes\/level 3\/scene1[89]\.js'\)|loadPlatformer18|onPlatformer/);
  assert.match(main, /entryState, onFinished: loadFacility20/);
  assert.match(main, /onFinished: next => \{ void loadScene21\(next\); \}/);
  assert.match(approach, /onFinished\?\.\(/);
  assert.match(facility, /PRIME: I expected more security\./);
});

test('the finale reuses the facility roof and assigns guarding to R', async () => {
  const boss = await readFile(new URL('../src/scenes/level 3/scene21.ts', import.meta.url), 'utf8');

  assert.match(boss, /createRescueSite\(physics, \{ culling: true \}\)/);
  assert.match(boss, /site\.disintegrateTrees/);
  assert.match(boss, /guard: keys\.has\('KeyR'\)/);
  assert.doesNotMatch(boss, /getCockpitPoint/);
});

test('student dialogue and sequential chest entry share exact windows', () => {
  const { STUDENT_TIMELINE, activeStudent, sampleStudentBoarding } = choreography;
  assert.equal(STUDENT_TIMELINE.length, 5);
  STUDENT_TIMELINE.forEach((timing, index) => {
    const middle = (timing.reveal.start + timing.reveal.end) / 2;
    assert.equal(activeStudent(middle, 'reveal'), index);
    assert.equal(activeStudent(timing.boarding.start + 0.02, 'boarding'), index);
    assert.equal(sampleStudentBoarding(index, timing.boarding.start).scale, 1);
    assert.equal(sampleStudentBoarding(index, timing.boarding.end).visible, false);
    assert.equal(sampleStudentBoarding(index, timing.boarding.end).merge, 1);
    assert.equal(sampleStudentBoarding(index, timing.boarding.end).beam, 0);
    if (index < 4) {
      const next = STUDENT_TIMELINE[index + 1];
      assert.ok(Math.abs(timing.boarding.end - next.boarding.start) < 1e-8);
      assert.equal(sampleStudentBoarding(index + 1, timing.boarding.start + 1).ascent, 0);
    }
  });
});

test('every opening route shows the versus intro before combat', () => {
  const fromCheckpoint = createFinaleDirector('ground');
  fromCheckpoint.assetsLoaded();
  assert.equal(fromCheckpoint.getState().phase, 'versus');
  advance(dt => fromCheckpoint.update(dt), FINALE_DURATION.versus + 0.05);
  assert.equal(fromCheckpoint.getState().phase, 'ground');
  assert.equal(fromCheckpoint.getCheckpoint().stage, 'ground');

  const skipped = createFinaleDirector('reveal');
  skipped.assetsLoaded(); skipped.holdSkip(true);
  advance(dt => skipped.update(dt), 1.3);
  assert.equal(skipped.getState().phase, 'versus');

  const complete = createFinaleDirector('reveal');
  complete.assetsLoaded();
  advance(dt => complete.update(dt), FINALE_DURATION.reveal + FINALE_DURATION.enemyTransform + FINALE_DURATION.heroTransform + 0.2);
  assert.equal(complete.getState().phase, 'versus');
});

test('rifle rounds wait for the shoulder draw and allow the return animation', () => {
  const { RIFLE_SEQUENCE, sampleRifleSequence } = choreography;
  const duel = createMechDuel('ground');
  duel.hero.x = -25; duel.enemy.x = 25;
  duel.hero.invulnerable = duel.enemy.invulnerable = 100;
  Object.assign(duel.enemy, { move: 'stagger', duration: 100 });
  assert.equal(duel.act('missiles'), true);
  assert.ok(duel.hero.duration > RIFLE_SEQUENCE.swordReady);
  advance(dt => duel.update(dt), RIFLE_SEQUENCE.ready);
  assert.equal(duel.drainEvents().filter(event => event.kind === 'launch').length, 0);
  advance(dt => duel.update(dt), RIFLE_SEQUENCE.lastShot - RIFLE_SEQUENCE.ready + 0.02);
  assert.equal(duel.drainEvents().filter(event => event.kind === 'launch' && event.owner === 'hero').length, 5);
  assert.equal(sampleRifleSequence(RIFLE_SEQUENCE.ready).shoulderToAim, 1);
  assert.equal(sampleRifleSequence(RIFLE_SEQUENCE.swordReady).swordReturn, 1);
});

test('the finisher animates sword-beam dodges and a mash D blade lock on a fixed clock', () => {
  const { sampleFinisher } = choreography;
  const dodge = FINISHER_BEATS.find(beat => beat.shot === 'evade');
  const prompt = sampleFinisher(dodge, 0);
  const dodging = sampleFinisher(dodge, choreography.finisherActionTime(dodge) + 0.2);
  assert.equal(prompt.enemyPose, 'verdict');
  assert.equal(dodging.heroPose, 'evade');
  assert.ok(dodging.hero[2] > prompt.hero[2] + 5);
  assert.ok(dodging.heroRoll < -0.3);
  const clash = FINISHER_BEATS.find(beat => beat.shot === 'clash');
  assert.equal(clash.key, 'KeyD');
  assert.equal(clash.mode, 'mash');
  assert.equal(FINISHER_BEATS.find(beat => beat.shot === 'reactor').mode, 'hold');
  assert.equal(sampleFinisher(clash, 0).heroPose, 'clash');
  assert.equal(sampleFinisher(clash, choreography.finisherBeatDuration(clash)).enemyPose, 'stagger');
  assert.ok(FINISHER_BEATS.some(beat => beat.key === 'KeyF' && beat.shot === 'countershot'));
});

test('custom mech clips do not rotate hips, legs, knees, or feet', () => {
  const model = new THREE.Group();
  const names = ['pelvis', 'spine_02', 'spine_03', 'Head', 'upperarm_l', 'upperarm_r',
    'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
  names.forEach(name => { const bone = new THREE.Bone(); bone.name = name; model.add(bone); });
  const lower = ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'].map(name => model.getObjectByName(name));
  const animator = createMechAnimator(model);
  try {
    for (const clip of animator.animations) {
      for (const bone of lower) assert.ok(!clip.tracks.some(track => track.name.startsWith(bone.uuid)), `${clip.name} must not animate ${bone.name}`);
    }
    for (const move of ['clash', 'evade', 'boost', 'skyCharge', 'bomb', 'missiles', 'slash', 'sideSlash', 'thrust', 'reap', 'verdict', 'afterCut']) {
      animator.pose(move, 0.6, 1, true);
      for (const bone of lower) assert.deepEqual(bone.quaternion.toArray(), [0, 0, 0, 1]);
    }
  } finally { animator.dispose(); }
});

test('the world has no generated mech pads and the ship flight is wired into Scene 21', async () => {
  const [world, scene, mechs, credits] = await Promise.all([
    readFile(new URL('../src/helpers/scene/finaleWorld.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/scenes/level 3/scene21.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/helpers/scene/finaleMechs.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/helpers/scene/finalePresentation.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(world, /MechPoweredRooftopStage|OrbitalFacilityWreckage/);
  assert.match(world, /EarthRockDebris/);
  assert.match(world, /CeilingSpotlight/);
  assert.match(scene, /releasePropCulling\(site\.ship\.root\)/);
  assert.match(scene, /shipTransform\.update\(state\.phase, state\.phaseTime\)/);
  assert.match(scene, /terrestrial\.visible = !inSpace/);
  assert.match(mechs, /fitWeaponToHand\(swordGripSocket, swordBone, 0\)/);
  assert.match(mechs, /loadToolModel\('Gun_Rifle'\)/);
  assert.match(credits, /translate\(-50%,/);
  assert.match(credits, /setCreditSprite/);
});

test('blade sweeps hit armor at reach but miss distant and vertically separated targets', () => {
  for (const phase of ['ground', 'space']) {
    const contact = createMechDuel(phase);
    contact.hero.x = -6; contact.enemy.x = 6;
    Object.assign(contact.enemy, { move: 'stagger', time: 0, duration: 10 });
    assert.equal(contact.act('slash'), true);
    advance(dt => contact.update(dt), 0.9);
    const hits = contact.drainEvents().filter(event => event.kind === 'hit' && event.owner === 'hero');
    assert.equal(hits.length, 1);
    assert.ok(hits[0].trace);
    assert.ok(Math.hypot(...hits[0].trace.from.map((value, axis) => value - hits[0].trace.to[axis])) > 3);

    const distant = createMechDuel(phase);
    distant.hero.x = -30; distant.enemy.x = 30;
    const hp = distant.enemy.health;
    distant.act('slash'); advance(dt => distant.update(dt), 1.1);
    assert.equal(distant.enemy.health, hp);
    assert.equal(distant.drainEvents().filter(event => event.kind === 'hit').length, 0);
  }
  const above = createMechDuel('space');
  above.hero.x = -6; above.enemy.x = 6; above.hero.y = 15; above.enemy.y = -10;
  const hp = above.enemy.health;
  above.act('slash'); advance(dt => above.update(dt), 1.1);
  assert.equal(above.enemy.health, hp);
});

test('J chains distinct downward, side and heavy cuts', () => {
  const duel = createMechDuel('ground');
  duel.hero.x = -6; duel.enemy.x = 6; duel.hero.invulnerable = 100;
  Object.assign(duel.enemy, { move: 'stagger', duration: 10 });
  const moves = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) Object.assign(duel.enemy, { move: 'stagger', time: 0, duration: 10, invulnerable: 0 });
    assert.equal(duel.act('slash'), true);
    moves.push(duel.hero.move);
    advance(dt => duel.update(dt), duel.hero.duration + 0.16);
  }
  assert.deepEqual(moves, ['slash', 'sideSlash', 'cleave']);
  const attacks = duel.drainEvents().filter(event => event.kind === 'hit' && event.owner === 'hero');
  assert.deepEqual(attacks.map(event => event.damage), [DUEL.slashDamage, DUEL.slashDamage, DUEL.cleaveDamage]);
});

test('the Sudoers 5 fighter rushes, evades committed cuts, raises its shield against rifle fire, and can be side-switched', () => {
  const dodger = createMechDuel('ground');
  dodger.hero.x = -6; dodger.enemy.x = 6; dodger.enemy.invulnerable = 100;
  assert.equal(dodger.act('slash'), true);
  advance(dt => dodger.update(dt), 0.45);
  assert.equal(dodger.enemy.move, 'dash');
  assert.ok(dodger.enemy.invulnerable > 0, 'a read should become a real, brief evasive dodge');
  assert.ok(dodger.drainEvents().some(event => event.kind === 'dash' && event.owner === 'enemy'));

  const blocker = createMechDuel('ground');
  blocker.hero.x = -32; blocker.enemy.x = 32; blocker.hero.invulnerable = 100;
  advance(dt => blocker.update(dt), 1.7);
  blocker.hero.x = 0; blocker.enemy.x = 12; blocker.enemy.move = 'idle'; blocker.enemy.time = 0;
  assert.equal(blocker.act('missiles'), true);
  advance(dt => blocker.update(dt), choreography.RIFLE_SEQUENCE.cameraEnd + 0.42);
  assert.equal(blocker.getState().enemyGuarding, true, 'the defender reads the rifle pose and commits to a shield');

  const crossing = createMechDuel('ground');
  crossing.hero.x = -6; crossing.enemy.x = 6; crossing.enemy.invulnerable = 100;
  Object.assign(crossing.enemy, { move: 'stagger', duration: 10 });
  crossing.setInput({ move: 1, lift: 0, guard: false });
  assert.equal(crossing.act('dash'), true);
  assert.equal(crossing.hero.dash.crossing, true);
  advance(dt => crossing.update(dt), choreography.MECH_DODGE.crossDuration + 0.03);
  assert.ok(crossing.hero.x > crossing.enemy.x, 'holding toward the opponent with Space carries the pilot behind them');

  const rusher = createMechDuel('ground');
  rusher.hero.x = -32; rusher.enemy.x = 32; rusher.hero.invulnerable = 100;
  advance(dt => rusher.update(dt), 4.2);
  assert.ok(rusher.enemy.x < 32, 'the enemy should close ground across the arena');
  assert.ok(rusher.drainEvents().some(event => event.kind === 'tell' && event.owner === 'enemy'), 'the rush transitions into an attack');
});

test('a queued J input chains once after weighted hit-stop and recovery', () => {
  const duel = createMechDuel('ground');
  duel.hero.x = -6; duel.enemy.x = 6; duel.hero.invulnerable = 100;
  duel.act('slash');
  advance(dt => duel.update(dt), 0.65);
  assert.equal(duel.act('slash'), true);
  advance(dt => duel.update(dt), 1.6);
  assert.deepEqual(duel.drainEvents().filter(event => event.kind === 'swing').map(event => event.attack), ['slash', 'sideSlash']);
});
test('Last Light starts ready, launches a blade wave, and recharges with combat time', () => {
  for (const phase of ['ground', 'space']) {
    const duel = createMechDuel(phase);
    duel.hero.x = -32; duel.enemy.x = 32; duel.hero.invulnerable = 100;
    assert.equal(duel.getState().ultimateCooldown, 0);
    assert.equal(duel.act('overdrive'), true);
    assert.equal(duel.getState().ultimateCooldown, DUEL.ultimateCooldown);
    advance(dt => duel.update(dt), choreography.HERO_ULTIMATE.release - 0.02);
    assert.equal(duel.drainEvents().filter(event => event.kind === 'launch').length, 0);
    duel.update(0.05);
    assert.ok(duel.missiles.some(projectile => projectile.kind === 'bladeWave'));
    const cooldown = duel.getState().ultimateCooldown;
    advance(dt => duel.update(dt), 1.2);
    assert.equal(duel.act('overdrive'), false);
    assert.match(duel.getState().feedback, /RECHARGING/);
    assert.ok(duel.getState().ultimateCooldown < cooldown);
    advance(dt => duel.update(dt), duel.getState().ultimateCooldown + 0.02);
    assert.equal(duel.getState().ultimateCooldown, 0);
    assert.equal(duel.act('overdrive'), true);
  }
  const blade = choreography.sampleUltimateBlade(choreography.HERO_ULTIMATE.release);
  assert.ok(blade.tip[1] > 5, 'the flash must leave the blade above ground');
  assert.ok(blade.direction[2] > 0.9, 'the release must point forward');
});

test('every special returns control at least 0.55 seconds before its projectile releases', () => {
  for (const [action, timing] of [['missiles', choreography.RIFLE_SEQUENCE], ['overdrive', choreography.HERO_ULTIMATE]]) {
    const duel = createMechDuel('ground');
    duel.hero.x = -32; duel.enemy.x = 32;
    duel.act(action);
    advance(dt => duel.update(dt), timing.cameraEnd + 0.001);
    assert.equal(duel.getState().special.cinematic, false);
    assert.ok(duel.getState().special.counterRemaining >= DUEL.counterWindow);
    assert.equal(duel.drainEvents().some(event => event.kind === 'launch'), false);
  }
  assert.ok(choreography.ENEMY_VERDICT.release - choreography.ENEMY_VERDICT.cameraEnd >= DUEL.counterWindow);
});

test('Sudoers 5 jumps forward, lands and connects its thrust in both combat phases', () => {
  for (const phase of ['ground', 'space']) {
    const duel = createMechDuel(phase);
    duel.hero.invulnerable = 100;
    if (phase === 'space') duel.hero.y = duel.enemy.y = 3;
    waitForEnemyAttack(duel, 'thrust');
    const origin = { x: duel.enemy.x, y: duel.enemy.y };
    const gap = Math.abs(duel.enemy.x - duel.hero.x);
    advance(dt => duel.update(dt), 0.37);
    assert.ok((duel.enemy.x - origin.x) * duel.enemy.facing > 1, 'the leap must move the combat body toward Brondon');
    assert.ok(duel.enemy.y > origin.y + 2, 'the thrust must visibly leave the ground or orbital flight lane');
    assert.ok(Math.abs(duel.enemy.x - duel.hero.x) < gap);
    advance(dt => duel.update(dt), choreography.ENEMY_ATTACK_LEAPS.thrust.land - duel.enemy.time + 0.01);
    assert.ok(Math.abs(duel.enemy.y - (phase === 'space' ? 3 : 0)) < 1e-8, 'the landing must preserve the flight altitude');
    duel.hero.invulnerable = 0;
    advance(dt => duel.update(dt), choreography.MELEE_STRIKES.thrust.end - duel.enemy.time + 0.02);
    assert.equal(duel.hero.health, DUEL.heroHealth - 72);
    assert.ok(Math.abs(duel.enemy.x - duel.hero.x) >= DUEL.separation - 1e-8);
  }
});

test('Sudoers 5 leaps backward before its beam without shortening the dodge and guard window', () => {
  for (const phase of ['ground', 'space']) {
    const duel = createMechDuel(phase);
    duel.hero.invulnerable = 100;
    if (phase === 'space') duel.hero.y = duel.enemy.y = 3;
    waitForEnemyAttack(duel, 'verdict');
    const origin = { x: duel.enemy.x, y: duel.enemy.y };
    const gap = Math.abs(duel.enemy.x - duel.hero.x);
    assert.equal(duel.act('slash'), false);
    assert.equal(duel.getState().feedback, '', 'the special close-up must not produce a recovery hint');
    advance(dt => duel.update(dt), 0.37);
    assert.ok((duel.enemy.x - origin.x) * duel.enemy.facing < -1, 'the special must retreat, not advance');
    assert.ok(duel.enemy.y > origin.y + 2);
    assert.ok(Math.abs(duel.enemy.x - duel.hero.x) > gap);
    advance(dt => duel.update(dt), choreography.ENEMY_VERDICT.cameraEnd - duel.enemy.time + 0.001);
    assert.equal(duel.getState().special.cinematic, false);
    assert.ok(duel.getState().special.counterRemaining >= DUEL.counterWindow);
    assert.ok(Math.abs(duel.enemy.y - (phase === 'space' ? 3 : 0)) < 1e-8);
    assert.ok(Math.abs(duel.enemy.x) <= DUEL.arena);
    duel.drainEvents();
    advance(dt => duel.update(dt), choreography.ENEMY_VERDICT.release - duel.enemy.time - 0.015);
    assert.equal(duel.drainEvents().some(event => event.kind === 'launch'), false);
    duel.update(0.03);
    assert.equal(duel.drainEvents().filter(event => event.kind === 'launch' && event.attack === 'verdict').length, 1);
  }
});

test('busy actions stay quiet while actionable resource warnings remain', () => {
  const duel = createMechDuel('ground');
  assert.equal(duel.act('slash'), true);
  assert.equal(duel.act('slash'), false);
  assert.equal(duel.getState().feedback, '');
  advance(dt => duel.update(dt), choreography.MELEE_STRIKES.slash.duration + 0.01);
  duel.hero.energy = 0;
  assert.equal(duel.act('missiles'), false);
  assert.match(duel.getState().feedback, /ENERGY/);
});

function swordBeamDuel(phase = 'space') {
  const duel = createMechDuel(phase);
  duel.hero.x = -20; duel.enemy.x = 20;
  Object.assign(duel.enemy, { move: 'verdict', duration: choreography.ENEMY_VERDICT.duration, time: 0 });
  return duel;
}

test('the enemy sword beam locks its aim and can be dodged or fully blocked after the close-up', () => {
  const idle = swordBeamDuel();
  advance(dt => idle.update(dt), 3);
  assert.equal(idle.hero.health, DUEL.heroHealth - DUEL.verdictDamage);
  assert.ok(idle.drainEvents().some(event => event.kind === 'hit' && event.attack === 'verdict'));

  const dodging = swordBeamDuel();
  advance(dt => dodging.update(dt), choreography.ENEMY_VERDICT.cameraEnd + 0.001);
  dodging.setInput({ move: 0, lift: 1, guard: false });
  advance(dt => dodging.update(dt), 1.5);
  assert.equal(dodging.hero.health, DUEL.heroHealth);

  const guarding = swordBeamDuel();
  advance(dt => guarding.update(dt), choreography.ENEMY_VERDICT.cameraEnd + 0.001);
  guarding.setInput({ move: 0, lift: 0, guard: true });
  advance(dt => guarding.update(dt), 1.5);
  assert.equal(guarding.hero.health, DUEL.heroHealth);
  assert.ok(guarding.drainEvents().some(event => event.kind === 'guard' && event.attack === 'verdict'));
});

test('Sudoers 5 keeps its original attacks and adds an orbital sword special, never the player sword/rifle moves', () => {
  const duel = createMechDuel('space');
  duel.hero.invulnerable = 100;
  advance(dt => duel.update(dt), 22);
  const attacks = duel.drainEvents().filter(event => event.kind === 'tell').map(event => event.attack);
  assert.ok(attacks.includes('thrust'));
  assert.ok(attacks.includes('reap'));
  assert.ok(attacks.includes('verdict'));
  assert.ok(attacks.includes('orbitalCut'));
  assert.ok(attacks.every(attack => ['thrust', 'reap', 'verdict', 'orbitalCut'].includes(attack)));
});

test('damage engravings stay in mech-local armor coordinates and fade in 1.65 seconds', () => {
  const root = new THREE.Group(), skin = createIndustrialSkin('enemy');
  try {
    skin.update(root, 10, 1, 0, 0);
    skin.engrave(new THREE.Vector3(-2, 4, 2), new THREE.Vector3(2, 13, 2));
    root.position.set(70, 100, -20); root.rotation.y = Math.PI;
    skin.update(root, 10.5, 1, 0, 0);
    const cut = skin.uniforms.uCutStarts.value[0];
    assert.deepEqual([cut.x, cut.y, cut.z], [-2, 4, 2]);
    assert.ok(cut.w > 0 && cut.w < 1);
    assert.equal(skin.uniforms.uCutColor.value.getHex(), FRAME_COLORS.hero);
    skin.update(root, 10 + SLASH_MARK_LIFETIME + 0.001, 1, 0, 0);
    assert.equal(cut.w, 0);
  } finally { skin.dispose(); }
});

test('closing-ring timing awards one, two and three stars without advancing the shot', () => {
  for (const [offset, expected] of [[-0.45, 1], [-0.2, 2], [0, 3]]) {
    const qte = createFinaleQte(), beat = FINISHER_BEATS[0];
    advance(dt => qte.update(dt), choreography.finisherActionTime(beat) + offset);
    const before = qte.getState();
    assert.equal(qte.press(beat.key), true);
    assert.equal(qte.getState().stars, expected);
    assert.equal(qte.getState().clock, before.clock);
    assert.equal(qte.getState().index, before.index);
    assert.equal(qte.getState().result, 'active');
    assert.ok(Math.abs(qte.getState().ringScale - (1 - offset / beat.window * 1.6)) < 1e-8);
  }
});

test('two misses and perfect inputs produce identical continuous cinematics and can both win', () => {
  const perfect = createFinaleQte(), recoverable = createFinaleQte();
  for (let frame = 0; frame < 4000 && perfect.getState().result === 'active'; frame++) {
    const state = perfect.getState();
    const inputDue = state.beat.mode === 'tap' ? state.clock >= choreography.finisherActionTime(state.beat)
      : state.armed && (state.beat.mode === 'hold' || frame % 8 === 0);
    if (!state.judged && inputDue) {
      perfect.press(state.beat.key);
      const key = state.index < 2 ? state.beat.key === 'KeyF' ? 'KeyJ' : 'KeyF' : state.beat.key;
      recoverable.press(key);
      if (state.beat.mode !== 'hold') { perfect.release(state.beat.key); recoverable.release(key); }
    }
    perfect.update(1 / 60); recoverable.update(1 / 60);
    const a = perfect.getState(), b = recoverable.getState();
    assert.equal(a.index, b.index); assert.equal(a.clock, b.clock);
    assert.deepEqual(choreography.sampleFinisher(a.beat, a.clock), choreography.sampleFinisher(b.beat, b.clock));
  }
  assert.equal(perfect.getState().result, 'won');
  assert.equal(recoverable.getState().result, 'won');
  assert.equal(recoverable.getState().misses, 2);
});

test('a third wrong command can kill at every later finisher beat', () => {
  for (let failureAt = 2; failureAt < FINISHER_BEATS.length; failureAt++) {
    const director = createFinaleDirector('finisher'); director.assetsLoaded();
    for (let index = 0; index <= failureAt; index++) {
      const beat = FINISHER_BEATS[index];
      const miss = index < 2 || index === failureAt;
      enterFinisherInput(director.qte, dt => director.update(dt), beat, miss);
      if (index === failureAt) director.update(1 / 60);
      else advance(dt => director.update(dt), choreography.finisherBeatDuration(beat) - director.qte.getState().clock + 0.001);
    }
    assert.equal(director.getState().phase, 'defeat', FINISHER_BEATS[failureAt].id);
    assert.equal(director.qte.getState().misses, 3);
    assert.equal(director.qte.getState().index, failureAt);
    assert.equal(director.getCheckpoint().stage, 'finisher');
  }
});

test('R blocks melee at the shield surface and recoils the attacker in both fight phases', () => {
  for (const phase of ['ground', 'space']) {
    for (const attacking of [false, true]) {
      const duel = createMechDuel(phase);
      duel.hero.x = -6; duel.enemy.x = 6;
      Object.assign(duel.enemy, { move: 'stagger', time: 0, duration: 10 });
      duel.setInput({ move: 0, lift: 0, guard: true });
      advance(dt => duel.update(dt), 0.4);
      if (attacking) assert.equal(duel.act('slash'), true);
      Object.assign(duel.enemy, {
        move: 'thrust', time: choreography.MELEE_STRIKES.thrust.start - 0.01,
        duration: choreography.MELEE_STRIKES.thrust.duration,
      });
      const shield = duel.hero.shield;
      duel.update(0.05);
      assert.equal(duel.hero.health, DUEL.heroHealth);
      assert.ok(duel.hero.shield < shield);
      assert.equal(duel.enemy.move, 'stagger');
      assert.ok(duel.enemy.vx > 0, 'the attacking mech must recoil away from the shield');
      assert.equal(duel.getState().guarding, true);
      assert.ok(duel.drainEvents().some(event => event.kind === 'guard' && event.attack === 'thrust'));
    }
  }
});

test('normal shielding deflects beams and timed parries return them to the attacker', () => {
  for (const phase of ['ground', 'space']) {
    for (const perfect of [false, true]) {
      const duel = createMechDuel(phase);
      duel.hero.x = -20; duel.enemy.x = 20;
      Object.assign(duel.enemy, { move: 'stagger', time: 0, duration: 10 });
      duel.setInput({ move: 0, lift: 0, guard: true });
      if (!perfect) advance(dt => duel.update(dt), 0.4);
      duel.missiles.push({ id: 1, owner: 'enemy', kind: 'verdictBeam', x: duel.hero.x + 11,
        y: duel.hero.y + 8.6, vx: -48, vy: 0, age: 0, life: 4, damage: DUEL.verdictDamage });
      duel.update(0.05);
      assert.equal(duel.hero.health, DUEL.heroHealth);
      assert.equal(duel.missiles.length, 1, 'a blocked beam must remain visible as it bounces away');
      assert.equal(duel.missiles[0].owner, 'hero');
      assert.ok(duel.missiles[0].vx > 0);
      assert.ok(duel.drainEvents().some(event => event.kind === (perfect ? 'parry' : 'guard')));
      if (perfect) {
        const hp = duel.enemy.health;
        advance(dt => duel.update(dt), 0.8);
        assert.equal(duel.enemy.health, hp - DUEL.verdictDamage);
      } else assert.ok(duel.missiles[0].vy >= 30, 'ordinary blocks turn incoming fire away from both pilots');
    }
  }
});

test('the breaking hit is fully absorbed, then a broken or released shield offers no protection', () => {
  const duel = createMechDuel('ground');
  duel.hero.x = -6; duel.enemy.x = 6;
  duel.setInput({ move: 0, lift: 0, guard: true });
  advance(dt => duel.update(dt), 0.3);
  duel.hero.shield = 2;
  Object.assign(duel.enemy, { move: 'thrust', time: choreography.MELEE_STRIKES.thrust.start - 0.01,
    duration: choreography.MELEE_STRIKES.thrust.duration });
  duel.update(0.05);
  assert.equal(duel.hero.health, DUEL.heroHealth);
  assert.equal(duel.hero.shield, 0);
  assert.equal(duel.getState().guarding, false);
  assert.ok(duel.drainEvents().some(event => event.kind === 'guardBreak'));
  duel.missiles.push({ id: 2, owner: 'enemy', kind: 'round', x: duel.hero.x + 2,
    y: 8.6, vx: -48, vy: 0, age: 0, life: 4, damage: DUEL.missileDamage });
  advance(dt => duel.update(dt), 0.15);
  assert.equal(duel.hero.health, DUEL.heroHealth - DUEL.missileDamage);
  duel.clearInput();
  assert.equal(duel.getState().guarding, false);
});

test('loaded rig paths, not the IK guide, determine sword contact', () => {
  const paths = Object.fromEntries(Object.keys(choreography.MELEE_STRIKES).map(move =>
    [move, [{ base: [40, 8, 0], tip: [40, 8, 18] }, { base: [40, 8, 0], tip: [40, 8, 18] }]]));
  const duel = createMechDuel('ground');
  duel.hero.x = -6; duel.enemy.x = 6;
  duel.setBladePaths('hero', paths);
  duel.act('slash'); advance(dt => duel.update(dt), 1.2);
  assert.equal(duel.enemy.health, DUEL.health);
  assert.throws(() => duel.setBladePaths('hero', { ...paths, slash: [] }), /Invalid hero rig blade path/);
  assert.throws(() => duel.setBladePaths('hero', { ...paths, slash: [{ base: [NaN, 0, 0], tip: [0, 0, 0] }] }), /Invalid/);
});

test('a point-blank ultimate leaves a visible dissipating wave and never applies damage twice', () => {
  for (const phase of ['ground', 'space']) {
    const duel = createMechDuel(phase);
    duel.hero.x = -4; duel.enemy.x = 4; duel.hero.invulnerable = 100;
    const hp = duel.enemy.health;
    duel.act('overdrive');
    for (let frame = 0; frame < (choreography.HERO_ULTIMATE.release + 0.5) * 120 && duel.enemy.health === hp; frame++) duel.update(1 / 120);
    assert.equal(duel.enemy.health, hp - DUEL.overdriveDamage);
    assert.ok(duel.missiles.some(missile => missile.kind === 'bladeWave' && missile.damage === 0 && missile.life > 0.15));
    advance(dt => duel.update(dt), 0.4);
    assert.equal(duel.enemy.health, hp - DUEL.overdriveDamage);
    assert.equal(duel.drainEvents().filter(event => event.kind === 'hit' && event.attack === 'overdrive').length, 1);
  }
});

test('rooftop lighting reaches night continuously after assembly, including a skipped intro', () => {
  const { sampleRooftopNight, HERO_TRANSFORM } = choreography;
  assert.equal(sampleRooftopNight('reveal', 26), 0);
  assert.equal(sampleRooftopNight('heroTransform', HERO_TRANSFORM.assembled), 0);
  const endTransform = sampleRooftopNight('heroTransform', FINALE_DURATION.heroTransform);
  assert.equal(endTransform, sampleRooftopNight('versus', 0));
  assert.ok(Math.abs(sampleRooftopNight('versus', FINALE_DURATION.versus) - sampleRooftopNight('ground', 0)) < 1e-12);
  assert.equal(sampleRooftopNight('ground', 8), 1);
  assert.equal(sampleRooftopNight('rupture', 0), 1);
  const director = createFinaleDirector(); director.assetsLoaded(); director.skipIntro();
  assert.equal(director.getState().phase, 'versus');
  assert.ok(sampleRooftopNight(director.getState().phase, 0) >= 0.5);
  director.pause(true); director.skipIntro(); assert.equal(director.getState().phase, 'versus');
});

test('epilogue uses the opening mothership, native mech dance, shared comic BOOM and one faster credit duration', async () => {
  const [opening, finale, mechs, presentation, main, comic] = await Promise.all([
    readFile(new URL('../src/scenes/scene1.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/scenes/level 3/scene21.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/helpers/scene/finaleMechs.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/helpers/scene/finalePresentation.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/helpers/scene/comicEffects.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(opening, /createMothership\(loadShip\)/); assert.match(finale, /createMothership\(\)/);
  assert.match(mechs, /move === 'dance'.*find\('Dance_Loop'\)/);
  assert.match(finale, /phaseTime >= DONUS_RETURN\.appear \? 'dance'/);
  assert.equal(FINALE_DURATION.credits, 28);
  assert.match(presentation, /\/ FINALE_DURATION\.credits/);
  assert.match(finale, /phase === 'done' \? FINALE_DURATION\.credits/);
  assert.match(presentation, /createComicEffectArtwork\('boom'\)/);
  assert.match(comic, /new THREE\.CanvasTexture\(createComicEffectArtwork/);
  assert.doesNotMatch(main, /showCredits|creditsTimer/);
  assert.match(finale, /createHoldToSkip\(\{ button: presentation\.skipButton/);
});

test('D needs distinct mash presses and E needs an uninterrupted hold without freezing the scene', () => {
  for (const shot of ['clash', 'reactor']) {
    const qte = createFinaleQte();
    for (const beat of FINISHER_BEATS) {
      if (beat.shot === shot) break;
      enterFinisherInput(qte, dt => qte.update(dt), beat);
      advance(dt => qte.update(dt), choreography.finisherBeatDuration(beat) - qte.getState().clock + 0.001);
    }
    const beat = qte.getState().beat;
    advance(dt => qte.update(dt), beat.lead + 0.01 - qte.getState().clock);
    const before = qte.getState().clock;
    qte.press(beat.key);
    if (shot === 'clash') {
      for (let i = 0; i < 20; i++) qte.press(beat.key, true);
      assert.equal(qte.getState().presses, 1);
      assert.equal(qte.getState().judged, false);
      qte.release(beat.key);
      for (let i = 1; i < beat.presses; i++) {
        advance(dt => qte.update(dt), 0.14); qte.press(beat.key); qte.release(beat.key);
      }
    } else {
      advance(dt => qte.update(dt), 0.15);
      assert.ok(qte.getState().inputProgress > 0);
      qte.release(beat.key); qte.update(0.02);
      assert.equal(qte.getState().inputProgress, 0);
      qte.press(beat.key); advance(dt => qte.update(dt), beat.hold + 0.01);
    }
    assert.equal(qte.getState().judgement, 'success');
    assert.ok(qte.getState().stars >= 2);
    assert.ok(qte.getState().clock > before);
    assert.ok(qte.getState().clock < choreography.finisherBeatDuration(beat));
    assert.equal(qte.getState().inputProgress, 1);
  }
});

test('three timeouts kill, while pause and key repeat cannot add misses', () => {
  const director = createFinaleDirector('finisher'); director.assetsLoaded();
  const first = FINISHER_BEATS[0];
  advance(dt => director.update(dt), first.lead + 0.1);
  assert.equal(director.qte.press('KeyF', true), false);
  assert.equal(director.qte.getState().misses, 0);
  const before = director.qte.getState().clock;
  director.pause(true); advance(dt => director.update(dt), 5);
  assert.equal(director.qte.getState().clock, before);
  director.pause(false);
  advance(dt => director.update(dt), FINISHER_BEATS.slice(0, 3).reduce((sum, beat) => sum + choreography.finisherBeatDuration(beat), 0));
  assert.equal(director.getState().phase, 'defeat');
  assert.match(director.getState().failure, /Three missed timings/);
});

test('cinematic beat positions meet without snapping and the finisher teleports behind the enemy', () => {
  for (let index = 0; index < FINISHER_BEATS.length - 1; index++) {
    const current = FINISHER_BEATS[index], next = FINISHER_BEATS[index + 1];
    const end = choreography.sampleFinisher(current, choreography.finisherBeatDuration(current));
    const start = choreography.sampleFinisher(next, 0);
    for (const side of ['hero', 'enemy']) {
      end[side].forEach((value, axis) => assert.ok(Math.abs(value - start[side][axis]) < 1e-8, `${current.id} -> ${next.id}: ${side}`));
    }
  }
  const beat = FINISHER_BEATS.at(-1), timing = choreography.FINISHER_EXECUTION;
  const gone = choreography.sampleFinisher(beat, (timing.gone + timing.appear) / 2);
  assert.equal(gone.heroVisible, false);
  const arrived = choreography.sampleFinisher(beat, timing.materialized);
  assert.equal(arrived.heroVisible, true); assert.equal(arrived.heroDissolve, 0);
  assert.ok(arrived.hero[0] > arrived.enemy[0]);
  assert.equal(arrived.barrage, 0, 'the materialization must leave a silent pause before damage');
  assert.equal(choreography.sampleFinisher(beat, timing.lastCut).barrage, 1);
});

test('the planet breaker launches upward, hangs at its apex, then accelerates into Earth', () => {
  const { PLANET_RUPTURE: timing, samplePlanetBreaker: sample } = choreography;
  const origin = [22, 42, -71], impact = [22, -4, -71];
  assert.deepEqual(sample(timing.release, origin, impact), origin);
  const apex = sample(timing.apex, origin, impact);
  assert.ok(apex[1] > origin[1] + 200);
  assert.deepEqual(sample(timing.slam, origin, impact), apex);
  const middle = sample((timing.slam + timing.impact) / 2, origin, impact);
  assert.ok(middle[1] > (apex[1] + impact[1]) / 2, 'the descending bomb must accelerate rather than drift linearly');
  assert.deepEqual(sample(timing.impact, origin, impact), impact);
});

test('developer Unlock no longer requires a password', async () => {
  const [main, markup] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.html', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(main, /developerPassword|Incorrect password/);
  assert.doesNotMatch(markup, /developer-password/);
  assert.match(markup, /id="developer-unlock" type="submit">Unlock/);
});

test('original sword timings and authored special animations are retained instead of procedural replacements', async () => {
  const { MELEE_STRIKES, RIFLE_SEQUENCE, HERO_ULTIMATE, ENEMY_VERDICT } = choreography;
  assert.deepEqual(MELEE_STRIKES.slash, { duration: 1.04, start: 0.34, end: 0.62 });
  assert.deepEqual(MELEE_STRIKES.sideSlash, { duration: 1.12, start: 0.25, end: 0.88 });
  assert.deepEqual(MELEE_STRIKES.cleave, { duration: 1.4, start: 0.6, end: 0.94 });
  assert.equal(RIFLE_SEQUENCE.swordReady, 4.25);
  assert.equal(HERO_ULTIMATE.duration, 2.95);
  assert.equal(ENEMY_VERDICT.duration, 3.15);
  const source = await readFile(new URL('../src/helpers/scene/finaleMechs.ts', import.meta.url), 'utf8');
  assert.match(source, /const clip = nativeClip\(poseMove, airborne, time, !!jump\)/);
  assert.doesNotMatch(source, /custom \? undefined : nativeClip/);
  assert.match(source, /move === 'overdrive'.*move === 'orbitalCut'.*find\('Sword_Attack'\)/);
  assert.match(source, /move === 'skyCharge'.*move === 'verdict'.*find\('Spell_Simple_Idle_Loop'\)/);
  assert.match(source, /isMeleeStrike\(move\) && move !== 'sideSlash'/);
});

test('boosts have no energy gate and can interrupt or chain without recharging', () => {
  for (const phase of ['ground', 'space']) {
    const duel = createMechDuel(phase);
    Object.assign(duel.enemy, { move: 'stagger', duration: 100, invulnerable: 100 });
    duel.hero.energy = 0;
    assert.equal(duel.act('slash'), true);
    assert.equal(duel.act('dash'), true);
    assert.equal(duel.hero.move, 'dash');
    assert.equal(duel.hero.energy, 0);
    for (let i = 0; i < 12; i++) {
      duel.setInput({ move: i % 2 ? 1 : -1, lift: 0, guard: false });
      duel.hero.energy = 0;
      assert.equal(duel.act('dash'), true);
      assert.equal(duel.hero.energy, 0);
      advance(dt => duel.update(dt), choreography.MECH_DODGE.crossDuration + 0.02);
      assert.equal(duel.getState().feedback, '');
      assert.ok(Math.abs(duel.hero.x) <= DUEL.arena);
    }
  }
});

test('ground and orbital horizontal acceleration match, with smooth stops and reversals', () => {
  const ground = createMechDuel('ground'), space = createMechDuel('space');
  for (const duel of [ground, space]) {
    duel.hero.x = -25; duel.enemy.x = 38;
    Object.assign(duel.enemy, { move: 'stagger', duration: 100 });
  }
  for (const direction of [1, 0, -1, 0]) {
    ground.setInput({ move: direction, lift: 0, guard: false });
    space.setInput({ move: direction, lift: 0, guard: false });
    for (let i = 0; i < 90; i++) {
      const before = space.hero.vx;
      ground.update(1 / 120); space.update(1 / 120);
      assert.ok(Math.abs(space.hero.vx - before) < 1);
      assert.ok(Math.abs(space.hero.x - ground.hero.x) < 1e-10);
      assert.ok(Math.abs(space.hero.vx - ground.hero.vx) < 1e-10);
    }
  }
});

test('the cinematic clock retains fractional time and root velocity across prompt boundaries', () => {
  const qte = createFinaleQte();
  const firstEnd = choreography.finisherBeatDuration(FINISHER_BEATS[0]);
  advance(dt => qte.update(dt), firstEnd + 0.027);
  assert.equal(qte.getState().index, 1);
  assert.ok(Math.abs(qte.getState().clock - 0.027) < 1e-8);
  assert.ok(Math.abs(qte.getState().elapsed - firstEnd - 0.027) < 1e-8);
  const epsilon = 0.0001;
  for (const shot of choreography.FINISHER_TIMELINE.slice(1)) {
    const before = choreography.sampleFinisherSequence(shot.start - epsilon);
    const earlier = choreography.sampleFinisherSequence(shot.start - epsilon * 2);
    const after = choreography.sampleFinisherSequence(shot.start + epsilon);
    const later = choreography.sampleFinisherSequence(shot.start + epsilon * 2);
    for (const side of ['hero', 'enemy']) {
      for (let axis = 0; axis < 3; axis++) {
        const incoming = (before[side][axis] - earlier[side][axis]) / epsilon;
        const outgoing = (later[side][axis] - after[side][axis]) / epsilon;
        assert.ok(Math.abs(incoming - outgoing) < 0.01, `${shot.beat.id}: ${side} axis ${axis} velocity`);
        assert.ok(Math.abs(before[side][axis] - after[side][axis]) < 0.005);
      }
    }
  }
});

test('blade trails are short, subdued, motion-only, and cleared on teleport', () => {
  const scene = new THREE.Scene(), trail = createBladeTrail(scene, 'hero');
  const mesh = scene.getObjectByName('hero_BladeAfterimage');
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(0, 12, 0);
  try {
    for (let i = 0; i < 30; i++) trail.update(a, b, 1 / 60, true);
    const alpha = mesh.geometry.getAttribute('trailAlpha').array;
    assert.equal(Math.max(...alpha), 0, 'standing still must not stack luminous blade sheets');
    for (let i = 0; i < 12; i++) {
      a.x += 0.3; b.x += 0.8;
      trail.update(a, b, 1 / 60, true);
    }
    assert.ok(Math.max(...alpha) > 0);
    assert.ok(Math.max(...alpha) <= 0.066);
    assert.equal(mesh.geometry.getAttribute('position').count, 60);
    trail.update(a, b, 0.09, false);
    assert.equal(Math.max(...alpha), 0, 'all afterimages must fade within 0.085 seconds');
    b.x += 1; trail.update(a, b, 1 / 60, true);
    b.x += 1; trail.update(a, b, 1 / 60, true);
    a.x += 40; b.x += 40; trail.update(a, b, 1 / 60, true);
    assert.equal(Math.max(...alpha), 0, 'teleports must never draw a ribbon across the arena');
  } finally { trail.dispose(); }
});

test('Eclipse Rend has an orbital-only cinematic tell and a real sword crossing', () => {
  const duel = createMechDuel('space');
  duel.hero.invulnerable = 100;
  waitForEnemyAttack(duel, 'orbitalCut');
  const origin = duel.enemy.x, timing = choreography.ENEMY_ORBITAL_CUT;
  assert.equal(duel.getState().special.kind, 'orbitalCut');
  assert.equal(duel.getState().special.cinematic, true);
  advance(dt => duel.update(dt), timing.cameraEnd - duel.enemy.time + 0.001);
  assert.equal(duel.getState().special.cinematic, false);
  assert.ok(duel.getState().special.counterRemaining >= DUEL.counterWindow);
  advance(dt => duel.update(dt), timing.cross - duel.enemy.time + 0.01);
  assert.ok(Math.abs(duel.enemy.x - origin) > 12);
  assert.equal(duel.missiles.length, 0, 'this special must use the sword, not another beam projectile');
  const ground = createMechDuel('ground');
  ground.hero.invulnerable = 100;
  advance(dt => ground.update(dt), 25);
  assert.ok(ground.drainEvents().every(event => event.attack !== 'orbitalCut'));
});

test('reboosting mid-crossing preserves the visible arc instead of snapping back to the flight lane', () => {
  const duel = createMechDuel('space');
  duel.hero.x = -6; duel.enemy.x = 6;
  Object.assign(duel.enemy, { move: 'stagger', duration: 100 });
  duel.setInput({ move: 1, lift: 0, guard: false });
  duel.act('dash'); advance(dt => duel.update(dt), 0.25);
  const before = choreography.sampleDodgeArc(duel.hero.time, duel.hero.duration, duel.hero.dash.crossing, duel.hero.dash.offset);
  duel.setInput({ move: -1, lift: 0, guard: false }); duel.act('dash');
  const after = choreography.sampleDodgeArc(duel.hero.time, duel.hero.duration, duel.hero.dash.crossing, duel.hero.dash.offset);
  for (const key of ['lane', 'lift', 'roll']) assert.ok(Math.abs(before[key] - after[key]) < 1e-8);
});

test('hostile beams and damaged armor keep the same sinister palette without a white beam core', () => {
  const skin = createIndustrialSkin('enemy'), beam = createBeamMaterial(FRAME_COLORS.enemy);
  try {
    assert.equal(beam.uniforms.uColor.value.getHex(), skin.uniforms.uFrameGlow.value.getHex());
    assert.equal(beam.uniforms.uColor.value.getHex(), FRAME_COLORS.enemy);
    const shader = { uniforms: {}, vertexShader: '#include <project_vertex>',
      fragmentShader: '#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <emissivemap_fragment>' };
    skin.material.onBeforeCompile(shader, {});
    assert.match(shader.fragmentShader, /totalEmissiveRadiance \+= uFrameGlow \* uDamage/);
    assert.doesNotMatch(beam.fragmentShader, /vec3\(8\.0\)/);
  } finally { skin.dispose(); beam.dispose(); }
});

test('the burning boy and cockpit grief finish before the seamless orbital handoff', async () => {
  const { PLANET_RUPTURE: timing, samplePlanetAftermath } = choreography;
  assert.ok(timing.forest > timing.burst);
  assert.equal(samplePlanetAftermath(timing.forest).forest, true);
  assert.equal(samplePlanetAftermath(timing.forest).burn, 0);
  assert.equal(samplePlanetAftermath(timing.forestEnd - 0.1).burn, 1);
  assert.equal(samplePlanetAftermath(timing.cockpit).forest, false);
  assert.equal(samplePlanetAftermath(timing.cockpit).cockpit, true);
  assert.equal(samplePlanetAftermath(timing.returnToDuel).cockpit, false);
  assert.equal(samplePlanetAftermath(FINALE_DURATION.rupture).orbit, 1);
  const director = createFinaleDirector('ground'); director.assetsLoaded();
  advance(dt => director.update(dt), FINALE_DURATION.versus + 0.01);
  director.duel.enemy.health = DUEL.half;
  director.update(1 / 60);
  assert.equal(director.getState().phase, 'rupture');
  advance(dt => director.update(dt), timing.returnToDuel);
  assert.equal(director.getState().phase, 'rupture', 'the cockpit dialogue cannot be interrupted by combat input');
  advance(dt => director.update(dt), FINALE_DURATION.rupture - timing.returnToDuel + 0.02);
  assert.equal(director.getState().phase, 'space');
  const [scene, aftermath] = await Promise.all([
    readFile(new URL('../src/scenes/level 3/scene21.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/helpers/scene/finaleAftermath.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(scene, /Noooooo! You killed Brendannnnn!/);
  assert.match(scene, /There is no forgiving you now\. You will die\./);
  assert.match(scene, /createFinaleAftermath\(scene, site\.boy, site\.ready/);
  assert.match(aftermath, /Sitting_Talking_Loop/);
  assert.match(aftermath, /uBurn/);
});
