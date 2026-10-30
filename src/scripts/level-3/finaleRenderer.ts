import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { prepareSceneRendering } from "../../core/renderer.js";

export function createFinaleRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  mobile: boolean,
) {
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.7;
  const size = renderer.getSize(new THREE.Vector2()),
    composer = new EffectComposer(renderer);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(size, mobile ? 0.45 : 0.68, 0.48, 1.35);
  const output = new OutputPass();
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(output);
  const impactPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uInvert: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uInvert; varying vec2 vUv;
      void main() {
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float ink = smoothstep(0.3, 0.38, luminance);
        gl_FragColor = vec4(vec3(mix(ink, 1.0 - ink, uInvert)), 1.0);
      }`,
  });
  impactPass.enabled = false;
  composer.addPass(impactPass);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let impactTime = 0, impactDuration = 0, impactCooldown = 0;
  let width = size.x,
    height = size.y,
    disposed = false;
  return {
    impact(strong = false) {
      if (reducedMotion.matches || impactCooldown > 0) return;
      impactTime = impactDuration = strong ? 0.12 : 0.075;
      impactCooldown = 0.4;
    },
    update(dt: number) {
      impactTime = Math.max(0, impactTime - dt);
      impactCooldown = Math.max(0, impactCooldown - dt);
    },
    render() {
      if (disposed) return;
      renderer.getSize(size);
      if (size.x !== width || size.y !== height) {
        width = size.x;
        height = size.y;
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(width, height);
      }
      impactPass.enabled = impactTime > 0 && !reducedMotion.matches;
      impactPass.uniforms.uInvert.value = Number(impactTime > impactDuration * 0.6);
      composer.render(0);
    },
    async prepare() {
      await prepareSceneRendering(renderer, scene, camera, {
        fogVariants: false,
      });
      composer.render(0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.environment = null;
      environment.dispose();
      render.dispose();
      bloom.dispose();
      output.dispose();
      impactPass.dispose();
      composer.dispose();
    },
  };
}
