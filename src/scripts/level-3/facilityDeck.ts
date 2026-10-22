import * as THREE from 'three';
import type { createScenePhysics } from '../../helpers/physics/scenePhysics.js';

// Upstairs fit-out from origin/earth (1c28dc6), adapted to the open meeting room.
export function createFacilityDeck(scene: THREE.Scene, physics: ReturnType<typeof createScenePhysics>) {
  const MEZZ_Y = 4, W = 14, D = 18, CEIL = 8;
  const root = new THREE.Group(); root.name = 'FacilityObservationLab'; scene.add(root);
  const roundedRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  const circuitTexture = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320;
    const g = c.getContext('2d');
    if (!g) throw new Error('Unable to draw observation-deck circuits');
    g.fillStyle = '#02090d'; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = 'rgba(30,120,120,0.12)'; g.lineWidth = 1;
    for (let x = 0; x <= 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 320); g.stroke(); }
    for (let y = 0; y <= 320; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 90; i++) {
      const x = (i * 97) % 480 + 16, y = (i * 61) % 290 + 16;
      const dx = (i % 2 ? 1 : -1) * (24 + (i * 17) % 90), dy = (i % 3 ? 1 : -1) * (18 + (i * 11) % 70);
      g.strokeStyle = i % 7 === 0 ? 'rgba(200,255,250,1)' : 'rgba(70,245,235,0.78)';
      g.lineWidth = i % 7 === 0 ? 2.8 : 1.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y); g.lineTo(x + dx, y + dy); g.stroke();
      g.fillStyle = 'rgba(160,255,248,1)'; g.beginPath(); g.arc(x + dx, y + dy, 2.8, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 10; i++) {
      const x = (i * 167) % 440 + 20, y = (i * 113) % 250 + 30, w = 26 + (i % 3) * 14, h = 18 + (i % 2) * 12;
      g.fillStyle = 'rgba(6,30,36,0.95)'; roundedRect(g, x, y, w, h, 3); g.fill();
      g.strokeStyle = 'rgba(70,240,225,0.85)'; g.lineWidth = 1.4; roundedRect(g, x, y, w, h, 3); g.stroke();
      g.fillStyle = 'rgba(120,255,240,0.85)';
      for (let p = 0; p < Math.floor(w / 8); p++) { g.fillRect(x + 4 + p * 8, y - 2, 3, 3); g.fillRect(x + 4 + p * 8, y + h - 1, 3, 3); }
    }
    g.strokeStyle = 'rgba(150,255,246,1)'; g.lineWidth = 7; roundedRect(g, 10, 10, 492, 300, 26); g.stroke();
    g.strokeStyle = 'rgba(45,225,215,0.4)'; g.lineWidth = 2; roundedRect(g, 22, 22, 468, 276, 18); g.stroke();
    return new THREE.CanvasTexture(c);
  };
  const schematicTexture = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    if (!g) throw new Error('Unable to draw observation-deck schematic');
    g.fillStyle = '#03141a'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = 'rgba(45,200,200,0.15)'; g.lineWidth = 1;
    for (let x = 0; x <= 512; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let y = 0; y <= 256; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    g.strokeStyle = 'rgba(130,255,246,1)'; g.lineWidth = 2.4;
    for (const radius of [70, 46, 20]) { g.beginPath(); g.arc(150, 128, radius, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(60, 128); g.lineTo(240, 128); g.moveTo(150, 40); g.lineTo(150, 216); g.stroke();
    const bracket = (x: number, y: number, sx: number, sy: number) => { g.beginPath(); g.moveTo(x, y + sy * 22); g.lineTo(x, y); g.lineTo(x + sx * 22, y); g.stroke(); };
    bracket(280, 40, 1, 1); bracket(488, 40, -1, 1); bracket(280, 216, 1, -1); bracket(488, 216, -1, -1);
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(55,230,214,${0.35 + 0.05 * i})`; g.fillRect(292 + i * 16, 190 - ((i * 37) % 80), 10, 40 + ((i * 37) % 80)); }
    g.fillStyle = 'rgba(140,246,234,0.85)';
    for (let i = 0; i < 6; i++) g.fillRect(292, 52 + i * 10, 60 + ((i * 29) % 120), 3);
    return new THREE.CanvasTexture(c);
  };
  const touchTexture = () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    if (!g) throw new Error('Unable to draw observation-deck console');
    g.fillStyle = '#04141a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(45,225,215,0.45)'; g.lineWidth = 1;
    for (let x = 0; x <= 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    for (const [x, y, w, h] of [[18, 18, 92, 42], [128, 22, 104, 32], [22, 74, 74, 36], [108, 70, 124, 42]]) {
      g.fillStyle = 'rgba(80,245,235,1)'; roundedRect(g, x, y, w, h, 6); g.fill();
      g.fillStyle = 'rgba(210,255,250,1)'; roundedRect(g, x + 6, y + 6, w - 12, h - 12, 4); g.fill();
    }
    return new THREE.CanvasTexture(c);
  };
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a1418, metalness: 0.75, roughness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b2b31, metalness: 0.85, roughness: 0.35 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x7dfff0 }), red = new THREE.MeshBasicMaterial({ color: 0xff6a55 });
  const circuit = new THREE.MeshBasicMaterial({ map: circuitTexture() }), touch = new THREE.MeshBasicMaterial({ map: touchTexture() });
  function box(parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at); parent.add(mesh); return mesh;
  }
  function panel(w: number, h: number, x: number, y: number, z: number, yaw: number) {
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = yaw; root.add(group);
    box(group, [w + 0.35, h + 0.35, 0.18], [0, 0, 0], dark);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), circuit); face.position.z = 0.1; group.add(face);
    for (const side of [-1, 1]) {
      box(group, [w + 0.12, 0.07, 0.07], [0, side * h / 2, 0.14], cyan);
      box(group, [0.07, h + 0.12, 0.07], [side * w / 2, 0, 0.14], cyan);
    }
  }
  panel(6.4, 3, -8, MEZZ_Y + 1.9, -D + 0.3, 0);
  panel(6.4, 3, 8, MEZZ_Y + 1.9, -D + 0.3, 0);
  panel(7.5, 2.8, -W + 0.3, MEZZ_Y + 1.9, -13, Math.PI / 2);
  panel(7.5, 2.8, W - 0.3, MEZZ_Y + 1.9, -13, -Math.PI / 2);
  box(root, [10.6, 2.3, 0.22], [0, 6.5, -D + 0.35], dark);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 1.8), new THREE.MeshBasicMaterial({ map: schematicTexture() }));
  display.position.set(0, 6.5, -D + 0.75); display.rotation.x = 0.26; root.add(display);
  for (const y of [5.57, 7.43]) box(root, [10, 0.09, 0.09], [0, y, -D + 0.78], cyan);
  for (let i = 0; i < 6; i++) box(root, [0.7, 0.16, 0.12], [-3.75 + i * 1.5, 7.65, -D + 0.42], i === 1 ? red : cyan);
  for (const z of [-16.5, -13.5, -10.5]) box(root, [W * 2 - 1, 0.28, 0.28], [0, CEIL - 0.35, z], dark);
  for (const x of [-9, -3, 3, 9]) box(root, [0.22, 0.22, 8], [x, CEIL - 0.4, -13.5], dark);
  for (const x of [-7, 7]) {
    const glow = new THREE.PointLight(0x4ffce8, 30, 20); glow.position.set(x, MEZZ_Y + 2.4, -15.5); root.add(glow);
  }
  const glow = new THREE.PointLight(0x4ffce8, 26, 16); glow.position.set(0, MEZZ_Y + 3.6, -15); root.add(glow);
  function console(x: number, z: number, yaw: number, length = 3.6) {
    const group = new THREE.Group(); group.position.set(x, MEZZ_Y + 0.2, z); group.rotation.y = yaw; root.add(group);
    const body = box(group, [length, 0.85, 1.15], [0, 0.425, 0], metal); body.castShadow = body.receiveShadow = true;
    box(group, [length + 0.1, 0.12, 1.25], [0, 0.06, 0], dark);
    const face = box(group, [length - 0.15, 0.55, 0.08], [0, 0.98, -0.3], dark); face.rotation.x = -0.55;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(length - 0.35, 0.4), touch);
    screen.position.set(0, 1, -0.25); screen.rotation.x = -0.55; group.add(screen);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(length - 0.3, 0.95), touch);
    top.rotation.x = -Math.PI / 2; top.position.set(0, 0.851, 0.05); group.add(top);
    box(group, [length, 0.05, 0.05], [0, 0.86, 0.56], cyan);
    for (let i = 0; i < 7; i++) box(group, [0.09, 0.09, 0.05], [-length / 2 + 0.5 + i * (length - 1) / 6, 0.5, 0.58], red);
    body.updateWorldMatrix(true, false); physics.addBoxFromMesh(body);
  }
  console(0, -16.6, 0, 9);
  console(-7, -5, 0); console(7, -5, 0);
  console(-10.5, 0, Math.PI / 2); console(10.5, 0, -Math.PI / 2);
  return root;
}
