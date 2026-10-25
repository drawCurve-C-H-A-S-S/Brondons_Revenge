import * as THREE from "three";
import { prepareSceneRendering } from "../../core/renderer.js";
import { createLightCountStabilizer } from "../../core/lightStabilizer.js";
import {
  SPECIAL_MOVE_NAMES,
  isNamedSpecialMove,
} from "../../scripts/global/finaleChoreography.js";
import { finaleMusicTrack } from "../../helpers/audio/gameMusic.js";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import {
  createFinaleStudents,
  SUDOERS_5,
} from "../../scripts/level-3/finaleActors.js";
import { createFinaleCamera } from "../../scripts/level-3/finaleCinematography.js";
import { createFinaleAftermath } from "../../scripts/level-3/finaleAftermath.js";
import {
  createBladeTrail,
  createFinaleEffects,
} from "../../scripts/level-3/finaleEffects.js";
import {
  createFinaleMech,
  type MechFactory,
} from "../../scripts/level-3/finaleMechs.js";
import { createFinalePresentation } from "../../scripts/level-3/finalePresentation.js";
import { createFinaleRenderer } from "../../scripts/level-3/finaleRenderer.js";
import { createFinaleShipTransformation } from "../../scripts/level-3/finaleShipTransformation.js";
import { createMothership } from "../../scripts/global/mothership.js";
import { createHoldToSkip } from "../../scripts/global/holdToSkip.js";
import {
  createBeamMaterial,
  FRAME_COLORS,
} from "../../scripts/level-3/finaleMaterials.js";
import { createHangarVersus } from "../../scripts/global/hangarVersus.js";
import {
  FINALE_DECK_Y,
  FINALE_ROOFTOP,
  FINALE_BATTLE_YAW,
  PLANET_CENTER,
  PLANET_RADIUS,
  SPACE_ALTITUDE,
  createFinaleWorld,
  finaleBattlePoint,
} from "../../scripts/level-3/finaleWorld.js";
import { loadSubjectModel } from "../../core/loader.js";
import {
  RESCUE_SITE,
  type RescueArrival,
} from "../../scripts/global/rescueSite.js";
import { createFinaleSite } from "../../scripts/level-3/finaleSite.js";
import {
  disposeComicEffects,
  emitComicEffect,
} from "../../scripts/global/comicEffects.js";
import {
  createFinaleDirector,
  FINALE_DURATION,
  shouldPauseFinale,
  type FinaleCheckpoint,
  type FinalePhase,
} from "../../scripts/global/finaleDirector.js";
import {
  DUEL,
  type MechAction,
  type DuelProjectileKind,
  type BladeDamageTrace,
} from "../../scripts/npc/mechDuel.js";
import {
  FINALE_START_X,
  FINALE_REVEAL,
  STUDENT_TIMELINE,
  HERO_TRANSFORM,
  PLANET_RUPTURE,
  RIFLE_SEQUENCE,
  HERO_ULTIMATE,
  ENEMY_VERDICT,
  ENEMY_ORBITAL_CUT,
  MELEE_STRIKES,
  FINISHER_EXECUTION,
  FINISHER_EXCHANGE,
  FINISHER_RIFLE,
  activeStudent,
  sampleStudentBoarding,
  sampleFinisherSequence,
  samplePlanetAftermath,
  isMeleeStrike,
  sampleMeleeBlade,
  finisherActionTime,
  cinematicProgress,
  sampleRooftopNight,
  DONUS_RETURN,
  sampleDodgeArc,
  sampleMothershipArrival,
  type FinisherBeat,
} from "../../scripts/global/finaleChoreography.js";
import type { MechPoseName } from "../../scripts/npc/mechAnimation.js";
import { createPlayer } from "../../scripts/player/player.js";
import type {
  CinematicPose,
  loadCharacter,
} from "../../scripts/player/characterManager.js";
import {
  isControllerActive,
  getControllerMovement,
} from "../../scripts/player/gamepadInput.js";
import {
  FACILITY,
  FACILITY_CUT_Y,
  FACILITY_ROOF_SEQUENCE,
  sampleFacilityLift,
} from "../../scripts/global/facilityArchitecture.js";
import { FACILITY_OFFICE, FACILITY_OFFICE_SEATS } from "../../scripts/level-3/facilityOffice.js";

interface FinaleOptions {
  entryState?: RescueArrival;
  checkpoint?: FinaleCheckpoint;
  renderer: THREE.WebGLRenderer;
  onFinished: () => void;
  onVictoryComplete?: () => void;
  onRetry: (checkpoint: FinaleCheckpoint) => void;
  mechFactories?: Partial<Record<"hero" | "enemy", MechFactory>>;
  loadStudents?: typeof loadSubjectModel;
}
interface FinaleFramingEntry {
  hero: THREE.Vector3;
  enemy: THREE.Vector3;
  heroRotation: THREE.Quaternion;
  enemyRotation: THREE.Quaternion;
  heroDissolve: number;
}

const smooth = THREE.MathUtils.smootherstep;
const vector = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const summitPoint = (x: number, y = 0, z = 0) =>
  vector(FINALE_ROOFTOP.x + x, FINALE_DECK_Y + y, FINALE_ROOFTOP.z + z);
const officePoint = (x: number, y = 0, z = 0) =>
  vector(FACILITY.x + x, FACILITY.officeFloor + y, FACILITY.z + z);
const COMBAT_KEYS = new Set([
  "KeyA",
  "KeyD",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyS",
  "KeyR",
  "Space",
  "KeyJ",
  "KeyF",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "KeyC",
]);
const ACTION_KEYS: Partial<Record<string, MechAction>> = {
  KeyJ: "slash",
  KeyF: "missiles",
  Space: "dash",
  KeyE: "overdrive",
  KeyC: "slide",
};

const LINES: Partial<
  Record<
    FinalePhase,
    { start: number; end: number; speaker: string; text: string }[]
  >
> = {
  reveal: [
    {
      start: 0,
      end: 3.4,
      speaker: "BRONDON",
      text: "I came all this way to hear the truth from you.",
    },
    {
      start: 3.4,
      end: 6.4,
      speaker: "BRONDON",
      text: "Look at me and tell me what you did to Branden and Brendan.",
    },
    {
      start: 6.4,
      end: FINALE_REVEAL.studentStart,
      speaker: "BRONDON",
      text: "Tell me I didn't teach you this.",
    },
    ...[
      "You taught us to question every limit, Professor. Donus's safeguards were simply the first ones we broke.",
      "Branden let us perfect neural control, and Brendan showed us how often a mind could be broken and made to begin again.",
      "Prime never saw us in that laboratory. We gave it the memory and let your guilt turn it into truth.",
      "Every lock, keycard, and signal was placed for you. You did not find us, Professor. We guided you here.",
      "Branden and Brendan were rehearsals, Donus was our alibi, and you were the only result that mattered.",
    ].map((text, i) => ({
      ...STUDENT_TIMELINE[i].reveal,
      speaker: SUDOERS_5[i].name,
      text,
    })),
    {
      start: FINALE_REVEAL.studentEnd,
      end: FINALE_REVEAL.mentorEnd,
      speaker: "BRONDON",
      text: "All those years, I thought I was teaching you to make the world better.",
    },
    {
      start: FINALE_REVEAL.mentorEnd,
      end: FINALE_REVEAL.correctionEnd,
      speaker: SUDOERS_5[4].name,
      text: "You taught us to make it obey.",
    },
    {
      start: FINALE_REVEAL.correctionEnd,
      end: FINALE_REVEAL.brandenEnd,
      speaker: "BRONDON",
      text: "Branden died believing there was still something in you worth saving.",
    },
    {
      start: FINALE_REVEAL.brandenEnd,
      end: FINALE_REVEAL.mockeryEnd,
      speaker: SUDOERS_5[4].name,
      text: "You crossed the stars for the same mistake.",
    },
    {
      start: FINALE_REVEAL.mockeryEnd,
      end: FINALE_REVEAL.betrayalEnd,
      speaker: "BRONDON",
      text: "You used my trust, tortured my friends, and rewrote Prime just to put a leash around me.",
    },
    {
      start: FINALE_REVEAL.betrayalEnd,
      end: FINALE_REVEAL.recognitionEnd,
      speaker: "BRONDON",
      text: "You wanted your mentor to see what you became. I see you.",
    },
    {
      start: FINALE_REVEAL.recognitionEnd,
      end: FINALE_REVEAL.renounceEnd,
      speaker: "BRONDON",
      text: "And I am ashamed I ever called you my students.",
    },
    {
      start: FINALE_REVEAL.renounceEnd,
      end: FINALE_REVEAL.challengeEnd,
      speaker: "SUDOERS 5",
      text: "Then give us one final lesson.",
    },
    {
      start: FINALE_REVEAL.challengeEnd,
      end: FINALE_REVEAL.end,
      speaker: "BRONDON",
      text: "Gladly.",
    },
  ],
  enemyTransform: [
    {
      start: 0,
      end: FACILITY_ROOF_SEQUENCE.cutStart,
      speaker: "PRIME",
      text: "Brondon, brace yourself! I've got you!",
    },
    {
      start: FACILITY_ROOF_SEQUENCE.cutStart,
      end: FACILITY_ROOF_SEQUENCE.liftStart + 0.8,
      speaker: "PRIME",
      text: "Stay on the circle. They're cutting through the dome!",
    },
    {
      start: FACILITY_ROOF_SEQUENCE.liftStart + 0.8,
      end: FACILITY_ROOF_SEQUENCE.boardingStart,
      speaker: SUDOERS_5[4].name,
      text: "You wanted us face to face. Let's take this outside.",
    },
    {
      start: FACILITY_ROOF_SEQUENCE.boardingStart,
      end: FACILITY_ROOF_SEQUENCE.boardingStart + 3.9,
      speaker: "SUDOERS 5",
      text: "You taught us every machine has a weakness, Professor. We learned that people do too.",
    },
    {
      start: FACILITY_ROOF_SEQUENCE.boardingStart + 3.9,
      end: FACILITY_ROOF_SEQUENCE.boardingStart + 7.9,
      speaker: "SUDOERS 5",
      text: "Branden gave us control, Brendan gave us endurance, and Donus gave us reach.",
    },
    {
      start: FACILITY_ROOF_SEQUENCE.boardingStart + 7.9,
      end: FACILITY_ROOF_SEQUENCE.assembled,
      speaker: "SUDOERS 5",
      text: "Now your final lesson gives us a body.",
    },
    {
      start: FACILITY_ROOF_SEQUENCE.assembled,
      end: FACILITY_ROOF_SEQUENCE.end,
      speaker: "SUDOERS 5",
      text: "Five minds. One Final Verdict.",
    },
  ],
  heroTransform: [
    {
      start: 0,
      end: 2.6,
      speaker: "PRIME",
      text: "They have five cores. We have one chance.",
    },
    {
      start: 2.6,
      end: 6.4,
      speaker: "PRIME",
      text: "Shuttle, emergency ascent. Give him everything.",
    },
    {
      start: 6.4,
      end: 10.2,
      speaker: "PRIME",
      text: "The frame will hold. Brondon... you have to hold with it.",
    },
    {
      start: 10.2,
      end: 12.6,
      speaker: "BRONDON",
      text: "Donus is still in there. I'm not leaving him.",
    },
    {
      start: 12.6,
      end: 17,
      speaker: "BRONDON",
      text: "Prime Frame. Stand with me.",
    },
  ],
  rupture: [
    {
      start: 0,
      end: 3.8,
      speaker: "SUDOERS 5",
      text: "If we cannot rule this world, no one will.",
    },
    {
      start: 3.8,
      end: 9,
      speaker: "PRIME",
      text: "That bomb will ignite the core! Boost now, Brondon!",
    },
    {
      start: PLANET_RUPTURE.scorch,
      end: PLANET_RUPTURE.feet,
      speaker: "BRENDAN",
      text: "Ahhhhh, it burns!",
    },
    {
      start: PLANET_RUPTURE.feet,
      end: PLANET_RUPTURE.fall,
      speaker: "BRENDAN",
      text: "In the end, I ended up just like that gitea server.",
    },
    {
      start: PLANET_RUPTURE.cockpit,
      end: PLANET_RUPTURE.resolve,
      speaker: "BRONDON",
      text: "Nooooo, Brendan!!",
    },
    {
      start: PLANET_RUPTURE.resolve,
      end: PLANET_RUPTURE.orbit + 0.4,
      speaker: "BRONDON",
      text: "Sudoers, I will never forgive you. You must die. I will have my revenge!!!",
    },
  ],
  finisher: [
    {
      start: 0,
      end: 3.2,
      speaker: "PRIME",
      text: "The frame is coming apart. Stay with me, Brondon!",
    },
  ],
  victory: [
    {
      start: 0,
      end: 3.2,
      speaker: "BRONDON",
      text: "The reactor is down. The fight is over.",
    },
    {
      start: 3.2,
      end: 9.2,
      speaker: "PRIME",
      text: "Donus, if you can hear us, come back.",
    },
    {
      start: 9.2,
      end: 18,
      speaker: "DONUS",
      text: "Brondon... I am here. Thank you.",
    },
  ],
  defeat: [
    {
      start: 0,
      end: 4.2,
      speaker: "SUDOERS 5",
      text: "The last light goes out.",
    },
  ],
};

export function createScene({
  entryState,
  checkpoint,
  renderer,
  onFinished,
  onVictoryComplete,
  onRetry,
  mechFactories,
  loadStudents = loadSubjectModel,
}: FinaleOptions) {
  const physics = createScenePhysics();
  const site = createFinaleSite();
  const scene = site.scene;
  const terrestrial = new THREE.Group();
  terrestrial.name = "FinaleTerrestrialEnvironment";
  const environmentLights: THREE.Object3D[] = [];
  for (const child of [...scene.children]) {
    if (child instanceof THREE.Light || child.type === "Object3D")
      environmentLights.push(child);
    else terrestrial.add(child);
  }
  const environmentIntensity = new Map(
    environmentLights
      .filter((light): light is THREE.Light => light instanceof THREE.Light)
      .map((light) => [light, light.intensity]),
  );
  const environmentColors = new Map(
    [...environmentIntensity.keys()].map((light) => [
      light,
      light.color.clone(),
    ]),
  );
  const moonColor = new THREE.Color(0x91b5e1);
  const moon = new THREE.DirectionalLight(moonColor, 0);
  moon.position.copy(summitPoint(-45, 75, 35));
  moon.target.position.copy(summitPoint(0, 8));
  scene.add(moon, moon.target);
  scene.add(terrestrial);
  const camera = new THREE.PerspectiveCamera(
    56,
    window.innerWidth / window.innerHeight,
    0.08,
    5200,
  );
  const spawn = officePoint(0, 0.32, 8);
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: spawn,
  });
  if (entryState?.pilotState)
    player.restoreTransition(entryState.pilotState, {
      x: FINALE_ROOFTOP.x,
      y: FACILITY.officeFloor,
      z: FINALE_ROOFTOP.z,
      yaw: -Math.PI,
    });
  player.setPosition(spawn.x, spawn.y, spawn.z);
  player.setRotation(0, 0);
  player.disable();
  player.clearInput();
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove("jungle-platformer", "space-cinematic");
  const lightCounts = createLightCountStabilizer(scene);
  scene.onBeforeRender = (_renderer, _scene, viewCamera) => {
    lightCounts.sync();
    if (terrestrial.visible) site.updateVisibility(viewCamera);
  };

  for (const id of [
    "flight-hud",
    "flight-controls",
    "space-crosshair",
    "space-boss-hud",
    "space-alert",
    "space-damage",
    "space-pause",
    "space-cinematic-caption",
    "escape-qte",
  ])
    document.getElementById(id)?.classList.add("hidden");

  const world = createFinaleWorld(scene, {
    facilityRoof: site.facilityRoof,
    renderer,
  });
  const mothership = createMothership();
  mothership.root.visible = false;
  scene.add(mothership.root);
  physics.addBox(
    { x: FINALE_ROOFTOP.width, y: 0.4, z: FINALE_ROOFTOP.depth - 1 },
    { x: FINALE_ROOFTOP.x, y: FINALE_DECK_Y - 0.2, z: FINALE_ROOFTOP.z },
  );
  site.ship.setCanopyOpen(1);
  site.ship.update(0);
  const shipTransform = createFinaleShipTransformation(
    scene,
    site.ship,
    finaleBattlePoint(-FINALE_START_X),
  );
  const students = createFinaleStudents(loadStudents);
  students.root.visible = false;
  scene.add(students.root);
  site.setOfficeFurniture(students.furniture);
  const heroMech = createFinaleMech("hero", mechFactories?.hero);
  const enemyMech = createFinaleMech("enemy", mechFactories?.enemy);
  heroMech.root.visible = false;
  enemyMech.root.visible = false;
  scene.add(heroMech.root, enemyMech.root);
  const aftermath = createFinaleAftermath(
    scene,
    site.boy,
    site.ready,
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    site.getBoyAnimations,
  );
  const versus = createHangarVersus({
    singleOpponent: true,
    playerName: "BRONDON / PRIME FRAME",
    opponentName: "SUDOERS 5 / FINAL VERDICT",
    portraitScale: 1.83 / 16,
    layout: "columns",
  });
  versus.root.classList.add("finale-versus");
  const matchLabel = document.createElement("div");
  matchLabel.className = "finale-versus-chapter";
  matchLabel.textContent = "FINAL CHAPTER / FIVE MINDS. ONE LAST LIGHT.";
  const matchCall = document.createElement("div");
  matchCall.className = "finale-versus-call";
  versus.root.append(matchLabel, matchCall);

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const mobile =
    document.body.classList.contains("touch-device") ||
    window.matchMedia("(max-width: 700px)").matches;
  const effects = createFinaleEffects(scene, reducedMotion, mobile);
  const heroTrail = createBladeTrail(scene, "hero");
  const enemyTrail = createBladeTrail(scene, "enemy");
  const cameraRig = createFinaleCamera(camera, reducedMotion);
  const director = createFinaleDirector(checkpoint?.stage ?? "reveal", {
    bossImmunityAvailable: entryState?.bossImmunityCollected,
    bossImmunityUsed: checkpoint?.bossImmunityUsed,
  });
  const presentation = createFinalePresentation(
    (code, pressed) => handleInput(code, pressed),
    retryCheckpoint,
  );
  let postProcessing: ReturnType<typeof createFinaleRenderer> | null = null;
  try {
    postProcessing = createFinaleRenderer(renderer, scene, camera, mobile);
  } catch (error) {
    console.error(
      "[Scene 21] Could not initialize the finale renderer:",
      error,
    );
  }

  const missileGeometry = new THREE.CapsuleGeometry(0.14, 2.4, 4, 8);
  const missileNoseGeometry = new THREE.ConeGeometry(0.2, 0.42, 8);
  const tracerGeometry = new THREE.CylinderGeometry(0.32, 0.025, 5.4, 12);
  const missileMaterials = {
    hero: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xdcfaff).multiplyScalar(6),
      toneMapped: false,
    }),
    enemy: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffe6ec).multiplyScalar(6),
      toneMapped: false,
    }),
  };
  const tracerMaterials = {
    hero: createBeamMaterial(FRAME_COLORS.hero),
    enemy: createBeamMaterial(FRAME_COLORS.enemy),
  };
  const flameMaterials = {
    hero: new THREE.MeshBasicMaterial({ color: 0x87eaff, toneMapped: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xcd7480, toneMapped: false }),
  };
  const waveShape = new THREE.Shape();
  waveShape.moveTo(-6.2, -1.6);
  waveShape.quadraticCurveTo(0, 5.8, 6.2, -1.6);
  waveShape.quadraticCurveTo(0, 2.6, -6.2, -1.6);
  const waveGeometry = new THREE.ExtrudeGeometry(waveShape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.08,
    bevelThickness: 0.08,
    steps: 1,
  });
  waveGeometry.translate(0, 0, -0.09);
  const waveGlowGeometry = new THREE.ShapeGeometry(waveShape, 32);
  const verdictGeometry = new THREE.CylinderGeometry(0.24, 0.24, 10.5, 20);
  const waveMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xc6f3ff).multiplyScalar(2.4),
    toneMapped: false,
  });
  const waveGlowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(FRAME_COLORS.hero).multiplyScalar(3),
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const waveWakeMaterial = waveGlowMaterial.clone();
  waveWakeMaterial.opacity = 0.16;
  const enemyWaveMaterial = createBeamMaterial(FRAME_COLORS.enemy);
  enemyWaveMaterial.uniforms.uPower.value = 0.85;
  const enemyWaveGlowMaterial = enemyWaveMaterial.clone();
  enemyWaveGlowMaterial.uniforms.uPower.value = 0.28;
  const enemyWaveWakeMaterial = enemyWaveMaterial.clone();
  enemyWaveWakeMaterial.uniforms.uPower.value = 0.1;
  const verdictMaterials = {
    hero: new THREE.MeshBasicMaterial({
      color: new THREE.Color(FRAME_COLORS.hero).multiplyScalar(2.2),
      toneMapped: false,
    }),
    enemy: new THREE.MeshBasicMaterial({
      color: new THREE.Color(FRAME_COLORS.enemy).multiplyScalar(1.1),
      toneMapped: false,
    }),
  };
  const verdictGlows = {
    hero: createBeamMaterial(FRAME_COLORS.hero),
    enemy: createBeamMaterial(FRAME_COLORS.enemy),
  };
  verdictGlows.enemy.uniforms.uPower.value = 0.3;
  const missilePool = Array.from({ length: 32 }, () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(missileGeometry, missileMaterials.hero);
    const nose = new THREE.Mesh(missileNoseGeometry, missileMaterials.hero);
    const flame = new THREE.Mesh(missileNoseGeometry, flameMaterials.hero);
    const tracer = new THREE.Mesh(tracerGeometry, tracerMaterials.hero);
    tracer.name = "RifleIonTracer";
    tracer.position.y = -2.4;
    nose.position.y = 1.3;
    flame.position.y = -1.3;
    flame.rotation.z = Math.PI;
    const wave = new THREE.Group();
    wave.name = "FlyingBladeWave";
    const edge = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(waveGeometry, waveMaterial),
      glow = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(waveGlowGeometry, waveGlowMaterial);
    glow.scale.set(1.14, 1.2, 1);
    const wake = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(waveGlowGeometry, waveWakeMaterial);
    wake.position.y = -1.6;
    wake.scale.set(0.86, 0.9, 1);
    const tail = wake.clone();
    tail.position.y = -3.2;
    tail.scale.set(0.64, 0.72, 1);
    edge.rotation.x = -0.12;
    glow.rotation.x = -0.12;
    wave.add(edge, glow, wake, tail);
    const beam = new THREE.Mesh(verdictGeometry, verdictMaterials.enemy);
    beam.name = "SwordTipBeam";
    const beamGlow = new THREE.Mesh(verdictGeometry, verdictGlows.enemy);
    beamGlow.scale.set(2.5, 1, 2.5);
    beam.add(beamGlow);
    wave.visible = beam.visible = false;
    root.add(body, nose, flame, tracer, wave, beam);
    root.visible = false;
    scene.add(root);
    return { root, body, nose, flame, tracer, wave, edge, glow, wake, tail, beam, beamGlow };
  });
  const missileDirection = vector(0, 1, 0);
  const spaceReached =
    checkpoint?.stage === "space" ||
    checkpoint?.stage === "finisher" ||
    checkpoint?.stage === "credits";
  let reachedSpace = spaceReached,
    paused = false,
    blurred = false,
    disposed = false;
  let lastPhase: FinalePhase = "loading",
    lastFirework = -1;
  let animationDelta = 0,
    finishedCallbackSent = false,
    victoryCallbackSent = false;
  let versusCaptured = false,
    lastBoardingCue = -1,
    lastClashSpark = -1;
  let finisherEffectIndex = -1,
    finisherEffectClock = -1,
    lastExecutionCut = -1;
  let endingEntry: FinaleFramingEntry | null = null;
  let finisherEntry: FinaleFramingEntry | null = null;
  const clashContact = new THREE.Vector3();
  const cinematicProjectiles = Array.from({ length: 7 }, () => ({
    active: false,
    owner: "enemy" as "hero" | "enemy",
    kind: "verdictBeam" as DuelProjectileKind,
    start: vector(0, 0, 0),
    end: vector(0, 0, 0),
    delay: 0,
    duration: 0.42,
  }));
  const keys = new Set<string>();
  const listeners = new AbortController();
  let retryRequested = false;

  function retryCheckpoint() {
    if (disposed || retryRequested) return;
    retryRequested = true;
    keys.clear();
    director.clearInput();
    onRetry(director.getCheckpoint());
  }

  function updateInput() {
    if (lastPhase !== "ground" && lastPhase !== "space") return;
    const left = keys.has("KeyA") || keys.has("ArrowLeft");
    const right = keys.has("KeyD") || keys.has("ArrowRight");
    const up = keys.has("KeyW") || keys.has("ArrowUp"),
      down = keys.has("KeyS") || keys.has("ArrowDown");
    const stick = getControllerMovement();
    director.duel.setInput({
      move: isControllerActive() ? stick.x : Number(right) - Number(left),
      lift: isControllerActive() ? -stick.y : Number(up) - Number(down),
      guard: keys.has("KeyR"),
    });
  }

  function handleInput(code: string, pressed: boolean, repeat = false) {
    if (disposed || paused) return;
    if (
      pressed &&
      code === "KeyR" &&
      (lastPhase === "error" ||
        (lastPhase === "defeat" && director.getState().phaseTime >= 4.2))
    ) {
      retryCheckpoint();
      return;
    }
    if (lastPhase !== "ground" && lastPhase !== "space") return;
    if (!pressed) {
      keys.delete(code);
      updateInput();
      return;
    }
    if (repeat) return;
    const action = ACTION_KEYS[code];
    if (action) {
      if (action === "slide" && lastPhase !== "ground") return;
      updateInput();
      director.duel.act(action);
      return;
    }
    if (COMBAT_KEYS.has(code)) {
      keys.add(code);
      updateInput();
    }
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
  function onVisibilityChange() {
    syncPause();
  }
  function playbackPaused() {
    return shouldPauseFinale(director.getState().phase, {
      menuPaused: paused,
      blurred,
      hidden: document.hidden,
    });
  }
  function syncPause() {
    const shouldPause = playbackPaused();
    director.pause(shouldPause);
    presentation.pause(shouldPause);
  }
  window.addEventListener("keydown", onKeyDown, { signal: listeners.signal });
  window.addEventListener("keyup", onKeyUp, { signal: listeners.signal });
  window.addEventListener("blur", onBlur, { signal: listeners.signal });
  window.addEventListener("focus", onFocus, { signal: listeners.signal });
  document.addEventListener("visibilitychange", onVisibilityChange, {
    signal: listeners.signal,
  });
  const skipHold = createHoldToSkip({
    button: presentation.skipButton,
    onSkip: () => director.skipIntro(),
    isAvailable: () =>
      ["reveal", "enemyTransform", "heroTransform"].includes(
        director.getState().phase,
      ),
    isPaused: playbackPaused,
  });

  const ready = Promise.all([
    site.ready,
    students.loaded,
    heroMech.loaded,
    enemyMech.loaded,
    mothership.ready,
    aftermath.ready,
  ]).then(async () => {
    if (disposed) return;
    director.duel.setBladePaths("hero", heroMech.sampleAttackPaths());
    director.duel.setBladePaths("enemy", enemyMech.sampleAttackPaths());
    director.duel.setPhysicalPaths(heroMech.samplePhysicalPaths());
    director.assetsLoaded();
  });
  void ready.catch((error) => {
    if (disposed) return;
    const message = `Unable to load the final-boss presentation: ${String(error)}`;
    console.error("[Scene 21]", error);
    director.assetsFailed(message);
  });

  function updateStudentReveal(phase: FinalePhase, phaseTime: number) {
    const visible =
      phase === "reveal" ||
      phase === "enemyTransform" ||
      (phase === "victory" && phaseTime >= 6 && phaseTime < 15);
    students.root.visible = visible;
    const lift =
      phase === "enemyTransform"
        ? sampleFacilityLift(phaseTime)
        : sampleFacilityLift(-1);
    students.furniture.visible =
      phase === "reveal" ||
      (phase === "enemyTransform" &&
        phaseTime < FACILITY_ROOF_SEQUENCE.blastClear);
    students.furniture.position.set(
      FACILITY.x,
      0,
      FACILITY.z,
    );
    for (let i = 0; i < students.students.length; i++) {
      const student = students.students[i];
      const seat = FACILITY_OFFICE_SEATS[i];
      student.root.scale.setScalar(1);
      if (phase === "reveal") {
        const standStart = 1.35 + i * 0.16,
          standEnd = standStart + 1.8;
        student.root.visible = true;
        student.root.position.copy(officePoint(seat.x, 0, seat.z));
        student.root.rotation.y = seat.yaw;
        const chair = students.furniture.getObjectByName(`FacilityOfficeChair${i + 1}`);
        if (chair) chair.position.z = seat.z - FACILITY_OFFICE.chairSetback -
          smooth(phaseTime, standStart, standEnd) * 0.32;
        const speaking =
          activeStudent(phaseTime, "reveal") === i ||
          (i === 4 &&
            ((phaseTime >= FINALE_REVEAL.mentorEnd &&
              phaseTime < FINALE_REVEAL.correctionEnd) ||
              (phaseTime >= FINALE_REVEAL.brandenEnd &&
                phaseTime < FINALE_REVEAL.mockeryEnd)));
        const mode =
          phaseTime < standStart
            ? "sit"
            : phaseTime < standEnd
              ? "stand"
              : phaseTime >= FINALE_REVEAL.studentEnd && !speaking
                ? "pose"
                : speaking
                  ? "talk"
                  : "idle";
        students.animate(
          i,
          mode,
          mode === "pose"
            ? phaseTime - FINALE_REVEAL.studentEnd
            : mode === "stand"
              ? ((phaseTime - standStart) / (standEnd - standStart)) *
                student.actions.stand.getClip().duration
              : phaseTime,
          animationDelta,
        );
        world.lightStudent(i, student.root.position);
      } else if (phase === "enemyTransform") {
        const boarding = sampleStudentBoarding(i, phaseTime);
        const start = vector(FACILITY.x + seat.x, lift.y, FACILITY.z + seat.z);
        const chest = enemyMech.getChest();
        const entry = chest.clone().add(vector(-3.2, -0.8, 3.3));
        student.root.position
          .lerpVectors(start, entry, boarding.ascent)
          .lerp(chest, boarding.merge);
        student.root.rotation.y = THREE.MathUtils.lerp(
          0,
          FINALE_BATTLE_YAW + Math.PI,
          boarding.ascent,
        );
        student.root.scale.setScalar(boarding.scale);
        student.root.visible = boarding.visible;
        students.animate(
          i,
          boarding.active ? "board" : phaseTime < FACILITY_ROOF_SEQUENCE.boardingStart ? "pose" : "idle",
          boarding.active
            ? phaseTime - STUDENT_TIMELINE[i].boarding.start
            : phaseTime < FACILITY_ROOF_SEQUENCE.boardingStart
              ? 3.6
              : phaseTime,
          animationDelta,
        );
        if (boarding.active) {
          effects.boardingBeam(
            i,
            student.root.position
              .clone()
              .add(vector(0, 0.9 * boarding.scale, 0)),
            chest,
            boarding.beam,
            director.getState().time,
          );
          if (
            phaseTime >= STUDENT_TIMELINE[i].boarding.start + 1.5 &&
            lastBoardingCue < i
          ) {
            lastBoardingCue = i;
            effects.burst(chest, 1.2, SUDOERS_5[i].color, 32);
            effects.ring(chest, 1.2, SUDOERS_5[i].color, true, 0.6);
            presentation.sound("parry");
          }
        } else {
          const charging = phaseTime < FACILITY_ROOF_SEQUENCE.blastStart
            ? smooth(phaseTime, 0.15, FACILITY_ROOF_SEQUENCE.blastStart) * 0.35
            : 0;
          effects.boardingBeam(
            i, start.clone().add(vector(0, 1.1, 0)),
            officePoint(0, 1.15, FACILITY_OFFICE.tableZ), charging,
            director.getState().time,
          );
        }
      } else if (phase === "victory" && phaseTime >= 6 && phaseTime < 15) {
        student.root.visible = true;
        student.root.position.copy(
          summitPoint((i - 2) * 2.2, 0, -2.5 + Math.sin(phaseTime + i) * 0.25),
        );
        student.root.rotation.y = 0;
        students.animate(i, "idle", phaseTime + i * 0.1, animationDelta);
      } else student.root.visible = false;
    }
    if (phase !== "enemyTransform") {
      lastBoardingCue = -1;
      for (let i = 0; i < 5; i++)
        effects.boardingBeam(i, vector(0, 0, 0), vector(0, 0, 0), 0, 0);
    }
  }

  function fireCue(id: string, phaseTime: number) {
    if (id === "office-blast") {
      const center = officePoint(0, 1.15, FACILITY_OFFICE.tableZ);
      effects.burst(center, 1.7, FRAME_COLORS.enemy, 100);
      effects.ring(center, 18, FRAME_COLORS.enemy, false, 1.1);
      effects.ring(center, 12, 0xffa577, true, 0.65);
      presentation.sound("explode");
      presentation.flash(reducedMotion ? 0.06 : 0.16);
      cameraRig.impact(0.24);
    } else if (id === "roof-blast") {
      const cut = vector(FACILITY.x, FACILITY_CUT_Y, FACILITY.z);
      effects.sparks(cut, 0xff4665, 18);
      presentation.sound("special");
      cameraRig.impact(0.12);
    } else if (id === "prime-shield") {
      const shieldPoint = officePoint(0, 1.05, 6);
      effects.ring(shieldPoint, 1.35, 0x5ce6ff, true, 0.55);
      presentation.sound("parry");
      cameraRig.impact(0.05);
    } else if (id === "fireworks") {
      effects.ring(enemyMech.getChest(), 8, FRAME_COLORS.enemy, true, 1.5);
      effects.sparks(enemyMech.getChest(), 0x86333e, 34, vector(0, 1, 0));
    } else if (id === "five-cores") {
      effects.burst(enemyMech.getChest(), 2.2, FRAME_COLORS.enemy, 75);
    } else if (id === "enemy-lock" || id === "hero-lock") {
      const point =
        id === "hero-lock" ? heroMech.getChest() : enemyMech.getChest();
      effects.ring(
        point,
        7,
        id === "hero-lock" ? FRAME_COLORS.hero : FRAME_COLORS.enemy,
        true,
      );
      effects.burst(
        point,
        3,
        id === "hero-lock" ? FRAME_COLORS.hero : FRAME_COLORS.enemy,
        65,
      );
    } else if (id === "prime-beacon") {
      effects.ring(
        RESCUE_SITE.ship.clone().add(vector(0, 0.2, 0)),
        8,
        0x65dcff,
        false,
        1.6,
      );
    } else if (id === "ship-disassemble") {
      effects.burst(
        site.ship.root.position.clone().add(vector(0, 1, 0)),
        3.5,
        0x5ce6ff,
        100,
      );
      effects.ring(site.ship.root.position, 10, 0x5ce6ff, true, 1.2);
      emitComicEffect(scene, "clank", {
        position: site.ship.root.position.clone(),
        size: 7,
      });
      presentation.sound("special");
    } else if (id === "hero-sword") {
      for (let i = 0; i < 8; i++)
        effects.fireworks(
          summitPoint(
            -18 + Math.cos((i * Math.PI) / 4) * 9,
            9 + (i % 3) * 3,
            Math.sin((i * Math.PI) / 4) * 7,
          ),
          0x47dbff,
        );
    } else if (id === "planet-breaker") {
      const point = world.getBombPosition();
      effects.ring(point, 4, 0xff733b, true, 1.3);
      effects.burst(point, 2.5, 0xff733b, 100);
      emitComicEffect(scene, "thud", { position: point, size: 7 });
    } else if (id === "world-crack") {
      const crack = world.getPlanetImpact();
      effects.ring(crack, 50, 0xff733b, true, 2);
      effects.burst(crack, 17, 0xff733b, 160);
      emitComicEffect(scene, "boom", {
        position: crack,
        size: 10,
        soundVolume: 0.4,
      });
      presentation.flash(0.62);
      presentation.sound("explode");
      cameraRig.impact(1.2);
    } else if (id === "planet-burst") {
      presentation.flash(0.32);
      cameraRig.impact(1.1);
    } else if (id === "sudoers-burst") {
      effects.burst(enemyMech.getChest(), 6, 0xcd7954, 150);
    } else if (id === "reactor-cut" || id === "hero-frame") {
      effects.burst(heroMech.getChest(), 3.4, 0x5ce6ff, 110);
    } else if (id === "escape-boost") {
      effects.ring(summitPoint(0, 7), 15, 0x65dcff, true, 1.6);
    } else if (id === "forest-aftermath") {
      effects.sparks(
        RESCUE_SITE.boy.clone().add(vector(0, 0.6, 0)),
        0xff873c,
        18,
        vector(0, 1, 0),
      );
    } else if (id === "brondon-grief") {
      presentation.sound("hit");
    } else if (id === "fight") {
      presentation.sound("special");
      presentation.flash(0.25);
    } else if (id === "execution") {
      effects.burst(heroMech.getChest(), 3.5, FRAME_COLORS.enemy, 85);
      presentation.sound("explode");
      presentation.flash(0.18);
      cameraRig.impact(0.5);
    }
    if (id === "planet-burst" || id === "fireworks" || id === "five-cores")
      presentation.sound("explode");
    else if (
      id === "prime-beacon" ||
      id === "hero-sword" ||
      id === "hero-frame"
    )
      presentation.sound("special");
  }

  function engraveTrace(
    target: typeof heroMech,
    trace: BladeDamageTrace,
    tint: number = FRAME_COLORS.hero,
  ) {
    const point = (p: [number, number, number]) =>
      finaleBattlePoint(p[0], p[1], reachedSpace ? SPACE_ALTITUDE : 0).add(
        vector(-0.2425356 * p[2], 0, -0.9701425 * p[2]),
      );
    const from = point(trace.from),
      to = point(trace.to);
    target.markSlash(from, to);
    effects.slash(from, to, tint);
  }

  function consumeDirectorEvents() {
    for (const cue of director.drainCues())
      fireCue(cue.id, director.getState().phaseTime);
    for (const event of director.drainDuelEvents()) {
      const point = finaleBattlePoint(
        event.x,
        event.y,
        reachedSpace ? SPACE_ALTITUDE : 0,
      );
      if (event.kind === "launch") {
        const source = event.owner === "hero" ? heroMech : enemyMech;
        point.copy(
          event.attack === "missiles"
            ? source.getMuzzle()
            : source.getBlade().tip,
        );
        effects.sparks(
          point,
          FRAME_COLORS[event.owner],
          event.attack === "missiles" ? 6 : 12,
        );
        if (event.attack === "missiles") {
          const target = event.owner === "hero" ? enemyMech : heroMech;
          effects.muzzle(
            point,
            target.getChest().sub(point).normalize(),
            event.owner,
          );
        }
        if (event.attack === "overdrive") {
          const blade = source.getBlade();
          effects.slash(blade.base, blade.tip);
          effects.ring(point, 2.4, 0xe5faff, true, 0.3);
        }
        presentation.sound("launch");
      } else if (event.kind === "swing") {
        presentation.sound("special");
      } else if (event.kind === "parry") {
        effects.deflect(point, true, event.owner === "hero" ? "enemy" : "hero");
        emitComicEffect(scene, "clank", { position: point, size: 5.5 });
        presentation.sound("parry");
        cameraRig.impact(0.35);
      } else if (event.kind === "guard") {
        effects.deflect(
          point,
          false,
          event.owner === "hero" ? "enemy" : "hero",
        );
        presentation.sound("parry");
        cameraRig.impact(0.16);
      } else if (
        event.kind === "hit" ||
        event.kind === "guardBreak" ||
        event.kind === "cut"
      ) {
        effects.sparks(point, FRAME_COLORS[event.owner], 10);
        if (event.trace)
          engraveTrace(
            event.owner === "hero" ? enemyMech : heroMech,
            event.trace,
            FRAME_COLORS[event.owner],
          );
        if (event.kind === "guardBreak")
          effects.ring(point, 3.8, 0xc9827a, true, 0.35);
        presentation.sound(event.kind === "cut" ? "parry" : "hit");
        presentation.flash(event.kind === "guardBreak" ? 0.16 : 0.06);
        cameraRig.impact(event.kind === "guardBreak" ? 0.5 : 0.2);
      } else if (event.kind === "dash") {
        effects.ring(point, 2.6, FRAME_COLORS[event.owner], true, 0.3);
      } else if (event.kind === "special") {
        effects.ring(point, 2.8, FRAME_COLORS[event.owner], true, 0.5);
        if (event.attack === "orbitalCut") {
          effects.ring(enemyMech.getChest(), 7, FRAME_COLORS.enemy, true, 1.25);
          effects.sparks(enemyMech.getBlade().tip, FRAME_COLORS.enemy, 24);
        }
        presentation.sound("special");
      } else if (event.kind === "rupture") {
        effects.ring(point, 15, 0xff6b40, true, 1.6);
        effects.burst(point, 6, 0xff7246, 140);
        emitComicEffect(scene, "boom", { position: point, size: 12 });
        presentation.sound("explode");
        cameraRig.impact(0.8);
      } else if (event.kind === "lost") {
        effects.burst(point, 4, 0xff4a65, 100);
        emitComicEffect(scene, "boom", { position: point, size: 8 });
        presentation.sound("explode");
      } else if (event.kind === "tell") {
        presentation.sound("special");
      }
    }
  }

  function showDialogue(phase: FinalePhase, phaseTime: number) {
    if (phase === "finisher") {
      const { beat, clock } = sampleFinisherSequence(phaseTime);
      const lines: Record<
        FinisherBeat["shot"],
        { speaker: string; text: string; start: number; end: number }
      > = {
        evade: {
          speaker: "PRIME",
          text: "Stay with me, Brondon!",
          start: 0,
          end: 1.9,
        },
        parry: {
          speaker: "SUDOERS 5",
          text: "Nowhere left to run.",
          start: 0,
          end: 1.5,
        },
        countershot: {
          speaker: "BRONDON",
          text: "Then I'll stop running.",
          start: 0.1,
          end: 2.6,
        },
        clash: {
          speaker: "SUDOERS 5",
          text: "You still resist?!",
          start: 0.1,
          end: 1.9,
        },
        exchange: {
          speaker: "BRONDON",
          text: "I'm not done.",
          start: FINISHER_EXCHANGE.circleEnd + 0.12,
          end: FINISHER_EXCHANGE.breakEnd - 0.06,
        },
        armCut: {
          speaker: "BRONDON",
          text: "He is not yours!",
          start: 0,
          end: 1.5,
        },
        ascend: {
          speaker: "SUDOERS 5",
          text: "We will erase you!",
          start: 0,
          end: 1.5,
        },
        reactor: {
          speaker: "PRIME",
          text: "All limiters released. Finish it.",
          start: 0,
          end: 2.2,
        },
        finalCut: {
          speaker: "BRONDON",
          text: "Donus. Come home.",
          start: 3.6,
          end: 5.5,
        },
      };
      const cue = lines[beat.shot];
      presentation.dialogue(
        cue.speaker,
        clock >= cue.start && clock < cue.end ? cue.text : "",
      );
      return;
    }
    const line = LINES[phase]?.find(
      (item) => phaseTime >= item.start && phaseTime < item.end,
    );
    presentation.dialogue(line?.speaker ?? "", line?.text ?? "");
  }

  function updateObjective(phase: FinalePhase, phaseTime: number) {
    if (phase === "loading")
      presentation.objective(
        "FINAL CHAPTER / THE LAST LIGHT",
        "Loading the command deck...",
      );
    else if (phase === "error")
      presentation.objective(
        "FINAL CHAPTER / THE LAST LIGHT",
        "The scene could not be prepared. Retry to load it again.",
      );
    else if (phase === "reveal")
      presentation.objective(
        "FACILITY SUMMIT / FIVE SIGNATURES",
        "Hold Enter to skip the reveal",
      );
    else if (phase === "enemyTransform")
      presentation.objective(
        "FINAL VERDICT / FIVE CORES, ONE FRAME",
        "Sudoers 5 is combining their power",
      );
    else if (phase === "heroTransform")
      presentation.objective(
        "PRIME FRAME / SHUTTLE RECALL",
        "The shuttle is flying in from the jungle",
      );
    else if (phase === "versus")
      presentation.objective(
        "FINAL CHAPTER / MATCHUP",
        "Prime Frame versus Final Verdict",
      );
    else if (phase === "ground")
      presentation.objective("THE SUMMIT", "Hold R to block");
    else if (phase === "rupture")
      presentation.objective(
        "PLANETARY COLLAPSE / ESCAPE",
        "Boost with Prime. The fight is not over.",
      );
    else if (phase === "space")
      presentation.objective("LAST ORBIT", "Hold R to block");
    else if (phase === "finisher") presentation.objective("LAST LIGHT", "");
    else if (phase === "defeat")
      presentation.objective(
        "SIGNAL LOST / BRONDON DOWN",
        "The last checkpoint is available after the death scene",
      );
    else if (phase === "victory")
      presentation.objective(
        "THE LAST LIGHT / DONUS RESTORED",
        "The Final Verdict has been defeated",
      );
    else if (phase === "credits")
      presentation.objective("BRONDON’S REVENGE", "A final light remains");
    else if (phase === "done")
      presentation.objective("THE END", "Thank you for playing");

    if (phase === "reveal" && phaseTime >= FINALE_REVEAL.renounceEnd)
      presentation.title("SUDOERS 5");
    else if (phase === "enemyTransform" && phaseTime >= FACILITY_ROOF_SEQUENCE.lock)
      presentation.title("FINAL VERDICT");
    else if (phase === "heroTransform" && phaseTime >= 14.2)
      presentation.title("PRIME FRAME");
    else if (
      phase === "rupture" &&
      phaseTime >= PLANET_RUPTURE.raise &&
      phaseTime < PLANET_RUPTURE.release + 0.4
    )
      presentation.title("PLANET BREAKER");
    else if (
      phase === "rupture" &&
      phaseTime >= PLANET_RUPTURE.burst &&
      phaseTime < PLANET_RUPTURE.burst + 0.9
    )
      presentation.title("BOOM!");
    else if (
      (phase === "space" || phase === "ground") &&
      director.duel.getState().special?.cinematic
    ) {
      const special = director.duel.getState().special!;
      presentation.title(
        isNamedSpecialMove(special.kind)
          ? SPECIAL_MOVE_NAMES[special.kind]
          : "",
      );
    } else if (phase === "victory" && phaseTime >= 14)
      presentation.title("THE END");
    else if (phase === "credits" || phase === "done") presentation.title("");
    else presentation.title("");
  }

  function updateFinisherEffects(
    sample: ReturnType<typeof sampleFinisherSequence>,
  ) {
    const { clock, beat, index } = sample;
    if (index !== finisherEffectIndex) {
      finisherEffectIndex = index;
      finisherEffectClock = -1;
      lastExecutionCut = -1;
      cinematicProjectiles.forEach((projectile) => {
        projectile.active = false;
      });
    }
    const crossed = (at: number) => finisherEffectClock < at && clock >= at;
    const action = finisherActionTime(beat);
    if (beat.shot === "evade" && crossed(action - 0.3)) {
      const muzzle = enemyMech.getBlade().tip.clone();
      const target = finaleBattlePoint(-14, 8.6, SPACE_ALTITUDE);
      const projectile = cinematicProjectiles[0];
      projectile.active = true;
      projectile.owner = "enemy";
      projectile.kind = "verdictBeam";
      projectile.start.copy(muzzle);
      projectile.end
        .copy(target)
        .addScaledVector(target.clone().sub(muzzle).normalize(), 20);
      projectile.delay = action - 0.3;
      projectile.duration = 0.42;
      effects.sparks(enemyMech.getBlade().tip, FRAME_COLORS.enemy, 18);
      presentation.sound("launch");
    }
    if ((beat.shot === "parry" || beat.shot === "clash") && crossed(action)) {
      effects.sparks(clashContact, 0xffdf9e, 28);
      effects.ring(clashContact, 1.4, FRAME_COLORS.hero, true, 0.2);
      presentation.sound("parry");
      cameraRig.impact(0.26);
    } else if (beat.shot === "armCut" && crossed(action + 0.04)) {
      const chest = enemyMech.getChest();
      const from = chest.clone().add(vector(-3.4, 2.1, 1)),
        to = chest.clone().add(vector(3.1, -2.2, 1));
      enemyMech.markSlash(from, to);
      effects.slash(from, to);
      effects.sparks(chest, FRAME_COLORS.hero, 24);
      presentation.sound("hit");
      cameraRig.impact(0.22);
    }
    if (beat.shot === "exchange") {
      for (const [i, cut] of FINISHER_EXCHANGE.cuts.entries()) {
        if (!cut.contact || !crossed(cut.hit)) continue;
        effects.swordClash(clashContact, i % 2 ? FRAME_COLORS.enemy : FRAME_COLORS.hero);
        presentation.sound("parry");
        cameraRig.impact(
          i === FINISHER_EXCHANGE.cuts.length - 1 ? 0.65 : 0.45,
        );
      }
    }
    if (beat.shot === "countershot") {
      for (let i = 0; i < 5; i++) {
        const fire = FINISHER_RIFLE.fire + i * FINISHER_RIFLE.spacing;
        if (crossed(fire)) {
          const projectile = cinematicProjectiles[i],
            muzzle = heroMech.getMuzzle(),
            target = enemyMech.getChest();
          projectile.active = true;
          projectile.owner = "hero";
          projectile.kind = "round";
          projectile.start.copy(muzzle);
          projectile.end.copy(target);
          projectile.delay = fire;
          projectile.duration = 0.22;
          effects.muzzle(
            muzzle,
            target.clone().sub(muzzle).normalize(),
            "hero",
          );
          presentation.sound("launch");
        }
        if (crossed(fire + 0.22)) {
          effects.sparks(cinematicProjectiles[i].end, 0xd2e9ee, 10);
          presentation.sound("hit");
          cameraRig.impact(0.045);
        }
      }
    }
    if (beat.shot === "finalCut") {
      const timing = FINISHER_EXECUTION;
      if (crossed(timing.dash)) {
        effects.ring(heroMech.getChest(), 4.2, FRAME_COLORS.hero, true, 0.4);
        presentation.sound("launch");
      }
      if (crossed(timing.vanish)) {
        const blade = enemyMech.getBlade();
        const wave = cinematicProjectiles[0];
        wave.active = true;
        wave.owner = "enemy";
        wave.kind = "bladeWave";
        wave.start.copy(blade.tip);
        wave.end.copy(finaleBattlePoint(-38, 9, SPACE_ALTITUDE));
        wave.delay = timing.vanish;
        wave.duration = timing.appear - timing.vanish + 0.15;
        effects.slash(blade.base, blade.tip, FRAME_COLORS.enemy);
        effects.ring(enemyMech.getChest(), 4.5, FRAME_COLORS.enemy, true, 0.4);
        effects.teleport(heroMech.root.position, false);
        heroTrail.clear();
        presentation.sound("special");
      }
      if (crossed(timing.appear)) {
        effects.teleport(heroMech.root.position, true);
        presentation.sound("special");
      }
      if (clock >= timing.cuts) {
        const count = Math.min(
          timing.slashes - 1,
          Math.floor(
            ((clock - timing.cuts) / (timing.lastCut - timing.cuts)) *
              timing.slashes,
          ),
        );
        for (let i = lastExecutionCut + 1; i <= count; i++) {
          const reverse = i % 3 === 0,
            height = 4.5 + (i % 9);
          const from = enemyMech.root.localToWorld(
            vector(-3.3, reverse ? 14 : height, 2.1),
          );
          const to = enemyMech.root.localToWorld(
            vector(3.3, reverse ? 4 + (i % 4) : 14 - (i % 8), 2.1),
          );
          enemyMech.markSlash(from, to);
          effects.slash(from, to);
          effects.sparks(from.clone().lerp(to, 0.5), 0xd5edf1, 7);
          if (i % 4 === 0) {
            presentation.sound("hit");
            presentation.flash(0.035);
            cameraRig.impact(0.065);
          }
        }
        lastExecutionCut = Math.max(lastExecutionCut, count);
      }
      if (crossed(timing.lastCut)) {
        const chest = enemyMech.getChest();
        for (const sign of [-1, 1])
          effects.slash(
            chest.clone().add(vector(-10, sign * 7, 2)),
            chest.clone().add(vector(10, -sign * 7, 2)),
            0xe8fcff,
          );
        effects.ring(chest, 5, FRAME_COLORS.hero, true, 0.4);
        presentation.flash(0.12);
        cameraRig.impact(0.32);
      }
      if (crossed(timing.collapse)) {
        effects.burst(enemyMech.getChest(), 3.2, 0xb66e50, 65);
        presentation.sound("explode");
        cameraRig.impact(0.4);
      }
      if (sample.speed > 0)
        effects.speedStreaks(
          heroMech.getChest(),
          enemyMech.getChest().sub(heroMech.getChest()),
          sample.speed * 2,
          director.getState().time,
        );
    }
    finisherEffectClock = clock;
  }

  function updateActors(phase: FinalePhase, phaseTime: number, time: number) {
    const inMechScene =
      phase === "enemyTransform" ||
      phase === "heroTransform" ||
      phase === "versus" ||
      phase === "ground" ||
      phase === "rupture" ||
      phase === "space" ||
      phase === "finisher" ||
      phase === "defeat" ||
      phase === "victory" ||
      phase === "credits" ||
      phase === "done";
    const duel = director.duel,
      hero = duel.hero,
      enemy = duel.enemy;
    const duelState = duel.getState();
    const baseY = FINALE_DECK_Y + (reachedSpace ? SPACE_ALTITUDE : 0);
    let heroX = hero.x,
      heroY = baseY + hero.y,
      enemyX = enemy.x,
      enemyY = baseY + enemy.y;
    if (phase === "enemyTransform" || phase === "heroTransform") {
      heroX = -FINALE_START_X;
      heroY = FINALE_DECK_Y;
      enemyX = FINALE_START_X;
      enemyY = FINALE_DECK_Y;
    } else if (phase === "rupture") {
      const lift =
        smooth(phaseTime, PLANET_RUPTURE.escape, PLANET_RUPTURE.orbit) *
        SPACE_ALTITUDE;
      const jump = cinematicProgress(
        phaseTime,
        PLANET_RUPTURE.jump,
        PLANET_RUPTURE.land,
      );
      const settle = cinematicProgress(
        phaseTime,
        PLANET_RUPTURE.returnToDuel,
        PLANET_RUPTURE.orbit,
      );
      heroX = THREE.MathUtils.lerp(hero.x, -FINALE_START_X, settle);
      enemyX = THREE.MathUtils.lerp(
        enemy.x - enemy.facing * jump * 7.5,
        FINALE_START_X,
        settle,
      );
      heroY = FINALE_DECK_Y + lift + hero.y * (1 - settle);
      enemyY =
        FINALE_DECK_Y +
        lift +
        enemy.y * (1 - settle) +
        Math.sin(jump * Math.PI) * 5.4;
    } else if (phase === "reveal" || phase === "loading" || phase === "error") {
      heroX = -FINALE_START_X;
      heroY = FINALE_DECK_Y;
      enemyX = FINALE_START_X;
      enemyY = FINALE_DECK_Y;
    }

    heroMech.root.visible =
      inMechScene &&
      phase !== "enemyTransform" &&
      (phase !== "heroTransform" || phaseTime >= HERO_TRANSFORM.materialize);
    enemyMech.root.visible =
      inMechScene &&
      (phase !== "enemyTransform" ||
        phaseTime >= FACILITY_ROOF_SEQUENCE.transformStart);
    heroMech.root.position.copy(
      finaleBattlePoint(heroX, heroY - FINALE_DECK_Y),
    );
    enemyMech.root.position.copy(
      finaleBattlePoint(enemyX, enemyY - FINALE_DECK_Y),
    );
    const combat = phase === "ground" || phase === "space";
    for (const [mech, fighter, opponent, defaultFacing] of [
      [heroMech, hero, enemy, 1],
      [enemyMech, enemy, hero, -1],
    ] as const) {
      let facing = combat ? fighter.facing : defaultFacing;
      const dodge =
        combat && fighter.dash
          ? sampleDodgeArc(
              fighter.time,
              fighter.duration,
              fighter.dash.crossing,
              fighter.dash.offset,
            )
          : null;
      if (dodge) {
        if (fighter.move === "slide") {
          dodge.lift = 0;
          dodge.roll = 0;
        }
        mech.root.position.add(
          vector(dodge.lane * 0.2425356, dodge.lift, dodge.lane * 0.9701425),
        );
        if (
          fighter.move !== "slide" &&
          fighter.dash?.crossing &&
          dodge.progress > 0.5
        )
          facing = Math.sign(opponent.x - fighter.x) || facing;
      }
      const yaw = FINALE_BATTLE_YAW + (facing < 0 ? Math.PI : 0);
      const turn = Math.atan2(
        Math.sin(yaw - mech.root.rotation.y),
        Math.cos(yaw - mech.root.rotation.y),
      );
      mech.root.rotation.set(
        0,
        combat && animationDelta > 0
          ? mech.root.rotation.y + turn * (1 - Math.exp(-animationDelta * 12))
          : yaw,
        dodge ? -fighter.facing * dodge.roll : 0,
      );
      if (combat && fighter.move === "knockdown") {
        const down =
          cinematicProgress(fighter.time, 0, 0.35) *
          (1 -
            cinematicProgress(
              fighter.time,
              Math.max(0.35, fighter.duration - 0.5),
              fighter.duration,
            ));
        mech.root.position.y -= down * 2.1;
        mech.root.rotateZ(-fighter.facing * down * 1.18);
      }
      mech.setMotion(fighter.vx * fighter.facing, fighter.vy);
    }
    if (
      endingEntry &&
      (phase === "defeat" ||
        phase === "victory" ||
        phase === "credits" ||
        phase === "done")
    ) {
      heroMech.root.position.copy(endingEntry.hero);
      enemyMech.root.position.copy(endingEntry.enemy);
      heroMech.root.quaternion.copy(endingEntry.heroRotation);
      enemyMech.root.quaternion.copy(endingEntry.enemyRotation);
      if (phase === "defeat") {
        const collapse = cinematicProgress(phaseTime, 0.4, 3.7);
        heroMech.root.position.y -= collapse * (reachedSpace ? 7 : 2);
        heroMech.root.rotateZ(-collapse * 0.65);
      } else
        enemyMech.root.position.y -= cinematicProgress(phaseTime, 0, 3) * 2.2;
    }

    let heroAssembly = 1,
      enemyAssembly = 1,
      heroScale = 1,
      enemyScale = 1;
    if (phase === "enemyTransform") {
      enemyAssembly = smooth(
        phaseTime,
        FACILITY_ROOF_SEQUENCE.transformStart,
        FACILITY_ROOF_SEQUENCE.assemblyEnd,
      );
      enemyScale = 0.06 + enemyAssembly * 0.94;
    } else if (phase === "heroTransform") {
      heroAssembly = smooth(
        phaseTime,
        HERO_TRANSFORM.materialize,
        HERO_TRANSFORM.assembled,
      );
      heroScale = 0.06 + heroAssembly * 0.94;
    }
    heroMech.root.scale.setScalar(heroScale);
    enemyMech.root.scale.setScalar(enemyScale);
    heroMech.setAssembly(heroAssembly);
    enemyMech.setAssembly(enemyAssembly);

    const choreography =
      phase === "finisher" ? sampleFinisherSequence(phaseTime) : null;
    let heroMove: MechPoseName = hero.move;
    let enemyMove: MechPoseName = enemy.move;
    if (phase === "enemyTransform") enemyMove = "transform";
    else if (phase === "heroTransform") heroMove = "transform";
    else if (phase === "rupture") {
      heroMove = phaseTime < PLANET_RUPTURE.escape ? "guard" : "boost";
      enemyMove =
        phaseTime < PLANET_RUPTURE.jump
          ? "verdict"
          : phaseTime < PLANET_RUPTURE.land
            ? "boost"
            : phaseTime < PLANET_RUPTURE.escape + 0.5
              ? "bomb"
              : "boost";
      if (phaseTime >= PLANET_RUPTURE.returnToDuel - 0.7) {
        heroMove = enemyMove = "hover";
        heroMech.setMotion(0, 0);
        enemyMech.setMotion(0, 0);
      }
    } else if (choreography) {
      heroMove = choreography.heroPose;
      enemyMove = choreography.enemyPose;
      // Root motion is already choreographed; a second velocity-driven lean fights those poses.
      heroMech.setMotion(0, 0);
      enemyMech.setMotion(0, 0);
      heroMech.root.position
        .copy(
          finaleBattlePoint(
            choreography.hero[0],
            choreography.hero[1],
            SPACE_ALTITUDE,
          ),
        )
        .add(vector(0, 0, choreography.hero[2]));
      enemyMech.root.position
        .copy(
          finaleBattlePoint(
            choreography.enemy[0],
            choreography.enemy[1],
            SPACE_ALTITUDE,
          ),
        )
        .add(vector(0, 0, choreography.enemy[2]));
      heroMech.root.rotation.z = choreography.heroRoll;
      enemyMech.root.rotation.z = choreography.enemyRoll;
      enemyMech.root.rotation.x = choreography.enemyPitch;
      heroMech.root.rotateY(choreography.heroYaw);
      enemyMech.root.rotateY(choreography.enemyYaw);
      if (choreography.travel) {
        const axis = enemyMech.root.position.clone().sub(heroMech.root.position);
        const angle = Math.atan2(axis.x, axis.z) - FINALE_BATTLE_YAW;
        const turn = Math.atan2(Math.sin(angle), Math.cos(angle)) * choreography.travel.weight;
        heroMech.root.rotation.y = FINALE_BATTLE_YAW + turn;
        enemyMech.root.rotation.y = FINALE_BATTLE_YAW + Math.PI + turn;
      }
      heroMech.root.visible = choreography.heroVisible;
      if (finisherEntry && phaseTime < 0.35) {
        const entry = cinematicProgress(phaseTime, 0, 0.35);
        heroMech.root.position.lerpVectors(
          finisherEntry.hero,
          heroMech.root.position.clone(),
          entry,
        );
        enemyMech.root.position.lerpVectors(
          finisherEntry.enemy,
          enemyMech.root.position.clone(),
          entry,
        );
        heroMech.root.quaternion.slerpQuaternions(
          finisherEntry.heroRotation,
          heroMech.root.quaternion.clone(),
          entry,
        );
        enemyMech.root.quaternion.slerpQuaternions(
          finisherEntry.enemyRotation,
          enemyMech.root.quaternion.clone(),
          entry,
        );
      }
    } else if (phase === "victory" || phase === "credits" || phase === "done") {
      const victoryTime =
        phase === "victory" ? phaseTime : FINALE_DURATION.victory + phaseTime;
      heroMove =
        phase === "credits" ||
        phase === "done" ||
        (phaseTime >= DONUS_RETURN.dance && phaseTime < DONUS_RETURN.appear)
          ? "dance"
          : phaseTime < DONUS_RETURN.dance
            ? "afterCut"
            : "victory";
      const turn = cinematicProgress(
        victoryTime,
        DONUS_RETURN.dance - 0.5,
        DONUS_RETURN.dance + 0.3,
      );
      heroMech.root.quaternion.slerp(new THREE.Quaternion(), turn);
      enemyMove = "defeat";
    } else if (phase === "defeat") {
      heroMove = "defeat";
      enemyMove = phaseTime < 2.6 ? "verdict" : "afterCut";
    } else if (phase === "error" || phase === "loading" || phase === "reveal") {
      heroMove = "idle";
      enemyMove = "idle";
    }

    const cinematicDuration = (move: MechPoseName) =>
      isMeleeStrike(move)
        ? MELEE_STRIKES[move].duration
        : move === "missiles"
          ? RIFLE_SEQUENCE.swordReady
          : move === "verdict"
            ? ENEMY_VERDICT.duration
            : 1;
    const heroDuration = choreography
      ? cinematicDuration(heroMove)
      : phase === "heroTransform"
        ? 17
        : phase === "rupture"
          ? 4.2
          : Math.max(0.1, hero.duration || 1);
    const enemyDuration = choreography
      ? cinematicDuration(enemyMove)
      : phase === "enemyTransform"
        ? FACILITY_ROOF_SEQUENCE.end
        : phase === "rupture"
          ? PLANET_RUPTURE.escape + 0.5
          : Math.max(0.1, enemy.duration || 1);
    const heroPoseTime = choreography
      ? choreography.heroPoseProgress * heroDuration
      : phase === "heroTransform" || phase === "rupture"
        ? phaseTime
        : phase === "victory" || phase === "defeat"
          ? phaseTime
          : hero.time;
    const enemyPoseTime = choreography
      ? choreography.enemyPoseProgress * enemyDuration
      : phase === "enemyTransform" || phase === "rupture"
        ? phaseTime
        : phase === "victory" || phase === "credits" || phase === "done"
          ? enemyDuration
          : phase === "defeat"
            ? phaseTime
            : enemy.time;
    heroMech.setDamage(1 - hero.health / DUEL.heroHealth);
    enemyMech.setDamage(1 - enemy.health / DUEL.health);
    const cockpitExitDissolve =
      phase === "rupture" && phaseTime >= PLANET_RUPTURE.cockpit
        ? 1 -
          cinematicProgress(
            phaseTime,
            PLANET_RUPTURE.returnToDuel + 0.65,
            PLANET_RUPTURE.orbit - 0.2,
          )
        : 0;
    heroMech.setDissolve(
      choreography?.heroDissolve ??
        (phase === "defeat"
          ? (endingEntry?.heroDissolve ?? 0) *
              (1 - cinematicProgress(phaseTime, 0, 0.5)) +
            smooth(phaseTime, 2.1, 5.4)
          : 0),
    );
    if (phase === "rupture") heroMech.setDissolve(cockpitExitDissolve);
    enemyMech.setDissolve(
      phase === "victory"
        ? smooth(phaseTime, 2.8, 5.8)
        : phase === "credits" || phase === "done"
          ? 1
          : 0,
    );
    const custom = !!choreography || phase === "rupture" || phase === "defeat";
    heroMech.setGuarding(combat && duelState.guarding);
    enemyMech.setGuarding(combat && duelState.enemyGuarding);
    const travelPose = (side: "hero" | "enemy") => {
      if (!choreography?.travel) return undefined;
      const velocity = choreography.travel[side];
      return {
        velocity: vector(velocity[0] * 0.9701425, velocity[1], velocity[2] - velocity[0] * 0.2425356),
        clock: choreography.clock,
        weight: choreography.travel.weight,
      };
    };
    heroMech.pose(
      heroMove,
      heroPoseTime,
      heroDuration,
      phase === "rupture" || reachedSpace || hero.y > 1,
      hero.combo,
      time,
      custom,
      `${phase}-${choreography?.beat.id ?? hero.dash?.from ?? ""}${choreography?.exchange ? `-${choreography.exchange.index}` : ""}`,
      travelPose("hero"),
    );
    enemyMech.pose(
      enemyMove,
      enemyPoseTime,
      enemyDuration,
      phase === "rupture" || reachedSpace || enemy.y > 1,
      0,
      time,
      custom,
      `${phase}-${choreography?.beat.id ?? enemy.dash?.from ?? ""}${choreography?.exchange ? `-${choreography.exchange.index}` : ""}`,
      travelPose("enemy"),
    );
    if (choreography) enemyMech.applyCrouch(choreography.enemyCrouch);
    const enemyChest = enemyMech.getChest(),
      heroChest = heroMech.getChest();
    heroMech.watch(
      enemyChest,
      heroMove === "afterCut" ||
        heroMove === "skyCharge" ||
        heroMove === "dance"
        ? 0
        : 0.35,
    );
    enemyMech.watch(heroChest, enemyMove === "defeat" ? 0 : 0.55);
    const heroAim =
      combat && hero.aimLocked
        ? finaleBattlePoint(
            hero.aimX,
            hero.aimY,
            reachedSpace ? SPACE_ALTITUDE : 0,
          )
        : enemyChest;
    const enemyAim =
      combat && enemy.aimLocked
        ? finaleBattlePoint(
            enemy.aimX,
            enemy.aimY,
            reachedSpace ? SPACE_ALTITUDE : 0,
          )
        : heroChest;
    heroMech.aimGun(heroAim);
    enemyMech.aimGun(enemyAim);
    if (enemyMove === "verdict") enemyMech.pointSwordAt(enemyAim);
    if (choreography && choreography.bladeLock > 0) {
      const contactNormal = choreography.exchange
        ? new THREE.Vector3().crossVectors(
            enemyMech.root.position.clone().sub(heroMech.root.position).setY(0).normalize(),
            vector(0, 1, 0),
          ).normalize()
        : vector(0, 0, 1);
      clashContact
        .copy(heroChest)
        .lerp(enemyChest, 0.5)
        .add(vector(0, choreography.exchange?.height ?? 1.6, 0))
        .addScaledVector(contactNormal, 2.2 + (choreography.exchange?.depth ?? 0));
      const strain = Math.sin(choreography.progress * Math.PI) * 0.04;
      heroMech.lockBlade(clashContact, 1, strain, choreography.bladeLock);
      enemyMech.lockBlade(clashContact, -1, -strain, choreography.bladeLock);
      const spark = Math.floor(phaseTime * 8);
      if (!choreography.exchange && choreography.bladeLock > 0.95 && spark !== lastClashSpark) {
        lastClashSpark = spark;
        effects.sparks(
          clashContact,
          0xffe4ad,
          choreography.beat.shot === "clash" ? 16 : 8,
        );
        if (spark % 4 === 0) presentation.sound("parry");
      }
    } else lastClashSpark = -1;
    world.updateBomb(
      phase === "rupture" ? phaseTime : -1,
      enemyMech.getHand("left").lerp(enemyMech.getHand("right"), 0.5),
    );
    const heroCharge =
      choreography?.heroCharge ??
      (heroMove === "overdrive"
        ? cinematicProgress(hero.time, 0.15, HERO_ULTIMATE.cameraEnd) *
          (1 -
            cinematicProgress(
              hero.time,
              HERO_ULTIMATE.release,
              HERO_ULTIMATE.release + 0.2,
            ))
        : 0);
    const enemySpecialTiming =
      enemyMove === "orbitalCut" ? ENEMY_ORBITAL_CUT : ENEMY_VERDICT;
    const enemyCharge =
      enemyMove === "verdict" || enemyMove === "orbitalCut"
        ? cinematicProgress(enemyPoseTime, 0, enemySpecialTiming.cameraEnd) *
          (1 -
            cinematicProgress(
              enemyPoseTime,
              enemySpecialTiming.release,
              enemySpecialTiming.release + 0.2,
            ))
        : 0;
    heroMech.setBladeCharge(heroCharge);
    enemyMech.setBladeCharge(enemyCharge);
    effects.aura(
      enemyMech.root.position.clone().add(vector(0, 8, 0)),
      enemyMech.root.visible
        ? phase === "enemyTransform"
          ? 0.7
          : phase === "victory" || phase === "credits"
            ? 0
            : 0.16 + enemyCharge * 0.35
        : 0,
      time,
    );

    const visiblePilot =
      phase === "reveal" ||
      phase === "enemyTransform" ||
      (phase === "heroTransform" && phaseTime < HERO_TRANSFORM.pilotMerge);
    if (phase === "reveal") {
      const walk = smooth(phaseTime, 0, FINALE_REVEAL.walkEnd);
      const position = officePoint(0, 0.32, THREE.MathUtils.lerp(8, 6, walk));
      player.setPosition(position.x, position.y, position.z);
      player.setRotation(0, 0);
    } else if (phase === "enemyTransform") {
      const lift = sampleFacilityLift(phaseTime);
      const position = vector(FACILITY.x, lift.y + 0.32, FACILITY.z + 6);
      player.setPosition(position.x, position.y, position.z);
      player.setRotation(0, 0);
    } else if (
      phase === "heroTransform" &&
      phaseTime < HERO_TRANSFORM.pilotMerge
    ) {
      const progress = smooth(
        phaseTime,
        HERO_TRANSFORM.arrival - 0.3,
        HERO_TRANSFORM.pilotMerge,
      );
      const start = summitPoint(0, 0.32, 6);
      const end = heroMech.root.position.clone().add(vector(0, 2.8, 0.4));
      const position = start.lerp(end, progress);
      position.y += Math.sin(progress * Math.PI) * 2.4;
      player.setPosition(position.x, position.y, position.z);
      player.setRotation(FINALE_BATTLE_YAW, 0);
    }
    if (!visiblePilot) {
      player.setPosition(
        heroMech.root.position.x,
        heroMech.root.position.y + 8,
        heroMech.root.position.z,
      );
    }

    updateStudentReveal(phase, phaseTime);
    const heroBlade = heroMech.getBlade();
    const enemyBlade = enemyMech.getBlade();
    const trailActive = (move: MechPoseName, poseTime: number) =>
      isMeleeStrike(move)
        ? sampleMeleeBlade(move, poseTime).active
        : move === "overdrive" &&
          poseTime >= HERO_ULTIMATE.cameraEnd &&
          poseTime <= HERO_ULTIMATE.release + 0.1;
    const rapidExchange = !!choreography?.exchange;
    const eclipseCounter = !!choreography && enemyMove === "orbitalCut";
    const trailPower = reducedMotion ? 0.03 : 0.09;
    heroTrail.update(
      heroBlade.base,
      heroBlade.tip,
      animationDelta,
      heroMech.root.visible &&
        (!combat || !duelState.guarding) &&
        (choreography?.exchange
          ? choreography.exchange.heroTrail
          : trailActive(heroMove, heroPoseTime)),
      rapidExchange ? trailPower : 0,
    );
    enemyTrail.update(
      enemyBlade.base,
      enemyBlade.tip,
      animationDelta,
      enemyMech.root.visible &&
        (choreography?.exchange
          ? choreography.exchange.enemyTrail
          : trailActive(enemyMove, enemyPoseTime)),
      rapidExchange ? trailPower : eclipseCounter ? (reducedMotion ? 0.1 : 0.65) : 0,
    );
    effects.chargeBlade(heroBlade.base, heroBlade.tip, heroCharge, time);
    const clash = choreography && choreography.bladeLock > 0.95;
    effects.beam(
      "hero",
      clashContact.clone().add(vector(0, -0.4, 0)),
      clashContact.clone().add(vector(0, 0.4, 0)),
      clash ? (rapidExchange ? 0.08 : 0.25 + Math.sin(time * 30) * 0.08) : 0,
      time,
    );
    effects.beam(
      "enemy",
      enemyBlade.tip,
      heroChest,
      phase === "defeat" && phaseTime >= 1.6 && phaseTime < 2.15 ? 0.3 : 0,
      time,
    );
    if (choreography) updateFinisherEffects(choreography);
  }

  function projectileStyle(
    visual: (typeof missilePool)[number],
    owner: "hero" | "enemy",
    kind: DuelProjectileKind,
  ) {
    visual.body.material = missileMaterials[owner];
    visual.nose.material = missileMaterials[owner];
    visual.flame.material = flameMaterials[owner];
    visual.tracer.material = tracerMaterials[owner];
    visual.beam.material = verdictMaterials[owner];
    visual.beamGlow.material = verdictGlows[owner];
    visual.edge.material = owner === "enemy" ? enemyWaveMaterial : waveMaterial;
    visual.glow.material = owner === "enemy" ? enemyWaveGlowMaterial : waveGlowMaterial;
    visual.wake.material = owner === "enemy" ? enemyWaveWakeMaterial : waveWakeMaterial;
    visual.tail.material = visual.wake.material;
    visual.body.visible =
      visual.nose.visible =
      visual.flame.visible =
      visual.tracer.visible =
        kind === "round";
    visual.wave.visible = kind === "bladeWave";
    visual.beam.visible = kind === "verdictBeam";
  }

  function updateMissiles(phase: FinalePhase) {
    for (const material of [enemyWaveMaterial, enemyWaveGlowMaterial, enemyWaveWakeMaterial]) {
      material.uniforms.uTime.value = director.getState().time;
    }
    Object.values(verdictGlows).forEach((material) => {
      material.uniforms.uTime.value = director.getState().time;
    });
    Object.values(tracerMaterials).forEach((material) => {
      material.uniforms.uTime.value = director.getState().time;
    });
    if (phase === "finisher") {
      const { clock } = sampleFinisherSequence(director.getState().phaseTime);
      missilePool.forEach((visual, i) => {
        const projectile = cinematicProjectiles[i];
        if (!projectile?.active) {
          visual.root.visible = false;
          return;
        }
        const flight = (clock - projectile.delay) / projectile.duration;
        visual.root.visible = flight >= 0 && flight <= 1;
        if (!visual.root.visible) return;
        projectileStyle(visual, projectile.owner, projectile.kind);
        visual.root.position.lerpVectors(
          projectile.start,
          projectile.end,
          flight,
        );
        missileDirection.copy(projectile.end).sub(projectile.start).normalize();
        visual.root.quaternion.setFromUnitVectors(
          vector(0, 1, 0),
          missileDirection,
        );
        visual.root.scale.setScalar(1);
        visual.wave.rotation.y = Math.sin(flight * Math.PI) * 0.05;
        visual.wave.scale.setScalar(0.95 + Math.sin(flight * Math.PI) * 0.12);
        visual.beam.scale.y = 1;
        visual.flame.scale.setScalar(1.15);
        effects.projectile(
          visual.root.position,
          missileDirection,
          projectile.owner,
          director.getState().time,
          i,
        );
      });
      return;
    }
    const missiles = director.duel.missiles;
    missilePool.forEach((visual, i) => {
      const missile = missiles[i];
      if (!missile) {
        visual.root.visible = false;
        return;
      }
      const side = missile.owner;
      projectileStyle(visual, side, missile.kind);
      visual.beam.scale.y = 1;
      visual.root.visible = true;
      const owner = side === "hero" ? heroMech : enemyMech;
      const fighter =
        side === "hero" ? director.duel.hero : director.duel.enemy;
      const spawn = finaleBattlePoint(
        fighter.x +
          fighter.facing *
            (missile.kind === "round"
              ? 4.8
              : missile.kind === "bladeWave"
                ? 4.2
                : 13.2),
        fighter.y + (missile.kind === "bladeWave" ? 8.6 : 10.5),
        reachedSpace ? SPACE_ALTITUDE : 0,
      );
      const muzzle =
        missile.kind === "round"
          ? owner.getMuzzle()
          : owner.getBlade().tip.clone();
      const offset = muzzle
        .sub(spawn)
        .multiplyScalar(Math.max(0, 1 - missile.age / 0.12));
      visual.root.position
        .copy(
          finaleBattlePoint(
            missile.x,
            missile.y,
            reachedSpace ? SPACE_ALTITUDE : 0,
          ),
        )
        .add(offset);
      visual.root.scale.setScalar(
        missile.damage <= 0 ? Math.max(0.08, missile.life / 0.24) : 1,
      );
      missileDirection
        .set(missile.vx * 0.9701425, missile.vy, -missile.vx * 0.2425356)
        .normalize();
      visual.root.quaternion.setFromUnitVectors(
        vector(0, 1, 0),
        missileDirection,
      );
      visual.wave.rotation.y = Math.sin(missile.age * 4) * 0.08;
      visual.wave.scale.setScalar(0.85 + Math.min(0.25, missile.age * 0.6));
      visual.flame.scale.setScalar(0.55 + Math.sin(missile.age * 40) * 0.12);
      effects.projectile(
        visual.root.position,
        missileDirection,
        side,
        director.getState().time,
        i,
      );
    });
  }

  function updateHumanPose() {
    const { phaseTime, time } = director.getState();
    if (lastPhase === "reveal" && phaseTime < FINALE_REVEAL.walkEnd) {
      return {
        clip: "Walk_Loop",
        time: phaseTime,
        loop: true,
      } satisfies CinematicPose;
    }
    if (
      lastPhase === "reveal" &&
      phaseTime >= FINALE_REVEAL.studentEnd &&
      phaseTime < FINALE_REVEAL.studentEnd + 2.4
    ) {
      return {
        clip: "Hit_Chest",
        time: phaseTime - FINALE_REVEAL.studentEnd,
        duration: 2.4,
        loop: false,
        bodyPitch: -0.12,
      } satisfies CinematicPose;
    }
    if (lastPhase === "reveal" && phaseTime < FINALE_REVEAL.recognitionEnd) {
      return {
        clip: "Idle_Loop",
        time,
        loop: true,
        bodyPitch: -0.16,
      } satisfies CinematicPose;
    }
    if (lastPhase === "reveal" && phaseTime < FINALE_REVEAL.renounceEnd) {
      return {
        clip: "Idle_Loop",
        time,
        loop: true,
        bodyPitch: THREE.MathUtils.lerp(
          -0.16,
          0,
          smooth(
            phaseTime,
            FINALE_REVEAL.recognitionEnd,
            FINALE_REVEAL.renounceEnd,
          ),
        ),
      } satisfies CinematicPose;
    }
    return { clip: "Idle_Loop", time, loop: true } satisfies CinematicPose;
  }

  function updateEnvironment(
    phase: FinalePhase,
    phaseTime: number,
    time: number,
  ) {
    const inSpace = reachedSpace && phase !== "rupture";
    const aftermathState = samplePlanetAftermath(
      phase === "rupture" ? phaseTime : -1,
    );
    const roofBlast =
      phase === "enemyTransform"
        ? phaseTime
        : phase === "loading" || phase === "error" || phase === "reveal"
          ? -1
          : FACILITY_ROOF_SEQUENCE.liftEnd;
    terrestrial.visible =
      !inSpace &&
      (!(phase === "rupture" && phaseTime >= PLANET_RUPTURE.wide) ||
        aftermathState.forest);
    site.facilityDome.visible = terrestrial.visible;
    site.facilityDomeRings.visible = terrestrial.visible;
    site.updateRoofSequence(
      phase === "loading" || phase === "error" || phase === "reveal"
        ? -1
        : phase === "enemyTransform"
          ? phaseTime
          : FACILITY_ROOF_SEQUENCE.liftEnd,
    );
    for (const light of environmentLights)
      if (light instanceof THREE.DirectionalLight) {
        light.shadow.autoUpdate = terrestrial.visible;
      }
    const lightPower =
      phase === "loading" || phase === "error" || phase === "reveal"
        ? 1
        : phase === "enemyTransform"
          ? 0.5
          : 0.78;
    const night = sampleRooftopNight(phase, phaseTime);
    for (const [light, intensity] of environmentIntensity) {
      light.intensity =
        intensity *
        lightPower *
        (1 - night * (light instanceof THREE.DirectionalLight ? 0.84 : 0.35));
      light.color.copy(environmentColors.get(light)!).lerp(moonColor, night);
    }
    moon.intensity = night * (inSpace ? 0.65 : 1.1);
    const rupture =
      phase === "rupture"
        ? smooth(phaseTime, PLANET_RUPTURE.impact, PLANET_RUPTURE.burst + 3)
        : Number(inSpace);
    world.update(
      time,
      rupture,
      inSpace,
      phase === "reveal" ? phaseTime : 4,
      roofBlast,
      phase === "rupture" ? phaseTime : -1,
      night,
      reducedMotion,
    );
    return { inSpace, aftermathState };
  }

  function updatePhysics(dt: number) {
    if (
      disposed ||
      retryRequested ||
      playbackPaused() ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    animationDelta = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
    if (isControllerActive()) updateInput();
    skipHold.update(animationDelta);
    director.update(animationDelta);
    for (const phase of director.drainChanges()) {
      if (phase === "finisher" && lastPhase !== "loading") {
        finisherEntry = {
          hero: heroMech.root.position.clone(),
          enemy: enemyMech.root.position.clone(),
          heroRotation: heroMech.root.quaternion.clone(),
          enemyRotation: enemyMech.root.quaternion.clone(),
          heroDissolve: 0,
        };
      }
      if (phase === "defeat" || phase === "victory") {
        endingEntry = {
          hero: heroMech.root.position.clone(),
          enemy: enemyMech.root.position.clone(),
          heroRotation: heroMech.root.quaternion.clone(),
          enemyRotation: enemyMech.root.quaternion.clone(),
          heroDissolve: 0,
        };
      }
      lastPhase = phase;
      syncPause();
      keys.clear();
      if (phase === "space" || phase === "finisher") reachedSpace = true;
      if (phase === "credits" && !victoryCallbackSent) {
        victoryCallbackSent = true;
        onVictoryComplete?.();
      }
      if (phase === "done" && !finishedCallbackSent) {
        finishedCallbackSent = true;
        onFinished();
      }
    }
    const state = director.getState();
    lastPhase = state.phase;
    if (
      state.phase === "defeat" &&
      state.phaseTime >= FINALE_DURATION.defeat &&
      isControllerActive()
    ) {
      retryCheckpoint();
      return;
    }
    const { inSpace, aftermathState } = updateEnvironment(
      state.phase,
      state.phaseTime,
      state.time,
    );
    site.update(animationDelta, !aftermathState.forest);
    shipTransform.update(state.phase, state.phaseTime);

    if (
      state.phase === "enemyTransform" &&
      state.phaseTime >= FACILITY_ROOF_SEQUENCE.transformStart
    ) {
      const burstIndex = Math.floor(
        (state.phaseTime - FACILITY_ROOF_SEQUENCE.transformStart) * 2.6,
      );
      if (burstIndex > lastFirework) {
        lastFirework = burstIndex;
        const student = SUDOERS_5[burstIndex % SUDOERS_5.length];
        const angle = burstIndex * 2.399;
        effects.sparks(
          enemyMech.root.position
            .clone()
            .add(
              vector(
                Math.cos(angle) * 4,
                2 + (burstIndex % 5) * 2.5,
                Math.sin(angle) * 4,
              ),
            ),
          student.color,
          8,
          vector(0, 1, 0),
        );
      }
    } else if (state.phase !== "enemyTransform") lastFirework = -1;

    updateActors(state.phase, state.phaseTime, state.time);
    aftermath.update(
      state.phase === "rupture" ? state.phaseTime : -1,
      state.time,
      heroMech.root,
    );
    if (aftermathState.forest || aftermathState.cockpit) {
      heroMech.root.visible = enemyMech.root.visible = false;
    }
    mothership.root.visible =
      (state.phase === "victory" && state.phaseTime >= DONUS_RETURN.appear) ||
      state.phase === "credits" ||
      state.phase === "done";
    if (mothership.root.visible) {
      const arrival = sampleMothershipArrival(
        state.phase === "victory"
          ? state.phaseTime
          : FINALE_DURATION.victory + state.phaseTime,
      );
      mothership.root.position
        .copy(heroMech.root.position)
        .add(vector(...arrival.position));
      mothership.root.quaternion.setFromUnitVectors(
        vector(0, 0, 1),
        vector(...arrival.direction),
      );
      mothership.root.rotateZ(arrival.roll);
    }
    consumeDirectorEvents();
    updateMissiles(state.phase);
    effects.update(animationDelta);
    if (state.phase === "versus") {
      if (!versusCaptured) {
        versus.capture(heroMech.root, [enemyMech.root]);
        versusCaptured = true;
      }
      versus.update(state.phaseTime);
      matchCall.textContent =
        state.phaseTime < 3.7 ? "ONE PLANET. NO SECOND CHANCES." : "FIGHT!";
    } else versus.hide();

    const duelState = director.duel.getState();
    const cinematicShield =
      state.phase === "enemyTransform"
        ? smooth(state.phaseTime, FACILITY_ROOF_SEQUENCE.shieldStart, FACILITY_ROOF_SEQUENCE.shieldStart + 0.35) *
          (1 - smooth(state.phaseTime, FACILITY_ROOF_SEQUENCE.liftEnd, FACILITY_ROOF_SEQUENCE.boardingStart))
        : 0;
    if (cinematicShield > 0) {
      const lift = sampleFacilityLift(state.phaseTime);
      effects.shield(
        vector(FACILITY.x, lift.y + 1.05, FACILITY.z + 6),
        1.35,
        cinematicShield * 0.55,
        state.time,
      );
    } else {
      const combat = state.phase === "ground" || state.phase === "space";
      const fractured =
        combat && duelState.shieldLock > DUEL.shieldBreak - 0.28;
      effects.shield(
        heroMech.getShieldCenter(),
        DUEL.shieldRadius,
        combat && duelState.bossImmunityRemaining > 0
          ? 0.85
          : combat && duelState.guarding
            ? 0.45 + (duelState.shield / DUEL.shieldMax) * 0.55
            : fractured
              ? 0.24
              : 0,
        state.time,
        fractured,
      );
    }
    const enemyFractured =
      (state.phase === "ground" || state.phase === "space") &&
      duelState.enemyShieldLock > DUEL.shieldBreak - 0.28;
    effects.shield(
      enemyMech.getShieldCenter(),
      DUEL.shieldRadius,
      (state.phase === "ground" || state.phase === "space") &&
        duelState.enemyGuarding
        ? 0.45 + (duelState.enemyShield / DUEL.shieldMax) * 0.55
        : enemyFractured
          ? 0.24
          : 0,
      state.time,
      enemyFractured,
      "enemy",
    );
    const activeSpecial = duelState.special;
    const special =
      activeSpecial?.cinematic &&
      (activeSpecial.kind === "missiles" ||
        activeSpecial.kind === "overdrive" ||
        activeSpecial.kind === "verdict" ||
        activeSpecial.kind === "orbitalCut")
        ? {
            owner: activeSpecial.owner,
            kind: activeSpecial.kind,
            time: activeSpecial.time,
            duration: activeSpecial.duration,
          }
        : null;
    const heroBlade = heroMech.getBlade(),
      enemyBlade = enemyMech.getBlade();
    cameraRig.update(
      {
        phase: state.phase,
        phaseTime: state.phaseTime,
        time: state.time,
        space: inSpace,
        hero: heroMech.root,
        enemy: enemyMech.root,
        human: vector(
          player.body.position.x,
          player.body.position.y,
          player.body.position.z,
        ),
        students: students.students.map((student) => student.root),
        ship: site.ship.root,
        mothership: mothership.root,
        bomb: world.getBombPosition(),
        facilityInterior: world.facilityInterior,
        heroChest: heroMech.getChest(),
        enemyChest: enemyMech.getChest(),
        heroFace: heroMech.getFace(),
        enemyFace: enemyMech.getFace(),
        heroShoulder: heroMech.getShoulder("right"),
        enemyShoulder: enemyMech.getShoulder("right"),
        heroMuzzle: heroMech.getMuzzle(),
        enemyMuzzle: enemyMech.getMuzzle(),
        clash: clashContact,
        heroBladeBase: heroBlade.base,
        heroBladeTip: heroBlade.tip,
        enemyBladeTip: enemyBlade.tip,
        boy: aftermath.getBoyFocus(),
        boyGround: aftermath.getBoyGround(),
        boyPOV: aftermath.getBoyPOV(),
        pilotFace: aftermath.getPilotFace(),
        pilotCamera: aftermath.getPilotCamera(state.phaseTime),
        special,
        finisher: sampleFinisherSequence(
          state.phase === "finisher" ? state.phaseTime : 0,
        ),
      },
      animationDelta,
    );

    updateObjective(state.phase, state.phaseTime);
    showDialogue(state.phase, state.phaseTime);
    const isMechCombat = state.phase === "ground" || state.phase === "space";
    presentation.mode(
      state.phase,
      !isMechCombat || !!special,
      isMechCombat && !special,
    );
    presentation.stats(
      director.duel.hero.health,
      director.duel.enemy.health,
      director.duel.hero.energy,
      duelState.shield,
      duelState.ultimateCooldown,
      special
        ? ""
        : duelState.feedback ||
            (duelState.enemyGuarding
              ? "SHIELD RAISED"
              : duelState.enemyTell === "orbitalCut"
                ? "ECLIPSE REND / DODGE OR PARRY"
                : duelState.enemyTell === "verdict"
                  ? "BEAM INCOMING"
                  : duelState.enemyTell === "reap"
                    ? "REVERSE CUT"
                    : duelState.enemyTell === "thrust"
                      ? "THRUST"
                      : ""),
      duelState.shieldLock,
      duelState.bossImmunityRemaining,
    );
    const speed =
      state.phase === "rupture" &&
      state.phaseTime >= PLANET_RUPTURE.slam &&
      state.phaseTime < PLANET_RUPTURE.impact
        ? 0.32
        : state.phase === "finisher"
          ? sampleFinisherSequence(state.phaseTime).speed
          : 0;
    presentation.speedLines(speed);
    presentation.update(animationDelta);

    if (state.phase === "defeat" && state.phaseTime >= 4.2) {
      presentation.result(
        "GAME OVER",
        state.failure || "Sudoers 5 killed Brondon.",
        true,
        "SIGNAL LOST",
      );
    } else if (state.phase === "error") {
      presentation.result(
        "FINAL FRAME FAILED",
        state.error || "The finale could not be loaded.",
        true,
        "LOAD ERROR",
      );
    } else presentation.result("", "", false);
    if (state.phase === "credits" || state.phase === "done")
      presentation.credits(
        state.phase === "done" ? FINALE_DURATION.credits : state.phaseTime,
      );
    else presentation.credits(-1);
  }

  let renderingPreparation: Promise<void> | null = null;
  function prepareRendering(activeRenderer: THREE.WebGLRenderer) {
    if (!renderingPreparation)
      renderingPreparation = (async () => {
        await ready;
        if (disposed) throw new Error("Finale preparation was interrupted");
        const previousPaused = paused;
        try {
          paused = false;
          updatePhysics(0);
          lightCounts.refresh();
          lightCounts.sync();
          if (postProcessing) await postProcessing.prepare();
          else
            await prepareSceneRendering(activeRenderer, scene, camera, {
              fogVariants: false,
            });
        } finally {
          paused = previousPaused;
          syncPause();
        }
      })();
    return renderingPreparation;
  }

  return {
    scene,
    camera,
    player,
    ready,
    ownsWeaponInput: true,
    forceThirdPerson: true,
    updatePhysics,
    prepareRendering,
    isCinematic: () =>
      (lastPhase !== "ground" && lastPhase !== "space") ||
      director.duel.getState().special?.cinematic === true,
    restartAtCheckpoint: () => {
      retryCheckpoint();
      return true;
    },
    onPlayerDeath: () => true,
    hideCharacter: () =>
      lastPhase !== "reveal" &&
      lastPhase !== "enemyTransform" &&
      !(
        lastPhase === "heroTransform" &&
        director.getState().phaseTime < HERO_TRANSFORM.pilotMerge
      ),
    getCinematicState: () => player.getState(),
    getCinematicPose: updateHumanPose,
    getCinematicDelta: () => animationDelta,
    updateCinematicCharacter(
      character: Awaited<ReturnType<typeof loadCharacter>> | null,
    ) {
      if (character)
        character.model.visible =
          lastPhase === "reveal" ||
          lastPhase === "enemyTransform" ||
          (lastPhase === "heroTransform" &&
            director.getState().phaseTime < HERO_TRANSFORM.pilotMerge);
    },
    setMenuPaused(value: boolean) {
      paused = value;
      keys.clear();
      director.clearInput();
      syncPause();
    },
    clearInput() {
      keys.clear();
      director.clearInput();
      updateInput();
    },
    renderSceneWithEffects() {
      if (lastPhase === "versus") versus.render(renderer);
      else if (postProcessing) postProcessing.render();
      else renderer.render(scene, camera);
    },
    getSceneId: () => "scene21",
    hideMinimap: () => true,
    getDeveloperSceneId: () =>
      director.getState().phase === "rupture"
        ? "scene21.5"
        : director.getState().phase === "finisher"
          ? "scene21.9"
          : director.getState().phase === "credits" ||
              director.getState().phase === "done"
            ? "scene22"
            : "scene21",
    getControllerPhase: () => lastPhase,
    getMusicTrack: () => {
      const { phase, phaseTime } = director.getState();
      return finaleMusicTrack(
        phase,
        reachedSpace ||
          (phase === "rupture" && phaseTime >= PLANET_RUPTURE.impact),
      );
    },
    hasBossVictory: () => director.getState().phase === "victory",
    isMusicPaused: playbackPaused,
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      skipHold.dispose();
      director.pause(true);
      presentation.dispose();
      versus.dispose();
      postProcessing?.dispose();
      heroTrail.dispose();
      enemyTrail.dispose();
      effects.dispose();
      aftermath.dispose();
      disposeComicEffects(scene);
      lightCounts.dispose();
      world.dispose();
      shipTransform.dispose();
      mothership.dispose();
      students.dispose();
      heroMech.dispose();
      enemyMech.dispose();
      missilePool.forEach((missile) => missile.root.removeFromParent());
      missileGeometry.dispose();
      missileNoseGeometry.dispose();
      waveGeometry.dispose();
      waveGlowGeometry.dispose();
      verdictGeometry.dispose();
      tracerGeometry.dispose();
      Object.values(tracerMaterials).forEach((material) => material.dispose());
      waveMaterial.dispose();
      waveGlowMaterial.dispose();
      waveWakeMaterial.dispose();
      enemyWaveMaterial.dispose();
      enemyWaveGlowMaterial.dispose();
      enemyWaveWakeMaterial.dispose();
      Object.values(verdictMaterials).forEach((material) => material.dispose());
      Object.values(verdictGlows).forEach((material) => material.dispose());
      Object.values(missileMaterials).forEach((material) => material.dispose());
      Object.values(flameMaterials).forEach((material) => material.dispose());
      player.dispose();
      site.dispose();
      physics.dispose();
      scene.clear();
    },
  };
}
