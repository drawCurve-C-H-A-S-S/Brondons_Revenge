import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addPlanetBackdrop, createEscapePod, createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import { createPlayer } from '../../scripts/player.js';
import type { CinematicPose } from '../../scripts/characterManager.js';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import { disposeRoom } from '../../helpers/scene/shipRoom.js';
import type { FlightExitState } from './scene15.js';
import { createRescueSite, RESCUE_SITE, JUNGLE_ENTRY_YAW, type RescueArrival } from '../../helpers/scene/rescueSite.js';

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
  const shuttle = createEscapeShip(); shuttle.setFlying(true, true); shuttle.setThrust(1.6); shuttle.setPilotVisible(true); scene.add(shuttle.root);
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
  const groundPodImpact = RESCUE_SITE.pod.clone().add(new THREE.Vector3(0, 0, -4));
  const groundPodPath = new THREE.CubicBezierCurve3(groundPodStart, groundPoint(-30, 68, -55), groundPoint(0, 22, -3), groundPodImpact);
  const groundShipHover = RESCUE_SITE.ship.clone().add(new THREE.Vector3(0, 4, 0));
  const groundShipPath = new THREE.CubicBezierCurve3(groundPoint(-64, 115, -127), groundPoint(-40, 44, -20), RESCUE_SITE.ship.clone().add(new THREE.Vector3(0, 12, 10)), groundShipHover);
  const revealPath = new THREE.CatmullRomCurve3([
    groundPoint(1, 2.3, 17), new THREE.Vector3(-59, 6, 67), new THREE.Vector3(-57, 7, 49),
    new THREE.Vector3(-46, 7, 34), new THREE.Vector3(-42, 7, 17), new THREE.Vector3(-29, 7, -10),
    new THREE.Vector3(-24, 7, -30), new THREE.Vector3(-7, 8, -41), new THREE.Vector3(0, 12, -43), new THREE.Vector3(0, 30, -44),
  ]);
  const crashBits = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.12, 0.35), new THREE.MeshStandardMaterial({ color: 0x898779, roughness: 0.8 }), 24);
  crashBits.frustumCulled = false; site.scene.add(crashBits); const bitDummy = new THREE.Object3D();
  const shipDust = Array.from({ length: 12 }, () => {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xa58b6e, transparent: true, opacity: 0, depthWrite: false }));
    site.scene.add(mesh); return mesh;
  });
  let clock = 0, disposed = false, finished = false, paused = false, animationDelta = 0;
  const duration = 11 + 34 / 1.3;
  function groundCamera() {
    const t = (clock - 11) * 1.3; camera.up.set(0, 1, 0);
    if (t < 4) {
      const midpoint = site.pod.position.clone().lerp(site.ship.root.position, 0.5);
      const separation = site.pod.position.distanceTo(site.ship.root.position);
      const distance = Math.max(28, (separation + 18) / (2 * Math.tan(THREE.MathUtils.degToRad(65 / 2)) * Math.min(1, camera.aspect)));
      camera.position.copy(midpoint).add(new THREE.Vector3(distance * 0.75, distance * 0.23, distance * 0.85));
      camera.position.lerp(groundPoint(17, 6, 26), THREE.MathUtils.smoothstep(t, 2.8, 4));
      camera.lookAt(midpoint); camera.fov = 65;
    } else if (t < 11) {
      camera.position.copy(groundPoint(18 - (t - 4) * 0.5, 7, 26)); camera.lookAt(groundPoint(-2, 2.5, 12)); camera.fov = 62;
    } else if (t < 17) {
      camera.position.copy(groundPoint(15, 4, 22)); camera.lookAt(new THREE.Vector3().copy(player.body.position).lerp(site.boy.position, 0.4).add(new THREE.Vector3(0, 0.8, 0))); camera.fov = 58;
    } else if (t < 23) {
      camera.position.copy(groundPoint(1, 2.3, 17)); camera.lookAt(site.boy.position.clone().add(new THREE.Vector3(0, 1.1, 0))); camera.fov = 56;
    } else {
      const rush = THREE.MathUtils.smootherstep(t, 23, 27), pan = THREE.MathUtils.smootherstep(t, 27, 30), handoff = THREE.MathUtils.smootherstep(t, 30, 34);
      camera.position.copy(revealPath.getPointAt(rush)).lerp(new THREE.Vector3(-55, 32, -24), pan);
      const target = revealPath.getPointAt(Math.min(1, rush + 0.08));
      target.lerp(new THREE.Vector3(0, 17, -65), THREE.MathUtils.smoothstep(t, 26, 28));
      const shoulder = RESCUE_SITE.player.clone().add(new THREE.Vector3(Math.sin(JUNGLE_ENTRY_YAW) * 4, 2.5, Math.cos(JUNGLE_ENTRY_YAW) * 4));
      camera.position.lerp(shoulder, handoff);
      const pathLook = RESCUE_SITE.player.clone().add(new THREE.Vector3(-Math.sin(JUNGLE_ENTRY_YAW) * 15, 1.3, -Math.cos(JUNGLE_ENTRY_YAW) * 15));
      target.lerp(pathLook, handoff); camera.lookAt(target);
      camera.fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(56, 68, THREE.MathUtils.smoothstep(t, 23, 23.7)), 75, handoff);
    }
    const shake = Math.max(0, 1 - Math.abs(t - 2.25) / 1.1) * 0.38;
    camera.position.x += Math.sin(t * 71) * shake; camera.position.y += Math.cos(t * 83) * shake;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function updateGround(dt: number) {
    const t = (clock - 11) * 1.3; orbital.visible = false; site.scene.visible = true;
    scene.background = site.scene.background; scene.fog = site.scene.fog;
    const fall = THREE.MathUtils.clamp(t / 2.05, 0, 1);
    site.pod.position.copy(groundPodPath.getPoint(fall));
    if (t < 2.05) {
      site.pod.quaternion.setFromUnitVectors(modelForward, groundPodPath.getTangent(fall).normalize()); site.pod.rotateZ(Math.sin(t * 15) * 0.32);
    } else {
      site.pod.position.lerpVectors(groundPodImpact, RESCUE_SITE.pod, THREE.MathUtils.smoothstep(t, 2.05, 2.9));
      const impactRotation = new THREE.Quaternion().setFromUnitVectors(modelForward, groundPodPath.getTangent(1).normalize());
      site.pod.quaternion.slerpQuaternions(impactRotation, new THREE.Quaternion().setFromEuler(RESCUE_SITE.podRotation), THREE.MathUtils.smoothstep(t, 2.05, 2.9));
      site.pod.rotateZ(Math.sin(t * 24) * Math.max(0, 0.16 - (t - 2.05) * 0.2));
    }
    site.pod.getObjectByName('PodTrail')!.visible = t < 2.1;
    site.setImpact((t - 2.05) * 1.5);
    const approachTime = THREE.MathUtils.clamp(t / 3.8, 0, 1), land = 1 - (1 - approachTime) ** 2;
    site.ship.root.visible = true;
    site.ship.root.position.copy(groundShipPath.getPoint(land));
    if (t < 3.8) {
      site.ship.root.quaternion.setFromUnitVectors(modelForward, groundShipPath.getTangent(land).normalize());
      site.ship.root.quaternion.slerp(new THREE.Quaternion(), THREE.MathUtils.smootherstep(approachTime, 0.45, 1));
      site.ship.root.rotateZ(Math.sin(approachTime * Math.PI) * -0.12);
    } else {
      site.ship.root.position.lerpVectors(groundShipHover, RESCUE_SITE.ship, THREE.MathUtils.smootherstep(t, 3.8, 6.6));
      site.ship.root.rotation.set(0, 0, 0);
    }
    site.ship.setFlying(t < 3.5); site.ship.setThrust(t < 3.8 ? 1.4 : 1.1 * (1 - THREE.MathUtils.smoothstep(t, 5.5, 7)));
    site.ship.setPilotVisible(t < 11);
    site.ship.setCanopyOpen(THREE.MathUtils.smoothstep(t, 10, 11));
    const exit = THREE.MathUtils.smootherstep(t, 11, 12.4), approach = THREE.MathUtils.smoothstep(t, 14, 17);
    const p = groundPoint(-8, 1.75, 15).lerp(groundPoint(-4, 0.3, 15), exit).lerp(RESCUE_SITE.player, approach);
    if (t > 11 && t < 12.4) p.y += Math.sin(exit * Math.PI) * 0.6;
    player.setPosition(p.x, p.y, p.z);
    const walkYaw = Math.atan2(groundPoint(-4, 0.3, 15).x - RESCUE_SITE.player.x, groundPoint(-4, 0.3, 15).z - RESCUE_SITE.player.z);
    player.setRotation(t < 14 ? -Math.PI / 2 : t < 17 ? walkYaw : t < 23 ? Math.atan2(p.x - RESCUE_SITE.boy.x, p.z - RESCUE_SITE.boy.z) : JUNGLE_ENTRY_YAW);
    const emerge = THREE.MathUtils.smoothstep(t, 14, 17);
    site.pod.getObjectByName('PodHatch')!.rotation.z = -THREE.MathUtils.smoothstep(t, 13, 14.5) * 1.5;
    site.boy.visible = t >= 14;
    site.pod.updateMatrixWorld(true);
    const hatchExit = site.pod.localToWorld(new THREE.Vector3(1.2, -0.95, 0.35));
    site.boy.position.lerpVectors(hatchExit, RESCUE_SITE.boy, emerge);
    const walkFacing = Math.atan2(RESCUE_SITE.boy.x - hatchExit.x, RESCUE_SITE.boy.z - hatchExit.z);
    const playerFacing = Math.atan2(player.body.position.x - site.boy.position.x, player.body.position.z - site.boy.position.z);
    site.boy.rotation.y = walkFacing + Math.atan2(Math.sin(playerFacing - walkFacing), Math.cos(playerFacing - walkFacing)) * THREE.MathUtils.smoothstep(t, 16.5, 17.3);
    site.setWalking(t >= 14 && t < 17); site.update(dt);
    for (let i = 0; i < crashBits.count; i++) {
      const age = t - 2.05, impact = groundPodImpact;
      const speed = 2 + i % 6, angle = i * 2.4;
      bitDummy.position.copy(impact).add(new THREE.Vector3(Math.sin(angle) * Math.max(0, age) * speed, 0, Math.cos(angle) * Math.max(0, age) * speed));
      bitDummy.position.y = Math.max(0.08, 0.5 + age * (2 + i % 4) - 4.9 * age * age);
      bitDummy.rotation.set(age * (i % 3 + 2), age * 2, angle);
      bitDummy.scale.setScalar(age < 0 || age > 4 ? 0 : 1 - THREE.MathUtils.smoothstep(age, 2.5, 4));
      bitDummy.updateMatrix(); crashBits.setMatrixAt(i, bitDummy.matrix);
    }
    crashBits.instanceMatrix.needsUpdate = true;
    shipDust.forEach((mesh, i) => {
      const wash = THREE.MathUtils.smoothstep(t, 3.5, 4.5) * (1 - THREE.MathUtils.smoothstep(t, 6.6, 8));
      const radius = 2 + ((Math.max(0, t - 3.5) * 2 + i * 0.35) % 5);
      mesh.visible = wash > 0;
      mesh.position.copy(RESCUE_SITE.ship).add(new THREE.Vector3(Math.sin(i * 2.4) * radius, 0.18, Math.cos(i * 2.4) * radius));
      mesh.scale.set(1.4, 0.22, 1.4); mesh.material.opacity = wash * 0.12;
    });
    if (caption) caption.textContent = t < 2.05 ? 'STAY WITH THE POD — BRAKING FOR LANDING' : t < 7 ? 'POD IMPACT / SURVIVOR SIGNAL DETECTED'
      : t < 11 ? 'SHUTTLE LANDED / OUTER FOREST' : t < 17 ? 'THE HATCH IS OPENING'
      : t < 23 ? '"Thank you for saving me. I thought I was never getting out of there."'
      : t < 30 ? '"The AI is experimenting in a facility somewhere in this forest. We have to find it and save our friends. Follow the old stone path."'
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
    isCinematic: () => true, hideCharacter: () => (clock - 11) * 1.3 < 11,
    isThirdPersonView: () => true,
    getMinimapState: () => {
      const ship = clock < 11 ? shuttle.root : site.ship.root;
      const onFoot = (clock - 11) * 1.3 >= 11;
      return { position: onFoot ? player.body.position : ship.position,
        yaw: onFoot ? player.getState().yaw : ship.rotation.y, object: onFoot ? undefined : ship,
        openSky: clock < 11, radius: clock < 11 ? 220 : 70 };
    },
    getCinematicDelta: () => animationDelta,
    getCinematicState: () => ({ ...player.getState(), isMoving: (clock - 11) * 1.3 >= 11 && (clock - 11) * 1.3 < 17, isOnGround: true, jumping: false, climbing: false, crouching: false }),
    getCinematicPose(): CinematicPose {
      const t = (clock - 11) * 1.3;
      if (t < 11.3) return { clip: 'Jump_Start', time: Math.max(0, t - 11), duration: 0.3 };
      if (t < 12.4) return { clip: 'Jump_Loop', time: t - 11.3 };
      if (t < 13) return { clip: 'Jump_Land', time: t - 12.4, duration: 0.6 };
      return t >= 14 && t < 17 ? { clip: 'Walk_Loop', time: t - 14, loop: true } : { clip: 'Idle_Loop', time: t, loop: true };
    },
    applyCinematicCamera: cameraView,
    updatePhysics(dt: number) {
      animationDelta = 0;
      if (disposed || finished || paused || document.hidden || document.body.classList.contains('quick-menu-open')) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1)); clock += dt; animationDelta = dt;
      if (!site.isReady() && clock > 21) clock = 21;
      updateVisuals(dt);
      if (clock >= duration) {
        finished = true; caption?.classList.add('hidden'); document.body.classList.remove('space-cinematic');
        onFinished({ pilotState: player.captureTransition({ x: 0, y: 0, z: 0 }), hullHealth: entryState?.hullHealth,
          cameraPosition: camera.position.clone(), cameraQuaternion: camera.quaternion.clone(), cameraFov: camera.fov });
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
