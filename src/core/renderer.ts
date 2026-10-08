import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Creates and configures the WebGL renderer.
 */
export function createRenderer(canvas: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: canvas as HTMLCanvasElement,
  });

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  return renderer;
}

type MapPosition = { x: number; y: number; z: number };
interface MinimapEnemy {
  id: string;
  position: MapPosition;
  yaw?: number;
  alerted?: boolean;
  range?: number;
  kind?: 'patrol' | 'sensor';
}
export interface MinimapSettings {
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  radius?: number;
  floor?: number;
  upperFloor?: number;
  stairs?: Array<{ x: number; z: number }>;
  openSky?: boolean;
  deckLabel?: string;
  deck?: 'upper' | 'lower';
  enemies?: readonly MinimapEnemy[];
  expanded?: boolean;
  route?: readonly { x: number; z: number }[];
  goal?: { x: number; z: number; label: string };
  safePads?: readonly { x: number; z: number }[];
  prepare?: (focus: MapPosition, radius: number) => (() => void);
}

/** A second camera on the live world; no cloned scene or second renderer. */
export function createSceneMinimap(renderer: THREE.WebGLRenderer, element: HTMLElement) {
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 20000);
  camera.up.set(0, 0, -1);
  const target = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: true });
  target.texture.name = 'LiveSceneMinimap';
  const floorUniform = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  material.onBeforeCompile = shader => {
    shader.uniforms.mapFloor = floorUniform;
    shader.vertexShader = 'varying vec3 mapWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vec4 mapPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        mapPosition = batchingMatrix * mapPosition;
      #endif
      #ifdef USE_INSTANCING
        mapPosition = instanceMatrix * mapPosition;
      #endif
      mapWorld = (modelMatrix * mapPosition).xyz;
    `);
    shader.fragmentShader = 'varying vec3 mapWorld;\nuniform float mapFloor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float height = mapWorld.y - mapFloor;
      float relief = clamp(sqrt(max(0.0, height) * 0.5), 0.0, 1.0);
      vec3 ink = mix(vec3(0.055, 0.13, 0.17), vec3(0.42, 0.76, 0.72), relief);
      vec2 grid = abs(fract(mapWorld.xz * 0.2 - 0.5) - 0.5);
      float line = 1.0 - smoothstep(0.008, 0.025, min(grid.x, grid.y));
      ink += line * 0.025;
      if (height < -0.3) ink = vec3(0.045, 0.075, 0.10);
      diffuseColor.rgb = ink;
    `);
  };
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: target.texture }, expanded: { value: false } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform bool expanded; varying vec2 vUv;
      void main() {
        float radius = length(vUv - 0.5);
        if (!expanded && radius > 0.5) discard;
        vec3 color = texture2D(map, vUv).rgb;
        if (!expanded) color *= 1.0 - smoothstep(0.30, 0.5, radius) * 0.32;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(compositeMaterial);
  const gameTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  gameTarget.texture.name = 'VentGameplayInset';
  const gameMaterial = new THREE.MeshBasicMaterial({ map: gameTarget.texture, depthTest: false, depthWrite: false, toneMapped: false });
  const gameQuad = new FullScreenQuad(gameMaterial);
  const gameInset = document.createElement('aside'); gameInset.className = 'minimap-game-inset hidden';
  const gameView = document.createElement('div'); gameView.className = 'minimap-game-view';
  gameInset.append(gameView); document.body.append(gameInset);
  const arrow = document.getElementById('minimap-player')!;
  const deck = document.getElementById('minimap-deck')!;
  const stairMarkers = [document.getElementById('minimap-stair-left')!, document.getElementById('minimap-stair-right')!];
  const enemyMarkers = new Map<string, HTMLElement>();
  const padMarkers: HTMLElement[] = [];
  const routeGuide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  routeGuide.classList.add('minimap-route-guide', 'hidden'); routeGuide.setAttribute('viewBox', '0 0 100 100');
  routeGuide.setAttribute('preserveAspectRatio', 'none'); routeGuide.setAttribute('aria-hidden', 'true');
  const routePath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); routeGuide.append(routePath);
  const goalMarker = document.createElement('span'); goalMarker.className = 'minimap-goal hidden';
  goalMarker.setAttribute('aria-hidden', 'true'); element.append(routeGuide, goalMarker);
  const box = new THREE.Box3(), layout = new THREE.Box3(), size = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), clearColor = new THREE.Color();
  const hidden: THREE.Object3D[] = [];
  const callbacks: Array<[THREE.Object3D, THREE.Object3D['onBeforeRender'], THREE.Object3D['onAfterRender']]> = [];
  const noRenderHook = () => {};
  const instanceVersions = new WeakMap<THREE.InstancedMesh, number>();
  let previousScene: THREE.Scene | null = null, lastRender = -Infinity, upperDeck = false;
  let fitted = false, centerX = 0, centerZ = 0, radius = 20;
  let previousFit = '', expanded = false;
  let rect = element.getBoundingClientRect();
  const resize = () => { rect = element.getBoundingClientRect(); lastRender = -Infinity; };
  const observer = new ResizeObserver(resize); observer.observe(element);
  window.addEventListener('resize', resize);

  function hide() { element.classList.add('hidden'); gameInset.classList.add('hidden'); }
  function reset() {
    hide(); previousScene = null; fitted = false; lastRender = -Infinity; upperDeck = false;
    previousFit = ''; routeGuide.classList.add('hidden'); goalMarker.classList.add('hidden');
    hidden.length = 0; callbacks.length = 0;
    for (const marker of enemyMarkers.values()) marker.remove();
    enemyMarkers.clear();
    padMarkers.splice(0).forEach(marker => marker.remove());
  }
  function meshBounds(mesh: THREE.Mesh) {
    if (mesh instanceof THREE.InstancedMesh) {
      if (!mesh.boundingBox || instanceVersions.get(mesh) !== mesh.instanceMatrix.version) {
        mesh.computeBoundingBox(); instanceVersions.set(mesh, mesh.instanceMatrix.version);
      }
      return box.copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld);
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  }
  function placeMarker(marker: HTMLElement, x: number, z: number) {
    projected.set(x, floorUniform.value, z).project(camera);
    marker.style.left = `${(projected.x + 1) * 50}%`;
    marker.style.top = `${(1 - projected.y) * 50}%`;
  }
  function render(scene: THREE.Scene, position: MapPosition, yaw: number,
    character: THREE.Object3D | null, settings: MinimapSettings = {}) {
    if (scene !== previousScene) { reset(); previousScene = scene; }
    if (element.classList.contains('hidden')) { element.classList.remove('hidden'); resize(); }
    const feet = position.y - 0.3;
    const wasUpper = upperDeck;
    if (settings.upperFloor !== undefined) {
      // Hysteresis keeps the deck stable on stair treads and during small hops.
      if (feet > settings.upperFloor - 0.55) upperDeck = true;
      else if (feet < settings.upperFloor - 1.3) upperDeck = false;
    } else upperDeck = false;
    const floor = upperDeck ? settings.upperFloor! : settings.floor ?? (settings.radius ? feet : Math.min(0, feet));
    floorUniform.value = floor;
    if (expanded !== !!settings.expanded) {
      expanded = !!settings.expanded; element.classList.toggle('minimap-expanded', expanded); resize();
    }
    compositeMaterial.uniforms.expanded.value = expanded;
    gameInset.classList.toggle('hidden', !expanded);
    const b = settings.bounds;
    const fit = [expanded, settings.radius ?? '', Math.round(floor * 10) / 10,
      b?.minX ?? '', b?.maxX ?? '', b?.minZ ?? '', b?.maxZ ?? ''].join(',');
    if (fit !== previousFit) { previousFit = fit; fitted = false; lastRender = -Infinity; }
    const scale = expanded ? Math.min(renderer.getPixelRatio(), 1536 / Math.max(1, rect.width, rect.height)) : 1;
    const width = expanded ? Math.max(256, Math.round(rect.width * scale)) : 256;
    const height = expanded ? Math.max(256, Math.round(rect.height * scale)) : 256;
    if (target.width !== width || target.height !== height) { target.setSize(width, height); lastRender = -Infinity; }
    deck.textContent = settings.deckLabel ?? (settings.upperFloor === undefined ? '' : `DECK ${upperDeck ? '02' : '01'}`);
    element.dataset.deck = settings.deck ?? (upperDeck ? 'upper' : 'lower');
    const now = performance.now();
    if (now - lastRender >= (expanded ? 1000 / 30 : 100) || wasUpper !== upperDeck) {
      lastRender = now;
      const oldTarget = renderer.getRenderTarget();
      const oldCubeFace = renderer.getActiveCubeFace(), oldMip = renderer.getActiveMipmapLevel();
      renderer.getViewport(viewport); renderer.getScissor(scissor); renderer.getClearColor(clearColor);
      const oldScissor = renderer.getScissorTest(), oldAlpha = renderer.getClearAlpha();
      const oldAutoClear = renderer.autoClear, oldShadows = renderer.shadowMap.autoUpdate;
      const oldShadowUpdate = renderer.shadowMap.needsUpdate, oldXr = renderer.xr.enabled;
      const oldOverride = scene.overrideMaterial, oldBackground = scene.background, oldFog = scene.fog;
      hidden.length = 0; callbacks.length = 0; layout.makeEmpty();
      let restoreVisibility: (() => void) | undefined;
      try {
        restoreVisibility = settings.prepare?.(position, settings.radius ?? radius);
        scene.updateMatrixWorld(true);
        if (character?.visible) { hidden.push(character); character.visible = false; }
        scene.traverseVisible(object => {
          // Reflectors and other render hooks must not launch recursive map passes.
          callbacks.push([object, object.onBeforeRender, object.onAfterRender]);
          object.onBeforeRender = noRenderHook; object.onAfterRender = noRenderHook;
          if (object instanceof THREE.Points || object instanceof THREE.Sprite || object instanceof THREE.Line) {
            hidden.push(object); object.visible = false; return;
          }
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const bounds = meshBounds(object);
          const ceiling = floor + 3.8;
          bounds.getSize(size);
          const backdrop = size.x > 2000 && size.y > 2000 && size.z > 2000;
          const canopy = /^(JungleCanopy|JungleBranches|HangingVines)(\/|$)/.test(object.name);
          const decorative = backdrop || canopy || object.userData.minimap === false || materials.every(m => !m.visible || (m.transparent && (!m.depthWrite || m.opacity < 0.3)));
          if (decorative || (!settings.openSky && bounds.min.y > ceiling)) {
            hidden.push(object); object.visible = false; return;
          }
          bounds.getSize(size);
          if (!fitted && !(object instanceof THREE.SkinnedMesh) && size.x < 400 && size.z < 400
            && Math.abs(bounds.getCenter(projected).x - position.x) < 250
            && Math.abs(projected.z - position.z) < 250) layout.union(bounds);
        });
        if (!fitted) {
          if (settings.bounds) {
            const b = settings.bounds;
            centerX = (b.minX + b.maxX) / 2; centerZ = (b.minZ + b.maxZ) / 2;
            radius = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.56;
          } else if (!layout.isEmpty()) {
            layout.getCenter(projected); layout.getSize(size);
            centerX = projected.x; centerZ = projected.z;
            radius = THREE.MathUtils.clamp(Math.hypot(size.x, size.z) * 0.56, 12, 55);
          } else { centerX = position.x; centerZ = position.z; radius = 24; }
          fitted = true;
        }
        if (!expanded && (settings.radius || radius >= 55 || Math.hypot(position.x - centerX, position.z - centerZ) > radius * 0.82)) {
          centerX = position.x; centerZ = position.z;
        }
        const range = settings.radius ?? radius;
        if (expanded && settings.bounds) {
          const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height)), bounds = settings.bounds;
          const halfHeight = Math.max((bounds.maxZ - bounds.minZ) / 2, (bounds.maxX - bounds.minX) / (2 * aspect)) * 1.13;
          camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
          camera.bottom = -halfHeight; camera.top = halfHeight;
        } else { camera.left = camera.bottom = -range; camera.right = camera.top = range; }
        camera.position.set(centerX, position.y + 9000, centerZ);
        camera.lookAt(centerX, position.y, centerZ); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        scene.overrideMaterial = material; scene.background = null; scene.fog = null;
        renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
        renderer.autoClear = true; renderer.setRenderTarget(target); renderer.setScissorTest(false);
        renderer.setClearColor(0x07111a, 1); renderer.clear(); renderer.render(scene, camera);
      } finally {
        for (const object of hidden) object.visible = true;
        for (const [object, before, after] of callbacks) { object.onBeforeRender = before; object.onAfterRender = after; }
        restoreVisibility?.();
        scene.overrideMaterial = oldOverride; scene.background = oldBackground; scene.fog = oldFog;
        renderer.xr.enabled = oldXr; renderer.shadowMap.autoUpdate = oldShadows; renderer.shadowMap.needsUpdate = oldShadowUpdate;
        renderer.autoClear = oldAutoClear; renderer.setClearColor(clearColor, oldAlpha);
        renderer.setRenderTarget(oldTarget, oldCubeFace, oldMip); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(oldScissor);
      }
    }
    placeMarker(arrow, position.x, position.z);
    arrow.style.transform = `translate(-50%, -50%) rotate(${-yaw}rad)`;
    goalMarker.classList.toggle('hidden', !settings.goal);
    if (settings.goal) {
      goalMarker.textContent = settings.goal.label; placeMarker(goalMarker, settings.goal.x, settings.goal.z);
    }
    const pads = settings.safePads ?? [];
    while (padMarkers.length > pads.length) padMarkers.pop()!.remove();
    pads.forEach((pad, index) => {
      if (!padMarkers[index]) {
        const marker = document.createElement('span'); marker.className = 'minimap-safe-pad';
        marker.setAttribute('aria-hidden', 'true'); marker.title = 'Safe checkpoint pad'; element.append(marker); padMarkers.push(marker);
      }
      placeMarker(padMarkers[index], pad.x, pad.z);
    });
    routeGuide.classList.toggle('hidden', !settings.route?.length);
    if (settings.route?.length) routePath.setAttribute('d', settings.route.map((point, index) => {
      projected.set(point.x, floor, point.z).project(camera);
      return `${index ? 'L' : 'M'} ${(projected.x + 1) * 50} ${(1 - projected.y) * 50}`;
    }).join(' '));
    stairMarkers.forEach((marker, index) => {
      const stair = settings.stairs?.[index]; marker.classList.toggle('hidden', !stair);
      if (stair) placeMarker(marker, stair.x, stair.z);
    });
    const enemies = settings.enemies ?? [];
    for (const [id, marker] of enemyMarkers) {
      if (!enemies.some(enemy => enemy.id === id)) { marker.remove(); enemyMarkers.delete(id); }
    }
    for (const enemy of enemies) {
      let marker = enemyMarkers.get(enemy.id);
      if (!marker) {
        marker = document.createElement('span');
        marker.className = 'minimap-enemy';
        marker.setAttribute('aria-hidden', 'true');
        element.appendChild(marker);
        enemyMarkers.set(enemy.id, marker);
      }
      placeMarker(marker, enemy.position.x, enemy.position.z);
      marker.style.transform = `translate(-50%, -50%) rotate(${-(enemy.yaw ?? 0)}rad)`;
      marker.style.setProperty('--enemy-vision-size', `${(enemy.range ?? 0) / (settings.radius ?? radius) * rect.width / 2}px`);
      marker.dataset.alerted = String(!!enemy.alerted);
      marker.dataset.kind = enemy.kind ?? 'patrol';
    }
    element.setAttribute('aria-label', expanded ? `Vent maze. Follow the dotted route to ${settings.goal?.label ?? 'the exit'}. Red sensors are active; green sensors are safe.`
      : enemies.length ? `Top-down map with ${enemies.length} enemy patrol${enemies.length === 1 ? '' : 's'}` : 'Top-down map of the current scene');
    const oldTarget = renderer.getRenderTarget();
    const oldCubeFace = renderer.getActiveCubeFace(), oldMip = renderer.getActiveMipmapLevel();
    renderer.getViewport(viewport); renderer.getScissor(scissor);
    const oldScissor = renderer.getScissorTest(), oldAutoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(null); renderer.autoClear = false;
      renderer.setViewport(rect.left, window.innerHeight - rect.bottom, rect.width, rect.height);
      renderer.setScissor(rect.left, window.innerHeight - rect.bottom, rect.width, rect.height);
      renderer.setScissorTest(true); quad.render(renderer);
    } finally {
      renderer.autoClear = oldAutoClear; renderer.setRenderTarget(oldTarget, oldCubeFace, oldMip);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(oldScissor);
    }
  }
  function renderGameInset(scene: THREE.Scene, gameCamera: THREE.PerspectiveCamera) {
    if (!expanded || element.classList.contains('hidden')) return;
    const inset = gameView.getBoundingClientRect(), scale = renderer.getPixelRatio();
    const width = Math.max(1, Math.round(inset.width * scale)), height = Math.max(1, Math.round(inset.height * scale));
    if (gameTarget.width !== width || gameTarget.height !== height) gameTarget.setSize(width, height);
    const oldTarget = renderer.getRenderTarget(), oldCubeFace = renderer.getActiveCubeFace(), oldMip = renderer.getActiveMipmapLevel();
    renderer.getViewport(viewport); renderer.getScissor(scissor);
    const oldScissor = renderer.getScissorTest(), oldAutoClear = renderer.autoClear;
    const aspect = gameCamera.aspect;
    try {
      gameCamera.aspect = inset.width / Math.max(1, inset.height); gameCamera.updateProjectionMatrix();
      renderer.autoClear = true; renderer.setRenderTarget(gameTarget); renderer.setScissorTest(false);
      renderer.clear(); renderer.render(scene, gameCamera);
      renderer.setRenderTarget(null); renderer.autoClear = false;
      renderer.setViewport(inset.left, window.innerHeight - inset.bottom, inset.width, inset.height);
      renderer.setScissor(inset.left, window.innerHeight - inset.bottom, inset.width, inset.height);
      renderer.setScissorTest(true); gameQuad.render(renderer);
    } finally {
      gameCamera.aspect = aspect; gameCamera.updateProjectionMatrix();
      renderer.autoClear = oldAutoClear; renderer.setRenderTarget(oldTarget, oldCubeFace, oldMip);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(oldScissor);
    }
  }
  return { render, renderGameInset, reset, hide, dispose() {
    observer.disconnect(); window.removeEventListener('resize', resize);
    target.dispose(); material.dispose(); compositeMaterial.dispose(); quad.dispose();
    gameTarget.dispose(); gameMaterial.dispose(); gameQuad.dispose(); gameInset.remove();
    reset(); routeGuide.remove(); goalMarker.remove();
  } };
}
