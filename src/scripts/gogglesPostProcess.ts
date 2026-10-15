import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import pixelateVert from '../shaders/ascii/pixelate.vert.glsl?raw';
import pixelateFrag from '../shaders/ascii/pixelate.frag.glsl?raw';

const SCALE = 8;
const CHARS = ['.', ';', 'c', 'o', 'P', '?', '@', '═', '│', '/', '\\'];
export const GOGGLES_READABLE_LAYER = 2;

/** ASCII night vision wraps the existing scene effects and first-person rendering. */
export class GogglesPostProcess {
  private readonly fullResRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  private readonly resolution = new THREE.Vector2();
  private readonly readableTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
  private readonly maskBlack = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false, toneMapped: false });
  private readonly maskWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, depthFunc: THREE.LessEqualDepth, fog: false, toneMapped: false });
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();
  private readonly fontAtlas = this.createFontAtlas();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: pixelateVert,
    fragmentShader: pixelateFrag,
    uniforms: {
      tFullRes: { value: this.fullResRenderTarget.texture },
      tReadable: { value: this.readableTarget.texture },
      uReadable: { value: false },
      tFontAtlas: { value: this.fontAtlas },
      uGridSize: { value: new THREE.Vector2(1, 1) },
      uFullResSize: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 8.0 },
      uAttenuation: { value: 1.0 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly quad = new FullScreenQuad(this.material);
  private active = false;

  constructor(private renderer: THREE.WebGLRenderer) {}

  private createFontAtlas(): THREE.Texture {
    const cellSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = cellSize * CHARS.length;
    canvas.height = cellSize;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${cellSize - 8}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    CHARS.forEach((char, i) => ctx.fillText(char, i * cellSize + cellSize / 2, cellSize / 2));
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    return texture;
  }

  setActive(active: boolean) { this.active = active; }
  isActive() { return this.active; }

  resize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    if (this.fullResRenderTarget.width !== w || this.fullResRenderTarget.height !== h) this.fullResRenderTarget.setSize(w, h);
    if (this.readableTarget.width !== w || this.readableTarget.height !== h) this.readableTarget.setSize(w, h);
    this.material.uniforms.uFullResSize.value.set(w, h);
    const cell = SCALE * this.renderer.getPixelRatio();
    this.material.uniforms.uGridSize.value.set(Math.max(1, Math.floor(w / cell)), Math.max(1, Math.floor(h / cell)));
  }

  render(scene: THREE.Scene, camera: THREE.Camera, draw = () => this.renderer.render(scene, camera)) {
    if (!this.active) { draw(); return; }
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this.resolution);
    this.resize(this.resolution.x, this.resolution.y);
    const target = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear, scissorTest = renderer.getScissorTest(), xr = renderer.xr.enabled;
    renderer.getViewport(this.viewport); renderer.getScissor(this.scissor);
    const background = scene.background, override = scene.overrideMaterial, layers = camera.layers.mask;
    try {
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      renderer.setRenderTarget(this.fullResRenderTarget);
      renderer.clear();
      draw();
      let readable = false;
      scene.traverseVisible(node => { if (node instanceof THREE.Mesh && node.layers.isEnabled(GOGGLES_READABLE_LAYER)) readable = true; });
      this.material.uniforms.uReadable.value = readable;
      if (readable) {
        renderer.setRenderTarget(this.readableTarget);
        scene.background = new THREE.Color(0x000000); scene.overrideMaterial = this.maskBlack;
        renderer.clear(); renderer.render(scene, camera);
        scene.background = null; scene.overrideMaterial = this.maskWhite;
        camera.layers.set(GOGGLES_READABLE_LAYER);
        renderer.autoClear = false;
        renderer.render(scene, camera);
        camera.layers.mask = layers; scene.background = background; scene.overrideMaterial = override;
        renderer.autoClear = true;
      }
      renderer.setRenderTarget(target, cubeFace, mip);
      renderer.setViewport(this.viewport); renderer.setScissor(this.scissor); renderer.setScissorTest(scissorTest);
      renderer.xr.enabled = false;
      this.quad.render(renderer);
    } finally {
      camera.layers.mask = layers; scene.background = background; scene.overrideMaterial = override;
      renderer.setRenderTarget(target, cubeFace, mip);
      renderer.setViewport(this.viewport); renderer.setScissor(this.scissor); renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
      renderer.xr.enabled = xr;
    }
  }

  dispose() {
    this.active = false;
    this.fullResRenderTarget.dispose();
    this.readableTarget.dispose(); this.maskBlack.dispose(); this.maskWhite.dispose();
    this.fontAtlas.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
