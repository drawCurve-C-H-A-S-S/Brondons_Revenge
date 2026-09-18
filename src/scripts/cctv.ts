import * as THREE from 'three';

export interface SurveillanceView {
  scene: THREE.Scene;
  updateEnvironment: (dt: number) => void;
  dispose: () => void;
}

export interface SecurityCameraDefinition {
  id: string;
  label: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  createView: () => SurveillanceView;
  panel?: { position: [number, number, number]; yaw: number };
}

export function disposeSurveillanceScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    }
    const reflector = object as THREE.Object3D & { isReflector?: boolean; dispose?: () => void };
    if (reflector.isReflector) reflector.dispose?.();
    if (object instanceof THREE.Light) object.shadow?.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

const SLOTS = 4;
const FEED_FPS = 8;
const PAGE_SECONDS = 8;
const PANEL_WIDTH = 2.12;
const PIXEL_SCALE = PANEL_WIDTH / 1024;

export function createCctvPanel() {
  const group = new THREE.Group();
  group.name = 'hallway-cctv-panel';
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(2.25, 1.78, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x172329, metalness: 0.65, roughness: 0.4 }),
  );
  group.add(housing);

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 800;
  const context = canvas.getContext('2d')!;
  const overlayTexture = new THREE.CanvasTexture(canvas);
  overlayTexture.colorSpace = THREE.SRGBColorSpace;
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH, 800 * PIXEL_SCALE),
    new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true, toneMapped: false, depthWrite: false }),
  );
  overlay.position.z = 0.092;
  group.add(overlay);

  const screens = Array.from({ length: SLOTS }, (_, index) => {
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(464 * PIXEL_SCALE, 261 * PIXEL_SCALE),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb9e4d7).multiplyScalar(1.5) }),
    );
    screen.position.set(
      (32 + (index % 2) * 496 + 232 - 512) * PIXEL_SCALE,
      (400 - (128 + Math.floor(index / 2) * 316 + 130.5)) * PIXEL_SCALE,
      0.09,
    );
    screen.name = `cctv-feed-${index + 1}`;
    group.add(screen);
    return screen;
  });
  const indicators = screens.map((screen, index) => {
    const indicator = new THREE.Mesh(
      new THREE.CircleGeometry(12 * PIXEL_SCALE, 20),
      new THREE.MeshBasicMaterial({ color: 0x79efbb, toneMapped: false }),
    );
    indicator.position.set(
      screen.position.x - 210 * PIXEL_SCALE,
      screen.position.y + 108.5 * PIXEL_SCALE,
      0.094,
    );
    indicator.name = `cctv-room-status-${index + 1}`;
    indicator.visible = false;
    group.add(indicator);
    return indicator;
  });

  function updateOccupancy(occupied: boolean[], time: number) {
    const blinkOn = Math.floor(time * 2) % 2 === 0;
    indicators.forEach((indicator, index) => {
      indicator.visible = screens[index].visible;
      indicator.material.color.setHex(occupied[index] ? 0x79efbb : blinkOn ? 0xff3030 : 0x400808);
    });
  }

  function setFeeds(feeds: Array<{ label: string; texture: THREE.Texture }>, page: number, pageCount: number) {
    context.fillStyle = '#071216';
    context.fillRect(0, 0, 1024, 800);
    context.fillStyle = '#79efbb';
    context.fillRect(32, 28, 8, 38);
    context.font = 'bold 30px monospace';
    context.fillText('SHIP SECURITY', 58, 58);
    context.font = '20px monospace';
    context.fillText('CCTV / LIVE', 806, 56);
    context.fillStyle = '#203e46';
    context.fillRect(32, 82, 960, 2);

    screens.forEach((screen, index) => {
      const feed = feeds[index];
      screen.visible = !!feed;
      indicators[index].visible = !!feed;
      screen.material.map = feed?.texture ?? null;
      screen.material.needsUpdate = true;
      const x = 32 + (index % 2) * 496;
      const y = 128 + Math.floor(index / 2) * 316;
      context.font = 'bold 21px monospace';
      context.fillStyle = feed ? '#b4e1d3' : '#47616b';
      context.fillText(feed ? `${String(page * SLOTS + index + 1).padStart(2, '0')} / ${feed.label}` : 'UNASSIGNED', x, y - 12);
      if (feed) {
        context.clearRect(x, y, 464, 261);
        context.fillStyle = 'rgba(3, 18, 19, 0.13)';
        for (let line = y; line < y + 261; line += 4) context.fillRect(x, line, 464, 1);
      } else {
        context.fillStyle = '#0d2027';
        context.fillRect(x, y, 464, 261);
        context.fillStyle = '#47616b';
        context.font = '20px monospace';
        context.fillText('CHANNEL AVAILABLE', x + 126, y + 137);
      }
    });
    context.fillStyle = '#203e46';
    context.fillRect(32, 738, 960, 2);
    context.font = '20px monospace';
    context.fillStyle = '#79a79e';
    context.fillText('DECK 01 / INTERNAL NETWORK', 32, 775);
    context.fillText(`PAGE ${page + 1} / ${pageCount}`, 826, 775);
    overlayTexture.needsUpdate = true;
  }

  return {
    group, housing, screens, indicators, setFeeds, updateOccupancy,
    dispose() {
      group.removeFromParent();
      // Render targets belong to the camera system, not to individual panels.
      screens.forEach(screen => { screen.material.map = null; });
      disposeSurveillanceScene(group);
    },
  };
}

export function createCctvSystem(renderer: THREE.WebGLRenderer, definitions: SecurityCameraDefinition[]) {
  const feeds = definitions.map(definition => {
    const camera = new THREE.PerspectiveCamera(85, 16 / 9, 0.1, 250);
    camera.position.set(...definition.position);
    camera.lookAt(...definition.lookAt);
    const target = new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType });
    target.texture.name = `cctv-${definition.id}`;
    return { definition, camera, target, view: null as SurveillanceView | null, initialized: false };
  });
  let panel: ReturnType<typeof createCctvPanel> | null = null;
  let mountedScene: THREE.Scene | null = null;
  let elapsed = 0;
  let page = -1;
  let nextFeed = 0;
  let frameTime = 0;
  let disposed = false;
  const frustum = new THREE.Frustum();
  const panelBounds = new THREE.Box3();
  const projection = new THREE.Matrix4();
  const panelPosition = new THREE.Vector3();
  const panelNormal = new THREE.Vector3();
  const toViewer = new THREE.Vector3();
  const pageCount = Math.max(1, Math.ceil(feeds.length / SLOTS));

  function update(dt: number, active: { roomId?: string; scene: THREE.Scene }, viewer: THREE.Camera, character?: THREE.Object3D) {
    if (disposed) return;
    const definition = definitions.find(item => item.id === active.roomId);
    if (mountedScene !== active.scene) {
      panel?.dispose();
      panel = null;
      mountedScene = active.scene;
      elapsed = 0;
      page = -1;
      nextFeed = 0;
      frameTime = 1;
      if (definition?.panel) {
        panel = createCctvPanel();
        panel.group.position.set(...definition.panel.position);
        panel.group.rotation.y = definition.panel.yaw;
        active.scene.add(panel.group);
      }
    }
    if (!panel || feeds.length === 0) return;
    panel.group.updateMatrixWorld(true);
    viewer.updateMatrixWorld();
    panel.group.getWorldPosition(panelPosition);
    viewer.getWorldPosition(toViewer).sub(panelPosition);
    panelNormal.set(0, 0, 1).transformDirection(panel.group.matrixWorld);
    projection.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    panelBounds.setFromObject(panel.housing);
    if (toViewer.lengthSq() > 12 * 12 || panelNormal.dot(toViewer) <= 0 || !frustum.intersectsBox(panelBounds)) return;

    elapsed += dt;
    const newPage = Math.floor(elapsed / PAGE_SECONDS) % pageCount;
    const visibleFeeds = feeds.slice(newPage * SLOTS, (newPage + 1) * SLOTS);
    if (newPage !== page) {
      page = newPage;
      nextFeed = 0;
      panel.setFeeds(visibleFeeds.map(feed => ({ label: feed.definition.label, texture: feed.target.texture })), page, pageCount);
    }
    panel.updateOccupancy(visibleFeeds.map(feed => feed.definition.id === active.roomId), elapsed);
    frameTime += dt;
    if (frameTime < 1 / (FEED_FPS * visibleFeeds.length)) return;
    frameTime = 0;
    const feed = visibleFeeds[nextFeed++ % visibleFeeds.length];
    const isActiveRoom = feed.definition.id === active.roomId;
    if (!isActiveRoom && !feed.view) feed.view = feed.definition.createView();
    const source = isActiveRoom ? active.scene : feed.view!.scene;
    if (!isActiveRoom) feed.view!.updateEnvironment(1 / FEED_FPS);
    const hidden: THREE.Object3D[] = [];
    source.traverse(object => {
      // Mirrors would launch another render pass; the panel would sample its own target.
      if (object.visible && ((object as THREE.Object3D & { isReflector?: boolean }).isReflector || object === panel!.group)) {
        hidden.push(object);
        object.visible = false;
      }
    });
    const previousTarget = renderer.getRenderTarget();
    const previousXr = renderer.xr.enabled;
    const previousShadows = renderer.shadowMap.autoUpdate;
    const characterVisible = character?.visible;
    try {
      if (character && isActiveRoom) character.visible = true;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = !feed.initialized;
      renderer.setRenderTarget(feed.target);
      renderer.render(source, feed.camera);
      feed.initialized = true;
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.xr.enabled = previousXr;
      renderer.shadowMap.autoUpdate = previousShadows;
      hidden.forEach(object => { object.visible = true; });
      if (character && characterVisible !== undefined) character.visible = characterVisible;
    }
  }

  return {
    update,
    dispose() {
      disposed = true;
      panel?.dispose();
      panel = null;
      feeds.forEach(feed => {
        feed.target.dispose();
        feed.view?.dispose();
      });
    },
  };
}
