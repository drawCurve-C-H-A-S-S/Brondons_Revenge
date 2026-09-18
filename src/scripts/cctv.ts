import * as THREE from 'three';
import { createScene as createScene2 } from '../scenes/scene2.js';
import { createScene as createScene3 } from '../scenes/scene3.js';
import { createScene as createScene4 } from '../scenes/scene4.js';
import { NPCEnemyManager } from './npc-enemy-robots.js';

const FEED_SIZE = 384;
const FEED_COUNT = 4;

type FeedSource = { scene: THREE.Scene; update?: (dt: number) => void; dispose?: () => void };

function disposeObject(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    materials.forEach(material => {
      const texture = (material as THREE.MeshBasicMaterial).map;
      texture?.dispose();
      material.dispose();
    });
  });
}

export function createCctvSystem(renderer: THREE.WebGLRenderer) {
  const sources = new Map<string, FeedSource>();
  const sourceFactories: Record<string, () => FeedSource> = {
    'medical-bay': () => createScene2({}),
    hallway: () => createScene3({}),
    'computer-room': () => {
      const sceneData = createScene4({ cafeteriaUnlocked: true, chestOpened: true });
      const enemyManager = new NPCEnemyManager();
      enemyManager.enterScene('scene4', sceneData);
      return {
        scene: sceneData.scene,
        update: dt => { sceneData.updatePhysics(dt); enemyManager.update(dt); },
        dispose: () => { enemyManager.dispose(); sceneData.dispose(); },
      };
    },
  };
  const roomIds = ['cafeteria', 'medical-bay', 'hallway', 'computer-room'];
  const roomLabels = ['GALLEY', 'MEDICAL BAY', 'HALLWAY', 'COMPUTER ROOM'];
  const targets = Array.from({ length: FEED_COUNT }, (_, index) => {
      const target = new THREE.WebGLRenderTarget(512, 288);
    target.texture.name = `cafeteria-cctv-${index + 1}`;
    return target;
  });
    const cameras = [
      { position: [0, 3.8, 5.4], lookAt: [0, 1, 0] },
      { position: [3.8, 8.7, 8], lookAt: [-1, 1.5, -5] },
      { position: [3.4, 3.9, 8.8], lookAt: [-1, 1.2, -7] },
      { position: [-4.2, 3.8, -5], lookAt: [1, 1, 2.5] },
    ].map(definition => {
    const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 100);
    camera.position.set(...definition.position as [number, number, number]);
    camera.lookAt(...definition.lookAt as [number, number, number]);
    return camera;
  });

  const panel = new THREE.Group();
  panel.name = 'cafeteria-cctv-panel';
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(5.3, 3.1, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x172329, metalness: 0.65, roughness: 0.4 }),
  );
  panel.add(housing);
  const screens = targets.map((target, index) => {
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 1.32),
      new THREE.MeshBasicMaterial({ map: target.texture, toneMapped: false }),
    );
    screen.position.set(index % 2 === 0 ? -1.3 : 1.3, index < 2 ? 0.78 : -0.78, 0.095);
    panel.add(screen);
    return screen;
  });
  const indicators = screens.map((screen, index) => {
    const indicator = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshBasicMaterial({ color: 0x39d98a, toneMapped: false }),
    );
    indicator.position.set(screen.position.x + 0.98, screen.position.y + 0.49, 0.11);
    indicator.name = `cctv-occupancy-${index + 1}`;
    panel.add(indicator);
    return indicator;
  });
  panel.position.set(-6.88, 2.25, 2.8);
  panel.rotation.y = Math.PI / 2;
  let mountedScene: THREE.Scene | null = null;
  let elapsed = 0;

  function update(dt: number, roomId: string | undefined, scene: THREE.Scene | null, npcRoomId?: string | null) {
    if (roomId !== 'cafeteria' || !scene) {
      panel.removeFromParent();
      mountedScene = null;
      return;
    }
    if (mountedScene !== scene) {
      panel.removeFromParent();
      scene.add(panel);
      mountedScene = scene;
      elapsed = 0;
    }
    elapsed += Number.isFinite(dt) ? dt : 0;
    if (elapsed < 1 / 8) return;
    elapsed = 0;
    const occupiedRooms = new Set([roomId, npcRoomId].filter(Boolean).map(id => id === 'scene4' ? 'computer-room' : id));
    indicators.forEach((indicator, index) => {
      indicator.material.color.setHex(occupiedRooms.has(roomIds[index]) ? 0xff3f4f : 0x39d98a);
    });
    const wasVisible = panel.visible;
    panel.visible = false;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      cameras.forEach((camera, index) => {
        const roomIdForFeed = roomIds[index];
        const feedSource = roomIdForFeed === roomId ? null : getSource(roomIdForFeed);
        feedSource?.update?.(1 / 8);
        const source = roomIdForFeed === roomId ? scene : feedSource!.scene;
        renderer.setRenderTarget(targets[index]);
        renderer.render(source, camera);
      });
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.shadowMap.autoUpdate = previousAutoUpdate;
      panel.visible = wasVisible;
    }
  }

  function getSource(roomId: string) {
    let source = sources.get(roomId);
    if (!source) {
      source = sourceFactories[roomId]?.() ?? { scene: new THREE.Scene() };
      sources.set(roomId, source);
    }
    return source;
  }

  return {
    update,
    dispose: () => {
      panel.removeFromParent();
      disposeObject(panel);
      targets.forEach(target => target.dispose());
      sources.forEach(source => source.dispose?.());
      sources.clear();
    },
  };
}
