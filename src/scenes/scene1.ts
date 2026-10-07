/**
 * Scene 1 - Space exterior with starfield and imported mothership.
 * Cutscene camera fly-through with the model's authored materials.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadModel } from '../core/loader.js';
import mothershipUrl from '../assets/models/mothership.glb';
import { CutsceneManager } from '../helpers/animation/CutsceneManager.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
// import comicVert from '../shaders/comic.vert.glsl?raw';
// import comicFrag from '../shaders/comic.frag.glsl?raw';

export function createScene({ audioManager, loadShip = loadModel }: {
  audioManager?: unknown;
  loadShip?: typeof loadModel;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020510);
  scene.fog = new THREE.Fog(0x020510, 30, 120);

  // --- Starfield ---
  const starCount = 4000;
  const starPositions = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);
  const minStarDistance = 50;
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = minStarDistance + Math.random() * 50;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi);
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    starSizes[i] = 0.3 + Math.random() * 1.2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.9,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // --- Mothership ---
  const ship = new THREE.Group();
  ship.name = 'Mothership';
  let disposed = false;

  /* Original primitive spaceship (kept for reference).
  const comicMaterial = new THREE.ShaderMaterial({
    vertexShader: comicVert, fragmentShader: comicFrag,
    uniforms: {
      uColor: { value: new THREE.Color(0x8899aa) },
      uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
      uTime: { value: 0.0 },
    },
  });
  const comicMaterialBlue = new THREE.ShaderMaterial({
    vertexShader: comicVert, fragmentShader: comicFrag,
    uniforms: {
      uColor: { value: new THREE.Color(0x4466aa) },
      uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
      uTime: { value: 0.0 },
    },
  });
  const comicMaterialRed = new THREE.ShaderMaterial({
    vertexShader: comicVert, fragmentShader: comicFrag,
    uniforms: {
      uColor: { value: new THREE.Color(0xaa3344) },
      uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
      uTime: { value: 0.0 },
    },
  });

  // Fuselage
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 8), comicMaterial);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  ship.add(fuselage);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), comicMaterialBlue);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(1.9, 0, 0);
  nose.castShadow = true;
  ship.add(nose);

  // Cockpit dome
  const cockpitMat = new THREE.MeshStandardMaterial({
    color: 0x44aaff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.7,
    emissive: 0x2266aa, emissiveIntensity: 0.8,
  });
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), cockpitMat);
  cockpit.position.set(0.6, 0.3, 0);
  ship.add(cockpit);

  // Wings
  const wingGeo = new THREE.BoxGeometry(1.2, 0.06, 2.0);
  const leftWing = new THREE.Mesh(wingGeo, comicMaterial);
  leftWing.position.set(-0.3, 0, 1.2);
  leftWing.rotation.x = 0.1;
  leftWing.castShadow = true;
  ship.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeo, comicMaterial);
  rightWing.position.set(-0.3, 0, -1.2);
  rightWing.rotation.x = -0.1;
  rightWing.castShadow = true;
  ship.add(rightWing);

  // Wing tips
  const tipGeo = new THREE.BoxGeometry(0.4, 0.08, 0.3);
  const leftTip = new THREE.Mesh(tipGeo, comicMaterialRed);
  leftTip.position.set(-0.3, 0.05, 2.2);
  ship.add(leftTip);
  const rightTip = new THREE.Mesh(tipGeo, comicMaterialRed);
  rightTip.position.set(-0.3, 0.05, -2.2);
  ship.add(rightTip);

  // Vertical fin
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.06), comicMaterial);
  fin.position.set(-0.8, 0.5, 0);
  fin.castShadow = true;
  ship.add(fin);

  // Engine nacelles
  const engineGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.8, 8);
  const leftEngine = new THREE.Mesh(engineGeo, comicMaterial);
  leftEngine.rotation.z = Math.PI / 2;
  leftEngine.position.set(-1.0, -0.05, 1.0);
  leftEngine.castShadow = true;
  ship.add(leftEngine);
  const rightEngine = new THREE.Mesh(engineGeo, comicMaterial);
  rightEngine.rotation.z = Math.PI / 2;
  rightEngine.position.set(-1.0, -0.05, -1.0);
  rightEngine.castShadow = true;
  ship.add(rightEngine);

  // Engine glow
  const glowGeo = new THREE.SphereGeometry(0.15, 12, 12);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x44ccff, emissive: 0x44ccff, emissiveIntensity: 2.0,
  });
  const leftGlow = new THREE.Mesh(glowGeo, glowMat);
  leftGlow.position.set(-1.45, -0.05, 1.0);
  ship.add(leftGlow);
  const rightGlow = new THREE.Mesh(glowGeo, glowMat);
  rightGlow.position.set(-1.45, -0.05, -1.0);
  ship.add(rightGlow);

  // Engine point lights
  const engineLightL = new THREE.PointLight(0x44ccff, 1.5, 4);
  engineLightL.position.set(-1.6, -0.05, 1.0);
  ship.add(engineLightL);
  const engineLightR = new THREE.PointLight(0x44ccff, 1.5, 4);
  engineLightR.position.set(-1.6, -0.05, -1.0);
  ship.add(engineLightR);

  // Antenna
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), antennaMat);
  antenna.position.set(0.6, 0.55, 0);
  ship.add(antenna);
  const antennaTipMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 1.5 });
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), antennaTipMat);
  antennaTip.position.set(0.6, 0.82, 0);
  ship.add(antennaTip);
  */

  const ready = loadShip(mothershipUrl).then(model => {
    if (disposed) { disposeRoom(model); return; }
    const modelRoot = new THREE.Group();
    modelRoot.add(model);
    modelRoot.rotation.y = -Math.PI / 2;
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    const size = bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(span) || span <= 0) {
      disposeRoom(modelRoot);
      throw new Error('Mothership model has invalid or empty bounds');
    }
    // Fit the authored model to the original ship's local-space envelope.
    const scale = 4.6 / span;
    modelRoot.scale.setScalar(scale);
    modelRoot.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
    ship.add(modelRoot);
  });

  ship.scale.set(10, 10, 10);
  ship.position.set(0, 15, 0);
  ship.rotation.y = -Math.PI / 2;
  scene.add(ship);

  // Ship self-illumination
  const shipGlowLight = new THREE.PointLight(0x88aacc, 3, 30);
  shipGlowLight.position.set(0, 0, 0);
  ship.add(shipGlowLight);
  const shipFrontLight = new THREE.PointLight(0xaaccff, 2, 20);
  shipFrontLight.position.set(2, 0, 0);
  ship.add(shipFrontLight);

  // Moonlight
  const dirLight = new THREE.DirectionalLight(0x8899cc, 0.8);
  dirLight.position.set(-5, 15, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  scene.add(dirLight);

  // Ambient
  const ambLight = new THREE.AmbientLight(0x111122, 1.2);
  scene.add(ambLight);

  // Camera
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(5, 4, 6);
  camera.lookAt(0, 0.5, 0);

  // --- Physics ---
  const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
  const groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);

  function updatePhysics(dt: number) {
    physicsWorld.step(1 / 60, dt, 3);
    const t = performance.now() * 0.001;

    // Hovering animation
    ship.position.y = 15 + Math.sin(t * 1.2) * 2.5;
    ship.rotation.z = Math.sin(t * 0.8) * 0.04;
    ship.rotation.x = Math.sin(t * 0.6) * 0.02;

    /* Primitive spaceship animation (kept for reference).
    // Pulse engine glow
    const pulse = 1.5 + Math.sin(t * 8) * 0.5;
    engineLightL.intensity = pulse;
    engineLightR.intensity = pulse;

    // Update shader time
    comicMaterial.uniforms.uTime.value = t;
    comicMaterialBlue.uniforms.uTime.value = t;
    comicMaterialRed.uniforms.uTime.value = t;
    */

    // Animate starfield
    const positions = stars.geometry.attributes.position.array as Float32Array;
    const speed = 8;
    for (let i = 0; i < starCount; i++) {
      positions[i * 3 + 2] -= speed * dt;
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const distFromCenter = Math.sqrt(x * x + y * y + z * z);
      if (positions[i * 3 + 2] < -80 || distFromCenter < minStarDistance) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = minStarDistance + Math.random() * 50;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) + 80;
      }
    }
    stars.geometry.attributes.position.needsUpdate = true;
  }

  // --- Cutscene ---
  const cutsceneManager = new CutsceneManager({ camera });
  const splinePoints = [
    new THREE.Vector3(-94.5965688360769, 9, 5),
    new THREE.Vector3(-64.5965688360769, 3, 5),
    new THREE.Vector3(-35.983554852556672, 8, 9.112241624784119),
    new THREE.Vector3(-20.446170064161805, 3.6144687917566998, 5),
    new THREE.Vector3(6, 3, 25.835889020498087),
    new THREE.Vector3(22.6015148967708, 10, 34),
    new THREE.Vector3(27, 24, 50),
  ];
  const spline_camera_path = new THREE.CatmullRomCurve3(splinePoints);
  cutsceneManager.registerSplineCurve('camera_path_1788121916257', spline_camera_path);
  cutsceneManager.registerCutscene({
    id: 'cutscene_1788121916257',
    name: 'Cutscene 1',
    duration: 20,
    tracks: [
      { target: 'camera', type: 'spline', path: 'camera_path_1788121916257', start: 0, end: 20 },
    ],
  });

  const lastSplinePoint = splinePoints[splinePoints.length - 1].clone();

  return {
    scene,
    camera,
    physicsWorld,
    updatePhysics,
    ready,
    cutsceneManager,
    lastSplinePoint,
    dispose() {
      if (disposed) return;
      disposed = true;
      cutsceneManager.onStateChange = undefined;
      cutsceneManager.clear();
      disposeRoom(scene);
    },
  };
}
