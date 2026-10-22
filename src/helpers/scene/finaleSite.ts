import * as THREE from 'three';
import { loadBrendanModel, loadTexture } from '../../core/loader.js';
import { createEscapeShip } from '../../scripts/items/createEscapeShip.js';
import hideoutImageUrl from '../../assets/textures/sudoers-hideout.png?url';
import { FINALE_DECK_Y, FINALE_ROOFTOP } from './finaleWorld.js';
import { normalizeFinaleActor } from './finaleActors.js';
import { createJungleTextures } from './jungleTextures.js';
import { RESCUE_SITE, isJungleGrassSite, jungleTrailDistance } from './rescueSite.js';
import { CONIFER_PARTS, JUNGLE_GRASS_SPACING, createJungleFoliageGeometry, createJungleFoliageMaterials, writeConifer,
  createJungleView, partitionJungleInstances, writeGrassTuft, type ConiferPart } from './jungleFoliage.js';
import { createFallingPinecones } from './fallingPinecones.js';
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
  textures.grass.repeat.set(64, 50);
  const soil = new THREE.MeshStandardMaterial({ color: 0x8fa670, roughness: 1, map: textures.grass });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(330, 260), soil);
  ground.rotation.x = -Math.PI / 2; ground.position.set(-65, -0.04, 0); ground.receiveShadow = true; backdrop.add(ground);
  const clearing = new THREE.Mesh(new THREE.CircleGeometry(26, 40),
    new THREE.MeshStandardMaterial({ color: 0x8a805a, roughness: 1, map: textures.stone }));
  clearing.rotation.x = -Math.PI / 2; clearing.position.copy(RESCUE_SITE.clearing); clearing.position.y = 0.015; backdrop.add(clearing);
  const wind = { value: 0 }, foliage = createJungleFoliageMaterials(textures, wind);
  const geometry = createJungleFoliageGeometry();
  const count = 320;
  const forest: Record<ConiferPart, THREE.InstancedMesh> = {
    trunk: new THREE.InstancedMesh(geometry.trunk, foliage.bark, count),
    branch: new THREE.InstancedMesh(geometry.branch, foliage.branches, count * CONIFER_PARTS.branch),
    spray: new THREE.InstancedMesh(geometry.spray, foliage.sprays, count * CONIFER_PARTS.spray),
    canopy: new THREE.InstancedMesh(geometry.canopy, foliage.canopy, count * CONIFER_PARTS.canopy),
  };
  forest.trunk.name = 'FinaleBackdropTrunks'; forest.branch.name = 'FinaleBackdropBranches';
  forest.spray.name = 'FinaleBackdropCanopy'; forest.trunk.castShadow = true;
  forest.canopy.name = 'FinaleDistantCanopy';
  const trees: Array<{ x: number; z: number; height: number; radius: number; age: number }> = [];
  let seed = 7319;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const written: Record<ConiferPart, number> = { trunk: 0, branch: 0, spray: 0, canopy: 0 };
  while (trees.length < count) {
    const x = -140 + random() * 215, treeZ = -115 + random() * 240;
    const clearingDistance = ((x - RESCUE_SITE.clearing.x) / 28) ** 2 + ((treeZ - RESCUE_SITE.clearing.z) / 26) ** 2;
    if (clearingDistance < 1 || jungleTrailDistance(x, treeZ) < 5
      || Math.abs(treeZ - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth + 4
      || (Math.abs(x) < width / 2 + 7 && Math.abs(treeZ - z) < depth / 2 + 7)) continue;
    const height = 15 + random() * 11, radius = 0.4 + random() * 0.35;
    trees.push({ x, z: treeZ, height, radius, age: -1 });
    writeConifer(x, treeZ, height, radius, random, (part, matrix, color) => {
      const index = written[part]++;
      forest[part].setMatrixAt(index, matrix);
      if (color) forest[part].setColorAt(index, color);
    });
  }
  for (const mesh of Object.values(forest)) mesh.receiveShadow = true;
  const originalMatrices = {
    trunk: forest.trunk.instanceMatrix.array.slice(),
    branch: forest.branch.instanceMatrix.array.slice(),
    spray: forest.spray.instanceMatrix.array.slice(),
    canopy: forest.canopy.instanceMatrix.array.slice(),
  };
  const forestBatches = {
    trunk: partitionJungleInstances(forest.trunk),
    branch: partitionJungleInstances(forest.branch),
    spray: partitionJungleInstances(forest.spray),
    canopy: partitionJungleInstances(forest.canopy),
  };
  const renderBatches: Array<{ mesh: THREE.InstancedMesh; range: number; lod?: 'near' | 'far'; detailed: boolean }> = [];
  const changedMeshes = new Set<THREE.InstancedMesh>();
  for (const part of ['trunk', 'branch', 'spray', 'canopy'] as const) {
    for (const mesh of forestBatches[part].meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); backdrop.add(mesh);
      renderBatches.push({ mesh, range: part === 'branch' ? 46 : 145, detailed: true,
        lod: part === 'spray' || part === 'branch' ? 'near' : part === 'canopy' ? 'far' : undefined });
    }
    forest[part].dispose();
  }
  const matrix = new THREE.Matrix4(), scaleVector = new THREE.Vector3();
  function placeTree(index: number, scale: number) {
    const tree = trees[index];
    scaleVector.setScalar(scale);
    for (const part of ['trunk', 'branch', 'spray', 'canopy'] as const) {
      const start = index * CONIFER_PARTS[part];
      for (let offset = 0; offset < CONIFER_PARTS[part]; offset++) {
        matrix.fromArray(originalMatrices[part], (start + offset) * 16);
        matrix.scale(scaleVector);
        matrix.elements[12] = tree.x + (matrix.elements[12] - tree.x) * scale;
        matrix.elements[13] *= scale;
        matrix.elements[14] = tree.z + (matrix.elements[14] - tree.z) * scale;
        const location = forestBatches[part].locations[start + offset];
        matrix.elements[12] -= location.mesh.position.x; matrix.elements[14] -= location.mesh.position.z;
        location.mesh.setMatrixAt(location.index, matrix); changedMeshes.add(location.mesh);
      }
    }
  }
  const grass = new THREE.InstancedMesh(geometry.tuft, foliage.grass, 12000);
  grass.name = 'FinaleGroundGrass'; grass.receiveShadow = true;
  let grassCount = 0;
  for (let x0 = RESCUE_SITE.mountainX + 2; x0 <= RESCUE_SITE.east - 2; x0 += JUNGLE_GRASS_SPACING) {
    for (let z0 = -118; z0 <= 118; z0 += JUNGLE_GRASS_SPACING) {
      const x = x0 + (random() - 0.5) * 0.9, grassZ = z0 + (random() - 0.5) * 0.9;
      if (!isJungleGrassSite(x, grassZ) || (Math.abs(x) < width / 2 + 1.1 && Math.abs(grassZ - z) < depth / 2 + 1.1)) continue;
      writeGrassTuft(x, grassZ, random, (transform, color) => {
        grass.setMatrixAt(grassCount, transform); grass.setColorAt(grassCount++, color);
      });
    }
  }
  grass.count = grassCount;
  for (const mesh of partitionJungleInstances(grass).meshes) {
    backdrop.add(mesh); renderBatches.push({ mesh, range: 40, detailed: true });
  }
  grass.dispose();
  const pinecones = createFallingPinecones(scene, trees.map(tree => ({
    x: tree.x, z: tree.z, height: tree.height, alive: () => tree.age < 0,
  })));
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
  const foliageView = createJungleView();
  function updateVisibility(camera: THREE.Camera) {
    foliageView.update(camera); pinecones.updateView(camera);
    for (const batch of renderBatches) {
      batch.detailed = foliageView.detailed(batch.mesh, batch.detailed);
      batch.mesh.visible = foliageView.visible(batch.mesh, batch.range)
        && (!batch.lod || (batch.lod === 'near' ? batch.detailed : !batch.detailed));
      batch.mesh.castShadow = batch.mesh.visible && batch.mesh.name.startsWith('FinaleBackdropTrunks/')
        && foliageView.detailed(batch.mesh, false);
    }
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
      wind.value += dt;
      pinecones.update(dt);
      if (animateBoy) mixer?.update(dt);
      if (ship.root.visible) ship.update(dt);
      trees.forEach((tree, index) => {
        if (tree.age < 0 || tree.age >= 1.4) return;
        tree.age = Math.min(1.4, tree.age + dt);
        placeTree(index, 1 - THREE.MathUtils.smoothstep(tree.age, 0, 1.4));
      });
      for (const mesh of changedMeshes) mesh.instanceMatrix.needsUpdate = true;
      changedMeshes.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true; mixer?.stopAllAction(); mixer?.uncacheRoot(mixer.getRoot());
      boy.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      pinecones.dispose();
      for (const batch of renderBatches) batch.mesh.dispose();
      textures.leaves.dispose(); textures.needles.dispose();
      disposeRoom(scene);
    },
  };
}
