import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export function createHangarVersus() {
  const panels = [new THREE.Scene(), new THREE.Scene()];
  const cameras = [new THREE.PerspectiveCamera(38, 1, 0.02, 80), new THREE.PerspectiveCamera(48, 1, 0.02, 80)];
  const materials = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const models: THREE.Object3D[] = [];
  const ramp = new THREE.DataTexture(new Uint8Array([75, 145, 205, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
  const backgroundGeometry = new THREE.PlaneGeometry(2, 2);
  const backgrounds = panels.map((panel, index) => {
    panel.add(new THREE.AmbientLight(0xffffff, 1.25));
    const light = new THREE.DirectionalLight(0xffffff, 3.2); light.position.set(4, 6, 8); panel.add(light);
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(index === 0 ? 0x087bdd : 0xdd2635) },
        uCenter: { value: new THREE.Vector2(0.5, index === 0 ? 0.5 : -0.2) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec2 uCenter;
        varying vec2 vUv;
        void main() {
          vec2 delta = vUv - uCenter;
          float angle = atan(delta.y, delta.x);
          float ray = fract(angle * 24.0 + sin(floor(angle * 24.0)) * 0.17);
          float streak = (1.0 - smoothstep(0.015, 0.07, ray)) * smoothstep(0.12, 0.55, length(delta));
          float pulse = 0.75 + 0.25 * sin(length(delta) * 45.0 - uTime * 18.0);
          vec3 color = mix(uColor, vec3(0.84, 0.94, 1.0), streak * pulse * 0.85);
          float ink = step(0.9, fract(angle * 11.0 + 0.4)) * smoothstep(0.3, 0.8, length(delta));
          gl_FragColor = vec4(mix(color, color * 0.18, ink * 0.7), 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const background = new THREE.Mesh(backgroundGeometry, material); background.frustumCulled = false; background.renderOrder = -100;
    panel.add(background); return material;
  });
  const frame = document.createElement('div'); frame.className = 'hangar-versus hidden'; frame.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('div'); badge.className = 'hangar-versus-badge'; badge.textContent = 'VS'; frame.appendChild(badge); document.body.appendChild(frame);
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clearColor = new THREE.Color(), size = new THREE.Vector2();
  let captured = false;

  function copyModel(source: THREE.Object3D) {
    const model = clone(source); model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.visible = true;
    model.traverse(node => {
      node.layers.set(0);
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = node.receiveShadow = false;
      const convert = (original: THREE.Material) => {
        let material = materials.get(original);
        if (!material) {
          const surface = original as THREE.MeshStandardMaterial;
          material = new THREE.MeshToonMaterial({ color: surface.color?.clone() ?? new THREE.Color(0xffffff),
            map: surface.map ?? null, gradientMap: ramp, side: original.side, transparent: original.transparent,
            opacity: original.opacity, alphaTest: original.alphaTest });
          materials.set(original, material);
        }
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
    });
    models.push(model); return model;
  }

  return {
    capture(player: THREE.Object3D, crowd: readonly THREE.Object3D[]) {
      if (captured) return;
      const portrait = copyModel(player); panels[0].add(portrait); portrait.rotation.y = -0.14; portrait.updateMatrixWorld(true);
      const head = portrait.getObjectByName('head');
      const focus = head?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.65, 0);
      focus.y += 0.08;
      cameras[0].position.copy(focus).add(new THREE.Vector3(0.35, 0.08, 1.65)); cameras[0].lookAt(focus);
      crowd.slice(0, 18).forEach((source, index) => {
        const robot = copyModel(source); robot.position.set((index % 6 - 2.5) * 2.15, 0, -Math.floor(index / 6) * 2.15); panels[1].add(robot);
      });
      cameras[1].position.set(0.8, 2.6, 10.5); cameras[1].lookAt(0, 0.6, -1.5); captured = true;
    },
    update(time: number) {
      frame.classList.remove('hidden'); document.body.classList.add('hangar-versus-active');
      const entry = THREE.MathUtils.smootherstep(time, 0.25, 0.85);
      const punch = Math.sin(THREE.MathUtils.clamp((time - 0.75) / 0.35, 0, 1) * Math.PI) * 0.18;
      badge.style.transform = `translate(-50%, -50%) translate(${(1 - entry) * -window.innerWidth * 0.8}px, ${(1 - entry) * -90}px) rotate(${-18 + entry * 8}deg) scale(${0.3 + entry * 0.7 + punch})`;
      backgrounds.forEach(material => { material.uniforms.uTime.value = time; });
    },
    hide() { frame.classList.add('hidden'); document.body.classList.remove('hangar-versus-active'); },
    render(renderer: THREE.WebGLRenderer) {
      if (!captured) return;
      renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getClearColor(clearColor); renderer.getSize(size);
      const oldScissor = renderer.getScissorTest(), oldAutoClear = renderer.autoClear, oldAlpha = renderer.getClearAlpha();
      const oldShadowUpdate = renderer.shadowMap.autoUpdate;
      try {
        renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; renderer.setScissorTest(true);
        const half = Math.floor(size.y / 2);
        panels.forEach((panel, index) => {
          const height = index === 0 ? size.y - half : half, bottom = index === 0 ? half : 0;
          cameras[index].aspect = size.x / Math.max(1, height); cameras[index].updateProjectionMatrix();
          renderer.setViewport(0, bottom, size.x, height); renderer.setScissor(0, bottom, size.x, height);
          renderer.setClearColor(index === 0 ? 0x087bdd : 0xdd2635, 1); renderer.clear(true, true, false); renderer.render(panel, cameras[index]);
        });
      } finally {
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(oldScissor);
        renderer.setClearColor(clearColor, oldAlpha); renderer.autoClear = oldAutoClear; renderer.shadowMap.autoUpdate = oldShadowUpdate;
      }
    },
    dispose() {
      frame.remove(); document.body.classList.remove('hangar-versus-active');
      models.forEach(model => { model.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); }); model.removeFromParent(); });
      materials.forEach(material => material.dispose()); backgrounds.forEach(material => material.dispose()); backgroundGeometry.dispose(); ramp.dispose();
    },
  };
}