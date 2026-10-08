import * as THREE from 'three';
import { createEnergyMaterial, createBeamMaterial, FRAME_COLORS } from './finaleMaterials.js';
import type { MechSide } from '../../scripts/mechDuel.js';
import { SUDOERS_5 } from './finaleActors.js';

export function createFinaleEffects(scene: THREE.Scene, reducedMotion: boolean, mobile: boolean) {
  const root = new THREE.Group(); root.name = 'FinalePooledEffects'; scene.add(root);
  const capacity = mobile ? 1100 : 3000;
  const positions = new Float32Array(capacity * 3), colors = positions.slice(), sizes = new Float32Array(capacity), opacity = sizes.slice();
  const velocity = positions.slice(), life = sizes.slice(), lifetime = sizes.slice();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('particleAlpha', new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: `attribute float particleSize; attribute float particleAlpha; attribute vec3 color;
      varying vec3 vColor; varying float vAlpha; uniform float pixelRatio;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vColor = color; vAlpha = particleAlpha;
        gl_PointSize = clamp(particleSize * pixelRatio * 280.0 / max(1.0, -p.z), 1.0, 80.0);
        gl_Position = projectionMatrix * p; }`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha; void main() {
      vec2 p = abs(gl_PointCoord - 0.5) * 2.0;
      float radius = length(p); float soft = pow(max(0.0, 1.0 - radius), 2.5);
      float star = exp(-min(p.x, p.y) * 45.0) * pow(max(0.0, 1.0 - max(p.x, p.y)), 1.5);
      gl_FragColor = vec4(mix(vColor * 3.0, vec3(7.0), soft), max(soft, star * 0.85) * vAlpha); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const particles = new THREE.Points(geometry, material); particles.frustumCulled = false; root.add(particles);
  let cursor = 0, seed = 1;
  const color = new THREE.Color();
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function particle(position: THREE.Vector3, tint: number, speed: number, duration: number, size: number, direction?: THREE.Vector3) {
    const i = cursor++ % capacity, offset = i * 3;
    position.toArray(positions, offset); color.set(tint).toArray(colors, offset);
    const z = random() * 2 - 1, angle = random() * Math.PI * 2, radial = Math.sqrt(1 - z * z);
    velocity[offset] = direction ? direction.x * speed : Math.cos(angle) * radial * speed;
    velocity[offset + 1] = direction ? direction.y * speed : z * speed;
    velocity[offset + 2] = direction ? direction.z * speed : Math.sin(angle) * radial * speed;
    sizes[i] = size; lifetime[i] = life[i] = duration; opacity[i] = 1;
  }
  const ringGeometry = new THREE.RingGeometry(0.91, 1, 64);
  const rings = Array.from({ length: mobile ? 10 : 22 }, () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xffb86e, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(ringGeometry, material); mesh.visible = false; root.add(mesh);
    return { mesh, life: 0, duration: 1, size: 1, speed: 1 };
  });
  let ringCursor = 0;
  function ring(position: THREE.Vector3, size: number, tint: number, vertical = false, duration = 1.1) {
    const item = rings[ringCursor++ % rings.length]; item.life = item.duration = duration;
    item.size = size; item.speed = size * 2.2; item.mesh.position.copy(position); item.mesh.material.color.set(tint);
    item.mesh.rotation.set(vertical ? 0 : -Math.PI / 2, 0, 0); item.mesh.visible = true;
    return item.mesh;
  }
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
  const beams = { hero: new THREE.Mesh(beamGeometry, createBeamMaterial(FRAME_COLORS.hero)),
    enemy: new THREE.Mesh(beamGeometry, createBeamMaterial(FRAME_COLORS.enemy)) };
  Object.values(beams).forEach(beam => { beam.visible = false; root.add(beam); });
  const boardingBeams = SUDOERS_5.map(student => {
    const mesh = new THREE.Mesh(beamGeometry, createEnergyMaterial(student.color));
    mesh.visible = false; root.add(mesh); return mesh;
  });
  const shieldGeometry = new THREE.SphereGeometry(1, 36, 24);
  const shieldMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(FRAME_COLORS.hero) },
      uPower: { value: 0 }, uBroken: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal); vView = -p.xyz; vUv = uv;
        gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uPower; uniform float uBroken; uniform float uTime;
      varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
      void main() {
        float rim = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(vView))), 2.1);
        vec2 cell = abs(fract(vUv * vec2(28.0, 14.0) + vec2(0.0, uTime * 0.08)) - 0.5);
        float grid = 1.0 - smoothstep(0.025, 0.07, min(cell.x, cell.y));
        float fracture = pow(abs(sin(vUv.x * 93.0 + sin(vUv.y * 51.0) * 0.8)), 28.0) * uBroken;
        float pulse = 0.78 + 0.22 * sin(uTime * 7.0);
        vec3 tint = mix(uColor, vec3(1.0, 0.4, 0.22), uBroken);
        gl_FragColor = vec4(tint * (1.15 + rim * 1.9 + fracture * 2.0), uPower * pulse * (0.08 + rim * 0.38 + grid * 0.09 + fracture * 0.4));
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const enemyShieldMaterial = shieldMaterial.clone();
  enemyShieldMaterial.uniforms.uColor.value.set(FRAME_COLORS.enemy);
  const shields = { hero: new THREE.Mesh(shieldGeometry, shieldMaterial), enemy: new THREE.Mesh(shieldGeometry, enemyShieldMaterial) };
  shields.hero.name = 'PrimeFrameShield'; shields.enemy.name = 'FinalVerdictShield';
  Object.values(shields).forEach(shield => { shield.visible = false; root.add(shield); });
  const auraMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uColor: { value: new THREE.Color(FRAME_COLORS.enemy) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal);
        vView = -p.xyz; vUv = uv; gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform float uTime; uniform float uPower; uniform vec3 uColor;
      varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.8);
        float smoke = 0.5 + 0.5 * sin(vUv.y * 27.0 + sin(vUv.x * 37.0) * 2.8 - uTime * 1.4);
        float vein = pow(smoke, 13.0);
        vec3 tint = mix(vec3(0.018, 0.012, 0.016), uColor * 0.85, vein);
        gl_FragColor = vec4(tint, rim * uPower * (0.25 + smoke * 0.27)); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const aura = new THREE.Mesh(shieldGeometry, auraMaterial); aura.name = 'FinalVerdictVoidAura';
  aura.visible = false; root.add(aura);
  const bladeCharge = new THREE.Mesh(beamGeometry, createEnergyMaterial(FRAME_COLORS.hero));
  bladeCharge.visible = false; root.add(bladeCharge);
  const bladeCorona = new THREE.Mesh(beamGeometry, createEnergyMaterial(FRAME_COLORS.hero));
  bladeCorona.visible = false; root.add(bladeCorona);
  const slashPool = Array.from({ length: mobile ? 32 : 64 }, () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xe9fbff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(beamGeometry, material); mesh.visible = false; root.add(mesh);
    return { mesh, life: 0 };
  });
  let slashCursor = 0;
  let lastChargeSpark = -1, lastSpeedFrame = -1;
  const projectileSparkFrames = new Array<number>(32).fill(-1);
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  function slash(from: THREE.Vector3, to: THREE.Vector3, tint: number = FRAME_COLORS.hero) {
    const item = slashPool[slashCursor++ % slashPool.length];
    direction.copy(to).sub(from);
    item.mesh.position.copy(from).lerp(to, 0.5);
    item.mesh.scale.set(0.07, direction.length(), 0.07);
    if (direction.lengthSq() > 0) item.mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    item.mesh.material.color.set(tint).multiplyScalar(4); item.mesh.material.opacity = 1;
    item.life = 0.3; item.mesh.visible = true;
  }
  return { root, capacity,
    burst(position: THREE.Vector3, scale = 1, tint = 0xffb166, count = 70) {
      const total = Math.floor(Math.min(count, mobile ? 70 : 180) * (reducedMotion ? 0.55 : 1));
      for (let i = 0; i < total; i++) particle(position, i % 4 === 0 ? 0xfff5d2 : tint, (0.3 + random()) * scale * 12,
        0.5 + random() * 1.4, scale * (0.18 + random() * 0.25));
      ring(position, scale * 2, tint, false);
    },
    sparks(position: THREE.Vector3, tint = 0xffe3a0, count = 12, direction?: THREE.Vector3) {
      for (let i = 0; i < count; i++) particle(position, tint, 7 + random() * 16, 0.18 + random() * 0.4, 0.1 + random() * 0.15, direction);
    },
    fireworks(position: THREE.Vector3, tint: number) {
      for (let i = 0; i < (mobile ? 50 : 100); i++) particle(position, tint, 5 + random() * 12, 1.1 + random() * 1.5, 0.2 + random() * 0.16);
      ring(position, 2, tint, true, 1.4);
    },
    ring,
    deflect(position: THREE.Vector3, perfect: boolean, side: MechSide = 'hero') {
      ring(position, perfect ? 3.6 : 2.2, 0xe9fbff, true, 0.3);
      for (let i = 0; i < (perfect ? 32 : 18); i++) {
        particle(position, i % 3 ? FRAME_COLORS[side] : 0xffffff, 10 + random() * 14, 0.22 + random() * 0.24, 0.3);
      }
    },
    muzzle(position: THREE.Vector3, forward: THREE.Vector3, side: MechSide) {
      ring(position, 0.8, FRAME_COLORS[side], true, 0.16).quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
      particle(position, 0xffffff, 0, 0.09, 1.8);
      for (let i = 0; i < 10; i++) particle(position, i % 3 ? FRAME_COLORS[side] : 0xffffff,
        12 + random() * 20, 0.12 + random() * 0.18, 0.18 + random() * 0.2, forward);
    },
    aura(position: THREE.Vector3, power: number, time: number) {
      aura.visible = power > 0.01;
      aura.position.copy(position); aura.scale.set(7.5, 10, 7.5);
      auraMaterial.uniforms.uPower.value = power; auraMaterial.uniforms.uTime.value = time;
    },
    chargeBlade(from: THREE.Vector3, to: THREE.Vector3, power: number, time: number) {
      bladeCharge.visible = power > 0.01;
      direction.copy(to).sub(from);
      bladeCharge.position.copy(from).lerp(to, 0.5);
      bladeCharge.scale.set(0.07 + power * 0.13, direction.length(), 0.07 + power * 0.13);
      if (direction.lengthSq() > 0) bladeCharge.quaternion.setFromUnitVectors(up, direction.normalize());
      bladeCharge.material.uniforms.uPower.value = power; bladeCharge.material.uniforms.uTime.value = time;
      bladeCorona.visible = bladeCharge.visible;
      bladeCorona.position.copy(bladeCharge.position); bladeCorona.quaternion.copy(bladeCharge.quaternion);
      bladeCorona.scale.set(0.25 + power * 0.5, from.distanceTo(to), 0.25 + power * 0.5);
      bladeCorona.material.uniforms.uPower.value = power * 0.32; bladeCorona.material.uniforms.uTime.value = time;
      const frame = Math.floor(time * 24);
      if (power > 0.25 && frame !== lastChargeSpark) {
        lastChargeSpark = frame;
        const point = from.clone().lerp(to, random());
        particle(point, 0xe5faff, 1 + power * 3, 0.2 + random() * 0.2, 0.35 + power * 0.25);
      }
    },
    projectile(position: THREE.Vector3, velocity: THREE.Vector3, side: MechSide, time: number, slot = 0) {
      const frame = Math.floor(time * 45);
      if (frame === projectileSparkFrames[slot]) return;
      projectileSparkFrames[slot] = frame;
      for (let i = 0; i < 3; i++) particle(position, i === 0 ? 0xffffff : FRAME_COLORS[side],
        8 + random() * 5, 0.2 + random() * 0.16, 0.24, velocity.clone().normalize().negate());
    },
    slash,
    speedStreaks(position: THREE.Vector3, forward: THREE.Vector3, power: number, time: number) {
      const frame = Math.floor(time * 24);
      if (reducedMotion || power <= 0 || frame === lastSpeedFrame || forward.lengthSq() < 1e-6) return;
      lastSpeedFrame = frame;
      const axis = forward.clone().normalize();
      const tangent = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
      const normal = new THREE.Vector3().crossVectors(axis, tangent);
      for (let i = 0; i < Math.ceil(power * (mobile ? 5 : 10)); i++) {
        const angle = random() * Math.PI * 2, radius = 9 + random() * 12;
        const from = position.clone().addScaledVector(tangent, Math.cos(angle) * radius)
          .addScaledVector(normal, Math.sin(angle) * radius).addScaledVector(axis, (random() - 0.5) * 24);
        slash(from, from.clone().addScaledVector(axis, -(5 + random() * 14)), i % 3 ? FRAME_COLORS.hero : 0xe9fbff);
      }
    },
    teleport(position: THREE.Vector3, arriving: boolean) {
      for (let i = 0; i < (mobile ? 30 : 55); i++) {
        const point = position.clone().add(new THREE.Vector3((random() - 0.5) * 5, random() * 15, (random() - 0.5) * 4));
        particle(point, i % 5 === 0 ? 0xe8f6ff : FRAME_COLORS.hero, arriving ? 2 : 12, 0.22 + random() * 0.45, 0.1,
          new THREE.Vector3(0, arriving ? -1 : 1, 0));
      }
      ring(position.clone().add(new THREE.Vector3(0, 7, 0)), 3.8, FRAME_COLORS.hero, true, 0.45);
    },
    shield(position: THREE.Vector3, radius: number, power: number, time: number, broken = false, side: MechSide = 'hero') {
      const shield = shields[side], material = shield.material;
      shield.visible = power > 0.01;
      if (!shield.visible) return;
      shield.position.copy(position); shield.scale.setScalar(radius);
      material.uniforms.uPower.value = Math.max(0, Math.min(1, power));
      material.uniforms.uBroken.value = broken ? 1 : 0;
      material.uniforms.uTime.value = time;
    },
    beam(side: MechSide, from: THREE.Vector3, to: THREE.Vector3, power: number, time: number) {
      const mesh = beams[side]; mesh.visible = power > 0;
      if (!mesh.visible) return;
      direction.copy(to).sub(from); mesh.position.copy(from).lerp(to, 0.5);
      mesh.scale.set(power, direction.length(), power); mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      mesh.material.uniforms.uTime.value = time;
    },
    boardingBeam(index: number, from: THREE.Vector3, to: THREE.Vector3, power: number, time: number) {
      const mesh = boardingBeams[index];
      if (!mesh) throw new RangeError(`Missing boarding beam for student ${index}`);
      mesh.visible = power > 0.01;
      if (!mesh.visible) return;
      direction.copy(to).sub(from);
      mesh.position.copy(from).lerp(to, 0.5);
      mesh.scale.set(0.35 + power * 0.4, Math.max(0.1, direction.length()), 0.35 + power * 0.4);
      if (direction.lengthSq() > 0.001) mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      mesh.material.uniforms.uTime.value = time; mesh.material.uniforms.uPower.value = power;
    },
    update(dt: number) {
      for (let i = 0; i < capacity; i++) {
        if (life[i] <= 0) continue;
        life[i] = Math.max(0, life[i] - dt); const offset = i * 3, drag = Math.exp(-dt * 0.35);
        velocity[offset] *= drag; velocity[offset + 2] *= drag;
        velocity[offset + 1] -= dt * 3.2;
        for (let axis = 0; axis < 3; axis++) positions[offset + axis] += velocity[offset + axis] * dt;
        opacity[i] = Math.min(1, life[i] / Math.min(0.65, lifetime[i]));
      }
      for (const name of ['position', 'color', 'particleSize', 'particleAlpha']) geometry.getAttribute(name).needsUpdate = true;
      for (const item of rings) {
        item.life = Math.max(0, item.life - dt); item.mesh.visible = item.life > 0;
        const age = item.duration - item.life;
        item.mesh.scale.setScalar(item.size + age * item.speed);
        item.mesh.material.opacity = Math.max(0, item.life / item.duration) * (reducedMotion ? 0.22 : 0.65);
      }
      for (const item of slashPool) {
        item.life = Math.max(0, item.life - dt); item.mesh.visible = item.life > 0;
        item.mesh.material.opacity = item.life / 0.3;
      }
    },
    dispose() {
      root.removeFromParent(); geometry.dispose(); material.dispose(); ringGeometry.dispose(); beamGeometry.dispose();
      shieldGeometry.dispose(); shieldMaterial.dispose(); enemyShieldMaterial.dispose(); auraMaterial.dispose(); bladeCharge.material.dispose(); bladeCorona.material.dispose();
      rings.forEach(item => item.mesh.material.dispose()); Object.values(beams).forEach(beam => beam.material.dispose());
      boardingBeams.forEach(beam => beam.material.dispose());
      slashPool.forEach(item => item.mesh.material.dispose());
    },
  };
}

export function createBladeTrail(scene: THREE.Scene, side: MechSide) {
  const capacity = 22, positions = new Float32Array(capacity * 18), alpha = new Float32Array(capacity * 6);
  const ages = new Float32Array(capacity), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('trailAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(FRAME_COLORS[side]) } },
    vertexShader: `attribute float trailAlpha; varying float vAlpha; void main() {
      vAlpha = trailAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 color; varying float vAlpha; void main() {
      gl_FragColor = vec4(mix(color * 3.5, vec3(5.0), vAlpha * 0.5), vAlpha); }`,
    transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = `${side}_BladeAfterimage`; mesh.frustumCulled = false; scene.add(mesh);
  const previousA = new THREE.Vector3(), previousB = new THREE.Vector3(); let cursor = 0, wasActive = false;
  return {
    update(a: THREE.Vector3, b: THREE.Vector3, dt: number, active: boolean) {
      for (let i = 0; i < capacity; i++) {
        ages[i] = Math.max(0, ages[i] - dt);
        alpha.fill(ages[i] / 0.22 * 0.55, i * 6, i * 6 + 6);
      }
      if (active && wasActive && dt > 0) {
        const i = cursor++ % capacity; ages[i] = 0.22;
        [previousA, previousB, b, previousA, b, a].forEach((point, vertex) => point.toArray(positions, i * 18 + vertex * 3));
        alpha.fill(0.55, i * 6, i * 6 + 6);
      }
      previousA.copy(a); previousB.copy(b); wasActive = active;
      geometry.getAttribute('position').needsUpdate = geometry.getAttribute('trailAlpha').needsUpdate = true;
    },
    clear() { ages.fill(0); alpha.fill(0); geometry.getAttribute('trailAlpha').needsUpdate = true; wasActive = false; },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
