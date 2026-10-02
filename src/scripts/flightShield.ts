import * as THREE from 'three';
import hologramVertexShader from '../shaders/hologram.vert.glsl?raw';
import hologramFragmentShader from '../shaders/hologram.frag.glsl?raw';

export const FLIGHT_SHIELD_RULES = Object.freeze({ duration: 20, capacity: 3, pickupSpeed: 85, pickupLifetime: 18 });

export function createFlightShield({ scene, ship, texture, iconUrl, hud, camera }: {
  scene: THREE.Scene; ship: THREE.Group; texture: THREE.Texture; iconUrl: string; hud?: HTMLElement | null; camera?: THREE.Camera;
}) {
  const coinGeometry = new THREE.CircleGeometry(3.5, 32);
  const coinMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, depthTest: false, toneMapped: false });
  const hologramMaterial = new THREE.ShaderMaterial({
    uniforms: { hologramTime: { value: 0 }, hologramColor: { value: new THREE.Color(0x32a9ff) }, hologramImpact: { value: 0 } },
    vertexShader: hologramVertexShader, fragmentShader: hologramFragmentShader,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const cameraDirection = new THREE.Vector3(), spinAxis = new THREE.Vector3(), spin = new THREE.Quaternion();
  function setHologram(active: boolean) {
    if (active) ship.traverse(node => {
      if (!(node instanceof THREE.Mesh) || originalMaterials.has(node)) return;
      originalMaterials.set(node, node.material); node.material = hologramMaterial;
    });
    else {
      originalMaterials.forEach((material, mesh) => { mesh.material = material; });
      originalMaterials.clear();
    }
  }
  const drops: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  const slots: HTMLButtonElement[] = [];
  let stored = 0, remaining = 0, elapsed = 0, impactTime = 0, disposed = false;

  function activate() {
    if (disposed || remaining > 0 || stored === 0) return false;
    stored--; remaining = FLIGHT_SHIELD_RULES.duration; setHologram(true); renderHud(); return true;
  }
  if (hud) {
    for (let index = 0; index < FLIGHT_SHIELD_RULES.capacity; index++) {
      const button = document.createElement('button'); button.className = 'flight-shield-slot'; button.type = 'button';
      const icon = document.createElement('img'); icon.src = iconUrl; icon.alt = 'Shield'; button.appendChild(icon);
      button.addEventListener('click', () => {
        if (!document.hidden && !document.body.classList.contains('space-paused') && !document.body.classList.contains('quick-menu-open')) activate();
      });
      hud.appendChild(button); slots.push(button);
    }
  }
  function renderHud() {
    slots.forEach((slot, index) => {
      const active = remaining > 0 && index === 0;
      slot.hidden = index >= stored + Number(remaining > 0);
      slot.disabled = remaining > 0;
      slot.classList.toggle('active', active);
      slot.style.setProperty('--shield-arc', `${active ? remaining / FLIGHT_SHIELD_RULES.duration * 360 : 0}deg`);
      slot.title = active ? 'Shield active' : 'Equip shield (Enter)';
      slot.setAttribute('aria-label', active ? `Shield active, ${Math.ceil(remaining)} seconds remaining` : 'Equip shield');
    });
  }
  function clearDrops() {
    drops.forEach(drop => scene.remove(drop.mesh)); drops.length = 0;
  }
  renderHud();
  return {
    activate,
    impact() { if (remaining > 0) impactTime = 0.35; },
    get active() { return remaining > 0; },
    get status() { return { stored, remaining, drops: drops.length }; },
    drop(position: THREE.Vector3, railSpeed: number) {
      if (disposed) return;
      const mesh = new THREE.Mesh(coinGeometry, coinMaterial); mesh.name = 'ShieldPowerupCoin'; mesh.position.copy(position);
      mesh.renderOrder = 100; mesh.frustumCulled = false;
      if (camera) mesh.quaternion.copy(camera.quaternion);
      const direction = ship.position.clone().sub(position).normalize();
      if (direction.lengthSq() === 0) direction.set(0, 0, -1);
      const velocity = direction.multiplyScalar(FLIGHT_SHIELD_RULES.pickupSpeed); velocity.z += railSpeed;
      scene.add(mesh); drops.push({ mesh, velocity, life: FLIGHT_SHIELD_RULES.pickupLifetime });
    },
    update(dt: number, previousShipPosition: THREE.Vector3, pickupRadius: number, canCollect = true) {
      if (disposed) return;
      remaining = Math.max(0, remaining - dt); elapsed += dt;
      hologramMaterial.uniforms.hologramTime.value = elapsed;
      if (remaining > 0) setHologram(true);
      else if (originalMaterials.size) setHologram(false);
      impactTime = Math.max(0, impactTime - dt);
      hologramMaterial.uniforms.hologramImpact.value = impactTime / 0.35;
      for (let index = drops.length - 1; index >= 0; index--) {
        const drop = drops[index], start = drop.mesh.position.clone().sub(previousShipPosition);
        drop.mesh.position.addScaledVector(drop.velocity, dt); drop.life -= dt;
        if (camera) {
          camera.getWorldDirection(cameraDirection);
          const overhead = Math.abs(cameraDirection.y) > 0.8;
          spinAxis.set(0, overhead ? 0 : 1, overhead ? 1 : 0);
          const angle = overhead ? elapsed * 0.8 : Math.sin(elapsed * 0.8) * 0.85;
          drop.mesh.quaternion.copy(camera.quaternion).multiply(spin.setFromAxisAngle(spinAxis, angle));
          if (camera instanceof THREE.PerspectiveCamera) {
            const depth = Math.max(1, drop.mesh.position.clone().sub(camera.position).dot(cameraDirection));
            const visibleHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
            const radius = Math.max(3.5, visibleHeight * 12 / Math.max(1, window.innerHeight));
            drop.mesh.scale.setScalar(radius / 3.5);
          }
        } else drop.mesh.rotation.y += dt * 0.8;
        const end = drop.mesh.position.clone().sub(ship.position);
        const closest = new THREE.Line3(start, end).closestPointToPoint(new THREE.Vector3(), true, new THREE.Vector3());
        const collected = canCollect && stored < FLIGHT_SHIELD_RULES.capacity && closest.lengthSq() <= pickupRadius * pickupRadius;
        if (collected) stored++;
        if (collected || drop.life <= 0) { scene.remove(drop.mesh); drops.splice(index, 1); }
      }
      renderHud();
    },
    reset() { stored = remaining = impactTime = 0; setHologram(false); clearDrops(); renderHud(); },
    dispose() {
      if (disposed) return; disposed = true; clearDrops();
      setHologram(false); hologramMaterial.dispose();
      coinGeometry.dispose(); coinMaterial.dispose(); texture.dispose(); slots.forEach(slot => slot.remove());
    },
  };
}