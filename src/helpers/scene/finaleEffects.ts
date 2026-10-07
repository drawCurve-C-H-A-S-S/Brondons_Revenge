import * as THREE from 'three';
import { createEnergyMaterial, FRAME_COLORS } from './finaleMaterials.js';
import type { MechSide } from '../../scripts/mechDuel.js';
import { QUINTET } from './finaleActors.js';

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
      float radius = length(gl_PointCoord - 0.5) * 2.0; float soft = pow(max(0.0, 1.0 - radius), 1.8);
      gl_FragColor = vec4(vColor * (1.5 + soft), soft * vAlpha); }`,
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
  }
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
  const beams = { hero: new THREE.Mesh(beamGeometry, createEnergyMaterial(FRAME_COLORS.hero)),
    enemy: new THREE.Mesh(beamGeometry, createEnergyMaterial(FRAME_COLORS.enemy)) };
  Object.values(beams).forEach(beam => { beam.visible = false; root.add(beam); });
  const boardingBeams = QUINTET.map(student => {
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
  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.name = 'PrimeFrameShield';
  shield.visible = false;
  root.add(shield);
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
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
    shield(position: THREE.Vector3, radius: number, power: number, time: number, broken = false) {
      shield.visible = power > 0.01;
      if (!shield.visible) return;
      shield.position.copy(position); shield.scale.setScalar(radius);
      shieldMaterial.uniforms.uPower.value = Math.max(0, Math.min(1, power));
      shieldMaterial.uniforms.uBroken.value = broken ? 1 : 0;
      shieldMaterial.uniforms.uTime.value = time;
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
    },
    dispose() {
      root.removeFromParent(); geometry.dispose(); material.dispose(); ringGeometry.dispose(); beamGeometry.dispose();
      shieldGeometry.dispose(); shieldMaterial.dispose();
      rings.forEach(item => item.mesh.material.dispose()); Object.values(beams).forEach(beam => beam.material.dispose());
      boardingBeams.forEach(beam => beam.material.dispose());
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
    fragmentShader: `uniform vec3 color; varying float vAlpha; void main() { gl_FragColor = vec4(color * 2.0, vAlpha); }`,
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
