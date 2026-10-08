import * as THREE from 'three';
import { loadToolModel } from '../../core/loader.js';
import { createScenePhysics } from '../../helpers/physics/scenePhysics.js';
import { cabinCenter, cabinPoint, type CabinDefinition, type QuartersProgress } from './layout.js';
import { createRescueDesktop, drawDesktopBackground } from './surfaces.js';
import { createCrewChest } from '../../helpers/scene/crewChest.js';
import { createGoggles } from '../../scripts/rewardChest.js';
import { createTeleportCrystal } from '../../scripts/teleportationDevice.js';
import { createShipTerminal } from '../../helpers/scene/shipInterior.js';

type Physics = ReturnType<typeof createScenePhysics>;
export type CabinProp = 'Prop_Desk_Small' | 'Prop_Chair' | 'Gun_Revolver';
export type CabinModelLoader = (name: CabinProp) => Promise<{ scene: THREE.Group }>;

export function disposeQuartersObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
  root.removeFromParent();
}

export function shipLabelTexture(lines: readonly string[], accent: number, width = 512, height = 256) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw living quarters signage');
  const color = `#${new THREE.Color(accent).getHexString()}`;
  context.fillStyle = '#101c2a'; context.fillRect(0, 0, width, height);
  context.fillStyle = color; context.fillRect(20, 20, 8, height - 40);
  context.strokeStyle = '#394b61'; context.lineWidth = 2; context.strokeRect(38, 20, width - 58, height - 40);
  context.textAlign = 'left'; context.textBaseline = 'middle';
  lines.forEach((line, index) => {
    context.fillStyle = index === 0 ? color : '#d7e4eb';
    context.font = `${index === 0 ? 'bold ' : ''}${Math.min(32, (width - 82) / Math.max(line.length, 1) * 1.55)}px monospace`;
    context.fillText(line, 52, 40 + (height - 80) * (index + 0.5) / lines.length);
  });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function cabinNameTexture(name: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw cabin nameplates');
  context.fillStyle = '#182431'; context.fillRect(0, 0, 512, 128);
  context.fillStyle = '#e4eaf0'; context.font = '44px sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(name, 256, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function desktopTexture(cabin: CabinDefinition) {
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 450;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw cabin desktop screens');
  drawDesktopBackground(context);
  context.textAlign = 'center'; context.font = '18px sans-serif';
  for (const [index, title] of ['Files', 'Survey', 'Mail'].entries()) {
    const y = 45 + index * 106;
    context.fillStyle = '#84c3eb'; context.fillRect(47, y + 7, 46, 31); context.fillRect(47, y, 22, 11);
    context.fillStyle = '#dceffc'; context.fillText(title, 70, y + 62);
  }
  context.fillStyle = '#061425'; context.fillRect(206, 62, 555, 326);
  context.fillStyle = '#122c47'; context.fillRect(196, 52, 555, 326);
  context.strokeStyle = '#5f9ec7'; context.strokeRect(196, 52, 555, 326);
  context.fillStyle = '#245379'; context.fillRect(197, 53, 553, 34);
  context.textAlign = 'left'; context.fillStyle = '#e6f4fe'; context.font = '20px sans-serif';
  context.fillText(`${cabin.occupant} - Desktop`, 212, 77);
  context.fillText('-', 687, 77); context.fillText('x', 726, 77);
  context.fillStyle = '#10243b'; context.fillRect(197, 87, 144, 289);
  context.fillStyle = '#8bbcdc'; context.font = '18px sans-serif';
  for (const [index, title] of ['Home', 'Local files', 'Notes', 'Archive'].entries()) context.fillText(title, 215, 124 + index * 44);
  context.fillStyle = '#dceffc'; context.font = 'bold 22px sans-serif'; context.fillText('Expedition files', 360, 124);
  context.font = '18px monospace';
  for (const [index, title] of ['survey-notes.txt', 'route-sketch.dat', 'crew-roster.txt', 'sample-log.dat'].entries()) {
    const y = 148 + index * 49;
    context.fillStyle = index % 2 ? '#173750' : '#1b3e5a'; context.fillRect(354, y, 378, 39);
    context.fillStyle = '#8ad4f5'; context.fillRect(365, y + 10, 13, 18);
    context.fillStyle = '#dceffc'; context.fillText(title, 390, y + 26);
    context.fillStyle = '#6a9cbc'; context.fillRect(682, y + 17, 32, 3);
  }
  context.fillStyle = '#082038'; context.fillRect(0, 408, 800, 42);
  context.fillStyle = '#9bdbff'; context.fillRect(18, 421, 19, 17);
  for (const x of [66, 109, 152]) {
    context.fillStyle = '#224b6a'; context.fillRect(x, 416, 32, 29);
    context.fillStyle = '#76bae1'; context.fillRect(x + 8, 424, 16, 12);
  }
  context.textAlign = 'right'; context.fillStyle = '#b4d6ed'; context.font = '16px sans-serif';
  context.fillText('LOCAL ONLY', 699, 435); context.fillText('06:42', 782, 435);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `CrewDesktop-${cabin.id}`;
  return texture;
}

function posterTexture(cabin: CabinDefinition) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 768;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw expedition posters');
  const accent = `#${new THREE.Color(cabin.accent).getHexString()}`;
  context.fillStyle = '#0b1524'; context.fillRect(0, 0, 512, 768);
  context.strokeStyle = accent; context.lineWidth = 3; context.strokeRect(24, 24, 464, 720);
  for (let index = 0; index < 55; index++) {
    context.fillStyle = index % 3 ? '#91a9c1' : accent;
    context.fillRect(42 + (index * 83 % 424), 52 + (index * 139 % 300), index % 4 ? 2 : 4, 2);
  }
  context.fillStyle = accent; context.beginPath(); context.arc(256, 238, 103, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#122c40'; context.beginPath(); context.arc(284, 216, 86, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#e2ebee'; context.beginPath(); context.ellipse(256, 238, 165, 32, -0.32, 0, Math.PI * 2); context.stroke();
  context.textAlign = 'center'; context.fillStyle = accent; context.font = 'bold 28px monospace';
  const lines: string[] = [];
  let line = '';
  for (const word of cabin.quote.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > 408 && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  lines.forEach((text, index) => context.fillText(text, 256, 438 + index * 40));
  context.fillStyle = '#91a9c1'; context.font = '19px monospace';
  context.fillText(`${cabin.code} / ${cabin.occupant.toUpperCase()}`, 256, 706);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function fitCabinProp(model: THREE.Group, height: number, maxWidth: number, maxDepth: number, yaw = 0) {
  model.rotation.y = yaw;
  let bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.toArray().some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Cabin prop has invalid dimensions');
  model.scale.multiplyScalar(Math.min(height / size.y, maxWidth / size.x, maxDepth / size.z));
  bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
  model.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
  return bounds.getSize(new THREE.Vector3());
}

export async function createCabinFurnishings(cabin: CabinDefinition, physics: Physics, progress: QuartersProgress,
  load: CabinModelLoader = loadToolModel) {
  const names: CabinProp[] = ['Prop_Desk_Small', 'Prop_Chair', ...(cabin.id === 'brondon' ? ['Gun_Revolver' as const] : [])];
  const results = await Promise.allSettled(names.map(load));
  const models = results.flatMap(result => result.status === 'fulfilled' ? [result.value.scene] : []);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    models.forEach(disposeQuartersObject);
    throw new Error(`Cabin props failed to load: ${failed.reason instanceof Error ? failed.reason.message : String(failed.reason)}`);
  }
  const root = new THREE.Group(); root.name = `CabinFurnishings-${cabin.id}`; root.position.copy(cabinCenter(cabin));
  const bodies: ReturnType<Physics['addBox']>[] = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0x293746, roughness: 0.6, metalness: 0.65 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xbfcad0, roughness: 0.8, metalness: 0.1 });
  const fabric = new THREE.MeshStandardMaterial({ color: cabin.accent, roughness: 0.95 });
  const glow = new THREE.MeshStandardMaterial({ color: cabin.accent, emissive: cabin.accent, emissiveIntensity: 1.5 });
  function box(parent: THREE.Object3D, name: string, size: [number, number, number], at: [number, number, number], material = steel) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.name = name; mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function collider(size: THREE.Vector3, point: THREE.Vector3) {
    bodies.push(physics.addBox(size, point));
  }
  try {
    const bed = new THREE.Group(); bed.name = 'CabinBed'; bed.position.set(cabin.side * 1.65, 0, -1.7); root.add(bed);
    box(bed, 'BedFrame', [1.6, 0.37, 2.45], [0, 0.255, 0]);
    box(bed, 'Mattress', [1.48, 0.18, 2.28], [0, 0.53, 0], pale);
    box(bed, 'ExpeditionBlanket', [1.5, 0.06, 1.65], [0, 0.645, 0.3], fabric);
    box(bed, 'Pillow', [0.98, 0.13, 0.4], [0, 0.68, -0.84], pale);
    box(bed, 'BedStatusStrip', [1.2, 0.025, 0.025], [0, 0.29, 1.24], glow);
    collider(new THREE.Vector3(1.6, 0.66, 2.45), cabinPoint(cabin, 1.65, 0.33, -1.7));

    const desk = models[0]; desk.name = 'CabinDesk';
    const deskSize = fitCabinProp(desk, 0.84, 2.2, 1.02);
    desk.position.add(new THREE.Vector3(cabin.side * -0.55, 0, 2.65)); root.add(desk);
    collider(deskSize, cabinPoint(cabin, -0.55, deskSize.y / 2, 2.65));
    const chair = models[1]; chair.name = 'CabinChair';
    const chairSize = fitCabinProp(chair, 1.12, 0.75, 0.85, Math.PI);
    chair.position.add(new THREE.Vector3(cabin.side * -0.55, 0, 1.65)); root.add(chair);
    collider(chairSize, cabinPoint(cabin, -0.55, chairSize.y / 2, 1.65));

    const desktop = cabin.id === 'branden' ? createRescueDesktop(progress) : null;
    const terminal = createShipTerminal(desktop?.texture ?? desktopTexture(cabin)), computer = terminal.root, screen = terminal.screen;
    computer.name = 'CabinComputer'; screen.name = 'CabinComputerScreen';
    computer.position.set(cabin.side * -0.55, deskSize.y, 2.75); root.add(computer);

    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.03, 1.55),
      new THREE.MeshBasicMaterial({ map: posterTexture(cabin), toneMapped: false }));
    poster.name = 'ExpeditionPoster'; poster.position.set(cabin.side * -0.25, 1.88, -3.29); root.add(poster);
    box(root, 'PosterFrame', [1.12, 1.64, 0.055], [cabin.side * -0.25, 1.88, -3.32]);
    const light = new THREE.PointLight(cabin.accent, 4, 7.5, 1.5);
    light.position.set(0, 2.8, 0); root.add(light);

    const footlocker = createCrewChest(cabin.accent), chest = footlocker.root, lidPivot = footlocker.lidPivot;
    chest.position.set(cabin.side * 1.7, 0, 0.65); chest.rotation.y = cabin.side * Math.PI / 2;
    if (cabin.role === 'lecturer') {
      root.add(chest);
      collider(new THREE.Vector3(0.82, 0.68, 1.32), cabinPoint(cabin, 1.7, 0.34, 0.65));
    }
    const pistol = models[2];
    if (pistol) {
      pistol.name = 'RecoveredPistol'; fitCabinProp(pistol, 0.15, 0.57, 0.24);
      pistol.position.y += 0.58; chest.add(pistol);
    }
    const crystal = cabin.id === 'brendan' ? createTeleportCrystal() : null;
    if (crystal) { crystal.position.y = 0.85; chest.add(crystal); }
    const goggles = cabin.id === 'branden' ? createGoggles() : null;
    if (goggles) { goggles.position.y = 0.69; goggles.scale.setScalar(1.7); chest.add(goggles); }

    const teleporter = new THREE.Group(); teleporter.name = 'PersonalTeleportDevice';
    if (cabin.id === 'brondon') {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), glow);
      teleporter.position.set(cabin.side * -1.12, deskSize.y + 0.035, 2.41); root.add(teleporter);
      box(teleporter, 'TeleporterCasing', [0.19, 0.07, 0.13], [0, 0, 0]);
      box(teleporter, 'TeleporterInset', [0.13, 0.006, 0.08], [0, 0.039, 0], pale);
      led.position.set(0.045, 0.05, 0); teleporter.add(led);
    }
    footlocker.update(0, progress.openedChests.has(cabin.id), true);
    function update(dt: number, clock: number) {
      const open = progress.openedChests.has(cabin.id);
      footlocker.update(dt, open);
      if (pistol) pistol.visible = footlocker.openness > 0.15 && !progress.pistolCollected;
      if (crystal) {
        crystal.visible = footlocker.openness > 0.15 && !progress.crystalCollected;
        crystal.rotation.y = clock * 1.4; crystal.position.y = 0.85 + Math.sin(clock * 2) * 0.045;
      }
      if (goggles) goggles.visible = footlocker.openness > 0.15 && !progress.gogglesCollected;
      teleporter.visible = cabin.id === 'brondon' && !progress.teleporterCollected;
      glow.emissiveIntensity = 1.4 + Math.sin(clock * 2.6) * 0.3;
    }
    update(0, 0);
    return {
      root, desk, chair, bed, computer, screen, desktop, poster, chest, teleporter, lidPivot, crystal, goggles,
      chestPoint: cabinPoint(cabin, 1.7, 0.6, 0.65),
      teleporterPoint: cabinPoint(cabin, -1.12, deskSize.y + 0.085, 2.41),
      update,
      dispose() {
        bodies.forEach(body => { if (body.world === physics.world) physics.world.removeBody(body); });
        disposeQuartersObject(root);
      },
    };
  } catch (error) {
    models.forEach(model => { if (!model.parent) disposeQuartersObject(model); });
    bodies.forEach(body => physics.world.removeBody(body));
    disposeQuartersObject(root);
    throw error;
  }
}

export type CabinFurnishings = Awaited<ReturnType<typeof createCabinFurnishings>>;
