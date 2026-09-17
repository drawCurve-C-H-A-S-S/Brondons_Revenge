export const SCENE_SCHEMA_VERSION = 1;

export function createDefaultScene() {
  return {
    version: SCENE_SCHEMA_VERSION,
    id: 'main-scene',
    metadata: {
      name: 'Main Scene',
    },
    camera: {
      position: [3.8, 2.8, 5.5],
      target: [0, 0.6, 0],
    },
    cameras: [],
    lights: [
      { id: 'ambient-01', name: 'Ambient Light', type: 'hemisphere', skyColor: '#dceeff', groundColor: '#27313a', intensity: 2.2 },
      { id: 'key-01', name: 'Key Light', type: 'directional', color: '#ffd6a0', intensity: 3.5, position: [4, 6, 3], castShadow: true },
    ],
    objects: [
      {
        id: 'floor',
        name: 'Floor',
        type: 'plane',
        position: [0, 0, 0],
        rotation: [-Math.PI / 2, 0, 0],
        scale: [1, 1, 1],
        material: { color: '#26343b', roughness: 0.8, metalness: 0 },
        physics: { enabled: true, mass: 0, collider: 'box', size: [30, 0.2, 30], position: [0, -0.1, 0], rotation: [0, 0, 0] },
      },
    ],
    splines: [],
    cutscenes: [],
    triggers: [],
    audio: {
      bgm: null,
      emitters: [],
    },
  };
}

export function validateScene(sceneJSON) {
  if (!sceneJSON || typeof sceneJSON !== 'object') {
    throw new TypeError('Scene data must be an object.');
  }
  if (sceneJSON.version !== SCENE_SCHEMA_VERSION) {
    throw new Error(`Unsupported scene schema version: ${sceneJSON.version}`);
  }
  if (!Array.isArray(sceneJSON.objects)) {
    throw new TypeError('Scene objects must be an array.');
  }
  return true;
}
