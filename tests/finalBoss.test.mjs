import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import * as THREE from "three";

let server,
  createMechDuel,
  FINISHER_BEATS,
  createFinaleDirector,
  DUEL,
  choreography,
  createMechAnimator,
  FINALE_DURATION;
let createIndustrialSkin, createBeamMaterial, SLASH_MARK_LIFETIME, FRAME_COLORS;
let createBladeTrail;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ createMechDuel, DUEL } = await server.ssrLoadModule(
    "/scripts/npc/mechDuel.ts",
  ));
  ({ createFinaleDirector, FINALE_DURATION } = await server.ssrLoadModule(
    "/scripts/global/finaleDirector.ts",
  ));
  choreography = await server.ssrLoadModule(
    "/scripts/global/finaleChoreography.ts",
  );
  FINISHER_BEATS = choreography.FINISHER_BEATS;
  ({ createMechAnimator } = await server.ssrLoadModule(
    "/scripts/npc/mechAnimation.ts",
  ));
  ({
    createIndustrialSkin,
    createBeamMaterial,
    SLASH_MARK_LIFETIME,
    FRAME_COLORS,
  } = await server.ssrLoadModule("/scripts/level-3/finaleMaterials.ts"));
  ({ createBladeTrail } = await server.ssrLoadModule(
    "/scripts/level-3/finaleEffects.ts",
  ));
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

test("sword combat resolves the same hits at 30 and 60 updates per second", () => {
  function simulate(fps) {
    const duel = createMechDuel("ground");
    duel.hero.x = -6;
    duel.enemy.x = 6;
    Object.assign(duel.enemy, { move: "stagger", time: 0, duration: 10 });
    assert.equal(duel.act("slash"), true);
    for (let frame = 0; frame < fps; frame++) duel.update(1 / fps);
    return {
      heroHealth: duel.hero.health,
      enemyHealth: duel.enemy.health,
      events: duel.drainEvents().map((event) => event.kind),
    };
  }

  const thirty = simulate(30);
  assert.deepEqual(simulate(60), thirty);
  assert.equal(thirty.enemyHealth, 1800 - 58);
  assert.equal(thirty.heroHealth, 1000);
  assert.ok(thirty.events.includes("hit"));
});

test("the held shield drains, breaks, and recharges after release", () => {
  const duel = createMechDuel("ground");
  duel.hero.shield = DUEL.shieldDrain / 10;
  duel.setInput({ move: 0, lift: 0, guard: true });
  advance((dt) => duel.update(dt), 0.05);
  assert.ok(duel.getState().shield < DUEL.shieldDrain / 10);
  advance((dt) => duel.update(dt), 0.05);

  assert.equal(duel.getState().shield, 0);
  assert.ok(duel.getState().shieldLock > 0);
  assert.ok(duel.drainEvents().some((event) => event.kind === "guardBreak"));

  duel.setInput({ move: 0, lift: 0, guard: false });
  advance((dt) => duel.update(dt), duel.getState().shieldLock + 0.1);
  assert.ok(duel.getState().shield > 0);
  assert.equal(DUEL.shieldMax, 100);
});

test("the grounded C slide knocks Sudoers 5 down before it can recover", () => {
  const duel = createMechDuel("ground");
  const contact = [
    { base: [0, 7, 10], tip: [0, 8, 14] },
    { base: [0, 7, 10], tip: [0, 8, 14] },
  ];
  duel.setPhysicalPaths({
    jab: contact,
    cross: contact,
    hook: contact,
    slide: contact,
  });
  duel.hero.x = -6;
  duel.enemy.x = 6;
  Object.assign(duel.enemy, {
    move: "stagger",
    time: 0,
    duration: 10,
    shield: 0,
  });
  duel.setInput({ move: 1, lift: 0, guard: false });

  assert.equal(duel.act("slide"), true);
  for (let frame = 0; frame < 120 && duel.enemy.move !== "knockdown"; frame++)
    duel.update(1 / 120);
  assert.equal(duel.enemy.move, "knockdown");
  assert.equal(duel.enemy.duration, DUEL.slideKnockdown);
  assert.ok(duel.getState().feedback.includes("KNOCKDOWN"));

  advance((dt) => duel.update(dt), DUEL.slideKnockdown - 0.2);
  assert.equal(duel.enemy.move, "knockdown");
  advance((dt) => duel.update(dt), 0.3);
  assert.notEqual(duel.enemy.move, "knockdown");
});

test("the finale HUD uses edge-mounted comic controls and keeps status bars in their requested corners", async () => {
  const presentation = await readFile(
    new URL("../src/scripts/level-3/finalePresentation.ts", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/styles/main.css", import.meta.url),
    "utf8",
  );

  for (const control of [
    "KeyA",
    "KeyD",
    "KeyJ",
    "Space",
    "KeyC",
    "KeyF",
    "KeyR",
    "KeyE",
  ]) {
    assert.match(presentation, new RegExp(`data-input-key="${control}"`));
  }
  assert.doesNotMatch(presentation, /KeyG|STOW|RECALL/);
  assert.match(presentation, /--charge/);
  assert.match(
    css,
    /\.finale-control \{[\s\S]*?border-radius: 50%;[\s\S]*?conic-gradient/,
  );
  assert.match(
    css,
    /html body \.finale-player-status \{[\s\S]*?right: max[\s\S]*?bottom: max[\s\S]*?top: auto !important/,
  );
  assert.match(
    css,
    /\.finale-skip,\s*\.facility-intro-skip \{[\s\S]*?top: max[\s\S]*?right: max[\s\S]*?bottom: auto/,
  );
  assert.match(
    css,
    /body\.finale-active #boss-hud \{[\s\S]*?left: 50%[\s\S]*?translateX\(-50%\)/,
  );
});

test("combat inputs cannot stop, redirect or fail the continuous finisher", () => {
  const director = createFinaleDirector("finisher");
  director.assetsLoaded();
  advance((dt) => director.update(dt), 0.7);
  for (const action of [
    "slash",
    "missiles",
    "dash",
    "overdrive",
    "toggleWeapons",
  ]) {
    assert.equal(director.duel.act(action), false);
  }
  director.update(0.1);
  assert.ok(Math.abs(director.getState().phaseTime - 0.8) < 1e-8);
  assert.equal(director.getState().phase, "finisher");
  assert.equal(director.getState().failure, "");
  assert.equal("qte" in director, false);
});

test("the complete finisher reaches victory without a single input", () => {
  const director = createFinaleDirector("finisher");
  director.assetsLoaded();

  for (const beat of FINISHER_BEATS) {
    assert.equal(director.getState().phase, "finisher");
    advance(
      (dt) => director.update(dt),
      choreography.finisherBeatDuration(beat),
    );
  }

  assert.equal(director.getState().phase, "victory");
  assert.equal(director.duel.getState().phase, "won");
  assert.equal(director.getState().failure, "");
});

test("only an intentional pause freezes the finisher clock", () => {
  const director = createFinaleDirector("finisher");
  director.assetsLoaded();
  advance((dt) => director.update(dt), 1.2);
  director.pause(true);
  advance((dt) => director.update(dt), 10);
  assert.ok(Math.abs(director.getState().phaseTime - 1.2) < 1e-8);
  director.pause(false);
  advance((dt) => director.update(dt), choreography.FINISHER_DURATION - 1.2);
  assert.equal(director.getState().phase, "victory");
});

test("scene 16 enters the merged approach, then the facility interior and finale", async () => {
  const source = (path) =>
    readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [main, approach, facility] = await Promise.all([
    source("main.ts"),
    source("scenes/level 3/scene17.ts"),
    source("scenes/level 3/scene20.ts"),
  ]);

  assert.match(
    main,
    /16: \(\) => import\('\.\/scenes\/level 2\/scene16\.js'\)/,
  );
  for (const scene of [17, 20, 21]) {
    assert.match(
      main,
      new RegExp(
        `${scene}: \\(\\) => import\\('\\.\\/scenes\\/level 3\\/scene${scene}\\.js'\\)`,
      ),
    );
  }
  assert.match(
    main,
    /onFinished: arrival => \{ void loadGround17\(arrival\); \}/,
  );
  assert.doesNotMatch(
    main,
    /import\('\.\/scenes\/level 3\/scene1[89]\.js'\)|loadPlatformer18|onPlatformer/,
  );
  assert.match(main, /entryState, onFinished: loadFacility20/);
  assert.match(main, /onFinished: next => \{ void loadScene21\(next\); \}/);
  assert.match(approach, /onFinished\?\.\(/);
  assert.match(facility, /PRIME: I expected more security\./);
});

test("the finale reuses the facility roof and assigns guarding to R", async () => {
  const boss = await readFile(
    new URL("../src/scenes/level 3/scene21.ts", import.meta.url),
    "utf8",
  );

  assert.match(boss, /const site = createFinaleSite\(\)/);
  assert.match(boss, /site\.disintegrateTrees/);
  assert.match(boss, /guard: keys\.has\('KeyR'\)/);
  assert.doesNotMatch(boss, /getCockpitPoint/);
});

test("student dialogue and sequential chest entry share exact windows", () => {
  const { STUDENT_TIMELINE, activeStudent, sampleStudentBoarding } =
    choreography;
  assert.equal(STUDENT_TIMELINE.length, 5);
  STUDENT_TIMELINE.forEach((timing, index) => {
    const middle = (timing.reveal.start + timing.reveal.end) / 2;
    assert.equal(activeStudent(middle, "reveal"), index);
    assert.equal(
      activeStudent(timing.boarding.start + 0.02, "boarding"),
      index,
    );
    assert.equal(sampleStudentBoarding(index, timing.boarding.start).scale, 1);
    assert.equal(
      sampleStudentBoarding(index, timing.boarding.end).visible,
      false,
    );
    assert.equal(sampleStudentBoarding(index, timing.boarding.end).merge, 1);
    assert.equal(sampleStudentBoarding(index, timing.boarding.end).beam, 0);
    if (index < 4) {
      const next = STUDENT_TIMELINE[index + 1];
      assert.ok(Math.abs(timing.boarding.end - next.boarding.start) < 1e-8);
      assert.equal(
        sampleStudentBoarding(index + 1, timing.boarding.start + 1).ascent,
        0,
      );
    }
  });
});

test("every opening route shows the versus intro before combat", () => {
  const fromCheckpoint = createFinaleDirector("ground");
  fromCheckpoint.assetsLoaded();
  assert.equal(fromCheckpoint.getState().phase, "versus");
  advance((dt) => fromCheckpoint.update(dt), FINALE_DURATION.versus + 0.05);
  assert.equal(fromCheckpoint.getState().phase, "ground");
  assert.equal(fromCheckpoint.getCheckpoint().stage, "ground");

  const skipped = createFinaleDirector("reveal");
  skipped.assetsLoaded();
  skipped.holdSkip(true);
  advance((dt) => skipped.update(dt), 1.3);
  assert.equal(skipped.getState().phase, "versus");

  const complete = createFinaleDirector("reveal");
  complete.assetsLoaded();
  advance(
    (dt) => complete.update(dt),
    FINALE_DURATION.reveal +
      FINALE_DURATION.enemyTransform +
      FINALE_DURATION.heroTransform +
      0.2,
  );
  assert.equal(complete.getState().phase, "versus");
});

test("rifle rounds wait for the shoulder draw and allow the return animation", () => {
  const { RIFLE_SEQUENCE, sampleRifleSequence } = choreography;
  const duel = createMechDuel("ground");
  duel.hero.x = -25;
  duel.enemy.x = 25;
  duel.hero.invulnerable = duel.enemy.invulnerable = 100;
  Object.assign(duel.enemy, { move: "stagger", duration: 100 });
  assert.equal(duel.act("missiles"), true);
  assert.ok(duel.hero.duration > RIFLE_SEQUENCE.swordReady);
  advance((dt) => duel.update(dt), RIFLE_SEQUENCE.ready);
  assert.equal(
    duel.drainEvents().filter((event) => event.kind === "launch").length,
    0,
  );
  advance(
    (dt) => duel.update(dt),
    RIFLE_SEQUENCE.lastShot - RIFLE_SEQUENCE.ready + 0.02,
  );
  assert.equal(
    duel
      .drainEvents()
      .filter((event) => event.kind === "launch" && event.owner === "hero")
      .length,
    5,
  );
  assert.equal(sampleRifleSequence(RIFLE_SEQUENCE.ready).shoulderToAim, 1);
  assert.equal(sampleRifleSequence(RIFLE_SEQUENCE.swordReady).swordReturn, 1);
});

test("the finisher stages evasion, parry and a blade lock without input windows", () => {
  const { sampleFinisher } = choreography;
  const dodge = FINISHER_BEATS.find((beat) => beat.shot === "evade");
  const prompt = sampleFinisher(dodge, 0);
  const dodging = sampleFinisher(
    dodge,
    choreography.finisherActionTime(dodge) + 0.2,
  );
  assert.equal(prompt.enemyPose, "verdict");
  assert.equal(dodging.heroPose, "evade");
  assert.ok(dodging.hero[2] > prompt.hero[2] + 5);
  assert.ok(
    dodging.heroRoll < 0 && Math.abs(dodging.heroRoll) <= 0.16,
    "Evasion has controlled banking, not a whole-body tumble",
  );
  const clash = FINISHER_BEATS.find((beat) => beat.shot === "clash");
  assert.equal(sampleFinisher(clash, clash.action).bladeLock, 1);
  const parry = FINISHER_BEATS.find((beat) => beat.shot === "parry");
  assert.equal(sampleFinisher(parry, parry.action).bladeLock, 1);
  assert.ok(
    FINISHER_BEATS.every((beat) => !("key" in beat) && !("window" in beat)),
  );
  assert.equal(
    sampleFinisher(clash, choreography.finisherBeatDuration(clash)).enemyPose,
    "stagger",
  );
  assert.ok(FINISHER_BEATS.some((beat) => beat.shot === "countershot"));
});

test("custom mech clips do not rotate hips, legs, knees, or feet", () => {
  const model = new THREE.Group();
  const names = [
    "pelvis",
    "spine_02",
    "spine_03",
    "Head",
    "upperarm_l",
    "upperarm_r",
    "lowerarm_l",
    "lowerarm_r",
    "hand_l",
    "hand_r",
    "thigh_l",
    "thigh_r",
    "calf_l",
    "calf_r",
    "foot_l",
    "foot_r",
  ];
  names.forEach((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    model.add(bone);
  });
  const lower = [
    "pelvis",
    "thigh_l",
    "thigh_r",
    "calf_l",
    "calf_r",
    "foot_l",
    "foot_r",
  ].map((name) => model.getObjectByName(name));
  const animator = createMechAnimator(model);
  try {
    for (const clip of animator.animations) {
      for (const bone of lower)
        assert.ok(
          !clip.tracks.some((track) => track.name.startsWith(bone.uuid)),
          `${clip.name} must not animate ${bone.name}`,
        );
    }
    for (const move of [
      "clash",
      "evade",
      "boost",
      "skyCharge",
      "bomb",
      "missiles",
      "slash",
      "sideSlash",
      "thrust",
      "reap",
      "verdict",
      "afterCut",
    ]) {
      animator.pose(move, 0.6, 1, true);
      for (const bone of lower)
        assert.deepEqual(bone.quaternion.toArray(), [0, 0, 0, 1]);
    }
  } finally {
    animator.dispose();
  }
});

test("cinematic rifle damage advances through one recoil rather than reversing the hit pose", () => {
  const beat = FINISHER_BEATS.find((beat) => beat.shot === "countershot");
  let previous = 0;
  for (
    let time = choreography.FINISHER_RIFLE.fire + 0.22;
    time <= beat.duration;
    time += 1 / 60
  ) {
    const pose = choreography.sampleFinisher(beat, time);
    assert.ok(
      pose.enemyPoseProgress >= previous,
      "Recoil time cannot scrub back to the start of the damage clip",
    );
    assert.ok(Math.abs(pose.enemyRoll) <= 0.06);
    previous = pose.enemyPoseProgress;
  }
});

test("the world has no generated mech pads and the ship flight is wired into Scene 21", async () => {
  const [world, scene, mechs, credits] = await Promise.all([
    readFile(
      new URL("../src/scripts/level-3/finaleWorld.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/scenes/level 3/scene21.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/scripts/level-3/finaleMechs.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/scripts/level-3/finalePresentation.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(world, /MechPoweredRooftopStage|OrbitalFacilityWreckage/);
  assert.match(world, /EarthRockDebris/);
  assert.doesNotMatch(world, /CeilingSpotlight|new THREE\.SpotLight/);
  assert.match(scene, /createFinaleSite\(\)/);
  assert.match(
    scene,
    /shipTransform\.update\(state\.phase, state\.phaseTime\)/,
  );
  assert.match(scene, /terrestrial\.visible = !inSpace/);
  assert.match(mechs, /fitWeaponToHand\(swordGripSocket, swordBone, 0\)/);
  assert.match(mechs, /loadToolModel\('Gun_Rifle'\)/);
  assert.match(credits, /translate\(-50%,/);
  assert.doesNotMatch(credits, /setCreditSprite|finale-credit-dancer/);
  assert.doesNotMatch(scene, /createFinaleCreditSprite/);
  assert.match(
    mechs,
    /hero: async \(\) => \(\{ \.\.\.\(await loadMCModel\(\)\)/,
  );
});

test("finale cockpit uses the on-foot Brondon model rather than the mech model", async () => {
  const source = await readFile(
    new URL("../src/scripts/level-3/finaleAftermath.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Promise\.all\(\[forestReady, loadPlayerModel\(\)\]\)/);
  assert.doesNotMatch(source, /loadMCModel/);
  assert.match(source, /clip\.name === 'Sitting_Idle_Loop'/);
  assert.match(source, /clip\.name === 'Sitting_Talking_Loop'/);
});

test("blade sweeps hit armor at reach but miss distant and vertically separated targets", () => {
  for (const phase of ["ground", "space"]) {
    const contact = createMechDuel(phase);
    contact.hero.x = -6;
    contact.enemy.x = 6;
    Object.assign(contact.enemy, { move: "stagger", time: 0, duration: 10 });
    assert.equal(contact.act("slash"), true);
    advance((dt) => contact.update(dt), 0.9);
    const hits = contact
      .drainEvents()
      .filter((event) => event.kind === "hit" && event.owner === "hero");
    assert.equal(hits.length, 1);
    assert.ok(hits[0].trace);
    assert.ok(
      Math.hypot(
        ...hits[0].trace.from.map(
          (value, axis) => value - hits[0].trace.to[axis],
        ),
      ) > 3,
    );

    const distant = createMechDuel(phase);
    distant.hero.x = -30;
    distant.enemy.x = 30;
    const hp = distant.enemy.health;
    distant.act("slash");
    advance((dt) => distant.update(dt), 1.1);
    assert.equal(distant.enemy.health, hp);
    assert.equal(
      distant.drainEvents().filter((event) => event.kind === "hit").length,
      0,
    );
  }
  const above = createMechDuel("space");
  above.hero.x = -6;
  above.enemy.x = 6;
  above.hero.y = 15;
  above.enemy.y = -10;
  const hp = above.enemy.health;
  above.act("slash");
  advance((dt) => above.update(dt), 1.1);
  assert.equal(above.enemy.health, hp);
});

test("J chains distinct downward, side and heavy cuts", () => {
  const duel = createMechDuel("ground");
  duel.hero.x = -6;
  duel.enemy.x = 6;
  duel.hero.invulnerable = 100;
  Object.assign(duel.enemy, { move: "stagger", duration: 10 });
  const moves = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0)
      Object.assign(duel.enemy, {
        move: "stagger",
        time: 0,
        duration: 10,
        invulnerable: 0,
      });
    assert.equal(duel.act("slash"), true);
    moves.push(duel.hero.move);
    advance((dt) => duel.update(dt), duel.hero.duration + 0.16);
  }
  assert.deepEqual(moves, ["slash", "sideSlash", "cleave"]);
  const attacks = duel
    .drainEvents()
    .filter((event) => event.kind === "hit" && event.owner === "hero");
  assert.deepEqual(
    attacks.map((event) => event.damage),
    [DUEL.slashDamage, DUEL.slashDamage, DUEL.cleaveDamage],
  );
});

test("the Sudoers 5 fighter rushes, evades committed cuts, raises its shield against rifle fire, and can be side-switched", () => {
  const dodger = createMechDuel("ground");
  dodger.hero.x = -6;
  dodger.enemy.x = 6;
  dodger.enemy.invulnerable = 100;
  assert.equal(dodger.act("slash"), true);
  advance((dt) => dodger.update(dt), 0.45);
  assert.equal(dodger.enemy.move, "dash");
  assert.ok(
    dodger.enemy.invulnerable > 0,
    "a read should become a real, brief evasive dodge",
  );
  assert.ok(
    dodger
      .drainEvents()
      .some((event) => event.kind === "dash" && event.owner === "enemy"),
  );

  const blocker = createMechDuel("ground");
  blocker.hero.x = -32;
  blocker.enemy.x = 32;
  blocker.hero.invulnerable = 100;
  advance((dt) => blocker.update(dt), 1.7);
  blocker.hero.x = 0;
  blocker.enemy.x = 12;
  blocker.enemy.move = "idle";
  blocker.enemy.time = 0;
  assert.equal(blocker.act("missiles"), true);
  advance(
    (dt) => blocker.update(dt),
    choreography.RIFLE_SEQUENCE.cameraEnd + 0.42,
  );
  assert.equal(
    blocker.getState().enemyGuarding,
    true,
    "the defender reads the rifle pose and commits to a shield",
  );

  const crossing = createMechDuel("ground");
  crossing.hero.x = -6;
  crossing.enemy.x = 6;
  crossing.enemy.invulnerable = 100;
  Object.assign(crossing.enemy, { move: "stagger", duration: 10 });
  crossing.setInput({ move: 1, lift: 0, guard: false });
  assert.equal(crossing.act("dash"), true);
  assert.equal(crossing.hero.dash.crossing, true);
  advance(
    (dt) => crossing.update(dt),
    choreography.MECH_DODGE.crossDuration + 0.03,
  );
  assert.ok(
    crossing.hero.x > crossing.enemy.x,
    "holding toward the opponent with Space carries the pilot behind them",
  );

  const rusher = createMechDuel("ground");
  rusher.hero.x = -32;
  rusher.enemy.x = 32;
  rusher.hero.invulnerable = 100;
  advance((dt) => rusher.update(dt), 4.2);
  assert.ok(
    rusher.enemy.x < 32,
    "the enemy should close ground across the arena",
  );
  assert.ok(
    rusher
      .drainEvents()
      .some((event) => event.kind === "tell" && event.owner === "enemy"),
    "the rush transitions into an attack",
  );
});

test("a queued J input chains once after weighted hit-stop and recovery", () => {
  const duel = createMechDuel("ground");
  duel.hero.x = -6;
  duel.enemy.x = 6;
  duel.hero.invulnerable = 100;
  duel.act("slash");
  advance((dt) => duel.update(dt), 0.65);
  assert.equal(duel.act("slash"), true);
  advance((dt) => duel.update(dt), 1.6);
  assert.deepEqual(
    duel
      .drainEvents()
      .filter((event) => event.kind === "swing")
      .map((event) => event.attack),
    ["slash", "sideSlash"],
  );
});
test("Last Light starts ready, launches a blade wave, and recharges with combat time", () => {
  for (const phase of ["ground", "space"]) {
    const duel = createMechDuel(phase);
    duel.hero.x = -32;
    duel.enemy.x = 32;
    duel.hero.invulnerable = 100;
    assert.equal(duel.getState().ultimateCooldown, 0);
    assert.equal(duel.act("overdrive"), true);
    assert.equal(duel.getState().ultimateCooldown, DUEL.ultimateCooldown);
    advance((dt) => duel.update(dt), choreography.HERO_ULTIMATE.release - 0.02);
    assert.equal(
      duel.drainEvents().filter((event) => event.kind === "launch").length,
      0,
    );
    duel.update(0.05);
    assert.ok(
      duel.missiles.some((projectile) => projectile.kind === "bladeWave"),
    );
    const cooldown = duel.getState().ultimateCooldown;
    advance((dt) => duel.update(dt), 1.2);
    assert.equal(duel.act("overdrive"), false);
    assert.match(duel.getState().feedback, /RECHARGING/);
    assert.ok(duel.getState().ultimateCooldown < cooldown);
    advance((dt) => duel.update(dt), duel.getState().ultimateCooldown + 0.02);
    assert.equal(duel.getState().ultimateCooldown, 0);
    assert.equal(duel.act("overdrive"), true);
  }
  const blade = choreography.sampleUltimateBlade(
    choreography.HERO_ULTIMATE.release,
  );
  assert.ok(blade.tip[1] > 5, "the flash must leave the blade above ground");
  assert.ok(blade.direction[2] > 0.9, "the release must point forward");
});

test("every special returns control at least 0.55 seconds before its projectile releases", () => {
  for (const [action, timing] of [
    ["missiles", choreography.RIFLE_SEQUENCE],
    ["overdrive", choreography.HERO_ULTIMATE],
  ]) {
    const duel = createMechDuel("ground");
    duel.hero.x = -32;
    duel.enemy.x = 32;
    duel.act(action);
    advance((dt) => duel.update(dt), timing.cameraEnd + 0.001);
    assert.equal(duel.getState().special.cinematic, false);
    assert.ok(duel.getState().special.counterRemaining >= DUEL.counterWindow);
    assert.equal(
      duel.drainEvents().some((event) => event.kind === "launch"),
      false,
    );
  }
  assert.ok(
    choreography.ENEMY_VERDICT.release - choreography.ENEMY_VERDICT.cameraEnd >=
      DUEL.counterWindow,
  );
});

test("Sudoers 5 jumps forward, lands and connects its thrust in both combat phases", () => {
  for (const phase of ["ground", "space"]) {
    const duel = createMechDuel(phase);
    duel.hero.invulnerable = 100;
    if (phase === "space") duel.hero.y = duel.enemy.y = 3;
    waitForEnemyAttack(duel, "thrust");
    const origin = { x: duel.enemy.x, y: duel.enemy.y };
    const gap = Math.abs(duel.enemy.x - duel.hero.x);
    advance((dt) => duel.update(dt), 0.37);
    assert.ok(
      (duel.enemy.x - origin.x) * duel.enemy.facing > 1,
      "the leap must move the combat body toward Brondon",
    );
    assert.ok(
      duel.enemy.y > origin.y + 2,
      "the thrust must visibly leave the ground or orbital flight lane",
    );
    assert.ok(Math.abs(duel.enemy.x - duel.hero.x) < gap);
    advance(
      (dt) => duel.update(dt),
      choreography.ENEMY_ATTACK_LEAPS.thrust.land - duel.enemy.time + 0.01,
    );
    assert.ok(
      Math.abs(duel.enemy.y - (phase === "space" ? 3 : 0)) < 1e-8,
      "the landing must preserve the flight altitude",
    );
    duel.hero.invulnerable = 0;
    advance(
      (dt) => duel.update(dt),
      choreography.MELEE_STRIKES.thrust.end - duel.enemy.time + 0.02,
    );
    assert.equal(duel.hero.health, DUEL.heroHealth - 72);
    assert.ok(Math.abs(duel.enemy.x - duel.hero.x) >= DUEL.separation - 1e-8);
  }
});

test("Sudoers 5 leaps backward before its beam without shortening the dodge and guard window", () => {
  for (const phase of ["ground", "space"]) {
    const duel = createMechDuel(phase);
    duel.hero.invulnerable = 100;
    if (phase === "space") duel.hero.y = duel.enemy.y = 3;
    waitForEnemyAttack(duel, "verdict");
    const origin = { x: duel.enemy.x, y: duel.enemy.y };
    const gap = Math.abs(duel.enemy.x - duel.hero.x);
    assert.equal(duel.act("slash"), false);
    assert.equal(
      duel.getState().feedback,
      "",
      "the special close-up must not produce a recovery hint",
    );
    advance((dt) => duel.update(dt), 0.37);
    assert.ok(
      (duel.enemy.x - origin.x) * duel.enemy.facing < -1,
      "the special must retreat, not advance",
    );
    assert.ok(duel.enemy.y > origin.y + 2);
    assert.ok(Math.abs(duel.enemy.x - duel.hero.x) > gap);
    advance(
      (dt) => duel.update(dt),
      choreography.ENEMY_VERDICT.cameraEnd - duel.enemy.time + 0.001,
    );
    assert.equal(duel.getState().special.cinematic, false);
    assert.ok(duel.getState().special.counterRemaining >= DUEL.counterWindow);
    assert.ok(Math.abs(duel.enemy.y - (phase === "space" ? 3 : 0)) < 1e-8);
    assert.ok(Math.abs(duel.enemy.x) <= DUEL.arena);
    duel.drainEvents();
    advance(
      (dt) => duel.update(dt),
      choreography.ENEMY_VERDICT.release - duel.enemy.time - 0.015,
    );
    assert.equal(
      duel.drainEvents().some((event) => event.kind === "launch"),
      false,
    );
    duel.update(0.03);
    assert.equal(
      duel
        .drainEvents()
        .filter(
          (event) => event.kind === "launch" && event.attack === "verdict",
        ).length,
      1,
    );
  }
});

test("busy actions stay quiet while actionable resource warnings remain", () => {
  const duel = createMechDuel("ground");
  assert.equal(duel.act("slash"), true);
  assert.equal(duel.act("slash"), false);
  assert.equal(duel.getState().feedback, "");
  advance(
    (dt) => duel.update(dt),
    choreography.MELEE_STRIKES.slash.duration + 0.01,
  );
  duel.hero.energy = 0;
  assert.equal(duel.act("missiles"), false);
  assert.match(duel.getState().feedback, /ENERGY/);
});

function swordBeamDuel(phase = "space") {
  const duel = createMechDuel(phase);
  duel.hero.x = -20;
  duel.enemy.x = 20;
  Object.assign(duel.enemy, {
    move: "verdict",
    duration: choreography.ENEMY_VERDICT.duration,
    time: 0,
  });
  return duel;
}

test("the enemy sword beam locks its aim and can be dodged or fully blocked after the close-up", () => {
  const idle = swordBeamDuel();
  advance((dt) => idle.update(dt), 3);
  assert.equal(idle.hero.health, DUEL.heroHealth - DUEL.verdictDamage);
  assert.ok(
    idle
      .drainEvents()
      .some((event) => event.kind === "hit" && event.attack === "verdict"),
  );

  const dodging = swordBeamDuel();
  advance(
    (dt) => dodging.update(dt),
    choreography.ENEMY_VERDICT.cameraEnd + 0.001,
  );
  dodging.setInput({ move: 0, lift: 1, guard: false });
  advance((dt) => dodging.update(dt), 1.5);
  assert.equal(dodging.hero.health, DUEL.heroHealth);

  const guarding = swordBeamDuel();
  advance(
    (dt) => guarding.update(dt),
    choreography.ENEMY_VERDICT.cameraEnd + 0.001,
  );
  guarding.setInput({ move: 0, lift: 0, guard: true });
  advance((dt) => guarding.update(dt), 1.5);
  assert.equal(guarding.hero.health, DUEL.heroHealth);
  assert.ok(
    guarding
      .drainEvents()
      .some((event) => event.kind === "guard" && event.attack === "verdict"),
  );
});

test("Sudoers 5 keeps its original attacks and adds an orbital sword special, never the player sword/rifle moves", () => {
  const duel = createMechDuel("space");
  duel.hero.invulnerable = 100;
  advance((dt) => duel.update(dt), 22);
  const attacks = duel
    .drainEvents()
    .filter((event) => event.kind === "tell")
    .map((event) => event.attack);
  assert.ok(attacks.includes("thrust"));
  assert.ok(attacks.includes("reap"));
  assert.ok(attacks.includes("verdict"));
  assert.ok(attacks.includes("orbitalCut"));
  assert.ok(
    attacks.every((attack) =>
      ["thrust", "reap", "verdict", "orbitalCut"].includes(attack),
    ),
  );
});

test("damage engravings stay in mech-local armor coordinates and fade in 1.65 seconds", () => {
  const root = new THREE.Group(),
    skin = createIndustrialSkin("enemy");
  try {
    skin.update(root, 10, 1, 0, 0);
    skin.engrave(new THREE.Vector3(-2, 4, 2), new THREE.Vector3(2, 13, 2));
    root.position.set(70, 100, -20);
    root.rotation.y = Math.PI;
    skin.update(root, 10.5, 1, 0, 0);
    const cut = skin.uniforms.uCutStarts.value[0];
    assert.deepEqual([cut.x, cut.y, cut.z], [-2, 4, 2]);
    assert.ok(cut.w > 0 && cut.w < 1);
    assert.equal(skin.uniforms.uCutColor.value.getHex(), FRAME_COLORS.hero);
    skin.update(root, 10 + SLASH_MARK_LIFETIME + 0.001, 1, 0, 0);
    assert.equal(cut.w, 0);
  } finally {
    skin.dispose();
  }
});

test("every finisher action belongs to an explicit, bounded shot duration", () => {
  for (const beat of FINISHER_BEATS) {
    assert.ok(beat.action > 0 && beat.action < beat.duration, beat.id);
    assert.equal(choreography.finisherActionTime(beat), beat.action);
    assert.equal(choreography.finisherBeatDuration(beat), beat.duration);
  }
  assert.ok(
    choreography.FINISHER_DURATION > 28 && choreography.FINISHER_DURATION < 30,
  );
});

test("mashing combat buttons and doing nothing produce the same film and victory", () => {
  const watching = createFinaleDirector("finisher"),
    mashing = createFinaleDirector("finisher");
  watching.assetsLoaded();
  mashing.assetsLoaded();
  for (
    let frame = 0;
    frame < 2000 && watching.getState().phase === "finisher";
    frame++
  ) {
    mashing.duel.act(frame % 2 ? "slash" : "dash");
    watching.update(1 / 60);
    mashing.update(1 / 60);
    const a = watching.getState(),
      b = mashing.getState();
    assert.equal(a.phase, b.phase);
    assert.equal(a.phaseTime, b.phaseTime);
    if (a.phase === "finisher") {
      assert.deepEqual(
        choreography.sampleFinisherSequence(a.phaseTime),
        choreography.sampleFinisherSequence(b.phaseTime),
      );
    }
  }
  assert.equal(watching.getState().phase, "victory");
  assert.equal(mashing.getState().phase, "victory");
});

test("all finisher shots remain protected from gameplay attacks", () => {
  for (const shot of choreography.FINISHER_TIMELINE) {
    const director = createFinaleDirector("finisher");
    director.assetsLoaded();
    advance((dt) => director.update(dt), shot.start + 0.1);
    for (let press = 0; press < 20; press++) {
      assert.equal(director.duel.act("missiles"), false);
      director.clearInput();
    }
    assert.equal(director.getState().phase, "finisher", shot.beat.id);
    assert.equal(director.getState().failure, "");
    assert.equal(director.getCheckpoint().stage, "finisher");
  }
});

test("R blocks melee at the shield surface and recoils the attacker in both fight phases", () => {
  for (const phase of ["ground", "space"]) {
    for (const attacking of [false, true]) {
      const duel = createMechDuel(phase);
      duel.hero.x = -6;
      duel.enemy.x = 6;
      Object.assign(duel.enemy, { move: "stagger", time: 0, duration: 10 });
      duel.setInput({ move: 0, lift: 0, guard: true });
      advance((dt) => duel.update(dt), 0.4);
      if (attacking) assert.equal(duel.act("slash"), true);
      Object.assign(duel.enemy, {
        move: "thrust",
        time: choreography.MELEE_STRIKES.thrust.start - 0.01,
        duration: choreography.MELEE_STRIKES.thrust.duration,
      });
      const shield = duel.hero.shield;
      duel.update(0.05);
      assert.equal(duel.hero.health, DUEL.heroHealth);
      assert.ok(duel.hero.shield < shield);
      assert.equal(duel.enemy.move, "stagger");
      assert.ok(
        duel.enemy.vx > 0,
        "the attacking mech must recoil away from the shield",
      );
      assert.equal(duel.getState().guarding, true);
      assert.ok(
        duel
          .drainEvents()
          .some((event) => event.kind === "guard" && event.attack === "thrust"),
      );
    }
  }
});

test("normal shielding deflects beams and timed parries return them to the attacker", () => {
  for (const phase of ["ground", "space"]) {
    for (const perfect of [false, true]) {
      const duel = createMechDuel(phase);
      duel.hero.x = -20;
      duel.enemy.x = 20;
      Object.assign(duel.enemy, { move: "stagger", time: 0, duration: 10 });
      duel.setInput({ move: 0, lift: 0, guard: true });
      if (!perfect) advance((dt) => duel.update(dt), 0.4);
      duel.missiles.push({
        id: 1,
        owner: "enemy",
        kind: "verdictBeam",
        x: duel.hero.x + 11,
        y: duel.hero.y + 8.6,
        vx: -48,
        vy: 0,
        age: 0,
        life: 4,
        damage: DUEL.verdictDamage,
      });
      duel.update(0.05);
      assert.equal(duel.hero.health, DUEL.heroHealth);
      assert.equal(
        duel.missiles.length,
        1,
        "a blocked beam must remain visible as it bounces away",
      );
      assert.equal(duel.missiles[0].owner, "hero");
      assert.ok(duel.missiles[0].vx > 0);
      assert.ok(
        duel
          .drainEvents()
          .some((event) => event.kind === (perfect ? "parry" : "guard")),
      );
      if (perfect) {
        const hp = duel.enemy.health;
        advance((dt) => duel.update(dt), 0.8);
        assert.equal(duel.enemy.health, hp - DUEL.verdictDamage);
      } else
        assert.ok(
          duel.missiles[0].vy >= 30,
          "ordinary blocks turn incoming fire away from both pilots",
        );
    }
  }
});

test("the breaking hit is fully absorbed, then a broken or released shield offers no protection", () => {
  const duel = createMechDuel("ground");
  duel.hero.x = -6;
  duel.enemy.x = 6;
  duel.setInput({ move: 0, lift: 0, guard: true });
  advance((dt) => duel.update(dt), 0.3);
  duel.hero.shield = 2;
  Object.assign(duel.enemy, {
    move: "thrust",
    time: choreography.MELEE_STRIKES.thrust.start - 0.01,
    duration: choreography.MELEE_STRIKES.thrust.duration,
  });
  duel.update(0.05);
  assert.equal(duel.hero.health, DUEL.heroHealth);
  assert.equal(duel.hero.shield, 0);
  assert.equal(duel.getState().guarding, false);
  assert.ok(duel.drainEvents().some((event) => event.kind === "guardBreak"));
  duel.missiles.push({
    id: 2,
    owner: "enemy",
    kind: "round",
    x: duel.hero.x + 2,
    y: 8.6,
    vx: -48,
    vy: 0,
    age: 0,
    life: 4,
    damage: DUEL.missileDamage,
  });
  advance((dt) => duel.update(dt), 0.15);
  assert.equal(duel.hero.health, DUEL.heroHealth - DUEL.missileDamage);
  duel.clearInput();
  assert.equal(duel.getState().guarding, false);
});

test("loaded rig paths, not the IK guide, determine sword contact", () => {
  const paths = Object.fromEntries(
    Object.keys(choreography.MELEE_STRIKES).map((move) => [
      move,
      [
        { base: [40, 8, 0], tip: [40, 8, 18] },
        { base: [40, 8, 0], tip: [40, 8, 18] },
      ],
    ]),
  );
  const duel = createMechDuel("ground");
  duel.hero.x = -6;
  duel.enemy.x = 6;
  duel.setBladePaths("hero", paths);
  duel.act("slash");
  advance((dt) => duel.update(dt), 1.2);
  assert.equal(duel.enemy.health, DUEL.health);
  assert.throws(
    () => duel.setBladePaths("hero", { ...paths, slash: [] }),
    /Invalid hero rig blade path/,
  );
  assert.throws(
    () =>
      duel.setBladePaths("hero", {
        ...paths,
        slash: [{ base: [NaN, 0, 0], tip: [0, 0, 0] }],
      }),
    /Invalid/,
  );
});

test("a point-blank ultimate leaves a visible dissipating wave and never applies damage twice", () => {
  for (const phase of ["ground", "space"]) {
    const duel = createMechDuel(phase);
    duel.hero.x = -4;
    duel.enemy.x = 4;
    duel.hero.invulnerable = 100;
    const hp = duel.enemy.health;
    duel.act("overdrive");
    for (
      let frame = 0;
      frame < (choreography.HERO_ULTIMATE.release + 0.5) * 120 &&
      duel.enemy.health === hp;
      frame++
    )
      duel.update(1 / 120);
    assert.equal(duel.enemy.health, hp - DUEL.overdriveDamage);
    assert.ok(
      duel.missiles.some(
        (missile) =>
          missile.kind === "bladeWave" &&
          missile.damage === 0 &&
          missile.life > 0.15,
      ),
    );
    advance((dt) => duel.update(dt), 0.4);
    assert.equal(duel.enemy.health, hp - DUEL.overdriveDamage);
    assert.equal(
      duel
        .drainEvents()
        .filter((event) => event.kind === "hit" && event.attack === "overdrive")
        .length,
      1,
    );
  }
});

test("rooftop lighting reaches night continuously after assembly, including a skipped intro", () => {
  const { sampleRooftopNight, HERO_TRANSFORM } = choreography;
  assert.equal(sampleRooftopNight("reveal", 26), 0);
  assert.equal(
    sampleRooftopNight("heroTransform", HERO_TRANSFORM.assembled),
    0,
  );
  const endTransform = sampleRooftopNight(
    "heroTransform",
    FINALE_DURATION.heroTransform,
  );
  assert.equal(endTransform, sampleRooftopNight("versus", 0));
  assert.ok(
    Math.abs(
      sampleRooftopNight("versus", FINALE_DURATION.versus) -
        sampleRooftopNight("ground", 0),
    ) < 1e-12,
  );
  assert.equal(sampleRooftopNight("ground", 8), 1);
  assert.equal(sampleRooftopNight("rupture", 0), 1);
  const director = createFinaleDirector();
  director.assetsLoaded();
  director.skipIntro();
  assert.equal(director.getState().phase, "versus");
  assert.ok(sampleRooftopNight(director.getState().phase, 0) >= 0.5);
  director.pause(true);
  director.skipIntro();
  assert.equal(director.getState().phase, "versus");
});

test("epilogue uses the opening mothership, native mech dance, shared comic BOOM and one readable credit duration", async () => {
  const [opening, finale, mechs, presentation, main, comic] = await Promise.all(
    [
      readFile(new URL("../src/scenes/scene1.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/scenes/level 3/scene21.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/scripts/level-3/finaleMechs.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/scripts/level-3/finalePresentation.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/scripts/global/comicEffects.ts", import.meta.url),
        "utf8",
      ),
    ],
  );
  assert.match(opening, /createMothership\(loadShip\)/);
  assert.match(finale, /createMothership\(\)/);
  assert.match(mechs, /move === 'dance'.*find\('Dance_Loop'\)/);
  assert.match(
    finale,
    /phaseTime >= DONUS_RETURN\.dance && phaseTime < DONUS_RETURN\.appear/,
  );
  assert.equal(FINALE_DURATION.credits, 90);
  assert.match(presentation, /\/ FINALE_DURATION\.credits/);
  assert.match(finale, /phase === 'done' \? FINALE_DURATION\.credits/);
  assert.match(presentation, /createComicEffectArtwork\('boom'\)/);
  assert.match(comic, /new THREE\.CanvasTexture\(createComicEffectArtwork/);
  assert.doesNotMatch(main, /showCredits|creditsTimer/);
  assert.match(finale, /createHoldToSkip\(\{ button: presentation\.skipButton/);
});

test("developer credits entry starts at the real roll, pauses, and completes without combat or QTE input", () => {
  const director = createFinaleDirector("credits");
  assert.equal(director.getState().phase, "loading");
  director.assetsLoaded();
  assert.equal(director.getState().phase, "credits");
  assert.equal(director.getState().phaseTime, 0);
  assert.equal(director.duel.enemy.health, 0);
  assert.deepEqual(director.drainChanges(), ["credits"]);
  director.pause(true);
  advance((dt) => director.update(dt), 10);
  assert.equal(director.getState().phaseTime, 0);
  director.pause(false);
  advance((dt) => director.update(dt), FINALE_DURATION.credits - 0.1);
  assert.equal(director.getState().phase, "credits");
  advance((dt) => director.update(dt), 0.2);
  assert.equal(director.getState().phase, "done");
  assert.equal(director.getState().ended, true);
  assert.deepEqual(director.drainDuelEvents(), []);
});

test("the blade lock and charge animate without waiting for mash or hold inputs", () => {
  for (const shot of ["clash", "reactor"]) {
    const timing = choreography.FINISHER_TIMELINE.find(
      (entry) => entry.beat.shot === shot,
    );
    const director = createFinaleDirector("finisher");
    director.assetsLoaded();
    advance(
      (dt) => director.update(dt),
      timing.start + timing.beat.action - 0.25,
    );
    const before = director.getState().phaseTime;
    advance((dt) => director.update(dt), 0.5);
    assert.ok(director.getState().phaseTime > before);
    const sample = choreography.sampleFinisherSequence(
      director.getState().phaseTime,
    );
    assert.equal(sample.beat.shot, shot);
    assert.ok(sample.progress > 0);
    if (shot === "reactor") assert.ok(sample.heroCharge > 0);
    else assert.ok(sample.bladeLock > 0.9);
  }
});

test("leaving the controls untouched never creates a timeout or death", () => {
  const director = createFinaleDirector("finisher");
  director.assetsLoaded();
  advance((dt) => director.update(dt), 0.8);
  const before = director.getState().phaseTime;
  director.pause(true);
  advance((dt) => director.update(dt), 5);
  assert.equal(director.getState().phaseTime, before);
  director.pause(false);
  advance((dt) => director.update(dt), choreography.FINISHER_DURATION - before);
  assert.equal(director.getState().phase, "victory");
  assert.equal(director.getState().failure, "");
});

test("cinematic beat positions meet without snapping and the finisher teleports behind the enemy", () => {
  for (let index = 0; index < FINISHER_BEATS.length - 1; index++) {
    const current = FINISHER_BEATS[index],
      next = FINISHER_BEATS[index + 1];
    const end = choreography.sampleFinisher(
      current,
      choreography.finisherBeatDuration(current),
    );
    const start = choreography.sampleFinisher(next, 0);
    for (const side of ["hero", "enemy"]) {
      end[side].forEach((value, axis) =>
        assert.ok(
          Math.abs(value - start[side][axis]) < 1e-8,
          `${current.id} -> ${next.id}: ${side}`,
        ),
      );
    }
  }
  const beat = FINISHER_BEATS.at(-1),
    timing = choreography.FINISHER_EXECUTION;
  const gone = choreography.sampleFinisher(
    beat,
    (timing.gone + timing.appear) / 2,
  );
  assert.equal(gone.heroVisible, false);
  const arrived = choreography.sampleFinisher(beat, timing.materialized);
  assert.equal(arrived.heroVisible, true);
  assert.equal(arrived.heroDissolve, 0);
  assert.ok(arrived.hero[0] > arrived.enemy[0]);
  assert.equal(
    arrived.barrage,
    0,
    "the materialization must leave a silent pause before damage",
  );
  assert.equal(choreography.sampleFinisher(beat, timing.lastCut).barrage, 1);
});

test("the planet breaker launches upward, hangs at its apex, then accelerates into Earth", () => {
  const { PLANET_RUPTURE: timing, samplePlanetBreaker: sample } = choreography;
  const origin = [22, 42, -71],
    impact = [22, -4, -71];
  assert.deepEqual(sample(timing.release, origin, impact), origin);
  const apex = sample(timing.apex, origin, impact);
  assert.ok(apex[1] > origin[1] + 200);
  assert.deepEqual(sample(timing.slam, origin, impact), apex);
  const middle = sample((timing.slam + timing.impact) / 2, origin, impact);
  assert.ok(
    middle[1] > (apex[1] + impact[1]) / 2,
    "the descending bomb must accelerate rather than drift linearly",
  );
  assert.deepEqual(sample(timing.impact, origin, impact), impact);
});

test("developer Unlock no longer requires a password", async () => {
  const [main, markup] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(main, /developerPassword|Incorrect password/);
  assert.doesNotMatch(markup, /developer-password/);
  assert.match(markup, /id="developer-unlock" type="submit">Unlock/);
});

test("authored UAL sword timings and cinematic clips are retained instead of procedural replacements", async () => {
  const { MELEE_STRIKES, RIFLE_SEQUENCE, HERO_ULTIMATE, ENEMY_VERDICT } =
    choreography;
  assert.deepEqual(MELEE_STRIKES.slash, {
    duration: 1.533333,
    start: 0.34,
    end: 0.6,
  });
  assert.deepEqual(MELEE_STRIKES.sideSlash, {
    duration: 1.4,
    start: 0.17,
    end: 0.35,
  });
  assert.deepEqual(MELEE_STRIKES.cleave, {
    duration: 2,
    start: 0.54,
    end: 0.82,
  });
  assert.equal(RIFLE_SEQUENCE.swordReady, 4.25);
  assert.equal(HERO_ULTIMATE.duration, 2.95);
  assert.equal(ENEMY_VERDICT.duration, 3.15);
  const source = await readFile(
    new URL("../src/scripts/level-3/finaleMechs.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const clip = nativeClip\(poseMove, airborne, time, !!jump, custom\)/,
  );
  assert.doesNotMatch(source, /custom \? undefined : nativeClip/);
  assert.match(
    source,
    /isMeleeStrike\(move\)\) return find\(SWORD_ATTACK_CLIPS\[move\]\)/,
  );
  assert.match(
    source,
    /cinematic && \(move === 'skyCharge' \|\| move === 'reactor'\)\) return find\('Spell_Simple_Idle_Loop'\)/,
  );
  assert.match(
    source,
    /cinematic && \(move === 'evade' \|\| move === 'boost'\)\) return find\('Jump_Loop'\)/,
  );
  assert.match(
    source,
    /swordClipTime\(time, clip\.duration, MELEE_STRIKES\.cleave/,
  );
});

test("boosts have no energy gate and can interrupt or chain without recharging", () => {
  for (const phase of ["ground", "space"]) {
    const duel = createMechDuel(phase);
    Object.assign(duel.enemy, {
      move: "stagger",
      duration: 100,
      invulnerable: 100,
    });
    duel.hero.energy = 0;
    assert.equal(duel.act("slash"), true);
    assert.equal(duel.act("dash"), true);
    assert.equal(duel.hero.move, "dash");
    assert.equal(duel.hero.energy, 0);
    for (let i = 0; i < 12; i++) {
      duel.setInput({ move: i % 2 ? 1 : -1, lift: 0, guard: false });
      duel.hero.energy = 0;
      assert.equal(duel.act("dash"), true);
      assert.equal(duel.hero.energy, 0);
      advance(
        (dt) => duel.update(dt),
        choreography.MECH_DODGE.crossDuration + 0.02,
      );
      assert.equal(duel.getState().feedback, "");
      assert.ok(Math.abs(duel.hero.x) <= DUEL.arena);
    }
  }
});

test("ground and orbital horizontal acceleration match, with smooth stops and reversals", () => {
  const ground = createMechDuel("ground"),
    space = createMechDuel("space");
  for (const duel of [ground, space]) {
    duel.hero.x = -25;
    duel.enemy.x = 38;
    Object.assign(duel.enemy, { move: "stagger", duration: 100 });
  }
  for (const direction of [1, 0, -1, 0]) {
    ground.setInput({ move: direction, lift: 0, guard: false });
    space.setInput({ move: direction, lift: 0, guard: false });
    for (let i = 0; i < 90; i++) {
      const before = space.hero.vx;
      ground.update(1 / 120);
      space.update(1 / 120);
      assert.ok(Math.abs(space.hero.vx - before) < 1);
      assert.ok(Math.abs(space.hero.x - ground.hero.x) < 1e-10);
      assert.ok(Math.abs(space.hero.vx - ground.hero.vx) < 1e-10);
    }
  }
});

test("the cinematic clock retains fractional time and root velocity across shot boundaries", () => {
  const director = createFinaleDirector("finisher");
  director.assetsLoaded();
  const firstEnd = choreography.finisherBeatDuration(FINISHER_BEATS[0]);
  advance((dt) => director.update(dt), firstEnd + 0.027);
  const sample = choreography.sampleFinisherSequence(
    director.getState().phaseTime,
  );
  assert.equal(sample.index, 1);
  assert.ok(Math.abs(sample.clock - 0.027) < 1e-8);
  assert.ok(Math.abs(director.getState().phaseTime - firstEnd - 0.027) < 1e-8);
  const epsilon = 0.00001;
  for (const shot of choreography.FINISHER_TIMELINE.slice(1)) {
    const before = choreography.sampleFinisherSequence(shot.start - epsilon);
    const earlier = choreography.sampleFinisherSequence(
      shot.start - epsilon * 2,
    );
    const after = choreography.sampleFinisherSequence(shot.start + epsilon);
    const later = choreography.sampleFinisherSequence(shot.start + epsilon * 2);
    for (const side of ["hero", "enemy"]) {
      for (let axis = 0; axis < 3; axis++) {
        const incoming = (before[side][axis] - earlier[side][axis]) / epsilon;
        const outgoing = (later[side][axis] - after[side][axis]) / epsilon;
        assert.ok(
          Math.abs(incoming - outgoing) < 0.01,
          `${shot.beat.id}: ${side} axis ${axis} velocity`,
        );
        assert.ok(Math.abs(before[side][axis] - after[side][axis]) < 0.005);
      }
    }
  }
});

test("blade trails are short, subdued, motion-only, and cleared on teleport", () => {
  const scene = new THREE.Scene(),
    trail = createBladeTrail(scene, "hero");
  const mesh = scene.getObjectByName("hero_BladeAfterimage");
  const a = new THREE.Vector3(0, 0, 0),
    b = new THREE.Vector3(0, 12, 0);
  try {
    for (let i = 0; i < 30; i++) trail.update(a, b, 1 / 60, true);
    const alpha = mesh.geometry.getAttribute("trailAlpha").array;
    assert.equal(
      Math.max(...alpha),
      0,
      "standing still must not stack luminous blade sheets",
    );
    for (let i = 0; i < 12; i++) {
      a.x += 0.3;
      b.x += 0.8;
      trail.update(a, b, 1 / 60, true);
    }
    assert.ok(Math.max(...alpha) > 0);
    assert.ok(Math.max(...alpha) <= 0.066);
    assert.equal(mesh.geometry.getAttribute("position").count, 60);
    trail.update(a, b, 0.09, false);
    assert.equal(
      Math.max(...alpha),
      0,
      "all afterimages must fade within 0.085 seconds",
    );
    b.x += 1;
    trail.update(a, b, 1 / 60, true);
    b.x += 1;
    trail.update(a, b, 1 / 60, true);
    a.x += 40;
    b.x += 40;
    trail.update(a, b, 1 / 60, true);
    assert.equal(
      Math.max(...alpha),
      0,
      "teleports must never draw a ribbon across the arena",
    );
  } finally {
    trail.dispose();
  }
});

test("Eclipse Rend has an orbital-only cinematic tell and a real sword crossing", () => {
  const duel = createMechDuel("space");
  duel.hero.invulnerable = 100;
  waitForEnemyAttack(duel, "orbitalCut");
  const origin = duel.enemy.x,
    timing = choreography.ENEMY_ORBITAL_CUT;
  assert.equal(duel.getState().special.kind, "orbitalCut");
  assert.equal(duel.getState().special.cinematic, true);
  advance((dt) => duel.update(dt), timing.cameraEnd - duel.enemy.time + 0.001);
  assert.equal(duel.getState().special.cinematic, false);
  assert.ok(duel.getState().special.counterRemaining >= DUEL.counterWindow);
  advance((dt) => duel.update(dt), timing.cross - duel.enemy.time + 0.01);
  assert.ok(Math.abs(duel.enemy.x - origin) > 12);
  assert.equal(
    duel.missiles.length,
    0,
    "this special must use the sword, not another beam projectile",
  );
  const ground = createMechDuel("ground");
  ground.hero.invulnerable = 100;
  advance((dt) => ground.update(dt), 25);
  assert.ok(
    ground.drainEvents().every((event) => event.attack !== "orbitalCut"),
  );
});

test("reboosting mid-crossing preserves the visible arc instead of snapping back to the flight lane", () => {
  const duel = createMechDuel("space");
  duel.hero.x = -6;
  duel.enemy.x = 6;
  Object.assign(duel.enemy, { move: "stagger", duration: 100 });
  duel.setInput({ move: 1, lift: 0, guard: false });
  duel.act("dash");
  advance((dt) => duel.update(dt), 0.25);
  const before = choreography.sampleDodgeArc(
    duel.hero.time,
    duel.hero.duration,
    duel.hero.dash.crossing,
    duel.hero.dash.offset,
  );
  duel.setInput({ move: -1, lift: 0, guard: false });
  duel.act("dash");
  const after = choreography.sampleDodgeArc(
    duel.hero.time,
    duel.hero.duration,
    duel.hero.dash.crossing,
    duel.hero.dash.offset,
  );
  for (const key of ["lane", "lift", "roll"])
    assert.ok(Math.abs(before[key] - after[key]) < 1e-8);
});

test("hostile beams and damaged armor keep the same sinister palette without a white beam core", () => {
  const skin = createIndustrialSkin("enemy"),
    beam = createBeamMaterial(FRAME_COLORS.enemy);
  try {
    assert.equal(
      beam.uniforms.uColor.value.getHex(),
      skin.uniforms.uFrameGlow.value.getHex(),
    );
    assert.equal(beam.uniforms.uColor.value.getHex(), FRAME_COLORS.enemy);
    const shader = {
      uniforms: {},
      vertexShader: "#include <project_vertex>",
      fragmentShader:
        "#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <emissivemap_fragment>",
    };
    skin.material.onBeforeCompile(shader, {});
    assert.match(
      shader.fragmentShader,
      /totalEmissiveRadiance \+= uFrameGlow \* uDamage/,
    );
    assert.doesNotMatch(beam.fragmentShader, /vec3\(8\.0\)/);
  } finally {
    skin.dispose();
    beam.dispose();
  }
});

test("the burning boy and cockpit grief finish before the seamless orbital handoff", async () => {
  const { PLANET_RUPTURE: timing, samplePlanetAftermath } = choreography;
  assert.ok(timing.forest > timing.impact);
  assert.ok(timing.forestEnd < timing.burst);
  assert.ok(timing.burst < timing.cockpit);
  assert.equal(samplePlanetAftermath(timing.forest).forest, true);
  assert.equal(samplePlanetAftermath(timing.forest).burn, 0);
  assert.equal(samplePlanetAftermath(timing.forestEnd - 0.1).burn, 1);
  assert.equal(samplePlanetAftermath(timing.cockpit).forest, false);
  assert.equal(samplePlanetAftermath(timing.cockpit).cockpit, true);
  assert.equal(samplePlanetAftermath(timing.returnToDuel).cockpit, false);
  assert.equal(samplePlanetAftermath(FINALE_DURATION.rupture).orbit, 1);
  const director = createFinaleDirector("ground");
  director.assetsLoaded();
  advance((dt) => director.update(dt), FINALE_DURATION.versus + 0.01);
  director.duel.enemy.health = DUEL.half;
  director.update(1 / 60);
  assert.equal(director.getState().phase, "rupture");
  advance((dt) => director.update(dt), timing.returnToDuel);
  assert.equal(
    director.getState().phase,
    "rupture",
    "the cockpit dialogue cannot be interrupted by combat input",
  );
  advance(
    (dt) => director.update(dt),
    FINALE_DURATION.rupture - timing.returnToDuel + 0.02,
  );
  assert.equal(director.getState().phase, "space");
  const [scene, aftermath] = await Promise.all([
    readFile(
      new URL("../src/scenes/level 3/scene21.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/scripts/level-3/finaleAftermath.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(scene, /Nooooo, Brendan!!/);
  assert.match(scene, /I will never forgive you\. You must die\./);
  assert.match(
    scene,
    /createFinaleAftermath\(\s*scene,\s*site\.boy,\s*site\.ready/,
  );
  assert.match(aftermath, /Sitting_Talking_Loop/);
  assert.match(aftermath, /uBurn/);
});
