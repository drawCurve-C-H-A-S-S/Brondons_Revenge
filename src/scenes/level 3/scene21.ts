import * as THREE from 'three';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import { createFinaleStudents, QUINTET } from '../../helpers/scene/finaleActors.js';
import { createFinaleCamera } from '../../helpers/scene/finaleCinematography.js';
import { createBladeTrail, createFinaleEffects } from '../../helpers/scene/finaleEffects.js';
import { createFinaleMech, type MechFactory } from '../../helpers/scene/finaleMechs.js';
import { createFinalePresentation } from '../../helpers/scene/finalePresentation.js';
import { createFinaleRenderer } from '../../helpers/scene/finaleRenderer.js';
import { createFinaleShipTransformation } from '../../helpers/scene/finaleShipTransformation.js';
import { createFinaleCreditSprite } from '../../helpers/scene/finaleCreditSprite.js';
import { createHangarVersus } from '../../helpers/scene/hangarVersus.js';
import {
  FINALE_DECK_Y, FINALE_ROOFTOP, FINALE_BATTLE_YAW, PLANET_CENTER, PLANET_RADIUS, SPACE_ALTITUDE, createFinaleWorld, finaleBattlePoint,
} from '../../helpers/scene/finaleWorld.js';
import { loadSubjectModel } from '../../core/loader.js';
import { createRescueSite, RESCUE_SITE, type RescueArrival } from '../../helpers/scene/rescueSite.js';
import { disposeComicEffects, emitComicEffect } from '../../helpers/scene/comicEffects.js';
import { createFinaleDirector, type FinaleCheckpoint, type FinalePhase } from '../../scripts/finaleDirector.js';
import { DUEL, FINISHER_BEATS, type MechMove } from '../../scripts/mechDuel.js';
import {
  FINALE_START_X, STUDENT_TIMELINE, HERO_TRANSFORM, PLANET_RUPTURE, RIFLE_SEQUENCE,
  activeStudent, sampleStudentBoarding, sampleFinisher,
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
    ].map((text, i) => ({ ...STUDENT_TIMELINE[i].reveal, speaker: QUINTET[i].name, text })),
    { start: 21.2, end: 24, speaker: 'THE QUINTET', text: 'Donus was only the beginning.' },
    { start: 24, end: 27, speaker: 'THE QUINTET', text: 'Five minds. One verdict. Your last.' },
  ],
  enemyTransform: [
    { start: 0, end: 3.2, speaker: 'PRIME', text: 'Brondon, behind me! The roof is coming down!' },
    { start: 3.2, end: 5.4, speaker: 'THE QUINTET', text: 'Behold the Final Verdict.' },
    ...[
      'Every escape route ends here.',
      'Five cores. One flawless machine.',
      'Donus was proof that our design works.',
      'Five wills. One verdict.',
      'Erase him.',
    ].map((text, i) => ({ ...STUDENT_TIMELINE[i].boarding, speaker: QUINTET[i].name, text })),
    { start: 17, end: 19.2, speaker: 'THE QUINTET', text: 'Final Verdict. All five cores online.' },
  ],
  heroTransform: [
    { start: 0, end: 2.6, speaker: 'PRIME', text: 'Hey, Brondon. We have a mech too.' },
    { start: 2.6, end: 6.4, speaker: 'PRIME', text: 'Shuttle, lift off. Come to the summit!' },
    { start: 6.4, end: 10.2, speaker: 'PRIME', text: "Your ship's core. Your blade. The frame forms around you." },
    { start: 10.2, end: 12.6, speaker: 'BRONDON', text: "Then let's bring Donus home." },
    { start: 12.6, end: 17, speaker: 'BRONDON', text: 'Prime Frame, online. We end this now.' },
  ],
  rupture: [
    { start: 0, end: 3.1, speaker: 'THE QUINTET', text: 'If we cannot rule this world, no one will. Deploy the planet breaker.' },
    { start: 3.1, end: 8.2, speaker: 'PRIME', text: 'That bomb will ignite the core! Boost now, Brondon!' },
    { start: 8.2, end: 16, speaker: 'BRONDON', text: 'Then we finish this among the stars.' },
  ],
  finisher: [
    { start: 0, end: 5, speaker: 'PRIME', text: 'They are exposed! Read the prompts and stay with me!' },
  ],
  victory: [
    { start: 0, end: 3.2, speaker: 'BRONDON', text: 'The reactor is down. The fight is over.' },
    { start: 3.2, end: 9.2, speaker: 'PRIME', text: 'Donus, if you can hear us, come back.' },
    { start: 9.2, end: 18, speaker: 'DONUS', text: 'Brondon... I am here. Thank you.' },
  ],
  defeat: [
    { start: 0, end: 4.2, speaker: 'THE QUINTET', text: 'The last light goes out.' },
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
    singleOpponent: true, playerName: 'BRONDON / PRIME FRAME', opponentName: 'THE QUINTET / FINAL VERDICT',
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

  const missileGeometry = new THREE.CapsuleGeometry(0.19, 0.95, 4, 8);
  const missileNoseGeometry = new THREE.ConeGeometry(0.2, 0.42, 8);
  const missileMaterials = {
    hero: new THREE.MeshStandardMaterial({ color: 0x4bcfff, metalness: 0.78, roughness: 0.22, emissive: 0x167ca4, emissiveIntensity: 1.3 }),
    enemy: new THREE.MeshStandardMaterial({ color: 0xff657f, metalness: 0.78, roughness: 0.22, emissive: 0x8b123d, emissiveIntensity: 1.3 }),
  };
  const flameMaterials = {
    hero: new THREE.MeshBasicMaterial({ color: 0x87eaff, toneMapped: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xffa14f, toneMapped: false }),
  };
  const missilePool = Array.from({ length: 32 }, () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(missileGeometry, missileMaterials.hero);
    const nose = new THREE.Mesh(missileNoseGeometry, missileMaterials.hero);
    const flame = new THREE.Mesh(missileNoseGeometry, flameMaterials.hero);
    nose.position.y = 0.63;
    flame.position.y = -0.73;
    flame.rotation.z = Math.PI;
    root.add(body, nose, flame);
    root.visible = false;
    scene.add(root);
    return { root, body, nose, flame };
  });
  const missileDirection = vector(0, 1, 0);
  const spaceReached = checkpoint?.stage === 'space' || checkpoint?.stage === 'finisher';
  let reachedSpace = spaceReached, paused = false, blurred = false, disposed = false;
  let lastPhase: FinalePhase = 'loading', lastFirework = -1, impactTimer = 0, impactOwner: 'hero' | 'enemy' = 'hero';
  let animationDelta = 0, finishedCallbackSent = false;
  let versusCaptured = false, lastBoardingCue = -1, qteShotIndex = -1, lastClashSpark = -1;
  let slashVariant = -1, enemySlashVariant = -1, lastHeroAttackTime = Infinity, lastEnemyAttackTime = Infinity;
  const clashContact = new THREE.Vector3();
  const qteProjectiles = Array.from({ length: 7 }, () => ({
    active: false, owner: 'enemy' as 'hero' | 'enemy', start: vector(0, 0, 0), end: vector(0, 0, 0), delay: 0,
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
    if (code === 'Enter') { director.holdSkip(pressed); return; }
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
    if (!COMBAT_KEYS.has(code) && code !== 'Enter') return;
    if (code === 'Enter' || COMBAT_KEYS.has(code)) {
      event.preventDefault();
      event.stopPropagation();
    }
    handleInput(code, true, event.repeat);
  }
  function onKeyUp(event: KeyboardEvent) {
    const code = event.code;
    if (code !== 'Enter' && !COMBAT_KEYS.has(code)) return;
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

  void Promise.all([site.ready, students.loaded, heroMech.loaded, enemyMech.loaded]).then(async () => {
    if (disposed) return;
    if (postProcessing) await postProcessing.prepare();
    if (disposed) return;
    presentation.setCreditSprite(await createFinaleCreditSprite(renderer));
    if (!disposed) director.assetsLoaded();
  }).catch(error => {
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
            effects.burst(chest, 1.7, QUINTET[i].color, 64);
            effects.ring(chest, 1.5, QUINTET[i].color, true, 0.6);
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
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2;
        effects.fireworks(summitPoint(18 + Math.cos(angle) * (10 + i % 3 * 3),
          7 + i % 4 * 2, -6 + Math.sin(angle) * 6), QUINTET[i % QUINTET.length].color);
      }
    } else if (id === 'five-cores') {
      QUINTET.forEach(student => effects.burst(enemyMech.getChest(), 2.2, student.color, 65));
    } else if (id === 'enemy-lock' || id === 'hero-lock') {
      const point = id === 'hero-lock' ? heroMech.getChest() : enemyMech.getChest();
      effects.ring(point, 7, id === 'hero-lock' ? 0x43dfff : 0xff5078, true);
      effects.burst(point, 3, id === 'hero-lock' ? 0x43dfff : 0xff5078, 100);
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
      const planetCallout = PLANET_CENTER.clone().add(vector(600, 380, 900).normalize().multiplyScalar(PLANET_RADIUS + 14));
      emitComicEffect(scene, 'boom', { position: planetCallout, size: 28 });
      for (let i = 0; i < 10; i++) {
        const direction = vector(Math.cos(i * 0.63), Math.sin(i * 0.37), Math.sin(i * 0.63)).normalize();
        effects.fireworks(PLANET_CENTER.clone().addScaledVector(direction, PLANET_RADIUS * (0.86 + i % 3 * 0.06)),
          i % 2 ? 0xff783d : 0x8ccfff);
      }
      presentation.flash(0.75); cameraRig.impact(2.2);
    } else if (id === 'quintet-burst') {
      for (let i = 0; i < 5; i++) effects.burst(summitPoint(18 + (i - 2) * 2, 8 + i), 4.5, QUINTET[i].color, 130);
    } else if (id === 'reactor-cut' || id === 'hero-frame') {
      effects.burst(heroMech.getChest(), 3.4, 0x5ce6ff, 110);
    } else if (id === 'escape-boost') {
      effects.ring(summitPoint(0, 7), 15, 0x65dcff, true, 1.6);
    } else if (id === 'fight') {
      presentation.sound('special'); presentation.flash(0.25);
    }
    if (id === 'planet-burst' || id === 'fireworks' || id === 'five-cores') presentation.sound('explode');
    else if (id === 'prime-beacon' || id === 'hero-sword' || id === 'hero-frame') presentation.sound('special');
  }

  function consumeDirectorEvents() {
    for (const cue of director.drainCues()) fireCue(cue.id, director.getState().phaseTime);
    for (const event of director.drainDuelEvents()) {
      const point = finaleBattlePoint(event.x, event.y, reachedSpace ? SPACE_ALTITUDE : 0);
      if (event.kind === 'launch') {
        point.copy(event.owner === 'hero' ? heroMech.getMuzzle() : enemyMech.getMuzzle());
        effects.sparks(point, event.owner === 'hero' ? 0x78eaff : 0xff718e, 22);
        emitComicEffect(scene, 'pew', { position: point, size: 4.2 });
        presentation.sound('launch');
      } else if (event.kind === 'swing') {
        emitComicEffect(scene, 'hit', { position: point, size: 6.2, weapon: 'sword' });
        presentation.sound('special');
      } else if (event.kind === 'parry') {
        effects.ring(point, 5, 0xffffff, true, 0.55);
        effects.burst(point, 1.7, 0x7df3ff, 45);
        emitComicEffect(scene, 'clank', { position: point, size: 5.5 });
        presentation.sound('parry');
        cameraRig.impact(0.35);
      } else if (event.kind === 'guard') {
        effects.sparks(point, 0x7deaff, 12);
        emitComicEffect(scene, 'clank', { position: point, size: 4.5 });
      } else if (event.kind === 'hit' || event.kind === 'guardBreak' || event.kind === 'cut') {
        effects.sparks(point, event.owner === 'hero' ? 0x75edff : 0xff6d78, 18);
        effects.ring(point, 2.2, event.owner === 'hero' ? 0x65dcff : 0xff6c7f, true, 0.58);
        emitComicEffect(scene, event.kind === 'guardBreak' || event.attack === 'missiles' ? 'boom'
          : event.kind === 'cut' ? 'clank' : 'hit',
          { position: point, size: event.kind === 'guardBreak' ? 7 : 4.5, weapon: event.attack === 'missiles' ? 'laser' : 'sword' });
        presentation.sound(event.kind === 'cut' ? 'parry' : 'hit');
        presentation.flash(0.18);
        impactTimer = 0.42;
        impactOwner = event.owner;
        cameraRig.impact(event.kind === 'guardBreak' ? 0.8 : 0.48);
      } else if (event.kind === 'special') {
        effects.burst(point, 4, event.owner === 'hero' ? 0x56e7ff : 0xff4277, 120);
        emitComicEffect(scene, 'boom', { position: point, size: 8 });
        presentation.sound('special');
        cameraRig.impact(0.45);
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
        emitComicEffect(scene, event.attack === 'missiles' ? 'pew' : event.attack === 'overdrive' ? 'boom' : 'thud',
          { position: point, size: 6 });
        presentation.sound('special');
      }
    }
    for (const event of director.drainQteEvents()) {
      if (event.kind === 'success') {
        const beat = FINISHER_BEATS[event.index];
        const tint = beat.shot === 'reactor' || beat.shot === 'finalCut' ? 0x8df5ff : 0xffd790;
        const point = beat.shot === 'clash' ? clashContact.clone() : beat.shot === 'countershot' ? heroMech.getMuzzle()
          : beat.shot === 'armCut' || beat.shot === 'finalCut' ? enemyMech.getChest() : heroMech.getChest();
        effects.burst(point, 2.5, tint, 90);
        emitComicEffect(scene, beat.shot === 'reactor' || beat.shot === 'missileCut' ? 'clank' : 'hit',
          { position: point, size: 6, weapon: 'sword' });
        presentation.sound('qte');
        cameraRig.impact(0.28);
      } else if (event.kind === 'armed') {
        const beat = FINISHER_BEATS[event.index];
        if (beat.shot === 'evade' || beat.shot === 'missileCut') {
          const muzzle = enemyMech.getMuzzle(), target = heroMech.getChest();
          qteProjectiles.forEach((projectile, i) => {
            projectile.active = beat.shot === 'missileCut' || i < 3;
            projectile.owner = 'enemy'; projectile.start.copy(muzzle); projectile.end.copy(target).add(vector(0, (i - 1) * 0.6, 0));
            projectile.delay = i * 0.09;
          });
          effects.sparks(muzzle, 0xff718e, 30);
          emitComicEffect(scene, 'pew', { position: muzzle, size: 6 });
          presentation.sound('launch');
        }
      } else if (event.kind === 'lost') {
        presentation.sound('explode');
        const point = heroMech.root.position.clone().add(vector(0, 7, 0));
        effects.burst(point, 7, 0xff365b, 150);
        emitComicEffect(scene, 'boom', { position: point, size: 12 });
      } else if (event.kind === 'won') {
        const point = enemyMech.root.position.clone().add(vector(0, 8, 0));
        effects.burst(point, 10, 0xffb34e, 180);
        emitComicEffect(scene, 'boom', { position: point, size: 16 });
      }
    }
  }

  function showDialogue(phase: FinalePhase, phaseTime: number) {
    const line = LINES[phase]?.find(item => phaseTime >= item.start && phaseTime < item.end);
    presentation.dialogue(line?.speaker ?? '', line?.text ?? '');
  }

  function updateObjective(phase: FinalePhase, phaseTime: number) {
    if (phase === 'loading') presentation.objective('FINAL CHAPTER / THE LAST LIGHT', 'Loading the command deck...');
    else if (phase === 'error') presentation.objective('FINAL CHAPTER / THE LAST LIGHT', 'The scene could not be prepared. Retry to load it again.');
    else if (phase === 'reveal') presentation.objective('FACILITY SUMMIT / FIVE SIGNATURES', 'Hold Enter to skip the reveal');
    else if (phase === 'enemyTransform') presentation.objective('FINAL VERDICT / FIVE CORES, ONE FRAME', 'The Quintet is combining their power');
    else if (phase === 'heroTransform') presentation.objective('PRIME FRAME / SHUTTLE RECALL', 'The shuttle is flying in from the jungle');
    else if (phase === 'versus') presentation.objective('FINAL CHAPTER / MATCHUP', 'Prime Frame versus Final Verdict');
    else if (phase === 'ground') presentation.objective('PHASE I / THE SUMMIT', 'A / D move  ·  J sword  ·  F rifle salvo  ·  Hold R shield / parry  ·  Space boost  ·  E overdrive');
    else if (phase === 'rupture') presentation.objective('PLANETARY COLLAPSE / ESCAPE', 'Boost with Prime. The fight is not over.');
    else if (phase === 'space') presentation.objective('PHASE II / ORBITAL EXECUTION', 'W / S rise and dive  ·  Find the opening in the Final Verdict');
    else if (phase === 'finisher') {
      const beat = director.qte.getState().beat;
      presentation.objective('FINAL LINK / DO NOT LET GO', beat.mode === 'mash' ? `Rapidly press ${beat.key.replace('Key', '').toUpperCase()}`
        : beat.mode === 'hold' ? `Hold ${beat.key.replace('Key', '').toUpperCase()} when the cue arms` : `Press ${beat.key.replace('Key', '').toUpperCase()} when the cue arms`);
    } else if (phase === 'defeat') presentation.objective('SIGNAL LOST / BRONDON DOWN', 'The last checkpoint is available after the death scene');
    else if (phase === 'victory') presentation.objective('THE LAST LIGHT / DONUS RESTORED', 'The Final Verdict has been defeated');
    else if (phase === 'credits') presentation.objective('BRONDON’S REVENGE', 'A final light remains');
    else if (phase === 'done') presentation.objective('THE END', 'Thank you for playing');

    if (phase === 'reveal' && phaseTime >= 23) presentation.title('THE QUINTET');
    else if (phase === 'enemyTransform' && phaseTime >= 17.6) presentation.title('FINAL VERDICT');
    else if (phase === 'heroTransform' && phaseTime >= 14.2) presentation.title('PRIME FRAME');
    else if (phase === 'rupture' && phaseTime >= PLANET_RUPTURE.burst) presentation.title('EDEN BREAKS');
    else if (phase === 'victory' && phaseTime >= 14) presentation.title('THE END');
    else if (phase === 'credits' || phase === 'done') presentation.title('');
    else presentation.title('');
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
      heroY = FINALE_DECK_Y + lift + hero.y;
      enemyY = FINALE_DECK_Y + lift + enemy.y;
    } else if (phase === 'reveal' || phase === 'loading' || phase === 'error') {
      heroX = -FINALE_START_X; heroY = FINALE_DECK_Y; enemyX = FINALE_START_X; enemyY = FINALE_DECK_Y;
    }

    heroMech.root.visible = inMechScene && phase !== 'enemyTransform'
      && (phase !== 'heroTransform' || phaseTime >= HERO_TRANSFORM.materialize);
    enemyMech.root.visible = inMechScene && (phase !== 'enemyTransform' || phaseTime >= 1.1);
    heroMech.root.position.copy(finaleBattlePoint(heroX, heroY - FINALE_DECK_Y));
    enemyMech.root.position.copy(finaleBattlePoint(enemyX, enemyY - FINALE_DECK_Y));
    heroMech.root.rotation.set(0, FINALE_BATTLE_YAW, 0);
    enemyMech.root.rotation.set(0, FINALE_BATTLE_YAW + Math.PI, 0);

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
    const choreography = phase === 'finisher' ? sampleFinisher(qte.beat, qte.clock, qte.resolveTime) : null;
    let heroMove: MechPoseName = hero.move as MechMove;
    let enemyMove: MechPoseName = enemy.move as MechMove;
    if (phase === 'enemyTransform') enemyMove = 'transform';
    else if (phase === 'heroTransform') heroMove = 'transform';
    else if (phase === 'rupture') { heroMove = phaseTime < PLANET_RUPTURE.escape ? 'guard' : 'boost'; enemyMove = phaseTime < 5.7 ? 'bomb' : 'boost'; }
    else if (choreography) {
      heroMove = choreography.heroPose; enemyMove = choreography.enemyPose;
      heroMech.root.position.copy(finaleBattlePoint(choreography.hero[0], choreography.hero[1], SPACE_ALTITUDE)).add(vector(0, 0, choreography.hero[2]));
      enemyMech.root.position.copy(finaleBattlePoint(choreography.enemy[0], choreography.enemy[1], SPACE_ALTITUDE)).add(vector(0, 0, choreography.enemy[2]));
      heroMech.root.rotation.z = choreography.heroRoll; enemyMech.root.rotation.z = choreography.enemyRoll;
    } else if (phase === 'victory' || phase === 'credits' || phase === 'done') {
      heroMove = 'victory'; enemyMove = 'defeat';
    } else if (phase === 'defeat') { heroMove = 'defeat'; enemyMove = 'victory'; }
    else if (phase === 'error' || phase === 'loading' || phase === 'reveal') {
      heroMove = 'idle'; enemyMove = 'idle';
    }

    if (hero.move === 'slash' && hero.time < lastHeroAttackTime) slashVariant++;
    if (enemy.move === 'slash' && enemy.time < lastEnemyAttackTime) enemySlashVariant++;
    lastHeroAttackTime = hero.move === 'slash' ? hero.time : Infinity;
    lastEnemyAttackTime = enemy.move === 'slash' ? enemy.time : Infinity;
    const heroDuration = choreography ? heroMove === 'missiles' ? RIFLE_SEQUENCE.swordReady : 1
      : phase === 'heroTransform' ? 17 : phase === 'rupture' ? 4.2 : Math.max(0.1, hero.duration || 1);
    const enemyDuration = choreography ? enemyMove === 'missiles' ? RIFLE_SEQUENCE.swordReady : 1
      : phase === 'enemyTransform' ? 19.2 : phase === 'rupture' ? 4.2 : Math.max(0.1, enemy.duration || 1);
    const heroPoseTime = choreography ? choreography.heroPoseProgress * heroDuration
      : phase === 'heroTransform' || phase === 'rupture' ? phaseTime : phase === 'victory' || phase === 'defeat' ? phaseTime : hero.time;
    const enemyPoseTime = choreography ? choreography.enemyPoseProgress * enemyDuration
      : phase === 'enemyTransform' || phase === 'rupture' ? phaseTime : phase === 'victory' || phase === 'defeat' ? phaseTime : enemy.time;
    heroMech.pose(heroMove, heroPoseTime, heroDuration, phase === 'rupture' || reachedSpace || hero.y > 1, Math.max(0, slashVariant), time, !!choreography);
    enemyMech.pose(enemyMove, enemyPoseTime, enemyDuration, phase === 'rupture' || reachedSpace || enemy.y > 1, Math.max(0, enemySlashVariant), time, !!choreography);
    const enemyChest = enemyMech.getChest(), heroChest = heroMech.getChest();
    heroMech.aimGun(enemyChest); enemyMech.aimGun(heroChest);
    const enemyGunCut = phase === 'finisher' && (qte.index > FINISHER_BEATS.findIndex(beat => beat.shot === 'armCut')
      || (qte.beat.shot === 'armCut' && qte.resolveTime / qte.beat.resolve > 0.42));
    enemyMech.setGunEnabled(!enemyGunCut);
    if (phase === 'finisher' && qte.beat.shot === 'clash' && qte.resolveTime < 0) {
      clashContact.copy(heroChest).lerp(enemyChest, 0.5).add(vector(0, 1.6, 2.2));
      heroMech.lockBlade(clashContact, 1); enemyMech.lockBlade(clashContact, -1);
      const spark = Math.floor(qte.clock * 14);
      if (spark !== lastClashSpark) {
        lastClashSpark = spark;
        effects.sparks(clashContact, 0xffe4ad, 14);
        if (spark % 6 === 0) emitComicEffect(scene, 'clank', { position: clashContact.clone(), size: 4.5 });
      }
    } else if (phase !== 'finisher' || qte.beat.shot !== 'clash') lastClashSpark = -1;
    world.updateBomb(phase === 'rupture' ? phaseTime : -1, enemyMech.getHand('left'));

    heroMech.setDamage(1 - hero.health / DUEL.heroHealth);
    enemyMech.setDamage(1 - enemy.health / DUEL.health);
    heroMech.setDissolve(phase === 'defeat' ? smooth(phaseTime, 2.1, 5.4) : 0);
    enemyMech.setDissolve(phase === 'victory' ? smooth(phaseTime, 2.8, 5.8)
      : phase === 'credits' || phase === 'done' ? 1 : 0);

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
    const trailActive = (move: MechPoseName) => move === 'slash' || move === 'cleave' || move === 'overdrive';
    heroTrail.update(heroBlade.base, heroBlade.tip, animationDelta, heroMech.root.visible && trailActive(heroMove));
    enemyTrail.update(enemyBlade.base, enemyBlade.tip, animationDelta, enemyMech.root.visible && trailActive(enemyMove));
    const clash = phase === 'finisher' && qte.beat.shot === 'clash' && qte.resolveTime < 0;
    effects.beam('hero', clashContact.clone().add(vector(0, -0.4, 0)), clashContact.clone().add(vector(0, 0.4, 0)),
      clash ? 0.25 + Math.sin(time * 30) * 0.08 : 0, time);
    if (impactTimer > 0) {
      impactTimer = Math.max(0, impactTimer - animationDelta);
      const source = impactOwner === 'hero' ? heroMech.root : enemyMech.root;
      const target = impactOwner === 'hero' ? enemyMech.root : heroMech.root;
      effects.beam(impactOwner, source.position.clone().add(vector(0, 9, 0)), target.position.clone().add(vector(0, 8, 0)),
        impactTimer * 0.24, time);
    } else {
      effects.beam('enemy', vector(0, 0, 0), vector(0, 0, 0), 0, time);
    }
  }

  function updateMissiles(phase: FinalePhase) {
    if (phase === 'finisher') {
      const qte = director.qte.getState();
      if (qte.index !== qteShotIndex) {
        qteShotIndex = qte.index;
        qteProjectiles.forEach(projectile => { projectile.active = false; });
      }
      if (qte.beat.shot === 'countershot' && qte.resolveTime >= 0 && !qteProjectiles[0].active) {
        const muzzle = heroMech.getMuzzle(), target = enemyMech.getChest();
        for (let i = 0; i < 5; i++) {
          const projectile = qteProjectiles[i];
          projectile.active = true; projectile.owner = 'hero'; projectile.start.copy(muzzle); projectile.end.copy(target);
          projectile.delay = i * 0.11 + 0.16;
        }
        effects.sparks(muzzle, 0x78eaff, 24);
        emitComicEffect(scene, 'pew', { position: muzzle, size: 6 });
        presentation.sound('launch');
      }
      const clock = qte.resolveTime >= 0 ? qte.resolveTime : Math.max(0, qte.clock - qte.beat.lead) * 0.12;
      missilePool.forEach((visual, i) => {
        const projectile = qteProjectiles[i];
        if (!projectile?.active) { visual.root.visible = false; return; }
        const flight = (clock - projectile.delay) / 0.62;
        const cut = qte.beat.shot === 'missileCut' && qte.resolveTime > 0.52;
        visual.root.visible = flight >= 0 && flight <= 1.12 && !cut;
        if (!visual.root.visible) return;
        visual.body.material = missileMaterials[projectile.owner]; visual.nose.material = missileMaterials[projectile.owner];
        visual.flame.material = flameMaterials[projectile.owner];
        visual.root.position.lerpVectors(projectile.start, projectile.end, flight);
        missileDirection.copy(projectile.end).sub(projectile.start).normalize();
        visual.root.quaternion.setFromUnitVectors(vector(0, 1, 0), missileDirection);
        visual.root.scale.setScalar(qte.beat.shot === 'evade' ? 1.5 : 1);
        visual.flame.scale.setScalar(1.15);
      });
      return;
    }
    qteShotIndex = -1;
    const missiles = director.duel.missiles;
    missilePool.forEach((visual, i) => {
      const missile = missiles[i];
      if (!missile) { visual.root.visible = false; return; }
      const side = missile.owner;
      visual.body.material = missileMaterials[side];
      visual.nose.material = missileMaterials[side];
      visual.flame.material = flameMaterials[side];
      visual.root.visible = true;
      const owner = side === 'hero' ? heroMech : enemyMech;
      const spawn = finaleBattlePoint((side === 'hero' ? director.duel.hero : director.duel.enemy).x
        + (side === 'hero' ? 1 : -1) * 3.5, 10.5, reachedSpace ? SPACE_ALTITUDE : 0);
      const muzzle = owner.getMuzzle(), offset = muzzle.sub(spawn).multiplyScalar(Math.max(0, 1 - missile.age / 0.25));
      visual.root.position.copy(finaleBattlePoint(missile.x, missile.y, reachedSpace ? SPACE_ALTITUDE : 0)).add(offset);
      visual.root.scale.setScalar(1);
      missileDirection.set(missile.vx * 0.9701425, missile.vy, -missile.vx * 0.2425356).normalize();
      visual.root.quaternion.setFromUnitVectors(vector(0, 1, 0), missileDirection);
      visual.flame.scale.setScalar(0.55 + Math.sin(missile.age * 40) * 0.12);
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
    director.update(animationDelta);
    for (const phase of director.drainChanges()) {
      lastPhase = phase;
      keys.clear();
      presentation.music(phase === 'ground' || phase === 'space' || phase === 'finisher');
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
      rupture = smooth(state.phaseTime, PLANET_RUPTURE.impact, 11.2);
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
    world.update(state.time, rupture, inSpace, reveal, roofBlast, state.phase === 'rupture' ? state.phaseTime : -1);
    shipTransform.update(state.phase, state.phaseTime);

    if (state.phase === 'enemyTransform' && state.phaseTime >= 0.4) {
      const burstIndex = Math.floor((state.phaseTime - 0.4) * 2.6);
      if (burstIndex > lastFirework) {
        lastFirework = burstIndex;
        const student = QUINTET[burstIndex % QUINTET.length];
        const angle = burstIndex * 2.399;
        effects.fireworks(summitPoint(18 + Math.cos(angle) * 12,
          7 + burstIndex % 5 * 2.5, Math.sin(angle) * 8), student.color);
      }
    } else if (state.phase !== 'enemyTransform') lastFirework = -1;

    updateActors(state.phase, state.phaseTime, state.time);
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
      const shieldVisible = (state.phase === 'ground' || state.phase === 'space' || state.phase === 'finisher')
        && (keys.has('KeyR') || duelState.shieldLock > 0);
      effects.shield(heroMech.root.position.clone().add(vector(0, 7.5, 0)), 10.5,
        shieldVisible ? duelState.shieldLock > 0 ? 0.28 : duelState.shield / DUEL.shieldMax : 0,
        state.time, duelState.shieldLock > 0);
    }
    const specialMove = director.duel.hero.move === 'missiles' || director.duel.hero.move === 'overdrive'
      ? director.duel.hero : director.duel.enemy.move === 'missiles' || director.duel.enemy.move === 'overdrive'
        ? director.duel.enemy : null;
    const special = specialMove ? {
      owner: specialMove === director.duel.hero ? 'hero' as const : 'enemy' as const,
      kind: specialMove.move === 'overdrive' ? 'overdrive' as const : 'missiles' as const,
      time: specialMove.time, duration: specialMove.duration,
    } : impactTimer > 0 ? { owner: impactOwner, kind: 'impact' as const, time: 0.42 - impactTimer, duration: 0.42 } : null;
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
      bomb: world.getBombPosition(),
      heroChest: heroMech.getChest(), enemyChest: enemyMech.getChest(),
      heroMuzzle: heroMech.getMuzzle(), enemyMuzzle: enemyMech.getMuzzle(), clash: clashContact,
      special,
      qte: { beat: qte.beat, clock: qte.clock, resolveTime: qte.resolveTime, progress: qte.progress },
    }, animationDelta);

    updateObjective(state.phase, state.phaseTime);
    showDialogue(state.phase, state.phaseTime);
    const isMechCombat = state.phase === 'ground' || state.phase === 'space' || state.phase === 'finisher';
    presentation.mode(state.phase, !isMechCombat, isMechCombat);
    presentation.stats(director.duel.hero.health, director.duel.enemy.health, director.duel.hero.energy,
      duelState.shield, duelState.sync,
      duelState.enemyTell === 'overdrive' ? 'UNBLOCKABLE / DODGE OR INTERRUPT'
        : duelState.enemyTell === 'cleave' ? 'HEAVY BLADE / SHIELD WITH R'
          : duelState.enemyTell === 'missiles' ? 'INCOMING SALVO / SHIELD WITH R'
            : duelState.feedback, duelState.shieldLock);
    if (state.phase === 'finisher') {
      presentation.qte(qte.beat, qte.remaining, qte.hold, qte.resolveTime >= 0, qte.presses, qte.progress, qte.armed);
    } else presentation.qte(null);

    if (state.phase === 'defeat' && state.phaseTime >= 4.2) {
      presentation.result('GAME OVER', state.failure || 'The Quintet killed Brondon.', true, 'SIGNAL LOST');
    } else if (state.phase === 'error') {
      presentation.result('FINAL FRAME FAILED', state.error || 'The finale could not be loaded.', true, 'LOAD ERROR');
    } else presentation.result('', '', false);
    if (state.phase === 'credits' || state.phase === 'done') presentation.credits(state.phase === 'done' ? 48 : state.phaseTime);
    else presentation.credits(-1);
  }

  return {
    scene, camera, player, ownsWeaponInput: true, forceThirdPerson: true,
    updatePhysics,
    isCinematic: () => lastPhase !== 'ground' && lastPhase !== 'space',
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
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      director.pause(true);
      presentation.dispose();
      versus.dispose();
      postProcessing?.dispose();
      heroTrail.dispose(); enemyTrail.dispose();
      effects.dispose();
      disposeComicEffects(scene);
      world.dispose();
      shipTransform.dispose();
      students.dispose();
      heroMech.dispose(); enemyMech.dispose();
      missilePool.forEach(missile => missile.root.removeFromParent());
      missileGeometry.dispose(); missileNoseGeometry.dispose();
      Object.values(missileMaterials).forEach(material => material.dispose());
      Object.values(flameMaterials).forEach(material => material.dispose());
      player.dispose();
      site.dispose();
      physics.dispose();
      scene.clear();
    },
  };
}
