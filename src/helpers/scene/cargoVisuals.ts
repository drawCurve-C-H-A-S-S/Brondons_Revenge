import * as THREE from 'three';
import type { createScenePhysics } from '../physics/scenePhysics.js';
import { beltFraction, beltMoving, type CargoPuzzleState } from '../../scripts/cargoPuzzle.js';
type Physics = ReturnType<typeof createScenePhysics>;
const steel = () => new THREE.MeshStandardMaterial({ color: 0x344b5b, roughness: 0.55, metalness: 0.65 });
export function cargoSign(scene: THREE.Scene, text: string, position: [number, number, number], width = 3, yaw = 0) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#10232d'; ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#cceef2'; ctx.font = 'bold 48px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 512, 82, 990);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.45), new THREE.MeshBasicMaterial({ map: texture }));
  mesh.position.set(...position); mesh.rotation.y = yaw; scene.add(mesh); return mesh;
}
export function createVentGate(scene: THREE.Scene, physics: Physics | null, side: number, open = false) {
  const root = new THREE.Group(); root.name = side > 0 ? 'VentGate10' : 'VentGate11'; root.position.set(side * 2, 0, 0); scene.add(root);
  const material = steel();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.34, 2.16), material); root.add(panel);
  const warning = new THREE.MeshStandardMaterial({ color: 0xffbd52, emissive: 0x683700, emissiveIntensity: 0.5 });
  for (const z of [-0.85, 0, 0.85]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.19, 1.3, 0.09), warning); band.position.z = z; panel.add(band);
  }
  const light = new THREE.PointLight(0xffae3d, 2, 3); light.position.set(-side * 0.5, 0.9, 0); root.add(light);
  const body = physics?.addBox({ x: 0.16, y: 1.34, z: 2.16 }, { x: side * 2, y: 0.67, z: 0 });
  function setProgress(value: number) {
    panel.position.y = 0.67 - value * 1.5;
    if (body) { body.position.y = panel.position.y; body.aabbNeedsUpdate = true; }
    warning.color.setHex(value >= 0.99 ? 0x6dffbd : 0xffbd52); light.color.copy(warning.color);
  }
  setProgress(open ? 1 : 0);
  return { root, panel, body, setProgress };
}
export function createConveyor(scene: THREE.Scene, physics: Physics, x: number, start: number, end: number,
  options: { yaw?: number; z?: number; spacing?: number } = {}) {
  const material = steel(), length = start - end;
  const group = new THREE.Group(); group.position.set(x, 0, options.z ?? 0); group.rotation.y = options.yaw ?? 0; scene.add(group);
  function localBox(size: [number, number, number], position: [number, number, number], mat: THREE.Material, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...position); mesh.receiveShadow = true; group.add(mesh);
    if (solid) physics.addBoxFromMesh(mesh);
    return mesh;
  }
  const belt = new THREE.MeshStandardMaterial({ color: 0x14232b, metalness: 0.25, roughness: 0.8 });
  localBox([2.1, 0.18, length], [0, 0.09, (start + end) / 2], belt, true).name = 'ConveyorSupport';
  for (const side of [-1, 1]) localBox([0.08, 0.2, length], [side * 1.08, 0.1, (start + end) / 2], material);
  const slats: THREE.Mesh[] = [];
  for (let z = end; z < start; z += 0.35) slats.push(localBox([2.05, 0.012, 0.07], [0, 0.187, z], material));
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffb34b, emissive: 0xff8a15, emissiveIntensity: 1.2 });
  localBox([0.1, 0.07, 0.35], [1.13, 0.25, (start + end) / 2], lamp);
  return { group, update(state: CargoPuzzleState) {
    const offset = beltFraction(state) * (options.spacing ?? 3);
    slats.forEach((slat, i) => { slat.position.z = end + ((i * 0.35 - offset) % length + length) % length; });
    lamp.color.setHex(beltMoving(state) ? 0xffbb55 : state.gravityRestored ? 0x6dffbd : 0xff5555); lamp.emissive.copy(lamp.color);
  } };
}
/** Cargo is scripted through the mouth; the permanent collider excludes actors. */
export function createCargoMouth(scene: THREE.Scene, physics: Physics, x: number, z: number, yaw = 0) {
  const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = yaw; scene.add(group); group.name = 'CargoOnlyMouth';
  const mat = steel(), jaws: THREE.Group[] = [];
  const inner = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 0.6), new THREE.MeshBasicMaterial({ color: 0x010408 })); inner.position.y = 1.2; group.add(inner);
  for (const top of [false, true]) {
    const jaw = new THREE.Group(); jaw.position.set(0, top ? 2.4 : 0.05, 0.35); group.add(jaw); jaws.push(jaw);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.2, 0.18), mat); panel.position.y = top ? -0.6 : 0.6; jaw.add(panel);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.09, 0.2), new THREE.MeshStandardMaterial({ color: 0xe8b04b })); stripe.position.y = top ? -1.13 : 1.13; jaw.add(stripe);
  }
  const blocker = physics.addBox({ x: 2.8, y: 3, z: 0.4 }, { x, y: 1.5, z });
  blocker.quaternion.setFromEuler(0, yaw, 0); blocker.aabbNeedsUpdate = true;
  return { group, blocker, update(open: number) { jaws[0].rotation.x = -open * Math.PI * 0.48; jaws[1].rotation.x = open * Math.PI * 0.48; } };
}
export function createHandle() {
  const root = new THREE.Group(); root.name = 'SwitchHandle';
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 10), steel()); stem.position.y = 0.22; root.add(stem);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.13, 0.13), new THREE.MeshStandardMaterial({ color: 0xffc564 })); grip.position.y = 0.5; root.add(grip); return root;
}
export function createLever(scene: THREE.Scene, physics: Physics, x: number, z: number, label: string, yaw = 0) {
  const root = new THREE.Group(); root.position.set(x, 1.1, z); root.rotation.y = yaw; scene.add(root);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.9, 0.18), steel()); root.add(base);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x020508 })); socket.rotation.x = Math.PI / 2; socket.position.z = 0.16; root.add(socket);
  const handle = createHandle(); handle.position.z = 0.2; root.add(handle);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffbb55, emissive: 0xff9911 });
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.04), lightMat); light.position.set(0, 0.34, 0.12); root.add(light);
  physics.addBoxFromMesh(base);
  cargoSign(scene, label, [x, 2.05, z + Math.cos(yaw) * 0.2], 3.4, yaw);
  return { root, handle, position: root.position, update(installed: boolean, on: boolean) {
    handle.visible = installed; handle.rotation.x = on ? -0.7 : 0.7;
    lightMat.color.setHex(on ? 0x72ffb4 : installed ? 0xffbb55 : 0xff5555); lightMat.emissive.copy(lightMat.color);
  } };
}
export function createSpikePlate(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'SpikePressurePlate'; scene.add(root);
  const material = new THREE.MeshStandardMaterial({ color: 0xffb04b, emissive: 0x623600, emissiveIntensity: 0.7 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.035, 2.1), material); plate.position.y = 0.025; root.add(plate);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.04, 2.18), steel()); lid.position.y = 0.052; root.add(lid);
  const spike = new THREE.Group(); spike.name = 'FloorSwitchSpikeArray'; root.add(spike);
  const spikeGeometry = new THREE.ConeGeometry(0.075, 0.62, 8), spikeMaterial = steel();
  const socketGeometry = new THREE.RingGeometry(0.075, 0.11, 12);
  const socketMaterial = new THREE.MeshBasicMaterial({ color: 0x10151a, side: THREE.DoubleSide });
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    const tooth = new THREE.Mesh(spikeGeometry, spikeMaterial); tooth.position.set(x * 0.36, 0, z * 0.36); tooth.castShadow = true; spike.add(tooth);
    const socket = new THREE.Mesh(socketGeometry, socketMaterial); socket.rotation.x = -Math.PI / 2; socket.position.set(x * 0.36, 0.023, z * 0.36); plate.add(socket);
  }
  return { root, plate, lid, spike, update(reveal: number, extension: number, solved = false) {
    lid.position.x = -reveal * 2.3; lid.visible = reveal < 1;
    plate.visible = reveal > 0; spike.visible = reveal > 0 && extension > 0; spike.position.y = -0.27 + extension * 0.62;
    material.color.setHex(solved ? 0x67ffb0 : 0xffb04b); material.emissive.copy(material.color);
  } };
}
