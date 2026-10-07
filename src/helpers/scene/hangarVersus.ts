import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export function createHangarVersus({ singleOpponent = false, playerName, opponentName, portraitScale = 1, layout = 'rows' }: {
  singleOpponent?: boolean; playerName?: string; opponentName?: string; portraitScale?: number; layout?: 'rows' | 'columns';
} = {}) {
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
  const names = [playerName, opponentName].flatMap((name, index) => {
    if (!name) return [];
    const label = document.createElement('div'); label.className = `hangar-versus-name${index === 1 ? ' opponent' : ''}`;
    label.textContent = name; frame.appendChild(label); return [label];
  });
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clearColor = new THREE.Color(), size = new THREE.Vector2();
  let captured = false;
  let playerFrame: { center: THREE.Vector3; size: THREE.Vector3 } | null = null;
  let opponentFrame: { center: THREE.Vector3; size: THREE.Vector3 } | null = null;
  const opponentAngle = new THREE.Vector3(-0.18, 0.06, 1).normalize();

  function copyModel(source: THREE.Object3D) {
    const model = clone(source); model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.visible = true;
    model.scale.multiplyScalar(portraitScale);
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
            opacity: original.opacity, alphaTest: original.alphaTest, visible: original.visible });
          materials.set(original, material);
        }
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
    });
    // Recompute cloned skin bounds only after every bone has its final world matrix.
    model.updateMatrixWorld(true);
    model.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) {
        node.skeleton.update(); node.computeBoundingBox(); node.computeBoundingSphere();
      }
    });
    models.push(model); return model;
  }

  return { root: frame,
    capture(player: THREE.Object3D, crowd: readonly THREE.Object3D[]) {
      if (captured) return;
      if (singleOpponent && crowd.length !== 1) throw new Error('A single-opponent versus screen requires exactly one opponent.');
      const portrait = copyModel(player); panels[0].add(portrait); portrait.rotation.y = -0.14; portrait.updateMatrixWorld(true);
      const head = portrait.getObjectByName('head') ?? portrait.getObjectByName('Head');
      const focus = head?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.65, 0);
      focus.y += 0.08;
      if (portraitScale !== 1) playerFrame = { center: focus.clone().add(new THREE.Vector3(0, -0.2, 0)), size: new THREE.Vector3(1.05, 1.3, 0.6) };
      cameras[0].position.copy(focus).add(new THREE.Vector3(0.35, 0.08, 1.65)); cameras[0].lookAt(focus);
      if (singleOpponent) {
        const robot = copyModel(crowd[0]); panels[1].add(robot); robot.rotation.y = 0.14; robot.updateMatrixWorld(true);
        robot.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.update(); });
        const bounds = new THREE.Box3(), meshBounds = new THREE.Box3();
        robot.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          for (let ancestor: THREE.Object3D | null = node; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
          const surfaces = Array.isArray(node.material) ? node.material : [node.material];
          if (surfaces.some(surface => surface.visible && surface.opacity > 0)) bounds.union(meshBounds.setFromObject(node));
        });
        if (bounds.isEmpty()) throw new Error('The versus opponent has no visible model to frame.');
        opponentFrame = { center: bounds.getCenter(new THREE.Vector3()), size: bounds.getSize(new THREE.Vector3()) };
        if (portraitScale !== 1) {
          const head = robot.getObjectByName('Head') ?? robot.getObjectByName('head');
          if (!head) throw new Error('A mech versus portrait needs a head bone.');
          opponentFrame = { center: head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.2, 0)), size: new THREE.Vector3(1.05, 1.3, 0.6) };
        }
      } else {
        crowd.slice(0, 18).forEach((source, index) => {
          const robot = copyModel(source); robot.position.set((index % 6 - 2.5) * 2.15, 0, -Math.floor(index / 6) * 2.15); panels[1].add(robot);
        });
        cameras[1].position.set(0.8, 2.6, 10.5); cameras[1].lookAt(0, 0.6, -1.5);
      }
      captured = true;
    },
    update(time: number) {
      frame.classList.remove('hidden'); document.body.classList.add('hangar-versus-active');
      const entry = THREE.MathUtils.smootherstep(time, 0.25, 0.85);
      const punch = Math.sin(THREE.MathUtils.clamp((time - 0.75) / 0.35, 0, 1) * Math.PI) * 0.18;
      badge.style.transform = `translate(-50%, -50%) translate(${(1 - entry) * -window.innerWidth * 0.8}px, ${(1 - entry) * -90}px) rotate(${-18 + entry * 8}deg) scale(${0.3 + entry * 0.7 + punch})`;
      names.forEach((label, index) => {
        label.style.opacity = String(entry);
        label.style.transform = `translateX(${(1 - entry) * (index === 0 ? -36 : 36)}px) rotate(-3deg)`;
      });
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
        const half = Math.floor((layout === 'columns' ? size.x : size.y) / 2);
        panels.forEach((panel, index) => {
          const width = layout === 'columns' ? (index === 0 ? half : size.x - half) : size.x;
          const height = layout === 'columns' ? size.y : index === 0 ? size.y - half : half;
          const left = layout === 'columns' && index === 1 ? half : 0;
          const bottom = layout === 'rows' && index === 0 ? half : 0;
          cameras[index].aspect = width / Math.max(1, height); cameras[index].updateProjectionMatrix();
          const framing = index === 0 ? playerFrame : opponentFrame;
          if (framing) {
            const tangent = Math.tan(THREE.MathUtils.degToRad(cameras[index].fov / 2));
            const distance = Math.max(framing.size.y, framing.size.x / cameras[index].aspect) / (2 * tangent) * 1.15 + framing.size.z / 2;
            cameras[index].position.copy(framing.center).addScaledVector(index === 0 ? new THREE.Vector3(0.18, 0.06, 1).normalize() : opponentAngle, distance);
            cameras[index].lookAt(framing.center);
          }
          renderer.setViewport(left, bottom, width, height); renderer.setScissor(left, bottom, width, height);
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