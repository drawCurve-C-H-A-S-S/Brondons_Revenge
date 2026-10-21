import * as THREE from 'three';
import { loadBrendanModel, loadTexture } from '../../core/loader.js';
import { createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import hideoutImageUrl from '../../assets/textures/sudoers-hideout.png?url';
import { FINALE_DECK_Y, FINALE_ROOFTOP } from './finaleWorld.js';
import { normalizeFinaleActor } from './finaleActors.js';
import { createJungleTextures } from './jungleTextures.js';
import { RESCUE_SITE } from './rescueSite.js';
import { disposeRoom } from './shipRoom.js';

type Point = { x: number; y: number; z: number };

/** The finale needs the summit and two exterior camera locations, not the playable jungle. */
export function createFinaleSite() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x698475);
  scene.fog = new THREE.Fog(0x698475, 55, 230);
  const textures = createJungleTextures();
  const gray = new THREE.MeshStandardMaterial({ color: 0x727b80, roughness: 0.9, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x353e43, roughness: 0.72, metalness: 0.45 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xa4a9a9, roughness: 0.7, metalness: 0.3 });
  function box(size: [number, number, number], at: [number, number, number], material = gray, parent: THREE.Object3D = scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }
  const { width, depth, z } = FINALE_ROOFTOP;
  for (const side of [-1, 1]) {
    box([1, 24, depth - 1], [side * (width / 2 - 0.5), 12, z]);
    box([width / 2 - 6, 24, 1], [side * (width / 4 + 3), 12, z + depth / 2 - 1]);
  }
  box([width, 24, 1], [0, 12, z - depth / 2 + 1]);
  box([10, 19, 1], [0, 14.5, z + depth / 2 - 1]);
  for (const x of [-32, -20, -8, 8, 20, 32]) {
    box([0.8, 24.6, 1.2], [x, 12, z + depth / 2 - 0.6], dark);
    for (const y of [8, 15, 21]) box([6.5, 2.6, 0.15], [x, y, z + depth / 2 + 0.05], trim);
  }
  const facilityRoof = box([width, 0.8, depth], [0, FINALE_ROOFTOP.y - 0.4, z], dark);
  facilityRoof.name = 'RescueSiteFacilityRoof';
  const rooftopEquipment = new THREE.Group(); rooftopEquipment.name = 'FacilityRooftopEquipment'; scene.add(rooftopEquipment);
  for (const x of [-12, 15]) {
    box([9, 4, 9], [x, FINALE_ROOFTOP.y + 2, z - 1], dark, rooftopEquipment);
    box([9.4, 0.3, 9.4], [x, FINALE_ROOFTOP.y + 4, z - 1], trim, rooftopEquipment);
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 12, 10), trim);
    aerial.position.set(x, FINALE_ROOFTOP.y + 6, z - 1); rooftopEquipment.add(aerial);
  }
  const muralCanvas = document.createElement('canvas'); muralCanvas.width = 1024; muralCanvas.height = 352;
  const muralContext = muralCanvas.getContext('2d');
  if (!muralContext) throw new Error('The finale facility mural requires a 2D canvas');
  const muralTexture = new THREE.CanvasTexture(muralCanvas); muralTexture.colorSpace = THREE.SRGBColorSpace;
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(width - 2, 24),
    new THREE.MeshBasicMaterial({ map: muralTexture, toneMapped: false }));
  mural.name = 'SudoersHideoutBackWall'; mural.position.set(0, 12, z - depth / 2 + 0.48); mural.rotation.y = Math.PI; scene.add(mural);

  const backdrop = new THREE.Group(); backdrop.name = 'FinaleLandscapeBackdrop'; scene.add(backdrop);
  const soil = new THREE.MeshStandardMaterial({ color: 0x425336, roughness: 1, map: textures.stone });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(330, 260), soil);
  ground.rotation.x = -Math.PI / 2; ground.position.set(-65, -0.04, 0); ground.receiveShadow = true; backdrop.add(ground);
  const clearing = new THREE.Mesh(new THREE.CircleGeometry(26, 40),
    new THREE.MeshStandardMaterial({ color: 0x8a805a, roughness: 1, map: textures.stone }));
  clearing.rotation.x = -Math.PI / 2; clearing.position.copy(RESCUE_SITE.clearing); clearing.position.y = 0.015; backdrop.add(clearing);
  const bark = new THREE.MeshStandardMaterial({ color: 0x82725b, map: textures.bark, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x799454, map: textures.leaves, roughness: 1 });
  const count = 320;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.65, 1, 5), bark, count);
  const crowns = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), leaves, count * 2);
  trunks.name = 'FinaleBackdropTrunks'; crowns.name = 'FinaleBackdropCanopy';
  trunks.receiveShadow = crowns.receiveShadow = true;
  const trees: Array<{ x: number; z: number; height: number; radius: number; age: number }> = [];
  let seed = 7319;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  function placeTree(index: number, scale = 1) {
    const tree = trees[index];
    dummy.position.set(tree.x, tree.height * 0.5 * scale, tree.z); dummy.rotation.set(0, index * 2.399, 0);
    dummy.scale.set(scale, tree.height * scale, scale); dummy.updateMatrix(); trunks.setMatrixAt(index, dummy.matrix);
    for (let layer = 0; layer < 2; layer++) {
      dummy.position.set(tree.x + (layer ? 0.8 : -0.6) * scale, (tree.height + layer * 1.6) * scale, tree.z);
      dummy.scale.set(tree.radius * scale, (3.4 + layer) * scale, tree.radius * 0.9 * scale);
      dummy.updateMatrix(); crowns.setMatrixAt(index * 2 + layer, dummy.matrix);
    }
  }
  while (trees.length < count) {
    const x = -140 + random() * 215, treeZ = -115 + random() * 240;
    const clearingDistance = ((x - RESCUE_SITE.clearing.x) / 28) ** 2 + ((treeZ - RESCUE_SITE.clearing.z) / 26) ** 2;
    if (clearingDistance < 1 || Math.abs(x) < width / 2 + 7 && Math.abs(treeZ - z) < depth / 2 + 7) continue;
    const index = trees.length;
    trees.push({ x, z: treeZ, height: 11 + random() * 9, radius: 3.6 + random() * 2.6, age: -1 });
    placeTree(index);
    tint.setHSL(0.25 + random() * 0.06, 0.25, 0.32 + random() * 0.17);
    crowns.setColorAt(index * 2, tint); crowns.setColorAt(index * 2 + 1, tint);
  }
  trunks.computeBoundingSphere(); crowns.computeBoundingSphere(); backdrop.add(trunks, crowns);
  const ship = createEscapeShip(); ship.root.position.copy(RESCUE_SITE.ship); ship.setThrust(0); ship.setFlying(false, true); scene.add(ship.root);
  const boy = new THREE.Group(); boy.name = 'RescuedPodBoy'; boy.position.copy(RESCUE_SITE.boy); scene.add(boy);
  let disposed = false, mixer: THREE.AnimationMixer | null = null;
  let boyAnimations: readonly THREE.AnimationClip[] = [];
  const boyReady = loadBrendanModel().then(asset => {
    if (disposed) { disposeRoom(asset.scene); return; }
    boyAnimations = asset.animations;
    boy.add(normalizeFinaleActor(asset.scene, 1.75));
    mixer = new THREE.AnimationMixer(asset.scene);
    const idle = asset.animations.find(clip => clip.name === 'Idle_Loop');
    if (!idle) throw new Error('Brendan needs an authored idle animation in the finale');
    mixer.clipAction(idle).play();
  });
  const muralReady = loadTexture(hideoutImageUrl).then(source => {
    try {
      if (disposed) return;
      muralContext.drawImage(source.image, 0, 0, muralCanvas.width, muralCanvas.height);
      muralContext.font = '900 64px Impact, Haettenschweiler, "Franklin Gothic Heavy", sans-serif';
      muralContext.textAlign = 'center'; muralContext.textBaseline = 'middle'; muralContext.lineJoin = 'round';
      muralContext.strokeStyle = '#17191f'; muralContext.lineWidth = 8; muralContext.strokeText('SUDOERS HIDEOUT', 512, 176);
      muralContext.fillStyle = '#ffdb57'; muralContext.fillText('SUDOERS HIDEOUT', 512, 176); muralTexture.needsUpdate = true;
    } finally { source.dispose(); }
  });
  const ready = Promise.all([boyReady, muralReady]).then(() => {});
  scene.add(new THREE.HemisphereLight(0xd1e2c0, 0x253921, 2));
  const sun = new THREE.DirectionalLight(0xffe3ac, 3.6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, far: 260 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.001; scene.add(sun, sun.target);
  function updateVisibility(camera: THREE.Camera) {
    const forest = camera.position.z > 35;
    const focus = forest ? RESCUE_SITE.boy : new THREE.Vector3(0, FINALE_DECK_Y, FINALE_ROOFTOP.z);
    sun.target.position.copy(focus); sun.position.copy(focus).add(new THREE.Vector3(-40, 90, 30));
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  }
  updateVisibility(new THREE.PerspectiveCamera());
  return {
    scene, ship, boy, facilityRoof, rooftopEquipment, ready, updateVisibility,
    getBoyAnimations: () => boyAnimations,
    disintegrateTrees(center: Point, radius: number) {
      const impacted: Point[] = [];
      trees.forEach(tree => {
        if (tree.age >= 0 || Math.hypot(tree.x - center.x, tree.z - center.z) > radius) return;
        tree.age = 0; impacted.push({ x: tree.x, y: tree.height, z: tree.z });
      });
      return impacted;
    },
    update(dt: number, animateBoy = true) {
      if (animateBoy) mixer?.update(dt);
      if (ship.root.visible) ship.update(dt);
      let changed = false;
      trees.forEach((tree, index) => {
        if (tree.age < 0 || tree.age >= 1.4) return;
        tree.age = Math.min(1.4, tree.age + dt);
        placeTree(index, 1 - THREE.MathUtils.smoothstep(tree.age, 0, 1.4)); changed = true;
      });
      if (changed) { trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true; }
    },
    dispose() {
      if (disposed) return;
      disposed = true; mixer?.stopAllAction(); mixer?.uncacheRoot(mixer.getRoot());
      boy.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      trunks.dispose(); crowns.dispose(); disposeRoom(scene);
    },
  };
}
