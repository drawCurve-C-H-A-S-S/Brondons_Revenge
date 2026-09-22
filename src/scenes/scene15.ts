import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createScenePhysics, PHYSICS } from '../helpers/physics/scenePhysics.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import { createPlayer, type PlayerTransitionState } from '../scripts/player.js';
import { createEscapeShip, addPlanetBackdrop } from '../scripts/items/createEscapeShip.js';

export const FLIGHT_RULES = Object.freeze({ cruise: 70, boost: 180, turnRate: 0.75, planetRadius: 900, clearance: 180 });

/** The escape shuttle has its own flight controls; the on-foot controller stays disabled. */
export function createScene({ entryState }: { entryState?: PlayerTransitionState } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01040b);
  const physics = createScenePhysics(), physicsWorld = physics.world;
  physicsWorld.gravity.set(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 30000);
  const player = createPlayer({ camera, physicsWorld, spawnPosition: { x: 0, y: 2, z: 0 } });
  if (entryState) player.restoreTransition({ ...entryState, position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0, heldKeys: [], crouching: false, intentionalJump: false, jumpQueued: false }, { x: 0, y: 0, z: 0, yaw: -Math.PI });
  player.disable(); player.body.type = CANNON.Body.KINEMATIC;
  player.body.collisionResponse = false; player.body.updateMassProperties();

  const ship = createEscapeShip();
  ship.setFlying(true); ship.setThrust(0.7); scene.add(ship.root);
  const planetPosition = new THREE.Vector3(0, 120, 4600);
  const planet = addPlanetBackdrop(scene, planetPosition, FLIGHT_RULES.planetRadius, 18000);
  scene.add(new THREE.HemisphereLight(0x8fbbe7, 0x101727, 1.5));
  const sun = new THREE.DirectionalLight(0xffecd8, 3.5);
  sun.position.set(-5000, 7000, -2500); scene.add(sun);

  const hud = document.getElementById('flight-hud');
  const speedLabel = document.getElementById('flight-speed');
  const distanceLabel = document.getElementById('flight-distance');
  const objective = document.getElementById('flight-objective');
  const marker = document.getElementById('flight-target');
  hud?.classList.remove('hidden'); marker?.classList.remove('hidden');
  for (const id of ['interact-prompt', 'boss-subtitles', 'boss-hud', 'escape-qte', 'loading-bay-status']) document.getElementById(id)?.classList.add('hidden');

  let yaw = Math.PI, pitch = Math.atan2(120, 4600), bank = 0, speed: number = FLIGHT_RULES.cruise;
  let cockpitView = true, paused = false, disposed = false, orbitReached = false;
  const keys = new Set<string>();
  const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyV', 'KeyR']);
  const forward = new THREE.Vector3(), toPlanet = new THREE.Vector3(), cockpitPosition = new THREE.Vector3();
  const minDistance = FLIGHT_RULES.planetRadius + FLIGHT_RULES.clearance;

  function onKeyDown(event: KeyboardEvent) {
    if (disposed || paused || !controls.has(event.code)) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, [contenteditable="true"]')) return;
    event.preventDefault();
    if (!event.repeat && !keys.has(event.code)) {
      if (event.code === 'KeyV') cockpitView = !cockpitView;
      if (event.code === 'KeyR') {
        toPlanet.copy(planetPosition).sub(ship.root.position).normalize();
        yaw = Math.atan2(-toPlanet.x, -toPlanet.z);
        pitch = Math.asin(THREE.MathUtils.clamp(toPlanet.y, -1, 1));
      }
    }
    keys.add(event.code);
  }
  function onKeyUp(event: KeyboardEvent) { keys.delete(event.code); }
  function onBlur() { paused = true; keys.clear(); }
  function onFocus() { paused = false; }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);

  function cameraView() {
    ship.root.updateMatrixWorld(true);
    forward.set(0, 0, -1).applyQuaternion(ship.root.quaternion);
    camera.up.set(0, 1, 0).applyQuaternion(ship.root.quaternion);
    if (cockpitView) {
      ship.cockpit.getWorldPosition(camera.position);
    } else {
      camera.position.set(0, 5, 13).applyQuaternion(ship.root.quaternion).add(ship.root.position);
    }
    camera.lookAt(cockpitPosition.copy(ship.root.position).addScaledVector(forward, 100));
    camera.updateMatrixWorld(true);
    return true;
  }

  function updateHud() {
    const distance = ship.root.position.distanceTo(planetPosition) - FLIGHT_RULES.planetRadius;
    toPlanet.copy(planetPosition).sub(ship.root.position).normalize();
    const bearing = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(forward.dot(toPlanet), -1, 1)));
    if (speedLabel) speedLabel.textContent = `${Math.round(speed)} m/s`;
    if (distanceLabel) distanceLabel.textContent = `${(Math.max(0, distance) / 1000).toFixed(2)} km above surface`;
    if (objective) objective.textContent = paused ? 'FLIGHT PAUSED'
      : orbitReached ? 'PLANETARY APPROACH REACHED / Steer clear of the atmosphere'
      : `REACH THE PLANET / ${bearing < 12 ? 'ON COURSE' : `TURN ${Math.round(bearing)}° TOWARD THE BEACON`}`;
    if (marker) {
      const projected = planetPosition.clone().project(camera);
      const ahead = toPlanet.dot(camera.getWorldDirection(new THREE.Vector3())) > 0;
      marker.style.left = `${ahead ? THREE.MathUtils.clamp((projected.x + 1) * 50, 8, 92) : 50}%`;
      marker.style.top = `${ahead ? THREE.MathUtils.clamp((1 - projected.y) * 50, 18, 80) : 78}%`;
      marker.textContent = ahead ? 'NEAREST PLANET' : 'PLANET BEHIND / R: FACE TARGET';
    }
  }
  ship.root.rotation.set(pitch, yaw, bank, 'YXZ'); cameraView(); updateHud();

  return {
    roomId: 'scene15', scene, camera, physicsWorld, player, ship, planet, cutsceneManager: null,
    // Shared cinematic presentation also hides the on-foot avatar/HUD inside a vehicle.
    isCinematic: () => true, hideCharacter: () => true,
    getCinematicState: () => player.getState(), applyCinematicCamera: cameraView,
    getFlightStatus: () => ({ speed, cockpitView, paused, orbitReached, distance: ship.root.position.distanceTo(planetPosition) - FLIGHT_RULES.planetRadius }),
    updatePhysics(dt: number) {
      if (disposed) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, PHYSICS.maxFrameTime));
      if (!paused) {
        const steering = Number(keys.has('KeyA')) - Number(keys.has('KeyD'));
        yaw += steering * FLIGHT_RULES.turnRate * dt;
        pitch = THREE.MathUtils.clamp(pitch + (Number(keys.has('KeyW')) - Number(keys.has('KeyS'))) * FLIGHT_RULES.turnRate * dt, -1.35, 1.35);
        bank = THREE.MathUtils.damp(bank, steering * 0.35, 4, dt);
        ship.root.rotation.set(pitch, yaw, bank, 'YXZ');
        forward.set(0, 0, -1).applyQuaternion(ship.root.quaternion);
        const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
        speed = THREE.MathUtils.damp(speed, keys.has('Space') ? 0 : boost ? FLIGHT_RULES.boost : FLIGHT_RULES.cruise, 2.5, dt);
        const next = ship.root.position.clone().addScaledVector(forward, speed * dt);
        const outward = next.clone().sub(planetPosition);
        if (outward.length() < minDistance) {
          next.copy(planetPosition).add(outward.normalize().multiplyScalar(minDistance));
          speed = 0; orbitReached = true;
        }
        ship.root.position.copy(next);
        ship.setThrust(speed / FLIGHT_RULES.cruise * 0.7);
        planet.rotation.y += dt * 0.006;
        ship.root.updateMatrixWorld(true); ship.cockpit.getWorldPosition(cockpitPosition);
        player.setPosition(cockpitPosition.x, cockpitPosition.y, cockpitPosition.z);
      }
      cameraView(); updateHud();
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      hud?.classList.add('hidden'); marker?.classList.add('hidden');
      player.dispose(); physics.dispose(); disposeRoom(scene);
    },
  };
}
