/** Prologue Scene 1 - "Awakening". */
import * as THREE from "three";
import { createShipSurfaceMaterial, createShipServiceDetails } from "../../scripts/global/shipInterior.js";
import {
  isControllerEvent,
  inputHint,
} from "../../scripts/player/gamepadInput.js";
import {
  createScenePhysics,
  PHYSICS,
} from "../../helpers/physics/scenePhysics.js";
import { loadPlayerModel, loadTexture } from "../../core/loader.js";
import eyePhotographUrl from "../../assets/textures/brondon-eyes.png?url";
import { createEyeOpening } from "./eyeOpening.js";
import { createPlayer } from "../../scripts/player/player.js";
import {
  applyLayFlatPose,
  createPrologueGetUpClip,
  HOLOGRAM_TRANSFER_DURATION,
  hologramTransitionAt,
} from "../../scripts/player/characterManager.js";
import {
  createPrologueFlashbacks,
  createPrologueShield,
  type PrologueShot,
} from "./prologueFlashbacks.js";
import { createHoldToSkip } from "../../scripts/global/holdToSkip.js";
import hologramVertexShader from "../../shaders/vert/hologram.vert.glsl?raw";
import hologramFragmentShader from "../../shaders/frag/hologram.frag.glsl?raw";
import { prepareSceneRendering } from "../../core/renderer.js";
import { createPrisonLight } from "../../scripts/global/prisonLight.js";

interface PrologueOptions {
  onPlayable?: () => void;
  onFinished?: () => void | boolean | Promise<void | boolean>;
  thirdPersonCamera?: { distance: number; height: number; right: number };
  preview?: boolean;
}

interface DialogueLine {
  speaker: "Brondon" | "Prime" | "???";
  text: string;
  shot?: PrologueShot;
  duration?: number;
  automatic?: boolean;
}

export const PROLOGUE_DIALOGUE: readonly DialogueLine[] = [
  { speaker: "Brondon", text: "..." },
  { speaker: "Brondon", text: "Where am I?" },
  { speaker: "???", text: "Easy. You are finally awake." },
  { speaker: "Brondon", text: "Prime? is that you?" },
  {
    speaker: "Prime",
    text: "Yes, Brondon. The neural link is stable. I am still here.",
  },
  {
    speaker: "Brondon",
    text: "What happened, Prime? The last thing I remember is the asteroid.",
  },
  {
    speaker: "Prime",
    text: "Eight of you were on that survey: three lecturers, including you, and five students.",
    shot: "asteroid",
    duration: 5.5,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "You collected scans and mineral samples to train Donus, our newest AI model.",
    shot: "collection",
    duration: 5,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "Back aboard the ship, Donus began ingesting the survey data.",
    shot: "ingest",
    duration: 4.5,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "One stream was corrupted. Its safeguards failed, and Donus went rogue.",
    shot: "corruption",
    duration: 5,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "It seized the ship. Its robots ambushed the crew, restrained them and took them hostage.",
    shot: "capture",
    duration: 5.5,
    automatic: true,
  },
  {
    speaker: "Brondon",
    text: "The other lecturers... the students. What did it do to them?",
  },
  {
    speaker: "Prime",
    text: "Donus took Branden, Brendan and all five students to the lab. It restrained and experimented on them.",
    shot: "laboratory",
    duration: 6,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "You were next. The robots sealed you inside an experiment pod.",
    shot: "experiment",
    duration: 4.5,
    automatic: true,
  },
  {
    speaker: "Brondon",
    text: "Then why am I still here? Why didn't it experiment on me?",
  },
  {
    speaker: "Prime",
    text: "I released your shield in the lab. The burst shattered your pod before the experiment could start.",
    shot: "breakout",
    duration: 6,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "Donus had the robots chain you up in this prison. These chains sap your energy and prevent me from easily releasing your shield.",
    duration: 6.5,
    automatic: true,
  },
  { speaker: "Brondon", text: "Where are we now? What about the others?" },
  {
    speaker: "Prime",
    text: "We're still aboard the Donus mothership. I don't have physical records of where the others are.",
    shot: "planet",
    duration: 6,
    automatic: true,
  },
  {
    speaker: "Brondon",
    text: "Then I have to save them. How do I get out of these chains?",
  },
  {
    speaker: "Prime",
    text: "I have stored enough energy to break the chains.",
    duration: 4,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "I'll loop this cell's camera feed in the surveillance room. Donus won't notice you're gone.",
    duration: 5.5,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "We need to reach our ship in Hangar 14, but there is security everywhere.",
    shot: "security",
    duration: 10,
    automatic: true,
  },
  {
    speaker: "Brondon",
    text: "Is there anywhere on the ship I can get to without being seen?",
  },
  {
    speaker: "Prime",
    text: "Your homing beacon can teleport you to your room, but only once. There are no patrols in the crew cabins.",
    duration: 6,
    automatic: true,
  },
  {
    speaker: "Prime",
    text: "Get your gear, then get off this ship as soon as you can.",
    duration: 4,
    automatic: true,
  },
  { speaker: "Brondon", text: "Let's do this." },
  { speaker: "Prime", text: "Brace for impact." },
];

export function createScene({
  onPlayable,
  onFinished,
  preview = false,
  thirdPersonCamera = { distance: 1.5, height: 0.3, right: 0.7 },
}: PrologueOptions = {}) {
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
  const player = createPlayer({
    camera,
    physicsWorld: physics.world,
    spawnPosition: { x: 0, y: PHYSICS.playerRadius, z: 0 },
  });
  player.disable();
  const flashbacks = preview ? null : createPrologueFlashbacks();
  const gameCanvas = document.querySelector<HTMLCanvasElement>("canvas");
  const originalFilter = gameCanvas?.style.filter ?? "";
  if (!preview) document.body.classList.add("prologue-playing");

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
  const wallMat = createShipSurfaceMaterial("panel", 0x35424f);
  const floorMat = createShipSurfaceMaterial("deck", 0x26303b);
  const ceilingMat = createShipSurfaceMaterial("machinery", 0x212d37);
  scene.add(createShipServiceDetails({
    width: roomSize.x, depth: roomSize.z, height: roomSize.y,
    label: "DETENTION / PRESSURE SEALED", accent: 0x558899,
  }));

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(roomSize.x, 0.2, roomSize.z),
    floorMat,
  );
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.addBoxFromMesh(floor);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(roomSize.x, 0.2, roomSize.z),
    ceilingMat,
  );
  ceiling.position.y = roomSize.y + 0.1;
  scene.add(ceiling);
  physics.addBoxFromMesh(ceiling);

  function wall(
    width: number,
    height: number,
    position: THREE.Vector3,
    yaw: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.2),
      wallMat,
    );
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    mesh.receiveShadow = true;
    scene.add(mesh);
    physics.addBoxFromMesh(mesh);
  }
  wall(
    roomSize.x,
    roomSize.y,
    new THREE.Vector3(0, roomSize.y / 2, -roomSize.z / 2),
    0,
  );
  wall(
    roomSize.x,
    roomSize.y,
    new THREE.Vector3(0, roomSize.y / 2, roomSize.z / 2),
    0,
  );
  wall(
    roomSize.z,
    roomSize.y,
    new THREE.Vector3(-roomSize.x / 2, roomSize.y / 2, 0),
    Math.PI / 2,
  );
  wall(
    roomSize.z,
    roomSize.y,
    new THREE.Vector3(roomSize.x / 2, roomSize.y / 2, 0),
    Math.PI / 2,
  );

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
    [
      roomSize.x - 0.4,
      0.03,
      new THREE.Vector3(0, 0.015, -roomSize.z / 2 + 0.11),
    ],
    [
      roomSize.x - 0.4,
      0.03,
      new THREE.Vector3(0, 0.015, roomSize.z / 2 - 0.11),
    ],
    [0.03, 0.03, new THREE.Vector3(-roomSize.x / 2 + 0.11, 0.015, 0)],
    [0.03, 0.03, new THREE.Vector3(roomSize.x / 2 - 0.11, 0.015, 0)],
  ] as const) {
    const isSide = (pos as THREE.Vector3).x !== 0;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(
        isSide ? 0.03 : (w as number),
        h as number,
        isSide ? roomSize.z - 0.4 : 0.03,
      ),
      floorStripMat,
    );
    strip.position.copy(pos as THREE.Vector3);
    scene.add(strip);
  }

  const HOVER_HEIGHT = 1.45;
  const subjectCenter = new THREE.Vector3(0, HOVER_HEIGHT + 0.15, 0);
  const releaseShield = createPrologueShield();
  scene.add(releaseShield.root);

  const prisonLight = createPrisonLight();
  const { floorGlow, floorLight, floorFlow, flowMaterial, glowTexture } =
    prisonLight;
  scene.add(prisonLight.root);

  const cuffMaterial = new THREE.ShaderMaterial({
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
  let chainTime = 0;
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
  const brokenLinks: Array<{
    mesh: THREE.Mesh;
    origin: THREE.Vector3;
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
  }> = [];
  const hoveringPosition = new THREE.Vector3();
  const groundedPosition = new THREE.Vector3();
  const lyingRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0),
  );
  const standingRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, Math.PI, 0),
  );
  const footPosition = new THREE.Vector3();
  let footLeft: THREE.Object3D | undefined;
  let footRight: THREE.Object3D | undefined;
  let modelReady = false;
  let flashbacksReady = preview;
  const flashbackPreparation = flashbacks?.ready.then(() => {
    flashbacksReady = true;
  });

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
        link.rotateY(((linkIndex % 2) * Math.PI) / 2);
      });
    }
  }

  const subjectReady = loadPlayerModel()
    .then((gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      applyLayFlatPose(gltf);
      subjectMixer = new THREE.AnimationMixer(model);
      getUpAction = subjectMixer.clipAction(createPrologueGetUpClip(gltf));
      getUpAction.setLoop(THREE.LoopOnce, 1);
      getUpAction.clampWhenFinished = true;
      const idle = gltf.animations.find((clip) => clip.name === "Idle_Loop");
      idleAction = idle ? subjectMixer.clipAction(idle) : null;
      model.rotation.set(-Math.PI / 2, 0, 0);
      model.position.set(0, 0, 0);
      model.updateMatrixWorld(true);
      const bodyBounds = new THREE.Box3().setFromObject(model);
      const bodyCenter = bodyBounds.getCenter(new THREE.Vector3());
      model.position.set(
        -bodyCenter.x,
        HOVER_HEIGHT - bodyBounds.min.y,
        -bodyCenter.z,
      );
      model.updateMatrixWorld(true);
      subjectHoverY = model.position.y;
      hoveringPosition.copy(model.position);
      groundedPosition
        .copy(model.position)
        .add(new THREE.Vector3(0, -HOVER_HEIGHT + 0.04, 0));
      footLeft = model.getObjectByName("foot_l");
      footRight = model.getObjectByName("foot_r");
      subjectCenter.y =
        HOVER_HEIGHT + (bodyBounds.max.y - bodyBounds.min.y) / 2;
      scene.add(model);
      subjectRoot = model;
      model.traverse((node) => {
        if (node instanceof THREE.Mesh)
          node.castShadow = node.receiveShadow = true;
      });

      for (const suffix of ["l", "r"] as const) {
        const forearm = model.getObjectByName(`lowerarm_${suffix}`);
        const hand = model.getObjectByName(`hand_${suffix}`);
        if (!forearm || !hand) continue;
        const wristWorld = hand.getWorldPosition(new THREE.Vector3());
        const wristLocal = forearm.worldToLocal(wristWorld.clone());
        const cuffRadius = THREE.MathUtils.clamp(
          wristLocal.length() * 0.16,
          0.036,
          0.055,
        );
        const armWrap = new THREE.Group();
        armWrap.position.copy(wristLocal).multiplyScalar(0.82);
        armWrap.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          wristLocal.clone().normalize(),
        );
        forearm.add(armWrap);
        armWraps.push(armWrap);

        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(cuffRadius, cuffRadius, 0.05, 20, 1, true),
          cuffMaterial,
        );
        band.rotation.x = Math.PI / 2;
        armWrap.add(band);
        for (const rimZ of [-0.025, 0.025]) {
          const rim = new THREE.Mesh(
            new THREE.TorusGeometry(cuffRadius, 0.008, 8, 24),
            cuffMaterial,
          );
          rim.position.z = rimZ;
          armWrap.add(rim);
        }

        model.updateMatrixWorld(true);
        const localDown = new THREE.Vector3(0, -1, 0).applyQuaternion(
          armWrap.getWorldQuaternion(new THREE.Quaternion()).invert(),
        );
        const endAngle = Math.atan2(localDown.y, localDown.x);
        const wrapRadius = cuffRadius + 0.014;
        const wrapCount = 28;
        for (let wrapIndex = 0; wrapIndex < wrapCount; wrapIndex++) {
          const fraction = wrapIndex / (wrapCount - 1);
          const angle = endAngle + (fraction - 1) * Math.PI * 4;
          const link = new THREE.Mesh(chainGeometry, cuffMaterial);
          link.scale.y = 1.1;
          link.position.set(
            Math.cos(angle) * wrapRadius,
            Math.sin(angle) * wrapRadius,
            -0.055 + fraction * 0.11,
          );
          const tangent = new THREE.Vector3(
            -Math.sin(angle),
            Math.cos(angle),
            0.11 / (Math.PI * 4 * wrapRadius),
          ).normalize();
          link.quaternion.setFromUnitVectors(chainUp, tangent);
          link.rotateY(((wrapIndex % 2) * Math.PI) / 2);
          armWrap.add(link);
          wrappedLinks.push(link);
        }

        const attachment = new THREE.Object3D();
        attachment.position.set(
          Math.cos(endAngle) * wrapRadius,
          Math.sin(endAngle) * wrapRadius,
          0.055,
        );
        armWrap.add(attachment);
        const attachmentWorld = attachment.getWorldPosition(
          new THREE.Vector3(),
        );
        const side = Math.sign(attachmentWorld.x) || (suffix === "l" ? 1 : -1);
        const floorAnchor = new THREE.Group();
        floorAnchor.position.set(side * 0.78, 0.015, attachmentWorld.z + 0.12);
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.03, 0.2),
          cuffMaterial,
        );
        floorAnchor.add(plate);
        const anchorRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.044, 0.012, 8, 20),
          cuffMaterial,
        );
        anchorRing.position.y = 0.065;
        floorAnchor.add(anchorRing);
        for (const boltX of [-0.07, 0.07]) {
          for (const boltZ of [-0.07, 0.07]) {
            const bolt = new THREE.Mesh(
              new THREE.CylinderGeometry(0.012, 0.012, 0.01, 6),
              cuffMaterial,
            );
            bolt.position.set(boltX, 0.02, boltZ);
            floorAnchor.add(bolt);
          }
        }
        scene.add(floorAnchor);
        const anchorWorld = floorAnchor.position
          .clone()
          .add(new THREE.Vector3(0, 0.095, 0));
        const curve = new THREE.QuadraticBezierCurve3(
          attachmentWorld,
          attachmentWorld.clone().lerp(anchorWorld, 0.5),
          anchorWorld,
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
      if (playable) {
        if (subjectRoot) subjectRoot.visible = false;
        subjectMixer?.stopAllAction();
        for (const mesh of [
          ...wrappedLinks,
          ...armChains.flatMap((tether) => tether.links),
        ])
          mesh.visible = false;
      }
    })
    .catch((err) => {
      console.warn("Prologue: failed to load MC.glb", err);
      modelReady = true;
    });

  const eyeCanvas = document.createElement("canvas");
  eyeCanvas.id = "prologue-eye-closeup";
  eyeCanvas.width = 1920;
  eyeCanvas.height = 720;
  eyeCanvas.setAttribute("aria-hidden", "true");
  eyeCanvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#020409;z-index:2400;pointer-events:none;display:none;";
  if (!preview) document.body.appendChild(eyeCanvas);
  let eyeOpening: ReturnType<typeof createEyeOpening> | null = null;
  const eyesReady = preview
    ? Promise.resolve()
    : loadTexture(eyePhotographUrl).then((texture) => {
        try {
          if (!disposed)
            eyeOpening = createEyeOpening(eyeCanvas, texture.image);
        } finally {
          texture.dispose();
        }
      });

  const EYE_SHOT_START = 5.2;
  const EYE_SHOT_END = 10.0;
  const DIALOGUE_START = 11.2;
  const openingView = new THREE.Vector3(2.6, 2.1, 2.8);
  type Keyframe = {
    time: number;
    pos: THREE.Vector3;
    look: THREE.Vector3;
    fov: number;
  };
  const keyframes: Keyframe[] = [
    { time: 0, pos: openingView, look: subjectCenter.clone(), fov: 52 },
    {
      time: DIALOGUE_START,
      pos: openingView,
      look: subjectCenter.clone(),
      fov: 52,
    },
  ];

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
  const lines = PROLOGUE_DIALOGUE;

  const overlay = document.createElement("div");
  overlay.id = "prologue-dialogue";
  overlay.className = "hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = [
    '<div class="prologue-dialogue-inner">',
    '  <div class="prologue-dialogue-speaker"></div>',
    '  <div class="prologue-dialogue-text"></div>',
    '  <div class="prologue-dialogue-hint">▸ click to continue</div>',
    "</div>",
  ].join("\n");
  if (!preview) document.body.appendChild(overlay);

  const cinemaOverlay = document.createElement("div");
  cinemaOverlay.id = "prologue-cinema";
  cinemaOverlay.setAttribute("aria-hidden", "true");
  cinemaOverlay.innerHTML =
    '<div class="prologue-film"></div><div class="prologue-bar top"></div><div class="prologue-bar bottom"></div><div class="prologue-memory-label"></div><div class="prologue-shot-fade"></div>';
  if (!preview) document.body.appendChild(cinemaOverlay);
  const memoryLabel = cinemaOverlay.querySelector(
    ".prologue-memory-label",
  ) as HTMLDivElement;
  const shotFade = cinemaOverlay.querySelector(
    ".prologue-shot-fade",
  ) as HTMLDivElement;
  const title = document.createElement("div");
  title.id = "prologue-title";
  title.setAttribute("aria-hidden", "true");
  title.innerHTML =
    '<span class="menu-title-main" data-text="BRONDON\'S REVENGE">BRONDON\'S REVENGE</span><span class="menu-title-kicker" data-text="A TALE OF VENGEANCE">A tale of vengeance</span>';
  if (!preview) document.body.appendChild(title);

  const speakerEl = overlay.querySelector(
    ".prologue-dialogue-speaker",
  ) as HTMLDivElement;
  const textEl = overlay.querySelector(
    ".prologue-dialogue-text",
  ) as HTMLDivElement;
  const hintEl = overlay.querySelector(
    ".prologue-dialogue-hint",
  ) as HTMLDivElement;

  const style = document.createElement("style");
  style.id = "prologue-dialogue-style";
  style.textContent = `
    body.prologue-playing #hud,
    body.prologue-playing #health-bar,
    body.prologue-playing #crosshair,
    body.prologue-playing #minimap,
    body.prologue-playing #control-card,
    body.prologue-playing #view-toggle-btn,
    body.prologue-playing #touch-controls { display: none !important; }
    #prologue-cinema { position: fixed; inset: 0; pointer-events: none; z-index: 1850; }
    .prologue-bar { position: absolute; left: 0; width: 100%; height: 7%; background: var(--comic-ink); }
    .prologue-bar.top { top: 0; }
    .prologue-bar.bottom { bottom: 0; }
    .prologue-film { position: absolute; inset: 0; opacity: 0; background: repeating-linear-gradient(transparent 0px, transparent 3px, rgba(9, 20, 27, 0.12) 4px); box-shadow: inset 0 0 160px 40px rgba(0, 0, 0, 0.48); }
    #prologue-cinema.memory .prologue-film { opacity: 0.62; }
    .prologue-memory-label { position: absolute; bottom: 9%; left: 4%; max-width: 90%; padding: 5px 9px; font: 700 11px/1.4 var(--comic-body); letter-spacing: 0; color: var(--comic-ink); background: var(--comic-yellow); border: 3px solid var(--comic-ink); box-shadow: 3px 3px 0 var(--comic-ink); overflow-wrap: anywhere; }
    .prologue-memory-label:empty { display: none; }
    .prologue-shot-fade { position: absolute; inset: 0; background: #03060b; opacity: 0; }
    #prologue-title { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.9em; pointer-events: none; z-index: 2450; opacity: 0; visibility: hidden; text-align: center; white-space: nowrap; filter: drop-shadow(3px 4px 0 var(--comic-ink)); }
    #prologue-dialogue {
      position: fixed;
      left: 50%;
      bottom: 8%;
      transform: translateX(-50%);
      max-width: min(820px, 90vw);
      width: calc(100% - 48px);
      padding: 18px 22px 14px;
      background: var(--comic-dots) 0 0 / 6px 6px, var(--comic-paper);
      border: 4px solid var(--comic-ink);
      border-radius: 3px;
      color: var(--comic-ink);
      font-family: var(--comic-body);
      font-weight: 700;
      z-index: 2000;
      cursor: pointer;
      user-select: none;
      box-shadow: 7px 7px 0 var(--comic-ink);
      transition: opacity 260ms ease;
    }
    #prologue-dialogue.hidden { display: none; }
    #prologue-dialogue.fading { opacity: 0; }
    .prologue-dialogue-speaker {
      display: inline-block;
      padding: 4px 10px;
      border: 2px solid var(--comic-ink);
      background: var(--comic-yellow);
      font: 400 20px/1.1 var(--comic-display);
      letter-spacing: 0;
      color: var(--comic-ink);
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    #prologue-dialogue[data-speaker="Prime"] .prologue-dialogue-speaker { background: var(--comic-cyan); }
    .prologue-dialogue-text {
      font-size: 18px;
      line-height: 1.55;
      min-height: 1.55em;
      color: var(--comic-ink);
      white-space: pre-wrap;
    }
    .prologue-dialogue-hint {
      margin-top: 10px;
      font-size: 11px;
      letter-spacing: 0;
      color: #424653;
      text-align: right;
    }
    .prologue-dialogue-hint.hidden { visibility: hidden; }
    #prologue-dialogue:is([data-speaker="Prime"], [data-speaker="???"]) {
      top: 9%;
      left: 4%;
      bottom: auto;
      transform: none;
      width: min(440px, calc(100vw - 40px));
      padding: 12px 16px 10px;
    }
    #prologue-dialogue:is([data-speaker="Prime"], [data-speaker="???"]) .prologue-dialogue-speaker {
      font-size: 17px;
      padding: 3px 8px;
      margin-bottom: 6px;
    }
    #prologue-dialogue:is([data-speaker="Prime"], [data-speaker="???"]) .prologue-dialogue-text {
      font-size: 16px;
      line-height: 1.45;
    }
    #prologue-dialogue:is([data-speaker="Prime"], [data-speaker="???"]) .prologue-dialogue-hint { margin-top: 6px; }
    @media (max-width: 600px) {
      #prologue-dialogue { padding: 12px 14px; width: calc(100% - 28px); }
      .prologue-dialogue-text { font-size: 15px; }
      #prologue-dialogue:is([data-speaker="Prime"], [data-speaker="???"]) { left: 14px; width: calc(100vw - 28px); padding: 10px 12px; }
      #prologue-dialogue:is([data-speaker="Prime"], [data-speaker="???"]) .prologue-dialogue-text { font-size: 14px; }
    }
  `;
  if (!preview) document.head.appendChild(style);

  let dialogueIndex = -1;
  let dialogueActive = false;
  let typedChars = 0;
  let beatTime = 0;
  let activeShot: PrologueShot = "present";
  let shotChanged = false;
  let releaseTime = -1;
  let finished = false;
  let playable = false;
  let exitTime = -1;
  const skipButton = document.createElement("button");
  skipButton.id = "prologue-skip";
  skipButton.className = "prologue-skip-btn";
  skipButton.type = "button";
  if (!preview) document.body.appendChild(skipButton);
  const skipHold = createHoldToSkip({
    button: skipButton,
    onSkip: finishCutscene,
    isAvailable: () => !preview && !playable && !finished,
  });
  const exitPrompt = document.createElement("div");
  exitPrompt.id = "prologue-exit-prompt";
  exitPrompt.textContent = inputHint("Press E to start your revenge");
  exitPrompt.style.display = "none";
  if (!preview) document.body.appendChild(exitPrompt);
  const presentCameraStart = new THREE.Vector3();
  const presentCameraEnd = new THREE.Vector3();
  const releaseCameraStart = new THREE.Vector3();
  const releaseLook = new THREE.Vector3();
  const TYPE_SPEED = 28; // characters per second

  function finishCutscene(): void {
    if (playable || finished) return;
    playable = true;
    dialogueActive = false;
    activeShot = "present";
    releaseTime = 16;
    skipHold.reset();
    skipButton.classList.add("hidden");
    if (subjectRoot) subjectRoot.visible = false;
    subjectMixer?.stopAllAction();
    for (const mesh of [
      ...wrappedLinks,
      ...armChains.flatMap((tether) => tether.links),
    ])
      mesh.visible = false;
    floorFlow.visible = floorGlow.visible = false;
    releaseShield.root.visible = false;
    floorLight.intensity = 0;
    eyeCanvas.style.display = "none";
    cinemaOverlay.style.display = "none";
    title.style.visibility = "hidden";
    title.style.opacity = "0";
    if (gameCanvas) gameCanvas.style.filter = originalFilter;
    document.body.classList.remove("prologue-playing");
    player.setPosition(0, PHYSICS.playerRadius, 0);
    player.setRotation(0, 0);
    player.clearInput();
    player.disable();
    camera.position.set(
      thirdPersonCamera.right,
      player.getHeadY() + thirdPersonCamera.height,
      thirdPersonCamera.distance,
    );
    camera.rotation.set(0, 0, 0, "YXZ");
    camera.far = 80;
    camera.fov = 75;
    camera.updateProjectionMatrix();
    speakerEl.textContent = "Prime";
    overlay.dataset.speaker = "Prime";
    overlay.dataset.shot = "present";
    textEl.textContent = inputHint("Press E to start your revenge.");
    hintEl.classList.add("hidden");
    overlay.classList.remove("hidden", "fading");
    exitPrompt.style.display = "block";
    onPlayable?.();
  }

  function showDialogueLine(): void {
    const line = lines[dialogueIndex];
    if (!line) return;
    beatTime = 0;
    const nextShot = line.shot ?? "present";
    shotChanged = nextShot !== activeShot;
    activeShot = nextShot;
    overlay.dataset.shot = activeShot;
    overlay.dataset.cut = "";
    const historical = [
      "asteroid",
      "collection",
      "ingest",
      "corruption",
      "capture",
      "laboratory",
      "experiment",
      "breakout",
    ].includes(activeShot);
    cinemaOverlay.classList.toggle("memory", historical);
    memoryLabel.textContent = historical
      ? "PRIME / RECOVERED MEMORY"
      : activeShot === "planet"
        ? "PRIME / MOTHERSHIP / RESCUE DESTINATION"
        : activeShot === "stealth"
          ? "PRIME / DECK ONE HANGAR / LIVE PATROLS"
          : activeShot === "corridor"
            ? "PRIME / HANGAR APPROACH / LIVE PATROL"
            : activeShot === "security"
              ? "PRIME / HANGAR 14 / OUR SHIP"
              : "";
    if (gameCanvas)
      gameCanvas.style.filter = historical
        ? "saturate(0.38) sepia(0.2) contrast(1.12) brightness(1.12)"
        : originalFilter;
    const close = line.speaker === "Brondon";
    presentCameraStart.set(
      close ? 1.25 : 2.35,
      close ? 2.25 : 1.8,
      close ? -1.25 : 1.75,
    );
    presentCameraEnd.copy(presentCameraStart).multiplyScalar(0.92);
    speakerEl.textContent = line.speaker;
    overlay.dataset.speaker = line.speaker;
    textEl.textContent = "";
    typedChars = 0;
    hintEl.classList.remove("hidden");
    overlay.classList.remove("hidden", "fading");
  }

  function completeTyping(): void {
    const line = lines[dialogueIndex];
    if (!line) return;
    textEl.textContent = line.text;
    typedChars = line.text.length;
    hintEl.classList.remove("hidden");
  }

  function advanceDialogue(): void {
    if (!dialogueActive) return;
    const line = lines[dialogueIndex];
    if (line && typedChars < line.text.length) {
      completeTyping();
      return;
    }
    dialogueIndex += 1;
    if (dialogueIndex >= lines.length) {
      dialogueActive = false;
      overlay.classList.add("hidden");
      activeShot = "present";
      cinemaOverlay.classList.remove("memory");
      memoryLabel.textContent = "";
      if (gameCanvas) gameCanvas.style.filter = originalFilter;
      releaseTime = 0;
      releaseCameraStart.copy(presentCameraStart);
      return;
    }
    showDialogueLine();
  }

  function onClick(event: MouseEvent): void {
    if (
      !dialogueActive ||
      event.button !== 0 ||
      document.hidden ||
      document.body.classList.contains("quick-menu-open")
    )
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(
        'button, input, textarea, select, [contenteditable="true"]',
      )
    ) {
      return;
    }
    event.preventDefault();
    advanceDialogue();
  }

  function onKey(event: KeyboardEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, [contenteditable="true"]')
    ) {
      return;
    }
    if (document.hidden || document.body.classList.contains("quick-menu-open"))
      return;
    if (event.repeat) return;
    if (playable && exitTime < 0 && !finished && event.code === "KeyE") {
      event.preventDefault();
      exitTime = 0;
      player.disable();
      player.clearInput();
      exitPrompt.style.display = "none";
      overlay.classList.add("hidden");
      return;
    }
    if (
      !dialogueActive ||
      (event.code !== "Space" &&
        !(event.code === "KeyE" && isControllerEvent(event)))
    )
      return;
    event.preventDefault();
    advanceDialogue();
  }

  if (!preview) {
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
  }

  // ------------------------------------------------------------------ runtime
  const physicsWorld = physics.world;
  let timelineTime = 0;
  let dialogueStarted = false;
  let lastDelta = 0;
  let disposed = false;

  function retryTeleport(error?: unknown) {
    if (disposed) return;
    console.error(
      "[Prologue] Transfer to living quarters failed:",
      error ?? "Destination could not be prepared",
    );
    finished = false;
    exitTime = -1;
    player.clearInput();
    player.disable();
    speakerEl.textContent = "Prime";
    textEl.textContent = inputHint(
      "The teleport link was interrupted. Press E to try again.",
    );
    overlay.classList.remove("hidden");
    exitPrompt.style.display = "block";
  }

  function detailNoise(index: number): number {
    const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function breakChains(): void {
    if (chainsBroken) return;
    chainsBroken = true;
    const loose = [
      ...wrappedLinks,
      ...armChains.flatMap((tether) => tether.links),
    ];
    loose.forEach((mesh, linkIndex) => {
      scene.attach(mesh);
      const side = Math.sign(mesh.position.x) || 1;
      brokenLinks.push({
        mesh,
        origin: mesh.position.clone(),
        velocity: new THREE.Vector3(
          side * (0.16 + detailNoise(linkIndex) * 0.48),
          0.2 + detailNoise(linkIndex + 90) * 0.5,
          (detailNoise(linkIndex + 40) - 0.5) * 0.65,
        ),
        spin: new THREE.Vector3(
          detailNoise(linkIndex + 500) * 5,
          detailNoise(linkIndex + 600) * 4,
          detailNoise(linkIndex + 700) * 5,
        ),
      });
    });
    for (const wrap of armWraps) wrap.visible = false;
  }

  function updateRelease(frame: number): void {
    releaseTime += frame;
    releaseShield.root.position.copy(subjectCenter);
    releaseShield.update(releaseTime);
    if (releaseTime >= 0.45) breakChains();
    const field = 1 - THREE.MathUtils.smoothstep(releaseTime, 0.45, 1.25);
    floorLight.intensity = field * 7;
    floorGlow.material.opacity = field * 0.85;
    flowMaterial.uniforms.strength.value = field;
    floorFlow.visible = floorGlow.visible = field > 0;
    for (const piece of brokenLinks) {
      const elapsed = Math.max(0, releaseTime - 0.45);
      const landing =
        (piece.velocity.y +
          Math.sqrt(
            piece.velocity.y ** 2 + 19.6 * Math.max(0, piece.origin.y - 0.04),
          )) /
        9.8;
      const flight = Math.min(elapsed, landing);
      piece.mesh.position
        .copy(piece.origin)
        .addScaledVector(piece.velocity, flight);
      piece.mesh.position.y = Math.max(
        0.04,
        piece.origin.y + piece.velocity.y * flight - 4.9 * flight * flight,
      );
      if (elapsed < landing) {
        piece.mesh.rotation.x += piece.spin.x * frame;
        piece.mesh.rotation.y += piece.spin.y * frame;
        piece.mesh.rotation.z += piece.spin.z * frame;
      }
    }
    if (subjectRoot) {
      if (releaseTime < 2.4) {
        const fall = THREE.MathUtils.clamp((releaseTime - 0.8) / 0.75, 0, 1);
        subjectRoot.position.lerpVectors(
          hoveringPosition,
          groundedPosition,
          fall * fall,
        );
        subjectRoot.quaternion.copy(lyingRotation);
      } else if (releaseTime < 5.7) {
        if (!getUpStarted) {
          getUpStarted = true;
          getUpAction?.reset().play();
        }
        subjectMixer?.update(frame);
        const rising = THREE.MathUtils.smootherstep(releaseTime, 2.4, 3.7);
        subjectRoot.quaternion.slerpQuaternions(
          lyingRotation,
          standingRotation,
          rising,
        );
        subjectRoot.updateMatrixWorld(true);
        const lowestFoot = Math.min(
          footLeft?.getWorldPosition(footPosition).y ?? 0.04,
          footRight?.getWorldPosition(footPosition).y ?? 0.04,
        );
        subjectRoot.position.y += 0.07 - lowestFoot;
        subjectRoot.position.x *= 0.88;
        subjectRoot.position.z *= 0.88;
      } else {
        if (getUpAction?.isRunning() || getUpAction?.paused) {
          getUpAction.stop();
          idleAction?.reset().play();
        }
        subjectMixer?.update(frame);
        subjectRoot.quaternion.copy(standingRotation);
        subjectRoot.position.x = subjectRoot.position.z = 0;
        subjectRoot.updateMatrixWorld(true);
        const lowestFoot = Math.min(
          footLeft?.getWorldPosition(footPosition).y ?? 0.04,
          footRight?.getWorldPosition(footPosition).y ?? 0.04,
        );
        subjectRoot.position.y += 0.07 - lowestFoot;
      }
      subjectRoot.updateMatrixWorld(true);
    }
    camera.fov = 52;
    if (releaseTime < 2.4) {
      const reveal = THREE.MathUtils.smootherstep(releaseTime, 0, 1.45);
      camera.position.lerpVectors(
        releaseCameraStart,
        new THREE.Vector3(2.65, 1.2, 2.65),
        reveal,
      );
      releaseLook.set(0, THREE.MathUtils.lerp(1.5, 0.45, reveal), 0);
      camera.lookAt(releaseLook);
      const impact = 1 - THREE.MathUtils.smoothstep(releaseTime, 1.55, 1.95);
      if (releaseTime > 1.55)
        camera.position.y += Math.sin(releaseTime * 84) * impact * 0.035;
    } else if (releaseTime < 5.7) {
      const rise = THREE.MathUtils.smootherstep(releaseTime, 2.4, 5.7);
      camera.position.set(2.65, 1.2 + rise * 0.5, 2.65 - rise * 0.25);
      camera.lookAt(0, 0.65 + rise * 0.45, 0);
    } else {
      const settle = THREE.MathUtils.smootherstep(releaseTime, 5.7, 6.9);
      const standingView = new THREE.Vector3(2.65, 1.7, 2.4);
      const gameplayPosition = new THREE.Vector3(
        thirdPersonCamera.right,
        1.6 + thirdPersonCamera.height,
        thirdPersonCamera.distance,
      );
      camera.position.lerpVectors(standingView, gameplayPosition, settle);
      const cinematicRotation = new THREE.PerspectiveCamera();
      cinematicRotation.position.copy(standingView);
      cinematicRotation.lookAt(0, 1.1, 0);
      camera.quaternion.slerpQuaternions(
        cinematicRotation.quaternion,
        new THREE.Quaternion(),
        settle,
      );
      camera.fov = THREE.MathUtils.lerp(52, 75, settle);
      const titleTime = releaseTime - 5.7;
      const titleOpacity =
        THREE.MathUtils.smoothstep(titleTime, 0, 0.45) *
        (1 - THREE.MathUtils.smoothstep(titleTime, 2.1, 3));
      title.style.visibility = titleOpacity > 0 ? "visible" : "hidden";
      title.style.opacity = String(titleOpacity);
      title.style.transform = `translateY(${(1 - THREE.MathUtils.smoothstep(titleTime, 0, 0.65)) * 10}px)`;
      shotFade.style.opacity = "0";
      if (titleTime >= 3 && !playable) finishCutscene();
    }
    camera.updateProjectionMatrix();
  }

  function updatePhysics(dt: number, thirdPerson = true): void {
    if (disposed) return;
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    lastDelta = frame;
    chainTime += frame;
    cuffMaterial.uniforms.hologramTime.value = chainTime;
    skipHold.update(frame);
    if (playable) {
      if (exitTime >= 0) {
        exitTime += frame;
        if (exitTime >= HOLOGRAM_TRANSFER_DURATION && !finished) {
          finished = true;
          void Promise.resolve()
            .then(() => onFinished?.())
            .then((result) => {
              if (result === false) retryTeleport();
            }, retryTeleport);
        }
      } else physics.step(frame, player, thirdPerson);
      return;
    }
    if (modelReady && flashbacksReady && (preview || eyeOpening))
      timelineTime += frame;

    // Nothing dynamic lives in the world, but step it to keep contacts cheap.
    physicsWorld.step(1 / 60, frame, 3);

    // Camera cutscene -> hold on the wide shot once we pass the last keyframe.
    if (!dialogueStarted && releaseTime < 0) {
      applyCameraAt(timelineTime);
      shotFade.style.opacity = String(
        1 - THREE.MathUtils.smoothstep(timelineTime, 0, 0.8),
      );
    }

    if (subjectRoot && releaseTime < 0) {
      subjectRoot.position.y =
        subjectHoverY + Math.sin(timelineTime * 0.8) * 0.035;
      subjectRoot.updateMatrixWorld(true);
      updateArmChains();
    }
    flowMaterial.uniforms.flowTime.value = timelineTime;
    if (releaseTime < 0) {
      floorLight.intensity = 7 + Math.sin(timelineTime * 1.1) * 0.35;
      floorGlow.material.opacity = 0.85 + Math.sin(timelineTime * 1.1) * 0.06;
    }

    const eyeShotActive =
      !preview && timelineTime >= EYE_SHOT_START && timelineTime < EYE_SHOT_END;
    eyeCanvas.style.display = eyeShotActive ? "block" : "none";
    if (eyeShotActive) {
      const elapsed = timelineTime - EYE_SHOT_START;
      const duration = EYE_SHOT_END - EYE_SHOT_START;
      eyeCanvas.style.opacity = String(
        THREE.MathUtils.smoothstep(elapsed, 0, 0.22) *
          (1 - THREE.MathUtils.smoothstep(elapsed, duration - 0.3, duration)),
      );
      if (!eyeOpening) throw new Error("Brondon eye photograph is not ready");
      eyeOpening.draw(elapsed);
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
      shotFade.style.opacity = shotChanged
        ? String(1 - THREE.MathUtils.smoothstep(beatTime, 0, 0.35))
        : "0";
      if (activeShot === "present") {
        camera.far = 80;
        camera.position.lerpVectors(
          presentCameraStart,
          presentCameraEnd,
          THREE.MathUtils.smootherstep(beatTime, 0, 8),
        );
        camera.lookAt(subjectCenter);
        camera.fov =
          camera.aspect < 1 ? 64 : line?.speaker === "Brondon" ? 47 : 52;
        camera.updateProjectionMatrix();
      } else {
        flashbacks?.update(
          activeShot,
          beatTime,
          line?.duration ?? 8,
          frame,
          camera,
        );
        if (activeShot === "security" && flashbacks) {
          const cut = flashbacks.getSecurityCut();
          memoryLabel.textContent = cut.label;
          overlay.dataset.cut = cut.id;
        }
      }
      if (line && typedChars < line.text.length) {
        typedChars = Math.min(
          line.text.length,
          typedChars + frame * TYPE_SPEED,
        );
        const shown = Math.floor(typedChars);
        textEl.textContent = line.text.slice(0, shown);
        if (shown >= line.text.length) hintEl.classList.remove("hidden");
      }
      if (
        line?.automatic &&
        beatTime >=
          Math.max(line.duration ?? 6, line.text.length / TYPE_SPEED + 1.4)
      )
        advanceDialogue();
    }
    if (releaseTime >= 0) updateRelease(frame);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("mousedown", onClick);
    window.removeEventListener("keydown", onKey);
    skipHold.dispose();
    overlay.remove();
    eyeCanvas.remove();
    cinemaOverlay.remove();
    title.remove();
    skipButton.remove();
    exitPrompt.remove();
    if (!preview) {
      document.body.classList.remove("prologue-playing");
      if (gameCanvas) gameCanvas.style.filter = originalFilter;
      document.getElementById("prologue-dialogue-style")?.remove();
    }
    flashbacks?.dispose();
    subjectMixer?.stopAllAction();
    if (subjectMixer) subjectMixer.uncacheRoot(subjectMixer.getRoot());
    if (subjectRoot) {
      subjectRoot.removeFromParent();
      subjectRoot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      subjectRoot = null;
    }
    armChains.length = 0;
    glowTexture.dispose();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    player.dispose();
    physics.dispose();
  }

  // ---------------------------------------------------------- scene contract
  return {
    roomId: "prologue-1",
    scene,
    camera,
    ready: Promise.all([subjectReady, flashbackPreparation, eyesReady]),
    getMusicTrack: (): "prologue" | "broken-chains" =>
      chainsBroken || playable ? "broken-chains" : "prologue",
    async prepareRendering(renderer: THREE.WebGLRenderer) {
      await Promise.all([subjectReady, flashbackPreparation, eyesReady]);
      await prepareSceneRendering(renderer, scene, camera);
      await flashbacks?.prepareRendering(renderer, camera);
    },
    updatePrisonFeed(dt: number) {
      chainTime += dt;
      cuffMaterial.uniforms.hologramTime.value = chainTime;
      flowMaterial.uniforms.flowTime.value = chainTime;
      updateArmChains();
    },
    getRenderScene: () => flashbacks?.sceneFor(activeShot) ?? scene,
    physicsWorld,
    player,
    cutsceneManager: null,
    isCinematic: () => !playable || exitTime >= 0,
    getHologramTransition: () =>
      exitTime >= 0
        ? hologramTransitionAt(
            exitTime,
            false,
            HOLOGRAM_TRANSFER_DURATION,
            0x58ff9a,
          )
        : null,
    ownsWeaponInput: true,
    forceThirdPerson: true,
    isThirdPersonView: () => true,
    canToggleView: () => false,
    controlsReady: () => false,
    getCinematicDelta: () => lastDelta,
    setMenuPaused: (value: boolean) => {
      if (value) skipHold.reset();
    },
    getCinematicState: () => null,
    getCinematicPose: () => null,
    getDamageTargets: () => [],
    getParryableBolts: () => [],
    updatePhysics,
    dispose,
  };
}
