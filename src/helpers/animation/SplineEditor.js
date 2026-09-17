import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class SplineEditor {
  constructor({ scene, camera, domElement, orbitControls, onChange, onSelect } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.orbitControls = orbitControls;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.curve = null;
    this.points = [];
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.draggedPoint = null;
    this.transformControls = new TransformControls(camera, domElement);
    this.transformControls.setMode('translate');
    this.scene.add(this.transformControls.getHelper());
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
    });
    this.transformControls.addEventListener('objectChange', () => {
      const handle = this.transformControls.object;
      if (!handle) return;
      const index = handle.userData.pointIndex;
      this.points[index].copy(handle.position);
      this.curve.points[index].copy(handle.position);
      this.curve.updateArcLengths();
      this.updateLine();
      this.onChange?.(this.getPoints());
    });
    this.domElement.addEventListener('pointerdown', (event) => this.beginDrag(event));
    this.domElement.addEventListener('pointerup', () => this.endDrag());
  }

  load(points) {
    this.clear();
    this.points = points.map((point) => new THREE.Vector3(...point));
    this.curve = new THREE.CatmullRomCurve3(this.points);
    this.points.forEach((point, index) => {
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xf2b880 }),
      );
      handle.position.copy(point);
      handle.userData.pointIndex = index;
      this.group.add(handle);
    });
    this.updateLine();
  }

  setVisible(visible) {
    this.group.visible = visible;
    if (!visible) {
      this.transformControls.detach();
      this.draggedPoint = null;
      this.orbitControls.enabled = true;
    }
  }

  getPoints() {
    return this.points.map((point) => point.toArray());
  }

  clear() {
    this.detachGizmo();
    this.group.clear();
    this.points = [];
    this.curve = null;
  }

  updateLine() {
    if (!this.curve) return;
    this.curve.updateArcLengths();
    const existingLine = this.group.getObjectByName('spline-line');
    if (existingLine) {
      existingLine.geometry.dispose();
      this.group.remove(existingLine);
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.curve.getPoints(48)),
      new THREE.LineBasicMaterial({ color: 0xf2b880 }),
    );
    line.name = 'spline-line';
    this.group.add(line);
  }

  beginDrag(event) {
    if (!this.group.visible) return;
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const handles = this.group.children.filter((child) => child.isMesh);
    const hit = this.raycaster.intersectObjects(handles)[0];
    if (!hit) return;
    this.draggedPoint = hit.object;
    this.onSelect?.();
    this.transformControls.attach(this.draggedPoint);
    event.stopImmediatePropagation();
  }

  detachGizmo() {
    this.transformControls.detach();
    this.draggedPoint = null;
  }

  endDrag() {
    if (!this.draggedPoint) return;
    if (!this.transformControls.dragging) this.draggedPoint = null;
  }

  setPointer(event) {
    const bounds = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  }
}
