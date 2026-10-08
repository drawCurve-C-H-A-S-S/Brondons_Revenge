import * as THREE from 'three';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import type { CameraRoomId } from '../scenes/level 1 stage 2/stageTwoLayout.js';

export interface CctvFeedSource {
  scene: THREE.Scene;
  update?: (dt: number) => void;
  dispose(): void;
}
export interface CctvFeedDefinition {
  id: CameraRoomId;
  label: string;
  load: () => Promise<CctvFeedSource>;
}
export interface CctvTarget {
  id: CameraRoomId;
  label: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export function createCctvSystem(renderer: THREE.WebGLRenderer, definitions: readonly CctvFeedDefinition[]) {
  if (definitions.length !== 3) throw new Error('The surveillance console requires three camera feeds');
  const records = definitions.map(definition => ({
    definition, status: 'idle' as CctvTarget['status'], source: null as CctvFeedSource | null, generation: 0,
  }));
  const panel = new THREE.Group(); panel.name = 'SurveillanceCameraConsole'; panel.position.set(17.8, 2.07, -9.52);
  panel.userData.minimap = false;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(5.45, 1.55, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x182431, metalness: 0.65, roughness: 0.4 }));
  panel.add(housing);
  function label(text: string, width: number, x: number, y: number) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to label the surveillance console');
    context.fillStyle = '#93dbef'; context.font = 'bold 37px monospace'; context.textAlign = 'center';
    context.fillText(text, 384, 65);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.19),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
    mesh.position.set(x, y, 0.09); panel.add(mesh);
  }
  label('SURVEILLANCE / LIVE ROOM LINKS', 4.9, 0, 0.61);
  const targets = definitions.map((definition) => {
    const target = new THREE.WebGLRenderTarget(512, 288); target.texture.name = `surveillance-${definition.id}`; return target;
  });
  const placeholders = definitions.map(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 288;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  });
  const cameras = definitions.map(definition => {
    const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 50);
    if (definition.id === 'stage2-armory') { camera.position.set(3.35, 2.7, 3.1); camera.lookAt(-0.8, 0.9, -1.8); }
    else { camera.position.set(3.3, 2.8, -3.6); camera.lookAt(0, 0.8, 1.8); }
    return camera;
  });
  const screens = definitions.map((definition, index) => {
    const material = new THREE.MeshBasicMaterial({ map: placeholders[index].texture, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.65 * 9 / 16), material);
    mesh.name = `cctv-screen-${definition.id}`;
    mesh.position.set((index - 1) * 1.8, -0.03, 0.095);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.02, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x8395a5, metalness: 0.65, roughness: 0.45 }));
    frame.position.copy(mesh.position); frame.position.z = 0.065; panel.add(frame);
    label(definition.label, 1.65, mesh.position.x, -0.61);
    panel.add(mesh); return { mesh, material, position: mesh.position.clone() };
  });
  let mountedScene: THREE.Scene | null = null, elapsed = 0, highlighted = -1, disposed = false;
  const raycaster = new THREE.Raycaster(), center = new THREE.Vector2();

  function drawPlaceholder(index: number) {
    const { canvas, texture } = placeholders[index], context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to draw the surveillance feed status');
    const record = records[index];
    context.fillStyle = '#0a1826'; context.fillRect(0, 0, 512, 288);
    context.strokeStyle = '#2a5268'; context.lineWidth = 2;
    for (let y = 0; y < 288; y += 18) { context.beginPath(); context.moveTo(0, y); context.lineTo(512, y); context.stroke(); }
    context.textAlign = 'center'; context.fillStyle = '#93dbef'; context.font = 'bold 29px monospace';
    context.fillText(record.definition.label, 256, 95);
    context.font = '20px monospace'; context.fillStyle = record.status === 'error' ? '#ff8b89' : '#d6e6ed';
    context.fillText(record.status === 'error' ? 'LINK OFFLINE / E TO RETRY'
      : record.status === 'loading' ? 'CONNECTING CAMERA...' : 'SECURITY LINK LOCKED', 256, 161);
    context.fillStyle = '#bd77ff'; context.fillText('Q: HOME MARKER / T: RETURN', 256, 231);
    texture.needsUpdate = true;
  }
  function loadFeed(index: number) {
    const record = records[index];
    if (record.status === 'loading' || record.status === 'ready') return;
    const generation = ++record.generation; record.status = 'loading'; drawPlaceholder(index);
    void record.definition.load().then(source => {
      if (disposed || generation !== record.generation) { source.dispose(); return; }
      record.source = source; record.status = 'ready';
      screens[index].material.map = targets[index].texture; screens[index].material.needsUpdate = true;
      elapsed = 1;
    }, error => {
      if (disposed || generation !== record.generation) return;
      console.error(`[CCTV] Unable to prepare ${record.definition.label}:`, error);
      record.status = 'error'; drawPlaceholder(index);
    });
  }
  function highlightScreen(index: number | null) {
    if (highlighted === (index ?? -1)) return;
    if (highlighted >= 0) {
      const previous = screens[highlighted]; previous.mesh.position.copy(previous.position); previous.mesh.scale.setScalar(1);
    }
    highlighted = index ?? -1;
    if (highlighted >= 0) { screens[highlighted].mesh.position.z += 0.045; screens[highlighted].mesh.scale.setScalar(1.035); }
  }
  function detach() { highlightScreen(null); panel.removeFromParent(); mountedScene = null; }
  function clearSources() {
    records.forEach((record, index) => {
      record.generation++; record.source?.dispose(); record.source = null; record.status = 'idle';
      screens[index].material.map = placeholders[index].texture; drawPlaceholder(index);
    });
  }
  placeholders.forEach((_placeholder, index) => drawPlaceholder(index));
  return {
    panel,
    detach, clearSources, highlightScreen,
    retryFeed(id: CameraRoomId) {
      const index = records.findIndex(record => record.definition.id === id);
      if (index < 0) throw new Error(`Unknown surveillance destination ${id}`);
      loadFeed(index);
    },
    getTarget(camera: THREE.PerspectiveCamera): CctvTarget | null {
      if (!mountedScene) return null;
      panel.updateWorldMatrix(true, true); camera.updateMatrixWorld(true); raycaster.setFromCamera(center, camera);
      const hit = raycaster.intersectObjects(screens.map(screen => screen.mesh), false)[0];
      const index = hit && hit.distance < 7.5 ? screens.findIndex(screen => screen.mesh === hit.object) : -1;
      highlightScreen(index < 0 ? null : index);
      return index < 0 ? null : { id: records[index].definition.id, label: records[index].definition.label, status: records[index].status };
    },
    update(dt: number, scene: THREE.Scene | null, enabled: boolean) {
      if (disposed || !scene || !enabled) { detach(); return; }
      if (scene !== mountedScene) { detach(); scene.add(panel); mountedScene = scene; elapsed = 1; }
      if (!enabled) return;
      records.forEach((record, index) => { if (record.status === 'idle') loadFeed(index); });
      elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (elapsed < 1 / 8) return; elapsed = 0;
      const previousTarget = renderer.getRenderTarget(), previousShadows = renderer.shadowMap.autoUpdate;
      const wasVisible = panel.visible; panel.visible = false; renderer.shadowMap.autoUpdate = false;
      try {
        records.forEach((record, index) => {
          if (!record.source || record.status !== 'ready') return;
          record.source.update?.(1 / 8); renderer.setRenderTarget(targets[index]); renderer.render(record.source.scene, cameras[index]);
        });
      } finally {
        renderer.setRenderTarget(previousTarget); renderer.shadowMap.autoUpdate = previousShadows; panel.visible = wasVisible;
      }
    },
    dispose() {
      if (disposed) return; disposed = true; detach(); clearSources(); disposeRoom(panel);
      targets.forEach(target => target.dispose()); placeholders.forEach(placeholder => placeholder.texture.dispose());
    },
  };
}
