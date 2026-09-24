import * as THREE from 'three';

export const SCRAMBLER_HEALTH = 280;
type Options = {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; ship: THREE.Group; boss: THREE.Group; rail: number;
  shoot: (from: THREE.Vector3, to: THREE.Vector3, damage: number, speed?: number) => void;
  burst: (position: THREE.Vector3, size: number, color?: number) => void;
};

/** A continuous camera/encounter phase; the flight world and its hull health remain alive. */
export function createSidescrollPhase({ scene, camera, ship, boss, rail, shoot, burst }: Options) {
  const device = new THREE.Group(); device.name = 'SidescrollScrambler';
  const metal = new THREE.MeshStandardMaterial({ color: 0x293f37, metalness: 0.8, roughness: 0.3, transparent: true });
  const green = new THREE.MeshBasicMaterial({ color: 0x67ffa0, transparent: true });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(8, 1), green); device.add(core);
  const rings = [0, 1, 2].map(i => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(12, 1.2, 6, 24), metal);
    ring.rotation.set(i * 1.1, i * 0.8, 0); device.add(ring); return ring;
  });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x47ff91, transparent: true, opacity: 0.12, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(17, 12, 8), glowMaterial); device.add(glow);
  const light = new THREE.PointLight(0x47ff91, 1800, 160); device.add(light); scene.add(device);
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x42ff96, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), shieldMaterial);
  shield.scale.set(112, 72, 18); shield.visible = false; scene.add(shield);
  const rippleMaterial = shieldMaterial.clone();
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), rippleMaterial); ripple.visible = false; scene.add(ripple);
  const shieldContact = new THREE.Vector3();
  let shieldTime = 0, materialized = true;
  const pulse = document.createElement('div'); pulse.className = 'scrambler-pulse'; pulse.setAttribute('aria-hidden', 'true'); document.body.appendChild(pulse);
  const startPosition = camera.position.clone(), startRotation = camera.quaternion.clone(), startFov = camera.fov;
  const shipStart = ship.position.clone(), startScale = ship.scale.clone(), shipRotation = ship.quaternion.clone();
  const bossStart = boss.position.clone(), bossRotation = boss.quaternion.clone();
  const exitBoss = new THREE.Vector3(), exitBossRotation = new THREE.Quaternion(), exitShipRotation = new THREE.Quaternion();
  const neutralShipRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  const endPosition = new THREE.Vector3(), endRotation = new THREE.Quaternion();
  const rotationMatrix = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), rollAxis = new THREE.Vector3(0, 0, 1);
  const exitPosition = new THREE.Vector3(), exitRotation = new THREE.Quaternion(), exitShip = new THREE.Vector3();
  let stage: 'enter' | 'fight' | 'exit' | 'done' = 'enter';
  let time = 0, elapsed = 0, currentRail = rail, exitRail = rail, health = SCRAMBLER_HEALTH, cooldown = 1.5, volley = 0;
  let offset = -35, height = ship.position.y, lean = 0, disposed = false;
  function sidePose() {
    endPosition.set(-Math.max(350, 480 / Math.max(0.25, camera.aspect)), 12, currentRail + 150);
    rotationMatrix.lookAt(endPosition, new THREE.Vector3(0, 0, currentRail + 150), up);
    endRotation.setFromRotationMatrix(rotationMatrix);
  }
  function cameraView() {
    if (disposed || stage === 'done') return;
    sidePose(); camera.up.copy(up);
    if (stage === 'enter') {
      const t = THREE.MathUtils.smootherstep(time, 1.1, 4.6);
      camera.position.lerpVectors(startPosition.clone().add(new THREE.Vector3(0, 0, currentRail - rail)), endPosition, t);
      camera.quaternion.slerpQuaternions(startRotation, endRotation, t);
      camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(rollAxis, t * Math.PI * 2));
      camera.fov = THREE.MathUtils.lerp(startFov, 60, t);
    } else if (stage === 'exit') {
      const t = THREE.MathUtils.smootherstep(time, 0, 3.2);
      const chase = new THREE.Vector3(ship.position.x * 0.65, ship.position.y * 0.8 + 12, currentRail - 34);
      rotationMatrix.lookAt(chase, new THREE.Vector3(ship.position.x * 0.65, ship.position.y * 0.8 + 6, currentRail + 260), up);
      camera.position.lerpVectors(exitPosition.clone().add(new THREE.Vector3(0, 0, currentRail - exitRail)), chase, t);
      camera.quaternion.slerpQuaternions(exitRotation, new THREE.Quaternion().setFromRotationMatrix(rotationMatrix), t);
      camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(rollAxis, -t * Math.PI * 2));
      camera.fov = THREE.MathUtils.lerp(60, 76, t);
    } else { camera.position.copy(endPosition); camera.quaternion.copy(endRotation); camera.fov = 60; }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function destroy() {
    if (stage !== 'fight') return;
    burst(device.position, 35, 0x67ffa0); device.visible = false; shield.visible = ripple.visible = false; shieldTime = 0;
    cameraView(); exitPosition.copy(camera.position); exitRotation.copy(camera.quaternion);
    exitShip.copy(ship.position); exitShipRotation.copy(ship.quaternion);
    exitBoss.copy(boss.position); exitBossRotation.copy(boss.quaternion);
    exitRail = currentRail; stage = 'exit'; time = 0;
  }
  document.body.classList.add('side-scroll');
  return {
    device,
    get stage() { return stage; },
    get health() { return health; },
    get active() { return stage === 'fight'; },
    shieldHit(point: THREE.Vector3) {
      if (stage !== 'fight') return;
      shieldTime = 0.55; shieldContact.copy(point).sub(boss.position);
    },
    damage(amount: number) {
      if (stage !== 'fight' || !materialized || !Number.isFinite(amount) || amount <= 0) return;
      health = Math.max(0, health - amount); burst(device.position, 5, 0xb0ffd1);
      if (health === 0) destroy();
    },
    applyCamera: cameraView,
    update(dt: number, railZ: number, horizontal: number, vertical: number, evade: boolean) {
      if (disposed || stage === 'done') return;
      time += dt; elapsed += dt; currentRail = railZ;
      const bossTarget = new THREE.Vector3(0, Math.sin(elapsed * 0.55) * 8, railZ + 265);
      const bossTargetRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(elapsed * 0.6) * 0.025));
      const cycle = (time + 0.5) % 4.8, upper = Math.floor((time + 0.5) / 4.8) % 2 === 0;
      const deviceTarget = new THREE.Vector3(0, bossTarget.y + (stage !== 'fight' || upper ? 86 : -82), railZ + 305);
      if (stage === 'enter') {
        const t = THREE.MathUtils.smootherstep(time, 1.1, 4.6);
        ship.position.lerpVectors(shipStart.clone().add(new THREE.Vector3(0, 0, railZ - rail)), new THREE.Vector3(0, height, railZ + offset), t);
        ship.scale.copy(startScale).multiplyScalar(1 + t * 1.6);
        ship.quaternion.slerpQuaternions(shipRotation, neutralShipRotation, t);
        boss.position.lerpVectors(bossStart.clone().add(new THREE.Vector3(0, 0, railZ - rail)), bossTarget, t);
        boss.quaternion.slerpQuaternions(bossRotation, bossTargetRotation, t);
        const launch = THREE.MathUtils.smootherstep(time, 0, 1.4);
        device.position.copy(boss.position).add(new THREE.Vector3(0, 42 + launch * 90, launch * 90));
        device.position.lerp(deviceTarget, THREE.MathUtils.smootherstep(time, 1.8, 4.6));
        const pulseProgress = THREE.MathUtils.clamp((time - 0.8) / 2, 0, 1);
        pulse.style.setProperty('--pulse-scale', String(0.08 + pulseProgress * 2.8));
        pulse.style.opacity = String(Math.sin(Math.PI * pulseProgress) * 0.7);
        if (time >= 4.6) { stage = 'fight'; time = 0; pulse.style.opacity = '0'; }
      } else if (stage === 'fight') {
        boss.position.copy(bossTarget); boss.quaternion.copy(bossTargetRotation);
        offset = THREE.MathUtils.clamp(offset + horizontal * (evade ? 140 : 65) * dt, -85, 65);
        height = THREE.MathUtils.clamp(height + vertical * (evade ? 140 : 65) * dt, -105, 110);
        lean = THREE.MathUtils.damp(lean, vertical * 0.18, 8, dt);
        ship.position.set(0, height, railZ + offset); ship.rotation.set(-lean, Math.PI, 0);
        const presence = THREE.MathUtils.smootherstep(cycle, 0, 0.5) * (1 - THREE.MathUtils.smootherstep(cycle, 3.6, 4.2));
        device.position.copy(deviceTarget); device.visible = presence > 0.01; materialized = presence > 0.65;
        device.scale.set(0.65 + presence * 0.35, 0.2 + presence * 0.8, 0.65 + presence * 0.35);
        metal.opacity = green.opacity = presence; glowMaterial.opacity = presence * 0.16; light.intensity = presence * 1800;
        device.rotation.y = THREE.MathUtils.smootherstep(cycle, 0.85, 2.8) * Math.PI * 2;
        cooldown -= dt;
        if (cooldown <= 0) {
          volley++; cooldown = volley % 3 === 0 ? 1.8 : 1.25;
          const from = new THREE.Vector3(0, boss.position.y + (volley % 2 ? 18 : -18), railZ + 185);
          if (volley % 3 === 0) {
            const gap = Math.sin(elapsed) * 65;
            for (let y = -105; y <= 105; y += 21) {
              if (Math.abs(y - gap) < 27) continue;
              shoot(new THREE.Vector3(0, y, railZ + 175), new THREE.Vector3(0, y, railZ - 100), 14, 160);
            }
          } else {
            for (const dy of [-18, 0, 18]) shoot(from, ship.position.clone().add(new THREE.Vector3(0, dy, 0)), 12, 180);
          }
        }
      } else {
        const t = THREE.MathUtils.smootherstep(time, 0, 3.2);
        ship.position.lerpVectors(exitShip.clone().add(new THREE.Vector3(0, 0, railZ - exitRail)), new THREE.Vector3(0, THREE.MathUtils.clamp(height, -30, 30), railZ), t);
        ship.scale.copy(startScale).multiplyScalar(2.6 - t * 1.6);
        ship.quaternion.slerpQuaternions(exitShipRotation, neutralShipRotation, t);
        boss.position.lerpVectors(exitBoss.clone().add(new THREE.Vector3(0, 0, railZ - exitRail)), new THREE.Vector3(0, 4, railZ + 340), t);
        boss.quaternion.slerpQuaternions(exitBossRotation, new THREE.Quaternion(), t);
        pulse.style.setProperty('--pulse-scale', String(0.15 + t * 3));
        pulse.style.opacity = String(Math.sin(Math.PI * t) * 0.35);
        if (time >= 3.2) { stage = 'done'; ship.scale.copy(startScale); document.body.classList.remove('side-scroll'); }
      }
      shieldTime = Math.max(0, shieldTime - dt);
      shield.visible = ripple.visible = stage === 'fight' && shieldTime > 0;
      if (shield.visible) {
        const fade = shieldTime / 0.55;
        shield.position.copy(boss.position).add(new THREE.Vector3(0, 0, -115));
        shieldMaterial.opacity = fade * 0.28;
        ripple.position.set(boss.position.x + THREE.MathUtils.clamp(shieldContact.x, -95, 95), boss.position.y + THREE.MathUtils.clamp(shieldContact.y, -58, 58), shield.position.z - 18.5);
        ripple.scale.setScalar(5 + (1 - fade) * 30); rippleMaterial.opacity = fade * 0.75;
      }
      core.rotation.z = Math.sin(elapsed * 1.2) * 0.15;
      rings.forEach((ring, i) => { ring.rotation.x = i * 1.1 + Math.sin(elapsed + i) * 0.12; });
      glow.scale.setScalar(1 + Math.sin(elapsed * 7) * 0.1); cameraView();
    },
    dispose() {
      if (disposed) return; disposed = true; pulse.remove(); document.body.classList.remove('side-scroll'); ship.scale.copy(startScale);
      device.removeFromParent(); shield.removeFromParent(); ripple.removeFromParent();
      shield.geometry.dispose(); ripple.geometry.dispose(); shieldMaterial.dispose(); rippleMaterial.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      device.traverse(node => { if (node instanceof THREE.Mesh) { geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => materials.add(m)); } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); light.dispose();
    },
  };
}
