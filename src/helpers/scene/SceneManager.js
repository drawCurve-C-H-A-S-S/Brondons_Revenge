import * as THREE from 'three';
import { validateScene } from './sceneSchema.js';

const MANAGED_OBJECTS = 'managed-scene-objects';

export class SceneManager {
  constructor(scene, { onSceneChanged } = {}) {
    this.scene = scene;
    this.onSceneChanged = onSceneChanged;
    this.scenes = new Map();
    this.activeSceneId = null;
    this.history = [];
    this.future = [];
    this.editTransaction = false;
    this.objectMeshes = new Map();
    this.sceneJSON = null;
  }

  loadFromJSON(sceneJSON) {
    validateScene(sceneJSON);
    this.clearObjects();

    for (const objectJSON of sceneJSON.objects) {
      const mesh = this.createMesh(objectJSON);
      mesh.userData.sceneObjectId = objectJSON.id;
      mesh.userData.sceneObject = objectJSON;
      mesh.name = objectJSON.name || objectJSON.id;
      this.objectMeshes.set(objectJSON.id, mesh);
      this.scene.add(mesh);
    }

    this.sceneJSON = structuredClone(sceneJSON);
    return this.sceneJSON;
  }

  registerScene(id, sceneJSON) {
    validateScene(sceneJSON);
    this.scenes.set(id, structuredClone(sceneJSON));
  }

  switchTo(id) {
    const sceneJSON = this.scenes.get(id);
    if (!sceneJSON) throw new Error(`Unknown scene: ${id}`);
    if (this.activeSceneId && this.sceneJSON) {
      this.scenes.set(this.activeSceneId, this.exportJSON());
    }
    this.loadFromJSON(sceneJSON);
    this.activeSceneId = id;
    this.onSceneChanged?.(id, this.sceneJSON);
    return this.sceneJSON;
  }

  getActiveSceneId() {
    return this.activeSceneId;
  }

  exportJSON() {
    if (!this.sceneJSON) {
      return null;
    }

    const exported = structuredClone(this.sceneJSON);
    exported.objects = [...this.objectMeshes.entries()].map(([id, mesh]) => ({
      ...this.sceneJSON.objects.find((objectJSON) => objectJSON.id === id),
      position: mesh.position.toArray(),
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: mesh.scale.toArray(),
    }));
    return exported;
  }

  getMesh(id) {
    return this.objectMeshes.get(id);
  }

  updateObjectTransform(id, transform) {
    const mesh = this.getMesh(id);
    if (!mesh) {
      throw new Error(`Unknown scene object: ${id}`);
    }

    if (!this.editTransaction) this.recordHistory();
    if (transform.position) mesh.position.fromArray(transform.position);
    if (transform.rotation) mesh.rotation.set(...transform.rotation);
    if (transform.scale) mesh.scale.fromArray(transform.scale);
  }

  updateSplinePoints(id, points) {
    const spline = this.sceneJSON?.splines?.find((entry) => entry.id === id);
    if (!spline) throw new Error(`Unknown spline: ${id}`);
    if (!this.editTransaction) this.recordHistory();
    spline.points = structuredClone(points);
  }

  addSplinePoint(id, point) {
    const spline = this.sceneJSON?.splines?.find((entry) => entry.id === id);
    if (!spline) throw new Error(`Unknown spline: ${id}`);
    this.recordHistory();
    spline.points.push(structuredClone(point));
  }

  removeSplinePoint(id, index) {
    const spline = this.sceneJSON?.splines?.find((entry) => entry.id === id);
    if (!spline || spline.points.length <= 2) return false;
    this.recordHistory();
    spline.points.splice(index, 1);
    return true;
  }

  updateCutscene(id, settings) {
    const cutscene = this.sceneJSON?.cutscenes?.find((entry) => entry.id === id);
    if (!cutscene) throw new Error(`Unknown cutscene: ${id}`);
    this.recordHistory();
    Object.assign(cutscene, structuredClone(settings));
  }

  removeCutscene(id) {
    const index = this.sceneJSON?.cutscenes?.findIndex((entry) => entry.id === id) ?? -1;
    if (index < 0) return false;
    this.recordHistory();
    const [cutscene] = this.sceneJSON.cutscenes.splice(index, 1);
    const linkedPaths = new Set((cutscene.tracks || []).map((track) => track.path).filter(Boolean));
    this.sceneJSON.splines = (this.sceneJSON.splines || []).filter((spline) => !linkedPaths.has(spline.id));
    return true;
  }

  addCutscene(cutscene, spline) {
    if (!this.editTransaction) this.recordHistory();
    this.sceneJSON.splines = [...(this.sceneJSON.splines || []), structuredClone(spline)];
    this.sceneJSON.cutscenes = [...(this.sceneJSON.cutscenes || []), structuredClone(cutscene)];
  }

  addTrigger(trigger) {
    if (!this.editTransaction) this.recordHistory();
    this.sceneJSON.triggers = [...(this.sceneJSON.triggers || []), structuredClone(trigger)];
  }

  updateTrigger(id, settings) {
    const trigger = this.sceneJSON?.triggers?.find((entry) => entry.id === id);
    if (!trigger) throw new Error(`Unknown trigger: ${id}`);
    this.recordHistory();
    Object.assign(trigger, structuredClone(settings));
  }

  removeTrigger(id) {
    const index = this.sceneJSON?.triggers?.findIndex((entry) => entry.id === id) ?? -1;
    if (index < 0) return false;
    this.recordHistory();
    this.sceneJSON.triggers.splice(index, 1);
    return true;
  }

  updateAudio(settings) {
    if (!this.editTransaction) this.recordHistory();
    this.sceneJSON.audio = { ...(this.sceneJSON.audio || { bgm: null, emitters: [] }), ...structuredClone(settings) };
  }

  addAudioEmitter(emitter) {
    if (!this.editTransaction) this.recordHistory();
    const audio = this.sceneJSON.audio || { bgm: null, emitters: [] };
    audio.emitters = [...(audio.emitters || []), structuredClone(emitter)];
    this.sceneJSON.audio = audio;
  }

  updateAudioEmitter(id, settings) {
    const emitter = this.sceneJSON?.audio?.emitters?.find((entry) => entry.id === id);
    if (!emitter) throw new Error(`Unknown audio emitter: ${id}`);
    if (!this.editTransaction) this.recordHistory();
    Object.assign(emitter, structuredClone(settings));
  }

  removeAudioEmitter(id) {
    const emitters = this.sceneJSON?.audio?.emitters;
    const index = emitters?.findIndex((entry) => entry.id === id) ?? -1;
    if (index < 0) return false;
    this.recordHistory();
    emitters.splice(index, 1);
    return true;
  }

  updateObjectProperties(id, properties) {
    const objectJSON = this.sceneJSON?.objects?.find((entry) => entry.id === id);
    const mesh = this.getMesh(id);
    if (!objectJSON || !mesh) throw new Error(`Unknown scene object: ${id}`);
    if (!this.editTransaction) this.recordHistory();
    if (properties.material) {
      objectJSON.material = { ...(objectJSON.material || {}), ...structuredClone(properties.material) };
      if (properties.material.type && properties.material.type !== mesh.material.type) {
        const previousMaterial = mesh.material;
        mesh.material = this.createMaterial(objectJSON.material);
        previousMaterial.dispose();
      }
      if (properties.material.color) mesh.material.color.set(properties.material.color);
      if (properties.material.roughness !== undefined) mesh.material.roughness = properties.material.roughness;
      if (properties.material.metalness !== undefined) mesh.material.metalness = properties.material.metalness;
      if (properties.material.emissive) mesh.material.emissive.set(properties.material.emissive);
      if (properties.material.emissiveIntensity !== undefined) mesh.material.emissiveIntensity = properties.material.emissiveIntensity;
      if (properties.material.opacity !== undefined) mesh.material.opacity = properties.material.opacity;
      if (properties.material.transparent !== undefined) mesh.material.transparent = properties.material.transparent;
      if (properties.material.wireframe !== undefined) mesh.material.wireframe = properties.material.wireframe;
      if (properties.material.flatShading !== undefined) mesh.material.flatShading = properties.material.flatShading;
      if (properties.material.vertexShader !== undefined) mesh.material.vertexShader = properties.material.vertexShader;
      if (properties.material.fragmentShader !== undefined) mesh.material.fragmentShader = properties.material.fragmentShader;
      mesh.material.needsUpdate = true;
    }
    if (properties.physics) objectJSON.physics = { ...(objectJSON.physics || {}), ...structuredClone(properties.physics) };
  }

  renameObject(id, name) {
    const objectJSON = this.sceneJSON?.objects?.find((entry) => entry.id === id);
    const mesh = this.getMesh(id);
    if (!objectJSON || !mesh) throw new Error(`Unknown scene object: ${id}`);
    this.recordHistory();
    objectJSON.name = name.trim() || objectJSON.id;
    mesh.name = objectJSON.name;
  }

  renameSceneItem(type, id, name) {
    const nextName = name.trim() || id;
    if (type === 'object') return this.renameObject(id, nextName);
    const collection = type === 'light' ? this.sceneJSON?.lights : type === 'camera' ? this.sceneJSON?.cameras : type === 'spline' ? this.sceneJSON?.splines : type === 'trigger' ? this.sceneJSON?.triggers : this.sceneJSON?.cutscenes;
    const item = collection?.find((entry) => entry.id === id);
    if (!item) throw new Error(`Unknown scene item: ${id}`);
    this.recordHistory();
    item.name = nextName;
    return nextName;
  }

  duplicateObject(id, duplicate) {
    const source = this.sceneJSON?.objects?.find((entry) => entry.id === id);
    if (!source) throw new Error(`Unknown scene object: ${id}`);
    this.recordHistory();
    return this.addObject({ ...structuredClone(source), ...structuredClone(duplicate) });
  }

  addObject(objectJSON) {
    if (this.objectMeshes.has(objectJSON.id)) throw new Error(`Object already exists: ${objectJSON.id}`);
    if (!this.editTransaction) this.recordHistory();
    const mesh = this.createMesh(objectJSON);
    mesh.userData.sceneObjectId = objectJSON.id;
    mesh.userData.sceneObject = objectJSON;
    mesh.name = objectJSON.name || objectJSON.id;
    this.objectMeshes.set(objectJSON.id, mesh);
    this.sceneJSON.objects.push(structuredClone(objectJSON));
    this.scene.add(mesh);
    return mesh;
  }

  addLight(lightJSON) {
    if (!this.editTransaction) this.recordHistory();
    this.sceneJSON.lights = [...(this.sceneJSON.lights || []), structuredClone(lightJSON)];
  }

  addCamera(cameraJSON) {
    if (!this.editTransaction) this.recordHistory();
    this.sceneJSON.cameras = [...(this.sceneJSON.cameras || []), structuredClone(cameraJSON)];
  }

  updateCameraById(id, cameraSettings) {
    const camera = this.sceneJSON?.cameras?.find((entry) => entry.id === id);
    if (!camera) throw new Error(`Unknown scene camera: ${id}`);
    this.recordHistory();
    Object.assign(camera, structuredClone(cameraSettings));
  }

  attachCamera(id, parentId = null) {
    const camera = this.sceneJSON?.cameras?.find((entry) => entry.id === id);
    if (!camera) throw new Error(`Unknown scene camera: ${id}`);
    this.recordHistory();
    if (parentId) camera.parent = parentId;
    else delete camera.parent;
  }

  removeObject(id) {
    const mesh = this.objectMeshes.get(id);
    if (!mesh) return false;
    this.recordHistory();
    this.scene.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    this.objectMeshes.delete(id);
    this.sceneJSON.objects = this.sceneJSON.objects.filter((objectJSON) => objectJSON.id !== id);
    return true;
  }

  removeLight(id) {
    const index = this.sceneJSON?.lights?.findIndex((entry) => entry.id === id) ?? -1;
    if (index < 0) return false;
    this.recordHistory();
    this.sceneJSON.lights.splice(index, 1);
    return true;
  }

  updateCamera(cameraSettings) {
    if (!this.sceneJSON?.camera) throw new Error('Scene camera is not defined.');
    this.recordHistory();
    this.sceneJSON.camera = { ...this.sceneJSON.camera, ...structuredClone(cameraSettings) };
  }

  updateLight(id, lightSettings) {
    const light = this.sceneJSON?.lights?.find((entry) => entry.id === id);
    if (!light) throw new Error(`Unknown scene light: ${id}`);
    this.recordHistory();
    Object.assign(light, structuredClone(lightSettings));
  }

  recordHistory() {
    if (!this.sceneJSON) return;
    this.history.push(this.exportJSON());
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  beginEdit() {
    if (this.editTransaction) return;
    this.recordHistory();
    this.editTransaction = true;
  }

  endEdit() {
    this.editTransaction = false;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous || !this.sceneJSON) return null;
    this.future.push(this.exportJSON());
    this.loadFromJSON(previous);
    return this.sceneJSON;
  }

  redo() {
    const next = this.future.pop();
    if (!next || !this.sceneJSON) return null;
    this.history.push(this.exportJSON());
    this.loadFromJSON(next);
    return this.sceneJSON;
  }

  clearObjects() {
    for (const mesh of this.objectMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.objectMeshes.clear();
  }

  createMesh(objectJSON) {
    const geometry = objectJSON.type === 'plane'
      ? new THREE.PlaneGeometry(30, 30)
      : objectJSON.type === 'sphere'
        ? new THREE.SphereGeometry(0.7, 24, 16)
        : objectJSON.type === 'cylinder'
          ? new THREE.CylinderGeometry(0.6, 0.6, 1.4, 24)
          : objectJSON.type === 'cone'
            ? new THREE.ConeGeometry(0.7, 1.4, 24)
            : objectJSON.type === 'torus'
              ? new THREE.TorusGeometry(0.7, 0.22, 12, 32)
              : new THREE.BoxGeometry(1, 1, 1);
    const material = this.createMaterial(objectJSON.material || {});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(objectJSON.position || [0, 0, 0]);
    mesh.rotation.set(...(objectJSON.rotation || [0, 0, 0]));
    mesh.scale.fromArray(objectJSON.scale || [1, 1, 1]);
    mesh.castShadow = objectJSON.type !== 'plane';
    mesh.receiveShadow = true;
    mesh.userData[MANAGED_OBJECTS] = true;
    return mesh;
  }

  createMaterial(materialJSON) {
    const options = {
      color: materialJSON.color || '#ffffff',
      roughness: materialJSON.roughness ?? 0.5,
      metalness: materialJSON.metalness ?? 0,
      emissive: materialJSON.emissive || '#000000',
      emissiveIntensity: materialJSON.emissiveIntensity ?? 1,
      opacity: materialJSON.opacity ?? 1,
      transparent: materialJSON.transparent ?? false,
      wireframe: materialJSON.wireframe ?? false,
      flatShading: materialJSON.flatShading ?? false,
    };
    if (materialJSON.type === 'ShaderMaterial' || materialJSON.type === 'RawShaderMaterial') {
      return new THREE[materialJSON.type]({
        vertexShader: materialJSON.vertexShader || DEFAULT_VERTEX_SHADER,
        fragmentShader: materialJSON.fragmentShader || DEFAULT_FRAGMENT_SHADER,
        transparent: options.transparent,
        opacity: options.opacity,
        wireframe: options.wireframe,
      });
    }
    const MaterialClass = THREE[materialJSON.type] || THREE.MeshStandardMaterial;
    return new MaterialClass(options);
  }
}

const DEFAULT_VERTEX_SHADER = `void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DEFAULT_FRAGMENT_SHADER = `void main() {
  gl_FragColor = vec4(0.2, 0.6, 1.0, 1.0);
}`;
