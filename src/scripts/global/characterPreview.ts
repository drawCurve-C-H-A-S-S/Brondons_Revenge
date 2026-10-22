import * as THREE from 'three';
import { loadBrendanModel, loadPlayerModel, setPlayerCellShadingEnabled } from '../../core/loader.js';
import { createStarfield, type Starfield } from './starfield.js';
const starfieldVertShader = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;
const starfieldFragShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uBlendColor;
  uniform vec3 uNoiseOffset;
  uniform float uOpacity;
  uniform bool uInvertAlpha;
  uniform int uOctaves;
  uniform bool uHasBlend;
  uniform bool uDither;
  uniform float uRidgeStrength;
  uniform float uWarpStrength;
  uniform float uThresholdLow;
  uniform float uThresholdHigh;
  uniform sampler2D uBackdrop;
  uniform vec2 uResolution;
  uniform vec3 uEmissive;
  uniform float uEmissiveScale;
  uniform float uGradientMix;
  uniform float uLightnessMix;

  varying vec3 vWorldPosition;
  
  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec3(1.0, 0.0, 0.0));
    float c = hash(i + vec3(0.0, 1.0, 0.0));
    float d = hash(i + vec3(1.0, 1.0, 0.0));
    float e = hash(i + vec3(0.0, 0.0, 1.0));
    float ff = hash(i + vec3(1.0, 0.0, 1.0));
    float g = hash(i + vec3(0.0, 1.0, 1.0));
    float h = hash(i + vec3(1.0, 1.0, 1.0));
    
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    float x3 = mix(e, ff, f.x);
    float x4 = mix(g, h, f.x);
    float y1 = mix(x1, x2, f.y);
    float y2 = mix(x3, x4, f.y);
    return mix(y1, y2, f.z);
  }
  
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 8; i++) {
      if (i >= uOctaves) break;
      value += amplitude * noise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }
  
  float ridgeNoise(vec3 p) {
    return 1.0 - abs(noise(p) * 2.0 - 1.0);
  }
  
  float ridgeFbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 8; i++) {
      if (i >= uOctaves) break;
      value += amplitude * ridgeNoise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }
  
  vec3 rgb2hsl(vec3 c) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float l = (maxC + minC) * 0.5;
    float h = 0.0;
    float s = 0.0;
    float d = maxC - minC;
    if (d > 0.0001) {
      s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
      if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, s, l);
  }

  vec3 hsl2rgb(vec3 hsl) {
    float h = fract(hsl.x);
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
  }

  void main() {
    vec4 backdrop = texture2D(uBackdrop, gl_FragCoord.xy / uResolution);
    float gradT = clamp(gl_FragCoord.y / uResolution.y, 0.0, 1.0);
    vec3 gradient = gradT < 0.5 ? mix(vec3(11.0, 14.0, 51.0) / 255.0, vec3(119.0, 75.0, 34.0) / 255.0, gradT * 2.0) : mix(vec3(119.0, 75.0, 34.0) / 255.0, vec3(255.0, 153.0, 26.0) / 255.0, (gradT - 0.5) * 2.0);
    vec3 emissiveHsl = rgb2hsl(uEmissive);
    vec3 gradientHsl = rgb2hsl(gradient);
    float hueDiff = gradientHsl.x - emissiveHsl.x;
    if (hueDiff > 0.5) emissiveHsl.x += 1.0;
    else if (hueDiff < -0.5) emissiveHsl.x -= 1.0;
    float hue = fract(mix(emissiveHsl.x, gradientHsl.x, uGradientMix));
    float lightness = clamp(mix(emissiveHsl.z * uEmissiveScale, gradientHsl.z, uLightnessMix), 0.0, 1.0);
    vec3 tint = hsl2rgb(vec3(hue, gradientHsl.y, lightness));
    gl_FragColor = vec4(backdrop.rgb + tint * (1.0 - backdrop.a), 1.0);
  }
`;

let previewRenderer: THREE.WebGLRenderer | null = null;
let previewScene: THREE.Scene | null = null;
let previewCamera: THREE.OrthographicCamera | null = null;
let previewModel: THREE.Object3D | null = null;
let previewRafId = 0;
let previewStarfield: Starfield | null = null;
let starfieldScene: THREE.Scene | null = null;
let starfieldCamera: THREE.PerspectiveCamera | null = null;
let previewRenderTarget: THREE.WebGLRenderTarget | null = null;
let backdropScene: THREE.Scene | null = null;
let backdropCamera: THREE.OrthographicCamera | null = null;
let backdropMaterial: THREE.ShaderMaterial | null = null;
let postRenderHook: (() => void) | null = null;

function applyStarfieldBackdrop(scene: THREE.Object3D) {
  const materialMap = new Map<THREE.Material, THREE.Material>();
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    
    const meshMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const newMaterials: THREE.Material[] = [];
    
    for (const material of meshMaterials) {
      if (materialMap.has(material)) {
        newMaterials.push(materialMap.get(material)!);
        continue;
      }
      
      if (/linework|outline/i.test(material.name) || material.name === 'eyewhites') {
        materialMap.set(material, material);
        newMaterials.push(material);
        continue;
      }
      
      const isEyeWhite = material.name === 'eyewhites';
      const isEyeBase = material.name === 'eyebase';
      const isEyeDark = material.name === 'eyedark';
      const isHair = material.name === 'hair' || material.name === 'hairsurface.001';
      console.log('[CharacterPreview] Material:', material.name, 'isEyeWhite:', isEyeWhite, 'isEyeBase:', isEyeBase, 'isEyeDark:', isEyeDark, 'isHair:', isHair);
      
      const emissive = 'emissive' in material ? (material as any).emissive : new THREE.Color(0.35, 0.24, 0.42);
      const defaultColor = new THREE.Color(0.35, 0.24, 0.42);
      const tintedColor = emissive.clone().lerp(defaultColor, 0.85);
      const blendColor = tintedColor.clone().multiplyScalar(1.3);

      const uniforms = {
        uTime: { value: 0 },
        uColor: { value: tintedColor },
        uBlendColor: { value: blendColor },
        uNoiseOffset: { value: new THREE.Vector3(0, 0, 0) },
        uOpacity: { value: 0.4 },
        uInvertAlpha: { value: false },
        uOctaves: { value: 4 },
        uHasBlend: { value: true },
        uDither: { value: false },
        uRidgeStrength: { value: 0.3 },
        uWarpStrength: { value: 0.5 },
        uThresholdLow: { value: 0.2 },
        uThresholdHigh: { value: 0.4 },
        uBackdrop: { value: previewRenderTarget ? previewRenderTarget.texture : null },
        uResolution: {
          value: previewRenderer
            ? previewRenderer.getDrawingBufferSize(new THREE.Vector2())
            : new THREE.Vector2(1, 1),
        },
        uEmissive: { value: emissive.clone() },
        uEmissiveScale: { value: 1.0 },
        uGradientMix: { value: 0.55 },
        uLightnessMix: { value: 0.75 },
      };

      const shaderMaterial = new THREE.ShaderMaterial({
        vertexShader: starfieldVertShader,
        fragmentShader: starfieldFragShader,
        uniforms,
      });

      materialMap.set(material, shaderMaterial);
      newMaterials.push(shaderMaterial);
    }
    
    originalMaterials.set(node, node.material);
    node.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;
  });
  
  return originalMaterials;
}

function restoreOriginalMaterials(scene: THREE.Object3D, originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>) {
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const original = originalMaterials.get(node);
    if (original) {
      node.material = original;
    }
  });
}

export function startCharacterPreview(container: HTMLElement) {
  console.log('[CharacterPreview] Starting preview', { container, width: container.clientWidth, height: container.clientHeight });
  stopCharacterPreview();
  container.classList.add('active');

  const width = container.clientWidth || 140;
  const height = container.clientHeight || 140;

  previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  previewRenderer.setSize(width, height);
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  previewRenderer.toneMappingExposure = 1.0;
  container.appendChild(previewRenderer.domElement);

  previewScene = new THREE.Scene();
  previewScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 3, 1);
  previewScene.add(key);

  const aspect = width / height;
  const frustumHeight = 0.3;
  const frustumWidth = frustumHeight * aspect;
  const camera = new THREE.OrthographicCamera(
    -frustumWidth / 2, frustumWidth / 2,
    frustumHeight / 2, -frustumHeight / 2,
    0.1, 50
  );
  camera.position.set(3.0, 1.9, 0.0);
  camera.lookAt(0, 1.5, 0);
  previewCamera = camera;

  starfieldScene = new THREE.Scene();
  starfieldCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  previewStarfield = createStarfield({
    scene: starfieldScene,
    renderer: previewRenderer,
    nebulaOpacity: 1.0,
    starCount: 650,
    glowOpacity: 0.15,
    scale: 1.0,
    sizeScale: 1.0,
    dither: false,
  });
  previewStarfield.starLayers.forEach((layer, i) => {
    layer.renderOrder = i + 1;
  });
  previewRenderer.autoClear = false;

  const drawSize = previewRenderer.getDrawingBufferSize(new THREE.Vector2());
  previewRenderTarget = new THREE.WebGLRenderTarget(
    Math.max(1, drawSize.x),
    Math.max(1, drawSize.y),
  );
  backdropScene = new THREE.Scene();
  backdropCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  backdropMaterial = new THREE.ShaderMaterial({
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader:
      'uniform sampler2D tBackdrop; uniform bool uGradient; varying vec2 vUv; void main() { if (vUv.x > 0.65) discard; vec4 c = texture2D(tBackdrop, vUv); float dim = smoothstep(0.2, 0.65, vUv.x) * 0.35; if (uGradient) { vec3 grad = vUv.y < 0.5 ? mix(vec3(11.0, 14.0, 51.0) / 255.0, vec3(119.0, 75.0, 34.0) / 255.0, vUv.y * 2.0) : mix(vec3(119.0, 75.0, 34.0) / 255.0, vec3(255.0, 153.0, 26.0) / 255.0, (vUv.y - 0.5) * 2.0); gl_FragColor = vec4(c.rgb * (1.0 - dim) * c.a + grad * (1.0 - c.a), 1.0); } else { gl_FragColor = vec4(c.rgb * (1.0 - dim), c.a); } }',
    uniforms: {
      tBackdrop: { value: previewRenderTarget.texture },
      uGradient: { value: container.id !== 'scene-character-preview' },
    },
    depthTest: false,
    depthWrite: false,
  });
  backdropScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMaterial));

  const horizontalOffset = THREE.MathUtils.clamp(
    0.13 * (width / height) / (16 / 9),
    0.05,
    0.18,
  );
  let variant: 'brondon' | 'brendan' = 'brondon', loadToken = 0;

  async function loadVariant(next: 'brondon' | 'brendan') {
    const token = ++loadToken;
    try {
      let model: THREE.Object3D;
      if (next === 'brondon') {
        model = (await loadPlayerModel()).scene;
        setPlayerCellShadingEnabled(model, false);
      } else {
        // Brendan's asset is unscaled, so fit it to Brondon's height and stand it on the origin.
        const source = (await loadBrendanModel()).scene;
        const fit = new THREE.Box3().setFromObject(source);
        source.scale.multiplyScalar(1.83 / Math.max(0.01, fit.getSize(new THREE.Vector3()).y));
        fit.setFromObject(source);
        const center = fit.getCenter(new THREE.Vector3());
        source.position.set(-center.x, -fit.min.y, -center.z);
        model = new THREE.Group(); model.add(source);
      }
      if (token !== loadToken || !previewScene) return;
      if (previewModel) previewScene.remove(previewModel);
      previewModel = model;
      model.position.set(1.8, 0.045, -horizontalOffset);
      model.rotation.set(0, Math.PI, 0, 'YXZ');
      model.scale.x = -1;
      applyStarfieldBackdrop(model);
      previewScene.add(model);
    } catch (error) {
      console.error('[CharacterPreview] Failed to load model:', error);
    }
  }
  void loadVariant(variant);
  swapPreview = () => { variant = variant === 'brondon' ? 'brendan' : 'brondon'; void loadVariant(variant); };
  window.addEventListener('keydown', onPreviewKey, true);

  const startTime = performance.now() * 0.001;
  const render = () => {
    if (!previewRenderer || !previewScene || !previewCamera || !previewStarfield || !starfieldScene || !starfieldCamera || !previewRenderTarget || !backdropScene || !backdropCamera) return;
    previewRafId = requestAnimationFrame(render);

    const elapsed = performance.now() * 0.001 - startTime;
    previewStarfield.update(elapsed);
    const nebulaShell = previewStarfield.nebulaCubes[0];
    if (nebulaShell) nebulaShell.rotation.y = elapsed * 0.05;
    for (const layer of previewStarfield.starLayers) layer.rotation.y = elapsed * 0.05;
    previewRenderer.setRenderTarget(previewRenderTarget);
    previewRenderer.clear(true, true, false);
    previewRenderer.render(starfieldScene, starfieldCamera);
    previewRenderer.setRenderTarget(null);
    previewRenderer.clear(true, true, false);
    previewRenderer.render(backdropScene, backdropCamera);
    previewRenderer.render(previewScene, previewCamera);
    postRenderHook?.();
  };
  render();
  console.log('[CharacterPreview] Render loop started');
}

let swapPreview: (() => void) | null = null;
function onPreviewKey(event: KeyboardEvent) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.code === 'Digit2' || event.code === 'Numpad2') {
    event.preventDefault(); event.stopImmediatePropagation(); swapPreview?.();
  }
}

export function setCharacterPreviewPostRender(callback: (() => void) | null) {
  postRenderHook = callback;
}

export function getCharacterPreviewRenderer() {
  return previewRenderer;
}

export function stopCharacterPreview() {
  window.removeEventListener('keydown', onPreviewKey, true);
  swapPreview = null;
  if (previewRafId) {
    cancelAnimationFrame(previewRafId);
    previewRafId = 0;
  }
  if (previewStarfield) {
    previewStarfield.dispose();
    previewStarfield = null;
  }
  starfieldScene = null;
  starfieldCamera = null;
  if (previewRenderTarget) {
    previewRenderTarget.dispose();
    previewRenderTarget = null;
  }
  if (backdropScene) {
    backdropScene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
    backdropScene = null;
  }
  backdropCamera = null;
  backdropMaterial = null;
  if (previewRenderer) {
    previewRenderer.dispose();
    previewRenderer.domElement.remove();
    previewRenderer = null;
  }
  previewScene = null;
  previewCamera = null;
  previewModel = null;
  document.getElementById('pause-character-preview')?.classList.remove('active');
  document.getElementById('scene-character-preview')?.classList.remove('active');
}
