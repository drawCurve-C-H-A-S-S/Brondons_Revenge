import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addPlanetBackdrop, createEscapePod, createEscapeShip } from '../scripts/items/createEscapeShip.js';
import { createPlayer } from '../scripts/player.js';
import { createScenePhysics } from '../helpers/physics/scenePhysics.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import type { FlightExitState } from './scene15.js';
import { createRescueSite, RESCUE_SITE, JUNGLE_ENTRY_YAW, type RescueArrival } from '../helpers/scene/rescueSite.js';

/** An uninterrupted handoff, then pursuit, atmospheric entry, and the crash. */
export function createScene({ entryState, onFinished }: { entryState?: FlightExitState; onFinished: (arrival: RescueArrival) => void }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x01040b);
  const physics = createScenePhysics(), physicsWorld = physics.world; physicsWorld.gravity.set(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(entryState?.cameraFov ?? 76, window.innerWidth / window.innerHeight, 0.1, 50000);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 0, z: 0 } });
  if (entryState?.pilotState) player.restoreTransition(entryState.pilotState, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.disable(); player.body.type = CANNON.Body.KINEMATIC; player.body.collisionResponse = false; player.body.updateMassProperties();
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.add('space-cinematic');
  for (const id of ['flight-hud', 'flight-controls', 'flight-target', 'space-crosshair', 'space-enemy-count', 'space-boss-hud', 'space-alert', 'space-damage', 'space-pause', 'boss-subtitles', 'escape-qte']) document.getElementById(id)?.classList.add('hidden');
  const caption = document.getElementById('space-cinematic-caption');
  caption?.classList.remove('hidden');

  const planetRadius = 900;
  const planetPosition = entryState?.planetPosition.clone() ?? new THREE.Vector3(0, 200, 14000);
  const planet = addPlanetBackdrop(scene, planetPosition, planetRadius, 30000);
  const starfield = scene.getObjectByName('Starfield');
  scene.add(new THREE.HemisphereLight(0xa3cfff, 0x181321, 2));
  const sun = new THREE.DirectionalLight(0xffecd8, 3.5); sun.position.set(-5000, 7000, -2500); scene.add(sun);
  const pod = createEscapePod(); pod.name = 'CrashPod'; scene.add(pod);
  const shuttle = createEscapeShip(); shuttle.setFlying(true, true); shuttle.setThrust(1.6); scene.add(shuttle.root);
  const shipStart = entryState?.shipPosition.clone() ?? new THREE.Vector3();
  const podStart = entryState?.podPosition.clone() ?? new THREE.Vector3(0, 16, 500);
  const modelForward = new THREE.Vector3(0, 0, -1);
  shuttle.root.position.copy(shipStart);
  shuttle.root.quaternion.copy(entryState?.shipQuaternion ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  pod.position.copy(podStart);
  if (entryState) pod.quaternion.copy(entryState.podQuaternion);
  const cameraStart = entryState?.cameraPosition.clone() ?? shipStart.clone().add(new THREE.Vector3(0, 12, -34));
  camera.position.copy(cameraStart);
  if (entryState) camera.quaternion.copy(entryState.cameraQuaternion); else camera.lookAt(pod.position);
  const cameraStartRotation = camera.quaternion.clone();

  // All shots use the same world and the same planet; the impact is on its surface.
  const surfaceNormal = podStart.clone().sub(planetPosition).normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.24);
  const side = new THREE.Vector3(1, 0, 0).addScaledVector(surfaceNormal, -surfaceNormal.x).normalize();
  const crashSite = planetPosition.clone().addScaledVector(surfaceNormal, planetRadius + 1.2);
  const entryPoint = crashSite.clone().addScaledVector(surfaceNormal, 700).addScaledVector(side, 120);
  const travelDirection = entryPoint.clone().sub(podStart).normalize();
  const spacePath = new THREE.CubicBezierCurve3(podStart, podStart.clone().addScaledVector(travelDirection, 2200), entryPoint.clone().addScaledVector(surfaceNormal, 2000), entryPoint);
  const descentPath = new THREE.CubicBezierCurve3(entryPoint, crashSite.clone().addScaledVector(surfaceNormal, 480).addScaledVector(side, 85), crashSite.clone().addScaledVector(surfaceNormal, 150).addScaledVector(side, 24), crashSite);
  function podPositionAt(time: number) {
    if (time <= 7) return spacePath.getPoint(THREE.MathUtils.clamp(time / 7, 0, 1));
    const progress = THREE.MathUtils.clamp((time - 7) / 10, 0, 1);
    return descentPath.getPoint(progress * 0.5 + progress * progress * 0.5);
  }

  const debrisPositions = new Float32Array(180 * 3);
  for (let i = 0; i < debrisPositions.length; i += 3) {
    debrisPositions[i] = (Math.random() - 0.5) * 12;
    debrisPositions[i + 1] = (Math.random() - 0.5) * 12;
    debrisPositions[i + 2] = Math.random() * 45;
  }
  const debrisGeo = new THREE.BufferGeometry(); debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
  const debris = new THREE.Points(debrisGeo, new THREE.PointsMaterial({ color: 0xffaa55, size: 0.6, transparent: true, opacity: 0.85, depthWrite: false }));
  debris.frustumCulled = false; scene.add(debris);
  const trail = pod.getObjectByName('PodTrail');
  const explosionMaterial = new THREE.MeshBasicMaterial({ color: 0xffbb66, transparent: true, opacity: 0, depthWrite: false });
  const explosion = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), explosionMaterial);
  explosion.position.copy(crashSite).addScaledVector(surfaceNormal, 4); scene.add(explosion);
  const shockwaveMaterial = new THREE.MeshBasicMaterial({ color: 0xffddaa, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), shockwaveMaterial);
  shockwave.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
  shockwave.position.copy(crashSite).addScaledVector(surfaceNormal, 0.5); scene.add(shockwave);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(13, 32), new THREE.MeshBasicMaterial({ color: 0x1b1513, side: THREE.DoubleSide }));
  crater.position.copy(crashSite); crater.quaternion.copy(shockwave.quaternion); crater.visible = false; scene.add(crater);
  const smoke = Array.from({ length: 9 }, (_, index) => {
    const material = new THREE.MeshBasicMaterial({ color: index % 2 ? 0x302c29 : 0x514338, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material); scene.add(mesh); return mesh;
  });
  const beacon = new THREE.PointLight(0x88ddff, 0, 35); beacon.position.copy(crashSite).addScaledVector(surfaceNormal, 3); scene.add(beacon);

  const orbital = new THREE.Group(); for (const child of [...scene.children]) orbital.add(child); scene.add(orbital);
  const site = createRescueSite(physics); site.scene.visible = false; scene.add(site.scene);
  site.boy.visible = false; site.ship.setFlying(true, true);
  const groundPoint = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).add(RESCUE_SITE.landingOffset);
  const groundPodStart = groundPoint(-55, 100, -105);
  const groundPodPath = new THREE.CubicBezierCurve3(groundPodStart, groundPoint(-30, 68, -55), groundPoint(0, 22, -3), RESCUE_SITE.pod);
  let clock = 0, disposed = false, finished = false, paused = false;
  const duration = 44;
  function groundCamera() {
    const t = clock - 11; camera.up.set(0, 1, 0);
    if (t < 4) {
      camera.position.copy(groundPoint(17, 2.2, 23)); camera.lookAt(site.pod.position); camera.fov = 62;
    } else if (t < 11) {
      camera.position.copy(groundPoint(18 - (t - 4) * 0.5, 7, 26)); camera.lookAt(groundPoint(-2, 2.5, 12)); camera.fov = 62;
    } else if (t < 17) {
      camera.position.copy(groundPoint(15, 4, 22)); camera.lookAt(new THREE.Vector3().copy(player.body.position).lerp(site.boy.position, 0.4).add(new THREE.Vector3(0, 0.8, 0))); camera.fov = 58;
    } else if (t < 23) {
      camera.position.copy(groundPoint(1, 2.3, 17)); camera.lookAt(site.boy.position.clone().add(new THREE.Vector3(0, 1.1, 0))); camera.fov = 56;
    } else {
      const pan = THREE.MathUtils.smootherstep(t, 23, 28), handoff = THREE.MathUtils.smootherstep(t, 29, 33);
      camera.position.lerpVectors(groundPoint(1, 2.3, 17), new THREE.Vector3(-50, 42, 52), pan);
      const target = new THREE.Vector3().copy(site.boy.position).add(new THREE.Vector3(0, 1.1, 0)).lerp(new THREE.Vector3(0, 24, -68), pan);
      camera.position.lerp(RESCUE_SITE.player.clone().add(new THREE.Vector3(0, 1.3, 0)), handoff);
      const pathLook = RESCUE_SITE.player.clone().add(new THREE.Vector3(-Math.sin(JUNGLE_ENTRY_YAW) * 15, 1.3, -Math.cos(JUNGLE_ENTRY_YAW) * 15));
      target.lerp(pathLook, handoff); camera.lookAt(target); camera.fov = THREE.MathUtils.lerp(56, 75, handoff);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function updateGround(dt: number) {
    const t = clock - 11; orbital.visible = false; site.scene.visible = true;
    scene.background = site.scene.background; scene.fog = site.scene.fog;
    const fall = THREE.MathUtils.clamp(t / 4, 0, 1);
    site.pod.position.copy(groundPodPath.getPoint(fall));
    if (t < 4) {
      site.pod.quaternion.setFromUnitVectors(modelForward, groundPodPath.getTangent(fall).normalize()); site.pod.rotateZ(Math.sin(t * 13) * 0.2);
    } else site.pod.rotation.set(0, -0.25, 0.18);
    site.pod.getObjectByName('PodTrail')!.visible = t < 4;
    site.setImpact(t - 4);
    const land = THREE.MathUtils.smootherstep(t, 5, 10);
    site.ship.root.visible = t >= 4.3;
    site.ship.root.position.lerpVectors(groundPoint(-12, 48, 30), RESCUE_SITE.ship, land);
    site.ship.root.rotation.set((1 - land) * -0.2, 0, (1 - land) * -0.15);
    site.ship.setFlying(t < 7); site.ship.setThrust(t < 10 ? 1.4 - land * 0.9 : Math.max(0, 0.5 - (t - 10) * 0.5));
    site.ship.setCanopyOpen(THREE.MathUtils.smoothstep(t, 10, 11));
    const exit = THREE.MathUtils.smootherstep(t, 11, 14), approach = THREE.MathUtils.smoothstep(t, 14, 17);
    const p = groundPoint(-8, 1.75, 15).lerp(groundPoint(-4, 0.3, 15), exit).lerp(RESCUE_SITE.player, approach);
    player.setPosition(p.x, p.y, p.z);
    player.setRotation(t < 17 ? -Math.PI / 2 : t < 23 ? -1 : JUNGLE_ENTRY_YAW);
    const emerge = THREE.MathUtils.smoothstep(t, 14, 17);
    site.pod.getObjectByName('PodHatch')!.rotation.z = -THREE.MathUtils.smoothstep(t, 13, 14.5) * 1.5;
    site.boy.visible = t >= 14;
    site.boy.position.lerpVectors(groundPoint(6.7, 0.2, 10), RESCUE_SITE.boy, emerge);
    site.boy.rotation.y = -0.9; site.setWalking(t >= 14 && t < 17); site.update(dt);
    if (caption) caption.textContent = t < 4 ? 'INCOMING ESCAPE POD' : t < 7 ? 'IMPACT / SURVIVOR SIGNAL DETECTED'
      : t < 11 ? 'LANDING IN THE JUNGLE CLEARING' : t < 17 ? 'THE HATCH IS OPENING'
      : t < 23 ? '"Thank you for saving me. I thought I was never getting out of there."'
      : t < 29 ? '"The AI is in that facility beyond the trees. Follow the old stone path. Watch out for its patrols."'
      : 'FOLLOW THE STONE PATH THROUGH THE JUNGLE';
    groundCamera();
  }
  const direction = travelDirection.clone(), cameraTarget = new THREE.Vector3();
  function onBlur() { paused = true; }
  function onFocus() { if (!document.hidden) paused = false; }
  function onVisibility() { paused = document.hidden; }
  window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisibility);

  function cameraView() {
    if (clock >= 11) { groundCamera(); return; }
    if (clock < 7) {
      const desired = pod.position.clone().addScaledVector(direction, -115).addScaledVector(side, 25).addScaledVector(surfaceNormal, 30);
      camera.position.lerpVectors(cameraStart, desired, THREE.MathUtils.smoothstep(clock, 0, 2));
      cameraTarget.copy(pod.position).addScaledVector(direction, -15);
      camera.up.set(0, 1, 0); camera.lookAt(cameraTarget);
      if (clock < 2) camera.quaternion.slerpQuaternions(cameraStartRotation, camera.quaternion.clone(), THREE.MathUtils.smoothstep(clock, 0, 2));
    } else if (clock < 11) {
      camera.up.copy(surfaceNormal);
      camera.position.copy(pod.position).addScaledVector(direction, -38).addScaledVector(surfaceNormal, 15).addScaledVector(side, 9);
      camera.lookAt(pod.position);
    } else if (clock < 15) {
      camera.up.copy(surfaceNormal);
      camera.position.copy(pod.position).addScaledVector(direction, -30).addScaledVector(side, 80).addScaledVector(surfaceNormal, 24);
      camera.lookAt(pod.position.clone().addScaledVector(direction, -25));
    } else {
      camera.up.copy(surfaceNormal);
      camera.position.copy(crashSite).addScaledVector(surfaceNormal, 28 + Math.max(0, clock - 18)).addScaledVector(side, 62);
      camera.lookAt(clock < 17 ? pod.position : crashSite.clone().addScaledVector(surfaceNormal, 5));
    }
    const fov = clock < 7 ? (entryState?.cameraFov ?? 76) : clock < 15 ? 64 : 54;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
  }
  function updateVisuals(dt: number) {
    if (clock >= 11) { updateGround(dt); return; }
    shuttle.update(dt);
    pod.position.copy(podPositionAt(clock));
    const before = podPositionAt(Math.max(0, clock - 0.03));
    const after = podPositionAt(Math.min(16.99, clock + 0.03));
    if (clock < 17 && before.distanceToSquared(after) > 0) direction.copy(after).sub(before).normalize();
    pod.quaternion.setFromUnitVectors(modelForward, direction);
    pod.rotateZ(clock < 17 ? Math.sin(clock * 7) * (clock > 7 ? 0.14 : 0.03) : 0.6);
    if (trail) { trail.visible = clock < 17; trail.scale.y = clock > 7 ? 1.8 + Math.sin(clock * 35) * 0.3 : 1; }
    if (clock < 17) {
      const target = pod.position.clone().addScaledVector(direction, -58).addScaledVector(surfaceNormal, 10);
      shuttle.root.position.lerpVectors(shipStart, target, THREE.MathUtils.smoothstep(clock, 0, 1.8));
      shuttle.root.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(modelForward, direction), 1 - Math.exp(-dt * 5));
    } else {
      // Pull up over the wreck; the player follows the pod but does not crash too.
      const exit = crashSite.clone().addScaledVector(surfaceNormal, 70 + (clock - 17) * 35).addScaledVector(side, (clock - 17) * 40);
      shuttle.root.position.lerp(exit, 1 - Math.exp(-dt * 1.5));
      shuttle.root.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(modelForward, side.clone().addScaledVector(surfaceNormal, 0.6).normalize()), 1 - Math.exp(-dt * 2));
    }
    shuttle.setThrust(1.6 + Math.sin(clock * 22) * 0.1);
    debris.visible = clock > 7 && clock < 17;
    debris.position.copy(pod.position); debris.quaternion.copy(pod.quaternion);
    if (debris.visible) {
      for (let i = 2; i < debrisPositions.length; i += 3) { debrisPositions[i] += dt * 65; if (debrisPositions[i] > 45) debrisPositions[i] -= 45; }
      debrisGeo.attributes.position.needsUpdate = true;
    }
    if (clock >= 17) {
      const impact = clock - 17;
      crater.visible = true;
      explosion.scale.setScalar(1 + Math.min(1, impact / 0.65) * 26); explosionMaterial.opacity = Math.max(0, 1 - impact / 1.4);
      shockwave.scale.setScalar(1 + impact * 35); shockwaveMaterial.opacity = Math.max(0, 0.7 - impact * 0.4);
      for (let i = 0; i < smoke.length; i++) {
        const age = Math.max(0, impact - i * 0.12), mesh = smoke[i];
        mesh.position.copy(crashSite).addScaledVector(surfaceNormal, 4 + age * 7).addScaledVector(side, Math.sin(i * 2.4) * age * 3);
        mesh.scale.setScalar(2 + age * 3); mesh.material.opacity = Math.min(0.5, age) * Math.max(0, 1 - age / 9);
      }
      beacon.intensity = 12 + Math.sin(clock * 5) * 6;
    }
    if (caption) caption.textContent = clock < 2 ? 'ESCAPE POD DETECTED' : clock < 7 ? 'FOLLOWING THE POD' : clock < 12 ? 'ATMOSPHERIC ENTRY' : clock < 17 ? 'BRACE FOR IMPACT' : clock < 20 ? 'IMPACT CONFIRMED' : 'A SIGNAL FROM THE WRECK...';
    if (starfield) starfield.position.copy(shuttle.root.position);
    player.setPosition(shuttle.root.position.x, shuttle.root.position.y, shuttle.root.position.z);
    cameraView();
  }
  updateVisuals(0);
  return {
    roomId: 'scene16', scene, camera, physicsWorld, player, planet, pod, shuttle, cutsceneManager: null,
    isCinematic: () => true, hideCharacter: () => clock < 22,
    getCinematicState: () => ({ ...player.getState(), isMoving: clock >= 22 && clock < 28, isOnGround: true, jumping: false, climbing: false, crouching: false }),
    applyCinematicCamera: cameraView,
    updatePhysics(dt: number) {
      if (disposed || finished || paused) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1)); clock += dt;
      if (!site.isReady() && clock > 24) clock = 24;
      updateVisuals(dt);
      if (clock >= duration) {
        finished = true; caption?.classList.add('hidden'); document.body.classList.remove('space-cinematic');
        onFinished({ pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }), hullHealth: entryState?.hullHealth });
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility);
      caption?.classList.add('hidden'); document.body.classList.remove('space-cinematic');
      site.scene.removeFromParent(); site.dispose(); player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
