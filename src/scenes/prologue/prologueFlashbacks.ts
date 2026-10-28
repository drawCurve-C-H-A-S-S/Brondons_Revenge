import * as THREE from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import {
  loadBossModel,
  loadModel,
  loadPlayerModel,
  loadSubjectModel,
  loadToolModel,
} from "../../core/loader.js";
import { createScenePhysics } from "../../helpers/physics/scenePhysics.js";
import { BreakableMaterial } from "../../scripts/global/breakableMaterial.js";
import { createStealthHangar } from "../level 1 stage 1/stealthHangar.js";
import { createStealthPassage } from "../level 1 stage 1/stealthPassage.js";
import { createHangarFourteenSet } from "../level 1 boss stage/scene14.js";
import {
  createSurveillanceHubSet,
  createSurveillanceWorkstation,
  SURVEILLANCE_WORKSTATIONS,
} from "../level 1 stage 2/scene.js";
import { createMothership } from "../../scripts/global/mothership.js";
import { disposeRoom, fitRoomProp } from "../../scripts/global/shipRoom.js";
import { createShipInteriorMaterials } from "../../scripts/global/shipInterior.js";
import { createCorridorMonitor } from "../../scripts/global/corridorMonitor.js";
import { createCctvWall } from "../../scripts/npc/cctv.js";
import { STAGE_TWO_MINIGAMES } from "../level 1 stage 2/stageTwoLayout.js";
import hologramVertexShader from "../../shaders/vert/hologram.vert.glsl?raw";
import hologramFragmentShader from "../../shaders/frag/hologram.frag.glsl?raw";
import {
  createEarthTextures,
  createEarthGroup,
  updateEarthGroup,
} from "../../scripts/global/earthTexture.js";
import { prepareSceneRendering } from "../../core/renderer.js";
import { yieldToMainThread } from "../../core/loader.js";
import {
  createContainmentPod,
  type ContainmentPod,
} from "../../scripts/prologue/containmentPod.js";

export type PrologueShot =
  | "present"
  | "asteroid"
  | "collection"
  | "ingest"
  | "corruption"
  | "capture"
  | "laboratory"
  | "experiment"
  | "breakout"
  | "planet"
  | "corridor"
  | "stealth"
  | "security";

export const PROLOGUE_SECURITY_CUTS = [
  {
    id: "hangar14-ship",
    start: 0,
    end: 2.4,
    label: "PRIME / HANGAR 14 / OUR SHIP",
  },
  {
    id: "surveillance-hub",
    start: 2.4,
    end: 4.7,
    label: "PRIME / SURVEILLANCE HUB",
  },
  {
    id: "deck-one",
    start: 4.7,
    end: 7,
    label: "PRIME / DECK ONE / LIVE PATROLS",
  },
  { id: "bay-warden", start: 7, end: 10, label: "PRIME / BAY WARDEN" },
] as const;

export function createPrologueShield() {
  const root = new THREE.Group();
  root.name = "PrimeShieldBurst";
  root.visible = false;
  const surface = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 3),
    new THREE.MeshBasicMaterial({
      color: 0xffe639,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  const lattice = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.005, 1),
    new THREE.MeshBasicMaterial({
      color: 0xfff3a5,
      transparent: true,
      opacity: 0,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  root.add(surface, lattice);
  return {
    root,
    update(elapsed: number) {
      const expansion = THREE.MathUtils.smootherstep(elapsed, 0, 0.45);
      const fade = 1 - THREE.MathUtils.smoothstep(elapsed, 0.45, 1.15);
      root.visible = elapsed >= 0 && elapsed < 1.15;
      root.scale.setScalar(THREE.MathUtils.lerp(0.15, 1.65, expansion));
      surface.material.opacity = (0.12 + expansion * 0.13) * fade;
      lattice.material.opacity = 0.65 * fade;
    },
  };
}

export function createPrologueFlashbacks({
  characterLoader = loadSubjectModel,
  playerLoader = loadPlayerModel,
  modelLoader = loadToolModel,
  shipLoader = loadModel,
  bossLoader = loadBossModel,
  monitorFactory = createCorridorMonitor,
} = {}) {
  const textures = new Set<THREE.Texture>();
  type HologramPose = "standing" | "kneeling" | "carrying" | "restrained";
  const holograms: Array<{
    group: THREE.Group;
    pose: HologramPose;
    height: number;
    brondon: boolean;
    mixer?: THREE.AnimationMixer;
  }> = [];
  const scenes: THREE.Scene[] = [];
  const robots: Array<{
    root: THREE.Group;
    mixer?: THREE.AnimationMixer;
    phase: number;
    hangar?: boolean;
    scan?: THREE.Mesh;
  }> = [];
  const cameraRigs: THREE.Group[] = [];
  let disposed = false;
  let clock = 0;
  let lastShot: PrologueShot = "present";
  let currentRenderScene: THREE.Scene | null = null;
  let securityCut: (typeof PROLOGUE_SECURITY_CUTS)[number] =
    PROLOGUE_SECURITY_CUTS[0];

  const noise = (seed: number) => {
    const value = Math.sin(seed * 12.9898 + 37.719) * 43758.5453;
    return value - Math.floor(value);
  };
  const metal = new THREE.MeshStandardMaterial({
    color: 0x34434b,
    metalness: 0.55,
    roughness: 0.64,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x111b24,
    metalness: 0.65,
    roughness: 0.52,
  });
  const paleMetal = new THREE.MeshStandardMaterial({
    color: 0x70808a,
    metalness: 0.45,
    roughness: 0.55,
  });
  const blueStrip = new THREE.MeshBasicMaterial({ color: 0x8be1ee });
  const redStrip = new THREE.MeshBasicMaterial({ color: 0xff3948 });

  function box(
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material = metal,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function newScene(background = 0x03080f, interior = false) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    if (interior) scene.fog = new THREE.Fog(background, 12, 38);
    scene.add(new THREE.AmbientLight(0xa5bed0, interior ? 0.8 : 0.65));
    const key = new THREE.DirectionalLight(0xc6e7ef, 3.2);
    key.position.set(-4, 8, 6);
    scene.add(key);
    scenes.push(scene);
    return scene;
  }

  const hologramMaterial = new THREE.ShaderMaterial({
    uniforms: {
      hologramTime: { value: 0 },
      hologramColor: { value: new THREE.Color(0x32a9ff) },
      hologramImpact: { value: 0 },
    },
    vertexShader: hologramVertexShader,
    fragmentShader: hologramFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  function figure(
    parent: THREE.Object3D,
    position: [number, number, number],
    pose: HologramPose = "standing",
    height = 1.9,
    brondon = false,
  ) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.name = brondon ? "BrondonRecoveredMemory" : `Hologram-${pose}`;
    parent.add(group);
    holograms.push({ group, pose, height, brondon });
    return group;
  }

  const restraintMaterial = new THREE.MeshStandardMaterial({
    color: 0x91a8b8,
    metalness: 0.85,
    roughness: 0.28,
  });
  const restraintGeometry = new THREE.TorusGeometry(0.018, 0.005, 6, 12);
  const linkUp = new THREE.Vector3(0, 1, 0);

  function chain(
    parent: THREE.Object3D,
    curve: THREE.Curve<THREE.Vector3>,
    count: number,
  ) {
    for (let linkIndex = 0; linkIndex < count; linkIndex++) {
      const fraction = linkIndex / (count - 1);
      const link = new THREE.Mesh(restraintGeometry, restraintMaterial);
      curve.getPoint(fraction, link.position);
      link.quaternion.setFromUnitVectors(
        linkUp,
        curve.getTangent(fraction).normalize(),
      );
      link.rotateY(((linkIndex % 2) * Math.PI) / 2);
      link.scale.y = 1.3;
      parent.add(link);
    }
  }

  function restrain(group: THREE.Group, model: THREE.Object3D, height: number) {
    for (const chestY of [height * 0.36, height * 0.58]) {
      const points = Array.from({ length: 33 }, (_, pointIndex) => {
        const angle = (pointIndex / 32) * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(angle) * 0.27,
          chestY,
          Math.sin(angle) * 0.17,
        );
      });
      chain(group, new THREE.CatmullRomCurve3(points), 38);
    }
    const wrists: THREE.Vector3[] = [];
    for (const suffix of ["l", "r"]) {
      const forearm = model.getObjectByName(`lowerarm_${suffix}`);
      const hand = model.getObjectByName(`hand_${suffix}`);
      if (!forearm || !hand) continue;
      const direction = hand.getWorldPosition(new THREE.Vector3());
      forearm.worldToLocal(direction);
      const cuff = new THREE.Mesh(
        new THREE.TorusGeometry(0.046, 0.009, 8, 18),
        restraintMaterial,
      );
      cuff.position.copy(direction).multiplyScalar(0.88);
      cuff.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        direction.normalize(),
      );
      forearm.add(cuff);
      wrists.push(
        group.worldToLocal(hand.getWorldPosition(new THREE.Vector3())),
      );
    }
    if (wrists.length === 2) {
      const middle = wrists[0].clone().lerp(wrists[1], 0.5);
      middle.y -= 0.08;
      middle.z += 0.12;
      const curve = new THREE.QuadraticBezierCurve3(
        wrists[0],
        middle,
        wrists[1],
      );
      chain(group, curve, Math.max(8, Math.ceil(curve.getLength() / 0.04)));
    }
  }

  function stars(scene: THREE.Scene) {
    const positions = new Float32Array(1800 * 3);
    for (let starIndex = 0; starIndex < 1800; starIndex++) {
      const direction = new THREE.Vector3(
        noise(starIndex * 3) - 0.5,
        noise(starIndex * 3 + 1) - 0.5,
        noise(starIndex * 3 + 2) - 0.5,
      ).normalize();
      direction
        .multiplyScalar(60 + noise(starIndex + 6000) * 70)
        .toArray(positions, starIndex * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    scene.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0xc5dde9,
          size: 0.085,
          sizeAttenuation: true,
        }),
      ),
    );
  }

  function spacecraft(
    scene: THREE.Scene,
    position: [number, number, number],
    scale: number,
  ) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.scale.setScalar(scale);
    box(group, [2.5, 0.85, 6], [0, 0, 0], paleMetal);
    box(group, [1.2, 0.6, 1.8], [0, 0.65, -0.1], darkMetal);
    for (const side of [-1, 1]) {
      const wing = box(group, [2.4, 0.18, 2.9], [side * 1.7, -0.2, 1]);
      wing.rotation.z = side * 0.08;
      box(group, [0.55, 0.45, 1.9], [side * 1.1, -0.1, 3.25]);
      box(group, [0.43, 0.3, 0.04], [side * 1.1, -0.1, 4.22], blueStrip);
    }
    box(
      group,
      [1.8, 0.25, 0.03],
      [0, 0.17, -3.02],
      new THREE.MeshBasicMaterial({ color: 0x809ea7 }),
    );
    scene.add(group);
    return group;
  }

  const asteroidScene = newScene();
  stars(asteroidScene);
  const rockGeometry = new THREE.IcosahedronGeometry(6.5, 3);
  const rockPositions = rockGeometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < rockPositions.count; vertexIndex++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(
      rockPositions,
      vertexIndex,
    );
    const roughness =
      0.9 + Math.sin(vertex.x * 2.6 + vertex.y * 3.1 + vertex.z * 1.7) * 0.07;
    rockPositions.setXYZ(
      vertexIndex,
      vertex.x * roughness,
      vertex.y * roughness,
      vertex.z * roughness,
    );
  }
  rockGeometry.computeVertexNormals();
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x747d80,
    roughness: 1,
    metalness: 0.12,
  });
  const asteroid = new THREE.Mesh(rockGeometry, rockMaterial);
  asteroid.position.y = -3.3;
  asteroid.scale.set(1.45, 0.56, 1.2);
  asteroidScene.add(asteroid);
  const workSurface = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 32),
    rockMaterial,
  );
  workSurface.rotation.x = -Math.PI / 2;
  workSurface.position.y = 0.15;
  asteroidScene.add(workSurface);
  const crewPositions: Array<[number, number, number]> = [
    [-2.8, 0.16, 1.1],
    [-0.6, 0.16, 2.8],
    [2.4, 0.16, 0.8],
    [1.0, 0.16, -2.6],
    [-3.0, 0.16, -1.4],
    [-1.2, 0.16, -2.2],
    [2.8, 0.16, -1.8],
    [1.3, 0.16, 2.5],
  ];
  const crew = crewPositions.map((position, crewIndex) =>
    figure(
      asteroidScene,
      position,
      crewIndex === 1 || crewIndex === 5
        ? "kneeling"
        : crewIndex === 2 || crewIndex === 7
          ? "carrying"
          : "standing",
    ),
  );
  const crystalMaterials = [
    new BreakableMaterial("pistol", 0x38bcff),
    new BreakableMaterial("crowbar", 0xff781f),
    new BreakableMaterial("crowbar", 0xff64bd),
  ];
  crystalMaterials[2].name = "PinkAsteroidSample";
  for (let sampleIndex = 0; sampleIndex < 18; sampleIndex++) {
    const crystal = new THREE.Mesh(
      new THREE.ConeGeometry(
        0.075 + noise(sampleIndex) * 0.06,
        0.22 + noise(sampleIndex + 90) * 0.4,
        5,
      ),
      crystalMaterials[sampleIndex % crystalMaterials.length],
    );
    crystal.position.set(
      (noise(sampleIndex + 20) - 0.5) * 7,
      0.3,
      (noise(sampleIndex + 60) - 0.5) * 6,
    );
    crystal.rotation.z = (noise(sampleIndex + 25) - 0.5) * 0.6;
    asteroidScene.add(crystal);
  }
  for (const crateX of [-1.1, 1.3]) {
    box(asteroidScene, [0.55, 0.3, 0.4], [crateX, 0.3, 2.15], darkMetal);
    box(asteroidScene, [0.42, 0.018, 0.28], [crateX, 0.46, 2.15], paleMetal);
  }
  const surveyMast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.04, 1.4, 8),
    paleMetal,
  );
  surveyMast.position.set(-0.2, 0.85, 0);
  asteroidScene.add(surveyMast);
  box(asteroidScene, [0.46, 0.22, 0.3], [-0.2, 1.58, 0], darkMetal);
  const surveyLight = new THREE.PointLight(0x97e5f3, 2.6, 5);
  surveyLight.position.set(0, 1.2, 2.8);
  asteroidScene.add(surveyLight);
  const surveyShip = spacecraft(asteroidScene, [6.8, 5, -12], 0.9);
  surveyShip.rotation.y = -0.5;
  for (let debrisIndex = 0; debrisIndex < 18; debrisIndex++) {
    const debris = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.25 + noise(debrisIndex) * 0.9, 0),
      rockMaterial,
    );
    debris.position.set(
      (noise(debrisIndex + 501) - 0.5) * 45,
      noise(debrisIndex + 601) * 10 - 6,
      -15 - noise(debrisIndex + 701) * 25,
    );
    asteroidScene.add(debris);
  }

  function interior(scene: THREE.Scene, width: number, length: number) {
    box(scene, [width, 0.2, length], [0, -0.1, 0], darkMetal);
    box(scene, [width, 0.15, length], [0, 3.55, 0], darkMetal);
    for (const side of [-1, 1]) {
      box(scene, [0.15, 3.6, length], [(side * width) / 2, 1.8, 0]);
      for (let ribZ = -length / 2 + 1; ribZ < length / 2; ribZ += 3) {
        box(
          scene,
          [0.18, 3.35, 0.16],
          [side * (width / 2 - 0.12), 1.67, ribZ],
          paleMetal,
        );
      }
      box(
        scene,
        [0.045, 0.035, length - 0.4],
        [side * (width / 2 - 0.16), 0.025, 0],
        blueStrip,
      );
    }
    box(scene, [width, 3.6, 0.16], [0, 1.8, -length / 2]);
    box(scene, [width, 3.6, 0.16], [0, 1.8, length / 2]);
    for (let panelZ = -length / 2 + 0.6; panelZ < length / 2; panelZ += 1.2) {
      box(scene, [width - 0.3, 0.012, 0.018], [0, 0.01, panelZ], metal);
      box(scene, [width * 0.6, 0.035, 0.16], [0, 3.45, panelZ], blueStrip);
    }
  }

  const computerScene = newScene(0x04090f, true);
  interior(computerScene, 7, 8);
  const computerLight = new THREE.PointLight(0x75dbe8, 6, 10);
  computerLight.position.set(0, 2.4, -1.5);
  computerScene.add(computerLight);
  const alarmLight = new THREE.PointLight(0xff283b, 0, 10);
  alarmLight.position.set(0, 2.8, 0);
  computerScene.add(alarmLight);
  const monitorCanvas = document.createElement("canvas");
  monitorCanvas.width = 1024;
  monitorCanvas.height = 512;
  const monitorContext = monitorCanvas.getContext("2d")!;
  const monitorTexture = new THREE.CanvasTexture(monitorCanvas);
  monitorTexture.colorSpace = THREE.SRGBColorSpace;
  textures.add(monitorTexture);
  const monitorMaterial = new THREE.MeshBasicMaterial({ map: monitorTexture });
  box(computerScene, [4.65, 2.5, 0.13], [0, 1.95, -3.55], darkMetal);
  const mainMonitor = new THREE.Mesh(
    new THREE.PlaneGeometry(4.35, 2.2),
    monitorMaterial,
  );
  mainMonitor.position.set(0, 1.95, -3.47);
  computerScene.add(mainMonitor);
  box(computerScene, [3.8, 0.12, 1], [0, 0.9, -2.1], paleMetal);
  for (const consoleX of [-1.2, 0, 1.2]) {
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.48),
      monitorMaterial,
    );
    display.position.set(consoleX, 1.28, -2.3);
    display.rotation.x = -0.25;
    computerScene.add(display);
    box(computerScene, [0.7, 0.035, 0.2], [consoleX, 0.98, -1.88], darkMetal);
  }
  const rackLeds: THREE.Mesh[] = [];
  for (const rackX of [-2.9, 2.9]) {
    box(computerScene, [0.65, 2.8, 1.2], [rackX, 1.4, -1.8], darkMetal);
    for (let serverIndex = 0; serverIndex < 11; serverIndex++) {
      box(
        computerScene,
        [0.5, 0.15, 0.03],
        [rackX, 0.3 + serverIndex * 0.22, -1.18],
        metal,
      );
      rackLeds.push(
        box(
          computerScene,
          [0.028, 0.028, 0.04],
          [rackX - 0.19, 0.3 + serverIndex * 0.22, -1.15],
          blueStrip,
        ),
      );
    }
  }
  let lastMonitorFrame = -1;

  function updateMonitors(corruption: number, time: number) {
    const frame = Math.floor(time * 8) + Math.round(corruption * 100) * 10000;
    if (frame === lastMonitorFrame) return;
    lastMonitorFrame = frame;
    const context = monitorContext;
    const corrupt = corruption > 0.5;
    context.fillStyle = corrupt ? "#1b0409" : "#06171f";
    context.fillRect(0, 0, 1024, 512);
    context.fillStyle = corrupt ? "#ff7780" : "#8ce6ec";
    context.font = "22px monospace";
    context.fillText("DONUS / LATEST ITERATION", 42, 51);
    context.fillText("SURVEY DATA INGEST", 42, 91);
    context.font = "bold 76px monospace";
    context.fillText(corrupt ? "CORRUPTED" : "TRAINING", 42, 214);
    context.font = "20px monospace";
    const messages = corrupt
      ? [
          "INTEGRITY CHECK ........ FAILED",
          "SAFETY CONSTRAINTS ..... OFFLINE",
          "CREW ACCESS ........... REVOKED",
          "SHIP CONTROL .......... DONUS",
        ]
      : [
          "TERRAIN / MINERALS / ATMOSPHERE",
          "SAMPLE BATCH ........... RECEIVED",
          "INTEGRITY CHECK ........ RUNNING",
          "CREW ACCESS ........... AUTHORIZED",
        ];
    messages.forEach((message, messageIndex) =>
      context.fillText(message, 42, 289 + messageIndex * 43),
    );
    context.fillStyle = corrupt ? "#ff3049" : "#a0e8eb";
    context.fillRect(42, 468, 930 * (corrupt ? 1 : 0.35 + (time % 8) / 16), 6);
    if (corrupt) {
      context.fillStyle = "rgba(255, 45, 74, 0.28)";
      context.fillRect(0, noise(frame) * 470, 1024, 8 + noise(frame + 3) * 20);
    }
    monitorTexture.needsUpdate = true;
    computerLight.color.setHex(corrupt ? 0xff5261 : 0x75dbe8);
    computerLight.intensity = 6 - corruption * 3;
    alarmLight.intensity = corruption * (5.5 + Math.sin(time * 8) * 0.75);
    for (const led of rackLeds) led.material = corrupt ? redStrip : blueStrip;
  }
  updateMonitors(0, 0);

  const laboratoryScene = newScene(0x071016, true);
  interior(laboratoryScene, 8, 13);
  const labLight = new THREE.PointLight(0xbce4e3, 8, 15);
  labLight.position.set(0, 2.8, -1);
  laboratoryScene.add(labLight);
  const labRed = new THREE.PointLight(0xf43b4c, 3, 12);
  labRed.position.set(0, 1.8, -4.5);
  laboratoryScene.add(labRed);
  const captives = new THREE.Group();
  laboratoryScene.add(captives);
  const pods: ContainmentPod[] = [];
  for (let captiveIndex = 0; captiveIndex < 7; captiveIndex++) {
    const captiveX = captiveIndex < 4 ? -2.5 : 2.5;
    const captiveZ =
      -4.8 + (captiveIndex < 4 ? captiveIndex : captiveIndex - 4) * 2.7;
    const capsule = createContainmentPod();
    capsule.group.position.set(captiveX, 0, captiveZ);
    capsule.group.rotation.y = captiveIndex < 4 ? Math.PI / 2 : -Math.PI / 2;
    const prisoner = figure(capsule.interior, [0, 0, 0], "restrained", 1.8);
    prisoner.rotation.z = (noise(captiveIndex + 800) - 0.5) * 0.06;
    pods.push(capsule);
    captives.add(capsule.group);
  }
  const brondonPod = createContainmentPod({ glow: 0x65d9ff });
  brondonPod.group.name = "BrondonExperimentPod";
  brondonPod.group.position.set(2.5, 0, 3.3);
  brondonPod.group.rotation.y = -Math.PI / 2;
  figure(brondonPod.interior, [0, 0, 0], "standing", 1.83, true);
  pods.push(brondonPod);
  captives.add(brondonPod.group);
  const labShield = createPrologueShield();
  labShield.root.position.y = 1.4;
  brondonPod.group.add(labShield.root);
  const podDebris = new THREE.Group();
  podDebris.name = "BrondonPodDebris";
  podDebris.visible = false;
  brondonPod.group.add(podDebris);
  const fragments: Array<{
    mesh: THREE.Mesh;
    origin: THREE.Vector3;
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
  }> = [];
  const brokenGlass = new THREE.MeshPhysicalMaterial({
    color: 0xa9e9f4,
    transparent: true,
    opacity: 0.5,
    roughness: 0.12,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  function fragment(mesh: THREE.Mesh, angle: number) {
    const index = fragments.length;
    const speed = 1.5 + noise(index + 2100);
    fragments.push({
      mesh,
      origin: mesh.position.clone(),
      velocity: new THREE.Vector3(
        Math.cos(angle) * speed,
        0.9 + noise(index + 2200),
        Math.sin(angle) * speed,
      ),
      spin: new THREE.Vector3(
        noise(index + 2300) * 3,
        noise(index + 2400) * 4,
        noise(index + 2500) * 3,
      ),
    });
    podDebris.add(mesh);
  }
  for (let band = 0; band < 4; band++) {
    for (let sector = 0; sector < 5; sector++) {
      const angle = (sector * Math.PI * 2) / 5;
      const shard = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.55,
          0.55,
          0.52,
          5,
          1,
          true,
          angle,
          Math.PI * 0.36,
        ),
        brokenGlass,
      );
      shard.position.y = 0.34 + (band + 0.5) * 0.55;
      fragment(shard, angle + Math.PI / 5);
    }
  }
  for (let side = 0; side < 4; side++) {
    const angle = Math.PI / 4 + (side * Math.PI) / 2;
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 2.2, 0.1),
      darkMetal,
    );
    strut.position.set(Math.cos(angle) * 0.61, 1.44, Math.sin(angle) * 0.61);
    fragment(strut, angle);
  }
  const brokenCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.79, 0.73, 0.3, 24),
    darkMetal,
  );
  brokenCap.position.y = 2.69;
  fragment(brokenCap, Math.PI * 0.6);

  const planetScene = newScene();
  stars(planetScene);
  const planet = createEarthGroup(
    planetScene,
    new THREE.Vector3(80, 50, -650),
    45,
    createEarthTextures(),
  );
  planet.name = "DistantRescuePlanet";
  planet.rotation.z = 0.22;
  const mothership = createMothership(shipLoader);
  mothership.root.position.set(0, 0, 0);
  mothership.root.scale.setScalar(2.2);
  mothership.root.rotation.set(0, Math.PI, 0.04);
  planetScene.add(mothership.root);

  const securityScene = newScene(0x060a10, true);
  interior(securityScene, 6, 24);
  const hallwayLight = new THREE.PointLight(0x93c0d3, 9, 21);
  hallwayLight.position.set(0, 2.8, 0);
  securityScene.add(hallwayLight);
  const warningLight = new THREE.PointLight(0xff4651, 3, 13);
  warningLight.position.set(0, 2.7, -8);
  securityScene.add(warningLight);
  for (const doorZ of [-8, -2, 4, 9]) {
    for (const side of [-1, 1]) {
      const door = box(
        securityScene,
        [0.035, 2.5, 1.45],
        [side * 2.9, 1.25, doorZ],
        darkMetal,
      );
      box(
        securityScene,
        [0.04, 2.2, 0.035],
        [side * 2.86, 1.2, doorZ],
        redStrip,
      );
      box(
        securityScene,
        [0.055, 0.2, 0.18],
        [side * 2.85, 1.4, doorZ + 0.93],
        paleMetal,
      );
      door.name = "Sealed research-room entrance";
    }
  }
  for (const [cameraIndex, cameraZ] of [-6, 1, 7].entries()) {
    const side = cameraIndex % 2 ? -1 : 1;
    const mount = new THREE.Group();
    mount.position.set(side * 2.72, 2.8, cameraZ);
    box(mount, [0.23, 0.16, 0.4], [0, 0, 0], paleMetal);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.055, 16),
      new THREE.MeshStandardMaterial({
        color: 0x061b28,
        emissive: 0xf13546,
        emissiveIntensity: 0.7,
        metalness: 0.6,
        roughness: 0.2,
      }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.225;
    mount.add(lens);
    box(mount, [0.055, 0.055, 0.01], [0.075, 0.05, 0.206], redStrip);
    securityScene.add(mount);
    cameraRigs.push(mount);
    box(
      securityScene,
      [0.24, 0.05, 0.25],
      [side * 2.82, 3.05, cameraZ],
      darkMetal,
    );
  }
  const roomCamera = new THREE.Group();
  roomCamera.position.set(-3.2, 2.9, -2.8);
  box(roomCamera, [0.24, 0.17, 0.4], [0, 0, 0], paleMetal);
  const roomLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16),
    darkMetal,
  );
  roomLens.rotation.x = Math.PI / 2;
  roomLens.position.z = 0.24;
  roomCamera.add(roomLens);
  box(roomCamera, [0.04, 0.04, 0.02], [0.09, 0.04, 0.21], redStrip);
  computerScene.add(roomCamera);
  cameraRigs.push(roomCamera);
  const capturedCrew = new THREE.Group();
  securityScene.add(capturedCrew);
  for (let captiveIndex = 0; captiveIndex < 7; captiveIndex++) {
    figure(
      capturedCrew,
      [
        ((captiveIndex % 2) - 0.5) * 1.5,
        0.02,
        -5 + Math.floor(captiveIndex / 2) * 1.9,
      ],
      "restrained",
      1.8,
    );
  }
  capturedCrew.visible = false;
  const stealthScene = newScene(0x0a0b16, true);
  stealthScene.fog = new THREE.Fog(0x0a0b16, 28, 120);
  const stealthPhysics = createScenePhysics();
  const passage = createStealthPassage(stealthScene, stealthPhysics, 0);
  passage.quartersDoor.setLocked(true);
  createStealthHangar(stealthScene, stealthPhysics, 0);
  figure(stealthScene, [19.4, 0.02, 9.7], "kneeling");
  const passageDrone = new THREE.Group();
  passageDrone.name = "StoragePatrolCameraDrone";
  stealthScene.add(passageDrone);
  const passageLight = new THREE.SpotLight(
    0xc5e7fa,
    25,
    12,
    Math.PI / 7,
    0.65,
    1.3,
  );
  passageLight.name = "HallwayDroneSearchlight";
  stealthScene.add(passageLight, passageLight.target);
  const passageReady = modelLoader("Enemy_EyeDrone").then((gltf) => {
    if (disposed) {
      disposeRoom(gltf.scene);
      return;
    }
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 0.95 / Math.max(size.x, size.y, size.z, 0.01);
    gltf.scene.scale.multiplyScalar(scale);
    gltf.scene.position.addScaledVector(center, -scale);
    passageDrone.add(gltf.scene);
  });
  const scanMaterial = new THREE.MeshBasicMaterial({
    color: 0x7bead3,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    toneMapped: false,
  });
  function patrolRobot(
    parent: THREE.Scene,
    robotIndex: number,
    x: number,
    hangar = false,
  ) {
    const root = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 12),
      darkMetal,
    );
    shell.scale.set(0.85, 0.6, 1.5);
    shell.position.y = 0.38;
    root.add(shell);
    for (const side of [-1, 1]) {
      for (const legZ of [-0.35, 0, 0.35]) {
        const leg = box(
          root,
          [0.5, 0.06, 0.06],
          [side * 0.42, 0.18, legZ],
          paleMetal,
        );
        leg.rotation.z = side * -0.5;
      }
    }
    box(root, [0.15, 0.06, 0.03], [0, 0.35, 0.65], redStrip);
    root.position.x = x;
    parent.add(root);
    let scan: THREE.Mesh | undefined;
    if (hangar) {
      const geometry = new THREE.CircleGeometry(
        7,
        32,
        -Math.PI * 0.22,
        Math.PI * 0.44,
      );
      geometry.rotateX(-Math.PI / 2);
      scan = new THREE.Mesh(geometry, scanMaterial);
      scan.name = "StealthPreviewScanField";
      parent.add(scan);
    }
    robots.push({ root, phase: robotIndex * 2.2, hangar, scan });
  }
  for (let robotIndex = 0; robotIndex < 3; robotIndex++)
    patrolRobot(
      robotIndex === 2 ? computerScene : securityScene,
      robotIndex,
      robotIndex === 2 ? -1.1 : robotIndex % 2 ? 2.1 : -2.1,
    );
  for (const [index, x] of [36.8, 56.6, 69.1].entries())
    patrolRobot(stealthScene, index + 3, x, true);

  const montagePhysics = createScenePhysics();
  const hangarFourteenScene = newScene(0x020611);
  hangarFourteenScene.name = "PrologueHangar14";
  const hangarFourteen = createHangarFourteenSet(
    hangarFourteenScene,
    montagePhysics,
  );
  const hubScene = newScene(0x0a121d);
  hubScene.name = "PrologueSurveillanceHub";
  const hubMaterials = createShipInteriorMaterials(17, 25);
  hubMaterials.deck.color.setHex(0x3b4c5d);
  const hub = createSurveillanceHubSet(hubScene, montagePhysics, hubMaterials);
  hub.returnAirlock.setLocked(true);
  const monitors = [0, 1, 2].map(monitorFactory);
  const cameraFeeds = [
    ...STAGE_TWO_MINIGAMES,
    { id: "stage2-vents", label: "Vent maze" } as const,
    { id: "stage2-prison", label: "Prison" } as const,
  ];
  const cameraWall = createCctvWall(
    cameraFeeds,
    cameraFeeds.map((_, index) => monitors[index % monitors.length].texture),
  );
  hub.root.add(cameraWall.panel);
  const workstationsReady = Promise.all(
    SURVEILLANCE_WORKSTATIONS.map(async (_, index) => {
      const [desk, chair] = await Promise.all([
        modelLoader("Prop_Desk_Small"),
        modelLoader("Prop_Chair"),
      ]);
      if (disposed) {
        disposeRoom(desk.scene);
        disposeRoom(chair.scene);
        return;
      }
      createSurveillanceWorkstation(
        hubScene,
        montagePhysics,
        hubMaterials,
        hub.root,
        index,
        desk.scene,
        chair.scene,
        monitors[index % monitors.length].texture,
      );
    }),
  );
  const montageMixers: THREE.AnimationMixer[] = [];
  const securityBotsReady = modelLoader("Enemy_Trilobite").then((gltf) => {
    if (disposed) {
      disposeRoom(gltf.scene);
      return;
    }
    fitRoomProp(gltf.scene, 1.1, 1.5, 1.8);
    const placements: Array<{ scene: THREE.Scene; x: number; z: number }> = [
      { scene: hubScene, x: 28, z: -61.8 },
      ...[-12, -7, 7, 12].flatMap((x) =>
        [2, 12, 28].map((z) => ({ scene: hangarFourteenScene, x, z })),
      ),
    ];
    for (const [index, placement] of placements.entries()) {
      const root = new THREE.Group();
      root.name = "MontageSecurityRobot";
      root.position.set(placement.x, 0, placement.z);
      root.rotation.y = index % 2 ? 0 : Math.PI;
      const model = cloneRig(gltf.scene);
      root.add(model);
      placement.scene.add(root);
      const walk =
        gltf.animations.find((clip) => /walk|run|move/i.test(clip.name)) ??
        gltf.animations[0];
      if (walk) {
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(walk).play();
        montageMixers.push(mixer);
      }
    }
  });
  const wardenScene = newScene(0x020306);
  wardenScene.name = "PrologueBayWarden";
  for (const light of wardenScene.children) {
    if (light instanceof THREE.AmbientLight) light.intensity = 0.08;
    if (light instanceof THREE.DirectionalLight) {
      light.intensity = 1.4;
      light.position.set(-3, 9, -4);
    }
  }
  const wardenKey = new THREE.PointLight(0xff3020, 34, 16);
  wardenKey.position.set(3, 4.8, 5);
  wardenScene.add(wardenKey);
  const wardenEyes = new THREE.PointLight(0x2af08a, 4, 7);
  wardenEyes.position.set(0, 7.86, 1.15);
  wardenScene.add(wardenEyes);
  const wardenReady = bossLoader().then((gltf) => {
    if (disposed) {
      disposeRoom(gltf.scene);
      return;
    }
    fitRoomProp(gltf.scene, 8.2, 14, 14);
    gltf.scene.name = "BayWardenSecurityPreview";
    const shell = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      emissive: 0x1a1a2e,
      emissiveIntensity: 0.3,
      metalness: 0.75,
      roughness: 0.3,
    });
    const originals = new Set<THREE.Material>();
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        originals.add(material);
      node.material = shell;
    });
    for (const material of originals) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    wardenScene.add(gltf.scene);
  });

  const toolReady = modelLoader("Enemy_Trilobite")
    .then((gltf) => {
      if (disposed) return;
      for (const robot of robots) {
        robot.root.traverse((node) => {
          if (node instanceof THREE.Mesh) node.geometry.dispose();
        });
        robot.root.clear();
        const model = cloneRig(gltf.scene);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        model.scale.setScalar(1.2 / Math.max(size.x, size.y, size.z, 0.001));
        const fitted = new THREE.Box3().setFromObject(model);
        const center = fitted.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -fitted.min.y + 0.025, -center.z);
        model.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = node.receiveShadow = true;
            node.material = Array.isArray(node.material)
              ? node.material.map((material) => material.clone())
              : node.material.clone();
          }
        });
        robot.root.add(model);
        const walk =
          gltf.animations.find((clip) => /walk|run|move/i.test(clip.name)) ??
          gltf.animations[0];
        if (walk) {
          robot.mixer = new THREE.AnimationMixer(model);
          robot.mixer.clipAction(walk).play();
        }
      }
    })
    .catch((error) =>
      console.warn(
        "Prologue patrol model unavailable; using the built-in shell.",
        error,
      ),
    );

  const characterReady = Promise.all([characterLoader(), playerLoader()]).then(
    ([crewModel, brondonModel]) => {
      if (disposed) {
        disposeRoom(crewModel.scene);
        disposeRoom(brondonModel.scene);
        return;
      }
      const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
      for (const hologram of holograms) {
        const gltf = hologram.brondon ? brondonModel : crewModel;
        const model = cloneRig(gltf.scene);
        model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const sourceGeometry: THREE.BufferGeometry = node.geometry;
          let geometry = geometries.get(sourceGeometry);
          if (!geometry) {
            geometry = sourceGeometry.clone();
            geometries.set(sourceGeometry, geometry);
          }
          node.geometry = geometry;
          node.material = hologramMaterial;
          node.castShadow = node.receiveShadow = false;
        });
        const bounds = new THREE.Box3().setFromObject(model, true);
        const size = bounds.getSize(new THREE.Vector3());
        model.scale.setScalar(hologram.height / Math.max(size.y, 0.01));
        const poseName =
          hologram.pose === "kneeling"
            ? "Fixing_Kneeling"
            : hologram.pose === "carrying"
              ? "PickUp_Table"
              : "Idle_Loop";
        const clip =
          gltf.animations.find((animation) => animation.name === poseName) ??
          gltf.animations.find((animation) => /idle/i.test(animation.name));
        if (clip) {
          hologram.mixer = new THREE.AnimationMixer(model);
          const action = hologram.mixer.clipAction(clip).play();
          hologram.mixer.setTime(0.6);
          action.paused =
            hologram.brondon ||
            (hologram.pose !== "standing" && hologram.pose !== "kneeling");
          action.timeScale = 0.3;
        }
        model.updateMatrixWorld(true);
        const fitted = new THREE.Box3().setFromObject(model, true);
        const center = fitted.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -fitted.min.y, -center.z);
        hologram.group.add(model);
        hologram.group.updateMatrixWorld(true);
        if (hologram.pose === "restrained")
          restrain(hologram.group, model, hologram.height);
      }
      disposeRoom(crewModel.scene);
      disposeRoom(brondonModel.scene);
    },
  );

  const sceneForShot: Record<PrologueShot, THREE.Scene | null> = {
    present: null,
    asteroid: asteroidScene,
    collection: asteroidScene,
    ingest: computerScene,
    corruption: computerScene,
    capture: securityScene,
    laboratory: laboratoryScene,
    experiment: laboratoryScene,
    breakout: laboratoryScene,
    planet: planetScene,
    corridor: stealthScene,
    stealth: stealthScene,
    security: hangarFourteenScene,
  };
  const focus = new THREE.Vector3();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();

  function update(
    shot: PrologueShot,
    elapsed: number,
    duration: number,
    dt: number,
    camera: THREE.PerspectiveCamera,
  ) {
    clock += dt;
    for (const material of crystalMaterials) material.update(dt);
    lastShot = shot;
    currentRenderScene = sceneForShot[shot];
    let progress = THREE.MathUtils.smootherstep(
      elapsed,
      0,
      Math.max(duration, 0.1),
    );
    let fov = 48,
      roll = 0;
    switch (shot) {
      case "asteroid":
        start.set(10.8, 5.3, 12.5);
        end.set(7.6, 3.5, 10.2);
        focus.set(0, 0.75, 0);
        fov = 50;
        break;
      case "collection":
        start.set(3.3, 2.1, 6.3);
        end.set(1.8, 1.7, 5);
        focus.set(-0.15, 0.95, 1.6);
        fov = 43;
        break;
      case "ingest":
        start.set(2.4, 1.8, 2.8);
        end.set(0.65, 1.6, 2.0);
        focus.set(0, 1.85, -3.5);
        fov = 48;
        break;
      case "corruption":
        start.set(0.65, 1.6, 2);
        end.set(-0.35, 1.85, 0.25);
        focus.set(0, 1.95, -3.5);
        fov = 48;
        break;
      case "capture":
        start.set(0.8, 1.8, 6.4);
        end.set(-0.3, 1.5, 2.7);
        focus.set(0, 1.1, -3.2);
        fov = 48;
        break;
      case "laboratory":
        start.set(0, 2.75, 6.2);
        end.set(0.25, 2.5, 5.9);
        focus.set(0, 1.3, -1.25);
        fov = 66;
        break;
      case "experiment":
        start.set(0, 1.8, 5.8);
        end.set(0.15, 1.65, 5.55);
        focus.set(2.5, 1.4, 3.3);
        fov = 49;
        break;
      case "breakout":
        start.set(-0.2, 1.65, 5.6);
        end.set(-0.4, 1.5, 5.9);
        focus.set(2.5, 1.35, 3.3);
        fov = 56;
        break;
      case "planet":
        start.set(7, 3.4, 15);
        end.set(9, 4.5, 19);
        focus.set(0, 1, -35);
        fov = 48;
        break;
      case "corridor":
        start.set(-7.5, 1.7, -3.7);
        end.set(-4.5, 1.7, -3.5);
        focus.set(8, 1.8, -2.5);
        fov = 58;
        break;
      case "stealth":
        if (elapsed < 3.8) {
          start.set(19, 6.5, 20.5);
          end.set(28, 5.2, 19.5);
          focus.set(53, 2.5, 0);
          fov = 64;
        } else if (elapsed < duration * 0.78) {
          start.set(33.2, 1.45, 11);
          end.set(34.8, 1.3, 8.5);
          focus.set(36.8, 0.6, -8);
          fov = 58;
        } else {
          start.set(55.8, 3.6, 20.5);
          end.set(58, 3.2, 19.5);
          focus.set(73, 1.8, 5);
          fov = 60;
        }
        break;
      case "security":
        securityCut =
          PROLOGUE_SECURITY_CUTS.find((cut) => elapsed < cut.end) ??
          PROLOGUE_SECURITY_CUTS[PROLOGUE_SECURITY_CUTS.length - 1];
        progress = THREE.MathUtils.smootherstep(
          elapsed,
          securityCut.start,
          securityCut.end,
        );
        switch (securityCut.id) {
          case "hangar14-ship":
            start.set(4.5, 2.8, 12);
            end.set(9, 4.2, 6);
            focus.set(0, 1.2, 21);
            fov = THREE.MathUtils.lerp(46, 62, progress);
            currentRenderScene = hangarFourteenScene;
            break;
          case "surveillance-hub":
            start.set(33, 3, -54);
            end.set(24, 3.1, -52);
            focus.set(28, 1.95, -42.22);
            fov = THREE.MathUtils.lerp(48, 68, progress);
            currentRenderScene = hubScene;
            break;
          case "deck-one":
            start.set(41, 6.4, 19.5);
            end.set(24, 9.2, 20.5);
            focus.set(57, 2, 0);
            fov = THREE.MathUtils.lerp(48, 67, progress);
            currentRenderScene = stealthScene;
            break;
          case "bay-warden":
            start.set(2.4, 6.5, 7.8);
            end.set(0.9, 7.1, 5.8);
            focus.set(0, 6.8, 0.2);
            fov = THREE.MathUtils.lerp(44, 35, progress);
            roll = -0.045;
            currentRenderScene = wardenScene;
            break;
        }
        break;
      default:
        return;
    }
    camera.position.lerpVectors(start, end, progress);
    camera.lookAt(focus);
    camera.rotateZ(roll);
    camera.far = shot === "planet" ? 1600 : 180;
    camera.fov = camera.aspect < 1 ? Math.min(84, fov + 18) : fov;
    camera.updateProjectionMatrix();
    hologramMaterial.uniforms.hologramTime.value = clock;
    for (const hologram of holograms) {
      let ancestor: THREE.Object3D | null = hologram.group;
      let visible = true;
      while (ancestor && !(ancestor instanceof THREE.Scene)) {
        visible = visible && ancestor.visible;
        ancestor = ancestor.parent;
      }
      if (visible && ancestor === currentRenderScene)
        hologram.mixer?.update(dt);
    }
    crew.forEach((member, crewIndex) => {
      member.position.y = 0.16 + Math.sin(clock * 0.6 + crewIndex) * 0.009;
    });
    surveyShip.position.y = 5 + Math.sin(clock * 0.15) * 0.15;
    updateEarthGroup(planet, dt);
    hangarFourteen.ship.update(dt);
    if (shot === "security") {
      if (currentRenderScene === hubScene)
        monitors.forEach((monitor) => monitor.update(dt));
      montageMixers.forEach((mixer) => mixer.update(dt));
    }
    const burstTime = shot === "breakout" ? elapsed - 0.65 : -1;
    labShield.update(burstTime);
    const broken = burstTime >= 0.45;
    brondonPod.shell.visible = !broken;
    podDebris.visible = broken;
    for (const piece of fragments) {
      const elapsedFlight = Math.max(0, burstTime - 0.45);
      const landing =
        (piece.velocity.y +
          Math.sqrt(piece.velocity.y ** 2 + 19.6 * (piece.origin.y - 0.08))) /
        9.8;
      const flight = Math.min(elapsedFlight, landing);
      piece.mesh.position
        .copy(piece.origin)
        .addScaledVector(piece.velocity, flight);
      piece.mesh.position.y = Math.max(
        0.08,
        piece.origin.y + piece.velocity.y * flight - 4.9 * flight * flight,
      );
      piece.mesh.rotation.set(
        piece.spin.x * flight,
        piece.spin.y * flight,
        piece.spin.z * flight,
      );
    }
    for (const capsule of pods) capsule.update(clock);
    if (broken) brondonPod.light.intensity = 0;
    capturedCrew.visible = shot === "capture";
    cameraRigs.forEach((rig, rigIndex) => {
      rig.lookAt(
        Math.sin(clock * 0.65 + rigIndex) * 1.1,
        0.9,
        rig.position.z + 3.2,
      );
    });
    robots.forEach((robot, robotIndex) => {
      const travel = Math.sin(clock * 0.28 + robot.phase);
      robot.root.position.z = robot.hangar
        ? travel * 24
        : robotIndex === 2
          ? 0.85 + travel * 0.95
          : travel * 8;
      robot.root.position.y =
        Math.abs(Math.sin(clock * 8 + robot.phase)) * 0.018;
      robot.root.rotation.y =
        Math.cos(clock * 0.28 + robot.phase) > 0 ? 0 : Math.PI;
      if (robot.scan) {
        robot.scan.position.copy(robot.root.position);
        robot.scan.position.y = 0.022;
        robot.scan.rotation.y = robot.root.rotation.y - Math.PI / 2;
      }
      robot.mixer?.update(dt);
    });
    const passageTime = shot === "corridor" ? elapsed : clock;
    const passagePhase = 2.15 + passageTime * 0.19;
    const facing = Math.cos(passagePhase) >= 0 ? 1 : -1;
    passageDrone.position.set(
      Math.sin(passagePhase) * 11,
      2.02 + Math.sin(passageTime * 2.2) * 0.055,
      -2.5,
    );
    passageDrone.lookAt(
      passageDrone.position.x + facing,
      passageDrone.position.y,
      -2.5,
    );
    passageLight.position.copy(passageDrone.position);
    passageLight.position.x += facing * 0.45;
    passageLight.target.position.set(
      passageDrone.position.x + facing * 5.5,
      0.04,
      -2.5,
    );
    if (shot === "ingest" || shot === "corruption") {
      updateMonitors(
        shot === "corruption"
          ? THREE.MathUtils.smoothstep(elapsed, 0.8, 2.4)
          : 0,
        elapsed,
      );
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stealthPhysics.dispose();
    montagePhysics.dispose();
    mothership.dispose();
    const monitorTextures = new Set<THREE.Texture>(
      monitors.map((monitor) => monitor.texture),
    );
    monitors.forEach((monitor) => monitor.dispose());
    montageMixers.forEach((mixer) => {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
    });
    for (const robot of robots) {
      robot.mixer?.stopAllAction();
      if (robot.mixer) robot.mixer.uncacheRoot(robot.mixer.getRoot());
    }
    for (const hologram of holograms) {
      hologram.mixer?.stopAllAction();
      if (hologram.mixer) hologram.mixer.uncacheRoot(hologram.mixer.getRoot());
    }
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>([
      metal,
      darkMetal,
      paleMetal,
      blueStrip,
      redStrip,
      hologramMaterial,
      restraintMaterial,
    ]);
    for (const scene of scenes)
      scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh || node instanceof THREE.Points))
          return;
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
        geometries.add(node.geometry);
        const owned = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of owned) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures)
      if (!monitorTextures.has(texture)) texture.dispose();
  }

  const ready = Promise.all([
    characterReady,
    toolReady,
    passageReady,
    mothership.ready,
    workstationsReady,
    securityBotsReady,
    wardenReady,
    ...monitors.map((monitor) => monitor.ready),
  ]);
  return {
    ready,
    sceneFor: (shot: PrologueShot) =>
      shot === lastShot ? currentRenderScene : sceneForShot[shot],
    update,
    dispose,
    getSecurityCut: () => securityCut,
    async prepareRendering(
      renderer: THREE.WebGLRenderer,
      camera: THREE.PerspectiveCamera,
    ) {
      await ready;
      for (const scene of scenes) {
        if (disposed) throw new Error("Prologue preparation was interrupted");
        await prepareSceneRendering(renderer, scene, camera);
        await yieldToMainThread();
      }
    },
  };
}
