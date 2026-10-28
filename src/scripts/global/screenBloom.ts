import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

export type BloomMode = "off" | "bright" | "soft";

const vertexShader =
  "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const AddShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
    uMax: { value: 100 },
  },
  vertexShader,
  fragmentShader:
    "uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform float uMax; varying vec2 vUv; void main() { vec3 glow = min(texture2D(tBloom, vUv).rgb, vec3(uMax)); gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb + glow, 1.0); }",
};
const BlendShader = {
  uniforms: {
    tNew: { value: null as THREE.Texture | null },
    tOld: { value: null as THREE.Texture | null },
    uRate: { value: 1 },
  },
  vertexShader,
  fragmentShader:
    "uniform sampler2D tNew; uniform sampler2D tOld; uniform float uRate; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(tOld, vUv), texture2D(tNew, vUv), uRate); }",
};

function isLightSource(object: THREE.Object3D, material: THREE.Material) {
  if (
    object instanceof THREE.Sprite ||
    object instanceof THREE.Points ||
    object instanceof THREE.Line
  )
    return true;
  if (
    material instanceof THREE.MeshBasicMaterial ||
    material instanceof THREE.ShaderMaterial ||
    material instanceof THREE.RawShaderMaterial
  )
    return true;
  const emissive = material as THREE.MeshStandardMaterial;
  return (
    !!emissive.emissive &&
    emissive.emissiveIntensity > 0 &&
    emissive.emissive.r + emissive.emissive.g + emissive.emissive.b > 0.02
  );
}

/**
 * Selective screen bloom: only things that emit light (emissive materials, unlit glows, lasers, sprites,
 * particles) are rendered into the bloom buffer; lit surfaces are blacked out so they cast no glow
 * but still hide emitters behind them.
 *
 * 'bright' is the strong version. 'soft' is dimmer, caps the glow and eases it in and out over several
 * frames, so brief flashes (muzzle flares, explosions) swell gently instead of strobing.
 * A scene can also request a temporary bright pulse while the mode is 'off'.
 */
export function createScreenBloom(
  renderer: THREE.WebGLRenderer,
  mobile: boolean,
) {
  const size = new THREE.Vector2(),
    position = new THREE.Vector2();
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const blendMaterial = new THREE.ShaderMaterial({
    ...BlendShader,
    uniforms: THREE.UniformsUtils.clone(BlendShader.uniforms),
  });
  const blendQuad = new FullScreenQuad(blendMaterial);
  let frame: THREE.FramebufferTexture | null = null,
    history: THREE.WebGLRenderTarget[] = [],
    historyIndex = 0,
    historyValid = false;
  let bloomComposer: EffectComposer | null = null,
    finalComposer: EffectComposer | null = null;
  let renderPass: RenderPass, bloom: UnrealBloomPass, addPass: ShaderPass;
  let width = 0,
    height = 0,
    last = performance.now();
  // The slider sets the overall amount (0 = off); the style only changes how the glow behaves.
  let level = 0;
  let style: Exclude<BloomMode, "off"> = "soft";
  let lastLevel = level || 0.6;
  const listeners = new Set<() => void>();
  const changed = () => {
    listeners.forEach((listener) => listener());
  };

  // The glow is blurry anyway, so it is rendered and blurred at half resolution.
  function build() {
    renderer.getDrawingBufferSize(size);
    width = size.x;
    height = size.y;
    const halfW = Math.max(1, Math.floor(width / 2)),
      halfH = Math.max(1, Math.floor(height / 2));
    release();
    frame = new THREE.FramebufferTexture(width, height);
    history = [0, 1].map(
      () =>
        new THREE.WebGLRenderTarget(halfW, halfH, {
          type: THREE.HalfFloatType,
        }),
    );
    historyValid = false;
    bloomComposer = new EffectComposer(renderer);
    bloomComposer.setPixelRatio(1);
    bloomComposer.setSize(halfW, halfH);
    renderPass = new RenderPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    );
    bloom = new UnrealBloomPass(new THREE.Vector2(halfW, halfH), 1, 0.6, 0.05);
    bloomComposer.addPass(renderPass);
    bloomComposer.addPass(bloom);
    bloomComposer.addPass(new OutputPass());
    finalComposer = new EffectComposer(renderer);
    finalComposer.setPixelRatio(1);
    finalComposer.setSize(width, height);
    addPass = new ShaderPass(
      new THREE.ShaderMaterial({
        ...AddShader,
        uniforms: THREE.UniformsUtils.clone(AddShader.uniforms),
      }),
      "tDiffuse",
    );
    addPass.renderToScreen = true;
    finalComposer.addPass(new TexturePass(frame));
    finalComposer.addPass(addPass);
  }
  function release() {
    frame?.dispose();
    bloomComposer?.dispose();
    finalComposer?.dispose();
    history.forEach((target) => target.dispose());
    frame = null;
    bloomComposer = finalComposer = null;
    history = [];
  }

  function renderEmitters(
    scene: THREE.Scene,
    camera: THREE.Camera,
    only: THREE.Object3D[] | null,
  ) {
    const restore: Array<() => void> = [];
    const allowed = new Set<THREE.Object3D>();
    only?.forEach((root) => root.traverse((node) => allowed.add(node)));
    scene.traverse((object) => {
      if (!object.visible) return;
      const mesh = object as THREE.Mesh;
      if (
        !mesh.isMesh &&
        !(object as THREE.Points).isPoints &&
        !(object as THREE.Line).isLine &&
        !(object as THREE.Sprite).isSprite
      )
        return;
      if (only && allowed.has(object)) return;
      const original = mesh.material;
      const materials = Array.isArray(original) ? original : [original];
      if (
        !only &&
        materials.some((material) => isLightSource(object, material))
      )
        return;
      if (
        only
          ? !mesh.isMesh || materials.every((material) => material.transparent)
          : materials.every((material) => material.transparent)
      ) {
        object.visible = false;
        restore.push(() => {
          object.visible = true;
        });
      } else if (mesh.isMesh) {
        mesh.material = black;
        restore.push(() => {
          mesh.material = original;
        });
      }
    });
    const { background, fog } = scene,
      shadowAuto = renderer.shadowMap.autoUpdate;
    // Blacked-out surfaces need no shadows, so reuse the maps from the main frame.
    scene.background = null;
    scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderPass.scene = scene;
    renderPass.camera = camera;
    bloomComposer!.render(0);
    scene.background = background;
    scene.fog = fog;
    renderer.shadowMap.autoUpdate = shadowAuto;
    for (const undo of restore) undo();
  }

  return {
    get mode(): BloomMode {
      return level > 0 ? style : "off";
    },
    get level() {
      return level;
    },
    setLevel(value: number) {
      level = THREE.MathUtils.clamp(value, 0, 1);
      if (level > 0) lastLevel = level;
      historyValid = false;
      changed();
    },
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Cycles off -> bright -> soft -> off.
    cycle() {
      if (level === 0) {
        level = lastLevel;
        style = "bright";
      } else if (style === "bright") style = "soft";
      else {
        lastLevel = level;
        level = 0;
      }
      historyValid = false;
      changed();
      return level > 0 ? style : "off";
    },
    apply(
      scene: THREE.Scene,
      camera: THREE.Camera,
      pulse = 0,
      only: THREE.Object3D[] = [],
    ) {
      const now = performance.now(),
        dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // With the slider at 0, a scene can still make just its own objects glow.
      const selective = level === 0 && only.length > 0;
      const effective: BloomMode =
        level > 0 ? style : selective ? "bright" : "off";
      if (effective === "off") {
        historyValid = false;
        if (bloomComposer) release();
        return;
      }
      renderer.getDrawingBufferSize(size);
      if (!bloomComposer || size.x !== width || size.y !== height) build();
      const soft = effective === "soft";
      bloom.strength = soft
        ? (mobile ? 0.3 : 0.45) * level
        : (mobile ? 0.9 : 1.4) * (level > 0 ? level : 0.55 + 0.45 * pulse);
      bloom.radius = soft ? 0.8 : 0.6;
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(frame!, position);
      renderEmitters(scene, camera, selective ? only : null);
      let glow = bloomComposer!.readBuffer.texture;
      if (soft) {
        const next = history[historyIndex],
          previous = history[1 - historyIndex];
        blendMaterial.uniforms.tNew.value = glow;
        blendMaterial.uniforms.tOld.value = previous.texture;
        blendMaterial.uniforms.uRate.value = historyValid
          ? 1 - Math.exp(-dt * 7)
          : 1;
        renderer.setRenderTarget(next);
        blendQuad.render(renderer);
        renderer.setRenderTarget(null);
        historyIndex = 1 - historyIndex;
        historyValid = true;
        glow = next.texture;
      } else historyValid = false;
      addPass.uniforms.tBloom.value = glow;
      addPass.uniforms.uMax.value = soft ? 0.35 : 100;
      finalComposer!.render(0);
    },
    dispose() {
      release();
      black.dispose();
      blendMaterial.dispose();
      blendQuad.dispose();
    },
  };
}
