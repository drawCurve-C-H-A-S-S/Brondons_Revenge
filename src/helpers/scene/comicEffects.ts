import * as THREE from 'three';

export type ComicEffectKind = 'hit' | 'boom' | 'clank' | 'pew' | 'thud';
interface ComicEffectOptions {
  source?: THREE.Object3D;
  position?: THREE.Vector3;
  anchor?: THREE.Object3D;
  size?: number;
  weapon?: string;
}
interface Effect {
  kind: ComicEffectKind;
  word: string;
  source?: THREE.Object3D;
  anchor: THREE.Object3D | null;
  point: THREE.Vector3;
  localPoint: THREE.Vector3;
  size: number;
  age: number;
  side: number;
  sprite: THREE.Sprite | null;
}
interface ComicSystem {
  container: THREE.Object3D;
  root: THREE.Group;
  active: Effect[];
  pool: THREE.Sprite[];
  sprites: Set<THREE.Sprite>;
  textures: Map<string, THREE.CanvasTexture>;
  cooldowns: WeakMap<THREE.Object3D, Partial<Record<ComicEffectKind, number>>>;
  time: number;
  serial: number;
  reducedMotion: boolean;
}

const MAX_EFFECTS = 48;
const STYLE = {
  hit: { life: 0.55, opacity: 0.95, color: '#ffdb57', minPixels: 26, maxPixels: 58, cooldown: 0.13, burst: true },
  boom: { life: 1.05, opacity: 1, color: '#ff9842', minPixels: 48, maxPixels: 108, cooldown: 0.4, burst: true },
  clank: { life: 0.95, opacity: 1, color: '#a8e9f5', minPixels: 40, maxPixels: 92, cooldown: 0.4, burst: true },
  pew: { life: 0.32, opacity: 0.46, color: '#c9f7ff', minPixels: 15, maxPixels: 25, cooldown: 0.24, burst: false },
  thud: { life: 0.8, opacity: 0.95, color: '#ffdb57', minPixels: 34, maxPixels: 76, cooldown: 0.4, burst: true },
} as const;
const systems = new WeakMap<THREE.Object3D, ComicSystem>();
const roots = new WeakMap<THREE.Object3D, ComicSystem>();
const metrics = new WeakMap<THREE.Object3D, { center: THREE.Vector3; size: number }>();
const cameraPosition = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3();
const cameraRotation = new THREE.Quaternion();
const position = new THREE.Vector3(), projected = new THREE.Vector3(), viewSize = new THREE.Vector2();

function containerRoot(container: THREE.Object3D) {
  while (container.parent) container = container.parent;
  return container;
}

function systemFor(container: THREE.Object3D) {
  container = containerRoot(container);
  let system = systems.get(container);
  if (!system) {
    const root = new THREE.Group(); root.name = 'ComicCombatEffects'; root.userData.minimap = false; container.add(root);
    system = { container, root, active: [], pool: [], sprites: new Set(), textures: new Map(), cooldowns: new WeakMap(),
      time: 0, serial: 0, reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true };
    systems.set(container, system); roots.set(root, system);
  }
  return system;
}

function sourceFrame(source: THREE.Object3D) {
  let frame = metrics.get(source);
  source.updateWorldMatrix(true, true);
  if (!frame) {
    const bounds = new THREE.Box3().setFromObject(source), size = bounds.getSize(new THREE.Vector3());
    const center = bounds.isEmpty() ? source.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
    frame = { center: source.worldToLocal(center), size: Math.max(0.5, size.y, Math.min(size.x, size.z) * 0.4) };
    metrics.set(source, frame);
  }
  return { position: source.localToWorld(frame.center.clone()), size: frame.size };
}

function release(system: ComicSystem, index: number) {
  const [effect] = system.active.splice(index, 1);
  if (effect.sprite) { effect.sprite.visible = false; system.pool.push(effect.sprite); }
}

export function emitComicEffect(container: THREE.Object3D, kind: ComicEffectKind, options: ComicEffectOptions) {
  if (!options.source && !options.position) throw new Error('A comic combat effect requires a source or world position');
  if ((options.position && !options.position.toArray().every(Number.isFinite))
    || (options.size !== undefined && (!Number.isFinite(options.size) || options.size <= 0))) {
    throw new Error('Invalid comic combat effect position or size');
  }
  const system = systemFor(container), style = STYLE[kind];
  const cooldown = options.source ? system.cooldowns.get(options.source) ?? {} : null;
  if (cooldown && system.time - (cooldown[kind] ?? -Infinity) < style.cooldown) return;
  const frame = options.source && (!options.position || options.size === undefined) ? sourceFrame(options.source) : null;
  const point = options.position?.clone() ?? frame?.position;
  const size = options.size ?? frame?.size ?? 1;
  if (!point || !point.toArray().every(Number.isFinite) || !Number.isFinite(size) || size <= 0) throw new Error('Invalid comic combat effect position or size');
  if (options.source && cooldown) {
    cooldown[kind] = system.time; system.cooldowns.set(options.source, cooldown);
    if (kind === 'boom' || kind === 'clank' || kind === 'thud') {
      for (let index = system.active.length - 1; index >= 0; index--) {
        if (system.active[index].source === options.source) release(system, index);
      }
    }
  }
  if (system.active.length >= MAX_EFFECTS) {
    const lowPriority = system.active.findIndex(effect => effect.kind === 'pew' || effect.kind === 'hit');
    release(system, lowPriority < 0 ? 0 : lowPriority);
  }
  const word = kind === 'hit'
    ? options.weapon === 'sword' ? ['SHING!', 'SWOOSH!', 'KRAK!'][system.serial % 3]
      : options.weapon === 'lightsaber' || options.weapon === 'laser' ? 'ZAP!' : options.weapon === 'crowbar' ? 'KRAK!' : ['BAM!', 'PING!', 'KRAK!'][system.serial % 3]
    : `${kind.toUpperCase()}!`;
  const anchor = options.anchor ?? ((kind === 'hit' || kind === 'pew') ? options.source ?? null : null);
  const localPoint = anchor ? anchor.worldToLocal(point.clone()) : point.clone();
  system.active.push({ kind, word, source: options.source, anchor, point, localPoint, size, age: 0,
    side: system.serial++ % 2 ? -1 : 1, sprite: null });
}

function textureFor(system: ComicSystem, effect: Effect) {
  const key = `${effect.kind}:${effect.word}`;
  let texture = system.textures.get(key);
  if (texture) return texture;
  texture = new THREE.CanvasTexture(createComicEffectArtwork(effect.kind, effect.word));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  system.textures.set(key, texture); return texture;
}

export function createComicEffectArtwork(kind: ComicEffectKind, word = `${kind.toUpperCase()}!`) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw new Error('Comic combat effects require a 2D canvas context');
  const font = 'italic 900 104px Impact, Haettenschweiler, "Franklin Gothic Heavy", sans-serif';
  context.font = font;
  canvas.width = Math.ceil(context.measureText(word).width + 110); canvas.height = 190;
  context.font = font; context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineJoin = 'round';
  const style = STYLE[kind], x = canvas.width / 2, y = canvas.height / 2;
  if (style.burst) {
    const burst = () => {
      context.beginPath();
      for (let index = 0; index < 24; index++) {
        const angle = index * Math.PI / 12, radius = index % 2 ? 0.72 : 1;
        const px = x + Math.cos(angle) * (x - 14) * radius, py = y + Math.sin(angle) * (y - 13) * radius;
        if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
      }
      context.closePath();
    };
    context.save(); context.translate(5, 7); burst(); context.fillStyle = '#17191f'; context.fill(); context.restore();
    burst(); context.fillStyle = style.color; context.fill(); context.strokeStyle = '#17191f'; context.lineWidth = 7; context.stroke();
    context.save(); context.clip(); context.fillStyle = '#17191f'; context.globalAlpha = 0.12;
    for (let row = 14; row < canvas.height; row += 13) for (let column = 10; column < canvas.width; column += 13) {
      context.beginPath(); context.arc(column, row, 1.7, 0, Math.PI * 2); context.fill();
    }
    context.restore();
  }
  context.strokeStyle = '#f7fbff'; context.lineWidth = style.burst ? 16 : 10; context.strokeText(word, x, y + 5);
  context.strokeStyle = '#17191f'; context.lineWidth = style.burst ? 10 : 6; context.strokeText(word, x, y + 5);
  context.fillStyle = kind === 'boom' ? '#fff3a5' : kind === 'clank' ? '#f7fbff' : style.color;
  context.fillText(word, x, y + 5);
  return canvas;
}

export function updateComicEffects(container: THREE.Object3D, camera: THREE.Camera, dt: number, renderer: THREE.WebGLRenderer) {
  const system = systems.get(containerRoot(container));
  if (!system) return;
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Comic combat effects require a finite, nonnegative frame delta');
  const delta = Math.min(dt, 0.1);
  system.time += delta;
  camera.updateWorldMatrix(true, false); camera.getWorldPosition(cameraPosition); camera.getWorldDirection(forward);
  camera.getWorldQuaternion(cameraRotation);
  right.set(1, 0, 0).applyQuaternion(cameraRotation); up.set(0, 1, 0).applyQuaternion(cameraRotation);
  renderer.getSize(viewSize);
  for (let index = system.active.length - 1; index >= 0; index--) {
    const effect = system.active[index], style = STYLE[effect.kind]; effect.age += delta;
    if (effect.age >= style.life) { release(system, index); continue; }
    position.copy(effect.point);
    if (effect.anchor) { effect.anchor.updateWorldMatrix(true, false); position.copy(effect.localPoint).applyMatrix4(effect.anchor.matrixWorld); }
    const depth = projected.copy(position).sub(cameraPosition).dot(forward);
    projected.copy(position).project(camera);
    if (depth <= 0.05 || Math.abs(projected.x) > 1.4 || Math.abs(projected.y) > 1.4 || projected.z > 1) {
      if (effect.sprite) effect.sprite.visible = false;
      continue;
    }
    let visibleHeight: number;
    if (camera instanceof THREE.PerspectiveCamera) visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2)) * depth;
    else if (camera instanceof THREE.OrthographicCamera) visibleHeight = (camera.top - camera.bottom) / camera.zoom;
    else throw new Error('Comic combat effects require a perspective or orthographic camera');
    const pixelsPerUnit = Math.max(1, viewSize.y) / visibleHeight;
    const pixels = THREE.MathUtils.clamp(effect.size * (effect.kind === 'pew' ? 0.2 : 0.62) * pixelsPerUnit, style.minPixels, style.maxPixels);
    const height = pixels / pixelsPerUnit, progress = effect.age / style.life;
    if (!effect.sprite) {
      const sprite = system.pool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false, toneMapped: false }));
      if (!system.sprites.has(sprite)) {
        sprite.name = 'ComicCombatWord'; sprite.userData.minimap = false; sprite.userData.comicEffect = true;
        // World labels are decorative, never bullet targets or interaction surfaces.
        sprite.raycast = () => {};
        system.root.add(sprite); system.sprites.add(sprite);
      }
      sprite.material.map = textureFor(system, effect); sprite.material.needsUpdate = true; effect.sprite = sprite;
    }
    const sprite = effect.sprite, image = sprite.material.map!.image;
    const aspect = image.width / image.height;
    const pop = system.reducedMotion ? 1 : 0.8 + THREE.MathUtils.smootherstep(progress, 0, 0.16) * 0.2 + Math.sin(THREE.MathUtils.clamp(progress / 0.28, 0, 1) * Math.PI) * 0.13;
    const sideOffset = height * (aspect * 0.5 + 0.25) + Math.min(effect.size * 0.3, height * 0.75);
    sprite.position.copy(position).addScaledVector(right, effect.side * sideOffset)
      .addScaledVector(up, height * (0.45 + (system.reducedMotion ? 0 : progress * 0.55)));
    sprite.scale.set(height * aspect * pop, height * pop, 1);
    sprite.material.rotation = system.reducedMotion ? 0 : effect.side * (effect.kind === 'pew' ? 0.1 : 0.15);
    sprite.material.opacity = style.opacity * THREE.MathUtils.smoothstep(progress, 0, 0.09) * (1 - THREE.MathUtils.smoothstep(progress, 0.58, 1));
    sprite.visible = true;
  }
}

export function clearComicEffects(container: THREE.Object3D) {
  const system = systems.get(containerRoot(container));
  if (!system) return;
  while (system.active.length) release(system, system.active.length - 1);
  system.cooldowns = new WeakMap();
}

export function disposeComicEffects(container: THREE.Object3D) {
  const owned: ComicSystem[] = [];
  const direct = systems.get(container); if (direct) owned.push(direct);
  container.traverse(node => { const system = roots.get(node); if (system && !owned.includes(system)) owned.push(system); });
  for (const system of owned) {
    system.sprites.forEach(sprite => sprite.material.dispose()); system.textures.forEach(texture => texture.dispose());
    system.root.removeFromParent(); system.root.clear(); system.active.length = system.pool.length = 0;
    systems.delete(system.container); roots.delete(system.root);
  }
}
