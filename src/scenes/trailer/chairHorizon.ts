import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadVergilsChair } from '../../core/loader.js';
import { captureFinaleResources, normalizeFinaleActor } from '../../helpers/scene/finaleActors.js';

export const CHAIR_TRAILER_DURATION = 18;
export const CHAIR_HORIZON = Object.freeze({
  count: 5, spacing: 10, height: 5.4, groundFraction: 0.25, halfWidth: 27, elevation: 35, groundBack: -3,
});

export function createChairHorizon() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300);
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 2160;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The chair horizon needs a 2D canvas');
  const horizon = canvas.height * (1 - CHAIR_HORIZON.groundFraction);
  const gradient = context.createLinearGradient(0, 0, 0, horizon);
  for (const [at, color] of [[0, '#19213b'], [0.32, '#50355e'], [0.62, '#af607d'], [0.86, '#eca47b'], [1, '#ffe3ad']] as const)
    gradient.addColorStop(at, color);
  context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, horizon);
  context.fillStyle = '#ffe3ad'; context.fillRect(0, horizon, canvas.width, canvas.height - horizon);
  const sky = new THREE.CanvasTexture(canvas); sky.colorSpace = THREE.SRGBColorSpace;
  sky.minFilter = sky.magFilter = THREE.LinearFilter; sky.generateMipmaps = false; scene.background = sky;
  const chairs = new THREE.Group(); chairs.name = 'FiveVergilChairs'; scene.add(chairs);
  const groundPixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const grain = noise - Math.floor(noise), vein = Math.sin(x * 0.21 + Math.sin(y * 0.17) * 4);
    const value = Math.round(110 + grain * 30 + vein * 4);
    groundPixels.set([value, value + 2, value + 5, 255], (y * 128 + x) * 4);
  }
  const groundTexture = new THREE.DataTexture(groundPixels, 128, 128, THREE.RGBAFormat);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping; groundTexture.repeat.set(36, 30);
  groundTexture.generateMipmaps = true; groundTexture.minFilter = THREE.LinearMipmapLinearFilter;
  groundTexture.magFilter = THREE.LinearFilter; groundTexture.anisotropy = 4; groundTexture.needsUpdate = true;
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x9fa7ba, map: groundTexture, bumpMap: groundTexture, bumpScale: 0.08, roughness: 0.98, metalness: 0.02,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 200), groundMaterial);
  ground.name = 'TrailerGround'; ground.rotation.x = -Math.PI / 2; ground.position.z = CHAIR_HORIZON.groundBack + 100;
  ground.receiveShadow = true; scene.add(ground);
  const skyFill = new THREE.HemisphereLight(0x8895b0, 0x15151c, 0.65); scene.add(skyFill);
  const sun = new THREE.DirectionalLight(0xffc38a, 1.6); sun.position.set(-18, 22, -40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 28, bottom: -28, near: 1, far: 150 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);
  const frontFill = new THREE.DirectionalLight(0xa3b2d0, 0.22); frontFill.position.set(10, 15, 30); scene.add(frontFill);
  let disposed = false, resources: ReturnType<typeof captureFinaleResources> | null = null;
  const ready = loadVergilsChair().then(asset => {
    resources = captureFinaleResources(asset.scene);
    if (disposed) { resources.dispose(); return; }
    const materials = new Set<THREE.Material>();
    asset.scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial) || materials.has(material)) continue;
        materials.add(material);
        material.color.multiplyScalar(0.55); material.roughness = Math.max(0.72, material.roughness); material.metalness = 0.02;
      }
    });
    for (let index = 0; index < CHAIR_HORIZON.count; index++) {
      const chair = new THREE.Group(); chair.name = `SilhouetteChair${index + 1}`;
      chair.position.x = (index - 2) * CHAIR_HORIZON.spacing;
      chair.add(normalizeFinaleActor(clone(asset.scene), CHAIR_HORIZON.height));
      chair.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
      chairs.add(chair);
    }
  });
  const positions = new Float32Array(150 * 3), streakPositions = new Float32Array(20 * 6);
  const dustGeometry = new THREE.BufferGeometry(), streakGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const dustMaterial = new THREE.PointsMaterial({
    color: 0xffdbac, size: 0.045, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
  });
  const streakMaterial = new THREE.LineBasicMaterial({ color: 0xecc896, transparent: true, opacity: 0, depthWrite: false });
  const dust = new THREE.Points(dustGeometry, dustMaterial), streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
  dust.name = 'HorizonWindDust'; streaks.name = 'HorizonWindWisps'; dust.frustumCulled = streaks.frustumCulled = false;
  scene.add(dust, streaks);
  function update(time: number, zoom = 1, aspect = 16 / 9) {
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(aspect) || aspect <= 0)
      throw new RangeError('Chair trailer framing requires a finite time, positive zoom and positive aspect');
    camera.aspect = aspect;
    const close = THREE.MathUtils.clamp((zoom - 1) / 4, 0, 1);
    const tangent = Math.tan(THREE.MathUtils.degToRad(20));
    const elevation = THREE.MathUtils.degToRad(CHAIR_HORIZON.elevation), sine = Math.sin(elevation), cosine = Math.cos(elevation);
    const quarter = (1 - 2 * CHAIR_HORIZON.groundFraction) * tangent;
    const framing = quarter / (cosine - quarter * sine);
    const back = -CHAIR_HORIZON.groundBack * (sine + quarter * cosine) / (cosine - quarter * sine);
    const wideDistance = (CHAIR_HORIZON.halfWidth / (tangent * aspect * Math.min(zoom, 1)) - back * sine) / (1 + framing * sine);
    const distance = THREE.MathUtils.lerp(wideDistance, 12, close);
    // Frame the real ground's far edge at three-quarter height in the wide shot.
    const focusHeight = THREE.MathUtils.lerp(wideDistance * framing + back, CHAIR_HORIZON.height * 0.445, close);
    camera.fov = THREE.MathUtils.lerp(40, 35, close);
    camera.position.set(0, focusHeight + distance * sine, distance * cosine);
    camera.lookAt(0, focusHeight, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const wind = THREE.MathUtils.smoothstep(time, 0.2, 2.2);
    dustMaterial.opacity = wind * 0.38; streakMaterial.opacity = wind * 0.07;
    for (let index = 0; index < positions.length / 3; index++) {
      const speed = 2.4 + index % 7 * 0.18;
      const x = ((index * 7.31 + time * speed) % 48) - 24;
      const y = 0.16 + index % 9 * 0.17 + Math.sin(time * 1.5 + index * 2.399) * 0.13;
      positions.set([x, y, -3 + index % 13 * 0.55], index * 3);
    }
    for (let index = 0; index < streakPositions.length / 6; index++) {
      const x = ((index * 5.71 + time * 3.1) % 52) - 26, y = 0.25 + index % 6 * 0.24;
      const z = -2 + index % 5;
      streakPositions.set([x, y, z, x + 1.3 + index % 3 * 0.55, y + Math.sin(time + index) * 0.05, z], index * 6);
    }
    dustGeometry.getAttribute('position').needsUpdate = streakGeometry.getAttribute('position').needsUpdate = true;
  }
  update(0);
  return {
    scene, camera, chairs, ready, update,
    dispose() {
      if (disposed) return;
      chairs.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
      disposed = true; resources?.dispose(); sky.dispose();
      ground.geometry.dispose(); groundMaterial.dispose(); groundTexture.dispose(); sun.shadow.map?.dispose();
      dustGeometry.dispose(); dustMaterial.dispose(); streakGeometry.dispose(); streakMaterial.dispose(); scene.clear();
    },
  };
}
