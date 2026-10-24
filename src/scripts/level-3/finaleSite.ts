import * as THREE from "three";
import { loadBrendanModel, loadTexture } from "../../core/loader.js";
import { createEscapeShip } from "../items/createEscapeShip.js";
import hideoutImageUrl from "../../assets/textures/sudoers-hideout.png?url";
import { FINALE_DECK_Y, FINALE_ROOFTOP } from "./finaleWorld.js";
import { normalizeFinaleActor } from "./finaleActors.js";
import { createJungleTextures } from "./jungleTextures.js";
import {
  RESCUE_SITE,
  isJungleGrassSite,
  jungleTrailDistance,
} from "../global/rescueSite.js";
import {
  CONIFER_PARTS,
  JUNGLE_GRASS_SPACING,
  createJungleFoliageGeometry,
  createJungleFoliageMaterials,
  writeConifer,
  createJungleView,
  partitionJungleInstances,
  writeGrassTuft,
  type ConiferPart,
} from "./jungleFoliage.js";
import { createFallingPinecones } from "./fallingPinecones.js";
import { disposeRoom } from "../global/shipRoom.js";
import { FACILITY_OFFICE } from "./facilityOffice.js";
import {
  FACILITY,
  FACILITY_CUT_Y,
  FACILITY_ROOF_SEQUENCE,
  createFacilityArchitecture,
  createFacilityMezzanineShape,
  sampleFacilityLift,
} from "../global/facilityArchitecture.js";

type Point = { x: number; y: number; z: number };

/** The finale needs the summit and two exterior camera locations, not the playable jungle. */
export function createFinaleSite() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x698475);
  scene.fog = new THREE.Fog(0x698475, 55, 230);
  const textures = createJungleTextures();
  const dark = new THREE.MeshStandardMaterial({
    color: 0x353e43,
    roughness: 0.72,
    metalness: 0.45,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0xa4a9a9,
    roughness: 0.7,
    metalness: 0.3,
  });
  const architecture = createFacilityArchitecture();
  const { width, depth, z } = FINALE_ROOFTOP;
  scene.add(architecture.root);
  const facilityRoof = architecture.roof,
    facilityDome = architecture.dome,
    facilityDomeRings = architecture.rings;
  const officeFloorShape = createFacilityMezzanineShape(FACILITY_OFFICE.front);
  const liftOpening = new THREE.Path();
  liftOpening.absarc(0, 0, FACILITY.liftRadius, 0, Math.PI * 2, true);
  officeFloorShape.holes.push(liftOpening);
  const officeFloor = new THREE.Mesh(
    new THREE.ExtrudeGeometry(officeFloorShape, {
      depth: 0.4,
      bevelEnabled: false,
      curveSegments: 64,
    }),
    new THREE.MeshStandardMaterial({
      color: 0x2e6076,
      metalness: 0.35,
      roughness: 0.6,
    }),
  );
  officeFloor.name = "FinaleOfficeMezzanine";
  officeFloor.rotation.x = -Math.PI / 2;
  officeFloor.position.set(FACILITY.x, FACILITY.officeFloor - 0.4, FACILITY.z);
  officeFloor.receiveShadow = true;
  scene.add(officeFloor);
  const officeGlass = new THREE.MeshPhysicalMaterial({
    color: 0xc5e8ed,
    transparent: true,
    opacity: 0.14,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (let index = -4; index <= 4; index++) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(index === 0 ? 2.94 : 12.5 / 4 - 0.06, 3.5, 0.06),
      officeGlass,
    );
    panel.name = "FinaleOfficeGlass";
    panel.position.set(
      FACILITY.x +
        (index === 0
          ? 0
          : Math.sign(index) * (1.5 + (12.5 / 4) * (Math.abs(index) - 0.5))),
      FACILITY.officeFloor + 1.85,
      FACILITY.z + FACILITY_OFFICE.front,
    );
    scene.add(panel);
  }
  const roofElevator = new THREE.Group();
  roofElevator.name = "FacilityRoofElevator";
  roofElevator.position.set(FACILITY.x, 0, FACILITY.z);
  scene.add(roofElevator);
  const elevatorShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(
      FACILITY.liftRadius - 0.2,
      FACILITY.liftRadius - 0.2,
      1,
      48,
      1,
      true,
    ),
    dark,
  );
  elevatorShaft.name = "FacilityRoofLiftHydraulics";
  roofElevator.add(elevatorShaft);
  const elevatorPlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(
      FACILITY.liftRadius - 0.04,
      FACILITY.liftRadius - 0.04,
      0.35,
      64,
    ),
    trim,
  );
  elevatorPlatform.name = "FacilityRoofElevatorPlatform";
  elevatorPlatform.castShadow = elevatorPlatform.receiveShadow = true;
  roofElevator.add(elevatorPlatform);
  const laserCutMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d0e20,
    emissive: 0xff244f,
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.8,
    toneMapped: false,
  });
  const laserCutRing = new THREE.Mesh(
    new THREE.TorusGeometry(FACILITY.liftRadius, 0.12, 10, 96),
    laserCutMaterial,
  );
  laserCutRing.name = "FacilityDomeLaserCut";
  laserCutRing.rotation.x = Math.PI / 2;
  laserCutRing.position.set(0, FACILITY_CUT_Y + 0.04, 0);
  roofElevator.add(laserCutRing);
  const deckCutRing = laserCutRing.clone();
  deckCutRing.name = "FacilityDeckLaserCut";
  deckCutRing.position.y = FACILITY.roofY + 0.04;
  roofElevator.add(deckCutRing);
  const cutter = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.08,
      0.08,
      FACILITY.roofY - FACILITY_CUT_Y + 0.3,
      8,
    ),
    new THREE.MeshBasicMaterial({ color: 0xff4665, toneMapped: false }),
  );
  cutter.name = "FacilityRoofLaserCutter";
  cutter.position.y = (FACILITY.roofY + FACILITY_CUT_Y) / 2;
  roofElevator.add(cutter);
  const elevatorLight = new THREE.PointLight(0xff2454, 0, 22);
  elevatorLight.position.set(0, FACILITY_CUT_Y + 0.4, 0);
  roofElevator.add(elevatorLight);
  function updateRoofSequence(time: number) {
    const sample = sampleFacilityLift(time);
    elevatorPlatform.position.y = sample.y - 0.175;
    const height = sample.y;
    elevatorShaft.scale.y = height;
    elevatorShaft.position.y = height / 2 - 0.35;
    const cutting = time >= 0 && time < FACILITY_ROOF_SEQUENCE.capClear;
    laserCutRing.visible = deckCutRing.visible = cutting;
    laserCutRing.geometry.setDrawRange(
      0,
      Math.floor((laserCutRing.geometry.index!.count * sample.cut) / 3) * 3,
    );
    cutter.visible = time >= 0 && time < FACILITY_ROOF_SEQUENCE.cutEnd;
    const angle = sample.cut * Math.PI * 2;
    cutter.position.x = Math.cos(angle) * FACILITY.liftRadius;
    cutter.position.z = -Math.sin(angle) * FACILITY.liftRadius;
    laserCutMaterial.emissiveIntensity = cutting ? 4 : 0;
    const capLift = THREE.MathUtils.smootherstep(
      time,
      FACILITY_ROOF_SEQUENCE.cutEnd,
      FACILITY_ROOF_SEQUENCE.capClear,
    );
    architecture.domeCap.position.y = capLift * 4;
    architecture.roofCap.position.y =
      FACILITY.roofY - FACILITY.roofThickness / 2 + capLift * 4;
    architecture.domeCap.visible = architecture.roofCap.visible =
      time < FACILITY_ROOF_SEQUENCE.capClear;
    elevatorLight.intensity = cutting ? 15 : 0;
    return sample;
  }
  updateRoofSequence(-1);
  const muralCanvas = document.createElement("canvas");
  muralCanvas.width = 1024;
  muralCanvas.height = 614;
  const muralContext = muralCanvas.getContext("2d");
  if (!muralContext)
    throw new Error("The finale facility mural requires a 2D canvas");
  const muralTexture = new THREE.CanvasTexture(muralCanvas);
  muralTexture.colorSpace = THREE.SRGBColorSpace;
  const interiorMural = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 3.6),
    new THREE.MeshBasicMaterial({ map: muralTexture, toneMapped: false }),
  );
  interiorMural.name = "FinaleSudoersHideoutPortrait";
  interiorMural.position.set(0, FACILITY.officeFloor + 2, FACILITY.z - 20.5);
  scene.add(interiorMural);

  const backdrop = new THREE.Group();
  backdrop.name = "FinaleLandscapeBackdrop";
  scene.add(backdrop);
  textures.grass.repeat.set(64, 50);
  const soil = new THREE.MeshStandardMaterial({
    color: 0x8fa670,
    roughness: 1,
    map: textures.grass,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(330, 260), soil);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-65, -0.04, 0);
  ground.receiveShadow = true;
  backdrop.add(ground);
  const clearing = new THREE.Mesh(
    new THREE.CircleGeometry(26, 40),
    new THREE.MeshStandardMaterial({
      color: 0x8a805a,
      roughness: 1,
      map: textures.stone,
    }),
  );
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.copy(RESCUE_SITE.clearing);
  clearing.position.y = 0.015;
  backdrop.add(clearing);
  const wind = { value: 0 },
    foliage = createJungleFoliageMaterials(textures, wind);
  const geometry = createJungleFoliageGeometry();
  const count = 320;
  const forest: Record<ConiferPart, THREE.InstancedMesh> = {
    trunk: new THREE.InstancedMesh(geometry.trunk, foliage.bark, count),
    branch: new THREE.InstancedMesh(
      geometry.branch,
      foliage.branches,
      count * CONIFER_PARTS.branch,
    ),
    spray: new THREE.InstancedMesh(
      geometry.spray,
      foliage.sprays,
      count * CONIFER_PARTS.spray,
    ),
    canopy: new THREE.InstancedMesh(
      geometry.canopy,
      foliage.canopy,
      count * CONIFER_PARTS.canopy,
    ),
  };
  forest.trunk.name = "FinaleBackdropTrunks";
  forest.branch.name = "FinaleBackdropBranches";
  forest.spray.name = "FinaleBackdropCanopy";
  forest.trunk.castShadow = true;
  forest.canopy.name = "FinaleDistantCanopy";
  const trees: Array<{
    x: number;
    z: number;
    height: number;
    radius: number;
    age: number;
  }> = [];
  let seed = 7319;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const written: Record<ConiferPart, number> = {
    trunk: 0,
    branch: 0,
    spray: 0,
    canopy: 0,
  };
  while (trees.length < count) {
    const x = -140 + random() * 215,
      treeZ = -115 + random() * 240;
    const clearingDistance =
      ((x - RESCUE_SITE.clearing.x) / 28) ** 2 +
      ((treeZ - RESCUE_SITE.clearing.z) / 26) ** 2;
    if (
      clearingDistance < 1 ||
      jungleTrailDistance(x, treeZ) < 5 ||
      Math.abs(treeZ - RESCUE_SITE.riverZ) < RESCUE_SITE.riverHalfWidth + 4 ||
      (Math.abs(x) < width / 2 + 7 && Math.abs(treeZ - z) < depth / 2 + 7)
    )
      continue;
    const height = 15 + random() * 11,
      radius = 0.4 + random() * 0.35;
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
  const renderBatches: Array<{
    mesh: THREE.InstancedMesh;
    range: number;
    lod?: "near" | "far";
    detailed: boolean;
  }> = [];
  const changedMeshes = new Set<THREE.InstancedMesh>();
  for (const part of ["trunk", "branch", "spray", "canopy"] as const) {
    for (const mesh of forestBatches[part].meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      backdrop.add(mesh);
      renderBatches.push({
        mesh,
        range: part === "branch" ? 46 : 145,
        detailed: true,
        lod:
          part === "spray" || part === "branch"
            ? "near"
            : part === "canopy"
              ? "far"
              : undefined,
      });
    }
    forest[part].dispose();
  }
  const matrix = new THREE.Matrix4(),
    scaleVector = new THREE.Vector3();
  function placeTree(index: number, scale: number) {
    const tree = trees[index];
    scaleVector.setScalar(scale);
    for (const part of ["trunk", "branch", "spray", "canopy"] as const) {
      const start = index * CONIFER_PARTS[part];
      for (let offset = 0; offset < CONIFER_PARTS[part]; offset++) {
        matrix.fromArray(originalMatrices[part], (start + offset) * 16);
        matrix.scale(scaleVector);
        matrix.elements[12] = tree.x + (matrix.elements[12] - tree.x) * scale;
        matrix.elements[13] *= scale;
        matrix.elements[14] = tree.z + (matrix.elements[14] - tree.z) * scale;
        const location = forestBatches[part].locations[start + offset];
        matrix.elements[12] -= location.mesh.position.x;
        matrix.elements[14] -= location.mesh.position.z;
        location.mesh.setMatrixAt(location.index, matrix);
        changedMeshes.add(location.mesh);
      }
    }
  }
  const grass = new THREE.InstancedMesh(geometry.tuft, foliage.grass, 12000);
  grass.name = "FinaleGroundGrass";
  grass.receiveShadow = true;
  let grassCount = 0;
  for (
    let x0 = RESCUE_SITE.mountainX + 2;
    x0 <= RESCUE_SITE.east - 2;
    x0 += JUNGLE_GRASS_SPACING
  ) {
    for (let z0 = -118; z0 <= 118; z0 += JUNGLE_GRASS_SPACING) {
      const x = x0 + (random() - 0.5) * 0.9,
        grassZ = z0 + (random() - 0.5) * 0.9;
      if (
        !isJungleGrassSite(x, grassZ) ||
        (Math.abs(x) < width / 2 + 1.1 &&
          Math.abs(grassZ - z) < depth / 2 + 1.1)
      )
        continue;
      writeGrassTuft(x, grassZ, random, (transform, color) => {
        grass.setMatrixAt(grassCount, transform);
        grass.setColorAt(grassCount++, color);
      });
    }
  }
  grass.count = grassCount;
  for (const mesh of partitionJungleInstances(grass).meshes) {
    backdrop.add(mesh);
    renderBatches.push({ mesh, range: 40, detailed: true });
  }
  grass.dispose();
  const pinecones = createFallingPinecones(
    scene,
    trees.map((tree) => ({
      x: tree.x,
      z: tree.z,
      height: tree.height,
      alive: () => tree.age < 0,
    })),
  );
  const ship = createEscapeShip();
  ship.root.position.copy(RESCUE_SITE.ship);
  ship.setThrust(0);
  ship.setFlying(false, true);
  scene.add(ship.root);
  const boy = new THREE.Group();
  boy.name = "RescuedPodBoy";
  boy.position.copy(RESCUE_SITE.boy);
  scene.add(boy);
  let disposed = false,
    mixer: THREE.AnimationMixer | null = null;
  let boyAnimations: readonly THREE.AnimationClip[] = [];
  const boyReady = loadBrendanModel().then((asset) => {
    if (disposed) {
      disposeRoom(asset.scene);
      return;
    }
    boyAnimations = asset.animations;
    boy.add(normalizeFinaleActor(asset.scene, 1.75));
    mixer = new THREE.AnimationMixer(asset.scene);
    const idle = asset.animations.find((clip) => clip.name === "Idle_Loop");
    if (!idle)
      throw new Error("Brendan needs an authored idle animation in the finale");
    mixer.clipAction(idle).play();
  });
  const muralReady = loadTexture(hideoutImageUrl).then((source) => {
    try {
      if (disposed) return;
      muralContext.drawImage(
        source.image,
        0,
        0,
        muralCanvas.width,
        muralCanvas.height,
      );
      muralContext.font =
        '900 64px Impact, Haettenschweiler, "Franklin Gothic Heavy", sans-serif';
      muralContext.textAlign = "center";
      muralContext.textBaseline = "middle";
      muralContext.lineJoin = "round";
      muralContext.strokeStyle = "#17191f";
      muralContext.lineWidth = 8;
      muralContext.strokeText("SUDOERS HIDEOUT", 512, 550);
      muralContext.fillStyle = "#ffdb57";
      muralContext.fillText("SUDOERS HIDEOUT", 512, 550);
      muralTexture.needsUpdate = true;
    } finally {
      source.dispose();
    }
  });
  const ready = Promise.all([boyReady, muralReady]).then(() => {});
  scene.add(new THREE.HemisphereLight(0xd1e2c0, 0x253921, 2));
  const sun = new THREE.DirectionalLight(0xffe3ac, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -48,
    right: 48,
    top: 48,
    bottom: -48,
    far: 260,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.001;
  scene.add(sun, sun.target);
  const foliageView = createJungleView();
  function updateVisibility(camera: THREE.Camera) {
    foliageView.update(camera);
    pinecones.updateView(camera);
    for (const batch of renderBatches) {
      batch.detailed = foliageView.detailed(batch.mesh, batch.detailed);
      batch.mesh.visible =
        foliageView.visible(batch.mesh, batch.range) &&
        (!batch.lod ||
          (batch.lod === "near" ? batch.detailed : !batch.detailed));
      batch.mesh.castShadow =
        batch.mesh.visible &&
        batch.mesh.name.startsWith("FinaleBackdropTrunks/") &&
        foliageView.detailed(batch.mesh, false);
    }
    const forest = camera.position.z > 35;
    const focus = forest
      ? RESCUE_SITE.boy
      : new THREE.Vector3(0, FINALE_DECK_Y, FINALE_ROOFTOP.z);
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(new THREE.Vector3(-40, 90, 30));
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  updateVisibility(new THREE.PerspectiveCamera());
  return {
    scene,
    ship,
    boy,
    facilityRoof,
    facilityDome,
    facilityDomeRings,
    roofElevator,
    elevatorPlatform,
    updateRoofSequence,
    ready,
    updateVisibility,
    getBoyAnimations: () => boyAnimations,
    disintegrateTrees(center: Point, radius: number) {
      const impacted: Point[] = [];
      trees.forEach((tree) => {
        if (
          tree.age >= 0 ||
          Math.hypot(tree.x - center.x, tree.z - center.z) > radius
        )
          return;
        tree.age = 0;
        impacted.push({ x: tree.x, y: tree.height, z: tree.z });
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
      disposed = true;
      mixer?.stopAllAction();
      mixer?.uncacheRoot(mixer.getRoot());
      boy.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      });
      pinecones.dispose();
      for (const batch of renderBatches) batch.mesh.dispose();
      textures.leaves.dispose();
      textures.needles.dispose();
      disposeRoom(scene);
    },
  };
}
