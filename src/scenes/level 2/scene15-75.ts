import * as THREE from 'three';

export const TOPDOWN_SCRAMBLER_HEALTH = 420;
const SHIELD_WIDTH = 118, ORB_RADIUS = 18, PLAYER_WIDTH = 190;
const LATERAL_SPEED = 165, LATERAL_DASH_SPEED = 300, EVADE_DURATION = 0.45;
const ENTER_DURATION = 4.8, EXIT_DURATION = 3.2, ESCORT_LIMIT = 6;
const MODEL_FORWARD = new THREE.Vector3(0, 0, -1);
type Options = {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; ship: THREE.Group; boss: THREE.Group; rail: number;
  launchBays: THREE.Object3D[]; createInterceptor: () => THREE.Group;
  shoot: (from: THREE.Vector3, to: THREE.Vector3, damage: number, speed?: number) => void;
  burst: (position: THREE.Vector3, size: number, color?: number) => void;
};
type Escort = {
  root: THREE.Group; health: number; active: boolean; age: number; fireCd: number;
  launch: THREE.Vector3; path: THREE.CubicBezierCurve3;
};

/** Scene 15.75 shares scene 15's world, music, projectiles and persistent hull health. */
export function createTopdownPhase({ scene, camera, ship, boss, rail, launchBays, createInterceptor, shoot, burst }: Options) {
  const device = new THREE.Group(); device.name = 'TopdownRedScrambler'; device.visible = false; scene.add(device);
  const red = new THREE.MeshBasicMaterial({ color: 0xff334f, transparent: true, opacity: 0 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5a2633, metalness: 0.8, roughness: 0.28, transparent: true, opacity: 0 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 12), red); device.add(core);
  const rings = [0, 1, 2].map(i => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(13 + i, 0.9, 6, 32), metal);
    ring.rotation.set(i * 0.9, i * 1.2, 0); device.add(ring); return ring;
  });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xff284b, transparent: true, opacity: 0, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(ORB_RADIUS, 16, 10), glowMaterial); device.add(glow);
  const light = new THREE.PointLight(0xff334f, 0, 140); device.add(light);
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), shieldMaterial);
  shield.name = 'TopdownCarrierShield'; shield.scale.set(SHIELD_WIDTH, 68, 135); shield.visible = false; scene.add(shield);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xffa3b2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), rippleMaterial);
  ripple.rotation.x = -Math.PI / 2; ripple.visible = false; scene.add(ripple);
  const shieldContact = new THREE.Vector3();
  const evadeMaterial = new THREE.MeshBasicMaterial({ color: 0x8ae8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const evadeHalo = new THREE.Mesh(new THREE.RingGeometry(13, 15, 40), evadeMaterial);
  evadeHalo.name = 'TopdownEvadeHalo'; evadeHalo.rotation.x = -Math.PI / 2; evadeHalo.visible = false; scene.add(evadeHalo);
  const pulse = document.createElement('div'); pulse.className = 'scrambler-pulse topdown-pulse';
  pulse.setAttribute('aria-hidden', 'true'); document.body.appendChild(pulse);
  const entryFlash = document.createElement('div'); entryFlash.className = 'topdown-entry-flash';
  entryFlash.setAttribute('aria-hidden', 'true'); entryFlash.style.setProperty('--flash-opacity', '1');
  document.body.appendChild(entryFlash);
  document.body.classList.add('top-down-flight');

  const random = (min: number, max: number) => THREE.MathUtils.lerp(min, max, Math.random());
  const relative = (position: THREE.Vector3, origin = rail) => position.clone().add(new THREE.Vector3(0, 0, -origin));
  const atRail = (position: THREE.Vector3) => position.clone().add(new THREE.Vector3(0, 0, currentRail));
  const startCamera = relative(camera.position), startCameraRotation = camera.quaternion.clone(), startFov = camera.fov;
  const startShip = relative(ship.position), startShipRotation = ship.quaternion.clone(), startScale = ship.scale.clone();
  const startBoss = relative(boss.position), startBossRotation = boss.quaternion.clone();
  const shipRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  const neutralRotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  const topUp = new THREE.Vector3(0, 0, 1), normalUp = new THREE.Vector3(0, 1, 0);
  const exitCamera = new THREE.Vector3(), exitCameraRotation = new THREE.Quaternion();
  const exitShip = new THREE.Vector3(), exitShipRotation = new THREE.Quaternion(), exitBoss = new THREE.Vector3();
  const bossTarget = new THREE.Vector3(), orbOffset = new THREE.Vector3(), deviceTarget = new THREE.Vector3();
  const escorts: Escort[] = [];
  let stage: 'enter' | 'fight' | 'exit' | 'done' = 'enter';
  let currentRail = rail, time = 0, elapsed = 0, health = TOPDOWN_SCRAMBLER_HEALTH, disposed = false;
  let lateral = 0, offset = -35, lean = 0, shieldTime = 0, cooldown = 1.7, volley = 0;
  let appearing = true, appearanceTime = 0, appearanceDuration = random(4.2, 6.2), targetable = false;
  let spawnCooldown = 1.8, spawned = 0;
  let evadeTime = EVADE_DURATION, evadeDirection = 1, evadeStart = 0, evadeEnd = 0;

  function chooseOrbPosition() {
    // A straight +Z shot must clear the ENTIRE shield, including the orb's edge.
    // Each side is sampled independently; repeated sides are allowed, never alternated.
    const side = Math.random() < 0.5 ? -1 : 1;
    orbOffset.set(side * (SHIELD_WIDTH + ORB_RADIUS + 12 + random(0, 28)), 1, random(-25, 65));
  }
  chooseOrbPosition();
  device.position.copy(boss.position).add(new THREE.Vector3(0, 60, 0));
  shield.position.copy(boss.position);

  function cameraView() {
    if (disposed || stage === 'done') return;
    const overhead = new THREE.Vector3(0, Math.max(620, 490 / Math.max(0.25, camera.aspect)), currentRail + 145);
    matrix.lookAt(overhead, new THREE.Vector3(0, 0, currentRail + 145), topUp);
    const overheadRotation = new THREE.Quaternion().setFromRotationMatrix(matrix);
    if (stage === 'enter') {
      const t = THREE.MathUtils.smootherstep(time, 0.1, ENTER_DURATION);
      camera.position.lerpVectors(atRail(startCamera), overhead, t);
      camera.quaternion.slerpQuaternions(startCameraRotation, overheadRotation, t);
      camera.fov = THREE.MathUtils.lerp(startFov, 54, t);
    } else if (stage === 'exit') {
      const t = THREE.MathUtils.smootherstep(time, 0, EXIT_DURATION);
      const chase = new THREE.Vector3(ship.position.x * 0.65, ship.position.y * 0.8 + 12, currentRail - 34);
      matrix.lookAt(chase, new THREE.Vector3(ship.position.x * 0.65, ship.position.y * 0.8 + 6, currentRail + 260), normalUp);
      camera.position.lerpVectors(atRail(exitCamera), chase, t);
      camera.quaternion.slerpQuaternions(exitCameraRotation, new THREE.Quaternion().setFromRotationMatrix(matrix), t);
      camera.fov = THREE.MathUtils.lerp(54, 76, t);
    } else {
      camera.position.copy(overhead); camera.quaternion.copy(overheadRotation); camera.fov = 54;
    }
    // The quaternion owns orientation during both blends; no lookAt with a parallel up vector.
    camera.up.copy(stage === 'fight' ? topUp : normalUp);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function destroyScrambler() {
    burst(device.position, 36, 0xff3355); device.visible = false; targetable = false;
    cameraView(); exitCamera.copy(relative(camera.position, currentRail)); exitCameraRotation.copy(camera.quaternion);
    exitShip.copy(relative(ship.position, currentRail)); exitShipRotation.copy(ship.quaternion);
    exitBoss.copy(relative(boss.position, currentRail));
    stage = 'exit'; time = 0; shieldTime = 0; ripple.visible = false; evadeHalo.visible = false;
  }
  function spawnEscort() {
    if (spawned >= ESCORT_LIMIT || escorts.filter(f => f.active).length >= 3) return;
    const bay = launchBays[spawned % launchBays.length]; if (!bay) return;
    const root = createInterceptor(); root.scale.multiplyScalar(1.65); scene.add(root);
    boss.updateMatrixWorld(true); bay.getWorldPosition(root.position);
    const launch = relative(root.position, currentRail), side = Math.sign(launch.x) || 1;
    const start = new THREE.Vector3(side * 145, 1, boss.position.z - currentRail - 48);
    const lane = random(-160, 160);
    escorts.push({ root, health: 42, active: true, age: 0, fireCd: 1.4 + random(0, 0.5), launch,
      path: new THREE.CubicBezierCurve3(start, new THREE.Vector3(side * 170, 1, 155), new THREE.Vector3(lane, 1, 70), new THREE.Vector3(lane, 1, -105)) });
    burst(root.position, 5, 0xff8c9d); spawned++;
  }
  function updateEscorts(dt: number) {
    spawnCooldown -= dt;
    if (spawnCooldown <= 0) { spawnEscort(); spawnCooldown = spawned % 2 ? 1.1 : random(4.5, 6.5); }
    for (const escort of escorts) {
      if (!escort.active) continue;
      escort.age += dt;
      let direction: THREE.Vector3;
      if (escort.age < 0.9) {
        const t = THREE.MathUtils.smootherstep(escort.age, 0, 0.9);
        escort.root.position.lerpVectors(escort.launch, escort.path.v0, t);
        direction = escort.path.v0.clone().sub(escort.launch).normalize();
      } else {
        const t = Math.min(1, (escort.age - 0.9) / 5.2);
        escort.path.getPoint(t, escort.root.position); direction = escort.path.getTangent(t);
      }
      escort.root.position.z += currentRail;
      escort.root.quaternion.setFromUnitVectors(MODEL_FORWARD, direction);
      escort.fireCd -= dt;
      if (escort.age >= 0.9 && escort.fireCd <= 0 && escort.root.position.z > ship.position.z + 45) {
        shoot(escort.root.position.clone(), ship.position.clone().add(new THREE.Vector3(0, 1, 0)), 10, 155);
        escort.fireCd = random(1.5, 2.2);
      }
      if (escort.age >= 6.1) { escort.active = false; escort.root.visible = false; }
    }
  }
  function updateOrb(dt: number) {
    const instability = 1 - health / TOPDOWN_SCRAMBLER_HEALTH;
    // Damage accelerates the clock continuously; relocation happens only while hidden.
    appearanceTime += dt * (1 + instability * 1.6);
    if (appearanceTime >= appearanceDuration) {
      appearing = !appearing; appearanceTime = 0;
      appearanceDuration = appearing
        ? random(THREE.MathUtils.lerp(4.2, 3.4, instability), THREE.MathUtils.lerp(6.2, 7, instability))
        : random(0.65, THREE.MathUtils.lerp(1.65, 2, instability));
      if (appearing) chooseOrbPosition();
    }
    const presence = appearing
      ? THREE.MathUtils.smootherstep(appearanceTime, 0, 0.32) * (1 - THREE.MathUtils.smootherstep(appearanceTime, appearanceDuration - 0.4, appearanceDuration)) : 0;
    device.position.copy(boss.position).add(orbOffset); device.visible = presence > 0.01;
    device.scale.setScalar(0.55 + presence * 0.45); targetable = presence >= 0.9;
    red.opacity = metal.opacity = presence; glowMaterial.opacity = presence * 0.16; light.intensity = presence * 1500;
  }
  function hasAncestor(object: THREE.Object3D, root: THREE.Object3D) {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root) return true;
    return false;
  }
  return {
    get stage() { return stage; },
    get active() { return stage === 'fight'; },
    get evading() { return stage === 'fight' && evadeTime < EVADE_DURATION; },
    evade(direction: number) {
      if (disposed || stage !== 'fight' || evadeTime < EVADE_DURATION || !Number.isFinite(direction)) return false;
      evadeDirection = Math.sign(direction) || (lateral > 0 ? -1 : 1);
      // At an arena edge, dodge back into the playfield instead of spending the evade in place.
      if (lateral * evadeDirection > PLAYER_WIDTH - 24) evadeDirection *= -1;
      evadeStart = lateral;
      evadeEnd = THREE.MathUtils.clamp(lateral + evadeDirection * LATERAL_DASH_SPEED * EVADE_DURATION, -PLAYER_WIDTH, PLAYER_WIDTH);
      evadeTime = 0;
      return true;
    },
    get health() { return health; },
    get targetable() { return targetable; },
    get activeInterceptors() { return escorts.filter(f => f.active).length; },
    get shotTargets(): THREE.Object3D[] {
      if (stage !== 'fight') return [];
      return [shield, ...(targetable ? [device] : []), ...escorts.filter(f => f.active).map(f => f.root)];
    },
    hit(object: THREE.Object3D, point: THREE.Vector3, amount: number) {
      if (stage !== 'fight' || !Number.isFinite(amount) || amount <= 0) return false;
      if (targetable && hasAncestor(object, device)) {
        health = Math.max(0, health - amount); burst(point, 5, 0xff9cac);
        if (health === 0) destroyScrambler();
        return true;
      }
      const escort = escorts.find(f => f.active && hasAncestor(object, f.root));
      if (escort) {
        escort.health = Math.max(0, escort.health - amount); burst(point, 3, 0xffcf9c);
        if (escort.health === 0) { escort.active = false; escort.root.visible = false; burst(escort.root.position, 13, 0xff7958); }
        return true;
      }
      shieldTime = 0.5; shieldContact.copy(point).sub(boss.position); burst(point, 3, 0xff6680);
      return false;
    },
    applyCamera: cameraView,
    update(dt: number, railZ: number, horizontal: number, vertical: number) {
      if (disposed || stage === 'done') return;
      time += dt; elapsed += dt; currentRail = railZ;
      bossTarget.set(Math.sin(elapsed * 0.4) * 8, 0, currentRail + 265);
      if (stage === 'enter') {
        const t = THREE.MathUtils.smootherstep(time, 0.1, ENTER_DURATION);
        ship.position.lerpVectors(atRail(startShip), new THREE.Vector3(0, 0, currentRail + offset), t);
        ship.quaternion.slerpQuaternions(startShipRotation, shipRotation, t);
        ship.scale.copy(startScale).multiplyScalar(1 + t * 1.6);
        boss.position.lerpVectors(atRail(startBoss), bossTarget, t);
        boss.quaternion.slerpQuaternions(startBossRotation, neutralRotation, t);
        // The destruction flash reveals an emerging orb and shield, not fully formed meshes.
        const lift = THREE.MathUtils.smootherstep(time, 0.15, 1.7);
        const reveal = THREE.MathUtils.smootherstep(time, 0.25, 1.25);
        deviceTarget.copy(boss.position).add(orbOffset);
        device.position.copy(boss.position).add(new THREE.Vector3(0, 35 + lift * 70, 0).applyQuaternion(boss.quaternion));
        device.position.lerp(deviceTarget, THREE.MathUtils.smootherstep(time, 1.15, ENTER_DURATION));
        device.visible = reveal > 0.01; device.scale.setScalar(0.15 + reveal * 0.85);
        red.opacity = metal.opacity = reveal; glowMaterial.opacity = reveal * 0.16; light.intensity = reveal * 1500;
        // Use encounter time so pausing freezes the flash together with the camera.
        entryFlash.style.setProperty('--flash-opacity', String(1 - THREE.MathUtils.smootherstep(time, 0.08, 1.1)));
        const wave = THREE.MathUtils.clamp((time - 0.7) / 3.2, 0, 1);
        pulse.style.setProperty('--pulse-scale', String(0.1 + wave * 3)); pulse.style.opacity = String(Math.sin(wave * Math.PI) * 0.4);
        if (time >= ENTER_DURATION) {
          stage = 'fight'; time = 0; appearanceTime = 0.32; targetable = true; pulse.style.opacity = '0'; entryFlash.remove();
        }
      } else if (stage === 'fight') {
        // In this overhead view +Z is screen-up and -X is screen-right.
        const input = new THREE.Vector2(-horizontal, vertical); if (input.lengthSq() > 1) input.normalize();
        const evading = evadeTime < EVADE_DURATION;
        evadeTime = Math.min(EVADE_DURATION, evadeTime + dt);
        const evadeProgress = THREE.MathUtils.smootherstep(evadeTime, 0, EVADE_DURATION);
        // The maneuver owns its clock so releasing controls or pausing cannot snap a half-roll upright.
        lateral = evading ? THREE.MathUtils.lerp(evadeStart, evadeEnd, evadeProgress)
          : THREE.MathUtils.clamp(lateral + input.x * LATERAL_SPEED * dt, -PLAYER_WIDTH, PLAYER_WIDTH);
        offset = THREE.MathUtils.clamp(offset + input.y * 75 * dt, -65, 50);
        lean = THREE.MathUtils.damp(lean, evading ? 0 : input.x * -0.24, 10, dt);
        const roll = evading ? -evadeDirection * Math.PI * 2 * evadeProgress : 0;
        ship.position.set(lateral, 0, currentRail + offset); ship.rotation.set(0, Math.PI, lean + roll, 'YXZ');
        const evadeGlow = evading ? Math.sin(evadeProgress * Math.PI) : 0;
        evadeHalo.visible = evadeGlow > 0.01;
        evadeHalo.position.copy(ship.position); evadeHalo.position.y = 1;
        evadeHalo.scale.setScalar(1 + evadeGlow * 0.2); evadeMaterial.opacity = evadeGlow * 0.65;
        boss.position.copy(bossTarget); boss.quaternion.copy(neutralRotation);
        updateOrb(dt); updateEscorts(dt);
        cooldown -= dt;
        if (cooldown <= 0) {
          volley++; cooldown = random(1.15, 1.65);
          const sides = volley % 3 === 0 ? [-1, 1] : [volley % 2 ? -1 : 1];
          for (const side of sides) {
            const from = new THREE.Vector3(boss.position.x + side * 72, 1, boss.position.z - 105);
            for (const x of [-26, 0, 26]) shoot(from, ship.position.clone().add(new THREE.Vector3(x, 1, 0)), 12, 165);
          }
        }
      } else {
        const t = THREE.MathUtils.smootherstep(time, 0, EXIT_DURATION);
        ship.position.lerpVectors(atRail(exitShip), new THREE.Vector3(0, 0, currentRail), t);
        ship.quaternion.slerpQuaternions(exitShipRotation, shipRotation, t);
        ship.scale.copy(startScale).multiplyScalar(2.6 - t * 1.6);
        boss.position.lerpVectors(atRail(exitBoss), new THREE.Vector3(0, 4, currentRail + 340), t);
        for (const escort of escorts) if (escort.active) {
          escort.root.position.z += (200 + 220 * t) * dt; escort.root.position.y += 100 * dt;
          escort.root.scale.setScalar(3.5 * 1.65 * (1 - t));
        }
        pulse.style.setProperty('--pulse-scale', String(0.15 + t * 3)); pulse.style.opacity = String(Math.sin(t * Math.PI) * 0.3);
        if (time >= EXIT_DURATION) { stage = 'done'; ship.scale.copy(startScale); }
      }
      shieldTime = Math.max(0, shieldTime - dt);
      shield.position.copy(boss.position);
      const shieldFade = stage === 'enter' ? THREE.MathUtils.smootherstep(time, 0.45, 2)
        : stage === 'exit' || stage === 'done' ? 1 - THREE.MathUtils.smootherstep(time, 0, EXIT_DURATION) : 1;
      shieldMaterial.opacity = (0.22 + shieldTime * 0.42) * shieldFade;
      shield.visible = shieldFade > 0.01;
      ripple.visible = stage === 'fight' && shieldTime > 0;
      if (ripple.visible) {
        ripple.position.copy(boss.position).add(shieldContact); ripple.position.y += 3;
        ripple.scale.setScalar(7 + (1 - shieldTime / 0.5) * 26); rippleMaterial.opacity = shieldTime * 1.5;
      }
      rings.forEach((ring, i) => { ring.rotation.x += dt * (0.5 + i * 0.2); ring.rotation.y += dt * 0.7; });
      cameraView();
    },
    dispose() {
      if (disposed) return; disposed = true;
      pulse.remove(); entryFlash.remove(); document.body.classList.remove('top-down-flight'); ship.scale.copy(startScale); camera.up.copy(normalUp);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      for (const root of [device, shield, ripple, evadeHalo, ...escorts.map(f => f.root)]) {
        root.removeFromParent();
        root.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          geometries.add(node.geometry);
          (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => materials.add(material));
        });
      }
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); light.dispose();
      escorts.length = 0;
    },
  };
}
