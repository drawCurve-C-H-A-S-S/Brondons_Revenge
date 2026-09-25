import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import boyUrl from '../../assets/models/boy.glb';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox, createSlidingPortal, disposeRoom } from '../../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerTransitionState } from '../../scripts/player.js';
import { createLoadingBayBoss, type BossPillar } from '../../scripts/loadingBayBoss.js';

export const BOSS_ENTRY_SECONDS = 7;

/** Loading bay below passage 12, with a stair entrance and a stationary aerial boss. */
export function createScene({ entryState, defeated = false, checkpoint = false, onDefeated, onDescend, onRespawn, loadBoy = () => new GLTFLoader().loadAsync(boyUrl) }: {
  entryState?: PlayerTransitionState;
  defeated?: boolean;
  checkpoint?: boolean;
  onDefeated?: () => void;
  onRespawn?: () => void;
  onDescend?: (state: PlayerTransitionState) => void;
  loadBoy?: () => Promise<GLTF>;
} = {}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101a28); scene.fog = new THREE.Fog(0x101a28, 35, 95);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  const steel = new THREE.MeshStandardMaterial({ color: 0x3e5060, metalness: 0.65, roughness: 0.48 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x566575, metalness: 0.4, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202d3a, metalness: 0.6, roughness: 0.55 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xeaa64c, emissive: 0xb36419, emissiveIntensity: 0.65 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x93dbef });
  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = steel, solid = true) => roomBox(scene, physics, s, p, m, solid);
  // A real circular opening lets the lift descend through the deck.
  const deckShape = new THREE.Shape(); deckShape.moveTo(-20, -24); deckShape.lineTo(20, -24); deckShape.lineTo(20, 24); deckShape.lineTo(-20, 24); deckShape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 4.5, 0, Math.PI * 2, true); deckShape.holes.push(hole);
  const deckGeometry = new THREE.ExtrudeGeometry(deckShape, { depth: 0.5, bevelEnabled: false, curveSegments: 24 });
  deckGeometry.rotateX(-Math.PI / 2); deckGeometry.translate(0, -0.5, 0);
  const deck = new THREE.Mesh(deckGeometry, dark); deck.receiveShadow = true; scene.add(deck);
  const vertices = Array.from(deckGeometry.attributes.position.array);
  const deckBody = new CANNON.Body({ mass: 0, shape: new CANNON.Trimesh(vertices, Array.from({ length: vertices.length / 3 }, (_, i) => i)) }); physicsWorld.addBody(deckBody);
  const platform = new THREE.Group(); platform.name = 'HangarElevator'; scene.add(platform);
  const liftDeck = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.4, 48), steel); liftDeck.position.y = -0.2; platform.add(liftDeck);
  // A parked lift is walkable static ground; scripted descent owns it only after E.
  const liftBody = new CANNON.Body({ type: CANNON.Body.STATIC, mass: 0, material: physics.solidMaterial, shape: new CANNON.Cylinder(4.5, 4.5, 0.4, 48) }); liftBody.position.y = -0.2; physicsWorld.addBody(liftBody);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.62, 4.62, 14, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x293645, side: THREE.BackSide, metalness: 0.5, roughness: 0.6 })); shaft.position.y = -7.2; scene.add(shaft);
  const consoleRoot = new THREE.Group(); consoleRoot.name = 'ElevatorConsole'; consoleRoot.position.set(0, defeated ? 0 : -1.5, -2.8); platform.add(consoleRoot);
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.6), steel); pedestal.position.y = 0.55; consoleRoot.add(pedestal);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.42, 0.09), cyan); screen.position.set(0, 1.12, -0.3); screen.rotation.x = -0.2; consoleRoot.add(screen);
  const consoleBody = physics.addBox({ x: 0.8, y: 1.3, z: 0.7 }, { x: 0, y: 0.65, z: -2.8 }); consoleBody.collisionResponse = defeated;
  box([0.6, 14, 48], [-20, 7, 0], wall); box([0.6, 14, 48], [20, 7, 0], wall);
  box([40, 14, 0.6], [0, 7, 24], wall); box([40, 0.5, 48], [0, 14, 0], dark);
  box([40, 3, 0.5], [0, 1.5, -24], wall);
  const door = createSlidingPortal(scene, physics, { x: 0, y: 3, z: -24, yaw: 0 }, 40, 11, '12 / TRANSFER PASSAGE');
  box([5, 3, 3], [0, 1.5, -22.5], steel);
  const stairs = physics.addStaircase({ width: 5, run: 9, rise: 3, position: { x: 0, y: 0, z: -12 }, yaw: Math.PI, stepCount: 18, material: steel });
  stairs.group.name = 'ArenaEntryStairs'; scene.add(stairs.group);
  // Rails follow the physical wedge rather than obstructing the walkable stair surface.
  for (const x of [-2.65, 2.65]) {
    for (let i = 0; i <= 6; i++) box([0.12, 1, 0.12], [x, 0.5 + i * 0.5, -12 - i * 1.5], amber);
    const rail = box([0.13, 0.13, Math.hypot(9, 3)], [x, 2.5, -16.5], amber, false);
    rail.rotation.x = Math.atan(3 / 9); physics.addBoxFromMesh(rail);
    box([0.14, 1, 3], [x, 3.5, -22.5], amber);
  }
  const pillars: THREE.Mesh[] = [], covers: BossPillar[] = [];
  const rubble: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];
  const rubbleGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const x of [-13, 13]) for (const z of [-15, 15]) {
    const pillar = box([3, 14, 3], [x, 7, z], wall, false); pillar.name = 'ArenaCoverPillar'; pillars.push(pillar);
    const parts = [pillar, box([3.5, 0.35, 3.5], [x, 0.175, z], steel, false)];
    const bodies = [physics.addBox({ x: 3, y: 14, z: 3 }, { x, y: 7, z }), physics.addBox({ x: 3.5, y: 0.35, z: 3.5 }, { x, y: 0.175, z })];
    for (const y of [1.2, 5.5, 10]) parts.push(box([3.06, 0.16, 3.06], [x, y, z], y === 1.2 ? amber : dark, false));
    let intact = true;
    covers.push({ position: new THREE.Vector3(x, 0, z), intact: () => intact, shatter() {
      if (!intact) return; intact = false; parts.forEach(part => { part.visible = false; }); bodies.forEach(body => physicsWorld.removeBody(body));
      for (let i = 0; i < 42; i++) {
        const mesh = new THREE.Mesh(rubbleGeometry, i % 4 ? wall : steel);
        mesh.scale.set(0.3 + (i % 3) * 0.25, 0.35 + (i % 4) * 0.18, 0.45);
        mesh.position.set(x + Math.sin(i) * 1.2, 0.5 + (i / 42) * 13, z + Math.cos(i) * 1.2); scene.add(mesh);
        rubble.push({ mesh, velocity: new THREE.Vector3(Math.sin(i * 4) * 6, 2 + i % 5, Math.cos(i * 7) * 6), life: 7 });
      }
    } });
  }
  for (let z = -20; z <= 20; z += 4) {
    if (Math.abs(z) >= 5) box([39, 0.015, 0.025], [0, 0.012, z], steel, false);
    for (const x of [-19.64, 19.64]) box([0.05, 0.12, 2.8], [x, 3, z], cyan, false);
  }
  // Giant sealed cargo doors and a loading lane establish the second bay.
  for (const x of [-5.1, 5.1]) box([9.8, 10, 0.2], [x, 5, 23.63], dark, false);
  for (let x = -9; x <= 9; x += 1.5) box([0.08, 9.2, 0.06], [x, 5, 23.48], steel, false);
  for (const x of [-6, 6]) box([0.16, 0.016, 34], [x, 0.014, 2], amber, false);
  for (const x of [-12, 0, 12]) box([0.5, 0.12, 38], [x, 13.65, 0], cyan, false);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.35, 4.48, 64), amber); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; platform.add(ring);
  scene.add(new THREE.HemisphereLight(0xb8d8ff, 0x31343a, 2));
  for (const x of [-10, 10]) for (const z of [-10, 10]) {
    const light = new THREE.PointLight(0xb4dbff, 120, 35); light.position.set(x, 11, z); scene.add(light);
  }
  const keyLight = new THREE.DirectionalLight(0xf4e9d2, 2.5); keyLight.position.set(-5, 12, -8); scene.add(keyLight);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 150);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 3.3, z: -22.8 } }); player.enable();
  if (entryState) player.restoreTransition(entryState, door.frame); else player.setRotation(Math.PI);
  if (checkpoint) player.setPosition(0, 0.3, defeated ? -6.2 : -10.2);
  door.openImmediately();
  let deathClock = 0;
  let disposed = false, cleared = defeated, cinematic: 'entry' | 'reveal' | 'lift' | null = defeated || checkpoint ? null : 'entry', cinematicTime = 0;
  let liftTransferred = false;
  const liftPassenger = new THREE.Vector3();
  const boyOrigin = new THREE.Vector3();
  const prompt = document.getElementById('interact-prompt');
  function nearConsole() { return cleared && !cinematic && player.isEnabled() && player.getState().isOnGround && Math.hypot(player.body.position.x, player.body.position.z + 2.8) < 1.65 && Math.hypot(player.body.position.x, player.body.position.z) < 4.2; }
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || !nearConsole() || !onDescend) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, [contenteditable="true"]')) return;
    event.preventDefault(); cinematic = 'lift'; cinematicTime = 0;
    liftPassenger.set(player.body.position.x, player.radius, player.body.position.z);
    for (const body of [liftBody, consoleBody]) { body.type = CANNON.Body.KINEMATIC; body.updateMassProperties(); body.wakeUp(); }
    freeze(); player.body.collisionResponse = false; prompt?.classList.add('hidden');
  }
  window.addEventListener('keydown', onKey);
  const entryStart = new THREE.Vector3().copy(player.body.position);
  let boy: THREE.Group | null = null, boyMixer: THREE.AnimationMixer | null = null;
  let boyError = false;
  const hud = document.getElementById('boss-hud'), fill = document.getElementById('boss-health-fill');
  const label = document.getElementById('boss-health-label'), phaseLabel = document.getElementById('boss-phase');
  const subtitles = document.getElementById('boss-subtitles');
  const status = document.getElementById('loading-bay-status');
  status?.classList.add('hidden');
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 1, depthWrite: false });
  const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cloud = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, 260); cloud.name = 'BossBlackParticles'; cloud.visible = false; cloud.frustumCulled = false; scene.add(cloud);
  const particles = Array.from({ length: 260 }, () => ({ start: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 7, (Math.random() - 0.5) * 5), drift: new THREE.Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2), size: 0.2 + Math.random() * 0.5 }));
  function freeze() { player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.updateMassProperties(); player.body.velocity.set(0, 0, 0); }
  function release() { player.body.type = CANNON.Body.DYNAMIC; player.body.updateMassProperties(); player.enable(); }
  if (cinematic) freeze();
  const boss = createLoadingBayBoss(scene, physicsWorld, player, () => {
    cinematic = 'reveal'; cinematicTime = 0; freeze(); cloud.visible = true;
    if (boy) boy.visible = true;
  }, covers);
  if (defeated) boss.dispose();
  else if (checkpoint) { door.setLocked(true); boss.start(); }
  const ready = loadBoy().then(gltf => {
    if (disposed) { disposeRoom(gltf.scene as unknown as THREE.Scene); return; }
    boy = gltf.scene; boy.name = 'FreedBoy';
    const bounds = new THREE.Box3().setFromObject(boy), height = bounds.getSize(new THREE.Vector3()).y;
    boy.scale.multiplyScalar(1.75 / Math.max(height, 0.01));
    bounds.setFromObject(boy); const center = bounds.getCenter(new THREE.Vector3());
    boy.position.set(-center.x, -bounds.min.y, -center.z); boyOrigin.copy(boy.position);
    if (cleared) boy.position.x += 6.7;
    scene.add(boy);
    boy.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    boy.visible = cleared || cinematic === 'reveal';
    boyMixer = new THREE.AnimationMixer(boy);
    const idle = gltf.animations.find(clip => /idle/i.test(clip.name));
    if (idle) boyMixer.clipAction(idle).play();
  }).catch(error => { if (!disposed) { boyError = true; console.error('[Scene 13] Failed to load boy.glb:', error); } });
  function applyCinematicCamera() {
    if (!cinematic) return false;
    if (cinematic === 'entry') {
      const p = player.body.position;
      camera.position.set(p.x + 2.1, p.y + 2.1, Math.max(-23.4, p.z - 3));
      camera.lookAt(0, cinematicTime < 5.5 ? p.y + 0.8 : 5.8, cinematicTime < 5.5 ? p.z + 2.5 : 0);
    } else if (cinematic === 'lift') {
      camera.position.set(2.6, platform.position.y + 3, 0.5); camera.lookAt(player.body.position.x, player.body.position.y + 0.8, player.body.position.z);
    } else {
      const t = Math.min(1, cinematicTime / 3.5);
      camera.position.set(5 - t * 2.4, 3 - t * 1.2, -7 + t * 2.5);
      camera.lookAt(cinematicTime > 15 ? 0 : (boy?.position.x ?? 0), cinematicTime > 15 ? 0.8 : 1.1, cinematicTime > 15 ? -2.8 : 0);
    }
    return true;
  }
  function updateCinematic(dt: number) {
    if (!cinematic) return;
    cinematicTime += dt;
    if (cinematic === 'reveal' && !boy && !boyError) cinematicTime = Math.min(cinematicTime, 2.5);
    if (cinematic === 'entry') {
      // Walk across the landing, descend the physical stair run, then face the robot.
      const distance = Math.min(1, cinematicTime / 5.8);
      const z = THREE.MathUtils.lerp(entryStart.z, -10.2, distance);
      const y = z < -21 ? 3 : z < -12 ? (-12 - z) / 3 : 0;
      player.setPosition(THREE.MathUtils.lerp(entryStart.x, 0, Math.min(1, distance * 5)), y + player.radius, z); player.setRotation(Math.PI);
      if (subtitles) { subtitles.classList.remove('hidden'); subtitles.textContent = cinematicTime < 5 ? 'LOWER LOADING BAY / 13' : 'That machine is guarding the bay.'; }
      if (cinematicTime >= BOSS_ENTRY_SECONDS) { cinematic = null; release(); door.setLocked(true); boss.start(); subtitles?.classList.add('hidden'); }
    } else if (cinematic === 'lift') {
      platform.position.y = -12 * THREE.MathUtils.smoothstep(cinematicTime, 0, 4.5);
      liftBody.position.y = platform.position.y - 0.2; liftBody.aabbNeedsUpdate = true;
      consoleBody.position.y = platform.position.y + 0.65; consoleBody.aabbNeedsUpdate = true;
      player.setPosition(liftPassenger.x, liftPassenger.y + platform.position.y, liftPassenger.z);
      if (subtitles) { subtitles.classList.remove('hidden'); subtitles.textContent = 'DESCENDING / HANGAR 14'; }
      if (cinematicTime >= 4.8 && !liftTransferred) { liftTransferred = true; onDescend?.(player.captureTransition({ x: 0, y: platform.position.y, z: 0 })); }
    } else {
      const t = Math.min(1, cinematicTime / 3.5), dummy = new THREE.Object3D();
      cloudMaterial.opacity = 1 - t;
      particles.forEach((p, i) => { dummy.position.copy(p.start).addScaledVector(p.drift, cinematicTime); dummy.scale.setScalar(p.size * (1 - t * 0.8)); dummy.rotation.set(t * i, t * 3, t); dummy.updateMatrix(); cloud.setMatrixAt(i, dummy.matrix); });
      cloud.instanceMatrix.needsUpdate = true;
      if (boy) { boy.visible = true; boy.rotation.y = Math.PI - 0.5; boy.position.x = boyOrigin.x + 6.7 * THREE.MathUtils.smoothstep(cinematicTime, 13, 17); }
      consoleRoot.position.y = -1.5 * (1 - THREE.MathUtils.smoothstep(cinematicTime, 15, 18));
      if (subtitles) {
        subtitles.classList.remove('hidden');
        subtitles.textContent = cinematicTime < 3.5 ? 'The black shell is breaking apart...'
          : cinematicTime < 8.5 ? '"Thank you for defeating that thing. I was trapped inside. You saved me."'
          : cinematicTime < 15 ? '"The AI took your friends to the nearest planet. It is experimenting on them, just like it did to me."'
          : '"Take this lift down to the hangar. Reach the ship and go after them. Use the console when you are ready."';
        if (boyError && cinematicTime < 3.5) subtitles.textContent = 'The prisoner is free. (Character model could not be loaded.)';
      }
      if (cinematicTime >= 21) {
        cloud.visible = false; cinematic = null; cleared = true; door.setLocked(false); consoleBody.collisionResponse = true; release(); subtitles?.classList.add('hidden'); onDefeated?.();
      }
    }
  }
  function updateHud() {
    const s = boss.getStatus();
    hud?.classList.toggle('hidden', cleared || cinematic !== null);
    if (cleared && !cinematic && prompt) { prompt.textContent = 'Press E to interact — descend to hangar'; prompt.classList.toggle('hidden', !nearConsole()); }
    if (fill) fill.style.width = `${s.health / s.maxHealth * 100}%`;
    if (label) label.textContent = `BAY WARDEN / ${s.health} / ${s.maxHealth}`;
    if (phaseLabel) phaseLabel.textContent = s.phase === 'exposed' ? `HEAD EXPOSED: ${s.remaining.toFixed(1)}s | T: crowbar | N: scan`
      : s.phase === 'windup' ? `CHARGE BUILDUP / GET BEHIND A PILLAR (${s.pillarsRemaining} LEFT)`
      : s.phase === 'rushing' ? 'WARDEN CHARGING / KEEP CLEAR'
      : s.phase === 'recovering' ? 'WARDEN RECOVERING / REPOSITION'
      : s.phase === 'falling' ? 'WARDEN FALLING / GET TO THE HEAD'
      : s.phase === 'rising' ? 'REBUILDING ARMOR / TWO SHOTS PER TARGET'
      : `${s.targets.filter(h => h > 0).length} TARGETS / ${s.round === 1 ? 'ONE SHOT' : 'TWO SHOTS'} EACH | K: pistol | ${s.charging ? 'LASER CHARGING / DODGE' : 'USE THE PILLARS FOR COVER'}`;
  }
  updateHud(); applyCinematicCamera();
  return { roomId: 'scene13', scene, camera, physics, physicsWorld, player, door, boss, pillars, ready, cutsceneManager: null,
    elevator: { platform, body: liftBody, console: consoleRoot, consoleBody },
    getLiftStatus: () => ({ ready: cleared && !cinematic, canInteract: nearConsole(), descending: cinematic === 'lift', transferred: liftTransferred }),
    setBackTrigger: door.setTrigger, getDamageTargets: () => cleared ? [] : boss.getDamageTargets(), setGogglesActive: boss.setGogglesActive,
    isCinematic: () => cinematic !== null,
    getCinematicState: () => cinematic ? { ...player.getState(), isMoving: cinematic === 'entry' && cinematicTime < 5.8, isOnGround: true, jumping: false, climbing: false, velocityY: 0 } : null,
    applyCinematicCamera,
    onPlayerDeath() {
      if (!onRespawn) return false;
      if (!deathClock) { deathClock = 1.4; freeze(); if (subtitles) { subtitles.textContent = 'WARDEN CHECKPOINT / RESTARTING'; subtitles.classList.remove('hidden'); } }
      return true;
    },
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
      if (deathClock > 0) { deathClock = Math.max(0, deathClock - dt); if (!deathClock) onRespawn?.(); return; }
      updateCinematic(dt); if (disposed) return;
      physics.step(dt, player, thirdPerson); boyMixer?.update(dt);
      for (const piece of rubble) {
        if (piece.life <= 0) continue;
        piece.life -= dt; piece.velocity.y -= dt * 9.82; piece.mesh.position.addScaledVector(piece.velocity, dt);
        if (piece.mesh.position.y < 0.12) { piece.mesh.position.y = 0.12; piece.velocity.set(0, 0, 0); }
        else { piece.mesh.rotation.x += dt * 2; piece.mesh.rotation.z += dt; }
        if (piece.life <= 0) piece.mesh.visible = false;
      }
      door.update(dt, player, cleared && !cinematic && door.near(player));
      if (disposed) return;
      updateHud(); applyCinematicCamera();
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKey); prompt?.classList.add('hidden');
      hud?.classList.add('hidden'); subtitles?.classList.add('hidden');
      boss.dispose(); boyMixer?.stopAllAction(); if (boy) boyMixer?.uncacheRoot(boy);
      player.dispose(); physics.dispose(); disposeRoom(scene); rubbleGeometry.dispose();
    },
  };
}
