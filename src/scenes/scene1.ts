/**
 * Scene 1 - Space exterior with starfield and imported mothership.
 * Cutscene camera fly-through with the model's authored materials.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadModel } from '../core/loader.js';
import { createMothership } from '../helpers/scene/mothership.js';
import { CutsceneManager } from '../helpers/animation/CutsceneManager.js';
import { disposeRoom } from '../helpers/scene/shipRoom.js';
import starfieldVert from '../shaders/starfield.vert.glsl?raw';
import starfieldFrag from '../shaders/starfield.frag.glsl?raw';

export function createScene({ audioManager, loadShip = loadModel }: {
  audioManager?: unknown;
  loadShip?: typeof loadModel;
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020510);
  scene.fog = new THREE.Fog(0x020510, 30, 120);

  // --- Noise-based starfield skybox ---
  const starfieldUniforms = {
    uTime: { value: 0.0 },
  };
  const starfieldMat = new THREE.ShaderMaterial({
    vertexShader: starfieldVert,
    fragmentShader: starfieldFrag,
    uniforms: starfieldUniforms,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const starfield = new THREE.Mesh(new THREE.BoxGeometry(400, 400, 400), starfieldMat);
  starfield.frustumCulled = false;
  starfield.renderOrder = 0;
  scene.add(starfield);

  // --- Points-based stars (like level 2) ---
  function makeStars(count: number, pointSize: number, brightness: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i += 3) {
      const angle = Math.random() * Math.PI * 2, v = Math.random() * 2 - 1;
      const r = 200 * (0.75 + Math.random() * 0.25), sinV = Math.sqrt(1 - v * v);
      positions[i] = Math.cos(angle) * sinV * r;
      positions[i + 1] = v * r;
      positions[i + 2] = Math.sin(angle) * sinV * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: pointSize,
      sizeAttenuation: true,
      transparent: true,
      opacity: brightness,
    });
    const stars = new THREE.Points(geometry, material);
    stars.name = 'Starfield';
    stars.renderOrder = 1;
    stars.material.fog = false;
    scene.add(stars);
  }
  makeStars(3000, 0.9, 0.82);
  makeStars(600, 1.8, 1.0);

  // --- Mothership ---
  const mothership = createMothership(loadShip), ship = mothership.root;
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

  const ready = mothership.ready;
  scene.add(ship);

  // Moonlight
  const dirLight = new THREE.DirectionalLight(0x8899cc, 0.8);
  dirLight.position.set(-5, 15, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
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

    // Keep starfield aligned with camera
    starfield.position.copy(camera.position);
    starfield.quaternion.copy(camera.quaternion);

    // Hovering animation
    ship.position.y = 15 + Math.sin(t * 1.2) * 2.5;
    ship.rotation.z = Math.sin(t * 0.8) * 0.04;
    ship.rotation.x = Math.sin(t * 0.6) * 0.02;

    // Update starfield shader time
    starfieldUniforms.uTime.value = t;
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
      mothership.dispose();
      disposeRoom(scene);
      starfield.geometry.dispose();
      starfieldMat.dispose();
    },
  };
}
