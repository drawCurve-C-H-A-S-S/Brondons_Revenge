import * as THREE from 'three';
import { finaleMusicTrack } from '../../helpers/audio/gameMusic.js';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import { createFinaleStudents, SUDOERS_5 } from '../../helpers/scene/finaleActors.js';
import { createFinaleCamera } from '../../helpers/scene/finaleCinematography.js';
import { createBladeTrail, createFinaleEffects } from '../../helpers/scene/finaleEffects.js';
import { createFinaleMech, type MechFactory } from '../../helpers/scene/finaleMechs.js';
import { createFinalePresentation } from '../../helpers/scene/finalePresentation.js';
import { createFinaleRenderer } from '../../helpers/scene/finaleRenderer.js';
import { createFinaleShipTransformation } from '../../helpers/scene/finaleShipTransformation.js';
import { createFinaleCreditSprite } from '../../helpers/scene/finaleCreditSprite.js';
import { createMothership } from '../../helpers/scene/mothership.js';
import { createHoldToSkip } from '../../helpers/animation/holdToSkip.js';
import { createBeamMaterial, FRAME_COLORS } from '../../helpers/scene/finaleMaterials.js';
import { createHangarVersus } from '../../helpers/scene/hangarVersus.js';
import {
  FINALE_DECK_Y, FINALE_ROOFTOP, FINALE_BATTLE_YAW, PLANET_CENTER, PLANET_RADIUS, SPACE_ALTITUDE, createFinaleWorld, finaleBattlePoint,
} from '../../helpers/scene/finaleWorld.js';
import { loadSubjectModel } from '../../core/loader.js';
import { createRescueSite, RESCUE_SITE, type RescueArrival } from '../../helpers/scene/rescueSite.js';
import { disposeComicEffects, emitComicEffect } from '../../helpers/scene/comicEffects.js';
import { createFinaleDirector, FINALE_DURATION, type FinaleCheckpoint, type FinalePhase } from '../../scripts/finaleDirector.js';
import { DUEL, FINISHER_BEATS, sampleBladeDamageTrace, type DuelProjectileKind, type BladeDamageTrace, type FinisherBeat } from '../../scripts/mechDuel.js';
import {
  FINALE_START_X, STUDENT_TIMELINE, HERO_TRANSFORM, PLANET_RUPTURE, RIFLE_SEQUENCE,
  HERO_ULTIMATE, ENEMY_VERDICT, MELEE_STRIKES, FINISHER_EXECUTION,
  activeStudent, sampleStudentBoarding, sampleFinisher, isMeleeStrike, sampleMeleeBlade,
  finisherActionTime, cinematicProgress, sampleRooftopNight, DONUS_RETURN, sampleDodgeArc,
} from '../../scripts/finaleChoreography.js';
import type { MechPoseName } from '../../scripts/mechAnimation.js';
import { createPlayer } from '../../scripts/player.js';
import type { CinematicPose, loadCharacter } from '../../scripts/characterManager.js';

interface FinaleOptions {
  entryState?: RescueArrival;
  checkpoint?: FinaleCheckpoint;
  renderer: THREE.WebGLRenderer;
  onFinished: () => void;
  onRetry: (checkpoint: FinaleCheckpoint) => void;
  mechFactories?: Partial<Record<'hero' | 'enemy', MechFactory>>;
  loadStudents?: typeof loadSubjectModel;
}

const smooth = THREE.MathUtils.smootherstep;
const vector = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const summitPoint = (x: number, y = 0, z = 0) =>
  vector(FINALE_ROOFTOP.x + x, FINALE_DECK_Y + y, FINALE_ROOFTOP.z + z);
const COMBAT_KEYS = new Set([
  'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyR', 'Space', 'KeyJ', 'KeyF', 'KeyE',
]);
const ACTION_KEYS: Record<string, 'slash' | 'missiles' | 'dash' | 'overdrive'> = {
  KeyJ: 'slash', KeyF: 'missiles', Space: 'dash', KeyE: 'overdrive',
};

const LINES: Partial<Record<FinalePhase, { start: number; end: number; speaker: string; text: string }[]>> = {
  reveal: [
    { start: 0, end: 3.1, speaker: 'BRONDON', text: 'Top floor. The command signal ends here.' },
    { start: 3.1, end: 6.4, speaker: 'BRONDON', text: 'Those are the five student signatures.' },
    { start: 6.4, end: 8.2, speaker: 'BRONDON', text: 'You corrupted Donus. You planned this all along?' },
    ...[
      'You followed the signal exactly where we wanted.',
      'We taught Donus to fear the people he meant to protect.',
      'His corruption was only the first test.',
      'Five student minds. One perfect command.',
      'We never needed the facility. Only its key.',
    ].map((text, i) => ({ ...STUDENT_TIMELINE[i].reveal, speaker: SUDOERS_5[i].name, text })),
    { start: 21.2, end: 24, speaker: 'SUDOERS 5', text: 'Donus was only the beginning.' },
    { start: 24, end: 27, speaker: 'SUDOERS 5', text: 'Five minds. One verdict. Your last.' },
  ],
  enemyTransform: [
    { start: 0, end: 3.2, speaker: 'PRIME', text: 'Brondon, behind me! The roof is coming down!' },
    { start: 3.2, end: 5.4, speaker: 'SUDOERS 5', text: 'Behold the Final Verdict.' },
    ...[
      'Every escape route ends here.',
      'Five cores. One flawless machine.',
      'Donus was proof that our design works.',
      'Five wills. One verdict.',
      'Erase him.',
    ].map((text, i) => ({ ...STUDENT_TIMELINE[i].boarding, speaker: SUDOERS_5[i].name, text })),
    { start: 17, end: 19.2, speaker: 'SUDOERS 5', text: 'Final Verdict. All five cores online.' },
  ],
  heroTransform: [
    { start: 0, end: 2.6, speaker: 'PRIME', text: 'They have five cores. We have one chance.' },
    { start: 2.6, end: 6.4, speaker: 'PRIME', text: 'Shuttle, emergency ascent. Give him everything.' },
    { start: 6.4, end: 10.2, speaker: 'PRIME', text: "The frame will hold. Brondon... you have to hold with it." },
    { start: 10.2, end: 12.6, speaker: 'BRONDON', text: "Donus is still in there. I'm not leaving him." },
    { start: 12.6, end: 17, speaker: 'BRONDON', text: 'Prime Frame. Stand with me.' },
  ],
  rupture: [
    { start: 0, end: 3.8, speaker: 'SUDOERS 5', text: 'If we cannot rule this world, no one will.' },
    { start: 3.8, end: 9, speaker: 'PRIME', text: 'That bomb will ignite the core! Boost now, Brondon!' },
    { start: 14.8, end: 19.2, speaker: 'BRONDON', text: 'Then we finish this among the stars.' },
  ],
  finisher: [
    { start: 0, end: 3.2, speaker: 'PRIME', text: 'The frame is coming apart. Stay with me, Brondon!' },
  ],
  victory: [
    { start: 0, end: 3.2, speaker: 'BRONDON', text: 'The reactor is down. The fight is over.' },
    { start: 3.2, end: 9.2, speaker: 'PRIME', text: 'Donus, if you can hear us, come back.' },
    { start: 9.2, end: 18, speaker: 'DONUS', text: 'Brondon... I am here. Thank you.' },
  ],
  defeat: [
    { start: 0, end: 4.2, speaker: 'SUDOERS 5', text: 'The last light goes out.' },
  ],
};

export function createScene({ entryState, checkpoint, renderer, onFinished, onRetry,
  mechFactories, loadStudents = loadSubjectModel }: FinaleOptions) {
  const physics = createScenePhysics();
  const site = createRescueSite(physics, { culling: true, bridgeBrokenAtStart: true });
  const scene = site.scene;
  const ceilingLift = FINALE_ROOFTOP.y - (site.facilityRoof.position.y + 0.4);
  site.facilityRoof.position.y += ceilingLift;
  site.rooftopEquipment.position.y += ceilingLift;
  const terrestrial = new THREE.Group(); terrestrial.name = 'FinaleTerrestrialEnvironment';
  const environmentLights: THREE.Object3D[] = [];
  for (const child of [...scene.children]) {
    if (child instanceof THREE.Light || child.type === 'Object3D') environmentLights.push(child);
    else terrestrial.add(child);
  }
  const environmentIntensity = new Map(environmentLights.filter((light): light is THREE.Light => light instanceof THREE.Light)
    .map(light => [light, light.intensity]));
  const environmentColors = new Map([...environmentIntensity.keys()].map(light => [light, light.color.clone()]));
  const moonColor = new THREE.Color(0x91b5e1);
  const moon = new THREE.DirectionalLight(moonColor, 0);
  moon.position.copy(summitPoint(-45, 75, 35)); moon.target.position.copy(summitPoint(0, 8));
  scene.add(moon, moon.target);
  scene.add(terrestrial);
  const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.08, 5200);
  const spawn = summitPoint(0, 0.32, RESCUE_SITE.doorZ - FINALE_ROOFTOP.z - 6);
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: spawn });
  if (entryState?.pilotState) player.restoreTransition(entryState.pilotState, {
    x: FINALE_ROOFTOP.x, y: FINALE_DECK_Y, z: FINALE_ROOFTOP.z, yaw: -Math.PI,
  });
  player.setPosition(spawn.x, spawn.y, spawn.z);
  player.setRotation(0, 0);
  player.disable();
  player.clearInput();
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove('jungle-platformer', 'space-cinematic');
  site.activatePhysicsNear(player.body.position);
  scene.onBeforeRender = (_renderer, _scene, viewCamera) => {
    if (terrestrial.visible) site.updateVisibility(viewCamera, player.body.position);
  };

  for (const id of [
    'flight-hud', 'flight-controls', 'space-crosshair', 'space-boss-hud', 'space-alert',
    'space-damage', 'space-pause', 'space-cinematic-caption', 'escape-qte',
  ]) document.getElementById(id)?.classList.add('hidden');

  const world = createFinaleWorld(scene, { facilityRoof: site.facilityRoof });
  const mothership = createMothership(); mothership.root.visible = false; scene.add(mothership.root);
  physics.addBox({ x: 70, y: 0.4, z: 32 }, { x: 0, y: FINALE_DECK_Y - 0.2, z: FINALE_ROOFTOP.z });
  site.releasePropCulling(site.ship.root);
  site.ship.setCanopyOpen(1); site.ship.update(0);
  const shipTransform = createFinaleShipTransformation(scene, site.ship, finaleBattlePoint(-FINALE_START_X));
  const students = createFinaleStudents(loadStudents);
  students.root.visible = false;
  scene.add(students.root);
  const heroMech = createFinaleMech('hero', mechFactories?.hero);
  const enemyMech = createFinaleMech('enemy', mechFactories?.enemy);
  heroMech.root.visible = false;
  enemyMech.root.visible = false;
  scene.add(heroMech.root, enemyMech.root);
  const versus = createHangarVersus({
    singleOpponent: true, playerName: 'BRONDON / PRIME FRAME', opponentName: 'SUDOERS 5 / FINAL VERDICT',
    portraitScale: 1.83 / 16, layout: 'columns',
  });
  versus.root.classList.add('finale-versus');
  const matchLabel = document.createElement('div'); matchLabel.className = 'finale-versus-chapter';
  matchLabel.textContent = 'FINAL CHAPTER / FIVE MINDS. ONE LAST LIGHT.';
  const matchCall = document.createElement('div'); matchCall.className = 'finale-versus-call';
  versus.root.append(matchLabel, matchCall);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = document.body.classList.contains('touch-device') || window.matchMedia('(max-width: 700px)').matches;
  const effects = createFinaleEffects(scene, reducedMotion, mobile);
  const heroTrail = createBladeTrail(scene, 'hero');
  const enemyTrail = createBladeTrail(scene, 'enemy');
  const cameraRig = createFinaleCamera(camera, reducedMotion);
  const director = createFinaleDirector(checkpoint?.stage ?? 'reveal');
  const presentation = createFinalePresentation((code, pressed) => handleInput(code, pressed), () => onRetry(director.getCheckpoint()));
  let postProcessing: ReturnType<typeof createFinaleRenderer> | null = null;
  try {
    postProcessing = createFinaleRenderer(renderer, scene, camera, mobile);
  } catch (error) {
    console.error('[Scene 21] Could not initialize the finale renderer:', error);
  }

  const missileGeometry = new THREE.CapsuleGeometry(0.14, 2.4, 4, 8);
  const missileNoseGeometry = new THREE.ConeGeometry(0.2, 0.42, 8);
  const tracerGeometry = new THREE.CylinderGeometry(0.32, 0.025, 5.4, 12);
  const missileMaterials = {
    hero: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdcfaff).multiplyScalar(6), toneMapped: false }),
    enemy: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6ec).multiplyScalar(6), toneMapped: false }),
  };
  const tracerMaterials = { hero: createBeamMaterial(FRAME_COLORS.hero), enemy: createBeamMaterial(FRAME_COLORS.enemy) };
  const flameMaterials = {
    hero: new THREE.MeshBasicMaterial({ color: 0x87eaff, toneMapped: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xcd7480, toneMapped: false }),
  };
  const waveShape = new THREE.Shape();
  waveShape.moveTo(-6.2, -1.6);
  waveShape.quadraticCurveTo(0, 5.8, 6.2, -1.6);
  waveShape.quadraticCurveTo(0, 2.6, -6.2, -1.6);
  const waveGeometry = new THREE.ExtrudeGeometry(waveShape, {
    depth: 0.18, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.08, bevelThickness: 0.08, steps: 1,
  });
  waveGeometry.translate(0, 0, -0.09);
  const waveGlowGeometry = new THREE.ShapeGeometry(waveShape, 32);
  const verdictGeometry = new THREE.CylinderGeometry(0.24, 0.24, 10.5, 20);
  const waveMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe7fcff).multiplyScalar(4), toneMapped: false });
  const waveGlowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(FRAME_COLORS.hero).multiplyScalar(3),
    transparent: true, opacity: 0.38, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const verdictMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6ec).multiplyScalar(5), toneMapped: false });
  const verdictGlowMaterial = createBeamMaterial(FRAME_COLORS.enemy);
  const missilePool = Array.from({ length: 32 }, () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(missileGeometry, missileMaterials.hero);
    const nose = new THREE.Mesh(missileNoseGeometry, missileMaterials.hero);
    const flame = new THREE.Mesh(missileNoseGeometry, flameMaterials.hero);
    const tracer = new THREE.Mesh(tracerGeometry, tracerMaterials.hero);
    tracer.name = 'RifleIonTracer'; tracer.position.y = -2.4;
    nose.position.y = 1.3;
    flame.position.y = -1.3;
    flame.rotation.z = Math.PI;
    const wave = new THREE.Group();
    wave.name = 'FlyingBladeWave';
    const edge = new THREE.Mesh(waveGeometry, waveMaterial), glow = new THREE.Mesh(waveGlowGeometry, waveGlowMaterial);
    glow.scale.set(1.14, 1.2, 1);
    const crossGlow = glow.clone(); crossGlow.rotation.y = Math.PI / 2;
    wave.add(edge, glow, crossGlow);
    const beam = new THREE.Mesh(verdictGeometry, verdictMaterial);
    beam.name = 'SwordTipBeam';
    const beamGlow = new THREE.Mesh(verdictGeometry, verdictGlowMaterial);
    beamGlow.scale.set(4.3, 1, 4.3); beam.add(beamGlow);
    wave.visible = beam.visible = false;
    root.add(body, nose, flame, tracer, wave, beam);
    root.visible = false;
    scene.add(root);
    return { root, body, nose, flame, tracer, wave, beam };
  });
  const missileDirection = vector(0, 1, 0);
  const spaceReached = checkpoint?.stage === 'space' || checkpoint?.stage === 'finisher';
  let reachedSpace = spaceReached, paused = false, blurred = false, disposed = false;
  let lastPhase: FinalePhase = 'loading', lastFirework = -1;
  let animationDelta = 0, finishedCallbackSent = false;
  let versusCaptured = false, lastBoardingCue = -1, qteShotIndex = -1, lastClashSpark = -1;
  let finisherEffectIndex = -1, finisherEffectClock = -1, lastExecutionCut = -1;
  let endingEntry: { hero: THREE.Vector3; enemy: THREE.Vector3; heroRotation: THREE.Quaternion; enemyRotation: THREE.Quaternion } | null = null;
  const clashContact = new THREE.Vector3();
  const qteProjectiles = Array.from({ length: 7 }, () => ({
    active: false, owner: 'enemy' as 'hero' | 'enemy', kind: 'verdictBeam' as DuelProjectileKind,
    start: vector(0, 0, 0), end: vector(0, 0, 0), delay: 0,
  }));
  const keys = new Set<string>();
  const listeners = new AbortController();

  function updateInput() {
    if (lastPhase !== 'ground' && lastPhase !== 'space') return;
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const up = keys.has('KeyW'), down = keys.has('KeyS');
    director.duel.setInput({
      move: Number(right) - Number(left),
      lift: Number(up) - Number(down),
      guard: keys.has('KeyR'),
    });
  }

  function handleInput(code: string, pressed: boolean, repeat = false) {
    if (disposed || paused) return;
    if (pressed && code === 'KeyR' && (lastPhase === 'error' || (lastPhase === 'defeat' && director.getState().phaseTime >= 4.2))) {
      onRetry(director.getCheckpoint()); return;
    }
    if (lastPhase === 'finisher') {
      if (pressed) director.qte.press(code, repeat);
      else director.qte.release(code);
      return;
    }
    if (lastPhase !== 'ground' && lastPhase !== 'space') return;
    if (!pressed) { keys.delete(code); updateInput(); return; }
    if (repeat) return;
    const action = ACTION_KEYS[code];
    if (action) { director.duel.act(action); return; }
    if (COMBAT_KEYS.has(code)) { keys.add(code); updateInput(); }
  }

  function onKeyDown(event: KeyboardEvent) {
    const code = event.code;
    if (!COMBAT_KEYS.has(code)) return;
    event.preventDefault();
    event.stopPropagation();
    handleInput(code, true, event.repeat);
  }
  function onKeyUp(event: KeyboardEvent) {
    const code = event.code;
    if (!COMBAT_KEYS.has(code)) return;
    event.preventDefault();
    event.stopPropagation();
    handleInput(code, false);
  }
  function onBlur() {
    blurred = true;
    keys.clear();
    director.clearInput();
    syncPause();
  }
  function onFocus() {
    blurred = false;
    syncPause();
  }
  function onVisibilityChange() { syncPause(); }
  function syncPause() {
    const shouldPause = paused || blurred || document.hidden;
    director.pause(shouldPause);
    presentation.pause(shouldPause);
  }
  window.addEventListener('keydown', onKeyDown, { signal: listeners.signal });
  window.addEventListener('keyup', onKeyUp, { signal: listeners.signal });
  window.addEventListener('blur', onBlur, { signal: listeners.signal });
  window.addEventListener('focus', onFocus, { signal: listeners.signal });
  document.addEventListener('visibilitychange', onVisibilityChange, { signal: listeners.signal });
  const skipHold = createHoldToSkip({ button: presentation.skipButton, onSkip: () => director.skipIntro(),
    isAvailable: () => ['reveal', 'enemyTransform', 'heroTransform'].includes(director.getState().phase),
    isPaused: () => paused || blurred });

  const ready = Promise.all([site.ready, students.loaded, heroMech.loaded, enemyMech.loaded, mothership.ready]).then(async () => {
    if (disposed) return;
    director.duel.setBladePaths('hero', heroMech.sampleAttackPaths());
    director.duel.setBladePaths('enemy', enemyMech.sampleAttackPaths());
    if (postProcessing) await postProcessing.prepare();
    if (disposed) return;
    presentation.setCreditSprite(await createFinaleCreditSprite(renderer));
    if (!disposed) director.assetsLoaded();
  });
  void ready.catch(error => {
    if (disposed) return;
    const message = `Unable to load the final-boss presentation: ${String(error)}`;
    console.error('[Scene 21]', error);
    director.assetsFailed(message);
  });

  function updateStudentReveal(phase: FinalePhase, phaseTime: number) {
    const visible = phase === 'reveal' || phase === 'enemyTransform'
      || (phase === 'victory' && phaseTime >= 6 && phaseTime < 15);
    students.root.visible = visible;
    for (let i = 0; i < students.students.length; i++) {
      const student = students.students[i];
      const spread = (i - 2) * 2.45;
      student.root.scale.setScalar(1);
      if (phase === 'reveal') {
        const enterStart = 2.15 + i * 0.18;
        const approach = smooth(phaseTime, enterStart, 7.1 + i * 0.12);
        student.root.visible = phaseTime >= enterStart;
        student.root.position.copy(summitPoint(spread, 0, -8.2 + approach * 4.7));
        student.root.rotation.y = 0;
        const entering = phaseTime < 7.1 + i * 0.12;
        const speaking = activeStudent(phaseTime, 'reveal') === i;
        const mode = entering ? 'walk' : phaseTime >= 21.2 ? 'pose' : speaking ? 'talk' : 'idle';
        students.animate(i, mode, mode === 'pose' ? phaseTime - 21.2 : phaseTime);
        world.lightStudent(i, student.root.position);
      } else if (phase === 'enemyTransform') {
        const boarding = sampleStudentBoarding(i, phaseTime);
        const start = summitPoint(spread, 0, -3.5);
        const chest = enemyMech.getChest();
        const entry = chest.clone().add(vector(-3.2, -0.8, 3.3));
        student.root.position.lerpVectors(start, entry, boarding.ascent).lerp(chest, boarding.merge);
        student.root.rotation.y = THREE.MathUtils.lerp(0, FINALE_BATTLE_YAW + Math.PI, boarding.ascent);
        student.root.scale.setScalar(boarding.scale);
        student.root.visible = boarding.visible;
        students.animate(i, boarding.active ? 'board' : phaseTime < 5.4 ? 'pose' : 'idle',
          boarding.active ? phaseTime - STUDENT_TIMELINE[i].boarding.start : phaseTime < 5.4 ? 3.6 : phaseTime);
        if (boarding.active) {
          effects.boardingBeam(i, student.root.position.clone().add(vector(0, 0.9 * boarding.scale, 0)),
            chest, boarding.beam, director.getState().time);
          if (phaseTime >= STUDENT_TIMELINE[i].boarding.start + 1.5 && lastBoardingCue < i) {
            lastBoardingCue = i;
            effects.burst(chest, 1.2, SUDOERS_5[i].color, 32);
            effects.ring(chest, 1.2, SUDOERS_5[i].color, true, 0.6);
            presentation.sound('parry');
          }
        } else effects.boardingBeam(i, start, chest, 0, 0);
      } else if (phase === 'victory' && phaseTime >= 6 && phaseTime < 15) {
        student.root.visible = true;
        student.root.position.copy(summitPoint((i - 2) * 2.2, 0, -2.5 + Math.sin(phaseTime + i) * 0.25));
        student.root.rotation.y = 0;
        students.animate(i, 'idle', phaseTime + i * 0.1);
      } else student.root.visible = false;
    }
    if (phase !== 'enemyTransform') {
      lastBoardingCue = -1;
      for (let i = 0; i < 5; i++) effects.boardingBeam(i, vector(0, 0, 0), vector(0, 0, 0), 0, 0);
    }
  }

  function fireCue(id: string, phaseTime: number) {
    if (id === 'roof-blast') {
      const blast = summitPoint(0, 0.5, -1);
      const trees = site.disintegrateTrees({ x: blast.x, y: blast.y, z: FINALE_ROOFTOP.z - 14 }, 62);
      const stride = Math.max(1, Math.ceil(trees.length / 18));
      for (let i = 0; i < trees.length; i += stride) {
        const tree = trees[i];
        effects.burst(vector(tree.x, tree.y, tree.z), 2.2, 0xffad5c, 24);
      }
      effects.burst(blast, 9, 0xff7246, 180);
      effects.ring(blast, 38, 0xffc36a, true, 1.8);
      emitComicEffect(scene, 'boom', { position: blast, size: 18 });
      presentation.flash(0.48);
      presentation.sound('explode');
      cameraRig.impact(1);
    } else if (id === 'prime-shield') {
      const shieldPoint = summitPoint(0, 4.5, 6);
      effects.ring(shieldPoint, 11, 0x5ce6ff, true, 1.2);
      emitComicEffect(scene, 'clank', { position: shieldPoint, size: 7 });
      presentation.sound('parry');
      cameraRig.impact(0.5);
    } else if (id === 'fireworks') {
      effects.ring(enemyMech.getChest(), 8, FRAME_COLORS.enemy, true, 1.5);
      effects.sparks(enemyMech.getChest(), 0x86333e, 34, vector(0, 1, 0));
    } else if (id === 'five-cores') {
      effects.burst(enemyMech.getChest(), 2.2, FRAME_COLORS.enemy, 75);
    } else if (id === 'enemy-lock' || id === 'hero-lock') {
      const point = id === 'hero-lock' ? heroMech.getChest() : enemyMech.getChest();
      effects.ring(point, 7, id === 'hero-lock' ? FRAME_COLORS.hero : FRAME_COLORS.enemy, true);
      effects.burst(point, 3, id === 'hero-lock' ? FRAME_COLORS.hero : FRAME_COLORS.enemy, 65);
    } else if (id === 'prime-beacon') {
      effects.ring(RESCUE_SITE.ship.clone().add(vector(0, 0.2, 0)), 8, 0x65dcff, false, 1.6);
    } else if (id === 'ship-disassemble') {
      effects.burst(site.ship.root.position.clone().add(vector(0, 1, 0)), 3.5, 0x5ce6ff, 100);
      effects.ring(site.ship.root.position, 10, 0x5ce6ff, true, 1.2);
      emitComicEffect(scene, 'clank', { position: site.ship.root.position.clone(), size: 7 });
      presentation.sound('special');
    } else if (id === 'hero-sword') {
      for (let i = 0; i < 8; i++) effects.fireworks(summitPoint(-18 + Math.cos(i * Math.PI / 4) * 9,
        9 + i % 3 * 3, Math.sin(i * Math.PI / 4) * 7), 0x47dbff);
    } else if (id === 'planet-breaker') {
      const point = world.getBombPosition();
      effects.ring(point, 4, 0xff733b, true, 1.3);
      effects.burst(point, 2.5, 0xff733b, 100);
      emitComicEffect(scene, 'thud', { position: point, size: 7 });
    } else if (id === 'world-crack') {
      const crack = world.getPlanetImpact();
      effects.ring(crack, 50, 0xff733b, true, 2);
      effects.burst(crack, 17, 0xff733b, 160);
      emitComicEffect(scene, 'boom', { position: crack, size: 28 });
      presentation.flash(0.62); presentation.sound('explode'); cameraRig.impact(1.2);
    } else if (id === 'planet-burst') {
      effects.burst(PLANET_CENTER, 46, 0xff6438, 180);
      effects.ring(PLANET_CENTER, PLANET_RADIUS * 0.92, 0xffd78e, false, 3);
      for (let i = 0; i < 10; i++) {
        const direction = vector(Math.cos(i * 0.63), Math.sin(i * 0.37), Math.sin(i * 0.63)).normalize();
        effects.fireworks(PLANET_CENTER.clone().addScaledVector(direction, PLANET_RADIUS * (0.86 + i % 3 * 0.06)),
          i % 2 ? 0xd27347 : 0xffd2a6);
      }
      presentation.flash(0.75); cameraRig.impact(2.2);
    } else if (id === 'sudoers-burst') {
      effects.burst(enemyMech.getChest(), 6, 0xcd7954, 150);
    } else if (id === 'reactor-cut' || id === 'hero-frame') {
      effects.burst(heroMech.getChest(), 3.4, 0x5ce6ff, 110);
    } else if (id === 'escape-boost') {
      effects.ring(summitPoint(0, 7), 15, 0x65dcff, true, 1.6);
    } else if (id === 'fight') {
      presentation.sound('special'); presentation.flash(0.25);
    } else if (id === 'execution') {
      effects.burst(heroMech.getChest(), 3.5, FRAME_COLORS.enemy, 85);
      presentation.sound('explode'); presentation.flash(0.18); cameraRig.impact(0.5);
    }
    if (id === 'planet-burst' || id === 'fireworks' || id === 'five-cores') presentation.sound('explode');
    else if (id === 'prime-beacon' || id === 'hero-sword' || id === 'hero-frame') presentation.sound('special');
  }

  function engraveTrace(target: typeof heroMech, trace: BladeDamageTrace, tint: number = FRAME_COLORS.hero) {
    const point = (p: [number, number, number]) => finaleBattlePoint(p[0], p[1], reachedSpace ? SPACE_ALTITUDE : 0)
      .add(vector(-0.2425356 * p[2], 0, -0.9701425 * p[2]));
    const from = point(trace.from), to = point(trace.to);
    target.markSlash(from, to); effects.slash(from, to, tint);
  }

  function consumeDirectorEvents() {
    for (const cue of director.drainCues()) fireCue(cue.id, director.getState().phaseTime);
    for (const event of director.drainDuelEvents()) {
      const point = finaleBattlePoint(event.x, event.y, reachedSpace ? SPACE_ALTITUDE : 0);
      if (event.kind === 'launch') {
        const source = event.owner === 'hero' ? heroMech : enemyMech;
        point.copy(event.attack === 'missiles' ? source.getMuzzle() : source.getBlade().tip);
        effects.sparks(point, FRAME_COLORS[event.owner], event.attack === 'missiles' ? 10 : 30);
        if (event.attack === 'missiles') {
          const target = event.owner === 'hero' ? enemyMech : heroMech;
          effects.muzzle(point, target.getChest().sub(point).normalize(), event.owner);
        }
        if (event.attack === 'overdrive') {
          const blade = source.getBlade();
          effects.slash(blade.base, blade.tip); effects.ring(point, 2.4, 0xe5faff, true, 0.3);
        }
        presentation.sound('launch');
      } else if (event.kind === 'swing') {
        presentation.sound('special');
      } else if (event.kind === 'parry') {
        effects.deflect(point, true, event.owner === 'hero' ? 'enemy' : 'hero');
        emitComicEffect(scene, 'clank', { position: point, size: 5.5 });
        presentation.sound('parry');
        cameraRig.impact(0.35);
      } else if (event.kind === 'guard') {
        effects.deflect(point, false, event.owner === 'hero' ? 'enemy' : 'hero');
        presentation.sound('parry'); cameraRig.impact(0.16);
      } else if (event.kind === 'hit' || event.kind === 'guardBreak' || event.kind === 'cut') {
        effects.sparks(point, FRAME_COLORS[event.owner], 16);
        if (event.trace) engraveTrace(event.owner === 'hero' ? enemyMech : heroMech, event.trace, FRAME_COLORS[event.owner]);
        if (event.kind === 'guardBreak') effects.ring(point, 3.8, 0xc9827a, true, 0.35);
        presentation.sound(event.kind === 'cut' ? 'parry' : 'hit');
        presentation.flash(event.kind === 'guardBreak' ? 0.16 : 0.06);
        cameraRig.impact(event.kind === 'guardBreak' ? 0.5 : 0.2);
      } else if (event.kind === 'dash') {
        effects.ring(point, 2.6, FRAME_COLORS[event.owner], true, 0.3);
      } else if (event.kind === 'special') {
        effects.ring(point, 4, FRAME_COLORS[event.owner], true, 0.85);
        presentation.sound('special');
      } else if (event.kind === 'rupture') {
        effects.ring(point, 15, 0xff6b40, true, 1.6);
        effects.burst(point, 6, 0xff7246, 140);
        emitComicEffect(scene, 'boom', { position: point, size: 12 });
        presentation.sound('explode');
        cameraRig.impact(0.8);
      } else if (event.kind === 'lost') {
        effects.burst(point, 4, 0xff4a65, 100);
        emitComicEffect(scene, 'boom', { position: point, size: 8 });
        presentation.sound('explode');
      } else if (event.kind === 'tell') {
        presentation.sound('special');
      }
    }
    for (const event of director.drainQteEvents()) {
      if (event.kind === 'success') {
        presentation.sound('qte');
      } else if (event.kind === 'armed') {
        const beat = FINISHER_BEATS[event.index];
        if (beat.shot === 'evade' || beat.shot === 'missileCut') {
          const muzzle = enemyMech.getBlade().tip.clone(), target = heroMech.getChest();
          qteProjectiles.forEach((projectile, i) => {
            projectile.active = beat.shot === 'missileCut' || i === 0;
            projectile.owner = 'enemy'; projectile.kind = 'verdictBeam';
            projectile.start.copy(muzzle); projectile.end.copy(target).add(vector(0, (i - 1) * 0.6, 0));
            projectile.delay = finisherActionTime(beat) - (beat.shot === 'evade' ? 0.5 : 0.3) + i * 0.055;
          });
        }
      } else if (event.kind === 'miss') {
        presentation.sound('hit');
      } else if (event.kind === 'lost') {
        effects.sparks(heroMech.getChest(), FRAME_COLORS.enemy, 12);
      } else if (event.kind === 'won') {
        const point = enemyMech.root.position.clone().add(vector(0, 8, 0));
        effects.burst(point, 10, 0xffb34e, 180);
        emitComicEffect(scene, 'boom', { position: point, size: 16 });
      }
    }
  }

  function showDialogue(phase: FinalePhase, phaseTime: number) {
    if (phase === 'finisher') {
      const { beat, clock } = director.qte.getState();
      const lines: Record<FinisherBeat['shot'], { speaker: string; text: string; start: number; end: number }> = {
        evade: { speaker: 'PRIME', text: 'The frame is coming apart. Stay with me, Brondon!', start: 0, end: 2.6 },
        missileCut: { speaker: 'SUDOERS 5', text: 'There is nowhere left to run.', start: 0.1, end: 2.7 },
        countershot: { speaker: 'BRONDON', text: "Then I'll stop running.", start: 0.1, end: 2.6 },
        boost: { speaker: 'PRIME', text: 'One opening. Through the heart of it!', start: 0.1, end: 2.6 },
        clash: { speaker: 'SUDOERS 5', text: 'Five minds... and you still resist?!', start: 0.15, end: 2.8 },
        armCut: { speaker: 'BRONDON', text: "You don't get to decide who he is!", start: 0.2, end: 2.9 },
        ascend: { speaker: 'SUDOERS 5', text: 'We will erase every trace of you!', start: 0.15, end: 2.8 },
        reactor: { speaker: 'PRIME', text: 'Core limiters are gone. Whatever happens... finish it.', start: 0.1, end: 3.3 },
        finalCut: { speaker: 'BRONDON', text: 'Donus. Come home.', start: 3.45, end: 5.8 },
      };
      const cue = lines[beat.shot];
      presentation.dialogue(cue.speaker, clock >= cue.start && clock < cue.end ? cue.text : '');
      return;
    }
    const line = LINES[phase]?.find(item => phaseTime >= item.start && phaseTime < item.end);
    presentation.dialogue(line?.speaker ?? '', line?.text ?? '');
  }

  function updateObjective(phase: FinalePhase, phaseTime: number) {
    if (phase === 'loading') presentation.objective('FINAL CHAPTER / THE LAST LIGHT', 'Loading the command deck...');
    else if (phase === 'error') presentation.objective('FINAL CHAPTER / THE LAST LIGHT', 'The scene could not be prepared. Retry to load it again.');
    else if (phase === 'reveal') presentation.objective('FACILITY SUMMIT / FIVE SIGNATURES', 'Hold Enter to skip the reveal');
    else if (phase === 'enemyTransform') presentation.objective('FINAL VERDICT / FIVE CORES, ONE FRAME', 'Sudoers 5 is combining their power');
    else if (phase === 'heroTransform') presentation.objective('PRIME FRAME / SHUTTLE RECALL', 'The shuttle is flying in from the jungle');
    else if (phase === 'versus') presentation.objective('FINAL CHAPTER / MATCHUP', 'Prime Frame versus Final Verdict');
    else if (phase === 'ground') presentation.objective('THE SUMMIT', 'J chains downward and side cuts. E releases Last Light. Read the enemy windup.');
    else if (phase === 'rupture') presentation.objective('PLANETARY COLLAPSE / ESCAPE', 'Boost with Prime. The fight is not over.');
    else if (phase === 'space') presentation.objective('LAST ORBIT', 'W / S rise and dive  ·  Find the opening in the Final Verdict');
    else if (phase === 'finisher') {
      const beat = director.qte.getState().beat;
      presentation.objective('FINAL LINK / SUDOERS 5', `Time ${beat.key.replace('Key', '').toUpperCase()} as the rings meet. Three misses break the link.`);
    } else if (phase === 'defeat') presentation.objective('SIGNAL LOST / BRONDON DOWN', 'The last checkpoint is available after the death scene');
    else if (phase === 'victory') presentation.objective('THE LAST LIGHT / DONUS RESTORED', 'The Final Verdict has been defeated');
    else if (phase === 'credits') presentation.objective('BRONDON’S REVENGE', 'A final light remains');
    else if (phase === 'done') presentation.objective('THE END', 'Thank you for playing');

    if (phase === 'reveal' && phaseTime >= 23) presentation.title('SUDOERS 5');
    else if (phase === 'enemyTransform' && phaseTime >= 17.6) presentation.title('FINAL VERDICT');
    else if (phase === 'heroTransform' && phaseTime >= 14.2) presentation.title('PRIME FRAME');
    else if (phase === 'rupture' && phaseTime >= PLANET_RUPTURE.burst && phaseTime < PLANET_RUPTURE.returnToDuel - 1) presentation.title('BOOM!');
    else if (phase === 'victory' && phaseTime >= 14) presentation.title('THE END');
    else if (phase === 'credits' || phase === 'done') presentation.title('');
    else presentation.title('');
  }

  function updateFinisherEffects(sample: ReturnType<typeof sampleFinisher>) {
    const qte = director.qte.getState(), clock = qte.clock;
    if (qte.index !== finisherEffectIndex) {
      finisherEffectIndex = qte.index; finisherEffectClock = -1; lastExecutionCut = -1;
    }
    const crossed = (at: number) => finisherEffectClock < at && clock >= at;
    const action = finisherActionTime(qte.beat);
    if ((qte.beat.shot === 'evade' || qte.beat.shot === 'missileCut')
      && crossed(action - (qte.beat.shot === 'evade' ? 0.5 : 0.3))) {
      effects.sparks(enemyMech.getBlade().tip, FRAME_COLORS.enemy, 18); presentation.sound('launch');
    }
    if (qte.beat.shot === 'missileCut' && crossed(action + 0.25)) {
      effects.sparks(heroMech.getBlade().tip, FRAME_COLORS.hero, 22);
      presentation.sound('parry');
    } else if ((qte.beat.shot === 'armCut' || qte.beat.shot === 'clash') && crossed(action + 0.45)) {
      const attack = qte.beat.shot === 'clash' ? 'sideSlash' : 'slash';
      const trace = sampleBladeDamageTrace(attack,
        { ...director.duel.hero, x: sample.hero[0], y: sample.hero[1] },
        { ...director.duel.enemy, x: sample.enemy[0], y: sample.enemy[1] });
      engraveTrace(enemyMech, trace); effects.sparks(enemyMech.getChest(), FRAME_COLORS.hero, 24);
      presentation.sound('hit'); cameraRig.impact(0.24);
    } else if (qte.beat.shot === 'countershot' && crossed(RIFLE_SEQUENCE.fire + 0.65)) {
      effects.sparks(enemyMech.getChest(), 0xe0d5c7, 26); presentation.sound('hit');
    }
    if (qte.beat.shot === 'finalCut') {
      const timing = FINISHER_EXECUTION;
      if (crossed(timing.dash)) {
        effects.ring(heroMech.getChest(), 4.2, FRAME_COLORS.hero, true, 0.4); presentation.sound('launch');
      }
      if (crossed(timing.vanish)) { effects.teleport(heroMech.root.position, false); presentation.sound('special'); }
      if (crossed(timing.appear)) { effects.teleport(heroMech.root.position, true); presentation.sound('special'); }
      if (clock >= timing.cuts) {
        const count = Math.min(23, Math.floor((clock - timing.cuts) / (timing.lastCut - timing.cuts) * 24));
        for (let i = lastExecutionCut + 1; i <= count; i++) {
          const reverse = i % 3 === 0, height = 4.5 + i % 9;
          const from = enemyMech.root.localToWorld(vector(-3.3, reverse ? 14 : height, 2.1));
          const to = enemyMech.root.localToWorld(vector(3.3, reverse ? 4 + i % 4 : 14 - i % 8, 2.1));
          enemyMech.markSlash(from, to); effects.slash(from, to);
          effects.sparks(from.clone().lerp(to, 0.5), 0xd5edf1, 7);
          if (i % 3 === 0) { presentation.sound('hit'); presentation.flash(0.055); cameraRig.impact(0.08); }
        }
        lastExecutionCut = Math.max(lastExecutionCut, count);
      }
      if (crossed(timing.lastCut)) {
        const chest = enemyMech.getChest();
        for (const sign of [-1, 1]) effects.slash(chest.clone().add(vector(-10, sign * 7, 2)),
          chest.clone().add(vector(10, -sign * 7, 2)), 0xe8fcff);
        effects.ring(chest, 5, FRAME_COLORS.hero, true, 0.4); presentation.flash(0.12); cameraRig.impact(0.32);
      }
      if (crossed(timing.collapse)) {
        effects.burst(enemyMech.getChest(), 3.2, 0xb66e50, 65); presentation.sound('explode'); cameraRig.impact(0.4);
      }
      if (sample.speed > 0) effects.speedStreaks(heroMech.getChest(),
        enemyMech.getChest().sub(heroMech.getChest()), sample.speed * 2, director.getState().time);
    }
    finisherEffectClock = clock;
  }

  function updateActors(phase: FinalePhase, phaseTime: number, time: number) {
    const inMechScene = phase === 'enemyTransform' || phase === 'heroTransform' || phase === 'versus' || phase === 'ground'
      || phase === 'rupture' || phase === 'space' || phase === 'finisher' || phase === 'defeat'
      || phase === 'victory' || phase === 'credits' || phase === 'done';
    const duel = director.duel, hero = duel.hero, enemy = duel.enemy;
    const baseY = FINALE_DECK_Y + (reachedSpace ? SPACE_ALTITUDE : 0);
    let heroX = hero.x, heroY = baseY + hero.y, enemyX = enemy.x, enemyY = baseY + enemy.y;
    if (phase === 'enemyTransform' || phase === 'heroTransform') {
      heroX = -FINALE_START_X; heroY = FINALE_DECK_Y; enemyX = FINALE_START_X; enemyY = FINALE_DECK_Y;
    } else if (phase === 'rupture') {
      const lift = smooth(phaseTime, PLANET_RUPTURE.escape, PLANET_RUPTURE.orbit) * SPACE_ALTITUDE;
      const jump = cinematicProgress(phaseTime, PLANET_RUPTURE.jump, PLANET_RUPTURE.land);
      const settle = cinematicProgress(phaseTime, PLANET_RUPTURE.returnToDuel, PLANET_RUPTURE.orbit);
      heroX = THREE.MathUtils.lerp(hero.x, -FINALE_START_X, settle);
      enemyX = THREE.MathUtils.lerp(enemy.x - enemy.facing * jump * 7.5, FINALE_START_X, settle);
      heroY = FINALE_DECK_Y + lift + hero.y;
      enemyY = FINALE_DECK_Y + lift + enemy.y + Math.sin(jump * Math.PI) * 5.4;
    } else if (phase === 'reveal' || phase === 'loading' || phase === 'error') {
      heroX = -FINALE_START_X; heroY = FINALE_DECK_Y; enemyX = FINALE_START_X; enemyY = FINALE_DECK_Y;
    }

    heroMech.root.visible = inMechScene && phase !== 'enemyTransform'
      && (phase !== 'heroTransform' || phaseTime >= HERO_TRANSFORM.materialize);
    enemyMech.root.visible = inMechScene && (phase !== 'enemyTransform' || phaseTime >= 1.1);
    heroMech.root.position.copy(finaleBattlePoint(heroX, heroY - FINALE_DECK_Y));
    enemyMech.root.position.copy(finaleBattlePoint(enemyX, enemyY - FINALE_DECK_Y));
    const combat = phase === 'ground' || phase === 'space';
    for (const [mech, fighter, opponent, defaultFacing] of [
      [heroMech, hero, enemy, 1], [enemyMech, enemy, hero, -1],
    ] as const) {
      let facing = combat ? fighter.facing : defaultFacing;
      const dodge = combat && fighter.dash ? sampleDodgeArc(fighter.time, fighter.duration, fighter.dash.crossing) : null;
      if (dodge) {
        mech.root.position.add(vector(dodge.lane * 0.2425356, dodge.lift, dodge.lane * 0.9701425));
        if (fighter.dash?.crossing && dodge.progress > 0.5) facing = Math.sign(opponent.x - fighter.x) || facing;
      }
      const yaw = FINALE_BATTLE_YAW + (facing < 0 ? Math.PI : 0);
      const turn = Math.atan2(Math.sin(yaw - mech.root.rotation.y), Math.cos(yaw - mech.root.rotation.y));
      mech.root.rotation.set(0, combat && animationDelta > 0 ? mech.root.rotation.y + turn * (1 - Math.exp(-animationDelta * 18)) : yaw,
        dodge ? -fighter.facing * dodge.roll : 0);
    }
    if (endingEntry && (phase === 'defeat' || phase === 'victory' || phase === 'credits' || phase === 'done')) {
      heroMech.root.position.copy(endingEntry.hero);
      enemyMech.root.position.copy(endingEntry.enemy);
      heroMech.root.quaternion.copy(endingEntry.heroRotation);
      enemyMech.root.quaternion.copy(endingEntry.enemyRotation);
      if (phase === 'defeat') {
        const collapse = cinematicProgress(phaseTime, 0.4, 3.7);
        heroMech.root.position.y -= collapse * (reachedSpace ? 7 : 2);
        heroMech.root.rotateZ(-collapse * 0.65);
      } else enemyMech.root.position.y -= cinematicProgress(phaseTime, 0, 3) * 2.2;
    }

    let heroAssembly = 1, enemyAssembly = 1, heroScale = 1, enemyScale = 1;
    if (phase === 'enemyTransform') {
      enemyAssembly = smooth(phaseTime, 1.1, 5.3);
      enemyScale = 0.06 + enemyAssembly * 0.94;
    } else if (phase === 'heroTransform') {
      heroAssembly = smooth(phaseTime, HERO_TRANSFORM.materialize, HERO_TRANSFORM.assembled);
      heroScale = 0.06 + heroAssembly * 0.94;
    }
    heroMech.root.scale.setScalar(heroScale);
    enemyMech.root.scale.setScalar(enemyScale);
    heroMech.setAssembly(heroAssembly);
    enemyMech.setAssembly(enemyAssembly);

    const qte = director.qte.getState();
    const choreography = phase === 'finisher' ? sampleFinisher(qte.beat, qte.clock) : null;
    let heroMove: MechPoseName = hero.move;
    let enemyMove: MechPoseName = enemy.move;
    if (phase === 'enemyTransform') enemyMove = 'transform';
    else if (phase === 'heroTransform') heroMove = 'transform';
    else if (phase === 'rupture') {
      heroMove = phaseTime < PLANET_RUPTURE.escape ? 'guard' : 'boost';
      enemyMove = phaseTime < PLANET_RUPTURE.jump ? 'verdict'
        : phaseTime < PLANET_RUPTURE.land ? 'boost' : phaseTime < PLANET_RUPTURE.escape + 0.5 ? 'bomb' : 'boost';
    }
    else if (choreography) {
      heroMove = choreography.heroPose; enemyMove = choreography.enemyPose;
      heroMech.root.position.copy(finaleBattlePoint(choreography.hero[0], choreography.hero[1], SPACE_ALTITUDE)).add(vector(0, 0, choreography.hero[2]));
      enemyMech.root.position.copy(finaleBattlePoint(choreography.enemy[0], choreography.enemy[1], SPACE_ALTITUDE)).add(vector(0, 0, choreography.enemy[2]));
      heroMech.root.rotation.z = choreography.heroRoll; enemyMech.root.rotation.z = choreography.enemyRoll;
      heroMech.root.rotateY(choreography.heroYaw); enemyMech.root.rotateY(choreography.enemyYaw);
      heroMech.root.visible = choreography.heroVisible;
    } else if (phase === 'victory' || phase === 'credits' || phase === 'done') {
      heroMove = phase === 'credits' || phase === 'done' || phaseTime >= DONUS_RETURN.appear ? 'dance'
        : phaseTime < 6 ? 'afterCut' : 'victory'; enemyMove = 'defeat';
    } else if (phase === 'defeat') { heroMove = 'defeat'; enemyMove = phaseTime < 2.6 ? 'verdict' : 'afterCut'; }
    else if (phase === 'error' || phase === 'loading' || phase === 'reveal') {
      heroMove = 'idle'; enemyMove = 'idle';
    }

    const cinematicDuration = (move: MechPoseName) => isMeleeStrike(move) ? MELEE_STRIKES[move].duration
      : move === 'missiles' ? RIFLE_SEQUENCE.swordReady : move === 'verdict' ? ENEMY_VERDICT.duration : 1;
    const heroDuration = choreography ? cinematicDuration(heroMove)
      : phase === 'heroTransform' ? 17 : phase === 'rupture' ? 4.2 : Math.max(0.1, hero.duration || 1);
    const enemyDuration = choreography ? cinematicDuration(enemyMove)
      : phase === 'enemyTransform' ? 19.2 : phase === 'rupture' ? PLANET_RUPTURE.escape + 0.5 : Math.max(0.1, enemy.duration || 1);
    const heroPoseTime = choreography ? choreography.heroPoseProgress * heroDuration
      : phase === 'heroTransform' || phase === 'rupture' ? phaseTime : phase === 'victory' || phase === 'defeat' ? phaseTime : hero.time;
    const enemyPoseTime = choreography ? choreography.enemyPoseProgress * enemyDuration
      : phase === 'enemyTransform' || phase === 'rupture' ? phaseTime
        : phase === 'victory' || phase === 'credits' || phase === 'done' ? Math.max(enemyDuration, phaseTime)
          : phase === 'defeat' ? phaseTime : enemy.time;
    heroMech.setDamage(1 - hero.health / DUEL.heroHealth);
    enemyMech.setDamage(1 - enemy.health / DUEL.health);
    heroMech.setDissolve(choreography?.heroDissolve ?? (phase === 'defeat' ? smooth(phaseTime, 2.1, 5.4) : 0));
    enemyMech.setDissolve(phase === 'victory' ? smooth(phaseTime, 2.8, 5.8)
      : phase === 'credits' || phase === 'done' ? 1 : 0);
    const custom = !!choreography || phase === 'rupture' || phase === 'defeat';
    heroMech.pose(heroMove, heroPoseTime, heroDuration, phase === 'rupture' || reachedSpace || hero.y > 1, hero.combo, time, custom);
    enemyMech.pose(enemyMove, enemyPoseTime, enemyDuration, phase === 'rupture' || reachedSpace || enemy.y > 1, 0, time, custom);
    const enemyChest = enemyMech.getChest(), heroChest = heroMech.getChest();
    heroMech.watch(enemyChest, heroMove === 'afterCut' || heroMove === 'skyCharge' || heroMove === 'dance' ? 0 : 0.35);
    enemyMech.watch(heroChest, enemyMove === 'defeat' ? 0 : 0.55);
    const heroAim = combat && hero.aimLocked ? finaleBattlePoint(hero.aimX, hero.aimY, reachedSpace ? SPACE_ALTITUDE : 0) : enemyChest;
    const enemyAim = combat && enemy.aimLocked ? finaleBattlePoint(enemy.aimX, enemy.aimY, reachedSpace ? SPACE_ALTITUDE : 0) : heroChest;
    heroMech.aimGun(heroAim); enemyMech.aimGun(enemyAim);
    if (enemyMove === 'verdict') enemyMech.pointSwordAt(enemyAim);
    if (phase === 'finisher' && qte.beat.shot === 'clash' && qte.clock < finisherActionTime(qte.beat) + 0.2) {
      clashContact.copy(heroChest).lerp(enemyChest, 0.5).add(vector(0, 1.6, 2.2));
      const strain = Math.sin(qte.clock * 8) * 0.5;
      heroMech.lockBlade(clashContact, 1, strain); enemyMech.lockBlade(clashContact, -1, -strain);
      const spark = Math.floor(qte.clock * 14);
      if (spark !== lastClashSpark) {
        lastClashSpark = spark;
        effects.sparks(clashContact, 0xffe4ad, 14);
      }
    } else if (phase !== 'finisher' || qte.beat.shot !== 'clash') lastClashSpark = -1;
    world.updateBomb(phase === 'rupture' ? phaseTime : -1,
      enemyMech.getHand('left').lerp(enemyMech.getHand('right'), 0.5));
    const heroCharge = choreography?.heroCharge ?? (heroMove === 'overdrive'
      ? cinematicProgress(hero.time, 0.15, HERO_ULTIMATE.cameraEnd) * (1 - cinematicProgress(hero.time, HERO_ULTIMATE.release, HERO_ULTIMATE.release + 0.2)) : 0);
    const enemyCharge = enemyMove === 'verdict' ? cinematicProgress(enemyPoseTime, 0, ENEMY_VERDICT.cameraEnd)
      * (1 - cinematicProgress(enemyPoseTime, ENEMY_VERDICT.release, ENEMY_VERDICT.release + 0.2)) : 0;
    heroMech.setBladeCharge(heroCharge); enemyMech.setBladeCharge(enemyCharge);
    effects.aura(enemyMech.root.position.clone().add(vector(0, 8, 0)), enemyMech.root.visible
      ? phase === 'enemyTransform' ? 0.7 : phase === 'victory' || phase === 'credits' ? 0 : 0.16 + enemyCharge * 0.35 : 0, time);

    const visiblePilot = phase === 'reveal' || phase === 'enemyTransform'
      || (phase === 'heroTransform' && phaseTime < HERO_TRANSFORM.pilotMerge);
    if (phase === 'reveal') {
      const walk = smooth(phaseTime, 0, 6.8);
      const position = summitPoint(0, 0.32, THREE.MathUtils.lerp(10, 6, walk));
      player.setPosition(position.x, position.y, position.z);
      player.setRotation(0, 0);
    } else if (phase === 'enemyTransform') {
      const position = summitPoint(0, 0.32, 6);
      player.setPosition(position.x, position.y, position.z);
      player.setRotation(0, 0);
    } else if (phase === 'heroTransform' && phaseTime < HERO_TRANSFORM.pilotMerge) {
      const progress = smooth(phaseTime, HERO_TRANSFORM.arrival - 0.3, HERO_TRANSFORM.pilotMerge);
      const start = summitPoint(0, 0.32, 6);
      const end = heroMech.root.position.clone().add(vector(0, 2.8, 0.4));
      const position = start.lerp(end, progress);
      position.y += Math.sin(progress * Math.PI) * 2.4;
      player.setPosition(position.x, position.y, position.z);
      player.setRotation(FINALE_BATTLE_YAW, 0);
    }
    if (!visiblePilot) {
      player.setPosition(heroMech.root.position.x, heroMech.root.position.y + 8, heroMech.root.position.z);
    }

    updateStudentReveal(phase, phaseTime);
    const heroBlade = heroMech.getBlade();
    const enemyBlade = enemyMech.getBlade();
    const trailActive = (move: MechPoseName, poseTime: number) => isMeleeStrike(move) ? sampleMeleeBlade(move, poseTime).active
      : move === 'overdrive' && poseTime >= HERO_ULTIMATE.cameraEnd && poseTime <= HERO_ULTIMATE.release + 0.1;
    heroTrail.update(heroBlade.base, heroBlade.tip, animationDelta, heroMech.root.visible && trailActive(heroMove, heroPoseTime));
    enemyTrail.update(enemyBlade.base, enemyBlade.tip, animationDelta, enemyMech.root.visible && trailActive(enemyMove, enemyPoseTime));
    effects.chargeBlade(heroBlade.base, heroBlade.tip, heroCharge, time);
    const clash = phase === 'finisher' && qte.beat.shot === 'clash' && qte.clock < finisherActionTime(qte.beat) + 0.2;
    effects.beam('hero', clashContact.clone().add(vector(0, -0.4, 0)), clashContact.clone().add(vector(0, 0.4, 0)),
      clash ? 0.25 + Math.sin(time * 30) * 0.08 : 0, time);
    effects.beam('enemy', enemyBlade.tip, heroChest, phase === 'defeat' && phaseTime >= 1.6 && phaseTime < 2.15 ? 0.3 : 0, time);
    if (choreography) updateFinisherEffects(choreography);
  }

  function projectileStyle(visual: typeof missilePool[number], owner: 'hero' | 'enemy', kind: DuelProjectileKind) {
    visual.body.material = missileMaterials[owner]; visual.nose.material = missileMaterials[owner];
    visual.flame.material = flameMaterials[owner];
    visual.tracer.material = tracerMaterials[owner];
    visual.body.visible = visual.nose.visible = visual.flame.visible = visual.tracer.visible = kind === 'round';
    visual.wave.visible = kind === 'bladeWave'; visual.beam.visible = kind === 'verdictBeam';
  }

  function updateMissiles(phase: FinalePhase) {
    verdictGlowMaterial.uniforms.uTime.value = director.getState().time;
    Object.values(tracerMaterials).forEach(material => { material.uniforms.uTime.value = director.getState().time; });
    if (phase === 'finisher') {
      const qte = director.qte.getState();
      if (qte.index !== qteShotIndex) {
        qteShotIndex = qte.index;
        qteProjectiles.forEach(projectile => { projectile.active = false; });
      }
      if (qte.beat.shot === 'countershot' && qte.clock >= RIFLE_SEQUENCE.fire && !qteProjectiles[0].active) {
        const muzzle = heroMech.getMuzzle(), target = enemyMech.getChest();
        for (let i = 0; i < 5; i++) {
          const projectile = qteProjectiles[i];
          projectile.active = true; projectile.owner = 'hero'; projectile.kind = 'round';
          projectile.start.copy(muzzle); projectile.end.copy(target);
          projectile.delay = RIFLE_SEQUENCE.fire + i * 0.14;
        }
        effects.sparks(muzzle, 0x78eaff, 24);
        effects.muzzle(muzzle, target.clone().sub(muzzle).normalize(), 'hero');
        presentation.sound('launch');
      }
      const clock = qte.clock;
      missilePool.forEach((visual, i) => {
        const projectile = qteProjectiles[i];
        if (!projectile?.active) { visual.root.visible = false; return; }
        const flight = (clock - projectile.delay) / 0.62;
        const cut = qte.beat.shot === 'missileCut' && clock >= finisherActionTime(qte.beat) + 0.25;
        visual.root.visible = flight >= 0 && flight <= 1.12 && !cut;
        if (!visual.root.visible) return;
        projectileStyle(visual, projectile.owner, projectile.kind);
        visual.root.position.lerpVectors(projectile.start, projectile.end, flight);
        missileDirection.copy(projectile.end).sub(projectile.start).normalize();
        visual.root.quaternion.setFromUnitVectors(vector(0, 1, 0), missileDirection);
        visual.root.scale.setScalar(1); visual.beam.scale.y = qte.beat.shot === 'evade' ? 1 : 0.38;
        visual.flame.scale.setScalar(1.15);
        effects.projectile(visual.root.position, missileDirection, projectile.owner, director.getState().time, i);
      });
      return;
    }
    qteShotIndex = -1;
    const missiles = director.duel.missiles;
    missilePool.forEach((visual, i) => {
      const missile = missiles[i];
      if (!missile) { visual.root.visible = false; return; }
      const side = missile.owner;
      projectileStyle(visual, side, missile.kind); visual.beam.scale.y = 1;
      visual.root.visible = true;
      const owner = side === 'hero' ? heroMech : enemyMech;
      const fighter = side === 'hero' ? director.duel.hero : director.duel.enemy;
      const spawn = finaleBattlePoint(fighter.x + fighter.facing * (missile.kind === 'round' ? 4.8 : missile.kind === 'bladeWave' ? 4.2 : 13.2),
        fighter.y + (missile.kind === 'bladeWave' ? 8.6 : 10.5), reachedSpace ? SPACE_ALTITUDE : 0);
      const muzzle = missile.kind === 'round' ? owner.getMuzzle() : owner.getBlade().tip.clone();
      const offset = muzzle.sub(spawn).multiplyScalar(Math.max(0, 1 - missile.age / 0.12));
      visual.root.position.copy(finaleBattlePoint(missile.x, missile.y, reachedSpace ? SPACE_ALTITUDE : 0)).add(offset);
      visual.root.scale.setScalar(missile.damage <= 0 ? Math.max(0.08, missile.life / 0.24) : 1);
      missileDirection.set(missile.vx * 0.9701425, missile.vy, -missile.vx * 0.2425356).normalize();
      visual.root.quaternion.setFromUnitVectors(vector(0, 1, 0), missileDirection);
      visual.flame.scale.setScalar(0.55 + Math.sin(missile.age * 40) * 0.12);
      effects.projectile(visual.root.position, missileDirection, side, director.getState().time, i);
    });
  }

  function updateHumanPose() {
    if (lastPhase === 'reveal' && director.getState().phaseTime < 7) {
      return { clip: 'Walk_Loop', time: director.getState().phaseTime, loop: true } satisfies CinematicPose;
    }
    return { clip: 'Idle_Loop', time: director.getState().time, loop: true } satisfies CinematicPose;
  }

  function updatePhysics(dt: number) {
    if (disposed || paused || blurred || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    animationDelta = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
    skipHold.update(animationDelta);
    director.update(animationDelta);
    for (const phase of director.drainChanges()) {
      if (phase === 'defeat' || phase === 'victory') {
        endingEntry = { hero: heroMech.root.position.clone(), enemy: enemyMech.root.position.clone(),
          heroRotation: heroMech.root.quaternion.clone(), enemyRotation: enemyMech.root.quaternion.clone() };
      }
      lastPhase = phase;
      keys.clear();
      if (phase === 'space' || phase === 'finisher') reachedSpace = true;
      if (phase === 'done' && !finishedCallbackSent) {
        finishedCallbackSent = true;
        onFinished();
      }
    }
    const state = director.getState();
    lastPhase = state.phase;
    site.update(animationDelta);
    site.updateActivePhysics([player.body.position]);
    let rupture = 0;
    if (state.phase === 'rupture') {
      rupture = smooth(state.phaseTime, PLANET_RUPTURE.impact, PLANET_RUPTURE.burst + 3);
    } else if (state.phase === 'space' || state.phase === 'finisher' || state.phase === 'victory'
      || (reachedSpace && state.phase === 'defeat') || state.phase === 'credits' || state.phase === 'done') {
      rupture = 1;
    }
    const reveal = state.phase === 'reveal' ? state.phaseTime : 4;
    const inSpace = reachedSpace && state.phase !== 'rupture';
    const roofBlast = state.phase === 'enemyTransform' ? state.phaseTime
      : state.phase === 'loading' || state.phase === 'error' || state.phase === 'reveal' ? -1 : 3;
    terrestrial.visible = !inSpace && !(state.phase === 'rupture' && state.phaseTime >= PLANET_RUPTURE.wide);
    site.rooftopEquipment.visible = roofBlast < 0.25 && terrestrial.visible;
    for (const light of environmentLights) if (light instanceof THREE.DirectionalLight) {
      light.castShadow = terrestrial.visible;
    }
    const lightPower = state.phase === 'loading' || state.phase === 'error' || state.phase === 'reveal' ? 0.24
      : state.phase === 'enemyTransform' ? 0.5 : 0.78;
    const night = sampleRooftopNight(state.phase, state.phaseTime);
    for (const [light, intensity] of environmentIntensity) {
      light.intensity = intensity * lightPower * (1 - night * (light instanceof THREE.DirectionalLight ? 0.84 : 0.35));
      light.color.copy(environmentColors.get(light)!).lerp(moonColor, night);
    }
    moon.intensity = night * (inSpace ? 0.65 : 1.1);
    world.update(state.time, rupture, inSpace, reveal, roofBlast, state.phase === 'rupture' ? state.phaseTime : -1, night);
    shipTransform.update(state.phase, state.phaseTime);

    if (state.phase === 'enemyTransform' && state.phaseTime >= 0.4) {
      const burstIndex = Math.floor((state.phaseTime - 0.4) * 2.6);
      if (burstIndex > lastFirework) {
        lastFirework = burstIndex;
        const student = SUDOERS_5[burstIndex % SUDOERS_5.length];
        const angle = burstIndex * 2.399;
        effects.sparks(enemyMech.root.position.clone().add(vector(Math.cos(angle) * 4,
          2 + burstIndex % 5 * 2.5, Math.sin(angle) * 4)), student.color, 8, vector(0, 1, 0));
      }
    } else if (state.phase !== 'enemyTransform') lastFirework = -1;

    updateActors(state.phase, state.phaseTime, state.time);
    mothership.root.visible = (state.phase === 'victory' && state.phaseTime >= DONUS_RETURN.appear)
      || state.phase === 'credits' || state.phase === 'done';
    if (mothership.root.visible) {
      const arrival = state.phase === 'victory' ? cinematicProgress(state.phaseTime, DONUS_RETURN.appear, DONUS_RETURN.arrival) : 1;
      mothership.root.position.copy(heroMech.root.position).add(vector(
        THREE.MathUtils.lerp(150, 37, arrival), THREE.MathUtils.lerp(38, 9, arrival),
        THREE.MathUtils.lerp(-180, -12, arrival)));
      mothership.root.position.y += Math.sin(state.time * 0.6) * 0.4 * arrival;
      mothership.root.rotation.set(Math.sin(arrival * Math.PI) * 0.12, -Math.PI / 2, Math.sin(arrival * Math.PI) * -0.12);
    }
    consumeDirectorEvents();
    updateMissiles(state.phase);
    effects.update(animationDelta);
    if (state.phase === 'versus') {
      if (!versusCaptured) {
        versus.capture(heroMech.root, [enemyMech.root]); versusCaptured = true;
      }
      versus.update(state.phaseTime);
      matchCall.textContent = state.phaseTime < 3.7 ? 'ONE PLANET. NO SECOND CHANCES.' : 'FIGHT!';
    } else versus.hide();

    const qte = director.qte.getState();
    const duelState = director.duel.getState();
    const cinematicShield = state.phase === 'enemyTransform'
      ? 1 - smooth(state.phaseTime, 2.4, 4.2) : 0;
    if (cinematicShield > 0) {
      effects.shield(summitPoint(0, 4.1, 6), 4.8, cinematicShield, state.time);
    } else {
      const combat = state.phase === 'ground' || state.phase === 'space';
      const fractured = combat && duelState.shieldLock > DUEL.shieldBreak - 0.28;
      effects.shield(heroMech.root.position.clone().add(vector(0, 7.5, 0)), DUEL.shieldRadius,
        combat && duelState.guarding ? 0.45 + duelState.shield / DUEL.shieldMax * 0.55 : fractured ? 0.24 : 0,
        state.time, fractured);
    }
    const enemyFractured = (state.phase === 'ground' || state.phase === 'space') && duelState.enemyShieldLock > DUEL.shieldBreak - 0.28;
    effects.shield(enemyMech.root.position.clone().add(vector(0, 7.5, 0)), DUEL.shieldRadius,
      duelState.enemyGuarding ? 0.45 + duelState.enemyShield / DUEL.shieldMax * 0.55 : enemyFractured ? 0.24 : 0,
      state.time, enemyFractured, 'enemy');
    const activeSpecial = duelState.special;
    const special = activeSpecial?.cinematic && (activeSpecial.kind === 'missiles' || activeSpecial.kind === 'overdrive' || activeSpecial.kind === 'verdict')
      ? { owner: activeSpecial.owner, kind: activeSpecial.kind, time: activeSpecial.time, duration: activeSpecial.duration } : null;
    const heroBlade = heroMech.getBlade(), enemyBlade = enemyMech.getBlade();
    cameraRig.update({
      phase: state.phase,
      phaseTime: state.phaseTime,
      time: state.time,
      space: inSpace,
      hero: heroMech.root,
      enemy: enemyMech.root,
      human: vector(player.body.position.x, player.body.position.y, player.body.position.z),
      students: students.students.map(student => student.root),
      ship: site.ship.root,
      mothership: mothership.root,
      bomb: world.getBombPosition(),
      heroChest: heroMech.getChest(), enemyChest: enemyMech.getChest(),
      heroMuzzle: heroMech.getMuzzle(), enemyMuzzle: enemyMech.getMuzzle(), clash: clashContact,
      heroBladeBase: heroBlade.base, heroBladeTip: heroBlade.tip, enemyBladeTip: enemyBlade.tip,
      special,
      qte: { beat: qte.beat, clock: qte.clock },
    }, animationDelta);

    updateObjective(state.phase, state.phaseTime);
    showDialogue(state.phase, state.phaseTime);
    const isMechCombat = state.phase === 'ground' || state.phase === 'space';
    presentation.mode(state.phase, !isMechCombat || !!special, isMechCombat && !special);
    presentation.stats(director.duel.hero.health, director.duel.enemy.health, director.duel.hero.energy,
      duelState.shield, duelState.ultimateCooldown,
      special ? '' : duelState.feedback || (duelState.enemyGuarding ? 'SHIELD RAISED' : duelState.enemyTell === 'verdict' ? 'BEAM INCOMING'
        : duelState.enemyTell === 'reap' ? 'REVERSE CUT'
          : duelState.enemyTell === 'thrust' ? 'THRUST' : ''), duelState.shieldLock);
    if (state.phase === 'finisher') {
      presentation.qte(qte);
    } else presentation.qte(null);
    const speed = state.phase === 'rupture' && state.phaseTime >= PLANET_RUPTURE.slam && state.phaseTime < PLANET_RUPTURE.impact ? 0.32
      : state.phase === 'finisher' ? sampleFinisher(qte.beat, qte.clock).speed : 0;
    presentation.speedLines(speed); presentation.update(animationDelta);

    if (state.phase === 'defeat' && state.phaseTime >= 4.2) {
      presentation.result('GAME OVER', state.failure || 'Sudoers 5 killed Brondon.', true, 'SIGNAL LOST');
    } else if (state.phase === 'error') {
      presentation.result('FINAL FRAME FAILED', state.error || 'The finale could not be loaded.', true, 'LOAD ERROR');
    } else presentation.result('', '', false);
    if (state.phase === 'credits' || state.phase === 'done') presentation.credits(state.phase === 'done' ? FINALE_DURATION.credits : state.phaseTime);
    else presentation.credits(-1);
  }

  return {
    scene, camera, player, ready, ownsWeaponInput: true, forceThirdPerson: true,
    updatePhysics,
    isCinematic: () => (lastPhase !== 'ground' && lastPhase !== 'space') || director.duel.getState().special?.cinematic === true,
    onPlayerDeath: () => true,
    hideCharacter: () => lastPhase !== 'reveal' && lastPhase !== 'enemyTransform'
      && !(lastPhase === 'heroTransform' && director.getState().phaseTime < HERO_TRANSFORM.pilotMerge),
    getCinematicState: () => player.getState(),
    getCinematicPose: updateHumanPose,
    getCinematicDelta: () => animationDelta,
    updateCinematicCharacter(character: Awaited<ReturnType<typeof loadCharacter>> | null) {
      if (character) character.model.visible = lastPhase === 'reveal' || lastPhase === 'enemyTransform'
        || (lastPhase === 'heroTransform' && director.getState().phaseTime < HERO_TRANSFORM.pilotMerge);
    },
    setMenuPaused(value: boolean) {
      paused = value;
      keys.clear();
      director.clearInput();
      syncPause();
    },
    clearInput() { keys.clear(); director.clearInput(); updateInput(); },
    renderSceneWithEffects() {
      if (lastPhase === 'versus') versus.render(renderer);
      else if (postProcessing) postProcessing.render();
      else renderer.render(scene, camera);
    },
    getSceneId: () => 'scene21',
    getMusicTrack: () => finaleMusicTrack(director.getState().phase),
    hasBossVictory: () => director.getState().phase === 'victory',
    isMusicPaused: () => paused || blurred,
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      skipHold.dispose();
      director.pause(true);
      presentation.dispose();
      versus.dispose();
      postProcessing?.dispose();
      heroTrail.dispose(); enemyTrail.dispose();
      effects.dispose();
      disposeComicEffects(scene);
      world.dispose();
      shipTransform.dispose();
      mothership.dispose();
      students.dispose();
      heroMech.dispose(); enemyMech.dispose();
      missilePool.forEach(missile => missile.root.removeFromParent());
      missileGeometry.dispose(); missileNoseGeometry.dispose();
      waveGeometry.dispose(); waveGlowGeometry.dispose(); verdictGeometry.dispose(); tracerGeometry.dispose();
      Object.values(tracerMaterials).forEach(material => material.dispose());
      waveMaterial.dispose(); waveGlowMaterial.dispose(); verdictMaterial.dispose(); verdictGlowMaterial.dispose();
      Object.values(missileMaterials).forEach(material => material.dispose());
      Object.values(flameMaterials).forEach(material => material.dispose());
      player.dispose();
      site.dispose();
      physics.dispose();
      scene.clear();
    },
  };
}
