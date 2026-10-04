import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export const FLIGHT_VERSUS_DURATION = 4.6;

export function createFlightVersus({ shuttle, carrier, createInterceptor, onSkip }: {
  shuttle: THREE.Object3D;
  carrier: THREE.Object3D;
  createInterceptor: () => THREE.Object3D;
  onSkip: () => void;
}) {
  const panels = [new THREE.Scene(), new THREE.Scene()];
  const cameras = panels.map(() => new THREE.PerspectiveCamera(38, 1, 0.05, 250));
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.Material>();
  const ownedGeometry = new Set<THREE.BufferGeometry>(), ownedMaterials = new Set<THREE.Material>();
  const skeletons: THREE.Skeleton[] = [];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  let active = true, disposed = false, elapsed = 0;

  function copyModel(source: THREE.Object3D) {
    const model = clone(source); model.position.set(0, 0, 0); model.quaternion.identity(); model.visible = true;
    model.traverse(node => {
      node.layers.set(0);
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = node.receiveShadow = false;
      const original: THREE.BufferGeometry = node.geometry;
      let geometry = geometries.get(original);
      if (!geometry) { geometry = original.clone(); geometries.set(original, geometry); ownedGeometry.add(geometry); }
      node.geometry = geometry;
      const copy = (source: THREE.Material) => {
        let material = materials.get(source);
        if (!material) { material = source.clone(); materials.set(source, material); ownedMaterials.add(material); }
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      if (node instanceof THREE.SkinnedMesh) { skeletons.push(node.skeleton); node.computeBoundingBox(); node.computeBoundingSphere(); }
    });
    return model;
  }
  function frameModel(model: THREE.Object3D, span: number, name: string) {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3(), meshBounds = new THREE.Box3();
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node.userData.shotHitProxy) return;
      for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) if (!parent.visible) return;
      const surfaces = Array.isArray(node.material) ? node.material : [node.material];
      if (surfaces.some(material => material.visible && material.opacity > 0)) bounds.union(meshBounds.setFromObject(node));
    });
    if (bounds.isEmpty()) throw new Error(`Flight versus screen cannot frame ${name}: no visible hull`);
    const size = bounds.getSize(new THREE.Vector3());
    const center = new THREE.Group(); center.add(model); center.position.copy(bounds.getCenter(new THREE.Vector3())).negate();
    const root = new THREE.Group(); root.name = name; root.add(center); root.scale.setScalar(span / Math.max(size.x, size.y, size.z));
    return root;
  }

  const heroes = panels.map(panel => {
    const group = new THREE.Group(); panel.add(group);
    panel.add(new THREE.HemisphereLight(0xd9edff, 0x121020, 2.4));
    const key = new THREE.DirectionalLight(0xfff0db, 4); key.position.set(-5, 8, -9); panel.add(key);
    const rim = new THREE.DirectionalLight(panel === panels[0] ? 0x32cbff : 0xff4466, 5); rim.position.set(6, 3, 5); panel.add(rim);
    return group;
  });
  const playerPortrait = frameModel(copyModel(shuttle), 9, 'VersusEscapeShuttle'); heroes[0].add(playerPortrait);
  playerPortrait.rotation.set(-0.08, -0.55, -0.1);
  const bossPortrait = frameModel(copyModel(carrier), 10.5, 'VersusCapitalShip'); heroes[1].add(bossPortrait);
  bossPortrait.position.set(0, 1.35, -2.2); bossPortrait.rotation.set(-0.08, 0.22, 0.025);
  const interceptors = Array.from({ length: 6 }, (_, index) => {
    const source = createInterceptor();
    source.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      ownedGeometry.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => ownedMaterials.add(material));
      node.castShadow = node.receiveShadow = false;
    });
    const root = frameModel(source, 2.35, `VersusInterceptor-${index + 1}`);
    const side = index % 2 === 0 ? -1 : 1, rank = Math.floor(index / 2);
    const position = new THREE.Vector3(side * (2.3 + rank * 1.35), -0.9 - rank * 0.65, 1.6 + rank * 0.9);
    root.position.copy(position); root.rotation.z = -side * 0.16; heroes[1].add(root);
    return { root, position, side, rank };
  });
  const bounds = heroes.map(group => {
    group.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
  });

  const backgroundGeometry = new THREE.PlaneGeometry(2, 2); ownedGeometry.add(backgroundGeometry);
  const backgrounds = panels.map((panel, index) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uTint: { value: new THREE.Color(index === 0 ? 0x159be8 : 0xeb284c) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `
        uniform float uTime;
        uniform float uAspect;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          float radius = length(p);
          float angle = atan(p.y, p.x);
          float streak = pow(max(0.0, sin(angle * 47.0 + sin(angle * 13.0))), 28.0);
          streak *= smoothstep(0.18, 0.85, radius) * (0.4 + 0.3 * sin(radius * 48.0 - uTime * 8.0));
          float star = pow(max(0.0, sin(vUv.x * 319.0) * sin(vUv.y * 227.0)), 36.0);
          float halo = exp(-radius * 2.5);
          float grid = step(0.975, fract((p.x + p.y * 0.6) * 22.0 - uTime * 0.2));
          vec3 color = uTint * (0.055 + halo * 0.2 + streak * 0.4 + grid * 0.04);
          color += vec3(0.68, 0.83, 1.0) * star * 0.6;
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    ownedMaterials.add(material);
    const mesh = new THREE.Mesh(backgroundGeometry, material); mesh.frustumCulled = false; mesh.renderOrder = -100;
    panel.add(mesh); return material;
  });

  const frame = document.createElement('section'); frame.className = 'flight-versus'; frame.setAttribute('aria-label', 'Escape shuttle versus capital ship and interceptor wing');
  const title = document.createElement('div'); title.className = 'flight-versus-title'; title.textContent = 'LEVEL 02 / INTERCEPTION';
  const badge = document.createElement('div'); badge.className = 'hangar-versus-badge flight-versus-badge'; badge.textContent = 'VS';
  const labels = [
    ['BRONDON', 'ESCAPE SHUTTLE', 'ONE PILOT. NO BACKUP.'],
    ['THE BLOCKADE', 'CAPITAL SHIP + INTERCEPTOR WING', '30 INTERCEPTORS / ONE CAPITAL SHIP'],
  ].map(([name, craft, detail], index) => {
    const label = document.createElement('div'); label.className = `flight-versus-label${index === 1 ? ' enemy' : ''}`;
    const pilot = document.createElement('strong'); pilot.textContent = name;
    const ship = document.createElement('span'); ship.textContent = craft;
    const description = document.createElement('small'); description.textContent = detail;
    label.append(pilot, ship, description); return label;
  });
  const mission = document.createElement('div'); mission.className = 'flight-versus-mission'; mission.textContent = 'BREAK THE BLOCKADE';
  const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'flight-versus-skip'; skip.textContent = 'Enter / Skip intro'; skip.setAttribute('aria-keyshortcuts', 'Enter');
  skip.addEventListener('click', onSkip);
  frame.append(title, badge, ...labels, mission, skip); document.body.appendChild(frame); document.body.classList.add('flight-versus-active');

  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clearColor = new THREE.Color(), size = new THREE.Vector2();
  function update(time: number) {
    elapsed = time;
    const entry = reducedMotion ? 1 : THREE.MathUtils.smootherstep(time, 0.18, 0.8);
    const punch = reducedMotion ? 0 : Math.sin(THREE.MathUtils.clamp((time - 0.75) / 0.3, 0, 1) * Math.PI) * 0.22;
    badge.style.transform = `translate(-50%, -50%) rotate(${-12 + entry * 4}deg) scale(${0.4 + entry * 0.6 + punch})`;
    badge.style.opacity = String(entry);
    labels.forEach((label, index) => {
      label.style.opacity = String(entry);
      label.style.transform = `translateX(${(1 - entry) * (index === 0 ? -60 : 60)}px) rotate(${index === 0 ? -2 : 2}deg)`;
    });
    mission.style.opacity = String(reducedMotion ? 1 : THREE.MathUtils.smootherstep(time, 2.9, 3.45));
    playerPortrait.rotation.y = -0.55 + (reducedMotion ? 0 : Math.sin(time * 0.9) * 0.08);
    playerPortrait.position.y = reducedMotion ? 0 : Math.sin(time * 1.4) * 0.07;
    bossPortrait.rotation.y = 0.22 - (reducedMotion ? 0 : THREE.MathUtils.smootherstep(time, 1.2, 3.8) * 0.13);
    interceptors.forEach(({ root, position, side, rank }, index) => {
      const arrival = reducedMotion ? 1 : THREE.MathUtils.smootherstep(time, 0.3 + rank * 0.12, 1.25 + rank * 0.12);
      root.position.copy(position).add(new THREE.Vector3(side * (1 - arrival) * 5, (1 - arrival) * 1.5, -(1 - arrival) * 7));
      root.rotation.z = -side * 0.16 + (reducedMotion ? 0 : Math.sin(time * 1.8 + index) * 0.025);
    });
    backgrounds.forEach(material => { material.uniforms.uTime.value = reducedMotion ? 0 : time; });
  }
  update(0);
  return {
    update,
    setPaused(value: boolean) { skip.disabled = value; frame.classList.toggle('paused', value); },
    hide() { active = false; frame.classList.add('hidden'); frame.setAttribute('aria-hidden', 'true'); document.body.classList.remove('flight-versus-active'); },
    render(renderer: THREE.WebGLRenderer) {
      if (!active || disposed) return;
      renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getClearColor(clearColor); renderer.getSize(size);
      const oldScissor = renderer.getScissorTest(), oldAutoClear = renderer.autoClear, oldAlpha = renderer.getClearAlpha(), oldShadowUpdate = renderer.shadowMap.autoUpdate;
      try {
        renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; renderer.setScissorTest(true);
        const wide = size.x > size.y * 1.1;
        panels.forEach((panel, index) => {
          const split = Math.floor((wide ? size.x : size.y) / 2);
          const width = wide ? (index === 0 ? split : size.x - split) : size.x;
          const height = wide ? size.y : index === 0 ? size.y - split : split;
          const left = wide && index === 1 ? split : 0, bottom = !wide && index === 0 ? split : 0;
          const camera = cameras[index]; camera.aspect = width / Math.max(1, height);
          const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
          const fit = bounds[index].radius / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, camera.aspect))) * 1.12;
          const dolly = reducedMotion ? 1 : THREE.MathUtils.lerp(1.09, 1, THREE.MathUtils.smootherstep(elapsed, 0, 3.8));
          const angle = new THREE.Vector3(index === 0 ? 0.15 : -0.05, index === 0 ? 0.26 : 0.18, -1).normalize();
          camera.position.copy(bounds[index].center).addScaledVector(angle, fit * dolly); camera.lookAt(bounds[index].center); camera.updateProjectionMatrix();
          backgrounds[index].uniforms.uAspect.value = camera.aspect;
          renderer.setViewport(left, bottom, width, height); renderer.setScissor(left, bottom, width, height);
          renderer.setClearColor(0x02050b, 1); renderer.clear(true, true, false); renderer.render(panel, camera);
        });
      } finally {
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(oldScissor);
        renderer.setClearColor(clearColor, oldAlpha); renderer.autoClear = oldAutoClear; renderer.shadowMap.autoUpdate = oldShadowUpdate;
      }
    },
    dispose() {
      if (disposed) return; disposed = true; active = false;
      skip.removeEventListener('click', onSkip); frame.remove(); document.body.classList.remove('flight-versus-active');
      skeletons.forEach(skeleton => skeleton.dispose());
      ownedGeometry.forEach(geometry => geometry.dispose()); ownedMaterials.forEach(material => material.dispose());
      panels.forEach(panel => panel.clear());
    },
  };
}
