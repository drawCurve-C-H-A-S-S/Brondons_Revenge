import * as THREE from 'three';
import { loadBossModel, loadDinoModel, loadMCModel, loadToolModel } from '../../core/loader.js';
import { createMothership } from '../../helpers/scene/mothership.js';
import { createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import { createLightsaber } from '../../scripts/items/createLightsaber.js';
import { createShipStatusTexture, createShipTerminal } from '../../helpers/scene/shipInterior.js';
import type { ExhibitKind } from './museumCatalog.js';

const FIGURE_HEIGHT = 0.9;

function metal(color: number, emissive = 0x000000, emissiveIntensity = 0) {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness: 0.45, metalness: 0.55 });
}
function glowing(color: number) { return new THREE.MeshBasicMaterial({ color, toneMapped: false }); }

/** Scale to the pedestal and rest the model on its base, centred. */
function fit(root: THREE.Object3D, height = FIGURE_HEIGHT) {
  const wrapper = new THREE.Group();
  wrapper.add(root);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const scale = height / Math.max(0.001, Math.max(size.y, size.x * 0.9, size.z * 0.9));
  root.scale.multiplyScalar(scale);
  const fitted = new THREE.Box3().setFromObject(root), center = fitted.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -fitted.min.y, -center.z);
  return wrapper;
}

function cctv() {
  const group = new THREE.Group(), body = metal(0xb8c2cc);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.26), body); group.add(shell);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 18), metal(0x10161c)); lens.rotation.z = Math.PI / 2; lens.position.x = 0.3; group.add(lens);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), glowing(0xff3030)); eye.position.x = 0.39; group.add(eye);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), body); arm.position.set(-0.1, -0.2, 0); group.add(arm);
  return group;
}

function crates() {
  const group = new THREE.Group(), wood = metal(0x8a6a38);
  for (const [x, y, z, s] of [[-0.22, 0.17, 0, 0.34], [0.2, 0.17, 0.02, 0.34], [0, 0.51, 0, 0.34]]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood); crate.position.set(x, y, z); group.add(crate);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(s + 0.01, 0.04, s + 0.01), metal(0x3a2a10)); strap.position.set(x, y, z); group.add(strap);
  }
  return group;
}

/** Breakable range target from the game: dark plate, white trim and a glowing blue core. */
function target() {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.18), new THREE.MeshStandardMaterial({ color: 0x334c59, roughness: 0.78, metalness: 0.3 }));
  group.add(plate);
  const trim = new THREE.MeshStandardMaterial({ color: 0xe1e8e9, metalness: 0.35, roughness: 0.65 });
  for (const [w, h, x, y] of [[0.88, 0.06, 0, 0.42], [0.88, 0.06, 0, -0.42], [0.06, 0.8, 0.42, 0], [0.06, 0.8, -0.42, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22), trim); bar.position.set(x, y, 0); group.add(bar);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 32), glowing(0x38bcff));
  core.rotation.x = Math.PI / 2; core.position.z = 0.11; group.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 36), glowing(0x8fdcff)); ring.position.z = 0.11; group.add(ring);
  return group;
}

function ironBars() {
  const group = new THREE.Group(), iron = new THREE.MeshStandardMaterial({ color: 0x3a2c24, roughness: 0.85, metalness: 0.75 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 1, metalness: 0.3 });
  for (let i = 0; i < 6; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.9, 10), i % 3 === 1 ? rust : iron);
    bar.position.set((i - 2.5) * 0.14, 0.45, 0); group.add(bar);
  }
  for (const y of [0.1, 0.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.07, 0.09), rust); rail.position.set(0, y, 0); group.add(rail);
  }
  return group;
}

function terminal() {
  const unit = createShipTerminal(createShipStatusTexture('AI FACILITY', ['SEQUENCE LOCKED', 'RESEARCH LOGS', 'POWER STAIRS']));
  unit.root.rotation.y = Math.PI; return unit.root;
}

/** Simple enemy fighter, matching the one flown in the Level 2 space battle. */
function enemyFighter() {
  const root = new THREE.Group(), hull = metal(0x674655);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 2.4), hull));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), glowing(0x55ff88)); eye.position.set(0, 0.22, -1.15); root.add(eye);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 1.3), hull); wing.position.set(side * 1.1, 0, 0.1); wing.rotation.z = side * 0.18; root.add(wing);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 1.6), glowing(0x55ff88)); gun.position.set(side * 1.65, 0, -0.5); root.add(gun);
  }
  const engine = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.8, 8), glowing(0x8877ff)); engine.rotation.x = -Math.PI / 2; engine.position.z = 2; root.add(engine);
  return root;
}

export type DisplayKind = 'enemyFighter' | 'mothership' | 'bigMech' | 'quadShell' | 'trilobite' | 'eyeDrone';

/** Small not-to-scale model for the enemy showcase stands. */
export async function createDisplayFigure(kind: DisplayKind, height = 1.2): Promise<THREE.Object3D> {
  switch (kind) {
    case 'enemyFighter': return fit(enemyFighter(), height);
    case 'mothership': { const ship = createMothership(); await ship.ready; ship.root.position.set(0, 0, 0); ship.root.scale.setScalar(1); ship.root.rotation.set(0, 0, 0); ship.root.children.filter(c => c instanceof THREE.Light).forEach(c => c.removeFromParent()); return fit(ship.root, height * 1.5); }
    case 'bigMech': return fit((await loadMCModel()).scene, height * 1.4);
    case 'quadShell': return fit((await loadToolModel('Enemy_QuadShell')).scene, height);
    case 'trilobite': return fit((await loadToolModel('Enemy_Trilobite')).scene, height);
    case 'eyeDrone': return fit((await loadToolModel('Enemy_EyeDrone')).scene, height);
  }
}

/** Builds the model displayed on the pedestal in front of a stage's painting. */
export async function createExhibitFigure(kind: ExhibitKind): Promise<THREE.Object3D> {
  switch (kind) {
    case 'eyeDrone': return fit((await loadToolModel('Enemy_EyeDrone')).scene);
    case 'trilobite': return fit((await loadToolModel('Enemy_Trilobite')).scene);
    case 'cctv': return fit(cctv());
    case 'crates': return fit(crates());
    case 'target': return fit(target());
    case 'ironBars': return fit(ironBars());
    case 'lightsaber': return fit(createLightsaber(), 0.9);
    case 'warden': return fit((await loadBossModel()).scene, 1.05);
    case 'ship': return fit(createEscapeShip().root);
    case 'dino': return fit((await loadDinoModel()).scene);
    case 'terminal': return fit(terminal());
    case 'mech': return fit((await loadMCModel()).scene, 1.15);
  }
}