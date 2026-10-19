import * as THREE from 'three';
import { loadBrendanModel, loadPlayerModel, setPlayerCellShadingEnabled } from '../../core/loader.js';
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
  
  void main() {
    vec3 pos = vWorldPosition * 2.0 + uNoiseOffset;
    pos += vec3(uTime * 0.15, uTime * 0.08, uTime * 0.12);
    
    vec3 p1 = pos * 0.3;
    vec3 p2 = pos * 0.15 + 100.0;
    
    vec3 warped1 = p1 + fbm(p1) * uWarpStrength;
    vec3 warped2 = p2 + fbm(p2) * uWarpStrength;
    
    float nebula = mix(fbm(warped1), ridgeFbm(p1), uRidgeStrength);
    float nebula2 = mix(fbm(warped2), ridgeFbm(p2), uRidgeStrength);
    
    float cloud = nebula * 0.7 + nebula2 * 0.3;
    
    vec3 voidColor = vec3(0.02, 0.01, 0.03);
    float cloudAlpha = smoothstep(uThresholdLow, uThresholdHigh, cloud) * uOpacity;
    if (uInvertAlpha) {
      cloudAlpha = smoothstep(uThresholdHigh, uThresholdHigh + 0.08, cloud) * uOpacity;
    }
    vec3 finalColor = uColor;
    if (uHasBlend) {
      float blendNoise = noise(pos * 0.4 + 300.0);
      finalColor = mix(uColor, uBlendColor, blendNoise);
    }
    vec3 color = mix(voidColor, finalColor, cloudAlpha / uOpacity);
    
    float density = cloudAlpha / uOpacity;
    if (!uInvertAlpha) {
      color = mix(color, vec3(1.0, 0.6, 0.1), pow(density, 4.0) * 0.2);
      float whiteCore = smoothstep(0.65, 0.75, cloud);
      color = mix(color, vec3(1.0), whiteCore * 0.7);
    }
    
    if (uDither) {
      vec2 gridPos = vWorldPosition.xy * 30.0;
      float ditherPattern = fract(sin(dot(gridPos, vec2(12.9898, 78.233))) * 43758.5453);
      float threshold = 0.5 + (ditherPattern - 0.5) * 0.8;
      if (cloudAlpha < threshold * uOpacity) {
        color = vec3(0.0);
        cloudAlpha = 0.0;
      }
    }
    
    gl_FragColor = vec4(color, cloudAlpha);
  }
`;

let previewRenderer: THREE.WebGLRenderer | null = null;
let previewScene: THREE.Scene | null = null;
let previewCamera: THREE.OrthographicCamera | null = null;
let previewModel: THREE.Object3D | null = null;
let previewRafId = 0;
let starfieldUniforms: THREE.IUniform<number>[] = [];

function applyStarfieldBackdrop(scene: THREE.Object3D) {
  const materialMap = new Map<THREE.Material, THREE.Material>();
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  starfieldUniforms = [];
  
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    
    const meshMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const newMaterials: THREE.Material[] = [];
    
    for (const material of meshMaterials) {
      if (materialMap.has(material)) {
        newMaterials.push(materialMap.get(material)!);
        continue;
      }
      
      if (/linework|outline/i.test(material.name)) {
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
      };
      
      starfieldUniforms.push(uniforms.uTime);
      
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
      model.position.set(1.8, 0.04, -horizontalOffset);
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

  const clock = new THREE.Clock();
  const render = () => {
    if (!previewRenderer || !previewScene || !previewCamera) return;
    previewRafId = requestAnimationFrame(render);
    
    const elapsed = clock.getElapsedTime();
    for (const uniforms of starfieldUniforms) {
      uniforms.value = elapsed;
    }
    
    previewRenderer.render(previewScene, previewCamera);
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

export function stopCharacterPreview() {
  window.removeEventListener('keydown', onPreviewKey, true);
  swapPreview = null;
  if (previewRafId) {
    cancelAnimationFrame(previewRafId);
    previewRafId = 0;
  }
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
