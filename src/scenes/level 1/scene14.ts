import * as THREE from 'three';
import { BAY_FOURTEEN_MAP } from '../level 1 stage 2/stageTwoLayout.js';
import * as CANNON from 'cannon-es';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import type { CinematicPose } from '../../scripts/characterManager.js';
import { createEscapeShip, addPlanetBackdrop, animatePlanetBackdrop } from '../../scripts/items/createEscapeShip.js';
import type { DamageTarget } from '../../scripts/pistol.js';
import { isTouchActive } from '../../scripts/touchControls.js';
import { isControllerActive, controllerLabel, inputHint } from '../../scripts/gamepadInput.js';
import { createHangarVersus } from '../../helpers/scene/hangarVersus.js';
import { emitComicEffect } from '../../helpers/scene/comicEffects.js';
import saberGlowVertex from '../../shaders/saberGlow.vert.glsl?raw';
import saberGlowFragment from '../../shaders/saberGlow.frag.glsl?raw';
import fireVertexShader from '../../shaders/fireExplosion.vert.glsl?raw';
import fireFragmentShader from '../../shaders/fireExplosion.frag.glsl?raw';

export interface LaunchState extends PlayerTransitionState {
  launch?: { shipPosition: THREE.Vector3; shipQuaternion: THREE.Quaternion; cameraPosition: THREE.Vector3; cameraQuaternion: THREE.Quaternion; cameraFov: number; speed: number };
}
export const ESCAPE_QTE = Object.freeze({ seconds: 2.2, stages: 4, robots: 48 });
type Phase = 'arrival' | 'reveal' | 'versus' | 'orbit' | 'escape' | 'charge' | 'prompt' | 'action' | 'boarding' | 'aboard' | 'launch' | 'failed';
type EscapeKey = 'KeyY' | 'KeyU' | 'KeyI' | 'KeyO';
const QTE_SEQUENCE: readonly EscapeKey[] = ['KeyY', 'KeyU', 'KeyI', 'KeyO'];
const QTE_POSITIONS = [-26, -15, -4, 7] as const;
const ACTION_POSITIONS = [-20, -9, 2, 11] as const;
const ROLL_PLAYBACK_DURATION = 1.2;
const ACTION_BEATS = {
  KeyY: { windup: 0.28, impact: 0.38, recover: 0.98, end: 2.15 },
  KeyU: { windup: 0.18, impact: 0.60, recover: 1.12, end: 2.25 },
  KeyI: { windup: 0, impact: 0.42, recover: 0.96, end: 1.8 },
  KeyO: { windup: 0.32, impact: 0.68, recover: 1.8, end: 2.5 },
} as const;
const BOARDING = { run: 1.05, takeoff: 1.4, land: 2.15, settle: 2.6, seated: 3.9, end: 4.5 } as const;

/** A continuous hangar escape cinematic, timed actions, cockpit boarding and launch. */
export function createScene({ entryState, onFailure, onLaunch, loadModel = loadToolModel }: {
  entryState?: PlayerTransitionState; onFailure: () => void; onLaunch: (state: LaunchState) => void;
  loadModel?: typeof loadToolModel;
}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020611);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const steel = new THREE.MeshStandardMaterial({ color: 0x435667, metalness: 0.6, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2c3a, metalness: 0.45, roughness: 0.7 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe4a14a, emissive: 0xa86614, emissiveIntensity: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x84d8ee });
  const box = (s: [number, number, number], p: [number, number, number], mat: THREE.Material = steel, solid = true) => roomBox(scene, physics, s, p, mat, solid);
  box([13, 0.5, 72], [-11.5, -0.25, 0], dark);
  box([13, 0.5, 72], [11.5, -0.25, 0], dark);
  box([10, 0.5, 60], [0, -0.25, 6], dark);
  box([10, 0.5, 2], [0, -0.25, -35], dark);
  box([10, 0.3, 10], [0, -0.65, -29], dark);
  box([0.5, 15, 72], [-18, 7.5, 0]); box([0.5, 15, 72], [18, 7.5, 0]);
  box([36, 15, 0.5], [0, 7.5, -36]); box([36, 0.4, 72], [0, 15, 0], dark);
  box([8, 15, 0.5], [-14, 7.5, 36]); box([8, 15, 0.5], [14, 7.5, 36]); box([20, 4, 0.5], [0, 13, 36]);
  const blastDoors = [-1, 1].map(sign => {
    const mesh = box([10, 11, 0.6], [sign * 5, 5.5, 36], dark, false);
    return { mesh, sign, body: physics.addBoxFromMesh(mesh) };
  });
  for (let z = -30; z <= 30; z += 6) for (const x of [-17.7, 17.7]) {
    box([0.12, 0.18, 3], [x, 4, z], glow, false); box([0.5, 15, 0.5], [x, 7.5, z], steel);
  }
  for (const x of [-6, 6]) box([0.2, 0.025, 66], [x, 0.02, 0], amber, false);
  for (const z of [-24, -12, 0, 12, 24]) box([24, 0.08, 0.7], [0, 14.7, z], glow, false);
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.35, 48), steel); lift.name = 'HangarArrivalLift'; lift.position.set(0, -0.155, -29); scene.add(lift);
  physics.addBox({ x: 8.8, y: 0.35, z: 8.8 }, { x: 0, y: -0.155, z: -29 });
  const liftRim = new THREE.Mesh(new THREE.TorusGeometry(4.7, 0.13, 8, 48), amber);
  liftRim.name = 'HangarLiftLandingRim'; liftRim.rotation.x = Math.PI / 2; liftRim.position.set(0, 0.025, -29); scene.add(liftRim);
  const ship = createEscapeShip(); ship.root.position.set(0, 0, 21); ship.root.rotation.y = Math.PI; ship.setThrust(0); scene.add(ship.root);
  const shipCollider = physics.addBox({ x: 3, y: 2.6, z: 7 }, { x: 0, y: 1.3, z: 21 });
  const planet = addPlanetBackdrop(scene, new THREE.Vector3(0, 60, 1500), 320, 2400); planet.visible = false;
  scene.add(new THREE.HemisphereLight(0xa8cce9, 0x2b3139, 2.2));
  const sun = new THREE.DirectionalLight(0xb9d8ff, 3); sun.position.set(-20, 50, 30); scene.add(sun);
  for (const z of [-25, -5, 15]) { const light = new THREE.PointLight(0xb3def7, 180, 40); light.position.set(0, 12, z); scene.add(light); }
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 5000);
  const versus = createHangarVersus();
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 3.3, z: -29 } }); player.enable();
  if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: 3.3, z: -29 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, heldKeys: [], crouching: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.setRotation(Math.PI); player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties();
  let phase: Phase = 'arrival', clock = 0, stage = 0, timeLeft: number = ESCAPE_QTE.seconds;
  let expected: EscapeKey = 'KeyY', actionKey: EscapeKey = 'KeyY';
  let animationDelta = 0, failedYaw = Math.PI, runTime = 0, orbitAngle = Math.PI, orbitRadius = 5.6;
  let shipFailure = false, motionScale = 1;
  const orbitStart = new THREE.Vector3(), orbitLook = new THREE.Vector3(), orbitRotation = new THREE.Quaternion();
  let disposed = false, transferred = false, paused = false, loaded = false, assetError = false, impact = false;
  let gun: THREE.Object3D | null = null;
  const actionStart = new THREE.Vector3(), actionEnd = new THREE.Vector3(), threatStart = new THREE.Vector3();
  const lastTravel = new THREE.Vector3(), failedPosition = new THREE.Vector3(), failedVelocity = new THREE.Vector3();
  const boardingRun = new THREE.Vector3(0, 0.3, 16.5), boardingDeck = new THREE.Vector3(), seatedPosition = new THREE.Vector3();
  ship.root.updateMatrixWorld(true);
  ship.boardingDeck.getWorldPosition(boardingDeck); boardingDeck.y += player.radius;
  ship.pilotSeat.getWorldPosition(seatedPosition);
  const shotPosition = new THREE.Vector3(), shotTarget = new THREE.Vector3();
  const revealStart = new THREE.Vector3(), revealLook = new THREE.Vector3();
  const revealPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(6.5, 3.2, 27), new THREE.Vector3(3.4, 2.7, 17),
    new THREE.Vector3(-1.3, 1.8, 5), new THREE.Vector3(1.6, 1.9, -10), new THREE.Vector3(0.4, 2.22, -23.4),
  ], false, 'centripetal');
  let shot = '', shotFov = 70;
  let promptFocus = 0, promptPulse = 0, promptBeat = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  ship.setCanopyOpen(0);
  const pressed = new Set<string>();
  const blastUniforms = {
    uTime: { value: 0 }, uProgress: { value: 0 }, uIntensity: { value: 1 }, uCameraLocal: { value: new THREE.Vector3() },
    uColorCore: { value: new THREE.Color(0xfff2b0) }, uColorMid: { value: new THREE.Color(0xff8a1f) },
    uColorEdge: { value: new THREE.Color(0xc41608) }, uColorSmoke: { value: new THREE.Color(0x1a1613) },
  };
  const blastMaterial = new THREE.ShaderMaterial({ uniforms: blastUniforms, vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: false });
  const shipBlast = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), blastMaterial); scene.add(shipBlast); shipBlast.visible = false;
  shipBlast.name = 'HangarShipFireExplosion'; shipBlast.frustumCulled = false;
  shipBlast.onBeforeRender = (_renderer, _scene, viewCamera) => {
    viewCamera.getWorldPosition(blastUniforms.uCameraLocal.value); shipBlast.worldToLocal(blastUniforms.uCameraLocal.value);
  };
  const siege = Array.from({ length: 12 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xff4c36 }));
    mesh.visible = false; scene.add(mesh); return { mesh, offset: i / 12 };
  });
  const qte = document.getElementById('escape-qte'), keyLabel = document.getElementById('escape-key'), timer = document.getElementById('escape-timer-fill'), actionLabel = document.getElementById('escape-action');
  const qteCaption = qte?.querySelector?.('.escape-caption'), qteHint = qte?.querySelector?.('.escape-hint');
  const desktopCaption = qteCaption?.textContent ?? '', desktopHint = qteHint?.textContent ?? '';
  const qteTapEvent = 'PointerEvent' in window ? 'pointerdown' : 'touchstart';
  const prompt = document.getElementById('interact-prompt'), subtitles = document.getElementById('boss-subtitles'), status = document.getElementById('loading-bay-status');
  document.getElementById('boss-hud')?.classList.add('hidden'); status?.classList.remove('hidden', 'restored');
  type Robot = { root: THREE.Group; body: CANNON.Body; mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[]; side: number; stunned: boolean; health: number; vacuum: THREE.Vector3; target: DamageTarget;
    knockback: THREE.Vector3; tumble: THREE.Vector3; airborne: boolean };
  const robots: Robot[] = [];
  let threat: Robot | undefined;
  const chargers: { robot: Robot; start: THREE.Vector3; intercept: THREE.Vector3 }[] = [];
  const spinVictims: Robot[] = [];
  const spinTrailMaterial = new THREE.ShaderMaterial({ vertexShader: saberGlowVertex, fragmentShader: saberGlowFragment,
    defines: { SABER_TRAIL: 1 }, uniforms: { uTint: { value: new THREE.Color(0x36ffa4) }, uOpacity: { value: 0.42 } },
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const spinTrailGeometry = new THREE.BufferGeometry();
  const trailSamples = 48, trailLifetime = 0.14;
  const spinTrailPositions = new Float32Array(trailSamples * 2 * 3), spinTrailIndices: number[] = [];
  const spinTrailUv = new Float32Array(trailSamples * 4), spinTrailFade = new Float32Array(trailSamples * 2);
  for (let index = 0; index < trailSamples - 1; index++) {
    const vertex = index * 2; spinTrailIndices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
  }
  for (let index = 0; index < trailSamples; index++) spinTrailUv.set([0, 0, 0, 1], index * 4);
  spinTrailGeometry.setAttribute('position', new THREE.BufferAttribute(spinTrailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  spinTrailGeometry.setAttribute('uv', new THREE.BufferAttribute(spinTrailUv, 2));
  spinTrailGeometry.setAttribute('aFade', new THREE.BufferAttribute(spinTrailFade, 1).setUsage(THREE.DynamicDrawUsage));
  spinTrailGeometry.setIndex(spinTrailIndices);
  const spinTrail = new THREE.Mesh(spinTrailGeometry, spinTrailMaterial);
  spinTrail.name = 'HangarSaberSpinTrail'; spinTrail.frustumCulled = false; spinTrail.visible = false; scene.add(spinTrail);
  const bladeHistory: { base: THREE.Vector3; tip: THREE.Vector3; time: number; strength: number }[] = [];
  let lastBladeTime = -1;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff5950 })); beam.visible = false; scene.add(beam);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffdc8a })); flash.visible = false; scene.add(flash);
  function aimBeam(from: THREE.Vector3) {
    if (!threat) return;
    const delta = threat.root.position.clone().add(new THREE.Vector3(0, 0.55, 0)).sub(from);
    beam.position.copy(from).addScaledVector(delta, 0.5); beam.scale.y = delta.length();
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); flash.position.copy(from);
  }
  const windGeometry = new THREE.BufferGeometry(), windPositions = new Float32Array(180 * 3);
  for (let i = 0; i < windPositions.length; i += 3) { windPositions[i] = (Math.random() - 0.5) * 28; windPositions[i + 1] = Math.random() * 10; windPositions[i + 2] = Math.random() * 72 - 36; }
  windGeometry.setAttribute('position', new THREE.BufferAttribute(windPositions, 3));
  const wind = new THREE.Points(windGeometry, new THREE.PointsMaterial({ color: 0xccedff, size: 0.09, transparent: true, opacity: 0.6 })); wind.visible = false; scene.add(wind);
  function playRobot(robot: Robot, name: string) {
    const clip = robot.clips.find(c => c.name === name); if (!clip) return;
    robot.mixer.stopAllAction(); const action = robot.mixer.clipAction(clip); action.reset().play();
    if (name === 'TurnOff') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
  }
  function stopRobot(robot: Robot) {
    if (robot.stunned) return;
    emitComicEffect(scene, 'hit', { source: robot.root,
      weapon: actionKey === 'KeyU' ? 'crowbar' : actionKey === 'KeyY' ? 'pistol' : 'lightsaber', size: 2 });
    robot.stunned = true; robot.body.collisionResponse = false; playRobot(robot, 'TurnOff');
  }
  function knockRobotAway(robot: Robot, origin: THREE.Vector3) {
    if (robot.stunned) return;
    const direction = robot.root.position.clone().sub(origin).setY(0);
    if (direction.lengthSq() < 0.01) direction.set(robot.side, 0, 0.2);
    direction.normalize(); stopRobot(robot);
    robot.knockback.copy(direction).multiplyScalar(10.5); robot.knockback.y = 5.8;
    robot.tumble.set(robot.side * 3.5, 2.3, -robot.side * 4.5); robot.airborne = true;
  }
  async function loadCrowd() {
    assetError = false;
    try {
      const gltf = await loadModel('Enemy_Trilobite');
      if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; }
      const bounds = new THREE.Box3().setFromObject(gltf.scene), size = bounds.getSize(new THREE.Vector3());
      gltf.scene.scale.multiplyScalar(1.4 / Math.max(size.x, size.y, size.z, 0.001)); bounds.setFromObject(gltf.scene); gltf.scene.position.y -= bounds.min.y;
      for (let i = 0; i < ESCAPE_QTE.robots; i++) {
        const root = new THREE.Group(); root.name = `HangarTrilobite-${i}`; root.add(clone(gltf.scene));
        const column = i % 8, row = Math.floor(i / 8);
        root.position.set((column < 4 ? -1 : 1) * (3.2 + (column % 4) * 3.2), 0, -16 + row * 8.4 + (column % 2) * 1.4); scene.add(root);
        root.traverse(n => { if (n instanceof THREE.Mesh) { n.castShadow = true; n.receiveShadow = true; } });
        const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.55, 0.5, 0.65)) }); body.position.set(root.position.x, 0.5, root.position.z); physicsWorld.addBody(body);
        const robot: Robot = { root, body, mixer: new THREE.AnimationMixer(root), clips: gltf.animations, side: column < 4 ? -1 : 1, stunned: false, health: 75, vacuum: new THREE.Vector3(),
          knockback: new THREE.Vector3(), tumble: new THREE.Vector3(), airborne: false,
          target: { root, body, damage() { return false; } } };
        robots.push(robot); playRobot(robot, 'Walk'); robot.mixer.update(i * 0.13);
      }
      loaded = true;
    } catch (error) { if (!disposed) { assetError = true; console.error('[Scene 14] Robot crowd could not load:', error); } }
  }
  const ready = loadCrowd();
  const gunReady = loadModel('Gun_Revolver').then(gltf => { if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; } gun = gltf.scene; gun.rotation.y = -Math.PI / 2; }).catch(error => { if (!disposed) console.error('[Scene 14] Cinematic pistol could not load:', error); });
  function freeze() { player.disable(); player.body.velocity.set(0, 0, 0); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties(); }
  function updatePromptLabels() {
    const code = phase === 'aboard' ? 'KeyE' : expected;
    const label = isControllerActive() ? controllerLabel(code, 'escape') : code.slice(3);
    const mobile = !isControllerActive() && isTouchActive();
    if (keyLabel && keyLabel.textContent !== label) keyLabel.textContent = label;
    if (qteCaption) qteCaption.textContent = mobile ? 'TAP ANYWHERE ON THE SCREEN'
      : isControllerActive() ? 'PRESS THE DISPLAYED CONTROLLER BUTTON' : desktopCaption;
    if (qteHint) qteHint.textContent = mobile ? 'Tap once before the timer runs out'
      : isControllerActive() ? 'A: shoot / X: crowbar / B: dodge / Y: saber spin / R: launch' : desktopHint;
    qte?.setAttribute('aria-label', `Press ${label} within ${phase === 'aboard' ? 'three' : '2.2'} seconds`);
  }
  function beginPrompt() {
    expected = QTE_SEQUENCE[stage]!; phase = 'prompt'; clock = 0; timeLeft = ESCAPE_QTE.seconds;
    promptBeat = 0;
    qte?.classList.remove('hidden', 'urgent');
    qte?.classList.add('letter-prompt');
    qte?.style.setProperty('--qte-pulse', '0');
    if (timer) timer.style.width = '100%';
    updatePromptLabels();
    if (actionLabel) actionLabel.textContent = `${stage + 1} / ${ESCAPE_QTE.stages} - ${expected === 'KeyY' ? 'FIRE THROUGH THE GAP' : expected === 'KeyU' ? 'STRIKE WITH THE CROWBAR' : expected === 'KeyI' ? 'DODGE THE CHARGING SWARM' : 'SPIN THROUGH THE SWARM'}`;
    const candidates = robots.filter(r => !r.stunned && r.root.position.z > player.body.position.z - 0.5);
    const position = new THREE.Vector3().copy(player.body.position);
    const side = Math.random() < 0.5 ? -1 : 1;
    const available = candidates.length ? candidates : robots.filter(r => !r.stunned);
    const flank = available.filter(r => r.side === side);
    threat = (flank.length ? flank : available).sort((a, b) => a.root.position.distanceToSquared(position) - b.root.position.distanceToSquared(position))[0];
  }
  function beginCharge() {
    phase = 'charge'; clock = 0; chargers.length = 0;
    const position = new THREE.Vector3().copy(player.body.position);
    robots.filter(robot => !robot.stunned).sort((a, b) => a.root.position.distanceToSquared(position) - b.root.position.distanceToSquared(position))
      .slice(0, 4).forEach((robot, index) => {
        chargers.push({ robot, start: robot.root.position.clone(), intercept: new THREE.Vector3(robot.side * (1.05 + index % 2 * 0.2), 0, position.z + 1.9 + index % 2 * 0.8) });
        playRobot(robot, 'Walk');
      });
  }
  function fail(reason = 'TOO SLOW') {
    if (phase === 'failed' || transferred) return;
    versus.hide();
    shipFailure = phase === 'aboard';
    failedYaw = cinematicYaw();
    failedPosition.copy(player.body.position);
    failedVelocity.copy(shipFailure ? new THREE.Vector3() : lastTravel);
    if (shipFailure) { shipBlast.visible = true; shipBlast.position.copy(ship.root.position).add(new THREE.Vector3(0, 1.5, 0)); }
    player.takeDamage(player.getHealth() + player.getShield(), true); freeze(); phase = 'failed'; clock = 0; beam.visible = flash.visible = false;
    qte?.classList.add('hidden'); prompt?.classList.add('hidden'); spinTrail.visible = false;
    if (subtitles) { subtitles.textContent = `${reason} / ${shipFailure ? 'SHUTTLE DESTROYED WITH PILOT ABOARD' : 'THE SWARM OVERRAN YOU'}\nReturning to the cleared loading bay...`; subtitles.classList.remove('hidden'); }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (disposed || event.repeat || pressed.has(event.code) || paused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, [contenteditable="true"]')) return;
    pressed.add(event.code);
    if (phase === 'arrival' && assetError && event.code === 'KeyE') { void loadCrowd(); return; }
    if (phase === 'aboard' && event.code === 'KeyE') { event.preventDefault(); beginLaunch(); return; }
    if (phase !== 'prompt' || !QTE_SEQUENCE.includes(event.code as EscapeKey)) return;
    event.preventDefault();
    if (event.code !== expected) { fail('WRONG MOVE'); return; }
    acceptPrompt();
  }
  function onQteTap(event: Event) {
    if (isControllerActive() || !isTouchActive() || disposed || transferred || paused || document.hidden || (phase !== 'prompt' && phase !== 'aboard') || timeLeft <= 0) return;
    if (document.body.classList.contains('quick-menu-open')) return;
    if (event.type === 'pointerdown' && (event as PointerEvent).pointerType === 'mouse' && (event as PointerEvent).button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest('#touch-menu, dialog, input, textarea, select, [contenteditable="true"]')) return;
    // Capture the prompt tap before movement, weapon, or look controls consume it.
    event.preventDefault(); event.stopImmediatePropagation();
    if (phase === 'aboard') beginLaunch(); else acceptPrompt();
  }
  function beginLaunch() {
    if (phase !== 'aboard' || timeLeft <= 0) return;
    phase = 'launch'; clock = 0; prompt?.classList.add('hidden'); qte?.classList.add('hidden');
    siege.forEach(s => { s.mesh.visible = false; });
  }
  function beginEscape() {
    orbitStart.copy(camera.position); orbitRotation.copy(camera.quaternion);
    orbitLook.copy(player.body.position).add(new THREE.Vector3(0, 1.1, 0));
    const offset = orbitStart.clone().sub(new THREE.Vector3().copy(player.body.position));
    orbitRadius = Math.max(0.05, Math.hypot(offset.x, offset.z));
    orbitAngle = orbitRadius < 0.4 ? Math.PI / 2 : Math.atan2(offset.x, offset.z);
    shotPosition.copy(camera.position); shotTarget.copy(orbitLook); shotFov = camera.fov;
    freeze(); phase = 'orbit'; clock = 0; shot = 'one-take';
  }
  function advanceRun(dt: number, speed: number, animationDt = dt) {
    runTime += animationDt;
    const z = Math.min(16.5, player.body.position.z + dt * speed);
    const centered = THREE.MathUtils.damp(player.body.position.x, 0, 5, dt);
    const x = Math.abs(centered) < 0.02 ? 0 : centered;
    player.setPosition(x, THREE.MathUtils.damp(player.body.position.y, 0.3, 10, dt), z);
  }
  function acceptPrompt() {
    actionKey = expected; phase = 'action'; clock = 0; impact = false;
    actionStart.copy(player.body.position); actionEnd.set(0, 0.3, ACTION_POSITIONS[stage]);
    actionEnd.z = Math.max(actionStart.z + 2.4, actionEnd.z);
    if (threat) threatStart.copy(threat.root.position);
    if (actionKey === 'KeyI') chargers.forEach(charger => charger.start.copy(charger.robot.root.position));
    if (actionKey === 'KeyO') {
      spinVictims.length = 0; bladeHistory.length = 0; lastBladeTime = -1;
      spinVictims.push(...robots.filter(robot => !robot.stunned).sort((a, b) => a.root.position.distanceToSquared(actionStart) - b.root.position.distanceToSquared(actionStart)).slice(0, 6));
    }
    qte?.classList.add('hidden'); qte?.classList.remove('letter-prompt'); updateShot(0); cameraView();
  }
  function onKeyUp(event: KeyboardEvent) { pressed.delete(event.code); }
  function onBlur() { paused = true; pressed.clear(); }
  function onFocus() { paused = false; }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
  window.addEventListener(qteTapEvent, onQteTap, { capture: true, passive: false });
  function cinematicYaw() {
    if (phase === 'failed') return failedYaw;
    if (phase === 'orbit' || phase === 'escape' || phase === 'charge' || phase === 'prompt' || phase === 'action') return Math.PI;
    if (phase === 'boarding' && clock < BOARDING.run) return Math.atan2(actionStart.x - boardingRun.x, actionStart.z - boardingRun.z);
    return Math.PI;
  }
  function cinematicPose(): CinematicPose | null {
    if (phase === 'failed') return clock < 0.33 ? { clip: 'Hit_Chest', time: clock } : { clip: 'Death01', time: clock - 0.33 };
    if (phase === 'aboard' || phase === 'launch') return { clip: 'Sitting_Enter', time: 1, duration: 1 };
    if (phase === 'orbit') return { clip: 'Sprint_Loop', time: runTime, loop: true };
    if (phase === 'escape' || phase === 'charge' || phase === 'prompt') return { clip: 'Sprint_Loop', time: runTime, loop: true };
    if (phase === 'action') {
      const beats = ACTION_BEATS[actionKey];
      // Leave the roll early at its original playback speed. Never hold a
      // capped frame or retime the standing recovery tail into this window.
      if (actionKey === 'KeyI' && clock < beats.recover) return { clip: 'Roll', time: clock, duration: ROLL_PLAYBACK_DURATION };
      if (actionKey === 'KeyO' && clock < beats.recover) return {
        clip: 'Sword_Attack', time: clock, duration: beats.recover, spinAttack: clock / beats.recover,
      };
      const pose: CinematicPose = { clip: 'Sprint_Loop', time: runTime, loop: true };
      if ((actionKey === 'KeyY' || actionKey === 'KeyU') && clock < beats.recover) {
        const yaw = threat ? Math.atan2(threat.root.position.x - player.body.position.x, threat.root.position.z - player.body.position.z) : 0;
        const pitch = threat && actionKey === 'KeyY' ? Math.atan2(threat.root.position.y + 0.55 - (player.body.position.y - player.radius + 1.25),
          Math.hypot(threat.root.position.x - player.body.position.x, threat.root.position.z - player.body.position.z)) : 0;
        pose.upperBody = { clip: actionKey === 'KeyU' ? 'Sword_Attack' : clock < beats.windup ? 'Pistol_Aim_Neutral' : 'Pistol_Shoot',
          time: Math.max(0, clock - beats.windup), duration: beats.recover - beats.windup, yaw, pitch };
      }
      return pose;
    }
    if (phase === 'boarding') {
      if (clock < BOARDING.run) return { clip: 'Sprint_Loop', time: clock, loop: true };
      if (clock < BOARDING.takeoff) return { clip: 'Jump_Start', time: clock - BOARDING.run, duration: BOARDING.takeoff - BOARDING.run };
      if (clock < BOARDING.land) return { clip: 'Jump_Loop', time: clock - BOARDING.takeoff };
      if (clock < BOARDING.settle) return { clip: 'Jump_Land', time: clock - BOARDING.land, duration: BOARDING.settle - BOARDING.land };
      return { clip: 'Sitting_Enter', time: clock - BOARDING.settle, duration: BOARDING.seated - BOARDING.settle };
    }
    return { clip: 'Idle_Loop', time: clock, loop: true };
  }
  function cinematicWeapon() {
    const key = phase === 'prompt' ? expected : phase === 'action' && clock < ACTION_BEATS[actionKey].recover ? actionKey : null;
    return key === 'KeyY' ? 'pistol' : key === 'KeyU' ? 'crowbar' : key === 'KeyO' ? 'lightsaber' : null;
  }
  // A scene-clock shot director: the running shot stays continuous through every action.
  // Only this method advances tracking; applying the stored view is safe twice per frame.
  function updateShot(dt: number) {
    if (phase === 'versus') return;
    const prompting = phase === 'prompt';
    if (prompting) promptBeat += dt;
    const pulse = prompting && !reducedMotion.matches ? (1 - Math.cos(promptBeat * Math.PI * 2 * 1.35)) * 0.5 : 0;
    promptFocus = THREE.MathUtils.damp(promptFocus, prompting ? 1 : 0, 7, dt);
    promptPulse = THREE.MathUtils.damp(promptPulse, pulse, 12, dt);
    if (prompting) qte?.style.setProperty('--qte-pulse', promptPulse.toFixed(3));
    const p = new THREE.Vector3().copy(player.body.position), pos = new THREE.Vector3(), look = new THREE.Vector3();
    let id: string = phase, fov = 60;
    if (phase === 'arrival') {
      id = 'arrival-lift'; const landing = THREE.MathUtils.smootherstep(clock, 0, 2.8);
      pos.lerpVectors(new THREE.Vector3(8, 8, -33), p.clone().add(new THREE.Vector3(2.8, 2.1, -4)), landing);
      look.lerpVectors(new THREE.Vector3(0, 1.7, -10), p.clone().add(new THREE.Vector3(0, 1, 0)), landing); fov = 68;
    } else if (phase === 'reveal') {
      if (clock < 2.7) {
        id = 'ship-focus'; const focus = THREE.MathUtils.smootherstep(clock, 0, 1.8);
        pos.lerpVectors(revealStart, revealPath.points[0], focus);
        look.lerpVectors(revealLook, ship.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)), focus);
        fov = THREE.MathUtils.lerp(68, 48, focus);
      } else {
        id = 'ship-to-runner'; const sweep = THREE.MathUtils.smootherstep(clock, 2.7, 7.7);
        revealPath.getPoint(sweep, pos);
        look.lerpVectors(ship.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)), p.clone().add(new THREE.Vector3(0, 1.1, 0)), THREE.MathUtils.smootherstep(sweep, 0, 0.55));
        fov = THREE.MathUtils.lerp(48, 64, sweep);
      }
    } else if (phase === 'charge' || (phase === 'prompt' && expected === 'KeyI') || (phase === 'action' && actionKey === 'KeyI')) {
      id = 'one-take';
      const release = phase === 'action' ? THREE.MathUtils.smootherstep(clock, ACTION_BEATS.KeyI.recover * 0.7, ACTION_BEATS.KeyI.end) : 0;
      const zoom = phase === 'charge' ? THREE.MathUtils.smootherstep(clock, 0.1, 1.25) * 0.3
        : phase === 'prompt' ? 0.3 : (0.3 + THREE.MathUtils.smootherstep(clock, 0, 0.35) * 0.7) * (1 - release);
      pos.copy(p).add(new THREE.Vector3(0.4 - zoom * 0.18, 1.9 - zoom * 0.65, 5.6 - zoom * 1.15));
      look.copy(p).add(new THREE.Vector3(0, 0.95 - zoom * 0.25, zoom * 0.2));
      fov = THREE.MathUtils.lerp(64, 52, zoom);
    } else if ((phase === 'prompt' && expected === 'KeyO') || (phase === 'action' && actionKey === 'KeyO')) {
      id = 'one-take'; const release = phase === 'action' ? THREE.MathUtils.smootherstep(clock, ACTION_BEATS.KeyO.recover, ACTION_BEATS.KeyO.end) : 0;
      pos.lerpVectors(p.clone().add(new THREE.Vector3(-3.7, 1.35, 3.9)), p.clone().add(new THREE.Vector3(0.4, 1.9, 5.6)), release);
      look.copy(p).add(new THREE.Vector3(0, 0.88, 0)); fov = THREE.MathUtils.lerp(70, 64, release);
    } else if (phase === 'aboard' || (phase === 'launch' && clock < 0.65)) {
      id = phase === 'launch' ? 'launch-console' : 'cockpit';
      ship.root.updateMatrixWorld(true); ship.cockpit.getWorldPosition(pos);
      look.copy(pos).add(new THREE.Vector3(0, phase === 'launch' ? -0.35 : 0.1, phase === 'launch' ? 2 : 100)); fov = 68;
    } else if (phase === 'launch') {
      if (clock < 4.2) { id = 'decompression-wide'; pos.set(11.5, 7.5, 26); look.set(-1, 2.5, 13 + (clock - 0.65) * 6); fov = 72; }
      else if (clock < 6.4) { id = 'launch-side'; pos.set(8.5, 4.5, ship.root.position.z - 9); look.copy(ship.root.position).add(new THREE.Vector3(0, 1.2, 0)); fov = 62; }
      else { id = 'launch-chase'; pos.set(0, ship.root.position.y + 5.5, ship.root.position.z - 15); look.copy(ship.root.position).add(new THREE.Vector3(0, 2.5, 15)); fov = 74; }
    } else if (phase === 'boarding') {
      if (clock < BOARDING.takeoff) { id = 'boarding-approach'; pos.set(5.5, 2.8, 15); look.copy(p).add(new THREE.Vector3(0, 0.9, 0.6)); fov = 62; }
      else if (clock < BOARDING.settle) { id = 'boarding-jump'; pos.set(5, 4.6, 18); look.copy(p).add(new THREE.Vector3(0, 0.75, 0)); fov = 60; }
      else { id = 'boarding-seat'; pos.copy(ship.root.localToWorld(new THREE.Vector3(-3.25, 3.45, -1.9))); look.copy(seatedPosition).add(new THREE.Vector3(0, 0.7, 0)); fov = 56; }
    } else if (phase === 'failed') {
      id = 'failure';
      if (shipFailure) { pos.copy(ship.root.position).add(new THREE.Vector3(9, 5, -11)); look.copy(ship.root.position).add(new THREE.Vector3(0, 1.5, 0)); fov = 68; }
      else { pos.copy(p).add(new THREE.Vector3(2.7, 0.85, -2.8)); look.copy(p).add(new THREE.Vector3(0, 0.6 * (1 - THREE.MathUtils.smoothstep(clock, 0.5, 2)), -0.35)); fov = 56; }
    } else {
      id = 'one-take';
      const orbit = phase === 'orbit' ? THREE.MathUtils.smootherstep(clock, 0, 1.65) : 1;
      const angle = orbitAngle * (1 - orbit), radius = THREE.MathUtils.lerp(orbitRadius, 5.6, orbit);
      pos.copy(p).add(new THREE.Vector3(Math.sin(angle) * radius + orbit * 0.4, THREE.MathUtils.lerp(orbitStart.y - p.y, 1.9, orbit), Math.cos(angle) * radius));
      look.copy(p).add(new THREE.Vector3(0, 0.95, 0)); fov = 64;
    }
    if ((phase === 'prompt' || phase === 'action') && promptFocus > 0.001) {
      const focus = p.clone().add(new THREE.Vector3(0, 0.98, 0));
      const zoom = promptFocus * (reducedMotion.matches ? 0.07 : 0.13) + promptPulse * 0.007;
      pos.lerp(focus, zoom); look.lerp(focus, promptFocus * 0.4);
      fov -= promptFocus * 5.5 + promptPulse * 0.65;
    }
    if (phase !== 'launch') { pos.x = THREE.MathUtils.clamp(pos.x, -16.8, 16.8); pos.z = THREE.MathUtils.clamp(pos.z, -34.8, 34.8); pos.y = THREE.MathUtils.clamp(pos.y, 0.55, 13.5); }
    const blend = shot === '' || phase === 'arrival' ? (id !== shot ? 1 : 1 - Math.exp(-12 * dt)) : 1 - Math.exp(-8 * dt);
    shotPosition.lerp(pos, blend); shotTarget.lerp(look, blend); shotFov = THREE.MathUtils.lerp(shotFov, fov, blend); shot = id;
  }
  function cameraView() {
    camera.position.copy(shotPosition); camera.lookAt(shotTarget);
    if (phase === 'orbit') camera.quaternion.slerpQuaternions(orbitRotation, camera.quaternion.clone(), THREE.MathUtils.smootherstep(clock, 0, 1.1));
    if (camera.fov !== shotFov) { camera.fov = shotFov; camera.updateProjectionMatrix(); }
    if (qte && (phase === 'prompt' || phase === 'aboard')) {
      camera.updateMatrixWorld(true);
      const anchor = phase === 'aboard' ? new THREE.Vector3(0, 1.7, 25) : new THREE.Vector3().copy(player.body.position).add(new THREE.Vector3(0, 2.25, 0));
      anchor.project(camera);
      qte.style.left = `${THREE.MathUtils.clamp((anchor.x + 1) * 50, 8, 92)}%`;
      qte.style.top = `${phase === 'aboard' ? 63 : THREE.MathUtils.clamp((1 - anchor.y) * 50, 8, 90)}%`;
    }
    return true;
  }
  function updateRobots(dt: number) {
    const shipBounds = new THREE.Box3().setFromObject(ship.root).expandByScalar(1.2);
    for (let i = 0; i < robots.length; i++) {
      const robot = robots[i];
      const charger = chargers.find(entry => entry.robot === robot);
      const charging = !!charger && (phase === 'charge' || (phase === 'prompt' && expected === 'KeyI') || (phase === 'action' && actionKey === 'KeyI'));
      if (phase === 'launch' && clock > 1.65 + (i % 8) * 0.09) {
        robot.body.collisionResponse = false;
        const side = i % 2 ? 1 : -1, overhead = i % 5 === 0;
        const laneX = overhead ? side * 2.5 : side * (7.3 + (i % 3) * 0.45);
        const laneY = overhead ? 8.5 : 3.4 + (i % 4) * 0.55;
        robot.vacuum.z = Math.min(46, robot.vacuum.z + dt * 13);
        robot.root.position.x = THREE.MathUtils.damp(robot.root.position.x, laneX, 3, dt);
        robot.root.position.y = THREE.MathUtils.damp(robot.root.position.y, laneY, 2.5, dt);
        robot.root.position.z += robot.vacuum.z * dt;
        const aperture = Math.min(8.8, THREE.MathUtils.smoothstep(clock, 0, 3) * 10.5 - 1.2);
        if (robot.root.position.z > 34.5 && robot.root.position.z < 38 && Math.abs(robot.root.position.x) > aperture) robot.root.position.z = 34.5;
        if (robot.root.position.z > 32 && robot.root.position.z < 40) {
          robot.root.position.x = THREE.MathUtils.clamp(robot.root.position.x, -8.8, 8.8);
          robot.root.position.y = Math.min(9.2, robot.root.position.y);
        }
        if (shipBounds.containsPoint(robot.root.position)) {
          if (overhead) robot.root.position.y = shipBounds.max.y + 0.3;
          else robot.root.position.x = side > 0 ? shipBounds.max.x + 0.3 : shipBounds.min.x - 0.3;
        }
        robot.root.rotation.x += dt * (1 + i % 3); robot.root.rotation.z += dt * side;
      } else if (robot.airborne) {
        robot.knockback.y -= dt * 12; robot.root.position.addScaledVector(robot.knockback, dt);
        robot.root.rotation.x += robot.tumble.x * dt; robot.root.rotation.y += robot.tumble.y * dt; robot.root.rotation.z += robot.tumble.z * dt;
        robot.root.position.x = THREE.MathUtils.clamp(robot.root.position.x, -16.5, 16.5);
        if (robot.root.position.y <= 0 && robot.knockback.y < 0) {
          robot.root.position.y = 0; robot.airborne = false; robot.knockback.set(0, 0, 0); robot.root.rotation.x = -Math.PI / 2;
        }
      } else if (!robot.stunned && charging && charger) {
        const target = phase === 'action'
          ? new THREE.Vector3(charger.intercept.x, 0, actionStart.z - 5.5)
          : charger.intercept;
        const progress = phase === 'charge' ? THREE.MathUtils.smootherstep(clock, 0, 1.25)
          : phase === 'action' ? THREE.MathUtils.smoothstep(clock, 0, ACTION_BEATS.KeyI.recover) : 1;
        robot.root.position.lerpVectors(charger.start, target, progress);
        robot.root.rotation.y = Math.atan2(target.x - charger.start.x, target.z - charger.start.z);
      } else if (!robot.stunned && phase === 'action' && actionKey === 'KeyO' && spinVictims.includes(robot)) {
        const p = player.body.position;
        const target = new THREE.Vector3(robot.side * 1.25, 0, p.z + (spinVictims.indexOf(robot) % 3 - 1) * 1.3);
        const toward = target.sub(robot.root.position);
        if (toward.lengthSq() > 0.01) robot.root.position.addScaledVector(toward.normalize(), dt * 3.5);
        robot.root.rotation.y = Math.atan2(p.x - robot.root.position.x, p.z - robot.root.position.z);
      } else if (!robot.stunned && ['orbit', 'escape', 'charge', 'prompt', 'action', 'boarding'].includes(phase)) {
        const p = player.body.position;
        if (!(phase === 'action' && robot === threat && actionKey === 'KeyU' && clock < ACTION_BEATS[actionKey].recover)) {
          const laneX = robot.side * (1.85 + (i % 3) * 1.25);
          const laneZ = p.z + (Math.floor(i / 8) % 3 - 1) * 6 + (i % 4) * 1.4;
          const toward = new THREE.Vector3(laneX - robot.root.position.x, 0, laneZ - robot.root.position.z);
          const distance = toward.length();
          if (distance > 0.01) robot.root.position.addScaledVector(toward, Math.min(distance, dt * 2.1) / distance);
        }
        robot.root.position.x = robot.side * Math.max(1.85, Math.abs(robot.root.position.x));
        robot.root.rotation.y = Math.atan2(p.x - robot.root.position.x, p.z - robot.root.position.z);
      } else if (!robot.stunned && phase !== 'arrival' && phase !== 'reveal' && phase !== 'versus' && !(phase === 'action' && robot === threat && clock < ACTION_BEATS[actionKey].recover)) {
        const p = player.body.position, toward = new THREE.Vector3(p.x - robot.root.position.x, 0, p.z - robot.root.position.z);
        robot.root.rotation.y = Math.atan2(toward.x, toward.z);
        if (toward.length() > 2.3 && phase !== 'failed') robot.root.position.addScaledVector(toward.normalize(), dt * 1.4);
      }
      if (!robot.stunned && !charging && !(phase === 'action' && actionKey === 'KeyO' && spinVictims.includes(robot)) && ['orbit', 'escape', 'charge', 'prompt', 'action', 'boarding'].includes(phase)) {
        robot.root.position.x = robot.side * Math.max(1.85, Math.abs(robot.root.position.x));
      }
      if (phase !== 'launch' && phase !== 'failed' && shipBounds.containsPoint(robot.root.position)) {
        robot.root.position.x = robot.root.position.x >= 0 ? shipBounds.max.x + 0.1 : shipBounds.min.x - 0.1;
      }
      robot.body.position.set(robot.root.position.x, robot.root.position.y + 0.5, robot.root.position.z); robot.body.aabbNeedsUpdate = true; robot.mixer.update(dt * (charging ? 2.5 : 1));
    }
  }
  updateShot(0); cameraView();
  return { roomId: 'scene14', scene, camera, physicsWorld, player, ship, robots, ready, gunReady, cutsceneManager: null,
    ownsWeaponInput: true,
    getDamageTargets: () => [],
    isCinematic: () => true, hideCharacter: () => phase === 'aboard' || (phase === 'launch' && clock < 0.65) || shipFailure,
    getControllerPhase: () => `${phase}:${stage}`,
    getCinematicWeapon: cinematicWeapon,
    getCinematicPose: cinematicPose,
    getCinematicDelta: () => paused || document.hidden ? 0 : animationDelta,
    getCinematicState() {
      const moving = cinematicPose()?.clip === 'Sprint_Loop';
      return { ...player.getState(), yaw: cinematicYaw(), pitch: 0, isOnGround: true, jumping: false, isMoving: moving, sprinting: moving, crouching: false, actionRequest: null };
    },
    updateCinematicCharacter(character: { model: THREE.Object3D; weapon: { socket: THREE.Object3D | null } } | null) {
      if (!character) return;
      if (phase === 'versus') versus.capture(character.model, robots.map(robot => robot.root));
      if (phase === 'action' && actionKey === 'KeyO' && clock >= ACTION_BEATS.KeyO.windup && clock < ACTION_BEATS.KeyO.recover) {
        const saber = character.model.getObjectByName('lightsaber');
        if (saber && lastBladeTime !== clock) {
          saber.updateWorldMatrix(true, true);
          const base = saber.localToWorld(new THREE.Vector3(0, 0.32, 0)), tip = saber.localToWorld(new THREE.Vector3(0, 1.22, 0));
          const previous = bladeHistory[0];
          const speed = previous ? tip.distanceTo(previous.tip) / Math.max(0.001, clock - previous.time) : 0;
          bladeHistory.unshift({ base, tip, time: clock, strength: THREE.MathUtils.smoothstep(speed, 0.9, 4) });
          if (bladeHistory.length > trailSamples) bladeHistory.pop();
          const bladeSegment = new THREE.Line3(base, tip);
          for (const robot of spinVictims) if (!robot.stunned) {
            const center = robot.root.position.clone().add(new THREE.Vector3(0, 0.65, 0));
            if (bladeSegment.closestPointToPoint(center, true, new THREE.Vector3()).distanceToSquared(center) < 1.1 * 1.1) {
              knockRobotAway(robot, new THREE.Vector3().copy(player.body.position)); impact = true;
            }
          }
          lastBladeTime = clock;
        }
      } else lastBladeTime = -1;
      if (phase === 'action' && actionKey === 'KeyO') {
        while (bladeHistory.length && clock - bladeHistory[bladeHistory.length - 1].time > trailLifetime) bladeHistory.pop();
        bladeHistory.forEach((sample, index) => {
          sample.base.toArray(spinTrailPositions, index * 6); sample.tip.toArray(spinTrailPositions, index * 6 + 3);
          const fade = Math.pow(Math.max(0, 1 - (clock - sample.time) / trailLifetime), 2) * sample.strength;
          spinTrailFade[index * 2] = spinTrailFade[index * 2 + 1] = fade;
        });
        spinTrailGeometry.attributes.position.needsUpdate = true; spinTrailGeometry.attributes.aFade.needsUpdate = true;
        spinTrailGeometry.setDrawRange(0, Math.max(0, bladeHistory.length - 1) * 6); spinTrail.visible = bladeHistory.length > 1;
      } else { bladeHistory.length = 0; spinTrail.visible = false; }
      if ((phase === 'boarding' && clock >= BOARDING.settle) || phase === 'aboard' || phase === 'launch') {
        const pelvis = character.model.getObjectByName('pelvis') ?? character.model.getObjectByName('hips') ?? character.model.getObjectByName('Hips');
        if (pelvis) {
          ship.root.updateMatrixWorld(true); ship.pilotSeat.getWorldPosition(seatedPosition);
          if (phase !== 'boarding') character.model.quaternion.copy(ship.root.getWorldQuaternion(new THREE.Quaternion()))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
          character.model.updateMatrixWorld(true);
          const offset = seatedPosition.clone().sub(pelvis.getWorldPosition(new THREE.Vector3()));
          const seated = phase === 'boarding' ? THREE.MathUtils.smootherstep(clock, BOARDING.settle, BOARDING.seated) : 1;
          character.model.position.addScaledVector(offset, seated);
          character.model.updateMatrixWorld(true);
        }
      }
      if (cinematicWeapon() === 'pistol' && gun && character.weapon.socket) {
        character.weapon.socket.add(gun); gun.position.set(0, 0.02, 0); gun.visible = true;
        if (beam.visible) {
          character.model.updateMatrixWorld(true);
          aimBeam(character.weapon.socket.localToWorld(new THREE.Vector3(0, 0.12, -0.38)));
        }
      } else gun?.removeFromParent();
    },
    applyCinematicCamera: cameraView,
    renderCinematicOverlay(renderer: THREE.WebGLRenderer) { if (phase === 'versus') versus.render(renderer); },
    clearInput: () => pressed.clear(),
    onPlayerDeath() { fail(); return true; },
    getSceneId: () => 'scene14', getMapLayout: () => BAY_FOURTEEN_MAP,
    getEscapeStatus: () => ({ phase, stage, expected, timeLeft, loaded, paused, clock, shot, impact }),
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed || transferred) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
      animationDelta = 0;
      if (paused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
      const realDt = dt;
      const frameStart = new THREE.Vector3().copy(player.body.position);
      const slowMotion = phase === 'charge' ? 0.65 : phase === 'action' && actionKey === 'KeyI' && clock < ACTION_BEATS.KeyI.recover ? 0.35
        : phase === 'action' && actionKey === 'KeyO' && clock >= ACTION_BEATS.KeyO.windup && clock < ACTION_BEATS.KeyO.recover ? 0.7
          : phase === 'prompt' ? 0.12 : 1;
      motionScale = THREE.MathUtils.damp(motionScale, slowMotion, 8, realDt);
      dt *= motionScale; animationDelta = dt;
      clock += dt;
      if (phase === 'arrival') {
        if (!loaded) clock = Math.min(clock, 1.4);
        const h = 3 * (1 - THREE.MathUtils.smoothstep(clock, 0, 2.4)); lift.position.y = h - 0.155; player.setPosition(0, h + 0.32, -29);
        if (clock >= 3.2 && loaded) { revealStart.copy(shotPosition); revealLook.copy(shotTarget); freeze(); phase = 'reveal'; clock = 0; }
      } else if (phase === 'reveal') {
        if (clock >= 8) { phase = 'versus'; clock = 0; qte?.classList.add('hidden'); versus.update(0); }
      } else if (phase === 'versus') {
        versus.update(clock);
        if (clock >= 2.6) { versus.hide(); beginEscape(); shot = ''; updateShot(0); cameraView(); }
      } else if (phase === 'orbit') {
        advanceRun(dt, 2.2);
        if (clock >= 1.65) beginPrompt();
      } else if (phase === 'escape') {
        advanceRun(dt, 4.4);
        if (stage >= ESCAPE_QTE.stages && player.body.position.z >= 15) { phase = 'boarding'; clock = 0; actionStart.copy(player.body.position); }
        else if (stage < ESCAPE_QTE.stages && player.body.position.z >= QTE_POSITIONS[stage]) {
          if (QTE_SEQUENCE[stage] === 'KeyI') beginCharge(); else beginPrompt();
        }
      } else if (phase === 'charge') {
        advanceRun(dt, 0.45);
        if (clock >= 1.25) beginPrompt();
      } else if (phase === 'prompt') {
        advanceRun(dt, 4.4);
        timeLeft = Math.max(0, timeLeft - realDt); if (timer) timer.style.width = `${timeLeft / ESCAPE_QTE.seconds * 100}%`;
        qte?.classList.toggle('urgent', timeLeft < 0.7);
        if (timeLeft <= 0) fail();
      } else if (phase === 'action') {
        const beats = ACTION_BEATS[actionKey], p = actionStart.clone();
        runTime += dt;
        let travel = THREE.MathUtils.clamp(clock / beats.end, 0, 1);
        if (actionKey === 'KeyO') {
          const step = Math.min(0.24, 1 / Math.max(1, actionEnd.z - actionStart.z));
          travel = clock < beats.recover ? step * THREE.MathUtils.smootherstep(clock, 0, 0.32)
            : step + (1 - step) * THREE.MathUtils.smoothstep(clock, beats.recover, beats.end);
        }
        p.lerp(actionEnd, travel);
        if (actionKey === 'KeyI') { p.x = 0; p.y += Math.sin(Math.min(1, clock / beats.recover) * Math.PI) * 0.04; }
        // The sampled upper-body attack leaves the running legs and forward travel active.
        player.setPosition(p.x, p.y, p.z);
        if (threat && actionKey === 'KeyU' && !impact) {
          // The attacking robot reaches the edge of the lane without crossing the runner's path.
          const intercept = new THREE.Vector3(threat.side * 1.85, 0, p.z + 0.25);
          threat.root.position.lerpVectors(threatStart, intercept, THREE.MathUtils.smoothstep(clock, 0, beats.impact));
        }
        if (actionKey !== 'KeyO' && clock >= beats.impact && !impact) {
          impact = true;
          if (threat && actionKey !== 'KeyI') stopRobot(threat);
        }
        beam.visible = flash.visible = actionKey === 'KeyY' && clock >= beats.impact && clock < beats.impact + 0.1;
        if (clock >= beats.end) { beam.visible = flash.visible = spinTrail.visible = false; chargers.length = 0; spinVictims.length = 0; stage++; phase = 'escape'; clock = 0; }
      } else if (phase === 'boarding') {
        const p = boardingRun.clone();
        if (clock < BOARDING.run) p.lerpVectors(actionStart, boardingRun, clock / BOARDING.run);
        else if (clock >= BOARDING.takeoff && clock < BOARDING.land) {
          const t = (clock - BOARDING.takeoff) / (BOARDING.land - BOARDING.takeoff);
          p.lerp(boardingDeck, THREE.MathUtils.smoothstep(t, 0, 0.66));
          p.y = THREE.MathUtils.lerp(boardingRun.y, boardingDeck.y, t) + Math.sin(t * Math.PI) * 2.6;
        } else if (clock >= BOARDING.land) {
          p.lerpVectors(boardingDeck, seatedPosition, THREE.MathUtils.smoothstep(clock, BOARDING.settle, BOARDING.seated));
        }
        player.setPosition(p.x, p.y, p.z);
        ship.setCanopyOpen(THREE.MathUtils.smoothstep(clock, 0, BOARDING.takeoff) * (1 - THREE.MathUtils.smoothstep(clock, BOARDING.seated, BOARDING.end)));
        if (clock >= BOARDING.end) {
          phase = 'aboard'; clock = 0; timeLeft = 3; ship.setCanopyOpen(0); player.setPosition(seatedPosition.x, seatedPosition.y, seatedPosition.z);
          updatePromptLabels(); qte?.classList.remove('hidden', 'urgent');
          if (actionLabel) actionLabel.textContent = 'LAUNCH BEFORE ENEMY FIRE DESTROYS THE SHUTTLE';
        }
      } else if (phase === 'aboard') {
        timeLeft = Math.max(0, 3 - clock); qte?.classList.toggle('urgent', timeLeft < 1.2);
        for (const s of siege) {
          const robot = robots[Math.floor(s.offset * robots.length)]; if (!robot) continue;
          const from = robot.root.position.clone().add(new THREE.Vector3(0, 0.6, 0));
          const to = ship.root.position.clone().add(new THREE.Vector3(Math.sin(s.offset * 30) * 1.8, 1.4, -1));
          const t = (clock * (1.8 + clock * 0.3) + s.offset) % 1;
          s.mesh.visible = true; s.mesh.position.lerpVectors(from, to, t);
          s.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
        }
        if (timeLeft <= 0) fail('LAUNCH WINDOW MISSED');
      } else if (phase === 'launch') {
        const opening = THREE.MathUtils.smoothstep(clock, 0, 3);
        for (const door of blastDoors) { door.mesh.position.x = door.sign * (5 + opening * 10.5); door.body.position.x = door.mesh.position.x; door.body.aabbNeedsUpdate = true; }
        wind.visible = clock > 1;
        for (let i = 2; i < windPositions.length; i += 3) { windPositions[i] += dt * 45; if (windPositions[i] > 75) windPositions[i] = -35; } windGeometry.attributes.position.needsUpdate = true;
        const travel = Math.max(0, clock - 4); ship.setFlying(travel > 0); ship.root.position.set(0, Math.min(3, travel), 21 + travel * travel * 3.5); ship.setThrust(Math.min(1.6, travel)); shipCollider.collisionResponse = false;
        ship.root.updateMatrixWorld(true); ship.pilotSeat.getWorldPosition(seatedPosition);
        player.setPosition(seatedPosition.x, seatedPosition.y, seatedPosition.z);
        if (clock > 9) {
          ship.update(dt); updateShot(dt); cameraView(); transferred = true;
          onLaunch({ ...player.captureTransition({ x: 0, y: 0, z: 0 }), launch: {
            shipPosition: ship.root.position.clone(), shipQuaternion: ship.root.quaternion.clone(),
            cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov, speed: travel * 7,
          } }); return;
        }
      } else if (phase === 'failed') {
        if (!shipFailure) {
          const drift = failedPosition.clone().addScaledVector(failedVelocity, (1 - Math.exp(-7 * clock)) / 7);
          player.setPosition(drift.x, drift.y, drift.z);
        }
        siege.forEach(s => { s.mesh.visible = false; });
        if (shipFailure) {
          const progress = Math.min(1, clock / 2.3);
          blastUniforms.uTime.value = clock; blastUniforms.uProgress.value = progress;
          shipBlast.scale.setScalar(1.2 + 9 * THREE.MathUtils.smoothstep(progress, 0, 0.46)); shipBlast.visible = progress < 1;
          ship.root.rotation.z = Math.sin(clock * 16) * Math.max(0, 0.18 - clock * 0.06);
          if (clock > 0.5) ship.root.visible = false;
        }
        if (clock > 3.2) { transferred = true; onFailure(); return; }
      }
      if (phase !== 'failed' && realDt > 0) lastTravel.copy(player.body.position).sub(frameStart).divideScalar(realDt);
      ship.update(dt); updateRobots(dt); physics.step(dt, player, thirdPerson);
      if (phase === 'prompt' || phase === 'aboard') updatePromptLabels();
      if (status) status.textContent = inputHint(assetError ? 'ROBOT ASSETS COULD NOT LOAD / E: retry' : phase === 'arrival' ? '14 / HANGAR\nLift arriving. One ship. Too many robots.' : phase === 'reveal' ? 'ESCAPE SHUTTLE / SWARM BLOCKING THE DECK' : phase === 'charge' ? 'INCOMING CHARGE' : phase === 'launch' ? 'HANGAR DEPRESSURIZING\nAll robots are being pulled into space. Launching toward the planet...' : phase === 'aboard' ? 'COCKPIT SEALED / PRESS E TO LAUNCH' : 'BREAK THROUGH THE SWARM', 'escape');
      updateShot(realDt); cameraView();
      if (planet.visible) animatePlanetBackdrop(planet, dt);
    },
    dispose() {
      if (disposed) return; disposed = true;
      versus.dispose();
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      window.removeEventListener(qteTapEvent, onQteTap, true);
      if (qteCaption) qteCaption.textContent = desktopCaption;
      if (qteHint) qteHint.textContent = desktopHint;
      qte?.classList.add('hidden'); qte?.classList.remove('urgent', 'letter-prompt'); qte?.removeAttribute('style'); qte?.setAttribute('aria-label', 'Timed escape action');
      prompt?.classList.add('hidden'); subtitles?.classList.add('hidden'); status?.classList.add('hidden');
      if (gun) { gun.removeFromParent(); scene.add(gun); }
      robots.forEach(r => { r.mixer.stopAllAction(); r.mixer.uncacheRoot(r.root); r.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); }); });
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
