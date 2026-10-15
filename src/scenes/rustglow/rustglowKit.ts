import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import rustVert from '../../shaders/rust.vert.glsl?raw';
import rustFrag from '../../shaders/rust.frag.glsl?raw';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { roomBox } from '../../helpers/scene/shipRoom.js';
import type { Breakable } from '../../scripts/breakables.js';
import { createBreakables } from '../../scripts/breakables.js';
import type { Player } from '../../scripts/player.js';
import type { DamageWeapon } from '../../scripts/pistol.js';
import { inputHint } from '../../scripts/gamepadInput.js';

export type RustTone = 'normal' | 'heavy' | 'dull' | 'pistol';

const RUST_TONES: Record<RustTone, { base: number; rust: number; emissive: number; intensity: number; roughness: number }> = {
  normal: { base: 0x5a5048, rust: 0xb0662c, emissive: 0xff8a30, intensity: 1.15, roughness: 0.85 },
  heavy: { base: 0x6a6055, rust: 0xd8a068, emissive: 0xffc27a, intensity: 1.6, roughness: 0.7 },
  dull: { base: 0x57493e, rust: 0x7d5236, emissive: 0x000000, intensity: 0, roughness: 0.95 },
  // Ceramic-shelled bloom: melee glances off, bullets shatter it. Cool glow = sidearm only.
  pistol: { base: 0x4c545c, rust: 0x3f7d8c, emissive: 0x4fd6ff, intensity: 1.35, roughness: 0.45 },
};

export interface RustWorld {
  material(tone: RustTone, override?: Partial<{ scale: number; emissiveColor: number; intensity: number }>): THREE.ShaderMaterial;
  update(dt: number): void;
}

export function createRustWorld(): RustWorld {
  const clock = { value: 0 };
  const materials = new Set<THREE.ShaderMaterial>();
  return {
    material(tone, override = {}) {
      const preset = RUST_TONES[tone];
      const material = new THREE.ShaderMaterial({
        vertexShader: rustVert, fragmentShader: rustFrag,
        uniforms: {
          uBaseColor: { value: new THREE.Color(preset.base) },
          uRustColor: { value: new THREE.Color(preset.rust) },
          uEmissiveColor: { value: new THREE.Color(override.emissiveColor ?? preset.emissive) },
          uLightDirection: { value: new THREE.Vector3(0.4, 0.85, 0.3).normalize() },
          uFillDirection: { value: new THREE.Vector3(-0.6, 0.2, -0.5).normalize() },
          uTime: clock,
          uRoughness: { value: preset.roughness },
          uEmissiveIntensity: { value: override.intensity ?? preset.intensity },
          uDamageStage: { value: 0 },
          uHitFlash: { value: 0 },
          uScale: { value: override.scale ?? 1.4 },
        },
      });
      materials.add(material);
      return material;
    },
    update(dt: number) {
      clock.value += dt;
      for (const material of materials) {
        const flash = material.uniforms.uHitFlash;
        flash.value *= Math.exp(-9 * dt);
        if (flash.value < 0.01) flash.value = 0;
      }
    },
  };
}

export interface RustTargetOptions {
  tone?: RustTone;
  hits?: number;
  weapon?: DamageWeapon;
  emissiveColor?: number;
  scale?: number;
}

/** Breakable carrying a dedicated rust material whose crack stage and hit flash track its hits. */
export function addRustTarget(breakables: ReturnType<typeof createBreakables>, rust: RustWorld,
  id: string, position: THREE.Vector3, size: THREE.Vector3,
  options: RustTargetOptions = {}, onBreak?: (id: string) => void): Breakable {
  const hits = Math.max(1, Math.floor(options.hits ?? (options.tone === 'heavy' ? 3 : 1)));
  const material = rust.material(options.tone ?? (hits > 1 ? 'heavy' : 'normal'),
    { emissiveColor: options.emissiveColor, scale: options.scale });
  return breakables.add(id, options.weapon ?? 'crowbar', position, size, onBreak, {
    hits, material,
    onDamaged: (_id, hitsLeft) => {
      material.uniforms.uDamageStage.value = Math.max(0, hits - hitsLeft);
      material.uniforms.uHitFlash.value = 1.2;
    },
  });
}

/** Diagonal hazard striping: marks unbreakable solids so they never read as invisible walls. */
export function hazardMaterial() {
  const map = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#1d1a12'; ctx.lineWidth = 22;
    for (let x = -s; x < s * 2; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + s, s); ctx.stroke(); }
  }, [2, 1]);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.2 });
}

/** Non-breakable corroded bulk: same family of look, zero glow, solid collider, hazard band. */
export function addDullDecoy(scene: THREE.Scene, physics: ReturnType<typeof createScenePhysics>,
  rust: RustWorld, center: THREE.Vector3, size: THREE.Vector3, yaw = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), rust.material('dull'));
  mesh.position.copy(center);
  mesh.rotation.y = yaw;
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(size.x * 1.01, Math.min(0.28, size.y * 0.3), size.z * 1.01), hazardMaterial());
  band.position.y = Math.max(0, size.y / 2 - 0.3);
  mesh.add(band);
  physics.addBoxFromMesh(mesh);
  return mesh;
}

export interface Pushable { mesh: THREE.Mesh; body: CANNON.Body }

export function createPushable(scene: THREE.Scene, world: CANNON.World, position: THREE.Vector3,
  size: THREE.Vector3, mass: number, material: THREE.Material): Pushable {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(position);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({ mass, shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)) });
  body.position.set(position.x, position.y, position.z);
  body.linearDamping = 0.85;
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.05;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);
  return { mesh, body };
}

export function syncPushables(props: readonly Pushable[]) {
  for (const prop of props) {
    prop.mesh.position.copy(prop.body.position as unknown as THREE.Vector3);
    prop.mesh.quaternion.copy(prop.body.quaternion as unknown as THREE.Quaternion);
  }
}

export function returnPushableTo(prop: Pushable, position: THREE.Vector3) {
  prop.body.velocity.setZero();
  prop.body.angularVelocity.setZero();
  prop.body.wakeUp();
  prop.body.position.set(position.x, position.y, position.z);
  prop.body.quaternion.set(0, 0, 0, 1);
  prop.mesh.position.copy(position);
  prop.mesh.quaternion.set(0, 0, 0, 1);
}

export interface PressurePlate {
  update(dt: number, player: Player | null, watch: readonly CANNON.Body[]): void;
  loaded: () => boolean;
  reset(): void;
}

/** Floor switch armed by a standing player and/or by any watched body at or above minMass resting on it. */
export function createPressurePlate(scene: THREE.Scene, center: THREE.Vector3, size: THREE.Vector3,
  options: { minMass?: number; playerArms?: boolean } = {}): PressurePlate {
  const minMass = options.minMass ?? 100;
  const playerArms = options.playerArms ?? true;
  const group = new THREE.Group();
  group.position.set(center.x, 0.01, center.z);
  scene.add(group);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x37424c, metalness: 0.6, roughness: 0.55 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.1, size.z), deckMat);
  plate.position.y = 0.05; plate.castShadow = true; plate.receiveShadow = true;
  group.add(plate);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffb34b, emissive: 0xff8a15, emissiveIntensity: 1.4 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.5, 0.04, 0.08), lampMat);
  lamp.position.set(0, 0.11, size.z / 2 - 0.1);
  group.add(lamp);
  let loaded = false, sink = 0;
  return {
    update(dt, player, watch) {
      let armed = false;
      if (playerArms && player?.isEnabled()) {
        const p = player.body.position;
        if (Math.abs(p.x - center.x) < size.x / 2 && Math.abs(p.z - center.z) < size.z / 2 && p.y < 1.2) armed = true;
      }
      for (const body of watch) {
        if (body.mass < minMass || !body.world) continue;
        const p = body.position;
        if (Math.abs(p.x - center.x) < size.x / 2 && Math.abs(p.z - center.z) < size.z / 2
          && p.y >= -0.05 && p.y <= 1.0 && Math.abs(body.velocity.y) < 0.2) { armed = true; break; }
      }
      loaded = armed;
      const target = armed ? 0.06 : 0;
      sink += THREE.MathUtils.clamp(target - sink, -dt * 0.4, dt * 0.4);
      plate.position.y = 0.05 - sink;
      lampMat.color.setHex(armed ? 0x65ffb6 : 0xffb34b);
      lampMat.emissive.setHex(armed ? 0x2fbf7a : 0xff8a15);
    },
    loaded: () => loaded,
    reset() { sink = 0; loaded = false; plate.position.y = 0.05; },
  };
}

export interface Handhold {
  near(player: Player): boolean;
}

export function createHandhold(scene: THREE.Scene, physics: ReturnType<typeof createScenePhysics>,
  center: THREE.Vector3, length = 1.6): Handhold {
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c9aa5, metalness: 0.8, roughness: 0.35 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, length, 10), steel);
  bar.rotation.z = Math.PI / 2;
  bar.position.copy(center);
  bar.castShadow = true;
  scene.add(bar);
  for (const end of [-length / 2, length / 2]) {
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), steel);
    stem.position.set(center.x + end, center.y + 0.14, center.z);
    scene.add(stem);
  }
  physics.addBox({ x: length, y: 0.14, z: 0.14 }, { x: center.x, y: center.y, z: center.z });
  return { near: player => Math.hypot(player.body.position.x - center.x,
    player.body.position.y - (center.y - 0.4), player.body.position.z - center.z) < 1.15 };
}

export interface ResetTerminal {
  update(dt: number, player: Player | null): void;
  dispose(): void;
}

/** Wall console that puts the chamber back the way it was found. */
export function createResetTerminal(scene: THREE.Scene, physics: ReturnType<typeof createScenePhysics>,
  rust: RustWorld, position: THREE.Vector3, yaw: number, onReset: () => void): ResetTerminal {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.rotation.y = yaw;
  scene.add(group);
  const steel = new THREE.MeshStandardMaterial({ color: 0x33424e, metalness: 0.6, roughness: 0.55 });
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 0.4), steel);
  pedestal.position.y = 0.575; pedestal.castShadow = true; pedestal.receiveShadow = true;
  group.add(pedestal);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.06), rust.material('dull', { scale: 2.2 }));
  face.position.set(0, 1.05, 0.24);
  group.add(face);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xff8a52, emissive: 0xff5a20, emissiveIntensity: 1.6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 20), ringMat);
  ring.position.set(0, 1.05, 0.3);
  group.add(ring);
  physics.addBox({ x: 0.8, y: 1.2, z: 0.7 }, { x: position.x, y: 0.6, z: position.z });
  const prompt = document.getElementById('interact-prompt');
  let wasNear = false, armed = false;
  function onKey(event: KeyboardEvent) {
    if (event.code !== 'KeyE' || event.repeat || event.defaultPrevented || !armed) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, dialog, input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    onReset();
  }
  window.addEventListener('keydown', onKey);
  let disposed = false;
  return {
    update(_dt, player) {
      if (disposed) return;
      const near = !!player?.isEnabled()
        && Math.hypot(player.body.position.x - position.x, player.body.position.z - position.z) < 1.9
        && player.body.position.y < 2.2;
      armed = near;
      if (near === wasNear) return;
      wasNear = near;
      if (prompt) {
        if (near) { prompt.textContent = inputHint('E: reset chamber'); prompt.classList.remove('hidden'); }
        else prompt.classList.add('hidden');
      }
    },
    dispose() { disposed = true; window.removeEventListener('keydown', onKey); },
  };
}

export type DecompressionPhase = 'idle' | 'warning' | 'flow' | 'done';

export interface DecompressionOptions {
  breach: THREE.Vector3;
  drawRadius?: number;
  warningTime?: number;
  flowTime?: number;
  /** Player is immune while hanging on something (handhold, sealed ledge). */
  anchored: () => boolean;
  /** Loose props dragged into the breach. Heavy cubes and anchored bodies must not be included. */
  looseBodies?: () => readonly CANNON.Body[];
  onEnd?: () => void;
}

export interface Decompression {
  start(): void;
  setBreach(point: THREE.Vector3): void;
  update(dt: number, player: Player | null, world: CANNON.World): void;
  phase(): DecompressionPhase;
  reset(): void;
}

/** Klaxon, then seconds of screaming airflow that drags anything unanchored toward the breach. */
export function createDecompression(options: DecompressionOptions): Decompression {
  const radius = options.drawRadius ?? 3;
  const warningTime = options.warningTime ?? 1.2;
  const flowTime = options.flowTime ?? 6;
  let phase: DecompressionPhase = 'idle', timer = 0;
  const breach = options.breach.clone();
  return {
    start() { if (phase === 'idle') { phase = 'warning'; timer = warningTime; } },
    setBreach(point: THREE.Vector3) { breach.copy(point); },
    phase: () => phase,
    reset() { phase = 'idle'; timer = 0; },
    update(dt, player, world) {
      if (phase === 'idle' || phase === 'done') return;
      timer -= dt;
      if (phase === 'warning' && timer <= 0) { phase = 'flow'; timer = flowTime; }
      if (phase === 'flow') {
        if (player?.isEnabled() && !options.anchored()) {
          const p = player.body.position;
          const flat = new CANNON.Vec3(breach.x - p.x, 0, breach.z - p.z);
          const distance = flat.length();
          if (distance < radius + 4 && distance > 0.05) {
            flat.normalize();
            const pull = THREE.MathUtils.clamp(1 + (radius - distance) * 1.6, 0.4, 4);
            const target = 6.5 * Math.min(1, pull / 2);
            player.body.velocity.x += (flat.x * target - player.body.velocity.x) * Math.min(1, dt * 5);
            player.body.velocity.z += (flat.z * target - player.body.velocity.z) * Math.min(1, dt * 5);
            if (distance < 0.9) {
              player.body.position.set(breach.x + (p.x - breach.x) / Math.max(distance, 0.001) * 0.9,
                Math.max(p.y, breach.y - 0.5), breach.z + (p.z - breach.z) / Math.max(distance, 0.001) * 0.9);
              player.body.velocity.y = Math.max(player.body.velocity.y, -0.5);
            }
          }
        }
        for (const body of options.looseBodies?.() ?? []) {
          if (body.mass <= 0 || body.mass > 60 || body.world !== world) continue;
          const p = body.position;
          const distance = Math.hypot(p.x - breach.x, p.z - breach.z);
          if (distance > radius || Math.abs(p.y - breach.y) > 2.2) continue;
          body.velocity.x += (breach.x - p.x) * dt * 3;
          body.velocity.z += (breach.z - p.z) * dt * 3;
        }
        if (timer <= 0) { phase = 'done'; options.onEnd?.(); }
      }
    },
  };
}

export interface PendulumOptions {
  parent: THREE.Object3D;
  anchor: THREE.Vector3;
  /** Horizontal unit axis the bob travels along. */
  axis: THREE.Vector3;
  length: number;
  startAngle: number;
  damping?: number;
  bob: THREE.Mesh;
}

export interface Pendulum {
  bobPosition(): THREE.Vector3;
  angle(): number;
  /** Begin integrating; before this the bob hangs still at startAngle. */
  start(): void;
  /** Freeze and hide the cable, e.g. when the bob is manually seated. */
  stop(): void;
  update(dt: number): void;
  /** Hands the bob to the physics world with its current tangential velocity. */
  release(world: CANNON.World): CANNON.Body;
  reset(): void;
}

/** Analytic swing until cut; period ~2*PI*sqrt(L/g), amplitude decays per spec tuning. */
export function createPendulum(options: PendulumOptions): Pendulum {
  const damping = options.damping ?? 0.045;
  let theta = options.startAngle, rate = 0, running = false, stopped = false, released = null as CANNON.Body | null;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.8 }));
  options.parent.add(cable);
  function place() {
    const anchor = options.anchor, axis = options.axis;
    const offset = axis.clone().multiplyScalar(Math.sin(theta) * options.length);
    const bob = new THREE.Vector3(anchor.x + offset.x, anchor.y - Math.cos(theta) * options.length, anchor.z + offset.z);
    if (!released) options.bob.position.copy(bob);
    const mid = new THREE.Vector3(anchor.x + offset.x / 2, (anchor.y + bob.y) / 2, anchor.z + offset.z / 2);
    cable.position.copy(mid);
    const span = new THREE.Vector3().subVectors(bob, anchor);
    cable.scale.set(1, Math.max(0.01, span.length()), 1);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.normalize());
  }
  place();
  return {
    bobPosition: () => options.bob.position.clone(),
    angle: () => theta,
    start() { if (!released && !stopped) running = true; },
    stop() { stopped = true; running = false; cable.visible = false; },
    update(dt) {
      if (released || stopped) return;
      if (running) {
        rate += (PHYSICS.gravity / options.length) * Math.sin(theta) * dt;
        rate *= Math.exp(-damping * dt);
        theta += rate * dt;
      }
      place();
    },
    release(world) {
      if (released) return released;
      const anchor = options.anchor, axis = options.axis;
      const velocity = axis.clone().multiplyScalar(Math.cos(theta) * options.length * rate);
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(options.bob).getSize(size);
      const body = new CANNON.Body({ mass: 200, shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)) });
      body.position.set(options.bob.position.x, options.bob.position.y, options.bob.position.z);
      body.velocity.set(velocity.x, velocity.y, velocity.z);
      body.linearDamping = 0.1; body.angularDamping = 0.4;
      world.addBody(body);
      released = body;
      cable.removeFromParent();
      return body;
    },
    reset() {
      theta = options.startAngle; rate = 0;
      if (released) { released.world?.removeBody(released); released = null; }
      place();
    },
  };
}

export interface Latch {
  /** Frame the swinging end lands in; latches when the end gets this close. */
  update(dt: number): void;
  latched(): boolean;
  endPosition(): THREE.Vector3;
  release(): void;
  reset(): void;
}

/** Umbilical/plug end: hangs tied back, swings when its clamp breaks, snaps into a socket. */
export function createSwingingLatch(parent: THREE.Object3D, anchor: THREE.Vector3, socket: THREE.Vector3,
  tiePoint: THREE.Vector3, snapRadius = 0.5, endMesh?: THREE.Mesh, axisOverride?: THREE.Vector3): Latch {
  const axis = (axisOverride ?? new THREE.Vector3(socket.x - anchor.x, 0, socket.z - anchor.z)).clone();
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
  axis.normalize();
  const length = Math.max(1.5, anchor.distanceTo(tiePoint));
  const tiedOffset = tiePoint.clone().sub(anchor);
  const startAngle = Math.atan2(Math.max(0.35, tiedOffset.dot(axis)), Math.max(0.4, anchor.y - tiePoint.y));
  let theta = startAngle, rate = 0, swinging = false, latched = false;
  const visual = endMesh ?? new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xa9b6bd, metalness: 0.75, roughness: 0.35 }));
  if (!visual.parent) parent.add(visual);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.85 }));
  parent.add(cable);
  function end(): THREE.Vector3 {
    return new THREE.Vector3(
      anchor.x + Math.sin(theta) * length * axis.x,
      anchor.y - Math.cos(theta) * length,
      anchor.z + Math.sin(theta) * length * axis.z);
  }
  function place() {
    const tip = latched ? socket.clone() : end();
    visual.position.copy(tip);
    const span = new THREE.Vector3().subVectors(tip, anchor);
    cable.position.copy(new THREE.Vector3().addVectors(anchor, span.clone().multiplyScalar(0.5)));
    cable.scale.set(1, Math.max(0.01, span.length()), 1);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
  }
  place();
  return {
    update(dt) {
      if (!swinging || latched) return;
      rate += (-PHYSICS.gravity / length) * Math.sin(theta) * dt;
      rate *= Math.exp(-0.05 * dt);
      theta += rate * dt;
      if (Math.abs(end().distanceTo(socket)) < snapRadius) latched = true;
      place();
    },
    latched: () => latched,
    endPosition: end,
    release() { swinging = true; },
    reset() { swinging = false; latched = false; theta = startAngle; rate = 0; place(); },
  };
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat: [number, number]) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, count: number, colors: string[], rMin: number, rMax: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, rMin + Math.random() * (rMax - rMin), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Painted ship panelling with seams and rivets: the clean side of the deck. */
export function panelMaterial(repeat: [number, number] = [3, 2], tone = { base: '#55677a', seam: '#3d4c5c', rivet: '#7d92a6' }) {
  const map = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = tone.base; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 260, ['#00000022', '#ffffff10'], 2, 14, 0.25);
    ctx.strokeStyle = tone.seam; ctx.lineWidth = 3;
    for (const y of [0, s / 2]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
    ctx.fillStyle = tone.rivet;
    for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc((i % 8 + 0.5) * s / 8, i < 8 ? 8 : s / 2 + 8, 2.4, 0, Math.PI * 2); ctx.fill(); }
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.35 });
}

/** Bolted deck plate with wear tracks: floors. */
export function deckPlateMaterial(repeat: [number, number] = [6, 6]) {
  const map = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#46566a'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#2c3a4a'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.fillStyle = '#5a6d82';
    for (const [x, y] of [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]] as const) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
    speckle(ctx, s, 340, ['#00000030', '#8fa2b830'], 2, 16, 0.3);
    ctx.strokeStyle = '#00000022'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(s * 0.3, 0); ctx.lineTo(s * 0.42, s); ctx.stroke();
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.4 });
}

/** Cast-steel grating: sump floors, bridges, catwalk treads. */
export function grateMaterial(repeat: [number, number] = [4, 4]) {
  const map = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#232d38'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#0c1218';
    for (let x = 6; x < s; x += 16) ctx.fillRect(x, 0, 7, s);
    for (let y = 10; y < s; y += 42) { ctx.fillStyle = '#3a4a5c'; ctx.fillRect(0, y, s, 5); ctx.fillStyle = '#0c1218'; }
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0.5 });
}

/** Corroded bulkhead: the rust side of the deck. Patches, bleed and drip streaks. */
export function rustWallMaterial(repeat: [number, number] = [2, 1], tone = { base: '#5a4f44', hot: ['#8c4d1e', '#a86228', '#6e3d1a'], stain: '#241a12' }) {
  const map = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = tone.base; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 70, tone.hot, 10, 44, 0.16);
    speckle(ctx, s, 320, tone.hot, 1.5, 9, 0.3);
    speckle(ctx, s, 90, ['#1c130c'], 2, 11, 0.3);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s, y = Math.random() * s * 0.6, len = 40 + Math.random() * 160;
      const grad = ctx.createLinearGradient(x, y, x, y + len);
      grad.addColorStop(0, tone.stain + 'aa'); grad.addColorStop(1, tone.stain + '00');
      ctx.fillStyle = grad; ctx.fillRect(x, y, 3 + Math.random() * 5, len);
    }
    ctx.strokeStyle = '#00000044'; ctx.lineWidth = 3;
    for (const y of [s * 0.33, s * 0.66]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  }, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.94, metalness: 0.12 });
}

/** Structural beam / girder stock. */
export function steelMaterial(color = 0x59697a) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.65 });
}

/** Standard chamber lighting: cool ship ambience plus warm rust glow pools. */
export function lightChamber(scene: THREE.Scene, glowPoints: readonly THREE.Vector3[], ambientIntensity = 2.6) {
  scene.add(new THREE.HemisphereLight(0xbce0ff, 0x3a322a, ambientIntensity));
  const key = new THREE.DirectionalLight(0xdff0ff, 1.7);
  key.position.set(0.4, 1, 0.25);
  scene.add(key);
  for (const point of glowPoints) {
    const glow = new THREE.PointLight(0xff8b3a, 16, 14, 2);
    glow.position.copy(point);
    scene.add(glow);
  }
}

export const CHAMBER_STEEL = () => new THREE.MeshStandardMaterial({ color: 0x5c6c7c, metalness: 0.5, roughness: 0.6 });
export const CHAMBER_DARK = () => new THREE.MeshStandardMaterial({ color: 0x28374a, metalness: 0.45, roughness: 0.7 });
export const CHAMBER_FLOOR = () => new THREE.MeshStandardMaterial({ color: 0x415061, metalness: 0.4, roughness: 0.7 });
export const CHAMBER_TRIM = () => new THREE.MeshStandardMaterial({ color: 0x8b9dab, metalness: 0.7, roughness: 0.4 });
export const CHAMBER_CRATE = () => new THREE.MeshStandardMaterial({ color: 0x7a6248, metalness: 0.2, roughness: 0.8 });

export { createScenePhysics, roomBox, PHYSICS, createBreakables };
