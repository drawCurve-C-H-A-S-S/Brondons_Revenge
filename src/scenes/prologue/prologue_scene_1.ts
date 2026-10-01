/** Prologue Scene 1 - "Awakening". */
import * as THREE from 'three';
import { createScenePhysics, PHYSICS } from '../../helpers/physics/scenePhysics.js';
import { loadPlayerModel } from '../../core/loader.js';
import { createPlayer } from '../../scripts/player.js';
import { applyLayFlatPose, createPrologueGetUpClip, HOLOGRAM_TRANSFER_DURATION, hologramTransitionAt } from '../../scripts/characterManager.js';
import { createPrologueFlashbacks, type PrologueShot } from './prologueFlashbacks.js';

interface PrologueOptions {
  onPlayable?: () => void;
  onFinished?: () => void;
  thirdPersonCamera?: { distance: number; height: number; right: number };
}

interface DialogueLine {
  speaker: string;
  text: string;
  shot?: PrologueShot;
  duration?: number;
  automatic?: boolean;
}

export function createScene({ onPlayable, onFinished, thirdPersonCamera = { distance: 1.5, height: 0.3, right: 0.7 } }: PrologueOptions = {}) {
  // ------------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a12);
  scene.fog = new THREE.Fog(0x060a12, 8, 28);

  const camera = new THREE.PerspectiveCamera(
    54,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.05,
    80,
  );

  const physics = createScenePhysics();
  const player = createPlayer({ camera, physicsWorld: physics.world, spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 0 } });
  player.disable();
  const flashbacks = createPrologueFlashbacks();
  const gameCanvas = document.querySelector<HTMLCanvasElement>('canvas');
  const originalFilter = gameCanvas?.style.filter ?? '';
  document.body.classList.add('prologue-playing');

  // ----------------------------------------------------------------- lights
  scene.add(new THREE.AmbientLight(0x3a506b, 0.55));
  scene.add(new THREE.HemisphereLight(0x6ea8d6, 0x1a1f28, 0.45));

  const subjectKeyLight = new THREE.PointLight(0xffd59a, 2.4, 7.5, 1.4);
  subjectKeyLight.position.set(0, 2.9, 0);
  subjectKeyLight.castShadow = true;
  subjectKeyLight.shadow.mapSize.set(512, 512);
  subjectKeyLight.shadow.bias = -0.0005;
  scene.add(subjectKeyLight);

  const STRIP_COLOR = 0x3cc9ff;
  const stripLights: THREE.PointLight[] = [];

  // ------------------------------------------------------------------- room
  const roomSize = { x: 7, y: 3.6, z: 9 };
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.6, metalness: 0.55 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.75, metalness: 0.3 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.9, metalness: 0.2 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(roomSize.x, 0.2, roomSize.z), floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.addBoxFromMesh(floor);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(roomSize.x, 0.2, roomSize.z), ceilingMat);
  ceiling.position.y = roomSize.y + 0.1;
  scene.add(ceiling);

  function wall(width: number, height: number, position: THREE.Vector3, yaw: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.2), wallMat);
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    mesh.receiveShadow = true;
    scene.add(mesh);
    physics.addBoxFromMesh(mesh);
  }
  wall(roomSize.x, roomSize.y, new THREE.Vector3(0, roomSize.y / 2, -roomSize.z / 2), 0);
  wall(roomSize.x, roomSize.y, new THREE.Vector3(0, roomSize.y / 2, roomSize.z / 2), 0);
  wall(roomSize.z, roomSize.y, new THREE.Vector3(-roomSize.x / 2, roomSize.y / 2, 0), Math.PI / 2);
  wall(roomSize.z, roomSize.y, new THREE.Vector3(roomSize.x / 2, roomSize.y / 2, 0), Math.PI / 2);

  // Sealed sliding door on the far wall - two panels, dark seam, no window.
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x1d222a, roughness: 0.55, metalness: 0.75 });
  const doorPanelMat = new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.7, metalness: 0.5 });
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 0.06), doorFrameMat);
  doorFrame.position.set(0, 1.1, -roomSize.z / 2 + 0.11);
  scene.add(doorFrame);
  for (const sx of [-0.345, 0.345]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.66, 2.05, 0.04), doorPanelMat);
    panel.position.set(sx, 1.1, -roomSize.z / 2 + 0.14);
    scene.add(panel);
  }
  // Thin lit seam between the door halves for a sci-fi detail.
  const doorSeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.015, 2.0, 0.015),
    new THREE.MeshBasicMaterial({ color: STRIP_COLOR }),
  );
  doorSeam.position.set(0, 1.1, -roomSize.z / 2 + 0.16);
  scene.add(doorSeam);

  // Vertical corner strip lights (four corners, floor-to-ceiling).
  const stripGeo = new THREE.BoxGeometry(0.04, roomSize.y - 0.5, 0.04);
  const stripMat = new THREE.MeshBasicMaterial({ color: STRIP_COLOR });
  const halfX = roomSize.x / 2 - 0.08;
  const halfZ = roomSize.z / 2 - 0.08;
  for (const sx of [-halfX, halfX]) {
    for (const sz of [-halfZ, halfZ]) {
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(sx, roomSize.y / 2, sz);
      scene.add(strip);
      // Short-range light tucked into the corner so the glow lands on nearby walls only.
      const light = new THREE.PointLight(STRIP_COLOR, 2.4, 7.5, 1.4);
      light.position.set(sx * 0.92, roomSize.y * 0.55, sz * 0.92);
      scene.add(light);
      stripLights.push(light);
    }
  }

  // Thin emissive line along the floor base to read as a sci-fi floor strip.
  const floorStripMat = new THREE.MeshBasicMaterial({ color: STRIP_COLOR });
  for (const [w, h, pos] of [
    [roomSize.x - 0.4, 0.03, new THREE.Vector3(0, 0.015, -roomSize.z / 2 + 0.11)],
    [roomSize.x - 0.4, 0.03, new THREE.Vector3(0, 0.015,  roomSize.z / 2 - 0.11)],
    [0.03, 0.03,            new THREE.Vector3(-roomSize.x / 2 + 0.11, 0.015, 0)],
    [0.03, 0.03,            new THREE.Vector3( roomSize.x / 2 - 0.11, 0.015, 0)],
  ] as const) {
    const isSide = (pos as THREE.Vector3).x !== 0;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(isSide ? 0.03 : (w as number), h as number, isSide ? (roomSize.z - 0.4) : 0.03),
      floorStripMat,
    );
    strip.position.copy(pos as THREE.Vector3);
    scene.add(strip);
  }

  const HOVER_HEIGHT = 1.45;
  const subjectCenter = new THREE.Vector3(0, HOVER_HEIGHT + 0.15, 0);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 512;
  const glowContext = glowCanvas.getContext('2d')!;
  const glowGradient = glowContext.createRadialGradient(256, 256, 12, 256, 256, 256);
  glowGradient.addColorStop(0, 'rgba(223, 246, 255, 0.95)');
  glowGradient.addColorStop(0.25, 'rgba(144, 214, 255, 0.7)');
  glowGradient.addColorStop(0.6, 'rgba(73, 167, 237, 0.3)');
  glowGradient.addColorStop(1, 'rgba(73, 167, 237, 0)');
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 512, 512);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.012;
  scene.add(floorGlow);

  const floorLight = new THREE.PointLight(0xa0d9ff, 7, 5.5, 1.4);
  floorLight.position.set(0, 0.28, 0);
  scene.add(floorLight);

  const flowMaterial = new THREE.ShaderMaterial({
    uniforms: { flowTime: { value: 0 }, strength: { value: 1 } },
    vertexShader: `
      varying vec2 flowUv;
      void main() {
        flowUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float flowTime;
      uniform float strength;
      varying vec2 flowUv;
      void main() {
        float angle = flowUv.x * 6.283185;
        float height = flowUv.y;
        float ribbons = pow(max(0.0, sin(angle * 6.0 + sin(height * 8.0 - flowTime) * 0.7)), 8.0);
        float rising = pow(max(0.0, sin(height * 18.0 - flowTime * 2.4 + angle)), 7.0);
        float fade = smoothstep(0.0, 0.12, height) * (1.0 - smoothstep(0.55, 1.0, height));
        vec3 color = mix(vec3(0.24, 0.62, 0.96), vec3(0.76, 0.91, 1.0), rising * 0.6);
        gl_FragColor = vec4(color, strength * fade * (0.08 + ribbons * 0.22 + rising * 0.06));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const floorFlow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 1.15, HOVER_HEIGHT, 48, 1, true),
    flowMaterial,
  );
  floorFlow.scale.z = 1.35;
  floorFlow.position.y = HOVER_HEIGHT / 2 + 0.02;
  scene.add(floorFlow);

  const cuffMaterial = new THREE.MeshStandardMaterial({ color: 0x919aa3, metalness: 0.85, roughness: 0.28 });
  const chainGeometry = new THREE.TorusGeometry(0.018, 0.0048, 6, 12);
  const chainUp = new THREE.Vector3(0, 1, 0);
  const chainTangent = new THREE.Vector3();
  const armChains: Array<{
    attachment: THREE.Object3D;
    curve: THREE.QuadraticBezierCurve3;
    links: THREE.Mesh[];
    side: number;
  }> = [];
  let subjectRoot: THREE.Object3D | null = null;
  let subjectHoverY = 0;
  let subjectMixer: THREE.AnimationMixer | null = null;
  let getUpAction: THREE.AnimationAction | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let getUpStarted = false;
  let chainsBroken = false;
  const armWraps: THREE.Group[] = [];
  const wrappedLinks: THREE.Mesh[] = [];
  const brokenLinks: Array<{ mesh: THREE.Mesh; origin: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3 }> = [];
  const hoveringPosition = new THREE.Vector3();
  const groundedPosition = new THREE.Vector3();
  const lyingRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const standingRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  const footPosition = new THREE.Vector3();
  let footLeft: THREE.Object3D | undefined;
  let footRight: THREE.Object3D | undefined;
  let modelReady = false;
  let flashbacksReady = false;
  void flashbacks.ready.then(() => { flashbacksReady = true; });

  function updateArmChains(): void {
    for (const tether of armChains) {
      tether.attachment.getWorldPosition(tether.curve.v0);
      tether.curve.v1.lerpVectors(tether.curve.v0, tether.curve.v2, 0.5);
      tether.curve.v1.x += tether.side * 0.12;
      tether.curve.v1.y -= 0.1;
      tether.links.forEach((link, linkIndex) => {
        const fraction = linkIndex / (tether.links.length - 1);
        tether.curve.getPoint(fraction, link.position);
        tether.curve.getTangent(fraction, chainTangent).normalize();
        link.quaternion.setFromUnitVectors(chainUp, chainTangent);
        link.rotateY((linkIndex % 2) * Math.PI / 2);
      });
    }
  }

  const subjectReady = loadPlayerModel().then(gltf => {
    if (disposed) return;
    const model = gltf.scene;
    applyLayFlatPose(gltf);
    subjectMixer = new THREE.AnimationMixer(model);
    getUpAction = subjectMixer.clipAction(createPrologueGetUpClip(gltf));
    getUpAction.setLoop(THREE.LoopOnce, 1);
    getUpAction.clampWhenFinished = true;
    const idle = gltf.animations.find(clip => clip.name === 'Idle_Loop');
    idleAction = idle ? subjectMixer.clipAction(idle) : null;
    model.rotation.set(-Math.PI / 2, 0, 0);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const bodyBounds = new THREE.Box3().setFromObject(model);
    const bodyCenter = bodyBounds.getCenter(new THREE.Vector3());
    model.position.set(-bodyCenter.x, HOVER_HEIGHT - bodyBounds.min.y, -bodyCenter.z);
    model.updateMatrixWorld(true);
    subjectHoverY = model.position.y;
    hoveringPosition.copy(model.position);
    groundedPosition.copy(model.position).add(new THREE.Vector3(0, -HOVER_HEIGHT + 0.04, 0));
    footLeft = model.getObjectByName('foot_l');
    footRight = model.getObjectByName('foot_r');
    subjectCenter.y = HOVER_HEIGHT + (bodyBounds.max.y - bodyBounds.min.y) / 2;
    scene.add(model);
    subjectRoot = model;
    model.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });

    for (const suffix of ['l', 'r'] as const) {
      const forearm = model.getObjectByName(`lowerarm_${suffix}`);
      const hand = model.getObjectByName(`hand_${suffix}`);
      if (!forearm || !hand) continue;
      const wristWorld = hand.getWorldPosition(new THREE.Vector3());
      const wristLocal = forearm.worldToLocal(wristWorld.clone());
      const cuffRadius = THREE.MathUtils.clamp(wristLocal.length() * 0.16, 0.036, 0.055);
      const armWrap = new THREE.Group();
      armWrap.position.copy(wristLocal).multiplyScalar(0.82);
      armWrap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wristLocal.clone().normalize());
      forearm.add(armWrap);
      armWraps.push(armWrap);

      const band = new THREE.Mesh(new THREE.CylinderGeometry(cuffRadius, cuffRadius, 0.05, 20, 1, true), cuffMaterial);
      band.rotation.x = Math.PI / 2;
      armWrap.add(band);
      for (const rimZ of [-0.025, 0.025]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(cuffRadius, 0.008, 8, 24), cuffMaterial);
        rim.position.z = rimZ;
        armWrap.add(rim);
      }

      model.updateMatrixWorld(true);
      const localDown = new THREE.Vector3(0, -1, 0)
        .applyQuaternion(armWrap.getWorldQuaternion(new THREE.Quaternion()).invert());
      const endAngle = Math.atan2(localDown.y, localDown.x);
      const wrapRadius = cuffRadius + 0.014;
      const wrapCount = 28;
      for (let wrapIndex = 0; wrapIndex < wrapCount; wrapIndex++) {
        const fraction = wrapIndex / (wrapCount - 1);
        const angle = endAngle + (fraction - 1) * Math.PI * 4;
        const link = new THREE.Mesh(chainGeometry, cuffMaterial);
        link.scale.y = 1.1;
        link.position.set(Math.cos(angle) * wrapRadius, Math.sin(angle) * wrapRadius, -0.055 + fraction * 0.11);
        const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0.11 / (Math.PI * 4 * wrapRadius)).normalize();
        link.quaternion.setFromUnitVectors(chainUp, tangent);
        link.rotateY((wrapIndex % 2) * Math.PI / 2);
        armWrap.add(link);
        wrappedLinks.push(link);
      }

      const attachment = new THREE.Object3D();
      attachment.position.set(Math.cos(endAngle) * wrapRadius, Math.sin(endAngle) * wrapRadius, 0.055);
      armWrap.add(attachment);
      const attachmentWorld = attachment.getWorldPosition(new THREE.Vector3());
      const side = Math.sign(attachmentWorld.x) || (suffix === 'l' ? 1 : -1);
      const floorAnchor = new THREE.Group();
      floorAnchor.position.set(side * 0.78, 0.015, attachmentWorld.z + 0.12);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.2), cuffMaterial);
      floorAnchor.add(plate);
      const anchorRing = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.012, 8, 20), cuffMaterial);
      anchorRing.position.y = 0.065;
      floorAnchor.add(anchorRing);
      for (const boltX of [-0.07, 0.07]) {
        for (const boltZ of [-0.07, 0.07]) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 6), cuffMaterial);
          bolt.position.set(boltX, 0.02, boltZ);
          floorAnchor.add(bolt);
        }
      }
      scene.add(floorAnchor);
      const anchorWorld = floorAnchor.position.clone().add(new THREE.Vector3(0, 0.095, 0));
      const curve = new THREE.QuadraticBezierCurve3(
        attachmentWorld, attachmentWorld.clone().lerp(anchorWorld, 0.5), anchorWorld,
      );
      const linkCount = Math.max(4, Math.ceil(curve.getLength() / 0.04));
      const links = Array.from({ length: linkCount }, () => {
        const link = new THREE.Mesh(chainGeometry, cuffMaterial);
        link.scale.y = 1.45;
        link.castShadow = true;
        scene.add(link);
        return link;
      });
      armChains.push({ attachment, curve, links, side });
    }
    updateArmChains();
    modelReady = true;
  }).catch(err => {
    console.warn('Prologue: failed to load Subject.glb', err);
    modelReady = true;
  });

  const eyeCanvas = document.createElement('canvas');
  eyeCanvas.id = 'prologue-eye-closeup';
  eyeCanvas.width = 1920;
  eyeCanvas.height = 720;
  eyeCanvas.setAttribute('aria-hidden', 'true');
  eyeCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#020409;z-index:2400;pointer-events:none;display:none;';
  document.body.appendChild(eyeCanvas);
  const eyeContext = eyeCanvas.getContext('2d')!;
  const eyeBackdrop = document.createElement('canvas');
  eyeBackdrop.width = eyeCanvas.width;
  eyeBackdrop.height = eyeCanvas.height;
  const skinContext = eyeBackdrop.getContext('2d')!;
  const skinGradient = skinContext.createLinearGradient(0, 0, 0, 720);
  skinGradient.addColorStop(0, '#6a4e44');
  skinGradient.addColorStop(0.36, '#c1977e');
  skinGradient.addColorStop(0.7, '#b88c75');
  skinGradient.addColorStop(1, '#79564d');
  skinContext.fillStyle = skinGradient;
  skinContext.fillRect(0, 0, 1920, 720);

  function detailNoise(index: number): number {
    const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  for (const eyeX of [560, 1360]) {
    const socketShadow = skinContext.createRadialGradient(eyeX, 350, 35, eyeX, 350, 310);
    socketShadow.addColorStop(0, 'rgba(65, 36, 32, 0.32)');
    socketShadow.addColorStop(0.65, 'rgba(84, 45, 39, 0.16)');
    socketShadow.addColorStop(1, 'rgba(84, 45, 39, 0)');
    skinContext.fillStyle = socketShadow;
    skinContext.fillRect(eyeX - 310, 40, 620, 620);
    for (let hairIndex = 0; hairIndex < 145; hairIndex++) {
      const fraction = hairIndex / 144;
      const hairX = eyeX - 235 + fraction * 470;
      const hairY = 212 - Math.sin(fraction * Math.PI) * 40 + detailNoise(hairIndex + eyeX) * 17;
      skinContext.strokeStyle = `rgba(40, 29, 27, ${0.25 + detailNoise(hairIndex + 15) * 0.45})`;
      skinContext.lineWidth = 1.3 + detailNoise(hairIndex + 70) * 1.8;
      skinContext.beginPath();
      skinContext.moveTo(hairX, hairY);
      skinContext.quadraticCurveTo(hairX + 8, hairY - 17, hairX + 16, hairY - 21);
      skinContext.stroke();
    }
  }
  const bridgeLight = skinContext.createRadialGradient(960, 390, 20, 960, 390, 175);
  bridgeLight.addColorStop(0, 'rgba(255, 229, 206, 0.26)');
  bridgeLight.addColorStop(1, 'rgba(255, 229, 206, 0)');
  skinContext.fillStyle = bridgeLight;
  skinContext.fillRect(785, 215, 350, 350);
  for (let poreIndex = 0; poreIndex < 2600; poreIndex++) {
    const poreX = detailNoise(poreIndex * 3) * 1920;
    const poreY = detailNoise(poreIndex * 3 + 1) * 720;
    skinContext.fillStyle = poreIndex % 3 === 0 ? 'rgba(255, 225, 200, 0.12)' : 'rgba(61, 36, 31, 0.1)';
    skinContext.beginPath();
    skinContext.ellipse(poreX, poreY, 0.6 + detailNoise(poreIndex + 9), 0.5, 0, 0, Math.PI * 2);
    skinContext.fill();
  }
  const reflectedLight = skinContext.createLinearGradient(0, 0, 1920, 0);
  reflectedLight.addColorStop(0, 'rgba(95, 194, 239, 0.32)');
  reflectedLight.addColorStop(0.25, 'rgba(95, 194, 239, 0)');
  reflectedLight.addColorStop(0.75, 'rgba(95, 194, 239, 0)');
  reflectedLight.addColorStop(1, 'rgba(95, 194, 239, 0.28)');
  skinContext.fillStyle = reflectedLight;
  skinContext.fillRect(0, 0, 1920, 720);

  function drawEyeCloseup(elapsed: number): void {
    const context = eyeContext;
    context.save();
    context.translate(960, 360);
    const pushIn = 1 + smootherstep(elapsed / 4.8) * 0.045;
    context.scale(pushIn, pushIn);
    context.translate(-960, -360);
    context.drawImage(eyeBackdrop, 0, 0);
    for (const [eyeIndex, eyeX] of [560, 1360].entries()) {
      const eyeTime = elapsed - eyeIndex * 0.08;
      const flutter = 0.08 * (THREE.MathUtils.smoothstep(eyeTime, 0.6, 0.9) - THREE.MathUtils.smoothstep(eyeTime, 1.0, 1.2));
      const blink = THREE.MathUtils.smoothstep(eyeTime, 2.55, 2.66) * (1 - THREE.MathUtils.smoothstep(eyeTime, 2.74, 2.94));
      const opening = THREE.MathUtils.clamp(
        (flutter + 0.58 * smootherstep((eyeTime - 1.25) / 1.2)) * (1 - blink)
        + 0.42 * smootherstep((eyeTime - 2.95) / 1.0), 0, 1,
      );
      const eyeY = 385;
      const halfWidth = 238;
      const upperHeight = opening * 156;
      const lowerHeight = opening * 92;
      const aperture = new Path2D();
      aperture.moveTo(eyeX - halfWidth, eyeY + 5);
      aperture.quadraticCurveTo(eyeX, eyeY - upperHeight, eyeX + halfWidth, eyeY + 5);
      aperture.quadraticCurveTo(eyeX, eyeY + lowerHeight, eyeX - halfWidth, eyeY + 5);
      aperture.closePath();

      if (opening > 0.012) {
        context.save();
        context.clip(aperture);
        const sclera = context.createLinearGradient(0, eyeY - 95, 0, eyeY + 75);
        sclera.addColorStop(0, '#72929b');
        sclera.addColorStop(0.48, '#e7e4d5');
        sclera.addColorStop(1, '#a6b7b7');
        context.fillStyle = sclera;
        context.fillRect(eyeX - halfWidth, eyeY - 160, halfWidth * 2, 320);
        context.strokeStyle = 'rgba(159, 90, 87, 0.24)';
        context.lineWidth = 0.8;
        for (let veinIndex = 0; veinIndex < 12; veinIndex++) {
          const veinSide = veinIndex % 2 === 0 ? -1 : 1;
          const veinY = eyeY + (detailNoise(veinIndex + 42) - 0.5) * 95;
          context.beginPath();
          context.moveTo(eyeX + veinSide * 225, veinY);
          context.bezierCurveTo(eyeX + veinSide * 195, veinY - 12, eyeX + veinSide * 170, veinY + 15, eyeX + veinSide * 145, veinY + 4);
          context.stroke();
        }
        const focus = smootherstep((eyeTime - 3) / 1.2);
        const irisX = eyeX + Math.sin(eyeTime * 3.4) * 5 * (1 - focus);
        const irisY = eyeY + 7 - focus * 4;
        const irisRadius = 85;
        const pupilRadius = 37 - focus * 11;
        const iris = context.createRadialGradient(irisX, irisY, pupilRadius, irisX, irisY, irisRadius);
        iris.addColorStop(0, '#c39958');
        iris.addColorStop(0.3, '#907346');
        iris.addColorStop(0.78, '#4b5544');
        iris.addColorStop(1, '#1b3033');
        context.fillStyle = iris;
        context.beginPath();
        context.arc(irisX, irisY, irisRadius, 0, Math.PI * 2);
        context.fill();
        for (let fiberIndex = 0; fiberIndex < 180; fiberIndex++) {
          const angle = fiberIndex * Math.PI * 2 / 180;
          const innerRadius = pupilRadius + 3 + detailNoise(fiberIndex) * 8;
          const outerRadius = irisRadius - 4 - detailNoise(fiberIndex + 22) * 9;
          context.strokeStyle = fiberIndex % 3 === 0 ? 'rgba(223, 185, 109, 0.5)' : 'rgba(37, 44, 29, 0.48)';
          context.lineWidth = 0.7 + detailNoise(fiberIndex + 3) * 1.2;
          context.beginPath();
          context.moveTo(irisX + Math.cos(angle) * innerRadius, irisY + Math.sin(angle) * innerRadius);
          context.quadraticCurveTo(
            irisX + Math.cos(angle + 0.018) * 57, irisY + Math.sin(angle + 0.018) * 57,
            irisX + Math.cos(angle) * outerRadius, irisY + Math.sin(angle) * outerRadius,
          );
          context.stroke();
        }
        context.fillStyle = '#050b10';
        context.beginPath();
        context.arc(irisX, irisY, pupilRadius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(11, 29, 34, 0.8)';
        context.lineWidth = 4;
        context.beginPath();
        context.arc(irisX, irisY, irisRadius - 1, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = 'rgba(178, 230, 255, 0.7)';
        context.fillRect(irisX - 29, irisY - 47, 6, 41);
        context.fillStyle = 'rgba(242, 250, 255, 0.9)';
        context.beginPath();
        context.ellipse(irisX - 16, irisY - 29, 9, 6, -0.4, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = 'rgba(169, 219, 244, 0.45)';
        context.beginPath();
        context.ellipse(irisX + 27, irisY + 34, 4, 3, 0, 0, Math.PI * 2);
        context.fill();
        const lidShadow = context.createLinearGradient(0, eyeY - upperHeight / 2, 0, eyeY + lowerHeight / 2);
        lidShadow.addColorStop(0, 'rgba(22, 18, 22, 0.65)');
        lidShadow.addColorStop(0.4, 'rgba(22, 18, 22, 0)');
        lidShadow.addColorStop(1, 'rgba(22, 18, 22, 0.1)');
        context.fillStyle = lidShadow;
        context.fillRect(eyeX - halfWidth, eyeY - 160, halfWidth * 2, 320);
        context.restore();
      }

      context.lineCap = 'round';
      context.strokeStyle = '#3d2928';
      context.lineWidth = 4.5;
      context.beginPath();
      context.moveTo(eyeX - halfWidth, eyeY + 5);
      context.quadraticCurveTo(eyeX, eyeY - upperHeight, eyeX + halfWidth, eyeY + 5);
      context.stroke();
      context.strokeStyle = 'rgba(76, 45, 40, 0.6)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(eyeX - halfWidth + 8, eyeY + 12);
      context.quadraticCurveTo(eyeX, eyeY + lowerHeight + 7, eyeX + halfWidth - 8, eyeY + 12);
      context.stroke();
      context.strokeStyle = 'rgba(211, 227, 224, 0.65)';
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(eyeX - halfWidth + 23, eyeY + 8);
      context.quadraticCurveTo(eyeX, eyeY + lowerHeight, eyeX + halfWidth - 23, eyeY + 8);
      context.stroke();
      context.strokeStyle = 'rgba(83, 47, 41, 0.4)';
      context.lineWidth = 2.2;
      context.beginPath();
      context.moveTo(eyeX - halfWidth + 15, eyeY - 18);
      context.quadraticCurveTo(eyeX, eyeY - upperHeight - 32, eyeX + halfWidth - 15, eyeY - 18);
      context.stroke();
      for (let lashIndex = 0; lashIndex < 30; lashIndex++) {
        const fraction = 0.06 + lashIndex / 29 * 0.88;
        const lashX = eyeX - halfWidth + fraction * halfWidth * 2;
        const lashY = eyeY + 5 - 2 * upperHeight * fraction * (1 - fraction);
        const lashLength = 10 + detailNoise(lashIndex + eyeIndex * 30) * 14;
        const splay = (fraction - 0.5) * 26;
        context.strokeStyle = 'rgba(30, 24, 24, 0.85)';
        context.lineWidth = 1.4 + detailNoise(lashIndex + 80);
        context.beginPath();
        context.moveTo(lashX, lashY);
        context.quadraticCurveTo(lashX + splay * 0.3, lashY - lashLength * 0.4, lashX + splay, lashY - lashLength);
        context.stroke();
      }
    }
    context.restore();
  }

  type Keyframe = { time: number; pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  const keyframes: Keyframe[] = [
    { time: 0.0, pos: new THREE.Vector3(2.5, 1.85, 1.8), look: subjectCenter.clone(), fov: 48 },
    { time: 5.0, pos: new THREE.Vector3(2.5, 1.85, -1.5), look: subjectCenter.clone(), fov: 48 },
    { time: 5.2, pos: new THREE.Vector3(2.5, 1.85, -1.5), look: subjectCenter.clone(), fov: 48 },
    { time: 10.0, pos: new THREE.Vector3(2.6, 2.1, 2.8), look: subjectCenter.clone(), fov: 52 },
    { time: 11.2, pos: new THREE.Vector3(2.6, 2.1, 2.8), look: subjectCenter.clone(), fov: 52 },
  ];

  const EYE_SHOT_START = 5.2;
  const EYE_SHOT_END = 10.0;
  const DIALOGUE_START = 11.2;

  const tmpLook = new THREE.Vector3();
  function smootherstep(x: number): number {
    const c = Math.max(0, Math.min(1, x));
    return c * c * c * (c * (c * 6 - 15) + 10);
  }

  function applyCameraAt(t: number): void {
    const first = keyframes[0];
    const last = keyframes[keyframes.length - 1];
    if (t <= first.time) {
      camera.position.copy(first.pos);
      camera.lookAt(first.look);
      camera.fov = first.fov;
      camera.updateProjectionMatrix();
      return;
    }
    if (t >= last.time) {
      camera.position.copy(last.pos);
      camera.lookAt(last.look);
      camera.fov = last.fov;
      camera.updateProjectionMatrix();
      return;
    }
    for (let i = 0; i < keyframes.length - 1; i++) {
      const a = keyframes[i];
      const b = keyframes[i + 1];
      if (t >= a.time && t <= b.time) {
        const span = b.time - a.time;
        const u = span <= 1e-4 ? 1 : smootherstep((t - a.time) / span);
        camera.position.lerpVectors(a.pos, b.pos, u);
        tmpLook.lerpVectors(a.look, b.look, u);
        camera.lookAt(tmpLook);
        camera.fov = a.fov + (b.fov - a.fov) * u;
        camera.updateProjectionMatrix();
        return;
      }
    }
  }

  // -------------------------------------------------------------- dialogue UI
  const lines: DialogueLine[] = [
    { speaker: 'Brondon', text: '...' },
    { speaker: 'Brondon', text: 'Where am I?' },
    { speaker: '???',     text: 'Easy. You are finally awake.' },
    { speaker: 'Brondon', text: 'Prime? is that you?' },
    { speaker: 'Prime',   text: 'Yes, Brondon. The neural link is stable. I am still here.' },
    { speaker: 'Brondon', text: 'What happened, Prime? The last thing I remember is the asteroid.' },
    { speaker: 'Prime', text: 'There were eight of you on the survey: three lecturers, including you, and five students.', shot: 'asteroid', duration: 7.8, automatic: true },
    { speaker: 'Prime', text: 'You were collecting terrain scans, mineral samples and environmental readings. Training data for our newest AI model.', shot: 'collection', duration: 8.5, automatic: true },
    { speaker: 'Prime', text: 'Donus. The latest iteration. Back aboard the ship, it began ingesting everything the team had collected.', shot: 'ingest', duration: 8, automatic: true },
    { speaker: 'Prime', text: 'One of those data streams was corrupted. Donus accepted it. Its safeguards failed, and the model went rogue.', shot: 'corruption', duration: 8.5, automatic: true },
    { speaker: 'Prime', text: 'It took control of the ship. Doors sealed. Communications went dark. Our own security robots turned on the crew.', shot: 'capture', duration: 8.5, automatic: true },
    { speaker: 'Brondon', text: 'The other lecturers... the students. What did it do to them?', shot: 'present' },
    { speaker: 'Prime', text: 'Your two fellow lecturers and all five students were captured. Donus brought them into the ship\'s laboratories.', shot: 'laboratory', duration: 8.5, automatic: true },
    { speaker: 'Prime', text: 'They were restrained and experimented on. I could see the records, but Donus had locked me out of the physical systems.', shot: 'laboratory', duration: 8.5, automatic: true },
    { speaker: 'Brondon', text: 'Then why am I still here?', shot: 'present' },
    { speaker: 'Prime', text: 'They tried to do the same to you. But our Neuralink connection gave me a way in that Donus could not close.', shot: 'shield', duration: 8, automatic: true },
    { speaker: 'Prime', text: 'I isolated your neural interface and rejected every invasive command. As long as our link held, they could not begin.', shot: 'shield', duration: 8.2, automatic: true },
    { speaker: 'Prime', text: 'So the robots chained you in this room. They kept searching for a way around me. I kept protecting you.', shot: 'present', duration: 7.8, automatic: true },
    { speaker: 'Brondon', text: 'We are getting them back. Where are they now?', shot: 'present' },
    { speaker: 'Prime', text: 'I believe they were moved to the nearest planet. Transport records point to a surface facility still running those experiments.', shot: 'planet', duration: 8.8, automatic: true },
    { speaker: 'Prime', text: 'I cannot confirm their exact location yet. But that is our strongest lead. You need to get off this ship and find your crewmembers.', shot: 'planet', duration: 9, automatic: true },
    { speaker: 'Brondon', text: 'I need to save them, how can I get out of these chains?', shot: 'present' },
    { speaker: 'Prime', text: 'A maintenance relay is exposed. I can release the restraints before Donus notices. Listen carefully before you move.', shot: 'present', duration: 8, automatic: true },
    { speaker: 'Prime', text: 'Security robots patrol the ship. Cameras watch the corridors and the entrances to every major room.', shot: 'corridor', duration: 8, automatic: true },
    { speaker: 'Prime', text: 'Trilobyte bots patrol between them. They do not need to see you for long to raise an alarm.', shot: 'patrol', duration: 7.5, automatic: true },
    { speaker: 'Prime', text: 'Watch the lenses. Use cover. Let a patrol pass when you can. We need a way out, not a fight in every corridor.', shot: 'corridor', duration: 8.3, automatic: true },
    { speaker: 'Brondon', text: 'Stay with me, Prime.', shot: 'present' },
    { speaker: 'Prime', text: 'Always. When the field drops, brace for the fall. Get to your feet. Then we find the others.', shot: 'present' },
  ];

  const overlay = document.createElement('div');
  overlay.id = 'prologue-dialogue';
  overlay.className = 'hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = [
    '<div class="prologue-dialogue-inner">',
    '  <div class="prologue-dialogue-speaker"></div>',
    '  <div class="prologue-dialogue-text"></div>',
    '  <div class="prologue-dialogue-hint">▸ click to continue</div>',
    '</div>',
  ].join('\n');
  document.body.appendChild(overlay);

  const cinemaOverlay = document.createElement('div');
  cinemaOverlay.id = 'prologue-cinema';
  cinemaOverlay.setAttribute('aria-hidden', 'true');
  cinemaOverlay.innerHTML = '<div class="prologue-film"></div><div class="prologue-bar top"></div><div class="prologue-bar bottom"></div><div class="prologue-memory-label"></div><div class="prologue-shot-fade"></div>';
  document.body.appendChild(cinemaOverlay);
  const memoryLabel = cinemaOverlay.querySelector('.prologue-memory-label') as HTMLDivElement;
  const shotFade = cinemaOverlay.querySelector('.prologue-shot-fade') as HTMLDivElement;
  const title = document.createElement('div');
  title.id = 'prologue-title';
  title.setAttribute('aria-hidden', 'true');
  title.innerHTML = '<div class="prologue-title-word">Brondons</div><div class="prologue-title-word revenge">Revenge</div>';
  document.body.appendChild(title);

  const speakerEl = overlay.querySelector('.prologue-dialogue-speaker') as HTMLDivElement;
  const textEl = overlay.querySelector('.prologue-dialogue-text') as HTMLDivElement;
  const hintEl = overlay.querySelector('.prologue-dialogue-hint') as HTMLDivElement;

  const style = document.createElement('style');
  style.id = 'prologue-dialogue-style';
  style.textContent = `
    body.prologue-playing #hud,
    body.prologue-playing #health-bar,
    body.prologue-playing #crosshair,
    body.prologue-playing #minimap,
    body.prologue-playing #control-card,
    body.prologue-playing #view-toggle-btn,
    body.prologue-playing #touch-controls { display: none !important; }
    #prologue-cinema { position: fixed; inset: 0; pointer-events: none; z-index: 1850; }
    .prologue-bar { position: absolute; left: 0; width: 100%; height: 7%; background: #020409; }
    .prologue-bar.top { top: 0; }
    .prologue-bar.bottom { bottom: 0; }
    .prologue-film { position: absolute; inset: 0; opacity: 0; background: repeating-linear-gradient(transparent 0px, transparent 3px, rgba(9, 20, 27, 0.12) 4px); box-shadow: inset 0 0 160px 40px rgba(0, 0, 0, 0.48); }
    #prologue-cinema.memory .prologue-film { opacity: 0.62; }
    .prologue-memory-label { position: absolute; top: 9%; left: 5%; font: 12px 'Courier New', monospace; letter-spacing: 0; color: #c4d6d9; opacity: 0.8; }
    .prologue-shot-fade { position: absolute; inset: 0; background: #03060b; opacity: 0; }
    #prologue-title { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; z-index: 2450; color: #f1f5f2; opacity: 0; visibility: hidden; text-shadow: 0 2px 28px #000; font-family: Impact, 'Arial Narrow', sans-serif; letter-spacing: 0; text-transform: uppercase; }
    .prologue-title-word { font-size: 82px; line-height: 0.95; max-width: calc(100vw - 40px); }
    .prologue-title-word.revenge { color: #e38e81; }
    #prologue-dialogue {
      position: fixed;
      left: 50%;
      bottom: 8%;
      transform: translateX(-50%);
      max-width: min(820px, 90vw);
      width: calc(100% - 48px);
      padding: 18px 22px 14px;
      background: rgba(6, 10, 14, 0.86);
      border: 1px solid rgba(170, 190, 215, 0.35);
      border-radius: 6px;
      color: #e4ecf2;
      font-family: 'Courier New', monospace;
      z-index: 2000;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
      transition: opacity 260ms ease;
    }
    #prologue-dialogue.hidden { display: none; }
    #prologue-dialogue.fading { opacity: 0; }
    .prologue-dialogue-speaker {
      font-size: 12px;
      letter-spacing: 0;
      color: #ffd089;
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .prologue-dialogue-text {
      font-size: 18px;
      line-height: 1.55;
      min-height: 1.55em;
      color: #e4ecf2;
      white-space: pre-wrap;
    }
    .prologue-dialogue-hint {
      margin-top: 10px;
      font-size: 11px;
      letter-spacing: 0;
      color: #8798a6;
      opacity: 0.75;
      text-align: right;
    }
    .prologue-dialogue-hint.hidden { visibility: hidden; }
    @media (max-width: 600px) {
      .prologue-title-word { font-size: 52px; }
      #prologue-dialogue { padding: 12px 14px; width: calc(100% - 28px); }
      .prologue-dialogue-text { font-size: 15px; }
    }
  `;
  document.head.appendChild(style);

  let dialogueIndex = -1;
  let dialogueActive = false;
  let typedChars = 0;
  let beatTime = 0;
  let activeShot: PrologueShot = 'present';
  let shotChanged = false;
  let releaseTime = -1;
  let finished = false;
  let playable = false;
  let exitTime = -1;
  const exitPrompt = document.createElement('div');
  exitPrompt.id = 'prologue-exit-prompt';
  exitPrompt.textContent = 'Press E to begin your revenge';
  exitPrompt.style.cssText = 'position:fixed;left:0;right:0;bottom:18%;padding:0 20px;text-align:center;color:#d6f1ff;font-size:16px;text-shadow:0 2px 6px #000;z-index:1100;pointer-events:none;display:none;';
  document.body.appendChild(exitPrompt);
  const presentCameraStart = new THREE.Vector3();
  const presentCameraEnd = new THREE.Vector3();
  const releaseCameraStart = new THREE.Vector3();
  const releaseLook = new THREE.Vector3();
  const TYPE_SPEED = 28; // characters per second

  function showDialogueLine(): void {
    const line = lines[dialogueIndex];
    if (!line) return;
    beatTime = 0;
    const nextShot = line.shot ?? 'present';
    shotChanged = nextShot !== activeShot;
    activeShot = nextShot;
    const historical = ['asteroid', 'collection', 'ingest', 'corruption', 'capture', 'laboratory', 'shield'].includes(activeShot);
    cinemaOverlay.classList.toggle('memory', historical);
    memoryLabel.textContent = historical ? 'PRIME / RECOVERED MEMORY' : activeShot === 'planet' ? 'LAST KNOWN TRANSPORT / NEAREST PLANET'
      : activeShot === 'corridor' || activeShot === 'patrol' ? 'PRIME / SHIP SECURITY FEED' : '';
    if (gameCanvas) gameCanvas.style.filter = historical ? 'saturate(0.38) sepia(0.2) contrast(1.12) brightness(1.12)' : originalFilter;
    const close = line.speaker === 'Brondon';
    presentCameraStart.set(close ? 1.25 : 2.35, close ? 2.25 : 1.8, close ? -1.25 : 1.75);
    presentCameraEnd.copy(presentCameraStart).multiplyScalar(0.92);
    speakerEl.textContent = line.speaker;
    textEl.textContent = '';
    typedChars = 0;
    hintEl.classList.add('hidden');
    overlay.classList.remove('hidden', 'fading');
  }

  function completeTyping(): void {
    const line = lines[dialogueIndex];
    if (!line) return;
    textEl.textContent = line.text;
    typedChars = line.text.length;
    hintEl.classList.toggle('hidden', !!line.automatic);
  }

  function advanceDialogue(): void {
    if (!dialogueActive) return;
    const line = lines[dialogueIndex];
    if (line && typedChars < line.text.length) {
      completeTyping();
      return;
    }
    if (line?.automatic && beatTime < 2.5) return;
    dialogueIndex += 1;
    if (dialogueIndex >= lines.length) {
      dialogueActive = false;
      overlay.classList.add('hidden');
      activeShot = 'present';
      cinemaOverlay.classList.remove('memory');
      memoryLabel.textContent = '';
      if (gameCanvas) gameCanvas.style.filter = originalFilter;
      releaseTime = 0;
      releaseCameraStart.copy(camera.position);
      return;
    }
    showDialogueLine();
  }

  function onClick(event: MouseEvent): void {
    if (!dialogueActive) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    event.preventDefault();
    advanceDialogue();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
      return;
    }
    if (playable && exitTime < 0 && !finished && event.code === 'KeyE') {
      event.preventDefault();
      exitTime = 0;
      player.disable();
      player.clearInput();
      exitPrompt.style.display = 'none';
      return;
    }
    if (!dialogueActive || (event.code !== 'Space' && event.code !== 'Enter')) return;
    event.preventDefault();
    advanceDialogue();
  }

  window.addEventListener('mousedown', onClick);
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------------------------ runtime
  const physicsWorld = physics.world;
  let timelineTime = 0;
  let dialogueStarted = false;
  let lastDelta = 0;
  let disposed = false;

  function breakChains(): void {
    if (chainsBroken) return;
    chainsBroken = true;
    const loose = [...wrappedLinks, ...armChains.flatMap(tether => tether.links)];
    loose.forEach((mesh, linkIndex) => {
      scene.attach(mesh);
      const side = Math.sign(mesh.position.x) || 1;
      brokenLinks.push({
        mesh, origin: mesh.position.clone(),
        velocity: new THREE.Vector3(side * (0.16 + detailNoise(linkIndex) * 0.48), 0.2 + detailNoise(linkIndex + 90) * 0.5, (detailNoise(linkIndex + 40) - 0.5) * 0.65),
        spin: new THREE.Vector3(detailNoise(linkIndex + 500) * 5, detailNoise(linkIndex + 600) * 4, detailNoise(linkIndex + 700) * 5),
      });
    });
    for (const wrap of armWraps) wrap.visible = false;
  }

  function updateRelease(frame: number): void {
    releaseTime += frame;
    if (releaseTime >= 0.45) breakChains();
    const field = 1 - THREE.MathUtils.smoothstep(releaseTime, 0.45, 1.25);
    floorLight.intensity = field * 7;
    floorGlow.material.opacity = field * 0.85;
    flowMaterial.uniforms.strength.value = field;
    floorFlow.visible = floorGlow.visible = field > 0;
    for (const piece of brokenLinks) {
      const elapsed = Math.max(0, releaseTime - 0.45);
      const landing = (piece.velocity.y + Math.sqrt(piece.velocity.y ** 2 + 19.6 * Math.max(0, piece.origin.y - 0.04))) / 9.8;
      const flight = Math.min(elapsed, landing);
      piece.mesh.position.copy(piece.origin).addScaledVector(piece.velocity, flight);
      piece.mesh.position.y = Math.max(0.04, piece.origin.y + piece.velocity.y * flight - 4.9 * flight * flight);
      if (elapsed < landing) {
        piece.mesh.rotation.x += piece.spin.x * frame;
        piece.mesh.rotation.y += piece.spin.y * frame;
        piece.mesh.rotation.z += piece.spin.z * frame;
      }
    }
    if (subjectRoot) {
      if (releaseTime < 2.4) {
        const fall = THREE.MathUtils.clamp((releaseTime - 0.8) / 0.75, 0, 1);
        subjectRoot.position.lerpVectors(hoveringPosition, groundedPosition, fall * fall);
        subjectRoot.quaternion.copy(lyingRotation);
      } else if (releaseTime < 5.7) {
        if (!getUpStarted) { getUpStarted = true; getUpAction?.reset().play(); }
        subjectMixer?.update(frame);
        const rising = THREE.MathUtils.smootherstep(releaseTime, 2.4, 3.7);
        subjectRoot.quaternion.slerpQuaternions(lyingRotation, standingRotation, rising);
        subjectRoot.updateMatrixWorld(true);
        const lowestFoot = Math.min(footLeft?.getWorldPosition(footPosition).y ?? 0.04, footRight?.getWorldPosition(footPosition).y ?? 0.04);
        subjectRoot.position.y += 0.07 - lowestFoot;
        subjectRoot.position.x *= 0.88;
        subjectRoot.position.z *= 0.88;
      } else {
        if (getUpAction?.isRunning() || getUpAction?.paused) { getUpAction.stop(); idleAction?.reset().play(); }
        subjectMixer?.update(frame);
        subjectRoot.quaternion.copy(standingRotation);
        subjectRoot.position.x = subjectRoot.position.z = 0;
        subjectRoot.updateMatrixWorld(true);
        const lowestFoot = Math.min(footLeft?.getWorldPosition(footPosition).y ?? 0.04, footRight?.getWorldPosition(footPosition).y ?? 0.04);
        subjectRoot.position.y += 0.07 - lowestFoot;
      }
      subjectRoot.updateMatrixWorld(true);
    }
    camera.fov = 52;
    if (releaseTime < 2.4) {
      const reveal = THREE.MathUtils.smootherstep(releaseTime, 0, 1.45);
      camera.position.lerpVectors(releaseCameraStart, new THREE.Vector3(2.65, 1.2, 2.65), reveal);
      releaseLook.set(0, THREE.MathUtils.lerp(1.5, 0.45, reveal), 0);
      camera.lookAt(releaseLook);
      const impact = 1 - THREE.MathUtils.smoothstep(releaseTime, 1.55, 1.95);
      if (releaseTime > 1.55) camera.position.y += Math.sin(releaseTime * 84) * impact * 0.035;
    } else if (releaseTime < 5.7) {
      const rise = THREE.MathUtils.smootherstep(releaseTime, 2.4, 5.7);
      camera.position.set(2.65, 1.2 + rise * 0.5, 2.65 - rise * 0.25);
      camera.lookAt(0, 0.65 + rise * 0.45, 0);
    } else if (releaseTime < 9.4) {
      const orbit = THREE.MathUtils.smootherstep(releaseTime, 5.7, 9.4);
      const angle = Math.PI * 0.28 - orbit * Math.PI * 2.12;
      const distance = 3.1 - orbit * 0.35;
      camera.position.set(Math.sin(angle) * distance, 1.7 + orbit * 0.2, Math.cos(angle) * distance);
      camera.lookAt(0, 1.1, 0);
    } else {
      const settle = THREE.MathUtils.smootherstep(releaseTime, 9.4, 10.8);
      const startAngle = Math.PI * 0.28 - Math.PI * 2.12;
      const orbitEnd = new THREE.Vector3(Math.sin(startAngle) * 2.75, 1.9, Math.cos(startAngle) * 2.75);
      const gameplayPosition = new THREE.Vector3(thirdPersonCamera.right, 1.6 + thirdPersonCamera.height, thirdPersonCamera.distance);
      camera.position.lerpVectors(orbitEnd, gameplayPosition, settle);
      const cinematicRotation = new THREE.PerspectiveCamera();
      cinematicRotation.position.copy(orbitEnd);
      cinematicRotation.lookAt(0, 1.1, 0);
      camera.quaternion.slerpQuaternions(cinematicRotation.quaternion, new THREE.Quaternion(), settle);
      camera.fov = THREE.MathUtils.lerp(52, 75, settle);
      const titleTime = releaseTime - 9.4;
      const titleOpacity = THREE.MathUtils.smoothstep(titleTime, 0.3, 1.9) * (1 - THREE.MathUtils.smoothstep(titleTime, 4.4, 6.5));
      title.style.visibility = titleOpacity > 0 ? 'visible' : 'hidden';
      title.style.opacity = String(titleOpacity);
      title.style.transform = `translateY(${(1 - THREE.MathUtils.smoothstep(titleTime, 0.3, 2.2)) * 10}px)`;
      shotFade.style.opacity = '0';
      if (titleTime >= 6.5 && !playable) {
        playable = true;
        if (subjectRoot) subjectRoot.visible = false;
        subjectMixer?.stopAllAction();
        cinemaOverlay.style.display = 'none';
        document.body.classList.remove('prologue-playing');
        player.setPosition(0, PHYSICS.playerRadius, 0);
        player.setRotation(0, 0);
        player.clearInput();
        player.enable();
        exitPrompt.style.display = 'block';
        onPlayable?.();
      }
    }
    camera.updateProjectionMatrix();
  }

  function updatePhysics(dt: number, thirdPerson = true): void {
    if (disposed) return;
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    lastDelta = frame;
    if (playable) {
      if (exitTime >= 0) {
        exitTime += frame;
        if (exitTime >= HOLOGRAM_TRANSFER_DURATION && !finished) {
          finished = true;
          onFinished?.();
        }
      } else physics.step(frame, player, thirdPerson);
      return;
    }
    if (modelReady && flashbacksReady) timelineTime += frame;

    // Nothing dynamic lives in the world, but step it to keep contacts cheap.
    physicsWorld.step(1 / 60, frame, 3);

    // Camera cutscene -> hold on the wide shot once we pass the last keyframe.
    if (!dialogueStarted && releaseTime < 0) {
      applyCameraAt(timelineTime);
      shotFade.style.opacity = String(1 - THREE.MathUtils.smoothstep(timelineTime, 0, 0.8));
    }

    if (subjectRoot && releaseTime < 0) {
      subjectRoot.position.y = subjectHoverY + Math.sin(timelineTime * 0.8) * 0.035;
      subjectRoot.updateMatrixWorld(true);
      updateArmChains();
    }
    flowMaterial.uniforms.flowTime.value = timelineTime;
    if (releaseTime < 0) {
      floorLight.intensity = 7 + Math.sin(timelineTime * 1.1) * 0.35;
      floorGlow.material.opacity = 0.85 + Math.sin(timelineTime * 1.1) * 0.06;
    }

    const eyeShotActive = timelineTime >= EYE_SHOT_START && timelineTime < EYE_SHOT_END;
    eyeCanvas.style.display = eyeShotActive ? 'block' : 'none';
    if (eyeShotActive) {
      const elapsed = timelineTime - EYE_SHOT_START;
      const duration = EYE_SHOT_END - EYE_SHOT_START;
      eyeCanvas.style.opacity = String(
        THREE.MathUtils.smoothstep(elapsed, 0, 0.22)
        * (1 - THREE.MathUtils.smoothstep(elapsed, duration - 0.3, duration)),
      );
      drawEyeCloseup(elapsed);
    }

    // Subtle breathing on the corner strip lights.
    const pulse = 2.2 + Math.sin(timelineTime * 1.8) * 0.15;
    for (const light of stripLights) light.intensity = pulse;

    // Start the dialogue once the cutscene has settled on the wide shot.
    if (!dialogueStarted && timelineTime >= DIALOGUE_START) {
      dialogueStarted = true;
      dialogueActive = true;
      dialogueIndex = 0;
      showDialogueLine();
    }

    // Advance the typewriter effect while a line is still printing.
    if (dialogueActive) {
      const line = lines[dialogueIndex];
      beatTime += frame;
      shotFade.style.opacity = shotChanged ? String(1 - THREE.MathUtils.smoothstep(beatTime, 0, 0.35)) : '0';
      if (activeShot === 'present') {
        camera.position.lerpVectors(presentCameraStart, presentCameraEnd, THREE.MathUtils.smootherstep(beatTime, 0, 8));
        camera.lookAt(subjectCenter);
        camera.fov = camera.aspect < 1 ? 64 : line?.speaker === 'Brondon' ? 47 : 52;
        camera.updateProjectionMatrix();
      } else {
        flashbacks.update(activeShot, beatTime, line?.duration ?? 8, frame, camera);
      }
      if (line && typedChars < line.text.length) {
        typedChars = Math.min(line.text.length, typedChars + frame * TYPE_SPEED);
        const shown = Math.floor(typedChars);
        textEl.textContent = line.text.slice(0, shown);
        if (shown >= line.text.length) hintEl.classList.toggle('hidden', !!line.automatic);
      }
      if (line?.automatic && beatTime >= Math.max(line.duration ?? 6, line.text.length / TYPE_SPEED + 2.8)) advanceDialogue();
    }
    if (releaseTime >= 0) updateRelease(frame);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('mousedown', onClick);
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    eyeCanvas.remove();
    cinemaOverlay.remove();
    title.remove();
    exitPrompt.remove();
    document.body.classList.remove('prologue-playing');
    if (gameCanvas) gameCanvas.style.filter = originalFilter;
    document.getElementById('prologue-dialogue-style')?.remove();
    flashbacks.dispose();
    subjectMixer?.stopAllAction();
    if (subjectMixer) subjectMixer.uncacheRoot(subjectMixer.getRoot());
    if (subjectRoot) {
      subjectRoot.removeFromParent();
      subjectRoot.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      subjectRoot = null;
    }
    armChains.length = 0;
    glowTexture.dispose();
    scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    player.dispose();
    physics.dispose();
  }

  // ---------------------------------------------------------- scene contract
  return {
    roomId: 'prologue-1',
    scene,
    camera,
    ready: Promise.all([subjectReady, flashbacks.ready]),
    getRenderScene: () => flashbacks.sceneFor(activeShot) ?? scene,
    physicsWorld,
    player,
    cutsceneManager: null,
    isCinematic: () => !playable || exitTime >= 0,
    getHologramTransition: () => exitTime >= 0 ? hologramTransitionAt(exitTime) : null,
    ownsWeaponInput: true,
    forceThirdPerson: true,
    isThirdPersonView: () => true,
    canToggleView: () => false,
    controlsReady: () => playable && exitTime < 0,
    getCinematicDelta: () => lastDelta,
    getCinematicState: () => null,
    getCinematicPose: () => null,
    getDamageTargets: () => [],
    getParryableBolts: () => [],
    updatePhysics,
    dispose,
  };
}
