/** Scene 9 - Twin freight lines, gravity restoration, and vent access controls. */
import * as THREE from 'three';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { LADDER } from '../utils/constants.js';
import { createSlidingPortal, roomBox, disposeRoom } from '../helpers/scene/shipRoom.js';
import { createCargoMouth, createConveyor, createLever, createHandle, cargoSign } from '../helpers/scene/cargoVisuals.js';
import { createCargoPuzzleState, advanceCargo, beltMoving, laneX, type CargoPuzzleState } from '../scripts/cargoPuzzle.js';
import { createCargoController } from '../scripts/cargoController.js';
import { createPuzzleCinematic } from '../scripts/puzzleCinematic.js';

export function createScene({ puzzle = createCargoPuzzleState(), gravityRestored, onGravityChanged, entryState, fromPassage = false, dropFromLadder = false }: {
  puzzle?: CargoPuzzleState; gravityRestored?: boolean; onGravityChanged?: (active: boolean) => void;
  entryState?: PlayerTransitionState; fromPassage?: boolean; dropFromLadder?: boolean;
} = {}) {
  if (gravityRestored !== undefined) puzzle.gravityRestored = gravityRestored;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020610);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  physicsWorld.gravity.y = puzzle.gravityRestored ? PHYSICS.gravity : 0;
  const steel = new THREE.MeshStandardMaterial({ color: 0x344653, metalness: 0.65, roughness: 0.48 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x131e29, metalness: 0.6, roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x82959e, metalness: 0.8, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe3a83b, roughness: 0.6 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x74ddff, emissive: 0x32b9ef, emissiveIntensity: 2 });
  const box = (s: [number, number, number], p: [number, number, number], m: THREE.Material = steel, solid = true) => roomBox(scene, physics, s, p, m, solid);
  box([24, 0.4, 26], [0, -0.2, 0], dark);
  // A real ceiling hatch above the center ladder; chutes occupy separate openings.
  for (const x of [-6.55, 6.55]) box([10.9, 0.4, 20.2], [x, 9.2, -2.9], dark);
  box([2.2, 0.4, 11.9], [0, 9.2, -7.05], dark);
  box([2.2, 0.4, 9], [0, 9.2, 5.6], dark);
  box([24, 0.4, 1.7], [0, 9.2, 12.15], dark);
  box([24, 0.4, 1.9], [0, 9.2, 8.15], dark);
  box([13.36, 0.4, 2.2], [0, 9.2, 10.2], dark);
  for (const side of [-1, 1]) box([3.08, 0.4, 2.2], [side * 10.46, 9.2, 10.2], dark);
  for (const side of [-1, 1]) {
    box([0.12, 2.2, 2.2], [side * 1.1, 10.1, 0], dark);
    box([2.2, 2.2, 0.12], [0, 10.1, side * 1.1], dark);
  }
  box([2.3, 0.2, 2.3], [0, 11.3, 0], dark);
  for (const x of [-7.8, 7.8]) box([2.4, 0.2, 2.4], [x, 9.5, 10.2], dark);
  for (const x of [-12, 12]) box([0.4, 9, 26], [x, 4.5, 0]);
  const passageDoor = createSlidingPortal(scene, physics, { x: 0, y: 0, z: -13, yaw: 0 }, 5.2, 9, '12 / HUB - UNLOCK FROM INSIDE');
  // Wall segments leave both machine mouths genuinely open visually.
  for (const side of [-1, 1]) {
    box([3.8, 9, 0.5], [side * 4.5, 4.5, -13]);
    box([2.8, 9, 0.5], [side * 10.6, 4.5, -13]);
    box([2.8, 6.5, 0.5], [side * 7.8, 5.75, -13]);
  }
  box([24, 1.1, 0.6], [0, 8.45, 13]);
  for (const side of [-1, 1]) {
    box([5.1, 7.8, 0.85], [side * 9.5, 3.9, 12.7], dark).name = 'LoadingDoor';
    for (let y = 0.6; y < 7.7; y += 1.15) box([4.7, 0.85, 0.12], [side * 9.5, y, 12.22], steel, false);
    box([0.08, 7.5, 0.15], [side * 6.65, 3.9, 12.05], cyan, false);
  }
  const fieldMaterial = new THREE.MeshBasicMaterial({ color: 0x388bca, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 7.8), fieldMaterial); field.position.set(0, 3.9, 12.9); field.name = 'PressureContainmentField'; scene.add(field);
  physics.addBox({ x: 24, y: 9, z: 0.25 }, { x: 0, y: 4.5, z: 13.1 });
  cargoSign(scene, '09 / ORBITAL LOADING BAY', [0, 8.45, 12.6], 9, Math.PI);
  const stars = new Float32Array(1200);
  for (let i = 0; i < stars.length; i += 3) { stars[i] = Math.sin(i * 12.9898) * 135; stars[i + 1] = Math.cos(i * 4.1414) * 85; stars[i + 2] = 45 + i % 153; }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xc7e9ff, size: 0.24 })));
  const sun = new THREE.DirectionalLight(0xb7d6ff, 2.5); sun.position.set(-25, 30, 25); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xa5d4f4, 0x29343c, 2.2));
  for (const z of [-9, 0, 9]) {
    const light = new THREE.PointLight(0xa7d9ff, 45, 22, 1.5); light.position.set(0, 7.6, z); scene.add(light);
    box([23, 0.12, 0.2], [0, 8.8, z], cyan, false);
  }
  const belts: ReturnType<typeof createConveyor>[] = [], mouths: ReturnType<typeof createCargoMouth>[] = [];
  for (const lane of [10, 11] as const) {
    const x = laneX(lane, true); belts.push(createConveyor(scene, physics, x, 11.3, -13)); mouths.push(createCargoMouth(scene, physics, x, -12.85));
    for (const dx of [-1.12, 1.12]) box([0.16, 1.3, 2.2], [x + dx, 8.7, 10.2], dark);
    for (const z of [9.1, 11.3]) box([2.4, 1.3, 0.12], [x, 8.7, z], dark);
    cargoSign(scene, `${lane} / CARGO ONLY`, [x, 3.1, -12.68], 3);
    for (const edge of [-1.4, 1.4]) box([0.055, 0.012, 23], [x + edge, 0.012, -0.5], yellow, false);
  }
  const ladderZ = 0, ladderTop = 9;
  for (const x of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, ladderTop, 8), trim); rail.position.set(x, ladderTop / 2, ladderZ); scene.add(rail);
  }
  for (let y = 0.35; y < ladderTop; y += LADDER.rungSpacing) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), trim); rung.rotation.z = Math.PI / 2; rung.position.set(0, y, ladderZ); scene.add(rung);
  }
  for (const x of [-1.1, 1.1]) box([0.1, 0.15, 2.2], [x, 8.98, 0], yellow, false);
  cargoSign(scene, '08 / VENT LADDER', [0, 8.5, -1.05], 2);
  const gravitySwitch = createLever(scene, physics, 0, 12.55, 'GRAVITY / E', Math.PI);
  const switches = { 10: createLever(scene, physics, 4, -12.65, 'VENT 10 / E'), 11: createLever(scene, physics, -4, -12.65, 'VENT 11 / HANDLE REQUIRED') };
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 8.6, z: LADDER.bodyOffset } }); player.enable();
  let entryTime = fromPassage ? 0 : (8.6 - (puzzle.gravityRestored ? 0.3 : 1.25)) / LADDER.climbSpeed;
  const entryDuration = entryTime, entryY = puzzle.gravityRestored ? 0.3 : 1.25;
  if (entryState && fromPassage) player.restoreTransition(entryState, passageDoor.frame);
  else if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: 8.6, z: LADDER.bodyOffset }, velocity: { x: 0, y: 0, z: 0 }, heldKeys: [], yaw: 0 }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  if (fromPassage) { if (!entryState) player.setPosition(0, 0.3, -11.7); player.setZeroGravity(!puzzle.gravityRestored); if (puzzle.shortcutUnlocked) passageDoor.openImmediately(); }
  else { player.setRotation(0); player.setLookLocked(true); player.setClimbing(true, -1); }
  const looseHandle = createHandle(); scene.add(looseHandle);
  function recoverHandle() {
    const p = puzzle.handlePosition;
    if (puzzle.handle === 'loose' && (!p || ![p.x, p.y, p.z].every(Number.isFinite) || Math.abs(p.x) > 11.5 || Math.abs(p.z) > 12 || p.y < -0.5 || p.y > 8.5)) {
      puzzle.handle = 'missing'; puzzle.handlePosition = null;
    }
  }
  const cargo = createCargoController(scene, physicsWorld, player, puzzle, 9, record => {
    recoverHandle();
    if (puzzle.handle !== 'missing') return;
    puzzle.handle = 'loose'; puzzle.handlePosition = { x: record.position.x, y: 0.3, z: THREE.MathUtils.clamp(record.position.z, -10.8, 10.8) };
  });
  const floatPoses = new Map<string, { start: THREE.Vector3; rotation: THREE.Quaternion; target: THREE.Vector3; spin: THREE.Quaternion }>();
  let floatTime = 0;
  function floatCargo(immediate = false) {
    floatPoses.clear(); floatTime = immediate ? 1.5 : 0;
    let i = 0;
    for (const [id, item] of cargo.objects) {
      const angle = i * 2.4;
      const target = new THREE.Vector3(Math.sin(angle) * 8.5, 2 + i % 5, Math.cos(angle) * 9);
      const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(i * 0.3, i * 0.6, i * 0.15));
      floatPoses.set(id, { start: new THREE.Vector3().copy(item.body.position), rotation: new THREE.Quaternion().copy(item.body.quaternion), target, spin });
      if (immediate) { item.body.position.set(target.x, target.y, target.z); item.body.quaternion.set(spin.x, spin.y, spin.z, spin.w); }
      i++;
    }
  }
  if (!puzzle.gravityRestored) floatCargo(true);
  let dropping = false, climbBoost = false;
  function releaseLadder() {
    entryTime = 0; dropping = true;
    player.setClimbing(false); player.setLookLocked(false); player.setZeroGravity(false); player.clearInput();
    player.body.position.z = 1.15; player.body.velocity.y = -5; player.body.aabbNeedsUpdate = true;
  }
  if (dropFromLadder && !fromPassage) releaseLadder();
  const cinematic = createPuzzleCinematic(player, camera);
  let onReturnToEight: (() => void) | null = null, returning = false, handedOff = false, disposed = false, returnTime = 0, elapsed = 0;
  const climbStart = new THREE.Vector3();
  const prompt = document.getElementById('interact-prompt'), status = document.getElementById('loading-bay-status');
  function near(position: THREE.Vector3) { const p = player.body.position; return Math.hypot(p.x - position.x, p.y + 0.9 - position.y, p.z - position.z) < 1.8; }
  function canInteract() { return player.isEnabled() && entryTime <= 0 && !returning && !cinematic.isCinematic(); }
  function canClimb() { const p = player.body.position; return !!onReturnToEight && p.y < 1.65 && Math.hypot(p.x, p.z - 0.7) < 1.3; }
  function interaction() {
    if (!canInteract()) return '';
    if (near(gravitySwitch.position)) return puzzle.gravityRestored ? 'E: enable zero gravity / stop conveyors' : 'E: restore gravity / start conveyors';
    if (near(switches[10].position)) return puzzle.gates[10] ? 'Vent 10 open' : puzzle.gravityRestored ? 'E: open vent 10' : 'Restore gravity to power vent controls';
    if (near(switches[11].position)) return puzzle.gates[11] ? 'Vent 11 open' : puzzle.handle === 'carried' ? 'E: install handle' : puzzle.handle === 'installed' ? (puzzle.gravityRestored ? 'E: open vent 11' : 'Restore gravity to power vent controls') : 'Missing handle: use navigator goggles to find breakable freight on line 11';
    if (puzzle.handle === 'loose' && near(looseHandle.position)) return 'E: pick up switch handle';
    if (canClimb()) return 'E: climb back into the vent';
    if (!puzzle.shortcutUnlocked && passageDoor.near(player)) return 'Hub door locked - unlock from the other side';
    return '';
  }
  function onKey(event: KeyboardEvent) {
    if (event.code === 'Space' && !event.repeat && player.isEnabled()) {
      if (entryTime > 0) { event.preventDefault(); releaseLadder(); return; }
      if (returning) { event.preventDefault(); climbBoost = true; player.clearInput(); return; }
    }
    if (event.code !== 'KeyE' || event.repeat || !canInteract()) return;
    if (near(gravitySwitch.position)) {
      puzzle.gravityRestored = !puzzle.gravityRestored; puzzle.alignment = puzzle.gravityRestored ? 1.5 : 0;
      physicsWorld.gravity.y = puzzle.gravityRestored ? PHYSICS.gravity : 0; player.setZeroGravity(!puzzle.gravityRestored);
      if (!puzzle.gravityRestored) floatCargo(); onGravityChanged?.(puzzle.gravityRestored);
    } else if (near(switches[10].position) && puzzle.gravityRestored && !puzzle.gates[10]) { puzzle.gates[10] = true; cinematic.begin(10); }
    else if (near(switches[11].position)) {
      if (puzzle.handle === 'carried') { puzzle.handle = 'installed'; puzzle.handlePosition = null; }
      else if (puzzle.handle === 'installed' && puzzle.gravityRestored && !puzzle.gates[11]) { puzzle.gates[11] = true; cinematic.begin(11); }
    } else if (puzzle.handle === 'loose' && near(looseHandle.position)) { puzzle.handle = 'carried'; puzzle.handlePosition = null; }
    else if (canClimb()) {
      returning = true; climbBoost = false; returnTime = 0; climbStart.copy(player.body.position); player.setRotation(0); player.setLookLocked(true); player.setClimbing(true);
    }
  }
  window.addEventListener('keydown', onKey);
  return { roomId: 'loading-bay', scene, camera, physicsWorld, physics, player, puzzle, cargo, gravitySwitch, switches, ladderZ, cutsceneManager: null,
    isGravityRestored: () => puzzle.gravityRestored, passageDoor, setPassageTrigger: passageDoor.setTrigger,
    setReturnToEight: (callback: () => void) => { onReturnToEight = callback; },
    getDamageTargets: cargo.getDamageTargets, setGogglesActive: cargo.setHighlighted,
    isCinematic: cinematic.isCinematic, getCinematicState: cinematic.getCinematicState, applyCinematicCamera: cinematic.applyCinematicCamera, getRenderScene: cinematic.getRenderScene, hideCharacter: cinematic.hideCharacter,
    updatePhysics(dt: number, thirdPerson = false) {
      if (disposed) return; dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      if (cinematic.isCinematic()) {
        prompt?.classList.add('hidden'); status?.classList.add('hidden');
        cinematic.update(dt); return;
      }
      elapsed += dt; advanceCargo(puzzle, dt);
      if (!puzzle.gravityRestored) {
        floatTime = Math.min(1.5, floatTime + dt);
        const t = THREE.MathUtils.smootherstep(floatTime, 0, 1.5);
        let i = 0;
        for (const [id, item] of cargo.objects) {
          const pose = floatPoses.get(id), angle = i++ * 2.4;
          if (pose) {
            const p = pose.start.clone().lerp(pose.target, t);
            p.x += Math.sin(elapsed * 0.4 + angle) * 0.15 * t;
            p.y += Math.cos(elapsed * 0.6 + angle) * 0.15 * t;
            const q = pose.rotation.clone().slerp(pose.spin, t);
            item.body.position.set(p.x, p.y, p.z); item.body.quaternion.set(q.x, q.y, q.z, q.w);
          }
        }
      }
      cargo.update(dt, !puzzle.gravityRestored); belts.forEach(b => b.update(puzzle)); mouths.forEach(m => m.update(beltMoving(puzzle) ? 1 : 0.1));
      gravitySwitch.update(true, puzzle.gravityRestored); switches[10].update(true, puzzle.gates[10]); switches[11].update(puzzle.handle === 'installed', puzzle.gates[11]);
      recoverHandle(); looseHandle.visible = puzzle.handle === 'loose'; if (puzzle.handlePosition) looseHandle.position.copy(puzzle.handlePosition);
      if (dropping && !puzzle.gravityRestored) player.body.velocity.y -= 9.82 * dt;
      physics.step(dt, player, thirdPerson);
      if (dropping && (player.getState().isOnGround || player.body.position.y <= entryY)) {
        dropping = false; player.setZeroGravity(!puzzle.gravityRestored);
      }
      if (entryTime > 0) {
        entryTime = Math.max(0, entryTime - dt); player.body.position.y = entryY + entryTime * LADDER.climbSpeed;
        player.body.position.z = LADDER.bodyOffset + THREE.MathUtils.smoothstep(entryDuration - entryTime, entryDuration - 0.4, entryDuration) * 1.5;
        player.body.aabbNeedsUpdate = true;
        if (entryTime === 0) { player.setClimbing(false); player.setLookLocked(false); player.setRotation(Math.PI); player.clearInput(); player.setZeroGravity(!puzzle.gravityRestored); }
      }
      if (returning) {
        returnTime += dt * (climbBoost ? 12 : 1); const mount = THREE.MathUtils.smoothstep(returnTime, 0, LADDER.mountDuration);
        const rise = Math.min(9.3 - climbStart.y, Math.max(0, returnTime - LADDER.mountDuration) * LADDER.climbSpeed);
        player.body.position.set(THREE.MathUtils.lerp(climbStart.x, 0, mount), climbStart.y + rise, THREE.MathUtils.lerp(climbStart.z, LADDER.bodyOffset, mount)); player.body.aabbNeedsUpdate = true;
        if (player.getHeadY() >= ladderTop && !handedOff) { handedOff = true; onReturnToEight?.(); if (disposed) return; }
      }
      if (prompt) { prompt.textContent = interaction(); prompt.classList.toggle('hidden', !prompt.textContent); }
      if (status) { status.classList.remove('hidden'); status.classList.toggle('restored', puzzle.gravityRestored); status.textContent = puzzle.gravityRestored
        ? `09 / CONVEYORS ${puzzle.alignment > 0 ? 'ALIGNING' : puzzle.feedBlocked ? 'BLOCKED - CLEAR DETACHED CARGO' : beltMoving(puzzle) ? 'ADVANCING' : 'STOPPED FOR HANDLING'}\nVent 10: ${puzzle.gates[10] ? 'open' : 'use right lever'} | Vent 11: ${puzzle.gates[11] ? 'open' : puzzle.handle === 'carried' ? 'install handle at left lever' : puzzle.handle === 'installed' ? 'use left lever' : 'repair left lever'}\n${puzzle.handle === 'carried' ? 'Carrying handle - weapons unavailable. E at left socket: install.' : puzzle.handle === 'installed' ? 'Handle installed. E: operate vent controls.' : puzzle.handle === 'loose' ? 'Handle released - E: pick up the loose handle.' : 'Navigator goggles reveal breakable crates. T: equip crowbar, click: break. E: interact.'}`
        : '09 / ZERO GRAVITY - MACHINERY OFFLINE\nWASD: drift | Space: rise | C: descend\nRestore gravity at the window-side control between the conveyors.'; }
      passageDoor.update(dt, player, puzzle.shortcutUnlocked && canInteract() && passageDoor.near(player));
      if (!disposed) player.updateCamera(0, thirdPerson);
    },
    dispose() { if (disposed) return; disposed = true; window.removeEventListener('keydown', onKey); prompt?.classList.add('hidden'); status?.classList.add('hidden'); cinematic.dispose(); cargo.dispose(); player.dispose(); physics.dispose(); disposeRoom(scene); },
  };
}
