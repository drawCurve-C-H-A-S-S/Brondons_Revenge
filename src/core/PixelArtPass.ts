import * as THREE from 'three';
import vertexShader from '../shaders/pixelArt.vert.glsl?raw';
import fragmentShader from '../shaders/pixelArt.frag.glsl?raw';

export class PixelArtPass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  private readonly resolution = new THREE.Vector2(1, 1);
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: this.target.texture },
      uResolution: { value: this.resolution },
      uPixelSize: { value: 8 },
      uStrength: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly geometry = new THREE.PlaneGeometry(2, 2);

  constructor() {
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.camera.position.z = 1;
  }

  precompile(renderer: THREE.WebGLRenderer) {
    renderer.compile(this.scene, this.camera);
  }

  render(
    renderer: THREE.WebGLRenderer,
    draw: (scene: THREE.Scene, camera: THREE.Camera) => void,
    scene: THREE.Scene,
    camera: THREE.Camera,
    strength: number,
  ) {
    renderer.getDrawingBufferSize(this.resolution);
    const width = Math.max(1, Math.floor(this.resolution.x));
    const height = Math.max(1, Math.floor(this.resolution.y));
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    try {
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      renderer.setRenderTarget(this.target);
      draw(scene, camera);

      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(false);
      this.material.uniforms.uPixelSize.value = 2 * renderer.getPixelRatio();
      this.material.uniforms.uStrength.value = THREE.MathUtils.clamp(strength, 0, 1) * 0.82;
      draw(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.autoClear = previousAutoClear;
    }
  }

  dispose() {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}