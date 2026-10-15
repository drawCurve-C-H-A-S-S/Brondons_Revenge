import * as THREE from 'three';

export const CREW_CHEST_SIZE = { x: 1.32, y: 0.68, z: 0.82 };

export function createCrewChest(accent = 0x6ad9e8) {
  const root = new THREE.Group(); root.name = 'CrewFootlocker';
  const steel = new THREE.MeshStandardMaterial({ color: 0x293746, roughness: 0.6, metalness: 0.65 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b111b, roughness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4 });
  function box(parent: THREE.Object3D, name: string, size: [number, number, number],
    position: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name; mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  }
  box(root, 'ChestBase', [1.3, 0.55, 0.8], [0, 0.275, 0], steel);
  box(root, 'ChestInterior', [1.15, 0.035, 0.64], [0, 0.558, 0], dark);
  box(root, 'ChestLatch', [0.18, 0.18, 0.035], [0, 0.45, -0.42], pale);
  const lidPivot = new THREE.Group(); lidPivot.name = 'ChestLidPivot'; lidPivot.position.set(0, 0.55, 0.4);
  root.add(lidPivot);
  box(lidPivot, 'ChestLid', [1.32, 0.12, 0.82], [0, 0.06, -0.4], steel);
  box(lidPivot, 'ChestLidAccent', [1, 0.022, 0.025], [0, 0.128, -0.4], glow);
  let openness = 0;
  return {
    root, lidPivot,
    get openness() { return openness; },
    update(dt: number, open: boolean, immediate = false) {
      openness = immediate ? Number(open) : THREE.MathUtils.clamp(openness + (open ? 1 : -1) * dt * 1.7, 0, 1);
      lidPivot.rotation.x = openness * 1.38;
    },
  };
}
