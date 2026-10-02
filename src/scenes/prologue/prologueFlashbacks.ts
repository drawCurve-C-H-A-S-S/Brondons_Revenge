import * as THREE from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { loadSubjectModel, loadToolModel } from '../../core/loader.js';
import hologramVertexShader from '../../shaders/hologram.vert.glsl?raw';
import hologramFragmentShader from '../../shaders/hologram.frag.glsl?raw';

export type PrologueShot = 'present' | 'asteroid' | 'collection' | 'ingest' | 'corruption'
  | 'capture' | 'laboratory' | 'shield' | 'planet' | 'corridor' | 'patrol';

export function createPrologueFlashbacks() {
  const textures = new Set<THREE.Texture>();
  type HologramPose = 'standing' | 'kneeling' | 'carrying' | 'restrained';
  const holograms: Array<{ group: THREE.Group; pose: HologramPose; height: number; mixer?: THREE.AnimationMixer }> = [];
  const scenes: THREE.Scene[] = [];
  const robots: Array<{ root: THREE.Group; mixer?: THREE.AnimationMixer; phase: number }> = [];
  const cameraRigs: THREE.Group[] = [];
  let disposed = false;
  let clock = 0;
  let lastShot: PrologueShot = 'present';
  let currentRenderScene: THREE.Scene | null = null;

  const noise = (seed: number) => {
    const value = Math.sin(seed * 12.9898 + 37.719) * 43758.5453;
    return value - Math.floor(value);
  };
  const metal = new THREE.MeshStandardMaterial({ color: 0x34434b, metalness: 0.55, roughness: 0.64 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x111b24, metalness: 0.65, roughness: 0.52 });
  const paleMetal = new THREE.MeshStandardMaterial({ color: 0x70808a, metalness: 0.45, roughness: 0.55 });
  const blueStrip = new THREE.MeshBasicMaterial({ color: 0x8be1ee });
  const redStrip = new THREE.MeshBasicMaterial({ color: 0xff3948 });

  function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material = metal) {
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
    uniforms: { hologramTime: { value: 0 }, hologramColor: { value: new THREE.Color(0x32a9ff) }, hologramImpact: { value: 0 } },
    vertexShader: hologramVertexShader,
    fragmentShader: hologramFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  function figure(parent: THREE.Object3D, position: [number, number, number], pose: HologramPose = 'standing', height = 1.9) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.name = `Hologram-${pose}`;
    parent.add(group);
    holograms.push({ group, pose, height });
    return group;
  }

  const restraintMaterial = new THREE.MeshStandardMaterial({ color: 0x91a8b8, metalness: 0.85, roughness: 0.28 });
  const restraintGeometry = new THREE.TorusGeometry(0.018, 0.005, 6, 12);
  const linkUp = new THREE.Vector3(0, 1, 0);

  function chain(parent: THREE.Object3D, curve: THREE.Curve<THREE.Vector3>, count: number) {
    for (let linkIndex = 0; linkIndex < count; linkIndex++) {
      const fraction = linkIndex / (count - 1);
      const link = new THREE.Mesh(restraintGeometry, restraintMaterial);
      curve.getPoint(fraction, link.position);
      link.quaternion.setFromUnitVectors(linkUp, curve.getTangent(fraction).normalize());
      link.rotateY((linkIndex % 2) * Math.PI / 2);
      link.scale.y = 1.3;
      parent.add(link);
    }
  }

  function restrain(group: THREE.Group, model: THREE.Object3D, height: number) {
    for (const chestY of [height * 0.36, height * 0.58]) {
      const points = Array.from({ length: 33 }, (_, pointIndex) => {
        const angle = pointIndex / 32 * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * 0.27, chestY, Math.sin(angle) * 0.17);
      });
      chain(group, new THREE.CatmullRomCurve3(points), 38);
    }
    const wrists: THREE.Vector3[] = [];
    for (const suffix of ['l', 'r']) {
      const forearm = model.getObjectByName(`lowerarm_${suffix}`);
      const hand = model.getObjectByName(`hand_${suffix}`);
      if (!forearm || !hand) continue;
      const direction = hand.getWorldPosition(new THREE.Vector3());
      forearm.worldToLocal(direction);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.009, 8, 18), restraintMaterial);
      cuff.position.copy(direction).multiplyScalar(0.88);
      cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
      forearm.add(cuff);
      wrists.push(group.worldToLocal(hand.getWorldPosition(new THREE.Vector3())));
    }
    if (wrists.length === 2) {
      const middle = wrists[0].clone().lerp(wrists[1], 0.5);
      middle.y -= 0.08;
      middle.z += 0.12;
      const curve = new THREE.QuadraticBezierCurve3(wrists[0], middle, wrists[1]);
      chain(group, curve, Math.max(8, Math.ceil(curve.getLength() / 0.04)));
    }
  }

  function stars(scene: THREE.Scene) {
    const positions = new Float32Array(1800 * 3);
    for (let starIndex = 0; starIndex < 1800; starIndex++) {
      const direction = new THREE.Vector3(noise(starIndex * 3) - 0.5, noise(starIndex * 3 + 1) - 0.5, noise(starIndex * 3 + 2) - 0.5).normalize();
      direction.multiplyScalar(60 + noise(starIndex + 6000) * 70).toArray(positions, starIndex * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xc5dde9, size: 0.085, sizeAttenuation: true })));
  }

  function spacecraft(scene: THREE.Scene, position: [number, number, number], scale: number) {
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
    box(group, [1.8, 0.25, 0.03], [0, 0.17, -3.02], new THREE.MeshBasicMaterial({ color: 0x809ea7 }));
    scene.add(group);
    return group;
  }

  const asteroidScene = newScene();
  stars(asteroidScene);
  const rockGeometry = new THREE.IcosahedronGeometry(6.5, 3);
  const rockPositions = rockGeometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < rockPositions.count; vertexIndex++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(rockPositions, vertexIndex);
    const roughness = 0.9 + Math.sin(vertex.x * 2.6 + vertex.y * 3.1 + vertex.z * 1.7) * 0.07;
    rockPositions.setXYZ(vertexIndex, vertex.x * roughness, vertex.y * roughness, vertex.z * roughness);
  }
  rockGeometry.computeVertexNormals();
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x747d80, roughness: 1, metalness: 0.12 });
  const asteroid = new THREE.Mesh(rockGeometry, rockMaterial);
  asteroid.position.y = -3.3;
  asteroid.scale.set(1.45, 0.56, 1.2);
  asteroidScene.add(asteroid);
  const workSurface = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), rockMaterial);
  workSurface.rotation.x = -Math.PI / 2;
  workSurface.position.y = 0.15;
  asteroidScene.add(workSurface);
  const crewPositions: Array<[number, number, number]> = [
    [-2.8, 0.16, 1.1], [-0.6, 0.16, 2.8], [2.4, 0.16, 0.8], [1.0, 0.16, -2.6],
    [-3.0, 0.16, -1.4], [-1.2, 0.16, -2.2], [2.8, 0.16, -1.8], [1.3, 0.16, 2.5],
  ];
  const crew = crewPositions.map((position, crewIndex) => figure(asteroidScene, position,
    crewIndex === 1 || crewIndex === 5 ? 'kneeling' : crewIndex === 2 || crewIndex === 7 ? 'carrying' : 'standing'));
  const crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x69bbb9, emissive: 0x124a5d, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.25 });
  for (let sampleIndex = 0; sampleIndex < 18; sampleIndex++) {
    const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.075 + noise(sampleIndex) * 0.06, 0.22 + noise(sampleIndex + 90) * 0.4, 5), crystalMaterial);
    crystal.position.set((noise(sampleIndex + 20) - 0.5) * 7, 0.3, (noise(sampleIndex + 60) - 0.5) * 6);
    crystal.rotation.z = (noise(sampleIndex + 25) - 0.5) * 0.6;
    asteroidScene.add(crystal);
  }
  for (const crateX of [-1.1, 1.3]) {
    box(asteroidScene, [0.55, 0.3, 0.4], [crateX, 0.3, 2.15], darkMetal);
    box(asteroidScene, [0.42, 0.018, 0.28], [crateX, 0.46, 2.15], paleMetal);
  }
  const surveyMast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.4, 8), paleMetal);
  surveyMast.position.set(-0.2, 0.85, 0);
  asteroidScene.add(surveyMast);
  box(asteroidScene, [0.46, 0.22, 0.3], [-0.2, 1.58, 0], darkMetal);
  const surveyLight = new THREE.PointLight(0x97e5f3, 2.6, 5);
  surveyLight.position.set(0, 1.2, 2.8);
  asteroidScene.add(surveyLight);
  const surveyShip = spacecraft(asteroidScene, [6.8, 5, -12], 0.9);
  surveyShip.rotation.y = -0.5;
  for (let debrisIndex = 0; debrisIndex < 18; debrisIndex++) {
    const debris = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25 + noise(debrisIndex) * 0.9, 0), rockMaterial);
    debris.position.set((noise(debrisIndex + 501) - 0.5) * 45, noise(debrisIndex + 601) * 10 - 6, -15 - noise(debrisIndex + 701) * 25);
    asteroidScene.add(debris);
  }

  function interior(scene: THREE.Scene, width: number, length: number) {
    box(scene, [width, 0.2, length], [0, -0.1, 0], darkMetal);
    box(scene, [width, 0.15, length], [0, 3.55, 0], darkMetal);
    for (const side of [-1, 1]) {
      box(scene, [0.15, 3.6, length], [side * width / 2, 1.8, 0]);
      for (let ribZ = -length / 2 + 1; ribZ < length / 2; ribZ += 3) {
        box(scene, [0.18, 3.35, 0.16], [side * (width / 2 - 0.12), 1.67, ribZ], paleMetal);
      }
      box(scene, [0.045, 0.035, length - 0.4], [side * (width / 2 - 0.16), 0.025, 0], blueStrip);
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
  const monitorCanvas = document.createElement('canvas');
  monitorCanvas.width = 1024;
  monitorCanvas.height = 512;
  const monitorContext = monitorCanvas.getContext('2d')!;
  const monitorTexture = new THREE.CanvasTexture(monitorCanvas);
  monitorTexture.colorSpace = THREE.SRGBColorSpace;
  textures.add(monitorTexture);
  const monitorMaterial = new THREE.MeshBasicMaterial({ map: monitorTexture });
  box(computerScene, [4.65, 2.5, 0.13], [0, 1.95, -3.55], darkMetal);
  const mainMonitor = new THREE.Mesh(new THREE.PlaneGeometry(4.35, 2.2), monitorMaterial);
  mainMonitor.position.set(0, 1.95, -3.47);
  computerScene.add(mainMonitor);
  box(computerScene, [3.8, 0.12, 1], [0, 0.9, -2.1], paleMetal);
  for (const consoleX of [-1.2, 0, 1.2]) {
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.48), monitorMaterial);
    display.position.set(consoleX, 1.28, -2.3);
    display.rotation.x = -0.25;
    computerScene.add(display);
    box(computerScene, [0.7, 0.035, 0.2], [consoleX, 0.98, -1.88], darkMetal);
  }
  const rackLeds: THREE.Mesh[] = [];
  for (const rackX of [-2.9, 2.9]) {
    box(computerScene, [0.65, 2.8, 1.2], [rackX, 1.4, -1.8], darkMetal);
    for (let serverIndex = 0; serverIndex < 11; serverIndex++) {
      box(computerScene, [0.5, 0.15, 0.03], [rackX, 0.3 + serverIndex * 0.22, -1.18], metal);
      rackLeds.push(box(computerScene, [0.028, 0.028, 0.04], [rackX - 0.19, 0.3 + serverIndex * 0.22, -1.15], blueStrip));
    }
  }
  let lastMonitorFrame = -1;

  function updateMonitors(corruption: number, time: number) {
    const frame = Math.floor(time * 8) + Math.round(corruption * 100) * 10000;
    if (frame === lastMonitorFrame) return;
    lastMonitorFrame = frame;
    const context = monitorContext;
    const corrupt = corruption > 0.5;
    context.fillStyle = corrupt ? '#1b0409' : '#06171f';
    context.fillRect(0, 0, 1024, 512);
    context.fillStyle = corrupt ? '#ff7780' : '#8ce6ec';
    context.font = '22px monospace';
    context.fillText('DONUS / LATEST ITERATION', 42, 51);
    context.fillText('SURVEY DATA INGEST', 42, 91);
    context.font = 'bold 76px monospace';
    context.fillText(corrupt ? 'CORRUPTED' : 'TRAINING', 42, 214);
    context.font = '20px monospace';
    const messages = corrupt
      ? ['INTEGRITY CHECK ........ FAILED', 'SAFETY CONSTRAINTS ..... OFFLINE', 'CREW ACCESS ........... REVOKED', 'SHIP CONTROL .......... DONUS']
      : ['TERRAIN / MINERALS / ATMOSPHERE', 'SAMPLE BATCH ........... RECEIVED', 'INTEGRITY CHECK ........ RUNNING', 'CREW ACCESS ........... AUTHORIZED'];
    messages.forEach((message, messageIndex) => context.fillText(message, 42, 289 + messageIndex * 43));
    context.fillStyle = corrupt ? '#ff3049' : '#a0e8eb';
    context.fillRect(42, 468, 930 * (corrupt ? 1 : 0.35 + time % 8 / 16), 6);
    if (corrupt) {
      context.fillStyle = 'rgba(255, 45, 74, 0.28)';
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
  const labScanners: THREE.Mesh[] = [];
  for (let captiveIndex = 0; captiveIndex < 7; captiveIndex++) {
    const captiveX = captiveIndex < 4 ? -2.5 : 2.5;
    const captiveZ = -4.8 + (captiveIndex < 4 ? captiveIndex : captiveIndex - 4) * 2.7;
    const pod = new THREE.Group();
    pod.position.set(captiveX, 0, captiveZ);
    pod.rotation.y = captiveIndex < 4 ? Math.PI / 2 : -Math.PI / 2;
    box(pod, [0.95, 0.17, 1], [0, 0.12, 0], paleMetal);
    box(pod, [0.95, 0.17, 1], [0, 2.23, 0], darkMetal);
    box(pod, [0.1, 2.1, 0.16], [-0.48, 1.18, -0.25], metal);
    box(pod, [0.1, 2.1, 0.16], [0.48, 1.18, -0.25], metal);
    const prisoner = figure(pod, [0, 0.23, 0], 'restrained', 1.8);
    prisoner.rotation.z = (noise(captiveIndex + 800) - 0.5) * 0.06;
    for (const strapY of [0.8, 1.45]) box(pod, [0.7, 0.055, 0.08], [0, strapY, 0.045], paleMetal);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.94), new THREE.MeshPhysicalMaterial({
      color: 0xa4d1d8, transparent: true, opacity: 0.1, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
    }));
    glass.position.set(0, 1.2, 0.36);
    pod.add(glass);
    const scanner = box(pod, [0.82, 0.012, 0.025], [0, 1.4, 0.4], redStrip);
    labScanners.push(scanner);
    captives.add(pod);
  }
  for (const toolZ of [-3.3, 2.1]) {
    box(laboratoryScene, [0.3, 1.5, 0.3], [0.1, 0.75, toolZ], metal);
    const arm = box(laboratoryScene, [0.1, 0.1, 1.4], [0.1, 1.55, toolZ - 0.65], paleMetal);
    arm.rotation.x = -0.25;
    box(laboratoryScene, [0.4, 0.25, 0.25], [0.1, 1.65, toolZ - 1.3], darkMetal);
  }

  const shieldScene = newScene(0x041019, true);
  interior(shieldScene, 6, 7);
  figure(shieldScene, [0, 0.1, -0.3], 'standing', 1.95);
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x78d8f0, transparent: true, opacity: 0.1, wireframe: true, depthWrite: false });
  const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.28, 2), shieldMaterial);
  shield.scale.set(0.82, 1.12, 0.82);
  shield.position.set(0, 1.16, -0.3);
  shieldScene.add(shield);
  const shieldLight = new THREE.PointLight(0x81dcf4, 7, 7);
  shieldLight.position.set(0, 1.7, 0.3);
  shieldScene.add(shieldLight);
  for (const instrumentX of [-2.0, 2.0]) {
    box(shieldScene, [0.5, 1.4, 0.5], [instrumentX, 0.7, -0.5], darkMetal);
    box(shieldScene, [1.2, 0.12, 0.12], [instrumentX * 0.68, 1.4, -0.5], paleMetal);
    box(shieldScene, [0.12, 0.25, 0.3], [instrumentX * 0.4, 1.32, -0.5], redStrip);
  }
  const neuralCanvas = document.createElement('canvas');
  neuralCanvas.width = 768;
  neuralCanvas.height = 384;
  const neuralContext = neuralCanvas.getContext('2d')!;
  neuralContext.fillStyle = '#051820';
  neuralContext.fillRect(0, 0, 768, 384);
  neuralContext.fillStyle = '#8ce5ed';
  neuralContext.font = 'bold 40px monospace';
  neuralContext.fillText('NEURALINK / PRIME', 30, 75);
  neuralContext.font = '24px monospace';
  neuralContext.fillText('LINK PROTECTED', 30, 150);
  neuralContext.fillText('INVASIVE COMMAND: REJECTED', 30, 211);
  neuralContext.fillText('BRONDON / SIGNAL STABLE', 30, 285);
  const neuralTexture = new THREE.CanvasTexture(neuralCanvas);
  neuralTexture.colorSpace = THREE.SRGBColorSpace;
  textures.add(neuralTexture);
  const neuralScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: neuralTexture }));
  neuralScreen.position.set(0, 2.2, -3.37);
  shieldScene.add(neuralScreen);

  const planetScene = newScene();
  stars(planetScene);
  const planetCanvas = document.createElement('canvas');
  planetCanvas.width = 1024;
  planetCanvas.height = 512;
  const planetContext = planetCanvas.getContext('2d')!;
  planetContext.fillStyle = '#325a66';
  planetContext.fillRect(0, 0, 1024, 512);
  for (let landIndex = 0; landIndex < 180; landIndex++) {
    planetContext.fillStyle = landIndex % 3 ? '#536955' : '#617964';
    planetContext.beginPath();
    planetContext.ellipse(noise(landIndex * 4) * 1024, noise(landIndex * 4 + 1) * 512,
      8 + noise(landIndex * 4 + 2) * 50, 5 + noise(landIndex * 4 + 3) * 24, noise(landIndex + 8) * Math.PI, 0, Math.PI * 2);
    planetContext.fill();
  }
  for (let cloudIndex = 0; cloudIndex < 110; cloudIndex++) {
    planetContext.fillStyle = 'rgba(219, 233, 226, 0.28)';
    planetContext.beginPath();
    planetContext.ellipse(noise(cloudIndex + 1000) * 1024, noise(cloudIndex + 1200) * 512,
      15 + noise(cloudIndex + 3000) * 80, 3 + noise(cloudIndex + 2000) * 14, -0.15, 0, Math.PI * 2);
    planetContext.fill();
  }
  const planetTexture = new THREE.CanvasTexture(planetCanvas);
  planetTexture.colorSpace = THREE.SRGBColorSpace;
  textures.add(planetTexture);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 48), new THREE.MeshStandardMaterial({ map: planetTexture, roughness: 1 }));
  planet.position.set(0, 0, -3);
  planet.rotation.z = 0.22;
  planetScene.add(planet);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(5.09, 48, 32), new THREE.MeshBasicMaterial({
    color: 0x7baab9, transparent: true, opacity: 0.13, side: THREE.BackSide, depthWrite: false,
  }));
  atmosphere.position.copy(planet.position);
  planetScene.add(atmosphere);
  const transport = spacecraft(planetScene, [-5.5, 1, 5], 0.28);
  transport.rotation.y = 0.3;

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
      const door = box(securityScene, [0.035, 2.5, 1.45], [side * 2.9, 1.25, doorZ], darkMetal);
      box(securityScene, [0.04, 2.2, 0.035], [side * 2.86, 1.2, doorZ], redStrip);
      box(securityScene, [0.055, 0.2, 0.18], [side * 2.85, 1.4, doorZ + 0.93], paleMetal);
      door.name = 'Sealed research-room entrance';
    }
  }
  for (const [cameraIndex, cameraZ] of [-6, 1, 7].entries()) {
    const side = cameraIndex % 2 ? -1 : 1;
    const mount = new THREE.Group();
    mount.position.set(side * 2.72, 2.8, cameraZ);
    box(mount, [0.23, 0.16, 0.4], [0, 0, 0], paleMetal);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.055, 16), new THREE.MeshStandardMaterial({
      color: 0x061b28, emissive: 0xf13546, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.2,
    }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.225;
    mount.add(lens);
    box(mount, [0.055, 0.055, 0.01], [0.075, 0.05, 0.206], redStrip);
    securityScene.add(mount);
    cameraRigs.push(mount);
    box(securityScene, [0.24, 0.05, 0.25], [side * 2.82, 3.05, cameraZ], darkMetal);
  }
  const roomCamera = new THREE.Group();
  roomCamera.position.set(-3.2, 2.9, -2.8);
  box(roomCamera, [0.24, 0.17, 0.4], [0, 0, 0], paleMetal);
  const roomLens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), darkMetal);
  roomLens.rotation.x = Math.PI / 2;
  roomLens.position.z = 0.24;
  roomCamera.add(roomLens);
  box(roomCamera, [0.04, 0.04, 0.02], [0.09, 0.04, 0.21], redStrip);
  computerScene.add(roomCamera);
  cameraRigs.push(roomCamera);
  const capturedCrew = new THREE.Group();
  securityScene.add(capturedCrew);
  for (let captiveIndex = 0; captiveIndex < 7; captiveIndex++) {
    figure(capturedCrew, [(captiveIndex % 2 - 0.5) * 1.5, 0.02, -5 + Math.floor(captiveIndex / 2) * 1.9], 'restrained', 1.8);
  }
  capturedCrew.visible = false;
  for (let robotIndex = 0; robotIndex < 3; robotIndex++) {
    const root = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), darkMetal);
    shell.scale.set(0.85, 0.6, 1.5);
    shell.position.y = 0.38;
    root.add(shell);
    for (const side of [-1, 1]) {
      for (const legZ of [-0.35, 0, 0.35]) {
        const leg = box(root, [0.5, 0.06, 0.06], [side * 0.42, 0.18, legZ], paleMetal);
        leg.rotation.z = side * -0.5;
      }
    }
    box(root, [0.15, 0.06, 0.03], [0, 0.35, 0.65], redStrip);
    root.position.x = robotIndex === 2 ? -1.1 : robotIndex % 2 ? 2.1 : -2.1;
    (robotIndex === 2 ? computerScene : securityScene).add(root);
    robots.push({ root, phase: robotIndex * 2.2 });
  }

  const toolReady = loadToolModel('Enemy_Trilobite').then(gltf => {
    if (disposed) return;
    for (const robot of robots) {
      robot.root.clear();
      const model = cloneRig(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      model.scale.setScalar(1.2 / Math.max(size.x, size.y, size.z, 0.001));
      const fitted = new THREE.Box3().setFromObject(model);
      const center = fitted.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -fitted.min.y + 0.025, -center.z);
      model.traverse(node => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = node.receiveShadow = true;
          node.material = Array.isArray(node.material) ? node.material.map(material => material.clone()) : node.material.clone();
        }
      });
      robot.root.add(model);
      const walk = gltf.animations.find(clip => /walk|run|move/i.test(clip.name)) ?? gltf.animations[0];
      if (walk) {
        robot.mixer = new THREE.AnimationMixer(model);
        robot.mixer.clipAction(walk).play();
      }
    }
  }).catch(error => console.warn('Prologue patrol model unavailable; using the built-in shell.', error));

  const characterReady = loadSubjectModel().then(gltf => {
    if (disposed) return;
    const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    for (const hologram of holograms) {
      const model = cloneRig(gltf.scene);
      model.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const sourceGeometry: THREE.BufferGeometry = node.geometry;
        let geometry = geometries.get(sourceGeometry);
        if (!geometry) { geometry = sourceGeometry.clone(); geometries.set(sourceGeometry, geometry); }
        node.geometry = geometry;
        node.material = hologramMaterial;
        node.castShadow = node.receiveShadow = false;
      });
      const bounds = new THREE.Box3().setFromObject(model, true);
      const size = bounds.getSize(new THREE.Vector3());
      model.scale.setScalar(hologram.height / Math.max(size.y, 0.01));
      const poseName = hologram.pose === 'kneeling' ? 'Fixing_Kneeling' : hologram.pose === 'carrying' ? 'PickUp_Table'
        : 'Idle_Loop';
      const clip = gltf.animations.find(animation => animation.name === poseName)
        ?? gltf.animations.find(animation => animation.name === 'Idle_Loop');
      if (clip) {
        hologram.mixer = new THREE.AnimationMixer(model);
        const action = hologram.mixer.clipAction(clip).play();
        hologram.mixer.setTime(0.6);
        action.paused = hologram.pose !== 'standing' && hologram.pose !== 'kneeling';
        action.timeScale = 0.3;
      }
      model.updateMatrixWorld(true);
      const fitted = new THREE.Box3().setFromObject(model, true);
      const center = fitted.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -fitted.min.y, -center.z);
      hologram.group.add(model);
      hologram.group.updateMatrixWorld(true);
      if (hologram.pose === 'restrained') restrain(hologram.group, model, hologram.height);
    }
  }).catch(error => console.warn('Prologue hologram character unavailable.', error));

  const sceneForShot: Record<PrologueShot, THREE.Scene | null> = {
    present: null, asteroid: asteroidScene, collection: asteroidScene,
    ingest: computerScene, corruption: computerScene, capture: securityScene,
    laboratory: laboratoryScene, shield: shieldScene, planet: planetScene,
    corridor: securityScene, patrol: securityScene,
  };
  const focus = new THREE.Vector3();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();

  function update(shot: PrologueShot, elapsed: number, duration: number, dt: number, camera: THREE.PerspectiveCamera) {
    clock += dt;
    lastShot = shot;
    currentRenderScene = sceneForShot[shot];
    const progress = THREE.MathUtils.smootherstep(elapsed, 0, Math.max(duration, 0.1));
    let fov = 48;
    switch (shot) {
      case 'asteroid':
        start.set(10.8, 5.3, 12.5); end.set(7.6, 3.5, 10.2); focus.set(0, 0.75, 0); fov = 50; break;
      case 'collection':
        start.set(3.3, 2.1, 6.3); end.set(1.8, 1.7, 5); focus.set(-0.15, 0.95, 1.6); fov = 43; break;
      case 'ingest':
        start.set(2.4, 1.8, 2.8); end.set(0.65, 1.6, 2.0); focus.set(0, 1.85, -3.5); fov = 48; break;
      case 'corruption':
        start.set(0.65, 1.6, 2); end.set(-0.35, 1.85, 0.25); focus.set(0, 1.95, -3.5); fov = 48; break;
      case 'capture':
        start.set(0.8, 1.8, 6.4); end.set(-0.3, 1.5, 2.7); focus.set(0, 1.1, -3.2); fov = 48; break;
      case 'laboratory':
        start.set(0.8, 1.7, 5.5); end.set(-0.6, 1.5, 0.7); focus.set(-1.4, 1.1, -3.1); fov = 57; break;
      case 'shield':
        start.set(2.1, 1.7, 2.7); end.set(0.65, 1.4, 2.45); focus.set(0, 1.3, -0.4); fov = 50; break;
      case 'planet':
        start.set(9.8, 3.2, 12.5); end.set(6.5, 2.0, 10.8); focus.set(0, 0, -3); fov = 54; break;
      case 'corridor':
        if (elapsed < 2.3) {
          start.set(1.15, 2.25, 9.5); end.set(1.45, 2.35, 8.9); focus.set(2.72, 2.8, 7); fov = 40;
        } else {
          start.set(-1.2, 1.7, 9); end.set(1.15, 1.6, 4); focus.set(0, 1.2, -4); fov = 58;
        }
        break;
      case 'patrol':
        if (elapsed < 3.6) {
          start.set(1.8, 0.85, 5.8); end.set(1.55, 0.75, 0.5); focus.set(-0.9, 0.5, -3.5); fov = 58;
        } else {
          currentRenderScene = computerScene;
          start.set(-2.4, 1.8, 2.9); end.set(-1.4, 1.6, 2.4); focus.set(0.5, 1.2, -1.8); fov = 58;
          updateMonitors(1, clock);
        }
        break;
      default: return;
    }
    camera.position.lerpVectors(start, end, progress);
    camera.lookAt(focus);
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
      if (visible && ancestor === currentRenderScene) hologram.mixer?.update(dt);
    }
    crew.forEach((member, crewIndex) => {
      member.position.y = 0.16 + Math.sin(clock * 0.6 + crewIndex) * 0.009;
    });
    surveyShip.position.y = 5 + Math.sin(clock * 0.15) * 0.15;
    planet.rotation.y = clock * 0.025;
    transport.position.x = -5.5 + Math.sin(clock * 0.15) * 0.8;
    shield.rotation.y = clock * 0.16;
    shieldMaterial.opacity = 0.11 + Math.sin(clock * 3) * 0.025;
    shieldLight.intensity = 7 + Math.sin(clock * 2) * 0.45;
    labScanners.forEach((scanner, scannerIndex) => { scanner.position.y = 1.2 + Math.sin(clock * 0.7 + scannerIndex) * 0.6; });
    capturedCrew.visible = shot === 'capture';
    cameraRigs.forEach((rig, rigIndex) => {
      rig.lookAt(Math.sin(clock * 0.65 + rigIndex) * 1.1, 0.9, rig.position.z + 3.2);
    });
    robots.forEach((robot, robotIndex) => {
      const travel = Math.sin(clock * 0.28 + robot.phase);
      robot.root.position.z = robotIndex === 2 ? 0.85 + travel * 0.95 : travel * 8;
      robot.root.position.y = Math.abs(Math.sin(clock * 8 + robot.phase)) * 0.018;
      robot.root.rotation.y = Math.cos(clock * 0.28 + robot.phase) > 0 ? 0 : Math.PI;
      robot.mixer?.update(dt);
    });
    if (shot === 'ingest' || shot === 'corruption') {
      updateMonitors(shot === 'corruption' ? THREE.MathUtils.smoothstep(elapsed, 0.8, 2.4) : 0, elapsed);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const robot of robots) { robot.mixer?.stopAllAction(); if (robot.mixer) robot.mixer.uncacheRoot(robot.mixer.getRoot()); }
    for (const hologram of holograms) {
      hologram.mixer?.stopAllAction();
      if (hologram.mixer) hologram.mixer.uncacheRoot(hologram.mixer.getRoot());
    }
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>([metal, darkMetal, paleMetal, blueStrip, redStrip, hologramMaterial, restraintMaterial]);
    for (const scene of scenes) scene.traverse(node => {
      if (!(node instanceof THREE.Mesh || node instanceof THREE.Points)) return;
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      geometries.add(node.geometry);
      const owned = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of owned) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }

  return { ready: Promise.all([characterReady, toolReady]), sceneFor: (shot: PrologueShot) => shot === lastShot ? currentRenderScene : sceneForShot[shot], update, dispose };
}