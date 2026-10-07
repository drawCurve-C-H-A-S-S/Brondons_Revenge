import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import * as THREE from 'three';

let server, createMechDuel, createFinaleQte, FINISHER_BEATS, createFinaleDirector, DUEL, choreography, createMechAnimator, FINALE_DURATION;

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

test('sword combat resolves the same hits at 30 and 60 updates per second', () => {
  function simulate(fps) {
    const duel = createMechDuel('ground');
    duel.hero.x = -6;
    duel.enemy.x = 6;
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

test('the finisher rejects a wrong input after the cue arms', () => {
  const qte = createFinaleQte();
  advance(dt => qte.update(dt), FINISHER_BEATS[0].lead + 0.05);
  assert.equal(qte.getState().armed, true);
  assert.equal(qte.press('KeyF'), false);
  assert.equal(qte.getState().result, 'lost');
  assert.equal(qte.getState().failure, 'wrong-input');
});

test('the complete finisher QTE reaches the victory branch', () => {
  const director = createFinaleDirector('finisher');
  director.assetsLoaded();

  for (const beat of FINISHER_BEATS) {
    assert.equal(director.getState().phase, 'finisher');
    advance(dt => director.update(dt), beat.lead + 0.03);
    assert.equal(director.qte.getState().armed, true, `${beat.id} should arm before input`);

    if (beat.mode === 'mash') {
      for (let count = 0; count < beat.presses; count++) {
        assert.equal(director.qte.press(beat.key), true);
        director.qte.release(beat.key);
      }
    } else {
      assert.equal(director.qte.press(beat.key), true);
      if (beat.mode === 'hold') {
        advance(dt => director.update(dt), beat.hold + 0.03);
        director.qte.release(beat.key);
      }
    }
    advance(dt => director.update(dt), beat.resolve + 0.03);
  }

  assert.equal(director.getState().phase, 'victory');
  assert.equal(director.duel.getState().phase, 'won');
});

test('a failed finisher transitions to the game-over branch', () => {
  const director = createFinaleDirector('finisher');
  director.assetsLoaded();
  advance(dt => director.update(dt), FINISHER_BEATS[0].lead + 0.05);
  director.qte.press('KeyF');
  director.update(1 / 60);

  assert.equal(director.getState().phase, 'defeat');
  assert.match(director.getState().failure, /students killed Brondon/);
});

test('scene 16-19 progression remains intact and the scene 19 exit opens scene 21', async () => {
  const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const [main, approach, summit] = await Promise.all([
    source('main.ts'),
    source('scenes/level 3/scene17.ts'),
    source('scenes/level 3/scene19.ts'),
  ]);

  assert.match(main, /16: \(\) => import\('\.\/scenes\/level 2\/scene16\.js'\)/);
  for (const scene of [17, 18, 19, 21]) {
    assert.match(main, new RegExp(`${scene}: \\(\\) => import\\('\\.\\/scenes\\/level 3\\/scene${scene}\\.js'\\)`));
  }
  assert.match(main, /onFinished: arrival => \{ void loadGround17\(arrival\); \}/);
  assert.match(main, /onPlatformer: loadPlatformer18/);
  assert.match(main, /onFinished: next => \{ void loadScene21\(next\); \}/);
  assert.match(approach, /if \(returning\) onFinished\?\.\(/);
  assert.match(summit, /section: 'return'/);
});

test('the finale reuses the facility roof and assigns guarding to R', async () => {
  const boss = await readFile(new URL('../src/scenes/level 3/scene21.ts', import.meta.url), 'utf8');

  assert.match(boss, /createRescueSite\(physics, \{ culling: true, bridgeBrokenAtStart: true \}\)/);
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
  assert.equal(duel.act('missiles'), true);
  assert.ok(duel.hero.duration > RIFLE_SEQUENCE.swordReady);
  advance(dt => duel.update(dt), RIFLE_SEQUENCE.ready);
  assert.equal(duel.drainEvents().filter(event => event.kind === 'launch').length, 0);
  advance(dt => duel.update(dt), RIFLE_SEQUENCE.lastShot - RIFLE_SEQUENCE.ready + 0.02);
  assert.equal(duel.drainEvents().filter(event => event.kind === 'launch' && event.owner === 'hero').length, 5);
  assert.equal(sampleRifleSequence(RIFLE_SEQUENCE.ready).shoulderToAim, 1);
  assert.equal(sampleRifleSequence(RIFLE_SEQUENCE.swordReady).swordReturn, 1);
});

test('the finisher clocks animate gun dodges and the D sword lock independently of combat', () => {
  const { sampleFinisher } = choreography;
  const dodge = FINISHER_BEATS.find(beat => beat.shot === 'evade');
  const prompt = sampleFinisher(dodge, dodge.lead, -1);
  const dodging = sampleFinisher(dodge, dodge.lead, dodge.resolve / 2);
  assert.equal(prompt.enemyPose, 'missiles');
  assert.equal(dodging.heroPose, 'evade');
  assert.ok(dodging.hero[2] > prompt.hero[2] + 5);
  assert.ok(dodging.heroRoll < -0.3);
  const clash = FINISHER_BEATS.find(beat => beat.shot === 'clash');
  assert.equal(clash.key, 'KeyD');
  assert.equal(clash.mode, 'mash');
  assert.equal(sampleFinisher(clash, clash.lead + 0.3, -1).heroPose, 'clash');
  assert.equal(sampleFinisher(clash, clash.lead, clash.resolve / 2).enemyPose, 'stagger');
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
    for (const move of ['clash', 'evade', 'boost', 'reactor', 'bomb', 'missiles', 'slash']) {
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
  assert.match(world, /EdenRockDebris/);
  assert.match(world, /CeilingSpotlight/);
  assert.match(scene, /releasePropCulling\(site\.ship\.root\)/);
  assert.match(scene, /shipTransform\.update\(state\.phase, state\.phaseTime\)/);
  assert.match(scene, /terrestrial\.visible = !inSpace/);
  assert.match(mechs, /fitWeaponToHand\(swordGripSocket, swordBone, 0\)/);
  assert.match(mechs, /loadToolModel\('Gun_Rifle'\)/);
  assert.match(credits, /translate\(-50%,/);
  assert.match(credits, /setCreditSprite/);
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
