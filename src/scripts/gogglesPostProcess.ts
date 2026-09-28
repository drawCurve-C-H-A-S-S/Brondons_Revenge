import * as THREE from 'three';
import pixelateVert from '../shaders/ascii/pixelate.vert.glsl?raw';
import pixelateFrag from '../shaders/ascii/pixelate.frag.glsl?raw';

const SCALE = 8;
const CHARS = ['.', ';', 'c', 'o', 'P', '?', '@', '═', '│', '/', '\\'];

export class GogglesPostProcess {
  private fullResRenderTarget: THREE.WebGLRenderTarget;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private material: THREE.ShaderMaterial;
  private active = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    this.fullResRenderTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    const gw = Math.max(1, Math.floor(w / SCALE));
    const gh = Math.max(1, Math.floor(h / SCALE));

    const fontAtlas = this.createFontAtlas();

    this.material = new THREE.ShaderMaterial({
      vertexShader: pixelateVert,
      fragmentShader: pixelateFrag,
      uniforms: {
        tFullRes: { value: this.fullResRenderTarget.texture },
        tFontAtlas: { value: fontAtlas },
        uGridSize: { value: new THREE.Vector2(gw, gh) },
        uFullResSize: { value: new THREE.Vector2(w, h) },
        uExposure: { value: 8.0 },
        uAttenuation: { value: 1.0 },
      },
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  private createFontAtlas(): THREE.Texture {
    const cellSize = 64;
    const cols = CHARS.length;
    const canvas = document.createElement('canvas');
    canvas.width = cellSize * cols;
    canvas.height = cellSize;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${cellSize - 8}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let i = 0; i < cols; i++) {
      ctx.fillText(CHARS[i], i * cellSize + cellSize / 2, cellSize / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.flipY = true;
    return texture;
  }

  setActive(active: boolean) { this.active = active; }
  isActive() { return this.active; }

  begin() {
    if (!this.active) {
      this.renderer.setRenderTarget(null);
      return;
    }
    this.renderer.setRenderTarget(this.fullResRenderTarget);
    this.renderer.clear();
  }

  end() {
    if (!this.active) return;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.active) {
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.fullResRenderTarget);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  resize(w: number, h: number) {
    this.fullResRenderTarget.setSize(w, h);
    this.material.uniforms.uFullResSize.value.set(w, h);
    
    const gw = Math.max(1, Math.floor(w / SCALE));
    const gh = Math.max(1, Math.floor(h / SCALE));
    this.material.uniforms.uGridSize.value.set(gw, gh);
  }
}
