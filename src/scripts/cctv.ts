import * as THREE from 'three';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import { STAGE_TWO, type CameraFeedId } from '../scenes/level 1 stage 2/stageTwoLayout.js';

export interface CctvFeedSource {
  scene: THREE.Scene;
  camera?: THREE.Camera;
  update?: (dt: number) => void;
  dispose(): void;
}
export interface CctvFeedDefinition {
  id: CameraFeedId;
  label: string;
  cleared?: () => boolean;
  load: () => Promise<CctvFeedSource>;
}
export interface CctvTarget {
  id: CameraFeedId;
  label: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export function createCctvSystem(renderer: THREE.WebGLRenderer, definitions: readonly CctvFeedDefinition[]) {
  if (!definitions.length || new Set(definitions.map(feed => feed.id)).size !== definitions.length)
    throw new Error('The camera wall requires at least one feed and unique feed IDs');
  const records = definitions.map(definition => ({
    definition, status: 'idle' as CctvTarget['status'], source: null as CctvFeedSource | null, generation: 0,
    pending: null as Promise<boolean> | null, cleared: undefined as boolean | undefined,
  }));
  const columns = 4, rows = Math.max(3, Math.ceil((definitions.length + columns) / columns));
  const panel = new THREE.Group(); panel.name = 'SurveillanceCameraWall';
  panel.position.set(STAGE_TWO.cameraWall.x, STAGE_TWO.cameraWall.y, STAGE_TWO.cameraWall.z);
  panel.rotation.y = STAGE_TWO.cameraWall.yaw; panel.userData.minimap = false;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(8.65, rows * 1.18 + 0.13, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x101820, metalness: 0.65, roughness: 0.5 }));
  panel.add(housing);
  const frameGeometry = new THREE.BoxGeometry(2.04, 1.18, 0.06);
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x53606a, metalness: 0.65, roughness: 0.45 });
  const offMaterial = new THREE.MeshStandardMaterial({ color: 0x020406, metalness: 0.25, roughness: 0.3 });
  function cellPosition(slot: number, depth: number) {
    return new THREE.Vector3((slot % columns - (columns - 1) / 2) * 2.12,
      ((rows - 1) / 2 - Math.floor(slot / columns)) * 1.18, depth);
  }
  for (let slot = 0; slot < columns * rows; slot++) {
    const frame = new THREE.Mesh(frameGeometry, frameMaterial); frame.position.copy(cellPosition(slot, 0.125)); panel.add(frame);
    if (slot < columns || slot >= columns + definitions.length) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9 * 9 / 16), offMaterial);
      screen.name = `cctv-standby-${slot}`; screen.position.copy(cellPosition(slot, 0.16)); panel.add(screen);
    }
  }
  const targets = definitions.map(definition => {
    const target = new THREE.WebGLRenderTarget(512, 288); target.texture.name = `surveillance-${definition.id}`; return target;
  });
  const placeholders = definitions.map(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 288;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  });
  const cameras = definitions.map(definition => {
    const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 60);
    if (definition.id === 'stage2-armory') { camera.position.set(3.35, 2.7, 3.1); camera.lookAt(-0.8, 0.9, -1.8); }
    else { camera.position.set(3.3, 2.8, -3.6); camera.lookAt(0, 0.8, 1.8); }
    return camera;
  });
  const screens = definitions.map((definition, index) => {
    const material = new THREE.MeshBasicMaterial({ map: placeholders[index].texture, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9 * 9 / 16), material);
    mesh.name = `cctv-screen-${definition.id}`; mesh.position.copy(cellPosition(columns + index, 0.165)); panel.add(mesh);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 56;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9 * 56 / 512),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false }));
    overlay.position.copy(mesh.position); overlay.position.y -= 0.43; overlay.position.z += 0.004; panel.add(overlay);
    return { mesh, material, position: mesh.position.clone(), canvas, texture, overlay };
  });
  let mountedScene: THREE.Scene | null = null, elapsed = 0, highlighted = -1, disposed = false;
  const raycaster = new THREE.Raycaster(), center = new THREE.Vector2();
  function drawOverlay(index: number) {
    const { canvas, texture } = screens[index], context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to draw camera feed captions');
    const record = records[index], cleared = record.definition.cleared?.() ?? false; record.cleared = cleared;
    context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#08131ddd'; context.fillRect(0, 0, 512, 56);
    context.textAlign = 'left'; context.font = '24px monospace'; context.fillStyle = '#d6e6ed';
    context.fillText(record.definition.label, 12, 37);
    if (cleared) { context.textAlign = 'right'; context.font = '20px monospace'; context.fillStyle = '#72eeaa'; context.fillText('CLEARED', 500, 37); }
    texture.needsUpdate = true;
  }
  function drawPlaceholder(index: number) {
    const { canvas, texture } = placeholders[index], context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to draw the camera link status');
    const record = records[index];
    context.fillStyle = '#07111a'; context.fillRect(0, 0, 512, 288); context.strokeStyle = '#173044';
    for (let y = 0; y < 288; y += 18) { context.beginPath(); context.moveTo(0, y); context.lineTo(512, y); context.stroke(); }
    context.textAlign = 'center'; context.font = '23px monospace'; context.fillStyle = record.status === 'error' ? '#ff8b89' : '#93dbef';
    context.fillText(record.status === 'error' ? 'LINK OFFLINE / E TO RETRY' : record.status === 'loading' ? 'CONNECTING...' : 'STANDBY', 256, 145);
    texture.needsUpdate = true;
  }
  function loadFeed(index: number): Promise<boolean> {
    const record = records[index];
    if (record.status === 'ready') return Promise.resolve(true);
    if (record.pending) return record.pending;
    const generation = ++record.generation; record.status = 'loading'; drawPlaceholder(index);
    record.pending = record.definition.load().then(source => {
      if (disposed || generation !== record.generation) { source.dispose(); return false; }
      record.source = source; record.status = 'ready'; screens[index].material.map = targets[index].texture;
      screens[index].material.needsUpdate = true; elapsed = 1; return true;
    }, error => {
      if (!disposed && generation === record.generation) {
        console.error(`[CCTV] Unable to prepare ${record.definition.label}:`, error); record.status = 'error'; drawPlaceholder(index);
      }
      return false;
    }).finally(() => { if (generation === record.generation) record.pending = null; });
    return record.pending;
  }
  function highlightScreen(index: number | null) {
    if (highlighted === (index ?? -1)) return;
    if (highlighted >= 0) {
      const previous = screens[highlighted]; previous.mesh.position.copy(previous.position); previous.mesh.scale.setScalar(1);
    }
    highlighted = index ?? -1;
    if (highlighted >= 0) { screens[highlighted].mesh.position.z += 0.025; screens[highlighted].mesh.scale.setScalar(1.02); }
  }
  function detach() { highlightScreen(null); panel.removeFromParent(); mountedScene = null; }
  function clearSources() {
    records.forEach((record, index) => {
      record.generation++; record.source?.dispose(); record.source = null; record.pending = null; record.status = 'idle';
      screens[index].material.map = placeholders[index].texture; drawPlaceholder(index);
    });
  }
  placeholders.forEach((_placeholder, index) => { drawPlaceholder(index); drawOverlay(index); });
  return {
    panel, detach, clearSources, highlightScreen,
    async prepareFeeds() {
      await Promise.all(records.map((_record, index) => loadFeed(index)));
      const failed = records.filter(record => record.status !== 'ready');
      if (failed.length) throw new Error(`Camera links unavailable: ${failed.map(record => record.definition.label).join(', ')}`);
    },
    retryFeed(id: CameraFeedId) {
      const index = records.findIndex(record => record.definition.id === id);
      if (index < 0) throw new Error(`Unknown camera feed ${id}`);
      void loadFeed(index);
    },
    getTarget(camera: THREE.PerspectiveCamera): CctvTarget | null {
      if (!mountedScene) return null;
      panel.updateWorldMatrix(true, true); camera.updateMatrixWorld(true); raycaster.setFromCamera(center, camera);
      const hit = raycaster.intersectObjects(screens.map(screen => screen.mesh), false)[0];
      const index = hit && hit.distance < 9 ? screens.findIndex(screen => screen.mesh === hit.object) : -1;
      highlightScreen(index < 0 ? null : index);
      return index < 0 ? null : { id: records[index].definition.id, label: records[index].definition.label, status: records[index].status };
    },
    update(dt: number, scene: THREE.Scene | null, enabled: boolean, paused = false) {
      if (disposed || !scene || !enabled) { detach(); return; }
      if (scene !== mountedScene) { detach(); scene.add(panel); mountedScene = scene; elapsed = 1; }
      records.forEach((record, index) => {
        if (record.status === 'idle') void loadFeed(index);
        if (record.cleared !== (record.definition.cleared?.() ?? false)) drawOverlay(index);
      });
      elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (elapsed < 1 / 8) return;
      const frame = elapsed; elapsed = 0;
      const previousTarget = renderer.getRenderTarget(), previousShadows = renderer.shadowMap.autoUpdate, wasVisible = panel.visible;
      panel.visible = false; renderer.shadowMap.autoUpdate = false;
      try {
        records.forEach((record, index) => {
          if (!record.source || record.status !== 'ready') return;
          if (!paused) record.source.update?.(Math.min(frame, 0.1));
          renderer.setRenderTarget(targets[index]);
          renderer.render(record.source.scene, record.source.camera ?? cameras[index]);
        });
      } finally { renderer.setRenderTarget(previousTarget); renderer.shadowMap.autoUpdate = previousShadows; panel.visible = wasVisible; }
    },
    dispose() {
      if (disposed) return; disposed = true; detach(); clearSources();
      targets.forEach(target => target.dispose()); placeholders.forEach(placeholder => placeholder.texture.dispose()); disposeRoom(panel);
    },
  };
}
